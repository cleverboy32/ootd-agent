# OOTD-Agent 多智能体 (Multi-Agent) 协同架构设计文档

本篇文档详细记录了 OOTD-Agent 从单体 AI 架构向**多智能体 (Multi-Agent) 协同架构**演进的设计方案。通过将复杂的穿搭推荐流程拆分为 5 个高度专业化的 Agent，我们能够彻底解决 Prompt 臃肿、指令漂移、格式不稳定等问题，并大幅提升系统的响应速度与搭配精准度。

特别地，我们在图像生成环节引入了行业领先的 **“视觉导演智能体 (Visual Director Agent)”**，通过“生成-多模态审核-自我纠错”闭环，彻底解决 AI 绘图货不对板的顽疾。

---

## 1. 架构演进背景与动机

在原有的单体架构中，单个 `gemini-2.5-pro` 模型承担了过多且相互冲突的角色：

*   **把关人 (Gatekeeper)**：前置拦截并追问缺失信息。

*   **搭配师 (Stylist)**：进行专业的色彩、材质、版型搭配。

*   **文案策划 (Copywriter)**：根据用户喜好润色语气。

*   **提示词专家 (Prompt Engineer)**：为绘图模型扩写英文 Prompt。

### ⚠️ 单体架构的痛点：

1.  **指令漂移 (Instruction Drift)**：当 Prompt 过于庞大时，模型容易“顾此失彼”。例如，专注于语气润色时，经常忘记输出 `[衣橱物品:id=xxx]` 标签，或者忘记调用画图工具。

2.  **首字延迟高 (Time to First Token)**`gemini-2.5-pro` 拥有极强的推理能力，但生成速度较慢。让它流式输出数百字的口语化文案，会导致用户等待时间过长。

3.  **多模态视觉干扰**：当用户上传真人照片时，模型需要同时分析“人（肤色/身材）”和“衣服（款式/色彩）”，这容易导致视觉注意力分散，无法给出最精准的个性化建议。

4.  **绘图失控（货不对板）**：传统的绘图只是一个死板的 API 工具调用。绘图模型经常画错衣服颜色、漏掉关键单品，且系统无法自我发现和纠正。

---

## 2. 5-Agent 角色定义与职责划分

为了实现极致的专业化分工，我们将系统拆分为以下 5 个协同工作的 Agent：

```mermaid

flowchart TD

    %% 样式定义 (采用空格分隔，100% 兼容所有渲染器)

    classDef agent fill:#D6E4FF stroke:#5B8FF9 stroke-width:2px

    classDef user fill:#FFD2FC stroke:#FF7EE2 stroke-width:1px

    classDef tool fill:#D3F9D8 stroke:#2F9E44 stroke-width:1px

    classDef data fill:#FFF1B8 stroke:#D4B106 stroke-width:1px

    User([用户输入 + 真人照片]) --> Gatekeeper{1. Gatekeeper Agent<br>路由与把关}

    History[(历史会话上下文)] -.->|多轮对话记忆| Gatekeeper

    History -.->|多轮对话记忆| UserAnalyzer

    History -.->|多轮对话记忆| Stylist

    

    %% 分支 A：信息不全

    Gatekeeper -->|信息不全| AskUser[主动追问用户] --> User

    

    %% 分支 B：信息完整，启动用户分析

    Gatekeeper -->|信息完整: 结构化意图| UserAnalyzer[2. User Profile Agent<br>用户画像与视觉分析]   

    %% 用户分析 Agent 结合静态数据与照片

    StaticProfile[(ClientProfile 数据库)] <-->|读取旧档案 & 持久化新档案| UserAnalyzer

    UserAnalyzer -->|输出: 今日用户时尚档案 JSON| Stylist[3. Stylist Agent<br>衣橱搭配专家]    

    %% RAG 注入搭配师

    RAG[(衣橱向量数据库)] -.->|RAG 检索 XML| Stylist

    

    %% 搭配师输出结构化方案 (支持 1-2 套方案)

    Stylist -->|输出: 结构化穿搭方案数组| Split{Orchestrator 分发}    

    %% 并行双轨执行！

    subgraph 并行双轨执行 (Parallel Execution)

        Split -->|分发方案数组| Copywriter[4. Copywriter Agent<br>时尚文案润色]

        Split -->|并行分发方案 1| VisualDirector1[5. Visual Director Agent 1]

        Split -->|并行分发方案 2| VisualDirector2[5. Visual Director Agent 2]

    end

    

    %% 文案流式输出

    Copywriter -->|流式生成| TextStream[发送 text_chunk] --> FE[前端打字机渲染]    

    

    %% 视觉导演 1 闭环输出

    VisualDirector1 -->|导演构思 1| FlashImage1[Gemini-2.5-Flash-Image]

    FlashImage1 -->|Base64| Critic1{视觉审核 1 Pro}

    Critic1 -->|审核通过| UploadGCS1[上传 GCS]

    UploadGCS1 -->|发送 image_generated id=outfit_1| FE

    %% 视觉导演 2 闭环输出

    VisualDirector2 -->|导演构思 2| FlashImage2[Gemini-2.5-Flash-Image]

    FlashImage2 -->|Base64| Critic2{视觉审核 2 Pro}

    Critic2 -->|审核通过| UploadGCS2[上传 GCS]

    UploadGCS2 -->|发送 image_generated id=outfit_2| FE

    class Gatekeeper,UserAnalyzer,Stylist,Copywriter,VisualDirector1,VisualDirector2 agent

    class User,FE user

    class FlashImage1,FlashImage2,UploadGCS1,UploadGCS2 tool

    class RAG,Split,AskUser,StaticProfile,Critic1,Critic2,History data

```

