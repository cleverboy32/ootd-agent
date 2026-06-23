/** 将底层错误转为用户可读的中文提示 */
export function getFriendlyErrorMessage(
  error: unknown,
  fallback = '操作失败，请稍后重试'
): string {
  if (!(error instanceof Error)) return fallback;

  const msg = error.message.toLowerCase();

  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('the internet connection appears to be offline')
  ) {
    return '网络连接失败，请检查网络后重试';
  }

  if (msg.includes('429') || msg.includes('too many')) {
    return '请求过于频繁，请稍后再试';
  }

  if (msg.includes('正面人像') || msg.includes('清晰的正面')) {
    return '请上传清晰的正面人像照片';
  }

  if (msg.includes('failed to get signed url') || msg.includes('upload')) {
    return '照片上传失败，请检查网络后重试';
  }

  if (msg.includes('http error! status: 5') || msg.includes('internal server error')) {
    return '服务暂时不可用，请稍后重试';
  }

  if (msg.includes('http error! status: 403') || msg.includes('invalid image url')) {
    return '图片无效，请重新上传';
  }

  if (msg.startsWith('http error!')) {
    return fallback;
  }

  return error.message.trim() || fallback;
}
