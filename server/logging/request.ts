import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';

/** 请求级 audit 的最终业务路由（落盘字符串稳定，digest/看板按此聚合） */
export enum RequestAuditRoute {
  /** 命中 stylist cache，断点续传（跳过 Gatekeeper/Stylist 重跑） */
  FromCache = 'from_cache',
  /** Gatekeeper 判定咨询/建议，只出建议文案，不出搭配+效果图 */
  StyleAdvice = 'style_advice',
  /** Gatekeeper 未放行（clarify/追问等），直接回用户 */
  Incomplete = 'incomplete',
  /** 完整搭配主路径：Profile → Stylist → Copywriter + 画图（含首次搭配与 feedback_revision） */
  OutfitMain = 'outfit_main',
  /** 用户点单张效果图重试（独立 stream） */
  ImageRetry = 'image_retry',
  /** 尚未分到业务枝就结束（极早失败 / 未设 route） */
  Unknown = 'unknown',
}

/**
 * Gatekeeper 意图类型（与 `OutfitRequestType` 字符串一一对应；
 * audit 侧单独成 enum 仅为落盘/注释清晰，写入时从 intent.request_type 映射）。
 */
export enum RequestAuditRequestType {
  /** 从衣橱搭一套（或整轮重做） */
  WardrobeOutfit = 'wardrobe_outfit',
  /** 指定衣橱已有单品作锚点搭配 */
  WardrobePairing = 'wardrobe_pairing',
  /** 待购/上传单品 + 衣橱互补 */
  PurchasePairing = 'purchase_pairing',
  /** 对上一轮方案的明确修改（微调，非整轮重做） */
  FeedbackRevision = 'feedback_revision',
  /** 只表示更喜欢第几套，未说满意或微调 */
  OutfitSelection = 'outfit_selection',
  /** 已选定且明确满意、可直接穿 */
  OutfitConfirmed = 'outfit_confirmed',
  /** 与搭配相关但意图不清，需追问 */
  Clarify = 'clarify',
  /** 咨询风格/场景穿搭建议（知识向，非直接出一套） */
  StyleAdvice = 'style_advice',
}

/** 请求入口类型 */
export enum RequestAuditKind {
  /** 正常对话生成（POST 无 retryOutfitId） */
  Generate = 'generate',
  /** 单张效果图重试（POST 带 retryOutfitId） */
  ImageRetry = 'image_retry',
}

/** 流水线结果（与 DB message.status 对齐意图；断联不算 failed） */
export enum RequestAuditOutcome {
  /** 编排跑完且无未捕获错误 */
  Completed = 'completed',
  /** 编排抛错或最终按失败落库 */
  Failed = 'failed',
}

export type RequestAuditStageName =
  | 'gatekeeper'
  | 'loadProfile'
  | 'stylist'
  | 'copywriter'
  | 'imageGen';

export interface RequestAuditStages {
  gatekeeperMs?: number;
  loadProfileMs?: number;
  stylistMs?: number;
  copywriterMs?: number;
  imageGenMs?: number;
}

export interface RequestAuditSummary {
  outfitCount?: number;
  imageSuccessCount?: number;
  imageFailedCount?: number;
  ragItemCount?: number;
  wardrobeCandidateCount?: number;
}

export interface RequestAuditLogEntry {
  timestamp: string;
  kind: RequestAuditKind;
  conversationId?: string;
  messageId?: string;
  clientId?: string;
  route: RequestAuditRoute;
  /** Gatekeeper 意图；image_retry 或极早失败时可省略 */
  requestType?: RequestAuditRequestType;
  clientCancelled: boolean;
  cancelReason?: string;
  outcome: RequestAuditOutcome;
  errorMessage?: string;
  durationMs: number;
  stages: RequestAuditStages;
  summary: RequestAuditSummary;
}

const AUDIT_LOG_PATH = auditLogPath('request-audit.jsonl');

const REQUEST_TYPE_BY_VALUE = new Map<string, RequestAuditRequestType>(
  Object.values(RequestAuditRequestType).map((value) => [value, value])
);

const STAGE_FIELD: Record<RequestAuditStageName, keyof RequestAuditStages> = {
  gatekeeper: 'gatekeeperMs',
  loadProfile: 'loadProfileMs',
  stylist: 'stylistMs',
  copywriter: 'copywriterMs',
  imageGen: 'imageGenMs',
};

