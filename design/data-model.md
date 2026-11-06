# 数据表结构

来源：`server/db/schema.prisma`。数据库是 PostgreSQL（Neon）。

## 全局约定

- 主键几乎都是 `String @id @default(cuid())`。`cuid` 由 Prisma Client 在插入前生成，不是数据库函数。
- `@updatedAt` 由 Prisma 在更新时写当前时间。
- `relationMode = "prisma"`：关系只在 Prisma Client 里维护，**数据库没有外键约束**。`onDelete: Cascade / SetNull` 只在走 Prisma 删除时生效；直接 SQL 删除不会级联。
- 因此下面标成「关系字段」的列，库里只是普通字符串加索引（如果建了索引）。完整性靠应用保证。
- `Json` 在 Postgres 里是 `jsonb`。
- `Unsupported("vector(2048)")` 是 pgvector 列，Prisma 不能直接读写，检索走原生 SQL。

索引分三种：

| 标记 | 作用 |
|---|---|
| `@id` | 主键，唯一索引，非空。按主键点查、被别的表引用时走它 |
| `@unique` / `@@unique` | 唯一索引。插入重复值时数据库拒绝 |
| `@@index` | 普通索引，加速过滤和与索引顺序一致的排序，不禁止重复 |

复合索引从左到右用。`@@index([userId, createdAt])` 能服务 `WHERE userId = ?` 以及 `WHERE userId = ? ORDER BY createdAt`，不能单独服务 `ORDER BY createdAt`。

## 关系

```
User 1──* Conversation 1──* Message
         └──* Summary
User 1──* ClothingItem
User 1──* SavedOutfit
User 1──* CreditLedger
User 1──* UsageEvent
CreditRedeemCode、UsageMessageRollup 不挂外键关系
```

身份链路：登录用户就是 `User`。会话、衣橱、档案都挂在 `userId` 上。旧上传目录仍是 `shows/user-uploads/{原 ClientProfile.id}/`，只对 3 个历史账号在 `server/auth/legacyUploadPrefix.ts` 里放行。

## User

登录账号。用户名 + 密码。档案 JSON 在本表。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `username` | **唯一索引**。库存小写 |
| `passwordHash` | `scrypt:N:r:p:salt:hash` |
| `securityQuestions` | `[{question, answerHash}]`，默认 `[]` |
| `recoveryCodeHashes` | 恢复码哈希数组 |
| `failedLoginAttempts` / `lockedUntil` | 登录失败计数与锁定截止时间 |
| `sessionVersion` | 改密 / 重置时 +1，旧 session cookie 失效 |
| `creditBalance` | 探索次数余额缓存，默认 0 |
| `profileData` | 档案 JSON，默认 `{}` |
| `createdAt` / `updatedAt` | |

## CreditLedger

## CreditLedger

积分流水：注册赠送、兑换、后台加额、出图扣次、退款。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `userId` | 指向 `User.id`。Prisma 删除用户时级联删流水 |
| `delta` | 正数加、负数扣 |
| `reason` | `signup_grant` \| `redeem` \| `admin_grant` \| `image_gen` \| `refund` |
| `messageId` / `imageId` | 出图扣次时记下出处，可空 |
| `meta` | 兑换码哈希等附加信息 |
| `createdAt` | |

索引：`@@index([userId, createdAt])`，按用户拉最近流水。

注册赠送用「是否已有 `signup_grant` 流水」做幂等，没有唯一约束，并发双调用仍可能各记一笔。

## CreditRedeemCode

积分兑换码库存。只存哈希，明文只在创建接口返回一次。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `codeHash` | **唯一索引**。SHA-256(大写去空格后的明文) |
| `credits` | 兑出的积分数 |
| `maxUses` | 可用次数，默认 1 |
| `usedCount` | 已用次数，默认 0 |
| `expiresAt` | 可空 |
| `note` | 后台备注 |
| `createdAt` | |

兑换在事务里 `SELECT ... FOR UPDATE` 锁这一行，再增加 `usedCount`，避免同一码并发超兑。这是项目里唯一的显式行锁。

## UsageEvent

单次模型调用的 token / 费用，和 `usage-audit.jsonl` 对齐，用来跑数。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `userId` | 可空。用户删除时置空（`SetNull`），事件保留 |
| `clientId` / `conversationId` / `messageId` | 归因，都不是外键 |
| `model` | 模型名 |
| `kind` | `chat` \| `image` \| `embedding` |
| `cacheHitTokens` / `cacheMissTokens` / `completionTokens` / `embeddingTokens` | 默认 0 |
| `generatedImages` | 默认 0 |
| `costCny` | `Decimal(12, 6)`，未定价则为空 |
| `rateId` | 计价规则 id |
| `createdAt` | |

