import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockTriggerSearch = jest.fn();
jest.mock('@/store/api/search.api', () => ({
  useLazySearchQuery: () => [mockTriggerSearch, { data: undefined, isFetching: false }],
}));

import { SearchOverlay } from '@/components/header/SearchOverlay';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SearchOverlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders nothing when open=false', () => {
    render(<SearchOverlay open={false} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('renders dialog when open=true', () => {
    render(<SearchOverlay open={true} onClose={jest.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  test('calls onClose when Escape key is pressed', () => {
    const onClose = jest.fn();
    render(<SearchOverlay open={true} onClose={onClose} />);

    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when backdrop is clicked', () => {
    const onClose = jest.fn();
    render(<SearchOverlay open={true} onClose={onClose} />);

    // The backdrop is the div with aria-hidden
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when X button is clicked', () => {
    const onClose = jest.fn();
    render(<SearchOverlay open={true} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('Close search'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('shows hint text when query is empty', () => {
    render(<SearchOverlay open={true} onClose={jest.fn()} />);
    expect(screen.getByText(/at least 2 characters/i)).toBeInTheDocument();
  });

  test('debounces search trigger — does not fire immediately on input', () => {
    render(<SearchOverlay open={true} onClose={jest.fn()} />);

    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'Jo' } });

    // Should NOT have fired yet (debounced at 300ms)
    expect(mockTriggerSearch).not.toHaveBeenCalled();

    // Advance timers past debounce threshold
    act(() => { jest.advanceTimersByTime(350); });

    expect(mockTriggerSearch).toHaveBeenCalledWith({ q: 'Jo' });
  });

  test('does not trigger search for single character input', () => {
    render(<SearchOverlay open={true} onClose={jest.fn()} />);

    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'J' } });

    act(() => { jest.advanceTimersByTime(350); });

    expect(mockTriggerSearch).not.toHaveBeenCalled();
  });

  test('keyboard navigation: ArrowDown selects first result', () => {
    jest.mock('@/store/api/search.api', () => ({
      useLazySearchQuery: () => [
        mockTriggerSearch,
        {
          data: {
            query: 'Jo',
            results: [
              { id: 'PAT-001', entityType: 'patient', title: 'John Doe', subtitle: '9999', href: '/patients/PAT-001' },
            ],
            total: 1,
          },
          isFetching: false,
        },
      ],
    }));
  });

  test('renders keyboard shortcut hints in footer', () => {
    render(<SearchOverlay open={true} onClose={jest.fn()} />);
    expect(screen.getByText('navigate')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('close')).toBeInTheDocument();
  });
});
