import type { Content, Part, Schema } from '@google/genai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const JSON_TYPE_MAP: Record<string, string> = {
  OBJECT: 'object',
  STRING: 'string',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  NUMBER: 'number',
  INTEGER: 'integer',
};

export type JsonSchema = Record<string, unknown>;

export function googleSchemaToJsonSchema(schema: Schema): JsonSchema {
  const typeName = String(schema.type ?? 'OBJECT')
    .replace(/^Type\./, '')
    .toUpperCase();
  const jsonType = JSON_TYPE_MAP[typeName] ?? 'object';
  const result: JsonSchema = { type: jsonType };

  if (schema.description) result.description = schema.description;

  if (jsonType === 'object') {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      properties[key] = googleSchemaToJsonSchema(value as Schema);
    }
    result.properties = properties;
    if (schema.required?.length) result.required = schema.required;
  }

  if (jsonType === 'array' && schema.items) {
    result.items = googleSchemaToJsonSchema(schema.items as Schema);
  }

  return result;
}

function isContentArray(value: unknown): value is Content[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'object' &&
    value[0] !== null &&
    'role' in (value[0] as object)
  );
}

function isPart(value: unknown): value is Part {
  if (!value || typeof value !== 'object') return false;
  const v = value as Part;
  return Boolean(v.text || v.inlineData);
}

export function normalizeContents(
  contents: Content[] | Part[] | Part | string
): Content[] {
  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }
  if (isContentArray(contents)) return contents;
  if (Array.isArray(contents)) {
    return [{ role: 'user', parts: contents.filter(isPart) }];
  }
  if (isPart(contents)) {
    return [{ role: 'user', parts: [contents] }];
  }
  return [];
}

function partToOpenAIContent(
  part: Part
): { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } | null {
  if (part.thought) return null;
  if (part.inlineData?.data) {
    const mime = part.inlineData.mimeType || 'image/jpeg';
    return {
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${part.inlineData.data}` },
    };
  }
  if (typeof part.text === 'string' && part.text.length > 0) {
    return { type: 'text', text: part.text };
  }
  return null;
}

export function contentsToOpenAIMessages(
  contents: Content[] | Part[] | Part | string,
  systemInstruction?: string
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];
  if (systemInstruction?.trim()) {
    messages.push({ role: 'system', content: systemInstruction.trim() });
  }

  for (const content of normalizeContents(contents)) {
    const pieces = (content.parts ?? [])
      .map(partToOpenAIContent)
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (pieces.length === 0) continue;

    const role = content.role === 'model' || content.role === 'assistant' ? 'assistant' : 'user';
    const textOnly = pieces.every((p) => p.type === 'text');
    const text = pieces.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
    if (role === 'assistant') {
      messages.push({ role: 'assistant', content: text });
    } else {
      messages.push({ role: 'user', content: textOnly ? text : pieces });
    }
  }

  return messages;
}

export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}
