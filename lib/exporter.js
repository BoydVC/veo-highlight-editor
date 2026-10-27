// ffmpeg export: frame-accurate cut + per-frame tracked overlays via sendcmd + label banner.
// Supports two output formats:
//   wide     — source 16:9 frame untouched (YouTube: 1920x1080)
//   vertical — 9:16 crop that auto-follows the tracked player, scaled to 1080x1920
//              (Instagram Reels / YouTube Shorts / TikTok)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// ---- helpers ---------------------------------------------------------------

// opts: { cwd, signal (AbortSignal: kills ffmpeg), onProgress (0-1), totalSec (output
// length the progress is measured against) }
function run(cmd, args, { cwd, signal, onProgress, totalSec } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Error('cancelled'));
    // -progress writes key=value lines to stdout; out_time_us is how far the output has got
    if (onProgress && totalSec > 0) args = ['-progress', 'pipe:1', '-nostats', ...args];
    const proc = spawn(cmd, args, { cwd });
    const onAbort = () => proc.kill();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let err = '', buf = '';
    proc.stderr.on('data', d => { err += d; if (err.length > 60000) err = err.slice(-30000); });
    proc.stdout.on('data', d => {
      if (!onProgress) return;
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const m = /^out_time_us=(\d+)/.exec(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
        if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / totalSec));
      }
    });
    proc.on('error', reject);
    proc.on('close', code => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) return reject(new Error('cancelled'));
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}:\n${err.slice(-3000)}`));
    });
  });
}

function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.slice(-2000))));
  });
}

async function probeMeta(file) {
  const out = await runCapture(ffprobePath, ['-v', 'error', '-show_streams', '-show_data_hash', 'md5',
    '-show_entries', 'format=duration', '-of', 'json', file]);
  const j = JSON.parse(out);
  const v = j.streams.find(s => s.codec_type === 'video');
  if (!v) throw new Error('no video stream in ' + file);
  const rate = (v.avg_frame_rate && v.avg_frame_rate !== '0/0') ? v.avg_frame_rate : v.r_frame_rate;
  const [n, d] = rate.split('/').map(Number);
  return {
    width: v.width, height: v.height,
    fps: d ? n / d : n,
    duration: parseFloat(j.format.duration),
    hasAudio: j.streams.some(s => s.codec_type === 'audio'),
    // SPS/PPS fingerprint: differs between encoders (CPU vs GPU exports) — see stitchClips
    codecSig: v.codec_name + '|' + (v.extradata_hash || ''),
  };
}

// ---- video encoder -------------------------------------------------------------
// NVIDIA NVENC when the GPU and driver can do it (it takes the encode off this PC's
// 4-core CPU), otherwise libx264. Decided once per server run with a tiny test encode;
// CC_ENCODER=cpu forces libx264. Encode sites put VCODEC where the codec args go.
const VCODEC = Symbol('video codec args');
const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'];
const NVENC = ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0',
  '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
let encoderPick;
function videoEncoder() {
  if (!encoderPick) {
    encoderPick = (process.env.CC_ENCODER || '').toLowerCase() === 'cpu'
      ? Promise.resolve(X264)
      : run(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=256x256:d=0.2', ...NVENC, '-f', 'null', '-'])
        .then(() => NVENC, () => X264);
  }
  return encoderPick;
}
const encoderName = async () => (await videoEncoder()) === NVENC ? 'NVIDIA NVENC (GPU)' : 'libx264 (CPU)';

// run an encode with the picked encoder; if NVENC fails (driver hiccup, GPU busy)
// the same encode is redone once on the CPU
async function encode(args, opts) {
  const enc = await videoEncoder();
  const withCodec = codec => args.flatMap(a => a === VCODEC ? codec : [a]);
  try {
    await run(ffmpegPath, withCodec(enc), opts);
  } catch (e) {
    if (enc === X264 || (opts && opts.signal && opts.signal.aborted)) throw e;
    console.warn('NVENC encode failed, redoing it on the CPU:', e.message.split('\n').slice(0, 3).join(' '));
    await run(ffmpegPath, withCodec(X264), opts);
  }
}

function dataUrlToFile(dataUrl, file) {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
}

// Read PNG dimensions straight from the IHDR chunk.
function pngSize(file) {
  const buf = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// Catmull-Rom spline shared with the browser preview — it's an ES module, so import()
const splineReady = import('../public/js/spline.js');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Camera-style smoothing for the 9:16 follow-crop: forward + backward
// exponential averages, blended — no lag, no jitter from raw anchor clicks.
function smoothPath(values, fps) {
  const alpha = Math.min(1, 4 / fps);
  const fwd = [], bwd = new Array(values.length);
  let acc = values[0];
  for (let i = 0; i < values.length; i++) { acc += alpha * (values[i] - acc); fwd.push(acc); }
  acc = values[values.length - 1];
  for (let i = values.length - 1; i >= 0; i--) { acc += alpha * (values[i] - acc); bwd[i] = acc; }
  return values.map((_, i) => (fwd[i] + bwd[i]) / 2);
}

// ---- main export -----------------------------------------------------------
//
// clip:   { name, inMs, outMs, label, anchors: [{ t(ms, absolute), x, y (normalized 0-1) }] }
// assets: { circlePng?, badgePng?, labelPng? }  (data URLs rendered by the client)
// meta:   { width, height, fps, labelSeconds?, format? ('wide'|'vertical') }
// signal / onProgress: see run()
//
async function exportClip({ videoPath, outPath, clip, assets, meta, signal, onProgress }) {
  const { width: W, height: H, fps } = meta;
  const isVertical = meta.format === 'vertical';
  const cropW = isVertical ? Math.round(H * 9 / 16 / 2) * 2 : null;
  const outH = isVertical ? 1920 : H; // for label placement
  const inSec = clip.inMs / 1000;
  const durSec = (clip.outMs - clip.inMs) / 1000;
  if (!(durSec > 0)) throw new Error('clip has zero or negative duration');
  const { splineAt } = await splineReady;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipexp-'));
  try {
    const inputs = ['-ss', inSec.toFixed(3), '-i', videoPath];
    const filters = [];
    let lastV = '[0:v]';
    let nextInput = 1;

    const anchors = (clip.anchors || []).slice().sort((a, b) => a.t - b.t);
    const hasTrack = anchors.length >= 1 && assets && assets.circlePng && assets.badgePng;

    if (hasTrack) {
      // anchors → clip-relative seconds, normalized coords → pixels
      const pts = anchors.map(a => ({ t: (a.t - clip.inMs) / 1000, x: a.x * W, y: a.y * H }));
      const t0 = Math.max(0, pts[0].t), t1 = Math.min(durSec, pts[pts.length - 1].t);

      dataUrlToFile(assets.circlePng, path.join(tmp, 'circle.png'));
      dataUrlToFile(assets.badgePng, path.join(tmp, 'badge.png'));
      const cs = pngSize(path.join(tmp, 'circle.png'));
      const bs = pngSize(path.join(tmp, 'badge.png'));

      // per-frame positions
      const frameDur = 1 / fps;
      const frames = [];
      for (let t = 0; t <= durSec + frameDur; t += frameDur) {
        frames.push({ t, p: splineAt(pts, clamp(t, t0, t1)) });
      }
      // 9:16 follow-camera path (smoothed, clamped to the frame); cropOffset is the
      // user's drag-adjusted shift off the tracked player, normalized to frame width
      let camXs = null;
      if (isVertical) {
        const offX = (clip.cropOffset || 0) * W;
        camXs = smoothPath(frames.map(f => clamp(f.p.x + offX - cropW / 2, 0, W - cropW)), fps);
      }

      // sendcmd script: overlay positions (+ crop pan when vertical), every frame
      const lines = frames.map((f, i) => {
        const cx = clamp(f.p.x - cs.w / 2, -cs.w, W);
        const cy = clamp(f.p.y - cs.h / 2, -cs.h, H);
        const bx = clamp(f.p.x - bs.w / 2, 4, W - bs.w - 4);
        const by = clamp(f.p.y + cs.h / 2 + Math.round(H * 0.012), 4, H - bs.h - 4);
        let cmd = `${f.t.toFixed(4)} overlay@circ x ${cx.toFixed(1)}, overlay@circ y ${cy.toFixed(1)}, ` +
          `overlay@badge x ${bx.toFixed(1)}, overlay@badge y ${by.toFixed(1)}`;
        if (camXs) cmd += `, crop@cam x ${camXs[i].toFixed(1)}`;
        return cmd + ';';
      });
      fs.writeFileSync(path.join(tmp, 'cmds.txt'), lines.join('\n'));

      inputs.push('-i', path.join(tmp, 'circle.png'), '-i', path.join(tmp, 'badge.png'));
      const en = `enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
      const first = splineAt(pts, t0);
      filters.push(`${lastV}sendcmd=f=cmds.txt[sv]`);
      filters.push(`[sv][${nextInput}:v]overlay@circ=x=${(first.x - cs.w / 2).toFixed(1)}:y=${(first.y - cs.h / 2).toFixed(1)}:eval=frame:${en}[cv]`);
      filters.push(`[cv][${nextInput + 1}:v]overlay@badge=x=${(first.x - bs.w / 2).toFixed(1)}:y=${(first.y + cs.h / 2 + Math.round(H * 0.012)).toFixed(1)}:eval=frame:${en}[bv]`);
      lastV = '[bv]';
      nextInput += 2;

      if (isVertical) {
        filters.push(`${lastV}crop@cam=w=${cropW}:h=${H}:x=${camXs[0].toFixed(1)}:y=0[crv]`);
        lastV = '[crv]';
      }
    } else if (isVertical) {
      // no tracking — static crop, centered plus any user offset
      const cx0 = clamp((W - cropW) / 2 + (clip.cropOffset || 0) * W, 0, W - cropW);
      filters.push(`${lastV}crop=w=${cropW}:h=${H}:x=${cx0.toFixed(1)}:y=0[crv]`);
      lastV = '[crv]';
    }

    if (isVertical) {
      filters.push(`${lastV}scale=1080:1920:flags=lanczos,setsar=1[scv]`);
      lastV = '[scv]';
    }

    if (assets && assets.labelPng) {
      dataUrlToFile(assets.labelPng, path.join(tmp, 'label.png'));
      const labelSec = Math.min(meta.labelSeconds || 3, durSec);
      const fadeOutStart = Math.max(0, labelSec - 0.3);
      // -loop 1: a still PNG is a single frame at t=0; looping gives the fade
      // filter a continuous stream of timestamps so fade in/out actually runs
      inputs.push('-loop', '1', '-i', path.join(tmp, 'label.png'));
      filters.push(`[${nextInput}:v]fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.3:alpha=1[lbl]`);
      filters.push(`${lastV}[lbl]overlay=x=(W-w)/2:y=${Math.round(outH * 0.05)}:enable='between(t,0,${labelSec.toFixed(2)})'[lv]`);
      lastV = '[lv]';
      nextInput += 1;
    }

    const args = ['-y', ...inputs, '-t', durSec.toFixed(3)];
    if (filters.length) {
      args.push('-filter_complex', filters.join(';'), '-map', lastV);
    } else {
      args.push('-map', '0:v');
    }
    args.push('-map', '0:a?'); // keep game audio if present
    args.push(
      VCODEC,
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      outPath
    );
    await encode(args, { cwd: tmp, signal, onProgress, totalSec: durSec });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- stitch -----------------------------------------------------------------
