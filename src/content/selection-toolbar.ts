import { UI_HOST_ID } from '../shared/constants';
import { validateTranslation } from '../core/validation';

const SHADOW_STYLE = `
:host { all: initial; }
[hidden] { display: none !important; }
.wordlens-toolbar {
  all: initial;
  position: fixed;
  z-index: 2147483647;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 1px solid rgba(79, 70, 229, 0.35);
  border-radius: 6px;
  background: #ffffff;
  color: #1f2937;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  font-size: 13px;
  line-height: 1.2;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.18);
  cursor: pointer;
  user-select: none;
}
.wordlens-toolbar:hover { background: #eef2ff; }
.wordlens-editor {
  all: initial;
  position: fixed;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 260px;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.22);
}
.wordlens-editor label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #6b7280; }
.wordlens-editor input {
  all: initial;
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  color: #111827;
  font-family: inherit;
  font-size: 13px;
  background: #ffffff;
}
.wordlens-editor input:focus { border-color: #6366f1; outline: none; }
.wordlens-editor input[readonly] { background: #f9fafb; color: #4b5563; }
.wordlens-editor .actions { display: flex; gap: 8px; justify-content: flex-end; }
.wordlens-editor button {
  all: initial;
  display: inline-block;
  padding: 6px 12px;
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.wordlens-editor .save { background: #4f46e5; color: #ffffff; }
.wordlens-editor .save:disabled { opacity: 0.6; cursor: default; }
.wordlens-editor .cancel { background: #f3f4f6; color: #374151; }
.wordlens-status { all: initial; display: block; min-height: 14px; font-size: 11px; color: #b45309; font-family: inherit; }
`;

const SHADOW_HTML = `
<style>${SHADOW_STYLE}</style>
<button class="wordlens-toolbar" type="button" hidden>+ 添加到 WordLens</button>
<form class="wordlens-editor" hidden>
  <label>English<input class="english" readonly aria-label="English term"></label>
  <label>Chinese<input class="chinese" maxlength="200" placeholder="中文释义" aria-label="Chinese meaning"></label>
  <p class="wordlens-status" role="status"></p>
  <div class="actions">
    <button class="cancel" type="button">Cancel</button>
    <button class="save" type="submit">Save</button>
  </div>
</form>
`;

/** Selection toolbar + translation editor, isolated in a shadow root so no page CSS leaks in. */
export class SelectionToolbar {
  readonly host: HTMLElement;
  onSave: ((term: string, translation: string) => Promise<void>) | null = null;
  onOpen: ((term: string) => Promise<string | null>) | null = null;

  private readonly toolbar: HTMLButtonElement;
  private readonly editor: HTMLFormElement;
  private readonly englishInput: HTMLInputElement;
  private readonly chineseInput: HTMLInputElement;
  private readonly statusEl: HTMLParagraphElement;
  private readonly saveButton: HTMLButtonElement;
  private term = '';
  private saving = false;

  constructor(doc: Document) {
    this.host = doc.createElement('div');
    this.host.id = UI_HOST_ID;
    this.host.style.cssText =
      'position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible; z-index: 2147483647;';

    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = SHADOW_HTML;

    const find = <T extends Element>(selector: string): T => {
      const element = shadow.querySelector<T>(selector);
      if (!element) throw new Error(`WordLens UI is missing ${selector}`);
      return element;
    };

    this.toolbar = find<HTMLButtonElement>('.wordlens-toolbar');
    this.editor = find<HTMLFormElement>('.wordlens-editor');
    this.englishInput = find<HTMLInputElement>('.english');
    this.chineseInput = find<HTMLInputElement>('.chinese');
    this.statusEl = find<HTMLParagraphElement>('.wordlens-status');
    this.saveButton = find<HTMLButtonElement>('.save');

    // Keep the page selection alive while the user clicks our own controls.
    this.host.addEventListener('mousedown', (event) => {
      const target = event.composedPath()[0] as HTMLElement | undefined;
      if (target && target.tagName === 'INPUT') return;
      event.preventDefault();
    });

    this.toolbar.addEventListener('click', () => this.openEditor());
    this.editor.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    find<HTMLButtonElement>('.cancel').addEventListener('click', () => this.close());
    this.editor.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    });
  }

  isUiTarget(target: EventTarget | null): boolean {
    return target instanceof Node && (target === this.host || this.host.contains(target));
  }

  showToolbar(term: string, rect: DOMRect): void {
    this.term = term;
    this.toolbar.hidden = false;
    const view = this.host.ownerDocument.defaultView;
    const viewWidth = view?.innerWidth ?? 1024;
    const viewHeight = view?.innerHeight ?? 768;
    const width = 160;
    const height = 32;
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewWidth - width - 8));
    let top = rect.bottom + 8;
    if (top + height > viewHeight - 8) top = Math.max(8, rect.top - height - 8);
    this.toolbar.style.left = `${left}px`;
    this.toolbar.style.top = `${top}px`;
  }

  hideToolbar(): void {
    this.toolbar.hidden = true;
  }

  close(): void {
    this.editor.hidden = true;
    this.toolbar.hidden = true;
    this.term = '';
    this.saving = false;
    this.saveButton.disabled = false;
  }

  private openEditor(): void {
    if (!this.term) return;
    const term = this.term;
    const anchor = this.toolbar.getBoundingClientRect();
    this.toolbar.hidden = true;
    this.editor.hidden = false;
    this.englishInput.value = term;
    this.chineseInput.value = '';
    this.statusEl.textContent = '';

    const view = this.host.ownerDocument.defaultView;
    const viewWidth = view?.innerWidth ?? 1024;
    const viewHeight = view?.innerHeight ?? 768;
    const width = 284;
    const height = 190;
    const left = Math.min(Math.max(8, anchor.left), Math.max(8, viewWidth - width - 8));
    let top = anchor.bottom + 8;
    if (top + height > viewHeight - 8) top = Math.max(8, anchor.top - height - 8);
    this.editor.style.left = `${left}px`;
    this.editor.style.top = `${top}px`;

    this.chineseInput.focus();
    void this.prefillExisting(term);
  }

  private async prefillExisting(term: string): Promise<void> {
    if (!this.onOpen) return;
    try {
      const existing = await this.onOpen(term);
      if (!existing || this.term !== term || this.chineseInput.value !== '') return;
      this.chineseInput.value = existing;
      this.chineseInput.select();
      this.statusEl.textContent = 'Already saved — saving replaces it.';
    } catch {
      /* prefill is a convenience; failing it must not block the editor */
    }
  }

  private async submit(): Promise<void> {
    if (this.saving || !this.onSave) return;
    const check = validateTranslation(this.chineseInput.value);
    if (!check.ok) {
      this.statusEl.textContent = check.error;
      return;
    }
    this.saving = true;
    this.saveButton.disabled = true;
    try {
      await this.onSave(this.term, check.translation);
      this.close();
    } catch (error) {
      this.statusEl.textContent = error instanceof Error ? error.message : 'Could not save.';
    } finally {
      this.saving = false;
      this.saveButton.disabled = false;
    }
  }
}
