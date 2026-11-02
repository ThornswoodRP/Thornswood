<#
  test-2662-dev-root-launcher.ps1

      pwsh -NoProfile -File .\tests\test-2662-dev-root-launcher.ps1

  A DEV SHIP REFUSES ONLY THE FOLDER IT FOUND FOR ITSELF (issue #2662).

  Until 18 Oct a dev Ship stopped on "No dev build at <root>" whenever
  <root>\Launcher was missing, and Publish-Update.ps1 asked the same on every
  dev run. A ship root that Update-ShipRoot.ps1 makes (Setup-ShipMachine.ps1
  -Channel dev -Root <folder> runs it) has Game, Profile and config.json and
  no Launcher folder, so every dev Ship from a recorded folder was refused,
  with two fixes that were both wrong for it. The refusal is still right for
  the install rule's <install>-DevBuild, where no Launcher folder means the
  main launcher's dev build was never installed.

  It proves:
  1. Where.ps1 ShipRootNamed and ShipRootNamedDev answer only what
     ship-roots.json records ('' for the install rule), ShipRoot and
     ShipRootDev are unchanged, an unreadable file throws the same sentence,
     and both answer under Set-StrictMode, as Ship runs them.
  2. Ship.ps1's Get-DevRootRefusal, lifted by the parser: the rule's folder
     with no Launcher folder (or a file named Launcher) is refused with "No
     dev build at"; with the folder, or named by -Root, or recorded, it is not.
  3. Ship.ps1's dev block, lifted and run with a stand-in Where.ps1: asks
     ShipRootNamedDev only when no -Root is given, stops on the refusal and
     goes on otherwise; and it sits before the Vortex refusal, the version
     move and the launcher build.
  4. Publish-Update.ps1's dev gate, lifted and run as a script: refused only
     with no -Root, and Ship always passes -Root.
  5. Check-ShipReady.ps1's Get-LauncherRows says the same for all three, and
     the script hands it whether the folder was named.
  tests\test-ship-dry-run.ps1 G2 runs a whole dev Ship from a recorded folder
  with no Launcher folder.

  Writes only under the temp folder.
#>
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$release = Join-Path $repo 'scripts\release'
$shipPath = Join-Path $release 'Ship.ps1'
$pubPath = Join-Path $release 'Publish-Update.ps1'
$readyPath = Join-Path $release 'Check-ShipReady.ps1'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$utf8 = New-Object Text.UTF8Encoding($false)
$shell = (Get-Process -Id $PID).Path
function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}
function Same([string]$a, [string]$b) { return [IO.Path]::GetFullPath($a).TrimEnd('\', '/') -eq [IO.Path]::GetFullPath($b).TrimEnd('\', '/') }
function Parse([string]$path) { return [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null) }
function Lift([string]$path, [string]$name) {
    $fn = @((Parse $path).FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true))
    if ($fn.Count -ne 1) { return '' }
    return $fn[0].Extent.Text
}
# The one top-level if statement in $path whose text matches $pattern.
function LiftIf([string]$path, [string]$pattern) {
    $ast = Parse $path
    $ifs = @($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.IfStatementAst] -and $_.Extent.Text -match $pattern })
    if ($ifs.Count -ne 1) { return $null }
    return $ifs[0]
}
# Runs $body as a script file with $argList; returns exit code and output.
function RunScript([string]$body, [string[]]$argList) {
    $f = Join-Path $T ('run-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.ps1')
    [IO.File]::WriteAllText($f, $body, $utf8)
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& $shell -NoProfile -File $f @argList 2>&1 | ForEach-Object { [string]$_ }); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $eap }
    return [pscustomobject]@{ Code = $code; Out = ($o -join "`n") }
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-2662-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$oldLocal = $env:LOCALAPPDATA
try {
    New-Item -ItemType Directory -Force -Path $T | Out-Null
    $env:LOCALAPPDATA = Join-Path $T 'localappdata'
    New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA | Out-Null
    $where = Join-Path $release 'Where.ps1'
    function Ask([string]$what) { return [string](& $where $what) }

    # ---- 1. Where.ps1 ------------------------------------------------------------
    Write-Host 'Where.ps1'
    $file = Ask 'ShipRoots'
    Yes 'ShipRoots is in this machine''s own data' (Same $file (Join-Path $env:LOCALAPPDATA 'Thornswood\ship-roots.json'))
    Yes 'no file: ShipRootNamedDev and ShipRootNamed are empty' ((Ask 'ShipRootNamedDev') -eq '' -and (Ask 'ShipRootNamed') -eq '')
    Yes '  and ShipRootDev is still the install rule''s -DevBuild folder' ((Ask 'ShipRootDev') -match '-DevBuild$')
    $relDev = Join-Path $T 'release-dev'
    Put $file (ConvertTo-Json -InputObject ([ordered]@{ dev = $relDev }))
    Yes 'a file naming dev: ShipRootNamedDev is that folder' (Same (Ask 'ShipRootNamedDev') $relDev)
    Yes '  and so is ShipRootDev' (Same (Ask 'ShipRootDev') $relDev)
    Yes '  and ShipRootNamed, which it does not name, is empty' ((Ask 'ShipRootNamed') -eq '')
    $strict = & { Set-StrictMode -Version Latest; try { [string](& $where 'ShipRootNamedDev') + '|' + [string](& $where 'ShipRootNamed') } catch { 'THREW ' + $_.Exception.Message } }
    Yes 'under Set-StrictMode, as Ship runs it, both answer' ($strict -notlike 'THREW*' -and (Same ($strict.Split('|')[0]) $relDev) -and $strict.Split('|')[1] -eq '')
    Put $file '{ not json'
    $threw = ''
    try { Ask 'ShipRootNamedDev' | Out-Null } catch { $threw = $_.Exception.Message }
    Yes 'a file that does not read: ShipRootNamedDev throws, naming Setup-ShipMachine' ($threw -match 'does not read as JSON' -and $threw -match 'Setup-ShipMachine\.ps1 -Channel dev -Root')
    Remove-Item -LiteralPath $file -Force
    $whereText = [IO.File]::ReadAllText($where)
    Yes 'Get-ShipRoot asks Get-NamedShipRoot first, so the two answers cannot drift' (
        $whereText -match '(?s)function Get-ShipRoot\(\[string\]\$channel\) \{\s*\$named = Get-NamedShipRoot \$channel\s*if \(\$named\) \{ return \$named \}')

    # ---- 2. Get-DevRootRefusal -----------------------------------------------------
    Write-Host ''
    Write-Host 'Ship.ps1 Get-DevRootRefusal'
    $fn = Lift $shipPath 'Get-DevRootRefusal'
    Yes 'Ship.ps1 has Get-DevRootRefusal' ([bool]$fn)
    if ($fn) { . ([scriptblock]::Create($fn)) }
    $rule = Join-Path $T 'Thornswood-DevBuild'
    New-Item -ItemType Directory -Force -Path $rule | Out-Null
    $why = Get-DevRootRefusal $rule $false ''
    Yes 'the install rule''s folder with no Launcher folder is refused' ($why -match ('^No dev build at ' + [regex]::Escape($rule) + '\.'))
    Yes '  naming the main launcher''s dev build and recording a folder, both right for it' (
        $why -match 'Settings page \(The dev build\)' -and $why -match 'Setup-ShipMachine\.ps1 -Channel dev -Root <folder>')
    Put (Join-Path $rule 'Launcher') 'a file, not a folder'
    Yes '  a file named Launcher is not the folder' ([bool](Get-DevRootRefusal $rule $false ''))
    Remove-Item -LiteralPath (Join-Path $rule 'Launcher') -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $rule 'Launcher') | Out-Null
    Yes 'the install rule''s folder with a Launcher folder, even an empty one, is not' ((Get-DevRootRefusal $rule $false '') -eq '')
    $bare = Join-Path $T 'release-bare'
    New-Item -ItemType Directory -Force -Path (Join-Path $bare 'Game'), (Join-Path $bare 'Profile') | Out-Null
    Yes 'a folder named by -Root with no Launcher folder is not refused' ((Get-DevRootRefusal $bare $true '') -eq '')
    Yes 'a folder recorded in ship-roots.json with no Launcher folder is not refused' ((Get-DevRootRefusal $bare $false $bare) -eq '')

    # ---- 3. Ship.ps1's dev block, run --------------------------------------------
    Write-Host ''
    Write-Host 'Ship.ps1 dev block'
    $block = LiftIf $shipPath '^if \(\$Dev\) \{[\s\S]*Get-DevRootRefusal'
    Yes 'Ship.ps1 has one top-level dev block that asks Get-DevRootRefusal' ($null -ne $block)
    $shipText = [IO.File]::ReadAllText($shipPath)
    if ($block) {
        $at = $block.Extent.StartOffset
        $vortex = $shipText.IndexOf("Test-Path -LiteralPath (Join-Path `$Root 'Game\Data\vortex.deployment.json')")
        $rootAt = $shipText.IndexOf("Where.ps1') `$(if (`$Dev) { 'ShipRootDev' } else { 'ShipRoot' })")
        Yes '  after the folder is worked out, and before the Vortex refusal' ($rootAt -gt 0 -and $at -gt $rootAt -and $vortex -gt $at)
        # Ship builds no launcher since #4825; the first thing it builds from
        # the root is the animation and body files.
        $version = $shipText.IndexOf("Head 'Animation and body files'")
        Yes '  and before anything is built from the root, and no launcher is built at all' (
            $version -gt 0 -and $at -lt $version -and $shipText.IndexOf("'Build-Launcher.ps1')") -lt 0)
        Yes '  and the old refusal of every folder is gone from it' ($block.Extent.Text -notmatch 'if \(-not \(Test-Path \(Join-Path \$Root ''Launcher''\)\)\)')
        $stubDir = Join-Path $T 'stub'
        Put (Join-Path $stubDir 'Where.ps1') @'
param([string]$What)
if ($What -ne 'ShipRootNamedDev') { throw "asked for $What" }
Add-Content -LiteralPath $env:TS_ASKED -Value $What
[string]$env:TS_NAMED
'@
        $runner = @"
param([string]`$Root)
`$ErrorActionPreference = 'Stop'
function Die(`$m) { Write-Output "STOP. `$m"; exit 1 }
`$Here = '$stubDir'
`$Dev = `$true
if (-not `$PSBoundParameters.ContainsKey('Root')) { `$Root = `$env:TS_RULE }
$fn
$($block.Extent.Text)
Write-Output 'WENT ON'
exit 0
"@
        $env:TS_ASKED = Join-Path $T 'asked.txt'
        $env:TS_RULE = Join-Path $T 'Rule-DevBuild'
        New-Item -ItemType Directory -Force -Path $env:TS_RULE | Out-Null
        function Asked { if (Test-Path -LiteralPath $env:TS_ASKED) { $n = @(Get-Content -LiteralPath $env:TS_ASKED).Count; Remove-Item -LiteralPath $env:TS_ASKED -Force; return $n }; return 0 }
        $env:TS_NAMED = ''
        $r = RunScript $runner @()
        Yes ("no -Root, nothing recorded, the rule's folder with no Launcher folder: stops (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match 'STOP\. No dev build at' -and $r.Out -notmatch 'WENT ON')
        Yes '  having asked Where.ps1 ShipRootNamedDev once' ((Asked) -eq 1)
        $env:TS_NAMED = $bare
        $r = RunScript $runner @()
        Yes ("no -Root, a recorded folder: goes on (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match 'WENT ON')
        [void](Asked)
        $env:TS_NAMED = ''
        $r = RunScript $runner @('-Root', $bare)
        Yes ("-Root naming a folder with no Launcher folder: goes on (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match 'WENT ON')
        Yes '  without asking Where.ps1 at all' ((Asked) -eq 0)
        New-Item -ItemType Directory -Force -Path (Join-Path $env:TS_RULE 'Launcher') | Out-Null
        $r = RunScript $runner @()
        Yes ("no -Root, the rule's folder with the dev build installed: goes on (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match 'WENT ON')
        [void](Asked)
    }

    # ---- 4. Publish-Update.ps1's dev gate, run -------------------------------------
    Write-Host ''
    Write-Host 'Publish-Update.ps1 dev gate'
    $gate = LiftIf $pubPath 'No dev build at'
    # The folder a publish with no -Root reads, which Where.ps1 InstallDev
    # answers on the dev channel (#3003). The runner below gives it a Where.ps1
    # of its own that answers from TS_INSTALL.
    $dev = LiftIf $pubPath "^if \(-not \`$PSBoundParameters\.ContainsKey\('Root'\)\) \{\s+\`$Root = \[string\]\(& \(Join-Path \`$Here 'Where\.ps1'\) \`$\(if \(\`$Dev\) \{ 'InstallDev' \} else \{ 'Install' \}\)\)\s+\}$"
    Yes 'Publish-Update.ps1 has one dev gate, after it asks Where.ps1 for the install' ($null -ne $gate -and $null -ne $dev -and $gate.Extent.StartOffset -gt $dev.Extent.StartOffset)
    Yes '  and it asks only when no -Root was given' ($gate -and $gate.Clauses[0].Item1.Extent.Text -match '-not \$PSBoundParameters\.ContainsKey\(''Root''\)')
    if ($gate -and $dev) {
        $installWhere = Join-Path $T 'install-where'
        New-Item -ItemType Directory -Force -Path $installWhere | Out-Null
        [IO.File]::WriteAllText((Join-Path $installWhere 'Where.ps1'), "param([string]`$What)`nif (`$What -eq 'InstallDev') { `$env:TS_INSTALL + '-DevBuild' } elseif (`$What -eq 'Install') { `$env:TS_INSTALL } else { throw `$What }`n", $utf8)
        $runner = @"
param([string]`$Channel = 'main', [string]`$Root = '')
function Die(`$m) { Write-Output "STOP. `$m"; exit 1 }
`$Dev = (`$Channel -eq 'dev')
`$Here = '$installWhere'
$($dev.Extent.Text)
$($gate.Extent.Text)
Write-Output "WENT ON `$Root"
exit 0
"@
        $env:TS_INSTALL = Join-Path $T 'Install'
        New-Item -ItemType Directory -Force -Path $env:TS_INSTALL | Out-Null
        $r = RunScript $runner @('-Channel', 'dev')
        Yes ("dev, no -Root, <install>-DevBuild with no Launcher folder: stops (exit {0})" -f $r.Code) (
            $r.Code -eq 1 -and $r.Out -match ('No dev build at ' + [regex]::Escape($env:TS_INSTALL + '-DevBuild')))
        $r = RunScript $runner @('-Channel', 'dev', '-Root', $bare)
        Yes ("dev, -Root naming a ship root with no Launcher folder, as Ship always passes: goes on (exit {0})" -f $r.Code) (
            $r.Code -eq 0 -and $r.Out -match ('WENT ON ' + [regex]::Escape($bare)))
        New-Item -ItemType Directory -Force -Path (Join-Path ($env:TS_INSTALL + '-DevBuild') 'Launcher') | Out-Null
        $r = RunScript $runner @('-Channel', 'dev')
        Yes ("dev, no -Root, the dev build installed: goes on (exit {0})" -f $r.Code) ($r.Code -eq 0)
        $r = RunScript $runner @()
        Yes ("main asks nothing (exit {0})" -f $r.Code) ($r.Code -eq 0)
    }
    $shipPub = $shipText.IndexOf('$pubArgs = @{ Notes = $Notes; Root = $Root;')
    Yes 'Ship always passes Publish-Update -Root' ($shipPub -gt 0)
    $pubText = [IO.File]::ReadAllText($pubPath)
    Yes 'Publish-Update publishes no launcher, so it looks for no exe (#4825)' ($pubText -notmatch '\$exePath')

    # ---- 5. Check-ShipReady.ps1 ------------------------------------------------------
    Write-Host ''
    Write-Host 'Check-ShipReady.ps1 Get-LauncherRows'
    foreach ($n in 'New-Row', 'Get-LauncherRows') {
        $f = Lift $readyPath $n
        Yes "Check-ShipReady.ps1 has $n" ([bool]$f)
        if ($f) { . ([scriptblock]::Create($f)) }
    }
    $bare2 = Join-Path $T 'release-bare2'
    New-Item -ItemType Directory -Force -Path $bare2 | Out-Null
    $r = @(Get-LauncherRows 'dev' $bare2 $true)
    Yes 'a named folder with no Launcher folder: one need row that passes, with no fix' ($r.Count -eq 1 -and $r[0].Ok -and $r[0].Level -eq 'need' -and -not $r[0].Fix)
    $r = @(Get-LauncherRows 'dev' $bare2 $false)
    Yes 'the same folder as the install rule''s answer fails, saying "No dev build at"' (-not $r[0].Ok -and $r[0].Detail -match 'No dev build at')
    $r = @(Get-LauncherRows 'dev' $bare2)
    Yes '  and not named is what a caller that says nothing gets' (-not $r[0].Ok)
    New-Item -ItemType Directory -Force -Path (Join-Path $bare2 'Launcher') | Out-Null
    Yes 'with a Launcher folder both pass, as before' ((@(Get-LauncherRows 'dev' $bare2 $true))[0].Ok -and (@(Get-LauncherRows 'dev' $bare2 $false))[0].Ok)
    $readyText = [IO.File]::ReadAllText($readyPath)
    Yes 'the script hands it whether the folder was named: -Root, or what ShipRootNamedDev answers' (
        $readyText -match '\$rootNamed = \$rootGiven' -and $readyText -match "'ShipRootNamedDev' \} else \{ 'ShipRootNamed' \}" -and
        $readyText -match 'Get-LauncherRows \$Channel \$Root \$rootNamed')
    Yes 'and no row points at #2662 as an open fault any more' ($readyText -notmatch 'refuses a folder with no Launcher folder \(#2662\)')
}
finally {
    $env:LOCALAPPDATA = $oldLocal
    foreach ($v in 'TS_ASKED', 'TS_RULE', 'TS_NAMED', 'TS_INSTALL') { Remove-Item -LiteralPath ('Env:' + $v) -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
