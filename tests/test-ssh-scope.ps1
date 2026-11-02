<#
  test-ssh-scope.ps1

      pwsh -NoProfile -File .\tests\test-ssh-scope.ps1

  scripts\vps\Set-SshScope.ps1 refuses unless key login is proven, and
  scripts\vps\vps-ssh-scope.ps1 narrows the firewall rules for port 22 on the
  box to a list of addresses, never to a list that leaves out the machine
  running it, with a put back armed before anything changes.

  WHY. Issue #2182, decision 2 (Patrick, 11 Oct 2026): restrict port 22 to
  known addresses. ssh is the only way into the box besides the provider's
  console, so the refusals and the put back matter more than the change: a
  list that missed the machine running it would lock that machine out, and a
  rule for every port would leave 22 open whatever the list said.

  HOW. NEVER CONNECTS. Two halves, the shape of tests\test-harden-vps.ps1.

  The box half runs vps-ssh-scope.ps1 here with -Layer: stand-ins for every
  function in it that touches Windows (the firewall rules, the scheduled
  task, SSH_CLIENT, the save folder), keeping their state in a table this
  harness reads. It checks: a dry run changes nothing; a real run saves the
  rules as they were, arms the put back before it sets anything, and sets
  only the enabled Allow rules for TCP 22; a second run changes nothing; a
  list without the caller, a bad entry, Any inside a list, a rule for every
  port from anywhere, a rule shared with other ports and no rule for 22 each
  stop it with nothing changed; Any opens it again; ranges and IPv6 are
  matched by their bits. And that every command in it that changes Windows
  sits inside a layer function.

  The machine half runs Set-SshScope.ps1 with ssh, scp and ssh-keygen as
  stand-ins. ssh, given the script Send-Script.ps1 sends on its standard
  input, checks it carries the whole of vps-ssh-scope.ps1 and runs that file
  against the stand-in layer with the -From and -DryRun the script gave it.
  It checks: no pinned key, or no key login, means a refusal before anything
  is sent; nothing is ever copied to the box (#3035); -WhatIf runs the box
  read only; a real run proves a new key login before it cancels the put
  back; a new login that fails leaves the put back armed and exits 1.
  tests\test-3035-file-script.ps1 runs the sent form itself, in a process of
  its own.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$Box = Join-Path $repo 'scripts\vps\vps-ssh-scope.ps1'
$Driver = Join-Path $repo 'scripts\vps\Set-SshScope.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-sshscope-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)

$layerText = @'
function Get-CallerAddress { return [string]$global:Fake.caller }
function Get-SaveFolder { return [string]$global:Fake.save }
function Get-ThornswoodBoxRefusal { return '' }
function Get-AllowRules {
    foreach ($r in $global:Fake.rules) {
        if ($r.Enabled -and $r.Action -eq 'Allow') {
            [pscustomobject]@{ Name = $r.Name; DisplayName = $r.DisplayName; Protocol = $r.Protocol; Ports = @($r.Ports); Program = $r.Program; Package = [string]$r.Package; Service = [string]$r.Service; Remote = @($r.Remote) }
        }
    }
}
function Set-RuleRemote([string]$Name, [string[]]$Remote) {
    foreach ($r in $global:Fake.rules) { if ($r.Name -eq $Name) { $r.Remote = @($Remote) } }
    $global:Fake.log.Add('Set-RuleRemote ' + $Name)
}
function Register-Rollback([string]$Saved) { $global:Fake.rollback = $Saved; $global:Fake.log.Add('Register-Rollback') }
function New-PrivateFile([string]$Path) {
    $global:Fake.private.Add([pscustomobject]@{ Path = $Path; Existed = (Test-Path -LiteralPath $Path) })
    [IO.File]::WriteAllBytes($Path, [byte[]]@())
    $global:Fake.log.Add('New-PrivateFile')
}
'@
$Layer = Join-Path $tmp 'layer.ps1'
[IO.File]::WriteAllText($Layer, $layerText, $utf8)

function New-Fake {
    $save = Join-Path $tmp ('save-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $save -Force | Out-Null
    $global:Fake = @{
        caller = '203.0.113.7'
        save = $save
        rules = @(
            @{ Name = 'OpenSSH-Server-In-TCP'; DisplayName = 'OpenSSH SSH Server (sshd)'; Action = 'Allow'; Protocol = 'TCP'; Ports = @('22'); Program = 'C:\Windows\System32\OpenSSH\sshd.exe'; Remote = @('Any'); Enabled = $true },
            @{ Name = 'sshd-22-extra'; DisplayName = 'Open SSH Port 22'; Action = 'Allow'; Protocol = 'TCP'; Ports = @('22'); Program = 'Any'; Remote = @('Any'); Enabled = $true },
            @{ Name = 'sshd-22-off'; DisplayName = 'an old ssh rule, off'; Action = 'Allow'; Protocol = 'TCP'; Ports = @('22'); Program = 'Any'; Remote = @('Any'); Enabled = $false },
            @{ Name = 'block-22'; DisplayName = 'a block on 22'; Action = 'Block'; Protocol = 'TCP'; Ports = @('22'); Program = 'Any'; Remote = @('198.51.100.9'); Enabled = $true },
            @{ Name = 'Thornswood-Game'; DisplayName = 'Thornswood game'; Action = 'Allow'; Protocol = 'UDP'; Ports = @('7777'); Program = 'Any'; Remote = @('Any'); Enabled = $true },
            @{ Name = 'Thornswood-Site'; DisplayName = 'Thornswood site'; Action = 'Allow'; Protocol = 'TCP'; Ports = @('443'); Program = 'Any'; Remote = @('Any'); Enabled = $true },
            @{ Name = 'node-any'; DisplayName = 'node, every port'; Action = 'Allow'; Protocol = 'TCP'; Ports = @('Any'); Program = 'C:\Program Files\nodejs\node.exe'; Remote = @('Any'); Enabled = $true }
        )
        rollback = ''
        log = New-Object System.Collections.Generic.List[string]
        private = New-Object System.Collections.Generic.List[object]
    }
}
function Rule([string]$name) { return @($global:Fake.rules | Where-Object { $_.Name -eq $name })[0] }
function RemoteOf([string]$name) { return ((Rule $name).Remote -join ',') }

function Invoke-BoxHere([string]$from, [switch]$Dry) {
    $a = @{ Layer = $Layer; From = $from }
    if ($Dry) { $a.DryRun = $true }
    $global:LASTEXITCODE = 0
    $out = @(& $Box @a 2>&1 | ForEach-Object { [string]$_ })
    return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out }
}
function Has($lines, [string]$rx) { return (@($lines | Where-Object { $_ -match $rx }).Count -gt 0) }
function Untouched { return ($global:Fake.log.Count -eq 0 -and -not $global:Fake.rollback -and (RemoteOf 'OpenSSH-Server-In-TCP') -eq 'Any' -and (RemoteOf 'sshd-22-extra') -eq 'Any') }

try {
    # =================================================================== the box ===
    $boxText = [IO.File]::ReadAllText($Box)
    $errs = $null; $tokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($boxText, [ref]$tokens, [ref]$errs)
    Yes 'vps-ssh-scope.ps1 parses' (-not $errs -or $errs.Count -eq 0)
    Yes '  and is plain ASCII' (-not ($boxText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    $driverText = [IO.File]::ReadAllText($Driver)
    Yes 'Set-SshScope.ps1 is plain ASCII too' (-not ($driverText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))

    $layerNames = @('Get-CallerAddress', 'Get-SaveFolder', 'Get-ThornswoodBoxRefusal', 'Get-AllowRules', 'Set-RuleRemote', 'Register-Rollback', 'New-PrivateFile')
    $defined = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
    Yes 'every layer function the stand-in replaces is defined in it' (@($layerNames | Where-Object { $defined -notcontains $_ }).Count -eq 0)
    $fakeAst = [System.Management.Automation.Language.Parser]::ParseInput($layerText, [ref]$null, [ref]$null)
    $fakeNames = @($fakeAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
    Yes '  and the stand-in replaces every one of them' (@($layerNames | Where-Object { $fakeNames -notcontains $_ }).Count -eq 0)
    $touchers = 'Get-NetFirewallRule', 'Get-NetFirewallPortFilter', 'Get-NetFirewallAddressFilter', 'Get-NetFirewallApplicationFilter', 'Set-NetFirewallRule',
                'Disable-NetFirewallRule', 'Enable-NetFirewallRule', 'Remove-NetFirewallRule', 'New-NetFirewallRule', 'Register-ScheduledTask', 'Unregister-ScheduledTask', 'Start-ScheduledTask', 'Get-CimInstance'
    $loose = @()
    foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $name = $c.GetCommandName()
        if (-not $name -or $touchers -notcontains $name) { continue }
        $p = $c.Parent
        while ($p -and -not ($p -is [System.Management.Automation.Language.FunctionDefinitionAst])) { $p = $p.Parent }
        if (-not $p -or $layerNames -notcontains $p.Name) { $loose += ('{0} at line {1}' -f $name, $c.Extent.StartLineNumber) }
    }
    Yes ('every command in it that touches Windows is inside a layer function' + $(if ($loose.Count) { ': ' + ($loose -join ', ') } else { '' })) ($loose.Count -eq 0)
    # A copy written plainly into C:\ProgramData\ssh takes the folder's rule
    # for every signed in account (#3034), so rules are set in one place.
    $setAcl = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and [string]$n.Member -eq 'SetAccessControl' }, $true) | Where-Object {
        $p = $_.Parent; while ($p -and -not ($p -is [System.Management.Automation.Language.FunctionDefinitionAst])) { $p = $p.Parent }; -not $p -or $p.Name -ne 'New-PrivateFile' })
    $copies = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and @('Copy-Item', 'Set-Acl', 'icacls', 'icacls.exe') -contains $n.GetCommandName() }, $true))
    Yes '  a file''s rules are set only in New-PrivateFile, and no Copy-Item, Set-Acl or icacls makes or changes one' (-not $setAcl.Count -and -not $copies.Count)
    Yes 'SSH_CLIENT is read only inside the layer' (@([regex]::Matches($boxText, 'SSH_CLIENT') | Where-Object { $_ }).Count -ge 1 -and $boxText -match "function Get-CallerAddress \{ return \(\[string\]\`$env:SSH_CLIENT")

    # ---- a dry run changes nothing ------------------------------------------------
    New-Fake
    $r = Invoke-BoxHere '203.0.113.7,198.51.100.0/24' -Dry
    Yes 'dry run: exits 0' ($r.Code -eq 0)
    Yes '  says the caller is inside the list' (Has $r.Lines '^KEPT this session comes from 203\.0\.113\.7, inside 203\.0\.113\.7$')
    Yes '  says WOULD for the save, the put back and both enabled rules for 22' ((Has $r.Lines '^WOULD saved the rules') -and (Has $r.Lines "^WOULD a task named 'Thornswood ssh scope rollback'") -and
        (Has $r.Lines "^WOULD rule 'OpenSSH SSH Server \(sshd\)' takes port 22 from 203\.0\.113\.7, 198\.51\.100\.0/24 \(was Any\)") -and (Has $r.Lines "^WOULD rule 'Open SSH Port 22'"))
    Yes '  and changes nothing, saves nothing, arms nothing' ((Untouched) -and @(Get-ChildItem -LiteralPath $global:Fake.save).Count -eq 0)
    Yes '  has nothing of its own to delete, since it is never written on the box (#3035), and its last line says nothing was changed' (
        $boxText -notmatch 'PSCommandPath|KeepSelf' -and $r.Lines[-1] -match '^DONE \d+ change\(s\) would be made\. Nothing was changed\.')

    # ---- a real run ------------------------------------------------------------------
    $r = Invoke-BoxHere '203.0.113.7,198.51.100.0/24'
    Yes 'real run: exits 0' ($r.Code -eq 0)
    Yes '  both enabled Allow rules for 22 take only the list' ((RemoteOf 'OpenSSH-Server-In-TCP') -eq '203.0.113.7,198.51.100.0/24' -and (RemoteOf 'sshd-22-extra') -eq '203.0.113.7,198.51.100.0/24')
    Yes '  the disabled rule, the block rule and the other ports are not touched' ((RemoteOf 'sshd-22-off') -eq 'Any' -and (RemoteOf 'block-22') -eq '198.51.100.9' -and
        (RemoteOf 'Thornswood-Site') -eq 'Any' -and (RemoteOf 'Thornswood-Game') -eq 'Any' -and (RemoteOf 'node-any') -eq 'Any')
    $saved = @(Get-ChildItem -LiteralPath $global:Fake.save -Filter 'ssh-scope-before-*.json')
    $doc = if ($saved.Count) { Get-Content -Raw -LiteralPath $saved[0].FullName | ConvertFrom-Json } else { $null }
    Yes '  the rules as they were are saved, and only the two it changed' ($saved.Count -eq 1 -and @($doc.rules).Count -eq 2 -and
        @($doc.rules | Where-Object { @($_.remote) -join ',' -ne 'Any' }).Count -eq 0 -and (@($doc.rules.name) -join ',') -eq 'OpenSSH-Server-In-TCP,sshd-22-extra')
    Yes '  made by New-PrivateFile while it did not exist yet, so its rules are set before the rules go in (#3034)' ($global:Fake.private.Count -eq 1 -and
        $global:Fake.private[0].Path -eq $saved[0].FullName -and -not $global:Fake.private[0].Existed -and $global:Fake.log[0] -eq 'New-PrivateFile')
    Yes '  the put back is armed with that file before any rule is set' ($global:Fake.rollback -eq $saved[0].FullName -and $global:Fake.log[1] -eq 'Register-Rollback' -and $global:Fake.log.Count -eq 4)
    Yes '  every change printed as CHANGED, and the count in the last line' (@($r.Lines | Where-Object { $_ -match '^CHANGED ' }).Count -eq 4 -and $r.Lines[-1] -eq 'DONE 4 change(s) made.')

    $r2 = Invoke-BoxHere '198.51.100.0/24 203.0.113.7'
    Yes 'second run with the same list in another order: nothing to change' ($r2.Code -eq 0 -and $r2.Lines[-1] -eq 'DONE 0 change(s) made.' -and (Has $r2.Lines "^ALREADY rule 'OpenSSH SSH Server") -and $global:Fake.log.Count -eq 4)

    $r3 = Invoke-BoxHere 'Any'
    Yes 'Any opens both rules again, with its own save and put back' ($r3.Code -eq 0 -and (RemoteOf 'OpenSSH-Server-In-TCP') -eq 'Any' -and (RemoteOf 'sshd-22-extra') -eq 'Any' -and
        @(Get-ChildItem -LiteralPath $global:Fake.save -Filter 'ssh-scope-before-*.json').Count -ge 1 -and -not (Has $r3.Lines '^KEPT this session'))

    # ---- refusals, each with nothing changed ---------------------------------------------------
    New-Fake
    $r = Invoke-BoxHere '198.51.100.0/24'
    Yes 'a list without the caller: STOP naming the caller, exit 1' ($r.Code -eq 1 -and (Has $r.Lines '^STOP this session comes from 203\.0\.113\.7, which is not in the list'))
    Yes '  nothing changed' (Untouched)

    New-Fake
    $global:Fake.caller = ''
    $r = Invoke-BoxHere '203.0.113.7'
    Yes 'no SSH_CLIENT: STOP, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP could not read the address this session comes from') -and (Untouched))

    foreach ($bad in '203.0.113', '203.0.113.7/33', 'thornswood.net', '10.0.0.0/x', '1.2.3.4/8/2') {
        New-Fake
        $r = Invoke-BoxHere ('203.0.113.7,' + $bad)
        Yes ("'" + $bad + "' in the list: STOP, nothing changed") ($r.Code -eq 1 -and (Has $r.Lines ("^STOP '" + [regex]::Escape($bad) + "' is not an address")) -and (Untouched))
    }
    New-Fake
    $r = Invoke-BoxHere '203.0.113.7,Any'
    Yes 'Any inside a list: STOP, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP Any goes alone') -and (Untouched))
    New-Fake
    $r = Invoke-BoxHere ' '
    Yes 'an empty list: STOP, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP the list of addresses is empty') -and (Untouched))

    # None (#2891): 127.0.0.1 alone, the bridge, and only from a session that
    # came through it.
    New-Fake
    $r = Invoke-BoxHere 'None'
    Yes 'None from a session that did not come through the bridge: STOP naming it, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP this session comes from 203\.0\.113\.7, not through the bridge') -and (Untouched))
    New-Fake
    $global:Fake.caller = '127.0.0.1'
    $r = Invoke-BoxHere 'None'
    Yes 'None through the bridge: both rules take 127.0.0.1 alone, with the save and put back' ($r.Code -eq 0 -and (RemoteOf 'OpenSSH-Server-In-TCP') -eq '127.0.0.1' -and (RemoteOf 'sshd-22-extra') -eq '127.0.0.1' -and
        $global:Fake.log[0] -eq 'New-PrivateFile' -and $global:Fake.log[1] -eq 'Register-Rollback' -and (Has $r.Lines '^KEPT this session comes from 127\.0\.0\.1'))
    Yes '  and the other ports are not touched' ((RemoteOf 'Thornswood-Site') -eq 'Any' -and (RemoteOf 'Thornswood-Game') -eq 'Any')
    New-Fake
    $global:Fake.caller = '127.0.0.1'
    $r = Invoke-BoxHere '127.0.0.1,None'
    Yes 'None inside a list: STOP, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP None goes alone') -and (Untouched))

    New-Fake
    $global:Fake.rules += @{ Name = 'all-tcp'; DisplayName = 'every TCP port'; Action = 'Allow'; Protocol = 'TCP'; Ports = @('Any'); Program = 'Any'; Remote = @('Any'); Enabled = $true }
    $r = Invoke-BoxHere '203.0.113.7'
    Yes 'a rule for every port from anywhere: STOP naming it, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines "^STOP these rules allow every port from anywhere.*'every TCP port'") -and (Untouched))

    New-Fake
    $global:Fake.rules += @{ Name = 'sshd-any'; DisplayName = 'sshd, every port'; Action = 'Allow'; Protocol = 'Any'; Ports = @('Any'); Program = 'C:\Windows\System32\OpenSSH\sshd.exe'; Remote = @('Any'); Enabled = $true }
    $r = Invoke-BoxHere '203.0.113.7'
    Yes 'a rule for sshd.exe on every port: STOP as well' ($r.Code -eq 1 -and (Has $r.Lines "'sshd, every port'") -and (Untouched))

    # The per-user app container rules Windows makes (Start, Windows Search,
    # Windows Security, "Your account"): every port from anywhere, but only for
    # that app, so they never let sshd in (#2182, measured on the box 19 Oct).
    New-Fake
    $global:Fake.rules += @{ Name = 'app-start'; DisplayName = 'Start'; Action = 'Allow'; Protocol = 'Any'; Ports = @('Any'); Program = 'Any'; Package = 'S-1-15-2-515815643-2845804217-1874292103-218650560-777617685-4287762684-137415000'; Remote = @('Any'); Enabled = $true }
    $r = Invoke-BoxHere '203.0.113.7'
    Yes 'an app container rule for every port does not stop it' ($r.Code -eq 0 -and -not (Has $r.Lines "'Start'") -and (RemoteOf 'OpenSSH-Server-In-TCP') -eq '203.0.113.7')

    New-Fake
    $global:Fake.rules += @{ Name = 'svc-other'; DisplayName = 'one service, every port'; Action = 'Allow'; Protocol = 'TCP'; Ports = @('Any'); Program = 'Any'; Service = 'Spooler'; Remote = @('Any'); Enabled = $true }
    $r = Invoke-BoxHere '203.0.113.7'
    Yes 'a rule bound to another service does not stop it' ($r.Code -eq 0 -and (RemoteOf 'OpenSSH-Server-In-TCP') -eq '203.0.113.7')

    New-Fake
    $global:Fake.rules += @{ Name = 'svc-sshd'; DisplayName = 'the sshd service, every port'; Action = 'Allow'; Protocol = 'TCP'; Ports = @('Any'); Program = 'Any'; Service = 'sshd'; Remote = @('Any'); Enabled = $true }
    $r = Invoke-BoxHere '203.0.113.7'
    Yes 'a rule bound to the sshd service on every port: STOP' ($r.Code -eq 1 -and (Has $r.Lines "'the sshd service, every port'") -and (Untouched))

    New-Fake
    $global:Fake.rules += @{ Name = 'all-tcp-scoped'; DisplayName = 'every port, one address'; Action = 'Allow'; Protocol = 'TCP'; Ports = @('Any'); Program = 'Any'; Remote = @('192.0.2.1'); Enabled = $true }
    $r = Invoke-BoxHere '203.0.113.7'
    Yes 'a rule for every port from one address only does not stop it' ($r.Code -eq 0 -and (RemoteOf 'OpenSSH-Server-In-TCP') -eq '203.0.113.7')

    New-Fake
    $global:Fake.rules += @{ Name = 'ssh-and-web'; DisplayName = 'ssh and web together'; Action = 'Allow'; Protocol = 'TCP'; Ports = @('22', '80'); Program = 'Any'; Remote = @('Any'); Enabled = $true }
    $r = Invoke-BoxHere '203.0.113.7'
    Yes 'a rule for 22 shared with other ports: STOP naming it, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines "^STOP these rules allow port 22 together with other ports: 'ssh and web together' \(22,80\)") -and (Untouched))

    New-Fake
    $global:Fake.rules = @($global:Fake.rules | Where-Object { $_.Name -notin 'OpenSSH-Server-In-TCP', 'sshd-22-extra' })
    $r = Invoke-BoxHere '203.0.113.7'
    Yes 'no enabled rule for 22: STOP, nothing changed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP no enabled firewall rule allows port 22') -and $global:Fake.log.Count -eq 0)

    # ---- ranges and IPv6 by their bits ---------------------------------------------------------
    $cases = @(
        @('203.0.113.7', '203.0.113.0/24', 0), @('203.0.113.7', '203.0.112.0/23', 0), @('203.0.113.7', '203.0.114.0/24', 1),
        @('203.0.113.7', '0.0.0.0/0', 0), @('203.0.113.7', '203.0.113.6/31', 0), @('203.0.113.7', '203.0.113.8/31', 1),
        @('2001:db8::5', '2001:db8::/32', 0), @('2001:db8::5', '2001:db9::/32', 1), @('::ffff:203.0.113.7', '203.0.113.7', 0), @('203.0.113.7', '2001:db8::/32', 1)
    )
    foreach ($c in $cases) {
        New-Fake
        $global:Fake.caller = $c[0]
        $r = Invoke-BoxHere $c[1] -Dry
        Yes ('caller ' + $c[0] + ' against ' + $c[1] + ': ' + $(if ($c[2] -eq 0) { 'inside' } else { 'outside, refused' })) ($r.Code -eq $c[2])
    }

    # ============================================================= the machine ===
    $vpsJson = Get-Content -LiteralPath (Join-Path $repo 'scripts\vps\vps.json') -Raw | ConvertFrom-Json
    $pin = [string]@($vpsJson.hostKeys)[0]
    $kh = Join-Path $tmp 'known_hosts'
    [IO.File]::WriteAllText($kh, "stand-in`n", $utf8)
    $far = Join-Path $tmp 'far'
    New-Item -ItemType Directory -Path $far -Force | Out-Null

    . (Join-Path $repo 'scripts\vps\Send-Script.ps1')
    $global:H = @{ KeyWorks = $true; KeyAfter = $true; Changed = $false; HostFp = $pin; Calls = (New-Object System.Collections.Generic.List[string]); Far = $far; Layer = $Layer; Cancelled = $false; Sent = ''
                   Box = $Box; BoxText = [IO.File]::ReadAllText($Box); RunnerPath = ${function:Get-ThornswoodRemoteRunnerPath} }
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
        $global:H.Sent = Join-Path $global:H.Far $leaf
        $global:LASTEXITCODE = 0
    }
    function global:ssh {
        $WhatIfPreference = $false
        $a = @($args | ForEach-Object { [string]$_ })
        # ssh -G, what ssh makes of its config: whether it goes through the bridge.
        if ($a -contains '-G') { 'hostname 127.0.0.1'; if ($global:H.Bridge) { 'proxycommand "node" "C:\Users\x\.ssh\thornswood-bridge\connect.js"' }; $global:LASTEXITCODE = 0; return }
        $in = @($input | ForEach-Object { [string]$_ })
        $last = $a[-1]
        # The script as the box would run it: inline, or Send-Script.ps1's
        # runner on the line, which takes the copy scp put in the far folder
        # off it and runs that (#3059).
        $s = ''
        if ($last -match 'EncodedCommand (\S+)') {
            $s = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))
            $rp = & $global:H.RunnerPath $s
            if ($rp) { $rf = Join-Path $global:H.Far ($rp -split '\\')[-1]; $s = [IO.File]::ReadAllText($rf); Remove-Item -LiteralPath $rf -Force }
        }
        # vps-ssh-scope.ps1 whole, as a block with its arguments after it: the
        # file under test runs here with them, against the stand-in layer.
        $at = $s.IndexOf($global:H.BoxText)
        if ($at -ge 0) {
            $given = $s.Substring($at + $global:H.BoxText.Length).Trim().TrimStart('}').Trim()
            $m = [regex]::Match($given, "^-From '((?:[^']|'')*)'( -DryRun)?$")
            if (-not $m.Success) { $global:H.Calls.Add('ssh UNREAD ' + $given); $global:LASTEXITCODE = 1; return }
            $from = $m.Groups[1].Value.Replace("''", "'")
            $dry = $m.Groups[2].Success
            $global:H.Calls.Add('ssh ' + (($a | Select-Object -SkipLast 1) -join ' ') + ' BOX -From "' + $from + '"' + $(if ($dry) { ' -DryRun' } else { '' }))
            $out = @(& $global:H.Box -Layer $global:H.Layer -From $from -DryRun:$dry 2>&1 | ForEach-Object { [string]$_ })
            $code = $LASTEXITCODE
            if (-not $dry -and $global:Fake.log.Count) { $global:H.Changed = $true }
            $out
            $global:LASTEXITCODE = $code; return
        }
        $global:H.Calls.Add('ssh ' + ($a -join ' '))
        if ($last -eq 'echo THORNSWOOD_KEY_OK') {
            $ok = if ($global:H.Changed) { $global:H.KeyAfter } else { $global:H.KeyWorks }
            if ($ok) { 'THORNSWOOD_KEY_OK'; $global:LASTEXITCODE = 0 } else { 'Administrator@127.0.0.1: Permission denied (publickey).'; $global:LASTEXITCODE = 255 }
            return
        }
        if ($s) {
            if ($s -match 'Unregister-ScheduledTask -TaskName ''Thornswood ssh scope rollback''') { $global:H.Cancelled = $true; 'ROLLBACK_CANCELLED' }
            elseif ($s -match 'Get-NetFirewallAddressFilter') { foreach ($r in $global:Fake.rules) { if ($r.Enabled -and $r.Action -eq 'Allow' -and $r.Ports -contains '22') { 'rule      ' + $r.DisplayName + ': from ' + ($r.Remote -join ', ') } } }
            $global:LASTEXITCODE = 0; return
        }
        $global:LASTEXITCODE = 1
    }

    function Invoke-Driver([hashtable]$extra) {
        $a = @{ Vps = '127.0.0.1'; User = 'Administrator'; KnownHosts = $kh; From = @('203.0.113.7', '198.51.100.0/24'); SettleSeconds = 0; NoPause = $true }
        foreach ($k in $extra.Keys) { $a[$k] = $extra[$k] }
        $global:LASTEXITCODE = 0
        $out = @(& $Driver @a 6>&1 2>&1 | ForEach-Object { [string]$_ })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out; Text = ($out -join "`n") }
    }
    function Fresh { New-Fake; $global:H.Calls.Clear(); $global:H.Cancelled = $false; $global:H.Sent = ''; $global:H.Changed = $false; $global:H.KeyWorks = $true; $global:H.KeyAfter = $true; $global:H.HostFp = $pin; $global:H.Bridge = $false }

    Fresh
    $global:H.HostFp = 'SHA256:' + ('A' * 43)
    $r = Invoke-Driver @{}
    Yes 'known_hosts without the pinned key: refused, exit 1, before any ssh' ($r.Code -eq 1 -and $r.Text -match 'does not hold the key' -and $global:H.Calls.Count -eq 0)

    Fresh
    $global:H.KeyWorks = $false
    $r = Invoke-Driver @{}
    Yes 'key login not proven: refused, exit 1, after only the key probe' ($r.Code -eq 1 -and $r.Text -match 'Key login as Administrator is not proven' -and $global:H.Calls.Count -eq 1 -and (Untouched))
    Yes '  the probe allowed publickey only, with the host key checked' ($global:H.Calls[0] -match 'PreferredAuthentications=publickey' -and $global:H.Calls[0] -match 'StrictHostKeyChecking=yes' -and $global:H.Calls[0] -match 'BatchMode=yes')

    Fresh
    $r = Invoke-Driver @{ WhatIf = $true }
    Yes '-WhatIf: exit 0, the box ran read only, nothing changed' ($r.Code -eq 0 -and $r.Text -match 'Nothing was changed\. Run it again without -WhatIf' -and
        @($global:H.Calls | Where-Object { $_ -match '-From "203\.0\.113\.7,198\.51\.100\.0/24" -DryRun$' }).Count -eq 1 -and (Untouched))
    Yes '  vps-ssh-scope.ps1 went whole by scp to a copy its run took off the box, so nothing of it is left there (#3035, #3059)' (
        $global:H.Sent -match 'thornswood-remote-[0-9a-f]{32}\.ps1$' -and @(Get-ChildItem -LiteralPath $global:H.Far -File).Count -eq 0 -and
        @($global:H.Calls | Where-Object { $_ -like 'scp *' }).Count -ge 1 -and @($global:H.Calls | Where-Object { $_ -match '-File |UNREAD' }).Count -eq 0)

    Fresh
    $r = Invoke-Driver @{}
    Yes 'real run: exit 0, the rules take the list' ($r.Code -eq 0 -and (RemoteOf 'OpenSSH-Server-In-TCP') -eq '203.0.113.7,198.51.100.0/24')
    $seq = ($global:H.Calls | ForEach-Object { $_ }) -join "`n"
    Yes '  a new key login after the change, before the put back is cancelled' ($global:H.Cancelled -and $seq -match '(?s)-From "[^"]*"\n[^\n]*echo THORNSWOOD_KEY_OK\n[^\n]*EncodedCommand')
    Yes '  and it reads the rules back' ($r.Text -match "rule      OpenSSH SSH Server \(sshd\): from 203\.0\.113\.7, 198\.51\.100\.0/24")
    Yes '  every ssh and scp checked the host key' (@($global:H.Calls | Where-Object { $_ -notmatch 'StrictHostKeyChecking=yes' }).Count -eq 0)

    Fresh
    $global:H.KeyAfter = $false
    $r = Invoke-Driver @{}
    Yes 'a new login that fails: exit 1, the put back left armed, and it says the box reopens itself' ($r.Code -eq 1 -and -not $global:H.Cancelled -and $global:Fake.rollback -and $r.Text -match 'puts the old rules back by itself within ten minutes')

    Fresh
    $r = Invoke-Driver @{ From = @('None') }
    Yes '-From None from a machine whose ssh does not go through the bridge: refused, exit 1, before any login' ($r.Code -eq 1 -and $r.Text -match 'does not go through the bridge' -and $global:H.Calls.Count -eq 0 -and (Untouched))

    Fresh
    $global:H.Bridge = $true
    $global:Fake.caller = '127.0.0.1'
    $r = Invoke-Driver @{ From = @('None'); WhatIf = $true }
    Yes '-From None -WhatIf through the bridge: exit 0, the box asked read only with None, nothing changed' ($r.Code -eq 0 -and
        @($global:H.Calls | Where-Object { $_ -match '-From "None" -DryRun$' }).Count -eq 1 -and (Untouched))

    Fresh
    $r = Invoke-Driver @{ From = @('198.51.100.0/24') }
    Yes 'the box refusing a list without this machine: exit 1, no put back to cancel' ($r.Code -eq 1 -and $r.Text -match 'The box stopped' -and -not $global:H.Cancelled -and (Untouched))
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
