<#
  test-go-keeps.ps1

      pwsh -NoProfile -File .\scripts\tests\test-go-keeps.ps1

  Go.ps1 makes what it installs under Data\Platform the launcher's kept copy,
  and drops the kept copy of what it takes out, so Play does not put an older
  copy back; nothing else in the game folder is adopted; and Publish-Update
  no longer writes Profile\developer.flag.

  WHY. The launcher keeps a copy of our files under Data\Platform and puts it
  back at every Play (Keep.cs). A pack refreshes that copy; Go.ps1, which Ship
  runs to put the plugins and overlays in, never did, so on the machine that
  ships the flag let any newer game file win instead. Patrick, 25 September,
  had it taken out ("it will make testing easier"): with it, that machine
  never saw the repair a tester's launcher makes. Without it and without this,
  every Play there would have put the previous plugins back.

  HOW. Test-KeptPath and Update-KeptCopies are lifted out of Go.ps1 with
  PowerShell's own parser and run against an install made under a temp
  folder. Go.ps1 and Publish-Update.ps1 are read, not run.
#>
[CmdletBinding()]
param([string]$Repo)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in scripts\tests\, the repository is two folders up.
$Here = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $Repo) { $Repo = $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$go = Join-Path $Repo 'scripts\release\Go.ps1'
$pub = Join-Path $Repo 'scripts\release\Publish-Update.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($go, [ref]$tokens, [ref]$errors)
Yes 'Go.ps1 parses' ($errors.Count -eq 0)
$funcs = @{}
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { $funcs[$f.Name] = $f.Extent.Text }
Yes 'Go.ps1 has Test-KeptPath' ($funcs.ContainsKey('Test-KeptPath'))
Yes 'Go.ps1 has Update-KeptCopies' ($funcs.ContainsKey('Update-KeptCopies'))
if (-not ($funcs.ContainsKey('Test-KeptPath') -and $funcs.ContainsKey('Update-KeptCopies'))) { Done }
. ([ScriptBlock]::Create($funcs['Test-KeptPath'] + "`n" + $funcs['Update-KeptCopies']))

# ---- read from the scripts ------------------------------------------------------
$goText = [IO.File]::ReadAllText($go)
$lines = $goText -split "`r?`n"
$copies = 0; $followed = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    # Copy-ThornswoodShippedFile since #2903: a repo file goes out as One's
    # checkout holds it (ShippedBytes.ps1).
    if ($lines[$i] -match '(Copy-Item .*-Destination|Copy-ThornswoodShippedFile \S+) \(Join-Path \$(ui|plugins) ') {
        $copies++
        if ($i + 1 -lt $lines.Count -and $lines[$i + 1] -match '\$script:installed\.Add\(') { $followed++ }
    }
}
Yes ("every copy Go.ps1 makes into UI or Plugins is listed as installed ({0} of {1})" -f $followed, $copies) ($copies -ge 5 -and $followed -eq $copies)
Yes 'the front zip''s files are listed too' ($goText -match 'ZipFile\]::OpenRead\(\$zip\)' -and $goText -match '\$z\.Entries')
Yes 'the recorded client bundle is listed only when Sync-Client took it' ($goText -match "else \{ \`$script:installed\.Add\(\(Join-Path \`$plugins 'skymp5-client\.js'\)\) \}")
$call = $goText.IndexOf('Update-KeptCopies $Game')
Yes 'Go.ps1 refreshes the kept copies after the plugins folder is swept' ($call -gt $goText.IndexOf('removing stray file from the plugins folder'))

$ptokens = $null; $perrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($pub, [ref]$ptokens, [ref]$perrors)
$flagStrings = @($ptokens | Where-Object { ($_.Kind -eq 'StringLiteral' -or $_.Kind -eq 'StringExpandable') -and $_.Text -match 'developer\.flag' })
Yes 'Publish-Update.ps1 no longer names developer.flag in any string, so nothing writes it' ($flagStrings.Count -eq 0)

