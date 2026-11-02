<#
.SYNOPSIS
  Runs ON THE VPS, sent there by Upgrade-OpenSsh.ps1: puts Microsoft's OpenSSH for Windows 10.4 in place of the Windows Server 2022 one, so sshd offers a post-quantum key exchange, keeping the box's host keys, sshd_config and port 22 rules as they are.

.DESCRIPTION
  Do not run this by hand. Upgrade-OpenSsh.ps1 proves key login and the
  pinned host key first, from your machine, and sends this; run that instead.

  WHY (#1043). From 28 Sep 2026 every ssh from One printed "connection is not
  using a post-quantum key exchange algorithm". The box's sshd is the one
  Windows Server 2022 ships (C:\Windows\System32\OpenSSH, 9.5.5.3 when
  measured on 26 Oct 2026), and that build has no post-quantum key exchange
  at all: its ssh -Q kex lists none, and sshd -T offers curve25519, ecdh and
  diffie-hellman only, with nothing in sshd_config narrowing it. The cause is
  in Microsoft's build: openssh-portable v9.5.0.0's
  contrib\win32\openssh\config.h.vs does not define USE_SNTRUP761X25519, so
  sntrup761x25519 is left out of the binary, while v10.0.0.0 and v10.4.0.0
  define it and USE_MLKEM768X25519 too. Windows Update does not ship a newer
  one for Server 2022, so the newer one comes from Microsoft's own release,
  PowerShell/Win32-OpenSSH 10.4.0.0p1-Preview (20 Oct 2026), its 64-bit MSI,
  pinned below by SHA256 and checked to be signed by Microsoft.

  WHY THE INBOX ONE IS REMOVED FIRST. The MSI registers services named sshd
  and ssh-agent, which the inbox OpenSSH.Server and OpenSSH.Client
  capabilities already hold, and an MSI cannot install a service whose name
  is taken. Leaving the capability in place with its service pointed
  elsewhere would let Windows servicing put the old one back by itself. So
  both capabilities are removed, and the MSI installs client and server to
  C:\Program Files\OpenSSH. Nothing in C:\ProgramData\ssh is the
  capability's: sshd made the host keys and copied sshd_config there at its
  first start, so they stay, and the new sshd reads them. The swap checks
  that: the MSI starts the new sshd as it installs it, and unless the host
  keys it reads are the pinned ones the put back starts at once.

  PHASES. -Phase Plan (the default) reads everything and, with -DryRun,
  says WOULD for each change and checks the download without keeping it.
  Without -DryRun it downloads the MSI into C:\ProgramData\Thornswood-OpenSSH
  (SYSTEM and Administrators only), writes the box's state as it is there,
  and arms two one time tasks that run as SYSTEM, because the swap stops
  sshd and an ssh session goes with it:
    Thornswood OpenSSH upgrade    about 20 seconds later: -Phase Swap
    Thornswood OpenSSH put back   25 minutes later: -Phase PutBack, unless
                                  Upgrade-OpenSsh.ps1 cancels it once a new
                                  login with the pinned host key gets in
  -Phase Swap stops sshd, removes the two capabilities, installs the MSI
  (which starts its sshd and ssh-agent), checks sshd is the new one, reads
  the pinned host keys, offers a post-quantum key exchange and passes
  sshd -t, puts ssh-agent back the way it was (Disabled), removes any port 22
  rule the install made (the MSI's own allows any address on Private), and
  sees sshd running with the start mode it had. A step that fails starts the
  put back at once.
  -Phase PutBack uninstalls the MSI, adds the capabilities back, puts the port
  22 rules' addresses and both services' start modes back as they were, and
  starts sshd.
  -Phase Report says what the swap and the put back did and what sshd is now.
  -Phase Finish cancels the put back and removes the folder, once the swap
  said it worked.

  Every line of output starts with one word: CHANGED, WOULD (with -DryRun),
  ALREADY, KEPT, WARN or STOP. STOP means nothing after it was done, and the
  exit code is 1.

.PARAMETER Phase
  Plan, Swap, PutBack, Report or Finish. Above.

.PARAMETER DryRun
  With Plan: read everything, check the download, change nothing.

.PARAMETER Pins
  The host key fingerprints scripts\vps\vps.json pins, comma separated.
  Plan refuses to arm anything unless sshd's host keys are these.

.PARAMETER Layer
  A file that replaces the functions below that touch Windows. Only
  tests\test-1043-openssh-upgrade.ps1 passes it.
#>
[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Swap', 'PutBack', 'Report', 'Finish')][string]$Phase = 'Plan',
    [switch]$DryRun,
    [string]$Pins = '',
    [string]$Layer = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# The functions Windows PowerShell already has, so the phase file below
# carries only this script's own. A module's functions are left out as well:
# NetSecurity and ScheduledTasks load while the plan runs, and their commands
# are CDXML functions that only work inside their module, so copied into the
# phase file they shadowed the real ones and the swap stopped at the firewall
# (#1043, 26 Oct 2026).
$ThornswoodBuiltIn = @(Get-ChildItem function: | ForEach-Object { $_.Name })

# The release (#1043). SHA256 read on 26 Oct 2026 from the release asset;
# the signature is Microsoft's (MsiDigitalSignatureEx: Microsoft Corporation,
# Microsoft Code Signing PCA). A newer release is a new pin here.
$Release = @{
    Version = '10.4.0.0'
    Tag = '10.4.0.0p1-Preview'
    File = 'OpenSSH-Win64-v10.4.0.0.msi'
    Sha256 = '788D8643464A01EB63640A2FD746F9ED23D106B5A901A35F88DC8CD40E446AC9'
    Signer = 'O=Microsoft Corporation'
}
$Url = 'https://github.com/PowerShell/Win32-OpenSSH/releases/download/' + $Release.Tag + '/' + $Release.File
$Work = [string]$env:ProgramData + '\Thornswood-OpenSSH'
$Msi = $Work + '\' + $Release.File
$NewSshd = [string]$env:ProgramFiles + '\OpenSSH\sshd.exe'
$Capabilities = @('OpenSSH.Server~~~~0.0.1.0', 'OpenSSH.Client~~~~0.0.1.0')
$PqKex = @('mlkem768x25519-sha256', 'sntrup761x25519-sha512', 'sntrup761x25519-sha512@openssh.com')
$SwapTask = 'Thornswood OpenSSH upgrade'
$PutBackTask = 'Thornswood OpenSSH put back'
$SwapSeconds = 20
$PutBackMinutes = 25
$LogName = ''

# ---------------------------------------------------------------- the layer ---
# Everything that touches Windows goes through these, so the harness can put
# stand-ins in their place with -Layer and run the rest of this for real.

# A service as Path (the program, without quotes or arguments), State and
# StartMode (Auto, Manual, Disabled), or $null when there is none.
function Get-OpenSshService([string]$Name) {
    $s = Get-CimInstance -ClassName Win32_Service -Filter ("Name='" + $Name + "'") -ErrorAction SilentlyContinue
    if (-not $s) { return $null }
    $p = [string]$s.PathName
    if ($p.StartsWith('"')) { $p = $p.Substring(1, $p.IndexOf('"', 1) - 1) }
    elseif ($p -match '^(.*?\.exe)\b') { $p = $Matches[1] }
    return [pscustomobject]@{ Path = $p; State = [string]$s.State; StartMode = [string]$s.StartMode }
}
function Stop-OpenSshService([string]$Name) { Stop-Service -Name $Name -Force }
function Start-OpenSshService([string]$Name) { Start-Service -Name $Name }
function Set-OpenSshStartMode([string]$Name, [string]$Mode) {
    $t = @{ Auto = 'Automatic'; Manual = 'Manual'; Disabled = 'Disabled' }[$Mode]
    if (-not $t) { throw ('no start mode ' + $Mode) }
    Set-Service -Name $Name -StartupType $t
}
# What Microsoft's own install-sshd.ps1 does with a service of the same name.
function Remove-ServiceEntry([string]$Name) {
    & sc.exe delete $Name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ('sc.exe delete ' + $Name + ' said ' + $LASTEXITCODE) }
}
# The sessions the old sshd left running: each holds a file of the folder
# the capability is being removed from.
# Path asks the process again on every read, and a session can end
# between two reads, so the filter reads it once, a gone one as "" (#4059).
function Stop-InboxSshd {
    $dir = [string]$env:WINDIR + '\System32\OpenSSH\'
    Get-Process -Name sshd, sshd-session -ErrorAction SilentlyContinue |
        Where-Object { ([string]$_.Path).StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) } |
        Stop-Process -Force
}

function Test-NewSshd { return (Test-Path -LiteralPath $NewSshd) }
function Get-ExeVersion([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    return [string](Get-Item -LiteralPath $Path).VersionInfo.FileVersion
}
# sshd -T: every setting as sshd would run with it.
function Read-SshdSettings([string]$Exe) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(& $Exe -T 2>&1 | ForEach-Object { [string]$_ })
    $ErrorActionPreference = $old
    return $out
}
function Test-SshdConfig([string]$Exe) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(& $Exe -t 2>&1 | ForEach-Object { [string]$_ })
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    return [pscustomobject]@{ Ok = ($rc -eq 0); Said = ($out -join ' ') }
}
function Read-TextFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return [IO.File]::ReadAllText($Path)
}

