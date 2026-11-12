<#
.SYNOPSIS
  Records every server file the fork builds and the one commit they were built
  from, into records\server-build.json.

.DESCRIPTION
  The server binaries have always been copied rather than rebuilt, and nothing
  mapped them back to source. On 2026-09-17 the only evidence that the shipped
  scam_native.node contained the committed server changes was that its file date
  was six minutes later than the last edit to ScampServer.cpp. A file date is not
  a build record.

  Run this after every rebuild of skymp (Build-Server.ps1 runs it). Deploy-Server,
  Export-ServerPayload, Publish-Server and the installer on the box read the
  result and refuse any server file whose hash is not the recorded one, so a
  stale or unknown build cannot reach the VPS by accident.

  EVERY SERVER FILE, NOT ONLY THE BINARY (#1200, #1214). The record lists
  every file the fork's build puts in the server (scripts\deploy\ServerBuild.ps1
  names them and says why), each with its hash and the one fork commit. It is
  written only for files this can tie to that commit:
    dist_back\skymp5-server.js(.map)  every TypeScript source the source map
                                      carries is the fork's, word for word, and
                                      every package it bundled that is on disk
                                      (server-bundle-sources.js); the fork's
                                      packages are the ones its yarn.lock names
                                      (yarn check --integrity); the bundle
                                      names that map
    package.json, yarn.lock           the fork's skymp5-server ones, byte for byte
    data\scripts\*                    the fork's compiled Papyrus, byte for byte,
                                      every one of them: build\skymp5-scripts\pex
                                      when the build compiled it there, each
                                      newer than its .psc, otherwise the
                                      committed skymp5-scripts\pex (#1220)
    launch_server.bat                 the one the fork's configure wrote
    scam_native.node                  built from the clone, newer than its sources
  Anything else stops it and nothing is written.

  Read only except for the one file it writes. It never starts anything and never
  talks to the VPS.

.PARAMETER Dist
  Where the build puts the server. The same default Deploy-Server.ps1 uses.

.PARAMETER Clone
  The skymp clone, read for the commit the files came from and held to.

.PARAMETER Out
  The record to write. Committed to this repo, so a reader can answer what the
  live server is running without guessing from timestamps.

.PARAMETER BuiltBy
  The run that built -Dist on another machine, from the commit -Clone is at:
  the fork's own build on GitHub's runner, which engine.yml takes (#459,
  ForkEngineBuild.ps1). The clone was checked out after that build, so its
  files' dates say nothing about it; each time the build is held to is the
  commit's own time instead, and a file written before the commit was made
  stops it. Without it, the files' dates in the clone are read as they are on
  the machine that built them.

.EXAMPLE
  .\scripts\release\New-ServerBuildRecord.ps1
#>
#Requires -Version 7
param(
  [string]$Dist  = (& (Join-Path $PSScriptRoot 'Where.ps1') ServerDist),
  [string]$Clone = (& (Join-Path $PSScriptRoot 'Where.ps1') Engine),
  [string]$Out,
  [string]$BuiltBy
)

$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Out) { $Out = Join-Path $Here '..\..\records\server-build.json' }
. (Join-Path $Here '..\deploy\ServerBuild.ps1')
. (Join-Path $Here 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named

$bin = Join-Path $Dist 'scam_native.node'
if (-not (Test-Path -LiteralPath $bin)) { throw "not built: $bin" }
foreach ($n in $ThornswoodServerForkFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $Dist $n))) { throw "not built: $(Join-Path $Dist $n). Build-Server.ps1 builds every server file. Nothing was recorded." }
}

$item = Get-Item -LiteralPath $bin
$hash = (Get-FileHash -LiteralPath $bin -Algorithm SHA256).Hash.ToLowerInvariant()

