# ccm-token-spend 守护进程
# 作用：Codex 桌面版运行时自动启动 Token 监控；Codex 退出后自动停止；监控崩溃后自动重启。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File guardian.ps1
$ErrorActionPreference = "SilentlyContinue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
$monitorPidFile = Join-Path $stateDir "monitor.pid"
$guardianPidFile = Join-Path $stateDir "guardian.pid"
$logFile = Join-Path $stateDir "watch.log"

Set-Content -LiteralPath $guardianPidFile -Value $PID -Encoding Ascii

function Resolve-MonitorCommand {
  # 优先 node 版；没有 Node.js 时用 exe 版
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $stats = Join-Path $scriptDir "token-stats.mjs"
    if (-not (Test-Path -LiteralPath $stats)) { $stats = Join-Path $scriptDir "node-version\token-stats.mjs" }
    if (Test-Path -LiteralPath $stats) {
      return @{ File = $node.Source; Args = @('"' + $stats + '"', '--watch', '--cdp', '--port', '9229') }
    }
  }
  $exe = Join-Path $scriptDir "ccm-token-spend.exe"
  if (-not (Test-Path -LiteralPath $exe)) { $exe = Join-Path $scriptDir "exe-version\ccm-token-spend.exe" }
  if (Test-Path -LiteralPath $exe) {
    return @{ File = $exe; Args = @('--watch', '--cdp', '--port', '9229') }
  }
  return $null
}

function Test-MonitorRunning {
  if (-not (Test-Path -LiteralPath $monitorPidFile)) { return $false }
  $raw = Get-Content -LiteralPath $monitorPidFile -Raw -ErrorAction SilentlyContinue
  if ($raw -notmatch '^\s*\d+\s*$') { return $false }
  $procId = [int]$raw.Trim()
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  return $null -ne $proc
}

function Start-Monitor {
  $cmd = Resolve-MonitorCommand
  if (-not $cmd) { return }
  $p = Start-Process -FilePath $cmd.File -ArgumentList $cmd.Args -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError ($logFile + ".err") -PassThru
  if ($p) {
    Set-Content -LiteralPath $monitorPidFile -Value $p.Id -Encoding Ascii
  }
}

function Stop-Monitor {
  if (-not (Test-Path -LiteralPath $monitorPidFile)) { return }
  $raw = Get-Content -LiteralPath $monitorPidFile -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') {
    Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $monitorPidFile -Force -ErrorAction SilentlyContinue
}

while ($true) {
  $codex = Get-Process -Name "codex", "chatgpt" -ErrorAction SilentlyContinue | Select-Object -First 1
  $monitorRunning = Test-MonitorRunning
  if ($codex -and -not $monitorRunning) {
    Start-Monitor
  } elseif (-not $codex -and $monitorRunning) {
    Stop-Monitor
  }
  Start-Sleep -Seconds 2
}