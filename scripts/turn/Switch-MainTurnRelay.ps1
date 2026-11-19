#Requires -Version 7
<# Add the already verified Main relay to the deployed Main voice service.
   Run locally on the VPS after protected deployment and public relay verification.
   Restore the previous task action and absence of a TURN key on failure. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Inspect','Switch','Rollback')][string]$Step,
    [Parameter(Mandatory)][string]$RelayIPv4,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedMainCommit,
    [string]$ReceiptDirectory
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'PionHost.ps1')
. (Join-Path $PSScriptRoot 'PionPolicy.ps1')
. (Join-Path $repo 'scripts/deploy/ServiceAccount.ps1')
. (Join-Path $repo 'scripts/vps/ServerHold.ps1')
$policy = Get-Content -LiteralPath (Join-Path $repo 'records/turn/relay-policy.json') -Raw | ConvertFrom-Json
$relayRoot = Join-Path $env:SystemDrive 'Thornswood-Turn-Main'
$relayKey = Join-Path $relayRoot 'private/shared-key.txt'
$config = Get-PionConfiguration $policy main $RelayIPv4 $relayKey
$relayUrl = 'turn:' + $RelayIPv4 + ':' + $config.listenPort + '?transport=udp'
$voiceRoot = Join-Path $env:SystemDrive 'Thornswood-Voice'
$voiceKey = Join-Path $voiceRoot 'turn-key.txt'
$taskName = 'Thornswood Voice'
$taskSid = Get-ThornswoodTaskSidFromName $taskName
$owner = Get-PionOwnerIdentity
$holdBy = (Get-ThornswoodHoldBy -Script 'Switch-MainTurnRelay.ps1') + ' ' + [guid]::NewGuid().ToString('n')
$settingsRoot = Join-Path $relayRoot 'rollback'
$base = 'http://127.0.0.1:7778'
$portSetting = 'set THORNSWOOD_VOICE_PORT=7778&& '

function Get-MainVoiceTask {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    Assert-PionTaskPrincipal $task
    $action = @($task.Actions)[0]
    $currentOwner = Get-PionOwnerIdentity
    if (@($task.Actions).Count -ne 1 -or $currentOwner.sha256 -cne $owner.sha256 -or
        $action.Execute -ine $owner.path -or $action.WorkingDirectory -ine $voiceRoot -or
        !$action.Arguments.StartsWith($taskSid + ' "', [StringComparison]::Ordinal) -or
        $action.Arguments -match 'THORNSWOOD_TURN_(SECRET|PASS|USER|KEY_FILE)=' -or
        [regex]::Matches($action.Arguments, [regex]::Escape($portSetting)).Count -ne 1) {
        throw 'Main voice does not use the reviewed restricted task action.'
    }
    return $task
}

function Get-MainVoiceHealth {
    $status = Invoke-RestMethod -TimeoutSec 5 "$base/health"
    if (!$status.ok -or $status.auth -cne 'on' -or $status.bind -cne '127.0.0.1' -or $status.deploy.commit -cne $ExpectedMainCommit) {
        throw 'The running issuer does not match the protected Main deployment.'
    }
    return $status
}

function Assert-MainDrained {
    $status = Get-MainVoiceHealth
    if ($status.peers -or $status.people -or $status.tracked) { throw 'Main has active sessions. Wait for the maintenance window.' }
}

function Add-MainTurnSetting([string]$Arguments) {
    if ([regex]::Matches($Arguments, [regex]::Escape($portSetting)).Count -ne 1 -or
        $Arguments -match 'THORNSWOOD_TURN_URL=') { throw 'Main TURN requires exactly one voice port setting and no existing relay URL.' }
    return $Arguments.Replace($portSetting, $portSetting + 'set THORNSWOOD_TURN_URL=' + $relayUrl + '&& ')
}

function Get-DevVoiceIdentity {
    $status = Invoke-RestMethod -TimeoutSec 5 'http://127.0.0.1:7789/health'
    $listeners = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7789 -State Listen -ErrorAction Stop)
    if (!$status.ok -or $status.turn -cne 'ephemeral' -or $listeners.Count -ne 1) { throw 'Cannot establish the running Dev issuer baseline.' }
    $process = Get-Process -Id $listeners[0].OwningProcess -ErrorAction Stop
    return "$($status.deploy.commit)/$($process.Id)/$($process.StartTime.ToUniversalTime().Ticks)"
}

function Wait-MainVoiceStopped([int]$ProcessId) {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $running = (Get-ScheduledTask -TaskName $taskName).State -eq 'Running'
        $listening = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7778 -State Listen -ErrorAction SilentlyContinue).Count
        $oldAlive = $ProcessId -gt 0 -and [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
        if (!$running -and !$listening -and !$oldAlive) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Main voice termination could not be verified. The maintenance hold remains active.'
}

