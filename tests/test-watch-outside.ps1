<#
  test-watch-outside.ps1

      pwsh -NoProfile -File .\tests\test-watch-outside.ps1
      powershell -NoProfile -File .\tests\test-watch-outside.ps1

  scripts\vps\Watch-Outside.ps1 runs on GitHub's Linux runners, from a public
  repository, outside the VPS (#2755), and tells staff in Discord when the
  site, a feed, the certificate, the address, the registration, the build
  runners or the Nexus collection breaks, once, and once more when it is
  fixed (issue #448).

  These drive the real script, dot-sourced, with the functions that touch the
  internet or the clock (Get-Http, Get-Cert, Get-Dns, Get-Runners,
  Send-Webhook, Get-Now) replaced by a table of fake answers. Nothing leaves
  the machine and nothing is posted. The cases: everything fine, a
  certificate near its end and then renewed, the site down and back, the
  runners offline and back, GitHub not answering about the runners (#2857:
  could not check, never "down"), a registry that does not answer, the
  address moved, a feed that is not a feed, a webhook that fails and then
  works, no webhook at all, this machine offline, what -Export writes for the
  public repository, and that the run log, which is public there, names
  nothing private.

  Read only apart from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$ScriptPath, [string]$Temp)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $ScriptPath) { $ScriptPath = Join-Path (Join-Path (Join-Path $Root 'scripts') 'vps') 'Watch-Outside.ps1' }
