import React from 'react';
import { render, screen } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/store/api/inventory.api', () => ({
  useListInventoryItemsQuery:    () => ({ data: { data: [], total: 0, totalPages: 1 }, isFetching: false, refetch: jest.fn() }),
  useCreateInventoryItemMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateStockMutation:         () => [jest.fn(), { isLoading: false }],
  useUpdateThresholdMutation:     () => [jest.fn(), { isLoading: false }],
  useUpdateInventoryItemMutation: () => [jest.fn(), { isLoading: false }],
  useDeleteInventoryItemMutation: () => [jest.fn(), { isLoading: false }],
  useGetStockHistoryQuery:        () => ({ data: undefined, isFetching: false }),
}));

let mockRole = 'HOSPITAL_ADMIN';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import InventoryPage from '@/app/(dashboard)/inventory/page';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('InventoryPage — role access gating', () => {
  test('ADMIN can access the Inventory page and sees the Add Item action', () => {
    mockRole = 'ADMIN';
    render(<InventoryPage />);
    expect(screen.queryByText(/you do not have access to the inventory module/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument();
  });

  test('HOSPITAL_ADMIN can still access the Inventory page (unchanged)', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<InventoryPage />);
    expect(screen.queryByText(/you do not have access to the inventory module/i)).not.toBeInTheDocument();
  });

  test('RECEPTIONIST still has no Inventory page access (unchanged)', () => {
    mockRole = 'RECEPTIONIST';
    render(<InventoryPage />);
    expect(screen.getByText(/you do not have access to the inventory module/i)).toBeInTheDocument();
  });
});
