# 设计方案: AI 智能整合 (Phase 3) - 衣橱优先混合推荐 (RAG)

## 1. 核心目标

将用户的个人衣橱数据无缝整合到 AI 穿搭建议流程中。当用户发起请求时，AI 优先从用户的衣橱中挑选合适的单品进行搭配。如果衣橱中没有合适的单品，AI 则会创造性地推荐“虚拟新品”。最终，明确告知用户哪些是“你的衣服”，哪些是“为你推荐的新品”，并生成与用户衣橱物品高度一致的效果图。

## 2. 全新用户体验流程 (UX Flow)

**新流程**:
> **用户**: "今天要去约会，帮我推荐一套好看的衣服。"
> **AI**: "好的，我们来看看您的衣橱。约会的话，您衣橱里的那件 **[白色连衣裙](您的衣橱物品)** 非常合适！为了让造型更完整，我建议搭配一双 **米色高跟凉鞋 (推荐新品)** 和一个 **草编手提包 (推荐新品)**。这样既优雅又带有度假感。正在为您生成穿搭效果图..."

**关键差异**:
1.  AI 的思考模式增加了“检索衣橱”这一步。
2.  返回给用户的文案中，明确标注了单品的来源 (`[您的衣橱物品]` vs `🛍️`)。
3.  生成的效果图会尽可能地与用户衣橱中的单品特征保持一致。

## 3. 技术架构与实现方案 (RAG)

我们将对核心的聊天生成逻辑 (位于 `createOotdStream` 内部或其调用的模块) 进行升级，引入 RAG 流程。

**流程图:**
```mermaid
graph TD
    A[用户请求: "约会穿搭"] --> B{1. 语义分析与检索};
    B --> B1[从用户请求中提取意图<br><i>(约会, 优雅)</i>];
    B --> B2[查询用户衣橱数据库<br><i>(向量相似度搜索)</i>];
    B2 --> B3[找到匹配的衣橱单品<br><i>(Item ID: 42, '白色连衣裙')</i>];
    B3 --> C{2. Prompt 增强};
    C --> C1["构建一个特殊的 Prompt<br><b>System Prompt:</b> '...优先使用衣橱物品...'<br><b>User:</b> '约会穿搭'<br><b>Wardrobe Items:</b> '<item id=42>白色连衣裙...</item>'"];
    C1 --> D{3. 增强生成 (文本)};
    D --> D1[调用 Gemini Pro (传入增强 Prompt)];
    D1 --> D2{AI 生成回复<br><i>'用你的 <b>[衣橱物品:id=42]</b> 搭配...'</i>};    
    D2 --> E{4. 后处理与格式化};
    E --> E1[服务器解析 <b>[衣橱物品:id=42]</b>];
    E1 --> E2[替换为: '<b>白色连衣裙 [您的衣橱物品]</b>'];
    E2 --> F[流式返回给客户端];
    D2 --> G{5. 增强生成 (图像)};
    G --> G1[AI 调用 <b>generate_ootd_image</b> 工具<br><i>args: { wardrobe_items: [{id:'42'}] }</i>];
    G1 --> G2[后端从数据库获取衣物图片URL];
    G2 --> G3[构建多模态 Prompt (含多张图片)];
    G3 --> H[调用图像模型];
    H --> I[返回最终效果图];

    subgraph "检索 (Retrieval)"
        B; B1; B2; B3;
    end
    subgraph "增强 (Augmentation)"
        C; C1;
    end
    subgraph "生成 (Generation)"
        D; D1; D2; E; E1; E2; F; G; G1; G2; G3; H; I;
    end
```

## 4. 技术实现细节

### Step 1: 信息检索 (Retrieval)

-   **创建向量嵌入**: 为了实现智能匹配，我们需要为每件衣物创建“向量嵌入”。
    -   **时机**: 在用户上传新衣物时，后端异步触发一个任务。
    -   **内容**: 将衣物的 `subCategory`, `description`, `colors`, `tags` 合并成一段描述性文本。
    -   **模型**: 调用 Gemini 的 `text-embedding-004` 模型，将这段文本转换为一个向量。
    -   **存储**: 在 `ClothingItem` 表中增加一个 `embedding` 字段 (类型为 `vector`)，存储这个向量。
