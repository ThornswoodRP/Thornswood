<#
  test-4168-fresh-own-folders.ps1

      pwsh -NoProfile -File .\tests\test-4168-fresh-own-folders.ps1

  tests\test-2309-loadorder-fresh.ps1 stands for a fresh checkout, and used
  to read the user data of the machine it ran on (#4168). Where.ps1 finds this
  machine's own data under LOCALAPPDATA, and a Ship machine records its engine
  build there (engine-build.json, written by Setup-ShipMachine.ps1). On such a
  machine Where.ps1 ServerDist followed that record to CI's build of a pin the
  scratch checkout has no record of, and the test stopped before its 25 load
  order checks.

  HOW. A folder stands in for a used machine's LOCALAPPDATA and APPDATA, with
  the records a Ship machine leaves there, and the fresh test runs as a child
  under it, as it would on that machine. It has to pass every check, under
  each record, and leave that folder as it found it.

  Everything it writes is in its own temp folder.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Shell = (Get-Process -Id $PID).Path
$Fresh = Join-Path (Join-Path $Repo 'tests') 'test-2309-loadorder-fresh.ps1'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}
# Every file under $dir with its bytes, to tell whether a run changed any.
function Snapshot([string]$dir) {
    @(Get-ChildItem -LiteralPath $dir -Recurse -File | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($dir.Length) + ' ' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }) -join "`n"
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4168-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$old = @{ LOCALAPPDATA = $env:LOCALAPPDATA; APPDATA = $env:APPDATA }
try {
    # A fork folder with an engine build in it, for the record that names one.
    $fork = Join-Path $T 'fork'
    Put (Join-Path $fork 'build\dist\server\server-settings.json') '{"port":7777,"loadOrder":["c:/steam/Data/Skyrim.esm"]}'

    $records = [ordered]@{
        "CI's build of the pin, as on One" = '{"ci": true}'
        'a fork folder with a build in it' = ('{"fork": ' + (ConvertTo-Json ([string]$fork)) + '}')
    }
    foreach ($name in $records.Keys) {
        $machine = Join-Path $T ('machine-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
        $lad = Join-Path $machine 'localappdata'
        $app = Join-Path $machine 'appdata'
        Put (Join-Path $lad 'Thornswood\engine-build.json') $records[$name]
        Put (Join-Path $lad 'Thornswood\ship-roots.json') '{"dev": "C:\\Thornswood-Repo\\local\\release-devbuild"}'
        Put (Join-Path $app 'Vortex\skyrimse\profiles\Thornswood\plugins.txt') "*Skyrim.esm`r`n"
        $before = Snapshot $machine

        $env:LOCALAPPDATA = $lad
        $env:APPDATA = $app
        $ErrorActionPreference = 'Continue'
        $out = & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Fresh 2>&1 | Out-String
        $code = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        $env:LOCALAPPDATA = $old.LOCALAPPDATA
        $env:APPDATA = $old.APPDATA

        $passed = 0
        if ($out -match '(\d+) passed, 0 failed') { $passed = [int]$Matches[1] }
        Yes ("a machine that records {0}: the fresh test passes every check, exit {1}" -f $name, $code) ($code -eq 0 -and $passed -ge 25)
        if ($code -ne 0) { Write-Host ($out.TrimEnd() -replace '(?m)^', '      ') }
        Yes '  and leaves that machine''s folders as they were' ((Snapshot $machine) -eq $before)
    }
}
finally {
    $env:LOCALAPPDATA = $old.LOCALAPPDATA
    $env:APPDATA = $old.APPDATA
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
