// MCHOSE A7 V2 configuration protocol: pure encoding and decoding, no I/O.
//
// The mouse is configured over two *feature* reports on its vendor collection
// (usage page 0xff01, usage 0x0001):
//   0x11  short commands: command byte + 19 argument bytes
//   0x12  long commands:  command byte + 63 argument bytes
// Every byte after the report id is inverted (XOR 0xff) on the wire, in both
// directions. A reply is [reportId, ~cmd, ~payload...]; the echoed command is
// how a reply is matched to its request.
//
// Sources: the MCHOSE M HUB web driver, as documented (and verified on real
// A7 V2 hardware) by github.com/OpenMouse-Project/mouse-protocol
// (docs/mchose-protocol.md) and github.com/alexfrih/mchose-linux (PROTOCOL.md).

export const VENDOR_IDS = [0x3837, 0x5253];
export const USAGE_PAGE = 0xff01;
export const USAGE = 0x0001;

export const SHORT = 0x11;
export const LONG = 0x12;
export const REPORT_LEN = { [SHORT]: 20, [LONG]: 64 };

export const CMD = {
  setGameMode: 0x02,
  pairing: 0x03,
  firmware: 0x04,
  status: 0x06,
  sleep: 0x0a,
  performance: 0x42,
  buttonWrite: 0x52,
  configWrite: 0x57,
  profile: 0x58,
  buttonName: 0x63,
  configRead: 0x67,
  profileName: 0x68,
};

// Host-facing product ids that belong to a link rather than a model.
export const LINK_PIDS = {
  0x100b: { link: 'receiver', label: '2.4 GHz receiver' },
  0x1020: { link: 'receiver', label: '8K receiver' },
  0x100a: { link: 'bluetooth', label: 'Bluetooth' },
};

// Model table from M HUB. The mouse reports its own PID inside the 0x06 reply.
export const MODELS = {
  0x4018: { name: 'A7 V2 Pro', dpiMax: 26000, lod: [1, 2] },
  0x4023: { name: 'A7 V2 Pro+', dpiMax: 26000, lod: [1, 2] },
  0x4019: { name: 'A7 V2 Ultra', dpiMax: 42000, lod: [0.7, 1, 2] },
  0x4021: { name: 'A7 V2 Ultra+', dpiMax: 42000, lod: [0.7, 1, 2] },
};
export const FALLBACK_MODEL = { name: 'A7 V2', dpiMax: 26000, lod: [1, 2] };

// Product ids of the A7 V3 generation. Same vendor id and usage page, but an
// unrelated protocol (output report 0x4d); never talk V2 frames to these.
export const V3_PIDS = [0x1014, 0x1018];

export const POLLING_RATES = [125, 500, 1000, 2000, 4000, 8000];
export const BLUETOOTH_MAX_RATE_INDEX = 2;

export const PROFILE_COUNT = 3;
export const DPI_STAGES = 6;
export const DPI_MIN = 50;
export const DEBOUNCE_MAX = 20;
export const ANGLE_MIN = -30;
export const ANGLE_MAX = 30;

export const PERF_MODES = [
  { value: 1, label: 'Performance' },
  { value: 2, label: 'eSports' },
  { value: 3, label: 'Ultra' },
];

// Physical button order in the 0x52 command and the config blob.
export const BUTTONS = ['Left', 'Middle', 'Right', 'Forward', 'Back', 'DPI'];

// Button action type nibble. The value's meaning depends on the type.
export const BTN = {
  default: 0,
  mouse: 1,
  keyboard: 2,
  media: 3,
  macro: 4,
  dpi: 5,
  system: 8,
  disabled: 9,
  profile: 10,
};

export const MOUSE_ACTIONS = [
  { label: 'Left click', value: 0x010000 },
  { label: 'Right click', value: 0x020000 },
  { label: 'Middle click', value: 0x040000 },
  { label: 'Back', value: 0x080000 },
  { label: 'Forward', value: 0x100000 },
  { label: 'Wheel up', value: 0x000200 },
  { label: 'Wheel down', value: 0x00fe00 },
];
export const DPI_ACTIONS = [
  { label: 'DPI cycle', value: 0x010000 },
  { label: 'DPI +', value: 0x020000 },
  { label: 'DPI -', value: 0x030000 },
];
export const MEDIA_ACTIONS = [
  { label: 'Play / pause', value: 0xcd0000 },
  { label: 'Next track', value: 0xb50000 },
  { label: 'Previous track', value: 0xb60000 },
  { label: 'Volume up', value: 0xe90000 },
  { label: 'Volume down', value: 0xea0000 },
  { label: 'Mute', value: 0xe20000 },
];
export const PROFILE_ACTIONS = [
  { label: 'Profile 1', value: 0x010000 },
  { label: 'Profile 2', value: 0x020000 },
  { label: 'Profile 3', value: 0x030000 },
  { label: 'Cycle profiles', value: 0x040000 },
];
export const MODIFIERS = { ctrl: 0x01, shift: 0x02, alt: 0x04, win: 0x08 };

/* ---------- framing ---------- */

