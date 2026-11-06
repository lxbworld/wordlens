import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright-core';

const DIST = resolve('dist');

const PAGES: Record<string, string> = {
  '/page1': `<!doctype html><html><head><title>Paper</title></head><body>
    <h1>Paper</h1>
    <p id="text">Speculative decoding improves inference throughput.</p>
    <p id="more">Inference also matters here.</p>
  </body></html>`,
  '/page2': `<!doctype html><html><head><title>Notes</title></head><body>
    <p id="text">We rely on inference here.</p>
  </body></html>`,
};

let server: Server;
let origin: string;
let altOrigin: string;
let userDataDir: string;
let context: BrowserContext;
let extensionId: string;

/* ---------- polling helpers (vitest's expect has no auto-retrying assertions) ---------- */

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function eventually(check: () => Promise<void>, description: string, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out waiting for ${description} (last: ${reason})`);
}

async function normalizedText(locator: Locator): Promise<string> {
  const text = await locator.first().textContent({ timeout: 2_000 });
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function waitForText(locator: Locator, expected: string, description = expected): Promise<void> {
  return eventually(async () => {
    const actual = await normalizedText(locator);
    if (actual !== expected) throw new Error(`text is "${actual}"`);
  }, description);
}

function waitForCount(locator: Locator, expected: number): Promise<void> {
  return eventually(async () => {
    const actual = await locator.count();
    if (actual !== expected) throw new Error(`found ${actual} elements`);
  }, `${expected} matching element(s)`);
}

function waitForVisible(locator: Locator): Promise<void> {
  return eventually(async () => {
    if (!(await locator.isVisible())) throw new Error('not visible');
  }, 'element to be visible');
}

function waitForHidden(locator: Locator): Promise<void> {
  return eventually(async () => {
    if (await locator.isVisible()) throw new Error('still visible');
  }, 'element to be hidden');
}

function waitForValue(locator: Locator, expected: string): Promise<void> {
  return eventually(async () => {
    const actual = await locator.inputValue({ timeout: 2_000 });
    if (actual !== expected) throw new Error(`value is "${actual}"`);
  }, `input value "${expected}"`);
}

/* ---------------------------------- extension setup ---------------------------------- */

/** Chrome derives an unpacked extension's id from the absolute path of its folder. */
function unpackedExtensionId(path: string): string {
  const hash = createHash('sha256').update(path).digest('hex').slice(0, 32);
  return [...hash].map((char) => String.fromCharCode(97 + Number.parseInt(char, 16))).join('');
}

/**
 * Chromium builds that earlier Playwright installs left in the browser cache, so the
 * suite can reuse an already-downloaded Chromium instead of fetching one.
 */
function cachedChromiumExecutables(): string[] {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), 'Library/Caches/ms-playwright'),
    join(homedir(), '.cache/ms-playwright'),
  ].filter((root): root is string => Boolean(root));

  const insideBundle = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-linux/chrome',
  ];

  const found: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium-')) continue;
      for (const suffix of insideBundle) {
        const executable = join(root, entry, suffix);
        if (existsSync(executable)) found.push(executable);
      }
    }
  }
  return found.sort().reverse();
}

/**
 * Chromium for the extension: an explicit WORDLENS_CHROME_PATH first, then any cached
 * Chromium, then Playwright's own download, then the system Chrome. The first one that
 * accepts --load-extension wins.
 */
async function launchWithExtension(dir: string): Promise<BrowserContext> {
  const attempts: Array<Parameters<typeof chromium.launchPersistentContext>[1]> = [];
  const customPath = process.env.WORDLENS_CHROME_PATH;
  if (customPath && existsSync(customPath)) attempts.push({ executablePath: customPath });
  for (const executablePath of cachedChromiumExecutables()) attempts.push({ executablePath });
  attempts.push({});
  attempts.push({ channel: 'chrome' });

  const failures: string[] = [];
  for (const [index, attempt] of attempts.entries()) {
    let candidate: BrowserContext | undefined;
    try {
      candidate = await chromium.launchPersistentContext(`${dir}-${index}`, {
        headless: true,
        args: [
          `--disable-extensions-except=${DIST}`,
          `--load-extension=${DIST}`,
          '--no-first-run',
          '--no-default-browser-check',
        ],
        ...attempt,
      });
      if (await extensionReachable(candidate)) {
        await rm(`${dir}-${index}`, { recursive: true, force: true }).catch(() => {});
        return candidate;
      }
      failures.push(`${JSON.stringify(attempt)}: extension did not load`);
    } catch (error) {
      failures.push(`${JSON.stringify(attempt)}: ${(error as Error).message.split('\n')[0]}`);
    }
    await candidate?.close().catch(() => {});
  }
  throw new Error(`No Chromium could load the extension:\n${failures.join('\n')}`);
}

async function extensionReachable(target: BrowserContext): Promise<boolean> {
  const page = await target.newPage();
  try {
    const response = await page.goto(`chrome-extension://${extensionId}/popup/index.html`, {
      timeout: 10_000,
    });
    return Boolean(response) && (await page.title()) === 'WordLens';
  } catch {
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}

/* ---------------------------------- page interaction ---------------------------------- */

