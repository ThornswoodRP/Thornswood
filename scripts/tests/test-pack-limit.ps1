<#
  test-pack-limit.ps1

  A pack is one zip, and the publisher does not say a host refuses it.

  WHY THIS EXISTS. Publish-Update.ps1 used to split a release so each part
  stayed under a 2 GiB release-asset cap, and it said so by naming that host.
  Since #897 and #907 every pack goes to the site by scp
  (/feed[-dev]/assets/<sha256>). Nothing on that path caps one asset, so the
  split and the refusal are gone. This reads the script and checks the pack
  section, and the release-size note beside it, no longer name that host or
  keep the old cap.

  It does not run Ship, does not publish, and does not need the game or
  C:\Thornswood. Read only. Never connects to anything.
#>
[CmdletBinding()]
param([string]$PublishPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $PublishPath) { $PublishPath = Join-Path $Repo 'scripts\release\Publish-Update.ps1' }

$script:pass = 0
$script:fail = 0
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

function Slice([string]$src, [string]$start, [string]$end) {
    $a = $src.IndexOf($start)
    $b = $src.IndexOf($end)
    if ($a -lt 0 -or $b -le $a) { return $null }
    return $src.Substring($a, $b - $a)
}

# One section of the script, from its divider to the next divider, whatever
# that one is called. The pack section used to be cut to the "launcher exe"
# divider; #5381 took that section out, the cut came back empty and none of
# the checks after it ran (#6425). Null when the divider is not there.
function Section([string]$src, [string]$name) {
    $m = [regex]::Match($src, '(?m)^# -{20,} ' + [regex]::Escape($name) + '\r?$')
    if (-not $m.Success) { return $null }
    $rest = $src.Substring($m.Index + $m.Length)
    $next = [regex]::Match($rest, '(?m)^# -{20,} \S')
    if (-not $next.Success) { return $null }
    return $src.Substring($m.Index, $m.Length + $next.Index)
}

$src = [IO.File]::ReadAllText($PublishPath)
$pack = Section $src 'pack'
$size = Slice $src '# ==== thornswood release size ====' '# ==== end thornswood release size ===='

Yes 'the pack section is in Publish-Update.ps1' ($null -ne $pack)
Yes 'the release size block is still there' ($null -ne $size)
if (-not $pack -or -not $size) { Done }

Yes 'the pack section does not name GitHub' ($pack -notmatch '(?i)github')
Yes 'the release size note does not name GitHub' ($size -notmatch '(?i)github')
Yes 'the old per-pack cap is gone' ($pack -notmatch 'ChunkCap' -and $size -notmatch 'ChunkCap' -and $src -notmatch 'ChunkCap')
Yes 'the 2 GiB refusal is gone' ($pack -notmatch '2147483648')
Yes 'a release is one group, not a running split' ($pack -match '\$groups = @\(,\$changed\)' -and $pack -notmatch 'splitting into')
Yes 'the pack is still built and listed' ($pack -match 'Building the pack' -and $pack -match 'pack-\$partId\.zip')

Done