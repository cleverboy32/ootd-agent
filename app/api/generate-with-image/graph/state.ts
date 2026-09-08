import { Annotation } from '@langchain/langgraph';
import type { Content, Part } from '@google/genai';
import type { ClothingItem } from '@prisma/client';
import type { GatekeeperResult } from '@/server/agents/gatekeeper';
import type { UserProfileResult } from '@/server/agents/user-profile';
import type { StylistResult } from '@/server/agents/stylist';
import type { GatekeeperIntent } from '@/server/agents/intent';
import type { StylistCacheNode, WardrobeCandidatesNode } from '@/server/utils/messageContent';
import type { RequestTrace } from '@/server/logging/request';
import type { SessionPurchaseItem } from '@/server/utils/sessionItems';

/** 不可序列化的运行时副作用容器，经 configurable.runtime 注入 */
export interface OutfitRuntime {
  controller: ReadableStreamDefaultController;
  imageMap: Map<string, string>;
  failedImageIds: Set<string>;
  ragCache: Map<string, ClothingItem>;
  initialParts: Part[];
  clientId?: string;
  conversationId?: string;
  clientIp?: string;
  /** 本轮请求的待购图 COS URL（与 initialParts inlineData 对应） */
  currentImageUrl?: string;
  profileLocationPromise: Promise<string | undefined>;
  /** 请求级 audit 追踪（与 ReadableStream.cancel 共享同一实例） */
  trace: RequestTrace;
  appendText: (text: string) => void;
  getAccumulated: () => string;
  setMessageId: (id: string) => void;
  getMessageId: () => string | undefined;
  setStylistCache: (value: StylistCacheNode | null) => void;
  getStylistCache: () => StylistCacheNode | null;
  setActiveStylist: (value: StylistResult | null) => void;
  getActiveStylist: () => StylistResult | null;
  setWardrobeCandidates: (value: WardrobeCandidatesNode | null) => void;
  getWardrobeCandidates: () => WardrobeCandidatesNode | null;
  setActiveIntent: (value: GatekeeperIntent | undefined) => void;
  getActiveIntent: () => GatekeeperIntent | undefined;
}

export type PipelineRoute = 'from_cache' | 'style_advice' | 'incomplete' | 'outfit_main' | '';

export const OutfitPipelineAnnotation = Annotation.Root({
  history: Annotation<Content[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  sessionItems: Annotation<SessionPurchaseItem[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  cacheHit: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  route: Annotation<PipelineRoute>({
    reducer: (_left, right) => right,
    default: () => '',
  }),
  messageId: Annotation<string | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  gatekeeperResult: Annotation<GatekeeperResult | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  intent: Annotation<GatekeeperIntent | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  userProfile: Annotation<UserProfileResult | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  stylistResult: Annotation<StylistResult | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  previousStylistCache: Annotation<StylistCacheNode | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  revisionNoItemChange: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  cachedPersonalStyle: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => '',
  }),
});

export type OutfitPipelineState = typeof OutfitPipelineAnnotation.State;
export type OutfitPipelineUpdate = typeof OutfitPipelineAnnotation.Update;
