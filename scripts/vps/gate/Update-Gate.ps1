<#
  Update-Gate.ps1

  The deploy gate's Update-Gate verb (#5178): puts main's own Gate.ps1,
  GateBroker.ps1 and GateRules.ps1 in place of the installed ones and
  restarts the broker on them, with nobody on One.

      pwsh scripts/vps/Box-Run.ps1 -Line 'Update-Gate'

  WHY. The broker runs the copy of those three files Install-Gate.ps1 put
  beside it, and until this verb only Install-Gate, run on One, changed that
  copy. So a merged gate fix waited on a person at One: on 31 Oct #5166
  (the checkout's engine submodule kept at the old pin, so every verb
  refused) was merged and every release still waited for Install-Gate.
  Patrick, 31 Oct: "I want it in the cloud". The verbs' scripts already run
  from main as SYSTEM on the box (Patrick's A, 30 Oct 2026, GateBroker.ps1's
  header), so main putting its own broker in place gives main nothing it
  did not have.

  WHAT IT CHANGES, and nothing else: the three files, written into the files
  already there so each keeps its access list (Gate.ps1 stays readable by
  thornswood-deploy), gate.json's commit, which ping and Install-Gate
  -Status show, and gate.json's remote when GitHub names the repository
  differently now (THE REPOSITORY'S NAME, below), and the broker task's
  program, which is the pwsh gate.json names (#5356: a task from before
  then started the broker in Windows PowerShell). The account, the keys, the
  ssh config, the pinned GitHub CLI and the rest of the task stay as
  Install-Gate made them; a change to any of those is still Install-Gate's.

  HOW IT KEEPS THE GATE UP. A broker that does not start can only be put back
  from One, so:
    - each new file has to parse as PowerShell first, or nothing is changed;
    - the files being replaced are kept in update\prev-<stamp>;
    - the restart waits until the broker runs no verb (this one included,
      so its answer is read first) and has ended: a broker since #5178
      ends by itself after any request that changed its files on disk
      ("BROKER handing over" in gate.log), without opening the pipe again,
      so no caller reaches the old one after this verb's @END; a broker
      from before that is stopped. Then the task starts on the new files,
      and a caller's next line waits at Gate.ps1's 20 second connect until
      the new broker opens the pipe. When the new broker's "BROKER started,
      installed from <commit>" line is not in gate.log within 60 seconds,
      the kept files go back and the task is started on them again, and
      gate.log says so.
  The restart is a one-time task, "Thornswood Gate Update", started as soon
  as it is made, that removes itself. Its record is update\restart.log.
  Box-Run.ps1 -OnTheBox sends this verb by itself before any other when the
  gate's files are not main's (#5178).

  THE REPOSITORY'S NAME (#5184). gate.json's remote is the address the
  broker clones, fetches and pings, and the checkout's origin is set to it
  before every fetch; Install-DeployAgent.ps1 and Ship.ps1 read the
  repository's owner/name from that origin. Install-Gate wrote it once, so
  when the repository moved to ThornswoodRP on 1 Nov 2026 the box kept the
  old name: git followed GitHub's redirect, but the deploy agent's
  GET /repos/EvilPatrick06/Thornswood/installation answered 404 and dev took
  no Deployment. So each run asks GitHub, without a token (the repository is
  public, and GitHub's answer follows a move), what the repository is called
  now, and writes that name into the remote when it differs. A GitHub that
  does not answer leaves the remote as it is, and the run says so.

  -Root, -NoRestart and -FullName (GitHub's answer, so no network is asked)
  are for the harness (tests\test-2841-deploy-gate.ps1);
  the gate passes neither.
#>
[CmdletBinding()]
param(
    [string]$Root = 'C:\Thornswood-Gate',
    [switch]$NoRestart,
    [string]$FullName = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = (Resolve-Path -LiteralPath (Join-Path $Here '..\..\..')).ProviderPath
$Names = @('Gate.ps1', 'GateBroker.ps1', 'GateRules.ps1')
$Utf8 = New-Object Text.UTF8Encoding($false)
function Die($m) { Write-Host "STOP. $m"; exit 1 }

if (-not $NoRestart -and $env:THORNSWOOD_GATE -ne '1') { Die 'this is the gate''s own verb: it runs on the box, from the gate''s checkout. Nothing was changed.' }
$cfgPath = Join-Path $Root 'gate.json'
if (-not (Test-Path -LiteralPath $cfgPath)) { Die "$Root has no gate.json, so the gate was never installed here. Install-Gate.ps1 installs it. Nothing was changed." }

$commit = (& git -C $Repo rev-parse HEAD 2>$null)
if ($LASTEXITCODE -ne 0 -or "$commit".Trim() -notmatch '^[0-9a-f]{40}$') { Die 'git could not say which commit this checkout is. Nothing was changed.' }
$commit = "$commit".Trim()
Write-Host "  main at $commit"

# ---- each new file parses, or nothing is changed
$new = @{}
foreach ($n in $Names) {
    $src = Join-Path $Here $n
    if (-not (Test-Path -LiteralPath $src)) { Die "main has no scripts/vps/gate/$n. Nothing was changed." }
    $tokens = $null; $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($src, [ref]$tokens, [ref]$errors)
    if ($errors -and $errors.Count) { Die ("main's $n does not parse: " + $errors[0].Message + ' (line ' + $errors[0].Extent.StartLineNumber + '). Nothing was changed.') }
    $new[$n] = [IO.File]::ReadAllBytes($src)
}

function Get-Sha([byte[]]$b) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($h.ComputeHash($b)).Replace('-', '').ToLowerInvariant() } finally { $h.Dispose() }
}

$cfg = [IO.File]::ReadAllText($cfgPath) | ConvertFrom-Json

# ---- the repository's name as GitHub has it now (THE REPOSITORY'S NAME)
$remoteWas = [string]$cfg.remote
$remoteNow = $remoteWas
if ($remoteWas -match '^ssh://git@ssh\.github\.com:443/([A-Za-z0-9-]+/[A-Za-z0-9._-]+?)(?:\.git)?$') {
    $asked = $Matches[1]
    $full = $FullName
    if (-not $full) {
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $full = [string](Invoke-RestMethod -UseBasicParsing -TimeoutSec 30 -Uri ('https://api.github.com/repos/' + $asked) -Headers @{ 'User-Agent' = 'thornswood-gate'; Accept = 'application/vnd.github+json' }).full_name
        } catch { Write-Host ("  GitHub did not say what $asked is called now (" + $_.Exception.Message + "), so the gate's remote stays as it is") }
    }
    if ($full -and $full -notmatch '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$') { Write-Host "  GitHub named $asked '$full', which is not owner/name, so the gate's remote stays as it is"; $full = '' }
    if ($full -and $full -cne $asked) { $remoteNow = 'ssh://git@ssh.github.com:443/' + $full + '.git' }
    elseif ($full) { Write-Host "  the repository is $full, as GitHub names it" }
} elseif ($remoteWas) { Write-Host "  gate.json's remote ($remoteWas) is not a GitHub address over ssh port 443, so it is left as it is" }

$changed = @()
foreach ($n in $Names) {
    $at = Join-Path $Root $n
    $old = if (Test-Path -LiteralPath $at) { [IO.File]::ReadAllBytes($at) } else { [byte[]]@() }
    if ((Get-Sha $old) -ne (Get-Sha $new[$n])) { $changed += $n }
}
if (-not $changed.Count -and [string]$cfg.commit -eq $commit -and $remoteNow -ceq $remoteWas) {
    Write-Host "  ALREADY the gate's three files are main's, installed from $commit"
    exit 0
}

# Whether the broker running now ends by itself once its files change: a
# broker from before #5178 does not, and is stopped instead.
$selfExits = ([IO.File]::ReadAllText((Join-Path $Root 'GateBroker.ps1'))).Contains('BROKER handing over')

# ---- the files being replaced are kept
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$prev = Join-Path $Root ('update\prev-' + $stamp)
New-Item -ItemType Directory -Path $prev -Force | Out-Null
foreach ($n in $Names) { $at = Join-Path $Root $n; if (Test-Path -LiteralPath $at) { [IO.File]::WriteAllBytes((Join-Path $prev $n), [IO.File]::ReadAllBytes($at)) } }
[IO.File]::WriteAllBytes((Join-Path $prev 'gate.json'), [IO.File]::ReadAllBytes($cfgPath))
Write-Host "  kept the installed files in $prev"

# ---- main's files, into the files already there, so each keeps its access list
foreach ($n in $Names) {
    $at = Join-Path $Root $n
    if (Test-Path -LiteralPath $at) {
        $fs = [IO.File]::Open($at, [IO.FileMode]::Truncate, [IO.FileAccess]::Write)
        try { $fs.Write($new[$n], 0, $new[$n].Length) } finally { $fs.Dispose() }
    } else { [IO.File]::WriteAllBytes($at, $new[$n]) }
}
$was = [string]$cfg.commit
$cfg.commit = $commit
if ($remoteNow -cne $remoteWas) { $cfg.remote = $remoteNow }
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json), $Utf8)
Write-Host ("  CHANGED " + $(if ($changed.Count) { $changed -join ', ' } else { 'no file, only the record' }) + " from $commit (installed from $was before)")
if ($remoteNow -cne $remoteWas) { Write-Host "  CHANGED the gate's remote from $remoteWas to $remoteNow, the name GitHub gives the repository now; the broker sets the checkout's origin to it before its next fetch" }

