<#
  Check-Outside.ps1

      .\scripts\dev\Check-Outside.ps1                  the live feed
      .\scripts\dev\Check-Outside.ps1 -Branch dev      the dev feed
      .\scripts\dev\Check-Outside.ps1 -FeedUrl <url>   any feed; point it at a wrong
                                                 one to see this go red

  Walks the path a first install takes through the things this project does
  not run itself, and says which of them is broken or has moved. Nothing
  watched them. Watch-Services looks at ports on the server and nothing else,
  and the build check on GitHub only runs when somebody opens a pull request.
  So a feed entry pointing at a file nobody can download, or a Steam update
  that changes what a new install starts from, was found out when a person
  could not get in.

  What it asks, all of it anonymously, the way a launcher on somebody's
  machine asks with no token of its own:

    the feed      version.json, read from https://thornswood.net/feed/version.json
                  (feed-dev with -Branch dev), the one address on the site this
                  asks, because it is what every launcher reads. It has to
                  answer and be JSON. Until #907 it was read from
                  Thornswood-Releases through the GitHub contents API; -Repo
                  still reads a repository that way.
    every url     every pack, the launcher and the client runtime: https, a
                  host the launcher's AllowedHosts accepts (read out of
                  Updater.cs, so the list here cannot go stale), a checksum,
                  and an asset that the repository it names still lists to a
                  stranger. That is one listing per repository, not one
                  request per pack: a stranger gets sixty GitHub API calls an
                  hour, the feed held 227 packs on 24 September, and every
                  launcher on the same connection shares the sixty.
    the bytes     the launcher, the client runtime and the newest pack, asked
                  for the way the launcher asks (Accept octet-stream), then the
                  first byte of wherever GitHub sends that on to.
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
  that owns the game, so that stays a check by hand.

  When Steam's public build moves this goes red on purpose, because that is
  the day somebody should try the downgrade on one machine. Once it works,
  write the new build into records\steam-build.json and it goes green again.

  Measured 24 September, the first run: red for one reason. 164 of the 227
  packs point at EvilPatrick06/Thornswood, which answers a stranger with 404,
  so a launcher that has to replay them cannot. The other 63, the launcher
  and the client runtime were all there and downloaded; Steam matched the
  record; Nexus's collection page answered 403. From 2 October the collection
  is asked through Nexus's public GraphQL instead (#1064), the same way
  Watch-Outside asks it. It stays red until those packs move to the
  public repository or leave the feed.

  Read only. It sends no token and reads no config.json, and it never
  contacts the server: thornswood.net and the game server are the VPS, and
  Watch-Services and Check-Site are what look at those. A feed address that
  points at the server is reported and not requested. The signed download
  address GitHub redirects to is never printed, only its host, because the
  address is itself a credential for as long as it lasts.

  Exits 1 when anything is wrong or has moved, 0 when nothing has.
#>
[CmdletBinding()]
param(
  # owner/name of a releases repository to read the feed from through the
  # GitHub contents API, as launchers did before the site feed. Left out, the
  # feed is the site's (#907).
  [string]$Repo,
  # main is the live feed, dev the dev one.
  [string]$Branch = 'main',
  # Read the feed from here instead of the releases repository.
  [string]$FeedUrl,
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
          ". That is GitHub, not the feed, and every launcher on this connection is turned away the same way until then.")
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

# ------------------------------------------------------------ what the launcher accepts
# Updater.CheckUrl, in the same order and for the same reasons: an address, https,
# and a host on AllowedHosts. Empty when the launcher would take it.
function Refused([string]$url, [string[]]$hosts) {
  $u = $null
  if (-not $url -or -not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$u)) { return 'has no address the launcher can read' }
  if ($u.Scheme -ne 'https') { return 'is not https, and the launcher refuses plain http' }
  # Filtered, because @($null) is one element and an empty list would read as
  # a list holding one blank host.
  $hs = @(@($hosts) | Where-Object { $_ })
  if ($hs.Count -gt 0) {
    $h = $u.Host.ToLowerInvariant()
    foreach ($a in $hs) { if ($h -eq $a -or $h.EndsWith('.' + $a)) { return '' } }
    return ('points at ' + $u.Host + ', which the launcher refuses')
  }
  return ''
}

