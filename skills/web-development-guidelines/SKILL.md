---
name: web-development-guidelines
description: 提供此 Next.js 项目的 Web 开发最佳实践，涵盖组件结构、shadcn/ui 使用、Tailwind CSS、状态管理和命名约定。在实现新功能或重构现有代码时应遵循此规范。
---

# Web 开发规范

## 1. 总体原则
- **代码清晰性**: 代码首先是写给人看的，其次才是给机器执行的。保持简洁、直观。
- **单一职责**: 每个组件、函数或模块应只做一件事，并把它做好。
- **遵循约定**: 统一遵循此文件中定义的命名和结构约定。

## 2. 文件与目录结构
- **UI 组件**: 通过 shadcn/ui 添加的组件位于 `components/ui/`。
- **业务组件**: 基于 UI 组件组合而成的业务组件应存放在 `components/` 目录下。
- **页面**: 页面级组件直接使用 Next.js App Router 的 `app/` 目录结构。
- **工具函数**: 全局工具函数放在 `lib/utils/`，包括 shadcn/ui 的 `cn` 函数。

## 3. 组件设计
- **原子化与组合**: 优先使用 shadcn/ui 提供的原子组件（Button, Input, Card 等）进行组合，构建复杂的业务组件。
- **Props**: Props 接口应清晰、具体，并使用 TypeScript 类型定义。
- **更多模式**: 详细的组件设计模式请参考 `references/component-patterns.md`。

## 4. 样式 (Tailwind CSS)
- **功能类优先**: 尽可能使用 Tailwind 的功能类。
- **shadcn/ui 集成**: 所有 `components/ui` 中的组件都通过 Tailwind CSS 进行样式设置。样式的定制应直接修改组件文件本身。
- **CSS 变量**: shadcn/ui 的主题系统（颜色、圆角、间距）由 `globals.css` 中的 CSS 变量驱动。定制全局主题应从修改这些变量开始。
- **`cn` 辅助函数**: 使用 `lib/utils.ts` 中的 `cn` 函数来条件性地合并 Tailwind 类，确保样式类的可维护性。

## 5. UI 组件库 (shadcn/ui)

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

## 6. 状态管理
- **本地状态**: 优先使用 `useState` 和 `useReducer`。
- **跨组件状态**: 对于需要跨多层组件共享的状态，使用 `React Context`。
- **全局状态**: 仅在需要全局状态管理或缓存服务端状态时，才考虑引入 `Zustand` 或 `React Query`。

## 7. 命名约定
- **组件**: PascalCase (e.g., `UserProfile.tsx`)
- **变量/函数**: camelCase (e.g., `const userName = ...`)

## 8. 视觉矫正协议 (Visual Correction Protocol)

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
