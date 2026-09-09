import type { GatekeeperIntent } from '@/server/agents/intent';
import { extractConfirmedWardrobeId } from '@/server/agents/intent';
import {
  EMPTY_PROFILE_UPDATE_PATCH,
  type ProfileUpdate,
  type ProfileUpdatePatch,
} from '@/server/agents/gatekeeper/schema';
import { preserveProfileMetadata } from '@/server/utils/profileMetadata';
import type { Prisma } from '@prisma/client';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeProfileUpdate(raw: unknown): ProfileUpdate {
  if (!raw || typeof raw !== 'object') {
    return { needed: false, patch: { ...EMPTY_PROFILE_UPDATE_PATCH } };
  }
  const obj = raw as Record<string, unknown>;
  const patchRaw =
    obj.patch && typeof obj.patch === 'object' ? (obj.patch as Record<string, unknown>) : {};
  return {
    needed: Boolean(obj.needed),
    patch: {
      name: asString(patchRaw.name),
      height: asString(patchRaw.height),
      weight: asString(patchRaw.weight),
      personal_style: asString(patchRaw.personal_style),
      preference_additions: asStringArray(patchRaw.preference_additions),
    },
  };
}

export function profileUpdatePatchHasContent(patch: ProfileUpdatePatch): boolean {
  return Boolean(
    patch.name ||
      patch.height ||
      patch.weight ||
      patch.personal_style ||
      patch.preference_additions.length > 0
  );
}

/**
 * 操作/确认类意图即使 Gate 误标 needed 也不写档。
 * 与 shouldSkipProfileAgentUpdate 对齐。
 */
function shouldIgnoreProfileUpdateByIntent(
  intent: GatekeeperIntent,
  currentMessageText: string
): boolean {
  if (
    intent.request_type === 'outfit_selection' ||
    intent.request_type === 'outfit_confirmed' ||
    intent.request_type === 'clarify' ||
    intent.request_type === 'feedback_revision'
  ) {
    return true;
  }
  if (intent.request_type === 'wardrobe_pairing' && extractConfirmedWardrobeId(currentMessageText)) {
    return true;
  }
  return false;
}

/** Gate needed=true 仍可能被意图类型兜底拦截（选套/确认/微调等） */
export function shouldApplyGateProfileUpdate(
  intent: GatekeeperIntent,
  update: ProfileUpdate,
  currentMessageText: string
): boolean {
  if (!update.needed) return false;
  if (!profileUpdatePatchHasContent(update.patch)) return false;
  if (shouldIgnoreProfileUpdateByIntent(intent, currentMessageText)) return false;
  return true;
}

export function mergeProfileUpdatePatch(
  dbProfile: Record<string, unknown>,
  patch: ProfileUpdatePatch
): { next: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const next: Record<string, unknown> = { ...dbProfile };

  const scalarKeys = ['name', 'height', 'weight', 'personal_style'] as const;
  for (const key of scalarKeys) {
    const value = patch[key].trim();
    if (!value) continue;
    const prev = asString(next[key]);
    if (prev === value) continue;
    next[key] = value;
    changed = true;
  }

  const existingPrefs = Array.isArray(next.preferences)
    ? next.preferences.filter((p): p is string => typeof p === 'string').map((p) => p.trim())
    : [];
  const prefSet = new Set(existingPrefs.filter(Boolean));
  let prefsChanged = false;
  for (const add of patch.preference_additions) {
    const trimmed = add.trim();
    if (!trimmed || prefSet.has(trimmed)) continue;
    prefSet.add(trimmed);
    existingPrefs.push(trimmed);
    prefsChanged = true;
  }
  if (prefsChanged) {
    next.preferences = existingPrefs;
    changed = true;
  }

  if (!changed) return { next: dbProfile, changed: false };

  return {
    next: {
      ...next,
      ...preserveProfileMetadata(dbProfile),
    },
    changed: true,
  };
}

/** 异步合并写库；失败只打日志，不阻塞搭配 */
export function scheduleProfileUpdatePersist(
  clientId: string,
  patch: ProfileUpdatePatch
): void {
  void (async () => {
    try {
      const { default: prismadb } = await import('server/db');
      const client = await prismadb.clientProfile.findUnique({ where: { id: clientId } });
      const dbProfile = (client?.profileData as Record<string, unknown>) || {};
      const { next, changed } = mergeProfileUpdatePatch(dbProfile, patch);
      if (!changed) {
        console.log('[PROFILE_UPDATE] No-op merge (unchanged)');
        return;
      }
      await prismadb.clientProfile.upsert({
        where: { id: clientId },
        update: { profileData: next as Prisma.InputJsonValue },
        create: { id: clientId, profileData: next as Prisma.InputJsonValue },
      });
      console.log('[PROFILE_UPDATE] Async persist ok:', {
        name: patch.name || undefined,
        height: patch.height || undefined,
        weight: patch.weight || undefined,
        personal_style: patch.personal_style || undefined,
        preference_additions: patch.preference_additions,
      });
    } catch (error) {
      console.error('[PROFILE_UPDATE] Async persist failed:', error);
    }
  })();
}
