"""Experiment 4 (negative for now): can a CLIP-embedding classifier find draws in Veo lacrosse film? Leave-one-game-out.
Usage: python tools/experiments/clip-probe.py   (needs open_clip_torch + torch; ~75 s per game to embed, cached in .cache/)"""
import os, sys, json, re, time, subprocess
import numpy as np, torch
torch.set_num_threads(12)
import open_clip
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # repo root
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache"); os.makedirs(S, exist_ok=True)  # embeddings + model cache
FF = ROOT + "/node_modules/ffmpeg-static/ffmpeg.exe"
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32); STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)
model, _, _ = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai", cache_dir=S + "/clipcache"); model.eval()
tok = open_clip.get_tokenizer("ViT-B-32")

def embed_game(path):
    cache = S + "/emb_" + re.sub(r"[^\w\-]+", "_", os.path.basename(path)) + ".npy"
    if os.path.exists(cache): return np.load(cache)
    p = subprocess.Popen([FF, "-v", "error", "-i", path, "-an", "-vf", "fps=1,scale=224:224", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, bufsize=10**7)
    embs, batch, t0 = [], [], time.time()
    def flush():
        if not batch: return
        x = torch.from_numpy(np.stack(batch)).permute(0, 3, 1, 2)
        with torch.no_grad(): e = model.encode_image(x); e = e / e.norm(dim=-1, keepdim=True)
        embs.append(e.numpy()); batch.clear()
    while True:
        buf = p.stdout.read(224 * 224 * 3)
        if len(buf) < 224 * 224 * 3: break
        img = (np.frombuffer(buf, np.uint8).reshape(224, 224, 3).astype(np.float32) / 255 - MEAN) / STD
        batch.append(img)
        if len(batch) == 64: flush()
    flush(); E = np.concatenate(embs); np.save(cache, E)
    print(f"  embedded {len(E)} s of {os.path.basename(path)} in {time.time()-t0:.0f}s", file=sys.stderr, flush=True); return E

def load_clips(path):
    base = re.sub(r"[^\w\- ]+", "_", os.path.splitext(os.path.basename(path))[0])
    return json.load(open(f"{ROOT}/projects/{base}.json"))["clips"]

games = [f"{ROOT}/games/{g}" for g in os.listdir(ROOT + "/games") if re.search(r"\.(mp4|mov)$", g, re.I) and not g.startswith("Test")]
data = []
for g in games:
    E = embed_game(g); clips = load_clips(g)
    starts = np.array([c["inMs"] / 1000 for c in clips]); draws = np.array([c["inMs"] / 1000 for c in clips if re.search("draw", c.get("label") or "", re.I)])
    t = np.arange(len(E))
    pos = np.zeros(len(E), bool); 
    for d in draws: pos |= (t >= d - 3) & (t <= d + 2)
    near_any = np.zeros(len(E), bool)
    for s in starts: near_any |= (t >= s - 20) & (t <= s + 20)
    neg = ~near_any
    data.append(dict(name=os.path.basename(g), E=E, pos=pos, neg=neg, draws=draws, starts=starts))

def train(Xp, Xn):
    X = torch.from_numpy(np.concatenate([Xp, Xn])).float(); y = torch.cat([torch.ones(len(Xp)), torch.zeros(len(Xn))])
    w = torch.zeros(X.shape[1], requires_grad=True); b = torch.zeros(1, requires_grad=True)
    opt = torch.optim.Adam([w, b], lr=0.05); pw = torch.tensor(len(Xn) / max(1, len(Xp)))
    for _ in range(300):
        opt.zero_grad(); loss = torch.nn.functional.binary_cross_entropy_with_logits(X @ w + b, y, pos_weight=pw) + 1e-3 * (w * w).sum(); loss.backward(); opt.step()
    return w.detach().numpy(), b.item()

def candidates(score, merge=20):
    sm = np.array([score[max(0, i - 1):i + 2].max() for i in range(len(score))])
    peaks = [(sm[i], i) for i in range(1, len(sm) - 1) if sm[i] >= sm[i - 1] and sm[i] >= sm[i + 1]]
    peaks.sort(reverse=True); out = []
    for s, i in peaks:
        if all(abs(i - j) > merge for _, j in out): out.append((s, i))
    return out  # ranked by score

def report(label, scores_by_game):
    print(f"\n== {label} ==  (recall of Draw Win clips within [-12s,+8s] of a candidate; candidates ranked by score)")
    tot = {N: [0, 0] for N in (10, 15, 20, 30, 40)}; alltot = {N: [0, 0] for N in (10, 15, 20, 30, 40)}
    for d, score in zip(data, scores_by_game):
        cand = candidates(score); mins = len(score) / 60
        row = []
        for N in (10, 15, 20, 30, 40):
            top = [i for _, i in cand[:N]]
            hit = sum(any(i >= s - 12 and i <= s + 8 for i in top) for s in d["draws"]); ahit = sum(any(i >= s - 12 and i <= s + 8 for i in top) for s in d["starts"])
            tot[N][0] += hit; tot[N][1] += len(d["draws"]); alltot[N][0] += ahit; alltot[N][1] += len(d["starts"])
            row.append(f"top{N}: {hit}/{len(d['draws'])} draws, {ahit}/{len(d['starts'])} all")
        print(f"  {d['name'][:38]:38s} {mins:4.0f} min | " + " | ".join(row))
    print("  TOTAL " + " | ".join(f"top{N}: draws {tot[N][0]}/{tot[N][1]} all {alltot[N][0]}/{alltot[N][1]}" for N in (10, 15, 20, 30, 40)))

# zero-shot baseline
with torch.no_grad():
    T = model.encode_text(tok(["a lacrosse draw: two players crouched at the center circle with the referee, teams lined up",
                              "the start of a lacrosse play at midfield, players set and waiting for the whistle",
                              "lacrosse players running and passing during open play", "a lacrosse team attacking the goal"]))
    T = (T / T.norm(dim=-1, keepdim=True)).numpy()
report("zero-shot CLIP (draw prompts minus play prompts)", [(d["E"] @ T[:2].T).max(1) - (d["E"] @ T[2:].T).max(1) for d in data])

# leave-one-game-out linear probe
scores = []
for k, d in enumerate(data):
    Xp = np.concatenate([o["E"][o["pos"]] for j, o in enumerate(data) if j != k]); Xn = np.concatenate([o["E"][o["neg"]] for j, o in enumerate(data) if j != k])
    w, b = train(Xp, Xn); scores.append(d["E"] @ w + b)
report(f"leave-one-game-out linear probe on CLIP (trained on {sum(int(d['pos'].sum()) for d in data)} draw-frames total)", scores)
