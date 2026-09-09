/* Charlotte Clips — frontend. Sections:
   state · utils · video loading · render loop · timeline · keyboard ·
   clips · labels · tracking · overlay art (badge/circle/label) · export · settings */
'use strict';

// ---------- state ------------------------------------------------------------
const $ = id => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), wrap = $('videoWrap');
const timeline = $('timeline');

// The Playwright UI test opens the app with ?testRun=1 so its exports land in clips/_test/
const TEST_RUN = new URLSearchParams(location.search).has('testRun');

const state = {
  videoPath: null, videoName: null,
  fps: 30, duration: 0, vw: 1920, vh: 1080,
  inMs: null, outMs: null,
  clips: [], selectedId: null,
  tracking: null,            // { clipId }
  view: { start: 0, end: 0 }, // timeline zoom window (seconds)
  speedSteps: [1, 2, 4, 8, 16], speedIdx: 0,
  exporting: false,
};

const DEFAULT_SETTINGS = {
  name: 'CHARLOTTE', number: '7',
  badgeColor: '#d92a6c', textColor: '#ffd400', circleColor: '#ffd400',
  badgeScale: 1, circleScale: 1, labelSeconds: 3,
  labels: ['Goal', 'Assist', 'Shot', 'Draw Win', 'Ground Ball', 'Dodge', 'Dribble', 'Steal', 'Defense'],
};
let settings = loadSettings();

// ---------- utils ------------------------------------------------------------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const frameDur = () => 1 / state.fps;

function fmtTime(sec, ms = true) {
  if (!isFinite(sec)) sec = 0;
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = Math.floor(sec) % 60;
  const mil = Math.floor((sec % 1) * 1000);
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return ms ? `${base}.${String(mil).padStart(3, '0')}` : base;
}

let toastTimer;
function toast(msg, isErr = false, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.className = isErr ? 'err' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// Catmull-Rom through anchors — MUST match lib/exporter.js splineAt()
function splineAt(anchors, t) {
  const n = anchors.length;
  if (n === 1) return { x: anchors[0].x, y: anchors[0].y };
  if (t <= anchors[0].t) return { x: anchors[0].x, y: anchors[0].y };
  if (t >= anchors[n - 1].t) return { x: anchors[n - 1].x, y: anchors[n - 1].y };
  let i = 0;
  while (i < n - 2 && anchors[i + 1].t < t) i++;
  const p1 = anchors[i], p2 = anchors[i + 1];
  const p0 = anchors[Math.max(0, i - 1)], p3 = anchors[Math.min(n - 1, i + 2)];
  const u = (t - p1.t) / (p2.t - p1.t || 1);
  const u2 = u * u, u3 = u2 * u;
  const cr = (a, b, c, d) =>
    0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) };
}

// displayed video rectangle inside the wrap (object-fit: contain letterboxing)
function videoRect() {
  const r = wrap.getBoundingClientRect();
  const scale = Math.min(r.width / state.vw, r.height / state.vh) || 1;
  const w = state.vw * scale, h = state.vh * scale;
  return { x: (r.width - w) / 2, y: (r.height - h) / 2, w, h, scale, wrapW: r.width, wrapH: r.height };
}

// ---------- video library / loading -------------------------------------------
async function refreshVideos() {
  const res = await fetch('/api/videos').then(r => r.json());
  const sel = $('videoSelect');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— choose a game —</option>' +
    res.files.map(f => `<option value="${encodeURIComponent(f.path)}">${f.name} (${(f.size / 1e9).toFixed(2)} GB)</option>`).join('');
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  if (!res.files.length) toast(`No videos found — drop game files into ${res.gamesDir}`, true, 5000);
}

async function loadVideo(encPath) {
  const p = decodeURIComponent(encPath);
  state.videoPath = p;
  state.videoName = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  $('dropHint').classList.add('hidden');
  exitTracking(true);

  const meta = await fetch('/api/probe?path=' + encodeURIComponent(p)).then(r => r.json());
  state.fps = meta.fps || 30;
  state.vw = meta.width; state.vh = meta.height;
  state.duration = meta.duration;
  state.view = { start: 0, end: meta.duration };
  state.inMs = state.outMs = null;
  $('videoMeta').textContent = `${meta.width}×${meta.height} · ${meta.fps.toFixed(2)} fps · ${fmtTime(meta.duration, false)}`;
  $('durcode').textContent = '/ ' + fmtTime(meta.duration);

  video.src = '/video?path=' + encodeURIComponent(p);
  video.load();
  restoreSpeed();
  resetThumbs();

  const proj = await fetch('/api/project?video=' + encodeURIComponent(p)).then(r => r.json());
  state.clips = proj.clips || [];
  state.selectedId = state.clips[0] ? state.clips[0].id : null;
  renderClips();
  drawTimeline();
}

let saveTimer;
function saveProject() {
  if (!state.videoPath) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/project', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video: state.videoPath, data: { clips: state.clips } }),
    }).catch(() => toast('Autosave failed', true));
  }, 700);
}

// ---------- render loop (timecode + overlay preview) ---------------------------
function renderLoop() {
  $('timecode').textContent = fmtTime(video.currentTime || 0);
  drawOverlay();
  drawTimeline();
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype && !video.paused) {
    video.requestVideoFrameCallback(renderLoop);
  } else {
    requestAnimationFrame(renderLoop);
  }
}
requestAnimationFrame(renderLoop);

video.addEventListener('play', () => { $('playBtn').classList.add('playing'); renderLoop(); });
video.addEventListener('pause', () => { $('playBtn').classList.remove('playing'); });

