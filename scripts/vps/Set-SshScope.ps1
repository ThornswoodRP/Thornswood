<#
.SYNOPSIS
  Limits which addresses may reach ssh on the VPS (port 22), after proving key login, refusing a list that leaves this machine out, and with a put back the box runs by itself if the new login fails.

.DESCRIPTION
  Issue #2182, decision 2 (Patrick, 11 Oct 2026): restrict the inbound rules on
  port 22 to known addresses, and only once the hosting provider's console
  login is confirmed working, because the console is the way back in if no
  address in the list can reach ssh any more. This script does not check the
  console; the person running it does that first.

  Runs on your machine. In this order, and it stops at the first thing that
  is not right, with nothing changed:

    1. The box's own key. known_hosts here must hold the host key
       scripts\vps\vps.json pins.
    2. Key login, before anything else.
    3. On the box: scripts\vps\vps-ssh-scope.ps1 runs there, sent through
       Send-Script.ps1, whose run deletes a long script's copy before it
       runs (#3035, #3059; until 21 Oct 2026 it was copied into
       C:\Windows\Temp and removed after, and a run cut short left the copy
       there). It refuses a list that does not
       hold the address this session comes from, a rule for every port that
       would let 22 in anyway, and a rule for 22 shared with other ports.
       Then it saves the rules' remote addresses as they are, arms a task
       that puts them back in ten minutes ("Thornswood ssh scope rollback"),
       and sets each port 22 rule's remote addresses to the list.
    4. After: a NEW key login from here, which only gets in if this machine's
       address really is allowed. Only then is the put back task cancelled.
       If the login fails, nothing is cancelled and the box puts the old
       rules back by itself within ten minutes.
    5. The port 22 rules as the box now has them.

  -WhatIf does steps 1 and 2 and runs step 3 read only: it prints what WOULD
  change.

  -From Any opens port 22 to every address again, the same way.

  -From None shuts port 22 to every outside address (#2891): the rules take
  127.0.0.1 alone, which is how the bridge reaches sshd, so the only way in
  is the bridge, each machine with its own key and token
  (Grant-BoxAccess.ps1). It only runs from a machine whose ssh already goes
  through the bridge, and the new login that proves it goes the same way. A
  home address that changes then stops nothing. The way back when the
  bridge or Caddy is down is the console, below.

  With a list of addresses instead, every address that needs ssh has to be
  in it: this machine, every other machine that deploys or ships (each
  developer's own). A home address that changes drops out of the list and that
  machine loses ssh until the list is changed from a machine still in it, or
  from the console.

  THE WAY BACK, BY HAND, if no machine can reach ssh (an address list that
  lost its address, or with None the bridge or Caddy down). The VPS
  provider's panel (BisectHosting, VirtFusion) has a console for the server
  that does not use the network: open the server there, open its VNC
  console, sign in as Administrator with the Windows password, and in
  PowerShell. With None, start the bridge and Caddy first, which is all a
  stopped one needs:
      Start-ScheduledTask 'Thornswood Bridge'; Start-ScheduledTask 'Thornswood Web'
  To put the rules back as they were before the last change instead:
      Get-ChildItem C:\ProgramData\ssh\ssh-scope-before-*.json
      $s = Get-Content -Raw <the newest of those> | ConvertFrom-Json
      foreach ($r in $s.rules) { if ($r.store -eq 'Local') { Set-NetFirewallRule -PolicyStore PersistentStore -Name $r.name -RemoteAddress @($r.remote) } else { Set-NetFirewallRule -PolicyStore localhost -Name $r.name -RemoteAddress @($r.remote) } }
      gpupdate /target:computer /force
  (the rules live in the box's own policy store, scripts\vps\BoxFirewall.ps1, #3896;
  a file from before that has no store and goes to the policy store)

.PARAMETER From
  The addresses that may reach port 22, comma separated: 203.0.113.7,
  198.51.100.0/24, 2001:db8::/48, or Any, or None (only the bridge).

.PARAMETER Vps
  The box's address. vps.json's by default.

.PARAMETER User
  The account the scripts log in as. vps.json's by default (Administrator).

.PARAMETER KnownHosts
  The known_hosts file that must already hold the pinned key.

.PARAMETER SettleSeconds
  How long to wait after the change before the new login. 3 by default.

.PARAMETER NoPause
  Do not wait for Enter before closing.

.EXAMPLE
  .\scripts\vps\Set-SshScope.ps1 -From 203.0.113.7,198.51.100.20 -WhatIf
  Proves key login and says what would change. Changes nothing.

.EXAMPLE
  .\scripts\vps\Set-SshScope.ps1 -From 203.0.113.7,198.51.100.20
  Makes the change, then proves a new key login from here still gets in.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)][string[]]$From,
    [string]$Vps = '',
    [string]$User = '',
    [string]$KnownHosts = '',
    [int]$SettleSeconds = 3,
    [switch]$NoPause
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Send-Script.ps1')
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $KnownHosts) { $KnownHosts = Get-ThornswoodKnownHostsPath -Address $Vps }

