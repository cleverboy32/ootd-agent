import { Storage } from '@google-cloud/storage';

// 1. 定义密钥文件的路径
// 我们仍然从环境变量读取，但不再是 GOOGLE_APPLICATION_CREDENTIALS
const keyFilePath = process.env.GCS_UPLOADER_KEYFILE;

// 2. 检查环境变量是否存在
if (!keyFilePath) {
  // 如果是在 Vercel 环境且配置了工作负载身份联合，则不抛出错误
  if (!process.env.GCP_WORKLOAD_IDENTITY_PROVIDER) {
    throw new Error('GCS_UPLOADER_KEYFILE environment variable is not set for local development.');
  }
}

const bucketName = process.env.GCS_BUCKET_NAME;
if (!bucketName) {
  throw new Error('GCS_BUCKET_NAME environment variable is not set.');
}

// 3. [核心修改] 显式创建 Storage 实例
// 如果 keyFilePath 存在 (本地开发)，就用它来认证。
// 如果不存在 (Vercel 环境)，构造函数为空，库会自动使用工作负载身份联合。
const storage = new Storage({
  keyFilename: keyFilePath,
});

const bucket = storage.bucket(bucketName);

/**
 * Uploads a Base64 encoded image to Google Cloud Storage.
 * (此函数的内部逻辑保持完全不变)
 * @param base64Image The Base64 encoded image data.
 * @param mimeType The MIME type of the image (e.g., 'image/png').
 * @param destinationFileName The desired file name in the bucket.
 * @returns A promise that resolves to the public URL of the uploaded file.
 */
export async function uploadImageToGCS(base64Image: string, mimeType: string, destinationFileName: string): Promise<string> {
  try {
    const buffer = Buffer.from(base64Image, 'base64');
    const file = bucket.file(destinationFileName);
    await file.save(buffer, {
      metadata: { contentType: mimeType },
    });
    return file.publicUrl();
  } catch (error) {
    console.error('Failed to upload image to GCS:', error);
    throw new Error('Image upload failed.');
  }
}