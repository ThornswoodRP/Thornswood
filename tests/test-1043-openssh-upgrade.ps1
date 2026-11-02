<#
  test-1043-openssh-upgrade.ps1

      pwsh -NoProfile -File .\tests\test-1043-openssh-upgrade.ps1

  scripts\vps\Upgrade-OpenSsh.ps1 and scripts\vps\vps-openssh.ps1 replace
  the box's inbox OpenSSH for Windows 9.5, which Microsoft built with no
  post-quantum key exchange, with Microsoft's 10.4 MSI, and keep it only once
  a new login with the pinned host key negotiates a post-quantum one.

  WHY. Issue #1043. The swap stops the only way into the box that is not the
  provider's console, so what it refuses, what it keeps and the put back
  matter more than the install: a swap that went ahead with the wrong
  download, lost the host keys, opened port 22 wider, or left nothing to put
  the old sshd back would lock everybody out or let a box answer that is not
  ours.

  HOW. NEVER CONNECTS. Two halves, the shape tests\test-harden-vps.ps1 has.

  The box half runs vps-openssh.ps1 here with -Layer: a stand-in for every
  function in it that touches Windows (services, capabilities, the MSI, the
  download, the firewall, the work folder, scheduled tasks, sshd -T) keeping
  its state in a table. The box's host keys are its real public keys, the
  ones scripts\vps\vps.json pins. It checks: no pins, or host keys that are
  not the pinned ones, stop before anything is downloaded; a dry run checks
  the download and keeps nothing; a download with the wrong SHA256 or no
  Microsoft signature is refused and removed; an sshd that already offers a
  post-quantum key exchange is left alone; a real plan writes the state and
  the program the tasks run and arms the put back before the swap; a second
  plan while armed is refused. The swap removes both capabilities, frees a
  service name the removal left, installs, keeps every port 22 rule the box
  had and removes the one the install made, puts ssh-agent back to Disabled
  and stopped, and starts sshd; a swap whose new sshd reads other host keys,
  or whose install fails, starts the put back at once. The put back
  uninstalls, adds the capabilities back and puts the port 22 rules'
  addresses back even when the capability makes its rule anew. Finish keeps
  the put back unless the swap said it worked. And the program the tasks run
  is run itself, as a file, for the swap.

  The machine half runs Upgrade-OpenSsh.ps1 with ssh, scp and ssh-keygen as
  stand-ins. ssh runs the box script it is sent against the same stand-in
  layer, and plays the swap task when a login comes while it is armed. It
  checks: no pinned key in known_hosts stops before any ssh; -WhatIf runs
  the plan read only with vps.json's pins; a real run waits for the swap,
  reads its report, proves a new login negotiates a post-quantum key exchange
  with 10.4, and only then finishes; a login that is not post-quantum, or a
  swap that failed, never finishes, so the put back stays armed.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$Box = Join-Path $repo 'scripts\vps\vps-openssh.ps1'
$Driver = Join-Path $repo 'scripts\vps\Upgrade-OpenSsh.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Has($lines, [string]$re) { return (@($lines | Where-Object { $_ -match $re }).Count -gt 0) }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-1043-' + [Guid]::NewGuid().ToString('N'))
# The box's folders, which only Windows sets, as the box has them; put back
# at the end.
$envWas = @{}
foreach ($kv in @(@('ProgramData', 'C:\ProgramData'), @('ProgramFiles', 'C:\Program Files'), @('WINDIR', 'C:\Windows'))) {
    $envWas[$kv[0]] = [Environment]::GetEnvironmentVariable($kv[0])
    [Environment]::SetEnvironmentVariable($kv[0], $kv[1])
}
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)

# The box's public host keys, as it showed them on 26 Oct 2026; their
# fingerprints are the three scripts\vps\vps.json pins.
$BoxKeys = @{
    rsa = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDFSSQuZObEHqBJPijbjMuau0+gRN+lDHbC0Xx1R/AXiaXpytAXglQVyelewZIFIVgvOStoGB2LrSythI4OjlHk09daWgp26qPLKSg6uGTwg9iMgGN+qeuZ62wRsJe0mouuTQtFXHt+pRrji3o43yaW8CaeZw0t/fsXT9MA1MG/N6rg0jAKFWWmJE0db8g50yn6Y6LMIMqHIJa5sxPjZf/NIxaE/5Br06mi1ydSPx7lcoj8fEvBFETQf2UrErWtLT6nEcN6PrVR+/1IPYVP4qDZN4+Ml+3BFV3wfcMmqYhhqUT3bXbbx0mDEyX+98P85l0gAXVPYvaSvIE/tBecRc+cXZdkxIB5m4fiswOHUa9lY+buopv+odyxr9bWhbmIIhCIOomitR7wAzjMHVlYQFFgqboGg4nFi7yQKAkZuuK6FG2rj7GMo8WR6G2qT44fnLk0STEJ4G0VOKXsTtTd3LtLwQ1qtJlNC4/8MFRr8lJWdYCJ+r+5voQXlMt2tj/Qkfc='
    ecdsa = 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBOs1pXyH5lY6aDzg7oSiMACVCvOyc3MXpFHrm/IjyiwWWUmtBajvpe4Du2vP+qWv7J5fPOj3CweEtXm0JFb7/Go='
    ed25519 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHJxhc2eAJzyWiuCC9J3ffkTeHm7ATe2nvrwJzGLxGuh'
}
$OtherKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
$vpsJson = Get-Content -LiteralPath (Join-Path $repo 'scripts\vps\vps.json') -Raw | ConvertFrom-Json
$Pinned = @($vpsJson.hostKeys | ForEach-Object { [string]$_ })
$PinArg = $Pinned -join ','
$Inbox = '\System32\OpenSSH\'