// Payload for sendFeatureReport(reportId, payload): command and arguments,
// zero-padded to the report's length, every byte inverted.
export function encodeRequest(reportId, cmd, args = []) {
  const len = REPORT_LEN[reportId];
  if (!len) throw new Error(`unknown report id 0x${hex(reportId)}`);
  if (args.length + 1 > len) throw new Error(`command 0x${hex(cmd)} is too long for report 0x${hex(reportId)}`);
  const out = new Uint8Array(len);
  out[0] = cmd;
  out.set(args.map((b) => b & 0xff), 1);
  for (let i = 0; i < len; i++) out[i] ^= 0xff;
  return out;
}

// Decodes what receiveFeatureReport returned. Chrome puts the report id in
// byte 0 for numbered reports; tolerate a buffer without it as well.
// Returns { cmd, payload } with the payload un-inverted, or null if the
// buffer is empty or not a reply to anything.
export function decodeReply(reportId, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const start = b[0] === reportId && b.length > REPORT_LEN[reportId] ? 1 : 0;
  if (b.length <= start) return null;
  const body = b.slice(start).map((x) => x ^ 0xff);
  if (body.every((x) => x === 0) || body.every((x) => x === 0xff)) return null;
  return { cmd: body[0], payload: body.slice(1) };
}

/* ---------- replies ---------- */

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// 0x11 0x06: who is behind this link, battery and charge.
export function parseStatus(p) {
  const fw = u32(p, 4);
  return {
    vid: u16(p, 0),
    pid: u16(p, 2),
    fwRaw: fw,
    connectMode: p[8] & 0x07,
    online: Boolean(p[8] & 0x08),
    battery: p[9],
    charging: p[10] === 1,
  };
}

// 0x11 0x04: length-prefixed ASCII.
export function parseFirmware(p) {
  const n = Math.min(p[0], p.length - 1);
  return String.fromCharCode(...p.slice(1, 1 + n)).replace(/\0.*$/, '').trim();
}

// 0x12 0x68: profile index then NUL-terminated ASCII.
export function parseProfileName(p) {
  const end = p.indexOf(0, 1);
  const raw = p.slice(1, end < 0 ? p.length : end);
  return String.fromCharCode(...raw).trim();
}

// 0x12 0x63: button index, length, ASCII.
export function parseButtonName(p) {
  const n = Math.min(p[1], p.length - 2);
  return String.fromCharCode(...p.slice(2, 2 + n)).replace(/\0.*$/, '').trim();
}

/* ---------- the configuration blob (0x12 0x67 / 0x12 0x57) ---------- */

export const CONFIG_LEN = 63;
const OFF = {
  profile: 0,
  wired: 1,
  wireless: 2,
  dpi: 4,
  stageCount: 16,
  sensor: 17,
  debounce: 18,
  sleep: 19,
  buttons: 20,
  angle: 49,
};

// The sensor byte holds lift-off and the processing toggles.
const SENSOR = { lod: 0x03, ripple: 0x04, angleSnap: 0x08, motionSync: 0x10, perf: 0xc0 };

function perfFromBits(bits) {
  if (bits === 0b11) return 3;
  if (bits === 0b10) return 2;
  return 1;
}

export function parseConfig(p) {
  if (p.length < CONFIG_LEN) throw new Error('config reply too short');
  const dpi = [];
  for (let i = 0; i < DPI_STAGES; i++) dpi.push(u16(p, OFF.dpi + i * 2));
  const sensor = p[OFF.sensor];
  const buttons = [];
  for (let i = 0; i < BUTTONS.length; i++) {
    const o = OFF.buttons + i * 4;
    buttons.push({ type: p[o] & 0x0f, value: (p[o + 1] << 16) | (p[o + 2] << 8) | p[o + 3] });
  }
  const angle = p[OFF.angle] > 127 ? p[OFF.angle] - 256 : p[OFF.angle];
  return {
    raw: Uint8Array.from(p.slice(0, CONFIG_LEN)),
    profile: p[OFF.profile],
    wired: { rate: p[OFF.wired] >> 4, stage: p[OFF.wired] & 0x0f },
    wireless: { rate: p[OFF.wireless] >> 4, stage: p[OFF.wireless] & 0x0f },
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
    angle,
  };
}

// A config reply must carry a sane first DPI stage. The reply buffer is
// shared by every command, so a stale battery or name reply can otherwise be
// mistaken for configuration and written back.
export function isPlausibleConfig(p) {
  if (!p || p.length < CONFIG_LEN) return false;
  const first = u16(p, OFF.dpi);
  return first >= DPI_MIN && first <= 42000 && p[OFF.profile] < PROFILE_COUNT;
}

