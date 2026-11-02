<#
  Copy-ReleaseAssets-ToSite.ps1

  Puts every download the live feeds name onto the site, once, so launchers can
  be sent to thornswood.net for all of it and Thornswood-Releases can be
  retired (#897).

  WHAT IT DOES, for the main feed and the dev feed:

    1. reads the feed launchers read, https://thornswood.net/feed/version.json
       (and /feed-dev/), and lists every asset it names: the launcher, the
       client runtime, each pack and each optional pack, by sha256
    2. asks the site, with a HEAD request, which of them it already serves at
       /feed[-dev]/assets/<sha256>, and leaves those alone
    3. downloads each of the rest ONCE into a cache folder on this machine,
       from the other channel's folder on the site when it is there (no GitHub
       quota spent) and from the url the feed gives otherwise, and checks the
       bytes against the sha256 in the feed. A file that does not match is
       deleted and named, and never sent.
    4. sends the ones that matched with Remirror-Site-Feed.ps1 -Send, which
       puts each at <sha256>.part and renames it, and skips any already up
    5. asks the site again and says what is there

  WHAT IT NEVER DOES. It never writes a version.json, here or on the site.
  Moving the urls is a publish's job: the next Ship on each channel, or
  .\scripts\release\Repair-Manifest.ps1 -MoveToSite followed by
  .\scripts\deploy\Remirror-Site-Feed.ps1, rewrites every url whose bytes the
  site answers for, and only those. Running it twice sends nothing the first
  run sent.

      .\scripts\oneoff\Copy-ReleaseAssets-ToSite.ps1 -Check    what it would copy
      .\scripts\oneoff\Copy-ReleaseAssets-ToSite.ps1           copy both channels
      .\scripts\oneoff\Copy-ReleaseAssets-ToSite.ps1 -Channel dev

  Measured 28 Sep 2026: 94 distinct assets across both feeds, 532,163,762
  bytes. The site already held 75 of main's 77 and 69 of dev's 93.

  Needs the VPS ssh key for the send (scripts\vps\Setup-SshKey.ps1 -Test); the
  reads are plain https. -SiteUrl and -SiteDir point it at a copy of the site
  on this machine, which is what site\tests\test-site-assets.ps1 does.
#>
[CmdletBinding()]
param(
    [ValidateSet('main', 'dev', 'both')][string]$Channel = 'both',
    # Where the feeds are read and the assets are asked about.
    [string]$SiteUrl = 'https://thornswood.net',
    # Where the downloads wait between GitHub and the site. Each file is named
    # by its sha256, so a second run reuses what the first one fetched.
    [string]$Cache,
    # Say what it would copy and copy nothing.
    [switch]$Check,
    # Passed to Remirror-Site-Feed.ps1: a folder standing in for the site's
    # feed root, so nothing connects to the VPS. For the tests.
    [string]$SiteDir,
    [string]$Vps = '',
    [string]$User = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\release\Feed-Rules.ps1')
. (Join-Path $Here '..\release\Feed-Json.ps1')   # Join-FeedSettings: the site's feed whole (#1050)
$remirror = Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan }

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

if (-not $Cache) {
    $out = ''
    try { $out = & (Join-Path $Here '..\release\Where.ps1') Out } catch { $out = '' }
    if (-not $out) { $out = Join-Path $env:LOCALAPPDATA 'Thornswood' }
    $Cache = Join-Path $out 'site-copy'
}

function Get-Text([string]$url) {
    $req = [Net.HttpWebRequest]::Create($url)
    $req.UserAgent = 'Thornswood-Copy'
    $req.Accept = 'application/json'
    $req.Timeout = 30000
    $res = $req.GetResponse()
    try {
        $rd = New-Object IO.StreamReader($res.GetResponseStream(), [Text.Encoding]::UTF8)
        try { return $rd.ReadToEnd() } finally { $rd.Dispose() }
    } finally { $res.Close() }
}

