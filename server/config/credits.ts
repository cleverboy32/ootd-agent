/** 产品积分与标价配置（扣次只看积分；钱用于兑换包/跑数，不对气泡展示）。 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** 成功 1 张效果图扣除的积分 */
export function creditCostPerImage(): number {
  return Math.max(1, envInt('CREDIT_COST_IMAGE', 1));
}

/** 注册赠送探索次数 */
export function creditSignupGrant(): number {
  return envInt('CREDIT_SIGNUP_GRANT', 5);
}

/** 单积分对外标价（兑换包参考，不对 C 端逐条展示） */
export function creditListPriceCny(): number {
  return envFloat('CREDIT_CNY_LIST_PRICE', 0.3);
}

export const CREDIT_REASON = {
  signupGrant: 'signup_grant',
  redeem: 'redeem',
  adminGrant: 'admin_grant',
  imageGen: 'image_gen',
  refund: 'refund',
} as const;

export type CreditReason = (typeof CREDIT_REASON)[keyof typeof CREDIT_REASON];

export const CREDIT_REASON_LABELS: Record<string, string> = {
  [CREDIT_REASON.signupGrant]: '注册赠送',
  [CREDIT_REASON.redeem]: '兑换码加次',
  [CREDIT_REASON.adminGrant]: '人工充值',
  [CREDIT_REASON.imageGen]: '生成效果图',
  [CREDIT_REASON.refund]: '退还次数',
};
