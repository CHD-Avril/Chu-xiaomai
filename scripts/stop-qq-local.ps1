$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$recordPath = Join-Path $projectRoot 'apps\user\qq-auth\processes.local'
if (!(Test-Path -LiteralPath $recordPath)) { Write-Host '没有本地 QQ 服务启动记录。'; return }
foreach ($record in @(Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json)) {
  $process = Get-Process -Id $record.Id -ErrorAction SilentlyContinue
  # A reused process ID must never stop an unrelated process.
  if ($process -and $process.StartTime.ToUniversalTime().ToString('o') -eq $record.StartTime) { Stop-Process -Id $process.Id }
}
Write-Host '本地 QQ 服务已停止。请关闭专用测试浏览器窗口。'
