// Compilation Builder and intro/outro cards.
import { selected } from './clips.js';
import { $, TEST_RUN, toast, escapeHtml } from './core.js';
import { stitchJobs, isActive } from './export.js';
import { shapeOf } from './presets.js';
import { settings } from './settings.js';

// ---------- compilation builder (cross-game, re-orderable) ------------------------
export let builderItems = [];

$('builderBtn').onclick = async () => {
  try {
    const res = await fetch('/api/exports' + (TEST_RUN ? '?includeTest=1' : '')).then(r => r.json());
    builderItems = res.files.map(f => ({ ...f, checked: true }));
    if (!builderItems.length) return toast('No exported clips yet — export some first, then build a compilation', true, 4500);
    if (!$('stitchName').value) $('stitchName').value = 'Highlights';
    $('transitionSel').value = localStorage.getItem('gr-transition') || '';
    renderBuilder();
    loadCardForms();
    updateCardPreviews();
    $('builderDlg').showModal();
  } catch (e) {
    toast('Could not list exported clips: ' + e.message, true);
  }
};

export function renderBuilder() {
  const list = $('builderList');
  list.innerHTML = '';
  builderItems.forEach((f, i) => {
    const shape = shapeOf(f.width, f.height);
    const chipCls = { '9:16': 'v916', '1:1': 'sq11' }[shape] || '';
    const row = document.createElement('div');
    row.className = 'brow' + (f.checked ? '' : ' off');
    row.innerHTML = `
      <input type="checkbox" ${f.checked ? 'checked' : ''}>
      <span class="bname">${escapeHtml(f.name)}</span>
      <span class="chip ${chipCls}">${shape}</span>
      <span class="bdur">${f.duration ? f.duration.toFixed(1) + 's' : ''}</span>
      <button data-mv="-1" title="move up">▲</button>
      <button data-mv="1" title="move down">▼</button>`;
    row.querySelector('input').onchange = e => { f.checked = e.target.checked; renderBuilder(); updateCardPreviews(); };
    row.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
      const j = i + parseInt(b.dataset.mv, 10);
      if (j < 0 || j >= builderItems.length) return;
      [builderItems[i], builderItems[j]] = [builderItems[j], builderItems[i]];
      renderBuilder();
    });
    list.appendChild(row);
  });
  const picked = builderItems.filter(f => f.checked);
  const shapes = [...new Set(picked.map(f => shapeOf(f.width, f.height)))];
  $('builderWarn').textContent = shapes.length > 1
    ? `⚠ Mixed ${shapes.join(' and ')} clips selected — the output will pad everything to the first clip’s shape. Usually you want one format per compilation.`
    : '';
}

// ---------- intro / outro cards ---------------------------------------------------
// Highlight cards: dark base, magenta accent bar, gold letter-spaced kicker, huge silver
// title, photo blended through a gradient (left panel for 16:9, bottom panel for 9:16).
export const cardImgs = { intro: null, outro: null }; // Image objects, not persisted
export const CARD_DEFAULTS = {
  intro: { kicker: 'GAME HIGHLIGHTS', title: '', sub: '', sub2: '', seconds: 3.5 },
  outro: { kicker: 'THANKS FOR WATCHING', title: '', sub: '', sub2: '', seconds: 3.5 },
};

export function readCardForm(kind) {
  return {
    on: $(kind + 'On').checked,
    kicker: $(kind + 'Kicker').value.trim(),
    title: $(kind + 'Title').value.trim(),
    sub: $(kind + 'Sub').value.trim(),
    sub2: $(kind + 'Sub2').value.trim(),
    seconds: parseFloat($(kind + 'Secs').value) || 3.5,
  };
}

