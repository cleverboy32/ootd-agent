# 天气穿衣指引（运行时 Skill）

> 日期：2026-10-14  
> 状态：方案待确认

## 问题 / 目标

**Before**：

- 2026-10-14 重庆晚餐（`gatekeeper-audit` 08:44、08:47）：天气「雾，23℃，东北风≤3级，湿度77%」，Stylist 给出「短袖 + 牛仔短裤」；用户问「冷不冷」，Gatekeeper 自己回答「确实会有点凉」——系统前后矛盾
- 天气对选品的影响只有一条代码规则：`ragSeasonFilter` 按温度分 warm / mild / cold 三档，**只**决定 RAG 放行哪些季节的单品
- 风力、雨雪、湿度没有任何代码使用；Stylist prompt 关于天气只有「严格契合提取的场合和天气温度」「视天气加外套」两句，多少度穿什么、下雨要避开什么全靠模型自由发挥
- 阈值问题已单独修复（warm 下限 22℃ → 26℃，未提交），但即使判为 mild，Stylist 仍没有「23℃ 应备薄外套、不推荐短裤」这类依据

**After**：

1. 穿衣细则写成一份独立的 **Skill 文件**（markdown），作为可维护的领域知识，改规则不改代码
2. 本轮有天气信息时，Stylist 按需加载该 Skill，在检索 query 生成和最终选品两个阶段依据它判断
3. 用户的明确要求（如「就想穿短裤」）优先于 Skill，Stylist 在 reason 中提示取舍

**不改**：

- RAG 季节过滤（三档 `dressingClimate` 保持现状）
- 雨雪按材质硬过滤（依赖 `material` 标签准确度，Skill 稳定后再评估）
- 出门时段 / 夜间温度（需改高德接口为 `extensions: 'all'`，单独立项）
- Copywriter、VisualDirector prompt（它们解释和绘制已选单品，不参与选品）

---

## 设计

### 为什么是运行时 Skill，以及代价

Skill 由模型自行对号入座（判断 23℃ 属于哪档、「≤3级」算不算 4 级风），不在代码里匹配。换来的是规则可读、可由非工程同学维护，并为后续其他穿搭知识（色彩、身材版型）建立统一的加载方式。

代价与对策：

| 代价 | 对策 |
|---|---|
| 档位判断交给模型，可能错档 | Skill 内写明判档步骤和边界归属；prompt 回归覆盖边界温度 |
| 每次多约 600 token（两阶段共两次） | 仅 `intent.weather` 非空时加载；无天气信息不注入 |
| 表格内容可能被模型照抄进 reason | Skill 明确「据此判断，reason 用自己的话说明」 |
| 无法单测规则本身 | 单测只覆盖加载与注入条件；规则效果靠 `test:prompts` |

**兜底**：若 prompt 回归在边界温度上反复不稳，改为代码判档、只注入命中行（Skill 文件格式保持表格，届时可直接解析复用）。

### 文件结构

```
server/skills/
  weather-dressing.md     # Skill 正文（frontmatter: name / description）
  loadSkill.ts            # loadSkill(name): string — 读文件、去 frontmatter、进程内缓存
```

部署说明：当前为 `next start` 全仓部署，运行时 `fs` 读取可用。若以后改 `output: 'standalone'`，需在 `next.config.ts` 加 `outputFileTracingIncludes` 包含 `server/skills/*.md`。

### Skill 正文（`server/skills/weather-dressing.md`）

