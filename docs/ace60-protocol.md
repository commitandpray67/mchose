# MCHOSE Ace 60 protocol (41e4:2101)

Worked out from [`captures/ace60-mhub-read.json`](../captures/ace60-mhub-read.json), a recording of MCHOSE's M HUB
web driver connecting to a real Ace 60 (it reports itself as `Ace 60`, USB `41e4:2101`, a Sinowealth controller).
All 183 recorded keyboard frames match the frame and checksum below.

A second recording, [`captures/ace60-mhub-changes.json`](../captures/ace60-mhub-changes.json), has M HUB changing
settings. The capture script didn't see M HUB's outgoing write requests, but the keyboard echoes each write back
whole (`0xaa` in place of `0x55`; checked against M HUB's own `0xf2` storage writes, where both directions were
recorded). So the echoes show exactly what was written.

## Interface

One HID collection: usage page `0x0001` (Generic Desktop), usage `0x0000`, unnumbered report `0`, 64 bytes in and
out. Requests go out with `sendReport(0, frame)`, and replies come back as input reports.

## Frame

| Byte | Request | Reply |
| --- | --- | --- |
| 0 | `0x55` | `0xaa` |
| 1 | command | command (echo) |
| 2 | `0` | `0` |
| 3 | checksum: sum of bytes 4..63, low 8 bits | same |
| 4 | length to read (at most 56) | length returned |
| 5..6 | offset into the block, little-endian | echo |
| 7 | `0` | `0` |
| 8..63 | zero for reads | data |

A reply's offset echoes the request's. Its length can be shorter than the length asked for (the info reply is 22
bytes).

## Read commands

| Cmd | Block | What it holds |
| --- | --- | --- |
| `0x03` | one frame | u16 `0x0120` (firmware version?), then the build date as ASCII: `Jan 10 2026,14:58:22` |
| `0x04` | one frame | active profile (0-based), profile count (3), then the profile ids |
| `0x05` | 64 bytes | general settings, not decoded yet: `00 00 aa bb 04 00 00 06 05 28 00 00 01 00 ff 00`, 16 zero bytes, then 32 × `10` |
| `0x08` | 4 layers at `0x000`, `0x200`, `0x400`, `0x600` | key map, 128 slots × 3 bytes per layer |
| `0xa0` | 1024 bytes | magnetic switch settings, 128 slots × 8 bytes |
| `0x0c` | 4096 bytes | all zero here; probably macros |
| `0xf1` | | storage M HUB keeps for itself: JSON such as `["i18n<defaultOnboard>", ...]` (profile names) and `<light@v2>…` (lighting UI state) |
| `0xa9` | | sent unprompted by the keyboard (`01 01`) |

M HUB reads each block in 56-byte chunks from the start (64 → 56 + 8). Each key map layer is read separately as
384 bytes (56 × 6 + 48).

`0xf2` writes M HUB's own storage. The recording has M HUB rewriting a `[0, <timestamp>, "<id>"]` entry at offset
`0x268`. That's app bookkeeping, not a keyboard setting.

## Key map entries

Each entry is `[type, arg, code]`:

| Type | Meaning | Example |
| --- | --- | --- |
| `0x00` | unused slot | `00 00 00` |
| `0x10` | keyboard: `arg` = modifier mask (Ctrl, Shift, Alt, Win, then the right-hand ones), `code` = HID usage | `10 00 29` Esc, `10 02 00` Shift |
| `0x30` | consumer/media: `arg` = usage | `30 cd 00` play/pause |
| `0xf0` | keyboard function: `arg` selects it | `f0 ff 01` Fn (to layer 1), `f0 ff 03` Fn on the Mac layer |

Slots past the matrix read `f0 f0 f0` or `ff ff ff`. Layer 0 is Windows, layer 1 is Windows Fn, layer 2 is Mac (Alt
and Win swapped), and layer 3 is Mac Fn. 61 slots are used, which matches the Ace 60's 61 keys.

## Write commands

A write is the read command + 1. The frame has the same layout, with the data in bytes 8..63, always 56 bytes.
The keyboard echoes it, and M HUB then re-reads the block.

| Cmd | Writes | How M HUB chunks it |
| --- | --- | --- |
| `0x09` | key map | 57 bytes from the changed key's entry, as two frames one byte apart (A, slot 37 → offsets `0x6f`, `0x70`) |
| `0xa1` | magnetic switches | one 56-byte frame starting at each changed key, skipping keys already covered by the previous frame |
| `0x06` | general settings | the whole 64 bytes, as frames at `0x00` and `0x08` |
| `0xa5` / `0xa4` | Snap Tap (SOCD) pairs | `10 00 04 10 00 07 10 00 07 10 00 04` for A ↔ D; not decoded further |

The app's actuation and remap writes are checked in `tests/ace60.test.js` to be byte-identical to the recorded frames.

## Magnetic switch entries

8 bytes per slot:

| Bytes | Meaning |
| --- | --- |
| 4-5 and 6-7 | **actuation point**, u16, 0.1 mm steps. M HUB writes the same value to both. Factory 14 (1.4 mm); the recording set Esc/W/A/S/D to 12, 5 and 13, then back to 14. |
| 1 | 1 normally. An unlabelled change set it to 2 on several keys, probably rapid trigger. |
| 0, 2-3 | `0xa0` and 74, never changed |

## Key map entry types seen in the second recording

| Entry | Meaning |
| --- | --- |
| `20 01 00`, `20 02 00` | mouse left / right click (A and D were remapped to them) |
| `93 00 27` / `93 01 25` | Snap Tap: A (slot 37) paired with slot `0x27` = 39 (D), and D with slot `0x25` = 37 (A). `94` is another Snap Tap mode. |

The general settings block changed at byte 1 (`00`→`02`), byte 6 (`00`→`01`) and byte 7 (`06`→`07`/`e6`/`02`), all
unlabelled.



## Next recording needed

Each change after its own `mark`, so it can be matched to the bytes:

- rapid trigger on, then off (to confirm switch byte 1)
- rapid trigger press sensitivity, then release sensitivity
- each general setting M HUB has (polling rate, Win lock, etc.), one at a time
- one lighting change (effect, brightness, colour)
- Snap Tap on for A/D, then off