/** Select `needle` in #text like a user drag-selecting it, and fire the mouseup the extension listens for. */
async function selectOnPage(page: Page, needle: string): Promise<void> {
  const found = await page.evaluate((text) => {
    const container = document.getElementById('text');
    if (!container) return false;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      if (textNode.parentElement?.closest('[data-wordlens-annotation]')) continue;
      const index = textNode.data.toLowerCase().indexOf(text.toLowerCase());
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + text.length);
      const selection = window.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    }
    return false;
  }, needle);
  expect(found, `could not select "${needle}"`).toBe(true);
}

async function addTerm(page: Page, needle: string, translation: string): Promise<void> {
  await selectOnPage(page, needle);
  const toolbar = page.locator('.wordlens-toolbar');
  await waitForVisible(toolbar);
  await toolbar.click();
  await waitForValue(page.locator('.english'), needle === 'speculative decoding' ? 'Speculative decoding' : needle);
  await page.locator('.chinese').fill(translation);
  await page.locator('.save').click();
  await waitForHidden(page.locator('.wordlens-editor'));
}

beforeAll(async () => {
  extensionId = unpackedExtensionId(DIST);
  server = createServer((request, response) => {
    const body = PAGES[request.url ?? ''];
    if (!body) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not start');
  origin = `http://127.0.0.1:${address.port}`;
  altOrigin = `http://localhost:${address.port}`;

  userDataDir = await mkdtemp(join(tmpdir(), 'wordlens-e2e-'));
  context = await launchWithExtension(userDataDir);
}, 180_000);

afterAll(async () => {
  await context?.close().catch(() => {});
  await new Promise<void>((done) => server?.close(() => done()));
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
});

describe('WordLens in a real Chrome', () => {
  it('starts with an unannotated page and an empty dictionary', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/page1`);
    await waitForText(
      page.locator('#text'),
      'Speculative decoding improves inference throughput.',
    );
    await waitForCount(page.locator('.wordlens-annotation'), 0);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await waitForText(popup.locator('#count'), '0 entries');
    await popup.close();
    await page.close();
  });

  it('adds a phrase through the selection toolbar and annotates it immediately', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/page1`);
    await addTerm(page, 'speculative decoding', '投机解码');

    await waitForText(
      page.locator('#text'),
      'Speculative decoding（投机解码） improves inference throughput.',
    );
    // The gloss is a real element; the page text itself is untouched.
    await waitForCount(page.locator('#text .wordlens-annotation'), 1);
    // Every text node on the page is scanned, not just the first one.
    await waitForText(page.locator('#more'), 'Inference also matters here.');
    await page.close();
  });

  it('keeps the dictionary and the annotations after a reload', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/page1`);
    await waitForText(
      page.locator('#text'),
      'Speculative decoding（投机解码） improves inference throughput.',
    );
    await page.close();
  });

  it('annotates the same word on another site', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/page1`);
    await addTerm(page, 'inference', '推理');
    await page.close();

    const other = await context.newPage();
    await other.goto(`${altOrigin}/page2`);
    await waitForText(other.locator('#text'), 'We rely on inference（推理） here.');
    await other.close();
  });

  it('annotates dynamically inserted content', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/page2`);
    await waitForText(page.locator('#text'), 'We rely on inference（推理） here.');

    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'late';
      paragraph.textContent = 'Speculative decoding again.';
      document.body.appendChild(paragraph);
    });
    await waitForText(page.locator('#late'), 'Speculative decoding（投机解码） again.');
    await page.close();
  });

  it('lists, searches, edits and deletes entries from the popup', async () => {
    const content = await context.newPage();
    await content.goto(`${origin}/page1`);
    await waitForText(
      content.locator('#text'),
      'Speculative decoding（投机解码） improves inference（推理） throughput.',
    );

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await waitForText(popup.locator('#count'), '2 entries');
    await waitForCount(popup.locator('.row'), 2);

    // Search by Chinese meaning.
    await popup.locator('#search').fill('推理');
    await waitForCount(popup.locator('.row'), 1);
    await waitForText(popup.locator('.row .term'), 'inference');
    await popup.locator('#search').fill('');
    await waitForCount(popup.locator('.row'), 2);

    // Edit the meaning: the open page must update without a reload.
    const phraseRow = popup.locator('.row', { hasText: 'Speculative decoding' });
    await phraseRow.locator('.translation').fill('推测解码');
    await phraseRow.locator('.translation').press('Tab');
    await waitForText(popup.locator('#status'), 'Updated "Speculative decoding".');
    await waitForText(
      content.locator('#text'),
      'Speculative decoding（推测解码） improves inference（推理） throughput.',
    );

    // Delete: the annotation disappears from the open page.
    await phraseRow.locator('.delete').click();
    await waitForText(popup.locator('#count'), '1 entry');
    await waitForText(
      content.locator('#text'),
      'Speculative decoding improves inference（推理） throughput.',
    );

    await popup.close();
    await content.close();
  });

  it('survives a reload with the remaining entry and never duplicates annotations', async () => {
    const page = await context.newPage();
    await page.goto(`${origin}/page1`);
    await waitForText(
      page.locator('#text'),
      'Speculative decoding improves inference（推理） throughput.',
    );
    await page.evaluate(() => {
      document.getElementById('text')?.append(' inference inference');
    });
    await waitForCount(page.locator('#text .wordlens-annotation'), 3);
    await waitForText(page.locator('#more'), 'Inference（推理） also matters here.');
    await page.close();
  });
});
