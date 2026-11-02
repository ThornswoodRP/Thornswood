<#
  test-2995-cloudflare-front.ps1

      pwsh -NoProfile -File .\tests\test-2995-cloudflare-front.ps1

  Issue #2995, Patrick's A on q-2995-syn-fix (21 Oct 2026): thornswood.net
  goes behind Cloudflare's proxy and the box takes TCP 80 and 443 only from
  Cloudflare's ranges, so the forged SYNs that made it a SYN-ACK reflector
  get no answer.

  HOW. NEVER CONNECTS. Five parts.

  1. The list. scripts\deploy\cloudflare-ranges.txt reads whole, and the
     Caddyfile's trusted_proxies holds exactly it, in its order: a range
     only one of them has is either visitors refused at the firewall or a
     forged address believed.
  2. The Caddyfile. Cloudflare's CF-Connecting-IP is the client's address,
     believed only from those ranges, and every reverse_proxy sends that one
     address as X-Forwarded-For. The site and voice read the last hop of it
     from loopback (site\server.js requestAddr, voice\voice-server.js
     clientAddr), and by default Caddy appends Cloudflare's own address
     there, so without the line every limit would key on Cloudflare.
  3. One rule for "inside the ranges". CloudflareRanges.ps1, Watch-Outside.ps1
     and vps-web-firewall.ps1 each carry it (the last two run alone), and all
     three give the same answers.
  4. The box half. vps-web-firewall.ps1 runs here with -Layer: stand-ins for
     every function in it that touches Windows (the firewall and DNS). It
     checks: -Check changes nothing; -Apply refuses while the name points
     anywhere but Cloudflare, while a profile is off, while another rule lets
     80 or 443 in from anywhere, and on a bad range or a missing rule; a rule
     for a Store app's package or another program does not count, a port
     range around 443 does; a real -Apply sets both rules and reads them
     back, and a second run says ALREADY; -DryRun says WOULD; -Open puts Any
     back; a read back that does not match stops it. And that every command
     in it that reads or changes Windows sits inside a layer function.
  5. The machine half. Set-WebFirewall.ps1 runs with ssh, scp and ssh-keygen
     as stand-ins, and the box script runs behind them against the layer. It
     checks: no pinned key means nothing is sent; a bad list stops it before
     anything is sent; -Check, -WhatIf, a plain run and -Open each send the
     box the mode and the whole list from the file; -Check with -Open is
     refused.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
function P([string[]]$parts) { return [IO.Path]::Combine([string[]](@($repo) + $parts)) }
$RangesFile = P 'scripts', 'deploy', 'cloudflare-ranges.txt'
$Caddyfile = P 'scripts', 'deploy', 'Caddyfile'
$Shared = P 'scripts', 'deploy', 'CloudflareRanges.ps1'
$Box = P 'scripts', 'vps', 'vps-web-firewall.ps1'
$Driver = P 'scripts', 'vps', 'Set-WebFirewall.ps1'
$Outside = P 'scripts', 'vps', 'Watch-Outside.ps1'

. (P 'scripts', 'vps', 'Vps.ps1')
# The box's own address, from vps.json through Vps.ps1, never written here.
$VpsAddr = Get-ThornswoodVpsAddress
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
$FnAst = [System.Management.Automation.Language.FunctionDefinitionAst]
function Fn([string]$path, [string]$name) {
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
    return @($ast.FindAll({ param($n) $n -is $FnAst -and $n.Name -eq $name }, $true))[0].Extent.Text
}

