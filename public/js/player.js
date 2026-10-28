// Video player: render loop, overlay preview, 9:16 crop drag, transport and in/out marks.
import { getBadgeCanvas, getCircleCanvas } from './art.js';
import { createClip, selected } from './clips.js';
import { $, video, overlay, wrap, state, clamp, fmtTime, toast, videoRect } from './core.js';
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
export function drawCropGuide(ctx, r, clip) {
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
// player — for when the action is to the player's left or right. Stored per clip, normalized 0-1.
export let cropDrag = null;
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

// export format: 16:9 (YouTube) or 9:16 follow-crop (Reels/Shorts/TikTok)
$('exportFormat').value = localStorage.getItem('gr-format') || 'wide';
$('exportFormat').onchange = e => {
  localStorage.setItem('gr-format', e.target.value);
  e.target.blur();
  drawOverlay();
  if (e.target.value === 'vertical') toast('9:16 mode — dashed guide shows the Reels crop (follows tracking) · drag the video to shift it left/right', false, 4500);
};
export function exportFormat() { return $('exportFormat').value; }

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
