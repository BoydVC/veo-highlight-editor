// UI smoke test: drives the real app in Edge — load game, mark in/out, create
// clip, label it, place tracking anchors by clicking, export through the UI.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// regenerate the synthetic test game if it was deleted (40s of moving test pattern)
const testGame = path.join(__dirname, 'games', 'Test Game vs Skyhawks.mp4');
if (!fs.existsSync(testGame)) {
  console.log('test game missing — regenerating…');
  require('child_process').execFileSync(require('ffmpeg-static'), ['-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '40', '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', testGame]);
}

async function launchBrowser() {
  const attempts = [
    () => chromium.launch({ channel: 'msedge', headless: true }),
    () => chromium.launch({ channel: 'chrome', headless: true }),
    () => chromium.launch({ headless: true }),
  ];
  let last;
  for (const go of attempts) {
    try { return await go(); } catch (e) { last = e; }
  }
  throw last;
}

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:4242/?testRun=1');
  await page.waitForSelector('#videoSelect option:nth-child(2)', { state: 'attached' });

  // load the test game (by name — never a real game file)
  await page.evaluate(() => {
    const sel = document.getElementById('videoSelect');
    sel.value = [...sel.options].find(o => o.textContent.includes('Test Game')).value;
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => {
    const v = document.getElementById('video');
    return v.readyState >= 2 && v.duration > 0;
  }, { timeout: 20000 });
  console.log('video loaded:', await page.$eval('#videoMeta', el => el.textContent));

  // seek to 5s, mark in; 9s mark out; create clip
  await page.evaluate(() => { document.getElementById('video').currentTime = 5; });
  await page.waitForTimeout(400);
  await page.keyboard.press('i');
  await page.evaluate(() => { document.getElementById('video').currentTime = 9; });
  await page.waitForTimeout(400);
  await page.keyboard.press('o');
  await page.keyboard.press('c');
  await page.waitForSelector('.clip');
  console.log('clip created:', await page.$eval('.clip .name', el => el.textContent));

  // label with hotkey 1 (Goal)
  await page.keyboard.press('1');
  await page.waitForSelector('.clip .badge-label');
  console.log('label:', await page.$eval('.clip .badge-label', el => el.textContent));

  // frame stepping changes time by ~1/30s
  const t0 = await page.$eval('#video', v => v.currentTime);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const t1 = await page.$eval('#video', v => v.currentTime);
  console.log('frame step:', ((t1 - t0) * 1000).toFixed(1) + 'ms');

  // tracking: T, then click around the video 6 times (auto-advance happens per click)
  await page.keyboard.press('t');
  await page.waitForSelector('#trackBanner:not(.hidden)');
  const box = await page.$eval('#videoWrap', el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(box.x + box.w * (0.3 + i * 0.06), box.y + box.h * 0.5);
    await page.waitForTimeout(350); // let the seek settle
  }
  console.log('anchors:', await page.$eval('#anchorCount', el => el.textContent));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#trackBanner.hidden', { state: 'attached' });
  console.log('tracking saved:', await page.$eval('.clip .track-ok', el => el.textContent));

  // social presets: hold previews, Apply commits, neither one exports or posts
  const posts = [];
  page.on('request', req => { if (req.method() === 'POST') posts.push(req.url()); });

  const labels = await page.$$eval('#presetChoices [data-preset]', els => els.map(el => ({
    id: el.dataset.preset,
    text: el.innerText.replace(/\s+/g, ' ').trim(),
    applied: el.classList.contains('is-applied'),
  })));
  console.log('presets:', labels.map(l => l.id + ' ' + l.text).join(' | '));
  if (labels.map(l => l.id).join(',') !== 'vertical,square,wide') {
    throw new Error('preset order: ' + labels.map(l => l.id).join(','));
  }
  const byId = Object.fromEntries(labels.map(l => [l.id, l]));
  if (!/9:16/.test(byId.vertical.text) || !/Reels/.test(byId.vertical.text) || !/TikTok/.test(byId.vertical.text)) {
    throw new Error('vertical label: ' + byId.vertical.text);
  }
  if (!/1:1/.test(byId.square.text) || !/feed/i.test(byId.square.text)) {
    throw new Error('square label: ' + byId.square.text);
  }
  if (!/16:9/.test(byId.wide.text) || !/YouTube/.test(byId.wide.text) || !byId.wide.applied) {
    throw new Error('landscape should start applied: ' + byId.wide.text);
  }

  await page.click('#presetChoices [data-preset=square]');
  const holding = await page.$eval('#presetStatus', el => el.textContent);
  console.log('hold status:', holding);
  if (!/Holding 1:1 Square/.test(holding) || !/Nothing is posted/.test(holding)) {
    throw new Error('hold copy: ' + holding);
  }
  if (await page.$eval('#presetChoices [data-preset=square]', el => el.classList.contains('is-applied'))) {
    throw new Error('square hold was applied without Apply');
  }
  if (!await page.$eval('#presetChoices [data-preset=wide]', el => el.classList.contains('is-applied'))) {
    throw new Error('applied preset changed on hold');
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: '_ui-presets.png' });
  if (posts.some(u => u.includes('/api/export'))) throw new Error('hold triggered an export');

  await page.click('#applyPreset');
  const appliedCopy = await page.$eval('#presetStatus', el => el.textContent);
  console.log('apply status:', appliedCopy);
  if (!/1:1 Square is applied/.test(appliedCopy) || !/Nothing is posted/.test(appliedCopy)) {
    throw new Error('apply copy: ' + appliedCopy);
  }
  if (posts.some(u => u.includes('/api/export'))) throw new Error('Apply triggered an export');

  // export through the UI — must use the applied square preset, not a held preview
  await page.click('[data-act=export]');
  await page.waitForSelector('.clip .status.ok', { timeout: 120000 });
  const exportMsg = await page.$eval('.clip .status', el => el.textContent);
  console.log('export:', exportMsg);
  if (!/Square\//.test(exportMsg) || !/\[1x1\]/.test(exportMsg)) {
    throw new Error('export did not use the applied square preset: ' + exportMsg);
  }

  // 9:16 hold draws the crop guide and leaves the applied square preset in place
  await page.click('#presetChoices [data-preset=vertical]');
  await page.waitForTimeout(400);
  const verticalHold = await page.$eval('#presetStatus', el => el.textContent);
  console.log('vertical hold:', verticalHold);
  if (!/Holding 9:16 Vertical/.test(verticalHold) || !/Nothing is posted/.test(verticalHold)) {
    throw new Error('vertical hold copy: ' + verticalHold);
  }
  if (!await page.$eval('#presetChoices [data-preset=square]', el => el.classList.contains('is-applied'))) {
    throw new Error('vertical hold cleared the applied square preset');
  }
  console.log('vertical preview drawn, no errors so far:', errors.length === 0);

  // compilation builder lists the export with format chip
  await page.click('#builderBtn');
  await page.waitForSelector('.brow');
  const rows = await page.$$eval('.brow', els => els.map(el => el.textContent.replace(/\s+/g, ' ').trim()));
  console.log('builder rows:', rows.length);
  if (!rows.some(r => r.includes('1:1'))) throw new Error('builder missing 1:1 chip: ' + rows.join(' | '));
  await page.click('#closeBuilder');

  // reload — project should restore from autosave
  await page.reload();
  await page.waitForSelector('#videoSelect option:nth-child(2)', { state: 'attached' });
  await page.selectOption('#videoSelect', { index: 1 });
  await page.waitForSelector('.clip', { timeout: 10000 });
  console.log('autosave restored:', await page.$eval('.clip .name', el => el.textContent));

  await page.screenshot({ path: '_ui.png' });
  fs.rmSync(path.join(__dirname, 'clips', '_test'), { recursive: true, force: true }); // tidy test exports
  await browser.close();

  if (errors.length) {
    console.error('PAGE ERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('UI TEST PASSED');
})().catch(e => { console.error('UI TEST FAILED:', e.message); process.exit(1); });
