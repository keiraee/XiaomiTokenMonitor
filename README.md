# XiaomiTokenMonitor

小米平台 Token 用量监控工具。通过本地代理服务自动管理 SSO 登录，提供免鉴权的用量查询接口。

## 功能特性

- **自动 SSO 管理** — passToken 有效期内（30天）自动无头刷新 serviceToken，无需人工干预
- **智能认证** — serviceToken 过期时静默刷新，仅 passToken 过期才弹浏览器登录
- **真实浏览器模拟** — 使用 Playwright 无头浏览器完成 SSO 流程，保持 UA 一致性
- **定时刷新** — 每12小时自动刷新 Cookie
- **系统通知** — 登录失败、刷新成功/失败时弹出 Windows 通知
- **完整日志** — 所有请求、认证、刷新操作记录到 `server.log`
- **一键操作** — 菜单化管理，启动/停止/重启/查看状态/查看日志
- **开机自启** — 支持 Windows 计划任务自动启动

## 快速开始

### 1. 克隆项目

```bash
git clone <repo-url>
cd XiaomiTokenMonitor
```

### 2. 安装依赖

```bash
npm install
npx playwright install chromium
```

### 3. 启动服务

双击 `main.bat`，选择 `[1] Start Service`

首次运行会弹出浏览器，完成小米 SSO 登录后浏览器自动关闭，服务启动。

## 使用方法

双击 `main.bat` 打开菜单：

```
==========================================
  XiaomiTokenMonitor
==========================================

  [1] Start Service        — 启动服务（后台隐藏运行）
  [2] Stop Service         — 停止服务
  [3] Restart Service      — 重启服务
  [4] View Status          — 查看运行状态（PID、端口、地址）
  [5] View Logs            — 查看最近20条日志
  [6] Re-login             — 重新登录（刷新 Cookie）
  [7] Install Auto-Start   — 设置开机自启（需管理员权限）
  [8] Uninstall Auto-Start — 移除开机自启
  [0] Exit                 — 退出菜单
```

## 接口地址

| 地址 | 说明 |
|------|------|
| `http://localhost:9999` | 网页面板（实时查看数据） |
| `http://localhost:9999/usage` | JSON 数据接口（免鉴权） |

## 模板配置

将请求地址改为本地代理接口：

```javascript
({
  request: {
    url: "http://localhost:9999/usage",
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
      remaining: [(item?.limit || 0) - (item?.used || 0)] / 100000000,
      unit: "亿 Credits",
      extra: `${(percent * 100).toFixed(1)}%`,
    };
  },
});
```

## 项目结构

```
XiaomiTokenMonitor/
├── main.bat            # 入口菜单（唯一需要双击的文件）
├── src/
│   ├── server.js       # 主服务 + 定时刷新
│   ├── auth.js         # Playwright 浏览器登录 + 无头刷新
│   ├── notify.js       # Windows 系统通知
│   ├── notify.ps1      # 通知脚本
│   └── logger.js       # 日志模块
├── package.json
├── .gitignore
└── README.md
```

运行时自动生成（已 gitignore）：
- `cookies.json` — 登录凭证
- `meta.json` — User-Agent 配置
- `server.pid` — 进程 PID
- `server.log` — 运行日志

## 认证机制

```
serviceToken 过期（session级）
        ↓
   无头浏览器刷新（静默，用 passToken 换新 serviceToken）
        ↓ 成功
   继续运行，无感知
        ↓ 失败
   passToken 已过期（30天）→ 弹浏览器手动登录
```

- **passToken** — 有效期30天，用于自动换取 serviceToken
- **serviceToken** — session 级，过期后自动无头刷新
- **User-Agent** — 登录时随机生成，会话内保持一致

## 常见问题

**Q: 端口被占用？**
修改 `src/server.js` 中的 `PORT` 变量。

**Q: 登录超时？**
网络慢时页面加载可能超过60秒，但会继续等待你完成登录（最长5分钟）。

**Q: 没收到通知？**
检查 Windows 设置 → 系统 → 通知 是否开启，专注助手是否关闭。

**Q: 如何查看日志？**
双击 `main.bat` → 选择 `[5] View Logs`，或直接打开 `server.log` 文件。

**Q: 多久需要手动登录一次？**
passToken 有效期30天。在有效期内，serviceToken 过期会自动无头刷新，无需手动操作。超过30天需要重新登录一次。
