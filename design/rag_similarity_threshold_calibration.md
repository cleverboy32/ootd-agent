# RAG 相似度阈值校准方案

> 状态：讨论中，待实施。基于 `log/rag-search.jsonl` 真实分布分析，修正 `ragMatchQuality.ts` 中 weak/adequate 分界线的校准偏差。
> 日期：2026-07-08

## 1. 问题（Before）

### 现象

`<wardrobe_match_summary>` 里几乎所有槽位都被标为 `status="weak"`，Stylist 收到的信号几乎恒为「衣橱匹配差」，难以区分「真弱」和「正常可用」。

### 证据（来自 `log/rag-search.jsonl`，40 条 RAG 记录 / 149 个槽位查询）

**top1 相似度分档（当前阈值 0.72 weak / 0.78 adequate）：**

| 分档 | 数量 | 占比 |
|------|------|------|
| no result | 5 | 3.4% |
| top1 < 0.72 (weak) | 131 | 87.9% |
| 0.72 ≤ top1 < 0.78 | 12 | 8.1% |
| top1 ≥ 0.78 (adequate) | 1 | 0.7% |
| **weak + none 合计** | **136** | **91.3%** |

**全部召回结果（645 条）分布：**

```
min 0.51  |  p25 0.61  |  median 0.64  |  p75 0.67  |  max 0.78
```

### 根因

1. **阈值按直觉设定，未按模型实际分数尺度校准**  
   `SLOT_WEAK_SIMILARITY_THRESHOLD = 0.72`、`SLOT_ADEQUATE_SIMILARITY_THRESHOLD = 0.78` 隐含假设「0.8 才算好」。但 `gemini-embedding-001` 在服装文本检索场景下，观测最高分仅 ~0.78，median 仅 0.64。

2. **0.72–0.78 灰区也被标为 weak**  
   `assessSlotMatch` 中，未达 0.78 的槽位最终走 fallback 分支，note 为「相似度中等，请谨慎判断」，status 仍为 `weak`。adequate 几乎不可达。

3. **绝对分数低 ≠ 检索失败**  
   DB 层 `SIMILARITY_THRESHOLD = 0.5`（`wardrobeService.ts`）仍放行 0.51–0.71 的单品；Stylist 在 weak 场景下有时硬选衣橱、有时 `new_item`，行为不稳定。`copywriter-audit` 中约 **62.5%** 方案含 `🛍️` 新品标记。

### 不涉及的问题

- **不是** embedding 模型坏了（0.7 在本系统内已是偏高分）
- **不是** 必须用 ReAct 重试才能修（全量 ReAct 触发率 ~91%，平均延迟 +1s+，不划算）
- 运动场合「分数中等但品类不对」仍需 `isItemAthleticallyAppropriate` 规则，单靠调阈值无法覆盖

---

## 2. 期望行为（After）

1. `wardrobe_match_summary` 的 weak/adequate/none 三档**有区分度**，不再 91% 全是 weak
2. Stylist 能依据 status 稳定决策：adequate → 优先衣橱；weak → 谨慎或 `new_item`；none → 必须 `new_item`
3. 阈值与 `gemini-embedding-001` + 服装文本的实际分数分布对齐
4. 为后续「窄触发 ReAct」预留清晰 gate（仅 none / 极低分触发）

---

## 3. 校准原则

1. **按本模型分布定阈值，不按跨模型直觉**  
   以日志 p25 / median / p75 / max 为锚点，而非 0.8、0.9。

2. **绝对分 + 相对分结合**  
   绝对分判断「是否过线」；top1 与 top2 的 gap 判断「是否一家独大」，避免 0.65 vs 0.64 胶着时误判 adequate。

3. **分层职责不变**  
   - DB 层 `0.5`：最低召回门槛（不改）  
   - Match quality 层：给 Stylist 的「可用性信号」（本次校准）  
   - 场合规则层：运动等品类硬过滤（保留）

---

## 4. 建议阈值（v1 提案）

修改文件：`server/utils/ragMatchQuality.ts`

| 常量 | 当前值 | 建议值 | 依据 |
|------|--------|--------|------|
| `SLOT_WEAK_SIMILARITY_THRESHOLD` | 0.72 | **0.58** | 低于 p25(0.61) 尾部；触发率 ~8.7%（none + top1<0.58） |
| `SLOT_ADEQUATE_SIMILARITY_THRESHOLD` | 0.78 | **0.66** | 接近 p75(0.67)；在本分布下属于「偏上」 |
| `SLOT_CONFIDENCE_GAP`（新增） | — | **0.04** | top1 − top2 ≥ 0.04 时，0.58–0.66 灰区可升为 adequate |

### 判定逻辑（`assessSlotMatch` 伪代码）

```
if results.length === 0 → none

top1, top2 = sorted[0], sorted[1]
gap = top2 ? top1.similarity - top2.similarity : 1.0

if athletic && 品类不适配 → weak（保留现有逻辑）

if top1.similarity < 0.58 → weak（明确不可用）

if top1.similarity >= 0.66 → adequate（本分布下的「好」）

if top1.similarity >= 0.58 && gap >= 0.04 → adequate（相对领先，灰区提升）

else → weak（中等分但胶着，谨慎）
```

### 预估分档占比（基于历史 top1，粗算）

