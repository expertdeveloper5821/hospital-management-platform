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
  jwtSecret:        string;
  jwtExpiry:        string;
  inviteJwtSecret:  string;
  inviteJwtExpiry:  string;
  resetTokenExpiry: string;
  bcryptRounds:     number;
  smtp: {
    host: string;
    port: number;
    user: string;
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
}

const config: AppConfig = {
  port:             parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv:          (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'],
  mongodbUri:       process.env.MONGODB_URI!,
  jwtSecret:        process.env.JWT_SECRET!,
  jwtExpiry:        process.env.JWT_EXPIRY ?? '8h',
  inviteJwtSecret:  process.env.INVITE_JWT_SECRET!,
  inviteJwtExpiry:  process.env.INVITE_JWT_EXPIRY ?? '48h',
  resetTokenExpiry: process.env.RESET_TOKEN_EXPIRY ?? '1h',
  bcryptRounds:     parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
  smtp: {
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASS!,
    from: process.env.SMTP_FROM!,
  },
  aws: {
    region:          process.env.AWS_REGION!,
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    s3BucketName:    process.env.S3_BUCKET_NAME!,
    endpoint:        process.env.AWS_ENDPOINT || undefined,
  },
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  rateLimit: {
    windowMs:    parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '100', 10),
  },
  razorpay: {
    keyId:         process.env.RAZORPAY_KEY_ID      ?? '',
    keySecret:     process.env.RAZORPAY_KEY_SECRET   ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
};

// Shallow freeze prevents accidental top-level mutation at runtime
export default Object.freeze(config);
