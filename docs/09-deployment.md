# 部署与打包

> 本文是**部署相关的唯一事实来源**：静态托管、GitHub Pages、容器镜像、端口策略、
> 镜像仓库与推送、以及容器里踩过的坑。README 只保留三行摘要 + 链接。

## 1. 形态总览

构建产物 `apps/web/dist` 是纯静态文件，任何静态服务器都能托管。**零后端**不是权宜之计，
而是产品定位的一部分：可离线、可内网部署、可嵌进文档站，没有服务器成本，也就没有
"服务停了拓扑打不开"的风险（`docs/00-overview.md` §2）。

| 形态 | 产物来源 | 基路径 | 说明 |
|---|---|---|---|
| 本地预览 | `pnpm build` + `pnpm preview` | `/` | 最快的一次自检 |
| 任意静态托管 | `apps/web/dist` | 挂在哪就用哪个 | 见 §2 |
| GitHub Pages | CI 的 `deploy` 任务 | `configure-pages` 给出的 `base_path` | 见 §3 |
| 容器（Caddy） | `Dockerfile` | 根路径，或用 `--build-arg BASE_PATH=` | 见 §4–§8 |
| 自建 Harbor | 同上镜像 | 同上 | 见 §8 |

## 2. 静态托管与子路径

**基路径必须与访问路径一致**，否则资源与 favicon 404、整站白屏。基路径由构建期环境变量
`BASE_PATH` 注入（`apps/web/vite.config.ts` 的 `base`）：

```bash
BASE_PATH=/TopoSmith/ pnpm build      # 产物里的资源与图标都带上该前缀
BASE_PATH=/TopoSmith/ pnpm preview    # 用真实子路径本地预览
```

代码里**不允许写绝对路径** `/xxx`：`index.html` 用 Vite 的 `%BASE_URL%`，组件里用
`import.meta.env.BASE_URL`。

## 3. GitHub Pages

`.github/workflows/ci.yml` 的 `deploy` 任务：`verify` 通过后，用 `actions/configure-pages`
输出的 `base_path` 作为 `BASE_PATH` 构建，再经 `upload-pages-artifact` + `deploy-pages` 发布。
首次运行会通过 `enablement: true` 自动开通 Pages。线上地址见仓库首页与 README 顶部徽章。

## 4. 容器：多阶段镜像

`Dockerfile` 两段式：

1. **构建阶段** `node:22-alpine`（与 CI 的 Node 版本一致）+ corepack 按 `package.json`
   的 `packageManager` 取 pnpm + `pnpm install --frozen-lockfile` + `pnpm build`；
2. **运行阶段** `caddy:2-alpine`，只做静态文件服务 —— **最终镜像里没有 Node、没有 node_modules**。

镜像特点：以非特权 uid（1000）运行、带 `HEALTHCHECK`、约 90 MB。
`--build-arg BASE_PATH=/xxx/` 可产出子路径版本。

两处构建期细节（踩过）：

- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`：否则首次下载 pnpm 会等交互式确认，在无 TTY 的
  构建里表现为"卡住"；
- 依赖层的 BuildKit 缓存挂载点必须是 pnpm **真正的** store 目录（root 下
  `/root/.local/share/pnpm/store`），挂错地方等于没有缓存。

## 5. 端口策略

**容器端口 = 开发服务器端口 + 10000：`31006 → 41006`**（`Caddyfile` 读 `PORT`，
镜像的 `EXPOSE` / `HEALTHCHECK` 读同一个变量，改一处即可）。

为什么不直接复用 31006：宿主机上开发服务器通常就占着它；`+10000` 让"看到 41006 就知道
这是哪个项目的哪个服务"，也不会撞车。想在别的宿主端口访问，用端口映射（§6），**不必改镜像**。

## 6. 运行：docker run 与 compose

```bash
# 直接跑
docker run --rm -p 41006:41006 toposmith:local          # http://127.0.0.1:41006/

