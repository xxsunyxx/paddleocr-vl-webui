#!/bin/bash

# PandOCR Docker 构建脚本

set -e

echo "🚀 开始构建 PandOCR Docker 镜像..."

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker"
    exit 1
fi

# 检查 NVIDIA GPU 支持
if ! docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu22.04 nvidia-smi > /dev/null 2>&1; then
    echo "⚠️  警告: GPU 支持未检测到，PaddleOCR-VL 服务可能无法正常运行"
    read -p "是否继续? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 检查环境变量文件
if [ ! -f "env.txt" ]; then
    echo "⚠️  env.txt 不存在，创建默认配置..."
    cat > env.txt << EOF
API_IMAGE_TAG_SUFFIX=latest-offline
VLM_BACKEND=vllm
VLM_IMAGE_TAG_SUFFIX=latest-offline
EOF
fi

echo "📦 拉取 PaddleOCR-VL 基础镜像..."
docker compose --env-file env.txt pull

echo "🔨 构建前端服务镜像..."
docker compose --env-file env.txt build pandocr-web

echo "✅ 构建完成！"
echo ""
echo "📋 下一步操作："
echo "  启动服务: docker compose --env-file env.txt up -d"
echo "  查看日志: docker compose logs -f"
echo "  停止服务: docker compose down"

