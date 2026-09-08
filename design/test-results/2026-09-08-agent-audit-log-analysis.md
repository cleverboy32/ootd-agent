# Agent Audit 日志分析总结

> 日期：2026-09-08  
> 数据源：`log/*.jsonl`（本机开发环境落盘）  
> 时间跨度：约 2026-06-15 → 2026-09-07（各文件起止不完全一致）  
> 目的：整理各 Agent / 请求级日志的结构、健康度与可行动结论；**不替代**单条 `messageId` 联查排障。

---

## 1. 日志清单与职责

| 文件 | 条数 | 体积 | 一句话职责 |
|---|---:|---:|---|
| `request-audit.jsonl` | 14 | 6.5K | **请求级总览**：route / requestType / 阶段耗时 / 成败 / 是否断联 |
| `gatekeeper-audit.jsonl` | 140 | 656K | 意图判定、是否放行、L1、天气决策 |
| `user-profile-audit.jsonl` | 34 | 41K | 画像更新与 L1 |
| `rag-search.jsonl` | 57 | 2.8M | Stylist 触发的衣橱检索（query、命中、相似度） |
| `copywriter-audit.jsonl` | 60 | 136K | 文案全文 + L1 |
| `image-gen-audit.jsonl` | 123 | 21K | 效果图 API 调用成败（不含量化审美） |
| `visual-audit.jsonl` | 116 | 83K | Critic 对成图的 `approved` / 批注 |
| `visual-profile-audit.jsonl` | 2 | 1K | 视觉建档（样本极少，可忽略趋势） |

联查方式（推荐）：

```bash
MSG=cmtr16a5a000lxfs8bqkjva49
jq -c --arg m "$MSG" 'select(.messageId==$m)' \
  log/request-audit.jsonl log/gatekeeper-audit.jsonl \
  log/copywriter-audit.jsonl log/image-gen-audit.jsonl log/visual-audit.jsonl
```

---

## 2. 总览结论（先看这个）

1. **请求级 audit 已可用**（首期样本 14 条）：主路径中位约 **156s**，瓶颈是 **Stylist**；incomplete 约 **26s**（几乎全是 Gate）。
2. **Gate 放行率约 49%** 属预期结构：`clarify` / `outfit_selection` / `outfit_confirmed` 设计上不放行；`wardrobe_pairing` 大量停在「候选确认 / 补场合」。
3. **RAG 检索健康**：相似度中位 **0.65**，几乎全部 ≥0.5；仅 1 次 `totalUniqueItems=0`。
4. **出图 API ≠ 画对**：`image-gen` 成功率 **93%**，但 `visual-audit` 通过率仅 **66%**；**9 月样本更差（约 29%）**，集中在鞋/下装/颜色/缺失。
5. **Copywriter / Profile L1 很稳**（≥98% / 100%）；Gate L1 也高（94%），主要告警是城市臆测、微调未说选套。
6. **质量排障不要只看 `request-audit.summary.imageSuccessCount`**——它只表示上传/生成 API 成功；裤子画丢、光腿等要看 `visual-audit.approved=false`。

---

## 3. Request Audit（请求级）

### 3.1 分布（n=14，偏近期同会话试跑）

| 维度 | 分布 |
|---|---|
| kind | 全 `generate`（尚无 `image_retry` 样本） |
| route | `outfit_main` 8 · `incomplete` 5 · `unknown` 1 |
| requestType | `purchase_pairing` 6 · `feedback_revision` 6 · `outfit_selection` 1 · 缺省 1 |
| outcome | `completed` 13 · `failed` 1 |
| clientCancelled | 全 `false` |

唯一失败：`route=unknown`，错误 `unsupported image format: application/octet-stream`（AVIF → octet-stream，后续已有 LLM 安全格式转换）。

### 3.2 耗时（outfit_main）

| 阶段 | 均值 | 中位 | 备注 |
|---|---:|---:|---|
| Stylist | ~78s | ~67s | **最大头**；峰值 163s（待购皮衣轮） |
| Copywriter | ~43s | ~40s | 与 ImageGen **并行** |
| ImageGen | ~23s | ~21s | |
| Gatekeeper | ~21s | ~17s | incomplete 路径几乎只剩这一项 |
| Profile | ~4s | ~3s | |

