<#
  test-bot-service.ps1

      pwsh -NoProfile -File .\tests\test-bot-service.ps1

  The bot runs as the Windows service ThornswoodBot under its own account,
  NT SERVICE\ThornswoodBot, is stopped and started by that name, and its log
  rolls by size while it runs (issue #465).

  WHY THIS EXISTS. The bot ran as SYSTEM under run.ps1, a loop in a scheduled
  task, and nothing could stop it by name: every script that restarted it
  killed python by its command line, the watchdog could not restart a hung
  bot at all, and bot.log only rolled between runs. Now:

    scripts\vps\BotService.cs     the program the service runs
    scripts\vps\Bot-Service.ps1   builds it on the box, installs the service
                                  in place of the old loop, grants its
                                  account what the bot touches, restarts it
    Install-Bot.ps1               sends both and calls them
    Watch-Services.ps1            restarts the bot by the service's name,
                                  hung or gone (test-bot-heartbeat.ps1 and
                                  test-watch-alerts.ps1 run that)

  WHAT IT CHECKS.
    the program   built with the .NET Framework's csc through the same
                  function the box uses, then run for real in console mode
                  against a stand-in bot.py in scratch folders: the settings
                  in bot.env.json reach python, the bytes python writes reach
                  bot.log unchanged, a stop ends python and the process
                  python started, three quick exits stop it with run.ps1's
                  own line and a pause that grows, a run that lasted starts
                  the count again, bot.log rolls by size while the bot runs
                  and keeps three here, a reader holding the file puts the
                  roll off rather than losing anything, and a missing token,
                  an unreadable bot.env.json and a missing python each stop
                  it with a line that says so
    the install   Install-ThornswoodBotService against stand-ins for the
                  service manager, the task scheduler and the process list,
                  with the real compiler and real files: nothing stops before
                  python checks out and the program builds, the old task and
                  run.ps1 go, a copy started by hand is stopped and nothing
                  else is, the service is made once as NT SERVICE\ThornswoodBot
                  with one privilege and no password, it is started by name
                  last
    the grants    Grant-ThornswoodBotAccess on scratch folders with the real
                  Get-Acl and Set-Acl, read back: Modify on the bot's folder,
                  read only on the program's, read on bot.env.json, read on
                  the files of the watchdog's and the site's data folders and
                  nothing below them, Modify on the one watchdog file the bot
                  writes, nothing on a protected file, nothing doubled
    the scripts   Install-Bot.ps1, Write-BotToken.ps1, Restart-Server.ps1 and
                  the watcher name the same service, and none of them stops
                  the bot by a command line or registers a task for it any
                  more; the scripts Install-Bot sends expand only what they
                  should and parse
    the account   the SID worked out for NT SERVICE\ThornswoodBot is the one
                  sc.exe showsid gives, when sc.exe is there

  Never touches a real service, task or account. Writes only under its own
  scratch folder, which is the system temp folder unless -Scratch says, and
  three stand-in pythons in a folder of its own under ProgramData when that
  scratch folder is in a profile (removed at the end).
  The program part needs a python; with none it is skipped, and says so.
#>
[CmdletBinding()]
param([string]$Scratch = '')

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path
. (Join-Path $PSScriptRoot 'Windows.ps1')
$svcLib = Join-Path $repo 'scripts\vps\Bot-Service.ps1'
$svcSrc = Join-Path $repo 'scripts\vps\BotService.cs'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }
$tmp = Join-Path $Scratch ('ts-bot-service-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $tmp
$script:hosts = @()

. $svcLib
# The hold each stop writes (#5155), which Install-Bot sends in front of
# Bot-Service.ps1. Pointed at no folder here, so nothing on the machine that
# runs this is held.
. (Join-Path $repo 'scripts\vps\ServerHold.ps1')
$ThornswoodHoldRoot = ''
$sid = Get-ThornswoodServiceSid 'ThornswoodBot'

try {
# ============================================================ the account ===
Yes 'the service''s SID is S-1-5-80 and five numbers' ($sid -match '^S-1-5-80(-\d+){5}$')
$sc = Get-Command sc.exe -CommandType Application -EA SilentlyContinue
if ($sc) {
    $shown = (& $sc.Source showsid ThornswoodBot 2>&1 | Out-String)
    Yes 'and it is the one sc.exe showsid gives for ThornswoodBot' ($shown -match [regex]::Escape($sid))
} else { Write-Host 'SKIP  sc.exe showsid: no sc.exe here' }

# ============================================================ the scripts ===
$ibPath = Join-Path $repo 'scripts\deploy\Install-Bot.ps1'
$ibText = Get-Content -LiteralPath $ibPath -Raw
$e = $null
$ib = [System.Management.Automation.Language.Parser]::ParseFile($ibPath, [ref]$null, [ref]$e)
Yes 'Install-Bot.ps1 parses' (@($e).Count -eq 0)
foreach ($f in @('scripts\vps\Bot-Service.ps1', 'scripts\vps\Watch-Services.ps1', 'scripts\vps\Write-BotToken.ps1', 'scripts\vps\Restart-Server.ps1',
                 'scripts\deploy\Rotate-BotToken.ps1', 'scripts\deploy\Set-DiscordLogin.ps1')) {
    $e = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $repo $f), [ref]$null, [ref]$e)
    Yes "$f parses" (@($e).Count -eq 0)
}
Yes 'Install-Bot registers no scheduled task and writes no run.ps1 any more' (
    $ibText -notmatch 'Register-ScheduledTask|New-ScheduledTask|\\run\.ps1''|RunLevel Highest')
Yes 'Install-Bot never stops the bot by a command line itself' ($ibText -notmatch 'CommandLine|Stop-Process')
Yes 'nor sends the old roller up for it' ($ibText -notmatch '/roll-log\.ps1')
Yes 'Install-Bot sends BotService.cs from the bot''s artifact, and Bot-Service.ps1' (
    $ibText -match [regex]::Escape("'scripts/vps/BotService.cs'") -and $ibText -match [regex]::Escape("Join-Path `$Repo 'scripts\vps\BotService.cs'") -and
    $ibText -match [regex]::Escape("Join-Path `$Here '..\vps\Bot-Service.ps1'"))
# #459's record of what the bot runs is written only once the service runs it.
$recAt = $ibText.IndexOf('function Save-BotRecord')
Yes 'the box records the bot''s artifact only after the service is running, in -CodeOnly and in a full run' (
    $recAt -ge 0 -and ([regex]::Matches($ibText, 'Set-ThornswoodArtifactCurrent')).Count -eq 1 -and
    $ibText -match [regex]::Escape("if (`"`$restart`" -match ('service ' + `$Service + ' is Running')) { Save-BotRecord }") -and
    $ibText -match [regex]::Escape("-match ('service ' + `$Service + ': Running')) { Save-BotRecord }"))
$svcParam = $ib.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Service' }
Yes 'Install-Bot''s -Service is ThornswoodBot' ($svcParam -and $svcParam.DefaultValue.Extent.Text -eq "'ThornswoodBot'")

$wbt = Get-Content -LiteralPath (Join-Path $repo 'scripts\vps\Write-BotToken.ps1') -Raw
$rb = [regex]::Match($wbt, '(?s)function Restart-ThornswoodBot\(.*?\r?\n}\r?\n').Value
Yes 'Write-BotToken restarts the bot by the service''s name' ($rb -match "Service = 'ThornswoodBot'" -and $rb -match 'Restart-Service -Name \$Service')
Yes 'and never by a command line or a task' ($rb -and $rb -notmatch 'CommandLine|Stop-Process|ScheduledTask')
foreach ($f in @('scripts\deploy\Rotate-BotToken.ps1', 'scripts\deploy\Set-DiscordLogin.ps1')) {
    $t = Get-Content -LiteralPath (Join-Path $repo $f) -Raw
    Yes "$f hands Restart-ThornswoodBot the service, not a task" ($t -match 'Restart-ThornswoodBot -Root ''\$botWin'' -Service ''\$BotService''' -and $t -match "BotService = 'ThornswoodBot'")
}
$rs = Get-Content -LiteralPath (Join-Path $repo 'scripts\vps\Restart-Server.ps1') -Raw
Yes 'Restart-Server.ps1 -Service bot restarts the service by name' ($rs -match "bot\s+= @\{ Svc\s+= 'ThornswoodBot'" -and $rs -match 'Restart-Service -Name')
$fz = Get-Content -LiteralPath (Join-Path $repo 'scripts\vps\vps-freeze.ps1') -Raw
Yes 'vps-freeze.ps1 stops the bot''s service by name, and -Undo starts it, so the service cannot start python again mid-backup' (
    $fz -match "\`$botService = 'ThornswoodBot'" -and $fz -match 'Stop-Service -Name \$botService' -and $fz -match 'Start-Service -Name \$botService' -and $fz -notmatch "'Thornswood Bot'")