export function loadCardForms() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('gr-cards')) || {}; } catch {}
  for (const kind of ['intro', 'outro']) {
    const d = { ...CARD_DEFAULTS[kind], ...(saved[kind] || {}) };
    if (!d.title) {
      const who = (settings.name || '').trim();
      const num = String(settings.number || '').trim().replace(/^#/, '');
      d.title = who ? `${who}${num ? ' #' + num : ''}` : 'Highlights';
    }
    $(kind + 'On').checked = !!d.on;
    $(kind + 'Kicker').value = d.kicker;
    $(kind + 'Title').value = d.title;
    $(kind + 'Sub').value = d.sub;
    $(kind + 'Sub2').value = d.sub2;
    $(kind + 'Secs').value = d.seconds;
    $('cardCfg-' + kind).classList.toggle('on', !!d.on);
  }
}

export function saveCardForms() {
  localStorage.setItem('gr-cards', JSON.stringify({ intro: readCardForm('intro'), outro: readCardForm('outro') }));
}

// first checked clip decides the compilation's shape
export function builderDims() {
  const f = builderItems.find(x => x.checked);
  return f ? { w: f.width, h: f.height } : { w: 1920, h: 1080 };
}

export function renderCard(W, H, cfg, img) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  // app palette: dark base + magenta accent + gold kicker (matches the badge and the UI)
  const NAVY = '16,18,22', GOLD = '#ffd400', ACCENT = '#d92a6c', SILVER = '#e8ebf0';
  x.fillStyle = `rgb(${NAVY})`; x.fillRect(0, 0, W, H);
  if (img) { // cover-fit
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  const vertical = H >= W; // 9:16 and 1:1 put the text in the lower third; 16:9 in a left panel
  const base = vertical ? W : H; // type scale basis
  const g = vertical
    ? x.createLinearGradient(0, H, 0, H * 0.30)
    : x.createLinearGradient(0, 0, W * 0.78, 0);
  g.addColorStop(0, `rgba(${NAVY},0.97)`);
  g.addColorStop(0.5, `rgba(${NAVY},0.8)`);
  g.addColorStop(1, `rgba(${NAVY},0)`);
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  const left = W * (vertical ? 0.08 : 0.06);
  const maxW = W * (vertical ? 0.84 : 0.56);
  const font = (wt, px) => `${wt} ${px}px "Segoe UI", Arial, sans-serif`;
  const fit = (text, wt, px) => { // shrink until the line fits
    x.font = font(wt, px);
    while (px > base * 0.02 && x.measureText(text).width > maxW) { px *= 0.95; x.font = font(wt, px); }
    return px;
  };

  // measure the text block, then draw it (16:9: vertically centered; 9:16: lower third)
  const kickPx = base * 0.028;
  const titleLines = (cfg.title || '').toUpperCase().split('|').map(s => s.trim()).filter(Boolean);
  const titlePx0 = base * (vertical ? 0.105 : 0.12);
  const subPx = base * 0.042, sub2Px = base * 0.028;
  let total = 0;
  if (cfg.kicker) total += kickPx * 1.8;
  total += titleLines.length * titlePx0 * 1.12;
  if (cfg.sub) total += base * 0.05 + subPx * 1.25; // gold bar + sub
  if (cfg.sub2) total += sub2Px * 1.7;
  let y = vertical ? H * 0.88 - total : Math.max(H * 0.16, (H - total) / 2);

  x.textBaseline = 'top'; x.textAlign = 'left';
  if (cfg.kicker) {
    x.font = font(700, kickPx);
    x.letterSpacing = `${Math.round(base * 0.012)}px`;
    x.fillStyle = GOLD;
    x.fillText(cfg.kicker.toUpperCase(), left, y);
    x.letterSpacing = '0px';
    y += kickPx * 1.8;
  }
  for (const ln of titleLines) {
    const px = fit(ln, 900, titlePx0);
    x.fillStyle = SILVER;
    x.fillText(ln, left, y + (titlePx0 - px) / 2);
    y += titlePx0 * 1.12;
  }
  if (cfg.sub) {
    x.fillStyle = ACCENT;
    x.fillRect(left, y + base * 0.018, base * 0.09, Math.max(2, base * 0.006)); // accent bar
    y += base * 0.05;
    fit(cfg.sub, 800, subPx);
    x.fillStyle = '#ffffff';
    x.fillText(cfg.sub, left, y);
    y += subPx * 1.25;
  }
  if (cfg.sub2) {
    fit(cfg.sub2.toUpperCase(), 700, sub2Px);
    x.letterSpacing = `${Math.round(base * 0.004)}px`;
    x.fillStyle = 'rgba(232,235,240,0.55)';
    x.fillText(cfg.sub2.toUpperCase(), left, y);
    x.letterSpacing = '0px';
  }
  return c;
}

