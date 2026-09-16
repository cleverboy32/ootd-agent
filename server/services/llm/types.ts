import type { Content, Part, Schema } from '@google/genai';

export type LlmProvider = 'openai' | 'vertex';

export type LlmCapability = 'chat' | 'image' | 'embedding';

export interface LlmGenerateOptions {
  model: string;
  contents: Content[] | Part[] | Part | string;
  systemInstruction?: string;
  temperature?: number;
  jsonSchema?: Schema;
  signal?: AbortSignal;
}

export interface LlmGenerateResult {
  text: string;
}
