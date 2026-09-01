# OOTD-Agent E2E 验收测试方案

> 状态：执行中  
> 日期：2026-08-31  
> 自动化：`pnpm test:e2e`（Playwright）  
> 结果输出：`design/test-results/2026-08-31-e2e-acceptance-results.md`

---

## 1. 目标

在 **MainCategory 对齐 + 双向量 RAG** 落地后，对现有功能做可重复验收。本方案区分：

| 类型 | 说明 | 执行方式 |
|---|---|---|
| **E2E Mock** | UI 交互 + API mock（快速回归 UI 逻辑） | `pnpm test:e2e` |
| **E2E Live** | **真实 UI 走查**：dev server + DB + ACCESS + LLM | `pnpm test:e2e:live` |
| **脚本验收** | RAG 分数 / embedding | `pnpm replay:rag-scores` 等 |
| **人工冒烟** | 上传 pipeline、效果图质量 | 发版前 checklist |

---

## 2. 测试分层

```
L0  tsc + lint          → pnpm lint
L1  单元测试             → pnpm test
L2  Prompt 回归          → pnpm test:prompts
L3  RAG 脚本             → pnpm replay:rag-scores
L4a E2E Mock         → pnpm test:e2e
L4b E2E Live（真实UI）→ pnpm test:e2e:live
L5  人工真实链路         → §6 checklist
```

---

## 3. E2E Mock 用例矩阵（`pnpm test:e2e`）

> API 使用 page.route mock，验证 UI 逻辑与交互，不依赖真实 DB/LLM。

### A. 访问控制（Access）

| ID | 场景 | 期望 |  spec |
|---|---|---|---|
| ACC-A1 | browse 模式加载 | 显示「浏览模式」横幅；输入框 placeholder 为「浏览模式下不可发送消息」 | `acceptance/access-control.spec.ts` |
| ACC-A2 | browse 模式快捷卡片 | 不显示商务/休闲等 FeatureCard；显示浏览提示文案 | 同上 |
| ACC-A3 | 正确访问码 verify | 解锁后显示「退出完整模式」；输入框恢复可发送 | 同上 |
| ACC-A4 | 错误访问码 | 显示验证失败错误 | 同上 |
| ACC-A5 | logout | 回到 browse 模式 | 同上 |

### B. 导航 & 布局

| ID | 场景 | 期望 | spec |
|---|---|---|---|
| ACC-N1 | 侧边栏：AI 搭配 | `/` 可访问，标题可见 | `acceptance/navigation.spec.ts` |
| ACC-N2 | 侧边栏：衣橱总览 | `/wardrobe` 加载 | 同上 |
| ACC-N3 | 侧边栏：我的档案 | `/profile` 加载 | 同上 |
| ACC-N4 | browse 隐藏「添加衣物」 | 导航无「添加衣物」入口 | 同上 |
| ACC-N5 | verified 显示「添加衣物」 | verified mock 下有添加入口 | 同上 |

### C. 衣橱（Wardrobe UI）

| ID | 场景 | 期望 | spec |
|---|---|---|---|
| ACC-W1 | 列表加载 | 显示 mock 单品 subCategory | `acceptance/wardrobe-display.spec.ts` |
| ACC-W2 | 分类 Tab | 「下装」Tab 只显示 BOTTOM 类 | 同上 |
| ACC-W3 | browse 只读 | 无「批量管理」按钮 | 同上 |
| ACC-W4 | verified 可管理 | 有「批量管理」按钮 | 同上 |

### D. 对话 & 流式（Chat）

| ID | 场景 | 期望 | spec |
|---|---|---|---|
| ACC-C1 | verified 发送 mock SSE | 用户消息 + AI 回复可见 | `acceptance/chat-verified.spec.ts` |
| ACC-C2 | 发送失败 + 重试 | 显示失败提示，重试成功 | `chat-network-error.spec.ts` |
| ACC-C3 | 流中途 error + 重试 | 部分文案 + 失败态 + 重试成功 | `chat-network-error.spec.ts` |

