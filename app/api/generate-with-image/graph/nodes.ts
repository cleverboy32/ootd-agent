import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import { sendEvent } from '@/server/utils/stream-helpers';
import { callGatekeeperAgent, type GatekeeperContext } from '@/server/agents/gatekeeper';
import {
  callUserProfileAgent,
  buildUserProfileFallback,
  shouldSkipProfileAgentUpdate,
  loadUserProfileFromDb,
} from '@/server/agents/user-profile';
import { callStylistAgent, callStylistAdvice } from '@/server/agents/stylist';
import { callCopywriterAgentStream, callCopywriterAdviceStream } from '@/server/agents/copywriter';
import { IMAGE_GEN_CONCURRENCY } from '@/server/config/models';
import { mapWithConcurrency } from '@/server/utils/concurrency';
import { buildPersistedMessageContent, type StylistCacheNode } from '@/server/utils/messageContent';
import { runOutfitImageGeneration, extractSelectedItemUrls } from '../imageRetry';
import { getPreviousStylistCache, findPreviousAnchorImageUrl, persistProfileLocation } from '../helpers';
import { resolveAnchorUrlFromSessionItems, buildAdditionalPurchaseImageRefs } from '@/server/utils/sessionItems';
import type { OutfitPipelineState, OutfitPipelineUpdate, OutfitRuntime, PipelineRoute } from './state';

function getRuntime(config: LangGraphRunnableConfig): OutfitRuntime {
  const runtime = config.configurable?.runtime as OutfitRuntime | undefined;
  if (!runtime) {
    throw new Error('OutfitRuntime missing from LangGraph configurable');
  }
  return runtime;
}

function sendCopywriterStartProgress(controller: ReadableStreamDefaultController): void {
  sendEvent(controller, 'progress', {
    stage: 'copywriter',
    label: '正在撰写搭配方案...',
    thinking: '正在组织语言，马上开始输出...',
  });
}

function persistStylistCacheAsync(messageId: string, stylistCache: StylistCacheNode): void {
  void prismadb.message
    .update({
      where: { id: messageId },
      data: {
        content: buildPersistedMessageContent({
          text: '',
          stylistCache,
          imageStates: {},
        }) as Prisma.InputJsonValue,
      },
    })
    .then(() => {
      console.log('[ORCHESTRATOR:LANGGRAPH] 搭配师方案与衣橱缓存成功保存。');
    })
    .catch((e) => {
      console.warn('[ORCHESTRATOR:LANGGRAPH] stylist cache persist failed:', e);
    });
}

async function executeParallelAgents(
  state: Pick<
    OutfitPipelineState,
    | 'stylistResult'
    | 'intent'
    | 'revisionNoItemChange'
    | 'cachedPersonalStyle'
    | 'userProfile'
    | 'messageId'
    | 'sessionItems'
  >,
  runtime: OutfitRuntime
): Promise<void> {
  const stylistResult = state.stylistResult;
  if (!stylistResult) {
    throw new Error('stylistResult is required for parallel agents');
  }

  const personalStyle =
    state.cachedPersonalStyle ||
    state.userProfile?.personal_style ||
    '';

  console.log('[ORCHESTRATOR:LANGGRAPH] 启动并行双轨执行链 (文案流 + 视觉导演并行画图)...');

  const copywriterStartedAt = Date.now();
  const copywriterPromise = callCopywriterAgentStream(
    stylistResult,
    personalStyle,
    runtime.controller,
    runtime.appendText,
    {
      conversationId: runtime.conversationId,
      messageId: state.messageId ?? runtime.getMessageId(),
    },
    state.intent ?? undefined,
    state.revisionNoItemChange
  ).finally(() => {
    runtime.trace.markStage('copywriter', Date.now() - copywriterStartedAt);
  });

  const imageStartedAt = Date.now();
  const imageTask = mapWithConcurrency(
    stylistResult.outfits,
    IMAGE_GEN_CONCURRENCY,
    (outfit) => {
      const additionalPurchaseRefs = buildAdditionalPurchaseImageRefs(
        outfit,
        state.sessionItems ?? [],
        stylistResult.anchor_image_url
      );
      if (additionalPurchaseRefs.length > 0) {
        console.log(
          `[ORCHESTRATOR:LANGGRAPH] ${outfit.id} extra purchase refs:`,
          additionalPurchaseRefs.map((r) => r.label).join(' | ')
        );
      }
      return runOutfitImageGeneration(
        outfit,
        extractSelectedItemUrls(outfit, runtime.ragCache),
        stylistResult.anchor_item_image_data,
        runtime.controller,
        runtime.imageMap,
        runtime.failedImageIds,
        state.messageId ?? runtime.getMessageId(),
        'initial',
        runtime.ragCache,
        state.userProfile,
        stylistResult.anchor_image_url,
        additionalPurchaseRefs
      );
    }
  ).finally(() => {
    runtime.trace.markStage('imageGen', Date.now() - imageStartedAt);
  });

  const [copywriterRes] = await Promise.allSettled([copywriterPromise, imageTask]);
  if (copywriterRes.status === 'rejected') {
    throw new Error(
      `CopywriterFailed: ${(copywriterRes.reason as Error)?.message || '文案生成失败'}`
    );
  }
}

