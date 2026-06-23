import type { WardrobeSearchResult } from '@/server/services/wardrobeService';
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
  queries: Array<{
    query: string;
    slot?: string;
    mainCategory?: string;
  }>;
  perQueryResults: Array<{
    query: string;
    slot?: string;
    mainCategory?: string;
    resultCount: number;
    results: RagSearchResultItem[];
  }>;
  mergedResults: RagSearchResultItem[];
  totalUniqueItems: number;
  seasonFilter?: {
    dressingClimate?: string;
    targetSeasons: string[];
    isWarmWeather: boolean;
    strictColdActivity: boolean;
  };
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
  queries: Array<{ query: string; slot?: string; mainCategory?: string }>;
  perQueryResults: Array<{
    query: string;
    slot?: string;
    mainCategory?: string;
    results: WardrobeSearchResult[];
  }>;
  mergedResults: WardrobeSearchResult[];
  source?: string;
  conversationId?: string;
  userMessage?: string;
  intent?: RagSearchIntentLog;
  anchorItem?: RagSearchAnchorLog;
  seasonFilter?: {
    dressingClimate?: string;
    targetSeasons: string[];
    isWarmWeather: boolean;
    strictColdActivity: boolean;
  };
}): RagSearchLogEntry {
  return {
    timestamp: new Date().toISOString(),
    userId: params.userId,
    source: params.source,
    conversationId: params.conversationId,
    userMessage: params.userMessage,
    intent: params.intent,
    anchorItem: params.anchorItem,
    seasonFilter: params.seasonFilter,
    queries: params.queries.map(({ query, slot, mainCategory }) => ({
      query,
      slot,
      mainCategory,
    })),
    perQueryResults: params.perQueryResults.map(({ query, slot, mainCategory, results }) => ({
      query,
      slot,
      mainCategory,
      resultCount: results.length,
      results: results.map(toResultItem),
    })),
    mergedResults: params.mergedResults.map(toResultItem),
    totalUniqueItems: params.mergedResults.length,
  };
}
