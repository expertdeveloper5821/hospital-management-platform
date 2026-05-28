'use client';

import { useEffect, useRef, useState, useCallback, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLazySearchQuery } from '@/store/api/search.api';
import type { SearchResult } from '@/store/api/search.api';

// ─── Entity label map ─────────────────────────────────────────────────────────

const ENTITY_LABELS: Record<string, string> = {
  patient:     'Patient',
  user:        'Staff',
  opd_visit:   'OPD',
  ipd:         'IPD',
  lab_request: 'Lab',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface SearchOverlayProps {
  open:    boolean;
  onClose: () => void;
}

export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const router       = useRouter();
  const inputRef     = useRef<HTMLInputElement>(null);
  const listRef      = useRef<HTMLUListElement>(null);

  const [query,           setQuery]           = useState('');
  const [activeIndex,     setActiveIndex]     = useState(-1);
  const [debounceTimer,   setDebounceTimer]   = useState<ReturnType<typeof setTimeout> | null>(null);

  const [triggerSearch, { data, isFetching }] = useLazySearchQuery();

  // Focus input when overlay opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search trigger
  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      setActiveIndex(-1);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (value.trim().length >= 2) {
        const timer = setTimeout(() => {
          triggerSearch({ q: value.trim() });
        }, 300);
        setDebounceTimer(timer);
      }
    },
    [debounceTimer, triggerSearch],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [debounceTimer]);

  const results = data?.results ?? [];

  function handleSelect(result: SearchResult) {
    onClose();
    router.push(result.href);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-label="Global search"
        aria-modal="true"
        className="fixed left-1/2 top-[10%] z-50 w-full max-w-lg -translate-x-1/2 rounded-xl border bg-background shadow-2xl"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search patients, staff, visits…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search"
            aria-autocomplete="list"
            aria-controls="search-results"
            aria-activedescendant={activeIndex >= 0 ? `result-${activeIndex}` : undefined}
          />
          {isFetching && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Searching…" />
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted transition-colors"
            aria-label="Close search"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {query.trim().length >= 2 && !isFetching && results.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results for &quot;{query}&quot;
            </p>
          )}

          {results.length > 0 && (
            <ul
              id="search-results"
              ref={listRef}
              role="listbox"
              aria-label="Search results"
            >
              {results.map((result, i) => (
                <li
                  key={`${result.entityType}-${result.id}`}
                  id={`result-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors',
                    i === activeIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted/60',
                    i !== results.length - 1 && 'border-b',
                  )}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary">
                    {ENTITY_LABELS[result.entityType] ?? result.entityType}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{result.title}</p>
                    {result.subtitle && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {result.subtitle}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!query.trim() && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              Type at least 2 characters to search
            </p>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t flex items-center gap-3 text-[11px] text-muted-foreground">
          <span><kbd className="rounded border px-1 py-0.5 font-mono text-[10px]">↑↓</kbd> navigate</span>
          <span><kbd className="rounded border px-1 py-0.5 font-mono text-[10px]">↵</kbd> open</span>
          <span><kbd className="rounded border px-1 py-0.5 font-mono text-[10px]">Esc</kbd> close</span>
        </div>
      </div>
    </>
  );
}
