<#
.SYNOPSIS
  Builds the game files a merge release carries: dev's last release from the
  site, with this checkout's own files built over it, as one zip and the list
  of what is in it.

.DESCRIPTION
  The game part of the release merge-release.yml builds on every merge to
  main (#5179, plan parts 7 and 9). A Ship builds the same folder on the box
  (Ship.ps1 -FromFeed, #2754); this builds it on GitHub's runner from the
  merged commit, so the release carries the game files the commit makes and
  the box and the launcher can take them from one signed Release.

  WHAT IT DOES, in the order Ship -FromFeed does it:
    1. New-FeedRoot.ps1 -Channel dev stages every file the dev feed's last
       release left installed, each held to its sha256, and the six client
       files held to records\client-build.json (from either feed or CI's
       engine build of the pin, which Get-EngineArtifact.ps1 fetched).
    2. Build-Front.ps1 builds the front from the pinned fork commit and holds
       it to records\front-build.json.
    3. Go.ps1 -Game <root>\Game -SkipServer puts the front, the overlays and
       the plugins in, from this checkout.
    4. Ensure-ShipRequiredData and Save-ShipUiHashedAssets (Ship-Rules.ps1)
       put game\required-data and the front's hashed asset list in, as
       Publish-Update.ps1 does before it packs.
    5. Every file under Game, but *.pdb, goes into game.zip, and
       game-files.json lists each with its size and sha256.

  WHY NO OTHER FILTER. Each file in the folder is either one the dev feed's
  last release recorded, which Ship-Rules passed when that release was
  published, or one this checkout made in steps 2 to 4. New-FeedRoot removes
  anything else first. *.pdb never leaves a machine (Ship-Rules, launcher
  symbols), and Go.ps1 copies none, but the rule is held here as well.

  THE ZIP IS THE SAME FOR THE SAME FILES. Entries sorted by path (ordinal),
  forward slashes, one fixed time (2000-01-01), Optimal compression, and one
  name, so the workflow can tell an unchanged game part from the zip's sha256
  (MergeRelease.ps1) and a rebuild of the same files gives the same bytes.
  The list names the commit and the release it was built over, so it differs
  on every merge and is not what is compared.

  game-files.json:
      { schema: 1, commit, channel: "dev", from: <the record id staged>,
        files: [ { path: "Data/...", size, sha256 } ],
        gone:  [ { path: "Data/...", value } ] }

  WHAT IS GONE. On dev the launcher takes the game files out of the Velopack
  package (launcher/app/SyncPackage.cs), so the list also says which files
  the release no longer ships, in a release record's own words (Sync.cs,
  :gone:): "always" for a path taken out of every install, the sha256 of the
  bytes once shipped for a file taken out only while it still has them, and
  any other value for a file of ours left alone once Vortex deploys that
  path. It is, by path:
    - every :gone: entry of the record staged (-Root's record\record.json),
      as the Ship that published it judged it (Publish-Update.ps1);
    - every file the Release before listed (-PreviousList) and this one does
      not, by the sha256 it had there;
    - every entry of the Release before's own gone list with a sha256 for a
      value and no word in this record, so a launcher that skipped releases
      still takes out what each of them dropped.
  A path this list ships is never gone. The record's word on a path goes
  over the Release before's.

  Talks to the site (https) and, through New-FeedRoot and Build-Front, to
  GitHub and the npm registry. Never to the VPS. Writes only under -Root and
  -Out, Build-Front's own scratch and local\thornswood-front.zip.

.PARAMETER Out
  The folder the zip and game-files.json go in. Made when missing.

.PARAMETER Root
  The folder the release is staged in. A folder under the system's temp
  folder unless given.

.PARAMETER Commit
  The commit the files are built from (40 hex), written into the list.
  git rev-parse HEAD unless given.

.PARAMETER PreviousList
  game-files.json of the build Release before, already held to the sha256
  that Release's manifest names (merge-release.yml), for the gone list.
  Left out when there is no Release before.

.PARAMETER SkipStage
  Tests only: builds the zip and the list from -Root as it is, without
  steps 1 to 4. The gone list still reads -Root's record\record.json when
  it is there.

.EXAMPLE
  pwsh -File scripts/release/Build-GameFiles.ps1 -Out $env:RUNNER_TEMP\game -PreviousList $env:RUNNER_TEMP\previous-game\game-files.json
  What merge-release.yml runs.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$Root,
    [string]$Commit,
    [string]$PreviousList,
    [switch]$SkipStage
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Here = $PSScriptRoot
$RepoDir = (Resolve-Path (Join-Path $Here '..\..')).Path

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Stop-Build([string]$Why) { Write-Host "::error title=Game files::$Why"; Write-Host "STOPPED  $Why"; exit 1 }

if (-not $Commit) { $Commit = "$(git -C $RepoDir rev-parse HEAD)".Trim() }
if ($Commit -notmatch '^[0-9a-f]{40}$') { Stop-Build "the commit '$Commit' is not 40 hex" }
if (-not $Root) { $Root = Join-Path ([IO.Path]::GetTempPath()) 'thornswood-game-files' }
$game = Join-Path $Root 'Game'

. (Join-Path $Here 'Read-JsonFile.ps1')
. (Join-Path $Here 'Release-Baseline.ps1')

$from = ''
if (-not $SkipStage) {
    # Which release is staged, for the list: the record the dev feed names.
    . (Join-Path $Here 'Feed-Store.ps1')
    try { $ptr = Get-FeedBaselinePointer (Read-SiteFeed 'dev' '') } catch { Stop-Build ('the dev feed could not be read: ' + $_.Exception.Message) }
    if ($null -eq $ptr) { Stop-Build 'the dev feed names no record of its last release, so there is nothing to build over' }
    $from = [string]$ptr.id

    Say "dev's last release, $from, from the site" 'Cyan'
    try { & (Join-Path $Here 'New-FeedRoot.ps1') -Channel dev -Root $Root }
    catch { Stop-Build ('dev''s last release could not be staged from the site: ' + $_.Exception.Message) }

    Say 'the front, from the pinned fork commit' 'Cyan'
    try { & (Join-Path $Here 'Build-Front.ps1') }
    catch { Stop-Build ('the front could not be built from the pinned fork commit: ' + $_.Exception.Message) }

    Say 'the front, the overlays and the plugins, from this checkout' 'Cyan'
    $global:LASTEXITCODE = 0
    & (Join-Path $Here 'Go.ps1') -Game $game -SkipServer 6>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Build 'Go.ps1 could not find files this repository has (it exits 1 for a tracked file it cannot find); run it alone to see which' }

    . (Join-Path $Here 'Ship-Rules.ps1')
    try {
        $req = @(Ensure-ShipRequiredData $game $RepoDir)
        if ($req.Count) { Say ('  required data placed: ' + ($req -join ', ')) 'DarkGray' }
        $hashed = @(Save-ShipUiHashedAssets $game)
        Say ("  front hashed assets named by build.js: {0}" -f $hashed.Count) 'DarkGray'
    } catch { Stop-Build $_.Exception.Message }
}

if (-not (Test-Path -LiteralPath $game -PathType Container)) { Stop-Build "there is no game folder at $game" }

# ---- the list and the zip
$listed = (Get-Item -LiteralPath $game).FullName.TrimEnd([IO.Path]::DirectorySeparatorChar)
$entries = New-Object System.Collections.Generic.List[object]
foreach ($f in @(Get-ChildItem -LiteralPath $listed -Recurse -File -Force)) {
    $rel = $f.FullName.Substring($listed.Length + 1).Replace('\', '/')
    if ($rel -like '*.pdb') { continue }
    $entries.Add([pscustomobject]@{ Path = $rel; Full = $f.FullName; Size = $f.Length })
}
if ($entries.Count -eq 0) { Stop-Build "the game folder at $game holds no files" }
# Ordinal, so every machine sorts the same; Sort-Object's culture order is not.
$arr = $entries.ToArray()
[Array]::Sort($arr, [Collections.Generic.Comparer[object]]::Create([Comparison[object]]{ param($a, $b) [string]::CompareOrdinal($a.Path, $b.Path) }))

$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($e in $arr) { if (-not $seen.Add($e.Path)) { Stop-Build "two files in the game folder differ only by case: $($e.Path)" } }

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$zipName = 'game.zip'
$zipPath = Join-Path $Out $zipName
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression
$fixed = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
$list = New-Object System.Collections.Generic.List[object]
$fs = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew)
try {
    $zip = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($e in $arr) {
            $sha = (Get-FileHash -LiteralPath $e.Full -Algorithm SHA256).Hash.ToLowerInvariant()
            $z = $zip.CreateEntry($e.Path, [IO.Compression.CompressionLevel]::Optimal)
            $z.LastWriteTime = $fixed
            $w = $z.Open()
            try { $r = [IO.File]::OpenRead($e.Full); try { $r.CopyTo($w) } finally { $r.Dispose() } } finally { $w.Dispose() }
            $list.Add([ordered]@{ path = $e.Path; size = [int64]$e.Size; sha256 = $sha })
        }
    } finally { $zip.Dispose() }
} finally { $fs.Dispose() }

