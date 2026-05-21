import { baseApi } from './base.api';
import type { ApiSuccess, AuditListResult } from '../types';

export interface AuditQueryParams {
  entityType?: string;
  entityId?:   string;
  userId?:     string;
  dateFrom?:   string; // ISO date string YYYY-MM-DD
  dateTo?:     string; // ISO date string YYYY-MM-DD
  page?:       number;
  limit?:      number;
}

export const auditApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listAuditLogs: build.query<AuditListResult, AuditQueryParams>({
      query: (params) => {
        const qs = new URLSearchParams();
        if (params.entityType) qs.set('entityType', params.entityType);
        if (params.entityId)   qs.set('entityId',   params.entityId);
        if (params.userId)     qs.set('userId',      params.userId);
        if (params.dateFrom)   qs.set('dateFrom',    params.dateFrom);
        if (params.dateTo)     qs.set('dateTo',      params.dateTo);
        if (params.page)       qs.set('page',        String(params.page));
        if (params.limit)      qs.set('limit',       String(params.limit));
        const query = qs.toString();
        return `/api/audit${query ? `?${query}` : ''}`;
      },
      transformResponse: (raw: ApiSuccess<AuditListResult>) => raw.data,
      providesTags: ['Audit'],
    }),
  }),
});

export const { useListAuditLogsQuery } = auditApi;