墙钟 ≈ `gate + profile + stylist + max(copy, image)`，与并行设计一致（gap ≈ 1s）。

### 3.3 覆盖缺口（设计有、本批未踩到）

- `kind=image_retry` / `route=from_cache|style_advice`
- `clientCancelled=true`（断联后跑完）

---

## 4. Gatekeeper

### 4.1 意图分布（n=140）

| requestType | 条数 | is_complete |
|---|---:|---|
| wardrobe_pairing | 25 | 36% |
| wardrobe_outfit | 25 | 88% |
| clarify | 24 | 0%（设计如此） |
| style_advice | 21 | 81% |
| feedback_revision | 20 | 70% |
| outfit_selection | 10 | 0%（设计如此） |
| purchase_pairing | 9 | 78% |
| outfit_confirmed | 6 | 0%（设计如此） |

整体 `is_complete` ≈ **49%**。

### 4.2 未放行主因（按类型）

- **wardrobe_pairing**：绝大多数是候选卡片确认（`wardrobe_candidates`），少数补场合——**不是模型瞎拦**。
- **feedback_revision 未完成**：统一追问「微调第一套还是第二套」（与 L1 `REVISION_OUTFIT_ID_NOT_STATED` 一致）。
- **purchase_pairing 未完成（早期）**：缺图追问（会话里图片未进 Gate / 上传失败类问题）。

### 4.3 L1

- passed **132 / 140（94%）**，分数中位 100
- Top issues：`CITY_NOT_IN_CONTEXT`（16）、`REVISION_OUTFIT_ID_NOT_STATED`（8）、`FEEDBACK_NOT_COMPLETE`（6）、`WEATHER_LOOKUP_AFTER_USER_STATED`（5）

### 4.4 可行动

1. 微调默认选套 / 单套自动 `outfit_1` 已部分落地，继续压 `REVISION_OUTFIT_ID_NOT_STATED`。
2. 城市与天气：减少「用户未提城市却 weather_lookup」类误伤（已有 city gate，可盯 `CITY_NOT_IN_CONTEXT` 是否下降）。
3. `wardrobe_pairing` 低 complete 率本身正常，看板勿当成「Gate 失败率」。

---

## 5. User Profile

- n=34；几乎都有 previous profile（33/34）
- L1：**100%** pass
- 常填字段：`personal_style`、`visual_features`、`preferences`；身高体重/肤色/体型约六成有值
- 结论：画像链路稳定，不是当前主诉瓶颈

---

## 6. RAG（`rag-search.jsonl`）

### 6.1 基本面

- n=57；source：`stylist-agent` 54 · `stylist-agent-revision` 3
- 意图侧以 `wardrobe_outfit` / `purchase_pairing` / `wardrobe_pairing` 为主
- `totalUniqueItems`：均值 ~15，中位 14；**仅 1 次为 0**
- 每轮 query 数中位 **4**
- 带 `anchorItem`：21/57（pairing / 待购相关）

### 6.2 相似度

| 指标 | 值 |
|---|---|
| 样本点数 | 804（merged 截断统计） |
| 均值 / 中位 | 0.642 / 0.645 |
| 范围 | 0.488 – 0.783 |
| ≥0.5 | 802/804 |

季节过滤：`dressingClimate=mild` 居多；约 28% 条目无 seasonFilter。

### 6.3 零命中个案

`2026-08-31` 职场通勤一轮：queries 正常但 `totalUniqueItems=0`——需对照当时衣橱是否为空 / 过滤过严，属个案。

### 6.4 可行动

- 相似度水位健康，优先优化「检到了但搭错/画错」，而不是盲目降阈值。
- revision 路径 RAG 样本少（3），后续可专门看微调是否检索不足。

---

## 7. Stylist（间接观测）

Stylist **无独立 jsonl**；通过 `request-audit.stages.stylistMs` + `rag-search` + 下游文案/成图反推：

- 主路径耗时最大头（见 §3.2）
- 待购多 `new_item` 时，曾出现「方案有两件新品、Seedream 只吃一张锚点图」→ 下装缺失（已在 sessionItems 附加参考图方向修复，需回归）