# ---- what is gone (header, WHAT IS GONE)
$gone = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
$recordMap = @{}
$recordFile = Join-Path (Join-Path $Root 'record') 'record.json'
if (Test-Path -LiteralPath $recordFile -PathType Leaf) { $recordMap = Read-BaselineFile $recordFile }
elseif (-not $SkipStage) { Stop-Build "New-FeedRoot.ps1 left no record at $recordFile" }
$said = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($k in @($recordMap.Keys)) {
    if ($k.StartsWith(':gone:')) { [void]$said.Add($k.Substring(6).Replace('\', '/')) }
    elseif (-not $k.StartsWith(':')) { [void]$said.Add($k.Replace('\', '/')) }
}
if ($PreviousList) {
    if (-not (Test-Path -LiteralPath $PreviousList -PathType Leaf)) { Stop-Build "there is no list of the Release before at $PreviousList" }
    $prevDoc = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($PreviousList)) $PreviousList
    if ($null -eq $prevDoc -or [int]$prevDoc.schema -ne 1 -or -not $prevDoc.PSObject.Properties['files']) { Stop-Build "$PreviousList is not a game-files.json this reads" }
    if ($prevDoc.PSObject.Properties['gone']) {
        foreach ($g in @($prevDoc.gone)) {
            $gp = ([string]$g.path).Replace('\', '/')
            $gv = ([string]$g.value).ToLowerInvariant()
            if ($gp -and $gv -match '^[0-9a-f]{64}$' -and -not $said.Contains($gp)) { $gone[$gp] = $gv }
        }
    }
    foreach ($f in @($prevDoc.files)) {
        $fp = ([string]$f.path).Replace('\', '/')
        $fs256 = ([string]$f.sha256).ToLowerInvariant()
        if ($fs256 -notmatch '^[0-9a-f]{64}$') { Stop-Build "$PreviousList lists $fp without a sha256" }
        $gone[$fp] = $fs256
    }
}
foreach ($k in @($recordMap.Keys)) {
    if ($k.StartsWith(':gone:')) { $gone[$k.Substring(6).Replace('\', '/')] = [string]$recordMap[$k] }
}
foreach ($e in $arr) { [void]$gone.Remove($e.Path) }
$goneList = New-Object System.Collections.Generic.List[object]
$gonePaths = [string[]]@($gone.Keys)
[Array]::Sort($gonePaths, [StringComparer]::Ordinal)
foreach ($gp in $gonePaths) { if ($gp) { $goneList.Add([ordered]@{ path = $gp; value = $gone[$gp] }) } }

$doc = [ordered]@{ schema = 1; commit = $Commit; channel = 'dev'; from = $from; files = $list.ToArray(); gone = $goneList.ToArray() }
$listPath = Join-Path $Out 'game-files.json'
[IO.File]::WriteAllText($listPath, ($doc | ConvertTo-Json -Depth 5 -Compress), (New-Object Text.UTF8Encoding($false)))
$mb = (Get-Item -LiteralPath $zipPath).Length / 1MB
Say ("game files: {0} file(s) in {1} ({2:N1} MB), built over dev release {3}" -f $list.Count, $zipName, $mb, $(if ($from) { $from } else { '(none staged)' })) 'Green'
Say ("  {0} path(s) the release no longer ships are listed as gone" -f $goneList.Count) 'DarkGray'
exit 0
