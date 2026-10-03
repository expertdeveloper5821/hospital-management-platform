import * as React from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface PeopleMultiSelectProps {
  labelId:      string;
  /** Options offered in the list (e.g. doctors already department-filtered). */
  options:      { userId: string; name: string }[];
  /** Resolves a tag's label — covers selected ids not in `options` (outside the department filter, no longer available, …). */
  getLabel:     (id: string) => string;
  selectedIds:  string[];
  onChange:     (ids: string[]) => void;
  /** Plural noun for placeholder/search/empty text, e.g. "doctors". */
  noun:         string;
}

// Searchable multi-select (✓ beside selected options) shared by the doctor and
// nurse fields of the OPD New Visit / View-Edit forms and the IPD New
// Admission / Edit forms. Clicking an option toggles it and keeps the list
// open so several people can be picked in one go; selected people render as
// removable tags inside the field.
// Selection order is preserved (first doctor = primary for department/nurse lookup).
export function PeopleMultiSelect({ labelId, options, getLabel, selectedIds, onChange, noun }: PeopleMultiSelectProps) {
  const [open,   setOpen]   = React.useState(false);
  const [search, setSearch] = React.useState('');
  const rootRef   = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const listId    = `${labelId}-listbox`;

  React.useEffect(() => {
    if (!open) { setSearch(''); return; }
    searchRef.current?.focus();
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    // Document-level so Escape works wherever focus currently sits.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  const q = search.trim().toLowerCase();
  const visible = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;

  return (
    <div ref={rootRef} className="relative">
      <div
        role="combobox"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); }
        }}
        className={cn(
          'flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring',
          open && 'ring-2 ring-ring',
        )}
      >
        <div className="flex flex-1 flex-wrap gap-1.5 min-w-0">
          {selectedIds.length === 0 && (
            <span className="text-muted-foreground py-0.5">Select {noun}…</span>
          )}
          {selectedIds.map((id) => {
            const label = getLabel(id);
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2.5 py-0.5 text-xs font-medium text-info max-w-[160px]">
                <span className="truncate min-w-0" title={label}>{label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={(e) => { e.stopPropagation(); toggle(id); }}
                  className="ml-0.5 shrink-0 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-background shadow-lg">
          <div className="relative border-b p-2">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              className="h-9 pl-8"
              placeholder={`Search ${noun}…`}
              aria-label={`Search ${noun}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              // Enter must not submit the surrounding form.
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            />
          </div>
          <ul id={listId} role="listbox" aria-multiselectable="true" aria-labelledby={labelId} className="max-h-56 overflow-y-auto py-1">
            {visible.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No {noun} found.</li>
            )}
            {visible.map((o) => {
              const selected = selectedIds.includes(o.userId);
              return (
                <li
                  key={o.userId}
                  role="option"
                  aria-selected={selected}
                  // Keep focus in the search box while picking.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(o.userId)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-muted',
                    selected && 'bg-info/5 font-medium',
                  )}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {selected && <Check className="h-4 w-4 text-primary" />}
                  </span>
                  <span className="truncate">{o.name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
