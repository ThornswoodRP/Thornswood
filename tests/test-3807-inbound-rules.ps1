<#
  test-3807-inbound-rules.ps1

      pwsh -NoProfile -File .\tests\test-3807-inbound-rules.ps1

  Issue #3807. The box kept inbound Allow rules nothing used, "Allow WinRM
  HTTPS" (TCP 5986 from any address) among them, because no script owned a
  rule it did not make. records\prod-parity.json "inboundRules" now names
  every rule the box keeps, Set-InboundRules.ps1 sends the list to
  scripts\vps\vps-inbound-rules.ps1, which turns every other one off, and
  Check-ProdParity.ps1 marks a rule outside the list for review.

  HOW. NEVER CONNECTS. Three parts.

  1. The list. It reads whole: every entry a name, a reason and required
     true or false, no name twice. Every Thornswood rule a repository script
     makes is on it, and every one on it is made by a script here. The game,
     the dev game and the web rules are required. What the issue found open
     and unused (WinRM, the two SkyMP copies, Teredo, IP-HTTPS) is not on it.
  2. The box half. vps-inbound-rules.ps1 runs here with -Layer: stand-ins for
     every function in it that touches Windows. -Check changes nothing and
     exits 2 with a rule outside the list, 0 without; -Apply -DryRun says
     WOULD and changes nothing; -Apply turns off only what is outside the
     list and reads each back; a rule for sshd's port 22 is left, and a
     Store app's rule that names every port is not taken for one; a required
     rule missing or off stops it before anything is turned off; an empty or
     unreadable list, no mode or both modes stop it; a read back that is
     still on stops it; who made a rule is read from the firewall's log. And
     every command in it that reads or changes Windows sits inside a layer
     function.
  3. The machine half's list. Set-InboundRules.ps1's Read-InboundList
     refuses a list that is empty, has an entry with no name or no reason,
     or a name twice, and what it sends the box decodes to the record's
     names and required flags, nothing else.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
