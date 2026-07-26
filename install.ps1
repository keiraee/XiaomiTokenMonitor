[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"
$REPO = "https://github.com/keiraee/XiaomiTokenMonitor.git"
$INSTALL_DIR = "$env:USERPROFILE\XiaomiTokenMonitor"

function Show-Menu {
    Clear-Host
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
    Write-Host "    [0] 退出"
    Write-Host ""
    Write-Host "  =========================================="
    Write-Host ""
}

function Test-Node {
    try { $null = node -v; return $true } catch { return $false }
}

function Install-Project {
    Write-Host "[1/4] 检查 Node.js ..." -ForegroundColor Cyan
    if (-not (Test-Node)) {
        Write-Host "[错误] 未检测到 Node.js，请先安装: https://nodejs.org/" -ForegroundColor Red
        return
    }
    Write-Host "  Node.js 版本: $(node -v)" -ForegroundColor Green

    if (Test-Path "$INSTALL_DIR\.git") {
        Write-Host "[2/4] 更新项目 ..." -ForegroundColor Cyan
        git -C $INSTALL_DIR pull --quiet
    } else {
        Write-Host "[2/4] 克隆项目 ..." -ForegroundColor Cyan
        if (Test-Path $INSTALL_DIR) { Remove-Item $INSTALL_DIR -Recurse -Force }
        git clone $REPO $INSTALL_DIR --quiet
    }

    Write-Host "[3/4] 安装依赖 ..." -ForegroundColor Cyan
    Push-Location $INSTALL_DIR
    npm install --silent 2>&1 | Out-Null

    Write-Host "[4/4] 安装 Playwright 浏览器 ..." -ForegroundColor Cyan
    npx playwright install chromium 2>&1 | Out-Null
    Pop-Location

    Write-Host ""
    Write-Host "[完成] 已安装到 $INSTALL_DIR" -ForegroundColor Green
}

function Start-Service {
    if (-not (Test-Path "$INSTALL_DIR\src\server.js")) {
        Write-Host "[错误] 未安装，请先选择 [1] 安装" -ForegroundColor Red
        return
    }
    Push-Location $INSTALL_DIR
    if (Test-Path "server.pid") {
        $pid = Get-Content "server.pid"
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "[提示] 服务已在运行 (PID: $pid)" -ForegroundColor Yellow
            Pop-Location; return
        }
    }
    if (Test-Path "server.log") { Remove-Item "server.log" }
    Start-Process -FilePath "node" -ArgumentList "src\server.js" -WindowStyle Hidden -WorkingDirectory $INSTALL_DIR
    Start-Sleep -Seconds 5
    if (Test-Path "server.pid") {
        $pid = Get-Content "server.pid"
        Write-Host "[完成] 服务已启动 (PID: $pid)" -ForegroundColor Green
        Write-Host "  地址: http://localhost:9999"
        Write-Host "  接口: http://localhost:9999/usage"
    } else {
        Write-Host "[错误] 启动失败，请查看日志" -ForegroundColor Red
    }
    Pop-Location
}

function Stop-Service {
    if (-not (Test-Path "$INSTALL_DIR\server.pid")) {
        Write-Host "[提示] 服务未运行" -ForegroundColor Yellow; return
    }
    $pid = Get-Content "$INSTALL_DIR\server.pid"
    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "[提示] 进程 $pid 不存在，服务已停止" -ForegroundColor Yellow
        Remove-Item "$INSTALL_DIR\server.pid" -ErrorAction SilentlyContinue
        return
    }
    Write-Host "[停止] 正在终止进程 $pid ..." -ForegroundColor Cyan
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Remove-Item "$INSTALL_DIR\server.pid" -ErrorAction SilentlyContinue
    Write-Host "[完成] 服务已停止" -ForegroundColor Green
}

function Restart-Service {
    Stop-Service
    Start-Sleep -Seconds 2
    Start-Service
}

function Get-Status {
    if (-not (Test-Path "$INSTALL_DIR\server.pid")) {
        Write-Host "[状态] 服务未运行" -ForegroundColor Yellow; return
    }
    $pid = Get-Content "$INSTALL_DIR\server.pid"
    $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "[状态] PID 文件存在但进程不存在" -ForegroundColor Yellow
        Remove-Item "$INSTALL_DIR\server.pid" -ErrorAction SilentlyContinue
        return
    }
    Write-Host "[状态] 运行中" -ForegroundColor Green
    Write-Host "  PID:  $pid"
    Write-Host "  端口: 9999"
    Write-Host "  地址: http://localhost:9999"
    Write-Host "  接口: http://localhost:9999/usage"
}

function Show-Logs {
    $logFile = "$INSTALL_DIR\server.log"
    if (-not (Test-Path $logFile)) {
        Write-Host "[提示] 暂无日志" -ForegroundColor Yellow; return
    }
    Write-Host "--- 最近20条日志 ---" -ForegroundColor Cyan
    Get-Content $logFile -Tail 20
}

function ReLogin {
    if (Test-Path "$INSTALL_DIR\cookies.json") { Remove-Item "$INSTALL_DIR\cookies.json" }
    Push-Location $INSTALL_DIR
    node -e "const a=require('./src/auth');a.login().then(()=>console.log('[完成] 登录成功')).catch(e=>console.error('[错误]',e.message))"
    Pop-Location
}

function Install-AutoStart {
    $taskName = "XiaomiTokenMonitor"
    $action = New-ScheduledTaskAction -Execute "node" -Argument "src\server.js" -WorkingDirectory $INSTALL_DIR
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Host "[完成] 开机自启已设置（登录时自动启动）" -ForegroundColor Green
}

function Uninstall-AutoStart {
    Unregister-ScheduledTask -TaskName "XiaomiTokenMonitor" -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[完成] 开机自启已移除" -ForegroundColor Green
}

while ($true) {
    Show-Menu
    $choice = Read-Host "  请选择操作"
    switch ($choice) {
        "1" { Install-Project; Pause }
        "2" { Start-Service; Pause }
        "3" { Stop-Service; Pause }
        "4" { Restart-Service; Pause }
        "5" { Get-Status; Pause }
        "6" { Show-Logs; Pause }
        "7" { ReLogin; Pause }
        "8" { Install-AutoStart; Pause }
        "9" { Uninstall-AutoStart; Pause }
        "0" { exit }
        default { Write-Host "无效选项，请重新选择" -ForegroundColor Red; Start-Sleep -Seconds 1 }
    }
}
