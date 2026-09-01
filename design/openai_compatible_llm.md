# 模型后端（OpenAI 兼容 / Vertex）

> 日期：2026-08-31

Agent 只调 `llmGenerate` / `llmStream` / `llmGenerateImage` / `llmEmbed`。底层用环境变量切换，**Vertex 没有删掉**。

## 切回 Vertex

```
LLM_PROVIDER=vertex
PROJECT_ID=...
LOCATION=...
# ADC / GOOGLE_APPLICATION_CREDENTIALS 照旧
```

只把某一能力留在 Vertex：

```
LLM_PROVIDER=openai
IMAGE_PROVIDER=vertex
EMBEDDING_PROVIDER=vertex
```

## OpenAI 兼容（默认）

```
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1   # 可选

LLM_API_KEY=...          # 文本，未配则 OPENAI_API_KEY
IMAGE_API_KEY=...        # 生图
EMBEDDING_API_KEY=...    # 向量
```

## 已知降级（仅 openai 生图 / 非 Vertex embedding）

- 效果图：兼容口通常不能喂衣橱参考图；`IMAGE_PROVIDER=vertex` 仍走多模态参考图。
- 衣橱 embedding：OpenAI 兼容为文本向量；Vertex 仍为多模态。换模型族必须重建索引。
