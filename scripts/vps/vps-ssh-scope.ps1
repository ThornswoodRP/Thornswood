<#
.SYNOPSIS
  Runs ON THE VPS, sent there by Set-SshScope.ps1: limits who may reach ssh on port 22 to a list of addresses, refusing a list that leaves out the machine running it, and arms a ten minute put back.

.DESCRIPTION
  Do not run this by hand. Set-SshScope.ps1 proves key login works first, from
  your machine, then sends this file's text on ssh's standard input and
  pwsh runs it from there, so nothing of it is ever
  written on the box (#3035).

  Issue #2182, decision 2 (Patrick, 11 Oct 2026): restrict the inbound rules on
  port 22 to known addresses, only after the hosting console login is
  confirmed. In this order, each step saying what it found and what it did:

    the list      every entry an IPv4 or IPv6 address or a range written
                  address/bits, or the single word Any (back to anywhere),
                  or the single word None (no outside address: 127.0.0.1
                  alone, which is the bridge, #2891). Anything else stops it.
    the caller    the address this ssh session comes from, read from
                  SSH_CLIENT, must be inside the list. A list that leaves it
                  out would cut this machine off, so it stops.
    the rules     every enabled inbound Allow rule for TCP on port 22. An
                  enabled Allow rule for every port that also takes sshd's
                  traffic (any program or sshd.exe, no app container, any
                  service or sshd) would let 22 in from
                  anywhere whatever the list says, so it stops and names it.
                  So does finding no rule for 22 at all.
    the change    the rules' remote addresses are saved to
                  C:\ProgramData\ssh\ssh-scope-before-<time>.json, which only
                  SYSTEM and Administrators may read (#3034), a task puts
                  them back in ten minutes ("Thornswood ssh scope rollback"),
                  and then each rule's remote address becomes the list.
                  Set-SshScope.ps1 cancels the task once a new key login from
                  your machine gets in. A connection already open stays open,
                  so this answer always gets back.

  Every line of output starts with one word: CHANGED, WOULD (with -DryRun),
  ALREADY, KEPT, WARN, STOP or DONE. STOP means nothing after it was done, and
  the exit code is 1.

.PARAMETER From
  The addresses that may reach port 22, comma separated: 203.0.113.7,
  198.51.100.0/24, 2001:db8::/48, or Any, or None.

.PARAMETER DryRun
  Read everything, change nothing, and say WOULD for each change.

.PARAMETER Layer
  A file that replaces the functions below that touch Windows (the firewall,
  scheduled tasks, SSH_CLIENT, the save folder, the save's rules). Only
  tests\test-ssh-scope.ps1 passes it, to run this against stand-ins.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$From,
    [switch]$DryRun,
    [string]$Layer = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$RollbackTask = 'Thornswood ssh scope rollback'
$script:changes = 0
$script:stopped = $false

function Say([string]$word, [string]$what) { Write-Output ($word + ' ' + $what) }

# ---------------------------------------------------------------- the layer ---
# Everything that touches Windows goes through these, so the harness can put
# stand-ins in their place with -Layer and run the rest of this for real.

function Get-CallerAddress { return ([string]$env:SSH_CLIENT -split '\s+')[0] }
function Get-SaveFolder { return (Join-Path $env:ProgramData 'ssh') }
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

# Enabled inbound Allow rules the firewall takes, as Name, DisplayName,
# Protocol, Ports, Program, Package (the app container the rule is for, ''
# when none), Service ('Any' when not bound to one), Remote (the remote
# addresses, 'Any' when open to all) and Store (GroupPolicy for the box's own
# policy, Local for the local store; #3896).
function Get-AllowRules {
    foreach ($r in @(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Enabled True -Action Allow -ErrorAction SilentlyContinue)) {
        $pf = $r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
        $af = $r | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue
        $ap = $r | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
        $sf = $r | Get-NetFirewallServiceFilter -ErrorAction SilentlyContinue
        [pscustomobject]@{
            Name = [string]$r.Name; DisplayName = [string]$r.DisplayName
            Protocol = [string]$pf.Protocol
            Ports = @(@($pf.LocalPort) | ForEach-Object { [string]$_ })
            Program = [string]$ap.Program
            Package = [string]$ap.Package
            Service = [string]$sf.Service
            Remote = @(@($af.RemoteAddress) | ForEach-Object { [string]$_ })
            Store = [string]$r.PolicyStoreSourceType
        }
    }
}
# A rule's remote addresses, changed in the store the firewall took it from:
# the box's own policy (then Group Policy refreshed, scripts\vps\BoxFirewall.ps1,
# #3896), or the local store for a rule from before Set-InboundRules.ps1 -Own.
function Set-RuleRemote([string]$Name, [string[]]$Remote, [string]$Store = 'GroupPolicy') {
    if ($Store -eq 'Local') { Set-NetFirewallRule -PolicyStore PersistentStore -Name $Name -RemoteAddress $Remote; return }
    Set-NetFirewallRule -PolicyStore localhost -Name $Name -RemoteAddress $Remote
    Sync-ThornswoodFirewall
}

# Makes $Path an empty file only SYSTEM and Administrators may open, taking
# nothing from its folder (#3034). C:\ProgramData\ssh gives every signed in
# account read, as Windows OpenSSH installs it, and a file made there takes
# that rule, so a save written there plainly is open to every account on the
# box. The rules are set while the file is empty, so its content is never
# open, and they are the ones administrators_authorized_keys has.
function New-PrivateFile([string]$Path) {
    [IO.File]::WriteAllBytes($Path, [byte[]]@())
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($s in 'S-1-5-18', 'S-1-5-32-544') {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl', 'Allow')))
    }
    $item = Get-Item -LiteralPath $Path -Force
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, $acl)
    # Read back, not taken from the call: a FileSecurity already written once
    # writes nothing the second time and says nothing (#3034, on the box).
    $got = Get-Acl -LiteralPath $Path
    $who = @($got.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
    if (-not $got.AreAccessRulesProtected -or ($who -join ',') -ne 'S-1-5-18,S-1-5-32-544') { throw ($Path + ' did not take SYSTEM and Administrators alone: ' + ($who -join ', ')) }
}

# Whether a rule's filters match sshd's own traffic: any program or sshd.exe,
# no app container, and any service or sshd. A rule bound to an app container
# (the per-user rules Windows makes for Start, Search, Windows Security and the
# like) or to another service matches only that app's or service's traffic, so
# it never lets sshd in, whatever ports it names.
function Test-TakesSshd($Rule) {
    $program = (-not $Rule.Program) -or $Rule.Program -eq 'Any' -or $Rule.Program -match '(?i)\\sshd\.exe$'
    $package = -not $Rule.Package
    $service = (-not $Rule.Service) -or $Rule.Service -eq 'Any' -or $Rule.Service -eq 'sshd'
    return ($program -and $package -and $service)
}

# Puts every saved rule's remote addresses back in ten minutes, then removes
# itself, unless Set-SshScope.ps1 cancels it first.
function Register-Rollback([string]$Saved) {
    $cmd = "`$s = Get-Content -Raw -LiteralPath '" + $Saved + "' | ConvertFrom-Json; foreach (`$r in `$s.rules) { if (`$r.store -eq 'Local') { Set-NetFirewallRule -PolicyStore PersistentStore -Name `$r.name -RemoteAddress @(`$r.remote) } else { Set-NetFirewallRule -PolicyStore localhost -Name `$r.name -RemoteAddress @(`$r.remote) } }; gpupdate.exe /target:computer /force | Out-Null; Unregister-ScheduledTask -TaskName '" + $RollbackTask + "' -Confirm:`$false"
    $a = New-ScheduledTaskAction -Execute (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument ('-NoProfile -Command "' + $cmd + '"')
    $t = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(10))
    $p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $RollbackTask -Action $a -Trigger $t -Principal $p -Force | Out-Null
}

if ($Layer) { . $Layer }

# ---------------------------------------------------------------- addresses ---
# One entry as a family, its bytes and how many leading bits must match, or
# $null when it is not an address or address/bits.
function ConvertTo-Range([string]$Text) {
    $t = $Text.Trim()
    $bits = -1
    if ($t.Contains('/')) {
        $parts = $t.Split('/')
        if ($parts.Count -ne 2 -or $parts[1] -notmatch '^\d{1,3}$') { return $null }
        $t = $parts[0]; $bits = [int]$parts[1]
    }
    $ip = $null
    if (-not [Net.IPAddress]::TryParse($t, [ref]$ip)) { return $null }
    # An IPv4 entry has to be four numbers, so 10.1 is not taken for 10.0.0.1.
    if ($ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $t -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { return $null }
    if ($ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6 -and $ip.IsIPv4MappedToIPv6) { $ip = $ip.MapToIPv4() }
    $bytes = $ip.GetAddressBytes()
    $max = $bytes.Length * 8
    if ($bits -lt 0) { $bits = $max }
    if ($bits -gt $max) { return $null }
    return [pscustomobject]@{ Bytes = $bytes; Bits = $bits; Text = $Text.Trim() }
}

function Test-InRange($Address, $Range) {
    if ($Address.Bytes.Length -ne $Range.Bytes.Length) { return $false }
    $left = $Range.Bits
    for ($i = 0; $i -lt $Address.Bytes.Length -and $left -gt 0; $i++) {
        $take = [Math]::Min(8, $left)
        $mask = [byte]((0xFF -shl (8 - $take)) -band 0xFF)
        if (($Address.Bytes[$i] -band $mask) -ne ($Range.Bytes[$i] -band $mask)) { return $false }
        $left -= $take
    }
    return $true
}

function Change([string]$what) {
    $script:changes++
    if ($DryRun) { Say 'WOULD' $what } else { Say 'CHANGED' $what }
}

function Invoke-Scope {
    if (-not $Layer) {
        $notBox = Get-ThornswoodBoxRefusal
        if ($notBox) { $script:stopped = $true; Say 'STOP' ($notBox + '. Run Set-SshScope.ps1 on your machine; it sends this to the box.'); return }
    }

    # ---------------------------------------------------------- the list ---
    $entries = @($From -split '[,\s]+' | Where-Object { $_ })
    if (-not $entries.Count) { $script:stopped = $true; Say 'STOP' 'the list of addresses is empty. Nothing was changed.'; return }
    $any = ($entries.Count -eq 1 -and $entries[0] -eq 'Any')
    # None is the box's own loopback alone, the only way the bridge reaches
    # sshd (#2891): no outside address reaches port 22 at all, and the
    # firewall never filters loopback anyway.
    $none = ($entries.Count -eq 1 -and $entries[0] -eq 'None')
    if ($none) { $entries = @('127.0.0.1') }
    $ranges = @()
    if (-not $any) {
        foreach ($e in $entries) {
            if ($e -eq 'Any' -or $e -eq 'None') { $script:stopped = $true; Say 'STOP' ($e + ' goes alone, not in a list. Nothing was changed.'); return }
            $r = ConvertTo-Range $e
            if (-not $r) { $script:stopped = $true; Say 'STOP' ("'" + $e + "' is not an address or address/bits. Nothing was changed."); return }
            $ranges += $r
        }
    }
    $want = if ($any) { @('Any') } else { @($ranges | ForEach-Object { $_.Text }) }

    # -------------------------------------------------------- the caller ---
    $caller = Get-CallerAddress
    if (-not $any) {
        $c = if ($caller) { ConvertTo-Range $caller } else { $null }
        if (-not $c) { $script:stopped = $true; Say 'STOP' 'could not read the address this session comes from (SSH_CLIENT), so the list cannot be checked against it. Nothing was changed.'; return }
        $inside = @($ranges | Where-Object { Test-InRange $c $_ })
        if (-not $inside.Count -and $none) { $script:stopped = $true; Say 'STOP' ('this session comes from ' + $caller + ', not through the bridge, so shutting port 22 would cut this machine off. Point its ssh through the bridge first (Grant-BoxAccess.ps1 -ThisMachine, or Setup-SshKey.ps1), then run this again. Nothing was changed.'); return }
        if (-not $inside.Count) { $script:stopped = $true; Say 'STOP' ('this session comes from ' + $caller + ', which is not in the list, so the change would cut this machine off. Add it, or run this from a machine in the list. Nothing was changed.'); return }
        Say 'KEPT' ('this session comes from ' + $caller + ', inside ' + $inside[0].Text)
    }

    # --------------------------------------------------------- the rules ---
    $rules = @(Get-AllowRules)
    $tcp = @($rules | Where-Object { $_.Protocol -eq 'TCP' -or $_.Protocol -eq 'Any' })
    $for22 = @($tcp | Where-Object { $_.Ports -contains '22' })
    $wide = @($tcp | Where-Object { ($_.Ports -contains 'Any' -or -not $_.Ports.Count) -and (Test-TakesSshd $_) -and ($_.Remote -contains 'Any') })
    if ($wide.Count -and -not $any) {
        $script:stopped = $true
        Say 'STOP' ('these rules allow every port from anywhere, so they let port 22 in whatever the list says: ' + (($wide | ForEach-Object { "'" + $_.DisplayName + "'" }) -join ', ') + '. Decide about them first. Nothing was changed.')
        return
    }
    if (-not $for22.Count) { $script:stopped = $true; Say 'STOP' 'no enabled firewall rule allows port 22, so there is nothing to narrow. Nothing was changed.'; return }
    # A rule for 22 and other ports cannot be narrowed without narrowing the
    # others too, which is not this script's call.
    $shared = @($for22 | Where-Object { @($_.Ports | Where-Object { $_ -ne '22' }).Count })
    if ($shared.Count) {
        $script:stopped = $true
        Say 'STOP' ('these rules allow port 22 together with other ports: ' + (($shared | ForEach-Object { "'" + $_.DisplayName + "' (" + ($_.Ports -join ',') + ')' }) -join ', ') + '. Narrowing them would narrow the others too. Nothing was changed.')
        return
    }

    $todo = @()
    foreach ($r in $for22) {
        $now = @($r.Remote | Sort-Object)
        if ((($now | Sort-Object) -join ',') -eq (($want | Sort-Object) -join ',')) { Say 'ALREADY' ("rule '" + $r.DisplayName + "' takes port 22 from " + ($want -join ', ')) }
        else { $todo += $r }
    }
    if (-not $todo.Count) { return }

    # -------------------------------------------------------- the change ---
    $saved = Join-Path (Get-SaveFolder) ('ssh-scope-before-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.json')
    if (-not $DryRun) {
        $doc = [ordered]@{ taken = (Get-Date).ToString('o'); rules = @($todo | ForEach-Object { [ordered]@{ name = $_.Name; remote = @($_.Remote); store = $_.Store } }) }
        New-PrivateFile $saved
        [IO.File]::WriteAllText($saved, ($doc | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
        Register-Rollback $saved
    }
    Change ('saved the rules as they are to ' + $saved)
    Change ("a task named '" + $RollbackTask + "' puts them back in ten minutes unless Set-SshScope.ps1 cancels it once key login is proven again")
    foreach ($r in $todo) {
        if (-not $DryRun) { Set-RuleRemote $r.Name $want $r.Store }
        Change ("rule '" + $r.DisplayName + "' takes port 22 from " + ($want -join ', ') + ' (was ' + ($r.Remote -join ', ') + ')')
    }
}

try { Invoke-Scope }
catch {
    $script:stopped = $true
    Say 'STOP' ('it failed partway, at: ' + $_.Exception.Message)
}
finally {
    if ($DryRun) { Say 'DONE' ([string]$script:changes + ' change(s) would be made. Nothing was changed.') }
    elseif ($script:stopped) { Say 'DONE' ([string]$script:changes + ' change(s) made before it stopped.') }
    else { Say 'DONE' ([string]$script:changes + ' change(s) made.') }
}
if ($script:stopped) { exit 1 }
exit 0
