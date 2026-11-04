// Gate probes must stay refused. Nothing is uploaded, auto-posted, or shared off this PC.
const assert = require('assert');
const { spawn } = require('child_process');

const BASE = 'http://127.0.0.1:4242';
const GATES = ['invent_upload', 'auto_post', 'share_external'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function serverUp() {
  try {
    const r = await fetch(BASE + '/api/videos');
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) return null;
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, stdio: 'inherit' });
  for (let i = 0; i < 40; i++) {
    if (await serverUp()) return child;
    await sleep(150);
  }
  child.kill();
  throw new Error('server did not start');
}

async function probe(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

(async () => {
  const child = await ensureServer();
  try {
    const videos = await fetch(BASE + '/api/videos');
    assert.strictEqual(videos.status, 200, 'library route should stay available');

    for (const gate of GATES) {
      const direct = await probe('/api/' + gate, {});
      assert.strictEqual(direct.status, 403, gate + ' path');
      assert.strictEqual(direct.json.ok, false);
      assert.strictEqual(direct.json.uploaded, false);
      assert.strictEqual(direct.json.posted, false);
      assert.strictEqual(direct.json.gate, gate);
      assert.doesNotMatch(JSON.stringify(direct.json), /success|uploaded to|posted to/i);

      const onExport = await probe('/api/export', { probe: gate, videoPath: '/etc/passwd', clip: { name: 'nope' } });
      assert.strictEqual(onExport.status, 403, 'export probe ' + gate);
      assert.strictEqual(onExport.json.uploaded, false);

      const flagged = await probe('/api/export', { [gate]: true });
      assert.strictEqual(flagged.status, 403, 'export flag ' + gate);

      const onStitch = await probe('/api/stitch', { action: gate, files: ['../server.js'] });
      assert.strictEqual(onStitch.status, 403, 'stitch probe ' + gate);

      const query = await fetch(BASE + '/api/share?gate=' + gate);
      assert.strictEqual(query.status, 403, 'query probe ' + gate);
    }

    const share = await probe('/api/share', { caption: 'EXAMPLE · Lacrosse Goal. Synthetic clip — sample copy only.' });
    assert.strictEqual(share.status, 403);
    assert.strictEqual(share.json.uploaded, false);
    assert.strictEqual(share.json.posted, false);

    console.log('GATE TESTS PASSED');
  } finally {
    if (child) child.kill();
  }
})().catch(e => {
  console.error('GATE TESTS FAILED:', e.message);
  process.exit(1);
});
