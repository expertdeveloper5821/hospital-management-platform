// Runs before each worker process via jest.config.ts setupFiles.
// Sets all required env vars BEFORE any module (including config/env.ts) is loaded.
process.env.PORT                    = '3001';
process.env.NODE_ENV                = 'test';
process.env.MONGODB_URI             = 'mongodb://localhost:27017/hms-test';
process.env.JWT_SECRET              = 'test-jwt-secret-32-chars-minimum!!';
process.env.JWT_EXPIRY              = '1h';
process.env.INVITE_JWT_SECRET       = 'test-invite-secret-32-chars-min!!';
process.env.INVITE_JWT_EXPIRY       = '48h';
process.env.RESET_TOKEN_EXPIRY      = '1h';
process.env.BCRYPT_ROUNDS           = '1';
process.env.SMTP_HOST               = 'smtp.test.example.com';
process.env.SMTP_PORT               = '587';
process.env.SMTP_USER               = 'test@example.com';
process.env.SMTP_PASS               = 'test-smtp-pass';
process.env.SMTP_FROM               = 'noreply@test.example.com';
process.env.AWS_REGION              = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID       = 'AKIATEST123456789';
process.env.AWS_SECRET_ACCESS_KEY   = 'test-aws-secret-key';
process.env.S3_BUCKET_NAME          = 'test-hms-bucket';
process.env.CORS_ORIGINS            = 'http://localhost:3001';
process.env.RATE_LIMIT_WINDOW_MS    = '900000';
process.env.RATE_LIMIT_MAX_REQUESTS = '1000';
process.env.FRONTEND_URL            = 'http://localhost:3001';
