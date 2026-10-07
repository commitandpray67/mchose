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
// A reply echoes the command, length and offset of its request. Only the
// read commands are known so far; the commands that change settings have
// not been captured yet, so nothing here writes.

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
export const ENTRY = { none: 0x00, key: 0x10, media: 0x30, fn: 0xf0 };

const MODS = ['Ctrl', 'Shift', 'Alt', 'Win', 'Right Ctrl', 'Right Shift', 'Right Alt', 'Right Win'];

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
  if (k.type === ENTRY.media) return MEDIA[k.arg] || `Media 0x${k.arg.toString(16)}`;
  if (k.type === ENTRY.fn) return k.arg === 0xff ? 'Fn' : `Function 0x${k.arg.toString(16)}`;
  return `0x${[k.type, k.arg, k.code].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const MEDIA = {
  0xb5: 'Next track',
  0xb6: 'Previous track',
  0xb7: 'Stop',
  0xcd: 'Play / pause',
  0xe2: 'Mute',
  0xe9: 'Volume up',
  0xea: 'Volume down',
};

/* ---------- magnetic switches ---------- */

// 8 bytes per key slot, four little-endian u16 values. Their meaning
// (actuation point, rapid-trigger press/release sensitivity...) and units
// are not confirmed yet: every key read 416 / 74 / 14 / 14 on the factory
// settings. A capture that changes them one at a time will pin them down.
export function parseSwitches(block) {
  const out = [];
  for (let i = 0; i < KEY_SLOTS; i++) {
    const o = i * 8;
    const u = (j) => block[o + j] | (block[o + j + 1] << 8);
    out.push([u(0), u(2), u(4), u(6)]);
  }
  return out;
}
