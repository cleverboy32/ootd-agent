# 方案收藏 / 我的搭配

> 状态：已实施（路径 `/collect`，归属 `userId`）  
> 日期：2026-10-19  
> 关联：`design/feature_roadmap_brainstorm.md` §3.1；BP 托管模式「穿搭计划」可从收藏池抽取

## 背景与证据

- Stylist 输出的结构化方案（单品 + 效果图）只活在 `Message.content` / `imageStates` 里，聊完无法复用。
- 主页右侧 `SidebarRight` 文案已是「历史搭配」占位，但无数据。
- 账号体系已上线；收藏要求登录，归属挂 **`userId`**（不走衣橱遗留的 `clientProfileId`）。
- BP 第一阶段核心迭代是「穿搭计划」；收藏库是托管模式的候选池前置。

## Before / After

| | Before | After |
|---|---|---|
| 喜欢一套方案 | 只能截图或翻聊天记录 | 一点收藏，进入「我的搭配」永久可查 |
| 方案资产 | 散落在消息 JSON | 独立 `SavedOutfit` 快照表（按 userId） |
| 托管模式 | 无用户偏好池 | 可从收藏池抽（本迭代只预留字段/接口，不做推送） |

## 产品决策（已确认）

1. **独立页** `/collect`「我的搭配」。
2. **归属 `userId`**：登录态收藏；鉴权用 `getSessionUser`。
3. **快照优先**：存单品 id/名/层/图 URL + 效果图 URL；衣橱单品删除后收藏仍可看（可标「部分单品已不在衣橱」）。
4. **托管预留**：`eligibleForPlan` + `GET ?eligibleForPlan=true`；不做定时/推送。
5. **入口**：聊天气泡收藏；「我的」下拉 → `/collect`；右侧栏展示最近收藏并链到 `/collect`。

## 范围

### In MVP

- Prisma：`SavedOutfit`（见下）
- API：`POST/GET/DELETE /api/saved-outfits`（鉴权 + 归属校验）
- 对话 UI：有成功效果图的方案可收藏 / 取消收藏
- 独立页：`/collect` 网格列表 + 空态 + 取消收藏
- 右侧栏：最近若干条缩略 +「查看全部」→ `/collect`
- 幂等：同一 `(userId, sourceMessageId, sourceOutfitId)` 不重复收藏

### Out（明确不做）

- 文件夹 / 多标签体系
- 分享社区 / 公开页
- 从收藏一键「再生成效果图」
- 穿搭计划触发层 / Web Push

## 数据模型

```prisma
model SavedOutfit {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  sourceMessageId String?
  sourceOutfitId  String   // e.g. outfit_1

  title           String
  coverImageUrl   String?
  /// 快照：{ concept, items: [{ wardrobeItemId?, name, layer, imageUrl? }], visual? }
  snapshot        Json

  eligibleForPlan Boolean  @default(true)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([userId, sourceMessageId, sourceOutfitId])
  @@index([userId, createdAt])
}
```

## 验收标准

### 对话场景

- [ ] AI 方案效果图加载成功后，卡片可见「收藏」；点击后变为「已收藏」
- [ ] 再次点击取消收藏，列表与按钮状态同步
- [ ] 未登录点击收藏 → 引导去登录（回跳）
- [ ] 同一方案重复点收藏不产生两条记录

### 独立页 `/collect`

- [ ] 展示当前账号全部收藏：封面图 + 标题 + 单品摘要
- [ ] 空态文案引导去对话里收藏
- [ ] 可取消收藏；刷新后仍正确
- [ ] 源衣橱单品已删时，卡片仍展示快照（可选角标「部分单品已移除」）

### API / 单测

- [ ] 未登录 `POST/GET` → 401
- [ ] 用户 A 不能 DELETE 用户 B 的收藏 → 403/404
- [ ] 唯一约束：重复 POST 幂等返回已有记录
- [ ] `eligibleForPlan` 默认 true，GET 支持 `?eligibleForPlan=true`

### 托管预留

- [ ] `GET /api/saved-outfits?eligibleForPlan=true` 仅返回可抽取项

## 导航

- 「我的」下拉：「我的搭配」→ `/collect`
- `SidebarRight`：最近收藏缩略 → `/collect`
