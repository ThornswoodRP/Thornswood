<#
  test-deploy-swaps.ps1

  Deploy-DevGamemode.ps1, Deploy-Docs.ps1, Install-Voice.ps1, Install-Bot.ps1
  and Deploy-Server.ps1 -PutBack, each run whole against a scratch folder
  standing in for the VPS: nothing running is stopped or written over until the
  new copy has checked out beside it, a new copy that does not come up is put
  back automatically, and -PutBack puts the last one back.

  NIGHTLY CLOCK: 600 seconds. Every case runs a deploy script whole, each
  run 5 to 25 seconds on the VPS runner (10 to 60 on One with Defender busy),
  so the whole file does not fit the nightly's 300 s clock for one harness:
  on 12 Oct (run 38204529995) the runner was 93 checks in, every one passing,
  when 300 s ran out and it was killed (#1273). nightly.yml reads this line.

  WHY THIS EXISTS. Issue #446. Measured on 28 September: Deploy-DevGamemode
  stopped the dev server and then copied over it; Deploy-Docs, Install-Voice and
  Install-Bot copied over the running site, voice service and bot and then
  restarted them; none of them put anything back when the new one did not come
  up, and two of them said so only in a line nobody had to read. Deploy-Server
  already staged, checked and swapped (entry 209); these use its blocks, or the
  same shape for a service (scripts\deploy\Swap.ps1).

  HOW. Each script is copied into a scratch repository with stand-ins for what
  it sends (a site, a voice service and a bot that each report which version
  they are, and a game server that holds its two ports), and run by this
  PowerShell with ssh and scp replaced by functions, the way
  test-remote-big-script.ps1 replaces them. The ssh stand-in runs what it is
  sent under PowerShell 7, which is what runs it on the box, with only the
  scheduled task and firewall cmdlets replaced: a task is a file here, and
  starting it starts its real action. The scp stand-in copies into the scratch
  folder, and can be told to fail or to corrupt a file. The stops, the
  renames, the health checks and the way back are the real ones.

  For each of them it proves: a good one is swapped in and answers as the new
  version with what it replaced kept in .prev; a copy that fails, or a stage
  the box refuses (a file that arrived different, a program that does not
  parse), stops the run with the running copy untouched and the same process
  still answering; a new version that does not come up, or a swap whose rename
  fails because a file is held, is SWAP ROLLED BACK with the old files back
  and the old version answering again; and -PutBack puts the previous version
  back and keeps what it took out in .undone.

  For the bot it also proves that a box with no bot.log on it is not a failed
  swap: the log the health check reads is made in front of the start, the
  service is started, and the new code stays in, rather than being put back
  after two waits on a file nothing could write.

  And issue #1121, Patrick, 29 Sep: a deploy sends a commit or nothing. Each
  of Deploy-Docs, Install-Voice, Install-Bot, Deploy-DevGamemode,
  Deploy-Server and Publish-Server, run with a file it would send changed,
  staged, or untracked, is refused before it talks to the box, naming the
  file, with no ssh or scp run at all. And only the newest two .prev folders
  are kept, not three.

  And issue #1973: two copies run at once, by two sessions, must both pass.
  Each run's scratch tasks and bot service carry a tag of its own (Thornswood
  Test <tag> ..., ThornswoodTest<tag>Bot), so the check for a real task left
  behind looks for, stops and removes only this run's; its ports are held by a
  lock file for the whole run, so a second copy cannot pick the same ones; and
  its folders are under a scratch folder of its own, as they were.

  And issue #2113: Deploy-DevGamemode sends a gamemode only onto the server
  build its commit records (#2076), so the scratch commit holds this
  repository's records\server-build.json and the stand-in dev box holds the
  same record, as a full dev publish leaves it. Without them every dev case
  was refused at that check and none reached the swap. A dev box that holds
  another build's record is refused before anything is sent.

  Connects to nothing but 127.0.0.1.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
$scripts = [IO.Path]::GetFullPath((Join-Path $Here 'scripts'))

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Remove-Item -Path function:global:ssh, function:global:scp -ErrorAction SilentlyContinue
    Remove-Variable -Name TsBox -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable -Name TsScpFail, TsScpCorrupt, TsLastCode, TsRun, TsScpCount -Scope Global -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

# ---- read, not run ------------------------------------------------------------
foreach ($n in 'Deploy-DevGamemode.ps1', 'Deploy-Docs.ps1', 'Install-Voice.ps1', 'Install-Bot.ps1', 'Deploy-Server.ps1') {
    $t = [IO.File]::ReadAllText((Join-Path $scripts ('deploy\' + $n)))
    Yes "$n loads Swap.ps1 and takes -PutBack" ($t.Contains(". (Join-Path `$Here 'Swap.ps1')") -and $t -match '\[switch\]\$PutBack')
}

$node = Get-Command node -CommandType Application -EA SilentlyContinue | Select-Object -First 1
$python = Get-Command python -CommandType Application -EA SilentlyContinue | Select-Object -First 1
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the runs: the swaps find a server by its port with Get-NetUDPEndpoint, which only Windows has, and this is not Windows'
    Done
}
$boxPs = Get-BoxPowerShell
if (-not $node -or -not $python -or -not (Get-Command Get-NetUDPEndpoint -EA SilentlyContinue)) {
    Write-Host 'SKIP  the runs need node, python and Get-NetUDPEndpoint as well, and this machine lacks one'
    Done
}

$started = Get-Date
$work    = Join-Path ([IO.Path]::GetTempPath()) ('ts-swaps-' + [Guid]::NewGuid().ToString('N'))
$box     = Join-Path $work 'box'
$farTemp = Join-Path $box 'Windows\Temp'
$tasks   = Join-Path $work 'tasks'
$far     = Join-Path $work 'far'
$repo    = Join-Path $work 'repo'
$pidLog  = Join-Path $work 'pids.txt'
$utf8    = New-Object Text.UTF8Encoding($false)
# This run's own names for the scratch scheduled tasks and the bot service
# (#1973, #1135): every other harness and every other copy of this one uses
# names of its own, so the check for a real task left behind looks only for
# this run's, and can never stop or remove another run's.
$runTag      = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$TaskPrefix  = 'Thornswood Test ' + $runTag
$BotService  = 'ThornswoodTest' + $runTag + 'Bot'
# The site the feed scripts read, a stand-in with nothing published on it.
# Since #3324 Deploy-DevGamemode reads what the dev channel has already been
# told before it sends a note, and without this it asked thornswood.net,
# which a runner account may not reach and this harness never talks to.
$site    = Join-Path $work 'site'
$env:THORNSWOOD_TEST_SITE_DIR = $site
foreach ($d in $farTemp, $tasks, $far, $site) { $null = [IO.Directory]::CreateDirectory($d) }

function Put([string]$path, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, $utf8)
}
# Read even while a service holds it open for writing, as it does its log.
function Get([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $fs = New-Object IO.FileStream($path, 'Open', 'Read', 'ReadWrite')
    try { $r = New-Object IO.StreamReader($fs); return $r.ReadToEnd() } finally { $fs.Dispose() }
}
# What is live under a root: every file and its hash, leaving out the stage,
# the kept .prev and .undone folders, and the logs a running service writes.
function Live([string]$dir) {
    $rows = @()
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force)) {
        $rel = $f.FullName.Substring($dir.Length)
        if ($rel -match '^\\\.(stage|prev|undone)-' -or $f.Name -match '\.log(\.\d+)?$') { continue }
        $rows += ($rel + '|' + (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash)
    }
    return (($rows | Sort-Object) -join "`n")
}
function Kept([string]$dir, [string]$kind) {
    return @(Get-ChildItem -LiteralPath $dir -Directory -Force | Where-Object { $_.Name -like $kind } | Sort-Object Name | ForEach-Object { $_.FullName })
}
function Free([int]$p) {
    (-not @(Get-NetUDPEndpoint -LocalPort $p -EA SilentlyContinue).Count) -and
    (-not @(Get-NetTCPConnection -LocalPort $p -EA SilentlyContinue).Count)
}
$rand = New-Object Random
$script:taken = @()
# A port is this run's only while it holds the lock file for it, open with no
# sharing, under one folder every run on the machine uses. Two runs at once
# each check a port is free and only later bind it, so without the lock both
# could pick the same one (#1973). A run that dies lets go of its locks with
# its handles, so a file left behind takes nothing.
$portLocks = Join-Path ([IO.Path]::GetTempPath()) 'ts-port-locks'
$null = [IO.Directory]::CreateDirectory($portLocks)
$script:portHeld = New-Object Collections.Generic.List[IO.FileStream]
function HoldPort([int]$p) {
    try { $script:portHeld.Add([IO.File]::Open((Join-Path $portLocks ([string]$p)), 'OpenOrCreate', 'ReadWrite', 'None')); return $true }
    catch { return $false }
}
function PickPort {
    do {
        $p = $rand.Next(41000, 48000)
        $ok = $false
        if ((Free $p) -and (Free ($p + 1)) -and $script:taken -notcontains $p -and $script:taken -notcontains ($p + 1)) {
            if (HoldPort $p) { if (HoldPort ($p + 1)) { $ok = $true } }
        }
    } until ($ok)
    $script:taken += $p, ($p + 1)
    return $p
}
function Http([int]$port, [string]$path) {
    # WebClient rather than Invoke-WebRequest, which hands back bytes, not
    # text, for an answer with no content type, as the stand-ins give.
    $c = New-Object Net.WebClient
    try { return $c.DownloadString('http://127.0.0.1:' + $port + $path) } catch { return '' } finally { $c.Dispose() }
}
function Listener([int]$port) {
    $l = @(Get-NetTCPConnection -LocalPort $port -State Listen -EA SilentlyContinue)
    if ($l.Count) { return [int]$l[0].OwningProcess }
    return 0
}
function UdpOwner([int]$port) {
    $e = @(Get-NetUDPEndpoint -LocalPort $port -EA SilentlyContinue)
    if ($e.Count) { return [int]$e[0].OwningProcess }
    return 0
}
function WaitFor([scriptblock]$cond) {
    for ($i = 0; $i -lt 60; $i++) { if (& $cond) { return $true }; Start-Sleep -Milliseconds 250 }
    return $false
}
# Asked by the names this run uses, one by one, never by 'Thornswood Test*'
# (#2461). Until then it listed every 'Thornswood Test*' task and asked for
# the bot service by 'ThornswoodTest*Bot*'; with SilentlyContinue a concurrent
# register/remove can make the wildcard listing throw and look empty, so a
# task this run left behind is missed. Exact names never failed that way
# (same measurement as #2323 / the #2383 fix in test-install-server.ps1).
# Deploy scripts register only the -Task / -TaskName / -Service they are
# given, so these are every name a stand-in that did not take could leave.
$script:ownTasks = @('Docs', 'Voice', 'Dev Server', 'Live Server') | ForEach-Object { $TaskPrefix + ' ' + $_ }
function NoRealTask {
    # The task folder on disk, when this account can read it, because asking
    # the scheduler takes seconds and this is asked after every far call.
    $folder = Get-WindowsPath 'System32\Tasks'
    $readable = $false
    try { $null = [IO.Directory]::GetFiles($folder, 'x'); $readable = $true } catch { }
    if ($readable -and -not (Test-Path -Path (Join-Path $folder ($TaskPrefix + '*')))) { return $true }
    # Exact service name - no wildcard Get-Service (#2461 / #2383).
    if ($null -ne (Get-Service -Name $BotService -ErrorAction SilentlyContinue)) { return $false }
    $mine = 0
    foreach ($n in $script:ownTasks) {
        if ($null -eq (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue)) { continue }
        $mine++
        Stop-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue
    }
    return ($mine -eq 0)
}

# The task scheduler and the firewall, for the far side; the same stand-ins
# tests\test-install-server.ps1 uses. The task module is loaded before the
# stand-ins are made, because loaded by its first use (New-ScheduledTaskAction)
# part way through a script it hides them, and the real ones then run. The
# firewall stand-ins need no such care: every firewall command used is one.
$prelude = @'
Import-Module ScheduledTasks -ErrorAction SilentlyContinue
if (-not (Get-Module ScheduledTasks)) { 'THE TASK MODULE DID NOT LOAD, SO THE STAND-INS CANNOT BE TRUSTED'; exit 98 }
# And every command of it the scripts use is a stand-in too, so nothing in
# them can load it again part way through and bring the real ones back.
function New-ScheduledTaskAction { [CmdletBinding()] param([string]$Execute, [string]$Argument, [string]$WorkingDirectory) [pscustomobject]@{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory } }
function New-ScheduledTaskTrigger { [CmdletBinding()] param([switch]$AtStartup, [switch]$Once, $At, $RepetitionInterval) [pscustomobject]@{ AtStartup = [bool]$AtStartup } }
function New-ScheduledTaskSettingsSet { [CmdletBinding()] param([switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries, [switch]$StartWhenAvailable, $RestartCount, $RestartInterval, $ExecutionTimeLimit, $Priority) [pscustomobject]@{ RestartCount = $RestartCount; ExecutionTimeLimit = 'PT0S'; Priority = $Priority } }
function New-ScheduledTaskPrincipal { [CmdletBinding()] param([string]$UserId, $LogonType, $RunLevel, $RequiredPrivilege, $ProcessTokenSidType) [pscustomobject]@{ UserId = $UserId; RunLevel = [string]$RunLevel } }
$env:TS_PIDLOG = '@@PIDLOG@@'
$TsTasks = '@@TASKS@@'
function TsTaskFile([string]$n) { Join-Path $TsTasks (($n -replace '[^A-Za-z0-9]', '_') + '.json') }
function TsRead([string]$n) { $f = TsTaskFile $n; if (Test-Path -LiteralPath $f) { return ([IO.File]::ReadAllText($f) | ConvertFrom-Json) }; return $null }
function TsWrite([string]$n, $t) { [IO.File]::WriteAllText((TsTaskFile $n), ($t | ConvertTo-Json -Depth 4)) }
function Get-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName)
  $t = TsRead $TaskName
  if (-not $t) { return }
  [pscustomobject]@{ TaskName = $TaskName; State = 'Ready'
    Actions = @([pscustomobject]@{ Execute = $t.Execute; Arguments = $t.Argument; WorkingDirectory = $t.WorkingDirectory })
    Principal = [pscustomobject]@{ UserId = 'SYSTEM'; RunLevel = 'Highest' }; Settings = $null }
}
function Register-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName, $Action, $Trigger, $Settings, $Principal, [string]$Xml, [string]$User, [string]$RunLevel)
  $t = [ordered]@{ Execute = ''; Argument = ''; WorkingDirectory = ''; Pid = 0 }
  if ($Xml) {
    $x = [xml]$Xml
    $e = $x.Task.Actions.Exec
    $t.Execute = [string]$e.Command; $t.Argument = [string]$e.Arguments; $t.WorkingDirectory = [string]$e.WorkingDirectory
  } else {
    $a = @($Action)[0]
    $t.Execute = [string]$a.Execute; $t.Argument = [string]$a.Arguments; $t.WorkingDirectory = [string]$a.WorkingDirectory
  }
  TsWrite $TaskName $t
}
function Set-ScheduledTask {
  [CmdletBinding()] param([Parameter(ValueFromPipeline = $true)]$InputObject)
  process {
    $t = TsRead $InputObject.TaskName
    $a = @($InputObject.Actions)[0]
    $n = [ordered]@{ Execute = [string]$a.Execute; Argument = [string]$a.Arguments; WorkingDirectory = [string]$a.WorkingDirectory; Pid = 0 }
    if ($t) { $n.Pid = $t.Pid }
    TsWrite $InputObject.TaskName $n
  }
}
function Unregister-ScheduledTask {
  [CmdletBinding(SupportsShouldProcess = $true)] param([string]$TaskName)
  Remove-Item -LiteralPath (TsTaskFile $TaskName) -Force -EA SilentlyContinue
}
function Export-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName)
  $t = TsRead $TaskName
  if (-not $t) { return }
  $x = New-Object xml
  $task = $x.AppendChild($x.CreateElement('Task'))
  $exec = $task.AppendChild($x.CreateElement('Actions')).AppendChild($x.CreateElement('Exec'))
  foreach ($k in @(@('Command', $t.Execute), @('Arguments', $t.Argument), @('WorkingDirectory', $t.WorkingDirectory))) {
    $null = $exec.AppendChild($x.CreateElement($k[0])).AppendChild($x.CreateTextNode([string]$k[1]))
  }
  $x.OuterXml
}
function Start-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName)
  $t = TsRead $TaskName
  if (-not $t) { return }
  $p = Start-Process -FilePath $t.Execute -ArgumentList $t.Argument -WorkingDirectory $t.WorkingDirectory -WindowStyle Hidden -PassThru
  [IO.File]::AppendAllText($env:TS_PIDLOG, [string]$p.Id + "`n")
  $n = [ordered]@{ Execute = $t.Execute; Argument = $t.Argument; WorkingDirectory = $t.WorkingDirectory; Pid = $p.Id }
  TsWrite $TaskName $n
}
function Stop-ScheduledTask {
  [CmdletBinding()] param([string]$TaskName)
  $t = TsRead $TaskName
  if ($t -and $t.Pid) { Stop-Process -Id ([int]$t.Pid) -Force -EA SilentlyContinue }
}
function Get-ScheduledTaskInfo { [CmdletBinding()] param([Parameter(ValueFromPipeline = $true)]$InputObject) process { [pscustomobject]@{ LastTaskResult = 0 } } }
function Get-NetFirewallRule { }
function New-NetFirewallRule { }
function Remove-NetFirewallRule { }
function icacls { $global:LASTEXITCODE = 0 }
# The bot's Windows service (issue #465), kept in the same book as the tasks:
# a service is an entry whose action is what the service runs. Only names the
# book holds exist; nothing here reaches a real service.
function Get-Service {
  [CmdletBinding()] param([string]$Name)
  $t = TsRead $Name
  if (-not $t) { return }
  $up = $false
  if ($t.Pid) { $up = [bool](Get-Process -Id ([int]$t.Pid) -EA SilentlyContinue) }
  [pscustomobject]@{ Name = $Name; Status = $(if ($up) { 'Running' } else { 'Stopped' }) }
}
function Stop-Service { [CmdletBinding()] param([string]$Name, [switch]$Force) if (-not (TsRead $Name)) { throw ('no service ' + $Name) }; Stop-ScheduledTask -TaskName $Name }
function Start-Service { [CmdletBinding()] param([string]$Name) if (-not (TsRead $Name)) { throw ('no service ' + $Name) }; Start-ScheduledTask -TaskName $Name }
foreach ($n in 'Get-ScheduledTask', 'Register-ScheduledTask', 'Start-ScheduledTask', 'Stop-ScheduledTask',
               'Unregister-ScheduledTask', 'Set-ScheduledTask', 'Export-ScheduledTask', 'New-NetFirewallRule',
               'New-ScheduledTaskAction', 'New-ScheduledTaskTrigger', 'New-ScheduledTaskSettingsSet', 'New-ScheduledTaskPrincipal',
               'Get-Service', 'Stop-Service', 'Start-Service') {
  $c = Get-Command $n
  if ($c.CommandType -ne 'Function' -or $c.Source) { 'THE STAND-IN FOR ' + $n + ' IS NOT THE ONE FOUND'; exit 97 }
}

