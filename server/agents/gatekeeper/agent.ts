import { Content, Part } from '@google/genai';
import { llmGenerate } from '@/server/services/llm/client';
import { AGENT_MODELS } from '@/server/config/models';
import { withRetryOn429 } from '@/server/utils/retryOn429';
import {
  GatekeeperIntent,
  enrichIntentFromContext,
  enrichIntentWeather,
  extractTextFromParts,
  extractUserTextFromHistory,
  normalizeGatekeeperIntent,
  finalizeGatekeeperResult,
  coerceWardrobeBrowseIntent,
  adjudicateNewTaskVsRevisionIntent,
  isOutfitGeneratingIntent,
} from '../intent';
import { evaluateGatekeeperOutput } from '@/server/utils/gatekeeperEvaluator';
import { logGatekeeperAudit } from '@/server/logging/gatekeeper';
import { resolveWardrobeAnchor } from './wardrobeResolver';
import type { WardrobeAnchorCandidate } from '../intent';
import { gatekeeperSchema, WeatherLookup } from './schema';
import { GATEKEEPER_SYSTEM_INSTRUCTION } from './prompts';
import { resolveDressingClimateForIntent } from '@/server/utils/ragSeasonFilter';
import { evaluateCityWeatherGate } from '@/server/utils/cityWeatherGate';
import { formatSessionItemsForGate } from '@/server/utils/sessionItems';
import type { SessionPurchaseItem } from '@/server/utils/sessionItems';

export type { WeatherLookup } from './schema';

export interface GatekeeperContext {
  clientIp?: string;
  profileLocation?: string;
  clientId?: string;
  sessionItems?: SessionPurchaseItem[];
  currentImageUrl?: string;
}

export interface GatekeeperAuditMeta {
  conversationId?: string;
  messageId?: string;
}

export interface GatekeeperResult {
  is_complete: boolean;
  extracted_intent: GatekeeperIntent;
  followup_questions: string[];
  /** outfit_selection / outfit_confirmed / clarify 时由 Gatekeeper 直接回复用户的话术 */
  gatekeeper_reply?: string;
  /** Gatekeeper 决策本轮是否查询天气及目标城市（仅服务端使用） */
  weather_lookup?: WeatherLookup;
  /** wardrobe_pairing 检索到多件相似单品时的候选列表 */
  wardrobe_candidates?: WardrobeAnchorCandidate[];
  /** 是否建议在回复中提示用户告知城市以获取天气 */
  suggestCityForWeather?: boolean;
  /** Gatekeeper 的推理过程文本（仅 thinking 模式下存在） */
  thinking?: string;
}

function buildContextText(history: Content[], currentInput: Part[]): string {
  return `${extractUserTextFromHistory(history)}\n${extractTextFromParts(currentInput)}`.trim();
}

async function finalizeGatekeeperIntent(
  intent: GatekeeperIntent,
  history: Content[],
  currentInput: Part[],
  ctx: GatekeeperContext,
  weatherLookup?: WeatherLookup
): Promise<{ intent: GatekeeperIntent; suggestCityForWeather: boolean }> {
  const contextText = buildContextText(history, currentInput);
  let enriched = enrichIntentFromContext(intent, history, currentInput, {
    sessionItems: ctx.sessionItems,
    currentImageUrl: ctx.currentImageUrl,
  });

  // 天气由 Gatekeeper LLM 决策（weather_lookup.needed）；服务端在此串行查询补全
  if (weatherLookup?.needed && !enriched.weather.trim()) {
    if (weatherLookup.city?.trim()) {
      enriched = { ...enriched, city: weatherLookup.city.trim() };
    }
    enriched = await enrichIntentWeather(enriched, {
      clientIp: ctx.clientIp,
      profileLocation: ctx.profileLocation,
      contextText,
    });
  }

  // 服务端统一解析 dressing_climate（实况温度 / 锚点 / 活动；忽略 Gatekeeper LLM 推断）
  if (isOutfitGeneratingIntent(enriched)) {
    enriched = resolveDressingClimateForIntent(enriched, contextText);
  }

  const suggestCityForWeather = Boolean(weatherLookup?.needed) && !enriched.weather.trim();
  return { intent: enriched, suggestCityForWeather };
}

/**
 * 调用 Gatekeeper Agent 评估用户请求。
 * 单次 LLM 调用即完成意图判定与天气决策；天气在 LLM 返回后按 weather_lookup 串行查询，不参与放行。
 */
