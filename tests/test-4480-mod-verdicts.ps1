# Exercise PowerShell stream 1 in-process, not the child process stdout.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$mods = Join-Path $repo 'scripts/mods'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-4480-' + [guid]::NewGuid().ToString('n'))
$null = New-Item -ItemType Directory $tmp
$fail = 0
function Check($name, $ok) {
    if ($ok) { Write-Host "PASS $name" } else { Write-Host "FAIL $name"; $script:fail++ }
}
try {
    $log = Join-Path $tmp 'verdict.txt'
    $live = Join-Path $tmp 'live.txt'
    $ref = Join-Path $tmp 'reference.txt'
    Set-Content -LiteralPath $live -Value '*Extra.esp'
    Set-Content -LiteralPath $ref -Value '*Wanted.esp'
    & (Join-Path $mods 'Check-Plugins.ps1') -Live $live -Reference $ref > $log
    $code = $LASTEXITCODE
    $text = [IO.File]::ReadAllText($log)
    Check 'plugin differences and their names survive redirection, exit 1' ($code -eq 1 -and $text -match 'EXTRA.*\(1\)' -and $text -match 'MISSING.*\(1\)' -and $text -match 'Extra\.esp' -and $text -match 'Wanted\.esp')
    Copy-Item -LiteralPath $ref -Destination $live -Force
    & (Join-Path $mods 'Check-Plugins.ps1') -Live $live -Reference $ref > $log
    $code = $LASTEXITCODE
    $text = [IO.File]::ReadAllText($log)
    Check 'matching plugins survive redirection, exit 0' ($code -eq 0 -and $text -match 'EXTRA.*\(0\)' -and $text -match 'MISSING.*\(0\)')
    & (Join-Path $mods 'Find-MissingMasters.ps1') -Data (Join-Path $tmp 'absent') -Plugins $live -NoPause > $log
    $code = $LASTEXITCODE
    Check 'missing Data STOP survives redirection, exit 1' ($code -eq 1 -and [IO.File]::ReadAllText($log) -match 'STOP\. There is no Data folder')
    & (Join-Path $mods 'Check-CleanInstall.ps1') -List (Join-Path $tmp 'missing.txt') -Data $tmp -Manifest (Join-Path $tmp 'unused.json') > $log
    $code = $LASTEXITCODE
    Check 'clean-install refusal survives redirection, exit 2' ($code -eq 2 -and [IO.File]::ReadAllText($log) -match 'STOP\.')
    $icon = Join-Path $repo 'scripts/dev/Fix-Icons.ps1'
    $fixture = Join-Path $tmp 'icons.ps1'
    # Run the actual pause tail in a child. No shortcut, cache or Explorer work.
    $source = [IO.File]::ReadAllText($icon)
    $parameters = [regex]::Match($source, '(?ms)^param\(.*?\)\r?\n\r?\n').Value
    $end = $source.Substring($source.LastIndexOf("Head 'Done'"))
    [IO.File]::WriteAllText($fixture, $parameters + "function Head {} `nfunction Say {} `n" + $end)
    $out = & (Get-Process -Id $PID).Path -NoProfile -NonInteractive -File $fixture -Root $tmp -NoPause 2>&1 | Out-String
    Check ('Fix-Icons -NoPause finishes under -NonInteractive: ' + $out.Trim()) ($LASTEXITCODE -eq 0 -and $out -notmatch 'Read-Host|NonInteractive|parameter')
    $out = & (Get-Process -Id $PID).Path -NoProfile -NonInteractive -File $fixture -Root $tmp 2>&1 | Out-String
    Check 'Fix-Icons still attempts the pause by default' ($out -match 'Read-Host.*NonInteractive|NonInteractive.*Read and Prompt')
} finally { Remove-Item -LiteralPath $tmp -Recurse -Force }
if ($fail) { exit 1 }