$rbx = Get-Content -LiteralPath (Join-Path $repo 'scripts\vps\Restore-Box.ps1') -Raw
Yes 'Restore-Box.ps1 will not restore under a running bot service' ($rbx -match "Get-Service -Name 'ThornswoodBot'" -and $rbx -notmatch "'Thornswood Bot'")
$cs = Get-Content -LiteralPath $svcSrc -Raw
Yes 'BotService.cs names itself ThornswoodBot' ($cs -match 'public const string Name = "ThornswoodBot";')
$wsText = Get-Content -LiteralPath (Join-Path $repo 'scripts\vps\Watch-Services.ps1') -Raw
Yes 'the watcher restarts the bot by the same name' ($wsText -match "Name = 'bot';\s+Svc = 'ThornswoodBot'")
Yes 'and so does Bot-Service.ps1 by default' (@((Get-Command Install-ThornswoodBotService).ScriptBlock.Ast.Body.ParamBlock.Parameters |
    Where-Object { $_.Name.VariablePath.UserPath -eq 'Name' -and $_.DefaultValue.Extent.Text -eq "'ThornswoodBot'" }).Count -eq 1)

# The two scripts Install-Bot sends with Bot-Service.ps1 in front: each fills
# in only the installer's own names, and what it sends parses.
$blocks = @($ib.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and
    $n.Extent.Text.StartsWith('@"') -and $n.Value -match '(Install|Restart)-ThornswoodBotService' }, $true))
Yes 'Install-Bot sends two scripts that use Bot-Service.ps1, the full run''s and -CodeOnly''s' ($blocks.Count -eq 2)
foreach ($b in $blocks) {
    $which = if ($b.Value -match 'Install-ThornswoodBotService') { 'the full run' } else { '-CodeOnly' }
    $strays = @()
    foreach ($x in $b.NestedExpressions) {
        $ok = ($x -is [System.Management.Automation.Language.VariableExpressionAst]) -and (@('rootWin', 'Service', 'Task') -contains $x.VariablePath.UserPath)
        if (-not $ok) { $strays += $x.Extent.Text }
    }
    Yes ("$which's script fills in only rootWin, Service and Task" + $(if ($strays.Count) { ': ' + ($strays -join ', ') } else { '' })) ($strays.Count -eq 0)
    if ($strays.Count) { continue }
    $rootWin = 'C:\Thornswood-Bot'; $Service = 'ThornswoodBot'; $Task = 'Thornswood Bot'
    $sent = (Get-Content -LiteralPath $svcLib -Raw) + "`n" + (& ([scriptblock]::Create($b.Extent.Text)))
    $e = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($sent, [ref]$null, [ref]$e)
    Yes "$which's script, as the VPS gets it, parses" (@($e).Count -eq 0)
    if ($which -eq 'the full run') {
        Yes 'the full run installs the service by name from the source it sent' ($sent -match [regex]::Escape("Install-ThornswoodBotService -Name 'ThornswoodBot' -Root 'C:\Thornswood-Bot' -Source 'C:\Thornswood-Bot\service\BotService.cs' -Task 'Thornswood Bot'"))
    } else {
        Yes '-CodeOnly restarts it by name, and says so when there is no service yet' ($sent -match [regex]::Escape("Restart-ThornswoodBotService -Name 'ThornswoodBot' -Root 'C:\Thornswood-Bot'") -and $sent -match 'NOT INSTALLED')
        # A box with no bot.log is not a failed swap: the folder and the file
        # are put right before the start, so the health check has something to
        # read and the service has somewhere to write.
        $make = [regex]::Match($sent, '(?s)function MakeLog \{.*?\r?\n\}').Value
        Yes '-CodeOnly makes the log before the start, and the folder the service writes it in' (
            $make -and $make -match [regex]::Escape("Repair-ThornswoodBotData -Root 'C:\Thornswood-Bot' -Name 'ThornswoodBot'") -and
            $make -match 'WriteAllText' -and $sent -match '(?s)function StartIt \{\s+MakeLog')
        # data\bot.log on every run, whichever of the two files the run reads,
        # so the path the docs and Show-BotLog name is always there. Nothing
        # may return out of the function in front of that.
        $newAt = $make.IndexOf('WriteAllText($new')
        Yes 'and data\bot.log by name, in front of anything that can return' (
            $make -match [regex]::Escape("`$new = Join-Path `$data 'bot.log'") -and
            $newAt -gt 0 -and $make.IndexOf('return') -gt $newAt)
        Yes 'and Why says the log is not there rather than reading nothing from it' (
            $sent -match [regex]::Escape('there is no '' + $log + '' to read'))
    }
}

# ============================================ what the box has, after the swap ===
# The block Install-Bot sends once the swap has answered, run here against a
# scratch folder the way the box runs it. A -CodeOnly run said artifact,
# STAGE OK, SWAP OK and the bot watching, and the live smoke's export and
# data\bot.log were then reported missing from C:\Thornswood-Bot, with
# nothing in the run itself saying what that folder on the box holds. These
# prove the run says it now, by full path, and goes red when a file is not
# there.
$a = $ibText.IndexOf('# ==== what the box has ====')
$b = $ibText.IndexOf('# ==== end what the box has ====')
Yes 'Install-Bot keeps the check that runs on the box between its markers' ($a -ge 0 -and $b -gt $a)
$thereBlock = ''
if ($a -ge 0 -and $b -gt $a) {
    $m = [regex]::Match($ibText.Substring($a, $b - $a), "(?s)@'\r?\n(.*?)\r?\n'@")
    if ($m.Success) { $thereBlock = $m.Groups[1].Value }
}
Yes 'and it is single quoted, so what goes up is plain PowerShell a person can read' ($thereBlock -ne '')
if ($thereBlock) {
    $run = [scriptblock]::Create("param(`$Root, `$Service, `$Must)`r`n" + $thereBlock)
    $there = Join-Path $tmp 'there'
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $there 'assets')
    foreach ($f in 'bot.py', 'card.py') { [IO.File]::WriteAllText((Join-Path $there $f), 'x') }
    [IO.File]::WriteAllText((Join-Path $there 'assets\join-card.png'), 'x')
    $must = @('bot.py', 'card.py', 'assets/join-card.png')
    $thereLog = Join-Path $there 'data\bot.log'
    $said = @(& $run $there 'ThornswoodBot' $must | ForEach-Object { "$_" })
    $all = ($said -join "`n")
    Yes 'with every file at the root it says so, and names the machine it asked and the root it asked about' (
        $said -contains 'FILES ON THE BOX' -and
        $all -match ('asked of \S.*, where the bot runs from ' + [regex]::Escape($there)))
    Yes 'and it makes data\bot.log at that root and says Test-Path True for it' (
        (Test-Path -LiteralPath $thereLog) -and $all -match ([regex]::Escape('Test-Path ' + $thereLog) + '\s+True'))
    Yes 'and every file the run sent is True by its full path under that root, card.py included' (
        @($said | Where-Object { $_ -match '\s+True$' }).Count -eq 4 -and
        $all -match ([regex]::Escape('Test-Path ' + (Join-Path $there 'card.py')) + '\s+True'))
    # The two that were reported missing after a green run.
    Remove-Item -LiteralPath (Join-Path $there 'card.py') -Force
    Remove-Item -LiteralPath $thereLog -Force
    $said = @(& $run $there 'ThornswoodBot' $must | ForEach-Object { "$_" })
    $all = ($said -join "`n")
    Yes 'a sent file that is not at the root is FILES MISSING, named by its full path on the box' (
        $said -contains 'FILES MISSING' -and
        $all -match ([regex]::Escape('Test-Path ' + (Join-Path $there 'card.py')) + '\s+False'))
    Yes 'and data\bot.log is made again rather than reported missing' ((Test-Path -LiteralPath $thereLog) -and $all -notmatch 'bot\.log  False')
}
Yes 'and a run whose files are not on the box stops, in -CodeOnly and in a full run' (
    ([regex]::Matches($ibText, 'Confirm-BotFiles')).Count -eq 3 -and
    $ibText -match [regex]::Escape('if (-not $PutBack -and -not (Confirm-BotFiles @($send.Keys))) {') -and
    $ibText -match [regex]::Escape('if (-not (Confirm-BotFiles @($send.Keys))) {'))

# ========================================================== the program ===
$build = Join-Path $tmp 'build'
$null = New-Item -ItemType Directory -Force -Path $build
$exe = Join-Path $build 'ThornswoodBotService.exe'
$r = Build-ThornswoodBotHost $svcSrc $exe
if ($OnWindows) {
    Yes ('BotService.cs builds with the .NET Framework compiler, C# 5' + $(if (-not $r.Ok) { ': ' + ($r.Lines -join ' | ') } else { '' })) ($r.Ok)
    $bad = Join-Path $build 'broken.cs'
    [IO.File]::WriteAllText($bad, 'class Broken { void X() { int y = ; } }')
    $r2 = Build-ThornswoodBotHost $bad (Join-Path $build 'broken.exe')
    Yes 'a source that does not build says so, with the compiler''s words' (-not $r2.Ok -and ($r2.Lines -join ' ') -match 'error CS')
} else {
    # The program is a Windows service built with the .NET Framework's own
    # compiler, which is a part of Windows.
    Yes 'off Windows the build says plainly that the compiler is a part of Windows' (-not $r.Ok -and ($r.Lines -join ' ') -match 'comes with Windows')
    Write-Host 'SKIP  BotService.cs built, and a broken source refused, with the .NET Framework compiler: it is only on Windows'
}

# A python for the stand-in bot: py -3.9 where there is one, which is what
# the bot's own tests use, else python.
$py = ''
foreach ($c in @(@('py', '-3.9'), @('python'))) {
    if (-not (Get-Command $c[0] -EA SilentlyContinue)) { continue }
    $pre = @(); if ($c.Count -gt 1) { $pre = @($c[1]) }
    try { $o = (& $c[0] @pre -c 'import sys; print(sys.executable)' 2>$null | Select-Object -Last 1) } catch { $o = '' }
    if ($LASTEXITCODE -eq 0 -and $o -and (Test-Path -LiteralPath "$o".Trim())) { $py = "$o".Trim(); break }
}

