<#
  test-1955-ship-stack-note.ps1

  #1955. Ship-Stack.ps1 called Deploy-DevGamemode.ps1 with an empty set of
  arguments, so no -Note, and Deploy-DevGamemode refuses a deploy without one
  since #594 (2 Oct). Every dev run of the stack stopped at its first step.

  So Ship-Stack takes -Note now and hands it to Deploy-DevGamemode as -Note.
  This runs the real Ship-Stack.ps1 from a scratch copy of scripts\ whose
  four scripts it calls (Deploy-DevGamemode, Deploy-Gamemode, Deploy-Server,
  Publish-PostShip) are stand-ins: each has the real script's own param
  block, lifted by the parser, so the arguments bind exactly as they would
  against the real one, and a body that only writes down what it was given.
  Nothing is deployed or sent. The stack's installer step went with the old
  installer (#4824).

  Runs under PowerShell 7 and Windows PowerShell 5.1.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$stack = Join-Path $repo 'scripts\release\Ship-Stack.ps1'
$errs = $null
[void][Management.Automation.Language.Parser]::ParseFile($stack, [ref]$null, [ref]$errs)
Yes 'Ship-Stack.ps1 parses' (@($errs).Count -eq 0)

# -Note is the one positional parameter, so a bare note can never bind to
# -Channel (which would refuse it as not main or dev), as in #1929.
$cmd = Get-Command $stack
$positional = @($cmd.Parameters.Values | Where-Object {
    $_.ParameterSets.ContainsKey('__AllParameterSets') -and $_.ParameterSets['__AllParameterSets'].Position -ge 0
} | ForEach-Object { $_.Name })
Yes 'Ship-Stack takes -Note' ($cmd.Parameters.ContainsKey('Note'))
Yes '  as its only positional parameter' ($positional.Count -eq 1 -and $positional[0] -eq 'Note')

# ---- the scratch scripts\ ---------------------------------------------------
$box = Join-Path ([IO.Path]::GetTempPath()) ('ts-1955-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$release = Join-Path $box 'scripts\release'
$deploy = Join-Path $box 'scripts\deploy'
$record = Join-Path $box 'record'
$dist = Join-Path $box 'dist'
New-Item -ItemType Directory -Force -Path $release, $deploy, $record, $dist | Out-Null
$copy = Join-Path $release 'Ship-Stack.ps1'
Copy-Item -LiteralPath $stack -Destination $copy

# The called scripts' defaults ask Where.ps1 for a folder; the stand-in names
# one inside the scratch folder, so nothing reads the repo's layout.
[IO.File]::WriteAllText((Join-Path $release 'Where.ps1'), "param([string]`$What) Join-Path '$($box.Replace("'", "''"))' (`"where-`" + `$What)`r`n")

# A stand-in: the real script's attributes and param block, and a body that
# writes the parameters it was bound to as JSON under record\<name>.json.
function New-StandIn([string]$from, [string]$to) {
    $ast = [Management.Automation.Language.Parser]::ParseFile($from, [ref]$null, [ref]$null)
    $p = $ast.ParamBlock
    $attrs = @($p.Attributes | ForEach-Object { $_.Extent.Text }) -join "`r`n"
    $name = [IO.Path]::GetFileNameWithoutExtension($to)
    $out = (Join-Path $record ($name + '.json')).Replace("'", "''")
    $body = @"
`$got = @{}
foreach (`$k in `$PSBoundParameters.Keys) { `$got[`$k] = [string]`$PSBoundParameters[`$k] }
[IO.File]::WriteAllText('$out', (ConvertTo-Json -InputObject `$got))
exit 0
"@
    [IO.File]::WriteAllText($to, ($attrs + "`r`n" + $p.Extent.Text + "`r`n" + $body))
}
New-StandIn (Join-Path $repo 'scripts\deploy\Deploy-DevGamemode.ps1') (Join-Path $deploy 'Deploy-DevGamemode.ps1')
New-StandIn (Join-Path $repo 'scripts\deploy\Deploy-Gamemode.ps1') (Join-Path $deploy 'Deploy-Gamemode.ps1')
New-StandIn (Join-Path $repo 'scripts\deploy\Deploy-Server.ps1') (Join-Path $deploy 'Deploy-Server.ps1')
New-StandIn (Join-Path $repo 'scripts\release\Publish-PostShip.ps1') (Join-Path $release 'Publish-PostShip.ps1')

function Get-Record([string]$name) {
    $f = Join-Path $record ($name + '.json')
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    return ([IO.File]::ReadAllText($f) | ConvertFrom-Json)
}
function Get-Ran { @(Get-ChildItem -LiteralPath $record -Filter '*.json' | ForEach-Object { $_.BaseName } | Sort-Object) }

# Runs the scratch Ship-Stack with these arguments, after clearing the
# record. Returns what it printed, its runs of spaces and line ends made one
# space because Windows PowerShell 5.1 wraps a long line at its width, and
# its exit code.
function Invoke-Stack([hashtable]$with, [string]$bare) {
    Get-ChildItem -LiteralPath $record -Filter '*.json' | Remove-Item -Force
    $global:LASTEXITCODE = 0
    if ($PSBoundParameters.ContainsKey('bare')) { $out = & $copy $bare @with *>&1 | Out-String }
    else { $out = & $copy @with *>&1 | Out-String }
    [pscustomobject]@{ Out = ($out -replace '\s+', ' '); Code = $LASTEXITCODE; Ran = @(Get-Ran) }
}

$note = "The door answers on the first knock`n- The door no longer needs a second try before it opens."
try {
    # ---- dev, with a note: it reaches Deploy-DevGamemode as -Note ---------------
    $r = Invoke-Stack @{ Channel = 'dev'; Note = $note; DistRoot = $dist; NoPause = $true }
    Yes 'a dev run with -Note finishes' ($r.Code -eq 0)
    Yes '  and runs the dev gamemode and the remirror' (($r.Ran -join ',') -eq 'Deploy-DevGamemode,Publish-PostShip')
    $g = Get-Record 'Deploy-DevGamemode'
    Yes '  Deploy-DevGamemode is given the note as -Note, every line of it' ($null -ne $g -and $g.PSObject.Properties['Note'] -and $g.Note -eq $note)
    Yes '  and nothing else, so it deploys with its own defaults as before' ($null -ne $g -and @($g.PSObject.Properties).Count -eq 1)
    $post = Get-Record 'Publish-PostShip'
    Yes '  the remirror is not given the note' ($null -ne $post -and -not $post.PSObject.Properties['Note'])

    # ---- dev, the note bare --------------------------------------------------
    $r = Invoke-Stack @{ DistRoot = $dist; NoPause = $true } $note
    $g = Get-Record 'Deploy-DevGamemode'
    Yes 'a bare note after the script is the note' ($r.Code -eq 0 -and $null -ne $g -and $g.Note -eq $note)

    # ---- dev, no note: stops before any step --------------------------------
    $r = Invoke-Stack @{ Channel = 'dev'; DistRoot = $dist; NoPause = $true }
    Yes 'a dev run without -Note stops' ($r.Code -eq 1)
    Yes '  before any step runs' ($r.Ran.Count -eq 0)
    Yes '  and says to give -Note' ($r.Out -match 'Ship-Stack\.ps1 -Note "')
    $r = Invoke-Stack @{ Channel = 'dev'; Note = '   '; DistRoot = $dist; NoPause = $true }
    Yes 'a note of only spaces is no note' ($r.Code -eq 1 -and $r.Ran.Count -eq 0)

    # ---- dev, gamemode skipped: no note wanted ------------------------------
    $r = Invoke-Stack @{ Channel = 'dev'; SkipGameMode = $true; DistRoot = $dist; NoPause = $true }
    Yes 'a dev run with -SkipGameMode needs no note' ($r.Code -eq 0 -and ($r.Ran -join ',') -eq 'Publish-PostShip')
    $r = Invoke-Stack @{ Channel = 'dev'; SkipGameMode = $true; Note = $note; DistRoot = $dist; NoPause = $true }
    Yes '  and refuses one, which nothing would post, before any step runs' ($r.Code -eq 1 -and $r.Ran.Count -eq 0 -and $r.Out -match 'SkipGameMode leaves it out')

    # ---- main: no note, the two main deploys as before ----------------------
    $r = Invoke-Stack @{ Channel = 'main'; DistRoot = $dist; NoPause = $true }
    Yes 'a main run needs no note and runs Deploy-Gamemode then Deploy-Server' ($r.Code -eq 0 -and ($r.Ran -join ',') -eq 'Deploy-Gamemode,Deploy-Server,Publish-PostShip')
    $r = Invoke-Stack @{ Channel = 'main'; Note = $note; DistRoot = $dist; NoPause = $true }
    Yes '  and refuses a note, which its deploys do not post, before any step runs' ($r.Code -eq 1 -and $r.Ran.Count -eq 0 -and $r.Out -match 'Main''s gamemode deploys post none')
}
finally { Remove-Item -LiteralPath $box -Recurse -Force }

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
