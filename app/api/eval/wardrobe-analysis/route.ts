import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { AGENT_MODELS } from '@/server/config/models';
import { llmGenerate } from '@/server/services/llm/client';
import { extractJsonText } from '@/server/services/llm/convert';
import {
  normalizeWardrobeAnalysis,
  WARDROBE_ANALYSIS_RULESET_VERSION,
  WARDROBE_ANALYSIS_JSON_SCHEMA,
  WARDROBE_ANALYSIS_PROMPT,
} from '@/server/utils/wardrobeAnalysis';

export const runtime = 'nodejs';
export const maxDuration = 120;

function evalEnabled(): boolean {
  return process.env.EVAL_API_ENABLED === 'true' || process.env.EVAL_API_ENABLED === '1';
}

export async function POST(request: NextRequest) {
  if (!evalEnabled()) {
    return NextResponse.json({ error: 'Eval API disabled. Set EVAL_API_ENABLED=true' }, { status: 404 });
  }

  try {
    const body = (await request.json()) as { imageBase64?: string; mimeType?: string };
    if (!body.imageBase64 || !body.mimeType?.startsWith('image/')) {
      return NextResponse.json({ error: 'imageBase64 and image mimeType are required' }, { status: 400 });
    }
    const result = await llmGenerate({
      model: AGENT_MODELS.wardrobeAnalysis,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: body.imageBase64, mimeType: body.mimeType } },
          { text: WARDROBE_ANALYSIS_PROMPT },
        ],
      }],
      jsonSchema: WARDROBE_ANALYSIS_JSON_SCHEMA,
    });
    if (!result.text) throw new Error('AI 分析没有返回内容');
    const raw = JSON.parse(extractJsonText(result.text)) as Record<string, unknown>;
    const analysis = normalizeWardrobeAnalysis(raw);
    if (!analysis) throw new Error('AI 分析结果异常');
    const promptHash = createHash('sha256').update(WARDROBE_ANALYSIS_PROMPT).digest('hex').slice(0, 12);
    return NextResponse.json({
      analysis,
      raw,
      model: AGENT_MODELS.wardrobeAnalysis,
      promptHash,
      rulesetVersion: WARDROBE_ANALYSIS_RULESET_VERSION,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Wardrobe analysis failed' },
      { status: 500 }
    );
  }
}
