<#
  Check-Outside.ps1

      .\scripts\dev\Check-Outside.ps1                  the main channel
      .\scripts\dev\Check-Outside.ps1 -Branch dev      the dev channel
      .\scripts\dev\Check-Outside.ps1 -Repo <owner/name>   any repository's
                                                 Releases; point it at a wrong
                                                 one to see this go red

  Walks the path a first install takes through the things this project does
  not run itself, and says which of them is broken or has moved. Nothing
  watched them. Watch-Services looks at ports on the server and nothing else,
  and the build check on GitHub only runs when somebody opens a pull request.
  So a Release missing a file, or a Steam update that changes what a new
  install starts from, was found out when a person could not get in.

  WHAT A FIRST INSTALL READS since #5796 (launcher\app\Velo*.cs, GitHub.cs,
  ModlistFetch.cs). The setup program is Velopack's, on a Release of this
  repository; the launcher it puts down reads its channel's Releases through
  GitHub's API itself, never thornswood.net (#5608), and every file of them
  through GitHub.AssetUrl, which takes only this repository's
  /releases/assets/<id> addresses. Before #5796 a launcher read version.json
  on the site and checked every pack against its AllowedHosts; neither is
  read by anything a new install runs now, so neither is asked here.

  What it asks, all of it anonymously, the way a launcher on somebody's
  machine asks with no token of its own:

    the Releases  this repository's list (the name in Velo.cs), a hundred a
                  page, up to five pages, as GitHub.Releases reads it. One
                  listing answers for every file below: a stranger gets sixty
                  GitHub API calls an hour, and every launcher on the same
                  connection shares the sixty.
    the channel   the newest published Release carrying
                  releases.<channel>.json, the one VeloUpdate.cs's
                  ChannelSource takes. Its feed is downloaded and read: the
                  full package it names must be on that Release, uploaded,
                  and the size the feed gives.
    the record    the build Release that made that package (build-1.3.<n>,
                  VeloRecord.TagOf): manifest.json, manifest.cat,
                  game-files.json and collection-modlist.wabbajack, and the
                  channel's setup-files.<channel>.json (on the main- Release
                  for main, VeloRecord.Setup).
    the setup     the setup program the Downloads page offers: the newest
                  Release of the channel's kind with Thornswood-Setup.exe
                  (main-build-<n>) or Thornswood-Dev-Setup.exe (build-<n>),
                  the way site\lib\feed.js picks it, with GitHub's sha256.
    the bytes     the package and the setup program, asked for the way the
                  launcher asks (Accept octet-stream), then the first byte of
                  wherever GitHub sends that on to, against the size GitHub
                  lists.
    7-Zip         the Release the modlist install takes 7-Zip from
                  (ModlistFetch.cs, SevenZip.Repo and Tag): both files it
                  pins, there at the size it pins, and their first bytes.
    Steam         the public build of Skyrim Special Edition, against the one
                  written down in steam-build.json. It comes from
                  api.steamcmd.net, a third party and not Valve, so when that
                  does not answer it is "unchecked", not a fault here.
    Nexus         the collection, through the same anonymous GraphQL POST
                  Watch-Outside uses (api.nexusmods.com/v2/graphql). Name and
                  revision when it answers, and its summary and description
                  against records\collection-page.json (requires Node). Red
                  when Nexus says there is no such collection or the text
                  differs; "unchecked" only when Nexus does not answer
                  at all. A plain page request still gets 403 and is not used.

  What it cannot ask: whether the three depot manifests Downgrade.cs pins at
  1.6.1170 can still be downloaded. Steam hands a depot only to an account
  that owns the game, so that stays a check by hand. Nor the archives the
  modlist itself downloads, which are listed inside the .wabbajack.

  When Steam's public build moves this goes red on purpose, because that is
  the day somebody should try the downgrade on one machine. Once it works,
  write the new build into records\steam-build.json and it goes green again.

  Read only. It sends no token and reads no config.json, and it never
  contacts the server: thornswood.net and the game server are the VPS, and
  Watch-Services and Check-Site are what look at those. The signed download
  address GitHub redirects to is never printed, only its host, because the
  address is itself a credential for as long as it lasts.

  Exits 1 when anything is wrong or has moved, 0 when nothing has.
#>
[CmdletBinding()]
param(
  # owner/name of the repository whose Releases a launcher reads. Left out,
  # the one launcher\app\Velo.cs names.
  [string]$Repo,
  # main or dev: the channel a new install is on.
  [ValidateSet('main', 'dev')]
  [string]$Branch = 'main',
  # The Steam build last looked at and accepted. records\steam-build.json.
  [string]$SteamRecord
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }


function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host "  $m" -ForegroundColor Cyan }

