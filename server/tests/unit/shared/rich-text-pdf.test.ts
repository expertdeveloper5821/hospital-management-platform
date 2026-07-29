import { parseRichTextToBlocks } from '../../../src/shared/services/rich-text-pdf';

describe('parseRichTextToBlocks', () => {
  test('returns [] for null/undefined/empty input', () => {
    expect(parseRichTextToBlocks(null)).toEqual([]);
    expect(parseRichTextToBlocks(undefined)).toEqual([]);
    expect(parseRichTextToBlocks('')).toEqual([]);
    expect(parseRichTextToBlocks('   ')).toEqual([]);
  });

  test('legacy plain text (no tags) becomes one paragraph per line', () => {
    const blocks = parseRichTextToBlocks('Line one\nLine two');
    expect(blocks).toEqual([
      { kind: 'paragraph', runs: [{ text: 'Line one' }] },
      { kind: 'paragraph', runs: [{ text: 'Line two' }] },
    ]);
  });

  test('legacy plain text decodes HTML entities (was never actually HTML, just literal text)', () => {
    const blocks = parseRichTextToBlocks('Tom &amp; Jerry');
    expect(blocks).toEqual([{ kind: 'paragraph', runs: [{ text: 'Tom & Jerry' }] }]);
  });

  test('a simple paragraph with no formatting', () => {
    const blocks = parseRichTextToBlocks('<p>Hello world</p>');
    expect(blocks).toEqual([{ kind: 'paragraph', runs: [{ text: 'Hello world' }] }]);
  });

  test('bold, italic, and underline marks are captured on the run', () => {
    const blocks = parseRichTextToBlocks('<p><strong>Bold</strong> <em>Italic</em> <u>Underline</u></p>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].runs).toEqual([
      { text: 'Bold', bold: true },
      { text: ' ' },
      { text: 'Italic', italic: true },
      { text: ' ' },
      { text: 'Underline', underline: true },
    ]);
  });

  test('nested marks combine (bold + italic on the same run)', () => {
    const blocks = parseRichTextToBlocks('<p><strong><em>Both</em></strong></p>');
    expect(blocks[0].runs).toEqual([{ text: 'Both', bold: true, italic: true }]);
  });

  test('span font-size and font-family styles are extracted', () => {
    const blocks = parseRichTextToBlocks('<p><span style="font-size: 20px; font-family: Georgia, serif">Big</span></p>');
    expect(blocks[0].runs).toEqual([{ text: 'Big', fontSize: 20, fontFamily: 'serif' }]);
  });

  test('monospace font-family maps to "mono"', () => {
    const blocks = parseRichTextToBlocks('<p><span style="font-family: \'Courier New\', Courier, monospace">Code</span></p>');
    expect(blocks[0].runs[0].fontFamily).toBe('mono');
  });

  test('multiple paragraphs become separate blocks', () => {
    const blocks = parseRichTextToBlocks('<p>First</p><p>Second</p>');
    expect(blocks).toEqual([
      { kind: 'paragraph', runs: [{ text: 'First' }] },
      { kind: 'paragraph', runs: [{ text: 'Second' }] },
    ]);
  });

  test('a bullet list produces list-item blocks with listType "bullet"', () => {
    const blocks = parseRichTextToBlocks('<ul><li>Apple</li><li>Banana</li></ul>');
    expect(blocks).toEqual([
      { kind: 'list-item', listType: 'bullet', index: undefined, runs: [{ text: 'Apple' }] },
      { kind: 'list-item', listType: 'bullet', index: undefined, runs: [{ text: 'Banana' }] },
    ]);
  });

  test('a numbered list assigns 1-based ordinals', () => {
    const blocks = parseRichTextToBlocks('<ol><li>First</li><li>Second</li><li>Third</li></ol>');
    expect(blocks.map((b) => b.index)).toEqual([1, 2, 3]);
    expect(blocks.every((b) => b.listType === 'number')).toBe(true);
  });

  test('formatted text inside a list item preserves marks', () => {
    const blocks = parseRichTextToBlocks('<ul><li><strong>Important</strong> item</li></ul>');
    expect(blocks[0].runs).toEqual([{ text: 'Important', bold: true }, { text: ' item' }]);
  });

  test('a manual line break (<br>) starts a new paragraph block', () => {
    const blocks = parseRichTextToBlocks('<p>Line one<br>Line two</p>');
    expect(blocks).toEqual([
      { kind: 'paragraph', runs: [{ text: 'Line one' }] },
      { kind: 'paragraph', runs: [{ text: 'Line two' }] },
    ]);
  });

  test('HTML entities inside rich HTML are decoded', () => {
    const blocks = parseRichTextToBlocks('<p>Tom &amp; Jerry &lt;3&gt;</p>');
    expect(blocks[0].runs).toEqual([{ text: 'Tom & Jerry <3>' }]);
  });

  test('an unrecognized/foreign tag is stripped but its text content survives', () => {
    const blocks = parseRichTextToBlocks('<p>Before <script>alert(1)</script> after</p>');
    // Tags are ignored (no crash), and any bare text between/around them still renders.
    const allText = blocks.flatMap((b) => b.runs.map((r) => r.text)).join('');
    expect(allText).toContain('Before');
    expect(allText).toContain('after');
    expect(allText).not.toContain('<script>');
  });

  test('mixed content: paragraph followed by a bullet list followed by another paragraph', () => {
    const blocks = parseRichTextToBlocks('<p>Intro</p><ul><li>One</li><li>Two</li></ul><p>Outro</p>');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list-item', 'list-item', 'paragraph']);
    expect(blocks[0].runs[0].text).toBe('Intro');
    expect(blocks[3].runs[0].text).toBe('Outro');
  });
});
