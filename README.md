# XiaomiTokenMonitor

小米 MiMo Token 用量监控。扫码登录后自动续约 `serviceToken`，提供网页面板和 JSON 用量接口。适合家里 NAS / 小主机用 Docker 部署，局域网访问。

## 功能

- **扫码登录** — 网页展示二维码，小米手机 / 平板扫码
- **自动续约** — 按 `serviceToken` 过期时间提前约 5 分钟刷新
- **用量面板** — 查看 Token 用量与认证状态
- **JSON 接口** — `GET /usage` 给模板或脚本用
- **Docker 部署** — 单容器，数据卷持久化 Cookie

## 一键部署（推荐）

不需要克隆仓库，拉官方镜像即可：

```bash
docker run -d \
  --name xiaomi-token-monitor \
  --restart unless-stopped \
  -p 9990:9990 \
  -v xiaomi-token-data:/data \
  ghcr.io/keiraee/xiaomi-token-monitor:1.0.0
```

或用 compose：

```bash
curl -fsSL https://raw.githubusercontent.com/keiraee/XiaomiTokenMonitor/v1.0.0/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

浏览器打开：

```text
http://NAS的IP:9990/
```

首次进入扫码登录。Cookie 存在 Docker 数据卷 `xiaomi-token-data` 里，**删不删本机源码目录都不影响容器**。

常用命令：

```bash
docker logs -f xiaomi-token-monitor
docker restart xiaomi-token-monitor
docker stop xiaomi-token-monitor
```

> 首次发布后若 `docker pull` 提示无权限，到 GitHub → Packages → `xiaomi-token-monitor` → Package settings → Change visibility → Public。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `9990` | 容器内监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `/data` | Cookie / 日志目录 |

改宿主机端口示例：

```bash
docker run -d --name xiaomi-token-monitor --restart unless-stopped \
  -p 9992:9990 \
  -v xiaomi-token-data:/data \
  ghcr.io/keiraee/xiaomi-token-monitor:1.0.0
```

## 从源码构建（开发用）

```bash
git clone https://github.com/keiraee/XiaomiTokenMonitor.git
cd XiaomiTokenMonitor
docker compose -f docker-compose.build.yml up -d --build
```

本地 Node 开发：

```bash
npm install
npm run build
npm start
```

## 接口

| 地址 | 说明 |
|------|------|
| `http://host:9990/` | 网页面板 |
| `http://host:9990/usage` | JSON 用量 |
| `http://host:9990/api/status` | 登录与续约状态 |
| `http://host:9990/api/health` | 健康检查 |

## 模板配置示例

```javascript
({
  request: {
    url: "http://NAS的IP:9990/usage",
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  },

  extractor: function (response) {
    const item = response?.data?.usage?.items?.find(
      (i) => i.name === "plan_total_token",
    );
    const percent = response?.data?.usage?.percent || 0;

    return {
      isValid: true,
      used: (item?.used || 0) / 100000000,
      total: (item?.limit || 0) / 100000000,
      remaining: ((item?.limit || 0) - (item?.used || 0)) / 100000000,
      unit: "Credits",
      extra: `${(percent * 100).toFixed(1)}%`,
    };
  },
});
```

## 数据

默认挂载命名卷 `xiaomi-token-data`（容器内 `/data`）：

- `cookies.json` — 登录 Cookie
- `meta.json` — User-Agent 等元数据
- `server.log` — 服务日志

请勿分享 `cookies.json`。

## 认证机制

```text
扫码登录
  → 保存 passToken / serviceToken
请求用量
  → serviceToken 快过期？
      → 用 passToken 走 SSO 静默换新票
      → 失败则面板提示重新扫码
```

## 注意

- 面板不再设额外密码；能访问端口的人可以看到登录页，请放在可信局域网。
- `passToken` 失效后需要重新扫码。
- 镜像发布在 GitHub Container Registry：`ghcr.io/keiraee/xiaomi-token-monitor`
