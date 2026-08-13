// Default OPD payment validity window (days) applied to a tenant that has not
// explicitly configured `opdSettings.validityDays`. This is only a seed
// default for new/legacy tenant documents — the authoritative value for any
// validity calculation always comes from the tenant's stored setting
// (TenantService.getOpdSettings), never from this constant directly.
export const DEFAULT_OPD_VALIDITY_DAYS = 15;
