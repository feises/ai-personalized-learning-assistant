# 一键启动：“学伴AI”大学生个性化学习助手
# 用法：start.ps1 [-Server] [-Local] [-NoBrowser] [-NoWait] [-Port 8899]
param(
  [switch]$Server,     # 服务器模式：突出显示公网访问地址
  [switch]$Local,      # 仅本机访问（绑定 127.0.0.1）
  [switch]$NoBrowser,  # 不自动打开浏览器
  [switch]$NoWait,     # 结束后不等回车（供脚本调用）
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $AppDir 'scripts\net.ps1')

$cfg = Get-AppConfig -AppDir $AppDir
if ($Port -le 0) { $Port = $cfg.port }
$bindHost = if ($Local) { '127.0.0.1' } else { '0.0.0.0' }

Write-Host ''
Write-Host '  “学伴AI”大学生个性化学习助手' -ForegroundColor White
Write-Host '  -------------------------' -ForegroundColor DarkGray

# 1) 已启动则直接给出地址
if (Test-PortOpen -Port $Port) {
  Write-Host ('  服务已经在运行（端口 {0}），无需重复启动。' -f $Port) -ForegroundColor Yellow
  Write-Host ''
  Show-Addresses -Port $Port -AppDir $AppDir -PublicUrl $cfg.publicUrl -Local:$Local -Server:$Server
  if ($Server) {
    Write-Host ''
    Write-Host '  外部打不开时依次检查：① 云厂商安全组是否放行该端口；② 系统防火墙；③ server.host 是否为 0.0.0.0。' -ForegroundColor DarkGray
  }
  if (-not $NoBrowser) { Start-Process ('http://127.0.0.1:' + $Port) | Out-Null }
  if (-not $NoWait) { Write-Host ''; Read-Host '按回车键关闭此窗口' | Out-Null }
  exit 0
}

# 2) 找 Node
$nodeCandidates = @()
if ($env:NODE_EXE) { $nodeCandidates += $env:NODE_EXE }
# 便携版 Node：把 node.exe 放进包的 runtime 或 node 目录即可免安装运行
$nodeCandidates += (Join-Path $AppDir 'runtime\node.exe')
$nodeCandidates += (Join-Path $AppDir 'node\node.exe')
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $nodeCandidates += $cmd.Source }
$nodeCandidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
$nodeCandidates += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
$nodeCandidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
$nodeCandidates += (Join-Path $env:APPDATA 'nvm\current\node.exe')
if ($env:NVM_SYMLINK) { $nodeCandidates += (Join-Path $env:NVM_SYMLINK 'node.exe') }
if ($env:NVM_HOME) { $nodeCandidates += (Join-Path $env:NVM_HOME 'node.exe') }
$nodeCandidates += 'C:\nodejs\node.exe'
$nodeCandidates += 'C:\Program Files\nodejs\node.exe'
$node = $null
foreach ($c in $nodeCandidates) { if ($c -and (Test-Path -LiteralPath $c)) { $node = $c; break } }
if (-not $node) {
  Write-Host '  没有找到 Node.js，无法启动。' -ForegroundColor Red
  Write-Host '  请先安装 Node.js 18 或更高版本（推荐 20 LTS）：https://nodejs.org/zh-cn/download' -ForegroundColor Yellow
  Write-Host '  安装后重新双击“启动.bat”即可；如果 Node 装在别处，可设置环境变量 NODE_EXE 指向 node.exe。' -ForegroundColor Yellow
  if (-not $NoWait) { Read-Host '按回车键关闭此窗口' | Out-Null }
  exit 1
}

# 2.1) 版本检查：本项目用到 fetch 等特性，需要 Node 18 以上
try {
  $verText = (& $node -v) -replace '^v', ''
  $major = [int]($verText.Split('.')[0])
  if ($major -lt 18) {
    Write-Host ('  当前 Node.js 版本为 v{0}，版本过低。' -f $verText) -ForegroundColor Red
    Write-Host '  请升级到 Node.js 18 或更高版本（推荐 20 LTS）：https://nodejs.org/zh-cn/download' -ForegroundColor Yellow
    if (-not $NoWait) { Read-Host '按回车键关闭此窗口' | Out-Null }
    exit 1
  }
  Write-Host ('  Node.js v{0}' -f $verText) -ForegroundColor DarkGray
} catch {
  Write-Host '  无法检测 Node.js 版本，仍尝试启动…' -ForegroundColor DarkYellow
}

# 3) 端口被别的程序占用时先提示
$busy = Get-PortProcess -Port $Port
if ($busy.Count -gt 0) {
  Write-Host ('  端口 {0} 已被其它程序占用（进程 {1}）。' -f $Port, ($busy -join ', ')) -ForegroundColor Red
  Write-Host '  可以：① 双击“关闭.bat”后再启动；② 修改 config.local.json 里的 port。' -ForegroundColor DarkYellow
  if (-not $NoWait) { Read-Host '按回车键关闭此窗口' | Out-Null }
  exit 1
}

