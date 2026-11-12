<#
  Watch-Outside.ps1

  Watches, from outside the VPS, the things the project needs that the VPS
  cannot watch for itself, and tells staff in Discord when one breaks and
  again when it is fixed.

      ./Watch-Outside.ps1                     look once and print it; remembers and posts nothing
      ./Watch-Outside.ps1 -Run -Folder state  one pass: remember, tell, post
      ./Watch-Outside.ps1 -Run -Folder state -For 55
                                              a pass every -Minutes by the clock for 55 minutes (what the workflow runs, #4170)
      ./Watch-Outside.ps1 -TestPost           post one test message through WATCH_WEBHOOK
      ./Watch-Outside.ps1 -Export <folder>    write the public repository's files into <folder>
      .\scripts\vps\Watch-Outside.ps1 -Remove take the old scheduled task off a Windows machine (One), from an administrator shell

  WHY (issue #448). Watch-Services.ps1 runs on the VPS and watches the
  services there, and since #447 it tells staff when one dies. But a box
  cannot see itself die: when the whole VPS or its network goes, the watcher
  and the bot that posts for it go with it, and nothing says a word. So this
  runs somewhere else and asks what a stranger on the internet would see.

  WHERE IT RUNS (issue #2755, Patrick's option A on #2750, 19 Oct 2026). Until
  then it was a scheduled task on One, so it saw nothing while One was off.
  Now it runs on GitHub's Linux runners, under PowerShell 7, from a small
  public repository that holds only this script, its settings and the
  workflow (-Export writes them; scripts\vps\watch-outside\ holds the
  workflow and the README). Actions minutes on a public repository are not
  billed. It cannot run on the VPS runners, because it has to be off the box.
  After this script changes, run -Export into a clone of that repository and
  push it, or the runner keeps asking with the old copy.

  WHAT IT ASKS, measured from One on 28 September:
    site      https://thornswood.net/ answers over HTTPS with a certificate
              the runner accepts (200 in 213 ms that day). Two runs in a row
              before it counts, so one slow answer is not an outage.
    feed      https://thornswood.net/feed/version.json and feed-dev answer
              200 with a feed in them (a launcherUrl and the release record
              the launcher syncs from, baseline.id), and the launcher each one
              names answers its first byte. Since #1050 a feed carries no
              packs on purpose, so packs are not asked for. Launchers from
              before #5608 read these to update; a launcher since reads
              GitHub's Releases instead, and the feeds come off the site,
              and off this list, with #5783. The site is Config.cs's
              SiteUrl, and the feeds are /feed and /feed-dev on it.
    cert      the certificate a visitor gets on thornswood.net has more than
              14 days left. Since #2995 that is Cloudflare's own, which
              Cloudflare renews itself; Caddy's on the box can no longer be
              reached from here (the box takes 443 only from Cloudflare), so
              the box's watchdog asks it (Watch-Services.ps1, cert).
    dns       thornswood.net resolves only into Cloudflare's ranges
              (scripts\deploy\cloudflare-ranges.txt), so its proxy is on.
              The name servers are Cloudflare's (brenna and
              robert.ns.cloudflare.com). Since #2995 (Patrick's A, 21 Oct
              2026) the box takes 80 and 443 only from those ranges, so a
              record pointing straight at the VPS reaches nobody: that is
              what this tells.
    ranges    Cloudflare's published ranges (api.cloudflare.com/client/v4/ips)
              are still the ones in cloudflare-ranges.txt, once a day. The
              Caddyfile trusts that list and the box's firewall takes 443
              from it, so a range Cloudflare adds is visitors refused.
    game      the game's own name (vps.json's address since #3690)
              resolves, and not into Cloudflare's ranges. Every
              launcher writes it into the game's settings and asks the
              server's resources by it, so a name that does not resolve is
              nobody able to play. It is DNS only on purpose: the game port
              is UDP, which Cloudflare's free plan does not carry. The run
              log says only ok or WRONG, never the address it resolves to.
    domain    the registration has more than 30 days left, once a day.
              Registered 15 September 2026 through Cloudflare, runs out 15
              September 2027 (RDAP, rdap.org).
    runner    GitHub lists every box runner as online: thornswood-vps and
              the numbered ones beside it, thornswood-vps-2 and up
              (Install-Runner.ps1 -Number, 4 October). Since the flip
              (#4013, 30 Oct 2026) they are registered to the private
              ThornswoodRP/Thornswood-Ops, where the box's own jobs run,
              and the public repository has none on purpose (#3792), so
              that is the repository asked. Asked over REST with
              WATCH_RUNNER_TOKEN, which watch-outside.yml fills with a token
              of the thornswood-watch App, minted each run, that can only
              read that repository's runners (Administration: read on it
              alone; #5259).
              With none online, the box's jobs (deploys through the gate,
              staff notices from cloud threads, the admin App's asks) wait;
              with some, they wait longer. Three runs in a row, because a
              runner restarts itself when it updates.
    nexus     the Nexus collection still exists, once an hour. Nexus refuses
              a plain page request (403), but its public GraphQL answers a
              stranger: collection "Thornswood", revision 1, that day.

  What it no longer asks, since it left One: the copy of the backups off the
  VPS is judged by the watchdog on the box now, from what Fetch-Backups.ps1
  tells it after each copy it checks (Watch-Services.ps1 offbox), so it is
  told while One is off, which is when it falls behind. Code signing was
  asked with One's own az sign in, which a runner does not have. Decided by
  Patrick on 20 Oct 2026 (#2755, option A): it is asked only when a machine
  signs, by Ship and Setup-ShipMachine.ps1 with the pinned identity, so no
  new identity gets any access to the signing account.

  Also measured and not asked on every run: the VPS is BisectHosting,
  which has no status page to ask, and the site
  check above is what notices the box going. Discord's API answered 200 in
  122 ms; it is the path the messages go out on, so there is nothing to tell
  anybody through when it is down. A message that cannot be posted waits and
  is tried again every run for a day.

  THREE OUTCOMES (issue #2857). A check says Ok, Wrong, or that it could not
  check. It could not check when the service it had to ask is not the thing
  it watches and did not answer, or refused: GitHub for the runners, the
  registry for the domain, the site's handshake for its certificate. On 19
  October One's own call to GitHub timed out and the message said the
  runners were down while all four were online. Could not check never counts
  as the thing being down and never resets an outage already told; it is
  watched on its own, and after about an hour of runs in a row (two runs for
  the hourly and daily checks) it is told once, as "the outside watcher
  cannot check ...", and once more when it can again. A token that ran out
  is told that way instead of never. Nothing is asked twice in a run: a
  retry would hide a real outage of the network it asks over.
  Where the service asked IS the thing watched (the site, the feeds, Nexus,
  the name), not answering is Wrong. That this runner is the one offline is
  ruled out first: when neither GitHub nor Discord answers, the run writes
  that and changes nothing, so a dropped connection is never an outage.

  HOW A PERSON IS TOLD: straight to #staff-updates through the Discord
  webhook in WATCH_WEBHOOK, a secret of the public repository: the same
  webhook the VPS watchdog keeps. No mentions, so nothing can ping anybody.
  The first run that finds something wrong (or the second or third, as above)
  writes ONE message saying what is wrong and when it was first noticed; the
  message saying it is fixed comes once it has been fine on two runs in a
  row, so a thing that flaps is one outage and two messages. Each message is
  a line in alerts.jsonl in the state folder (id, at, service, kind, text,
  the VPS outbox's shape; the ids start "outside-"), and one that Discord did
  not take is tried again every run for a day. A runner cannot reach the box
  over ssh, so these lines no longer reach the box's alerts.jsonl, and
  Read-Availability.ps1 reads the box's own caddy check for the site.

  WHERE ITS MEMORY LIVES. A runner starts empty every time, so what is down,
  when each hourly check was last asked, the outbox and what was posted live
  in the -Folder the workflow keeps in the Actions cache: restored at the
  start of a run from the newest one, saved under a new key at the end. Not
  in a commit, because a commit to a public repository is public and the
  messages name private things (the runners), and not as an artifact, which
  anybody can download. Fork pull requests' workflows could read the cache,
  which is why the repository needs approval for every outside
  contributor's workflow (its README says so).

  THE RUN LOG IS PUBLIC. Everything -Run prints says only what anybody can
  already see: the site, feeds, certificate, name, registration and the
  collection are public, and for the runners (a private repository's) it
  prints only the outcome, never a name or a count. When it could not ask, it
  prints why, because each reason Get-Runners gives is a fixed sentence with
  at most an HTTP code in it (a token GitHub refuses, GitHub not answering)
  and names nothing in that repository. Hidden, a token that did not work
  could not be told from the log apart from one that was never set (#2755,
  21 Oct: RUNNER_TOKEN was set and the line said only COULD NOT CHECK). The
  secrets
  are never printed (GitHub masks them too), and a message's text goes only
  to Discord, never to the log.

  tests\test-watch-outside.ps1 drives the real code below against fakes.
#>
[CmdletBinding()]
param(
  [string]$Folder   = '',
  [int]$Minutes     = 5,
  [int]$For         = 0,
  [string]$Export   = '',
  [string]$TaskName = 'Thornswood Watch Outside',
  [switch]$Run,
  [switch]$TestPost,
  [switch]$Remove,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

# ------------------------------------------------------------ settings ---
# What it asks is read out of the repository, so an address changed there is
# changed here. The public repository has no Thornswood repository beside it
# and reads watch-outside.json, which -Export writes from these: only the
# keys in $PublicSettings, each something anybody can already see or a name
# the runner check needs.
$PublicSettings = @('Site', 'SiteHost', 'Feeds', 'GameHost', 'FrontRanges', 'Repo', 'RunnerName', 'NexusGame', 'NexusSlug', 'StaffChannel', 'CertDays', 'DomainDays')

function Read-Settings([string]$repo, [string]$saved) {
  $s = @{
    Site = 'https://thornswood.net/'; SiteHost = 'thornswood.net'
    Feeds = @(); GameHost = ''; FrontRanges = @(); StaffChannel = ''
    # The repository the box's runners are registered to (#4013).
    Repo = 'ThornswoodRP/Thornswood-Ops'; RunnerName = 'thornswood-vps'
    # The repository whose Deployments the box deploy agent applies (deploys).
    DeployRepo = $(if ($env:GITHUB_REPOSITORY) { $env:GITHUB_REPOSITORY } else { 'ThornswoodRP/Thornswood' })
    DeployEnvs = @('Dev', 'Main', 'Site', 'Discord bot'); DeployMinutes = 15
    NexusGame = ''; NexusSlug = ''
    CertDays = 14; DomainDays = 30; Minutes = $(if ($Minutes) { $Minutes } else { 5 })
  }
  $config = Join-Path $repo 'launcher/app/Config.cs'
  if ($repo -and (Test-Path -LiteralPath $config)) {
    $cfg = Get-Content -LiteralPath $config -Raw
    # The site the launcher names (Config.cs's SiteUrl). The launcher stopped
    # reading the update feeds with #5608; they stay on the site for older
    # launchers until #5783, so they are watched until then.
    $site = [regex]::Match($cfg, 'public string SiteUrl\s*=\s*"(https://[^"/]+)"').Groups[1].Value
    $s.SiteHost = ([uri]$site).Host
    $s.Site = 'https://' + $s.SiteHost + '/'
    $s.Feeds = @(@{ Name = 'feed'; Say = 'The live update feed'; Url = $s.Site + 'feed/version.json' }, @{ Name = 'feed-dev'; Say = 'The dev update feed'; Url = $s.Site + 'feed-dev/version.json' })
    $m = [regex]::Match($cfg, 'nexusmods\.com/games/([A-Za-z0-9]+)/collections/([A-Za-z0-9]+)')
    $s.NexusGame = $m.Groups[1].Value; $s.NexusSlug = $m.Groups[2].Value
    # Through Vps.ps1, so this machine's own VPS file and THORNSWOOD_VPS count
    # (#459). Since #3690 that is the game's own name, never the box's
    # address, so the address is in no file here or in the export.
    . (Join-Path $repo 'scripts/vps/Vps.ps1')
    $s.GameHost = Get-ThornswoodVpsAddress
    # Cloudflare's ranges, the ones the box takes 443 from (#2995).
    $cf = Join-Path $repo 'scripts/deploy/cloudflare-ranges.txt'
    if (Test-Path -LiteralPath $cf) { $s.FrontRanges = @(Get-Content -LiteralPath $cf | ForEach-Object { ("$_" -replace '#.*$', '').Trim() } | Where-Object { $_ }) }
    # #staff-updates, the channel the bot says the watchdog's messages in and
    # so the one the webhook has to post in: the id the bot reads (#2501).
    $sc = Join-Path $repo 'bot/staff-channel.txt'
    if (Test-Path -LiteralPath $sc) { $s.StaffChannel = ("$(Get-Content -LiteralPath $sc -Raw)").Trim() }
    if ($s.StaffChannel -notmatch '^\d{17,20}$') { $s.StaffChannel = '' }
    return $s
  }
  if ($saved -and (Test-Path -LiteralPath $saved)) {
    $j = Get-Content -LiteralPath $saved -Raw | ConvertFrom-Json
    foreach ($p in $j.PSObject.Properties) { if ($PublicSettings -contains $p.Name) { $s[$p.Name] = $p.Value } }
    $s.Feeds = @($j.Feeds | ForEach-Object { @{ Name = $_.Name; Say = $_.Say; Url = $_.Url } })
    $s.FrontRanges = @($j.FrontRanges | Where-Object { $_ } | ForEach-Object { '' + $_ })
    return $s
  }
  throw 'Neither the repository (launcher/app/Config.cs) nor watch-outside.json is beside this script, so there is nothing to say what to ask.'
}

# -------------------------------------------------- asking the internet ---
# Every request this script makes goes through the functions below, and the
# harness replaces exactly these. None of them ever prints a token or the
# webhook's address.

function Get-Now { return (Get-Date) }

# An HTTP answer: Code (0 when there was none), Body, and Error in words.
# HttpWebRequest because it says why there was no answer (a timeout, a name
# that does not resolve, a refused connection) as a status, the same on
# Windows and on Linux, and because it asks for one byte with a Range header.
function Get-Http([string]$url, [string]$method = 'GET', [string]$body = '', [hashtable]$headers = @{}, [switch]$FirstByte, [int]$timeout = 20) {
  $r = @{ Code = 0; Body = ''; Error = '' }
  $resp = $null
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $q = [Net.HttpWebRequest]::Create($url)
    $q.Method = $(if ($method) { $method } else { 'GET' })
    $q.Timeout = $timeout * 1000
    $q.ReadWriteTimeout = $timeout * 1000
    $q.UserAgent = 'Thornswood-Watch-Outside'
    $q.AllowAutoRedirect = $true
    foreach ($k in $headers.Keys) {
      if ($k -eq 'Accept') { $q.Accept = $headers[$k] } else { $q.Headers[$k] = $headers[$k] }
    }
    if ($FirstByte) { $q.AddRange(0, 0) }
    if ($body) {
      $bytes = [Text.Encoding]::UTF8.GetBytes($body)
      $q.ContentType = 'application/json; charset=utf-8'
      $q.ContentLength = $bytes.Length
      $st = $q.GetRequestStream(); $st.Write($bytes, 0, $bytes.Length); $st.Close()
    }
    $resp = $q.GetResponse()
  } catch {
    $e = $_.Exception
    while ($e -and -not ($e -is [Net.WebException])) { $e = $e.InnerException }
    if ($e -and $e.Response) { $resp = $e.Response }
    else {
      $st = ''
      if ($e) { $st = '' + $e.Status }
      switch ($st) {
        'Timeout'               { $r.Error = ('did not answer within ' + $timeout + ' seconds') }
        'NameResolutionFailure' { $r.Error = 'its name does not resolve' }
        'ConnectFailure'        { $r.Error = 'refused the connection or could not be reached' }
        'TrustFailure'          { $r.Error = 'its certificate was not accepted' }
        'SecureChannelFailure'  { $r.Error = 'the secure connection could not be set up' }
        default                 { $r.Error = $(if ($st) { 'could not be reached (' + $st + ')' } else { 'could not be reached' }) }
      }
      return $r
    }
  }
  try {
    $r.Code = [int]$resp.StatusCode
    if (-not $FirstByte) {
      $rd = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
      $r.Body = $rd.ReadToEnd()
      $rd.Close()
    }
  } catch { $r.Error = 'the answer broke off' }
  finally { $resp.Close() }
  return $r
}

# The certificate the site presents: NotAfter (UTC), Problems (this
# machine's trust store's verdict, 'None' when it accepts it) and Error when
# there was no handshake.
function Get-Cert([string]$hostName) {
  $r = @{ NotAfter = $null; Problems = ''; Error = '' }
  $c = $null; $s = $null
  $box = @{ E = 'None' }
  try {
    $c = New-Object Net.Sockets.TcpClient
    $ar = $c.BeginConnect($hostName, 443, $null, $null)
    if (-not $ar.AsyncWaitHandle.WaitOne(15000)) { $r.Error = 'did not answer on 443 within 15 seconds'; return $r }
    $c.EndConnect($ar)
    $cb = { param($a, $b, $d, $e) $box.E = '' + $e; return $true }.GetNewClosure()
    $s = New-Object Net.Security.SslStream($c.GetStream(), $false, [Net.Security.RemoteCertificateValidationCallback]$cb)
    $s.ReadTimeout = 15000; $s.WriteTimeout = 15000
    $s.AuthenticateAsClient($hostName)
    $x = New-Object Security.Cryptography.X509Certificates.X509Certificate2($s.RemoteCertificate)
    $r.NotAfter = $x.NotAfter.ToUniversalTime()
    $r.Problems = $box.E
  } catch { $r.Error = 'no TLS handshake on 443' }
  finally {
    if ($s) { $s.Dispose() }
    if ($c) { $c.Close() }
  }
  return $r
}

# Addresses the name resolves to, through this machine's resolver.
function Get-Dns([string]$name) {
  try { return @{ Addresses = @([Net.Dns]::GetHostAddresses($name) | ForEach-Object { $_.IPAddressToString }); Error = '' } }
  catch { return @{ Addresses = @(); Error = 'does not resolve' } }
}

# GitHub's list of the repository's runners, over REST with the token in
# WATCH_RUNNER_TOKEN. Error says why there is no list; the words never hold
# the token or the repository's name, because the check prints its reason
# into the run log only when it is about something public, and this is not.
function Get-Runners([string]$repo) {
  $token = ('' + $env:WATCH_RUNNER_TOKEN).Trim()
  if (-not $token) { return @{ Runners = @(); Error = 'no runner token is set here (WATCH_RUNNER_TOKEN)' } }
  $a = Get-Http ('https://api.github.com/repos/' + $repo + '/actions/runners?per_page=100') 'GET' '' @{ Authorization = ('Bearer ' + $token); Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
  $token = $null
  if ($a.Code -eq 0) { return @{ Runners = @(); Error = ('GitHub ' + $a.Error) } }
  if (@(401, 403, 404) -contains $a.Code) { return @{ Runners = @(); Error = ('GitHub refused the runner token (HTTP ' + $a.Code + '): it has run out or been revoked, or it cannot read the runners') } }
  if ($a.Code -ne 200) { return @{ Runners = @(); Error = ('GitHub answered HTTP ' + $a.Code) } }
  try {
    $j = $a.Body | ConvertFrom-Json
    if (-not $j -or -not $j.PSObject.Properties['runners']) { throw 'no runners in it' }
    return @{ Runners = @($j.runners | ForEach-Object { @{ Name = '' + $_.name; Status = '' + $_.status; Busy = [bool]$_.busy } }); Error = '' }
  } catch { return @{ Runners = @(); Error = 'GitHub''s answer was not the runner list' } }
}

# '' when Discord took the message, else a short reason that never holds
# the address. No mentions, so nothing in a message can ping anybody.
function Send-Webhook([string]$url, [string]$text) {
  $body = ConvertTo-Json @{ content = $text; allowed_mentions = @{ parse = @() } } -Compress
  $a = Get-Http $url 'POST' $body @{} -timeout 15
  if ($a.Code -ge 200 -and $a.Code -lt 300) { return '' }
  if ($a.Code -gt 0) { return ('HTTP ' + $a.Code) }
  return 'Discord could not be reached'
}

# Where a webhook posts, asked of Discord: a GET on the webhook's own address
# answers with its channel_id, so no token is involved. Channel is '' and Why
# says why when Discord would not say; neither ever holds the address.
function Webhook-Channel([string]$url) {
  $a = Get-Http $url 'GET' '' @{} -timeout 15
  if ($a.Code -ge 200 -and $a.Code -lt 300) {
    try {
      $o = $a.Body | ConvertFrom-Json
      if ($o -and $o.PSObject.Properties['channel_id'] -and ('' + $o.channel_id)) { return @{ Channel = ('' + $o.channel_id); Why = '' } }
    } catch { }
    return @{ Channel = ''; Why = 'Discord answered without a channel' }
  }
  if ($a.Code -eq 401 -or $a.Code -eq 404) { return @{ Channel = ''; Why = ('Discord answered ' + $a.Code + ', so that webhook does not exist any more or the address is not whole') } }
  if ($a.Code -gt 0) { return @{ Channel = ''; Why = ('Discord answered ' + $a.Code) } }
  return @{ Channel = ''; Why = 'Discord could not be reached' }
}

# ------------------------------------------------------------ the checks ---
# Each gives @{ Bad; Unknown; Why; Line }: Why is what a message says is
# wrong, or why it could not check; Line what the printed table says.

function Ok($line) { return @{ Bad = $false; Unknown = $false; Why = ''; Line = $line } }
function Wrong($why) { return @{ Bad = $true; Unknown = $false; Why = $why; Line = $why } }
function Unknown($why) { return @{ Bad = $false; Unknown = $true; Why = $why; Line = $why } }

function Check-Site($S) {
  $a = Get-Http $S.Site -FirstByte
  if ($a.Code -ge 200 -and $a.Code -lt 400) { return (Ok ('answered ' + $a.Code)) }
  if ($a.Code -gt 0) { return (Wrong ($S.Site + ' answered HTTP ' + $a.Code)) }
  return (Wrong ($S.Site + ' ' + $a.Error))
}

function Check-Feed($S, $feed) {
  $a = Get-Http $feed.Url '' '' @{ Accept = 'application/json' }
  if ($a.Code -ne 200) {
    if ($a.Code -gt 0) { return (Wrong ($feed.Url + ' answered HTTP ' + $a.Code)) }
    return (Wrong ($feed.Url + ' ' + $a.Error))
  }
  $j = $null
  try { $j = $a.Body | ConvertFrom-Json } catch { }
  # A feed is a launcher to update to and the release record launchers sync
  # from (baseline.id). Packs are not asked for: since #1050 a feed carries
  # none, on purpose.
  $record = ''
  if ($j -and $j.PSObject.Properties['baseline'] -and $j.baseline -and $j.baseline.PSObject.Properties['id']) { $record = '' + $j.baseline.id }
  if (-not $j -or -not $j.launcherUrl -or -not $record) {
    return (Wrong ($feed.Url + ' answered, but not with a feed: no launcherUrl or no release record (baseline.id) in it'))
  }
  $l = Get-Http ('' + $j.launcherUrl) -FirstByte
  if ($l.Code -ne 200 -and $l.Code -ne 206) {
    $said = $(if ($l.Code -gt 0) { 'answered HTTP ' + $l.Code } else { $l.Error })
    return (Wrong ('the feed answers, but the launcher it names, ' + $j.launcherUrl + ', ' + $said))
  }
  return (Ok ('answered, release ' + $record + ', launcher ' + $j.launcherVersion + ' downloads'))
}

# No handshake is the site's own outage, which the site check tells; the
# certificate could not be read, which says nothing about its dates.
function Check-Cert($S) {
  $c = Get-Cert $S.SiteHost
  if ($c.Error) { return (Unknown ($S.SiteHost + ' ' + $c.Error + ', so its certificate could not be read')) }
  $left = ($c.NotAfter - (Get-Now).ToUniversalTime()).TotalDays
  $when = $c.NotAfter.ToString('d MMMM yyyy HH:mm', [Globalization.CultureInfo]::InvariantCulture) + ' UTC'
  if ($c.Problems -and $c.Problems -ne 'None') { return (Wrong ('It is not accepted (' + $c.Problems + '). It runs out ' + $when)) }
  if ($left -le $S.CertDays) {
    $d = [math]::Floor($left)
    if ($left -le 0) { return (Wrong ('It ran out on ' + $when + '. Every visitor and every launcher is refused')) }
    return (Wrong ('It runs out on ' + $when + ', in ' + $d + ' day' + $(if ($d -eq 1) { '' } else { 's' }) + ', and the line is ' + $S.CertDays))
  }
  return (Ok ('good until ' + $when + ', ' + [math]::Round($left, 1) + ' days'))
}

# Whether an address is inside one of the ranges, each an address and a
# prefix length. The same rule as scripts\vps\vps-web-firewall.ps1's, which
# tests\test-2995-cloudflare-front.ps1 holds the two to.
function Test-InRanges([string]$address, $ranges) {
  $ip = $null
  if (-not [Net.IPAddress]::TryParse($address, [ref]$ip)) { return $false }
  if ($ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6 -and $ip.IsIPv4MappedToIPv6) { $ip = $ip.MapToIPv4() }
  $b = $ip.GetAddressBytes()
  foreach ($t in @($ranges)) {
    $parts = ('' + $t).Split('/')
    $net = $null
    if ($parts.Count -ne 2 -or -not [Net.IPAddress]::TryParse($parts[0], [ref]$net)) { continue }
    $rb = $net.GetAddressBytes()
    if ($rb.Length -ne $b.Length) { continue }
    $left = [int]$parts[1]
    $same = $true
    for ($i = 0; $i -lt $b.Length -and $left -gt 0; $i++) {
      $take = [Math]::Min(8, $left)
      $mask = [byte]((0xFF -shl (8 - $take)) -band 0xFF)
      if (($b[$i] -band $mask) -ne ($rb[$i] -band $mask)) { $same = $false; break }
      $left -= $take
    }
    if ($same) { return $true }
  }
  return $false
}

# Every address the name has must be Cloudflare's: one that is not, the
# VPS's own above all, is a record with the proxy off, and the box refuses
# 443 to everybody who follows it (#2995). The VPS's own is what the game's
# name resolves to, asked here rather than written in a file (#3690).
function Check-Dns($S) {
  $d = Get-Dns $S.SiteHost
  if ($d.Error -or @($d.Addresses).Count -eq 0) { return (Wrong ($S.SiteHost + ' does not resolve')) }
  if (-not @($S.FrontRanges).Count) { return (Unknown 'there is no list of Cloudflare''s ranges here (cloudflare-ranges.txt) to compare the name with') }
  $out = @($d.Addresses | Where-Object { -not (Test-InRanges $_ $S.FrontRanges) })
  if ($out.Count) {
    $why = $S.SiteHost + ' resolves to ' + (@($d.Addresses) -join ', ') + ', and ' + ($out -join ', ') + ' is not Cloudflare''s'
    $box = @()
    if ($S.GameHost) { $box = @((Get-Dns $S.GameHost).Addresses) }
    if (@($out | Where-Object { $box -contains $_ }).Count) { $why += ': that is the VPS itself, with the proxy off, and the VPS takes 443 only from Cloudflare' }
    return (Wrong $why)
  }
  return (Ok ('resolves to ' + (@($d.Addresses) -join ', ') + ', Cloudflare''s'))
}

# The game's own name: every launcher reaches the box by it, so not
# resolving is Wrong, and so is resolving into Cloudflare, whose free proxy
# does not carry the game's UDP port. No line names the address it resolved
# to, so the run log, which is public, never prints it.
function Check-Game($S) {
  if (-not $S.GameHost) { return (Unknown 'there is no game name here (scripts/vps/vps.json) to ask about') }
  $d = Get-Dns $S.GameHost
  if ($d.Error -or @($d.Addresses).Count -eq 0) { return (Wrong ($S.GameHost + ' does not resolve, so no launcher can reach the game')) }
  if (@($d.Addresses | Where-Object { Test-InRanges $_ $S.FrontRanges }).Count) { return (Wrong ($S.GameHost + ' resolves into Cloudflare''s ranges, so its proxy is on, and the game''s UDP port does not go through it')) }
  return (Ok ('resolves, DNS only'))
}

# Cloudflare is asked, not the site: Cloudflare's API not answering says
# nothing about the ranges.
function Check-Ranges($S) {
  $a = Get-Http 'https://api.cloudflare.com/client/v4/ips' '' '' @{ Accept = 'application/json' }
  if ($a.Code -ne 200) { return (Unknown ('Cloudflare''s API ' + $(if ($a.Code) { 'answered HTTP ' + $a.Code } else { $a.Error }))) }
  $now = @()
  try {
    $j = $a.Body | ConvertFrom-Json
    if (-not $j.success) { throw 'not a success' }
    $now = @(@($j.result.ipv4_cidrs) + @($j.result.ipv6_cidrs) | Where-Object { $_ } | ForEach-Object { '' + $_ })
  } catch { $now = @() <# an answer that is not the list is said on the next line, as could not check #> }
  if (-not $now.Count) { return (Unknown 'Cloudflare''s API answered without its ranges') }
  $have = @($S.FrontRanges | ForEach-Object { '' + $_ })
  $new = @($now | Where-Object { $have -notcontains $_ })
  $gone = @($have | Where-Object { $now -notcontains $_ })
  if ($new.Count -or $gone.Count) {
    $why = 'Cloudflare publishes ranges cloudflare-ranges.txt does not match'
    if ($new.Count) { $why += ': new ' + ($new -join ', ') }
    if ($gone.Count) { $why += $(if ($new.Count) { '; ' } else { ': ' }) + 'no longer listed ' + ($gone -join ', ') }
    return (Wrong $why)
  }
  return (Ok ('the ' + $now.Count + ' ranges match cloudflare-ranges.txt'))
}

# The registry is asked, not the domain: a registry that does not answer says
# nothing about the registration.
function Check-Domain($S) {
  $a = Get-Http ('https://rdap.org/domain/' + $S.SiteHost) '' '' @{ Accept = 'application/rdap+json' }
  if ($a.Code -ne 200) { return (Unknown ('the registry (RDAP) ' + $(if ($a.Code) { 'answered HTTP ' + $a.Code } else { $a.Error }))) }
  $end = $null
  try {
    $j = $a.Body | ConvertFrom-Json
    foreach ($ev in @($j.events)) { if ($ev.eventAction -eq 'expiration') { $end = ([datetime]$ev.eventDate).ToUniversalTime() } }
  } catch { }
  if (-not $end) { return (Unknown 'the registry answered without an expiry date') }
  $left = ($end - (Get-Now).ToUniversalTime()).TotalDays
  $when = $end.ToString('d MMMM yyyy', [Globalization.CultureInfo]::InvariantCulture)
  if ($left -le $S.DomainDays) { return (Wrong ('It runs out on ' + $when + ', in ' + [math]::Floor($left) + ' days')) }
  return (Ok ('registered until ' + $when))
}

# GitHub is asked about the runners: GitHub not answering, or refusing the
# token, says nothing about them (#2857).
function Check-Runner($S) {
  $r = Get-Runners $S.Repo
  if ($r.Error) { return (Unknown ($r.Error)) }
  # The first runner and the numbered ones beside it (Install-Runner.ps1 -Number).
  $mine = @($r.Runners | Where-Object { $_.Name -eq $S.RunnerName -or $_.Name -match ('^' + [regex]::Escape($S.RunnerName) + '-\d+$') })
  if ($mine.Count -eq 0) { return (Wrong ('GitHub lists no runner called ' + $S.RunnerName)) }
  $off = @($mine | Where-Object { $_.Status -ne 'online' })
  if ($off.Count) { return (Wrong ('GitHub shows ' + (@($off | ForEach-Object { $_.Name + ' ' + $_.Status }) -join ', ') + ', of ' + $mine.Count)) }
  $busy = @($mine | Where-Object { $_.Busy }).Count
  if ($mine.Count -eq 1) { return (Ok ('online' + $(if ($busy) { ', running a job' } else { '' }))) }
  return (Ok ('all ' + $mine.Count + ' online, ' + $busy + ' running a job'))
}

# The newest Deployment of each environment the box deploy agent applies,
# and whether the agent has said anything on it (9 Nov). The Main Deployments
# of build-20261108.5, build-1.3.0 and build-1.3.4 sat for a week with no
# status at all, because agent.json never named main, and nothing told
# anybody. A Deployment the agent has not marked within DeployMinutes is
# one nobody on the box is looking after. GitHub's own Deployment for an
# approval wait has no release in its payload and is not one of these.
# Signed in with the run's own token (deployments: read), never anonymously.
function Get-Deployments([string]$repo, [string]$env) {
  $token = ('' + $env:WATCH_DEPLOY_TOKEN).Trim()
  if (-not $token) { return @{ List = @(); Error = 'no token for the Deployments is set here (WATCH_DEPLOY_TOKEN)' } }
  $h = @{ Authorization = ('Bearer ' + $token); Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
  $a = Get-Http ('https://api.github.com/repos/' + $repo + '/deployments?per_page=5&environment=' + [uri]::EscapeDataString($env)) 'GET' '' $h
  if ($a.Code -ne 200) { return @{ List = @(); Error = ('GitHub ' + $(if ($a.Code) { 'answered HTTP ' + $a.Code } else { $a.Error }) + ' for the ' + $env + ' Deployments') } }
  $list = @()
  try { $list = @($a.Body | ConvertFrom-Json | Where-Object { $_.payload -and $_.payload.release }) } catch { return @{ List = @(); Error = 'GitHub''s answer was not a Deployment list' } }
  if ($list.Count -eq 0) { return @{ List = @(); Error = '' } }
  $d = $list[0]
  $s = Get-Http ('https://api.github.com/repos/' + $repo + '/deployments/' + $d.id + '/statuses?per_page=1') 'GET' '' $h
  $token = $null
  if ($s.Code -ne 200) { return @{ List = @(); Error = ('GitHub ' + $(if ($s.Code) { 'answered HTTP ' + $s.Code } else { $s.Error }) + ' for deployment ' + $d.id + '''s statuses') } }
  $states = @()
  try { $states = @($s.Body | ConvertFrom-Json) } catch { return @{ List = @(); Error = 'GitHub''s answer was not a status list' } }
  return @{ List = @(@{ Id = '' + $d.id; Release = '' + $d.payload.release; Created = [DateTimeOffset]::Parse('' + $d.created_at, [Globalization.CultureInfo]::InvariantCulture); State = $(if ($states.Count) { '' + $states[0].state } else { '' }) }); Error = '' }
}

function Check-Deploys($S) {
  $now = [DateTimeOffset](Get-Now)
  $quiet = @(); $said = @()
  foreach ($e in $S.DeployEnvs) {
    $r = Get-Deployments $S.DeployRepo $e
    if ($r.Error) { return (Unknown $r.Error) }
    if ($r.List.Count -eq 0) { continue }
    $d = $r.List[0]
    $age = [int]($now - $d.Created).TotalMinutes
    if ($d.State -eq '' -and $age -ge $S.DeployMinutes) { $quiet += ($e + ': deployment ' + $d.Id + ' of ' + $d.Release + ', ' + $age + ' min with no status') }
    else { $said += ($e + ' ' + $(if ($d.State) { $d.State } else { 'waiting ' + $age + ' min' })) }
  }
  if ($quiet.Count) { return (Wrong ('the box deploy agent has said nothing on ' + ($quiet -join '; '))) }
  return (Ok ($said -join ', '))
}

function Check-Nexus($S) {
  $q = '{ collection(slug: \"' + $S.NexusSlug + '\", domainName: \"' + $S.NexusGame + '\") { name latestPublishedRevision { revisionNumber } } }'
  $a = Get-Http 'https://api.nexusmods.com/v2/graphql' 'POST' ('{"query":"' + $q + '"}') @{ Accept = 'application/json' }
  if ($a.Code -ne 200) { return (Wrong ('Nexus ' + $(if ($a.Code) { 'answered HTTP ' + $a.Code } else { $a.Error }))) }
  $c = $null
  try { $c = ($a.Body | ConvertFrom-Json).data.collection } catch { }
  if (-not $c -or -not $c.name) { return (Wrong ('Nexus says there is no collection ' + $S.NexusSlug + ' any more')) }
  return (Ok ('"' + $c.name + '", revision ' + $c.latestPublishedRevision.revisionNumber))
}

# Everything it watches. Misses is how many runs in a row before it counts,
# Back how many good runs before it is said to be fixed, Every how often it
# is asked, in minutes (0 is every run). Say, Fails and Recovers make the
# first words of a message; What names it when it could not be checked; Fix
# is what it tells a person to do. Private ones print only their outcome in
# the run log, which is public.
function Get-Checks($S) {
  $list = @(
    @{ Name = 'site'; Say = ($S.Site.TrimEnd('/') + ', asked from outside the VPS,'); What = 'the site'; Fails = 'is down'; Recovers = 'is back'; Misses = 2; Back = 2; Every = 0
       Fix = 'If the watchdog on the VPS has not said the same, the whole box or its network is down: look at the VPS in the BisectHosting panel.' }
  )
  foreach ($f in $S.Feeds) {
    $list += @{ Name = $f.Name; Feed = $f; Say = ($f.Say + ' (' + $f.Url + ')'); What = $f.Say.Substring(0, 1).ToLower() + $f.Say.Substring(1); Fails = 'is broken'; Recovers = 'is working again'; Misses = 2; Back = 2; Every = 0
                Fix = 'Every launcher reads it to update and a new install starts from it, so until it answers nobody can update or install.' }
  }
  $list += @(
    @{ Name = 'cert'; Say = ('Cloudflare''s certificate for ' + $S.SiteHost); What = ('Cloudflare''s certificate for ' + $S.SiteHost); Fails = 'needs a look'; Recovers = 'is fine again'; Misses = 1; Back = 1; Every = 60
       Fix = 'Cloudflare renews it by itself: look in the Cloudflare dashboard, SSL/TLS, Edge Certificates. Caddy''s own certificate on the VPS is the box watchdog''s cert check.' },
    @{ Name = 'dns'; Say = $S.SiteHost; What = ('where ' + $S.SiteHost + ' points'); Fails = 'does not point at Cloudflare'; Recovers = 'points at Cloudflare again'; Misses = 2; Back = 2; Every = 0
       Fix = 'The name servers are Cloudflare''s: in the Cloudflare dashboard, DNS, Records, the records for @ and www must be Proxied (the orange cloud). The VPS takes 443 only from Cloudflare (#2995), so a record pointing straight at it reaches nobody.' },
    @{ Name = 'game'; Say = ('The game''s name, ' + $S.GameHost + ','); What = ('where ' + $S.GameHost + ' points'); Fails = 'does not point at the box'; Recovers = 'points at the box again'; Misses = 2; Back = 2; Every = 0
       Fix = 'Every launcher and the game reach the box by this name. In the Cloudflare dashboard, DNS, Records, it is an A record to the box, DNS only (the grey cloud): the game port is UDP, which the free plan cannot proxy.' },
    @{ Name = 'ranges'; Say = 'Cloudflare''s list of its addresses'; What = 'Cloudflare''s list of its addresses'; Fails = 'has changed'; Recovers = 'matches ours again'; Misses = 1; Back = 1; Every = 1440
       Fix = 'The VPS takes 443 only from the ranges in scripts\deploy\cloudflare-ranges.txt, and Caddy believes only those for the visitor''s address. Put Cloudflare''s list into that file and the Caddyfile''s trusted_proxies line (tests\test-2995-cloudflare-front.ps1 holds the two equal), merge it, then send the Caddyfile with Setup-Domain.ps1 and run Set-WebFirewall.ps1.' },
    @{ Name = 'domain'; Say = ('The registration of ' + $S.SiteHost); What = ('the registration of ' + $S.SiteHost); Fails = 'runs out soon'; Recovers = 'was renewed'; Misses = 1; Back = 1; Every = 1440
       Fix = 'It is registered through Cloudflare: renew it there, under Domain Registration.' },
    @{ Name = 'runner'; Say = ('The build runners, ' + $S.RunnerName + ' and the numbered ones,'); What = 'the build runners'; Fails = 'are not all online on GitHub'; Recovers = 'are all online again'; Misses = 3; Back = 2; Every = 0; Private = $true
       Fix = 'They are registered to ThornswoodRP/Thornswood-Ops (#4013). With none of them online the box''s jobs wait: deploys through the gate, staff notices from cloud threads and the admin App''s asks; with some, they wait longer. .\scripts\deploy\Install-Runner.ps1 -Status says what the VPS sees of the first, and -Number <n> -Status of the others.'
       Blind = 'It asks with a token of the thornswood-watch App, minted each run from WATCH_APP_KEY in Thornswood''s watch environment, that reads only the runners of ThornswoodRP/Thornswood-Ops. The run log says why it could not mint one; a new key goes in that environment.' },
    @{ Name = 'deploys'; Say = 'A release the box should be running'; What = 'whether the box takes each release'; Fails = 'has not been taken by the box'; Recovers = 'has been taken by the box'; Misses = 1; Back = 1; Every = 15
       Fix = 'The box deploy agent marks every Deployment it applies within about a minute. Silence means agent.json does not name that environment or the agent is not running: pwsh scripts/vps/Box-Run.ps1 -Line ''Install-DeployAgent -Status'' says what the box sees, and -Main puts main back in agent.json (#5181).'
       Blind = 'It reads the Deployments with the run''s own token (deployments: read on this repository).' },
    @{ Name = 'nexus'; Say = 'The Nexus collection'; What = 'the Nexus collection'; Fails = 'cannot be reached'; Recovers = 'is reachable again'; Misses = 2; Back = 2; Every = 60
       Fix = 'A new install gets its mods through this collection.' }
  )
  return $list
}

function Invoke-Check($S, $c) {
  switch ($c.Name) {
    'site'    { return (Check-Site $S) }
    'cert'    { return (Check-Cert $S) }
    'dns'     { return (Check-Dns $S) }
    'game'    { return (Check-Game $S) }
    'ranges'  { return (Check-Ranges $S) }
    'domain'  { return (Check-Domain $S) }
    'runner'  { return (Check-Runner $S) }
    'deploys' { return (Check-Deploys $S) }
    'nexus'   { return (Check-Nexus $S) }
    default   { return (Check-Feed $S $c.Feed) }
  }
}

# The watcher's own blind spot for one check: what is told when that check
# could not be asked for long enough (#2857). About an hour of runs in a row
# for the checks asked every run, two runs for the hourly and daily ones, and
# back on the first run that could ask.
function Blind($S, $c) {
  $every = [math]::Max(1, [math]::Max([int]$c.Every, [int]$S.Minutes))
  $runs = [math]::Max(2, [int][math]::Ceiling(60.0 / $every))
  $fix = 'Until it can, ' + $c.What + ' could break and nobody would be told.'
  if ($c.Blind) { $fix += ' ' + $c.Blind }
  return @{ Name = ($c.Name + ' unchecked'); Say = 'The outside watcher'; Fails = ('cannot check ' + $c.What); Recovers = ('can check ' + $c.What + ' again')
            Misses = $runs; Back = 1; Every = $c.Every; Fix = $fix }
}

# When neither GitHub nor Discord answers at all, this machine is offline and
# nothing it sees means anything.
function Test-Online {
  foreach ($u in 'https://api.github.com/', 'https://discord.com/api/v10/gateway') {
    if ((Get-Http $u -timeout 10).Code -gt 0) { return $true }
  }
  return $false
}

# ------------------------------------------------------ telling a person ---
# The same shape as the VPS watcher's (#447): outages.txt remembers what is
# down, alerts.jsonl is the outbox, one message when it goes and one when it
# is back.

function Paths($dir) {
  return @{
    Outages = (Join-Path $dir 'outages.txt'); Due = (Join-Path $dir 'due.txt')
    Alerts = (Join-Path $dir 'alerts.jsonl'); Sent = (Join-Path $dir 'alerts-sent.txt')
    Log = (Join-Path $dir 'watch.log'); Last = (Join-Path $dir 'last-check.txt')
  }
}
$hookRx = '^https://((ptb|canary)\.)?discord(app)?\.com/api/webhooks/\d+/[A-Za-z0-9_-]+$'
$alertMaxAge = 24 * 3600

function UnixTime($t) { return ([DateTimeOffset]$t).ToUnixTimeSeconds() }

# A line in the run log, which is public, and the same line in watch.log in
# the state folder. Callers pass only what may be public: a check's name, a
# message's id, an HTTP code. Never a message's text.
function Note($P, $line) {
  $stamp = (Get-Now).ToString('yyyy-MM-dd HH:mm:ss')
  Write-Host ('  ' + $line)
  Add-Content -LiteralPath $P.Log -Value ($stamp + '  ' + $line) -Encoding UTF8
}

# name|down or up|bad runs|good runs|first bad|first good, as on the VPS.
function Read-Outages($P) {
  $o = @{}
  if (-not (Test-Path -LiteralPath $P.Outages)) { return $o }
  foreach ($line in (Get-Content -LiteralPath $P.Outages -EA SilentlyContinue)) {
    $b = "$line" -split '\|'
    if ($b.Count -ne 6) { continue }
    try { $o[$b[0]] = @{ Down = ($b[1] -eq 'down'); Misses = [int]$b[2]; Clean = [int]$b[3]; Since = $b[4]; Good = $b[5] } } catch { continue }
  }
  return $o
}

function Save-Outages($P, $o) {
  $lines = @()
  foreach ($k in ($o.Keys | Sort-Object)) {
    $s = $o[$k]
    $lines += ($k + '|' + $(if ($s.Down) { 'down' } else { 'up' }) + '|' + $s.Misses + '|' + $s.Clean + '|' + $s.Since + '|' + $s.Good)
  }
  Set-Content -LiteralPath $P.Outages -Value $lines -Encoding ASCII
}

# When each check that is not asked every run was last asked.
function Read-Due($P) {
  $d = @{}
  if (-not (Test-Path -LiteralPath $P.Due)) { return $d }
  foreach ($line in (Get-Content -LiteralPath $P.Due -EA SilentlyContinue)) {
    $b = "$line" -split '\|'
    if ($b.Count -eq 2) { $d[$b[0]] = $b[1] }
  }
  return $d
}

function Save-Due($P, $d) {
  Set-Content -LiteralPath $P.Due -Value @($d.Keys | Sort-Object | ForEach-Object { $_ + '|' + $d[$_] }) -Encoding ASCII
}

function Is-Due($c, $due, $now) {
  if (-not $c.Every) { return $true }
  if (-not $due.ContainsKey($c.Name)) { return $true }
  try { $last = [datetime]::Parse($due[$c.Name], $null, 'RoundtripKind') } catch { return $true }
  return (($now - $last).TotalMinutes -ge ($c.Every - 1))
}

# A time in a message: Discord shows each reader their own clock.
function Shown($t) { return ('<t:' + (UnixTime $t) + ':f>') }

function Took($from, $to) {
  $m = [math]::Round(($to - $from).TotalMinutes)
  if ($m -lt 1) { return 'under a minute' }
  if ($m -lt 120) { return ('about ' + $m + ' minutes') }
  if ($m -lt 2880) { return ('about ' + [math]::Round($m / 60.0, 1) + ' hours') }
  return ('about ' + [math]::Round($m / 1440.0, 1) + ' days')
}

# ------------------------------------------------- when it last checked ---
# GitHub's schedule trigger does not keep an interval (#4170): asked for
# every five minutes, it started this a median 11 minutes apart in October,
# and from 2 to 12 Nov 2026 3 to 5 times a day. So the workflow keeps the
# clock itself (Invoke-WatchFor, below), and every pass writes when it
# checked into last-check.txt in the state folder. A message says how long
# before it the check before it was, which is measured, never a cadence it
# was promised. And a pass more than $GapMinutes after the one before tells
# staff once that the watcher was not checking in between: that is the
# chain of runs broken and waiting for the schedule to start it again.
$GapMinutes = 15
$script:PreviousCheck = $null
$script:ThisCheck = $null

function Read-Last($P) {
  if (-not (Test-Path -LiteralPath $P.Last)) { return $null }
  try { return [datetime]::Parse(("" + (Get-Content -LiteralPath $P.Last -Raw)).Trim(), $null, 'RoundtripKind') } catch { return $null }
}

function Save-Last($P, $t) { Set-Content -LiteralPath $P.Last -Value $t.ToString('o') -Encoding ASCII }

# The words a message carries about the check before it.
function Since-Before {
  if (-not $script:PreviousCheck -or -not $script:ThisCheck) { return 'It remembers no check before this one.' }
  return ('The check before this one was ' + (Took $script:PreviousCheck $script:ThisCheck) + ' earlier.')
}

# Once, on the first pass after a gap longer than $GapMinutes.
function Tell-Gap($P, $prev, $now) {
  if (-not $prev) { return }
  if (($now - $prev).TotalMinutes -le $GapMinutes) { return }
  Tell $P @{ Name = 'gap' } 'gap' 'The outside watcher was not checking' ('for ' + (Took $prev $now) + ', from ' + (Shown $prev) + ' to ' + (Shown $now) + '. Anything outside the VPS that broke and came back in between was not seen; anything still wrong is told from this check on. Each run of it checks for under an hour and then starts the next; when that chain breaks it waits for GitHub''s schedule, which has started it as seldom as every 8 hours.')
}

# One message into the outbox. The run log gets its id, not its words.
function Tell($P, $c, $kind, $head, $body) {
  $now = Get-Now
  $id = 'outside-' + $now.ToString('yyyyMMddHHmmss') + '-' + ($c.Name -replace '[^A-Za-z0-9]', '') + '-' + $kind
  $text = '**' + $head + '** ' + $body
  if ($text.Length -gt 1900) { $text = $text.Substring(0, 1900) }
  $row = ConvertTo-Json @{ id = $id; at = (UnixTime $now); service = ('outside ' + $c.Name); kind = $kind; text = $text } -Compress
  [IO.File]::AppendAllText($P.Alerts, $row + "`r`n", (New-Object Text.UTF8Encoding($false)))
  Note $P ('told staff: ' + $c.Name + ' ' + $kind + ' (' + $id + ')')
}

# One run's verdict on one check.
function Observe($P, $o, $c, $res, $S) {
  if (-not $o.ContainsKey($c.Name)) { $o[$c.Name] = @{ Down = $false; Misses = 0; Clean = 0; Since = ''; Good = '' } }
  $st = $o[$c.Name]
  $now = Get-Now
  $stamp = $now.ToString('o')
  if ($res.Bad) {
    $st.Clean = 0
    $st.Good = ''
    $st.Misses = $st.Misses + 1
    if (-not $st.Since) { $st.Since = $stamp }
    if (-not $st.Down -and $st.Misses -ge $c.Misses) {
      $st.Down = $true
      $since = [datetime]::Parse($st.Since, $null, 'RoundtripKind')
      $why = $res.Why
      if ($why -and $why -notmatch '^https?:') { $why = $why.Substring(0, 1).ToUpper() + $why.Substring(1) }
      Tell $P $c 'down' ($c.Say + ' ' + $c.Fails + '.') ($why + '. First noticed ' + (Shown $since) + '. Checked from outside the VPS, on GitHub''s servers. ' + (Since-Before) + ' ' + $c.Fix)
    }
    return
  }
  $st.Misses = 0
  if (-not $st.Down) { $st.Since = ''; return }
  if (-not $st.Good) { $st.Good = $stamp }
  $st.Clean = $st.Clean + 1
  if ($st.Clean -lt $c.Back) { return }
  $good  = [datetime]::Parse($st.Good, $null, 'RoundtripKind')
  $since = $good
  if ($st.Since) { $since = [datetime]::Parse($st.Since, $null, 'RoundtripKind') }
  Tell $P $c 'back' ($c.Say + ' ' + $c.Recovers + '.') ('Fine since ' + (Shown $good) + ', after ' + (Took $since $good) + ' (first noticed ' + (Shown $since) + '). ' + $res.Line + '.')
  $st.Down = $false
  $st.Clean = 0
  $st.Since = ''
  $st.Good = ''
}

# The webhook's address from WATCH_WEBHOOK, or '' when there is none or it is
# not one.
function Webhook-Url {
  $u = ('' + $env:WATCH_WEBHOOK).Trim()
  if ($u -notmatch $hookRx) { return '' }
  return $u
}

function Read-Ids($path, $into) {
  if (Test-Path -LiteralPath $path) { foreach ($l in (Get-Content -LiteralPath $path -EA SilentlyContinue)) { if ("$l".Trim()) { $into["$l".Trim()] = $true } } }
}

# Post whatever has not gone and is under a day old. A failure is noted
# once, on the first run that tries.
function Deliver($P) {
  if (-not (Test-Path -LiteralPath $P.Alerts)) { return }
  $sent = @{}
  Read-Ids $P.Sent $sent
  $nowUnix = UnixTime (Get-Now)
  $due = @()
  foreach ($line in (Get-Content -LiteralPath $P.Alerts -Encoding UTF8 -EA SilentlyContinue)) {
    $a = $null
    try { $a = ConvertFrom-Json $line } catch { continue }
    if (-not $a -or -not $a.id -or -not $a.text) { continue }
    if ($sent.ContainsKey($a.id)) { continue }
    $age = $nowUnix - [int64]$a.at
    if ($age -gt $alertMaxAge) { continue }
    $sent[$a.id] = $true
    $due += @{ Id = '' + $a.id; Text = '' + $a.text; First = ($age -lt 60) }
  }
  $url = Webhook-Url
  foreach ($a in $due) {
    if (-not $url) {
      if ($a.First) { Note $P ('no webhook is set here (WATCH_WEBHOOK), so ' + $a.Id + ' waits') }
      continue
    }
    $w = Send-Webhook $url $a.Text
    if ($w -eq '') {
      Add-Content -LiteralPath $P.Sent -Value $a.Id -Encoding ASCII
      Note $P ('posted ' + $a.Id)
    } elseif ($a.First) {
      Note $P ('could not post ' + $a.Id + ': ' + $w + '. It is tried again every run for a day.')
    }
  }
}

function Trim-Files($P) {
  if (Test-Path -LiteralPath $P.Alerts) {
    $all = @(Get-Content -LiteralPath $P.Alerts -Encoding UTF8 -EA SilentlyContinue)
    $keep = @()
    $nowUnix = UnixTime (Get-Now)
    foreach ($line in $all) {
      try { $a = ConvertFrom-Json $line } catch { continue }
      if ($a -and ($nowUnix - [int64]$a.at) -le (2 * $alertMaxAge)) { $keep += $line }
    }
    if ($keep.Count -lt $all.Count) {
      [IO.File]::WriteAllText($P.Alerts, $(if ($keep.Count) { ($keep -join "`r`n") + "`r`n" } else { '' }), (New-Object Text.UTF8Encoding($false)))
    }
  }
  foreach ($f in @($P.Log, $P.Sent)) {
    if (-not (Test-Path -LiteralPath $f)) { continue }
    $all = @(Get-Content -LiteralPath $f -EA SilentlyContinue)
    if ($all.Count -gt 2000) { Set-Content -LiteralPath $f -Value ($all[-1000..-1]) -Encoding UTF8 }
  }
}

# One pass. With -Remember it keeps state, tells and posts (what the workflow
# does); without, it only asks and returns what it saw. Returns the results,
# name to @{ Bad; Unknown; Why; Line; Private }, or $null when this machine is
# offline.
function Invoke-Watch($S, $P, [switch]$Remember) {
  if ($Remember -and -not (Test-Path -LiteralPath $P.Log)) { $null = New-Item -ItemType Directory -Path (Split-Path -Parent $P.Log) -Force }
  if (-not (Test-Online)) {
    if ($Remember) { Note $P 'neither GitHub nor Discord answered, so this machine is offline. Nothing was judged or sent.' }
    return $null
  }
  $now = Get-Now
  $o = @{}; $due = @{}
  if ($Remember) {
    $o = Read-Outages $P; $due = Read-Due $P
    # When the check before this one was, and a gap since it told (#4170).
    # Only a pass that is online counts as a check, so a runner that could
    # not reach anything leaves the time where it was.
    $script:PreviousCheck = Read-Last $P
    $script:ThisCheck = $now
    Tell-Gap $P $script:PreviousCheck $now
    Save-Last $P $now
  }
  $seen = [ordered]@{}
  foreach ($c in (Get-Checks $S)) {
    if ($Remember -and -not (Is-Due $c $due $now)) { continue }
    $res = Invoke-Check $S $c
    $res.Private = [bool]$c.Private
    $seen[$c.Name] = $res
    if ($Remember) {
      if ($c.Every) { $due[$c.Name] = $now.ToString('o') }
      # Could not check leaves the check's own state as it was: neither a
      # miss nor a good run. Its blind spot is watched on its own.
      $b = Blind $S $c
      if ($res.Unknown) { Observe $P $o $b (Wrong $res.Why) $S }
      else {
        Observe $P $o $c $res $S
        Observe $P $o $b (Ok 'It can ask again') $S
      }
    }
  }
  if ($Remember) {
    Save-Outages $P $o
    Save-Due $P $due
    Deliver $P
    Trim-Files $P
  }
  return $seen
}

# Waits until $t. The harness puts its own clock here.
function Wait-Until([datetime]$t) {
  $left = ($t - (Get-Now)).TotalMilliseconds
  if ($left -gt 0) { Start-Sleep -Milliseconds ([int]$left) }
}

# -Run -For: one pass every $S.Minutes by the clock, each started that long
# after the one before started, however long a pass took, for $for minutes,
# and no pass started that could not end inside them. GitHub's schedule
# trigger does not keep an interval (#4170), so the clock is kept here and
# the workflow starts the next run when this one ends. 55 minutes, because
# the runners' App token minted at the start of a run lasts an hour.
# Returns how many passes it made.
function Invoke-WatchFor($S, $P, [int]$for) {
  $every = [math]::Max(1, [int]$S.Minutes)
  $start = Get-Now
  $made = 0
  for ($at = 0; $at + $every -le [math]::Max($for, $every); $at += $every) {
    if ($made) { Wait-Until ($start.AddMinutes($at)) }
    $seen = Invoke-Watch $S $P -Remember
    if ($null -ne $seen) { Write-Results $seen }
    $made++
  }
  return $made
}

# What the run log says for one result: the outcome, and the line only when
# it is about something public.
function Outcome($r) {
  if ($r.Unknown) { return 'COULD NOT CHECK' }
  if ($r.Bad) { return 'WRONG' }
  return 'ok'
}
function Shown-Line($r) {
  if ($r.Private -and -not $r.Unknown) { return '(about a private repository, so not shown here)' }
  return $r.Line
}

# The table -Run prints into the public run log.
function Write-Results($seen) {
  foreach ($k in $seen.Keys) { Write-Host ('  {0,-9} {1,-15} {2}' -f $k, (Outcome $seen[$k]), (Shown-Line $seen[$k])) }
}

# True when this shell runs as an administrator. Only an elevated shell can
# delete One's old task (#2990): its file under C:\Windows\System32\Tasks
# gives the account it runs as Read only, and Delete to Administrators and
# SYSTEM, so a plain shell's Unregister-ScheduledTask gets "Access is
# denied" (0x80070005).
function Test-Elevated {
  try {
    $me = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
    return $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

# -Remove: takes One's old task and its folder off this machine, saying each
# step through $say and why when Windows refuses. Returns the exit code.
# Until #2990 the unregister ran with -EA SilentlyContinue, so a refusal
# printed only that the task was still registered, and never why.
function Remove-OldWatch([string]$name, [string]$old, [string]$line, [scriptblock]$say) {
  if (-not (Get-Command Unregister-ScheduledTask -EA SilentlyContinue)) { & $say '  STOP. -Remove takes the old task off a Windows machine, and this is not one.' 'Red'; return 1 }
  # Listed and matched by name, so a task that is not there is no error and
  # any error is a real one.
  function Find-Task { return @(Get-ScheduledTask -EA Stop | Where-Object { $_.TaskName -eq $name }) }
  try { $there = Find-Task } catch { & $say ('  STOP. Windows would not list the scheduled tasks: ' + $_.Exception.Message) 'Red'; return 1 }
  if ($there.Count) {
    if (-not (Test-Elevated)) {
      & $say "  STOP. $name is registered, and Windows lets only an administrator delete it." 'Red'
      & $say '  Nothing was changed. Open PowerShell as administrator (right-click it, Run as administrator) and run:' 'Yellow'
      & $say ('      ' + $line) 'Yellow'
      return 1
    }
    try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -EA Stop }
    catch { & $say ("  STOP. Windows refused to remove ${name}: " + $_.Exception.Message) 'Red'; return 1 }
    try { $there = Find-Task } catch { & $say ('  STOP. Windows would not list the scheduled tasks: ' + $_.Exception.Message) 'Red'; return 1 }
    if ($there.Count) { & $say "  STOP. $name is still registered, although Windows took the removal without an error." 'Red'; return 1 }
    & $say "  removed $name" 'Green'
  } else {
    & $say "  $name is not registered on this machine." 'Green'
  }
  if ($old -and (Test-Path -LiteralPath $old)) {
    try { Remove-Item -LiteralPath $old -Recurse -Force -EA Stop }
    catch { & $say ("  STOP. ${old} was not removed: " + $_.Exception.Message) 'Red'; return 1 }
    & $say "  removed $old, with its copy of the webhook" 'Green'
  }
  return 0
}

# Dot-sourced by tests\test-watch-outside.ps1, which wants the functions and
# not a run against the internet.
if ($MyInvocation.InvocationName -eq '.') { return }

# ------------------------------------------------------------- the runs ---
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Done([int]$code) { Write-Host ''; if (-not $NoPause -and -not $Run -and -not $env:GITHUB_ACTIONS) { [void](Read-Host 'Enter to close') }; exit $code }

$repo = Split-Path -Parent (Split-Path -Parent $Here)
$saved = Join-Path $Here 'watch-outside.json'

if ($Remove) {
  # One ran this as a scheduled task until #2755. Its folder holds a copy of
  # the staff webhook's address and the old outbox, so it goes too.
  $old = $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Thornswood\Watch-Outside' } else { '' })
  $line = "& '" + $MyInvocation.MyCommand.Path.Replace("'", "''") + "' -Remove -TaskName '" + $TaskName.Replace("'", "''") + "'"
  Done (Remove-OldWatch $TaskName $old $line ${function:Say})
}

$S = Read-Settings $repo $saved

if ($Export) {
  # The public repository's files: this script, the settings it reads there,
  # the workflow that runs it and the README. Nothing else of the repository.
  $src = Join-Path $Here 'watch-outside'
  $null = New-Item -ItemType Directory -Path (Join-Path $Export '.github/workflows') -Force
  Copy-Item -LiteralPath $MyInvocation.MyCommand.Path -Destination (Join-Path $Export 'Watch-Outside.ps1') -Force
  Copy-Item -LiteralPath (Join-Path $src 'README.md') -Destination (Join-Path $Export 'README.md') -Force
  Copy-Item -LiteralPath (Join-Path $src 'watch-outside.yml') -Destination (Join-Path $Export '.github/workflows/watch-outside.yml') -Force
  Copy-Item -LiteralPath (Join-Path $src 'keep-alive.yml') -Destination (Join-Path $Export '.github/workflows/keep-alive.yml') -Force
  $keep = [ordered]@{}
  foreach ($k in $PublicSettings) { $keep[$k] = $S[$k] }
  $keep.Feeds = @($S.Feeds | ForEach-Object { [ordered]@{ Name = $_.Name; Say = $_.Say; Url = $_.Url } })
  [IO.File]::WriteAllText((Join-Path $Export 'watch-outside.json'), (ConvertTo-Json $keep -Depth 5) + "`n", (New-Object Text.UTF8Encoding($false)))
  Say ('  wrote the watcher, watch-outside.json, its two workflows and the README to ' + $Export) 'Green'
  Done 0
}

if ($Run) {
  if (-not $Folder) { Say '  STOP. -Run needs -Folder, where it remembers what is down between runs.' 'Red'; exit 1 }
  if (-not [IO.Path]::IsPathRooted($Folder)) { $Folder = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Folder)) }
  $P = Paths $Folder
  if ($For -gt 0) {
    $made = Invoke-WatchFor $S $P $For
    Write-Host ('  ' + $made + ' passes, one every ' + $S.Minutes + ' minutes by the clock')
    exit 0
  }
  $seen = Invoke-Watch $S $P -Remember
  if ($null -eq $seen) { exit 0 }
  Write-Results $seen
  # What is wrong goes to Discord. The run itself fails only when the watcher
  # does, so a failed run means the watcher needs a look.
  exit 0
}

Write-Host ''
Write-Host '  THORNSWOOD  -  watched from outside the VPS' -ForegroundColor White

if ($TestPost) {
  $url = Webhook-Url
  if (-not $url) { Say '  STOP. No Discord webhook address in WATCH_WEBHOOK.' 'Red'; Done 1 }
  # The webhook has to post in #staff-updates, where the bot says the
  # watchdog's own messages (#2501). The channel's id is not printed.
  $where = Webhook-Channel $url
  if (-not $where.Channel) { $url = $null; Say ('  STOP. Discord would not say where that webhook posts: ' + $where.Why + '. Nothing was posted.') 'Red'; Done 1 }
  if ($S.StaffChannel -and $where.Channel -ne $S.StaffChannel) { $url = $null; Say '  STOP. That webhook does not post in #staff-updates. Make one there and put it in the secret. Nothing was posted.' 'Red'; Done 1 }
  $why = Send-Webhook $url ('**Test from the outside watcher.** It runs on GitHub''s servers, off the VPS and off One, and asks the site, both update feeds, the certificate, the address, the registration, the build runners and the Nexus collection. Each run of it checks every ' + $Minutes + ' minutes by its own clock for under an hour and then starts the next. It posts here when one breaks and again when it is fixed, and when it was not checking for more than ' + $GapMinutes + ' minutes.')
  $url = $null
  if ($why) { Say ('  Discord did not take it: ' + $why) 'Red'; Done 1 }
  Say '  posted in #staff-updates; look in the channel' 'Green'
  Done 0
}

# No switch: look once, remember nothing, post nothing.
Say ''
$seen = Invoke-Watch $S (Paths ([IO.Path]::GetTempPath()))
if ($null -eq $seen) { Say '  Neither GitHub nor Discord answered, so this machine is offline and nothing was judged.' 'Yellow'; Done 0 }
$bad = 0
foreach ($k in $seen.Keys) {
  $r = $seen[$k]
  if ($r.Bad -or $r.Unknown) { $bad++ }
  Say ('  {0,-9} {1,-15} {2}' -f $k, (Outcome $r), $r.Line) $(if ($r.Bad) { 'Red' } elseif ($r.Unknown) { 'Yellow' } else { 'Green' })
}
Say ''
if ($bad) { Say "  $bad of them need a look. Only -Run, which the workflow runs, remembers and posts." 'Red' } else { Say '  Everything outside answers.' 'Green' }
Done $(if ($bad) { 1 } else { 0 })
