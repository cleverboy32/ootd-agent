import { Content } from '@google/genai';

// ─── Request Types ─────────────────────────────────────────────────────────────

export type OutfitRequestType =
  | 'wardrobe_outfit'
  | 'wardrobe_pairing'
  | 'purchase_pairing'
  | 'feedback_revision'
  | 'outfit_selection'
  | 'outfit_confirmed'
  | 'clarify'
  | 'style_advice';

export type AnchorSlot = 'top' | 'bottom' | 'dress' | 'shoes' | 'outerwear' | 'accessory';

/** 本轮搭配适用的穿衣气候，供 RAG 季节过滤；由 Gatekeeper 推断，服务端仅做锚点矛盾纠错 */
export type DressingClimate = 'cold' | 'warm' | 'mild';

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface AnchorItemImageData {
  data: string;
  mimeType: string;
}

export interface AnchorItemInfo {
  name: string;
  summary: string;
  slot: AnchorSlot;
  imageData?: AnchorItemImageData;
}

export interface GatekeeperIntent {
  weather: string;
  city?: string;
  occasion: string;
  style_preference: string;
  special_requests: string;
  request_type: OutfitRequestType;
  anchor_item_summary: string;
  anchor_slot: AnchorSlot | '';
  anchor_item_image_data?: AnchorItemImageData;
  /** outfit_selection 时用户选中的方案 id，如 outfit_1 */
  selected_outfit_id?: string;
  /** wardrobe_pairing 时已确认的衣橱单品 id */
  anchor_wardrobe_id?: string;
  /** 本轮搭配的穿衣气候：cold 秋冬保暖 / warm 春夏轻薄 / mild 过渡季或场合不明确 */
  dressing_climate: DressingClimate | '';
}

export interface WardrobeAnchorCandidate {
  id: string;
  imageUrl: string;
  subCategory: string;
  colors: string[];
  similarity?: number;
}

export type WardrobeResolverResult =
  | { status: 'resolved'; itemId: string; item: WardrobeAnchorCandidate }
  | { status: 'ambiguous'; candidates: WardrobeAnchorCandidate[] }
  | { status: 'not_found' };

export interface WeatherEnrichmentContext {
  clientIp?: string;
  profileLocation?: string;
  contextText?: string;
}

// ─── Finalize I/O interfaces ───────────────────────────────────────────────────

export interface FinalizeGatekeeperInput {
  extracted_intent: GatekeeperIntent;
  followup_questions?: string[];
  gatekeeper_reply?: string;
  suggestCityForWeather?: boolean;
  wardrobeResolver?: WardrobeResolverResult;
  currentMessageText?: string;
  history?: Content[];
  /** Gatekeeper LLM 本轮自判的放行结论，仅 style_advice 等语义类型参考 */
  modelIsComplete?: boolean;
}

export interface GatekeeperFinalizeResult {
  is_complete: boolean;
  extracted_intent: GatekeeperIntent;
  followup_questions: string[];
  gatekeeper_reply?: string;
  wardrobe_candidates?: WardrobeAnchorCandidate[];
}

// ─── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_GATEKEEPER_INTENT: GatekeeperIntent = {
  weather: '',
  occasion: '',
  style_preference: '日常休闲',
  special_requests: '',
  request_type: 'wardrobe_outfit',
  anchor_item_summary: '',
  anchor_slot: '',
  dressing_climate: '',
};
