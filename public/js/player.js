// Video player: render loop, overlay preview, 9:16 / 1:1 crop drag, transport and in/out marks.
import { getBadgeCanvas, getCircleCanvas } from './art.js';
import { createClip, selected } from './clips.js';
import { $, video, overlay, wrap, state, clamp, fmtTime, toast, videoRect } from './core.js';
import { PRESETS, presetById, cropWindow, createPresetSession } from './presets.js';
import { refreshVideos, loadVideo, saveProject } from './project.js';
import { splineAt } from './spline.js';
import { drawTimeline } from './timeline.js';

// ---------- render loop (timecode + overlay preview) ---------------------------
export function renderLoop() {
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
export function drawOverlay() {
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

  const cropping = heldPreset().crop;
  wrap.classList.toggle('cropAdj', cropping && !!clip && !state.tracking);
  if (cropping) drawCropGuide(ctx, r, clip);
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

// Dashed window for the held 9:16 or 1:1 preset. Export smooths the pan with a
// camera filter; this guide follows the raw spline — close enough to judge the crop.
// While the hold is unapplied the label says "preview". Nothing is written or posted.
export function drawCropGuide(ctx, r, clip) {
  const p = heldPreset();
  const win = cropWindow(p.id, state.vw, state.vh);
  if (!win) return;
  const s = r.w / state.vw;
  const cw = win.cropW * s, ch = win.cropH * s;
  let centerX = r.x + r.w / 2, centerY = r.y + r.h / 2;
  if (clip && clip.anchors && clip.anchors.length) {
    const a = clip.anchors;
    const tMs = clamp(video.currentTime * 1000, a[0].t, a[a.length - 1].t);
    const pos = splineAt(a, tMs);
    centerX = r.x + pos.x * r.w;
    centerY = r.y + pos.y * r.h;
  }
  if (clip && clip.cropOffset) centerX += clip.cropOffset * r.w; // user-dragged shift off the tracked player
  const left = clamp(centerX - cw / 2, r.x, r.x + r.w - cw);
  const top = clamp(centerY - ch / 2, r.y, r.y + r.h - ch); // only moves when the crop is shorter than the frame
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fillRect(r.x, r.y, r.w, top - r.y);                         // above
  ctx.fillRect(r.x, top + ch, r.w, r.y + r.h - top - ch);          // below
  ctx.fillRect(r.x, top, left - r.x, ch);                          // left
  ctx.fillRect(left + cw, top, r.x + r.w - left - cw, ch);         // right
  ctx.strokeStyle = 'rgba(255,255,255,.65)';
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(left, top + 1, cw, ch - 2);
  ctx.setLineDash([]);
  const pending = presetSnapshot().pending;
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.font = '600 12px "Segoe UI", sans-serif';
  ctx.fillText(pending ? p.ratio + ' preview' : p.ratio, left + 8, top + 18);
}

// ---------- 9:16 / 1:1 crop offset drag ---------------------------------------------
// While a 9:16 or 1:1 preset is held, drag the video horizontally to shift the crop
// window off the tracked player. Stored per clip, normalized 0-1. Drag only edits
// the local project — it does not export or post.
export let cropDrag = null;
wrap.addEventListener('pointerdown', e => {
  if (state.tracking || !heldPreset().crop) return;
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
    toast(`${heldPreset().ratio} crop shifted ${px > 0 ? '+' : ''}${px}px — double-click video to recenter`, false, 2500);
    saveProject();
  }
  cropDrag = null;
});
wrap.addEventListener('dblclick', () => {
  if (state.tracking || !heldPreset().crop) return;
  const c = selected();
  if (c && c.cropOffset) { c.cropOffset = 0; saveProject(); drawOverlay(); toast('Crop recentered on the tracked player'); }
});

// ---------- transport ---------------------------------------------------------
export function stepFrames(n) {
  if (!state.duration) return;
  video.pause();
  const f = Math.round(video.currentTime * state.fps);
  video.currentTime = clamp((f + n + 0.5) / state.fps, 0, state.duration - 0.01);
}
export function jump(sec) { video.currentTime = clamp(video.currentTime + sec, 0, state.duration - 0.01); }
export function togglePlay() { video.paused ? video.play() : video.pause(); }

$('playBtn').onclick = togglePlay;
document.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => jump(parseFloat(b.dataset.seek)));
document.querySelectorAll('[data-step]').forEach(b => b.onclick = () => stepFrames(parseInt(b.dataset.step)));
// playback speed — 16× is the browser ceiling; the last speed is remembered per browser
export function setSpeed(sp) {
  sp = clamp(sp, 0.25, 16);
  video.playbackRate = sp;
  $('speed').value = String(sp);
  const i = state.speedSteps.indexOf(sp);
  if (i >= 0) state.speedIdx = i;
  try { localStorage.setItem('gr-speed', String(sp)); } catch { /* storage unavailable */ }
}
export function restoreSpeed() {
  try { const sp = parseFloat(localStorage.getItem('gr-speed')); if (sp) setSpeed(sp); } catch { /* ignore */ }
}
$('speed').onchange = e => setSpeed(parseFloat(e.target.value));
$('markIn').onclick = () => setIn();
$('markOut').onclick = () => setOut();
$('makeClip').onclick = () => createClip();
$('refreshVideos').onclick = refreshVideos;
$('videoSelect').onchange = e => { if (e.target.value) loadVideo(e.target.value); };
$('skipFrames').onchange = e => e.target.blur(); // keep arrow keys on the video, not the dropdown

