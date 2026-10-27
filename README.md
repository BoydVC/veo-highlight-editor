# 🎬 GameReels

Turn full-game Veo film into social clips — vertical Reels, square feed posts, and 16:9 YouTube. **Best for lacrosse and soccer.**
Keyboard-first clipping, hotkey labels, click-to-track player badge overlays, one-button export and stitching.
See `PLAN.md` for the design.

## Start it

```
npm install        (first time only — also downloads a bundled ffmpeg, nothing to install)
npm start
```

Then open **http://localhost:4242** in your browser (Chrome/Edge). On Windows, `Start GameReels.bat`
does both: it opens the browser and starts the server.

1. Copy game files into the `games/` folder (Veo MP4 downloads work as-is), hit **⟳**.
2. Pick the game from the dropdown.
3. Open **Badge & Settings** once and fill in the player's name, number, and colors. Name and number start blank (`Player` / `#00` are placeholders).

## The workflow

| Step | How |
|---|---|
| Scan the game | `Space` play, `L` cycles 1×/2×/4×/8×/16× (last speed is remembered), `J` back 10s, `Shift+←→` 1s |
| Found a play | `I` at the start, `O` at the end, `C` → clip created & auto-named |
| Fine trim | `←→` step one frame (33 ms); `,`/`.` nudge IN, `Shift+,`/`.` nudge OUT |
| Label it | `1`–`9` (Goal, Assist, Shot, Draw Win, Ground Ball, Dodge, Dribble, … — lacrosse and soccer defaults; edit the list in Settings) |
| Track the player | `T` → click their feet → video auto-advances → click again → `Esc` when done (`U` undoes) |
| Check it | ▶ Review on the clip — overlay preview plays live |
| Pick a preset | **Social presets** bar: hold **9:16 Vertical**, **1:1 Square**, or **16:9 Landscape** to preview the crop. **Apply** commits that shape for the next export. Hold and Apply do not post or share. |
| Export | `E` (or Export per clip, or **Export All**) writes an MP4 on this PC into `clips/Reels/`, `clips/Square/`, or `clips/YouTube/`. Nothing is posted. |
| Reorder | ▲▼ on a clip (or `Alt+↑↓`) — sets the numbering used in export filenames |
| Compilation | **🎞 Compilation Builder** — all exported clips from every game: check, reorder with ▲▼, stitch |
| Transitions | builder dropdown: hard cut, crossfade, fade through black, slide, circle reveal (0.5 s) |
| Intro/Outro | builder cards: photo + kicker/title/subtitle text on a dark highlight card, 3.5 s each |

## Social export presets

Preview a shape, then **Apply**. The dashed guide is only a preview until you Apply.
Export uses the applied preset and writes a file on this PC. GameReels does not post,
share, or invent footage — every frame comes from the game video you already have.

- **9:16 Vertical** — 1080×1920, for lacrosse and soccer highlights on Instagram Reels,
  YouTube Shorts, and TikTok. The crop **auto-follows the tracked player** (smooth
  camera-style panning). Untracked clips center-crop. Files land in `clips/Reels/`
  with a ` [9x16]` suffix.
- **1:1 Square** — 1080×1080, for Instagram and Facebook feed posts. On typical Veo
  16:9 film the square uses the full frame height and crops the sides, following the
  tracked player the same way. Files land in `clips/Square/` with a ` [1x1]` suffix.
- **16:9 Landscape** — the full Veo frame, usually 1920×1080, for YouTube. No crop.
  Files land in `clips/YouTube/`.

In 9:16 or 1:1, a dashed guide shows what the crop will keep. **Drag the video left/right**
to shift it off the tracked player when the action is beside them (double-click to recenter;
the shift is saved per clip). Holding a preset does not export. Apply does not export.
Only Export, Export All, or `E` writes a file, and only in the shape you Applied.

- Stitching same-shape clips is lossless; mixing shapes re-encodes with padding (the
  builder warns you — usually keep one preset per compilation). Picking a transition or
  adding intro/outro cards always re-encodes (that's what blends the frames).
- Intro/outro cards: check the box in the builder, pick a photo, fill in the text
  (use `|` in the title for a line break). The card matches the compilation's shape —
  16:9 and 1:1 get the left text panel, 9:16 gets the bottom-third layout. Text is remembered;
  re-pick the photo each session.

Everything autosaves per game into `projects/` — close the browser, come back later,
your clips and tracking are still there. The previous save is kept as `.json.bak`, and a damaged
project file is restored from it automatically.

The server only answers on this PC (`127.0.0.1`) and only plays videos from `games/`, so other
devices on your network can't reach it.

## Tracking tips

- **Leave spacing at 15 frames (~0.5 s).** Measured on 39 real clips: the spline through
  15-frame clicks lands within ~3 px (p95 ≈ 10 px) of 5-frame clicks — the badge ring is ~90 px
  wide, so it's visually identical at a third of the clicks. Use **30 frames (~1 s)** on straight
  runs (≈5× fewer clicks, p95 ≈ 15 px); drop to **10** only for dodges and draw scrambles.
  Check your own footage anytime: `node tools/spacing-report.js`.
- Click the player's **feet** — the circle sits there and the name badge hangs just below it.
- If the player is briefly hidden behind someone else, press `→` to skip ahead without clicking.

## Folders

- `games/` — put full-game video files here
- `clips/YouTube/`, `clips/Reels/`, and `clips/Square/` — exported clips by preset; stitched compilations land in `clips/`
- `projects/` — autosaved work (one JSON per game; safe to back up)

## Health check

`node test-presets.js` checks preset labels plus Hold/Apply (no server needed).
`node test-export.js` (with the server running) round-trips a tracked export,
a plain cut, a 9:16 export, a 1:1 export, and a stitch against a synthetic test video;
`node test-ui.js` drives the real UI with Playwright, including preset hold and Apply.
Export tests write their outputs to `clips/_test/` — hidden from the Compilation
Builder — and delete them when they finish.
