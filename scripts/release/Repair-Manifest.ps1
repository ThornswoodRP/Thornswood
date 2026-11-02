<#
  Repair-Manifest.ps1

  Takes packs with no download url back out of version.json and sends the fix.
  Since 24 September it takes out packs held anywhere but the repository
  launchers read the feed from as well.

  How one gets in there: publishing uploads each pack as a release asset and
  writes the returned url into version.json. When an upload fails, the pack is
  still written, with an empty url. Every launcher then tries to download from
  nothing, fails with "The path is not of a legal form", and because a pack it
  cannot apply is a pack the server is expecting, Play stays switched off. It
  locks out everybody at once, including the person who published it.

  A pack removed here is not lost work: the next publish rebuilds from the
  current build, so whatever was in it ships again in the next one.

  The other kind is a pack whose url is a release asset anywhere but the
  repository launchers read the feed from (Feed-Rules.ps1 has the rule and the
  measurement). On 24 September that was 164 of the 227 packs on the live feed,
  20260910-2345 to 20260914-1917, all in the private source repository, which
  has no releases left, so nothing can download them with or without a token.
  Taking them out loses nothing a launcher could have had. A fresh install
  starts from a game they were applied to, which is why the setup seeds
  applied.txt with their ids (Build-SetupFiles.ps1).

  It works on the feed launchers read: since #907 it receives version.json
  from the VPS store into this machine's working folder for the channel
  (scripts\release\Feed-Store.ps1), and sends the repaired one back, which is
  the moment the site serves it. The send refuses, replacing nothing, if the
  feed or the baseline changed up there after it was received. Until #907 it
  worked on the Thornswood-Releases clone and pushed; until 24 September on
  version.json in the source repository, which no launcher read.
  -RepoDir <folder> works on the version.json in that folder instead and
  receives nothing; the tests use it with -NoPush.

      .\Repair-Manifest.ps1            show what is broken and fix it
      .\Repair-Manifest.ps1 -DryRun    show it and change nothing
      .\Repair-Manifest.ps1 -Channel dev -DryRun    the same for the dev feed

  MOVING THE URLS TO THE SITE (#897). With -MoveToSite it takes nothing out:
  every url on the feed that still points at GitHub, and whose bytes the site
  already answers for at /feed[-dev]/assets/<sha256>, is rewritten to that
  address, and the feed is sent like any other repair. A url the site does
  not answer for stays where it is. It is how the main feed moves without
  waiting for a main Ship.

      .\Repair-Manifest.ps1 -MoveToSite -DryRun     what would move
      .\Repair-Manifest.ps1 -MoveToSite             move it and send it
#>
[CmdletBinding()]
param(
    [string]$RepoDir,
    [switch]$DryRun,
    [switch]$NoPush,
    [switch]$NoPause
    ,[ValidateSet('main', 'dev')][string]$Channel = 'main'
    ,[switch]$MoveToSite
    # Where the site answers. The tests point it at a copy on this machine.
    ,[string]$SiteUrl = 'https://thornswood.net'
    # The applied.txt settled on this machine. Left out, it is the install for
    # the channel, found the way Publish-Update.ps1 finds it rather than
    # assumed to be on C:. The harness points it at a scratch file, because the
    # live one is never touched to test anything.
    ,[string]$AppliedFile
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot 'Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Feed-Store.ps1')
$receive = -not $RepoDir
if (-not $RepoDir) { $RepoDir = Get-FeedStoreDir $Channel }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; if (-not $NoPause) { [void](Read-Host 'Enter to exit') }; exit 1 }

# ---- where the launcher is installed ----------------------------------------
#
# The install Where.ps1 finds (#3003), the one Publish-Update.ps1 asks for, so
# the applied.txt settled below is the one the launcher on this machine reads.
# C:\Thornswood on most machines, or Thornswood on another drive when the
# launcher is there. Until it looked there it was always C:, so on that
# machine the repair wrote nothing, the dead pack ids were never marked as
# seen, and the launcher kept the update card up until the repaired feed came
# back down. The dev build is the install plus -DevBuild, where the main
# launcher's Settings page installs it (DevBuild.cs), which Where.ps1
# InstallDev answers. -AppliedFile still wins.

. (Join-Path $Here 'Feed-Rules.ps1')

# Received first, dry run or not, so the repair is made on the feed launchers
# read right now rather than on whatever this machine last saw (#907).
if ($receive) {
    try { [void](Receive-FeedStore $Channel $RepoDir) }
    catch { Die ("Could not receive the $Channel feed from the VPS. Nothing was written: " + $_.Exception.Message) }
}
$VersionFile = Join-Path $RepoDir 'version.json'
if (-not (Test-Path -LiteralPath $VersionFile)) { Die "not found: $VersionFile. Pass -RepoDir with the folder holding version.json." }

