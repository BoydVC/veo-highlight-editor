# Charlotte Clips — Sports Highlight Editor (Plan)

A personal, local web app for turning full-game Veo film (lacrosse / soccer) into labeled,
player-tracked highlight clips — fast, with keyboard-first workflow and none of the
learning curve of a full NLE.

## The core workflow it's built around

1. **Scan** the full game with fast playback + big jumps (keyboard only).
2. When you spot a play: mark **In** (`I`), mark **Out** (`O`), press **`C`** → clip created and auto-named.
3. Tap a number key (`1`–`9`) to slap a **label** on it (Goal / Assist / Draw Win / …).
4. (Optional, anytime later) press **`T`** to **track Charlotte** through the clip:
   click her feet → the video auto-advances N frames → click again. One click per anchor.
5. **Export** the clip (or all clips) — the label banner, name/number badge, and foot circle
   are burned in by ffmpeg. **Stitch** exports into one compilation file when done.

## Architecture

```
Browser (vanilla JS, no build step)          Node.js server (Express)
┌─────────────────────────────────┐          ┌──────────────────────────────┐
│ <video> + <canvas> overlay      │  range   │ Video streaming (any local   │
│  - frame stepping, ms timecode  │ ◄──────► │  file, HTTP range requests)  │
│  - zoomable timeline canvas     │  fetch   │ ffprobe (fps/duration/size)  │
│  - clip list / labels / hotkeys │ ◄──────► │ Project JSON persistence     │
│  - tracking click-to-anchor     │          │ ffmpeg export:               │
│  - live overlay preview         │          │  frame-accurate cut +        │
│  - renders badge/circle/label   │          │  sendcmd per-frame overlay   │
│    PNGs on canvas → sent to     │          │  motion + label banner       │
│    server at export time        │          │ concat stitcher              │
└─────────────────────────────────┘          └──────────────────────────────┘
```

**Why a local web app (not a hosted site):** game files are multi-GB and live on this PC;
the browser `<video>` element + a local Node server gives instant scrubbing with zero upload,
and ffmpeg runs at full local speed. `ffmpeg-static` bundles the binary — nothing to install.

## Key design decisions

### Millisecond trimming
At Veo's 30 fps, one frame = 33 ms — that *is* the millisecond-level unit that matters
(you can't cut between frames). So trimming precision = **frame stepping** (`←`/`→`),
plus frame-nudge keys for the selected clip's in/out points (`,`/`.` and `Shift+,`/`Shift+.`),
a zoomable timeline (mouse wheel) down to per-frame resolution, and `HH:MM:SS.mmm` timecode.
Exports re-encode (libx264 CRF 18) so cuts are **frame-accurate**, not keyframe-snapped.

### Tracking: how many frames per anchor?
Default **15 frames (~0.5 s at 30 fps)** with Catmull-Rom spline smoothing between anchors.
That's the sweet spot for run-of-play movement on zoomed-out Veo footage: a 10-second clip
is ~20 clicks, and the spline hides the gaps. Selectable 5 / 10 / 15 / 30 in settings —
drop to 8–10 for sharp direction changes (dodges, draws), 30 for slow off-ball stretches.
Crucially, the mode is **click-to-advance**: each click places the anchor *and* advances
the video, so it's literally one click per anchor — no extra keypress. `→` skips ahead
without placing (player briefly obscured), `U` undoes the last anchor, `Esc` finishes.

#### Measured (Sept 2026)
Four real games (39 clips, ~2,550 anchors) had all been tracked at **5-frame** spacing out of
caution. `tools/spacing-report.js` thins those clicks and re-interpolates with the same
Catmull-Rom spline; error is measured against the user's own dense clicks:

| spacing | vs 5-frame clicks (typical mean / p95) | verdict |
|---|---|---|
| 15 frames (0.5 s) | 3 px / 10 px | visually identical — badge ring is ~90 px wide |
| 30 frames (1 s) | 6 px / 15 px, worst clip 40 px on a sharp cut | fine for runs; drop to 10–15 for dodges/draws |
| 45+ frames | p95 30–110 px | too sparse |

A detector-based "snap between clicks" was also tried and **made paths worse** (mean ~15 px,
p95 ~55 px): detected foot points differ from the click convention and are noisy on 30 px
players. Conclusion: the spline is already the right tool — **15 frames default cuts clicks
~3×, 30 frames ~5×**, no tracker needed. (Branch `feature/refine-tracking` history has the
detector attempt.)

### Burned-in overlays at export
The browser renders the badge ("CHARLOTTE #7"), foot ellipse, and label banner as PNGs
(exactly matching the on-screen preview) and posts them with the clip. The server computes
per-frame x/y from the spline and feeds ffmpeg a `sendcmd` script driving two `overlay`
filters — buttery motion, no per-frame image sequence needed. The label banner overlays
top-center for the first 3 s with a fade.

### Persistence
Every video gets a sidecar project file (`projects/<video name>.json`) — clips, labels,
anchors — autosaved on every change. Close the browser mid-game, pick up where you left off.
Badge/label settings live in localStorage.

## Keyboard map (full list in the app's cheat sheet)

| Key | Action |
|---|---|
| `Space` / `K` | play / pause |
| `←` `→` | step 1 frame (33 ms) |
| `Shift+←/→` | jump 1 s |
| `J` / `L` | jump 10 s back / cycle speed 1×→2×→4×→8× |
| `I` / `O` | set in / out point |
| `C` | create clip from in/out |
| `1`–`9` | label selected clip |
| `T` | tracking mode on selected clip |
| `,` `.` (+Shift) | nudge in (out) point ∓/± 1 frame |
| `E` | export selected clip |
| `U` | undo last anchor (tracking) |

## File layout

```
server.js          Express server: streaming, probe, project save/load, export, stitch
lib/exporter.js    ffmpeg command builder: cut + sendcmd tracking + label overlay
public/index.html  single-page UI
public/app.js      all frontend logic
public/styles.css  dark, keyboard-first UI
games/             drop full-game files here (or open any path on disk)
projects/          autosaved sidecar project JSON per video
clips/             exported clips + stitched compilations
```

### Output formats (added after v1)
Two export formats, selectable in the top bar. **16:9** keeps the full 1920×1080 Veo frame
(YouTube's recommended spec). **9:16** produces 1080×1920 for Instagram Reels / YouTube
Shorts / TikTok by cropping a vertical window that *auto-follows the tracked player* —
the per-frame crop x comes from the same spline as the badge, smoothed with a
forward+backward exponential filter so it pans like a camera operator instead of jittering.
The **Compilation Builder** lists every exported clip across all games with format chips,
supports re-ordering, stitches same-format clips losslessly (`-c copy`) and falls back to a
re-encode with padding when formats are mixed.

## Future ideas (not in v1)
- ~~Optical-flow / detector assist~~ — measured Sept 2026: the spline at 15–30 frames already matches dense clicks; a detector snap was worse. Only a "badge on grass" drift alarm would still make sense.
- Score/clock corner bug; per-clip slow-motion replay segment
- Music bed + crossfades on the stitched compilation
- Veo API integration to pull film directly
