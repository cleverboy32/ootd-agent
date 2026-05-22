// hooks/useChatHandler.ts
import { useCallback } from 'react';
import { useChatStore } from '@/store/chat';
import { streamResponse } from '@/lib/utils';
import { Message, MessageContentPart } from '@/lib/types';

export const useChatHandler = () => {
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
            id: currentAiMessageId, // 使用后端给的真实ID
            status: 'generating',
            role: 'ai',
            content: [], // 开始时是空的
            timestamp: Date.now(),
          };
          updateMessages(messages => [...messages, initialAiMessage]);
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
            return { ...msg, content: newContent };
          }
          return msg;
        }));
      },
      onImagePlaceholder: (data: { id: string; alt: string; }) => {
        updateMessages(messages => messages.map(msg => {
          if (msg.id === currentAiMessageId && msg.role === 'ai' && Array.isArray(msg.content)) {
            
            // 创建一个新的 Part，并明确它的类型
            const newPart: MessageContentPart = { 
              type: 'image_placeholder', 
              id: data.id, 
              content: data.alt 
            };
      
            const newContent = [...msg.content, newPart]; // 现在 TypeScript 满意了
            return { ...msg, content: newContent };
          }
          return msg;
        }));
      },
      onImageGenerated: (data: { id: string; imageUrl: string; alt: string }) => {
        updateMessages(messages => messages.map(msg => {
          if (msg.id === currentAiMessageId && msg.role === 'ai' && Array.isArray(msg.content)) {
            return {
              ...msg,
              content: msg.content.map(part =>
                part.type === 'image_placeholder' && part.id === data.id
                  ? { ...part, type: 'image', content: data.imageUrl, alt: data.alt }
                  : part
              ),
            };
          }
          return msg;
        }));
      },
      onImageGenerationFailed: (data: { id: string; message: string; alt: string }) => {
        updateMessages(messages => messages.map(msg => {
          if (msg.id === currentAiMessageId && msg.role === 'ai' && Array.isArray(msg.content)) {
            return {
              ...msg,
              content: msg.content.map(part =>
                part.type === 'image_placeholder' && part.id === data.id
                  ? { ...part, type: 'image_failed', content: data.message, alt: data.alt }
                  : part
              ),
            };
          }
          return msg;
        }));
      },
      onError: (message: string) => {
        streamHasError = true;
        if (currentAiMessageId) {
          updateMessages(messages => messages.map(m => 
            m.id === currentAiMessageId ? { ...m, status: 'failed' } : m
          ));
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
          updateMessages(messages => messages.map(m => 
            m.id === currentAiMessageId ? { ...m, status: 'completed' } : m
          ));
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

      if (originalUserMessage && originalUserMessage.role === 'user' && Array.isArray(originalUserMessage.content)) {
          textPrompt = originalUserMessage.content.find(p => p.type === 'text')?.content || '';
          imageForPayload = originalUserMessage.imageUrl;
      } else {
        console.warn("Could not reliably find original user prompt for retry.");
      }
    } else {
      // 对于新消息，用户消息就是最后一条
      const lastMessage = useChatStore.getState().messages.at(-1);
      if (lastMessage && lastMessage.role === 'user' && Array.isArray(lastMessage.content)) {
        textPrompt = lastMessage.content.find(p => p.type === 'text')?.content || '';
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
  ]);

  return { handleSend };
};