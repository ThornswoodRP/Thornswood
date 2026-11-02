<#
  test-3896-firewall-policy.ps1

      pwsh -NoProfile -File .\tests\test-3896-firewall-policy.ps1

  Issue #3896. Edge's setup added an inbound "Microsoft Edge (mDNS-In)" rule
  on the box with every version, WebView2's one per version, and no policy
  stops either, because the firewall took every local rule any installer
  made. Patrick, 27 Oct 2026: the box's own policy store holds every rule and
  the firewall ignores local rules (A), and Edge goes (B).
  scripts\vps\BoxFirewall.ps1 is the rule; Set-InboundRules.ps1 -Own sends
  scripts\vps\vps-firewall-policy.ps1, which moves the rules; vps-harden.ps1
  takes Edge off (tests\test-harden-vps.ps1 holds that part).

  HOW. NEVER CONNECTS. Four parts.

  1. The refresh. Sync-ThornswoodFirewall runs gpupdate /target:computer
     /force and throws, saying what gpupdate said, when it fails;
     Get-ThornswoodFirewallScript hands its text over whole.
  2. The copies. Every script that carries "# ---- BoxFirewall.ps1 (copy)"
     carries it exactly, every box script that changes a rule carries it,
     and scripts\dev\Copy-BoxGuard.ps1 -Source BoxFirewall writes a planted
     copy right.
  3. Every firewall command under scripts\ names its store: a rule or profile
     command, or a port filter that starts a pipeline, with no -PolicyStore
     reads or writes the local store, which the firewall ignores. A file that
     writes to the policy store refreshes it. The scripts that make the
     Thornswood rules make them in the policy store.
  4. The box half. vps-firewall-policy.ps1 runs here with -Layer: stand-ins
     for every function in it that touches Windows. -Check exits 2 while
     anything is left and 0 once nothing is; -Apply -DryRun changes nothing;
     -Apply probes the store, copies the listed inbound Allow rules and every
     Block rule, refreshes, reads each back from Group Policy, and only then
     turns local rules off and reads the required rules back; a probe the
     store refuses, a copy the firewall does not take, a profile that still
     takes local rules, a required rule missing, outbound Block and a bad
     list each stop it with nothing after done.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
