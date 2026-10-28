// Video player: render loop, overlay preview, 9:16 / 1:1 crop drag, transport and in/out marks.
import { getBadgeCanvas, getCircleCanvas } from './art.js';
import { createClip, selected } from './clips.js';
import { $, video, overlay, wrap, state, clamp, fmtTime, toast, videoRect } from './core.js';
import { presetById, cropWindow } from './presets.js';
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

  const cropping = exportPreset().crop;
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

// dashed window showing what survives the 9:16 / 1:1 crop (export smooths the
// pan with a camera filter; this guide follows the raw spline — close enough)
export function drawCropGuide(ctx, r, clip) {
  const p = exportPreset();
  const win = cropWindow(p.id, state.vw, state.vh);
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
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.font = '11px "Segoe UI", sans-serif';
  ctx.fillText(p.ratio, left + 6, top + 16);
}

// ---------- 9:16 / 1:1 crop offset drag ---------------------------------------------
// In a cropping format, drag the video horizontally to shift the crop window off the tracked
// player — for when the action is to the player's left or right. Stored per clip, normalized 0-1.
export let cropDrag = null;
wrap.addEventListener('pointerdown', e => {
  if (state.tracking || !exportPreset().crop) return;
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
    toast(`${exportPreset().ratio} crop shifted ${px > 0 ? '+' : ''}${px}px — double-click video to recenter`, false, 2500);
    saveProject();
  }
  cropDrag = null;
});
wrap.addEventListener('dblclick', () => {
  if (state.tracking || !exportPreset().crop) return;
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

// export format (public/js/presets.js): 16:9 (YouTube), 9:16 follow-crop (Reels/Shorts/
// TikTok) or 1:1 follow-crop (Instagram/Facebook feed)
$('exportFormat').value = localStorage.getItem('gr-format') || 'wide';
if (!$('exportFormat').value) $('exportFormat').value = 'wide'; // stored value no longer offered
$('exportFormat').onchange = e => {
  localStorage.setItem('gr-format', e.target.value);
  e.target.blur();
  drawOverlay();
  const p = exportPreset();
  if (p.crop) toast(`${p.ratio} mode — dashed guide shows the ${p.label} crop (follows tracking) · drag the video to shift it left/right`, false, 4500);
};
export function exportFormat() { return $('exportFormat').value; }
export function exportPreset() { return presetById(exportFormat()); }

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
