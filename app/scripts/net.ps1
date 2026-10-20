# 公共工具：配置读取、网卡地址识别、公网 IP 探测、端口检测
# 被 start.ps1 / url.ps1 / stop.ps1 / pack.ps1 复用

function Get-AppConfig {
  param([string]$AppDir)
  $cfg = [ordered]@{ host = '0.0.0.0'; port = 8899; publicUrl = '' }
  $path = Join-Path $AppDir 'config.local.json'
  if (Test-Path -LiteralPath $path) {
    try {
      $json = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($json.server) {
        if ($json.server.host) { $cfg.host = [string]$json.server.host }
        if ($json.server.port) { $cfg.port = [int]$json.server.port }
        if ($json.server.publicUrl) { $cfg.publicUrl = [string]$json.server.publicUrl }
      }
    } catch { }
  }
  if ($env:PORT) { $cfg.port = [int]$env:PORT }
  if ($env:HOST) { $cfg.host = [string]$env:HOST }
  if ($env:PUBLIC_URL) { $cfg.publicUrl = [string]$env:PUBLIC_URL }
  return [pscustomobject]$cfg
}

# 判断是否为公网地址（排除回环、内网、链路本地、CGNAT、组播等）
function Test-PublicIPv4 {
  param([string]$Ip)
  if (-not $Ip) { return $false }
  if ($Ip -notmatch '^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$') { return $false }
  $o = $Ip.Split('.') | ForEach-Object { [int]$_ }
  if ($o[0] -eq 10) { return $false }
  if ($o[0] -eq 127) { return $false }
  if ($o[0] -eq 0) { return $false }
  if ($o[0] -eq 169 -and $o[1] -eq 254) { return $false }
  if ($o[0] -eq 172 -and $o[1] -ge 16 -and $o[1] -le 31) { return $false }
  if ($o[0] -eq 192 -and $o[1] -eq 168) { return $false }
  if ($o[0] -eq 100 -and $o[1] -ge 64 -and $o[1] -le 127) { return $false }
  if ($o[0] -eq 192 -and $o[1] -eq 0 -and $o[2] -eq 2) { return $false }
  if ($o[0] -eq 198 -and $o[1] -eq 18) { return $false }
  if ($o[0] -eq 198 -and $o[1] -eq 19) { return $false }
  if ($o[0] -ge 224) { return $false }
  return $true
}

# 返回网卡上直接配置的公网 IPv4（有些服务器是直接绑公网 IP 的）
function Get-NicPublicAddresses {
  $result = @()
  try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop
  } catch {
    $ips = @()
    try {
      $ips = Get-WmiObject Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True' -ErrorAction Stop |
        ForEach-Object { foreach ($ip in $_.IPAddress) { if ($ip -notmatch ':') { [pscustomobject]@{ IPAddress = $ip; InterfaceAlias = $_.Description } } } }
    } catch { }
  }
  foreach ($ip in $ips) {
    $addr = [string]$ip.IPAddress
    if (Test-PublicIPv4 -Ip $addr) { $result += [pscustomobject]@{ Address = $addr; Alias = [string]$ip.InterfaceAlias } }
  }
  return @($result)
}

