# GameReels — Sports Highlight Editor (Plan)

A personal, local web app for turning full-game Veo film into social clips (Reels, YouTube Shorts,
and 16:9). **Best for lacrosse and soccer.** Labeled, player-tracked highlight clips — fast, with a
keyboard-first workflow and none of the learning curve of a full NLE.

## The core workflow it's built around

1. **Scan** the full game with fast playback + big jumps (keyboard only).
2. When you spot a play: mark **In** (`I`), mark **Out** (`O`), press **`C`** → clip created and auto-named.
3. Tap a number key (`1`–`9`) to slap a **label** on it (Goal / Assist / Draw Win / …).
4. (Optional, anytime later) press **`T`** to **track the player** through the clip:
   click their feet → the video auto-advances N frames → click again. One click per anchor.
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
The browser renders the badge (player name and number — blank until you set them; the overlay
falls back to "PLAYER"), foot ellipse, and label banner as PNGs
(exactly matching the on-screen preview) and posts them with the clip. The server computes
per-frame x/y from the spline and feeds ffmpeg a `sendcmd` script driving two `overlay`
filters — buttery motion, no per-frame image sequence needed. The label banner overlays
top-center for the first 3 s with a fade.

### Export queue
Exports and stitches are jobs on the server (`lib/jobs.js`), run one at a time — a full-frame
encode already uses every core. `POST /api/export` / `/api/stitch` return a job id at once; the
browser follows `/api/jobs/events` (Server-Sent Events: a snapshot, then one message per change)
for progress parsed from ffmpeg's `-progress` output, and `DELETE /api/jobs/:id` cancels (kills
ffmpeg). Output is written as `<name>.part.mp4` and renamed when done, so the Compilation Builder
never lists a half-written file. A clip remembers its job id in the project, so a reloaded page
picks the progress back up.

### Encoder
`lib/exporter.js` picks NVENC (`h264_nvenc`, preset p5, VBR CQ 19, High profile) when a one-off test
encode succeeds, otherwise libx264 (veryfast, CRF 18); `CC_ENCODER=cpu` forces libx264. If an NVENC
encode fails mid-job it is redone once on the CPU. Measured on the GTX 980 Ti / 4-core PC (Oct 2026):
a 40 s tracked export takes 5.7 s (16:9) / 7.3 s (9:16) on NVENC vs 10.7 s / 13.2 s on libx264.
Because the two encoders write different SPS/PPS headers, the lossless `-c copy` stitch also requires
matching H.264 header fingerprints (ffprobe `extradata_hash`); otherwise it re-encodes.

### Persistence
Every video gets a sidecar project file (`projects/<video name>.json`) — clips, labels,
anchors — autosaved on every change. Close the browser mid-game, pick up where you left off.
Saves write a temp file and rename it into place (a crash can't leave half a file), keeping the
previous save as `<name>.json.bak`; an unreadable project is set aside as `.corrupt-<time>.json`
and the backup is restored automatically.
Badge/label settings live in localStorage.

## Keyboard map (full list in the app's cheat sheet)

| Key | Action |
|---|---|
| `Space` / `K` | play / pause |
| `←` `→` | step 1 frame (33 ms) |
| `Shift+←/→` | jump 1 s |
| `J` / `L` | jump 10 s back / cycle speed 1×→2×→4×→8×→16× |
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
lib/jobs.js        export/stitch queue: one ffmpeg at a time, progress over SSE, cancel
public/index.html  single-page UI
public/app.js      all frontend logic
public/js/spline.js  Catmull-Rom spline shared by the preview, the exporter and tools/
public/styles.css  dark, keyboard-first UI
games/             drop full-game files here (the server only serves videos from this folder)
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

### Scan-assist experiments (Sept 2026) — all negative, don't repeat
Goal: a ranked list of candidate moments so scanning a 40–50 min game means jumping
between ~20 spots instead of scrubbing at 8× (~10 min). Tested against the 39 user-marked
clips (20 Draw Wins) in four games; "recall" = a candidate within −12 s/+8 s of a clip start.

| signal | result |
|---|---|
| audio loudness / whistle-band peaks | 92–95% recall but 3–4 candidates/min — fires every ~17 s, recall is chance |
| motion stillness→burst (players set, whistle, go) | 65–70% of draws at 0.7–1.7/min |
| YOLO person-cluster at 1 fps | ≥5 players within 180 px in 74% of all seconds; ~2.5/min |
| CLIP ViT-B/32 embeddings, leave-one-game-out linear probe (100 draw frames) | top-30 candidates catch 60% of draws; zero-shot prompts 80% at top-40; works on one game, doesn't transfer across fields/lighting yet |

Why they fail: Veo lacrosse film is continuously loud, clustered and stop-start, so cheap
signals aren't selective. The CLIP probe is the only one that could improve — with ~10+ labeled
games it may become a usable "learns from your clips" ranking (embedding a game costs ~75 s on
CPU). Until then the scan phase stays manual; Veo's own event timeline/API is the other option.
Small wins shipped instead: 16× playback and the last speed is remembered per browser.

### UI refresh (Sept 2026)
Visual pass only — no behavior changes, all IDs/classes the tests rely on kept. Neutral-pro dark
theme (near-black canvas, layered grey surfaces, single cool-blue accent) driven by CSS tokens in
`styles.css`; the timeline canvas reads the same tokens (`TL` in app.js) so it can't drift from
the theme. Transport is a centered icon cluster with inline SVGs, hotkeys appear as `<kbd>` chips,
clip cards show a frame grab at the in-point (grabbed on a hidden `<video>`, kept in memory for the
session, keyed by id+inMs so a nudged in-point refreshes it), toasts sit bottom-right, focus rings
and `prefers-reduced-motion` are honored. Compilation intro/outro cards use the same palette
(dark base, magenta accent bar, gold kicker) instead of the earlier navy.

## Future ideas (not in v1)
- ~~Optical-flow / detector assist~~ — measured Sept 2026: the spline at 15–30 frames already matches dense clicks; a detector snap was worse. Only a "badge on grass" drift alarm would still make sense.
- Score/clock corner bug; per-clip slow-motion replay segment
- Music bed + crossfades on the stitched compilation
- Veo API integration to pull film directly
