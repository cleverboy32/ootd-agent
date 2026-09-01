# 真实 UI 走查验收结果（Live · 无 API Mock）

> 生成时间：2026-08-31T13:46:41.125Z
> 方案文档：[2026-08-31-e2e-acceptance-test-plan.md](../features/2026-08-31-e2e-acceptance-test-plan.md)
> 浏览器：系统 Google Chrome（channel: chrome）
> 说明：**真实** dev server + DB + ACCESS_CODE + LLM，无 page.route mock

## 汇总

| 指标 | 数值 |
|---|---|
| 总计 | 7 |
| 通过 | 7 |
| 失败 | 0 |
| 跳过 | 0 |
| 总耗时 | 46s |
| 整体状态 | passed |

## 用例明细

| ID | 用例 | 状态 | 耗时 | 文件 |
|---|---|---|---|---|
| [LIVE-U1] | live › acceptance-live/full-ui-acceptance.spec.ts › live UI acceptance @live › [LIVE-U1] home page renders greeting | ✅ passed | 965ms | `tests/e2e/acceptance-live/full-ui-acceptance.spec.ts` |
| [LIVE-U2] | live › acceptance-live/full-ui-acceptance.spec.ts › live UI acceptance @live › [LIVE-U2] wardrobe page loads real wardrobe from API | ✅ passed | 933ms | `tests/e2e/acceptance-live/full-ui-acceptance.spec.ts` |
| [LIVE-U3] | live › acceptance-live/full-ui-acceptance.spec.ts › live UI acceptance @live › [LIVE-U3] profile page loads real client profile | ✅ passed | 1168ms | `tests/e2e/acceptance-live/full-ui-acceptance.spec.ts` |
| [LIVE-U4] | live › acceptance-live/full-ui-acceptance.spec.ts › live UI acceptance @live › [LIVE-U4] AppSidebar navigation between wardrobe and profile | ✅ passed | 1935ms | `tests/e2e/acceptance-live/full-ui-acceptance.spec.ts` |
| [LIVE-A1] | live › acceptance-live/full-ui-acceptance.spec.ts › live UI acceptance @live › [LIVE-A1] real ACCESS_CODE verify unlocks chat input | ✅ passed | 1083ms | `tests/e2e/acceptance-live/full-ui-acceptance.spec.ts` |
| [LIVE-A2] | live › acceptance-live/full-ui-acceptance.spec.ts › live UI acceptance @live › [LIVE-A2] real logout returns to browse mode | ✅ passed | 1136ms | `tests/e2e/acceptance-live/full-ui-acceptance.spec.ts` |
| [LIVE-C1] | live › acceptance-live/full-ui-acceptance.spec.ts › live UI acceptance @live › [LIVE-C1] real LLM chat returns assistant text in UI | ✅ passed | 21653ms | `tests/e2e/acceptance-live/full-ui-acceptance.spec.ts` |
## 仍未覆盖（需人工/脚本）

- 衣橱上传 + COS + 双向量入库
- RAG 分数阈值：`pnpm replay:rag-scores`
- 效果图质量：`log/visual-audit.jsonl`
