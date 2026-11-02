<#
  test-2727-feed-swap-readers.ps1

      pwsh -NoProfile -File .\tests\test-2727-feed-swap-readers.ps1

  Issue #2727. On 18 Oct a build on a VPS runner stopped the real
  Publish-Update.ps1 with NOT SHIPPED: version.json "could not be replaced
  by version.json.part: Access is denied". MoveFileEx(REPLACE_EXISTING) is
  refused while ANY handle is open on the file it replaces, even a stat, so
  the store's rename became one with POSIX semantics (FileRenameInfoEx),
  which a reader holding the file with share-delete does not stop.

  Then the runners showed what no rename gives: a name that is always
  there. Measured 19 Oct on the box (Windows Server 2022) with 6 swappers
  and 6 readers for 10 s a run: the POSIX rename left 363 to 4791 opens of
  about 300k finding nothing, MoveFileEx 801 to 4127, a replacing hard link
  up to 1487; One showed it too, less often. site\server.js opens the feed
  for every launcher's check, every /watch tick and every join pass, so a
  request that landed in a Ship's swap found no feed.

  So version.json is never replaced. Each feed sent is a new file,
  <channel>\version\<8 digits>.json, one past the newest, and none is ever
  replaced or deleted; the site and the store read the newest.

  WHAT IT HOLDS IT TO.
    1. Feed-Store.ps1 sends version.json as a new generation with a rename
       that refuses a name already there, never over the one before; the
       generations block goes up with every script the box runs; the rename
       the other store files still use is FileRenameInfoEx with POSIX
       semantics, and every read in the box's script shares delete.
       site\server.js reads the feed only through feedFile, the newest
       generation, in the feed route, the watch, the join pass, the credits
       and the most-online fallback.
    2. In this shell, PowerShell 7, which the VPS runs the store's script
       with since #5356: a reader holding a file open with share-delete does
       not stop the POSIX rename and keeps the old bytes; a holder without
       share-delete is refused and the file stays whole; and the real send
       (Receive-FeedStore, then Send-FeedStore on a stand-in -SiteDir) lands
       as a new generation while a reader holds the one before open, which
       is untouched.
    3. node reading the feed the way site\server.js does (feedFile lifted
       from it, then statSync and readFileSync) from before this shell makes
       its first new generation the way the store's script does until after
       its 300th: the reader never found it missing or failed to read it,
       and it saw the feed move on while it read. The reader reads once
       before it says it is reading and once more after this shell says it
       is done, so both ends of the run are inside its reads whatever the
       runner's load (#2888's run on 20 Oct: a reader that read a fixed 2000
       times finished before the first new generation and saw only one).

  -Repo runs it against another checkout's scripts (for the code before the
  fix). Nothing outside its own temp folder is written.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}
function Text([string]$p) { return ([IO.File]::ReadAllText($p) -replace "`r`n", "`n") }

$storePs1 = Join-Path $Repo 'scripts\release\Feed-Store.ps1'
$serverJs = Join-Path $Repo 'site\server.js'
Yes 'scripts\release\Feed-Store.ps1 and site\server.js are there' ((Test-Path -LiteralPath $storePs1) -and (Test-Path -LiteralPath $serverJs))
if (-not (Test-Path -LiteralPath $storePs1) -or -not (Test-Path -LiteralPath $serverJs)) { Done }

# ---- 1: the store and the site ------------------------------------------------------
$store = Text $storePs1
$swap = [regex]::Match($store, "(?s)\`$script:FeedStoreSwap = @'\n(.*?)\n'@").Groups[1].Value
$gens = [regex]::Match($store, "(?s)\`$script:FeedStoreGenerations = @'\n(.*?)\n'@").Groups[1].Value
$body = [regex]::Match($store, "(?s)\`$script:FeedStoreBody = @'\n(.*?)\n'@").Groups[1].Value
$feedSend = [regex]::Match($body, "(?s)if \(\`$n -eq 'version\.json'\) \{\n      # A new generation.*?\n    \} else \{").Value
Yes 'Feed-Store: version.json goes up as the next generation, renamed to a name that is not there yet' (
    $feedSend -match 'Get-FeedVersionNext \$dir' -and $feedSend -match '\[IO\.File\]::Move\(')
Yes '...and never over the one before' ($feedSend -and $feedSend -notmatch 'Move-FeedStoreInto')
Yes '...the newest generation is the feed, numbered in eight digits' (
    $gens -match "'\^\\d\{8\}\\\.json\$'" -and $gens -match 'Sort-Object Name \| Select-Object -Last 1' -and $gens -match "'\{0:D8\}\.json'")
