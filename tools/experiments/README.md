# Scan-assist experiments (Sept 2026) — kept for reference, all negative

Goal: rank candidate moments in a full game so scanning means jumping between ~20 spots
instead of scrubbing at 8×. Every script scores itself against the user's own clips in
`projects/*.json` ("recall" = a candidate within −12 s / +8 s of a clip start; 20 of the 39
clips across four games are Draw Wins). None was selective enough to beat scrubbing —
Veo lacrosse film is continuously loud, clustered and stop-start.

| script | signal | result |
|---|---|---|
| `audio-peaks.js` | loudness / whistle-band (2.5–4.5 kHz) peaks over a rolling baseline | 92–95 % recall but 3–4 candidates/min — fires every ~17 s |
| `motion-burst.js` | low global motion ≥ 2 s then a burst (players set, whistle, go) | 65–70 % of draws at 0.7–1.7/min |
| `yolo-cluster.py` + `yolo-cluster-eval.js` | ≥ K players within ~180 px at 1 fps (YOLOv8n) | ≥ 5 players clustered in 74 % of all seconds; ~2.5/min |
| `clip-probe.py` | CLIP ViT-B/32 embeddings at 1 fps; zero-shot prompts and a leave-one-game-out linear probe on 100 draw frames | top-30 candidates catch 60 % of draws (probe) / top-40 80 % (zero-shot); great on one game, doesn't transfer across fields yet |

Only `clip-probe.py` could still pay off: with ~10+ labeled games the probe may become a usable
"learns from your clips" ranking (embedding a game takes ~75 s on CPU and is cached).

## Running

- JS scripts need only Node and the repo's `ffmpeg-static`; run from the repo root, e.g.
  `node tools/experiments/audio-peaks.js`.
- Python scripts need a venv with `ultralytics`, `opencv-python`, `torch`, and (for CLIP)
  `open_clip_torch`. Model weights and CLIP embeddings download into `tools/experiments/.cache/`
  (gitignored). On Windows use `PYTHONIOENCODING=utf-8` if console output trips on Unicode.
- All scripts read the game files from `games/` and the sidecars from `projects/`.
