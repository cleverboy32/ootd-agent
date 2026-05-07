import { useCallback } from 'react';
import { useChatStore } from '@/store/chat';
import { streamResponse, fileToBase64 } from '@/lib/utils';
import { Message } from '@/lib/types';

export const useChatHandler = () => {
  const {
    activeConversationId,
    startNewConversation,
    addUserMessage,
    saveFinalAiMessage,
    setWaitReply,
    updateMessages, // Get the new powerful action
  } = useChatStore();

  const handleSend = useCallback(async (prompt: string, imageFile?: File | null) => {
    if (!prompt.trim() && !imageFile) return;

    setWaitReply(true);

    const userMessage: Message = { role: 'user', content: prompt, timestamp: Date.now() };
    let conversationId = activeConversationId;

    if (!conversationId) {
      conversationId = await startNewConversation(userMessage);
    } else {
      await addUserMessage(userMessage);
    }

    if (!conversationId) {
      console.error("无法获取有效的会话ID。");
      setWaitReply(false);
      return;
    }

    const updateConversation = (updater: (messages: Message[]) => Message[]) => {
      updateMessages(updater);
    };
    
    // --- The complete, robust handlers logic, migrated from page.tsx ---
    const handlers = {
      onTextChunk: (text: string) => {
        updateConversation(currentMessages => {
          const lastMessage = currentMessages.at(-1);
          if (!lastMessage || lastMessage.role !== 'ai' || !Array.isArray(lastMessage.content)) {
            const newAiMessage: Message = { role: 'ai', content: [{ type: 'text', content: text }], timestamp: Date.now() };
            return [...currentMessages, newAiMessage];
          }
          const lastPart = lastMessage.content.at(-1);
          let newContent;
          if (lastPart && lastPart.type === 'text') {
            const newLastPart = { ...lastPart, content: lastPart.content + text };
            newContent = [...lastMessage.content.slice(0, -1), newLastPart];
          } else {
            newContent = [...lastMessage.content, { type: 'text', content: text }];
          }
          const newLastMessage = { ...lastMessage, content: newContent };
          return [...currentMessages.slice(0, -1), newLastMessage];
        });
      },
      onImagePlaceholder: (data: { id: string; alt: string; }) => {
        updateConversation(messages => {
          const lastMessage = messages.at(-1);
          if (lastMessage?.role === 'ai' && Array.isArray(lastMessage.content)) {
            return [...messages.slice(0, -1), { ...lastMessage, content: [...lastMessage.content, { type: 'image_placeholder', id: data.id, content: data.alt }] }];
          }
          const newAiMessage: Message = { role: 'ai', content: [{ type: 'image_placeholder', id: data.id, content: data.alt }], timestamp: Date.now() };
          return [...messages, newAiMessage];
        });
      },
      onImageGenerated: (data: { id: string; imageUrl: string; alt: string }) => {
        updateConversation(messages => messages.map(msg => {
          if (msg.role === 'ai' && Array.isArray(msg.content)) {
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
        updateConversation(messages => messages.map(msg => {
          if (msg.role === 'ai' && Array.isArray(msg.content)) {
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
        const errorContent = `\n\n**抱歉，处理时发生错误**：${message}`;
        updateConversation(messages => {
            const lastMessage = messages.at(-1);
            if (lastMessage?.role === 'ai' && Array.isArray(lastMessage.content)) {
              return [...messages.slice(0, -1), { ...lastMessage, content: [...lastMessage.content, { type: 'text', content: errorContent }] }];
            }
            const newAiMessage: Message = { role: 'ai', content: [{ type: 'text', content: errorContent }], timestamp: Date.now() };
            return [...messages, newAiMessage];
        });
        setWaitReply(false);
      },
      onStreamEnd: async () => {
        await saveFinalAiMessage();
        setWaitReply(false);
      },
    };

    const payload = {
      prompt,
      base64Image: imageFile ? await fileToBase64(imageFile) : undefined,
      mimeType: imageFile ? imageFile.type : undefined,
    };

    await streamResponse(payload, handlers as any);

  }, [
    activeConversationId, 
    startNewConversation, 
    addUserMessage, 
    saveFinalAiMessage, 
    setWaitReply, 
    updateMessages
  ]);

  return { handleSend };
};