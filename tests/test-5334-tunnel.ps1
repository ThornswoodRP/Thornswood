<#
  test-5334-tunnel.ps1

  scripts\deploy\Install-Tunnel.ps1 puts the site behind a Cloudflare Tunnel
  (#5334): it makes the tunnel and its routes from
  records\cloudflare-tunnel.json, installs cloudflared on the box with the
  tunnel's token in a file, and moves thornswood.net and www onto the tunnel
  and back. Neither the API token nor the tunnel's token may ever be in
  anything a session, GitHub or a log holds.

  HOW. NEVER CONNECTS. Six parts.
    1. The record. The shipped one passes the script's own check, and a
       record that sends a route anywhere but Caddy on 127.0.0.1:443, names
       a cloudflared from anywhere but its own release, or lists other names
       for DNS than it routes stops the run before anything is sent.
    2. The workflow's half, -SealOnGitHub, run as tunnel.yml's seal job runs
       it: it hands only the sealed token to the next job, as the step output
       sealed, and with no token it stops and says so.
    3. A -Sealed run, from end to end, with ssh and scp as functions here; a
       run with the box's ssh and no -Sealed is refused, since the token
       reaches the box only through tunnel.yml. ssh runs each box script it
       is handed in this PowerShell against
       scratch folders, with Cloudflare's API, the download, the task
       cmdlets and cloudflared's own answers replaced by stand-ins. The
       stand-in for Cloudflare answers only the API token. It checks: the
       tunnel is made once, with the record's routes, and read back; the
       tunnel's token is written to token.txt; the recorded cloudflared is
       checked by SHA-256 and one that does not match is refused; the task
       runs cloudflared with --token-file, never --token, and starts it when
       the box's network connects, not at boot (#5779); the install holds
       the tunnel while it has it stopped and takes the hold away on every
       way out; a second run with nothing changed restarts nothing; a task
       started at boot is changed in place, with nothing restarted, even
       while the names are on the tunnel.
    4. -Switch and -Back: the two A records become proxied CNAMEs at the
       tunnel only once cloudflared carries requests to both names, and are
       put back when it does not; -Back makes them proxied A records at the
       box again; a name that is neither stops it with DNS unchanged; a
       restart while the names are on the tunnel is refused.
    5. The gate's halves (#2841): -SealKey prints only the public key,
       -Sealed runs with what the workflow sealed and starts no workflow, and
       -ThroughGate starts one run of the Ops tunnel.yml with the mode and a
       key of its own for the output, and no seal key. gh plays that run as
       its three jobs do, against a stand-in Box-Run.ps1 that checks each
       line with the gate's own GateRules.ps1 and verbs.json: the gate gets
       'Install-Tunnel -SealKey', then the sealed token with the mode, under
       600 characters, and what the box printed comes back sealed to the
       caller's key; -Status is one line and -Remove is never sent.
    6. Afterwards every command line, script and input handed to gh, ssh and
       scp, and everything printed, is searched for both tokens, plain and
       base64.

    pwsh -File tests\test-5334-tunnel.ps1
#>
[CmdletBinding()]
param()
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Script = Join-Path $Root 'scripts\deploy\Install-Tunnel.ps1'
$Shipped = Join-Path $Root 'records\cloudflare-tunnel.json'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

. (Join-Path $Root 'scripts\vps\Seal.ps1')
. (Join-Path $Root 'scripts\vps\Vps.ps1')
. (Join-Path $Root 'scripts\ops\Sealed.ps1')
# vps.json's name, whose DNS-only A record is the box's address. It is not
# written here either (test-vps-defaults).
$boxName = [string](Get-ThornswoodVpsAddress)
. (Join-Path $PSScriptRoot 'Windows.ps1')
$thisShell = (Get-Process -Id $PID).Path
$boxShell = Get-BoxPowerShell

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-5334-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$noMark = New-Object Text.UTF8Encoding($false)

# A box script as the box would run it, with its folders moved to scratch.
# Off Windows a folder's ACL is not Windows', so both locks are stand-ins
# there. cloudflared's answers and the site's (Get-Plain) are always the
# stand-in's, so the real one is renamed out of the way.
function Fit([string]$t) {
    # The watchdog's folder too, where the install's hold goes (#5779): on the
    # box's own runner the real one is there, and a harness never holds it.
    $t = $t.Replace('C:\Thornswood-Seal', $sealDir).Replace('C:\Thornswood-Tunnel', $tunnelDir).Replace('C:\Thornswood-Watch', $watchDir)
    $t = $t.Replace('function Get-Plain(', 'function Get-Plain-Real(')
    if (-not $OnWindows) {
        $t = $t.Replace('function Lock-ThornswoodSealFolder(', 'function Lock-ThornswoodSealFolder-OnWindows(')
        $t = $t.Replace('function Lock-TunnelFolder(', 'function Lock-TunnelFolder-OnWindows(')
    }
    return $stubs + $t
}
# From a file, as Invoke-ThornswoodRemote sends a long script: the install
# script with the stand-ins is past Windows' 32,767-character command line
# as an -EncodedCommand (measured on the gate harness runner, 1 Nov).
function Run-Box([string]$t, [string]$stdin = '') {
    $f = Join-Path $work ('box-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, $t, (New-Object Text.UTF8Encoding($true)))
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $boxShell
    $psi.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $f + '"'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($psi)
    $p.StandardInput.Write($stdin)
    $p.StandardInput.Close()
    $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
    return @($out -split "`r?`n" | Where-Object { $_ -ne '' })
}

# The box's stand-ins. Cloudflare keeps its state in one JSON file and
# answers only the API token. Functions win over cmdlets of the same name.
$stubs = @'
function Lock-ThornswoodSealFolder([string]$dir) { }
function Lock-TunnelFolder([string]$dir) { }
function Read-Cf { [IO.File]::ReadAllText($env:TW_CF) | ConvertFrom-Json }
function Save-Cf($s) { [IO.File]::WriteAllText($env:TW_CF, (ConvertTo-Json -InputObject $s -Depth 12)) }
function Invoke-RestMethod {
    param($Method = 'GET', $Uri, $Headers, [switch]$UseBasicParsing, $TimeoutSec, $ContentType, $Body)
    [IO.File]::AppendAllText($env:TW_ASKED, $Method + ' ' + $Uri + "`n")
    if (-not $Headers -or $Headers['Authorization'] -cne ('Bearer ' + $env:TW_WANT)) { $e = New-Object Exception 'STUB 403'; throw $e }
    $s = Read-Cf
    $path = ($Uri -replace '^https://api\.cloudflare\.com/client/v4/', '') -replace '\?.*$', ''
    $q = if ($Uri -match '\?(.*)$') { $Matches[1] } else { '' }
    $b = if ($Body) { [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json } else { $null }
    $ok = { param($r) [pscustomobject]@{ success = $true; errors = @(); result = $r } }
    if ($Method -eq 'GET' -and $path -match '^accounts/[0-9a-f]+/cfd_tunnel$') {
        $n = [uri]::UnescapeDataString([string](@($q -split '&' | Where-Object { $_ -like 'name=*' }) -replace '^name=', ''))
        return (& $ok @(@($s.tunnels) | Where-Object { $_ -and $_.name -eq $n }))
    }
    if ($Method -eq 'POST' -and $path -match '^accounts/[0-9a-f]+/cfd_tunnel$') {
        $t = [pscustomobject]@{ id = '11111111-2222-3333-4444-555555555555'; name = $b.name; remote_config = ($b.config_src -eq 'cloudflare'); status = 'inactive' }
        $s.tunnels = @(@($s.tunnels) | Where-Object { $_ }) + @($t); $s.made++; Save-Cf $s
        return (& $ok $t)
    }
    if ($path -match '^accounts/[0-9a-f]+/cfd_tunnel/([0-9a-f-]+)/configurations$') {
        if ($Method -eq 'PUT') { $s.config = $b.config; $s.puts++; Save-Cf $s; return (& $ok ([pscustomobject]@{ tunnel_id = $Matches[1] })) }
        return (& $ok ([pscustomobject]@{ config = $s.config }))
    }
    if ($Method -eq 'GET' -and $path -match '^accounts/[0-9a-f]+/cfd_tunnel/[0-9a-f-]+/token$') { return (& $ok $env:TW_RUN) }
    if ($Method -eq 'GET' -and $path -match '^accounts/[0-9a-f]+/cfd_tunnel/[0-9a-f-]+$') { return (& $ok ([pscustomobject]@{ id = $s.tunnels[0].id; status = $env:TW_HEALTH })) }
    if ($Method -eq 'GET' -and $path -match '^zones/[0-9a-f]+/dns_records$') {
        $n = [uri]::UnescapeDataString([string](@($q -split '&' | Where-Object { $_ -like 'name=*' }) -replace '^name=', ''))
        return (& $ok @(@($s.dns) | Where-Object { $_.name -eq $n }))
    }
    if ($Method -eq 'PATCH' -and $path -match '^zones/[0-9a-f]+/dns_records/(\S+)$') {
        $id = $Matches[1]
        if ($env:TW_PATCH_FAILS -and $id -eq $env:TW_PATCH_FAILS) { throw (New-Object Exception 'STUB 400') }
        foreach ($r in @($s.dns)) { if ($r.id -eq $id) { $r.type = $b.type; $r.content = $b.content; $r.proxied = $b.proxied } }
        Save-Cf $s
        return (& $ok ([pscustomobject]@{ id = $id }))
    }
    throw (New-Object Exception ('STUB no such call ' + $Method + ' ' + $path))
}
# cloudflared's /ready and /metrics, and the names: a request to a name
# counts as carried by the tunnel only while its record is the tunnel's
# CNAME and cloudflared is said to carry it (TW_CARRY).
function Get-Plain([string]$Url, [int]$Seconds = 5) {
    if ($Url -like 'http://127.0.0.1:*/ready') { return @{ Code = [int]$env:TW_READY; Body = '' } }
    if ($Url -like 'http://127.0.0.1:*/metrics') {
        $c = [int]([IO.File]::ReadAllText($env:TW_COUNT))
        return @{ Code = 200; Body = ("# HELP x`ncloudflared_tunnel_ha_connections 4`ncloudflared_tunnel_total_requests " + $c + "`n") }
    }
    $s = Read-Cf
    $h = ([uri]$Url).Host
    $r = @($s.dns) | Where-Object { $_.name -eq $h } | Select-Object -First 1
    if ($r -and $r.type -eq 'CNAME' -and $env:TW_CARRY -eq '1') {
        [IO.File]::WriteAllText($env:TW_COUNT, [string]([int]([IO.File]::ReadAllText($env:TW_COUNT)) + 1))
    }
    return @{ Code = 200; Body = 'site' }
}
function Invoke-WebRequest { param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec) [IO.File]::AppendAllText($env:TW_ASKED, 'DOWNLOAD ' + $Uri + "`n"); [IO.File]::WriteAllBytes($OutFile, [Convert]::FromBase64String($env:TW_EXE)) }
function Read-Task { if (Test-Path -LiteralPath $env:TW_TASK) { [IO.File]::ReadAllText($env:TW_TASK) | ConvertFrom-Json } else { $null } }
function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) [pscustomobject]@{ Execute = $Execute; Arguments = $Argument } }
function New-ScheduledTaskSettingsSet { [pscustomobject]@{} }
function New-ScheduledTaskTrigger { [pscustomobject]@{} }
function New-ScheduledTaskPrincipal { param($UserId) [pscustomobject]@{ UserId = $UserId } }
function Register-ScheduledTask { param($TaskName, $Action, $Trigger, $Settings, $Principal) [IO.File]::WriteAllText($env:TW_TASK, (ConvertTo-Json -Depth 5 -InputObject ([pscustomobject]@{ Actions = @($Action); Principal = $Principal; Triggers = @($Trigger); Settings = $Settings; State = 'Ready' }))); [IO.File]::AppendAllText($env:TW_ASKED, "REGISTER`n") }
function Set-ScheduledTask { param([Parameter(ValueFromPipeline = $true)]$InputObject) process { [IO.File]::WriteAllText($env:TW_TASK, (ConvertTo-Json -Depth 5 -InputObject $InputObject)); [IO.File]::AppendAllText($env:TW_ASKED, "SET`n") } }
# The event trigger (#5779), and the NetworkProfile log it reads, on or off
# as TW_NETLOG says; turning it on is said in asked.txt.
function Get-CimClass { param($ClassName, $Namespace) [pscustomobject]@{ CimClassName = $ClassName } }
function New-CimInstance { param($CimClass, [switch]$ClientOnly) [pscustomobject]@{ Subscription = ''; Enabled = $false } }
function Get-WinEvent {
    param($ListLog, $ErrorAction)
    $o = [pscustomobject]@{ LogName = $ListLog; IsEnabled = ($env:TW_NETLOG -eq '1') }
    $o | Add-Member -MemberType ScriptMethod -Name SaveChanges -Value { if ($this.IsEnabled) { $env:TW_NETLOG = '1'; [IO.File]::AppendAllText($env:TW_ASKED, 'LOG ON ' + $this.LogName + "`n") } }
    $o
}
function Get-ScheduledTask { param($TaskName) Read-Task }
function Get-ScheduledTaskInfo { [pscustomobject]@{ LastRunTime = 'then'; LastTaskResult = 0 } }
function Unregister-ScheduledTask { param($TaskName) Remove-Item -LiteralPath $env:TW_TASK -Force -ErrorAction SilentlyContinue }
function Start-ScheduledTask { param($TaskName) [IO.File]::AppendAllText($env:TW_ASKED, "START`n") }
function Stop-ScheduledTask { param($TaskName) [IO.File]::AppendAllText($env:TW_ASKED, "STOP`n") }
function Get-Process { }
function Start-Sleep { }

