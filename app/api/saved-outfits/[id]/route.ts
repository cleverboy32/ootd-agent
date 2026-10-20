import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/currentUser';
import prismadb from '@/server/db';

type RouteParams = { params: Promise<{ id: string }> };

/** DELETE：取消收藏（仅本人） */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: '缺少 id', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const row = await prismadb.savedOutfit.findUnique({ where: { id } });
    if (!row || row.userId !== user.id) {
      return NextResponse.json({ error: '收藏不存在', code: 'NOT_FOUND' }, { status: 404 });
    }

    await prismadb.savedOutfit.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[SAVED_OUTFITS_DELETE]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
