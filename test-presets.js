// Preset selection smoke test. No server, no ffmpeg, no browser.
// Hold previews a shape. Apply commits it. Export format stays on the applied
// preset until then, and neither step posts or shares.
const assert = require('assert');
const { PRESETS, presetById, createPresetSession, cropWindow, shapeOf } = require('./lib/presets');

const ids = PRESETS.map(p => p.id);
assert.deepStrictEqual(ids, ['vertical', 'square', 'wide']);

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

const vCrop = cropWindow('vertical', 1920, 1080);
assert.strictEqual(vCrop.cropW, 608);
assert.strictEqual(vCrop.cropH, 1080);
assert.strictEqual(vCrop.outW, 1080);
assert.strictEqual(vCrop.outH, 1920);
assert.ok(Math.abs(vCrop.cropW / vCrop.cropH - 9 / 16) < 0.01);

const sCrop = cropWindow('square', 1920, 1080);
assert.strictEqual(sCrop.cropW, 1080);
assert.strictEqual(sCrop.cropH, 1080);
assert.strictEqual(sCrop.outW, 1080);
assert.strictEqual(sCrop.outH, 1080);

assert.strictEqual(cropWindow('wide', 1920, 1080), null);

assert.strictEqual(shapeOf(1080, 1920), '9:16');
assert.strictEqual(shapeOf(1080, 1080), '1:1');
assert.strictEqual(shapeOf(1920, 1080), '16:9');

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

const api = require('./lib/presets');
assert.strictEqual(api.share, undefined);
assert.strictEqual(api.post, undefined);
assert.strictEqual(api.upload, undefined);

console.log('PRESET TESTS PASSED');
