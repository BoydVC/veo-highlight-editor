// Social export presets for GameReels.
// Hold previews a shape. Apply commits it as the local export format.
// Neither step writes a file, contacts a network, or posts anywhere.
// Export (a separate explicit action) is what writes an MP4 on this PC.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GameReelsPresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Order is the on-screen order: vertical, square, landscape.
  const PRESETS = [
    {
      id: 'vertical',
      ratio: '9:16',
      label: 'Vertical',
      posting: 'Reels, Shorts & TikTok',
      hint: 'Lacrosse and soccer highlights for Reels, Shorts, and TikTok',
      aspect: 9 / 16,
      outW: 1080,
      outH: 1920,
      suffix: ' [9x16]',
      folder: 'Reels',
      crop: true,
    },
    {
      id: 'square',
      ratio: '1:1',
      label: 'Square',
      posting: 'Instagram & Facebook feed',
      hint: 'Lacrosse and soccer highlights for the Instagram and Facebook feed',
      aspect: 1,
      outW: 1080,
      outH: 1080,
      suffix: ' [1x1]',
      folder: 'Square',
      crop: true,
    },
    {
      id: 'wide',
      ratio: '16:9',
      label: 'Landscape',
      posting: 'YouTube',
      hint: 'Full-field lacrosse and soccer film for YouTube',
      aspect: 16 / 9,
      outW: null,
      outH: null,
      suffix: '',
      folder: 'YouTube',
      crop: false,
    },
  ];

  const BY_ID = Object.fromEntries(PRESETS.map(p => [p.id, p]));

  function presetById(id) {
    const p = BY_ID[id];
    if (!p) throw new Error('unknown export preset: ' + id);
    return p;
  }

  function evenPx(n) {
    return Math.round(n / 2) * 2;
  }

  // Source-pixel crop for a preset. null means keep the full frame (16:9 landscape).
  // On typical Veo 1920×1080 film, 9:16 crops the sides to 608×1080 and 1:1 crops
  // the sides to a 1080×1080 square. Both then scale to the social output size.
  function cropWindow(formatId, srcW, srcH) {
    const p = presetById(formatId || 'wide');
    if (!p.crop) return null;
    const W = srcW, H = srcH;
    if (!(W > 0) || !(H > 0)) throw new Error('crop window needs source dimensions');
    const target = p.aspect;
    let cropW, cropH;
    if (W / H >= target) {
      cropH = evenPx(H);
      if (cropH > H) cropH = H - (H % 2);
      cropW = evenPx(cropH * target);
    } else {
      cropW = evenPx(W);
      if (cropW > W) cropW = W - (W % 2);
      cropH = evenPx(cropW / target);
    }
    if (cropW > W) cropW = W - (W % 2);
    if (cropH > H) cropH = H - (H % 2);
    if (cropW < 2 || cropH < 2) throw new Error('source frame is too small to crop');
    return { id: p.id, cropW, cropH, outW: p.outW, outH: p.outH };
  }

  // Compilation-builder chip. Square is its own shape, not a landscape clip.
  function shapeOf(width, height) {
    if (!width || !height) return '16:9';
    const r = width / height;
    if (Math.abs(r - 1) < 0.06) return '1:1';
    if (height > width * 1.05) return '9:16';
    return '16:9';
  }

  // appliedId may be missing or stale in localStorage; unknown ids fall back to landscape.
  function createPresetSession(appliedId) {
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
        presetById(id);
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

  return { PRESETS, presetById, cropWindow, shapeOf, createPresetSession };
});