# Named Read-Git, not Git. A function called Git wins name resolution over
# git.exe, so '& git' inside it called itself until the call stack blew.
#
# The exit code decides, not stderr. Under Windows PowerShell 5.1 with Stop, a
# line git writes to stderr (a clone with no upstream remote says "No such
# remote") ends the script even through 2>$null, so a fork without that
# remote could not be recorded from 5.1 at all.
function Read-Git([string[]]$a) {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $o = & git -C $Clone @a 2>$null } finally { $ErrorActionPreference = $eap }
  if ($LASTEXITCODE -ne 0) { return '' }
  return ($o | Out-String).Trim()
}
# For a question the clone must answer, where '' would read as an answer: an
# empty `git status --porcelain` is a clean clone, so a git that could not say
# must not hand back the same '' (#2711). It stops the record instead.
function Read-GitOrStop([string[]]$a, [string]$what) {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $o = @(& git -C $Clone @a 2>&1); $code = $LASTEXITCODE } finally { $ErrorActionPreference = $eap }
  if ($code -ne 0) {
    $err = (@($o | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" }) -join ' ').Trim()
    throw ("cannot read {0} from {1}: git {2} exited {3} ({4}). Nothing was recorded." -f $what, $Clone, ($a -join ' '), $code, $err)
  }
  return (@($o | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" }) -join "`n").Trim()
}

# The fork is a submodule now, which checks out a commit and not a branch, and
# a fresh clone of it has no upstream remote. Both used to leave the record
# with an empty branch, or "HEAD", and no base (issue #546). These fall back
# to what the clone itself can say.
#
# The fork's branch first, whatever the local one is called: a fork worktree
# on a local branch of its own (thornswood/1200-craft-resync, 29 Sep) holding
# a commit that is on thornswood/engine-changes recorded the local name, and
# tests\test-one-engine.js holds the record to the branch .gitmodules follows.
function Get-ForkBranch([string]$clone, [string]$now) {
  # Read-Git's reason: git's stderr must not end the script under 5.1.
  $ErrorActionPreference = 'Continue'
  $remote = @(& git -C $clone branch -r --contains HEAD 2>$null | ForEach-Object { "$_".Trim() } | Where-Object { $_ -and $_ -notmatch '->' })
  if ($remote -contains 'origin/thornswood/engine-changes') { return 'thornswood/engine-changes' }
  if ($now -and $now -ne 'HEAD') { return $now }
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

$commit = Read-Git @('rev-parse', 'HEAD')
$branch = Get-ForkBranch $Clone (Read-Git @('rev-parse', '--abbrev-ref', 'HEAD'))
$origin = Read-Git @('remote', 'get-url', 'origin')
$upstream = Read-Git @('remote', 'get-url', 'upstream')
if (-not $commit) { throw "cannot read a commit from $Clone. Is it a git clone?" }
# No record yet is a first record, with no base to carry over. A record that
# is there and does not read stops it (#2711): it used to sit in an empty
# catch, so the base it held was dropped without a word.
$recordedBase = ''
$recordPath = Join-Path $PSScriptRoot '..\..\records\server-build.json'
if (Test-Path -LiteralPath $recordPath) {
  $was = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $recordPath -Raw) $recordPath
  if ($was.PSObject.Properties['source'] -and $was.source -and $was.source.PSObject.Properties['upstreamBase']) { $recordedBase = [string]$was.source.upstreamBase }
}
$base = Get-UpstreamBase $Clone (Read-Git @('merge-base', 'HEAD', 'upstream/main')) $recordedBase
$dirty = Read-GitOrStop @('status', '--porcelain') 'whether the clone is committed'

# A build made on another machine (-BuiltBy): the time every date below is
# held to is the commit's, since this clone's files were written when it was
# checked out, after the build. Nothing built from the commit can be older.
$commitUtc = $null
if ($BuiltBy) {
  $ct = Read-Git @('show', '-s', '--format=%cI', $commit)
  try { $commitUtc = [DateTime]::Parse($ct, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal) }
  catch { throw "cannot read the time of commit $commit from $Clone ('$ct'), and a build made elsewhere is held to it" }
  Write-Host ('  built by {0}, on another machine: each date is held to the time of commit {1}, {2:yyyy-MM-dd HH:mm:ss} UTC' -f $BuiltBy, $commit.Substring(0, 12), $commitUtc)
}

if ($dirty) {
  Write-Host ''
  Write-Host '  The clone has uncommitted changes.' -ForegroundColor Yellow
  Write-Host '  The commit recorded below will not describe the binary exactly.' -ForegroundColor Yellow
  Write-Host '  Commit first, rebuild, then run this again.' -ForegroundColor Yellow
  Write-Host ''
}

# Whether the binary is at least newer than every server source. This is weak
# evidence on its own, which is the whole reason this file exists, but a binary
# OLDER than its sources is a definite problem worth stopping for.
#
# Only cpp\, never the whole of skymp5-server: node_modules holds 7,300 of that
# folder's 7,746 files and walking it turned a one second check into minutes.
# Not ts\ either: the TypeScript is built into dist_back\skymp5-server.js, never
# into scam_native.node, so a change to it alone leaves the binary as it was
# and this said "rebuild" about a build that was whole (the #1972 change to
# index.ts, 5 Oct). The JavaScript half is held to the fork's sources by its
# map, below, which is stronger than any timestamp.
#
# A folder that is not there, or that cannot be walked, stops the record
# (#2711): the walk used to skip a missing cpp\ and pass over what it could
# not read, so a check that never ran said nothing was newer than the binary.
$newest = $null
$d = Join-Path $Clone 'skymp5-server\cpp'
# A build made elsewhere is held to the commit's time instead, below.
if (-not $BuiltBy) {
  if (-not (Test-Path -LiteralPath $d -PathType Container)) {
    throw "there is no skymp5-server\cpp in $Clone, so whether the binary is older than its sources cannot be checked. Nothing was recorded."
  }
  $newest = Get-ChildItem -LiteralPath $d -Recurse -File |
       Where-Object { $_.Extension -in '.cpp', '.h' -and $_.FullName -notlike '*\node_modules\*' } |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if ($newest -and $newest.LastWriteTime -gt $item.LastWriteTime) {
  Write-Host ''
  Write-Host ('  {0} is newer than the binary.' -f $newest.Name) -ForegroundColor Yellow
  Write-Host '  The build does not contain the latest source. Rebuild before recording.' -ForegroundColor Yellow
  Write-Host ''
}

# ---- every other server file, tied to the clone (#1200, #1214) ----------------
# See the header for what each is held to. Every reason is gathered, then all of
# them are said, so one run shows everything that is wrong.
$why = @()
if ($BuiltBy -and $item.LastWriteTimeUtc -lt $commitUtc) {
  $why += ('scam_native.node was written at {0:yyyy-MM-dd HH:mm:ss} UTC, before commit {1} was made ({2:yyyy-MM-dd HH:mm:ss} UTC), so it is not a build of that commit' -f $item.LastWriteTimeUtc, $commit.Substring(0, 12), $commitUtc)
}
function Test-SameBytes([string]$a, [string]$b) {
  if (-not (Test-Path -LiteralPath $a) -or -not (Test-Path -LiteralPath $b)) { return $false }
  return (Get-FileHash -LiteralPath $a -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $b -Algorithm SHA256).Hash
}
$srv = Join-Path $Clone 'skymp5-server'
foreach ($n in 'package.json', 'yarn.lock') {
  if (-not (Test-SameBytes (Join-Path $Dist $n) (Join-Path $srv $n))) { $why += "$n in the build is not the fork's skymp5-server\$n" }
}
# The fork's Papyrus. With the Creation Kit's compiler, the fork compiles it
# into its build folder and leaves the committed skymp5-scripts\pex alone
# (fork #31, #1220); without it, the build copies the committed files. So
# data\scripts is held to the build's own compile when there is one, each
# newer than the .psc it came from, and to the committed files otherwise.
$pexName = 'skymp5-scripts\pex'
$builtPexName = 'build\skymp5-scripts\pex'
$builtPex = Join-Path $Clone $builtPexName
$pscDir = Join-Path $Clone 'skymp5-scripts\psc'
if (Test-Path -LiteralPath $builtPex) {
  $pexName = $builtPexName
  $psc = @(if (Test-Path -LiteralPath $pscDir) { Get-ChildItem -LiteralPath $pscDir -File -Filter '*.psc' })
  foreach ($s in $psc) {
    $p = Join-Path $builtPex ($s.BaseName + '.pex')
    # The .psc's own date, or for a build made elsewhere the commit's.
    $pscUtc = if ($BuiltBy) { $commitUtc } else { $s.LastWriteTimeUtc }
    if (-not (Test-Path -LiteralPath $p)) { $why += "the build compiled the fork's Papyrus into $builtPexName but has no $($s.BaseName).pex for skymp5-scripts\psc\$($s.Name)" }
    elseif ((Get-Item -LiteralPath $p).LastWriteTimeUtc -lt $pscUtc) { $why += "$builtPexName\$($s.BaseName).pex is older than skymp5-scripts\psc\$($s.Name), so it was not compiled from it" }
  }
  foreach ($p in @(Get-ChildItem -LiteralPath $builtPex -File)) {
    if (-not (@($psc | Where-Object { $_.BaseName -eq $p.BaseName }).Count)) { $why += "$builtPexName\$($p.Name) has no .psc in the fork's skymp5-scripts\psc" }
  }
}
$pexDir = Join-Path $Clone $pexName
$distPex = Join-Path $Dist 'data\scripts'
$forkPex = @(if (Test-Path -LiteralPath $pexDir) { Get-ChildItem -LiteralPath $pexDir -File | ForEach-Object { $_.Name } })
if (-not $forkPex.Count) { $why += "the fork has no compiled Papyrus in $pexDir, so data\scripts cannot be tied to it" }
foreach ($n in $forkPex) {
  if (-not (Test-SameBytes (Join-Path $distPex $n) (Join-Path $pexDir $n))) { $why += "data\scripts\$n in the build is not the fork's $pexName\$n" }
}
foreach ($f in @(if (Test-Path -LiteralPath $distPex) { Get-ChildItem -LiteralPath $distPex -Recurse -File })) {
  if ($forkPex -notcontains $f.Name) { $why += "data\scripts\$($f.Name) in the build is not one the fork compiles" }
}
# Written by the fork's configure into the build folder, and copied beside the
# server after every build of the addon.
$bat = Join-Path $Clone 'build\skymp5-server\launch_server.bat.tmp'
if (-not (Test-SameBytes (Join-Path $Dist 'launch_server.bat') $bat)) { $why += "launch_server.bat in the build is not the one the fork's configure wrote ($bat)" }
# The JavaScript half: the bundle names its map, the map's sources are the
# fork's, and the fork's packages are its lockfile's.
$js = Join-Path $Dist 'dist_back\skymp5-server.js'
# A bundle that cannot be read is named as that (#2711). Its catch used to be
# empty, and the reason given was that the bundle names no map, which is not
# what was wrong.
$tail = ''
$tailWhy = ''
try {
  $fs = [IO.File]::OpenRead($js)
  try {
    $n = [Math]::Min(200, [int]$fs.Length); [void]$fs.Seek(-$n, 'End'); $buf = New-Object byte[] $n; [void]$fs.Read($buf, 0, $n)
    $tail = [Text.Encoding]::ASCII.GetString($buf)
  } finally { $fs.Dispose() }
} catch { $tailWhy = $_.Exception.Message }
if ($tailWhy) { $why += "dist_back\skymp5-server.js could not be read, so whether it names its map is not known: $tailWhy" }
elseif ($tail -notmatch 'sourceMappingURL=skymp5-server\.js\.map\s*$') { $why += 'dist_back\skymp5-server.js does not name skymp5-server.js.map as its map, so the map says nothing about it' }
$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) { $why += 'node is not on this machine, so the JavaScript half cannot be tied to the fork' }
else {
  $said = @(& $node.Source (Join-Path $Here 'server-bundle-sources.js') (Join-Path $Dist 'dist_back\skymp5-server.js.map') $Clone 2>&1 | ForEach-Object { "$_" })
  if ($LASTEXITCODE -ne 0) { $why += @($said | ForEach-Object { "dist_back\skymp5-server.js: $_" }) }
  else { Write-Host ('  the JavaScript half was built from the fork''s sources: ' + (($said | Select-Object -Last 1) -replace '^SOURCES OK (\d+) (\d+)$', '$1 sources, $2 of them the server''s own TypeScript')) }
  $yarn = Get-Command yarn -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $yarn) { $why += 'yarn is not on this machine, so the packages the JavaScript half bundles cannot be held to the fork''s yarn.lock' }
  else {
    # Run in the folder rather than given it: yarn is a .cmd, and cmd.exe
    # splits a path argument at an & (the worktrees folder has one).
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    Push-Location -LiteralPath $srv
    try { $ys = @(& yarn check --integrity 2>&1 | ForEach-Object { "$_" }); $yc = $LASTEXITCODE } finally { Pop-Location; $ErrorActionPreference = $eap }
    if ($yc -ne 0) { $why += ("the packages in $srv\node_modules are not the ones its yarn.lock names (yarn check --integrity: " + (($ys | Where-Object { $_ -match 'error' } | Select-Object -First 2) -join ' ') + '). Build-Server.ps1 installs them.') }
  }
}
if ($why.Count) {
  Write-Host ''
  Write-Host '  NOT RECORDED. These server files cannot be tied to the clone:' -ForegroundColor Red
  foreach ($w in $why) { Write-Host ('    ' + $w) -ForegroundColor Red }
  Write-Host '  .\scripts\release\Build-Server.ps1 builds every one of them from the clone and records them.' -ForegroundColor Yellow
  throw 'the server build does not match the clone; nothing was recorded'
}

# Whether this engine loads light plugins (#1715): the fork that can tell a
# light plugin from a full one has espm::IsLightPlugin in
# libespm\include\libespm\LoadOrder.h. Read from the commit recorded, not from
# the files on disk, so an uncommitted edit cannot say it does.
# Deploy-Gamemode.ps1 lists light plugins in the server's load order only
# when the record says so (ServerOrder.ps1); an engine without it would give
# each a full index and move every full plugin after the first one.
$lightHeader = Read-Git @('show', "${commit}:libespm/include/libespm/LoadOrder.h")
$lightPlugins = [bool]($lightHeader -match '\bIsLightPlugin\s*\(')

$files = [ordered]@{}
$sums = Get-ThornswoodServerFolderSums $Dist
foreach ($rel in @($sums.Keys | Sort-Object)) {
  $files[$rel] = [ordered]@{ 'sha256' = $sums[$rel]; 'bytes' = (Get-Item -LiteralPath (Join-Path $Dist ($rel -replace '/', '\'))).Length; 'commit' = $commit }
}

$rec = [ordered]@{
  '_note'   = 'What the server in this release is, and the source it was built from: every file the fork builds into it, by hash, and the one fork commit (scripts\deploy\ServerBuild.ps1 says which files). sha256 is the binary''s. Export-ServerPayload, Publish-Server, Deploy-Server and the installer refuse any server file that is not this. Regenerate with scripts\release\New-ServerBuildRecord.ps1 after every rebuild.'
  'binary'  = 'scam_native.node'
  'sha256'  = $hash
  'bytes'   = $item.Length
  'builtUtc' = $item.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')
  'source'  = [ordered]@{
    'repo'         = $origin
    'branch'       = $branch
    'commit'       = $commit
    'upstream'     = $upstream
    'upstreamBase' = $base
  }
  'files'    = $files
  'recorded' = (Get-Date).ToString('yyyy-MM-dd')
}
if ($lightPlugins) { $rec['lightPlugins'] = $true }

# Written the way New-ClientBuildRecord.ps1 writes its record: UTF-8 with no
# byte order mark. Windows PowerShell's -Encoding UTF8 puts one in, and the
# record of 26 September went to GitHub with it, which PowerShell reads
# happily and JSON.parse does not, so tests\test-third-party.js could not read
# the server commit and the three lines that hold THIRD-PARTY.md and the
# credits page to it never ran.
[IO.File]::WriteAllText($Out, (($rec | ConvertTo-Json -Depth 5) + "`n"), (New-Object Text.UTF8Encoding($false)))

Write-Host 'Server build recorded'
Write-Host '---------------------'
Write-Host ('  sha256  {0}' -f $hash)
Write-Host ('  bytes   {0:N0}' -f $item.Length)
Write-Host ('  built   {0}' -f $item.LastWriteTime)
Write-Host ('  commit  {0}' -f $commit)
Write-Host ('  branch  {0}' -f $branch)
Write-Host ('  light   {0}' -f $(if ($lightPlugins) { 'loads light plugins (lightPlugins true)' } else { 'loads no light plugin' }))
foreach ($rel in @($files.Keys)) { Write-Host ('  {0}  {1}' -f $files[$rel].sha256.Substring(0, 12), $rel) }
Write-Host ('  written {0}' -f $Out)
Write-Host ''
Write-Host '  Commit this file with the release it describes.' -ForegroundColor DarkGray
