# 衣橱双向量 RAG 改造方案

> 状态：待实施  
> 日期：2026-08-31  
> 触发：Doubao 迁移后 RAG 零命中；诊断确认 text query 搜图文向量不合理，且分析 schema 与 Stylist query 词汇不对齐

---

## 1. 问题（Before）

### 现象

- Stylist 文本 RAG 检索频繁 0 命中或全 `new_item`
- Doubao 时代：`embedding` 存图文混合向量，query 纯文本，top1 ~0.43，被 `0.5` 阈值滤掉
- Google 时代：有跨模态 task type 对齐，top1 最高 ~0.78，但 `adequate` 阈值 0.78 几乎不可达

### 根因（已验证）

| 层 | 问题 |
|---|---|
| **向量模态** | 主链路是 Stylist **文本 query** → 搜 **图文 document**，图向量对文本检索是噪声（约 -0.06） |
| **分析目标** | 入库 prompt 偏「.catalog 建档」（视觉描述 + 泛 tags），Stylist query 偏「场合 + 槽位 + 功能」 |
| **阈值** | 按 Google 分数刻度标定，不适配 Doubao；且未区分 text / visual 两套向量 |
| **字段设计** | 仅一个 `embedding`，图文混用，无法保留图搜图能力的同时做 text RAG |

### 不涉及

- Stylist / Gatekeeper prompt 大改（本次只改入库分析与检索层）
- 图搜图功能实现（本次只**预留** visual 向量）

---

## 2. 期望行为（After）

1. **Stylist 文本 RAG** 只读 `textEmbedding`，text↔text 同模态检索
2. **现有 `embedding` 列保留**，继续写入图文混合向量，供未来图搜图 / 以图搜相似款
3. **入库分析** 输出检索导向字段，embedding 文本与 Stylist query 同语义空间
4. 上传 pipeline：**分析 → textEmbedding + visualEmbedding 分步可重试**（沿用现有 steps 机制）
5. 阈值按 **text 向量 + provider** 单独校准

---

## 3. 数据模型

### 3.1 Prisma / DB

```prisma
model ClothingItem {
  // ... 现有字段 ...

  /// 图文混合向量（Doubao multimodal / Vertex RETRIEVAL_DOCUMENT+image）
  /// 用途：未来图搜图、以图搜相似款；不参与 Stylist 文本 RAG
  embedding       Unsupported("vector(2048)")?

  /// 纯文本检索向量（分析结果格式化文本）
  /// 用途：Stylist / Gatekeeper 文本 RAG
  textEmbedding   Unsupported("vector(2048)")?
}
```

**命名约定（代码注释 + 日志）：**

| DB 列 | 代码常量名建议 | 含义 |
|---|---|---|
| `embedding` | `visualEmbedding` | 图文 / 视觉向量（**不 rename 列**，避免破坏已有数据与脚本） |
| `textEmbedding` | `textEmbedding` | 文本检索向量 |

**索引：** 暂不建 pgvector HNSW（衣橱量级 <1000）；后续量大再加。

### 3.2 迁移

```sql
-- 新增列，不影响现有 embedding
ALTER TABLE "ClothingItem" ADD COLUMN "textEmbedding" vector(2048);
```

- **不** 清空 `embedding`
- 已有 `embedding`（图文）保留；`textEmbedding` 初始为 NULL，靠 backfill 填充

### 3.3 分析结果 JSON（扩展）

在现有字段基础上扩展 `AiClothingAnalysis`：

```typescript
interface AiClothingAnalysis {
  mainCategory: ClothingMainCategory;
  subCategory: string;
  season: string[];
  material: string[];
  colors: string[];
  tags: string[];           // 保留：风格标签
  description: string;      // 保留：一句话视觉描述（UI / 展示）

  // --- 新增：检索导向 ---
  occasions: string[];      // 2-4 个，如 office, commute, casual, date, athletic
  formality: 'casual' | 'smart-casual' | 'business' | 'formal';
  silhouette: string[];     // 1-3 个，如 oversized, straight-leg, midi
  searchDescription: string; // 2-3 句英文，面向检索：场合+搭配场景+关键词，非纯视觉
}
```

**`searchDescription` 示例（ Wool Coat）：**

> Warm smart-casual to business outerwear for autumn and winter office commute. Layer over knit tops, shirts, and tailored trousers. Classic minimalist wool coat in gray.

**原则：**

- `description` = 给用户 / UI 看（视觉一句话）
- `searchDescription` = 检索主段落，填入 embedding 模板的 `Description:` 槽位
- **已确认（2026-08-31）**：`textEmbedding` 对**整段格式化文本**做 embed（见 §4.1），不是只 embed `searchDescription` 单字段

---

## 4. Embedding 文本模板

### 4.0 已确认：整体 embed（非单字段）

| 决策 | 内容 |
|---|---|
| **text RAG** | 分析字段 → `buildWardrobeDocumentEmbeddingText()` 拼成一段 → **整段** → 1 个 `textEmbedding` |
| **不是** | 仅对 `searchDescription` 做 embed |
| **原因** | 保留 colors / season / tags 等补充信号；与 query 侧同一模板对齐 |
| **visual** | 仍用简化文本 + 图片 → 1 个 `embedding`（图搜图预留） |