Yes '...the box''s script carries the generations block' ($store -match '\$script:FeedStoreSwap \+ "`r`n" \+ \$script:FeedStoreGenerations \+ "`r`n" \+ \$script:FeedStoreBody')
Yes '...the other store files still go in with FileRenameInfoEx, replacing, with POSIX semantics' (
    $swap -match 'SetFileInformationByHandle\(h, FileRenameInfoEx, info' -and $swap -match 'const int FileRenameInfoEx = 22;' -and
    $swap -match 'const int Flags = 0x1 \| 0x2;' -and $swap -notmatch 'MoveFileEx' -and $body -match 'Move-FeedStoreInto \$part \$p')
Yes '...and every read of a store file in the box''s script shares delete' (
    $body -match '\[IO\.FileShare\]::ReadWrite -bor \[IO\.FileShare\]::Delete' -and
    $body -notmatch '\[IO\.File\]::(OpenRead|ReadAllText|ReadAllBytes|ReadAllLines|Open)\(')

# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
$server = (Get-SiteSource (Join-Path $Repo 'site')) -replace "`r`n", "`n"
Yes 'site\server.js: the feed route, the watch and the join pass read the newest generation (feedFile)' (
    $server -match "const file = feedFile\(feedVer\[1\]\);" -and $server -match 'const file = feedFile\(channel\);' -and
    $server -match 'const file = feedFile\(dir\);')
Yes '...and so do the credits and the most-online fallback' (
    $server -match 'const f = feedFile\(pair\[1\]\);' -and $server -match "\[MOST_ONLINE_RECORD, feedFile\('feed'\)\]")