$layerText = @'
function Get-OpenSshService([string]$Name) {
    $s = $global:Fake.svcs[$Name]
    if (-not $s) { return $null }
    return [pscustomobject]@{ Path = $s.Path; State = $s.State; StartMode = $s.StartMode }
}
function Stop-OpenSshService([string]$Name) { $global:Fake.svcs[$Name].State = 'Stopped'; $global:Fake.log.Add('stop ' + $Name) }
function Start-OpenSshService([string]$Name) {
    if (-not $global:Fake.svcs[$Name]) { throw ('no service ' + $Name) }
    $global:Fake.svcs[$Name].State = 'Running'; $global:Fake.log.Add('start ' + $Name)
}
function Set-OpenSshStartMode([string]$Name, [string]$Mode) { $global:Fake.svcs[$Name].StartMode = $Mode; $global:Fake.log.Add('mode ' + $Name + ' ' + $Mode) }
function Remove-ServiceEntry([string]$Name) { $global:Fake.svcs.Remove($Name); $global:Fake.log.Add('sc delete ' + $Name) }
function Stop-InboxSshd { $global:Fake.log.Add('stop inbox sessions') }
function Test-NewSshd { return [bool]$global:Fake.msi }
function Get-ExeVersion([string]$Path) {
    if ($Path -like '*\System32\OpenSSH\*') { return '9.5.5.3' }
    if ($global:Fake.msi) { return $global:Fake.newVersion }
    return ''
}
function Read-SshdSettings([string]$Exe) {
    $new = $Exe -notlike '*\System32\OpenSSH\*'
    if ($new -and $global:Fake.newPq) { 'kexalgorithms mlkem768x25519-sha256,sntrup761x25519-sha512,sntrup761x25519-sha512@openssh.com,curve25519-sha256' }
    elseif (-not $new -and $global:Fake.inboxPq) { 'kexalgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256' }
    else { 'kexalgorithms curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp256' }
    'hostkey __PROGRAMDATA__\ssh/ssh_host_rsa_key'
    'hostkey __PROGRAMDATA__\ssh/ssh_host_ecdsa_key'
    'hostkey __PROGRAMDATA__\ssh/ssh_host_ed25519_key'
}
function Test-SshdConfig([string]$Exe) { return [pscustomobject]@{ Ok = [bool]$global:Fake.sshdOk; Said = 'line 3: Bad configuration option' } }
function Read-TextFile([string]$Path) {
    if ($Path -match 'ssh_host_(\w+)_key\.pub$') { return $global:Fake.pubs[$Matches[1]] }
    return $null
}
function Get-CapabilityState([string]$Name) { return $global:Fake.caps[$Name] }
function Remove-Capability([string]$Name) {
    $global:Fake.caps[$Name] = 'NotPresent'; $global:Fake.log.Add('remove ' + $Name)
    $svc = $(if ($Name -like 'OpenSSH.Server*') { 'sshd' } else { 'ssh-agent' })
    if (-not $global:Fake.leaveService) { $global:Fake.svcs.Remove($svc) }
    if ($Name -like 'OpenSSH.Server*') { $global:Fake.rules = @($global:Fake.rules | Where-Object { $_.Name -ne 'OpenSSH-Server-In-TCP' }) }
    return [bool]$global:Fake.leaveService
}
function Add-Capability([string]$Name) {
    $global:Fake.caps[$Name] = 'Installed'; $global:Fake.log.Add('add ' + $Name)
    if ($Name -like 'OpenSSH.Server*') {
        $global:Fake.svcs['sshd'] = @{ Path = 'C:\Windows\System32\OpenSSH\sshd.exe'; State = 'Stopped'; StartMode = 'Manual' }
        # The capability makes its own rule anew, open to every address.
        if (-not @($global:Fake.rules | Where-Object { $_.Name -eq 'OpenSSH-Server-In-TCP' }).Count) {
            $global:Fake.rules = @($global:Fake.rules) + @(@{ Name = 'OpenSSH-Server-In-TCP'; DisplayName = 'OpenSSH SSH Server (sshd)'; Remote = @('Any') })
        }
    } else { $global:Fake.svcs['ssh-agent'] = @{ Path = 'C:\Windows\System32\OpenSSH\ssh-agent.exe'; State = 'Stopped'; StartMode = 'Manual' } }
    return $false
}
function Save-Download([string]$From, [string]$To) { $global:Fake.files[$To] = $From; $global:Fake.log.Add('download ' + $To) }
function Get-Sha256([string]$Path) { if ($global:Fake.shaGood) { return $Release.Sha256 }; return ('0' * 64) }
function Get-Signer([string]$Path) {
    if ($global:Fake.signed) { return [pscustomobject]@{ Status = 'Valid'; Subject = 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US' } }
    return [pscustomobject]@{ Status = 'NotSigned'; Subject = '' }
}
function New-TempPath { return 'TEMP\thornswood-openssh-x.msi' }
function Remove-FilePath([string]$Path) { $global:Fake.files.Remove($Path); $global:Fake.log.Add('rm ' + $Path) }
function Invoke-Msi([string[]]$Arguments) {
    $global:Fake.log.Add('msiexec ' + ($Arguments -join ' '))
    if ($Arguments[0] -eq '/i') {
        if ($global:Fake.svcs['sshd'] -or $global:Fake.svcs['ssh-agent']) { return 1603 }
        if ($global:Fake.msiCode -ne 0 -and $global:Fake.msiCode -ne 3010) { return $global:Fake.msiCode }
        $global:Fake.msi = $true
        $global:Fake.svcs['sshd'] = @{ Path = 'C:\Program Files\OpenSSH\sshd.exe'; State = 'Running'; StartMode = 'Auto' }
        $global:Fake.svcs['ssh-agent'] = @{ Path = 'C:\Program Files\OpenSSH\ssh-agent.exe'; State = 'Running'; StartMode = 'Auto' }
        $global:Fake.rules = @($global:Fake.rules) + @(@{ Name = '{msi-rule}'; DisplayName = 'OpenSSH SSH Server Preview (sshd)'; Remote = @('Any') })
        if ($global:Fake.keysChange) { $global:Fake.pubs.ed25519 = $global:Fake.other }
        return $global:Fake.msiCode
    }
    $global:Fake.msi = $false
    foreach ($n in 'sshd', 'ssh-agent') { if ($global:Fake.svcs[$n] -and $global:Fake.svcs[$n].Path -like '*Program Files*') { $global:Fake.svcs.Remove($n) } }
    $global:Fake.rules = @($global:Fake.rules | Where-Object { $_.Name -ne '{msi-rule}' })
    return 0
}
function Get-Port22Rules {
    # On the box the first Get-NetFirewallRule loads NetSecurity, whose commands
    # are functions of a CDXML module, after the script listed the built in ones.
    if (-not (Get-Module ThornswoodFakeCdxml)) { New-Module -Name ThornswoodFakeCdxml -ScriptBlock ([scriptblock]::Create('function Get-FakeCdxmlRule { }')) | Import-Module -Global }
    foreach ($r in $global:Fake.rules) { [pscustomobject]@{ Name = $r.Name; DisplayName = $r.DisplayName; Remote = @($r.Remote) } }
}
function Test-Rule([string]$Name) { return (@($global:Fake.rules | Where-Object { $_.Name -eq $Name }).Count -gt 0) }
function Set-RuleRemote([string]$Name, [string[]]$Remote) {
    foreach ($r in $global:Fake.rules) { if ($r.Name -eq $Name) { $r.Remote = @($Remote) } }
    $global:Fake.log.Add('scope ' + $Name + ' ' + ($Remote -join ','))
}
function Remove-Rule([string]$Name) { $global:Fake.rules = @($global:Fake.rules | Where-Object { $_.Name -ne $Name }); $global:Fake.log.Add('rule rm ' + $Name) }
function New-WorkFolder { $global:Fake.workMade = $true; $global:Fake.log.Add('work folder') }
function Write-WorkFile([string]$Name, [string]$Text) { $global:Fake.work[$Name] = $Text }
function Add-WorkLog([string]$Name, [string]$Line) { $global:Fake.work[$Name] = [string]$global:Fake.work[$Name] + $Line + "`r`n" }
function Read-WorkFile([string]$Name) { if ($global:Fake.work.ContainsKey($Name)) { return $global:Fake.work[$Name] }; return $null }
function Remove-WorkFolder { $global:Fake.work.Clear(); $global:Fake.workMade = $false; $global:Fake.log.Add('work folder rm') }
function Register-OneShot([string]$Task, [string]$PhaseName, [datetime]$At, [int]$Minutes) {
    $global:Fake.tasks[$Task] = @{ Phase = $PhaseName; At = $At; Started = $false }
    $global:Fake.log.Add('arm ' + $Task)
}
function Test-Task([string]$Task) { return $global:Fake.tasks.ContainsKey($Task) }
function Start-Task([string]$Task) { if ($global:Fake.tasks[$Task]) { $global:Fake.tasks[$Task].Started = $true }; $global:Fake.log.Add('start task ' + $Task) }
function Stop-Task([string]$Task) { $global:Fake.log.Add('stop task ' + $Task) }
function Remove-Task([string]$Task) { $global:Fake.tasks.Remove($Task); $global:Fake.log.Add('unarm ' + $Task) }
'@
$Layer = Join-Path $tmp 'layer.ps1'
[IO.File]::WriteAllText($Layer, $layerText, $utf8)

function New-Fake {
    $global:Fake = @{
        svcs = @{
            sshd = @{ Path = 'C:\Windows\System32\OpenSSH\sshd.exe'; State = 'Running'; StartMode = 'Auto' }
            'ssh-agent' = @{ Path = 'C:\Windows\System32\OpenSSH\ssh-agent.exe'; State = 'Stopped'; StartMode = 'Disabled' }
        }
        caps = @{ 'OpenSSH.Server~~~~0.0.1.0' = 'Installed'; 'OpenSSH.Client~~~~0.0.1.0' = 'Installed' }
        # As the box had them on 26 Oct 2026: both rules on 22 take 127.0.0.1 alone (#2891).
        rules = @(
            @{ Name = 'OpenSSH-Server-In-TCP'; DisplayName = 'OpenSSH SSH Server (sshd)'; Remote = @('127.0.0.1') },
            @{ Name = '{bb0785cb-2204-4cbe-908c-80935f4d554f}'; DisplayName = 'OpenSSH TCP 22'; Remote = @('127.0.0.1') }
        )
        pubs = @{ rsa = $BoxKeys.rsa; ecdsa = $BoxKeys.ecdsa; ed25519 = $BoxKeys.ed25519 }
        other = $OtherKey
        inboxPq = $false; newPq = $true; newVersion = '10.4.0.0'; sshdOk = $true
        shaGood = $true; signed = $true; msi = $false; msiCode = 0; leaveService = $false; keysChange = $false
        files = @{}; work = @{}; workMade = $false; tasks = @{}
        log = New-Object System.Collections.Generic.List[string]
    }
}
function Rule([string]$name) { return @($global:Fake.rules | Where-Object { $_.Name -eq $name })[0] }

function Invoke-BoxHere([hashtable]$a) {
    $a.Layer = $Layer
    $global:LASTEXITCODE = 0
    $out = @(& $Box @a 2>&1 | ForEach-Object { [string]$_ })
    return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out }
}

try {
    # =================================================================== the file ===
    $boxText = [IO.File]::ReadAllText($Box)
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($boxText, [ref]$null, [ref]$errs)
    Yes 'vps-openssh.ps1 parses' (-not $errs -or $errs.Count -eq 0)
    Yes '  and is plain ASCII' (-not ($boxText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))
    $drvText = [IO.File]::ReadAllText($Driver)
    Yes 'Upgrade-OpenSsh.ps1 parses and is plain ASCII' ([System.Management.Automation.Language.Parser]::ParseInput($drvText, [ref]$null, [ref]$errs) -and (-not $errs -or $errs.Count -eq 0) -and -not ($drvText.ToCharArray() | Where-Object { [int]$_ -gt 127 }))

    $fakeAst = [System.Management.Automation.Language.Parser]::ParseInput($layerText, [ref]$null, [ref]$null)
    $layerNames = @($fakeAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
    $defined = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
    Yes 'every stand-in replaces a function the box script defines' (@($layerNames | Where-Object { $defined -notcontains $_ }).Count -eq 0)
    $touchers = 'Get-CimInstance', 'Stop-Service', 'Start-Service', 'Set-Service', 'Restart-Service', 'sc.exe', 'Get-Process', 'Stop-Process',
                'Get-WindowsCapability', 'Remove-WindowsCapability', 'Add-WindowsCapability', 'Invoke-WebRequest', 'Get-FileHash', 'Get-AuthenticodeSignature',
                'Start-Process', 'Get-NetFirewallRule', 'Get-NetFirewallPortFilter', 'Get-NetFirewallAddressFilter', 'Set-NetFirewallRule', 'Remove-NetFirewallRule',
                'New-Item', 'Remove-Item', 'Set-Acl', 'Get-Acl', 'Get-Item', 'Test-Path', 'Register-ScheduledTask', 'Start-ScheduledTask', 'Stop-ScheduledTask',
                'Unregister-ScheduledTask', 'Get-ScheduledTask', 'New-ScheduledTaskAction', 'Restart-Computer'
    $loose = @()
    foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $name = $c.GetCommandName()
        if (-not $name -or $touchers -notcontains $name) { continue }
        $p = $c.Parent
        while ($p -and -not ($p -is [System.Management.Automation.Language.FunctionDefinitionAst])) { $p = $p.Parent }
        if ($p -and $p.Name -eq 'Get-ThornswoodBoxRefusal') { continue }
        if (-not $p -or $layerNames -notcontains $p.Name) { $loose += ('{0} at line {1}' -f $name, $c.Extent.StartLineNumber) }
    }
    Yes ('every command in it that touches Windows is inside a function the stand-in replaces' + $(if ($loose.Count) { ': ' + ($loose -join ', ') } else { '' })) ($loose.Count -eq 0)
    $sha = [regex]::Match($boxText, "Sha256 = '([0-9A-F]{64})'").Groups[1].Value
    Yes 'the MSI is pinned by a SHA256 and a Microsoft signer, from Microsoft''s own release' ($sha.Length -eq 64 -and $boxText -match "Signer = 'O=Microsoft Corporation'" -and $boxText -match "'https://github\.com/PowerShell/Win32-OpenSSH/releases/download/'")
    Yes 'Upgrade-OpenSsh.ps1 checks the host key on every ssh (StrictHostKeyChecking=yes) and passes vps.json''s pins' ($drvText -match "StrictHostKeyChecking=yes" -and $drvText -match 'Get-ThornswoodVpsHostKeys' -and $drvText -notmatch 'StrictHostKeyChecking=(no|accept-new)')

    # ======================================================================= plan ===
    New-Fake
    $r = Invoke-BoxHere @{ DryRun = $true }
    Yes 'no pins: STOP, exit 1, and nothing downloaded or armed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP no host key pins') -and $global:Fake.log.Count -eq 0)

    New-Fake
    $global:Fake.pubs.ed25519 = $OtherKey
    $r = Invoke-BoxHere @{ DryRun = $true; Pins = $PinArg }
    Yes 'host keys that are not the pinned ones: STOP before anything is downloaded' ($r.Code -eq 1 -and (Has $r.Lines '^STOP sshd''s host keys are not the pinned ones') -and $global:Fake.log.Count -eq 0)

    New-Fake
    $r = Invoke-BoxHere @{ DryRun = $true; Pins = $PinArg }
    Yes 'dry run: exit 0, two WOULD lines and DONE' ($r.Code -eq 0 -and @($r.Lines | Where-Object { $_ -match '^WOULD ' }).Count -eq 2 -and (Has $r.Lines '^DONE 2 change\(s\) would be made'))
    Yes '  it read the real host keys against vps.json''s pins and said the inbox sshd offers no post-quantum key exchange' ((Has $r.Lines '^ALREADY sshd reads the 3 pinned host keys') -and (Has $r.Lines '^WARN sshd offers no post-quantum key exchange: curve25519-sha256'))
    Yes '  it checked the download in a temp file and removed it' ((Has $r.Lines '^ALREADY OpenSSH-Win64-v10\.4\.0\.0\.msi matches its pinned SHA256 and is signed') -and $global:Fake.log -contains 'download TEMP\thornswood-openssh-x.msi' -and $global:Fake.files.Count -eq 0)
    Yes '  and made no work folder, wrote nothing and armed nothing' (-not $global:Fake.workMade -and $global:Fake.work.Count -eq 0 -and $global:Fake.tasks.Count -eq 0)
    Yes '  and said the port 22 rules and ssh-agent are kept as they are' ((Has $r.Lines "^KEPT firewall rule 'OpenSSH TCP 22' on port 22, from 127\.0\.0\.1") -and (Has $r.Lines '^KEPT ssh-agent is Stopped, Disabled'))

    New-Fake
    $global:Fake.shaGood = $false
    $r = Invoke-BoxHere @{ Pins = $PinArg }
    Yes 'a download with another SHA256: STOP, removed, nothing armed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP OpenSSH-Win64-v10\.4\.0\.0\.msi from .* has SHA256 0+, not the pinned') -and $global:Fake.files.Count -eq 0 -and $global:Fake.tasks.Count -eq 0 -and -not $global:Fake.work.ContainsKey('before.json'))

    New-Fake
    $global:Fake.signed = $false
    $r = Invoke-BoxHere @{ Pins = $PinArg }
    Yes 'a download not signed by Microsoft: STOP, removed, nothing armed' ($r.Code -eq 1 -and (Has $r.Lines '^STOP .* is not signed by Microsoft') -and $global:Fake.files.Count -eq 0 -and $global:Fake.tasks.Count -eq 0)

    New-Fake
    $global:Fake.inboxPq = $true
    $r = Invoke-BoxHere @{ Pins = $PinArg }
    Yes 'an sshd that already offers a post-quantum key exchange: ALREADY, 0 changes, nothing downloaded' ($r.Code -eq 0 -and (Has $r.Lines '^ALREADY sshd offers a post-quantum key exchange: sntrup761x25519-sha512@openssh\.com') -and (Has $r.Lines '^DONE 0 change\(s\) made') -and $global:Fake.log.Count -eq 0)

    New-Fake
    Remove-Module ThornswoodFakeCdxml -ErrorAction SilentlyContinue
    $r = Invoke-BoxHere @{ Pins = $PinArg }
    Yes 'real plan: exit 0, two CHANGED lines' ($r.Code -eq 0 -and @($r.Lines | Where-Object { $_ -match '^CHANGED ' }).Count -eq 2)
    Yes '  the MSI kept in the work folder, which was made SYSTEM and Administrators only' ($global:Fake.workMade -and $global:Fake.files.ContainsKey('C:\ProgramData\Thornswood-OpenSSH\OpenSSH-Win64-v10.4.0.0.msi'))
    $state = $global:Fake.work['before.json'] | ConvertFrom-Json
    Yes '  the state as the box had it: sshd Auto, ssh-agent Stopped and Disabled, both capabilities, both port 22 rules, the pins' (
        $state.sshd.StartMode -eq 'Auto' -and $state.agent.State -eq 'Stopped' -and $state.agent.StartMode -eq 'Disabled' -and
        $state.caps.'OpenSSH.Server~~~~0.0.1.0' -eq 'Installed' -and $state.caps.'OpenSSH.Client~~~~0.0.1.0' -eq 'Installed' -and
        @($state.rules).Count -eq 2 -and @($state.rules)[1].Remote[0] -eq '127.0.0.1' -and (@($state.prints) -join ',') -eq $PinArg)
    $logText = $global:Fake.log -join "`n"
    Yes '  the put back armed before the swap, the put back 25 minutes out and the swap seconds out' (
        $logText.IndexOf('arm Thornswood OpenSSH put back') -ge 0 -and $logText.IndexOf('arm Thornswood OpenSSH put back') -lt $logText.IndexOf('arm Thornswood OpenSSH upgrade') -and
        $global:Fake.tasks['Thornswood OpenSSH put back'].At -gt (Get-Date).AddMinutes(24) -and $global:Fake.tasks['Thornswood OpenSSH upgrade'].At -lt (Get-Date).AddMinutes(1) -and
        $global:Fake.tasks['Thornswood OpenSSH upgrade'].Phase -eq 'Swap' -and $global:Fake.tasks['Thornswood OpenSSH put back'].Phase -eq 'PutBack')
    Yes '  nothing about sshd changed yet' ($global:Fake.svcs.sshd.State -eq 'Running' -and -not $global:Fake.msi -and $global:Fake.caps.'OpenSSH.Server~~~~0.0.1.0' -eq 'Installed')
    $phaseText = [string]$global:Fake.work['phase.ps1']
    $perrs = $null
    $pAst = [System.Management.Automation.Language.Parser]::ParseInput($phaseText, [ref]$null, [ref]$perrs)
    $pNames = @($pAst.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false) | ForEach-Object { $_.Name })
    $own = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false) | ForEach-Object { $_.Name })
    Yes '  the program the tasks run parses and carries every function of the script and the BoxGuard copy' ((-not $perrs -or $perrs.Count -eq 0) -and @($own | Where-Object { $pNames -notcontains $_ }).Count -eq 0 -and $pNames -contains 'Get-ThornswoodBoxRefusal')
    Yes '  and none of the harness''s own' (@($pNames | Where-Object { @('Yes', 'Has', 'New-Fake', 'Invoke-BoxHere', 'Rule') -contains $_ }).Count -eq 0)
    Yes '  and none of a module loaded while it ran, as NetSecurity and ScheduledTasks are on the box (their copies cannot run outside the module, #1043)' ((Get-Module ThornswoodFakeCdxml) -and $pNames -notcontains 'Get-FakeCdxmlRule')

    $r2 = Invoke-BoxHere @{ Pins = $PinArg }
    Yes 'a second plan while armed: STOP, nothing new armed or downloaded' ($r2.Code -eq 1 -and (Has $r2.Lines '^STOP an upgrade is already armed or was left') -and @($global:Fake.log | Where-Object { $_ -like 'download*' }).Count -eq 1)

    # ======================================================================= swap ===
    $armed = $global:Fake.work.Clone(); $armedFiles = $global:Fake.files.Clone()
    function Armed {
        New-Fake
        foreach ($k in $armed.Keys) { $global:Fake.work[$k] = $armed[$k] }
        foreach ($k in $armedFiles.Keys) { $global:Fake.files[$k] = $armedFiles[$k] }
        $global:Fake.workMade = $true
        $global:Fake.tasks['Thornswood OpenSSH upgrade'] = @{ Phase = 'Swap'; At = (Get-Date); Started = $true }
        $global:Fake.tasks['Thornswood OpenSSH put back'] = @{ Phase = 'PutBack'; At = (Get-Date).AddMinutes(25); Started = $false }
    }

    Armed
    $r = Invoke-BoxHere @{ Phase = 'Swap' }
    $res = $global:Fake.work['result.json'] | ConvertFrom-Json
    Yes 'swap: exit 0 and result.json says it worked, with 10.4 and the post-quantum key exchanges' ($r.Code -eq 0 -and $res.ok -and $res.version -eq '10.4.0.0' -and (@($res.pq) -contains 'mlkem768x25519-sha256'))
    $logText = $global:Fake.log -join "`n"
    Yes '  stopped sshd, then removed both capabilities, then installed' ($logText -match '(?s)stop sshd.*remove OpenSSH\.Server.*remove OpenSSH\.Client.*msiexec /i ')
    Yes '  sshd is the new one, Running and Auto, as it was' ($global:Fake.svcs.sshd.Path -eq 'C:\Program Files\OpenSSH\sshd.exe' -and $global:Fake.svcs.sshd.State -eq 'Running' -and $global:Fake.svcs.sshd.StartMode -eq 'Auto')
    Yes '  ssh-agent put back to Stopped and Disabled' ($global:Fake.svcs['ssh-agent'].State -eq 'Stopped' -and $global:Fake.svcs['ssh-agent'].StartMode -eq 'Disabled')
    Yes '  the rule the install made, open to any address, removed; the box''s own rule on 22 kept at 127.0.0.1' (-not (Rule '{msi-rule}') -and (Rule '{bb0785cb-2204-4cbe-908c-80935f4d554f}').Remote[0] -eq '127.0.0.1' -and @($global:Fake.rules | Where-Object { @($_.Remote) -contains 'Any' }).Count -eq 0)
    Yes '  the swap task removed, the put back left armed and not started' (-not $global:Fake.tasks.ContainsKey('Thornswood OpenSSH upgrade') -and $global:Fake.tasks.ContainsKey('Thornswood OpenSSH put back') -and -not $global:Fake.tasks['Thornswood OpenSSH put back'].Started)
    Yes '  and swap.log holds what it said' ([string]$global:Fake.work['swap.log'] -match 'CHANGED OpenSSH for Windows 10\.4\.0\.0 installed')

    Armed
    $global:Fake.leaveService = $true
    $r = Invoke-BoxHere @{ Phase = 'Swap' }
    Yes 'a capability removal that leaves its service until a restart: the name is freed, the install goes ahead, and the restart is said' ($r.Code -eq 0 -and $global:Fake.log -contains 'sc delete sshd' -and $global:Fake.log -contains 'sc delete ssh-agent' -and ($global:Fake.work['result.json'] | ConvertFrom-Json).restart -and (Has $r.Lines '^WARN Windows finishes removing the old files at its next restart'))

    Armed
    $global:Fake.keysChange = $true
    $r = Invoke-BoxHere @{ Phase = 'Swap' }
    $res = $global:Fake.work['result.json'] | ConvertFrom-Json
    Yes 'a new sshd that reads other host keys: STOP, result not ok, the put back started at once' ($r.Code -eq 1 -and -not $res.ok -and $res.step -eq 'checking the new sshd' -and $global:Fake.tasks['Thornswood OpenSSH put back'].Started -and (Has $r.Lines '^STOP the swap failed checking the new sshd: the new sshd does not read the pinned host keys'))

    Armed
    $global:Fake.msiCode = 1603
    $r = Invoke-BoxHere @{ Phase = 'Swap' }
    Yes 'an install that fails: STOP, the put back started at once' ($r.Code -eq 1 -and -not ($global:Fake.work['result.json'] | ConvertFrom-Json).ok -and $global:Fake.tasks['Thornswood OpenSSH put back'].Started)

    Armed
    $global:Fake.newPq = $false
    $r = Invoke-BoxHere @{ Phase = 'Swap' }
    Yes 'a new sshd that offers no post-quantum key exchange either: the put back started' ($r.Code -eq 1 -and $global:Fake.tasks['Thornswood OpenSSH put back'].Started)

    Armed
    $global:Fake.sshdOk = $false
    $r = Invoke-BoxHere @{ Phase = 'Swap' }
    Yes 'sshd -t refusing sshd_config: the put back started' ($r.Code -eq 1 -and $global:Fake.tasks['Thornswood OpenSSH put back'].Started -and (Has $r.Lines 'sshd -t refused sshd_config'))

    # =================================================================== put back ===
    Armed
    $global:Fake.keysChange = $true
    $null = Invoke-BoxHere @{ Phase = 'Swap' }
    $r = Invoke-BoxHere @{ Phase = 'PutBack' }
    Yes 'put back after a failed swap: exit 0, uninstalled, both capabilities back' ($r.Code -eq 0 -and -not $global:Fake.msi -and $global:Fake.caps.'OpenSSH.Server~~~~0.0.1.0' -eq 'Installed' -and $global:Fake.caps.'OpenSSH.Client~~~~0.0.1.0' -eq 'Installed')
    Yes '  the inbox sshd running and Auto again, ssh-agent Disabled' ($global:Fake.svcs.sshd.Path -like '*\System32\OpenSSH\sshd.exe' -and $global:Fake.svcs.sshd.State -eq 'Running' -and $global:Fake.svcs.sshd.StartMode -eq 'Auto' -and $global:Fake.svcs['ssh-agent'].StartMode -eq 'Disabled')
    Yes '  the rule the capability made anew, open to any address, put back to 127.0.0.1' ((Rule 'OpenSSH-Server-In-TCP').Remote[0] -eq '127.0.0.1' -and @($global:Fake.rules | Where-Object { @($_.Remote) -contains 'Any' }).Count -eq 0)
    Yes '  and the put back task removed itself' (-not $global:Fake.tasks.ContainsKey('Thornswood OpenSSH put back'))

    # ===================================================================== finish ===
    Armed
    $r = Invoke-BoxHere @{ Phase = 'Finish' }
    Yes 'finish before the swap said it worked: STOP, the put back stays armed' ($r.Code -eq 1 -and $global:Fake.tasks.ContainsKey('Thornswood OpenSSH put back') -and $global:Fake.workMade)
    $null = Invoke-BoxHere @{ Phase = 'Swap' }
    $r = Invoke-BoxHere @{ Phase = 'Report' }
    Yes 'report: the swap log, its result and sshd now, with no change' ($r.Code -eq 0 -and (Has $r.Lines '^KEPT swap\.log: ') -and (Has $r.Lines '^KEPT result\.json: \{"') -and (Has $r.Lines '^KEPT sshd now: C:\\Program Files\\OpenSSH\\sshd\.exe 10\.4\.0\.0, Running, post-quantum: mlkem768x25519-sha256'))
    $r = Invoke-BoxHere @{ Phase = 'Finish' }
    Yes 'finish after it worked: the put back cancelled and the work folder removed' ($r.Code -eq 0 -and -not $global:Fake.tasks.ContainsKey('Thornswood OpenSSH put back') -and -not $global:Fake.workMade -and $global:Fake.work.Count -eq 0)

    # ============================================= the program the tasks run, run ===
    Armed
    $pf = Join-Path $tmp 'phase.ps1'
    [IO.File]::WriteAllText($pf, $phaseText, $utf8)
    function global:Get-CimInstance { return [pscustomobject]@{ ProductType = 3 } }
    try {
        $global:LASTEXITCODE = 0
        $out = @(& $pf -Phase Swap 2>&1 | ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
    } finally { Remove-Item function:global:Get-CimInstance -ErrorAction SilentlyContinue }
    Yes 'phase.ps1 -Phase Swap, as the task runs it: exit 0, the new sshd running, result ok' ($code -eq 0 -and $global:Fake.svcs.sshd.Path -eq 'C:\Program Files\OpenSSH\sshd.exe' -and ($global:Fake.work['result.json'] | ConvertFrom-Json).ok)
    Yes '  it asked the box guard first, as a file on the box' ((Has $out '^CHANGED the inbox sshd') -and -not (Has $out '^STOP'))

    # ================================================================ the machine ===
    $kh = Join-Path $tmp 'known_hosts'
    [IO.File]::WriteAllText($kh, "stand-in`n", $utf8)
    $far = Join-Path $tmp 'far'
    New-Item -ItemType Directory -Path $far -Force | Out-Null
    . (Join-Path $repo 'scripts\vps\Send-Script.ps1')
    $global:H = @{
        HostFp = $Pinned[0]; Calls = (New-Object System.Collections.Generic.List[string]); Far = $far; Layer = $Layer
        Box = $Box; BoxText = [IO.File]::ReadAllText($Box); RunnerPath = ${function:Get-ThornswoodRemoteRunnerPath}
        ClientPq = $true
    }
    function global:Start-Sleep { }
    function global:ssh-keygen {
        $a = @($args | ForEach-Object { [string]$_ })
        if ($a -contains '-F') { '# Host 127.0.0.1 found: line 1'; ('127.0.0.1 ED25519 ' + $global:H.HostFp); $global:LASTEXITCODE = 0; return }
        $global:LASTEXITCODE = 1
    }
    function global:scp {
        $WhatIfPreference = $false
        $a = @($args | ForEach-Object { [string]$_ })
        $global:H.Calls.Add('scp ' + ($a -join ' '))
        Copy-Item -LiteralPath $a[-2] -Destination (Join-Path $global:H.Far (($a[-1] -split '/')[-1])) -Force
        $global:LASTEXITCODE = 0
    }
    function global:ssh {
        $WhatIfPreference = $false
        $a = @($args | ForEach-Object { [string]$_ })
        $last = $a[-1]
        $s = ''
        if ($last -match 'EncodedCommand (\S+)') {
            $s = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1]))
            $rp = & $global:H.RunnerPath $s
            if ($rp) { $rf = Join-Path $global:H.Far ($rp -split '\\')[-1]; $s = [IO.File]::ReadAllText($rf); Remove-Item -LiteralPath $rf -Force }
        }
        $at = $s.IndexOf($global:H.BoxText)
        if ($at -ge 0) {
            $given = $s.Substring($at + $global:H.BoxText.Length).Trim().TrimStart('}').Trim()
            $global:H.Calls.Add('ssh ' + (($a | Select-Object -SkipLast 1) -join ' ') + ' BOX ' + $given)
            $b = @{ Layer = $global:H.Layer }
            if ($given -match '-Phase (\w+)') { $b.Phase = $Matches[1] }
            if ($given -match "-Pins '([^']*)'") { $b.Pins = $Matches[1] }
            if ($given -match '(^|\s)-DryRun(\s|$)') { $b.DryRun = $true }
            $out = @(& $global:H.Box @b 2>&1 | ForEach-Object { [string]$_ })
            $code = $LASTEXITCODE
            $out
            $global:LASTEXITCODE = $code; return
        }
        $global:H.Calls.Add('ssh ' + ($a -join ' '))
        if ($last -eq 'echo THORNSWOOD_KEY_OK') {
            # The swap task, as the box runs it once Plan's session is gone.
            $t = $global:Fake.tasks['Thornswood OpenSSH upgrade']
            if ($t -and -not $t.Started) { $t.Started = $true; $null = @(& $global:H.Box -Layer $global:H.Layer -Phase Swap 2>&1) }
            $new = $global:Fake.svcs.sshd -and $global:Fake.svcs.sshd.Path -like '*Program Files*'
            if ($a -contains '-v') {
                ('debug1: Remote protocol version 2.0, remote software version ' + $(if ($new) { 'OpenSSH_for_Windows_10.4' } else { 'OpenSSH_for_Windows_9.5' }))
                ('debug1: kex: algorithm: ' + $(if ($new -and $global:H.ClientPq) { 'mlkem768x25519-sha256' } else { 'curve25519-sha256' }))
            }
            'THORNSWOOD_KEY_OK'; $global:LASTEXITCODE = 0; return
        }
        $global:LASTEXITCODE = 1
    }
    function Invoke-Driver([hashtable]$extra) {
        $a = @{ Vps = '127.0.0.1'; User = 'Administrator'; KnownHosts = $kh; WaitMinutes = 1; NoPause = $true }
        foreach ($k in $extra.Keys) { $a[$k] = $extra[$k] }
        $global:LASTEXITCODE = 0
        $out = @(& $Driver @a 6>&1 2>&1 | ForEach-Object { [string]$_ })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $out; Text = ($out -join "`n") }
    }
    function Fresh { New-Fake; $global:H.Calls.Clear(); $global:H.ClientPq = $true; $global:H.HostFp = $Pinned[0] }

    Fresh
    $global:H.HostFp = 'SHA256:' + ('A' * 43)
    $r = Invoke-Driver @{}
    Yes 'known_hosts without the pinned key: refused before any ssh at all' ($r.Code -eq 1 -and $r.Text -match 'does not hold only keys scripts\\vps\\vps\.json pins' -and $global:H.Calls.Count -eq 0)

    Fresh
    $r = Invoke-Driver @{ WhatIf = $true }
    Yes '-WhatIf: exit 0, the plan ran read only with vps.json''s pins, and nothing was armed' ($r.Code -eq 0 -and @($global:H.Calls | Where-Object { $_ -match (" BOX -Phase Plan -Pins '" + [regex]::Escape($PinArg) + "' -DryRun$") }).Count -eq 1 -and $global:Fake.tasks.Count -eq 0 -and $r.Text -match 'Nothing was changed')
    Yes '  it said the key exchange a login gets now' ($r.Text -match 'OpenSSH_for_Windows_9\.5, curve25519-sha256, not post-quantum')

    Fresh
    $r = Invoke-Driver @{}
    Yes 'real run: exit 0, PASS for the pinned host key, the post-quantum key exchange and 10.4' ($r.Code -eq 0 -and $r.Text -match 'PASS  a new login gets in' -and $r.Text -match 'PASS  it negotiated a post-quantum key exchange \(mlkem768x25519-sha256\)' -and $r.Text -match 'PASS  the box says OpenSSH_for_Windows_10\.4')
    $phases = @($global:H.Calls | Where-Object { $_ -match ' BOX -Phase (\w+)' } | ForEach-Object { ([regex]::Match($_, ' BOX -Phase (\w+)')).Groups[1].Value })
    Yes '  the box ran Plan, Report and Finish, in that order' (($phases -join ',') -eq 'Plan,Report,Finish')
    Yes '  and the put back is cancelled and the work folder gone' (-not $global:Fake.tasks.ContainsKey('Thornswood OpenSSH put back') -and $global:Fake.work.Count -eq 0)
    Yes '  every ssh and scp it ran checked the host key' (@($global:H.Calls | Where-Object { $_ -notmatch 'StrictHostKeyChecking=yes' }).Count -eq 0)

    Fresh
    $global:H.ClientPq = $false
    $r = Invoke-Driver @{}
    Yes 'a new login that is not post-quantum: FAIL, exit 1, no Finish, the put back stays armed' ($r.Code -eq 1 -and $r.Text -match 'FAIL  it negotiated a post-quantum' -and @($global:H.Calls | Where-Object { $_ -match ' BOX -Phase Finish' }).Count -eq 0 -and $global:Fake.tasks.ContainsKey('Thornswood OpenSSH put back'))

    Fresh
    $global:Fake.msiCode = 1603
    $r = Invoke-Driver @{}
    Yes 'a swap that failed: exit 1, no Finish, and the put back started' ($r.Code -eq 1 -and $r.Text -match 'The swap did not say it worked' -and @($global:H.Calls | Where-Object { $_ -match ' BOX -Phase Finish' }).Count -eq 0 -and $global:Fake.tasks['Thornswood OpenSSH put back'].Started)

    Fresh
    $global:Fake.inboxPq = $true
    $r = Invoke-Driver @{}
    Yes 'a box that already offers one: exit 0, nothing to change, nothing armed' ($r.Code -eq 0 -and $r.Text -match 'nothing to change' -and $global:Fake.tasks.Count -eq 0)
}
finally {
    foreach ($f in 'ssh', 'scp', 'ssh-keygen', 'Start-Sleep') { Remove-Item ("function:global:" + $f) -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($k in $envWas.Keys) { [Environment]::SetEnvironmentVariable($k, $envWas[$k]) }
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
