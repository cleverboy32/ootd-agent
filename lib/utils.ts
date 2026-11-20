import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Prefix app-relative paths with Next.js basePath (e.g. /ootd). */
export function withBasePath(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (!path.startsWith("/")) return `${basePath}/${path}`;
  return `${basePath}${path}`;
}

/** Inverse of withBasePath: browser pathname → app-relative path accepted by router.push. */
export function stripBasePath(pathname: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (!basePath || (pathname !== basePath && !pathname.startsWith(`${basePath}/`))) return pathname;
  return pathname.slice(basePath.length) || "/";
}

/** Local public asset; must include basePath for next/image optimizer behind subpath deploy. */
export const LOGO_SRC = withBasePath("/logo.png");

/**
 * Uploads a file through the BFF; the server writes to COS server-side (no browser CORS).
 */
export async function uploadFileToCOS(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(withBasePath('/api/upload'), {
    method: 'POST',
    credentials: 'same-origin',
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
  onImageCreditsRequired?: (data: { id: string; message: string; alt: string; }) => void;
  onWardrobeCandidates?: (data: { items: WardrobeCandidateItem[] }) => void;
  onProgress?: (data: { stage: string; label?: string; done?: boolean; thinking?: string }) => void;
  onError: (message: string) => void;
  onStreamEnd: () => void;
  /** 主动 abort / 被超车：不走 onError 红字 */
  onCancelled?: () => void;
}

function isClientAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

export type WardrobeCandidateItem = {
  id: string;
  imageUrl: string;
  subCategory: string;
  colors: string[];
};

async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      handlers.onStreamEnd();
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

        switch (eventName) {
          case 'metadata':
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
          case 'image_credits_required':
            handlers.onImageCreditsRequired?.(data);
            break;
          case 'wardrobe_candidates':
            handlers.onWardrobeCandidates?.(data);
            break;
          case 'progress':
            handlers.onProgress?.(data);
            break;
          case 'ping':
            break;
          case 'error':
            handlers.onError(data.message);
            break;
          case 'stream_end':
            handlers.onStreamEnd();
            return;
        }
      } catch (e) {
        console.error("Failed to parse SSE JSON:", dataString, e);
      }
    }
  }
}

// Utility 2: The complete API call and stream processing logic
export const streamResponse = async (
  payload: {
    content?: {
      text?: string,
      imageUrl?: string,
      imageUrls?: string[],
    },
    conversationId?: string | null;
    messageId?: string;
    retryOutfitId?: string;
  },
  handlers: StreamHandlers,
  options?: { signal?: AbortSignal }
) => {
  try {
    const res = await fetch(withBasePath("/api/generate-with-image"), {
      method: "POST",
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options?.signal,
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

    await consumeSseStream(res.body, handlers);
  } catch (error) {
    if (isClientAbortError(error) || options?.signal?.aborted) {
      handlers.onCancelled?.();
      return;
    }
    console.error("Streaming error caught in streamResponse:", error);
    if (error instanceof Error) {
        handlers.onError(error.message);
    } else {
        handlers.onError("An unknown streaming error occurred.");
    }
  }
};

export type ResumeStreamResult = 'ok' | 'terminal' | 'unavailable';

/** 刷新后续流：GET resume SSE，先 replay 再 live。 */
export const resumeGenerationStream = async (
  messageId: string,
  handlers: StreamHandlers,
  options?: { signal?: AbortSignal }
): Promise<ResumeStreamResult> => {
  try {
    const res = await fetch(
      withBasePath(`/api/generate-with-image/resume?messageId=${encodeURIComponent(messageId)}`),
      {
        method: 'GET',
        credentials: 'same-origin',
        signal: options?.signal,
      }
    );

    if (res.status === 409 || res.status === 410) {
      return 'terminal';
    }
    if (res.status === 404) {
      return 'unavailable';
    }

    if (!res.ok || !res.body) {
      const errorText = await res.text();
      throw new Error(errorText || `Resume failed: ${res.status}`);
    }

    await consumeSseStream(res.body, handlers);
    return 'ok';
  } catch (error) {
    if (isClientAbortError(error) || options?.signal?.aborted) {
      handlers.onCancelled?.();
      return 'ok';
    }
    console.error('Streaming error caught in resumeGenerationStream:', error);
    if (error instanceof Error) {
      handlers.onError(error.message);
    } else {
      handlers.onError('An unknown resume streaming error occurred.');
    }
    return 'unavailable';
  }
};
