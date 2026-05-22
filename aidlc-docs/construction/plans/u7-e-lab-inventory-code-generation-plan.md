# U7-E: Lab + Inventory — Code Generation Plan

**Branch**: feature/U7-E | **Sprint**: Sprint 7 | **Status**: COMPLETE — 2026-05-21

## Scope
Frontend only (FC-08 Lab + FC-09 Inventory). No backend changes. Targets Unit 4 backend endpoints.

## Files Changed

| File | Action |
|---|---|
| `client/store/types.ts` | Extended with Lab + Inventory types |
| `client/store/api/lab.api.ts` | Created — 8 RTK Query hooks (pathology + radiology) |
| `client/store/api/inventory.api.ts` | Created — 5 RTK Query hooks |
| `client/app/(dashboard)/lab/page.tsx` | Created — FC-08 |
| `client/app/(dashboard)/inventory/page.tsx` | Created — FC-09 |

## FC-08 Lab UI
Two-tab page (Pathology / Radiology). Components: PatientCombobox (debounced), NewRequestModal, ReportUploadModal (10/20 MB client guard), RequestDetailPanel (slide-over + report link), RequestsTable (status + patientId filter + pagination).

RBAC: create=DOCTOR/HOSPITAL_ADMIN/RECEPTIONIST; upload-pathology=PATHOLOGIST/HOSPITAL_ADMIN; upload-radiology=RADIOLOGIST/HOSPITAL_ADMIN.

## FC-09 Inventory UI
Components: CreateItemModal, StockUpdateModal (direction toggle + qty preview + neg-guard), ThresholdUpdateModal, ItemDetailPanel (slide-over), InventoryPage (category + lowStock filter + low-stock banner + red rows).

RBAC: manage=HOSPITAL_ADMIN/MANAGER; view=HOSPITAL_ADMIN/MANAGER/DOCTOR/NURSE.

## Key Notes
- Report FormData field = `"report"` (must match multer .single('report') in lab.routes.ts)
- isLowStock = server-computed; client trusts it
- tsc --noEmit passes
