import { appendFile, mkdir } from 'fs/promises';
import path from 'path';
import type { WardrobeSearchResult } from './wardrobeService';

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
}

const RAG_LOG_PATH = path.join(process.cwd(), 'logs', 'rag-search.jsonl');

function toResultItem(item: WardrobeSearchResult): RagSearchResultItem {
  return {
    id: item.id,
    subCategory: item.subCategory,
    mainCategory: item.mainCategory,
    description: item.description,
    colors: item.colors,
    similarity: item.similarity,
    imageUrl: item.imageUrl,
  };
}

export async function logRagSearch(entry: RagSearchLogEntry): Promise<void> {
  const line = JSON.stringify(entry);

  console.log('[RAG_AUDIT_LOG]', line);

  try {
    await mkdir(path.dirname(RAG_LOG_PATH), { recursive: true });
    await appendFile(RAG_LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('[RAG_AUDIT_LOG] Failed to persist RAG search log:', error);
  }
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
}): RagSearchLogEntry {
  return {
    timestamp: new Date().toISOString(),
    userId: params.userId,
    source: params.source,
    conversationId: params.conversationId,
    userMessage: params.userMessage,
    intent: params.intent,
    anchorItem: params.anchorItem,
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
