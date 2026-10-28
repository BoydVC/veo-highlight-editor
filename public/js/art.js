// Overlay art (badge, foot circle, label banner) rendered at video resolution — preview === export.
import { $, state } from './core.js';
import { settings } from './settings.js';

// ---------- overlay art (badge / circle / label PNGs) ----------------------------
// Rendered at actual video resolution so preview === export.
export let artCache = { key: null, badge: null, circle: null };
export function artKey() {
  return [settings.name, settings.number, settings.badgeColor, settings.textColor,
    settings.circleColor, settings.badgeScale, settings.circleScale, state.vw, state.vh].join('|');
}

export function getBadgeCanvas() {
  if (artCache.key !== artKey()) rebuildArt();
  return artCache.badge;
}
export function getCircleCanvas() {
  if (artCache.key !== artKey()) rebuildArt();
  return artCache.circle;
}

export function rebuildArt() {
  artCache = { key: artKey(), badge: renderBadge(), circle: renderCircle() };
}

export function badgeText() {
  const name = (settings.name || 'Player').trim();
  const number = String(settings.number || '').trim().replace(/^#/, '');
  return `${name}${number ? '  #' + number : ''}`.toUpperCase();
}

export function renderBadge() {
  const H = state.vh;
  const fontPx = Math.round(H * 0.026 * settings.badgeScale);
  const text = badgeText();
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  const padX = fontPx * 0.7, padY = fontPx * 0.42, notch = fontPx * 0.42;
  c.width = Math.ceil(tw + padX * 2);
  c.height = Math.ceil(fontPx + padY * 2 + notch);
  const ctx2 = c.getContext('2d');
  const w = c.width, bodyH = c.height - notch, r = bodyH * 0.3;
  ctx2.fillStyle = settings.badgeColor;
  ctx2.beginPath();
  ctx2.roundRect(0, notch, w, bodyH, r);
  ctx2.fill();
  // pointer notch — badge sits below the circle, so it points up at the player
  ctx2.beginPath();
  ctx2.moveTo(w / 2 - notch, notch + 1);
  ctx2.lineTo(w / 2, 1);
  ctx2.lineTo(w / 2 + notch, notch + 1);
  ctx2.closePath(); ctx2.fill();
  ctx2.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  ctx2.textBaseline = 'middle'; ctx2.textAlign = 'center';
  ctx2.fillStyle = settings.textColor;
  ctx2.fillText(text, w / 2, notch + bodyH / 2 + fontPx * 0.05);
  return c;
}

export function renderCircle() {
  const W = state.vw;
  const rx = Math.round(W * 0.020 * settings.circleScale);
  const ry = Math.round(rx * 0.38);
  const stroke = Math.max(3, Math.round(rx * 0.16));
  const pad = stroke * 2 + 4;
  const c = document.createElement('canvas');
  c.width = rx * 2 + pad * 2; c.height = ry * 2 + pad * 2;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  // soft glow under-ring then crisp ring
  ctx.strokeStyle = settings.circleColor;
  ctx.globalAlpha = 0.35; ctx.lineWidth = stroke * 2.2;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1; ctx.lineWidth = stroke;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  return c;
}

// basisH/maxW let the 9:16 export size the banner for its 1080x1920 output
// (it overlays after the crop+scale, so source-frame sizing would be tiny)
export function renderLabelBanner(labelText, basisH = state.vh, maxW = Infinity) {
  // same visual language as the badge (badge color, rounded body, heavy type), just larger
  let fontPx = Math.round(basisH * 0.055);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const text = labelText.toUpperCase();
  ctx.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  let tw = ctx.measureText(text).width;
  if (tw + fontPx * 1.4 > maxW) { // shrink to fit narrow vertical frame
    fontPx = Math.max(12, Math.floor(fontPx * (maxW - fontPx * 1.4) / tw));
    ctx.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
    tw = ctx.measureText(text).width;
  }
  const padX = fontPx * 0.7, padY = fontPx * 0.42;
  c.width = Math.ceil(tw + padX * 2); c.height = Math.ceil(fontPx + padY * 2);
  const ctx2 = c.getContext('2d');
  ctx2.fillStyle = settings.badgeColor;
  ctx2.beginPath(); ctx2.roundRect(0, 0, c.width, c.height, c.height * 0.3); ctx2.fill();
  ctx2.font = `800 ${fontPx}px "Segoe UI", Arial, sans-serif`;
  ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
  ctx2.fillStyle = settings.textColor;
  ctx2.fillText(text, c.width / 2, c.height / 2 + fontPx * 0.05);
  return c;
}
