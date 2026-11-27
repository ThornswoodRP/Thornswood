<#
  Get-Logs.ps1

  Brings the server's own logs down to this machine so they can be read whole.

  Chargen-Log.ps1 already asks the VPS a set of questions and prints the
  answers. That is the right shape when you know what you are looking for. It
  is the wrong shape when you do not: a filter can only ever return the lines
  somebody already thought to search for, and the line that explains a problem
  is almost never one of them. The second and third time a bug has been chased
  here it was a line nobody would have grepped for, sitting next to one that
  was.

  So this one filters nothing unless asked to. It copies the tail of each
  log into Thornswood-Repo\logs and tells you where it put them.

      .\Get-Logs.ps1                pull the last 4000 lines of each, from the last 2 days
      .\Get-Logs.ps1 -Lines 40000   pull a lot more
      .\Get-Logs.ps1 -Days 5        the rolled generations written in the last 5 days
      .\Get-Logs.ps1 -Days 0        every rolled generation the box keeps
      .\Get-Logs.ps1 -Match "Loading character,chargen"
                                    only the lines holding any of those words, the last -Lines of them
      .\Get-Logs.ps1 -All           pull the whole thing, however big it is

  What comes back:

      site.log      the website, the Discord door and the launcher check in
      bot.log       the Discord bot, the panel and the site watcher
      server.log    the game server, which is where character creation,
                    connections, item handouts and gamemode errors are
      thornswood.log the gamemode lines without the engine noise
      door.log      the door: who it let in and what the site said
      voice.log     the voice and register service
      health.json   what the voice service says about itself right now
      deploy-<id>.log  the box deploy agent's log of each of the last ten
                    Deployments to this server (#6149)

  For every log that rolls (server, thornswood, voice, site, bot), its
  rolled generations come down too, under the same names: the box is asked
  once which of them it has, and exactly those are read, so a pull never
  asks for a file that is not there. Only the ones written in the last
  -Days days come down (2 unless said; 0 is all of them): see the note on
  -Days below for why. The rollers keep five, so that is .1
  through .5 at most, except server.log, which server-log.js rolls by its
  time since #2349 (server.log.<when>, up to 30 days of them, newest first),
  and voice.log and thornswood.log, which it rolls the same way since #2166
  (up to 90 days of them).
  door.log does not roll, so only the current file is fetched.

  Nothing on the VPS is changed. Everything here is a read.
#>
[CmdletBinding()]
param(
    [string]$Vps   = '',
    [string]$User  = '',
    [int]$Lines    = 4000,
    [switch]$All,
    [int]$Port     = 0,
    [string]$Out   = '',
    <#
      Which server's logs. Every path in here was the live one, written when
      there was only one server, so the dev server's logs could not be fetched
      at all and the voice health check asked the live service whichever you
      meant. That is the third copy of the same shape in one evening, after
      Publish-Server's verify block and the installer's own answer check.

      -Dev takes the dev roots and the dev voice port. The files land in
      logs\dev\ so a dev pull cannot overwrite a live one, which matters
      because the interesting thing is usually the difference.
    #>
    [switch]$Dev,
    <#
      THE WINDOW, IN DAYS (#7060). A rolled generation comes down only when
      the box last wrote it inside the last -Days days, so it holds lines
      from that window; the current file always comes. 0 brings every one.

      Since server.log rolls by its time (#2349, up to 30 days kept) and
      thornswood.log the same way (#2166, up to 90), a pull brought every
      generation, each with its own -Lines tail: about 77 MB on 27 Nov 2026,
      for -Lines 4000 and for -Lines 150000 alike, because each day's file
      is shorter than either. The gate sends back at most 64 MB (Gate.ps1),
      so from a cloud thread Get-Logs never came back at all, and the logs
      of a playtest three days before (#6724) could not be read. A window
      that is said is what makes a pull fit, and a day nobody asked about
      does not come down.
    #>
    [int]$Days     = 2,
    <#
      ONLY THE LINES THAT HOLD ONE OF THESE (#7060). Words split on commas,
      each matched as plain text, case aside, never as a pattern: the gate
      takes no pipe or backslash in a line, so a pattern could not be said
      through it anyway. The box keeps the matching lines of each file, the
      last -Lines of them, and only those come down. Empty is every line.
    #>
    [string]$Match = '',
    [switch]$NoPause
)

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
$ProgressPreference    = 'SilentlyContinue'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Vps.ps1')
$ErrorActionPreference = 'Continue'
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
if (-not $Out) {
    $Out = Join-Path (Split-Path -Parent (Split-Path -Parent $Here)) 'logs'
    if ($Dev) { $Out = Join-Path $Out 'dev' }
}
# The dev voice service is its own process on its own port. See -Dev.
if (-not $Port) { $Port = if ($Dev) { 7789 } else { 7778 } }
if (-not (Test-Path -LiteralPath $Out)) { New-Item -ItemType Directory -Path $Out -Force | Out-Null }

$target = "$User@$Vps"

# Every log the server side writes, and what it is for. Adding one here is the
# only change needed to have it come down with the rest.
$srvRoot   = if ($Dev) { 'C:\Thornswood-Server-Dev' } else { 'C:\Thornswood-Server' }
$voiceRoot = if ($Dev) { 'C:\Thornswood-Voice-Dev' }  else { 'C:\Thornswood-Voice' }
# There is one site and one bot, live or dev: the dev launcher and the dev
# server both talk to the same site, so these two do not move with -Dev.
$docsRoot  = 'C:\Thornswood-Docs'
$botRoot   = 'C:\Thornswood-Bot'
Say ("  reading the {0} server at {1}" -f $(if ($Dev) { 'DEV' } else { 'live' }), $srvRoot) 'DarkGray'

$logs = @(
    # Rolls: the box keeps older copies beside it as Name.1, Name.2 and on
    # (Roll-Log, the site's in-process roll), or for server.log as
    # server.log.<when> (server-log.js, #2349), and they come down too.
    # door.log has no Rolls: it does not roll.
    @{ Name = 'server.log'; Path = "$srvRoot\server.log"; What = 'the game server'; Rolls = $true }
    # Thornswood's own lines and nothing else. server.log is about four fifths
    # engine noise on a normal day, so this is the one to read first and
    # server.log is where you go when the answer is not in it.
    @{ Name = 'thornswood.log'; Path = "$srvRoot\thornswood.log"; What = 'the gamemode, without the engine noise'; Rolls = $true }
    <#
      THE DOOR'S OWN LOG, WHICH HAS NEVER COME DOWN WITH THE REST.

      note() in the door block writes every line twice: once through
      console.log, which lands in server.log among four fifths engine noise,
      and once appended to private\door.log, which is the door's own story in
      order with nothing else in it. That second file is the one to read when
      the question is why nobody can get in, and until now there was no way to
      look at it short of an ssh somebody typed by hand.

      21 September: "still can't tp says no list". The answer to that was in
      private, and nothing fetched private.
    #>
    @{ Name = 'door.log'; Path = "$srvRoot\private\door.log"; What = 'the door: who it let in and what the site said' }
    @{ Name = 'voice.log';  Path = "$voiceRoot\voice.log";   What = 'voice and the character register'; Rolls = $true }
    <#
      The site, added 23 September. It printed everything it worked out into
      a handle nobody held: no redirect on the task and no file anywhere on
      the box. The sentences discordGet works out for every kind of refusal,
      which exist because a dead token, a rate limit and somebody genuinely
      not in the Discord used to look identical, had never once been
      readable. server.js writes them here now and rolls the file at 4 MB,
      keeping five, so site.log.1 to .5 are the older ones if the answer is
      not in the current one.
    #>
    @{ Name = 'site.log';   Path = "$docsRoot\site.log";     What = 'the website and the Discord door'; Rolls = $true }
    # The bot has written this all along and nothing ever fetched it, which
    # is why the site watcher's startup line had to be read over ssh by hand.
    # In the bot's data folder since #1104, the one folder its account writes.
    @{ Name = 'bot.log';    Path = "$botRoot\data\bot.log";  What = 'the Discord bot, the panel and the site watcher'; Rolls = $true }
)

<#
  THE DEPLOY AGENT'S LOGS (#6149).

  The box deploy agent leaves the log of each Deployment it applies to this
  server in the server's data folder as deploy-<Deployment id>.log, the
  newest ten kept (tools/DeployAgent/Record.cs, PublishLog), and names it
  as the Deployment's log_url on the resources port. That port is shut to a
  cloud thread, and a Deployment's description stops at 140 characters, so
  on 15 Nov 2026 the reason dev's build-1.3.68 failed was on the box and
  nowhere a cloud thread could read it. They come down here under their
  own names, the tail asked for as with every log; each is one
  Deployment's, a few hundred lines at most.
#>
$deployDir = "$srvRoot\data"
$deployLeaf = '^deploy-[A-Za-z0-9._-]+\.log$'

<#
  WHAT THE BOX HAS, asked once (#1605).

  This used to make up the names: every log that rolls got .1 through .5
  added to the list, and each one was asked for by name whether the box had
  it or not, with a MISSING answer for the ones it did not. On 4 October that
  was 15 of the 31 asks on a dev pull (thornswood, site and bot had no
  rolled copies there), and the MISSING answer is what the case bug below
  wrote down as a log. So the box is asked one question first, which of
  these files it has, and the pull reads exactly those and nothing else.

  The answer is full paths, one to a line: the current file when it is
  there, and Name.<number> beside it for a log that rolls.
#>
$wanted = foreach ($base in $logs) {
    "@{{ Dir = '{0}'; Leaf = '{1}'; Rolls = {2} }}" -f `
        (Split-Path -Parent $base.Path).Replace("'", "''"),
        (Split-Path -Leaf $base.Path).Replace("'", "''"),
        $(if ($base.ContainsKey('Rolls') -and $base.Rolls) { '$true' } else { '$false' })
}
# A generation the box last wrote before this is older than the window (-Days).
$listing = @'
$since = if (DAYS -gt 0) { (Get-Date).ToUniversalTime().AddDays(-DAYS) } else { [datetime]::MinValue }
foreach ($w in @(WANTED)) {
    if (-not (Test-Path -LiteralPath $w.Dir -PathType Container)) { continue }
    $rx = '^' + [regex]::Escape($w.Leaf) + $(if ($w.Rolls) { '(\.\d+)?$' } else { '$' })
    Get-ChildItem -LiteralPath $w.Dir -File |
        Where-Object { $_.Name -match $rx -and ($_.Name -ieq $w.Leaf -or $_.LastWriteTimeUtc -ge $since) } |
        ForEach-Object { $_.FullName }
}
'@
$window = [Math]::Max(0, $Days)
$listing = $listing.Replace('WANTED', ($wanted -join ', ')).Replace('DAYS', [string]$window)
$listing += "`n" + @'
if (Test-Path -LiteralPath 'DEPLOYDIR' -PathType Container) {
    Get-ChildItem -LiteralPath 'DEPLOYDIR' -File | Where-Object { $_.Name -match 'DEPLOYLEAF' } | ForEach-Object { $_.FullName }
}
'@.Replace('DEPLOYDIR', $deployDir.Replace("'", "''")).Replace('DEPLOYLEAF', $deployLeaf)

<#
  One question to the box. Any failure there stops that question with exit 1
  and one line on stderr saying why, so whether it worked is the exit code
  and the reason is readable, and nothing it says on stderr is taken for an
  answer.
#>
function Read-Box([string]$Remote) {
    $wrapped = "`$ErrorActionPreference = 'Stop'; `$ProgressPreference = 'SilentlyContinue'`ntry {`n$Remote`n} catch { [Console]::Error.WriteLine(`$_.Exception.Message); exit 1 }"
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($wrapped))
    $said = @(Invoke-ThornswoodNative { & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes $target "pwsh -NoProfile -EncodedCommand $enc" } 2>&1)
    # What the box printed is the answer. What ssh or powershell wrote on
    # stderr is about the connection or the failure, never part of a log.
    [pscustomobject]@{
        Code   = $LASTEXITCODE
        Answer = @($said | Where-Object { $_ -is [string] })
        Stderr = @($said | Where-Object { $_ -isnot [string] } | ForEach-Object { [string]$_ } | Where-Object { $_.Trim() })
    }
}

# The words for -Match, each one plain text in single quotes on the box.
$words = @(([string]$Match).Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$matching = if ($words.Count) { "@(" + (($words | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', ') + ")" } else { '' }

Head 'Pulling'
Say ("  {0}{1}" -f $(if ($window) { "the rolled generations written in the last $window day(s)" } else { 'every rolled generation the box keeps' }),
     $(if ($words.Count) { ', only the lines holding ' + ($words -join ' or ') } else { '' })) 'DarkGray'

$box = Read-Box $listing
if ($box.Code -ne 0) {
    $why = if ($box.Stderr.Count) { $box.Stderr -join ' | ' } else { 'nothing on stderr' }
    Say ("  could not ask the VPS which logs it has. ssh exit {0}: {1}" -f $box.Code, $why) 'Red'
} else {
    $onBox = @($box.Answer | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    # The deploy agent's logs ride the same loop as one more "log" whose
    # files are exactly the ones the box named, newest first.
    $deployLogs = @($onBox | Where-Object {
        (Split-Path -Parent $_) -ieq $deployDir -and (Split-Path -Leaf $_) -match $deployLeaf
    } | Sort-Object -Descending)
    $sets = @($logs) + @(@{ Deploy = $deployLogs })
    foreach ($base in $sets) {
        $files = New-Object System.Collections.Generic.List[object]
        if ($base.ContainsKey('Deploy')) {
            foreach ($p in $base.Deploy) { [void]$files.Add(@{ Name = (Split-Path -Leaf $p); Path = $p; What = 'the deploy agent, one Deployment' }) }
        } else {
            # The current file, then its rolled generations oldest last, the way
            # they sit on the box.
            if ($onBox | Where-Object { $_ -ieq $base.Path }) {
                [void]$files.Add(@{ Name = $base.Name; Path = $base.Path; What = $base.What })
            } else {
                Say ("  {0,-14} not on the VPS at {1}" -f $base.Name, $base.Path) 'Red'
            }
            if ($base.ContainsKey('Rolls') -and $base.Rolls) {
                $rolled = @(foreach ($p in $onBox) {
                    if ($p.StartsWith($base.Path + '.', [StringComparison]::OrdinalIgnoreCase)) {
                        $n = $p.Substring($base.Path.Length + 1)
                        if ($n -match '^\d{1,18}$') { [pscustomobject]@{ N = [long]$n; Path = $p } }
                    }
                })
                # server.log rolls by its time since #2349, server.log.<when>,
                # newest the biggest; the numbered ones the rollers keep, .1 the
                # newest, sort after them.
                $dated = { $_.N -ge 1000000000000 }
                foreach ($g in ($rolled | Sort-Object @{ Expression = { if (& $dated) { 0 } else { 1 } } },
                                                       @{ Expression = { if (& $dated) { -$_.N } else { $_.N } } })) {
                    [void]$files.Add(@{ Name = ($base.Name + '.' + $g.N); Path = $g.Path; What = ('older ' + $base.Name) })
                }
            }
        }

        foreach ($f in $files) {
            $dest = Join-Path $Out $f.Name

            <#
              Read on the far side, not here.

              scp would copy the file, which is the obvious thing and the wrong one:
              server.log grows without bound and there is no reason to move eighty
              megabytes across the internet to read the end of it. Get-Content -Tail
              reads backwards from the end on the machine that already has the file.

              -Raw is deliberately not used. The point is a line count, and -Raw would
              hand back one enormous string with the tail applied to nothing.
            #>
            $tail = if ($All) { '' } else { " -Tail $Lines" }
            $at = $f.Path.Replace("'", "''")
            <#
              With -Match the box picks the lines (Select-String reads the file
              where it is) and keeps the last -Lines of them, so only those
              cross; a file with none comes down empty.
            #>
            $ask = if ($matching) {
                $last = if ($All) { '' } else { " | Select-Object -Last $Lines" }
                "@(Select-String -LiteralPath '{0}' -SimpleMatch -Pattern {1} | ForEach-Object {{ `$_.Line }}){2}" -f $at, $matching, $last
            } else {
                "Get-Content -LiteralPath '{0}'{1}" -f $at, $tail
            }
            $read = Read-Box $ask

            # A read that failed is said, and nothing is written for it. A roll
            # between the question and the read is the one ordinary way to get
            # here, and the next pull reads the file under its new name.
            if ($read.Code -ne 0) {
                $why = if ($read.Stderr.Count) { $read.Stderr -join ' | ' } else { 'nothing on stderr' }
                Say ("  {0,-14} could not be read. ssh exit {1}: {2}" -f $f.Name, $read.Code, $why) 'Red'
                continue
            }

            <#
              WHAT CAME BACK, under a name of its own (#1605).

              PowerShell variable names ignore case, so this used to be kept in
              $lines, which is the [int]$Lines parameter under another spelling.
              Every pull tried to put the answer into an int, printed a
              MetadataError for every log, left the number 4000 in place and
              counted it as 1 line. Seen under PowerShell 7.6.6, 4 Oct.
              tests\test-get-logs.ps1 fails on any parameter given a new value
              after the defaults are filled in.
            #>
            $got = $read.Answer
            Set-Content -LiteralPath $dest -Value $got -Encoding UTF8
            $size = (Get-Item -LiteralPath $dest).Length
            Say ("  {0,-14} {1,7:n0} lines  {2,9:n0} bytes   {3}" -f $f.Name, $got.Count, $size, $f.What) 'Gray'
        }
    }
}

<#
  What the service says about itself. Small, and it is the fastest way to tell
  a stale process from a fresh one, which has cost days here before.

  ASKED ON THE BOX, BECAUSE ONLY THE BOX IS TOLD (#3806).

  This asked https://thornswood.net/voice/health first, and the raw port as a
  fallback, because the service is on loopback with Caddy carrying /voice/
  and the raw port is shut from outside on purpose (on 21 and 22 September
  asking only the raw port printed "no answer" while both services were
  fine). Since #3806 the site's answer is only {"ok":true}: the build, the
  deploy record and the counts go only to a caller on the box itself, not
  to anything Caddy forwards. So the detail is read over the same ssh as the
  logs, from 127.0.0.1 on the box, and the site is asked separately whether
  it carries voice at all, which is the other half of what used to be one
  answer. A check that cries wolf is worse than no check, so each half says
  which one failed.
#>
$dest = Join-Path $Out 'health.json'
$voicePath = if ($Dev) { 'voice-dev' } else { 'voice' }
$read = Read-Box ("(Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:{0}/health' -TimeoutSec 8).Content" -f $Port)
$h = $null; $why = ''
if ($read.Code -ne 0) {
    $why = if ($read.Stderr.Count) { $read.Stderr -join ' | ' } else { 'nothing on stderr' }
    $why = "ssh exit $($read.Code): $why"
} else {
    try { $h = ($read.Answer -join "`n") | ConvertFrom-Json } catch { $why = 'its answer was not JSON: ' + $_.Exception.Message }
}

if ($h) {
    ($h | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $dest -Encoding UTF8
    $build = if ($h.PSObject.Properties['build']) { $h.build } else { '(no build in the answer)' }
    $bind  = if ($h.PSObject.Properties['bind'])  { $h.bind }  else { '?' }
    $auth  = if ($h.PSObject.Properties['auth'])  { $h.auth }  else { '?' }
    Say ("  {0,-12} build {1}, asked on the box at 127.0.0.1:{2}, bound to {3}, auth {4}" -f 'health.json', $build, $Port, $bind, $auth) 'Gray'
} else {
    ("the voice service did not answer on the box at 127.0.0.1:{0}: {1}" -f $Port, $why) | Set-Content -LiteralPath $dest -Encoding UTF8
    Say ("  {0,-12} NO ANSWER on the box at 127.0.0.1:{1}: {2}" -f 'health.json', $Port, $why) 'Red'
}

$siteUrl = "https://thornswood.net/$voicePath/health"
try {
    $s = Invoke-RestMethod -Uri $siteUrl -TimeoutSec 8
    if ($s -and $s.PSObject.Properties['ok'] -and $s.ok -eq $true) {
        Say ("  {0,-12} the site carries it: {1} says ok" -f '', $siteUrl) 'Gray'
    } else {
        Say ("  {0,-12} {1} answered, but not with voice's ok. Is the Caddyfile's /{2}/ block there?" -f '', $siteUrl, $voicePath) 'Red'
    }
} catch {
    Say ("  {0,-12} {1} did not answer ({2}), so nothing outside reaches voice" -f '', $siteUrl, $_.Exception.Message) 'Red'
}

Head 'Where they are'
Say "  $Out" 'White'
Write-Host ''
Say 'Nothing on the server was changed. These are copies.' 'DarkGray'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
