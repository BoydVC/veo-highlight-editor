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
  const opts = { headless: true };
  try {
    return await chromium.launch({ ...opts, channel: 'msedge' });
  } catch {
    return await chromium.launch({ ...opts, channel: 'chrome' });
  }
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

  // export through the UI
  await page.click('[data-act=export]');
  await page.waitForSelector('.clip .status.ok', { timeout: 120000 });
  console.log('export:', await page.$eval('.clip .status', el => el.textContent));

  // 9:16 mode — crop guide must render without errors
  await page.selectOption('#exportFormat', 'vertical');
  await page.waitForTimeout(500);
  console.log('vertical mode: crop guide drawn, no errors so far:', errors.length === 0);
  await page.selectOption('#exportFormat', 'wide');

  // compilation builder lists the export with format chip
  await page.click('#builderBtn');
  await page.waitForSelector('.brow');
  const rows = await page.$$eval('.brow', els => els.map(el => el.textContent.trim()));
  console.log('builder rows:', rows.length);
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

  await page.screenshot({ path: '_ui.png' });
  fs.rmSync(path.join(__dirname, 'clips', '_test'), { recursive: true, force: true }); // tidy test exports
  await browser.close();

  if (errors.length) {
    console.error('PAGE ERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('UI TEST PASSED');
})().catch(e => { console.error('UI TEST FAILED:', e.message); process.exit(1); });
