import path from 'path';

// dotenv-safe validates all required vars against .env.example at startup.
// Missing vars cause an immediate descriptive error listing all missing keys.
// SECURITY-12: SMTP_PASS, JWT_SECRET, AWS keys are NEVER logged.
require('dotenv-safe').config({
  allowEmptyValues: false,
  path: path.resolve(process.cwd(), '.env'),
  example: path.resolve(process.cwd(), '.env.example'),
});

export interface AppConfig {
  port:             number;
  nodeEnv:          'development' | 'production' | 'test';
  mongodbUri:       string;
  mongodbFallbackUri?: string;
  jwtSecret:        string;
  jwtExpiry:        string;
  inviteJwtSecret:  string;
  inviteJwtExpiry:  string;
  resetTokenExpiry: string;
  bcryptRounds:     number;
  smtp: {
    pass: string;
    from: string;
  };
  aws: {
    region:          string;
    accessKeyId:     string;
    secretAccessKey: string;
    s3BucketName:    string;
    endpoint?:       string;
  };
  corsOrigins:  string[];
  allowedOrigins: string[];
  rateLimit: {
    windowMs:    number;
    maxRequests: number;
  };
  razorpay: {
    keyId:         string;
    keySecret:     string;
    webhookSecret: string;
  };
  dashboard: {
    cacheTtlSeconds:   number;
    pollIntervalSeconds: number;
  };
}

function parseEnvList(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidEmailFrom(value?: string): boolean {
  if (!value) return false;

  const trimmed = value.trim();
  const match = trimmed.match(/<([^<>]+)>$/);
  const address = match ? match[1].trim() : trimmed;

  return isValidEmailAddress(address);
}

const smtpFrom = process.env.SMTP_FROM?.trim() ?? '';

if (!isValidEmailFrom(smtpFrom)) {
  throw new Error(
    'Invalid SMTP_FROM: expected an email address like "alerts@example.com" or "HMS <alerts@example.com>".',
  );
}

const config: AppConfig = {
  port:             parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv:          (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'],
  mongodbUri:       process.env.MONGODB_URI!,
  mongodbFallbackUri: process.env.MONGODB_FALLBACK_URI || undefined,
  jwtSecret:        process.env.JWT_SECRET!,
  jwtExpiry:        process.env.JWT_EXPIRY ?? '8h',
  inviteJwtSecret:  process.env.INVITE_JWT_SECRET!,
  inviteJwtExpiry:  process.env.INVITE_JWT_EXPIRY ?? '48h',
  resetTokenExpiry: process.env.RESET_TOKEN_EXPIRY ?? '1h',
  bcryptRounds:     parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
  smtp: {
    pass: process.env.SMTP_PASS!,
    from: smtpFrom,
  },
  aws: {
    region:          process.env.AWS_REGION!,
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    s3BucketName:    process.env.S3_BUCKET_NAME!,
    endpoint:        process.env.AWS_ENDPOINT || undefined,
  },
  allowedOrigins: Array.from(
    new Set([
      ...parseEnvList(process.env.ALLOWED_ORIGINS),
      ...parseEnvList(process.env.allowedOrigins),
      ...parseEnvList(process.env.CORS_ORIGINS),
      ...parseEnvList(process.env.FRONTEND_URL),
    ]),
  ),
  corsOrigins: parseEnvList(process.env.CORS_ORIGINS),
  rateLimit: {
    windowMs:    parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '100', 10),
  },
  razorpay: {
    keyId:         process.env.RAZORPAY_KEY_ID      ?? '',
    keySecret:     process.env.RAZORPAY_KEY_SECRET   ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
  dashboard: {
    cacheTtlSeconds:    parseInt(process.env.DASHBOARD_CACHE_TTL_SECONDS    ?? '60', 10),
    pollIntervalSeconds: parseInt(process.env.DASHBOARD_POLL_INTERVAL_SECONDS ?? '60', 10),
  },
};

// Shallow freeze prevents accidental top-level mutation at runtime
export default Object.freeze(config);
