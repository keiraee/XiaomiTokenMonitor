# XiaomiTokenMonitor

Windows 下的小米平台 Token 用量监控工具。最终用户只需要执行一条 PowerShell 命令，安装脚本会自动准备运行环境、下载项目、安装依赖并打开管理菜单。

## 一键安装与运行

以普通 PowerShell 执行：

\`\`\`powershell
irm https://raw.githubusercontent.com/keiraee/XiaomiTokenMonitor/main/install.ps1 | iex
\`\`\`

脚本会自动：

1. 检测或安装 Node.js LTS。
2. 检测 Git。
3. 下载或更新项目。
4. 安装 npm 依赖。
5. 安装 Playwright Chromium。
6. 进入管理菜单。

用户不需要手动执行 \`npm install\`、\`npm start\` 或 \`npx playwright install chromium\`。

## 管理菜单

进入菜单后可以执行：

- 安装 / 更新
- 启动服务
- 停止服务
- 重启服务
- 查看状态
- 查看服务日志和操作日志
- 重新登录
- 设置或移除开机自启
- 卸载

默认安装目录为：

\`\`\`
C:\\Users\\当前用户名\\XiaomiTokenMonitor
\`\`\`

首次启动会打开浏览器完成小米 SSO 登录。

## 服务地址

默认服务仅监听本机回环地址：

- 页面：\`http://127.0.0.1:9999/\`
- 用量接口：\`http://127.0.0.1:9999/usage\`
- 重新登录：本机 POST \`http://127.0.0.1:9999/relogin\`

首次安装时可以在菜单中设置端口。后续更新会保留已有端口配置。

## 认证行为

- 启动时检查 Cookie 和 passToken。
- serviceToken 失效时优先无头刷新。
- 无头刷新失败时自动打开浏览器重新登录。
- 认证操作带并发锁和有限重试。
- 默认每 12 小时自动刷新 Cookie。

## 运行时文件

这些文件由程序自动生成，不需要用户手动创建：

- \`cookies.json\`：登录 Cookie
- \`meta.json\`：User-Agent
- \`port.conf\`：端口配置
- \`server.pid\`：服务 PID
- \`server.log\`：服务日志
- \`xtm.log\`：安装器操作日志

