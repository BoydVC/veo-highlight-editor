// Export-format table, crop math, and Hold/Apply (public/js/presets.js) — no server needed.
// Hold previews a shape. Apply commits it. Export format stays on the applied
// preset until then, and neither step posts or shares.
const assert = require('assert');

(async () => {
  const { PRESETS, presetById, cropWindow, shapeOf, createPresetSession } = await import('./public/js/presets.js');

  assert.deepStrictEqual(PRESETS.map(p => p.id), ['vertical', 'square', 'wide'], 'on-screen order');
  assert.deepStrictEqual(PRESETS.map(p => [p.folder, p.suffix]),
    [['Reels', ' [9x16]'], ['Square', ' [1x1]'], ['YouTube', '']], 'output folders and filename suffixes');
  assert.strictEqual(presetById(undefined).id, 'wide', 'missing format means 16:9');
  assert.throws(() => presetById('cinema'), /unknown export format/);

  const vertical = presetById('vertical');
  assert.strictEqual(vertical.ratio, '9:16');
  assert.strictEqual(vertical.label, 'Vertical');
  assert.match(vertical.posting, /Reels/);
  assert.match(vertical.posting, /Shorts/);
  assert.match(vertical.posting, /TikTok/);
  assert.match(vertical.hint, /lacrosse and soccer/i);
  assert.strictEqual(vertical.folder, 'Reels');
  assert.strictEqual(vertical.suffix, ' [9x16]');

  const square = presetById('square');
  assert.strictEqual(square.ratio, '1:1');
  assert.strictEqual(square.label, 'Square');
  assert.match(square.posting, /Instagram/);
  assert.match(square.posting, /Facebook/);
  assert.match(square.posting, /feed/i);
  assert.match(square.hint, /lacrosse and soccer/i);
  assert.strictEqual(square.folder, 'Square');
  assert.strictEqual(square.suffix, ' [1x1]');
  assert.strictEqual(square.outW, 1080);
  assert.strictEqual(square.outH, 1080);

  const wide = presetById('wide');
  assert.strictEqual(wide.ratio, '16:9');
  assert.strictEqual(wide.label, 'Landscape');
  assert.match(wide.posting, /YouTube/);
  assert.match(wide.hint, /lacrosse and soccer/i);
  assert.strictEqual(wide.crop, false);
  assert.strictEqual(wide.folder, 'YouTube');

  const copy = JSON.stringify(PRESETS);
  assert.doesNotMatch(copy, /charlotte/i);
  assert.doesNotMatch(copy, /share|auto-?post|upload/i);

  // typical Veo film
  assert.strictEqual(cropWindow('wide', 1920, 1080), null, '16:9 keeps the full frame');
  assert.deepStrictEqual(cropWindow('vertical', 1920, 1080), { cropW: 608, cropH: 1080, outW: 1080, outH: 1920 });
  assert.deepStrictEqual(cropWindow('square', 1920, 1080), { cropW: 1080, cropH: 1080, outW: 1080, outH: 1080 });
  // 4K source, and an odd-sized one: crops stay even and inside the frame
  assert.deepStrictEqual(cropWindow('square', 3840, 2160), { cropW: 2160, cropH: 2160, outW: 1080, outH: 1080 });
  for (const [w, h] of [[1921, 1081], [1280, 720], [1080, 1920], [1000, 1000]]) {
    for (const id of ['vertical', 'square']) {
      const c = cropWindow(id, w, h);
      assert.ok(c.cropW <= w && c.cropH <= h, `${id} ${w}x${h} fits`);
      assert.ok(c.cropW % 2 === 0 && c.cropH % 2 === 0, `${id} ${w}x${h} is even`);
      assert.ok(Math.abs(c.cropW / c.cropH - presetById(id).aspect) < 0.01, `${id} ${w}x${h} keeps its shape`);
    }
  }

  assert.strictEqual(shapeOf(1920, 1080), '16:9');
  assert.strictEqual(shapeOf(1080, 1920), '9:16');
  assert.strictEqual(shapeOf(1080, 1080), '1:1');
  assert.strictEqual(shapeOf(0, 0), '16:9', 'unknown size reads as 16:9');

  const session = createPresetSession('wide');
  let snap = session.snapshot();
  assert.strictEqual(snap.exportFormat, 'wide');
  assert.strictEqual(snap.pending, false);
  assert.strictEqual(snap.outbound, false);

  snap = session.hold('square');
  assert.strictEqual(snap.held, 'square');
  assert.strictEqual(snap.applied, 'wide');
  assert.strictEqual(snap.exportFormat, 'wide');
  assert.strictEqual(session.exportFormat(), 'wide');
  assert.strictEqual(snap.pending, true);
  assert.strictEqual(snap.outbound, false);

  snap = session.hold('vertical');
  assert.strictEqual(snap.held, 'vertical');
  assert.strictEqual(session.exportFormat(), 'wide');

  snap = session.apply();
  assert.strictEqual(snap.applied, 'vertical');
  assert.strictEqual(snap.exportFormat, 'vertical');
  assert.strictEqual(snap.pending, false);
  assert.strictEqual(snap.outbound, false);
  assert.strictEqual(session.exportFormat(), 'vertical');

  session.apply();
  assert.strictEqual(session.exportFormat(), 'vertical');

  const mutated = session.snapshot();
  mutated.outbound = true;
  mutated.exportFormat = 'square';
  assert.strictEqual(session.snapshot().outbound, false);
  assert.strictEqual(session.exportFormat(), 'vertical');

  assert.throws(() => session.hold('charlotte'), /unknown export preset/);
  assert.strictEqual(session.snapshot().held, 'vertical');
  assert.strictEqual(session.exportFormat(), 'vertical');

  const fallback = createPresetSession('not-a-preset');
  assert.strictEqual(fallback.exportFormat(), 'wide');
  assert.strictEqual(fallback.snapshot().pending, false);

  assert.strictEqual(createPresetSession.share, undefined);
  assert.strictEqual(PRESETS.share, undefined);

  console.log('PRESET TESTS PASSED');
})().catch(e => { console.error('PRESET TESTS FAILED:', e.message); process.exit(1); });
