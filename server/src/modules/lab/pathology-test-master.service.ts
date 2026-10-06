import { pathologyTestMasterRepository, PathologyTestMasterUpdate } from './pathology-test-master.repository';
import { IPathologyTestMaster } from './pathology-test-master.model';
import { PATHOLOGY_TEST_MASTER_SEEDS } from './pathology-test-master.defaults';
import { GENERIC_TEMPLATE_KEY } from './pathology-report-templates';
import {
  PathologyTestClinicalContent,
  PathologyTestMasterResponse,
  UpdatePathologyTestMasterInput,
} from './lab.types';
import { userRepository } from '../user/user.repository';
import { auditService }   from '../../shared/services/audit.service';
import { AuditEntityType } from '../../shared/types/common.types';
import { NotFoundError } from '../../shared/middleware/error-handler';

const SEED_ORDER = new Map(PATHOLOGY_TEST_MASTER_SEEDS.map((s, i) => [s.templateKey, i]));

const EMPTY_CONTENT: PathologyTestClinicalContent = {
  clinicalNote: null, comment: null, correlateClinically: null,
};

function toContent(row: IPathologyTestMaster | undefined): PathologyTestClinicalContent {
  if (!row) return EMPTY_CONTENT;
  return {
    clinicalNote:        row.clinicalNote || null,
    comment:             row.comment || null,
    correlateClinically: row.correlateClinically || null,
  };
}

export class PathologyTestMasterService {

  // Every master row of the tenant, keyed by templateKey. Rows missing for
  // this tenant (first use, or a test added to the catalog later) are seeded
  
  async loadMasterMap(tenantId: string): Promise<Map<string, IPathologyTestMaster>> {
    let rows = await pathologyTestMasterRepository.findAll(tenantId);
    const have    = new Set(rows.map((r) => r.templateKey));
    const missing = PATHOLOGY_TEST_MASTER_SEEDS.filter((s) => !have.has(s.templateKey));
    if (missing.length) {
      await pathologyTestMasterRepository.insertMissing(tenantId, missing);
      rows = await pathologyTestMasterRepository.findAll(tenantId);
    }
    return new Map(rows.map((r) => [r.templateKey, r]));
  }

  // The content a test's report prints. A test outside the catalog uses the
  // GENERIC row (its footer); a templateKey with no row prints nothing extra.
  contentFor(masters: Map<string, IPathologyTestMaster>, templateKey: string): PathologyTestClinicalContent {
    const row = masters.get(templateKey);
    if (row) return toContent(row);
    return { ...EMPTY_CONTENT, correlateClinically: toContent(masters.get(GENERIC_TEMPLATE_KEY)).correlateClinically };
  }

  async list(tenantId: string): Promise<PathologyTestMasterResponse[]> {
    const rows  = [...(await this.loadMasterMap(tenantId)).values()]
      .filter((r) => SEED_ORDER.has(r.templateKey))
      .sort((a, b) => SEED_ORDER.get(a.templateKey)! - SEED_ORDER.get(b.templateKey)!);
    const names = await this.editorNames(tenantId, rows);
    return rows.map((r) => this.toResponse(r, names));
  }

  async update(
    tenantId:    string,
    templateKey: string,
    userId:      string,
    input:       UpdatePathologyTestMasterInput,
  ): Promise<PathologyTestMasterResponse> {
    if (!SEED_ORDER.has(templateKey)) throw new NotFoundError('Test not found in the Test Master');
    const masters  = await this.loadMasterMap(tenantId);
    const previous = masters.get(templateKey);
    if (!previous) throw new NotFoundError('Test not found in the Test Master');

    const changes: PathologyTestMasterUpdate = {};
    if (input.clinicalNote        !== undefined) changes.clinicalNote        = input.clinicalNote;
    if (input.comment             !== undefined) changes.comment             = input.comment;
    if (input.correlateClinically !== undefined) changes.correlateClinically = input.correlateClinically;

    const updated = await pathologyTestMasterRepository.update(tenantId, templateKey, changes, userId);
    if (!updated) throw new NotFoundError('Test not found in the Test Master');

    // Configuration text, not patient data — logged in full.
    try {
      const before: Record<string, unknown> = { ...toContent(previous) };
      await auditService.log({
        entityType:    AuditEntityType.PATHOLOGY_TEST_MASTER,
        entityId:      templateKey,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k]])),
        newValue:      { testName: updated.testName, ...changes },
      });
    } catch { /* swallow */ }

    const names = await this.editorNames(tenantId, [updated]);
    return this.toResponse(updated, names);
  }

  private async editorNames(tenantId: string, rows: IPathologyTestMaster[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.updatedBy).filter((id): id is string => !!id))];
    return ids.length ? userRepository.findNamesByIds(tenantId, ids) : new Map();
  }

  private toResponse(row: IPathologyTestMaster, names: Map<string, string>): PathologyTestMasterResponse {
    return {
      templateKey:   row.templateKey,
      testName:      row.testName,
      ...toContent(row),
      updatedBy:     row.updatedBy ?? null,
      updatedByName: row.updatedBy ? names.get(row.updatedBy) ?? null : null,
      updatedAt:     row.updatedAt.toISOString(),
    };
  }
}

export const pathologyTestMasterService = new PathologyTestMasterService();
