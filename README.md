# 🎬 GameReels

Turn full-game Veo film into social clips — Reels, YouTube Shorts, and 16:9. **Best for lacrosse and soccer.**
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

## Two minutes: caption and share

Sample captions are synthetic. The gold **EXAMPLE** label stays on the caption bar, the clip, and the share sheet. GameReels does not upload them.

1. Start the app and open a game (about 15 seconds).
2. Mark a play with `I`, `O`, `C`, then `1`–`9` to label it — Goal, Draw Win, Dribble, and the other built-in labels (about 20 seconds).
3. Under the labels, choose **Lacrosse** or **Soccer**. Hold **Short** (100 characters or fewer), **Medium**, or **Hashtag pack**. Holding shows a preview and does not export (about 20 seconds).
4. Press **Apply** to keep that line on the clip. Apply still does not export or post (about 10 seconds).
5. Press **Share**. **Copy caption** copies the EXAMPLE line on this PC. **Open share intent** is a placeholder: Instagram and TikTok are not opened, and the sheet does not report an upload (about 30 seconds).
6. Press `E` when you want the MP4 in `clips/`. Export is the step that writes the video. It also writes a `.caption.txt` beside it, rebuilt from the preset, and it still does not share the file (about 25 seconds).

A label that is not one of the built-in play names stays off the sample caption (the line says "highlight" instead). Nothing in the sample copy is a roster name.

## The workflow

| Step | How |
|---|---|
| Scan the game | `Space` play, `L` cycles 1×/2×/4×/8×/16× (last speed is remembered), `J` back 10s, `Shift+←→` 1s |
| Found a play | `I` at the start, `O` at the end, `C` → clip created & auto-named |
| Fine trim | `←→` step one frame (33 ms); `,`/`.` nudge IN, `Shift+,`/`.` nudge OUT |
| Label it | `1`–`9` (Goal, Assist, Shot, Draw Win, Ground Ball, Dodge, Dribble, … — lacrosse and soccer defaults; edit the list in Settings) |
| Caption | Hold **Short**, **Medium**, or **Hashtag pack**, then **Apply**. The **EXAMPLE** label stays visible. Hold and Apply do not export or post. |
| Share | **Share** copies the caption or opens a placeholder. Nothing is uploaded. |
| Track the player | `T` → click their feet → video auto-advances → click again → `Esc` when done (`U` undoes) |
| Check it | ▶ Review on the clip — overlay preview plays live |
| Pick a format | top-bar selector: **16:9 · YouTube** (1920×1080) or **9:16 · Reels** (1080×1920) |
| Export | `E` (or Export per clip, or **Export All**) → MP4s land in `clips/YouTube/` or `clips/Reels/` by format |
| Reorder | ▲▼ on a clip (or `Alt+↑↓`) — sets the numbering used in export filenames |
| Compilation | **🎞 Compilation Builder** — all exported clips from every game: check, reorder with ▲▼, stitch |
| Transitions | builder dropdown: hard cut, crossfade, fade through black, slide, circle reveal (0.5 s) |
| Intro/Outro | builder cards: photo + kicker/title/subtitle text on a dark highlight card, 3.5 s each |

## Export formats

- **16:9 (YouTube)** — full Veo frame, 1920×1080. YouTube's recommended landscape spec.
- **9:16 (Instagram Reels)** — 1080×1920 vertical. The crop **auto-follows the tracked player** using
  the tracking anchors (with smooth camera-style panning); untracked clips center-crop.
  The same file works for YouTube Shorts and TikTok. In 9:16 mode a dashed guide on the
  player shows exactly what the crop will keep — **drag the video left/right** to shift the
  crop off the tracked player when the action is beside them (double-click to recenter;
  the shift is saved per clip).
- Vertical exports get a ` [9x16]` suffix, and exports are sorted into `clips/YouTube/`
  or `clips/Reels/` by format.
- Stitching same-format clips is lossless; mixing formats re-encodes with padding (the
  builder warns you — usually keep one format per compilation). Picking a transition or
  adding intro/outro cards always re-encodes (that's what blends the frames).
- Intro/outro cards: check the box in the builder, pick a photo, fill in the text
  (use `|` in the title for a line break). The card matches the compilation's shape —
  16:9 gets the left text panel, 9:16 gets the bottom-third layout. Text is remembered;
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
- `clips/YouTube/` and `clips/Reels/` — exported clips by format; stitched compilations land in `clips/`
- `projects/` — autosaved work (one JSON per game; safe to back up)

## Health check

`node test-captions.js` checks the three EXAMPLE presets, Hold versus Apply, and the share-intent placeholder (no server).
`node test-gates.js` checks that `invent_upload`, `auto_post`, and `share_external` stay **403** (it starts the server if needed).
`node test-export.js` (with the server running) round-trips a tracked export,
a plain cut, a caption sidecar, and a stitch against a synthetic test video; `node test-ui.js` drives the real UI
with Playwright, including hold, Apply, and the share sheet. Exports land in `clips/` or `clips/_test/` —
`_test` is hidden from the Compilation Builder — and the tests delete them when they finish.