export async function ensureMessageNode(
  state: OutfitPipelineState,
  config: LangGraphRunnableConfig
): Promise<OutfitPipelineUpdate> {
  const runtime = getRuntime(config);
  let messageId = state.messageId ?? runtime.getMessageId();

  if (!messageId) {
    if (!runtime.conversationId) throw new Error('conversationId is required');
    const placeholder = await prismadb.message.create({
      data: {
        conversationId: runtime.conversationId,
        role: 'assistant',
        content: [{ type: 'text', content: '' }] as Prisma.InputJsonValue,
        status: 'generating',
        timestamp: new Date(),
      },
      select: { id: true },
    });
    messageId = placeholder.id;
    runtime.setMessageId(messageId);
    sendEvent(runtime.controller, 'metadata', { messageId });
  }

  return { messageId };
}

export async function gatekeeperNode(
  state: OutfitPipelineState,
  config: LangGraphRunnableConfig
): Promise<OutfitPipelineUpdate> {
  const runtime = getRuntime(config);
  const messageId = state.messageId ?? runtime.getMessageId();

  sendEvent(runtime.controller, 'progress', {
    stage: 'gatekeeper',
    label: '正在理解你的需求...',
  });

  const gatekeeperCtx: GatekeeperContext = {
    clientIp: runtime.clientIp,
    profileLocation: await runtime.profileLocationPromise,
    clientId: runtime.clientId,
    sessionItems: state.sessionItems,
    currentImageUrl: runtime.currentImageUrl,
  };

  const gatekeeperStartedAt = Date.now();
  const gatekeeperResult = await callGatekeeperAgent(
    state.history,
    runtime.initialParts,
    gatekeeperCtx,
    { conversationId: runtime.conversationId, messageId }
  );
  runtime.trace.markStage('gatekeeper', Date.now() - gatekeeperStartedAt);

  sendEvent(runtime.controller, 'progress', {
    stage: 'gatekeeper',
    done: true,
    label: '已理解需求',
    thinking: gatekeeperResult.thinking,
  });

  let route: PipelineRoute = 'outfit_main';
  if (gatekeeperResult.extracted_intent.request_type === 'style_advice') {
    route = 'style_advice';
  } else if (!gatekeeperResult.is_complete) {
    route = 'incomplete';
  }

  const intent = gatekeeperResult.extracted_intent;
  runtime.setActiveIntent(intent);
  runtime.trace.setRequestType(intent.request_type);
  runtime.trace.setRoute(route);

  // 仅 Gate 判定 city_role=home（常住所在地）时写入档案；travel 旅游目的地不覆盖
  if (intent.city?.trim() && intent.city_role === 'home') {
    await persistProfileLocation(runtime.clientId, intent.city);
  }

  return {
    gatekeeperResult,
    intent,
    route,
  };
}

export async function styleAdvicePathNode(
  state: OutfitPipelineState,
  config: LangGraphRunnableConfig
): Promise<OutfitPipelineUpdate> {
  const runtime = getRuntime(config);
  const intent = state.intent ?? state.gatekeeperResult?.extracted_intent;
  if (!intent) throw new Error('intent missing in styleAdvicePath');

  const adviceProfile = runtime.clientId
    ? await loadUserProfileFromDb(runtime.clientId)
    : buildUserProfileFallback();

  sendEvent(runtime.controller, 'progress', {
    stage: 'stylist',
    label: '正在分析搭配知识...',
  });

  const stylistStartedAt = Date.now();
  const adviceResult = await callStylistAdvice(
    state.history,
    runtime.initialParts,
    intent,
    adviceProfile
  );
  runtime.trace.markStage('stylist', Date.now() - stylistStartedAt);

  sendEvent(runtime.controller, 'progress', {
    stage: 'stylist',
    done: true,
    label: '分析完成',
  });
  sendEvent(runtime.controller, 'progress', {
    stage: 'copywriter',
    label: '正在撰写建议...',
  });

  const copywriterStartedAt = Date.now();
  await callCopywriterAdviceStream(
    adviceResult,
    adviceProfile.personal_style,
    runtime.controller,
    runtime.appendText,
    {
      conversationId: runtime.conversationId,
      messageId: state.messageId ?? runtime.getMessageId(),
    }
  );
  runtime.trace.markStage('copywriter', Date.now() - copywriterStartedAt);

  return { userProfile: adviceProfile };
}