# 返回当前可用的内网 IPv4（已过滤回环与虚拟网卡，并按常见内网段排序）
function Get-LanAddresses {
  $skip = 'Loopback|Virtual|VMware|VirtualBox|Hyper-V|vEthernet|WSL|Bluetooth|TAP|Npcap|ZeroTier|Tailscale|Docker'
  $result = @()
  try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop
  } catch {
    $ips = @()
    try {
      $ips = Get-WmiObject Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True' -ErrorAction Stop |
        ForEach-Object { foreach ($ip in $_.IPAddress) { if ($ip -notmatch ':') { [pscustomobject]@{ IPAddress = $ip; InterfaceAlias = $_.Description } } } }
    } catch { }
  }
  $gateways = @()
  try {
    $gateways = (Get-NetIPConfiguration -ErrorAction Stop | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object { $_.IPv4Address.IPAddress })
  } catch { }
  foreach ($ip in $ips) {
    $addr = [string]$ip.IPAddress
    $alias = [string]$ip.InterfaceAlias
    if (-not $addr) { continue }
    if ($addr -eq '127.0.0.1' -or $addr -eq '0.0.0.0') { continue }
    if ($addr -like '169.254.*') { continue }
    # 198.18.0.0/15 是保留的基准测试网段，代理软件（如 Clash 的 fake-ip）常占用，并非真实内网地址
    if ($addr -match '^198\.(18|19)\.') { continue }
    if (Test-PublicIPv4 -Ip $addr) { continue }
    if ($alias -match $skip) { continue }
    $score = 0
    if ($addr -like '192.168.*') { $score = 300 }
    elseif ($addr -like '10.*') { $score = 200 }
    elseif ($addr -match '^172\.(1[6-9]|2[0-9]|3[01])\.') { $score = 100 }
    else { $score = 50 }
    if ($gateways -contains $addr) { $score += 60 }
    $result += [pscustomobject]@{ Address = $addr; Alias = $alias; Score = $score }
  }
  return @($result | Sort-Object -Property Score -Descending)
}

# 探测公网 IP：优先网卡上的公网地址，其次查外部接口；结果缓存 10 分钟，避免每次启动都联网
function Get-PublicIp {
  param([string]$AppDir, [switch]$Force)
  $cacheFile = Join-Path $AppDir '.public-ip.json'
  if (-not $Force -and (Test-Path -LiteralPath $cacheFile)) {
    try {
      $cached = Get-Content -LiteralPath $cacheFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($cached.ip -and $cached.at) {
        $age = (New-TimeSpan -Start ([datetime]$cached.at) -End (Get-Date)).TotalMinutes
        if ($age -ge 0 -and $age -lt 10) { return [string]$cached.ip }
      }
    } catch { }
  }

  $nic = Get-NicPublicAddresses
  if ($nic.Count -gt 0) {
    $ip = $nic[0].Address
    try { [pscustomobject]@{ ip = $ip; at = (Get-Date).ToString('s') } | ConvertTo-Json | Set-Content -LiteralPath $cacheFile -Encoding UTF8 } catch { }
    return $ip
  }

  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
  $endpoints = @(
    'https://api.ipify.org',
    'https://ifconfig.me/ip',
    'https://ipinfo.io/ip',
    'http://ip.3322.net',
    'https://myip.ipip.net'
  )
  foreach ($url in $endpoints) {
    try {
      $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -Headers @{ 'User-Agent' = 'curl/8' }
      $m = [regex]::Match([string]$resp.Content, '\b(?:\d{1,3}\.){3}\d{1,3}\b')
      if ($m.Success -and (Test-PublicIPv4 -Ip $m.Value)) {
        $ip = $m.Value
        try { [pscustomobject]@{ ip = $ip; at = (Get-Date).ToString('s') } | ConvertTo-Json | Set-Content -LiteralPath $cacheFile -Encoding UTF8 } catch { }
        return $ip
      }
    } catch { }
  }
  return ''
}

