// UI smoke test: drives the real app in Edge — load game, mark in/out, create
// clip, label it, place tracking anchors by clicking, export through the UI.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// regenerate the synthetic test game if it was deleted (40s of moving test pattern)
const testGame = path.join(__dirname, 'games', 'Test Game vs Skyhawks.mp4');
// This smoke test owns the synthetic game's project. A leftover clip from an
// earlier run would make "did Hold write a caption?" look at the wrong card.
fs.rmSync(path.join(__dirname, 'projects', 'Test Game vs Skyhawks.json'), { force: true });
fs.rmSync(path.join(__dirname, 'projects', 'Test Game vs Skyhawks.json.bak'), { force: true });
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
  const context = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const posts = [];
  page.on('request', req => { if (req.method() === 'POST') posts.push(req.url()); });
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

  // Caption presets: hold previews, Apply stores, neither exports or posts.
  const exampleFlag = await page.$eval('#captionExample', el => el.textContent.trim());
  if (exampleFlag !== 'EXAMPLE') throw new Error('EXAMPLE label missing: ' + exampleFlag);
  const exampleVisible = await page.$eval('#captionExample', el => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
  });
  if (!exampleVisible) throw new Error('EXAMPLE label is not visible');

  await page.click('#captionPresets button[data-preset=short]');
  const holding = await page.$eval('#captionStatus', el => el.textContent);
  console.log('caption hold:', holding);
  if (!/Holding Short/.test(holding) || !/does not export/.test(holding) || !/Nothing is posted/.test(holding)) {
    throw new Error('hold copy: ' + holding);
  }
  const preview = await page.$eval('#captionPreview', el => el.textContent);
  console.log('short preview:', preview, preview.length);
  if (!preview.startsWith('EXAMPLE') || !/Lacrosse Goal/.test(preview) || [...preview].length > 100) {
    throw new Error('short preview: ' + preview);
  }
  if (await page.$('.clip.selected .caption-chip')) throw new Error('hold wrote a caption onto the clip');
  if (posts.some(u => /\/api\/(export|invent_upload|auto_post|share_external|share)\b/.test(u))) {
    throw new Error('hold contacted export or share: ' + posts.join(','));
  }

  await page.click('#applyCaption');
  const appliedCopy = await page.$eval('#captionStatus', el => el.textContent);
  console.log('caption apply:', appliedCopy);
  if (!/Applied Short/.test(appliedCopy) || !/Nothing is posted/.test(appliedCopy)) {
    throw new Error('apply copy: ' + appliedCopy);
  }
  if (await page.$eval('.clip.selected .caption-chip', el => el.textContent.trim()) !== 'EXAMPLE') {
    throw new Error('applied chip lost the EXAMPLE label');
  }
  if (posts.some(u => /\/api\/(export|invent_upload|auto_post|share_external|share)\b/.test(u))) {
    throw new Error('Apply contacted export or share: ' + posts.join(','));
  }

  await page.click('#shareCaption');
  await page.waitForSelector('#shareDlg[open]');
  const shareText = await page.$eval('#shareCaptionText', el => el.textContent);
  if (shareText !== preview) throw new Error('share text: ' + shareText);
  if (await page.$eval('#shareDlg .example-flag', el => el.textContent.trim()) !== 'EXAMPLE') {
    throw new Error('share sheet EXAMPLE label missing');
  }
  await page.click('#copyCaptionBtn');
  await page.waitForFunction(() => /Caption copied|Clipboard blocked/.test(document.getElementById('toast').textContent || ''));
  const copyToast = await page.$eval('#toast', el => el.textContent);
  console.log('copy toast:', copyToast);
  if (/uploaded to|posted to|success/i.test(copyToast)) throw new Error('copy toast invented a post: ' + copyToast);
  await page.click('#openShareIntent');
  await page.waitForSelector('#shareIntent:not(.hidden)');
  const intent = await page.$eval('#shareIntentMsg', el => el.textContent);
  const lines = await page.$eval('#shareIntentLines', el => el.innerText);
  console.log('share intent:', intent, '|', lines.replace(/\n/g, ' / '));
  if (!/Share intent placeholder/.test(intent) || !/Nothing was uploaded/.test(intent)) {
    throw new Error('intent copy: ' + intent);
  }
  if (/success|uploaded to|posted to/i.test(intent + '\n' + lines)) throw new Error('invented upload success');
  if (!/Instagram: not opened/.test(lines) || !/TikTok: not opened/.test(lines) || !/Upload: refused/.test(lines)) {
    throw new Error('intent lines: ' + lines);
  }
  if (posts.some(u => /\/api\/(export|invent_upload|auto_post|share_external|share)\b/.test(u))) {
    throw new Error('share sheet contacted export or share: ' + posts.join(','));
  }
  await page.screenshot({ path: '_caption_share.png' });
  await page.click('#closeShare');

  // A new hold must not replace the applied caption or export.
  await page.click('#captionPresets button[data-preset=hashtags]');
  const tagHold = await page.$eval('#captionStatus', el => el.textContent);
  const tagPreview = await page.$eval('#captionPreview', el => el.textContent);
  console.log('hashtag hold:', tagHold, tagPreview);
  if (!/Holding Hashtag pack/.test(tagHold) || !/does not export/.test(tagHold)) throw new Error(tagHold);
  if (!tagPreview.startsWith('EXAMPLE') || !/#/.test(tagPreview)) throw new Error(tagPreview);
  if (await page.$eval('.clip.selected .caption-chip', el => el.getAttribute('title')) !== preview) {
    throw new Error('hashtag hold replaced the applied caption');
  }

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
  const presetHold = await page.$eval('#presetStatus', el => el.textContent);
  console.log('hold status:', presetHold);
  if (!/Holding 1:1 Square/.test(presetHold) || !/Nothing is posted/.test(presetHold)) {
    throw new Error('hold copy: ' + presetHold);
  }
  if (await page.$eval('#presetChoices [data-preset=square]', el => el.classList.contains('is-applied'))) {
    throw new Error('square hold was applied without Apply');
  }
  if (!await page.$eval('#presetChoices [data-preset=wide]', el => el.classList.contains('is-applied'))) {
    throw new Error('applied preset changed on hold');
  }
  await page.waitForTimeout(400);
  if (posts.some(u => u.includes('/api/export'))) throw new Error('hold triggered an export');

  // export through the UI while square is only on hold — must stay 16:9
  await page.click('[data-act=export]');
  await page.waitForSelector('.clip .status.ok', { timeout: 120000 });
  const wideExport = await page.$eval('.clip .status', el => el.textContent);
  console.log('export:', wideExport);
  if (/Square\/|\[1x1\]/.test(wideExport)) throw new Error('hold changed the export: ' + wideExport);

  // 9:16 hold draws the crop guide and leaves landscape applied
  await page.click('#presetChoices [data-preset=vertical]');
  await page.waitForTimeout(400);
  const verticalHold = await page.$eval('#presetStatus', el => el.textContent);
  console.log('vertical hold:', verticalHold);
  if (!/Holding 9:16 Vertical/.test(verticalHold) || !/Nothing is posted/.test(verticalHold)) {
    throw new Error('vertical hold copy: ' + verticalHold);
  }
  if (!await page.$eval('#presetChoices [data-preset=wide]', el => el.classList.contains('is-applied'))) {
    throw new Error('vertical hold cleared the applied landscape preset');
  }
  console.log('vertical preview drawn, no errors so far:', errors.length === 0);

  // Apply square, then an export through the UI lands in Square/ as [1x1]
  await page.click('#presetChoices [data-preset=square]');
  await page.click('#applyPreset');
  const presetApplied = await page.$eval('#presetStatus', el => el.textContent);
  console.log('apply status:', presetApplied);
  if (!/1:1 Square is applied/.test(presetApplied) || !/Nothing is posted/.test(presetApplied)) {
    throw new Error('apply copy: ' + presetApplied);
  }
  if (posts.some(u => u.includes('/api/export') && posts.filter(u => u.includes('/api/export')).length > 1)) {
    throw new Error('Apply triggered an export');
  }
  await page.click('[data-act=export]');
  await page.waitForFunction(() => /Square\/.*\[1x1\]\.mp4/.test((document.querySelector('.clip .status.ok') || {}).textContent || ''), null, { timeout: 120000 });
  console.log('square export:', await page.$eval('.clip .status', el => el.textContent));
  await page.click('#presetChoices [data-preset=wide]');
  await page.click('#applyPreset');

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
  await page.waitForSelector('.clip.selected .caption-chip', { timeout: 10000 });
  console.log('autosave restored:', await page.$eval('.clip .name', el => el.textContent));
  const restored = await page.$eval('.clip.selected .caption-chip', el => el.getAttribute('title') || '');
  console.log('caption restored:', restored);
  if (!restored.startsWith('EXAMPLE') || /Jamie|Skyhawk/.test(restored)) {
    throw new Error('restored caption: ' + restored);
  }

  // edits inside the 700 ms autosave delay: a reload must keep them, and switching games
  // must not write this game's clips into the other game's project
  const gameB = path.join(__dirname, 'games', 'Test Game B.mp4');
  fs.copyFileSync(testGame, gameB);
  const projectOf = name => page.evaluate(async n => {
    const opt = [...document.getElementById('videoSelect').options].find(o => o.textContent.startsWith(n + ' ('));
    return (await fetch('/api/project?video=' + encodeURIComponent(decodeURIComponent(opt.value)))).json();
  }, name);
  const pick = name => page.evaluate(n => {
    const sel = document.getElementById('videoSelect');
    sel.value = [...sel.options].find(o => o.textContent.startsWith(n + ' (')).value;
    sel.dispatchEvent(new Event('change'));
    sel.blur();
  }, name);
  const nudgeIn = () => page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true })));
  await page.click('#refreshVideos');
  await page.waitForTimeout(300);
  const inMs0 = (await projectOf('Test Game vs Skyhawks.mp4')).clips[0].inMs;
  await nudgeIn();
  await page.reload();                                             // well inside 700 ms
  await page.waitForSelector('#videoSelect option:nth-child(3)', { state: 'attached' });
  const inMs1 = (await projectOf('Test Game vs Skyhawks.mp4')).clips[0].inMs;
  if (!(inMs1 > inMs0)) throw new Error(`edit lost on reload: inMs ${inMs0} → ${inMs1}`);
  await pick('Test Game vs Skyhawks.mp4');
  await page.waitForSelector('.clip', { timeout: 10000 });
  await nudgeIn();
  await pick('Test Game B.mp4');                                   // switch right after the edit
  await page.waitForTimeout(1500);
  const b = await projectOf('Test Game B.mp4'), a = await projectOf('Test Game vs Skyhawks.mp4');
  if (b.clips.length) throw new Error('switching games wrote the old clips into Test Game B');
  if (!(a.clips[0].inMs > inMs1)) throw new Error('edit lost when switching games');
  console.log(`quick edits kept: reload ${inMs0}→${inMs1} ms, switch →${a.clips[0].inMs} ms, other game untouched`);
  fs.rmSync(gameB, { force: true });
  for (const f of ['Test Game B.json', 'Test Game B.json.bak']) fs.rmSync(path.join(__dirname, 'projects', f), { force: true });

  await page.screenshot({ path: '_ui.png' });
  fs.rmSync(path.join(__dirname, 'clips', '_test'), { recursive: true, force: true }); // tidy test exports
  await browser.close();

  if (errors.length) {
    console.error('PAGE ERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('UI TEST PASSED');
})().catch(e => { console.error('UI TEST FAILED:', e.message); process.exit(1); });
