"""Experiment 3 (negative), step 1: YOLO person detections sampled at 1 fps; a draw = tight cluster of players.
Usage: python tools/experiments/yolo-cluster.py <game file> <out cluster.json>   (needs ultralytics + opencv)"""
import sys, os, json, subprocess, time, math
import numpy as np, torch
torch.set_num_threads(12)
from ultralytics import YOLO
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # repo root
FF = ROOT + "/node_modules/ffmpeg-static/ffmpeg.exe"
game = sys.argv[1]; out_json = sys.argv[2]
W, H = 960, 540
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache"); os.makedirs(CACHE, exist_ok=True); os.chdir(CACHE)
model = YOLO("yolov8n.pt")  # downloads into tools/experiments/.cache on first run
p = subprocess.Popen([FF, "-v", "error", "-i", game, "-an", "-vf", f"fps=1,scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE, bufsize=10**7)
rows = []; t0 = time.time(); sec = 0
while True:
    buf = p.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    r = model.predict(frame, imgsz=960, conf=0.3, classes=[0], verbose=False)[0]
    pts = np.array([[(b[0] + b[2]) / 2, b[3]] for b in r.boxes.xyxy.tolist()]) if len(r.boxes) else np.zeros((0, 2))
    n = len(pts); best = 0; cx = cy = -1
    if n:
        d = np.hypot(pts[:, None, 0] - pts[None, :, 0], pts[:, None, 1] - pts[None, :, 1])
        cnt = (d < 90).sum(axis=1)                      # neighbours within 90 px @540p (~180 px @1080p)
        k = int(cnt.argmax()); best = int(cnt[k]); cx, cy = float(pts[k, 0] / W), float(pts[k, 1] / H)
    rows.append([sec, n, best, round(cx, 3), round(cy, 3)])
    if sec % 300 == 0: print(f"{sec//60} min, {time.time()-t0:.0f}s elapsed", file=sys.stderr, flush=True)
    sec += 1
json.dump(rows, open(out_json, "w"))
print(f"done {sec} s of video in {time.time()-t0:.0f}s -> {out_json}", file=sys.stderr)