---

## 8. Copywriter

- n=60；文案长度中位 **875** 字；`outfitCount` 以 2 套为主（42/60）
- L1：**59/60 pass**；仅见 `MISSING_WARDROBE_TAG` / `UNKNOWN_WARDROBE_ID` 各 1
- 均带 `personalStyle`
- 结论：文案质量与 L1 不是当前主矛盾；与 ImageGen 并行时文案常成为 wall 的较长一腿

---

## 9. Image Gen vs Visual Critic（关键反差）

### 9.1 Image Gen（API）

| 指标 | 值 |
|---|---|
| 成功率 | **115/123 = 93%** |
| mode | multimodal 116 · text-only 7 |
| trigger | initial 108 · user_retry 15 |
| 失败原因 | 429 quota（5）、fetch failed（3） |

### 9.2 Visual Audit（审美/还原）

| 指标 | 值 |
|---|---|
| 全量 approved | **77/116 = 66%** |
| **2026-09 子集** | **6/21 ≈ 29%**（明显变差） |

拒绝原因关键词（可重叠计数）：鞋 29 · 错 12 · 裙 11 · 颜色 10 · 缺失 10 · 长度/配饰 6 …

近期典型：

- 待购裤颜色/材质画错、鞋悬浮贴图
- **下装完全缺失 / 光腿**（多 new_item 缺参考图）
- 皮衣内搭未画出、质感错误

### 9.3 结论

```
imageSuccess = API 成功
approved     = 是否画对方案
```

看板与排障必须拆开。9 月通过率下跌应优先盯：多锚点参考图、下装约束、鞋是否进 refs。

---

## 10. Visual Profile（次要）

仅 2 条（2026-06）：1 次 fetch failed，1 次成功抽出 `skin_tone/body_shape/hair_color`。样本不足，不做趋势判断。

---

## 11. 跨日志对照表（怎么读）

| 你想回答的问题 | 看哪些日志 |
|---|---|
| 这条请求走哪条路、卡多久？ | `request-audit` |
| 为什么没出搭配？ | `request-audit.route=incomplete` + `gatekeeper-audit` |
| 意图是否误判？ | `gatekeeper-audit`（requestType / L1 issues） |
| 衣橱有没有检到？ | `rag-search`（totalUniqueItems / similarity） |
| 图 API 是否成功？ | `image-gen-audit` |
| 图是否画对？ | `visual-audit.approved` |
| 文案有没有乱写衣橱 id？ | `copywriter-audit.l1` |
| 端到端一条线 | 同一 `messageId` 串起以上全部 |

---

## 12. 建议的下一步（按优先级）

1. **效果图还原（P0）**  
   - 继续验证多 `sessionItems` → 多参考图；盯 9 月 `visual-audit` 通过率是否回升。  
   - Critic `approved:false` 是否自动重绘（当前只审计不闭环）。

2. **可观测性（P1）**  
   - `request-audit.summary` 增加可选 `visualApprovedCount` / `visualRejectedCount`（或 digest 脚本联查）。  
   - 定期 digest：按日聚合 route、stylistMs、visual 通过率。

3. **Gate 体验（P2）**  
   - 压低「微调未选套」追问摩擦；城市/天气 L1 告警治理。

4. **Stylist 耗时（P2）**  
   - 对 `stylistMs>120s` 的 messageId 做抽样（RAG query 数、revision、模型重试）。

---

## 13. 数据局限（阅读时注意）

- 开发机日志，**非生产全量**；`request-audit` 仅首期约两周内 14 条，分布偏「同一待购会话试跑」。
- `rag-search` 体积大（含 merged 明细），分析时注意截断与字段演进。
- 历史条目 schema 可能略有漂移（如 seasonFilter 形态）；聚合用防御式解析。
- 本报告生成日：2026-09-08；新日志落入后数字会变，复跑应用同口径脚本更新本节数字。

---

## 附录：复跑聚合口径（简）

```text
Gate complete rate     = is_complete true / n
Visual approve rate    = approved true / n
Image-gen success rate = success true / n
RAG health             = median(similarity), count(totalUniqueItems==0)
Request bottleneck     = median(stages.stylistMs) on route==outfit_main
```