/** 只认与 OutfitRequestType 相同的 8 个字符串；非法值返回 undefined */
export function toRequestAuditRequestType(
  value: string | undefined | null
): RequestAuditRequestType | undefined {
  if (!value) return undefined;
  const mapped = REQUEST_TYPE_BY_VALUE.get(value);
  if (!mapped) {
    console.warn(`[REQUEST_AUDIT] Unknown request_type ignored: ${value}`);
    return undefined;
  }
  return mapped;
}

/** graph PipelineRoute / audit route 字符串 → RequestAuditRoute；空串 → Unknown */
export function toRequestAuditRoute(route: string | RequestAuditRoute): RequestAuditRoute {
  switch (route) {
    case 'from_cache':
    case RequestAuditRoute.FromCache:
      return RequestAuditRoute.FromCache;
    case 'style_advice':
    case RequestAuditRoute.StyleAdvice:
      return RequestAuditRoute.StyleAdvice;
    case 'incomplete':
    case RequestAuditRoute.Incomplete:
      return RequestAuditRoute.Incomplete;
    case 'outfit_main':
    case RequestAuditRoute.OutfitMain:
      return RequestAuditRoute.OutfitMain;
    case 'image_retry':
    case RequestAuditRoute.ImageRetry:
      return RequestAuditRoute.ImageRetry;
    case '':
    case RequestAuditRoute.Unknown:
    default:
      return RequestAuditRoute.Unknown;
  }
}

export interface RequestTraceInit {
  kind: RequestAuditKind;
  conversationId?: string;
  messageId?: string;
  clientId?: string;
  route?: RequestAuditRoute;
}

export class RequestTrace {
  private readonly startedAt: number;
  private readonly kind: RequestAuditKind;
  private conversationId?: string;
  private messageId?: string;
  private clientId?: string;
  private route: RequestAuditRoute;
  private requestType?: RequestAuditRequestType;
  private clientCancelled = false;
  private cancelReason?: string;
  private readonly stages: RequestAuditStages = {};

  constructor(init: RequestTraceInit) {
    this.startedAt = Date.now();
    this.kind = init.kind;
    this.conversationId = init.conversationId;
    this.messageId = init.messageId;
    this.clientId = init.clientId;
    this.route = init.route ?? RequestAuditRoute.Unknown;
  }

  markCancelled(reason?: unknown): void {
    this.clientCancelled = true;
    if (reason === undefined || reason === null) {
      this.cancelReason = undefined;
      return;
    }
    this.cancelReason = typeof reason === 'string' ? reason : String(reason);
  }

  setRoute(route: string | RequestAuditRoute): void {
    this.route = toRequestAuditRoute(route);
  }

  setRequestType(value: string | RequestAuditRequestType | undefined | null): void {
    this.requestType =
      typeof value === 'string' || value == null
        ? toRequestAuditRequestType(value)
        : value;
  }

  setMessageId(messageId: string | undefined): void {
    if (messageId) this.messageId = messageId;
  }

  markStage(name: RequestAuditStageName, ms: number): void {
    this.stages[STAGE_FIELD[name]] = Math.max(0, Math.round(ms));
  }

  finalize(params: {
    outcome: RequestAuditOutcome;
    errorMessage?: string;
    summary?: RequestAuditSummary;
    messageId?: string;
  }): RequestAuditLogEntry {
    if (params.messageId) this.messageId = params.messageId;

    const entry: RequestAuditLogEntry = {
      timestamp: new Date().toISOString(),
      kind: this.kind,
      conversationId: this.conversationId,
      messageId: this.messageId,
      clientId: this.clientId,
      route: this.route,
      requestType: this.requestType,
      clientCancelled: this.clientCancelled,
      cancelReason: this.cancelReason,
      outcome: params.outcome,
      errorMessage: params.errorMessage,
      durationMs: Math.max(0, Date.now() - this.startedAt),
      stages: { ...this.stages },
      summary: { ...(params.summary ?? {}) },
    };

    return entry;
  }
}

export async function logRequestAudit(entry: RequestAuditLogEntry): Promise<void> {
  console.log(
    `[REQUEST_AUDIT] kind=${entry.kind} route=${entry.route} type=${entry.requestType ?? '-'} ` +
      `outcome=${entry.outcome} cancelled=${entry.clientCancelled} durationMs=${entry.durationMs}`
  );
  await appendJsonlEntry(AUDIT_LOG_PATH, entry, 'REQUEST_AUDIT');
}
