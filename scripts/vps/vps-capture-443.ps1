<#
  vps-capture-443.ps1

  Captures the SYN and RST packets on port 443 at the box's network card for
  a set time, so #2946 can see whether the TLS connects from a cloud session
  that stall and then reset ever reach the box, and whether the box answers
  them. Runs ON the box, in PowerShell 7 as Administrator, sent by
  Remote.ps1 from a clean main checkout:

      .\scripts\vps\Remote.ps1 -File .\scripts\vps\vps-capture-443.ps1 -Arguments '-Start -Minutes 15'
      .\scripts\vps\Remote.ps1 -File .\scripts\vps\vps-capture-443.ps1 -Arguments '-Status'
      .\scripts\vps\Remote.ps1 -File .\scripts\vps\vps-capture-443.ps1 -Arguments '-Stop'

  WHY A SCRIPT. The capture was written up as lines to type into a shell on
  the box (#2946's releases steps, 20 Oct), and lines typed onto the live box
  from a cloud session are what the safety check refuses (#2970). This is
  the same capture as a reviewed file that only runs from merged main.

  WHY IT DOES NOT WAIT. The capture is for connections that reset, and an ssh
  session held open for fifteen minutes through the same path is one of
  them. So -Start returns at once, and the end of the capture is a one-shot
  scheduled task on the box, "Thornswood capture 443 stop", that stops
  pktmon, removes the two filters, writes the text form and deletes itself
  at the end time. -Stop does the same at once and removes the task.

  WHAT IT KEEPS. Only TCP packets on port 443 with SYN or RST set, 128 bytes
  of each, in a circular file of at most 64 MB:
      C:\Thornswood-Watch\capture-443\capture.etl    the capture
      C:\Thornswood-Watch\capture-443\capture.txt    its text form, written at the end
  It changes nothing else: no firewall rule, no service, no other filter.
  -Start refuses while a capture of its own is still set to stop, and while
  pktmon has filters it did not add, since it would remove them at the end.

  WHERE IT KEEPS THEM. The two files outlive the run that starts the capture:
  the task writes the text form after this script has gone, and -Status and
  whoever reads the capture come later. C:\Windows\Temp is the scratch every
  script sent to the box shares, one run's files under names of their own
  (tests\test-send-script.ps1), so a file kept past its run is not put there
  (#3017). The capture holds the address of everything that connects to 443,
  so it goes in the watchdog's folder, which takes nothing from C:\, is
  SYSTEM's and Administrators' only, gives the bot read on its own files and
  nothing below them, and is on the list of places no service may reach
  (Lock-VpsFolders.ps1, Bot-Service.ps1, ServiceAccount.ps1). The capture's
  folder is made inside it and takes those rules. -Start refuses on a box
  without the watchdog's folder rather than make one with C:\'s rules.

  WHAT IT PRINTS:
      STARTED <minutes> min, stops at <UTC>     -Start
      RUNNING stops at <UTC> / NOT RUNNING      -Status, then pktmon status
                                                and both files with their sizes
      STOPPED                                   -Stop
      REFUSED <why>                             nothing was changed
  Exit 0 when it did what was asked, 1 when it refused.

  tests\test-capture-443.ps1 holds it to all of this.
#>
[CmdletBinding()]
param(
    [switch]$Start,
    [switch]$Status,
    [switch]$Stop,
    [ValidateRange(1, 30)][int]$Minutes = 15
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Watch = 'C:\Thornswood-Watch'
$Dir = 'C:\Thornswood-Watch\capture-443'
$Etl = 'C:\Thornswood-Watch\capture-443\capture.etl'
$Txt = 'C:\Thornswood-Watch\capture-443\capture.txt'
$Task = 'Thornswood capture 443 stop'
$Filters = @('tw443syn', 'tw443rst')

if ((@($Start, $Status, $Stop) | Where-Object { $_ }).Count -ne 1) { 'REFUSED say one of -Start, -Status or -Stop'; exit 1 }

# The end of a capture, the same lines whether the task or -Stop runs them.
# cmd.exe runs each whatever the one before it said, so a capture that has
# already stopped still gets its text form and its filters removed.
$End = 'pktmon stop & pktmon filter remove & pktmon etl2txt "' + $Etl + '" --out "' + $Txt + '"'

function Get-Ours { Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue }

if ($Status) {
    $t = Get-Ours
    if ($t) { 'RUNNING stops at ' + ([datetime]$t.Triggers[0].StartBoundary).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { 'NOT RUNNING' }
    & pktmon status 2>&1 | ForEach-Object { '  ' + $_ }
    foreach ($f in $Etl, $Txt) { if (Test-Path -LiteralPath $f) { '{0} {1} bytes, {2:yyyy-MM-ddTHH:mm:ssZ}' -f $f, (Get-Item -LiteralPath $f).Length, (Get-Item -LiteralPath $f).LastWriteTimeUtc } }
    exit 0
}

if ($Stop) {
    if (-not (Get-Ours)) { 'REFUSED no capture of this script is running, so nothing was changed'; exit 1 }
    Unregister-ScheduledTask -TaskName $Task -Confirm:$false
    & cmd.exe /c $End 2>&1 | ForEach-Object { '  ' + $_ }
    'STOPPED'
    exit 0
}

# -Start
if (Get-Ours) { 'REFUSED a capture is already running; -Status says when it stops. Nothing was changed.'; exit 1 }
$list = (& pktmon filter list 2>&1 | Out-String)
$others = @([regex]::Matches($list, '(?m)^\s*\d+\s+(\S+)') | ForEach-Object { $_.Groups[1].Value } | Where-Object { $Filters -notcontains $_ })
if ($others.Count) { 'REFUSED pktmon has filters this script did not add (' + ($others -join ', ') + '), and the end of a capture removes every filter. Nothing was changed.'; exit 1 }
if (-not (Test-Path -LiteralPath $Watch -PathType Container)) { 'REFUSED the watchdog''s folder ' + $Watch + ' is not on this box, and the capture is kept inside it (Watch-Services.ps1 -Install makes it). Nothing was changed.'; exit 1 }
if (-not (Test-Path -LiteralPath $Dir)) { $null = New-Item -ItemType Directory -Path $Dir }

& pktmon filter remove | Out-Null
& pktmon filter add $Filters[0] -t TCP SYN -p 443
& pktmon filter add $Filters[1] -t TCP RST -p 443
& pktmon start --capture --comp nics --pkt-size 128 --file-name $Etl --file-size 64 --log-mode circular
if ($LASTEXITCODE -ne 0) {
    & pktmon filter remove | Out-Null
    'REFUSED pktmon start failed (exit ' + $LASTEXITCODE + '); the filters were removed again'
    exit 1
}

$at = (Get-Date).AddMinutes($Minutes)
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c ' + $End + ' & schtasks /delete /tn "' + $Task + '" /f')
$trigger = New-ScheduledTaskTrigger -Once -At $at
$who = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Principal $who | Out-Null
'STARTED {0} min, stops at {1:yyyy-MM-ddTHH:mm:ssZ}' -f $Minutes, $at.ToUniversalTime()
exit 0
