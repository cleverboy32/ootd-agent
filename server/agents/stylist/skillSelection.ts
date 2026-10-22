import type { GatekeeperIntent } from '../intent';
import { isAthleticOccasion } from '@/server/utils/ragMatchQuality';

/** 本轮 Stylist 要注入的技能。检索 query 与出方案共用。 */
export function selectStylistSkillNames(
  intent: GatekeeperIntent,
  userMessage: string
): string[] {
  const names: string[] = [];
  if (intent.weather?.trim()) names.push('weather-dressing');
  if (isAthleticOccasion(intent, userMessage)) names.push('athletic-outfit');
  return names;
}

/** 出方案专用。检索 query 不注入，避免读到「只出 1 套」等方案规则。 */
export function selectStylistOutfitSkillNames(intent: GatekeeperIntent): string[] {
  switch (intent.request_type) {
    case 'purchase_pairing':
      return ['stylist-purchase-pairing'];
    case 'wardrobe_pairing':
      return ['stylist-wardrobe-pairing'];
    case 'feedback_revision':
      return ['stylist-feedback-revision'];
    default:
      return [];
  }
}
