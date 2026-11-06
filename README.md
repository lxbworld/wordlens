# WordLens

A small Chrome extension that appends **your own** Chinese glosses to English words on any page.

You pick the words. You write the meaning. WordLens then annotates every page you visit — locally, with no server, no translation API and no AI.

```
Speculative decoding improves inference throughput.
        ↓ after you add "speculative decoding" → 投机解码 and "inference" → 推理
Speculative decoding（投机解码） improves inference（推理） throughput.
```

![Annotated article](docs/screenshot-annotation.png)

| Select a term | Write the meaning | Manage the dictionary |
| --- | --- | --- |
| ![Selection toolbar](docs/screenshot-toolbar.png) | ![Translation editor](docs/screenshot-editor.png) | ![Popup](docs/screenshot-popup.png) |

## Install

```bash
npm install
npm run build
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. **Load unpacked** → pick the `dist/` folder.

(Chrome only shows the popup icon pinned to the toolbar after you pin the extension.)

## Use it

1. Select an English word or phrase on a page (drag with the mouse, or shift + arrows).
2. Click **+ 添加到 WordLens** next to the selection.
3. Type the Chinese meaning, click **Save**.
4. The page is annotated immediately, and so is every other page with that word.

Click the toolbar icon to search, edit or delete entries. Edits and deletions apply to pages that are already open.

## Development

```bash
npm run dev        # rebuild both bundles on change (reload the extension afterwards)
npm run build      # dist/ ready for "Load unpacked"
npm run typecheck  # tsc --noEmit
npm test           # unit tests (vitest + jsdom)
npm run test:e2e   # real Chromium: select → save → annotate → reload → other site → edit → delete
npm run screenshots
```

`npm run test:e2e` needs a Chromium that accepts `--load-extension`:

- `npx playwright install chromium` (recommended), or
- point at any Chromium/Chrome-for-Testing binary with `WORDLENS_CHROME_PATH=/path/to/chrome`.

Google Chrome stable now refuses `--load-extension` for branded builds, so the
suite skips it and uses a bundled Chromium instead.

## How it works

- **Storage** — one `chrome.storage.local` document (`wordlens.dictionary`, `version: 1`) behind
  `DictionaryRepository`: `getAll` / `findByTerm` / `add` / `update` / `delete` / `subscribe`.
- **Matching** — every term is compiled into one alternation regex, longest term first, wrapped in
  word-boundary lookarounds. Left-to-right scanning therefore gives longest-match-wins,
  case-insensitive, non-overlapping hits in a single pass, with UTF-16 indices that map straight
  onto `Text.data.slice`.
- **Annotation** — a `TreeWalker` collects text nodes (skipping `script`, `style`, `code`, `pre`,
  `input`, `textarea`, form controls, SVG, canvas, `contenteditable` and WordLens' own nodes), then
  each matching text node is split with a `DocumentFragment` into
  `text + <span class="wordlens-annotation">（译文）</span> + text`. `innerHTML` is never used, the
  English original stays a plain text node, and links/selectors/listeners keep working.
- **Dynamic pages** — a `MutationObserver` batches new nodes into one animation frame and skips
  WordLens' own insertions, so SPA re-renders and infinite scroll get annotated without rescanning
  the page.
- **UI** — the toolbar and editor live in a shadow root, so page CSS cannot reach them; the popup is
  plain HTML/CSS/TypeScript.

## Layout

```
public/            manifest.json + icons (copied into dist/)
src/core/          types, normalizer, validation, repository, matcher
src/content/       scanner, renderer, annotation engine, selection toolbar, mutation observer
src/popup/         dictionary UI
src/styles/        annotation.css
tests/             unit tests + tests/e2e (real Chromium)
scripts/           screenshot generator for the README
```

## Known limitations

- **No lemmatisation.** A dictionary entry is matched literally: `model` does not match `models`.
- **One text node per match.** A phrase split by markup (`<span>speculative</span> <b>decoding</b>`)
  is not matched yet. Single nodes and nested inline markup are.
- **Latin terms only.** English letters, digits and the punctuation that occurs inside terms
  (hyphen, apostrophe, dot, slash, plus, `#`, `&`, `:`); Chinese-only selections are rejected.
- **Heuristic boundaries, no NLP.** Hyphens and apostrophes count as word characters, so `art` does
  not match `art-house` or `art's`.
- **Flat regex matcher.** Fine for a hand-curated dictionary of hundreds of terms; a trie would be
  the next step for thousands.
- **Local only.** No sync between browsers, and clearing extension data clears the dictionary.
- Deliberately **not** included (yet): built-in dictionaries, auto-translation, LLM calls, word-form
  recognition, FSRS/Anki, TTS, cloud sync, accounts.

## License

MIT — see [LICENSE](LICENSE).
