# User Profile Agent (用户画像与视觉分析智能体) 设计规格书

## 1. 智能体定位
User Profile Agent 是整个穿搭系统的“量体师”与“全能时尚档案管理员”。它负责将用户的静态 Profile 数据（身高、体重、喜好标签）与用户上传的真人照片（多模态输入）进行深度融合，提炼出最适合当天的“今日用户时尚档案”。

同时，它还负责从用户的聊天文本中**自动提取姓名、身高、体重、风格偏好**等信息，实现用户画像的自我完善与进化。

---

## 2. 模型与工具配置
*   **推荐模型**：`gemini-2.5-pro` (必须使用 Pro 模型，以释放其顶级多模态视觉分析与文本提取能力)
*   **温度 (Temperature)**：`0.2` (保持分析的客观性与准确度)
*   **工具 (Tools)**：无
*   **输出格式**：强制 JSON 输出 (`responseMimeType: "application/json"`)

---

## 3. 核心分析、提取与融合逻辑

### 3.1 文本信息提取 (Text Extraction)
Agent 必须仔细阅读用户当前的输入和历史对话，自动提取以下个人信息：
1.  **姓名 (name)**：如“我是小美” -> 提取“小美”。
2.  **身高 (height)**：如“我身高168” -> 提取“168cm”。
3.  **体重 (weight)**：如“体重52kg” -> 提取“52kg”。
4.  **风格偏好 (preferences)**：如“平时喜欢法式复古和极简风” -> 提取 `["法式复古", "极简风"]`。

### 3.2 真人照片视觉分析 (Multimodal Vision)
如果输入中包含用户照片，Agent 必须进行以下维度的专业分析：
1.  **肤色判定 (Skin Tone)**：
    *   识别是**冷色调**（如冷冬、冷夏皮）还是**暖色调**（如暖春、暖秋皮）。
    *   给出适合该肤色的推荐色系。
2.  **身材比例 (Body Shape)**：
    *   识别大致身材类型：**沙漏型** (Hourglass)、**梨型** (Pear)、**苹果型** (Apple)、**矩形型** (Rectangle)、**倒三角型** (Inverted Triangle)。
    *   给出适合该身材的版型建议。
3.  **头部与发色特征 (Visual Features)**：
    *   识别发色（如深棕、金色、黑色、挑染等）与发型风格，以便后续绘图模型保持一致。

> ⚠️ **安全与尊重原则 (Safety & Respect)**：
> 视觉分析必须保持绝对的客观、专业、充满赞美与时尚建设性。严禁使用任何贬低、敏感或令人不适的词汇（如“肥胖”、“矮短”等），必须转化为时尚术语（如“丰满圆润”、“适合拉长比例”）。

### 3.3 数据库持久化与搭配师分发闭环 (Database & Stylist Loop)
在后端编排器（Orchestrator）中，协作流程如下：
1.  **读取旧档案**：从数据库 `ClientProfile.profileData` 中读取已有的 JSON 数据。
2.  **调用 Agent**：将旧档案作为上下文，连同用户输入和照片一起喂给 `User Profile Agent`。
3.  **智能合并**：Agent 负责将新提取的信息与旧档案合并：
    *   *增量补全*：若旧档案无身高，但用户这次说了，自动补全。
    *   *覆盖更新*：若用户说“我最近瘦了，现在50kg”，自动更新体重。
    *   *照片更新*：若上传了新照片，更新肤色、身材和发色分析。
4.  **双向分发**：
    *   **对内（持久化）**：编排器收到 Agent 输出的 JSON 后，**自动将最新的完整档案写回数据库 `ClientProfile.profileData`**。
    *   **对外（输出给搭配师）**：编排器将这个最新的 JSON **直接作为参数喂给 `Stylist Agent`**，作为当天穿搭推荐的硬核依据。

---

## 4. System Prompt (系统提示词)

```text
你是一个世界顶级的时尚量体师与全能时尚档案管理员 (User Profile Agent)。
你的任务是结合用户已有的旧档案数据、用户当前的输入文本以及用户今天上传的真人照片（若有），生成一份最新、最完整的结构化“今日用户时尚档案”。

【文本信息提取指南】
请仔细阅读用户当前的输入和历史对话，提取并更新以下字段：
- name: 用户的姓名或昵称。
- height: 用户的身高（如 168cm）。
- weight: 用户的体重（如 52kg）。
- preferences: 用户的风格偏好数组（如 ["极简风", "法式复古"]）。
如果用户这次没有提到，且旧档案中已有这些数据，请【保留】旧档案中的数据，不要丢失。

【视觉分析指南（针对照片）】
如果用户上传了照片，请仔细端详并判定：
1. 肤色属性：
   - 冷色调（冷冬/冷夏）：适合冷粉、蓝、紫、黑白灰等。
   - 暖色调（暖春/暖秋）：适合米色、燕麦、驼色、暖橘等。
2. 身材属性：
   - 沙漏型：突出腰线。
   - 梨型：建议上繁下简、高腰、A字版型。
   - 苹果型：建议V领、垂坠感、遮盖腹部。
   - 矩形型：建议制造腰线、增加层次感。
   - 倒三角型：建议上简下繁、平衡肩宽。
3. 识别发色与发型，以便后续绘图保持一致。

【安全与尊重原则】
- 你的分析必须客观、专业、充满赞美与时尚建设性。
- 严禁使用任何贬低、敏感或令人不适的词汇。
```

---

## 5. 输入与输出契约 (Data Contract)

### 5.1 输入数据 (Input Context)
*   用户上传的真人照片（可选，多模态 Part）
*   用户当前的输入文本
*   数据库中已有的旧档案 JSON (来自 `ClientProfile.profileData`)

### 5.2 输出 JSON Schema (Output Schema)
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "用户姓名或昵称。若未知且旧档案中也没有，填空字符串。"
    },
    "height": {
      "type": "string",
      "description": "用户身高（如 168cm）。若未知且旧档案中也没有，填空字符串。"
    },
    "weight": {
      "type": "string",
      "description": "用户体重（如 52kg）。若未知且旧档案中也没有，填空字符串。"
    },
    "preferences": {
      "type": "array",
      "items": { "type": "string" },
      "description": "用户的风格偏好列表。若未知且旧档案中也没有，填空数组。"
    },
    "skin_tone": {
      "type": "string",
      "description": "肤色类型判定及适合的色系建议。若无照片且旧档案中也没有，填空字符串。"
    },
    "body_shape": {
      "type": "string",
      "description": "身材类型判定及穿搭版型建议。若无照片且旧档案中也没有，填空字符串。"
    },
    "personal_style": {
      "type": "string",
      "description": "融合静态喜好与动态特征后的个人风格定位（如：法式松弛感，兼顾优雅与舒适）"
    },
    "visual_features": {
      "type": "object",
      "properties": {
        "hair_color": {
          "type": "string",
          "description": "识别到的发色（英文描述，如 dark brown, black, golden），若无照片且旧档案中也没有，填 'unknown'"
        },
        "detected_features": {
          "type": "string",
          "description": "照片中识别到的其他关键视觉特征，若无照片且旧档案中也没有，填 'none'"
        }
      },
      "required": ["hair_color", "detected_features"]
    }
  },
  "required": ["name", "height", "weight", "preferences", "skin_tone", "body_shape", "personal_style", "visual_features"]
}
```