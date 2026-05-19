# 项目开发总纲 (Project Development Guidelines)

本总纲是项目的核心开发准则，所有贡献者（包括 AI 助手）必须严格遵守。

## 1. 核心技术栈

- **框架**: Next.js (v16.2.4)
- **语言**: TypeScript
- **UI 库**: React (v19.2.4)
- **组件方案**: **shadcn/ui** 模式。
  - **原子组件**: Radix UI
  - **样式**: Tailwind CSS v4
  - **样式变体**: `class-variance-authority` (CVA)
  - **样式合并**: `tailwind-merge`, `clsx`
- **图标**: `lucide-react`
- **AI 集成**: Google Gemini SDK (`@google/genai`) - **Vertex AI 模式**
- **API 通信**: Next.js API 路由, `node-fetch`
- **代码质量**: ESLint, TypeScript 类型检查

## 2. 目录结构与模块划分

- `app/`: **应用核心目录 (Next.js App Router)**
  - `app/page.tsx`: 应用主页。
  - `app/layout.tsx`: 全局根布局。
  - `app/globals.css`: 全局样式。
  - `app/api/`: **后端 API 路由**。所有服务端接口必须定义在此。
    - `app/api/**/route.ts`: API 端点的标准文件。
- `components/`: **React 组件**
  - `components/ui/`: **UI 原子组件**。源自 `shadcn/ui`，是高度可复用、无业务逻辑的基础组件（如 Button, Input, Card）。
  - `components/chat/`: **业务复合组件**。与特定业务（如聊天界面）相关，由 `ui` 组件组合而成。
- `hooks/`: **自定义 React Hooks** (例如 `use-mobile.ts`)。
- `lib/`: **公共库和工具函数**
  - `lib/utils.ts`: 通用工具函数，特别是 `cn` 函数。
  - `lib/types.ts`: 全局共享的 TypeScript 类型定义。
- `public/`: **静态资源** (图片, 字体等)。
- `skills/`: **AI Agent 技能定义**，是本项目的特定约定。
- `.agents/`: **AI 助手（Continue）配置**，包括本规则。

## 3. 组件开发规范

#### **创建原则**
- **位置**:
  - 通用、无业务逻辑的原子组件放入 `components/ui/`。
  - 多个原子组件构成的、与业务相关的复合组件放入 `components/` 下的对应业务目录（如 `components/chat/`）。
- **命名**: 文件名为 `ComponentName.tsx`，组件名为 `PascalCase`。

#### **代码结构 (必须遵循此模板)**
所有新组件必须使用 `React.forwardRef`，并通过 `cva` 管理样式。

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// 1. 定义 CVA 样式变体
const componentNameVariants = cva(
  "...", // 组件的基础样式
  {
    variants: {
      variant: {
        default: "...",
      },
      size: {
        default: "...",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// 2. 定义 Props 接口
export interface ComponentNameProps
  extends React.HTMLAttributes<HTMLDivElement>, // <-- 根据根元素更改
    VariantProps<typeof componentNameVariants> {}

// 3. 使用 forwardRef 创建组件
const ComponentName = React.forwardRef<
  HTMLDivElement, // <-- 根据根元素更改
  ComponentNameProps
>(({ className, variant, size, ...props }, ref) => {
  return (
    <div // <-- 根元素
      className={cn(componentNameVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
})
ComponentName.displayName = "ComponentName" // 4. 设置 displayName

// 5. 导出组件和样式变体
export { ComponentName, componentNameVariants }
```

## 4. API 路由规范

- **位置**: 所有 API 必须在 `app/api/` 目录下。
- **命名**: 遵循 Next.js 路由约定，例如 `app/api/chat/route.ts`。
- **方法**: 使用导出的具名函数处理 HTTP 方法，例如 `export async function POST(request: Request) {}`。
- **流式响应**: 对于 AI 生成内容等耗时操作，优先使用 `ReadableStream` 或 `TransformStream` 进行流式响应，以提升用户体验。
- **错误处理**: 返回统一的 JSON 错误结构 `{ error: '错误信息' }`，并使用正确的 HTTP 状态码。

## 5. 代码风格与质量

- **格式化**: 严格遵守项目集成的 ESLint 规则。在提交代码前运行 `pnpm lint`。
- **TypeScript**:
  - **严禁使用 `any`**。如遇困难，应创建明确的 `type` 或 `interface`。
  - 全局共享的类型应定义在 `lib/types.ts` 中。
- **路径别名**: 必须使用 `@/` 路径别名进行模块导入，例如 `import { cn } from '@/lib/utils'`。

## 6. AI SDK 使用规范: @google/genai (核心)

**警告：本项目唯一指定的 Google AI SDK 是 `@google/genai`。**

严禁使用或安装 `@google/generative-ai` 包。

### 核心原因
1.  **统一体验**: `@google/genai` 是谷歌的下一代 SDK，旨在统一 AI Studio 和 Vertex AI 的开发体验。我们的项目配置为 Vertex AI，必须使用此 SDK。
2.  **函数调用 (Function Calling)**: 这是我们项目架构的核心。我们不直接让 AI 生成所有内容，而是让 AI (`gemini-2.5-pro`) 作为“调度中心”，调用我们为它定义的工具（如 `image_generator`）。`@google/genai` 对此提供了原生和强大的支持。

### 标准用法
所有与 Gemini 模型的交互都必须通过 `server/service/ai.ts` 中初始化的单例客户端 `genAI`。此客户端已为 Vertex AI 和函数调用进行配置。

**标准初始化示例 (`server/service/ai.ts`):**
```typescript
import { GoogleGenAI, FunctionDeclaration } from "@google/genai";

// Initialize for Vertex AI
export const genAI = new GoogleGenAI({
  vertexai: true,
  project: process.env.PROJECT_ID || "",
  location: process.env.LOCATION || "",
});

// Define tools AI can use
export const tools: FunctionDeclaration[] = [
  {
    name: "image_generator",
    description: "当需要根据文本描述生成一张效果图或可视化图片时调用此工具。",
    parameters: {
      type: "OBJECT",
      properties: {
        prompt: {
          type: "STRING",
          description: "用于生成图片的、详细的、具有画面感的英文描述。",
        },
      },
      required: ["prompt"],
    },
  },
];
```