# Everything that is printed about a finding goes through Note, so the
# harness can read back exactly what a person would have seen.
function Note([string]$kind, [string]$tag, [string]$m, [string]$c) {
  $script:Found.Add([pscustomobject]@{ Kind = $kind; Text = $m })
  Write-Host ('  ' + $tag + $m) -ForegroundColor $c
}
function Ok($m)   { Note 'ok'   'ok         ' $m 'Green' }
function Bad($m)  { $script:Problems++; Note 'bad' 'WRONG      ' $m 'Red' }
function Skip($m) { Note 'skip' 'unchecked  ' $m 'Yellow' }
function Line($m) { Note 'line' '           ' $m 'Gray' }
function Few($names, [int]$n = 10) {
  $all = @($names | ForEach-Object { $_ })
  foreach ($x in ($all | Select-Object -First $n)) { Line ('  ' + $x) }
  if ($all.Count -gt $n) { Line ('  and ' + ($all.Count - $n) + ' more') }
}

# ------------------------------------------------------------ asking
# One anonymous GET. HttpWebRequest rather than Invoke-WebRequest for the
# reason Check-Site gives: a 404 or a 302 is an answer here, not an error, and
# it has to read the same in either PowerShell. No Authorization header is set
# anywhere in this file, on purpose: the question is what a stranger gets.
function Probe([string]$url, [string]$accept = '', [switch]$Body, [switch]$FirstByte, [string]$Method = 'GET', [string]$PostBody = '') {
  $out = @{ code = 0; body = ''; location = ''; range = ''; left = ''; reset = ''; link = ''; error = '' }
  try {
    $r = [Net.HttpWebRequest]::Create($url)
    $r.Method = $(if ($Method) { $Method } else { 'GET' })
    $r.AllowAutoRedirect = $false
    $r.Timeout = 30000
    $r.UserAgent = 'Thornswood Check-Outside'
    if ($accept) { $r.Accept = $accept }
    if ($FirstByte) { $r.AddRange(0, 0) }
    if ($PostBody) {
      $bytes = [Text.Encoding]::UTF8.GetBytes($PostBody)
      $r.ContentType = 'application/json; charset=utf-8'
      $r.ContentLength = $bytes.Length
      $st = $r.GetRequestStream(); $st.Write($bytes, 0, $bytes.Length); $st.Close()
    }
    $resp = $null
    try { $resp = $r.GetResponse() }
    catch [Net.WebException] {
      $resp = $_.Exception.Response
      if (-not $resp) { $out.error = $_.Exception.Message; return $out }
    }
    $out.code = [int]$resp.StatusCode
    $out.location = [string]$resp.Headers['Location']
    $out.range = [string]$resp.Headers['Content-Range']
    $out.left = [string]$resp.Headers['X-RateLimit-Remaining']
    $out.reset = [string]$resp.Headers['X-RateLimit-Reset']
    $out.link = [string]$resp.Headers['Link']
    if ($Body) {
      $rd = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
      $out.body = $rd.ReadToEnd()
      $rd.Close()
    }
    $resp.Close()
  } catch { $out.error = $_.Exception.Message }
  return $out
}

function On-Server([string]$url) {
  $u = $null
  if (-not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$u)) { return $false }
  $h = $u.Host.ToLowerInvariant()
  foreach ($s in @($script:ServerHosts)) {
    if (-not $s) { continue }
    $s = ([string]$s).ToLowerInvariant()
    if ($h -eq $s -or $h.EndsWith('.' + $s)) { return $true }
  }
  return $false
}

# Every request goes through here, so nothing reaches the server by accident.
function Ask([string]$url, [string]$accept = '', [switch]$Body, [switch]$FirstByte, [string]$Method = 'GET', [string]$PostBody = '') {
  if (On-Server $url) {
    return @{ code = 0; body = ''; location = ''; range = ''; left = ''; reset = ''; link = ''; error = 'not asked, that is the server' }
  }
  $p = Probe $url $accept -Body:$Body -FirstByte:$FirstByte -Method $Method -PostBody $PostBody
  $gh = $false
  try { $gh = ([Uri]$url).Host -eq 'api.github.com' } catch { }
  if ($gh -and $p.left) { $script:Left = $p.left; $script:Reset = $p.reset }
  return $p
}

function Answer($p) {
  if ($p.code) { return [string]$p.code }
  return ('nothing (' + $p.error + ')')
}

function Spent($p) { return ($p.code -eq 429 -or ($p.code -eq 403 -and $p.left -eq '0')) }