$fakeBot = @'
import os, sys, time, subprocess
root = os.path.dirname(os.path.abspath(__file__))
def note(name, text):
    with open(os.path.join(root, name), 'w') as f:
        f.write(str(text))
def read(name, default=''):
    p = os.path.join(root, name)
    return open(p).read().strip() if os.path.exists(p) else default
mode = read('mode.txt')
n = int(read('runs.txt', '0') or 0) + 1
note('runs.txt', n)
note('bot.pid', os.getpid())
if mode == 'env':
    print('[thornswood-bot] token ' + ('present' if os.environ.get('DISCORD_TOKEN') else 'MISSING'), flush=True)
    print('[thornswood-bot] probe ' + os.environ.get('THORNSWOOD_PROBE', 'MISSING'), flush=True)
    print('[thornswood-bot] encoding ' + os.environ.get('PYTHONIOENCODING', ''), flush=True)
    print('[thornswood-bot] cwd ' + os.getcwd(), flush=True)
    print('[thornswood-bot] data ' + os.environ.get('THORNSWOOD_BOT_DATA', 'MISSING'), flush=True)
    sys.stdout.buffer.write('[thornswood-bot] words Sk\u00e1l \u2713\n'.encode('utf-8'))
    sys.stdout.flush()
    print('[thornswood-bot] said on stderr', file=sys.stderr, flush=True)
    print('[thornswood-bot] watching 1 server', flush=True)
    time.sleep(120)
elif mode == 'quick':
    print('[thornswood-bot] failing on purpose', flush=True)
    sys.exit(3)
elif mode == 'child':
    c = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])
    note('child.pid', c.pid)
    print('[thornswood-bot] watching 1 server', flush=True)
    time.sleep(120)
elif mode == 'spam':
    total = int(read('spam.txt'))
    i = 0
    written = 0
    while written < total:
        line = '[thornswood-bot] line %06d %s\n' % (i, 'x' * 80)
        sys.stdout.write(line)
        sys.stdout.flush()
        written += len(line)
        i += 1
        if i % 50 == 0:
            time.sleep(0.02)
    note('spam-done.txt', i)
    while True:
        sys.stdout.write('[thornswood-bot] line %06d tick\n' % i)
        sys.stdout.flush()
        i += 1
        time.sleep(0.3)
elif mode == 'pattern':
    if n == 3:
        time.sleep(3)
    print('[thornswood-bot] run %d' % n, flush=True)
    sys.exit(1)
'@

