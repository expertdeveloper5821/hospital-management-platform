import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mock RTK Query hooks ─────────────────────────────────────────────────────

const mockUpdateTitle  = jest.fn();
const mockUploadLogo   = jest.fn();
const mockUploadFavicon = jest.fn();

jest.mock('@/store/api/platformSettings.api', () => ({
  useGetPlatformSettingsQuery:    jest.fn(),
  useUpdatePlatformTitleMutation: jest.fn(),
  useUploadPlatformLogoMutation:  jest.fn(),
  useUploadPlatformFaviconMutation: jest.fn(),
}));

import {
  useGetPlatformSettingsQuery,
  useUpdatePlatformTitleMutation,
  useUploadPlatformLogoMutation,
  useUploadPlatformFaviconMutation,
} from '@/store/api/platformSettings.api';

// Mock UI primitives used in the page
jest.mock('@/components/ui/button',   () => ({ Button: ({ children, onClick, disabled }: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean }>) => <button onClick={onClick} disabled={disabled}>{children}</button> }));
jest.mock('@/components/ui/input',    () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
jest.mock('@/components/ui/label',    () => ({ Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label> }));
jest.mock('@/components/ui/card',     () => ({
  Card:            ({ children }: React.PropsWithChildren) => <div data-testid="card">{children}</div>,
  CardHeader:      ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  CardContent:     ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  CardTitle:       ({ children }: React.PropsWithChildren) => <h3>{children}</h3>,
  CardDescription: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
}));

import PlatformSettingsPage from '@/app/(dashboard)/super-admin/platform-settings/page';

const DEFAULTS = {
  logoUrl:       null,
  faviconUrl:    null,
  platformTitle: 'MediCore HMS',
  updatedAt:     null,
};

function setupMocks(overrides: Partial<typeof DEFAULTS> = {}) {
  (useGetPlatformSettingsQuery as jest.Mock).mockReturnValue({
    data: { ...DEFAULTS, ...overrides },
    isLoading: false,
    isError:   false,
  });
  (useUpdatePlatformTitleMutation as jest.Mock).mockReturnValue([mockUpdateTitle, { isLoading: false }]);
  (useUploadPlatformLogoMutation  as jest.Mock).mockReturnValue([mockUploadLogo,  { isLoading: false }]);
  (useUploadPlatformFaviconMutation as jest.Mock).mockReturnValue([mockUploadFavicon, { isLoading: false }]);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Loading state ────────────────────────────────────────────────────────────

test('shows loading spinner while data is loading', () => {
  (useGetPlatformSettingsQuery as jest.Mock).mockReturnValue({ isLoading: true, isError: false });
  (useUpdatePlatformTitleMutation  as jest.Mock).mockReturnValue([jest.fn(), {}]);
  (useUploadPlatformLogoMutation   as jest.Mock).mockReturnValue([jest.fn(), {}]);
  (useUploadPlatformFaviconMutation as jest.Mock).mockReturnValue([jest.fn(), {}]);
  render(<PlatformSettingsPage />);
  expect(screen.getByText(/loading settings/i)).toBeInTheDocument();
});

// ─── Error state ──────────────────────────────────────────────────────────────

test('shows error message when fetch fails', () => {
  (useGetPlatformSettingsQuery as jest.Mock).mockReturnValue({ isLoading: false, isError: true, data: undefined });
  (useUpdatePlatformTitleMutation  as jest.Mock).mockReturnValue([jest.fn(), {}]);
  (useUploadPlatformLogoMutation   as jest.Mock).mockReturnValue([jest.fn(), {}]);
  (useUploadPlatformFaviconMutation as jest.Mock).mockReturnValue([jest.fn(), {}]);
  render(<PlatformSettingsPage />);
  expect(screen.getByText(/failed to load platform settings/i)).toBeInTheDocument();
});

// ─── Title section ────────────────────────────────────────────────────────────

describe('Title section', () => {
  test('renders current title in input', () => {
    setupMocks({ platformTitle: 'Sunrise Hospital' });
    render(<PlatformSettingsPage />);
    expect(screen.getByDisplayValue('Sunrise Hospital')).toBeInTheDocument();
  });

  test('Save Title button is disabled when title is unchanged', () => {
    setupMocks({ platformTitle: 'MediCore HMS' });
    render(<PlatformSettingsPage />);
    const btn = screen.getByRole('button', { name: /save title/i });
    expect(btn).toBeDisabled();
  });

  test('shows inline error when blank title is submitted', async () => {
    setupMocks();
    render(<PlatformSettingsPage />);
    const input = screen.getByDisplayValue('MediCore HMS');
    await userEvent.clear(input);
    const btn = screen.getByRole('button', { name: /save title/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByText(/platform title is required/i)).toBeInTheDocument(),
    );
    expect(mockUpdateTitle).not.toHaveBeenCalled();
  });

  test('calls updateTitle mutation with trimmed value', async () => {
    mockUpdateTitle.mockReturnValue({ unwrap: () => Promise.resolve() });
    setupMocks({ platformTitle: 'MediCore HMS' });
    render(<PlatformSettingsPage />);
    const input = screen.getByDisplayValue('MediCore HMS');
    await userEvent.clear(input);
    await userEvent.type(input, 'New Name');
    const btn = screen.getByRole('button', { name: /save title/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockUpdateTitle).toHaveBeenCalledWith({ platformTitle: 'New Name' }),
    );
  });
});

// ─── Logo section ─────────────────────────────────────────────────────────────

describe('Logo section', () => {
  test('shows placeholder when no logo is set', () => {
    setupMocks({ logoUrl: null });
    render(<PlatformSettingsPage />);
    expect(screen.queryByRole('img', { name: /platform logo/i })).not.toBeInTheDocument();
  });

  test('shows logo img when logoUrl is present', () => {
    setupMocks({ logoUrl: 'https://s3.test/logo.png' });
    render(<PlatformSettingsPage />);
    const img = screen.getByRole('img', { name: /platform logo/i });
    expect(img).toHaveAttribute('src', 'https://s3.test/logo.png');
  });

  test('shows inline error for wrong file type', async () => {
    setupMocks();
    render(<PlatformSettingsPage />);
    const fileInput = document.querySelector('input[type="file"][accept*="image/jpeg"]') as HTMLInputElement;
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], 'test.gif', { type: 'image/gif' });
    // Use fireEvent.change so the non-matching type bypasses accept-attribute filtering
    Object.defineProperty(fileInput, 'files', { value: [gif], configurable: true });
    fireEvent.change(fileInput);
    await waitFor(() =>
      expect(screen.getByText(/logo must be jpeg, png, svg, or webp/i)).toBeInTheDocument(),
    );
    expect(mockUploadLogo).not.toHaveBeenCalled();
  });

  test('shows inline error when logo exceeds 2 MB', async () => {
    setupMocks();
    render(<PlatformSettingsPage />);
    const fileInput = document.querySelector('input[type="file"][accept*="image/jpeg"]') as HTMLInputElement;
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await userEvent.upload(fileInput, big);
    await waitFor(() =>
      expect(screen.getByText(/logo must not exceed 2 mb/i)).toBeInTheDocument(),
    );
    expect(mockUploadLogo).not.toHaveBeenCalled();
  });

  test('calls uploadLogo mutation with FormData for valid file', async () => {
    mockUploadLogo.mockReturnValue({ unwrap: () => Promise.resolve() });
    setupMocks();
    render(<PlatformSettingsPage />);
    const fileInput = document.querySelector('input[type="file"][accept*="image/jpeg"]') as HTMLInputElement;
    const png = new File([new Uint8Array(8)], 'logo.png', { type: 'image/png' });
    await userEvent.upload(fileInput, png);
    await waitFor(() => expect(mockUploadLogo).toHaveBeenCalled());
    const formData: FormData = mockUploadLogo.mock.calls[0][0];
    expect(formData.get('logo')).toBe(png);
  });
});

