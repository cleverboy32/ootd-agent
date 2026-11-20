# E2E 验收测试结果（Mock API · UI 逻辑）

> 生成时间：2026-11-20T09:55:20.437Z
> 方案文档：[2026-08-31-e2e-acceptance-test-plan.md](../features/2026-08-31-e2e-acceptance-test-plan.md)
> 浏览器：系统 Google Chrome（channel: chrome）
> 说明：UI 交互真实，API 层使用 page.route mock（快速回归）

## 汇总

| 指标 | 数值 |
|---|---|
| 总计 | 5 |
| 通过 | 5 |
| 失败 | 0 |
| 跳过 | 0 |
| 总耗时 | 21s |
| 整体状态 | passed |

## 用例明细

| ID | 用例 | 状态 | 耗时 | 文件 |
|---|---|---|---|---|
| [ACC-C4] | mock › chat-optimistic-send.spec.ts › new conversation optimistic send › [ACC-C4] shows the first message before the conversation is persisted | ✅ passed | 6298ms | `tests/e2e/chat-optimistic-send.spec.ts` |
| [ACC-C2] | mock › chat-network-error.spec.ts › chat network error handling › [ACC-C2] shows send failure below the user message and allows retry | ✅ passed | 7438ms | `tests/e2e/chat-network-error.spec.ts` |
| [ACC-C5] | mock › chat-optimistic-send.spec.ts › new conversation optimistic send › [ACC-C5] failed conversation creation keeps the message and retries | ✅ passed | 3123ms | `tests/e2e/chat-optimistic-send.spec.ts` |
| - | mock › chat-interrupt-send.spec.ts › sending a second message aborts the first generate stream | ✅ passed | 16320ms | `tests/e2e/chat-interrupt-send.spec.ts` |
| [ACC-C3] | mock › chat-network-error.spec.ts › chat network error handling › [ACC-C3] shows retry on AI message when stream errors mid-response | ✅ passed | 16848ms | `tests/e2e/chat-network-error.spec.ts` |
## 真实 UI 走查

运行 `pnpm test:e2e:live` 对真实后端做 UI 验收，结果见 `2026-08-31-ui-live-acceptance-results.md`。