function P([string[]]$parts) { return [IO.Path]::Combine([string[]](@($repo) + $parts)) }
$RecordFile = P 'records', 'prod-parity.json'
$Box = P 'scripts', 'vps', 'vps-inbound-rules.ps1'
$Driver = P 'scripts', 'vps', 'Set-InboundRules.ps1'

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
function Has($lines, [string]$rx) { return (@($lines | Where-Object { $_ -match $rx }).Count -gt 0) }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-3807-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $tmp
$utf8 = New-Object Text.UTF8Encoding($false)
try {
    # ---- 1. the list -------------------------------------------------------------
    Write-Host 'the list'
    $rec = Get-Content -LiteralPath $RecordFile -Raw | ConvertFrom-Json
    $entries = @($rec.inboundRules)
    $names = @($entries | ForEach-Object { [string]$_.rule })
    Yes ('records\prod-parity.json lists inboundRules: ' + $entries.Count) ($entries.Count -ge 10)
    Yes '  each with a name, a reason, and required true or false' (@($entries | Where-Object { -not ([string]$_.rule).Trim() -or -not ([string]$_.why).Trim() -or $_.required -isnot [bool] }).Count -eq 0)
    Yes '  and no name twice' (@($names | Sort-Object -Unique).Count -eq $names.Count)
    $required = @($entries | Where-Object { $_.required } | ForEach-Object { [string]$_.rule })
    foreach ($n in 'Thornswood game (UDP)', 'Thornswood game (TCP)', 'Thornswood resources (TCP)', 'Thornswood Dev game (UDP)', 'Thornswood Dev game (TCP)', 'Thornswood Dev resources (TCP)', 'Thornswood Web 80', 'Thornswood Web 443') {
        Yes "  '$n' is on it, required" ($required -contains $n)
    }
    foreach ($n in 'Allow WinRM HTTPS', 'SkyMP game UDP 7777', 'SkyMP web TCP 3000', 'CoreNet-Teredo-In', 'CoreNet-IPHTTPS-In', 'CoreNet-IPv6-In', 'DeliveryOptimization-TCP-In') {
        Yes "  '$n' is not on it, so it goes off" ($names -notcontains $n)
    }
    Yes '  ssh''s own rule is on it' ($names -contains 'OpenSSH-Server-In-TCP')

    # Every Thornswood rule a script makes, by the names they make them under,
    # is on the list, and every Thornswood name on the list is one a script
    # makes, so a rule renamed in its script and not here shows.
    $made = New-Object System.Collections.Generic.List[string]
    $makers = @{
        'scripts/vps/Bootstrap-VPS.ps1' = @('Thornswood game (UDP)', 'Thornswood game (TCP)', 'Thornswood resources (TCP)')
        'scripts/vps/vps-dev-instance.ps1' = @('Thornswood Dev game (UDP)', 'Thornswood Dev game (TCP)', 'Thornswood Dev resources (TCP)')
        'scripts/deploy/Setup-Domain.ps1' = @('Thornswood Web ')
        'scripts/deploy/Install-Voice.ps1' = @('Thornswood Voice')
        'scripts/deploy/Deploy-Docs.ps1' = @('Thornswood Docs')
    }
    foreach ($rel in $makers.Keys) {
        $t = [IO.File]::ReadAllText((P ($rel -split '/')))
        foreach ($n in $makers[$rel]) { Yes ("  $rel still makes '$n'") ($t.Contains("'" + $n)) }
    }
    $made.AddRange([string[]]@('Thornswood game (UDP)', 'Thornswood game (TCP)', 'Thornswood resources (TCP)', 'Thornswood Dev game (UDP)', 'Thornswood Dev game (TCP)', 'Thornswood Dev resources (TCP)', 'Thornswood Web 80', 'Thornswood Web 443', 'Thornswood Voice', 'Thornswood Dev Voice', 'Thornswood Docs'))
    Yes '  every one of those is on the list' (@($made | Where-Object { $names -notcontains $_ }).Count -eq 0)
    Yes '  and every Thornswood name on the list is one of those' (@($names | Where-Object { $_ -like 'Thornswood*' -and $made -notcontains $_ }).Count -eq 0)
    $voice = [IO.File]::ReadAllText((P 'scripts', 'vps', 'vps-dev-instance.ps1'))
    Yes '  dev voice''s rule is named Thornswood Dev Voice where it is taken away' ($voice.Contains("'Thornswood Dev Voice'"))

    # ---- 2. the box half ---------------------------------------------------------
    Write-Host ''
    Write-Host 'the box half'
    $boxText = [IO.File]::ReadAllText($Box)
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($boxText, [ref]$null, [ref]$errs)
    Yes 'vps-inbound-rules.ps1 parses' (-not $errs -or $errs.Count -eq 0)
    Yes '  and is plain ASCII' (-not ($boxText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    $dt = [IO.File]::ReadAllText($Driver)
    $e = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput($dt, [ref]$null, [ref]$e)
    Yes 'Set-InboundRules.ps1 parses and is plain ASCII' ((-not $e -or $e.Count -eq 0) -and -not ($dt.ToCharArray() | Where-Object { [int]$_ -gt 127 }))

    $layerNames = @('Get-ThornswoodBoxRefusal', 'Sync-ThornswoodFirewall', 'Get-InboundRules', 'Disable-Rule', 'Test-RuleEnabled', 'Get-RuleEvents', 'Get-WinRm', 'Get-Ipv6Addresses', 'Get-WideListeners')
    $defined = @($ast.FindAll({ param($n) $n -is $FnAst }, $true) | ForEach-Object { $_.Name })
    Yes 'every layer function the stand-in replaces is defined in it' (@($layerNames | Where-Object { $defined -notcontains $_ }).Count -eq 0)
    $touchers = 'Get-NetFirewallRule', 'Set-NetFirewallRule', 'New-NetFirewallRule', 'Remove-NetFirewallRule', 'Enable-NetFirewallRule', 'Disable-NetFirewallRule',
                'Get-NetFirewallPortFilter', 'Get-NetFirewallAddressFilter', 'Get-NetFirewallApplicationFilter', 'Get-NetFirewallServiceFilter',
                'Get-WinEvent', 'Get-CimInstance', 'Get-NetIPAddress', 'Get-NetTCPConnection', 'Get-NetUDPEndpoint', 'Get-Process'
    $loose = @()
    foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $name = $c.GetCommandName()
        if (-not $name -or $touchers -notcontains $name) { continue }
        $p = $c.Parent
        while ($p -and -not ($p -is $FnAst)) { $p = $p.Parent }
        if (-not $p -or $layerNames -notcontains $p.Name) { $loose += ('{0} at line {1}' -f $name, $c.Extent.StartLineNumber) }
    }
    Yes ('every command in it that touches Windows is inside a layer function' + $(if ($loose.Count) { ': ' + ($loose -join ', ') } else { '' })) ($loose.Count -eq 0)
    $dis = Fn $Box 'Disable-Rule'
    Yes 'it turns rules off and never deletes one' ($boxText -notmatch 'Remove-NetFirewallRule' -and $dis -match 'Disable-NetFirewallRule -PolicyStore localhost -Name \$Name; Sync-ThornswoodFirewall' -and $dis -match 'Disable-NetFirewallRule -PolicyStore PersistentStore -Name \$Name')
    Yes '  in the store the firewall took the rule from (#3896), reading what it takes' ($dis -match "\`$Store -eq 'GroupPolicy'" -and (Fn $Box 'Get-InboundRules') -match 'Get-NetFirewallRule -PolicyStore ActiveStore' -and (Fn $Box 'Test-RuleEnabled') -match '-PolicyStore ActiveStore')

    $layerText = @'
function Get-ThornswoodBoxRefusal { return '' }
function Sync-ThornswoodFirewall { $global:Fake.log.Add('Sync') }
function Get-InboundRules { return @($global:Fake.rules) }
function Disable-Rule([string]$Name, [string]$Store) {
    $global:Fake.log.Add('Disable ' + $Name)
    if (-not $global:Fake.sticks) { return }
    foreach ($r in $global:Fake.rules) { if ($r.Name -eq $Name) { $r.Enabled = $false } }
}
function Test-RuleEnabled([string]$Name) { return [bool](@($global:Fake.rules | Where-Object { $_.Name -eq $Name })[0].Enabled) }
function Get-RuleEvents { return [pscustomobject]@{ First = $global:Fake.first; Events = @($global:Fake.events) } }
function Get-WinRm { return [pscustomobject]@{ State = 'Stopped, start Disabled'; Listeners = @() } }
function Get-Ipv6Addresses { return @() }
function Get-WideListeners { return @([pscustomobject]@{ Proto = 'TCP'; Port = 443; Process = 'caddy' }) }
'@
    $Layer = Join-Path $tmp 'layer.ps1'
    [IO.File]::WriteAllText($Layer, $layerText, $utf8)
    $fakeAst = [System.Management.Automation.Language.Parser]::ParseInput($layerText, [ref]$null, [ref]$null)
    $fakeNames = @($fakeAst.FindAll({ param($n) $n -is $FnAst }, $true) | ForEach-Object { $_.Name })
    Yes '  and the stand-in replaces every one of them' (@($layerNames | Where-Object { $fakeNames -notcontains $_ }).Count -eq 0)

    function Rule([string]$name, [string]$display, [string]$proto, [string[]]$ports, [string[]]$remote = @('Any'), [string]$program = 'Any', [string]$package = '', [bool]$enabled = $true) {
        return [pscustomobject]@{ Name = $name; DisplayName = $display; Enabled = $enabled; Group = ''; Protocol = $proto; Ports = @($ports); Remote = @($remote)
                                  Program = $program; Package = $package; Service = 'Any'; Store = 'Local'; Description = '' }
    }
    # What the box had on 26 Oct, cut down: the rules it keeps, the WinRM
    # rule, an old SkyMP copy, a Windows default, a Store app's rule that
    # names every port, and ssh's own rules scoped to the bridge.
    function New-Fake {
        $global:Fake = @{
            rules = @(
                (Rule '{g1}' 'Thornswood game (UDP)' 'UDP' @('7777')),
                (Rule '{w1}' 'Thornswood Web 443' 'TCP' @('443') @('173.245.48.0/255.255.240.0')),
                (Rule 'OpenSSH-Server-In-TCP' 'OpenSSH SSH Server (sshd)' 'TCP' @('22') @('127.0.0.1') '%SystemRoot%\system32\OpenSSH\sshd.exe'),
                (Rule '{winrm}' 'Allow WinRM HTTPS' 'TCP' @('5986')),
                (Rule '{old}' 'SkyMP game UDP 7777' 'UDP' @('7777')),
                (Rule 'DeliveryOptimization-TCP-In' 'Delivery Optimization (TCP-In)' 'TCP' @('7680') @('Any') '%SystemRoot%\system32\svchost.exe'),
                (Rule '{start}' 'Start' 'Any' @() @('Any') 'Any' 'S-1-15-2-1'),
                (Rule '{off}' 'Already off' 'TCP' @('9999') @('Any') 'Any' '' $false))
            first = '2026-10-22 06:56'
            events = @([pscustomobject]@{ Time = '2026-10-24 10:06'; Id = 2097; RuleId = '{old}'; RuleName = 'SkyMP game UDP 7777'; User = 'S-1-5-18'; Program = 'C:\by-hand.exe' })
            sticks = $true
            log = New-Object System.Collections.Generic.List[string]
        }
    }
    function ListArg($items) { return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject @($items) -Compress))) }
    $keep = @(@{ rule = 'Thornswood game (UDP)'; required = $true }, @{ rule = '{w1}'; required = $true }, @{ rule = 'OpenSSH-Server-In-TCP'; required = $false })
    $keepArg = ListArg $keep
    function Invoke-BoxHere([string]$given) {
        $global:LASTEXITCODE = 0
        $sb = [scriptblock]::Create("& '" + $Box.Replace("'", "''") + "' -Layer '" + $Layer.Replace("'", "''") + "' " + $given)
        $out = @(& $sb 2>&1 | ForEach-Object { [string]$_ })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out; Text = ($out -join "`n") }
    }

    New-Fake
    $r = Invoke-BoxHere ("-Check -List '" + $keepArg + "'")
    Yes '-Check: exit 2 with rules outside the list, read only' ($r.Code -eq 2 -and $global:Fake.log.Count -eq 0 -and (Has $r.Lines '^DONE read only, 4 rule\(s\) outside the list, 0 required rule\(s\) missing or off\. Nothing was changed\.$'))
    Yes '  KEPT for the listed rules, by DisplayName and by Name' ((Has $r.Lines "^RULE KEPT 'Thornswood game \(UDP\)'") -and (Has $r.Lines "^RULE KEPT 'Thornswood Web 443'") -and (Has $r.Lines "^RULE KEPT 'OpenSSH SSH Server \(sshd\)'"))
    Yes '  OUTSIDE for WinRM, the old copy, the Windows default and the Store app' ((Has $r.Lines "^RULE OUTSIDE 'Allow WinRM HTTPS' \(\{winrm\}\), TCP 5986 from Any$") -and (Has $r.Lines "^RULE OUTSIDE 'SkyMP game UDP 7777'") -and
        (Has $r.Lines "^RULE OUTSIDE 'Delivery Optimization \(TCP-In\)'") -and (Has $r.Lines "^RULE OUTSIDE 'Start' .*for a Store app only$"))
    Yes '  and nothing for a rule already off' (-not (Has $r.Lines "Already off"))
    Yes '  who made the old copy, from the firewall log' ((Has $r.Lines '^EVENT the firewall log reaches back to 2026-10-22 06:56$') -and (Has $r.Lines "^EVENT 2026-10-24 10:06 added 'SkyMP game UDP 7777' by S-1-5-18 with C:\\by-hand\.exe$"))
    Yes '  WinRM, IPv6 and what listens' ((Has $r.Lines '^WINRM service Stopped, start Disabled$') -and (Has $r.Lines '^ADDRESS no IPv6 address') -and (Has $r.Lines '^LISTEN TCP 443 on every interface, caddy$'))

    New-Fake
    $global:Fake.rules = @($global:Fake.rules | Where-Object { $_.Name -in '{g1}', '{w1}', 'OpenSSH-Server-In-TCP', '{off}' })
    $r = Invoke-BoxHere ("-Check -List '" + $keepArg + "'")
    Yes '-Check with every enabled rule listed: exit 0' ($r.Code -eq 0 -and (Has $r.Lines '^DONE read only, 0 rule\(s\) outside the list, 0 required'))
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes '-Apply then: ALREADY, nothing turned off' ($r.Code -eq 0 -and (Has $r.Lines '^ALREADY every enabled inbound Allow rule is on the list$') -and $global:Fake.log.Count -eq 0)

    New-Fake
    $r = Invoke-BoxHere ("-Apply -DryRun -List '" + $keepArg + "'")
    Yes '-Apply -DryRun: WOULD for each rule outside, nothing turned off' ($r.Code -eq 0 -and @($r.Lines | Where-Object { $_ -match '^WOULD turn off ' }).Count -eq 4 -and $global:Fake.log.Count -eq 0 -and (Has $r.Lines '^DONE 4 change\(s\) would be made\. Nothing was changed\.$'))

    New-Fake
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    $off = @($global:Fake.log | ForEach-Object { $_ -replace '^Disable ', '' } | Sort-Object)
    Yes '-Apply: exit 0, turns off WinRM, the old copy, the Windows default and the Store app''s rule' ($r.Code -eq 0 -and ($off -join ',') -eq (@('{old}', '{start}', '{winrm}', 'DeliveryOptimization-TCP-In') | Sort-Object) -join ',')
    Yes '  and says each' (@($r.Lines | Where-Object { $_ -match '^CHANGED turned off ' }).Count -eq 4 -and (Has $r.Lines "^CHANGED turned off 'Allow WinRM HTTPS' \(\{winrm\}\), a local rule$") -and (Has $r.Lines '^DONE 4 change\(s\) made\.$'))
    Yes '  and leaves every listed rule on' (@($global:Fake.rules | Where-Object { $_.Name -in '{g1}', '{w1}', 'OpenSSH-Server-In-TCP' -and -not $_.Enabled }).Count -eq 0)

    New-Fake
    $global:Fake.rules += (Rule '{ssh2}' 'OpenSSH TCP 22' 'TCP' @('22') @('127.0.0.1'))
    $global:Fake.rules += (Rule '{wide}' 'Everything' 'Any' @())
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes '-Apply with an unlisted rule for port 22, and one for every port: both LEFT, never turned off' ((Has $r.Lines "^LEFT 'OpenSSH TCP 22' lets TCP 22 in") -and (Has $r.Lines "^LEFT 'Everything' lets TCP 22 in") -and
        -not ($global:Fake.log -contains 'Disable {ssh2}') -and -not ($global:Fake.log -contains 'Disable {wide}'))
    Yes '  while a Store app''s rule for every port is not taken for ssh''s' ($global:Fake.log -contains 'Disable {start}')
    New-Fake
    $global:Fake.rules += (Rule '{svc}' 'Something on 22' 'TCP' @('22') @('Any') '%SystemRoot%\system32\svchost.exe')
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes '  and neither is a rule for port 22 bound to another program' ($global:Fake.log -contains 'Disable {svc}')

    New-Fake
    $global:Fake.rules = @($global:Fake.rules | Where-Object { $_.Name -ne '{g1}' })
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes '-Apply with the required game rule gone: REQUIRED, STOP, exit 1, nothing turned off' ($r.Code -eq 1 -and (Has $r.Lines "^REQUIRED 'Thornswood game \(UDP\)' is not on the box$") -and (Has $r.Lines '^STOP a required rule is missing or off') -and $global:Fake.log.Count -eq 0)
    $r = Invoke-BoxHere ("-Check -List '" + $keepArg + "'")
    Yes '  and -Check says it and exits 2' ($r.Code -eq 2 -and (Has $r.Lines '1 required rule\(s\) missing or off'))
    New-Fake
    @($global:Fake.rules | Where-Object { $_.Name -eq '{w1}' })[0].Enabled = $false
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes '-Apply with a required rule there but off: STOP, nothing turned off' ($r.Code -eq 1 -and (Has $r.Lines "^REQUIRED '\{w1\}' is there but turned off$") -and $global:Fake.log.Count -eq 0)

    New-Fake
    $global:Fake.sticks = $false
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes '-Apply when a rule reads back still on: STOP after it, exit 1' ($r.Code -eq 1 -and (Has $r.Lines 'reads back as still on after it was turned off') -and $global:Fake.log.Count -eq 1 -and (Has $r.Lines '^DONE 1 change\(s\) made before it stopped\.$'))

    foreach ($case in @(
        @{ Say = 'an empty list'; Given = ("-Apply -List '" + (ListArg @()) + "'"); Rx = '^STOP the list is empty' },
        @{ Say = 'no list at all'; Given = '-Apply'; Rx = '^STOP the list is empty' },
        @{ Say = 'a list that is not base64 JSON'; Given = "-Apply -List 'not-a-list'"; Rx = '^STOP the list does not read' },
        @{ Say = 'no mode'; Given = ("-List '" + $keepArg + "'"); Rx = '^STOP say one of -Check or -Apply' },
        @{ Say = 'both modes'; Given = ("-Check -Apply -List '" + $keepArg + "'"); Rx = '^STOP say one of -Check or -Apply' })) {
        New-Fake
        $r = Invoke-BoxHere $case.Given
        Yes ($case.Say + ': STOP, exit 1, nothing turned off') ($r.Code -eq 1 -and (Has $r.Lines $case.Rx) -and $global:Fake.log.Count -eq 0)
    }

    # ---- 3. the machine half's list -------------------------------------------------
    Write-Host ''
    Write-Host 'the machine half''s list'
    . ([scriptblock]::Create((Fn $Driver 'Read-InboundList')))
    $l = Read-InboundList $RecordFile
    $sent = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($l.Arg)) | ConvertFrom-Json | ForEach-Object { $_ })
    Yes 'the list sent to the box is the record''s, name for name' ((@($sent | ForEach-Object { $_.rule }) -join '|') -eq ($names -join '|'))
    Yes '  with the same required flags' ((@($sent | ForEach-Object { [string]$_.required }) -join '|') -eq (@($entries | ForEach-Object { [string][bool]$_.required }) -join '|'))
    Yes '  and nothing else (no reasons go to the box)' (@($sent | Where-Object { @($_.PSObject.Properties.Name | Where-Object { $_ -notin 'rule', 'required' }).Count }).Count -eq 0)
    foreach ($case in @(
        @{ Say = 'no inboundRules'; Json = '{"about":"x"}'; Rx = 'lists no inboundRules' },
        @{ Say = 'an entry with no name'; Json = '{"inboundRules":[{"rule":" ","required":false,"why":"x"}]}'; Rx = 'has no rule name' },
        @{ Say = 'an entry with no reason'; Json = '{"inboundRules":[{"rule":"a","required":false,"why":""}]}'; Rx = "'a' .* says no why" },
        @{ Say = 'a name twice'; Json = '{"inboundRules":[{"rule":"a","required":false,"why":"x"},{"rule":"a","required":true,"why":"y"}]}'; Rx = "'a' is in .* twice" })) {
        $f = Join-Path $tmp 'record.json'
        [IO.File]::WriteAllText($f, $case.Json, $utf8)
        $msg = ''
        try { $null = Read-InboundList $f } catch { $msg = $_.Exception.Message }
        Yes ('Read-InboundList refuses ' + $case.Say) ($msg -match $case.Rx)
    }
}
finally {
    Remove-Variable -Name Fake -Scope Global -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
