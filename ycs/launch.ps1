param([string]$Config = '.local/ycs-dev.json', [string]$NodePath = '', [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
try {
    $projectRoot = Split-Path $PSScriptRoot
    if (-not $NodePath) {
        $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
        if ($nodeCommand) { $NodePath = $nodeCommand.Source }
        else {
            # Explorer may not have the same PATH as a development terminal.
            $recordFile = Join-Path $projectRoot '.local/runtime-process.json'
            if (Test-Path -LiteralPath $recordFile) {
                $record = Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json
                if (Test-Path -LiteralPath $record.executable -PathType Leaf) { $NodePath = $record.executable }
            }
        }
        if (-not $NodePath) { throw 'Node.js was not found. Install Node.js or pass -NodePath with its full path.' }
    }
    & (Join-Path $PSScriptRoot 'start-runtime.ps1') -Config $Config -NodePath $NodePath
    $configurationPath = if ([IO.Path]::IsPathRooted($Config)) { $Config } else { Join-Path $projectRoot $Config }
    $configuration = Get-Content -LiteralPath $configurationPath -Raw | ConvertFrom-Json
    if (-not $NoBrowser) {
        Start-Process -FilePath ('http://127.0.0.1:' + [int]$configuration.general.port + '/')
    }
} catch {
    Write-Host ('Could not launch SPX: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