export function updateCardPreview(kind) {
  const { w, h } = builderDims();
  const prev = $(kind + 'Prev');
  const pw = 300, ph = Math.round(pw * h / w); // render small — everything scales off the dims
  prev.width = pw; prev.height = ph;
  prev.getContext('2d').drawImage(renderCard(pw, ph, readCardForm(kind), cardImgs[kind]), 0, 0);
}
export function updateCardPreviews() { updateCardPreview('intro'); updateCardPreview('outro'); }

for (const kind of ['intro', 'outro']) {
  $(kind + 'On').onchange = e => {
    $('cardCfg-' + kind).classList.toggle('on', e.target.checked);
    saveCardForms(); updateCardPreviews();
  };
  $(kind + 'PickBtn').onclick = () => $(kind + 'File').click();
  $(kind + 'File').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => { cardImgs[kind] = img; updateCardPreview(kind); };
    img.src = URL.createObjectURL(f);
    $(kind + 'PickBtn').textContent = '📷 ' + f.name.slice(0, 18);
  };
  for (const fld of ['Kicker', 'Title', 'Sub', 'Sub2', 'Secs']) {
    $(kind + fld).addEventListener('input', () => { saveCardForms(); updateCardPreview(kind); });
  }
}

export function cardPayload(kind, dims) {
  const cfg = readCardForm(kind);
  if (!cfg.on) return null;
  if (!cardImgs[kind] && !cfg.title && !cfg.kicker) return null;
  return { png: renderCard(dims.w, dims.h, cfg, cardImgs[kind]).toDataURL('image/png'), seconds: cfg.seconds };
}

$('closeBuilder').onclick = () => $('builderDlg').close();
$('doStitch').onclick = async e => {
  e.preventDefault();
  const files = builderItems.filter(f => f.checked).map(f => f.name);
  if (files.length < 2) return toast('Check at least two clips to stitch', true);
  const name = $('stitchName').value.trim() || 'Highlights';
  const dims = builderDims();
  const transition = $('transitionSel').value;
  localStorage.setItem('gr-transition', transition);
  const btn = $('doStitch');
  btn.disabled = true;
  try {
    const res = await fetch('/api/stitch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testRun: TEST_RUN,
        files, outName: name,
        transition: transition || undefined, transitionSec: 0.5,
        intro: cardPayload('intro', dims), outro: cardPayload('outro', dims),
      }),
    }).then(r => r.json());
    if (res.error) throw new Error(res.error);
    stitchJobs.add(res.jobId);
    $('builderDlg').close();
    toast(`🎬 Stitching ${files.length} clips in the background — progress is in the top bar`, false, 4000);
  } catch (e2) {
    toast('Stitch failed: ' + e2.message, true, 6000);
  } finally {
    btn.disabled = false;
  }
};

export function onStitchJob(j) {
  if (isActive(j)) return;
  stitchJobs.delete(j.id);
  if (j.status === 'done') toast('🎬 Compilation ready → clips/' + j.file, false, 6000);
  else if (j.status === 'failed') toast('Stitch failed: ' + j.error, true, 8000);
  else toast('Stitch cancelled');
}
