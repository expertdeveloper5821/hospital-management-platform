// Fallback used only when FRONTEND_URL is not set in the environment. Points at the
// production frontend so email links are never broken; set FRONTEND_URL to override
// (e.g. http://localhost:3000 for local dev, or a custom domain in production).
const DEFAULT_FRONTEND_URL = 'https://hospital-management-platform-sakt.vercel.app';

// Resolve the frontend base URL used to build links in emails (invites, password
// resets, welcome). FRONTEND_URL may be a comma-separated allow-list of origins,
// so we always take the FIRST entry, trimmed and with any trailing slash removed —
// otherwise links come out malformed (e.g. "https://a.com,https://b.com/reset?...").
export function getFrontendBaseUrl(): string {
  const raw = process.env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL;
  return raw.split(',')[0].trim().replace(/\/+$/, '');
}
