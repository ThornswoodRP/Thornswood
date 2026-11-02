<#
  test-1814-loadorder-missing.ps1

      pwsh -NoProfile -File .\tests\test-1814-loadorder-missing.ps1

  #1814. Deploy-Gamemode.ps1 asks the collection revision through
  scripts\mods\LoadOrder.ps1, and asked it only when that file was there,
  with no else: a checkout without it skipped the whole check, said nothing
  and went on to build the live server.

  Each case runs a copy of the real Deploy-Gamemode.ps1 in a scratch tree
  laid out like the repository, against a scratch build folder, as its own
  process:

  1. LoadOrder.ps1 missing: the run stops, names the file, and the build
     folder is as it was (no gamemode.js, no build stamp, the settings file
     untouched), because the stop comes before the first write.
  2. LoadOrder.ps1 missing with -IgnoreRevision: the run goes on and says the
     revision was not checked, naming the file.
  3. The real LoadOrder.ps1, on a machine whose Vortex state is empty: the
     check runs as it does today and refuses an unreadable revision.
  4. A LoadOrder.ps1 whose Get-CollectionState says behind, and one that says
     current: the run refuses the first and goes on for the second, so the
     file it finds is the one it asks.

  Nothing leaves this machine. Scratch files go under the temp folder.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}
$utf8 = New-Object Text.UTF8Encoding($false)
$shell = (Get-Process -Id $PID).Path
function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-1814-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
$settingsText = '{"port":7777,"name":"Thornswood"}'

# A scratch tree laid out like the repository, with what Deploy-Gamemode.ps1
# loads before the revision check, and a fresh build folder. $lo is the
# LoadOrder.ps1 to put in scripts\mods: 'real', a stub's text, or '' for none.
function New-Tree([string]$name, [string]$lo) {
    $t = Join-Path $T $name
    # Read-JsonFile.ps1 and RecordShape.ps1 too: Deploy-Gamemode loads them
    # under Stop since #3006, so a tree without them stops on the load, where
    # before it printed an error and went on.
    foreach ($rel in 'scripts\deploy\Deploy-Gamemode.ps1', 'scripts\deploy\MaxOnline.ps1', 'scripts\deploy\ServerOrder.ps1', 'scripts\deploy\LastPluginRecipe.ps1',
                     'scripts\release\BuildStamp.ps1', 'scripts\release\Read-JsonFile.ps1', 'scripts\release\RecordShape.ps1',
                     'records\most-online.json') {
        $to = Join-Path $t $rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo $rel) -Destination $to
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $t 'scripts\mods') | Out-Null
    if ($lo -eq 'real') {
        Copy-Item -LiteralPath (Join-Path $repo 'scripts\mods\LoadOrder.ps1') -Destination (Join-Path $t 'scripts\mods\LoadOrder.ps1')
    } elseif ($lo) {
        Put (Join-Path $t 'scripts\mods\LoadOrder.ps1') $lo
    }
    Put (Join-Path $t 'game\gamemode.js') "var thornswood1814 = 1;`n"
    # And its tables (#5191), which Deploy-Gamemode.ps1 copies in beside it.
    Put (Join-Path $t 'game\gamemode-tables\WAY_OUT.json') "{}`n"
    Put (Join-Path $t 'dist\server-settings.json') $settingsText
    New-Item -ItemType Directory -Force -Path (Join-Path $t 'Game\Data') | Out-Null
    Put (Join-Path $t 'Game\config.json') '{"CollectionUrl":"https://next.nexusmods.com/skyrimspecialedition/collections/ts1814"}'
    Put (Join-Path $t 'plugins.txt') "*Thornswood-Content.esp`n"
    # Vortex's state and the launcher's feed are read from these, empty here.
    New-Item -ItemType Directory -Force -Path (Join-Path $t 'appdata'), (Join-Path $t 'localappdata') | Out-Null
    return $t
}

# Runs the copy as its own process. Returns the exit code and every line.
function Invoke-Copy([string]$t, [string[]]$more = @()) {
    $saved = @{ APPDATA = $env:APPDATA; LOCALAPPDATA = $env:LOCALAPPDATA }
    $env:APPDATA = Join-Path $t 'appdata'
    $env:LOCALAPPDATA = Join-Path $t 'localappdata'
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = @(& $shell -NoProfile -File (Join-Path $t 'scripts\deploy\Deploy-Gamemode.ps1') `
                   -Gamemode (Join-Path $t 'game\gamemode.js') -Dist (Join-Path $t 'dist') `
                   -Data (Join-Path $t 'Game\Data') -Plugins (Join-Path $t 'plugins.txt') -MinimalLoadOrder @more 2>&1 |
                 ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $eap
        $env:APPDATA = $saved.APPDATA
        $env:LOCALAPPDATA = $saved.LOCALAPPDATA
    }
    return [pscustomobject]@{ Code = $code; Text = ($out -join "`n") }
}
function Wrote([string]$t, [string]$file) { return (Test-Path -LiteralPath (Join-Path (Join-Path $t 'dist') $file)) }

