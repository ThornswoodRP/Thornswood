<#
.SYNOPSIS
  Puts the collection revision a Release runs on the main collection, from
  the Dev collection, when main is promoted to it (#7193).

.DESCRIPTION
  Run by .github\workflows\promote-main.yml once Patrick approves a
  promotion, in the desk environment with the Nexus key, from the build's
  own commit, before main's launchers are told of the Release:

      pwsh scripts/release/Promote-Collection.ps1 -Manifest <manifest.json>

  WHY. Until #7193 main and Dev shared one collection, 7essxf. Each merged
  mod change published its revision there for Dev, and Vortex offered it to
  every main install at once, before main ran it (revision 13 went out on 27
  Nov while main ran 12). Now a merged change publishes to the Dev collection
  that records\collection.json's dev names (Publish-CollectionRecord.ps1),
  and the main collection gets a revision only here, when main takes a build
  on it. So the main collection's newest revision is always the one main
  runs, and Vortex never offers main's testers another.

  WHAT IT DOES. The Release's signed manifest (New-SignedManifest.ps1) names
  its revision in the records' numbering (collectionRevision) and the same
  revision in the Dev collection (devCollection). Every revision the main
  collection does not have yet, up to that one, is copied from Dev to it in
  order, each as the main collection's revision of the same number
  (Copy-NexusRevision.ps1 -Number), so the records' numbers stay the main
  collection's. A promotion that skips builds copies each revision between.

  A Release from before the Dev collection names none, and nothing is
  copied. A main collection already on that revision is left as it is. One
  past it (main going back to an older Release) is said: Nexus keeps every
  published revision, so the newer one stays the newest there until main
  takes it again.

  What each copy prints goes to a file of its own and is not shown, except
  its STOP line and its last line, as Nexus-Run.ps1 keeps a Nexus script's
  output out of the public log (#2841).

  Exit 0 when the main collection has the revision, 1 when it does not.
  THORNSWOOD_NEXUS_API_KEY comes from the job, or THORNSWOOD_NEXUS_STANDIN
  points at the harness's stand-in (tests\test-7193-promote-collection.ps1).

.PARAMETER Manifest
  The Release's manifest.json.

.PARAMETER CollectionRecord
  records\collection.json unless said: which collection is main's and which
  Dev's.

.PARAMETER PageRecord
  The page's text for Copy-NexusRevision.ps1, records\collection-page.json
  unless said.

.PARAMETER Permissions
  What each mod's page allows, for Copy-NexusRevision.ps1,
  records\collection-permissions.json unless said.

.PARAMETER Game
  The game's domain on Nexus. skyrimspecialedition unless said otherwise.

.PARAMETER WhatIf
  Says each copy it would make and makes none.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Manifest,
    [string]$CollectionRecord,
    [string]$PageRecord,
    [string]$Permissions,
    [string]$Game = 'skyrimspecialedition',
    [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $CollectionRecord) { $CollectionRecord = Join-Path (Join-Path $Repo 'records') 'collection.json' }
$utf8 = New-Object Text.UTF8Encoding($false)
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
$script:Copied = New-Object Collections.Generic.List[string]
function Stop-Promote([string]$m) {
    Write-Host ''
    Write-Host "STOP. $m" -ForegroundColor Red
    if ($script:Copied.Count) { Write-Host ('Copied to the main collection by this run: ' + ($script:Copied -join '; ') + '.') -ForegroundColor Yellow }
    else { Write-Host 'Nothing was changed on Nexus.' -ForegroundColor Yellow }
    exit 1
}

try { $m = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $Manifest).Path) | ConvertFrom-Json } catch { Stop-Promote "The manifest $Manifest could not be read: $($_.Exception.Message)" }
if (-not $m.PSObject.Properties['devCollection'] -or $null -eq $m.devCollection) {
    Say "  $($m.tag) names no Dev collection, so it is from before one (#7193) and its revision is already the main collection's" 'Green'
    exit 0
}
$want = 0; $devRev = 0
if (-not [int]::TryParse([string]$m.collectionRevision, [ref]$want) -or $want -lt 1) { Stop-Promote "The manifest of $($m.tag) names a Dev collection and no collection revision." }
$devSlug = [string]$m.devCollection.slug
if ($devSlug -notmatch '^[a-z0-9]+$' -or -not [int]::TryParse([string]$m.devCollection.revision, [ref]$devRev) -or $devRev -lt 1 -or $devRev -gt $want) {
    Stop-Promote "The manifest of $($m.tag) names no Dev collection slug and revision of it at or below collection revision $want."
}
$off = $want - $devRev

