# 卸载 ccm-token-spend 守护进程，并停止由守护启动的监控进程
$ErrorActionPreference = "Continue"

# 1) 删除计划任务
$taskName = "ccm-token-spend-guardian"
try {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host ("已删除计划任务：" + $taskName) -ForegroundColor Green
  }
} catch {
  Write-Host ("删除计划任务失败：" + $_.Exception.Message) -ForegroundColor Yellow
}

# 2) 删除启动文件夹快捷方式
$startup = [Environment]::GetFolderPath("Startup")
$lnkPath = Join-Path $startup "ccm-token-spend-guardian.lnk"
if (Test-Path -LiteralPath $lnkPath) {
  Remove-Item -LiteralPath $lnkPath -Force
  Write-Host ("已删除启动文件夹快捷方式：" + $lnkPath) -ForegroundColor Green
}

# 3) 停止守护进程与监控，清理状态目录
$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
$gp = Join-Path $stateDir "guardian.pid"
if (Test-Path -LiteralPath $gp) {
  $raw = Get-Content -LiteralPath $gp -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') { Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue }
}
$mp = Join-Path $stateDir "monitor.pid"
if (Test-Path -LiteralPath $mp) {
  $raw = Get-Content -LiteralPath $mp -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') { Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue }
}
Remove-Item -LiteralPath $stateDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "已移除开机自启守护进程并停止由它启动的监控。" -ForegroundColor Green
Write-Host "（手动打开的监控窗口需要自行关闭）"
