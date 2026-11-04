// Social export presets, shared by the browser (Hold/Apply bar, crop guide, builder chips)
// and the server (output folder/suffix, crop math) — Node loads it with import(), like spline.js.
// Order is the on-screen order: vertical, square, landscape.
// Hold previews a shape. Apply commits it as the local export format.
// Neither step writes a file or posts anywhere.
export const PRESETS = [
  { id: 'vertical', ratio: '9:16', label: 'Vertical', posting: 'Reels, Shorts & TikTok',
    hint: 'Lacrosse and soccer highlights for Reels, Shorts, and TikTok',
    aspect: 9 / 16, crop: true, outW: 1080, outH: 1920, folder: 'Reels', suffix: ' [9x16]' },
  { id: 'square', ratio: '1:1', label: 'Square', posting: 'Instagram & Facebook feed',
    hint: 'Lacrosse and soccer highlights for the Instagram and Facebook feed',
    aspect: 1, crop: true, outW: 1080, outH: 1080, folder: 'Square', suffix: ' [1x1]' },
  { id: 'wide', ratio: '16:9', label: 'Landscape', posting: 'YouTube',
    hint: 'Full-field lacrosse and soccer film for YouTube',
    aspect: 16 / 9, crop: false, outW: null, outH: null, folder: 'YouTube', suffix: '' },
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

// appliedId may be missing or stale in localStorage; unknown ids fall back to landscape.
// Hold changes the preview only. Apply copies it into the format Export will use.
export function createPresetSession(appliedId) {
  let applied = BY_ID[appliedId] ? appliedId : 'wide';
  let held = applied;

  function snapshot() {
    return {
      held,
      applied,
      pending: held !== applied,
      exportFormat: applied,
      outbound: false,
    };
  }

  return {
    // Preview only. Does not change the format Export will use.
    hold(id) {
      if (!BY_ID[id]) throw new Error('unknown export preset: ' + id);
      held = id;
      return snapshot();
    },
    // Commit the held preset as the export shape. Still does not write or share.
    apply() {
      applied = held;
      return snapshot();
    },
    exportFormat() { return applied; },
    snapshot,
  };
}
