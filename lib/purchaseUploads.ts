/** 一条消息里可一起搭配的上传单品上限。上装、下装、鞋，再加一件外套。 */
export const MAX_PURCHASE_UPLOADS = 4;

export function takePurchaseUploadUrls(urls: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of urls) {
    if (typeof raw !== 'string') continue;
    const url = raw.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    kept.push(url);
    if (kept.length >= MAX_PURCHASE_UPLOADS) break;
  }
  return kept;
}
