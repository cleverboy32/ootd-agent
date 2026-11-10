export type OutfitPlanStrategyMode = 'revision' | 'pairing' | 'outfit';

export type OutfitPlanStrategyOptions = {
  mode: OutfitPlanStrategyMode;
  hasStyleSkill: boolean;
  /** pairing 且锚定为配饰时，必须补齐 top/bottom/shoes */
  accessoryAnchorRequiresFullBase?: boolean;
};

/**
 * Plan 阶段策略提示。无风格：只定槽位+厚薄；有风格：形态进 target。
 */
export function buildOutfitPlanStrategyHint(options: OutfitPlanStrategyOptions): string {
  const { mode, hasStyleSkill, accessoryAnchorRequiresFullBase } = options;

  if (mode === 'revision') {
    return `- 当前为【反馈微调】：只为 special_requests 要改的槽位写 slots，未改槽位不要写入 plan。`;
  }

  if (mode === 'pairing') {
    const accessoryLine = accessoryAnchorRequiresFullBase
      ? '锚定为配饰：必须包含 top、bottom、shoes。'
      : '';
    const styleLine = hasStyleSkill
      ? '\n- 已注入风格技能：形态写进 target；search_query 仍粗（品类+轮廓）。'
      : '\n- 无风格技能：互补槽 target/search_query 只写槽位大类+天气厚薄，细品类留给召回后确认。';
    return `- 当前为【待购/衣橱锚定搭配】：只为互补槽位写 slots。已占用的槽位不要写。${accessoryLine}${styleLine}`;
  }

  if (hasStyleSkill) {
    return `- 若用户要「一套」：只出 outfit_1；覆盖上装+下装+鞋（视天气加外套），不要混裤装与连衣裙路线。
- 已注入风格技能：有天气细则时先跟层次与厚薄；形态细节放 target；search_query 只写粗品类+轮廓。
- 若场合需要点缀或用户提及配饰：加 accessory 槽。
- target 与 search_query 必须同品类主线；search_query 一律粗；多套时每套该槽可不同 query（分开检索）。`;
  }

  return `- 若用户要「一套」：只出 outfit_1；覆盖上装+下装+鞋（视天气加外套），不要混裤装与连衣裙路线。
- 无风格技能：本步只定【槽位集合 + 天气厚薄】，不定细品类初稿。overall_concept 写场合与层次即可。
- target / search_query 只写槽位大类与厚薄（如上装、下装、鞋、薄外套）；可带性别词。禁止预设具体鞋型、裤型、外套款名。
- 裙还是裤、具体鞋型留给召回后根据衣橱组合；不要无理由默认运动鞋。
- 若场合需要点缀或用户提及配饰：加 accessory 槽。
- 多套时每套该槽可不同粗 query（分开检索）。`;
}

/** Reconcile 侧无风格时的衣橱组搭提示。 */
export function buildReconcileNoStyleStrategyHint(hasStyleSkill: boolean): string {
  if (hasStyleSkill) return '';
  return `
【无风格技能 — 衣橱组搭】
- Plan 只有槽位大类+厚薄，没有细品类初稿。你的主任务是从各槽召回 XML 里选出能互相搭配、且适合本轮场合的衣橱件。
- 槽位 status=adequate 且大类可用时【必须】用衣橱件；禁止仅为更「理想款」整槽改 new_item。本规则覆盖通用「weak 必须 new」——无风格粗检索下 adequate 已含灰区大类命中。
- 不要以「未兑现某细款名」为由拒衣橱；细品类由你根据衣橱与场合决定。
- 仅 status=none，或场合硬冲突（明显不能穿去该场合）时才 new_item，并在 reason 说明。status=weak 且仍有同槽大类候选时，优先换候选衣橱件，不要直接整槽 new。
`;
}
