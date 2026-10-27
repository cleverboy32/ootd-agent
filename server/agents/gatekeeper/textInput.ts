import type { Content, Part } from '@google/genai';

export function isImagePart(part: Part): boolean {
  return Boolean(part.inlineData?.data || part.fileData?.fileUri);
}

/** Gatekeeper 只看文字。图片像素留给搭配师。 */
export function stripImageParts(parts: Part[]): Part[] {
  return parts.filter((part) => !isImagePart(part));
}

export function stripHistoryImages(history: Content[]): Content[] {
  return history
    .map((turn) => ({ ...turn, parts: stripImageParts(turn.parts ?? []) }))
    .filter((turn) => (turn.parts?.length ?? 0) > 0);
}

export function imageCountFact(count: number): string {
  if (count <= 0) return '';
  return `【服务端事实】本轮用户上传了 ${count} 张图片。你看不到画面，禁止描述颜色、品类或版型。用户的话如果指向这些图片，归为 purchase_pairing 并放行，锚定描述留空。文字本身已经是完整穿搭请求时，按文字归类，不要因为有图就改成 purchase_pairing。`;
}
