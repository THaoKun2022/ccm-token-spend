# 安装 ccm-token-spend 守护进程为开机自启（登录后自动运行，无需手动启动监控）
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$guardian = Join-Path $scriptDir "guardian.ps1"
if (-not (Test-Path -LiteralPath $guardian)) { Write-Host "未找到 guardian.ps1（请与脚本放在同一目录）" -ForegroundColor Red; exit 1 }

$startup = [Environment]::GetFolderPath("Startup")
$lnkPath = Join-Path $startup "ccm-token-spend-guardian.lnk"
$psExe = (Get-Command powershell.exe).Source

$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnkPath)
$sc.TargetPath = $psExe
$sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$guardian`""
$sc.WorkingDirectory = $scriptDir
$sc.WindowStyle = 7
$sc.Description = "ccm-token-spend guardian: auto start token monitor when Codex is running"
$sc.Save()

# 立即启动一次守护（无需等下次登录）
$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
$guardianRunning = $false
$gp = Join-Path $stateDir "guardian.pid"
if (Test-Path -LiteralPath $gp) {
  $raw = Get-Content -LiteralPath $gp -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') {
    $guardianRunning = $null -ne (Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue)
  }
}
if (-not $guardianRunning) {
  Start-Process -FilePath $psExe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$guardian`"") -WindowStyle Hidden
}

Write-Host "已安装开机自启守护进程：" -ForegroundColor Green
Write-Host "  $lnkPath"
Write-Host ""
Write-Host "提示："
Write-Host "  1. 守护进程会检测 Codex：Codex 运行时自动启动监控，退出后自动停止。"
Write-Host "  2. 如果当前有手动运行的监控窗口，请先关闭它，避免双实例。"
Write-Host "  3. 卸载：运行 .\uninstall-autostart.ps1"