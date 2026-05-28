import { baseApi }       from './base.api';
import type { ApiSuccess } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchEntityType =
  | 'patient'
  | 'user'
  | 'opd_visit'
  | 'ipd'
  | 'lab_request';

export interface SearchResult {
  id:         string;
  entityType: SearchEntityType;
  title:      string;
  subtitle?:  string;
  href:       string;
}

export interface SearchResponse {
  query:   string;
  results: SearchResult[];
  total:   number;
}

interface SearchArgs {
  q:     string;
  type?: SearchEntityType;
}

// ─── API slice ────────────────────────────────────────────────────────────────

export const searchApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    search: build.query<SearchResponse, SearchArgs>({
      query: ({ q, type }) => {
        const params = new URLSearchParams({ q });
        if (type) params.set('type', type);
        return `/api/search?${params}`;
      },
      transformResponse: (raw: ApiSuccess<SearchResponse>) => raw.data,
    }),
  }),
});

// Use the lazy variant so the query is triggered only on user input
export const { useLazySearchQuery } = searchApi;
