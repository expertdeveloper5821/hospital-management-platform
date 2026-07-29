import DOMPurify from 'dompurify';

// Our rich-text Notes editor (Tiptap) only ever produces these tags/attributes.
// Sanitizing on every read guards against a `notes` value that reached the
// database some other way (direct API call, legacy data) containing markup
// the editor itself would never emit.
const ALLOWED_TAGS = ['p', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'br', 'span'];
const ALLOWED_ATTR = ['style'];

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
