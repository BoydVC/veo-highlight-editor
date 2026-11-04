// Export formats, shared by the browser (format picker, crop guide, builder chips) and the
// server (output folder/suffix, crop math) — Node loads it with import(), like spline.js.
// Order is the dropdown order.
export const PRESETS = [
  { id: 'wide', ratio: '16:9', label: 'YouTube', aspect: 16 / 9, crop: false,
    outW: null, outH: null, folder: 'YouTube', suffix: '' },
  { id: 'vertical', ratio: '9:16', label: 'Reels', aspect: 9 / 16, crop: true,
    outW: 1080, outH: 1920, folder: 'Reels', suffix: ' [9x16]' },   // Reels, Shorts, TikTok
  { id: 'square', ratio: '1:1', label: 'Square', aspect: 1, crop: true,
    outW: 1080, outH: 1080, folder: 'Square', suffix: ' [1x1]' },    // Instagram / Facebook feed
];

const BY_ID = Object.fromEntries(PRESETS.map(p => [p.id, p]));

export function presetById(id) {
  const p = BY_ID[id || 'wide'];
  if (!p) throw new Error('unknown export format: ' + id);
  return p;
}

const even = n => Math.max(2, Math.round(n / 2) * 2);

// Source-pixel crop size for a format, or null when it keeps the full frame (16:9).
// The largest window of the preset's shape that fits the source: on 1920×1080 Veo film
// 9:16 is 608×1080 and 1:1 is 1080×1080; the export then scales it to outW×outH.
export function cropWindow(id, srcW, srcH) {
  const p = presetById(id);
  if (!p.crop) return null;
  if (!(srcW > 0 && srcH > 0)) throw new Error('crop window needs the source size');
  const fitsHeight = srcW / srcH >= p.aspect;
  const cropW = Math.min(even(fitsHeight ? srcH * p.aspect : srcW), srcW - (srcW % 2));
  const cropH = Math.min(even(fitsHeight ? srcH : srcW / p.aspect), srcH - (srcH % 2));
  return { cropW, cropH, outW: p.outW, outH: p.outH };
}

// Shape of an exported file, for the Compilation Builder's chips and mixed-shape warning.
export function shapeOf(width, height) {
  if (!width || !height) return '16:9';
  const r = width / height;
  if (Math.abs(r - 1) < 0.06) return '1:1';
  return r < 1 ? '9:16' : '16:9';
}
