import mongoose from 'mongoose';
import { ServiceUnavailableError } from '../middleware/error-handler';

/**
 * Pre-flight check before any DB operation.
 * Throws ServiceUnavailableError (503) if Mongoose is not connected.
 * Used as the first line of every repository method.
 * SECURITY-15: Fail closed — deny DB access rather than risk partial operations.
 */
export function assertDbConnected(): void {
  if (mongoose.connection.readyState !== 1) {
    throw new ServiceUnavailableError(
      'Database temporarily unavailable — please retry shortly',
    );
  }
}
