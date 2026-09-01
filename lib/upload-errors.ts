/**
 * Maps technical upload/analysis errors to short, user-facing Chinese messages.
 */
export function toUserFacingUploadError(raw: string): string {
  if (!raw.trim()) return '处理失败，请重试';

  const lower = raw.toLowerCase();

  if (
    raw.includes('过于频繁') ||
    lower.includes('429') ||
    lower.includes('rate_limit') ||
    lower.includes('resource_exhausted')
  ) {
    return 'AI 服务请求过于频繁，请稍后再试';
  }

  if (raw.includes('dimensions') || raw.includes('vector') || raw.includes('$executeRaw')) {
    return '保存失败，请稍后重试';
  }

  if (lower.includes('prisma') || lower.includes('prismaclient') || raw.includes('Unknown argument')) {
    return '保存失败，请稍后重试';
  }

  if (lower.includes('failed to upload') || raw.includes('上传失败')) {
    return '图片上传失败，请检查网络后重试';
  }

  if (raw.includes('parse') || raw.includes('JSON') || raw.includes('Invalid data')) {
    return 'AI 分析结果异常，请重试';
  }

  if (raw.includes('GoogleGenerativeAI') || raw.includes('AI service')) {
    return 'AI 服务暂时不可用，请稍后重试';
  }

  if (raw.includes('网络') || lower.includes('failed to fetch') || lower.includes('network')) {
    return '网络异常，请检查后重试';
  }

  if (raw.includes('AI 分析失败') || raw.includes('AI 服务')) {
    return raw;
  }

  if (raw.length > 80 || raw.includes('\n') || raw.includes('invocation')) {
    return '处理失败，请重试';
  }

  return raw;
}
