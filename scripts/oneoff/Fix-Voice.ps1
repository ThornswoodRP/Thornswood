<#
  Fix-Voice.ps1 - get the voice service running on the VPS and keep it running.

  It was started with Start-Process -FilePath 'node', which needs node on the
  PATH of whatever session is doing the starting. An ssh session is not a login
  session and does not get the same PATH a desktop does, so 'node' resolved to
  nothing and the service never came up. The game server does not have this
  problem because it runs from a scheduled task with a full path.

  So this does the same for voice: find node properly, register a task, and
  have that task start at boot as well as now. And when it still will not start,
  print the reason instead of reporting a health check that never answered.
#>

[CmdletBinding()]
param(
  [string] $Vps  = '',
  [string] $User = '',
  [switch] $Push
)

# The refusal comes before anything else, so no part of it can run by accident.
throw ('STOP. Fix-Voice.ps1 is retired and registers nothing (#2008). ' +
       'The task it made, ThornswoodVoice, started C:\Thornswood-Voice\voice-server.js at boot ' +
       'with none of the environment Install-Voice.ps1 gives voice, so no auth and no loopback ' +
       'bind, and it raced the real task for the port after every reboot. ' +
       'Install-Voice.ps1 does this job and takes that task off. The file is kept for the history.')

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
$ProgressPreference    = 'SilentlyContinue'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $Here '..\vps\Vps.ps1')
$ErrorActionPreference = 'Continue'
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }

function Head($t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan }
function Note($t) { Write-Host "  $t" }
function Bad($t)  { Write-Host "  $t" -ForegroundColor Yellow }

# Push the current copy unless told not to. It is small and always being edited.
$vsrc = Join-Path $Here 'voice-server.js'
if (Test-Path -LiteralPath $vsrc) {
  Head 'Copying'
  Invoke-ThornswoodNative { & scp -o BatchMode=yes -o StrictHostKeyChecking=yes $vsrc "$User@${Vps}:C:/Thornswood-Voice/voice-server.js" } 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Note 'voice-server.js is up to date on the server' }
  else { Bad 'scp failed'; return }
}

Head 'Starting'

$remote = @'
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'

$dir = 'C:\Thornswood-Voice'
$js  = Join-Path $dir 'voice-server.js'
if (-not (Test-Path -LiteralPath $js)) { "voice-server.js is not on the server at $js"; exit }

# An ssh session does not inherit a desktop PATH, so node has to be found by
# looking rather than by name.
$node = $null
foreach ($c in @(
  'C:\Program Files\nodejs\node.exe',
  'C:\Program Files (x86)\nodejs\node.exe',
  "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
  "$env:ProgramData\chocolatey\bin\node.exe"
)) { if (Test-Path -LiteralPath $c) { $node = $c; break } }

if (-not $node) {
  $w = (& where.exe node 2>$null | Select-Object -First 1)
  if ($w -and (Test-Path -LiteralPath $w)) { $node = $w }
}
if (-not $node) {
  $m = Get-ChildItem 'C:\Program Files' -Filter node.exe -Recurse -ErrorAction SilentlyContinue |
       Select-Object -First 1
  if ($m) { $node = $m.FullName }
}
if (-not $node) { "could not find node.exe anywhere on the server"; exit }
"node: $node"

Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*voice-server*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

# A task rather than a bare process, so a reboot does not quietly take voice
# away and leave everybody wondering why nobody can hear them.
$name = 'ThornswoodVoice'
schtasks /Delete /TN $name /F 2>$null | Out-Null

$action  = New-ScheduledTaskAction -Execute $node -Argument "`"$js`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$set     = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
             -DontStopIfGoingOnBatteries -StartWhenAvailable `
             -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$p       = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited -RequiredPrivilege 'SeChangeNotifyPrivilege' -ProcessTokenSidType Unrestricted  # #2578: never SYSTEM again

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
  -Settings $set -Principal $p -Force | Out-Null
"registered the task"

Start-ScheduledTask -TaskName $name
Start-Sleep -Seconds 4

$p2 = Get-CimInstance Win32_Process |
      Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*voice-server*' }
if ($p2) { "voice process is up, pid " + $p2.ProcessId } else { "voice process did NOT start" }

try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:7778/health' -TimeoutSec 5
  "health: " + $r.Content
} catch {
  "health check failed: " + $_.Exception.Message
  # A task writes nowhere by default, so run it in the foreground once to see
  # what it says rather than guessing.
  "--- running it directly to see the error ---"
  & $node $js 2>&1 | Select-Object -First 15
}
'@

$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remote))
$out = Invoke-ThornswoodNative { & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$User@$Vps" "pwsh -NoProfile -EncodedCommand $enc" } 2>&1
$out | ForEach-Object { Note $_ }

Head 'From here'
$c = New-Object Net.Sockets.TcpClient
try {
  $iar = $c.BeginConnect($Vps, 7778, $null, $null)
  if ($iar.AsyncWaitHandle.WaitOne(3000, $false) -and $c.Connected) { Note 'port 7778 is answering' }
  else { Bad 'port 7778 is still not answering from here. If the process is up on the server, it is the firewall.' }
} catch { Bad 'could not test the port' } finally { $c.Close() }