if ($NoRestart) { Write-Host '  not restarted (-NoRestart)'; exit 0 }

# ---- the restart, once no verb runs, and the files back if it does not start
$updDir = Join-Path $Root 'update'
$helper = Join-Path $updDir 'restart.ps1'
$q = { param($s) "'" + $s.Replace("'", "''") + "'" }
# The broker is stopped on purpose here (it ends, or is stopped, and is
# started again), so it is held like every such stop on the box (#5155,
# ServerHold.ps1): the hold is written before this run answers, so the
# watchdog never finds the gate down between the broker ending and the
# helper starting it, and the helper takes it away once the broker has
# started, on main's files or on the ones put back.
. (Join-Path $Repo 'scripts\vps\ServerHold.ps1')
$holdScript = Get-ThornswoodHoldScript -Script 'Update-Gate.ps1'
$helperText = @"
$holdScript
`$ErrorActionPreference = 'Continue'
`$root = $(& $q $Root)
`$prev = $(& $q $prev)
`$commit = '$commit'
`$task = 'Thornswood Gate'
`$log = Join-Path `$root 'update\restart.log'
`$gateLog = Join-Path `$root 'log\gate.log'
`$utf8 = New-Object Text.UTF8Encoding(`$false)
function Note([string]`$m) { [IO.File]::AppendAllText(`$log, ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + ' ' + `$m + "`r`n"), `$utf8) }
function GateNote([string]`$m) { [IO.File]::AppendAllText(`$gateLog, ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + ' ' + `$m + "`r`n"), `$utf8) }
# The broker by what it runs, whichever PowerShell runs it: one from before
# #5356 runs in Windows PowerShell, and this run moves it to pwsh.
function Broker { @(Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%GateBroker.ps1%'" | Where-Object { `$_.ProcessId -ne `$PID }) }
# Wait, up to two hours, until the broker runs no verb: this run's own
# verb ends first, so its @END reaches the caller before anything restarts.
`$until = (Get-Date).AddHours(2)
while ((Get-Date) -lt `$until) {
  `$busy = @(foreach (`$b in Broker) { Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + `$b.ProcessId) | Where-Object { `$_.Name -ne 'conhost.exe' } })
  if (-not `$busy.Count) { break }
  Start-Sleep -Milliseconds 500
}
if (`$busy.Count) { Note ('the broker still ran a verb after two hours, so it was not restarted for ' + `$commit + '; the next Update-Gate tries again'); Note (Clear-ThornswoodHold -Target `$task); Unregister-ScheduledTask -TaskName 'Thornswood Gate Update' -Confirm:`$false; exit 1 }
`$size = if (Test-Path -LiteralPath `$gateLog) { (Get-Item -LiteralPath `$gateLog).Length } else { 0 }
# A broker since #5178 ends by itself once the request that changed its
# files has answered; one from before is stopped.
`$selfExits = `$$(if ($selfExits) { 'true' } else { 'false' })
`$gone = (Get-Date).AddSeconds(30)
if (-not `$selfExits) { Note 'the broker running predates #5178, so it is stopped'; Stop-ScheduledTask -TaskName `$task }
while ((Broker).Count -and (Get-Date) -lt `$gone) { Start-Sleep -Milliseconds 250 }
if ((Broker).Count) { Note 'the broker had not ended after 30 seconds, so it is stopped'; Stop-ScheduledTask -TaskName `$task; while ((Broker).Count -and (Get-Date) -lt `$gone.AddSeconds(30)) { Start-Sleep -Milliseconds 250 } }
# The broker runs in PowerShell 7 (#5356), the pwsh gate.json names, which
# Install-Gate found and every verb already runs in. A task Install-Gate
# made before then starts it in Windows PowerShell, so its program is set to
# that pwsh here, with the same arguments; the files going back below put
# the program it had back with them.
`$wasAction = @((Get-ScheduledTask -TaskName `$task).Actions)[0]
`$pwsh = [string](Get-Content -LiteralPath (Join-Path `$root 'gate.json') -Raw | ConvertFrom-Json).pwsh
if (`$pwsh -and (Test-Path -LiteralPath `$pwsh) -and [string]`$wasAction.Execute -ne `$pwsh) {
  Set-ScheduledTask -TaskName `$task -Action (New-ScheduledTaskAction -Execute `$pwsh -Argument `$wasAction.Arguments) | Out-Null
  Note ('the broker starts in ' + `$pwsh + ' from now on, not ' + `$wasAction.Execute)
}
Note ('starting the broker on ' + `$commit)
Start-ScheduledTask -TaskName `$task
`$ok = `$false
for (`$i = 0; `$i -lt 60 -and -not `$ok; `$i++) {
  Start-Sleep -Seconds 1
  if ((Test-Path -LiteralPath `$gateLog) -and (Get-Item -LiteralPath `$gateLog).Length -gt `$size) {
    `$fs = [IO.File]::Open(`$gateLog, 'Open', 'Read', 'ReadWrite'); `$fs.Seek(`$size, 'Begin') | Out-Null
    `$tail = (New-Object IO.StreamReader(`$fs)).ReadToEnd(); `$fs.Dispose()
    if (`$tail -match ('BROKER started, installed from ' + `$commit)) { `$ok = `$true }
  }
}
if (`$ok) { Note ('the broker started on ' + `$commit) }
else {
  Note ('the broker did not start on ' + `$commit + ' within 60 seconds: putting back the files in ' + `$prev)
  Stop-ScheduledTask -TaskName `$task
  foreach (`$n in 'Gate.ps1', 'GateBroker.ps1', 'GateRules.ps1', 'gate.json') {
    `$from = Join-Path `$prev `$n
    if (Test-Path -LiteralPath `$from) { `$b = [IO.File]::ReadAllBytes(`$from); `$fs = [IO.File]::Open((Join-Path `$root `$n), 'Truncate', 'Write'); `$fs.Write(`$b, 0, `$b.Length); `$fs.Dispose() }
  }
  Set-ScheduledTask -TaskName `$task -Action (New-ScheduledTaskAction -Execute `$wasAction.Execute -Argument `$wasAction.Arguments) | Out-Null
  Start-ScheduledTask -TaskName `$task
  GateNote ('UPDATE to ' + `$commit + ' did not start, so the files it replaced were put back from ' + `$prev)
}
Note (Clear-ThornswoodHold -Target `$task)
Unregister-ScheduledTask -TaskName 'Thornswood Gate Update' -Confirm:`$false
"@
[IO.File]::WriteAllText($helper, $helperText, $Utf8)
# The broker ends once this request has answered, because its files changed;
# without the task nothing would start it again, so a task that cannot be
# made puts the kept files back first, and the broker then goes on as it was.
Write-Host ('  ' + (Set-ThornswoodHold -Target 'Thornswood Gate' -Why ('restarting the gate broker on main ' + $commit.Substring(0, 8)) -By (Get-ThornswoodHoldBy -Script 'Update-Gate.ps1')))
try {
    $old = Get-ScheduledTask -TaskName 'Thornswood Gate Update' -ErrorAction SilentlyContinue
    if ($old) { Unregister-ScheduledTask -TaskName 'Thornswood Gate Update' -Confirm:$false }
    $action = New-ScheduledTaskAction -Execute (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $helper + '"')
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName 'Thornswood Gate Update' -Action $action -Settings $settings -Principal $principal | Out-Null
    Start-ScheduledTask -TaskName 'Thornswood Gate Update'
}
catch {
    $why = $_.Exception.Message
    foreach ($n in $Names + @('gate.json')) {
        $from = Join-Path $prev $n
        if (Test-Path -LiteralPath $from) { $b = [IO.File]::ReadAllBytes($from); $fs = [IO.File]::Open((Join-Path $Root $n), [IO.FileMode]::Truncate, [IO.FileAccess]::Write); try { $fs.Write($b, 0, $b.Length) } finally { $fs.Dispose() } }
    }
    Write-Host ('  ' + (Clear-ThornswoodHold -Target 'Thornswood Gate'))
    Die ("the restart task could not be made ($why), so the files it would have started were put back from $prev. The gate runs as it did.")
}
Write-Host '  CHANGED the broker starts on these files as soon as this run has answered'
Write-Host "  its record: $updDir\restart.log; a ping then says: installed from $commit"
exit 0
