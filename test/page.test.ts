import { describe, expect, it } from 'vitest';
import { ALL_APPS, isHomePage, pageKey, scopeName, suiteKey, suiteOfPageKey } from '../src/shared/page';

const DOC = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit';

describe('suiteKey', () => {
  it.each([
    [DOC, 'docs'],
    ['https://docs.google.com/document/u/0/', 'docs'],
    ['https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0', 'sheets'],
    ['https://docs.google.com/presentation/', 'slides'],
    ['https://docs.google.com/forms/d/e/1FAIpQLSdAbCdEfGh/viewform', 'forms'],
    ['https://docs.google.com/drawings/d/1AbCdEfGhIjKlMnOp/edit', 'drawings'],
    ['https://drive.google.com/drive/my-drive', 'drive'],
    ['https://docs.google.com/', 'docs.google.com'],
  ])('%s → %s', (url, key) => expect(suiteKey(url)).toBe(key));
});

describe('pageKey', () => {
  it.each([
    [DOC, 'document:1AbCdEfGhIjKlMnOp'],
    ['https://docs.google.com/document/u/1/d/1AbCdEfGhIjKlMnOp/edit', 'document:1AbCdEfGhIjKlMnOp'],
    ['https://docs.google.com/forms/d/e/1FAIpQLSdAbCdEfGh/viewform', 'forms:1FAIpQLSdAbCdEfGh'],
    ['https://docs.google.com/document/u/0/', 'document:home'],
    ['https://drive.google.com/drive/u/0/folders/abc', 'drive'],
    ['https://docs.google.com/', 'docs.google.com'],
  ])('%s → %s', (url, key) => expect(pageKey(url)).toBe(key));

  it('maps back to its suite', () => {
    expect(suiteOfPageKey('document:1AbCdEfGhIjKlMnOp')).toBe('docs');
    expect(suiteOfPageKey('spreadsheets:home')).toBe('sheets');
    expect(suiteOfPageKey('presentation:x')).toBe('slides');
    expect(suiteOfPageKey('drive')).toBe('drive');
    expect(suiteOfPageKey('docs.google.com')).toBe('docs.google.com');
  });
});

describe('isHomePage', () => {
  it.each([
    'https://docs.google.com/document/u/0/',
    'https://docs.google.com/document/',
    'https://docs.google.com/spreadsheets/u/0/?tgif=d',
    'https://docs.google.com/presentation/',
    'https://docs.google.com/forms/u/0/',
    'https://docs.google.com/drawings/u/0/',
  ])('home: %s', (url) => expect(isHomePage(url)).toBe(true));

  it.each([
    DOC,
    'https://docs.google.com/document/u/0/d/1AbCdEfGhIjKlMnOp/edit',
    'https://docs.google.com/forms/d/e/1FAIpQLSdAbCdEfGh/viewform',
    'https://drive.google.com/drive/my-drive',
    'https://docs.google.com/',
  ])('not home: %s', (url) => expect(isHomePage(url)).toBe(false));
});

describe('scopeName', () => {
  it('names the scope', () => {
    expect(scopeName(ALL_APPS)).toBe('All Google apps');
    expect(scopeName('sheets')).toBe('All of Sheets');
  });
});
