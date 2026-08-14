# ccm-token-spend 守护进程
# 作用：Codex 桌面版运行时自动启动 Token 监控；Codex 退出后自动停止；监控崩溃后自动重启。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File guardian.ps1
# 日志：%LOCALAPPDATA%\ccm-token-spend\guardian.log（检测 Codex / 启动停止监控 / 失败原因）

$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$stateDir = Join-Path $env:LOCALAPPDATA "ccm-token-spend"
if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
$watchLog = Join-Path $stateDir "watch.log"
$guardianLog = Join-Path $stateDir "guardian.log"
$monitorPidFile = Join-Path $stateDir "monitor.pid"
$guardianPidFile = Join-Path $stateDir "guardian.pid"
$lockFile = Join-Path $stateDir "guardian.lock"
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Log {
  param([string]$Message)
  try {
    $item = Get-Item -LiteralPath $guardianLog -ErrorAction SilentlyContinue
    if ($item -and $item.Length -gt 512KB) {
      Move-Item -LiteralPath $guardianLog -Destination ($guardianLog + ".old") -Force -ErrorAction SilentlyContinue
    }
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    [System.IO.File]::AppendAllText($guardianLog, $line + [Environment]::NewLine, $utf8)
  } catch {}
}

# 单实例锁：计划任务 + 启动文件夹快捷方式可能同时拉起，先到者持有锁，后到者直接退出。
$global:guardianLock = $null
try {
  $global:guardianLock = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
} catch {
  Write-Log "已有守护进程在运行，本实例退出。"
  exit 0
}

Set-Content -LiteralPath $guardianPidFile -Value $PID -Encoding Ascii
Write-Log ("守护进程启动 (PID " + $PID + ")，脚本目录: " + $scriptDir)

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
  if (-not $cmd) {
    Write-Log ("启动监控失败：未找到 token-stats.mjs 或 ccm-token-spend.exe（脚本目录: " + $scriptDir + "）")
    return
  }
  try {
    $p = Start-Process -FilePath $cmd.File -ArgumentList $cmd.Args -WindowStyle Hidden -RedirectStandardOutput $watchLog -RedirectStandardError ($watchLog + ".err") -PassThru
    if ($p) {
      Set-Content -LiteralPath $monitorPidFile -Value $p.Id -Encoding Ascii
      Write-Log ("已启动监控 (PID " + $p.Id + ")")
    } else {
      Write-Log "启动监控失败：Start-Process 未返回进程对象"
    }
  } catch {
    Write-Log ("启动监控失败：" + $_.Exception.Message)
  }
}

function Stop-Monitor {
  if (-not (Test-Path -LiteralPath $monitorPidFile)) { return }
  $raw = Get-Content -LiteralPath $monitorPidFile -Raw -ErrorAction SilentlyContinue
  if ($raw -match '^\s*(\d+)\s*$') {
    try {
      Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue
      Write-Log ("已停止监控 (PID " + $Matches[1] + ")")
    } catch {
      Write-Log ("停止监控失败 (PID " + $Matches[1] + ")：" + $_.Exception.Message)
    }
  }
  Remove-Item -LiteralPath $monitorPidFile -Force -ErrorAction SilentlyContinue
}

while ($true) {
  try {
    $codex = Get-Process -Name "codex", "chatgpt" -ErrorAction SilentlyContinue | Select-Object -First 1
    $monitorRunning = Test-MonitorRunning
    if ($codex -and -not $monitorRunning) {
      if (Test-Path -LiteralPath $monitorPidFile) {
        Write-Log "检测到监控进程已退出，重新启动监控…"
      } else {
        Write-Log ("检测到 Codex 进程 (" + $codex.ProcessName + ", PID " + $codex.Id + ")，启动监控…")
      }
      Start-Monitor
    } elseif (-not $codex -and $monitorRunning) {
      Write-Log "Codex 已退出，停止监控…"
      Stop-Monitor
    }
  } catch {
    Write-Log ("守护循环异常：" + $_.Exception.Message)
  }
  Start-Sleep -Seconds 2
}