// ---------- overlay preview -----------------------------------------------------
function drawOverlay() {
  const r = videoRect();
  const dpr = window.devicePixelRatio || 1;
  if (overlay.width !== Math.round(r.wrapW * dpr) || overlay.height !== Math.round(r.wrapH * dpr)) {
    overlay.width = Math.round(r.wrapW * dpr);
    overlay.height = Math.round(r.wrapH * dpr);
  }
  const ctx = overlay.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.wrapW, r.wrapH);
  if (!state.videoPath) return;

  const clip = state.tracking
    ? state.clips.find(c => c.id === state.tracking.clipId)
    : state.clips.find(c => c.id === state.selectedId);

  wrap.classList.toggle('cropAdj', exportFormat() === 'vertical' && !!clip && !state.tracking);
  if (exportFormat() === 'vertical') drawCropGuide(ctx, r, clip);
  if (!clip || !clip.anchors || !clip.anchors.length) return;

  const tMs = video.currentTime * 1000;
  const anchors = clip.anchors;
  const within = tMs >= anchors[0].t - 1 && tMs <= anchors[anchors.length - 1].t + 1;
  if (!within && !state.tracking) return;

  const pos = splineAt(anchors, clamp(tMs, anchors[0].t, anchors[anchors.length - 1].t));
  const px = r.x + pos.x * r.w, py = r.y + pos.y * r.h;
  const ds = r.w / state.vw; // display scale

  const circle = getCircleCanvas(), badge = getBadgeCanvas();
  if (within || !state.tracking) {
    ctx.drawImage(circle, px - circle.width * ds / 2, py - circle.height * ds / 2, circle.width * ds, circle.height * ds);
    const bw = badge.width * ds, bh = badge.height * ds;
    const bx = clamp(px - bw / 2, 4, r.wrapW - bw - 4);
    const by = clamp(py + circle.height * ds / 2 + state.vh * 0.012 * ds, 4, r.wrapH - bh - 4);
    ctx.drawImage(badge, bx, by, bw, bh);
  }

  if (state.tracking) {
    // show placed anchors as dots so you can see your trail
    ctx.fillStyle = 'rgba(255,212,0,.9)';
    for (const a of anchors) {
      const ax = r.x + a.x * r.w, ay = r.y + a.y * r.h;
      ctx.beginPath(); ctx.arc(ax, ay, 3, 0, 7); ctx.fill();
    }
  }
}

// dashed window showing what survives the 9:16 Reels crop (export smooths the
// pan with a camera filter; this guide follows the raw spline — close enough)
function drawCropGuide(ctx, r, clip) {
  const cw = (state.vh * 9 / 16) * (r.w / state.vw);
  let centerX = r.x + r.w / 2;
  if (clip && clip.anchors && clip.anchors.length) {
    const a = clip.anchors;
    const tMs = clamp(video.currentTime * 1000, a[0].t, a[a.length - 1].t);
    centerX = r.x + splineAt(a, tMs).x * r.w;
  }
  if (clip && clip.cropOffset) centerX += clip.cropOffset * r.w; // user-dragged shift off the tracked player
  const left = clamp(centerX - cw / 2, r.x, r.x + r.w - cw);
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fillRect(r.x, r.y, left - r.x, r.h);
  ctx.fillRect(left + cw, r.y, r.x + r.w - left - cw, r.h);
  ctx.strokeStyle = 'rgba(255,255,255,.65)';
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(left, r.y + 1, cw, r.h - 2);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.fillText('9:16', left + 6, r.y + 16);
}

// ---------- 9:16 crop offset drag -------------------------------------------------
// In Reels mode, drag the video horizontally to shift the crop window off the tracked
// player — for when the action is to her left/right. Stored per clip, normalized 0-1.
let cropDrag = null;
wrap.addEventListener('pointerdown', e => {
  if (state.tracking || exportFormat() !== 'vertical') return;
  const c = selected();
  if (!c) return;
  const r = videoRect();
  cropDrag = { startX: e.clientX, startOff: c.cropOffset || 0, rw: r.w, clip: c, moved: false };
  wrap.setPointerCapture(e.pointerId);
});
wrap.addEventListener('pointermove', e => {
  if (!cropDrag) return;
  const dx = e.clientX - cropDrag.startX;
  if (Math.abs(dx) > 2) cropDrag.moved = true;
  cropDrag.clip.cropOffset = clamp(cropDrag.startOff + dx / cropDrag.rw, -0.5, 0.5);
  drawOverlay();
});
wrap.addEventListener('pointerup', () => {
  if (!cropDrag) return;
  if (cropDrag.moved) {
    const px = Math.round((cropDrag.clip.cropOffset || 0) * state.vw);
    toast(`9:16 crop shifted ${px > 0 ? '+' : ''}${px}px — double-click video to recenter`, false, 2500);
    saveProject();
  }
  cropDrag = null;
});
wrap.addEventListener('dblclick', () => {
  if (state.tracking || exportFormat() !== 'vertical') return;
  const c = selected();
  if (c && c.cropOffset) { c.cropOffset = 0; saveProject(); drawOverlay(); toast('Crop recentered on the tracked player'); }
});

// ---------- timeline -------------------------------------------------------------
// palette comes from the CSS tokens in styles.css so the canvas matches the theme
const TL = (() => {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return { bg: v('--tl-bg'), tick: v('--tl-tick'), text: v('--tl-text'), clip: v('--accent-a22'),
           clipSel: v('--accent-a55'), anchor: v('--anchor'), in: v('--in'), out: v('--out'), playhead: v('--playhead') };
})();
function drawTimeline() {
  const dpr = window.devicePixelRatio || 1;
  const w = timeline.clientWidth, h = timeline.clientHeight;
  if (!w) return;
  if (timeline.width !== Math.round(w * dpr) || timeline.height !== Math.round(h * dpr)) {
    timeline.width = Math.round(w * dpr); timeline.height = Math.round(h * dpr);
  }
  const ctx = timeline.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = TL.bg; ctx.fillRect(0, 0, w, h);
  if (!state.duration) return;

  const { start, end } = state.view;
  const span = end - start;
  const xOf = sec => ((sec - start) / span) * w;

  // ruler ticks
  const target = span / (w / 90);
  const steps = [0.033, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1200];
  const step = steps.find(s => s >= target) || 1800;
  ctx.strokeStyle = TL.tick; ctx.font = '10px "JetBrains Mono", "Cascadia Code", Consolas, monospace';
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) {
    const x = xOf(t);
    ctx.strokeStyle = TL.tick; ctx.beginPath(); ctx.moveTo(x, h - 16); ctx.lineTo(x, h); ctx.stroke();
    ctx.fillStyle = TL.text;
    ctx.fillText(fmtTime(t, step < 1), x + 3, h - 4);
  }

  // clip regions
  for (const c of state.clips) {
    const x1 = xOf(c.inMs / 1000), x2 = xOf(c.outMs / 1000);
    if (x2 < 0 || x1 > w) continue;
    const sel = c.id === state.selectedId;
    ctx.fillStyle = sel ? TL.clipSel : TL.clip;
    ctx.fillRect(x1, 6, Math.max(2, x2 - x1), h - 28);
    if (sel && c.anchors) {
      ctx.fillStyle = TL.anchor;
      for (const a of c.anchors) {
        const ax = xOf(a.t / 1000);
        ctx.fillRect(ax - 1, 8, 2, 6);
      }
    }
  }

  // pending in/out marks
  if (state.inMs != null) { ctx.strokeStyle = TL.in; ctx.lineWidth = 2; const x = xOf(state.inMs / 1000); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  if (state.outMs != null) { ctx.strokeStyle = TL.out; ctx.lineWidth = 2; const x = xOf(state.outMs / 1000); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }

  // playhead
  const px = xOf(video.currentTime);
  ctx.strokeStyle = TL.playhead; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();

  // keep playhead visible while playing
  if (!video.paused && (video.currentTime > end || video.currentTime < start)) {
    state.view.start = clamp(video.currentTime - span * 0.1, 0, Math.max(0, state.duration - span));
    state.view.end = state.view.start + span;
  }
}