function Allowance() {
  $t = ''
  if ($script:Reset) {
    try { $t = ' until ' + [DateTimeOffset]::FromUnixTimeSeconds([long]$script:Reset).ToLocalTime().ToString('HH:mm') } catch { }
  }
  return ("GitHub's sixty anonymous API calls an hour for this connection are used up" + $t +
          ". That is GitHub, not the Releases, and every launcher on this connection is turned away the same way until then.")
}

function Host-Of([string]$url) {
  try { return ([Uri]$url).Host } catch { return 'an address that is not one' }
}

# "bytes 0-0/3292160" -> 3292160. 0 when the total is not given.
function Total-Of([string]$range) {
  $m = [regex]::Match([string]$range, '/(\d+)\s*$')
  if ($m.Success) { return [long]$m.Groups[1].Value }
  return [long]0
}

function Next-Link([string]$link) {
  $m = [regex]::Match([string]$link, '<([^>]+)>\s*;\s*rel="next"')
  if ($m.Success) { return $m.Groups[1].Value }
  return ''
}


# ------------------------------------------------------------ what the launcher names
# The collection and the server, from the launcher's own config, which is the
# one place Set-Vps.ps1 and a rename keep them true.
function Read-Defaults([string]$configCs) {
  $o = @{ Collection = ''; SiteHost = 'thornswood.net'; ServerAddress = '' }
  if (-not (Test-Path -LiteralPath $configCs)) { return $o }
  $cs = [IO.File]::ReadAllText($configCs)
  $m = [regex]::Match($cs, 'const\s+string\s+Collection\s*=\s*"([^"]+)"')
  if ($m.Success) { $o.Collection = $m.Groups[1].Value }
  $m = [regex]::Match($cs, 'public\s+string\s+SiteUrl\s*=\s*"([^"]+)"')
  if ($m.Success) { try { $o.SiteHost = ([Uri]$m.Groups[1].Value).Host } catch { } }
  $m = [regex]::Match($cs, 'public\s+string\s+ServerAddress\s*=\s*"([^"]+)"')
  if ($m.Success) { $o.ServerAddress = $m.Groups[1].Value }
  return $o
}

# The repository whose Releases every launcher reads (Velo.Repo), so the name
# here cannot go stale. Empty when Velo.cs names none.
function Read-VeloRepo([string]$veloCs) {
  if (-not (Test-Path -LiteralPath $veloCs)) { return '' }
  $m = [regex]::Match([IO.File]::ReadAllText($veloCs), 'const\s+string\s+Repo\s*=\s*"([A-Za-z0-9-]+/[A-Za-z0-9._-]+)"')
  if ($m.Success) { return $m.Groups[1].Value }
  return ''
}

# The 7-Zip Release the modlist install fetches and the two files it pins
# (SevenZip in ModlistFetch.cs), or $null when the file does not say.
function Read-SevenZip([string]$fetchCs) {
  if (-not (Test-Path -LiteralPath $fetchCs)) { return $null }
  $cs = [IO.File]::ReadAllText($fetchCs)
  $repo = [regex]::Match($cs, 'class\s+SevenZip[\s\S]*?const\s+string\s+Repo\s*=\s*"([^"]+)"')
  $tag = [regex]::Match($cs, 'class\s+SevenZip[\s\S]*?const\s+string\s+Tag\s*=\s*"([^"]+)"')
  $pins = @()
  foreach ($which in @('Unpacker', 'Installer')) {
    $m = [regex]::Match($cs, 'static\s+Pin\s+' + $which + '\s*=\s*new\s+Pin\s*\{\s*Name\s*=\s*"([^"]+)",\s*Size\s*=\s*(\d+)')
    if ($m.Success) { $pins += [pscustomobject]@{ Name = $m.Groups[1].Value; Size = [long]$m.Groups[2].Value } }
  }
  if (-not $repo.Success -or -not $tag.Success -or $pins.Count -ne 2) { return $null }
  return [pscustomobject]@{ Repo = $repo.Groups[1].Value; Tag = $tag.Groups[1].Value; Pins = $pins }
}

# ------------------------------------------------------------ the pieces
# The kind of Release each channel's setup program is on, and its name: the
# same as SETUP_KINDS in site\lib\feed.js, which picks the one the Downloads
# page offers.
$script:SetupKinds = @{
  main = @{ Tag = '^main-build-(?:\d{8}\.\d+|1\.3\.\d+)$'; Name = 'Thornswood-Setup.exe' }
  dev  = @{ Tag = '^build-(?:\d{8}\.\d+|1\.3\.\d+)$'; Name = 'Thornswood-Dev-Setup.exe' }
}

function When-Of($r) {
  $t = $r.published_at
  if ($t -is [DateTime]) { return $t.ToUniversalTime() }
  $d = [DateTime]::MinValue
  if ([DateTime]::TryParse([string]$t, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]'AdjustToUniversal,AssumeUniversal', [ref]$d)) { return $d }
  return [DateTime]::MinValue
}

