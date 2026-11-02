<#
  Say-Staff.ps1

  Posts one staff notice in #staff-updates through the bot, from One, a
  developer's PC or a cloud thread: only when staff must act: something staff
  must act on, a server restart or outage staff will see, or a change to how
  staff do their job. Never for releases, merges, progress, pull requests,
  issues, test tasks or routine deploys (Patrick, 22 Oct 2026, 8:51 AM).
  Agents post their own notices this way instead of asking a person to
  (Patrick, 20 Oct 2026, #2934).

      pwsh scripts/ops/Say-Staff.ps1 -From claude -Text "Restarting the dev server at 4:30 PM for about 5 minutes."
                       queue it; prints its id
      pwsh scripts/ops/Say-Staff.ps1 -Check agent-claude-20261020214500-1a2b3c
                       whether the bot has said it yet, or taken it back
      pwsh scripts/ops/Say-Staff.ps1 -Unsay agent-claude-20261020214500-1a2b3c
                       takes it back out of #staff-updates (#3328): the bot
                       deletes its post within a minute, or never says it if
                       it has not yet. Only the sender's own notices.

  HOW IT GETS THERE. The notice goes on ssh's standard input, base64, to
  C:\Thornswood-Watch\say-staff.ps1 on the box (scripts\vps\vps-say-staff.ps1,
  put there by Watch-Services.ps1 -Install), which appends one line to the
  watchdog's outbox, alerts.jsonl. The bot reads that every minute and says
  each new line in #staff-updates, by the id in bot\staff-channel.txt, and
  the watchdog says it through its own #staff-updates webhook when the bot is
  down (#447). No Discord token or webhook leaves the box, and nothing here
  knows one. The text is never on a command line.

  WHICH WAY, the first that fits:
    -OnTheBox (the staff-notice workflow, on a VPS runner; #3045): ssh to
        127.0.0.1, the box's own sshd, with the notices key in
        THORNSWOOD_NOTICE_KEY_B64. The box takes every agent key only from
        127.0.0.1, and a runner is on the box, so no bridge and no token: the
        key is no use anywhere else. The host key is checked against the
        three vps.json pins, and the key and known_hosts live in a folder of
        this run's own that goes when it ends.
    THORNSWOOD_NOTICE_KEY_B64 and THORNSWOOD_NOTICE_TOKEN set (an agent
        environment given a notices key by Grant-BoxAccess.ps1 -NoticesOnly
        -MakeKey): that key, through the bridge with that token. The box
        runs say-staff.ps1 for it whatever is asked, with -From set to the
        key's own name, so -From here is not needed and is not what shows.
    ssh here: ssh to the box the way every script here goes (One, a
        developer's PC set up by Setup-SshKey.ps1). -From is then who the
        notice is from: one lower case word, claude, codex, djinn.
    no ssh here, gh here (a cloud thread; #5187): it files the notice on
        the board, ThornswoodRP/Thornswood, as an issue titled "Staff notice
        from <-From>" (claude when not given) with the notice as its body and
        the label "notice: staff". The bot reads those every minute, says
        each in #staff-updates as [<-From>] <the notice>, comments "Said in
        #staff-updates." and closes the issue (bot\bot.py
        watch_staff_notices). The issue's number is the notice's id for
        -Check and -Unsay; -Unsay puts the label "notice: take back" on it.
        The board is public, so a notice filed this way is read by anybody:
        one that must stay with staff goes from a machine with ssh. Nothing
        secret is in the container or crosses it. The ops repository's
        staff-notice.yml still runs -OnTheBox when started by hand.

  WHAT IT SAYS AND EXITS.
    queued    0, with the id, after the box wrote it to the outbox
    posted    0 (-Check), by the bot or the webhook
    waiting   2 (-Check), in the outbox, not said yet; the bot reads every
              minute and the webhook takes over after two and a half
    filed     0, through GitHub, with the issue's number
    waiting   2 (-Check), through GitHub: the issue is open and the bot has
              not said it yet
    unsay     0, with the id, after the box wrote the ask down
    taken back 0 (-Check): deleted, already gone, or withheld (never said)
    waiting   2 (-Check), asked to be taken back, the bot not there yet
    refused, not found, expired, no watchdog, or the box not reached: 1,
              with why. Nothing was posted. A notice the watchdog's webhook
              said, or one the bot could not delete: 1, with why.
  In a GitHub Actions job it also writes the box's answer, or why it
  stopped, as an annotation titled Say-Staff, which the staff-notice run
  shows.

  The notice: 1800 characters at most, 30 an hour for each sender, no
  mentions (the bot and the webhook both send with mentions off).
  tests\test-say-staff.ps1 runs this against the box half in a scratch folder.
#>
[CmdletBinding(DefaultParameterSetName = 'Say')]
param(
    [Parameter(ParameterSetName = 'Say', Mandatory = $true)]
    [string]$Text,
    # Who the notice is from, or whose notice is taken back (-Unsay).
    [string]$From = '',
    [Parameter(ParameterSetName = 'Check', Mandatory = $true)]
    [string]$Check,
    # Takes a notice back (#3328).
    [Parameter(ParameterSetName = 'Unsay', Mandatory = $true)]
    [string]$Unsay,
    # The staff-notice workflow's half: this runs on the box itself.
    [switch]$OnTheBox,
    # Where a notice through GitHub is filed: the board the bot reads (#5187).
    [string]$NoticeRepo = 'ThornswoodRP/Thornswood',
    [string]$VpsHost = '',
    [string]$VpsUser = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$vpsDir = Join-Path (Split-Path -Parent $Here) 'vps'
. (Join-Path $vpsDir 'Vps.ps1')
if (-not $VpsUser) { $VpsUser = Get-ThornswoodVpsUser }
if (-not $VpsHost) { $VpsHost = Get-ThornswoodVpsAddress }
$far = 'C:\Thornswood-Watch\say-staff.ps1'
$maxText = 1800
# The labels the bot reads (bot\bot.py STAFF_NOTICE_LABEL, STAFF_TAKE_BACK_LABEL).
$noticeLabel = 'notice: staff'
$takeBackLabel = 'notice: take back'
$inActions = ($env:GITHUB_ACTIONS -eq 'true')

# An annotation on the job, which GitHub keeps on its check run, so the cloud
# half reads the answer without reading the log.
function Note([string]$level, [string]$m) {
    if ($inActions) { Write-Host ('::' + $level + ' title=Say-Staff::' + ($m -replace '%', '%25' -replace "`r", '%0D' -replace "`n", '%0A')) }
}
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Note 'error' $m; Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

$noticeKey = [string]$env:THORNSWOOD_NOTICE_KEY_B64
$noticeToken = [string]$env:THORNSWOOD_NOTICE_TOKEN
$withNoticeKey = [bool]($noticeKey -and $noticeToken)

# ------------------------------------------------------------- the way -----
$route = ''
if ($OnTheBox) {
    if (-not $noticeKey) { Die 'THORNSWOOD_NOTICE_KEY_B64 is not set, so there is no key to post with. In the ops repository''s staff-notice workflow it is the NOTICE_KEY_B64 secret of the "notices" environment, which .\scripts\vps\Grant-BoxAccess.ps1 -Name claude -MakeKey -NoticesOnly -ToEnvironment notices puts there from One. Nothing was posted.' }
    $route = 'box'
} elseif ($noticeKey -or $noticeToken) {
    if (-not $withNoticeKey) { Die 'only one of THORNSWOOD_NOTICE_KEY_B64 and THORNSWOOD_NOTICE_TOKEN is set; a notices key needs both. Grant-BoxAccess.ps1 -NoticesOnly -MakeKey on One makes the pair. Nothing was posted.' }
    $route = 'bridge'
} elseif (Get-Command ssh -ErrorAction SilentlyContinue) {
    $route = 'ssh'
} elseif (Get-Command gh -ErrorAction SilentlyContinue) {
    $route = 'github'
} else {
    Die 'there is no ssh here to reach the box and no gh to file the notice on the board with. Nothing was posted.'
}

# ----------------------------------------------------------- what to send --
# Through GitHub a notice's id is its issue's number; through the box, the id
# the box gave it.
$noticeNumber = 0
$asked = if ($PSCmdlet.ParameterSetName -eq 'Check') { $Check } elseif ($PSCmdlet.ParameterSetName -eq 'Unsay') { $Unsay } else { '' }
if ($asked -and $route -eq 'github') {
    if ($asked -notmatch '^#?([1-9][0-9]{0,8})$') { Die "$asked is not a notice's issue number; through GitHub Say-Staff.ps1 printed one like #5300." }
    $noticeNumber = [int]$Matches[1]
} elseif ($PSCmdlet.ParameterSetName -eq 'Check') {
    if ($Check -notmatch '^agent-[a-z0-9-]{1,80}$') { Die "$Check is not a notice id; Say-Staff.ps1 printed one like agent-claude-20261020214500-1a2b3c." }
    $line = 'check ' + $Check
} elseif ($PSCmdlet.ParameterSetName -eq 'Unsay') {
    if ($Unsay -notmatch '^agent-[a-z0-9-]{1,80}$') { Die "$Unsay is not a notice id; Say-Staff.ps1 printed one like agent-claude-20261020214500-1a2b3c." }
    $line = 'unsay ' + $Unsay
    if ($route -eq 'ssh' -and $From -cnotmatch '^[a-z0-9][a-z0-9-]{0,31}$') {
        Die '-From says whose notice it is: one lower case word (claude, codex, djinn). Only its own notices can be taken back. Nothing was changed.'
    }
} elseif ($PSCmdlet.ParameterSetName -eq 'Say') {
    $t = ($Text -replace '\r\n?', "`n").Trim()
    if (-not $t) { Die 'the notice is empty. Nothing was posted.' }
    if ($t.Length -gt $maxText) { Die ('the notice is ' + $t.Length + ' characters and ' + $maxText + ' is the most. Say it shorter; nothing was cut and nothing was posted.') }
    $line = 'say ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))
    # Through GitHub the issue's title names the sender, and a cloud thread
    # is a Claude's, so it is claude unless -From says otherwise.
    if ($route -eq 'github' -and -not $From) { $From = 'claude' }
    if (($route -eq 'ssh' -or $route -eq 'github') -and $From -cnotmatch '^[a-z][a-z0-9-]{0,30}$') {
        Die '-From says who the notice is from: one lower case word, letters, digits and hyphens (claude, codex, djinn). Nothing was posted.'
    }
}
if (-not $From) { $From = 'agent' }

# ------------------------------------------------- through an issue (#5187) --
# The notice is an issue on the board labelled $noticeLabel, its body the
# notice and its title the sender. The bot reads those every minute, says
# each in #staff-updates, comments "Said in #staff-updates." and closes it
# (bot\bot.py watch_staff_notices). The label $takeBackLabel on it takes it
# back. Its number is the notice's id here.

# One call to GitHub through gh, its answer as an object; a refusal stops the
# script with why. $Body goes on gh's standard input, never a command line.
function Invoke-GitHub([string]$method, [string]$path, $Body = $null) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    if ($null -ne $Body) {
        $o = @(($Body | ConvertTo-Json -Compress -Depth 5) | & gh api -X $method $path --input - 2>&1 | ForEach-Object { "$_" })
    } else {
        $o = @(& gh api -X $method $path 2>&1 | ForEach-Object { "$_" })
    }
    $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($c -ne 0) { Die ("GitHub answered $method $path with: " + (($o | Select-Object -Last 2) -join ' ')) }
    return (($o -join "`n") | ConvertFrom-Json)
}

if ($route -eq 'github') {
    if ($PSCmdlet.ParameterSetName -eq 'Say') {
        $made = Invoke-GitHub 'POST' "repos/$NoticeRepo/issues" @{ title = ('Staff notice from ' + $From); body = $t; labels = @($noticeLabel) }
        $n = [int]$made.number
        if (-not $n) { Die 'GitHub made no issue number, so nothing was filed.' }
        if (-not (@($made.labels | ForEach-Object { [string]$_.name }) -contains $noticeLabel)) {
            Die ("issue #$n was filed without the label $noticeLabel, so the bot will not say it: only somebody with triage on $NoticeRepo can label an issue. Close it: " + $made.html_url)
        }
        Say ("filed #$n. The bot says it in #staff-updates within a minute, then closes the issue.") 'Green'
        Say ("  to see it was said: pwsh scripts/ops/Say-Staff.ps1 -Check $n") 'DarkGray'
        exit 0
    }
    $n = $noticeNumber
    $issue = Invoke-GitHub 'GET' "repos/$NoticeRepo/issues/$n"
    $labels = @($issue.labels | ForEach-Object { [string]$_.name })
    if ($issue.pull_request -or -not ($labels -contains $noticeLabel)) { Die "#$n is not a staff notice: it has no $noticeLabel label." }
    if ($PSCmdlet.ParameterSetName -eq 'Unsay') {
        $null = Invoke-GitHub 'POST' "repos/$NoticeRepo/issues/$n/labels" @{ labels = @($takeBackLabel) }
        Say ("asked the bot to take #$n back. It deletes its post in #staff-updates within a minute, or never says it if it has not yet.") 'Green'
        Say ("  to see it was done: pwsh scripts/ops/Say-Staff.ps1 -Check $n") 'DarkGray'
        exit 0
    }
    # -Check: what the bot wrote on the issue says where it is. Its comments
    # are by its App, or by the user of the token it falls back to, so they
    # are known by their first words.
    $bodies = @(Invoke-GitHub 'GET' "repos/$NoticeRepo/issues/$n/comments?per_page=100" | ForEach-Object { [string]$_.body })
    $has = { param($start) @($bodies | Where-Object { $_.StartsWith($start) }) | Select-Object -Last 1 }
    if (& $has 'The notice is taken out') { Say 'taken back: the bot deleted its post in #staff-updates.' 'Green'; exit 0 }
    if (& $has 'The notice was already gone') { Say 'taken back: the post was not in #staff-updates any more, so there was nothing to delete.' 'Green'; exit 0 }
    if (& $has 'The notice was not said yet') { Say 'taken back before it was said: it was never posted.' 'Green'; exit 0 }
    if ($labels -contains $takeBackLabel) { Say 'asked to be taken back, and the bot has not done it yet. It reads every minute.' 'Yellow'; exit 2 }
    if (& $has 'Said in #staff-updates') { Say 'posted in #staff-updates, by the bot.' 'Green'; exit 0 }
    $no = & $has 'The bot did not say this notice'
    if ($no) { Die ('the bot refused it: ' + (($no -split "`n" | Where-Object { $_ -match '^- ' }) -join ' ')) }
    if ([string]$issue.state -eq 'open') { Say 'filed, not said yet. The bot reads the board every minute.' 'Yellow'; exit 2 }
    Die "#$n was closed without the bot saying it, so it never will be. File it again if it still matters."
} else {
    # What the box is asked to run. A notices key runs it anyway, with its own name.
    $target = "$VpsUser@$VpsHost"
    $remote = "pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $far -From $From"
    $sshArgs = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=20')
    $restore = $null
    # The key, when there is one, for this run only.
    $work = ''
    try {
        if ($route -eq 'box' -or $route -eq 'bridge') {
            $base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
            $work = Join-Path $base ('thornswood-notice-' + [Guid]::NewGuid().ToString('N'))
            # ssh reads a -o file option up to the first space as one file.
            if ($work -match '\s') { Die "the temp folder ($work) has a space in it, which ssh would read as two files. Nothing was posted." }
            New-Item -ItemType Directory -Path $work -Force | Out-Null
            $keyText = ''
            try { $keyText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($noticeKey -replace '\s', ''))) } catch { $keyText = '' }
            if (-not $keyText.Trim()) { Die 'THORNSWOOD_NOTICE_KEY_B64 is not a base64 key. Make it again with Grant-BoxAccess.ps1 -NoticesOnly -MakeKey on One. Nothing was posted.' }
            $keyFile = Join-Path $work 'notice_ed25519'
            Write-ThornswoodPrivateFile -Path $keyFile -Text ($keyText.Replace("`r`n", "`n").TrimEnd() + "`n")
            $keyText = $null
            $sshArgs = @('-F', 'none', '-i', $keyFile, '-o', 'IdentitiesOnly=yes') + $sshArgs
        }
        if ($route -eq 'box') {
            # The box's own sshd, its host key held to the pins in a
            # known_hosts of this run's own: nothing in the runner account's
            # .ssh is read or written. The pins and the user are the
            # checkout's vps.json alone, not a machine's own override file,
            # which an earlier job on the same runner account could leave.
            $pinned = Get-ThornswoodVpsCommitted
            $knownHosts = Join-Path $work 'known_hosts'
            try { $null = Add-ThornswoodKnownHost -Address '127.0.0.1' -KnownHosts $knownHosts -Pinned @($pinned.hostKeys) }
            catch { Die ('the box''s own sshd on 127.0.0.1: ' + $_.Exception.Message) }
            $sshArgs += @('-o', "UserKnownHostsFile=$knownHosts")
            $target = ([string]$pinned.user) + '@127.0.0.1'
        }
        if ($route -eq 'bridge') {
            $node = Get-Command node -ErrorAction SilentlyContinue
            if (-not $node) { Die 'node is not on PATH, and the bridge client is node. Nothing was posted.' }
            $client = Install-ThornswoodBridgeClient (Join-Path $vpsDir 'bridge')
            # connect.js and listen.js read the token from the environment, for
            # this process and what it starts, and from no command line.
            $restore = @{ Token = $env:THORNSWOOD_BOX_TOKEN }
            $env:THORNSWOOD_BOX_TOKEN = $noticeToken
            $null = Add-ThornswoodKnownHostThroughBridge -Address $VpsHost -Node $node.Source -Listen (Join-Path $client 'listen.js')
            $sshArgs += @('-o', ('ProxyCommand="' + $node.Source + '" "' + (Join-Path $client 'connect.js') + '"'))
        }

        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $out = @(Invoke-ThornswoodNative { @($line) | & ssh @sshArgs $target $remote } 2>&1 | ForEach-Object { "$_".Trim() } |
                 Where-Object { $_ })
        $code = $LASTEXITCODE
        $ErrorActionPreference = $old
    }
    finally {
        if ($null -ne $restore) {
            if ($null -ne $restore.Token) { $env:THORNSWOOD_BOX_TOKEN = $restore.Token } else { Remove-Item Env:THORNSWOOD_BOX_TOKEN -ErrorAction SilentlyContinue }
        }
        if ($work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

# ------------------------------------------------------------ the answer ---
$answer = @($out | Where-Object { $_ -match '^(QUEUED|POSTED|WAITING|EXPIRED|NOT FOUND|NOWATCHER|REFUSED|READY|UNSAY|UNSAID)\b' }) | Select-Object -Last 1
if ($answer -and $route -ne 'github') { Note 'notice' $answer }
switch -Regex ("$answer") {
    '^QUEUED (\S+)$' {
        Say ('queued ' + $Matches[1] + '. The bot says it in #staff-updates within a minute.') 'Green'
        Say ('  to see it was said: pwsh scripts/ops/Say-Staff.ps1 -Check ' + $Matches[1]) 'DarkGray'
        exit 0
    }
    '^UNSAY QUEUED (\S+)$' {
        Say ('asked the bot to take ' + $Matches[1] + ' back. It deletes its post in #staff-updates within a minute, or never says it if it has not yet.') 'Green'
        Say ('  to see it was done: pwsh scripts/ops/Say-Staff.ps1 -Check ' + $Matches[1]) 'DarkGray'
        exit 0
    }
    '^UNSAY WAITING$' { Say 'asked to be taken back, and the bot has not done it yet. It reads every minute.' 'Yellow'; exit 2 }
    '^UNSAID deleted$' { Say 'taken back: the bot deleted its post in #staff-updates.' 'Green'; exit 0 }
    '^UNSAID gone$' { Say 'taken back: the post was not in #staff-updates any more, so there was nothing to delete.' 'Green'; exit 0 }
    '^UNSAID withheld$' { Say 'taken back before it was said: it was never posted, and the watchdog''s webhook will not post it either.' 'Green'; exit 0 }
    '^UNSAID webhook$' { Die 'the watchdog''s webhook said it, and the bot can delete only its own posts. Somebody with Manage Messages in #staff-updates deletes it by hand.' }
    '^UNSAID unknown$' { Die 'the bot found no notice with that id in the outbox, so it took nothing back.' }
    '^UNSAID (.*)$' { Die ('the bot could not take it back: ' + $Matches[1] + '. bot.log on the box says why.') }
    '^POSTED (bot|webhook)$' { Say ('posted in #staff-updates, by the ' + $Matches[1] + '.') 'Green'; exit 0 }
    '^WAITING$' { Say 'in the outbox, not said yet. The bot reads it every minute; the watchdog''s webhook takes over after two and a half.' 'Yellow'; exit 2 }
    '^EXPIRED$' { Die 'it was never said, and it is over a day old now, so it never will be. Post it again if it still matters.' }
    '^NOT FOUND$' { Die 'the box holds no notice with that id.' }
    '^NOWATCHER$' { Die 'the watchdog is not installed on the box, so nothing there would say it. Nothing was posted. It goes on with .\scripts\vps\Watch-Services.ps1 -Install, run from One (a Releases job).' }
    '^REFUSED (.*)$' { Die ('the box refused it: ' + $Matches[1]) }
}
$out | Select-Object -Last 5 | ForEach-Object { Say "  $_" 'DarkGray' }
# What pwsh says when the file it is given to run is not there (measured
# with pwsh 7.6, exit 64).
if (($out -join ' ') -match 'is not recognized as the name of a script file') {
    Die "the box has no $far yet, so nothing was posted. It goes on with .\scripts\vps\Watch-Services.ps1 -Install, run from One (a Releases job)."
}
Die ('the box did not answer (ssh exit ' + $code + '), so nothing was posted. The lines above say why: a "box bridge:" line is the bridge or the token, "Permission denied" is the key.')
