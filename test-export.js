// End-to-end export test: fakes the browser's role (PNG assets + anchors) and
// hits /api/export and /api/stitch, then probes the outputs.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;

const BASE = 'http://localhost:4242';
const videoPath = path.join(__dirname, 'games', 'Test Game vs Skyhawks.mp4');

// regenerate the synthetic test game if it was deleted (40s of moving test pattern)
if (!fs.existsSync(videoPath)) {
  console.log('test game missing — regenerating…');
  execFileSync(ffmpeg, ['-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '40', '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', videoPath]);
}

function makePng(name, args) {
  const f = path.join(__dirname, name);
  execFileSync(ffmpeg, ['-y', '-v', 'error', ...args, '-frames:v', '1', f]);
  return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
}

async function post(url, body) {
  const r = await fetch(BASE + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(url + ' failed: ' + (j.error || r.status));
  return j;
}

(async () => {
  // stand-in overlay art (the real app renders these on canvas)
  const badgePng = makePng('_badge.png', ['-f', 'lavfi', '-i', 'color=c=red@0.85:s=220x60,format=rgba']);
  const circlePng = makePng('_circle.png', ['-f', 'lavfi', '-i', 'color=c=yellow@0.7:s=90x36,format=rgba']);
  const labelPng = makePng('_label.png', ['-f', 'lavfi', '-i', 'color=c=black@0.7:s=400x90,format=rgba']);

  // tracked clip: 5.0s → 12.0s, anchors sweeping across the frame every 0.5s
  const anchors = [];
  for (let t = 5000; t <= 12000; t += 500) {
    const u = (t - 5000) / 7000;
    anchors.push({ t, x: 0.15 + 0.65 * u, y: 0.4 + 0.2 * Math.sin(u * Math.PI * 2) });
  }
  const meta = { width: 1920, height: 1080, fps: 30, labelSeconds: 3 };

  console.log('export 1: tracked + labeled…');
  const r1 = await post('/api/export', {
    videoPath,
    clip: { name: 'Test Game 01 Goal', inMs: 5000, outMs: 12000, label: 'Goal', anchors },
    assets: { badgePng, circlePng, labelPng }, meta,
  });
  console.log('  →', r1.file);

  console.log('export 2: plain cut, no overlays…');
  const r2 = await post('/api/export', {
    videoPath,
    clip: { name: 'Test Game 02 Shot', inMs: 20000, outMs: 23500, label: null, anchors: [] },
    assets: {}, meta,
  });
  console.log('  →', r2.file);

  console.log('export 3: vertical 9:16 with tracking follow-crop…');
  const r3 = await post('/api/export', {
    videoPath,
    clip: { name: 'Test Game 03 Goal', inMs: 5000, outMs: 12000, label: 'Goal', anchors },
    assets: { badgePng, circlePng, labelPng }, meta: { testRun: true, ...meta, format: 'vertical' },
  });
  console.log('  →', r3.file);

  console.log('export 4: square 1:1 with tracking follow-crop…');
  const rSq = await post('/api/export', {
    videoPath,
    clip: { name: 'Test Game 04 Goal', inMs: 5000, outMs: 8000, label: 'Goal', anchors },
    assets: { badgePng, circlePng, labelPng }, meta: { testRun: true, ...meta, format: 'square' },
  });
  console.log('  →', rSq.file);
  if (!rSq.file.includes('Square/') || !rSq.file.includes('[1x1]')) {
    throw new Error('square export path: ' + rSq.file);
  }

  console.log('stitch (uniform 16:9, lossless copy)…');
  const r4 = await post('/api/stitch', { testRun: true, files: [r1.file, r2.file], outName: 'Test Compilation' });
  console.log('  →', r4.file);

  console.log('stitch (mixed formats, re-encode path)…');
  const r5 = await post('/api/stitch', { testRun: true, files: [r1.file, r3.file], outName: 'Test Mixed' });
  console.log('  →', r5.file);

  const durOf = f => parseFloat(execFileSync(ffprobe, ['-v', 'error', '-show_entries',
    'format=duration', '-of', 'csv=p=0', path.join(__dirname, 'clips', f)]).toString());

  console.log('stitch with crossfade transition…');
  const r6 = await post('/api/stitch', { testRun: true,
    files: [r1.file, r2.file], outName: 'Test Fade', transition: 'fade', transitionSec: 0.5,
  });
  const d6 = durOf(r6.file); // 7.0 + 3.5 − 0.5 overlap = 10.0
  console.log(`  → ${r6.file}: ${d6.toFixed(2)}s`);
  if (Math.abs(d6 - 10.0) > 0.35) throw new Error('crossfade duration off: ' + d6);

  console.log('stitch with intro/outro cards + fade through black…');
  const cardPng = makePng('_card.png', ['-f', 'lavfi', '-i', 'color=c=navy:s=1920x1080']);
  const r7 = await post('/api/stitch', { testRun: true,
    files: [r1.file, r2.file], outName: 'Test Cards', transition: 'fadeblack', transitionSec: 0.5,
    intro: { png: cardPng, seconds: 3 }, outro: { png: cardPng, seconds: 3 },
  });
  const d7 = durOf(r7.file); // 3 + 7 + 3.5 + 3 − 3×0.5 = 15.0
  console.log(`  → ${r7.file}: ${d7.toFixed(2)}s`);
  if (Math.abs(d7 - 15.0) > 0.45) throw new Error('cards stitch duration off: ' + d7);

  console.log('stitch with cards, no transition (concat path)…');
  const r8 = await post('/api/stitch', { testRun: true,
    files: [r1.file, r2.file], outName: 'Test Cards Cut',
    intro: { png: cardPng, seconds: 2 },
  });
  const d8 = durOf(r8.file); // 2 + 7 + 3.5 = 12.5
  console.log(`  → ${r8.file}: ${d8.toFixed(2)}s`);
  if (Math.abs(d8 - 12.5) > 0.35) throw new Error('cards concat duration off: ' + d8);

  console.log('exports list with probed dims…');
  const list = await (await fetch(BASE + '/api/exports?includeTest=1')).json();
  for (const f of list.files) console.log(`  ${f.name}: ${f.width}x${f.height} ${f.duration.toFixed(1)}s`);

  const v = list.files.find(f => f.name === r3.file);
  if (!v || v.width !== 1080 || v.height !== 1920) throw new Error('vertical export is not 1080x1920');
  const sq = list.files.find(f => f.name === rSq.file);
  if (!sq || sq.width !== 1080 || sq.height !== 1080) throw new Error('square export is not 1080x1080: ' + JSON.stringify(sq));

  for (const f of [r1.file, r2.file, r4.file]) {
    const out = execFileSync(ffprobe, ['-v', 'error', '-show_entries',
      'format=duration', '-of', 'csv=p=0', path.join(__dirname, 'clips', f)]).toString().trim();
    console.log(`  ${f}: ${out}s`);
  }
  ['_badge.png', '_circle.png', '_label.png', '_card.png'].forEach(f => fs.unlinkSync(path.join(__dirname, f)));
  // tidy: remove test outputs so they don't clutter the Compilation Builder
  for (const f of [r1, r2, r3, rSq, r4, r5, r6, r7, r8].map(r => r.file)) {
    fs.unlinkSync(path.join(__dirname, 'clips', f));
  }
  fs.rmSync(path.join(__dirname, 'clips', '_test'), { recursive: true, force: true });
  console.log('ALL TESTS PASSED');
})().catch(e => { console.error('TEST FAILED:', e.message); process.exit(1); });
