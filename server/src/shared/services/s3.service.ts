import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from '../config/env';
import { AppError } from '../middleware/error-handler';
import { getCorrelationId } from '../config/request-context';

// TODO(scale): Add deleteFile() and copyFile() methods in later units as needed.

class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    // S3-05: AWS credentials from config — NEVER hardcoded (SECURITY-12)
    // forcePathStyle is required for LocalStack (and any custom-endpoint S3-compatible store).
    this.client = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId:     config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
      ...(config.aws.endpoint && {
        endpoint:       config.aws.endpoint,
        forcePathStyle: true,
      }),
    });
    this.bucket = config.aws.s3BucketName;
  }

  /**
   * Upload a file to S3.
   * S3-02: Returns the S3 key on success.
   * S3-04: Bucket has public access blocked — all access via pre-signed URLs.
   * SECURITY-01: SSE-S3 (AES-256) applied to every upload.
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket:               this.bucket,
          Key:                  key,
          Body:                 buffer,
          ContentType:          mimeType,
          ServerSideEncryption: 'AES256',
        }),
      );
      return key;
    } catch (err) {
      console.error(JSON.stringify({
        level:         'error',
        event:         's3_upload_failure',
        correlationId: getCorrelationId(),
        key,
        message:       (err as Error).message,
        timestamp:     new Date().toISOString(),
      }));
      throw new AppError('File upload failed. Please try again.', 500);
    }
  }

  /**
   * Generate a pre-signed GET URL for a stored file.
   * S3-03: Returns a time-limited URL; never exposes the bucket directly.
   * Default expiry per NFR-09: logos/medical-cards/receipts = 86400s, reports = 3600s.
   */
  async getPresignedUrl(key: string, expirySeconds: number): Promise<string> {
    try {
      return await getSignedUrl(
        // Render can resolve duplicate Smithy type packages during install, which makes
        // the presigner's client constraint incompatible with the S3Client instance at
        // compile time even though the runtime object is valid.
        this.client as Parameters<typeof getSignedUrl>[0],
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: expirySeconds },
      );
    } catch (err) {
      console.error(JSON.stringify({
        level:         'error',
        event:         's3_presign_failure',
        correlationId: getCorrelationId(),
        key,
        message:       (err as Error).message,
        timestamp:     new Date().toISOString(),
      }));
      throw new AppError('Failed to generate download URL. Please try again.', 500);
    }
  }
}

export const s3Service = new S3Service();
