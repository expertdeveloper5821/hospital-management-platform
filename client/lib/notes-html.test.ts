import { sanitizeNotesHtml, notesToDisplayHtml } from './notes-html';

describe('sanitizeNotesHtml', () => {
  test('preserves supported formatting: bold, italic, underline, lists', () => {
    const html = '<p><strong>Bold</strong> <em>Italic</em> <u>Underline</u></p><ul><li>Item</li></ul>';
    expect(sanitizeNotesHtml(html)).toBe(html);
  });

  test('preserves an allowed font-family value', () => {
    const html = '<p><span style="font-family: Georgia, serif">Styled</span></p>';
    expect(sanitizeNotesHtml(html)).toBe(html);
  });

  test('preserves an allowed font-size value', () => {
    const html = '<p><span style="font-size: 20px">Big</span></p>';
    expect(sanitizeNotesHtml(html)).toBe(html);
  });

  test('strips a font-size value the toolbar does not offer', () => {
    const html = '<p><span style="font-size: 999px">Huge</span></p>';
    const result = sanitizeNotesHtml(html);
    expect(result).not.toContain('999px');
    expect(result).toContain('Huge');
  });

  test('strips position/z-index/dimension CSS used to overlay or reposition content', () => {
    const html = '<p><span style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 99999;">Overlay</span></p>';
    const result = sanitizeNotesHtml(html);
    expect(result).not.toContain('position');
    expect(result).not.toContain('z-index');
    expect(result).not.toContain('100vw');
    expect(result).toContain('Overlay');
  });

  test('strips a background-image url(...) that could be used to exfiltrate data', () => {
    const html = '<p><span style="background-image: url(https://evil.test/track.png)">Text</span></p>';
    const result = sanitizeNotesHtml(html);
    expect(result).not.toContain('url(');
    expect(result).not.toContain('evil.test');
  });

  test('drops the style attribute entirely when nothing in it is supported', () => {
    const html = '<span style="color: red; cursor: pointer;">Text</span>';
    const result = sanitizeNotesHtml(html);
    expect(result).toBe('<span>Text</span>');
  });

  test('keeps only the supported declaration out of a mixed style value', () => {
    const html = '<span style="color: red; font-size: 14px; cursor: pointer;">Text</span>';
    const result = sanitizeNotesHtml(html);
    expect(result).toBe('<span style="font-size: 14px">Text</span>');
  });

  test('strips tags outside the editor\'s tag set (e.g. script) but this is not treated as a JS-execution concern here', () => {
    const result = sanitizeNotesHtml('<img src=x onerror=alert(1)>Hello');
    expect(result).not.toContain('onerror');
    expect(result).toContain('Hello');
  });
});

describe('notesToDisplayHtml', () => {
  test('legacy plain text with no markup is escaped and line breaks preserved', () => {
    expect(notesToDisplayHtml('Line one\nLine two')).toBe('Line one<br>Line two');
  });

  test('rich-text HTML with unsafe CSS is sanitized before display', () => {
    const raw = '<p><span style="position: fixed; font-size: 16px;">Note</span></p>';
    const result = notesToDisplayHtml(raw);
    expect(result).not.toContain('position');
    expect(result).toContain('font-size: 16px');
  });

  test('null/undefined/empty input returns empty string', () => {
    expect(notesToDisplayHtml(null)).toBe('');
    expect(notesToDisplayHtml(undefined)).toBe('');
    expect(notesToDisplayHtml('')).toBe('');
  });
});