'@
$prelude = $prelude.Replace('@@PIDLOG@@', $pidLog.Replace("'", "''")).Replace('@@TASKS@@', $tasks.Replace("'", "''"))

# Everything the stand-ins below read is in $global:TsBox, not in a variable
# of this script: they run inside the script under test, and PowerShell
# finds that script's own variables first (its Remote has a $far of its own).
$global:TsBox = [pscustomobject]@{ Far = $far; Prelude = $prelude; Work = $work; BoxPs = $boxPs; Box = $box; FarTemp = $farTemp }
function RunWrapped([string]$body) {
    $f = Join-Path $global:TsBox.Far ('far-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, ($global:TsBox.Prelude + $body), (New-Object Text.UTF8Encoding($true)))
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Push-Location -LiteralPath $global:TsBox.Work
    try { $out = @(& $global:TsBox.BoxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $f 2>&1 | ForEach-Object { "$_".TrimEnd() }) }
    finally { Pop-Location; $ErrorActionPreference = $eap }
    $global:TsLastCode = $LASTEXITCODE
    if (-not (NoRealTask)) { throw 'a real scheduled task was registered, and has been removed' }
    return $out
}

# ssh: the shapes the Remote helpers send. A script inline as
# -EncodedCommand, a long one by scp to a copy in C:/Windows/Temp that
# Send-Script.ps1's runner takes off and runs (#3059), and a file run with
# -File.
# And the deploy store Artifact.ps1 keeps on the box (issue #459).
function MapTemp([string]$s) {
    $store = Join-Path $global:TsBox.Box 'Thornswood-Deploys'
    return $s.Replace('C:/Windows/Temp/', ($global:TsBox.FarTemp + '\')).Replace('C:\Windows\Temp\', ($global:TsBox.FarTemp + '\')).
              Replace('C:/Thornswood-Deploys', $store.Replace('\', '/')).Replace('C:\Thornswood-Deploys', $store)
}
function global:ssh {
    $in = @($input)
    $all = @($args | ForEach-Object { [string]$_ })
    $cmd = $all[-1]
    $body = ''
    $m = [regex]::Match($cmd, 'EncodedCommand\s+(\S+)')
    if ($m.Success) {
        $body = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))
        # A long script goes by scp to a copy of its own, which
        # Send-Script.ps1's runner takes off the box and runs, so it is read
        # from there and taken off the same way.
        $r = [regex]::Match($body, "^\`$ThornswoodRunFile = '(C:\\Windows\\Temp\\thornswood-remote-[0-9a-f]{32}\.ps1)'")
        if ($r.Success) { $copy = MapTemp $r.Groups[1].Value; $body = [IO.File]::ReadAllText($copy); Remove-Item -LiteralPath $copy -Force }
        $body = MapTemp $body
    }
    else {
        $m = [regex]::Match($cmd, '-File\s+(\S+)\s*$')
        # The file's own text, with the box's fixed places mapped too.
        if ($m.Success) { $body = MapTemp ([IO.File]::ReadAllText((MapTemp $m.Groups[1].Value))) }
        else {
            $m = [regex]::Match($cmd, '-Command\s+(.*)$')
            if ($m.Success) { $body = MapTemp $m.Groups[1].Value }
        }
    }
    [void]$global:TsRun.Add($body)
    $out = RunWrapped $body
    foreach ($l in $out) { $l }
    $global:LASTEXITCODE = $global:TsLastCode
}
# scp: into the scratch box, failing like the real one when the folder is not
# there, and failing or arriving different when a test asks it to. Counted
# are the files sent, not a long script's own copy, which its runner takes
# off before it runs (Send-Script.ps1, #3059).
function global:scp {
    $all = @($args | ForEach-Object { [string]$_ })
    $src = $all[-2]; $dst = $all[-1]
    if ($dst -notmatch ':C:/Windows/Temp/thornswood-remote-[0-9a-f]{32}\.ps1$') { $global:TsScpCount++ }
    $m = [regex]::Match($dst, '^[^@\s]+@[^:\s]+:(.+)$')
    $global:LASTEXITCODE = 1
    if (-not $m.Success) { return }
    $to = MapTemp $m.Groups[1].Value
    if ($global:TsScpFail -and $to -match $global:TsScpFail) { return }
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $to))) { return }
    Copy-Item -LiteralPath $src -Destination $to -Force
    if ($global:TsScpCorrupt -and $to -match $global:TsScpCorrupt) { [IO.File]::AppendAllText($to, ' ') }
    $global:LASTEXITCODE = 0
}
$global:TsRun = New-Object Collections.Generic.List[string]
$global:TsScpCount = 0
Yes 'ssh and scp are the stand-ins here, so nothing can reach a server' (
    (Get-Command ssh).CommandType -eq 'Function' -and (Get-Command scp).CommandType -eq 'Function')

