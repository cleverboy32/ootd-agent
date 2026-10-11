# E2E 验收测试结果（Mock API · UI 逻辑）

> 生成时间：2026-10-11T09:51:36.826Z
> 方案文档：[2026-08-31-e2e-acceptance-test-plan.md](../features/2026-08-31-e2e-acceptance-test-plan.md)
> 浏览器：系统 Google Chrome（channel: chrome）
> 说明：UI 交互真实，API 层使用 page.route mock（快速回归）

## 汇总

| 指标 | 数值 |
|---|---|
| 总计 | 19 |
| 通过 | 19 |
| 失败 | 0 |
| 跳过 | 0 |
| 总耗时 | 31s |
| 整体状态 | passed |

## 用例明细

| ID | 用例 | 状态 | 耗时 | 文件 |
|---|---|---|---|---|
| [ACC-A1] | mock › acceptance/access-control.spec.ts › access control › [ACC-A1] browse mode shows banner and disables chat input | ✅ passed | 4195ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-A2] | mock › acceptance/access-control.spec.ts › access control › [ACC-A2] browse mode hides feature cards and shows browse hint | ✅ passed | 4313ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-A3] | mock › acceptance/access-control.spec.ts › access control › [ACC-A3] correct access code unlocks full mode | ✅ passed | 6223ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-C1] | mock › acceptance/chat-verified.spec.ts › verified chat › [ACC-C1] verified user can send message and receive mock SSE reply | ✅ passed | 2872ms | `tests/e2e/acceptance/chat-verified.spec.ts` |
| [ACC-N1] | mock › acceptance/navigation.spec.ts › navigation › [ACC-N1] sidebar chat link loads home | ✅ passed | 2446ms | `tests/e2e/acceptance/navigation.spec.ts` |
| [ACC-N2] | mock › acceptance/navigation.spec.ts › navigation › [ACC-N2] sidebar wardrobe link loads wardrobe page | ✅ passed | 2746ms | `tests/e2e/acceptance/navigation.spec.ts` |
| [ACC-A4] | mock › acceptance/access-control.spec.ts › access control › [ACC-A4] wrong access code shows error | ✅ passed | 10738ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-N3] | mock › acceptance/navigation.spec.ts › navigation › [ACC-N3] sidebar profile link loads profile page | ✅ passed | 2031ms | `tests/e2e/acceptance/navigation.spec.ts` |
| [ACC-A5] | mock › acceptance/access-control.spec.ts › access control › [ACC-A5] logout returns to browse mode | ✅ passed | 6706ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-N4] | mock › acceptance/navigation.spec.ts › navigation › [ACC-N4] browse mode hides add clothing on wardrobe overview | ✅ passed | 1505ms | `tests/e2e/acceptance/navigation.spec.ts` |
| [ACC-P1] | mock › acceptance/profile-display.spec.ts › profile display › [ACC-P1] profile page loads mock profile data | ✅ passed | 3052ms | `tests/e2e/acceptance/profile-display.spec.ts` |
| [ACC-N5] | mock › acceptance/navigation.spec.ts › navigation › [ACC-N5] verified mode shows add clothing next to batch manage, not in sidebar | ✅ passed | 3386ms | `tests/e2e/acceptance/navigation.spec.ts` |
| [ACC-W1] | mock › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W1] loads wardrobe items with subCategory labels | ✅ passed | 3471ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W2] | mock › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W2] category tab filters by mainCategory | ✅ passed | 3538ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W3] | mock › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W3] browse mode is read-only without batch manage | ✅ passed | 1660ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W5] | mock › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W5] logout control does not overlap wardrobe actions | ✅ passed | 2984ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W4] | mock › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W4] verified mode shows batch manage button | ✅ passed | 3734ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-C3] | mock › chat-network-error.spec.ts › chat network error handling › [ACC-C3] shows retry on AI message when stream errors mid-response | ✅ passed | 2927ms | `tests/e2e/chat-network-error.spec.ts` |
| [ACC-C2] | mock › chat-network-error.spec.ts › chat network error handling › [ACC-C2] shows send failure below the user message and allows retry | ✅ passed | 3859ms | `tests/e2e/chat-network-error.spec.ts` |
## 真实 UI 走查

运行 `pnpm test:e2e:live` 对真实后端做 UI 验收，结果见 `2026-08-31-ui-live-acceptance-results.md`。
