<#
  Check-ServiceOwners.ps1

      .\scripts\vps\Check-ServiceOwners.ps1

  Reads, and changes nothing: whether one box service can still reach what
  another makes through LOCAL SERVICE, the account they all run as (#4077).

  For every C:\Thornswood* folder but the build runners' (which run as
  accounts of their own), it counts what LOCAL SERVICE owns, because a
  file's owner may read and change its rules, and every Allow rule that
  names LOCAL SERVICE and lets it read, run, or change rules or owner; a rule
  that only writes, the crash dump folder's, is allowed. For every task
  that runs as LOCAL SERVICE it says whether the task starts through
  thornswood-owner.exe, which makes what the service makes its own
  (scripts\deploy\ServiceAccount.ps1). Each installer puts that right on its
  next run; the ops repo's run note for #4077 lists them.

  Ends with NO SERVICE REACHES ANOTHER and exit 0, or LOCAL SERVICE STILL
  REACHES and exit 1, naming each folder and task. It reads every file's
  rules, so it takes a minute or two.
#>
[CmdletBinding()]
param(
    [string]$Vps  = '',
    [string]$User = ''
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here 'Vps.ps1')
. (Join-Path $Here 'Send-Script.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')

# Runs on the box, in PowerShell 7. One line per finding, then one
# RESULT line.
$far = @'
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$ls = 'S-1-5-19'
# Read data, read attributes and extended attributes, execute, read rules,
# change rules, change owner, and the generic read, execute and all.
$reach = [long]0xB00E00A9
$bad = 0
$s = [Security.AccessControl.AccessControlSections]'Owner, Access'
foreach ($root in @(Get-ChildItem -LiteralPath 'C:\' -Directory -Force | Where-Object { $_.Name -like 'Thornswood*' -and $_.Name -notlike 'Thornswood-Runner*' } | Sort-Object Name)) {
  $owned = 0; $rules = 0; $unread = 0
  foreach ($i in @(@(Get-Item -LiteralPath $root.FullName -Force) + @(Get-ChildItem -LiteralPath $root.FullName -Recurse -Force -EA SilentlyContinue))) {
    $a = $null
    try { if ($i -is [IO.DirectoryInfo]) { $a = [IO.FileSystemAclExtensions]::GetAccessControl([IO.DirectoryInfo]$i, $s) } else { $a = [IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]$i, $s) } } catch { <# counted as UNREAD below and named on its line, so it is not passed as clear #> }
    if (-not $a) { $unread++; continue }
    if ($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $ls) { $owned++ }
    foreach ($r in @($a.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
      if ($r.IdentityReference.Value -ne $ls -or [string]$r.AccessControlType -ne 'Allow') { continue }
      if (([long][int]$r.FileSystemRights -band $reach) -ne 0) { $rules++ }
    }
  }
  if ($owned -or $rules) {
    $bad++
    'REACHED  ' + $root.FullName + ': LOCAL SERVICE owns ' + $owned + ' and ' + $rules + ' rule(s) let it in'
  } else { 'clear    ' + $root.FullName }
  if ($unread) { 'UNREAD   ' + $root.FullName + ': ' + $unread + ' item(s) whose rules this account could not read' }
}
foreach ($t in @(Get-ScheduledTask -TaskName 'Thornswood*' -EA SilentlyContinue | Sort-Object TaskName)) {
  $sid = ''
  try { $sid = (New-Object Security.Principal.NTAccount([string]$t.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { <# an account that does not translate is not LOCAL SERVICE, which always does #> }
  if ($sid -ne $ls) { continue }
  $exe = [string]@($t.Actions)[0].Execute
  if ((Split-Path -Leaf $exe) -like 'thornswood-owner-*.exe') { 'owned    ' + $t.TaskName + ' starts through ' + $exe }
  else { $bad++; 'PLAIN    ' + $t.TaskName + ' starts ' + $exe + ' itself, so what it makes is LOCAL SERVICE''s' }
}
if ($bad) { 'RESULT|LOCAL SERVICE STILL REACHES' } else { 'RESULT|NO SERVICE REACHES ANOTHER' }
'@

$lines = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $far | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
$result = ''
foreach ($l in $lines) {
    if ($l -like 'RESULT|*') { $result = $l.Substring(7); continue }
    $c = if ($l -match '^(REACHED|PLAIN|UNREAD)') { 'Red' } else { 'Gray' }
    Write-Host ('  ' + $l) -ForegroundColor $c
}
Write-Host ''
if ($result -eq 'NO SERVICE REACHES ANOTHER') { Write-Host $result -ForegroundColor Green; exit 0 }
if ($result) { Write-Host $result -ForegroundColor Red } else { Write-Host 'THE BOX GAVE NO ANSWER' -ForegroundColor Red }
exit 1
