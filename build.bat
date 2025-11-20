@echo off
REM PandOCR Docker 构建脚本 (Windows)

echo 🚀 开始构建 PandOCR Docker 镜像...

REM 检查 Docker 是否运行
docker info >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker 未运行，请先启动 Docker Desktop
    pause
    exit /b 1
)

REM 检查环境变量文件
if not exist "env.txt" (
    echo ⚠️  env.txt 不存在，创建默认配置...
    (
        echo API_IMAGE_TAG_SUFFIX=latest-offline
        echo VLM_BACKEND=vllm
        echo VLM_IMAGE_TAG_SUFFIX=latest-offline
    ) > env.txt
)

echo 📦 拉取 PaddleOCR-VL 基础镜像...
docker compose --env-file env.txt pull

echo 🔨 构建前端服务镜像...
docker compose --env-file env.txt build pandocr-web

echo ✅ 构建完成！
echo.
echo 📋 下一步操作：
echo   启动服务: docker compose --env-file env.txt up -d
echo   查看日志: docker compose logs -f
echo   停止服务: docker compose down
echo.
pause

