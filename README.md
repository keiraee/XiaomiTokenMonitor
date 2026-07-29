# XiaomiTokenMonitor

小米平台 Token 用量监控工具。通过本地代理服务自动管理 SSO 登录，提供用量查询接口。

## 功能特性

- **自动 SSO 管理** — serviceToken 过期时自动尝试无头刷新
- **智能认证** — 无头刷新失败后自动打开浏览器重新登录
- **浏览器登录** — 使用 Playwright 完成小米平台 SSO 流程
- **自动刷新** — 按 `api-platform_serviceToken` 的实际 `expires` 提前 5 分钟刷新；官方未提供 expires 时按 24 小时兜底
- **系统通知** — 登录、刷新失败或成功时发送 Windows 通知
- **完整日志** — 服务日志和安装器操作日志分开记录
- **一键管理** — 安装、启动、停止、重启、状态、日志、登录和卸载
- **开机自启** — 支持通过 Windows 计划任务自动启动

## 快速开始

### 一键安装

在 Windows PowerShell 中执行：

~~~powershell
irm https://raw.githubusercontent.com/keiraee/XiaomiTokenMonitor/main/install.ps1 | iex
~~~

命令执行后会打开管理菜单。

### 首次安装

1. 选择 <code>[1] 安装 / 更新</code>。
2. 选择安装目录，或直接使用默认目录。
3. 设置服务端口，或直接使用默认端口 <code>9999</code>。
4. 等待安装完成。
5. 服务启动后，在弹出的浏览器中完成小米 SSO 登录。

安装脚本会自动处理 Node.js、项目文件、npm 依赖和 Playwright 浏览器的安装，不需要手动安装 Git。

默认安装目录：

~~~text
C:\Users\当前用户名\XiaomiTokenMonitor
~~~

安装完成后，管理脚本位于安装目录下的 <code>install.ps1</code>。

## 使用方法

运行一键命令后会进入管理菜单：

~~~text
==========================================
  XiaomiTokenMonitor - 小米Token用量监控
==========================================

  [1] 安装 / 更新
  [2] 启动服务
  [3] 停止服务
  [4] 重启服务
  [5] 查看状态
  [6] 查看日志
  [7] 重新登录
  [8] 设置开机自启
  [9] 移除开机自启
  [U] 卸载
  [0] 退出
~~~

### 启动服务

选择 <code>[2] 启动服务</code>。

服务启动后，打开管理页面查看当前状态和用量数据。

### 停止或重启服务

- 选择 <code>[3] 停止服务</code> 停止服务。
- 选择 <code>[4] 重启服务</code> 重启服务。

### 查看状态

选择 <code>[5] 查看状态</code>，可以查看服务状态、PID、端口、地址和运行时间。

### 查看日志

选择 <code>[6] 查看日志</code>，然后选择日志类型：

- 服务日志：<code>server.log</code>
- 操作日志：<code>xtm.log</code>

### 重新登录

选择 <code>[7] 重新登录</code>。

脚本会清除旧 Cookie 并打开浏览器。完成小米账号登录后，浏览器自动关闭并保存新的登录信息。

### 设置开机自启

选择 <code>[8] 设置开机自启</code>。

Windows 可能会弹出管理员权限确认窗口。确认后，服务会在用户登录时自动启动。

### 移除开机自启

选择 <code>[9] 移除开机自启</code>，按提示完成移除。

## 接口地址

默认服务端口为 <code>9999</code>，服务监听在本机地址：

| 地址 | 说明 |
|------|------|
| <code>http://127.0.0.1:9999/</code> | 网页面板 |
| <code>http://127.0.0.1:9999/usage</code> | JSON 用量接口 |

如果安装时设置了其他端口，将地址中的 <code>9999</code> 替换为实际端口。

## 模板配置

将请求地址改为本地代理接口：

~~~javascript
({
  request: {
    url: "http://127.0.0.1:9999/usage",
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
      extra: ${(percent * 100).toFixed(1)}%,
    };
  },
});
~~~

## 配置文件

服务端口保存在安装目录下的 <code>port.conf</code>。

首次安装时可以在菜单中设置端口，后续更新会保留已有端口配置。

## 运行时文件

以下文件由程序运行时自动生成：

- <code>cookies.json</code> — 登录 Cookie
- <code>meta.json</code> — User-Agent 配置
- <code>port.conf</code> — 服务端口配置
- <code>install.conf</code> — 安装目录配置
- <code>server.pid</code> — 服务进程 PID
- <code>server.log</code> — 服务日志
- <code>xtm.log</code> — 安装器操作日志

## 认证机制

~~~text
请求用量
   ↓
Cookie 有效？
   ├─ 否 → 打开浏览器重新登录
   └─ 是
       ↓
API 返回 401？
   ├─ 否 → 返回用量数据
   └─ 是 → 无头浏览器刷新 serviceToken
                ↓
           刷新成功 → 重试一次请求
                ↓
           刷新失败 → 打开浏览器重新登录
~~~

- **passToken** — 用于维持登录状态
- **serviceToken** — 用于访问平台接口；Xiaomi MiMo 官方 Cookie Policy 标注有效期为 24 小时，程序优先读取服务端下发的 `expires` 并在到期前自动刷新
- **User-Agent** — 登录和后续请求保持一致

## 常见问题

**Q: 安装后文件在哪里？**

默认安装在：

~~~text
C:\Users\当前用户名\XiaomiTokenMonitor
~~~

实际安装目录和服务端口会在菜单中显示。

**Q: 没有 Node.js 怎么办？**

安装脚本会自动尝试安装 Node.js LTS。如果自动安装失败，请根据菜单提示处理。

**Q: 怎么查看服务是否运行？**

在菜单中选择 <code>[5] 查看状态</code>。

**Q: 端口被占用怎么办？**

重新运行安装命令，在菜单中选择 <code>[1] 安装 / 更新</code>，首次安装时设置可用端口。

**Q: 登录超时怎么办？**

检查网络连接，并在浏览器中完成小米账号登录。也可以在菜单中选择 <code>[7] 重新登录</code>。

**Q: 如何查看日志？**

在菜单中选择 <code>[6] 查看日志</code>，然后选择服务日志或操作日志。

**Q: 如何重新登录？**

在菜单中选择 <code>[7] 重新登录</code>，完成浏览器登录即可。

**Q: 如何彻底卸载？**

1. 在菜单中选择 <code>[U] 卸载</code>。
2. 输入 <code>y</code> 确认。
3. 卸载流程会停止服务、移除开机自启并删除安装目录。

## 注意事项

- 登录 Cookie 保存在本地安装目录中，请勿分享 <code>cookies.json</code>。
- 服务默认只监听本机，不提供局域网访问。
