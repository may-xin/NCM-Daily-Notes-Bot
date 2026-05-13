# NCM Daily Notes Bot

网易云音乐扫码登录 + 文本笔记自动发布。通过 Docker 单容器部署，内置 NeteaseCloudMusicApiEnhanced 后端，无需额外服务。

## 架构

```
┌─────────────────────────────────────────┐
│  Docker Container (ncm-dnb)             │
│                                         │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │  Frontend    │  │  API (api-       │  │
│  │  :8080       │──│  enhanced) :3000 │  │
│  │  server.js   │  │  app.js          │  │
│  └─────────────┘  └──────────────────┘  │
│        │                   │            │
│        └─────── /app/data ─┘            │
└─────────────────────────────────────────┘
```

- **Frontend** (`server.js`): Express 网页界面，扫码登录 + 发布文本笔记 + 每日定时发送
- **API** ([NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)): 网易云音乐 API 增强版，提供二维码登录、分享资源等接口
- 单容器内两个 Node.js 进程，通过 HTTP localhost 通信

## 功能

- 扫码登录网易云音乐
- 手动发布文本笔记（`type=noresource`）
- 每日 03:00 定时自动发布（可配置内容）
- 最近 10 条发送历史

## 快速部署

### Docker Compose（推荐）

```bash
git clone https://github.com/may-xin/NCM-Daily-Notes-Bot.git
cd NCM-Daily-Notes-Bot

# 设置 session 密钥（可选）
export SESSION_SECRET=your-random-secret

docker compose up -d
```

访问 `http://<你的服务器IP>:8080`

### Docker 直接运行

```bash
docker run -d \
  --name ncm-dnb \
  -p 8080:8080 \
  -v $(pwd)/data:/app/data \
  -e SESSION_SECRET=your-random-secret \
  -e TZ=Asia/Shanghai \
  weng30525/ncm-dnb:latest
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NCM_API_BASE` | `http://127.0.0.1:3000` | API 服务地址（容器内不需修改） |
| `SESSION_SECRET` | `dev-secret-change-me` | Express Session 密钥，生产环境务必修改 |
| `TZ` | `Asia/Shanghai` | 时区，影响定时任务执行时间 |
| `HOST` | `0.0.0.0` | 前端监听地址 |
| `PORT` | `8080` | 前端监听端口 |

## 数据持久化

`/app/data` 目录挂载到宿主机，包含：

| 文件 | 内容 |
|------|------|
| `auth.json` | 登录 Cookie |
| `schedule.json` | 定时发布内容 |
| `history.json` | 发送历史记录 |

## 镜像地址

```
docker pull weng30525/ncm-dnb:latest
```

[Docker Hub](https://hub.docker.com/r/weng30525/ncm-dnb)

## 依赖项目

本项目 API 后端使用 [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)（版本 4.30.2），在 Docker 构建时自动 clone 并安装。

## 开发

```bash
# 本地开发需要先启动 API
git clone https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced.git
cd api-enhanced && npm install && node app.js &

# 启动前端
cd ..
npm install
npm start
```

## License

MIT
