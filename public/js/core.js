// GameReels frontend — shared DOM handles, app state and small helpers.

// ---------- state ------------------------------------------------------------
export const $ = id => document.getElementById(id);
export const video = $('video'), overlay = $('overlay'), wrap = $('videoWrap');
export const timeline = $('timeline');

// The Playwright UI test opens the app with ?testRun=1 so its exports land in clips/_test/
export const TEST_RUN = new URLSearchParams(location.search).has('testRun');

export const state = {
  videoPath: null, videoName: null,
  fps: 30, duration: 0, vw: 1920, vh: 1080,
  inMs: null, outMs: null,
  clips: [], selectedId: null,
  tracking: null,            // { clipId }
  view: { start: 0, end: 0 }, // timeline zoom window (seconds)
  speedSteps: [1, 2, 4, 8, 16], speedIdx: 0,
};

// ---------- utils ------------------------------------------------------------
export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
export function frameDur() { return 1 / state.fps; }

export function fmtTime(sec, ms = true) {
  if (!isFinite(sec)) sec = 0;
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = Math.floor(sec) % 60;
  const mil = Math.floor((sec % 1) * 1000);
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return ms ? `${base}.${String(mil).padStart(3, '0')}` : base;
}

export let toastTimer;
export function toast(msg, isErr = false, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.className = isErr ? 'err' : '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

export function uid() { return Math.random().toString(36).slice(2, 10); }

// displayed video rectangle inside the wrap (object-fit: contain letterboxing)
export function videoRect() {
  const r = wrap.getBoundingClientRect();
  const scale = Math.min(r.width / state.vw, r.height / state.vh) || 1;
  const w = state.vw * scale, h = state.vh * scale;
  return { x: (r.width - w) / 2, y: (r.height - h) / 2, w, h, scale, wrapW: r.width, wrapH: r.height };
}

export function escapeHtml(s) { return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
