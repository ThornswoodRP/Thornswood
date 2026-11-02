<#
.SYNOPSIS
  Runs ON THE VPS, sent there by Set-WebFirewall.ps1: lets TCP 80 and 443 in
  only from Cloudflare's ranges, so a forged SYN from anywhere else gets no
  answer (#2995). -Open puts both back to any address.

.DESCRIPTION
  Do not run this by hand. Set-WebFirewall.ps1 sends this file's text on
  ssh's standard input with the ranges from scripts\deploy\cloudflare-ranges.txt,
  and pwsh runs it from there, so nothing of it is ever
  written on the box (#3035).

  WHY. Issue #2995, Patrick's A on q-2995-syn-fix (21 Oct 2026). The box
  answered every SYN on 443 from anybody, so forged SYNs carrying other
  people's addresses made it send each of them four or five SYN-ACKs: it was
  one reflector of many in an attack on those addresses (measured on 21 Oct:
  up to 15 a second, 83% of them with no TCP option at all, 189 half-open at
  once). BisectHosting declined to filter them upstream. With thornswood.net
  behind Cloudflare's proxy every real visitor reaches the box from a
  Cloudflare address, so the box drops everything else on 80 and 443 without
  an answer, the way the firewall already drops every port nothing allows.

  In this order, each step saying what it found:

    the list      every entry an address and a prefix length. Anything else
                  stops it, and so does an empty list with -Apply.
    the rules     "Thornswood Web 80" and "Thornswood Web 443", which
                  Setup-Domain.ps1 makes; either missing stops it. Then
                  every other enabled inbound Allow rule that lets TCP 80 or
                  443 in from any address for Caddy (any program or
                  caddy.exe, no app container, any service). With -Apply
                  one of those stops it, since it would still answer the
                  flood. A rule bound to a Store app's package or to another
                  program never lets Caddy's traffic in, so it does not count.
    the profiles  every firewall profile on, and none letting everything in.
                  With -Apply one off stops it: the scope would mean nothing.
    the name      thornswood.net and www as Google's and Cloudflare's public
                  resolvers give them, which is what a visitor gets. With
                  -Apply an answer outside the ranges stops it: the name
                  still points straight at the box for somebody, and the
                  scope would shut them out. That is also why -Apply waits
                  out the record's five minutes after the proxy goes on.
    the change    each rule's remote address becomes the list, and is read
                  back. -Open makes it Any. A connection already open stays
                  open, and port 22 and the bridge are never touched.

  Every line of output starts with one word: RULE, ALSO, PROFILE, NAME,
  CHANGED, WOULD (with -DryRun), ALREADY, STOP or DONE. STOP means nothing
  after it was done, and the exit code is 1.

.PARAMETER Check
  Read all of it and change nothing.

.PARAMETER Apply
  Set both rules to -Ranges.

.PARAMETER Open
  Set both rules back to any address.

.PARAMETER Ranges
  Cloudflare's ranges, comma separated, as cloudflare-ranges.txt lists them.

.PARAMETER Domain
  The site's name. thornswood.net by default.

.PARAMETER DryRun
  With -Apply or -Open: read everything and say WOULD for each change.

.PARAMETER Layer
  A file that replaces the functions below that touch Windows (the firewall
  and DNS). Only tests\test-2995-cloudflare-front.ps1 passes it.
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Apply,
    [switch]$Open,
    [string]$Ranges = '',
    [string]$Domain = 'thornswood.net',
    [switch]$DryRun,
    [string]$Layer = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WebRules = [ordered]@{ '80' = 'Thornswood Web 80'; '443' = 'Thornswood Web 443' }
$Resolvers = @('8.8.8.8', '1.1.1.1')
$script:changes = 0
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

# Every enabled inbound Allow rule the firewall takes: Name, DisplayName,
# Protocol, Ports, Program, Package (the app container, '' when none), Service
# ('Any' when not bound to one) and Remote ('Any' when open to all).
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
        }
    }
}
# One of the two web rules by its display name, enabled or not, as the
# firewall takes it: Name, Remote and Store (GroupPolicy for the box's own
# policy, Local for the local store; #3896), or $null when there is none.
function Get-WebRule([string]$DisplayName) {
    $r = @(Get-NetFirewallRule -PolicyStore ActiveStore -DisplayName $DisplayName -ErrorAction SilentlyContinue)
    if (-not $r.Count) { return $null }
    $af = $r[0] | Get-NetFirewallAddressFilter
    return [pscustomobject]@{ Name = [string]$r[0].Name; Enabled = [string]$r[0].Enabled; Count = $r.Count; Remote = @(@($af.RemoteAddress) | ForEach-Object { [string]$_ }); Store = [string]$r[0].PolicyStoreSourceType }
}
# A rule's remote addresses, changed in the store the firewall took it from:
# the box's own policy (then Group Policy refreshed, scripts\vps\BoxFirewall.ps1,
# #3896), or the local store for a rule from before Set-InboundRules.ps1 -Own.
function Set-RuleRemote([string]$Name, [string[]]$Remote, [string]$Store = 'GroupPolicy') {
    if ($Store -eq 'Local') { Set-NetFirewallRule -PolicyStore PersistentStore -Name $Name -RemoteAddress $Remote; return }
    Set-NetFirewallRule -PolicyStore localhost -Name $Name -RemoteAddress $Remote
    Sync-ThornswoodFirewall
}
function Get-Profiles {
    foreach ($p in @(Get-NetFirewallProfile -PolicyStore ActiveStore)) { [pscustomobject]@{ Name = [string]$p.Name; Enabled = [string]$p.Enabled; Inbound = [string]$p.DefaultInboundAction } }
}
# The A and AAAA answers for a name from one resolver, fresh from that
# resolver rather than this machine's cache.
function Resolve-Name([string]$Name, [string]$Server) {
    $out = @()
    foreach ($type in 'A', 'AAAA') {
        try { $out += @(Resolve-DnsName -Name $Name -Type $type -Server $Server -DnsOnly -QuickTimeout -ErrorAction Stop | Where-Object { $_.IPAddress } | ForEach-Object { [string]$_.IPAddress }) }
        catch { if ($_.Exception.Message -notmatch 'does not exist|DNS name does not exist|No records') { throw } }
    }
    return $out
}

