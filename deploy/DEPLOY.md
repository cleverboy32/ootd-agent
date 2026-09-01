# 生产部署说明（meetu.online /ootd）

本文记录 **2026-09** 在腾讯云 OpenCloudOS 上部署 `ootd-agent` 的方式与踩坑细节。

## 1. 结论一览

| 项 | 取值 |
|---|---|
| 公网入口 | `https://www.meetu.online/ootd` |
| 代码目录 | `/srv/ootd-agent` |
| 部署形态 | **pnpm + pm2 + nginx 子路径** |
| Next.js | `127.0.0.1:3002`，`basePath=/ootd` |
| 数据库 | Neon PostgreSQL（`DATABASE_URL`） |
| 对象存储 | 腾讯云 COS（衣橱图片上传） |
| 根站 | `https://www.meetu.online/` 仍为旧项目，**互不影响** |

## 2. 架构

```text
浏览器
  └─ https://www.meetu.online/ootd/*
         │
         ▼
      nginx (location ^~ /ootd)
         │  proxy_pass
         ▼
   Next.js :3002  (UI + BFF API，basePath=/ootd)
         │
         ├─ Neon PostgreSQL（Prisma + serverless driver）
         ├─ 腾讯云 COS（图片上传）
         └─ LLM / 生图 / Embedding API（OpenAI 兼容或 Vertex）
```

- 浏览器只访问 Next；API 走 `/ootd/api/*`。
- **浏览模式**：未验证访问码时只读（历史对话、衣橱）；验证后可发消息、上传、改数据。

## 3. 前置条件

- Node.js ≥ 20（建议 nvm 管理）
- pnpm ≥ 9
- pm2
- nginx（已有 `meetu.online` HTTPS 证书）

```bash
node -v
pnpm -v
pm2 -v
nginx -t
```

## 4. 首次部署

### 4.1 拉代码

```bash
cd /srv
git clone <your-repo-url> ootd-agent
cd ootd-agent
```

### 4.2 安装依赖

服务器上通常**不要**走本地代理（`127.0.0.1:7897` 等），否则 `pnpm i` 会 `ECONNREFUSED`：

```bash
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
pnpm install
```

### 4.3 配置环境变量

复制模板并编辑（`.env` 已在 `.gitignore`，**勿提交**）：

```bash
cp deploy/env.production.example .env   # 若有模板
chmod 600 .env
```