# ---- run against an install -------------------------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-gokeeps-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $root = Join-Path $work 'Thornswood-DevBuild'
    $game = Join-Path $root 'Game'
    $keep = Join-Path $root 'Profile\Keep'
    function Put-Text([string]$path, [string]$text) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
        [IO.File]::WriteAllText($path, $text)
    }
    function Get-Text([string]$path) { if (Test-Path -LiteralPath $path) { return [IO.File]::ReadAllText($path) } return $null }

    # What Go.ps1 just put in: a plugin with an older kept copy, the page with
    # none yet, the client bundle, a mesh outside Data\Platform and a text
    # file among the plugins, which Keep never keeps.
    Put-Text (Join-Path $game 'Data\Platform\Plugins\thornswood-front.js') 'front, new'
    Put-Text (Join-Path $keep 'Data\Platform\Plugins\thornswood-front.js') 'front, old'
    Put-Text (Join-Path $game 'Data\Platform\UI\index.html') 'page, new'
    Put-Text (Join-Path $game 'Data\Platform\UI\assets\build.js') 'front build, new'
    Put-Text (Join-Path $game 'Data\Platform\Plugins\skymp5-client.js') 'client, recorded'
    Put-Text (Join-Path $game 'Data\meshes\interface\logo\logo.nif') 'mesh'
    Put-Text (Join-Path $game 'Data\Platform\Plugins\notes.txt') 'notes'
    # Something another launcher wrote over ours, newer than the kept copy.
    # Go.ps1 did not install it, so it must not be adopted.
    Put-Text (Join-Path $game 'Data\Platform\Plugins\thornswood-mark.js') 'mark, another server''s'
    Put-Text (Join-Path $keep 'Data\Platform\Plugins\thornswood-mark.js') 'mark, ours'
    # What Go.ps1 took out: the probe, which has a kept copy.
    Put-Text (Join-Path $keep 'Data\Platform\Plugins\thornswood-probe.js') 'probe'

    $installed = @(
        (Join-Path $game 'Data\Platform\Plugins\thornswood-front.js'),
        (Join-Path $game 'Data\Platform\UI\index.html'),
        (Join-Path $game 'Data\Platform\UI\assets\build.js'),
        (Join-Path $game 'Data\Platform\Plugins\skymp5-client.js'),
        (Join-Path $game 'Data\meshes\interface\logo\logo.nif'),
        (Join-Path $game 'Data\Platform\Plugins\notes.txt')
    )
    $removed = @((Join-Path $game 'Data\Platform\Plugins\thornswood-probe.js'))
    $n = Update-KeptCopies $game $installed $removed

    Yes 'a plugin Go.ps1 installed replaces its older kept copy' ((Get-Text (Join-Path $keep 'Data\Platform\Plugins\thornswood-front.js')) -eq 'front, new')
    Yes 'a page with no kept copy yet gets one' ((Get-Text (Join-Path $keep 'Data\Platform\UI\index.html')) -eq 'page, new')
    Yes 'so does a file in a folder under UI' ((Get-Text (Join-Path $keep 'Data\Platform\UI\assets\build.js')) -eq 'front build, new')
    Yes 'and the client bundle' ((Get-Text (Join-Path $keep 'Data\Platform\Plugins\skymp5-client.js')) -eq 'client, recorded')
    Yes 'a file outside Data\Platform gets no kept copy' (-not (Test-Path -LiteralPath (Join-Path $keep 'Data\meshes\interface\logo\logo.nif')))
    Yes 'nor does a file in Plugins that is not a script' (-not (Test-Path -LiteralPath (Join-Path $keep 'Data\Platform\Plugins\notes.txt')))
    Yes 'it says four were copied' ($n -eq 4)
    Yes 'a file Go.ps1 did not install keeps our copy, so Play still repairs it' ((Get-Text (Join-Path $keep 'Data\Platform\Plugins\thornswood-mark.js')) -eq 'mark, ours')
    Yes 'a file Go.ps1 took out loses its kept copy, so Play does not put it back' (-not (Test-Path -LiteralPath (Join-Path $keep 'Data\Platform\Plugins\thornswood-probe.js')))

    # The Steam copy (-Vortex): no launcher's Profile beside it.
    $steam = Join-Path $work 'common\Skyrim Special Edition'
    Put-Text (Join-Path $steam 'Data\Platform\Plugins\thornswood-front.js') 'front'
    $m = Update-KeptCopies $steam @((Join-Path $steam 'Data\Platform\Plugins\thornswood-front.js')) @()
    Yes 'beside the Steam copy there is no launcher, so nothing is kept and it says so' ($m -eq -1 -and -not (Test-Path -LiteralPath (Join-Path $work 'common\Profile')))

    Yes 'Test-KeptPath refuses a path that climbs out' (-not (Test-KeptPath 'Data\Platform\UI\..\..\x.js'))
    Yes 'and the UI folder itself' (-not (Test-KeptPath 'Data\Platform\UI\'))
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
