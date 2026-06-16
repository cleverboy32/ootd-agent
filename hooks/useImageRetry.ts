import { useCallback } from 'react';
import { useChatStore } from '@/store/chat';
import { streamResponse } from '@/lib/utils';

export function useImageRetry() {
  const { activeConversationId, updateMessages } = useChatStore();

  const retryOutfitImage = useCallback(
    async (messageId: string, outfitId: string) => {
      if (!activeConversationId) {
        console.error('[IMAGE_RETRY] No active conversation');
        return;
      }

      updateMessages((messages) =>
        messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                imageStates: { ...msg.imageStates, [outfitId]: 'loading' as const },
              }
            : msg
        )
      );

      await streamResponse(
        {
          conversationId: activeConversationId,
          messageId,
          retryOutfitId: outfitId,
        },
        {
          onMetadata: () => {},
          onTextChunk: () => {},
          onImagePlaceholder: () => {},
          onImageGenerated: (data) => {
            updateMessages((messages) =>
              messages.map((msg) =>
                msg.id === messageId
                  ? {
                      ...msg,
                      imageStates: { ...msg.imageStates, [data.id]: data.imageUrl },
                    }
                  : msg
              )
            );
          },
          onImageGenerationFailed: (data) => {
            updateMessages((messages) =>
              messages.map((msg) =>
                msg.id === messageId
                  ? {
                      ...msg,
                      imageStates: { ...msg.imageStates, [data.id]: 'failed' as const },
                    }
                  : msg
              )
            );
          },
          onError: (message) => {
            console.error('[IMAGE_RETRY] Stream error:', message);
            updateMessages((messages) =>
              messages.map((msg) =>
                msg.id === messageId
                  ? {
                      ...msg,
                      imageStates: { ...msg.imageStates, [outfitId]: 'failed' as const },
                    }
                  : msg
              )
            );
          },
          onStreamEnd: () => {},
        }
      );
    },
    [activeConversationId, updateMessages]
  );

  return { retryOutfitImage };
}