$stub = @'
function Get-CollectionState([string]$Url) {
    [pscustomobject]@{ Slug = 'ts1814'; Have = HAVE; Newest = NEWEST; Behind = (HAVE -lt NEWEST); Known = $true }
}
'@

try {
    # ---- the source ------------------------------------------------------------
    Write-Host 'Deploy-Gamemode.ps1'
    $src = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Deploy-Gamemode.ps1'))
    $gate = $src.IndexOf('if (-not (Test-Path -LiteralPath $lo) -and -not $IgnoreRevision)')
    $firstWrite = $src.IndexOf('Copy-Item -LiteralPath $Gamemode')
    Yes 'a missing LoadOrder.ps1 is asked about before the first write' ($gate -gt 0 -and $firstWrite -gt $gate)
    Yes 'the revision check no longer runs only when the file happens to be there' (
        $src -notmatch '(?m)^if \(Test-Path -LiteralPath \$lo\) \{')

    # ---- 1. missing --------------------------------------------------------------
    Write-Host ''
    Write-Host 'LoadOrder.ps1 missing'
    $t = New-Tree 'missing' ''
    $r = Invoke-Copy $t
    Yes 'the run stops' ($r.Code -ne 0)
    # The STOP line, which Write-Host never wraps. The error the run ends on
    # says the same, but a console wraps it at its width.
    Yes '  naming the file' ($r.Text -match 'STOP\. .*[\\/]scripts[\\/]mods[\\/]LoadOrder\.ps1 is not here, so the collection revision cannot be checked')
    Yes '  saying nothing was written and how past it' ($r.Text -match 'Nothing was written' -and $r.Text -match '-IgnoreRevision')
    Yes '  before gamemode.js is checked or copied' ($r.Text -notmatch 'gamemode\.js parses' -and -not (Wrote $t 'gamemode.js'))
    Yes '  and with no build stamp written' (-not (Wrote $t 'thornswood-build.json'))
    Yes '  and the build''s settings file as it was' (
        [IO.File]::ReadAllText((Join-Path $t 'dist\server-settings.json')) -eq $settingsText)

    # ---- 2. missing, -IgnoreRevision ---------------------------------------------
    Write-Host ''
    Write-Host 'LoadOrder.ps1 missing, -IgnoreRevision'
    $t = New-Tree 'missing-ignore' ''
    $r = Invoke-Copy $t @('-IgnoreRevision')
    Yes 'the run goes on' ($r.Code -eq 0 -and (Wrote $t 'gamemode.js'))
    Yes '  and says the revision was not checked, naming the file' (
        $r.Text -match 'collection revision NOT checked: .*LoadOrder\.ps1 is missing, carrying on because -IgnoreRevision')

    # ---- 3. the real file, Vortex state empty ------------------------------------
    Write-Host ''
    Write-Host 'the real LoadOrder.ps1, with no Vortex state'
    $t = New-Tree 'real' 'real'
    $r = Invoke-Copy $t
    Yes 'the check runs as today and refuses an unreadable revision' (
        $r.Code -ne 0 -and $r.Text -match 'the collection revision could not be read, so it was not checked')
    Yes '  and is not the missing file stop' ($r.Text -notmatch 'is not here, so the collection revision cannot be checked')

    # ---- 4. the file it finds is the one it asks ---------------------------------
    Write-Host ''
    Write-Host 'a LoadOrder.ps1 that answers'
    $t = New-Tree 'behind' ($stub.Replace('HAVE', '3').Replace('NEWEST', '4'))
    $r = Invoke-Copy $t
    Yes 'behind: the run refuses with both numbers' ($r.Code -ne 0 -and $r.Text -match 'collection revision 3 installed, 4 available')
    $t = New-Tree 'current' ($stub.Replace('HAVE', '4').Replace('NEWEST', '4'))
    $r = Invoke-Copy $t
    Yes 'current: the run goes on and says so' (
        $r.Code -eq 0 -and $r.Text -match 'collection revision 4, which is the newest Vortex knows of')
    Yes '  and says nothing about a missing file' ($r.Text -notmatch 'NOT checked')
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
