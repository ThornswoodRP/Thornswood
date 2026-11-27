<#
  Move-FeedStore-ToVps.ps1

  Moves the release baseline and the launcher history of both channels from
  the Thornswood-Releases clones to the VPS store beside the feed, once, so
  the first Ship after #907 starts from exactly the baseline the last
  clone-based Ship left, and Thornswood-Releases can be deleted.

  WHAT IT DOES, for main (the Thornswood-Releases clone) and dev (the
  Thornswood-Releases-dev worktree):

    1. checks the clone is on its branch, version.json and published.json are
       committed, and nothing is committed that was never pushed, so what it
       copies is what the repository holds
    2. asks the VPS what C:\Thornswood-Docs\feed (feed-dev) holds, and refuses
       unless version.json there is byte for byte the clone's (the last Ship's
       remirror put it there), and published.json there is absent or already
       the clone's
    3. reads every launcherVersion the clone's history of version.json ever
       named (what Ship's dev numbering read out of git) and merges it into
       launchers.txt
    4. sends published.json and launchers.txt through Feed-Store.ps1: .part,
       then renamed, only while version.json and published.json up there are
       still what step 2 saw
    5. reads published.json back from the VPS into a scratch folder and
       compares it with the clone's byte for byte, and checks the sha256 of all
       three against what was sent
    6. saves the whole Thornswood-Releases history as a git bundle beside the
       local store (%LOCALAPPDATA%\Thornswood\feed\thornswood-releases.bundle),
       so deleting the repository loses nothing: git clone <bundle> gets it back

  Run it after the last Ship made with the clone-based scripts, from a
  checkout that has #907. Running it twice sends nothing the first run sent.
  It never writes a clone and never writes version.json anywhere.

      .\scripts\oneoff\Move-FeedStore-ToVps.ps1 -Check   what it would do
      .\scripts\oneoff\Move-FeedStore-ToVps.ps1          both channels

  Needs the VPS ssh key (scripts\vps\Setup-SshKey.ps1 -Test). -SiteDir points
  it at a folder standing in for C:\Thornswood-Docs, and -MainClone/-DevClone
  at scratch clones, which is what tests\test-feed-store.ps1 does.
#>
[CmdletBinding()]
param(
    [ValidateSet('main', 'dev', 'both')][string]$Channel = 'both',
    # The clones. Left out, Thornswood-Releases and Thornswood-Releases-dev
    # beside the shared clone this script's repository belongs to.
    [string]$MainClone,
    [string]$DevClone,
    # Say what it would do and send nothing.
    [switch]$Check,
    # A folder standing in for C:\Thornswood-Docs. For the tests.
    [string]$SiteDir,
    # Where the history bundle goes. Left out, beside the local store.
    [string]$BundleDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\release\Feed-Store.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan }

# The clones sit beside the shared clone, and a worktree's parent is not that,
# so the shared clone is found through git's common directory.
function Get-Beside {
    $repo = Split-Path -Parent (Split-Path -Parent $Here)
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $common = (& git -C $repo rev-parse --path-format=absolute --git-common-dir 2>$null | Out-String).Trim() }
    finally { $ErrorActionPreference = $old }
    if ($common) { return (Split-Path -Parent (Split-Path -Parent $common)) }
    return (Split-Path -Parent $repo)
}
if (-not $MainClone) { $MainClone = Join-Path (Get-Beside) 'Thornswood-Releases' }
if (-not $DevClone) { $DevClone = Join-Path (Get-Beside) 'Thornswood-Releases-dev' }
if (-not $BundleDir) { $BundleDir = Split-Path -Parent (Get-FeedStoreDir 'main') }

function G([string]$dir) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& git -C $dir @args 2>$null); $rc = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Out = $o; Code = $rc }
}

function Bytes-Equal([string]$a, [string]$b) {
    $x = [IO.File]::ReadAllBytes($a); $y = [IO.File]::ReadAllBytes($b)
    if ($x.Length -ne $y.Length) { return $false }
    for ($i = 0; $i -lt $x.Length; $i++) { if ($x[$i] -ne $y[$i]) { return $false } }
    return $true
}

