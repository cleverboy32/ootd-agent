interface MiniMaxImageResponse {
  data?: {
    image_base64?: string[];
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

function getMiniMaxApiKey(): string {
  const apiKey =
    process.env.MINIMAX_API_KEY?.trim() ??
    process.env.minimax_api_key?.trim();
  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY is missing.');
  }
  return apiKey;
}

export async function minimaxGenerateImage(
  prompt: string,
  model: string
): Promise<{ data: string; mimeType: string }> {
  const baseUrl =
    process.env.MINIMAX_BASE_URL?.trim() || 'https://api.minimaxi.com/v1';
  const response = await fetch(`${baseUrl}/image_generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getMiniMaxApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: prompt.slice(0, 1500),
      aspect_ratio: '3:4',
      response_format: 'base64',
    }),
  });

  const payload = (await response.json()) as MiniMaxImageResponse;
  if (!response.ok || (payload.base_resp?.status_code ?? 0) !== 0) {
    const detail =
      payload.base_resp?.status_msg || `${response.status} ${response.statusText}`;
    throw new Error(`MiniMax image generation failed: ${detail}`);
  }

  const data = payload.data?.image_base64?.[0];
  if (!data) {
    throw new Error('MiniMax image generation did not return image data.');
  }

  return { data, mimeType: 'image/jpeg' };
}
