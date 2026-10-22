# Start the real QQ flow entirely on this PC, using an isolated Edge profile.
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$userRoot = Join-Path $projectRoot 'apps\user'
$authRoot = Join-Path $userRoot 'qq-auth'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$vitePath = Join-Path $userRoot 'node_modules\vite\bin\vite.js'
if (!(Test-Path -LiteralPath (Join-Path $authRoot '.env.local'))) { throw '请先将 qq-auth/.env.example 复制为 .env.local 并填写 QQ 配置。' }
foreach ($port in @(3000, 5173, 443)) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "本机端口 $port 已占用。请先关闭旧开发服务，避免打开错误的预览。" }
}
$started = @()
try {
  $services = @(
    @{ Name='auth'; Script=(Join-Path $authRoot 'index.mjs') },
    @{ Name='vite'; Script=$vitePath },
    @{ Name='https'; Script=(Join-Path $authRoot 'local-https.mjs') }
  )
  foreach ($service in $services) {
    $process = Start-Process -FilePath $nodePath -ArgumentList @('"' + $service.Script + '"') -WorkingDirectory $userRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $authRoot ($service.Name + '.out.log')) -RedirectStandardError (Join-Path $authRoot ($service.Name + '.err.log')) -PassThru
    $started += $process
  }
  $deadline = (Get-Date).AddSeconds(25)
  do {
    if ($started | Where-Object { $_.HasExited }) { throw '本地服务启动失败，请查看 qq-auth/*.err.log。' }
    $listeners = @(Get-NetTCPConnection -LocalPort 3000,5173,443 -State Listen -ErrorAction SilentlyContinue)
    if (($listeners.LocalPort | Select-Object -Unique).Count -eq 3) { break }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  if (($listeners.LocalPort | Select-Object -Unique).Count -ne 3) { throw '等待本地服务启动超时。' }
  $started | ForEach-Object { @{ Id=$_.Id; StartTime=$_.StartTime.ToUniversalTime().ToString('o') } } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $authRoot 'processes.local') -Encoding utf8
  if (!$NoBrowser) {
    & (Join-Path $PSScriptRoot 'open-qq-local.ps1')
  }
  Write-Host '本地 QQ 登录已启动：请只在专用测试浏览器中访问 https://chuxiaomai.cyou/' -ForegroundColor Green
  Write-Host '网页和 QQ 回调均回到本机；没有发布云端、修改系统 hosts 或安装信任证书。'
  Write-Host '停止服务：powershell -ExecutionPolicy Bypass -File scripts/stop-qq-local.ps1'
} catch {
  foreach ($process in $started) { if (!$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue } }
  throw
}
