import { NextResponse } from 'next/server';
import { getTransportPublicKey } from '@/server/auth/transportCrypto';

/** 登录/注册提交前取 RSA 公钥。私钥不出进程。 */
export function GET() {
  try {
    return NextResponse.json(getTransportPublicKey(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[AUTH_TRANSPORT_KEY]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