timeline.addEventListener('wheel', e => {
  e.preventDefault();
  if (!state.duration) return;
  const rect = timeline.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  const { start, end } = state.view;
  const span = end - start;
  const cursorT = start + frac * span;
  const factor = e.deltaY > 0 ? 1.25 : 0.8;
  let newSpan = clamp(span * factor, 0.5, state.duration);
  let newStart = clamp(cursorT - frac * newSpan, 0, state.duration - newSpan);
  state.view = { start: newStart, end: newStart + newSpan };
  drawTimeline();
}, { passive: false });

let scrubbing = false;
function timelineSeek(e) {
  const rect = timeline.getBoundingClientRect();
  const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  video.currentTime = state.view.start + frac * (state.view.end - state.view.start);
}
timeline.addEventListener('mousedown', e => { scrubbing = true; timelineSeek(e); });
window.addEventListener('mousemove', e => { if (scrubbing) timelineSeek(e); });
window.addEventListener('mouseup', () => scrubbing = false);
timeline.addEventListener('dblclick', () => { state.view = { start: 0, end: state.duration }; drawTimeline(); });

// video/timeline split — drag the divider under the video to grow/shrink the timeline
const divider = $('paneDivider');
const TL_MIN = 28, TL_MAX = 200, TL_DEFAULT = 64;
function setTimelineH(px) {
  const h = clamp(Math.round(px), TL_MIN, TL_MAX);
  document.documentElement.style.setProperty('--tlH', h + 'px');
  localStorage.setItem('cc.timelineH', h);
  drawTimeline(); drawOverlay();
}
{
  const saved = parseFloat(localStorage.getItem('cc.timelineH'));
  if (saved) setTimelineH(saved);
}
let divDrag = null;
divider.addEventListener('pointerdown', e => {
  divDrag = { y: e.clientY, h: timeline.clientHeight };
  divider.classList.add('dragging');
  divider.setPointerCapture(e.pointerId);
  e.preventDefault();
});
divider.addEventListener('pointermove', e => {
  if (divDrag) setTimelineH(divDrag.h - (e.clientY - divDrag.y));
});
divider.addEventListener('pointerup', () => { divDrag = null; divider.classList.remove('dragging'); });
divider.addEventListener('dblclick', () => setTimelineH(TL_DEFAULT));
video.addEventListener('seeked', () => { drawOverlay(); drawTimeline(); $('timecode').textContent = fmtTime(video.currentTime); });

// ---------- transport ---------------------------------------------------------
function stepFrames(n) {
  if (!state.duration) return;
  video.pause();
  const f = Math.round(video.currentTime * state.fps);
  video.currentTime = clamp((f + n + 0.5) / state.fps, 0, state.duration - 0.01);
}
function jump(sec) { video.currentTime = clamp(video.currentTime + sec, 0, state.duration - 0.01); }
function togglePlay() { video.paused ? video.play() : video.pause(); }

$('playBtn').onclick = togglePlay;
document.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => jump(parseFloat(b.dataset.seek)));
document.querySelectorAll('[data-step]').forEach(b => b.onclick = () => stepFrames(parseInt(b.dataset.step)));
// playback speed — 16× is the browser ceiling; the last speed is remembered per browser
function setSpeed(sp) {
  sp = clamp(sp, 0.25, 16);
  video.playbackRate = sp;
  $('speed').value = String(sp);
  const i = state.speedSteps.indexOf(sp);
  if (i >= 0) state.speedIdx = i;
  try { localStorage.setItem('cc-speed', String(sp)); } catch { /* storage unavailable */ }
}
function restoreSpeed() {
  try { const sp = parseFloat(localStorage.getItem('cc-speed')); if (sp) setSpeed(sp); } catch { /* ignore */ }
}
$('speed').onchange = e => setSpeed(parseFloat(e.target.value));
$('markIn').onclick = () => setIn();
$('markOut').onclick = () => setOut();
$('makeClip').onclick = () => createClip();
$('refreshVideos').onclick = refreshVideos;
$('videoSelect').onchange = e => { if (e.target.value) loadVideo(e.target.value); };
$('skipFrames').onchange = e => e.target.blur(); // keep arrow keys on the video, not the dropdown

// export format: 16:9 (YouTube) or 9:16 follow-crop (Reels/Shorts/TikTok)
$('exportFormat').value = localStorage.getItem('cc-format') || 'wide';
$('exportFormat').onchange = e => {
  localStorage.setItem('cc-format', e.target.value);
  e.target.blur();
  drawOverlay();
  if (e.target.value === 'vertical') toast('9:16 mode — dashed guide shows the Reels crop (follows tracking) · drag the video to shift it left/right', false, 4500);
};
const exportFormat = () => $('exportFormat').value;

function setIn() {
  state.inMs = Math.round(video.currentTime * 1000);
  if (state.outMs != null && state.outMs <= state.inMs) state.outMs = null;
  toast('In ⇤ ' + fmtTime(state.inMs / 1000)); drawTimeline();
}
function setOut() {
  state.outMs = Math.round(video.currentTime * 1000);
  if (state.inMs != null && state.inMs >= state.outMs) state.inMs = null;
  toast('Out ⇥ ' + fmtTime(state.outMs / 1000)); drawTimeline();
}

