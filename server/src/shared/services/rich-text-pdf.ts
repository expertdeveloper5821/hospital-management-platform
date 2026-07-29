// Renders a Notes-field value (either legacy plain text, or Tiptap-generated
// HTML restricted to <p>/<strong>/<em>/<u>/<ul>/<ol>/<li>/<br>/<span style="...">
// — the same tag set the frontend's rich-text editor emits/sanitizes to) into
// a PDFKit document, preserving bold/italic/underline/font-size/font-family
// and list structure. Parsing is a pure function (independently testable);
// rendering is a separate step that only touches the PDFKit document.

export interface RichTextRun {
  text:       string;
  bold?:      boolean;
  italic?:    boolean;
  underline?: boolean;
  fontSize?:  number;
  fontFamily?: 'serif' | 'mono' | 'sans';
}

export interface RichTextBlock {
  kind:      'paragraph' | 'list-item';
  listType?: 'bullet' | 'number';
  index?:    number; // 1-based ordinal, only for kind:'list-item' + listType:'number'
  runs:      RichTextRun[];
}

type Token =
  | { type: 'text'; value: string }
  | { type: 'tag'; name: string; closing: boolean; attrs: string };

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<(\/?)([a-zA-Z]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[4] !== undefined) tokens.push({ type: 'text', value: m[4] });
    else tokens.push({ type: 'tag', name: m[2].toLowerCase(), closing: m[1] === '/', attrs: m[3] ?? '' });
  }
  return tokens;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

type InlineStyle = Partial<Pick<RichTextRun, 'bold' | 'italic' | 'underline' | 'fontSize' | 'fontFamily'>>;

function extractSpanStyle(attrs: string): InlineStyle {
  const styleMatch = /style\s*=\s*"([^"]*)"/i.exec(attrs);
  if (!styleMatch) return {};
  const style = styleMatch[1];
  const result: InlineStyle = {};

  const sizeMatch = /font-size:\s*([\d.]+)px/i.exec(style);
  if (sizeMatch) result.fontSize = parseFloat(sizeMatch[1]);

  const familyMatch = /font-family:\s*([^;]+)/i.exec(style);
  if (familyMatch) {
    const fam = familyMatch[1].toLowerCase();
    if (fam.includes('mono') || fam.includes('courier')) result.fontFamily = 'mono';
    else if (fam.includes('serif') || fam.includes('times') || fam.includes('georgia')) result.fontFamily = 'serif';
    else result.fontFamily = 'sans';
  }

  return result;
}

// Same detection heuristic as the frontend's notesToDisplayHtml — anything
// not matching one of our editor's own tags is treated as legacy plain text.
const LOOKS_LIKE_HTML = /<\/?(p|ul|ol|li|strong|em|u|span|br)[\s>/]/i;

