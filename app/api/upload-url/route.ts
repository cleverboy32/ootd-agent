import { NextRequest, NextResponse } from 'next/server';
import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';

// Use the same authentication method as gcs-service.ts
const keyFilePath = process.env.GCS_UPLOADER_KEYFILE;
const storage = new Storage({
  keyFilename: keyFilePath,
});

const bucketName = process.env.GCS_BUCKET_NAME;

if (!bucketName) {
  throw new Error('GCS_BUCKET_NAME environment variable is not set.');
}

/**
 * Handles GET requests to generate a signed URL for client-side uploads.
 * Expects 'fileType' and 'conversationId' as query parameters.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fileType = searchParams.get('fileType');
  const clientId = searchParams.get('clientId'); 

  if (!fileType || !clientId) { // --- [修改] --- 检查 clientId
    return NextResponse.json({ error: 'fileType and clientId are required' }, { status: 400 });
  }

  // Basic validation for MIME type
  if (!fileType.startsWith('image/')) {
    return NextResponse.json({ error: 'Only image uploads are allowed' }, { status: 400 });
  }

  try {
    const extension = fileType.split('/')[1] || 'bin';
    const fileName = `user-uploads/${clientId}/${uuidv4()}.${extension}`; 

    const options = {
      version: 'v4' as const,
      action: 'write' as const,
      expires: Date.now() + 15 * 60 * 1000, // URL expires in 15 minutes
      contentType: fileType,
    };

    // Generate the signed URL
    const [signedUrl] = await storage.bucket(bucketName).file(fileName).getSignedUrl(options);

    // Return both the URL to upload to, and the final public URL for access
    return NextResponse.json({
      signedUrl,
      publicUrl: `https://storage.googleapis.com/${bucketName}/${fileName}`
    });

  } catch (error) {
    console.error('Failed to create signed URL:', error);
    return NextResponse.json({ error: 'Internal Server Error while creating signed URL' }, { status: 500 });
  }
}
