import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSnippet } from '../src/capture.js';

test('the capture snippet records traffic and passes calls through', async () => {
  const sent = [];
  class HIDDevice extends EventTarget {
    constructor() {
      super();
      Object.assign(this, { vendorId: 0x41e4, productId: 0x2101, productName: 'Ace 60', opened: false, collections: [] });
    }
    async open() { this.opened = true; }
    async sendReport(id, data) { sent.push([id, [...data]]); }
    async sendFeatureReport(id, data) { sent.push([id, [...data]]); }
    async receiveFeatureReport() { return new DataView(new Uint8Array([9, 1, 2]).buffer); }
  }
  const g = globalThis;
  g.HIDDevice = HIDDevice;
  g.window = g;
  Object.defineProperty(g, 'navigator', { value: { hid: { getDevices: async () => [] }, userAgent: 'test' }, configurable: true });
  assert.match(new Function(`return ${captureSnippet()}`)(), /installed/);
  const d = new HIDDevice();
  await d.open();
  g.mchoseCapture.mark('test');
  await d.sendReport(6, Uint8Array.of(0xaa, 0x01));
  const dv = await d.receiveFeatureReport(9);
  d.dispatchEvent(Object.assign(new Event('inputreport'), { reportId: 6, data: new DataView(Uint8Array.of(5).buffer) }));
  assert.deepEqual(sent, [[6, [0xaa, 0x01]]]);
  assert.equal(dv.getUint8(1), 1);
  const dirs = g.mchoseCapture.log.map((e) => e.dir);
  assert.deepEqual(dirs, ['device', 'mark', 'out', 'feature-in', 'in']);
  assert.equal(g.mchoseCapture.log[2].data, 'aa 01');
});