// Same-format clips from the same encoder concat losslessly (-c copy). Mixed
// sizes/fps/encoders re-encode:
// everything is scaled + padded to the FIRST clip's dimensions.
// opts: { transition: one of TRANSITIONS, transitionSec,
//         intro/outro: { png (data URL), seconds } — rendered card segments,
//         signal, onProgress — see run() }
const TRANSITIONS = new Set(['fade', 'fadeblack', 'slideleft', 'circleopen']);

// still PNG → short video segment (silent stereo audio so audio chains stay uniform)
async function makeCardSegment(card, tmp, name, W, H, fps, signal) {
  const png = path.join(tmp, name + '.png');
  dataUrlToFile(card.png, png);
  const out = path.join(tmp, name + '.mp4');
  const secs = clamp(parseFloat(card.seconds) || 3.5, 1, 15);
  await encode(['-y',
    '-loop', '1', '-t', secs.toFixed(2), '-i', png,
    '-f', 'lavfi', '-t', secs.toFixed(2), '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=#0d1b33,setsar=1,fps=${fps}[v]`,
    '-map', '[v]', '-map', '1:a',
    VCODEC,
    '-c:a', 'aac', '-b:a', '192k', '-shortest', out], { signal });
  return out;
}

async function stitchClips(inputs, outPath, opts = {}) {
  const trans = TRANSITIONS.has(opts.transition) ? opts.transition : null;
  const D = clamp(parseFloat(opts.transitionSec) || 0.5, 0.2, 1.5);
  const { signal, onProgress } = opts;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stitch-'));
  try {
    let metas = await Promise.all(inputs.map(probeMeta));
    const first = metas[0];
    const W = first.width, H = first.height, fps = Math.round(first.fps * 1000) / 1000;

    let hasCards = false;
    if (opts.intro && opts.intro.png) {
      const seg = await makeCardSegment(opts.intro, tmp, 'intro', W, H, fps, signal);
      inputs = [seg, ...inputs]; metas = [await probeMeta(seg), ...metas]; hasCards = true;
    }
    if (opts.outro && opts.outro.png) {
      const seg = await makeCardSegment(opts.outro, tmp, 'outro', W, H, fps, signal);
      inputs = [...inputs, seg]; metas = [...metas, await probeMeta(seg)]; hasCards = true;
    }

    const uniform = metas.every(m =>
      m.width === first.width && m.height === first.height &&
      Math.abs(m.fps - first.fps) < 0.02 && m.hasAudio === first.hasAudio &&
      m.codecSig === first.codecSig); // stream copy can't splice different encoder headers
    const allAudio = metas.every(m => m.hasAudio);
    const sumSec = metas.reduce((s, m) => s + m.duration, 0);
    const prog = totalSec => ({ signal, onProgress, totalSec });

    if (trans) {
      // xfade/acrossfade chain — always a re-encode
      const args = ['-y'];
      inputs.forEach(f => args.push('-i', f));
      const parts = [];
      metas.forEach((m, i) => {
        parts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}[v${i}]`);
        if (allAudio) parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
      });
      let vcur = '[v0]', acur = '[a0]';
      let off = metas[0].duration;
      for (let i = 1; i < inputs.length; i++) {
        const last = i === inputs.length - 1;
        const vout = last ? '[v]' : `[vx${i}]`;
        parts.push(`${vcur}[v${i}]xfade=transition=${trans}:duration=${D}:offset=${Math.max(0, off - D).toFixed(3)}${vout}`);
        vcur = vout;
        if (allAudio) {
          const aout = last ? '[a]' : `[ax${i}]`;
          parts.push(`${acur}[a${i}]acrossfade=d=${D}${aout}`);
          acur = aout;
        }
        off += metas[i].duration - D;
      }
      args.push('-filter_complex', parts.join(';'), '-map', '[v]');
      if (allAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
      args.push(VCODEC);
      args.push('-movflags', '+faststart', outPath);
      await encode(args, prog(sumSec - D * (inputs.length - 1)));
      return;
    }

    if (uniform && !hasCards) {
      const list = inputs.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
      const listFile = path.join(tmp, 'list.txt');
      fs.writeFileSync(listFile, list);
      await run(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath], prog(sumSec));
      return;
    }

    const args = ['-y'];
    inputs.forEach(f => args.push('-i', f));
    const parts = [];
    const labels = [];
    metas.forEach((m, i) => {
      parts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}[v${i}]`);
      labels.push(`[v${i}]`);
      if (allAudio) {
        parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
        labels.push(`[a${i}]`);
      }
    });
    parts.push(`${labels.join('')}concat=n=${inputs.length}:v=1:a=${allAudio ? 1 : 0}` +
      (allAudio ? '[v][a]' : '[v]'));
    args.push('-filter_complex', parts.join(';'), '-map', '[v]');
    if (allAudio) args.push('-map', '[a]');
    args.push(VCODEC);
    if (allAudio) args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-movflags', '+faststart', outPath);
    await encode(args, prog(sumSec));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { exportClip, stitchClips, probeMeta, encoderName };
