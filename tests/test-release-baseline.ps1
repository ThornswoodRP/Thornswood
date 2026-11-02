<#
  test-release-baseline.ps1

  A release is diffed against what the feed last published, by the bytes of
  each file, not against one machine's memory of file times (#441).

  WHY THIS EXISTS. published.json recorded '<size>:<file time>' for every file
  of ours. Since #907 it lives on the VPS so every machine reads the same one,
  but the same bytes on another machine, after a reinstall, or rewritten in
  place (hotfix 1.1.93 re-sent 21 unchanged files, 12.5 MB) still read as
  changed, and a missing baseline left only -Baseline, which records this
  build as published whatever the feed holds. scripts\release\Release-Baseline.ps1
  is the fix; this drives it and the real Publish-Update.ps1:

    1. entries: '<size>:<sha256>', the same for the same bytes whatever the
       file time; an old size and time entry still compares as it did
    2. the record: sorted ASCII JSON, byte for byte the same from two machines,
       from two runs and from Windows PowerShell and PowerShell 7; odd names
       read back as they were
    3. what a release is diffed against, against a scratch folder standing in
       for the site (-SiteDir): the store copy when it is the one the feed
       names; the feed's record when the store copy is missing or stale; the
       packs, replayed in order with their delete.txt, when the record cannot
       be read or the feed names none; the store copy when the feed names none
    4. the same over http, from a scratch copy of site\server.js
    5. the release manifest block, lifted out of Publish-Update.ps1: it writes
       the same bytes Save-State does, sends them to the site by sha256, and
       names them in the feed only when they were sent, before the feed is
       written
    6. the real Publish-Update.ps1 in a child PowerShell, -NoUpload -NoPush,
       against a made up install: another machine (same bytes, other file
       times) with no store baseline finds nothing to do; a file whose bytes
       changed under the same size and time is found; a stale store copy loses
       to the feed; an old size and time baseline still says nothing to do;
       -Baseline is refused when the feed names its record

  Nothing here connects to anything but 127.0.0.1, and everything it writes is
  in its own temp folder.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
# Publish-Update names no box of its own, so the guard reads THORNSWOOD_VPS.
$env:THORNSWOOD_HARNESS = '1'
$env:THORNSWOOD_VPS = 'harness.invalid'
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

