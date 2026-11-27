# Runs the real installer against a stand-in transport and scheduler. No SSH,
# Windows tasks, passphrase, backups or ACLs are used by this check.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('test-4214-' + [guid]::NewGuid())
$pass = 0; $fail = 0
function Check($name, $condition, $output) {
    if ($condition) { Write-Host "PASS  $name"; $script:pass++ }
    else { Write-Host "FAIL  $name`n$output"; $script:fail++ }
}
try {
    $deploy = New-Item -ItemType Directory -Path (Join-Path $tmp deploy) -Force
    $vps = New-Item -ItemType Directory -Path (Join-Path $tmp vps) -Force
    Copy-Item (Join-Path $repo 'scripts/deploy/Install-Backup.ps1') $deploy
    # Install-Backup takes its scratch folder from release\Get-ScratchDir.ps1 (#4264).
    $release = New-Item -ItemType Directory -Path (Join-Path $tmp release) -Force
    Copy-Item (Join-Path $repo 'scripts/release/Get-ScratchDir.ps1') $release
    Set-Content (Join-Path $deploy 'World.ps1') '$ThornswoodWorld = "fixture"'
    Set-Content (Join-Path $deploy 'ServiceAccount.ps1') @'
function Get-ThornswoodServiceAccountScript {
    'function Test-ThornswoodServiceCannotReach {}'
    'function New-ThornswoodServicePrincipal { param([switch]$AsSystem); "fixture" }'
}
'@
    Set-Content (Join-Path $vps 'vps-nightly-backup.ps1') '# fixture'
    Set-Content (Join-Path $vps 'Vps.ps1') @'
function Invoke-ThornswoodNative { $global:LASTEXITCODE = 0 }
function ssh { throw 'Harness must not call ssh' }
function scp { throw 'Harness must not call scp' }
'@
    Set-Content (Join-Path $vps 'Send-Script.ps1') @'
function Invoke-ThornswoodRemote($Target, $SshArgs, $Script) {
    if ($Script.Contains('SetAccessRuleProtection')) { $global:LASTEXITCODE = 0; return 'LOCKED' }
    if ($Script.Contains('KEY THERE')) { $global:LASTEXITCODE = 0; return 'KEY THERE' }
    if ($Script.Contains('made a new one')) { $global:LASTEXITCODE = 0; return 'already there, left alone' }
    $script:started = $false
    $script:tick = 0
    $script:removed = $false
    $script:clock = 0
    function New-ScheduledTaskAction { param($Execute, $Argument); 'action' }
    function New-ScheduledTaskTrigger { param([switch]$Daily, $At); 'trigger' }
    function New-ScheduledTaskSettingsSet { param([switch]$StartWhenAvailable, [switch]$DontStopOnIdleEnd, $ExecutionTimeLimit); 'settings' }
    function Register-ScheduledTask {
        [CmdletBinding()] param($TaskName, $Action, $Trigger, $Principal, $Settings, [switch]$Force)
        if ($case -eq 'register-error') { Write-Error 'registration denied' }
    }
    function Unregister-ScheduledTask {
        [CmdletBinding(SupportsShouldProcess)] param($TaskName, $TaskPath)
        if ($case -eq 'remove-error') { Write-Error 'removal denied'; return }
        if ($case -ne 'still-present') { $script:removed = $true }
    }
    function Get-ScheduledTask {
        [CmdletBinding()] param($TaskName, $TaskPath)
        if ($case -in 'register-missing', 'already-absent' -or $script:removed) { return }
        $state = 'Ready'
        if ($script:started -and $case -ne 'stale') {
            if ($script:tick -lt 2) { $state = 'Queued' }
            elseif ($script:tick -lt 3 -or $case -eq 'over-limit') { $state = 'Running' }
        }
        [pscustomobject]@{ State = $state; TaskName = 'Fixture Backup'; TaskPath = '\' }
    }
    function Get-ScheduledTaskInfo {
        [CmdletBinding()] param($TaskName, $TaskPath)
        $stamp = [datetime]'2026-01-01'
        $result = 0
        if ($script:started -and $script:tick -ge 2 -and $case -ne 'stale') {
            $stamp = $stamp.AddDays(1)
            if ($case -eq 'backup-failed') { $result = 7 }
        }
        [pscustomobject]@{ LastRunTime = $stamp; LastTaskResult = $result; NextRunTime = $stamp.AddDays(1) }
    }
    function Start-ScheduledTask {
        [CmdletBinding()] param($TaskName, $TaskPath)
        if ($case -eq 'start-error') { Write-Error 'start denied'; return }
        $script:started = $true
    }
    function Start-Sleep { param($Seconds, $Milliseconds); $script:tick++ }
    function Get-Date { $script:clock++; ([datetime]'2026-01-02').AddMinutes($script:clock * 3) }
    function Get-Content {
        [CmdletBinding()] param([Parameter(Position=0)]$Path, $LiteralPath, $Tail)
        if ($script:tick -ge 3) { 'fixture final log' } else { 'fixture partial log' }
    }
    function Test-Path { param($LiteralPath, [Parameter(Position=0)]$Path); $true }
    $remoteFile = Join-Path $tmp 'remote.ps1'
    Set-Content -LiteralPath $remoteFile -Value $Script
    $global:LASTEXITCODE = 0
    $oldProgramFiles = $env:ProgramFiles
    try {
        $env:ProgramFiles = $tmp
        $ErrorActionPreference = 'Continue'
        & $remoteFile 2>&1
    } catch {
        $_
        $global:LASTEXITCODE = 1
    } finally {
        $env:ProgramFiles = $oldProgramFiles
    }
}
'@
    $keyFixture = Join-Path $tmp 'present.txt'
    Set-Content $keyFixture '# fixture for existence only'
    $installer = Join-Path $deploy 'Install-Backup.ps1'
    function Invoke-Case($case, $flags) {
        $global:LASTEXITCODE = 0
        try { $lines = & $installer -VpsHost fixture.invalid -VpsUser fixture -Root $tmp -TaskName 'Fixture Backup' -KeyOut $keyFixture -NoPause @flags *>&1 }
        catch { throw "Fixture $case stopped: $_`n$($_.ScriptStackTrace)" }
        @{ Code = $LASTEXITCODE; Text = ($lines -join "`n") }
    }
    foreach ($case in 'register-missing', 'register-error') {
        $r = Invoke-Case $case @{ AsSystem = $true; RunNow = $true }
        Check "$case exits 1 before starting or giving closing advice" ($r.Code -eq 1 -and $r.Text -match 'REGISTER FAILED|registration denied' -and $r.Text -notmatch 'What is left to do|Taking one now') $r.Text
    }
    foreach ($case in 'still-present', 'remove-error') {
        $r = Invoke-Case $case @{ Remove = $true }
        Check "$case exits 1 without claiming removal" ($r.Code -eq 1 -and $r.Text -match 'STILL THERE|removal denied' -and $r.Text -notmatch 'task removed') $r.Text
    }
    foreach ($case in 'remove-ok', 'already-absent') {
        $r = Invoke-Case $case @{ Remove = $true }
        Check "$case verifies absence" ($r.Code -eq 0 -and $r.Text -match 'task removed|already absent') $r.Text
    }
    $r = Invoke-Case 'backup-ok' @{ AsSystem = $true; RunNow = $true }
    Check 'RunNow reports result zero only after completion' ($r.Code -eq 0 -and $r.Text -match 'result 0\b' -and $r.Text -match 'fixture final log' -and $r.Text -notmatch 'fixture partial log') $r.Text
    $r = Invoke-Case 'backup-failed' @{ AsSystem = $true; RunNow = $true }
    Check 'RunNow prints completed failure and exits 1' ($r.Code -eq 1 -and $r.Text -match 'result 7\b' -and $r.Text -match 'fixture final log' -and $r.Text -notmatch 'What is left to do') $r.Text
    foreach ($case in 'stale', 'over-limit', 'start-error') {
        $r = Invoke-Case $case @{ AsSystem = $true; RunNow = $true }
        Check "$case cannot report a completed backup" ($r.Code -eq 1 -and $r.Text -match 'within 15 minutes|start denied' -and $r.Text -notmatch 'result 0\b|What is left to do') $r.Text
    }
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force
}
Write-Host "$pass passed, $fail failed"
exit [int]($fail -gt 0)