try { $rec = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $CollectionRecord).Path) | ConvertFrom-Json } catch { Stop-Promote "$CollectionRecord could not be read: $($_.Exception.Message)" }
$mainSlug = [string]$rec.collection
if ($mainSlug -notmatch '^[a-z0-9]+$') { Stop-Promote "$CollectionRecord names no main collection." }
if (-not $rec.PSObject.Properties['dev'] -or [string]$rec.dev.collection -ne $devSlug -or [int]$rec.dev.offset -ne $off) {
    Stop-Promote "The manifest of $($m.tag) names the Dev collection $devSlug at offset $off, and $CollectionRecord at this commit does not, so which revision of the main collection it is is not known."
}

try { $have = [int](& (Join-Path $Here 'NexusPublished.ps1') -Slug $mainSlug) } catch { Stop-Promote $_.Exception.Message }
Say "  $($m.tag) runs collection revision $want, the Dev collection $devSlug's revision $devRev; the main collection $mainSlug's newest is $have"
if ($have -eq $want) { Say "  the main collection is on revision $want already" 'Green'; exit 0 }
if ($have -gt $want) {
    Say "  the main collection's newest is $have, past the $want main is going back to: Nexus keeps every published revision, so $have stays the newest there, and Vortex offers it, until main takes it again" 'Yellow'
    exit 0
}

$shell = (Get-Process -Id $PID).Path
$work = Join-Path $(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }) ('thornswood-promote-collection-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null
for ($r = $have + 1; $r -le $want; $r++) {
    $from = $r - $off
    if ($from -lt 1) { Stop-Promote "Collection revision $r is from before the Dev collection (its revision 1 is $($off + 1)), so it cannot be copied from there." }
    $line = "copy the Dev collection $devSlug's revision $from to the main collection $mainSlug as revision $r"
    if ($WhatIf) { Say "  would $line" 'Cyan'; continue }
    $log = Join-Path $work ("copy-$r.txt")
    $args2 = @('-NoProfile', '-NonInteractive', '-File', (Join-Path $Here 'Copy-NexusRevision.ps1'), '-Slug', $devSlug, '-Revision', [string]$from, '-To', $mainSlug, '-Number', [string]$r, '-Game', $Game, '-CollectionRecord', $CollectionRecord, '-NoPause')
    if ($PageRecord) { $args2 += @('-PageRecord', $PageRecord) }
    if ($Permissions) { $args2 += @('-Permissions', $Permissions) }
    $out = @(& $shell @args2 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
    [IO.File]::WriteAllText($log, ($out -join "`n"), $utf8)
    foreach ($l in @($out | Where-Object { $_ -match '^\s*STOP\.' })) { Say ('  Copy-NexusRevision: ' + $l.Trim()) 'Red' }
    if ($code -ne 0) { Stop-Promote "Copy-NexusRevision.ps1 did not $line (exit $code)." }
    $last = @($out | Where-Object { $_ -match '^copied ' } | Select-Object -Last 1)
    $script:Copied.Add("revision $r")
    Say ('  ' + $(if ($last.Count) { $last[0] } else { $line })) 'Green'
}
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
if ($WhatIf) { exit 0 }
try { $now = [int](& (Join-Path $Here 'NexusPublished.ps1') -Slug $mainSlug) } catch { Stop-Promote ("The copies finished, and Nexus did not say the main collection's newest: " + $_.Exception.Message) }
if ($now -ne $want) { Stop-Promote "The copies finished, and the main collection's newest is $now, not $want." }
Say "  the main collection $mainSlug is on revision $want, the one main runs" 'Green'
exit 0