# Sends the repaired feed back to the VPS, which is when the site serves it.
function Send-Repaired {
    Head 'Sending'
    try { [void](Send-FeedStore $Channel $RepoDir @('version.json')) }
    catch { Die ("The feed was not sent: " + $_.Exception.Message + " It is repaired here in $RepoDir, and nobody has it yet.") }
    Say '  sent; the site serves it now' 'Green'
}

Head 'Reading version.json'
Say "  $VersionFile" 'DarkGray'
$doc = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $VersionFile -Raw) $VersionFile
$packs = @()
if ($doc.PSObject.Properties['packs'] -and $doc.packs) { $packs = @($doc.packs) }
Say ("  {0} pack(s)" -f $packs.Count) 'DarkGray'

if ($MoveToSite) {
    $dev = ($Channel -eq 'dev')
    $prefix = if ($dev) { 'feed-dev' } else { 'feed' }
    Head "Moving urls to $SiteUrl/$prefix/assets/"
    $mv = Move-FeedUrlsToSite $doc -Dev:$dev -OnSite { param($sha, $bytes) Test-SiteAsset $SiteUrl $prefix $sha $bytes }
    $left = @($mv.Stayed)
    Say ("  {0} url(s) move to the site" -f $mv.Moved.Count) $(if ($mv.Moved.Count) { 'Green' } else { 'DarkGray' })
    if ($left.Count) {
        Say ("  {0} stay where they are, because the site does not answer for them:" -f $left.Count) 'Yellow'
        foreach ($l in $left) { Say "    $($l.What)" 'Yellow' }
        Say '  .\scripts\deploy\Remirror-Site-Feed.ps1 -Send <file> puts their bytes up.' 'Yellow'
    }
    if ($DryRun -or -not $mv.Moved.Count) {
        if ($DryRun) { Say '  Dry run. Nothing was written.' 'Yellow' }
        Write-Host ''
        if (-not $NoPause) { [void](Read-Host 'Enter to close') }
        exit 0
    }
    Write-FeedVersionFile $VersionFile $doc
    Say '  version.json written' 'Green'
    if ($NoPush) {
        Say 'Not pushed, as asked.' 'Yellow'
    } else {
        Send-Repaired
    }
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

$feedRepo = Get-FeedRepo $doc
$split = Split-FeedPacks $packs $feedRepo
$bad = @($split.Drop | ForEach-Object { $_.Pack })
$good = @($split.Keep)

if ($bad.Count -eq 0) {
    Say "  every pack downloads from $(if ($feedRepo) { $feedRepo + ' or the site' } else { 'the site' }). Nothing to repair." 'Green'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

Head 'Broken'
foreach ($why in @($split.Drop | ForEach-Object { $_.Why } | Sort-Object -Unique)) {
    $these = @($split.Drop | Where-Object { $_.Why -eq $why })
    Say ("  {0} pack(s) {1}, {2} to {3}" -f $these.Count, $why, $these[0].Pack.id, $these[$these.Count - 1].Pack.id) 'Red'
    foreach ($d in $these) {
        $note = ([string]$d.Pack.notes -split "`r?`n")[0]
        if ($note.Length -gt 70) { $note = $note.Substring(0, 70) + '...' }
        Say ("    {0}   {1}" -f $d.Pack.id, $note) 'DarkGray'
    }
}

# The launcher also stops asking about a pack once its id is in applied.txt, so
# the copy on this machine is settled here as well. Without it this launcher
# would keep the update card up until the repaired file comes back down.
$applied = $AppliedFile
if (-not $applied) {
    $root = [string](& (Join-Path $Here 'Where.ps1') $(if ($Channel -eq 'dev') { 'InstallDev' } else { 'Install' }))
    $applied = Join-Path $root 'Profile\applied.txt'
}
if ($DryRun) {
    Head 'Dry run'
    Say ("  would keep {0} pack(s) and drop {1}" -f $good.Count, $bad.Count) 'Yellow'
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

Head 'Repairing'
$doc.packs = $good
# Compact, no byte order mark (Feed-Json.ps1, Write-FeedVersionFile): a BOM
# is not JSON, which takes the update check out for everyone at once.
Write-FeedVersionFile $VersionFile $doc
Say ("  version.json now lists {0} pack(s)" -f $good.Count) 'Green'

if (Test-Path -LiteralPath $applied) {
    $have = @(Get-Content -LiteralPath $applied | Where-Object { $_.Trim() })
    $add = @($bad | ForEach-Object { [string]$_.id } | Where-Object { $have -notcontains $_ })
    if ($add.Count) {
        Add-Content -LiteralPath $applied -Value $add
        Say ("  marked {0} dead pack(s) as seen on this machine" -f $add.Count) 'DarkGray'
    }
}

if ($NoPush) {
    Write-Host ''
    Say 'Not pushed, as asked. Nobody has this repair until it is sent.' 'Yellow'
}
else {
    Send-Repaired
}

Write-Host ''
Say 'Open the launcher. The update card should clear and Play should come back.' 'Green'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