function Get-CapabilityState([string]$Name) { return [string](Get-WindowsCapability -Online -Name $Name).State }
# Each answers whether Windows wants a restart to finish.
function Remove-Capability([string]$Name) { return [bool](Remove-WindowsCapability -Online -Name $Name).RestartNeeded }
function Add-Capability([string]$Name) { return [bool](Add-WindowsCapability -Online -Name $Name).RestartNeeded }

function Save-Download([string]$From, [string]$To) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $From -OutFile $To -UseBasicParsing
}
function Get-Sha256([string]$Path) { return [string](Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function Get-Signer([string]$Path) {
    $s = Get-AuthenticodeSignature -LiteralPath $Path
    $subject = ''
    if ($s.SignerCertificate) { $subject = [string]$s.SignerCertificate.Subject }
    return [pscustomobject]@{ Status = [string]$s.Status; Subject = $subject }
}
function New-TempPath { return [IO.Path]::Combine([IO.Path]::GetTempPath(), 'thornswood-openssh-' + [Guid]::NewGuid().ToString('N') + '.msi') }
function Remove-FilePath([string]$Path) { Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue }

# msiexec's exit code. 0 is done, 3010 done with a restart wanted.
function Invoke-Msi([string[]]$Arguments) {
    $quoted = @($Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } })
    return [int](Start-Process -FilePath 'msiexec.exe' -ArgumentList $quoted -Wait -PassThru).ExitCode
}