$problems = @()
$work = & (Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'release') 'Get-ScratchDir.ps1') ('thornswood-feed-move-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null

function Move-One([string]$ch, [string]$clone, [string]$branch) {
    $prefix = Get-FeedStorePrefix $ch
    Head "$ch : $clone  ->  $prefix on the VPS"
    foreach ($n in 'version.json', 'published.json') {
        if (-not (Test-Path -LiteralPath (Join-Path $clone $n))) { return "no $n in $clone" }
    }
    $b = G $clone rev-parse --abbrev-ref HEAD
    $on = ($b.Out -join '').Trim()
    if ($b.Code -ne 0) { return "$clone is not a git clone" }
    if ($on -ne $branch) { return "$clone is on '$on', not $branch" }
    $dirty = @((G $clone status --porcelain '--' version.json published.json).Out | Where-Object { $_ })
    if ($dirty.Count) { return ("$clone has uncommitted " + (($dirty | ForEach-Object { $_.Trim() }) -join ', ') + ': a Ship did not finish; finish it with the old scripts first') }
    $ahead = (G $clone rev-list --count "origin/$branch..HEAD").Out -join ''
    if ($ahead.Trim() -and $ahead.Trim() -ne '0') { return "$clone has $($ahead.Trim()) commit(s) that never reached GitHub: a push failed; push them with the old scripts first" }

    $vLocal = Join-Path $clone 'version.json'
    $pLocal = Join-Path $clone 'published.json'
    $vSha = Get-FeedStoreSha $vLocal
    $pSha = Get-FeedStoreSha $pLocal
    Say ("  clone   version.json {0}  published.json {1}" -f $vSha.Substring(0, 12), $pSha.Substring(0, 12)) 'DarkGray'

    # Every launcher version the branch ever published, oldest first.
    $log = ((G $clone log -p --reverse --format= '--' version.json).Out) -join "`n"
    $vers = New-Object System.Collections.ArrayList
    foreach ($m in [regex]::Matches($log, '(?m)^[+-].*?"launcherVersion"\s*:\s*"([0-9.]+)"')) {
        if (-not $vers.Contains($m.Groups[1].Value)) { [void]$vers.Add($m.Groups[1].Value) }
    }
    $cur = [regex]::Match([IO.File]::ReadAllText($vLocal), '"launcherVersion"\s*:\s*"([^"]+)"')
    if ($cur.Success -and -not $vers.Contains($cur.Groups[1].Value)) { [void]$vers.Add($cur.Groups[1].Value) }
    Say ("  {0} launcher version(s) in the clone's history, {1} to {2}" -f $vers.Count, $(if ($vers.Count) { $vers[0] } else { '-' }), $(if ($vers.Count) { $vers[$vers.Count - 1] } else { '-' })) 'DarkGray'

    try { $there = Get-FeedStoreThere $ch @('version.json', 'published.json', 'launchers.txt') -SiteDir $SiteDir }
    catch { return $_.Exception.Message }
    $tv = [string]$there['version.json']; $tp = [string]$there['published.json']
    Say ("  VPS     version.json {0}  published.json {1}" -f $(if ($tv) { $tv.Substring(0, 12) } else { 'absent' }), $(if ($tp) { $tp.Substring(0, 12) } else { 'absent' })) 'DarkGray'
    if ($tv -ne $vSha) {
        return ("the site serves a different $prefix/version.json from the clone's. The baseline belongs to the clone's feed, so nothing was sent. " +
                "Put the clone's feed on the site first: .\scripts\deploy\Remirror-Site-Feed.ps1" + $(if ($ch -eq 'dev') { ' -Dev' } else { '' }) + " -FeedDir `"$clone`"")
    }
    if ($tp -and $tp -ne $pSha) {
        return "the VPS already holds a different $prefix/published.json. A Ship has already run on the new store; nothing was sent, and it must not be overwritten."
    }

    # launchers.txt: what is up there plus what git knew, in that order.
    $had = @()
    if ($there['launchers.txt']) {
        try { $had = @(Get-FeedStoreLaunchers $ch -SiteDir $SiteDir) } catch { return $_.Exception.Message }
    }
    $all = New-Object System.Collections.ArrayList
    foreach ($v in @($had) + @($vers)) { if ($v -and -not $all.Contains($v)) { [void]$all.Add($v) } }
    $stage = Join-Path $work $ch
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Copy-Item -LiteralPath $pLocal -Destination (Join-Path $stage 'published.json') -Force
    [IO.File]::WriteAllText((Join-Path $stage 'launchers.txt'), (($all -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))

    $toSend = @()
    if ($tp -ne $pSha) { $toSend += 'published.json' }
    if ((Get-FeedStoreSha (Join-Path $stage 'launchers.txt')) -ne [string]$there['launchers.txt']) { $toSend += 'launchers.txt' }
    if (-not $toSend.Count) { Say '  already moved: nothing to send' 'Green' }
    elseif ($Check) { Say ('  would send ' + ($toSend -join ' and ')) 'Yellow' }
    else {
        $expect = @{ 'version.json' = $tv; 'published.json' = $tp; 'launchers.txt' = [string]$there['launchers.txt'] }
        try { $r = Send-FeedStore $ch $stage $toSend -SiteDir $SiteDir -Expect $expect }
        catch { return $_.Exception.Message }
        Say ('  sent ' + (@($r.Sent) -join ' and ')) 'Green'
    }
    if ($Check) { return '' }

    # Read back and compare, byte for byte.
    $back = Join-Path $work ($ch + '-back')
    try { [void](Receive-FeedStore $ch $back @('version.json', 'published.json', 'launchers.txt') -SiteDir $SiteDir) }
    catch { return ('could not read the store back: ' + $_.Exception.Message) }
    if (-not (Bytes-Equal (Join-Path $back 'published.json') $pLocal)) { return "$prefix/published.json on the VPS is not byte for byte the clone's" }
    if (-not (Bytes-Equal (Join-Path $back 'version.json') $vLocal)) { return "$prefix/version.json on the VPS is not byte for byte the clone's" }
    $upList = @(Get-Content -LiteralPath (Join-Path $back 'launchers.txt') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $lost = @($vers | Where-Object { $upList -notcontains $_ })
    if ($lost.Count) { return ("launchers.txt on the VPS is missing " + ($lost -join ', ')) }
    Say ("  verified: published.json and version.json byte for byte the clone's, {0} launcher version(s) listed" -f $upList.Count) 'Green'
    return ''
}

try {
    $list = @()
    if ($Channel -in 'main', 'both') { $list += ,@('main', $MainClone, 'main') }
    if ($Channel -in 'dev', 'both') { $list += ,@('dev', $DevClone, 'dev') }
    foreach ($c in $list) {
        $why = Move-One $c[0] $c[1] $c[2]
        if ($why) { Say "  STOP: $why" 'Red'; $problems += ($c[0] + ': ' + $why) }
    }

    Head 'History'
    if (-not (Test-Path -LiteralPath (Join-Path $MainClone '.git'))) {
        Say "  no clone at $MainClone, so no bundle was made" 'Yellow'
    } else {
        $bundle = Join-Path $BundleDir 'thornswood-releases.bundle'
        if ($Check) { Say "  would save every branch of Thornswood-Releases to $bundle" 'Yellow' }
        else {
            New-Item -ItemType Directory -Force -Path $BundleDir | Out-Null
            $r = G $MainClone bundle create $bundle --all
            if ($r.Code -ne 0 -or -not (Test-Path -LiteralPath $bundle)) { $problems += "history: git bundle create failed ($($r.Code))" }
            else {
                $v = G $MainClone bundle verify $bundle
                if ($v.Code -ne 0) { $problems += 'history: the bundle does not verify' }
                else { Say ("  every branch of Thornswood-Releases saved to $bundle ({0:N0} bytes)" -f (Get-Item -LiteralPath $bundle).Length) 'Green' }
            }
        }
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Head 'Done'
if ($problems.Count) {
    foreach ($p in $problems) { Say "  $p" 'Red' }
    Say '  Do not delete Thornswood-Releases until this runs clean.' 'Red'
    exit 1
}
if ($Check) { Say '  Dry run. Nothing was sent.' 'Yellow'; exit 0 }
Say '  The VPS holds both baselines. The next Ship on each channel starts from them.' 'Green'
exit 0
