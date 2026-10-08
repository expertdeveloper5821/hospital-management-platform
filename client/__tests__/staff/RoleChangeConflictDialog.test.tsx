import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RoleChangeConflictDialog, type RoleChangeConflict } from '@/components/staff/RoleChangeConflictDialog';

// Focused component tests for the generic conflict dialog — the admin page
// tests cover the 409 → dialog binding; these cover the payload → rows
// rendering contract (labels, breakdown, unpaid flag, fail-visible fallback
// for unrecognized fields, a11y and dismissal).

const baseConflict = (overrides: Partial<RoleChangeConflict> = {}): RoleChangeConflict => ({
  userName:      'Test User',
  code:          'NURSE_ACTIVE_ENTRIES',
  message:       'Cannot change role: Test User still has active duty entries.',
  details:       { code: 'NURSE_ACTIVE_ENTRIES', activeEntries: 5, breakdown: { opd: 3, ipd: 2 }, userId: 'u-1', currentRole: 'NURSE', requestedRole: 'RECEPTIONIST' },
  requestedRole: 'RECEPTIONIST',
  ...overrides,
});

describe('RoleChangeConflictDialog', () => {
  test('renders user, roles, code and labelled detail rows', () => {
    render(<RoleChangeConflictDialog conflict={baseConflict()} onClose={() => {}} />);

    const dialog = screen.getByRole('dialog', { name: /role change blocked/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain('Test User');
    expect(dialog.textContent).toContain('NURSE');
    expect(dialog.textContent).toContain('RECEPTIONIST');
    expect(screen.getByTestId('conflict-code').textContent).toBe('NURSE_ACTIVE_ENTRIES');
    expect(dialog.textContent).toContain('Active duty entries');
    expect(dialog.textContent).toContain('5');
    expect(dialog.textContent).toContain('OPD 3 · IPD 2');
  });

  test('deactivation blocks show "cannot be deactivated" (no requested role)', () => {
    render(
      <RoleChangeConflictDialog
        conflict={baseConflict({
          code:          'WARD_ROSTER_CONFLICT',
          requestedRole: null,
          details:       { code: 'WARD_ROSTER_CONFLICT', activeWards: 2, userId: 'u-1', currentRole: 'NURSE' },
        })}
        onClose={() => {}}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /role change blocked/i });
    expect(dialog.textContent).toContain('cannot be deactivated');
    expect(dialog.textContent).toContain('Active ward rosters');
    expect(dialog.textContent).toContain('2');
  });

  test('booleans render as Yes/No (unpaidPayment)', () => {
    render(
      <RoleChangeConflictDialog
        conflict={baseConflict({
          code:    'PATHOLOGY_ACTIVE_REQUEST',
          details: { code: 'PATHOLOGY_ACTIVE_REQUEST', activeRequests: 1, unpaidPayment: true, userId: 'u-1', currentRole: 'PATHOLOGIST', requestedRole: 'NURSE' },
        })}
        onClose={() => {}}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /role change blocked/i });
    expect(dialog.textContent).toContain('Any active request unpaid');
    expect(dialog.textContent).toContain('Yes');
  });

  test('fail-visible: unrecognized primitive details are still rendered', () => {
    render(
      <RoleChangeConflictDialog
        conflict={baseConflict({
          code:    'FUTURE_CODE',
          details: { code: 'FUTURE_CODE', someNewField: 'new-backend-value', userId: 'u-1', currentRole: 'STAFF', requestedRole: 'RECEPTIONIST' },
        })}
        onClose={() => {}}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /role change blocked/i });
    expect(dialog.textContent).toContain('FUTURE_CODE');
    expect(dialog.textContent).toContain('new-backend-value');
  });

  test('Escape closes the dialog', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<RoleChangeConflictDialog conflict={baseConflict()} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Close button focuses first and closes on click', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(<RoleChangeConflictDialog conflict={baseConflict()} onClose={onClose} />);

    const close = screen.getAllByRole('button', { name: /^close$/i })[0];
    expect(close).toHaveFocus();
    await user.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
