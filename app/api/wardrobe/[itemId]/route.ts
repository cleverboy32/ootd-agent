import { NextResponse } from 'next/server';

import { getWardrobeItemDetails } from '@/server/services/wardrobeService';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  // 我们从请求头中获取客户端 ID，这是 API 的标准做法
  const clientId = req.headers.get('x-client-id');

  if (!clientId) {
    return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
  }

  if (!itemId) {
    return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
  }

  try {
    const item = await getWardrobeItemDetails(itemId);

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    // --- 关键安全检查 ---
    // 为防止信息泄露，如果物品不属于当前用户，我们同样返回 404
    if (item.clientProfileId !== clientId) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    
    // 准备返回给客户端的数据
    const responseData = {
      id: item.id,
      name: item.subCategory,
      imageUrl: item.imageUrl,
    };

    // 返回成功响应，并设置缓存头
    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        // 在浏览器和 CDN 上缓存 1 小时
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });

  } catch (error) {
    console.error(`[API-ERROR] Failed to fetch wardrobe item ${itemId}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}