# Enabled inbound allow rules on port 22 the firewall takes, each as Name,
# DisplayName, Remote and Store (GroupPolicy for the box's own policy, Local
# for the local store, where an installer puts its rule; #3896).
function Get-Port22Rules {
    foreach ($r in @(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Enabled True -Action Allow -ErrorAction SilentlyContinue)) {
        $pf = $r | Get-NetFirewallPortFilter
        if (@($pf.LocalPort) -notcontains '22') { continue }
        $af = $r | Get-NetFirewallAddressFilter
        [pscustomobject]@{ Name = [string]$r.Name; DisplayName = [string]$r.DisplayName; Remote = @(@($af.RemoteAddress) | ForEach-Object { [string]$_ }); Store = [string]$r.PolicyStoreSourceType }
    }
}
function Test-Rule([string]$Name) { return [bool](Get-NetFirewallRule -PolicyStore ActiveStore -Name $Name -ErrorAction SilentlyContinue) }
# A change goes to the store the firewall took the rule from: the box's own
# policy, then Group Policy refreshed (scripts\vps\BoxFirewall.ps1, #3896), or
# the local store for an installer's rule or one from before
# Set-InboundRules.ps1 -Own.
function Set-RuleRemote([string]$Name, [string[]]$Remote, [string]$Store = 'GroupPolicy') {
    if ($Store -eq 'Local') { Set-NetFirewallRule -PolicyStore PersistentStore -Name $Name -RemoteAddress $Remote; return }
    Set-NetFirewallRule -PolicyStore localhost -Name $Name -RemoteAddress $Remote
    Sync-ThornswoodFirewall
}
function Remove-Rule([string]$Name, [string]$Store = 'GroupPolicy') {
    if ($Store -eq 'Local') { Remove-NetFirewallRule -PolicyStore PersistentStore -Name $Name; return }
    Remove-NetFirewallRule -PolicyStore localhost -Name $Name
    Sync-ThornswoodFirewall
}