-   **实现语义搜索功能**:
    -   创建一个新的后端函数 `searchWardrobeItems(userId, queryText, limit)`。
    -   该函数首先将用户的查询 `queryText` 也转换为向量。
    -   然后，在数据库中使用向量的“余弦相似度”查询，找出与用户查询意图最匹配的 `limit` 件衣物。这需要数据库支持向量查询 (如 `pgvector` for PostgreSQL)。

### Step 2: Prompt 增强 (Augmentation)

-   **修改 System Prompt**: 指示 AI 如何行动。
    > "你是一个私人造型师。在你的回复中，必须优先使用用户衣橱中提供的物品。当使用衣橱物品时，你必须使用格式 `[衣橱物品:id=物品ID]` 来引用它。如果找不到合适的衣橱物品，你可以推荐虚拟新品，并用 `[推荐新品]` 标记。最后，总结整套穿搭，调用 `generate_ootd_image` 工具来生成效果图。"
-   **动态注入衣橱信息**:
    -   在 `user` 的消息之前，插入一个 `<context>`或`<wardrobe_items>` 块，其中包含从 **Step 1** 中检索到的衣物信息。
    ```xml
    <wardrobe_items>
      <item id="42" mainCategory="ONE_PIECE" subCategory="连衣裙" colors="白色" description="一件简约的无袖白色连衣裙"/>
      <item id="55" mainCategory="FOOTWEAR" subCategory="凉鞋" colors="黑色" description="一双黑色一字带平底凉鞋"/>
    </wardrobe_items>
    ```

### Step 3: 增强生成 - 穿搭可视化 (Image-guided Generation)

这是对原方案的重大升级，确保了效果图的保真度。

-   **升级工具定义**: 我们重新定义 `generate_ootd_image` 工具。
    -   **新版定义**: `generate_ootd_image(description: string, wardrobe_items: Array<{ id: string, category: string }> )`
    -   **`description`**: 整套穿搭的总体描述。
    -   **`wardrobe_items`**: 一个数组，包含了这套穿搭中用到的**所有衣橱单品**的 ID 和类别。

-   **后端处理工具调用**:
    1.  **解析工具调用**: 当后端捕获到 `generate_ootd_image` 的调用时，解析出 `description` 和 `wardrobe_items` 数组。
    2.  **构建多模态 Prompt**: 
        -   初始化一个空的 `Part[]` 数组。
        -   **遍历 `wardrobe_items` 数组**: 对于每个 `item`，从数据库查询其 `imageUrl`，调用 `urlToGenerativePart(imageUrl)` 转换为 `imagePart`，并推入 `Part[]` 数组。
        -   **添加指令文本**: 在所有 `imagePart` 之后，添加一个 `textPart`，用以指导图像模型。
    3.  **发送给图像模型的最终 Prompt 结构示例**:
        ```javascript
        [
          // Part 1: 来自用户衣橱的上衣图片
          { inlineData: { mimeType: 'image/jpeg', data: '...' } },
          // Part 2: 来自用户衣橱的裤子图片
          { inlineData: { mimeType: 'image/jpeg', data: '...' } },
          // Part 3: 指令文本
          { 
            text: "请生成一张逼真的模特街拍图。模特需要穿着所提供的两件衣服：图片1是上衣，图片2是裤子。请自然地将它们组合成一套完整的穿搭，并补齐缺失的鞋履和背景。风格要休闲时尚。"
          }
        ]
        ```
    4.  **调用图像模型**: 将这个包含多张图片和指令文本的 `Part[]` 数组发送给图像生成模型。
    5.  **返回结果**: 将生成后的图片 URL 通过 SSE 的 `image` 事件返回给客户端。

### Step 4: 后处理与格式化

-   **AI 生成**: AI 会遵循指示，生成类似 `"我建议您穿上 [衣橱物品:id=42]，它非常适合约会..."` 这样的文本。
-   **后端后处理**: 在 `createOotdStream` 将文本流式返回给客户端之前，增加一个解析步骤。
    -   使用正则表达式 ` /\[衣橱物品:id=(\d+)\]/g ` 匹配这个特殊标记。
    -   当匹配到时，服务器根据 `id` 从数据库中查询该物品的简要信息。
    -   将 `[衣橱物品:id=42]` 替换为对用户更友好的信息，例如 `“您的那件白色连衣裙 [来自您的衣橱]”`。
    -   最终用户看到的是自然语言，而 AI 和后端之间通过结构化的 ID 进行通信。