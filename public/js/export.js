// Export queue client: starts jobs, follows /api/jobs/events, progress and cancel.
import { getBadgeCanvas, getCircleCanvas, renderLabelBanner } from './art.js';
import { onStitchJob } from './builder.js';
import { renderClips } from './clips.js';
import { $, TEST_RUN, state, toast } from './core.js';
import { exportFormat, exportPreset } from './player.js';
import { saveProject } from './project.js';
import { settings } from './settings.js';

// ---------- export ----------------------------------------------------------------
// Exports and stitches are queued on the server and run one at a time. A POST returns
// a job id; progress and results stream in over /api/jobs/events, so you can keep
// clipping while Export All works through the list, and cancel any job.
export function setStatus(c, msg, kind) { c.status = msg; c.statusKind = kind; renderClips(); }

export const jobsSeen = new Map();  // job id → latest state from the server
export let jobsSynced = false;      // the server's snapshot has arrived
export const myJobs = new Set();    // started from this page — these get a toast when they finish
export const stitchJobs = new Set();
export let exportBatch = null;      // ids from the last Export All, for its summary toast
export function isActive(j) { return j && (j.status === 'queued' || j.status === 'running'); }
export function jobProgress(c) { return (c.jobId && jobsSeen.get(c.jobId) || {}).progress || 0; }
export function cancelJob(id) { return fetch('/api/jobs/' + id, { method: 'DELETE' }); }

export const jobEvents = new EventSource('/api/jobs/events');
jobEvents.addEventListener('snapshot', e => {
  jobsSeen.clear();
  for (const j of JSON.parse(e.data)) jobsSeen.set(j.id, j);
  jobsSynced = true;
  state.clips.forEach(syncClipJob);
  renderJobsPill();
});
jobEvents.onmessage = e => {
  const j = JSON.parse(e.data);
  jobsSeen.set(j.id, j);
  const mine = state.clips.filter(c => c.jobId === j.id);
  mine.forEach(syncClipJob);
  if (stitchJobs.has(j.id)) onStitchJob(j);
  else if (!mine.length && myJobs.has(j.id) && j.status === 'done') toast('✓ Exported ' + j.name);
  else if (!mine.length && myJobs.has(j.id) && j.status === 'failed') toast(`✗ ${j.name}: ${j.error}`, true, 6000);
  if (exportBatch) checkBatch();
  renderJobsPill();
};

// mirror a clip's export job onto its card
export function syncClipJob(c) {
  if (!c.jobId) return;
  const j = jobsSeen.get(c.jobId);
  if (!j) { // the server restarted since this export was queued
    if (jobsSynced) { delete c.jobId; setStatus(c, '✗ Export interrupted — export it again', 'err'); saveProject(); }
    return;
  }
  if (j.status === 'queued') return setStatusLive(c, '⏳ Queued', 'busy', 0);
  if (j.status === 'running') return setStatusLive(c, `⏳ Exporting ${Math.round(j.progress * 100)}%`, 'busy', j.progress);
  delete c.jobId;
  if (j.status === 'done') { c.exportedFile = j.file; setStatus(c, '✓ Exported → clips/' + j.file, 'ok'); }
  else if (j.status === 'cancelled') setStatus(c, 'Export cancelled', '');
  else setStatus(c, '✗ ' + j.error, 'err');
  saveProject();
}

// progress ticks patch the card in place rather than rebuilding the whole clip list
export function setStatusLive(c, msg, kind, p) {
  const el = document.querySelector(`.clip[data-id="${c.id}"] .status`);
  const rebuild = !el || c.statusKind !== kind;
  c.status = msg; c.statusKind = kind;
  if (rebuild) return renderClips();
  el.textContent = el.title = msg;
  el.style.setProperty('--p', p);
}

export function renderJobsPill() {
  const live = [...jobsSeen.values()].filter(isActive);
  $('jobsPill').classList.toggle('hidden', !live.length);
  if (!live.length) return;
  const run = live.find(j => j.status === 'running');
  const waiting = live.length - (run ? 1 : 0);
  // the pill truncates on narrow windows; the tooltip keeps the full text
  $('jobsText').textContent = $('jobsText').title =
    (run ? `${run.type === 'stitch' ? 'Stitching' : 'Exporting'} ${run.name} · ${Math.round(run.progress * 100)}%` : 'Starting…') +
    (waiting ? ` · ${waiting} queued` : '');
  $('jobsPill').style.setProperty('--p', run ? run.progress : 0);
  $('jobCancel').onclick = () => { if (run) cancelJob(run.id); };
}

export function checkBatch() {
  const js = [...exportBatch.ids].map(id => jobsSeen.get(id));
  if (js.some(j => !j || isActive(j))) return;
  const ok = js.filter(j => j.status === 'done').length;
  toast(`Done — ${ok}/${js.length} clips exported to the clips/ folder`, ok < js.length, 5000);
  exportBatch = null;
}

// queues the clip; resolves to the job id (or nothing if it couldn't be queued)
export async function exportClip(c) {
  if (!state.videoPath) return;
  if (c.jobId) return toast(`"${c.name}" is already in the export queue`, true);
  try {
    const assets = {};
    if (c.anchors && c.anchors.length) {
      assets.circlePng = getCircleCanvas().toDataURL('image/png');
      assets.badgePng = getBadgeCanvas().toDataURL('image/png');
    }
    const fmt = exportFormat();
    if (c.label) {
      // cropped formats overlay the banner after the scale, so size it for the output
      // frame (1080×1920 or 1080×1080), keeping ~40 px clear on each side
      const p = exportPreset();
      assets.labelPng = (p.crop
        ? renderLabelBanner(c.label, p.outH, p.outW - 80)
        : renderLabelBanner(c.label)).toDataURL('image/png');
    }
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath: state.videoPath, ref: c.id,
        clip: { name: c.name, inMs: c.inMs, outMs: c.outMs, label: c.label, anchors: c.anchors, cropOffset: c.cropOffset || 0 },
        assets,
        meta: { width: state.vw, height: state.vh, fps: state.fps, labelSeconds: settings.labelSeconds, format: fmt, testRun: TEST_RUN },
      }),
    }).then(r => r.json());
    if (res.error) throw new Error(res.error);
    c.jobId = res.jobId;
    myJobs.add(res.jobId);
    // the response can beat the job's first event
    if (!jobsSeen.has(res.jobId)) jobsSeen.set(res.jobId, { id: res.jobId, type: 'export', name: c.name, status: 'queued', progress: 0 });
    syncClipJob(c);
    renderJobsPill();
    saveProject();
    return res.jobId;
  } catch (e) {
    setStatus(c, '✗ ' + (e.message || e), 'err');
  }
}

$('exportAllBtn').onclick = async () => {
  if (!state.clips.length) return toast('No clips yet', true);
  const todo = state.clips.filter(c => !c.jobId);
  if (!todo.length) return toast('Every clip is already in the export queue', true);
  const ids = [];
  for (const c of todo) {
    const id = await exportClip(c);
    if (id) ids.push(id);
  }
  if (!ids.length) return;
  toast(`Queued ${ids.length} clip${ids.length === 1 ? '' : 's'} — keep working, progress is in the top bar`, false, 4000);
  exportBatch = { ids: new Set(ids) };
  checkBatch();
};
