# 组件设计模式参考

## 1. 容器/展示组件模式 (Container/Presentational)

- **展示组件 (Presentational Components)**:
  - **职责**: 只负责 UI 的外观和感觉。
  - **特点**: 接收 `props` 并渲染，不包含业务逻辑，不管理自身状态。
  - **示例**: 一个只接收 `text` 和 `onClick` 的 `Button` 组件。

- **容器组件 (Container Components)**:
  - **职责**: 处理业务逻辑、数据获取和状态管理。
  - **特点**: 通常不包含复杂的 JSX，而是将数据和回调函数作为 `props` 传递给一个或多个展示组件。
  - **示例**: `UserPage` 组件获取用户数据，然后将 `user` 对象传递给 `UserProfileCard` 展示组件。

## 2. 复合组件模式 (Compound Components)

- **目的**: 允许用户通过组合多个子组件来构建一个完整的 UI 单元，同时由父组件隐式管理它们之间的状态。
- **特点**: 子组件通过 `React.Children` 和 `React.cloneElement` 与父组件通信。
- **示例**:
  ```tsx
  <Accordion>
    <Accordion.Item id="1">
      <Accordion.Header>Section 1</Accordion.Header>
      <Accordion.Panel>Content for section 1.</Accordion.Panel>
    </Accordion.Item>
  </Accordion>
  ```
  这里，`Accordion` 组件管理哪个 `Accordion.Item` 是打开的。
