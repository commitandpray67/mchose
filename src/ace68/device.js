// MCHOSE Ace 68 family: detection and a raw HID session.
//
// The Ace boards are MCHOSE's magnetic (Hall-effect) keyboards. Their
// configuration protocol has not been published anywhere, so this module does
// not guess at commands: it identifies the keyboard, lists its HID
// collections, logs every input report it sends, and lets you send reports by
// hand. Pair it with tools/capture-mhub.js to record what the official web
// driver sends, which is what a real driver gets built from.
//
// USB ids from M HUB's device catalog (via github.com/brayanspagnol/OpenMHub).
import { dataViewBytes } from '../hid.js';

export const MODELS = [
  { name: 'Ace 68', ids: [[0x41e4, 0x2114], [0x41e4, 0x2115], [0x41e4, 0x2116], [0x41e4, 0x2117], [0x3837, 0x3003], [0x3837, 0x302a]] },
  { name: 'Ace 68 V2', ids: [[0x3837, 0x3024], [0x3837, 0x3025]] },
  { name: 'Ace 68 Turbo', ids: [[0x3837, 0x3026], [0x3837, 0x3027], [0x3837, 0x3028], [0x3837, 0x3029]] },
  { name: 'Ace 68 GT', ids: [[0x3837, 0x3007], [0x3837, 0x3009]] },
];

// Every MCHOSE vendor id, so a variant with a product id missing from the
// table above still shows up in the picker.
export const VENDOR_IDS = [0x3837, 0x41e4, 0x5253];
export const HID_FILTERS = [
  ...MODELS.flatMap((m) => m.ids.map(([vendorId, productId]) => ({ vendorId, productId }))),
  ...VENDOR_IDS.map((vendorId) => ({ vendorId })),
];

export function modelFor(device) {
  return MODELS.find((m) => m.ids.some(([v, p]) => v === device.vendorId && p === device.productId)) || null;
}

export const isAce68 = (device) => modelFor(device) !== null;

// Vendor-defined usage pages are >= 0xff00; that is where configuration lives.
export function isVendorCollection(device) {
  return (device.collections || []).some((c) => c.usagePage >= 0xff00);
}

export class RawSession {
  constructor(device, { onReport = () => {} } = {}) {
    this.device = device;
    this.onReport = onReport;
    this.handler = (e) => this.onReport({ dir: 'in', reportId: e.reportId, bytes: dataViewBytes(e.data) });
  }

  async open() {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener('inputreport', this.handler);
  }

  async close() {
    this.device.removeEventListener('inputreport', this.handler);
    if (this.device.opened) await this.device.close();
  }

  async sendOutput(reportId, bytes) {
    await this.device.sendReport(reportId, Uint8Array.from(bytes));
    this.onReport({ dir: 'out', reportId, bytes: Uint8Array.from(bytes) });
  }

  async sendFeature(reportId, bytes) {
    await this.device.sendFeatureReport(reportId, Uint8Array.from(bytes));
    this.onReport({ dir: 'feature-out', reportId, bytes: Uint8Array.from(bytes) });
  }

  async readFeature(reportId) {
    const bytes = dataViewBytes(await this.device.receiveFeatureReport(reportId));
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
