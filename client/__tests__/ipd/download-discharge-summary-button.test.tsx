import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockDownloadSummary = jest.fn();
const mockPrintSummary = jest.fn();
let mockIsLoading = false;
let mockPrintLoading = false;

jest.mock('@/store/api/ipd.api', () => ({
  useDownloadDischargeSummaryMutation: () => [mockDownloadSummary, { isLoading: mockIsLoading }],
  usePrintDischargeSummaryMutation:    () => [mockPrintSummary, { isLoading: mockPrintLoading }],
}));

import { DownloadDischargeSummaryButton } from '@/components/ipd/download-discharge-summary-button';

let clickSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsLoading = false;
  mockPrintLoading = false;
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

  test('shows "Preparing…" while the download is in flight, and disables Print too', () => {
    mockIsLoading = true;
    render(<DownloadDischargeSummaryButton admissionId="adm-1" />);
    expect(screen.getByRole('button', { name: /preparing/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /print discharge summary/i })).toBeDisabled();
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

  test('renders a Print option next to Download', () => {
    render(<DownloadDischargeSummaryButton admissionId="adm-1" />);
    expect(screen.getByRole('button', { name: /print discharge summary/i })).toBeInTheDocument();
  });

  test('Print loads the print copy and hosts it in a hidden iframe (no download anchor)', async () => {
    mockPrintSummary.mockResolvedValue({ data: 'blob:print-url' });
    render(<DownloadDischargeSummaryButton admissionId="adm-7" />);

    fireEvent.click(screen.getByRole('button', { name: /print discharge summary/i }));

    await waitFor(() => expect(mockPrintSummary).toHaveBeenCalledWith('adm-7'));
    await waitFor(() => expect(document.querySelector('iframe[src="blob:print-url"]')).not.toBeNull());
    expect(mockDownloadSummary).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  test('shows an error message when loading the print copy fails', async () => {
    mockPrintSummary.mockResolvedValue({ error: { status: 500, data: 'Failed to load discharge summary' } });
    render(<DownloadDischargeSummaryButton admissionId="adm-1" />);

    fireEvent.click(screen.getByRole('button', { name: /print discharge summary/i }));

    expect(await screen.findByText(/failed to load discharge summary for printing/i)).toBeInTheDocument();
  });
});
