// Experiment 1 (negative): do audio loudness / whistle-band peaks predict where the user's clips start?
// Usage: node tools/experiments/audio-peaks.js   (needs games/ + projects/ sidecars; no server)
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..'); // repo root
const ffmpeg = require(ROOT + '/node_modules/ffmpeg-static');
const SR = 16000, WIN = 0.2, N = SR * WIN;           // 200 ms windows

function biquadBP(f0, Q) {                             // RBJ band-pass (constant skirt gain)
  const w = 2 * Math.PI * f0 / SR, a = Math.sin(w) / (2 * Q), c = Math.cos(w);
  const b0 = a, b1 = 0, b2 = -a, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
function analyze(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', '-']);
    const bp = biquadBP(3300, 1.2);                    // referee whistle band ~2.5–4.5 kHz
    const rms = [], wrms = []; let acc = 0, wacc = 0, n = 0, carry = null;
    p.stdout.on('data', buf => {
      if (carry) { buf = Buffer.concat([carry, buf]); carry = null; }
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const s = buf.readInt16LE(i) / 32768; const w = bp(s);
        acc += s * s; wacc += w * w; n++;
        if (n === N) { rms.push(Math.sqrt(acc / N)); wrms.push(Math.sqrt(wacc / N)); acc = wacc = n = 0; }
      }
      if (usable < buf.length) carry = buf.subarray(usable);
    });
    p.on('close', code => code ? reject(new Error('ffmpeg ' + code)) : resolve({ rms, wrms }));
  });
}
const db = v => 20 * Math.log10(v + 1e-9);
function baseline(arr, secs) {                          // rolling median over ±secs
  const half = Math.round(secs / WIN), out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const s = arr.slice(Math.max(0, i - half), Math.min(arr.length, i + half)).slice().sort((a, b) => a - b);
    out[i] = s[Math.floor(s.length / 2)];
  }
  return out;
}
function peaks(score, thr, mergeSec) {
  const out = []; const gap = mergeSec / WIN;
  for (let i = 1; i < score.length - 1; i++) {
    if (score[i] > thr && score[i] >= score[i - 1] && score[i] >= score[i + 1]) {
      const t = i * WIN;
      if (out.length && i - out[out.length - 1].i < gap) { if (score[i] > out[out.length - 1].s) out[out.length - 1] = { i, t, s: score[i] }; }
      else out.push({ i, t, s: score[i] });
    }
  }
  return out;
}
(async () => {
  const games = fs.readdirSync(ROOT + '/games').filter(f => /\.(mp4|mov)$/i.test(f) && !f.startsWith('Test'));
  const grand = {};
  for (const g of games) {
    const base = path.basename(g, path.extname(g)).replace(/[^\w\- ]+/g, '_');
    const pj = ROOT + '/projects/' + base + '.json'; if (!fs.existsSync(pj)) continue;
    const clips = JSON.parse(fs.readFileSync(pj)).clips || []; if (!clips.length) continue;
    const t0 = Date.now(); const { rms, wrms } = await analyze(ROOT + '/games/' + g);
    const dur = rms.length * WIN;
    const e = rms.map(db), w = wrms.map(db);
    const eb = baseline(e, 45), wb = baseline(w, 45);
    const eScore = e.map((v, i) => v - eb[i]);                       // crowd/loudness lift in dB
    const wScore = w.map((v, i) => (v - wb[i]) - 0.5 * (e[i] - eb[i])); // whistle band lift beyond general loudness
    console.log(`\n${g}  (${(dur / 60).toFixed(1)} min, ${clips.length} clips, analyzed in ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    for (const [label, score, thrs] of [['crowd', eScore, [6, 8, 10]], ['whistle', wScore, [8, 10, 12]], ['either', eScore.map((v, i) => Math.max(v, wScore[i] - 2)), [6, 8, 10]]]) {
      for (const thr of thrs) {
        const cand = peaks(score, thr, 8);
        const hits = clips.filter(c => cand.some(k => k.t * 1000 >= c.inMs - 15000 && k.t * 1000 <= c.inMs + 6000)).length;
        console.log(`  ${label.padEnd(7)} thr ${String(thr).padStart(2)} dB: ${String(cand.length).padStart(3)} candidates (${(cand.length / (dur / 60)).toFixed(1)}/min)  recall ${hits}/${clips.length}`);
        const key = `${label}@${thr}`; grand[key] = grand[key] || { c: 0, h: 0, n: 0, min: 0 };
        grand[key].c += cand.length; grand[key].h += hits; grand[key].n += clips.length; grand[key].min += dur / 60;
      }
    }
  }
  console.log('\n=== all games ===');
  for (const [k, v] of Object.entries(grand)) console.log(`${k.padEnd(12)} recall ${v.h}/${v.n} (${(100 * v.h / v.n).toFixed(0)}%)  ${(v.c / v.min).toFixed(1)} candidates/min`);
})().catch(e => { console.error(e); process.exit(1); });
