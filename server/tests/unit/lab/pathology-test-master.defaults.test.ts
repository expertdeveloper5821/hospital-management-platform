import { PATHOLOGY_TEST_MASTER_SEEDS } from '../../../src/modules/lab/pathology-test-master.defaults';
import { PATHOLOGY_REPORT_TEMPLATES, GENERIC_TEMPLATE_KEY } from '../../../src/modules/lab/pathology-report-templates';

describe('Pathology Test Master seeds', () => {
  test('one seed per catalog test, plus GENERIC, with unique keys', () => {
    const keys = PATHOLOGY_TEST_MASTER_SEEDS.map((s) => s.templateKey);
    expect(keys).toEqual([...PATHOLOGY_REPORT_TEMPLATES.map((t) => t.key), GENERIC_TEMPLATE_KEY]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('every catalog test has a clinical note; only the screening serologies have a comment', () => {
    const catalog = PATHOLOGY_TEST_MASTER_SEEDS.filter((s) => s.templateKey !== GENERIC_TEMPLATE_KEY);
    expect(catalog.every((s) => !!s.clinicalNote?.trim())).toBe(true);
    expect(PATHOLOGY_TEST_MASTER_SEEDS.filter((s) => s.comment).map((s) => s.templateKey).sort())
      .toEqual(['ANTI_HCV', 'HBSAG', 'HIV']);
    expect(PATHOLOGY_TEST_MASTER_SEEDS.every((s) => !!s.correlateClinically.trim())).toBe(true);
  });

  test('texts fit the PDF font (Latin-1 only) and the API length limits', () => {
    for (const s of PATHOLOGY_TEST_MASTER_SEEDS) {
      for (const text of [s.clinicalNote, s.comment, s.correlateClinically]) {
        if (text === null) continue;
        expect({ key: s.templateKey, latin1: /^[\x20-\xFF]*$/.test(text) }).toEqual({ key: s.templateKey, latin1: true });
      }
      expect((s.clinicalNote ?? '').length).toBeLessThanOrEqual(2000);
      expect((s.comment ?? '').length).toBeLessThanOrEqual(2000);
      expect(s.correlateClinically.length).toBeLessThanOrEqual(1000);
    }
  });
});
