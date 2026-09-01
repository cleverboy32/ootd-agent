import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Type } from '@google/genai';
import {
  contentsToOpenAIMessages,
  extractJsonText,
  googleSchemaToJsonSchema,
} from '@/server/services/llm/convert';

describe('googleSchemaToJsonSchema', () => {
  it('maps nested Google Schema to JSON Schema types', () => {
    const json = googleSchemaToJsonSchema({
      type: Type.OBJECT,
      properties: {
        approved: { type: Type.BOOLEAN, description: 'ok?' },
        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['approved'],
    });

    assert.equal(json.type, 'object');
    assert.deepEqual(json.required, ['approved']);
    const properties = json.properties as Record<string, { type: string; items?: { type: string } }>;
    assert.equal(properties.approved.type, 'boolean');
    assert.equal(properties.tags.type, 'array');
    assert.equal(properties.tags.items?.type, 'string');
  });
});

describe('contentsToOpenAIMessages', () => {
  it('maps model role and inline image to OpenAI format', () => {
    const messages = contentsToOpenAIMessages(
      [
        { role: 'user', parts: [{ text: 'hello' }] },
        { role: 'model', parts: [{ text: 'hi' }] },
        {
          role: 'user',
          parts: [
            { text: 'look' },
            { inlineData: { data: 'abc', mimeType: 'image/png' } },
          ],
        },
      ],
      'be concise'
    );

    assert.equal(messages[0]?.role, 'system');
    assert.equal(messages[1]?.role, 'user');
    assert.equal(messages[1]?.content, 'hello');
    assert.equal(messages[2]?.role, 'assistant');
    assert.equal(messages[2]?.content, 'hi');
    assert.equal(messages[3]?.role, 'user');
    assert.ok(Array.isArray(messages[3]?.content));
  });
});

describe('extractJsonText', () => {
  it('unwraps markdown fences', () => {
    assert.equal(extractJsonText('```json\n{"a":1}\n```'), '{"a":1}');
  });

  it('extracts embedded JSON object from prose', () => {
    assert.equal(
      extractJsonText('Here is the result:\n{"mainCategory":"TOP"}\nThanks'),
      '{"mainCategory":"TOP"}'
    );
  });
});
