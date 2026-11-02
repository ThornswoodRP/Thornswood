<#
.SYNOPSIS
  Runs ON THE VPS, read-only: prints the box's own facts (listeners, tasks, services, file hashes, certificate dates, versions, setting names) as JSON for Check-ProdParity.ps1, never a secret value (issue #2165).

.DESCRIPTION
  Nothing here writes, starts, stops or changes anything. What it prints:
    listeners  every TCP listen and UDP endpoint: address, port, process name
    tasks      every Thornswood task: user, run level, state, trigger kinds,
               the program it starts, and its arguments only as a sha256
    services   sshd, ThornswoodBot and the runners: account, start mode, state
    files      sha256 of the live copies Check-ProdParity names (Caddyfile,
               site server.js, voice-server.js)
    certs      subject and NotAfter of each certificate Caddy keeps
    versions   file versions of node, caddy, python and sshd
    inboundRules  every enabled inbound Allow firewall rule: Name,
               DisplayName, protocol, local ports and remote addresses
               (#3807)
    settings   for each config file named, its top level key NAMES and the
               JSON type of each value; machine environment variable NAMES
               that start THORNSWOOD_; never a value
  -Define loads the functions without collecting, for the offline test.
#>
[CmdletBinding()]
param([switch]$Define)

function Get-ArgHash([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return '' }
    $sha = [Security.Cryptography.SHA256]::Create()
    return -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s)) | ForEach-Object { $_.ToString('x2') })
}

# A task as facts. Arguments can carry a key or a password on a command line,
# so only their hash leaves the box; the program path does not carry secrets.
function ConvertTo-TaskFact($Task) {
    $act = @($Task.Actions)[0]
    [ordered]@{
        name     = [string]$Task.TaskName
        user     = [string]$Task.Principal.UserId
        runLevel = [string]$Task.Principal.RunLevel
        state    = [string]$Task.State
        triggers = @(@($Task.Triggers) | ForEach-Object { ([string]$_.CimClass.CimClassName) -replace '^MSFT_Task|Trigger$', '' })
        execute  = if ($act) { [string]$act.Execute } else { '' }
        argsSha256 = if ($act) { Get-ArgHash ([string]$act.Arguments) } else { '' }
    }
}

# A config file's meaning without its comments: drop blank lines and lines
# that are only a comment, trim line ends, hash what is left. Check-ProdParity
# uses the same function on the repository copy, so a comment header written
# in one place and not the other is not drift (#2165).
function Get-ConfigBodyHash([string]$Text) {
    $keep = @(($Text -split "\r?\n") | ForEach-Object { $_.TrimEnd() } | Where-Object { $_.Trim() -ne '' -and -not $_.TrimStart().StartsWith('#') })
    $sha = [Security.Cryptography.SHA256]::Create()
    return -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($keep -join "`n"))) | ForEach-Object { $_.ToString('x2') })
}

# Key names and value types only. A value never leaves this function.
function ConvertTo-SettingShape($Json) {
    $out = [ordered]@{}
    foreach ($p in $Json.PSObject.Properties) {
        $v = $p.Value
        $t = if ($null -eq $v) { 'null' } elseif ($v -is [bool]) { 'bool' } elseif ($v -is [string]) { if ($v.Length) { 'string' } else { 'empty' } }
             elseif ($v -is [ValueType]) { 'number' } elseif ($v -is [array]) { 'array' } else { 'object' }
        $out[$p.Name] = $t
    }
    return $out
}