# 4) 启动（完全独立的后台进程，不占用当前控制台句柄；日志由服务自己写入 data\server.log）
$dataDir = Join-Path $AppDir 'data'
if (-not (Test-Path -LiteralPath $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
$env:HOST = $bindHost
$env:PORT = [string]$Port
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $node
$psi.Arguments = 'server.js'
$psi.WorkingDirectory = $AppDir
$psi.UseShellExecute = $true
$psi.WindowStyle = 'Hidden'
$proc = [System.Diagnostics.Process]::Start($psi)
$serverPid = $proc.Id

# 记录 PID，供关闭脚本使用
$runInfo = [pscustomobject]@{
  pid       = $serverPid
  port      = $Port
  host      = $bindHost
  mode      = if ($Local) { '仅本机' } elseif ($Server) { '服务器' } else { '局域网' }
  startedAt = (Get-Date).ToString('s')
}
$runInfo | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $AppDir '.run.pid') -Encoding UTF8

# 5) 等待服务就绪
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-PortOpen -Port $Port) { $ready = $true; break }
}

Write-Host ''
if ($ready) {
  Write-Host ('  启动成功（{0} 模式，端口 {1}，进程 {2}）' -f $runInfo.mode, $Port, $serverPid) -ForegroundColor Green
  Write-Host ''
  Show-Addresses -Port $Port -AppDir $AppDir -PublicUrl $cfg.publicUrl -Local:$Local -Server:$Server
  Write-AddressFile -Port $Port -AppDir $AppDir -PublicUrl $cfg.publicUrl -Local:$Local
  if ($Server) {
    $pub = @(Get-AccessUrls -Port $Port -AppDir $AppDir -PublicUrl $cfg.publicUrl | Where-Object { $_.Kind -eq 'public' })
    Write-Host ''
    if ($pub.Count -gt 0) {
      Write-Host '  ─────────────────────────────────────────────' -ForegroundColor DarkGray
      Write-Host ('  把这个地址发给别人： ' + $pub[0].Url) -ForegroundColor White
      Write-Host '  ─────────────────────────────────────────────' -ForegroundColor DarkGray
    } else {
      Write-Host '  没有探测到公网地址：请确认服务器能访问外网，或在 config.local.json 里设置 server.publicUrl。' -ForegroundColor DarkYellow
    }
    Write-Host '  外部打不开时依次检查：' -ForegroundColor DarkGray
    Write-Host ('    ① 云厂商安全组放行 TCP {0}；② 系统防火墙放行 TCP {0}；③ server.host 为 0.0.0.0' -f $Port) -ForegroundColor DarkGray
    Write-Host '  公网可访问意味着任何知道该地址的人都能打开；演示结束后建议在安全组里关闭该端口。' -ForegroundColor DarkYellow
  }
  $lans = @(Get-LanAddresses)
  if (-not $Local -and $lans.Count -gt 0) {
    # Windows 防火墙可能拦截外部访问，尝试放行
    $ruleName = ('学伴AI ' + $Port)
    $exists = $null
    try { $exists = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue } catch { $exists = $null }
    if (-not $exists) {
      $added = $false
      try {
        $profile = if ($Server) { 'Any' } else { 'Private' }
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile $profile -ErrorAction Stop | Out-Null
        $added = $true
      } catch { $added = $false }
      if ($added) {
        Write-Host ('  已在防火墙放行端口 {0}。' -f $Port) -ForegroundColor DarkGray
      } else {
        Write-Host '  防火墙未放行，用「管理员身份」运行一次下面这行：' -ForegroundColor DarkYellow
        Write-Host ('    netsh advfirewall firewall add rule name="学伴AI {0}" dir=in action=allow protocol=TCP localport={0}' -f $Port) -ForegroundColor DarkGray
      }
    }
  }
} else {
  Write-Host '  启动失败，最后几行日志：' -ForegroundColor Red
  $log = Join-Path $dataDir 'server.log'
  if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 12 | ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor DarkRed } }
  else { Write-Host '    （没有日志，请确认 Node 可用）' -ForegroundColor DarkRed }
}

if (-not $NoBrowser -and $ready) { Start-Process ('http://127.0.0.1:' + $Port) | Out-Null }
Write-Host ''
Write-Host '  关闭服务请双击“关闭.bat”，查看当前地址请双击“查看地址.bat”。' -ForegroundColor DarkGray
if (-not $NoWait) { Write-Host ''; Read-Host '按回车键关闭此窗口（服务会继续在后台运行）' | Out-Null }
