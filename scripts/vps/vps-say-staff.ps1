<#
  vps-say-staff.ps1

  Puts one staff notice from an agent into the watchdog's outbox,
  alerts.jsonl, which the bot says in #staff-updates within a minute, or the
  watchdog through its #staff-updates webhook when the bot is down (#447).
  It is the box's half of scripts\ops\Say-Staff.ps1 and runs ON the box, as
  C:\Thornswood-Watch\say-staff.ps1 beside the watchdog (Watch-Services.ps1
  -Install puts it there).
  So an agent posts a notice itself, through the bot, and no Discord token
  or webhook ever leaves the box (#2934).

      ... | powershell -File C:\Thornswood-Watch\say-staff.ps1 -From cloud

  WHAT IT READS, on standard input, one line:
      say <the notice, UTF-8, base64>    queue it
      check <id>                         whether it has been said yet
      unsay <id>                         take it back (#3328): only the
                                         sender's own, by -From
      (nothing)                          prints READY and changes nothing,
                                         which is how a new key is proved
  The notice is never on a command line: sshd hands that to cmd.exe, and
  quotes and length go wrong there (Watch-Outside.ps1 says the same).

  WHAT IT ANSWERS, one line:
      QUEUED <id>        written to the outbox
      POSTED bot         the bot said it (its id is in alerts-sent-bot.txt)
      POSTED webhook     the watchdog's webhook said it
      WAITING            in the outbox, not said yet
      EXPIRED            in the outbox and over a day old, so never said
      NOT FOUND          no notice with that id
      UNSAY QUEUED <id>  the bot takes it back within a minute
      UNSAY WAITING      (check) asked to be taken back, not done yet
      UNSAID <what>      (check) taken back: deleted, gone (it was not
                         there any more), withheld (never said), webhook
                         (the watchdog's webhook said it; a person with
                         Manage Messages deletes it), unknown, or failed
                         and why, from the bot's data\staff-unsaid.txt
      NOWATCHER          the watchdog is not installed here, so nothing would
                         ever say it; nothing was written
      REFUSED <why>      nothing was written

  WHAT IT WRITES is one line of the outbox's own shape (id, at, service,
  kind, text), the shape Watch-Outside.ps1 and the watchdog write:
      id       agent-<from>-<yyyyMMddHHmmss UTC>-<6 hex>
      service  agent <from>
      kind     notice
      text     [<from>] <the notice>
  and nothing else, anywhere. <from> is one lower case word. On a key that
  Grant-BoxAccess.ps1 -NoticesOnly made, sshd runs this as the key's forced
  command with -From set to the key's own name, whatever the client asked
  to run, so a notices key can do this and nothing more: no shell, no file
  copy, no forwarding, and it cannot say it is somebody else.

  LIMITS, so a key that can only post cannot drown the channel either:
  1800 characters a notice (the bot cuts at 1900; the [<from>] goes in
  front), and 30 an hour for each <from>. Mentions are off in both the bot
  and the webhook, so @everyone in a notice is text.

  PowerShell 7, which is what the box runs.
  tests\test-say-staff.ps1 runs this against a scratch folder.
#>
param(
    [string]$From = '',
    # The watchdog's folder. The installed copy sits in it, so it is this
    # file's own folder unless a harness says otherwise.
    [string]$Root = '',
    # The bot's data folder, where it writes what it took back (bot.py,
    # STAFF_UNSAID). A harness gives its own.
    [string]$BotData = 'C:\Thornswood-Bot\data'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $Root) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$maxText = 1800
$perHour = 30
$maxAge = 24 * 3600
$alerts = Join-Path $Root 'alerts.jsonl'
$enc = New-Object Text.UTF8Encoding($false)

if ($From -cnotmatch '^[a-z0-9][a-z0-9-]{0,31}$') { 'REFUSED -From is one lower case word, letters, digits and hyphens.'; exit 1 }
# Without the watchdog nothing reads the outbox when the bot is down, and the
# bot's own reader is part of the same install.
if (-not (Test-Path -LiteralPath (Join-Path $Root 'watch.ps1'))) { 'NOWATCHER'; exit 1 }

$ask = ''
while ($null -ne ($l = [Console]::In.ReadLine())) {
    $l = $l.Trim()
    if ($l) { $ask = $l; break }
}
if (-not $ask) { 'READY'; exit 0 }

# Every outbox line that parses, as objects. A line that is not one is
# passed over, the way the bot and the watchdog pass it over.
function Read-Outbox {
    $rows = @()
    if (-not (Test-Path -LiteralPath $alerts)) { return $rows }
    foreach ($line in [IO.File]::ReadAllLines($alerts, $enc)) {
        if (-not $line.Trim()) { continue }
        try { $rows += @(ConvertFrom-Json $line) } catch { continue }
    }
    return $rows
}

function Read-Ids([string]$name) {
    $p = Join-Path $Root $name
    if (-not (Test-Path -LiteralPath $p)) { return @() }
    return @([IO.File]::ReadAllLines($p) | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

$nowUnix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$unsayFile = Join-Path $Root 'alerts-unsay.txt'

# What the bot did with an ask to take a notice back, the last line for the
# id winning; '' when it has not done it yet.
function Read-Unsaid([string]$id) {
    $p = Join-Path $BotData 'staff-unsaid.txt'
    if (-not (Test-Path -LiteralPath $p)) { return '' }
    $got = ''
    foreach ($line in [IO.File]::ReadAllLines($p, $enc)) {
        $f = $line.Split("`t")
        if ($f.Count -ge 2 -and $f[0] -eq $id) { $got = $f[1].Trim() }
    }
    return $got
}

if ($ask -match '^unsay (agent-[a-z0-9-]{1,80})$') {
    $id = $Matches[1]
    $row = @(Read-Outbox | Where-Object { [string]$_.id -eq $id }) | Select-Object -First 1
    if (-not $row) { 'NOT FOUND'; exit 1 }
    # A sender takes back its own notices and nothing else: not another
    # sender's, and not the watchdog's own outage messages.
    if ([string]$row.service -ne ('agent ' + $From)) { 'REFUSED ' + $id + ' is not a notice from ' + $From + ', so it cannot take it back.'; exit 1 }
    if (@(Read-Ids 'alerts-unsay.txt') -notcontains $id) { [IO.File]::AppendAllText($unsayFile, $id + "`r`n", $enc) }
    'UNSAY QUEUED ' + $id
    exit 0
}

if ($ask -match '^check (agent-[a-z0-9-]{1,80})$') {
    $id = $Matches[1]
    $unsaid = Read-Unsaid $id
    if ($unsaid) { 'UNSAID ' + $unsaid; exit 0 }
    if ((Read-Ids 'alerts-unsay.txt') -contains $id) { 'UNSAY WAITING'; exit 0 }
    if ((Read-Ids 'alerts-sent-bot.txt') -contains $id) { 'POSTED bot'; exit 0 }
    if ((Read-Ids 'alerts-sent-webhook.txt') -contains $id) { 'POSTED webhook'; exit 0 }
    $row = @(Read-Outbox | Where-Object { [string]$_.id -eq $id }) | Select-Object -First 1
    if (-not $row) { 'NOT FOUND'; exit 1 }
    if ($nowUnix - [int64]$row.at -gt $maxAge) { 'EXPIRED'; exit 1 }
    'WAITING'
    exit 0
}

if ($ask -notmatch '^say ([A-Za-z0-9+/=]+)$') { 'REFUSED the line was not "say <base64>", "check <id>" or "unsay <id>".'; exit 1 }
$text = ''
try { $text = $enc.GetString([Convert]::FromBase64String($Matches[1])) }
catch { 'REFUSED the notice was not base64.'; exit 1 }
$text = ($text -replace '\r\n?', "`n").Trim()
if (-not $text) { 'REFUSED the notice is empty.'; exit 1 }
if ($text.Length -gt $maxText) { 'REFUSED the notice is ' + $text.Length + ' characters and ' + $maxText + ' is the most. Nothing was cut.'; exit 1 }

$service = 'agent ' + $From
$recent = @(Read-Outbox | Where-Object { [string]$_.service -eq $service -and ($nowUnix - [int64]$_.at) -lt 3600 }).Count
if ($recent -ge $perHour) { 'REFUSED ' + $From + ' has queued ' + $recent + ' notices in the last hour, and ' + $perHour + ' is the most.'; exit 1 }

$bytes = New-Object byte[] 3
([Security.Cryptography.RandomNumberGenerator]::Create()).GetBytes($bytes)
$id = 'agent-' + $From + '-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + '-' + (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
$row = ConvertTo-Json @{ id = $id; at = $nowUnix; service = $service; kind = 'notice'; text = ('[' + $From + '] ' + $text) } -Compress
[IO.File]::AppendAllText($alerts, $row + "`r`n", $enc)
'QUEUED ' + $id
exit 0
