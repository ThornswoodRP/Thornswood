<#
  test-1692-release-root.ps1

      pwsh -NoProfile -File .\tests\test-1692-release-root.ps1

  #1692. On 4 October a dev Ship was run from a clean worktree with no -Root,
  after Setup-ShipMachine.ps1 -NoPause. Ship, Check-ShipReady,
  Setup-ShipMachine and Build-Generated each worked out the dev release
  folder for themselves, by one rule copied four times: the launcher install
  with -DevBuild on the end. On that machine that is the folder Vortex
  deploys into (docs\COLLECTION-REVISION-2.md step 8), and the release folder
  is C:\Thornswood-Release-DevBuild. Ship built and installed the launcher in
  Vortex's folder and only then stopped at its generated files; Check-ShipReady
  and Setup-ShipMachine took no -Root and checked Vortex's folder too.

  It proves:
  1. Where.ps1 ShipRoot and ShipRootDev are the one answer: the folder this
     machine's ShipRoots file names for the channel, in this machine's own
     data (LOCALAPPDATA, so every clone and worktree reads it), else the
     install rule; a file that does not read is refused, naming the fix.
  2. Setup-ShipMachine.ps1's Save-ShipRoot writes that file, keeping the
     other channel, and leaves a file that does not read as it is.
  3. Ship.ps1, Check-ShipReady.ps1, Setup-ShipMachine.ps1 and
     Build-Generated.ps1 all ask Where.ps1 and none keeps its own rule; Ship
     refuses a folder Vortex deploys into before the version is worked
     out or anything is built, and asks whether the collection builds the
     animation and body files (#3715) before the launcher is built or
     installed. tests\test-ship-dry-run.ps1 runs Ship on both
     (G, H and I).
  4. Check-ShipReady.ps1 run whole: -Root is the folder it checks, and a
     folder Vortex deploys into is a gap; since #2662 the recorded folder,
     or one named by -Root, passes with no Launcher folder in it.
  5. Build-Generated.ps1 -Channel dev, run whole, builds in the recorded
     folder.

  Writes only under the temp folder.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$release = Join-Path $repo 'scripts\release'

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
function Same([string]$a, [string]$b) { return [IO.Path]::GetFullPath($a).TrimEnd('\', '/') -eq [IO.Path]::GetFullPath($b).TrimEnd('\', '/') }
# The function $name out of $path, by the parser, as test-ship-machine.ps1 lifts them.
function Lift([string]$path, [string]$name) {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
    $fn = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true))
    if ($fn.Count -ne 1) { return '' }
    return $fn[0].Extent.Text
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-1692-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$oldLocal = $env:LOCALAPPDATA
$oldApp = $env:APPDATA
try {
    New-Item -ItemType Directory -Force -Path $T | Out-Null
    $env:LOCALAPPDATA = Join-Path $T 'localappdata'
    $env:APPDATA = Join-Path $T 'appdata'
    New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA, $env:APPDATA | Out-Null
    $where = Join-Path $release 'Where.ps1'
    function Ask([string]$what) { return [string](& $where $what) }

    # ---- 1. Where.ps1 ---------------------------------------------------------------
    Write-Host 'Where.ps1'
    $file = Ask 'ShipRoots'
    Yes 'ShipRoots is a file in this machine''s own data, not in the repository' (
        (Same $file (Join-Path $env:LOCALAPPDATA 'Thornswood\ship-roots.json')) -and -not $file.StartsWith($repo))
    Yes 'with no file, ShipRoot is the launcher install (C:\Thornswood when no drive has one)' ((Ask 'ShipRoot') -eq (Ask 'Install'))
    Yes '  and ShipRootDev that with -DevBuild on the end' ((Ask 'ShipRootDev') -eq ((Ask 'Install') + '-DevBuild'))
    $relDev = Join-Path $T 'Thornswood-Release-DevBuild'
    Put $file (ConvertTo-Json -InputObject ([ordered]@{ dev = $relDev }))
    Yes 'a file naming dev: ShipRootDev is that folder' (Same (Ask 'ShipRootDev') $relDev)
    Yes '  and ShipRoot, which it does not name, is still the install rule' ((Ask 'ShipRoot') -eq (Ask 'Install'))
    $relMain = Join-Path $T 'Main'
    Put $file (ConvertTo-Json -InputObject ([ordered]@{ main = $relMain; dev = $relDev }))
    Yes 'a file naming both: each channel its own' ((Same (Ask 'ShipRoot') $relMain) -and (Same (Ask 'ShipRootDev') $relDev))
    $strict = & { Set-StrictMode -Version Latest; try { [string](& $where 'ShipRootDev') } catch { 'THREW ' + $_.Exception.Message } }
    Yes '  and it answers under Set-StrictMode, as Ship runs it' (Same $strict $relDev)
    Put $file '{ not json'
    $threw = ''
    try { Ask 'ShipRootDev' | Out-Null } catch { $threw = $_.Exception.Message }
    Yes 'a file that does not read is refused, naming how to write it again' (
        $threw -match 'does not read as JSON' -and $threw -match 'Setup-ShipMachine\.ps1 -Channel dev -Root')
    Remove-Item -LiteralPath $file -Force

    # ---- 2. Save-ShipRoot -------------------------------------------------------------
    Write-Host ''
    Write-Host 'Setup-ShipMachine.ps1 Save-ShipRoot'
    $setup = Join-Path $release 'Setup-ShipMachine.ps1'
    $fn = Lift $setup 'Save-ShipRoot'
    Yes 'Setup-ShipMachine.ps1 has Save-ShipRoot' ([bool]$fn)
    if ($fn) { Invoke-Expression $fn }
    Save-ShipRoot $file 'dev' $relDev
    Yes 'it writes the file Where.ps1 reads, and ShipRootDev answers with it' (Same (Ask 'ShipRootDev') $relDev)
    Save-ShipRoot $file 'main' $relMain
    Yes '  and a second channel keeps the first' ((Same (Ask 'ShipRoot') $relMain) -and (Same (Ask 'ShipRootDev') $relDev))
    Put $file '{ not json'
    $threw = ''
    try { Save-ShipRoot $file 'dev' $relDev } catch { $threw = $_.Exception.Message }
    Yes '  and a file that does not read is left as it is, and says so' ($threw -match 'left as it is' -and [IO.File]::ReadAllText($file) -eq '{ not json')
    Remove-Item -LiteralPath $file -Force

    # ---- 3. the four scripts ----------------------------------------------------------
    Write-Host ''
    Write-Host 'the four scripts'
    $texts = @{
        'Ship.ps1'            = [IO.File]::ReadAllText((Join-Path $release 'Ship.ps1'))
        'Check-ShipReady.ps1' = [IO.File]::ReadAllText((Join-Path $release 'Check-ShipReady.ps1'))
        'Setup-ShipMachine.ps1' = [IO.File]::ReadAllText($setup)
        'Build-Generated.ps1' = [IO.File]::ReadAllText((Join-Path $repo 'scripts\mods\Build-Generated.ps1'))
    }
    foreach ($n in @($texts.Keys | Sort-Object)) {
        $src = $texts[$n]
        Yes ("$n asks Where.ps1 for ShipRoot and ShipRootDev") ($src -match "'ShipRootDev' \} else \{ 'ShipRoot' \}")
        Yes ("  and keeps no rule of its own (no Find-Root, no -DevBuild added on)") ($src -notmatch 'function Find-Root' -and $src -notmatch "\+ '-DevBuild'")
    }
    $ship = $texts['Ship.ps1']
    $vortex = $ship.IndexOf("Test-Path -LiteralPath (Join-Path `$Root 'Game\Data\vortex.deployment.json')")
    Yes 'Ship refuses a folder Vortex deploys into' ($vortex -gt 0)
    # Before anything is built or published: the first thing put in place is
    # the front (Build-Front.ps1); a Ship builds no launcher since #4825.
    $front = $ship.IndexOf("Head 'The front'")
    Yes '  before anything is built or published' ($vortex -gt 0 -and $front -gt 0 -and $vortex -lt $front)
    $gen = $ship.IndexOf("Head 'Animation and body files'")
    Yes 'Ship asks whether the collection builds the animation and body files before anything is put in place or published' (
        $gen -gt 0 -and $gen -lt $front -and $gen -lt $ship.IndexOf("Head 'Publishing'"))
    Yes 'Check-ShipReady and Setup-ShipMachine take -Root' (
        $texts['Check-ShipReady.ps1'] -match '\[string\]\$Root = ''''' -and $texts['Setup-ShipMachine.ps1'] -match '\[string\]\$Root = ''''')
    Yes 'Setup-ShipMachine hands -Root to Check-ShipReady' ($texts['Setup-ShipMachine.ps1'] -match "if \(\`$Root\) \{ \`$readyArgs\['Root'\] = \`$Root \}")

    # ---- 4. Check-ShipReady, run whole -------------------------------------------------
    Write-Host ''
    Write-Host 'Check-ShipReady.ps1'
    $vx = Join-Path $T 'Thornswood-DevBuild'
    Put (Join-Path $vx 'Launcher\Thornswood.exe') 'the launcher'
    Put (Join-Path $vx 'Game\Data\vortex.deployment.json') '{}'
    Put (Join-Path $relDev 'Launcher\Thornswood.exe') 'the launcher'
    function Ready([string[]]$more) {
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = @(& $shell -NoProfile -File (Join-Path $release 'Check-ShipReady.ps1') -Channel dev -NoVps -NoPause @more 2>&1 | ForEach-Object { [string]$_ }) }
        finally { $ErrorActionPreference = $eap }
        return ($o -join "`n")
    }
    $out = Ready @('-Root', $vx)
    Yes '-Root is the folder it checks' ($out -match ('yes\s+it has the Launcher folder a dev Ship asks for\s+\(' + [regex]::Escape((Join-Path $vx 'Launcher')) + '\)'))
    Yes '  and a folder Vortex deploys into is a gap' ($out -match 'NO\s+it is not a folder Vortex deploys into')
    Save-ShipRoot $file 'dev' $relDev
    $out = Ready @()
    Yes 'with no -Root, the folder this machine recorded for dev' (
        $out -match ('yes\s+which folder the release is built from is known\s+\(' + [regex]::Escape($relDev) + '\)') -and
        $out -match 'yes\s+it is not a folder Vortex deploys into')
    # #2662: a recorded folder is a ship root Update-ShipRoot.ps1 makes, with
    # no Launcher folder, and a dev Ship makes one there itself.
    Remove-Item -LiteralPath (Join-Path $relDev 'Launcher') -Recurse -Force
    $out = Ready @()
    Yes 'the recorded folder with no Launcher folder passes, as a dev Ship makes it (#2662)' (
        $out -match 'yes\s+its Launcher folder, which a dev Ship makes itself for a folder it was named' -and $out -notmatch 'No dev build at')
    $out = Ready @('-Root', $relDev)
    Yes '  and so does the same folder named by -Root' ($out -match 'yes\s+its Launcher folder, which a dev Ship makes itself for a folder it was named')
    Put (Join-Path $relDev 'Launcher\Thornswood.exe') 'the launcher'

    # ---- 5. Build-Generated, run whole -------------------------------------------------
    Write-Host ''
    Write-Host 'Build-Generated.ps1'
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& $shell -NoProfile -File (Join-Path $repo 'scripts\mods\Build-Generated.ps1') -Channel dev -DryRun -NoPause 2>&1 | ForEach-Object { [string]$_ }) }
    finally { $ErrorActionPreference = $eap }
    $said = $o -join "`n"
    Yes '-Channel dev builds in the folder this machine recorded for dev' ($said -match ('in ' + [regex]::Escape((Join-Path ([IO.Path]::GetFullPath($relDev)) 'Game'))))
}
finally {
    $env:LOCALAPPDATA = $oldLocal
    $env:APPDATA = $oldApp
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
