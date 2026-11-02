<#
.SYNOPSIS
  Publishes the game files and server parts that changed, in a single
  release, to the main build or the dev build.

.DESCRIPTION
  One command. Publishes everything in the game folder that changed, the
  plugin list, the client runtime and the news, in a single release.

  SHIP SENDS NO LAUNCHER (#4825). The launcher goes out only through
  Velopack: .github\workflows\merge-release.yml builds, signs and packs it
  for dev on every merge that changes it, and promote-main.yml puts main's
  package out once Patrick approves it. Ship builds, signs and publishes
  none, and the feed keeps the launcher fields it has (Publish-Update.ps1).
  Ship only reads this repository and writes nothing to it. A main release
  is refused if anything is uncommitted or unpushed, or if a file in a folder
  a release is built from is one git does not know, so what ships and what
  is written down are the same thing.

      git checkout main; git pull
      .\scripts\release\Ship.ps1 "..."

  THE NOTE IS WHAT CUSTOMERS READ, in the launcher's News tab, on the site and
  in #news. It takes several lines and splits them: the first line is the
  title, a line starting with a dash becomes a bullet, and the rest becomes the
  body. A one-line note leaves the body empty and the details as nothing but
  the version and the download size, which is how "Everything from dev" reached
  people on 22 September and told them nothing.

      .\scripts\release\Ship.ps1 "The map marker points at the right door now
      It pointed one building east in four towns, which is why directions from
      other people never matched what you saw.
      - Map markers in Riverwood, Whiterun, Falkreath and Rorikstead
      - Nothing to reinstall, it arrives with the update"

  EVERY OPTION HAS ITS OWN .PARAMETER BELOW, and Get-Help puts each one beside
  what the param block declares, so nobody has to open this file to see them:

      Get-Help .\scripts\release\Ship.ps1 -Full
      Get-Help .\scripts\release\Ship.ps1 -Parameter Channel

  AFTER A SUCCESSFUL TIP the host feed is remirrored, then Discord and the
  server countdown tell people to update. Publish-PostShip.ps1, keyed
  off -Channel, owns the remirror and calls the website lane's script:

      1  the host feed remirror   scripts\deploy\Remirror-Site-Feed.ps1, the
                                  website lane's. It checks every asset the
                                  feed names is on thornswood.net/feed/ (-Dev:
                                  /feed-dev/). Since #907 the publisher has
                                  already sent version.json to the VPS store
                                  there, so this finds it in place.
      2  the #news post and the server's countdown, main only, as they
         always were. The site's News page is not sent any more: the site
         writes it itself from the main feed and the news file on its
         Release (#5187, site/server.js "news from the Release").

  VirusTotal is no longer part of publish (#802). Code signing covers trust
  (#390). Publish-VirusTotal.ps1 stays as an optional manual tool.

  The feed is mirrored before the news steps tell people to update, because
  they send everybody to fetch a release the feed has to be serving.

  A MAIN SHIP ALSO MOVES THE DEV FEED'S DEV MARKS, right after the remirror:
  Refresh-DevNews.ps1 marks DEV only the dev notes main still does not have
  and sets the dev feed's mainVersion, and sends nothing else (Dev-News.ps1).

  NOTHING NEW IS NOT ANNOUNCED. When the publisher released nothing (exit
  code 2) Ship says so and stops: no remirror, no news, no Discord post, no
  server countdown, no tag. A dev Ship with nothing new still brings the dev
  feed's DEV marks up to date with main, and says whether it did.

  LAST, THE TAG (#444). A release goes by one name, the id its packs carry
  (20260928-1630, or 20260928-2324-dev on dev), and the feed records its
  packs, baseline and commit against it (Release-Name.ps1). Once the
  publisher has sent the feed, Ship tags that commit release/main/<id> or
  release/dev/<id> and pushes the tag. Never on a dry run, and a tag that did
  not go on is a line at the end, not a failed release.

  NO SWITCH TURNS THE REMIRROR OFF, asked for by the website and launcher
  lanes on 27 September: the block runs on every release, dev and main, so the
  dev channel exercises it several times a week. A dry run runs none of it,
  because a dry run publishes nothing to follow.

  AND THE REMIRROR CANNOT FAIL A RELEASE. It runs after the release is on the
  feed, so nothing there can unpublish anything. A script another lane has not
  landed is a line naming it. A remirror that exits 1 has refused to publish a
  feed naming bytes the site does not hold, which leaves the site one release
  behind rather than pointing launchers at a 404, and the website lane asked for
  that to be a line as well: "Exit 1 = refused publish (do not fail the
  release)". So Ship says on its last screen what did not happen and what to run,
  and still exits 0.

  This header used to carry a hand-written list of five options, laid out as
  if it were all of them, while the param block declared thirteen. -Channel,
  the one the whole dev workflow runs on, was in the param block and nowhere
  else, and Get-Help printed nothing but the syntax line (entry 260 on the To
  Do List). tests\test-script-index.ps1 now fails the build check when a
  parameter is declared here without a .PARAMETER of its own.

.PARAMETER Notes
  What customers read about this release: the launcher's News tab, the site
  and #news for a main release, the dev launcher's News tab and the dev
  updates channel for a dev release. Mandatory, and the only option taken by
  position, so it can come first without its name. The first line is the
  title, a line starting with a dash becomes a bullet, and the rest becomes
  the body. The server's warning before the restart carries the title only.
  Since 25 September Ship refuses notes without a title of three words or
  more and at least one "- " detail line.

.PARAMETER DryRun
  Builds and works out what would ship, and uploads no pack, publishes no
  feed and tells nobody: no news post, no warning from the server. The git
  checks are skipped, and the feed, the baseline and the version number are
  put back afterwards.

  DryRun is non-destructive for close and prune (issue #494): it does not
  close a running game or launcher, and it does not delete old pack-*.zip
  under -DistRoot. It logs what a real Ship would close or prune. It still
  copies the plugins into the game folder. The pack it makes stays in -DistRoot. The first
  -Channel dev run on a machine makes the dev branch of the releases repo
  and pushes it to GitHub, so a dry run on a machine whose releases repo
  has no dev branch stops rather than make one: run -Channel dev once
  without -DryRun.

.PARAMETER Root
  The Thornswood install whose files are published. Left out, it is the folder this machine builds the channel's
  release from, which Where.ps1 ShipRoot and ShipRootDev answer (#1692): the
  one Setup-ShipMachine.ps1 -Root recorded, or else the first of
  C:\Thornswood and Thornswood on any other fixed drive that has
  Launcher\Thornswood.exe in it, and for a dev release that folder with
  -DevBuild on the end, where the main launcher's Settings page installs the
  dev build. A folder Vortex deploys into is refused either way, before
  anything is built. Then Update-ShipRoot.ps1 makes or brings its game
  folder up to date with Vortex's deployment, with the launcher's own
  OwnGame, and puts the recorded client in it, and the Ship stops there when
  it cannot (#2019).

.PARAMETER DistRoot
  Where releases are staged and zipped, passed straight through to
  Publish-Update so the two agree. Not under -Root:
  that is the folder people play from.

.PARAMETER MoveServer
  Lets a main release change the server address in version.json. Without it,
  a release whose config.json names a different server from the one the feed
  has stops before anything is published, because that address moves
  everybody.

.PARAMETER AcceptSize
  Passed straight to Publish-Update, which refuses a release bigger than its
  cap (-MaxReleaseMB, 3072 by default) and lists the biggest files, because
  the release that nearly went out on 17 September was the whole mod
  collection. Give it only once you have read what made the release that big.

.PARAMETER NoPause
  Exits without waiting for Enter, so Ship can be chained after something
  else without stopping for a keypress nobody is there to give.

.PARAMETER AnnounceMinutes
  How many minutes of warning the server gives everybody in the world before
  putting them back to the launcher to pick up the release.

.PARAMETER NoAnnounce
  Ships quietly. The server is not told and nobody is put out; people pick
  the release up the next time they open the launcher.

.PARAMETER Channel
  main or dev, and main when it is left out.

  main is the build everybody plays on, and ships only what is already on
  GitHub. It refuses a release that is not on main or on a hotfix/ branch,
  that is behind or ahead of the same branch on origin, that has anything
  uncommitted, that has a file in a folder a release is built from that git
  does not know about (the build and Go.ps1 would take it anyway). A hotfix/ branch is the live build plus one fix, cut from the
  commit the live release was built from. Ship refuses
  one that is not on GitHub, and it is Patrick's call like any live release.

  dev publishes to the dev build: the dev feed and the dev server. It may
  ship from any branch, on either machine.

  THERE IS ONE DEV FEED AND THE LAST DEV SHIP WINS. Both machines publish to
  the same one, so a dev Ship replaces whatever the other machine put there.
  Check with the team before taking it. A main Ship resets dev to match main. A
  hotfix does not, because the work on dev was not in it.

  Everything goes to dev first, decided by Patrick on 23 September: "even
  small changes go to the dev build launcher for pretesting". A main Ship is
  for a security fix or for something that leaves the game untestable, and he
  says which.

.PARAMETER AllowStaleCheckout
    Go ahead from a checkout that is not exactly origin/main and clean, with a loud warning (#2118). Without it the script refuses a stale or dirty checkout before it sends anything.

.PARAMETER FromFeed
  Builds the release with no game folder of the collection's (#2754, Patrick's
  A, 20 Oct), so it runs anywhere, the cloud included. New-FeedRoot.ps1
  stages every file the channel's last release carried from the site, by its
  sha256, and this checkout builds over them: the front, Go.ps1's files, the
  plugins and the client. The plugin list and the Vortex profile are the last
  release's, held to the server's load order on the box; a load order or
  collection change ships from One, as a collection Ship.

.EXAMPLE
  .\scripts\release\Ship.ps1 -Channel dev "The map marker points at the right door now"

  Puts this branch on the dev build and the dev server for testing. The last dev
  Ship wins.

.EXAMPLE
  .\scripts\release\Ship.ps1 -DryRun "The map marker points at the right door now"

  Builds and works out what would ship without publishing it. It does not
  close a running game and does not prune old packs. Get-Help
  .\scripts\release\Ship.ps1 -Parameter DryRun lists what a dry run still does.

.EXAMPLE
  .\scripts\release\Ship.ps1 "The map marker points at the right door now"

  A main release, from main, pulled. Only when Patrick has said it goes live.

.NOTES
  A Ship builds no installer (#4824, #4825). The download is Velopack's
  Setup.exe, which .github\workflows\merge-release.yml packs for both
  channels: dev's is Thornswood-Dev-Setup.exe on the build-<date>.<n>
  Release, and main's is Thornswood-Setup.exe on Release main-<tag> once
  that build is approved (#5181). The install is the launcher's own first
  start. Until then a main Ship took -Package to rebuild the old installer
  and refused to go out past one that was behind.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Notes,
    [switch]$DryRun,
    # Left out, Where.ps1 ShipRoot or ShipRootDev, asked below (#1692, #3031).
    [string]$Root
    # Where releases are staged and zipped, passed straight through to
    # Publish-Update so the two agree. Not under
    # $Root: that is the folder people play from.
    ,[string]$DistRoot = (& (Join-Path $PSScriptRoot 'Where.ps1') Dist)
    ,[switch]$MoveServer
    # Passed straight to Publish-Update, which refuses a release bigger than
    # its cap because the one that nearly went out on 17 September was the
    # whole mod collection. Without this here the refusal could only be
    # answered by running the publisher by hand, around everything Ship checks.
    ,[switch]$AcceptSize
    # So this can be chained after something else without stopping to wait for
    # a keypress nobody is there to give.
    ,[switch]$NoPause
    # Once a pack is published, everybody in the world is running files the
    # release has moved past, and the only way they pick it up is to quit to
    # the launcher. So the server is told to warn them and then put them out.
    # Minutes of notice, or -NoAnnounce to ship quietly.
    ,[double]$AnnounceMinutes = 5
    ,[switch]$NoAnnounce
    # main is the build everybody plays on. dev publishes to the dev feed and
    # the dev server. New work goes out on dev first and gets broken there.
    ,[ValidateSet('main', 'dev')][string]$Channel = 'main'
    # A main release with a nude body in the game folder (issue #405).
    # Go ahead from a checkout that is not exactly origin/main and clean (#2118). Loud.
    ,[switch]$AllowStaleCheckout
    # Build the release with no game folder of the collection's (#2754,
    # Patrick's A, 20 Oct): New-FeedRoot.ps1 stages the files the last release
    # carried, by their sha256 on the site, and this checkout builds over them.
    # The collection's checks (the Vortex profile, whether the animation and
    # body files can be built from it) belong to a Ship from One, run when the collection
    # changes; the plugin list is the last release's, held to the server's
    # order on the box. Runs off Windows.
    ,[switch]$FromFeed
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named

# A stale or dirty checkout sends old or unlanded code; refuse it (#2118).
# The branch rule is Test-FreshAnyBranch, the same question Publish-Update
# asks after the build (#2235): a dev release may ship any pushed branch, a
# main release main or a hotfix/ branch, so the two can never disagree halfway.
if (-not $DryRun) {
    . (Join-Path $PSScriptRoot '..\deploy\Fresh-Checkout.ps1')
    $freshRepo = Join-Path $PSScriptRoot '..\..'
    Assert-FreshCheckout -RepoDir $freshRepo -What 'Ship' -AnyBranch:(Test-FreshAnyBranch -RepoDir $freshRepo -Channel $Channel) -AllowStale:$AllowStaleCheckout
}


Set-StrictMode -Version Latest

# What Publish-Discord.ps1 did, read back after it runs. It sets this in the
# global scope; seeded here so strict mode has something to read either way.
$global:ThornswoodDiscordResult = ''
# Set by the git gate when a live release comes from a hotfix/ branch, and
# read again where dev is reset to match main. Seeded for strict mode.
$hotfix = $false
# Which of the three follow-ons did not complete, read back in the Done
# section and by the exit code at the end. Empty on every release that went out
# whole, which is the usual one, so it is seeded here like the two above.
$script:PostShipFailed = @()

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = Split-Path -Parent (Split-Path -Parent $Here)
# What never leaves a machine in a release (Ship-Rules, issue #462).
. (Join-Path $Here 'Ship-Rules.ps1')
# What a file of the repo ships as, and fingerprints as, from any machine (#2903).
. (Join-Path $Here 'ShippedBytes.ps1')
# A release from the feed signs its manifest on GitHub, in the engine fork (#2903).
if ($FromFeed) { . (Join-Path $Here 'Sign-OnGitHub.ps1') }
# The publish sign helpers: whether this machine can sign the release manifest.
. (Join-Path $Here 'Assert-PublishSigned.ps1')
# The feed and its baseline live on the VPS beside the feed the site serves,
# and each channel has a working folder on this machine that Publish-Update
# receives them into and sends them back from (Feed-Store.ps1, #907). Until
# then they were clones of Thornswood-Releases beside this repository.
. (Join-Path $Here 'Feed-Store.ps1')
# The release's one name and its tag (#444).
. (Join-Path $Here 'Release-Name.ps1')
$Dev = ($Channel -eq 'dev')
$ReleaseDir = Get-FeedStoreDir $Channel

# ---- where the release is built from ----------------------------------------
#
# The folder this machine builds the channel's release from, which Where.ps1
# answers for Ship, Check-ShipReady, Setup-ShipMachine and Build-Generated
# alike (#1692): the one Setup-ShipMachine.ps1 -Root recorded, or else the
# launcher install, C:\Thornswood or Thornswood on another fixed drive, and for
# dev that plus -DevBuild, where the main launcher's Settings page installs it
# (DevBuild.cs). -Root still wins.
# From the feed it is the folder New-FeedRoot.ps1 stages (#2754).
if ($FromFeed -and -not $PSBoundParameters.ContainsKey('Root')) { $Root = Get-FeedRootDir $Channel }
if (-not $PSBoundParameters.ContainsKey('Root') -and -not $FromFeed) {
    try { $Root = [string](& (Join-Path $Here 'Where.ps1') $(if ($Dev) { 'ShipRootDev' } else { 'ShipRoot' })) }
    catch { Die ($_.Exception.Message + ' Nothing was built.') }
}

# ------------------------------------------------------------ dev channel
# The dev build has its own feed and baseline on the VPS (feed-dev), and its
# own working folder here. Until #907 it was a git worktree of the dev branch
# of Thornswood-Releases, made on first use.
#
# WHO NAMED THE FOLDER (#2662). A Launcher folder is asked of the install
# rule's folder only, <install>-DevBuild, which Where.ps1 answers when no
# -Root is given and ship-roots.json records no dev folder. There, no
# Launcher folder means the main launcher's dev build was never installed,
# and without this Update-ShipRoot.ps1 would make a whole new root in a folder
# nobody chose. A folder named by -Root or recorded with Setup-ShipMachine.ps1
# is a ship root that Update-ShipRoot.ps1 makes with Game, Profile and
# config.json and no Launcher folder (local\release-main, 16 Oct), and nothing
# in a dev Ship needs that folder: a Ship sends no launcher (#4825). Until 18 Oct every such folder was
# refused, with fixes that were wrong for it. Main asks for none.
# Returns '' or the sentence Ship stops with.
function Get-DevRootRefusal([string]$Root, [bool]$RootGiven, [string]$Recorded) {
    if ($RootGiven -or $Recorded) { return '' }
    if (Test-Path -LiteralPath (Join-Path $Root 'Launcher') -PathType Container) { return '' }
    return "No dev build at $Root. Install it from the main launcher's Settings page (The dev build) first, or record the folder this machine builds dev from: .\scripts\release\Setup-ShipMachine.ps1 -Channel dev -Root <folder>."
}
if ($Dev) {
    $rootGiven = $PSBoundParameters.ContainsKey('Root') -or $FromFeed
    $rootRecorded = ''
    if (-not $rootGiven) {
        try { $rootRecorded = [string](& (Join-Path $Here 'Where.ps1') 'ShipRootNamedDev') }
        catch { Die ($_.Exception.Message + ' Nothing was built.') }
    }
    $devRootWhy = Get-DevRootRefusal $Root $rootGiven $rootRecorded
    if ($devRootWhy) { Die $devRootWhy }
}

# A folder Vortex deploys into is the collection's source, not a release
# folder (#1692, docs\COLLECTION-REVISION-2.md step 8): Vortex writes its own
# record, Data\vortex.deployment.json, into it, and Build-Generated never
# builds there, so on 4 October a Ship from one stopped at the generated
# files, after it had built and installed the launcher there.
# Refused here, before anything is built, whichever way the folder was named.
if (Test-Path -LiteralPath (Join-Path $Root 'Game\Data\vortex.deployment.json')) {
    Die ("$Root is a folder Vortex deploys into (Game\Data\vortex.deployment.json is there), so a release is never built from it. Nothing was built. " +
         "Ship with -Root <the release folder>, or record it once: .\scripts\release\Setup-ShipMachine.ps1 -Channel $Channel -Root <the release folder>.")
}

Write-Host ''
Write-Host '  SHIP' -ForegroundColor White

# What goes in -Notes is what customers read, in three places: the launcher's
# News tab, the site's News page and the #news post in Discord. It has always
# taken several lines and split them, first line the title, a line starting
# with a dash into the details, the rest into the body, and that was in none of
# the help text, so every release went out as one line with an empty body.
#
# On 22 September one read "Everything from dev, the final theme for everybody,
# and one card a person on the sessions page". Patrick, fairly: that does not
# tell people what was actually added. It names where the work came from.
#
# IT REFUSES NOW. Patrick, 25 September, after two dev posts in a row went
# out as "The scroll glows" and "Dev build: ...", beside earlier ones with a
# title and three bullets each: every post must have details and be as good
# as those. A title of at least three words that is not a placeholder, and
# at least one "- " line saying what somebody will notice. Checked before
# anything is built, so nothing is half done when it stops.
$noteLines = @($Notes -split "`r?`n")
$noteTitle = (@($noteLines | Where-Object { $_.Trim() }) + @(''))[0].Trim()
$noteBullets = @($noteLines | Where-Object { $_ -match '^\s*-\s*\S' -and ($_ -replace '^\s*-\s*', '').Trim().Length -ge 12 })
$placeholder = $noteTitle -match '^[\W_]*$' -or $noteTitle -match '^(test|testing|wip|update|updates|fix|fixes|changes|stuff|dev|build|misc)\W*$'
if ($placeholder -or @($noteTitle -split '\s+' | Where-Object { $_ }).Count -lt 3 -or $noteBullets.Count -lt 1) {
    Write-Host ''
    Say '  STOP. These notes are what people read in the launcher, on the site and' 'Red'
    Say '  in Discord, and they need a real title and details. Nothing was built.' 'Red'
    if ($placeholder -or @($noteTitle -split '\s+' | Where-Object { $_ }).Count -lt 3) { Say "  The title '$noteTitle' is too short to say what changed." 'Yellow' }
    if ($noteBullets.Count -lt 1) { Say '  There is no detail line: at least one line starting with "- ".' 'Yellow' }
    Write-Host ''
    Say '  The shape, written from the side of the person playing:' 'DarkGray'
    Say '      .\scripts\release\Ship.ps1 -Channel dev "The scroll''s Continue gives you the full three minutes' 'DarkGray'
    Say '      - Time spent reading the sealed scroll no longer counts against choosing a character.' 'DarkGray'
    Say '      - After you press Continue you get the whole three minutes to pick one."' 'DarkGray'
    exit 1
}

# And what the words may be. Note-Rules.ps1 says why: on 26 and 27 September
# notes went out saying players, naming PR #239, env variables, code names and
# the shipping machine, and one list said "Launcher 1.1.101" twice.
. (Join-Path $PSScriptRoot 'Note-Rules.ps1')
$noteProblems = @(Get-NoteProblems $Notes)
if ($noteProblems.Count) {
    Write-Host ''
    Say '  STOP. These notes are for the people who play, and they say things only' 'Red'
    Say '  we would understand. Nothing was built. Rewrite these:' 'Red'
    foreach ($p in $noteProblems) { Say "    $p" 'Yellow' }
    Write-Host ''
    Say '  Say what somebody will notice in the game or the launcher, in plain words.' 'DarkGray'
    exit 1
}

# And only what is new on this channel (#3320, Note-Repeats.ps1 says why):
# a title or line its feed or its Discord channel has already had stops here.
. (Join-Path $PSScriptRoot 'Note-Repeats.ps1')
$toldChannel = $(if ($Dev) { 'dev' } else { 'main' })
try { $told = Get-ChannelPosts $toldChannel }
catch { Die ("What the $toldChannel channel has already been told could not be read, so these notes cannot be checked for repeats. Nothing was built: " + $_.Exception.Message) }
$repeats = @(Get-NoteRepeats $Notes $told.Posts $told.Newest)
if ($repeats.Count) {
    Write-Host ''
    Say '  STOP. These notes say again what this channel has already been told.' 'Red'
    Say '  Each post says only what is new since the last one. Nothing was built.' 'Red'
    foreach ($r in $repeats) { Say "    $r" 'Yellow' }
    Write-Host ''
    Say '  Write only what this release adds. A gamemode deploy whose Ship follows' 'DarkGray'
    Say '  takes -ShipFollows and posts nothing, so the Ship says it once.' 'DarkGray'
    exit 1
}
Write-Host "  $Notes" -ForegroundColor DarkGray

# The words in the files people read, not only the notes. Note-Rules above
# reads the release notes. Check-Words reads the launcher window,
# and every other page a Ship sends out (issue #1081). A dev Ship may be run
# from any branch, including one whose pull request build never ran or went
# red, so this runs here, before anything is built, and on a dry run too.
# Each hit names its file, its line and its rule. exit in that script ends
# the process it runs in, so it runs in a child: a clean tree comes back
# here and the Ship goes on, and a hit stops the Ship.
$wordsScript = Join-Path $RepoDir 'scripts\dev\Check-Words.ps1'
if (-not (Test-Path -LiteralPath $wordsScript)) {
    Die 'scripts\dev\Check-Words.ps1 is not there, so the words people read cannot be checked. Nothing was built.'
}
$wordsHost = (Get-Process -Id $PID).Path
$global:LASTEXITCODE = 0
$wordsText = [string](& $wordsHost -NoProfile -ExecutionPolicy Bypass -File $wordsScript -Root $RepoDir 2>&1 | Out-String)
$wordsCode = $LASTEXITCODE
if ($wordsText.Trim()) { Write-Host $wordsText.TrimEnd() }
$hitLines = @($wordsText -split "`r?`n" | Where-Object { $_ -match '::error ' } | ForEach-Object { $_.Trim() })
if ($wordsCode -ne 0 -or $hitLines.Count -gt 0) {
    $named = if ($hitLines.Count) { $hitLines -join ' | ' } else { 'Check-Words.ps1 exited ' + $wordsCode + ' and named no hit' }
    Die ('The writing rules do not hold. Nothing was built. ' + $named)
}

# ------------------------------------------------------------ git

# Two people ship from two machines. A main release is what everybody gets,
# so it comes off main, with nothing uncommitted and nothing unpulled: the
# other machine's last push has to be in this build or the release loses it.
# A dev release is for trying things, so it may come off any branch, and the
# feed says which. Skipped with -DryRun and when this is not a git clone.
if (-not $DryRun -and (Test-Path (Join-Path $RepoDir '.git'))) {
    Head 'Git'
    # git talks on stderr even when all is well, which Stop turns into a halt.
    $oldEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $branch = (& git -C $RepoDir rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
    $dirty = @(& git -C $RepoDir status --porcelain --untracked-files=no 2>$null | Where-Object { $_ })
    # And the files git has never been told about, which the line above
    # leaves out, in every folder a release is built from: the site's art goes
    # into the menu, and game, launcher and installer hold the plugins, the
    # launcher source and the installer. Ignored ones are not counted (the
    # webhooks, records\signing\signing.json, __pycache__, a log), because
    # counting them would stop every main release. tools\ went on 29 September
    # (issue #440, phase 10).
    $moreRoots = @(@('scripts', 'records', 'site', 'game', 'launcher', 'installer') | Where-Object { Test-Path -LiteralPath (Join-Path $RepoDir $_) })
    $loose = @(& git -C $RepoDir ls-files --others --exclude-standard -- @moreRoots 2>$null | Where-Object { $_ })
    & git -C $RepoDir fetch --quiet origin 2>$null | Out-Null
    $behind = 0
    $ahead = 0
    try { $behind = [int]((& git -C $RepoDir rev-list --count "HEAD..origin/$branch" 2>$null | Out-String).Trim()) } catch { $behind = 0 }
    try { $ahead  = [int]((& git -C $RepoDir rev-list --count "origin/$branch..HEAD" 2>$null | Out-String).Trim()) } catch { $ahead = 0 }
    $ErrorActionPreference = $oldEap
    Say ("  branch {0}, {1} uncommitted change(s), {2} behind and {3} ahead of origin/{0}" -f $branch, $dirty.Count, $behind, $ahead) 'DarkGray'
    if (-not $Dev) {
        # A HOTFIX is the one live release that does not come off main.
        # Patrick, 24 September, with a tester on the main build who could not
        # get in and a day of dev work sitting on main: "the only thing that
        # should be going to main now is the fix for him". A branch named
        # hotfix/... starts from the commit the live release was built from and
        # carries only the fix and its version bump; 1.1.93 went out that way.
        # Every other check below still applies to it: nothing uncommitted,
        # nothing unknown in a folder a release is built from, nothing that is
        # not on GitHub.
        $hotfix = $branch -like 'hotfix/*'
        if ($branch -ne 'main' -and -not $hotfix) { Die "A main release ships from main. This is $branch. Merge it into main first, or use -Channel dev to try it on the dev server." }
        if ($hotfix) {
            # The counts above come out 0 and 0 when origin has no such branch,
            # because git refuses the range and prints nothing. For main that
            # cannot happen; for a hotfix it would let a branch that exists on
            # one disk only go out to everyone. Found by the verification of
            # hotfix 1.1.93.
            & git -C $RepoDir rev-parse --verify --quiet "refs/remotes/origin/$branch" *> $null
            if ($LASTEXITCODE -ne 0) { Die "$branch is not on GitHub. A release ships only what is already there: git push -u origin $branch, then Ship." }
            Say "  a hotfix: a live release from $branch, which is the live build plus its fix and nothing else from main" 'Yellow'
        }
        if ($behind -gt 0) { Die "$branch is $behind commit(s) behind origin/$branch. Run git pull first, so the other machine's work is in this release." }

        # A MAIN RELEASE NOW SHIPS ONLY WHAT IS ALREADY ON GITHUB, and these
        # three refusals are the whole of that rule.
        #
        # Ship used to build from the working tree and then commit and push it
        # afterwards, so a release could go out carrying code that existed on
        # one disk. That worked because Ship could write to main. It cannot any
        # more, by design, so anything not already pushed would simply be lost:
        # the release reaches every launcher and the source never lands.
        #
        # So: nothing uncommitted, nothing unpushed, and then what shipped and
        # what is written down are the same thing by construction rather than
        # by a step at the end that might fail.
        if ($dirty.Count) {
            foreach ($d in $dirty | Select-Object -First 10) { Say "    $d" 'Yellow' }
            Die ("There are $($dirty.Count) uncommitted change(s). A release ships what is on GitHub, and " +
                 "Ship no longer commits anything itself, so these would not travel. Put them on a branch " +
                 "and through a pull request, or put them back, then Ship.")
        }
        # The uncommitted count above never saw a NEW file, and a new file
        # ships all the same: Go.ps1 copies every game\plugins\*.js into
        # the game folder and the build compiles every launcher\app\*.cs, whether
        # git knows them or not. So a scratch plugin would pass this gate and go
        # out in the pack while GitHub had never seen it, which is where the
        # entry's worry, "a scratch file with something private in it lands
        # next", had moved to once Ship stopped committing. Found in the
        # review of entry 205 on 24 Sep.
        #
        # One ignored file does ship and is not counted: local\thornswood-
        # front.zip, which Go.ps1 unpacks into Data\Platform\UI. local\ keeps it
        # out of git and it has never been committed. Whether it should be is
        # not a question this gate can settle.
        if ($loose.Count) {
            foreach ($d in $loose | Select-Object -First 10) { Say "    $d" 'Yellow' }
            Die ("There are $($loose.Count) file(s) in a folder a release is built from that git does not know about. The build " +
                 "and Go.ps1 take them anyway, so they would go out in this release without being on GitHub. " +
                 "Put them through a pull request, delete them, or add them to .gitignore, then Ship.")
        }
        if ($ahead -gt 0) {
            # Not "git push": main takes commits only through a pull request.
            # GitHub refuses the push from write access, and the admin account
            # keeps the same rule by hand, so that advice was always wrong.
            Die ("$branch is $ahead commit(s) ahead of origin/$branch. A release has to be buildable from what " +
                 "everybody else can see, and main takes commits only through a pull request: move them to " +
                 "a branch, push that, merge its pull request, git pull, then Ship.")
        }
    } elseif ($behind -gt 0) {
        Say "  this branch is $behind commit(s) behind origin; the dev build will not carry them" 'Yellow'
    }
}

# ------------------------------------------------------------ the ship root
# Issue #2019. The folder this release is built from is a launcher install
# whose launcher is never started (Patrick, 15 Oct: his own installs stay
# apart from the build folders), so nothing else brings its game folder up to
# date. On 15 Oct One's dev root was still the folder made on 3 Oct, at old
# rules, from another install's game folder, with the old 3BBB.esp and the
# 12 Oct client, and two dev Ships refused on it. Update-ShipRoot.ps1 makes
# or refreshes it with the launcher's own OwnGame, built from this checkout,
# holds it to Vortex's deployment and the current rules, and puts the
# recorded client in it from the configured engine build. A dry run too: it
# changes nothing outside the root. Before the version moves and before
# anything is built, so a refusal here leaves nothing to put back.
Head 'The ship root'
if ($FromFeed) {
    # The last release's files from the site instead (#2754): New-FeedRoot.ps1
    # puts every one in by its sha256 and takes out anything else.
    try { & (Join-Path $Here 'New-FeedRoot.ps1') -Channel $Channel -Root $Root }
    catch { Die ('The last release could not be staged from the site, so nothing was built or published: ' + $_.Exception.Message) }
} else {
    $global:LASTEXITCODE = 0
    & (Join-Path $Here 'Update-ShipRoot.ps1') -Channel $Channel -Root $Root -NoPause
    if ($LASTEXITCODE -ne 0) {
        Die ('The folder this release is built from, ' + $Root + ', is not current: Update-ShipRoot.ps1 says why above. Nothing was built or published.')
    }
}

# ------------------------------------------------------------ collection revision
# The feed names records\collection-plugins.json's revision (#3597), and the
# launcher holds Play for any install that is not on it. So what this release
# is built from has to be on it too: this machine's Vortex, which the plugin
# list, its order and the bodies are read from, or from the feed the last
# release, whose plugin list goes forward. Publish-Update asks again before it
# writes the number; asking here stops the Ship before the version moves.
Head 'Collection revision'
$revMoveFrom = 0
if ($FromFeed) {
    $revFeed = $null
    try { $revFeed = Read-SiteFeed $Channel } catch { Die ('The ' + $Channel + ' feed could not be read, so which collection revision its last release carries is not known. Nothing was built or published: ' + $_.Exception.Message) }
    $revBuilt = 0
    if ($null -ne $revFeed -and $revFeed.PSObject.Properties['collectionRevision']) { [void][int]::TryParse([string]$revFeed.collectionRevision, [ref]$revBuilt) }
    # A RELEASE FROM THE FEED MOVES THE REVISION UP TO THE RECORDED ONE
    # (#4069), with the servers' order, game\data\last-plugin.json's, as its
    # plugin list (Get-ShipFeedMoveRevision, CollectionRevision.ps1). The
    # publish holds that list to the order the channel's server loads, and
    # SkyUI's check below reads the revision's own files from the box's store.
    $revMove = Get-ShipFeedMoveRevision -RepoDir $RepoDir -Built $revBuilt
    if ($revMove) {
        $revMoveFrom = $revBuilt
        $revBuilt = $revMove
        Say ("  the {0} feed's last release is on revision {1}; this release moves it to {2}, with game\data\last-plugin.json's order as its plugin list" -f $Channel, $revMoveFrom, $revMove) 'Yellow'
    }
    $revWhy = Get-ShipCollectionRevisionProblem -RepoDir $RepoDir -Built $revBuilt -Source "the $Channel feed's last release" -Remedy 'A release from the feed moves the revision only up to the recorded one, and only from a checkout with game\data\last-plugin.recipe and last-plugin.json. Nothing was built or published.'
} else {
    try { $revRead = & { . (Join-Path $Here '..\mods\LoadOrder.ps1'); [pscustomobject]@{ Built = (Get-ShipCollectionRevision $Root); Slug = (Get-CollectionSlug (Get-ShipCollectionUrl $Root)) } } }
    catch { Die ($_.Exception.Message + ' Nothing was built or published.') }
    $revBuilt = [int]$revRead.Built
    $revWhy = Get-ShipCollectionRevisionProblem -RepoDir $RepoDir -Built $revBuilt -Slug $revRead.Slug -Source "this machine's Vortex" -Remedy 'Update the collection in Vortex''s Thornswood profile to the recorded revision, let it deploy, close Vortex, then Ship again. Nothing was built or published.'
}
if ($revWhy) { Die $revWhy }
# And the record has to be the newest revision published on Nexus, so no
# release is built on an old one (#4068).
$newestWhy = Get-ShipNewestRevisionProblem -RepoDir $RepoDir
if ($newestWhy) { Die $newestWhy }
Say ("  collection revision {0}, the one records\collection-plugins.json names and the newest on Nexus" -f $revBuilt) 'Green'

# ------------------------------------------------------------ animation and body files
# The behavior files (Pandora) and the covered bodies (BodySlide) are built on
# each computer by the launcher, before Play, from the collection installed
# there, and no release carries them (#3715, Ship-Rules Test-ShipGenerated).
# A release tells every launcher which collection revision to match, by the
# one installed here, so this asks whether that collection can build them:
# Pandora and every patch records\generated.json names are deployed, and every
# slider set is there and keeps to the body rules (#1004, #405). A dry run of
# the build, which writes nothing and starts no tool. Both channels stop:
# every launcher would refuse Play on a collection that cannot build them.
# Before anything else is put in place (#1692): on 4 October a dev Ship built
# and installed the launcher, closing the running one, and only then stopped
# at the generated files.
$GameDir = Join-Path $Root 'Game'
if (-not $FromFeed -and -not (Test-Path -LiteralPath (Join-Path $GameDir 'SkyrimSE.exe'))) { $GameDir = '' }
Head 'Animation and body files'
if ($FromFeed -and $revMoveFrom) {
    # The collection moves, and its animation and body tools need the game
    # itself, which is on no machine a release runs from (#4069). Every
    # launcher builds them before Play and refuses Play when it cannot, and
    # main moves only once dev has carried the revision.
    if ($Channel -eq 'main') {
        $carriedRev = 0
        try { $feedOfDev = Read-SiteFeed 'dev'; if ($null -ne $feedOfDev -and $feedOfDev.PSObject.Properties['collectionRevision']) { [void][int]::TryParse([string]$feedOfDev.collectionRevision, [ref]$carriedRev) } }
        catch { Die ('The dev feed could not be read, so whether dev has carried revision ' + $revBuilt + ' is not known. Nothing was built or published: ' + $_.Exception.Message) }
        if ($carriedRev -ne $revBuilt) {
            Die ('This release moves main to collection revision ' + $revBuilt + ', and the dev feed is on revision ' + $carriedRev + '. Whether the revision builds the animation and body files is asked on dev first, by every launcher before Play: Ship dev on it, then main. Nothing was built or published.')
        }
        Say ('  the dev feed already carries revision ' + $revBuilt + ', so dev''s launchers have built them on it') 'Green'
    } else {
        Say ('  revision ' + $revBuilt + ' is new here: every launcher builds them before Play and refuses Play when it cannot, which dev asks before main') 'Yellow'
    }
} elseif ($FromFeed) {
    # The collection is the last release's, unchanged; a Ship from One asks
    # this when the collection changes (#2754).
    Say '  the collection is the last release''s; a Ship from One asks whether it builds them when the collection changes' 'DarkGray'
} elseif ($GameDir) {
    $global:LASTEXITCODE = 0
    & (Join-Path $Here '..\mods\Build-Generated.ps1') -Root $Root -DryRun -NoPause
    $genExit = $LASTEXITCODE
    if ($genExit -ne 0) {
        Die ("The collection installed here cannot build Thornswood's animation and body files (Build-Generated.ps1 -DryRun exit $genExit, the STOP above says why), " +
             'and every launcher on this release would refuse Play. Put it right in Vortex, bring the folder up to date, and Ship again. Nothing was built or published.')
    }
    Say '  the collection installed here builds them; every launcher builds them before Play' 'Green'
} else {
    Say '  no own game folder here, so whether the collection builds them was not asked' 'DarkGray'
}

# ------------------------------------------------------------ node
# The SkyUI menus step below reads the game folder with node (#960). Without
# node it used to say so in yellow and ship unread, so a machine with no node
# published without the one check that keeps the SkyUI error box off every
# login (#1913). A game folder means that check has something to read, so no
# node stops the release here, before Go.ps1 copies anything or anything is
# published.
if ($GameDir -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
    Die ('node is not on this machine, and Ship reads SkyUI''s menus in the game folder with it (scripts\mods\Check-SkyUIMenus.js), ' +
         'so a release never gives everybody the SkyUI error box on the way in. Install it with ' +
         'winget install --id OpenJS.NodeJS.LTS -e (docs/guide/set-up-a-machine.md, "Install the tools"), open a new window, and Ship again. ' +
         'Nothing was built or published.')
}

# ------------------------------------------------------- the in game plugins
# The plugins are source in this repo and files in the game folder, and Go.ps1
# is the only thing that moves one to the other. Ship never did it, so a release
# carried whichever copy happened to be sitting in the folder. On 17 Sep that
# published a dev build with day old plugins from a machine where the source had
# changed and nobody had run Go, and the publisher could not see it: to the
# publisher the file simply had not changed.
#
# So it happens here, before anything is scanned, into the same folder the
# client patch and the publisher use. SkipServer because this is a build step
# and has no business talking to the VPS. $GameDir is the game folder the
# animation and body files were asked of, above, or '' when there is none.

# ------------------------------------------------------------ the front
# The front Go.ps1 unpacks is built here from the pinned fork commit and held
# to records\front-build.json (#2754, Build-Front.ps1), never a zip left in
# local\ by an earlier build: the one One kept still carried four fonts the
# fork had taken out a month before (#1317). Before Go.ps1, which refuses a
# zip that is not the recorded build.
Head 'The front'
try { & (Join-Path $Here 'Build-Front.ps1') }
catch {
    Die ('The front could not be built from the pinned fork commit: ' + $_.Exception.Message)
}

Head 'The in game plugins'
$goArgs = @{ SkipServer = $true }
if ($GameDir) { $goArgs['Game'] = $GameDir } else { $goArgs['Vortex'] = $true }
# Write-Host does not go down the pipeline, so Out-Null does not quiet it.
# 6 is the information stream Write-Host actually uses. Nothing is lost:
# Go.ps1 reports in colour, and the check below is
# what decides whether this step passed.
& (Join-Path $Here 'Go.ps1') @goArgs 6>$null | Out-Null
# Except for one thing: a file this repository tracks that Go.ps1 could not
# find, which is a path gone wrong and exits 1 (issue #440, phase 0).
if ($LASTEXITCODE -ne 0) {
    Die 'Go.ps1 could not find files this repository has. Run .\scripts\release\Go.ps1 -SkipServer to see which. Nothing was published.'
}

# Other trouble Go.ps1 reports in yellow and still exits 0 on, so the files are checked
# rather than the exit code. This is the guard that makes the step worth having:
# a plugin that did not land stops the release instead of shipping stale.
if ($GameDir) {
    $plugSrc = Join-Path $Here '..\..\game\plugins'
    $plugDst = Join-Path $GameDir 'Data\Platform\Plugins'
    $stale = @()
    $seen  = 0
    foreach ($f in @(Get-ChildItem -LiteralPath $plugSrc -Filter '*.js' -File -EA SilentlyContinue)) {
        $seen++
        $dst = Join-Path $plugDst $f.Name
        if (-not (Test-Path -LiteralPath $dst)) { $stale += ($f.Name + ' never arrived'); continue }
        # The source as it ships (ShippedBytes.ps1), which is how Go.ps1 puts it in.
        $a = Get-ThornswoodShippedSha256 $f.FullName
        $b = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($a -ne $b) { $stale += ($f.Name + ' in the game folder is not this source') }
    }
    if ($stale.Count) {
        foreach ($line in $stale) { Say "  $line" 'Red' }
        Die 'The plugins in the game folder are not the ones in this repo. Nothing was published.'
    }
    if ($seen -eq 0) {
        Die 'game\plugins has no .js in it. Nothing was published.'
    }
    Say "  $seen plugin(s) in the game folder match this source" 'Green'
} else {
    Say '  installed into the Steam copy; no own game folder to check them against' 'Yellow'
}

# ------------------------------------------------------- load order copies (#477 / #557)
# Require the named Thornswood Vortex profile. When Profile\OwnGame has a baked
# copy it must match. Differing copies stop Ship naming which lists diverge.
Head 'The load order copies'
. (Join-Path $Here '..\mods\LoadOrder.ps1')
$profileDir = Join-Path $Root 'Profile'
if ($FromFeed) {
    # No Vortex here: the plugin list is the last release's, which the publish
    # holds to the server's order on the box (#2754), or when the release
    # moves the revision, the servers' order (#4069).
    if ($revMoveFrom) { Say ("  revision {0}'s plugin list, game\data\last-plugin.json's order, held to the server's order when it is published" -f $revBuilt) 'DarkGray' }
    else { Say '  the last release''s plugin list, held to the server''s order when it is published' 'DarkGray' }
} else {
    try {
        $twProfile = Assert-VortexProfile 'Thornswood'
    } catch {
        Die $_.Exception.Message
    }
    $copies = @{
        'Vortex Thornswood\plugins.txt' = (Join-Path $twProfile 'plugins.txt')
    }
    $ownPlugins = Join-Path $profileDir 'OwnGame\plugins.txt'
    if (Test-Path -LiteralPath $ownPlugins) {
        $copies['Profile\OwnGame\plugins.txt'] = $ownPlugins
    }
    $loCopies = @{}
    foreach ($k in @($copies.Keys)) {
        $pluginsPath = $copies[$k]
        $loPath = Join-Path (Split-Path -Parent $pluginsPath) 'loadorder.txt'
        if (Test-Path -LiteralPath $loPath) {
            $loCopies[($k -replace 'plugins\.txt$', 'loadorder.txt')] = $loPath
        }
    }
    $diffs = @(Get-LoadOrderCopyDiffs $copies)
    $diffs += @(Get-LoadOrderCopyDiffs $loCopies)
    if ($diffs.Count -gt 0) {
        foreach ($line in $diffs) { Say "  $line" 'Red' }
        Die ("Load order copies that must match diverge:`n  " + ($diffs -join "`n  ") + "`nBake OwnGame from the Thornswood Vortex profile (launcher Settings, Maintenance, bring the folder up to date), or fix the lists, then Ship again.")
    }
    Say ("  Thornswood profile at $twProfile; load order copies agree") 'Green'
}

# ------------------------------------------------------------ client build
# The client runtime is built from the fork and recorded in client-build.json.
# Until 20 September the copy in the game folder was whatever another server's
# launcher had last written into the Steam copy, patched by text; now a release
# refuses to go out unless the six recorded files are the recorded build, byte
# for byte, in the folder this release packs. Sync-Client.ps1 -Check answers
# that without copying anything: 0 all in place, 2 something differs, 1 the
# build itself is not the recorded one or the record is missing.
Head 'Client build'
# global:, never a bare assignment. Run from a prompt, as Ship always is, a
# bare $LASTEXITCODE = 0 makes a copy that belongs to this script alone, while
# a child script's exit lands in the global one. On 19 Sep a refused check was
# read as this script's own 0 and a dev release went out over it.
$global:LASTEXITCODE = 0
$syncArgs = @{ Check = $true; NoPause = $true }
if ($GameDir) { $syncArgs['Game'] = $GameDir }
& (Join-Path $Here 'Sync-Client.ps1') @syncArgs
if ($LASTEXITCODE -eq 2) {
    Die 'The game folder does not hold the recorded client. Run .\scripts\release\Sync-Client.ps1, then Ship again.'
}
if ($LASTEXITCODE -ne 0) {
    Die 'Sync-Client.ps1 refused, and says why above. The client that matches the record is CI''s build of the pin: .\scripts\release\Setup-ShipMachine.ps1 -EngineBuild ci, then Ship again (engine\README.md, A Ship machine takes CI''s build).'
}

# ------------------------------------------------------------ SkyUI's menus
# Issue #960, 28 Sep: dev showed "SKYUI ERROR CODE 6", menu file version
# mismatch, required 5.2 SE, detected 6.11 SE. SkyUI's script and its menus
# came from different releases: SkyUI 5.2's loose scripts, which dev packs
# carried, over the collection's newer SkyUI. Check-SkyUIMenus.js reads the
# script and the menus the way the game picks them (loose over archive, later
# plugin's archive over earlier): 0 they agree, 2 they do not, 1 unreadable.
# Paths every pack deletes are read as gone, since every install loses them
# with this release. It refuses both channels: the box is on every login.
# node is on the machine by now: Ship stopped before the build without it
# (#1913).
Head 'SkyUI menus'
if ($FromFeed -and $revMoveFrom) {
    # A RELEASE THAT MOVES THE REVISION FROM THE FEED (#4069) changes the
    # archives the check reads, so the last release's answer does not carry
    # over: the check runs here, on the revision's own files. The box's store
    # of the recorded revision (scripts\deploy\CollectionStore.ps1, fetched
    # from Nexus when it is not whole) holds SkyUI's script, the loose menus
    # and the archives that hold either, each the layout's bytes. Ours go over
    # them, as every launcher puts them over the collection, and the order is
    # the plugin list this release carries.
    $skyuiStore = $null
    try {
        $skyuiStore = & {
            . (Join-Path $RepoDir 'scripts\deploy\CollectionStore.ps1')
            $repoFull = (Get-Item -LiteralPath $RepoDir).FullName
            Get-ThornswoodCollectionStore -RecordPath (Join-Path $repoFull 'records\collection-plugins.json') -Fetch { param($w, $h) Invoke-ThornswoodCollectionFetch -Work $w -Head $h -Repo $repoFull }.GetNewClosure() -Say { param($m) Write-Host $m -ForegroundColor DarkGray }
        }
    } catch {
        Die ("SkyUI's menu check reads revision $revBuilt's own files, and the box could not hold them: " + $_.Exception.Message + ' Nothing was published.')
    }
    $skyuiWork = & (Join-Path $Here 'Get-ScratchDir.ps1') 'Thornswood-skyui-move'
    if (Test-Path -LiteralPath $skyuiWork) { Remove-Item -LiteralPath $skyuiWork -Recurse -Force }
    $skyuiData = Join-Path $skyuiWork 'Data'
    New-Item -ItemType Directory -Force -Path $skyuiData | Out-Null
    $storeData = Join-Path $skyuiStore.Menus 'Data'
    if (Test-Path -LiteralPath $storeData) { Copy-Item -Path (Join-Path $storeData '*') -Destination $skyuiData -Recurse -Force }
    $oursData = Join-Path $GameDir 'Data'
    $oursFull = (Get-Item -LiteralPath $GameDir).FullName.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    foreach ($f in @(Get-ChildItem -LiteralPath $oursData -Recurse -File -Force -ErrorAction SilentlyContinue)) {
        $rel = $f.FullName.Substring($oursFull.Length).Replace([string][IO.Path]::DirectorySeparatorChar, '\')
        if (-not (Test-ShipSkyUIInput $rel)) { continue }
        $to = Join-Path $skyuiWork ($rel.Replace('\', [string][IO.Path]::DirectorySeparatorChar))
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        Copy-Item -LiteralPath $f.FullName -Destination $to -Force
    }
    $skyuiPlugins = Join-Path $skyuiWork 'plugins.txt'
    $skyuiOrder = @((Get-Content -LiteralPath (Join-Path $RepoDir 'game\data\last-plugin.json') -Raw | ConvertFrom-Json).loadOrder | ForEach-Object { "$_".Trim() } | Where-Object { $_ -and $_ -ine $ShipLastPlugin })
    [IO.File]::WriteAllLines($skyuiPlugins, [string[]](@($skyuiOrder + $ShipLastPlugin) | ForEach-Object { '*' + $_ }))
    $global:LASTEXITCODE = 0
    & node (Join-Path $Here '..\mods\Check-SkyUIMenus.js') --data $skyuiData --plugins $skyuiPlugins --gone (@(Get-ShipDeleteAlways) -join ';') --quiet
    $skyuiExit = $LASTEXITCODE
    if ($skyuiExit -eq 2) {
        Die ("In revision $revBuilt, with our files over it, SkyUI's menus are not the version its script wants, so everybody would get the SkyUI error box on the way in. The lines above say which file wins and where it comes from. Nothing was published.")
    }
    if ($skyuiExit -ne 0) {
        Die ("SkyUI's menus in revision $revBuilt could not all be read (Check-SkyUIMenus.js exit $skyuiExit), so whether everybody gets the SkyUI error box on the way in is not known. The UNREAD and FAIL lines above say which file. Nothing was published.")
    }
    Say ("  revision {0}'s SkyUI, with our files over it, passes: its check read the box's store of the revision" -f $revBuilt) 'Green'
} elseif ($FromFeed) {
    # The collection's archives are not here, so the menus cannot be read
    # against them. What can be said is whether this release changes anything
    # the check reads (Ship-Rules.ps1, Get-ShipSkyUIFeedChange): when it does
    # not, every install reads what it read with the last release, which
    # passed. When it does, the check has to run where the collection is.
    $feedRecordFile = Join-Path $Root 'record\record.json'
    $feedRecord = @{}
    if (Test-Path -LiteralPath $feedRecordFile) {
        $feedRecordJson = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($feedRecordFile)) $feedRecordFile
        foreach ($feedProp in $feedRecordJson.PSObject.Properties) { $feedRecord[$feedProp.Name] = [string]$feedProp.Value }
    }
    if (-not $feedRecord.Count) {
        Die "There is no record of the last release at $feedRecordFile, so what SkyUI's menu check reads cannot be compared with it. New-FeedRoot.ps1 writes it; run the Ship again."
    }
    $skyuiMoved = @(Get-ShipSkyUIFeedChange $GameDir $feedRecord @(Get-ShipDeleteAlways))
    if ($skyuiMoved.Count) {
        Die ("This release changes what SkyUI's menu check reads (" + (($skyuiMoved | Select-Object -First 5) -join ', ') + "), and that check reads the collection's archives, which are on One, not here. Ship this from One. Nothing was published.")
    }
    Say '  no SkyUI script, menu or archive differs from the last release''s, so its check holds' 'Green'
} elseif ($GameDir) {
    $skyuiPlugins = Join-Path (Get-ShipLoadOrderDir $Root $profileDir) 'plugins.txt'
    $global:LASTEXITCODE = 0
    & node (Join-Path $Here '..\mods\Check-SkyUIMenus.js') --data (Join-Path $GameDir 'Data') --plugins $skyuiPlugins --gone (@(Get-ShipDeleteAlways) -join ';') --quiet
    $skyuiExit = $LASTEXITCODE
    if ($skyuiExit -eq 2) {
        Die 'SkyUI''s menus in the game folder are not the version its script wants, so everybody would get the SkyUI error box on the way in. See the lines above for which file wins and where it comes from, fix that, and Ship again.'
    }
    # Anything else, 1 for a menu, a script or a plugins.txt it could not read
    # or node failing, refuses too (#1913). A check that cannot read is not a
    # pass: an unread menu may be the one that does not match, and the box it
    # would bring up is on every login, on both channels.
    if ($skyuiExit -ne 0) {
        Die ("SkyUI's menus could not all be read (Check-SkyUIMenus.js exit $skyuiExit), so whether everybody gets the SkyUI error box on the way in is not known. " +
             'The UNREAD and FAIL lines above say which file. Fix or replace it in the game folder, and Ship again.')
    }
} else {
    Say '  no game folder here, so SkyUI''s menus were not read' 'DarkGray'
}

# ------------------------------------------------------------ publish sign gate
# The release manifest is signed (Publish-Update.ps1, Release-Manifest.ps1), so
# only a machine that can sign it may Ship, dev included. Ship sends no launcher
# (#4825): the launcher goes out signed through Velopack, from
# .github\workflows\merge-release.yml and promote-main.yml, and nothing here
# builds, signs or checks one. Assert-PublishSigned.ps1 is dot-sourced at the
# top, beside Ship-Rules.ps1.
$signCfg = Join-Path $Here '..\..\records\signing\signing.json'
# A release from the feed signs on GitHub, in the engine fork (#2903,
# Patrick's A of 20 Oct), so this machine needs gh rather than a signing
# setup.
$signWhy = if ($FromFeed) { Get-SignOnGitHubRefusal $RepoDir } else { Get-SigningConfigRefusal -ConfigPath $signCfg -RepoRoot $RepoDir }
if ($signWhy) {
    Die $signWhy
}
if ($FromFeed) { Say ("  publish sign gate: the manifest signs on GitHub, in $SignOnGitHubRepo") 'DarkGray' }
else { Say '  publish sign gate: signing.json ready' 'DarkGray' }

# ------------------------------------------------------------ publish
Head 'Publishing'
# A hashtable, not an array. Splatting an array passes everything positionally,
# so '-Notes' binds as a value rather than a parameter name.
$pubArgs = @{ Notes = $Notes; Root = $Root; RepoDir = $RepoDir; ReleaseDir = $ReleaseDir; DistRoot = $DistRoot; NoPause = $true }
if ($MoveServer) { $pubArgs['MoveServer'] = $true }
if ($AcceptSize) { $pubArgs['AcceptSize'] = $true }
if ($Dev) { $pubArgs['Channel'] = 'dev' }
# -AllowStaleCheckout was Ship's alone, so Publish-Update refused what Ship had
# already been told to let through (#2235).
if ($AllowStaleCheckout) { $pubArgs['AllowStaleCheckout'] = $true }
if ($FromFeed) { $pubArgs['FromFeed'] = $true }
# A dry run has to leave nothing behind, and NoUpload plus NoPush is not that.
#
# Those two stop the release LEAVING the machine. They do not stop the
# publisher writing version.json in the release clone or recording the release
# in its baseline, and it does both. So a dry run quietly consumed the next
# real release: the publisher had already written down that this source was
# published, and the Ship that followed correctly reported nothing had changed
# and shipped nothing. That happened twice on 17 Sep before anybody noticed,
# and the second time it looked exactly like a broken release.
#
# The two files are put back afterwards rather than the publisher being taught
# a third flag, because the publisher is the one script that must behave the
# same on a real release whatever else changes here.
$dryKeep = @()
if ($DryRun) {
    # DryRun is non-destructive for close/prune (issue #494): do not Stop-Game
    # and do not delete old pack-*.zip; log what a real Ship would do instead.
    $pubArgs['NoUpload'] = $true
    $pubArgs['NoPush'] = $true
    $pubArgs['NoClose'] = $true
    $pubArgs['KeepPacks'] = 0
    Say '  dry run, nothing will be uploaded or pushed' 'Yellow'
    Say '  dry run: will not close a running game and will not prune old packs' 'Yellow'

    foreach ($f in @(
        (Join-Path $ReleaseDir 'version.json'),
        (Join-Path $ReleaseDir 'published.json')
    )) {
        if (Test-Path -LiteralPath $f) {
            $tmp = [IO.Path]::GetTempFileName()
            Copy-Item -LiteralPath $f -Destination $tmp -Force
            $dryKeep += [pscustomobject]@{ Path = $f; Copy = $tmp }
        } else {
            $dryKeep += [pscustomobject]@{ Path = $f; Copy = '' }
        }
    }
}

# global: for the reason at the client patch step.
$global:LASTEXITCODE = 0
# The id the publisher sets once the feed is on the VPS, and nothing before
# that; the release tag below goes on only then (#444). Cleared first, so a
# run earlier in this same window can never be tagged by this one.
$global:ThornswoodPublishedRelease = ''
# What a dev publish with nothing new did with the dev feed's DEV marks
# (Dev-News.ps1), said in Done below. Cleared for the same reason.
$global:ThornswoodDevMarks = $null
& (Join-Path $Here 'Publish-Update.ps1') @pubArgs
$published = $LASTEXITCODE

if ($DryRun) {
    foreach ($k in $dryKeep) {
        try {
            if ($k.Copy) {
                Copy-Item -LiteralPath $k.Copy -Destination $k.Path -Force
                Remove-Item -LiteralPath $k.Copy -Force -EA SilentlyContinue
            } elseif (Test-Path -LiteralPath $k.Path) {
                # It did not exist before the dry run, so it must not after.
                Remove-Item -LiteralPath $k.Path -Force
            }
        } catch {
            Say ("  could not put " + $k.Path + " back: " + $_.Exception.Message) 'Red'
            Say '  the next release may think it has already gone out. Check it.' 'Red'
        }
    }
    # AND THE VERSION, which is the third file and was missed.
    #
    # The two above were put back because a dry run had twice consumed the next
    # real release. Updater.cs was the same fault with a different face until
    # #4825: the number was written into it before the build and a dry run
    # left it there (21 September: 1.1.67 to 1.1.68, and the real Ship minutes
    # later to 1.1.69). The build takes the number as -p:Version now, so there
    # is no source file to put back.
    Say '  dry run cleaned up: the feed, the baseline and the version are as they were' 'DarkGray'
}

# Ground truth, as well as the exit code.
#
# The publisher stopped dead on a missing baseline, printed STOP in red, and
# this script carried on to tell the Discord and empty the server for a
# release that does not exist. The guard below was already there and did not
# fire. The exit did reach the global $LASTEXITCODE; this script was reading a
# copy of its own, made by a bare $LASTEXITCODE = 0 (see the client patch
# step). The exit code is trustworthy now, and this check stays because a
# written version.json is a better witness than any number.
#
# version.json is the fact. It is the file the whole world reads to find out
# what the current release is, and the publisher writes it last, after every
# upload has landed. If its release record does not name the release the
# publisher says it sent ($global:ThornswoodPublishedRelease, set only once the
# feed is on the VPS, #444), nothing was published, whatever any exit code
# says. Until #4825 the witness was the launcher number a Ship built, which a
# Ship that kept the feed's launcher could not use; until 6 Oct such a Ship had
# no witness here at all, and a publish with nothing new that said 0 went on to
# the Discord and the server.
#
# Only for a publisher that said 0. Exit code 2 is the publisher saying nothing
# was released, and the block for it below says so and tells nobody. Anything
# else is a publisher that stopped, below too.
if (-not $DryRun -and $published -eq 0) {
    # A version.json here that does not read is said as that, not as one that
    # names nothing (#2711: this was a try with an empty catch). Either way
    # nothing here can say the release went out, so nobody is told.
    $landed = ''
    $landedWhy = ''
    $vf = Join-Path $ReleaseDir 'version.json'
    if (Test-Path -LiteralPath $vf) {
        try {
            $vfDoc = Get-Content -LiteralPath $vf -Raw | ConvertFrom-Json
            if ($vfDoc -and $vfDoc.PSObject.Properties['release'] -and $vfDoc.release -and $vfDoc.release.PSObject.Properties['id']) { $landed = [string]$vfDoc.release.id }
        } catch { $landedWhy = $_.Exception.Message }
    }
    $notOut = ''
    if (-not $global:ThornswoodPublishedRelease) { $notOut = 'The publisher named no release it sent to the VPS.' }
    elseif ($landedWhy) {
        $notOut = "$vf does not read ($landedWhy), so nothing says $($global:ThornswoodPublishedRelease) went out."
    }
    elseif ($landed -ne [string]$global:ThornswoodPublishedRelease) {
        $notOut = "version.json still names release $(if ($landed) { $landed } else { 'nothing at all' }), not $($global:ThornswoodPublishedRelease)."
    }
    if ($notOut) {
        Write-Host ''
        Say "NOTHING WAS PUBLISHED. $notOut" 'Red'
        Say 'Read the publisher output above for the reason. The Discord has not' 'Red'
        Say 'been told, the server has not been touched, and nobody has been sent' 'Red'
        Say 'an update that does not exist.' 'Red'
        Write-Host ''
        if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
        exit 1
    }
}

# Anything other than 0 or 2 means the publisher stopped on an error. It used
# to carry on regardless: the site was told, the Discord was posted to, and the
# server counted everybody down and put them back to the launcher to collect an
# update that had never been published. That happened twice in one evening and
# each time the only sign was one red line halfway up the output.
#
# No source file holds the number (#4825), so nothing is put back here: the
# next attempt works out the same number again.
if ($published -ne 0 -and $published -ne 2) {
    Write-Host ''
    Say "The publisher stopped with exit code $published, so NOTHING was published." 'Red'
    Say 'The error is above, in the Publishing section.' 'Red'
    Say 'Nobody has been told and nobody has been moved. Fix it and run this again.' 'Yellow'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 1
}

# Exit code 2 means the publisher found nothing worth a release.
#
# AND NOBODY IS TOLD. Everything after this block announces a release: the
# remirror, the Discord post, the server's countdown and the tag. A run that released nothing has nothing for any of them, so it stops
# here and says what it did and did not do. A dev publish with nothing new
# still brings the dev feed's DEV marks up to date with main (Dev-News.ps1);
# it says how that went in $global:ThornswoodDevMarks, read back here.
if ($published -eq 2) {
    Head 'Done'
    Say 'Nothing was released. The build already matches the last release.' 'Yellow'
    Say ('  No news entry was added, ' + $(if ($Dev) { 'the dev updates channel' } else { '#news' }) +
         ' was not posted to, and no server was told.') 'Yellow'
    $devMarks = $global:ThornswoodDevMarks
    if (-not $Dev) {
        Say "  The dev feed's DEV marks were not touched: main's feed did not move." 'DarkGray'
    } elseif ($DryRun) {
        Say "  Dry run: the dev feed's DEV marks were worked out and not sent." 'DarkGray'
        if ($null -ne $devMarks) { foreach ($l in @($devMarks.Lines)) { Say "    $l" 'DarkGray' } }
    } elseif ($null -ne $devMarks -and $devMarks.Done) {
        Say "  The dev feed's DEV marks were refreshed against main:" 'Green'
        foreach ($l in @($devMarks.Lines)) { Say "    $l" 'DarkGray' }
    } else {
        Say "  The dev feed's DEV marks were NOT refreshed." 'Red'
        if ($null -ne $devMarks) { foreach ($l in @($devMarks.Lines)) { Say "    $l" 'Red' } }
        Say '    .\scripts\release\Refresh-DevNews.ps1   does it on its own' 'Yellow'
    }
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ------------------------------------------------------- after the tip is out
<#
  THE TWO THINGS THAT FOLLOW A TIP, and until now neither was part of shipping.

  The host feed. Since the #649 cutover the tip customers get is version.json,
  and launchers poll the feed url in it, which is thornswood.net/feed, or
  /feed-dev on the dev channel (Config.AfterLoad, Updater.Check, docs\FEED.md).
  Publish-Update.ps1 writes that file and pushes it to the releases repository;
  the copy the site serves is a file on the VPS that somebody had to remirror by
  hand after every release. Until it is remirrored the site answers with the
  release it last held, which is the release people are offered, and where the
  feed names thornswood.net assets the bytes have to be up there too or the
  download answers 404.

  VirusTotal is no longer part of publish. Code signing covers trust for the
  installer (#390). Publish-VirusTotal.ps1 stays as an optional manual tool.

  AND NOTHING FOR THE LAUNCHER: it updates through Velopack (#4825), not
  this feed.

  ONE SCRIPT, KEYED OFF THE CHANNEL, AND IT OWNS THE REMIRROR.
  Publish-PostShip.ps1 calls the website lane's Remirror-Site-Feed.ps1. It finds
  it by name under scripts\ and calls it with the parameters it declares, so
  that lane does not have to rename anything to fit, and a hook that has not
  landed yet is a line rather than a failed release. Ship reads one exit code,
  Website has one command to run by hand, and the remirror asks before it acts,
  so running it again after a failure does nothing the first run already did.

  ORDER, pinned by the website lane: the remirror, then the Discord post and
  the server's countdown. Those tell people to update, and the
  feed has to be serving the release before anybody is sent to fetch it.

  WHAT A FAILURE DOES. The tip is already on the feed by the time this runs, so
  none of it can unpublish anything, and dying here would leave a release out
  with #news, the site and the server never told, the worst half state there
  is. So it reports what happened, the release is announced either way, and the Done section names what did not complete with
  the line that puts it right. Ship still exits 0: the website lane's rule is
  that a refused remirror is a line and not a failed release, and a release that
  is on the feed, in #news and on the server is out.
#>
function Invoke-PostShip([string]$what, [string]$leaf, [hashtable]$withArgs, [string]$putRight) {
    $path = Join-Path $Here $leaf
    if (-not (Test-Path -LiteralPath $path)) {
        Say "  $what did NOT run: $leaf is not beside Ship.ps1." 'Red'
        $script:PostShipFailed += [pscustomobject]@{ What = $what; PutRight = $putRight }
        return
    }
    # global:, never a bare assignment, for the reason at the client build step:
    # run from a prompt, a bare $LASTEXITCODE = 0 makes a copy this script owns
    # while the child's exit lands in the global one.
    $global:LASTEXITCODE = 0
    try { & $path @withArgs }
    catch {
        Say "  $what stopped: $($_.Exception.Message)" 'Red'
        $script:PostShipFailed += [pscustomobject]@{ What = $what; PutRight = $putRight }
        return
    }
    if ($LASTEXITCODE -ne 0) {
        Say "  $what stopped with exit code $LASTEXITCODE. The lines above say why." 'Red'
        $script:PostShipFailed += [pscustomobject]@{ What = $what; PutRight = $putRight }
        return
    }
    Say "  $what done" 'Green'
}

$chan = if ($Dev) { 'dev' } else { 'main' }
$chanArg = if ($Dev) { ' -Channel dev' } else { '' }
# What both calls give it: the same channel, the same install, the same staging
# folder, one half each. The remirror works its own clone out from the channel,
# so nothing here passes it one.
$postArgs = @{ Channel = $chan; Root = $Root; DistRoot = $DistRoot; NoPause = $true }

if (-not $DryRun) {
    Head 'The host feed'
    Invoke-PostShip 'the host feed remirror' 'Publish-PostShip.ps1' ($postArgs + @{ Only = 'Remirror' }) `
        ".\scripts\release\Publish-PostShip.ps1$chanArg -Only Remirror"

    # THE DEV FEED'S DEV MARKS FOLLOW MAIN AT ONCE (Dev-News.ps1). Main's feed
    # is on the VPS by now, so the dev News tab can stop marking DEV what this
    # release just gave everybody. Until 6 Oct the marks moved only on the next
    # dev Ship, so after every main release finished work read as DEV until
    # somebody shipped dev, and on 5 Oct somebody did, only for that.
    # Refresh-DevNews.ps1 sends the dev feed's version.json alone, and only when
    # a mark or mainVersion moved: no dev release, no pack, no post, no server.
    # Like the remirror it cannot fail this release; a refusal is a line in Done
    # with the command that does it again.
    if (-not $Dev) {
        Head "The dev feed's DEV marks"
        Invoke-PostShip "the dev feed's DEV marks" 'Refresh-DevNews.ps1' @{ RepoDir = $RepoDir; NoPause = $true } `
            '.\scripts\release\Refresh-DevNews.ps1'
    }
}

# ------------------------------------------------------------------- news
# Nothing to send the site (#5187). It reads the main feed it serves and that
# feed's news file (its own copy, or the one on the release's GitHub Release),
# and writes its News page itself within a minute of the feed reaching it.
# Publish-News.ps1 sent the page over ssh here, and a Ship stopped before this
# step left the page a release behind.

# ----------------------------------------------------------------- discord
# Publish-Discord.ps1 has said "called by Ship.ps1 at the end of every release"
# since the day it was written, and nothing here ever called it. The webhook
# was set up, the script worked, and #news sat empty through every release.
# It exits quietly on its own if no webhook is configured, so there is nothing
# to guard here.
# A dev release goes to the dev updates channel and nowhere else. Not #news,
# not the website (which reads main's feed only), and not the main
# launcher, which reads main's feed. The dev launcher's News tab gets it from
# the dev feed, as it always did; this is so the people testing it are told
# without anybody having to watch a version number.
if (-not $DryRun) {
    $discordScript = Join-Path $Here '..\ops\Publish-Discord.ps1'
    if (Test-Path -LiteralPath $discordScript) {
        Head 'Telling the Discord'
        try {
            if ($Dev) { & $discordScript -Dev }
            else      { & $discordScript }
        }
        catch {
            Say "  could not post to Discord: $_" 'Red'
            $global:ThornswoodDiscordResult = 'failed'
        }
    } else {
        Say ('  Publish-Discord.ps1 is missing, ' +
             $(if ($Dev) { 'the dev updates channel' } else { '#news' }) +
             ' was not told.') 'Yellow'
    }
}

# --------------------------------------------------------------- announce
if (-not $DryRun -and -not $NoAnnounce) {
    Head 'Telling the server'
    $announce = Join-Path $Here '..\vps\Request-Restart.ps1'
    if (Test-Path -LiteralPath $announce) {
        # THE TITLE ONLY, never the whole note.
        #
        # This is a line on screen in front of somebody mid-sentence with five
        # minutes before they are put back to the launcher. The full note has a
        # body and bullets now, and the 1.1.80 release sent all of it: four
        # bullet points and a paragraph, as an in-game warning. The News tab is
        # where the rest belongs and it is one click away.
        $why = ($Notes -split "`r?`n")[0].Trim()
        if (-not $why) { $why = $Notes }
        try {
            if ($Dev) { & $announce -Minutes $AnnounceMinutes -Mode update -Why $why -Data 'C:/Thornswood-Server-Dev/data' }
            else      { & $announce -Minutes $AnnounceMinutes -Mode update -Why $why }
        } catch {
            Say "  could not announce it: $_" 'Yellow'
            Say '  Ship still worked. Tell people yourself, or run' 'DarkGray'
            Say '  .\scripts\vps\Request-Restart.ps1 when the server is reachable.' 'DarkGray'
        }
    } else {
        Say '  Request-Restart.ps1 is missing, nobody was told.' 'Yellow'
    }
}

# Main and Dev are independent releases. Publishing Main must preserve Dev's
# feed, baseline, release identity and history. Advance Dev with its own Ship.
# The one thing a main Ship changes on the dev feed is which notes are marked
# DEV, and mainVersion, after the remirror above (Refresh-DevNews.ps1).

# SHIP NO LONGER COMMITS OR PUSHES ANYTHING.
#
# It used to `git add -A` here, commit the whole working tree under the release
# message, and push it straight to main. Two things were wrong with that and
# both have their own entry on the list. It swept up whatever happened to be
# sitting in the repo, so a release commit could carry eight unrelated things
# and could not be reverted. And it needed write access to main, which is the
# single reason enforce_admins had to stay off in branch protection: with the
# rules applying to the owner too, that push is refused, the release still
# reaches every launcher, and the source never lands.
#
# Now Ship writes no number into the repository at all (#5179, #4825), the
# Git gate above refuses a release with anything uncommitted or unpushed, and
# by the time anything is published the repository already says exactly what
# shipped. There is nothing left to do here, which is the point.
if (-not $DryRun -and -not $Dev -and (Test-Path (Join-Path $RepoDir '.git'))) {
    Head 'Source'
    Say "  already on GitHub. The gate above refused anything uncommitted or unpushed," 'DarkGray'
    Say "  so what shipped and what is written down are the same thing." 'DarkGray'
}

# ==== thornswood release tag ====
# THE COMMIT THIS RELEASE WAS BUILT FROM GETS A TAG (#444): release/main/<id>
# or release/dev/<id>, the id the feed names the release by (Release-Name.ps1),
# annotated with its packs and baseline, and pushed. Only after the
# publisher has said it sent the feed, never on a dry run, and last, so a slow
# or refused push never holds up the news or the countdown. A tag that did not
# go on is a line in Done with the command that finishes it, like the other
# follow-ons: the release is out either way.
if (-not $DryRun -and $global:ThornswoodPublishedRelease) {
    Head 'The tag'
    $tagged = Add-ReleaseTag $RepoDir (Join-Path $ReleaseDir 'version.json') ([string]$global:ThornswoodPublishedRelease) 'origin' `
        ('https://thornswood.net/' + $(if ($Dev) { 'feed-dev' } else { 'feed' }) + '/version.json')
    if (-not $tagged.Why) {
        Say "  $($tagged.Tag) marks $($tagged.Commit.Substring(0, 12)), and it is on GitHub" 'Green'
    } else {
        Say "  $($tagged.Why)" $(if ($tagged.PutRight) { 'Red' } else { 'Yellow' })
        if ($tagged.PutRight) { $script:PostShipFailed += [pscustomobject]@{ What = 'the release tag'; PutRight = $tagged.PutRight } }
    }
}
# ==== end thornswood release tag ====

# THE DONE ISSUES THIS RELEASE CARRIES ARE CLOSED (#3279). A fix people would
# notice stays open in Done after its merge, with its test task written on it
# by done-on-merge.yml, until a main Ship puts it on the main server; this is
# that Ship. Close-ShippedIssues.ps1 reads the board, closes each open issue in
# Done whose merge the commit this release was built from contains, with its
# test task as the closing comment, and names the ones that stay open. Main
# only: dev is where the team checks nothing breaks, not where testers test.
# After the tag, because it needs the commit the release record names, and
# like the follow-ons above it cannot fail the release.
if (-not $DryRun -and -not $Dev -and $global:ThornswoodPublishedRelease) {
    Head 'The Done issues it carries'
    if ($tagged.Commit) {
        Invoke-PostShip 'closing the Done issues it carries' 'Close-ShippedIssues.ps1' @{ Commit = $tagged.Commit; RepoDir = $RepoDir; NoPause = $true } `
            ".\scripts\release\Close-ShippedIssues.ps1 -Commit $($tagged.Commit)"
    } else {
        # The tag step said why the record named no commit.
        Say '  not closed: the release record names no commit, so what this release carries is not known' 'Red'
        $script:PostShipFailed += [pscustomobject]@{
            What     = 'the Done issues it carries were not closed'
            PutRight = '.\scripts\release\Close-ShippedIssues.ps1 -Commit (git rev-parse HEAD)'
        }
    }
}

# A DEV RELEASE WRITES THE DEV TEST TASKS IT CARRIES (#5199). A Dev test task
# is for developers and goes up as soon as a dev release carries the fix
# (Patrick, 22 Oct), which was a hand step with no owner. The same script,
# with -Dev and this release's name: each issue in Done whose Dev block this
# release carries gets that block with its Build: line naming this release,
# and the bot posts it in #dev-test-tasks. Nothing is closed.
if (-not $DryRun -and $Dev -and $global:ThornswoodPublishedRelease) {
    Head 'The Dev test tasks it carries'
    $devName = [string]$global:ThornswoodPublishedRelease
    if ($tagged.Commit) {
        Invoke-PostShip 'writing the Dev test tasks it carries' 'Close-ShippedIssues.ps1' @{ Commit = $tagged.Commit; RepoDir = $RepoDir; NoPause = $true; Dev = $true; Build = $devName } `
            ".\scripts\release\Close-ShippedIssues.ps1 -Commit $($tagged.Commit) -Dev -Build $devName"
    } else {
        Say '  not written: the release record names no commit, so what this release carries is not known' 'Red'
        $script:PostShipFailed += [pscustomobject]@{
            What     = 'the Dev test tasks it carries were not written'
            PutRight = ".\scripts\release\Close-ShippedIssues.ps1 -Commit (git rev-parse HEAD) -Dev -Build $devName"
        }
    }
}

Head 'Done'
# Repeated here on purpose. A red line in the middle of a release log is a line
# nobody reads: the last screen is the one that gets looked at.
# The release is out either way, and the people who would have read the post
# do not know it. Said here because this is the screen that gets looked at.
if ($global:ThornswoodDiscordResult -eq 'failed') {
    Say ('The release went out, but ' +
         $(if ($Dev) { 'the dev updates channel' } else { '#news' }) +
         ' was NOT told.') 'Yellow'
    Say ('  .\scripts\ops\Publish-Discord.ps1' + $(if ($Dev) { ' -Dev' } else { '' }) +
         '   posts it on its own') 'Yellow'
    Write-Host ''
}
# Said again here for the same reason as the Discord above:
# the last screen is the one that gets looked at, and one red line in the middle
# of a release log is a line nobody reads.
if ($script:PostShipFailed.Count) {
    Say 'The release is out and stays out. What did not happen after it:' 'Yellow'
    foreach ($f in $script:PostShipFailed) {
        Say ("  $($f.What)") 'Red'
        Say ("    $($f.PutRight)") 'Yellow'
    }
    Say '  Until they run, the site may be serving the feed it had, which is the release' 'DarkGray'
    Say '  people are offered, or the Downloads page still shows an old build' 'DarkGray'
    Say '  item-not-found. Each line above asks before it acts, so it can be run twice.' 'DarkGray'
    Write-Host ''
}
if ($DryRun) { Say 'Dry run finished. Nothing left your machine.' 'Yellow' }
elseif ($NoAnnounce) { Say 'Everyone gets it next time they open the launcher.' 'Green' }
else {
    Say ("Everyone in the world has $AnnounceMinutes minutes, then they are put " +
         'back to the launcher to pick it up.') 'Green'
}
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
# AND SHIP STILL EXITS 0 WHEN ONE OF THOSE DID NOT HAPPEN, asked for by the
# website lane on 27 September: "Exit 1 = refused publish (do not fail the
# release)". This section used to exit 1 on it, which was this lane's own reading
# of the standing order that the tip and its follow-ons go out together. A
# release that is on the feed, in #news and on the server is out, and a remirror
# that refused rather than publish a feed naming missing bytes did the careful
# thing. The lines above are the record, and they name what to run.