if ($Layer) { . $Layer }

# ---------------------------------------------------------------- addresses ---
# One entry as its bytes and how many leading bits must match, or $null when
# it is not an address and a prefix length.
function ConvertTo-Range([string]$Text) {
    $parts = $Text.Trim().Split('/')
    if ($parts.Count -ne 2 -or $parts[1] -notmatch '^\d{1,3}$') { return $null }
    $ip = $null
    if (-not [Net.IPAddress]::TryParse($parts[0], [ref]$ip)) { return $null }
    if ($ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $parts[0] -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { return $null }
    $bytes = $ip.GetAddressBytes()
    $bits = [int]$parts[1]
    if ($bits -lt 1 -or $bits -gt $bytes.Length * 8) { return $null }
    return [pscustomobject]@{ Bytes = $bytes; Bits = $bits; Text = $Text.Trim() }
}

# A rule's remote address as text that compares with the list's. Windows keeps
# an IPv4 range given as 104.16.0.0/13 and reads it back as
# 104.16.0.0/255.248.0.0, and a single address with no prefix at all, while
# IPv6 keeps its prefix length (measured on the box, 21 Oct 2026: the first
# -Apply set rule 80 to the 22 ranges and then stopped, reading them back in
# that form). So each becomes network/prefix length, the same for both sides,
# and a keyword such as Any stays as it is.
function ConvertTo-AddressText([string]$Text) {
    $t = $Text.Trim()
    $parts = $t.Split('/')
    $ip = $null
    if ($parts.Count -gt 2 -or -not [Net.IPAddress]::TryParse($parts[0], [ref]$ip)) { return $t }
    if ($parts.Count -eq 1) { return ($ip.ToString() + '/' + ($ip.GetAddressBytes().Length * 8)) }
    if ($parts[1] -match '^\d{1,3}$') { return ($ip.ToString() + '/' + [int]$parts[1]) }
    $mask = $null
    if (-not [Net.IPAddress]::TryParse($parts[1], [ref]$mask) -or $mask.AddressFamily -ne $ip.AddressFamily) { return $t }
    $bits = 0
    $ended = $false
    foreach ($b in $mask.GetAddressBytes()) {
        for ($i = 7; $i -ge 0; $i--) {
            if ($b -band (1 -shl $i)) { if ($ended) { return $t }; $bits++ } else { $ended = $true }
        }
    }
    return ($ip.ToString() + '/' + $bits)
}
function Get-AddressKey($Remote) { return ((@($Remote | ForEach-Object { ConvertTo-AddressText ([string]$_) }) | Sort-Object) -join ',') }

function Test-Inside([string]$Address, $List) {
    $ip = $null
    if (-not [Net.IPAddress]::TryParse($Address, [ref]$ip)) { return $false }
    if ($ip.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6 -and $ip.IsIPv4MappedToIPv6) { $ip = $ip.MapToIPv4() }
    $b = $ip.GetAddressBytes()
    foreach ($r in $List) {
        if ($r.Bytes.Length -ne $b.Length) { continue }
        $left = $r.Bits
        $same = $true
        for ($i = 0; $i -lt $b.Length -and $left -gt 0; $i++) {
            $take = [Math]::Min(8, $left)
            $mask = [byte]((0xFF -shl (8 - $take)) -band 0xFF)
            if (($b[$i] -band $mask) -ne ($r.Bytes[$i] -band $mask)) { $same = $false; break }
            $left -= $take
        }
        if ($same) { return $true }
    }
    return $false
}

# Whether a rule's ports take 80 or 443: Any, no ports at all, the number,
# or a range around it.
function Test-TakesWebPort($Rule) {
    if (-not $Rule.Ports.Count) { return $true }
    foreach ($p in $Rule.Ports) {
        if ($p -eq 'Any' -or $p -eq '80' -or $p -eq '443') { return $true }
        if ($p -match '^(\d+)-(\d+)$') {
            $lo = [int]$Matches[1]; $hi = [int]$Matches[2]
            if (($lo -le 80 -and 80 -le $hi) -or ($lo -le 443 -and 443 -le $hi)) { return $true }
        }
    }
    return $false
}
# Whether a rule's filters match Caddy's own traffic: any program or
# caddy.exe, no app container, and any service. A rule bound to an app
# container (the per-user rules Windows makes for Start, Search and the like)
# or to another program matches only that one's traffic.
function Test-TakesCaddy($Rule) {
    $program = (-not $Rule.Program) -or $Rule.Program -eq 'Any' -or $Rule.Program -match '(?i)\\caddy\.exe$'
    $package = -not $Rule.Package
    $service = (-not $Rule.Service) -or $Rule.Service -eq 'Any'
    return ($program -and $package -and $service)
}

function Change([string]$what) {
    $script:changes++
    if ($DryRun) { Say 'WOULD' $what } else { Say 'CHANGED' $what }
}

function Invoke-WebFirewall {
    if (-not $Layer) {
        $notBox = Get-ThornswoodBoxRefusal
        if ($notBox) { $script:stopped = $true; Say 'STOP' ($notBox + '. Run Set-WebFirewall.ps1 on your machine; it sends this to the box.'); return }
    }
    if ((@($Check, $Apply, $Open) | Where-Object { $_ }).Count -ne 1) { $script:stopped = $true; Say 'STOP' 'say one of -Check, -Apply or -Open. Nothing was changed.'; return }

    # ---------------------------------------------------------- the list ---
    $list = @()
    foreach ($t in @($Ranges -split '[,\s]+' | Where-Object { $_ })) {
        $r = ConvertTo-Range $t
        if (-not $r) { $script:stopped = $true; Say 'STOP' ("'" + $t + "' is not an address and a prefix length. Nothing was changed."); return }
        $list += $r
    }
    if ($Apply -and -not $list.Count) { $script:stopped = $true; Say 'STOP' '-Apply needs -Ranges, the list to take 80 and 443 from. Nothing was changed.'; return }
    $want = @($list | ForEach-Object { $_.Text } | Sort-Object)

    # --------------------------------------------------------- the rules ---
    $web = [ordered]@{}
    foreach ($port in $WebRules.Keys) {
        $r = Get-WebRule $WebRules[$port]
        if (-not $r) { $script:stopped = $true; Say 'STOP' ('there is no firewall rule "' + $WebRules[$port] + '". Setup-Domain.ps1 makes it. Nothing was changed.'); return }
        if ($r.Count -ne 1) { $script:stopped = $true; Say 'STOP' ('there are ' + $r.Count + ' firewall rules named "' + $WebRules[$port] + '", so which one takes ' + $port + ' is not clear. Nothing was changed.'); return }
        $web[$port] = $r
        $now = @($r.Remote | Sort-Object)
        if ($now -contains 'Any') { Say 'RULE' ($port + ' OPEN to any address') }
        elseif ($want.Count -and (Get-AddressKey $now) -eq (Get-AddressKey $want)) { Say 'RULE' ($port + ' SCOPED to the ' + $now.Count + ' ranges given') }
        else { Say 'RULE' ($port + ' SCOPED to ' + $now.Count + ' addresses, not the list given: ' + ($now -join ' ')) }
    }
    $also = @()
    foreach ($r in @(Get-AllowRules)) {
        if (@($web.Values | ForEach-Object { $_.Name }) -contains $r.Name) { continue }
        if ($r.Protocol -ne 'TCP' -and $r.Protocol -ne 'Any') { continue }
        if (-not (Test-TakesWebPort $r) -or -not (Test-TakesCaddy $r) -or $r.Remote -notcontains 'Any') { continue }
        $also += $r.DisplayName
        Say 'ALSO' ("rule '" + $r.DisplayName + "' lets 80 or 443 in from any address (ports " + ($(if ($r.Ports.Count) { $r.Ports -join ',' } else { 'Any' })) + ')')
    }

    # ------------------------------------------------------ the profiles ---
    $off = @()
    foreach ($p in @(Get-Profiles)) {
        Say 'PROFILE' ($p.Name + ' enabled=' + $p.Enabled + ' inbound=' + $p.Inbound)
        if ($p.Enabled -ne 'True' -or $p.Inbound -eq 'Allow') { $off += $p.Name }
    }

    # ---------------------------------------------------------- the name ---
    $outside = @()
    foreach ($name in @($Domain, ('www.' + $Domain))) {
        foreach ($server in $Resolvers) {
            $found = @()
            try { $found = @(Resolve-Name $name $server) }
            catch { Say 'NAME' ($name + ' from ' + $server + ' did not answer: ' + $_.Exception.Message); $outside += ($name + ' (no answer from ' + $server + ')'); continue }
            if (-not $found.Count) { Say 'NAME' ($name + ' from ' + $server + ' has no address'); $outside += ($name + ' (no address from ' + $server + ')'); continue }
            foreach ($a in $found) {
                if ($list.Count -and (Test-Inside $a $list)) { Say 'NAME' ($name + ' from ' + $server + ' is ' + $a + ', inside the ranges') }
                else { Say 'NAME' ($name + ' from ' + $server + ' is ' + $a + ', OUTSIDE the ranges'); $outside += ($name + ' ' + $a) }
            }
        }
    }

    if ($Check) { return }

    # -------------------------------------------------------- the change ---
    if ($Apply) {
        if ($outside.Count) { $script:stopped = $true; Say 'STOP' ($Domain + ' does not point only into the ranges for everybody (' + (($outside | Select-Object -Unique) -join '; ') + '), so with the scope somebody would not reach the site. Turn on Cloudflare''s proxy for both names, wait five minutes for the old record to run out, and run this again. Nothing was changed.'); return }
        if ($off.Count) { $script:stopped = $true; Say 'STOP' ('the firewall profile ' + ($off -join ', ') + ' is off or lets everything in, so a scope would mean nothing. Nothing was changed.'); return }
        if ($also.Count) { $script:stopped = $true; Say 'STOP' ('another rule lets 80 or 443 in from any address (' + ($also -join ', ') + '), and would still answer the flood. Decide about it first. Nothing was changed.'); return }
        $target = $want
        $what = 'only the ' + $want.Count + ' Cloudflare ranges'
    } else {
        $target = @('Any')
        $what = 'any address'
    }
    foreach ($port in $WebRules.Keys) {
        $r = $web[$port]
        $now = @($r.Remote | Sort-Object)
        if ((Get-AddressKey $now) -eq (Get-AddressKey $target)) { Say 'ALREADY' ("rule '" + $WebRules[$port] + "' takes " + $port + ' from ' + $what); continue }
        if (-not $DryRun) {
            Set-RuleRemote $r.Name $target $r.Store
            $back = @((Get-WebRule $WebRules[$port]).Remote | Sort-Object)
            if ((Get-AddressKey $back) -ne (Get-AddressKey $target)) { $script:stopped = $true; Say 'STOP' ("rule '" + $WebRules[$port] + "' reads back as " + ($back -join ' ') + ', not ' + $what + '. Run Set-WebFirewall.ps1 -Open to put both back.'); return }
        }
        Change ("rule '" + $WebRules[$port] + "' takes " + $port + ' from ' + $what)
    }
}

try { Invoke-WebFirewall }
catch {
    $script:stopped = $true
    Say 'STOP' ('it failed partway, at: ' + $_.Exception.Message)
}
finally {
    if ($Check -and -not $script:stopped) { Say 'DONE' 'read only. Nothing was changed.' }
    elseif ($DryRun) { Say 'DONE' ([string]$script:changes + ' change(s) would be made. Nothing was changed.') }
    elseif ($script:stopped) { Say 'DONE' ([string]$script:changes + ' change(s) made before it stopped.') }
    else { Say 'DONE' ([string]$script:changes + ' change(s) made.') }
}
if ($script:stopped) { exit 1 }
exit 0
