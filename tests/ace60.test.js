import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as P from '../src/ace60/protocol.js';
import { Ace60, isAce60Config } from '../src/ace60/driver.js';
import { SerialQueue } from '../src/hid.js';
import { keyLabel } from '../src/keys.js';

const capture = JSON.parse(readFileSync(new URL('../captures/ace60-mhub-read.json', import.meta.url)));
const frames = capture.log.filter((e) => e.dev === '41e4:2101' && e.data).map((e) => ({ dir: e.dir, bytes: Uint8Array.from(e.data.split(' '), (h) => parseInt(h, 16)) }));

// A keyboard that answers from the replies recorded from a real Ace 60.
class ReplayAce60 extends EventTarget {
  constructor() {
    super();
    Object.assign(this, { vendorId: 0x41e4, productId: 0x2101, productName: 'Ace 60', opened: true, sent: [] });
    this.collections = [{ usagePage: 1, usage: 0, inputReports: [{ reportId: 0 }], outputReports: [{ reportId: 0 }], featureReports: [] }];
    this.replies = new Map();
    for (const f of frames) if (f.dir === 'in') {
      const r = P.decodeReply(f.bytes);
      this.replies.set(`${r.cmd}:${r.offset}`, f.bytes);
    }
  }
  async sendReport(id, data) {
    assert.equal(id, 0);
    assert.equal(data.length, 64);
    this.sent.push(Uint8Array.from(data));
    const key = `${data[1]}:${data[5] | (data[6] << 8)}`;
    const reply = this.replies.get(key);
    if (!reply) throw new Error(`request ${key} is not one M HUB made`);
    setTimeout(() => this.dispatchEvent(Object.assign(new Event('inputreport'), { reportId: 0, data: new DataView(reply.slice().buffer) })), 1);
  }
}

test('every recorded frame has a valid checksum', () => {
  assert.ok(frames.length > 150);
  for (const f of frames) assert.equal(P.checksum(f.bytes), f.bytes[3]);
});

test('requests are byte-identical to the ones M HUB sent', () => {
  const sent = frames.filter((f) => f.dir === 'out' && f.bytes[1] !== 0xf2);
  for (const f of sent) {
    const mine = P.encodeRequest(f.bytes[1], f.bytes[5] | (f.bytes[6] << 8), f.bytes[4]);
    if (f.bytes[1] === 0xf1 || f.bytes.slice(8).every((b) => b === 0)) assert.deepEqual([...mine], [...f.bytes]);
  }
});

test('the driver reads the whole keyboard using only requests M HUB made', async () => {
  const dev = new ReplayAce60();
  assert.ok(isAce60Config(dev));
  const kb = new Ace60(dev, { queue: new SerialQueue(0) });
  const r = await kb.load();
  assert.equal(r.info.build, 'Jan 10 2026,14:58:22');
  assert.equal(r.info.version, '0x0120');
  assert.deepEqual(r.profile, { active: 0, count: 3 });
  const win = r.layers[0].keys;
  assert.equal(P.describeEntry(win[0], keyLabel), 'Esc');
  assert.equal(P.describeEntry(win[13], keyLabel), '1');
  assert.equal(P.describeEntry(win[48], keyLabel), 'Shift');
  assert.equal(P.describeEntry(win[66], keyLabel), 'Right Ctrl');
  assert.equal(P.describeEntry(win[67], keyLabel), 'Fn');
  const fn = r.layers[1].keys;
  assert.equal(P.describeEntry(fn[13], keyLabel), 'F1');
  assert.equal(P.describeEntry(fn[49], keyLabel), 'Previous track');
  // Mac layer swaps Alt and Win.
  assert.equal(P.describeEntry(r.layers[0].keys[61], keyLabel), 'Win');
  assert.equal(P.describeEntry(r.layers[2].keys[61], keyLabel), 'Alt');
  assert.deepEqual(r.switches[0].raw, [416, 74, 14, 14]);
  assert.equal(r.switches[0].actuation, 14);
  assert.equal(r.settings.length, 64);
});

/* ---------- writes, checked against captures/ace60-mhub-changes.json ---------- */

const changes = JSON.parse(readFileSync(new URL('../captures/ace60-mhub-changes.json', import.meta.url)));
const echoes = changes.log
  .filter((e) => e.dev === '41e4:2101' && e.dir === 'in' && e.data)
  .map((e) => ({ t: e.t, bytes: Uint8Array.from(e.data.split(' '), (h) => parseInt(h, 16)) }));