# One scratch bot folder: the program in service\, host.json beside it,
# bot.env.json, the stand-in bot and its mode.
function Box([string]$name, [string]$mode, [hashtable]$settings = @{}, [string]$envJson = '') {
    $root = Join-Path $tmp $name
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $root 'service')
    Copy-Item -LiteralPath $exe -Destination (Join-Path $root 'service\ThornswoodBotService.exe')
    $h = [ordered]@{ root = $root; python = $py; script = 'fakebot.py'; fastSeconds = 2; pauseSeconds = 1; maxBytes = 20000; keep = 3; retrySeconds = 1 }
    foreach ($k in $settings.Keys) { $h[$k] = $settings[$k] }
    [IO.File]::WriteAllText((Join-Path $root 'service\host.json'), ($h | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    if (-not $envJson) { $envJson = '{"DISCORD_TOKEN":"not-a-real-token","THORNSWOOD_PROBE":"from-bot-env"}' }
    [IO.File]::WriteAllText((Join-Path $root 'bot.env.json'), $envJson, (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $root 'fakebot.py'), $fakeBot, (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $root 'mode.txt'), $mode)
    return $root
}
function StartHost([string]$root) {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $root 'service\ThornswoodBotService.exe'
    $psi.Arguments = '--console'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [Diagnostics.Process]::Start($psi)
    $h = @{ P = $p; Out = $p.StandardOutput.ReadToEndAsync(); Err = $p.StandardError.ReadToEndAsync(); Root = $root }
    $script:hosts += $h
    return $h
}
function StopHost($h, [int]$ms = 20000) {
    try { $h.P.StandardInput.WriteLine('stop'); $h.P.StandardInput.Close() } catch { }
    return $h.P.WaitForExit($ms)
}
function Until([scriptblock]$cond, [double]$seconds) {
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until) {
        if (& $cond) { return $true }
        Start-Sleep -Milliseconds 200
    }
    return [bool](& $cond)
}
function ReadShared([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    $fs = New-Object IO.FileStream($path, 'Open', 'Read', 'ReadWrite, Delete')
    try { $sr = New-Object IO.StreamReader($fs, (New-Object Text.UTF8Encoding($false))); return $sr.ReadToEnd() } finally { $fs.Dispose() }
}
# bot.log is in the bot's data folder since #1104.
function Log([string]$root) { return (ReadShared (Join-Path $root 'data\bot.log')) }
function Alive([string]$pidFile) {
    if (-not (Test-Path -LiteralPath $pidFile)) { return $false }
    $id = [int]((Get-Content -LiteralPath $pidFile -Raw).Trim())
    return [bool](Get-Process -Id $id -EA SilentlyContinue)
}
function Count([string]$text, [string]$rx) { return ([regex]::Matches($text, $rx)).Count }

if (-not $r.Ok) {
    Write-Host 'SKIP  the program''s behaviour: it did not build'
} elseif (-not $py) {
    Write-Host 'SKIP  the program''s behaviour: no python on this machine'
} else {
    # -- the settings reach python, the bytes reach bot.log, a stop ends it ---
    $root = Box 'env' 'env'
    $h = StartHost $root
    $up = Until { (Log $root) -match 'watching 1 server' } 20
    Yes 'the program starts the bot, which says it is watching its server' $up
    $log = Log $root
    Yes 'bot.env.json''s settings are in the bot''s environment' ($log -match '\[thornswood-bot\] token present' -and $log -match '\[thornswood-bot\] probe from-bot-env')
    Yes 'PYTHONIOENCODING is utf-8 when bot.env.json does not say' ($log -match '\[thornswood-bot\] encoding utf-8')
    Yes 'the bot runs in its own folder' ($log -match [regex]::Escape('[thornswood-bot] cwd ' + $root))
    Yes 'bot.log is in the data folder, not beside the code' ((Test-Path -LiteralPath (Join-Path $root 'data\bot.log')) -and -not (Test-Path -LiteralPath (Join-Path $root 'bot.log')))
    Yes 'and python is told that folder, for its records' ($log -match [regex]::Escape('[thornswood-bot] data ' + (Join-Path $root 'data')))
    $fs = New-Object IO.FileStream((Join-Path $root 'data\bot.log'), 'Open', 'Read', 'ReadWrite, Delete')
    try { $bytes = New-Object byte[] $fs.Length; [void]$fs.Read($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }
    $want = (New-Object Text.UTF8Encoding($false)).GetBytes('words Sk' + [char]0xE1 + 'l ' + [char]0x2713)
    $hex = [BitConverter]::ToString($bytes)
    Yes 'what python writes reaches bot.log byte for byte, not re-encoded' ($hex.Contains([BitConverter]::ToString($want)))
    Yes 'standard error goes into bot.log too' ($log -match 'said on stderr')
    Yes 'the program says who it runs as' ($log -match ('\[run\] the Thornswood Bot service started, running as ' + [regex]::Escape([Security.Principal.WindowsIdentity]::GetCurrent().Name)))
    Yes 'and which python it started, and its pid' ($log -match ('\[run\] started the bot, pid \d+, with ' + [regex]::Escape($py)))
    Yes 'the token itself is never written to bot.log' ($log -notmatch 'not-a-real-token')
    $botAlive = Alive (Join-Path $root 'bot.pid')
    $stopped = StopHost $h
    Yes 'a stop ends the program' ($stopped -and $h.P.ExitCode -eq 0)
    Yes 'and python with it' ($botAlive -and (Until { -not (Alive (Join-Path $root 'bot.pid')) } 5))
    Yes 'and says it stopped' ((Log $root) -match '\[run\] stopped')

    # -- a stop ends what python started too ----------------------------------
    $root = Box 'child' 'child'
    $h = StartHost $root
    $null = Until { Test-Path -LiteralPath (Join-Path $root 'child.pid') } 20
    $null = Until { Alive (Join-Path $root 'child.pid') } 5
    $both = (Alive (Join-Path $root 'bot.pid')) -and (Alive (Join-Path $root 'child.pid'))
    $null = StopHost $h
    Yes 'a stop ends python and the process python started, nothing left holding the token' ($both -and
        (Until { -not (Alive (Join-Path $root 'bot.pid')) -and -not (Alive (Join-Path $root 'child.pid')) } 5))

    # -- three quick exits and it stops, with run.ps1's own line ---------------
    $root = Box 'quick' 'quick'
    $h = StartHost $root
    $ended = $h.P.WaitForExit(30000)
    $log = Log $root
    Yes 'three quick exits in a row and the program stops by itself' ($ended -and $h.P.ExitCode -eq 0)
    Yes 'after exactly three runs' ((Count $log 'failing on purpose') -eq 3)
    Yes 'saying so in the line run.ps1 wrote, which the installers look for' ($log -match '\[run\] the bot stopped within 2 seconds three times running, the last time with exit code 3\. Not starting it again\. The reason is in the lines above\.')
    Yes 'the pause after each quick exit grows: 2 seconds, then 4' ($log -match 'exited with code 3 after \d+ seconds\. Starting it again in 2 seconds' -and $log -match 'Starting it again in 4 seconds')
    $said = ''
    if ($ended) { $said = $h.Out.Result }
    Yes 'each exit and the give-up are events, for the Windows event log' ((Count $said 'event 2 Warning') -eq 2 -and (Count $said 'event 3 Error') -eq 1)

    # -- a run that lasted starts the count again -------------------------------
    $root = Box 'pattern' 'pattern'
    $h = StartHost $root
    $ended = $h.P.WaitForExit(45000)
    Yes 'quick, quick, one that lasted, then three quick: six runs before it stops' ($ended -and [int](Get-Content -LiteralPath (Join-Path $root 'runs.txt')) -eq 6)
    Yes 'and after a run that lasted the pause is back to the first one' ((Log $root) -match '(?s)run 3.*?Starting it again in 1 seconds')

    # -- bot.log rolls by size while the bot runs ---------------------------
    $root = Box 'roll' 'spam'
    [IO.File]::WriteAllText((Join-Path $root 'spam.txt'), '120000')
    $h = StartHost $root
    $done = Until { Test-Path -LiteralPath (Join-Path $root 'spam-done.txt') } 30
    Start-Sleep -Milliseconds 500
    $running = (-not $h.P.HasExited) -and (Alive (Join-Path $root 'bot.pid'))
    $l = Join-Path $root 'data\bot.log'
    Yes 'bot.log rolled while the bot was still running' ($done -and $running -and (Test-Path -LiteralPath ($l + '.1')))
    Yes 'three rolled files kept here, as keep says, and no fourth' ((Test-Path -LiteralPath ($l + '.3')) -and -not (Test-Path -LiteralPath ($l + '.4')))
    $sizes = @(1..3 | ForEach-Object { (Get-Item -LiteralPath ($l + '.' + $_)).Length })
    Yes 'each rolled file is past the size, by at most one read of python''s output' (@($sizes | Where-Object { $_ -lt 20000 -or $_ -gt (20000 + 8192 + 200) }).Count -eq 0)
    $all = (ReadShared ($l + '.3')) + (ReadShared ($l + '.2')) + (ReadShared ($l + '.1')) + (Log $root)
    $nums = @([regex]::Matches($all, 'line (\d{6})') | ForEach-Object { [int]$_.Groups[1].Value })
    $gap = $false
    for ($i = 1; $i -lt $nums.Count; $i++) { if ($nums[$i] -ne $nums[$i - 1] + 1) { $gap = $true; break } }
    Yes 'oldest to newest, not one line lost, cut or doubled across the rolls' ($nums.Count -gt 300 -and -not $gap)
    $null = StopHost $h

    # -- a reader holding bot.log puts the roll off --------------------------
    $root = Box 'held' 'spam'
    [IO.File]::WriteAllText((Join-Path $root 'spam.txt'), '60000')
    $l = Join-Path $root 'data\bot.log'
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $root 'data')
    [IO.File]::WriteAllText($l, '')
    # Shared for reading and writing, not for deleting: how Install-Bot's
    # read-back and Show-BotLog open it.
    $reader = New-Object IO.FileStream($l, 'Open', 'Read', 'ReadWrite')
    $h = StartHost $root
    $null = Until { Test-Path -LiteralPath (Join-Path $root 'spam-done.txt') } 30
    Start-Sleep -Milliseconds 800
    $grown = (Get-Item -LiteralPath $l).Length
    Yes 'while a reader holds bot.log it is not rolled, and keeps growing' ($grown -gt 60000 -and -not (Test-Path -LiteralPath ($l + '.1')))
    Yes 'and bot.log says so, once' ((Count (Log $root) 'could not be rolled yet') -eq 1)
    $reader.Dispose()
    Yes 'once the reader lets go it rolls, with nothing lost' ((Until { Test-Path -LiteralPath ($l + '.1') } 10) -and (Get-Item -LiteralPath ($l + '.1')).Length -ge $grown)
    $null = StopHost $h

    # -- bot.log by age as well as by size (#2166) ----------------------------
    # A rolled copy whose last write is past copySeconds goes, a newer one
    # stays; the live file rolls once it is liveSeconds old, quiet, far under
    # its size. On the box: 30 days and 59, looked at every hour.
    $root = Box 'agedcopy' 'env' @{ liveSeconds = 3600; copySeconds = 3600; ageCheckSeconds = 1 }
    $l = Join-Path $root 'data\bot.log'
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $root 'data')
    [IO.File]::WriteAllText(($l + '.2'), 'an old rolled copy')
    [IO.File]::SetLastWriteTimeUtc(($l + '.2'), [DateTime]::UtcNow.AddHours(-2))
    [IO.File]::WriteAllText(($l + '.3'), 'a newer rolled copy')
    $h = StartHost $root
    $up = Until { (Log $root) -match 'watching 1 server' } 20
    Yes 'a rolled bot.log past copySeconds is deleted, and a newer one stays (#2166)' ($up -and -not (Test-Path -LiteralPath ($l + '.2')) -and (Test-Path -LiteralPath ($l + '.3')))
    Yes '  and bot.log says so' ((Log $root) -match '\[run\] by age: 1 bot\.log copy past ')
    $null = StopHost $h
    $root = Box 'agedlive' 'env' @{ liveSeconds = 3; copySeconds = 3600; ageCheckSeconds = 1 }
    $l = Join-Path $root 'data\bot.log'
    $h = StartHost $root
    $rolled = Until { Test-Path -LiteralPath ($l + '.1') } 20
    Yes 'a bot.log whose first line is past liveSeconds is rolled while the bot runs, far under its size' (
        $rolled -and (Get-Item -LiteralPath ($l + '.1')).Length -lt 20000 -and (ReadShared ($l + '.1')) -match 'watching 1 server')
    Yes '  and the bot carries on, with bot.log there to write to' ((Alive (Join-Path $root 'bot.pid')) -and (Test-Path -LiteralPath $l))
    $null = StopHost $h

    # -- what stops it before python starts -----------------------------------
    $root = Box 'notoken' 'env' @{} '{"THORNSWOOD_PROBE":"x"}'
    $h = StartHost $root
    Yes 'no token: it stops at once, saying bot.env.json has none' ($h.P.WaitForExit(15000) -and $h.P.ExitCode -eq 1 -and (Log $root) -match '\[run\] bot\.env\.json has no DISCORD_TOKEN in it' -and -not (Test-Path -LiteralPath (Join-Path $root 'bot.pid')))
    $root = Box 'badenv' 'env' @{} '{ this is not json'
    $h = StartHost $root
    Yes 'an unreadable bot.env.json: it stops, saying which file and who it runs as' ($h.P.WaitForExit(15000) -and $h.P.ExitCode -eq 1 -and (Log $root) -match '\[run\] cannot read .*bot\.env\.json' -and (Log $root) -match '\[run\] running as ')
    $root = Box 'nopython' 'env' @{ python = (Join-Path $tmp 'no-such\python.exe') }
    $h = StartHost $root
    $ended = $h.P.WaitForExit(30000)
    Yes 'no python where host.json says: three tries, each saying so, then it stops' ($ended -and (Count (Log $root) '\[run\] could not start ') -eq 3 -and (Log $root) -match 'three times running, the last time with exit code -1')
    $root = Box 'nohostjson' 'env'
    Remove-Item -LiteralPath (Join-Path $root 'service\host.json')
    $h = StartHost $root
    Yes 'no host.json: it stops, and says in the bot''s folder which file it wants' ($h.P.WaitForExit(15000) -and $h.P.ExitCode -eq 1 -and (Log $root) -match 'host\.json.*Install-Bot\.ps1 writes that file')
}

