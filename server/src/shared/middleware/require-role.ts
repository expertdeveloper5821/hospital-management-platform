import { Request, Response, NextFunction } from 'express';
import { UserRole, AuditEntityType } from '../types/common.types';
import { ForbiddenError } from './error-handler';
import { getCorrelationId } from '../config/request-context';

/**
 * RBAC role guard — variadic signature: requireRole('DOCTOR', 'MANAGER')
 * MW-ROLE-01..06: Check role → 403 + audit log on failure → next() on success.
 * SECURITY-08: Function-level authorization enforced server-side.
 * PBT property: idempotent — calling the check twice with same inputs = same result.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userRole = req.user?.role;

    if (!userRole || !roles.includes(userRole)) {
      // MW-ROLE-05/06: Log every 403 for security monitoring (FR-13.2, SECURITY-14)
      console.warn(JSON.stringify({
        level:         'warn',
        event:         'access_denied',
        correlationId: getCorrelationId(),
        userId:        req.user?.userId ?? 'unknown',
        tenantId:      req.user?.tenantId ?? null,
        role:          userRole ?? 'none',
        allowedRoles:  roles,
        path:          req.path,
        method:        req.method,
        timestamp:     new Date().toISOString(),
      }));

      // Audit log via AuditService (imported lazily to avoid circular deps)
      // The stub just console.logs — full implementation in Unit 6
      import('../services/audit.service').then(({ auditService }) => {
        auditService.log({
          entityType: AuditEntityType.AUTH,
          entityId:   req.path,
          action:     'DELETE', // closest semantic for "access denied"
          userId:     req.user?.userId ?? 'unknown',
          tenantId:   req.user?.tenantId ?? null,
          newValue:   { deniedRole: userRole, allowedRoles: roles, path: req.path },
        }).catch(() => { /* audit failure must never block */ });
      }).catch(() => { /* ignore import failure */ });

      return next(new ForbiddenError('Insufficient permissions'));
    }

    next();
  };
}
