<#
.SYNOPSIS
  Runs what follows a published tip: the host feed remirror. VirusTotal is no
  longer part of publish; use Publish-VirusTotal.ps1 by hand if you want a
  report.

.DESCRIPTION
  WHAT A TIP IS. The tip customers get is `version.json`, written and pushed by
  Publish-Update.ps1. Launchers poll the feed url in it, which is the site host
  feed (`docs\FEED.md`, and `Get-HostFeedVersionUrl` in `Feed-Rules.ps1`:
  https://thornswood.net/feed/version.json live, /feed-dev for dev). So once the
  publisher has written that file, the site copy still has to be remirrored
  before the tip is the one the world reads.

  THE CALL, EXACTLY AS THE WEBSITE LANE PINNED IT. Path relative to this script,
  which sits in scripts\release beside Ship.ps1:

      & (Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1') -Dev:$Dev

  The remirror is the website lane's (pull request #730). Default is main, to
  /feed; -Dev is the dev channel, to /feed-dev. It has -Check for a dry run,
  -Verify to rehash what is up there, and optional -FeedDir and -AssetDir, and
  nothing here passes those: it works the working copy out from the channel itself.

  VirusTotal is NOT part of publish any more. Code signing covers trust for the
  installer (#390). `Publish-VirusTotal.ps1` and `Add-VirusTotalComment.ps1`
  stay in the repo as optional manual tools, and Ship does not call the
  upload. Passing -Only VirusTotal prints that and exits 0 so an old
  hand-typed line does not fail a release.

  NOTHING HERE FAILS A RELEASE. The tip is on the feed before any of this runs.
  A script that is not on this machine yet is a line naming it. A remirror that
  exits 1 has refused to publish a feed naming bytes the site does not hold,
  which leaves the site one release behind rather than pointing launchers at a
  404, and that is a line too. Both are said in full, with the command that puts
  them right, and the release stays out and stays announced. Asked for by the
  website lane on 27 September: "Exit 1 = refused publish (do not fail the
  release)", the same spirit as Ship's own try/catch around Publish-Discord.

  THERE IS NO THIRD STEP FOR THE LAUNCHER, and that is the launcher lane's
  answer rather than an omission. A launcher polls the feed and updates itself,
  so the remirror IS the launcher update reaching people. Ship's mid-release
  Install-Launcher.ps1 refreshes the install on the machine that shipped
  (C:\Thornswood for main, C:\Thornswood-DevBuild for dev) and nothing else, so
  re-running it after the tip would refresh that one install again.

  IT RUNS ON EVERY RELEASE, DEV AND MAIN. Everything goes to dev first
  (docs/guide/how-work-moves.md, decided 23 September), so the dev channel is where this is
  exercised several times a week rather than once a fortnight. -Only Remirror
  is how Ship names the half; -Only VirusTotal is a soft no-op pointing at the
  manual tool.

  The remirror asks before it acts: it sends only what the site does not
  already hold. So running this again after a bad run does nothing the first run
  already did.

    .\scripts\release\Publish-PostShip.ps1                     after a main release
    .\scripts\release\Publish-PostShip.ps1 -Channel dev        after a dev release
    .\scripts\release\Publish-PostShip.ps1 -Only Remirror      the feed (Ship's form)

.PARAMETER Channel
  main or dev. main remirrors this machine's working copy of the live feed
  to https://thornswood.net/feed/; dev passes -Dev, which takes the dev one to
  https://thornswood.net/feed-dev/ (Feed-Store.ps1, #907).

.PARAMETER Root
  The install the release was built from. Kept for callers that still pass it;
  the remirror works its own working copy out from the channel.

.PARAMETER DistRoot
  Where releases are staged. Kept for callers that still pass it; unused now
  that VirusTotal is off the publish path.

.PARAMETER Only
  Remirror runs the host feed remirror (default, and what Ship passes).
  VirusTotal prints that the upload is optional and manual, then exits 0.
  Both is the same as Remirror.

.PARAMETER NoPause
  Skip the Enter-to-close pause so Ship can call this without hanging.

.NOTES
  Exit codes: 0 when the remirror is done, or is waiting on a script another
  lane has not landed, and 1 when the remirror that is here stopped. Ship reads
  that code to say on its last screen which line to run again, and does not fail
  the release over it: a release that is out on the feed, in #news and on the
  server is out.
#>
[CmdletBinding()]
param(
    [ValidateSet('main', 'dev')][string]$Channel = 'main',
    [string]$Root = (& (Join-Path $PSScriptRoot 'Where.ps1') Install),
    [string]$DistRoot = (& (Join-Path $PSScriptRoot 'Where.ps1') Dist),
    [ValidateSet('Both', 'Remirror', 'VirusTotal')][string]$Only = 'Both',
    [switch]$NoPause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }

$Dev = ($Channel -eq 'dev')
$devArg = if ($Dev) { ' -Dev' } else { '' }
$trouble = New-Object System.Collections.ArrayList

Write-Host ''
if ($Only -eq 'VirusTotal') {
    Write-Host "  AFTER THE TIP, $Channel : VIRUSTOTAL (optional, manual)" -ForegroundColor White
    Head 'VirusTotal'
    Say '  VirusTotal is no longer part of publish. Code signing covers trust (#390).' 'Yellow'
    Say '  For a manual report, run:' 'DarkGray'
    Say '  .\scripts\release\Publish-VirusTotal.ps1 -Path <the installer exe>' 'DarkGray'
    Head 'Done'
    Say "This half of what follows the $Channel tip is done (nothing to upload)." 'Green'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

Write-Host "  AFTER THE TIP, $Channel : THE HOST FEED" -ForegroundColor White

# ------------------------------------------------------------ the host feed
Head 'The host feed'
$remirror = Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1'
if (-not (Test-Path -LiteralPath $remirror)) {
    Say '  scripts\deploy\Remirror-Site-Feed.ps1 is not on this machine, so the site goes on' 'Yellow'
    Say '  serving the feed it had, and anybody reading it is offered that release.' 'Yellow'
    Say '  It is the website lane''s script, from pull request #730. The release is fine.' 'DarkGray'
    [void]$trouble.Add([pscustomobject]@{
        What     = 'The host feed was not remirrored'
        PutRight = ".\scripts\deploy\Remirror-Site-Feed.ps1$devArg"
    })
}
else {
    $where = if ($Dev) { 'https://thornswood.net/feed-dev/' } else { 'https://thornswood.net/feed/' }
    Say "  the $Channel tip to $where" 'DarkGray'
    $global:LASTEXITCODE = 0
    $why = ''
    try { & $remirror -Dev:$Dev }
    catch { $why = $_.Exception.Message }
    if ($why) {
        Say "  the remirror stopped: $why" 'Red'
        [void]$trouble.Add([pscustomobject]@{
            What     = 'The host feed was not remirrored'
            PutRight = ".\scripts\deploy\Remirror-Site-Feed.ps1$devArg"
        })
    }
    elseif ($LASTEXITCODE -ne 0) {
        Say "  the remirror refused to publish the feed (exit $LASTEXITCODE). The lines above say which asset." 'Red'
        Say '  The site is one release behind, which is what launchers were already reading.' 'Yellow'
        [void]$trouble.Add([pscustomobject]@{
            What     = 'The host feed was not remirrored'
            PutRight = ".\scripts\deploy\Remirror-Site-Feed.ps1$devArg   and .\scripts\deploy\Remirror-Site-Feed.ps1$devArg -Check to see what it wants first"
        })
    }
}

Head 'Done'
if (-not $trouble.Count) {
    Say "Everything that follows the $Channel tip is done." 'Green'
}
else {
    Say 'The release is out and stays out. What did not happen after it:' 'Yellow'
    foreach ($t in $trouble) {
        Say ("  $($t.What)") 'Red'
        Say ("    $($t.PutRight)") 'Yellow'
    }
    Say '  Each line above asks before it acts, so running it changes nothing else.' 'DarkGray'
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
if ($trouble.Count) { exit 1 }
exit 0
