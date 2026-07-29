'use client';

import { useEffect } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold as BoldExtension } from '@tiptap/extension-bold';
import { Italic as ItalicExtension } from '@tiptap/extension-italic';
import { Underline as UnderlineExtension } from '@tiptap/extension-underline';
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { CharacterCount } from '@tiptap/extension-character-count';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, RemoveFormatting } from 'lucide-react';
import { cn } from '@/lib/utils';

// Non-inclusive: typing at the boundary right after bold/italic/underlined text
// (including right after a space) starts a new, unformatted run instead of
// silently continuing the mark — formatting stays scoped to what was selected.
const NonInclusiveBold      = BoldExtension.extend({ inclusive: false });
const NonInclusiveItalic    = ItalicExtension.extend({ inclusive: false });
const NonInclusiveUnderline = UnderlineExtension.extend({ inclusive: false });

const FONT_SIZES = [
  { label: 'Small',   value: '12px' },
  { label: 'Normal',  value: '14px' },
  { label: 'Large',   value: '16px' },
  { label: 'X-Large', value: '20px' },
];

const FONT_FAMILIES = [
  { label: 'Arial',           value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica',       value: 'Helvetica, Arial, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Georgia',         value: 'Georgia, serif' },
  { label: 'Verdana',         value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma',          value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS',    value: '"Trebuchet MS", sans-serif' },
  { label: 'Courier New',     value: '"Courier New", Courier, monospace' },
  { label: 'Monospace',       value: 'monospace' },
];

interface RichTextEditorProps {
  id?:          string;
  value:        string;
  onChange:     (html: string) => void;
  maxLength:    number;
  placeholder?: string;
  disabled?:    boolean;
  /** Approximate visible rows, for a min-height matching the textarea it replaces. */
  rows?:        number;
  className?:   string;
}

// Rich-text replacement for a plain <textarea> Notes field. Emits sanitized-
// by-schema HTML via onChange (empty editor emits '', matching the previous
// empty-string convention so existing submit/omit-if-empty logic keeps working).
export function RichTextEditor({
  id, value, onChange, maxLength, placeholder, disabled, rows = 3, className,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading:       false,
        blockquote:    false,
        codeBlock:     false,
        code:          false,
        horizontalRule: false,
        strike:        false,
        link:          false,
        dropcursor:    false,
        bold:          false,
        italic:        false,
        underline:     false,
      }),
      NonInclusiveBold,
      NonInclusiveItalic,
      NonInclusiveUnderline,
      TextStyle,
      FontFamily,
      FontSize,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      CharacterCount.configure({ limit: maxLength }),
    ],
    content: value || '',
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? '' : editor.getHTML());
    },
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        class: 'rich-text-editor-content px-3 py-2 text-sm',
      },
    },
  });

  // Keep the editor in sync when `value` changes from outside (e.g. a form
  // reset), but skip the round-trip when it's just echoing back what onUpdate
  // itself produced — otherwise every keystroke would reset the cursor.
  useEffect(() => {
    if (!editor) return;
    const isEmptyRoundTrip = value === '' && editor.isEmpty;
    if (value !== editor.getHTML() && !isEmptyRoundTrip) {
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) return null;

  const charCount = editor.storage.characterCount.characters();
  const over      = charCount > maxLength;

  return (
    <div
      className={cn(
        'rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring',
        disabled && 'opacity-60',
        className,
      )}
    >
      {!disabled && <RichTextToolbar editor={editor} />}
      <EditorContent editor={editor} style={{ minHeight: `${rows * 1.5}rem` }} />
      <div className={cn('flex justify-end px-3 pb-1.5 text-xs', over ? 'text-destructive' : 'text-muted-foreground')}>
        {charCount} / {maxLength} characters
      </div>
    </div>
  );
}

function RichTextToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
      <ToolbarButton active={editor.isActive('bold')} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('italic')} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('underline')} label="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolbarButton>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <ToolbarButton active={editor.isActive('bulletList')} label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton active={editor.isActive('orderedList')} label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <select
        aria-label="Font style"
        title="Font style"
        defaultValue=""
        onChange={(e) => {
          const val = e.target.value;
          if (val) editor.chain().focus().setFontFamily(val).run();
          else editor.chain().focus().unsetFontFamily().run();
          e.target.value = '';
        }}
        className="h-7 rounded border border-input bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Font</option>
        {FONT_FAMILIES.map((f) => (
          <option key={f.label} value={f.value}>{f.label}</option>
        ))}
      </select>

      <select
        aria-label="Font size"
        title="Font size"
        defaultValue=""
        onChange={(e) => {
          const val = e.target.value;
          if (val) editor.chain().focus().setFontSize(val).run();
          else editor.chain().focus().unsetFontSize().run();
          e.target.value = '';
        }}
        className="h-7 rounded border border-input bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">Size</option>
        {FONT_SIZES.map((f) => (
          <option key={f.label} value={f.value}>{f.label}</option>
        ))}
      </select>

      <span className="mx-0.5 h-5 w-px bg-border" />

      <ToolbarButton
        active={false}
        label="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  active, label, onClick, children,
}: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // Keep the editor's text selection/focus intact when clicking a toolbar button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-muted',
        active && 'bg-muted text-primary',
      )}
    >
      {children}
    </button>
  );
}
