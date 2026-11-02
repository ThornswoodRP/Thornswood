<#
  Keep-RunnerLogs.ps1

      .\scripts\vps\Keep-RunnerLogs.ps1            what the task last did, and how much _diag holds
      .\scripts\vps\Keep-RunnerLogs.ps1 -Install   put the daily task on the box
      .\scripts\vps\Keep-RunnerLogs.ps1 -Remove    take the task off again

  The build runners on the box keep every log they write in their _diag
  folders and nothing ever removed one: 1.6 GB and about 4,000 files on
  21 Oct 2026, the oldest from 25 Sep (#3184). -Install puts vps-runner-logs.ps1
  on the box as C:\Thornswood-Watch\runner-logs.ps1 and a task that runs it at
  4:30 AM every day as SYSTEM, which removes the runner and worker logs older
  than 14 days. vps-runner-logs.ps1 says exactly what it removes. Runs ssh to
  the box like the other scripts here, so it works from One and, after
  Setup-CloudSsh.ps1, from a cloud thread.
#>
[CmdletBinding()]
param(
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Root = 'C:\Thornswood-Watch',
  [string]$Task = 'Thornswood Runner Logs',
  [int]$Days = 14,
  [switch]$Install,
  [switch]$Remove,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Vps.ps1')
. (Join-Path $Here 'Send-Script.ps1')
. (Join-Path $Here 'Lock-Folder.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}
# What the box answers is kept in $said, as Watch-Load.ps1 does (#2061).
function Remote($script) {
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}
function Show($said) {
  $failed = $false
  foreach ($l in $said) {
    $c = 'Gray'
    if ("$l" -match '^FAILED') { $c = 'Red'; $failed = $true }
    if ("$l" -match '^(wrote|made|task)') { $c = 'Green' }
    Say "  $l" $c
  }
  return $failed
}

Write-Host ''
Write-Host '  THORNSWOOD  -  the build runners'' own logs, kept two weeks' -ForegroundColor White

if ($Remove) {
  Head 'Taking it off'
  $said = Remote @"
`$ErrorActionPreference = 'Continue'
`$null = & schtasks /delete /tn '$Task' /f 2>&1
if (`$LASTEXITCODE -eq 0) { 'the task is gone' } else { 'there was no task called $Task' }
"@
  $null = Show $said
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

if ($Install) {
  $keeper = Join-Path $Here 'vps-runner-logs.ps1'
  if (-not (Test-Path -LiteralPath $keeper)) { Die 'There is no vps-runner-logs.ps1 next to this script.' }
  $errs = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($keeper, [ref]$null, [ref]$errs)
  if ($errs -and $errs.Count) { Die ('vps-runner-logs.ps1 does not parse: ' + $errs[0].Message + '. Nothing was sent.') }

  Head 'Putting it on the box'
  # Sent as base64 and written out there byte for byte, as Watch-Load.ps1 does.
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keeper))
  $said = Remote @"
`$ErrorActionPreference = 'Continue'
$(Get-ThornswoodLockedFolderScript $Root)
[IO.File]::WriteAllBytes('$Root\runner-logs.ps1', [Convert]::FromBase64String('$b64'))
'wrote     $Root\runner-logs.ps1  ' + (Get-Item '$Root\runner-logs.ps1').Length + ' bytes'
# Daily at 4:30 AM, after the nightly checks and the backup, as SYSTEM.
`$null = & schtasks /create /tn '$Task' /sc daily /st 04:30 /ru SYSTEM /rl HIGHEST /f /tr 'pwsh -NoProfile -ExecutionPolicy Bypass -File $Root\runner-logs.ps1 -Days $Days' 2>&1
if (`$LASTEXITCODE -eq 0) { 'made      the task, daily at 4:30 AM, keeping $Days days' } else { 'FAILED    schtasks exited with ' + `$LASTEXITCODE }
# Once now, so the 1.6 GB goes today and any problem shows here.
`$null = & schtasks /run /tn '$Task' 2>&1
Start-Sleep -Seconds 20
if (Test-Path '$Root\runner-logs.log') { Get-Content '$Root\runner-logs.log' -Tail 5 | ForEach-Object { 'log       ' + `$_ } } else { 'FAILED    the first run wrote no runner-logs.log yet' }
if (Get-ScheduledTask -TaskName '$Task' -EA SilentlyContinue) { 'task      $Task is registered' } else { 'FAILED    there is no task called $Task after making it' }
"@
  $failed = Show $said
  $text = (@($said) | ForEach-Object { "$_" }) -join "`n"
  if ($text -notmatch '(?m)^made\s') { $failed = $true; Say '  the box never said it made the task' 'Red' }
  if ($text -notmatch '(?m)^task\s+.* is registered') { $failed = $true; Say '  the box never said the task is registered' 'Red' }
  if ($failed) { Die 'The task did not take on the box. Read the lines above, then run -Install again.' }
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

Head 'The task, and what _diag holds'
$said = Remote @"
`$ErrorActionPreference = 'Continue'
`$t = Get-ScheduledTask -TaskName '$Task' -EA SilentlyContinue
if (`$t) {
  `$i = Get-ScheduledTaskInfo -TaskName '$Task'
  'task      ' + `$t.State + ', last ran ' + `$i.LastRunTime + ', result ' + `$i.LastTaskResult
} else { 'FAILED    the task is not installed. Run this with -Install' }
foreach (`$r in @(Get-ChildItem -LiteralPath 'C:\' -Directory -Force | Where-Object { `$_.Name -match '^Thornswood-Runner\d*$' })) {
  `$fs = @(Get-ChildItem -LiteralPath (Join-Path `$r.FullName '_diag') -File -Recurse -Force -EA SilentlyContinue)
  `$old = @(`$fs | Sort-Object LastWriteTime | Select-Object -First 1)
  '{0,-24} {1,6} files {2,8:N1} MB  oldest {3}' -f `$r.Name, `$fs.Count, ((`$fs | Measure-Object Length -Sum).Sum / 1MB), `$(if (`$old) { `$old[0].LastWriteTime.ToString('yyyy-MM-dd') } else { '-' })
}
if (Test-Path '$Root\runner-logs.log') { Get-Content '$Root\runner-logs.log' -Tail 5 | ForEach-Object { 'log       ' + `$_ } }
"@
$failed = Show $said
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
exit ([int]$failed)
