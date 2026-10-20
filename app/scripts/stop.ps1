# 一键关闭：停止本项目的服务进程（只结束占用该项目端口的进程，不影响其它 node 程序）
param(
  [int]$Port = 0,
  [switch]$NoWait
)

$ErrorActionPreference = 'Continue'
$AppDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $AppDir 'scripts\net.ps1')

$cfg = Get-AppConfig -AppDir $AppDir
if ($Port -le 0) { $Port = $cfg.port }

Write-Host ''
Write-Host '  AI 大学生个性化学习助手 · 关闭' -ForegroundColor White
Write-Host '  -------------------------------' -ForegroundColor DarkGray

$targets = @()

# 优先使用启动时记录的 PID，并核对该进程确实是本项目的 node server.js
$pidFile = Join-Path $AppDir '.run.pid'
if (Test-Path -LiteralPath $pidFile) {
  try {
    $info = Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $p = Get-Process -Id ([int]$info.pid) -ErrorAction SilentlyContinue
    if ($p) {
      $isOurs = $true
      try {
        $wmi = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.Id) -ErrorAction SilentlyContinue
        if ($wmi -and $wmi.CommandLine -and $wmi.CommandLine -notmatch 'server\.js') { $isOurs = $false }
      } catch { }
      if ($isOurs) { $targets += $p.Id }
    }
  } catch { }
}

# 再用端口兜底（例如手动用 node server.js 启动的情况）
foreach ($procId in (Get-PortProcess -Port $Port)) {
  if ($targets -notcontains $procId) { $targets += $procId }
}

if ($targets.Count -eq 0) {
  Write-Host ('  服务未在运行（端口 {0} 空闲）。' -f $Port) -ForegroundColor Yellow
  if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
  if (-not $NoWait) { Write-Host ''; Read-Host '按回车键关闭此窗口' | Out-Null }
  exit 0
}

foreach ($procId in $targets) {
  try {
    $p = Get-Process -Id $procId -ErrorAction Stop
    Stop-Process -Id $procId -Force
    Write-Host ('  已结束进程 {0}（{1}）' -f $procId, $p.ProcessName) -ForegroundColor Green
  } catch {
    Write-Host ('  进程 {0} 结束失败或已退出' -f $procId) -ForegroundColor DarkYellow
  }
}

# 等待端口释放
$freed = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 300
  if (-not (Test-PortOpen -Port $Port)) { $freed = $true; break }
}

Write-Host ''
if ($freed) {
  Write-Host ('  已关闭（端口 {0} 已释放）。' -f $Port) -ForegroundColor Green
  if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
} else {
  Write-Host ('  端口 {0} 仍被占用，请重试或手动结束占用进程。' -f $Port) -ForegroundColor Red
}
if (-not $NoWait) { Write-Host ''; Read-Host '按回车键关闭此窗口' | Out-Null }
