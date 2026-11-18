import type { WardrobeSearchResult } from '@/server/services/wardrobeService';
import type {
  RagRetrievalStageCounts,
  RagSlotEmptyReason,
} from '@/server/utils/ragSearchDiagnostics';
import { auditLogPath } from './paths';
import { appendJsonlEntry } from './jsonl';

export interface RagSearchIntentLog {
  weather: string;
  occasion: string;
  style_preference: string;
  special_requests: string;
  request_type?: string;
  anchor_item_summary?: string;
  anchor_slot?: string;
}

export interface RagSearchAnchorLog {
  name: string;
  summary: string;
  slot: string;
}

export interface RagSearchResultItem {
  id: string;
  subCategory: string;
  mainCategory: string;
  description: string | null;
  colors: string[];
  season: string[];
  tags: string[];
  similarity: number;
  imageUrl: string;
}

export interface RagSearchLogEntry {
  timestamp: string;
  userId: string;
  source?: string;
  conversationId?: string;
  userMessage?: string;
  intent?: RagSearchIntentLog;
  anchorItem?: RagSearchAnchorLog;
  skillNames?: string[];
  queries: Array<{
    query: string;
    slot?: string;
    outfitId?: string;
    mainCategory?: string;
  }>;
  perQueryResults: Array<{
    query: string;
    slot?: string;
    outfitId?: string;
    mainCategory?: string;
    resultCount: number;
    results: RagSearchResultItem[];
    emptyReason?: RagSlotEmptyReason | null;
    retrievalStageCounts?: RagRetrievalStageCounts;
    similarityThreshold?: number;
    searchError?: { name: string; message: string };
  }>;
  mergedResults: RagSearchResultItem[];
  totalUniqueItems: number;
  seasonFilter?: {
    dressingClimate?: string;
    targetSeasons: string[];
    isWarmWeather: boolean;
    strictColdActivity: boolean;
  };
  /** performRagSearch 外层 catch */
  handlerError?: { name: string; message: string };
}

const RAG_LOG_PATH = auditLogPath('rag-search.jsonl');

function toResultItem(item: WardrobeSearchResult): RagSearchResultItem {
  return {
    id: item.id,
    subCategory: item.subCategory,
    mainCategory: item.mainCategory,
    description: item.description,
    colors: item.colors,
    season: item.season ?? [],
    tags: item.tags ?? [],
    similarity: item.similarity,
    imageUrl: item.imageUrl,
  };
}

export async function logRagSearch(entry: RagSearchLogEntry): Promise<void> {
  const line = JSON.stringify(entry);
  console.log('[RAG_AUDIT_LOG]', line);
  await appendJsonlEntry(RAG_LOG_PATH, entry, 'RAG_AUDIT_LOG');
}

export function buildRagSearchLogEntry(params: {
  userId: string;
  queries: Array<{ query: string; slot?: string; outfitId?: string; mainCategory?: string }>;
  perQueryResults: Array<{
    query: string;
    slot?: string;
    outfitId?: string;
    mainCategory?: string;
    results: WardrobeSearchResult[];
    emptyReason?: RagSlotEmptyReason | null;
    retrievalStageCounts?: RagRetrievalStageCounts;
    similarityThreshold?: number;
    searchError?: { name: string; message: string };
  }>;
  mergedResults: WardrobeSearchResult[];
  source?: string;
  conversationId?: string;
  userMessage?: string;
  intent?: RagSearchIntentLog;
  anchorItem?: RagSearchAnchorLog;
  skillNames?: string[];
  seasonFilter?: {
    dressingClimate?: string;
    targetSeasons: string[];
    isWarmWeather: boolean;
    strictColdActivity: boolean;
  };
  handlerError?: { name: string; message: string };
}): RagSearchLogEntry {
  return {
    timestamp: new Date().toISOString(),
    userId: params.userId,
    source: params.source,
    conversationId: params.conversationId,
    userMessage: params.userMessage,
    intent: params.intent,
    anchorItem: params.anchorItem,
    skillNames: params.skillNames,
    seasonFilter: params.seasonFilter,
    ...(params.handlerError ? { handlerError: params.handlerError } : {}),
    queries: params.queries.map(({ query, slot, outfitId, mainCategory }) => ({
      query,
      slot,
      outfitId,
      mainCategory,
    })),
    perQueryResults: params.perQueryResults.map(
      ({
        query,
        slot,
        outfitId,
        mainCategory,
        results,
        emptyReason,
        retrievalStageCounts,
        similarityThreshold,
        searchError,
      }) => ({
        query,
        slot,
        outfitId,
        mainCategory,
        resultCount: results.length,
        results: results.map(toResultItem),
        ...(emptyReason != null ? { emptyReason } : {}),
        ...(retrievalStageCounts ? { retrievalStageCounts } : {}),
        ...(similarityThreshold != null ? { similarityThreshold } : {}),
        ...(searchError ? { searchError } : {}),
      })
    ),
    mergedResults: params.mergedResults.map(toResultItem),
    totalUniqueItems: params.mergedResults.length,
  };
}
