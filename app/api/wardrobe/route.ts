import { NextResponse } from 'next/server';
import prismadb from 'server/db';
import { llmGenerate } from '@/server/services/llm/client';
import { extractJsonText } from '@/server/services/llm/convert';
import { AGENT_MODELS } from '@/server/config/models';
import { urlToGenerativePart } from '@/server/utils/image';
import {
  clothingItemHasTextEmbedding,
  clothingItemHasVisualEmbedding,
  deleteWardrobeItems,
  findWardrobeItemByImageUrl,
  persistTextEmbedding,
  persistVisualEmbedding,
} from '@/server/services/wardrobeService';
import { is429Error, withRetryOn429 } from '@/server/utils/retryOn429';
import { toUserFacingUploadError } from '@/lib/upload-errors';
import {
  normalizeWardrobeAnalysis,
  WARDROBE_ANALYSIS_JSON_SCHEMA,
  WARDROBE_ANALYSIS_PROMPT,
  type WardrobeAnalysisResult,
} from '@/server/utils/wardrobeAnalysis';

export async function GET(req: Request) {
  try {
    const clientId = req.headers.get('X-Client-ID');
    if (!clientId) {
      return NextResponse.json({ error: 'X-Client-ID header is required' }, { status: 400 });
    }

    console.log(`[API /api/wardrobe] GET request for clientId: ${clientId}`);

    const clothingItems = await prismadb.clothingItem.findMany({
      where: { clientProfileId: clientId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(clothingItems, { status: 200 });
  } catch (error) {
    console.error('Error in GET /api/wardrobe:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

type StepState = 'pending' | 'done' | 'skipped' | 'failed';

export interface WardrobeStepStatus {
  analysis: StepState;
  textEmbedding: StepState;
  visualEmbedding: StepState;
}

function failStep(
  timer: ReturnType<typeof createStepTimer>,
  steps: WardrobeStepStatus,
  step: keyof WardrobeStepStatus,
  message: string,
  status: number,
  extra?: Record<string, unknown>
) {
  const finalSteps: WardrobeStepStatus = { ...steps, [step]: 'failed' };
  timer.log('error', { steps: finalSteps, ...extra });
  return NextResponse.json({ error: message, steps: finalSteps, ...extra }, { status });
}

function createStepTimer() {
  const startedAt = Date.now();
  let lastMark = startedAt;
  const ms: Record<string, number> = {};

  return {
    mark(step: string) {
      const now = Date.now();
      ms[step] = now - lastMark;
      lastMark = now;
    },
    log(outcome: 'success' | 'error', extra?: Record<string, unknown>) {
      ms.total = Date.now() - startedAt;
      console.log('[API /api/wardrobe] timing', JSON.stringify({ outcome, ...extra, ms }));
    },
  };
}

function isRateLimitResponse(error: unknown, steps: WardrobeStepStatus, item: { id: string }) {
  if (!is429Error(error)) return null;
  return NextResponse.json(
    { error: 'AI 服务请求过于频繁，请稍后再试', code: 'RATE_LIMIT', steps, item },
    { status: 429 }
  );
}

export async function POST(req: Request) {
  const timer = createStepTimer();
  try {
    const clientId = req.headers.get('X-Client-ID');
    if (!clientId) {
      return NextResponse.json({ error: 'X-Client-ID header is required' }, { status: 400 });
    }

    const { imageUrl } = await req.json();
    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json({ error: 'imageUrl is required in the request body' }, { status: 400 });
    }

    console.log(`[API /api/wardrobe] Received request for clientId: ${clientId}, imageUrl: ${imageUrl}`);

    let item = await findWardrobeItemByImageUrl(clientId, imageUrl);
    const steps: WardrobeStepStatus = {
      analysis: item ? 'skipped' : 'pending',
      textEmbedding: 'pending',
      visualEmbedding: 'pending',
    };
    timer.mark('lookup_existing');

    if (!item) {
      const imagePart = await urlToGenerativePart(imageUrl);
      timer.mark('fetch_image');

      console.log('[API /api/wardrobe] Calling LLM for analysis...', {
        model: AGENT_MODELS.wardrobeAnalysis,
      });
      const result = await withRetryOn429(
        () =>
          llmGenerate({
            model: AGENT_MODELS.wardrobeAnalysis,
            contents: [{ role: 'user', parts: [imagePart, { text: WARDROBE_ANALYSIS_PROMPT }] }],
            jsonSchema: WARDROBE_ANALYSIS_JSON_SCHEMA,
          }),
        { label: 'Wardrobe analysis', maxRetries: 4 }
      );
      timer.mark('llm_analysis');

      const responseText = result.text;
      console.log(`[API /api/wardrobe] LLM response received: ${responseText}`);

      if (!responseText) {
        return failStep(timer, steps, 'analysis', 'AI 分析没有返回内容，请重试', 502);
      }

      let parsed: WardrobeAnalysisResult;
      try {
        parsed = JSON.parse(extractJsonText(responseText));
      } catch {
        console.error('[API /api/wardrobe] Failed to parse JSON from AI response:', responseText);
        return failStep(timer, steps, 'analysis', 'AI 分析结果异常，请重试', 502);
      }

      const analysis = normalizeWardrobeAnalysis(parsed);
      if (!analysis) {
        console.error('[API /api/wardrobe] Invalid analysis payload:', parsed);
        return failStep(timer, steps, 'analysis', 'AI 分析结果异常，请重试', 502);
      }
      timer.mark('parse_and_validate');

      console.log('[API /api/wardrobe] Storing new clothing item to database...');
      item = await prismadb.clothingItem.create({
        data: {
          clientProfileId: clientId,
          imageUrl,
          mainCategory: analysis.mainCategory,
          subCategory: analysis.subCategory,
          season: analysis.season,
          material: analysis.material,
          colors: analysis.colors,
          tags: analysis.tags,
          description: analysis.description,
          searchDescription: analysis.searchDescription,
          occasions: analysis.occasions,
          formality: analysis.formality,
          silhouette: analysis.silhouette,
        },
      });
      steps.analysis = 'done';
      timer.mark('db_write');
    }

    if (await clothingItemHasTextEmbedding(item.id)) {
      steps.textEmbedding = 'skipped';
    } else {
      try {
        await persistTextEmbedding(item.id);
        steps.textEmbedding = 'done';
        timer.mark('text_embedding');
      } catch (error) {
        console.error('[API /api/wardrobe] Text embedding step failed', { itemId: item.id, error });
        const rateLimit = isRateLimitResponse(error, steps, item);
        if (rateLimit) {
          timer.log('error', { itemId: item.id, steps: { ...steps, textEmbedding: 'failed' } });
          return rateLimit;
        }
        return failStep(
          timer,
          steps,
          'textEmbedding',
          '文本检索向量生成失败，点击重试即可（分析结果已保存）',
          502,
          { item }
        );
      }
    }

    if (await clothingItemHasVisualEmbedding(item.id)) {
      steps.visualEmbedding = 'skipped';
    } else {
      try {
        await persistVisualEmbedding(item.id);
        steps.visualEmbedding = 'done';
        timer.mark('visual_embedding');
      } catch (error) {
        console.error('[API /api/wardrobe] Visual embedding step failed', { itemId: item.id, error });
        const rateLimit = isRateLimitResponse(error, steps, item);
        if (rateLimit) {
          timer.log('error', { itemId: item.id, steps: { ...steps, visualEmbedding: 'failed' } });
          return rateLimit;
        }
        return failStep(
          timer,
          steps,
          'visualEmbedding',
          '图片向量生成失败，点击重试即可（分析与文本向量已保存）',
          502,
          { item }
        );
      }
    }

    timer.log('success', {
      model: AGENT_MODELS.wardrobeAnalysis,
      itemId: item.id,
      subCategory: item.subCategory,
      steps,
    });

    return NextResponse.json({ ...item, steps }, { status: 201 });
  } catch (error) {
    timer.log('error', { model: AGENT_MODELS.wardrobeAnalysis });
    console.error('Error in POST /api/wardrobe:', error);
    if (is429Error(error)) {
      return NextResponse.json(
        { error: 'AI 服务请求过于频繁，请稍后再试', code: 'RATE_LIMIT' },
        { status: 429 }
      );
    }
    if (error instanceof Error && error.message.includes('GoogleGenerativeAI')) {
      return NextResponse.json({ error: 'AI 服务暂时不可用，请稍后重试' }, { status: 502 });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: toUserFacingUploadError(error.message) }, { status: 500 });
    }
    return NextResponse.json({ error: '处理失败，请重试' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const clientId = req.headers.get('X-Client-ID');
    if (!clientId) {
      return NextResponse.json({ error: 'X-Client-ID header is required' }, { status: 400 });
    }

    const body = (await req.json()) as { ids?: string[] };
    const ids = Array.isArray(body.ids) ? body.ids : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }

    const deletedCount = await deleteWardrobeItems(ids, clientId);
    return NextResponse.json({ deletedCount }, { status: 200 });
  } catch (error) {
    console.error('Error in DELETE /api/wardrobe:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
