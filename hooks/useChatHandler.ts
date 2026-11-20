// hooks/useChatHandler.ts
import { useCallback } from 'react';
import { useChatStore } from '@/store/chat';
import { streamResponse } from '@/lib/utils';
import { extractUserMessageMedia } from '@/lib/messageMedia';
import { takePurchaseUploadUrls } from '@/lib/purchaseUploads';
import { Message, MessageContentPart } from '@/lib/types';
import { useAccess } from '@/components/access/AccessProvider';
import { useOnboardingStore } from '@/store/onboarding';
import { markProfileCacheDirty } from '@/lib/api/profile';
import {
  beginGeneration,
  endGeneration,
  isCurrentGeneration,
  setActiveAiMessageId,
} from '@/lib/chat/activeGeneration';

function markGeneratingAiCancelled(
  updateMessages: (updater: (messages: Message[]) => Message[]) => void,
  preferredId?: string | null
): void {
  updateMessages((messages) => {
    let targetId = preferredId ?? null;
    if (!targetId) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m.role === 'ai' && m.status === 'generating') {
          targetId = m.id;
          break;
        }
      }
    }
    if (!targetId) return messages;
    return messages.map((m) =>
      m.id === targetId && m.status === 'generating' ? { ...m, status: 'cancelled' as const } : m
    );
  });
}