// ---------- clip thumbnails ------------------------------------------------------
// One frame grabbed at each clip's in-point on a hidden <video>, kept in memory for the
// session (nothing is persisted). Keyed by id + inMs so a nudged in-point refreshes it.
const thumbs = new Map();
const thumbKey = c => c.id + ':' + c.inMs;
const thumbVideo = document.createElement('video');
thumbVideo.muted = true; thumbVideo.preload = 'auto';
let thumbQueue = [], thumbBusy = false;
const once = (el, ev, ms = 8000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { el.removeEventListener(ev, h); reject(new Error(ev + ' timeout')); }, ms);
  const h = () => { clearTimeout(t); el.removeEventListener(ev, h); resolve(); };
  el.addEventListener(ev, h);
});
function resetThumbs() {
  thumbs.clear(); thumbQueue = [];
  thumbVideo.removeAttribute('src'); thumbVideo.dataset.src = ''; thumbVideo.load();
}
function requestThumb(c) {
  if (!state.videoPath || thumbs.has(thumbKey(c)) || thumbQueue.includes(c)) return;
  thumbQueue.push(c); pumpThumbs();
}
async function pumpThumbs() {
  if (thumbBusy || !thumbQueue.length) return;
  thumbBusy = true;
  const c = thumbQueue.shift();
  try {
    if (thumbVideo.dataset.src !== state.videoPath) {
      thumbVideo.src = video.src; thumbVideo.dataset.src = state.videoPath;
      await once(thumbVideo, 'loadedmetadata');
    }
    thumbVideo.currentTime = c.inMs / 1000 + 0.04;
    await once(thumbVideo, 'seeked');
    const cv = document.createElement('canvas'); cv.width = 192; cv.height = 108;
    cv.getContext('2d').drawImage(thumbVideo, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL('image/jpeg', 0.72);
    thumbs.set(thumbKey(c), url);
    const img = document.querySelector(`.clip[data-id="${c.id}"] .thumb img`);
    if (img) img.src = url;
  } catch { /* leave the placeholder; nothing else depends on it */ }
  finally { thumbBusy = false; pumpThumbs(); }
}

// ---------- clips ----------------------------------------------------------------
function autoName(clip, idx) {
  const n = String(idx + 1).padStart(2, '0');
  return `${state.videoName} ${n}${clip.label ? ' ' + clip.label : ''}`.replace(/ {2,}/g, ' ');
}

function createClip() {
  if (state.inMs == null || state.outMs == null) return toast('Set In (I) and Out (O) first', true);
  const clip = { id: uid(), name: '', custom: false, inMs: state.inMs, outMs: state.outMs, label: null, anchors: [], exportedFile: null };
  // insert at the timeline-sorted spot without re-sorting, so manual reordering survives
  const at = state.clips.findIndex(x => x.inMs > clip.inMs);
  at === -1 ? state.clips.push(clip) : state.clips.splice(at, 0, clip);
  renameAuto();
  state.selectedId = clip.id;
  state.inMs = state.outMs = null;
  renderClips(); drawTimeline(); saveProject();
  toast(`✂ Clip created (${((clip.outMs - clip.inMs) / 1000).toFixed(2)}s) — press 1–9 to label, T to track`);
}

function renameAuto() {
  state.clips.forEach((c, i) => { if (!c.custom) c.name = autoName(c, i); });
}

function selected() { return state.clips.find(c => c.id === state.selectedId); }

function deleteClip(id) {
  const c = state.clips.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Delete clip "${c.name}"?`)) return;
  state.clips = state.clips.filter(x => x.id !== id);
  if (state.selectedId === id) state.selectedId = state.clips[0] ? state.clips[0].id : null;
  renameAuto(); renderClips(); drawTimeline(); saveProject();
}

function moveClip(id, dir) {
  const i = state.clips.findIndex(c => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.clips.length) return;
  [state.clips[i], state.clips[j]] = [state.clips[j], state.clips[i]];
  renameAuto(); renderClips(); drawTimeline(); saveProject();
}

function nudge(which, frames) {
  const c = selected();
  if (!c) return toast('No clip selected', true);
  const d = Math.round(frames * frameDur() * 1000);
  if (which === 'in') c.inMs = clamp(c.inMs + d, 0, c.outMs - 33);
  else c.outMs = clamp(c.outMs + d, c.inMs + 33, state.duration * 1000);
  video.currentTime = (which === 'in' ? c.inMs : c.outMs) / 1000;
  renderClips(); drawTimeline(); saveProject();
  toast(`${which.toUpperCase()} ${d > 0 ? '+' : ''}${d}ms → ${fmtTime((which === 'in' ? c.inMs : c.outMs) / 1000)}`);
}

function renderClips() {
  const list = $('clipList');
  $('clipCount').textContent = state.clips.length ? `(${state.clips.length})` : '';
  list.innerHTML = '';
  for (const c of state.clips) {
    const div = document.createElement('div');
    div.className = 'clip' + (c.id === state.selectedId ? ' selected' : '');
    const dur = ((c.outMs - c.inMs) / 1000).toFixed(2);
    div.dataset.id = c.id;
    const th = thumbs.get(thumbKey(c));
    div.innerHTML = `
      <div class="thumb"><img alt=""${th ? ` src="${th}"` : ''}><span class="dur">${dur}s</span></div>
      <div class="body">
        <div class="name" title="double-click to rename">${escapeHtml(c.name)}</div>
        <div class="sub"><span>${fmtTime(c.inMs / 1000)} → ${fmtTime(c.outMs / 1000)}</span></div>
        <div class="chips">
          ${c.label ? `<span class="badge-label">${escapeHtml(c.label)}</span>` : ''}
          ${c.anchors && c.anchors.length ? `<span class="track-ok">${c.anchors.length} anchors</span>` : '<span class="sub">not tracked</span>'}
        </div>
      </div>
      <div class="actions">
          <button data-act="up" title="Move up in export order (Alt+↑)">▲</button>
          <button data-act="dn" title="Move down in export order (Alt+↓)">▼</button>
          <button data-act="go" title="Jump to the clip start">Go</button>
          <button data-act="play" title="Play the clip with the overlay preview">Review</button>
          <button data-act="track" title="Track her through this clip (T)">Track</button>
          <button data-act="export" title="Export this clip (E)">Export</button>
          <button data-act="del" title="Delete clip">✕</button>
      </div>
      ${c.status ? `<div class="status ${c.statusKind || ''}" title="${escapeHtml(c.status)}">${escapeHtml(c.status)}</div>` : ''}`;
    if (!th) requestThumb(c);
    div.onclick = e => {
      if (e.target.dataset.act) return;
      state.selectedId = c.id; renderClips(); drawTimeline();
    };
    div.querySelector('.name').ondblclick = () => beginRename(div, c);
    div.querySelector('[data-act=up]').onclick = () => moveClip(c.id, -1);
    div.querySelector('[data-act=dn]').onclick = () => moveClip(c.id, 1);
    div.querySelector('[data-act=go]').onclick = () => { state.selectedId = c.id; video.currentTime = c.inMs / 1000; renderClips(); };
    div.querySelector('[data-act=play]').onclick = () => reviewClip(c);
    div.querySelector('[data-act=track]').onclick = () => enterTracking(c.id);
    div.querySelector('[data-act=export]').onclick = () => exportClip(c);
    div.querySelector('[data-act=del]').onclick = () => deleteClip(c.id);
    list.appendChild(div);
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

function beginRename(div, c) {
  const nameEl = div.querySelector('.name');
  nameEl.innerHTML = `<input value="${escapeHtml(c.name)}">`;
  const input = nameEl.querySelector('input');
  input.focus(); input.select();
  const done = save => {
    if (save && input.value.trim()) { c.name = input.value.trim(); c.custom = true; saveProject(); }
    renderClips();
  };
  input.onkeydown = e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); };
  input.onblur = () => done(true);
}

function reviewClip(c) {
  state.selectedId = c.id;
  renderClips();
  video.currentTime = c.inMs / 1000;
  video.play();
  const stopAt = () => {
    if (video.currentTime >= c.outMs / 1000) { video.pause(); video.removeEventListener('timeupdate', stopAt); }
  };
  video.addEventListener('timeupdate', stopAt);
}

// ---------- labels ------------------------------------------------------------
function renderLabelBar() {
  const bar = $('labelBar');
  bar.innerHTML = '';
  settings.labels.slice(0, 9).forEach((lbl, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<kbd>${i + 1}</kbd>${escapeHtml(lbl)}`;
    b.onclick = () => assignLabel(i);
    bar.appendChild(b);
  });
}

