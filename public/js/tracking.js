// Click-to-track mode: one click per anchor, auto-advancing the video.
import { once, renderClips } from './clips.js';
import { $, video, overlay, wrap, state, clamp, frameDur, toast, videoRect } from './core.js';
import { drawOverlay } from './player.js';
import { saveProject } from './project.js';

// ---------- tracking ------------------------------------------------------------
export function enterTracking(clipId) {
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
  toast('Tracking: click the player\'s feet — the video auto-advances after each click');
}

export function exitTracking(silent) {
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

export function undoAnchor() {
  if (!state.tracking) return;
  const c = state.clips.find(x => x.id === state.tracking.clipId);
  if (!c || !c.anchors.length) return;
  c.anchors.pop();
  $('anchorCount').textContent = `${c.anchors.length} anchors`;
  video.currentTime = c.anchors.length ? c.anchors[c.anchors.length - 1].t / 1000 : c.inMs / 1000;
  drawOverlay();
}
