import type { UserProfileResult } from '@/server/agents/user-profile';

/** 外形数据须由用户档案页上传自拍后标记；对话流程不得写入或保留未验证外形 */
export function isVisualProfileVerified(dbProfile: Record<string, unknown>): boolean {
  return dbProfile.visual_profile_verified === true;
}

export function emptyVisualProfile(): Pick<
  UserProfileResult,
  'skin_tone' | 'body_shape' | 'visual_features'
> {
  return {
    skin_tone: '',
    body_shape: '',
    visual_features: { hair_color: 'unknown', detected_features: 'none' },
  };
}

/** 仅当用户曾上传自拍并标记 verified 时，才从 DB 读取外形字段 */
export function readVerifiedVisualProfile(
  dbProfile: Record<string, unknown>
): Pick<UserProfileResult, 'skin_tone' | 'body_shape' | 'visual_features'> {
  if (!isVisualProfileVerified(dbProfile)) {
    return emptyVisualProfile();
  }

  const visual = dbProfile.visual_features as UserProfileResult['visual_features'] | undefined;
  return {
    skin_tone: typeof dbProfile.skin_tone === 'string' ? dbProfile.skin_tone : '',
    body_shape: typeof dbProfile.body_shape === 'string' ? dbProfile.body_shape : '',
    visual_features: {
      hair_color: visual?.hair_color || 'unknown',
      detected_features: visual?.detected_features || 'none',
    },
  };
}

export function applyVerifiedVisualFields(
  result: UserProfileResult,
  dbProfile: Record<string, unknown>
): UserProfileResult {
  const visual = readVerifiedVisualProfile(dbProfile);
  return {
    ...result,
    skin_tone: visual.skin_tone,
    body_shape: visual.body_shape,
    visual_features: visual.visual_features,
  };
}