# The asset of a Release by name, only once its upload has finished, as
# GitHub.Release.File and the launcher's Uploaded read it. $null otherwise.
function Asset-Named($r, [string]$name) {
  if ($null -eq $r) { return $null }
  foreach ($a in @($r.assets)) {
    if ($null -ne $a -and [string]$a.name -eq $name -and [string]$a.state -eq 'uploaded') { return $a }
  }
  return $null
}

# The address the launcher fetches an asset from: its API address, which has
# to be one of that repository's Release files (GitHub.AssetUrl and SaveTo).
# Empty when GitHub named anything else.
function Url-Of($a, [string]$repo) {
  $want = 'https://api.github.com/repos/' + $repo + '/releases/assets/'
  $u = [string]$a.url
  if (-not $u) { $u = $want + [string]$a.id }
  if (-not $u.StartsWith($want, [StringComparison]::OrdinalIgnoreCase)) { return '' }
  if ($u.Substring($want.Length) -notmatch '^\d{1,19}$') { return '' }
  return $u
}

# One page after another of the Releases a stranger sees, newest published
# first, until $Enough says the walk has what it needs or GitHub has no more
# (five pages at most, as GitHub.cs reads). ok is false with the probe that
# failed when a page could not be read.
function Read-Releases([string]$repo, [scriptblock]$Enough) {
  $all = New-Object 'System.Collections.Generic.List[object]'
  $url = 'https://api.github.com/repos/' + $repo + '/releases?per_page=100'
  for ($page = 0; $page -lt 5 -and $url; $page++) {
    $p = Ask $url 'application/vnd.github+json' -Body
    if ($p.code -ne 200) { return @{ ok = $false; probe = $p; list = $all } }
    $got = $null
    try { $got = $p.body | ConvertFrom-Json } catch { return @{ ok = $false; probe = @{ code = 0; error = 'the listing was not JSON' }; list = $all } }
    foreach ($r in @($got)) { if ($null -ne $r -and -not $r.draft -and $r.tag_name) { $all.Add($r) } }
    if (& $Enough $all) { break }
    $url = Next-Link $p.link
  }
  $sorted = @($all | Sort-Object -Property @{ Expression = { When-Of $_ }; Descending = $true })
  return @{ ok = $true; list = $sorted }
}

# One Release by tag: from the pages already read, or one more call.
function Release-Tagged([string]$repo, $list, [string]$tag) {
  foreach ($r in @($list)) { if ([string]$r.tag_name -eq $tag) { return @{ ok = $true; release = $r } } }
  $p = Ask ('https://api.github.com/repos/' + $repo + '/releases/tags/' + [Uri]::EscapeDataString($tag)) 'application/vnd.github+json' -Body
  if ($p.code -ne 200) { return @{ ok = $false; probe = $p } }
  try { return @{ ok = $true; release = ($p.body | ConvertFrom-Json) } } catch { return @{ ok = $false; probe = @{ code = 0; error = 'the Release was not JSON' } } }
}

# A small file of a Release (a Velopack feed), the way GitHub.Download asks:
# its API address with Accept octet-stream, then wherever GitHub sends it on
# to. ok is false with what was said when it did not arrive.
function Read-Asset([string]$url) {
  $a = Ask $url 'application/octet-stream' -Body
  if (Spent $a) { return @{ ok = $false; why = (Allowance) } }
  if ($a.code -eq 200) { return @{ ok = $true; body = $a.body } }
  if (($a.code -eq 301 -or $a.code -eq 302 -or $a.code -eq 307) -and $a.location) {
    $b = Ask $a.location '' -Body
    if ($b.code -eq 200) { return @{ ok = $true; body = $b.body } }
    return @{ ok = $false; why = ('GitHub sends it on to ' + (Host-Of $a.location) + ', which answers ' + (Answer $b) + '.') }
  }
  return @{ ok = $false; why = ('GitHub answers ' + (Answer $a) + '.') }
}

# The full package a Velopack feed names for its Release: of its Full
# entries, the highest version, which is the Release's own (vpk keeps the
# full package of the release before in the feed too; ChannelRelease in
# VeloUpdate.cs). $null when it names none.
function Full-Of($feed) {
  $best = $null; $bestV = $null
  foreach ($e in @($feed.Assets)) {
    if ($null -eq $e) { continue }
    if ([string]$e.Type -ne 'Full' -and [string]$e.Type -ne '1') { continue }
    $v = $null
    if (-not [Version]::TryParse([string]$e.Version, [ref]$v)) { continue }
    if ($null -eq $best -or $v -gt $bestV) { $best = $e; $bestV = $v }
  }
  return $best
}

