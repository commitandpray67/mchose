// MCHOSE Ace keyboards (Ace 68 and Ace 60 families): detection and a raw
// HID session.
//
// The Ace boards are MCHOSE's magnetic (Hall-effect) keyboards. Their
// configuration protocol has not been published anywhere, so this module does
// not guess at commands: it identifies the keyboard, lists its HID
// collections, logs every input report it sends, and lets you send reports by
// hand. Pair it with src/capture.js to record what the official web
// driver sends, which is what a real driver gets built from.
//
// USB ids from M HUB's device catalog (via github.com/brayanspagnol/OpenMHub).
import { dataViewBytes } from '../hid.js';

export const MODELS = [
  { name: 'Ace 68', ids: [[0x41e4, 0x2114], [0x41e4, 0x2115], [0x41e4, 0x2116], [0x41e4, 0x2117], [0x3837, 0x3003], [0x3837, 0x302a]] },
  { name: 'Ace 68 V2', ids: [[0x3837, 0x3024], [0x3837, 0x3025]] },
  { name: 'Ace 68 Turbo', ids: [[0x3837, 0x3026], [0x3837, 0x3027], [0x3837, 0x3028], [0x3837, 0x3029]] },
  { name: 'Ace 68 GT', ids: [[0x3837, 0x3007], [0x3837, 0x3009]] },
  { name: 'Ace 60', ids: [[0x41e4, 0x2101], [0x41e4, 0x2102], [0x19f5, 0xfc30], [0x19f5, 0xff1b]] },
  { name: 'Ace 60 Pro', ids: [[0x41e4, 0x2103], [0x41e4, 0x2104], [0x19f5, 0xfc31], [0x19f5, 0xff0f]] },
  { name: 'Ace 60X', ids: [[0x41e4, 0x2126], [0x41e4, 0x2127], [0x41e4, 0x2112], [0x41e4, 0x2113]] },
];

// Every MCHOSE vendor id, so a variant with a product id missing from the
// table above still shows up in the picker.
export const VENDOR_IDS = [0x3837, 0x41e4, 0x5253, 0x19f5];
export const HID_FILTERS = [
  ...MODELS.flatMap((m) => m.ids.map(([vendorId, productId]) => ({ vendorId, productId }))),
  ...VENDOR_IDS.map((vendorId) => ({ vendorId })),
];

export function modelFor(device) {
  return MODELS.find((m) => m.ids.some(([v, p]) => v === device.vendorId && p === device.productId)) || null;
}

export const isAce68 = (device) => modelFor(device) !== null;

// Configuration lives on a vendor-defined usage page (>= 0xff00), or, on the
// Sinowealth-based Ace 60 (41e4:2101), on Generic Desktop with an undefined
// usage (0x0001 / 0x0000) carrying unnumbered report 0.
const isConfigCollection = (c) => c.usagePage >= 0xff00 || (c.usagePage === 0x0001 && c.usage === 0x0000);
export function isVendorCollection(device) {
  return (device.collections || []).some(isConfigCollection);
}

// One keyboard shows up as several HIDDevice objects, one per USB interface
// (typing, media keys, vendor configuration...). Open all of them so no
// report is missed; sends go to the interface that declares the report id.
export class RawSession {
  constructor(devices, { onReport = () => {} } = {}) {
    this.devices = [].concat(devices);
    this.device = this.devices[0];
    this.onReport = onReport;
    this.handlers = new Map();
  }

  async open() {
    for (const d of this.devices) {
      if (!d.opened) await d.open();
      const h = (e) => this.onReport({ dir: 'in', reportId: e.reportId, bytes: dataViewBytes(e.data) });
      d.addEventListener('inputreport', h);
      this.handlers.set(d, h);
    }
  }

  async close() {
    for (const d of this.devices) {
      d.removeEventListener('inputreport', this.handlers.get(d));
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
    await this.target('outputReports', reportId).sendReport(reportId, Uint8Array.from(bytes));
    this.onReport({ dir: 'out', reportId, bytes: Uint8Array.from(bytes) });
  }

  async sendFeature(reportId, bytes) {
    await this.target('featureReports', reportId).sendFeatureReport(reportId, Uint8Array.from(bytes));
    this.onReport({ dir: 'feature-out', reportId, bytes: Uint8Array.from(bytes) });
  }

  async readFeature(reportId) {
    const bytes = dataViewBytes(await this.target('featureReports', reportId).receiveFeatureReport(reportId));
    this.onReport({ dir: 'feature-in', reportId, bytes });
    return bytes;
  }
}

export function parseHex(text) {
  const clean = text.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, ' ').trim();
  if (!clean) return [];
  return clean.split(/\s+/).flatMap((tok) => {
    if (tok.length % 2) tok = `0${tok}`;
    return tok.match(/../g).map((h) => parseInt(h, 16));
  });
}
