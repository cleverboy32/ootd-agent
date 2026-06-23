import { getClientId } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
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
  visual_features: {
    hair_color: string;
    detected_features: string;
  };
  visual_profile_verified?: boolean;
  selfie_image_url?: string;
  selfie_analyzed_at?: string;
}

interface ClientProfileResponse {
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
    visual_features: normalizeVisualFeaturesForZh({
      hair_color: raw.visual_features?.hair_color ?? 'unknown',
      detected_features: raw.visual_features?.detected_features ?? 'none',
    }),
    visual_profile_verified: raw.visual_profile_verified,
    selfie_image_url: raw.selfie_image_url,
    selfie_analyzed_at: raw.selfie_analyzed_at,
  };
}

export async function fetchProfile(): Promise<ProfileData> {
  const clientId = getClientId();
  const res = (await apiClient.get(`/api/clients/${clientId}`)) as ClientProfileResponse;
  return normalizeProfileData(res.profileData);
}

export async function analyzeVisualProfile(imageUrl: string): Promise<ProfileData> {
  const res = (await apiClient.post('/api/profile/visual-analysis', {
    imageUrl,
  })) as { profileData: Partial<ProfileData> };
  return normalizeProfileData(res.profileData);
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