function Test-PortOpen {
  param([string]$TargetHost = '127.0.0.1', [int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect($TargetHost, $Port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(700)
    if ($ok) { $client.EndConnect($async) }
    $client.Close()
    return $ok
  } catch { return $false }
}

# 找出占用端口的进程（用于关闭服务，避免误杀其它 node 进程）
function Get-PortProcess {
  param([int]$Port)
  $pids = @()
  try {
    $pids = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    try {
      $lines = netstat -ano | Select-String -Pattern (':' + $Port + '\s') | Select-String -Pattern 'LISTENING'
      foreach ($l in $lines) {
        $parts = ($l.ToString() -split '\s+') | Where-Object { $_ -ne '' }
        if ($parts.Length -ge 5) { $pids += [int]$parts[-1] }
      }
      $pids = $pids | Select-Object -Unique
    } catch { }
  }
  return $pids
}

# 汇总所有可访问地址：返回 {Label, Url, Kind} 列表（Kind: public / local / lan）
function Get-AccessUrls {
  param([int]$Port, [string]$AppDir, [string]$PublicUrl, [switch]$NoPublic)
  $list = @()
  if ($PublicUrl) {
    $list += [pscustomobject]@{ Label = '对外访问'; Url = $PublicUrl.TrimEnd('/'); Kind = 'public' }
  } elseif (-not $NoPublic) {
    $ip = Get-PublicIp -AppDir $AppDir
    if ($ip) { $list += [pscustomobject]@{ Label = '公网访问'; Url = ('http://' + $ip + ':' + $Port); Kind = 'public' } }
  }
  $list += [pscustomobject]@{ Label = '本机访问'; Url = ('http://127.0.0.1:' + $Port); Kind = 'local' }
  if (-not $NoPublic) {
    foreach ($lan in @(Get-LanAddresses)) {
      $list += [pscustomobject]@{ Label = '内网访问'; Url = ('http://' + $lan.Address + ':' + $Port); Kind = 'lan' }
    }
  }
  return @($list)
}

function Show-Addresses {
  param([int]$Port, [string]$AppDir, [string]$PublicUrl, [switch]$NoTitle, [switch]$Local, [switch]$Server)
  if (-not $NoTitle) { Write-Host '可访问地址：' -ForegroundColor Cyan }
  if ($Local) {
    Write-Host ("  本机        http://127.0.0.1:{0}" -f $Port) -ForegroundColor Green
    Write-Host '  仅本机模式：手机 / 其他电脑无法访问' -ForegroundColor DarkGray
    return
  }
  $urls = Get-AccessUrls -Port $Port -AppDir $AppDir -PublicUrl $PublicUrl
  $hasPublic = $false
  foreach ($u in $urls) {
    $color = if ($u.Kind -eq 'public') { 'Cyan' } elseif ($u.Kind -eq 'local') { 'Green' } else { 'DarkGray' }
    Write-Host ("  {0}  {1}" -f $u.Label.PadRight(10), $u.Url) -ForegroundColor $color
    if ($u.Kind -eq 'public') { $hasPublic = $true }
  }
  if (-not $hasPublic) {
    Write-Host '  公网访问    未探测到（服务器可能未联网，或未配置 server.publicUrl）' -ForegroundColor DarkYellow
  }
  if ($Server) {
    Write-Host '  内网地址仅供服务器内部使用；公网访问需在云厂商安全组与系统防火墙放行该端口。' -ForegroundColor DarkGray
  }
}

# 把当前地址写到项目根目录的「当前地址.txt」，方便演示时直接查看
function Write-AddressFile {
  param([int]$Port, [string]$AppDir, [string]$PublicUrl, [switch]$Local)
  $running = Test-PortOpen -Port $Port
  $lines = @()
  $lines += 'AI 大学生个性化学习助手 · 当前访问地址'
  $lines += ('更新时间：' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
  if ($running) { $lines += '服务状态：运行中' } else { $lines += '服务状态：未运行（请先双击“启动.bat”）' }
  $lines += ('运行模式：' + $(if ($Local) { '仅本机' } else { '对外可访问' }))
  $lines += ''
  if ($Local) {
    $lines += ('本机访问：    http://127.0.0.1:' + $Port)
    $lines += '外部访问：    仅本机模式，其他设备无法访问'
  } else {
    foreach ($u in @(Get-AccessUrls -Port $Port -AppDir $AppDir -PublicUrl $PublicUrl)) {
      $pad = if ($u.Label -eq '对外访问' -or $u.Label -eq '公网访问') { '公网访问：    ' } elseif ($u.Label -eq '本机访问') { '本机访问：    ' } else { '内网访问：    ' }
      $lines += ($pad + $u.Url)
    }
    $lines += ''
    $lines += '说明：公网地址来自网卡公网 IP 或外部接口探测；若使用了域名或反向代理，可在 config.local.json 里设置 server.publicUrl。'
    $lines += '公网可访问意味着任何知道该地址的人都能打开，演示结束后请在安全组里关闭端口。'
  }
  try { Set-Content -LiteralPath (Join-Path $AppDir '当前地址.txt') -Value $lines -Encoding UTF8 } catch { }
}
