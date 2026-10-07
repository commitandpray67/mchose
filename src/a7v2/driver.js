// MCHOSE A7 V2 driver over WebHID. All protocol details live in protocol.js;
// this file only sequences requests and verifies that writes landed.
import * as P from './protocol.js';
import { SerialQueue, dataViewBytes, hasFeatureReports, sleep } from '../hid.js';

export const HID_FILTERS = P.VENDOR_IDS.map((vendorId) => ({ vendorId, usagePage: P.USAGE_PAGE, usage: P.USAGE }));

export function isA7V2(device) {
  return (
    P.VENDOR_IDS.includes(device.vendorId) &&
    !P.V3_PIDS.includes(device.productId) &&
    hasFeatureReports(device, P.USAGE_PAGE, [P.SHORT, P.LONG])
  );
}

export class A7V2 {
  constructor(device, { log = () => {}, queue = new SerialQueue(25) } = {}) {
    this.device = device;
    this.log = log;
    this.queue = queue;
    this.info = null;
    this.config = null;
  }

  async open() {
    if (!this.device.opened) await this.device.open();
  }

  async close() {
    if (this.device.opened) await this.device.close();
  }

  // Byte length of a feature report as the device's descriptor declares it,
  // falling back to the documented length.
  reportLength(reportId) {
    if (!this.lengths) {
      this.lengths = {};
      const walk = (cols) =>
        cols.forEach((c) => {
          if (c.usagePage === P.USAGE_PAGE) {
            for (const r of c.featureReports || []) {
              const bits = (r.items || []).reduce((n, it) => n + (it.reportSize || 0) * (it.reportCount || 0), 0);
              if (bits >= 8) this.lengths[r.reportId] = Math.ceil(bits / 8);
            }
          }
          walk(c.children || []);
        });
      walk(this.device.collections || []);
    }
    return this.lengths[reportId] || P.REPORT_LEN[reportId];
  }

  frame(reportId, cmd, args) {
    return P.encodeRequest(reportId, cmd, args, this.reportLength(reportId));
  }

  // One request/response exchange. The reply buffer is shared, so a read can
  // return the previous command's answer or a half-written buffer: keep
  // polling until the echo matches and the same bytes arrive twice. Replies
  // that cross the RF link can be dropped, so the request is re-sent while
  // waiting, as M HUB does.
  request(reportId, cmd, args = [], { timeout = 2000, validate, stable = true, resendMs = 400 } = {}) {
    return this.queue.run(async () => {
      const frame = this.frame(reportId, cmd, args);
      this.log('tx', reportId, frame);
      await this.device.sendFeatureReport(reportId, frame);
      const deadline = Date.now() + timeout;
      let lastSend = Date.now();
      let prev = null;
      let delay = 10;
      let seen = 'nothing';
      const logged = new Set();
      while (Date.now() < deadline) {
        await sleep(delay);
        delay = Math.min(delay * 1.5, 120);
        const raw = dataViewBytes(await this.device.receiveFeatureReport(reportId));
        const reply = P.decodeReply(reportId, raw);
        if (reply && reply.cmd === cmd && (!validate || validate(reply.payload))) {
          const key = P.hexBytes(reply.payload);
          if (!stable || key === prev) {
            this.log('rx', reportId, raw);
            return reply.payload;
          }
          prev = key;
          continue;
        }
        // Keep what we saw for the error message and the log.
        seen = !reply ? 'empty replies' : reply.cmd !== cmd ? `replies to command 0x${P.hex(reply.cmd)}` : 'a reply that does not look valid';
        const rawKey = P.hexBytes(raw);
        if (!logged.has(rawKey)) {
          logged.add(rawKey);
          this.log('rx-ignored', reportId, raw);
        }
        if (Date.now() - lastSend >= resendMs) {
          await this.device.sendFeatureReport(reportId, frame);
          lastSend = Date.now();
        }
      }
      const err = new Error(`no reply to command 0x${P.hex(cmd)}: got ${seen}`);
      err.seen = seen;
      throw err;
    });
  }

  // Fire-and-forget write: the write commands have no reply of their own.
  send(reportId, cmd, args = []) {
    return this.queue.run(async () => {
      const frame = this.frame(reportId, cmd, args);
      this.log('tx', reportId, frame);
      await this.device.sendFeatureReport(reportId, frame);
    });
  }

  async readStatus() {
    return P.parseStatus(await this.request(P.SHORT, P.CMD.status));
  }

  async readFirmware() {
    return P.parseFirmware(await this.request(P.SHORT, P.CMD.firmware));
  }

  async readConfig({ timeout = 3000 } = {}) {
    const p = await this.request(P.LONG, P.CMD.configRead, [], { timeout, validate: P.isPlausibleConfig });
    this.config = P.parseConfig(p);
    return this.config;
  }

  async readProfileName(index) {
    try {
      return P.parseProfileName(await this.request(P.LONG, P.CMD.profileName, [index], { timeout: 800 }));
    } catch {
      return null;
    }
  }

  async readButtonName(index) {
    try {
      return P.parseButtonName(await this.request(P.LONG, P.CMD.buttonName, [index], { timeout: 800 }));
    } catch {
      return null;
    }
  }

