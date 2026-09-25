import {
  planOfflineMutation, applyOptimisticPatch, isTempId, TEMP_ID_PREFIX,
  planOfflineCreate, planOfflineAddBed, buildCreateOptimisticRecord, PENDING_QUEUE_NUMBER,
} from './mutation-policy';

describe('isTempId', () => {
  test('recognizes the temp id prefix', () => {
    expect(isTempId(`${TEMP_ID_PREFIX}abc`)).toBe(true);
  });

  test('rejects a real server-generated id', () => {
    expect(isTempId('PAT-abc123')).toBe(false);
  });

  test('rejects null/undefined', () => {
    expect(isTempId(null)).toBe(false);
    expect(isTempId(undefined)).toBe(false);
  });
});

describe('planOfflineMutation', () => {
  test('returns null for an endpoint not on the offline allowlist', () => {
    expect(planOfflineMutation('createOPDVisit', { url: '/api/opd/visits', method: 'POST', body: {} })).toBeNull();
  });

  test('updatePatient: plans an UPDATE with no field restrictions', () => {
    const plan = planOfflineMutation('updatePatient', {
      url: '/api/patients/PAT-1', method: 'PATCH', body: { fullName: 'New Name' },
    });

    expect(plan).toEqual({
      entityType: 'PATIENT', operation: 'UPDATE', subjectId: 'PAT-1',
      idFieldForCacheLookup: 'patientId', url: '/api/patients/PAT-1', method: 'PATCH',
      body: { fullName: 'New Name' },
    });
  });

  test('updatePatient: refused when the subject id is an unsynced temp id', () => {
    const plan = planOfflineMutation('updatePatient', {
      url: `/api/patients/${TEMP_ID_PREFIX}xyz`, method: 'PATCH', body: { fullName: 'x' },
    });
    expect(plan).toBeNull();
  });

  test('updateOPDVisit: allows diagnosis/prescription/notes/vitals', () => {
    const plan = planOfflineMutation('updateOPDVisit', {
      url: '/api/opd/visits/OPD-1', method: 'PATCH',
      body: { diagnosis: 'flu', vitals: { weight: 70 } },
    });
    expect(plan?.entityType).toBe('OPD_VISIT');
    expect(plan?.idFieldForCacheLookup).toBe('visitId');
  });

  test('updateOPDVisit: refused when the body touches doctorIds (racy department resolution)', () => {
    const plan = planOfflineMutation('updateOPDVisit', {
      url: '/api/opd/visits/OPD-1', method: 'PATCH',
      body: { diagnosis: 'flu', doctorIds: ['doc-1'] },
    });
    expect(plan).toBeNull();
  });

  test('updateOPDVisit: refused when the body touches visitDate', () => {
    const plan = planOfflineMutation('updateOPDVisit', {
      url: '/api/opd/visits/OPD-1', method: 'PATCH', body: { visitDate: '2026-01-01' },
    });
    expect(plan).toBeNull();
  });

  test('addProgressNote: plans an APPEND', () => {
    const plan = planOfflineMutation('addProgressNote', {
      url: '/api/ipd/admissions/IPD-1/progress-notes', method: 'POST', body: { note: 'stable' },
    });
    expect(plan).toEqual({
      entityType: 'IPD_PROGRESS_NOTE', operation: 'APPEND', subjectId: 'IPD-1',
      idFieldForCacheLookup: 'admissionId', url: '/api/ipd/admissions/IPD-1/progress-notes',
      method: 'POST', body: { note: 'stable' },
    });
  });

  test('updateAdmission: allows vitals only', () => {
    const plan = planOfflineMutation('updateAdmission', {
      url: '/api/ipd/admissions/IPD-1', method: 'PATCH', body: { vitals: { weight: 60 } },
    });
    expect(plan?.entityType).toBe('IPD_ADMISSION_VITALS');
  });

  test('updateAdmission: refused when the body touches bedId (bed-occupancy race)', () => {
    const plan = planOfflineMutation('updateAdmission', {
      url: '/api/ipd/admissions/IPD-1', method: 'PATCH', body: { bedId: 'BED-2' },
    });
    expect(plan).toBeNull();
  });

  test('updateAdmission: refused when vitals is mixed with wardId in the same request', () => {
    const plan = planOfflineMutation('updateAdmission', {
      url: '/api/ipd/admissions/IPD-1', method: 'PATCH', body: { vitals: { weight: 60 }, wardId: 'W-2' },
    });
    expect(plan).toBeNull();
  });

  test('editPathologyRequest: allows notes only', () => {
    const plan = planOfflineMutation('editPathologyRequest', {
      url: '/api/lab/pathology/REQ-1', method: 'PATCH', body: { notes: 'urgent' },
    });
    expect(plan?.entityType).toBe('LAB_REQUEST');
    expect(plan?.idFieldForCacheLookup).toBe('requestId');
  });

  test('editPathologyRequest: refused when status is included', () => {
    const plan = planOfflineMutation('editPathologyRequest', {
      url: '/api/lab/pathology/REQ-1', method: 'PATCH', body: { notes: 'x', status: 'IN_PROGRESS' },
    });
    expect(plan).toBeNull();
  });

  test('editRadiologyRequest: allows notes only', () => {
    const plan = planOfflineMutation('editRadiologyRequest', {
      url: '/api/lab/radiology/REQ-2', method: 'PATCH', body: { notes: 'x' },
    });
    expect(plan?.entityType).toBe('LAB_REQUEST');
  });

  test('createManualPayment, createPatient, createOPDVisit, createAdmission are not on the UPDATE/APPEND allowlist', () => {
    // All four are offline-eligible, but as CREATEs — see the
    // planOfflineCreate describe block below — never as an UPDATE/APPEND.
    expect(planOfflineMutation('createManualPayment', { url: '/api/payments/manual', method: 'POST', body: {} })).toBeNull();
    expect(planOfflineMutation('createPatient', { url: '/api/patients', method: 'POST', body: {} })).toBeNull();
    expect(planOfflineMutation('createOPDVisit', { url: '/api/opd/visits', method: 'POST', body: {} })).toBeNull();
    expect(planOfflineMutation('createAdmission', { url: '/api/ipd/admissions', method: 'POST', body: {} })).toBeNull();
  });

  test('online-only mutations are not on the allowlist', () => {
    expect(planOfflineMutation('dischargePatient', { url: '/api/ipd/admissions/IPD-1/discharge', method: 'PATCH' })).toBeNull();
    expect(planOfflineMutation('createRazorpayOrder', { url: '/api/payments/razorpay-order', method: 'POST', body: {} })).toBeNull();
  });
});

