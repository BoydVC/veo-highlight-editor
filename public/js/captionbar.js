// Caption bar and local share sheet.
// Sample copy comes from lib/captions.js (served at /captions.js). Holding a preset
// does not write the clip and does not export. Apply stores the line on the selected
// clip and still does not export or post. The share sheet copies text or shows a placeholder.
import { $, toast } from './core.js';
import { onClipsRendered, renderClips, selected } from './clips.js';
import { saveProject } from './project.js';

const captionApi = window.GameReelsCaptions;
const captionUi = { sport: 'lacrosse', heldId: null, boundClip: undefined };

function captionPreset(id) {
  return captionApi.PRESETS.find(p => p.id === id);
}

function heldCaptionText(label) {
  if (!captionUi.heldId) return null;
  return captionApi.renderCaption(captionUi.heldId, { sport: captionUi.sport, label });
}

export function renderCaptionBar() {
  const c = selected();
  const selId = c ? c.id : null;
  if (selId !== captionUi.boundClip) {
    captionUi.heldId = null;
    captionUi.boundClip = selId;
    if (c && c.caption && (c.caption.sport === 'lacrosse' || c.caption.sport === 'soccer')) {
      captionUi.sport = c.caption.sport;
    }
  }
  const applied = c && c.caption && c.caption.text ? c.caption : null;
  const preview = heldCaptionText(c && c.label);
  const pending = !!(preview && (!applied || applied.text !== preview));
  const shown = pending || !applied ? preview : applied.text;

  $('captionSports').querySelectorAll('[data-sport]').forEach(btn => {
    const on = btn.dataset.sport === captionUi.sport;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  $('captionPresets').querySelectorAll('[data-preset]').forEach(btn => {
    const on = btn.dataset.preset === (captionUi.heldId || (!pending && applied && applied.preset));
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  const applyBtn = $('applyCaption');
  applyBtn.disabled = !pending;
  applyBtn.classList.toggle('accent', pending);
  applyBtn.textContent = pending ? 'Apply' : 'Applied';

  const preset = captionPreset(captionUi.heldId) || (applied && captionPreset(applied.preset));
  const presetName = preset ? preset.label : 'caption';
  let status;
  if (!preview && !applied) {
    status = 'Hold Short (100 characters or fewer), Medium, or Hashtag pack. Holding does not export. Apply keeps the caption on the clip. Nothing is posted.';
  } else if (pending) {
    status = `Holding ${presetName}. Preview only — Apply to keep it on this clip. Hold does not export. Nothing is posted.`;
  } else {
    status = `Applied ${presetName}. Export is a separate step. Nothing is posted.`;
  }
  if (preview && c && captionApi.ACTION_LABELS.includes(c.label) && captionApi.actionFor(c.label, captionUi.sport) === 'highlight') {
    status += ` ${c.label} stays off this sample, so the line says highlight.`;
  }
  $('captionStatus').textContent = status;
  $('captionPreview').textContent = shown || 'EXAMPLE · Hold a preset to preview synthetic sample copy.';
  const counting = shown && (pending ? captionUi.heldId === 'short' : applied && applied.preset === 'short');
  $('captionCount').textContent = counting ? `${[...shown].length}/100` : '';
}

function holdCaption(id) {
  if (!captionPreset(id)) return;
  captionUi.heldId = id;
  renderCaptionBar();
  const name = captionPreset(id).label;
  toast(`${name} is on hold. Apply to keep it. Nothing is exported or posted.`, false, 3200);
}

function setCaptionSport(sport) {
  captionUi.sport = sport === 'soccer' ? 'soccer' : 'lacrosse';
  renderCaptionBar();
}

function applyCaption() {
  const c = selected();
  if (!c) return toast('Select a clip first. Nothing was exported.', true);
  if (!captionUi.heldId) return toast('Hold a caption preset first. Nothing was exported.', true);
  const text = captionApi.renderCaption(captionUi.heldId, { sport: captionUi.sport, label: c.label });
  c.caption = { preset: captionUi.heldId, sport: captionUi.sport, text, example: true };
  saveProject();
  renderClips();
  toast('Caption applied on this clip. Export is separate. Nothing was posted.', false, 3200);
}

function shareSource() {
  const c = selected();
  const preview = heldCaptionText(c && c.label);
  const applied = c && c.caption && c.caption.text ? c.caption : null;
  if (preview && (!applied || applied.text !== preview)) {
    return { text: preview, applied: false };
  }
  if (applied) return { text: applied.text, applied: true };
  if (preview) return { text: preview, applied: false };
  return null;
}

function openShareSheet() {
  const src = shareSource();
  if (!src) return toast('Hold a caption preset first. Nothing was posted.', true);
  $('shareCaptionText').textContent = src.text;
  $('shareCaptionMeta').textContent = src.applied
    ? 'Applied caption. EXAMPLE sample copy. Copy stays on this PC.'
    : 'Preview only — not applied yet. EXAMPLE sample copy. Nothing is posted.';
  $('shareIntent').classList.add('hidden');
  $('shareIntentLines').textContent = '';
  $('shareDlg').showModal();
}

async function copyShareCaption() {
  const text = $('shareCaptionText').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('Caption copied on this PC. Nothing was posted.', false, 2800);
  } catch {
    toast('Clipboard blocked. Select the caption and copy it. Nothing was posted.', true, 4000);
  }
}

function showShareIntent() {
  const text = $('shareCaptionText').textContent;
  const intent = captionApi.shareIntentPlaceholder(text);
  $('shareIntentMsg').textContent = intent.message;
  const list = $('shareIntentLines');
  list.innerHTML = '';
  for (const line of intent.lines) {
    const li = document.createElement('li');
    li.textContent = line;
    list.appendChild(li);
  }
  $('shareIntent').classList.remove('hidden');
  toast(intent.message, false, 4000);
}

function initCaptionUi() {
  const box = $('captionPresets');
  for (const preset of captionApi.PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.preset = preset.id;
    btn.textContent = preset.label;
    btn.title = preset.hint + ' Hold previews. Apply keeps it. Nothing is posted.';
    btn.setAttribute('aria-label', `${preset.label}. Hold to preview.`);
    btn.onclick = () => holdCaption(preset.id);
    box.appendChild(btn);
  }
  $('captionSports').querySelectorAll('[data-sport]').forEach(btn => {
    btn.onclick = () => setCaptionSport(btn.dataset.sport);
  });
  $('applyCaption').onclick = applyCaption;
  $('shareCaption').onclick = openShareSheet;
  $('copyCaptionBtn').onclick = copyShareCaption;
  $('openShareIntent').onclick = showShareIntent;
  $('closeShare').onclick = () => $('shareDlg').close();
  onClipsRendered(renderCaptionBar);
  renderCaptionBar();
}

initCaptionUi();
