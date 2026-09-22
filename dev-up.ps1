# 一键启动本地开发环境：Mock QQ + 用户端 + 运营端
# 用法：powershell -ExecutionPolicy Bypass -File dev-up.ps1
# 或直接在 PowerShell 中执行 .\dev-up.ps1
$Root = $PSScriptRoot

Write-Host "[dev] 启动 Mock QQ 授权服务器 (端口 3000)" -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node `"$Root\apps\user\mock-qq\server.mjs`""

Start-Sleep -Seconds 2

Write-Host "[dev] 启动用户端 (http://localhost:5173)" -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$Root\apps\user`"; npm run dev"

Start-Sleep -Seconds 1

Write-Host "[dev] 启动运营端 (http://localhost:5174)" -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$Root\apps\admin`"; npm run dev"

Write-Host ""
Write-Host "[dev] 全部就绪：" -ForegroundColor Green
Write-Host "      Mock QQ 授权服务器: http://localhost:3000" -ForegroundColor Green
Write-Host "      用户端（手机/电脑双布局）: http://localhost:5173" -ForegroundColor Green
Write-Host "      运营端（Element Plus）: http://localhost:5174" -ForegroundColor Green
