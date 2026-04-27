import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
  onImageGenerated: (data: { imageUrl: string; alt: string }) => void;
  onError: (message: string) => void;
  onStreamEnd: (message: string) => void;
}

// Utility 2: The complete API call and stream processing logic
export const streamResponse = async (
  payload: { prompt: string; base64Image?: string; mimeType?: string },
  handlers: StreamHandlers
) => {
  try {
    const res = await fetch("/api/generate-with-image", {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok || !res.body) {
      const errorText = await res.text();
      throw new Error(`API request failed: ${res.statusText} - ${errorText}`);
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
            case 'image_generated':
              handlers.onImageGenerated(data);
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
    console.error("Fetch or streaming error:", error);
    handlers.onError(error.message || "An unknown streaming error occurred.");
  }
};