  // Reads everything the UI needs. Status first: it tells us which model is
  // behind a receiver, which sets the DPI ceiling and lift-off steps.
  async load() {
    const status = await this.readStatus();
    let firmware = null;
    try {
      firmware = await this.readFirmware();
    } catch {
      /* optional */
    }
    this.info = { status, firmware, ...P.identify(this.device.productId, status.pid) };
    try {
      await this.readConfig();
    } catch (e) {
      // The long-report channel can wedge and answer zeros while the short
      // commands keep working. Re-selecting a profile brings it back; the
      // active profile is unknown at this point, so this selects profile 1.
      await this.send(P.SHORT, P.CMD.profile, [0]);
      await sleep(800);
      try {
        await this.readConfig({ timeout: 4000 });
        this.recovered = true;
      } catch {
        throw new Error(
          `The mouse answered but would not send its settings (${e.seen || e.message}). ` +
            'Wake it by moving it, close M HUB and any other tab using it, then click Connect again. ' +
            'If it still fails, tick "Record traffic", try again and send the log.',
        );
      }
    }
    return { info: this.info, config: this.config };
  }

  // Polls the config until check(config) is true. Writes take anywhere from
  // a few hundred ms (0x57) to ~2 s (0x42) to show up in a read.
  async waitFor(check, { timeout = 2500, interval = 250 } = {}) {
    const deadline = Date.now() + timeout;
    let last = this.config;
    while (Date.now() < deadline) {
      await sleep(interval);
      try {
        last = await this.readConfig({ timeout: 1200 });
        if (check(last)) return last;
      } catch {
        /* keep polling */
      }
    }
    return null;
  }

  // Read-modify-write of the config blob. Bytes the firmware owns are never
  // compared, only the fields we changed.
  async writeConfig(changes, check) {
    if (!this.config) await this.readConfig();
    const blob = P.buildConfig(this.config.raw, changes);
    await this.send(P.LONG, P.CMD.configWrite, Array.from(blob));
    const ok = await this.waitFor(check, { timeout: 2500 });
    if (!ok) throw new Error('the mouse did not confirm the change');
    return ok;
  }

  setDpi(stages, stageCount) {
    const changes = { dpi: stages };
    if (stageCount != null) changes.stageCount = stageCount;
    return this.writeConfig(changes, (c) =>
      stages.every((v, i) => v == null || c.dpi[i] === Math.round(v)) && (stageCount == null || c.stageCount === stageCount),
    );
  }

  // The live half of the rate/stage pair depends on the link: offset 1 on the
  // cable, offset 2 through a receiver.
  linkKey() {
    return this.info?.link === 'wired' ? 'wired' : 'wireless';
  }

  setActiveStage(stage) {
    const key = this.linkKey();
    return this.writeConfig({ [key]: { stage } }, (c) => c[key].stage === stage);
  }

  setPollingRate(rateIndex) {
    if (rateIndex > (this.info?.maxRateIndex ?? 5)) throw new Error('that polling rate is not available on this link');
    const key = this.linkKey();
    return this.writeConfig({ [key]: { rate: rateIndex } }, (c) => c[key].rate === rateIndex);
  }

  setDebounce(ms) {
    return this.writeConfig({ debounce: ms }, (c) => c.debounce === ms);
  }

  // 0x42 is the slowest command on the device; resend until it sticks.
  async setPerformance(fields) {
    const cur = this.config;
    const args = P.performanceArgs({ lod: fields.lod ?? cur.lod, ...fields });
    const check = (c) =>
      (fields.lod == null || c.lod === fields.lod) &&
      (fields.ripple == null || c.ripple === fields.ripple) &&
      (fields.angleSnap == null || c.angleSnap === fields.angleSnap) &&
      (fields.motionSync == null || c.motionSync === fields.motionSync) &&
      (fields.perfMode == null || c.perfMode === fields.perfMode) &&
      (fields.angle == null || c.angle === fields.angle);
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.send(P.SHORT, P.CMD.performance, args);
      const ok = await this.waitFor(check, { timeout: 2200, interval: 400 });
      if (ok) return ok;
    }
    throw new Error('the mouse did not confirm the change');
  }

  async setSleep(minutes) {
    await this.send(P.SHORT, P.CMD.sleep, P.sleepArgs(minutes));
    const ok = await this.waitFor((c) => c.sleep === minutes, { timeout: 3000, interval: 500 });
    if (!ok) throw new Error('the mouse did not confirm the change');
    return ok;
  }

  async setButton(index, type, value) {
    const args = P.buttonArgs(index, type, value);
    const want = (args[3] << 16) | (args[4] << 8) | args[5];
    await this.send(P.LONG, P.CMD.buttonWrite, args);
    const ok = await this.waitFor((c) => c.buttons[index].type === type && c.buttons[index].value === want);
    if (!ok) throw new Error('the mouse did not confirm the change');
    return ok;
  }

  // Switching profile changes DPI and polling; the mouse needs ~0.5 s before
  // it answers for the new one.
  async setProfile(index) {
    await this.send(P.SHORT, P.CMD.profile, [index]);
    await sleep(600);
    const ok = await this.waitFor((c) => c.profile === index, { timeout: 2500 });
    if (!ok) throw new Error('the mouse did not switch profile');
    return ok;
  }
}