# The work folder, which only SYSTEM and Administrators may open: it holds the
# box's state and the program the tasks run.
function New-WorkFolder {
    if (-not (Test-Path -LiteralPath $Work)) { New-Item -ItemType Directory -Path $Work | Out-Null }
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($s in 'S-1-5-18', 'S-1-5-32-544') {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    Set-Acl -LiteralPath $Work -AclObject $acl
    $got = Get-Acl -LiteralPath $Work
    $who = @($got.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
    if (-not $got.AreAccessRulesProtected -or ($who -join ',') -ne 'S-1-5-18,S-1-5-32-544') { throw ($Work + ' did not take SYSTEM and Administrators alone: ' + ($who -join ', ')) }
}
function Write-WorkFile([string]$Name, [string]$Text) { [IO.File]::WriteAllText(($Work + '\' + $Name), $Text, (New-Object Text.UTF8Encoding($false))) }
function Add-WorkLog([string]$Name, [string]$Line) { [IO.File]::AppendAllText(($Work + '\' + $Name), ((Get-Date -Format 'yyyy-MM-dd h:mm:ss tt') + '  ' + $Line + "`r`n")) }
function Read-WorkFile([string]$Name) { return (Read-TextFile ($Work + '\' + $Name)) }
function Remove-WorkFolder { Remove-Item -LiteralPath $Work -Recurse -Force }

function Register-OneShot([string]$Task, [string]$PhaseName, [datetime]$At, [int]$Minutes) {
    $a = New-ScheduledTaskAction -Execute (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $Work + '\phase.ps1" -Phase ' + $PhaseName)
    $t = New-ScheduledTaskTrigger -Once -At $At
    $p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes $Minutes) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $Task -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null
}
function Test-Task([string]$Task) { return [bool](Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue) }
function Start-Task([string]$Task) { Start-ScheduledTask -TaskName $Task }
function Stop-Task([string]$Task) { Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue }
function Remove-Task([string]$Task) { Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue }

if ($Layer) { . $Layer }

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

# ------------------------------------------------------------ the reading ---
$changes = 0
$stopped = $false
function Say([string]$word, [string]$what) {
    Write-Output ($word + ' ' + $what)
    if ($script:LogName) { Add-WorkLog $script:LogName ($word + ' ' + $what) }
}
function Change([string]$what) {
    $script:changes++
    if ($DryRun) { Say 'WOULD' $what } else { Say 'CHANGED' $what }
}
function Stop-Here([string]$what) { $script:stopped = $true; Say 'STOP' $what }

# The SHA256 fingerprint of a public key line, as ssh-keygen -l prints it.
function Get-KeyPrint([string]$Line) {
    $f = @($Line.Trim() -split '\s+')
    if ($f.Count -lt 2) { return '' }
    try { $blob = [Convert]::FromBase64String($f[1]) } catch { return '' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ('SHA256:' + [Convert]::ToBase64String($sha.ComputeHash($blob)).TrimEnd('=')) }
    finally { $sha.Dispose() }
}

# What sshd at $Exe offers and which host keys it reads, from sshd -T.
function Read-Sshd([string]$Exe) {
    $lines = @(Read-SshdSettings $Exe)
    $kex = @()
    $prints = @()
    foreach ($l in $lines) {
        if ($l -match '^kexalgorithms\s+(\S+)') { $kex = @($Matches[1] -split ',') }
        elseif ($l -match '^hostkey\s+(.+)$') {
            $file = $Matches[1].Trim().Replace('__PROGRAMDATA__', [string]$env:ProgramData) + '.pub'
            $text = Read-TextFile $file
            if ($null -ne $text) { $prints += (Get-KeyPrint $text) }
        }
    }
    return [pscustomobject]@{ Kex = $kex; Pq = @($kex | Where-Object { $PqKex -contains $_ }); Prints = @($prints | Where-Object { $_ }); Said = $lines }
}

function Read-State {
    $t = Read-WorkFile 'before.json'
    if ($null -eq $t) { return $null }
    return ($t | ConvertFrom-Json)
}

# The program the two tasks run: this script's own functions and settings,
# from the copy that is running, so nothing of it is fetched or kept
# anywhere else.
function Get-PhaseScript {
    $vars = [ordered]@{}
    foreach ($n in 'Release', 'Url', 'Work', 'Msi', 'NewSshd', 'Capabilities', 'PqKex', 'SwapTask', 'PutBackTask', 'SwapSeconds', 'PutBackMinutes') {
        $vars[$n] = (Get-Variable -Name $n -Scope Script).Value
    }
    $json = ($vars | ConvertTo-Json -Depth 4 -Compress).Replace("'", "''")
    $b = New-Object Text.StringBuilder
    [void]$b.AppendLine('param([string]$Phase)')
    [void]$b.AppendLine('$ErrorActionPreference = ''Stop''')
    [void]$b.AppendLine('$ProgressPreference = ''SilentlyContinue''')
    [void]$b.AppendLine('$DryRun = $false; $Pins = ''''; $Layer = ''''; $LogName = ''''; $changes = 0; $stopped = $false')
    [void]$b.AppendLine('foreach ($p in (''' + $json + ''' | ConvertFrom-Json).PSObject.Properties) { Set-Variable -Name $p.Name -Value $p.Value -Scope Script }')
    foreach ($f in @(Get-ChildItem function: | Where-Object { -not $_.ModuleName -and $ThornswoodBuiltIn -notcontains $_.Name } | Sort-Object Name)) {
        [void]$b.AppendLine('function ' + $f.Name + ' {')
        [void]$b.AppendLine($f.ScriptBlock.ToString())
        [void]$b.AppendLine('}')
    }
    [void]$b.AppendLine('try { Invoke-OpenSsh } catch { Say ''STOP'' (''it failed partway, at: '' + $_.Exception.Message); exit 1 }')
    [void]$b.AppendLine('if ($stopped) { exit 1 }')
    return $b.ToString()
}

# ------------------------------------------------------------------- plan ---
function Invoke-Plan {
    $pinned = @($Pins -split '[,\s]+' | Where-Object { $_ })
    if (-not $pinned.Count) { Stop-Here 'no host key pins were given (-Pins). Run Upgrade-OpenSsh.ps1, which passes the ones scripts\vps\vps.json holds.'; return }
    $svc = Get-OpenSshService 'sshd'
    if (-not $svc) { Stop-Here 'there is no sshd service on the box, so there is nothing to upgrade and nothing here knows how ssh reaches it.'; return }
    Say 'KEPT' ('sshd is ' + $svc.Path + ' ' + (Get-ExeVersion $svc.Path) + ', ' + $svc.State + ', ' + $svc.StartMode)

    $now = Read-Sshd $svc.Path
    $missing = @($pinned | Where-Object { $now.Prints -notcontains $_ })
    if ($missing.Count) { Stop-Here ('sshd''s host keys are not the pinned ones (' + ($now.Prints -join ', ') + '; pinned ' + ($pinned -join ', ') + '). Nothing was changed.'); return }
    Say 'ALREADY' ('sshd reads the ' + $pinned.Count + ' pinned host keys')

    $inFlight = @(@($SwapTask, $PutBackTask) | Where-Object { Test-Task $_ })
    if ($inFlight.Count -or $null -ne (Read-WorkFile 'before.json')) {
        Stop-Here ('an upgrade is already armed or was left (' + $(if ($inFlight.Count) { 'task ' + ($inFlight -join ', ') } else { $Work + '\before.json' }) + '). Upgrade-OpenSsh.ps1 -Report says what it did.')
        return
    }

    if ($now.Pq.Count) {
        Say 'ALREADY' ('sshd offers a post-quantum key exchange: ' + ($now.Pq -join ', '))
        return
    }
    Say 'WARN' ('sshd offers no post-quantum key exchange: ' + ($now.Kex -join ', '))

    $caps = [ordered]@{}
    foreach ($c in $Capabilities) { $caps[$c] = Get-CapabilityState $c; Say 'KEPT' ($c + ' is ' + $caps[$c]) }
    $agent = Get-OpenSshService 'ssh-agent'
    if ($agent) { Say 'KEPT' ('ssh-agent is ' + $agent.State + ', ' + $agent.StartMode + ', and is put back so') }
    $rules = @(Get-Port22Rules)
    foreach ($r in $rules) { Say 'KEPT' ("firewall rule '" + $r.DisplayName + "' on port 22, from " + ($r.Remote -join ', ') + ', kept so') }
    if (-not $rules.Count) { Say 'WARN' 'no enabled firewall rule names port 22; the bridge reaches sshd on 127.0.0.1. Nothing here adds one.' }

    # The download, checked the same way in a dry run, into a file that goes.
    if ($DryRun) { $file = New-TempPath } else { New-WorkFolder; $file = $Msi }
    try {
        Save-Download $Url $file
        $sha = Get-Sha256 $file
        if ($sha -ne $Release.Sha256) { Stop-Here ($Release.File + ' from ' + $Url + ' has SHA256 ' + $sha + ', not the pinned ' + $Release.Sha256 + '. Nothing was installed.'); return }
        $sig = Get-Signer $file
        if ($sig.Status -ne 'Valid' -or $sig.Subject -notmatch [regex]::Escape($Release.Signer)) { Stop-Here ($Release.File + ' is not signed by Microsoft (' + $sig.Status + ', ' + $sig.Subject + '). Nothing was installed.'); return }
        Say 'ALREADY' ($Release.File + ' matches its pinned SHA256 and is signed by ' + $Release.Signer)
    }
    finally {
        if ($DryRun -or $script:stopped) { Remove-FilePath $file }
    }

    if ($DryRun) {
        Change ('remove ' + (@($Capabilities | Where-Object { $caps[$_] -eq 'Installed' }) -join ' and ') + ', install OpenSSH for Windows ' + $Release.Version + ' with sshd at ' + $NewSshd + ', keep the host keys and sshd_config in ' + [string]$env:ProgramData + '\ssh, then start sshd')
        Change ("arm '" + $SwapTask + "' in " + $SwapSeconds + " seconds and '" + $PutBackTask + "' in " + $PutBackMinutes + ' minutes')
        return
    }

    $state = [ordered]@{
        sshd = @{ Path = $svc.Path; StartMode = $svc.StartMode }
        agent = $(if ($agent) { @{ StartMode = $agent.StartMode; State = $agent.State } } else { $null })
        caps = $caps
        rules = @($rules | ForEach-Object { @{ Name = $_.Name; DisplayName = $_.DisplayName; Remote = @($_.Remote); Store = $_.Store } })
        prints = @($pinned)
    }
    Write-WorkFile 'before.json' ($state | ConvertTo-Json -Depth 5)
    Write-WorkFile 'phase.ps1' (Get-PhaseScript)
    Register-OneShot $PutBackTask 'PutBack' ((Get-Date).AddMinutes($PutBackMinutes)) 30
    Change ("a task named '" + $PutBackTask + "' puts the inbox sshd back in " + $PutBackMinutes + ' minutes unless Upgrade-OpenSsh.ps1 cancels it once a new login gets in')
    Register-OneShot $SwapTask 'Swap' ((Get-Date).AddSeconds($SwapSeconds)) 20
    Change ("a task named '" + $SwapTask + "' swaps sshd in about " + $SwapSeconds + ' seconds; ssh is down while it runs')
}

# ------------------------------------------------------------------- swap ---
function Invoke-Swap {
    $script:LogName = 'swap.log'
    $step = 'reading the state Plan wrote'
    $restart = $false
    try {
        $b = Read-State
        if ($null -eq $b) { throw ('there is no ' + $Work + '\before.json') }

        $step = 'stopping the inbox sshd'
        Stop-OpenSshService 'sshd'
        Stop-InboxSshd
        Say 'CHANGED' 'the inbox sshd and its sessions stopped'

        foreach ($c in $Capabilities) {
            if ([string]$b.caps.$c -ne 'Installed') { continue }
            $step = 'removing ' + $c
            if (Remove-Capability $c) { $restart = $true }
            Say 'CHANGED' ($c + ' removed')
        }
        foreach ($n in 'sshd', 'ssh-agent') {
            if (-not (Get-OpenSshService $n)) { continue }
            $step = 'freeing the service name ' + $n
            Remove-ServiceEntry $n
            Say 'CHANGED' ('the ' + $n + ' service the capability left until a restart is deleted, as install-sshd.ps1 does, so the MSI can make its own')
        }

        $step = 'installing ' + $Release.File
        $code = Invoke-Msi @('/i', $Msi, '/qn', '/norestart', '/l*v', ($Work + '\install.log'))
        if ($code -eq 3010) { $restart = $true }
        elseif ($code -ne 0) { throw ('msiexec said ' + $code + '; ' + $Work + '\install.log has why') }
        Say 'CHANGED' ('OpenSSH for Windows ' + $Release.Version + ' installed (msiexec ' + $code + ')')

        $step = 'checking the new sshd'
        $svc = Get-OpenSshService 'sshd'
        if (-not $svc -or $svc.Path -ne $NewSshd) { throw ('the sshd service is ' + $(if ($svc) { $svc.Path } else { 'missing' }) + ', not ' + $NewSshd) }
        $ver = Get-ExeVersion $NewSshd
        if (-not $ver.StartsWith($Release.Version)) { throw ($NewSshd + ' is ' + $ver + ', not ' + $Release.Version) }
        $new = Read-Sshd $NewSshd
        $lost = @(@($b.prints) | Where-Object { $new.Prints -notcontains $_ })
        if ($lost.Count) { throw ('the new sshd does not read the pinned host keys ' + ($lost -join ', ') + ' (it reads ' + ($new.Prints -join ', ') + ')') }
        Say 'ALREADY' ('the new sshd reads the ' + @($b.prints).Count + ' pinned host keys')
        if (-not $new.Pq.Count) { throw ('the new sshd offers no post-quantum key exchange either: ' + ($new.Kex -join ', ')) }
        $t = Test-SshdConfig $NewSshd
        if (-not $t.Ok) { throw ('sshd -t refused sshd_config: ' + $t.Said) }
        Say 'ALREADY' 'sshd -t accepts sshd_config as it is'

        $step = 'putting ssh-agent back as it was'
        if ($b.agent) {
            Set-OpenSshStartMode 'ssh-agent' ([string]$b.agent.StartMode)
            if ([string]$b.agent.State -eq 'Stopped') { Stop-OpenSshService 'ssh-agent' }
            Say 'CHANGED' ('ssh-agent ' + $b.agent.State + ', ' + $b.agent.StartMode + ', as before')
        }

        $step = 'keeping port 22 as it was'
        $had = @(@($b.rules) | ForEach-Object { [string]$_.Name })
        foreach ($r in @(Get-Port22Rules)) {
            if ($had -contains $r.Name) { continue }
            Remove-Rule $r.Name $r.Store
            Say 'CHANGED' ("firewall rule '" + $r.DisplayName + "' the install made (from " + ($r.Remote -join ', ') + ') removed; port 22 keeps the rules it had')
        }
        foreach ($r in @($b.rules)) {
            if (-not (Test-Rule ([string]$r.Name))) { Say 'KEPT' ("firewall rule '" + $r.DisplayName + "' went with the capability") }
        }

        $step = 'starting the new sshd'
        Set-OpenSshStartMode 'sshd' ([string]$b.sshd.StartMode)
        Start-OpenSshService 'sshd'
        $svc = Get-OpenSshService 'sshd'
        if ($svc.State -ne 'Running') { throw ('sshd is ' + $svc.State + ' after Start-Service') }
        Say 'CHANGED' ('sshd ' + $ver + ' is running and offers ' + ($new.Pq -join ', '))

        Write-WorkFile 'result.json' (@{ ok = $true; version = $ver; pq = @($new.Pq); restart = $restart } | ConvertTo-Json -Compress)
        if ($restart) { Say 'WARN' 'Windows finishes removing the old files at its next restart' }
    }
    catch {
        Say 'STOP' ('the swap failed ' + $step + ': ' + $_.Exception.Message + '. The put back starts now.')
        Write-WorkFile 'result.json' (@{ ok = $false; step = $step; said = $_.Exception.Message } | ConvertTo-Json -Compress)
        Start-Task $PutBackTask
        $script:stopped = $true
    }
    finally { Remove-Task $SwapTask }
}

# --------------------------------------------------------------- put back ---
function Invoke-PutBack {
    $script:LogName = 'putback.log'
    Stop-Task $SwapTask
    Remove-Task $SwapTask
    $b = Read-State
    if ($null -eq $b) { Stop-Here ('there is no ' + $Work + '\before.json, so what to put back is not known'); return }

    if (Test-NewSshd) {
        if (Get-OpenSshService 'sshd') { Stop-OpenSshService 'sshd' }
        $code = Invoke-Msi @('/x', $Msi, '/qn', '/norestart', '/l*v', ($Work + '\uninstall.log'))
        if ($code -ne 0 -and $code -ne 3010) { Stop-Here ('msiexec /x said ' + $code + '; ' + $Work + '\uninstall.log has why. The console is the way back: Get-Help .\scripts\vps\Upgrade-OpenSsh.ps1 -Full'); return }
        Say 'CHANGED' ('OpenSSH for Windows ' + $Release.Version + ' uninstalled (msiexec ' + $code + ')')
    }
    foreach ($c in $Capabilities) {
        if ([string]$b.caps.$c -ne 'Installed' -or (Get-CapabilityState $c) -eq 'Installed') { continue }
        [void](Add-Capability $c)
        Say 'CHANGED' ($c + ' added back')
    }
    if ($b.agent -and (Get-OpenSshService 'ssh-agent')) {
        Set-OpenSshStartMode 'ssh-agent' ([string]$b.agent.StartMode)
        if ([string]$b.agent.State -eq 'Stopped') { Stop-OpenSshService 'ssh-agent' }
    }
    $had = @(@($b.rules) | ForEach-Object { [string]$_.Name })
    foreach ($r in @(Get-Port22Rules)) {
        if ($had -notcontains $r.Name) { Remove-Rule $r.Name $r.Store; Say 'CHANGED' ("firewall rule '" + $r.DisplayName + "' removed; port 22 keeps the rules it had") }
    }
    foreach ($r in @($b.rules)) {
        if (Test-Rule ([string]$r.Name)) { Set-RuleRemote ([string]$r.Name) @($r.Remote) ([string]$r.Store) }
        else { Say 'WARN' ("firewall rule '" + $r.DisplayName + "' is gone") }
    }
    Set-OpenSshStartMode 'sshd' ([string]$b.sshd.StartMode)
    Start-OpenSshService 'sshd'
    $svc = Get-OpenSshService 'sshd'
    Say 'CHANGED' ('sshd is back: ' + $svc.Path + ' ' + (Get-ExeVersion $svc.Path) + ', ' + $svc.State)
    Remove-Task $PutBackTask
}

# ----------------------------------------------------------- report, finish ---
function Invoke-Report {
    foreach ($n in 'swap.log', 'putback.log') {
        $t = Read-WorkFile $n
        if ($null -eq $t) { continue }
        foreach ($l in @($t -split "`r?`n" | Where-Object { $_ })) { Say 'KEPT' ($n + ': ' + $l) }
    }
    $r = Read-WorkFile 'result.json'
    if ($null -eq $r) { Say 'WARN' 'the swap has not written its result yet' } else { Say 'KEPT' ('result.json: ' + $r.Trim()) }
    foreach ($t in $SwapTask, $PutBackTask) { if (Test-Task $t) { Say 'KEPT' ("task '" + $t + "' is armed") } }
    $svc = Get-OpenSshService 'sshd'
    if ($svc) {
        $now = Read-Sshd $svc.Path
        Say 'KEPT' ('sshd now: ' + $svc.Path + ' ' + (Get-ExeVersion $svc.Path) + ', ' + $svc.State + ', post-quantum: ' + $(if ($now.Pq.Count) { $now.Pq -join ', ' } else { 'none' }))
    }
}

function Invoke-Finish {
    $r = Read-WorkFile 'result.json'
    if ($null -eq $r -or -not ($r | ConvertFrom-Json).ok) { Stop-Here 'the swap did not say it worked, so the put back stays armed.'; return }
    Remove-Task $PutBackTask
    if (Test-Task $PutBackTask) { Stop-Here ("could not cancel '" + $PutBackTask + "'"); return }
    Change ("'" + $PutBackTask + "' cancelled, so the upgrade stays")
    Remove-WorkFolder
    Change ($Work + ' removed (the MSI, the state and the logs this run printed)')
}

function Invoke-OpenSsh {
    # Only ever on the box (BoxGuard.ps1, carried below its layer).
    if (-not $Layer) {
        $notBox = Get-ThornswoodBoxRefusal
        if ($notBox) { $script:stopped = $true; Say 'STOP' ($notBox + '. Run Upgrade-OpenSsh.ps1 on your machine; it sends this to the box.'); return }
    }
    switch ($Phase) {
        'Plan' { Invoke-Plan }
        'Swap' { Invoke-Swap }
        'PutBack' { Invoke-PutBack }
        'Report' { Invoke-Report }
        'Finish' { Invoke-Finish }
    }
}

try { Invoke-OpenSsh }
catch {
    $stopped = $true
    Say 'STOP' ('it failed partway, at: ' + $_.Exception.Message)
}
finally {
    if ($Phase -eq 'Plan' -or $Phase -eq 'Finish') {
        if ($DryRun) { Say 'DONE' ([string]$changes + ' change(s) would be made. Nothing was changed.') }
        elseif ($stopped) { Say 'DONE' ([string]$changes + ' change(s) made before it stopped.') }
        else { Say 'DONE' ([string]$changes + ' change(s) made.') }
    } else { Say 'DONE' ($Phase + ' ran.') }
}
if ($stopped) { exit 1 }
exit 0