### 2.1 Gatekeeper Agent (路由与把关智能体)

*   **推荐模型**`gemini-2.5-flash` (高响应速度，低成本)

*   **联网搜索 (Google Search Grounding)**：**开启**

*   **核心职责**：

       *结合**历史会话上下文**与用户当前输入，评估关键穿搭要素（天气、场合）是否完整。

    *   **自动联网搜索**：若用户提到城市（如“我在上海”）但未提天气，自动联网搜索当地天气温度，判定为信息齐全。

    *   若信息不完整，直接输出追问话术，拦截后续流程；若完整，输出结构化意图 JSON。

### 2.2 User Profile Agent (用户画像与视觉分析智能体)

*   **推荐模型**`gemini-2.5-pro` (强多模态视觉分析能力)

*   **核心职责**：

    *   **文本提取**：从聊天历史和当前输入中，自动提取用户的姓名、身高、体重、风格偏好。

    *   **视觉分析**：若用户上传了真人照片，识别用户的肤色（冷/暖色调）、发色、大致身材比例。

    *   **持久化闭环**：将新提取/分析出的特征与数据库中已有的旧档案进行**智能合并**，并**持久化写回数据库 `ClientProfile.profileData`**，同时输出给搭配师。

### 2.3 Stylist Agent (衣橱搭配智能体)

*   **推荐模型**`gemini-2.5-pro` (极强的逻辑推理与时尚知识库)

*   **核心职责**：

       *结合* *今日用户时尚档案**、**结构化意图**、**历史会话上下文** 以及 **RAG 检索出的衣橱 XML 列表**。

    *   **多轮对话理解**：若历史中已有上一轮推荐，自动转为“反馈微调模式”（如用户说“换成裤装”），在上一轮方案基础上进行修改。

    *   **多套方案输出**：默认输出 **1 到 2 套** 不同的结构化穿搭方案（包含选用的衣橱单品 ID、搭配理由和英文视觉构想）。

### 2.4 Copywriter Agent (时尚文案润色智能体)

*   **推荐模型**`gemini-2.5-flash` (极速流式文本生成)

*   **核心职责**：

    *   将搭配师给出的 1 到 2 套硬核方案，翻译成温暖、亲切、排版优雅的聊天话术。

    *   **严格的标签注入**：确保将搭配师指定的衣橱 ID 精准嵌入为 `[衣橱物品:id=xxx]` 标签，新品标记为 🛍️。

    *   **占位符注入**：在每套方案的结尾，精准注入对应的效果图占位符 `[IMAGE=outfit_1][IMAGE=outfit_2]`。

### 2.5 Visual Director Agent (视觉导演智能体)

*   **推荐模型**`gemini-2.5-flash` (写 Prompt) + `gemini-2.5-pro` (多模态审核)

*   **核心职责**：

    *   **并行双路闭环**：编排器会为每套方案并行启动一个独立的视觉导演闭环。

    *   **导演构思**：将方案转化为极其专业、细节丰富的英文图像生成提示词。

    *   **监视器审核与自我纠错**：调用 Pro 模型睁眼看图，对照方案进行审核（单品完整度、色彩一致性）。若不通过，自动修正 Prompt 并重画（最多 2 次）。

    *   **精准渲染**：成功后发送携带对应方案 `id` 的事件，前端通过 `id` 精准替换对应的 `[IMAGE=方案ID]` 占位符。

---

## 3. Agent 间数据契约 (JSON Schemas)

### 3.1 Gatekeeper Agent 输出 Schema

```json

{

  "is_complete": true,

  "extracted_intent": {

    "weather": "北京今日多云，5~12℃",

    "occasion": "乒乓球运动",

    "style_preference": "活力、运动风",

    "special_requests": "需要防风保暖"

  },

  "followup_questions": []

}

```

