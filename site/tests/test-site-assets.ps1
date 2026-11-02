<#
  test-site-assets.ps1

      pwsh .\site\tests\test-site-assets.ps1

  Updates come from thornswood.net, not from Thornswood-Releases (#897). This
  holds the pieces that make that true, against scratch folders and two local
  HTTP servers, and never connects to the VPS, GitHub or the live site:

    a copy of site\server.js, serving a scratch folder as the site's feed root,
      which is where every asset the tests send ends up and what every "is it
      on the site" question is asked of;
    a stand-in for GitHub: /dl/<name> redirects the way a release download
      does, /api/<name> sends JSON unless asked for the bytes the way the
      api.github.com asset address does, and every request is written down.

  What is checked:
    Feed-Rules.ps1: Get-FeedAssets, Test-SiteAsset and Move-FeedUrlsToSite;
    Remirror-Site-Feed.ps1 -Send and a whole remirror, into -SiteDir;
    scripts\oneoff\Copy-ReleaseAssets-ToSite.ps1, -Check and a real run: what
      the site already holds is left alone, what is missing is fetched once,
      from the other channel's folder when it is there, checked against the
      feed's sha256 and sent, bytes that do not match are named and never
      sent, and no version.json is touched;
    Repair-Manifest.ps1 -MoveToSite on a scratch feed;
    Publish-Update.ps1: its site upload block and its move-the-urls block, run
      on their own between their markers, and that site is the default.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $here)
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot '..\..\tests\SiteFiles.ps1')
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    exit $(if ($script:fail) { 1 } else { 0 })
}

$rules    = Join-Path $repo 'scripts\release\Feed-Rules.ps1'
$mirror   = Join-Path $repo 'scripts\deploy\Remirror-Site-Feed.ps1'
$copy     = Join-Path $repo 'scripts\oneoff\Copy-ReleaseAssets-ToSite.ps1'
$repair   = Join-Path $repo 'scripts\release\Repair-Manifest.ps1'
$publish  = Join-Path $repo 'scripts\release\Publish-Update.ps1'
$serverJs = Join-Path $repo 'site\server.js'
foreach ($f in $rules, $mirror, $copy, $repair, $publish, $serverJs) {
    if (-not (Test-Path -LiteralPath $f)) { Yes "$f is there" $false; Done }
}
. $rules
# Get-FeedVersionFile, for the site's feed (its newest generation, #2727).
. (Join-Path $repo 'scripts\release\Feed-Store.ps1')
$ps =(Get-Process -Id $PID).Path
$node = Get-Command node -ErrorAction SilentlyContinue

function ShaOf([byte[]]$b) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return (($h.ComputeHash($b) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
}
function ShaFile([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() }
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllBytes($path, [Text.Encoding]::UTF8.GetBytes($text))
    return (ShaFile $path)
}
function Write-Feed([string]$path, $doc) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, ($doc | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
}
function Read-Feed([string]$path) { return ((Get-Content -LiteralPath $path -Raw) -replace ('^' + [char]0xFEFF), '') | ConvertFrom-Json }
function Free-Port {
    $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $l.Start(); $p = $l.LocalEndpoint.Port; $l.Stop(); return $p
}
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
function Run-Child([string]$script, [string[]]$more) {
    $argv = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $script) + $more
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = (@(& $ps @argv 2>&1) | ForEach-Object { [string]$_ }) -join "`n" } finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}
function Get-Bytes([string]$url) {
    $req = [Net.HttpWebRequest]::Create($url)
    $res = $req.GetResponse()
    try {
        $ms = New-Object IO.MemoryStream
        $res.GetResponseStream().CopyTo($ms)
        return , $ms.ToArray()
    } finally { $res.Close() }
}