// Social presets. Hold previews a crop. Apply stores that shape for the next
// explicit Export. Neither Hold nor Apply writes a file or posts anywhere.
// gr-format (migrated from cc-format in core.js) is the applied shape.
let savedFormat = 'wide';
try { savedFormat = localStorage.getItem('gr-format') || 'wide'; } catch { /* ignore */ }
const presetSession = createPresetSession(savedFormat);
export function exportFormat() { return presetSession.exportFormat(); }
export function exportPreset() { return presetById(exportFormat()); }
export function heldPreset() { return presetById(presetSession.snapshot().held); }
export function presetSnapshot() { return presetSession.snapshot(); }

function syncPresetUI() {
  const snap = presetSession.snapshot();
  document.querySelectorAll('#presetChoices [data-preset]').forEach(btn => {
    const id = btn.dataset.preset;
    const held = id === snap.held;
    btn.classList.toggle('held', held);
    btn.classList.toggle('is-applied', id === snap.applied);
    btn.setAttribute('aria-checked', held ? 'true' : 'false');
  });
  const held = presetById(snap.held);
  const applied = presetById(snap.applied);
  const applyBtn = $('applyPreset');
  applyBtn.disabled = !snap.pending;
  applyBtn.classList.toggle('accent', snap.pending);
  applyBtn.textContent = snap.pending ? 'Apply' : 'Applied';
  $('presetStatus').textContent = snap.pending
    ? `Holding ${held.ratio} ${held.label} (${held.posting}). Preview only — Apply to use it on the next export. Nothing is posted.`
    : `${applied.ratio} ${applied.label} is applied for export (${applied.posting}). Files stay on this PC. Nothing is posted.`;
}

function renderPresetButtons() {
  const box = $('presetChoices');
  box.innerHTML = '';
  for (const p of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset';
    btn.dataset.preset = p.id;
    btn.setAttribute('role', 'radio');
    btn.title = `${p.hint}. Hold previews this crop. Apply commits it for export. Nothing is posted.`;
    btn.setAttribute('aria-label', `${p.ratio} ${p.label}, ${p.posting}. Hold to preview.`);
    btn.innerHTML =
      `<span class="glyph g-${p.id}" aria-hidden="true"></span>` +
      `<span class="preset-text">` +
        `<span class="preset-name">${p.ratio} ${p.label}</span>` +
        `<span class="preset-where">${p.posting}</span>` +
      `</span>`;
    btn.onclick = () => {
      presetSession.hold(p.id);
      syncPresetUI();
      drawOverlay();
      btn.blur();
      if (p.crop) toast(`${p.ratio} ${p.label} is on hold — dashed guide is a preview. Apply before export. Nothing is posted.`, false, 4000);
    };
    box.appendChild(btn);
  }
}

$('applyPreset').onclick = () => {
  const snap = presetSession.apply();
  try { localStorage.setItem('gr-format', snap.applied); } catch { /* ignore */ }
  syncPresetUI();
  drawOverlay();
  $('applyPreset').blur();
  const p = presetById(snap.applied);
  toast(`Applied ${p.ratio} ${p.label}. Export writes a file on this PC — nothing is posted.`, false, 3500);
};

renderPresetButtons();
syncPresetUI();

export function setIn() {
  state.inMs = Math.round(video.currentTime * 1000);
  if (state.outMs != null && state.outMs <= state.inMs) state.outMs = null;
  toast('In ⇤ ' + fmtTime(state.inMs / 1000)); drawTimeline();
}
export function setOut() {
  state.outMs = Math.round(video.currentTime * 1000);
  if (state.inMs != null && state.inMs >= state.outMs) state.inMs = null;
  toast('Out ⇥ ' + fmtTime(state.outMs / 1000)); drawTimeline();
}
