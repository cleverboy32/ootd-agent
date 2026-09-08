import type { RunnableConfig } from '@langchain/core/runnables';
import type { OutfitRuntime } from './state';

/** Whether LangSmith env tracing is turned on (LANGSMITH_TRACING / legacy V2). */
export function isLangSmithTracingEnabled(): boolean {
  const flag =
    process.env.LANGSMITH_TRACING ??
    process.env.LANGSMITH_TRACING_V2 ??
    process.env.LANGCHAIN_TRACING_V2;
  return String(flag).toLowerCase() === 'true';
}

export function logLangSmithStatusOnce(): void {
  if ((globalThis as { __ootdLangSmithLogged?: boolean }).__ootdLangSmithLogged) {
    return;
  }
  (globalThis as { __ootdLangSmithLogged?: boolean }).__ootdLangSmithLogged = true;

  const enabled = isLangSmithTracingEnabled();
  const hasKey = Boolean(
    process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY
  );
  const projectRaw =
    process.env.LANGSMITH_PROJECT ??
    process.env.LANGCHAIN_PROJECT ??
    '(default)';
  const project = projectRaw.replace(/^["']|["']$/g, '');

  if (enabled && hasKey) {
    console.log(
      `[LANGSMITH] tracing on · project=${project} · graph runs will appear at smith.langchain.com`
    );
  } else if (enabled && !hasKey) {
    console.warn(
      '[LANGSMITH] LANGSMITH_TRACING=true but LANGSMITH_API_KEY is missing — traces will not upload'
    );
  } else {
    console.log(
      '[LANGSMITH] tracing off · set LANGSMITH_TRACING=true and LANGSMITH_API_KEY to view graph runs'
    );
  }
}

/**
 * Build invoke config for outfit pipelines: keeps `configurable.runtime`
 * and attaches LangSmith-friendly runName / tags / metadata.
 */
export function buildPipelineInvokeConfig(params: {
  runtime: OutfitRuntime;
  pipeline: 'outfit_fresh' | 'outfit_cache';
  conversationId?: string;
  clientId?: string;
  messageId?: string;
}): RunnableConfig {
  const { runtime, pipeline, conversationId, clientId, messageId } = params;
  const resolvedMessageId = messageId ?? runtime.getMessageId();

  return {
    configurable: { runtime },
    runName: pipeline,
    tags: ['ootd-agent', 'outfit-pipeline', pipeline],
    metadata: {
      conversationId: conversationId ?? runtime.conversationId,
      clientId: clientId ?? runtime.clientId,
      messageId: resolvedMessageId,
      pipeline,
    },
  };
}