function Read-AllowedHosts([string]$updaterCs) {
  if (-not (Test-Path -LiteralPath $updaterCs)) { return @() }
  $cs = [IO.File]::ReadAllText($updaterCs)
  $m = [regex]::Match($cs, 'AllowedHosts\s*=\s*\{([^}]*)\}')
  if (-not $m.Success) { return @() }
  return @([regex]::Matches($m.Groups[1].Value, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() })
}

# The releases repository, the collection and the server, from the launcher's
# own config, which is the one place Set-Vps.ps1 and a rename keep them true.
function Read-Defaults([string]$configCs) {
  # No releases repository by default any more: Config.cs names none since #907.
  $o = @{ Repo = ''; Collection = ''; SiteHost = 'thornswood.net'; ServerAddress = '' }
  if (-not (Test-Path -LiteralPath $configCs)) { return $o }
  $cs = [IO.File]::ReadAllText($configCs)
  $m = [regex]::Match($cs, 'UpdateRepo\s*=\s*"([^"/\s]+/[^"\s]+)"')
  if ($m.Success) { $o.Repo = $m.Groups[1].Value }
  $m = [regex]::Match($cs, 'const\s+string\s+Collection\s*=\s*"([^"]+)"')
  if ($m.Success) { $o.Collection = $m.Groups[1].Value }
  $m = [regex]::Match($cs, 'public\s+string\s+SiteUrl\s*=\s*"([^"]+)"')
  if ($m.Success) { try { $o.SiteHost = ([Uri]$m.Groups[1].Value).Host } catch { } }
  $m = [regex]::Match($cs, 'public\s+string\s+ServerAddress\s*=\s*"([^"]+)"')
  if ($m.Success) { $o.ServerAddress = $m.Groups[1].Value }
  return $o
}

# ------------------------------------------------------------ the pieces
function Asset-Of([string]$url) {
  $m = [regex]::Match([string]$url, '^https://api\.github\.com/repos/([^/]+/[^/]+)/releases/assets/(\d+)$', 'IgnoreCase')
  if ($m.Success) { return @{ repo = $m.Groups[1].Value; id = $m.Groups[2].Value } }
  return $null
}

# Every asset a stranger can see in one repository, id -> state.
function Read-Assets([string]$repo) {
  $ids = @{}
  $url = 'https://api.github.com/repos/' + $repo + '/releases?per_page=100'
  for ($page = 0; $page -lt 30 -and $url; $page++) {
    $p = Ask $url 'application/vnd.github+json' -Body
    if ($p.code -ne 200) { return @{ ok = $false; probe = $p; ids = $ids } }
    $list = $null
    try { $list = $p.body | ConvertFrom-Json } catch { return @{ ok = $false; probe = @{ code = 0; error = 'the listing was not JSON' }; ids = $ids } }
    foreach ($rel in @($list)) {
      if ($null -eq $rel) { continue }
      foreach ($a in @($rel.assets)) { if ($null -ne $a) { $ids[[string]$a.id] = [string]$a.state } }
    }
    $url = Next-Link $p.link
  }
  return @{ ok = $true; ids = $ids }
}

# Through the pipeline, never @($list): @() over a generic List of objects
# throws "Argument types do not match" in both PowerShell 5.1 and 7.
function Items($list) { return @($list | ForEach-Object { $_ }) }

