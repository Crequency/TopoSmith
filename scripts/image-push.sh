#!/usr/bin/env bash
#
# 构建并推送 TopoSmith 镜像到 Harbor。
#
#   scripts/image-push.sh              # 用 package.json 的版本号 + latest 推送
#   scripts/image-push.sh 0.2.0        # 指定 tag
#   HARBOR_PROJECT=other scripts/image-push.sh
#
# 默认推到 **crequency** 项目（不是 dynecloud）：
#   registry.services.nimatattic.net/crequency/toposmith
#
# 前置：
#   1. 已登录：docker login registry.services.nimatattic.net
#   2. 账号对该项目有推送权限（本机 ~/.docker/config.json 里已有登录记录时不必重复登录）
#
# 注意：容器端口是 **41006 = 开发端口 31006 + 10000**（见 Caddyfile / Dockerfile），
# 与开发服务器不抢端口。

set -euo pipefail

HARBOR_HOST="${HARBOR_HOST:-registry.services.nimatattic.net}"
HARBOR_PROJECT="${HARBOR_PROJECT:-crequency}"
IMAGE_NAME="${IMAGE_NAME:-toposmith}"
PUSH_LATEST="${PUSH_LATEST:-1}"

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
TAG="${1:-$VERSION}"
LOCAL_IMAGE="${IMAGE_NAME}:local"
REMOTE_IMAGE="${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}"

echo ">>> 构建 ${LOCAL_IMAGE}（多阶段：Node 构建 → Caddy 静态服务）"
docker build -t "$LOCAL_IMAGE" .

echo ">>> 打标签 ${REMOTE_IMAGE}:${TAG}"
docker tag "$LOCAL_IMAGE" "${REMOTE_IMAGE}:${TAG}"

echo ">>> 推送 ${REMOTE_IMAGE}:${TAG}"
docker push "${REMOTE_IMAGE}:${TAG}"

if [ "$PUSH_LATEST" = "1" ]; then
	echo ">>> 推送 ${REMOTE_IMAGE}:latest"
	docker tag "$LOCAL_IMAGE" "${REMOTE_IMAGE}:latest"
	docker push "${REMOTE_IMAGE}:latest"
fi

echo
echo ">>> 完成。拉取并运行："
echo "    docker run --rm -p 41006:41006 ${REMOTE_IMAGE}:${TAG}"
echo "    → http://127.0.0.1:41006/"
