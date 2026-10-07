// HID keyboard usage ids (USB HID Usage Tables, page 0x07) for button bindings.
const letters = Array.from({ length: 26 }, (_, i) => [String.fromCharCode(65 + i), 0x04 + i]);
const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d, i) => [d, 0x1e + i]);
const fkeys = Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 0x3a + i]);

export const KEYS = [
  ...letters,
  ...digits,
  ...fkeys,
  ['Enter', 0x28], ['Esc', 0x29], ['Backspace', 0x2a], ['Tab', 0x2b], ['Space', 0x2c],
  ['-', 0x2d], ['=', 0x2e], ['[', 0x2f], [']', 0x30], ['\\', 0x31], [';', 0x33], ["'", 0x34], ['`', 0x35],
  [',', 0x36], ['.', 0x37], ['/', 0x38], ['Caps Lock', 0x39], ['Print Screen', 0x46], ['Scroll Lock', 0x47],
  ['Pause', 0x48], ['Insert', 0x49], ['Home', 0x4a], ['Page Up', 0x4b], ['Delete', 0x4c], ['End', 0x4d],
  ['Page Down', 0x4e], ['Right', 0x4f], ['Left', 0x50], ['Down', 0x51], ['Up', 0x52],
  ['F13', 0x68], ['F14', 0x69], ['F15', 0x6a], ['F16', 0x6b], ['F17', 0x6c], ['F18', 0x6d],
  ['F19', 0x6e], ['F20', 0x6f], ['F21', 0x70], ['F22', 0x71], ['F23', 0x72], ['F24', 0x73],
].map(([label, usage]) => ({ label, usage }));

export const keyLabel = (usage) => KEYS.find((k) => k.usage === usage)?.label ?? `0x${usage.toString(16)}`;
