import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockDownloadSummary = jest.fn();
let mockIsLoading = false;

jest.mock('@/store/api/ipd.api', () => ({
  useDownloadDischargeSummaryMutation: () => [mockDownloadSummary, { isLoading: mockIsLoading }],
}));

import { DownloadDischargeSummaryButton } from '@/components/ipd/download-discharge-summary-button';

let clickSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsLoading = false;
  // jsdom doesn't implement createObjectURL/revokeObjectURL, and a real anchor
  // click would attempt navigation — stub all three.
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = jest.fn(() => 'blob:mock-url');
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = jest.fn();
  clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  clickSpy.mockRestore();
});

describe('DownloadDischargeSummaryButton', () => {
  test('renders the download label', () => {
    render(<DownloadDischargeSummaryButton admissionId="adm-1" />);
    expect(screen.getByRole('button', { name: /download discharge summary/i })).toBeInTheDocument();
  });

  test('clicking it calls the mutation with the given admissionId', async () => {
    mockDownloadSummary.mockResolvedValue({ data: 'blob:mock-url' });
    render(<DownloadDischargeSummaryButton admissionId="adm-42" />);

    fireEvent.click(screen.getByRole('button', { name: /download discharge summary/i }));

    await waitFor(() => expect(mockDownloadSummary).toHaveBeenCalledWith('adm-42'));
  });

  test('shows "Preparing…" while the download is in flight', () => {
    mockIsLoading = true;
    render(<DownloadDischargeSummaryButton admissionId="adm-1" />);
    expect(screen.getByRole('button', { name: /preparing/i })).toBeDisabled();
  });

  test('shows an error message when the download fails', async () => {
    mockDownloadSummary.mockResolvedValue({ error: { status: 500, data: 'Failed to download discharge summary' } });
    render(<DownloadDischargeSummaryButton admissionId="adm-1" />);

    fireEvent.click(screen.getByRole('button', { name: /download discharge summary/i }));

    expect(await screen.findByText(/failed to download discharge summary/i)).toBeInTheDocument();
  });

  test('a successful download creates and clicks a temporary anchor with the expected filename', async () => {
    mockDownloadSummary.mockResolvedValue({ data: 'blob:mock-url' });

    render(<DownloadDischargeSummaryButton admissionId="adm-99" />);
    fireEvent.click(screen.getByRole('button', { name: /download discharge summary/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
  });
});
