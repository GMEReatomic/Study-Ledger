# 一页工作台 · 纯静态站点镜像
# Build:  docker build -t yipan-toolbox .
# Run:    docker run --rm -p 8000:8000 yipan-toolbox
FROM python:3.12-alpine

WORKDIR /app

# 复制全部静态文件。项目不需要 Node 构建步骤。
COPY . .

EXPOSE 8000

# 通过 localhost / 容器映射端口访问，Web Crypto 与 Service Worker 才能正常工作。
CMD ["python", "-m", "http.server", "8000", "--bind", "0.0.0.0"]
