import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { UserRole } from '../types/common.types';
import { tenantCache } from '../config/tenant-cache';
import { UnauthorizedError, ServiceUnavailableError } from './error-handler';
import { assertDbConnected } from '../utils/db-guard';

// Extend Express Request to carry the tenant document
declare global {
  namespace Express {
    interface Request {
      tenant?: mongoose.Document & { status: string; tenantId: string };
    }
  }
}

/**
 * Verifies the tenant exists and is ACTIVE; attaches req.tenant.
 * MW-SCOPE-01..08: Skip for SUPER_ADMIN → cache lookup → DB fallback → INACTIVE check.
 * Uses TenantCache (60s TTL) to avoid a DB round-trip on every request.
 */
export function scopeTenant(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // MW-SCOPE-02: Super Admin has no tenantId — skip tenant check
  if (req.user?.role === UserRole.SUPER_ADMIN) {
    return next();
  }

  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return next(new UnauthorizedError('Tenant context missing'));
  }

  // MW-SCOPE-04/05/06: Check cache first, fall back to DB
  const cachedStatus = tenantCache.get(tenantId);

  if (cachedStatus !== null) {
    if (cachedStatus === 'INACTIVE') {
      return next(new UnauthorizedError('Tenant account is inactive'));
    }
    return next();
  }

  // Cache miss — query MongoDB
  try {
    assertDbConnected();
  } catch (err) {
    return next(err);
  }

  // Lazy import to avoid circular dependency with model files loaded later
  const TenantModel = mongoose.model('Tenant');

  TenantModel.findById(tenantId)
    .lean()
    .then((tenant) => {
      if (!tenant) {
        return next(new UnauthorizedError('Tenant not found'));
      }

      const status = (tenant as unknown as { status: string }).status;
      tenantCache.set(tenantId, status as import('../types/common.types').TenantStatus);

      if (status === 'INACTIVE') {
        return next(new UnauthorizedError('Tenant account is inactive'));
      }

      req.tenant = tenant as typeof req.tenant;
      next();
    })
    .catch((err: Error) => {
      if (['MongoNetworkError', 'MongoServerSelectionError', 'MongoTimeoutError'].includes(err.name)) {
        next(new ServiceUnavailableError());
      } else {
        next(err);
      }
    });
}