describe('applyOptimisticPatch', () => {
  test('PATIENT: shallow-merges the body onto the cached entity', () => {
    const cached = { patientId: 'PAT-1', fullName: 'Old Name', mobileNumber: '111' };
    const result = applyOptimisticPatch('PATIENT', cached, { fullName: 'New Name' }, { userId: 'u1' });
    expect(result).toEqual({ patientId: 'PAT-1', fullName: 'New Name', mobileNumber: '111' });
  });

  test('OPD_VISIT: merges vitals sub-fields without wiping others', () => {
    const cached = { visitId: 'OPD-1', vitals: { weight: 70, height: 170 } };
    const result = applyOptimisticPatch('OPD_VISIT', cached, { vitals: { weight: 75 } }, { userId: 'u1' });
    expect(result.vitals).toEqual({ weight: 75, height: 170 });
  });

  test('OPD_VISIT: explicit null in vitals clears only that field', () => {
    const cached = { visitId: 'OPD-1', vitals: { weight: 70, height: 170 } };
    const result = applyOptimisticPatch('OPD_VISIT', cached, { vitals: { weight: null } }, { userId: 'u1' });
    expect(result.vitals).toEqual({ weight: null, height: 170 });
  });

  test('IPD_ADMISSION_VITALS: merges vitals the same way as OPD', () => {
    const cached = { admissionId: 'IPD-1', vitals: { sugar: 90 } };
    const result = applyOptimisticPatch('IPD_ADMISSION_VITALS', cached, { vitals: { sugar: 110 } }, { userId: 'u1' });
    expect(result.vitals).toEqual({ sugar: 110 });
  });

  test('IPD_PROGRESS_NOTE: appends a new note without disturbing existing ones', () => {
    const cached = { admissionId: 'IPD-1', progressNotes: [{ noteId: 'n1', doctorId: 'doc-1', note: 'day 1', timestamp: 't1' }] };
    const result = applyOptimisticPatch('IPD_PROGRESS_NOTE', cached, { note: 'day 2' }, { userId: 'doc-2' });

    const notes = result.progressNotes as Array<Record<string, unknown>>;
    expect(notes).toHaveLength(2);
    expect(notes[0]).toEqual(cached.progressNotes[0]);
    expect(notes[1]).toMatchObject({ doctorId: 'doc-2', note: 'day 2' });
    expect(isTempId(notes[1].noteId as string)).toBe(true);
  });

  test('IPD_PROGRESS_NOTE: handles an admission with no prior notes', () => {
    const cached = { admissionId: 'IPD-1' };
    const result = applyOptimisticPatch('IPD_PROGRESS_NOTE', cached, { note: 'first note' }, { userId: 'doc-1' });
    expect(result.progressNotes).toHaveLength(1);
  });

  test('LAB_REQUEST: shallow-merges notes', () => {
    const cached = { requestId: 'REQ-1', notes: 'old note', testType: 'CBC' };
    const result = applyOptimisticPatch('LAB_REQUEST', cached, { notes: 'new note' }, { userId: 'u1' });
    expect(result).toEqual({ requestId: 'REQ-1', notes: 'new note', testType: 'CBC' });
  });
});

