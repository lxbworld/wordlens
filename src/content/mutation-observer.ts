import { isWordLensNode } from './dom-scanner';

export type NodeBatchHandler = (nodes: Node[]) => void;

/**
 * Watches the page, ignores the extension's own insertions, and coalesces a burst
 * of mutations into one batch (one animation frame, or a short timeout fallback).
 */
export class DomWatcher {
  private observer: MutationObserver | null = null;
  private queue = new Set<Node>();
  private scheduled = false;

  constructor(
    private readonly doc: Document,
    private readonly onBatch: NodeBatchHandler,
  ) {}

  start(): void {
    if (this.observer || !this.doc.documentElement) return;
    this.observer = new MutationObserver((records) => this.collect(records));
    this.observer.observe(this.doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.queue.clear();
    this.scheduled = false;
  }

  private collect(records: MutationRecord[]): void {
    for (const record of records) {
      if (record.type === 'characterData') {
        if (record.target.nodeType === Node.TEXT_NODE && !isWordLensNode(record.target)) {
          this.queue.add(record.target);
        }
        continue;
      }
      for (const node of record.addedNodes) {
        if (!isWordLensNode(node)) this.queue.add(node);
      }
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled || this.queue.size === 0) return;
    this.scheduled = true;
    const flush = () => {
      this.scheduled = false;
      const batch = [...this.queue];
      this.queue.clear();
      const connected = batch.filter((node) => node.isConnected);
      if (connected.length > 0) this.onBatch(connected);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  }
}