### 4.1 Document（入库 → `textEmbedding`）

扩展 `buildWardrobeDocumentEmbeddingText`：

```
Category: {subCategory}.
Description: {searchDescription}.
Visual: {description}.
Colors: {colors}.
Tags: {tags}.
Occasions: {occasions}.
Formality: {formality}.
Silhouette: {silhouette}.
Season: {season}.
Material: {material}.
```

→ 上述整段字符串调用 `generateTextEmbedding()`，写入 `textEmbedding`（**一条单品 = 一个向量**）。

Query 侧 `buildWardrobeQueryEmbeddingText` **继续使用同一模板**，保证 field 对齐。

### 4.2 Query 侧（可选增强）

Doubao 纯文本检索官方建议 query 加指令前缀；vision 模型切 text-only 后建议评估是否加：

```
Represent this wardrobe search query for retrieval: {formattedText}
```

本次可配置开关 `EMBEDDING_QUERY_PREFIX`，默认 off，backfill 后 A/B 对比再开。

### 4.3 Visual（入库 → `embedding`，逻辑不变）

```
input: [{ type: "text", text: docText }, { type: "image_url", url }]
```

- `docText` 可用简化版（`description` + `subCategory` + `colors`），不必含 `searchDescription` 全套
- **不参与** `searchWardrobeItemsByText`

---

## 5. 服务层改动

### 5.1 `server/services/embedding.ts`

```typescript
// 明确拆分
generateTextEmbedding(text: string): Promise<number[]>      // query + text document
generateVisualEmbedding(text: string, imageUrl: string): Promise<number[]>  // multimodal document only
getTextSimilarityThresholds(): EmbeddingSimilarityThresholds  // RAG 用
// visual 阈值未来图搜图再定，本次不接入检索
```

### 5.2 `server/services/wardrobeService.ts`

| 函数 | 改动 |
|---|---|
| `searchWardrobeItemsByText` | `WHERE textEmbedding IS NOT NULL`，cosine 对 `textEmbedding` |
| `clothingItemHasEmbedding` | 拆为 `hasTextEmbedding` / `hasVisualEmbedding` |
| `persistWardrobeItemEmbedding` | 拆为 `persistTextEmbedding` + `persistVisualEmbedding` |
| `findWardrobeItemByImageUrl` | 不变 |

### 5.3 `app/api/wardrobe/route.ts` POST steps

```typescript
interface WardrobeStepStatus {
  analysis: StepState;
  textEmbedding: StepState;    // 原 embedding 步骤拆分
  visualEmbedding: StepState;  // 保留图文向量
}
```

流程：

```
lookup_existing (by imageUrl)
  → analysis（若无 item）
  → persistTextEmbedding（可跳过若已有 textEmbedding）
  → persistVisualEmbedding（可跳过若已有 embedding）
```

任一步失败可单独重试，已成功步骤不重复跑（沿用现有 resumable 设计）。

### 5.4 前端 / task-executors

- `AnalysisStepStatus` 同步为 `analysis | textEmbedding | visualEmbedding`
- 错误文案区分「文本向量失败」vs「图片向量失败」

---

## 6. 分析 Prompt 改动

文件：`app/api/wardrobe/route.ts` 内 `aiPrompt`（后续可抽到 `server/agents/wardrobe/`）

**新增字段说明要点：**

- `occasions`：从图片推断**适合穿着的场合**，不是风格形容词；必须含英文小写
- `formality`：四档枚举
- `silhouette`：版型/轮廓关键词
- `searchDescription`：**禁止**只复述颜色版型；必须包含 occasion + styling context + 可检索关键词

**tags 约束升级：** 3-5 个，必须覆盖 `style` + `function` 两类（如 `minimal`, `layering`），禁止仅 aesthetic（`cute`, `nice`）

---

## 7. Backfill 脚本

### 7.1 `scripts/reindex-wardrobe-text-embeddings.ts`（新增）

- 读 DB 已有分析字段
- **无 `searchDescription` 的旧数据**：用现有字段拼 fallback（`description + tags + subCategory`），标记日志 `[REINDEX_FALLBACK]`
- 写 `textEmbedding`
- 不碰 `embedding`

### 7.2 `scripts/reindex-wardrobe-visual-embeddings.ts`（可选，现有脚本改名）

- 现有 `reindex-wardrobe-embeddings.ts` 职责明确为 **visual only**
- 只写 `embedding` 列

### 7.3 完整重建（推荐顺序）

```bash
# 1. 迁移加列
pnpm db:migrate

# 2. 改 prompt 后，对旧单品重分析（可选但强烈建议）
pnpm reanalyze:wardrobe          # 新增，或手动删 item 重传

# 3. 填 textEmbedding
pnpm reindex:wardrobe-text

# 4. visual 已有则可跳过；缺的可补
pnpm reindex:wardrobe-visual
```

---

## 8. 阈值（text RAG 专用）

基于诊断数据，**仅作用于 `textEmbedding` 检索**：

