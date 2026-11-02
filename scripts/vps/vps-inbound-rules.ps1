<#
.SYNOPSIS
  Runs ON THE VPS, sent there by Set-InboundRules.ps1: turns off every enabled inbound Allow firewall rule that is not on the box's list, and says which (#3807).

.DESCRIPTION
  Do not run this by hand. Set-InboundRules.ps1 sends this file's text on
  ssh's standard input with the list from records\prod-parity.json
  ("inboundRules"), and pwsh runs it from there, so
  nothing of it is ever written on the box (#3035).

  WHY. Issue #3807, measured 26 Oct 2026. Bootstrap-VPS.ps1,
  vps-dev-instance.ps1, Setup-Domain.ps1, Install-Voice.ps1, Deploy-Docs.ps1
  and Set-WebFirewall.ps1 each add, scope or take away the rules they own.
  Nothing owned the rest, so whatever Windows Server enables by default, and
  every rule made by hand before the scripts, stayed on: "Allow WinRM HTTPS"
  on TCP 5986 from any address, two old copies of the game rules, and the
  Windows defaults for Delivery Optimization, DIAL, Cast to Device, AllJoyn,
  Teredo, IPHTTPS and mDNS. This is the owner of the rest: the list names
  every rule the box keeps, and anything else enabled is turned off.

  In this order, each step saying what it found:

    the list      every entry a rule's Name or DisplayName. An empty list
                  stops it.
    the rules     every enabled inbound Allow rule, one RULE line each,
                  KEPT (on the list) or OUTSIDE (not on it), with its group,
                  protocol, ports, remote addresses and program.
    the required  every entry the list marks required (the game, the dev
                  game and the web rules) is there and enabled. With -Apply
                  one missing stops it before anything is turned off, since
                  an old copy turned off would then be the only way in.
    who made it   for each OUTSIDE rule, its own properties (where it is
                  stored, its group, its description) and every "rule added"
                  or "rule changed" event the firewall's own log still
                  holds for it, with the account and program that made it.
    WinRM         the WinRM service's state and its listeners, as the
                  service says them.
    IPv6          every IPv6 address but link-local, with its interface, so
                  a tunnel (Teredo, 6to4, IP-HTTPS) in use shows before its
                  rule is turned off.
    listeners     what listens on every interface, TCP and UDP, with the
                  process.
    the change    with -Apply, each OUTSIDE rule turned off (never deleted,
                  so Enable-NetFirewallRule puts one back) and read back. A
                  rule that takes TCP port 22 is never touched: ssh's rules
                  are Set-SshScope.ps1's, and the bridge comes in through
                  them.

  Every line of output starts with one word: LIST, RULE, REQUIRED, ORIGIN,
  EVENT, WINRM, ADDRESS, LISTEN, CHANGED, WOULD (with -DryRun), ALREADY, LEFT, STOP or
  DONE. STOP means nothing after it was done, and the exit code is 1. With
  -Check the exit code is 2 when any rule is OUTSIDE or a required one is
  missing, so the check fails on a rule nobody listed.

  WHICH STORE (#3896). The rules are read as the firewall takes them (the
  active store), each with where it came from. A rule from the box's own
  policy is turned off there and Group Policy refreshed
  (scripts\vps\BoxFirewall.ps1); a local one, before
  Set-InboundRules.ps1 -Own has the firewall ignore local rules, in the local
  store.

  THE WAY BACK. A rule this turned off is still on the box, disabled:
      Enable-NetFirewallRule -PolicyStore localhost -Name '<its Name, from the CHANGED line>'; gpupdate /target:computer /force
  or, for one the CHANGED line says was local,
      Enable-NetFirewallRule -Name '<its Name>'

.PARAMETER Check
  Read all of it and change nothing.

.PARAMETER Apply
  Turn off every enabled inbound Allow rule that is not on the list.

.PARAMETER List
  The list, as base64 of UTF-8 JSON: an array of { "rule": ..., "required":
  true|false }. Set-InboundRules.ps1 makes it from records\prod-parity.json.

.PARAMETER DryRun
  With -Apply: read everything and say WOULD for each change.

.PARAMETER Layer
  A file that replaces the functions below that touch Windows. Only
  tests\test-3807-inbound-rules.ps1 passes it.
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Apply,
    [string]$List = '',
    [switch]$DryRun,
    [string]$Layer = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$FirewallLog = 'Microsoft-Windows-Windows Firewall With Advanced Security/Firewall'
$script:changes = 0
$script:outside = 0
$script:missing = 0
$script:stopped = $false

function Say([string]$word, [string]$what) { Write-Output ($word + ' ' + $what) }

# ---------------------------------------------------------------- the layer ---
# Everything that touches Windows goes through these, so the harness can put
# stand-ins in their place with -Layer and run the rest of this for real.

# Is this the box? scripts\vps\BoxGuard.ps1 (#3041).
# ---- BoxGuard.ps1 (copy) ----
function Get-ThornswoodBoxRefusal {
    # scripts\vps\BoxGuard.ps1 says why this asks Windows rather than looking
    # for the game, and why it refuses when it cannot tell (#3041).
    try { $type = [int](Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).ProductType }
    catch { return ('Windows did not say whether this is a server (' + $_.Exception.Message + '), so it is not taken for the box') }
    if ($type -eq 2 -or $type -eq 3) { return '' }
    if ($type -eq 1) { return 'this is a Windows workstation, a gaming PC or a developer''s machine, not the box' }
    return ('Windows gives this machine product type ' + $type + ', which is not a server, so it is not taken for the box')
}
# ---- end BoxGuard.ps1 ----

# ---- BoxFirewall.ps1 (copy) ----
function Sync-ThornswoodFirewall {
    # scripts\vps\BoxFirewall.ps1 (#3896): the firewall takes the box's policy
    # store when Group Policy is refreshed, so every change to the store ends here.
    $was = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $said = @(& gpupdate.exe /target:computer /force 2>&1 | ForEach-Object { [string]$_ } | Where-Object { $_.Trim() })
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $was
    if ($rc -ne 0) { throw ('gpupdate did not refresh the box''s policy, so the firewall has not taken the change (exit ' + $rc + '): ' + ($said -join ' ')) }
}
# ---- end BoxFirewall.ps1 ----

# Every inbound Allow rule the firewall takes, enabled or not, as Name, DisplayName, Enabled,
# Group, Protocol, Ports, Remote ('Any' when open to all), Program, Package
# (the Store app's container, '' when none), Service, Store (where the
# firewall took it from: GroupPolicy for the box's own policy, Local for the
# local store) and Description.
function Get-InboundRules {
    foreach ($r in @(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Action Allow -ErrorAction SilentlyContinue)) {
        $pf = $r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
        $af = $r | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue
        $ap = $r | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
        $sf = $r | Get-NetFirewallServiceFilter -ErrorAction SilentlyContinue
        [pscustomobject]@{
            Name = [string]$r.Name; DisplayName = [string]$r.DisplayName
            Enabled = ([string]$r.Enabled -eq 'True')
            Group = [string]$r.DisplayGroup
            Protocol = [string]$pf.Protocol
            Ports = @(@($pf.LocalPort) | ForEach-Object { [string]$_ })
            Remote = @(@($af.RemoteAddress) | ForEach-Object { [string]$_ })
            Program = [string]$ap.Program
            Package = [string]$ap.Package
            Service = [string]$sf.Service
            Store = [string]$r.PolicyStoreSourceType
            Description = [string]$r.Description
        }
    }
}
function Disable-Rule([string]$Name, [string]$Store) {
    if ($Store -eq 'GroupPolicy') { Disable-NetFirewallRule -PolicyStore localhost -Name $Name; Sync-ThornswoodFirewall }
    else { Disable-NetFirewallRule -PolicyStore PersistentStore -Name $Name }
}
function Test-RuleEnabled([string]$Name) { return (@(Get-NetFirewallRule -PolicyStore ActiveStore -Name $Name -ErrorAction SilentlyContinue | Where-Object { [string]$_.Enabled -eq 'True' }).Count -gt 0) }
# The firewall log's "rule added" (2004, 2097) and "rule changed" (2005,
# 2099) events, as Time, Id, RuleId, RuleName, User and Program, oldest
# first, and the time of the oldest event the log still holds.
function Get-RuleEvents {
    $all = @(Get-WinEvent -LogName $FirewallLog -Oldest -ErrorAction SilentlyContinue)
    $first = ''
    if ($all.Count) { $first = $all[0].TimeCreated.ToString('yyyy-MM-dd HH:mm') }
    $ev = @()
    foreach ($e in @($all | Where-Object { @(2004, 2005, 2097, 2099) -contains $_.Id })) {
        $d = @{}
        foreach ($x in ([xml]$e.ToXml()).Event.EventData.Data) { $d[[string]$x.Name] = [string]$x.'#text' }
        $ev += [pscustomobject]@{ Time = $e.TimeCreated.ToString('yyyy-MM-dd HH:mm'); Id = $e.Id; RuleId = $d['RuleId']; RuleName = $d['RuleName']; User = $d['ModifyingUser']; Program = $d['ModifyingApplication'] }
    }
    return [pscustomobject]@{ First = $first; Events = $ev }
}
# The WinRM service's state and start mode, and its listeners as
# "Transport port, address" lines, or why they could not be read.
function Get-WinRm {
    $svc = Get-CimInstance -ClassName Win32_Service -Filter "Name='WinRM'" -ErrorAction SilentlyContinue
    $state = 'not installed'
    if ($svc) { $state = [string]$svc.State + ', start ' + [string]$svc.StartMode }
    $listeners = @()
    if ($svc -and $svc.State -eq 'Running') {
        try {
            foreach ($l in @(Get-ChildItem -Path WSMan:\localhost\Listener -ErrorAction Stop)) {
                $keys = @($l.Keys) -join ' '
                $port = [string](Get-Item -Path (Join-Path $l.PSPath 'Port') -ErrorAction SilentlyContinue).Value
                $listeners += ($keys + ' port ' + $port)
            }
        } catch { $listeners += ('could not be read: ' + $_.Exception.Message) }
    }
    return [pscustomobject]@{ State = $state; Listeners = $listeners }
}
# Every IPv6 address that is not link-local or loopback, as Interface and
# Address: whether the box has IPv6 of its own, or only through a tunnel
# (Teredo, 6to4, ISATAP, IP-HTTPS) whose rule this would turn off.
function Get-Ipv6Addresses {
    foreach ($a in @(Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue | Where-Object { [string]$_.IPAddress -notmatch '^(fe80:|::1$)' })) {
        [pscustomobject]@{ Interface = [string]$a.InterfaceAlias; Address = [string]$a.IPAddress }
    }
}
# What listens on every interface, as Proto, Port and Process.
function Get-WideListeners {
    $procs = @{}
    foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) { $procs[[int]$p.Id] = [string]$p.ProcessName }
    $out = @()
    foreach ($c in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { @('0.0.0.0', '::') -contains [string]$_.LocalAddress })) {
        $out += [pscustomobject]@{ Proto = 'TCP'; Port = [int]$c.LocalPort; Process = $procs[[int]$c.OwningProcess] }
    }
    foreach ($c in @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { @('0.0.0.0', '::') -contains [string]$_.LocalAddress })) {
        $out += [pscustomobject]@{ Proto = 'UDP'; Port = [int]$c.LocalPort; Process = $procs[[int]$c.OwningProcess] }
    }
    return $out
}

