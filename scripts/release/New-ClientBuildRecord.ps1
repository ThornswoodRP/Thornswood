<#
.SYNOPSIS
  Records what the client runtime is and which fork commit it was built from,
  into records\client-build.json.

.DESCRIPTION
  Until 20 September the SkyMP client Thornswood shipped was whatever another
  server's launcher had last written into the Steam copy's Data folder: the
  bundle, MpClientPlugin.dll, both SkyrimPlatform DLLs, the CEF host and
  TESModPlatform.pex, all of them another launcher's builds, copied into
  Thornswood's own folder on every rebuild and then patched by text. None of it
  came from Vortex, measured against the deployment manifest, and none of it
  came from here.

  The client is built from the fork now, engine\skymp in this repository, with
  npx webpack in skymp5-client for the bundle and the native build for the
  rest. This records the six files that build produces which differ from
  upstream, by hash, against the fork commit they came from. Sync-Client.ps1
  reads the record and refuses to copy a file whose hash is not the recorded
  one, so a stale or unknown build cannot reach the game folder, and from there
  a pack, by accident. Ship-Rules.ps1 reads it too: a runtime file whose hash
  is in this record is ours, and one that is not is somebody else's.

  Run this after every rebuild of the client. Read only except for the one
  file it writes. It never starts anything and never talks to the VPS.

.PARAMETER Dist
  Where the client build puts its output.

.PARAMETER Clone
  The skymp clone, read for the commit the build came from.

.PARAMETER Out
  The record to write. Committed to this repo.

