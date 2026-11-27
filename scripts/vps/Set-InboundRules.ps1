<#
.SYNOPSIS
  Turns off every enabled inbound Allow firewall rule on the box that records\prod-parity.json does not list ("inboundRules"), WinRM from any address among them, and says which (#3807); with -Own, moves the rules the box keeps into its own firewall policy and has the firewall ignore local rules (#3896).

.DESCRIPTION
  Issue #3807, measured on 26 Oct 2026. The scripts that make firewall rules
  (Bootstrap-VPS.ps1, vps-dev-instance.ps1, Setup-Domain.ps1,
  Install-Voice.ps1, Deploy-Docs.ps1) and the ones that scope them
  (Set-WebFirewall.ps1, Set-SshScope.ps1) each look after their own rules.
  Nothing looked after the rest, so "Allow WinRM HTTPS" (TCP 5986 from any
  address, made by hand, no group, no description), two old SkyMP copies of
  the game rules and the inbound rules Windows Server enables by default
  stayed on. This is the owner of the rest: the list names every rule the
  box keeps and why, and every other enabled one is turned off.

  Runs on your machine, or in a cloud thread after Setup-CloudSsh.ps1. In
  this order, and it stops at the first thing that is not right:

    1. The list, from records\prod-parity.json "inboundRules": each entry a
       rule's Name or DisplayName, whether it is required, and why. An empty
       list, an entry with no name or no reason, or a name twice stops it.
    2. The box's own key. known_hosts here must hold the host key
       scripts\vps\vps.json pins.
    3. On the box: scripts\vps\vps-inbound-rules.ps1 runs there, sent
       through Send-Script.ps1. It reads every inbound Allow rule, says KEPT
       or OUTSIDE for each enabled one, checks every required rule is there
       and on, reads who made each OUTSIDE rule from the firewall's own log,
       and says WinRM's state, the box's IPv6 addresses and what listens on
       every interface. Only then does it turn the OUTSIDE rules off, and
       reads each back.

  -Check only reads, and exits 2 when a rule is outside the list or a
  required one is missing, so it is a check that fails. -WhatIf runs step 3
  read only and prints what WOULD change.

  Nothing restarts and nothing is deleted: a rule turned off is still on the
  box, and a connection already open stays open. ssh is never touched (a
  rule that takes TCP 22 is Set-SshScope.ps1's, and the bridge reaches sshd
  on 127.0.0.1), and neither are the game, resources and web rules, which
  are on the list as required.

  THE WAY BACK, for one rule, on the box (Remote.ps1, or the VNC console in
  the provider's panel):
      Enable-NetFirewallRule -PolicyStore localhost -Name '<the Name in its CHANGED line>'; gpupdate /target:computer /force
  (a rule the line says was local: Enable-NetFirewallRule -Name '<Name>').
  A rule that should stay on goes on the list in records\prod-parity.json,
  with why, in the same pull request as whatever needs it.

  -OWN (#3896). Edge's setup adds an inbound mDNS rule with every version,
  WebView2's one per version, and any installer can add others, because the
  firewall took every local rule. Patrick, 27 Oct 2026: the box's own policy
  holds every rule and local rules are ignored (scripts\vps\BoxFirewall.ps1
  is the rule every script follows). -Own sends
  scripts\vps\vps-firewall-policy.ps1 with the same list: it checks the
  policy store takes a rule (a probe rule, turned off, made and taken away),
  copies every listed inbound Allow rule and every Block rule into the policy
  store, refreshes Group Policy and reads each back as taken from there, and
  only then turns local rules off for every profile and reads the required
  rules back. -Own -Check only reads, and exits 2 until that is done. -Own
  -WhatIf says what it would do. Its way back is in that script's header.

.PARAMETER Check
  Only say how the rules stand. Nothing is changed. Exit 2 when any rule is
  outside the list or a required one is missing.

.PARAMETER Own
  Move the rules into the box's own firewall policy and have the firewall
  ignore local rules (#3896), instead of turning rules off.

.PARAMETER Vps
  The box's address. vps.json's by default.

.PARAMETER User
  The account the scripts log in as. vps.json's by default (Administrator).

.PARAMETER KnownHosts
  The known_hosts file that must already hold the pinned key.

.PARAMETER Record
  The record holding the list. records\prod-parity.json by default.

.PARAMETER NoPause
  Do not wait for Enter before closing.

.EXAMPLE
  .\scripts\vps\Set-InboundRules.ps1 -Check
  Says which rules are outside the list. Changes nothing.

.EXAMPLE
  .\scripts\vps\Set-InboundRules.ps1 -WhatIf
  Says what it would turn off.

.EXAMPLE
  .\scripts\vps\Set-InboundRules.ps1 -NoPause
  Turns off every enabled inbound Allow rule outside the list.

.EXAMPLE
  .\scripts\vps\Set-InboundRules.ps1 -Own -WhatIf
  Says which rules it would move into the box's policy, and that it would
  then have the firewall ignore local rules.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [switch]$Check,
    [switch]$Own,
    [string]$Vps = '',
    [string]$User = '',
    [string]$KnownHosts = '',
    [string]$Record = '',
    [switch]$NoPause
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here 'Send-Script.ps1')
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $KnownHosts) { $KnownHosts = Get-ThornswoodKnownHostsPath -Address $Vps }
if (-not $Record) { $Record = [IO.Path]::Combine((Split-Path -Parent (Split-Path -Parent $Here)), 'records', 'prod-parity.json') }

$BoxScript = Join-Path $Here $(if ($Own) { 'vps-firewall-policy.ps1' } else { 'vps-inbound-rules.ps1' })
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) { Write-Host ''; if (-not $NoPause) { [void](Read-Host 'Enter to close') }; exit $code }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; Done 1 }