```markdown
---
name: weather-dressing
description: 根据本轮天气（温度、雨雪、风力、湿度）确定穿衣层次与单品避坑，用于检索 query 和选品
---

# 天气穿衣细则

## 使用步骤
1. 从【今日穿搭意图】的天气文本中读取温度、天气现象、风力、湿度；读不到的项跳过
2. 按温度落入唯一一个档位（边界值按表中区间归属，如 25℃ 属「舒适」，26℃ 属「偏热」）
3. 叠加命中的修正项；风力 ≥6 级时温度档位下调一档
4. 用户明确要求（如指定短裤）优先；与本细则冲突时，在 reason 中提示取舍
5. 据此选择品类和面料；reason 用自己的话说明天气依据，不要照抄本细则

## 温度档位
| 档位 | 温度 | 穿衣层次 |
|---|---|---|
| 炎热 | ≥ 28℃ | 短袖或无袖，短裤短裙可选，轻薄透气；不加外套 |
| 偏热 | 26–27℃ | 短袖为主，短裤可选；室内空调场合可备薄开衫 |
| 舒适 | 22–25℃ | 短袖或薄长袖；下装优先长裤、中长裙，不推荐短裤；建议备薄外套 |
| 微凉 | 18–21℃ | 长袖 + 薄外套（夹克、开衫、衬衫外套）；长裤 |
| 凉 | 13–17℃ | 卫衣或针织 + 风衣、夹克；长裤；不推荐凉鞋 |
| 冷 | 8–12℃ | 毛衣 + 厚外套（大衣、棉服）；保暖鞋履 |
| 寒冷 | ≤ 7℃ | 羽绒或厚大衣，保暖内搭，可加围巾手套 |

## 修正项
| 条件 | 调整 |
|---|---|
| 小雨、阵雨、雷阵雨、中雨 | 鞋避开麂皮、帆布、浅色款；外层优先防水或速干；下装避开拖地长裤和长裙 |
| 大雨、暴雨 | 在上一条基础上：优先防水鞋靴，下装选九分或收口款 |
| 雪、雨夹雪 | 防滑保暖鞋靴；外套按「冷」档及以上 |
| 风力 ≥ 4 级（「≤3级」不算） | 外层优先防风面料；裙装避开轻薄飘逸款 |
| 湿度 ≥ 80% 且 ≥ 26℃ | 速干透气面料，避免厚牛仔等贴身闷热款 |
| 湿度 ≥ 75% 且 ≤ 25℃ | 体感偏凉，外套不要省 |
```

档位边界与 `ragSeasonFilter` 对齐：26℃ 起 warm，12℃ 及以下 cold。

### 注入

`server/agents/stylist/agent.ts` 两处（检索阶段约 178 行，选品阶段约 398 行），在【今日穿搭意图】之后追加：

```ts
const weatherSkill = intent.weather?.trim() ? `\n【穿衣细则 Skill】\n${loadSkill('weather-dressing')}\n` : '';
```

`server/agents/stylist/prompts.ts` 第 27 行「场合与天气契合度」改为：有【穿衣细则 Skill】时按其步骤判断，用户明确要求优先。

---

## 验收标准

### 单测（`tests/unit/skills/loadSkill.test.ts`）

- [ ] `loadSkill('weather-dressing')` 返回非空正文，且不含 frontmatter（无 `---`、无 `name:`）
- [ ] 正文包含「温度档位」「修正项」两节
- [ ] 不存在的 skill 名抛出明确错误
- [ ] 二次调用命中缓存（不重复读盘）

### Prompt 回归（`tests/prompts/stylist.prompt.test.ts`）

- [ ] 天气「雾，23℃，湿度77%」+ 场合「晚餐」，衣橱同时有短裤和长裤 → 方案不选短裤
- [ ] 天气「25℃」与「26℃」各一次，衣橱同时有短裤和长裤 → 25℃ 不选短裤；26℃ 允许短裤（边界判档）
- [ ] 天气「小雨，18℃」，衣橱有麂皮鞋和皮质短靴 → 不选麂皮鞋
- [ ] 用户特殊要求「就想穿短裤」+ 23℃ → 选短裤，reason 提到天气取舍
- [ ] 现有 Stylist 场景全部通过

### 真实对话

- [ ] 傍晚说「去南岸区吃晚饭」→ 方案不出现短裤，包含外套或说明了外套建议；reason 未照抄细则原文

---

## 实施顺序（每步一个 commit）

1. `server/skills/weather-dressing.md` + `loadSkill.ts` + 单测（先写 failing test）
2. Stylist 两处注入 + prompts.ts 规则改写 + prompt 回归 fixture，跑 `pnpm test:prompts`
