// "S. No." column for paginated tables: numbering starts at 1 on page 1 and
// continues across pages (page offset + row index + 1).
//
// Prefer the response's own `page`/`limit` over the component's local page
// state — an offline cache read (lib/offline/query-cache.ts) always answers
// with one unpaginated `page: 1` of everything cached, so trusting local
// state there would number the rows from a later page's offset.
export interface PageInfo {
  page?:  number;
  limit?: number;
}

export function serialOffset(
  response:      PageInfo | undefined | null,
  fallbackPage:  number,
  fallbackLimit: number,
): number {
  const page  = response?.page  ?? fallbackPage;
  const limit = response?.limit ?? fallbackLimit;
  if (!Number.isFinite(page) || !Number.isFinite(limit) || page < 1 || limit < 1) return 0;
  return (page - 1) * limit;
}

export function serialNumber(offset: number, index: number): number {
  return offset + index + 1;
}