# "63 packs, the launcher and the client runtime"
function What($list) {
  $all = Items $list
  $packs = @($all | Where-Object { $_.Pack }).Count
  $bits = @()
  if ($packs -eq 1) { $bits += '1 pack' } elseif ($packs -gt 1) { $bits += ([string]$packs + ' packs') }
  foreach ($x in $all) { if (-not $x.Pack) { $bits += $x.Name } }
  if ($bits.Count -le 1) { return ($bits -join '') }
  return ((($bits[0..($bits.Count - 2)]) -join ', ') + ' and ' + $bits[-1])
}

function Are($list, [string]$one, [string]$many) {
  if (@(Items $list).Count -eq 1) { return $one }
  return $many
}

function Span($list) {
  $ids = @($list | Where-Object { $_.Pack } | ForEach-Object { $_.Id2 })
  if ($ids.Count -eq 0) { return '' }
  if ($ids.Count -eq 1) { return (' The pack is ' + $ids[0] + '.') }
  return (' The oldest is ' + $ids[0] + ' and the newest ' + $ids[-1] + '.')
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
        Bad ($it.Name + ' is ' + $total + ' bytes at ' + $to + ' and the feed says ' + $it.Bytes + '. The launcher will fetch it and refuse it.')
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
    [string]$FeedUrl,
    [string[]]$Hosts,
    [string]$SteamRecord,
    [string]$Collection,
    [string]$PageRecord = (Join-Path $PSScriptRoot '../../records/collection-page.json'),
    [string[]]$Server,
    # The feed is on the site (#907). Asked once, directly, although the site
    # is the server: it is the one file every launcher reads.
    [switch]$FeedFromSite
  )
  $script:Problems = 0
  $script:Found = New-Object 'System.Collections.Generic.List[object]'
  $script:Left = ''; $script:Reset = ''
  $script:ServerHosts = @(@($Server) | Where-Object { $_ })

  # The same door the launcher uses: the contents API, raw. A check that read
  # the file some other way could pass while every launcher failed.
  if (-not $FeedUrl) { $FeedUrl = 'https://api.github.com/repos/' + $Repo + '/contents/version.json?ref=' + $Branch }
  Say ('  feed  ' + $FeedUrl) 'DarkGray'

  # ---- the feed
  Head 'The feed'
  $v = $null
  $f = if ($FeedFromSite) { Probe $FeedUrl 'application/json' -Body } else { Ask $FeedUrl 'application/vnd.github.raw' -Body }
  if (Spent $f) { Bad ('version.json was not read. ' + (Allowance)) }
  elseif ($f.code -ne 200) { Bad ('version.json answers ' + (Answer $f) + ', so no launcher can read it and no pack or download can be checked.') }
  else {
    try { $v = $f.body.TrimStart([char]0xFEFF) | ConvertFrom-Json } catch { $v = $null }
    if ($null -eq $v -or $null -eq $v.packs) {
      Bad 'version.json answers but is not a feed: it is not JSON, or it has no packs. No launcher can use it.'
      $v = $null
    } else {
      Ok ('version.json answers and reads: launcher ' + $v.launcherVersion + ', ' + @($v.packs).Count + ' packs.')
      # The rest of the feed, when version.json names it as settings of its
      # own (#1050): what a launcher fetches next, checked the same way.
      if ($v.PSObject.Properties['settings']) {
        . (Join-Path $PSScriptRoot '..\release\Feed-Json.ps1')
        $named = [string]$v.settings.sha256
        try {
          $v = Join-FeedSettings $v $FeedUrl
          Ok ('the settings it names (' + $named + ') answer and hash to their name.')
        }
        catch {
          Bad ('version.json names settings of its own, and a launcher cannot have them: ' + $_.Exception.Message + ' No launcher that reads them can check for updates.')
          $v = $null
        }
      }
      if ($v -and $v.updateRepo -and $Repo -and ([string]$v.updateRepo) -ne $Repo) {
        Bad ('the feed sends every launcher to ' + $v.updateRepo + ' for its next check, not ' + $Repo + '.')
      }
    }
  }

  if ($v) {
    if ($v.serverAddress) { $script:ServerHosts += [string]$v.serverAddress }
    if ($v.siteUrl) { try { $script:ServerHosts += ([Uri][string]$v.siteUrl).Host } catch { } }

    # ---- every address, without a request per address
    Head 'Every address in it'
    if (@(@($Hosts) | Where-Object { $_ }).Count -eq 0) {
      Bad "could not read AllowedHosts out of launcher\app\Updater.cs, so no address was checked against the launcher's list."
    }
    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($p in @($v.packs)) {
      if ($null -eq $p) { continue }
      $items.Add([pscustomobject]@{ Name = 'pack ' + $p.id; Id2 = [string]$p.id; Pack = $true; Url = [string]$p.url; Sha = [string]$p.sha256; Bytes = [long]0; Repo = ''; Id = '' })
    }
    $packCount = $items.Count
    $launcher = [pscustomobject]@{ Name = 'the launcher'; Id2 = ''; Pack = $false; Url = [string]$v.launcherUrl; Sha = [string]$v.launcherSha256; Bytes = [long]0; Repo = ''; Id = '' }
    $items.Add($launcher)
    $client = $null
    if ($v.clientRuntime -and $v.clientRuntime.url) {
      $client = [pscustomobject]@{ Name = 'the client runtime'; Id2 = ''; Pack = $false; Url = [string]$v.clientRuntime.url; Sha = [string]$v.clientRuntime.sha256; Bytes = [long]$v.clientRuntime.bytes; Repo = ''; Id = '' }
      $items.Add($client)
    }
    $newest = $null
    if ($packCount -gt 0) { $newest = $items[$packCount - 1] }

    $wrong = New-Object 'System.Collections.Generic.List[string]'
    $onServer = New-Object 'System.Collections.Generic.List[object]'
    $elsewhere = New-Object 'System.Collections.Generic.List[object]'
    $byRepo = [ordered]@{}
    foreach ($it in $items) {
      $why = Refused $it.Url $Hosts
      if ($why) { $wrong.Add($it.Name + ' ' + $why); continue }
      if (-not $it.Sha) { $wrong.Add($it.Name + ' has no checksum, and the launcher refuses a download without one'); continue }
      if (On-Server $it.Url) { $onServer.Add($it); continue }
      $a = Asset-Of $it.Url
      if (-not $a) { $elsewhere.Add($it); continue }
      $it.Repo = $a.repo; $it.Id = $a.id
      $k = $a.repo.ToLowerInvariant()
      if (-not $byRepo.Contains($k)) { $byRepo[$k] = New-Object 'System.Collections.Generic.List[object]' }
      $byRepo[$k].Add($it)
    }

    if ($wrong.Count) {
      Bad ([string]$wrong.Count + ' address(es) in the feed the launcher will not download:')
      Few $wrong
    }
    if ($onServer.Count) {
      Skip ((What $onServer) + ' on the server, which this does not contact. Check-Site looks at the site.')
    }
    if ($elsewhere.Count) {
      Skip ((What $elsewhere) + ' not at a GitHub release asset address, so nothing here knows how to check it.')
    }

    $alive = @{}
    foreach ($k in @($byRepo.Keys)) {
      $list = $byRepo[$k]
      $repoName = $list[0].Repo
      $r = Read-Assets $repoName
      if (-not $r.ok) {
        $p = $r.probe
        if (Spent $p) { Bad ((What $list) + ' in ' + $repoName + (Are $list ' was' ' were') + ' not checked. ' + (Allowance)) }
        elseif ($p.code -eq 404) {
          Bad ($repoName + ' answers a stranger with 404: it is private, or it is gone. ' + (What $list) + ' in the feed' +
               (Are $list ' points' ' point') + ' there, and a launcher with no token cannot fetch' + (Are $list ' it.' ' them.') + (Span $list))
        }
        else { Bad ('could not list the releases in ' + $repoName + ': ' + (Answer $p) + '. ' + (What $list) + ' there' + (Are $list ' was' ' were') + ' not checked.') }
        continue
      }
      $alive[$k] = $r.ids
      $missing = @($list | Where-Object { -not $r.ids.ContainsKey($_.Id) })
      $half = @($list | Where-Object { $r.ids.ContainsKey($_.Id) -and $r.ids[$_.Id] -ne 'uploaded' })
      if ($missing.Count) {
        Bad ($repoName + ' no longer lists the asset behind ' + (What $missing) + ':')
        Few ($missing | ForEach-Object { $_.Name + ', asset ' + $_.Id })
      }
      if ($half.Count) {
        Bad ('in ' + $repoName + ', the upload behind ' + (What $half) + ' never finished:')
        Few ($half | ForEach-Object { $_.Name + ', asset ' + $_.Id + ', ' + $r.ids[$_.Id] })
      }
      $good = @($list | Where-Object { $r.ids.ContainsKey($_.Id) -and $r.ids[$_.Id] -eq 'uploaded' })
      if ($good.Count) { Ok ((What $good) + ' ' + $(if ($good.Count -eq 1) { 'is' } else { 'are all' }) + ' listed in ' + $repoName + '.') }
    }

    # ---- the bytes, for the three things a launcher fetches first
    Head 'The downloads'
    $seen = @{}
    $tried = 0
    foreach ($it in @($launcher, $client, $newest)) {
      if ($null -eq $it -or -not $it.Id) { continue }
      if ($seen.ContainsKey($it.Url)) { continue }
      $seen[$it.Url] = $true
      $k = $it.Repo.ToLowerInvariant()
      if (-not $alive.ContainsKey($k) -or -not $alive[$k].ContainsKey($it.Id)) { continue }
      $tried++
      Fetch-One $it
    }
    if ($tried -eq 0) { Skip 'nothing to download: every address above was already wrong or could not be listed.' }
  }

  # ---- Steam, which the feed does not name
  Head 'Steam'
  Check-Steam $SteamRecord
  Skip ('whether the three depot manifests launcher\app\Downgrade.cs pins at 1.6.1170 can still be downloaded.' +
        ' Steam hands a depot only to an account that owns the game, so that stays a check by hand.')

  # ---- Nexus (same anonymous GraphQL POST as Watch-Outside / #1063)
  Head 'Nexus'
  $c = $Collection
  if ($v -and $v.collectionUrl) { $c = [string]$v.collectionUrl }
  if (-not $c) { Skip 'the collection: there is no collection address in the feed or in Config.cs.' }
  elseif (On-Server $c) { Skip 'the collection: its address in the feed is on the server, which this does not contact.' }
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
# not a run against the real feed.
if ($MyInvocation.InvocationName -eq '.') { return }

$d = Read-Defaults (Join-Path $Here '..\..\launcher\app\Config.cs')
if (-not $Repo) { $Repo = $d.Repo }
# The feed launchers read is the site's (#907), unless a repository or an
# address was named.
$fromSite = $false
if (-not $FeedUrl -and -not $Repo) {
  $FeedUrl = 'https://' + $d.SiteHost + $(if ($Branch -eq 'dev') { '/feed-dev' } else { '/feed' }) + '/version.json'
  $fromSite = $true
}
if (-not $SteamRecord) { $SteamRecord = Join-Path $Here '..\..\records\steam-build.json' }
$allowed = Read-AllowedHosts (Join-Path $Here '..\..\launcher\app\Updater.cs')

Write-Host ''
Write-Host '  THORNSWOOD  -  what a first install needs that we do not run' -ForegroundColor White

$problems = Invoke-Outside -Repo $Repo -Branch $Branch -FeedUrl $FeedUrl -Hosts $allowed -SteamRecord $SteamRecord `
  -Collection $d.Collection -Server @($d.SiteHost, $d.ServerAddress) -FeedFromSite:$fromSite
if ($problems -gt 0) { exit 1 }
exit 0
