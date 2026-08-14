# 安装 ccm-token-spend 守护进程为开机自启（登录后自动运行，无需手动启动监控）
# 方式：计划任务（登录触发，唯一自启方式）
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$guardian = Join-Path $scriptDir "guardian.ps1"
if (-not (Test-Path -LiteralPath $guardian)) { Write-Host "未找到 guardian.ps1（请与脚本放在同一目录）" -ForegroundColor Red; exit 1 }

$psExe = (Get-Command powershell.exe).Source
$guardianArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $guardian + '"'
$taskName = "ccm-token-spend-guardian"

# 1) 注册计划任务（登录触发）
try {
  $action = New-ScheduledTaskAction -Execute $psExe -Argument $guardianArgs
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "ccm-token-spend guardian: auto start token monitor when Codex is running" -Force | Out-Null
  Write-Host ("已注册计划任务：" + $taskName + "（登录时自动运行）") -ForegroundColor Green
} catch {
  Write-Host ("计划任务注册失败，无法安装开机自启：" + $_.Exception.Message) -ForegroundColor Red
  exit 1
}

# 2) 清理旧版本遗留的启动文件夹快捷方式（v1.2 起只使用计划任务）
$lnkPath = Join-Path ([Environment]::GetFolderPath("Startup")) "ccm-token-spend-guardian.lnk"
if (Test-Path -LiteralPath $lnkPath) {
  Remove-Item -LiteralPath $lnkPath -Force
  Write-Host "已清理旧版本遗留的启动文件夹快捷方式。" -ForegroundColor Green
}

# 3) 立即启动一次守护（无需等下次登录；guardian.ps1 内有单实例锁，不会重复）
$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
$gp = Join-Path $stateDir "guardian.pid"
$guardianRunning = $false
if (Test-Path -LiteralPath $gp) {
  $raw = Get-Content -LiteralPath $gp -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') {
    $guardianRunning = $null -ne (Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue)
  }
}
if (-not $guardianRunning) {
  Start-Process -FilePath $psExe -ArgumentList $guardianArgs -WindowStyle Hidden
  Start-Sleep -Seconds 1
  Write-Host "已立即启动守护进程。" -ForegroundColor Green
} else {
  Write-Host "守护进程已在运行，跳过立即启动。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "提示："
Write-Host "  1. 守护进程会检测 Codex：Codex 运行时自动启动监控，退出后自动停止，监控崩溃后自动重启。"
Write-Host "  2. 运行日志：%LOCALAPPDATA%\ccm-token-spend\guardian.log（检测 / 启动 / 失败原因）。"
Write-Host "  3. 如果当前有手动运行的监控窗口，请先关闭它，避免双实例。"
Write-Host "  4. 卸载：运行 .\uninstall-autostart.ps1"
