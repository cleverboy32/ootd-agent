# Request-Audit 首期规格

> 日期：2026-09-07  
> 状态：实施中

## 问题 / 目标

**Before**：各 Agent 各自写 `gatekeeper-audit` / `rag-search` / `copywriter-audit` / `visual-audit` / `image-gen-audit`，无法用一次 `messageId` 回答「这条请求走了哪条路、花了多久、客户端是否断联、最终成败」。

**After**：每次生成或单图重试结束时，`log/request-audit.jsonl` 追加 **一条** 汇总；现有 Agent jsonl **继续写、不改字段语义**。

**不改**：prompt、schema、路由逻辑、SSE 不断即停行为。

---

## `route` 含义（最终落盘值）

| 枚举成员 | 落盘字符串 | 含义 |
|---|---|---|
| `FromCache` | `from_cache` | 命中 stylist cache，断点续传 |
| `StyleAdvice` | `style_advice` | 咨询/建议路径，不出搭配+效果图 |
| `Incomplete` | `incomplete` | Gatekeeper 未放行（clarify/追问） |
| `OutfitMain` | `outfit_main` | 完整搭配主路径（含 `feedback_revision`） |
| `ImageRetry` | `image_retry` | 单张效果图重试 |
| `Unknown` | `unknown` | 极早失败 / 未设 route |

`feedback_revision` **不单独占 route**：`route=outfit_main` + `requestType=feedback_revision`。

若微调意图下追问选套（`is_complete=false`）→ `route=incomplete`，`requestType` 仍可能是 `feedback_revision`。

---

## 字段与枚举

见 `server/logging/request.ts`：

- `RequestAuditRoute` / `RequestAuditRequestType` / `RequestAuditKind` / `RequestAuditOutcome`（string enum，中文注释）
- `RequestAuditLogEntry`：`durationMs`、`stages.*Ms`、`summary`、`clientCancelled`
- `toRequestAuditRequestType`：仅映射合法 8 值；非法返回 `undefined`
- `toRequestAuditRoute`：从 graph `PipelineRoute` 映射；`''` → `Unknown`

语义：

- `clientCancelled=true` 且 `outcome=completed`：**正常**（断联后后台跑完写库）
- `outcome` 不把断联当成 failed
- `route` = 流水线枝；`requestType` = Gatekeeper 意图

---

## 验收标准

### 单测
- [ ] `RequestTrace.finalize`：未 cancel → `clientCancelled=false`，`outcome` 透传
- [ ] cancel 后再 finalize(completed) → `clientCancelled=true` 且 `outcome=completed`
- [ ] `markStage` 后 `stages.*Ms` 出现在 entry
- [ ] `toRequestAuditRequestType`：合法 8 值映射成功；非法值返回 undefined
- [ ] `pnpm test` 中该文件通过

### 类型
- [ ] `pnpm exec tsc --noEmit` 0 errors

### 真实对话（手工）
- [ ] 发一条会出搭配的消息 → `log/request-audit.jsonl` 末行：`kind=generate`，有 `messageId`、`durationMs`、`requestType`、`outcome=completed`
- [ ] 同 `messageId` 能在 `gatekeeper-audit.jsonl`（若走过 Gatekeeper）对上
- [ ] 刷新/关页打断 SSE → 仍有一条 request-audit；若流水线跑完则 `clientCancelled=true` 且 `outcome=completed`
- [ ] 点效果图重试 → 一条 `kind=image_retry`，含 `imageGenMs` / image 计数

### 边界
- [ ] clarify / incomplete 路径也写一条（`route=incomplete`），不要求有 image stages
- [ ] 写 audit 失败只打 console.error，不拖垮主流程