# The tag of the build Release that made a package of this version, the way
# VeloRecord.TagOf names it: 1.3.N is build-1.3.N. Empty for any other.
function Record-Tag([string]$version) {
  $m = [regex]::Match([string]$version, '^1\.3\.(\d{1,5})$')
  if (-not $m.Success -or [int]$m.Groups[1].Value -gt 65534) { return '' }
  return ('build-1.3.' + [int]$m.Groups[1].Value)
}

function Fetch-One($it) {
  $a = Ask $it.Url 'application/octet-stream'
  if (Spent $a) { Bad ($it.Name + ' was not asked for. ' + (Allowance)); return }
  if ($a.code -eq 200) { Ok ($it.Name + ' comes straight back from GitHub.'); return }
  if (($a.code -eq 301 -or $a.code -eq 302 -or $a.code -eq 307) -and $a.location) {
    # Only the host is ever printed. The address carries a signature.
    $to = Host-Of $a.location
    $b = Ask $a.location '' -FirstByte
    if ($b.code -eq 206 -or $b.code -eq 200) {
      $total = Total-Of $b.range
      if ($it.Bytes -gt 0 -and $total -gt 0 -and $total -ne $it.Bytes) {
        Bad ($it.Name + ' is ' + $total + ' bytes at ' + $to + ' and GitHub lists it as ' + $it.Bytes + '. The launcher will fetch it and refuse it.')
        return
      }
      $size = ''
      if ($total -gt 0) { $size = ', ' + $total + ' bytes' }
      Ok ($it.Name + ' downloads: GitHub sends it on to ' + $to + $size + '.')
      return
    }
    Bad ($it.Name + ': GitHub sends it on to ' + $to + ', which answers ' + (Answer $b) + '. Nobody can download it.')
    return
  }
  Bad ('GitHub answers ' + (Answer $a) + ' when a launcher asks for ' + $it.Name + '. Nobody can download it.')
}

function Check-Steam([string]$path) {
  $rec = $null
  try { $rec = [IO.File]::ReadAllText($path) | ConvertFrom-Json } catch { }
  if ($null -eq $rec -or -not $rec.appId -or -not $rec.publicBuildId) {
    Bad ('no Steam build is recorded in ' + $path + ', so there is nothing to compare with.')
    return
  }
  $s = Ask ('https://api.steamcmd.net/v1/info/' + $rec.appId) 'application/json' -Body
  $now = ''; $when = ''
  if ($s.code -eq 200) {
    try {
      $j = $s.body | ConvertFrom-Json
      $pub = $j.data.([string]$rec.appId).depots.branches.public
      $now = [string]$pub.buildid
      if ($pub.timeupdated) {
        $when = [DateTimeOffset]::FromUnixTimeSeconds([long]$pub.timeupdated).UtcDateTime.ToString('d MMM yyyy', [Globalization.CultureInfo]::InvariantCulture)
      }
    } catch { $now = '' }
  }
  if (-not $now) {
    Skip ('Steam: api.steamcmd.net answered ' + (Answer $s) + ' and no build came back. It is a third party that reads Steam for anybody, not Valve, so this is not a fault here.')
    return
  }
  $was = [string]$rec.publicBuildId
  if ($now -eq $was) {
    # PowerShell 7 reads an ISO date in JSON as a DateTime, 5.1 as a string.
    $day = $rec.recordedUtc
    if ($day -is [DateTime]) { $day = $day.ToString('yyyy-MM-dd') } else { $day = ([string]$day).Split('T')[0] }
    Ok ("Steam's public build is still " + $now + ', as recorded ' + $day + '.')
    return
  }
  $on = ''
  if ($when) { $on = ' on ' + $when }
  Bad ("Steam's public build moved from " + $was + ' to ' + $now + $on + '.')
  Line ("Every new install and every Steam copy that updates starts from it now, and the launcher's downgrade")
  Line ('has to take it back to 1.6.1170. Try that on one machine, then write ' + $now + ' into')
  Line ($path + ' as publicBuildId.')
}

function Check-CollectionPage($collection, [string]$slug, [string]$record) {
  $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $node) { Bad 'the collection page text could not be checked: node is not on PATH.'; return }
  $compare = Join-Path $PSScriptRoot '../release/collection-page.js'
  $text = ConvertTo-Json -InputObject @{ summary = $collection.summary; description = $collection.description } -Compress
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))
  try { $why = $encoded | & $node.Source $compare --compare-public $record $slug 2>&1 }
  catch { Bad 'the collection page text could not be checked: the comparison did not run.'; return }
  if ($LASTEXITCODE -ne 0) { Bad 'the collection page text could not be checked: the comparison failed.' }
  elseif ($why) { Bad ('the collection page: ' + $why) }
  else { Ok 'the public summary and description match collection-page.json.' }
}