if ($Layer) { . $Layer }

# ------------------------------------------------------------------ helpers ---
function Read-List([string]$Text) {
    if (-not $Text) { return @() }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Text))
    return @(ConvertFrom-Json $json | ForEach-Object { $_ })
}
function Find-Entry($Entries, $Rule) {
    foreach ($e in $Entries) { if ([string]$e.rule -eq $Rule.Name -or [string]$e.rule -eq $Rule.DisplayName) { return $e } }
    return $null
}
# Whether a rule lets sshd's TCP port 22 in: ssh's, Set-SshScope.ps1's,
# never this. A rule bound to a Store app's container, to another program or
# to a service never matches sshd's traffic (as Test-TakesCaddy in
# vps-web-firewall.ps1), so it does not count.
function Test-TakesSsh($Rule) {
    if ($Rule.Protocol -ne 'TCP' -and $Rule.Protocol -ne 'Any') { return $false }
    if ($Rule.Package) { return $false }
    if ($Rule.Program -and $Rule.Program -ne 'Any' -and $Rule.Program -notmatch '(?i)\\sshd\.exe$') { return $false }
    if ($Rule.Service -and $Rule.Service -ne 'Any') { return $false }
    if (-not $Rule.Ports.Count) { return $true }
    foreach ($p in $Rule.Ports) {
        if ($p -eq 'Any' -or $p -eq '22') { return $true }
        if ($p -match '^(\d+)-(\d+)$' -and [int]$Matches[1] -le 22 -and 22 -le [int]$Matches[2]) { return $true }
    }
    return $false
}
function Show-Rule($Rule) {
    $ports = 'Any'
    if ($Rule.Ports.Count) { $ports = $Rule.Ports -join ',' }
    $s = "'" + $Rule.DisplayName + "' (" + $Rule.Name + '), ' + $Rule.Protocol + ' ' + $ports + ' from ' + ($Rule.Remote -join ',')
    if ($Rule.Group) { $s += ', group ' + $Rule.Group }
    if ($Rule.Program -and $Rule.Program -ne 'Any') { $s += ', program ' + $Rule.Program }
    if ($Rule.Service -and $Rule.Service -ne 'Any') { $s += ', service ' + $Rule.Service }
    if ($Rule.Package) { $s += ', for a Store app only' }
    return $s
}

