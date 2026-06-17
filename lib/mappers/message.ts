import type { ImageState, Message, MessageContentPart, WardrobeCandidateItem } from '@/lib/types';

type DbMessage = {
  id: string;
  role: string;
  content: unknown;
  status: string;
  timestamp?: string | Date;
  createdAt?: string | Date;
};

function extractTextPart(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const textPart = content.find((p) => p?.type === 'text');
  return typeof textPart?.content === 'string' ? textPart.content : '';
}

function extractImageStates(content: unknown): Record<string, ImageState> | undefined {
  if (!Array.isArray(content)) return undefined;
  const node = content.find((p) => p?.type === 'image_states');
  if (!node?.states || typeof node.states !== 'object') return undefined;
  return node.states as Record<string, ImageState>;
}

function extractWardrobeCandidatesPart(content: unknown): MessageContentPart | null {
  if (!Array.isArray(content)) return null;
  const node = content.find((p) => p?.type === 'wardrobe_candidates');
  if (!node?.items || !Array.isArray(node.items) || node.items.length === 0) return null;
  return {
    type: 'wardrobe_candidates',
    content: typeof node.prompt === 'string' ? node.prompt : '',
    wardrobeCandidates: node.items as WardrobeCandidateItem[],
  };
}

/** Map API/DB message to client Message (hide stylist_cache, restore imageStates). */
export function mapDbMessageToClient(db: DbMessage): Message {
  const text = extractTextPart(db.content);
  const imageStates = extractImageStates(db.content);
  const wardrobePart = extractWardrobeCandidatesPart(db.content);

  const content: MessageContentPart[] = text ? [{ type: 'text', content: text }] : [];
  if (wardrobePart) content.push(wardrobePart);

  const ts = db.timestamp ?? db.createdAt;
  const timestamp =
    ts instanceof Date ? ts.getTime() : ts ? new Date(ts).getTime() : Date.now();

  return {
    id: db.id,
    role: db.role as 'user' | 'ai',
    status: (db.status as Message['status']) ?? 'completed',
    content,
    timestamp,
    imageStates,
  };
}

export function mapDbMessagesToClient(messages: DbMessage[]): Message[] {
  return messages.map(mapDbMessageToClient);
}
