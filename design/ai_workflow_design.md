# OOTD-Agent AI 核心工作流设计文档 (AI Workflow Design)

本篇文档详细记录了 OOTD-Agent 的 AI 核心工作流。该工作流采用了**主文本流与后台异步画图任务分离、RAG 增强检索、多模态画图保底退级、以及流式响应优雅结算**的现代化架构设计，确保了极佳的用户体验与系统稳定性。

---

## 1. 核心架构概述

OOTD-Agent 的 AI 交互采用 **Server-Sent Events (SSE)** 流式输出。为了解决“画图耗时久导致用户干等”的问题，系统采用了**双轨并行架构**：
1. **主轨 (Main Track)**：负责 Gemini-2.5-Pro 文本流式生成。AI 边想边吐字，前台打字机实时渲染。
2. **副轨 (Background Track)**：当 AI 决定画图时，主轨立即向前端发送图片占位符，并将画图任务以 `Promise` 形式推入后台异步执行。主轨继续生成文本，不作任何等待。
3. **优雅结算 (Graceful Settlement)**：在文本流彻底结束后的 `finally` 块中，系统会挂起并等待所有后台画图任务完成，清洗未成功生成的占位符，更新数据库，最后安全关闭连接。

---

## 2. AI 工作流流程图 (Flowchart)

以下是 OOTD-Agent 完整的端到端工作流图：

```mermaid
flowchart TD
    %% 样式定义
    classDef startEnd fill:#f9f,stroke:#333,stroke-width:2px;
    classDef process fill:#bbf,stroke:#333,stroke-width:1px;
    classDef decision fill:#ff9,stroke:#333,stroke-width:1px;
    classDef async fill:#dfd,stroke:#333,stroke-width:1px;
    classDef error fill:#fbb,stroke:#333,stroke-width:1px;

    %% 1. 请求接收与上下文构建
    Start([用户发送消息 / 重试]) --> Route[POST /api/generate-with-image]
    Route --> Stream[createOotdStream 创建 ReadableStream]
    
    subgraph 上下文构建与 RAG 检索
        Stream --> Context[buildContext: 加载历史会话]
        Stream --> RAG{是否提供 ClientId?}
        RAG -->|是| RagSearch[performRagSearch: 向量检索衣橱物品]
        RagSearch --> RagInject[将相关衣橱 XML 注入 User 消息]
        RAG -->|否| SkipRag[跳过 RAG]
        RagInject --> RetryCheck{是否为重试消息?}
        SkipRag --> RetryCheck
        
        RetryCheck -->|是| ExtractPartial[提取上次中断内容, 注入续写 Prompt]
        RetryCheck -->|否| CreatePlaceholder[Prisma: 创建 assistant 占位消息, 状态为 generating]
    end

    %% 2. 主模型交互与流式输出
    CreatePlaceholder --> LoadPersonal[loadPersonalization: 加载个性化配置]
    ExtractPartial --> LoadPersonal
    LoadPersonal --> ProcessAI[processAiInteraction: 启动 Gemini-2.5-Pro 文本流]

    subgraph 主轨: 文本流式生成
        ProcessAI --> StreamChunk{解析 Chunk 包含什么?}
        StreamChunk -->|文本内容| SendText[sendEvent: text_chunk]
        SendText --> Accumulate[累加文本到 accumulatedContent]
        
        StreamChunk -->|工具调用 image_generator| GenId[生成唯一 imageId]
        GenId --> SendPlaceholder[sendEvent: image_placeholder]
        SendPlaceholder --> InjectTag["在文本流中注入占位符 [IMAGE=imageId]"]
        InjectTag --> TriggerBg[启动后台异步画图任务]
        TriggerBg --> PushTask[将 Promise 推入 pendingImageTasks 数组]
        PushTask --> ToolResponse[向 AI 返回 OK, image generation initiated]
        ToolResponse --> StreamChunk
    end

    %% 3. 后台异步画图任务
    subgraph BgTrack ["副轨: 后台异步画图 (generateImage)"]
        TriggerBg -.-> CheckContext{是否包含衣橱上下文图片?}
        
        %% 多模态分支
        CheckContext -->|有衣橱图片| MultiModal[尝试多模态画图: gemini-2.5-flash-image]
        MultiModal --> MultiSuccess{生成成功且含 inlineData?}
        MultiSuccess -->|"否 (429/安全审查)"| FallbackText[启动纯文本画图保底机制]
        MultiSuccess -->|是| UploadGCS[上传图片至 Google Cloud Storage]
        
        %% 纯文本分支
        CheckContext -->|无衣橱图片| FallbackText
        FallbackText --> TextSuccess{生成成功且含 inlineData?}
        TextSuccess -->|是| UploadGCS
        TextSuccess -->|"否 (彻底失败)"| CatchError[捕获异常, 发送 image_generation_failed 事件]
        
        UploadGCS --> SendImageEvent[sendEvent: image_generated]
        SendImageEvent --> MapImage[将 imageId 与 GCS URL 映射存入 imageMap]
    end

    %% 4. 流式响应优雅结算
    StreamChunk -->|文本流结束| Finally[进入 finally 块]
    CatchError -.-> Finally
    MapImage -.-> Finally

    subgraph 优雅结算与清理
        Finally --> WaitTasks[await Promise.allSettled: 等待所有画图任务结束]
        CleanTags --> UpdateDB[Prisma: 更新消息内容, 状态设为 completed / failed]
        UpdateDB --> ErrorCheck{主流程是否有 mainError?}
        ErrorCheck -->|是| SendError[handleStreamError: 发送 error 事件并关闭流]
        ErrorCheck -->|否| SendEnd[sendEvent: stream_end 并安全关闭流]
    end

    SendError --> End([会话结束])
    SendEnd --> End

    class Start,End startEnd;
    class Route,Stream,Context,RagSearch,ExtractPartial,CreatePlaceholder,LoadPersonal,SendText,Accumulate,GenId,SendPlaceholder,InjectTag,ToolResponse,Assemble,CleanTags,UpdateDB process;
    class RAG,RetryCheck,StreamChunk,CheckContext,MultiSuccess,TextSuccess,ErrorCheck decision;
    class TriggerBg,MultiModal,FallbackText,UploadGCS,SendImageEvent,MapImage,WaitTasks async;
    class CatchError,SendError error;
```