$BoxScript = Join-Path $Here 'vps-ssh-scope.ps1'
$Rollback = 'Thornswood ssh scope rollback'
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')
$list = (@($From | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })) -join ','

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Done 1 }

function Clean($lines) {
    @($lines | ForEach-Object { [string]$_ } | Where-Object { $_ })
}

# A new connection with the key and nothing else.
function Test-KeyLogin {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(Invoke-ThornswoodNative { & ssh @ssh -o PreferredAuthentications=publickey "$User@$Vps" 'echo THORNSWOOD_KEY_OK' } 2>&1 | ForEach-Object { [string]$_ })
    $ErrorActionPreference = $old
    return (($out -join "`n") -match 'THORNSWOOD_KEY_OK')
}

function Invoke-Encoded([string]$script) {
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("`$ProgressPreference = 'SilentlyContinue'`r`n" + $script))
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = Clean @(Invoke-ThornswoodNative { & ssh @ssh "$User@$Vps" "pwsh -NoProfile -EncodedCommand $enc" } 2>&1)
    $ErrorActionPreference = $old
    return $out
}

# vps-ssh-scope.ps1 runs on the box from ssh's standard input, as
# Harden-VPS.ps1 sends its own (Send-Script.ps1), so a run cut short at any
# point leaves nothing of it there (#3035).
function Invoke-Box([bool]$dry) {
    if (-not (Test-Path -LiteralPath $BoxScript)) { Die "There is no $BoxScript. Nothing was sent." }
    $a = "-From '" + $list.Replace("'", "''") + "'"
    if ($dry) { $a += ' -DryRun' }
    $script = Get-ThornswoodFileScript -Path $BoxScript -Arguments $a
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = Clean @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script ("`$ProgressPreference = 'SilentlyContinue'`r`n" + $script))
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    foreach ($l in $out) {
        $c = 'Gray'
        if ($l -match '^CHANGED ') { $c = 'Green' }
        elseif ($l -match '^(WOULD|WARN) ') { $c = 'Yellow' }
        elseif ($l -match '^STOP ') { $c = 'Red' }
        elseif ($l -match '^(ALREADY|KEPT) ') { $c = 'DarkGray' }
        Say "  $l" $c
    }
    return [pscustomobject]@{ Code = $rc; Lines = $out }
}

Write-Host ''
Write-Host '  THORNSWOOD  -  who may reach ssh' -ForegroundColor White
Say "  $User@$Vps, port 22 from $list" 'DarkGray'

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Die 'ssh is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client.' }
if (-not $list) { Die 'No addresses given. Pass -From with the list, or -From Any.' }

Head "1. The box's own key"
$hk = Test-ThornswoodKnownHost -Address $Vps -KnownHosts $KnownHosts
if ($hk.Status -ne 'trusted') {
    Die ("known_hosts does not hold the key scripts\vps\vps.json pins for $Vps (" + $hk.Status + '). Run .\scripts\vps\Setup-SshKey.ps1 first. Nothing was changed.')
}
Say '  known_hosts holds the pinned key' 'Green'