# ------------------------------------------------------------ the walk
function Invoke-Outside {
  param(
    [string]$Repo,
    [string]$Branch = 'main',
    [string]$SteamRecord,
    [string]$Collection,
    [string]$PageRecord = (Join-Path $PSScriptRoot '../../records/collection-page.json'),
    [string[]]$Server,
    # SevenZip's Release and pins, from Read-SevenZip. $null when it could not be read.
    $SevenZip
  )
  $script:Problems = 0
  $script:Found = New-Object 'System.Collections.Generic.List[object]'
  $script:Left = ''; $script:Reset = ''
  $script:ServerHosts = @(@($Server) | Where-Object { $_ })
  $ch = $Branch
  $feedName = 'releases.' + $ch + '.json'
  $kind = $script:SetupKinds[$ch]
  Say ('  ' + $Repo + ', the ' + $ch + ' channel') 'DarkGray'

  # ---- the Releases
  Head 'The Releases'
  $channel = $null; $setupRel = $null; $setup = $null
  # Run by Read-Releases from inside this walk, so $feedName and $kind are this
  # walk's own.
  $enough = {
    param($list)
    $a = @($list | Where-Object { Asset-Named $_ $feedName }).Count -gt 0
    $b = @($list | Where-Object { [string]$_.tag_name -match $kind.Tag -and (Asset-Named $_ $kind.Name) }).Count -gt 0
    return ($a -and $b)
  }
  $rs = $null
  if (-not $Repo) { Bad 'no repository was named, and launcher\app\Velo.cs names none, so there are no Releases to read.' }
  else { $rs = Read-Releases $Repo $enough }
  if ($rs -and -not $rs.ok) {
    $p = $rs.probe
    if (Spent $p) { Bad ('the Releases were not read. ' + (Allowance)) }
    elseif ($p.code -eq 404) { Bad ($Repo + ' answers a stranger with 404: it is private, or it is gone. Every launcher reads its Releases with no token, so nobody can install or update.') }
    else { Bad ('could not list the Releases of ' + $Repo + ': ' + (Answer $p) + '. Nothing below them was checked.') }
    $rs = $null
  }
  $list = @()
  if ($rs) {
    $list = @($rs.list)
    Ok ($Repo + ' lists ' + $list.Count + ' published Releases to a stranger.')
    foreach ($r in $list) { if (-not $channel -and (Asset-Named $r $feedName)) { $channel = $r } }
    foreach ($r in $list) {
      if ($setupRel) { break }
      if ([string]$r.tag_name -notmatch $kind.Tag) { continue }
      $a = Asset-Named $r $kind.Name
      if ($null -eq $a) { continue }
      if ([string]$a.digest -notmatch '^sha256:[0-9a-f]{64}$' -or [long]$a.size -le 0) { continue }
      $setupRel = $r; $setup = $a
    }
  }

  # ---- the channel's Release and its feed
  $package = $null
  $recordTag = ''
  if ($rs) {
    Head ('The ' + $ch + ' channel')
    if (-not $channel) {
      Bad ('no published Release carries ' + $feedName + ', so a launcher on ' + $ch + ' finds nothing to install or update to.')
    } else {
      Ok ('the newest Release with ' + $feedName + ' is ' + $channel.tag_name + '.')
      $fa = Asset-Named $channel $feedName
      $fu = Url-Of $fa $Repo
      $feed = $null
      if (-not $fu) { Bad ($feedName + ' on ' + $channel.tag_name + ' is not at one of ' + $Repo + '''s Release file addresses, and the launcher fetches nothing else.') }
      else {
        $got = Read-Asset $fu
        if (-not $got.ok) { Bad ($feedName + ' on ' + $channel.tag_name + ' could not be read: ' + $got.why) }
        else {
          try { $feed = ([string]$got.body).TrimStart([char]0xFEFF) | ConvertFrom-Json } catch { $feed = $null }
          if ($null -eq $feed -or $null -eq $feed.Assets) { Bad ($feedName + ' on ' + $channel.tag_name + ' is not a Velopack feed, so no launcher can read it.'); $feed = $null }
        }
      }
      if ($feed) {
        $full = Full-Of $feed
        if (-not $full) { Bad ($feedName + ' on ' + $channel.tag_name + ' names no full package, so a new install has nothing to take.') }
        else {
          $pa = Asset-Named $channel ([string]$full.FileName)
          if (-not $pa) { Bad ($feedName + ' on ' + $channel.tag_name + ' names ' + $full.FileName + ', which that Release does not carry as a finished upload.') }
          elseif ([long]$full.Size -gt 0 -and [long]$pa.size -ne [long]$full.Size) { Bad ($full.FileName + ' on ' + $channel.tag_name + ' is ' + $pa.size + ' bytes and the feed says ' + $full.Size + '. Velopack will fetch it and refuse it.') }
          else {
            Ok ('it names the full package ' + $full.FileName + ', version ' + $full.Version + ', which the Release carries.')
            $pu = Url-Of $pa $Repo
            if (-not $pu) { Bad ($full.FileName + ' is not at one of ' + $Repo + '''s Release file addresses, and the launcher fetches nothing else.') }
            else { $package = [pscustomobject]@{ Name = $full.FileName; Url = $pu; Bytes = [long]$pa.size } }
          }
          $recordTag = Record-Tag ([string]$full.Version)
          if (-not $recordTag) { Bad ('the package''s version, ' + $full.Version + ', is not one a Thornswood release makes, so the launcher has no signed record to hold it to.') }
        }
      }
    }
  }

  # ---- the signed record and its lists
  if ($recordTag) {
    Head 'The signed record'
    $rec = Release-Tagged $Repo $list $recordTag
    if (-not $rec.ok) {
      if (Spent $rec.probe) { Bad ('the Release ' + $recordTag + ' was not read. ' + (Allowance)) }
      else { Bad ('the Release ' + $recordTag + ', which made the package, answers ' + (Answer $rec.probe) + '. The launcher holds the package to its record, so it refuses it.') }
    } else {
      $want = @('manifest.json', 'manifest.cat', 'game-files.json', 'collection-modlist.wabbajack')
      if ($ch -ne 'main') { $want += ('setup-files.' + $ch + '.json') }
      $gone = @($want | Where-Object { -not (Asset-Named $rec.release $_) })
      if ($gone.Count) { Bad ($recordTag + ' does not carry ' + ($gone -join ', ') + ', which the launcher reads from it on the first start.') }
      else { Ok ($recordTag + ' carries ' + ($want -join ', ') + '.') }
      if ($ch -eq 'main') {
        $mainTag = 'main-' + $recordTag
        $setupList = 'setup-files.main.json'
        $mr = Release-Tagged $Repo $list $mainTag
        if (-not $mr.ok) {
          if (Spent $mr.probe) { Bad ('the Release ' + $mainTag + ' was not read. ' + (Allowance)) }
          else { Bad ('the Release ' + $mainTag + ' answers ' + (Answer $mr.probe) + ', and a main launcher reads ' + $setupList + ' from it.') }
        }
        elseif (-not (Asset-Named $mr.release $setupList)) { Bad ($mainTag + ' does not carry ' + $setupList + ', which a main launcher reads from it on the first start.') }
        else { Ok ($mainTag + ' carries ' + $setupList + '.') }
      }
    }
  }

  # ---- the setup program the Downloads page offers
  if ($rs) {
    Head 'The setup program'
    if (-not $setup) { Bad ('no published Release of the ' + $ch + ' kind carries ' + $kind.Name + ' with GitHub''s sha256, so the Downloads page has no installer to offer.') }
    else { Ok ($kind.Name + ' is on ' + $setupRel.tag_name + ', ' + $setup.size + ' bytes.') }
  }

  # ---- the bytes, for the two things a new install downloads first
  if ($rs) {
    Head 'The downloads'
    $tried = 0
    if ($package) { $tried++; Fetch-One $package }
    if ($setup) {
      $su = Url-Of $setup $Repo
      if (-not $su) { Bad ($kind.Name + ' is not at one of ' + $Repo + '''s Release file addresses.') }
      else { $tried++; Fetch-One ([pscustomobject]@{ Name = $kind.Name; Url = $su; Bytes = [long]$setup.size }) }
    }
    if ($tried -eq 0) { Skip 'nothing to download: every file above was already wrong or could not be found.' }
  }

  # ---- 7-Zip, which the modlist install takes from its own Release
  Head '7-Zip'
  if ($null -eq $SevenZip) { Bad 'could not read which 7-Zip Release launcher\app\ModlistFetch.cs pins, so it was not checked.' }
  else {
    $z = Release-Tagged $SevenZip.Repo @() $SevenZip.Tag
    if (-not $z.ok) {
      if (Spent $z.probe) { Bad ('7-Zip ' + $SevenZip.Tag + ' was not read. ' + (Allowance)) }
      else { Bad ('7-Zip''s Release ' + $SevenZip.Tag + ' in ' + $SevenZip.Repo + ' answers ' + (Answer $z.probe) + ', and the modlist install takes 7-Zip from it.') }
    } else {
      foreach ($pin in @($SevenZip.Pins)) {
        $a = Asset-Named $z.release $pin.Name
        if (-not $a) { Bad ('7-Zip''s Release ' + $SevenZip.Tag + ' has no ' + $pin.Name + ', which the modlist install downloads.'); continue }
        if ([long]$a.size -ne [long]$pin.Size) { Bad ($pin.Name + ' on 7-Zip''s Release ' + $SevenZip.Tag + ' is ' + $a.size + ' bytes and the launcher pins ' + $pin.Size + ', so it refuses it.'); continue }
        $u = Url-Of $a $SevenZip.Repo
        if (-not $u) { Bad ($pin.Name + ' is not at one of ' + $SevenZip.Repo + '''s Release file addresses.'); continue }
        Fetch-One ([pscustomobject]@{ Name = ('7-Zip''s ' + $pin.Name); Url = $u; Bytes = [long]$pin.Size })
      }
    }
  }

  # ---- Steam, which no Release names
  Head 'Steam'
  Check-Steam $SteamRecord
  Skip ('whether the three depot manifests launcher\app\Downgrade.cs pins at 1.6.1170 can still be downloaded.' +
        ' Steam hands a depot only to an account that owns the game, so that stays a check by hand.')

  # ---- Nexus (same anonymous GraphQL POST as Watch-Outside / #1063)
  Head 'Nexus'
  $c = $Collection
  if (-not $c) { Skip 'the collection: there is no collection address in Config.cs.' }
  elseif (On-Server $c) { Skip 'the collection: its address is on the server, which this does not contact.' }
  else {
    $nx = [regex]::Match([string]$c, 'nexusmods\.com/games/([A-Za-z0-9]+)/collections/([A-Za-z0-9]+)')
    if (-not $nx.Success) {
      Skip ('the collection: its address is not a Nexus collection page this knows how to ask about.')
      Line $c
    } else {
      $game = $nx.Groups[1].Value
      $slug = $nx.Groups[2].Value
      $q = '{ collection(slug: \"' + $slug + '\", domainName: \"' + $game + '\") { name summary description latestPublishedRevision { revisionNumber } } }'
      $gql = 'https://api.nexusmods.com/v2/graphql'
      $n = Ask $gql 'application/json' -Body -Method 'POST' -PostBody ('{"query":"' + $q + '"}')
      if (-not $n.code) {
        Skip ('the collection: Nexus did not answer (' + (Answer $n) + '). Its public GraphQL is what this asks; without an answer the collection is unchecked.')
      }
      elseif ($n.code -ne 200) {
        Skip ('the collection: Nexus answered ' + (Answer $n) + ' to its public GraphQL, so the collection is unchecked.')
      }
      else {
        $col = $null
        try { $col = ($n.body | ConvertFrom-Json).data.collection } catch { $col = $null }
        if (-not $col -or -not $col.name) {
          Bad ('Nexus says there is no collection ' + $slug + ': every first install is sent there.')
          Line $c
        } else {
          $rev = ''
          try { $rev = [string]$col.latestPublishedRevision.revisionNumber } catch { $rev = '' }
          Ok ('the collection "' + $col.name + '" is there, revision ' + $rev + '.')
          Check-CollectionPage $col $slug $PageRecord
        }
      }
    }
  }

  Write-Host ''
  if ($script:Left) { Say ('  GitHub API calls left for this connection this hour: ' + $script:Left + ', shared with every launcher on it.') 'DarkGray' }
  if ($script:Problems -eq 0) { Say '  Nothing outside has moved.' 'Green' }
  else { Say ('  ' + $script:Problems + ' finding(s) above need a look.') 'Red' }
  return $script:Problems
}

# Dot-sourced by tests\test-check-outside.ps1, which wants the functions and
# not a run against the real Releases.
if ($MyInvocation.InvocationName -eq '.') { return }

$d = Read-Defaults (Join-Path $Here '..\..\launcher\app\Config.cs')
if (-not $Repo) { $Repo = Read-VeloRepo (Join-Path $Here '..\..\launcher\app\Velo.cs') }
if (-not $SteamRecord) { $SteamRecord = Join-Path $Here '..\..\records\steam-build.json' }
$sevenZip = Read-SevenZip (Join-Path $Here '..\..\launcher\app\ModlistFetch.cs')

Write-Host ''
Write-Host '  THORNSWOOD  -  what a first install needs that we do not run' -ForegroundColor White

$problems = Invoke-Outside -Repo $Repo -Branch $Branch -SteamRecord $SteamRecord `
  -Collection $d.Collection -Server @($d.SiteHost, $d.ServerAddress) -SevenZip $sevenZip
if ($problems -gt 0) { exit 1 }
exit 0
