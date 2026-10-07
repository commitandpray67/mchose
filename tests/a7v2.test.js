import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/a7v2/protocol.js';
import { A7V2, isA7V2 } from '../src/a7v2/driver.js';
import { SerialQueue } from '../src/hid.js';
import { FakeA7V2, defaultConfig } from './fake-a7v2.js';

const fastQueue = () => new SerialQueue(0);

test('requests are inverted and padded to the report length', () => {
  const f = P.encodeRequest(P.SHORT, P.CMD.status);
  assert.equal(f.length, 20);
  assert.equal(f[0], 0x06 ^ 0xff);
  assert.ok(f.slice(1).every((b) => b === 0xff));
  const g = P.encodeRequest(P.LONG, P.CMD.profileName, [2]);
  assert.equal(g.length, 64);
  assert.deepEqual([...g.slice(0, 3)], [0x97, 0xfd, 0xff]);
});

test('replies decode with or without the leading report id', () => {
  const withId = [0x11, 0x06 ^ 0xff, 0x37 ^ 0xff, ...new Array(18).fill(0xff)];
  assert.deepEqual(P.decodeReply(0x11, withId).cmd, 0x06);
  assert.equal(P.decodeReply(0x11, withId).payload[0], 0x37);
  const bare = withId.slice(1);
  assert.equal(P.decodeReply(0x11, bare).cmd, 0x06);
  assert.equal(P.decodeReply(0x11, new Array(21).fill(0)), null);
});

test('config blob round-trips the documented capture', () => {
  // Captured from an A7 V2 Ultra+ on its receiver (1000 Hz wireless, 1600 DPI).
  const head = [0x00, 0x30, 0x20, 0x00, 0x40, 0x06, 0x20, 0x03, 0x40, 0x06, 0x80, 0x0c, 0x00, 0x19, 0x10, 0xa4, 0x01, 0x80, 0x00, 0x00];
  const p = new Uint8Array(63);
  p.set(head);
  const c = P.parseConfig(p);
  assert.deepEqual(c.dpi, [1600, 800, 1600, 3200, 6400, 42000]);
  assert.deepEqual(c.wired, { rate: 3, stage: 0 });
  assert.deepEqual(c.wireless, { rate: 2, stage: 0 });
  assert.equal(c.stageCount, 1);
  assert.equal(c.perfMode, 2);
  assert.equal(c.lod, 0);
});

