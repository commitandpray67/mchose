import test from 'node:test';
import assert from 'node:assert/strict';
import * as Ace from '../src/ace68/device.js';

test('Ace 68 variants are recognised by USB id', () => {
  assert.equal(Ace.modelFor({ vendorId: 0x41e4, productId: 0x2114 }).name, 'Ace 68');
  assert.equal(Ace.modelFor({ vendorId: 0x3837, productId: 0x3003 }).name, 'Ace 68');
  assert.equal(Ace.modelFor({ vendorId: 0x3837, productId: 0x3007 }).name, 'Ace 68 GT');
  assert.equal(Ace.modelFor({ vendorId: 0x3837, productId: 0x4021 }), null);
  assert.ok(Ace.HID_FILTERS.length >= 12);
});

test('parseHex accepts the usual spellings', () => {
  assert.deepEqual(Ace.parseHex('aa 07 0x1f, ff'), [0xaa, 0x07, 0x1f, 0xff]);
  assert.deepEqual(Ace.parseHex('aa070f'), [0xaa, 0x07, 0x0f]);
  assert.deepEqual(Ace.parseHex(''), []);
});

test('the Ace 60 settings interface (Generic Desktop, usage 0) counts as configuration', () => {
  const coll = (usagePage, usage) => ({ collections: [{ usagePage, usage }] });
  assert.ok(Ace.isVendorCollection(coll(0x0001, 0x0000)));
  assert.ok(Ace.isVendorCollection(coll(0xff00, 0x0001)));
  assert.ok(!Ace.isVendorCollection(coll(0x000c, 0x0001)));
});
