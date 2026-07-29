import { sanitizeRichTextHtml } from '../../../src/shared/utils/validation';

describe('sanitizeRichTextHtml', () => {
  test('preserves plain text and supported formatting tags unchanged', () => {
    const html = '<p><strong>Bold</strong> <em>Italic</em> <u>Underline</u></p>';
    expect(sanitizeRichTextHtml(html)).toBe(html);
  });

  test('preserves bullet and numbered lists', () => {
    const html = '<ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol>';
    expect(sanitizeRichTextHtml(html)).toBe(html);
  });

  test('preserves line breaks', () => {
    expect(sanitizeRichTextHtml('<p>Line one<br>Line two</p>')).toBe('<p>Line one<br>Line two</p>');
  });

  test('preserves an allowed font-family value on a span', () => {
    const html = '<p><span style="font-family: Georgia, serif">Styled</span></p>';
    expect(sanitizeRichTextHtml(html)).toBe(html);
  });

  test('preserves an allowed font-size value on a span', () => {
    const html = '<p><span style="font-size: 20px">Big</span></p>';
    expect(sanitizeRichTextHtml(html)).toBe(html);
  });

  test('preserves both font-family and font-size together', () => {
    const html = '<p><span style="font-family: Georgia, serif; font-size: 16px">Styled</span></p>';
    const result = sanitizeRichTextHtml(html);
    expect(result).toContain('font-family: Georgia, serif');
    expect(result).toContain('font-size: 16px');
  });

  test('strips an unsupported font-size value not in the editor\'s toolbar list', () => {
    const html = '<p><span style="font-size: 999px">Huge</span></p>';
    expect(sanitizeRichTextHtml(html)).toBe('<p><span>Huge</span></p>');
  });

  test('strips an unsupported font-family value not in the editor\'s toolbar list', () => {
    const html = '<p><span style="font-family: Wingdings">Weird</span></p>';
    expect(sanitizeRichTextHtml(html)).toBe('<p><span>Weird</span></p>');
  });

  test('strips position/z-index/dimension properties used for UI overlay attacks', () => {
    const html = '<p><span style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 99999; background: white;">Overlay</span></p>';
    expect(sanitizeRichTextHtml(html)).toBe('<p><span>Overlay</span></p>');
  });

  test('strips a background-image url(...) used for tracking/exfiltration', () => {
    const html = '<p><span style="background-image: url(https://evil.test/track.png)">Text</span></p>';
    expect(sanitizeRichTextHtml(html)).toBe('<p><span>Text</span></p>');
  });

  test('drops the entire style attribute when every declaration is unsupported', () => {
    const html = '<span style="color: red; cursor: pointer;">Text</span>';
    expect(sanitizeRichTextHtml(html)).toBe('<span>Text</span>');
  });

  test('keeps only the supported declaration when mixed with unsupported ones', () => {
    const html = '<span style="color: red; font-size: 14px; cursor: pointer;">Text</span>';
    expect(sanitizeRichTextHtml(html)).toBe('<span style="font-size: 14px">Text</span>');
  });

  test('strips tags outside the editor\'s tag set but keeps their text content', () => {
    expect(sanitizeRichTextHtml('<div>Hello</div>')).toBe('Hello');
    expect(sanitizeRichTextHtml('<img src=x onerror=alert(1)>Hi')).toBe('Hi');
    expect(sanitizeRichTextHtml('<a href="javascript:alert(1)">click</a>')).toBe('click');
  });

  test('removes style attributes from tags other than span too (defense in depth)', () => {
    const html = '<p style="position: fixed; top: 0;">Text</p>';
    expect(sanitizeRichTextHtml(html)).toBe('<p>Text</p>');
  });

  test('is idempotent — sanitizing already-sanitized output is a no-op', () => {
    const html = '<p><span style="font-family: Georgia, serif">Styled</span></p>';
    const once  = sanitizeRichTextHtml(html);
    const twice = sanitizeRichTextHtml(once);
    expect(twice).toBe(once);
  });

  test('handles empty and plain-text (non-HTML) input without throwing', () => {
    expect(sanitizeRichTextHtml('')).toBe('');
    expect(sanitizeRichTextHtml('just plain text')).toBe('just plain text');
  });
});
