import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { v4 as uuidv4 } from 'uuid';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getClientId ()  {
  const CLIENT_ID_STORAGE_KEY = 'ootd-agent-client-id'; // It's a good practice to define the key as a constant
  let clientId = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);

  if (!clientId) {
    clientId = uuidv4();
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
  }

  return clientId;
}

// Utility 1: Convert a File to a Base64 string
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

export interface StreamHandlers {
  onTextChunk: (text: string) => void;
  onImagePlaceholder: (data: { id: string; alt: string; }) => void; // New handler for placeholders
  onImageGenerated: (data: { id: string; imageUrl: string; alt: string; }) => void; // Updated handler
  onImageGenerationFailed: (data: { id: string; message: string; alt: string }) => void;
  onError: (message: string) => void;
  onStreamEnd: (message: string) => void;
}

// Utility 2: The complete API call and stream processing logic
export const streamResponse = async (
  payload: { prompt: string; base64Image?: string; mimeType?: string },
  handlers: StreamHandlers
) => {
  try {
    const clientId = getClientId();
    const res = await fetch("/api/generate-with-image", {
      method: "POST",
      headers: { 'Content-Type': 'application/json', 'X-Client-ID': clientId },
      body: JSON.stringify(payload),
    });

    if (!res.ok || !res.body) {
      // --- 新的、更智能的错误处理 ---
      const errorText = await res.text();
      let errorMessage = `API request failed: ${res.statusText}`;
      try {
        // 尝试解析后端返回的JSON错误信息
        const errorJson = JSON.parse(errorText);
        // 如果有 message 字段，就用它作为更友好的错误信息
        if (errorJson.message) {
          errorMessage = errorJson.message;
        } else if (errorJson.error) {
          errorMessage = errorJson.error;
        }
        } catch (e) {
        // 如果解析JSON失败，errorText 本身可能就是有用的信息
        if (errorText.trim().length > 0) {
          errorMessage = errorText;
        }
      }
      throw new Error(errorMessage);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        handlers.onStreamEnd("Stream finished by server connection close.");
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('event:')) continue;

        const eventName = line.substring(7, line.indexOf('\n'));
        const dataString = line.substring(line.indexOf('\n') + 6);

        try {
          const data = JSON.parse(dataString);

          switch (eventName) {
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
              (handlers as any).onImageGenerationFailed(data);
              break;
            case 'error':
              handlers.onError(data.message);
              break;
            case 'stream_end':
              handlers.onStreamEnd(data.message);
              return; // End the loop
          }
        } catch (e) {
          console.error("Failed to parse SSE JSON:", dataString, e);
        }
      }
    }
  } catch (error: any) {
    handlers.onError("An unknown streaming error occurred.");
  }
};

