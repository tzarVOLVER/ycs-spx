$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot
$processFile = Join-Path $projectRoot '.local/process.json'
if (-not (Test-Path -LiteralPath $processFile)) { Write-Output 'No recorded development process.'; return }
$record = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
$developmentProcess = Get-Process -Id $record.id -ErrorAction SilentlyContinue
if (-not $developmentProcess) { Write-Output 'Development server already stopped.'; return }
if ($developmentProcess.Path -ne $record.executable -or $developmentProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne $record.startTicks) { throw 'Process identity changed. Check the development process manually.' }
Stop-Process -Id $developmentProcess.Id
Write-Output 'YCS development server stopped. Saved rundowns retained.'