# The box's answer as lines, the empty ones left out. A warning ssh prints
# stays in, so one that starts is seen (#1043, #4385).
function Clean($lines) {
    @($lines | ForEach-Object { [string]$_ } | Where-Object { $_ })
}

# The list as the box script takes it: base64 of UTF-8 JSON, so no name's
# spaces, brackets or quotes are read by a shell on the way.
function Read-InboundList([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "There is no $Path." }
    $rec = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $entries = @($rec.inboundRules | Where-Object { $null -ne $_ })
    if (-not $entries.Count) { throw "$Path lists no inboundRules, so every rule on the box would be turned off." }
    $seen = @{}
    foreach ($e in $entries) {
        $n = [string]$e.rule
        if (-not $n.Trim()) { throw "An entry in $Path inboundRules has no rule name." }
        if (-not ([string]$e.why).Trim()) { throw "'$n' in $Path inboundRules says no why." }
        if ($seen.ContainsKey($n)) { throw "'$n' is in $Path inboundRules twice." }
        $seen[$n] = $true
    }
    $slim = @($entries | ForEach-Object { [ordered]@{ rule = [string]$_.rule; required = [bool]$_.required } })
    return [pscustomobject]@{ Entries = $entries; Arg = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $slim -Compress))) }
}

function Invoke-Box([string]$mode) {
    if (-not (Test-Path -LiteralPath $BoxScript)) { Die "There is no $BoxScript. Nothing was sent." }
    $script = Get-ThornswoodFileScript -Path $BoxScript -Arguments $mode
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = Clean @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script ("`$ProgressPreference = 'SilentlyContinue'`r`n" + $script))
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    foreach ($l in $out) {
        $c = 'Gray'
        if ($l -match '^(CHANGED|COPIED|ACTIVE|PROBE) ' -or $l -match '^RULE KEPT ') { $c = 'Green' }
        elseif ($l -match '^(WOULD|LEFT|REQUIRED|MOVE) ' -or $l -match '^RULE OUTSIDE ') { $c = 'Yellow' }
        elseif ($l -match '^STOP ') { $c = 'Red' }
        elseif ($l -match '^(ALREADY|LIST|ORIGIN|EVENT|WINRM|ADDRESS|LISTEN|PROFILE|HELD|IGNORED|DONE) ') { $c = 'DarkGray' }
        Say "  $l" $c
    }
    return [pscustomobject]@{ Code = $rc; Lines = $out }
}
function Has($lines, [string]$rx) { return (@($lines | Where-Object { $_ -match $rx }).Count -gt 0) }

Write-Host ''
Write-Host $(if ($Own) { '  THORNSWOOD  -  the box''s own firewall policy holds its rules' } else { '  THORNSWOOD  -  the inbound rules the box keeps' }) -ForegroundColor White
Say "  $User@$Vps" 'DarkGray'

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Die 'ssh is not on PATH. Windows ships it: Settings, Apps, Optional features, OpenSSH Client.' }