function Stop-MainVoice([switch]$Recovery) {
    $listeners = @(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7778 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 1 -or (!$Recovery -and $listeners.Count -ne 1)) { throw 'Main voice listener identity cannot be verified.' }
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    try { if (!$Recovery) { Assert-MainDrained } }
    catch { Enable-ScheduledTask -TaskName $taskName | Out-Null; throw }
    $script:stopIssued = $true
    $script:mainHealthy = $false
    $script:stoppingProcessId = if ($listeners.Count) { $listeners[0].OwningProcess } else { 0 }
    if ($listeners.Count -or (Get-ScheduledTask -TaskName $taskName).State -eq 'Running') {
        Stop-ScheduledTask -TaskName $taskName
    }
    Wait-MainVoiceStopped $script:stoppingProcessId
}

function Start-MainVoice($action) {
    $scheduled = New-ScheduledTaskAction -Execute $action.execute -Argument $action.arguments -WorkingDirectory $action.workingDirectory
    Set-ScheduledTask -TaskName $taskName -Action $scheduled | Out-Null
    $null = Get-MainVoiceTask
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    Start-ScheduledTask -TaskName $taskName
}

function Wait-MainIssuer([bool]$TurnEnabled) {
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    do {
        try {
            $status = Get-MainVoiceHealth
            $ice = Invoke-RestMethod -TimeoutSec 5 "$base/ice"
            $servers = @($ice.iceServers | Where-Object { @($_.urls | Where-Object { $_ -match '^turns?:' }).Count })
            if (!$TurnEnabled -and $status.turn -ceq 'none' -and !$servers.Count) { return }
            if ($TurnEnabled -and $status.turn -ceq 'ephemeral' -and $servers.Count -eq 1 -and @($servers[0].urls).Count -eq 1 -and @($servers[0].urls)[0] -ceq $relayUrl) {
                $expiry = [string]$servers[0].username
                $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                if ($expiry -cnotmatch '^[0-9]{10}$' -or [long]$expiry -le $now -or [long]$expiry -gt $now + 3660) { throw 'Unexpected relay credential lifetime.' }
                $key = [Text.Encoding]::ASCII.GetBytes([IO.File]::ReadAllText($voiceKey).Trim())
                try {
                    $proof = [Convert]::ToBase64String([Security.Cryptography.HMACSHA1]::HashData($key, [Text.Encoding]::ASCII.GetBytes($expiry)))
                    if ($proof -ceq $servers[0].credential) { return }
                } finally { [Array]::Clear($key,0,$key.Length) }
            }
        } catch {
            # During a scheduled restart either loopback request can fail before the listener is ready.
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Main issuer did not prove the expected authentication and relay state.'
}

function Restore-MainIssuer($receipt) {
    if (Test-Path -LiteralPath $voiceKey) {
        Assert-PionSecretAcl $voiceKey $taskSid
        if ((Get-FileHash -LiteralPath $voiceKey).Hash -cne $receipt.keyHash) { throw 'Main turn-key.txt has changed since this transaction.' }
        Remove-Item -LiteralPath $voiceKey
    }
    Start-MainVoice $receipt.original
    Wait-MainIssuer $false
}

$task = Get-MainVoiceTask
$health = Get-MainVoiceHealth
if ($Step -eq 'Inspect') {
    @{mainSource=$health.deploy.commit;turn=$health.turn;peers=$health.peers;people=$health.people;tracked=$health.tracked;keyExists=(Test-Path -LiteralPath $voiceKey)} | ConvertTo-Json -Compress
    return
}
Assert-PionCutover $RelayIPv4
Assert-MainDrained
$devIdentity = Get-DevVoiceIdentity
$receipt = $null
if ($Step -eq 'Switch') {
    if ($health.turn -cne 'none' -or (Test-Path -LiteralPath $voiceKey) -or $task.Actions[0].Arguments -match 'THORNSWOOD_TURN_URL=') { throw 'Expected Main voice with no prior TURN settings.' }
    $state = Get-Content -LiteralPath (Join-Path $relayRoot 'relay.json') -Raw | ConvertFrom-Json
    if ($state.role -cne 'main' -or $state.relayIPv4 -cne $RelayIPv4 -or !$state.lastActivationVerifiedUtc) { throw 'Main relay activation is unverified.' }
    Assert-PionInstalledFiles $relayRoot
    Assert-PionSecretAcl $relayKey $state.taskSid
    $endpoints = @(Get-NetUDPEndpoint -LocalAddress $RelayIPv4 -LocalPort $config.listenPort -ErrorAction Stop)
    if ($endpoints.Count -ne 1 -or (Get-Process -Id $endpoints[0].OwningProcess -ErrorAction Stop).Path -ine (Join-Path $relayRoot 'runtime/thornswood-turn.exe')) { throw 'Cannot verify the active Main relay.' }
    if (!(Test-Path -LiteralPath $settingsRoot)) { [void][IO.Directory]::CreateDirectory($settingsRoot); Set-PionDirectoryAcl $settingsRoot $state.taskSid }
    $ReceiptDirectory = Join-Path $settingsRoot ('attempt-' + [guid]::NewGuid().ToString('n'))
    [void][IO.Directory]::CreateDirectory($ReceiptDirectory)
    $action = $task.Actions[0]
    $receipt = @{source=$ExpectedMainCommit;sid=$taskSid;relay=$relayUrl;keyHash=(Get-FileHash -LiteralPath $relayKey).Hash;
        original=@{execute=$action.Execute;arguments=$action.Arguments;workingDirectory=$action.WorkingDirectory}}
    Write-PionProtectedFile (Join-Path $ReceiptDirectory 'receipt.json') ([Text.Encoding]::UTF8.GetBytes(($receipt | ConvertTo-Json -Depth 3 -Compress)))
} else {
    $absolute = [IO.Path]::GetFullPath($ReceiptDirectory)
    $entry = Get-Item -LiteralPath $absolute -ErrorAction Stop
    if (!$entry.PSIsContainer -or $entry.Parent.FullName -ine $settingsRoot -or $entry.Name -cnotmatch '^attempt-[a-f0-9]{32}$' -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Rollback requires the exact protected Main transaction receipt.' }
    $file = Join-Path $absolute 'receipt.json'
    Assert-PionSecretAcl $file
    $receipt = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($receipt.source -cne $ExpectedMainCommit -or $receipt.sid -cne $taskSid -or $receipt.relay -cne $relayUrl) { throw 'Main rollback receipt does not match this deployment.' }
}

$holdPath = Get-ThornswoodHoldFile -Target $taskName
if (Test-Path -LiteralPath $holdPath) { throw 'Main voice already has a maintenance hold.' }
$held = Set-ThornswoodHold -Target $taskName -Why 'switching the Main TURN issuer' -By $holdBy -Minutes 30
if ($held -notmatch '^held ') { throw 'Could not establish Main voice maintenance hold.' }
$script:stopIssued = $false
$script:mainHealthy = $true
$originalStopped = $false
try {
    Stop-MainVoice
    $originalStopped = $true
    if ($Step -eq 'Rollback') { Restore-MainIssuer $receipt }
    else {
        $bytes = [IO.File]::ReadAllBytes($relayKey)
        try {
            if ([Text.Encoding]::ASCII.GetString($bytes).Trim() -cnotmatch '^[a-f0-9]{64}$') { throw 'The Main relay key has an unexpected format.' }
            Write-PionProtectedFile $voiceKey $bytes $taskSid
        } finally { [Array]::Clear($bytes,0,$bytes.Length) }
        Assert-PionSecretAcl $voiceKey $taskSid
        $original = $receipt.original
        $arguments = Add-MainTurnSetting $original.arguments
        Start-MainVoice @{execute=$original.execute;arguments=$arguments;workingDirectory=$original.workingDirectory}
        Wait-MainIssuer $true
    }
    $script:mainHealthy = $true
} catch {
    if ($script:stopIssued -and !$originalStopped) {
        try { Wait-MainVoiceStopped $script:stoppingProcessId } catch {
            # No settings have been changed by a stop that never finished.
            # Re-enable that task in place without starting a second process.
            Enable-ScheduledTask -TaskName $taskName | Out-Null
            throw
        }
        Restore-MainIssuer $receipt
        $script:mainHealthy = $true
    } elseif ($originalStopped -and $Step -eq 'Switch') {
        Stop-MainVoice -Recovery
        Restore-MainIssuer $receipt
        $script:mainHealthy = $true
    }
    throw
} finally {
    if ($script:mainHealthy -and (Get-Content -LiteralPath $holdPath -Raw | ConvertFrom-Json).by -ceq $holdBy) {
        $released = Clear-ThornswoodHold -Target $taskName
        if ($released -notmatch '^released ') { throw 'Could not clear verified Main maintenance hold.' }
    }
}

if ((Get-DevVoiceIdentity) -cne $devIdentity) { throw 'Dev voice identity changed during Main maintenance. Verify the two live issuers.' }
@{mainSource=$ExpectedMainCommit;relayEnabled=($Step -eq 'Switch');devPreserved=$true;receiptDirectory=$ReceiptDirectory} | ConvertTo-Json -Compress