describe('planOfflineCreate', () => {
  test('returns null for an endpoint not on the CREATE allowlist', () => {
    expect(planOfflineCreate('createRazorpayOrder', { url: '/api/payments/razorpay-order', method: 'POST', body: {} })).toBeNull();
    expect(planOfflineCreate('updatePatient', { url: '/api/patients/PAT-1', method: 'PATCH', body: {} })).toBeNull();
  });

  test('returns null when the method is not POST', () => {
    expect(planOfflineCreate('createPatient', { url: '/api/patients', method: 'PATCH', body: {} })).toBeNull();
  });

  test('createPatient: mints a temp id, no dependsOn (root entity)', () => {
    const plan = planOfflineCreate('createPatient', {
      url: '/api/patients', method: 'POST', body: { fullName: 'Jane' },
    });
    expect(plan?.entityType).toBe('PATIENT');
    expect(plan?.idField).toBe('patientId');
    expect(plan?.url).toBe('/api/patients');
    expect(isTempId(plan?.tempId as string)).toBe(true);
    expect(plan?.dependsOn).toEqual([]);
    expect(plan?.tempIdRefs).toEqual([]);
    expect(plan?.body).toEqual({ fullName: 'Jane' });
  });

  test('createOPDVisit: a real (already-synced) patientId produces no dependency', () => {
    const plan = planOfflineCreate('createOPDVisit', {
      url: '/api/opd/visits', method: 'POST', body: { patientId: 'PAT-1' },
    });
    expect(plan?.entityType).toBe('OPD_VISIT');
    expect(plan?.dependsOn).toEqual([]);
    expect(plan?.tempIdRefs).toEqual([]);
  });

  test('createOPDVisit: an unsynced temp patientId records a dependency referencing that exact tempId', () => {
    const patientTempId = `${TEMP_ID_PREFIX}patient-abc`;
    const plan = planOfflineCreate('createOPDVisit', {
      url: '/api/opd/visits', method: 'POST', body: { patientId: patientTempId },
    });
    expect(plan?.dependsOn).toEqual([patientTempId]);
    expect(plan?.tempIdRefs).toEqual([{ path: 'patientId', tempId: patientTempId }]);
  });

  test('createAdmission: an unsynced temp patientId records a dependency the same way', () => {
    const patientTempId = `${TEMP_ID_PREFIX}patient-xyz`;
    const plan = planOfflineCreate('createAdmission', {
      url: '/api/ipd/admissions', method: 'POST',
      body: { patientId: patientTempId, wardId: 'ward-1', bedId: 'bed-1' },
    });
    expect(plan?.entityType).toBe('IPD_ADMISSION');
    expect(plan?.idField).toBe('admissionId');
    expect(plan?.dependsOn).toEqual([patientTempId]);
    expect(plan?.tempIdRefs).toEqual([{ path: 'patientId', tempId: patientTempId }]);
  });

  test('two calls for the same endpoint mint two distinct temp ids', () => {
    const planA = planOfflineCreate('createPatient', { url: '/api/patients', method: 'POST', body: {} });
    const planB = planOfflineCreate('createPatient', { url: '/api/patients', method: 'POST', body: {} });
    expect(planA?.tempId).not.toBe(planB?.tempId);
  });

  test('createManualPayment: an unsynced temp referenceId (e.g. an offline-created OPD visit) records a dependency', () => {
    const visitTempId = `${TEMP_ID_PREFIX}visit-abc`;
    const plan = planOfflineCreate('createManualPayment', {
      url: '/api/payments/manual', method: 'POST',
      body: { patientId: 'PAT-1', amount: 500, paymentMethod: 'CASH', description: 'OPD Consultation', referenceType: 'OPD_VISIT', referenceId: visitTempId },
    });
    expect(plan?.entityType).toBe('MANUAL_PAYMENT');
    expect(plan?.idField).toBe('paymentId');
    expect(plan?.dependsOn).toEqual([visitTempId]);
    expect(plan?.tempIdRefs).toEqual([{ path: 'referenceId', tempId: visitTempId }]);
  });

  test('createManualPayment: a real (already-synced) referenceId produces no dependency', () => {
    const plan = planOfflineCreate('createManualPayment', {
      url: '/api/payments/manual', method: 'POST',
      body: { patientId: 'PAT-1', amount: 500, paymentMethod: 'CASH', description: 'OPD Consultation', referenceType: 'OPD_VISIT', referenceId: 'OPD-1' },
    });
    expect(plan?.dependsOn).toEqual([]);
    expect(plan?.tempIdRefs).toEqual([]);
  });

  test('createManualPayment: no referenceId at all (e.g. the standalone Payments page) plans cleanly with no dependency', () => {
    const plan = planOfflineCreate('createManualPayment', {
      url: '/api/payments/manual', method: 'POST',
      body: { patientId: 'PAT-1', amount: 500, paymentMethod: 'CASH', description: 'Misc payment' },
    });
    expect(plan?.entityType).toBe('MANUAL_PAYMENT');
    expect(plan?.dependsOn).toEqual([]);
    expect(plan?.tempIdRefs).toEqual([]);
  });

  test('createInventoryItem: self-contained CREATE, no dependency', () => {
    const plan = planOfflineCreate('createInventoryItem', {
      url: '/api/inventory', method: 'POST',
      body: { name: 'Gloves', category: 'Consumables', unit: 'box', quantity: 10, lowStockThreshold: 5 },
    });
    expect(plan?.entityType).toBe('INVENTORY_ITEM');
    expect(plan?.idField).toBe('itemId');
    expect(isTempId(plan?.tempId as string)).toBe(true);
    expect(plan?.dependsOn).toEqual([]);
    expect(plan?.tempIdRefs).toEqual([]);
  });

  test('createWard: self-contained CREATE, no dependency', () => {
    const plan = planOfflineCreate('createWard', {
      url: '/api/ipd/wards', method: 'POST', body: { name: 'General Ward', floor: '2' },
    });
    expect(plan?.entityType).toBe('WARD');
    expect(plan?.idField).toBe('wardId');
    expect(plan?.dependsOn).toEqual([]);
  });

  test('createPackage: self-contained CREATE, no dependency', () => {
    const plan = planOfflineCreate('createPackage', {
      url: '/api/packages', method: 'POST',
      body: { name: 'Basic Checkup', price: 500, includedServices: ['Consultation'] },
    });
    expect(plan?.entityType).toBe('PACKAGE');
    expect(plan?.idField).toBe('packageId');
    expect(plan?.dependsOn).toEqual([]);
  });

  test('addCharge: an unsynced temp patientId (e.g. an offline-created patient) records a dependency', () => {
    const patientTempId = `${TEMP_ID_PREFIX}patient-new`;
    const plan = planOfflineCreate('addCharge', {
      url: '/api/charges', method: 'POST',
      body: { patientId: patientTempId, category: 'CONSULTATION', description: 'Consult fee', amount: 500 },
    });
    expect(plan?.entityType).toBe('CHARGE');
    expect(plan?.idField).toBe('chargeId');
    expect(plan?.dependsOn).toEqual([patientTempId]);
    expect(plan?.tempIdRefs).toEqual([{ path: 'patientId', tempId: patientTempId }]);
  });

  test('addCharge: a real (already-synced) patientId produces no dependency', () => {
    const plan = planOfflineCreate('addCharge', {
      url: '/api/charges', method: 'POST',
      body: { patientId: 'PAT-1', category: 'CONSULTATION', description: 'Consult fee', amount: 500 },
    });
    expect(plan?.dependsOn).toEqual([]);
    expect(plan?.tempIdRefs).toEqual([]);
  });

  test('addBeds is deliberately not on the generic CREATE allowlist (bulk multi-entity create doesn\'t fit that table\'s model) — see planOfflineAddBed instead', () => {
    expect(planOfflineCreate('addBeds', {
      url: '/api/ipd/wards/W-1/beds', method: 'POST', body: { bedNumbers: ['101', '102'] },
    })).toBeNull();
  });
});