test('buildConfig only touches the requested fields', () => {
  const raw = defaultConfig();
  raw[3] = 0x02;
  const out = P.buildConfig(raw, { wireless: { rate: 1 }, dpi: [null, 900], debounce: 8 });
  const diff = [...out].map((b, i) => (b !== raw[i] ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(diff, [2, 6, 18]);
  assert.equal(out[2], 0x10);
  assert.throws(() => P.buildConfig(raw, { dpi: [10] }));
  assert.throws(() => P.buildConfig(new Uint8Array(63), {}), /not valid/);
});

test('performance args use 1 = on, 2 = off, 0 = leave', () => {
  assert.deepEqual(P.performanceArgs({ lod: 1, motionSync: true }), [1, 0, 0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(P.performanceArgs({ lod: 0, ripple: false, perfMode: 3, angle: -15 }), [0, 2, 0, 0, 0, 0, 3, 1, 0xf1]);
  assert.throws(() => P.performanceArgs({ lod: 0, angle: 31 }));
});

test('button args are big-endian and normalise default/disabled', () => {
  assert.deepEqual(P.buttonArgs(3, P.BTN.keyboard, P.keyValue(0x06, P.MODIFIERS.ctrl)), [3, 0, 2, 0x01, 0x06, 0x00]);
  assert.deepEqual(P.buttonArgs(4, P.BTN.disabled, 0), [4, 0, 9, 0xff, 0xff, 0xff]);
  assert.deepEqual(P.buttonArgs(0, P.BTN.default, 123), [0, 0, 0, 0, 0, 0]);
});

test('identify picks the model from the mouse pid and the link from the host pid', () => {
  assert.equal(P.identify(0x100b, 0x4021).name, 'A7 V2 Ultra+');
  assert.equal(P.identify(0x100b, 0x4021).link, 'receiver');
  assert.equal(P.identify(0x4018, 0x4018).link, 'wired');
  assert.equal(P.identify(0x100a, 0x4019).maxRateIndex, 2);
  assert.equal(P.identify(0x100b, 0x9999).name, 'A7 V2');
});

test('the V3 generation and non-config interfaces are rejected', () => {
  const d = new FakeA7V2();
  assert.ok(isA7V2(d));
  assert.ok(!isA7V2(Object.assign(new FakeA7V2(), { productId: 0x1014 })));
  const noFeature = new FakeA7V2();
  noFeature.collections = noFeature.collections.slice(0, 1);
  assert.ok(!isA7V2(noFeature));
});

test('driver loads identity and config through the shared reply buffer', async () => {
  const dev = new FakeA7V2();
  const m = new A7V2(dev, { queue: fastQueue() });
  await m.open();
  const { info, config } = await m.load();
  assert.equal(info.name, 'A7 V2 Ultra+');
  assert.equal(info.firmware, '5.46.2.4');
  assert.equal(info.status.battery, 87);
  assert.deepEqual(config.dpi, [1600, 800, 1600, 3200, 6400, 42000]);
  assert.equal(await m.readProfileName(1), 'Config 2');
});

test('driver writes settings and confirms them by reading back', async () => {
  const dev = new FakeA7V2();
  const m = new A7V2(dev, { queue: fastQueue() });
  await m.load();

  await m.setDpi([400, 800, 1200, 2400, 4800, 26000], 3);
  assert.deepEqual(m.config.dpi, [400, 800, 1200, 2400, 4800, 26000]);
  assert.equal(m.config.stageCount, 3);

  await m.setPollingRate(5);
  assert.equal(dev.config[2] >> 4, 5, 'receiver link writes the wireless byte');
  assert.equal(dev.config[1], 0x30, 'wired byte untouched');

  await m.setActiveStage(2);
  assert.equal(m.config.wireless.stage, 2);

  await m.setDebounce(8);
  assert.equal(dev.config[18], 8);

  await m.setPerformance({ motionSync: true });
  assert.equal(m.config.motionSync, true);
  await m.setPerformance({ lod: 2, perfMode: 3, angle: -5 });
  assert.equal(m.config.lod, 2);
  assert.equal(m.config.perfMode, 3);
  assert.equal(m.config.angle, -5);
  assert.equal(m.config.motionSync, true, 'other toggles survive');

  await m.setSleep(9);
  assert.equal(m.config.sleep, 9);

  await m.setButton(3, P.BTN.media, 0xcd0000);
  assert.deepEqual(m.config.buttons[3], { type: P.BTN.media, value: 0xcd0000 });
  assert.deepEqual(m.config.buttons[4], { type: P.BTN.keyboard, value: 0x004300 }, 'other buttons survive');

  await m.setProfile(2);
  assert.equal(m.config.profile, 2);
  assert.deepEqual(m.config.dpi, [1600, 800, 1600, 3200, 6400, 42000], 'profile 2 has its own stages');
});

test('on the cable the wired byte is the live one', async () => {
  const dev = new FakeA7V2({ productId: 0x4021 });
  const m = new A7V2(dev, { queue: fastQueue() });
  await m.load();
  assert.equal(m.info.link, 'wired');
  await m.setPollingRate(1);
  assert.equal(dev.config[1] >> 4, 1);
  assert.equal(dev.config[2], 0x20);
});

test('bluetooth refuses rates above 1000 Hz', async () => {
  const m = new A7V2(new FakeA7V2({ productId: 0x100a }), { queue: fastQueue() });
  await m.load();
  assert.throws(() => m.setPollingRate(3), /not available/);
});

test('a dropped config request is re-sent', async () => {
  const dev = new FakeA7V2({ dropConfigReads: 3 });
  const m = new A7V2(dev, { queue: fastQueue() });
  await m.load();
  assert.equal(m.config.dpi[0], 1600);
  assert.ok(dev.sent.filter((s) => s.cmd === P.CMD.configRead).length >= 4);
});

test('a wedged config channel is recovered by re-selecting a profile', async () => {
  const dev = new FakeA7V2({ wedged: true });
  const m = new A7V2(dev, { queue: fastQueue() });
  await m.load();
  assert.equal(m.recovered, true);
  assert.equal(m.config.dpi[0], 1600);
});

test('report lengths come from the descriptor when it declares them', async () => {
  const dev = new FakeA7V2();
  dev.collections[1].featureReports = [
    { reportId: 0x11, items: [{ reportSize: 8, reportCount: 20 }] },
    { reportId: 0x12, items: [{ reportSize: 8, reportCount: 64 }] },
  ];
  const m = new A7V2(dev, { queue: fastQueue() });
  assert.equal(m.reportLength(0x11), 20);
  assert.equal(m.reportLength(0x12), 64);
  await m.load();
  assert.equal(m.config.profile, 0);
});

test('a reply without the leading report id still decodes', () => {
  const r = P.decodeReply(0x12, [0x67 ^ 0xff, 0x01 ^ 0xff, ...new Array(62).fill(0xff)]);
  assert.equal(r.cmd, 0x67);
  assert.equal(r.payload[0], 1);
});

test('profile names decode as UTF-8', () => {
  const name = [...new TextEncoder().encode('默认配置1')];
  assert.equal(P.parseProfileName([0, ...name, 0, 0x41]), '默认配置1');
});