// Rebuilds the blob for 0x57 from the last raw read plus the fields to
// change. Only the named fields move; everything else (buttons, macros,
// bytes the firmware owns) is sent back exactly as read.
export function buildConfig(raw, changes) {
  if (!isPlausibleConfig(raw)) throw new Error('refusing to write: the configuration read back is not valid');
  const b = Uint8Array.from(raw.slice(0, CONFIG_LEN));
  const pack = (rate, stage) => ((rate & 0x0f) << 4) | (stage & 0x0f);
  if (changes.wired) {
    const cur = { rate: b[OFF.wired] >> 4, stage: b[OFF.wired] & 0x0f, ...changes.wired };
    b[OFF.wired] = pack(cur.rate, cur.stage);
  }
  if (changes.wireless) {
    const cur = { rate: b[OFF.wireless] >> 4, stage: b[OFF.wireless] & 0x0f, ...changes.wireless };
    b[OFF.wireless] = pack(cur.rate, cur.stage);
  }
  if (changes.dpi) {
    changes.dpi.forEach((v, i) => {
      if (v == null) return;
      const d = Math.round(v);
      if (d < DPI_MIN || d > 42000) throw new Error(`DPI ${v} is out of range`);
      b[OFF.dpi + i * 2] = d & 0xff;
      b[OFF.dpi + i * 2 + 1] = d >> 8;
    });
  }
  if (changes.stageCount != null) {
    if (changes.stageCount < 1 || changes.stageCount > DPI_STAGES) throw new Error('stage count must be 1-6');
    b[OFF.stageCount] = changes.stageCount;
  }
  if (changes.debounce != null) {
    if (changes.debounce < 0 || changes.debounce > DEBOUNCE_MAX) throw new Error(`debounce must be 0-${DEBOUNCE_MAX} ms`);
    b[OFF.debounce] = changes.debounce;
  }
  return b;
}

/* ---------- write commands ---------- */

// 0x11 0x42. Toggles take 1 = on, 2 = off, 0 = leave alone; lift-off is an
// index and always sent. Performance mode 1-3, 0 = leave alone.
export function performanceArgs({ lod, ripple, angleSnap, motionSync, perfMode = 0, angle }) {
  const toggle = (v) => (v == null ? 0 : v ? 1 : 2);
  const rotateOpen = angle == null ? 0 : 1;
  let rotateVal = 0;
  if (angle != null) {
    if (angle < ANGLE_MIN || angle > ANGLE_MAX) throw new Error(`angle must be ${ANGLE_MIN}..${ANGLE_MAX}`);
    rotateVal = angle & 0xff;
  }
  return [lod & 0xff, toggle(ripple), toggle(angleSnap), toggle(motionSync), 0, 0, perfMode, rotateOpen, rotateVal];
}

// 0x11 0x0a. Zero minutes disables auto-sleep.
export function sleepArgs(minutes) {
  if (minutes < 0 || minutes > 255) throw new Error('sleep must be 0-255 minutes');
  return [minutes > 0 ? 1 : 0, minutes];
}

// 0x12 0x52: [buttonIndex, reserved, type, value u24 big-endian].
export function buttonArgs(index, type, value) {
  if (index < 0 || index >= BUTTONS.length) throw new Error('bad button index');
  if (type === BTN.default) value = 0;
  if (type === BTN.disabled) value = 0xffffff;
  return [index, 0, type, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

// Keyboard binding value: modifier mask in the top byte, HID usage in the middle.
export const keyValue = (usage, mods = 0) => ((mods & 0xff) << 16) | ((usage & 0xff) << 8);

/* ---------- helpers ---------- */

export const hex = (n, w = 2) => n.toString(16).padStart(w, '0');
export const hexBytes = (b) => Array.from(b, (x) => hex(x)).join(' ');

// Turns a host PID plus the mouse's own PID (from 0x06) into a description.
export function identify(hostPid, mousePid) {
  const link = LINK_PIDS[hostPid] || (MODELS[hostPid] ? { link: 'wired', label: 'USB cable' } : { link: 'unknown', label: 'unknown link' });
  const model = MODELS[mousePid] || MODELS[hostPid] || FALLBACK_MODEL;
  const maxRate = link.link === 'bluetooth' ? BLUETOOTH_MAX_RATE_INDEX : POLLING_RATES.length - 1;
  return { ...model, link: link.link, linkLabel: link.label, maxRateIndex: maxRate };
}

export function describeButton({ type, value }) {
  const find = (list) => list.find((a) => a.value === value)?.label;
  switch (type) {
    case BTN.default: return 'Default';
    case BTN.mouse: return find(MOUSE_ACTIONS) || `Mouse 0x${hex(value, 6)}`;
    case BTN.keyboard: return `Key 0x${hex((value >> 8) & 0xff)}${value >> 16 ? ` + mods 0x${hex(value >> 16)}` : ''}`;
    case BTN.media: return find(MEDIA_ACTIONS) || `Media 0x${hex(value, 6)}`;
    case BTN.macro: return 'Macro';
    case BTN.dpi: return find(DPI_ACTIONS) || `DPI 0x${hex(value, 6)}`;
    case BTN.system: return `System 0x${hex(value, 6)}`;
    case BTN.disabled: return 'Disabled';
    case BTN.profile: return find(PROFILE_ACTIONS) || `Profile 0x${hex(value, 6)}`;
    default: return `Type ${type} 0x${hex(value, 6)}`;
  }
}