describe('planOfflineAddBed', () => {
  test('a single bed number against a real wardId plans a BED create, wardId lifted from the URL into the body', () => {
    const plan = planOfflineAddBed('addBeds', {
      url: '/api/ipd/wards/WARD-1/beds', method: 'POST', body: { bedNumbers: ['101'] },
    });
    expect(plan?.entityType).toBe('BED');
    expect(plan?.idField).toBe('bedId');
    expect(plan?.url).toBe('/api/ipd/wards/WARD-1/beds');
    expect(plan?.body).toEqual({ wardId: 'WARD-1', bedNumbers: ['101'] });
    expect(isTempId(plan?.tempId as string)).toBe(true);
    expect(plan?.dependsOn).toEqual([]);
    expect(plan?.tempIdRefs).toEqual([]);
  });

  test('returns null for any endpoint other than addBeds', () => {
    expect(planOfflineAddBed('createWard', {
      url: '/api/ipd/wards/WARD-1/beds', method: 'POST', body: { bedNumbers: ['101'] },
    })).toBeNull();
  });

  test('returns null for more than one bed number — bulk add still requires being online', () => {
    expect(planOfflineAddBed('addBeds', {
      url: '/api/ipd/wards/WARD-1/beds', method: 'POST', body: { bedNumbers: ['101', '102'] },
    })).toBeNull();
  });

  test('returns null for zero bed numbers', () => {
    expect(planOfflineAddBed('addBeds', {
      url: '/api/ipd/wards/WARD-1/beds', method: 'POST', body: { bedNumbers: [] },
    })).toBeNull();
  });

  test('returns null when wardId itself is still an unsynced temp id — no URL-embedded temp-id substitution', () => {
    expect(planOfflineAddBed('addBeds', {
      url: `/api/ipd/wards/${TEMP_ID_PREFIX}ward-new/beds`, method: 'POST', body: { bedNumbers: ['101'] },
    })).toBeNull();
  });

  test('two calls mint two distinct temp ids', () => {
    const args = { url: '/api/ipd/wards/WARD-1/beds', method: 'POST', body: { bedNumbers: ['101'] } };
    const first  = planOfflineAddBed('addBeds', args);
    const second = planOfflineAddBed('addBeds', args);
    expect(first?.tempId).not.toBe(second?.tempId);
  });
});

