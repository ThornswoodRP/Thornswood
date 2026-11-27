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
  So a Release whose package nobody can download, or a Steam update that
  changes what a new install starts from, was found out when a person could
  not get in.

  What it asks, all of it anonymously, the way a launcher on somebody's
  machine asks with no token of its own:

    the Releases  the launcher's own repository's Releases (Velo.Repo in
                  launcher\app\Velo.cs), a hundred a page and at most five
                  pages, as launcher\app\GitHub.cs reads them. The channel's
                  Release is the newest published one carrying its Velopack
                  feed, releases.<channel>.json, which is the one every
                  launcher on that channel goes to (VeloUpdate.cs, THE
                  CHANNEL'S RELEASE). Its feed is read through the asset API
                  with Accept octet-stream, as the launcher reads it.
    what it names the newest full package the feed names has to be a file
                  of that Release that GitHub finished taking, of the size and
                  sha256 the feed gives, or the launcher fetches it and refuses
                  it. The Release has to carry setup-files.<channel>.json,
                  the files beside Game a first start reads, and the
                  installer, Thornswood-Setup.exe (Thornswood-Dev-Setup.exe on
                  dev), which is what a new person downloads.
    the bytes     the package and the installer, asked for the way the
                  launcher asks (Accept octet-stream), then the first byte of
                  wherever GitHub sends that on to.
    Steam         the public build of Skyrim Special Edition, against the one
                  written down in steam-build.json. It comes from
                  api.steamcmd.net, a third party and not Valve, so when that
                  does not answer it is "unchecked", not a fault here.
    Nexus         the collection the launcher ships with (Config.Collection),
                  through the same anonymous GraphQL POST Watch-Outside uses
                  (api.nexusmods.com/v2/graphql). Name and revision when it
                  answers, and its summary and description against
                  records\collection-page.json (requires Node). Red when Nexus
                  says there is no such collection or the text differs;
                  "unchecked" only when Nexus does not answer at all. A plain
                  page request still gets 403 and is not used.

  Until 27 Nov 2026 this walked the site's version.json, its packs and the
  AllowedHosts list in Updater.cs, none of which a launcher has read since it
  took its updates from GitHub's Releases through Velopack (#5608, #5796). So
  it was red on every run, its harness with it, and said nothing about the
  path a launcher does take (#7114).

  What it cannot ask: whether the three depot manifests Downgrade.cs pins at
  1.6.1170 can still be downloaded. Steam hands a depot only to an account
  that owns the game, so that stays a check by hand.

  When Steam's public build moves this goes red on purpose, because that is
  the day somebody should try the downgrade on one machine. Once it works,
  write the new build into records\steam-build.json and it goes green again.

  Read only. It sends no token and reads no config.json, and it never
  contacts the server: thornswood.net and the game server are the VPS, and
  Watch-Services and Check-Site are what look at those. An address that
  points at the server is reported and not requested. The signed download
  address GitHub redirects to is never printed, only its host, because the
  address is itself a credential for as long as it lasts.

  Exits 1 when anything is wrong or has moved, 0 when nothing has.
#>
[CmdletBinding()]
param(
  # owner/name of the repository whose Releases the launcher reads. Left out,
  # it is the launcher's own, Velo.Repo.
  [string]$Repo,
  # main is the live channel, dev the dev one.
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

# ------------------------------------------------------------ what the launcher reads
# The launcher's repository, from Velo.cs, and the collection and the server,
# from its own config, which is the one place Set-Vps.ps1 and a rename keep
# them true.
function Read-Defaults([string]$configCs, [string]$veloCs = '') {
  $o = @{ Repo = ''; Collection = ''; SiteHost = 'thornswood.net'; ServerAddress = '' }
  if (-not $veloCs) { $veloCs = Join-Path (Split-Path -Parent $configCs) 'Velo.cs' }
  if (Test-Path -LiteralPath $veloCs) {
    $m = [regex]::Match([IO.File]::ReadAllText($veloCs), 'const\s+string\s+Repo\s*=\s*"([^"/\s]+/[^"\s]+)"')
    if ($m.Success) { $o.Repo = $m.Groups[1].Value }
  }
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

# The installer a new person downloads, by channel (merge-release.yml, the
# Velopack step).
function Setup-Name([string]$channel) {
  if ($channel -eq 'dev') { return 'Thornswood-Dev-Setup.exe' }
  return 'Thornswood-Setup.exe'
}

# The file called $name a Release carries and GitHub finished taking, or $null.
function File-Of($rel, [string]$name) {
  foreach ($a in @($rel.assets)) {
    if ($null -eq $a) { continue }
    if ([string]$a.name -ne $name) { continue }
    if ($a.PSObject.Properties['state'] -and $a.state -and [string]$a.state -ne 'uploaded') { continue }
    return $a
  }
  return $null
}

# GitHub's sha256 of a file, lower case, or '' when it gave none.
function Digest-Of($a) {
  $d = ''
  if ($a.PSObject.Properties['digest']) { $d = [string]$a.digest }
  if ($d -match '^sha256:([0-9a-fA-F]{64})$') { return $Matches[1].ToLowerInvariant() }
  return ''
}

# "1.3.135" and "1.3.135-x" as numbers to compare, $null when it is not one.
function Version-Of([string]$v) {
  $out = $null
  if ([version]::TryParse(([string]$v).Split('-')[0], [ref]$out)) { return $out }
  return $null
}

# Every Release a stranger can see, the way GitHub.Releases reads them: a
# hundred a page, five pages at most, drafts and unpublished ones left out,
# newest published first.
function Read-Releases([string]$api) {
  $all = New-Object 'System.Collections.Generic.List[object]'
  $url = $api + '/releases?per_page=100'
  for ($page = 0; $page -lt 5 -and $url; $page++) {
    $p = Ask $url 'application/vnd.github+json' -Body
    if ($p.code -ne 200) { return @{ ok = $false; probe = $p; list = $all } }
    $list = $null
    try { $list = $p.body | ConvertFrom-Json } catch { return @{ ok = $false; probe = @{ code = 0; error = 'the listing was not JSON' }; list = $all } }
    foreach ($rel in @($list)) {
      if ($null -eq $rel -or $rel.draft -or -not $rel.published_at -or -not $rel.tag_name) { continue }
      $all.Add($rel)
    }
    $url = Next-Link $p.link
  }
  $sorted = @($all | Sort-Object -Property @{ Expression = { [DateTimeOffset]$_.published_at } } -Descending)
  return @{ ok = $true; list = $sorted }
}

# The body of a Release's file through its API address, as GitHub.Download
# fetches it: Accept octet-stream, GitHub answers 302 to its storage, and the
# body comes from there. A hashtable with ok, body, and why when it is not ok.
function Read-File($a) {
  $p = Ask ([string]$a.url) 'application/octet-stream' -Body
  if (Spent $p) { return @{ ok = $false; why = ([string]$a.name + ' was not read. ' + (Allowance)) } }
  if (($p.code -eq 301 -or $p.code -eq 302 -or $p.code -eq 307) -and $p.location) {
    $to = Host-Of $p.location
    $p = Ask $p.location '' -Body
    if ($p.code -ne 200) { return @{ ok = $false; why = ('GitHub sends ' + [string]$a.name + ' on to ' + $to + ', which answers ' + (Answer $p) + '.') } }
  }
  elseif ($p.code -ne 200) { return @{ ok = $false; why = ('GitHub answers ' + (Answer $p) + ' when a launcher asks for ' + [string]$a.name + '.') } }
  return @{ ok = $true; body = $p.body }
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
        Bad ($it.Name + ' is ' + $total + ' bytes at ' + $to + ' and GitHub lists it at ' + $it.Bytes + '. The launcher will fetch it and refuse it.')
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
    [string[]]$Server
  )
  $script:Problems = 0
  $script:Found = New-Object 'System.Collections.Generic.List[object]'
  $script:Left = ''; $script:Reset = ''
  $script:ServerHosts = @(@($Server) | Where-Object { $_ })

  $feedName = 'releases.' + $Branch + '.json'
  $setupList = 'setup-files.' + $Branch + '.json'
  $setupExe = Setup-Name $Branch
  $api = 'https://api.github.com/repos/' + $Repo
  Say ('  releases  ' + $api + '/releases, the ' + $Branch + ' channel') 'DarkGray'

  # ---- the channel's Release
  Head 'The launcher on GitHub'
  $rel = $null
  if (-not $Repo) {
    Bad 'could not read the launcher''s repository out of launcher\app\Velo.cs, so no Release was checked.'
  } else {
    $r = Read-Releases $api
    if (-not $r.ok) {
      $p = $r.probe
      if (Spent $p) { Bad ('the Releases were not listed. ' + (Allowance)) }
      elseif ($p.code -eq 404) { Bad ($Repo + ' answers a stranger with 404: it is private, or it is gone, and no launcher can find an update or an install there.') }
      else { Bad ('could not list the Releases in ' + $Repo + ': ' + (Answer $p) + '. No launcher can find an update there either.') }
    } else {
      foreach ($x in @($r.list)) { if (File-Of $x $feedName) { $rel = $x; break } }
      if (-not $rel) {
        Bad ('none of the ' + @($r.list).Count + ' published Releases a stranger can see in ' + $Repo + ' carries ' + $feedName +
             ', so no launcher on ' + $Branch + ' can find an update, and a new install has nothing to take.')
      } else {
        $when = ''
        try { $when = ', published ' + ([DateTimeOffset]$rel.published_at).UtcDateTime.ToString('d MMM yyyy HH:mm', [Globalization.CultureInfo]::InvariantCulture) + ' UTC' } catch { }
        Ok ('the ' + $Branch + ' channel is on ' + $rel.tag_name + $when + ', the newest Release that carries ' + $feedName + '.')
      }
    }
  }

  # ---- what its feed names
  $fetch = @()
  if ($rel) {
    $feed = $null
    $got = Read-File (File-Of $rel $feedName)
    if (-not $got.ok) { Bad ($feedName + ' on ' + $rel.tag_name + ' cannot be read: ' + $got.why + ' No launcher on ' + $Branch + ' can check for an update.') }
    else {
      try { $feed = ([string]$got.body).TrimStart([char]0xFEFF) | ConvertFrom-Json } catch { $feed = $null }
      if ($null -eq $feed -or $null -eq $feed.Assets) {
        Bad ($feedName + ' on ' + $rel.tag_name + ' answers but is not a Velopack feed: it is not JSON, or it names no packages.')
        $feed = $null
      }
    }
    if ($feed) {
      $full = $null
      foreach ($e in @($feed.Assets)) {
        if ($null -eq $e -or [string]$e.Type -ne 'Full') { continue }
        $v = Version-Of ([string]$e.Version)
        if ($null -eq $v) { continue }
        if ($null -eq $full -or $v -gt (Version-Of ([string]$full.Version))) { $full = $e }
      }
      if (-not $full) {
        Bad ($feedName + ' on ' + $rel.tag_name + ' names no full package, so the launcher takes nothing from it.')
      } else {
        $pkg = File-Of $rel ([string]$full.FileName)
        $sha = ([string]$full.SHA256).ToLowerInvariant()
        if (-not $pkg) {
          Bad ($feedName + ' names ' + $full.FileName + ' (' + $full.Version + '), and ' + $rel.tag_name + ' carries no finished file of that name. The launcher will find the update and fail to fetch it.')
        }
        elseif ([long]$pkg.size -ne [long]$full.Size) {
          Bad ($full.FileName + ' is ' + $pkg.size + ' bytes on ' + $rel.tag_name + ' and ' + $feedName + ' says ' + $full.Size + '. The launcher will fetch it and refuse it.')
        }
        elseif ((Digest-Of $pkg) -and $sha -and (Digest-Of $pkg) -ne $sha) {
          Bad ($full.FileName + ' on ' + $rel.tag_name + ' has the sha256 ' + (Digest-Of $pkg) + ' and ' + $feedName + ' says ' + $sha + '. The launcher will fetch it and refuse it.')
        }
        else {
          Ok ($feedName + ' names launcher ' + $full.Version + ', ' + $full.FileName + ', and the Release carries it at the size' + $(if (Digest-Of $pkg) { ' and sha256' } else { '' }) + ' the feed gives.')
          $fetch += [pscustomobject]@{ Name = $full.FileName; Url = [string]$pkg.url; Bytes = [long]$pkg.size }
        }
      }
    }
    if (File-Of $rel $setupList) { Ok ($rel.tag_name + ' carries ' + $setupList + ', the files a first start reads beside Game.') }
    else { Bad ($rel.tag_name + ' carries no ' + $setupList + ', so a launcher that takes it cannot check the files a first start reads, and refuses it.') }
    $exe = File-Of $rel $setupExe
    if ($exe) {
      Ok ($rel.tag_name + ' carries ' + $setupExe + ', the installer a new person downloads.')
      $fetch += [pscustomobject]@{ Name = $setupExe; Url = [string]$exe.url; Bytes = [long]$exe.size }
    }
    else { Bad ($rel.tag_name + ' carries no ' + $setupExe + ', so nobody new can install from the ' + $Branch + ' channel.') }
  }

  # ---- the bytes, for what a launcher and a new person fetch
  Head 'The downloads'
  foreach ($it in $fetch) {
    if (On-Server $it.Url) { Skip ($it.Name + ' is on the server, which this does not contact.'); continue }
    Fetch-One $it
  }
  if ($fetch.Count -eq 0) { Skip 'nothing to download: nothing above could be found to fetch.' }
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
# not a run against the real feed.
if ($MyInvocation.InvocationName -eq '.') { return }

$d = Read-Defaults (Join-Path $Here '..\..\launcher\app\Config.cs')
if (-not $Repo) { $Repo = $d.Repo }
if (-not $SteamRecord) { $SteamRecord = Join-Path $Here '..\..\records\steam-build.json' }

Write-Host ''
Write-Host '  THORNSWOOD  -  what a first install needs that we do not run' -ForegroundColor White

$problems = Invoke-Outside -Repo $Repo -Branch $Branch -SteamRecord $SteamRecord `
  -Collection $d.Collection -Server @($d.SiteHost, $d.ServerAddress)
if ($problems -gt 0) { exit 1 }
exit 0
