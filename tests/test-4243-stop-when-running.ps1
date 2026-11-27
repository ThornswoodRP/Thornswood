<#
  test-4243-stop-when-running.ps1

      pwsh -NoProfile -File .\tests\test-4243-stop-when-running.ps1

  Issue #4243. scripts\ops\Reset-Appearance.ps1 and New-Character.ps1 both
  say the server must be stopped, because a running server writes its change
  forms back over the edit, yet when any node process was running they
  printed a yellow line, carried on and ended in green. Now each stops with
  exit 1, changing nothing, while something holds the game port of the
  server whose world -World is (scripts\ops\World-Server.ps1): the port its
  server-settings.json names, or the engine's 7777 when it names none.

  The machine's UDP list is stood in for by tests\ServerPorts.ps1, so this
  runs the same on any machine and never reads what this one holds.

    R1 Reset-Appearance with its server's port held stops, exit 1, the
       appearance kept and no backup made;
    R2 with another port held (a site or bot is node too) it runs and ends 0;
    R3 with no port in server-settings.json, the engine's 7777 is the server's;
    R4 a port that is not a number stops it, nothing changed;
    R5 a backup copy that fails stops it, the change form as it was;
    N1 New-Character with its server's port held stops, exit 1, nothing
       thrown away and no release list written;
    N2 with the port free it throws the character away and ends 0.

  Writes only into a scratch folder under TEMP, which it removes.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$Ports = Join-Path $PSScriptRoot 'ServerPorts.ps1'
$AppearancePs = Join-Path $Repo 'scripts\ops\Reset-Appearance.ps1'
$NewPs = Join-Path $Repo 'scripts\ops\New-Character.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Put([string]$path, [string]$body) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $body)
}
$T = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4243-' + [Guid]::NewGuid().ToString('N'))
function Server([string]$name, [string]$settings) {
    $root = Join-Path $T $name
    Put (Join-Path $root 'server-settings.json') $settings
    Put (Join-Path $root 'world\changeForms\0.json') '{"formDesc":"a01","profileId":5001,"appearanceDump":{"name":"A"}}'
    return (Join-Path $root 'world\changeForms')
}
function Run([string]$file, [string]$held, [string[]]$arg) {
    $was = $env:THORNSWOOD_TEST_UDP_HELD
    $env:THORNSWOOD_TEST_UDP_HELD = $held
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $said = @(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Ports $file @arg 2>&1 | ForEach-Object { "$_" })
        return @{ Code = $LASTEXITCODE; Said = ($said -join ' / ') }
    }
    finally { $ErrorActionPreference = $eap; $env:THORNSWOOD_TEST_UDP_HELD = $was }
}
function Face([string]$forms) { return ([IO.File]::ReadAllText((Join-Path $forms '0.json')) | ConvertFrom-Json).appearanceDump }
function Baks([string]$forms) { return @(Get-ChildItem -LiteralPath $forms -Filter '0.json.bak-*').Count }

try {
    # ---- R: Reset-Appearance -------------------------------------------------------
    $w = Server 'held' '{"port":45811}'
    $r = Run $AppearancePs '45811' @('-World', $w, '-All')
    Yes ('R1 with its server''s port held it stops, nothing changed (' + $r.Said + ')') (
        $r.Code -eq 1 -and $r.Said -match 'STOP\. The server for .* is running: UDP 45811 is held by .*Nothing was changed\.' -and
        (Face $w).name -eq 'A' -and (Baks $w) -eq 0 -and $r.Said -notmatch 'race menu on next connect')

    $r = Run $AppearancePs '7777,3000' @('-World', $w, '-All')
    Yes ('R2 with only other ports held it runs and ends 0 (exit ' + $r.Code + ')') ($r.Code -eq 0 -and $null -eq (Face $w) -and (Baks $w) -eq 1)

    $w = Server 'noport' '{"privDir":"private"}'
    $r = Run $AppearancePs '7777' @('-World', $w, '-All')
    Yes ('R3 with no port named, 7777 is the server''s (' + $r.Said + ')') ($r.Code -eq 1 -and $r.Said -match 'UDP 7777 is held' -and (Face $w).name -eq 'A')

    $w = Server 'badport' '{"port":"seven"}'
    $r = Run $AppearancePs '' @('-World', $w, '-All')
    Yes ('R4 a port that is not a number stops it (' + $r.Said + ')') ($r.Code -eq 1 -and $r.Said -match 'STOP\. .*names a port that is not a number' -and (Face $w).name -eq 'A')

    # A folder where each backup would go, with 0.json in it as a folder, for
    # the next three minutes, so the copy cannot be made.
    $w = Server 'nobackup' '{"port":45812}'
    $at = Get-Date
    foreach ($s in 0..180) { [void][IO.Directory]::CreateDirectory((Join-Path (Join-Path $w ('0.json.bak-' + $at.AddSeconds($s).ToString('yyyyMMdd-HHmmss'))) '0.json')) }
    $before = [IO.File]::ReadAllText((Join-Path $w '0.json'))
    $r = Run $AppearancePs '' @('-World', $w, '-All')
    Yes ('R5 a backup copy that fails stops it, the change form as it was (exit ' + $r.Code + ')') (
        $r.Code -ne 0 -and [IO.File]::ReadAllText((Join-Path $w '0.json')) -eq $before -and $r.Said -notmatch 'backup: ')

    # ---- N: New-Character ------------------------------------------------------------
    $w = Server 'newheld' '{"port":45813}'
    $r = Run $NewPs '45813' @('-World', $w)
    Yes ('N1 with its server''s port held it stops, nothing thrown away (' + $r.Said + ')') (
        $r.Code -eq 1 -and $r.Said -match 'STOP\. The server for .* is running: UDP 45813 is held by .*Nothing was thrown away\.' -and
        (Test-Path -LiteralPath (Join-Path $w '0.json')) -and @(Get-ChildItem -LiteralPath $w -Directory).Count -eq 0 -and
        -not (Test-Path -LiteralPath (Join-Path $T 'newheld\private')))

    $r = Run $NewPs '' @('-World', $w)
    Yes ('N2 with the port free it throws the character away and ends 0 (exit ' + $r.Code + ')') (
        $r.Code -eq 0 -and -not (Test-Path -LiteralPath (Join-Path $w '0.json')) -and $r.Said -match 'character\(s\) gone')
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message) $false
}
finally {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
