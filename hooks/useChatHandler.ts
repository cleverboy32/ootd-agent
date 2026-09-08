// hooks/useChatHandler.ts
import { useCallback } from 'react';
import { useChatStore } from '@/store/chat';
import { streamResponse } from '@/lib/utils';
import { extractUserMessageMedia } from '@/lib/messageMedia';
import { Message, MessageContentPart } from '@/lib/types';
import { useAccess } from '@/components/access/AccessProvider';

export const useChatHandler = () => {
  const { canInvokeAI } = useAccess();
  const {
    activeConversationId,
    startNewConversation,
    addUserMessage,
    updateMessages,
    setWaitReply,
  } = useChatStore();

  const handleSend = useCallback(async (
    promptOrMessage: string | Message,
    imageUrl?: string | null
  ) => {
    if (!canInvokeAI) return;

    setWaitReply(true);
    let conversationId = activeConversationId;
    let messageToRetry: Message | undefined = undefined;

    // --- 1. 确定是新消息还是重试消息 ---
    if (typeof promptOrMessage !== 'string') {
      messageToRetry = promptOrMessage;
      if (!conversationId) {
        console.error("Retry failed: activeConversationId is missing.");
        setWaitReply(false);
        return;
      }
      console.log(`[HANDLER] Retrying message with ID: ${messageToRetry.id}`);
      
      // 对于重试，将消息状态重置为 'generating'
      updateMessages(messages => messages.map(m => 
        m.id === messageToRetry!.id ? { ...m, status: 'generating' } : m
      ));

    } else {
      // 这是新消息
      const prompt = promptOrMessage;
      if (!prompt.trim() && !imageUrl) {
          setWaitReply(false);
          return;
      };

      const userMessageContent: MessageContentPart[] = [];
      if (prompt.trim()) {
        userMessageContent.push({ type: 'text', content: prompt });
      }
      if (imageUrl) {
        userMessageContent.push({ type: 'image', content: imageUrl });
      }

      // 注意：现在创建用户消息也需要 id 和 status
      const userMessage: Message = {
        id: `user-${Date.now()}`, // 临时但唯一的 ID
        status: 'completed',
        role: 'user',
        content: userMessageContent,
        timestamp: Date.now(),
        imageUrl: imageUrl || undefined,
      };

      if (!conversationId) {
        conversationId = await startNewConversation(userMessage);
      } else {
        await addUserMessage(userMessage);
      }
    }
    
    if (!conversationId) {
      console.error("无法获取有效的会话ID。");
      setWaitReply(false);
      return;
    }

    // --- 2. 定义流处理程序 ---
    let currentAiMessageId = messageToRetry ? messageToRetry.id : '';
    let streamHasError = false;
    const handlers = {
      onMetadata: (data: { messageId: string }) => {
        console.log(`[METADATA RECEIVED] AI Message ID is: ${data.messageId}`);
        currentAiMessageId = data.messageId;

        // 如果是新消息（重试时不会走这里），就在收到 metadata 后创建 AI 消息
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
              // 明确地告诉 TS，这个新对象就是 MessageContentPart 类型
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
      onImagePlaceholder: () => {
        // 占位符改由文本内 [IMAGE=...] 标记内联渲染，此事件不再使用
      },
      onImageGenerated: (data: { id: string; imageUrl: string; alt: string }) => {
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
      onProgress: (data: { stage: string; label?: string; done?: boolean; thinking?: string }) => {
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
        streamHasError = true;
        if (currentAiMessageId) {
          updateMessages(messages => messages.map(m => {
            if (m.id !== currentAiMessageId) return m;
            // 只把「尚未完成」的阶段留给失败态展示；不要全部标 done，否则会全变绿勾
            return {
              ...m,
              status: 'failed' as const,
            };
          }));
        } else {
          // 请求在收到 metadata 前就失败（网络断开等）
          // 标记最后一条用户消息为 sendFailed，让用户在原消息下方看到错误和重试按钮
          updateMessages(messages => {
            const lastUserIdx = [...messages].map((m, i) => ({ m, i })).reverse().find(({ m }) => m.role === 'user')?.i;
            if (lastUserIdx == null) return messages;
            return messages.map((m, i) => i === lastUserIdx ? { ...m, sendFailed: true } : m);
          });
        }
        console.error("Stream error:", message);
        setWaitReply(false);
      },
      onStreamEnd: () => {
        if (streamHasError) {
          console.log("[HANDLER] Stream ended, but an error was flagged. Skipping 'completed' status update.");
          return;
        }
        if (currentAiMessageId) {
          updateMessages(messages => messages.map(m => {
            if (m.id !== currentAiMessageId) return m;
            return {
              ...m,
              status: 'completed' as const,
              progress: m.progress
                ? { ...m.progress, stages: m.progress.stages.map((s) => ({ ...s, done: true })) }
                : undefined,
            };
          }));
        }
        setWaitReply(false);
      },
    };

    // --- 3. 构建请求体并开始流式请求 ---
    const payload: {
      conversationId: string;
      messageId?: string;
      content?: { text: string; imageUrl?: string; };
    } = { conversationId };
    
    // 我们需要用户的原始输入，无论是新消息还是重试
    let textPrompt = '';
    let imageForPayload = imageUrl;

    if (messageToRetry) {
      payload.messageId = messageToRetry.id;
      // 对于重试，我们需要找到触发这次AI回应的原始用户消息
      const messages = useChatStore.getState().messages;
      const retryMsgIndex = messages.findIndex(m => m.id === messageToRetry?.id);
      // 假设用户消息就在AI消息之前
      const originalUserMessage = messages[retryMsgIndex - 1]; 

      if (originalUserMessage && originalUserMessage.role === 'user') {
          const media = extractUserMessageMedia(originalUserMessage);
          textPrompt = media.text;
          imageForPayload = media.imageUrl;
      } else {
        console.warn("Could not reliably find original user prompt for retry.");
      }
    } else {
      // 对于新消息，用户消息就是最后一条
      const lastMessage = useChatStore.getState().messages.at(-1);
      if (lastMessage && lastMessage.role === 'user') {
        const media = extractUserMessageMedia(lastMessage);
        textPrompt = media.text;
        if (!imageForPayload && media.imageUrl) {
          imageForPayload = media.imageUrl;
        }
      }
    }

    payload.content = { text: textPrompt, imageUrl: imageForPayload || undefined }  ;
    await streamResponse(payload as Parameters<typeof streamResponse>[0], handlers);

  }, [
    activeConversationId,
    startNewConversation,
    addUserMessage,
    updateMessages,
    setWaitReply,
    canInvokeAI,
  ]);

  /**
   * 重发一条标记为 sendFailed 的用户消息。
   * 与 handleSend 的区别：不新建用户消息，直接以原始内容重起请求。
   */
  const handleRetrySend = useCallback(async (failedUserMsg: Message) => {
    if (!canInvokeAI) return;
    const conversationId = activeConversationId;
    if (!conversationId) return;

    // 清除错误标记
    updateMessages(messages =>
      messages.map(m => m.id === failedUserMsg.id ? { ...m, sendFailed: false } : m)
    );

    const { text: textPrompt, imageUrl } = extractUserMessageMedia(failedUserMsg);

    setWaitReply(true);

    let currentAiMessageId = '';

    const handlers = {
      onMetadata: (data: { messageId: string }) => {
        currentAiMessageId = data.messageId;
        updateMessages(messages => [
          ...messages,
          { id: currentAiMessageId, role: 'ai' as const, status: 'generating' as const, content: [], timestamp: Date.now() },
        ]);
      },
      onTextChunk: (text: string) => {
        if (!currentAiMessageId) return;
        updateMessages(messages => messages.map(m => {
          if (m.id !== currentAiMessageId) return m;
          const lastPart = m.content[m.content.length - 1];
          if (lastPart?.type === 'text') {
            return { ...m, content: [...m.content.slice(0, -1), { type: 'text' as const, content: lastPart.content + text }] };
          }
          return { ...m, content: [...m.content, { type: 'text' as const, content: text }] };
        }));
      },
      onImagePlaceholder: () => {
        // 占位符改由文本内 [IMAGE=...] 标记内联渲染，此事件不再使用
      },
      onImageGenerated: (data: { id: string; imageUrl: string; alt: string }) => {
        if (!currentAiMessageId) return;
        updateMessages(messages => messages.map(m => {
          if (m.id !== currentAiMessageId || m.role !== 'ai') return m;
          return { ...m, imageStates: { ...m.imageStates, [data.id]: data.imageUrl } };
        }));
      },
      onImageGenerationFailed: (data: { id: string; message: string; alt: string }) => {
        if (!currentAiMessageId) return;
        updateMessages(messages => messages.map(m => {
          if (m.id !== currentAiMessageId || m.role !== 'ai') return m;
          return { ...m, imageStates: { ...m.imageStates, [data.id]: 'failed' as const } };
        }));
      },
      onStreamEnd: (finalMessage?: Message) => {
        setWaitReply(false);
        if (!currentAiMessageId) return;
        if (finalMessage) {
          updateMessages(messages => messages.map(m => m.id !== currentAiMessageId ? m : { ...finalMessage }));
        } else {
          updateMessages(messages => messages.map(m => m.id !== currentAiMessageId ? m : { ...m, status: 'completed' as const }));
        }
      },
      onProgress: (data: { stage: string; label?: string; done?: boolean; thinking?: string }) => {
        if (!currentAiMessageId) return;
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
      onError: () => {
        setWaitReply(false);
        updateMessages(messages =>
          messages.map(m => m.id === failedUserMsg.id ? { ...m, sendFailed: true } : m)
        );
      },
    };

    await streamResponse(
      { conversationId, content: { text: textPrompt, imageUrl } } as Parameters<typeof streamResponse>[0],
      handlers,
    );
  }, [activeConversationId, canInvokeAI, updateMessages, setWaitReply]);

  return { handleSend, handleRetrySend, canInvokeAI };
};