export async function followupPathNode(
  state: OutfitPipelineState,
  config: LangGraphRunnableConfig
): Promise<OutfitPipelineUpdate> {
  const runtime = getRuntime(config);
  const gatekeeperResult = state.gatekeeperResult;
  if (!gatekeeperResult) throw new Error('gatekeeperResult missing in followupPath');

  const questionsText =
    gatekeeperResult.gatekeeper_reply?.trim() ||
    gatekeeperResult.followup_questions.join(' ');

  sendEvent(runtime.controller, 'text_chunk', { text: questionsText });
  runtime.appendText(questionsText);

  if (gatekeeperResult.wardrobe_candidates?.length) {
    const wardrobeCandidates = {
      type: 'wardrobe_candidates' as const,
      items: gatekeeperResult.wardrobe_candidates,
      prompt: questionsText,
    };
    runtime.setWardrobeCandidates(wardrobeCandidates);
    sendEvent(runtime.controller, 'wardrobe_candidates', {
      items: gatekeeperResult.wardrobe_candidates,
    });
  }

  return {};
}

export async function loadProfileNode(
  state: OutfitPipelineState,
  config: LangGraphRunnableConfig
): Promise<OutfitPipelineUpdate> {
  const runtime = getRuntime(config);
  const intent = state.intent ?? state.gatekeeperResult?.extracted_intent;
  if (!intent) throw new Error('intent missing in loadProfile');

  const loadProfileStartedAt = Date.now();
  const messageId = state.messageId ?? runtime.getMessageId();
  const previousStylistCache =
    runtime.conversationId && intent.request_type === 'feedback_revision'
      ? await getPreviousStylistCache(runtime.conversationId, messageId)
      : null;

  if (previousStylistCache) {
    for (const item of previousStylistCache.wardrobe_items ?? []) {
      runtime.ragCache.set(item.id, item);
    }
  }

  const anchorWardrobeId = intent.anchor_wardrobe_id?.trim();
  if (anchorWardrobeId && runtime.clientId) {
    try {
      const anchorItem = await prismadb.clothingItem.findFirst({
        where: { id: anchorWardrobeId, clientProfileId: runtime.clientId },
      });
      if (anchorItem) runtime.ragCache.set(anchorItem.id, anchorItem);
    } catch (e) {
      console.warn('[ORCHESTRATOR:LANGGRAPH] Failed to preload wardrobe anchor item:', e);
    }
  }

  const currentUserText = runtime.initialParts
    .filter((p): p is { text: string } => 'text' in p && Boolean(p.text?.trim()))
    .map((p) => p.text)
    .join('\n');

  let userProfile;
  if (shouldSkipProfileAgentUpdate(intent, currentUserText) && runtime.clientId) {
    console.log('[ORCHESTRATOR:LANGGRAPH] 跳过 Profile Agent — 本轮为操作/确认类消息');
    userProfile = await loadUserProfileFromDb(runtime.clientId);
  } else {
    try {
      userProfile = await callUserProfileAgent(
        state.history,
        runtime.initialParts,
        runtime.clientId,
        {
          conversationId: runtime.conversationId,
          messageId,
          userMessage: currentUserText,
        }
      );
    } catch (e) {
      console.warn('[ORCHESTRATOR:LANGGRAPH] User Profile 失败，启动保底画像:', e);
      userProfile = runtime.clientId
        ? await loadUserProfileFromDb(runtime.clientId)
        : buildUserProfileFallback();
    }
  }

  runtime.trace.markStage('loadProfile', Date.now() - loadProfileStartedAt);

  return {
    userProfile,
    previousStylistCache,
  };
}