# Runs one of the scripts, from the scratch repository, and says how it ended.
# What the case wrote into the scratch repository is committed first, because
# a deploy sends a commit or nothing (#1121); -Dirty leaves it uncommitted,
# for the cases that prove the refusal. A name with a folder in it is under
# scripts\, the rest under scripts\deploy\.
function Commit {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & git -C $repo add -A 2>&1 | Out-Null
        & git -C $repo -c user.name=harness -c user.email=harness@invalid -c commit.gpgsign=false commit -q -m step 2>&1 | Out-Null
    } finally { $ErrorActionPreference = $eap }
}
function Deploy([string]$name, [hashtable]$a, [switch]$Dirty) {
    if (-not $Dirty) { Commit }
    $global:TsScpFail = ''
    $global:TsScpCorrupt = ''
    if ($a.ContainsKey('ScpFail')) { $global:TsScpFail = $a['ScpFail']; $a.Remove('ScpFail') }
    if ($a.ContainsKey('Corrupt')) { $global:TsScpCorrupt = $a['Corrupt']; $a.Remove('Corrupt') }
    $global:LASTEXITCODE = 0
    $threw = ''
    # Kept line by line, so what a script said before it threw is not lost
    # with the assignment the throw cuts short.
    $said = New-Object Collections.Generic.List[string]
    $script = Join-Path $repo ('scripts\deploy\' + $name)
    if ($name.Contains('\')) { $script = Join-Path $repo ('scripts\' + $name) }
    try { & $script @a *>&1 | ForEach-Object { [void]$said.Add("$_") } }
    catch { $threw = $_.Exception.Message }
    $global:TsScpFail = ''
    $global:TsScpCorrupt = ''
    $script:lastSaid = @($said) + @($threw)
    $ok = (-not $threw) -and ($global:LASTEXITCODE -eq 0)
    return [pscustomobject]@{ Ok = $ok; Said = ($script:lastSaid -join "`n"); Threw = $threw }
}
function Show { foreach ($l in $script:lastSaid) { Write-Host ('        ' + $l) } }

# ---- the scratch repository ---------------------------------------------------
Copy-Item -LiteralPath $scripts -Destination (Join-Path $repo 'scripts') -Recurse
# Where.ps1 reads the layout from the repository's root; the artifacts go
# under the out folder it names, inside the scratch repository.
Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $scripts) 'layout.json') -Destination (Join-Path $repo 'layout.json')
# Every commit holds records\server-build.json, the server build its gamemode
# is written for, and Deploy-DevGamemode sends a gamemode only onto a dev
# server that runs that build (#2076). This repository's record, so the
# scratch commit holds one as a real one does; the stand-in dev box gets the
# same record below, as Publish-Server -Channel dev leaves it (#2113).
$serverRecord = Join-Path (Split-Path -Parent $scripts) 'records\server-build.json'
$null = [IO.Directory]::CreateDirectory((Join-Path $repo 'records'))
Copy-Item -LiteralPath $serverRecord -Destination (Join-Path $repo 'records\server-build.json')
Put (Join-Path $repo 'scripts\vps\vps.json') '{ "address": "127.0.0.1" }'
# The artifacts are built under out\, which is ignored, as it is in the repository.
Put (Join-Path $repo '.gitignore') "out/`n"

$siteJs = @'
const http = require('http'), fs = require('fs'), path = require('path');
const VERSION = '@@V@@';
try { fs.appendFileSync(process.env.TS_PIDLOG, process.pid + '\n'); } catch (e) { }
if (VERSION.indexOf('will-not-start') >= 0) { console.error('this site will not start'); process.exit(1); }
const port = Number(fs.readFileSync(path.join(__dirname, 'port.txt'), 'utf8'));
http.createServer(function (q, r) { r.end(VERSION); }).listen(port, '127.0.0.1');
setTimeout(function () { process.exit(0); }, 600000);
'@
$voiceJs = @'
const http = require('http'), fs = require('fs');
const BUILD = '@@V@@';
try { fs.appendFileSync(process.env.TS_PIDLOG, process.pid + '\n'); } catch (e) { }
if (BUILD.indexOf('will-not-start') >= 0) { console.error('this voice will not start'); process.exit(1); }
const port = Number(process.env.THORNSWOOD_VOICE_PORT);
http.createServer(function (q, r) {
  if (q.url === '/health') { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ build: BUILD, bind: process.env.THORNSWOOD_VOICE_BIND, auth: process.env.THORNSWOOD_VOICE_AUTH, chatRange: 0, turn: '' })); return; }
  r.end('voice');
}).listen(port, '127.0.0.1');
setTimeout(function () { process.exit(0); }, 600000);
'@
$botPy = @'
import os, sys, time
VERSION = '@@V@@'
try:
    open(os.environ.get('TS_PIDLOG', 'nul'), 'a').write(str(os.getpid()) + '\n')
except Exception:
    pass
if 'will-not-start' in VERSION:
    raise SystemExit('this bot will not start')
print('[thornswood-bot] ' + VERSION + ' watching 1 server', flush=True)
t0 = time.time()
while time.time() - t0 < 600:
    time.sleep(1)
