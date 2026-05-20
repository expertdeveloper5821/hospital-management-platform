export interface AuditQueryFilters {
  entityType?: string;
  entityId?:   string;
  userId?:     string;
  dateFrom?:   Date;
  dateTo?:     Date;
  page?:       number;
  limit?:      number;
}
