import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { Prisma } from '@prisma/client';
import prismadb from '@/server/db';
import { sendEvent } from '@/server/utils/stream-helpers';
import { callGatekeeperAgent, type GatekeeperContext } from '@/server/agents/gatekeeper';
import {
  buildUserProfileFallback,
  loadUserProfileFromDb,
  profileFromDbRecord,
} from '@/server/agents/user-profile';
import { readFullBodyImageUrl } from '@/server/utils/profileMetadata';
import { callStylistAdvice, callStylistTurn } from '@/server/agents/stylist';
import { resolveStylistUploadUrls } from '@/server/agents/stylist/uploadVision';
import { callCopywriterAgentStream, callCopywriterAdviceStream } from '@/server/agents/copywriter';
import { IMAGE_GEN_CONCURRENCY } from '@/server/config/models';
import { mapWithConcurrency } from '@/server/utils/concurrency';
import { buildPersistedMessageContent, type StylistCacheNode } from '@/server/utils/messageContent';
import { runOutfitImageGeneration, extractSelectedItemUrls } from '../imageRetry';
import {
  getPreviousStylistCache,
  getPriorStylistResults,
  findPreviousAnchorImageUrl,
  persistProfileLocation,
} from '../helpers';
import {
  resolveAnchorUrlFromSessionItems,
  buildAdditionalPurchaseImageRefs,
  labelPurchaseUploads,
  mergePurchaseImageRefs,
} from '@/server/utils/sessionItems';
import {
  shouldApplyGateProfileUpdate,
  scheduleProfileUpdatePersist,
} from '@/server/utils/profileUpdatePatch';
import { throwIfAborted } from '@/server/utils/abort';
import { outfitsHaveSameItemFingerprints } from '@/server/utils/stylistRevisionCompare';
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
    | 'fullBodyImageUrl'
    | 'messageId'
    | 'sessionItems'
    | 'ignoredUploadNote'
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

  const ignoredUploadNote = state.ignoredUploadNote?.trim();
  if (ignoredUploadNote) {
    sendEvent(runtime.controller, 'text_chunk', { text: `${ignoredUploadNote}\n\n` });
    runtime.appendText(`${ignoredUploadNote}\n\n`);
  }

  let portraitImageUrl = state.fullBodyImageUrl;
  if (portraitImageUrl === undefined && runtime.userId) {
    try {
      const client = await prismadb.user.findUnique({
        where: { id: runtime.userId },
        select: { profileData: true },
      });
      const dbProfile = (client?.profileData as Record<string, unknown>) || {};
      portraitImageUrl = readFullBodyImageUrl(dbProfile, runtime.userId) ?? '';
    } catch (e) {
      console.warn('[ORCHESTRATOR:LANGGRAPH] Failed to load full-body photo:', e);
      portraitImageUrl = '';
    }
  }

  const copywriterStartedAt = Date.now();
  const copywriterPromise = callCopywriterAgentStream(
    stylistResult,
    personalStyle,
    runtime.controller,
    runtime.appendText,
    {
      conversationId: runtime.conversationId,
      messageId: state.messageId ?? runtime.getMessageId(),
      signal: runtime.abortSignal,
    },
    state.intent ?? undefined,
    state.revisionNoItemChange,
    runtime.initialParts
      .filter((part): part is { text: string } => 'text' in part && Boolean(part.text?.trim()))
      .map((part) => part.text.trim())
      .join('\n')
  ).finally(() => {
    runtime.trace.markStage('copywriter', Date.now() - copywriterStartedAt);
  });

  const imageStartedAt = Date.now();
  const { getCreditBalance } = await import('@/server/billing/credits');
  const { creditCostPerImage } = await import('@/server/config/credits');
  const enforceCredits = Boolean(runtime.userId);
  let affordableSlots = stylistResult.outfits.length;
  if (enforceCredits && runtime.userId) {
    const balance = await getCreditBalance(runtime.userId);
    const cost = creditCostPerImage();
    affordableSlots = Math.floor(balance / cost);
    console.log(
      `[CREDITS] user=${runtime.userId} balance=${balance} cost/image=${cost} affordable=${affordableSlots}/${stylistResult.outfits.length}`
    );
  }

  const imageConcurrency = enforceCredits ? 1 : IMAGE_GEN_CONCURRENCY;
  const imageTask = mapWithConcurrency(
    stylistResult.outfits,
    imageConcurrency,
    (outfit, index) => {
      throwIfAborted(runtime.abortSignal);
      const skipForCredits = enforceCredits && index >= affordableSlots;
      const labeledUploads = labelPurchaseUploads(
        outfit,
        state.intent?.purchase_items ?? [],
        stylistResult.purchase_image_urls ?? []
      );
      const sessionRefs = buildAdditionalPurchaseImageRefs(
        outfit,
        state.sessionItems ?? [],
        stylistResult.anchor_image_url
      );
      const additionalPurchaseRefs = mergePurchaseImageRefs(
        labeledUploads,
        sessionRefs,
        outfit.selected_items.filter((item) => item.id === 'new_item').map((item) => item.name)
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
        additionalPurchaseRefs,
        portraitImageUrl || undefined,
        runtime.abortSignal,
        {
          userId: runtime.userId,
          creditsRequiredIds: runtime.creditsRequiredIds,
          skipForCredits,
        }
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
    userId: runtime.userId,
    sessionItems: state.sessionItems,
    currentImageUrl: runtime.currentImageUrl,
    currentImageUrls: runtime.currentImageUrls,
  };

  const gatekeeperStartedAt = Date.now();
  const gatekeeperResult = await callGatekeeperAgent(
    state.history,
    runtime.initialParts,
    gatekeeperCtx,
    { conversationId: runtime.conversationId, messageId, signal: runtime.abortSignal }
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
    await persistProfileLocation(runtime.userId, intent.city);
  }

  // 档案增量：Gate 抽出 patch，异步写库，不阻塞后续 Stylist
  const currentUserText = runtime.initialParts
    .filter((p): p is { text: string } => 'text' in p && Boolean(p.text?.trim()))
    .map((p) => p.text)
    .join('\n');
  const profileUpdate = gatekeeperResult.profile_update;
  if (
    runtime.userId &&
    profileUpdate &&
    shouldApplyGateProfileUpdate(intent, profileUpdate, currentUserText)
  ) {
    console.log('[ORCHESTRATOR:LANGGRAPH] Scheduling async profile_update persist');
    scheduleProfileUpdatePersist(runtime.userId, profileUpdate.patch);
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

  const adviceProfile = runtime.userId
    ? await loadUserProfileFromDb(runtime.userId)
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
    adviceProfile,
    runtime.abortSignal
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
      signal: runtime.abortSignal,
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
  if (anchorWardrobeId && runtime.userId) {
    try {
      const anchorItem = await prismadb.clothingItem.findFirst({
        where: { id: anchorWardrobeId, userId: runtime.userId, status: 'completed' },
      });
      if (anchorItem) runtime.ragCache.set(anchorItem.id, anchorItem);
    } catch (e) {
      console.warn('[ORCHESTRATOR:LANGGRAPH] Failed to preload wardrobe anchor item:', e);
    }
  }

  // 关键路径只读 DB；档案增量由 Gate profile_update 异步写库，不再串行 Profile LLM
  let userProfile;
  let fullBodyImageUrl: string | undefined;
  try {
    if (runtime.userId) {
      const client = await prismadb.user.findUnique({
        where: { id: runtime.userId },
        select: { profileData: true },
      });
      const dbProfile = (client?.profileData as Record<string, unknown>) || {};
      userProfile = profileFromDbRecord(dbProfile);
      fullBodyImageUrl = readFullBodyImageUrl(dbProfile, runtime.userId);
    } else {
      userProfile = buildUserProfileFallback();
    }
  } catch (e) {
    console.warn('[ORCHESTRATOR:LANGGRAPH] loadUserProfileFromDb failed, using fallback:', e);
    userProfile = buildUserProfileFallback();
  }

  runtime.trace.markStage('loadProfile', Date.now() - loadProfileStartedAt);

  return {
    userProfile,
    fullBodyImageUrl: fullBodyImageUrl ?? '',
    previousStylistCache,
  };
}

export async function stylistNode(
  state: OutfitPipelineState,
  config: LangGraphRunnableConfig
): Promise<OutfitPipelineUpdate> {
  const runtime = getRuntime(config);
  let intent = state.intent ?? state.gatekeeperResult?.extracted_intent;
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
  let ignoredUploadNote = '';
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
    // outfit_redo：明确整套重做；wardrobe_outfit：同会话反复要搭（有 prior 才产生多样性块）
    const priorStylistResults =
      runtime.conversationId &&
      (intent.request_type === 'outfit_redo' || intent.request_type === 'wardrobe_outfit')
        ? await getPriorStylistResults(runtime.conversationId, messageId)
        : [];
    const turn = await callStylistTurn(
      state.history,
      intent,
      userProfile,
      runtime.initialParts,
      runtime.userId,
      runtime.ragCache,
      runtime.conversationId,
      {
        previousStylistCache: state.previousStylistCache,
        previousAnchorImageUrl,
        messageId,
        signal: runtime.abortSignal,
        currentImageUrls: resolveStylistUploadUrls(
          runtime.currentImageUrls,
          intent,
          state.sessionItems ?? []
        ),
        priorStylistResults,
      }
    );
    if (turn.type === 'text') {
      runtime.trace.markStage('stylist', Date.now() - stylistStartedAt);
      runtime.trace.setRoute('incomplete');
      const gatekeeperResult = state.gatekeeperResult
        ? {
            ...state.gatekeeperResult,
            is_complete: false,
            gatekeeper_reply: turn.reply,
            followup_questions: [],
          }
        : null;
      return {
        route: 'incomplete',
        gatekeeperResult,
      };
    }
    stylistResult = turn.result;
    intent = turn.intent;
    runtime.setActiveIntent(turn.intent);
    ignoredUploadNote = turn.ignoredUploadNote;
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
      revisionNoItemChange = outfitsHaveSameItemFingerprints(prevOutfit, newOutfit);
      if (revisionNoItemChange) {
        console.log(
          '[ORCHESTRATOR:LANGGRAPH] feedback_revision: 单品未变，Copywriter 将如实说明原方案已适合'
        );
      } else {
        console.log(
          '[ORCHESTRATOR:LANGGRAPH] feedback_revision: 单品有变化（含 new_item 改名/改描述）'
        );
      }
    }
  }

  if (messageId) {
    persistStylistCacheAsync(messageId, stylistCache);
  }

  return {
    stylistResult,
    intent,
    revisionNoItemChange,
    ignoredUploadNote,
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

export function routeAfterStylist(state: OutfitPipelineState): string {
  if (state.route === 'incomplete') return 'followupPath';
  return 'parallelOutfits';
}
