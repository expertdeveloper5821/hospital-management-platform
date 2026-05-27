import React from 'react';
import { render, screen } from '@testing-library/react';
import { TrendChart }     from '@/components/dashboard/TrendChart';

// Recharts uses ResizeObserver which is not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe()    { /* noop */ }
  unobserve()  { /* noop */ }
  disconnect() { /* noop */ }
};

describe('TrendChart', () => {
  const sampleData = [
    { date: '2026-05-01', value: 4 },
    { date: '2026-05-02', value: 7 },
    { date: '2026-05-03', value: 2 },
  ];

  test('renders chart title', () => {
    render(<TrendChart title="OPD Visits — Last 30 Days" data={sampleData} />);
    expect(screen.getByText('OPD Visits — Last 30 Days')).toBeInTheDocument();
  });

  test('renders "no data" message when data is empty', () => {
    render(<TrendChart title="OPD" data={[]} />);
    expect(screen.getByText(/No data for the last 30 days/i)).toBeInTheDocument();
  });

  test('loading variant renders shimmer placeholder', () => {
    const { container } = render(
      <TrendChart title="OPD" data={[]} loading />,
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText(/No data/i)).not.toBeInTheDocument();
  });

  test('renders chart container when data is present', () => {
    const { container } = render(
      <TrendChart title="OPD" data={sampleData} />,
    );
    // ResponsiveContainer renders an svg or div wrapper
    expect(container.querySelector('.recharts-responsive-container, svg')).toBeTruthy();
  });
});