// What M HUB sent: the keyboard echoes a write whole, with 0xaa for 0x55.
const sentAt = (t) => {
  const b = Uint8Array.from(echoes.find((e) => e.t === t).bytes);
  b[0] = P.REQ;
  return [...b];
};

function blockFrom(cmd, total, base = 0, len = total) {
  const out = new Uint8Array(total);
  for (const f of frames) if (f.dir === 'in' && f.bytes[1] === cmd) {
    const r = P.decodeReply(f.bytes);
    if (r.offset >= base && r.offset < base + len) out.set(r.data, r.offset);
  }
  return out;
}

test('actuation writes match M HUB byte for byte', () => {
  const before = blockFrom(P.CMD.switches, 0x400);
  // Esc, W, A, S, D to 1.2 mm, as recorded right after the "actuation" mark.
  const after = P.setActuation(before, [0, 26, 37, 38, 39], 12);
  const chunks = P.switchWriteChunks(before, after);
  assert.deepEqual(chunks.map((c) => c.offset), [0x000, 0x0d0, 0x128]);
  const mine = chunks.map((c) => [...P.encodeRequest(P.CMD.writeSwitches, c.offset, P.CHUNK, c.data)]);
  assert.deepEqual(mine, [sentAt(1225297), sentAt(1225367), sentAt(1225425)]);
  assert.throws(() => P.setActuation(before, [0], 0));
  assert.throws(() => P.setActuation(before, [0], 41));
});

test('key remap writes match M HUB byte for byte', () => {
  const keymap = new Uint8Array(0x780);
  for (const l of P.LAYERS) keymap.set(blockFrom(P.CMD.keymap, 0x780, l.offset, P.LAYER_LEN).slice(l.offset, l.offset + P.LAYER_LEN), l.offset);
  // A (slot 37) to left click on the Windows layer.
  keymap.set([0x20, 0x01, 0x00], 37 * 3);
  const chunks = P.keymapWriteChunks(keymap, 0, 37);
  const mine = chunks.map((c) => [...P.encodeRequest(P.CMD.writeKeymap, c.offset, P.CHUNK, c.data)]);
  assert.deepEqual(mine, [sentAt(1288093), sentAt(1288195)]);
  assert.equal(P.describeEntry({ type: 0x20, arg: 1, code: 0 }, keyLabel), 'Left click');
});

test('the driver writes and verifies through the echo', async () => {
  const dev = new ReplayAce60();
  const mem = { [P.CMD.switches]: blockFrom(P.CMD.switches, 0x400), [P.CMD.keymap]: new Uint8Array(0x780) };
  for (const l of P.LAYERS) mem[P.CMD.keymap].set(blockFrom(P.CMD.keymap, 0x780, l.offset, P.LAYER_LEN).slice(l.offset, l.offset + P.LAYER_LEN), l.offset);
  const reply = (frame) => setTimeout(() => dev.dispatchEvent(Object.assign(new Event('inputreport'), { reportId: 0, data: new DataView(frame.buffer) })), 1);
  dev.sendReport = async (id, d) => {
    const cmd = d[1], off = d[5] | (d[6] << 8), len = d[4];
    const read = { [P.CMD.switches]: P.CMD.switches, [P.CMD.keymap]: P.CMD.keymap }[cmd];
    const write = { [P.CMD.writeSwitches]: P.CMD.switches, [P.CMD.writeKeymap]: P.CMD.keymap }[cmd];
    if (write) {
      mem[write].set(d.slice(8, 8 + len).slice(0, mem[write].length - off), off);
      const echo = Uint8Array.from(d);
      echo[0] = P.REPLY;
      return reply(echo);
    }
    if (read) {
      const f = new Uint8Array(64);
      f.set([P.REPLY, cmd, 0, 0, len, d[5], d[6], 0]);
      f.set(mem[read].slice(off, off + len), 8);
      f[3] = P.checksum(f);
      return reply(f);
    }
    throw new Error(`unexpected command 0x${cmd.toString(16)}`);
  };
  const kb = new Ace60(dev, { queue: new SerialQueue(0) });
  const sw = await kb.setActuation([37, 38], 5);
  assert.equal(sw[37].actuation, 5);
  assert.equal(sw[0].actuation, 14);
  await kb.setKey(0, 39, [0x20, 0x02, 0x00]);
  assert.deepEqual([...mem[P.CMD.keymap].slice(39 * 3, 39 * 3 + 3)], [0x20, 0x02, 0x00]);
});