.PARAMETER BuiltBy
  The run that built -Dist on another machine, from the commit -Clone is at
  (the fork's own build on GitHub's runner, #459, ForkEngineBuild.ps1). The
  clone's sources were checked out after that build, so their dates say
  nothing about it: the build is held to the commit's own time instead, and
  one older than the commit is refused.

.EXAMPLE
  .\scripts\release\New-ClientBuildRecord.ps1
#>
[CmdletBinding()]
param(
  [string]$Dist  = (& (Join-Path $PSScriptRoot 'Where.ps1') ClientDist),
  [string]$Clone = (& (Join-Path $PSScriptRoot 'Where.ps1') Engine),
  [string]$Out,
  [string]$BuiltBy
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named
if (-not $Out) { $Out = Join-Path $PSScriptRoot '..\..\records\client-build.json' }

# The six. Everything else the build produces is byte for byte what is already
# in the game folder, measured 20 September against 91 files.
$Files = @(
  'Data\SKSE\Plugins\MpClientPlugin.dll',
  'Data\SKSE\Plugins\SkyrimPlatform.dll',
  'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformImpl.dll',
  'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformCEF.exe.hidden',
  'Data\Platform\Plugins\skymp5-client.js',
  'Data\Scripts\TESModPlatform.pex'
)

if (-not (Test-Path -LiteralPath $Dist)) { throw "client dist not found: $Dist" }

function Sha256([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }

$rec = [ordered]@{}
$newest = [DateTime]::MinValue
foreach ($rel in $Files) {
  $p = Join-Path $Dist $rel
  if (-not (Test-Path -LiteralPath $p)) { throw "the build is missing $rel" }
  $f = Get-Item -LiteralPath $p
  if ($f.LastWriteTimeUtc -gt $newest) { $newest = $f.LastWriteTimeUtc }
  $rec[$rel] = [ordered]@{ sha256 = (Sha256 $p); bytes = $f.Length }
}

# The bundle's own markers, so a bundle from somebody else's lineage cannot be
# recorded as ours by mistake.
$bundle = Get-Content -LiteralPath (Join-Path $Dist 'Data\Platform\Plugins\skymp5-client.js') -Raw
$patchBlocks = ([regex]::Matches($bundle, 'THORNSWOOD PATCH')).Count
$otherMarkers = ([regex]::Matches($bundle, '(?i)daedric')).Count
if ($patchBlocks -lt 1) { throw 'the bundle carries no THORNSWOOD PATCH block; this is not a build from the fork' }
if ($otherMarkers -gt 0) { throw "the bundle carries $otherMarkers marker(s) from another server's lineage; refusing to record it" }

# The fork is a submodule now, which checks out a commit and not a branch, and
# a fresh clone of it has no upstream remote. Both used to leave the record
# with an empty branch, or "HEAD", and no base (issue #546). These fall back
# to what the clone itself can say.
function Get-ForkBranch([string]$clone, [string]$now) {
  # git says "fatal" on stderr for a ref it does not know. Under Stop that is a
  # thrown error in Windows PowerShell, so the answer is read off its output.
  $ErrorActionPreference = 'Continue'
  if ($now -and $now -ne 'HEAD') { return $now }
  $remote = @(& git -C $clone branch -r --contains HEAD 2>$null | ForEach-Object { "$_".Trim() } | Where-Object { $_ -and $_ -notmatch '->' })
  if ($remote -contains 'origin/thornswood/engine-changes') { return 'thornswood/engine-changes' }
  if ($remote.Count) { return ($remote[0] -replace '^origin/', '') }
  # A clone fetched with one branch knows no other: the branch the repository
  # follows it on, from .gitmodules, when that is where it lives.
  $top = (& git -C $clone rev-parse --show-superproject-working-tree 2>$null | Out-String).Trim()
  if ($top) {
    $b = (& git -C $top config -f .gitmodules --get submodule.engine/skymp.branch 2>$null | Out-String).Trim()
    if ($b) { return $b }
  }
  return $now
}
function Get-UpstreamBase([string]$clone, [string]$now, [string]$recorded) {
  $ErrorActionPreference = 'Continue'
  if ($now) { return $now }
  if ($recorded) {
    & git -C $clone merge-base --is-ancestor $recorded HEAD 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return $recorded }
  }
  return ''
}

# The commit, and whether the clone is clean and the build is not older than
# the source it claims to be built from.
$commit = ''; $branch = ''; $base = ''; $dirty = $false; $stale = @()
# A record with no commit says nothing about where the build came from, so a
# -Clone git cannot read is refused rather than written down as blank.
$ErrorActionPreference = 'Continue'
$commit = ((& git -C $Clone rev-parse --short=8 HEAD 2>$null) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or -not $commit) { $ErrorActionPreference = 'Stop'; throw "not a git clone, or it has no commit: $Clone" }
# A build made on another machine (-BuiltBy) is held to the commit's own
# time: the clone's sources were written when it was checked out, after the
# build, so the stale check below would name every one of them.
if ($BuiltBy) {
  $ct = ((& git -C $Clone show -s --format=%cI HEAD 2>$null) -join '').Trim()
  $ErrorActionPreference = 'Stop'
  try { $commitUtc = [DateTime]::Parse($ct, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal) }
  catch { throw "cannot read the time of commit $commit from $Clone ('$ct'), and a build made elsewhere is held to it" }
  if ($newest -lt $commitUtc) {
    throw ("the newest of the six was written at {0:yyyy-MM-dd HH:mm:ss} UTC, before commit {1} was made ({2:yyyy-MM-dd HH:mm:ss} UTC), so this is not a build of that commit" -f $newest, $commit, $commitUtc)
  }
  Write-Host ('  built by {0}, on another machine: held to the time of commit {1}, {2:yyyy-MM-dd HH:mm:ss} UTC' -f $BuiltBy, $commit, $commitUtc)
  $ErrorActionPreference = 'Continue'
}
$ErrorActionPreference = 'Stop'

# The branch, the base, the dirty check and the stale check. Each one answers
# or stops the record here, before anything is written (#2711). They used to
# sit in a try whose catch was empty, with a second empty catch around the
# recorded base, so a check that threw (a git that could not answer, a record
# that did not read, a source folder that could not be walked) wrote a record
# and said nothing was dirty and nothing was stale: the record Ship and the
# deploys hold the client to, claiming a check that never ran.
#
# git is read by its exit code, not by its stderr: under Stop, Windows
# PowerShell throws on any line git writes there, even through 2>$null.
# -Optional is for the one question a clone may rightly have no answer to,
# the merge-base with upstream/main when it has no upstream remote, and gives
# back '' for it; the record then says the base is unknown, in words.
function Read-CloneGit([string[]]$GitArgs, [string]$What, [switch]$Optional) {
  $ErrorActionPreference = 'Continue'
  $said = @(& git -C $Clone @GitArgs 2>&1)
  $code = $LASTEXITCODE
  $out = @($said | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" })
  if ($code -ne 0) {
    if ($Optional) { return '' }
    $err = (@($said | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" }) -join ' ').Trim()
    throw ("cannot read {0} from {1}: git {2} exited {3} ({4}). Nothing was recorded." -f $What, $Clone, ($GitArgs -join ' '), $code, $err)
  }
  return ($out -join "`n").Trim()
}

$branch = Get-ForkBranch $Clone (Read-CloneGit @('branch', '--show-current') 'the branch that is checked out')
# No record yet is a first record, with no base to carry over. A record that
# is there and does not read stops it: carrying on would drop the base it holds.
$recordedBase = ''
$recordPath = Join-Path $PSScriptRoot '..\..\records\client-build.json'
if (Test-Path -LiteralPath $recordPath) {
  $was = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $recordPath -Raw) $recordPath
  if ($was.PSObject.Properties['upstreamBase']) { $recordedBase = [string]$was.upstreamBase }
}
$base = Get-UpstreamBase $Clone (Read-CloneGit @('merge-base', 'HEAD', 'upstream/main') 'the merge-base with upstream/main' -Optional) $recordedBase
if ($base) { $base = $base.Substring(0, [Math]::Min(8, $base.Length)) } else { $base = 'unknown, fetch upstream to fill this in' }
$dirty = [bool](Read-CloneGit @('status', '--porcelain', '--', 'skymp5-client', 'skymp5-server') 'whether the client and server sources are committed')
# A build made elsewhere is held to the commit's time above instead.
if (-not $BuiltBy) {
  $src = Join-Path $Clone 'skymp5-client\src'
  if (-not (Test-Path -LiteralPath $src -PathType Container)) {
    throw "there is no skymp5-client\src in $Clone, so whether the build is older than its sources cannot be checked. Nothing was recorded."
  }
  $srcFull = (Resolve-Path -LiteralPath $src).ProviderPath.TrimEnd('\')
  foreach ($f in @(Get-ChildItem -LiteralPath $srcFull -Recurse -File -Include *.ts)) {
    if ($f.LastWriteTimeUtc -gt $newest) { $stale += ('skymp5-client\src' + $f.FullName.Substring($srcFull.Length)) }
  }
}

$record = [ordered]@{
  recordedUtc          = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  builtUtc             = $newest.ToString('yyyy-MM-ddTHH:mm:ssZ')
  fork                 = 'https://github.com/ThornswoodRP/skymp'
  forkBranch           = $branch
  forkCommit           = $commit
  upstreamBase         = $base
  thornswoodPatchBlocks = $patchBlocks
  files                = $rec
}
[IO.File]::WriteAllText($Out, (($record | ConvertTo-Json -Depth 5) + "`n"), (New-Object Text.UTF8Encoding($false)))

Write-Host "recorded $($Files.Count) files from $commit on $branch -> $Out" -ForegroundColor Green
foreach ($rel in $Files) { Write-Host ("  {0,-72} {1}  {2,10:N0} b" -f $rel, $rec[$rel].sha256.Substring(0, 12), $rec[$rel].bytes) }
if ($dirty) { Write-Host '  the clone has uncommitted client or server changes; the record names a commit those are not in' -ForegroundColor Yellow }
if ($stale.Count) {
  Write-Host "  $($stale.Count) source file(s) are newer than the build; rebuild before trusting this:" -ForegroundColor Yellow
  $stale | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
}