function assignLabel(idx) {
  const c = selected();
  if (!c) return toast('No clip selected — create one first (I, O, C)', true);
  const lbl = settings.labels[idx];
  if (!lbl) return;
  c.label = c.label === lbl ? null : lbl; // toggle off if same
  renameAuto(); renderClips(); saveProject();
  toast(c.label ? `🏷 ${lbl}` : 'Label removed');
}

// ---------- tracking ------------------------------------------------------------
function enterTracking(clipId) {
  const c = state.clips.find(x => x.id === clipId);
  if (!c) return;
  if (c.anchors && c.anchors.length && !confirm('This clip already has anchors. Re-track from scratch?')) return;
  c.anchors = [];
  state.selectedId = clipId;
  state.tracking = { clipId };
  video.pause();
  video.currentTime = c.inMs / 1000;
  wrap.classList.add('tracking');
  $('trackBanner').classList.remove('hidden');
  $('anchorCount').textContent = '0 anchors';
  renderClips();
  toast('Tracking: click her feet — the video auto-advances after each click');
}

function exitTracking(silent) {
  if (!state.tracking) return;
  const c = state.clips.find(x => x.id === state.tracking.clipId);
  state.tracking = null;
  wrap.classList.remove('tracking');
  $('trackBanner').classList.add('hidden');
  renderClips(); saveProject();
  if (!silent && c) toast(`⊙ Tracking saved — ${c.anchors.length} anchors. Press ▶ Review to check it.`);
}

overlay.addEventListener('click', e => {
  if (!state.tracking) return;
  const c = state.clips.find(x => x.id === state.tracking.clipId);
  if (!c) return exitTracking(true);
  const r = videoRect();
  const rect = wrap.getBoundingClientRect();
  const x = (e.clientX - rect.left - r.x) / r.w;
  const y = (e.clientY - rect.top - r.y) / r.h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  const t = clamp(Math.round(video.currentTime * 1000), c.inMs, c.outMs);
  // replace an anchor placed at (almost) the same time
  c.anchors = c.anchors.filter(a => Math.abs(a.t - t) > 5);
  c.anchors.push({ t, x, y });
  c.anchors.sort((a, b) => a.t - b.t);
  $('anchorCount').textContent = `${c.anchors.length} anchors`;
  drawOverlay();
  // auto-advance; finish automatically at the end of the clip
  if (video.currentTime * 1000 >= c.outMs - 1) { exitTracking(); return; }
  const skip = parseInt($('skipFrames').value, 10);
  const next = Math.min(video.currentTime + skip * frameDur(), c.outMs / 1000);
  video.currentTime = next;
  if (next * 1000 >= c.outMs - 1) toast('Last frame — click once more or Esc to finish');
});

function undoAnchor() {
  if (!state.tracking) return;
  const c = state.clips.find(x => x.id === state.tracking.clipId);
  if (!c || !c.anchors.length) return;
  c.anchors.pop();
  $('anchorCount').textContent = `${c.anchors.length} anchors`;
  video.currentTime = c.anchors.length ? c.anchors[c.anchors.length - 1].t / 1000 : c.inMs / 1000;
  drawOverlay();
}

// ---------- overlay art (badge / circle / label PNGs) ----------------------------
// Rendered at actual video resolution so preview === export.
let artCache = { key: null, badge: null, circle: null };
function artKey() {
  return [settings.name, settings.number, settings.badgeColor, settings.textColor,
    settings.circleColor, settings.badgeScale, settings.circleScale, state.vw, state.vh].join('|');
}

function getBadgeCanvas() {
  if (artCache.key !== artKey()) rebuildArt();
  return artCache.badge;
}
function getCircleCanvas() {
  if (artCache.key !== artKey()) rebuildArt();
  return artCache.circle;
}

function rebuildArt() {
  artCache = { key: artKey(), badge: renderBadge(), circle: renderCircle() };
}

function renderBadge() {
  const H = state.vh;
  const fontPx = Math.round(H * 0.026 * settings.badgeScale);
  const text = `${settings.name}${settings.number ? '  #' + settings.number : ''}`.toUpperCase();
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  const padX = fontPx * 0.7, padY = fontPx * 0.42, notch = fontPx * 0.42;
  c.width = Math.ceil(tw + padX * 2);
  c.height = Math.ceil(fontPx + padY * 2 + notch);
  const ctx2 = c.getContext('2d');
  const w = c.width, bodyH = c.height - notch, r = bodyH * 0.3;
  ctx2.fillStyle = settings.badgeColor;
  ctx2.beginPath();
  ctx2.roundRect(0, notch, w, bodyH, r);
  ctx2.fill();
  // pointer notch — badge sits below the circle, so it points up at the player
  ctx2.beginPath();
  ctx2.moveTo(w / 2 - notch, notch + 1);
  ctx2.lineTo(w / 2, 1);
  ctx2.lineTo(w / 2 + notch, notch + 1);
  ctx2.closePath(); ctx2.fill();
  ctx2.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  ctx2.textBaseline = 'middle'; ctx2.textAlign = 'center';
  ctx2.fillStyle = settings.textColor;
  ctx2.fillText(text, w / 2, notch + bodyH / 2 + fontPx * 0.05);
  return c;
}