# 用仓库自带的编排（推荐：宿主端口可覆盖）
docker compose up -d --build                  # 本地构建并起（宿主 41006）
TOPOSMITH_PORT=8080 docker compose up -d      # 映射到任意宿主端口
docker compose pull && docker compose up -d   # 直接跑 Harbor 上的镜像
docker compose down
```

`docker-compose.yml` 里端口写成 `"${TOPOSMITH_PORT:-41006}:41006"`：**右侧是容器内端口
（固定），左侧随便换**。映射到 31006 会与开发服务器抢端口。

## 7. Caddyfile 的四条约定

- **`/assets/*` 只认真实文件**，缺失就 404，**不参与 SPA 回退** —— 否则缺失的 JS 会返回
  `index.html`（200 + `text/html`），浏览器报 `Unexpected token '<'`，极难定位。
  实现上必须用 `handle` 分支：Caddy 的 `try_files` **不接受命名匹配器当参数**
  （`try_files @assets {path}` 会被当成"试两个文件名"）。
- **带内容哈希的资源长缓存**（`immutable`，一年），**入口与清单不缓存**（否则发版后用户
  会拿着旧 `index.html` 去请求已删除的资源）。
- **容器内不做 TLS**：只监听一个高位端口，证书交给外层反向代理/网关；要直连公网就把
  `:41006` 换成域名，Caddy 自动申请证书。
- 其余路径 `try_files {path} /index.html`，深链接与刷新可用。

### 已知陷阱：宿主代理会让 HEALTHCHECK 误报

Docker 会把宿主/守护进程的代理配置注入容器（`HTTP_PROXY=…`，同时给
`NO_PROXY=localhost,127.0.0.1,::1`），而 `caddy:2-alpine` 里的 busybox `wget`
**不认 `NO_PROXY`** —— 镜像自带的探针于是把 `http://127.0.0.1:41006/` 发给代理、代理回
`502 Bad Gateway`，容器永远停在 `health: starting`，**而宿主 `curl` 却是 200**（很有迷惑性）。

- 现在 `docker-compose.yml` 里清空了四个代理变量（静态站点不出网，安全）→ `health → healthy`；
- 治本的一行改动在 `Dockerfile`：探针加 `-Y off`，或改用 `nc -z 127.0.0.1 ${PORT:-41006}`
  （不经 HTTP，最干净）。**当前保持不改镜像**，因此只保证 compose 路径下探针正常。

## 8. 镜像仓库与推送

镜像发布在自建 Harbor 的 **crequency** 项目（不是 dynecloud）：

```
registry.services.nimatattic.net/crequency/toposmith:0.1.0
registry.services.nimatattic.net/crequency/toposmith:latest
```

```bash
docker login registry.services.nimatattic.net     # 首次
scripts/image-push.sh                             # 构建 + 推送（tag = package.json 版本 + latest）
scripts/image-push.sh 0.2.0                       # 指定 tag
HARBOR_PROJECT=other scripts/image-push.sh        # 换项目
```

镜像 tag 策略：**版本号（不可变）+ `latest`（便利）**。已发布的 `0.1.0` 摘要为
`sha256:61a13c4c…`，从 registry 回拉后运行验证过（入口 200、缺失资源 404）。

## 9. CI 里与部署相关的两个任务

- `verify`：类型检查、两套单测、生产构建；
- `image`：**真的构建镜像并起容器冒烟**（`push: false`，不推 registry）—— 等 Caddy 在
  `:41006` 应答，核对入口 200 + `text/html`、深链接回退、缺失 `/assets/*` 是 404、
  以及入口不缓存 / 哈希资源 `immutable`。需要 `docker/setup-buildx-action`
  （Dockerfile 的缓存挂载需要 docker-container 驱动）。

**未接入**：CI 不推送镜像到 Harbor（需要把凭据放进 GitHub Secrets 并在流程里登录）；
目前推送由本机 `scripts/image-push.sh` 完成。