# Downloads $url to $to and hands back its sha256. GitHub's asset addresses
# redirect to its file host, which is followed. The api.github.com shape sends
# JSON about the asset unless it is asked for the bytes, hence the Accept.
function Get-File([string]$url, [string]$to) {
    $req = [Net.HttpWebRequest]::Create($url)
    $req.UserAgent = 'Thornswood-Copy'
    $req.Accept = 'application/octet-stream'
    $req.Timeout = 60000
    $req.ReadWriteTimeout = 300000
    $req.AllowAutoRedirect = $true
    $res = $req.GetResponse()
    try {
        $in = $res.GetResponseStream()
        $fs = [IO.File]::Create($to)
        try { $in.CopyTo($fs) } finally { $fs.Dispose(); $in.Dispose() }
    } finally { $res.Close() }
    return (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash.ToLower()
}

$channels = if ($Channel -eq 'both') { @('main', 'dev') } else { @($Channel) }
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
$problems = New-Object System.Collections.ArrayList
$totalSent = 0

foreach ($ch in $channels) {
    $dev = ($ch -eq 'dev')
    $prefix = if ($dev) { 'feed-dev' } else { 'feed' }
    $other = if ($dev) { 'feed' } else { 'feed-dev' }
    $feedUrl = $SiteUrl.TrimEnd('/') + '/' + $prefix + '/version.json'

    Head "The $ch feed, $feedUrl"
    $doc = $null
    try { $doc = Join-FeedSettings (((Get-Text $feedUrl) -replace ('^' + [char]0xFEFF), '') | ConvertFrom-Json) $feedUrl }
    catch {
        [void]$problems.Add("the $ch feed could not be read: $($_.Exception.Message)")
        Say "  could not read it: $($_.Exception.Message)" 'Red'
        continue
    }

    # One line per sha: the same pack is named once per feed, but a sha named
    # twice is one file.
    $want = [ordered]@{}
    foreach ($a in @(Get-FeedAssets $doc)) {
        if (-not $a.Sha) {
            [void]$problems.Add("$ch $($a.What) has no sha256 on the feed, so it cannot be checked or named")
            continue
        }
        if (-not $want.Contains($a.Sha)) { $want[$a.Sha] = $a }
    }
    $have = 0
    $todo = New-Object System.Collections.ArrayList
    foreach ($sha in $want.Keys) {
        $a = $want[$sha]
        if (Test-SiteAsset $SiteUrl $prefix $sha $a.Bytes) { $have++; continue }
        [void]$todo.Add($a)
    }
    Say ("  {0} asset(s) named, {1} already on the site, {2} to copy" -f $want.Count, $have, $todo.Count)
    foreach ($a in $todo) { Say ("    {0}  {1}" -f $a.Sha.Substring(0, 12), $a.What) }
    if ($Check -or -not $todo.Count) { continue }

    # ------------------------------------------------ fetch and check each --
    $ready = New-Object System.Collections.ArrayList
    foreach ($a in $todo) {
        $file = Join-Path $Cache $a.Sha
        if (Test-Path -LiteralPath $file) {
            if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower() -eq $a.Sha) {
                Say ("  in the cache   {0}  {1}" -f $a.Sha.Substring(0, 12), $a.What) 'DarkGray'
                [void]$ready.Add($file)
                continue
            }
            Remove-Item -LiteralPath $file -Force
        }
        # The other channel's folder first: the same bytes, no GitHub quota.
        $sources = @()
        if (Test-SiteAsset $SiteUrl $other $a.Sha $a.Bytes) {
            $sources += ($SiteUrl.TrimEnd('/') + '/' + $other + '/assets/' + $a.Sha)
        }
        $sources += $a.Url
        $got = $false
        foreach ($src in $sources) {
            $part = $file + '.part'
            try {
                $h = Get-File $src $part
                if ($h -ne $a.Sha) {
                    Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
                    [void]$problems.Add("$ch $($a.What): the bytes at $src do not match the feed's sha256 (got $h), so they were not sent")
                    Say ("  WRONG BYTES    {0}  {1}  from {2}" -f $a.Sha.Substring(0, 12), $a.What, $src) 'Red'
                    continue
                }
                Move-Item -LiteralPath $part -Destination $file -Force
                Say ("  fetched        {0}  {1:N1} MB  {2}" -f $a.Sha.Substring(0, 12), ((Get-Item -LiteralPath $file).Length / 1MB), $a.What) 'Green'
                [void]$ready.Add($file)
                $got = $true
                break
            } catch {
                Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
                $why = $_.Exception.Message
                if ($why -match '\(403\)|\(429\)') { $why += ' (GitHub may be limiting anonymous requests: wait an hour and run it again)' }
                Say ("  could not get  {0}  {1}: {2}" -f $a.Sha.Substring(0, 12), $a.What, $why) 'Yellow'
            }
        }
        if (-not $got -and -not ($problems | Where-Object { $_ -like "$ch $($a.What):*" })) {
            [void]$problems.Add("$ch $($a.What) could not be downloaded from $($a.Url)")
        }
    }
    if (-not $ready.Count) { continue }

    # ------------------------------------------------------------- send ----
    $sendArgs = @{ Dev = $dev; Send = @($ready) }
    if ($SiteDir) { $sendArgs['SiteDir'] = $SiteDir }
    if ($Vps) { $sendArgs['Vps'] = $Vps }
    if ($User) { $sendArgs['User'] = $User }
    $global:LASTEXITCODE = 0
    $why = ''
    try { & $remirror @sendArgs } catch { $why = $_.Exception.Message }
    if (-not $why -and $LASTEXITCODE -ne 0) { $why = "Remirror-Site-Feed.ps1 -Send exited $LASTEXITCODE" }
    if ($why) { [void]$problems.Add("sending to /$prefix/ stopped: $why") }

    # ------------------------------------------------------ and look again --
    $now = 0
    foreach ($a in $todo) {
        if (Test-SiteAsset $SiteUrl $prefix $a.Sha $a.Bytes) { $now++ }
        elseif (-not ($problems | Where-Object { $_ -like "$ch $($a.What)*" })) {
            [void]$problems.Add("$ch $($a.What) is still not on the site")
        }
    }
    $totalSent += $now
    Say ("  the site now answers for {0} of the {1} that were missing on /{2}/" -f $now, $todo.Count, $prefix) $(if ($now -eq $todo.Count) { 'Green' } else { 'Yellow' })
}

Head 'Done'
if ($Check) { Say 'Dry run. Nothing was downloaded or sent, and no feed was touched.' 'Yellow' }
else { Say "  $totalSent asset(s) now on the site. No version.json was touched." 'Green' }
if ($problems.Count) {
    Say 'Not everything is there:' 'Red'
    foreach ($p in $problems) { Say "  $p" 'Red' }
    exit 1
}
if (-not $Check) {
    Say 'Next: a Ship on each channel moves the feed urls, or, without one:' 'DarkGray'
    Say '  .\scripts\release\Repair-Manifest.ps1 -MoveToSite, then .\scripts\deploy\Remirror-Site-Feed.ps1' 'DarkGray'
    Say '  .\scripts\release\Repair-Manifest.ps1 -Channel dev -MoveToSite, then .\scripts\deploy\Remirror-Site-Feed.ps1 -Dev' 'DarkGray'
}
exit 0
