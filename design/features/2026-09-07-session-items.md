# 会话待购单品（session items）规格

> 日期：2026-09-07  
> 状态：已落地（首期）

## 问题 / 目标

**Before**：待购锚点图依赖本轮 `inlineData` 或上一轮 stylist_cache 里的 base64；历史 COS URL（`type:image`）进 Gate 前被丢掉；多轮微调容易丢锚点或串到「最新一张」。

**After**：

1. 在 `buildContext` 拉未摘要消息时**同步**抽出本会话用户上传图 → `sessionItems`
2. 注入 Gate 一次选型 → `session_item_id`
3. 锚定图以 **`anchor_image_url`（COS URL）** 为主；效果图参考优先 URL，不再依赖毒 cache 里的大 base64
4. `feedback_revision` 清空 `session_item_id`，锚点从**绑定该方案的** `anchor_image_url` 继承

**不改**：衣橱 pairing / style_advice 主逻辑；摘要窗口外的历史图（二期：轻量补查或写入时物化）

---

## 数据流

```
message.findMany(未摘要)
  → extractSessionItemsFromMessages
  → + 本轮 imageUrl（若尚未在清单）
  → buildContext 返回 sessionItems
  → Gate 上下文注入【会话待购单品】
  → LLM 填 session_item_id（purchase_pairing）
  → enrich：解析 URL → intent.anchor_image_url
  → Stylist / Seedream 用 URL；cache 持久化 anchor_image_url
```

`session_item.id`：按时间序 `si_1…si_n`，同窗口内稳定。

---

## 验收标准

### 单测
- [x] `extractSessionItemsFromMessages`：多条 user `type:image` → 有序 `si_1…`；同消息 text 作 hint
- [x] 忽略无图消息；支持 legacy `imageUrl` 字段
- [x] `resolveSessionItemBinding`：合法 id → 对应 URL；revision 清空 id；缺省时本轮 URL 命中 / 仅一件时兜底
- [x] `buildOutfitReferenceInputs`：有 `anchor_image_url` 时参考列表含该 URL（可不依赖 base64）

### 类型 / 回归
- [x] `pnpm exec tsc --noEmit` 0 errors
- [x] 相关单测通过（全量 `pnpm test` 仍有 3 条既有 style_advice 失败，与本改动无关）

### 对话场景（手工）
- [ ] 上传裤子 → Gate 放行 purchase_pairing，`session_item_id=si_1`，效果图 refs 含裤子 COS URL
- [ ] 同会话微调「二套」→ 仍用同一 `anchor_image_url`，不丢裤子
- [ ] 同会话再传第二件 → 清单两件；指代正确时 Gate 填对应 `si_n`
