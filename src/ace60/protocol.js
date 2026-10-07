// MCHOSE Ace 60 (Sinowealth, USB 41e4:2101) configuration protocol: pure
// encoding and decoding, no I/O. Worked out from a capture of the official
// M HUB web driver talking to a real Ace 60 (captures/ace60-mhub-read.json);
// see docs/ace60-protocol.md.
//
// The configuration interface is Generic Desktop / usage 0 with unnumbered
// report 0, 64 bytes each way: requests go out with sendReport(0, frame) and
// replies arrive as input reports. Every frame, both directions:
//
//   [0]    0x55 request, 0xaa reply
//   [1]    command
//   [2]    0
//   [3]    checksum: sum of bytes 4..63, low 8 bits
//   [4]    data length, at most 56
//   [5..6] offset into the command's memory block, little-endian
//   [7]    0
//   [8..]  data (zero in read requests)
//
// A reply echoes the command, length and offset of its request; a write is
// echoed back whole. Writes use the read command + 1 (keymap 0x08 -> 0x09,
// switches 0xa0 -> 0xa1, settings 0x05 -> 0x06), as recorded in
// captures/ace60-mhub-changes.json.

export const FRAME_LEN = 64;
export const CHUNK = 56;
export const REQ = 0x55;
export const REPLY = 0xaa;

export const CMD = {
  info: 0x03, // firmware version and build date
  profile: 0x04, // active profile and profile list
  settings: 0x05, // 64-byte general settings block
  keymap: 0x08, // 4 layers x 128 keys x 3 bytes, layers 0x200 apart
  macros: 0x0c, // 4 KiB macro area
  notify: 0xa9, // sent by the keyboard on its own
  switches: 0xa0, // 128 keys x 8 bytes of magnetic switch settings
  hostRead: 0xf1, // storage M HUB keeps on the keyboard for itself
  writeSettings: 0x06,
  writeKeymap: 0x09,
  writeSwitches: 0xa1,
};

// Total size M HUB reads for each block.
export const BLOCK_LEN = {
  [CMD.settings]: 64,
  [CMD.keymap]: 0x780,
  [CMD.switches]: 0x400,
};

export const checksum = (frame) => frame.slice(4, FRAME_LEN).reduce((s, b) => s + b, 0) & 0xff;

export function encodeRequest(cmd, offset = 0, len = CHUNK, data = []) {
  if (len > CHUNK) throw new Error(`at most ${CHUNK} bytes per frame`);
  const f = new Uint8Array(FRAME_LEN);
  f[0] = REQ;
  f[1] = cmd;
  f[4] = len;
  f[5] = offset & 0xff;
  f[6] = offset >> 8;
  f.set(data.slice(0, CHUNK), 8);
  f[3] = checksum(f);
  return f;
}

// Returns { cmd, offset, len, data } for a valid reply, else null.
export function decodeReply(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (b.length < FRAME_LEN || b[0] !== REPLY || checksum(b) !== b[3]) return null;
  const len = Math.min(b[4], CHUNK);
  return { cmd: b[1], offset: b[5] | (b[6] << 8), len, data: b.slice(8, 8 + len) };
}

// The read requests M HUB makes for a block of `total` bytes.
export function chunks(total) {
  const out = [];
  for (let off = 0; off < total; off += CHUNK) out.push({ offset: off, len: Math.min(CHUNK, total - off) });
  return out;
}

/* ---------- replies ---------- */

// 0x03: a little-endian u16 (0x0120 on the test keyboard, presumably the
// firmware version) then the ASCII build date.
export function parseInfo(d) {
  const text = String.fromCharCode(...d.slice(2)).replace(/\0.*$/s, '');
  return { version: `0x${((d[1] << 8) | d[0]).toString(16).padStart(4, '0')}`, build: text };
}

// 0x04: [active profile, profile count, ...profile ids].
export function parseProfile(d) {
  return { active: d[0], count: d[1] };
}

/* ---------- keymap ---------- */

export const KEY_SLOTS = 128;
export const LAYER_LEN = KEY_SLOTS * 3;
export const LAYERS = [
  { name: 'Windows', offset: 0x000 },
  { name: 'Windows Fn', offset: 0x200 },
  { name: 'Mac', offset: 0x400 },
  { name: 'Mac Fn', offset: 0x600 },
];

// Entry types: [type, arg, code].
export const ENTRY = { none: 0x00, key: 0x10, mouse: 0x20, media: 0x30, fn: 0xf0 };
export const MOUSE_BUTTONS = { 0x01: 'Left click', 0x02: 'Right click', 0x04: 'Middle click', 0x08: 'Back', 0x10: 'Forward' };

const MODS = ['Ctrl', 'Shift', 'Alt', 'Win', 'Right Ctrl', 'Right Shift', 'Right Alt', 'Right Win'];

// Physical key in each used slot, from the factory Windows layer, so keys
// keep their names after being remapped.
export const KEY_NAMES = { 0: "Esc", 13: "1", 14: "2", 15: "3", 16: "4", 17: "5", 18: "6", 19: "7", 20: "8", 21: "9", 22: "0", 23: "-", 24: "Tab", 25: "Q", 26: "W", 27: "E", 28: "R", 29: "T", 30: "Y", 31: "U", 32: "I", 33: "O", 34: "P", 35: "[", 36: "Caps Lock", 37: "A", 38: "S", 39: "D", 40: "F", 41: "G", 42: "H", 43: "J", 44: "K", 45: "L", 46: ";", 47: "'", 48: "Shift", 49: "Z", 50: "X", 51: "C", 52: "V", 53: "B", 54: "N", 55: "M", 56: ",", 57: ".", 58: "/", 59: "Right Shift", 60: "Ctrl", 61: "Win", 62: "Alt", 63: "Space", 64: "Right Alt", 65: "Menu", 66: "Right Ctrl", 67: "Fn", 71: "Enter", 73: "=", 74: "Backspace", 76: "]", 77: "\\" };

