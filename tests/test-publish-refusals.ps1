<#
  test-publish-refusals.ps1

  The publisher refuses, whole and for real, the releases it exists to refuse.

  WHY THIS EXISTS. 17 September: an uninstall test removed Profile from the
  machine that ships. Profile\OwnGame\files.txt, the only record of which
  files in the game folder came from Vortex, went with it, and the next
  release counted "29,063 added or changed (11,368.1 MB)" before it was
  stopped by hand. Two refusals answer that now: no record, no release; and
  no release over the size cap. Entry 197 on the To Do List asks for "the
  publisher refuses without files.txt" as a test, and nothing ran either one.

  So this runs the real Publish-Update.ps1, in a child PowerShell, against a
  made up install in a temp folder, and reads what it did:

    no files.txt                   refused, naming files.txt
    a files.txt naming nothing     refused
    a release over -MaxReleaseMB   refused by the size gate, nothing zipped
    the same with -AcceptSize      goes past the size gate
    a release under the cap        goes past the size gate
    a Vortex behind the record     stops, naming both revisions (#3597)
    a Vortex that cannot say       stops, never naming a guess

  Every run also checks that the feed and the baseline are byte for byte what
  they were, because a refusal that has already written either one is the
  dry run fault of 17 September over again.

  WHY IT IS SAFE TO RUN ANYWHERE. The script is copied into the temp folder
  with the two files it dot-sources, and the third, Close-Launcher.ps1, is
  replaced by a stub: the real Stop-Game closes any Skyrim on the machine,
  whatever folder it runs from, and nothing here may do that. LOCALAPPDATA
  points into the temp folder for pending notes; the feed and the baseline are
  in a stand-in working folder under -ReleaseDir, so the real ones are never
  read or written. -NoUpload and -NoPush with both files already there, so
  Feed-Store.ps1 receives and sends nothing, and no config.json: it cannot
  reach the VPS or a server. Every case stops before the pack is built.
#>
[CmdletBinding()]
param([string]$PublishPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
# Publish-Update names no box of its own, so the guard reads THORNSWOOD_VPS.
$env:THORNSWOOD_HARNESS = '1'
$env:THORNSWOOD_VPS = 'harness.invalid'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $PublishPath) { $PublishPath = Join-Path $Here 'scripts\release\Publish-Update.ps1' }
$ToolsDir = Split-Path -Parent $PublishPath
. (Join-Path $Here 'tests\fixtures\ui-front.ps1')
. (Join-Path $Here 'tests\fixtures\collection-revision.ps1')
. (Join-Path $Here 'scripts\release\CollectionRevision.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The same PowerShell that runs this, so pwsh tests under pwsh and Windows
# PowerShell under itself.
$Shell = (Get-Process -Id $PID).Path

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-refusals-' + [Guid]::NewGuid().ToString('N'))
$tools = Join-Path $work 'repo\tools'
New-Item -ItemType Directory -Path $tools -Force | Out-Null

function Hash([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return 'absent' }
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}

# One made up install per case, so nothing one case writes reaches the next.
function New-Install([string]$name, [string[]]$record, [int64]$bytes) {
    $root = Join-Path $work $name
    foreach ($d in 'Game\Data\Platform\UI', 'Profile\OwnGame', 'rel', 'dist', 'appdata\Thornswood') {
        New-Item -ItemType Directory -Path (Join-Path $root $d) -Force | Out-Null
    }
    [IO.File]::WriteAllText((Join-Path $root 'rel\version.json'), '{"packs":[],"news":[]}')
    # A baseline, so the run is not stopped for having none, naming one file
    # that is gone so the release has something to remove.
    [IO.File]::WriteAllText((Join-Path $root 'rel\published.json'), '{"Data\\gone.esp":"10:1"}')
    if ($null -ne $record) {
        [IO.File]::WriteAllLines((Join-Path $root 'Profile\OwnGame\files.txt'), $record)
    }
    # One file of ours, the size the case asks for. Under Data\Platform\UI, since
    # outside it only what Ship-Rules names is ours (#1178), and under UI only
    # index.html, build.js, thornswood-* and hashed assets build.js names (#1318).
    $fs = [IO.File]::Create((Join-Path $root 'Game\Data\Platform\UI\thornswood-ours.bsa'))
    try { $fs.SetLength($bytes) } finally { $fs.Dispose() }
    Install-UiFrontFixture (Join-Path $root 'Game')
    return $root
}

function Invoke-Publish([string]$root, [string[]]$extra) {
    $before = @{
        feed     = Hash (Join-Path $root 'rel\version.json')
        baseline = Hash (Join-Path $root 'rel\published.json')
    }
    $oldAppData = $env:LOCALAPPDATA
    $oldRoaming = $env:APPDATA
    $oldEap = $ErrorActionPreference
    $env:LOCALAPPDATA = Join-Path $root 'appdata'
    # The harness's own Vortex, on the recorded collection revision (#3597).
    $env:APPDATA = $roaming
    # Windows PowerShell turns a child's stderr into a terminating error under
    # Stop, which would end this harness on the first refusal it is testing.
    $ErrorActionPreference = 'Continue'
    try {
        $argv = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                  '-File', (Join-Path $tools '..\scripts\release\Publish-Update.ps1'),
                  '-Root', $root,
                  '-ReleaseDir', (Join-Path $root 'rel'),
                  '-DistRoot', (Join-Path $root 'dist'),
                  '-NoUpload', '-NoPush', '-NoPause') + @($extra)
        $out = (& $Shell @argv 2>&1 | Out-String)
        $code = $LASTEXITCODE
    }
    finally {
        $env:LOCALAPPDATA = $oldAppData
        $env:APPDATA = $oldRoaming
        $ErrorActionPreference = $oldEap
    }
    $zips = @(Get-ChildItem -LiteralPath (Join-Path $root 'dist') -Recurse -Filter *.zip -File -ErrorAction SilentlyContinue)
    return [pscustomobject]@{
        Code      = $code
        Out       = $out
        FeedSame  = ($before.feed -eq (Hash (Join-Path $root 'rel\version.json')))
        BaseSame  = ($before.baseline -eq (Hash (Join-Path $root 'rel\published.json')))
        Zips      = $zips.Count
        StoppedGame = (Test-Path -LiteralPath (Join-Path $root 'stop-game-was-called.txt'))
    }
}

function Unchanged($r) {
    Yes '  version.json is byte for byte what it was' $r.FeedSame
    Yes '  the baseline is byte for byte what it was' $r.BaseSame
    Yes '  and no pack was zipped' ($r.Zips -eq 0)
}

try {
    # ---- the real script, and a Close-Launcher that closes nothing -------------
    # Each where it is in the repository since phase 8 of issue #440.
    $repoRoot = Split-Path -Parent (Split-Path -Parent $ToolsDir)
    # Fresh-Checkout.ps1 too: Publish-Update loads its freshness guard under
    # Stop since #3006, where before a tree without it walked past the guard.
    foreach ($f in 'scripts\release\Publish-Update.ps1', 'scripts\deploy\Fresh-Checkout.ps1', 'scripts\release\Read-JsonFile.ps1', 'scripts\release\RecordShape.ps1', 'scripts\release\RepoPlugins.ps1', 'scripts\release\CollectionRevision.ps1', 'scripts\release\Ship-Rules.ps1', 'scripts\mods\LoadOrder.ps1', 'scripts\release\SevenZip.ps1',
                   'scripts\release\Feed-Store.ps1', 'scripts\release\Feed-Json.ps1', 'scripts\release\Source-Notice.ps1',
                   'scripts\release\Release-Baseline.ps1', 'scripts\release\Release-Name.ps1', 'scripts\release\Dev-News.ps1', 'scripts\deploy\ServerContent.ps1', 'scripts\deploy\LastPluginRecipe.ps1',
                   'scripts\release\Feed-News.ps1', 'scripts\release\Feed-Rules.ps1',
                   # Dot-sourced for the signed manifest (#2163); -NoUpload signs nothing.
                   'scripts\release\Release-Manifest.ps1', 'scripts\release\Sign-ReleaseCatalog.ps1', 'scripts\release\Sign-OnGitHub.ps1', 'scripts\release\ShippedBytes.ps1', 'scripts\release\Assert-PublishSigned.ps1',
                   'installer\licences\GPL-3.0.txt', 'installer\licences\AGPL-3.0.txt',
                   'scripts\release\Where.ps1', 'records\client-build.json', 'records\client-licences.json', 'records\client-licences', 'records\ui-gone.json', 'records\shipped-not-ours.json',
                   'scripts\mods\Generated.ps1', 'records\generated.json',
                   # LoadOrder.ps1 compiles the Vortex state reader from the
                   # launcher's source since #1416, and the publish reads the
                   # collection revision through it (#1878).
                   'launcher\app\VortexProfileState.cs') {
        $from = Join-Path $repoRoot $f
        $to = Join-Path (Split-Path -Parent $tools) $f
        New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
        if (Test-Path -LiteralPath $from) { Copy-Item -LiteralPath $from -Destination $to -Force -Recurse }
    }
    # The collection revision record, and a Vortex on it (#3597).
    $roaming = Join-Path $work 'roaming'
    $null = Install-CollectionRevisionFixture -From $repoRoot -RepoCopy (Split-Path -Parent $tools) -AppData $roaming
    # Publish-Update places game\required-data into the game folder before the
    # scan; without the folder the size-gate cases die before the gate.
    $reqFrom = Join-Path $repoRoot 'game\required-data'
    $reqTo = Join-Path (Split-Path -Parent $tools) 'game\required-data'
    if (Test-Path -LiteralPath $reqFrom) {
        New-Item -ItemType Directory -Path $reqTo -Force | Out-Null
        Copy-Item -Path (Join-Path $reqFrom '*') -Destination $reqTo -Force
    }
    New-Item -ItemType Directory -Path (Join-Path $tools '..\scripts\dev') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $tools '..\scripts\dev\Close-Launcher.ps1'), (
        "function Stop-Game { param([string]`$Root)`r`n" +
        "    [IO.File]::WriteAllText((Join-Path `$Root 'stop-game-was-called.txt'), 'yes')`r`n" +
        "    return `$false`r`n" +
        "}`r`n"))

    $vortex = @('F|V|1024|638000000000000000|Data\collection.esp')
    $big = [int64](2 * 1MB + 1)
    $small = [int64](512KB)

    # ---- no record, no release ------------------------------------------------
    $r = Invoke-Publish (New-Install 'no-record' $null $small) @()
    Yes 'with no files.txt the publisher stops' ($r.Code -eq 1)
    Yes '  and says files.txt is missing' ($r.Out -match 'OwnGame\\files\.txt is missing')
    Yes '  before it touches a running game' (-not $r.StoppedGame)
    Unchanged $r

    # ---- a record that names nothing from Vortex is no record ------------------
    $r = Invoke-Publish (New-Install 'empty-record' @('F|O|4096|638000000000000000|Data\Platform\UI\thornswood-ours.bsa') $small) @()
    Yes 'with a files.txt that names nothing from Vortex the publisher stops' ($r.Code -eq 1)
    Yes '  and says the record lists nothing' ($r.Out -match 'lists nothing')
    Unchanged $r

    # ---- over the cap -----------------------------------------------------------
    #
    # The cap is lowered to 1 MB so the case is 2 MB on disk rather than eleven
    # gigabytes; test-release-size.ps1 holds the gate itself to the incident's
    # own number at the default cap.
    $r = Invoke-Publish (New-Install 'over-cap' $vortex $big) @('-MaxReleaseMB', '1')
    Yes 'a release over -MaxReleaseMB is refused' ($r.Code -eq 1)
    Yes '  by the size gate, which names the cap' ($r.Out -match 'the cap is 1 MB')
    Yes '  and lists what made it big' ($r.Out -match 'thornswood-ours\.bsa')
    Yes '  and says nothing was published' ($r.Out -match 'Nothing was published')
    Yes '  after the record check let it through' ($r.StoppedGame)
    Unchanged $r

    # ---- -AcceptSize, and under the cap -----------------------------------------
    #
    # Both are stopped a step later by the removals gate, -MaxRemovals 0 against
    # the file the baseline names that is gone. That is the point: the run got
    # past the size gate, and it still builds nothing and touches nothing.
    $r = Invoke-Publish (New-Install 'accepted' $vortex $big) @('-MaxReleaseMB', '1', '-AcceptSize', '-MaxRemovals', '0')
    Yes 'with -AcceptSize the same release goes past the size gate' ($r.Out -notmatch 'the cap is' -and $r.Out -match 'would delete')
    Unchanged $r

    $r = Invoke-Publish (New-Install 'under-cap' $vortex $small) @('-MaxReleaseMB', '5', '-MaxRemovals', '0')
    Yes 'a release under the cap goes past the size gate' ($r.Out -notmatch 'the cap is' -and $r.Out -match 'would delete')
    Unchanged $r

    # ---- a machine on another collection revision (#3597) ------------------------
    # Both feeds said revision 2, the one One's Vortex had, while the record and
    # Nexus were on 5, so a launcher on 2 was let in. The same release from a
    # Vortex one revision behind the record stops before anything is packed.
    $recorded = Get-ShipRecordedCollectionRevision -RepoDir (Split-Path -Parent $tools)
    $keepRoaming = $roaming
    $roaming = Join-Path $work 'roaming-behind'
    $null = Install-CollectionRevisionFixture -From $repoRoot -RepoCopy (Split-Path -Parent $tools) -AppData $roaming -Revision ($recorded.Revision - 1)
    $r = Invoke-Publish (New-Install 'behind' $vortex $small) @('-MaxReleaseMB', '5', '-MaxRemovals', '0')
    Yes 'a machine whose Vortex is a revision behind the record stops' ($r.Code -eq 1)
    Yes '  naming both revisions' ($r.Out -match ('collection is on revision ' + $recorded.Revision) -and $r.Out -match ('Vortex is on revision ' + ($recorded.Revision - 1)))
    Yes '  and nothing was built' ($r.Out -match 'Nothing was built')
    Unchanged $r
    $roaming = Join-Path $work 'roaming-none'
    New-Item -ItemType Directory -Force -Path $roaming | Out-Null
    $r = Invoke-Publish (New-Install 'unknown' $vortex $small) @('-MaxReleaseMB', '5', '-MaxRemovals', '0')
    Yes 'a machine whose Vortex cannot say stops too, never naming a guess' ($r.Code -eq 1 -and $r.Out -match 'does not say which collection revision')
    Unchanged $r
    $roaming = $keepRoaming
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