# ------------------------------------------------------------ Feed-Rules --
Write-Host ''
Write-Host 'Feed-Rules'
$s1 = 'a' * 64; $s2 = 'b' * 64; $s3 = 'c' * 64; $s4 = 'd' * 64
$gh = 'https://github.com/EvilPatrick06/Thornswood-Releases/releases/download/x'
$doc = [pscustomobject]@{
    launcherVersion = '1.1.101'
    launcherUrl     = "$gh/Thornswood.exe"
    launcherSha256  = $s1.ToUpper()
    clientRuntime   = [pscustomobject]@{ url = "$gh/client.zip"; sha256 = $s2; bytes = 12; forkCommit = 'abc' }
    packs           = @(
        [pscustomobject]@{ id = 'p1'; url = "$gh/pack-p1.zip"; sha256 = $s3 },
        $null,
        [pscustomobject]@{ id = 'p2'; url = "https://thornswood.net/feed/assets/$s4"; sha256 = $s4 },
        [pscustomobject]@{ id = 'p3'; url = ''; sha256 = $s4 },
        [pscustomobject]@{ id = 'p4'; url = "$gh/pack-p4.zip"; sha256 = 'nope' }
    )
    optional        = @([pscustomobject]@{ id = 'o1'; url = "$gh/o1.zip"; sha256 = $s4 })
}
$all = @(Get-FeedAssets $doc)
Yes 'Get-FeedAssets lists launcher, client runtime, packs, optional, in feed order' ((($all | ForEach-Object { $_.What }) -join ',') -eq 'launcher 1.1.101,client runtime abc,pack p1,pack p2,pack p4,optional pack o1')
Yes '  a sha is read in lower case' ($all[0].Sha -eq $s1)
Yes '  the size the feed gives is kept' ($all[1].Bytes -eq 12)
Yes '  a sha that is not one is empty' ($all[4].Sha -eq '')
Yes '  no feed is an empty list' (@(Get-FeedAssets $null).Count -eq 0)

$asked = New-Object System.Collections.ArrayList
$mv = Move-FeedUrlsToSite $doc -OnSite { param($sha, $bytes) [void]$asked.Add("$sha|$bytes"); return ($sha -ne $s3) }
Yes 'Move-FeedUrlsToSite moves the launcher, the client runtime and the optional pack the site holds' ((($mv.Moved | ForEach-Object { $_.What }) -join ',') -eq 'launcher 1.1.101,client runtime abc,optional pack o1')
Yes '  to the live site shape, by sha' ($doc.launcherUrl -eq "https://thornswood.net/feed/assets/$s1" -and $doc.clientRuntime.url -eq "https://thornswood.net/feed/assets/$s2" -and $doc.optional[0].url -eq "https://thornswood.net/feed/assets/$s4")
Yes '  a pack the site does not hold stays on GitHub' ($doc.packs[0].url -eq "$gh/pack-p1.zip")
Yes '  so does one with no sha to name it by' ($doc.packs[4].url -eq "$gh/pack-p4.zip")
Yes '  what stayed is said' ((($mv.Stayed | ForEach-Object { $_.What }) -join ',') -eq 'pack p1,pack p4')
Yes '  only the four GitHub urls with a sha are asked about, not the one already on the site' (@($asked).Count -eq 4)
Yes '  the size is passed to the question' ($asked -contains "$s2|12")
$docDev = [pscustomobject]@{ packs = @([pscustomobject]@{ id = 'd1'; url = "$gh/d1.zip"; sha256 = $s3 }) }
$null = Move-FeedUrlsToSite $docDev -Dev -OnSite { param($sha, $bytes) $true }
Yes '  on the dev channel the url is /feed-dev/' ($docDev.packs[0].url -eq "https://thornswood.net/feed-dev/assets/$s3")
$docErr = [pscustomobject]@{ packs = @([pscustomobject]@{ id = 'e1'; url = "$gh/e1.zip"; sha256 = $s3 }) }
$null = Move-FeedUrlsToSite $docErr -OnSite { param($sha, $bytes) throw 'no answer' }
Yes '  a question that throws leaves the url alone' ($docErr.packs[0].url -eq "$gh/e1.zip")
Yes 'Test-SiteAsset refuses a sha that is not one, without asking' (-not (Test-SiteAsset 'http://127.0.0.1:1' 'feed' 'xyz' 0))
Yes 'Test-SiteAsset is false when nothing answers' (-not (Test-SiteAsset 'http://127.0.0.1:1' 'feed' $s1 0))

