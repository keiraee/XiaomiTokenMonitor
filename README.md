# XiaomiTokenMonitor

小米 MiMo Token 用量监控。扫码登录后自动续约 `serviceToken`，提供网页面板和 JSON 用量接口。适合家里 NAS / 小主机用 Docker 部署，局域网访问。

## 功能

- **扫码登录** — 网页展示二维码，小米手机 / 平板扫码
- **自动续约** — 按 `serviceToken` 过期时间提前约 5 分钟刷新
- **用量面板** — 查看 Token 用量与认证状态
- **JSON 接口** — `GET /usage` 给模板或脚本用
- **Docker 部署** — 单容器，数据卷持久化 Cookie

## 快速开始（Docker）

```bash
docker compose up -d --build
```

浏览器打开：

```text
http://NAS的IP:9990/
```

首次进入会要求扫码登录。Cookie 保存在 `./data/`。

常用命令：

```bash
docker compose logs -f
docker compose restart
docker compose down
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `9990` | 容器内监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `/data` | Cookie / 日志目录 |

改宿主机端口示例：

```yaml
ports:
  - "18080:9990"
```

## 本地开发（可选）

```bash
npm install
npm run build
npm start
```

默认监听 `0.0.0.0:9990`，数据写到项目下 `data/`。

前端热更新：

```bash
npm run dev
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

## 数据文件

挂载目录 `./data`（容器内 `/data`）：

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

- 面板本身不再设额外密码；能访问端口的人可以看到登录页。请放在可信局域网。
- 已移除 Windows 弹窗通知、密码 / 短信登录、Playwright 浏览器登录。
- `passToken` 失效后需要重新扫码。
