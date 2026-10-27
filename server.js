// GameReels — local server: video streaming, probing, project persistence, ffmpeg export
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffprobePath = require('ffprobe-static').path;
const { exportClip, stitchClips, probeMeta } = require('./lib/exporter');
const jobs = require('./lib/jobs');

const ROOT = __dirname;
const GAMES_DIR = path.join(ROOT, 'games');
const PROJECTS_DIR = path.join(ROOT, 'projects');
const CLIPS_DIR = path.join(ROOT, 'clips');
const TEST_DIR = path.join(CLIPS_DIR, '_test'); // test-suite outputs; hidden from the builder
for (const d of [GAMES_DIR, PROJECTS_DIR, CLIPS_DIR]) fs.mkdirSync(d, { recursive: true });

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm']);
const PORT = 4242;
const HOST = '127.0.0.1'; // this machine only — the API reads game files and writes projects

// The UI passes absolute paths it got from /api/videos; anything outside games/
// is refused so the server can't be used to read arbitrary files.
const samePath = process.platform === 'win32' ? s => s.toLowerCase() : s => s;
function gamePath(p) {
  if (!p) return null;
  const full = path.resolve(p);
  if (!samePath(full).startsWith(samePath(GAMES_DIR + path.sep))) return null;
  return fs.existsSync(full) ? full : null;
}

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
  const p = gamePath(req.query.path);
  if (!p) return res.status(404).send('not found');
  const stat = fs.statSync(p);
  const total = stat.size;
  const type = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm' }[path.extname(p).toLowerCase()] || 'application/octet-stream';
  // single ranges only ("a-b", "a-", or suffix "-n"); anything else falls through
  // to a full 200 response, which the spec allows for a Range header we don't parse
  const m = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim());
  if (m && (m[1] || m[2])) {
    let start, end;
    if (m[1]) {
      start = parseInt(m[1], 10);
      end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
    } else {
      start = Math.max(0, total - parseInt(m[2], 10)); // suffix: the last n bytes
      end = total - 1;
    }
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
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
  const p = gamePath(req.query.path);
  if (!p) return res.status(404).json({ error: 'not found' });
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
// Saves go to a temp file that's renamed into place, so a crash mid-write can't
// leave half a JSON file; the previous version is kept as <name>.json.bak.
function writeProject(f, data) {
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
  fs.renameSync(tmp, f);
}
function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
app.get('/api/project', (req, res) => {
  const f = projectFile(req.query.video || '');
  if (!fs.existsSync(f)) return res.json({ clips: [] });
  const data = readJson(f);
  if (data) return res.json(data);
  // unreadable: set it aside (never overwrite it) and fall back to the backup
  const corrupt = f.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
  fs.renameSync(f, corrupt);
  console.error('project file unreadable, moved to', corrupt);
  const bak = fs.existsSync(f + '.bak') ? readJson(f + '.bak') : null;
  if (bak) {
    fs.copyFileSync(f + '.bak', f);
    return res.json({ ...bak, notice: 'Project file was damaged — restored the previous save.' });
  }
  res.json({ clips: [], notice: 'Project file was damaged and no backup was found — it was kept as ' + path.basename(corrupt) });
});
app.post('/api/project', (req, res) => {
  const { video, data } = req.body;
  writeProject(projectFile(video), data);
  res.json({ ok: true });
});

// ---- export (queued — see lib/jobs.js) ---------------------------------------
function safeName(s) {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'clip';
}
const clipsRel = full => path.relative(CLIPS_DIR, full).split(path.sep).join('/');

// both return { jobId, file } right away; progress and the result arrive on /api/jobs/events
app.post('/api/export', (req, res) => {
  try {
    const { clip, assets, meta, ref } = req.body;
    const videoPath = gamePath(req.body.videoPath);
    if (!videoPath) throw new Error('game video not found in games folder');
    const vertical = meta && meta.format === 'vertical';
    const suffix = vertical ? ' [9x16]' : '';
    const subdir = (meta && meta.testRun ? '_test/' : '') + (vertical ? 'Reels' : 'YouTube');
    fs.mkdirSync(path.join(CLIPS_DIR, subdir), { recursive: true });
    const outPath = path.join(CLIPS_DIR, subdir, safeName(clip.name) + suffix + '.mp4');
    const job = jobs.enqueue({
      type: 'export', name: clip.name, file: clipsRel(outPath), outPath, ref,
      run: o => exportClip({ videoPath, clip, assets, meta, ...o }),
    });
    res.json({ jobId: job.id, file: job.file });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get('/api/jobs/events', jobs.subscribe);
app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  j ? res.json(j) : res.status(404).json({ error: 'no such job' });
});
app.delete('/api/jobs/:id', (req, res) => {
  jobs.cancel(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'no such job' });
});

// exported clip list with probed metadata (cached by name+mtime) — feeds the
// compilation builder so it can show formats and warn about mixing them
const probeCache = new Map();
// every .mp4 in clips/ plus one level of subfolders (YouTube/, Reels/), as
// CLIPS_DIR-relative names like "Reels/Goal [9x16].mp4". The test suite writes
// under _test/ (one level deeper); that tree is skipped unless includeTest is set.
function listExportNames(includeTest) {
  const names = [];
  const walk = (dir, prefix, maxDepth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + e.name;
      if (e.isDirectory()) {
        if (rel === '_test') { if (includeTest) walk(path.join(dir, e.name), rel + '/', 2); continue; }
        if (maxDepth > 0) walk(path.join(dir, e.name), rel + '/', maxDepth - 1);
      } else if (/(?<!\.part)\.mp4$/i.test(e.name)) { // .part.mp4 = export still being written
        names.push(rel);
      }
    }
  };
  walk(CLIPS_DIR, '', 1);
  return names;
}
app.get('/api/exports', async (req, res) => {
  const files = [];
  for (const f of listExportNames(!!req.query.includeTest)) {
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

app.post('/api/stitch', (req, res) => {
  try {
    const { files, outName, transition, transitionSec, intro, outro } = req.body;
    const inputs = files.map(f => {
      const full = path.resolve(CLIPS_DIR, f);
      if (!full.startsWith(CLIPS_DIR + path.sep)) throw new Error('clip outside clips folder: ' + f);
      return full;
    });
    for (const f of inputs) if (!fs.existsSync(f)) throw new Error('missing clip: ' + f);
    const outDir = req.body.testRun ? TEST_DIR : CLIPS_DIR;
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, safeName(outName || 'Highlights') + '.mp4');
    const job = jobs.enqueue({
      type: 'stitch', name: outName || 'Highlights', file: clipsRel(outPath), outPath,
      run: o => stitchClips(inputs, o.outPath, { transition, transitionSec, intro, outro, ...o }),
    });
    res.json({ jobId: job.id, file: job.file });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  GameReels is running:  http://localhost:' + PORT + '  (this PC only)');
  console.log('  Drop full-game video files into:  ' + GAMES_DIR);
  console.log('  Exported clips land in:           ' + CLIPS_DIR);
  console.log('');
});
