param([ValidateSet('real', 'mock')][string]$QqMode = 'real')
$ErrorActionPreference = 'Stop'
if ($QqMode -eq 'real') {
  & (Join-Path $PSScriptRoot 'scripts\start-qq-local.ps1')
  return
}
$userRoot = Join-Path $PSScriptRoot 'apps\user'
$nodePath = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $nodePath -ArgumentList @('"' + (Join-Path $userRoot 'qq-auth\index.mjs') + '"', '--mock') -WorkingDirectory $userRoot -WindowStyle Hidden
Start-Process -FilePath $nodePath -ArgumentList @('"' + (Join-Path $userRoot 'node_modules\vite\bin\vite.js') + '"') -WorkingDirectory $userRoot -WindowStyle Hidden
Write-Host 'Mock QQ ready: http://localhost:5173 (simulated accounts only)'