### 3.2 User Profile Agent 输出 Schema (今日用户时尚档案)

```json

{

  "name": "小美",

  "height": "168cm",

  "weight": "52kg",

  "preferences": ["极简风", "法式复古"],

  "skin_tone": "cool_winter (冷冬皮，适合高饱和度冷色调)",

  "body_shape": "pear_shape (梨形身材，建议高腰线、A字裙)",

  "personal_style": "法式松弛感运动风",

  "visual_features": {

    "hair_color": "dark_brown",

    "detected_features": "微卷长发，比例匀称"

  }

}



### 3.3 Stylist Agent 输出 Schema (结构化穿搭方案数组)

```json

{

  "outfits": [

    {

      "id": "outfit_1",

      "overall_concept": "粉色活力运动风，兼顾防风与排汗",

      "selected_items": [

        {

          "id": "cmpqph0ri000enys8wty6wvvx",

          "name": "Fitted Athletic Top",

          "layer": "inner_top",

          "reason": "修身排汗，淡粉色完美衬托冷冬皮，且适合乒乓球运动"

        },

        {

          "id": "new_item",

          "name": "灰色运动短裤",

          "layer": "bottom",

          "reason": "高弹舒适，灰色与粉色搭配极具高级感"

        }

      ],

      "visual_composition": {

        "model_pose": "A young woman holding a table tennis racket, smiling warmly",

        "outfit_details": "Wearing a fitted light pink athletic top, paired with dark grey sports shorts",

        "background": "An indoor modern table tennis court with soft lighting"

      }

    }

  ]

}

```

### 3.4 Visual Director Agent 审核反馈 Schema (Critic Output)

```json

{

  "approved": false,

  "critique_reason": "The generated image has white shorts instead of the requested dark grey sports shorts.",

  "revised_prompt_enhancement": "CRITICAL: The model MUST wear dark grey sports shorts. Do NOT use white shorts. Emphasize dark charcoal grey athletic shorts."

}

```

---

## 4. 工业级优雅降级与容错机制 (Fault Tolerance)

为了确保系统在高并发、API 频控（429）或网络抖动下的绝对稳定性，我们设计了**“核心链路死守，辅助链路降级”**的容错策略：

1.  **Gatekeeper 失败 ➔ 保底放行**：

    *   若把关人超时或报错，默认判定为“信息齐全”，直接将原始输入传给下一个 Agent，流程不中断。

2.  **User Profile 失败 ➔ 静态画像保底**：

    *   若画像分析失败，直接跳过照片分析，仅使用数据库里已有的静态身高体重数据传给搭配师。

3.  **Stylist 失败 ➔ 灾难性报错**：

    *   因为它是决策核心，没有它就没有方案。系统会捕获异常，向用户发送友好的报错文案（“搭配师正在寻找灵感，请稍后再试~”），并将消息状态设为 `failed`。

4.  **Copywriter 失败 ➔ 模板化保底**：

       *若文案师流式输出失败，编排器会自动将搭配师的 JSON 方案转化为一个干净的**预设 Markdown 模板**输出给用户。

5.  **Visual Director 失败 ➔ 安全退级**：

       *若画图或审核在重试 2 次后依然失败，编排器会自动将* `[IMAGE=outfit_1]` *替换为* `(❌ 效果图生成失败)`*，不影响用户阅读文字。

---

## 5. 极致性能优化：Stylist 缓存重试机制

在多智能体架构下，用户点击“重试（Retry）”时，编排器会进行极度智能的差异化处理：

### 5.1 场景 A：流式中断的“断点续传”（Stylist 缓存）

*   **触发条件**：搭配师（Stylist）已经成功输出了完美的 JSON 方案，但文案师（Copywriter）在流式输出到一半时中断了。

*   **优化逻辑**：

    1.  搭配师成功输出 JSON 后，编排器会立刻将该 JSON 作为 `metadata` 保存到数据库的 Message 记录中。

    2.  用户点击重试时，编排器检测到已有缓存，**直接跳过 Gatekeeper、User Profile 和 Stylist（不调用任何 Pro 模型，节省 90% 成本）**！

    3.  直接把缓存的 JSON 喂给文案师和视觉导演，重新开始流式输出和画图。

    4.  **体验**：打字机在 100ms 内瞬间开始吐字，体验极度流畅。

### 场景 B：灾难性失败的“重新生成”

*   **触发条件**：上一轮运行中，搭配师报错或 API 彻底断开，无缓存。

*   **优化逻辑**：

    1.  **历史净化**：编排器自动检测并剔除上一次失败的、不完整的 `model` 消息，防止 AI 产生指令漂移或复读。

    2.  重新跑通 `1 ➔ 2 ➔ 3 ➔ [4, 5]` 完整流程。