---

## 3. 时序交互图 (Sequence Diagram)

以下时序图展示了前端、Next.js API 路由、Gemini 文本模型、Gemini 图像模型以及 GCS 之间的动态交互与时间重叠关系：

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant FE as 前端浏览器 (ChatMessage)
    participant API as Next.js API (stream-handler)
    participant DB as Prisma (PostgreSQL)
    participant Pro as Gemini-2.5-Pro (文本)
    participant Flash as Gemini-2.5-Flash-Image (画图)
    participant GCS as Google Cloud Storage

    User->>FE: 输入“帮我搭配一套运动装”
    FE->>API: POST /api/generate-with-image
    activate API
    API->>DB: 创建 assistant 占位消息 (status: generating)
    DB-->>API: 返回 messageId
    API-->>FE: 发送 metadata (messageId)

    %% 文本流开始
    API->>Pro: 发起对话流 (sendMessageStream)
    activate Pro
    Pro-->>API: 返回文本 Chunk 1
    API-->>FE: 发送 text_chunk ("好的，为你推荐...")
    FE->>User: 实时打字机渲染文本

    Pro-->>API: 触发工具调用 image_generator(prompt, wardrobe_items)
    deactivate Pro
    
    %% 触发画图，主轨不等待
    API-->>FE: 发送 image_placeholder (imageId)
    FE->>User: 渲染“正在生成图片...”动画
    API->>API: 在文本流中注入 [IMAGE=imageId] 占位符
    
    %% 异步启动画图任务 (副轨)
    note over API,Flash: 异步启动后台画图，主轨继续向下执行
    rect rgb(220, 255, 220)
        API-)+Flash: [异步] generateAndSendImageWithContext (多模态)
        activate Flash
    end

    %% 主轨继续生成文本
    activate Pro
    API->>Pro: 告知工具已启动 (OK, image generation initiated)
    Pro-->>API: 返回文本 Chunk 2 ("这套搭配非常适合...")
    deactivate Pro
    API-->>FE: 发送 text_chunk ("这套搭配非常适合...")
    FE->>User: 持续打字机渲染文本

    %% 副轨画图处理 (可能遭遇 429)
    rect rgb(255, 220, 220)
        Flash--xAPI: [尝试 1] 抛出 429 (Resource Exhausted)
        API->>API: 触发保底，退级为纯文本画图
        API->>Flash: [尝试 2] 纯文本画画 (gemini-2.5-flash-image)
        Flash-->>API: 返回图片 Base64 数据
        deactivate Flash
    end
    
    API->>GCS: 上传 Base64 图片
    activate GCS
    GCS-->>API: 返回公网 URL
    deactivate GCS
    API-->>FE: 发送 image_generated (imageId, imageUrl)
    FE->>User: 将占位动画替换为真实的穿搭效果图

    %% 主轨文本流结束，进入优雅结算
    API->>API: 文本流结束，进入 finally 块
    API->>API: await Promise.allSettled(imageTasks) (等待画图任务彻底结束)
    API->>API: 将 [IMAGE=imageId] 替换为 Markdown 图片语法
    API->>DB: 更新消息内容，状态设为 completed
    API-->>FE: 发送 stream_end
    deactivate API
    FE->>FE: 关闭 SSE 连接