### E. 档案（Profile）

| ID | 场景 | 期望 | spec |
|---|---|---|---|
| ACC-P1 | Profile 页加载 | mock 档案姓名/风格可见 | `acceptance/profile-display.spec.ts` |

---

## 4. 真实 UI 走查（`pnpm test:e2e:live`）

> **无 API mock**。Playwright 打开真实页面，走真实 `/api/*`、Neon、ACCESS_CODE、LLM。

| ID | 场景 | 期望 | spec |
|---|---|---|---|
| LIVE-U1 ~ U4 | 首页 / 衣橱 / 档案 / 导航 | 真实 API 数据可见 | `acceptance-live/full-ui-acceptance.spec.ts` |
| LIVE-A1 ~ A2 | 真实 verify / logout | ACCESS_CODE 解锁 | 同上 |
| LIVE-C1 | 真实对话 | 「有没有白裙子」→ AI 文案 | 同上 |

结果：`design/test-results/2026-08-31-ui-live-acceptance-results.md`

---

## 5. Mock 策略（仅 test:e2e）

E2E **不依赖**真实 LLM / Neon / COS，通过 `page.route` mock：

| API | Mock 内容 |
|---|---|
| `/api/access/status` | browse / verified |
| `/api/access/verify` | 200 / 401 |
| `/api/access/logout` | 200 |
| `/api/conversations**` | 空列表 / 创建会话 |
| `/api/wardrobe` | 固定 TOP + BOTTOM 样本 |
| `/api/clients/:id` | 固定 profile |
| `/api/generate-with-image` | SSE 成功 / 失败 / 中途 error |

---

## 6. 执行命令

```bash
# Mock：快速 UI 逻辑回归（18 用例）
pnpm test:e2e

# Live：真实 UI 走查（7 用例，含 LLM，约 2–3 分钟）
pnpm test:e2e:live

# 全部
pnpm test:e2e:all

# Mock 结果
cat design/test-results/2026-08-31-e2e-mock-acceptance-results.md

# Live 结果
cat design/test-results/2026-08-31-ui-live-acceptance-results.md
```

---

## 7. 人工验收 Checklist（Live 仍不覆盖）

发版前人工勾选：

### 访问控制
- [ ] 真实 ACCESS_CODE verify / logout 流程
- [ ] browse 模式 API 层拒绝 mutating 请求（非仅 UI 禁用）

### 衣橱上传
- [ ] 上传 1 张图 → AI 分析成功
- [ ] DB：`searchDescription`、`textEmbedding`、`embedding` 非空
- [ ] 删除后 RAG 不再命中

### 对话链路（真实 LLM）
- [ ] 「帮我搭配日常通勤」→ 5 slot RAG + 文案 + 效果图
- [ ] 「有没有白裙子」→ wardrobe_pairing
- [ ] 「裙子呢」（多轮）→ 不 clarify 死循环

### RAG 分数（脚本）
- [ ] `pnpm replay:rag-scores` avg top1 ≥ 0.55
- [ ] commute 5 slot top1 ≥ 0.50

### 日志
- [ ] `log/gatekeeper-audit.jsonl` 无异常
- [ ] `log/rag-search.jsonl` slot 命中合理
- [ ] `log/visual-audit.jsonl` 无连续 approved:false

---

## 8. 验收标准

- [ ] `pnpm test:e2e` Mock 18 用例全绿
- [ ] `pnpm test:e2e:live` Live 7 用例全绿
- [ ] 两份结果 Markdown 已生成

| 优先级 | 内容 |
|---|---|
| P1 | `replay:rag-scores` CI 阈值 exit code |
| P1 | 真实 DB 集成测 `/api/wardrobe` POST |
| P2 | Visual/Critic prompt 回归 |
| P2 | 上传流程 E2E（mock COS + mock embedding） |
