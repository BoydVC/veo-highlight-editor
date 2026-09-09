// Charlotte Clips — local server: video streaming, probing, project persistence, ffmpeg export
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffprobePath = require('ffprobe-static').path;
const { exportClip, stitchClips, probeMeta } = require('./lib/exporter');

const ROOT = __dirname;
const GAMES_DIR = path.join(ROOT, 'games');
const PROJECTS_DIR = path.join(ROOT, 'projects');
const CLIPS_DIR = path.join(ROOT, 'clips');
for (const d of [GAMES_DIR, PROJECTS_DIR, CLIPS_DIR]) fs.mkdirSync(d, { recursive: true });

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm']);
const PORT = 4242;

const app = express();
app.use(express.json({ limit: '80mb' })); // overlay PNGs ride along with export requests
// no-cache: the frontend changes between sessions and a stale cached app.js
// renders stale overlay art (browser draws the badge/label PNGs)
app.use(express.static(path.join(ROOT, 'public'), {
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache'),
}));

// ---- video library -------------------------------------------------------
app.get('/api/videos', (req, res) => {
  const files = fs.readdirSync(GAMES_DIR)
    .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
    .map(f => {
      const full = path.join(GAMES_DIR, f);
      const st = fs.statSync(full);
      return { name: f, path: full, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ gamesDir: GAMES_DIR, files });
});

// ---- streaming with range support (works for any local path) -------------
app.get('/video', (req, res) => {
  const p = req.query.path;
  if (!p || !fs.existsSync(p)) return res.status(404).send('not found');
  const stat = fs.statSync(p);
  const total = stat.size;
  const type = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm' }[path.extname(p).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : total - 1;
    end = Math.min(end, total - 1);
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': type,
    });
    fs.createReadStream(p, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': total, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(p).pipe(res);
  }
});

// ---- ffprobe: fps, duration, dimensions -----------------------------------
app.get('/api/probe', (req, res) => {
  const p = req.query.path;
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  const args = ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate,duration',
    '-show_entries', 'format=duration', '-of', 'json', p];
  const proc = spawn(ffprobePath, args);
  let out = '', err = '';
  proc.stdout.on('data', d => out += d);
  proc.stderr.on('data', d => err += d);
  proc.on('close', code => {
    if (code !== 0) return res.status(500).json({ error: err });
    try {
      const j = JSON.parse(out);
      const s = j.streams[0];
      const rate = (s.avg_frame_rate && s.avg_frame_rate !== '0/0') ? s.avg_frame_rate : s.r_frame_rate;
      const [n, d] = rate.split('/').map(Number);
      const fps = d ? n / d : n;
      const duration = parseFloat(s.duration || j.format.duration);
      res.json({ width: s.width, height: s.height, fps, duration });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
});

// ---- project sidecar persistence ------------------------------------------
function projectFile(videoPath) {
  const base = path.basename(videoPath, path.extname(videoPath)).replace(/[^\w\- ]+/g, '_');
  return path.join(PROJECTS_DIR, base + '.json');
}
app.get('/api/project', (req, res) => {
  const f = projectFile(req.query.video || '');
  if (!fs.existsSync(f)) return res.json({ clips: [] });
  res.json(JSON.parse(fs.readFileSync(f, 'utf8')));
});
app.post('/api/project', (req, res) => {
  const { video, data } = req.body;
  fs.writeFileSync(projectFile(video), JSON.stringify(data, null, 2));
  res.json({ ok: true });
});

// ---- export ----------------------------------------------------------------
function safeName(s) {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'clip';
}
app.post('/api/export', async (req, res) => {
  try {
    const { videoPath, clip, assets, meta } = req.body;
    const vertical = meta && meta.format === 'vertical';
    const suffix = vertical ? ' [9x16]' : '';
    const subdir = vertical ? 'Reels' : 'YouTube';
    fs.mkdirSync(path.join(CLIPS_DIR, subdir), { recursive: true });
    const outPath = path.join(CLIPS_DIR, subdir, safeName(clip.name) + suffix + '.mp4');
    await exportClip({ videoPath, outPath, clip, assets, meta });
    res.json({ ok: true, file: subdir + '/' + path.basename(outPath) });
  } catch (e) {
    console.error('export failed:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// exported clip list with probed metadata (cached by name+mtime) — feeds the
// compilation builder so it can show formats and warn about mixing them
const probeCache = new Map();
// every .mp4 in clips/ plus one level of subfolders (YouTube/, Reels/), as
// CLIPS_DIR-relative names like "Reels/Goal [9x16].mp4"
function listExportNames() {
  const names = [];
  for (const e of fs.readdirSync(CLIPS_DIR, { withFileTypes: true })) {
    if (e.isDirectory()) {
      for (const f of fs.readdirSync(path.join(CLIPS_DIR, e.name))) {
        if (f.toLowerCase().endsWith('.mp4')) names.push(e.name + '/' + f);
      }
    } else if (e.name.toLowerCase().endsWith('.mp4')) {
      names.push(e.name);
    }
  }
  return names;
}
app.get('/api/exports', async (req, res) => {
  const files = [];
  for (const f of listExportNames()) {
    const full = path.join(CLIPS_DIR, f);
    const st = fs.statSync(full);
    const key = f + '|' + st.mtimeMs;
    if (!probeCache.has(key)) {
      try { probeCache.set(key, await probeMeta(full)); }
      catch { continue; } // skip unreadable/partial files
    }
    const m = probeCache.get(key);
    files.push({ name: f, size: st.size, mtime: st.mtimeMs, width: m.width, height: m.height, duration: m.duration });
  }
  files.sort((a, b) => a.mtime - b.mtime);
  res.json({ clipsDir: CLIPS_DIR, files });
});

app.post('/api/stitch', async (req, res) => {
  try {
    const { files, outName, transition, transitionSec, intro, outro } = req.body;
    const inputs = files.map(f => {
      const full = path.resolve(CLIPS_DIR, f);
      if (!full.startsWith(CLIPS_DIR + path.sep)) throw new Error('clip outside clips folder: ' + f);
      return full;
    });
    for (const f of inputs) if (!fs.existsSync(f)) throw new Error('missing clip: ' + f);
    const outPath = path.join(CLIPS_DIR, safeName(outName || 'Highlights') + '.mp4');
    await stitchClips(inputs, outPath, { transition, transitionSec, intro, outro });
    res.json({ ok: true, file: path.basename(outPath) });
  } catch (e) {
    console.error('stitch failed:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log('');
  console.log('  Charlotte Clips is running:  http://localhost:' + PORT);
  console.log('  Drop full-game video files into:  ' + GAMES_DIR);
  console.log('  Exported clips land in:           ' + CLIPS_DIR);
  console.log('');
});