Yes '...and nothing in it opens a feed''s version.json by that name any more' (
    $server -notmatch "path\.join\([^)]*'version\.json'\)")

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-2727-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
$oldAppData = $env:LOCALAPPDATA
$reader = $null
try {
    # ---- 2: held open, in this shell, the box's PowerShell 7 --------------------------
    # One script: it prints one line a check, OK or NO and what it saw.
    $held = Join-Path $work 'held.ps1'
    [IO.File]::WriteAllText($held, @'
param($store, $dir)
$ErrorActionPreference = 'Stop'
. $store
$share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
function Say([string]$name, [bool]$ok, [string]$saw) { ($(if ($ok) { 'OK ' } else { 'NO ' }) + $name + ' | ' + $saw) }
function Swap($from, $to) { try { Move-FeedStoreInto $from $to; return '' } catch { return [string]$_.Exception.Message } }

# a. a reader with share-delete, as node opens it
$to = Join-Path $dir 'a\published.json'; $part = $to + '.part'
$null = New-Item -ItemType Directory -Force -Path (Split-Path $to)
[IO.File]::WriteAllText($to, '{"base":"old"}'); [IO.File]::WriteAllText($part, '{"base":"new one"}')
$h = New-Object IO.FileStream($to, [IO.FileMode]::Open, [IO.FileAccess]::Read, $share)
$err = Swap $part $to
$r = New-Object IO.StreamReader($h); $was = $r.ReadToEnd(); $r.Dispose()
$now = [IO.File]::ReadAllText($to)
Say 'shared' ($err -eq '' -and $was -eq '{"base":"old"}' -and $now -eq '{"base":"new one"}' -and -not (Test-Path -LiteralPath $part)) ("error '" + $err + "', the reader read " + $was + ", the name reads " + $now)

# b. a holder without share-delete
$to = Join-Path $dir 'b\published.json'; $part = $to + '.part'
$null = New-Item -ItemType Directory -Force -Path (Split-Path $to)
[IO.File]::WriteAllText($to, '{"base":"old"}'); [IO.File]::WriteAllText($part, '{"base":"new one"}')
$h = New-Object IO.FileStream($to, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
$err = Swap $part $to
$h.Dispose()
$now = [IO.File]::ReadAllText($to)
Say 'unshared' ($err -match 'being used by another process' -and $now -eq '{"base":"old"}' -and (Test-Path -LiteralPath $part)) ("error '" + $err + "', the name reads " + $now)

# c. the real send on a stand-in site, a reader holding the newest generation
$site = Join-Path $dir 'site'
$gens = Join-Path $site 'feed\version'
$null = New-Item -ItemType Directory -Force -Path $gens
$first = Join-Path $gens '00000001.json'
[IO.File]::WriteAllText($first, '{"launcherVersion":"1.0.1","packs":[]}')
[IO.File]::WriteAllText((Join-Path $site 'feed\published.json'), '{}')
$wd = Join-Path $dir 'working'
$err = ''
$sent = @()
try {
    [void](Receive-FeedStore 'main' $wd @('version.json', 'published.json') -SiteDir $site)
    [IO.File]::WriteAllText((Join-Path $wd 'version.json'), '{"launcherVersion":"1.0.2","packs":[]}')
    $h = New-Object IO.FileStream($first, [IO.FileMode]::Open, [IO.FileAccess]::Read, $share)
    try { $sent = @((Send-FeedStore 'main' $wd @('version.json') -SiteDir $site).Sent) } finally { $h.Dispose() }
} catch { $err = [string]$_.Exception.Message }
$names = @(Get-ChildItem -LiteralPath $gens -File | ForEach-Object { $_.Name }) -join ','
$was = [IO.File]::ReadAllText($first)
$now = (Read-SiteFeed 'main' -SiteDir $site).launcherVersion
Say 'send' ($err -eq '' -and $sent -contains 'version.json' -and $names -eq '00000001.json,00000002.json' -and $was -eq '{"launcherVersion":"1.0.1","packs":[]}' -and $now -eq '1.0.2') ("error '" + $err + "', sent " + ($sent -join ',') + ", generations " + $names + ", the first reads " + $was + ", the feed is now " + $now)
'@, (New-Object Text.UTF8Encoding($false)))

    $env:LOCALAPPDATA = Join-Path $work 'appdata'
    $shells = @(@{ Name = ('this shell, PowerShell ' + $PSVersionTable.PSVersion.ToString()); Run = { param($d) & $held $storePs1 $d } })
    . (Join-Path $PSScriptRoot 'Windows.ps1')
    $k = 0
    foreach ($s in $shells) {
        $k++
        $d = Join-Path $work ('held-' + $k)
        $null = New-Item -ItemType Directory -Force -Path $d
        $out = @(& $s.Run $d | ForEach-Object { [string]$_ })
        function Line([string]$name) { return @($out | Where-Object { $_ -match ('^(OK|NO) ' + $name + ' \|') }) }
        $a = @(Line 'shared'); $b = @(Line 'unshared'); $c = @(Line 'send')
        $why = { param($l) if ($l.Count) { ' (' + ($l[0] -replace '^(OK|NO) \S+ \| ', '') + ')' } else { ' (no answer: ' + (($out | Select-Object -Last 2) -join ' ') + ')' } }
        Yes ("$($s.Name): a reader with share-delete open on a store file does not stop the POSIX rename; it reads the old bytes, the name the new" + (& $why $a)) ($a.Count -eq 1 -and $a[0].StartsWith('OK '))
        # Share modes are Windows': off Windows an open file refuses no rename,
        # so there is no refusal to see. The box, where the store runs, is Windows.
        if ($OnWindows) { Yes ("$($s.Name): a holder without share-delete is refused, and the file stays the old one, whole" + (& $why $b)) ($b.Count -eq 1 -and $b[0].StartsWith('OK ')) }
        else { Write-Host "SKIP  $($s.Name): a holder without share-delete is refused: share modes are Windows', and off Windows an open file refuses no rename" }
        Yes ("$($s.Name): the real send lands as the next generation while a reader holds the one before, which stays as it was" + (& $why $c)) ($c.Count -eq 1 -and $c[0].StartsWith('OK '))
    }
    $env:LOCALAPPDATA = $oldAppData

    # ---- 3: beside the site's own reads ------------------------------------------------
    $node = Get-Command node -ErrorAction SilentlyContinue
    Yes 'node is on PATH, for the site''s reads' ($null -ne $node)
    if ($null -eq $node) { Done }
    . $storePs1

    # feedFile and what it needs, lifted out of site\server.js, then the feed
    # route's statSync and readFileSync, over and over until this shell has
    # made its new generations the way the store's script does and says so.
    $loopJs = Join-Path $work 'reads.js'
    [IO.File]::WriteAllText($loopJs, @'
const fs = require('fs');
const path = require('path');
const [serverJs, ROOT, done] = process.argv.slice(2);
const src = fs.readFileSync(serverJs, 'utf8').split(String.fromCharCode(13)).join('');
const from = src.indexOf('const feedNewest = {};');
const head = src.indexOf('function feedFile(', from);
let end = src.indexOf('{', head), d = 0;
for (; end < src.length; end++) { if (src[end] === '{') d++; else if (src[end] === '}') { d--; if (d === 0) { end++; break; } } }
if (from < 0 || head < 0) { console.log('no feedFile in server.js'); process.exit(1); }
eval(src.slice(from, end));
let passes = 0, missing = 0, other = 0; const said = {}; const seen = new Set();
function read() {
  try {
    const file = feedFile('feed');
    if (!file) { missing++; return; }
    fs.statSync(file); fs.readFileSync(file); passes++; seen.add(path.basename(file));
  } catch (e) {
    if (e.code === 'ENOENT') missing++; else { other++; const k = e.code + ' ' + e.syscall; said[k] = (said[k] || 0) + 1; }
  }
}
// One read before the shell starts, then until it says it is done, then one
// more: the first and the last generation are both read whatever the load.
read();
console.log('reading');
while (!fs.existsSync(done)) read();
read();
console.log('passes ' + passes + ' missing ' + missing + ' other ' + other + ' generations ' + seen.size + (other ? ' ' + JSON.stringify(said) : ''));
'@, (New-Object Text.UTF8Encoding($false)))
    $root = Join-Path $work 'race'
    $chan = Join-Path $root 'feed'
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $chan 'version')
    $doc = '{"launcherVersion":"1.0.1","news":"' + ('x' * 90000) + '"}'
    [IO.File]::WriteAllText((Join-Path $chan 'version\00000001.json'), $doc)
    $psi = New-Object Diagnostics.ProcessStartInfo
    $doneFile = Join-Path $work 'writer-done'
    # The whole site as one text (#5357), for the reader to lift feedFile from.
    $siteText = Join-Path $work 'site-source.js'
    [IO.File]::WriteAllText($siteText, (Get-SiteSource (Join-Path $Repo 'site')), (New-Object Text.UTF8Encoding($false)))
    $psi.FileName = $node.Source; $psi.Arguments = '"' + $loopJs + '" "' + $siteText + '" "' + $root + '" "' + $doneFile + '"'
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true
    $reader = [Diagnostics.Process]::Start($psi)
    $first = $reader.StandardOutput.ReadLineAsync()
    $started = $first.Wait(15000) -and $first.Result -eq 'reading'
    Yes ("the node reader is reading" + $(if (-not $started -and $first.IsCompleted) { ' (' + $first.Result + ')' } else { '' })) $started
    if (-not $started) { Done }
    # The store's step for version.json: the whole file as version.json.part,
    # then renamed to the next generation (Feed-Store.ps1's swap op).
    $last = $reader.StandardOutput.ReadToEndAsync()
    $refused = 0; $said = ''; $made = 0
    $part = Join-Path $chan 'version.json.part'
    while ($made -lt 300) {
        [IO.File]::WriteAllText($part, $doc)
        try { [IO.File]::Move($part, (Join-Path (Join-Path $chan 'version') (Get-FeedVersionNext $chan))) }
        catch { $refused++; if (-not $said) { $said = $_.Exception.Message } }
        $made++
    }
    [IO.File]::WriteAllText($doneFile, 'done')
    $null = $reader.WaitForExit(30000)
    $tally = [regex]::Match([string]$last.Result, 'passes (\d+) missing (\d+) other (\d+) generations (\d+)')
    Yes ("{0} new generations while node read the feed the way server.js serves it: none refused ({1} refused{2})" -f $made, $refused, $(if ($said) { ', first: ' + $said } else { '' })) ($refused -eq 0)
    Yes ("...and the reader never found it missing or failed to read it ({0})" -f $(if ($tally.Success) { ([string]$last.Result).Trim() } else { 'no tally: ' + [string]$last.Result })) (
        $tally.Success -and $tally.Groups[2].Value -eq '0' -and $tally.Groups[3].Value -eq '0')
    Yes '...and it saw the feed move on while it read' ($tally.Success -and [int]$tally.Groups[4].Value -gt 1)
}
finally {
    $env:LOCALAPPDATA = $oldAppData
    if ($reader) { try { if (-not $reader.HasExited) { $reader.Kill() } } catch { Write-Host "NOTE  the node reader could not be stopped: $($_.Exception.Message)" } }
    try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop } catch { Write-Host "NOTE  $work could not be removed: $($_.Exception.Message)" }
}

Done