function renderCircle() {
  const W = state.vw;
  const rx = Math.round(W * 0.020 * settings.circleScale);
  const ry = Math.round(rx * 0.38);
  const stroke = Math.max(3, Math.round(rx * 0.16));
  const pad = stroke * 2 + 4;
  const c = document.createElement('canvas');
  c.width = rx * 2 + pad * 2; c.height = ry * 2 + pad * 2;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  // soft glow under-ring then crisp ring
  ctx.strokeStyle = settings.circleColor;
  ctx.globalAlpha = 0.35; ctx.lineWidth = stroke * 2.2;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1; ctx.lineWidth = stroke;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  return c;
}

// basisH/maxW let the 9:16 export size the banner for its 1080x1920 output
// (it overlays after the crop+scale, so source-frame sizing would be tiny)
function renderLabelBanner(labelText, basisH = state.vh, maxW = Infinity) {
  // same visual language as the badge (badge color, rounded body, heavy type), just larger
  let fontPx = Math.round(basisH * 0.055);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const text = labelText.toUpperCase();
  ctx.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  let tw = ctx.measureText(text).width;
  if (tw + fontPx * 1.4 > maxW) { // shrink to fit narrow vertical frame
    fontPx = Math.max(12, Math.floor(fontPx * (maxW - fontPx * 1.4) / tw));
    ctx.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
    tw = ctx.measureText(text).width;
  }
  const padX = fontPx * 0.7, padY = fontPx * 0.42;
  c.width = Math.ceil(tw + padX * 2); c.height = Math.ceil(fontPx + padY * 2);
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = settings.badgeColor;
  ctx2.beginPath(); ctx2.roundRect(0, 0, c.width, c.height, c.height * 0.3); ctx2.fill();
  ctx2.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
  ctx2.fillStyle = settings.textColor;
  ctx2.fillText(text, c.width / 2, c.height / 2 + fontPx * 0.05);
  return c;
}

// ---------- export ----------------------------------------------------------------
function setStatus(c, msg, kind) { c.status = msg; c.statusKind = kind; renderClips(); }

async function exportClip(c) {
  if (!state.videoPath) return;
  if (state.exporting) return toast('Wait for the current export to finish', true);
  state.exporting = true;
  setStatus(c, '⏳ Exporting…', 'busy');
  try {
    const assets = {};
    if (c.anchors && c.anchors.length) {
      assets.circlePng = getCircleCanvas().toDataURL('image/png');
      assets.badgePng = getBadgeCanvas().toDataURL('image/png');
    }
    const fmt = exportFormat();
    if (c.label) {
      assets.labelPng = (fmt === 'vertical'
        ? renderLabelBanner(c.label, 1920, 1000)
        : renderLabelBanner(c.label)).toDataURL('image/png');
    }
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath: state.videoPath,
        clip: { name: c.name, inMs: c.inMs, outMs: c.outMs, label: c.label, anchors: c.anchors, cropOffset: c.cropOffset || 0 },
        assets,
        meta: { width: state.vw, height: state.vh, fps: state.fps, labelSeconds: settings.labelSeconds, format: fmt, testRun: TEST_RUN },
      }),
    }).then(r => r.json());
    if (res.error) throw new Error(res.error);
    c.exportedFile = res.file;
    setStatus(c, '✓ Exported → clips/' + res.file, 'ok');
    saveProject();
  } catch (e) {
    setStatus(c, '✗ ' + (e.message || e), 'err');
  } finally {
    state.exporting = false;
  }
}

$('exportAllBtn').onclick = async () => {
  if (!state.clips.length) return toast('No clips yet', true);
  if (state.exporting) return toast('Wait for the current export to finish', true);
  toast(`Exporting ${state.clips.length} clips…`);
  for (const c of state.clips) {
    await exportClip(c);
  }
  const ok = state.clips.filter(c => c.statusKind === 'ok').length;
  toast(`Done — ${ok}/${state.clips.length} clips exported to the clips/ folder`, ok < state.clips.length, 5000);
};

// ---------- compilation builder (cross-game, re-orderable) ------------------------
let builderItems = [];

$('builderBtn').onclick = async () => {
  try {
    const res = await fetch('/api/exports' + (TEST_RUN ? '?includeTest=1' : '')).then(r => r.json());
    builderItems = res.files.map(f => ({ ...f, checked: true }));
    if (!builderItems.length) return toast('No exported clips yet — export some first, then build a compilation', true, 4500);
    if (!$('stitchName').value) $('stitchName').value = 'Charlotte Highlights';
    $('transitionSel').value = localStorage.getItem('cc-transition') || '';
    renderBuilder();
    loadCardForms();
    updateCardPreviews();
    $('builderDlg').showModal();
  } catch (e) {
    toast('Could not list exported clips: ' + e.message, true);
  }
};

function renderBuilder() {
  const list = $('builderList');
  list.innerHTML = '';
  builderItems.forEach((f, i) => {
    const vertical = f.height > f.width;
    const row = document.createElement('div');
    row.className = 'brow' + (f.checked ? '' : ' off');
    row.innerHTML = `
      <input type="checkbox" ${f.checked ? 'checked' : ''}>
      <span class="bname">${escapeHtml(f.name)}</span>
      <span class="chip ${vertical ? 'v916' : ''}">${vertical ? '9:16' : '16:9'}</span>
      <span class="bdur">${f.duration ? f.duration.toFixed(1) + 's' : ''}</span>
      <button data-mv="-1" title="move up">▲</button>
      <button data-mv="1" title="move down">▼</button>`;
    row.querySelector('input').onchange = e => { f.checked = e.target.checked; renderBuilder(); updateCardPreviews(); };
    row.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
      const j = i + parseInt(b.dataset.mv, 10);
      if (j < 0 || j >= builderItems.length) return;
      [builderItems[i], builderItems[j]] = [builderItems[j], builderItems[i]];
      renderBuilder();
    });
    list.appendChild(row);
  });
  const picked = builderItems.filter(f => f.checked);
  const hasWide = picked.some(f => f.width >= f.height);
  const hasTall = picked.some(f => f.height > f.width);
  $('builderWarn').textContent = hasWide && hasTall
    ? '⚠ Mixed 16:9 and 9:16 clips selected — the output will pad everything to the first clip’s shape. Usually you want one format per compilation.'
    : '';
}

// ---------- intro / outro cards ---------------------------------------------------
// Styled after the Charlotte_Boyd_19_Highlights examples: navy base, gold letter-
// spaced kicker, huge silver title, photo blended through a gradient (left panel
// for 16:9, bottom panel for 9:16).
const cardImgs = { intro: null, outro: null }; // Image objects, not persisted
const CARD_DEFAULTS = {
  intro: { kicker: 'GAME HIGHLIGHTS', title: '', sub: '', sub2: '', seconds: 3.5 },
  outro: { kicker: 'THANKS FOR WATCHING', title: '', sub: '', sub2: '', seconds: 3.5 },
};

