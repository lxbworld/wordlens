import type { DictionaryMatcher } from '../core/dictionary-matcher';
import { annotateTextNode, removeAnnotations } from './annotation-renderer';
import { collectTextNodes } from './dom-scanner';
import { DomWatcher } from './mutation-observer';

/**
 * Owns annotation lifecycle: first scan, incremental scan of new content,
 * and a full refresh after the dictionary changes.
 */
export class AnnotationEngine {
  private processed = new WeakSet<Text>();
  private watcher: DomWatcher;
  private started = false;

  constructor(
    private readonly doc: Document,
    private readonly matcher: DictionaryMatcher,
  ) {
    this.watcher = new DomWatcher(doc, (nodes) => {
      for (const node of nodes) this.scan(node);
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.doc.body) this.scan(this.doc.body);
    this.watcher.start();
  }

  scan(root: Node): void {
    // Snapshot first: annotating detaches the text node being walked.
    for (const node of collectTextNodes(root)) this.annotate(node);
  }

  /** Drop every annotation, then annotate the page again with the current dictionary. */
  refresh(): void {
    removeAnnotations(this.doc);
    this.processed = new WeakSet();
    if (this.doc.body) this.scan(this.doc.body);
  }

  stop(): void {
    this.started = false;
    this.watcher.stop();
  }

  private annotate(node: Text): void {
    if (this.processed.has(node) || !node.isConnected || !node.data) return;
    this.processed.add(node);
    if (node.data.trim() === '') return;

    const matches = this.matcher.match(node.data);
    if (matches.length === 0) return;
    annotateTextNode(node, matches, (created) => this.processed.add(created));
  }
}
