// Export-format table and crop math (public/js/presets.js) — no server needed.
const assert = require('assert');

(async () => {
  const { PRESETS, presetById, cropWindow, shapeOf } = await import('./public/js/presets.js');

  assert.deepStrictEqual(PRESETS.map(p => p.id), ['wide', 'vertical', 'square'], 'dropdown order');
  assert.deepStrictEqual(PRESETS.map(p => [p.folder, p.suffix]),
    [['YouTube', ''], ['Reels', ' [9x16]'], ['Square', ' [1x1]']], 'output folders and filename suffixes');
  assert.strictEqual(presetById(undefined).id, 'wide', 'missing format means 16:9');
  assert.throws(() => presetById('cinema'), /unknown export format/);

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

  console.log('PRESET TESTS PASSED');
})().catch(e => { console.error('PRESET TESTS FAILED:', e.message); process.exit(1); });
