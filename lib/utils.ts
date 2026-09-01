import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getClientId(): string {
  const ownerClientId = process.env.NEXT_PUBLIC_OWNER_CLIENT_ID?.trim();
  if (!ownerClientId) {
    throw new Error('NEXT_PUBLIC_OWNER_CLIENT_ID is missing.');
  }
  return ownerClientId;
}

/**
 * Uploads a file through the BFF; the server writes to COS server-side (no browser CORS).
 */
export async function uploadFileToCOS(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'X-Client-ID': getClientId(),
    },
    body: formData,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || 'Failed to upload file to COS.');
  }

  const { publicUrl } = (await response.json()) as { publicUrl: string };
  console.log('File uploaded successfully:', publicUrl);
  return publicUrl;
}
export interface StreamHandlers {
  onMetadata: (data: { messageId: string }) => void;
  onTextChunk: (text: string) => void;
  onImagePlaceholder: (data: { id: string; alt: string; }) => void; // New handler for placeholders
  onImageGenerated: (data: { id: string; imageUrl: string; alt: string; }) => void; // Updated handler
  onImageGenerationFailed: (data: { id: string; message: string; alt: string; }) => void;
  onWardrobeCandidates?: (data: { items: WardrobeCandidateItem[] }) => void;
  onProgress?: (data: { stage: string; label?: string; done?: boolean; thinking?: string }) => void;
  onError: (message: string) => void;
  onStreamEnd: () => void;
}

export type WardrobeCandidateItem = {
  id: string;
  imageUrl: string;
  subCategory: string;
  colors: string[];
};

// Utility 2: The complete API call and stream processing logic
// 将整个函数替换为这个版本
export const streamResponse = async (
  payload: {
    content?: {
      text?: string,
      imageUrl?: string,
    },
    conversationId?: string | null;
    messageId?: string;
    retryOutfitId?: string;
  },
  handlers: StreamHandlers
) => {
  try {
    const clientId = getClientId();
    const res = await fetch("/api/generate-with-image", {
      method: "POST",
      headers: { 'Content-Type': 'application/json', 'X-Client-ID': clientId },
      body: JSON.stringify(payload), // payload 现在可能包含 messageId
    });

    if (!res.ok || !res.body) {
      const errorText = await res.text();
      let errorMessage = `API request failed: ${res.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.message) errorMessage = errorJson.message;
        else if (errorJson.error) errorMessage = errorJson.error;
      } catch {
        if (errorText.trim().length > 0) errorMessage = errorText;
      }
      throw new Error(errorMessage);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        handlers.onStreamEnd(); // 调用无参数的 onStreamEnd
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('event:')) continue;

        const eventNameMatch = line.match(/event:\s*(.*)/);
        const dataStringMatch = line.match(/data:\s*(.*)/);

        if (!eventNameMatch || !dataStringMatch) continue;
        
        const eventName = eventNameMatch[1];
        const dataString = dataStringMatch[1];

        try {
          const data = JSON.parse(dataString);

          // 核心改动：新的 switch 语句
          switch (eventName) {
            case 'metadata': // <-- 新增 case
              handlers.onMetadata(data);
              break;
            case 'text_chunk':
              handlers.onTextChunk(data.text);
              break;
            case 'image_placeholder':
              handlers.onImagePlaceholder(data);
              break;
            case 'image_generated':
              handlers.onImageGenerated(data);
              break;
            case 'image_generation_failed':
              handlers.onImageGenerationFailed(data);
              break;
            case 'wardrobe_candidates':
              handlers.onWardrobeCandidates?.(data);
              break;
            case 'progress':
              handlers.onProgress?.(data);
              break;
            case 'error':
              handlers.onError(data.message);
              break;
            case 'stream_end':
              // 后端发送 stream_end 时，我们认为是正常结束
              handlers.onStreamEnd();
              return; // 明确结束
          }
        } catch (e) {
          console.error("Failed to parse SSE JSON:", dataString, e);
        }
      }
    }
  } catch (error) {
    console.error("Streaming error caught in streamResponse:", error);
    if (error instanceof Error) {
        handlers.onError(error.message);
    } else {
        handlers.onError("An unknown streaming error occurred.");
    }
  }
};
