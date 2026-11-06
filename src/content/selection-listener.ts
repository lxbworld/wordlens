import { isEditableNode, validateTerm } from '../core/validation';

export interface SelectionHit {
  term: string;
  rect: DOMRect;
}

export interface SelectionHandlers {
  onSelect(hit: SelectionHit): void;
  onClear(): void;
}

/** Watches mouse/keyboard selections and reports a usable English term plus its on-screen rect. */
export class SelectionManager {
  private started = false;

  constructor(
    private readonly doc: Document,
    private readonly handlers: SelectionHandlers,
    private readonly isUiTarget: (target: EventTarget | null) => boolean,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.doc.addEventListener('mouseup', this.onPointerUp);
    this.doc.addEventListener('keyup', this.onKeyUp);
    this.doc.addEventListener('selectionchange', this.onSelectionChange);
    this.doc.addEventListener('mousedown', this.onMouseDown, true);
    this.doc.addEventListener('keydown', this.onKeyDown, true);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.doc.removeEventListener('mouseup', this.onPointerUp);
    this.doc.removeEventListener('keyup', this.onKeyUp);
    this.doc.removeEventListener('selectionchange', this.onSelectionChange);
    this.doc.removeEventListener('mousedown', this.onMouseDown, true);
    this.doc.removeEventListener('keydown', this.onKeyDown, true);
  }

  getSelectedText(): string | null {
    const selection = this.doc.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    if (isEditableNode(selection.anchorNode) || isEditableNode(selection.focusNode)) return null;
    const check = validateTerm(selection.toString());
    return check.ok ? check.term : null;
  }

  private readonly onPointerUp = (): void => {
    // Let the browser finish updating the selection before reading it.
    setTimeout(() => this.report(), 0);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key.startsWith('Arrow') || event.key === 'Shift') setTimeout(() => this.report(), 0);
  };

  private readonly onSelectionChange = (): void => {
    const selection = this.doc.getSelection();
    if (!selection || selection.isCollapsed) this.handlers.onClear();
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.isUiTarget(event.target)) this.handlers.onClear();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.handlers.onClear();
  };

  private report(): void {
    if (!this.isUiTarget(this.doc.activeElement)) {
      const selection = this.doc.getSelection();
      const text = this.getSelectedText();
      if (selection && text && selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          this.handlers.onSelect({ term: text, rect });
          return;
        }
      }
    }
    this.handlers.onClear();
  }
}