if ($list -eq 'None' -and -not (Test-ThornswoodBridgeSsh $Vps)) {
    Die "ssh to $Vps from here does not go through the bridge, so shutting port 22 would cut this machine off. Run .\scripts\vps\Grant-BoxAccess.ps1 -Name <this machine> -ThisMachine first. Nothing was changed."
}

Head '2. Key login, before anything else'
if (-not (Test-KeyLogin)) { Die "Key login as $User is not proven. Run .\scripts\vps\Setup-SshKey.ps1 -Test until it works. Nothing was changed." }
Say "  $User gets in with the key alone" 'Green'

$doIt = $PSCmdlet.ShouldProcess("$User@$Vps", "let only $list reach port 22")
Head $(if ($doIt) { '3. On the box' } else { '3. On the box, read only' })
$box = Invoke-Box (-not $doIt)
if ($box.Code -ne 0 -or @($box.Lines | Where-Object { $_ -match '^STOP ' }).Count) {
    $armed = @($box.Lines | Where-Object { $_ -match ('^CHANGED .*' + [regex]::Escape($Rollback)) }).Count -gt 0
    Die ('The box stopped (exit ' + $box.Code + '). The lines above say where.' + $(if ($armed) { " The task '$Rollback' is armed and puts the rules back within ten minutes." } else { '' }))
}
if (-not @($box.Lines | Where-Object { $_ -match '^DONE ' }).Count) {
    Die 'The box did not answer with its summary line, so what it did is not known. Run this again with -WhatIf to read where it stands.'
}
if (-not $doIt) { Write-Host ''; Say 'Nothing was changed. Run it again without -WhatIf to make the changes above.' 'Yellow'; Done 0 }
$armed = @($box.Lines | Where-Object { $_ -match ('^CHANGED .*' + [regex]::Escape($Rollback)) }).Count -gt 0
if (-not $armed) { Say '  nothing to change' 'Green'; Done 0 }

Head '4. A new key login from here'
if ($SettleSeconds -gt 0) { Start-Sleep -Seconds $SettleSeconds }
# One try. A login that fails here leaves the put back armed, which is the
# safe way to be wrong: the box reopens by itself within ten minutes.
if (-not (Test-KeyLogin)) {
    Die ("A new key login does not get in, so this machine's address is not let through. The box puts the old rules back by itself within ten minutes (task '$Rollback'); " +
         'then run .\scripts\vps\Setup-SshKey.ps1 -Test. If ssh is still refused after fifteen minutes, the way back is in Get-Help .\scripts\vps\Set-SshScope.ps1 -Full.')
}
Say "  a new key login as $User gets in" 'Green'
$said = (Invoke-Encoded ("Unregister-ScheduledTask -TaskName '$Rollback' -Confirm:`$false -ErrorAction SilentlyContinue`r`nif (Get-ScheduledTask -TaskName '$Rollback' -ErrorAction SilentlyContinue) { 'ROLLBACK_STILL_ARMED' } else { 'ROLLBACK_CANCELLED' }")) -join ' '
if ($said -notmatch 'ROLLBACK_CANCELLED') { Die "Could not cancel the task '$Rollback', so the box will put the old rules back within ten minutes. Run this again once that has happened." }
Say "  CHANGED the put back task is cancelled, so the change stays" 'Green'

Head '5. Port 22 on the box now'
$read = Invoke-Encoded @'
foreach ($r in @(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Enabled True -Action Allow -ErrorAction SilentlyContinue)) {
  $pf = $r | Get-NetFirewallPortFilter
  if (@($pf.LocalPort) -notcontains '22') { continue }
  $af = $r | Get-NetFirewallAddressFilter
  'rule      ' + $r.DisplayName + ': from ' + (@($af.RemoteAddress) -join ', ')
}
'@
foreach ($l in $read) { Say "  $l" }
Done 0
