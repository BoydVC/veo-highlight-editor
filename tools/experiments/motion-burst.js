// Experiment 2 (negative): draw signature via global motion — players set (low motion ≥2s) then burst on the whistle.
// Usage: node tools/experiments/motion-burst.js
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..'); // repo root
const ffmpeg = require(ROOT + '/node_modules/ffmpeg-static');
const FPS = 4, W = 96, H = 54, FRAME = W * H;
function motion(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-i', file, '-an', '-vf', `fps=${FPS},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-']);
    const out = []; let prev = null, buf = Buffer.alloc(0);
    p.stdout.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= FRAME) {
        const f = buf.subarray(0, FRAME); buf = buf.subarray(FRAME);
        if (prev) { let s = 0; for (let i = 0; i < FRAME; i++) s += Math.abs(f[i] - prev[i]); out.push(s / FRAME); }
        prev = Buffer.from(f);
      }
    });
    p.on('close', c => c ? reject(new Error('ffmpeg ' + c)) : resolve(out));
  });
}
function candidates(m, stillSec, stillThr, burstRatio) {
  const out = []; const need = stillSec * FPS;
  for (let i = need; i < m.length - 2; i++) {
    let still = true; for (let k = i - need; k < i; k++) if (m[k] > stillThr) { still = false; break; }
    if (!still) continue;
    const base = Math.max(0.5, m.slice(i - need, i).reduce((a, b) => a + b, 0) / need);
    const burst = Math.max(m[i], m[i + 1], m[i + 2]);
    if (burst / base >= burstRatio) { const t = i / FPS; if (!out.length || t - out[out.length - 1] > 15) out.push(t); }
  }
  return out;
}
(async () => {
  const games = fs.readdirSync(ROOT + '/games').filter(f => /\.(mp4|mov)$/i.test(f) && !f.startsWith('Test'));
  const grand = {};
  for (const g of games) {
    const base = path.basename(g, path.extname(g)).replace(/[^\w\- ]+/g, '_');
    const pj = ROOT + '/projects/' + base + '.json'; if (!fs.existsSync(pj)) continue;
    const clips = JSON.parse(fs.readFileSync(pj)).clips || []; const draws = clips.filter(c => /draw/i.test(c.label || ''));
    const t0 = Date.now(); const m = await motion(ROOT + '/games/' + g); const min = m.length / FPS / 60;
    const sorted = m.slice().sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)];
    console.log(`\n${g}  (${min.toFixed(1)} min, median motion ${med.toFixed(2)}, ${draws.length} draw clips / ${clips.length} total, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    for (const [stillSec, thrMul, ratio] of [[2, 0.6, 2.5], [2, 0.8, 2.0], [3, 0.8, 2.0], [1.5, 0.7, 3.0]]) {
      const cand = candidates(m, stillSec, med * thrMul, ratio);
      const hit = arr => arr.filter(c => cand.some(t => t * 1000 >= c.inMs - 12000 && t * 1000 <= c.inMs + 8000)).length;
      const key = `still${stillSec}s×${thrMul} burst×${ratio}`;
      console.log(`  ${key.padEnd(26)} ${String(cand.length).padStart(3)} cand (${(cand.length / min).toFixed(2)}/min)  draws ${hit(draws)}/${draws.length}  all clips ${hit(clips)}/${clips.length}`);
      grand[key] = grand[key] || { c: 0, min: 0, dh: 0, dn: 0, ah: 0, an: 0 };
      const G = grand[key]; G.c += cand.length; G.min += min; G.dh += hit(draws); G.dn += draws.length; G.ah += hit(clips); G.an += clips.length;
    }
  }
  console.log('\n=== all games ===');
  for (const [k, v] of Object.entries(grand)) console.log(`${k.padEnd(26)} ${(v.c / v.min).toFixed(2)}/min   draws ${v.dh}/${v.dn} (${(100 * v.dh / v.dn).toFixed(0)}%)   all ${v.ah}/${v.an} (${(100 * v.ah / v.an).toFixed(0)}%)`);
})().catch(e => { console.error(e); process.exit(1); });
