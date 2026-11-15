<#
  test-release-size.ps1

  A release the size of the mod collection is refused before anything is zipped.

  WHY THIS EXISTS. 17 September: an uninstall test removed Profile from the
  machine that ships, Profile\OwnGame\files.txt went with it, and the next
  release got as far as "29,063 added or changed (11,368.1 MB)" before it was
  stopped by hand. Nothing in the publisher looked at the total. Entry 197 on the To
  Do List: "A size gate on the release, a dozen lines, so an 11.3 GB near-miss
  cannot happen again."

  This lifts the block between the release size markers out of
  Publish-Update.ps1 and feeds it the incident's own number, the way
  test-publish-resume.ps1 lifts the resume block, then reads where the gate is
  called from. The rest of that script uploads and pushes a feed, so
  it is not run here; test-publish-refusals.ps1 runs it whole against a temp
  install with a small cap.

  Read only. Never connects to anything.
#>
[CmdletBinding()]
param([string]$PublishPath, [string]$ShipPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in scripts\tests\, the repository is two folders up.
$Here = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $PublishPath) { $PublishPath = Join-Path $Here 'scripts\release\Publish-Update.ps1' }
if (-not $ShipPath) { $ShipPath = Join-Path $Here 'scripts\release\Ship.ps1' }

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

# ---- lift the gate out of the shipped script ----------------------------------
$src = Get-Content -LiteralPath $PublishPath -Raw
$a = $src.IndexOf('# ==== thornswood release size ====')
$b = $src.IndexOf('# ==== end thornswood release size ====')
Yes 'the release size block is in Publish-Update.ps1' ($a -ge 0 -and $b -gt $a)
if (-not ($a -ge 0 -and $b -gt $a)) { Done }
Invoke-Expression $src.Substring($a, $b - $a)
Yes 'and it defines Get-ReleaseSizeRefusal' ($null -ne (Get-Command Get-ReleaseSizeRefusal -ErrorAction SilentlyContinue))
if ($null -eq (Get-Command Get-ReleaseSizeRefusal -ErrorAction SilentlyContinue)) { Done }

# The parameters as declared, read by the parser rather than by pattern, so a
# reformatted param block still answers.
function Get-Param([string]$path, [string]$name) {
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    if (-not $ast.ParamBlock) { return $null }
    foreach ($p in $ast.ParamBlock.Parameters) {
        if ($p.Name.VariablePath.UserPath -eq $name) { return $p }
    }
    return $null
}

# ---- the numbers, measured rather than chosen ----------------------------------
#
# 11,368.1 MB is what the publisher printed on 17 September. 661.9 MB is every
# file the main baseline records as shipped, 891 of them, read off
# published.json on 24 September: a release of everything we own.
$incident = [int64](11368.1 * 1MB)
$everything = [int64](661.9 * 1MB)

$capParam = Get-Param $PublishPath 'MaxReleaseMB'
Yes 'Publish-Update.ps1 takes -MaxReleaseMB' ($null -ne $capParam)
$cap = [int64]0
if ($null -ne $capParam -and $null -ne $capParam.DefaultValue) { $cap = [int64]$capParam.DefaultValue.Value }
Yes '  with a default cap' ($cap -gt 0)
Yes 'Publish-Update.ps1 takes -AcceptSize' ($null -ne (Get-Param $PublishPath 'AcceptSize'))

$said = Get-ReleaseSizeRefusal $incident $cap $false
Yes 'the release of 17 September is refused at the default cap' ($said -ne '')
Yes '  and the refusal says how big it was' ($said.Contains(('{0:n1} MB' -f 11368.1)))
Yes '  and what the cap is' ($said.Contains(('{0:n0} MB' -f $cap)))

# Far enough above what is real that nobody is trained to reach for the
# override: a release of every file we ship has to go through untouched.
Yes 'a release of everything we have ever shipped goes through' ((Get-ReleaseSizeRefusal $everything $cap $false) -eq '')
Yes 'the cap is at least three times everything we ship' ($cap * 1MB -ge 3 * $everything)
Yes '  and well under the incident' ($cap * 1MB * 2 -le $incident)
Yes 'an ordinary release of a few MB goes through' ((Get-ReleaseSizeRefusal ([int64](3.2 * 1MB)) $cap $false) -eq '')
Yes 'a release of nothing goes through' ((Get-ReleaseSizeRefusal 0 $cap $false) -eq '')
Yes 'exactly the cap goes through' ((Get-ReleaseSizeRefusal ($cap * 1MB) $cap $false) -eq '')
Yes 'one byte over the cap is refused' ((Get-ReleaseSizeRefusal ($cap * 1MB + 1) $cap $false) -ne '')
Yes '-AcceptSize lets even the incident through' ((Get-ReleaseSizeRefusal $incident $cap $true) -eq '')
Yes 'a lower cap given on the command line is the one used' ((Get-ReleaseSizeRefusal ([int64](5 * 1MB)) 1 $false) -ne '')

# ---- where it is called from ----------------------------------------------------
#
# A gate is only worth having on the real total, and only before anything is
# zipped or uploaded.
$sum    = $src.IndexOf('$changedBytes += ')
$call   = $src.IndexOf('Get-ReleaseSizeRefusal $changedBytes $MaxReleaseMB $AcceptSize')
$zip    = $src.IndexOf('[IO.Compression.ZipFile]::Open(')
$upload = $src.IndexOf('# ==== thornswood site upload ====')
Yes 'the gate is asked about $changedBytes, with the cap and the override' ($call -gt $b)
Yes '  after the total is added up' ($sum -ge 0 -and $call -gt $sum)
Yes '  before the first pack is zipped' ($zip -gt $call)
Yes '  and before anything is uploaded' ($upload -gt $call)

# And what it says ends the run. Brace matched from the if that reads it.
$if = $src.IndexOf('if ($tooBig) {', [Math]::Max($call, 0))
$body = ''
if ($call -ge 0 -and $if -gt $call) {
    $open = $src.IndexOf('{', $if)
    $depth = 0
    for ($i = $open; $i -lt $src.Length; $i++) {
        if ($src[$i] -eq '{') { $depth++ }
        elseif ($src[$i] -eq '}') { $depth--; if ($depth -eq 0) { $body = $src.Substring($open, $i - $open + 1); break } }
    }
}
Yes 'a refusal stops the publish' ($body -match '\bDie\b')
Yes '  and names the override' ($body -match '-AcceptSize')

# ---- Ship hands the override on ----------------------------------------------
#
# Ship.ps1 is what gets run. Without the switch there, the only answer to a
# refusal would be running the publisher by hand, around every check Ship makes.
$ship = Get-Content -LiteralPath $ShipPath -Raw
Yes 'Ship.ps1 takes -AcceptSize' ($null -ne (Get-Param $ShipPath 'AcceptSize'))
Yes '  and passes it to Publish-Update' ($ship -match "if \(\`$AcceptSize\) \{ \`$pubArgs\['AcceptSize'\] = \`$true \}")

Done
