function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

function matchesWildcardOrigin(
  allowedOrigin: string,
  requestOrigin: string,
): boolean {
  if (!allowedOrigin.includes('*')) {
    return false;
  }

  const pattern = `^${escapeRegExp(allowedOrigin).replace(/\\\*/g, '.*')}$`;
  return new RegExp(pattern, 'i').test(requestOrigin);
}

function matchesVercelPreviewOrigin(
  allowedOrigin: string,
  requestOrigin: string,
): boolean {
  try {
    const allowedUrl = new URL(allowedOrigin);
    const requestUrl = new URL(requestOrigin);

    if (
      allowedUrl.protocol !== requestUrl.protocol ||
      !allowedUrl.hostname.endsWith('.vercel.app') ||
      !requestUrl.hostname.endsWith('.vercel.app')
    ) {
      return false;
    }

    const allowedProjectSlug = allowedUrl.hostname.replace(/\.vercel\.app$/, '');
    const requestProjectSlug = requestUrl.hostname.replace(/\.vercel\.app$/, '');

    return (
      requestProjectSlug === allowedProjectSlug ||
      requestProjectSlug.startsWith(`${allowedProjectSlug}-`)
    );
  } catch {
    return false;
  }
}

export function isAllowedOrigin(
  origin: string,
  allowedOrigins: string[],
): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedAllowedOrigins = allowedOrigins.map(normalizeOrigin);

  return normalizedAllowedOrigins.some((allowedOrigin) => {
    if (allowedOrigin === normalizedOrigin) {
      return true;
    }

    if (matchesWildcardOrigin(allowedOrigin, normalizedOrigin)) {
      return true;
    }

    return matchesVercelPreviewOrigin(allowedOrigin, normalizedOrigin);
  });
}
