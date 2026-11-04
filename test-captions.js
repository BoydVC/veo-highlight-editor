// Caption presets and the share-intent placeholder. No server, no network.
const assert = require('assert');
const captions = require('./lib/captions');

const { renderCaption, actionFor, createCaptionSession, shareIntentPlaceholder, PRESETS, ACTION_LABELS, SHORT_MAX, REFUSED_GATES } = captions;

assert.deepStrictEqual(PRESETS.map(p => p.id), ['short', 'medium', 'hashtags']);
assert.deepStrictEqual(REFUSED_GATES, ['invent_upload', 'auto_post', 'share_external']);

const sports = ['lacrosse', 'soccer'];
const labels = [null, 'Not A Name', 'Jamie', ...ACTION_LABELS];

for (const sport of sports) {
  for (const label of labels) {
    const short = renderCaption('short', { sport, label });
    const medium = renderCaption('medium', { sport, label });
    const tags = renderCaption('hashtags', { sport, label });
    assert.ok(short.startsWith('EXAMPLE'), short);
    assert.ok(medium.startsWith('EXAMPLE'), medium);
    assert.ok(tags.startsWith('EXAMPLE'), tags);
    assert.ok([...short].length <= SHORT_MAX, `${[...short].length} > ${SHORT_MAX}: ${short}`);
    assert.ok([...medium].length > SHORT_MAX, 'medium should be longer than a short caption: ' + medium);
    assert.ok((tags.match(/#/g) || []).length >= 4, tags);
    for (const text of [short, medium, tags]) {
      assert.doesNotMatch(text, /Jamie|Not A Name|Skyhawk|uploaded|posted to|instagram\.com|tiktok\.com/i);
      assert.match(text, /EXAMPLE/);
    }
  }
}

// A lacrosse-only label stays off a soccer sample, and the reverse.
assert.match(renderCaption('short', { sport: 'soccer', label: 'Draw Win' }), /Soccer highlight/);
assert.match(renderCaption('short', { sport: 'lacrosse', label: 'Dribble' }), /Lacrosse highlight/);
assert.match(renderCaption('short', { sport: 'soccer', label: 'Dribble' }), /Soccer Dribble/);
assert.strictEqual(actionFor('Ground Ball', 'lacrosse'), 'Ground Ball');
assert.strictEqual(actionFor('Ground Ball', 'soccer'), 'highlight');
assert.strictEqual(actionFor('Dribble', 'lacrosse'), 'highlight');
assert.strictEqual(actionFor('Jamie', 'soccer'), 'highlight');
assert.match(renderCaption('hashtags', { sport: 'lacrosse', label: 'Ground Ball' }), /#GroundBall/);

assert.throws(() => renderCaption('invent_upload', { sport: 'lacrosse' }), /unknown caption preset/);
assert.throws(() => renderCaption('auto_post', {}), /unknown caption preset/);

// Hold does not apply. Apply stores the line and still does not export or post.
let session = createCaptionSession();
let snap = session.snapshot();
assert.strictEqual(snap.applied, null);
assert.strictEqual(snap.exports, false);
assert.strictEqual(snap.outbound, false);

snap = session.hold('short');
assert.strictEqual(snap.held, 'short');
assert.strictEqual(snap.applied, null);
assert.strictEqual(snap.pending, true);
assert.strictEqual(snap.exports, false);
assert.match(snap.heldText, /^EXAMPLE · Lacrosse highlight/);
assert.ok([...snap.heldText].length <= SHORT_MAX);

snap = session.setLabel('Goal');
assert.match(snap.heldText, /Lacrosse Goal/);
assert.strictEqual(snap.applied, null, 'changing the label while holding must not apply');

snap = session.apply();
assert.strictEqual(snap.pending, false);
assert.strictEqual(snap.applied, 'short');
assert.strictEqual(snap.appliedText, snap.heldText);
assert.strictEqual(snap.exports, false);
assert.strictEqual(snap.outbound, false);

snap = session.hold('hashtags');
assert.strictEqual(snap.pending, true);
assert.strictEqual(snap.applied, 'short', 'holding another preset must leave the applied one in place');
assert.strictEqual(snap.exports, false);

snap = session.setSport('soccer');
assert.match(snap.heldText, /#Soccer/);
assert.match(snap.appliedText, /Lacrosse Goal/, 'Apply freezes the line until the next Apply');
assert.strictEqual(snap.applied, 'short');
assert.strictEqual(snap.pending, true);
assert.strictEqual(snap.exports, false);

snap = session.apply();
assert.strictEqual(snap.pending, false);
assert.strictEqual(snap.applied, 'hashtags');
assert.strictEqual(snap.exports, false);

session = createCaptionSession('medium');
snap = session.snapshot();
assert.strictEqual(snap.held, 'medium');
assert.strictEqual(snap.applied, 'medium');
assert.strictEqual(snap.pending, false);
assert.match(snap.appliedText, /^EXAMPLE · Synthetic lacrosse/);

assert.throws(() => session.hold('share_external'), /unknown caption preset/);
const fresh = createCaptionSession();
assert.throws(() => fresh.apply(), /hold a caption before Apply/);

const intent = shareIntentPlaceholder(renderCaption('medium', { sport: 'soccer', label: 'Shot' }));
assert.strictEqual(intent.kind, 'placeholder');
assert.strictEqual(intent.uploaded, false);
assert.strictEqual(intent.posted, false);
assert.strictEqual(intent.instagram, false);
assert.strictEqual(intent.tiktok, false);
assert.strictEqual(intent.openedApp, null);
assert.match(intent.message, /placeholder/i);
assert.match(intent.message, /Nothing was uploaded/);
assert.doesNotMatch(intent.message, /success|uploaded to|posted to/i);
assert.ok(intent.lines.some(l => /Instagram: not opened/.test(l)));
assert.ok(intent.lines.some(l => /TikTok: not opened/.test(l)));
assert.ok(intent.lines.some(l => /Upload: refused/.test(l)));
assert.throws(() => shareIntentPlaceholder('Goal by a player'), /EXAMPLE/);

// Every rendered token stays inside the synthetic vocabulary.
const allowed = new Set(('EXAMPLE Synthetic clip sample copy only Lacrosse Soccer lacrosse soccer highlight for a social caption of from Veo film No player names GameReels keeps the file on this PC and does not post it Goal Assist Shot Draw Win Ground Ball Dodge Dribble Steal Defense SyntheticClip Highlight HighlightReel SampleOnly DrawWin GroundBall').split(/\s+/).map(w => w.toLowerCase()));
for (const sport of sports) {
  for (const label of [null, ...ACTION_LABELS, 'Jamie']) {
    for (const preset of PRESETS) {
      const text = renderCaption(preset.id, { sport, label });
      const tokens = text.split(/[^A-Za-z0-9#]+/).filter(Boolean);
      for (const token of tokens) {
        const word = token.replace(/^#/, '').toLowerCase();
        assert.ok(allowed.has(word), 'unexpected token "' + word + '" in ' + text);
      }
    }
  }
}

console.log('short example:', renderCaption('short', { sport: 'lacrosse', label: 'Goal' }), [...renderCaption('short', { sport: 'lacrosse', label: 'Goal' })].length);
console.log('medium example:', renderCaption('medium', { sport: 'soccer', label: 'Dribble' }));
console.log('hashtags example:', renderCaption('hashtags', { sport: 'lacrosse', label: 'Ground Ball' }));
console.log('CAPTION TESTS PASSED');
