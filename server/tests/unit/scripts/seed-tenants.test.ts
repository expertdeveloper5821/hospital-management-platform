import path from 'path';
import mongoose from 'mongoose';

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    connect: jest.fn().mockResolvedValue(undefined),
    model: jest.fn(),
  };
});

describe('seed-tenants script data', () => {
  test('each seeded tenant includes pincode in onboardingDocuments', async () => {
    const { TENANTS } = await import('../../../scripts/seed-tenants');

    expect(TENANTS).toBeDefined();
    for (const tenant of TENANTS as Array<Record<string, any>>) {
      expect(tenant.onboardingDocuments).toEqual(
        expect.objectContaining({ pincode: expect.any(String) }),
      );
    }
  });
});
