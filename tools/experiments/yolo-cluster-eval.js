// Experiment 3 (negative), step 2: evaluate the YOLO cluster series (and cluster ∧ whistle) against Draw Win clips.
// Usage: node tools/experiments/yolo-cluster-eval.js <cluster.json> <game file>
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..'); // repo root
const ffmpeg = require(ROOT + '/node_modules/ffmpeg-static');
const [,, clusterJson, gameFile] = process.argv;
const rows = JSON.parse(fs.readFileSync(clusterJson));          // [sec, nPersons, maxNeighbours, cx, cy]
const base = path.basename(gameFile, path.extname(gameFile)).replace(/[^\w\- ]+/g, '_');
const clips = JSON.parse(fs.readFileSync(`${ROOT}/projects/${base}.json`)).clips || [];
const draws = clips.filter(c => /draw/i.test(c.label || ''));
const minutes = rows.length / 60;

// whistle score per second (same band-pass as the audio experiment)
const SR = 16000;
function biquadBP(f0, Q) { const w = 2*Math.PI*f0/SR, a = Math.sin(w)/(2*Q), c = Math.cos(w); const b0=a,b2=-a,a0=1+a,a1=-2*c,a2=1-a; let x1=0,x2=0,y1=0,y2=0; return x=>{const y=(b0*x+b2*x2-a1*y1-a2*y2)/a0; x2=x1;x1=x;y2=y1;y1=y;return y;}; }
function whistlePerSecond(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v','error','-i',file,'-vn','-ac','1','-ar',String(SR),'-f','s16le','-']);
    const bp = biquadBP(3300, 1.2); const N = SR; const e = [], w = []; let acc=0, wacc=0, n=0, carry=null;
    p.stdout.on('data', buf => { if (carry) { buf = Buffer.concat([carry, buf]); carry = null; } const u = buf.length - buf.length % 2;
      for (let i = 0; i < u; i += 2) { const s = buf.readInt16LE(i)/32768, x = bp(s); acc += s*s; wacc += x*x; if (++n === N) { e.push(Math.sqrt(acc/N)); w.push(Math.sqrt(wacc/N)); acc=wacc=n=0; } }
      if (u < buf.length) carry = buf.subarray(u); });
    p.on('close', code => { if (code) return reject(new Error('ffmpeg ' + code));
      const db = v => 20*Math.log10(v+1e-9); const E = e.map(db), Wd = w.map(db);
      const med = (arr, i, h) => { const s = arr.slice(Math.max(0,i-h), i+h).slice().sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };
      resolve(E.map((_, i) => (Wd[i] - med(Wd, i, 45)) - 0.5 * (E[i] - med(E, i, 45)))); });
  });
}
function merge(secs, gap) { const out = []; for (const t of secs) if (!out.length || t - out[out.length-1] > gap) out.push(t); return out; }
const hit = (arr, cand, pre, post) => arr.filter(c => cand.some(t => t*1000 >= c.inMs - pre && t*1000 <= c.inMs + post)).length;

(async () => {
  const wh = await whistlePerSecond(gameFile);
  console.log(`${path.basename(gameFile)}: ${minutes.toFixed(1)} min, ${draws.length} draw clips / ${clips.length} clips`);
  console.log(`persons/frame median ${rows.map(r=>r[1]).sort((a,b)=>a-b)[Math.floor(rows.length/2)]}, maxNeighbours distribution:`,
    JSON.stringify(Object.fromEntries([2,3,4,5,6,7,8,9,10].map(k => [k, rows.filter(r => r[2] >= k).length]))));
  console.log('\nK = players within ~180px of each other; run = consecutive seconds ≥K');
  console.log('cond                 cand  /min   draws     all-clips');
  for (const K of [4,5,6,7,8]) for (const run of [1,2,3]) {
    const secs = [];
    for (let i = 0; i + run <= rows.length; i++) if (rows.slice(i, i+run).every(r => r[2] >= K)) secs.push(rows[i][0]);
    const cand = merge(secs, 20);
    const candW = cand.filter(t => { for (let d = -6; d <= 6; d++) if (wh[t+d] !== undefined && wh[t+d] > 6) return true; return false; });
    const line = (name, c) => console.log(`${name.padEnd(20)} ${String(c.length).padStart(4)}  ${(c.length/minutes).toFixed(2)}   ${String(hit(draws,c,12000,8000)).padStart(2)}/${draws.length}      ${String(hit(clips,c,12000,8000)).padStart(2)}/${clips.length}`);
    line(`K≥${K} run${run}`, cand); line(`K≥${K} run${run} +whistle`, candW);
  }
  // where are the draws in the series? print cluster value around each draw clip start
  console.log('\nper-draw cluster max within [-12s,+8s] of clip start (should be high if detector works):');
  for (const c of draws) { const s = Math.round(c.inMs/1000); const win = rows.filter(r => r[0] >= s-12 && r[0] <= s+8); console.log(`  ${c.name.replace(/^.*?(\d\d\b)/,'$1').slice(0,20).padEnd(20)} t=${s}s  maxK=${Math.max(...win.map(r=>r[2]))}  persons=${Math.max(...win.map(r=>r[1]))}  whistle=${Math.max(...win.map(r=>wh[r[0]]||-99)).toFixed(0)}dB`); }
})().catch(e => { console.error(e); process.exit(1); });
