<#
  test-updater.ps1

      pwsh -NoProfile -File .\tests\test-updater.ps1

  The launcher's updater, asked its own questions.

  WHY THIS EXISTS. Six functions in launcher\app\Updater.cs (Inside in
  PathFence.cs since #3561, shared with the setup program) decide what counts
  as an update, where one may come from, and which files a pack may write or
  delete: IsNewer, Parts, Inside, ClaimedElsewhere, Pending and
  CheckUrl. Each has the incident that shaped it written above it, and until
  this nothing ran any of them outside a live launcher. The To Do List entry
  put it as "the easiest thing in the codebase to test and the most expensive
  to get wrong, because it decides what gets downloaded and where it is allowed
  to be written". test-dev-version.ps1 carried a PowerShell copy of IsNewer
  until #4825, which answered for the copy and not for the launcher.

  HOW. It builds the launcher project itself with the .NET 10 SDK, as the
  build does (Add-LauncherAssembly, tests\Launcher-Csc.ps1), loads it into
  this PowerShell, which runs on .NET 10 as the launcher does, and calls the
  functions by reflection. Updater is a private static class, and reaching it
  this way means the launcher's source does not change for the sake of a
  test. Nothing in the launcher runs: no Main, no window, no network. Pending
  and ClaimedElsewhere read applied.txt and the Packs folder, so Paths is
  pointed at the temp folder for those two first, and nothing under
  C:\Thornswood or the profile is read or written.

  It runs wherever the SDK is, Linux too (#4823). Until then it compiled with
  the .NET Framework's csc under Windows PowerShell 5.1, because the launcher
  ran on the .NET Framework. Inside's fence is the system's own separator, so
  its checks are written in it, and the drive letter check is Windows' alone.

  MEASURED 24 SEPTEMBER, on a scratch copy of the sources (a -Src it had
  until #4823, when it began building the project itself): eight bugs put
  back into Updater.cs one at a time, and every one turned this red.
  IsNewer as a plain "different" test (7 checks fail), Parts reading letters
  as 0 (7), RepoCandidates forgetting the new name (1), Inside as a plain
  prefix (4), ClaimedElsewhere counting a pack's own list (3), Pending ignoring
  applied.txt (1), CheckUrl matching a host suffix without its dot (1), and
  CheckUrl taking plain http (2).

  KNOWN lines are behaviours that look wrong and are left for Patrick to
  decide. They print what the launcher returns today and are not counted
  either way, so fixing one does not turn this red.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the launcher's own build, by the .NET 10 SDK (#4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
$Src = Join-Path $Here 'launcher\app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Known([string]$what) { Write-Host "KNOWN $what" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tsupdater-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $tmp

function Run {
    Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
    if (-not (Test-Path -LiteralPath $LauncherDotnet)) { return }

    # ---- build ---------------------------------------------------------------
    #
    # The launcher project itself, built as the build builds it, and loaded
    # into this PowerShell, which runs on .NET 10 as the launcher does. Nothing
    # in the launcher runs: no Main, no window, no network.
    $asm = $null
    try { $asm = Add-LauncherAssembly }
    catch {
        Yes 'the launcher project builds' $false
        foreach ($l in @(($_.Exception.Message -split "`r?`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20)) { Write-Host "      $l" }
        return
    }
    Yes 'the launcher project builds' ($null -ne $asm)
    $U = $asm.GetType('Thornswood.Updater')
    $P = $asm.GetType('Thornswood.Paths')
    $script:VD = $asm.GetType('Thornswood.VersionDoc')
    Yes 'Updater, Paths and VersionDoc are in the build' ($null -ne $U -and $null -ne $P -and $null -ne $script:VD)
    if ($null -eq $U -or $null -eq $P -or $null -eq $script:VD) { return }

    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    $script:m = @{}
    $gone = @()
    # Inside is PathFence's since #3561, which the setup program compiles in
    # too, so its unpack is held to the same fence.
    $F = $asm.GetType('Thornswood.PathFence')
    foreach ($n in 'IsNewer', 'Parts', 'Inside', 'ClaimedElsewhere', 'Pending', 'CheckUrl') {
        $from = if ($n -eq 'Inside') { $F } else { $U }
        $script:m[$n] = if ($null -ne $from) { $from.GetMethod($n, $flags) } else { $null }
        if ($null -eq $script:m[$n]) { $gone += $n }
    }
    Yes ('the six functions under test are all there' + $(if ($gone.Count) { ', missing ' + ($gone -join ', ') } else { '' })) (
        $gone.Count -eq 0)
    if ($gone.Count) { return }

    # ---- IsNewer: is the published launcher genuinely newer ------------------
    #
    # From the comment above it: a machine that had just built a launcher saw
    # an older number in the release, called that an update, and overwrote the
    # build it had just made. Different includes older. Newer does not.
    Yes 'IsNewer: 1.1.93 over 1.1.92 is an update' ((Newer '1.1.93' '1.1.92') -eq $true)
    Yes 'IsNewer: 1.1.91 over 1.1.92 is not, the case that overwrote a fresh build' ((Newer '1.1.91' '1.1.92') -eq $false)
    Yes 'IsNewer: the same number is not' ((Newer '1.1.92' '1.1.92') -eq $false)
    Yes 'IsNewer: numbers compare as numbers, 1.1.10 over 1.1.9 is an update' ((Newer '1.1.10' '1.1.9') -eq $true)
    Yes 'IsNewer: and 1.1.9 over 1.1.10 is not' ((Newer '1.1.9' '1.1.10') -eq $false)
    Yes 'IsNewer: a higher middle number wins whatever the last one says, 1.2.0 over 1.1.99' ((Newer '1.2.0' '1.1.99') -eq $true)
    Yes 'IsNewer: a missing part counts as 0, 1.1.92.0 over 1.1.92 is not an update' ((Newer '1.1.92.0' '1.1.92') -eq $false)
    Yes 'IsNewer: nor is 1.1.92 over 1.1.92.0' ((Newer '1.1.92' '1.1.92.0') -eq $false)

    # The dev channel's four part numbers, from the old test-dev-version.ps1 and the
    # build of 21 September that nobody already on dev could take.
    Yes 'IsNewer: a dev build 1.1.77.1 is an update over main 1.1.77' ((Newer '1.1.77.1' '1.1.77') -eq $true)
    Yes 'IsNewer: 1.1.76.1 over 1.1.77 is not, the dev build of 21 September' ((Newer '1.1.76.1' '1.1.77') -eq $false)
    Yes 'IsNewer: a promoted main release 1.1.79 beats dev 1.1.78.9' ((Newer '1.1.79' '1.1.78.9') -eq $true)

    Yes 'IsNewer: a v in front is read past, v1.1.93 over 1.1.92' ((Newer 'v1.1.93' '1.1.92') -eq $true)
    Yes 'IsNewer: and V1.1.92 over 1.1.92 is not an update' ((Newer 'V1.1.92' '1.1.92') -eq $false)
    Yes 'IsNewer: spaces round the number are read past' (
        (Newer ' 1.1.93 ' '1.1.92') -eq $true -and (Newer '1.1.92 ' '1.1.92') -eq $false)
    Yes 'IsNewer: a feed with no launcher version offers nothing' (
        (Newer $null '1.1.92') -eq $false -and (Newer '' '1.1.92') -eq $false)
    # A version that does not parse is not an update just because the text
    # differs. Older unreadable text used to install (#1329).
    Yes 'IsNewer: a version it cannot read is not an update' ((Newer '1.1.93-rc' '1.1.92') -eq $false)
    Yes 'IsNewer: an older unreadable version is not an update' ((Newer '1.1.91-rc' '1.1.92') -eq $false)
    Yes 'IsNewer: a readable number does not beat an unreadable local' ((Newer '1.1.93' '1.1.92-rc') -eq $false)
    Yes 'IsNewer: two different unreadable versions are not an update' ((Newer 'abc' 'def') -eq $false)
    Yes 'IsNewer: the same unreadable text is not an update' ((Newer '1.1.91-rc' '1.1.91-rc') -eq $false)

    $version = [string]$U.GetField('Version', $flags).GetValue($null)
    Yes "IsNewer: this launcher's own version, $version, is one it can read" ((PartsText $version) -ne 'null')
    Yes 'IsNewer: and it is never offered to itself' ((Newer $version $version) -eq $false)

    # ---- Parts: the numbers IsNewer compares ---------------------------------
    Yes 'Parts: 1.1.92 reads as 1 1 92' ((PartsText '1.1.92') -eq '1.1.92')
    Yes 'Parts: 1.1.77.1 keeps all four' ((PartsText '1.1.77.1') -eq '1.1.77.1')
    Yes 'Parts: v1.2 reads past the v' ((PartsText 'v1.2') -eq '1.2')
    foreach ($bad in @($null, '', 'abc', '1.1.x', '1..2', '1.', '1.1.92-dev')) {
        $shown = if ($null -eq $bad) { 'null' } else { "'$bad'" }
        Yes "Parts: nothing for $shown, which is not all numbers" ((PartsText $bad) -eq 'null')
    }

    # ---- no GitHub fallback (#907) --------------------------------------------
    #
    # RepoCandidates tried both sides of the repository rename on the
    # GitHub Contents API fallback. The fallback went with Thornswood-Releases,
    # so the site feed is the only place updates are read from: a config with a
    # repository and no feed url has no update source at all.
    Yes 'RepoCandidates is gone with the GitHub fallback' ($null -eq $U.GetMethod('RepoCandidates', $flags))
    $upSrc = [IO.File]::ReadAllText((Join-Path $Src 'Updater.cs'))
    Yes 'Updater.cs builds no GitHub contents API address' ($upSrc -notmatch '/contents/version\.json')

    # ---- FeedUrl: config.json cannot switch the update check off (#937) -----
    #
    # Blanking UpdateFeedUrl in config.json used to turn the check off, and a
    # launcher with no update source let Play through on its own say. Now a
    # feed address config.json names is kept only on thornswood.net over https,
    # the way a feed announces a move; anything else is the built-in address
    # for the channel. A repository with no feed url is no update source any
    # more, and neither is anything else: there is always one.
    $C = $asm.GetType('Thornswood.Config')
    $fu = $U.GetMethod('FeedUrl', $flags)
    Yes 'Updater.Enabled is gone: nothing can say updates are off' ($null -eq $U.GetMethod('Enabled', $flags))
    if ($null -ne $C -and $null -ne $fu) {
        $main = 'https://thornswood.net/feed/version.json'
        $devFeed = 'https://thornswood.net/feed-dev/version.json'
        function FeedFor([string]$url, [string]$channel, [string]$branch) {
            $cfg = [Activator]::CreateInstance($C)
            $C.GetField('UpdateFeedUrl').SetValue($cfg, $url)
            $C.GetField('Channel').SetValue($cfg, $channel)
            $C.GetField('UpdateBranch').SetValue($cfg, $branch)
            return [string]$fu.Invoke($null, @($cfg))
        }
        Yes 'FeedUrl: an empty UpdateFeedUrl is the built-in main feed' ((FeedFor '' '' 'main') -eq $main)
        Yes 'FeedUrl: a missing one too' ((FeedFor $null '' 'main') -eq $main)
        Yes 'FeedUrl: an empty one on the dev build is the built-in dev feed' ((FeedFor '' 'dev' 'dev') -eq $devFeed)
        Yes 'FeedUrl: UpdateBranch dev alone is the dev feed too' ((FeedFor '   ' '' 'dev') -eq $devFeed)
        foreach ($bent in @('https://evil.example/version.json', 'http://thornswood.net/feed/version.json',
                            'https://thornswood.net.evil.example/feed/version.json',
                            'https://evilthornswood.net/feed/version.json',
                            'https://someone@thornswood.net/feed/version.json',
                            'https://thornswood.net:8443/feed/version.json',
                            'file:///C:/Thornswood/version.json', 'not an address', 'off')) {
            Yes "FeedUrl: '$bent' in config.json falls back to the built-in feed" ((FeedFor $bent '' 'main') -eq $main)
        }
        Yes 'FeedUrl: and on the dev build to the dev feed' ((FeedFor 'https://evil.example/v.json' 'dev' 'dev') -eq $devFeed)
        Yes 'FeedUrl: the site feed is kept' ((FeedFor $main '' 'main') -eq $main)
        Yes 'FeedUrl: a move the feed announced within thornswood.net is kept' (
            (FeedFor 'https://thornswood.net/feed-next/version.json' '' 'main') -eq 'https://thornswood.net/feed-next/version.json')
        Yes 'FeedUrl: and on a thornswood.net host of its own' (
            (FeedFor 'https://cdn.thornswood.net/feed/version.json' '' 'main') -eq 'https://cdn.thornswood.net/feed/version.json')
    } else {
        Yes 'Config and Updater.FeedUrl are in the build' $false
    }
    $checkAt = $upSrc.IndexOf('public static VersionDoc Check(Config cfg)')
    $checkBody = if ($checkAt -ge 0) { $upSrc.Substring($checkAt, $upSrc.IndexOf('static VersionDoc FromSite(', $checkAt) - $checkAt) } else { '' }
    Yes 'Updater.Check reads FeedUrl and never UpdateFeedUrl itself' (
        $checkBody -match 'string feedUrl = FeedUrl\(cfg\);' -and $checkBody -notmatch 'UpdateFeedUrl' -and $checkBody -notmatch 'return null;')
    $shellAll = ''
    foreach ($f in (Get-ChildItem -LiteralPath $Src -Filter 'Shell*.cs')) { $shellAll += [IO.File]::ReadAllText($f.FullName) }
    Yes 'the Shell no longer lets Play through with no update source (Unblock is gone)' ($shellAll -notmatch '\bUnblock\s*\(')
    $opened = @([regex]::Matches($shellAll, 'updatePending = false')).Count
    $upd = [IO.File]::ReadAllText((Join-Path $Src 'ShellUpdate.cs'))
    $inDoc = $upd.Substring($upd.IndexOf('static void OnVersionDoc('), $upd.IndexOf('static void CheckUpdatesInPlay(') - $upd.IndexOf('static void OnVersionDoc('))
    # After the packs went in: the same block, before "Update finished." and
    # with no other updatePending between.
    $installed = @([regex]::Matches($upd, '(?s)updatePending = false;(?:(?!updatePending).){0,600}?Log\("Update finished\."\);')).Count
    Yes 'Play is let through only by a feed that was read: every updatePending = false is in OnVersionDoc or after its packs went in' (
        $opened -gt 0 -and $opened -eq (@([regex]::Matches($inDoc, 'updatePending = false')).Count + $installed))

    # ---- Inside: the fence round every write and delete ----------------------
    #
    # From the comment above it: "C:\Thornswood2\anything" starts with
    # "C:\Thornswood", so a plain prefix test let a pack reach next door.
    # The fence is the system's own separator (Path.DirectorySeparatorChar),
    # so the paths here are written in it: C:\ and \ on Windows, where the
    # launcher runs, / anywhere else this runs, the same rule either way.
    $s = [string][IO.Path]::DirectorySeparatorChar
    $top = if ($OnWindows) { 'C:' } else { '' }
    function W([string]$p) { return ($top + $s + $p.Replace('\', $s)) }
    Yes 'Inside: a file under the game folder is inside it' ((Within (W 'Thornswood\Game\Data\Thornswood.esp') (W 'Thornswood\Game')) -eq $true)
    Yes 'Inside: Thornswood2\anything is not inside Thornswood' ((Within (W 'Thornswood2\anything') (W 'Thornswood')) -eq $false)
    Yes 'Inside: the folder is not inside itself, so nothing can delete the fence' ((Within (W 'Thornswood\Game') (W 'Thornswood\Game')) -eq $false)
    Yes 'Inside: a folder given with its separator on the end' (
        (Within (W 'Thornswood\Game\x') ((W 'Thornswood\Game') + $s)) -eq $true -and (Within (W 'Thornswood\Game\x') ((W 'Thornswood\Game') + '/')) -eq $true)
    Yes 'Inside: the case of the letters does not matter, as on Windows' ((Within (W 'thornswood\game\data\x') (W 'Thornswood\Game')) -eq $true)
    if ($OnWindows) {
        Yes 'Inside: the same folder on another drive is not inside' ((Within 'D:\Thornswood\Game\x' 'C:\Thornswood\Game') -eq $false)
    }
    Yes 'Inside: nothing given is inside nothing' (
        (Within $null (W 'Thornswood')) -eq $false -and (Within (W 'Thornswood\x') $null) -eq $false -and (Within '' (W 'Thornswood')) -eq $false)

    # Every caller resolves the path first, the way Install does for a line of
    # delete.txt and RemovePack does for a line of a file list: Combine leaves
    # a .. where it is, and it is Delete that would resolve it, outside the
    # game. This is that pattern, on the lines a bad pack would carry.
    $game = W 'Thornswood\Game'
    $out = @('..\..\Profile\config.json', '..\Game2\x', 'Data\..\..\x', '\Windows\x')
    if ($OnWindows) { $out += 'C:\Windows\System32\x.dll' }
    foreach ($line in $out) {
        Yes "Inside: a pack line '$line', resolved as the callers resolve it, stays out" ((Fenced $game $line.Replace('\', $s)) -eq $false)
    }
    foreach ($line in @('Data\Platform\Plugins\thornswood-front.js', 'Data\..\Data\x.esp')) {
        Yes "Inside: a pack line '$line', resolved the same way, is let in" ((Fenced $game $line.Replace('\', $s)) -eq $true)
    }

    # ---- CheckUrl: where an update may come from -----------------------------
    #
    # Checked before a single byte is fetched, because what is on the other end
    # gets run. It says no by throwing.
    foreach ($u in @(
        'https://github.com/EvilPatrick06/Thornswood-Releases/releases/download/v1.1.92/Thornswood.exe',
        'https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/2',
        'https://release-assets.githubusercontent.com/github-production-release-asset/1/2',
        'https://api.github.com/repos/EvilPatrick06/Thornswood-Releases/releases/assets/1',
        'https://thornswood.net/files/pack.zip',
        'https://thornswood.net/feed/version.json',
        'https://thornswood.net/feed-dev/version.json',
        'https://thornswood.net/feed/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'https://thornswood.net/feed-dev/assets/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'https://cdn.thornswood.net/feed/assets/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'https://codeload.github.com/EvilPatrick06/Thornswood-Releases/zip/main',
        'https://GitHub.com/EvilPatrick06/Thornswood-Releases/releases/download/v1/a.zip')) {
        $why = Refusal $u
        Yes ("CheckUrl: lets through $u" + $(if ($null -ne $why) { "  (refused: $why)" } else { '' })) ($null -eq $why)
    }
    foreach ($u in @(
        'http://github.com/EvilPatrick06/Thornswood-Releases/releases/download/v1/a.zip',
        'ftp://github.com/a.zip',
        'file:///C:/Windows/System32/cmd.exe',
        'Thornswood.exe',
        '',
        $null,
        'https://github.com.evil.example/a.zip',
        'https://evilgithub.com/a.zip',
        'https://github.com@evil.example/a.zip',
        'https://evil.example\@github.com/a.zip',
        'https://evil.example/?u=https://github.com/a.zip',
        'https://raw.githubusercontent.com/someone/repo/main/a.exe',
        'https://thornswood.net.evil.example/a.zip')) {
        $why = Refusal $u
        $shown = if ($null -eq $u) { 'null' } elseif ($u -eq '') { 'an empty address' } else { $u }
        Yes ("CheckUrl: refuses $shown" + $(if ($null -ne $why) { "  ($why)" } else { '' })) ($null -ne $why)
    }

    # ---- Pending: which required packs still want applying -------------------
    $applied = Join-Path $tmp 'applied.txt'
    $packs = Join-Path $tmp 'Packs'
    $P.GetField('AppliedFile').SetValue($null, $applied)
    $P.GetField('PacksDir').SetValue($null, $packs)
    Yes 'Paths points at the temp folder, not at an install' (
        [string]$P.GetField('AppliedFile').GetValue($null) -eq $applied -and [string]$P.GetField('PacksDir').GetValue($null) -eq $packs)

    $three = '{"launcherVersion":"1.1.92","packs":[{"id":"pack-1"},{"id":"pack-2"},{"id":"pack-3"}]}'
    Yes 'Pending: with no applied.txt every pack is pending, in the order the feed gives' ((PendingIds $three) -eq 'pack-1,pack-2,pack-3')
    [IO.File]::WriteAllLines($applied, [string[]]@('pack-1', '  PACK-3  ', ''), (New-Object Text.UTF8Encoding($false)))
    Yes 'Pending: a pack in applied.txt is not offered again, whatever its case or spacing there' ((PendingIds $three) -eq 'pack-2')
    Yes 'Pending: a pack with no id, or an empty slot, is skipped rather than offered for ever' (
        (PendingIds '{"packs":[null,{},{"id":""},{"id":"pack-4"}]}') -eq 'pack-4')
    Yes 'Pending: a feed with no packs list offers nothing' ((PendingIds '{"launcherVersion":"1.1.92"}') -eq '')
    Yes 'Pending: an optional pack is never applied on its own' ((PendingIds '{"packs":[],"optional":[{"id":"opt-1"}]}') -eq '')
    Yes 'Pending: no feed at all offers nothing' ((PendingIds $null) -eq '')

    # ---- ClaimedElsewhere: what taking a pack off must leave -----------------
    #
    # From the comment above it: a later pack wrote over a file an earlier one
    # created, so the later list says R| and the earlier one still says N|.
    # Taking the earlier pack off deleted the file the later one was using.
    $mine = Join-Path $packs 'pack-early.files'
    $none = Ask 'ClaimedElsewhere' $mine
    Yes 'ClaimedElsewhere: with no Packs folder nothing is claimed' ($null -ne $none -and $none.Count -eq 0)

    $null = New-Item -ItemType Directory -Force -Path $packs
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($mine, [string[]]@('# fence=game', 'N|game\Data\Textures\shared.dds', 'N|game\Data\Textures\only-mine.dds'), $utf8)
    [IO.File]::WriteAllLines((Join-Path $packs 'pack-late.files'), [string[]]@('# fence=game', 'R|game\Data\Textures\shared.dds', 'N|Profile\Default\plugins.txt', 'N|', ''), $utf8)
    [IO.File]::WriteAllLines((Join-Path $packs 'notes.txt'), [string[]]@('N|game\Data\from-a-note.dds'), $utf8)
    $claimed = Ask 'ClaimedElsewhere' $mine
    Yes 'ClaimedElsewhere: the file a later pack wrote over is claimed, the case in the comment' ($claimed.Contains('game\Data\Textures\shared.dds'))
    Yes 'ClaimedElsewhere: matched whatever the case of the letters' ($claimed.Contains('GAME\DATA\TEXTURES\SHARED.DDS'))
    Yes 'ClaimedElsewhere: a Root path is claimed as it is written, with no game prefix' ($claimed.Contains('Profile\Default\plugins.txt'))
    Yes 'ClaimedElsewhere: a pack''s own list does not count against it' (-not $claimed.Contains('game\Data\Textures\only-mine.dds'))
    Yes 'ClaimedElsewhere: a file in Packs that is not a .files list is not read' (-not $claimed.Contains('game\Data\from-a-note.dds'))
    Yes ('ClaimedElsewhere: the header and a line with no path are not paths, so exactly 2 are claimed, got {0}' -f $claimed.Count) ($claimed.Count -eq 2)
    $shouted = Ask 'ClaimedElsewhere' (Join-Path $packs 'PACK-EARLY.FILES')
    Yes 'ClaimedElsewhere: its own list is known by name whatever the case' (-not $shouted.Contains('game\Data\Textures\only-mine.dds'))

    # ---- known, and left for Patrick ------------------------------------------
    #
    # Measured here and written down, not asserted: each is a decision about
    # Updater.cs, which is one of the six shared files.
    Write-Host ''
    if ($OnWindows) { Known ("Inside('C:\Thornswood\Game\..\..\Windows\x', 'C:\Thornswood\Game') is {0}, and Inside('C:\Thornswood\Game\x', 'C:/Thornswood/Game') is {1}. It compares text and resolves neither side. Every caller resolves the path with Path.GetFullPath first, which is why the resolved lines above stay out; a new caller that forgets gets the first answer, and a folder written with forward slashes would fence everything out." -f (Within 'C:\Thornswood\Game\..\..\Windows\x' 'C:\Thornswood\Game'), (Within 'C:\Thornswood\Game\x' 'C:/Thornswood/Game')) }
    $other = Refusal 'https://github.com/someone-else/anything/releases/download/v1/a.zip'
    Known ("CheckUrl on another account's upload, github.com/someone-else/anything/releases/download/v1/a.zip, is {0}. The list pins the host and not the owner, the checksum comes from the same feed, and ExpectedSigner is empty, so a feed that names somebody else's file is fetched and run." -f $(if ($null -eq $other) { 'let through' } else { "refused ($other)" }))
}

# ---- how each function is asked ---------------------------------------------
#
# Every answer goes back through the comma, so a list or an array comes out
# as one value rather than being unrolled into the pipeline on the way. Every
# argument goes in as the value underneath, because a path from Join-Path
# arrives wrapped and reflection will not turn the wrapper into a string.
function Ask($name) {
    $a = New-Object object[] $args.Count
    for ($i = 0; $i -lt $args.Count; $i++) {
        if ($null -ne $args[$i]) { $a[$i] = $args[$i].psobject.BaseObject }
    }
    return , ($script:m[$name].Invoke($null, $a))
}
function Newer($remote, $local) { return [bool](Ask 'IsNewer' $remote $local) }
function Within($full, $folder) { return [bool](Ask 'Inside' $full $folder) }
function PartsText($v) {
    $r = Ask 'Parts' $v
    if ($null -eq $r) { return 'null' }
    return ($r -join '.')
}
function Fenced([string]$fence, [string]$line) {
    $full = [IO.Path]::GetFullPath([IO.Path]::Combine($fence, $line))
    return (Within $full $fence)
}
function Refusal($url) {
    try { $null = Ask 'CheckUrl' $url; return $null }
    catch {
        $e = $_.Exception
        while ($null -ne $e.InnerException) { $e = $e.InnerException }
        return $e.Message
    }
}
function PendingIds($json) {
    $doc = $null
    if ($null -ne $json) {
        $a = New-Object object[] 1
        $a[0] = [Text.Encoding]::UTF8.GetBytes($json)
        $doc = $script:VD.GetMethod('Parse').Invoke($null, $a)
    }
    # Pending(cfg, doc): no config is a launcher Velopack did not install,
    # which takes its packs from the feed (Velo.GameFromPackage).
    try { $list = Ask 'Pending' $null $doc }
    catch { return 'threw: ' + $_.Exception.Message }
    if ($null -eq $list) { return 'null' }
    return (@($list | ForEach-Object { $_.id }) -join ',')
}

try {
    try { Run }
    catch { Yes ('the harness ran to the end, and stopped on: ' + $_.Exception.Message) $false }
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
