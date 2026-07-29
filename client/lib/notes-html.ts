import DOMPurify from 'dompurify';
import { FONT_SIZES, FONT_FAMILIES } from '@/components/ui/rich-text-editor';

// Our rich-text Notes editor (Tiptap) only ever produces these tags/attributes.
// Sanitizing on every read guards against a `notes` value that reached the
// database some other way (direct API call, legacy data) containing markup
// the editor itself would never emit.
const ALLOWED_TAGS = ['p', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'br', 'span'];
const ALLOWED_ATTR = ['style'];

// `style` is otherwise unrestricted CSS — allowing it verbatim lets a stored
// note reposition/overlay page content, hide/spoof UI, or exfiltrate via
// `url(...)` for any user who later views it. Only the exact font-family and
// font-size values the toolbar itself can produce are allowed through.
const ALLOWED_FONT_SIZES = new Set(FONT_SIZES.map((f) => f.value));
const ALLOWED_FONT_FAMILIES = new Set(FONT_FAMILIES.map((f) => f.value));

function sanitizeStyleValue(style: string): string {
  return style
    .split(';')
    .map((decl) => decl.trim())
    .filter(Boolean)
    .map((decl) => {
      const idx = decl.indexOf(':');
      if (idx === -1) return null;
      const prop  = decl.slice(0, idx).trim().toLowerCase();
      const value = decl.slice(idx + 1).trim();
      if (prop === 'font-size' && ALLOWED_FONT_SIZES.has(value)) return `font-size: ${value}`;
      if (prop === 'font-family' && ALLOWED_FONT_FAMILIES.has(value)) return `font-family: ${value}`;
      return null;
    })
    .filter((v): v is string => v !== null)
    .join('; ');
}

DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName !== 'style') return;
  const sanitized = sanitizeStyleValue(data.attrValue);
  if (sanitized) data.attrValue = sanitized;
  else data.keepAttr = false;
});

export function sanitizeNotesHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

// Notes saved before the rich-text editor existed are plain text with no
// markup at all. Detect that case so it still renders the way it used to
// (line breaks preserved, no literal "<" characters mis-rendered as tags).
const LOOKS_LIKE_HTML = /<\/?(p|ul|ol|li|strong|em|u|span|br)[ >/]/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function notesToDisplayHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  const html = LOOKS_LIKE_HTML.test(raw) ? raw : escapeHtml(raw).replace(/\n/g, '<br>');
  return sanitizeNotesHtml(html);
}