| status | 预估占比 | 说明 |
|--------|----------|------|
| none | ~3% | 无召回 |
| weak | ~15–25% | 真弱：极低分或胶着灰区或运动品类不符 |
| adequate | ~70–80% | 本系统下的正常可用检索 |

> 精确占比需在改完后对 `log/rag-search.jsonl` 回放脚本验证。

### 窄触发 ReAct（后续可选，本次不实施）

仅在以下情况触发第二轮检索（每槽位最多 1 次）：

- `status === 'none'`，或
- `bestSimilarity < 0.58`

预估触发率 **~8.7%**，平均延迟成本 **~100ms**（0.087 × 1.2s），可接受后再做实验。

---

## 5. 改动范围

| 文件 | 改动 |
|------|------|
| `server/utils/ragMatchQuality.ts` | 调整常量；`assessSlotMatch` 加入 gap 逻辑 |
| `tests/unit/rag/ragMatchQuality.test.ts` | 更新阈值相关用例；新增 gap 边界用例 |
| `server/agents/stylist/prompts.ts` | 可选：说明 adequate/weak 含义与分数尺度（避免 Stylist 误以为 0.66 很低） |

**不改：**

- `wardrobeService.ts` 的 `SIMILARITY_THRESHOLD = 0.5`
- 运动场合 `filterResultsForAthleticContext` / `isItemAthleticallyAppropriate`
- RAG 检索次数（本次不做 ReAct）

---

## 6. 验收标准

### 日志指标

- [ ] 对 `log/rag-search.jsonl` 回放后，`weak` 占比从 ~91% 降至 **< 30%**
- [ ] `adequate` 占比 **> 50%**
- [ ] `none` 占比与改前接近（~3–5%）

### 单测（`tests/unit/rag/ragMatchQuality.test.ts`）

- [ ] top1=0.55 → weak
- [ ] top1=0.68 → adequate
- [ ] top1=0.62, top2=0.61（gap 小）→ weak
- [ ] top1=0.62, top2=0.57（gap≥0.04）→ adequate
- [ ] 运动场景 Wrap Shorts 高分仍 → weak（品类规则不退化）

### 对话场景（真实 LLM，改阈值后手动或 prompt test）

- [ ] 「打篮球穿什么」：bottom/shoes 弱运动装备 → weak + Stylist 用 `new_item`（不退化）
- [ ] 「夏天通勤搭配」：有 0.65+ 召回的上衣/下装 → adequate，优先衣橱而非全 `new_item`
- [ ] `copywriter-audit` 中 `🛍️` 新品比例较改前**下降**（目标：从 ~62% 降至 < 45%，需多轮对话采样）

### 类型检查

- [ ] `pnpm exec tsc --noEmit` 0 errors
- [ ] `pnpm test` 全通过（含 `ragMatchQuality.test.ts`）

---

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| adequate 放宽后 Stylist 硬选「沾边但不对」的单品 | 保留运动品类规则；灰区胶着仍标 weak |
| 阈值随衣橱规模/embedding 版本漂移 | 常量集中定义；后续可加月度日志回放脚本 |
| 回滚 | 恢复 `0.72` / `0.78` 两个常量即可 |

---

## 8. 实施顺序

```
1. 写 failing test（新阈值 + gap 逻辑）
2. 改 ragMatchQuality.ts
3. pnpm test + 日志回放脚本验证分档占比
4. 真实对话抽测 3–5 个场景
5. commit（独立 PR，不混入 ReAct / 其他功能）
```

---

## 9. 附录：日志回放脚本（实施时可用）

```bash
# 用改后逻辑回放 rag-search 日志，统计 weak/adequate/none 占比
pnpm exec tsx scripts/replay-rag-match-status.ts
```

实施阶段可新增 `scripts/replay-rag-match-status.ts`，读取 `log/rag-search.jsonl` 的 `perQueryResults`，调用 `assessSlotMatch` 输出分档统计。

---

## 10. 搜索向量优化（2026-07-08，已实施）

### 问题

检索 query 使用 Stylist 原始英文长句直接 `RETRIEVAL_QUERY` 向量化；衣橱单品入库使用固定模板 `Category / Description / Colors / Tags / Season / Material` + 图片 `RETRIEVAL_DOCUMENT`。文本结构不一致会系统性压低相似度、降低排序质量。

### 改动

- 新增 `server/utils/embeddingText.ts`
  - `buildWardrobeDocumentEmbeddingText`：入库与检索共用同一文本模板
  - `buildWardrobeQueryEmbeddingText`：检索前将 query 格式化为 document 风格，并注入 slot / occasion / season 提示
- `searchWardrobeItemsByText` 默认使用格式化文本生成 query 向量
- `performRagSearch` / `wardrobeResolver` 传入 slot、intent 上下文

### 验证

```bash
pnpm exec tsx --test tests/unit/embedding/embeddingText.test.ts
pnpm replay:rag-scores -- --limit=15
```

`replay:rag-scores` 会对比同一批历史 query 的 **raw vs formatted** top1 相似度（需本地 `.env` API key + DB）。

### 后续若仍不够

- 对已有衣橱批量重算 embedding（文本-only document 向量，与 query 模态更一致）
- 或双向量索引（图文入库向量 + 纯文本检索向量）
