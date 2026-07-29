import { notesToDisplayHtml } from '@/lib/notes-html';
import { cn } from '@/lib/utils';

interface RichTextDisplayProps {
  value:     string | null | undefined;
  className?: string;
  /** Rendered when there is no content — defaults to an em dash. */
  fallback?: React.ReactNode;
}

// Read-only renderer for a saved Notes value — handles both rich-text HTML
// (from the RichTextEditor) and legacy plain-text notes saved before it existed.
export function RichTextDisplay({ value, className, fallback = '—' }: RichTextDisplayProps) {
  const html = notesToDisplayHtml(value);
  if (!html) return <span className="italic text-muted-foreground">{fallback}</span>;
  return (
    <div
      className={cn('rich-text-content text-sm break-words', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
