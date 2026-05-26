# 项目核心背景与目标 (Project Core Context & Goals)

## 项目名称
OOTD-Agent (Outfit of the Day Agent)

## 项目背景 (Project Background)
这是一个基于大型语言模型（LLM）的中文 Web 应用。旨在为用户提供每日穿搭建议（Outfit of the Day）。用户可以上传自己当天的照片，或者描述天气、场合、个人风格等信息，应用会通过 AI 智能生成一套或多套穿搭组合建议。

## 核心目标 (Core Goals)
1.  **智能穿搭推荐与可视化**: 不仅提供个性化的穿搭文字建议，**还要利用 AI 图像生成能力，将这套穿搭可视化为一张效果图**，给用户最直观的参考。
2.  **流畅的交互体验**: 打造一个类似 ChatGPT 的对话式界面，让用户能通过自然语言与 AI 顺畅交流，支持文本和图片输入。
3.  **技术验证**: 探索 Next.js、React Server Components 和 Google Gemini 在构建现代化、高性能 AI 应用中的最佳实践。
4.  **可扩展性**: 建立一个清晰、可维护的代码库，方便未来添加更多功能，如衣橱管理、时尚资讯、社交分享等。

## 关键技术角色 (Key Technology Roles)
- **AI 模型**:
  - **文本与逻辑**: `gemini-2.5-pro` (用于理解用户需求、分析图片、给出穿搭建议)。
  - **图像生成**: `gemini-2.5-flash-image` (用于根据建议生成穿搭效果图)。
- **前端**: Next.js App Router, React 19, shadcn/ui, Tailwind CSS
- **我 (AI 助手)**: 我的角色是协助开发人员快速迭代，遵循《项目开发总纲》来编写高质量、标准化的代码。