function Get-ProdFacts {
    $ErrorActionPreference = 'SilentlyContinue'
    $procs = @{}; Get-Process | ForEach-Object { $procs[[int]$_.Id] = $_.ProcessName }
    $listen = @()
    Get-NetTCPConnection -State Listen | ForEach-Object { $listen += [ordered]@{ proto = 'tcp'; address = $_.LocalAddress; port = [int]$_.LocalPort; process = $procs[[int]$_.OwningProcess] } }
    Get-NetUDPEndpoint | ForEach-Object { $listen += [ordered]@{ proto = 'udp'; address = $_.LocalAddress; port = [int]$_.LocalPort; process = $procs[[int]$_.OwningProcess] } }
    $tasks = @(Get-ScheduledTask | Where-Object TaskName -like 'Thornswood*' | ForEach-Object { ConvertTo-TaskFact $_ })
    $svcs = @(Get-CimInstance Win32_Service | Where-Object { $_.Name -match '^(sshd|ThornswoodBot|actions\.runner\..*)$' } |
              ForEach-Object { [ordered]@{ name = $_.Name; account = $_.StartName; startMode = $_.StartMode; state = $_.State } })
    $files = [ordered]@{}
    foreach ($f in 'C:\Thornswood-Caddy\Caddyfile', 'C:\Thornswood-Docs\server.js', 'C:\Thornswood-Voice\voice-server.js', 'C:\Thornswood-Voice-Dev\voice-server.js') {
        $files[$f] = if (Test-Path -LiteralPath $f) { (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower() } else { '' }
    }
    # The site's modules (#5357), every one there, so one the repository
    # does not have shows as well as one that differs.
    foreach ($f in @(Get-ChildItem -LiteralPath 'C:\Thornswood-Docs\lib' -Filter *.js -File)) {
        $files[$f.FullName] = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower()
    }
    $fileBodies = [ordered]@{}
    foreach ($f in 'C:\Thornswood-Caddy\Caddyfile') {
        $fileBodies[$f] = if (Test-Path -LiteralPath $f) { Get-ConfigBodyHash (Get-Content -LiteralPath $f -Raw) } else { '' }
    }
    $certs = @()
    foreach ($root in "$env:SystemRoot\System32\config\systemprofile\AppData\Roaming\Caddy\certificates", 'C:\Thornswood-Caddy\data\caddy\certificates') {
        Get-ChildItem -LiteralPath $root -Recurse -Filter *.crt | ForEach-Object {
            try { $c = New-Object Security.Cryptography.X509Certificates.X509Certificate2 $_.FullName
                  $certs += [ordered]@{ subject = $c.Subject; notAfterUtc = $c.NotAfter.ToUniversalTime().ToString('o') } } catch { }
        }
    }
    $versions = [ordered]@{}
    foreach ($n in 'node', 'caddy', 'python', 'sshd') {
        $cmd = Get-Command "$n.exe" | Select-Object -First 1
        if (-not $cmd -and $n -eq 'caddy') { $cmd = Get-Item 'C:\Thornswood-Caddy\caddy.exe' }
        $versions[$n] = if ($cmd) { [string](Get-Item $(if ($cmd.Source) { $cmd.Source } else { $cmd.FullName })).VersionInfo.ProductVersion } else { '' }
    }
    $settings = [ordered]@{}
    foreach ($f in 'C:\Thornswood-Docs\config.json', 'C:\Thornswood-Server\server-settings.json', 'C:\Thornswood-Server-Dev\server-settings.json') {
        $settings[$f] = if (Test-Path -LiteralPath $f) { try { ConvertTo-SettingShape (Get-Content -LiteralPath $f -Raw | ConvertFrom-Json) } catch { 'unreadable' } } else { 'missing' }
    }
    # As the firewall takes them (#3896): from the box's own policy once
    # Set-InboundRules.ps1 -Own has it ignore local rules.
    $inbound = @()
    foreach ($fw in @(Get-NetFirewallRule -PolicyStore ActiveStore -Direction Inbound -Enabled True -Action Allow)) {
        $pf = $fw | Get-NetFirewallPortFilter
        $af = $fw | Get-NetFirewallAddressFilter
        $inbound += [ordered]@{ name = [string]$fw.Name; displayName = [string]$fw.DisplayName; protocol = [string]$pf.Protocol
                                ports = @(@($pf.LocalPort) | ForEach-Object { [string]$_ }); remote = @(@($af.RemoteAddress) | ForEach-Object { [string]$_ }) }
    }
    $fwProfiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object { [ordered]@{ name = [string]$_.Name; allowLocalRules = [string]$_.AllowLocalFirewallRules } })
    $edgeKey = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Edge' -ErrorAction SilentlyContinue
    $edge = if ($edgeKey) { [string]$edgeKey.DisplayVersion } else { '' }
    # Whether the Edge updater is told never to install Edge (vps-harden.ps1, #3896).
    $edgePol = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Policies\Microsoft\EdgeUpdate' -Name 'Install{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}' -ErrorAction SilentlyContinue
    $edgeBlocked = ($null -ne $edgePol -and [string]$edgePol.'Install{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}' -eq '0')
    $envNames = @([Environment]::GetEnvironmentVariables('Machine').Keys | Where-Object { $_ -like 'THORNSWOOD_*' } | Sort-Object)
    [ordered]@{
        takenUtc = (Get-Date).ToUniversalTime().ToString('o'); host = $env:COMPUTERNAME
        listeners = $listen; tasks = $tasks; services = $svcs; files = $files; fileBodies = $fileBodies
        certs = $certs; versions = $versions; settings = $settings; machineEnvNames = $envNames; inboundRules = $inbound
        firewallProfiles = $fwProfiles; edgeVersion = $edge; edgeInstallBlocked = $edgeBlocked
    }
}

if (-not $Define) { Get-ProdFacts | ConvertTo-Json -Depth 6 -Compress }