function readCardForm(kind) {
  return {
    on: $(kind + 'On').checked,
    kicker: $(kind + 'Kicker').value.trim(),
    title: $(kind + 'Title').value.trim(),
    sub: $(kind + 'Sub').value.trim(),
    sub2: $(kind + 'Sub2').value.trim(),
    seconds: parseFloat($(kind + 'Secs').value) || 3.5,
  };
}

function loadCardForms() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('cc-cards')) || {}; } catch {}
  for (const kind of ['intro', 'outro']) {
    const d = { ...CARD_DEFAULTS[kind], ...(saved[kind] || {}) };
    if (!d.title) d.title = `${settings.name}${settings.number ? ' #' + settings.number : ''}`;
    $(kind + 'On').checked = !!d.on;
    $(kind + 'Kicker').value = d.kicker;
    $(kind + 'Title').value = d.title;
    $(kind + 'Sub').value = d.sub;
    $(kind + 'Sub2').value = d.sub2;
    $(kind + 'Secs').value = d.seconds;
    $('cardCfg-' + kind).classList.toggle('on', !!d.on);
  }
}

function saveCardForms() {
  localStorage.setItem('cc-cards', JSON.stringify({ intro: readCardForm('intro'), outro: readCardForm('outro') }));
}

// first checked clip decides the compilation's shape
function builderDims() {
  const f = builderItems.find(x => x.checked);
  return f ? { w: f.width, h: f.height } : { w: 1920, h: 1080 };
}

function renderCard(W, H, cfg, img) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const NAVY = '13,27,51', GOLD = '#f2c84b', SILVER = '#e9edf5';
  x.fillStyle = `rgb(${NAVY})`; x.fillRect(0, 0, W, H);
  if (img) { // cover-fit
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  const vertical = H > W;
  const base = vertical ? W : H; // type scale basis
  const g = vertical
    ? x.createLinearGradient(0, H, 0, H * 0.30)
    : x.createLinearGradient(0, 0, W * 0.78, 0);
  g.addColorStop(0, `rgba(${NAVY},0.97)`);
  g.addColorStop(0.5, `rgba(${NAVY},0.8)`);
  g.addColorStop(1, `rgba(${NAVY},0)`);
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  const left = W * (vertical ? 0.08 : 0.06);
  const maxW = W * (vertical ? 0.84 : 0.56);
  const font = (wt, px) => `${wt} ${px}px "Segoe UI", Arial, sans-serif`;
  const fit = (text, wt, px) => { // shrink until the line fits
    x.font = font(wt, px);
    while (px > base * 0.02 && x.measureText(text).width > maxW) { px *= 0.95; x.font = font(wt, px); }
    return px;
  };

  // measure the text block, then draw it (16:9: vertically centered; 9:16: lower third)
  const kickPx = base * 0.028;
  const titleLines = (cfg.title || '').toUpperCase().split('|').map(s => s.trim()).filter(Boolean);
  const titlePx0 = base * (vertical ? 0.105 : 0.12);
  const subPx = base * 0.042, sub2Px = base * 0.028;
  let total = 0;
  if (cfg.kicker) total += kickPx * 1.8;
  total += titleLines.length * titlePx0 * 1.12;
  if (cfg.sub) total += base * 0.05 + subPx * 1.25; // gold bar + sub
  if (cfg.sub2) total += sub2Px * 1.7;
  let y = vertical ? H * 0.88 - total : Math.max(H * 0.16, (H - total) / 2);

  x.textBaseline = 'top'; x.textAlign = 'left';
  if (cfg.kicker) {
    x.font = font(700, kickPx);
    x.letterSpacing = `${Math.round(base * 0.012)}px`;
    x.fillStyle = GOLD;
    x.fillText(cfg.kicker.toUpperCase(), left, y);
    x.letterSpacing = '0px';
    y += kickPx * 1.8;
  }
  for (const ln of titleLines) {
    const px = fit(ln, 900, titlePx0);
    x.fillStyle = SILVER;
    x.fillText(ln, left, y + (titlePx0 - px) / 2);
    y += titlePx0 * 1.12;
  }
  if (cfg.sub) {
    x.fillStyle = GOLD;
    x.fillRect(left, y + base * 0.018, base * 0.09, Math.max(2, base * 0.006)); // accent bar
    y += base * 0.05;
    fit(cfg.sub, 800, subPx);
    x.fillStyle = '#ffffff';
    x.fillText(cfg.sub, left, y);
    y += subPx * 1.25;
  }
  if (cfg.sub2) {
    fit(cfg.sub2.toUpperCase(), 700, sub2Px);
    x.letterSpacing = `${Math.round(base * 0.004)}px`;
    x.fillStyle = 'rgba(233,237,245,0.55)';
    x.fillText(cfg.sub2.toUpperCase(), left, y);
    x.letterSpacing = '0px';
  }
  return c;
}

function updateCardPreview(kind) {
  const { w, h } = builderDims();
  const prev = $(kind + 'Prev');
  const pw = 300, ph = Math.round(pw * h / w); // render small — everything scales off the dims
  prev.width = pw; prev.height = ph;
  prev.getContext('2d').drawImage(renderCard(pw, ph, readCardForm(kind), cardImgs[kind]), 0, 0);
}
const updateCardPreviews = () => { updateCardPreview('intro'); updateCardPreview('outro'); };

for (const kind of ['intro', 'outro']) {
  $(kind + 'On').onchange = e => {
    $('cardCfg-' + kind).classList.toggle('on', e.target.checked);
    saveCardForms(); updateCardPreviews();
  };
  $(kind + 'PickBtn').onclick = () => $(kind + 'File').click();
  $(kind + 'File').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => { cardImgs[kind] = img; updateCardPreview(kind); };
    img.src = URL.createObjectURL(f);
    $(kind + 'PickBtn').textContent = '📷 ' + f.name.slice(0, 18);
  };
  for (const fld of ['Kicker', 'Title', 'Sub', 'Sub2', 'Secs']) {
    $(kind + fld).addEventListener('input', () => { saveCardForms(); updateCardPreview(kind); });
  }
}

function cardPayload(kind, dims) {
  const cfg = readCardForm(kind);
  if (!cfg.on) return null;
  if (!cardImgs[kind] && !cfg.title && !cfg.kicker) return null;
  return { png: renderCard(dims.w, dims.h, cfg, cardImgs[kind]).toDataURL('image/png'), seconds: cfg.seconds };
}

