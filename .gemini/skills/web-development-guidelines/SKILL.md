---
name: web-development-guidelines
description: 提供此 Next.js 项目的 Web 开发最佳实践，涵盖组件结构、shadcn/ui 使用、Tailwind CSS、状态管理和命名约定。在实现新功能或重构现有代码时应遵循此规范。
---

# Web 开发规范

## 1. 总体原则
- **代码清晰性**: 代码首先是写给人看的，其次才是给机器执行的。保持简洁、直观。
- **单一职责**: 每个组件、函数或模块应只做一件事，并把它做好。
- **遵循约定**: 统一遵循此文件中定义的命名和结构约定。

## 2. 包管理器 (Package Manager)
- **必须使用 `pnpm`**: 本项目使用 `pnpm` 作为唯一的包管理器，以确保快速、高效的磁盘空间利用和一致的依赖解析。
- **安装依赖**: `pnpm install`
- **添加依赖**: `pnpm add [package_name]`
- **移除依赖**: `pnpm remove [package_name]`
- **禁止使用 `npm` 或 `yarn`**: 为避免依赖冲突和 `node_modules` 结构不一致，请不要在本项目中使用 `npm install` 或 `yarn add`。

## 3. 文件与目录结构 (推荐架构)

为了保证项目的可扩展性和清晰的职责分离，我们采用基于技术关注点的分层目录结构。

- **`app/`**: **路由与组合层**。
  - Next.js 的 App Router。此目录下的文件（`page.tsx`, `layout.tsx`）应保持精简。
  - 它们是“指挥官”，负责从 `server/` 模块获取数据，并将数据传递给 `components/` 中的 UI 组件进行渲染。

- **`components/`**: **UI 组件库**。
  - 存放所有可复用的 React 组件。
  - `components/ui/`: 存放由 shadcn/ui 管理的原子组件。
  - `components/business/`: 存放由我们自己构建的、具有业务含义的组合组件。
  - 组件可以是服务器组件（默认）或客户端组件 (`"use client"`)。

- **`hooks/`**: **客户端逻辑中心**。
  - 存放所有自定义 React Hooks (如 `useUserProfile`)。
  - 用于封装和复用涉及客户端状态、用户交互、浏览器 API 的逻辑。

- **`store/`**: **全局状态中心**。
  - 用于存放 Zustand、Jotai 等全局状态管理的 store 和相关 hooks。

- **`lib/`**: **通用工具库**。
  - 存放可在项目任何地方（客户端或服务端）安全使用的通用工具函数，如 `cn`、日期格式化等。

- **`server/`**: **后端逻辑堡垒**。
  - **此目录下的所有代码都被保证只在服务器上运行**。
  - `server/actions/`: 存放所有 Next.js Server Actions，用于处理表单提交和数据变更。
  - `server/queries/`: 存放用于获取数据的函数，例如复杂的数据库查询和第三方 API 调用。
  - `server/db/`: 存放数据库相关配置，如 Prisma schema、数据库客户端实例等。

## 4. 代码质量与可维护性
- **文件行数限制**:
    - 作为一项强力建议，任何单个文件（组件、模块、样式等）的行数**不应超过 300 行**。
    - 如果文件接近此限制，应将其视为重构信号。请将逻辑拆分到更小的、功能单一的模块或组件中。
- **解耦与复用**:
    - **善用 Hooks**: 将可复用的逻辑（如 API 调用、状态处理）封装成自定义 Hooks（`use...`）。
    - **保持组件纯粹**: 业务组件应专注于 UI 呈现。将业务逻辑和数据获取逻辑剥离到 Hooks 或父组件中。
    - **创建通用工具**: 对于非 UI 的纯函数逻辑，应将其放入 `lib/utils` 或更具体的工具函数目录中。

## 5. 组件设计
- **原子化与组合**: 优先使用 shadcn/ui 提供的原子组件（Button, Input, Card 等）进行组合，构建复杂的业务组件。
- **Props**: Props 接口应清晰、具体，并使用 TypeScript 类型定义。
- **更多模式**: 详细的组件设计模式请参考 `references/component-patterns.md`。