export function parseRichTextToBlocks(raw: string | null | undefined): RichTextBlock[] {
  if (!raw || !raw.trim()) return [];

  if (!LOOKS_LIKE_HTML.test(raw)) {
    // Legacy plain text: one paragraph block per line, blank lines preserved.
    return raw.split('\n').map((line) => ({
      kind: 'paragraph' as const,
      runs: [{ text: decodeEntities(line) }],
    }));
  }

  const tokens = tokenize(raw);
  const blocks: RichTextBlock[] = [];
  let currentBlock: RichTextBlock | null = null;
  const listStack: Array<'bullet' | 'number'> = [];
  const listCounters: number[] = [];
  const styleStack: InlineStyle[] = [];

  function activeStyle(): InlineStyle {
    return styleStack.reduce((acc, s) => ({ ...acc, ...s }), {} as InlineStyle);
  }

  function ensureBlock(): void {
    if (!currentBlock) currentBlock = { kind: 'paragraph', runs: [] };
  }

  function closeBlock(): void {
    if (currentBlock) blocks.push(currentBlock);
    currentBlock = null;
  }

  for (const tok of tokens) {
    if (tok.type === 'text') {
      if (tok.value === '') continue;
      ensureBlock();
      currentBlock!.runs.push({ text: decodeEntities(tok.value), ...activeStyle() });
      continue;
    }

    const { name, closing } = tok;
    if (name === 'p') {
      if (!closing) { closeBlock(); currentBlock = { kind: 'paragraph', runs: [] }; }
      else closeBlock();
    } else if (name === 'ul' || name === 'ol') {
      if (!closing) { listStack.push(name === 'ul' ? 'bullet' : 'number'); listCounters.push(0); }
      else { listStack.pop(); listCounters.pop(); }
    } else if (name === 'li') {
      if (!closing) {
        closeBlock();
        const listType = listStack[listStack.length - 1] ?? 'bullet';
        let index: number | undefined;
        if (listType === 'number') {
          listCounters[listCounters.length - 1] = (listCounters[listCounters.length - 1] ?? 0) + 1;
          index = listCounters[listCounters.length - 1];
        }
        currentBlock = { kind: 'list-item', listType, index, runs: [] };
      } else {
        closeBlock();
      }
    } else if (name === 'strong' || name === 'b') {
      if (!closing) styleStack.push({ bold: true }); else styleStack.pop();
    } else if (name === 'em' || name === 'i') {
      if (!closing) styleStack.push({ italic: true }); else styleStack.pop();
    } else if (name === 'u') {
      if (!closing) styleStack.push({ underline: true }); else styleStack.pop();
    } else if (name === 'span') {
      if (!closing) styleStack.push(extractSpanStyle(tok.attrs)); else styleStack.pop();
    } else if (name === 'br') {
      // Simplification: a manual line break starts a fresh paragraph block
      // rather than a mid-paragraph break — avoids fighting PDFKit's
      // continued-text chaining for a rare, cosmetic-only distinction.
      closeBlock();
      currentBlock = { kind: 'paragraph', runs: [] };
    }
    // Any other/unrecognized tag is ignored (no state change); its text
    // content still flows through as plain text tokens.
  }
  closeBlock();

  return blocks;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

const FONT_FAMILIES: Record<'sans' | 'serif' | 'mono', { regular: string; bold: string; italic: string; boldItalic: string }> = {
  sans:  { regular: 'Helvetica',   bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique',  boldItalic: 'Helvetica-BoldOblique' },
  serif: { regular: 'Times-Roman', bold: 'Times-Bold',     italic: 'Times-Italic',       boldItalic: 'Times-BoldItalic' },
  mono:  { regular: 'Courier',     bold: 'Courier-Bold',   italic: 'Courier-Oblique',    boldItalic: 'Courier-BoldOblique' },
};

function fontFor(run: RichTextRun): string {
  const family = FONT_FAMILIES[run.fontFamily ?? 'sans'];
  if (run.bold && run.italic) return family.boldItalic;
  if (run.bold) return family.bold;
  if (run.italic) return family.italic;
  return family.regular;
}

export interface RenderRichTextOptions {
  x:             number;
  width:         number;
  baseFontSize?: number;
  color?:        string;
}

// Renders parsed blocks using PDFKit's own flowing cursor (doc.x/doc.y), so
// automatic pagination keeps working — the caller should not mix this with
// absolute-positioned drawing for the same content.
export function renderRichTextBlocks(
  doc:     PDFKit.PDFDocument,
  blocks:  RichTextBlock[],
  options: RenderRichTextOptions,
): void {
  const baseFontSize = options.baseFontSize ?? 10;
  const color        = options.color ?? '#1a1a1a';

  for (const block of blocks) {
    const indent = block.kind === 'list-item' ? 14 : 0;
    const left   = options.x + indent;
    const width  = options.width - indent;

    doc.x = left;
    if (block.kind === 'list-item') {
      const prefix = block.listType === 'number' ? `${block.index}.` : '•';
      doc.font('Helvetica').fontSize(baseFontSize).fillColor(color)
        .text(prefix, options.x, doc.y, { continued: true, width: indent });
      doc.text(' ', { continued: true });
    }

    const nonEmptyRuns = block.runs.filter((r) => r.text !== '');
    if (nonEmptyRuns.length === 0) {
      doc.font('Helvetica').fontSize(baseFontSize).fillColor(color).text(' ', { width });
      continue;
    }

    nonEmptyRuns.forEach((run, i) => {
      const isLast = i === nonEmptyRuns.length - 1;
      doc.font(fontFor(run)).fontSize(run.fontSize ?? baseFontSize).fillColor(color);
      doc.text(run.text, { continued: !isLast, underline: !!run.underline, width });
    });
  }
}
