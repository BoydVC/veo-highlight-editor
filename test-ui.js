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

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // settings saved under the pre-rename cc-* key must carry over to gr-*
  await page.addInitScript(() => {
    if (!localStorage.getItem('gr-settings')) localStorage.setItem('cc-settings', JSON.stringify({ name: 'OLDNAME', number: '7' }));
  });
  await page.goto('http://localhost:4242/?testRun=1');
  await page.waitForSelector('#videoSelect option:nth-child(2)', { state: 'attached' });
  const carried = await page.evaluate(() => JSON.parse(localStorage.getItem('gr-settings') || '{}').name);
  if (carried !== 'OLDNAME') throw new Error('old cc-settings were not carried over: ' + carried);
  console.log('old settings carried over:', carried);

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

  // export through the UI
  await page.click('[data-act=export]');
  await page.waitForSelector('.clip .status.ok', { timeout: 120000 });
  console.log('export:', await page.$eval('.clip .status', el => el.textContent));

  // 9:16 mode — crop guide must render without errors
  await page.selectOption('#exportFormat', 'vertical');
  await page.waitForTimeout(500);
  console.log('vertical mode: crop guide drawn, no errors so far:', errors.length === 0);

  // 1:1 mode — guide renders, and an export through the UI lands in Square/ as [1x1]
  await page.selectOption('#exportFormat', 'square');
  await page.waitForTimeout(500);
  await page.click('[data-act=export]');
  await page.waitForFunction(() => /Square\/.*\[1x1\]\.mp4/.test((document.querySelector('.clip .status.ok') || {}).textContent || ''), null, { timeout: 120000 });
  console.log('square export:', await page.$eval('.clip .status', el => el.textContent));
  await page.selectOption('#exportFormat', 'wide');

  // settings dialog: change the number, Save → stored and the badge redrawn
  await page.click('#settingsBtn');
  await page.fill('#setNumber', '12');
  await page.click('#saveSettings');
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('gr-settings') || '{}')).number === '12');
  console.log('settings saved:', await page.$eval('#toast', el => el.textContent));

  // compilation builder lists the export with format chip
  await page.click('#builderBtn');
  await page.waitForSelector('.brow');
  const rows = await page.$$eval('.brow', els => els.map(el => el.textContent.trim()));
  console.log('builder rows:', rows.length);
  const chips = await page.$$eval('.brow .chip', els => els.map(el => el.textContent).sort());
  if (chips.join() !== '16:9,1:1') throw new Error('builder chips: ' + chips.join()); // sorted as text
  console.log('builder chips:', chips.join(' '), '| warning:', await page.$eval('#builderWarn', el => el.textContent.slice(0, 30)));
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
