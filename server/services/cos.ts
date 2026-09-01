import COS from 'cos-nodejs-sdk-v5';

interface CosConfig {
  bucket: string;
  region: string;
  keyPrefix: string;
  publicBaseUrl: string;
}

let cosClient: COS | null = null;
let uploadChain: Promise<unknown> = Promise.resolve();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} environment variable is not set.`);
  return value;
}

function normalizeKeyPart(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

export function getCosConfig(): CosConfig {
  return {
    bucket: requiredEnv('COS_BUCKET'),
    region: requiredEnv('COS_REGION'),
    keyPrefix: normalizeKeyPart(process.env.COS_KEY_PREFIX?.trim() || ''),
    publicBaseUrl: requiredEnv('COS_PUBLIC_BASE_URL').replace(/\/+$/, ''),
  };
}

function getCosClient(): COS {
  if (!cosClient) {
    cosClient = new COS({
      SecretId: requiredEnv('COS_SECRET_ID'),
      SecretKey: requiredEnv('COS_SECRET_KEY'),
    });
  }
  return cosClient;
}

export function buildCosObjectKey(relativeKey: string): string {
  const { keyPrefix } = getCosConfig();
  return [keyPrefix, normalizeKeyPart(relativeKey)].filter(Boolean).join('/');
}

export function getCosPublicUrl(key: string): string {
  const { publicBaseUrl } = getCosConfig();
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${publicBaseUrl}/${encodedKey}`;
}

export function createCosPutUrl(
  key: string,
  contentType: string,
  expiresSeconds = 15 * 60
): string {
  const { bucket, region } = getCosConfig();
  return getCosClient().getObjectUrl({
    Bucket: bucket,
    Region: region,
    Key: key,
    Sign: true,
    Method: 'PUT',
    Protocol: 'https:',
    Expires: expiresSeconds,
    Headers: { 'Content-Type': contentType },
  });
}

function enqueueUpload<T>(operation: () => Promise<T>): Promise<T> {
  const result = uploadChain.then(operation, operation);
  uploadChain = result.catch(() => {});
  return result;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function uploadObjectToCOS(
  body: Buffer,
  mimeType: string,
  relativeKey: string
): Promise<string> {
  return enqueueUpload(async () => {
    const config = getCosConfig();
    const key = buildCosObjectKey(relativeKey);
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        await getCosClient().putObject({
          Bucket: config.bucket,
          Region: config.region,
          Key: key,
          Body: body,
          ContentType: mimeType,
          ContentLength: body.byteLength,
        });
        return getCosPublicUrl(key);
      } catch (error) {
        const message = getErrorMessage(error);
        console.error(
          `[COS] Upload attempt ${attempt + 1}/${maxRetries} failed for ${key}: ${message}`
        );
        if (attempt === maxRetries - 1) {
          throw new Error(`COS upload failed: ${message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }

    throw new Error('COS upload failed.');
  });
}

export async function uploadImageToCOS(
  base64Image: string,
  mimeType: string,
  relativeKey: string
): Promise<string> {
  return uploadObjectToCOS(Buffer.from(base64Image, 'base64'), mimeType, relativeKey);
}