## 6. 样式 (Tailwind CSS)
- **功能类优先**: 尽可能使用 Tailwind 的功能类。
- **shadcn/ui 集成**: 所有 `components/ui` 中的组件都通过 Tailwind CSS 进行样式设置。样式的定制应直接修改组件文件本身。
- **CSS 变量**: shadcn/ui 的主题系统（颜色、圆角、间距）由 `globals.css` 中的 CSS 变量驱动。定制全局主题应从修改这些变量开始。
- **`cn` 辅助函数**: 使用 `lib/utils.ts` 中的 `cn` 函数来条件性地合并 Tailwind 类，确保样式类的可维护性。

## 7. UI 组件库 (shadcn/ui)

### 核心理念
- **你拥有代码**: shadcn/ui 不是一个外部依赖库。它通过 CLI 将组件的源代码直接复制到你的项目中。这意味着你对它们有 100% 的控制权，可以随意修改以满足项目需求。
- **组合优于配置**: 它提供了一系列基础组件，鼓励你通过组合它们来构建自己的、符合业务需求的组件。

### 如何添加新组件
始终使用 CLI 来添加新组件，以确保所有依赖都已安装。
```bash
npx shadcn@latest add [component_name]
```
例如: `npx shadcn@latest add dialog tooltip`

### 自定义组件
- **直接修改**: 需要调整组件样式或行为时，直接打开 `components/ui/` 中对应的文件进行修改。
- **使用 `cva`**: 组件内部使用 `cva` (class-variance-authority) 来管理不同的变体（variants）和尺寸（sizes）。当需要为组件添加新的样式变体时，应遵循此模式。

### 图标
- **Lucide Icons**: 项目默认使用 `lucide-react` 作为图标库，它与 shadcn/ui 完美集成。优先使用此库中的图标以保持风格统一。

## 8. 状态管理
- **本地状态**: 优先使用 `useState` 和 `useReducer`。
- **跨组件状态**: 对于需要跨多层组件共享的状态，使用 `React Context`。
- **全局状态**: 仅在需要全局状态管理或缓存服务端状态时，才考虑引入 `Zustand` 或 `React Query`。

## 9. 命名约定
- **组件**: PascalCase (e.g., `UserProfile.tsx`)
- **变量/函数**: camelCase (e.g., `const userName = ...`)

## 10. 代码注释规范
- **语言**: 所有代码注释**必须使用中文**，以便团队所有成员理解。
- **注释内容**:
    - **为何做 (Why)**: 优先解释“为什么”要这么做，而不是“做了什么”。代码本身应能清晰地展示“做了什么”。
        - _好的例子_: `// 考虑到 Safari 浏览器的兼容性问题，这里需要手动触发重绘`
        - _不好的例子_: `// 让 i 加 1`
    - **复杂逻辑**: 为复杂的算法、正则表达式或业务逻辑提供注释。
    - **公开的函数/组件**: 对所有暴露给其他模块使用的函数、方法或组件，应使用 JSDoc / TSDoc 格式进行注释，说明其功能、参数和返回值。
- **JSDoc/TSDoc 示例**:

  ```typescript
  /**
   * 计算两个数的和。
   * @param a 第一个加数
   * @param b 第二个加数
   * @returns 返回 a 与 b 的和
   */
  function add(a: number, b: number): number {
    return a + b;
  }
  ```

## 11. 视觉矫正协议 (Visual Correction Protocol)

### 1. 空间逻辑 (The 8pt Rule)
- 严禁使用随机像素！所有间距必须是 4 的倍数：`p-4`, `m-8`, `gap-6`。
- 容器内边距永远不要小于 `p-6` (24px)，让内容“呼吸”。

### 2. 色彩与深度 (Depth & Color)
- 背景：使用 `zinc-50` (亮) 或 `zinc-950` (暗)，拒绝纯白纯黑。
- 边框：所有卡片和容器必须有极细边框 `border border-zinc-200/50`。
- 阴影：禁止重阴影。使用 `shadow-sm` 或自定义软阴影 `shadow-[0_1px_2px_rgba(0,0,0,0.05)]`。

### 3. 字体与排版 (Typography)
- 层级：不要只会加字号。次要信息请用 `text-zinc-500` + `text-sm`。
- 标题：增加 `tracking-tighter` (紧凑字距) 和 `font-semibold`，瞬间高级。

### 4. 交互 (Feedback)
- 所有 Button 必须加 `transition-all active:scale-95`。
- 悬停：使用微弱的背景色变化 `hover:bg-zinc-100/80`。