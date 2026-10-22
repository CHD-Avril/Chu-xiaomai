$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$authRoot = Join-Path $projectRoot 'apps\user\qq-auth'
$browserPath = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', 'C:\Program Files\Microsoft\Edge\Application\msedge.exe', 'C:\Program Files\Google\Chrome\Application\chrome.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$browserPath) { throw '未找到 Edge / Chrome。' }
$spki = (Get-Content -LiteralPath (Join-Path $authRoot 'browser-cert.local') -Raw).Trim()
if (!(Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue)) { throw '请先启动本地 QQ 服务。' }
$browserArguments = @(
  ('--user-data-dir="' + (Join-Path $authRoot '.browser.local') + '"')
  '--host-resolver-rules="MAP chuxiaomai.cyou 127.0.0.1"'
  ('--ignore-certificate-errors-spki-list=' + $spki)
  '--no-proxy-server'
  '--no-first-run'
  '--no-default-browser-check'
  '--disable-sync'
  '--new-window'
  'https://chuxiaomai.cyou/'
)
# Intentionally visible: the user performs QQ authorization in this window.
Start-Process -FilePath $browserPath -ArgumentList $browserArguments