export const useChatHandler = () => {
  const { canInvokeAI } = useAccess();
  const {
    activeConversationId,
    startNewConversation,
    persistNewConversation,
    addUserMessage,
    updateMessages,
    setWaitReply,
  } = useChatStore();

  const handleSend = useCallback(async (
    promptOrMessage: string | Message,
    imageUrl?: string | string[] | null
  ) => {
    if (!canInvokeAI) return;

    const onboarding = useOnboardingStore.getState();
    if (onboarding.step === 'chat') {
      onboarding.completeChat();
    }

    let conversationId = activeConversationId;
    let messageToRetry: Message | undefined = undefined;
    let pendingUserMessage: Message | undefined;

    if (typeof promptOrMessage !== 'string') {
      messageToRetry = promptOrMessage;
      if (!conversationId) {
        console.error("Retry failed: activeConversationId is missing.");
        return;
      }
    } else {
      const prompt = promptOrMessage;
      const imageUrls = takePurchaseUploadUrls(Array.isArray(imageUrl) ? imageUrl : [imageUrl]);
      if (!prompt.trim() && imageUrls.length === 0) return;

      const userMessageContent: MessageContentPart[] = [];
      if (prompt.trim()) {
        userMessageContent.push({ type: 'text', content: prompt });
      }
      for (const url of imageUrls) {
        userMessageContent.push({ type: 'image', content: url });
      }

      pendingUserMessage = {
        id: `user-${Date.now()}`,
        status: 'completed',
        role: 'user',
        content: userMessageContent,
        timestamp: Date.now(),
        imageUrl: imageUrls[0],
      };
    }

    // 校验通过后再打断上一轮
    const prevAiId = (() => {
      const messages = useChatStore.getState().messages;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m.role === 'ai' && m.status === 'generating') return m.id;
      }
      return null;
    })();
    const { generationId, signal } = beginGeneration();
    if (prevAiId) markGeneratingAiCancelled(updateMessages, prevAiId);
    setWaitReply(true);

    if (messageToRetry) {
      console.log(`[HANDLER] Retrying message with ID: ${messageToRetry.id}`);
      updateMessages(messages => messages.map(m =>
        m.id === messageToRetry!.id ? { ...m, status: 'generating' } : m
      ));
      setActiveAiMessageId(messageToRetry.id);
    } else if (pendingUserMessage) {
      if (!conversationId) {
        conversationId = await startNewConversation(pendingUserMessage);
      } else {
        await addUserMessage(pendingUserMessage);
      }
    }

    if (!isCurrentGeneration(generationId)) return;

    if (!conversationId) {
      console.error("无法获取有效的会话ID。");
      setWaitReply(false);
      endGeneration(generationId);
      return;
    }

    let currentAiMessageId = messageToRetry ? messageToRetry.id : '';
    let streamHasError = false;

    const stillCurrent = () => isCurrentGeneration(generationId);

    const handlers = {
      onMetadata: (data: { messageId: string }) => {
        if (!stillCurrent()) return;
        console.log(`[METADATA RECEIVED] AI Message ID is: ${data.messageId}`);
        currentAiMessageId = data.messageId;
        setActiveAiMessageId(data.messageId);

        if (!messageToRetry) {
          const initialAiMessage: Message = {
            id: currentAiMessageId,
            status: 'generating',
            role: 'ai',
            content: [],
            timestamp: Date.now(),
          };
          updateMessages((messages) => [...messages, initialAiMessage]);
        }
      },
      onTextChunk: (text: string) => {
        if (!stillCurrent()) return;
        updateMessages(currentMessages => currentMessages.map(msg => {
          if (msg.id === currentAiMessageId && msg.role === 'ai' && Array.isArray(msg.content)) {
            const lastPart = msg.content.at(-1);
            let newContent: MessageContentPart[];

            if (lastPart && lastPart.type === 'text') {
              newContent = [
                ...msg.content.slice(0, -1),
                { ...lastPart, content: lastPart.content + text }
              ];
            } else {
              const newTextPart: MessageContentPart = { type: 'text', content: text };
              newContent = [...msg.content, newTextPart];
            }
            const hadText = msg.content.some((p) => p.type === 'text' && p.content.length > 0);
            return {
              ...msg,
              content: newContent,
              progress: !hadText && msg.progress?.thinking
                ? { ...msg.progress, thinking: undefined }
                : msg.progress,
            };
          }
          return msg;
        }));
      },
      onImagePlaceholder: () => {},
      onImageGenerated: (data: { id: string; imageUrl: string; alt: string }) => {
        if (!stillCurrent()) return;
        updateMessages(messages => messages.map(msg => {
          if (msg.id === currentAiMessageId && msg.role === 'ai') {
            return {
              ...msg,
              imageStates: { ...msg.imageStates, [data.id]: data.imageUrl },
            };
          }
          return msg;
        }));
      },
      onImageGenerationFailed: (data: { id: string; message: string; alt: string }) => {
        if (!stillCurrent()) return;
        updateMessages(messages => messages.map(msg => {
          if (msg.id === currentAiMessageId && msg.role === 'ai') {
            return {
              ...msg,
              imageStates: { ...msg.imageStates, [data.id]: 'failed' as const },
            };
          }
          return msg;
        }));
      },
      onImageCreditsRequired: (data: { id: string; message: string; alt: string }) => {
        if (!stillCurrent()) return;
        updateMessages(messages => messages.map(msg => {
          if (msg.id === currentAiMessageId && msg.role === 'ai') {
            return {
              ...msg,
              imageStates: { ...msg.imageStates, [data.id]: 'credits_required' as const },
            };
          }
          return msg;
        }));
      },
      onProgress: (data: { stage: string; label?: string; done?: boolean; thinking?: string }) => {
        if (!stillCurrent()) return;
        updateMessages(messages => messages.map(msg => {
          if (msg.id !== currentAiMessageId || msg.role !== 'ai') return msg;
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
        }));
      },
      onWardrobeCandidates: (data: { items: Array<{ id: string; imageUrl: string; subCategory: string; colors: string[] }> }) => {
        if (!stillCurrent()) return;
        updateMessages(messages => messages.map(msg => {
          if (msg.id === currentAiMessageId && msg.role === 'ai') {
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
          }
          return msg;
        }));
      },
      onError: (message: string) => {
        if (!stillCurrent()) return;
        streamHasError = true;
        if (currentAiMessageId) {
          updateMessages(messages => messages.map(m => {
            if (m.id !== currentAiMessageId) return m;
            return { ...m, status: 'failed' as const };
          }));
        } else {
          updateMessages(messages => {
            const lastUserIdx = [...messages].map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === 'user')?.i;
            if (lastUserIdx == null) return messages;
            return messages.map((m, i) => i === lastUserIdx ? { ...m, sendFailed: true } : m);
          });
        }
        console.error("Stream error:", message);
        setWaitReply(false);
        endGeneration(generationId);
      },
      onCancelled: () => {
        if (!stillCurrent()) return;
        if (currentAiMessageId) {
          markGeneratingAiCancelled(updateMessages, currentAiMessageId);
        }
        setWaitReply(false);
        endGeneration(generationId);
      },
      onStreamEnd: () => {
        if (!stillCurrent()) return;
        if (streamHasError) {
          console.log("[HANDLER] Stream ended, but an error was flagged. Skipping 'completed' status update.");
          endGeneration(generationId);
          return;
        }
        if (currentAiMessageId) {
          updateMessages(messages => messages.map(m => {
            if (m.id !== currentAiMessageId) return m;
            if (m.status === 'cancelled') return m;
            return {
              ...m,
              status: 'completed' as const,
              progress: m.progress
                ? { ...m.progress, stages: m.progress.stages.map((s) => ({ ...s, done: true })) }
                : undefined,
            };
          }));
        }
        markProfileCacheDirty();
        setWaitReply(false);
        endGeneration(generationId);
      },
    };

    const payload: {
      conversationId: string;
      messageId?: string;
      content?: { text: string; imageUrl?: string; imageUrls?: string[] };
    } = { conversationId };

    let textPrompt = '';
    let imageUrlsForPayload = takePurchaseUploadUrls(
      Array.isArray(imageUrl) ? imageUrl : [imageUrl]
    );

    if (messageToRetry) {
      payload.messageId = messageToRetry.id;
      const messages = useChatStore.getState().messages;
      const retryMsgIndex = messages.findIndex(m => m.id === messageToRetry?.id);
      const originalUserMessage = messages[retryMsgIndex - 1];

      if (originalUserMessage && originalUserMessage.role === 'user') {
          const media = extractUserMessageMedia(originalUserMessage);
          textPrompt = media.text;
          imageUrlsForPayload = media.imageUrls;
      } else {
        console.warn("Could not reliably find original user prompt for retry.");
      }
    } else {
      const lastMessage = useChatStore.getState().messages.at(-1);
      if (lastMessage && lastMessage.role === 'user') {
        const media = extractUserMessageMedia(lastMessage);
        textPrompt = media.text;
        if (imageUrlsForPayload.length === 0) {
          imageUrlsForPayload = media.imageUrls;
        }
      }
    }

    payload.content = {
      text: textPrompt,
      imageUrl: imageUrlsForPayload[0],
      imageUrls: imageUrlsForPayload,
    };
    await streamResponse(payload as Parameters<typeof streamResponse>[0], handlers, { signal });

  }, [
    activeConversationId,
    startNewConversation,
    addUserMessage,
    updateMessages,
    setWaitReply,
    canInvokeAI,
  ]);

  const handleRetrySend = useCallback(async (failedUserMsg: Message) => {
    if (!canInvokeAI) return;

    updateMessages(messages =>
      messages.map(m => m.id === failedUserMsg.id ? { ...m, sendFailed: false } : m)
    );

    const { text: textPrompt, imageUrl, imageUrls } = extractUserMessageMedia(failedUserMsg);

    const prevAiId = (() => {
      const messages = useChatStore.getState().messages;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m.role === 'ai' && m.status === 'generating') return m.id;
      }
      return null;
    })();
    const { generationId, signal } = beginGeneration();
    if (prevAiId) markGeneratingAiCancelled(updateMessages, prevAiId);

    setWaitReply(true);

    const conversationId = activeConversationId ?? await persistNewConversation(failedUserMsg);
    if (!isCurrentGeneration(generationId)) return;
    if (!conversationId) {
      setWaitReply(false);
      endGeneration(generationId);
      return;
    }

    let currentAiMessageId = '';
    const stillCurrent = () => isCurrentGeneration(generationId);

    const handlers = {
      onMetadata: (data: { messageId: string }) => {
        if (!stillCurrent()) return;
        currentAiMessageId = data.messageId;
        setActiveAiMessageId(data.messageId);
        updateMessages(messages => [
          ...messages,
          { id: currentAiMessageId, role: 'ai' as const, status: 'generating' as const, content: [], timestamp: Date.now() },
        ]);
      },
      onTextChunk: (text: string) => {
        if (!stillCurrent() || !currentAiMessageId) return;
        updateMessages(messages => messages.map(m => {
          if (m.id !== currentAiMessageId) return m;
          const lastPart = m.content[m.content.length - 1];
          if (lastPart?.type === 'text') {
            return { ...m, content: [...m.content.slice(0, -1), { type: 'text' as const, content: lastPart.content + text }] };
          }
          return { ...m, content: [...m.content, { type: 'text' as const, content: text }] };
        }));
      },
      onImagePlaceholder: () => {},
      onImageGenerated: (data: { id: string; imageUrl: string; alt: string }) => {
        if (!stillCurrent() || !currentAiMessageId) return;
        updateMessages(messages => messages.map(m => {
          if (m.id !== currentAiMessageId || m.role !== 'ai') return m;
          return { ...m, imageStates: { ...m.imageStates, [data.id]: data.imageUrl } };
        }));
      },
      onImageGenerationFailed: (data: { id: string; message: string; alt: string }) => {
        if (!stillCurrent() || !currentAiMessageId) return;
        updateMessages(messages => messages.map(m => {
          if (m.id !== currentAiMessageId || m.role !== 'ai') return m;
          return { ...m, imageStates: { ...m.imageStates, [data.id]: 'failed' as const } };
        }));
      },
      onImageCreditsRequired: (data: { id: string; message: string; alt: string }) => {
        if (!stillCurrent() || !currentAiMessageId) return;
        updateMessages(messages => messages.map(m => {
          if (m.id !== currentAiMessageId || m.role !== 'ai') return m;
          return { ...m, imageStates: { ...m.imageStates, [data.id]: 'credits_required' as const } };
        }));
      },
      onStreamEnd: () => {
        if (!stillCurrent()) return;
        markProfileCacheDirty();
        setWaitReply(false);
        if (currentAiMessageId) {
          updateMessages(messages => messages.map(m =>
            m.id !== currentAiMessageId || m.status === 'cancelled'
              ? m
              : { ...m, status: 'completed' as const }
          ));
        }
        endGeneration(generationId);
      },
      onProgress: (data: { stage: string; label?: string; done?: boolean; thinking?: string }) => {
        if (!stillCurrent() || !currentAiMessageId) return;
        updateMessages(messages => messages.map(m => {
          if (m.id !== currentAiMessageId) return m;
          const existing = m.progress?.stages ?? [];
          const hasStage = existing.some(s => s.key === data.stage);
          const stages = hasStage
            ? existing.map(s => s.key === data.stage ? { ...s, done: data.done ?? false, label: data.label ?? s.label } : s)
            : [...existing, { key: data.stage, label: data.label ?? '', done: data.done ?? false }];
          return { ...m, progress: { stages, thinking: data.thinking !== undefined ? data.thinking : m.progress?.thinking } };
        }));
      },
      onCancelled: () => {
        if (!stillCurrent()) return;
        if (currentAiMessageId) markGeneratingAiCancelled(updateMessages, currentAiMessageId);
        setWaitReply(false);
        endGeneration(generationId);
      },
      onError: () => {
        if (!stillCurrent()) return;
        setWaitReply(false);
        updateMessages(messages =>
          messages.map(m => m.id === failedUserMsg.id ? { ...m, sendFailed: true } : m)
        );
        endGeneration(generationId);
      },
    };

    await streamResponse(
      { conversationId, content: { text: textPrompt, imageUrl, imageUrls } } as Parameters<typeof streamResponse>[0],
      handlers,
      { signal },
    );
  }, [activeConversationId, canInvokeAI, persistNewConversation, updateMessages, setWaitReply]);

  return { handleSend, handleRetrySend, canInvokeAI };
};
