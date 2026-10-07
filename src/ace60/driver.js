// Driver for the MCHOSE Ace 60 configuration interface. It sends the same
// reads and writes, chunked the same way, as the official web driver.
import * as P from './protocol.js';
import { SerialQueue, dataViewBytes } from '../hid.js';

// The configuration collection: Generic Desktop, usage 0, report 0.
export const isAce60Config = (device) =>
  (device.collections || []).some((c) => c.usagePage === 0x0001 && c.usage === 0x0000 && (c.outputReports || []).some((r) => r.reportId === 0));

export class Ace60 {
  constructor(device, { log = () => {}, queue = new SerialQueue(5) } = {}) {
    this.device = device;
    this.log = log;
    this.queue = queue;
  }

  // One frame out, the matching reply back. Replies are matched on command
  // and offset (the keyboard also sends unsolicited frames); not on length,
  // since the info reply is shorter than the 56 bytes asked for.
  request(cmd, offset = 0, len = P.CHUNK, { timeout = 800, tries = 3 } = {}) {
    return this.queue.run(async () => {
      const frame = P.encodeRequest(cmd, offset, len);
      for (let attempt = 0; attempt < tries; attempt++) {
        const reply = new Promise((resolve) => {
          const done = (value) => {
            clearTimeout(timer);
            this.device.removeEventListener('inputreport', onReport);
            resolve(value);
          };
          const onReport = (e) => {
            if (e.reportId !== 0) return;
            const r = P.decodeReply(dataViewBytes(e.data));
            if (r && r.cmd === cmd && r.offset === offset) done(r);
          };
          const timer = setTimeout(() => done(null), timeout);
          this.device.addEventListener('inputreport', onReport);
        });
        this.log('tx', 0, frame);
        await this.device.sendReport(0, frame);
        const r = await reply;
        if (r) return r.data;
      }
      throw new Error(`the keyboard did not answer command 0x${cmd.toString(16)} at offset ${offset}`);
    });
  }

  // Reads `total` bytes from `base` in the same chunks M HUB uses.
  async readBlock(cmd, total, base = 0, into = new Uint8Array(base + total)) {
    for (const { offset, len } of P.chunks(total)) into.set(await this.request(cmd, base + offset, len), base + offset);
    return into;
  }

  // Sends one write frame and waits for the keyboard to echo it.
  write(cmd, offset, data, { timeout = 800, tries = 3 } = {}) {
    return this.queue.run(async () => {
      const frame = P.encodeRequest(cmd, offset, P.CHUNK, data);
      for (let attempt = 0; attempt < tries; attempt++) {
        const echoed = new Promise((resolve) => {
          const done = (v) => {
            clearTimeout(timer);
            this.device.removeEventListener('inputreport', onReport);
            resolve(v);
          };
          const onReport = (e) => {
            if (e.reportId !== 0) return;
            const r = P.decodeReply(dataViewBytes(e.data));
            if (r && r.cmd === cmd && r.offset === offset) done(true);
          };
          const timer = setTimeout(() => done(false), timeout);
          this.device.addEventListener('inputreport', onReport);
        });
        this.log('tx', 0, frame);
        await this.device.sendReport(0, frame);
        if (await echoed) return;
      }
      throw new Error(`the keyboard did not confirm write 0x${cmd.toString(16)} at offset ${offset}`);
    });
  }

  async readSwitchBlock() {
    return this.readBlock(P.CMD.switches, P.BLOCK_LEN[P.CMD.switches]);
  }

  async readKeymap() {
    const keymap = new Uint8Array(P.BLOCK_LEN[P.CMD.keymap]);
    for (const l of P.LAYERS) await this.readBlock(P.CMD.keymap, P.LAYER_LEN, l.offset, keymap);
    return keymap;
  }

  // Sets the actuation point of the given key slots, then reads the block
  // back to check it landed.
  async setActuation(slots, tenthsMm) {
    const before = await this.readSwitchBlock();
    const after = P.setActuation(before, slots, tenthsMm);
    for (const c of P.switchWriteChunks(before, after)) await this.write(P.CMD.writeSwitches, c.offset, c.data);
    const check = P.parseSwitches(await this.readSwitchBlock());
    if (!slots.every((s) => check[s].actuation === tenthsMm)) throw new Error('the keyboard did not keep the new actuation');
    return check;
  }

  // Replaces one key map entry [type, arg, code] on one layer.
  async setKey(layerOffset, slot, entry) {
    const keymap = await this.readKeymap();
    const at = layerOffset + slot * 3;
    keymap.set(entry, at);
    for (const c of P.keymapWriteChunks(keymap, layerOffset, slot)) await this.write(P.CMD.writeKeymap, c.offset, c.data);
    const check = await this.readKeymap();
    if (!entry.every((b, i) => check[at + i] === b)) throw new Error('the keyboard did not keep the new key');
    return check;
  }

  async load() {
    const info = P.parseInfo(await this.request(P.CMD.info));
    const profile = P.parseProfile(await this.request(P.CMD.profile));
    const settings = await this.readBlock(P.CMD.settings, P.BLOCK_LEN[P.CMD.settings]);
    // M HUB reads each layer on its own, 128 keys x 3 bytes from the layer's offset.
    const keymap = await this.readKeymap();
    const switches = P.parseSwitches(await this.readBlock(P.CMD.switches, P.BLOCK_LEN[P.CMD.switches]));
    const layers = P.LAYERS.map((l) => ({ ...l, keys: P.parseLayer(keymap, l.offset) }));
    return { info, profile, settings, layers, switches };
  }
}
