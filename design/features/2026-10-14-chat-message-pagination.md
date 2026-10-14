# 聊天消息分页加载

> 日期：2026-10-14  
> 状态：已实现，待手工验收 + 执行迁移

## 问题 / 目标

**Before**：

- `GET /api/conversations/[id]/messages` 用 `findMany` 无 `take` 全量返回，`content` 含 `stylist_cache` 等大字段，长会话响应体随轮数线性增长
- `store/chat.ts` → `setActiveConversationId` 一次性写入全部消息；`ChatMessagesList` 全量 `messages.map` 渲染
- 首屏耗时、内存、流式期间 `updateMessages` 的遍历开销都随会话长度增长

**After**：

1. 打开会话只拉最近 `PAGE_SIZE` 条，首屏定位到底部
2. 滚动到顶部时自动加载更早一页，视口位置保持不跳动
3. 无更早消息时移除顶部 sentinel，不再请求

**不改**：

- 服务端生成链路的历史上下文（`buildContext` / `helpers.ts` 直接查库，不依赖前端 `messages`）
- 虚拟列表（需引新依赖，二期视长会话实测再定）
- 会话列表 `GET /api/conversations`

---

## 影响面核查


| 位置                     | 现状                                              | 分页后的风险                              | 处理                    |
| ---------------------- | ----------------------------------------------- | ----------------------------------- | --------------------- |
| `useChatHandler` 发消息   | payload 只带 `conversationId` + 本轮内容              | 无                                   | 不改                    |
| `useChatHandler` 重试    | `messages[retryIdx - 1]` 取原始用户消息                | 页首若是 AI 消息，找不到配对的 user 消息           | 服务端保证每页首条为 `user`（见下） |
| `ChatMessagesList`     | `key={idx}`                                     | 头部插入后所有 `ChatMessage` 重挂载，图片状态/动画重置 | 改 `key={msg.id}`      |
| `app/page.tsx`         | `[messages, isLoading]` 变化即 `scrollIntoView` 到底 | 加载更早消息时被拽回底部                        | 仅在「尾部新增/流式更新」时滚底      |
| `useImageRetry` / 流式更新 | 按 `id` 定位消息                                     | 无                                   | 不改                    |


---

## 设计

### API

`GET /api/conversations/[id]/messages?limit=20&before=<messageId>`

- 不传 `before`：取最新一页
- 排序 `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`，`cursor: { id: before }, skip: 1`，`take: limit + 1` 判断 `hasMore`
- **页边界对齐**：多取的结果反转为正序后，若 `hasMore` 且首条 `role !== 'user'`，丢弃页首直到遇到 `user`（被丢弃的消息落入下一页）
- `limit` 夹紧到 `[1, 50]`，默认 20
- 响应：`{ messages: DbMessage[], nextCursor: string | null }`（`nextCursor` 为本页最旧消息 id，无更多时为 `null`）

纯函数抽到 `server/utils/messagePage.ts`：

```ts
export function buildMessagePage<T extends { id: string; role: string }>(
  rowsDesc: T[],
  limit: number,
): { messages: T[]; nextCursor: string | null };
```

### 客户端

- `lib/api/chat.ts`：`getMessages(id, { before?, limit? })` → `{ messages: Message[]; nextCursor: string | null }`
- `store/chat.ts` 新增状态 `nextCursor`、`isLoadingOlder`，新增 action `loadOlderMessages()`
  - 并发保护：`isLoadingOlder` 或 `nextCursor === null` 时直接返回
  - 竞态保护：请求返回时 `activeConversationId` 已变则丢弃
  - 去重：按 `id` 过滤已存在的消息后 prepend
- `ChatMessagesList`：顶部 sentinel + `IntersectionObserver`（root 为 `page.tsx` 的滚动容器）触发 `loadOlderMessages`
- 滚动保持：每次提交后记录 `scrollHeight`；页首 id 变化且旧页首仍在列表中时，`scrollTop += 新scrollHeight - 旧scrollHeight`。滚动容器设 `overflow-anchor: none`，避免与浏览器原生滚动锚定重复补偿
- 滚底条件：仅跟随 `messages.at(-1)` 引用变化（头部插入时引用不变）；用户上翻（`scrollTop` 减小）后停止跟随，回到底部 80px 内或自己发新消息时恢复
- 首屏用瞬时定位而非平滑滚动：平滑滚动期间顶部 sentinel 可见，会误触发加载更早消息

### 索引

`@@index([conversationId])` 替换为 `@@index([conversationId, createdAt])`（最左前缀覆盖原单列查询）。迁移 `20261014080000_message_conversation_created_at_index`，SQL 与 `prisma migrate diff` 输出一致。

---

## 验收标准

### 单测（`tests/unit/message/messagePage.test.ts`，9 pass）

- [x] 行数 ≤ limit → `nextCursor = null`，返回正序
- [x] 行数 = limit + 1 → `hasMore`，返回 limit 条正序，`nextCursor` = 返回结果首条 id
- [x] `hasMore` 且页首为 `ai` → 丢弃直至首条为 `user`，`nextCursor` 指向新页首
- [x] 无更多时页首为 `ai`（会话首条本就异常）→ 不丢弃
- [x] 整页无 `user` 消息 → 不丢空，原样返回（防死循环）
- [x] `limit` 解析：缺省/非法回落 20，夹紧 `[1, 50]`

### API（真实库只读脚本，消息数前 3 的会话，limit = 20 / 5 / 3）

- [x] 无参数 → 最新一页，正序
- [x] 依次带 `before` 翻页直到 `nextCursor = null`，拼接结果与全量**逐条一致**（3 会话 × 3 种 limit 全部 `identical: true`）
- [x] 有更多页时页首均为 `user`
- [x] 他人 `clientId` 访问 → 空结果（`where` 归属条件未改）
- [x] `limit=1000` → 被夹紧为 50（单测覆盖）

### 页面（手工）

- [ ] 打开超过一页的会话：首屏只渲染最近一页，定位在底部
- [ ] 滚到顶 → 加载更早一页，可视区域内容不跳动
- [ ] 翻到最早 → sentinel 消失，不再发请求（Network 面板确认）
- [ ] 加载更早消息过程中切换会话 → 新会话不混入旧会话消息
- [ ] 流式生成中向上翻页 → 流式内容继续正常更新，不被拽回底部
- [ ] 对页首附近的 AI 消息点重试 → 能找到原始用户消息并正常重试
- [ ] 新建会话 / 发送新消息 → 仍自动滚底

### 指标

- [x] 首屏响应体（JSON 字节）：`cmtqyc2b…` 26 条 760,810 → 550,446；`cmts3yii…` 26 条 126,680 → 112,106。现有会话最长 26 条，分页收益有限；单条消息最大约 29KB，主要是 `stylist_cache`，二期瘦身收益更大

### 类型 / 回归

- [x] `pnpm exec tsc --noEmit` 0 errors
- [x] `pnpm test` 313 pass / 3 fail（3 条为既有的 `finalizeGatekeeperResult — style_advice` 失败，与本改动无关）

---

## 提交拆分

1. `buildMessagePage` 纯函数 + 单测
2. API 支持 `limit/before` + `lib/api/chat.ts` 适配 + store 首屏只取最新一页（功能可独立上线：此时只是看不到更早消息）
3. `key={msg.id}` + 滚底条件收窄
4. `loadOlderMessages` + sentinel + 滚动位置保持
5. `Message` 复合索引迁移

## 二期

- 服务端投影 `content`，不下发 `stylist_cache`（mapper 已在客户端丢弃，纯浪费带宽）
- 视实测引入虚拟列表

