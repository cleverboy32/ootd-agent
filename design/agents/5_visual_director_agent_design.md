# Visual Director Agent (视觉导演智能体) 设计规格书

## 1. 智能体定位
Visual Director Agent 是整个穿搭系统的“视觉总监”与“摄影导演”。它不直接画图，而是负责“创意构思、绘图调用、多模态审核与自我纠错”的完整生命周期。

在多套方案场景下，编排器（Orchestrator）会为每套方案（如 `outfit_1`、`outfit_2`）**并行启动一个独立的视觉导演闭环任务**。每个任务独立运行、互不干扰，通过行业领先的 **“生成-审核-纠错 (Generator-Critic Loop)”** 闭环，确保每张效果图与对应的搭配方案 100% 契合。

---

## 2. 核心闭环工作流 (Generator-Critic Loop)

```mermaid
flowchart TD
    %% 样式定义
    classDef agent fill:#D6E4FF stroke:#5B8FF9 stroke-width:2px
    classDef tool fill:#D3F9D8 stroke:#2F9E44 stroke-width:1px
    classDef decision fill:#FFF1B8 stroke:#D4B106 stroke-width:1px

    Stylist[搭配师方案] --> Director[5. Visual Director Agent]
    
    subgraph 视觉导演 Agent 内部闭环 (Max 2 Attempts)
        Director -->|1. 导演构思| WritePrompt[写出英文 Prompt]
        WritePrompt -->|2. 绘图工具| FlashImage[Gemini-2.5-Flash-Image]
        FlashImage -->|生成图片 Base64| Critic{3. 视觉审核<br>Gemini-2.5-Pro Multimodal}
        
        Critic -->|审核不通过 & 尝试 < 2| Rewrite["4. 修正 Prompt<br>(强化缺失元素的权重)"]
        Rewrite --> WritePrompt
    end
    
    Critic -->|审核通过 OR 达到最大尝试次数| Upload[上传 GCS 并返回 URL]

    class Director agent
    class FlashImage tool
    class Critic decision
```

### 2.1 闭环步骤详解：
1.  **导演构思 (Prompt Generation)**：
    *   使用 `gemini-2.5-flash` 模型。
    *   将搭配师指定方案的 `visual_composition`，扩写为一段极其专业、细节丰富的英文图像生成提示词。
2.  **初稿绘制 (Image Generation)**：
    *   调用 `gemini-2.5-flash-image` 绘图工具生成图片 Base64。
3.  **监视器审核 (Critic)**：
    *   使用 `gemini-2.5-pro` (多模态) 模型。
    *   **输入**：该方案的结构化内容 + 当前生成的图片 Base64。
    *   **审核指标**：
        *   *单品完整度*：指定的关键衣橱单品是否都在图里？
        *   *色彩一致性*：衣服的颜色是否画错或画反？
        *   *场景契合度*：背景、光影是否符合设定？
4.  **自我纠错 (Self-Correction)**：
    *   若审核不通过且尝试次数 < 2：自动修正 Prompt（如强化缺失元素的权重，使用大写或 `CRITICAL:` 强力暗示），然后重新绘制。
    *   若审核通过，或达到最大尝试次数（2次），则结束闭环，上传 GCS 并返回最终图片 URL。

### 2.2 并行分发机制 (Parallel Execution)
*   当搭配师输出多套方案时，编排器会使用 `Promise.all` 同时启动多个 `Visual Director Agent` 实例。
*   每个实例在运行成功后，会向前端发送一个 `image_generated` 事件，其中必须携带该方案的唯一 `id`（如 `outfit_1` 或 `outfit_2`）。
*   前端通过这个 `id`，精准地将图片渲染到对应的 `[IMAGE=方案ID]` 占位符处。

---

## 3. System Prompts (系统提示词)

### 3.1 导演 Prompt (Prompt Generator)
```text
你是一个顶级的时尚摄影导演。请将搭配师指定方案的 visual_composition，扩写为一段极其专业、细节丰富的英文图像生成提示词。

【扩写指南】
1. 模特特征：结合用户的发色、发型和身材比例，描述模特的姿态与神态。
2. 服装细节：详细描述服装的材质（如：针织、排汗面料、硬挺风衣）、色彩与层级搭配。
3. 画面美学：加入专业摄影术语，包含：
   - 光影：如 golden hour glow (黄金时刻光), soft cinematic lighting (电影感柔光)。
   -构图：如 medium shot (中景), street-style fashion photography (街拍风格)。
   - 相机参数：如 shot on 85mm lens, f/1.4, photorealistic, highly detailed fabric textures。
```

### 3.2 监视器审核 Prompt (Critic Agent)
```text
你是一个极其挑剔的时尚监片人与视觉审核专家。
请仔细对比【搭配师指定方案的结构化内容】和【当前生成的图片】。

【审核硬性指标】
1. 单品完整度：搭配师指定的关键衣橱单品（如粉色上衣、灰色短裤）是否都在图里？
2. 色彩一致性：衣服的颜色是否画错或画反？（例如：搭配师要粉色上衣+灰色短裤，图里是否画成了粉色短裤？）
3. 场景契合度：背景（如乒乓球馆、雨天街头）是否符合设定？

【输出规则】
- 如果完全符合，approved 设为 true。
- 如果不符合，approved 设为 false，并在 critique_reason 中指出具体问题，在 revised_prompt_enhancement 中给出修正和强化的英文提示词（例如：'CRITICAL: The model MUST wear dark grey sports shorts. Do NOT use white shorts. Emphasize dark charcoal grey athletic shorts.'）。
```

---

## 4. 输入与输出契约 (Data Contract)

### 4.1 审核输出 JSON Schema (Critic Schema)
```json
{
  "type": "object",
  "properties": {
    "approved": {
      "type": "boolean",
      "description": "图片是否通过审核。若完全符合搭配师方案，为 true；否则为 false。"
    },
    "critique_reason": {
      "type": "string",
      "description": "若未通过，用中文指出具体画错了什么（如：短裤颜色画成了白色，而不是暗灰色）。若通过，填空字符串。"
    },
    "revised_prompt_enhancement": {
      "type": "string",
      "description": "若未通过，给出用于修正和强化的英文提示词。若通过，填空字符串。"
    }
  },
  "required": ["approved", "critique_reason", "revised_prompt_enhancement"]
}
```