# ---- 1. the list ----------------------------------------------------------------
Write-Host 'the list'
. $Shared
$ranges = Read-ThornswoodCloudflareRanges $RangesFile
Yes ('cloudflare-ranges.txt reads whole: ' + $ranges.Count + ' ranges') ($ranges.Count -ge 20)
Yes '  IPv4 and IPv6 both' (@($ranges | Where-Object { $_ -like '*:*' }).Count -gt 0 -and @($ranges | Where-Object { $_ -notlike '*:*' }).Count -gt 0)
Yes '  and none twice' (@($ranges | Sort-Object -Unique).Count -eq $ranges.Count)
$cf = [IO.File]::ReadAllText($Caddyfile)
$tp = [regex]::Match($cf, '(?m)^[ \t]*trusted_proxies static ([^\r\n]+)')
$trusted = @($tp.Groups[1].Value.Trim() -split '\s+' | Where-Object { $_ })
Yes 'the Caddyfile trusts a static list' ($tp.Success)
# Then loopback, where cloudflared brings the tunnel's requests in (#5334).
Yes '  and it is cloudflare-ranges.txt, range for range, in its order, then loopback for the tunnel' (($trusted -join ' ') -eq ((@($ranges) + @('127.0.0.1/32', '::1/128')) -join ' '))
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2995-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
try {
    $bad = Join-Path $tmp 'bad-ranges.txt'
    [IO.File]::WriteAllText($bad, "# a comment`n173.245.48.0/20`n10.1/8`n", $utf8)
    $said = ''
    try { $null = Read-ThornswoodCloudflareRanges $bad } catch { $said = $_.Exception.Message }
    Yes 'a line that is not an address and a prefix length stops the read, naming the line' ($said -match "Line 3 .*'10\.1/8'")
    [IO.File]::WriteAllText($bad, "# nothing but comments`n", $utf8)
    $said = ''
    try { $null = Read-ThornswoodCloudflareRanges $bad } catch { $said = $_.Exception.Message }
    Yes '  and so does a list with no ranges' ($said -match 'lists no ranges')

    # ---- 2. the Caddyfile --------------------------------------------------------
    Write-Host ''
    Write-Host 'the Caddyfile'
    Yes 'the client''s address is CF-Connecting-IP, inside the servers block' ($cf -match '(?s)servers \{\s*trusted_proxies static [^\r\n]+\s*client_ip_headers CF-Connecting-IP\s*\}')
    $proxies = @([regex]::Matches($cf, '(?m)^\s*reverse_proxy (\S+)( \{)?\s*$'))
    Yes ('every route still goes where it went: ' + (($proxies | ForEach-Object { $_.Groups[1].Value }) -join ', ')) (
        (($proxies | ForEach-Object { $_.Groups[1].Value }) -join ',') -eq '127.0.0.1:7778,127.0.0.1:7789,127.0.0.1:7790,127.0.0.1:7791,127.0.0.1:3001')
    $bare = @($proxies | Where-Object { -not $_.Groups[2].Success })
    $sends = @([regex]::Matches($cf, '(?ms)^\s*reverse_proxy \S+ \{\s*header_up X-Forwarded-For \{client_ip\}\s*\}'))
    Yes 'and every one sends the one address as X-Forwarded-For, {client_ip}' ($bare.Count -eq 0 -and $sends.Count -eq $proxies.Count)
    # A log filter line that deletes a header takes nothing from it, so it is
    # left out of the count (the /box/ log, #3297).
    $live = (@($cf -split "`r?`n" | Where-Object { $_ -notmatch '^\s*#' -and $_ -notmatch '^\s*request>\S+ delete\s*$' }) -join "`n")
    Yes 'nothing else in it takes a forwarded address' (@([regex]::Matches($live, '(?i)X-Forwarded-For')).Count -eq $proxies.Count -and $live -notmatch '(?i)trusted_proxies (?!static)')
    # The /box/ log (#3297) keeps no address: the visitor's, as Caddy works it
    # out and as each header carries it, and the token are taken out of each
    # line, and nothing but /box/ is logged.
    $boxLog = [regex]::Match($cf, '(?s)\r?\n\tlog \{.*?\r?\n\t\}\r?\n')
    Yes 'the box log is written under data, where LOCAL SERVICE may write' ($boxLog.Success -and $boxLog.Value -match 'output file C:/Thornswood-Caddy/data/logs/box\.log \{')
    $gone = @('request>client_ip', 'request>headers>Cf-Connecting-Ip', 'request>headers>X-Forwarded-For', 'request>headers>True-Client-Ip', 'request>headers>Cf-Ipcountry', 'request>headers>Authorization')
    $kept = @($gone | Where-Object { $boxLog.Value -notmatch ('(?m)^\s*' + [regex]::Escape($_) + ' delete\s*$') })
    Yes ('  and takes the address and the token out of every line' + $(if ($kept.Count) { ': not ' + ($kept -join ', ') } else { '' })) ($boxLog.Success -and $kept.Count -eq 0)
    Yes '  and logs nothing but /box/' ($cf -match '(?m)^\t@notbox not path /box/\*\s*$' -and $cf -match '(?m)^\tlog_skip @notbox\s*$')

    # ---- 3. one rule -------------------------------------------------------------
    Write-Host ''
    Write-Host 'one rule for inside the ranges'
    $wo = [scriptblock]::Create((Fn $Outside 'Test-InRanges') + "`n" + 'Test-InRanges $args[0] $args[1]')
    $bx = [scriptblock]::Create((Fn $Box 'ConvertTo-Range') + "`n" + (Fn $Box 'Test-Inside') + "`n" + '$l = @($args[1] | ForEach-Object { ConvertTo-Range $_ }); Test-Inside $args[0] $l')
    $cases = [ordered]@{
        '173.245.48.1' = $true; '173.245.63.255' = $true; '173.245.64.0' = $false
        '104.21.5.10' = $true; '104.27.255.255' = $true; '104.28.0.1' = $false
        '172.67.130.5' = $true; $VpsAddr = $false; '203.0.113.5' = $false
        '2606:4700::1' = $true; '2a06:98c7:ffff::1' = $true; '2a06:98c8::1' = $false; '2001:db8::1' = $false
        '::ffff:104.16.0.1' = $true; 'not an address' = $false
    }
    foreach ($a in $cases.Keys) {
        $want = $cases[$a]
        $got = @((Test-ThornswoodInRanges $a $ranges), (& $wo $a $ranges), (& $bx $a $ranges))
        Yes ("{0}: {1} by all three" -f $a, $(if ($want) { 'inside' } else { 'outside' })) (@($got | Where-Object { $_ -ne $want }).Count -eq 0)
    }
    Yes 'the VPS itself is outside, so a record pointing straight at it never passes for Cloudflare' (-not (Test-ThornswoodInRanges $VpsAddr $ranges))

    # ---- 4. the box half ---------------------------------------------------------
    Write-Host ''
    Write-Host 'the box half'
    $boxText = [IO.File]::ReadAllText($Box)
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($boxText, [ref]$null, [ref]$errs)
    Yes 'vps-web-firewall.ps1 parses' (-not $errs -or $errs.Count -eq 0)
    Yes '  and is plain ASCII, which Windows PowerShell on the box reads right' (-not ($boxText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    foreach ($f in $Driver, $Shared) {
        $t = [IO.File]::ReadAllText($f)
        $e = $null
        $null = [System.Management.Automation.Language.Parser]::ParseInput($t, [ref]$null, [ref]$e)
        Yes ((Split-Path -Leaf $f) + ' parses and is plain ASCII') ((-not $e -or $e.Count -eq 0) -and -not ($t.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    }

    $layerNames = @('Get-ThornswoodBoxRefusal', 'Get-AllowRules', 'Get-WebRule', 'Set-RuleRemote', 'Get-Profiles', 'Resolve-Name')
    $defined = @($ast.FindAll({ param($n) $n -is $FnAst }, $true) | ForEach-Object { $_.Name })
    Yes 'every layer function the stand-in replaces is defined in it' (@($layerNames | Where-Object { $defined -notcontains $_ }).Count -eq 0)
    $touchers = 'Get-NetFirewallRule', 'Set-NetFirewallRule', 'New-NetFirewallRule', 'Remove-NetFirewallRule', 'Get-NetFirewallPortFilter', 'Get-NetFirewallAddressFilter',
                'Get-NetFirewallApplicationFilter', 'Get-NetFirewallServiceFilter', 'Get-NetFirewallProfile', 'Set-NetFirewallProfile', 'Resolve-DnsName', 'Get-CimInstance'
    $loose = @()
    foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $name = $c.GetCommandName()
        if (-not $name -or $touchers -notcontains $name) { continue }
        $p = $c.Parent
        while ($p -and -not ($p -is $FnAst)) { $p = $p.Parent }
        if (-not $p -or $layerNames -notcontains $p.Name) { $loose += ('{0} at line {1}' -f $name, $c.Extent.StartLineNumber) }
    }
    Yes ('every command in it that touches Windows is inside a layer function' + $(if ($loose.Count) { ': ' + ($loose -join ', ') } else { '' })) ($loose.Count -eq 0)
    Yes 'it asks two public resolvers, not this box''s cache, where the name points' ($boxText -match "\`$Resolvers = @\('8\.8\.8\.8', '1\.1\.1\.1'\)" -and (Fn $Box 'Resolve-Name') -match '-Server \$Server')

    $layerText = @'
function Get-ThornswoodBoxRefusal { return '' }
function Get-AllowRules { return @($global:Fake.rules) }
function Get-WebRule([string]$DisplayName) {
    $r = $global:Fake.web[$DisplayName]
    if (-not $r) { return $null }
    return [pscustomobject]@{ Name = $r.Name; Enabled = 'True'; Count = $r.Count; Remote = @($r.Remote) }
}
# Windows keeps an IPv4 range given as 104.16.0.0/13 as 104.16.0.0/255.248.0.0
# and reads it back that way; IPv6 keeps its prefix length (the box, 21 Oct).
function ConvertTo-WindowsForm([string]$t) {
    $p = $t.Split('/')
    if ($p.Count -ne 2 -or $p[0] -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { return $t }
    $m = [uint64]0
    if ([int]$p[1] -gt 0) { $m = ([uint64]4294967295 -shl (32 - [int]$p[1])) -band [uint64]4294967295 }
    $b = [BitConverter]::GetBytes([uint32]$m); [Array]::Reverse($b)
    return ($p[0] + '/' + (New-Object Net.IPAddress (, $b)).ToString())
}
function Set-RuleRemote([string]$Name, [string[]]$Remote) {
    $global:Fake.log.Add('Set ' + $Name + ' ' + ($Remote -join ','))
    if (-not $global:Fake.sticks) { return }
    foreach ($k in @($global:Fake.web.Keys)) { if ($global:Fake.web[$k].Name -eq $Name) { $global:Fake.web[$k].Remote = @($Remote | ForEach-Object { ConvertTo-WindowsForm $_ }) } }
}
function Get-Profiles { return @($global:Fake.profiles) }
function Resolve-Name([string]$Name, [string]$Server) {
    $global:Fake.asked.Add($Server + ' ' + $Name)
    if ($global:Fake.dnsFails) { throw 'the resolver timed out' }
    return @($global:Fake.dns[$Name])
}
'@
    $Layer = Join-Path $tmp 'layer.ps1'
    [IO.File]::WriteAllText($Layer, $layerText, $utf8)
    $fakeAst = [System.Management.Automation.Language.Parser]::ParseInput($layerText, [ref]$null, [ref]$null)
    $fakeNames = @($fakeAst.FindAll({ param($n) $n -is $FnAst }, $true) | ForEach-Object { $_.Name })
    Yes '  and the stand-in replaces every one of them' (@($layerNames | Where-Object { $fakeNames -notcontains $_ }).Count -eq 0)

    function Rule([string]$display, [string]$proto, [string[]]$ports, [string]$program = '', [string]$package = '', [string[]]$remote = @('Any')) {
        return [pscustomobject]@{ Name = ('{' + [Guid]::NewGuid().ToString() + '}'); DisplayName = $display; Protocol = $proto; Ports = @($ports); Program = $program; Package = $package; Service = 'Any'; Remote = @($remote) }
    }
    function New-Fake {
        $global:Fake = @{
            web = @{ 'Thornswood Web 80' = @{ Name = '{web-80}'; Count = 1; Remote = @('Any') }; 'Thornswood Web 443' = @{ Name = '{web-443}'; Count = 1; Remote = @('Any') } }
            # What the box had on 21 Oct: game and voice ports, and the
            # Store apps' own rules that name every port.
            rules = @((Rule 'Thornswood Game' 'UDP' @('7777')), (Rule 'Thornswood Resources' 'TCP' @('3000')),
                      (Rule 'Your account' 'Any' @() '' 'S-1-15-2-1'), (Rule 'Desktop App Web Viewer' 'TCP' @('Any') '' 'S-1-15-2-2'))
            profiles = @([pscustomobject]@{ Name = 'Domain'; Enabled = 'True'; Inbound = 'NotConfigured' }, [pscustomobject]@{ Name = 'Private'; Enabled = 'True'; Inbound = 'Block' },
                         [pscustomobject]@{ Name = 'Public'; Enabled = 'True'; Inbound = 'NotConfigured' })
            dns = @{ 'thornswood.net' = @('104.21.5.10', '172.67.130.5'); 'www.thornswood.net' = @('104.21.5.10', '172.67.130.5', '2606:4700:3031::6815:50a') }
            dnsFails = $false
            sticks = $true
            asked = New-Object System.Collections.Generic.List[string]
            log = New-Object System.Collections.Generic.List[string]
        }
    }
    $list = $ranges -join ','
    $sorted = (@($ranges | Sort-Object) -join ',')
    function Invoke-BoxHere([string]$given) {
        $global:LASTEXITCODE = 0
        $sb = [scriptblock]::Create("& '" + $Box.Replace("'", "''") + "' -Layer '" + $Layer.Replace("'", "''") + "' " + $given)
        $out = @(& $sb 2>&1 | ForEach-Object { [string]$_ })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out; Text = ($out -join "`n") }
    }
    function Has($lines, [string]$rx) { return (@($lines | Where-Object { $_ -match $rx }).Count -gt 0) }
    # A rule's addresses with Windows' address/mask form back as a prefix length.
    function Cidr([string]$t) {
        $p = $t.Split('/')
        if ($p.Count -ne 2 -or $p[1] -notmatch '\.') { return $t }
        $bits = 0
        foreach ($x in ([Net.IPAddress]::Parse($p[1])).GetAddressBytes()) { $bits += [Convert]::ToString($x, 2).Replace('0', '').Length }
        return ($p[0] + '/' + $bits)
    }
    function Remote([string]$name) { return (@($global:Fake.web[$name].Remote | ForEach-Object { Cidr $_ } | Sort-Object) -join ',') }

    New-Fake
    $r = Invoke-BoxHere ("-Check -Ranges '" + $list + "'")
    Yes '-Check: exit 0, read only' ($r.Code -eq 0 -and $global:Fake.log.Count -eq 0 -and (Has $r.Lines '^DONE read only\. Nothing was changed\.$'))
    Yes '  each rule as it stands, open' ((Has $r.Lines '^RULE 80 OPEN to any address$') -and (Has $r.Lines '^RULE 443 OPEN to any address$'))
    Yes '  every profile' (@($r.Lines | Where-Object { $_ -match '^PROFILE ' }).Count -eq 3)
    Yes '  both names from both resolvers, every address inside' (@($r.Lines | Where-Object { $_ -match '^NAME .*, inside the ranges$' }).Count -eq 10 -and $global:Fake.asked.Count -eq 4 -and (Has $global:Fake.asked '^8\.8\.8\.8 www\.thornswood\.net$'))
    Yes '  and no ALSO: the Store apps'' package rules, the game''s UDP port and 3000 let nothing in on 443 for Caddy' (-not (Has $r.Lines '^ALSO '))

    New-Fake
    $global:Fake.dns['www.thornswood.net'] = @($VpsAddr)
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
    Yes '-Apply while www points straight at the box: STOP, exit 1, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines ('^NAME www\.thornswood\.net from 8\.8\.8\.8 is ' + [regex]::Escape($VpsAddr) + ', OUTSIDE the ranges$')) -and
        (Has $r.Lines "^STOP thornswood\.net does not point only into the ranges for everybody .*Turn on Cloudflare's proxy for both names, wait five minutes") -and $global:Fake.log.Count -eq 0)

    New-Fake
    $global:Fake.dnsFails = $true
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
    Yes '-Apply when the resolvers do not answer: STOP, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines 'did not answer: the resolver timed out') -and (Has $r.Lines '^STOP ') -and $global:Fake.log.Count -eq 0)

    New-Fake
    $global:Fake.dns['thornswood.net'] = @()
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
    Yes '-Apply when the name has no address: STOP, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines 'has no address') -and $global:Fake.log.Count -eq 0)

    New-Fake
    $global:Fake.profiles[2].Enabled = 'False'
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
    Yes '-Apply with the Public profile off: STOP, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP the firewall profile Public is off') -and $global:Fake.log.Count -eq 0)
    New-Fake
    $global:Fake.profiles[0].Inbound = 'Allow'
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
    Yes '-Apply with a profile letting everything in: STOP' ($r.Code -eq 1 -and (Has $r.Lines '^STOP the firewall profile Domain is off or lets everything in'))

    foreach ($case in @(
        @{ Say = 'a rule for every TCP port from anywhere'; Rule = (Rule 'Open everything' 'TCP' @('Any')) },
        @{ Say = 'a rule for every protocol and no port at all'; Rule = (Rule 'Wide open' 'Any' @()) },
        @{ Say = 'a port range around 443'; Rule = (Rule 'Range' 'TCP' @('400-500')) },
        @{ Say = 'a second rule for 443, for caddy.exe'; Rule = (Rule 'Caddy by hand' 'TCP' @('443') 'C:\Thornswood-Caddy\caddy.exe') })) {
        New-Fake
        $global:Fake.rules += $case.Rule
        $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
        Yes ('-Apply with ' + $case.Say + ': ALSO names it, STOP, nothing changed') ($r.Code -eq 1 -and (Has $r.Lines ("^ALSO rule '" + [regex]::Escape($case.Rule.DisplayName) + "' lets 80 or 443 in")) -and
            (Has $r.Lines '^STOP another rule lets 80 or 443 in from any address') -and $global:Fake.log.Count -eq 0)
    }
    foreach ($case in @(
        @{ Say = 'for another program'; Rule = (Rule 'Some server' 'TCP' @('443') 'C:\Other\server.exe') },
        @{ Say = 'scoped to some addresses already'; Rule = (Rule 'Office' 'TCP' @('443') '' '' @('198.51.100.0/24')) },
        @{ Say = 'for a port range that misses 80 and 443'; Rule = (Rule 'High ports' 'TCP' @('5000-6000')) })) {
        New-Fake
        $global:Fake.rules += $case.Rule
        $r = Invoke-BoxHere ("-Check -Ranges '" + $list + "'")
        Yes ('a rule ' + $case.Say + ' is no ALSO') ($r.Code -eq 0 -and -not (Has $r.Lines '^ALSO '))
    }

    New-Fake
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "' -DryRun")
    Yes '-Apply -DryRun: WOULD for both rules, nothing changed' ($r.Code -eq 0 -and @($r.Lines | Where-Object { $_ -match "^WOULD rule 'Thornswood Web (80|443)' takes (80|443) from only the $($ranges.Count) Cloudflare ranges$" }).Count -eq 2 -and $global:Fake.log.Count -eq 0)

    New-Fake
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
    Yes '-Apply: exit 0, both rules take only the list' ($r.Code -eq 0 -and (Remote 'Thornswood Web 80') -eq $sorted -and (Remote 'Thornswood Web 443') -eq $sorted -and
        @($r.Lines | Where-Object { $_ -match '^CHANGED ' }).Count -eq 2 -and (Has $r.Lines '^DONE 2 change\(s\) made\.$'))
    Yes '  set by each rule''s own name' ($global:Fake.log.Count -eq 2 -and $global:Fake.log[0] -like 'Set {web-80} *' -and $global:Fake.log[1] -like 'Set {web-443} *')
    Yes '  and read back the way Windows keeps them, IPv4 as address/mask, which still counts as the list' (@($global:Fake.web['Thornswood Web 80'].Remote | Where-Object { $_ -match '^104\.16\.0\.0/255\.248\.0\.0$' }).Count -eq 1)
    $global:Fake.log.Clear()
    $r = Invoke-BoxHere ("-Check -Ranges '" + $list + "'")
    Yes '  -Check then says both are scoped to the list given' ((Has $r.Lines ('^RULE 80 SCOPED to the ' + $ranges.Count + ' ranges given$')) -and (Has $r.Lines ('^RULE 443 SCOPED to the ' + $ranges.Count + ' ranges given$')))
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
    Yes '  a second -Apply says ALREADY and changes nothing' ($r.Code -eq 0 -and @($r.Lines | Where-Object { $_ -match '^ALREADY ' }).Count -eq 2 -and $global:Fake.log.Count -eq 0)
    $r = Invoke-BoxHere ("-Check -Ranges '173.245.48.0/20'")
    Yes '  -Check with another list says the rules are not that list' ((Has $r.Lines ('^RULE 443 SCOPED to ' + $ranges.Count + ' addresses, not the list given')))
    $r = Invoke-BoxHere '-Open'
    Yes '-Open: exit 0, both rules take any address again' ($r.Code -eq 0 -and (Remote 'Thornswood Web 80') -eq 'Any' -and (Remote 'Thornswood Web 443') -eq 'Any' -and @($r.Lines | Where-Object { $_ -match '^CHANGED .* from any address$' }).Count -eq 2)
    $r = Invoke-BoxHere '-Open'
    Yes '  and a second -Open says ALREADY' ($r.Code -eq 0 -and @($r.Lines | Where-Object { $_ -match '^ALREADY ' }).Count -eq 2)

    New-Fake
    $global:Fake.sticks = $false
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
    Yes 'a rule that reads back as something else: STOP, says to -Open' ($r.Code -eq 1 -and (Has $r.Lines "^STOP rule 'Thornswood Web 80' reads back as Any, not only the .*Set-WebFirewall\.ps1 -Open") -and $global:Fake.log.Count -eq 1)

    New-Fake
    $global:Fake.web.Remove('Thornswood Web 443')
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
    Yes 'no "Thornswood Web 443" rule: STOP, names Setup-Domain.ps1' ($r.Code -eq 1 -and (Has $r.Lines '^STOP there is no firewall rule "Thornswood Web 443"\. Setup-Domain\.ps1 makes it') -and $global:Fake.log.Count -eq 0)
    New-Fake
    $global:Fake.web['Thornswood Web 443'].Count = 2
    $r = Invoke-BoxHere ("-Apply -Ranges '" + $list + "'")
    Yes 'two rules by that name: STOP' ($r.Code -eq 1 -and (Has $r.Lines '^STOP there are 2 firewall rules named "Thornswood Web 443"') -and $global:Fake.log.Count -eq 0)

    foreach ($bad in '10.1/8', '173.245.48.0', '173.245.48.0/33', 'everybody') {
        New-Fake
        $r = Invoke-BoxHere ("-Apply -Ranges '173.245.48.0/20," + $bad + "'")
        Yes ("a range of '" + $bad + "': STOP, nothing changed") ($r.Code -eq 1 -and (Has $r.Lines ("^STOP '" + [regex]::Escape($bad) + "' is not an address and a prefix length")) -and $global:Fake.log.Count -eq 0)
    }
    New-Fake
    $r = Invoke-BoxHere '-Apply'
    Yes '-Apply with no list: STOP' ($r.Code -eq 1 -and (Has $r.Lines '^STOP -Apply needs -Ranges'))
    $r = Invoke-BoxHere ("-Ranges '" + $list + "'")
    Yes 'no mode at all: STOP' ($r.Code -eq 1 -and (Has $r.Lines '^STOP say one of -Check, -Apply or -Open'))
    $r = Invoke-BoxHere ("-Check -Apply -Ranges '" + $list + "'")
    Yes 'two modes: STOP' ($r.Code -eq 1 -and (Has $r.Lines '^STOP say one of') -and $global:Fake.log.Count -eq 0)
    $words = @($r.Lines + (Invoke-BoxHere ("-Check -Ranges '" + $list + "'")).Lines | Where-Object { $_ -notmatch '^(RULE|ALSO|PROFILE|NAME|CHANGED|WOULD|ALREADY|STOP|DONE) ' })
    Yes 'every line it prints starts with one of its words' ($words.Count -eq 0)

    # ---- 5. the machine half -----------------------------------------------------
    Write-Host ''
    Write-Host 'the machine half'
    $vpsJson = Get-Content -LiteralPath (P 'scripts', 'vps', 'vps.json') -Raw | ConvertFrom-Json
    $pin = [string]@($vpsJson.hostKeys)[0]
    $kh = Join-Path $tmp 'known_hosts'
    [IO.File]::WriteAllText($kh, "stand-in`n", $utf8)
    $far = Join-Path $tmp 'far'
    New-Item -ItemType Directory -Path $far -Force | Out-Null
    . (P 'scripts', 'vps', 'Send-Script.ps1')
    $global:H = @{}
    function global:ssh-keygen {
        $a = @($args | ForEach-Object { [string]$_ })
        if ($a -contains '-F') { '# Host 127.0.0.1 found: line 1'; ('127.0.0.1 ED25519 ' + $global:H.HostFp); $global:LASTEXITCODE = 0; return }
        $global:LASTEXITCODE = 1
    }
    function global:scp {
        $WhatIfPreference = $false
        $a = @($args | ForEach-Object { [string]$_ })
        $global:H.Calls.Add('scp ' + ($a -join ' '))
        $leaf = ($a[-1] -split '/')[-1]
        Copy-Item -LiteralPath $a[-2] -Destination (Join-Path $global:H.Far $leaf) -Force
        $global:LASTEXITCODE = 0
    }
    function global:ssh {
        $WhatIfPreference = $false
        $a = @($args | ForEach-Object { [string]$_ })
        $null = @($input)
        $s = ''
        if ($a[-1] -match 'EncodedCommand (\S+)') {
            $s = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))
            $rp = & $global:H.RunnerPath $s
            if ($rp) { $rf = Join-Path $global:H.Far ($rp -split '\\')[-1]; $s = [IO.File]::ReadAllText($rf); Remove-Item -LiteralPath $rf -Force }
        }
        $at = $s.IndexOf($global:H.BoxText)
        if ($at -lt 0) { $global:H.Calls.Add('ssh ' + ($a -join ' ')); $global:LASTEXITCODE = 1; return }
        $given = $s.Substring($at + $global:H.BoxText.Length).Trim().TrimStart('}').Trim()
        $global:H.Calls.Add('ssh BOX ' + $given)
        $global:H.Given = $given
        $global:LASTEXITCODE = 0
        $sb = [scriptblock]::Create("& '" + $global:H.Box.Replace("'", "''") + "' -Layer '" + $global:H.Layer.Replace("'", "''") + "' " + $given)
        @(& $sb 2>&1 | ForEach-Object { [string]$_ })
    }
    function Fresh {
        New-Fake
        $global:H = @{ HostFp = $pin; Calls = (New-Object System.Collections.Generic.List[string]); Far = $far; Layer = $Layer; Given = ''
                       Box = $Box; BoxText = [IO.File]::ReadAllText($Box); RunnerPath = ${function:Get-ThornswoodRemoteRunnerPath} }
    }
    function Invoke-Driver([hashtable]$extra) {
        $a = @{ Vps = '127.0.0.1'; User = 'Administrator'; KnownHosts = $kh; NoPause = $true }
        foreach ($k in $extra.Keys) { $a[$k] = $extra[$k] }
        $global:LASTEXITCODE = 0
        $out = @(& $Driver @a 6>&1 2>&1 | ForEach-Object { [string]$_ })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out; Text = ($out -join "`n") }
    }
    $wantList = "-Ranges '" + $list + "'"

    Fresh
    $global:H.HostFp = 'SHA256:' + ('A' * 43)
    $r = Invoke-Driver @{}
    Yes 'known_hosts without the pinned key: refused, exit 1, nothing sent' ($r.Code -eq 1 -and $r.Text -match 'does not hold the key' -and $global:H.Calls.Count -eq 0)

    Fresh
    [IO.File]::WriteAllText((Join-Path $tmp 'bad-list.txt'), "173.245.48.0/20`nnot-a-range`n", $utf8)
    $r = Invoke-Driver @{ RangesFile = (Join-Path $tmp 'bad-list.txt') }
    Yes 'a list with a bad line: refused, exit 1, nothing sent' ($r.Code -eq 1 -and $r.Text -match "Line 2 .*'not-a-range'" -and $global:H.Calls.Count -eq 0)

    Fresh
    $r = Invoke-Driver @{ Check = $true; Open = $true }
    Yes '-Check with -Open: refused before anything is sent' ($r.Code -eq 1 -and $global:H.Calls.Count -eq 0)

    Fresh
    $r = Invoke-Driver @{ Check = $true }
    Yes '-Check: exit 0, the box asked with -Check and the whole list from the file' ($r.Code -eq 0 -and $global:H.Given -eq ('-Check ' + $wantList) -and $global:Fake.log.Count -eq 0 -and $r.Text -match 'RULE 443 OPEN')
    Yes '  the script went whole to a copy its run took off the box (#3035, #3059)' (@(Get-ChildItem -LiteralPath $far -File).Count -eq 0 -and @($global:H.Calls | Where-Object { $_ -like 'scp *' }).Count -ge 1)

    Fresh
    $r = Invoke-Driver @{ WhatIf = $true }
    Yes '-WhatIf: exit 0, the box asked with -Apply, the list and -DryRun, nothing changed' ($r.Code -eq 0 -and $global:H.Given -eq ('-Apply ' + $wantList + ' -DryRun') -and $global:Fake.log.Count -eq 0 -and $r.Text -match 'Nothing was changed')

    Fresh
    $r = Invoke-Driver @{}
    Yes 'a plain run: exit 0, both rules take only the list' ($r.Code -eq 0 -and $global:H.Given -eq ('-Apply ' + $wantList) -and (Remote 'Thornswood Web 443') -eq $sorted -and (Remote 'Thornswood Web 80') -eq $sorted)

    Fresh
    $global:Fake.dns['thornswood.net'] = @($VpsAddr)
    $r = Invoke-Driver @{}
    Yes 'a plain run while the name points straight at the box: exit 1, nothing changed' ($r.Code -eq 1 -and $r.Text -match 'The box stopped' -and $global:Fake.log.Count -eq 0)

    Fresh
    $global:Fake.web['Thornswood Web 80'].Remote = @($ranges); $global:Fake.web['Thornswood Web 443'].Remote = @($ranges)
    $r = Invoke-Driver @{ Open = $true }
    Yes '-Open: exit 0, both rules take any address' ($r.Code -eq 0 -and $global:H.Given -like '-Open *' -and (Remote 'Thornswood Web 80') -eq 'Any' -and (Remote 'Thornswood Web 443') -eq 'Any')
}
finally {
    foreach ($f in 'ssh', 'scp', 'ssh-keygen') { Remove-Item -Path ("function:global:" + $f) -ErrorAction SilentlyContinue }
    Remove-Variable -Name Fake, H -Scope Global -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
