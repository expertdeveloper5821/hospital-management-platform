import React from 'react';
import { render, screen } from '@testing-library/react';
import { AlertBadge }     from '@/components/dashboard/AlertBadge';
import { PackageX }       from 'lucide-react';

describe('AlertBadge', () => {
  test('renders label and count', () => {
    render(<AlertBadge icon={PackageX} label="Low Stock" count={3} />);
    expect(screen.getByText('Low Stock')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('applies warning colours when warn=true and count > 0', () => {
    const { container } = render(
      <AlertBadge icon={PackageX} label="Low Stock" count={5} warn />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toMatch(/amber/);
  });

  test('does not apply warning colours when count is 0 even with warn=true', () => {
    const { container } = render(
      <AlertBadge icon={PackageX} label="Low Stock" count={0} warn />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).not.toMatch(/amber/);
  });

  test('does not apply warning colours when warn is not set', () => {
    const { container } = render(
      <AlertBadge icon={PackageX} label="Pending" count={7} />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).not.toMatch(/amber/);
  });
});
