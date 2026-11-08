<#
  Setup-Domain.ps1

  Puts thornswood.net in front of the docs site, with a real certificate.

  Run this AFTER the domain is bought and its DNS A record points at the VPS,
  or at Cloudflare's proxy in front of it (#2995). It checks that first and
  stops if it does not, because a certificate request against a name that
  does not resolve here gets you rate limited by Let's Encrypt rather than a
  certificate.

    .\Setup-Domain.ps1
    .\Setup-Domain.ps1 -Domain thornswood.net -Email you@example.com

  Caddy rather than win-acme and node's own TLS. Caddy obtains the certificate,
  renews it on its own forever, redirects plain HTTP to HTTPS and proxies to
  the docs site, and the whole configuration is four lines. The alternative is
  a certificate request, an export to PEM, node reading two files, and a
  renewal task that everyone forgets until the site goes down 90 days later.

  The docs site is also moved onto loopback by this, so port 3001 stops being
  a way around the certificate.

  BEHIND CLOUDFLARE (#2995, Patrick's A, 21 Oct 2026). The live name is
  proxied by Cloudflare, and the box takes 80 and 443 only from Cloudflare's
  ranges (Set-WebFirewall.ps1). This opens the two rules to any address only
  when it makes them, on a fresh box, where the name still points straight
  at the box until its proxy goes on; an existing rule is left as it is, so
  running this again never undoes the scope. Caddy still gets its own
  certificate: Let's Encrypt asks through Cloudflare, and Cloudflare, set to
  Full (strict), reaches Caddy on 443, where Caddy answers the challenge.
#>
[CmdletBinding()]
param(
  [string]$Domain = 'thornswood.net',
  [string]$Email,
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Root = 'C:/Thornswood-Docs',
  [string]$CaddyDir = 'C:/Thornswood-Caddy',
  # One Caddy release, and the SHA-512 Caddy publishes for its Windows zip in
  # caddy_<version>_checksums.txt on the release page. This used to fetch from
  # the download API on caddyserver.com, which is whatever build Caddy serves
  # that day, checked against nothing, so the next fresh box could have come up
  # on a new major nobody had tried. Bump both together, on purpose, from
  # https://github.com/caddyserver/caddy/releases. 2.11.4 is the newest release
  # as of 24 Sep and so the build the old URL was handing out; its zip was
  # downloaded and hashed that day and matched both the value here and the
  # SHA-256 GitHub shows beside the asset.
  [string]$CaddyVersion = '2.11.4',
  [string]$CaddySha512  = 'cd5ccfd86a4b40732cf715890d0dca5bf3f63adefec5a7914de85adf240c60ce7e5d2791631b88ef9758e46b23bb1730e020b9c5d696889740b284ffd4788e35',
  [switch]$SkipDnsCheck,
  # Only register the Thornswood Web task and restart Caddy. Nothing is
  # downloaded, no Caddyfile is written, no firewall rule is touched and the
  # docs site is left alone.
  #
  # This exists because the task is registered only when it does not already
  # exist, so changing the settings above in this file does nothing at all to
  # a box that is already set up, and running the whole script to fix a task
  # redoes the certificate and the firewall for no reason.
  [switch]$TaskOnly,
  # Register Thornswood Web as SYSTEM, Highest, the way it was before #2578,
  # and grant nothing. The way back if Caddy will not run as LOCAL SERVICE.
  [switch]$AsSystem
)

$ErrorActionPreference = 'Stop'
$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')

function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

# What both halves need to reach the box: the shared Remote, and the box's
# address and account. Above the one time setup, not inside it: until 5 Oct
# they were loaded there, so -TaskOnly (#1968) stopped at its first Remote on
# "Invoke-ThornswoodRemote is not recognized" with nothing sent. And above the
# DNS check, which compares the name with the box's address: until 19 Oct it
# ran first, so a full run without -Vps stopped on "resolves to
# the box and not ." with the address still empty.
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here '..\vps\Lock-Folder.ps1')
. (Join-Path $Here 'ServiceAccount.ps1')
# The hold it writes while it has Caddy stopped (#5155).
. (Join-Path $Here '..\vps\ServerHold.ps1')
# Where the box keeps its firewall rules, and the refresh that makes the
# firewall take a change to them (#3896).
. (Join-Path $Here '..\vps\BoxFirewall.ps1')
. (Join-Path $Here 'CloudflareRanges.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }

# ------------------------------------------------------------------- dns --
if (-not $SkipDnsCheck -and -not $TaskOnly) {
  Write-Host "Checking where $Domain points..."
  # A name with no record yet is an error from Resolve-DnsName, as is a DNS
  # server that cannot be reached; what it said goes into the stop.
  $ips = @()
  $dnsSaid = @()
  foreach ($name in @($Domain, "www.$Domain")) {
    try {
      $ips += (Resolve-DnsName $name -Type A -ErrorAction Stop |
               Where-Object { $_.IPAddress }).IPAddress
    } catch { $dnsSaid += ($name + ': ' + $_.Exception.Message) }
  }
  $ips = $ips | Sort-Object -Unique
  if (-not $ips) {
    throw ("$Domain does not resolve yet" + $(if ($dnsSaid.Count) { " (" + ($dnsSaid -join ' | ') + ")" } else { "" }) + ". Add an A record for @ and www pointing at $Vps, then wait for it to spread. Minutes usually, up to an hour.")
  }
  foreach ($d in $dnsSaid) { Write-Host ("  " + $d) -ForegroundColor Yellow }
  # Straight at the box, or only into Cloudflare's ranges with its proxy on
  # (#2995). Anything else is a record pointing somewhere this is not.
  $front = Read-ThornswoodCloudflareRanges
  $behind = @($ips | Where-Object { Test-ThornswoodInRanges $_ $front })
  if ($ips -contains $Vps) {
    Write-Host "  points at $Vps" -ForegroundColor Green
  } elseif ($behind.Count -eq @($ips).Count) {
    Write-Host ("  points at Cloudflare's proxy (" + ($ips -join ', ') + ')') -ForegroundColor Green
  } else {
    throw "$Domain resolves to $($ips -join ', '), which is neither $Vps nor Cloudflare's proxy. Fix the A record first."
  }
}

# ----------------------------------------------------------------- caddy --
$caddyWin = $CaddyDir.Replace('/','\')
$rootWin  = $Root.Replace('/','\')

# Everything from here to the task block is the one time setup: fetching caddy,
# writing the Caddyfile, opening 80 and 443, and moving the docs site onto
# loopback. None of it needs doing again to change how the task is registered,
# so -TaskOnly skips the lot.
if (-not $TaskOnly) {

Write-Host ''
Write-Host 'Setting up Caddy on the VPS...'

# The Caddyfile is scripts\deploy\Caddyfile, the tracked copy of the live one, and not
# one written here. This used to write its own four line file that proxied the
# domain to 3001 and nothing else, so a full run on a new box, as
# MOVING-THE-SERVER.md (in the ops repo) says to do, would have taken the /voice and /voice-dev
# routes off the site and voice from everybody (issue #543). -Domain and
# -Email still apply: the tracked file names thornswood.net, which is swapped
# for what was asked, and no contact address (#3838), so -Email goes in as
# the first line of the global options block, or replaces an email line that
# is there.
$tracked = Join-Path $Here 'Caddyfile'
if (-not (Test-Path -LiteralPath $tracked)) { throw "not found: $tracked. The site's Caddyfile is kept in the repository, and nothing is sent without it." }
$caddyfile = [IO.File]::ReadAllText($tracked, [Text.Encoding]::UTF8)
if ($Domain -ne 'thornswood.net') { $caddyfile = $caddyfile.Replace('thornswood.net', $Domain) }
if ($Email) {
  if ($caddyfile -match '(?m)^\s*email\s+\S+') {
    $caddyfile = [regex]::Replace($caddyfile, '(?m)^(\s*email\s+)\S+', { param($m) $m.Groups[1].Value + $Email })
  } else {
    $open = [regex]::Match($caddyfile, '(?m)^\{(\r?\n)')
    if (-not $open.Success) { throw "scripts\deploy\Caddyfile has no global options block ('{' on a line of its own) for -Email to go in. Nothing was sent." }
    $caddyfile = $caddyfile.Insert($open.Index + $open.Length, "`temail $Email" + $open.Groups[1].Value)
  }
}
foreach ($need in @('handle_path /voice/*', 'handle_path /voice-dev/*', 'handle_path /box/*', 'handle_path /github-app/*', 'reverse_proxy 127.0.0.1:3001')) {
  if ($caddyfile.IndexOf($need) -lt 0) { throw "scripts\deploy\Caddyfile has no '$need' line, so it would take part of the site away. Nothing was sent." }
}
# The headers every answer from the name carries are set at the door (#2762),
# so a Caddyfile without them would send voice, the box bridge and the admin
# App's answers out bare again.
foreach ($need in @('Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy')) {
  # A line that sets it, not a comment that names it.
  if (-not [regex]::IsMatch($caddyfile, '(?m)^\s*' + [regex]::Escape($need) + '\s')) { throw "scripts\deploy\Caddyfile sets no $need header, so what Caddy carries would go out without it (#2762). Nothing was sent." }
}
$cfg64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($caddyfile))

Remote @"
`$ErrorActionPreference = 'Stop'
`$dir = '$caddyWin'
$(Get-ThornswoodLockedFolderScript $caddyWin)

if (-not (Test-Path (Join-Path `$dir 'caddy.exe'))) {
  'downloading caddy $CaddyVersion'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  `$zip = Join-Path `$dir 'caddy_${CaddyVersion}_windows_amd64.zip'
  Invoke-WebRequest -UseBasicParsing ``
    -Uri 'https://github.com/caddyserver/caddy/releases/download/v$CaddyVersion/caddy_${CaddyVersion}_windows_amd64.zip' ``
    -OutFile `$zip
  # Checked before anything is unpacked. A zip that does not match is deleted
  # and nothing is installed, rather than a caddy.exe nobody can vouch for.
  `$got = (Get-FileHash -LiteralPath `$zip -Algorithm SHA512).Hash
  if (`$got -ne '$CaddySha512') {
    Remove-Item -LiteralPath `$zip -Force -EA SilentlyContinue
    throw ('caddy $CaddyVersion does not match the checksum Caddy published for it, so it was not installed. Got ' + `$got)
  }
  # The zip also carries LICENSE and README.md. Only caddy.exe is wanted.
  `$unpack = Join-Path `$dir 'caddy-unpack'
  Expand-Archive -LiteralPath `$zip -DestinationPath `$unpack -Force
  Move-Item -LiteralPath (Join-Path `$unpack 'caddy.exe') -Destination (Join-Path `$dir 'caddy.exe')
  Remove-Item -LiteralPath `$unpack, `$zip -Recurse -Force
  'downloaded caddy $CaddyVersion, checksum matched'
} else {
  # The pin is for a fresh box. One that already has caddy keeps it, and says
  # which it is, so a box on some other version is plain to see.
  `$have = 'a version it would not say'
  try { `$have = ((& (Join-Path `$dir 'caddy.exe') version) -join ' ').Trim() } catch { `$have = 'a version it would not say (' + (`$_.Exception.Message -replace '\s+', ' ') + ')' }
  'caddy already here, ' + `$have + '. A fresh box gets $CaddyVersion.'
}

# A Caddyfile already on the box is kept beside the new one before it is
# replaced, so a route somebody added by hand can be put back.
`$cf = Join-Path `$dir 'Caddyfile'
`$bytes = [Convert]::FromBase64String('$cfg64')
if (Test-Path -LiteralPath `$cf) {
  `$old = [IO.File]::ReadAllBytes(`$cf)
  if ([Convert]::ToBase64String(`$old) -ne '$cfg64') {
    `$keep = `$cf + '.before-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item -LiteralPath `$cf -Destination `$keep -Force
    'the Caddyfile that was there is kept as ' + (Split-Path -Leaf `$keep)
  }
}
[IO.File]::WriteAllBytes(`$cf, `$bytes)
'Caddyfile written, from scripts\deploy\Caddyfile'

# The web rules live in the box's own policy store, the only one the firewall
# takes rules from, and Group Policy is refreshed after a change
# (scripts\vps\BoxFirewall.ps1, #3896).
$(Get-ThornswoodFirewallScript)
`$fwMade = 0
# Whether the rule is there is read from what the firewall takes (the active
# store), not the policy store alone: until Set-InboundRules.ps1 -Own has run,
# the scoped rules are in the local store, and on 8 Nov 2026 a run that looked
# only in the policy store made a second pair there that took any address
# (#5334).
foreach (`$p in 80,443) {
  `$n = 'Thornswood Web ' + `$p
  if (-not (Get-NetFirewallRule -PolicyStore ActiveStore -DisplayName `$n -EA SilentlyContinue)) {
    New-NetFirewallRule -PolicyStore localhost -DisplayName `$n -Direction Inbound -Protocol TCP ``
      -LocalPort `$p -Action Allow | Out-Null
    `$fwMade++
    'opened ' + `$p + ' to any address. Once the name is behind Cloudflare, Set-WebFirewall.ps1 takes it to Cloudflare''s ranges only (#2995)'
  }
}
if (`$fwMade) { Sync-ThornswoodFirewall }
"@ | ForEach-Object { "  $_" }

# The docs site moves to loopback, so 3001 is no longer a plain HTTP way in.
Write-Host ''
Write-Host 'Closing port 3001 to the outside...'
Remote @"
`$ErrorActionPreference = 'Continue'
$(Get-ThornswoodFirewallScript)
if (Get-NetFirewallRule -PolicyStore localhost -DisplayName 'Thornswood Docs' -EA SilentlyContinue) {
  Remove-NetFirewallRule -PolicyStore localhost -DisplayName 'Thornswood Docs'
  Sync-ThornswoodFirewall
}

# The docs task's action is Deploy-Docs.ps1's, which starts it through the
# launcher that makes what the site writes its own (#4077); a plain action
# set here took that off at every run.
[Environment]::SetEnvironmentVariable('THORNSWOOD_DOCS_LOCAL','1','Machine')

Get-CimInstance Win32_Process |
  Where-Object { `$_.Name -eq 'node.exe' -and `$_.CommandLine -like '*Thornswood-Docs*' } |
  ForEach-Object { Stop-Process -Id `$_.ProcessId -Force -EA SilentlyContinue }
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName 'Thornswood Docs' -EA SilentlyContinue
'docs restarted on loopback'
"@ | ForEach-Object { "  $_" }

}

Write-Host ''
Write-Host 'Starting Caddy...'
# What the box runs to move Caddy onto its task and restart it. It is not
# run inside an ssh session (#3193): from One, ssh to the box goes through
# the bridge, the bridge goes through Caddy, and this stops Caddy, so the
# session it ran in was cut halfway, everything it said after that was lost
# and the run ended as ssh's exit 255 whether or not the box finished
# (measured 21 Oct 2026, #2995's step A2). It runs on the box on its own
# instead, writing what it says to a report there, and the report is read
# over a fresh session once Caddy, and with it the bridge, is back.
$restart = @"
`$ErrorActionPreference = 'Continue'
`$dir = '$caddyWin'
`$exe = Join-Path `$dir 'caddy.exe'

# The account Caddy runs as (#2578, ServiceAccount.ps1). The fail-safe comes
# before Caddy is stopped: it goes onto LOCAL SERVICE only where LOCAL SERVICE
# can read none of what no service may.
$(Get-ThornswoodServiceAccountScript)
`$asSystem = [bool]$([int][bool]$AsSystem)
if (-not `$asSystem) {
  `$cannot = @(Test-ThornswoodServiceCannotReach (Get-ThornswoodServiceNeverReach))
  if (`$cannot.Count) {
    'LOCAL SERVICE could read what no service may, so Caddy is not moved onto it:'
    `$cannot
    'Lock those (scripts\vps\Lock-VpsFolders.ps1), or pass -AsSystem. Caddy was not stopped or changed.'
    exit 1
  }
}

# Caddy keeps its certificates and ACME account in data beside it (the
# Caddyfile's storage line, #2578), not in the profile of whichever account
# runs it, so they are the same under SYSTEM and LOCAL SERVICE. What it kept
# as SYSTEM is copied in once, so the move does not ask Let's Encrypt again.
`$data = Join-Path `$dir 'data'
if (-not (Test-Path -LiteralPath `$data)) { `$null = New-Item -ItemType Directory -Path `$data -Force }
`$kept = Join-Path `$env:SystemRoot 'System32\config\systemprofile\AppData\Roaming\Caddy'
if ((Test-Path -LiteralPath `$kept) -and -not (Test-Path -LiteralPath (Join-Path `$data 'certificates'))) {
  Copy-Item -Path (Join-Path `$kept '*') -Destination `$data -Recurse -Force
  'copied what Caddy kept as SYSTEM into ' + `$data
}

# Held from the stop until it is started again (#5155, ServerHold.ps1), so
# the watchdog does not start the old Caddy in the middle.
$(Get-ThornswoodHoldScript -Script 'Setup-Domain.ps1')
Set-ThornswoodHold -Target 'Thornswood Web' -Why 'putting Caddy on its new task and settings' -By `$HoldBy
Stop-ScheduledTask -TaskName 'Thornswood Web' -EA SilentlyContinue
Get-Process caddy -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue

`$a = New-ScheduledTaskAction -Execute `$exe ``
      -Argument 'run --config Caddyfile' -WorkingDirectory `$dir

# TWO TRIGGERS. At startup, as before, and again every five minutes.
#
# On 21 September the site was down and stayed down. The task was Status Ready
# with no caddy.exe at all, so nothing was crashing in a loop: it had stopped
# and nothing was ever going to start it again, because a startup trigger fires
# at startup. Nobody knew until two testers reported it as launcher faults,
# because the launcher checks people in through the site and voice runs on the
# same hostname.
#
# MultipleInstances IgnoreNew is what makes the five minute trigger safe: while
# caddy is up the trigger does nothing at all, and it starts it when it is not.
# Without it a second caddy is launched every five minutes and cannot have 443.
#
# RepetitionDuration is ten years rather than [TimeSpan]::MaxValue. MaxValue is
# documented to mean indefinitely and is refused outright by some builds, and a
# trigger that failed to register is exactly the silence this is fixing.
`$boot  = New-ScheduledTaskTrigger -AtStartup
`$again = New-ScheduledTaskTrigger -Once -At (Get-Date) ``
      -RepetitionInterval (New-TimeSpan -Minutes 5) ``
      -RepetitionDuration (New-TimeSpan -Days 3650)

# The same settings the docs task beside this one already has, and for the
# reasons written out in Deploy-Docs.ps1. THE EXECUTION TIME LIMIT IS THE ONE
# THAT MATTERS and it is almost certainly why caddy stopped: the default stops
# a task after three days, caddy is meant to run until the box goes down, and a
# task the scheduler ends looks exactly like what was found, Ready with no
# process and nothing in any crash log. Ten restarts rather than three for the
# same reason the docs task has ten.
#
# Priority 4, normal, not Task Scheduler's default of 7 (#1968). Without it
# caddy.exe ran below normal, with I/O priority 1 (low) and memory priority
# 2, measured on the VPS on 5 October, and in the kernel trace of 4 October
# 17:18 its reads took a median of 47 ms, held back the way the game
# server's were (#1931). 4 gives Normal, I/O priority 2 and memory priority
# 5, what the services on the box run at. tests\test-service-task-priority.ps1
# measures all three.
`$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries ``
      -DontStopIfGoingOnBatteries -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) ``
      -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable ``
      -MultipleInstances IgnoreNew -Priority 4

# LOCAL SERVICE, Limited, with a SID of its own (#2578); -AsSystem is SYSTEM,
# Highest, as it was. Given on an existing task too, for the reason below.
`$who = New-ThornswoodServicePrincipal -AsSystem:`$asSystem
if (-not (Get-ScheduledTask -TaskName 'Thornswood Web' -EA SilentlyContinue)) {
  Register-ScheduledTask -TaskName 'Thornswood Web' -Action `$a -Trigger @(`$boot, `$again) ``
    -Settings `$s -Principal `$who | Out-Null
  'scheduled task created'
} else {
  # -Trigger and -Settings as well as -Action. An existing task keeps whatever
  # it was first registered with, which is how this one kept three restarts and
  # a three day limit through every run of this script that was meant to change
  # them. Deploy-Docs.ps1 learned the same thing on its own task.
  Set-ScheduledTask -TaskName 'Thornswood Web' -Action `$a -Trigger @(`$boot, `$again) ``
    -Settings `$s -Principal `$who | Out-Null
  'scheduled task updated'
}
# Read and run in the Caddy folder, change only data (ServiceAccount.ps1).
# Back on SYSTEM when the SID cannot be looked up or the grants cannot be
# written, rather than a Caddy that cannot keep its certificates.
if (-not `$asSystem) {
  `$why = ''
  `$sid = Get-ThornswoodTaskSid 'Thornswood Web'
  if (-not `$sid) { `$why = 'the task SID NT TASK\Thornswood Web could not be looked up' }
  else {
    try {
      Grant-ThornswoodServiceFolder -Root `$dir -Sid `$sid -Writable 'data'
      # What it makes is its own, not every service's (#4077).
      Set-ThornswoodTaskOwner -TaskName 'Thornswood Web' -Sid `$sid -Action `$a -Roots `$dir
    } catch { `$why = 'its folder could not be granted to it: ' + `$_.Exception.Message }
  }
  if (`$why) {
    `$why + ', so the task goes back on SYSTEM'
    Set-ScheduledTask -TaskName 'Thornswood Web' -Action `$a -Principal (New-ThornswoodServicePrincipal -AsSystem) | Out-Null
  } else { 'the task runs as LOCAL SERVICE, Limited, as NT TASK\Thornswood Web' }
}

# Read back rather than assumed. Set-ScheduledTask is quiet about settings it
# did not apply.
`$chk = (Get-ScheduledTask -TaskName 'Thornswood Web' -EA SilentlyContinue)
if (`$chk) {
  'task settings: restart count ' + `$chk.Settings.RestartCount +
  ', execution time limit ' + (`$(if (`$chk.Settings.ExecutionTimeLimit -eq 'PT0S') { 'none' } else { `$chk.Settings.ExecutionTimeLimit })) +
  ', multiple instances ' + `$chk.Settings.MultipleInstances +
  ', priority ' + `$chk.Settings.Priority
  # The startup trigger has no repetition, so its slot comes back empty and
  # joining the lot printed a leading space. Only the triggers that actually
  # repeat are worth naming here.
  `$rep = @(`$chk.Triggers.Repetition.Interval | Where-Object { `$_ })
  'triggers: ' + (`$chk.Triggers.Count) + ', repeating every ' +
    (`$(if (`$rep.Count) { `$rep -join ' ' } else { 'never' }))
}

Start-ScheduledTask -TaskName 'Thornswood Web'
# The first start asks Let's Encrypt for a certificate, which takes a moment.
Start-Sleep -Seconds 12
Clear-ThornswoodHold -Target 'Thornswood Web'
`$p = Get-Process caddy -EA SilentlyContinue
if (`$p) { 'caddy up, pid ' + `$p.Id } else { 'CADDY DID NOT START'; exit 1 }
"@

# Get-ThornswoodDetachedRun (Send-Script.ps1) writes it on the box and
# starts it there through WMI. The start says STARTED, and nothing has been
# stopped by then.
$run = Get-ThornswoodDetachedRun -Script $restart
$started = @(Remote $run.Start)
$startedRc = $LASTEXITCODE
$started | Where-Object { $_ -is [string] -and $_ -notmatch '^STARTED \d+$' } | ForEach-Object { "  $_" }
if ($startedRc -ne 0 -or -not @($started | Where-Object { $_ -is [string] -and $_ -match '^STARTED \d+$' }).Count) {
  $started | Where-Object { $_ -isnot [string] } | ForEach-Object { "  $_" }
  throw "The box did not start the Caddy run (exit $startedRc). The lines above say why; nothing on the box was stopped."
}

# The report, read until it ends. While Caddy is down a session from One
# cannot connect at all, which is waited out the same as a report not yet
# finished. Each line is shown once, as it arrives.
$shown = 0
$endRc = $null
$until = (Get-Date).AddMinutes(4)
while ($null -eq $endRc -and (Get-Date) -lt $until) {
  Start-Sleep -Seconds 5
  $was = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $read = @(Remote $run.Read | Where-Object { $_ -is [string] })
  $readRc = $LASTEXITCODE
  $ErrorActionPreference = $was
  if ($readRc -ne 0 -or -not $read.Count -or $read[0] -notmatch '^REPORT \d+$') { continue }
  $lines = @($read | Select-Object -Skip 1)
  for ($i = $shown; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^END (-?\d+)$') { $endRc = [int]$Matches[1] } else { "  " + $lines[$i] }
  }
  $shown = $lines.Count
}
if ($null -eq $endRc) {
  throw ("The Caddy run on the box has not finished after four minutes, or the box cannot be reached since it stopped Caddy. From One the way in is the bridge, which needs Caddy up; the task starts it again within five minutes. Run this again with -TaskOnly once the box answers, or read " + $run.Log + " on the box (BisectHosting's console when nothing else answers).")
}
if ($endRc -ne 0) { throw "The Caddy run on the box ended with exit $endRc. The lines above say why." }

Write-Host ''
Write-Host "  https://$Domain" -ForegroundColor Green
Write-Host ''
Write-Host '  The first load can take a few seconds while the certificate is issued.'
Write-Host '  If it does not come up, the log is on the VPS:'
Write-Host "    Get-ScheduledTask 'Thornswood Web' | Get-ScheduledTaskInfo"
