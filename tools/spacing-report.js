// Anchor-spacing report: how sparse can tracking clicks be before the spline drifts?
// For every tracked clip in projects/, thins the user's dense clicks to N-frame spacing,
// re-interpolates with the app's Catmull-Rom spline, and measures the error against the
// user's own clicks. No server needed:  node tools/spacing-report.js [--frames 10,15,20,30,45]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffprobe = require('ffprobe-static').path;

const ROOT = path.join(__dirname, '..');
const GAMES = path.join(ROOT, 'games'), PROJECTS = path.join(ROOT, 'projects');
const argFrames = (process.argv.indexOf('--frames') > -1) ? process.argv[process.argv.indexOf('--frames') + 1] : '10,15,20,30,45';
const FRAMES = argFrames.split(',').map(Number);

let splineAt; // shared with the app — public/js/spline.js, loaded in main()
function probe(file) {
  try {
    const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate', '-of', 'json', file]));
    const s = j.streams[0], [n, d] = s.avg_frame_rate.split('/').map(Number);
    return { W: s.width, H: s.height, fps: d ? n / d : n };
  } catch { return { W: 1920, H: 1080, fps: 30 }; }
}
function thin(anchors, gapMs) {
  const out = [anchors[0]];
  for (const a of anchors) if (a.t - out[out.length - 1].t >= gapMs - 1) out.push(a);
  if (out[out.length - 1] !== anchors[anchors.length - 1]) out.push(anchors[anchors.length - 1]);
  return out;
}
function errStats(pred, truth, W, H) {
  const e = truth.map(a => { const p = splineAt(pred, a.t); return Math.hypot((p.x - a.x) * W, (p.y - a.y) * H); }).sort((a, b) => a - b);
  return { mean: e.reduce((s, v) => s + v, 0) / e.length, p95: e[Math.floor(e.length * 0.95)], max: e[e.length - 1] };
}
const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

async function main() {
  ({ splineAt } = await import('../public/js/spline.js'));
  const agg = Object.fromEntries(FRAMES.map(f => [f, { means: [], p95s: [], worst: 0, worstClip: '', clicksNow: 0, clicksThen: 0 }]));
  let nClips = 0, nAnchors = 0, medianGapMs = [];
  for (const pf of fs.readdirSync(PROJECTS).filter(f => f.endsWith('.json') && !f.startsWith('Test'))) {
    const base = pf.replace(/\.json$/, '');
    const game = fs.readdirSync(GAMES).find(g => path.basename(g, path.extname(g)).replace(/[^\w\- ]+/g, '_') === base);
    const { W, H, fps } = game ? probe(path.join(GAMES, game)) : { W: 1920, H: 1080, fps: 30 };
    const clips = (JSON.parse(fs.readFileSync(path.join(PROJECTS, pf))).clips || []).filter(c => c.anchors && c.anchors.length >= 12);
    if (!clips.length) continue;
    console.log(`\n${base}  (${W}x${H} @ ${fps.toFixed(2)} fps, ${clips.length} tracked clips)`);
    for (const c of clips) {
      const dense = (c.anchorsRaw || c.anchors).slice().sort((a, b) => a.t - b.t);
      for (let i = 1; i < dense.length; i++) medianGapMs.push(dense[i].t - dense[i - 1].t);
      nClips++; nAnchors += dense.length;
      const parts = [];
      for (const f of FRAMES) {
        const sparse = thin(dense, f / fps * 1000);
        const e = errStats(sparse, dense, W, H);
        const a = agg[f]; a.means.push(e.mean); a.p95s.push(e.p95); a.clicksNow += dense.length; a.clicksThen += sparse.length;
        if (e.p95 > a.worst) { a.worst = e.p95; a.worstClip = c.name.replace(/^.*?\d\d /, ''); }
        parts.push(`${f}f:${sparse.length}clk ${e.mean.toFixed(0)}/${e.p95.toFixed(0)}px`);
      }
      console.log(`  ${c.name.replace(/^.*?(\d\d\b)/, '$1').padEnd(22).slice(0, 22)} ${((c.outMs - c.inMs) / 1000).toFixed(1).padStart(5)}s ${String(dense.length).padStart(4)} clicks | ${parts.join(' | ')}`);
    }
  }
  console.log(`\n=== Summary: ${nClips} clips, ${nAnchors} anchors, current median spacing ${median(medianGapMs).toFixed(0)} ms (~${Math.round(median(medianGapMs) / 33.37)} frames) ===`);
  console.log('spacing   clicks (now → then)   median mean / p95 error   worst-clip p95');
  for (const f of FRAMES) {
    const a = agg[f];
    console.log(`${String(f).padStart(3)} frames  ${String(a.clicksNow).padStart(5)} → ${String(a.clicksThen).padStart(5)} (${(a.clicksNow / a.clicksThen).toFixed(1)}× fewer)   ${median(a.means).toFixed(1).padStart(5)} / ${median(a.p95s).toFixed(1).padStart(5)} px          ${a.worst.toFixed(0)} px (${a.worstClip})`);
  }
  console.log('\nReference: the foot circle is ~90 px wide at 1080p; errors under ~20 px are invisible.');
}
main();