$lib = Join-Path $repo 'scripts\release\Release-Baseline.ps1'
Yes 'scripts\release\Release-Baseline.ps1 is there' (Test-Path -LiteralPath $lib)
if (-not (Test-Path -LiteralPath $lib)) { Done }
. $lib
. (Join-Path $repo 'scripts\release\Feed-Store.ps1')

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-release-baseline-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Threw([scriptblock]$b) { try { & $b | Out-Null; return '' } catch { return $_.Exception.Message } }
function Same($a, $b) {
    if ($a.Count -ne $b.Count) { return $false }
    foreach ($k in $a.Keys) { if (-not $b.ContainsKey($k) -or [string]$b[$k] -ne [string]$a[$k]) { return $false } }
    return $true
}
# A pack the way Publish-Update builds one: game/<path> entries and delete.txt.
Add-Type -AssemblyName System.IO.Compression.FileSystem
function New-Pack([string]$path, [hashtable]$files, [string[]]$deletes) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    $z = [IO.Compression.ZipFile]::Open($path, 'Create')
    try {
        if ($deletes) {
            $w = New-Object IO.StreamWriter ($z.CreateEntry('delete.txt').Open())
            foreach ($d in $deletes) { $w.WriteLine($d.Replace('\', '/')) }
            $w.Dispose()
        }
        foreach ($k in $files.Keys) {
            $w = New-Object IO.StreamWriter ($z.CreateEntry('game/' + $k.Replace('\', '/')).Open())
            $w.Write([string]$files[$k]); $w.Dispose()
        }
        $w = New-Object IO.StreamWriter ($z.CreateEntry('profile/plugins.txt').Open()); $w.Write("*a.esp`r`n"); $w.Dispose()
    } finally { $z.Dispose() }
}
# Puts a file on the stand-in site under its sha256, the way Remirror does.
function Put-Asset([string]$site, [string]$prefix, [string]$file) {
    $sha = Get-BaselineFileSha $file
    $to = Join-Path $site "$prefix\assets\$sha"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
    Copy-Item -LiteralPath $file -Destination $to -Force
    return $sha
}
function Url([string]$prefix, [string]$sha) { return "https://thornswood.net/$prefix/assets/$sha" }
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
    New-Item -ItemType Directory -Force -Path $T | Out-Null

    # ---- 1. entries -------------------------------------------------------------
    Write-Host ''; Write-Host 'entries'
    $a = Join-Path $T 'one\Data\a.esp'; $b = Join-Path $T 'two\Data\a.esp'
    Put $a 'the same bytes'; Put $b 'the same bytes'
    [IO.File]::SetLastWriteTimeUtc($a, [datetime]'2026-09-01T10:00:00Z')
    [IO.File]::SetLastWriteTimeUtc($b, [datetime]'2026-09-27T22:13:07Z')
    $ea = Get-BaselineEntry $a; $eb = Get-BaselineEntry $b
    Yes "an entry is the size and the sha256 of the bytes ($ea)" ($ea -match '^14:[0-9a-f]{64}$')
    Yes 'the same bytes under another file time are the same entry' ($ea -eq $eb)
    Put $b 'other bytes!!!'; [IO.File]::SetLastWriteTimeUtc($b, [datetime]'2026-09-01T10:00:00Z')
    Yes 'other bytes of the same size and file time are another entry' ((Get-BaselineEntry $b) -ne $ea)
    $fa = Get-Item -LiteralPath $a
    $legacy = ('{0}:{1}' -f $fa.Length, $fa.LastWriteTimeUtc.Ticks)
    Yes 'an old size and time entry is recognised' (Test-BaselineLegacy $legacy)
    Yes '  and a hash entry is not' (-not (Test-BaselineLegacy $ea))
    Yes 'an old entry with the same size and time is the same file' (Test-BaselineSame $legacy $ea $fa)
    Yes '  another time is not' (-not (Test-BaselineSame ('{0}:{1}' -f $fa.Length, ($fa.LastWriteTimeUtc.Ticks + 1)) $ea $fa))
    Yes '  another size is not' (-not (Test-BaselineSame ('{0}:{1}' -f ($fa.Length + 1), $fa.LastWriteTimeUtc.Ticks) $ea $fa))
    Yes 'a hash entry is compared as it is' ((Test-BaselineSame $ea $ea $fa) -and -not (Test-BaselineSame ('14:' + ('0' * 64)) $ea $fa))

    # ---- 2. the record ------------------------------------------------------------
    Write-Host ''; Write-Host 'the record'
    $map = @{ 'Data\b.esp' = '3:' + ('b' * 64); 'Data\a.esp' = $ea; 'Data\Q "quoted" it''s.txt' = '1:' + ('c' * 64)
              "Data\na$([char]0xEF)ve.txt" = '2:' + ('d' * 64); ':order:plugins' = ('e' * 64) }
    $f1 = Join-Path $T 'rec\one.json'; $f2 = Join-Path $T 'rec\two.json'
    $s1 = Write-BaselineFile $map $f1
    $copy = @{}; foreach ($k in @($map.Keys | Sort-Object -Descending)) { $copy[$k] = $map[$k] }
    $s2 = Write-BaselineFile $copy $f2
    Yes 'the same map written twice, in any order, is the same bytes' ($s1 -eq $s2 -and $s1 -eq (Get-BaselineFileSha $f2))
    $bytes = [IO.File]::ReadAllBytes($f1)
    Yes '  ASCII only, no byte order mark' (@($bytes | Where-Object { $_ -gt 127 }).Count -eq 0 -and $bytes[0] -eq [byte][char]'{')
    Yes '  keys in ordinal order' ([IO.File]::ReadAllText($f1).IndexOf(':order:plugins') -lt [IO.File]::ReadAllText($f1).IndexOf('Data\\a.esp'))
    Yes 'odd names read back exactly' (Same $map (Read-BaselineFile $f1))
    $others = @()
    foreach ($exe in 'powershell', 'pwsh') { $c = Get-Command $exe -ErrorAction SilentlyContinue; if ($c) { $others += $c.Source } }
    $script1 = Join-Path $T 'rec\write.ps1'
    Put $script1 ('. ''' + $lib.Replace("'", "''") + '''' + "`r`n" +
                  '$m = Read-BaselineFile $args[0]; [void](Write-BaselineFile $m $args[1]); Get-BaselineFileSha $args[1]')
    foreach ($exe in $others) {
        $out = Join-Path $T ('rec\' + [IO.Path]::GetFileNameWithoutExtension($exe) + '.json')
        $got = (& $exe -NoProfile -ExecutionPolicy Bypass -File $script1 $f1 $out | Out-String).Trim()
        Yes ("{0} writes the same bytes" -f [IO.Path]::GetFileName($exe)) ($got -eq $s1)
    }

    # ---- 3. what a release is diffed against ---------------------------------
    Write-Host ''; Write-Host 'what a release is diffed against'
    $site = Join-Path $T 'site'
    $rel = Join-Path $T 'rel'
    $work = Join-Path $T 'work'
    New-Item -ItemType Directory -Force -Path $rel, $work | Out-Null
    $vf = Join-Path $rel 'version.json'; $sf = Join-Path $rel 'published.json'
    # Two releases' worth of packs: the first adds a and b, the second changes
    # b, removes a and adds c.
    $p1 = Join-Path $T 'packs\p1.zip'; $p2 = Join-Path $T 'packs\p2.zip'
    New-Pack $p1 @{ 'Data\a.esp' = 'aaa'; 'Data\b.esp' = 'bbb' } @()
    New-Pack $p2 @{ 'Data\b.esp' = 'bbb two'; 'Data\Sub Dir\c.dll' = 'ccc' } @('Data\a.esp', 'Data\never.esp')
    $sha1 = Put-Asset $site 'feed' $p1; $sha2 = Put-Asset $site 'feed' $p2
    $packs = @(@{ id = 'p1'; url = (Url 'feed' $sha1); sha256 = $sha1 }, @{ id = 'p2'; url = (Url 'feed' $sha2); sha256 = $sha2 })
    function Entry-Of([string]$text) {
        $p = Join-Path $T 'entry.tmp'; [IO.File]::WriteAllText($p, $text, $utf8); $e = Get-BaselineEntry $p; Remove-Item -LiteralPath $p; return $e
    }
    $replayWant = @{ 'Data\b.esp' = (Entry-Of 'bbb two'); 'Data\Sub Dir\c.dll' = (Entry-Of 'ccc') }
    # The record of the last release, on the site.
    $last = @{ 'Data\b.esp' = (Entry-Of 'bbb two'); 'Data\Sub Dir\c.dll' = (Entry-Of 'ccc'); 'Data\installer-only.esp' = '9:' + ('9' * 64) }
    $recFile = Join-Path $T 'last.json'
    $recSha = Write-BaselineFile $last $recFile
    [void](Put-Asset $site 'feed' $recFile)
    function Feed([bool]$pointer, [bool]$withPacks) {
        # Assigned rather than put through $( ): Windows PowerShell turns an
        # empty array out of a subexpression into nothing, and the feed into {}.
        $d = [ordered]@{ launcherVersion = '1.1.102'; packs = @() }
        if ($withPacks) { $d['packs'] = $packs }
        if ($pointer) { $d['baseline'] = [ordered]@{ id = 'p2'; sha256 = $recSha; url = (Url 'feed' $recSha); entries = $last.Count } }
        Put $vf ($d | ConvertTo-Json -Depth 5)
    }
    function Resolve { return (Resolve-ReleaseBaseline $vf $sf $work $site) }

    Feed $true $true; Copy-Item -LiteralPath $recFile -Destination $sf -Force
    $r = Resolve
    Yes 'the store copy is used when it is the record the feed names' ($r.From -eq 'store' -and (Same $last $r.Map))

    Remove-Item -LiteralPath $sf
    $r = Resolve
    Yes 'with no store copy, the record the feed names is read from the site' ($r.From -eq 'feed' -and (Same $last $r.Map))
    Yes '  and says so' ((@($r.Lines) -join ' ') -like '*store has no baseline*')
    Yes '  leaving nothing behind in the work folder' (@(Get-ChildItem -LiteralPath $work -File).Count -eq 0)

    [void](Write-BaselineFile @{ 'Data\b.esp' = 'stale' } $sf)
    $r = Resolve
    Yes 'a stale store copy loses to the record the feed names' ($r.From -eq 'feed' -and (Same $last $r.Map))
    Yes '  and says so' ((@($r.Lines) -join ' ') -like '*not the one the feed*')

    $recAsset = Join-Path $site "feed\assets\$recSha"
    $good = [IO.File]::ReadAllBytes($recAsset)
    [IO.File]::WriteAllText($recAsset, '{"Data\\b.esp":"tampered"}')
    $r = Resolve
    Yes 'a record whose bytes are not its sha256 is refused, and the packs are replayed instead' ($r.From -eq 'packs' -and (Same $replayWant $r.Map))
    Remove-Item -LiteralPath $recAsset
    $r = Resolve
    Yes 'so is a record missing from the site' ($r.From -eq 'packs' -and (Same $replayWant $r.Map))
    [IO.File]::WriteAllBytes($recAsset, $good)

    Feed $false $true; [void](Write-BaselineFile @{ 'Data\x.esp' = '1:' + ('1' * 64) } $sf)
    $r = Resolve
    Yes 'a feed that names no record uses the store copy, as before' ($r.From -eq 'store-no-pointer' -and $r.Map.Count -eq 1 -and $r.Map.ContainsKey('Data\x.esp'))
    Remove-Item -LiteralPath $sf
    $r = Resolve
    Yes 'with neither, the feed''s packs are replayed in order: changed, removed and added' ($r.From -eq 'packs' -and (Same $replayWant $r.Map))
    Yes '  holding game files only, no plugin list key' (-not (@($r.Map.Keys) | Where-Object { $_ -like ':*' }))
    Yes '  and the pack downloads are cleaned up' (@(Get-ChildItem -LiteralPath $work -File).Count -eq 0)
    Feed $false $false
    Yes 'with neither and no packs it stops rather than guess' ((Threw { Resolve }) -like '*no packs*')
    Put $vf '{"packs":[],"baseline":{"id":"x"}}'
    Yes 'a record the feed names without a sha256 is refused' ((Threw { Resolve }) -like '*without a sha256*')
    Put $vf ('{"packs":[],"baseline":{"id":"x","sha256":"' + $recSha + '","url":"https://github.com/x/y/releases/download/a/b.json"}}')
    Yes 'a record off the site is not fetched, and with no packs it stops' ((Threw { Resolve }) -like '*no packs*')

    # ---- 4. over http ---------------------------------------------------------------
    Write-Host ''; Write-Host 'over http'
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
        $why = Wait-OwnLine $p $pErr '[thornswood-docs]' $port 'the site'
        $up = $false
        if (-not $why) {
            try { $q = [Net.HttpWebRequest]::Create("$base/feed/assets/$recSha").GetResponse(); $q.Close(); $up = $true } catch { $why = 'the site said it was listening and then did not serve the record: ' + $_.Exception.Message }
        }
        Yes 'a scratch copy of site\server.js serves the stand-in folder' $up
        if ($why) { Write-Host "      $why" }
        Feed $true $true
        if (Test-Path -LiteralPath $sf) { Remove-Item -LiteralPath $sf }
        $r = Resolve-ReleaseBaseline $vf $sf $work '' $base
        Yes 'the record the feed names is fetched over http and checked' ($r.From -eq 'feed' -and (Same $last $r.Map))
        Feed $false $true
        $r = Resolve-ReleaseBaseline $vf $sf $work '' $base
        Yes 'and the packs are replayed over http' ($r.From -eq 'packs' -and (Same $replayWant $r.Map))
    }

    # ---- 5. the release manifest block ------------------------------------------
    Write-Host ''; Write-Host 'the release manifest block'
    $pu = Join-Path $repo 'scripts\release\Publish-Update.ps1'
    $src = [IO.File]::ReadAllText($pu)
    $m = [regex]::Match($src, '(?s)# ==== thornswood release manifest ====.*?# ==== end thornswood release manifest ====')
    Yes 'the release manifest block is in Publish-Update.ps1' $m.Success
    $iMan = $src.IndexOf('# ==== thornswood release manifest ====')
    $iUp = $src.IndexOf('# ==== end thornswood site upload ====')
    $iSet = $src.IndexOf("Set-Prop `$doc 'baseline' `$releaseBaseline")
    $iWrite = $src.IndexOf('Write-FeedVersionFile $VersionFile')
    $iSend = $src.IndexOf("Send-FeedStore `$Channel `$ReleaseDir `$feedFiles")
    Yes 'it runs after the packs are on the site and before the feed is written or sent' ($iUp -gt 0 -and $iMan -gt $iUp -and $iSet -gt $iMan -and $iWrite -gt $iSet -and $iSend -gt $iWrite)
    Yes 'Save-State writes the store copy with the same writer' ($src -match '(?s)function Save-State \{\s+\[void\]\(Write-BaselineFile \$now \$StateFile\)')
    Yes 'the scan records bytes, not file times' ($src -match '\$now\[\$rel\] = Get-BaselineEntry \$f\.FullName' -and $src -notmatch 'LastWriteTimeUtc\.Ticks\)')
    if ($m.Success) {
        . (Join-Path $repo 'scripts\release\Feed-Rules.ps1')
        function Say($x, $c) { }
        function Die($x) { throw "DIE $x" }
        $site5 = Join-Path $T 'site5'
        New-Item -ItemType Directory -Force -Path (Join-Path $site5 'feed'), (Join-Path $site5 'feed-dev') | Out-Null
        $block = $m.Value
        function Run-Manifest([bool]$noUpload, [bool]$dev, [string]$notes = "Keys open their own doors`n- A house key opens the house it is named for.") {
            $Here = Join-Path $repo 'scripts\release'
            $DistDir = Join-Path $T 'dist5'
            New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
            $now = $last; $Id = '20260928-2200'; $NoUpload = $noUpload; $Dev = $dev; $SiteDir = $site5; $Notes = $notes
            Invoke-Expression $block
            return [pscustomobject]@{ Pointer = $releaseBaseline; Path = $manifestPath; Sha = $manifestSha }
        }
        $r = Run-Manifest $true $false
        Yes '-NoUpload writes the record here and names nothing in the feed' ((Test-Path -LiteralPath $r.Path) -and $null -eq $r.Pointer -and
                                                                           -not (Test-Path -LiteralPath (Join-Path $site5 "feed\assets\$($r.Sha)")))
        Yes '  the same bytes Save-State and the last release''s record are' ($r.Sha -eq $recSha)
        $r = Run-Manifest $false $false
        Yes 'otherwise it is sent to the site under its sha256' ((Get-BaselineFileSha (Join-Path $site5 "feed\assets\$($r.Sha)")) -eq $r.Sha)
        Yes '  and the feed names it there, with its id and entry count' ($null -ne $r.Pointer -and $r.Pointer.url -eq (Url 'feed' $r.Sha) -and
                                                                      $r.Pointer.sha256 -eq $r.Sha -and $r.Pointer.id -eq '20260928-2200' -and $r.Pointer.entries -eq $last.Count)
        Yes '  with the release note''s title, which the update card shows once no pack carries it (#1050)' (
            $null -ne $r.Pointer -and $r.Pointer.PSObject.Properties['notes'] -and $r.Pointer.notes -ceq 'Keys open their own doors')
        $r = Run-Manifest $false $true
        Yes 'a dev release sends it to /feed-dev/' ($null -ne $r.Pointer -and $r.Pointer.url -eq (Url 'feed-dev' $r.Sha) -and (Test-Path -LiteralPath (Join-Path $site5 "feed-dev\assets\$($r.Sha)")))
        $r = Run-Manifest $false $false ''
        Yes 'a release with no note names no notes field' ($null -ne $r.Pointer -and -not $r.Pointer.PSObject.Properties['notes'])
        Remove-Item Function:\Say, Function:\Die
    }

    # ---- 6. the real Publish-Update.ps1 ---------------------------------------------
    Write-Host ''; Write-Host 'the real Publish-Update.ps1'
    $fake = Join-Path $T 'repo'
    # Fresh-Checkout.ps1 too: Publish-Update loads its freshness guard under
    # Stop since #3006, where before a tree without it walked past the guard.
    foreach ($f in 'scripts\release\Publish-Update.ps1', 'scripts\deploy\Fresh-Checkout.ps1', 'scripts\release\Read-JsonFile.ps1', 'scripts\release\RecordShape.ps1', 'scripts\release\RepoPlugins.ps1', 'scripts\release\CollectionRevision.ps1', 'scripts\release\Ship-Rules.ps1', 'scripts\mods\LoadOrder.ps1',
                   'scripts\release\Feed-Store.ps1', 'scripts\release\Feed-Json.ps1', 'scripts\release\Release-Baseline.ps1', 'scripts\release\Release-Name.ps1', 'scripts\release\Source-Notice.ps1',
                   'scripts\release\Dev-News.ps1', 'scripts\deploy\ServerContent.ps1', 'scripts\deploy\LastPluginRecipe.ps1',
                   'scripts\release\Feed-News.ps1', 'scripts\release\Feed-Rules.ps1', 'scripts\release\Release-Manifest.ps1', 'scripts\release\Sign-OnGitHub.ps1', 'scripts\release\Assert-PublishSigned.ps1', 'scripts\release\ShippedBytes.ps1',
                   'installer\licences\GPL-3.0.txt', 'installer\licences\AGPL-3.0.txt',
                   'scripts\release\Where.ps1', 'records\client-build.json', 'records\client-licences.json', 'records\client-licences', 'records\ui-gone.json', 'records\shipped-not-ours.json',
                   'scripts\mods\Generated.ps1', 'records\generated.json') {
        $to = Join-Path $fake $f
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        if (Test-Path -LiteralPath (Join-Path $repo $f)) { Copy-Item -LiteralPath (Join-Path $repo $f) -Destination $to -Force -Recurse }
    }
    $reqFrom = Join-Path $repo 'game\required-data'
    if (Test-Path -LiteralPath $reqFrom) {
        New-Item -ItemType Directory -Force -Path (Join-Path $fake 'game\required-data') | Out-Null
        Copy-Item -Path (Join-Path $reqFrom '*') -Destination (Join-Path $fake 'game\required-data') -Force
    }
    Put (Join-Path $fake 'scripts\dev\Close-Launcher.ps1') "function Stop-Game { param([string]`$Root) return `$false }`r`nfunction Get-GameProcesses { param([string]`$Root) return @() }`r`n"
    # No signing setup here: the catalog Publish-Update signs (#2163, phase B) is left unsigned, and the stub answers that it passed.
    Put (Join-Path $fake 'scripts\release\Sign-ReleaseCatalog.ps1') "function Invoke-ReleaseCatalogSign { param([string]`$Catalog, [string]`$RepoDir) return '' }`r`n"
    $Shell = (Get-Process -Id $PID).Path
    $inst = Join-Path $T 'install'
    $site6 = Join-Path $T 'site6'
    foreach ($d in 'Game\Data', 'Profile\OwnGame', 'rel', 'dist', 'appdata') { New-Item -ItemType Directory -Force -Path (Join-Path $inst $d) | Out-Null }
    [IO.File]::WriteAllLines((Join-Path $inst 'Profile\OwnGame\files.txt'), @('F|V|1024|638000000000000000|Data\collection.esp'))
    $ours = Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.bsa'
    Put $ours ('x' * 4096)
    Put (Join-Path $inst 'Game\Data\Platform\UI\thornswood-ours.esp') 'plugin'
    Put (Join-Path $inst 'Profile\OwnGame\plugins.txt') "# This fixture enables no additional plugins.`r`n"
    Put (Join-Path $inst 'Profile\OwnGame\loadorder.txt') ''
    . (Join-Path $repo 'tests\fixtures\ui-front.ps1')
    # The collection revision record, and a Vortex on it (#3597).
    . (Join-Path $repo 'tests\fixtures\collection-revision.ps1')
    $roaming = Join-Path $inst 'roaming'
    $null = Install-CollectionRevisionFixture -From $repo -RepoCopy $fake -AppData $roaming
    Install-UiFrontFixture (Join-Path $inst 'Game')
    $rel6 = Join-Path $inst 'rel'
    function Publish([string[]]$extra) {
        $oldA = $env:LOCALAPPDATA; $oldR = $env:APPDATA; $oldE = $ErrorActionPreference
        $env:LOCALAPPDATA = Join-Path $inst 'appdata'
        $env:APPDATA = $roaming
        $ErrorActionPreference = 'Continue'
        try {
            $argv = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $fake 'scripts\release\Publish-Update.ps1'),
                      '-Root', $inst, '-ReleaseDir', $rel6, '-DistRoot', (Join-Path $inst 'dist'), '-SiteDir', $site6,
                      '-NoUpload', '-NoPush', '-NoPause') + @($extra)
            $out = (& $Shell @argv 2>&1 | Out-String); $code = $LASTEXITCODE
        } finally { $env:LOCALAPPDATA = $oldA; $env:APPDATA = $oldR; $ErrorActionPreference = $oldE }
        return [pscustomobject]@{ Code = $code; Out = $out }
    }
    # The child's own words when a case fails, so a failure says why.
    function Said($r, [bool]$ok) { if (-not $ok) { Write-Host (($r.Out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 12) -join "`n") -ForegroundColor DarkGray } }
    function YesR([string]$what, [bool]$cond, $r) { Yes $what $cond; Said $r $cond }
    # Nothing of ours changed. Every release also deletes the paths
    # Ship-Rules deletes from every install by rule, so the run is stopped at
    # the removals gate (-MaxRemovals 0) and nothing else may be removed. The
    # removed count is what this build removed, the rule paths apart (#1012).
    function Nothing($r) {
        $gone = [regex]::Match($r.Out, '(?m)^\s*(\d+) removed')
        return ($r.Out -match '(?m)^\s*0 added or changed' -and $gone.Success -and [int]$gone.Groups[1].Value -eq 0)
    }
    # The site's feed is the newest of its generations; a feed put there is the
    # next one, the way the store sends it (Feed-Store.ps1, #2727).
    function Feed6([string]$json) { Put (Join-Path (Join-Path $site6 'feed\version') (Get-FeedVersionNext (Join-Path $site6 'feed'))) $json; Put (Join-Path $rel6 'version.json') $json }

    # This machine records the build: a feed that names no record, no store
    # copy yet, -Baseline.
    Feed6 '{"packs":[],"news":[]}'
    Put (Join-Path $rel6 'published.json') '{}'
    $r = Publish @('-Baseline')
    $base6 = Join-Path $rel6 'published.json'
    YesR ("-Baseline on a feed that names no record still records the build (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match 'Baseline recorded') $r
    $recorded = Read-BaselineFile $base6
    Yes '  as hashes' ($recorded.Count -ge 2 -and $recorded['Data\Platform\UI\thornswood-ours.bsa'] -eq (Get-BaselineEntry $ours))

    # That record goes on the site and the feed names it, as a release does.
    $rsha = Put-Asset $site6 'feed' $base6
    $feedWith = '{"packs":[],"news":[],"baseline":{"id":"20260928-2100","sha256":"' + $rsha + '","url":"' + (Url 'feed' $rsha) + '","entries":' + $recorded.Count + '}}'
    Feed6 $feedWith
    $storeBefore = Get-BaselineFileSha $base6
    $r = Publish @('-Baseline')
    YesR '-Baseline is refused once the feed names what it published' ($r.Code -eq 1 -and $r.Out -match 'already names what its last release left installed') $r
    Yes '  and records nothing' ((Get-BaselineFileSha $base6) -eq $storeBefore)

    # Another machine: the same bytes, every file time different, and no store
    # copy at all. It is received from the stand-in VPS, which has none.
    foreach ($g in @(Get-ChildItem -LiteralPath (Join-Path $inst 'Game') -Recurse -File)) { [IO.File]::SetLastWriteTimeUtc($g.FullName, [datetime]'2026-09-28T23:59:00Z') }
    Remove-Item -LiteralPath $base6
    $r = Publish @('-MaxRemovals', '0')
    YesR 'another machine with the same bytes and no store baseline has nothing of ours to publish' (Nothing $r) $r
    YesR '  having read the record the feed names from the site' ($r.Out -match 'store has no baseline' -and $r.Out -match 'checked against its sha256') $r

    # A stale store copy on the stand-in VPS: the feed's record wins.
    Put (Join-Path $site6 'feed\published.json') '{"Data\\Platform\\UI\\ours.bsa":"1:1"}'
    $r = Publish @('-MaxRemovals', '0')
    YesR 'a stale store baseline loses to the feed''s record: nothing of ours to publish' ((Nothing $r) -and $r.Out -match 'not the one the feed') $r

    # New bytes under the same size and file time, which the old baseline could not see.
    $t = (Get-Item -LiteralPath $ours).LastWriteTimeUtc
    Put $ours ('y' * 4096); [IO.File]::SetLastWriteTimeUtc($ours, $t)
    $r = Publish @('-MaxReleaseMB', '0')
    YesR 'a file whose bytes changed under the same size and time is in the release' ($r.Out -match '(?m)^\s*1 added or changed' -and $r.Out -match 'ours\.bsa' -and $r.Code -eq 1) $r
    Put $ours ('x' * 4096)

    # An old size and time baseline, and a feed that names no record: nothing
    # to publish, and it says how it compared.
    Feed6 '{"packs":[],"news":[]}'
    $legacyMap = @{}
    foreach ($k in $recorded.Keys) {
        if ($k.StartsWith(':')) { $legacyMap[$k] = $recorded[$k]; continue }
        $fi = Get-Item -LiteralPath (Join-Path (Join-Path $inst 'Game') $k)
        $legacyMap[$k] = ('{0}:{1}' -f $fi.Length, $fi.LastWriteTimeUtc.Ticks)
    }
    [void](Write-BaselineFile $legacyMap $base6)
    Remove-Item -LiteralPath (Join-Path $site6 'feed\published.json') -ErrorAction SilentlyContinue
    $r = Publish @('-MaxRemovals', '0')
    YesR 'an old size and time baseline still finds nothing of ours to publish' ((Nothing $r) -and $r.Out -match 'compared by size and time') $r
}
finally {
    foreach ($p in $procs) { try { if (-not $p.HasExited) { $p.Kill() } } catch { } }
    Start-Sleep -Milliseconds 200
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
