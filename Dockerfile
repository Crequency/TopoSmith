# syntax=docker/dockerfile:1
#
# TopoSmith 静态站点镜像
#
#   构建阶段：Node 22（与 CI 一致）+ pnpm（按 package.json 的 packageManager 取版本）
#   运行阶段：官方 Caddy 2 alpine，只做静态文件服务
#
# 端口：**41006 = 开发服务器端口 31006 + 10000**（见 Caddyfile 的说明与 README「容器化」）。
#
# 用法：
#   docker build -t toposmith:local .
#   docker run --rm -p 41006:41006 toposmith:local          # 打开 http://127.0.0.1:41006/
#   子路径部署：docker build --build-arg BASE_PATH=/TopoSmith/ -t toposmith:sub .
#
# 说明：这里不做 HTTPS —— 容器只监听一个高位端口，证书与 TLS 交给外层反向代理/网关；
# 若要直连公网，把 Caddyfile 里的站点地址从 `:41006` 换成域名即可（Caddy 自动申请证书）。

# ────────────────────────────── 构建阶段 ──────────────────────────────
FROM node:22-alpine AS build

# corepack 按根 package.json 的 packageManager 字段准备 pnpm，版本与本地/CI 完全一致。
# COREPACK_ENABLE_DOWNLOAD_PROMPT=0：首次下载 pnpm 时不弹交互式确认（构建里没有 TTY，
# 否则会出现"本地能构建、Docker 里卡住"这种最难查的问题）
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# 先只拷依赖清单：改源码不会让"装依赖"这一层缓存失效（这是镜像构建里最贵的一层）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schema/package.json packages/schema/
COPY packages/catalog/package.json packages/catalog/
COPY packages/engine/package.json packages/engine/
COPY apps/web/package.json apps/web/
# 需要 BuildKit（Docker 23+ 默认开启）：把 pnpm store 挂成缓存，重建时不用重复下载。
# 挂载点必须是 pnpm **真正的** store 目录（root 用户下的默认值），否则这层缓存是摆设
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
	pnpm install --frozen-lockfile

# 再拷源码并构建（`pnpm build` = tsc --noEmit && vite build）
COPY . .
# 站点挂在根的 `/`；部署到子路径时用 --build-arg BASE_PATH=/xxx/ 覆盖（Vite 的 base 取自它）
ARG BASE_PATH=/
ENV BASE_PATH=${BASE_PATH}
RUN pnpm build

# ────────────────────────────── 运行阶段：Caddy ──────────────────────────────
FROM caddy:2-alpine AS runtime

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv

# 只监听高位端口，因此不需要 root：换成非特权 uid。
# /data 与 /config 是 Caddy 的运行时目录（配置里已关掉 persist_config，只留必要写权限）。
RUN chown -R 1000:1000 /srv /data /config
USER 1000:1000

# 端口 = 开发端口 + 10000；运行时可用 -e PORT=xxxx 覆盖（Caddyfile 读的是同一个变量）
EXPOSE 41006

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget -q --spider "http://127.0.0.1:${PORT:-41006}/" || exit 1