export async function callGatekeeperAgent(
  history: Content[],
  currentInput: Part[],
  ctx: GatekeeperContext = {},
  auditMeta?: GatekeeperAuditMeta
): Promise<GatekeeperResult> {
  console.log('[GATEKEEPER_AGENT] Evaluating user request...');

  const sessionBlock = formatSessionItemsForGate(ctx.sessionItems ?? []);
  const gatedInput: Part[] = sessionBlock
    ? [{ text: sessionBlock }, ...currentInput]
    : currentInput;
  const contents: Content[] = [...history, { role: 'user', parts: gatedInput }];

  try {
    const response = await withRetryOn429(
      () =>
        llmGenerate({
          model: AGENT_MODELS.gatekeeper,
          contents,
          systemInstruction: GATEKEEPER_SYSTEM_INSTRUCTION,
          temperature: 0.0,
          jsonSchema: gatekeeperSchema,
        }),
      { label: 'Gatekeeper', maxRetries: 4 }
    );

    const thinkingText = '';
    const responseText = response.text;
    if (!responseText) {
      throw new Error('Empty response from Gatekeeper Agent');
    }

    console.log('[GATEKEEPER_AGENT] Raw response:', responseText);

    const parsed = JSON.parse(responseText) as GatekeeperResult;
    const rawIntent = normalizeGatekeeperIntent(parsed.extracted_intent);
    const intentBeforeCoerce = rawIntent.request_type;
    const browsedIntent = coerceWardrobeBrowseIntent(rawIntent, history, currentInput);
    const coercedIntent = adjudicateNewTaskVsRevisionIntent(browsedIntent, currentInput);
    const wasCoercedBrowse =
      intentBeforeCoerce === 'clarify' && coercedIntent.request_type === 'wardrobe_pairing';

    const { intent, suggestCityForWeather } = await finalizeGatekeeperIntent(
      coercedIntent,
      history,
      currentInput,
      ctx,
      parsed.weather_lookup
    );

    let wardrobeResolver;
    if (
      intent.request_type === 'wardrobe_pairing' &&
      ctx.clientId &&
      intent.anchor_item_summary.trim() &&
      !intent.anchor_wardrobe_id?.trim()
    ) {
      wardrobeResolver = await resolveWardrobeAnchor(
        ctx.clientId,
        intent.anchor_item_summary,
        intent.anchor_slot || undefined,
        intent.wardrobe_search_query
      );
    }

    const result = finalizeGatekeeperResult({
      extracted_intent: intent,
      followup_questions: parsed.followup_questions,
      gatekeeper_reply: wasCoercedBrowse ? undefined : parsed.gatekeeper_reply,
      suggestCityForWeather,
      wardrobeResolver,
      currentMessageText: extractTextFromParts(currentInput),
      history,
      modelIsComplete: parsed.is_complete,
    });

    const contextText = buildContextText(history, currentInput);
    const cityGate = evaluateCityWeatherGate({
      requestType: result.extracted_intent.request_type,
      weatherLookupNeeded: Boolean(parsed.weather_lookup?.needed),
      weather: result.extracted_intent.weather,
      city: result.extracted_intent.city || parsed.weather_lookup?.city,
      profileLocation: ctx.profileLocation,
      contextText,
    });

    let gatedResult = result;
    if (result.is_complete && cityGate.blocked) {
      console.log('[GATEKEEPER] city weather gate — missing city, ask before outfit');
      gatedResult = {
        ...result,
        is_complete: false,
        followup_questions: cityGate.followup ? [cityGate.followup] : result.followup_questions,
        gatekeeper_reply: cityGate.followup || result.gatekeeper_reply,
      };
    }

    const l1 = evaluateGatekeeperOutput(
      {
        ...gatedResult,
        wardrobe_candidates: gatedResult.wardrobe_candidates,
      },
      {
        contextText,
        currentMessageText: extractTextFromParts(currentInput),
        weatherLookup: parsed.weather_lookup,
      }
    );
    void logGatekeeperAudit({
      timestamp: new Date().toISOString(),
      conversationId: auditMeta?.conversationId,
      messageId: auditMeta?.messageId,
      contextTextLength: contextText.length,
      requestType: gatedResult.extracted_intent.request_type,
      is_complete: gatedResult.is_complete,
      gatekeeper_reply: gatedResult.gatekeeper_reply,
      followup_questions: gatedResult.followup_questions,
      extracted_intent: gatedResult.extracted_intent,
      weather_lookup: parsed.weather_lookup,
      wardrobe_candidates: gatedResult.wardrobe_candidates,
      l1,
      thinking: thinkingText || undefined,
    });

    return {
      ...gatedResult,
      weather_lookup: parsed.weather_lookup,
      thinking: thinkingText || undefined,
    };
  } catch (error) {
    console.error('[GATEKEEPER_AGENT] Error calling Gatekeeper Agent:', error);
    throw error;
  }
}
