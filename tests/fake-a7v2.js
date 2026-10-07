// A simulated A7 V2 Ultra+ behind its 2.4 GHz receiver, faithful to the quirks
// the driver has to cope with: inverted frames, one shared reply buffer that
// write commands leave stale, and replies that are empty on the first read.
import { CONFIG_LEN } from '../src/a7v2/protocol.js';

const LEN = { 0x11: 20, 0x12: 64 };

export function defaultConfig(profile = 0) {
  const b = new Uint8Array(CONFIG_LEN);
  b[0] = profile;
  b[1] = 0x30; // wired: 2000 Hz, stage 0
  b[2] = 0x20; // wireless: 1000 Hz, stage 0
  [1600, 800, 1600, 3200, 6400, 42000].forEach((v, i) => {
    b[4 + i * 2] = v & 0xff;
    b[5 + i * 2] = v >> 8;
  });
  b[16] = 4;
  b[17] = 0x80; // eSports mode, lift-off index 0
  b[18] = 4;
  b[19] = 0;
  // left, middle, right, forward, back, DPI: factory default except F9/F10
  const buttons = [[0, 0], [0, 0], [0, 0], [2, 0x004200], [2, 0x004300], [0, 0]];
  buttons.forEach(([type, value], i) => {
    const o = 20 + i * 4;
    b[o] = (i << 4) | type;
    b[o + 1] = value >> 16;
    b[o + 2] = (value >> 8) & 0xff;
    b[o + 3] = value & 0xff;
  });
  return b;
}

export class FakeA7V2 {
  constructor({ productId = 0x100b, mousePid = 0x4021, dropConfigReads = 0, wedged = false } = {}) {
    this.dropConfigReads = dropConfigReads; // ignore this many 0x67 requests
    this.wedged = wedged; // 0x67 answers zeros until a profile is selected
    this.vendorId = 0x3837;
    this.productId = productId;
    this.productName = 'MCHOSE A7 V2 Ultra+';
    this.opened = false;
    this.mousePid = mousePid;
    this.collections = [
      { usagePage: 0x0001, usage: 0x0002, inputReports: [], outputReports: [], featureReports: [], children: [] },
      {
        usagePage: 0xff01,
        usage: 0x0001,
        inputReports: [{ reportId: 0x11 }, { reportId: 0x12 }],
        outputReports: [{ reportId: 0x13 }, { reportId: 0x14 }],
        featureReports: [{ reportId: 0x11 }, { reportId: 0x12 }, { reportId: 0x14 }],
        children: [],
      },
    ];
    this.profiles = [defaultConfig(0), defaultConfig(1), defaultConfig(2)];
    this.active = 0;
    this.buffer = new Uint8Array(64);
    this.pendingEmptyReads = 0;
    this.sent = [];
  }

  get config() {
    return this.profiles[this.active];
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  reply(rid, cmd, payload) {
    const b = new Uint8Array(LEN[rid] + 1);
    b[0] = rid;
    b[1] = cmd ^ 0xff;
    for (let i = 0; i < LEN[rid] - 1; i++) b[2 + i] = (payload[i] ?? 0) ^ 0xff;
    this.buffer = b;
    this.pendingEmptyReads = 1;
  }

  async sendFeatureReport(rid, data) {
    if (data.length !== LEN[rid]) throw new Error(`bad length ${data.length} for report ${rid}`);
    const d = Array.from(data, (x) => x ^ 0xff);
    const [cmd, ...a] = d;
    this.sent.push({ rid, cmd, args: a });
    const c = this.config;
    switch (`${rid}:${cmd}`) {
      case '17:6':
        return this.reply(rid, cmd, [0x37, 0x38, 0x21, 0x40, 4, 2, 46, 5, 0x0a, 87, 0]);
      case '17:4':
        return this.reply(rid, cmd, [8, ...Array.from('5.46.2.4', (ch) => ch.charCodeAt(0))]);
      case '18:103':
        if (this.dropConfigReads > 0) {
          this.dropConfigReads--;
          return;
        }
        return this.reply(rid, cmd, this.wedged ? new Uint8Array(63) : c);
      case '18:104': {
        const name = Array.from(`Config ${a[0] + 1}`, (ch) => ch.charCodeAt(0));
        return this.reply(rid, cmd, [a[0], ...name, 0]);
      }
      case '18:87': {
        const keep3 = c[3];
        c.set(a.slice(0, CONFIG_LEN));
        c[3] = keep3;
        return;
      }
      case '17:66': {
        const [lod, ripple, line, sync, , , perf, rotOpen, rotVal] = a;
        let s = c[17];
        s = (s & ~0x03) | (lod & 0x03);
        const flag = (v, m) => (v === 1 ? (s |= m) : v === 2 ? (s &= ~m) : s);
        flag(ripple, 0x04);
        flag(line, 0x08);
        flag(sync, 0x10);
        if (perf) s = (s & 0x3f) | ({ 1: 0, 2: 0x80, 3: 0xc0 }[perf] ?? 0);
        c[17] = s;
        if (rotOpen) c[49] = rotVal;
        return;
      }
      case '17:10':
        c[19] = a[0] ? a[1] : 0;
        return;
      case '18:82': {
        const [idx, , type, v1, v2, v3] = a;
        const o = 20 + idx * 4;
        c[o] = (idx << 4) | type;
        c[o + 1] = v1;
        c[o + 2] = v2;
        c[o + 3] = v3;
        return;
      }
      case '17:88':
        this.active = a[0];
        this.wedged = false;
        return;
      default:
        throw new Error(`fake: unknown command ${rid}:${cmd}`);
    }
  }

  async receiveFeatureReport(rid) {
    if (this.pendingEmptyReads > 0) {
      this.pendingEmptyReads--;
      return new DataView(new Uint8Array(LEN[rid] + 1).buffer);
    }
    const b = this.buffer[0] === rid ? this.buffer : new Uint8Array(LEN[rid] + 1);
    return new DataView(b.slice().buffer);
  }
}