'@
# The game server, for the dev deploy and Deploy-Server -PutBack: the stub
# tests\test-deploy-server-swap.ps1 uses, given its root on the command line.
$gameJs = @'
const fs = require('fs'), path = require('path'), dgram = require('dgram'), net = require('net');
const root = process.argv[2];
try { fs.appendFileSync(process.env.TS_PIDLOG, process.pid + '\n'); } catch (e) { }
const gm = fs.readFileSync(path.join(root, 'gamemode.js'), 'utf8');
if (gm.indexOf('will-not-start') >= 0) { fs.appendFileSync(path.join(root, 'server.log'), 'Error: this gamemode will not start\n'); process.exit(1); }
const s = JSON.parse(fs.readFileSync(path.join(root, 'server-settings.json'), 'utf8'));
dgram.createSocket('udp4').bind(s.port, '127.0.0.1');
net.createServer(function (c) { c.end(); }).listen(s.port === 7777 ? 3000 : s.port + 1, '127.0.0.1');
setTimeout(function () { process.exit(0); }, 600000);
'@
$gameStub = Join-Path $work 'game-stub.js'
Put $gameStub $gameJs
function Site([string]$v) { Put (Join-Path $repo 'site\server.js') $siteJs.Replace('@@V@@', $v) }
function Voice([string]$v) { Put (Join-Path $repo 'voice\voice-server.js') $voiceJs.Replace('@@V@@', $v) }
function Bot([string]$v) { Put (Join-Path $repo 'bot\bot.py') $botPy.Replace('@@V@@', $v) }
Put (Join-Path $repo 'site\public\home.html') 'home one'
Put (Join-Path $repo 'site\public\robots.txt') 'robots'
Put (Join-Path $repo 'site\data\help.md') 'help'
Put (Join-Path $repo 'site\data\site\about.md') 'about'
Put (Join-Path $repo 'voice\headlines.js') "module.exports = {};`n"
Put (Join-Path $repo 'bot\card.py') 'CARD = 1'
# Install-Bot packs and sends _pyguard.py beside bot.py since #2421 (Refs #2276).
Put (Join-Path $repo 'bot\_pyguard.py') 'PYGUARD = 1'
# And trust.py, the roots it trusts, since #3111.
Put (Join-Path $repo 'bot\trust.py') 'TRUST = 1'
Put (Join-Path $repo 'bot\requirements.txt') ''
Put (Join-Path $repo 'bot\factions.json') '[]'
Put (Join-Path $repo 'bot\staff-channel.txt') '0'
Put (Join-Path $repo 'bot\assets\join-card.png') 'not really a picture'
Put (Join-Path $repo 'game\gamemode.js') '// the committed gamemode'
# And its tables (#5191), which the gamemode artifact carries with it.
Put (Join-Path $repo 'game\gamemode-tables\WAY_OUT.json') '{}'
Site 'docs v0'
Voice 'voice-v0'
Bot 'bot v0'
# The deploys build their artifact out of git (Artifact.ps1, issue #459), so the
# scratch repository is one, committed once, and every version a case writes
# after that is committed by Deploy before the deploy runs.
$eap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    & git -C $repo init -q 2>&1 | Out-Null
    & git -C $repo add -A 2>&1 | Out-Null
    & git -C $repo -c user.name=harness -c user.email=harness@invalid -c commit.gpgsign=false commit -q -m scratch 2>&1 | Out-Null
} finally { $ErrorActionPreference = $eap }
$store = Join-Path $box 'Thornswood-Deploys'
function Current([string]$part) {
    $f = Join-Path $store ('current\' + $part + '.json')
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    return ([IO.File]::ReadAllText($f) | ConvertFrom-Json)
}

# A task written into the stand-in scheduler's book, and started.
function Task([string]$name, [string]$exe, [string]$arg, [string]$wd) {
    $t = [ordered]@{ Execute = $exe; Argument = $arg; WorkingDirectory = $wd; Pid = 0 }
    [IO.File]::WriteAllText((Join-Path $tasks (($name -replace '[^A-Za-z0-9]', '_') + '.json')), ($t | ConvertTo-Json))
    $null = RunWrapped ("Start-ScheduledTask -TaskName '" + $name + "'`r`n")
}
function TaskArg([string]$name) {
    $f = Join-Path $tasks (($name -replace '[^A-Za-z0-9]', '_') + '.json')
    if (-not (Test-Path -LiteralPath $f)) { return '' }
    return [string]([IO.File]::ReadAllText($f) | ConvertFrom-Json).Argument
}

try {
    # ============================================ uncommitted is refused (#1121)
    # Each deploy, with one file it would send left uncommitted: changed,
    # staged, new, or one of the files it sends beside its artifact. It must
    # stop before the first ssh or scp, name the file, and leave the box as it
    # was. Run before anything is set up on the box, so "as it was" is empty.
    $docsRoot = Join-Path $box 'Thornswood-Docs'
    $docsPort = PickPort
    Put (Join-Path $docsRoot 'port.txt') ([string]$docsPort)
    $docs = @{ Vps = '127.0.0.1'; User = 'nobody'; Root = $docsRoot; Task = ($TaskPrefix + ' Docs'); Port = $docsPort; Wait = 10 }
    $null = [IO.Directory]::CreateDirectory((Join-Path $work 'dist'))
    function Git-Scratch { $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & git -C $repo @args 2>&1 | Out-Null } finally { $ErrorActionPreference = $eap } }
    $refusals = @(
        @{ Name = 'Deploy-Docs.ps1'; File = 'site/public/home.html'; How = 'changed'
           Args = $docs.Clone() },
        @{ Name = 'Install-Voice.ps1'; File = 'voice/headlines.js'; How = 'changed'
           Args = @{ VpsHost = '127.0.0.1'; VpsUser = 'nobody'; Root = (Join-Path $box 'Thornswood-Voice'); Port = (PickPort); Site = ''; Bind = '0.0.0.0'
                     ChatRange = 'off'; TurnUrl = ''; TaskName = ($TaskPrefix + ' Voice'); NoPause = $true; Wait = 10 } },
        @{ Name = 'Install-Voice.ps1'; File = 'scripts/vps/Server-Log.js'; How = 'changed'
           Args = @{ VpsHost = '127.0.0.1'; VpsUser = 'nobody'; Root = (Join-Path $box 'Thornswood-Voice'); Port = (PickPort); Site = ''; Bind = '0.0.0.0'
                     ChatRange = 'off'; TurnUrl = ''; TaskName = ($TaskPrefix + ' Voice'); NoPause = $true; Wait = 10 } },
        @{ Name = 'Install-Bot.ps1'; File = 'bot/card.py'; How = 'staged'
           Args = @{ Vps = '127.0.0.1'; User = 'nobody'; Root = (Join-Path $box 'Thornswood-Bot'); Service = $BotService; CodeOnly = $true; NoPause = $true; Wait = 20 } },
        @{ Name = 'Deploy-DevGamemode.ps1'; File = 'game/gamemode.js'; How = 'changed'
           Args = @{ Vps = '127.0.0.1'; User = 'nobody'; Root = (Join-Path $box 'Thornswood-Server-Dev'); Task = ($TaskPrefix + ' Dev Server'); Dist = (Join-Path $work 'dist'); Wait = 10; Now = $true
                     Note = "The gamemode deploy note test`n- This line is long enough for the shape check to pass." } },
        @{ Name = 'Deploy-Server.ps1'; File = 'game/content/Thornswood-Content.esp'; How = 'new'
           Args = @{ Vps = '127.0.0.1'; User = 'nobody'; Root = (Join-Path $box 'Thornswood-Server'); Task = ($TaskPrefix + ' Live Server'); Dist = (Join-Path $work 'dist'); Wait = 10 } },
        @{ Name = 'release\Publish-Server.ps1'; File = 'game/gamemode.js'; How = 'changed'
           Args = @{ Channel = 'dev'; VpsHost = '127.0.0.1'; VpsUser = 'nobody'; VpsRoot = (Join-Path $box 'Thornswood-Server-Dev'); TaskName = ($TaskPrefix + ' Dev Server')
                     Dist = (Join-Path $work 'dist'); Zip = (Join-Path $work 'payload.zip'); SkipBuild = $true; NoPause = $true; Wait = 8 } },
        @{ Name = 'release\Publish-Server.ps1'; File = 'scripts/deploy/Install-ThornswoodServer.ps1'; How = 'changed'
           Args = @{ Channel = 'dev'; VpsHost = '127.0.0.1'; VpsUser = 'nobody'; VpsRoot = (Join-Path $box 'Thornswood-Server-Dev'); TaskName = ($TaskPrefix + ' Dev Server')
                     Dist = (Join-Path $work 'dist'); Zip = (Join-Path $work 'payload.zip'); SkipBuild = $true; NoPause = $true; Wait = 8; PutBack = $true } }
    )
    foreach ($c in $refusals) {
        $at = Join-Path $repo ($c.File.Replace('/', '\'))
        $had = $null
        if (Test-Path -LiteralPath $at) { $had = [IO.File]::ReadAllBytes($at) }
        Put $at ('an uncommitted change to ' + $c.File + "`n")
        if ($c.How -eq 'staged') { Git-Scratch add -- $c.File }
        $boxBefore = @(Get-ChildItem -LiteralPath $box -Recurse -Force -EA SilentlyContinue | ForEach-Object { $_.FullName }) -join "`n"
        $sshBefore = $global:TsRun.Count
        $scpBefore = $global:TsScpCount
        $r = Deploy $c.Name $c.Args.Clone() -Dirty
        $failed = $script:fail
        $label = (Split-Path -Leaf $c.Name) + $(if ($c.Args.ContainsKey('PutBack')) { ' -PutBack' } else { '' })
        Yes ($label + ': a ' + $c.How + ' ' + $c.File + ' refuses the deploy, naming the file') (
            (-not $r.Ok) -and $r.Said -match 'Refused' -and $r.Said -match 'not committed' -and $r.Said.Contains($c.File))
        Yes '  before it talks to the box: no ssh, no scp, nothing on the box changed' (
            $global:TsRun.Count -eq $sshBefore -and $global:TsScpCount -eq $scpBefore -and
            (@(Get-ChildItem -LiteralPath $box -Recurse -Force -EA SilentlyContinue | ForEach-Object { $_.FullName }) -join "`n") -eq $boxBefore)
        if ($script:fail -gt $failed) { Show }
        if ($c.How -eq 'staged') { Git-Scratch reset -q -- $c.File }
        if ($null -ne $had) { [IO.File]::WriteAllBytes($at, $had) } else { Remove-Item -LiteralPath $at -Force }
    }
    Yes 'and with the files put back the scratch repository is clean again' (
        -not ((& git -C $repo status --porcelain 2>$null) | Where-Object { $_ }))
    Yes 'no deploy script takes a switch past the refusal, and Deploy-DevGamemode no longer takes -Gamemode' (
        -not (@('Deploy-Docs.ps1', 'Install-Voice.ps1', 'Install-Bot.ps1', 'Deploy-DevGamemode.ps1', 'Deploy-Server.ps1') | ForEach-Object {
            (Get-Command (Join-Path $repo ('scripts\deploy\' + $_))).Parameters.Keys } |
            Where-Object { $_ -match '^(Gamemode|Force|AllowDirty|Dirty|Edited|AllowEdits|Uncommitted)$' }) -and
        -not ((Get-Command (Join-Path $repo 'scripts\release\Publish-Server.ps1')).Parameters.Keys | Where-Object { $_ -match '^(Force|AllowDirty|Dirty|Edited|AllowEdits|Uncommitted)$' }))

    # =========================================================== the site

    Site 'docs v1'
    $r = Deploy 'Deploy-Docs.ps1' $docs.Clone()
    $failed = $script:fail
    Yes 'Deploy-Docs: a first deploy is swapped in and the site answers' ($r.Ok -and (WaitFor { (Http $docsPort '/') -eq 'docs v1' }))
    if ($script:fail -gt $failed) { Show }

    Site 'docs v2'
    Put (Join-Path $repo 'site\public\home.html') 'home two'
    $pidBefore = Listener $docsPort
    $r = Deploy 'Deploy-Docs.ps1' $docs.Clone()
    $failed = $script:fail
    Yes 'Deploy-Docs: a good deploy is SWAP OK and the new site answers' ($r.Ok -and $r.Said -match 'SWAP OK' -and (WaitFor { (Http $docsPort '/') -eq 'docs v2' }))
    $prev = @(Kept $docsRoot '.prev-*')
    Yes '  and what it replaced is kept in .prev: the old server.js and the page that changed, not the one that did not' (
        $prev.Count -eq 1 -and (Get (Join-Path $prev[0] 'server.js')) -match 'docs v1' -and
        (Get (Join-Path $prev[0] 'public\home.html')) -eq 'home one' -and -not (Test-Path -LiteralPath (Join-Path $prev[0] 'public\robots.txt')))
    Yes '  and it is a new process' ((Listener $docsPort) -ne $pidBefore)
    # Only with the one .prev there: a run that failed left none, and indexing
    # it would end every case after this one (#1273).
    $v1rec = $(if ($prev.Count -eq 1) { Get (Join-Path $prev[0] 'thornswood-deploy.json') })
    $v2rec = Get (Join-Path $docsRoot 'thornswood-deploy.json')
    Yes '  and the box records the new artifact, beside the site and in the store' (
        $v2rec -and (Current 'thornswood-docs') -and (Current 'thornswood-docs').name -like 'site-*' -and
        ($v2rec | ConvertFrom-Json).name -eq (Current 'thornswood-docs').name)
    Yes '  and the record the site had is kept in .prev with the files it describes' ($v1rec -and $v1rec -ne $v2rec)
    if ($script:fail -gt $failed) { Show }

    $live = Live $docsRoot
    $pidBefore = Listener $docsPort
    foreach ($case in @(
        @{ Label = 'a server.js that does not parse'; Site = 'function ( { not javascript'; Extra = @{}; Why = 'server\.js does not parse' },
        @{ Label = 'a server.js that arrived different'; Site = 'docs v3'; Extra = @{ Corrupt = 'server\.js$' }; Why = 'arrived different from what was sent: server\.js' },
        @{ Label = 'a copy that fails'; Site = 'docs v3'; Extra = @{ ScpFail = 'server\.js$' }; Why = 'scp failed' }
    )) {
        if ($case.Site -like 'function*') { Put (Join-Path $repo 'site\server.js') $case.Site } else { Site $case.Site }
        $a = $docs.Clone(); foreach ($k in $case.Extra.Keys) { $a[$k] = $case.Extra[$k] }
        $r = Deploy 'Deploy-Docs.ps1' $a
        $failed = $script:fail
        Yes ("Deploy-Docs: " + $case.Label + ' stops the deploy, saying why') ((-not $r.Ok) -and $r.Said -match $case.Why)
        Yes '  and the running site is untouched, the same process answering the same version' (
            ((Live $docsRoot) -eq $live) -and ((Listener $docsPort) -eq $pidBefore) -and ((Http $docsPort '/') -eq 'docs v2'))
        if ($script:fail -gt $failed) { Show }
    }

    Site 'docs v4, will-not-start'
    $r = Deploy 'Deploy-Docs.ps1' $docs.Clone()
    $failed = $script:fail
    Yes 'Deploy-Docs: a site that does not start is SWAP ROLLED BACK, and the deploy fails' ((-not $r.Ok) -and $r.Said -match 'SWAP ROLLED BACK')
    Yes '  and says why' ($r.Said -match 'this site will not start')
    Yes '  and the old files are back and the old version answers again' (((Live $docsRoot) -eq $live) -and (WaitFor { (Http $docsPort '/') -eq 'docs v2' }))
    if ($script:fail -gt $failed) { Show }

    Site 'docs v5'
    Put (Join-Path $repo 'site\public\home.html') 'home five'
    $live = Live $docsRoot
    $held = [IO.File]::Open((Join-Path $docsRoot 'public\home.html'), 'Open', 'Read', 'None')
    try { $r = Deploy 'Deploy-Docs.ps1' $docs.Clone() } finally { $held.Close() }
    $failed = $script:fail
    Yes 'Deploy-Docs: a swap whose rename fails on a held file is SWAP ROLLED BACK' ((-not $r.Ok) -and $r.Said -match 'could not move the old public/home\.html aside' -and $r.Said -match 'SWAP ROLLED BACK')
    Yes '  and what was live is live again and answering' (((Live $docsRoot) -eq $live) -and (WaitFor { (Http $docsPort '/') -eq 'docs v2' }))
    if ($script:fail -gt $failed) { Show }

    $r = Deploy 'Deploy-Docs.ps1' @{ Vps = '127.0.0.1'; User = 'nobody'; Root = $docsRoot; Task = ($TaskPrefix + ' Docs'); Port = $docsPort; Wait = 10; PutBack = $true }
    $failed = $script:fail
    Yes 'Deploy-Docs -PutBack puts the previous site back, and it answers' ($r.Ok -and (WaitFor { (Http $docsPort '/') -eq 'docs v1' }))
    $undone = @(Kept $docsRoot '.undone-*')
    Yes '  and what it took out is kept in .undone' ($undone.Count -eq 1 -and (Get (Join-Path $undone[0] 'server.js')) -match 'docs v2')
    Yes '  and the record came back with it, and the store names it again' (
        (Get (Join-Path $docsRoot 'thornswood-deploy.json')) -eq $v1rec -and
        (Current 'thornswood-docs').name -eq ($v1rec | ConvertFrom-Json).name -and
        (Get (Join-Path $store 'history.log')) -match 'thornswood-docs put back to site-')
    if ($script:fail -gt $failed) { Show }

    # Two old copies, not three (#1121): three more good deploys leave the
    # newest two .prev folders, holding the two versions before the last.
    foreach ($v in 'docs v6', 'docs v7', 'docs v8') {
        Site $v
        $r = Deploy 'Deploy-Docs.ps1' $docs.Clone()
        if (-not $r.Ok) { break }
        Start-Sleep -Milliseconds 1100
    }
    $prev = @(Kept $docsRoot '.prev-*')
    $failed = $script:fail
    Yes 'Deploy-Docs: after three more deploys only the newest two .prev folders are kept' (
        $r.Ok -and (WaitFor { (Http $docsPort '/') -eq 'docs v8' }) -and $prev.Count -eq 2 -and
        (Get (Join-Path $prev[0] 'server.js')) -match 'docs v6' -and (Get (Join-Path $prev[1] 'server.js')) -match 'docs v7')
    if ($script:fail -gt $failed) { Show }

    # Issue #1118: unchanged server.js and public files skip the stop and swap.
    $pidBefore = Listener $docsPort
    $prevBefore = @(Kept $docsRoot '.prev-*').Count
    $live = Live $docsRoot
    $r = Deploy 'Deploy-Docs.ps1' $docs.Clone()
    $failed = $script:fail
    Yes 'Deploy-Docs: when server.js and public are unchanged, the deploy succeeds without a swap' (
        $r.Ok -and $r.Said -match 'server\.js already the same up there, not sent' -and
        $r.Said -match 'nothing in the app changed, so the site will not be stopped' -and
        $r.Said -match 'Nothing in the app to swap' -and $r.Said -notmatch 'SWAP OK')
    Yes '  and the same process is still answering the same version' (
        ((Listener $docsPort) -eq $pidBefore) -and ((Http $docsPort '/') -eq 'docs v8'))
    Yes '  and no new .prev was made, and the live files are untouched' (
        ((@(Kept $docsRoot '.prev-*').Count) -eq $prevBefore) -and ((Live $docsRoot) -eq $live))
    if ($script:fail -gt $failed) { Show }

    # ==================================================== the voice service
    $voiceRoot = Join-Path $box 'Thornswood-Voice'
    $voicePort = PickPort
    $voice = @{ VpsHost = '127.0.0.1'; VpsUser = 'nobody'; Root = $voiceRoot; Port = $voicePort; Site = ''; Bind = '0.0.0.0'
                ChatRange = 'off'; TurnUrl = ''; TaskName = ($TaskPrefix + ' Voice'); NoPause = $true; Wait = 10 }
    function Build { $h = Http $voicePort '/health'; if ($h) { try { return [string]($h | ConvertFrom-Json).build } catch { } }; return '' }

    Voice 'voice-v1'
    $r = Deploy 'Install-Voice.ps1' $voice.Clone()
    $failed = $script:fail
    Yes 'Install-Voice: a first install is swapped in and answers as the build sent' ($r.Ok -and (WaitFor { (Build) -eq 'voice-v1' }))
    if ($script:fail -gt $failed) { Show }

    Voice 'voice-v2'
    $r = Deploy 'Install-Voice.ps1' $voice.Clone()
    $failed = $script:fail
    Yes 'Install-Voice: a good install is SWAP OK and the new build answers' ($r.Ok -and $r.Said -match 'SWAP OK' -and (WaitFor { (Build) -eq 'voice-v2' }))
    $prev = @(Kept $voiceRoot '.prev-*')
    Yes '  and the old voice-server.js is kept in .prev' ($prev.Count -eq 1 -and (Get (Join-Path $prev[0] 'voice-server.js')) -match 'voice-v1')
    if ($script:fail -gt $failed) { Show }

    $live = Live $voiceRoot
    $pidBefore = Listener $voicePort
    $taskBefore = TaskArg ($TaskPrefix + ' Voice')
    # With its BUILD line, so this is the box's parse check and not the
    # install's own read of the build (#2711, below).
    Put (Join-Path $repo 'voice\voice-server.js') "const BUILD = 'voice-bad';`nfunction ( { not javascript"
    $r = Deploy 'Install-Voice.ps1' $voice.Clone()
    $failed = $script:fail
    Yes 'Install-Voice: a voice-server.js that does not parse stops the install, saying why' ((-not $r.Ok) -and $r.Said -match 'voice-server\.js does not parse')
    Yes '  and the running service is untouched, the same process, the same build' (
        ((Live $voiceRoot) -eq $live) -and ((Listener $voicePort) -eq $pidBefore) -and ((Build) -eq 'voice-v2'))
    if ($script:fail -gt $failed) { Show }

    # #2711: the build the check after the start holds the service to was read
    # in a try with an empty catch, and with none that check passed whatever
    # answered. A voice-server.js naming no BUILD now stops before it is sent.
    Put (Join-Path $repo 'voice\voice-server.js') "'use strict';`nconsole.log('no build here');`n"
    $r = Deploy 'Install-Voice.ps1' $voice.Clone()
    $failed = $script:fail
    Yes 'Install-Voice: a voice-server.js that names no BUILD stops the install before anything is sent' ((-not $r.Ok) -and $r.Said -match 'names no const BUILD, so there is no build to check the new service by\. Nothing was sent\.')
    Yes '  and the running service is untouched' (((Live $voiceRoot) -eq $live) -and ((Listener $voicePort) -eq $pidBefore) -and ((Build) -eq 'voice-v2'))
    if ($script:fail -gt $failed) { Show }

    Voice 'voice-v3'
    $a = $voice.Clone(); $a['ScpFail'] = 'headlines\.js$'
    $r = Deploy 'Install-Voice.ps1' $a
    $failed = $script:fail
    Yes 'Install-Voice: a copy that fails stops the install with the service untouched' (
        (-not $r.Ok) -and ((Live $voiceRoot) -eq $live) -and ((Listener $voicePort) -eq $pidBefore) -and ((Build) -eq 'voice-v2'))
    if ($script:fail -gt $failed) { Show }

    Voice 'voice-v4, will-not-start'
    # Another chat range, so the task this install makes differs from the one it
    # replaces. It was -Auth until #1303 took that away: the service always refuses.
    $a = $voice.Clone(); $a['ChatRange'] = '2500'
    $r = Deploy 'Install-Voice.ps1' $a
    $failed = $script:fail
    Yes 'Install-Voice: a build that does not start is SWAP ROLLED BACK, and the install fails' ((-not $r.Ok) -and $r.Said -match 'SWAP ROLLED BACK')
    Yes '  and says why from voice.log' ($r.Said -match 'this voice will not start')
    Yes '  and the old files are back and the old build answers again' (((Live $voiceRoot) -eq $live) -and (WaitFor { (Build) -eq 'voice-v2' }))
    Yes '  and the task is back exactly as it was, chat range and all, not the one this install made' ((TaskArg ($TaskPrefix + ' Voice')) -eq $taskBefore -and $taskBefore -match 'THORNSWOOD_CHAT_RANGE=off&&')
    if ($script:fail -gt $failed) { Show }

    $a = $voice.Clone(); $a['PutBack'] = $true
    $r = Deploy 'Install-Voice.ps1' $a
    $failed = $script:fail
    Yes 'Install-Voice -PutBack puts the previous build back, and it answers' ($r.Ok -and (WaitFor { (Build) -eq 'voice-v1' }))
    Yes '  and leaves the task as it was' ((TaskArg ($TaskPrefix + ' Voice')) -eq $taskBefore)
    if ($script:fail -gt $failed) { Show }

    # Issue #2491: -TaskOnly registers the task again with this install's
    # settings and restarts voice under it, sending and swapping no file.
    $live = Live $voiceRoot
    $pidBefore = Listener $voicePort
    $a = $voice.Clone(); $a['TaskOnly'] = $true
    $r = Deploy 'Install-Voice.ps1' $a
    $failed = $script:fail
    Yes 'Install-Voice -TaskOnly is TASK OK, the same build answering as a new process' (
        $r.Ok -and $r.Said -match 'TASK OK' -and (WaitFor { ((Build) -eq 'voice-v1') -and ((Listener $voicePort) -ne $pidBefore) }))
    Yes '  and the task starts node through start /high, on server-log.js running voice (#2166)' ((TaskArg ($TaskPrefix + ' Voice')) -like '*start "" /b /wait /high "*" "*\server-log.js" --log "*\voice.log" --days 90 --stamp voice-server.js & call exit*')
    Yes '  and reads node back at High' ($r.Said -match 'node, pid \d+, runs at High priority')
    Yes '  and no file was staged, sent or swapped' (((Live $voiceRoot) -eq $live) -and $r.Said -notmatch 'Staging' -and @(Kept $voiceRoot '.stage-*').Count -eq 0)
    if ($script:fail -gt $failed) { Show }

    # Issue #2952: -Restart was Stop-ScheduledTask, a second's sleep and
    # Start-ScheduledTask. The stand-in Stop-ScheduledTask ends the task's
    # cmd.exe and leaves its node running, the way the real one returns
    # before voice has exited (63 ms, every process still up, measured on dev
    # voice on 21 Oct), so a start that does not wait for the old node finds
    # it on the port and the old process goes on answering.
    $live = Live $voiceRoot
    $pidBefore = Listener $voicePort
    $taskBefore = TaskArg ($TaskPrefix + ' Voice')
    $a = $voice.Clone(); $a['Restart'] = $true
    $r = Deploy 'Install-Voice.ps1' $a
    $failed = $script:fail
    Yes 'Install-Voice -Restart is RESTART OK, the same build answering as a new process' (
        $r.Ok -and $r.Said -match 'RESTART OK' -and (WaitFor { ((Build) -eq 'voice-v1') -and ((Listener $voicePort) -notin 0, $pidBefore) }))
    Yes '  and the old process has exited, not been left beside the new one' (-not (Get-Process -Id $pidBefore -EA SilentlyContinue))
    Yes '  and the task and the files are as they were, nothing staged or sent' (
        ((TaskArg ($TaskPrefix + ' Voice')) -eq $taskBefore) -and ((Live $voiceRoot) -eq $live) -and $r.Said -notmatch 'Staging')
    if ($script:fail -gt $failed) { Show }

    # And -Remove took the folder away in the same instant, with every error
    # silenced, and the firewall rule it took was always live's.
    $pidBefore = Listener $voicePort
    $a = $voice.Clone(); $a['Remove'] = $true
    $r = Deploy 'Install-Voice.ps1' $a
    $failed = $script:fail
    Yes 'Install-Voice -Remove is REMOVED, with voice exited and its task and folder gone' (
        $r.Ok -and $r.Said -match '(?m)^\s*REMOVED$' -and -not (Get-Process -Id $pidBefore -EA SilentlyContinue) -and
        (Listener $voicePort) -eq 0 -and -not (TaskArg ($TaskPrefix + ' Voice')) -and -not (Test-Path -LiteralPath $voiceRoot))
    if ($script:fail -gt $failed) { Show }

    # ================================================================ the bot
    $botRoot = Join-Path $box 'Thornswood-Bot'
    # What a full install leaves, and the code only one needs: the files, the
    # settings, run.ps1 around python, and the task. run.ps1 here is a
    # shorter loop than the real one (tests\test-bot-wrapper.ps1 runs that).
    Bot 'bot v1'
    $null = [IO.Directory]::CreateDirectory($botRoot)
    foreach ($f in 'bot.py', '_pyguard.py', 'trust.py', 'card.py', 'staff-channel.txt', 'requirements.txt') { Copy-Item -LiteralPath (Join-Path $repo "bot\$f") -Destination (Join-Path $botRoot $f) -Force }
    Put (Join-Path $botRoot 'bot.env.json') '{ "DISCORD_TOKEN": "not a token" }'
    $bq = $botRoot.Replace("'", "''")
    # bot.log in the data folder under the bot's, where the service writes it
    # since #1104 and where Get-ThornswoodBotLog looks for it first.
    $botLog = Join-Path $botRoot 'data\bot.log'
    $null = [IO.Directory]::CreateDirectory((Join-Path $botRoot 'data'))
    Put (Join-Path $botRoot 'run.ps1') ("Set-Location -LiteralPath '" + $bq + "'`r`nwhile (`$true) {`r`n  & cmd /c ""python """"" + $botRoot + "\bot.py"""" >> """"" + $botLog + """"" 2>&1""`r`n  Start-Sleep -Seconds 2`r`n}`r`n")
    # The service $BotService (ThornswoodTest<run>Bot), standing in for ThornswoodBot (#465).
    Task $BotService $boxPs ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $botRoot + '\run.ps1"') $botRoot
    function BotSays([string]$v) { return ((Get $botLog) -match [regex]::Escape($v + ' watching')) }
    # The site's data\for-bot and data\from-bot, which Install-Bot waits for
    # before it sends the bot (#1102, and #3140 for from-bot, where the bot
    # writes the site's known issues and roadmap): a site that has not made
    # one yet is refused below.
    $siteForBot = Join-Path $box 'Thornswood-Docs'
    $null = [IO.Directory]::CreateDirectory((Join-Path $siteForBot 'data\for-bot'))
    $null = [IO.Directory]::CreateDirectory((Join-Path $siteForBot 'data\from-bot'))
    $bot = @{ Vps = '127.0.0.1'; User = 'nobody'; Root = $botRoot; DocsRoot = $siteForBot; Service = $BotService; CodeOnly = $true; NoPause = $true; Wait = 20 }
    Yes 'Install-Bot: the stand-in bot is up' (WaitFor { BotSays 'bot v1' })

    Bot 'bot v2'
    $live = Live $botRoot
    $a = $bot.Clone(); $a['DocsRoot'] = (Join-Path $box 'No-Site-Yet')
    $r = Deploy 'Install-Bot.ps1' $a
    $failed = $script:fail
    Yes 'Install-Bot: a site with no data\for-bot yet stops it, naming Deploy-Docs, with the bot untouched' (
        (-not $r.Ok) -and $r.Said -match 'Run \.\\scripts\\deploy\\Deploy-Docs\.ps1 first' -and ((Live $botRoot) -eq $live))
    if ($script:fail -gt $failed) { Show }

    Bot 'bot v2'
    $live = Live $botRoot
    $noFrom = Join-Path $box 'Site-Without-From-Bot'
    $null = [IO.Directory]::CreateDirectory((Join-Path $noFrom 'data\for-bot'))
    $a = $bot.Clone(); $a['DocsRoot'] = $noFrom
    $r = Deploy 'Install-Bot.ps1' $a
    $failed = $script:fail
    Yes 'Install-Bot: a site with data\for-bot but no data\from-bot yet stops it, naming from-bot and Deploy-Docs, with the bot untouched' (
        (-not $r.Ok) -and $r.Said -match 'from-bot yet' -and $r.Said -match 'Run \.\\scripts\\deploy\\Deploy-Docs\.ps1 first' -and ((Live $botRoot) -eq $live))
    if ($script:fail -gt $failed) { Show }

    Bot 'bot v2'
    $r = Deploy 'Install-Bot.ps1' $bot.Clone()
    $failed = $script:fail
    Yes 'Install-Bot -CodeOnly: good code is SWAP OK and the new bot says it is watching' ($r.Ok -and $r.Said -match 'SWAP OK' -and (BotSays 'bot v2'))
    Yes '  and only then the box records the bot artifact' ((Current 'thornswood-bot').name -like 'bot-*')
    # The live smoke export went up beside bot.py from #2018 until the Live
    # smoke checklist was taken out on 11 Oct. Nothing sends it now.
    Yes '  and no live smoke export is sent any more' (
        -not (Test-Path -LiteralPath (Join-Path $botRoot 'live-smoke-discord-export.json')))
    # And the run says so itself, asking the box for the full path under the
    # root the swap moved the files to. A green run once left the export and
    # data\bot.log reported missing from the install root with nothing in the
    # run saying what that folder held, so there was no telling a swap that
    # lost files from a Test-Path typed on the wrong machine.
    Yes '  and the run proves it on the box, by full path, for every file it sent and for data\bot.log' (
        $r.Said -match 'FILES ON THE BOX' -and
        $r.Said -match ([regex]::Escape('Test-Path ' + $botLog) + '\s+True') -and
        $r.Said -match 'Test-Path .*bot\.py\s+True')
    $prev = @(Kept $botRoot '.prev-*')
    Yes '  and the old bot.py is kept in .prev' ($prev.Count -eq 1 -and (Get (Join-Path $prev[0] 'bot.py')) -match 'bot v1')
    if ($script:fail -gt $failed) { Show }

    $live = Live $botRoot
    Put (Join-Path $repo 'bot\card.py') 'def ( not python'
    $r = Deploy 'Install-Bot.ps1' $bot.Clone()
    Put (Join-Path $repo 'bot\card.py') 'CARD = 1'
    $failed = $script:fail
    Yes 'Install-Bot: a card.py that does not parse stops it, saying why, with the bot untouched' (
        (-not $r.Ok) -and $r.Said -match 'card\.py does not parse' -and ((Live $botRoot) -eq $live))
    if ($script:fail -gt $failed) { Show }

    $a = $bot.Clone(); $a['ScpFail'] = 'bot\.py$'
    Bot 'bot v3'
    $r = Deploy 'Install-Bot.ps1' $a
    $failed = $script:fail
    Yes 'Install-Bot: a copy that fails stops it with the bot untouched' ((-not $r.Ok) -and $r.Said -match 'scp exited' -and ((Live $botRoot) -eq $live))
    if ($script:fail -gt $failed) { Show }

    Bot 'bot v4, will-not-start'
    $r = Deploy 'Install-Bot.ps1' $bot.Clone()
    $failed = $script:fail
    Yes 'Install-Bot: code that does not start is SWAP ROLLED BACK, and the run fails' ((-not $r.Ok) -and $r.Said -match 'SWAP ROLLED BACK')
    Yes '  and the old files are back, and the old bot says it is watching again' (
        ((Live $botRoot) -eq $live) -and ($r.Said -match 'answering again'))
    if ($script:fail -gt $failed) { Show }

    $a = $bot.Clone(); $a.Remove('CodeOnly'); $a['PutBack'] = $true
    $r = Deploy 'Install-Bot.ps1' $a
    $failed = $script:fail
    Yes 'Install-Bot -PutBack puts the previous code back, and it comes up' ($r.Ok -and (Get (Join-Path $botRoot 'bot.py')) -match 'bot v1' -and $r.Said -match 'SWAP OK')
    Yes '  and the store no longer names the code it took out' ((Current 'thornswood-bot').name -eq 'an older copy kept before deploys were recorded')
    if ($script:fail -gt $failed) { Show }

    # The bot down and no bot.log on the box: one taken off by hand to get a
    # clean read, or a data folder that went with a restore. The health check
    # reads the log from a byte offset, so with no file to open it used to
    # wait out the whole of -Wait, put the code back, wait it out again and
    # end red, which is a -CodeOnly run that stops the bot and never says
    # why. The log is made in front of the start now.
    # The bot stopped first, service and any copy of it, so nothing is writing
    # data\bot.log while it is taken away: a running bot opens its log for
    # appending and makes it again, and then the run finds one there.
    function Stop-TestBot {
        $null = RunWrapped "Stop-Service -Name '$BotService'`r`n"
        foreach ($p in @(Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($botRoot) })) {
            if ($p.ProcessId -ne $PID) { Stop-Process -Id $p.ProcessId -Force -EA SilentlyContinue }
        }
    }
    Stop-TestBot
    $gone = WaitFor { Remove-Item -LiteralPath $botLog -Force -EA SilentlyContinue; -not (Test-Path -LiteralPath $botLog) }
    Bot 'bot v5'
    $r = Deploy 'Install-Bot.ps1' $bot.Clone()
    $failed = $script:fail
    Yes 'Install-Bot -CodeOnly: with the bot stopped and no bot.log anywhere, an empty one is made and the new code is swapped in' (
        $gone -and $r.Ok -and $r.Said -match 'SWAP OK' -and $r.Said -match 'made an empty .*data.bot\.log')
    Yes '  and the service was started, and the new bot says it is watching' (
        $r.Said -match ('started the service ' + $BotService) -and (WaitFor { BotSays 'bot v5' }))
    Yes '  and data\bot.log is on the box afterwards, which is the path the docs name, and the run says True for it' (
        (Test-Path -LiteralPath $botLog) -and $r.Said -match ([regex]::Escape('Test-Path ' + $botLog) + '\s+True'))
    if ($script:fail -gt $failed) { Show }

    # A bot.log beside the code and none in data, which is the layout of a box
    # that has had only -CodeOnly runs since #1104, since those leave the
    # service program as it is. Get-ThornswoodBotLog names the old place then,
    # and that used to be enough to skip making data\bot.log, so the path
    # everybody is told to look at did not exist. The run must leave it there,
    # and must still read the file this start really wrote.
    #
    # The bot v5 the case above started is still running, writing
    # data\bot.log. In the nightly of 4 October (#1197) this case failed with
    # the run saying SWAP OK, that it stopped the service and "a copy of the
    # bot no service started" (python.exe), and nothing about making
    # data\bot.log: the running bot held the file or wrote it again after it
    # was taken away, so the run found one there. It is stopped here the way
    # the case above does it, so "none in data" is what the run sees.
    Stop-TestBot
    $besideCode = Join-Path $botRoot 'bot.log'
    Put $besideCode "[thornswood-bot] bot v5 watching 1 server, from the old place`r`n"
    $gone = WaitFor { Remove-Item -LiteralPath $botLog -Force -EA SilentlyContinue; -not (Test-Path -LiteralPath $botLog) }
    Bot 'bot v6'
    $r = Deploy 'Install-Bot.ps1' $bot.Clone()
    $failed = $script:fail
    Yes 'Install-Bot -CodeOnly: with a bot.log beside the code and none in data, data\bot.log is still made' (
        $gone -and $r.Ok -and $r.Said -match 'SWAP OK' -and (Test-Path -LiteralPath $botLog) -and
        $r.Said -match 'made an empty .*data.bot\.log')
    Yes '  and it followed the file this start wrote rather than the empty one it made' (
        $r.Said -match 'writing its log to ' -and (WaitFor { BotSays 'bot v6' }))
    Remove-Item -LiteralPath $besideCode -Force -EA SilentlyContinue
    if ($script:fail -gt $failed) { Show }

    # What the install did not send (#1184). The bot's folder on the VPS held
    # sample.py, backfill.py, redraw.py, two sample pictures and an old log
    # beside bot.py, copied there by hand and never taken off, because the
    # install sent a fixed list and had no rule for the rest of the folder; and
    # the folder bot.py is in is the first place Python looks for a module. A
    # run now leaves it holding what it sends and what is the bot's own
    # (Get-ThornswoodBotOwned in Bot-Service.ps1), and moves the rest aside
    # into its .prev while the bot is stopped.
    $strays = [ordered]@{
        'sample.py'               = 'print("a module nobody sent")'
        'sample-maka.png'         = 'a picture nobody sent'
        'assets\sample-mixed.png' = 'a picture in a folder the install sends into'
        'scratch\redraw.py'       = 'a folder nobody sent, with a tool in it'
    }
    # And what is the bot's own, which every run leaves as it was. bot.env.json
    # is on the box already; run.ps1 is the stand-in service's loop, the old
    # loop's file until a full run. thornswood-deploy.json is the bot's own
    # too, but every good run writes it again, so it is held to being there.
    $own = [ordered]@{
        'data\joins.json'           = '{ "next": 7 }'
        'webhooks\news.txt'         = 'not a webhook'
        'py-libs\keep\__init__.py'  = 'VERSION = 1'
        'service\host.json'         = '{ "root": "here" }'
        'bot.log.20260916-1535.old' = 'a log renamed by hand, which a full run moves into data'
        'joins.json'                = '{ "from before 1104": true }'
    }
    function PutAll($set) { foreach ($k in $set.Keys) { Put (Join-Path $botRoot $k) $set[$k] } }
    function Sums {
        $h = [ordered]@{}
        foreach ($k in @($own.Keys) + @('bot.env.json', 'run.ps1', 'assets\join-card.png')) {
            $p = Join-Path $botRoot $k
            $h[$k] = $(if (Test-Path -LiteralPath $p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash } else { 'not there' })
        }
        return (($h.Keys | ForEach-Object { $_ + '|' + $h[$_] }) -join "`n")
    }
    PutAll $strays
    PutAll $own
    $ownBefore = Sums
    Bot 'bot v7'
    $r = Deploy 'Install-Bot.ps1' $bot.Clone()
    $failed = $script:fail
    $prev = @(Kept $botRoot '.prev-*')
    # None when the run failed: the checks on it then fail, not end the run (#1273).
    $newest = $(if ($prev.Count) { $prev[-1] } else { '' })
    Yes 'Install-Bot -CodeOnly: with files in the bot''s folder that nothing sent, the new code is SWAP OK and the bot says it is watching' (
        $r.Ok -and $r.Said -match 'SWAP OK' -and (WaitFor { BotSays 'bot v7' }))
    Yes '  and the stray .py, the stray .png, the one in assets and the stray folder are gone from the bot''s folder' (
        -not @($strays.Keys | Where-Object { Test-Path -LiteralPath (Join-Path $botRoot $_) }).Count)
    Yes '  and each is in the .prev this run made, as it was, beside the code it replaced' (
        $newest -and -not @($strays.Keys | Where-Object { (Get (Join-Path $newest $_)) -ne $strays[$_] }).Count -and
        (Get (Join-Path $newest 'bot.py')) -match 'bot v6')
    # A folder nothing sent goes aside whole, so it is named as the folder.
    $named = ([regex]::Match($r.Said, 'moved aside 4 thing\(s\) .* into ' + [regex]::Escape($newest) + ': (.*)')).Groups[1].Value
    Yes '  and the run names each one, the stray folder as one, and where they went' (
        $named -and -not (Compare-Object @($named.Trim() -split ', ') @('assets/sample-mixed.png', 'sample-maka.png', 'sample.py', 'scratch')))
    Yes '  and what is the bot''s own is as it was: data, webhooks, py-libs, service, bot.env.json, the record, the old loop''s file, an old log' (
        (Sums) -eq $ownBefore)
    Yes '  and the card artwork the run sent is still in assets, and the record beside the code' (
        (Test-Path -LiteralPath (Join-Path $botRoot 'assets\join-card.png')) -and (Test-Path -LiteralPath (Join-Path $botRoot 'thornswood-deploy.json')))
    Yes '  and the box holds every file the run sent' ($r.Said -match 'FILES ON THE BOX')
    if ($script:fail -gt $failed) { Show }

    # -PutBack is the box as it was before that run, so what that run moved
    # aside comes back with the code it sat beside: a file an older install
    # sent and a newer one no longer does is the older code's.
    $a = $bot.Clone(); $a.Remove('CodeOnly'); $a['PutBack'] = $true
    $r = Deploy 'Install-Bot.ps1' $a
    $failed = $script:fail
    Yes 'Install-Bot -PutBack after it: the previous code comes back, and what that run moved aside with it' (
        $r.Ok -and $r.Said -match 'SWAP OK' -and (Get (Join-Path $botRoot 'bot.py')) -match 'bot v6' -and
        -not @($strays.Keys | Where-Object { (Get (Join-Path $botRoot $_)) -ne $strays[$_] }).Count)
    Yes '  and what is the bot''s own is still as it was' ((Sums) -eq $ownBefore)
    if ($script:fail -gt $failed) { Show }

    # A new bot that does not come up puts the folder back as it was, the
    # files it moved aside included.
    $live = Live $botRoot
    Bot 'bot v8, will-not-start'
    $r = Deploy 'Install-Bot.ps1' $bot.Clone()
    $failed = $script:fail
    Yes 'Install-Bot -CodeOnly: code that does not start, with strays in the folder, is SWAP ROLLED BACK' (
        (-not $r.Ok) -and $r.Said -match 'moved aside 4 thing' -and $r.Said -match 'SWAP ROLLED BACK')
    Yes '  and the folder is as it was, what it moved aside back in place, and the old bot says it is watching again' (
        ((Live $botRoot) -eq $live) -and $r.Said -match 'answering again' -and
        -not @($strays.Keys | Where-Object { (Get (Join-Path $botRoot $_)) -ne $strays[$_] }).Count)
    Yes '  and what is the bot''s own is still as it was' ((Sums) -eq $ownBefore)
    if ($script:fail -gt $failed) { Show }

    # ======================================================= the dev server
    $devRoot = Join-Path $box 'Thornswood-Server-Dev'
    $devPort = PickPort
    $devFar = ($devRoot -replace '\\', '/') + '/plugins/'
    Put (Join-Path $devRoot 'plugins\Skyrim.esm') 'skyrim'
    Put (Join-Path $devRoot 'gamemode.js') '// dev v1'
    # A real true or false for the join pass hold, which Deploy-DevGamemode
    # refuses a dev server without (#1319).
    Put (Join-Path $devRoot 'server-settings.json') (([ordered]@{ port = $devPort; name = 'Thornswood Dev'; dataDir = 'data'
        loadOrder = @($devFar + 'Skyrim.esm'); thornswoodServer = 'dev'; thornswoodRequirePass = $true }) | ConvertTo-Json)
    Put (Join-Path $devRoot 'data\keep.txt') 'the character book'
    # The record of the server build it runs, which a full dev publish leaves
    # beside the server files: the build this commit records (#2076, #2113).
    Copy-Item -LiteralPath $serverRecord -Destination (Join-Path $devRoot 'server-build.json')
    Task ($TaskPrefix + ' Dev Server') $node.Source ('"' + $gameStub + '" "' + $devRoot + '"') $devRoot
    $gm = Join-Path $repo 'game\gamemode.js'
    $launcher = Join-Path $work 'launcher'
    $null = [IO.Directory]::CreateDirectory($launcher)
    $devNote = "The dev gamemode deploy test`n- This line is long enough for the shape check to pass."
    $dev = @{ Vps = '127.0.0.1'; User = 'nobody'; Root = $devRoot; Task = ($TaskPrefix + ' Dev Server')
              Dist = (Join-Path $work 'dist'); Wait = 10; Note = $devNote }
    function DevUp { return ((UdpOwner $devPort) -gt 0) -and ((Listener ($devPort + 1)) -gt 0) }
    Yes 'Deploy-DevGamemode: the stand-in dev server is up' (WaitFor { DevUp })

    # A dev server that runs another server build than the commit records is
    # refused before the artifact is sent (#2076): no scp, nothing stopped.
    $recText = [IO.File]::ReadAllText($serverRecord)
    $recCommit = [string]($recText | ConvertFrom-Json).source.commit
    Put (Join-Path $devRoot 'server-build.json') $recText.Replace($recCommit, ('f' * 40))
    Put $gm '// dev v2'
    $live = Live $devRoot
    $pidBefore = UdpOwner $devPort
    $scpBefore = $global:TsScpCount
    $r = Deploy 'Deploy-DevGamemode.ps1' $dev.Clone()
    $failed = $script:fail
    Yes 'Deploy-DevGamemode: a dev server on another server build is refused before anything is sent' (
        (-not $r.Ok) -and $recCommit -and $r.Said -match 'runs another server build \(commit ffffffff\)' -and $global:TsScpCount -eq $scpBefore)
    Yes '  and the dev server is untouched, the same process answering' (((Live $devRoot) -eq $live) -and ((UdpOwner $devPort) -eq $pidBefore))
    if ($script:fail -gt $failed) { Show }
    Copy-Item -LiteralPath $serverRecord -Destination (Join-Path $devRoot 'server-build.json') -Force

    $pidBefore = UdpOwner $devPort
    $r = Deploy 'Deploy-DevGamemode.ps1' $dev.Clone()
    $failed = $script:fail
    Yes 'Deploy-DevGamemode: a good gamemode is SWAP OK and the dev server answers as a new process' (
        $r.Ok -and $r.Said -match 'runs the build this commit records' -and $r.Said -match 'SWAP OK' -and
        (Get (Join-Path $devRoot 'gamemode.js')) -eq '// dev v2' -and
        (WaitFor { DevUp }) -and ((UdpOwner $devPort) -ne $pidBefore))
    Yes '  and its stamp went in beside it, and the settings were edited in the stage, not in place' (
        (Test-Path -LiteralPath (Join-Path $devRoot 'thornswood-build.json')) -and
        (Get (Join-Path $devRoot 'server-settings.json')) -match 'thornswoodVoicePort')
    $prev = @(Kept $devRoot '.prev-*')
    Yes '  and the old gamemode and the old settings are kept in .prev' (
        $prev.Count -eq 1 -and (Get (Join-Path $prev[0] 'gamemode.js')) -eq '// dev v1' -and
        (Get (Join-Path $prev[0] 'server-settings.json')) -notmatch 'thornswoodVoicePort')
    Yes '  and the world data was not touched' ((Get (Join-Path $devRoot 'data\keep.txt')) -eq 'the character book')
    Yes '  and the box records the gamemode artifact in the data folder the dev server serves' (
        (Current 'thornswood-server-dev').name -like 'gamemode-*' -and
        (Get (Join-Path $devRoot 'data\thornswood-deploy.json')) -match 'gamemode-')
    $devRec = Get (Join-Path $devRoot 'data\thornswood-deploy.json')
    if ($script:fail -gt $failed) { Show }

    $live = Live $devRoot
    $pidBefore = UdpOwner $devPort
    Put $gm '// dev v3'
    $a = $dev.Clone(); $a['Corrupt'] = 'gamemode\.js$'
    $r = Deploy 'Deploy-DevGamemode.ps1' $a
    $failed = $script:fail
    Yes 'Deploy-DevGamemode: a gamemode that arrived different is refused on the box, before anything stops' (
        (-not $r.Ok) -and $r.Said -match 'arrived different from what was sent: gamemode\.js')
    Yes '  and the dev server is untouched, the same process answering' (((Live $devRoot) -eq $live) -and ((UdpOwner $devPort) -eq $pidBefore))
    if ($script:fail -gt $failed) { Show }

    $a = $dev.Clone(); $a['ScpFail'] = 'thornswood-build\.json$'
    $r = Deploy 'Deploy-DevGamemode.ps1' $a
    $failed = $script:fail
    Yes 'Deploy-DevGamemode: a copy that fails stops it, with the dev server untouched' (
        (-not $r.Ok) -and ((Live $devRoot) -eq $live) -and ((UdpOwner $devPort) -eq $pidBefore))
    if ($script:fail -gt $failed) { Show }

    Put $gm '// dev v4, will-not-start'
    $r = Deploy 'Deploy-DevGamemode.ps1' $dev.Clone()
    $failed = $script:fail
    Yes 'Deploy-DevGamemode: a gamemode that does not start is SWAP ROLLED BACK, and the deploy fails' ((-not $r.Ok) -and $r.Said -match 'SWAP ROLLED BACK')
    Yes '  and the old gamemode is back and the dev server answers again' (((Live $devRoot) -eq $live) -and (WaitFor { DevUp }))
    if ($script:fail -gt $failed) { Show }

    $a = $dev.Clone(); $a['PutBack'] = $true
    $r = Deploy 'Deploy-DevGamemode.ps1' $a
    $failed = $script:fail
    Yes 'Deploy-DevGamemode -PutBack puts the previous gamemode and settings back, and it answers' (
        $r.Ok -and (Get (Join-Path $devRoot 'gamemode.js')) -eq '// dev v1' -and
        (Get (Join-Path $devRoot 'server-settings.json')) -notmatch 'thornswoodVoicePort' -and (WaitFor { DevUp }))
    Yes '  and, as what came back was never recorded, the box says so rather than naming what it took out' (
        (Current 'thornswood-server-dev').name -eq 'an older copy kept before deploys were recorded' -and
        (Get (Join-Path $devRoot 'data\thornswood-deploy.json')) -ne $devRec)
    if ($script:fail -gt $failed) { Show }

    # ============================================ Deploy-Server.ps1 -PutBack
    $liveRoot = Join-Path $box 'Thornswood-Server'
    $livePort = PickPort
    $liveFar = ($liveRoot -replace '\\', '/') + '/plugins/'
    $liveSettings = (([ordered]@{ port = $livePort; name = 'Thornswood'; dataDir = 'data'; loadOrder = @($liveFar + 'Skyrim.esm') }) | ConvertTo-Json)
    Put (Join-Path $liveRoot 'plugins\Skyrim.esm') 'skyrim'
    Put (Join-Path $liveRoot 'gamemode.js') '// live now'
    Put (Join-Path $liveRoot 'server-settings.json') $liveSettings
    Put (Join-Path $liveRoot '.prev-20260928-120000\gamemode.js') '// live before'
    Put (Join-Path $liveRoot '.prev-20260928-120000\server-settings.json') $liveSettings
    Task ($TaskPrefix + ' Live Server') $node.Source ('"' + $gameStub + '" "' + $liveRoot + '"') $liveRoot
    function LiveUp { return ((UdpOwner $livePort) -gt 0) -and ((Listener ($livePort + 1)) -gt 0) }
    $null = WaitFor { LiveUp }
    $pidBefore = UdpOwner $livePort
    $r = Deploy 'Deploy-Server.ps1' @{ Vps = '127.0.0.1'; User = 'nobody'; Root = $liveRoot; Task = ($TaskPrefix + ' Live Server')
                                       Dist = (Join-Path $work 'dist'); Wait = 10; PutBack = $true }
    $failed = $script:fail
    Yes 'Deploy-Server -PutBack puts the newest .prev back, and the server answers as a new process' (
        $r.Ok -and (Get (Join-Path $liveRoot 'gamemode.js')) -eq '// live before' -and (WaitFor { LiveUp }) -and ((UdpOwner $livePort) -ne $pidBefore))
    Yes '  and keeps what it took out in .undone' ((@(Kept $liveRoot '.undone-*')).Count -eq 1)
    if ($script:fail -gt $failed) { Show }
}
catch {
    Yes ('the runs finished without an error: ' + $_.Exception.Message) $false
    Show
}
finally {
    Yes 'no real scheduled task was left behind' (NoRealTask)
    foreach ($h in $script:portHeld) { $h.Dispose() }
    # Only what this run started: the pids it wrote down, and only processes
    # that began after it did.
    if (Test-Path -LiteralPath $pidLog) {
        foreach ($id in @(Get-Content -LiteralPath $pidLog | Where-Object { $_ })) {
            $p = Get-Process -Id ([int]$id) -EA SilentlyContinue
            if ($p -and $p.StartTime -ge $started) { Stop-Process -Id $p.Id -Force -EA SilentlyContinue }
        }
    }
    # And anything still running from the scratch folder, which a stop in the
    # middle of a run can leave: python and cmd under the bot's run.ps1.
    foreach ($p in @(Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($work) })) {
        if ($p.ProcessId -ne $PID) { Stop-Process -Id $p.ProcessId -Force -EA SilentlyContinue }
    }
    Start-Sleep -Milliseconds 500
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

Done
