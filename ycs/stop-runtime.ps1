$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot
$recordFile = Join-Path $projectRoot '.local/runtime-process.json'
if (-not (Test-Path -LiteralPath $recordFile)) { Write-Output 'No recorded YCS runtime.'; return }
$record = Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json
$runtimeProcess = Get-Process -Id $record.id -ErrorAction SilentlyContinue
if (-not $runtimeProcess) { Write-Output 'YCS runtime already stopped.'; return }
if ($runtimeProcess.Path -ne $record.executable -or $runtimeProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne $record.startTicks) { throw 'Recorded process identity changed. No process was stopped.' }
Stop-Process -Id $runtimeProcess.Id
Write-Output 'YCS runtime stopped. Saved configuration and rundowns retained.'
