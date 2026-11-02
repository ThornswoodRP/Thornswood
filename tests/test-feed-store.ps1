<#
  test-feed-store.ps1

  The feed, the baseline and their history live on the VPS beside the feed
  the site serves, and nothing about them is public (#907).

  WHY THIS EXISTS. Until #907 Ship kept published.json and the history of
  version.json in two clones of EvilPatrick06/Thornswood-Releases, pulled,
  committed and pushed on every release. Patrick asked for that repository to
  be deleted, so scripts\release\Feed-Store.ps1 keeps them in
  C:\Thornswood-Docs\feed and feed-dev instead. This drives it against a
  scratch folder standing in for C:\Thornswood-Docs (the same script the VPS
  runs, run in place):

    1. receive: both files arrive, read.json records their sha256, backup\ a copy
    2. send: version.json goes up as the next generation and the one before
       stays (#2727); the baseline is replaced, the old one kept in history\;
       launchers.txt grows, .part never left behind, and an unchanged file is
       not sent
    3. two publishers: a send refuses, replacing nothing, when the feed OR the
       baseline changed up there after this machine received them
    4. a baseline missing up there is taken out of the working folder too
    5. a short .part is refused and nothing is replaced
    6. a copy of site\server.js serving that folder answers version.json and
       the assets, and 404 for published.json, launchers.txt, history\, .part,
       read.json and a generation by its own name; Read-SiteFeed reads the
       feed from it
    7. scripts\oneoff\Move-FeedStore-ToVps.ps1 against scratch clones: -Check
       sends nothing, the real run puts each clone's published.json up byte for
       byte with every launcher version its history named, a second run sends
       nothing, and it refuses a site feed that is not the clone's, a clone
       with an unpushed commit, and a baseline already moved on

  Nothing here connects to anything but 127.0.0.1. Everything it writes is in
  its own temp folder.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$store = Join-Path $repo 'scripts\release\Feed-Store.ps1'
Yes 'scripts\release\Feed-Store.ps1 is there' (Test-Path -LiteralPath $store)
if (-not (Test-Path -LiteralPath $store)) { Done }
. $store

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-feed-store-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$site = Join-Path $T 'site'
$appdata = Join-Path $T 'appdata'
$oldAppData = $env:LOCALAPPDATA
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Sha([string]$path) { return (Get-FeedStoreSha $path) }
# The feed a stand-in site serves is the newest of its generations, and a
# feed put there is the next one, as the store sends it (#2727).
function Feed([string]$chan) { return (Get-FeedVersionFile $chan) }
function Put-Feed([string]$chan, [string]$text) { Put (Join-Path (Join-Path $chan 'version') (Get-FeedVersionNext $chan)) $text }
function Gens([string]$chan) { return ,@(Get-ChildItem -LiteralPath (Join-Path $chan 'version') -File | Sort-Object Name) }
function Threw([scriptblock]$b) { try { & $b | Out-Null; return '' } catch { return $_.Exception.Message } }
# The port came from the system and was let go, so another run beside this one
# can take it before the child binds it, the fault #1727 fixed in the .js
# harnesses (#1755). Nothing asks the port anything until the child itself has
# said on its output that it is listening there. A child that closes its output
# first has stopped, and EADDRINUSE on its errors means something else holds
# the port. $err is the task already draining the child's errors. Answers ''
# once the line has come, otherwise why it did not.
function Wait-OwnLine($proc, $err, [string]$mark, [int]$port, [string]$what) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    $seen = New-Object 'System.Collections.Generic.List[string]'
    while ($true) {
        $left = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        $read = $proc.StandardOutput.ReadLineAsync()
        if (-not $read.Wait($left)) { return ('{0} did not say it was listening on port {1} within 20 seconds' -f $what, $port) }
        $got = $read.Result
        if ($null -eq $got) {
            [void]$proc.WaitForExit(5000)
            $said = ''
            if ($err.Wait(5000)) { $said = ([string]$err.Result).Trim() }
            $code = '?'
            if ($proc.HasExited) { $code = $proc.ExitCode }
            if ($said -match 'EADDRINUSE') {
                return ('something else already holds port {0}, so {1} stopped (exit {2}) before it was listening' -f $port, $what, $code)
            }
            return ('{0} stopped (exit {1}) before it was listening: {2} {3}' -f $what, $code, ($seen -join ' '), $said)
        }
        $seen.Add($got)
        if ($got.StartsWith($mark + ' listening on ') -and $got.EndsWith(':' + $port)) {
            # Drained from here on, so a chatty child never blocks on a full pipe.
            $null = $proc.StandardOutput.ReadToEndAsync()
            return ''
        }
    }
}
$procs = @()

try {
    New-Item -ItemType Directory -Force -Path $site, $appdata | Out-Null
    $env:LOCALAPPDATA = $appdata
    Put-Feed (Join-Path $site 'feed') '{"launcherVersion":"1.1.101","packs":[]}'
    Put (Join-Path $site 'feed\published.json') '{"a":"main baseline"}'
    Put-Feed (Join-Path $site 'feed-dev') '{"launcherVersion":"1.1.101.34","packs":[]}'
    Put (Join-Path $site 'feed-dev\published.json') '{"a":"dev baseline"}'

    # ---- 1. receive ---------------------------------------------------------
    Write-Host ''; Write-Host 'receive'
    $dir = Get-FeedStoreDir 'dev'
    Yes 'the dev working folder is under LOCALAPPDATA, not a clone beside the repo' ($dir -eq (Join-Path $appdata 'Thornswood\feed\dev'))
    Yes 'and main has its own' ((Get-FeedStoreDir 'main') -eq (Join-Path $appdata 'Thornswood\feed\main'))
    # With no LOCALAPPDATA, as off Windows, it is Where.ps1's answer rather
    # than a null path (#2903).
    $env:LOCALAPPDATA = $null
    try {
        $platformDev = Join-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Thornswood') 'feed\dev'
        Yes 'with no LOCALAPPDATA the dev working folder is in the platform''s folder for this machine''s data (#2903)' ((Get-FeedStoreDir 'dev') -eq $platformDev)
    } finally { $env:LOCALAPPDATA = $appdata }
    $read = Receive-FeedStore 'dev' $dir -SiteDir $site
    Yes 'both files arrive byte for byte' ((Sha (Join-Path $dir 'version.json')) -eq (Sha (Feed (Join-Path $site 'feed-dev'))) -and
                                          (Sha (Join-Path $dir 'published.json')) -eq (Sha (Join-Path $site 'feed-dev\published.json')))
    $rj = Read-FeedStoreRead $dir
    Yes 'read.json records the sha256 of each as received' ($rj['version.json'] -eq (Sha (Feed (Join-Path $site 'feed-dev'))) -and $rj['published.json'] -eq (Sha (Join-Path $site 'feed-dev\published.json')))
    Yes 'and a copy of each is kept in backup' (@(Get-ChildItem -LiteralPath (Join-Path $dir 'backup') -File).Count -eq 2)
    Yes 'the working folder is not a git repository' (-not (Test-Path -LiteralPath (Join-Path $dir '.git')))

    # ---- 2. send ------------------------------------------------------------
    Write-Host ''; Write-Host 'send'
    Put (Join-Path $dir 'version.json') '{"launcherVersion":"1.1.101.35","packs":[{"id":"x","url":"https://thornswood.net/feed-dev/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}'
    $r = Send-FeedStore 'dev' $dir @('version.json') -SiteDir $site
    Yes 'the new feed is on the site' ((Sha (Feed (Join-Path $site 'feed-dev'))) -eq (Sha (Join-Path $dir 'version.json')))
    Yes 'and the send says it sent it' (@($r.Sent) -contains 'version.json')
    $g = Gens (Join-Path $site 'feed-dev')
    Yes 'it went up as the next generation, and the one before stays as it was' ($g.Count -eq 2 -and $g[1].Name -eq '00000002.json' -and ([IO.File]::ReadAllText($g[0].FullName)) -like '*1.1.101.34*')
    Yes '  and nothing went into history for it' (-not (Test-Path -LiteralPath (Join-Path $site 'feed-dev\history')) -or @(Get-ChildItem -LiteralPath (Join-Path $site 'feed-dev\history') -File -Filter '*-version.json').Count -eq 0)
    Yes 'no .part is left behind' (@(Get-ChildItem -LiteralPath (Join-Path $site 'feed-dev') -Filter '*.part').Count -eq 0)
    Yes 'launchers.txt names the version just published' (@(Get-FeedStoreLaunchers 'dev' -SiteDir $site) -contains '1.1.101.35')
    Yes 'read.json now holds what was sent' ((Read-FeedStoreRead $dir)['version.json'] -eq (Sha (Join-Path $dir 'version.json')))
    $r = Send-FeedStore 'dev' $dir @('version.json') -SiteDir $site
    Yes 'an unchanged file is not sent again, nor made a new generation' (@($r.Sent).Count -eq 0 -and (Gens (Join-Path $site 'feed-dev')).Count -eq 2)
    Put (Join-Path $dir 'published.json') '{"a":"dev baseline after 35"}'
    $r = Send-FeedStore 'dev' $dir @('published.json') -SiteDir $site
    Yes 'the baseline replaces the one up there' ((Sha (Join-Path $site 'feed-dev\published.json')) -eq (Sha (Join-Path $dir 'published.json')))
    Yes '  and the old one is kept in history' (@(Get-ChildItem -LiteralPath (Join-Path $site 'feed-dev\history') -File -Filter '*-published.json').Count -eq 1)
    Put (Join-Path $dir 'version.json') '{"launcherVersion":"1.1.101.35","packs":[{"id":"x","url":"https://thornswood.net/feed-dev/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},{"id":"y","url":"https://thornswood.net/feed-dev/assets/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]}'
    [void](Send-FeedStore 'dev' $dir @('version.json') -SiteDir $site)
    $lv = @(Get-FeedStoreLaunchers 'dev' -SiteDir $site)
    Yes 'a version already in launchers.txt is not written twice' (@($lv | Where-Object { $_ -eq '1.1.101.35' }).Count -eq 1)
    Yes 'main was not touched by any of it' ((Gens (Join-Path $site 'feed')).Count -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $site 'feed\history')))

    # releases.txt that cannot take its line (#2711). The swap added it in a
    # try with an empty catch, so a line that was never written was never said.
    # A folder in its place makes the read throw; the feed still goes out, and
    # the swap says what it could not add.
    $relTxt = Join-Path $site 'feed-dev\releases.txt'
    New-Item -ItemType Directory -Force -Path $relTxt | Out-Null
    Put (Join-Path $dir 'version.json') '{"launcherVersion":"1.1.101.35","packs":[{"id":"x","url":"https://thornswood.net/feed-dev/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},{"id":"y","url":"https://thornswood.net/feed-dev/assets/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}],"release":{"id":"20261018-120000-dev","channel":"dev"}}'
    $said = @(Send-FeedStore 'dev' $dir @('version.json') -SiteDir $site 6>&1)
    $r = @($said | Where-Object { $_ -is [hashtable] })[0]
    $note = (@($said | Where-Object { $_ -isnot [hashtable] } | ForEach-Object { [string]$_ }) -join ' ')
    Yes 'a releases.txt that cannot take its line does not stop a feed that landed' ($null -ne $r -and @($r.Sent) -contains 'version.json' -and (Sha (Feed (Join-Path $site 'feed-dev'))) -eq (Sha (Join-Path $dir 'version.json')))
    Yes '  and the send says which line was not added, and why' ($note -match 'NOTE: the feed went out, but feed-dev\\releases\.txt was not given this release''s line: ' -and $note -match 'Get-FeedStoreReleases will not name this one')
    Remove-Item -LiteralPath $relTxt -Recurse -Force

    # ---- 3. two publishers --------------------------------------------------
    Write-Host ''; Write-Host 'two publishers'
    $mdir = Get-FeedStoreDir 'main'
    [void](Receive-FeedStore 'main' $mdir -SiteDir $site)
    Put (Join-Path $site 'feed\published.json') '{"a":"another machine shipped"}'
    $siteFeed = Sha (Feed (Join-Path $site 'feed'))
    Put (Join-Path $mdir 'version.json') '{"launcherVersion":"1.1.102","packs":[]}'
    $why = Threw { Send-FeedStore 'main' $mdir @('version.json') -SiteDir $site }
    Yes 'a feed send refuses when the baseline moved up there after it was received' ($why -like '*changed on the VPS after this machine read it*' -and $why -like '*published.json*')
    Yes '  and sends nothing' ((Sha (Feed (Join-Path $site 'feed'))) -eq $siteFeed -and (Gens (Join-Path $site 'feed')).Count -eq 1)
    Yes '  and leaves no .part behind' (@(Get-ChildItem -LiteralPath (Join-Path $site 'feed') -Filter '*.part').Count -eq 0)
    [void](Receive-FeedStore 'main' $mdir -SiteDir $site)
    Put-Feed (Join-Path $site 'feed') '{"launcherVersion":"1.1.101","packs":[],"news":[{"title":"server moved"}]}'
    Put (Join-Path $mdir 'published.json') '{"a":"mine"}'
    $why = Threw { Send-FeedStore 'main' $mdir @('published.json') -SiteDir $site }
    Yes 'a baseline send refuses when the feed moved up there' ($why -like '*version.json was*')
    Yes '  and the baseline up there is still the other machine''s' (([IO.File]::ReadAllText((Join-Path $site 'feed\published.json'))) -like '*another machine*')
    $why = Threw { Send-FeedStore 'main' (Join-Path $T 'never') @('version.json') -SiteDir $site }
    Yes 'a folder that was never received cannot send' ($why -like '*never received*')

    # ---- 4. a baseline missing up there ---------------------------------------
    Write-Host ''; Write-Host 'a baseline missing up there'
    Remove-Item -LiteralPath (Join-Path $site 'feed\published.json')
    $read = Receive-FeedStore 'main' $mdir -SiteDir $site
    Yes 'the working copy goes too, so a stale one is never packed against' (-not (Test-Path -LiteralPath (Join-Path $mdir 'published.json')))
    Yes '  kept in backup' (@(Get-ChildItem -LiteralPath (Join-Path $mdir 'backup') -Filter '*-gone-published.json').Count -eq 1)
    Yes '  and read.json says it is absent' ((Read-FeedStoreRead $mdir)['published.json'] -eq '')
    Put (Join-Path $mdir 'published.json') '{"a":"first"}'
    [void](Send-FeedStore 'main' $mdir @('published.json') -SiteDir $site)
    Yes 'a first baseline can then be sent' ((Sha (Join-Path $site 'feed\published.json')) -eq (Sha (Join-Path $mdir 'published.json')))

    # ---- 5. a short part ---------------------------------------------------------
    Write-Host ''; Write-Host 'a short part'
    $before = Sha (Feed (Join-Path $site 'feed'))
    $had = (Gens (Join-Path $site 'feed')).Count
    Put (Join-Path $site 'feed\version.json.part') '{"trunc'
    $lines = @(Invoke-FeedStoreOp 'main' 'swap' @('version.json') @{ 'version.json' = $before } @{ 'version.json' = 999 } $site $null)
    Yes 'a .part shorter than what was sent is refused' (@($lines | Where-Object { $_ -like 'SHORT|version.json*' }).Count -eq 1)
    Yes '  sending nothing and deleting the .part' ((Sha (Feed (Join-Path $site 'feed'))) -eq $before -and (Gens (Join-Path $site 'feed')).Count -eq $had -and -not (Test-Path -LiteralPath (Join-Path $site 'feed\version.json.part')))

    # ---- 6. what the site serves -------------------------------------------------
    Write-Host ''; Write-Host 'what the site serves'
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host 'SKIP  node is not on PATH, so the copy of the site was not started'
    } else {
        Copy-SiteProgram -To $site -App (Join-Path $repo 'site')
        $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0); $l.Start(); $port = $l.LocalEndpoint.Port; $l.Stop()
        # The game check knocks on port 1 (#1816). The system never hands that port
        # out for a listen on 0 and no harness listens on a fixed port
        # (test-1703-test-ports.js), so no run beside this one can take it and make
        # the game read as up. A port taken from the system and let go could be.
        Put (Join-Path $site 'config.json') (@{
            password = ''; secret = ([Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')); botKey = ''; gameCheckPort = 1
            onlineFile = (Join-Path $site 'online.json')
            discord = @{ clientId = ''; clientSecret = ''; botToken = ''; guildId = ''; invite = '' }
        } | ConvertTo-Json -Depth 4)
        $asset = ('c' * 64)
        Put (Join-Path $site "feed\assets\$asset") 'an asset'
        Put (Join-Path $site 'feed\version.json.part') 'half a feed'
        Put (Join-Path $site 'feed\read.json') '{}'
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $node.Source
        $psi.Arguments = '"server.js"'
        $psi.WorkingDirectory = $site
        $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
        $psi.EnvironmentVariables['THORNSWOOD_DOCS_PORT'] = [string]$port
        $psi.EnvironmentVariables['THORNSWOOD_DOCS_LOCAL'] = '1'
        $psi.EnvironmentVariables['THORNSWOOD_CHAT_DIR'] = (Join-Path $site 'chat')
        $p = [Diagnostics.Process]::Start($psi)
        $pErr = $p.StandardError.ReadToEndAsync()
        $procs += $p
        $base = "http://127.0.0.1:$port"
        function Code([string]$path) {
            try { $r = [Net.HttpWebRequest]::Create($base + $path).GetResponse(); $c = [int]$r.StatusCode; $r.Close(); return $c }
            catch [Net.WebException] { if ($null -ne $_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }; return 0 }
        }
        $why = Wait-OwnLine $p $pErr '[thornswood-docs]' $port 'the site'
        Yes 'a scratch copy of site\server.js starts on the stand-in folder' ($why -eq '')
        if ($why) { Write-Host "      $why" }
        Yes '  /feed/version.json answers 200' ((Code '/feed/version.json') -eq 200)
        Yes '  and an asset answers 200' ((Code "/feed/assets/$asset") -eq 200)
        $histName = @(Get-ChildItem -LiteralPath (Join-Path $site 'feed-dev\history') -File)[0].Name
        foreach ($path in '/feed/published.json', '/feed-dev/published.json', '/feed/launchers.txt', '/feed-dev/launchers.txt',
                          '/feed/history/', "/feed-dev/history/$histName", '/feed/version.json.part', '/feed/read.json',
                          '/feed/version/00000001.json', '/feed/version/',
                          '/feed/../feed/published.json', '/feed/%2e%2e/feed/published.json', '/feed/assets/../published.json',
                          '/feed/published.json%00', '/feed-dev/history') {
            Yes "  $path answers 404" ((Code $path) -eq 404)
        }
        $doc = Read-SiteFeed 'main' -SiteUrl $base
        Yes 'Read-SiteFeed reads the live feed over http from the site' ($null -ne $doc -and $doc.launcherVersion -eq '1.1.101')
        $doc = Read-SiteFeed 'dev' -SiteDir $site
        Yes 'and from the stand-in folder' ($null -ne $doc -and $doc.launcherVersion -eq '1.1.101.35')
        Remove-Item -LiteralPath (Join-Path $site 'feed\version.json.part'), (Join-Path $site 'feed\read.json') -Force
    }

    # ---- 7. the one-off move from the clones -------------------------------------
    Write-Host ''; Write-Host 'Move-FeedStore-ToVps.ps1'
    $move = Join-Path $repo 'scripts\oneoff\Move-FeedStore-ToVps.ps1'
    Yes 'scripts\oneoff\Move-FeedStore-ToVps.ps1 is there' (Test-Path -LiteralPath $move)
    $site2 = Join-Path $T 'site2'
    $bare = Join-Path $T 'Thornswood-Releases.git'
    $mainClone = Join-Path $T 'Thornswood-Releases'
    $devClone = Join-Path $T 'Thornswood-Releases-dev'
    $bundles = Join-Path $T 'bundles'
    function Gq { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & git @args 2>&1 | Out-Null } finally { $ErrorActionPreference = $old } }
    Gq init -q --bare $bare
    Gq clone -q $bare $mainClone
    Gq -C $mainClone config user.email t@example.com
    Gq -C $mainClone config user.name t
    Gq -C $mainClone checkout -q -b main
    foreach ($v in '1.1.99', '1.1.100', '1.1.101') {
        Put (Join-Path $mainClone 'version.json') ('{"launcherVersion":"' + $v + '","packs":[]}')
        Put (Join-Path $mainClone 'published.json') ('{"main":"' + $v + '"}')
        Gq -C $mainClone add -A; Gq -C $mainClone commit -q -m "Update $v"
    }
    Gq -C $mainClone push -q -u origin main
    Gq -C $mainClone worktree add -q -b dev $devClone
    foreach ($v in '1.1.101.1', '1.1.101.2', '1.1.101.3') {
        Put (Join-Path $devClone 'version.json') ('{"launcherVersion":"' + $v + '","packs":[]}')
        Put (Join-Path $devClone 'published.json') ('{"dev":"' + $v + '"}')
        Gq -C $devClone add -A; Gq -C $devClone commit -q -m "Update $v"
    }
    Gq -C $devClone push -q -u origin dev
    # What the last clone-based Ship's remirror left on the site: the feeds, no baseline.
    Put-Feed (Join-Path $site2 'feed') ([IO.File]::ReadAllText((Join-Path $mainClone 'version.json')))
    Put-Feed (Join-Path $site2 'feed-dev') ([IO.File]::ReadAllText((Join-Path $devClone 'version.json')))
    $ps = (Get-Process -Id $PID).Path
    function Run-Move([string[]]$more) {
        $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $move, '-MainClone', $mainClone, '-DevClone', $devClone,
               '-SiteDir', $site2, '-BundleDir', $bundles) + $more
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = (@(& $ps @a 2>&1) | ForEach-Object { [string]$_ }) -join "`n"; $c = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
        return [pscustomobject]@{ Code = $c; Out = $o }
    }
    $m = Run-Move @('-Check')
    Yes ("-Check finishes (exit {0})" -f $m.Code) ($m.Code -eq 0 -and $m.Out -like '*Dry run*')
    Yes '  and sends nothing' (-not (Test-Path -LiteralPath (Join-Path $site2 'feed\published.json')) -and -not (Test-Path -LiteralPath (Join-Path $site2 'feed-dev\published.json')))
    Yes '  nor makes the bundle' (-not (Test-Path -LiteralPath (Join-Path $bundles 'thornswood-releases.bundle')))

    $m = Run-Move @()
    Yes ("the move finishes (exit {0})" -f $m.Code) ($m.Code -eq 0)
    if ($m.Code -ne 0) { Write-Host $m.Out }
    Yes '  main''s baseline on the VPS is byte for byte the clone''s' ((Sha (Join-Path $site2 'feed\published.json')) -eq (Sha (Join-Path $mainClone 'published.json')))
    Yes '  and dev''s' ((Sha (Join-Path $site2 'feed-dev\published.json')) -eq (Sha (Join-Path $devClone 'published.json')))
    Yes '  the feeds were not rewritten' ((Sha (Feed (Join-Path $site2 'feed'))) -eq (Sha (Join-Path $mainClone 'version.json')) -and
                                      (Sha (Feed (Join-Path $site2 'feed-dev'))) -eq (Sha (Join-Path $devClone 'version.json')) -and
                                      (Gens (Join-Path $site2 'feed')).Count -eq 1 -and (Gens (Join-Path $site2 'feed-dev')).Count -eq 1)
    $ld = @(Get-FeedStoreLaunchers 'dev' -SiteDir $site2)
    Yes ('  dev''s launchers.txt has every version its history named, oldest first: ' + ($ld -join ',')) (($ld -join ',') -eq '1.1.99,1.1.100,1.1.101,1.1.101.1,1.1.101.2,1.1.101.3')
    Yes '  and main''s' ((@(Get-FeedStoreLaunchers 'main' -SiteDir $site2) -join ',') -eq '1.1.99,1.1.100,1.1.101')
    Yes '  it says it verified byte for byte' ($m.Out -like '*verified: published.json and version.json byte for byte*')
    $bundle = Join-Path $bundles 'thornswood-releases.bundle'
    Yes '  and the whole history is saved as a bundle' (Test-Path -LiteralPath $bundle)
    $heads = ''
    if (Test-Path -LiteralPath $bundle) { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; $heads = (& git bundle list-heads $bundle 2>$null | Out-String); $ErrorActionPreference = $old }
    Yes '  holding both branches' ($heads -match 'refs/heads/main' -and $heads -match 'refs/heads/dev')

    $was = @((Sha (Join-Path $site2 'feed\published.json')), (Sha (Join-Path $site2 'feed-dev\published.json')))
    $m = Run-Move @()
    $kept = @(Get-ChildItem -LiteralPath (Join-Path $site2 'feed'), (Join-Path $site2 'feed-dev') -Recurse -File -ErrorAction SilentlyContinue |
              Where-Object { $_.DirectoryName -like '*\history' })
    Yes 'run again, it finishes and sends nothing' ($m.Code -eq 0 -and $m.Out -like '*already moved: nothing to send*' -and $kept.Count -eq 0 -and
                                                   (Sha (Join-Path $site2 'feed\published.json')) -eq $was[0] -and (Sha (Join-Path $site2 'feed-dev\published.json')) -eq $was[1])

    Put (Join-Path $site2 'feed\published.json') '{"main":"a Ship on the new store"}'
    $m = Run-Move @('-Channel', 'main')
    Yes 'a baseline already moved on up there is refused, not overwritten' ($m.Code -ne 0 -and $m.Out -like '*already holds a different feed/published.json*' -and
                                                                           ([IO.File]::ReadAllText((Join-Path $site2 'feed\published.json'))) -like '*new store*')
    Remove-Item -LiteralPath (Join-Path $site2 'feed\published.json')
    Put-Feed (Join-Path $site2 'feed') '{"launcherVersion":"1.1.98"}'
    $m = Run-Move @('-Channel', 'main')
    Yes 'a site feed that is not the clone''s is refused, and says how to put it right' ($m.Code -ne 0 -and $m.Out -like '*different feed/version.json*Remirror-Site-Feed.ps1 -FeedDir*' -and
                                                                                       -not (Test-Path -LiteralPath (Join-Path $site2 'feed\published.json')))
    Put-Feed (Join-Path $site2 'feed') ([IO.File]::ReadAllText((Join-Path $mainClone 'version.json')))
    Put (Join-Path $mainClone 'published.json') '{"main":"not committed"}'
    $m = Run-Move @('-Channel', 'main')
    Yes 'a clone with an uncommitted baseline is refused' ($m.Code -ne 0 -and $m.Out -like '*uncommitted*')
    Gq -C $mainClone commit -q -am 'Baseline never pushed'
    $m = Run-Move @('-Channel', 'main')
    Yes 'a clone with a commit that never reached GitHub is refused' ($m.Code -ne 0 -and $m.Out -like '*never reached GitHub*' -and
                                                                     -not (Test-Path -LiteralPath (Join-Path $site2 'feed\published.json')))
}
finally {
    foreach ($p in $procs) { try { if (-not $p.HasExited) { $p.Kill() } } catch { } }
    $env:LOCALAPPDATA = $oldAppData
    Start-Sleep -Milliseconds 200
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