if (-not $Temp) { $Temp = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
  else       { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

Yes 'Watch-Outside.ps1 is there' (Test-Path -LiteralPath $ScriptPath)
if (-not (Test-Path -LiteralPath $ScriptPath)) { Write-Host ''; Write-Host '0 passed, 1 failed' -ForegroundColor Red; exit 1 }

$oldHook = $env:WATCH_WEBHOOK
$oldToken = $env:WATCH_RUNNER_TOKEN
$env:WATCH_WEBHOOK = ''
$env:WATCH_RUNNER_TOKEN = ''

. $ScriptPath
$ErrorActionPreference = 'Stop'

# ---- the settings, read from this repository ---------------------------------
$S = Read-Settings $Root ''
Yes 'the live feed is Updater.cs''s MainFeed' ((@($S.Feeds | Where-Object { $_.Name -eq 'feed' })[0].Url) -eq 'https://thornswood.net/feed/version.json')
Yes 'the dev feed is Updater.cs''s DevFeed' ((@($S.Feeds | Where-Object { $_.Name -eq 'feed-dev' })[0].Url) -eq 'https://thornswood.net/feed-dev/version.json')
Yes 'the site is the feed''s host' ($S.Site -eq 'https://thornswood.net/' -and $S.SiteHost -eq 'thornswood.net')
Yes 'the collection comes from Config.cs' ($S.NexusSlug -and $S.NexusGame)
$ipLike = $null
Yes 'the game''s name comes from scripts\vps\vps.json, a name and not the box''s address (#3690)' ($S.GameHost -and -not [Net.IPAddress]::TryParse($S.GameHost, [ref]$ipLike))
Yes 'the certificate line is 14 days' ($S.CertDays -eq 14)
Yes 'the webhook''s channel is #staff-updates, bot\staff-channel.txt''s id (#2501)' ($S.StaffChannel -eq '1549254991082946570')
Yes 'the runners are Thornswood-Ops''s, where the box''s runners are registered since the flip (#4013), from thornswood-vps' ($S.Repo -eq 'ThornswoodRP/Thornswood-Ops' -and $S.RunnerName -eq 'thornswood-vps')
Yes 'signing and the off-box copy are not asked from outside any more (#2755)' (-not $S.ContainsKey('SignAccount') -and -not $S.ContainsKey('BackupsFolder'))

$dir = Join-Path $Temp ('thornswood-watchoutside-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $dir -Force

try {
  # ---- what -Export writes for the public repository -------------------------
  $pub = Join-Path $dir 'public'
  $pwshExe = (Get-Process -Id $PID).Path
  $null = & $pwshExe -NoProfile -NonInteractive -File $ScriptPath -Export $pub -NoPause 2>&1
  Yes ('-Export ends 0 (exit ' + $LASTEXITCODE + ')') ($LASTEXITCODE -eq 0)
  $files = @(Get-ChildItem -LiteralPath $pub -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($pub.Length + 1).Replace('\', '/') })
  $expect = @('.github/workflows/keep-alive.yml', '.github/workflows/watch-outside.yml', 'README.md', 'Watch-Outside.ps1', 'watch-outside.json')
  Yes ('-Export writes the watcher, its settings, two workflows and the README, nothing else: ' + ($files -join ', ')) (
    $files.Count -eq $expect.Count -and @($expect | Where-Object { $files -cnotcontains $_ }).Count -eq 0)
  Yes 'the watcher there is this script, byte for byte' (
    (Test-Path -LiteralPath (Join-Path $pub 'Watch-Outside.ps1')) -and
    [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $pub 'Watch-Outside.ps1'))) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($ScriptPath)))
  $json = Join-Path $pub 'watch-outside.json'
  $keys = @()
  if (Test-Path -LiteralPath $json) { $keys = @((Get-Content -LiteralPath $json -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $_.Name }) }
  Yes ('watch-outside.json holds only the public settings: ' + ($keys -join ', ')) ($keys.Count -gt 0 -and @($keys | Where-Object { $PublicSettings -notcontains $_ }).Count -eq 0)
  $S2 = Read-Settings (Join-Path $dir 'no-repository-here') $json
  Yes 'read back there, it asks what the repository says' (
    $S2.Site -eq $S.Site -and $S2.GameHost -eq $S.GameHost -and $S2.NexusSlug -eq $S.NexusSlug -and $S2.Repo -eq $S.Repo -and
    @($S2.Feeds).Count -eq 2 -and @($S2.Feeds)[1].Url -eq @($S.Feeds)[1].Url -and $S2.StaffChannel -eq $S.StaffChannel)
  Yes 'Cloudflare''s ranges go there from cloudflare-ranges.txt and read back whole (#2995)' (
    @($S.FrontRanges).Count -ge 10 -and (@($S2.FrontRanges) -join ',') -eq (@($S.FrontRanges) -join ',') -and @($S.FrontRanges)[0] -eq '173.245.48.0/20')
  $wf = ''
  if (Test-Path -LiteralPath (Join-Path $pub '.github/workflows/watch-outside.yml')) { $wf = Get-Content -LiteralPath (Join-Path $pub '.github/workflows/watch-outside.yml') -Raw }
  Yes 'the workflow runs every five minutes' ($wf -match "cron: '\*/5 \* \* \* \*'")
  Yes 'it keeps its memory in the Actions cache, restored from the newest and saved under a new key' (
    $wf -match 'actions/cache/restore@[0-9a-f]{40}' -and $wf -match 'restore-keys: watch-outside-' -and $wf -match 'actions/cache/save@[0-9a-f]{40}' -and $wf -match 'key: watch-outside-\$\{\{ github\.run_id \}\}-')
  Yes 'it passes -Run -Folder state and the two secrets by name' (
    $wf -match '-Run -Folder state' -and $wf -match 'WATCH_WEBHOOK: \$\{\{ secrets\.STAFF_WEBHOOK \}\}' -and $wf -match 'WATCH_RUNNER_TOKEN: \$\{\{ secrets\.RUNNER_TOKEN \}\}')
  Yes 'it reads the repository and writes nothing to it' ($wf -match "permissions:\s+contents: read" -and $wf -notmatch 'contents: write')
  Yes 'every action it uses is pinned to a commit' (@([regex]::Matches($wf, 'uses: \S+')).Count -gt 0 -and @([regex]::Matches($wf, 'uses: (?!\S+@[0-9a-f]{40}\b)\S+')).Count -eq 0)
  $ka = ''
  if (Test-Path -LiteralPath (Join-Path $pub '.github/workflows/keep-alive.yml')) { $ka = Get-Content -LiteralPath (Join-Path $pub '.github/workflows/keep-alive.yml') -Raw }
  Yes 'keep-alive commits once a month, inside the 60 days GitHub allows' ($ka -match "cron: '17 6 1 \* \*'" -and $ka -match 'git push' -and $ka -match 'alive\.txt')

  # ---- the same watch, folded into this repository (#3690) -------------------
  $here = ''
  $herePath = Join-Path $Root '.github/workflows/watch-outside.yml'
  if (Test-Path -LiteralPath $herePath) { $here = Get-Content -LiteralPath $herePath -Raw }
  Yes 'this repository has the watch as its own workflow' ($here -match "cron: '\*/5 \* \* \* \*'")
  Yes '  it runs this script from where it is, with the webhook by name and the watcher App''s token for the runners (#5259)' (
    $here -match '\./scripts/vps/Watch-Outside\.ps1 -Run -Folder state' -and $here -match 'WATCH_WEBHOOK: \$\{\{ secrets\.STAFF_WEBHOOK \}\}' -and $here -match 'WATCH_RUNNER_TOKEN: \$\{\{ steps\.app\.outputs\.token \}\}' -and $here -notmatch 'secrets\.RUNNER_TOKEN')
  Yes '  the token is minted each run for Thornswood-Ops alone, Administration read only, and a failed mint leaves the other checks running' (
    ($here -replace "`r`n", "`n") -match "(?m)^      - name: The watcher's token for the runners\n        id: app\n        if: \$\{\{ !inputs\.test \}\}\n        continue-on-error: true\n        uses: actions/create-github-app-token@[0-9a-f]{40} # v\S+\n        with:\n          client-id: \$\{\{ vars\.WATCH_APP_CLIENT_ID \}\}\n          private-key: \$\{\{ secrets\.WATCH_APP_KEY \}\}\n          owner: \$\{\{ github\.repository_owner \}\}\n          repositories: Thornswood-Ops\n          permission-administration: read\n(?!          )")
  Yes '  on GitHub''s runners, off the box' ($here -match 'runs-on: ubuntu-latest' -and $here -notmatch 'self-hosted')
  Yes '  only once the variable WATCH_OUTSIDE says here, so it and the old repository''s watcher never both post' ($here -match "if: \$\{\{ vars\.WATCH_OUTSIDE == 'here' \}\}")
  Yes '  its two secrets come from the watch environment, which only main may use' ($here -match '(?m)^\s+environment: watch\s*$')
  Yes '  it keeps its memory the way the public one does' ($here -match 'restore-keys: watch-outside-' -and $here -match 'key: watch-outside-\$\{\{ github\.run_id \}\}-')
  Yes '  it reads the repository and writes nothing to it' ($here -match "permissions:\s+contents: read" -and $here -notmatch 'contents: write')

  # Fixed values from here on, so nothing below depends on what the repository says.
  $S.GameHost = 'play.example.invalid'
  $S.FrontRanges = @('104.16.0.0/13', '172.64.0.0/13', '2606:4700::/32')

  # ---- the fakes ------------------------------------------------------------
  $HookUrl = 'https://discord.com/api/webhooks/123456/SECRETHOOKTOKEN_abc'
  $script:clock = [datetime]::new(2026, 10, 1, 12, 0, 0, [DateTimeKind]::Local)
  $script:posted = New-Object 'System.Collections.Generic.List[string]'
  $script:hookFails = $false
  $script:asked = New-Object 'System.Collections.Generic.List[string]'

  function Reset-World {
    $script:online = $true
    $script:site = 200
    $script:feed = 200
    $script:feedBody = '{"launcherVersion":"1.2.4","launcherUrl":"https://thornswood.net/feed/assets/abc","packs":[],"baseline":{"id":"20261012-115531"}}'
    $script:launcher = 206
    $script:certEnd = $script:clock.ToUniversalTime().AddDays(60)
    $script:certProblems = 'None'
    $script:certError = ''
    $script:dns = @('104.21.5.10', '172.67.130.5')
    $script:gameDns = @('192.0.2.10')
    $script:cfCode = 200
    $script:cfBody = '{"result":{"ipv4_cidrs":["104.16.0.0/13","172.64.0.0/13"],"ipv6_cidrs":["2606:4700::/32"]},"success":true}'
    $script:rdap = 200
    $script:rdapEnd = '2027-09-15T01:11:45Z'
    $script:runner = 'online'
    $script:runner2 = ''
    $script:nexus = '{"data":{"collection":{"name":"Thornswood","latestPublishedRevision":{"revisionNumber":1}}}}'
    $script:ghRunners = 200
  }

  function Get-Now { return $script:clock }
  function Get-Http([string]$url, [string]$method = 'GET', [string]$body = '', [hashtable]$headers = @{}, [switch]$FirstByte, [int]$timeout = 20) {
    $script:asked.Add($url)
    if (-not $script:online) { return @{ Code = 0; Body = ''; Error = 'could not be reached' } }
    if ($url -eq 'https://api.github.com/' -or $url -like 'https://discord.com/api/v10/gateway') { return @{ Code = 200; Body = '{}'; Error = '' } }
    if ($url -like 'https://api.github.com/repos/*/actions/runners*') {
      $script:runnerAuth = $headers['Authorization']
      if ($script:ghRunners -eq 0) { return @{ Code = 0; Body = ''; Error = 'did not answer within 20 seconds' } }
      return @{ Code = $script:ghRunners; Body = '{"total_count":2,"runners":[{"name":"thornswood-vps","status":"online","busy":true},{"name":"thornswood-vps-2","status":"offline","busy":false}]}'; Error = '' }
    }
    if ($url -eq 'https://thornswood.net/') { return @{ Code = $script:site; Body = ''; Error = $(if ($script:site) { '' } else { 'did not answer within 20 seconds' }) } }
    if ($url -like 'https://thornswood.net/feed*/version.json') { return @{ Code = $script:feed; Body = $script:feedBody; Error = '' } }
    if ($url -like 'https://thornswood.net/feed/assets/*') { return @{ Code = $script:launcher; Body = ''; Error = '' } }
    if ($url -like 'https://rdap.org/domain/*') {
      if ($script:rdap -ne 200) { return @{ Code = $script:rdap; Body = ''; Error = $(if ($script:rdap) { '' } else { 'did not answer within 20 seconds' }) } }
      return @{ Code = 200; Body = ('{"events":[{"eventAction":"expiration","eventDate":"' + $script:rdapEnd + '"}]}'); Error = '' }
    }
    if ($url -eq 'https://api.cloudflare.com/client/v4/ips') { return @{ Code = $script:cfCode; Body = $script:cfBody; Error = $(if ($script:cfCode) { '' } else { 'did not answer within 20 seconds' }) } }
    if ($url -eq 'https://api.nexusmods.com/v2/graphql') { $script:nexusQuery = $body; return @{ Code = 200; Body = $script:nexus; Error = '' } }
    if ($url -eq $HookUrl -and $method -eq 'GET') { return @{ Code = $script:hookCode; Body = $script:hookBody; Error = '' } }
    return @{ Code = 0; Body = ''; Error = 'not in the table' }
  }
  function Get-Cert([string]$hostName) { return @{ NotAfter = $script:certEnd; Problems = $script:certProblems; Error = $script:certError } }
  function Get-Dns([string]$name) {
    $a = $(if ($name -eq 'play.example.invalid') { @($script:gameDns) } else { @($script:dns) })
    return @{ Addresses = $a; Error = $(if ($a.Count) { '' } else { 'does not resolve' }) }
  }
  # The real one, kept to drive against the fake Get-Http below.
  $realGetRunners = ${function:Get-Runners}
  function Get-Runners([string]$repo) {
    if ($script:runner -eq 'no-answer') { return @{ Runners = @(); Error = 'GitHub did not answer within 20 seconds' } }
    $list = @(@{ Name = 'thornswood-vps'; Status = $script:runner; Busy = $false })
    # A numbered runner beside it (Install-Runner.ps1 -Number), and one whose
    # name only starts the same, which is not one of them.
    if ($script:runner2) { $list += @{ Name = 'thornswood-vps-2'; Status = $script:runner2; Busy = $true }; $list += @{ Name = 'thornswood-vpsx'; Status = 'offline'; Busy = $false } }
    return @{ Runners = $list; Error = '' }
  }
  function Send-Webhook([string]$url, [string]$text) {
    if ($script:hookFails) { return 'HTTP 500' }
    $script:posted.Add($text)
    return ''
  }

  $P = Paths (Join-Path $dir 'state')
  $env:WATCH_WEBHOOK = $HookUrl

  # What the run log got, which is public on the runner: Note writes there.
  $script:printed = New-Object 'System.Collections.Generic.List[string]'
  function Tick([int]$minutes = 5) { $script:clock = $script:clock.AddMinutes($minutes) }
  function Pass-Once {
    $script:last = $null
    $out = @(& { $script:last = Invoke-Watch $S $P -Remember; if ($script:last) { Write-Results $script:last } } 6>&1)
    foreach ($o in $out) { $script:printed.Add("$o") }
    Tick
    return $script:last
  }
  function Posted([string]$like) { return @($script:posted | Where-Object { $_ -like $like }).Count }
  function Clear-Posted { $script:posted.Clear() }

  # ---- everything fine ----------------------------------------------------
  Reset-World
  $r = Pass-Once
  Yes 'a healthy world: every check ran, ten of them' ($r.Count -eq 10)
  Yes 'a healthy world: nothing is wrong and nothing could not be checked' (@($r.Values | Where-Object { $_.Bad -or $_.Unknown }).Count -eq 0)
  Yes 'a healthy world: nothing is posted' ($script:posted.Count -eq 0)
  Yes 'Nexus was asked for the collection from Config.cs' ($script:nexusQuery -match $S.NexusSlug)

  # ---- the hourly and daily ones are not asked every run -------------------
  $script:asked.Clear()
  $null = Pass-Once
  Yes 'the domain is not asked again five minutes later' (@($script:asked | Where-Object { $_ -like 'https://rdap.org/*' }).Count -eq 0)
  Yes 'Nexus is not asked again five minutes later' (@($script:asked | Where-Object { $_ -like '*nexusmods*' }).Count -eq 0)
  Yes 'the site is asked again' (@($script:asked | Where-Object { $_ -eq 'https://thornswood.net/' }).Count -eq 1)

  # ---- certificate near its end, then renewed ------------------------------
  Reset-World
  Tick 60
  $script:certEnd = $script:clock.ToUniversalTime().AddDays(10)
  $null = Pass-Once
  Yes 'certificate at 10 days: one message at once' ((Posted '*certificate for thornswood.net needs a look*') -eq 1)
  Yes 'it says when it runs out and how many days' ((Posted '*in 10 days*') -eq 1)
  Yes 'it says what to do' ((Posted '*Caddy*') -eq 1)
  Tick 60; $null = Pass-Once
  Tick 60; $null = Pass-Once
  Yes 'still near its end an hour and two hours later: no second message' ((Posted '*certificate for thornswood.net*') -eq 1)
  $script:certEnd = $script:clock.ToUniversalTime().AddDays(89)
  Tick 60; $null = Pass-Once
  Yes 'renewed: one message saying it is fine again' ((Posted '*certificate for thornswood.net is fine again*') -eq 1)
  Tick 60; $null = Pass-Once
  Yes 'and no more after that' ((Posted '*certificate for thornswood.net*') -eq 2)
  Clear-Posted

  # Out of date entirely, one the runner will not accept, and no handshake.
  $script:certEnd = $script:clock.ToUniversalTime().AddDays(-1)
  Yes 'a certificate that ran out is wrong' ((Check-Cert $S).Bad -and (Check-Cert $S).Why -match 'ran out')
  $script:certEnd = $script:clock.ToUniversalTime().AddDays(60); $script:certProblems = 'RemoteCertificateNameMismatch'
  Yes 'a certificate the runner does not accept is wrong' ((Check-Cert $S).Bad -and (Check-Cert $S).Why -match 'not accepted.*NameMismatch')
  $script:certEnd = $script:clock.ToUniversalTime().AddDays(15); $script:certProblems = 'None'
  Yes 'a certificate at 15 days is fine' (-not (Check-Cert $S).Bad -and -not (Check-Cert $S).Unknown)
  $script:certError = 'no TLS handshake on 443'
  $c = Check-Cert $S
  Yes 'no handshake is could not check, not a certificate gone wrong (#2857)' ($c.Unknown -and -not $c.Bad -and $c.Why -match 'could not be read')
  Reset-World

  # ---- site down, then back -------------------------------------------------
  $script:site = 0
  $null = Pass-Once
  Yes 'site down on one run: nothing yet, one slow answer is not an outage' ((Posted '*thornswood.net, asked from outside the VPS, is down*') -eq 0)
  $null = Pass-Once
  Yes 'site down on two runs: one message' ((Posted '*thornswood.net, asked from outside the VPS, is down*') -eq 1)
  $down = @($script:posted | Where-Object { $_ -like '*is down*' })[0]
  Yes 'the message starts bold with what is wrong' ($down -like '`*`*https://thornswood.net, asked from outside the VPS, is down.`*`* *')
  Yes 'the message says why, in words' ($down -match 'did not answer within 20 seconds')
  Yes 'an address at the start of the reason keeps its small letters' ($down -cmatch '\*\* https://thornswood\.net/ did not')
  Yes 'the message says when, in each reader''s own clock' ($down -match '<t:\d+:f>')
  Yes 'the message says where it was checked from' ($down -match 'Checked from outside the VPS, on GitHub''s servers, about every 5 minutes')
  $null = Pass-Once; $null = Pass-Once; $null = Pass-Once
  Yes 'still down three runs later: still one message' ((Posted '*is down*') -eq 1)
  $script:site = 200
  $null = Pass-Once
  Yes 'answering once: not back yet, a flap stays one outage' ((Posted '*is back*') -eq 0)
  $script:site = 0
  $null = Pass-Once
  $script:site = 200
  $null = Pass-Once; $null = Pass-Once
  Yes 'down again in between: still one down message' ((Posted '*is down*') -eq 1)
  Yes 'answering on two runs in a row: one back message' ((Posted '*thornswood.net, asked from outside the VPS, is back*') -eq 1)
  $back = @($script:posted | Where-Object { $_ -like '*is back*' })[0]
  Yes 'the back message says how long it was down' ($back -match 'after about \d+ minutes')
  $null = Pass-Once
  Yes 'nothing more once it is back' ($script:posted.Count -eq 2)
  Clear-Posted

  # ---- runner offline, then back --------------------------------------------
  Reset-World
  $script:runner = 'offline'
  $null = Pass-Once; $null = Pass-Once
  Yes 'runner offline for two runs: nothing yet, it restarts itself on updates' ((Posted '*build runner*') -eq 0)
  $null = Pass-Once
  Yes 'runner offline for three runs: one message' ((Posted '*build runners, thornswood-vps and the numbered ones, are not all online on GitHub*') -eq 1)
  Yes 'it says what that stops: the box''s jobs on Thornswood-Ops (#4013)' ((Posted '*Thornswood-Ops*deploys through the gate*') -eq 1)
  $null = Pass-Once
  $script:runner = 'online'
  $null = Pass-Once; $null = Pass-Once
  Yes 'runner online two runs in a row: one message saying so' ((Posted '*build runners, thornswood-vps and the numbered ones, are all online again*') -eq 1)
  Yes 'two messages in all for the runner' ((Posted '*build runner*') -eq 2)
  Clear-Posted

  # ---- a numbered runner offline while the first is online (4 October) ------
  Reset-World
  $script:runner2 = 'online'
  Yes 'two runners online: both counted, and one that only starts with the name is not' ((Check-Runner $S).Line -eq 'all 2 online, 1 running a job' -and -not (Check-Runner $S).Bad)
  $script:runner2 = 'offline'
  Yes 'the second offline is wrong too, and named' ((Check-Runner $S).Bad -and (Check-Runner $S).Why -eq 'GitHub shows thornswood-vps-2 offline, of 2')
  $null = Pass-Once; $null = Pass-Once; $null = Pass-Once
  Yes '  told once, after three runs, naming it' ((Posted '*are not all online on GitHub*thornswood-vps-2 offline*') -eq 1)
  $script:runner2 = 'online'
  $null = Pass-Once; $null = Pass-Once
  Yes '  and back once' ((Posted '*are all online again*') -eq 1)
  Clear-Posted

  # ---- #2857: GitHub not answering about the runners --------------------------
  # 19 Oct, 5:01 PM: One's call to GitHub timed out and the message said the
  # runners were down while all four were online.
  Reset-World
  $script:runner = 'no-answer'
  $c = Check-Runner $S
  Yes 'GitHub not answering is could not check, not the runners down' ($c.Unknown -and -not $c.Bad -and $c.Why -match 'GitHub did not answer')
  for ($i = 0; $i -lt 11; $i++) { $null = Pass-Once }
  Yes 'eleven runs in a row that could not ask: nothing said, it may be a blip' ($script:posted.Count -eq 0)
  $null = Pass-Once
  Yes 'the twelfth, an hour of them: told once, as the watcher that cannot check' ((Posted '`*`*The outside watcher cannot check the build runners.`*`* GitHub did not answer*') -eq 1)
  Yes '  never as the runners being down' ((Posted '*are not all online*') -eq 0)
  Yes '  and it says what that leaves unwatched, and where the token is' ((Posted '*could break and nobody would be told*WATCH_APP_KEY*') -eq 1)
  for ($i = 0; $i -lt 6; $i++) { $null = Pass-Once }
  Yes '  and not again while it still cannot' ((Posted '*outside watcher cannot check*') -eq 1)
  $script:runner = 'online'
  $null = Pass-Once
  Yes 'able to ask again: one message saying so, on the first run' ((Posted '*The outside watcher can check the build runners again*') -eq 1)
  Yes '  and that is all: two messages' ($script:posted.Count -eq 2)
  Clear-Posted

  # Could not check in the middle of a real outage changes nothing about it.
  Reset-World
  $script:runner = 'offline'
  $null = Pass-Once; $null = Pass-Once; $null = Pass-Once
  Yes 'runners really offline: told once' ((Posted '*are not all online on GitHub*') -eq 1)
  $script:runner = 'no-answer'
  $null = Pass-Once; $null = Pass-Once; $null = Pass-Once
  Yes 'then GitHub not answering: not taken for the runners coming back' ((Posted '*are all online again*') -eq 0)
  $before = @(Get-Content -LiteralPath $P.Outages | Where-Object { $_ -like 'runner|*' })[0]
  Yes '  and the outage is kept as it was' ($before -like 'runner|down|*')
  $script:runner = 'offline'
  $null = Pass-Once
  Yes '  asked again and still offline: no second message' ((Posted '*are not all online on GitHub*') -eq 1)
  $script:runner = 'online'
  $null = Pass-Once; $null = Pass-Once
  Yes '  and back once when they are' ((Posted '*are all online again*') -eq 1)
  Clear-Posted

  # The real Get-Runners, against the fake Get-Http.
  $env:WATCH_RUNNER_TOKEN = ''
  $g = & $realGetRunners 'ThornswoodRP/Thornswood'
  Yes 'Get-Runners: no token is said, never asked without one' ($g.Error -match 'no runner token' -and $g.Error -match 'WATCH_RUNNER_TOKEN')
  $env:WATCH_RUNNER_TOKEN = 'github_pat_FAKETOKEN123'
  $g = & $realGetRunners 'ThornswoodRP/Thornswood'
  Yes 'Get-Runners: the token goes as a bearer, and the list comes back' ($script:runnerAuth -eq 'Bearer github_pat_FAKETOKEN123' -and @($g.Runners).Count -eq 2 -and @($g.Runners)[1].Status -eq 'offline' -and -not $g.Error)
  $script:ghRunners = 401
  $g = & $realGetRunners 'ThornswoodRP/Thornswood'
  Yes 'Get-Runners: a refused token is said as refused' ($g.Error -match 'refused the runner token \(HTTP 401\)')
  $script:ghRunners = 0
  $g = & $realGetRunners 'ThornswoodRP/Thornswood'
  Yes 'Get-Runners: GitHub not answering is said in words' ($g.Error -eq 'GitHub did not answer within 20 seconds')
  $script:ghRunners = 502
  $g = & $realGetRunners 'ThornswoodRP/Thornswood'
  Yes 'Get-Runners: GitHub answering 502 is said' ($g.Error -eq 'GitHub answered HTTP 502')
  Yes 'Get-Runners: no reason names the repository or holds the token' (-not ($g.Error -match 'Thornswood|FAKETOKEN'))
  $env:WATCH_RUNNER_TOKEN = ''
  Reset-World

  # ---- the registry not answering is could not check --------------------------
  $script:rdap = 0
  $d = Check-Domain $S
  Yes 'RDAP not answering is could not check, not the domain running out' ($d.Unknown -and -not $d.Bad -and $d.Why -match 'registry')
  $script:rdap = 503
  Yes 'RDAP answering 503 is could not check too' ((Check-Domain $S).Unknown)
  Clear-Posted
  Tick 1440; $null = Pass-Once
  Tick 1440; $null = Pass-Once
  Yes 'a daily check that could not ask on two days running is told once' ((Posted '*outside watcher cannot check the registration of thornswood.net*') -eq 1 -and (Posted '*runs out soon*') -eq 0)
  $script:rdap = 200
  Tick 1440; $null = Pass-Once
  Yes '  and once when it can again' ((Posted '*can check the registration of thornswood.net again*') -eq 1)
  Clear-Posted
  Reset-World

  # ---- the address, the feed, the domain, Nexus ------------------------------
  Yes 'the name through Cloudflare''s proxy is right (#2995)' (-not (Check-Dns $S).Bad -and (Check-Dns $S).Line -match '104\.21\.5\.10, 172\.67\.130\.5, Cloudflare''s')
  $script:dns = @('2606:4700:3031::6815:50a')
  Yes '  an IPv6 address of Cloudflare''s is right too' (-not (Check-Dns $S).Bad)
  $script:dns = @('192.0.2.10')
  Yes 'the name straight at the VPS, the proxy off, is wrong and says so' ((Check-Dns $S).Bad -and (Check-Dns $S).Why -match 'that is the VPS itself, with the proxy off')
  $script:dns = @('203.0.113.5')
  Yes 'the name pointing elsewhere is wrong' ((Check-Dns $S).Bad -and (Check-Dns $S).Why -match '203\.0\.113\.5 is not Cloudflare''s')
  $script:dns = @('104.21.5.10', '203.0.113.5')
  Yes 'the name pointing at Cloudflare and somewhere else is wrong' ((Check-Dns $S).Bad)
  $script:dns = @()
  Yes 'the name not resolving is wrong' ((Check-Dns $S).Bad)
  $keep = $S.FrontRanges; $S.FrontRanges = @(); $script:dns = @('104.21.5.10')
  Yes 'no list of ranges to compare with is could not check' ((Check-Dns $S).Unknown)
  $S.FrontRanges = $keep
  Reset-World
  Yes 'the game''s name resolving, DNS only, is right, and the line names no address (#3690)' (-not (Check-Game $S).Bad -and -not (Check-Game $S).Unknown -and (Check-Game $S).Line -notmatch '\d+\.\d+\.\d+\.\d+')
  $script:gameDns = @()
  Yes 'the game''s name not resolving is wrong, and says nobody can reach the game' ((Check-Game $S).Bad -and (Check-Game $S).Why -match 'no launcher can reach the game')
  $script:gameDns = @('104.21.5.10')
  Yes 'the game''s name behind Cloudflare''s proxy is wrong: the game port is UDP' ((Check-Game $S).Bad -and (Check-Game $S).Why -match 'proxy is on')
  $script:gameDns = @('192.0.2.10'); $keepHost = $S.GameHost; $S.GameHost = ''
  Yes 'no game name to ask about is could not check' ((Check-Game $S).Unknown)
  $S.GameHost = $keepHost
  Reset-World
  Yes 'Cloudflare''s ranges matching ours is right' (-not (Check-Ranges $S).Bad -and (Check-Ranges $S).Line -match 'the 3 ranges match')
  $script:cfBody = '{"result":{"ipv4_cidrs":["104.16.0.0/13","172.64.0.0/13","198.51.100.0/22"],"ipv6_cidrs":[]},"success":true}'
  $c = Check-Ranges $S
  Yes 'a range Cloudflare added and one it dropped are wrong, each named' ($c.Bad -and $c.Why -match 'new 198\.51\.100\.0/22' -and $c.Why -match 'no longer listed 2606:4700::/32')
  $script:cfCode = 0
  Yes 'Cloudflare''s API not answering is could not check' ((Check-Ranges $S).Unknown -and -not (Check-Ranges $S).Bad)
  $script:cfCode = 200; $script:cfBody = '{"success":false,"result":null}'
  Yes 'an answer without the ranges is could not check' ((Check-Ranges $S).Unknown)
  Reset-World
  $feedDef = @($S.Feeds)[0]
  $script:feedBody = '<html>not a feed</html>'
  Yes 'a feed that is not a feed is wrong' ((Check-Feed $S $feedDef).Bad -and (Check-Feed $S $feedDef).Why -match 'not with a feed')
  Reset-World
  Yes 'a feed with no packs but a release record is right (#1050: feeds carry no packs)' (-not (Check-Feed $S $feedDef).Bad -and (Check-Feed $S $feedDef).Line -match 'release 20261012-115531')
  $script:feedBody = '{"launcherVersion":"1.2.4","launcherUrl":"https://thornswood.net/feed/assets/abc","packs":[]}'
  Yes 'a feed with no release record is wrong' ((Check-Feed $S $feedDef).Bad -and (Check-Feed $S $feedDef).Why -match 'no release record')
  $script:feedBody = '{"launcherVersion":"1.2.4","packs":[],"baseline":{"id":"20261012-115531"}}'
  Yes 'a feed with no launcherUrl is wrong' ((Check-Feed $S $feedDef).Bad -and (Check-Feed $S $feedDef).Why -match 'no launcherUrl')
  Reset-World; $script:feed = 502
  Yes 'a feed answering 502 is wrong' ((Check-Feed $S $feedDef).Why -match 'HTTP 502')
  Reset-World; $script:launcher = 404
  Yes 'a feed whose launcher does not download is wrong' ((Check-Feed $S $feedDef).Why -match 'launcher it names')
  Reset-World; $script:rdapEnd = $script:clock.ToUniversalTime().AddDays(20).ToString('o')
  Yes 'a domain with 20 days left is wrong' ((Check-Domain $S).Bad)
  Reset-World; $script:nexus = '{"data":{"collection":null}}'
  Yes 'a collection Nexus no longer has is wrong' ((Check-Nexus $S).Bad)
  Reset-World

  # ---- a webhook that fails, then works ---------------------------------------
  Clear-Posted
  $script:hookFails = $true
  $script:dns = @('203.0.113.5')
  $null = Pass-Once; $null = Pass-Once
  Yes 'webhook failing: the message waits in the outbox' ((Get-Content -LiteralPath $P.Alerts -Raw) -match 'does not point at Cloudflare')
  Yes 'and nothing was counted as posted' (-not (Test-Path -LiteralPath $P.Sent) -or -not ((Get-Content -LiteralPath $P.Sent -Raw) -match '-dns-down'))
  $log = Get-Content -LiteralPath $P.Log -Raw
  Yes 'watch.log says it could not post, once' (([regex]::Matches($log, 'could not post outside-\d+-dns-down')).Count -eq 1)
  $script:hookFails = $false
  $null = Pass-Once
  Yes 'webhook working again: the waiting message is posted' ((Posted '*does not point at Cloudflare*') -eq 1)
  $null = Pass-Once
  Yes 'and only once' ((Posted '*does not point at Cloudflare*') -eq 1)
  Reset-World
  $null = Pass-Once; $null = Pass-Once
  Clear-Posted

  # Every row in the outbox has the VPS outbox's shape.
  $rows = @(Get-Content -LiteralPath $P.Alerts | ForEach-Object { ConvertFrom-Json $_ })
  $shape = @($rows | Where-Object { $_.id -like 'outside-*' -and $_.at -gt 0 -and $_.service -like 'outside *' -and @('down', 'back') -contains $_.kind -and $_.text })
  Yes ('every outbox row has id, at, service, kind and text, ' + $rows.Count + ' rows') ($rows.Count -gt 0 -and $shape.Count -eq $rows.Count)

  # ---- no webhook at all ----------------------------------------------------------
  $env:WATCH_WEBHOOK = ''
  $script:site = 0
  $null = Pass-Once; $null = Pass-Once
  Yes 'no webhook: nothing is posted' ($script:posted.Count -eq 0)
  Yes 'no webhook: the log says it waits and names the setting' ((Get-Content -LiteralPath $P.Log -Raw) -match 'no webhook is set here \(WATCH_WEBHOOK\), so outside-\d+-site-down waits')
  $env:WATCH_WEBHOOK = 'https://example.com/not-a-webhook'
  $null = Pass-Once
  Yes 'something that is not a Discord webhook is no webhook' ($script:posted.Count -eq 0)
  $env:WATCH_WEBHOOK = $HookUrl
  $null = Pass-Once
  Yes 'webhook set later: the waiting message goes out' ((Posted '*is down*') -eq 1)
  Reset-World; $null = Pass-Once; $null = Pass-Once
  Clear-Posted

  # ---- this machine offline ----------------------------------------------------------
  $before = Get-Content -LiteralPath $P.Outages -Raw
  $rowsBefore = @(Get-Content -LiteralPath $P.Alerts).Count
  $script:online = $false
  $r = Pass-Once; $null = Pass-Once; $null = Pass-Once
  Yes 'offline: the pass says so' ($null -eq $r)
  Yes 'offline: nothing is told, however long' ($script:posted.Count -eq 0 -and @(Get-Content -LiteralPath $P.Alerts).Count -eq $rowsBefore)
  Yes 'offline: what is down is left as it was' ((Get-Content -LiteralPath $P.Outages -Raw) -eq $before)
  Yes 'offline: watch.log says this machine is offline' ((Get-Content -LiteralPath $P.Log -Raw) -match 'this machine is offline')
  Reset-World

  # ---- looking without -Remember ---------------------------------------------------------
  $look = Join-Path $dir 'look'
  $PL = Paths $look
  $script:site = 0
  $r = Invoke-Watch $S $PL
  Yes 'a look without -Remember sees the site down' ($r['site'].Bad)
  Yes 'a look without -Remember writes nothing and posts nothing' (-not (Test-Path -LiteralPath $look) -and $script:posted.Count -eq 0)
  Reset-World

  # ---- where the webhook posts (#2501) ----------------------------------------------------
  # Asked of Discord by a GET on the webhook itself, which answers with its
  # channel_id. -TestPost refuses any channel but #staff-updates.
  $script:hookCode = 200; $script:hookBody = '{"id":"123456","channel_id":"1549254991082946570","name":"Watchdog"}'
  $wc = Webhook-Channel $HookUrl
  Yes 'Webhook-Channel: a webhook in #staff-updates says so' ($wc.Channel -eq '1549254991082946570' -and -not $wc.Why)
  $script:hookBody = '{"id":"123456","channel_id":"1550176792726343700","name":"Watchdog"}'
  $wc = Webhook-Channel $HookUrl
  Yes 'Webhook-Channel: one in the dev updates channel names that channel, not #staff-updates' ($wc.Channel -eq '1550176792726343700' -and $wc.Channel -ne $S.StaffChannel)
  $script:hookCode = 404; $script:hookBody = '{"message":"Unknown Webhook"}'
  $wc = Webhook-Channel $HookUrl
  Yes 'Webhook-Channel: a deleted webhook is no channel, and says why' (-not $wc.Channel -and $wc.Why -match '404')
  Yes 'Webhook-Channel: neither answer holds the address' ((('' + $wc.Why) -notmatch 'SECRETHOOKTOKEN') -and (('' + $wc.Why) -notmatch 'api/webhooks'))

  # ---- the run log is public ----------------------------------------------------------------
  # Everything Pass-Once printed above, through outages of every kind: the
  # runners named, offline and back, GitHub not answering, the token refused.
  $public = $script:printed -join "`n"
  Yes ('the run log was written to (' + $script:printed.Count + ' lines)') ($script:printed.Count -gt 100)
  Yes 'the run log names no runner' ($public -notmatch 'thornswood-vps')
  Yes 'the run log does not name the private repository' ($public -notmatch 'EvilPatrick06')
  Yes 'the run log says nothing about the runners but the outcome' (
    @($script:printed | Where-Object { $_ -match '^\s+runner\s+(ok|WRONG)\s' -and $_ -notmatch '^\s+runner\s+(ok|WRONG)\s+\(about a private repository, so not shown here\)$' }).Count -eq 0 -and
    @($script:printed | Where-Object { $_ -match '^\s+runner\s+(ok|WRONG)\s' }).Count -gt 0)
  # Could not check prints why (#2755, 21 Oct): a refused token says so with
  # its HTTP code, and no reason names a runner or the repository (above).
  Yes 'could not check the runners says why in the run log' (
    @($script:printed | Where-Object { $_ -match '^\s+runner\s+COULD NOT CHECK\s+\S' }).Count -gt 0 -and
    @($script:printed | Where-Object { $_ -match '^\s+runner\s+COULD NOT CHECK\s+\(about a private' }).Count -eq 0)
  $env:WATCH_RUNNER_TOKEN = 'github_pat_FAKETOKEN123'; $script:ghRunners = 401
  $u = Unknown (& $realGetRunners 'ThornswoodRP/Thornswood').Error; $u.Private = $true
  $env:WATCH_RUNNER_TOKEN = ''
  $shown = (Write-Results ([ordered]@{ runner = $u }) 6>&1 | Out-String)
  Yes '  a refused token is printed as refused, with its HTTP code, and nothing else' ($shown -match 'runner\s+COULD NOT CHECK\s+GitHub refused the runner token \(HTTP 401\)' -and $shown -notmatch 'Thornswood|FAKETOKEN')
  Yes 'the run log carries no message text, only ids' ($public -notmatch 'is down\.|are not all online|cannot check|Checked from outside')
  Yes 'the run log holds no webhook and no token' ($public -notmatch 'SECRETHOOKTOKEN|api/webhooks|FAKETOKEN')
  Yes 'the public lines are there: the site and a feed say what they saw' ($public -match 'site\s+ok\s+answered 200' -and $public -match 'feed\s+ok\s+answered, release')

  # ---- -Remove on One (#2990) -------------------------------------------------------------
  # One's old task lets only an administrator delete it. A plain shell is
  # stopped before it tries, and told how to run it; a refusal is printed
  # with Windows' own words. Until #2990 the refusal was swallowed and the
  # run said only that the task was still registered.
  Yes 'Remove-OldWatch is there' ([bool](Get-Command Remove-OldWatch -EA SilentlyContinue))
  if (Get-Command Remove-OldWatch -EA SilentlyContinue) {
    $script:tasks = New-Object System.Collections.Generic.List[string]
    $script:elevated = $false; $script:unregCalls = 0; $script:unregRefuse = ''; $script:listRefuse = ''
    function Test-Elevated { return $script:elevated }
    function Get-ScheduledTask { if ($script:listRefuse) { throw $script:listRefuse }; return @($script:tasks | ForEach-Object { [pscustomobject]@{ TaskName = $_ } }) }
    function Unregister-ScheduledTask([string]$TaskName, [switch]$Confirm) {
      $script:unregCalls++
      if ($script:unregRefuse) { throw $script:unregRefuse }
      [void]$script:tasks.Remove($TaskName)
    }
    $script:said = New-Object System.Collections.Generic.List[string]
    $sayInto = { param($m, $c) $script:said.Add($m) }
    $oldDir = Join-Path $dir 'old-watch'
    function Reset-Remove {
      $script:tasks.Clear(); $script:tasks.Add('Thornswood Watch Outside'); $script:tasks.Add('Something Else')
      $script:elevated = $false; $script:unregCalls = 0; $script:unregRefuse = ''; $script:listRefuse = ''; $script:said.Clear()
      $null = New-Item -ItemType Directory -Path $oldDir -Force; Set-Content -LiteralPath (Join-Path $oldDir 'alerts.jsonl') -Value 'x'
    }
    $runLine = "& 'C:\Thornswood-Repo\scripts\vps\Watch-Outside.ps1' -Remove -TaskName 'Thornswood Watch Outside'"

    Reset-Remove
    $code = Remove-OldWatch 'Thornswood Watch Outside' $oldDir $runLine $sayInto
    $text = $script:said -join "`n"
    Yes '-Remove in a plain shell stops before it tries, and fails' ($code -eq 1 -and $script:unregCalls -eq 0)
    Yes '  saying only an administrator can delete it, and the line to run there' ($text -match 'only an administrator' -and $text -match 'Run as administrator' -and $text.Contains($runLine))
    Yes '  and leaves the task and its folder as they were' ($script:tasks.Contains('Thornswood Watch Outside') -and (Test-Path -LiteralPath $oldDir))

    Reset-Remove; $script:elevated = $true
    $script:unregRefuse = 'Access is denied. (HRESULT 0x80070005)'
    $code = Remove-OldWatch 'Thornswood Watch Outside' $oldDir $runLine $sayInto
    $text = $script:said -join "`n"
    Yes '-Remove that Windows refuses fails, with Windows'' own words' ($code -eq 1 -and $text -match 'refused to remove Thornswood Watch Outside: Access is denied\. \(HRESULT 0x80070005\)')
    Yes '  and keeps the folder, since the task is still there' (Test-Path -LiteralPath $oldDir)

    Reset-Remove; $script:elevated = $true
    $code = Remove-OldWatch 'Thornswood Watch Outside' $oldDir $runLine $sayInto
    $text = $script:said -join "`n"
    Yes '-Remove as administrator takes the task off, and only that task' ($code -eq 0 -and -not $script:tasks.Contains('Thornswood Watch Outside') -and $script:tasks.Contains('Something Else') -and $text -match 'removed Thornswood Watch Outside')
    Yes '  and its folder with the webhook copy' (-not (Test-Path -LiteralPath $oldDir) -and $text -match 'with its copy of the webhook')

    Reset-Remove; $script:tasks.Remove('Thornswood Watch Outside') | Out-Null
    $code = Remove-OldWatch 'Thornswood Watch Outside' $oldDir $runLine $sayInto
    $text = $script:said -join "`n"
    Yes '-Remove with no task, in a plain shell, says it is not registered and still clears the folder' ($code -eq 0 -and $script:unregCalls -eq 0 -and $text -match 'is not registered' -and -not (Test-Path -LiteralPath $oldDir))

    Reset-Remove; $script:listRefuse = 'The task service could not be reached'
    $code = Remove-OldWatch 'Thornswood Watch Outside' $oldDir $runLine $sayInto
    $text = $script:said -join "`n"
    Yes '-Remove that cannot list the tasks says why, and is not told as no task' ($code -eq 1 -and $text -match 'would not list the scheduled tasks: The task service could not be reached' -and $text -notmatch 'is not registered')
    Remove-Item -LiteralPath $oldDir -Recurse -Force -EA SilentlyContinue
  }
  Yes '-Remove no longer drops what Windows says' ((Get-Content -LiteralPath $ScriptPath -Raw) -notmatch 'Unregister-ScheduledTask\s+-TaskName[^\r\n]*SilentlyContinue')

  # ---- words and secrets ----------------------------------------------------------------
  $all = (Get-Content -LiteralPath $P.Alerts -Raw) + (Get-Content -LiteralPath $P.Log -Raw)
  Yes 'the webhook address is in neither the outbox nor watch.log' ($all -notmatch 'SECRETHOOKTOKEN' -and $all -notmatch 'api/webhooks')
  $words = (Get-Content -LiteralPath $ScriptPath -Raw) + $all + (Get-Content -LiteralPath (Join-Path $pub 'README.md') -Raw) + $wf + $ka
  Yes 'no em dash in the script, the public repository''s files or anything it wrote' ($words.IndexOf([char]0x2014) -lt 0)
  Yes 'never the word player' ($words -notmatch '(?i)\bplayers?\b')
}
finally {
  $env:WATCH_WEBHOOK = $oldHook
  $env:WATCH_RUNNER_TOKEN = $oldToken
  Remove-Item -LiteralPath $dir -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
$c = 'Green'; if ($script:fail) { $c = 'Red' }
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail) -ForegroundColor $c
if ($script:fail) { exit 1 }
exit 0
