import { buildIndex, lookup, normText, parseExportHtml, StyleLearner } from '../src/hook/styles';

describe('export html parsing', () => {
  it('extracts styled paragraphs and decodes entities', () => {
    const html = '<html><head><style>h1{x:y}</style></head><body class="doc">' +
      '<p class="title c3"><span class="c1">Fabulous &amp; Features</span></p>' +
      '<h1 class="c5" id="h.x"><span>&#129492; Presenter</span></h1>' +
      '<ul><li class="c2"><span>Eric&nbsp;Curts</span></li></ul></body></html>';
    expect(parseExportHtml(html)).toEqual([
      { tag: 'p', className: 'title c3', text: 'Fabulous & Features' },
      { tag: 'h1', className: 'c5', text: '🧔 Presenter' },
      { tag: 'li', className: 'c2', text: 'Eric Curts' },
    ]);
  });
});

const index = buildIndex([
  { tag: 'P', className: 'title c3', text: 'Fabulous Features of Google Docs' },
  { tag: 'H1', className: 'c5', text: '🧔 Presenter' },
  { tag: 'H2', className: '', text: 'General Resources' },
  { tag: 'P', className: 'c1', text: 'Technology Integration Specialist, Google Certified Trainer and Innovator' },
  { tag: 'LI', className: 'c2', text: 'Eric Curts' },
]);

describe('paragraph style recognition', () => {
  it('strips the bidi controls Docs wraps canvas runs in', () => {
    expect(normText('‭🧔 Presenter‬')).toBe('🧔 Presenter');
  });

  it('looks up whole paragraphs and long prefixes', () => {
    expect(lookup(index, '‭Fabulous Features of Google Docs‬')).toBe('title');
    expect(lookup(index, '‭Technology Integration Specialist, Goog')).toBe('normal');
    expect(lookup(index, 'Unknown text')).toBeNull();
  });

  it('learns font → style and applies it to unmatched runs in that font', () => {
    const l = new StyleLearner(index);
    expect(l.classify('300 32px docs-Lexend', 'Fabulous Features of Google Docs')).toBe('title');
    expect(l.classify('300 32px docs-Lexend', 'wrapped second line')).toBe('title');
    expect(l.classify('300 24px docs-Lexend', '🧔 Presenter')).toBe('h1');
    expect(l.classify('300 16px docs-Lexend', 'Technology Integration Specialist, Google Certified Trainer and Innovator')).toBeNull();
    expect(l.classify('300 16px docs-Lexend', 'anything')).toBeNull();
  });

  it('enlarged plain text gets heading colors by size', () => {
    let changes = 0;
    const l = new StyleLearner(index, () => changes++);
    expect(l.classify('300 34px docs-Lexend', 'Big unstyled banner')).toBeNull(); // body size unknown yet
    for (let i = 0; i < 60; i++) l.classify('300 16px docs-Lexend', 'Technology Integration Specialist, Google Certified Trainer and Innovator');
    expect(changes).toBeGreaterThan(0); // asks for a repaint once the body size is known
    expect(l.classify('300 34px docs-Lexend', 'Big unstyled banner')).toBe('title');
    expect(l.classify('300 20px docs-Lexend', 'Medium unstyled line')).toBe('h2');
    expect(l.classify('300 17px docs-Lexend', 'Barely larger')).toBeNull();
  });

  it('a font used mostly by body text is not a heading', () => {
    const l = new StyleLearner(index);
    l.classify('500 16px docs-Lexend', 'General Resources'); // h2 vote (17 chars)
    for (let i = 0; i < 3; i++) l.classify('500 16px docs-Lexend', 'Technology Integration Specialist, Google Certified Trainer and Innovator');
    expect(l.classify('500 16px docs-Lexend', 'x')).toBeNull();
  });
});