function P([string[]]$parts) { return [IO.Path]::Combine([string[]](@($repo) + $parts)) }
$Lib = P 'scripts', 'vps', 'BoxFirewall.ps1'
$Box = P 'scripts', 'vps', 'vps-firewall-policy.ps1'
$Driver = P 'scripts', 'vps', 'Set-InboundRules.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
$FnAst = [System.Management.Automation.Language.FunctionDefinitionAst]
function Has($lines, [string]$rx) { return (@($lines | Where-Object { $_ -match $rx }).Count -gt 0) }
function Lf([string]$t) { return $t.Replace("`r`n", "`n") }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-3896-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $tmp
$utf8 = New-Object Text.UTF8Encoding($false)
try {
    # ---- 1. the refresh ------------------------------------------------------------
    Write-Host 'the refresh'
    $libText = [IO.File]::ReadAllText($Lib)
    $errs = $null
    $libAst = [System.Management.Automation.Language.Parser]::ParseInput($libText, [ref]$null, [ref]$errs)
    Yes 'BoxFirewall.ps1 parses and is plain ASCII' ((-not $errs -or $errs.Count -eq 0) -and -not ($libText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    $fns = @($libAst.FindAll({ param($n) $n -is $FnAst }, $true) | ForEach-Object { $_.Name })
    Yes '  and defines Sync-ThornswoodFirewall and Get-ThornswoodFirewallScript, nothing else' ((($fns | Sort-Object) -join ',') -eq 'Get-ThornswoodFirewallScript,Sync-ThornswoodFirewall')
    $syncText = Lf (@($libAst.FindAll({ param($n) $n -is $FnAst -and $n.Name -eq 'Sync-ThornswoodFirewall' }, $true))[0].Extent.Text)

    . $Lib
    $global:GpLog = New-Object System.Collections.Generic.List[string]
    function global:gpupdate.exe { $global:GpLog.Add(($args -join ' ')); $global:LASTEXITCODE = $global:GpCode; 'Updating policy...'; if ($global:GpCode) { 'Computer policy could not be updated successfully.' } }
    $global:GpCode = 0
    $threw = ''
    try { Sync-ThornswoodFirewall } catch { $threw = $_.Exception.Message }
    Yes 'Sync-ThornswoodFirewall runs gpupdate /target:computer /force' ($global:GpLog.Count -eq 1 -and $global:GpLog[0] -eq '/target:computer /force' -and -not $threw)
    $global:GpCode = 1
    try { Sync-ThornswoodFirewall } catch { $threw = $_.Exception.Message }
    Yes '  and throws, with what gpupdate said, when it fails' ($threw -match 'gpupdate did not refresh the box''s policy, so the firewall has not taken the change \(exit 1\): Updating policy\.\.\. Computer policy could not be updated successfully\.')
    Remove-Item 'function:global:gpupdate.exe' -ErrorAction SilentlyContinue
    $given = Get-ThornswoodFirewallScript
    Yes 'Get-ThornswoodFirewallScript hands over the function whole, and it parses' ((Lf $given).Trim() -eq $syncText.Trim() -or ((Lf $given) -match 'function Sync-ThornswoodFirewall \{' -and (Lf $given) -match 'gpupdate\.exe /target:computer /force'))
    $e2 = $null
    $null = [System.Management.Automation.Language.Parser]::ParseInput($given, [ref]$null, [ref]$e2)
    Yes '  as text that parses on its own' (-not $e2 -or $e2.Count -eq 0)

    # ---- 2. the copies ---------------------------------------------------------------
    Write-Host ''
    Write-Host 'the copies'
    $open = '# ---- BoxFirewall.ps1 (copy) ----'
    $close = '# ---- end BoxFirewall.ps1 ----'
    $scripts = @(Get-ChildItem -LiteralPath (P 'scripts') -Recurse -File -Filter '*.ps1')
    $carriers = @()
    foreach ($f in $scripts) {
        $t = Lf ([IO.File]::ReadAllText($f.FullName))
        $m = [regex]::Match($t, '(?ms)^' + [regex]::Escape($open) + '\n(.*?)\n' + [regex]::Escape($close) + '$')
        if (-not $m.Success) { continue }
        $carriers += $f.Name
        Yes ('  ' + $f.Name + ' carries an exact copy') ($m.Groups[1].Value -eq $syncText)
    }
    foreach ($need in 'Bootstrap-VPS.ps1', 'vps-dev-instance.ps1', 'vps-firewall-policy.ps1', 'vps-inbound-rules.ps1', 'vps-harden.ps1', 'vps-openssh.ps1', 'vps-ssh-scope.ps1', 'vps-web-firewall.ps1') {
        Yes ("  $need, which changes a rule on the box, carries one") ($carriers -contains $need)
    }
    $plant = Join-Path $tmp 'plant'
    $null = New-Item -ItemType Directory -Force -Path $plant
    [IO.File]::WriteAllText((Join-Path $plant 'carrier.ps1'), ("# top`r`n" + $open + "`r`nfunction Sync-ThornswoodFirewall { 'old' }`r`n" + $close + "`r`n'after'`r`n"), $utf8)
    $said = @(& pwsh -NoProfile -File (P 'scripts', 'dev', 'Copy-BoxGuard.ps1') -Root $plant -Source BoxFirewall 2>&1 | ForEach-Object { [string]$_ })
    $after = [IO.File]::ReadAllText((Join-Path $plant 'carrier.ps1'))
    Yes 'Copy-BoxGuard.ps1 -Source BoxFirewall writes the function into a planted copy, keeping CRLF and the rest' ((Has $said '^WRITTEN ') -and (Lf $after) -eq ("# top`n" + $open + "`n" + $syncText + "`n" + $close + "`n'after'`n") -and $after.Contains("`r`n"))

    # ---- 3. every firewall command names its store -----------------------------------
    Write-Host ''
    Write-Host 'every firewall command names its store'
    $loose = @()
    $writers = @()
    foreach ($f in $scripts) {
        $rel = $f.FullName.Substring($repo.Length + 1)
        $lines = @((Lf ([IO.File]::ReadAllText($f.FullName))) -split "`n")
        $inHelp = $false
        $writes = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $l = $lines[$i]
            if ($inHelp) { if ($l -match '#>') { $inHelp = $false }; continue }
            if ($l -match '^\s*<#') { if ($l -notmatch '#>') { $inHelp = $true }; continue }
            if ($l -match '^\s*#') { continue }
            foreach ($m in [regex]::Matches($l, '(?<pipe>\|\s*)?\b(?<verb>Get|New|Set|Remove|Enable|Disable|Copy)-NetFirewall(?<noun>Rule|Profile|PortFilter)\b')) {
                $noun = $m.Groups['noun'].Value; $verb = $m.Groups['verb'].Value
                if ($m.Groups['pipe'].Success) { continue }
                if ($noun -eq 'PortFilter' -and $verb -ne 'Get') { continue }
                $rest = $l.Substring($m.Index)
                if ($rest -notmatch '-(New)?PolicyStore\b') { $loose += ($rel + ':' + ($i + 1) + ' ' + $verb + '-NetFirewall' + $noun) }
                if ($verb -ne 'Get' -and $rest -match '-PolicyStore (localhost|\$grdStore|\$Store)\b|-NewPolicyStore localhost') { $writes = $true }
            }
        }
        if ($writes) { $writers += $rel }
    }
    Yes ('no firewall command under scripts\ reads or writes the store the firewall ignores' + $(if ($loose.Count) { ': ' + ($loose -join '; ') } else { '' })) ($loose.Count -eq 0)
    $noSync = @($writers | Where-Object { $_ -notmatch 'vps-firewall-policy\.ps1$' -and ([IO.File]::ReadAllText((Join-Path $repo $_))) -notmatch 'Sync-ThornswoodFirewall\b' })
    Yes ('every script that writes to the policy store refreshes it: ' + ($writers -join ', ') + $(if ($noSync.Count) { '; NOT: ' + ($noSync -join ', ') } else { '' })) ($writers.Count -ge 8 -and $noSync.Count -eq 0)
    $makers = [ordered]@{
        'scripts/vps/Bootstrap-VPS.ps1' = 'New-NetFirewallRule -PolicyStore localhost -DisplayName \$r\.Name'
        'scripts/vps/vps-dev-instance.ps1' = 'New-NetFirewallRule -PolicyStore localhost -DisplayName \$r\.Name'
        'scripts/deploy/Setup-Domain.ps1' = 'New-NetFirewallRule -PolicyStore localhost -DisplayName `\$n'
        'scripts/deploy/Install-Voice.ps1' = "New-NetFirewallRule -PolicyStore localhost -DisplayName '\`$TaskName'".Replace('`', '')
        'scripts/deploy/Deploy-Docs.ps1' = "New-NetFirewallRule -PolicyStore localhost -DisplayName '\`$Task'".Replace('`', '')
        'scripts/deploy/Install-Runner.ps1' = 'New-NetFirewallRule -PolicyStore \$grdStore'
    }
    foreach ($rel in $makers.Keys) {
        Yes ("  $rel makes its rule in the policy store") ([IO.File]::ReadAllText((P ($rel -split '/'))) -match $makers[$rel])
    }
    $runner = [IO.File]::ReadAllText((P 'scripts', 'deploy', 'Install-Runner.ps1'))
    Yes '  the runner fences go in the policy store on the box and the local store off it (-OffBox)' ($runner -match "if \(\`$OffBox\) \{ 'PersistentStore' \} else \{ 'localhost' \}" -and $runner -match "if \(\`$grdStore -eq 'localhost'\) \{ Sync-ThornswoodFirewall \}")
    foreach ($rel in 'scripts/deploy/Install-Voice.ps1', 'scripts/deploy/Deploy-Docs.ps1', 'scripts/deploy/Setup-Domain.ps1', 'scripts/deploy/Install-Runner.ps1') {
        Yes ("  $rel loads BoxFirewall.ps1 and puts its text into the box code") ([IO.File]::ReadAllText((P ($rel -split '/'))) -match "\. \(Join-Path \`$Here '\.\.\\vps\\BoxFirewall\.ps1'\)" -and [IO.File]::ReadAllText((P ($rel -split '/'))) -match 'Get-ThornswoodFirewallScript')
    }

    # ---- 4. the box half -----------------------------------------------------------------
    Write-Host ''
    Write-Host 'the box half'
    $boxText = [IO.File]::ReadAllText($Box)
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($boxText, [ref]$null, [ref]$errs)
    Yes 'vps-firewall-policy.ps1 parses and is plain ASCII' ((-not $errs -or $errs.Count -eq 0) -and -not ($boxText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    $dt = [IO.File]::ReadAllText($Driver)
    Yes 'Set-InboundRules.ps1 -Own sends vps-firewall-policy.ps1 with the same list' ($dt -match '\[switch\]\$Own' -and $dt -match "if \(\`$Own\) \{ 'vps-firewall-policy\.ps1' \} else \{ 'vps-inbound-rules\.ps1' \}" -and $dt -match 'if \(\$Check -and \$Own\)')

    $layerNames = @('Get-ThornswoodBoxRefusal', 'Sync-ThornswoodFirewall', 'Get-RuleRows', 'Get-LocalRules', 'Get-PolicyRules', 'Get-ActiveRules', 'Get-Profiles', 'New-ProbeRule', 'Remove-ProbeRule', 'Copy-ToPolicy', 'Set-LocalRulesOff')
    $defined = @($ast.FindAll({ param($n) $n -is $FnAst }, $true) | ForEach-Object { $_.Name })
    Yes 'every layer function the stand-in replaces is defined in it' (@($layerNames | Where-Object { $defined -notcontains $_ }).Count -eq 0)
    $touchers = 'Get-NetFirewallRule', 'Set-NetFirewallRule', 'New-NetFirewallRule', 'Remove-NetFirewallRule', 'Enable-NetFirewallRule', 'Disable-NetFirewallRule', 'Copy-NetFirewallRule',
                'Get-NetFirewallProfile', 'Set-NetFirewallProfile', 'Get-CimInstance', 'gpupdate.exe', 'gpupdate'
    $looseCmd = @()
    foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $name = $c.GetCommandName()
        if (-not $name -or $touchers -notcontains $name) { continue }
        $p = $c.Parent
        while ($p -and -not ($p -is $FnAst)) { $p = $p.Parent }
        if (-not $p -or $layerNames -notcontains $p.Name) { $looseCmd += ('{0} at line {1}' -f $name, $c.Extent.StartLineNumber) }
    }
    Yes ('every command in it that touches Windows is inside a layer function' + $(if ($looseCmd.Count) { ': ' + ($looseCmd -join ', ') } else { '' })) ($looseCmd.Count -eq 0)
    Yes 'it never deletes a rule but its own probe, and never touches the local store but to read and copy from it' (@([regex]::Matches($boxText, 'Remove-NetFirewallRule')).Count -eq 1 -and $boxText -match 'Remove-NetFirewallRule -PolicyStore localhost -Name \$Probe' -and $boxText -notmatch '(Set|Disable|Enable|Remove)-NetFirewallRule -PolicyStore PersistentStore')
    Yes '  the probe is made off, so it lets nothing in' ($boxText -match 'New-NetFirewallRule -PolicyStore localhost -Name \$Probe .*-Enabled False')

    $layerText = @'
function Get-ThornswoodBoxRefusal { return '' }
function Sync-ThornswoodFirewall {
    $global:Fake.log.Add('Sync')
    if ($global:Fake.syncTakes) {
        foreach ($r in $global:Fake.policy) { if (-not @($global:Fake.active | Where-Object { $_.Name -eq $r.Name -and $_.Source -eq 'GroupPolicy' }).Count) { $global:Fake.active += [pscustomobject]@{ Name = $r.Name; DisplayName = $r.DisplayName; Direction = $r.Direction; Action = $r.Action; Enabled = $r.Enabled; Source = 'GroupPolicy' } } }
        if ($global:Fake.offAsked -and $global:Fake.offTakes) { foreach ($p in $global:Fake.profiles) { $p.AllowLocal = 'False' }; $global:Fake.active = @($global:Fake.active | Where-Object { $_.Source -ne 'Local' }) }
    }
}
function Get-RuleRows([string]$Store) { return @() }
function Get-LocalRules { return @($global:Fake.local) }
function Get-PolicyRules { return @($global:Fake.policy) }
function Get-ActiveRules { return @($global:Fake.active) }
function Get-Profiles { return @($global:Fake.profiles | ForEach-Object { [pscustomobject]@{ Name = $_.Name; AllowLocal = $_.AllowLocal; Outbound = $_.Outbound } }) }
function New-ProbeRule {
    $global:Fake.log.Add('New-ProbeRule')
    if ($global:Fake.probeRefused) { throw 'The system cannot find the path specified.' }
    if ($global:Fake.probeSticks) { $global:Fake.policy += [pscustomobject]@{ Name = 'Thornswood policy probe 3896'; DisplayName = 'Thornswood policy probe 3896'; Direction = 'Inbound'; Action = 'Allow'; Enabled = $false; Source = 'GroupPolicy' } }
}
function Remove-ProbeRule { $global:Fake.log.Add('Remove-ProbeRule'); $global:Fake.policy = @($global:Fake.policy | Where-Object { $_.Name -ne 'Thornswood policy probe 3896' }) }
function Copy-ToPolicy([string]$Name) {
    $global:Fake.log.Add('Copy ' + $Name)
    $r = @($global:Fake.local | Where-Object { $_.Name -eq $Name })[0]
    $global:Fake.policy += [pscustomobject]@{ Name = $r.Name; DisplayName = $r.DisplayName; Direction = $r.Direction; Action = $r.Action; Enabled = $r.Enabled; Source = 'GroupPolicy' }
}
function Set-LocalRulesOff { $global:Fake.log.Add('Set-LocalRulesOff'); $global:Fake.offAsked = $true }
'@
    $Layer = Join-Path $tmp 'layer.ps1'
    [IO.File]::WriteAllText($Layer, $layerText, $utf8)
    $fakeAst = [System.Management.Automation.Language.Parser]::ParseInput($layerText, [ref]$null, [ref]$null)
    $fakeNames = @($fakeAst.FindAll({ param($n) $n -is $FnAst }, $true) | ForEach-Object { $_.Name })
    Yes '  and the stand-in replaces every one of them' (@($layerNames | Where-Object { $fakeNames -notcontains $_ }).Count -eq 0)

    function Rule([string]$name, [string]$display, [string]$dir = 'Inbound', [string]$action = 'Allow', [bool]$enabled = $true, [string]$source = 'Local') {
        return [pscustomobject]@{ Name = $name; DisplayName = $display; Direction = $dir; Action = $action; Enabled = $enabled; Source = $source }
    }
    # The box as it was on 26 Oct, cut down: the game and web rules, ssh's,
    # Edge's mDNS rules, a runner fence and an RDP block, all local.
    function New-Fake {
        $local = @(
            (Rule '{g1}' 'Thornswood game (UDP)'),
            (Rule '{w1}' 'Thornswood Web 443'),
            (Rule 'OpenSSH-Server-In-TCP' 'OpenSSH SSH Server (sshd)'),
            (Rule '{BB8BEC42}' 'Microsoft Edge (mDNS-In)'),
            (Rule '{C1FB28ED}' 'Microsoft Edge (mDNS-In)'),
            (Rule '{fence1}' 'Thornswood PR runner thornswood-runner3 1' 'Outbound' 'Block'),
            (Rule '{rdp}' 'Thornswood: block RDP from outside' 'Inbound' 'Block'),
            (Rule '{off}' 'Already off' 'Inbound' 'Allow' $false))
        $global:Fake = @{
            local = $local
            policy = @()
            active = @($local | Where-Object { $_.Enabled })
            profiles = @(@{ Name = 'Domain'; AllowLocal = 'True'; Outbound = 'Allow' }, @{ Name = 'Private'; AllowLocal = 'True'; Outbound = 'Allow' }, @{ Name = 'Public'; AllowLocal = 'True'; Outbound = 'Allow' })
            syncTakes = $true; offTakes = $true; offAsked = $false
            probeRefused = $false; probeSticks = $true
            log = New-Object System.Collections.Generic.List[string]
        }
    }
    function ListArg($items) { return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject @($items) -Compress))) }
    $keepArg = ListArg @(@{ rule = 'Thornswood game (UDP)'; required = $true }, @{ rule = '{w1}'; required = $true }, @{ rule = 'OpenSSH-Server-In-TCP'; required = $false }, @{ rule = 'Thornswood Voice'; required = $false })
    function Invoke-BoxHere([string]$given) {
        $global:LASTEXITCODE = 0
        $sb = [scriptblock]::Create("& '" + $Box.Replace("'", "''") + "' -Layer '" + $Layer.Replace("'", "''") + "' " + $given)
        $out = @(& $sb 2>&1 | ForEach-Object { [string]$_ })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out; Text = ($out -join "`n") }
    }

    New-Fake
    $r = Invoke-BoxHere ("-Check -List '" + $keepArg + "'")
    Yes '-Check before the move: exit 2, read only' ($r.Code -eq 2 -and $global:Fake.log.Count -eq 0 -and (Has $r.Lines '^DONE read only, 6 thing\(s\) left before the box''s policy holds every rule\. Nothing was changed\.$'))
    Yes '  MOVE for the listed rules, the fence and the RDP block; not Edge''s rules or one already off' ((Has $r.Lines "^MOVE 'Thornswood game \(UDP\)' \(\{g1\}\), Inbound Allow$") -and (Has $r.Lines "^MOVE 'Thornswood Web 443'") -and (Has $r.Lines "^MOVE 'OpenSSH SSH Server \(sshd\)'") -and
        (Has $r.Lines "^MOVE 'Thornswood PR runner thornswood-runner3 1' \(\{fence1\}\), Outbound Block$") -and (Has $r.Lines "^MOVE 'Thornswood: block RDP from outside'") -and -not (Has $r.Lines '^MOVE .*Edge') -and -not (Has $r.Lines 'Already off'))
    Yes '  and each profile still taking local rules' ((Has $r.Lines '^PROFILE Public: local rules taken \(True\), outbound Allow') -and @($r.Lines | Where-Object { $_ -match '^PROFILE ' }).Count -eq 3)

    New-Fake
    $r = Invoke-BoxHere ("-Apply -DryRun -List '" + $keepArg + "'")
    Yes '-Apply -DryRun: WOULD for the probe, each copy and local rules off; nothing changed' ($r.Code -eq 0 -and $global:Fake.log.Count -eq 0 -and (Has $r.Lines "^WOULD make 'Thornswood policy probe 3896' \(off\)") -and
        @($r.Lines | Where-Object { $_ -match '^WOULD copy ' }).Count -eq 5 -and (Has $r.Lines '^WOULD set AllowLocalFirewallRules False') -and (Has $r.Lines '^DONE 6 change\(s\) would be made\. Nothing was changed\.$'))
    Yes '  and names the Edge rules local rules off would leave behind' (@($r.Lines | Where-Object { $_ -match "^IGNORED 'Microsoft Edge \(mDNS-In\)'" }).Count -eq 2)

    New-Fake
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    $log = @($global:Fake.log)
    Yes '-Apply: exit 0' ($r.Code -eq 0 -and (Has $r.Lines '^DONE 6 change\(s\) made\.$'))
    Yes '  the probe first, made and taken away, before any copy' ($log[0] -eq 'New-ProbeRule' -and $log[1] -eq 'Remove-ProbeRule' -and (Has $r.Lines '^PROBE .*taken away and read back gone'))
    Yes '  then each rule copied into the policy store, one refresh, then local rules off and a second refresh' ((($log | Where-Object { $_ -like 'Copy *' }) | Sort-Object) -join ',' -eq (@('Copy {g1}', 'Copy {w1}', 'Copy OpenSSH-Server-In-TCP', 'Copy {fence1}', 'Copy {rdp}') | Sort-Object) -join ',' -and
        ($log -join ',') -match '^New-ProbeRule,Remove-ProbeRule,(Copy [^,]+,){5}Sync,Set-LocalRulesOff,Sync$')
    Yes '  each copy read back as taken from Group Policy before local rules go off' (@($r.Lines | Where-Object { $_ -match '^ACTIVE .*from Group Policy$' }).Count -eq 5 -and
        [array]::IndexOf($r.Lines, @($r.Lines | Where-Object { $_ -match '^ACTIVE ' })[4]) -lt [array]::IndexOf($r.Lines, @($r.Lines | Where-Object { $_ -match '^CHANGED the firewall ignores local rules' })[0]))
    Yes '  and the required rules read back from the policy once it does' (Has $r.Lines '^ACTIVE every required rule is taken from the policy store$')
    Yes '  and Edge''s rules said to be ignored now' (@($r.Lines | Where-Object { $_ -match "^IGNORED 'Microsoft Edge \(mDNS-In\)'" }).Count -eq 2)
    $r = Invoke-BoxHere ("-Check -List '" + $keepArg + "'")
    Yes '-Check after it: exit 0, every rule HELD, every profile ignoring local rules' ($r.Code -eq 0 -and @($r.Lines | Where-Object { $_ -match '^HELD ' }).Count -eq 5 -and -not (Has $r.Lines '^MOVE ') -and @($r.Lines | Where-Object { $_ -match '^PROFILE .*local rules ignored' }).Count -eq 3 -and (Has $r.Lines '^DONE read only, 0 thing'))
    $global:Fake.log.Clear()
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes '-Apply again: only the probe, no copy, ALREADY' ($r.Code -eq 0 -and (($global:Fake.log) -join ',') -eq 'New-ProbeRule,Remove-ProbeRule' -and (Has $r.Lines '^ALREADY every profile ignores local rules'))

    New-Fake
    $global:Fake.probeRefused = $true
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes 'a probe the store refuses: STOP, exit 1, nothing copied or turned off' ($r.Code -eq 1 -and (Has $r.Lines '^STOP the policy store refused a rule: The system cannot find the path specified\.') -and (($global:Fake.log) -join ',') -eq 'New-ProbeRule')
    New-Fake
    $global:Fake.probeSticks = $false
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes 'a probe that does not read back: STOP, nothing copied' ($r.Code -eq 1 -and (Has $r.Lines "^STOP 'Thornswood policy probe 3896' was made without an error but does not read back") -and -not @($global:Fake.log | Where-Object { $_ -like 'Copy *' }).Count)

    New-Fake
    $global:Fake.syncTakes = $false
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes 'copies the firewall does not take after a refresh: STOP before local rules go off' ($r.Code -eq 1 -and (Has $r.Lines 'is in the policy store, but the firewall does not take it from there after a refresh\. Local rules are still taken') -and -not ($global:Fake.log -contains 'Set-LocalRulesOff'))

    New-Fake
    $global:Fake.offTakes = $false
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes 'a profile that still takes local rules after the refresh: STOP, saying what the firewall says' ($r.Code -eq 1 -and (Has $r.Lines '^STOP AllowLocalFirewallRules False is in the policy store, but the firewall still says Domain True, Private True, Public True after a refresh\.$'))

    New-Fake
    $global:Fake.local = @($global:Fake.local | Where-Object { $_.Name -ne '{g1}' })
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes 'a required rule missing: REQUIRED, STOP, no probe, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines "^REQUIRED 'Thornswood game \(UDP\)' is not on the box, or is off$") -and (Has $r.Lines '^STOP a required rule is missing or off') -and $global:Fake.log.Count -eq 0)
    $r = Invoke-BoxHere ("-Check -List '" + $keepArg + "'")
    Yes '  and -Check counts it, exit 2' ($r.Code -eq 2)

    New-Fake
    $global:Fake.profiles[2].Outbound = 'Block'
    $r = Invoke-BoxHere ("-Apply -List '" + $keepArg + "'")
    Yes 'a profile that blocks outbound by default: STOP, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP the Public profile blocks outbound traffic no rule names') -and $global:Fake.log.Count -eq 0)

    foreach ($case in @(
        @{ Say = 'an empty list'; Given = ("-Apply -List '" + (ListArg @()) + "'"); Rx = '^STOP the list is empty' },
        @{ Say = 'a list that is not base64 JSON'; Given = "-Apply -List 'not-a-list'"; Rx = '^STOP the list does not read' },
        @{ Say = 'no mode'; Given = ("-List '" + $keepArg + "'"); Rx = '^STOP say one of -Check or -Apply' },
        @{ Say = 'both modes'; Given = ("-Check -Apply -List '" + $keepArg + "'"); Rx = '^STOP say one of -Check or -Apply' })) {
        New-Fake
        $r = Invoke-BoxHere $case.Given
        Yes ($case.Say + ': STOP, exit 1, nothing changed') ($r.Code -eq 1 -and (Has $r.Lines $case.Rx) -and $global:Fake.log.Count -eq 0)
    }
}
finally {
    Remove-Variable -Name Fake -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable -Name GpLog, GpCode -Scope Global -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