export function parseLayer(block, offset) {
  const keys = [];
  for (let i = 0; i < KEY_SLOTS; i++) {
    const [type, arg, code] = block.slice(offset + i * 3, offset + i * 3 + 3);
    keys.push({ slot: i, type, arg, code });
  }
  return keys;
}

// Unused slots are zero, or 0xf0f0f0 / 0xffffff padding past the matrix.
export const isEmpty = (k) =>
  k.type === undefined || (k.type === 0 && k.arg === 0 && k.code === 0) || (k.type === 0xf0 && k.arg === 0xf0) || k.type === 0xff;

export function describeEntry(k, keyLabel) {
  if (isEmpty(k)) return '';
  if (k.type === ENTRY.key) {
    const mods = MODS.filter((_, i) => k.arg & (1 << i));
    if (!k.code) return mods.join(' + ');
    return [...mods, keyLabel(k.code)].join(' + ');
  }
  if (k.type === ENTRY.mouse) return MOUSE_BUTTONS[k.arg] || `Mouse 0x${k.arg.toString(16)}`;
  if (k.type === ENTRY.media) return MEDIA[k.arg] || `Media 0x${k.arg.toString(16)}`;
  // Snap Tap / SOCD: code is the partner key's slot (A 93 00 27 <-> D 93 01 25).
  if (k.type === 0x93 || k.type === 0x94) return `Snap Tap with slot ${k.code}`;
  if (k.type === ENTRY.fn) return k.arg === 0xff ? 'Fn' : `Function 0x${k.arg.toString(16)}`;
  return `0x${[k.type, k.arg, k.code].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export const MEDIA = {
  0xb5: 'Next track',
  0xb6: 'Previous track',
  0xb7: 'Stop',
  0xcd: 'Play / pause',
  0xe2: 'Mute',
  0xe9: 'Volume up',
  0xea: 'Volume down',
};

/* ---------- magnetic switches ---------- */

// 8 bytes per key slot. Known from the recorded changes:
//   bytes 4-5 and 6-7  actuation point, u16, 0.1 mm steps; M HUB writes the
//                      same value to both (14 = 1.4 mm on factory settings,
//                      set to 12, 5 and 13 in the recording)
//   byte 1             1 normally, 2 after an unlabelled change (rapid trigger?)
//   bytes 0, 2-3       0xa0 and 74, never changed
export const SWITCH_LEN = 8;
export const ACTUATION_MIN = 1; // 0.1 mm
export const ACTUATION_MAX = 40; // 4.0 mm

export function parseSwitches(block) {
  const out = [];
  for (let i = 0; i < KEY_SLOTS; i++) {
    const o = i * SWITCH_LEN;
    const u = (j) => block[o + j] | (block[o + j + 1] << 8);
    out.push({ raw: [u(0), u(2), u(4), u(6)], mode: block[o + 1], actuation: u(4) });
  }
  return out;
}

export function setActuation(block, slots, tenthsMm) {
  if (!Number.isInteger(tenthsMm) || tenthsMm < ACTUATION_MIN || tenthsMm > ACTUATION_MAX) {
    throw new Error(`actuation must be ${ACTUATION_MIN / 10}-${ACTUATION_MAX / 10} mm`);
  }
  const b = Uint8Array.from(block);
  for (const s of slots) {
    const o = s * SWITCH_LEN;
    b[o + 4] = b[o + 6] = tenthsMm & 0xff;
    b[o + 5] = b[o + 7] = tenthsMm >> 8;
  }
  return b;
}

/* ---------- writes, chunked the way M HUB chunks them ---------- */

// Switches: M HUB writes one 56-byte chunk starting at each changed key,
// skipping keys a previous chunk already covered.
export function switchWriteChunks(before, after) {
  const chunks = [];
  let coveredTo = 0;
  for (let s = 0; s < KEY_SLOTS; s++) {
    const o = s * SWITCH_LEN;
    const changed = after.slice(o, o + SWITCH_LEN).some((b, i) => b !== before[o + i]);
    if (!changed || o < coveredTo) continue;
    const start = Math.min(o, BLOCK_LEN[CMD.switches] - CHUNK);
    chunks.push({ offset: start, data: Array.from(after.slice(start, start + CHUNK)) });
    coveredTo = start + CHUNK;
  }
  return chunks;
}

// Key map: M HUB writes 57 bytes from the changed key's entry, as two
// 56-byte frames one byte apart (recorded for A at 0x6f/0x70 and D at
// 0x75/0x76). `keymap` is the whole 4-layer block.
export const KEYMAP_REGION = 57;
export function keymapWriteChunks(keymap, layerOffset, slot) {
  const start = Math.min(layerOffset + slot * 3, layerOffset + LAYER_LEN - KEYMAP_REGION);
  return [start, start + KEYMAP_REGION - CHUNK].map((offset) => ({ offset, data: Array.from(keymap.slice(offset, offset + CHUNK)) }));
}
