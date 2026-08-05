# 卸载 ccm-token-spend 守护进程，并停止由守护启动的监控进程
$ErrorActionPreference = "Continue"
$startup = [Environment]::GetFolderPath("Startup")
$lnkPath = Join-Path $startup "ccm-token-spend-guardian.lnk"
if (Test-Path -LiteralPath $lnkPath) { Remove-Item -LiteralPath $lnkPath -Force }

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