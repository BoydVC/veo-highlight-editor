// Game list, loading a game, and autosaving its project file.
import { resetThumbs, renderClips } from './clips.js';
import { $, video, state, fmtTime, toast } from './core.js';
import { syncClipJob } from './export.js';
import { restoreSpeed } from './player.js';
import { drawTimeline } from './timeline.js';
import { exitTracking } from './tracking.js';

// ---------- video library / loading -------------------------------------------
export async function refreshVideos() {
  const res = await fetch('/api/videos').then(r => r.json());
  const sel = $('videoSelect');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— choose a game —</option>' +
    res.files.map(f => `<option value="${encodeURIComponent(f.path)}">${f.name} (${(f.size / 1e9).toFixed(2)} GB)</option>`).join('');
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  if (!res.files.length) toast(`No videos found — drop game files into ${res.gamesDir}`, true, 5000);
}

export async function loadVideo(encPath) {
  const p = decodeURIComponent(encPath);
  // close out the current game first: a save still pending (or queued by leaving tracking)
  // must not fire after state.videoPath changes, or it writes these clips into the new game
  exitTracking(true);
  flushSave();
  state.videoPath = p;
  state.videoName = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  $('dropHint').classList.add('hidden');

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
  if (proj.notice) toast(proj.notice, true, 8000);
  state.clips = proj.clips || [];
  state.selectedId = state.clips[0] ? state.clips[0].id : null;
  state.clips.forEach(syncClipJob); // reattach exports still running from before a reload
  renderClips();
  drawTimeline();
}

// Autosave is debounced (700 ms after the last change). flushSave() sends a pending save
// right away — before switching games, and when the page closes or reloads.
export let saveTimer = null;
function postProject(keepalive) {
  clearTimeout(saveTimer);
  saveTimer = null;
  return fetch('/api/project', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    keepalive, // lets the request outlive a closing page (browsers cap these at 64 KB)
    body: JSON.stringify({ video: state.videoPath, data: { clips: state.clips } }),
  }).catch(() => toast('Autosave failed', true));
}
export function saveProject() {
  if (!state.videoPath) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => postProject(false), 700);
}
export function flushSave(keepalive = false) {
  if (saveTimer) postProject(keepalive);
}
window.addEventListener('pagehide', () => flushSave(true));
