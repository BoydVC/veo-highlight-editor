# 🥍 Charlotte Clips

Personal highlight-clip editor for full-game Veo film (lacrosse / soccer). Keyboard-first
clipping, hotkey labels, click-to-track player badge overlays, one-button export and stitching.
See `PLAN.md` for the design.

## Start it

```
npm install        (first time only — also downloads a bundled ffmpeg, nothing to install)
npm start
```

Then open **http://localhost:4242** in your browser (Chrome/Edge).

1. Copy game files into the `games/` folder (Veo MP4 downloads work as-is), hit **⟳**.
2. Pick the game from the dropdown.
3. Open **⚙ Badge & Settings** once to set Charlotte's name/number/colors.

## The workflow

| Step | How |
|---|---|
| Scan the game | `Space` play, `L` cycles 1×/2×/4×/8×, `J` back 10s, `Shift+←→` 1s |
| Found a play | `I` at the start, `O` at the end, `C` → clip created & auto-named |
| Fine trim | `←→` step one frame (33 ms); `,`/`.` nudge IN, `Shift+,`/`.` nudge OUT |
| Label it | `1`–`9` (Goal, Assist, Shot, Draw Win, … — edit the list in Settings) |
| Track Charlotte | `T` → click her feet → video auto-advances → click again → `Esc` when done (`U` undoes) |
| Check it | ▶ Review on the clip — overlay preview plays live |
| Pick a format | top-bar selector: **16:9 · YouTube** (1920×1080) or **9:16 · Reels** (1080×1920) |
| Export | `E` (or Export per clip, or **Export All**) → MP4s land in `clips/YouTube/` or `clips/Reels/` by format |
| Reorder | ▲▼ on a clip (or `Alt+↑↓`) — sets the numbering used in export filenames |
| Compilation | **🎞 Compilation Builder** — all exported clips from every game: check, reorder with ▲▼, stitch |
| Transitions | builder dropdown: hard cut, crossfade, fade through black, slide, circle reveal (0.5 s) |
| Intro/Outro | builder cards: photo + kicker/title/subtitle text in the navy-and-gold highlight style, 3.5 s each |

## Export formats

- **16:9 (YouTube)** — full Veo frame, 1920×1080. YouTube's recommended landscape spec.
- **9:16 (Instagram Reels)** — 1080×1920 vertical. The crop **auto-follows Charlotte** using
  the tracking anchors (with smooth camera-style panning); untracked clips center-crop.
  The same file works for YouTube Shorts and TikTok. In 9:16 mode a dashed guide on the
  player shows exactly what the crop will keep — **drag the video left/right** to shift the
  crop off the tracked player when the action is beside her (double-click to recenter;
  the shift is saved per clip).
- Vertical exports get a ` [9x16]` suffix, and exports are sorted into `clips/YouTube/`
  or `clips/Reels/` by format.
- Stitching same-format clips is lossless; mixing formats re-encodes with padding (the
  builder warns you — usually keep one format per compilation). Picking a transition or
  adding intro/outro cards always re-encodes (that's what blends the frames).
- Intro/outro cards: check the box in the builder, pick a photo, fill in the text
  (use `|` in the title for a line break). The card matches the compilation's shape —
  16:9 gets the left navy panel, 9:16 gets the bottom-third layout. Text is remembered;
  re-pick the photo each session.

Everything autosaves per game into `projects/` — close the browser, come back later,
your clips and tracking are still there.

## Tracking tips

- Default anchor spacing is **15 frames (~0.5 s)** — smooth for normal play.
  Drop to 5–10 for dodges/draws/quick cuts, 30 for slow build-ups.
- Click her **feet** — the circle sits there and the name badge hangs just below it.
- If she's briefly hidden behind another player, press `→` to skip ahead without clicking.

## Folders

- `games/` — put full-game video files here
- `clips/YouTube/` and `clips/Reels/` — exported clips by format; stitched compilations land in `clips/`
- `projects/` — autosaved work (one JSON per game; safe to back up)

## Health check

`node test-export.js` (with the server running) round-trips a tracked export,
a plain cut, and a stitch against a synthetic test video.
