/**
 * @jest-environment node
 */
import { sanitizeNotesHtml, notesToDisplayHtml } from './notes-html';

describe('notes-html in a server (non-DOM) environment', () => {
  test('importing and calling the sanitizer does not throw without a window', () => {
    expect(() => sanitizeNotesHtml('<p>Hello</p>')).not.toThrow();
  });

  test('strips all markup (no DOM available to sanitize with) but keeps text', () => {
    const result = sanitizeNotesHtml('<p><span style="font-size: 20px">Big</span></p>');
    expect(result).toBe('Big');
  });

  test('notesToDisplayHtml still works end-to-end without a window', () => {
    expect(() => notesToDisplayHtml('Line one\nLine two')).not.toThrow();
    expect(notesToDisplayHtml(null)).toBe('');
  });
});