必填项见 [§5 环境变量](#5-环境变量)。

### 4.4 数据库迁移

```bash
pnpm db:generate
pnpm db:migrate:neon
```

若 `prisma migrate deploy` 直连失败但 Neon serverless 可用，以 `db:migrate:neon` 为准。

### 4.5 构建

```bash
NODE_OPTIONS='--max-old-space-size=1536' pnpm build
```

机器内存约 1.6G 时建议限制 Node 堆，避免 OOM。

### 4.6 启动 pm2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### 4.7 配置 nginx

在 `meetu.online` 的 `server` 块中增加（与 `/video_bd` 同级）：

```nginx
location ^~ /ootd {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    client_max_body_size 50m;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    add_header X-App ootd-agent always;
}
```

重载：

```bash
nginx -t && nginx -s reload
```

## 5. 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon PostgreSQL 连接串 |
| `OWNER_CLIENT_ID` | ✅ | 单用户模式的 clientId，与库里 `ClientProfile.id` 一致 |
| `NEXT_PUBLIC_OWNER_CLIENT_ID` | ✅ | 前端路由用，与 `OWNER_CLIENT_ID` 相同 |
| `ACCESS_CODE` | ✅ | 浏览模式解锁用的访问码 |
| `ACCESS_SESSION_SECRET` | ✅ | ≥32 字符，用于 session cookie 签名 |
| `COS_SECRET_ID` / `COS_SECRET_KEY` | ✅ | 腾讯云 COS |
| `COS_BUCKET` / `COS_REGION` | ✅ | 桶名与地域 |
| `COS_KEY_PREFIX` |  | 对象 key 前缀，如 `shows/` |
| `COS_PUBLIC_BASE_URL` | ✅ | 公网访问根 URL |
| `OPENAI_API_KEY` | ✅* | OpenAI 兼容文本（或配 `LLM_VENDOR` + 对应 key） |
| `OPENAI_BASE_URL` |  | 如 Moonshot：`https://api.moonshot.cn/v1` |
| `LLM_VENDOR` |  | 如 `kimi` |
| `IMAGE_VENDOR` |  | 如 `ark` / `minimax` |
| `ARK_API_KEY` | ✅* | 火山方舟生图（`IMAGE_VENDOR=ark` 时） |
| `EMBEDDING_VENDOR` |  | 如 `bytedance` |
| `NODE_ENV` |  | 生产设为 `production` |

\* 按实际选用的 LLM / 生图 / 向量供应商配置，详见 `design/openai_compatible_llm.md`。

示例（**请替换为真实值**）：

```bash
DATABASE_URL=postgresql://...
OWNER_CLIENT_ID=your-client-uuid
NEXT_PUBLIC_OWNER_CLIENT_ID=your-client-uuid
ACCESS_CODE=your-access-code
ACCESS_SESSION_SECRET=at-least-32-characters-long-secret

COS_SECRET_ID=...
COS_SECRET_KEY=...
COS_BUCKET=ootd-xxxxxxxx
COS_REGION=ap-nanjing
COS_KEY_PREFIX=shows/
COS_PUBLIC_BASE_URL=https://ootd-xxxxxxxx.cos.ap-nanjing.myqcloud.com

OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.moonshot.cn/v1
LLM_VENDOR=kimi
IMAGE_VENDOR=ark
ARK_API_KEY=ark-...
EMBEDDING_VENDOR=bytedance
```

## 6. 子路径 `/ootd` 细节

`next.config.ts`：

- `basePath: "/ootd"`
- `NEXT_PUBLIC_BASE_PATH: "/ootd"`

注意：

- `next/link` 会自动加前缀；**原生 `fetch('/api/...')` 不会**。
- 统一用 `lib/utils.ts` 的 `withBasePath()`。
- 本地 `public/logo.png` 经 `next/image` 优化时，须用 `LOGO_SRC`（已带 basePath），否则线上 400。

改 `basePath` 时必须同步：`next.config.ts`、nginx `location`、所有 `withBasePath` 调用。

## 7. 进程管理（pm2）

配置文件：仓库根 [`ecosystem.config.cjs`](../ecosystem.config.cjs)

| 进程名 | 作用 | 端口 |
|---|---|---|
| `ootd-agent` | `next start -p 3002 -H 127.0.0.1` | 3002 |

常用命令：

```bash
pm2 list
pm2 logs ootd-agent
pm2 restart ootd-agent
pm2 save
```

pm2 配置里已清空代理环境变量，避免继承失效的 `HTTP_PROXY`。

## 8. 更新部署

```bash
cd /srv/ootd-agent
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy

git pull
pnpm install
pnpm db:generate
pnpm db:migrate:neon    # 有 pending 迁移时
NODE_OPTIONS='--max-old-space-size=1536' pnpm build
pm2 restart ootd-agent
```

## 9. 验证

```bash
# 本机（不走代理）
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy

curl -s -o /dev/null -w 'page:%{http_code}\n' http://127.0.0.1:3002/ootd
curl -s http://127.0.0.1:3002/ootd/api/access/status

# 经 nginx（HTTPS）
curl -sk -o /dev/null -w 'https:%{http_code}\n' https://www.meetu.online/ootd
curl -sk https://www.meetu.online/ootd/api/access/status
```

浏览模式应能拉取历史数据：

```bash
curl -sk -H 'X-Client-ID: <OWNER_CLIENT_ID>' \
  https://www.meetu.online/ootd/api/conversations
```

## 10. 常见问题

### 10.1 `pnpm i` 报 `ECONNREFUSED 127.0.0.1:7897`

终端继承了本地代理。执行：

```bash
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
pnpm install
```

或在 `~/.bashrc` 末尾 `unset` 这些变量。

### 10.2 API 500：`Cannot find module '@prisma/client-runtime-utils'`

pnpm 严格隔离下 Prisma 运行时依赖未提升。仓库已在 `package.json` 显式声明：

```json
"@prisma/client-runtime-utils": "7.8.0"
```

修复后执行 `pnpm install && pnpm db:generate && pm2 restart ootd-agent`。

### 10.3 Logo / 静态图不显示

`basePath` 部署下 `next/image` 请求 `/logo.png` 会 404/400。使用 `LOGO_SRC`（`lib/utils.ts`），不要写死 `/logo.png`。

### 10.4 浏览模式没有历史对话

1. 看 `pm2 logs ootd-agent` 是否有 Prisma 报错（§10.2）。
2. 确认 `OWNER_CLIENT_ID` 与数据库里 `ClientProfile.id` 一致。
3. 确认 `/ootd/api/conversations` 返回 200。

### 10.5 构建 OOM

```bash
NODE_OPTIONS='--max-old-space-size=1536' pnpm build
```

必要时临时加 swap 或在本机构建后同步 `.next`（不推荐长期使用）。

## 11. 安全

- `.env` 权限：`chmod 600 .env`
- 勿将 `.env`、COS 密钥、API Key 提交到 git
- `ACCESS_CODE` / `ACCESS_SESSION_SECRET` 定期轮换后 `pm2 restart ootd-agent`

## 12. 相关文档

- LLM 后端切换：`design/openai_compatible_llm.md`
- 访问控制行为：`server/auth/access.ts`
- E2E 验收：`design/features/2026-08-31-e2e-acceptance-test-plan.md`