# ------------------------------------------------------- the two servers --
if (-not $node) {
    Write-Host 'SKIP  node is not on PATH, so the site and GitHub stand-ins were not started'
    Done
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-site-assets-' + [Guid]::NewGuid().ToString('N'))
$siteDir = Join-Path $work 'site'
$ghDir   = Join-Path $work 'gh\files'
$cache   = Join-Path $work 'cache'
New-Item -ItemType Directory -Force -Path $siteDir, $ghDir, $cache | Out-Null
$procs = @()
try {
    Copy-SiteProgram -To $siteDir -App (Join-Path $repo 'site')
    $secret = ShaOf ([Text.Encoding]::UTF8.GetBytes([Guid]::NewGuid().ToString()))
    $sitePort = Free-Port
    # The game check knocks on port 1 (#1816). The system never hands that port
    # out for a listen on 0 and no harness listens on a fixed port
    # (test-1703-test-ports.js), so no run beside this one can take it and make
    # the game read as up. A port taken from the system and let go could be.
    [IO.File]::WriteAllText((Join-Path $siteDir 'config.json'), (@{
        password = ''; secret = $secret; botKey = ''; gameCheckPort = 1
        onlineFile = (Join-Path $siteDir 'online.json')
        discord = @{ clientId = ''; clientSecret = ''; botToken = ''; guildId = ''; invite = '' }
    } | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))

    $ghJs = Join-Path $work 'gh\gh.js'
    [IO.File]::WriteAllText($ghJs, @'
const http = require('http'), fs = require('fs'), path = require('path');
const dir = process.argv[2], port = Number(process.argv[3]), log = process.argv[4];
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  fs.appendFileSync(log, req.method + ' ' + u + ' ' + (req.headers.accept || '') + '\n');
  let m = u.match(/^\/dl\/([\w.-]+)$/);
  if (m) { res.writeHead(302, { location: '/cdn/' + m[1] }); return res.end(); }
  m = u.match(/^\/api\/([\w.-]+)$/);
  if (m) {
    if (String(req.headers.accept || '').indexOf('application/octet-stream') < 0) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ name: m[1], note: 'metadata, not the bytes' }));
    }
    res.writeHead(302, { location: '/cdn/' + m[1] }); return res.end();
  }
  m = u.match(/^\/cdn\/([\w.-]+)$/);
  if (m) {
    const f = path.join(dir, m[1]);
    if (fs.existsSync(f)) {
      const b = fs.readFileSync(f);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': b.length });
      return res.end(req.method === 'HEAD' ? undefined : b);
    }
  }
  res.writeHead(404); res.end('no');
}).listen(port, '127.0.0.1', () => console.log('[github] listening on 127.0.0.1:' + port));
'@, (New-Object Text.UTF8Encoding($false)))
    $ghPort = Free-Port
    $ghLog = Join-Path $work 'gh\requests.txt'
    [IO.File]::WriteAllText($ghLog, '')

    function Start-Node([string]$cwd, [string[]]$argv, [hashtable]$envs) {
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $node.Source
        $psi.Arguments = (($argv | ForEach-Object { '"' + $_ + '"' }) -join ' ')
        $psi.WorkingDirectory = $cwd
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        foreach ($k in $envs.Keys) { $psi.EnvironmentVariables[$k] = $envs[$k] }
        $p = [Diagnostics.Process]::Start($psi)
        # Errors drained now; the output is read by Wait-OwnLine up to the
        # child's listening line and drained from there, so a chatty server
        # never blocks on a full pipe.
        $script:errOf[$p.Id] = $p.StandardError.ReadToEndAsync()
        return $p
    }
    $script:errOf = @{}
    $siteProc = Start-Node $siteDir @('server.js') @{ THORNSWOOD_DOCS_PORT = [string]$sitePort; THORNSWOOD_DOCS_LOCAL = '1'; THORNSWOOD_CHAT_DIR = (Join-Path $siteDir 'chat') }
    $procs += $siteProc
    $ghProc = Start-Node (Split-Path -Parent $ghJs) @($ghJs, $ghDir, [string]$ghPort, $ghLog) @{}
    $procs += $ghProc
    $site = "http://127.0.0.1:$sitePort"
    $ghBase = "http://127.0.0.1:$ghPort"
    $why = Wait-OwnLine $siteProc $script:errOf[$siteProc.Id] '[thornswood-docs]' $sitePort 'the site'
    Yes 'a scratch copy of the site starts' ($why -eq '')
    if ($why) { Write-Host "      $why" }
    $why = Wait-OwnLine $ghProc $script:errOf[$ghProc.Id] '[github]' $ghPort 'the GitHub stand-in'
    Yes 'and so does the GitHub stand-in' ($why -eq '')
    if ($why) { Write-Host "      $why" }

    # ---------------------------------------------------------- the feeds --
    # main: the launcher by the api shape, a pack already on the site, a pack by
    # the download shape, the client runtime with its size.
    # dev: the pack main already has on the site (its GitHub address answers
    # 404, so it can only come from /feed/), a pack whose bytes on GitHub are
    # not the ones the feed names, and a dev pack.
    $shaExe   = Put (Join-Path $ghDir 'Thornswood.exe') 'the launcher'
    $shaOld   = Put (Join-Path $siteDir ('feed\assets\' + (ShaOf ([Text.Encoding]::UTF8.GetBytes('pack old'))))) 'pack old'
    $shaB     = Put (Join-Path $ghDir 'pack-B.zip') 'pack B'
    $shaCli   = Put (Join-Path $ghDir 'client.zip') 'client runtime'
    $cliBytes = (Get-Item -LiteralPath (Join-Path $ghDir 'client.zip')).Length
    $null     = Put (Join-Path $ghDir 'pack-C.zip') 'pack C, but not the bytes the feed names'
    $shaC     = ShaOf ([Text.Encoding]::UTF8.GetBytes('pack C as published'))
    $shaD     = Put (Join-Path $ghDir 'pack-D.zip') 'pack D dev'

    $mainFeed = [pscustomobject]@{
        launcherVersion = '1.1.101'; launcherUrl = "$ghBase/api/Thornswood.exe"; launcherSha256 = $shaExe
        clientRuntime = [pscustomobject]@{ url = "$ghBase/dl/client.zip"; sha256 = $shaCli; bytes = $cliBytes; forkCommit = 'f00d' }
        packs = @(
            [pscustomobject]@{ id = 'old'; url = "$ghBase/api/gone-old.zip"; sha256 = $shaOld; notes = 'n' },
            [pscustomobject]@{ id = 'B'; url = "$ghBase/dl/pack-B.zip"; sha256 = $shaB; notes = 'n' })
        updateRepo = 'EvilPatrick06/Thornswood-Releases'
    }
    $devFeed = [pscustomobject]@{
        launcherVersion = '1.1.101'; launcherUrl = "$ghBase/api/Thornswood.exe"; launcherSha256 = $shaExe
        packs = @(
            [pscustomobject]@{ id = 'old'; url = "$ghBase/api/gone-old.zip"; sha256 = $shaOld; notes = 'n' },
            [pscustomobject]@{ id = 'C'; url = "$ghBase/dl/pack-C.zip"; sha256 = $shaC; notes = 'n' },
            [pscustomobject]@{ id = 'D-dev'; url = "$ghBase/dl/pack-D.zip"; sha256 = $shaD; notes = 'n' })
        updateRepo = 'EvilPatrick06/Thornswood-Releases'
    }
    # The site keeps each feed as write-once generations, version\<8 digits>.json
    # in its channel's folder, the newest being the feed (#2727). Each starts
    # with one; a feed untouched is still that one, with the same bytes.
    $mainDir  = Join-Path $siteDir 'feed'
    $devDir   = Join-Path $siteDir 'feed-dev'
    $mainJson = Join-Path $mainDir 'version\00000001.json'
    $devJson  = Join-Path $devDir 'version\00000001.json'
    Write-Feed $mainJson $mainFeed
    Write-Feed $devJson $devFeed
    $mainWas = ShaFile $mainJson
    $devWas  = ShaFile $devJson
    function Feed-Is([string]$dir, [string]$file, [string]$sha) { return ((Get-FeedVersionFile $dir) -eq $file -and (ShaFile $file) -eq $sha) }

    Yes 'Test-SiteAsset: the site answers for a pack it holds' (Test-SiteAsset $site 'feed' $shaOld 0)
    Yes '  and not with the wrong size' (-not (Test-SiteAsset $site 'feed' $shaOld 999))
    Yes '  and not in the other channel''s folder' (-not (Test-SiteAsset $site 'feed-dev' $shaOld 0))

    # -------------------------------------------------- the copy, dry run --
    Write-Host ''
    Write-Host 'Copy-ReleaseAssets-ToSite.ps1'
    $common = @('-SiteUrl', $site, '-SiteDir', $siteDir, '-Cache', $cache)
    $r = Run-Child $copy (@('-Check') + $common)
    Yes ("-Check finishes (exit {0})" -f $r.Code) ($r.Code -eq 0)
    Yes '  main: 4 named, 1 already on the site, 3 to copy' ($r.Out -match '4 asset\(s\) named, 1 already on the site, 3 to copy')
    Yes '  dev: 4 named, 0 already on the site, 4 to copy' ($r.Out -match '4 asset\(s\) named, 0 already on the site, 4 to copy')
    Yes '  and nothing was fetched or sent' ((@(Get-ChildItem -LiteralPath $cache -File).Count -eq 0) -and -not (Test-Path -LiteralPath (Join-Path $siteDir 'feed-dev\assets')))
    Yes '  and GitHub was not asked for a byte' (-not ((Get-Content -LiteralPath $ghLog -Raw) -match '/cdn/'))

    # ------------------------------------------------------- the copy, real --
    $r = Run-Child $copy $common
    Yes ("a real run stops with exit 1, because one pack's bytes are wrong (exit {0})" -f $r.Code) ($r.Code -eq 1)
    $mainAssets = Join-Path $siteDir 'feed\assets'
    $devAssets  = Join-Path $siteDir 'feed-dev\assets'
    Yes '  main: the launcher, pack B and the client runtime are on the site under their sha256' (
        (Test-Path (Join-Path $mainAssets $shaExe)) -and (Test-Path (Join-Path $mainAssets $shaB)) -and (Test-Path (Join-Path $mainAssets $shaCli)))
    Yes '  dev: the launcher, the old pack and the dev pack are on the site' (
        (Test-Path (Join-Path $devAssets $shaExe)) -and (Test-Path (Join-Path $devAssets $shaOld)) -and (Test-Path (Join-Path $devAssets $shaD)))
    Yes '  the pack whose bytes do not match is not sent' (-not (Test-Path (Join-Path $devAssets $shaC)))
    Yes '  and is named, with where the bytes came from' ($r.Out -match 'pack C: the bytes at .*pack-C\.zip do not match')
    Yes '  no .part file is left on the site' (@(Get-ChildItem -LiteralPath $mainAssets, $devAssets -Filter '*.part').Count -eq 0)
    Yes '  the api address was asked for the bytes, not the metadata' ((Get-Content -LiteralPath $ghLog -Raw) -match 'GET /api/Thornswood\.exe application/octet-stream')
    Yes '  the launcher was fetched from GitHub once, for both channels' (@((Get-Content -LiteralPath $ghLog) | Where-Object { $_ -match '^GET /cdn/Thornswood\.exe' }).Count -eq 1)
    Yes '  the old pack came from the site''s /feed/, never from its dead GitHub address' (-not ((Get-Content -LiteralPath $ghLog -Raw) -match 'gone-old'))
    Yes '  neither version.json was touched' ((Feed-Is $mainDir $mainJson $mainWas) -and (Feed-Is $devDir $devJson $devWas))
    $served = Get-Bytes "$site/feed-dev/assets/$shaD"
    Yes '  the site serves what was sent, and it hashes to its name' ((ShaOf $served) -eq $shaD)

    $before = (Get-Content -LiteralPath $ghLog).Count
    $r = Run-Child $copy $common
    Yes 'run again, only the bad pack is left to copy' ($r.Out -match '4 asset\(s\) named, 3 already on the site, 1 to copy' -and $r.Out -match '4 asset\(s\) named, 4 already on the site, 0 to copy')
    Yes '  and nothing that is already there is fetched again' (@((Get-Content -LiteralPath $ghLog) | Select-Object -Skip $before | Where-Object { $_ -match '^GET /cdn/' -and $_ -notmatch 'pack-C' }).Count -eq 0)

    # -------------------------------------------------- Repair -MoveToSite --
    Write-Host ''
    Write-Host 'Repair-Manifest.ps1 -MoveToSite'
    $feedCopy = Join-Path $work 'releases-dev'
    Write-Feed (Join-Path $feedCopy 'version.json') $devFeed
    $copyWas = ShaFile (Join-Path $feedCopy 'version.json')
    $r = Run-Child $repair @('-RepoDir', $feedCopy, '-Channel', 'dev', '-MoveToSite', '-DryRun', '-SiteUrl', $site, '-NoPause')
    Yes ("-DryRun finishes (exit {0})" -f $r.Code) ($r.Code -eq 0)
    Yes '  3 would move and the bad pack is named as staying' ($r.Out -match '3 url\(s\) move to the site' -and $r.Out -match 'pack C')
    Yes '  and nothing was written' ((ShaFile (Join-Path $feedCopy 'version.json')) -eq $copyWas)
    $r = Run-Child $repair @('-RepoDir', $feedCopy, '-Channel', 'dev', '-MoveToSite', '-NoPush', '-SiteUrl', $site, '-NoPause')
    $moved = Read-Feed (Join-Path $feedCopy 'version.json')
    Yes ("a real move finishes (exit {0})" -f $r.Code) ($r.Code -eq 0)
    Yes '  the launcher and both packs the site holds now name /feed-dev/' (
        $moved.launcherUrl -eq "https://thornswood.net/feed-dev/assets/$shaExe" -and
        $moved.packs[0].url -eq "https://thornswood.net/feed-dev/assets/$shaOld" -and
        $moved.packs[2].url -eq "https://thornswood.net/feed-dev/assets/$shaD")
    Yes '  the pack the site does not hold stays where it was' ($moved.packs[1].url -eq "$ghBase/dl/pack-C.zip")
    Yes '  pack order, ids, notes and the rest are kept' ((($moved.packs | ForEach-Object { $_.id }) -join ',') -eq 'old,C,D-dev' -and $moved.updateRepo -eq 'EvilPatrick06/Thornswood-Releases')
    $raw = [IO.File]::ReadAllBytes((Join-Path $feedCopy 'version.json'))
    Yes '  written with no byte order mark' (-not ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB))
    Yes '  and, told not to send, it says so' ($r.Out -match 'Not pushed, as asked')

    # ----------------------------------------------- the remirror, whole --
    Write-Host ''
    Write-Host 'Remirror-Site-Feed.ps1'
    $r = Run-Child $mirror @('-Dev', '-FeedDir', $feedCopy, '-SiteDir', $siteDir)
    Yes ("a remirror into the scratch site finishes (exit {0})" -f $r.Code) ($r.Code -eq 0)
    Yes '  it counts the one still named off the site' ($r.Out -match '3 asset\(s\) named on the site, 1 still named somewhere else')
    $servedFeed = [Text.Encoding]::UTF8.GetString((Get-Bytes "$site/feed-dev/version.json"))
    Yes '  and the site now serves the moved feed' ($servedFeed -eq [IO.File]::ReadAllText((Join-Path $feedCopy 'version.json')))
    Yes '  the live feed folder was not touched' (Feed-Is $mainDir $mainJson $mainWas)

    # A feed naming a site asset nobody holds is refused, and version.json stays.
    $holey = Join-Path $work 'holey'
    $gone = 'e' * 64
    Write-Feed (Join-Path $holey 'version.json') ([pscustomobject]@{ launcherVersion = '9'; packs = @([pscustomobject]@{ id = 'x'; url = "https://thornswood.net/feed-dev/assets/$gone"; sha256 = $gone }) })
    $servedFile = Get-FeedVersionFile $devDir
    $servedWas = ShaFile $servedFile
    $r = Run-Child $mirror @('-Dev', '-FeedDir', $holey, '-SiteDir', $siteDir, '-AssetDir', (Join-Path $work 'nothing-here'))
    Yes ("a feed naming bytes nobody has is refused (exit {0})" -f $r.Code) ($r.Code -eq 1)
    Yes '  and the site keeps the feed it had' (Feed-Is $devDir $servedFile $servedWas)

    $one = Join-Path $work 'one.zip'
    $shaOne = Put $one 'sent on its own'
    $r = Run-Child $mirror @('-Send', $one, '-SiteDir', $siteDir)
    Yes ("-Send puts one file up under its sha256 (exit {0})" -f $r.Code) ($r.Code -eq 0 -and (Test-Path (Join-Path $mainAssets $shaOne)))
    Yes '  and says version.json was not touched' ($r.Out -match 'version\.json was not touched' -and (Feed-Is $mainDir $mainJson $mainWas))
    $r = Run-Child $mirror @('-Send', $one, '-SiteDir', $siteDir)
    Yes '  sent twice, the second time it is already there' ($r.Code -eq 0 -and $r.Out -match 'already there')
    $r = Run-Child $mirror @('-Send', (Join-Path $work 'no-such.zip'), '-SiteDir', $siteDir)
    Yes '  a file that is not there stops it with exit 1' ($r.Code -eq 1)

    # ---------------------------------------------- Publish-Update blocks --
    Write-Host ''
    Write-Host 'Publish-Update.ps1'
    $src = [IO.File]::ReadAllText($publish)
    function Block([string]$name) {
        $a = $src.IndexOf("# ==== thornswood $name ====")
        $b = $src.IndexOf("# ==== end thornswood $name ====")
        if ($a -lt 0 -or $b -le $a) { return '' }
        return $src.Substring($a, $b - $a)
    }
    $up = Block 'site upload'
    $mvBlock = Block 'move feed urls'
    Yes 'the site upload block is between its markers' ($up -ne '')
    Yes 'the move-the-urls block is between its markers' ($mvBlock -ne '')
    Yes 'the site is the only place downloads go: no -AssetHost, no GitHub release (#907)' (-not $src.Contains('$AssetHost') -and -not $src.Contains('gh release'))
    $iUp = $src.IndexOf('# ==== thornswood site upload ====')
    $iMove = $src.IndexOf('# ==== thornswood move feed urls ====')
    $iPull = $src.IndexOf('# ==== thornswood feed recheck ====')
    $iAppend = $src.IndexOf('# ==== thornswood feed append ====')
    $iSecrets = $src.IndexOf("Check-Secrets.ps1')")
    Yes 'the secret scan runs before anything goes to the site' ($iSecrets -ge 0 -and $iUp -gt $iSecrets)
    Yes 'the urls move after the feed is checked again on the VPS and before packs are added' ($iPull -ge 0 -and $iMove -gt $iPull -and $iAppend -gt $iMove)

    # The upload block with what Publish-Update has by then.
    function Run-Upload($chunksIn, [bool]$launcherIn, [string]$exeIn, $clientIn, [string]$siteDirIn, [bool]$goneIn = $false) {
        $script:said = @()
        function Say($m, $c = 'Gray') { $script:said += [string]$m }
        function Head($m) { $script:said += [string]$m }
        function Die($m) { throw ('DIE ' + $m) }
        $Here = Join-Path $repo 'scripts\release'
        $Dev = $false
        # What the packs gone block decided (#1050).
        $packsGone = $goneIn
        $chunks = $chunksIn; $Launcher = $launcherIn; $exePath = $exeIn; $clientRel = $clientIn; $SiteDir = $siteDirIn
        $exeUrl = ''
        try { Invoke-Expression $up } catch { return [pscustomobject]@{ R = $_.Exception.Message } }
        return [pscustomobject]@{ R = 'ok'; Exe = $exeUrl; Chunks = $chunks; Client = $clientRel }
    }
    $pk = Join-Path $work 'pub\pack-N1.zip'; $pkSha = Put $pk 'new pack N1'
    $ex = Join-Path $work 'pub\Thornswood.exe'; $exSha = Put $ex 'new launcher'
    $cz = Join-Path $work 'pub\client-runtime-beef.zip'; $czSha = Put $cz 'new client'
    $pubSite = Join-Path $work 'pubsite'
    $res = Run-Upload @([pscustomobject]@{ Id = 'N1'; Path = $pk; Sha = $pkSha; Url = '' }) $true $ex ([pscustomobject]@{ name = 'c.zip'; path = $cz; sha256 = $czSha; url = '' }) $pubSite
    Yes ("the upload block runs ({0})" -f $res.R) ($res.R -eq 'ok')
    Yes '  the pack and the client runtime are on the site' (
        (Test-Path (Join-Path $pubSite "feed\assets\$pkSha")) -and (Test-Path (Join-Path $pubSite "feed\assets\$czSha")))
    Yes '  and no launcher, even with one built beside it: a publish sends none (#4825)' (
        -not (Test-Path (Join-Path $pubSite "feed\assets\$exSha")) -and -not $res.Exe)
    Yes '  and the feed will name them there' (
        $res.Chunks[0].Url -eq "https://thornswood.net/feed/assets/$pkSha" -and
        $res.Client.url -eq "https://thornswood.net/feed/assets/$czSha")
    Yes '  and nothing went to GitHub' (-not (($script:said -join "`n") -match 'gh release'))
    $res = Run-Upload @([pscustomobject]@{ Id = 'N2'; Path = (Join-Path $work 'pub\missing.zip'); Sha = ('f' * 64); Url = '' }) $false '' $null $pubSite
    Yes '  an asset that does not land stops it before version.json' ($res.R -like 'DIE *version.json has not been touched*')
    # Once the packs are off the feed (#1050) the pack is not sent: nothing names it.
    $pk3 = Join-Path $work 'pub\pack-N3.zip'; $pk3Sha = Put $pk3 'new pack N3, kept here'
    $ex3 = Join-Path $work 'pub\Thornswood3.exe'; $ex3Sha = Put $ex3 'newer launcher'
    $goneSite = Join-Path $work 'gonesite'
    $res = Run-Upload @([pscustomobject]@{ Id = 'N3'; Path = $pk3; Sha = $pk3Sha; Url = '' }) $true $ex3 $null $goneSite $true
    Yes ("with the packs gone the upload block runs ({0})" -f $res.R) ($res.R -eq 'ok')
    Yes '  and neither the launcher nor the pack goes to the site, and the pack has no url' (
        -not (Test-Path (Join-Path $goneSite "feed\assets\$ex3Sha")) -and -not (Test-Path (Join-Path $goneSite "feed\assets\$pk3Sha")) -and -not $res.Chunks[0].Url)

    # The move block with a pulled feed and the scratch site to ask.
    function Run-Move($docIn, [bool]$devIn, [bool]$noUploadIn) {
        $script:said = @()
        function Say($m, $c = 'Gray') { $script:said += [string]$m }
        $NoUpload = $noUploadIn; $Dev = $devIn; $SiteUrl = $site; $doc = $docIn
        Invoke-Expression $mvBlock
        return $doc
    }
    $pulled = [pscustomobject]@{
        launcherUrl = "$gh/Thornswood.exe"; launcherSha256 = $shaExe
        packs = @([pscustomobject]@{ id = 'B'; url = "$gh/pack-B.zip"; sha256 = $shaB }, [pscustomobject]@{ id = 'Z'; url = "$gh/pack-Z.zip"; sha256 = ('9' * 64) })
    }
    $after = Run-Move $pulled $false $false
    Yes 'a publish moves the urls the site holds' ($after.launcherUrl -eq "https://thornswood.net/feed/assets/$shaExe" -and $after.packs[0].url -eq "https://thornswood.net/feed/assets/$shaB")
    Yes '  leaves the one it does not' ($after.packs[1].url -eq "$gh/pack-Z.zip")
    Yes '  and says what is left and what puts it up' ((($script:said -join "`n") -match 'still point off the site') -and (($script:said -join "`n") -match 'Remirror-Site-Feed\.ps1 -Send'))
    $untouched = [pscustomobject]@{ packs = @([pscustomobject]@{ id = 'B'; url = "$gh/pack-B.zip"; sha256 = $shaB }) }
    $after = Run-Move $untouched $false $true
    Yes '  a dry run (-NoUpload) moves nothing' ($after.packs[0].url -eq "$gh/pack-B.zip")
}
finally {
    foreach ($p in $procs) { try { if (-not $p.HasExited) { $p.Kill() }; $p.WaitForExit(3000) | Out-Null } catch { } }
    Start-Sleep -Milliseconds 200
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
