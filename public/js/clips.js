// Clip list: thumbnails, create/rename/reorder/nudge, review, labels.
import { $, video, overlay, state, clamp, frameDur, fmtTime, toast, uid, escapeHtml } from './core.js';
import { jobProgress, cancelJob, exportClip } from './export.js';
import { saveProject } from './project.js';
import { settings } from './settings.js';
import { drawTimeline } from './timeline.js';
import { enterTracking } from './tracking.js';

// ---------- clip thumbnails ------------------------------------------------------
// One frame grabbed at each clip's in-point on a hidden <video>, kept in memory for the
// session (nothing is persisted). Keyed by id + inMs so a nudged in-point refreshes it.
export const thumbs = new Map();
export function thumbKey(c) { return c.id + ':' + c.inMs; }
export const thumbVideo = document.createElement('video');
thumbVideo.muted = true; thumbVideo.preload = 'auto';
export let thumbQueue = [], thumbBusy = false;
export const once = (el, ev, ms = 8000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { el.removeEventListener(ev, h); reject(new Error(ev + ' timeout')); }, ms);
  const h = () => { clearTimeout(t); el.removeEventListener(ev, h); resolve(); };
  el.addEventListener(ev, h);
});
export function resetThumbs() {
  thumbs.clear(); thumbQueue = [];
  thumbVideo.removeAttribute('src'); thumbVideo.dataset.src = ''; thumbVideo.load();
}
export function requestThumb(c) {
  if (!state.videoPath || thumbs.has(thumbKey(c)) || thumbQueue.includes(c)) return;
  thumbQueue.push(c); pumpThumbs();
}
export async function pumpThumbs() {
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
export function autoName(clip, idx) {
  const n = String(idx + 1).padStart(2, '0');
  return `${state.videoName} ${n}${clip.label ? ' ' + clip.label : ''}`.replace(/ {2,}/g, ' ');
}

export function createClip() {
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

export function renameAuto() {
  state.clips.forEach((c, i) => { if (!c.custom) c.name = autoName(c, i); });
}

export function selected() { return state.clips.find(c => c.id === state.selectedId); }

export function deleteClip(id) {
  const c = state.clips.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Delete clip "${c.name}"?`)) return;
  state.clips = state.clips.filter(x => x.id !== id);
  if (state.selectedId === id) state.selectedId = state.clips[0] ? state.clips[0].id : null;
  renameAuto(); renderClips(); drawTimeline(); saveProject();
}

export function moveClip(id, dir) {
  const i = state.clips.findIndex(c => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.clips.length) return;
  [state.clips[i], state.clips[j]] = [state.clips[j], state.clips[i]];
  renameAuto(); renderClips(); drawTimeline(); saveProject();
}

export function nudge(which, frames) {
  const c = selected();
  if (!c) return toast('No clip selected', true);
  const d = Math.round(frames * frameDur() * 1000);
  if (which === 'in') c.inMs = clamp(c.inMs + d, 0, c.outMs - 33);
  else c.outMs = clamp(c.outMs + d, c.inMs + 33, state.duration * 1000);
  video.currentTime = (which === 'in' ? c.inMs : c.outMs) / 1000;
  renderClips(); drawTimeline(); saveProject();
  toast(`${which.toUpperCase()} ${d > 0 ? '+' : ''}${d}ms → ${fmtTime((which === 'in' ? c.inMs : c.outMs) / 1000)}`);
}

export function renderClips() {
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
          <button data-act="track" title="Track the player through this clip (T)">Track</button>
          ${c.jobId
            ? '<button data-act="export" title="Cancel this export">Cancel</button>'
            : '<button data-act="export" title="Export this clip (E)">Export</button>'}
          <button data-act="del" title="Delete clip">✕</button>
      </div>
      ${c.status ? `<div class="status ${c.statusKind || ''}" title="${escapeHtml(c.status)}" style="--p:${jobProgress(c)}">${escapeHtml(c.status)}</div>` : ''}`;
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
    div.querySelector('[data-act=export]').onclick = () => c.jobId ? cancelJob(c.jobId) : exportClip(c);
    div.querySelector('[data-act=del]').onclick = () => deleteClip(c.id);
    list.appendChild(div);
  }
}

export function beginRename(div, c) {
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

export function reviewClip(c) {
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
export function renderLabelBar() {
  const bar = $('labelBar');
  bar.innerHTML = '';
  settings.labels.slice(0, 9).forEach((lbl, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<kbd>${i + 1}</kbd>${escapeHtml(lbl)}`;
    b.onclick = () => assignLabel(i);
    bar.appendChild(b);
  });
}

export function assignLabel(idx) {
  const c = selected();
  if (!c) return toast('No clip selected — create one first (I, O, C)', true);
  const lbl = settings.labels[idx];
  if (!lbl) return;
  c.label = c.label === lbl ? null : lbl; // toggle off if same
  renameAuto(); renderClips(); saveProject();
  toast(c.label ? `🏷 ${lbl}` : 'Label removed');
}
