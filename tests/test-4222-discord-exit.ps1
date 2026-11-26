# Offline: exercise the Python CLI with a fake client, then exercise the real
# local wrapper's verdict and webhook hand-over with a stub, never Discord.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$python = Get-Command python, python3 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $python) { throw 'Python is required for the offline Discord fixture.' }
& $python.Source (Join-Path $PSScriptRoot 'test-4222-discord-exit.py')
$pythonCode = $LASTEXITCODE

$source = [IO.File]::ReadAllText((Join-Path $repo 'scripts/deploy/Apply-Discord.ps1'))
$start = [regex]::Match($source, '(?m)^  \$env:THORNSWOOD_OPEN = \$null\r?\n\}\r?\n')
if (-not $start.Success) { throw 'Cannot find the local setup verdict after cleanup.' }
$tail = $source.Substring($start.Index + $start.Length)
$temp = Join-Path ([IO.Path]::GetTempPath()) ('discord-exit-' + [guid]::NewGuid().ToString('N'))
$deploy = Join-Path $temp 'scripts/deploy'
$ops = Join-Path $temp 'scripts/ops'
$bot = Join-Path $temp 'bot'
$failed = 0
try {
    $null = New-Item -ItemType Directory -Force -Path $deploy, $ops, $bot
    Set-Content -LiteralPath (Join-Path $bot 'news-webhook.txt') -Value 'offline stand-in'
    Set-Content -LiteralPath (Join-Path $ops 'Discord-Hook.ps1') -Value 'Write-Host "HOOK STUB"; exit 0'
    $fixture = Join-Path $deploy 'fixture.ps1'
    Set-Content -LiteralPath $fixture -Value ('param($code, [switch]$Check, [switch]$Audit, [switch]$Whole)' + "`n" + '$Here = $PSScriptRoot; $gives = @()' + "`n" + $tail)
    foreach ($case in @(
        @{ Name = 'failed build'; Args = @(7); Code = 7; Hook = $false; Error = $true },
        @{ Name = 'failed audit'; Args = @(7, '-Audit'); Code = 7; Hook = $false; Error = $true },
        @{ Name = 'successful whole build'; Args = @(0, '-Whole'); Code = 0; Hook = $true; Error = $false },
        @{ Name = 'successful change run, no webhook (#6961)'; Args = @(0); Code = 0; Hook = $false; Error = $false },
        @{ Name = 'successful audit'; Args = @(0, '-Audit'); Code = 0; Hook = $false; Error = $false },
        @{ Name = 'failed check'; Args = @(7, '-Check'); Code = 7; Hook = $false; Error = $true }
    )) {
        $params = @{code = $case.Args[0]; Audit = ($case.Args -contains '-Audit'); Check = ($case.Args -contains '-Check'); Whole = ($case.Args -contains '-Whole')}
        $log = (& $fixture @params 6>&1 | Out-String)
        $rc = $LASTEXITCODE
        if ($rc -ne $case.Code -or ($log -match 'HOOK STUB') -ne $case.Hook -or
            ($log -match 'ended with exit 7') -ne $case.Error) {
            Write-Host "FAIL $($case.Name): exit $rc, output: $log"
            $failed++
        } else {
            Write-Host "PASS $($case.Name)"
        }
    }
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force
}
if ($failed -or $pythonCode) { exit 1 }