索引：

- `@@index([messageId, createdAt])`：一条消息下的调用
- `@@index([userId, createdAt])`：一个用户的花费
- `@@index([createdAt])`：按时间扫全量

## UsageMessageRollup

一条 AI 消息的花费汇总。主键就是 `messageId`，不是 cuid。

| 字段 | 说明 |
|---|---|
| `messageId` | 主键 |
| `userId` / `conversationId` | 可空，无外键 |
| `calls` 及各类 token / `generatedImages` | 汇总计数 |
| `pricedCostCny` | `Decimal(12, 6)`，默认 0 |
| `unpricedCalls` | 没配到单价的调用数 |
| `durationMs` | 可空 |
| `updatedAt` | |

索引：`@@index([userId, updatedAt])`。

## SavedOutfit

用户收藏的穿搭快照。归属 `userId`。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `userId` | 指向 `User`。删用户时级联删除 |
| `sourceMessageId` | 来源消息，可空 |
| `sourceConversationId` | 来源会话，可空 |
| `sourceOutfitId` | 一条消息里的第几套方案 |
| `title` / `coverImageUrl` | 列表展示 |
| `snapshot` | `{ concept, items, visual? }`，收藏当时的方案快照，不随衣橱改动 |
| `eligibleForPlan` | 默认 true。托管模式是否可拿去再规划 |
| `createdAt` / `updatedAt` | |

约束：

- `@@unique([userId, sourceMessageId, sourceOutfitId])`：同一用户对同一方案只能收藏一次
- `@@index([userId, createdAt])`：收藏列表按时间

## Conversation

一次对话。`userId` 指向 `User`。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `title` | |
| `userId` | 指向 `User.id`。删用户时 Prisma 级联删会话 |
| `createdAt` / `updatedAt` | |

索引：`@@index([userId])`，拉某个用户的会话列表。

## Message

会话中的一条消息。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `role` | `user` 或 `ai` |
| `content` | JSON。文本、图片、方案结构都在里面，默认 `{}` |
| `status` | `generating` \| `completed` \| `failed`，默认 `completed` |
| `timestamp` | 业务时间，和 `createdAt` 分开 |
| `conversationId` | 指向 `Conversation`。删会话时 Prisma 级联删消息 |
| `createdAt` / `updatedAt` | |

索引：`@@index([conversationId, createdAt])`，一个会话里按时间分页。

## Summary

某个会话在某一时刻之前的对话摘要。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `content` | `@db.Text`，长文本，不限 `varchar` 长度 |
| `summarizedUntil` | 本摘要覆盖此时间戳之前的消息 |
| `conversationId` | 指向 `Conversation`。删会话时级联删除 |
| `createdAt` | |

没有二级索引。按会话查摘要目前走 `conversationId` 全表过滤；量上来后再补 `@@index([conversationId, createdAt])`。

## ClothingItem

衣橱单品。挂在 `User` 上。

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `imageUrl` | 单品图 |
| `mainCategory` | 枚举，见下。用来做 Tab |
| `subCategory` | AI 填的子类，如 T-shirt |
| `season` / `material` | 字符串数组，默认 `[]` |
| `tempMin` / `tempMax` | 适合温度上下限（℃，含边界）。空表示该侧不限制 |
| `description` | 可空 |
| `colors` / `tags` | |
| `searchDescription` | 给 embedding 用的英文检索描述 |
| `occasions` / `formality` / `silhouette` | 场合、正式度、廓形 |
| `embedding` | `vector(2048)`。图文向量，图搜图，不参与 Stylist 文本 RAG |
| `textEmbedding` | `vector(2048)`。纯文本向量，Stylist / Gatekeeper 文本 RAG |
| `userId` | 指向 `User`。删用户时级联删衣物 |
| `createdAt` / `updatedAt` | |

索引：`@@index([userId])` 拉某人衣橱。两列向量没有 Prisma `@@index`；相似度检索若用了 ivfflat / hnsw，是在迁移或 SQL 里另建的，不在这份 schema 里。

### ClothingMainCategory

`TOP` 上装、`BOTTOM` 下装、`OUTERWEAR` 外套、`FOOTWEAR` 鞋履、`ACCESSORY` 配饰、`ONE_PIECE` 连身装。
