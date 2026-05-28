// ─── Entity Types ─────────────────────────────────────────────────────────────

export const SearchEntityType = {
  PATIENT:     'patient',
  USER:        'user',
  OPD_VISIT:   'opd_visit',
  IPD:         'ipd',
  LAB_REQUEST: 'lab_request',
} as const;

export type SearchEntityType = typeof SearchEntityType[keyof typeof SearchEntityType];

// ─── Result Shapes ────────────────────────────────────────────────────────────

export interface SearchResult {
  id:          string;
  entityType:  SearchEntityType;
  title:       string;  // primary display text
  subtitle?:   string;  // secondary info (role, mobile, status)
  href:        string;  // frontend navigation URL
}

export interface SearchResponse {
  query:    string;
  results:  SearchResult[];
  total:    number;
}
