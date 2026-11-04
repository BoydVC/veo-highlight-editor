// Zoomable timeline canvas and the video/timeline divider.
import { $, video, timeline, state, clamp, fmtTime } from './core.js';
import { drawOverlay } from './player.js';

// ---------- timeline -------------------------------------------------------------
// palette comes from the CSS tokens in styles.css so the canvas matches the theme
export const TL = (() => {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return { bg: v('--tl-bg'), tick: v('--tl-tick'), text: v('--tl-text'), clip: v('--accent-a22'),
           clipSel: v('--accent-a55'), anchor: v('--anchor'), in: v('--in'), out: v('--out'), playhead: v('--playhead') };
})();
export function drawTimeline() {
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

export let scrubbing = false;
export function timelineSeek(e) {
  const rect = timeline.getBoundingClientRect();
  const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  video.currentTime = state.view.start + frac * (state.view.end - state.view.start);
}
timeline.addEventListener('mousedown', e => { scrubbing = true; timelineSeek(e); });
window.addEventListener('mousemove', e => { if (scrubbing) timelineSeek(e); });
window.addEventListener('mouseup', () => scrubbing = false);
timeline.addEventListener('dblclick', () => { state.view = { start: 0, end: state.duration }; drawTimeline(); });

// video/timeline split — drag the divider under the video to grow/shrink the timeline
export const divider = $('paneDivider');
export const TL_MIN = 28, TL_MAX = 200, TL_DEFAULT = 64;
export function setTimelineH(px) {
  const h = clamp(Math.round(px), TL_MIN, TL_MAX);
  document.documentElement.style.setProperty('--tlH', h + 'px');
  localStorage.setItem('cc.timelineH', h);
  drawTimeline(); drawOverlay();
}
{
  const saved = parseFloat(localStorage.getItem('cc.timelineH'));
  if (saved) setTimelineH(saved);
}
export let divDrag = null;
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