describe('buildCreateOptimisticRecord', () => {
  test('PATIENT: stamps the temp id and tenantId, nulls out omitted optional fields', () => {
    const record = buildCreateOptimisticRecord('PATIENT', 'temp-p1', { fullName: 'Jane', mobileNumber: '9999999999' }, 'tenant-1');
    expect(record).toMatchObject({
      patientId: 'temp-p1', tenantId: 'tenant-1', fullName: 'Jane', mobileNumber: '9999999999',
      departmentId: null, registrationFee: null, registrationPaymentMethod: null,
    });
  });

  test('OPD_VISIT: uses the PENDING_QUEUE_NUMBER sentinel and status OPEN, never guesses departmentId', () => {
    const record = buildCreateOptimisticRecord('OPD_VISIT', 'temp-v1', { patientId: 'PAT-1', doctorIds: ['doc-1'] }, 'tenant-1');
    expect(record.visitId).toBe('temp-v1');
    expect(record.queueNumber).toBe(PENDING_QUEUE_NUMBER);
    expect(record.status).toBe('OPEN');
    expect(record.departmentId).toBeNull();
    expect(record.doctorIds).toEqual(['doc-1']);
    expect(record.vitals).toEqual({ weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null });
  });

  test('IPD_ADMISSION: status ADMITTED, empty progressNotes/vitals, never guesses departmentId', () => {
    const record = buildCreateOptimisticRecord('IPD_ADMISSION', 'temp-a1', { patientId: 'PAT-1', wardId: 'W-1', bedId: 'B-1' }, 'tenant-1');
    expect(record.admissionId).toBe('temp-a1');
    expect(record.status).toBe('ADMITTED');
    expect(record.departmentId).toBeNull();
    expect(record.progressNotes).toEqual([]);
    expect(record.dischargeDate).toBeNull();
  });

  test('MANUAL_PAYMENT: stamps the temp id and status COMPLETED, carries the reference through', () => {
    const record = buildCreateOptimisticRecord('MANUAL_PAYMENT', 'temp-pay1', {
      patientId: 'PAT-1', amount: 500, paymentMethod: 'CASH', description: 'OPD Consultation',
      referenceType: 'OPD_VISIT', referenceId: 'temp-v1',
    }, 'tenant-1');
    expect(record).toMatchObject({
      paymentId: 'temp-pay1', tenantId: 'tenant-1', patientId: 'PAT-1',
      amount: 500, paymentMethod: 'CASH', status: 'COMPLETED',
      referenceType: 'OPD_VISIT', referenceId: 'temp-v1',
    });
  });

  test('INVENTORY_ITEM: computes isLowStock exactly like inventory.service.ts (strictly-less-than, only when threshold > 0)', () => {
    const belowThreshold = buildCreateOptimisticRecord('INVENTORY_ITEM', 'temp-i1', {
      name: 'Gloves', category: 'Consumables', unit: 'box', quantity: 2, lowStockThreshold: 5,
    }, 'tenant-1');
    expect(belowThreshold).toMatchObject({ itemId: 'temp-i1', tenantId: 'tenant-1', isLowStock: true });

    // Equal to the threshold is NOT low stock — strictly-less-than only.
    const atThreshold = buildCreateOptimisticRecord('INVENTORY_ITEM', 'temp-i2', {
      name: 'Syringes', category: 'Consumables', unit: 'box', quantity: 5, lowStockThreshold: 5,
    }, 'tenant-1');
    expect(atThreshold.isLowStock).toBe(false);

    // threshold=0 means "no threshold set" — never low stock regardless of quantity.
    const noThreshold = buildCreateOptimisticRecord('INVENTORY_ITEM', 'temp-i3', {
      name: 'Bandages', category: 'Consumables', unit: 'box', quantity: 0, lowStockThreshold: 0,
    }, 'tenant-1');
    expect(noThreshold.isLowStock).toBe(false);
  });

  test('WARD: stamps the temp id, empty assignedNurseIds', () => {
    const record = buildCreateOptimisticRecord('WARD', 'temp-w1', { name: 'General Ward', floor: '2' }, 'tenant-1');
    expect(record).toMatchObject({
      wardId: 'temp-w1', name: 'General Ward', floor: '2', assignedNurseIds: [], tenantId: 'tenant-1',
    });
  });

  test('BED: stamps the temp id, wardId, never occupied', () => {
    const record = buildCreateOptimisticRecord('BED', 'temp-b1', { wardId: 'WARD-1', bedNumbers: ['101'] }, 'tenant-1');
    expect(record).toMatchObject({
      bedId: 'temp-b1', wardId: 'WARD-1', bedNumber: '101', isOccupied: false, currentAdmissionId: null, tenantId: 'tenant-1',
    });
  });

  test('PACKAGE: always status ACTIVE, matching packages.service.ts\'s createPackage', () => {
    const record = buildCreateOptimisticRecord('PACKAGE', 'temp-pkg1', {
      name: 'Basic Checkup', price: 500, includedServices: ['Consultation', 'Blood Test'],
    }, 'tenant-1');
    expect(record).toMatchObject({
      packageId: 'temp-pkg1', tenantId: 'tenant-1', name: 'Basic Checkup',
      price: 500, includedServices: ['Consultation', 'Blood Test'], status: 'ACTIVE',
    });
  });

  test('CHARGE: always status UNPAID, rounds amount to 2dp, clears testType fields for a non-lab category, stamps addedBy from userId', () => {
    const record = buildCreateOptimisticRecord('CHARGE', 'temp-c1', {
      patientId: 'PAT-1', category: 'CONSULTATION', description: 'Consult fee', amount: 499.999,
      testTypeId: 'ignored-for-non-lab', testTypeName: 'ignored-for-non-lab',
    }, 'tenant-1', 'user-1');
    expect(record).toMatchObject({
      chargeId: 'temp-c1', tenantId: 'tenant-1', patientId: 'PAT-1', category: 'CONSULTATION',
      amount: 500, status: 'UNPAID', addedBy: 'user-1', addedByName: null,
      testTypeId: null, testTypeName: null,
      paidBy: null, paidAt: null, cancelledBy: null, cancelledAt: null,
    });
  });

  test('CHARGE: keeps testTypeId/testTypeName for a LAB_TEST category', () => {
    const record = buildCreateOptimisticRecord('CHARGE', 'temp-c2', {
      patientId: 'PAT-1', category: 'LAB_TEST', description: 'CBC', amount: 300,
      testTypeId: 'TT-1', testTypeName: 'CBC',
    }, 'tenant-1', 'user-1');
    expect(record.testTypeId).toBe('TT-1');
    expect(record.testTypeName).toBe('CBC');
  });

  test('CHARGE: userId omitted (backward-compatible call site) falls back to addedBy: null rather than throwing', () => {
    const record = buildCreateOptimisticRecord('CHARGE', 'temp-c3', {
      patientId: 'PAT-1', category: 'CONSULTATION', description: 'Consult fee', amount: 100,
    }, 'tenant-1');
    expect(record.addedBy).toBeNull();
  });
});
