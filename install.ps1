[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

& {
$ErrorActionPreference = "Stop"
$ARCHIVE_URL = "https://github.com/keiraee/XiaomiTokenMonitor/archive/refs/heads/main.zip"
$DEFAULT_DIR = "$env:USERPROFILE\XiaomiTokenMonitor"
$script:INSTALL_DIR = $DEFAULT_DIR
$script:PORT = "9999"
$TASK_NAME = "XiaomiTokenMonitor"

function Write-Log {
    param([string]$Action, [string]$Message = "")
    $logFile = "$script:INSTALL_DIR\xtm.log"
    $dir = Split-Path $logFile
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $ts = Get-Date -Format "yyyy/MM/dd HH:mm:ss"
    $line = "[$ts] [$Action] $Message"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Show-Menu {
    Clear-Host
    $portConf = "$script:INSTALL_DIR\port.conf"
    $curPort = if (Test-Path $portConf) { (Get-Content $portConf -Raw).Trim() } else { $script:PORT }
    Write-Host ""
    Write-Host "  =========================================="
    Write-Host "    XiaomiTokenMonitor - 小米Token用量监控"
    Write-Host "  =========================================="
    Write-Host ""
    Write-Host "    [1] 安装 / 更新"
    Write-Host "    [2] 启动服务"
    Write-Host "    [3] 停止服务"
    Write-Host "    [4] 重启服务"
    Write-Host "    [5] 查看状态"
    Write-Host "    [6] 查看日志"
    Write-Host "    [7] 重新登录"
    Write-Host "    [8] 设置开机自启"
    Write-Host "    [9] 移除开机自启"
    Write-Host "    [U] 卸载"
    Write-Host "    [0] 退出"
    Write-Host ""
    Write-Host "  =========================================="
    Write-Host "  安装目录: $script:INSTALL_DIR"
    if (Test-Path "$script:INSTALL_DIR\install.ps1") {
        Write-Host "  管理脚本: $script:INSTALL_DIR\install.ps1"
    } else {
        Write-Host "  管理脚本: 安装完成后生成"
    }
    Write-Host "  服务端口: $curPort"
    Write-Host "  服务地址: http://localhost:$curPort"
    Write-Host "  =========================================="
    Write-Host ""
}

function Test-Node {
    try { $null = node -v; return $true } catch { return $false }
}

function Install-Node {
    Write-Host "[提示] 正在安装 Node.js ..." -ForegroundColor Yellow
    try {
        $null = Get-Command winget -ErrorAction Stop
        Write-Host "  使用 winget 安装 ..." -ForegroundColor Cyan
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
        if (Test-Node) {
            Write-Host "  Node.js 安装成功: $(node -v)" -ForegroundColor Green
            return $true
        }
    } catch {}
    Write-Host ""
    Write-Host "[错误] 自动安装失败，请手动安装 Node.js:" -ForegroundColor Red
    Write-Host "  下载地址: https://nodejs.org/zh-cn/" -ForegroundColor Yellow
    Write-Host "  选择 LTS 版本，安装后重新运行此脚本" -ForegroundColor Yellow
    return $false
}

function Add-ToPath {
    $binDir = "$script:INSTALL_DIR"
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$binDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", "User")
        $env:Path = "$env:Path;$binDir"
        Write-Host "[完成] 已添加到 PATH: $binDir" -ForegroundColor Green
        Write-Host "  新开终端后可直接运行 xtm 命令" -ForegroundColor Gray
    }
}

function Remove-FromPath {
    $binDir = "$script:INSTALL_DIR"
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -like "*$binDir*") {
        $newPath = ($currentPath -split ';' | Where-Object { $_ -ne $binDir }) -join ';'
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "[完成] 已从 PATH 移除" -ForegroundColor Green
    }
}

function Create-Wrapper {
    $dir = $script:INSTALL_DIR
    $lines = @(
        '@echo off'
        'chcp 65001 >nul'
        "powershell -NoProfile -ExecutionPolicy Bypass -File `"$dir\install.ps1`""
    )
    Set-Content -Path "$dir\mitoken.cmd" -Value ($lines -join "`r`n") -Encoding ASCII
}

function Test-XtmInstall {
    param([string]$InstallPath)
    return (Test-Path "$InstallPath\src\server.js") -and (Test-Path "$InstallPath\package.json")
}

function Install-Project {
    $isUpdate = (Test-Path "$script:INSTALL_DIR\install.conf") -or (Test-XtmInstall $script:INSTALL_DIR)

    if ($isUpdate) {
        # 更新模式：读取现有配置
        Write-Log "更新" "开始更新"
        Write-Host "==========================================" -ForegroundColor Cyan
        Write-Host "  更新项目" -ForegroundColor Cyan
        Write-Host "==========================================" -ForegroundColor Cyan
        Write-Host ""
        $portConf = "$script:INSTALL_DIR\port.conf"
        if (Test-Path $portConf) { $script:PORT = (Get-Content $portConf -Raw).Trim() }
        Write-Host "  安装目录: $script:INSTALL_DIR" -ForegroundColor Green
        Write-Host "  服务端口: $script:PORT" -ForegroundColor Green
        Write-Host ""
    } else {
        # 首次安装：选择路径和端口
        Write-Log "安装" "首次安装"
        Write-Host "==========================================" -ForegroundColor Cyan
        Write-Host "  首次安装" -ForegroundColor Cyan
        Write-Host "==========================================" -ForegroundColor Cyan
        Write-Host ""

        # 选择安装路径
        Write-Host "  默认安装路径: $DEFAULT_DIR" -ForegroundColor Gray
        $customPath = Read-Host "  自定义路径 (回车使用默认)"
        if ($customPath -and $customPath.Trim() -ne "") {
            $script:INSTALL_DIR = $customPath.Trim().TrimEnd('\')
        } else {
            $script:INSTALL_DIR = $DEFAULT_DIR
        }
        Write-Host "  安装路径: $script:INSTALL_DIR" -ForegroundColor Green
        Write-Host ""

        # 选择端口
        Write-Host "  默认端口: 9999" -ForegroundColor Gray
        $customPort = Read-Host "  自定义端口 (回车使用默认)"
        if ($customPort -and $customPort.Trim() -match '^\d+$') {
            $script:PORT = $customPort.Trim()
        } else {
            $script:PORT = "9999"
        }
        Write-Host "  端口: $script:PORT" -ForegroundColor Green
        Write-Host ""
    }

    # 用户选择了已有安装目录时，切换为更新模式
    if (-not $isUpdate -and ((Test-Path "$script:INSTALL_DIR\install.conf") -or (Test-XtmInstall $script:INSTALL_DIR))) {
        $isUpdate = $true
        $portConf = "$script:INSTALL_DIR\port.conf"
        if (Test-Path $portConf) { $script:PORT = (Get-Content $portConf -Raw).Trim() }
    }

    if ($isUpdate) {
        Stop-XtmService
    } elseif (Test-Path $script:INSTALL_DIR) {
        $existingFiles = @(Get-ChildItem -LiteralPath $script:INSTALL_DIR -Force -ErrorAction SilentlyContinue)
        if ($existingFiles.Count -gt 0) {
            throw "目标目录已存在且不是 XiaomiTokenMonitor 安装目录: $script:INSTALL_DIR"
        }
    }

    # 检查 Node.js
    Write-Host "[1/5] 检查 Node.js ..." -ForegroundColor Cyan
    if (-not (Test-Node)) {
        Write-Host "  未检测到 Node.js" -ForegroundColor Yellow
        if (-not (Install-Node)) { return }
    }
    Write-Host "  Node.js: $(node -v)" -ForegroundColor Green

    # 下载并解压项目，不需要 Git
    if ($isUpdate) {
        Write-Host "[2/5] 下载更新 ..." -ForegroundColor Cyan
    } else {
        Write-Host "[2/5] 下载项目 ..." -ForegroundColor Cyan
    }
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("XiaomiTokenMonitor-" + [guid]::NewGuid().ToString('N'))
    $zipPath = Join-Path $tempRoot "project.zip"
    $extractPath = Join-Path $tempRoot "extract"
    try {
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
        Invoke-WebRequest -UseBasicParsing -Uri $ARCHIVE_URL -OutFile $zipPath
        Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force
        $sourceDir = Join-Path $extractPath "XiaomiTokenMonitor-main"
        if (-not (Test-Path "$sourceDir\src\server.js")) {
            throw "下载的项目压缩包格式无效"
        }
        if (-not (Test-Path $script:INSTALL_DIR)) {
            New-Item -ItemType Directory -Path $script:INSTALL_DIR -Force | Out-Null
        }
        if (Test-Path "$script:INSTALL_DIR\.git") {
            Remove-Item "$script:INSTALL_DIR\.git" -Recurse -Force
        }
        Get-ChildItem -LiteralPath $sourceDir -Force | Copy-Item -Destination $script:INSTALL_DIR -Recurse -Force
    } finally {
        if (Test-Path $tempRoot) { Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
    }

    # 安装依赖
    Write-Host "[3/5] 安装 npm 依赖 ..." -ForegroundColor Cyan
    Push-Location $script:INSTALL_DIR
    try {
        npm install --silent
        if ($LASTEXITCODE -ne 0) { throw "npm 依赖安装失败，退出码: $LASTEXITCODE" }

        # 安装浏览器
        Write-Host "[4/5] 安装 Playwright 浏览器 ..." -ForegroundColor Cyan
        npx playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw "Playwright 浏览器安装失败，退出码: $LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    # 保存配置
    Write-Host "[5/5] 保存配置 ..." -ForegroundColor Cyan
    Set-Content -Path "$script:INSTALL_DIR\port.conf" -Value $script:PORT -Encoding UTF8
    Set-Content -Path "$script:INSTALL_DIR\install.conf" -Value $script:INSTALL_DIR -Encoding UTF8
    Create-Wrapper
    Add-ToPath

    Write-Log "安装" "安装完成 路径=$script:INSTALL_DIR 端口=$script:PORT"
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "  安装完成!" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  安装目录: $script:INSTALL_DIR" -ForegroundColor White
    Write-Host "  服务端口: $script:PORT" -ForegroundColor White
    Write-Host "  服务地址: http://localhost:$script:PORT" -ForegroundColor White
    Write-Host ""
    Write-Host "  全局命令: 新开终端输入 mitoken 即可打开菜单" -ForegroundColor Yellow
    Write-Host ""

    # 安装/更新完成后自动重启服务
    if ($isUpdate) {
        Write-Host "[提示] 正在重启服务 ..." -ForegroundColor Cyan
        Write-Log "安装" "更新完成，自动重启服务"
        Restart-XtmService
    } else {
        Write-Host "[提示] 正在启动服务 ..." -ForegroundColor Cyan
        Write-Log "安装" "首次安装完成，自动启动服务"
        Write-Host "  首次会弹出浏览器让你登录小米账号" -ForegroundColor Yellow
        Write-Host ""
        Start-XtmService
    }
}

function Start-XtmService {
    Write-Log "启动" "启动服务"
    if (-not (Test-Path "$script:INSTALL_DIR\src\server.js")) {
        Write-Host "[错误] 未安装，请先选择 [1] 安装" -ForegroundColor Red; return
    }
    Push-Location $script:INSTALL_DIR
    if (Test-Path "server.pid") {
        $svcPid = Get-Content "server.pid"
        $proc = Get-Process -Id $svcPid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "[提示] 服务已在运行 (PID: $svcPid)" -ForegroundColor Yellow
            Write-Log "启动" "服务已在运行 PID=$svcPid"
            Pop-Location; return
        }
    }
    if (Test-Path "server.log") { Remove-Item "server.log" }
    Start-Process -FilePath "node" -ArgumentList "src\server.js" -WindowStyle Hidden -WorkingDirectory $script:INSTALL_DIR
    Start-Sleep -Seconds 5
    if (Test-Path "server.pid") {
        $svcPid = Get-Content "server.pid"
        $portConf = "$script:INSTALL_DIR\port.conf"
        $curPort = if (Test-Path $portConf) { (Get-Content $portConf -Raw).Trim() } else { "9999" }
        Write-Log "启动" "启动成功 PID=$svcPid 端口=$curPort"
        Write-Host "[完成] 服务已启动" -ForegroundColor Green
        Write-Host ""
        Write-Host "  PID:  $svcPid"
        Write-Host "  端口: $curPort"
        Write-Host "  地址: http://localhost:$curPort"
        Write-Host "  接口: http://localhost:$curPort/usage"
        Write-Host ""
        Write-Host "  查看进程: 任务管理器 → 详细信息 → 搜索 PID $svcPid" -ForegroundColor Gray
    } else {
        Write-Log "启动" "启动失败"
        Write-Host "[错误] 启动失败，请选 [6] 查看日志" -ForegroundColor Red
    }
    Pop-Location
}

function Stop-XtmService {
    Write-Log "停止" "停止服务"
    if (-not (Test-Path "$script:INSTALL_DIR\server.pid")) {
        Write-Host "[提示] 服务未运行" -ForegroundColor Yellow
        Write-Log "停止" "服务未运行"
        return
    }
    $svcPid = Get-Content "$script:INSTALL_DIR\server.pid"
    $proc = Get-Process -Id $svcPid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "[提示] 进程已不存在" -ForegroundColor Yellow
        Remove-Item "$script:INSTALL_DIR\server.pid" -ErrorAction SilentlyContinue
        Write-Log "停止" "进程已不存在 PID=$svcPid"
        return
    }
    Write-Host "[停止] 正在终止进程 (PID: $svcPid) ..." -ForegroundColor Cyan
    Stop-Process -Id $svcPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Remove-Item "$script:INSTALL_DIR\server.pid" -ErrorAction SilentlyContinue
    Write-Log "停止" "停止成功 PID=$svcPid"
    Write-Host "[完成] 服务已停止" -ForegroundColor Green
}

function Restart-XtmService {
    Write-Log "重启" "重启服务"
    Stop-XtmService
    Start-Sleep -Seconds 2
    Start-XtmService
}

function Get-Status {
    if (-not (Test-Path "$script:INSTALL_DIR\server.pid")) {
        Write-Host "[状态] 服务未运行" -ForegroundColor Yellow
        Write-Host "  选择 [2] 启动服务" -ForegroundColor Gray
        return
    }
    $svcPid = Get-Content "$script:INSTALL_DIR\server.pid"
    $proc = Get-Process -Id $svcPid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "[状态] 进程已不存在" -ForegroundColor Yellow
        Remove-Item "$script:INSTALL_DIR\server.pid" -ErrorAction SilentlyContinue
        return
    }
    $portConf = "$script:INSTALL_DIR\port.conf"
    $curPort = if (Test-Path $portConf) { (Get-Content $portConf -Raw).Trim() } else { "9999" }
    $uptime = (Get-Date) - $proc.StartTime
    Write-Host "[状态] 运行中" -ForegroundColor Green
    Write-Host ""
    Write-Host "  PID:     $svcPid"
    Write-Host "  端口:    $curPort"
    Write-Host "  地址:    http://localhost:$curPort"
    Write-Host "  接口:    http://localhost:$curPort/usage"
    Write-Host "  运行时长: $([math]::Floor($uptime.TotalHours))小时$($uptime.Minutes)分钟"
    Write-Host ""
    Write-Host "  任务管理器 → 详细信息 → 搜索 PID $svcPid" -ForegroundColor Gray
}

function Show-Logs {
    Write-Host ""
    Write-Host "  [1] 服务日志 (server.log)" -ForegroundColor Cyan
    Write-Host "  [2] 操作日志 (xtm.log)" -ForegroundColor Cyan
    Write-Host ""
    $logChoice = Read-Host "  选择日志类型"
    switch ($logChoice) {
        "1" {
            $logFile = "$script:INSTALL_DIR\server.log"
            if (-not (Test-Path $logFile)) {
                Write-Host "[提示] 暂无服务日志" -ForegroundColor Yellow; return
            }
            Write-Host "--- 最近20条服务日志 ---" -ForegroundColor Cyan
            Write-Host ""
            Get-Content $logFile -Tail 20 -Encoding UTF8
        }
        "2" {
            $logFile = "$script:INSTALL_DIR\xtm.log"
            if (-not (Test-Path $logFile)) {
                Write-Host "[提示] 暂无操作日志" -ForegroundColor Yellow; return
            }
            Write-Host "--- 最近20条操作日志 ---" -ForegroundColor Cyan
            Write-Host ""
            Get-Content $logFile -Tail 20 -Encoding UTF8
        }
        default {
            Write-Host "无效选项" -ForegroundColor Red
        }
    }
}

function ReLogin {
    Write-Log "重新登录" "触发重新登录"
    if (-not (Test-Path "$script:INSTALL_DIR\src\auth.js")) {
        Write-Host "[错误] 未安装" -ForegroundColor Red; return
    }
    if (Test-Path "$script:INSTALL_DIR\cookies.json") { Remove-Item "$script:INSTALL_DIR\cookies.json" }
    Push-Location $script:INSTALL_DIR
    try {
        node -e "const a=require('./src/auth');a.login().then(()=>console.log('[完成] 登录成功')).catch(e=>{console.error('[错误]',e.message);process.exitCode=1})"
        $loginExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($loginExitCode -eq 0) {
        Write-Log "重新登录" "登录成功"
    } else {
        Write-Log "重新登录" "登录失败，退出码=$loginExitCode"
    }
}

function Install-AutoStart {
    Write-Log "开机自启" "设置开机自启"
    $existing = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[提示] 开机自启已存在，无需重复设置" -ForegroundColor Yellow
        Write-Log "开机自启" "已存在，跳过"
        return
    }
    # 找 node.exe 绝对路径
    $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $nodePath) {
        Write-Host "[错误] 未找到 node.exe" -ForegroundColor Red
        Write-Log "开机自启" "失败：未找到 node.exe"
        return
    }
    $serverJs = "$script:INSTALL_DIR\src\server.js"
    $action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$serverJs`"" -WorkingDirectory $script:INSTALL_DIR
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TASK_NAME -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Log "开机自启" "设置成功 $nodePath"
    Write-Host "[完成] 开机自启已设置" -ForegroundColor Green
    Write-Host ""
    Write-Host "  任务名称: $TASK_NAME" -ForegroundColor Gray
    Write-Host "  执行文件: $nodePath" -ForegroundColor Gray
    Write-Host "  触发条件: 用户登录时" -ForegroundColor Gray
    Write-Host "  查看方式: 任务计划程序 → 搜索 $TASK_NAME" -ForegroundColor Gray
    Write-Host ""
}

function Uninstall-AutoStart {
    Write-Log "移除自启" "移除开机自启"
    $task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
        Write-Log "移除自启" "移除成功"
        Write-Host "[完成] 开机自启已移除" -ForegroundColor Green
    } else {
        Write-Log "移除自启" "任务不存在"
        Write-Host "[提示] 未找到开机自启任务，无需移除" -ForegroundColor Yellow
    }
}

function Uninstall-All {
    Write-Log "卸载" "开始卸载"
    # 读取实际安装路径
    $confFile = "$script:INSTALL_DIR\install.conf"
    $targetDir = $script:INSTALL_DIR
    if (Test-Path $confFile) {
        $targetDir = (Get-Content $confFile -Raw).Trim()
    }

    Write-Host ""
    Write-Host "  安装目录: $targetDir" -ForegroundColor Cyan
    Write-Host "  确定要卸载吗？这会删除所有数据（包括 Cookie）" -ForegroundColor Yellow
    $confirm = Read-Host "  输入 y 确认"
    if ($confirm -ne 'y') { Write-Host "  已取消" -ForegroundColor Gray; Write-Log "卸载" "用户取消"; return }

    # 停止服务并确认进程已退出
    if (Test-Path "$targetDir\server.pid") {
        $svcPid = (Get-Content "$targetDir\server.pid" -Raw).Trim()
        if ($svcPid -match '^\d+$') {
            $process = Get-Process -Id ([int]$svcPid) -ErrorAction SilentlyContinue
            if ($process) {
                Stop-Process -Id ([int]$svcPid) -Force -ErrorAction SilentlyContinue
                for ($attempt = 0; $attempt -lt 20; $attempt++) {
                    Start-Sleep -Milliseconds 500
                    $process = Get-Process -Id ([int]$svcPid) -ErrorAction SilentlyContinue
                    if (-not $process) { break }
                }
            }
            if ($process) {
                Write-Host "[错误] 服务进程仍在运行，已停止卸载，未删除目录" -ForegroundColor Red
                Write-Log "卸载" "服务进程未退出 PID=$svcPid"
                return
            }
            Remove-Item "$targetDir\server.pid" -Force -ErrorAction SilentlyContinue
            Write-Log "卸载" "停止服务 PID=$svcPid"
        }
    }

    # 移除计划任务；普通权限下通过 UAC 提权，并确认任务确实消失
    $task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($task) {
        if (Test-Admin) {
            Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false -ErrorAction Stop
        } else {
            $removeCommand = "Unregister-ScheduledTask -TaskName '$TASK_NAME' -Confirm:`$false -ErrorAction Stop"
            Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"$removeCommand`"" | Out-Null
        }

        if (Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue) {
            Write-Host "[错误] 无法移除开机自启任务，已停止卸载，未删除目录" -ForegroundColor Red
            Write-Log "卸载" "移除计划任务失败"
            return
        }
        Write-Host "[完成] 已移除计划任务" -ForegroundColor Green
        Write-Log "卸载" "移除计划任务"
    } else {
        Write-Host "[提示] 无计划任务" -ForegroundColor Gray
    }

    # 从 PATH 移除
    Remove-FromPath
    Write-Log "卸载" "清理PATH"

    # 删除安装目录
    if (Test-Path $targetDir) {
        Write-Log "卸载" "准备删除目录 $targetDir"
        $targetFullPath = (Resolve-Path $targetDir).Path.TrimEnd('\')
        $currentFullPath = (Get-Location).Path.TrimEnd('\')
        if ($currentFullPath -eq $targetFullPath -or $currentFullPath.StartsWith("$targetFullPath\", [System.StringComparison]::OrdinalIgnoreCase)) {
            Set-Location $env:TEMP
        }
        Remove-Item $targetDir -Recurse -Force
        Write-Host "[完成] 已删除 $targetDir" -ForegroundColor Green
    } else {
        Write-Host "[提示] 目录不存在: $targetDir" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "[完成] 卸载完成" -ForegroundColor Green
    Write-Host ""
    exit
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# 主循环
while ($true) {
    Show-Menu
    $choice = Read-Host "  请选择操作"
    Write-Log "菜单" "用户选择: $choice"
    switch ($choice) {
        "1" { Install-Project; Pause }
        "2" { Start-XtmService; Pause }
        "3" { Stop-XtmService; Pause }
        "4" { Restart-XtmService; Pause }
        "5" { Get-Status; Pause }
        "6" { Show-Logs; Pause }
        "7" { ReLogin; Pause }
        "8" {
            $existing = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
            if ($existing) {
                Write-Host "[提示] 开机自启已存在，无需重复设置" -ForegroundColor Yellow
            } elseif (Test-Admin) {
                Install-AutoStart
            } else {
                $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
                if (-not $nodePath) {
                    Write-Host "[错误] 未找到 node.exe" -ForegroundColor Red
                } else {
                    Write-Host "[提示] 需要管理员权限，正在提权 ..." -ForegroundColor Yellow
                    $serverJs = "$script:INSTALL_DIR\src\server.js"
                    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -Command `"Import-Module ScheduledTasks; `$a=New-ScheduledTaskAction -Execute '$nodePath' -Argument `'`"$serverJs`"`' -WorkingDirectory '$script:INSTALL_DIR'; `$t=New-ScheduledTaskTrigger -AtLogOn; `$s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName '$TASK_NAME' -Action `$a -Trigger `$t -Settings `$s -Force; Pause`""
                }
            }
            Pause
        }
        "9" {
            $existing = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
            if (-not $existing) {
                Write-Host "[提示] 未找到开机自启任务，无需移除" -ForegroundColor Yellow
            } elseif (Test-Admin) {
                Uninstall-AutoStart
            } else {
                Write-Host "[提示] 需要管理员权限，正在提权 ..." -ForegroundColor Yellow
                Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -Command `"Unregister-ScheduledTask -TaskName '$TASK_NAME' -Confirm:`$false; Write-Host '[完成] 已移除' -ForegroundColor Green; Pause`""
            }
            Pause
        }
        "u" { Uninstall-All; Pause }
        "U" { Uninstall-All; Pause }
        "0" { exit }
        default { Write-Host "无效选项" -ForegroundColor Red; Start-Sleep -Seconds 1 }
    }
}

}
