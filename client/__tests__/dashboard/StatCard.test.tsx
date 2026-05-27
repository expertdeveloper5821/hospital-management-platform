import React from 'react';
import { render, screen } from '@testing-library/react';
import { StatCard }       from '@/components/dashboard/StatCard';
import { Users }          from 'lucide-react';

describe('StatCard', () => {
  test('renders label, value, and context', () => {
    render(
      <StatCard icon={Users} label="Total Patients" value={42} context="registered" />,
    );
    expect(screen.getByText('Total Patients')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('registered')).toBeInTheDocument();
  });

  test('formats large numbers with Indian locale separators', () => {
    render(<StatCard icon={Users} label="Revenue" value={1500000} />);
    // 1,500,000 in en-IN: 15,00,000
    expect(screen.getByText('15,00,000')).toBeInTheDocument();
  });

  test('renders string values as-is', () => {
    render(<StatCard icon={Users} label="Revenue" value="₹2,500" />);
    expect(screen.getByText('₹2,500')).toBeInTheDocument();
  });

  test('omits context text when context is not provided', () => {
    render(<StatCard icon={Users} label="Patients" value={10} />);
    // The value "10" renders in a <p>, but no secondary context <p> should appear
    expect(screen.queryByText('registered in your hospital')).not.toBeInTheDocument();
    expect(screen.queryByText('registered')).not.toBeInTheDocument();
  });

  test('skeleton variant renders shimmer placeholders without a value', () => {
    const { container } = render(
      <StatCard icon={Users} label="" value="" skeleton />,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    // Skeleton should not render any text value
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
