// Badge & label settings (stored in localStorage) and the settings dialog.
import { artCache, renderBadge, renderCircle } from './art.js';
import { renderLabelBar } from './clips.js';
import { $, state, toast } from './core.js';
import { drawOverlay } from './player.js';

// ---------- settings ----------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  name: '', number: '',
  badgeColor: '#d92a6c', textColor: '#ffd400', circleColor: '#ffd400',
  badgeScale: 1, circleScale: 1, labelSeconds: 3,
  // Shared plus lacrosse (Draw Win, Ground Ball, Dodge) and soccer (Dribble). Editable in Settings.
  labels: ['Goal', 'Assist', 'Shot', 'Draw Win', 'Ground Ball', 'Dodge', 'Dribble', 'Steal', 'Defense'],
};
export let settings = loadSettings();

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('gr-settings'));
    return { ...DEFAULT_SETTINGS, ...s };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function openSettings() {
  $('setName').value = settings.name;
  $('setNumber').value = settings.number;
  $('setBadgeColor').value = settings.badgeColor;
  $('setTextColor').value = settings.textColor;
  $('setCircleColor').value = settings.circleColor;
  $('setBadgeScale').value = settings.badgeScale;
  $('setCircleScale').value = settings.circleScale;
  $('setLabelSecs').value = settings.labelSeconds;
  $('setLabels').value = settings.labels.join(', ');
  drawBadgePreview();
  $('settingsDlg').showModal();
}
$('settingsBtn').onclick = openSettings;

export function readSettingsForm() {
  return {
    name: $('setName').value.trim(),
    number: $('setNumber').value.trim().replace(/^#/, ''),
    badgeColor: $('setBadgeColor').value,
    textColor: $('setTextColor').value,
    circleColor: $('setCircleColor').value,
    badgeScale: parseFloat($('setBadgeScale').value),
    circleScale: parseFloat($('setCircleScale').value),
    labelSeconds: parseFloat($('setLabelSecs').value) || 3,
    labels: $('setLabels').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 9),
  };
}

// one click to match the badge/circle/banner to the app's own palette (CSS tokens)
$('themeColorsBtn').onclick = () => {
  const cs = getComputedStyle(document.documentElement);
  $('setBadgeColor').value = cs.getPropertyValue('--accent').trim();
  $('setTextColor').value = cs.getPropertyValue('--gold').trim();
  $('setCircleColor').value = cs.getPropertyValue('--gold').trim();
  drawBadgePreview();
};
$('settingsDlg').addEventListener('input', drawBadgePreview);
$('settingsDlg').addEventListener('close', () => {
  if ($('settingsDlg').returnValue === 'ok') {
    settings = readSettingsForm();
    localStorage.setItem('gr-settings', JSON.stringify(settings));
    artCache.key = null;
    renderLabelBar();
    drawOverlay();
    toast('Settings saved');
  }
});

export function drawBadgePreview() {
  const tmpSettings = readSettingsForm();
  const saved = settings;
  settings = tmpSettings;
  const savedDims = { vw: state.vw, vh: state.vh };
  state.vw = 1920; state.vh = 1080; // render preview art at a fixed reference resolution
  const badge = renderBadge(), circle = renderCircle();
  state.vw = savedDims.vw; state.vh = savedDims.vh;
  settings = saved;
  const cv = $('badgePreview'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const cx = cv.width / 2;
  const groupTop = Math.max(4, (cv.height - circle.height - 8 - badge.height) / 2);
  ctx.drawImage(circle, cx - circle.width / 2, groupTop);
  ctx.drawImage(badge, cx - badge.width / 2, groupTop + circle.height + 8);
}
