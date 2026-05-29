# “用户橱窗” (Wardrobe) 功能设计方案 v2

## 1. 核心思想

将应用从通用的时尚建议工具，转变为深度个性化的私人造型助手。通过让用户管理自己的“数字衣橱”，使 AI 的推荐更贴近用户实际拥有的单品，同时在衣橱不足时智能推荐新品，提供更实用、更完整的穿搭方案。

## 2. 整体设计：三步走策略

1.  **Phase 1: 橱窗基础建设 (数据模型与 API)**：建立更精细化的衣物分类体系和相应的管理接口。
2.  **Phase 2: 橱窗管理界面 (UI/UX)**：打造带 Tab 分类、支持高性能图片加载的橱窗管理界面。
3.  **Phase 3: AI 智能整合 (混合推荐 RAG)**：实现“衣橱优先，新品补充”的智能推荐逻辑。

---

## Phase 1: 橱窗基础建设 (数据模型与 API) - v2 更新

### 数据模型 (Database Schema)

**变更**：为了支持更详细的分类，我们将原有的 `category` 字段拆分为 `mainCategory` 和 `subCategory`。

```sql
-- PostgreSQL 语法示例
CREATE TYPE clothing_main_category AS ENUM ('TOP', 'BOTTOM', 'OUTERWEAR', 'FOOTWEAR', 'ACCESSORY', 'ONE_PIECE');

CREATE TABLE "ClothingItem" (
    "id" SERIAL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "mainCategory" clothing_main_category NOT NULL, -- 主要类别 (用于 Tab 分类)
    "subCategory" TEXT NOT NULL, -- 子类别 (AI 自动生成, e.g., 'T-shirt', 'Jeans', 'Ankle Boots')
    "description" TEXT,
    "colors" TEXT[],
    "tags" TEXT[],
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE
);
```

*   **`mainCategory`**: 用于 UI 上的主 Tab 分类，选项固定，例如：上装 (`TOP`)、下装 (`BOTTOM`)、外套 (`OUTERWEAR`)、鞋履 (`FOOTWEAR`)、配饰 (`ACCESSORY`)、连身 (`ONE_PIECE` 如连衣裙、连体裤)。
*   **`subCategory`**: 由 AI 自动识别并生成，提供更具体的分类，如 `T-shirt`, `Sweater`, `Short Skirt`, `Jeans`。用户可以编辑。

### API 设计 (RESTful)

API 接口保持不变，但其处理逻辑和返回的数据会包含新的 `mainCategory` 和 `subCategory` 字段。

---

## Phase 2: 橱窗管理界面 (UI/UX) - v2 更新

### 页面设计 (`/wardrobe`)

**变更**：引入 Tab 式导航和性能优化考量。

1.  **Tab 式导航**:
    *   页面顶部使用 `shadcn/ui` 的 `<Tabs>` 组件。
    *   Tab 选项包括：`全部`、`上装`、`下装`、`外套`、`鞋履`、`配饰`、`连身`。
    *   点击不同的 Tab，下方网格仅显示对应 `mainCategory` 的衣物。

2.  **高性能图片网格**:
    *   **图片懒加载 (Lazy Loading)**: 只有当图片滚动到视口内时才开始加载。`next/image` 默认支持此功能。
    *   **响应式图片 (`srcset`)**: 使用 `next/image` 为不同屏幕尺寸提供优化过的图片大小，避免在手机上加载桌面端的大图。
    *   **分页或无限滚动**: 当衣物数量多时，不一次性加载所有数据。优先实现分页，后续可优化为无限滚动，每次滚动到底部时再请求加载下一页的数据。
    *   **占位符 (Placeholder)**: 在图片加载完成前，显示一个模糊的低分辨率版本或骨架屏 (`Skeleton`)，提升感官体验。

---