Head '1. The list'
try { $list = Read-InboundList $Record } catch { Die ($_.Exception.Message + ' Nothing was changed.') }
Say ('  ' + $list.Entries.Count + ' rules from ' + $Record + ', ' + @($list.Entries | Where-Object { $_.required }).Count + ' required') 'Green'
$listArg = "-List '" + $list.Arg + "'"

Head "2. The box's own key"
$hk = Test-ThornswoodKnownHost -Address $Vps -KnownHosts $KnownHosts
if ($hk.Status -ne 'trusted') {
    Die ("known_hosts does not hold the key scripts\vps\vps.json pins for $Vps (" + $hk.Status + '). Run .\scripts\vps\Setup-SshKey.ps1 first. Nothing was changed.')
}
Say '  known_hosts holds the pinned key' 'Green'

if ($Check -and $Own) {
    Head '3. On the box, read only'
    $box = Invoke-Box ('-Check ' + $listArg)
    if (Has $box.Lines '^STOP ') { Die ('The box stopped (exit ' + $box.Code + '). The lines above say why.') }
    $done = @($box.Lines | Where-Object { $_ -match '^DONE read only, (\d+) thing\(s\) left' }) | Select-Object -Last 1
    if (-not $done) { Die ('The box did not say how its policy stands (exit ' + $box.Code + '). Run .\scripts\vps\Setup-SshKey.ps1 -Test if it did not answer at all.') }
    [void]($done -match '^DONE read only, (\d+) thing')
    if ([int]$Matches[1]) { Write-Host ''; Say ('  ' + $Matches[1] + ' thing(s) left before the box''s policy holds every rule (the MOVE, REQUIRED and PROFILE lines above).') 'Yellow'; Done 2 }
    Write-Host ''; Say '  The box''s policy holds every rule it keeps, and the firewall ignores local rules.' 'Green'
    Done 0
}

if ($Check) {
    Head '3. On the box, read only'
    $box = Invoke-Box ('-Check ' + $listArg)
    if (Has $box.Lines '^STOP ') { Die ('The box stopped (exit ' + $box.Code + '). The lines above say why.') }
    $done = @($box.Lines | Where-Object { $_ -match '^DONE read only, (\d+) rule\(s\) outside the list, (\d+) required' }) | Select-Object -Last 1
    if (-not $done) { Die ('The box did not say how the rules stand (exit ' + $box.Code + '). Run .\scripts\vps\Setup-SshKey.ps1 -Test if it did not answer at all.') }
    [void]($done -match '^DONE read only, (\d+) rule\(s\) outside the list, (\d+) required')
    if ([int]$Matches[1] -or [int]$Matches[2]) { Write-Host ''; Say ('  ' + $Matches[1] + ' rule(s) outside the list and ' + $Matches[2] + ' required rule(s) missing or off.') 'Yellow'; Done 2 }
    Write-Host ''; Say '  Every enabled inbound Allow rule is on the list, and every required one is on.' 'Green'
    Done 0
}

$doIt = $PSCmdlet.ShouldProcess("$User@$Vps", $(if ($Own) { 'move the rules the box keeps into its own firewall policy and have the firewall ignore local rules' } else { 'turn off every enabled inbound Allow firewall rule that records\prod-parity.json does not list' }))
Head $(if ($doIt) { '3. On the box' } else { '3. On the box, read only' })
$mode = @('-Apply', $listArg)
if (-not $doIt) { $mode += '-DryRun' }
$box = Invoke-Box ($mode -join ' ')
if (Has $box.Lines '^STOP ') { Die ('The box stopped (exit ' + $box.Code + '). The lines above say why; anything before the STOP line was done.') }
if ($box.Code -ne 0 -or -not (Has $box.Lines '^DONE ')) { Die ('The box did not finish (exit ' + $box.Code + '). Run this with -Check to read where it stands.') }
if (-not $doIt) { Write-Host ''; Say 'Nothing was changed. Run it again without -WhatIf to make the changes above.' 'Yellow'; Done 0 }
Write-Host ''
Say $(if ($Own) { '  Done. Set-InboundRules.ps1 -Own -Check and -Check say how they stand now, and Check-Site.ps1 whether the site still answers.' } else { '  Done. Set-InboundRules.ps1 -Check says how they stand now, and Check-Site.ps1 whether the site still answers.' }) 'Green'
Done 0
