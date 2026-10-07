(() => {
  // src/a7v2/protocol.js
  var VENDOR_IDS = [14391, 21075];
  var USAGE_PAGE = 65281;
  var USAGE = 1;
  var SHORT = 17;
  var LONG = 18;
  var REPORT_LEN = { [SHORT]: 20, [LONG]: 64 };
  var CMD = {
    setGameMode: 2,
    pairing: 3,
    firmware: 4,
    status: 6,
    sleep: 10,
    performance: 66,
    buttonWrite: 82,
    configWrite: 87,
    profile: 88,
    buttonName: 99,
    configRead: 103,
    profileName: 104
  };
  var LINK_PIDS = {
    4107: { link: "receiver", label: "2.4 GHz receiver" },
    4128: { link: "receiver", label: "8K receiver" },
    4106: { link: "bluetooth", label: "Bluetooth" }
  };
  var MODELS = {
    16408: { name: "A7 V2 Pro", dpiMax: 26e3, lod: [1, 2] },
    16419: { name: "A7 V2 Pro+", dpiMax: 26e3, lod: [1, 2] },
    16409: { name: "A7 V2 Ultra", dpiMax: 42e3, lod: [0.7, 1, 2] },
    16417: { name: "A7 V2 Ultra+", dpiMax: 42e3, lod: [0.7, 1, 2] }
  };
  var FALLBACK_MODEL = { name: "A7 V2", dpiMax: 26e3, lod: [1, 2] };
  var V3_PIDS = [4116, 4120];
  var POLLING_RATES = [125, 500, 1e3, 2e3, 4e3, 8e3];
  var BLUETOOTH_MAX_RATE_INDEX = 2;
  var PROFILE_COUNT = 3;
  var DPI_STAGES = 6;
  var DPI_MIN = 50;
  var DEBOUNCE_MAX = 20;
  var ANGLE_MIN = -30;
  var ANGLE_MAX = 30;
  var PERF_MODES = [
    { value: 1, label: "Performance" },
    { value: 2, label: "eSports" },
    { value: 3, label: "Ultra" }
  ];
  var BUTTONS = ["Left", "Middle", "Right", "Forward", "Back", "DPI"];
  var BTN = {
    default: 0,
    mouse: 1,
    keyboard: 2,
    media: 3,
    macro: 4,
    dpi: 5,
    system: 8,
    disabled: 9,
    profile: 10
  };
  var MOUSE_ACTIONS = [
    { label: "Left click", value: 65536 },
    { label: "Right click", value: 131072 },
    { label: "Middle click", value: 262144 },
    { label: "Back", value: 524288 },
    { label: "Forward", value: 1048576 },
    { label: "Wheel up", value: 512 },
    { label: "Wheel down", value: 65024 }
  ];
  var DPI_ACTIONS = [
    { label: "DPI cycle", value: 65536 },
    { label: "DPI +", value: 131072 },
    { label: "DPI -", value: 196608 }
  ];
  var MEDIA_ACTIONS = [
    { label: "Play / pause", value: 13434880 },
    { label: "Next track", value: 11862016 },
    { label: "Previous track", value: 11927552 },
    { label: "Volume up", value: 15269888 },
    { label: "Volume down", value: 15335424 },
    { label: "Mute", value: 14811136 }
  ];
  var PROFILE_ACTIONS = [
    { label: "Profile 1", value: 65536 },
    { label: "Profile 2", value: 131072 },
    { label: "Profile 3", value: 196608 },
    { label: "Cycle profiles", value: 262144 }
  ];
  var MODIFIERS = { ctrl: 1, shift: 2, alt: 4, win: 8 };
  function encodeRequest(reportId, cmd, args = [], len = REPORT_LEN[reportId]) {
    if (!len) throw new Error(`unknown report id 0x${hex(reportId)}`);
    if (args.length + 1 > len) throw new Error(`command 0x${hex(cmd)} is too long for report 0x${hex(reportId)}`);
    const out = new Uint8Array(len);
    out[0] = cmd;
    out.set(args.map((b) => b & 255), 1);
    for (let i = 0; i < len; i++) out[i] ^= 255;
    return out;
  }
  function decodeReply(reportId, bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const start = b[0] === reportId ? 1 : 0;
    if (b.length <= start) return null;
    const body = b.slice(start).map((x) => x ^ 255);
    if (body.every((x) => x === 0) || body.every((x) => x === 255)) return null;
    return { cmd: body[0], payload: body.slice(1) };
  }
  var u16 = (b, i) => b[i] | b[i + 1] << 8;
  var u32 = (b, i) => (b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24) >>> 0;
  function parseStatus(p) {
    const fw = u32(p, 4);
    return {
      vid: u16(p, 0),
      pid: u16(p, 2),
      fwRaw: fw,
      connectMode: p[8] & 7,
      online: Boolean(p[8] & 8),
      battery: p[9],
      charging: p[10] === 1
    };
  }
  function parseFirmware(p) {
    const n = Math.min(p[0], p.length - 1);
    return String.fromCharCode(...p.slice(1, 1 + n)).replace(/\0.*$/, "").trim();
  }
  var utf8 = (bytes) => new TextDecoder("utf-8").decode(Uint8Array.from(bytes)).replace(/\0.*$/s, "").trim();
  function parseProfileName(p) {
    const end = p.indexOf(0, 1);
    return utf8(p.slice(1, end < 0 ? p.length : end));
  }
  function parseButtonName(p) {
    const n = Math.min(p[1], p.length - 2);
    return utf8(p.slice(2, 2 + n));
  }
  var CONFIG_LEN = 63;
  var OFF = {
    profile: 0,
    wired: 1,
    wireless: 2,
    dpi: 4,
    stageCount: 16,
    sensor: 17,
    debounce: 18,
    sleep: 19,
    buttons: 20,
    angle: 49
  };
  var SENSOR = { lod: 3, ripple: 4, angleSnap: 8, motionSync: 16, perf: 192 };
  function perfFromBits(bits) {
    if (bits === 3) return 3;
    if (bits === 2) return 2;
    return 1;
  }
  function parseConfig(p) {
    if (p.length < CONFIG_LEN) throw new Error("config reply too short");
    const dpi = [];
    for (let i = 0; i < DPI_STAGES; i++) dpi.push(u16(p, OFF.dpi + i * 2));
    const sensor = p[OFF.sensor];
    const buttons = [];
    for (let i = 0; i < BUTTONS.length; i++) {
      const o = OFF.buttons + i * 4;
      buttons.push({ type: p[o] & 15, value: p[o + 1] << 16 | p[o + 2] << 8 | p[o + 3] });
    }
    const angle = p[OFF.angle] > 127 ? p[OFF.angle] - 256 : p[OFF.angle];
    return {
      raw: Uint8Array.from(p.slice(0, CONFIG_LEN)),
      profile: p[OFF.profile],
      wired: { rate: p[OFF.wired] >> 4, stage: p[OFF.wired] & 15 },
      wireless: { rate: p[OFF.wireless] >> 4, stage: p[OFF.wireless] & 15 },
      dpi,
      stageCount: p[OFF.stageCount],
      lod: sensor & SENSOR.lod,
      ripple: Boolean(sensor & SENSOR.ripple),
      angleSnap: Boolean(sensor & SENSOR.angleSnap),
      motionSync: Boolean(sensor & SENSOR.motionSync),
      perfMode: perfFromBits((sensor & SENSOR.perf) >> 6),
      debounce: p[OFF.debounce],
      sleep: p[OFF.sleep],
      buttons,
      angle
    };
  }
  function isPlausibleConfig(p) {
    if (!p || p.length < CONFIG_LEN) return false;
    const first = u16(p, OFF.dpi);
    return first >= DPI_MIN && first <= 42e3 && p[OFF.profile] < PROFILE_COUNT;
  }
  function buildConfig(raw, changes) {
    if (!isPlausibleConfig(raw)) throw new Error("refusing to write: the configuration read back is not valid");
    const b = Uint8Array.from(raw.slice(0, CONFIG_LEN));
    const pack = (rate, stage) => (rate & 15) << 4 | stage & 15;
    if (changes.wired) {
      const cur = { rate: b[OFF.wired] >> 4, stage: b[OFF.wired] & 15, ...changes.wired };
      b[OFF.wired] = pack(cur.rate, cur.stage);
    }
    if (changes.wireless) {
      const cur = { rate: b[OFF.wireless] >> 4, stage: b[OFF.wireless] & 15, ...changes.wireless };
      b[OFF.wireless] = pack(cur.rate, cur.stage);
    }
    if (changes.dpi) {
      changes.dpi.forEach((v, i) => {
        if (v == null) return;
        const d = Math.round(v);
        if (d < DPI_MIN || d > 42e3) throw new Error(`DPI ${v} is out of range`);
        b[OFF.dpi + i * 2] = d & 255;
        b[OFF.dpi + i * 2 + 1] = d >> 8;
      });
    }
    if (changes.stageCount != null) {
      if (changes.stageCount < 1 || changes.stageCount > DPI_STAGES) throw new Error("stage count must be 1-6");
      b[OFF.stageCount] = changes.stageCount;
    }
    if (changes.debounce != null) {
      if (changes.debounce < 0 || changes.debounce > DEBOUNCE_MAX) throw new Error(`debounce must be 0-${DEBOUNCE_MAX} ms`);
      b[OFF.debounce] = changes.debounce;
    }
    return b;
  }
  function performanceArgs({ lod, ripple, angleSnap, motionSync, perfMode = 0, angle }) {
    const toggle = (v) => v == null ? 0 : v ? 1 : 2;
    const rotateOpen = angle == null ? 0 : 1;
    let rotateVal = 0;
    if (angle != null) {
      if (angle < ANGLE_MIN || angle > ANGLE_MAX) throw new Error(`angle must be ${ANGLE_MIN}..${ANGLE_MAX}`);
      rotateVal = angle & 255;
    }
    return [lod & 255, toggle(ripple), toggle(angleSnap), toggle(motionSync), 0, 0, perfMode, rotateOpen, rotateVal];
  }
  function sleepArgs(minutes) {
    if (minutes < 0 || minutes > 255) throw new Error("sleep must be 0-255 minutes");
    return [minutes > 0 ? 1 : 0, minutes];
  }
  function buttonArgs(index, type, value) {
    if (index < 0 || index >= BUTTONS.length) throw new Error("bad button index");
    if (type === BTN.default) value = 0;
    if (type === BTN.disabled) value = 16777215;
    return [index, 0, type, value >> 16 & 255, value >> 8 & 255, value & 255];
  }
  var keyValue = (usage, mods = 0) => (mods & 255) << 16 | (usage & 255) << 8;
  var hex = (n, w = 2) => n.toString(16).padStart(w, "0");
  var hexBytes = (b) => Array.from(b, (x) => hex(x)).join(" ");
  function identify(hostPid, mousePid) {
    const link = LINK_PIDS[hostPid] || (MODELS[hostPid] ? { link: "wired", label: "USB cable" } : { link: "unknown", label: "unknown link" });
    const model = MODELS[mousePid] || MODELS[hostPid] || FALLBACK_MODEL;
    const maxRate = link.link === "bluetooth" ? BLUETOOTH_MAX_RATE_INDEX : POLLING_RATES.length - 1;
    return { ...model, link: link.link, linkLabel: link.label, maxRateIndex: maxRate };
  }
  function describeButton({ type, value }) {
    const find = (list) => list.find((a) => a.value === value)?.label;
    switch (type) {
      case BTN.default:
        return "Default";
      case BTN.mouse:
        return find(MOUSE_ACTIONS) || `Mouse 0x${hex(value, 6)}`;
      case BTN.keyboard:
        return `Key 0x${hex(value >> 8 & 255)}${value >> 16 ? ` + mods 0x${hex(value >> 16)}` : ""}`;
      case BTN.media:
        return find(MEDIA_ACTIONS) || `Media 0x${hex(value, 6)}`;
      case BTN.macro:
        return "Macro";
      case BTN.dpi:
        return find(DPI_ACTIONS) || `DPI 0x${hex(value, 6)}`;
      case BTN.system:
        return `System 0x${hex(value, 6)}`;
      case BTN.disabled:
        return "Disabled";
      case BTN.profile:
        return find(PROFILE_ACTIONS) || `Profile 0x${hex(value, 6)}`;
      default:
        return `Type ${type} 0x${hex(value, 6)}`;
    }
  }

  // src/hid.js
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function hidAvailable() {
    return typeof navigator !== "undefined" && "hid" in navigator;
  }
  var SerialQueue = class {
    constructor(gapMs = 25) {
      this.gapMs = gapMs;
      this.tail = Promise.resolve();
      this.last = 0;
    }
    run(job) {
      const next = this.tail.then(async () => {
        const wait = this.last + this.gapMs - Date.now();
        if (wait > 0) await sleep(wait);
        try {
          return await job();
        } finally {
          this.last = Date.now();
        }
      });
      this.tail = next.catch(() => {
      });
      return next;
    }
  };
  function dataViewBytes(dv) {
    return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength).slice();
  }
  function collectionsSummary(device) {
    const ids = (list) => (list || []).map((r) => `0x${r.reportId.toString(16).padStart(2, "0")}`);
    const walk = (cols, depth = 0) => cols.flatMap((c) => [
      {
        depth,
        usagePage: c.usagePage,
        usage: c.usage,
        input: ids(c.inputReports),
        output: ids(c.outputReports),
        feature: ids(c.featureReports)
      },
      ...walk(c.children || [], depth + 1)
    ]);
    return walk(device.collections || []);
  }
  function hasFeatureReports(device, usagePage, ids) {
    const match = (c) => c.usagePage === usagePage && ids.every((id) => (c.featureReports || []).some((r) => r.reportId === id)) || (c.children || []).some(match);
    return (device.collections || []).some(match);
  }

  // src/a7v2/driver.js
  var HID_FILTERS = VENDOR_IDS.map((vendorId) => ({ vendorId, usagePage: USAGE_PAGE, usage: USAGE }));
  function isA7V2(device) {
    return VENDOR_IDS.includes(device.vendorId) && !V3_PIDS.includes(device.productId) && hasFeatureReports(device, USAGE_PAGE, [SHORT, LONG]);
  }
  var A7V2 = class {
    constructor(device, { log = () => {
    }, queue = new SerialQueue(25) } = {}) {
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
        const walk = (cols) => cols.forEach((c) => {
          if (c.usagePage === USAGE_PAGE) {
            for (const r of c.featureReports || []) {
              const bits = (r.items || []).reduce((n, it) => n + (it.reportSize || 0) * (it.reportCount || 0), 0);
              if (bits >= 8) this.lengths[r.reportId] = Math.ceil(bits / 8);
            }
          }
          walk(c.children || []);
        });
        walk(this.device.collections || []);
      }
      return this.lengths[reportId] || REPORT_LEN[reportId];
    }
    frame(reportId, cmd, args) {
      return encodeRequest(reportId, cmd, args, this.reportLength(reportId));
    }
    // One request/response exchange. The reply buffer is shared, so a read can
    // return the previous command's answer or a half-written buffer: keep
    // polling until the echo matches and the same bytes arrive twice. Replies
    // that cross the RF link can be dropped, so the request is re-sent while
    // waiting, as M HUB does.
    request(reportId, cmd, args = [], { timeout = 2e3, validate, stable = true, resendMs = 400 } = {}) {
      return this.queue.run(async () => {
        const frame = this.frame(reportId, cmd, args);
        this.log("tx", reportId, frame);
        await this.device.sendFeatureReport(reportId, frame);
        const deadline = Date.now() + timeout;
        let lastSend = Date.now();
        let prev = null;
        let delay = 10;
        let seen = "nothing";
        const logged = /* @__PURE__ */ new Set();
        while (Date.now() < deadline) {
          await sleep(delay);
          delay = Math.min(delay * 1.5, 120);
          const raw = dataViewBytes(await this.device.receiveFeatureReport(reportId));
          const reply = decodeReply(reportId, raw);
          if (reply && reply.cmd === cmd && (!validate || validate(reply.payload))) {
            const key = hexBytes(reply.payload);
            if (!stable || key === prev) {
              this.log("rx", reportId, raw);
              return reply.payload;
            }
            prev = key;
            continue;
          }
          seen = !reply ? "empty replies" : reply.cmd !== cmd ? `replies to command 0x${hex(reply.cmd)}` : "a reply that does not look valid";
          const rawKey = hexBytes(raw);
          if (!logged.has(rawKey)) {
            logged.add(rawKey);
            this.log("rx-ignored", reportId, raw);
          }
          if (Date.now() - lastSend >= resendMs) {
            await this.device.sendFeatureReport(reportId, frame);
            lastSend = Date.now();
          }
        }
        const err = new Error(`no reply to command 0x${hex(cmd)}: got ${seen}`);
        err.seen = seen;
        throw err;
      });
    }
    // Fire-and-forget write: the write commands have no reply of their own.
    send(reportId, cmd, args = []) {
      return this.queue.run(async () => {
        const frame = this.frame(reportId, cmd, args);
        this.log("tx", reportId, frame);
        await this.device.sendFeatureReport(reportId, frame);
      });
    }
    async readStatus() {
      return parseStatus(await this.request(SHORT, CMD.status));
    }
    async readFirmware() {
      return parseFirmware(await this.request(SHORT, CMD.firmware));
    }
    async readConfig({ timeout = 3e3 } = {}) {
      const p = await this.request(LONG, CMD.configRead, [], { timeout, validate: isPlausibleConfig });
      this.config = parseConfig(p);
      return this.config;
    }
    async readProfileName(index) {
      try {
        return parseProfileName(await this.request(LONG, CMD.profileName, [index], { timeout: 800 }));
      } catch {
        return null;
      }
    }
    async readButtonName(index) {
      try {
        return parseButtonName(await this.request(LONG, CMD.buttonName, [index], { timeout: 800 }));
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
      }
      this.info = { status, firmware, ...identify(this.device.productId, status.pid) };
      try {
        await this.readConfig();
      } catch (e) {
        await this.send(SHORT, CMD.profile, [0]);
        await sleep(800);
        try {
          await this.readConfig({ timeout: 4e3 });
          this.recovered = true;
        } catch {
          throw new Error(
            `The mouse answered but would not send its settings (${e.seen || e.message}). Wake it by moving it, close M HUB and any other tab using it, then click Connect again. If it still fails, tick "Record traffic", try again and send the log.`
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
        }
      }
      return null;
    }
    // Read-modify-write of the config blob. Bytes the firmware owns are never
    // compared, only the fields we changed.
    async writeConfig(changes, check) {
      if (!this.config) await this.readConfig();
      const blob = buildConfig(this.config.raw, changes);
      await this.send(LONG, CMD.configWrite, Array.from(blob));
      const ok = await this.waitFor(check, { timeout: 2500 });
      if (!ok) throw new Error("the mouse did not confirm the change");
      return ok;
    }
    setDpi(stages, stageCount) {
      const changes = { dpi: stages };
      if (stageCount != null) changes.stageCount = stageCount;
      return this.writeConfig(
        changes,
        (c) => stages.every((v, i) => v == null || c.dpi[i] === Math.round(v)) && (stageCount == null || c.stageCount === stageCount)
      );
    }
    // The live half of the rate/stage pair depends on the link: offset 1 on the
    // cable, offset 2 through a receiver.
    linkKey() {
      return this.info?.link === "wired" ? "wired" : "wireless";
    }
    setActiveStage(stage) {
      const key = this.linkKey();
      return this.writeConfig({ [key]: { stage } }, (c) => c[key].stage === stage);
    }
    setPollingRate(rateIndex) {
      if (rateIndex > (this.info?.maxRateIndex ?? 5)) throw new Error("that polling rate is not available on this link");
      const key = this.linkKey();
      return this.writeConfig({ [key]: { rate: rateIndex } }, (c) => c[key].rate === rateIndex);
    }
    setDebounce(ms) {
      return this.writeConfig({ debounce: ms }, (c) => c.debounce === ms);
    }
    // 0x42 is the slowest command on the device; resend until it sticks.
    async setPerformance(fields) {
      const cur = this.config;
      const args = performanceArgs({ lod: fields.lod ?? cur.lod, ...fields });
      const check = (c) => (fields.lod == null || c.lod === fields.lod) && (fields.ripple == null || c.ripple === fields.ripple) && (fields.angleSnap == null || c.angleSnap === fields.angleSnap) && (fields.motionSync == null || c.motionSync === fields.motionSync) && (fields.perfMode == null || c.perfMode === fields.perfMode) && (fields.angle == null || c.angle === fields.angle);
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.send(SHORT, CMD.performance, args);
        const ok = await this.waitFor(check, { timeout: 2200, interval: 400 });
        if (ok) return ok;
      }
      throw new Error("the mouse did not confirm the change");
    }
    async setSleep(minutes) {
      await this.send(SHORT, CMD.sleep, sleepArgs(minutes));
      const ok = await this.waitFor((c) => c.sleep === minutes, { timeout: 3e3, interval: 500 });
      if (!ok) throw new Error("the mouse did not confirm the change");
      return ok;
    }
    async setButton(index, type, value) {
      const args = buttonArgs(index, type, value);
      const want = args[3] << 16 | args[4] << 8 | args[5];
      await this.send(LONG, CMD.buttonWrite, args);
      const ok = await this.waitFor((c) => c.buttons[index].type === type && c.buttons[index].value === want);
      if (!ok) throw new Error("the mouse did not confirm the change");
      return ok;
    }
    // Switching profile changes DPI and polling; the mouse needs ~0.5 s before
    // it answers for the new one.
    async setProfile(index) {
      await this.send(SHORT, CMD.profile, [index]);
      await sleep(600);
      const ok = await this.waitFor((c) => c.profile === index, { timeout: 2500 });
      if (!ok) throw new Error("the mouse did not switch profile");
      return ok;
    }
  };

  // src/ace68/device.js
  var MODELS2 = [
    { name: "Ace 68", ids: [[16868, 8468], [16868, 8469], [16868, 8470], [16868, 8471], [14391, 12291], [14391, 12330]] },
    { name: "Ace 68 V2", ids: [[14391, 12324], [14391, 12325]] },
    { name: "Ace 68 Turbo", ids: [[14391, 12326], [14391, 12327], [14391, 12328], [14391, 12329]] },
    { name: "Ace 68 GT", ids: [[14391, 12295], [14391, 12297]] },
    { name: "Ace 60", ids: [[16868, 8449], [16868, 8450], [6645, 64560], [6645, 65307]] },
    { name: "Ace 60 Pro", ids: [[16868, 8451], [16868, 8452], [6645, 64561], [6645, 65295]] },
    { name: "Ace 60X", ids: [[16868, 8486], [16868, 8487], [16868, 8466], [16868, 8467]] }
  ];
  var VENDOR_IDS2 = [14391, 16868, 21075, 6645];
  var HID_FILTERS2 = [
    ...MODELS2.flatMap((m) => m.ids.map(([vendorId, productId]) => ({ vendorId, productId }))),
    ...VENDOR_IDS2.map((vendorId) => ({ vendorId }))
  ];
  function modelFor(device) {
    return MODELS2.find((m) => m.ids.some(([v, p]) => v === device.vendorId && p === device.productId)) || null;
  }
  var isAce68 = (device) => modelFor(device) !== null;
  function isVendorCollection(device) {
    return (device.collections || []).some((c) => c.usagePage >= 65280);
  }
  var RawSession = class {
    constructor(devices, { onReport = () => {
    } } = {}) {
      this.devices = [].concat(devices);
      this.device = this.devices[0];
      this.onReport = onReport;
      this.handlers = /* @__PURE__ */ new Map();
    }
    async open() {
      for (const d of this.devices) {
        if (!d.opened) await d.open();
        const h = (e) => this.onReport({ dir: "in", reportId: e.reportId, bytes: dataViewBytes(e.data) });
        d.addEventListener("inputreport", h);
        this.handlers.set(d, h);
      }
    }
    async close() {
      for (const d of this.devices) {
        d.removeEventListener("inputreport", this.handlers.get(d));
        if (d.opened) await d.close();
      }
    }
    owns(device) {
      return this.devices.includes(device);
    }
    target(kind, reportId) {
      const has = (c) => (c[kind] || []).some((r) => r.reportId === reportId) || (c.children || []).some(has);
      return this.devices.find((d) => (d.collections || []).some(has)) || this.devices.find(isVendorCollection) || this.device;
    }
    async sendOutput(reportId, bytes) {
      await this.target("outputReports", reportId).sendReport(reportId, Uint8Array.from(bytes));
      this.onReport({ dir: "out", reportId, bytes: Uint8Array.from(bytes) });
    }
    async sendFeature(reportId, bytes) {
      await this.target("featureReports", reportId).sendFeatureReport(reportId, Uint8Array.from(bytes));
      this.onReport({ dir: "feature-out", reportId, bytes: Uint8Array.from(bytes) });
    }
    async readFeature(reportId) {
      const bytes = dataViewBytes(await this.target("featureReports", reportId).receiveFeatureReport(reportId));
      this.onReport({ dir: "feature-in", reportId, bytes });
      return bytes;
    }
  };
  function parseHex(text) {
    const clean = text.replace(/0x/gi, "").replace(/[^0-9a-f]/gi, " ").trim();
    if (!clean) return [];
    return clean.split(/\s+/).flatMap((tok) => {
      if (tok.length % 2) tok = `0${tok}`;
      return tok.match(/../g).map((h) => parseInt(h, 16));
    });
  }

  // src/keys.js
  var letters = Array.from({ length: 26 }, (_, i) => [String.fromCharCode(65 + i), 4 + i]);
  var digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d, i) => [d, 30 + i]);
  var fkeys = Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 58 + i]);
  var KEYS = [
    ...letters,
    ...digits,
    ...fkeys,
    ["Enter", 40],
    ["Esc", 41],
    ["Backspace", 42],
    ["Tab", 43],
    ["Space", 44],
    ["-", 45],
    ["=", 46],
    ["[", 47],
    ["]", 48],
    ["\\", 49],
    [";", 51],
    ["'", 52],
    ["`", 53],
    [",", 54],
    [".", 55],
    ["/", 56],
    ["Caps Lock", 57],
    ["Print Screen", 70],
    ["Scroll Lock", 71],
    ["Pause", 72],
    ["Insert", 73],
    ["Home", 74],
    ["Page Up", 75],
    ["Delete", 76],
    ["End", 77],
    ["Page Down", 78],
    ["Right", 79],
    ["Left", 80],
    ["Down", 81],
    ["Up", 82],
    ["F13", 104],
    ["F14", 105],
    ["F15", 106],
    ["F16", 107],
    ["F17", 108],
    ["F18", 109],
    ["F19", 110],
    ["F20", 111],
    ["F21", 112],
    ["F22", 113],
    ["F23", 114],
    ["F24", 115]
  ].map(([label, usage]) => ({ label, usage }));
  var keyLabel = (usage) => KEYS.find((k) => k.usage === usage)?.label ?? `0x${usage.toString(16)}`;

  // src/capture.js
  function installCapture() {
    if (window.mchoseCapture) {
      console.warn("mchoseCapture is already installed");
      return;
    }
    const log = [];
    const t0 = performance.now();
    const hex2 = (buf) => {
      const b = ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
      return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
    };
    const id = (d) => `${d.vendorId.toString(16).padStart(4, "0")}:${d.productId.toString(16).padStart(4, "0")}`;
    const push = (e) => log.push({ t: Math.round(performance.now() - t0), ...e });
    const describe2 = (d) => ({
      dev: id(d),
      name: d.productName,
      collections: d.collections.map((c) => ({
        usagePage: c.usagePage,
        usage: c.usage,
        input: c.inputReports.map((x) => x.reportId),
        output: c.outputReports.map((x) => x.reportId),
        feature: c.featureReports.map((x) => x.reportId)
      }))
    });
    const watched = /* @__PURE__ */ new WeakSet();
    const watch = (d) => {
      if (watched.has(d)) return;
      watched.add(d);
      push({ dir: "device", ...describe2(d) });
      d.addEventListener("inputreport", (e) => push({ dev: id(d), dir: "in", reportId: e.reportId, data: hex2(e.data) }));
    };
    const proto = HIDDevice.prototype;
    const wrap = (name, fn) => {
      const orig = proto[name];
      proto[name] = function(...args) {
        return fn.call(this, orig, ...args);
      };
    };
    wrap("sendReport", function(orig, reportId, data) {
      watch(this);
      push({ dev: id(this), dir: "out", reportId, data: hex2(data) });
      return orig.call(this, reportId, data);
    });
    wrap("sendFeatureReport", function(orig, reportId, data) {
      watch(this);
      push({ dev: id(this), dir: "feature-out", reportId, data: hex2(data) });
      return orig.call(this, reportId, data);
    });
    wrap("receiveFeatureReport", async function(orig, reportId) {
      const dv = await orig.call(this, reportId);
      push({ dev: id(this), dir: "feature-in", reportId, data: hex2(dv) });
      return dv;
    });
    wrap("open", async function(orig) {
      const r = await orig.call(this);
      watch(this);
      return r;
    });
    navigator.hid.getDevices().then((list) => list.filter((d) => d.opened).forEach(watch));
    window.mchoseCapture = {
      log,
      mark(note) {
        push({ dir: "mark", note: String(note) });
        console.log(`marked: ${note}`);
      },
      download() {
        const body = JSON.stringify({ userAgent: navigator.userAgent, page: location.href, log }, null, 1);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
        a.download = `mchose-capture-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.json`;
        a.click();
        console.log(`saved ${log.length} entries`);
      }
    };
    console.log('mchoseCapture installed. Now use M HUB as usual; run mchoseCapture.mark("...") before each change.');
  }
  var captureSnippet = () => `(${installCapture.toString()})();`;

  // src/app.js
  var $ = (sel) => document.querySelector(sel);
  var el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const c of children) node.append(c);
    return node;
  };
  var toastTimer;
  function toast(msg, kind = "") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = "", kind === "err" ? 6e3 : 2500);
  }
  async function busy(label, job) {
    document.body.classList.add("busy");
    document.querySelectorAll("#mouse button, #mouse input, #mouse select").forEach((n) => n.disabled = true);
    try {
      const r = await job();
      if (label) toast(label, "ok");
      return r;
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), "err");
      return null;
    } finally {
      document.body.classList.remove("busy");
      document.querySelectorAll("#mouse button, #mouse input, #mouse select").forEach((n) => n.disabled = false);
      if (mouse?.config) renderMouse();
    }
  }
  var logLines = [];
  function logEntry(dir, reportId, bytes) {
    if (!$("#log-enabled").checked) return;
    const entry = { t: (/* @__PURE__ */ new Date()).toISOString(), dir, reportId, data: hexBytes(bytes) };
    logLines.push(entry);
    if (logLines.length > 2e3) logLines.shift();
    const pre = $("#log");
    pre.textContent += `${entry.t.slice(11, 23)}  ${dir.padEnd(11)} 0x${hex(reportId)}  ${entry.data}
`;
    pre.scrollTop = pre.scrollHeight;
  }
  $("#log-clear").onclick = () => {
    logLines.length = 0;
    $("#log").textContent = "";
  };
  $("#log-save").onclick = () => {
    const blob = new Blob([JSON.stringify(logLines, null, 1)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "mchose-hid-log.json" });
    a.click();
  };
  var mouse = null;
  var keyboard = null;
  if (!hidAvailable()) {
    $("#no-hid").hidden = false;
    $("#connect-mouse").disabled = true;
    $("#connect-keyboard").disabled = true;
    $("#connect-any").disabled = true;
  }
  async function connectMouse(device) {
    if (!isA7V2(device)) {
      toast("That device does not speak the A7 V2 protocol (an A7 V3, or not the configuration interface).", "err");
      return;
    }
    mouse = new A7V2(device, { log: logEntry });
    await busy(null, async () => {
      await mouse.open();
      await mouse.load();
      await loadProfileNames();
      $("#mouse").hidden = false;
      toast(mouse.recovered ? `Connected to ${mouse.info.name} (switched to profile 1 to wake its settings channel)` : `Connected to ${mouse.info.name}`, "ok");
    });
    if (!mouse.config) $("#mouse").hidden = true;
  }
  $("#connect-mouse").onclick = async () => {
    const devices = await navigator.hid.requestDevice({ filters: HID_FILTERS }).catch(() => []);
    const device = devices.find(isA7V2) || devices[0];
    if (device) await connectMouse(device);
  };
  $("#mouse-refresh").onclick = () => busy("Reloaded", () => mouse.load());
  $("#mouse-disconnect").onclick = async () => {
    await mouse?.close();
    mouse = null;
    $("#mouse").hidden = true;
  };
  async function connectKeyboard(devices) {
    await keyboard?.close().catch(() => {
    });
    keyboard = new RawSession(devices, { onReport: ({ dir, reportId, bytes }) => logEntry(dir, reportId, bytes) });
    try {
      await keyboard.open();
    } catch (e) {
      toast(`Could not open the keyboard: ${e.message}`, "err");
      return;
    }
    renderKeyboard(keyboard.devices);
    $("#keyboard").hidden = false;
  }
  async function siblings(devices) {
    const [first] = devices;
    const granted = await navigator.hid.getDevices();
    const same = granted.filter((d) => d.vendorId === first.vendorId && d.productId === first.productId);
    return [.../* @__PURE__ */ new Set([...devices, ...same])];
  }
  async function pickKeyboard(filters) {
    const picked = await navigator.hid.requestDevice({ filters }).catch(() => []);
    if (!picked.length) return;
    const all = await siblings(picked);
    all.sort((a, b) => Number(isVendorCollection(b)) - Number(isVendorCollection(a)));
    await connectKeyboard(all);
  }
  $("#connect-keyboard").onclick = () => pickKeyboard(HID_FILTERS2);
  $("#connect-any").onclick = () => pickKeyboard([]);
  $("#keyboard-disconnect").onclick = async () => {
    await keyboard?.close();
    keyboard = null;
    $("#keyboard").hidden = true;
  };
  navigator.hid?.addEventListener("disconnect", (e) => {
    if (mouse && e.device === mouse.device) {
      mouse = null;
      $("#mouse").hidden = true;
      toast("Mouse disconnected");
    }
    if (keyboard && keyboard.owns(e.device)) {
      keyboard = null;
      $("#keyboard").hidden = true;
      toast("Keyboard disconnected");
    }
  });
  var profileNames = [];
  async function loadProfileNames() {
    profileNames = [];
    for (let i = 0; i < PROFILE_COUNT; i++) {
      const name = await mouse.readProfileName(i);
      profileNames.push(!name || /[\u3000-\u9fff]/.test(name) ? `Profile ${i + 1}` : name);
    }
  }
  function segmented(container, items, current, onPick) {
    container.replaceChildren(
      ...items.map(
        (it) => el("button", {
          textContent: it.label,
          disabled: it.disabled,
          ariaPressed: String(it.value === current),
          onclick: () => it.value !== current && onPick(it.value)
        })
      )
    );
  }
  function renderMouse() {
    const { info, config: c } = mouse;
    const link = c[mouse.linkKey()];
    $("#mouse-title").textContent = `MCHOSE ${info.name}`;
    const facts = [
      ["Model", info.name],
      ["Connection", info.linkLabel],
      ["Battery", info.status.online || info.link === "wired" ? `${info.status.battery}%${info.status.charging ? " (charging)" : ""}` : "asleep"],
      ["Firmware", info.firmware || "\u2014"],
      ["USB id", `${hex(mouse.device.vendorId, 4)}:${hex(mouse.device.productId, 4)}`]
    ];
    $("#mouse-info").replaceChildren(...facts.map(([k, v]) => el("div", {}, el("dt", { textContent: k }), el("dd", { textContent: v }))));
    segmented(
      $("#profiles"),
      profileNames.map((name, i) => ({ label: name, value: i })),
      c.profile,
      (i) => busy(`Switched to ${profileNames[i]}`, () => mouse.setProfile(i))
    );
    segmented(
      $("#rates"),
      POLLING_RATES.map((hz, i) => ({ label: hz >= 1e3 ? `${hz / 1e3}K Hz` : `${hz} Hz`, value: i, disabled: i > info.maxRateIndex })),
      link.rate,
      (i) => busy(`Polling rate set to ${POLLING_RATES[i]} Hz`, () => mouse.setPollingRate(i))
    );
    $("#rate-hint").textContent = info.link === "bluetooth" ? "Bluetooth is limited to 1000 Hz." : `Applies to the ${info.link === "wired" ? "cable" : "receiver"} connection. 4K and 8K Hz need the 8K receiver or the cable.`;
    const stages = $("#dpi-stages");
    stages.replaceChildren(
      ...c.dpi.map((v, i) => {
        const off = i >= c.stageCount;
        return el(
          "div",
          { className: `stage${off ? " off" : ""}` },
          el(
            "div",
            { className: "top" },
            el("span", { textContent: `Stage ${i + 1}` }),
            el("button", {
              className: "dot",
              title: "Make active",
              ariaLabel: `Make stage ${i + 1} active`,
              ariaPressed: String(i === link.stage),
              disabled: off,
              onclick: () => i !== link.stage && busy(`Stage ${i + 1} active`, () => mouse.setActiveStage(i))
            })
          ),
          el("input", { type: "number", min: DPI_MIN, max: info.dpiMax, step: 50, value: v })
        );
      })
    );
    $("#stage-count").replaceChildren(
      ...Array.from({ length: DPI_STAGES }, (_, i) => el("option", { value: i + 1, textContent: i + 1, selected: i + 1 === c.stageCount }))
    );
    $("#lod").replaceChildren(...info.lod.map((mm, i) => el("option", { value: i, textContent: `${mm} mm`, selected: i === c.lod })));
    $("#motion-sync").checked = c.motionSync;
    $("#ripple").checked = c.ripple;
    $("#angle-snap").checked = c.angleSnap;
    $("#angle").value = c.angle;
    $("#angle-out").textContent = `${c.angle > 0 ? "+" : ""}${c.angle}\xB0`;
    segmented(
      $("#perf"),
      PERF_MODES,
      c.perfMode,
      (m) => busy(`${PERF_MODES.find((x) => x.value === m).label} mode`, () => mouse.setPerformance({ perfMode: m }))
    );
    $("#debounce").value = c.debounce;
    $("#sleep").value = c.sleep;
    renderButtons();
  }
  $("#dpi-save").onclick = () => {
    const max = mouse.info.dpiMax;
    const values = [...document.querySelectorAll("#dpi-stages input")].map((n) => Number(n.value));
    const bad = values.find((v) => !Number.isFinite(v) || v < DPI_MIN || v > max);
    if (bad !== void 0) return toast(`DPI must be between ${DPI_MIN} and ${max}`, "err");
    const count = Number($("#stage-count").value);
    busy("DPI saved", async () => {
      await mouse.setDpi(values, count);
      const key = mouse.linkKey();
      if (mouse.config[key].stage >= count) await mouse.setActiveStage(0);
    });
  };
  $("#lod").onchange = (e) => busy("Lift-off distance saved", () => mouse.setPerformance({ lod: Number(e.target.value) }));
  $("#motion-sync").onchange = (e) => busy("Saved", () => mouse.setPerformance({ motionSync: e.target.checked }));
  $("#ripple").onchange = (e) => busy("Saved", () => mouse.setPerformance({ ripple: e.target.checked }));
  $("#angle-snap").onchange = (e) => busy("Saved", () => mouse.setPerformance({ angleSnap: e.target.checked }));
  $("#angle").oninput = (e) => $("#angle-out").textContent = `${e.target.value > 0 ? "+" : ""}${e.target.value}\xB0`;
  $("#angle").onchange = (e) => busy("Angle saved", () => mouse.setPerformance({ angle: Number(e.target.value) }));
  $("#timing-save").onclick = () => {
    const debounce = Number($("#debounce").value);
    const minutes = Number($("#sleep").value);
    if (!Number.isInteger(debounce) || debounce < 0 || debounce > DEBOUNCE_MAX) return toast("Debounce must be 0-20 ms", "err");
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 255) return toast("Sleep must be 0-255 minutes", "err");
    busy("Timing saved", async () => {
      if (debounce !== mouse.config.debounce) await mouse.setDebounce(debounce);
      if (minutes !== mouse.config.sleep) await mouse.setSleep(minutes);
    });
  };
  var TYPE_OPTIONS = [
    { type: BTN.default, label: "Factory default" },
    { type: BTN.mouse, label: "Mouse", actions: MOUSE_ACTIONS },
    { type: BTN.keyboard, label: "Keyboard key" },
    { type: BTN.media, label: "Media", actions: MEDIA_ACTIONS },
    { type: BTN.dpi, label: "DPI", actions: DPI_ACTIONS },
    { type: BTN.profile, label: "Profile", actions: PROFILE_ACTIONS },
    { type: BTN.disabled, label: "Disabled" }
  ];
  function describe(btn) {
    if (btn.type === BTN.keyboard) {
      const mods = Object.entries(MODIFIERS).filter(([, m]) => btn.value >> 16 & m).map(([k]) => k[0].toUpperCase() + k.slice(1));
      return [...mods, keyLabel(btn.value >> 8 & 255)].join(" + ");
    }
    return describeButton(btn);
  }
  function renderButtons() {
    const body = $("#buttons tbody");
    body.replaceChildren(
      ...BUTTONS.map((name, i) => {
        const cur = mouse.config.buttons[i];
        const typeSel = el(
          "select",
          { ariaLabel: `${name} action type` },
          ...TYPE_OPTIONS.map((o) => el("option", { value: o.type, textContent: o.label, selected: o.type === cur.type }))
        );
        const valueCell = el("td");
        const apply = el("button", { textContent: "Apply" });
        const fillValue = () => {
          const opt = TYPE_OPTIONS.find((o) => o.type === Number(typeSel.value));
          valueCell.replaceChildren();
          if (opt?.actions) {
            valueCell.append(el(
              "select",
              { className: "value", ariaLabel: `${name} action` },
              ...opt.actions.map((a) => el("option", { value: a.value, textContent: a.label, selected: opt.type === cur.type && a.value === cur.value }))
            ));
          } else if (opt?.type === BTN.keyboard) {
            const usage = cur.type === BTN.keyboard ? cur.value >> 8 & 255 : 58;
            const mods = cur.type === BTN.keyboard ? cur.value >> 16 : 0;
            valueCell.append(
              el(
                "select",
                { className: "key", ariaLabel: `${name} key` },
                ...KEYS.map((k) => el("option", { value: k.usage, textContent: k.label, selected: k.usage === usage }))
              ),
              el(
                "div",
                { className: "seg" },
                ...Object.entries(MODIFIERS).map(([k, m]) => el(
                  "label",
                  { className: "check" },
                  el("input", { type: "checkbox", className: "mod", value: m, checked: Boolean(mods & m) }),
                  k[0].toUpperCase() + k.slice(1)
                ))
              )
            );
          }
        };
        typeSel.onchange = fillValue;
        fillValue();
        apply.onclick = () => {
          const type = Number(typeSel.value);
          let value = 0;
          if (type === BTN.keyboard) {
            const usage = Number(valueCell.querySelector(".key").value);
            const mods = [...valueCell.querySelectorAll(".mod:checked")].reduce((m, n) => m | Number(n.value), 0);
            value = keyValue(usage, mods);
          } else if (valueCell.querySelector(".value")) {
            value = Number(valueCell.querySelector(".value").value);
          }
          if (i === 0 && !(type === BTN.default || type === BTN.mouse && value === 65536)) {
            const keepsLeft = mouse.config.buttons.some((b, j) => j !== 0 && b.type === BTN.mouse && b.value === 65536);
            if (!keepsLeft && !confirm("This removes left click from the left button and no other button is set to left click. Continue?")) return;
          }
          busy(`${name} button saved`, () => mouse.setButton(i, type, value));
        };
        const current = cur.type === BTN.macro ? `Macro (kept as is)` : describe(cur);
        return el(
          "tr",
          {},
          el("td", { textContent: name }),
          el("td", {}, typeSel, el("div", { className: "current", textContent: `Now: ${current}` })),
          valueCell,
          el("td", {}, apply)
        );
      })
    );
  }
  function renderKeyboard(devices) {
    const device = devices[0];
    const model = modelFor(device);
    $("#keyboard-title").textContent = `MCHOSE ${model?.name ?? device.productName}`;
    const facts = [
      ["Model", model?.name ?? "not in the list"],
      ["Product name", device.productName || "\u2014"],
      ["USB id", `${hex(device.vendorId, 4)}:${hex(device.productId, 4)}`],
      ["Interfaces", `${devices.length}${devices.some(isVendorCollection) ? ", incl. vendor (configuration)" : ", no vendor interface"}`]
    ];
    $("#keyboard-info").replaceChildren(...facts.map(([k, v]) => el("div", {}, el("dt", { textContent: k }), el("dd", { textContent: v }))));
    $("#collections tbody").replaceChildren(
      ...devices.flatMap((d) => collectionsSummary(d)).map((c) => el(
        "tr",
        {},
        el("td", { textContent: `${"  ".repeat(c.depth)}0x${hex(c.usagePage, 4)}` }),
        el("td", { textContent: `0x${hex(c.usage, 4)}` }),
        el("td", { textContent: c.input.join(" ") || "\u2014" }),
        el("td", { textContent: c.output.join(" ") || "\u2014" }),
        el("td", { textContent: c.feature.join(" ") || "\u2014" })
      ))
    );
    $("#log-enabled").checked = true;
  }
  var rawArgs = () => [Number($("#raw-id").value) || 0, parseHex($("#raw-bytes").value)];
  var rawGuard = async (job) => {
    if (!keyboard) return;
    try {
      await job();
    } catch (e) {
      toast(e.message, "err");
    }
  };
  $("#raw-output").onclick = () => rawGuard(() => keyboard.sendOutput(...rawArgs()));
  $("#raw-feature").onclick = () => rawGuard(() => keyboard.sendFeature(...rawArgs()));
  $("#raw-read").onclick = () => rawGuard(() => keyboard.readFeature(rawArgs()[0]));
  $("#capture-text").value = captureSnippet();
  $("#copy-capture").onclick = async () => {
    try {
      await navigator.clipboard.writeText(captureSnippet());
    } catch {
      const t = $("#capture-text");
      t.closest("details").open = true;
      t.select();
      document.execCommand("copy");
    }
    toast("Capture script copied. Paste it into the M HUB tab's Console.", "ok");
  };
  (async () => {
    if (!hidAvailable()) return;
    const granted = await navigator.hid.getDevices();
    const m = granted.find(isA7V2);
    if (m) await connectMouse(m);
    const k = granted.filter(isAce68);
    if (k.length) await connectKeyboard(await siblings(k));
  })();
})();
