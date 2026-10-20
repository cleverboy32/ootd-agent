import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { getSessionUser } from '@/server/auth/currentUser';
import prismadb from '@/server/db';
import {
  extractImageStates,
  extractStylistCache,
} from '@/server/utils/messageContent';
import { buildSavedOutfitFromCache } from '@/server/utils/savedOutfitSnapshot';

function serializeSavedOutfit(row: {
  id: string;
  userId: string;
  sourceMessageId: string | null;
  sourceConversationId: string | null;
  sourceOutfitId: string;
  title: string;
  coverImageUrl: string | null;
  snapshot: unknown;
  eligibleForPlan: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    sourceMessageId: row.sourceMessageId,
    sourceConversationId: row.sourceConversationId,
    sourceOutfitId: row.sourceOutfitId,
    title: row.title,
    coverImageUrl: row.coverImageUrl,
    snapshot: row.snapshot,
    eligibleForPlan: row.eligibleForPlan,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** GET：当前用户收藏列表；?eligibleForPlan=true 仅可托管抽取项；?limit=n 最近 n 条 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const eligibleOnly = req.nextUrl.searchParams.get('eligibleForPlan') === 'true';
  const limitRaw = req.nextUrl.searchParams.get('limit');
  const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 0, 1), 100) : undefined;

  try {
    const rows = await prismadb.savedOutfit.findMany({
      where: {
        userId: user.id,
        ...(eligibleOnly ? { eligibleForPlan: true } : {}),
      },
      orderBy: { createdAt: 'desc' },
      ...(limit ? { take: limit } : {}),
    });
    return NextResponse.json({ items: rows.map(serializeSavedOutfit) });
  } catch (error) {
    console.error('[SAVED_OUTFITS_GET]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

interface SaveBody {
  sourceMessageId?: unknown;
  sourceOutfitId?: unknown;
}

/**
 * POST：收藏方案（幂等）。
 * Body: { sourceMessageId, sourceOutfitId }
 * 服务端从消息 stylist_cache 拼快照，并校验消息归属当前用户档案。
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: '请先登录', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as SaveBody | null;
  const sourceMessageId =
    typeof body?.sourceMessageId === 'string' ? body.sourceMessageId.trim() : '';
  const sourceOutfitId =
    typeof body?.sourceOutfitId === 'string' ? body.sourceOutfitId.trim() : '';

  if (!sourceMessageId || !sourceOutfitId) {
    return NextResponse.json(
      { error: '缺少 sourceMessageId 或 sourceOutfitId', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  try {
    const existing = await prismadb.savedOutfit.findUnique({
      where: {
        userId_sourceMessageId_sourceOutfitId: {
          userId: user.id,
          sourceMessageId,
          sourceOutfitId,
        },
      },
    });
    if (existing) {
      return NextResponse.json({ item: serializeSavedOutfit(existing), created: false });
    }

    const message = await prismadb.message.findUnique({
      where: { id: sourceMessageId },
      include: { conversation: { select: { clientId: true } } },
    });
    if (!message || message.conversation.clientId !== user.clientProfileId) {
      return NextResponse.json({ error: '消息不存在', code: 'NOT_FOUND' }, { status: 404 });
    }

    const stylistCache = extractStylistCache(message.content);
    if (!stylistCache) {
      return NextResponse.json(
        { error: '该消息没有可收藏的穿搭方案', code: 'NO_OUTFIT' },
        { status: 400 }
      );
    }

    const imageStates = extractImageStates(message.content);
    const built = buildSavedOutfitFromCache(stylistCache, sourceOutfitId, imageStates);
    if (!built) {
      return NextResponse.json(
        { error: '未找到对应方案', code: 'OUTFIT_NOT_FOUND' },
        { status: 404 }
      );
    }

    const coverState = imageStates[sourceOutfitId];
    if (typeof coverState !== 'string' || coverState === 'loading' || coverState === 'failed') {
      if (!built.coverImageUrl) {
        return NextResponse.json(
          { error: '效果图尚未生成成功，暂不可收藏', code: 'IMAGE_NOT_READY' },
          { status: 400 }
        );
      }
    }

    const created = await prismadb.savedOutfit.create({
      data: {
        userId: user.id,
        sourceMessageId,
        sourceConversationId: message.conversationId,
        sourceOutfitId,
        title: built.title,
        coverImageUrl: built.coverImageUrl,
        snapshot: built.snapshot as unknown as Prisma.InputJsonValue,
        eligibleForPlan: true,
      },
    });

    return NextResponse.json({ item: serializeSavedOutfit(created), created: true }, { status: 201 });
  } catch (error) {
    console.error('[SAVED_OUTFITS_POST]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
