# 查看当前访问地址：网络、公网 IP 变化后不需要重启，双击本脚本即可看到最新地址
param(
  [int]$Port = 0,
  [switch]$Force,   # 强制重新探测公网 IP（忽略 10 分钟缓存）
  [switch]$NoWait
)

$AppDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $AppDir 'scripts\net.ps1')

$cfg = Get-AppConfig -AppDir $AppDir
if ($Port -le 0) { $Port = $cfg.port }

Write-Host ''
Write-Host '  “学伴AI”大学生个性化学习助手 · 当前地址' -ForegroundColor White
Write-Host '  -----------------------------------' -ForegroundColor DarkGray

$isLocal = $false
$isServer = $false
if (Test-Path -LiteralPath (Join-Path $AppDir '.run.pid')) {
  try {
    $ri = Get-Content -LiteralPath (Join-Path $AppDir '.run.pid') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($ri.mode -eq '仅本机') { $isLocal = $true }
    if ($ri.mode -eq '服务器') { $isServer = $true }
  } catch { }
}
$running = Test-PortOpen -Port $Port
if ($running) {
  Write-Host ('  状态：运行中（端口 {0}）' -f $Port) -ForegroundColor Green
} else {
  Write-Host ('  状态：未运行（端口 {0} 空闲），请先双击“启动.bat”' -f $Port) -ForegroundColor Yellow
}
if ($Force -and -not $isLocal) { [void](Get-PublicIp -AppDir $AppDir -Force) }
Write-Host ''
Show-Addresses -Port $Port -AppDir $AppDir -PublicUrl $cfg.publicUrl -Local:$isLocal -Server:$isServer
Write-AddressFile -Port $Port -AppDir $AppDir -PublicUrl $cfg.publicUrl -Local:$isLocal
Write-Host ''
Write-Host '  地址已同步写入「当前地址.txt」。' -ForegroundColor DarkGray

if (-not $running) {
  if (-not $NoWait) { Write-Host ''; Read-Host '按回车键关闭此窗口' | Out-Null }
  exit 0
}

# 顺带确认服务可用
try {
  $res = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + '/api/auth/me') -UseBasicParsing -TimeoutSec 6
  if ($res.StatusCode -eq 200) { Write-Host ''; Write-Host '  服务响应正常。' -ForegroundColor Green }
} catch {
  Write-Host ''; Write-Host '  端口已监听但接口无响应，可双击“关闭.bat”后重新启动。' -ForegroundColor DarkYellow
}

Write-Host ''
if ($isLocal) {
  Write-Host '  当前是仅本机模式，其他设备无法访问；需要对外开放请用“启动-服务器.bat”。' -ForegroundColor DarkGray
} elseif ($isServer) {
  Write-Host '  公网地址变化后无需重启服务，重新运行本脚本即可看到最新地址。' -ForegroundColor DarkGray
  Write-Host '  外部打不开时依次检查：云厂商安全组、系统防火墙、server.host 是否为 0.0.0.0。' -ForegroundColor DarkGray
} else {
  Write-Host '  服务已监听全部网卡，换网络后直接使用上面新的地址即可，无需重启。' -ForegroundColor DarkGray
}
if (-not $NoWait) { Write-Host ''; Read-Host '按回车键关闭此窗口' | Out-Null }