```

---

## 4. 关键容错与安全机制说明

### 4.1 绕过 XSS 过滤的行内渲染机制
* **问题**：`react-markdown` 默认会过滤掉非标准协议（如 `wardrobe:id`），导致 `href` 变为空字符串，且将文本切碎渲染会导致 `<ul>` / `<li>` 块级标签强制换行。
* **解决**：
  1. 预处理文本，将 `[衣橱物品:id=xxx]` 替换为标准的相对路径 `[衣橱物品](/wardrobe-item/xxx)`。
  2. 相对路径符合标准 URL 规范，完美绕过 XSS 过滤器。
  3. 在 `ReactMarkdown` 的 `components.a` 中拦截 `/wardrobe-item/` 前缀，将其渲染为 `inline-flex` 的 `WardrobeItem` 组件，实现完美的行内无缝排版。

### 4.2 双重画图保底机制 (Fallback)
* **问题**：多模态画图（传入衣橱实物图作为上下文）可能因为图片格式、安全政策审查或 429 频控而失败。
* **解决**：
  1. 在 `generateImage.ts` 中，多模态调用被包裹在 `try-catch` 中。
  2. 一旦多模态调用抛出异常，或者返回的数据中不含 `inlineData`，系统会自动触发**纯文本画图保底机制**（仅使用 Prompt 词，不传上下文图片）。
  3. 纯文本画图同样享受 `async-retry` 的 2 次退避重试保护。

### 4.3 占位符安全清洗 (Sanitization)
* **问题**：如果画图任务在经历所有重试后依然彻底失败，文本中残留的 `[IMAGE=img-xxx]` 占位符会直接裸露给用户，影响观感。
* **解决**：
  1. 在 `stream-handler.ts` 的 `finally` 块中，系统会使用正则安全清洗所有未成功替换的占位符：
     ```typescript
     finalContent = finalContent.replace(/\[IMAGE=[^\]]+\]/g, '\n\n*(❌ 效果图生成失败)*\n\n');
     ```
  2. 确保最终写入数据库和展示给用户的文本永远是干净、友好的。