// ─── Favicon section ──────────────────────────────────────────────────────────

describe('Favicon section', () => {
  test('shows placeholder when no favicon is set', () => {
    setupMocks({ faviconUrl: null });
    render(<PlatformSettingsPage />);
    expect(screen.queryByRole('img', { name: /platform favicon/i })).not.toBeInTheDocument();
  });

  test('shows favicon img when faviconUrl is present', () => {
    setupMocks({ faviconUrl: 'https://s3.test/favicon.ico' });
    render(<PlatformSettingsPage />);
    const img = screen.getByRole('img', { name: /platform favicon/i });
    expect(img).toHaveAttribute('src', 'https://s3.test/favicon.ico');
  });

  test('shows inline error for wrong file type', async () => {
    setupMocks();
    render(<PlatformSettingsPage />);
    const fileInput = document.querySelector('input[type="file"][accept*="image/x-icon"]') as HTMLInputElement;
    const jpeg = new File([new Uint8Array([0xff, 0xd8])], 'test.jpg', { type: 'image/jpeg' });
    // Use fireEvent.change so the non-matching type bypasses accept-attribute filtering
    Object.defineProperty(fileInput, 'files', { value: [jpeg], configurable: true });
    fireEvent.change(fileInput);
    await waitFor(() =>
      expect(screen.getByText(/favicon must be ico or png/i)).toBeInTheDocument(),
    );
    expect(mockUploadFavicon).not.toHaveBeenCalled();
  });

  test('shows inline error when favicon exceeds 500 KB', async () => {
    setupMocks();
    render(<PlatformSettingsPage />);
    const fileInput = document.querySelector('input[type="file"][accept*="image/x-icon"]') as HTMLInputElement;
    const big = new File([new Uint8Array(500 * 1024 + 1)], 'big.ico', { type: 'image/x-icon' });
    await userEvent.upload(fileInput, big);
    await waitFor(() =>
      expect(screen.getByText(/favicon must not exceed 500 kb/i)).toBeInTheDocument(),
    );
    expect(mockUploadFavicon).not.toHaveBeenCalled();
  });

  test('calls uploadFavicon mutation with FormData for valid ICO', async () => {
    mockUploadFavicon.mockReturnValue({ unwrap: () => Promise.resolve() });
    setupMocks();
    render(<PlatformSettingsPage />);
    const fileInput = document.querySelector('input[type="file"][accept*="image/x-icon"]') as HTMLInputElement;
    const ico = new File([new Uint8Array(8)], 'favicon.ico', { type: 'image/x-icon' });
    await userEvent.upload(fileInput, ico);
    await waitFor(() => expect(mockUploadFavicon).toHaveBeenCalled());
    const formData: FormData = mockUploadFavicon.mock.calls[0][0];
    expect(formData.get('favicon')).toBe(ico);
  });
});
