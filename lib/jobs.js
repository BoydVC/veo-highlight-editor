// Export/stitch job queue: one ffmpeg job at a time (a full-frame encode already
// keeps every core busy), progress pushed to the browser over Server-Sent Events,
// and any job can be cancelled. Output is written as "<name>.part.mp4" and renamed
// once ffmpeg finishes, so a half-written or cancelled file never shows up in the
// Compilation Builder.
const fs = require('fs');

const jobs = new Map();      // id → job, kept for the session so a reloaded page can reattach
const queue = [];            // ids waiting to run
let running = null;          // { job, controller }
const listeners = new Set(); // open SSE responses
let seq = 0;

const ACTIVE = new Set(['queued', 'running']);

// what the browser sees — the run closure (which holds the overlay PNGs) and paths stay here
function view(j) {
  const { id, type, name, file, status, progress, error, ref } = j;
  return { id, type, name, file, status, progress, error, ref };
}

function send(res, event, data) {
  res.write((event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`);
}

// progress ticks are throttled to ~4/s; status changes always go out
function update(job, patch, force) {
  Object.assign(job, patch);
  const now = Date.now();
  if (!force && now - (job.sentAt || 0) < 250) return;
  job.sentAt = now;
  for (const res of listeners) send(res, null, view(job));
}

// spec: { type: 'export'|'stitch', name, file (clips-relative, for display), outPath,
//         ref (opaque to the server — the browser uses it to find the clip),
//         run({ outPath, signal, onProgress }) }
// The same output file can't be queued twice; asking again returns the live job.
function enqueue(spec) {
  for (const j of jobs.values()) {
    if (j.outPath === spec.outPath && ACTIVE.has(j.status)) return j;
  }
  const job = { ...spec, id: Date.now().toString(36) + '-' + (++seq), status: 'queued', progress: 0, error: null };
  jobs.set(job.id, job);
  queue.push(job.id);
  update(job, {}, true);
  pump();
  return job;
}

async function pump() {
  if (running || !queue.length) return;
  const job = jobs.get(queue.shift());
  const controller = new AbortController();
  running = { job, controller };
  update(job, { status: 'running' }, true);
  const part = job.outPath.replace(/\.mp4$/i, '') + '.part.mp4';
  try {
    await job.run({ outPath: part, signal: controller.signal, onProgress: p => update(job, { progress: p }) });
    try {
      fs.renameSync(part, job.outPath);
    } catch (e) {
      throw new Error(`couldn't replace ${job.file} — is it open in a video player? (${e.code || e.message})`);
    }
    update(job, { status: 'done', progress: 1 }, true);
  } catch (e) {
    fs.rmSync(part, { force: true });
    if (controller.signal.aborted) {
      update(job, { status: 'cancelled' }, true);
    } else {
      console.error(job.type + ' failed:', e);
      update(job, { status: 'failed', error: String(e.message || e) }, true);
    }
  } finally {
    job.run = null; // drop the overlay PNGs
    running = null;
    pump();
  }
}

function cancel(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === 'queued') {
    queue.splice(queue.indexOf(id), 1);
    job.run = null;
    update(job, { status: 'cancelled' }, true);
  } else if (running && running.job === job) {
    running.controller.abort();
  }
  return true;
}

const get = id => jobs.get(id) && view(jobs.get(id));

// SSE: a snapshot of every job first, then one message per change
function subscribe(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  send(res, 'snapshot', [...jobs.values()].map(view));
  listeners.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); listeners.delete(res); });
}

module.exports = { enqueue, cancel, get, subscribe };
