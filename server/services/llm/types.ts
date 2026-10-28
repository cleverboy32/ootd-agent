import type { Content, Part, Schema } from '@google/genai';

export type LlmProvider = 'openai' | 'vertex';

export type LlmCapability = 'chat' | 'image' | 'embedding';

export interface LlmGenerateOptions {
  model: string;
  contents: Content[] | Part[] | Part | string;
  systemInstruction?: string;
  temperature?: number;
  /** 限制补全长度；短 JSON 调用（选 skill / critic）务必设置，避免上游空转生成。 */
  maxTokens?: number;
  /**
   * DeepSeek V4：thinking 默认开启，且与 max_tokens 共用预算；
   * 短 JSON 必须 disabled，否则推理吃光额度后 content 为空。
   */
  thinking?: 'enabled' | 'disabled';
  jsonSchema?: Schema;
  signal?: AbortSignal;
}

export interface LlmGenerateResult {
  text: string;
}
