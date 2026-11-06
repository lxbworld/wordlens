// One-off: renders the GitHub README in a real browser and reports broken pieces.
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

function cachedChromium() {
  const root = join(homedir(), 'Library/Caches/ms-playwright');
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium-')) continue;
    for (const suffix of [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-linux/chrome',
    ]) {
      const exe = join(root, entry, suffix);
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error('no cached chromium');
}

const dir = await mkdtemp(join(tmpdir(), 'wl-gh-'));
const browser = await chromium.launch({ executablePath: cachedChromium(), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

const report = async (url, label) => {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('article.markdown-body', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const data = await page.evaluate(() => {
    const root = document.querySelector('article.markdown-body');
    const images = [...root.querySelectorAll('img')].map((img) => ({
      src: img.getAttribute('src'),
      loaded: img.naturalWidth > 0,
      w: img.naturalWidth,
      h: img.naturalHeight,
    }));
    const links = [...root.querySelectorAll('a')].map((a) => ({
      text: (a.textContent ?? '').trim().slice(0, 30),
      href: a.getAttribute('href'),
    }));
    return {
      title: document.title,
      images,
      linkCount: links.length,
      externalLinks: links.filter((l) => l.href?.startsWith('http')),
      tables: root.querySelectorAll('table').length,
      headings: [...root.querySelectorAll('h2')].map((h) => h.textContent),
      height: root.getBoundingClientRect().height,
    };
  });
  console.log(`\n=== ${label} :: ${page.url()} ===`);
  console.log('h2s:', data.headings.join(' | '));
  console.log('tables:', data.tables, '| links:', data.linkCount);
  console.log('images:', JSON.stringify(data.images, null, 0));
  console.log('external links:', data.externalLinks.map((l) => `${l.text} -> ${l.href}`).join('\n  '));
  await page.screenshot({ path: `/tmp/gh-${label}.png`, fullPage: false });
};

await report('https://github.com/lxbworld/wordlens', 'en');
await report('https://github.com/lxbworld/wordlens/blob/main/README.zh-CN.md', 'zh');

// Relative links inside the Chinese README must resolve.
await page.goto('https://github.com/lxbworld/wordlens/blob/main/README.zh-CN.md');
const zhLinks = await page.evaluate(() =>
  [...document.querySelectorAll('article.markdown-body a')].map((a) => a.href),
);
console.log('\nzh link targets:', zhLinks.join('\n  '));

await page.goto('https://github.com/lxbworld/wordlens/releases/latest', { waitUntil: 'domcontentloaded' });
console.log('\nlatest release:', page.url(), '| asset:', await page.locator('a[href$=".zip"]').first().textContent().catch(() => 'none'));

await browser.close();
