import { beforeEach, describe, expect, it } from 'vitest';
import { RegexDictionaryMatcher } from '../src/core/dictionary-matcher';
import type { DictionaryEntry } from '../src/core/types';
import { AnnotationEngine } from '../src/content/annotation-engine';
import { injectAnnotationStyles } from '../src/content/annotation-renderer';

function entry(term: string, translation: string): DictionaryEntry {
  return {
    id: term,
    term,
    translation,
    normalizedTerm: term.toLowerCase(),
    createdAt: 0,
    updatedAt: 0,
  };
}

const dictionary = [
  entry('art', '艺术'),
  entry('inference', '推理'),
  entry('speculative decoding', '投机解码'),
];

let matcher: RegexDictionaryMatcher;
let engine: AnnotationEngine;

function setup(html: string): void {
  document.head.innerHTML = '';
  document.body.innerHTML = html;
  matcher = new RegexDictionaryMatcher();
  matcher.setDictionary(dictionary);
  engine = new AnnotationEngine(document, matcher);
  engine.start();
}

/** MutationObserver + requestAnimationFrame batching is async. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40));
}

beforeEach(() => {
  engine?.stop();
  document.body.innerHTML = '';
});

describe('static pages', () => {
  it('appends the gloss right after the word and keeps the original text', () => {
    setup('<p id="p">Art matters.</p>');
    const paragraph = document.getElementById('p')!;
    expect(paragraph.textContent).toBe('Art（艺术） matters.');
    const annotation = paragraph.querySelector('.wordlens-annotation');
    expect(annotation?.getAttribute('data-wordlens-annotation')).toBe('true');
    expect(annotation?.textContent).toBe('（艺术）');
    expect(paragraph.firstChild?.textContent).toBe('Art');
  });

  it('annotates phrases and leaves the rest of the sentence untouched', () => {
    setup('<p id="p">The model uses speculative decoding to improve inference throughput.</p>');
    expect(document.getElementById('p')!.textContent).toBe(
      'The model uses speculative decoding（投机解码） to improve inference（推理） throughput.',
    );
  });

  it('keeps links and their attributes intact', () => {
    setup('<p><a id="link" href="https://example.com" title="t">art</a> and more</p>');
    const link = document.getElementById('link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.textContent).toBe('art（艺术）');
    expect(link.querySelector('.wordlens-annotation')).not.toBeNull();
  });

  it('works through nested inline markup', () => {
    setup('<div><p><em><strong>art</strong></em></p></div>');
    expect(document.querySelector('strong')?.textContent).toBe('art（艺术）');
    expect(document.querySelectorAll('.wordlens-annotation')).toHaveLength(1);
  });

  it('skips code, pre, inputs, textareas and contenteditable', () => {
    setup(`
      <pre>art</pre>
      <code>art</code>
      <input value="art">
      <textarea>art</textarea>
      <div contenteditable="true">art</div>
      <p>art</p>
    `);
    expect(document.querySelectorAll('.wordlens-annotation')).toHaveLength(1);
    expect(document.querySelector('p .wordlens-annotation')).not.toBeNull();
    expect(document.querySelector('pre')?.textContent).toBe('art');
    expect(document.querySelector('[contenteditable]')?.textContent).toBe('art');
  });

  it('does not annotate its own annotations', () => {
    setup('<p id="p">art</p>');
    engine.scan(document.body);
    engine.scan(document.body);
    expect(document.querySelectorAll('.wordlens-annotation')).toHaveLength(1);
    expect(document.getElementById('p')!.textContent).toBe('art（艺术）');
  });

  it('never nests an annotation inside another one', () => {
    setup('<p>art</p>');
    expect(document.querySelectorAll('.wordlens-annotation .wordlens-annotation')).toHaveLength(0);
  });

  it('ignores text in its own UI host', () => {
    setup('<div id="wordlens-ui-root">art</div><p>art</p>');
    expect(document.querySelectorAll('.wordlens-annotation')).toHaveLength(1);
  });
});

describe('dynamic pages', () => {
  it('annotates content inserted after load', async () => {
    setup('<div id="root"></div>');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'inference is cheap';
    document.getElementById('root')!.appendChild(paragraph);

    await settle();
    expect(paragraph.textContent).toBe('inference（推理） is cheap');
  });

  it('annotates text nodes created by a SPA style re-render', async () => {
    setup('<div id="app">nothing yet</div>');
    const app = document.getElementById('app')!;
    app.textContent = '';
    const span = document.createElement('span');
    span.textContent = 'speculative decoding works';
    app.appendChild(span);

    await settle();
    expect(app.textContent).toBe('speculative decoding（投机解码） works');
  });

  it('does not thrash when its own mutations fire the observer', async () => {
    setup('<div id="root"></div>');
    const root = document.getElementById('root')!;
    for (let i = 0; i < 5; i += 1) {
      const paragraph = document.createElement('p');
      paragraph.textContent = 'art';
      root.appendChild(paragraph);
    }
    await settle();
    await settle();
    expect(document.querySelectorAll('.wordlens-annotation')).toHaveLength(5);
  });
});

describe('dictionary changes', () => {
  it('refresh adds glosses for newly added terms', () => {
    setup('<p id="p">inference and quantization</p>');
    expect(document.getElementById('p')!.textContent).toBe('inference（推理） and quantization');

    matcher.setDictionary([...dictionary, entry('quantization', '量化')]);
    engine.refresh();
    expect(document.getElementById('p')!.textContent).toBe(
      'inference（推理） and quantization（量化）',
    );
  });

  it('refresh removes glosses for deleted terms', () => {
    setup('<p id="p">inference and art</p>');
    matcher.setDictionary([entry('inference', '推理')]);
    engine.refresh();
    expect(document.getElementById('p')!.textContent).toBe('inference（推理） and art');
    expect(document.querySelectorAll('.wordlens-annotation')).toHaveLength(1);
  });

  it('refresh shows the edited translation', () => {
    setup('<p id="p">art</p>');
    matcher.setDictionary([entry('art', '美术')]);
    engine.refresh();
    expect(document.getElementById('p')!.textContent).toBe('art（美术）');
  });
});

describe('styles', () => {
  it('injects the annotation stylesheet once', () => {
    setup('<p>art</p>');
    injectAnnotationStyles(document, '.wordlens-annotation{color:#888}');
    injectAnnotationStyles(document, '.wordlens-annotation{color:#888}');
    expect(document.querySelectorAll('#wordlens-annotation-style')).toHaveLength(1);
  });
});
