[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

& {
$ErrorActionPreference = "Stop"
$REPO = "https://github.com/keiraee/XiaomiTokenMonitor.git"
$DEFAULT_DIR = "$env:USERPROFILE\XiaomiTokenMonitor"
$script:INSTALL_DIR = $DEFAULT_DIR
$script:PORT = "9999"
$TASK_NAME = "XiaomiTokenMonitor"

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

function Install-Project {
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  开始安装" -ForegroundColor Cyan
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

    # 检查 Node.js
    Write-Host "[1/6] 检查 Node.js ..." -ForegroundColor Cyan
    if (-not (Test-Node)) {
        Write-Host "  未检测到 Node.js" -ForegroundColor Yellow
        if (-not (Install-Node)) { return }
    }
    Write-Host "  Node.js: $(node -v)" -ForegroundColor Green

    # 检查 Git
    Write-Host "[2/6] 检查 Git ..." -ForegroundColor Cyan
    try {
        $null = Get-Command git -ErrorAction Stop
        Write-Host "  Git: $(git --version)" -ForegroundColor Green
    } catch {
        Write-Host "[错误] 未检测到 Git，请先安装: https://git-scm.com/" -ForegroundColor Red
        return
    }

    # 克隆/更新项目
    if (Test-Path "$script:INSTALL_DIR\.git") {
        Write-Host "[3/6] 更新项目 ..." -ForegroundColor Cyan
        git -C $script:INSTALL_DIR pull --quiet
    } else {
        Write-Host "[3/6] 克隆项目到 $script:INSTALL_DIR ..." -ForegroundColor Cyan
        if (Test-Path $script:INSTALL_DIR) { Remove-Item $script:INSTALL_DIR -Recurse -Force }
        git clone $REPO $script:INSTALL_DIR --quiet
    }

    # 安装依赖
    Write-Host "[4/6] 安装 npm 依赖 ..." -ForegroundColor Cyan
    Push-Location $script:INSTALL_DIR
    npm install --silent 2>&1 | Out-Null

    # 安装浏览器
    Write-Host "[5/6] 安装 Playwright 浏览器 ..." -ForegroundColor Cyan
    npx playwright install chromium 2>&1 | Out-Null
    Pop-Location

    # 保存配置
    Write-Host "[6/6] 保存配置 ..." -ForegroundColor Cyan
    Set-Content -Path "$script:INSTALL_DIR\port.conf" -Value $script:PORT -Encoding UTF8
    Set-Content -Path "$script:INSTALL_DIR\install.conf" -Value $script:INSTALL_DIR -Encoding UTF8
    Create-Wrapper
    Add-ToPath

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
    Write-Host "  选择 [2] 启动服务，首次会弹出浏览器让你登录" -ForegroundColor Yellow
    Write-Host ""
}

function Start-XtmService {
    if (-not (Test-Path "$script:INSTALL_DIR\src\server.js")) {
        Write-Host "[错误] 未安装，请先选择 [1] 安装" -ForegroundColor Red; return
    }
    Push-Location $script:INSTALL_DIR
    if (Test-Path "server.pid") {
        $svcPid = Get-Content "server.pid"
        $proc = Get-Process -Id $svcPid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "[提示] 服务已在运行 (PID: $svcPid)" -ForegroundColor Yellow
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
        Write-Host "[完成] 服务已启动" -ForegroundColor Green
        Write-Host ""
        Write-Host "  PID:  $svcPid"
        Write-Host "  端口: $curPort"
        Write-Host "  地址: http://localhost:$curPort"
        Write-Host "  接口: http://localhost:$curPort/usage"
        Write-Host ""
        Write-Host "  查看进程: 任务管理器 → 详细信息 → 搜索 PID $svcPid" -ForegroundColor Gray
    } else {
        Write-Host "[错误] 启动失败，请选 [6] 查看日志" -ForegroundColor Red
    }
    Pop-Location
}

function Stop-XtmService {
    if (-not (Test-Path "$script:INSTALL_DIR\server.pid")) {
        Write-Host "[提示] 服务未运行" -ForegroundColor Yellow; return
    }
    $svcPid = Get-Content "$script:INSTALL_DIR\server.pid"
    $proc = Get-Process -Id $svcPid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "[提示] 进程已不存在" -ForegroundColor Yellow
        Remove-Item "$script:INSTALL_DIR\server.pid" -ErrorAction SilentlyContinue
        return
    }
    Write-Host "[停止] 正在终止进程 (PID: $svcPid) ..." -ForegroundColor Cyan
    Stop-Process -Id $svcPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Remove-Item "$script:INSTALL_DIR\server.pid" -ErrorAction SilentlyContinue
    Write-Host "[完成] 服务已停止" -ForegroundColor Green
}

function Restart-XtmService {
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
    $logFile = "$script:INSTALL_DIR\server.log"
    if (-not (Test-Path $logFile)) {
        Write-Host "[提示] 暂无日志" -ForegroundColor Yellow; return
    }
    Write-Host "--- 最近20条日志 ---" -ForegroundColor Cyan
    Write-Host ""
    Get-Content $logFile -Tail 20 -Encoding UTF8
}

function ReLogin {
    if (-not (Test-Path "$script:INSTALL_DIR\src\auth.js")) {
        Write-Host "[错误] 未安装" -ForegroundColor Red; return
    }
    if (Test-Path "$script:INSTALL_DIR\cookies.json") { Remove-Item "$script:INSTALL_DIR\cookies.json" }
    Push-Location $script:INSTALL_DIR
    node -e "const a=require('./src/auth');a.login().then(()=>console.log('[完成] 登录成功')).catch(e=>console.error('[错误]',e.message))"
    Pop-Location
}

function Install-AutoStart {
    $existing = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[提示] 开机自启已存在，无需重复设置" -ForegroundColor Yellow
        return
    }
    # 找 node.exe 绝对路径
    $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $nodePath) {
        Write-Host "[错误] 未找到 node.exe" -ForegroundColor Red
        return
    }
    $serverJs = "$script:INSTALL_DIR\src\server.js"
    $action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$serverJs`"" -WorkingDirectory $script:INSTALL_DIR
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TASK_NAME -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Host "[完成] 开机自启已设置" -ForegroundColor Green
    Write-Host ""
    Write-Host "  任务名称: $TASK_NAME" -ForegroundColor Gray
    Write-Host "  执行文件: $nodePath" -ForegroundColor Gray
    Write-Host "  触发条件: 用户登录时" -ForegroundColor Gray
    Write-Host "  查看方式: 任务计划程序 → 搜索 $TASK_NAME" -ForegroundColor Gray
    Write-Host ""
}

function Uninstall-AutoStart {
    $task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
        Write-Host "[完成] 开机自启已移除" -ForegroundColor Green
    } else {
        Write-Host "[提示] 未找到开机自启任务，无需移除" -ForegroundColor Yellow
    }
}

function Uninstall-All {
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
    if ($confirm -ne 'y') { Write-Host "  已取消" -ForegroundColor Gray; return }

    # 停止服务
    if (Test-Path "$targetDir\server.pid") {
        $svcPid = Get-Content "$targetDir\server.pid"
        Stop-Process -Id $svcPid -Force -ErrorAction SilentlyContinue
    }

    # 移除计划任务
    $task = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
        Write-Host "[完成] 已移除计划任务" -ForegroundColor Green
    } else {
        Write-Host "[提示] 无计划任务" -ForegroundColor Gray
    }

    # 从 PATH 移除
    Remove-FromPath

    # 删除安装目录
    if (Test-Path $targetDir) {
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
