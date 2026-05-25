import mongoose from 'mongoose';
import config from './env';

// SECURITY-03: MongoDB URI is NEVER logged (may contain credentials).
// Log only connection state changes.

function isSrvLookupError(error: unknown): error is Error {
  return error instanceof Error
    && /querySrv/i.test(error.message);
}

function buildMongoConnectionHelp(): string {
  const help = [
    'MongoDB SRV DNS lookup failed.',
    'This usually means the machine DNS or router is blocking Atlas SRV lookups for mongodb+srv:// URIs.',
  ];

  if (config.mongodbFallbackUri) {
    help.push('Retrying with MONGODB_FALLBACK_URI.');
  } else {
    help.push('Set MONGODB_FALLBACK_URI to the standard non-SRV Atlas connection string from the MongoDB Atlas dashboard.');
  }

  return help.join(' ');
}

export async function connectDatabase(): Promise<void> {
  const options: mongoose.ConnectOptions = {
    maxPoolSize:                  10,
    serverSelectionTimeoutMS:     5000,
    socketTimeoutMS:              45000,
    // autoIndex disabled in production — indexes managed via Atlas UI / migration scripts
    autoIndex: config.nodeEnv !== 'production',
  };

  mongoose.connection.on('connected',    () => console.log(JSON.stringify({ level: 'info',  event: 'db_connected',    timestamp: new Date().toISOString() })));
  mongoose.connection.on('disconnected', () => console.warn(JSON.stringify({ level: 'warn',  event: 'db_disconnected', timestamp: new Date().toISOString() })));
  mongoose.connection.on('reconnected',  () => console.log(JSON.stringify({ level: 'info',  event: 'db_reconnected',  timestamp: new Date().toISOString() })));
  mongoose.connection.on('error',        (err: Error) => console.error(JSON.stringify({ level: 'error', event: 'db_error', message: err.message, timestamp: new Date().toISOString() })));

  try {
    await mongoose.connect(config.mongodbUri, options);
  } catch (error) {
    if (!isSrvLookupError(error)) {
      throw error;
    }

    console.error(JSON.stringify({
      level: 'error',
      event: 'db_dns_resolution_failed',
      message: buildMongoConnectionHelp(),
      timestamp: new Date().toISOString(),
    }));

    if (!config.mongodbFallbackUri) {
      throw error;
    }

    await mongoose.connect(config.mongodbFallbackUri, options);
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
  console.log(JSON.stringify({ level: 'info', event: 'db_closed', timestamp: new Date().toISOString() }));
}