'@

try {
    # ---- 1. the record --------------------------------------------------------
    $rec = [IO.File]::ReadAllText($Shipped) | ConvertFrom-Json
    Yes 'the shipped record routes both names to Caddy on 127.0.0.1:443 with each name''s certificate, then 404' (
        (@($rec.ingress | ForEach-Object { [string]$_.hostname + '>' + [string]$_.service + '>' + [string]$_.originRequest.originServerName }) -join ' ') -eq
        'thornswood.net>https://127.0.0.1:443>thornswood.net www.thornswood.net>https://127.0.0.1:443>www.thornswood.net >http_status:404>')
    Yes '  and names cloudflared from its own release, by SHA-256' ([string]$rec.cloudflared.url -eq ('https://github.com/cloudflare/cloudflared/releases/download/' + $rec.cloudflared.version + '/cloudflared-windows-amd64.exe') -and [string]$rec.cloudflared.sha256 -match '^[0-9a-f]{64}$')
    Yes '  and is the account and zone Set-Turnstile.ps1 and the connector use' ($rec.account -eq 'c7738b46d6dea435f5228b00b6198706' -and $rec.zone -eq 'd2b885b1adae2d20ec1a00300e06d827')
    $recText = [IO.File]::ReadAllText($Shipped)
    Yes '  and holds no token' ($recText -notmatch 'eyJ[A-Za-z0-9_-]{10}' -and $recText -notmatch '(?i)"(token|secret)"\s*:')
    Yes '  and no address of the box''s, nor its name: both come from vps.json and Cloudflare' (($recText -replace '127\.0\.0\.1', '') -notmatch '\b\d{1,3}(\.\d{1,3}){3}\b' -and -not $rec.PSObject.Properties['box'] -and -not $recText.Contains($boxName))
    function Bad([string]$name, [scriptblock]$change) {
        $r = [IO.File]::ReadAllText($Shipped) | ConvertFrom-Json
        & $change $r
        $p = Join-Path $work ($name + '.json')
        [IO.File]::WriteAllText($p, (ConvertTo-Json -InputObject $r -Depth 10), $noMark)
        return @(& $Script -Status -NoPause -RecordPath $p -Vps 'nowhere.invalid' -User 'nobody' *>&1 | ForEach-Object { [string]$_ }) -join ' '
    }
    function ssh { $global:sshTouched = $true; $global:LASTEXITCODE = 0 }
    $global:sshTouched = $false
    $o = Bad 'elsewhere' { param($r) $r.ingress[0].service = 'http://127.0.0.1:3001' }
    Yes 'a route to anything but Caddy on 127.0.0.1:443 stops it before anything is sent' ($o -match 'STOP\. a route goes somewhere but Caddy' -and -not $global:sshTouched)
    $o = Bad 'mirror' { param($r) $r.cloudflared.url = 'https://example.invalid/cloudflared.exe' }
    Yes 'a cloudflared from anywhere but its own release stops it' ($o -match 'STOP\. the record''s cloudflared does not come from its own release' -and -not $global:sshTouched)
    $o = Bad 'names' { param($r) $r.dns = @($r.dns[0]) }
    Yes 'DNS names that are not the routed names stop it' ($o -match 'STOP\. the DNS names and the routed names are not the same list' -and -not $global:sshTouched)
    $o = Bad 'other' { param($r) $r.ingress[1].hostname = 'evil.example'; $r.dns[1].name = 'evil.example' }
    Yes 'a name that is not thornswood.net''s stops it' ($o -match 'STOP\. a route is for a name that is not thornswood\.net' -and -not $global:sshTouched)
    $o = Bad 'metrics' { param($r) $r.metrics = '0.0.0.0:20241' }
    Yes 'cloudflared''s metrics anywhere but loopback stop it' ($o -match 'STOP\. cloudflared''s metrics must listen on loopback only' -and -not $global:sshTouched)
    Remove-Item Function:\ssh

    # ---- 2. the workflow's half ----------------------------------------------
    $sealDir = Join-Path $work 'seal'
    $tunnelDir = Join-Path $work 'tunnel'
    $watchDir = Join-Path $work 'watch'
    New-Item -ItemType Directory -Force -Path $watchDir | Out-Null
    $keyScript = "`$ErrorActionPreference = 'Stop'`r`n" + (Get-ThornswoodSealLockFunction) + "`r`n" + (Get-ThornswoodSealKeyBlock)
    $pub = (@(Run-Box (Fit $keyScript)) | Where-Object { $_ -like 'SEAL KEY *' } | Select-Object -Last 1)
    Yes 'the box''s seal key is made in scratch' ([bool]$pub)
    if (-not $pub) { Done }
    $publicKey = $pub.Substring('SEAL KEY '.Length)
    function Run-Seal([string]$token, [string]$key) {
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $thisShell
        $psi.Arguments = '-NoProfile -NonInteractive -File "' + $Script + '" -SealOnGitHub'
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.Environment['GITHUB_ACTIONS'] = 'true'
        $psi.Environment['CLOUDFLARE_TUNNEL_API_TOKEN'] = $token
        $psi.Environment['SEAL_KEY'] = $key
        $ghOut = Join-Path $work ('output-' + [Guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText($ghOut, '')
        $psi.Environment['GITHUB_OUTPUT'] = $ghOut
        $p = [Diagnostics.Process]::Start($psi)
        $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
        $p.WaitForExit()
        $given = [IO.File]::ReadAllText($ghOut)
        Remove-Item -LiteralPath $ghOut -Force
        $sm = [regex]::Match($given, '(?m)^sealed=([A-Za-z0-9+/=]+)$')
        return @{ Out = $out; Code = $p.ExitCode; Given = $given; Sealed = $(if ($sm.Success) { $sm.Groups[1].Value } else { '' }) }
    }
    $apiToken = 'cf-tunnel-harness-' + [Guid]::NewGuid().ToString('N')
    $r = Run-Seal $apiToken $publicKey
    Yes '-SealOnGitHub hands the sealed token to the next job as the step output sealed, and to nothing else' ($r.Code -eq 0 -and $r.Sealed -match '^[A-Za-z0-9+/]{400,560}={0,2}$' -and $r.Out -notmatch '::notice' -and -not $r.Out.Contains($r.Sealed))
    Yes '  and the token is nowhere in what it printed or handed on' (-not ($r.Out + $r.Given).Contains($apiToken) -and -not ($r.Out + $r.Given).Contains([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($apiToken))))
    $sealedForBox = $r.Sealed
    $r = Run-Seal '' $publicKey
    Yes 'with no token it stops with an error titled Tunnel and seals nothing' ($r.Code -ne 0 -and $r.Out -match '::error title=Tunnel::CLOUDFLARE_TUNNEL_API_TOKEN is not' -and -not $r.Sealed)

    # ---- 3. a plain run ------------------------------------------------------
    $exeBytes = [Text.Encoding]::UTF8.GetBytes('not really cloudflared ' + [Guid]::NewGuid().ToString('N'))
    $sha = [Security.Cryptography.SHA256]::Create()
    $exeSha = (($sha.ComputeHash($exeBytes) | ForEach-Object { $_.ToString('x2') }) -join '')
    $sha.Dispose()
    $testRec = [IO.File]::ReadAllText($Shipped) | ConvertFrom-Json
    $testRec.cloudflared.sha256 = $exeSha
    $recPath = Join-Path $work 'record.json'
    [IO.File]::WriteAllText($recPath, (ConvertTo-Json -InputObject $testRec -Depth 10), $noMark)

    $runToken = 'eyJharness' + [Guid]::NewGuid().ToString('N')
    $env:TW_CF = Join-Path $work 'cf.json'
    $env:TW_ASKED = Join-Path $work 'asked.txt'
    $env:TW_COUNT = Join-Path $work 'count.txt'
    $env:TW_TASK = Join-Path $work 'task.json'
    $env:TW_EXE = [Convert]::ToBase64String($exeBytes)
    $env:TW_RUN = $runToken
    $env:TW_WANT = $apiToken
    $env:TW_READY = '200'
    $env:TW_NETLOG = '1'
    $env:TW_HEALTH = 'healthy'
    $env:TW_CARRY = '1'
    [IO.File]::WriteAllText($env:TW_COUNT, '0')
    $cf0 = [pscustomobject]@{ made = 0; puts = 0; tunnels = @(); config = $null; dns = @(
        [pscustomobject]@{ id = 'rec-apex'; name = 'thornswood.net'; type = 'A'; content = '203.0.113.23'; proxied = $true },
        [pscustomobject]@{ id = 'rec-www'; name = 'www.thornswood.net'; type = 'A'; content = '203.0.113.23'; proxied = $true },
        [pscustomobject]@{ id = 'rec-play'; name = $boxName; type = 'A'; content = '203.0.113.23'; proxied = $false }) }
    [IO.File]::WriteAllText($env:TW_CF, (ConvertTo-Json -InputObject $cf0 -Depth 12))

    $handed = New-Object System.Collections.ArrayList
    $state = @{ copied = $null; sealed = ''; log = @(); ended = '' }
    function ssh {
        $a = @($args | ForEach-Object { [string]$_ })
        [void]$handed.Add(($a -join ' '))
        $mm = [regex]::Match($a[-1], '-EncodedCommand (\S+)$')
        if (-not $mm.Success) { throw 'the fake ssh was handed no encoded command' }
        $t = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($mm.Groups[1].Value))
        [void]$handed.Add($t)
        if ($t -match 'thornswood-remote-[0-9a-f]{32}\.ps1' -and $null -ne $state.copied) { $t = $state.copied; $state.copied = $null }
        $in = @($input) -join "`n"
        [void]$handed.Add($in)
        foreach ($l in (Run-Box (Fit $t) $in)) { $l }
        $global:LASTEXITCODE = 0
    }
    function scp {
        $a = @($args | ForEach-Object { [string]$_ })
        [void]$handed.Add('scp ' + ($a -join ' '))
        $state.copied = [IO.File]::ReadAllText($a[-2])
        [void]$handed.Add($state.copied)
        $global:LASTEXITCODE = 0
    }
    # GitHub, playing one run of the Ops tunnel.yml as its three jobs do:
    # the gate's SealKey line (its key as the step output), the seal job,
    # then the gate's -Sealed line with the mode, whose output is sealed to
    # the caller's key in the last job's log. The gate is the stand-in
    # Box-Run.ps1 of part 5. Its line is built as tunnel.yml's last job
    # builds it; the Ops test-box-workflows.ps1 holds that step itself.
    $state.log = @()
    $state.ended = ''
    function gh {
        $a = @($args | ForEach-Object { [string]$_ })
        $in = @($input) -join "`n"
        [void]$handed.Add('gh ' + ($a -join ' ') + ' ' + $in)
        $global:LASTEXITCODE = 0
        $path = @($a | Where-Object { $_ -like 'repos/*' })[0]
        if ($path -like '*/actions/workflows/tunnel.yml/dispatches') {
            $body = $in | ConvertFrom-Json
            if ($body.ref -ne 'main') { $global:LASTEXITCODE = 1; return 'not main' }
            if ($body.inputs.PSObject.Properties['seal_key']) { $global:LASTEXITCODE = 1; return 'tunnel.yml takes no seal key' }
            $k1 = @(& $thisShell -NoProfile -File $fakeBoxRun -Line 'Install-Tunnel -SealKey' 2>&1 | ForEach-Object { "$_" })
            $km = [regex]::Match(($k1 -join "`n"), '(?m)^SEAL KEY (<RSAKeyValue>.*</RSAKeyValue>)$')
            $rr = Run-Seal $apiToken $(if ($km.Success) { $km.Groups[1].Value } else { '' })
            $state.sealed = $rr.Sealed
            $line = 'Install-Tunnel -Sealed ' + $rr.Sealed
            switch ([string]$body.inputs.mode) { 'install' { } 'switch' { $line += ' -Switch' } 'back' { $line += ' -Back' } default { $global:LASTEXITCODE = 1; return 'no such mode' } }
            if ([string]$body.inputs.wait) { $line += ' -Wait ' + [string]$body.inputs.wait }
            $said = @(& $thisShell -NoProfile -File $fakeBoxRun -Line $line 2>&1 | ForEach-Object { "$_" })
            $code = $LASTEXITCODE
            $o = Join-Path $work ('run-' + [Guid]::NewGuid().ToString('N'))
            [void](New-Item -ItemType Directory -Force -Path (Join-Path $o 'files'))
            [IO.File]::WriteAllText((Join-Path $o 'output.txt'), (($said -join "`n") + "`n"), $noMark)
            $sf = $o + '.sealed'
            [void](Save-ThornswoodSealed $o ([string]$body.inputs.recipient) $sf)
            $state.log = @(Write-ThornswoodSealedLog $sf 6>&1 | ForEach-Object { '2026-11-02T00:00:00.0000000Z ' + "$_" })
            $state.ended = 'ENDED ' + $code + ' Install-Tunnel main ' + ('0' * 40)
            return '{"workflow_run_id": 4343, "html_url": "https://github.invalid/run/4343"}'
        }
        if ($path -like '*/dispatches') { $global:LASTEXITCODE = 1; return "gh: Not Found (HTTP 404) for $path" }
        if ($path -like '*/actions/runs/4343') { return '{"status": "completed", "conclusion": "success", "path": ".github/workflows/tunnel.yml", "html_url": "https://github.invalid/run/4343"}' }
        if ($path -like '*/actions/runs/4343/jobs') { if (($a -join ' ') -match '--jq') { return @('81', '82', '83') }; return '{"jobs": [{"id": 81}, {"id": 82}, {"id": 83}]}' }
        if ($path -like '*/check-runs/81/annotations') { return (ConvertTo-Json -Compress -InputObject @(@{ title = 'Tunnel key'; annotation_level = 'notice'; message = 'ENDED 0 Install-Tunnel' })) }
        if ($path -like '*/check-runs/82/annotations') { return '[]' }
        if ($path -like '*/check-runs/83/annotations') { return (ConvertTo-Json -Compress -InputObject @(@{ title = 'Box-Run'; annotation_level = 'notice'; message = $state.ended })) }
        if ($path -like '*/actions/jobs/83/logs') { return $state.log }
        if ($path -like '*/actions/jobs/*/logs') { return @('2026-11-02T00:00:00.0000000Z nothing sealed in this job') }
        $global:LASTEXITCODE = 1
        return "gh: Not Found (HTTP 404)"
    }
    function Tunnel([string]$mode = '') {
        $more = @{}
        if ($mode) { $more[$mode] = $true }
        if (@('Status', 'Remove', 'SealKey', 'Bare') -notcontains $mode) { $more['Sealed'] = $sealedForBox }
        if ($mode -eq 'Bare') { $more.Remove('Bare') }
        $said = @(& $Script @more -NoPause -AsSystem -Wait 5 -RecordPath $recPath -Vps 'nowhere.invalid' -User 'nobody' *>&1 | ForEach-Object { [string]$_ })
        $script:printed += $said
        return ($said -join ' | ')
    }
    function Cf { [IO.File]::ReadAllText($env:TW_CF) | ConvertFrom-Json }
    function Asked { if (Test-Path -LiteralPath $env:TW_ASKED) { [IO.File]::ReadAllText($env:TW_ASKED) } else { '' } }
    $script:printed = @()

    $all = Tunnel 'Bare'
    Yes 'a run with the box''s ssh and no -Sealed is refused before anything is sent: the token comes only through tunnel.yml' ($all -match 'only through the tunnel workflow' -and $handed.Count -eq 0)
    $all = Tunnel
    $cf = Cf
    Yes 'a -Sealed run makes the tunnel once, managed at Cloudflare' ($all -match 'TUNNEL OK' -and $cf.made -eq 1 -and $cf.tunnels[0].remote_config -eq $true -and $cf.tunnels[0].name -eq 'thornswood-box')
    if ($all -notmatch 'TUNNEL OK') { Write-Host ('      it said: ' + $all) }
    Yes '  writes the record''s routes and reads them back' ($cf.puts -eq 1 -and (@($cf.config.ingress | ForEach-Object { [string]$_.hostname + '>' + [string]$_.service }) -join ' ') -eq 'thornswood.net>https://127.0.0.1:443 www.thornswood.net>https://127.0.0.1:443 >http_status:404')
    $tf = Join-Path $tunnelDir 'token.txt'
    Yes '  writes the tunnel''s token to token.txt, and nothing else there' ((Test-Path -LiteralPath $tf) -and [IO.File]::ReadAllText($tf) -ceq $runToken)
    Yes '  downloads the recorded cloudflared and keeps it, hash checked' ((Asked) -match 'DOWNLOAD https://github\.com/cloudflare/cloudflared/releases/download/' -and (Test-Path -LiteralPath (Join-Path $tunnelDir 'cloudflared.exe')))
    $task = [IO.File]::ReadAllText($env:TW_TASK) | ConvertFrom-Json
    $arg = [string]@($task.Actions)[0].Arguments
    Yes '  and the task runs it with --token-file and no token on its command line' ($arg -match '--token-file "' -and $arg -notmatch '--token ' -and -not $arg.Contains($runToken) -and $arg -match '--no-autoupdate' -and $arg -match '--metrics 127\.0\.0\.1:20241')
    Yes '  and DNS is not touched' (@($cf.dns | Where-Object { $_.type -eq 'CNAME' }).Count -eq 0 -and (Asked) -notmatch 'PATCH')
    $trig = @($task.Triggers)
    Yes '  and the task starts it when the box''s network connects, not at boot (#5779)' (
        $trig.Count -eq 1 -and [string]$trig[0].Subscription -match 'Path="Microsoft-Windows-NetworkProfile/Operational"' -and [string]$trig[0].Subscription -match 'EventID=10000' -and $trig[0].Enabled)
    Yes '  and holds the tunnel while it has it stopped, and takes the hold away after' (
        $all -match 'held      Thornswood Tunnel until .* installing cloudflared' -and $all -match 'released  Thornswood Tunnel' -and
        @(Get-ChildItem -LiteralPath (Join-Path $watchDir 'holds') -File -ErrorAction SilentlyContinue).Count -eq 0)

    [IO.File]::WriteAllText($env:TW_ASKED, '')
    $all = Tunnel
    Yes 'a second run with nothing changed restarts nothing and makes no second tunnel' ($all -match 'nothing was restarted' -and $all -match 'TUNNEL OK' -and (Asked) -notmatch 'STOP|START|REGISTER|SET|DOWNLOAD' -and (Cf).made -eq 1)
    Yes '  and holds nothing, since it stops nothing' ($all -notmatch 'held      |released  ')

    # A task from before #5779, started at boot: only its trigger changes,
    # in place, and the cloudflared that runs is not touched.
    function Boot-Task { $tk = [IO.File]::ReadAllText($env:TW_TASK) | ConvertFrom-Json; $tk.Triggers = @([pscustomobject]@{ Enabled = $true }); [IO.File]::WriteAllText($env:TW_TASK, (ConvertTo-Json -Depth 5 -InputObject $tk)) }
    Boot-Task
    [IO.File]::WriteAllText($env:TW_ASKED, '')
    $all = Tunnel
    $trig = @(([IO.File]::ReadAllText($env:TW_TASK) | ConvertFrom-Json).Triggers)
    Yes 'a task started at boot is changed in place to start on the network connecting' (
        $all -match 'starts cloudflared when the box''s network connects' -and $all -match 'TUNNEL OK' -and (Asked) -match 'SET' -and
        $trig.Count -eq 1 -and [string]$trig[0].Subscription -match 'EventID=10000')
    Yes '  without stopping, starting or registering anything' ((Asked) -notmatch 'STOP|START|REGISTER|DOWNLOAD' -and $all -notmatch 'held      ')

    $env:TW_NETLOG = '0'
    [IO.File]::WriteAllText($env:TW_ASKED, '')
    $all = Tunnel
    Yes 'the NetworkProfile log off is turned on, since the trigger reads it' ($all -match 'turned on Microsoft-Windows-NetworkProfile/Operational' -and (Asked) -match 'LOG ON Microsoft-Windows-NetworkProfile/Operational' -and $all -match 'TUNNEL OK')
    $env:TW_NETLOG = '1'

    Remove-Item -LiteralPath (Join-Path $tunnelDir 'cloudflared.exe') -Force
    $env:TW_EXE = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('something else'))
    $all = Tunnel
    Yes 'a cloudflared whose SHA-256 is not the record''s is refused and not kept' ($all -match 'not the recorded' -and $all -match 'TUNNEL REFUSED' -and -not (Test-Path -LiteralPath (Join-Path $tunnelDir 'cloudflared.exe')))
    $env:TW_EXE = [Convert]::ToBase64String($exeBytes)

    $env:TW_READY = '503'
    $all = Tunnel
    Yes 'a cloudflared that does not connect is left to the watchdog, and the run says so' ($all -match 'did not connect within' -and $all -match 'TUNNEL NOT READY' -and $all -match 'STOP\.' -and $all -match 'left running and the watchdog watches it')
    Yes '  and its hold is taken away, so the watchdog judges it from the next run' ($all -match 'released  Thornswood Tunnel' -and @(Get-ChildItem -LiteralPath (Join-Path $watchDir 'holds') -File -ErrorAction SilentlyContinue).Count -eq 0)
    $env:TW_READY = '200'
    $all = Tunnel
    Yes '  and a run once it connects is OK again' ($all -match 'TUNNEL OK')

    $env:TW_WANT = 'some-other-token'
    $all = Tunnel
    Yes 'an API token Cloudflare refuses: it says so and changes nothing' ($all -match 'Cloudflare answered GET accounts/.*/cfd_tunnel with HTTP' -and $all -match 'TUNNEL REFUSED')
    $env:TW_WANT = $apiToken

    # ---- 4. -Switch and -Back --------------------------------------------------
    $env:TW_CARRY = '0'
    $all = Tunnel 'Switch'
    $cf = Cf
    Yes '-Switch puts both A records back when cloudflared carries nothing to them' ($all -match 'DNS NOT CHANGED' -and @($cf.dns | Where-Object { $_.name -ne $boxName -and $_.type -eq 'A' -and $_.proxied -and $_.content -eq '203.0.113.23' }).Count -eq 2 -and $all -match 'put back as it was')
    $env:TW_CARRY = '1'
    $env:TW_PATCH_FAILS = 'rec-www'
    $all = Tunnel 'Switch'
    Yes '  and puts the first back when the second cannot be changed' ($all -match 'COULD NOT CHANGE www\.thornswood\.net' -and @((Cf).dns | Where-Object { $_.type -eq 'CNAME' }).Count -eq 0)
    Remove-Item Env:\TW_PATCH_FAILS
    $all = Tunnel 'Switch'
    $cf = Cf
    $cname = $cf.tunnels[0].id + '.cfargotunnel.com'
    Yes '-Switch makes both names proxied CNAMEs at the tunnel once cloudflared carries them' ($all -match 'DNS SWITCHED' -and @($cf.dns | Where-Object { $_.type -eq 'CNAME' -and $_.content -eq $cname -and $_.proxied }).Count -eq 2)
    Yes '  and leaves the box''s own DNS-only name alone' (@($cf.dns | Where-Object { $_.name -eq $boxName -and $_.type -eq 'A' -and -not $_.proxied }).Count -eq 1)
    $all = Tunnel 'Switch'
    Yes '  and a second -Switch says it is already done' ($all -match 'is already on the tunnel' -and $all -match 'DNS ALREADY')
    Boot-Task
    [IO.File]::WriteAllText($env:TW_ASKED, '')
    $all = Tunnel
    Yes 'changing what starts the task goes ahead while the names are on the tunnel, since nothing restarts' ($all -match 'TUNNEL OK' -and (Asked) -match 'SET' -and (Asked) -notmatch 'STOP|START|REGISTER')

    Remove-Item -LiteralPath $tf -Force
    $all = Tunnel
    Yes 'a run that must restart cloudflared while the names are on the tunnel is refused' ($all -match 'Run -Back, run this again, then -Switch' -and $all -match 'TUNNEL REFUSED')
    $all = Tunnel 'Remove'
    Yes '-Remove while the names are on the tunnel is refused' ($all -match 'Run -Back first' -and (Test-Path -LiteralPath $tunnelDir))

    $all = Tunnel 'Back'
    $cf = Cf
    Yes '-Back makes both names proxied A records at the box again' ($all -match 'DNS BACK' -and @($cf.dns | Where-Object { $_.name -ne $boxName -and $_.type -eq 'A' -and $_.content -eq '203.0.113.23' -and $_.proxied }).Count -eq 2)

    $cf.dns[1].proxied = $false
    [IO.File]::WriteAllText($env:TW_CF, (ConvertTo-Json -InputObject $cf -Depth 12))
    $all = Tunnel 'Switch'
    Yes 'a name that is neither the box''s proxied A record nor the tunnel''s stops -Switch with DNS unchanged' ($all -match 'which is neither' -and $all -match 'DNS NOT CHANGED' -and @((Cf).dns | Where-Object { $_.type -eq 'CNAME' }).Count -eq 0)

    $cf = Cf
    $cf.dns[1].proxied = $true
    $cf.dns[2].proxied = $true
    [IO.File]::WriteAllText($env:TW_CF, (ConvertTo-Json -InputObject $cf -Depth 12))
    $all = Tunnel 'Switch'
    Yes 'a box name that is not one DNS-only A record stops -Switch, since the box''s address is not known' ($all -match 'is not one DNS-only A record' -and @((Cf).dns | Where-Object { $_.type -eq 'CNAME' }).Count -eq 0)
    $cf = Cf
    $cf.dns[2].proxied = $false
    [IO.File]::WriteAllText($env:TW_CF, (ConvertTo-Json -InputObject $cf -Depth 12))

    $asks = @($handed | Where-Object { $_ -match 'dispatches' }).Count
    $all = Tunnel 'Status'
    Yes '-Status reads without asking for the API token, and says only whether the token is there' ($all -match 'token +(there \(never shown\)|NOT THERE)' -and $all -match 'ready +yes' -and @($handed | Where-Object { $_ -match 'dispatches' }).Count -eq $asks)
    Yes '  and what starts the task' ($all -match 'starts +when the network connects \(Microsoft-Windows-NetworkProfile/Operational, event 10000\)')

    # ---- 5. the gate's halves --------------------------------------------------
    # What the gate runs on the box: -SealKey prints the public half only, and
    # -Sealed opens what tunnel.yml's seal job sealed, so no gh is needed there.
    $all = Tunnel 'SealKey'
    Yes '-SealKey prints the box''s public seal key and nothing private' ($all -match 'SEAL KEY <RSAKeyValue><Modulus>' -and $all -notmatch '<P>|<D>|<InverseQ>')
    $asks = @($handed | Where-Object { $_ -match 'dispatches' }).Count
    $sealedHere = (Run-Seal $apiToken $publicKey).Sealed
    $said = @(& $Script -Sealed $sealedHere -NoPause -AsSystem -Wait 5 -RecordPath $recPath -Vps 'nowhere.invalid' -User 'nobody' *>&1 | ForEach-Object { [string]$_ })
    $script:printed += $said
    Yes '-Sealed runs with the token the workflow sealed and starts no workflow itself' ((($said -join ' ') -match 'TUNNEL OK') -and @($handed | Where-Object { $_ -match 'dispatches' }).Count -eq $asks)

    # -ThroughGate hands the box only gate lines. A stand-in Box-Run.ps1 in a
    # copy of the scripts records each line and answers as the gate would.
    $tree = Join-Path $work 'tree'
    foreach ($d in 'scripts/deploy', 'scripts/vps/gate', 'scripts/ops', 'scripts/release') { [void](New-Item -ItemType Directory -Force -Path (Join-Path $tree $d)) }
    Copy-Item -LiteralPath $Script -Destination (Join-Path $tree 'scripts/deploy/Install-Tunnel.ps1')
    foreach ($f in 'scripts/vps/Seal.ps1', 'scripts/vps/Vps.ps1', 'scripts/vps/vps.json', 'scripts/ops/WorkflowRun.ps1', 'scripts/ops/Sealed.ps1', 'scripts/release/LogHandBack.ps1', 'scripts/vps/gate/GateRules.ps1', 'scripts/vps/gate/verbs.json') { Copy-Item -LiteralPath (Join-Path $Root $f) -Destination (Join-Path $tree $f) }
    # Its scratch folder is this test's own.
    $env:TW_SCRATCH = Join-Path $work 'scratch'
    [IO.File]::WriteAllText((Join-Path $tree 'scripts/release/Get-ScratchDir.ps1'), 'param([string]$Name) $d = Join-Path $env:TW_SCRATCH $Name; [void](New-Item -ItemType Directory -Force -Path $d); $d', $noMark)
    $env:TW_GATE = Join-Path $work 'gate.txt'
    $env:TW_PUB = $publicKey
    [IO.File]::WriteAllText((Join-Path $tree 'scripts/vps/Box-Run.ps1'), @'
param([string]$Line)
. (Join-Path $PSScriptRoot 'gate/GateRules.ps1')
[IO.File]::AppendAllText($env:TW_GATE, $Line + "`n")
$r = Test-ThornswoodGateRequest -Line $Line -Verbs (Read-ThornswoodGateVerbs)
if (-not $r.Ok) { 'REFUSED ' + $r.Why; exit 1 }
if ($Line -eq 'Install-Tunnel -SealKey') { 'SEAL KEY ' + $env:TW_PUB; exit 0 }
'the box ran it'; exit 0
'@, $noMark)
    $fakeBoxRun = Join-Path $tree 'scripts/vps/Box-Run.ps1'
    $gated = Join-Path $tree 'scripts/deploy/Install-Tunnel.ps1'
    function Gated([hashtable]$more) {
        if (Test-Path -LiteralPath $env:TW_GATE) { Remove-Item -LiteralPath $env:TW_GATE -Force }
        $said = @(& $gated @more -ThroughGate -NoPause -RecordPath $recPath *>&1 | ForEach-Object { [string]$_ })
        $script:printed += $said
        $lines = @(if (Test-Path -LiteralPath $env:TW_GATE) { [IO.File]::ReadAllLines($env:TW_GATE) })
        return @{ Said = ($said -join ' | '); Lines = $lines }
    }
    $before = $handed.Count
    $g = Gated @{ Switch = $true; Wait = 120 }
    $starts = @($handed | Select-Object -Skip $before | Where-Object { $_ -match 'dispatches' })
    Yes '-ThroughGate starts one run of the Ops tunnel.yml with the mode, the wait and a key for its output, and no seal key' ($starts.Count -eq 1 -and $starts[0] -match '^gh api -X POST repos/ThornswoodRP/Thornswood-Ops/actions/workflows/tunnel\.yml/dispatches ' -and $starts[0] -match '"mode":"switch"' -and $starts[0] -match '"wait":"120"' -and $starts[0] -match '"recipient":"[A-Za-z0-9+/=]{100,}"' -and $starts[0] -notmatch 'seal_key|RSAKeyValue')
    Yes '  the run asks the gate for the seal key, then hands it the sealed token with the mode' ($g.Lines.Count -eq 2 -and $g.Lines[0] -eq 'Install-Tunnel -SealKey' -and $g.Lines[1] -match '^Install-Tunnel -Sealed [A-Za-z0-9+/]{400,560}={0,2} -Switch -Wait 120$')
    Yes '  and the gate''s own rules take both lines, the longer under 600 characters' ($g.Lines.Count -eq 2 -and $g.Lines[1].Length -le 600 -and $g.Said -notmatch 'REFUSED')
    Yes '  and what the box printed comes back sealed to the caller''s key and is opened here' ($g.Said -match 'the box ran it' -and $g.Said -match 'ENDED 0 Install-Tunnel' -and $state.log.Count -ge 2 -and -not (($state.log -join ' ') -match 'the box ran it'))
    Yes '  and the sealed token is the seal job''s, opened only on the box' ($g.Lines.Count -eq 2 -and $state.sealed -and $g.Lines[1].Contains($state.sealed) -and -not $g.Lines[1].Contains($apiToken))
    $g = Gated @{}
    Yes '  a plain -ThroughGate run is the mode install, with no -Wait' ($g.Lines.Count -eq 2 -and $g.Lines[1] -match '^Install-Tunnel -Sealed [A-Za-z0-9+/]{400,560}={0,2}$')
    $asks = @($handed | Where-Object { $_ -match 'dispatches' }).Count
    $g = Gated @{ Status = $true }
    Yes '-ThroughGate -Status hands the gate one line and starts no workflow' ($g.Lines.Count -eq 1 -and $g.Lines[0] -eq 'Install-Tunnel -Status' -and @($handed | Where-Object { $_ -match 'dispatches' }).Count -eq $asks)
    $g = Gated @{ Remove = $true }
    Yes '-ThroughGate -Remove is refused before the gate is asked anything' ($g.Lines.Count -eq 0 -and $g.Said -match 'not gate words')
    Remove-Item Env:\TW_GATE, Env:\TW_PUB, Env:\TW_SCRATCH -ErrorAction SilentlyContinue

    # ---- 6. no token anywhere -------------------------------------------------
    $handedAll = ($handed -join "`n") + "`n" + ($script:printed -join "`n")
    $found = @()
    foreach ($v in @($apiToken, $runToken)) {
        foreach ($form in @($v, [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v)), [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($v)))) {
            if ($handedAll.Contains($form)) { $found += $form.Substring(0, 6) }
        }
    }
    Yes 'neither token is in anything handed to gh, ssh or scp, or printed, plain or base64' ($found.Count -eq 0)

    $all = Tunnel 'Remove'
    Yes '-Remove once the names are back takes the folder and the token off' ($all -match 'Gone from the box' -and -not (Test-Path -LiteralPath $tunnelDir))
} finally {
    foreach ($n in 'TW_CF', 'TW_ASKED', 'TW_COUNT', 'TW_TASK', 'TW_EXE', 'TW_RUN', 'TW_WANT', 'TW_READY', 'TW_HEALTH', 'TW_CARRY', 'TW_PATCH_FAILS') { Remove-Item ('Env:\' + $n) -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
