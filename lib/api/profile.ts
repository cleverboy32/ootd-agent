import { apiClient } from '@/lib/api-client';
import { useSessionStore } from '@/store/session';
import { normalizeVisualFeaturesForZh } from '@/lib/hairColorDisplay';

export interface ProfileData {
  name: string;
  height: string;
  weight: string;
  location?: string;
  personal_style: string;
  preferences: string[];
  skin_tone: string;
  body_shape: string;
  /** 照片分析判断的性别（男/女），未分析时为空 */
  gender?: string;
  visual_features: {
    hair_color: string;
    detected_features: string;
  };
  visual_profile_verified?: boolean;
  full_body_verified?: boolean;
  selfie_image_url?: string;
  selfie_analyzed_at?: string;
}

interface ProfileResponse {
  id: string;
  profileData: Partial<ProfileData>;
}

const EMPTY_PROFILE: ProfileData = {
  name: '',
  height: '',
  weight: '',
  personal_style: '日常休闲',
  preferences: [],
  skin_tone: '',
  body_shape: '',
  visual_features: { hair_color: 'unknown', detected_features: 'none' },
};

function normalizeProfileData(raw: Partial<ProfileData> | undefined): ProfileData {
  if (!raw) return EMPTY_PROFILE;
  return {
    name: raw.name ?? '',
    height: raw.height ?? '',
    weight: raw.weight ?? '',
    location: raw.location,
    personal_style: raw.personal_style?.trim() || '日常休闲',
    preferences: Array.isArray(raw.preferences)
      ? raw.preferences.filter((p): p is string => typeof p === 'string')
      : [],
    skin_tone: raw.skin_tone ?? '',
    body_shape: raw.body_shape ?? '',
    gender: raw.gender?.trim() || undefined,
    visual_features: normalizeVisualFeaturesForZh({
      hair_color: raw.visual_features?.hair_color ?? 'unknown',
      detected_features: raw.visual_features?.detected_features ?? 'none',
    }),
    visual_profile_verified: raw.visual_profile_verified,
    full_body_verified: raw.full_body_verified,
    selfie_image_url: raw.selfie_image_url,
    selfie_analyzed_at: raw.selfie_analyzed_at,
  };
}

/**
 * 浏览器按完整 URL 缓存；按 userId 区分不同账号的 force-cache。
 * 服务端身份只认 session，不读查询参数。
 */
export function profileRequestPath(userId: string | null): string {
  if (!userId) return '/api/profile';
  return `/api/profile?u=${encodeURIComponent(userId)}`;
}

/** 档案 GET：走 getCached（服务端需 Cache-Control）；写后 bust:true */
export async function fetchProfile(options?: { bust?: boolean }): Promise<ProfileData> {
  const store = useSessionStore.getState();
  const session = store.ready
    ? { authenticated: store.authenticated, user: store.user }
    : await store.ensureSession().catch(() => null);
  const userId = session?.authenticated && session.user ? session.user.id : null;
  const res = (await apiClient.getCached(profileRequestPath(userId), {
    bust: options?.bust,
  })) as ProfileResponse;
  return normalizeProfileData(res.profileData);
}

export async function analyzeVisualProfile(imageUrl: string): Promise<ProfileData> {
  const res = (await apiClient.post('/api/profile/visual-analysis', {
    imageUrl,
  })) as { profileData: Partial<ProfileData> };
  const normalized = normalizeProfileData(res.profileData);
  // 写成功后把 GET 缓存刷成最新，避免返回档案页读到旧 force-cache
  void fetchProfile({ bust: true }).catch(() => undefined);
  return normalized;
}

export function computeProfileCompleteness(profile: ProfileData): { filled: number; total: number } {
  const checks = [
    Boolean(profile.name?.trim()),
    Boolean(profile.height?.trim()),
    Boolean(profile.weight?.trim()),
    Boolean(profile.personal_style?.trim() && profile.personal_style !== '日常休闲'),
    profile.preferences.length > 0,
    Boolean(profile.visual_profile_verified),
  ];
  return { filled: checks.filter(Boolean).length, total: checks.length };
}