$('closeBuilder').onclick = () => $('builderDlg').close();
$('doStitch').onclick = async e => {
  e.preventDefault();
  const files = builderItems.filter(f => f.checked).map(f => f.name);
  if (files.length < 2) return toast('Check at least two clips to stitch', true);
  const name = $('stitchName').value.trim() || 'Charlotte Highlights';
  const dims = builderDims();
  const transition = $('transitionSel').value;
  localStorage.setItem('cc-transition', transition);
  const btn = $('doStitch');
  btn.disabled = true; btn.textContent = 'Stitching…';
  try {
    const res = await fetch('/api/stitch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testRun: TEST_RUN,
        files, outName: name,
        transition: transition || undefined, transitionSec: 0.5,
        intro: cardPayload('intro', dims), outro: cardPayload('outro', dims),
      }),
    }).then(r => r.json());
    if (res.error) throw new Error(res.error);
    $('builderDlg').close();
    toast(`🎬 ${files.length} clips stitched → clips/` + res.file, false, 6000);
  } catch (e2) {
    toast('Stitch failed: ' + e2.message, true, 6000);
  } finally {
    btn.disabled = false; btn.textContent = 'Stitch';
  }
};

// ---------- keyboard ---------------------------------------------------------------
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();

  if (state.tracking) {
    if (k === 'escape') { exitTracking(); e.preventDefault(); return; }
    if (k === 'arrowright') { const skip = parseInt($('skipFrames').value, 10); stepFrames(skip); e.preventDefault(); return; }
    if (k === 'arrowleft') { const skip = parseInt($('skipFrames').value, 10); stepFrames(-skip); e.preventDefault(); return; }
    if (k === 'u' || k === 'backspace') { undoAnchor(); e.preventDefault(); return; }
    if (k === ' ') { e.preventDefault(); return; } // no accidental playback while tracking
    return;
  }

  switch (k) {
    case ' ': case 'k': togglePlay(); e.preventDefault(); break;
    case 'arrowright': e.shiftKey ? jump(1) : stepFrames(1); e.preventDefault(); break;
    case 'arrowleft': e.shiftKey ? jump(-1) : stepFrames(-1); e.preventDefault(); break;
    case 'arrowup': if (e.altKey) { const c = selected(); if (c) moveClip(c.id, -1); e.preventDefault(); } break;
    case 'arrowdown': if (e.altKey) { const c = selected(); if (c) moveClip(c.id, 1); e.preventDefault(); } break;
    case 'j': jump(-10); break;
    case 'l': {
      state.speedIdx = (state.speedIdx + 1) % state.speedSteps.length;
      const sp = state.speedSteps[state.speedIdx];
      setSpeed(sp);
      if (video.paused) video.play();
      toast('Speed ' + sp + '×', false, 1200);
      break;
    }
    case 'i': setIn(); break;
    case 'o': setOut(); break;
    case 'c': createClip(); break;
    case 't': { const c = selected(); c ? enterTracking(c.id) : toast('Select a clip first', true); break; }
    case 'e': { const c = selected(); c ? exportClip(c) : toast('Select a clip first', true); break; }
    case ',': nudge(e.shiftKey ? 'out' : 'in', -1); break;
    case '.': nudge(e.shiftKey ? 'out' : 'in', 1); break;
    case 'delete': { const c = selected(); if (c) deleteClip(c.id); break; }
    default:
      if (/^[1-9]$/.test(k)) assignLabel(parseInt(k, 10) - 1);
  }
});

// ---------- settings ----------------------------------------------------------------
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('cc-settings'));
    return { ...DEFAULT_SETTINGS, ...s };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function openSettings() {
  $('setName').value = settings.name;
  $('setNumber').value = settings.number;
  $('setBadgeColor').value = settings.badgeColor;
  $('setTextColor').value = settings.textColor;
  $('setCircleColor').value = settings.circleColor;
  $('setBadgeScale').value = settings.badgeScale;
  $('setCircleScale').value = settings.circleScale;
  $('setLabelSecs').value = settings.labelSeconds;
  $('setLabels').value = settings.labels.join(', ');
  drawBadgePreview();
  $('settingsDlg').showModal();
}
$('settingsBtn').onclick = openSettings;

function readSettingsForm() {
  return {
    name: $('setName').value.trim() || 'PLAYER',
    number: $('setNumber').value.trim(),
    badgeColor: $('setBadgeColor').value,
    textColor: $('setTextColor').value,
    circleColor: $('setCircleColor').value,
    badgeScale: parseFloat($('setBadgeScale').value),
    circleScale: parseFloat($('setCircleScale').value),
    labelSeconds: parseFloat($('setLabelSecs').value) || 3,
    labels: $('setLabels').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 9),
  };
}

// one click to match the badge/circle/banner to the app's own palette (CSS tokens)
$('themeColorsBtn').onclick = () => {
  const cs = getComputedStyle(document.documentElement);
  $('setBadgeColor').value = cs.getPropertyValue('--accent').trim();
  $('setTextColor').value = cs.getPropertyValue('--gold').trim();
  $('setCircleColor').value = cs.getPropertyValue('--gold').trim();
  drawBadgePreview();
};
$('settingsDlg').addEventListener('input', drawBadgePreview);
$('settingsDlg').addEventListener('close', () => {
  if ($('settingsDlg').returnValue === 'ok') {
    settings = readSettingsForm();
    localStorage.setItem('cc-settings', JSON.stringify(settings));
    artCache.key = null;
    renderLabelBar();
    drawOverlay();
    toast('Settings saved');
  }
});

function drawBadgePreview() {
  const tmpSettings = readSettingsForm();
  const saved = settings;
  settings = tmpSettings;
  const savedDims = { vw: state.vw, vh: state.vh };
  state.vw = 1920; state.vh = 1080; // render preview art at a fixed reference resolution
  const badge = renderBadge(), circle = renderCircle();
  state.vw = savedDims.vw; state.vh = savedDims.vh;
  settings = saved;
  const cv = $('badgePreview'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const cx = cv.width / 2;
  const groupTop = Math.max(4, (cv.height - circle.height - 8 - badge.height) / 2);
  ctx.drawImage(circle, cx - circle.width / 2, groupTop);
  ctx.drawImage(badge, cx - badge.width / 2, groupTop + circle.height + 8);
}

// ---------- boot -------------------------------------------------------------------
window.addEventListener('resize', () => { drawOverlay(); drawTimeline(); });
renderLabelBar();
refreshVideos();
