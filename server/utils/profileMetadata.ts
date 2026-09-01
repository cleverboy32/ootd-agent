import type { UserProfileResult } from '@/server/agents/user-profile';
import { isVisualProfileVerified } from '@/server/utils/userProfileVisual';
import { buildCosObjectKey, getCosPublicUrl } from '@/server/services/cos';

export const PROFILE_METADATA_KEYS = [
  'visual_profile_verified',
  'selfie_image_url',
  'selfie_analyzed_at',
  'location',
] as const;

/** 从 DB 档案中保留元数据字段（对话 Agent 不产出这些字段） */
export function preserveProfileMetadata(dbProfile: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  for (const key of PROFILE_METADATA_KEYS) {
    if (dbProfile[key] !== undefined) {
      meta[key] = dbProfile[key];
    }
  }
  return meta;
}

/** 对话 Agent 持久化时合并结果与元数据，避免抹掉自拍分析记录 */
export function mergeChatProfileForPersistence(
  result: UserProfileResult,
  dbProfile: Record<string, unknown>
): Record<string, unknown> {
  const metadata = preserveProfileMetadata(dbProfile);
  return {
    ...result,
    ...metadata,
    ...(isVisualProfileVerified(dbProfile) ? { visual_profile_verified: true } : {}),
  };
}

/** 校验上传 URL 属于当前 client 的 COS 路径，防 SSRF */
export function isClientOwnedUploadUrl(imageUrl: string, clientId: string): boolean {
  try {
    const url = new URL(imageUrl);
    const expectedPrefixUrl = new URL(
      `${getCosPublicUrl(buildCosObjectKey(`user-uploads/${clientId}`))}/`
    );
    return (
      url.protocol === 'https:' &&
      url.origin === expectedPrefixUrl.origin &&
      url.pathname.startsWith(expectedPrefixUrl.pathname)
    );
  } catch {
    return false;
  }
}

export function mergeVisualAnalysisIntoProfile(
  existingProfile: Record<string, unknown>,
  visualResult: {
    skin_tone: string;
    body_shape: string;
    visual_features: { hair_color: string; detected_features: string };
  },
  imageUrl: string
): Record<string, unknown> {
  return {
    ...existingProfile,
    skin_tone: visualResult.skin_tone,
    body_shape: visualResult.body_shape,
    visual_features: visualResult.visual_features,
    visual_profile_verified: true,
    selfie_image_url: imageUrl,
    selfie_analyzed_at: new Date().toISOString(),
  };
}