export async function stylistNode(
  state: OutfitPipelineState,
  config: LangGraphRunnableConfig
): Promise<OutfitPipelineUpdate> {
  const runtime = getRuntime(config);
  const intent = state.intent ?? state.gatekeeperResult?.extracted_intent;
  const userProfile = state.userProfile;
  if (!intent || !userProfile) {
    throw new Error('intent/userProfile missing in stylistNode');
  }

  const messageId = state.messageId ?? runtime.getMessageId();
  sendEvent(runtime.controller, 'progress', {
    stage: 'stylist',
    label: '搭配师正在为你选品...',
  });

  let stylistResult;
  const stylistStartedAt = Date.now();
  try {
    let previousAnchorImageUrl: string | undefined;
    if (intent.request_type === 'feedback_revision' && runtime.conversationId) {
      previousAnchorImageUrl = await findPreviousAnchorImageUrl(
        runtime.conversationId,
        messageId
      );
      if (!previousAnchorImageUrl) {
        const fromSession = resolveAnchorUrlFromSessionItems(
          state.sessionItems ?? [],
          `${intent.special_requests}\n${intent.anchor_item_summary}`
        );
        if (fromSession) {
          previousAnchorImageUrl = fromSession;
          console.log(
            '[ORCHESTRATOR:LANGGRAPH] revision anchor recovered from sessionItems:',
            fromSession.slice(0, 80)
          );
        }
      }
    }
    stylistResult = await callStylistAgent(
      state.history,
      intent,
      userProfile,
      runtime.initialParts,
      runtime.clientId,
      runtime.ragCache,
      runtime.conversationId,
      {
        previousStylistCache: state.previousStylistCache,
        previousAnchorImageUrl,
      }
    );
  } catch (e) {
    runtime.trace.markStage('stylist', Date.now() - stylistStartedAt);
    console.error('[ORCHESTRATOR:LANGGRAPH] Stylist 灾难性失败:', e);
    throw new Error('StylistFailed: 搭配师开小差了，请稍后再试~');
  }
  runtime.trace.markStage('stylist', Date.now() - stylistStartedAt);

  const stylistCache = {
    type: 'stylist_cache' as const,
    stylist_result: stylistResult,
    user_profile: userProfile,
    wardrobe_items: Array.from(runtime.ragCache.values()),
  };
  runtime.setStylistCache(stylistCache);
  runtime.setActiveStylist(stylistResult);

  sendEvent(runtime.controller, 'progress', {
    stage: 'stylist',
    done: true,
    label: '选品完成',
  });
  sendCopywriterStartProgress(runtime.controller);

  let revisionNoItemChange = false;
  if (
    intent.request_type === 'feedback_revision' &&
    state.previousStylistCache &&
    stylistResult.outfits.length > 0
  ) {
    const revisionOutfitId = intent.selected_outfit_id?.trim() || 'outfit_1';
    const prevOutfit =
      state.previousStylistCache.stylist_result.outfits.find((o) => o.id === revisionOutfitId) ??
      state.previousStylistCache.stylist_result.outfits[0];
    const newOutfit = stylistResult.outfits[0];
    if (prevOutfit && newOutfit) {
      const prevIds = new Set(prevOutfit.selected_items.map((i) => i.id));
      const newIds = new Set(newOutfit.selected_items.map((i) => i.id));
      revisionNoItemChange =
        prevIds.size === newIds.size && [...prevIds].every((id) => newIds.has(id));
      if (revisionNoItemChange) {
        console.log(
          '[ORCHESTRATOR:LANGGRAPH] feedback_revision: 单品未变，Copywriter 将如实说明原方案已适合'
        );
      }
    }
  }

  if (messageId) {
    persistStylistCacheAsync(messageId, stylistCache);
  }

  return {
    stylistResult,
    revisionNoItemChange,
  };
}

export async function parallelOutfitsNode(
  state: OutfitPipelineState,
  config: LangGraphRunnableConfig
): Promise<OutfitPipelineUpdate> {
  const runtime = getRuntime(config);
  await executeParallelAgents(state, runtime);
  return {};
}

export async function parallelFromCacheNode(
  state: OutfitPipelineState,
  config: LangGraphRunnableConfig
): Promise<OutfitPipelineUpdate> {
  const runtime = getRuntime(config);
  sendCopywriterStartProgress(runtime.controller);
  await executeParallelAgents(state, runtime);
  return {};
}

export function routeAfterGatekeeper(state: OutfitPipelineState): string {
  if (state.route === 'style_advice') return 'styleAdvicePath';
  if (state.route === 'incomplete') return 'followupPath';
  return 'loadProfile';
}
