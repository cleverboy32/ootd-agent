import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { uploadObjectToCOS } from '@/server/services/cos';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const clientId = req.headers.get('x-client-id');
  if (!clientId) {
    return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image uploads are allowed' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413 });
    }

    const extension = file.type.split('/')[1] || 'bin';
    const relativeKey = `user-uploads/${clientId}/${uuidv4()}.${extension}`;
    const readStartedAt = Date.now();
    const buffer = Buffer.from(await file.arrayBuffer());
    const readMs = Date.now() - readStartedAt;
    const cosStartedAt = Date.now();
    const publicUrl = await uploadObjectToCOS(buffer, file.type, relativeKey);
    const cosMs = Date.now() - cosStartedAt;

    console.log('[API /api/upload] timing', JSON.stringify({
      outcome: 'success',
      ms: { read_file: readMs, cos_upload: cosMs, total: Date.now() - startedAt },
      bytes: buffer.length,
    }));

    return NextResponse.json({ publicUrl });
  } catch (error) {
    console.log('[API /api/upload] timing', JSON.stringify({
      outcome: 'error',
      ms: { total: Date.now() - startedAt },
    }));
    console.error('[API /api/upload]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
