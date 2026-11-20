/**
 * 进入仍为 generating 的会话时：挂 resume SSE，从空内容按 buffer 重建气泡。
 */
import { markProfileCacheDirty } from '@/lib/api/profile';
import {
  beginGeneration,
  endGeneration,
  isCurrentGeneration,
  setActiveAiMessageId,
} from '@/lib/chat/activeGeneration';
import { resumeGenerationStream, type StreamHandlers } from '@/lib/utils';
import type { Message, MessageContentPart } from '@/lib/types';

type UpdateMessages = (updater: (messages: Message[]) => Message[]) => void;

function findGeneratingAiId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === 'ai' && m.status === 'generating') return m.id;
  }
  return null;
}

function buildResumeHandlers(params: {
  generationId: number;
  messageId: string;
  updateMessages: UpdateMessages;
  setWaitReply: (waiting: boolean) => void;
}): StreamHandlers {
  const { generationId, messageId, updateMessages, setWaitReply } = params;
  const stillCurrent = () => isCurrentGeneration(generationId);
  let streamHasError = false;

  return {
    onMetadata: (data) => {
      if (!stillCurrent()) return;
      // replay 的 metadata 应与目标一致；忽略错绑
      if (data.messageId && data.messageId !== messageId) return;
      setActiveAiMessageId(messageId);
    },
    onTextChunk: (text) => {
      if (!stillCurrent()) return;
      updateMessages((currentMessages) =>
        currentMessages.map((msg) => {
          if (msg.id !== messageId || msg.role !== 'ai' || !Array.isArray(msg.content)) {
            return msg;
          }
          const lastPart = msg.content.at(-1);
          let newContent: MessageContentPart[];
          if (lastPart && lastPart.type === 'text') {
            newContent = [
              ...msg.content.slice(0, -1),
              { ...lastPart, content: lastPart.content + text },
            ];
          } else {
            newContent = [...msg.content, { type: 'text', content: text }];
          }
          const hadText = msg.content.some((p) => p.type === 'text' && p.content.length > 0);
          return {
            ...msg,
            content: newContent,
            progress:
              !hadText && msg.progress?.thinking
                ? { ...msg.progress, thinking: undefined }
                : msg.progress,
          };
        })
      );
    },
    onImagePlaceholder: () => {},
    onImageGenerated: (data) => {
      if (!stillCurrent()) return;
      updateMessages((messages) =>
        messages.map((msg) => {
          if (msg.id !== messageId || msg.role !== 'ai') return msg;
          return {
            ...msg,
            imageStates: { ...msg.imageStates, [data.id]: data.imageUrl },
          };
        })
      );
    },
    onImageGenerationFailed: (data) => {
      if (!stillCurrent()) return;
      updateMessages((messages) =>
        messages.map((msg) => {
          if (msg.id !== messageId || msg.role !== 'ai') return msg;
          return {
            ...msg,
            imageStates: { ...msg.imageStates, [data.id]: 'failed' as const },
          };
        })
      );
    },
    onImageCreditsRequired: (data) => {
      if (!stillCurrent()) return;
      updateMessages((messages) =>
        messages.map((msg) => {
          if (msg.id !== messageId || msg.role !== 'ai') return msg;
          return {
            ...msg,
            imageStates: { ...msg.imageStates, [data.id]: 'credits_required' as const },
          };
        })
      );
    },
    onProgress: (data) => {
      if (!stillCurrent()) return;
      updateMessages((messages) =>
        messages.map((msg) => {
          if (msg.id !== messageId || msg.role !== 'ai') return msg;
          const existing = msg.progress ?? { stages: [] };
          const stageIdx = existing.stages.findIndex((s) => s.key === data.stage);
          let newStages = [...existing.stages];
          if (stageIdx >= 0) {
            newStages[stageIdx] = {
              ...newStages[stageIdx],
              done: data.done ?? false,
              ...(data.label && { label: data.label }),
            };
          } else if (!data.done) {
            newStages = [...newStages, { key: data.stage, label: data.label ?? '', done: false }];
          }
          return {
            ...msg,
            progress: {
              stages: newStages,
              thinking: data.thinking !== undefined ? data.thinking : existing.thinking,
            },
          };
        })
      );
    },
    onWardrobeCandidates: (data) => {
      if (!stillCurrent()) return;
      updateMessages((messages) =>
        messages.map((msg) => {
          if (msg.id !== messageId || msg.role !== 'ai') return msg;
          const withoutOld = msg.content.filter((p) => p.type !== 'wardrobe_candidates');
          return {
            ...msg,
            content: [
              ...withoutOld,
              {
                type: 'wardrobe_candidates' as const,
                content: '',
                wardrobeCandidates: data.items,
              },
            ],
          };
        })
      );
    },
    onError: () => {
      if (!stillCurrent()) return;
      streamHasError = true;
      updateMessages((messages) =>
        messages.map((m) =>
          m.id === messageId ? { ...m, status: 'failed' as const } : m
        )
      );
      setWaitReply(false);
      endGeneration(generationId);
    },
    onCancelled: () => {
      if (!stillCurrent()) return;
      // 连发超车：beginGeneration 已 abort；此处勿把仍 generating 的库状态标 cancelled（服务端会落库）
      setWaitReply(false);
      endGeneration(generationId);
    },
    onStreamEnd: () => {
      if (!stillCurrent()) return;
      if (streamHasError) {
        endGeneration(generationId);
        return;
      }
      updateMessages((messages) =>
        messages.map((m) => {
          if (m.id !== messageId) return m;
          if (m.status === 'cancelled') return m;
          return {
            ...m,
            status: 'completed' as const,
            progress: m.progress
              ? { ...m.progress, stages: m.progress.stages.map((s) => ({ ...s, done: true })) }
              : undefined,
          };
        })
      );
      markProfileCacheDirty();
      setWaitReply(false);
      endGeneration(generationId);
    },
  };
}

export type ResumeGeneratingDeps = {
  getMessages: () => Message[];
  updateMessages: UpdateMessages;
  setWaitReply: (waiting: boolean) => void;
  /** resume 404 时短轮询兜底 */
  startPollFallback: () => void;
  /** 终态时拉一次消息 */
  refreshMessages: () => Promise<void>;
};

/** 若有 generating AI 且本 Tab 无 live 流，则挂 resume。 */
export async function maybeResumeGeneratingMessage(
  deps: ResumeGeneratingDeps
): Promise<void> {
  const messageId = findGeneratingAiId(deps.getMessages());
  if (!messageId) return;

  const { generationId, signal } = beginGeneration();
  setActiveAiMessageId(messageId);
  deps.setWaitReply(true);

  // 从空内容重建，避免与半截缓存混叠
  deps.updateMessages((messages) =>
    messages.map((m) =>
      m.id === messageId && m.role === 'ai'
        ? {
            ...m,
            content: [],
            imageStates: undefined,
            progress: undefined,
            status: 'generating' as const,
          }
        : m
    )
  );

  const handlers = buildResumeHandlers({
    generationId,
    messageId,
    updateMessages: deps.updateMessages,
    setWaitReply: deps.setWaitReply,
  });

  const result = await resumeGenerationStream(messageId, handlers, { signal });
  if (!isCurrentGeneration(generationId)) return;

  if (result === 'terminal') {
    await deps.refreshMessages();
    deps.setWaitReply(false);
    endGeneration(generationId);
    return;
  }

  if (result === 'unavailable') {
    endGeneration(generationId);
    deps.startPollFallback();
    return;
  }

  // ok：handlers 已在 stream_end / cancel / error 里 endGeneration
}