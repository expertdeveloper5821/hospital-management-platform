import { TenantStatus } from '../types/common.types';

// TODO(scale): Replace with Redis TenantCache. See docs/scaling.md for migration guide.
// Current: in-memory Map, single-instance only. TTL: 60s.

const TTL_MS = 60_000; // 60 seconds
const LOG_INTERVAL = 100; // log hit/miss stats every N requests

interface CacheEntry {
  status:   TenantStatus;
  cachedAt: number;
}

class TenantCache {
  private readonly cache = new Map<string, CacheEntry>();
  private hits         = 0;
  private misses       = 0;
  private requestCount = 0;

  get(tenantId: string): TenantStatus | null {
    this.requestCount++;
    const entry = this.cache.get(tenantId);

    if (entry && Date.now() - entry.cachedAt < TTL_MS) {
      this.hits++;
      this.maybeLogStats();
      return entry.status;
    }

    // Cache miss or expired
    if (entry) this.cache.delete(tenantId);
    this.misses++;
    this.maybeLogStats();
    return null;
  }

  set(tenantId: string, status: TenantStatus): void {
    this.cache.set(tenantId, { status, cachedAt: Date.now() });
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /** For testing only */
  clear(): void {
    this.cache.clear();
    this.hits         = 0;
    this.misses       = 0;
    this.requestCount = 0;
  }

  private maybeLogStats(): void {
    if (this.requestCount % LOG_INTERVAL === 0) {
      const hitRate = this.requestCount > 0
        ? ((this.hits / this.requestCount) * 100).toFixed(1) + '%'
        : '0%';
      console.log(JSON.stringify({
        level:     'info',
        event:     'tenant_cache_stats',
        hits:      this.hits,
        misses:    this.misses,
        hitRate,
        cacheSize: this.cache.size,
        timestamp: new Date().toISOString(),
      }));
    }
  }
}

// Singleton instance shared across the application
export const tenantCache = new TenantCache();
