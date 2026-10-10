/** 用户名 / 密保答案 / 恢复码的归一化与校验（纯函数，edge/Node 均可用） */

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 返回错误文案；校验通过返回 null */
export function validateUsername(username: string): string | null {
  if (!/^[a-z0-9_-]{3,20}$/.test(username)) {
    return '用户名需为 3~20 位字母、数字、下划线或连字符';
  }
  return null;
}

/** 密保答案归一化：全角转半角 → trim → 小写 → 连续空白归一 */
export function normalizeSecurityAnswer(raw: string): string {
  const halfWidth = raw
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)) // 全角 ASCII 区间 → 半角
    .replace(/　/g, ' '); // 全角空格
  return halfWidth.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface SecurityQuestionInput {
  question: string;
  answer: string;
}

/** 返回错误文案；校验通过返回 null */
export function validateSecurityQuestions(inputs: SecurityQuestionInput[]): string | null {
  if (!Array.isArray(inputs) || inputs.length < 2 || inputs.length > 3) {
    return '请设置 2~3 个密保问题';
  }
  const seen = new Set<string>();
  for (const item of inputs) {
    const question = typeof item?.question === 'string' ? item.question.trim() : '';
    if (question.length < 4 || question.length > 50) return '密保问题需为 4~50 字';
    if (seen.has(question)) return '密保问题不能重复';
    seen.add(question);
    const normalized = normalizeSecurityAnswer(
      typeof item?.answer === 'string' ? item.answer : ''
    );
    if (normalized.length < 1 || normalized.length > 50) return '密保答案需为 1~50 字';
  }
  return null;
}

/** Crockford base32（剔除易混淆的 I/L/O/U），256 % 32 = 0 无取模偏差 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_GROUPS = 3;
const RECOVERY_GROUP_LENGTH = 4;

function randomAlphabetChar(): string {
  const buf = new Uint8Array(1);
  crypto.getRandomValues(buf);
  return RECOVERY_ALPHABET[buf[0] % RECOVERY_ALPHABET.length];
}

/** 单个恢复码：XXXX-XXXX-XXXX */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < RECOVERY_GROUPS; g += 1) {
    let group = '';
    for (let i = 0; i < RECOVERY_GROUP_LENGTH; i += 1) group += randomAlphabetChar();
    groups.push(group);
  }
  return groups.join('-');
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => generateRecoveryCode());
}

/** 恢复码归一化：去连字符/空白 → 大写 */
export function normalizeRecoveryCode(raw: string): string {
  return raw.replace(/[-\s]/g, '').trim().toUpperCase();
}
