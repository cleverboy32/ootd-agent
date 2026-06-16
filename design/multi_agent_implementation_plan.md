"# OOTD-Agent 多智能体落地实施与进度追踪计划

本篇文档用于记录 OOTD-Agent 多智能体协同架构的开发进度。我们将任务拆分为具体的、可执行的步骤，方便一步步推进和勾选。

## 📊 总体进度看板

| 任务编号 | 任务名称 | 核心内容 | 状态 | 负责人 |
| :--- | :--- | :--- | :--- | :--- |
| **Task 1** | **Gatekeeper Agent 落地** | 编写把关人代码，配置 Google Search 联网搜索与严格 JSON Schema | ✅ 已完成 | AI Assistant |
| **Task 2** | **User Profile Agent 落地** | 编写画像分析代码，实现文本提取、多模态视觉与数据库持久化 | 🔄 进行中 | AI Assistant |
| **Task 3** | **Stylist Agent 落地** | 编写搭配师代码，实现衣橱优先、多套方案输出与多轮对话微调 | ⏳ 待开始 | AI Assistant |
| **Task 4** | **Copywriter Agent 落地** | 编写文案师代码，实现语气定制、严格标签注入与极速流式输出 | ⏳ 待开始 | AI Assistant |
| **Task 5** | **Visual Director 闭环落地** | 编写视觉导演代码，实现写 Prompt、绘图、多模态审核与自我纠错 | ⏳ 待开始 | AI Assistant |
| **Task 6** | **Orchestrator 编排与重试** | 重构 `stream-handler.ts`，实现全链路编排、缓存重试与优雅降级 | ⏳ 待开始 | AI Assistant |
| **Task 7** | **Overall Acceptance Testing** | 整体验收：全链路联调与边界测试 | ⏳ 待开始 | AI Assistant |

---

## 📝 详细执行步骤

### Task 1: Gatekeeper Agent 落地
- [x] 创建 `app/api/generate-with-image/handlers/gatekeeperAgent.ts`
- [x] 编写 Gatekeeper System Prompt
- [x] 配置 `gemini-2.5-flash` 模型与 `googleSearch` 联网工具
- [x] 配置 `responseSchema` 强制输出结构化 JSON
- [x] 导出 `callGatekeeperAgent` 函数供编排器调用

### Task 2: User Profile Agent 落地
- [x] 创建 `app/api/generate-with-image/handlers/userProfileAgent.ts`
- [x] 编写 User Profile System Prompt
- [x] 配置 `gemini-2.5-pro` 模型与 `responseSchema` 结构化输出
- [x] 实现文本提取与多模态照片分析逻辑
- [ ] 实现与数据库 `ClientProfile.profileData` 的智能合并与持久化写入
- [x] 导出 `callUserProfileAgent` 函数

### Task 3: Stylist Agent 落地
- [x] 创建 `app/api/generate-with-image/handlers/stylistAgent.ts`
- [x] 编写 Stylist System Prompt
- [x] 配置 `gemini-2.5-pro` 模型与 `responseSchema` 结构化输出（支持 1-2 套方案数组）
- [ ] 实现 RAG 衣橱 XML 注入与“衣橱优先”搭配逻辑
- [ ] 实现多轮对话下的“反馈微调模式”
- [ ] 导出 `callStylistAgent` 函数

### Task 4: Copywriter Agent 落地
- [ ] 创建 `app/api/generate-with-image/handlers/copywriterAgent.ts`
- [ ] 编写 Copywriter System Prompt
- [ ] 配置 `gemini-2.5-flash` 模型，启用纯文本流式输出 (Plain Text Streaming)
- [ ] 实现根据用户偏好动态切换语气
- [ ] 实现严格的 `[衣橱物品:id=xxx]` 标签与 🛍️ 新品标记注入
- [ ] 实现 `[IMAGE=outfit_x]` 占位符注入
- [ ] 导出 `callCopywriterAgentStream` 函数

### Task 5: Visual Director 闭环落地
- [ ] 创建 `server/services/visualDirectorService.ts`
- [ ] 编写导演 Prompt (Prompt Generator) 与监视器审核 Prompt (Critic Agent)
- [ ] 实现 `gemini-2.5-flash-image` 绘图调用
- [ ] 实现 `gemini-2.5-pro` 多模态审核与自我纠错闭环（最多重试 2 次）
- [ ] 实现多套方案的并行启动与 GCS 上传
- [ ] 导出 `callVisualDirectorAgent` 函数

### Task 6: Orchestrator 编排与重试
- [ ] 重构 `app/api/generate-with-image/stream-handler.ts`
- [ ] 实现 1 ➔ 2 ➔ 3 串行流转，4 & 5 并行流转的编排逻辑
- [ ] 实现 Stylist 方案的数据库缓存（保存至 Message metadata）
- [ ] 实现断点续传重试（跳过前置 Agent，直接使用缓存 JSON 启动文案与画图）
- [ ] 实现全链路优雅降级与容错处理

### Task 7: Overall Acceptance Testing (整体验收与联调)
- [ ] **多轮对话记忆测试**：验证把关人能记住前几轮的天气，搭配师能根据反馈（如“换成裤装”）进行精准微调。
- [ ] **多套方案并行测试**：验证文案师能流式输出 2 套方案，且视觉导演能并行生成 2 张效果图，无额外延迟。
- [ ] **数据库持久化测试**：验证 User Profile 分析出的肤色、身材、发色等特征成功写入 `ClientProfile.profileData`。
- [ ] **断点续传重试测试**：模拟文案输出中断，点击重试后，验证系统能瞬间跳过前置 Agent，直接开始吐字和画图。
- [ ] **优雅降级测试**：模拟非核心 Agent（如文案、画图）报错，验证系统能自动降级保底，不崩溃且能完成对话。
- [ ] **RAG 极端边界测试**：验证当用户衣橱为空时，系统能完美转为“全新品推荐模式”，不报错。
- [ ] **安全拦截（Safety Block）测试**：验证当绘图触发安全政策时，系统能优雅捕获并降级，不卡死。
- [ ] **前端标签解析与交互测试**：验证 `[衣橱物品:id=xxx]` 成功渲染为可交互卡片，且失效 ID 能优雅降级。
- [ ] **超长上下文摘要测试**：验证超长对话下，Summary 机制能正常压缩历史，Agent 依然聪明。
- [ ] **连接中断（Abort）测试**：验证用户刷新或关闭网页时，后端能立刻停止所有后台 API 调用，节省成本。"