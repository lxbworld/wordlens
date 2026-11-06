// Regenerates the screenshots used in the README: `npm run screenshots`.
// Needs a Chromium that accepts --load-extension (see tests/e2e/extension.test.ts).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve('dist');
const OUT = resolve('docs');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const ARTICLE = `<!doctype html><html><head><meta charset="utf-8"><title>Speculative decoding, explained</title>
<style>
  body { font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 660px;
         margin: 56px auto; padding: 0 24px; color: #1f2937; background: #fff; }
  h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .meta { color: #9ca3af; font-size: 13px; margin: 0 0 28px; }
  p { margin: 0 0 18px; }
  a { color: #4f46e5; }
</style></head><body>
  <h1>Speculative decoding, explained</h1>
  <p class="meta">Notes · 6 min read</p>
  <p>Speculative decoding improves inference throughput by letting a small draft model propose
     tokens that a larger model then verifies. Read the <a href="#paper">paper</a> for the
     distribution proof.</p>
  <p>In practice the win depends on how often the draft model's guesses are accepted, which in turn
     depends on the task and on the sampling temperature.</p>
</body></html>`;

function cachedChromiumExecutables() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), 'Library/Caches/ms-playwright'),
    join(homedir(), '.cache/ms-playwright'),
  ].filter(Boolean);
  const inside = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-linux/chrome',
  ];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium-')) continue;
      for (const suffix of inside) {
        const exe = join(root, entry, suffix);
        if (existsSync(exe)) found.push(exe);
      }
    }
  }
  return found.sort().reverse();
}

async function main() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(ARTICLE);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;

  const executablePath = process.env.WORDLENS_CHROME_PATH ?? cachedChromiumExecutables()[0];
  const dir = await mkdtemp(join(tmpdir(), 'wordlens-shots-'));
  const context = await chromium.launchPersistentContext(dir, {
    executablePath,
    headless: true,
    viewport: { width: 1000, height: 640 },
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  await mkdir(OUT, { recursive: true });

  const id = [...createHashSha256(DIST)].join('');

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(400);

  for (const [term, translation] of [
    ['speculative decoding', '投机解码'],
    ['inference', '推理'],
    ['draft model', '草稿模型'],
  ]) {
    await selectOnPage(page, term);
    await page.locator('.wordlens-toolbar').click();
    await page.locator('.chinese').fill(translation);
    await page.locator('.save').click();
    await page.waitForTimeout(200);
  }

  await page.screenshot({ path: join(OUT, 'screenshot-annotation.png'), clip: { x: 0, y: 0, width: 1000, height: 420 } });
  await page.evaluate(() => window.getSelection()?.removeAllRanges());

  // The selection toolbar, then the editor it opens.
  await selectOnPage(page, 'throughput');
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, 'screenshot-toolbar.png'), clip: { x: 0, y: 0, width: 1000, height: 420 } });
  await page.locator('.wordlens-toolbar').click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, 'screenshot-editor.png'), clip: { x: 0, y: 0, width: 1000, height: 420 } });
  await page.locator('.cancel').click();

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 420 });
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  await sleep(300);
  await popup.screenshot({ path: join(OUT, 'screenshot-popup.png') });

  await context.close();
  await new Promise((done) => server.close(done));
  await rm(dir, { recursive: true, force: true });
  console.log('screenshots written to', OUT);
}

function createHashSha256(path) {
  const hash = createHash('sha256').update(path).digest('hex').slice(0, 32);
  return [...hash].map((char) => String.fromCharCode(97 + Number.parseInt(char, 16)));
}

async function selectOnPage(page, needle) {
  await page.evaluate((text) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node;
      if (textNode.parentElement?.closest('[data-wordlens-annotation]')) continue;
      const index = textNode.data.toLowerCase().indexOf(text.toLowerCase());
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
  }, needle);
  await page.waitForTimeout(120);
}

await main();
