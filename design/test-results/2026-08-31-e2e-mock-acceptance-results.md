# E2E 验收测试结果（Mock API · UI 逻辑）

> 生成时间：2026-09-02T03:33:05.942Z
> 方案文档：[2026-08-31-e2e-acceptance-test-plan.md](../features/2026-08-31-e2e-acceptance-test-plan.md)
> 浏览器：系统 Google Chrome（channel: chrome）
> 说明：UI 交互真实，API 层使用 page.route mock（快速回归）

## 汇总

| 指标 | 数值 |
|---|---|
| 总计 | 10 |
| 通过 | 10 |
| 失败 | 0 |
| 跳过 | 0 |
| 总耗时 | 14s |
| 整体状态 | passed |

## 用例明细

| ID | 用例 | 状态 | 耗时 | 文件 |
|---|---|---|---|---|
| [ACC-A1] | mock › acceptance/access-control.spec.ts › access control › [ACC-A1] browse mode shows banner and disables chat input | ✅ passed | 4647ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-A2] | mock › acceptance/access-control.spec.ts › access control › [ACC-A2] browse mode hides feature cards and shows browse hint | ✅ passed | 4631ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-A4] | mock › acceptance/access-control.spec.ts › access control › [ACC-A4] wrong access code shows error | ✅ passed | 5230ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-A3] | mock › acceptance/access-control.spec.ts › access control › [ACC-A3] correct access code unlocks full mode | ✅ passed | 6759ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-A5] | mock › acceptance/access-control.spec.ts › access control › [ACC-A5] logout returns to browse mode | ✅ passed | 3349ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-W1] | mock › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W1] loads wardrobe items with subCategory labels | ✅ passed | 3673ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W2] | mock › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W2] category tab filters by mainCategory | ✅ passed | 3461ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W3] | mock › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W3] browse mode is read-only without batch manage | ✅ passed | 2629ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W4] | mock › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W4] verified mode shows batch manage button | ✅ passed | 2305ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W5] | mock › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W5] logout control does not overlap wardrobe actions | ✅ passed | 2270ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
## 真实 UI 走查

运行 `pnpm test:e2e:live` 对真实后端做 UI 验收，结果见 `2026-08-31-ui-live-acceptance-results.md`。