| Provider | DB search | slotWeak | slotAdequate | gap |
|---|---|---|---|---|
| Doubao text | 0.30 | 0.40 | 0.50 | 0.04 |
| Vertex text | 0.50 | 0.58 | 0.66 | 0.04 |

- `ragMatchQuality.ts` 读 `getTextSimilarityThresholds()`
- `visualEmbedding` 不参与 slot 评估（本次）

改完 text 链路 + 检索导向分析后，用 `scripts/diagnose-embedding-scores.ts` 扩展版回放，**重新标定**（上述值为初值）。

---

## 9. 改动范围

| 文件 | 改动 |
|---|---|
| `server/db/schema.prisma` | 新增 `textEmbedding` |
| `server/db/migrations/...` | ADD COLUMN |
| `server/utils/embeddingText.ts` | 扩展 document/query 模板 |
| `server/services/embedding.ts` | 拆分 text / visual 生成 |
| `server/services/wardrobeService.ts` | 检索改 textEmbedding；双 persist |
| `app/api/wardrobe/route.ts` | 分析 schema + prompt + 三步 steps |
| `lib/task-executors.ts` | steps 类型 |
| `components/wardrobe/image-upload-item.tsx` | 步骤 UI 文案（若展示 embedding 步） |
| `scripts/reindex-wardrobe-text-embeddings.ts` | 新增 |
| `scripts/reindex-wardrobe-embeddings.ts` | 改名为 visual 或注释明确 |
| `tests/unit/embedding/embeddingText.test.ts` | 新字段模板 |
| `tests/unit/rag/ragMatchQuality.test.ts` | 已有 provider 阈值测试保留 |

**不改：**

- `server/agents/rag/search.ts` 主流程（仍调 `searchWardrobeItemsByText`，内部切换列）
- Stylist / Gatekeeper prompts（除非 backfill 后分数仍不够，再单开 PR）
- 图搜图 API（未来 PR，读 `embedding` 列）

---

## 10. 验收标准

### 数据库

- [ ] `ClothingItem.textEmbedding` 列存在，`vector(2048)`
- [ ] 现有 `embedding` 列数据未被 migration 清空
- [ ] 新上传单品：`textEmbedding IS NOT NULL` 且 `embedding IS NOT NULL`

### 单测

- [ ] `buildWardrobeDocumentEmbeddingText` 含 occasions / searchDescription
- [ ] `searchWardrobeItemsByText` mock 查询 `textEmbedding` 列（非 `embedding`）
- [ ] wardrobe POST steps：`analysis` 完成后 `textEmbedding` 失败可重试且跳过 analysis

### 诊断脚本

- [ ] `pnpm diagnose:embedding-scores` 对比 text top1 **高于** 当前 multimodal top1（同 query 同单品，预期 +0.05~0.07 仅模态收益；+检索 schema 后更高）

### 日志 / RAG

- [ ] `log/rag-search.jsonl` 通勤场景 outerwear 槽位 top1 > 0.45（Doubao text，有合适单品时）
- [ ] `mergedResults` 非空（衣橱有对应 category 单品时）
- [ ] `wardrobe_match_summary` 出现 `adequate`（非 100% weak）

### 对话场景（手动）

- [ ] 上传含 Wool Coat / Blazer 的衣橱，发「职场通勤搭配」→ 方案引用衣橱外套（非全 🛍️）
- [ ] 上传完成后断网重试 → 仅补失败的 embedding 步

### 类型检查

- [ ] `pnpm exec tsc --noEmit` 0 errors
- [ ] `pnpm test` 全通过

---

## 11. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 旧数据无 `searchDescription`，text 向量质量差 | backfill fallback + 可选 bulk reanalyze |
| 双 embedding 上传耗时增加 | text / visual 可并行；visual 失败不阻塞 text RAG |
| 两套阈值混淆 | 代码命名 + 日志前缀 `[TEXT_EMBED]` / `[VISUAL_EMBED]` |
| 回滚 | 检索改回读 `embedding`；`textEmbedding` 列可闲置，不删 |

---

## 12. 实施顺序

```
1. schema 迁移 + embeddingText 模板扩展（含单测）
2. embedding.ts / wardrobeService 拆分 text vs visual
3. wardrobe route：分析 prompt 扩展 + 双 step persist
4. RAG 检索切 textEmbedding + 阈值
5. task-executors / 前端 steps
6. backfill 脚本 + 本地 reindex
7. diagnose 回放 → 微调阈值
8. Playwright / 手动对话验收
```

建议 **2 个 PR**：

- **PR1**：schema + text embedding 链路 + RAG 切换 + backfill（核心）
- **PR2**：分析 prompt 扩展 + bulk reanalyze 脚本（质量提升，可并行评估）

---

## 13. 未来：图搜图（不在本次范围）

```
用户上传照片 query
  → generateVisualEmbedding(queryImage)
  → cosine against ClothingItem.embedding
  → 返回 top-K 相似单品
```

API 草案：`POST /api/wardrobe/search-by-image`  
依赖：`embedding` 列已有数据，与 text RAG 完全独立。