# The grants are folder ACLs, read and written by SID, and the install builds
# the program with the .NET Framework compiler and registers a Windows service:
# all of it Windows.
if ($OnWindows) {
    # ============================================================ the grants ===
    function Protect([string]$path, [string[]]$sids) {
        $acl = Get-Acl -LiteralPath $path
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($x in @($acl.Access)) { [void]$acl.RemoveAccessRule($x) }
        $isDir = Test-Path -LiteralPath $path -PathType Container
        foreach ($s in $sids) {
            $who = New-Object Security.Principal.SecurityIdentifier($s)
            if ($isDir) { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($who, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))) }
            else { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($who, 'FullControl', 'Allow'))) }
        }
        Set-Acl -LiteralPath $path -AclObject $acl
    }
    # The bot's account's rules on a path, read by SID (#1880). Get-Acl's .Access
    # names every account Windows knows, and on the VPS, where the ThornswoodBot
    # service is real, the bot's rule reads NT SERVICE\ThornswoodBot rather than
    # its SID. A match on the SID found no rule there: the sixteen checks that
    # want one failed on the build runner, and the ones that want none passed
    # whatever the folder held.
    function Rules([string]$path) {
        return @((Get-Acl -LiteralPath $path).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $sid })
    }
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $g = Join-Path $tmp 'grants'
    $gRoot = Join-Path $g 'Thornswood-Bot'
    $gWatch = Join-Path $g 'Thornswood-Watch'
    $gData = Join-Path $g 'Thornswood-Docs\data'
    $gForBot = Join-Path $gData 'for-bot'
    $gFromBot = Join-Path $gData 'from-bot'
    # A game server with private\moderation.log from before #2321, which had the
    # bot's read on that one file, and no for-bot yet.
    $gServer = Join-Path $g 'Thornswood-Server'
    $gMod = Join-Path $gServer 'private\moderation.log'
    foreach ($d in @($gRoot, (Join-Path $gRoot 'service'), (Join-Path $gRoot 'webhooks'), $gWatch, (Join-Path $gData 'session-logs'), $gForBot, $gFromBot, (Split-Path -Parent $gMod))) { $null = New-Item -ItemType Directory -Force -Path $d }
    foreach ($f in @((Join-Path $gRoot 'bot.py'), (Join-Path $gRoot 'bot.env.json'), (Join-Path $gRoot 'service\host.json'), (Join-Path $gRoot 'webhooks\news.txt'), (Join-Path $gWatch 'alerts.jsonl'),
                     (Join-Path $gWatch 'alerts-webhook.txt'), (Join-Path $gData 'sessions.json'), (Join-Path $gForBot 'trouble.json'), (Join-Path $gData 'session-logs\one.log'), $gMod,
                     (Join-Path (Split-Path -Parent $gMod) 'door.json'))) { [IO.File]::WriteAllText($f, 'x') }
    # What the box has from before #1102 and #1104: the bot's account with Modify
    # on its whole folder, read on every file in the site's data, and the Users
    # rule every folder under C:\ inherits (given here, since a scratch folder
    # under the temp folder does not have it).
    $users = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545')
    $acl = Get-Acl -LiteralPath $gRoot
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'Modify', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($users, 'ReadAndExecute, CreateFiles', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
    Set-Acl -LiteralPath $gRoot -AclObject $acl
    $acl = Get-Acl -LiteralPath $gData
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'Read', 'ObjectInherit', 'NoPropagateInherit', 'Allow')))
    Set-Acl -LiteralPath $gData -AclObject $acl
    # A module the bot's account could have dropped beside bot.py, and the cache
    # it wrote, owned by it.
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $gRoot '__pycache__')
    [IO.File]::WriteAllText((Join-Path $gRoot '__pycache__\bot.cpython-312.pyc'), 'x')
    Protect (Join-Path $gRoot 'bot.env.json') @('S-1-5-18', 'S-1-5-32-544', $me)
    Protect (Join-Path $gWatch 'alerts-webhook.txt') @('S-1-5-18', 'S-1-5-32-544', $me)
    $acl = Get-Acl -LiteralPath $gMod
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'Read', 'Allow')))
    Set-Acl -LiteralPath $gMod -AclObject $acl
    # A server folder that is not on this box.
    $missing = Join-Path $g 'Thornswood-Server-Dev'
    $moved = @(Move-ThornswoodBotRecords $gRoot)
    Yes 'the cache the bot''s account wrote beside its code is removed' (-not (Test-Path -LiteralPath (Join-Path $gRoot '__pycache__')) -and ($moved -join ' ') -match '__pycache__')
    $said = @(Grant-ThornswoodBotAccess -Sid $sid -Root $gRoot -WatchRoot $gWatch -DocsData $gData -ServerRoots @($gServer, $missing))
    Yes 'every grant went on' (@($said | Where-Object { $_ -match '^COULD NOT' }).Count -eq 0)
    # Which one did not, and why, so a red on the build runner says it in the log.
    foreach ($l in @($said | Where-Object { $_ -match '^COULD NOT' })) { Write-Host ('      ' + $l) }
    $rootAcl = Get-Acl -LiteralPath $gRoot
    Yes 'the bot''s folder takes nothing from above it' ($rootAcl.AreAccessRulesProtected -and @($rootAcl.Access | Where-Object { $_.IsInherited }).Count -eq 0)
    Yes 'and no Users, Everyone or Authenticated Users rule reaches it or bot.py' (
        @(@($rootAcl.Access) + @((Get-Acl -LiteralPath (Join-Path $gRoot 'bot.py')).Access) | Where-Object { @('S-1-5-32-545', 'S-1-1-0', 'S-1-5-11') -contains $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }).Count -eq 0)
    $x = Rules $gRoot
    Yes 'the bot''s folder: read and run for the bot''s account, to everything under it, and no more' ($x.Count -eq 1 -and "$($x[0].FileSystemRights)" -match 'ReadAndExecute' -and "$($x[0].FileSystemRights)" -notmatch 'Modify|Write|FullControl' -and "$($x[0].InheritanceFlags)" -match 'ContainerInherit' -and "$($x[0].InheritanceFlags)" -match 'ObjectInherit')
    $x = @(Rules (Join-Path $gRoot 'bot.py'))
    Yes 'so the bot''s account cannot write bot.py' ($x.Count -ge 1 -and @($x | Where-Object { "$($_.FileSystemRights)" -match 'Modify|Write|FullControl|CreateFiles|AppendData' }).Count -eq 0)
    $owner = @($rootAcl.Access | Where-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-3-4' })
    Yes 'and OWNER RIGHTS is read and run, so a file the account owns cannot be opened up by it' ($owner.Count -eq 1 -and "$($owner[0].FileSystemRights)" -notmatch 'Modify|Write|FullControl|ChangePermissions')
    $x = Rules (Join-Path $gRoot 'data')
    Yes 'the data folder: Modify for the bot''s account, the one place it writes' (@($x | Where-Object { -not $_.IsInherited -and "$($_.FileSystemRights)" -match 'Modify' }).Count -eq 1)
    $hookAcl = Get-Acl -LiteralPath (Join-Path $gRoot 'webhooks')
    Yes 'the webhooks folder takes nothing from the bot''s folder, and the bot''s account has nothing there' ($hookAcl.AreAccessRulesProtected -and (Rules (Join-Path $gRoot 'webhooks')).Count -eq 0 -and (Rules (Join-Path $gRoot 'webhooks\news.txt')).Count -eq 0)
    $svcAcl = Get-Acl -LiteralPath (Join-Path $gRoot 'service')
    $x = Rules (Join-Path $gRoot 'service')
    Yes 'the program''s folder takes nothing from the bot''s folder' ($svcAcl.AreAccessRulesProtected -and @($svcAcl.Access | Where-Object { $_.IsInherited }).Count -eq 0)
    Yes 'and the bot''s account may read it and run the program, not change it' ($x.Count -eq 1 -and "$($x[0].FileSystemRights)" -match 'ReadAndExecute' -and "$($x[0].FileSystemRights)" -notmatch 'Modify|Write|FullControl')
    Yes 'nor host.json in it' (@(Rules (Join-Path $gRoot 'service\host.json') | Where-Object { "$($_.FileSystemRights)" -match 'Modify|Write|FullControl' }).Count -eq 0 -and (Rules (Join-Path $gRoot 'service\host.json')).Count -eq 1)
    $x = Rules (Join-Path $gRoot 'bot.env.json')
    Yes 'bot.env.json: stays protected, and the bot''s account may read it and nothing more' ((Get-Acl -LiteralPath (Join-Path $gRoot 'bot.env.json')).AreAccessRulesProtected -and $x.Count -eq 1 -and "$($x[0].FileSystemRights)" -match '^Read, Synchronize$')
    $x = Rules $gWatch
    Yes 'the watchdog''s folder: read on the files directly in it' ($x.Count -eq 1 -and "$($x[0].FileSystemRights)" -match '^Read' -and "$($x[0].PropagationFlags)" -match 'NoPropagateInherit')
    Yes 'which alerts.jsonl gets' ((Rules (Join-Path $gWatch 'alerts.jsonl')).Count -eq 1)
    Yes 'and the protected webhook file does not' ((Rules (Join-Path $gWatch 'alerts-webhook.txt')).Count -eq 0)
    $sent = Join-Path $gWatch 'alerts-sent-bot.txt'
    Yes 'alerts-sent-bot.txt is made when it is not there, and the bot''s account may write it' ((Test-Path -LiteralPath $sent) -and @(Rules $sent | Where-Object { -not $_.IsInherited -and "$($_.FileSystemRights)" -match 'Modify' }).Count -eq 1)
    Yes 'the site''s for-bot folder: read on what the site writes for the bot' ((Rules (Join-Path $gForBot 'trouble.json')).Count -eq 1 -and "$((Rules (Join-Path $gForBot 'trouble.json'))[0].FileSystemRights)" -notmatch 'Modify|Write')
    $x = Rules $gFromBot
    Yes 'the site''s from-bot folder: Modify, for the known issues and roadmap the bot writes for the site (#3140)' ($x.Count -eq 1 -and "$($x[0].FileSystemRights)" -match 'Modify' -and "$($x[0].InheritanceFlags)" -match 'ObjectInherit')
    Yes 'and the bot''s account cannot read sessions.json, or anything else of the site''s' ((Rules (Join-Path $gData 'sessions.json')).Count -eq 0 -and (Rules $gData).Count -eq 0)
    Yes 'nor anything below the site''s data' ((Rules (Join-Path $gData 'session-logs\one.log')).Count -eq 0 -and (Rules (Join-Path $gData 'session-logs')).Count -eq 0)
    # The game servers' staff log (#2321): read on the for-bot folder beside
    # private, made here when the server has none, so a log the gamemode makes
    # after the grant takes the rule; private and door.json never get one.
    $gFb = Join-Path $gServer 'for-bot'
    $x = @(Rules $gFb)
    Yes 'a game server''s for-bot is made when it has none, and said' ((Test-Path -LiteralPath $gFb) -and ($said -join "`n") -match [regex]::Escape('made ' + $gFb))
    Yes 'and the bot''s account may read it and everything in it, and no more' ($x.Count -eq 1 -and "$($x[0].FileSystemRights)" -match '^Read' -and "$($x[0].FileSystemRights)" -notmatch 'Modify|Write|FullControl' -and "$($x[0].InheritanceFlags)" -match 'ContainerInherit' -and "$($x[0].InheritanceFlags)" -match 'ObjectInherit')
    # What the gamemode does at the first staff action, after the install: make
    # the file. It takes the folder's rule, which a rule on one file never could.
    $later = Join-Path $gFb 'moderation.log'
    [IO.File]::AppendAllText($later, '{"did":"warn"}' + "`n")
    $x = @(Rules $later)
    Yes 'a staff log the gamemode makes after the grant takes the bot''s read by itself' ($x.Count -eq 1 -and $x[0].IsInherited -and "$($x[0].FileSystemRights)" -match '^Read' -and "$($x[0].FileSystemRights)" -notmatch 'Modify|Write|FullControl')
    Yes 'and private, door.json and the old moderation.log there give the bot''s account nothing' ((Rules (Split-Path -Parent $gMod)).Count -eq 0 -and (Rules (Join-Path (Split-Path -Parent $gMod) 'door.json')).Count -eq 0 -and (Rules $gMod).Count -eq 0)
    Yes 'the bot''s old rule on private\moderation.log is taken off, and said' (($said -join "`n") -match [regex]::Escape('took the bot''s account off ' + $gMod))
    Yes 'a server folder that is not on the box is said, and nothing is made' (($said -join "`n") -match [regex]::Escape('no game server at ' + $missing) -and -not (Test-Path -LiteralPath $missing))
    $null = @(Grant-ThornswoodBotAccess -Sid $sid -Root $gRoot -WatchRoot $gWatch -DocsData $gData -ServerRoots @($gServer))
    function Own([string]$path) { return @(Rules $path | Where-Object { -not $_.IsInherited }).Count }
    Yes 'given again, nothing is doubled' ((Own $gRoot) -eq 1 -and (Own (Join-Path $gRoot 'data')) -eq 1 -and (Own $gForBot) -eq 1 -and (Own $gFromBot) -eq 1 -and (Own (Join-Path $gRoot 'bot.env.json')) -eq 1 -and (Own $gWatch) -eq 1 -and (Own $sent) -eq 1 -and (Own $gFb) -eq 1)
    $said = @(Grant-ThornswoodBotAccess -Sid $sid -Root $gRoot -WatchRoot '' -DocsData (Join-Path $g 'no-site\data') -ServerRoots @())
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $g 'no-forbot\data')
    $said = @(Grant-ThornswoodBotAccess -Sid $sid -Root $gRoot -WatchRoot '' -DocsData (Join-Path $g 'no-forbot\data') -ServerRoots @())
    Yes 'a site with no for-bot yet: said, with what to run, and nothing made' (($said -join ' ') -match 'for-bot\. Run Deploy-Docs\.ps1' -and -not (Test-Path -LiteralPath (Join-Path $g 'no-forbot\data\for-bot')))
    Yes 'nor from-bot: said the same way, and nothing made' (($said -join ' ') -match 'from-bot\. Run Deploy-Docs\.ps1' -and -not (Test-Path -LiteralPath (Join-Path $g 'no-forbot\data\from-bot')))

    # -- the records move out of the code folder --------------------------------------
    $mv = Join-Path $g 'move-records'
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $mv 'data')
    foreach ($n in 'joins.json', 'open-tickets.json', 'commands-synced.json', 'heartbeat.json', 'bot.log', 'bot.log.1', 'bot.log.20260916-1535.old', 'bot.py') { [IO.File]::WriteAllText((Join-Path $mv $n), ('old ' + $n)) }
    [IO.File]::WriteAllText((Join-Path $mv 'data\heartbeat.json'), 'newer')
    $said = @(Move-ThornswoodBotRecords $mv)
    Yes 'joins.json, open tickets, the command stamp and the logs move into data' (
        ((Get-Content -LiteralPath (Join-Path $mv 'data\joins.json') -Raw) -eq 'old joins.json') -and (Test-Path -LiteralPath (Join-Path $mv 'data\open-tickets.json')) -and
        (Test-Path -LiteralPath (Join-Path $mv 'data\commands-synced.json')) -and (Test-Path -LiteralPath (Join-Path $mv 'data\bot.log')) -and (Test-Path -LiteralPath (Join-Path $mv 'data\bot.log.1')) -and
        -not (Test-Path -LiteralPath (Join-Path $mv 'joins.json')) -and -not (Test-Path -LiteralPath (Join-Path $mv 'bot.log')))
    Yes 'one already in data is kept, and the old one beside the code goes' (((Get-Content -LiteralPath (Join-Path $mv 'data\heartbeat.json') -Raw) -eq 'newer') -and -not (Test-Path -LiteralPath (Join-Path $mv 'heartbeat.json')))
    Yes 'the code is not touched' (Test-Path -LiteralPath (Join-Path $mv 'bot.py'))
    # A log somebody renamed by hand to keep it is a log too (#1184): the swap
    # leaves it beside the code as the bot's own, so the full run moves it into
    # data rather than leaving it there for ever. A log is never removed.
    Yes 'a log renamed by hand moves into data with the rest' (
        ((Get-Content -LiteralPath (Join-Path $mv 'data\bot.log.20260916-1535.old') -Raw) -eq 'old bot.log.20260916-1535.old') -and
        -not (Test-Path -LiteralPath (Join-Path $mv 'bot.log.20260916-1535.old')))
    # What the swap leaves in the bot's folder besides the code it sends (#1184).
    # The things the full run moves or takes off later are in it by the same
    # lists those use, so the two cannot drift apart.
    $owned = @(Get-ThornswoodBotOwned)
    Yes 'what the bot owns besides its code: its settings, its record, data, service, webhooks, py-libs' (
        -not @('bot.env.json', 'thornswood-deploy.json', 'data', 'service', 'webhooks', 'py-libs' | Where-Object { $owned -notcontains $_ }).Count)
    Yes '  and the old loop''s files and the records and logs from before #1104, by the lists the full run uses' (
        -not @(@(Get-ThornswoodBotLoopFiles) + @(Get-ThornswoodBotRecordNames) | Where-Object { $owned -notcontains $_ }).Count -and
        @(Get-ThornswoodBotLoopFiles).Count -eq 2 -and @('bot.log', 'bot.log.1', 'bot.log.20260916-1535.old' | Where-Object { $n = $_; @($owned | Where-Object { $n -like $_ }).Count }).Count -eq 3)
    Yes '  and no code: bot.py, card.py, assets and a stray sample.py are none of its own' (
        -not @('bot.py', 'card.py', 'assets', 'sample.py', 'backfill.py' | Where-Object { $n = $_; @($owned | Where-Object { $n -like $_ }).Count }).Count)
    Yes 'the log is read from data from then on' ((Get-ThornswoodBotLog $mv) -eq (Join-Path $mv 'data\bot.log'))
    $old = Join-Path $g 'old-layout'
    $null = New-Item -ItemType Directory -Force -Path $old
    [IO.File]::WriteAllText((Join-Path $old 'bot.log'), 'x')
    Yes 'and from beside the code on a box whose install is older' ((Get-ThornswoodBotLog $old) -eq (Join-Path $old 'bot.log'))
    # With both there, the one written last, because -CodeOnly leaves an empty
    # data\bot.log on every run so the path the docs name is always a file: a rule
    # that went by which files exist would put every reader on that empty one
    # while the bot wrote the other.
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $old 'data')
    [IO.File]::WriteAllText((Join-Path $old 'data\bot.log'), '')
    (Get-Item -LiteralPath (Join-Path $old 'data\bot.log')).LastWriteTimeUtc = [DateTime]::UtcNow.AddMinutes(-5)
    Yes 'with both there, the one the bot is writing: the older place when that is the one written last' (
        (Get-ThornswoodBotLog $old) -eq (Join-Path $old 'bot.log'))
    (Get-Item -LiteralPath (Join-Path $old 'data\bot.log')).LastWriteTimeUtc = [DateTime]::UtcNow.AddMinutes(5)
    Yes 'and data once the program writing it is the newer one' ((Get-ThornswoodBotLog $old) -eq (Join-Path $old 'data\bot.log'))

    # -- the data folder put right for a restart, where it has gone ------------------
    # The service opens its log before it starts python, so no data folder is no
    # service: -CodeOnly's restart makes it and grants the account Modify, as a
    # full run would, rather than stopping the bot and waiting out -Wait on a log
    # nothing could write.
    $gone = Join-Path $g 'no-data'
    $null = New-Item -ItemType Directory -Force -Path $gone
    $said = @(Repair-ThornswoodBotData -Root $gone -Name 'ThornswoodBot')
    $x = @(Rules (Join-Path $gone 'data'))
    Yes 'a bot folder with no data folder: it is made, and the bot''s account may write it' (
        (Test-Path -LiteralPath (Join-Path $gone 'data')) -and ($said -join ' ') -match 'made .*data' -and
        @($x | Where-Object { "$($_.FileSystemRights)" -match 'Modify' }).Count -eq 1)
    Yes 'and a file made in it is writable by the account too, which is what bot.log is' (
        @(& { [IO.File]::WriteAllText((Join-Path $gone 'data\bot.log'), ''); Rules (Join-Path $gone 'data\bot.log') } |
          Where-Object { "$($_.FileSystemRights)" -match 'Modify' }).Count -eq 1)
    Yes 'and with the folder there it says nothing and leaves its rules alone, since they are the full run''s' (
        @(Repair-ThornswoodBotData -Root $gone -Name 'ThornswoodBot').Count -eq 0 -and (Own (Join-Path $gone 'data')) -eq 1)
    $said = @(Grant-ThornswoodBotAccess -Sid $sid -Root $gRoot -WatchRoot (Join-Path $g 'no-watch-yet') -DocsData '' -ServerRoots @())
    Yes 'no watchdog folder yet: said, with what to run' (($said -join ' ') -match 'no-watch-yet\. Run Install-Bot\.ps1 again after Watch-Services\.ps1 -Install')

    # ========================================================== the install ===
    # Stand-ins for everything that touches the service manager, the task
    # scheduler and the process list. The compiler, the files and the ACLs are
    # real. $script:calls is the order things happened in.
    $script:calls = @()
    $script:svc = $null
    $script:task = $true
    $script:startFails = $false
    $script:procs = @()
    function Get-Service { [CmdletBinding()] param([string]$Name) $script:calls += 'Get-Service'; return $script:svc }
    function Stop-Service { [CmdletBinding()] param([string]$Name, [switch]$Force) $script:calls += ('Stop-Service ' + $Name); if ($script:svc) { $script:svc = [pscustomobject]@{ Name = $Name; Status = 'Stopped' } } }
    function Start-Service { [CmdletBinding()] param([string]$Name) $script:calls += ('Start-Service ' + $Name); if ($script:startFails) { throw 'The service did not respond to the start request' }; $script:svc = [pscustomobject]@{ Name = $Name; Status = 'Running' } }
    function New-Service { [CmdletBinding()] param([string]$Name, [string]$BinaryPathName, [string]$DisplayName, [string]$StartupType, [string]$Description, $Credential)
        $script:calls += ('New-Service ' + $Name + '|' + $BinaryPathName + '|' + $DisplayName + '|' + $StartupType + '|' + [bool]$Credential)
        $script:svc = [pscustomobject]@{ Name = $Name; Status = 'Stopped' } }
    function sc.exe { $script:calls += ('sc ' + ($args -join ' ')); $global:LASTEXITCODE = 0; 'SUCCESS' }
    function Get-ScheduledTask { [CmdletBinding()] param([string]$TaskName) if ($script:task) { return [pscustomobject]@{ TaskName = $TaskName } } }
    function Stop-ScheduledTask { [CmdletBinding()] param([string]$TaskName) $script:calls += ('Stop-ScheduledTask ' + $TaskName) }
    function Unregister-ScheduledTask { [CmdletBinding()] param([string]$TaskName, [switch]$Confirm) $script:calls += ('Unregister-ScheduledTask ' + $TaskName); $script:task = $false }
    function Get-CimInstance { [CmdletBinding()] param([Parameter(Position = 0)][string]$ClassName, [string]$Filter)
        if ($ClassName -eq 'Win32_Service') { return [pscustomobject]@{ State = 'Running'; StartName = 'NT SERVICE\ThornswoodBot' } }
        return $script:procs }
    function Stop-Process { [CmdletBinding()] param([int]$Id, [switch]$Force) $script:calls += ('Stop-Process ' + $Id) }
    # The stop and wait (StopAndMove.ps1, which Install-Bot sends in front of
    # Bot-Service.ps1, #2928): opening is taking the id, and ending and waiting
    # is the stop, called in the same order Stop-Process was.
    $ThornswoodNotHeld = @()
    $ThornswoodStillRunning = @()
    function Get-ThornswoodProcessHeld([int[]]$Ids) { @($Ids | Where-Object { $_ -gt 0 -and $_ -ne $PID }) }
    function Stop-ThornswoodProcessHeld($Held) { foreach ($id in @($Held)) { $script:calls += ('Stop-Process ' + $id) } }
    function Get-ThornswoodPathHolders([string]$Path) { 'nothing' }
    function Test-ThornswoodEventSource([string]$Name) { return $false }
    function New-EventLog { [CmdletBinding()] param([string]$LogName, [string]$Source) $script:calls += ('New-EventLog ' + $LogName + ' ' + $Source) }
    function Start-Sleep { }

    # A python that says where its libraries are, as the real check asks it to.
    # Not under C:\Users: the check refuses any python there, rightly, because the
    # service's account cannot read another account's profile, and the temp
    # folder of whoever runs this (a person, or the runner's account on the VPS)
    # is in their profile. So the stand-ins go in a folder of their own under
    # ProgramData, removed at the end, when the scratch folder is in a profile.
    $pyRoot = Join-Path $tmp 'pyfake'
    if ($tmp -match '^[A-Za-z]:\\Users\\') {
        $pyRoot = Join-Path $env:ProgramData ('ts-bot-service-pyfake-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        $script:pyOutside = $pyRoot
    }
    $goodPy = Join-Path $pyRoot 'good\python.cmd'
    $userPy = Join-Path $pyRoot 'user\python.cmd'
    $failPy = Join-Path $pyRoot 'fail\python.cmd'
    foreach ($p in @($goodPy, $userPy, $failPy)) { $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) }
    [IO.File]::WriteAllText($goodPy, "@echo off`r`necho C:\Program Files\Python312\Lib\site-packages\discord\__init__.py`r`necho C:\Program Files\Python312\Lib\site-packages\PIL\__init__.py`r`necho C:\Program Files\Python312\Lib\site-packages\certifi\cacert.pem`r`nexit /b 0`r`n")
    [IO.File]::WriteAllText($userPy, "@echo off`r`necho C:\Users\Administrator\AppData\Roaming\Python\Python312\site-packages\discord\__init__.py`r`necho C:\Program Files\Python312\Lib\site-packages\PIL\__init__.py`r`necho C:\Program Files\Python312\Lib\site-packages\certifi\cacert.pem`r`nexit /b 0`r`n")
    [IO.File]::WriteAllText($failPy, "@echo off`r`necho ModuleNotFoundError: No module named 'discord'`r`nexit /b 1`r`n")

    Yes 'a python whose libraries are for everybody passes the check' (@(Test-ThornswoodBotPython $goodPy).Count -eq 0)
    $b = @(Test-ThornswoodBotPython $userPy)
    Yes 'a library installed for one person is refused, saying where' ($b.Count -eq 1 -and $b[0] -match 'installed for one person, at C:\\Users\\Administrator')
    $b = @(Test-ThornswoodBotPython $failPy)
    Yes 'a python that cannot import the bot''s libraries is refused' ($b.Count -eq 1 -and $b[0] -match 'cannot import discord, PIL and certifi')
    Yes 'no python at all is refused' ((@(Test-ThornswoodBotPython (Join-Path $tmp 'none\python.exe')) -join '') -match 'not found')
    if ($py -match '^[A-Za-z]:\\Users\\') {
        Yes 'the per-person python on this machine is refused too' ((@(Test-ThornswoodBotPython $py) -join ' ') -match 'python is installed for one person')
    }

    function InstallBox([string]$name) {
        $root = Join-Path $tmp $name
        $null = New-Item -ItemType Directory -Force -Path $root
        foreach ($f in 'run.ps1', 'roll-log.ps1', 'bot.py') { [IO.File]::WriteAllText((Join-Path $root $f), 'x') }
        [IO.File]::WriteAllText((Join-Path $root 'bot.env.json'), '{}')
        $script:calls = @()
        $script:procs = @(
            [pscustomobject]@{ Name = 'python.exe'; ProcessId = 101; CommandLine = 'python "' + $root + '\bot.py"' },
            [pscustomobject]@{ Name = 'powershell.exe'; ProcessId = 102; CommandLine = 'powershell.exe -NoProfile -File "' + $root + '\run.ps1"' },
            [pscustomobject]@{ Name = 'cmd.exe'; ProcessId = 103; CommandLine = 'cmd /c "python ""' + $root + '\bot.py"" >> ""' + $root + '\bot.log"" 2>&1"' },
            [pscustomobject]@{ Name = 'python.exe'; ProcessId = 104; CommandLine = 'python C:\somewhere-else\tool.py' },
            [pscustomobject]@{ Name = 'node.exe'; ProcessId = 105; CommandLine = 'node ' + $root + '\not-the-bot.js' },
            [pscustomobject]@{ Name = 'pwsh.exe'; ProcessId = $PID; CommandLine = 'pwsh -File ' + $root + '\this-install.ps1' })
        return $root
    }
    function At([string]$rx) { for ($i = 0; $i -lt $script:calls.Count; $i++) { if ($script:calls[$i] -match $rx) { return $i } }; return -1 }

    # -- the first time: the old loop on the box, no service ------------------------
    $script:svc = $null; $script:task = $true; $script:startFails = $false
    $root = InstallBox 'install-first'
    $res = Install-ThornswoodBotService -Name 'ThornswoodBot' -Root $root -Python $goodPy -Source $svcSrc -Task 'Thornswood Bot' -WatchRoot '' -DocsData '' -ServerRoots @()
    $lines = ($res.Lines -join "`n")
    Yes ('the first install says it worked' + $(if (-not $res.Ok) { ': ' + $lines } else { '' })) ($res.Ok)
    Yes 'the program is built and in place, and no half-built copy is left' ((Test-Path -LiteralPath (Join-Path $root 'service\ThornswoodBotService.exe')) -and -not (Test-Path -LiteralPath (Join-Path $root 'service\ThornswoodBotService.new.exe')))
    $hj = Get-Content -LiteralPath (Join-Path $root 'service\host.json') -Raw | ConvertFrom-Json
    Yes 'host.json names the bot''s folder, its data folder and the python it checked' ($hj.root -eq $root -and $hj.data -eq (Join-Path $root 'data') -and $hj.python -eq $goodPy -and $hj.script -eq 'bot.py')
    Yes 'the old scheduled task is stopped and removed' ((At '^Unregister-ScheduledTask Thornswood Bot$') -ge 0 -and $lines -match 'removed the old scheduled task Thornswood Bot')
    Yes 'run.ps1 and roll-log.ps1 are gone from the bot''s folder' (-not (Test-Path -LiteralPath (Join-Path $root 'run.ps1')) -and -not (Test-Path -LiteralPath (Join-Path $root 'roll-log.ps1')) -and (Test-Path -LiteralPath (Join-Path $root 'bot.py')))
    Yes 'the old loop''s python, powershell and cmd are stopped' ((At '^Stop-Process 101$') -ge 0 -and (At '^Stop-Process 102$') -ge 0 -and (At '^Stop-Process 103$') -ge 0)
    Yes 'and nothing else: not another python, not node, not this install itself' ((At '^Stop-Process 104$') -lt 0 -and (At '^Stop-Process 105$') -lt 0 -and (At ('^Stop-Process ' + $PID + '$')) -lt 0)
    $ns = @($script:calls | Where-Object { $_ -match '^New-Service ' })
    Yes 'the service is made once, by name, starting with Windows' ($ns.Count -eq 1 -and $ns[0] -eq ('New-Service ThornswoodBot|' + (Join-Path $root 'service\ThornswoodBotService.exe') + '|Thornswood Bot|Automatic|False'))
    Yes 'as NT SERVICE\ThornswoodBot' ((At ('^sc config ThornswoodBot binPath= ' + [regex]::Escape((Join-Path $root 'service\ThornswoodBotService.exe')) + ' start= auto obj= NT SERVICE\\ThornswoodBot$')) -ge 0)
    Yes 'with no password anywhere, because the account has none' (@($script:calls | Where-Object { $_ -match '(?i)password' }).Count -eq 0)
    Yes 'its own SID on its token, and one privilege, for walking folders' ((At '^sc sidtype ThornswoodBot unrestricted$') -ge 0 -and (At '^sc privs ThornswoodBot SeChangeNotifyPrivilege$') -ge 0)
    Yes 'restarted after a minute if the program itself crashes' ((At '^sc failure ThornswoodBot reset= 3600 actions= restart/60000/restart/300000$') -ge 0)
    Yes 'its exits go to the Application event log' ((At '^New-EventLog Application ThornswoodBot$') -ge 0)
    Yes 'the bot''s account is granted its data folder before it starts, and only read on its code' (@(Rules (Join-Path $root 'data') | Where-Object { "$($_.FileSystemRights)" -match 'Modify' }).Count -eq 1 -and @(Rules $root | Where-Object { "$($_.FileSystemRights)" -match 'Modify' }).Count -eq 0)
    $first = At '^Stop-|^Unregister-'
    Yes 'started by name, last' ((At '^Start-Service ThornswoodBot$') -eq ($script:calls.Count - 1))
    Yes 'nothing on the box was stopped before the program had built' ($lines.IndexOf('built the service program') -ge 0 -and $lines.IndexOf('built the service program') -lt $lines.IndexOf('removed the old scheduled task'))
    Yes 'and the read-back says what it runs as' ($lines -match 'service ThornswoodBot: Running, as NT SERVICE\\ThornswoodBot')

    # -- again, with the service there and running ----------------------------------
    $root2 = $root
    $script:calls = @()
    $res = Install-ThornswoodBotService -Name 'ThornswoodBot' -Root $root2 -Python $goodPy -Source $svcSrc -Task 'Thornswood Bot' -WatchRoot '' -DocsData '' -ServerRoots @()
    Yes 'a second install works too' ($res.Ok)
    Yes 'it stops the running service by name first, then replaces the program' ((At '^Stop-Service ThornswoodBot$') -ge 0 -and (At '^Stop-Service ThornswoodBot$') -lt (At '^sc config'))
    Yes 'and does not make the service twice' (@($script:calls | Where-Object { $_ -match '^New-Service ' }).Count -eq 0)
    Yes 'with no old task left, nothing is unregistered' ((At '^Unregister-ScheduledTask') -lt 0)

    # -- what stops it before anything is touched ------------------------------------
    $script:svc = [pscustomobject]@{ Name = 'ThornswoodBot'; Status = 'Running' }; $script:task = $true
    $root = InstallBox 'install-badpython'
    $res = Install-ThornswoodBotService -Name 'ThornswoodBot' -Root $root -Python $userPy -Source $svcSrc -Task 'Thornswood Bot' -WatchRoot '' -DocsData '' -ServerRoots @()
    Yes 'a python the account cannot read stops it, with nothing stopped or changed' (-not $res.Ok -and ($res.Lines -join ' ') -match 'CANNOT SWITCH: .*installed for one person' -and ($res.Lines -join ' ') -match 'Nothing was stopped or changed' -and
        (At '^Stop-|^Unregister-|^New-Service|^sc |^Start-Service') -lt 0 -and (Test-Path -LiteralPath (Join-Path $root 'run.ps1')))
    $root = InstallBox 'install-badsource'
    $res = Install-ThornswoodBotService -Name 'ThornswoodBot' -Root $root -Python $goodPy -Source $bad -Task 'Thornswood Bot' -WatchRoot '' -DocsData '' -ServerRoots @()
    Yes 'a program that does not build stops it, with nothing stopped or changed' (-not $res.Ok -and ($res.Lines -join ' ') -match 'DID NOT BUILD\. Nothing was stopped or changed' -and ($res.Lines -join ' ') -match 'error CS' -and
        (At '^Stop-|^Unregister-|^New-Service|^sc |^Start-Service') -lt 0 -and (Test-Path -LiteralPath (Join-Path $root 'run.ps1')))
    $res = Install-ThornswoodBotService -Name 'ThornswoodBot' -Root (Join-Path $tmp 'has space') -Python $goodPy -Source $svcSrc -Task 'Thornswood Bot' -WatchRoot '' -DocsData '' -ServerRoots @()
    Yes 'a bot folder with a space in its path is refused, since the program is registered bare' (-not $res.Ok -and ($res.Lines -join ' ') -match 'space in its path')
    $script:startFails = $true
    $root = InstallBox 'install-nostart'
    $res = Install-ThornswoodBotService -Name 'ThornswoodBot' -Root $root -Python $goodPy -Source $svcSrc -Task 'Thornswood Bot' -WatchRoot '' -DocsData '' -ServerRoots @()
    Yes 'a service that will not start is said, not passed over' (-not $res.Ok -and ($res.Lines -join ' ') -match 'THE SERVICE DID NOT START: The service did not respond')
    $script:startFails = $false

    # -- -CodeOnly's restart ------------------------------------------------------------
    $script:svc = $null
    $script:calls = @()
    Yes 'with no service, the restart says so by returning nothing, and touches nothing' ($null -eq (Restart-ThornswoodBotService -Name 'ThornswoodBot' -Root $root) -and (At '^Stop-|^Start-') -lt 0)
    $script:svc = [pscustomobject]@{ Name = 'ThornswoodBot'; Status = 'Running' }
    $root = InstallBox 'restart'
    $out = @(Restart-ThornswoodBotService -Name 'ThornswoodBot' -Root $root -WatchRoot '')
    $s1 = At '^Stop-Service ThornswoodBot$'; $s2 = At '^Stop-Process 101$'; $s3 = At '^Start-Service ThornswoodBot$'
    Yes 'the restart is: stop by name, sweep for a copy started by hand, start by name' ($s1 -ge 0 -and $s2 -gt $s1 -and $s3 -gt $s2)
    Yes 'and says each' (($out -join ' ') -match 'stopped the service ThornswoodBot' -and ($out -join ' ') -match 'stopped a copy of the bot no service started, pid 101' -and ($out -join ' ') -match 'started the service ThornswoodBot')
} else {
    Write-Host 'SKIP  the grants (folder ACLs by SID) and the install (a Windows service built with the .NET Framework compiler): only Windows has them'
}
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message + ' at ' + $_.InvocationInfo.PositionMessage) $false
}
finally {
    foreach ($h in $script:hosts) {
        try { if (-not $h.P.HasExited) { $h.P.Kill() } } catch { }
        foreach ($f in 'bot.pid', 'child.pid') {
            $pf = Join-Path $h.Root $f
            if (Test-Path -LiteralPath $pf) {
                try { Microsoft.PowerShell.Management\Stop-Process -Id ([int](Get-Content -LiteralPath $pf -Raw).Trim()) -Force -EA SilentlyContinue } catch { }
            }
        }
    }
    Microsoft.PowerShell.Utility\Start-Sleep -Milliseconds 500
    Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue
    if ($script:pyOutside) { Remove-Item -LiteralPath $script:pyOutside -Recurse -Force -EA SilentlyContinue }
}

Done
