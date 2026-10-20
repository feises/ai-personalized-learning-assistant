# 打包便携版：生成一个可以拷到别的电脑直接运行的 zip
# 用法：pack.ps1 [-WithoutKey] [-OutDir <目录>]
param(
  [switch]$WithoutKey,   # 清空 API 密钥，收到包的人自己填
  [string]$OutDir = '',
  [switch]$NoWait
)

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $AppDir 'scripts\net.ps1')

Write-Host ''
Write-Host '  “学伴AI”大学生个性化学习助手 · 打包便携版' -ForegroundColor White
Write-Host '  -------------------------------------' -ForegroundColor DarkGray

# Node 仅用于打包前处理，没有也能打包（只是不清会话/日志）
$nodeCandidates = @()
if ($env:NODE_EXE) { $nodeCandidates += $env:NODE_EXE }
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $nodeCandidates += $cmd.Source }
$nodeCandidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
$nodeCandidates += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
$nodeCandidates += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
$node = $null
foreach ($c in $nodeCandidates) { if ($c -and (Test-Path -LiteralPath $c)) { $node = $c; break } }

$pkgName = if ($WithoutKey) { '学伴AI-便携版-不含密钥' } else { '学伴AI-便携版' }
if (-not $OutDir) { $OutDir = Split-Path -Parent $AppDir }
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$zipPath = Join-Path $OutDir ($pkgName + '.zip')
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

# 是否自带 Node（把 node.exe 放进 runtime\ 或 node\ 就会一起打包）
$bundledNode = $null
foreach ($c in @((Join-Path $AppDir 'runtime\node.exe'), (Join-Path $AppDir 'node\node.exe'))) {
  if (Test-Path -LiteralPath $c) { $bundledNode = $c; break }
}
if ($bundledNode) {
  Write-Host ('  检测到自带 Node：' + $bundledNode + '（会一起打包，目标电脑无需安装 Node）') -ForegroundColor Cyan
} else {
  Write-Host '  未自带 Node：目标电脑需要安装 Node.js 18+，或先把 node.exe 放进 runtime\ 再重新打包' -ForegroundColor DarkGray
}

$stage = Join-Path $env:TEMP ('pack_' + [Guid]::NewGuid().ToString('N'))
$dest = Join-Path $stage $pkgName
New-Item -ItemType Directory -Path $dest -Force | Out-Null

Write-Host '  正在收集文件…' -ForegroundColor DarkGray
$xd = @('node_modules', '.git', 'edge-profile', 'shots')
$xf = @('.run.pid', '当前地址.txt', '.public-ip.json')
& robocopy $AppDir $dest /E /NFL /NDL /NJH /NJS /NP /XD $xd /XF $xf | Out-Null
# 环境变量模板一并放进去，收到包的人既能改 config.local.json，也能用 .env
$envSample = Join-Path (Split-Path -Parent $AppDir) '.env.example'
if (Test-Path -LiteralPath $envSample) { Copy-Item -LiteralPath $envSample -Destination (Join-Path $dest '.env.example') -Force }
if ($LASTEXITCODE -ge 8) {
  Write-Host '  复制失败（robocopy 错误码 ' + $LASTEXITCODE + '）' -ForegroundColor Red
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  if (-not $NoWait) { Read-Host '按回车键关闭此窗口' | Out-Null }
  exit 1
}

# 清理运行痕迹、可选清空密钥
if ($node) {
  $args = @((Join-Path $dest 'scripts\prepare-package.js'), $dest)
  if ($WithoutKey) { $args += 'strip-key' }
  & $node @args
} else {
  Write-Host '  未找到 Node.js，跳过运行痕迹清理（不影响使用）' -ForegroundColor DarkYellow
}

# 使用说明
$readme = @()
$readme += '“学伴AI”大学生个性化学习助手 · 便携版'
$readme += ''
$readme += '【运行前提】这台电脑需要安装 Node.js 18 或更高版本（推荐 20 LTS）'
$readme += '  下载地址：https://nodejs.org/zh-cn/download'
$readme += '  安装后无需任何额外配置，本项目没有任何第三方依赖。'
$readme += '  如果这台电脑不能安装 Node：下载 Node 的 zip 版，把 node.exe 放到本包的 runtime 文件夹里，'
$readme += '  启动.bat 会自动使用它，不需要配置环境变量。'
$readme += ''
$readme += '【怎么用】双击 启动.bat，浏览器会自动打开；关闭请双击 关闭.bat。'
$readme += '  启动.bat          局域网模式：手机 / 其他电脑也能访问，自动识别当前 IP'
$readme += '  启动-服务器.bat    部署在公网服务器时用：启动后显示公网访问地址'
$readme += '  启动-仅本机.bat    只允许本机访问'
$readme += '  查看地址.bat       换了网络或 IP 变了，双击它看最新地址（不用重启）'
$readme += '  关闭.bat          停止服务'
$readme += '  当前地址.txt       启动后会自动生成，里面是当前可用网址'
$readme += ''
$readme += '【演示账号】demo / demo123456（已带一份示例资料、学习计划与记录）'
$readme += '           也可以点「注册」用新账号从零体验。'
$readme += ''
if ($WithoutKey) {
  $readme += '【重要】本包未包含 API 密钥。启动前二选一填写：'
  $readme += '  ① 打开 config.local.json，在 ai.apiKey 里填上你的密钥；'
  $readme += '  ② 或把 .env.example 复制成 .env，在 AI_API_KEY= 后面填上密钥。'
} else {
  $readme += '【重要】本包内含 API 密钥（config.local.json 或 .env），仅限本人演示使用，不要外传或上传到公开仓库。'
}
$readme += '  换模型或服务商时只改这两处之一（或设置环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL），代码无需改动。'
$readme += ''
$readme += '【手机打不开怎么办】首次局域网访问会被 Windows 防火墙拦截，用管理员身份运行一次：'
$readme += '  netsh advfirewall firewall add rule name="学伴AI 8899" dir=in action=allow protocol=TCP localport=8899'
$readme += ''
$readme += '【端口被占用】修改 config.local.json 里的 server.port 即可（例如 8900）。'
$readme += ''
$readme += '【数据在哪】data/db.json 是全部业务数据；连同 data/uploads 一起删掉即可清空重来。'
Set-Content -LiteralPath (Join-Path $dest '使用说明.txt') -Value $readme -Encoding UTF8

Write-Host '  正在压缩…' -ForegroundColor DarkGray
Compress-Archive -Path $dest -DestinationPath $zipPath -CompressionLevel Optimal -Force
Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue

$sizeMB = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 2)
Write-Host ''
Write-Host ('  打包完成：' + $zipPath) -ForegroundColor Green
Write-Host ('  大小：' + $sizeMB + ' MB') -ForegroundColor DarkGray
Write-Host ''
Write-Host '  拿到包的电脑只需：解压 → 安装 Node.js 18+ → 双击 启动.bat' -ForegroundColor Cyan
if (-not $WithoutKey) {
  Write-Host '  提醒：包内含 API 密钥，请勿外传。对外交付请改用 -WithoutKey 参数重新打包。' -ForegroundColor DarkYellow
}
if (-not $NoWait) { Write-Host ''; Read-Host '按回车键关闭此窗口' | Out-Null }
