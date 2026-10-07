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
  assert.deepEqual(r.switches[0], [416, 74, 14, 14]);
  assert.equal(r.settings.length, 64);
});