function Invoke-InboundRules {
    if (-not $Layer) {
        $notBox = Get-ThornswoodBoxRefusal
        if ($notBox) { $script:stopped = $true; Say 'STOP' ($notBox + '. Run Set-InboundRules.ps1 on your machine; it sends this to the box.'); return }
    }
    if ((@($Check, $Apply) | Where-Object { $_ }).Count -ne 1) { $script:stopped = $true; Say 'STOP' 'say one of -Check or -Apply. Nothing was changed.'; return }

    # ---------------------------------------------------------- the list ---
    $entries = @()
    try { $entries = @(Read-List $List) } catch { $script:stopped = $true; Say 'STOP' ('the list does not read (' + $_.Exception.Message + '). Nothing was changed.'); return }
    if (-not $entries.Count) { $script:stopped = $true; Say 'STOP' 'the list is empty, so every rule would be outside it. Nothing was changed.'; return }
    Say 'LIST' ([string]$entries.Count + ' rules the box keeps, ' + @($entries | Where-Object { $_.required }).Count + ' of them required')

    # --------------------------------------------------------- the rules ---
    $rules = @(Get-InboundRules)
    $outside = @()
    foreach ($r in @($rules | Where-Object { $_.Enabled } | Sort-Object DisplayName)) {
        if (Find-Entry $entries $r) { Say 'RULE' ('KEPT ' + (Show-Rule $r)); continue }
        $outside += $r
        Say 'RULE' ('OUTSIDE ' + (Show-Rule $r))
    }
    $script:outside = $outside.Count

    # ------------------------------------------------------ the required ---
    foreach ($e in @($entries | Where-Object { $_.required })) {
        $have = @($rules | Where-Object { $_.Name -eq [string]$e.rule -or $_.DisplayName -eq [string]$e.rule })
        if (-not $have.Count) { $script:missing++; Say 'REQUIRED' ("'" + $e.rule + "' is not on the box") }
        elseif (-not @($have | Where-Object { $_.Enabled }).Count) { $script:missing++; Say 'REQUIRED' ("'" + $e.rule + "' is there but turned off") }
    }

    # ------------------------------------------------------ who made it ---
    if ($outside.Count) {
        foreach ($r in $outside) { Say 'ORIGIN' ("'" + $r.DisplayName + "' kept in " + $r.Store + $(if ($r.Description) { ', description: ' + $r.Description } else { ', no description' })) }
        $log = Get-RuleEvents
        if (-not $log.First) { Say 'EVENT' 'the firewall log holds no events, so who made these is not in it' }
        else {
            Say 'EVENT' ('the firewall log reaches back to ' + $log.First)
            $ids = @($outside | ForEach-Object { $_.Name })
            $names = @($outside | ForEach-Object { $_.DisplayName })
            $hits = @($log.Events | Where-Object { $ids -contains $_.RuleId -or $names -contains $_.RuleName })
            foreach ($h in $hits) { Say 'EVENT' ($h.Time + ' ' + $(if (@(2004, 2097) -contains $h.Id) { 'added' } else { 'changed' }) + " '" + $h.RuleName + "' by " + $h.User + ' with ' + $h.Program) }
            if (-not $hits.Count) { Say 'EVENT' 'none of the rules outside the list was added or changed in that time' }
        }
    }

    # ------------------------------------------------- WinRM, listeners ---
    $w = Get-WinRm
    Say 'WINRM' ('service ' + $w.State)
    foreach ($l in $w.Listeners) { Say 'WINRM' ('listener ' + $l) }
    if ($w.State -match '^Running' -and -not $w.Listeners.Count) { Say 'WINRM' 'no listener' }
    $v6 = @(Get-Ipv6Addresses)
    foreach ($a in $v6) { Say 'ADDRESS' ($a.Interface + ' ' + $a.Address) }
    if (-not $v6.Count) { Say 'ADDRESS' 'no IPv6 address but link-local, so no IPv6 tunnel is in use' }
    foreach ($l in @(Get-WideListeners | Sort-Object Proto, Port -Unique)) { Say 'LISTEN' ($l.Proto + ' ' + $l.Port + ' on every interface, ' + $l.Process) }

    if ($Check) { return }

    # -------------------------------------------------------- the change ---
    if ($script:missing) { $script:stopped = $true; Say 'STOP' ('a required rule is missing or off (the REQUIRED lines above), so turning its old copies off could shut the game or the site. Run the script that owns it first. Nothing was changed.'); return }
    if (-not $outside.Count) { Say 'ALREADY' 'every enabled inbound Allow rule is on the list'; return }
    foreach ($r in $outside) {
        if (Test-TakesSsh $r) { Say 'LEFT' ("'" + $r.DisplayName + "' lets TCP 22 in, and ssh's rules are Set-SshScope.ps1's. Put it on the list or scope it there."); continue }
        $script:changes++
        if ($DryRun) { Say 'WOULD' ("turn off '" + $r.DisplayName + "' (" + $r.Name + ')'); continue }
        Disable-Rule $r.Name $r.Store
        if (Test-RuleEnabled $r.Name) { $script:stopped = $true; Say 'STOP' ("'" + $r.DisplayName + "' reads back as still on after it was turned off."); return }
        Say 'CHANGED' ("turned off '" + $r.DisplayName + "' (" + $r.Name + '), ' + $(if ($r.Store -eq 'GroupPolicy') { 'in the box''s policy' } else { 'a local rule' }))
    }
}

try { Invoke-InboundRules }
catch {
    $script:stopped = $true
    Say 'STOP' ('it failed partway, at: ' + $_.Exception.Message)
}
finally {
    if ($Check -and -not $script:stopped) { Say 'DONE' ('read only, ' + $script:outside + ' rule(s) outside the list, ' + $script:missing + ' required rule(s) missing or off. Nothing was changed.') }
    elseif ($DryRun) { Say 'DONE' ([string]$script:changes + ' change(s) would be made. Nothing was changed.') }
    elseif ($script:stopped) { Say 'DONE' ([string]$script:changes + ' change(s) made before it stopped.') }
    else { Say 'DONE' ([string]$script:changes + ' change(s) made.') }
}
if ($script:stopped) { exit 1 }
if ($Check -and ($script:outside -or $script:missing)) { exit 2 }
exit 0
