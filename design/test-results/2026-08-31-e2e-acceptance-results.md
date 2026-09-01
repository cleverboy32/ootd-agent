# E2E 验收测试结果

> 生成时间：2026-08-31T13:32:51.875Z
> 方案文档：[2026-08-31-e2e-acceptance-test-plan.md](../features/2026-08-31-e2e-acceptance-test-plan.md)

## 汇总

| 指标 | 数值 |
|---|---|
| 总计 | 18 |
| 通过 | 16 |
| 失败 | 2 |
| 跳过 | 0 |
| 总耗时 | 401s |
| 整体状态 | failed |

## 用例明细

| ID | 用例 | 状态 | 耗时 | 文件 |
|---|---|---|---|---|
| [ACC-A2] | chrome › acceptance/access-control.spec.ts › access control › [ACC-A2] browse mode hides feature cards and shows browse hint | ✅ passed | 6424ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-A1] | chrome › acceptance/access-control.spec.ts › access control › [ACC-A1] browse mode shows banner and disables chat input | ✅ passed | 6913ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-A4] | chrome › acceptance/access-control.spec.ts › access control › [ACC-A4] wrong access code shows error | ✅ passed | 10016ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-C1] | chrome › acceptance/chat-verified.spec.ts › verified chat › [ACC-C1] verified user can send message and receive mock SSE reply | ✅ passed | 3587ms | `tests/e2e/acceptance/chat-verified.spec.ts` |
| [ACC-A3] | chrome › acceptance/access-control.spec.ts › access control › [ACC-A3] correct access code unlocks full mode | ✅ passed | 20588ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-N1] | chrome › acceptance/navigation.spec.ts › navigation › [ACC-N1] sidebar chat link loads home | ✅ passed | 13066ms | `tests/e2e/acceptance/navigation.spec.ts` |
| [ACC-A5] | chrome › acceptance/access-control.spec.ts › access control › [ACC-A5] logout returns to browse mode | ✅ passed | 18957ms | `tests/e2e/acceptance/access-control.spec.ts` |
| [ACC-N4] | chrome › acceptance/navigation.spec.ts › navigation › [ACC-N4] browse mode hides add wardrobe nav item | ✅ passed | 2858ms | `tests/e2e/acceptance/navigation.spec.ts` |
| [ACC-P1] | chrome › acceptance/profile-display.spec.ts › profile display › [ACC-P1] profile page loads mock profile data | ✅ passed | 3192ms | `tests/e2e/acceptance/profile-display.spec.ts` |
| [ACC-N5] | chrome › acceptance/navigation.spec.ts › navigation › [ACC-N5] verified mode shows add wardrobe nav item | ✅ passed | 3900ms | `tests/e2e/acceptance/navigation.spec.ts` |
| [ACC-W2] | chrome › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W2] category tab filters by mainCategory | ✅ passed | 2019ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W1] | chrome › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W1] loads wardrobe items with subCategory labels | ✅ passed | 2460ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W4] | chrome › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W4] verified mode shows batch manage button | ✅ passed | 1587ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-W3] | chrome › acceptance/wardrobe-display.spec.ts › wardrobe display › [ACC-W3] browse mode is read-only without batch manage | ✅ passed | 2324ms | `tests/e2e/acceptance/wardrobe-display.spec.ts` |
| [ACC-C3] | chrome › chat-network-error.spec.ts › chat network error handling › [ACC-C3] shows retry on AI message when stream errors mid-response | ✅ passed | 2470ms | `tests/e2e/chat-network-error.spec.ts` |
| [ACC-C2] | chrome › chat-network-error.spec.ts › chat network error handling › [ACC-C2] shows send failure below the user message and allows retry | ✅ passed | 3934ms | `tests/e2e/chat-network-error.spec.ts` |
| [ACC-N2] | chrome › acceptance/navigation.spec.ts › navigation › [ACC-N2] sidebar wardrobe link loads wardrobe page | ❌ timedOut | 30027ms | `tests/e2e/acceptance/navigation.spec.ts` |
| [ACC-N3] | chrome › acceptance/navigation.spec.ts › navigation › [ACC-N3] sidebar profile link loads profile page | ❌ timedOut | 30040ms | `tests/e2e/acceptance/navigation.spec.ts` |

## 失败详情

### [ACC-N2] chrome › acceptance/navigation.spec.ts › navigation › [ACC-N2] sidebar wardrobe link loads wardrobe page

```
[31mTest timeout of 30000ms exceeded.[39m
```

### [ACC-N3] chrome › acceptance/navigation.spec.ts › navigation › [ACC-N3] sidebar profile link loads profile page

```
[31mTest timeout of 30000ms exceeded.[39m
```

## 未自动化项（需人工）

- 真实 LLM 对话链路（Gatekeeper → RAG → Stylist → Visual）
- RAG 分数：`pnpm replay:rag-scores`
- 真实 COS 上传 + 双向量入库
- 真实 ACCESS_CODE API 层 mutating 拦截
