<#
  test-4207-watchdog-install-fails.ps1

      pwsh -NoProfile -File scripts/tests/test-4207-watchdog-install-fails.ps1

  Issue #4207. Watch-Services.ps1 -Install printed what came back from the
  box, a FAILED line among it, then "Anything that stops gets started again
  within five minutes", and only the task's registration could print FAILED:
  a write of watch.ps1 that threw, a task that was not there afterwards and
  a first run the box refused were not checked. -SetWebhook printed FAILED
  in red for a lock or a test message that did not go and ended 0 whatever
  came back.

  This runs the real script in a scratch copy of scripts\vps, with the files
  it loads for the box (Vps.ps1, Send-Script.ps1, Lock-Folder.ps1,
  ServerHold.ps1) replaced by stand-ins: the remote call answers with the
  lines a case gives and Discord's answer is stood in too. The webhook comes
  on standard input, through the real Send-Secret.ps1, as it does with no
  keyboard (#4346). Nothing leaves this machine.
    1. -Install: a FAILED line ends 1, and never says it is watching
    2. -Install: nothing back from the box ends 1, and never says so either
    3. -Install: every step done ends 0, and says what it does from now on
    4. -Install, on the box: each write, the task read back after it is
       registered and its first run say FAILED with why when they fail
    5. -SetWebhook: a lock that failed ends 1
    6. -SetWebhook: a test message that did not go ends 1
    7. -SetWebhook: nothing back from the box ends 1
    8. -SetWebhook: saved and posted ends 0
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$src = Join-Path (Join-Path $Repo 'scripts') 'vps'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4207-' + [Guid]::NewGuid().ToString('N'))
try {
    # scripts\vps under a scratch root, with bot\staff-channel.txt two up, as
    # the script finds it.
    $vps = Join-Path (Join-Path $work 'scripts') 'vps'
    $null = New-Item -ItemType Directory -Force -Path $vps
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $work 'bot')
    Copy-Item -LiteralPath (Join-Path $src 'Watch-Services.ps1') -Destination $vps
    Copy-Item -LiteralPath (Join-Path $src 'vps-say-staff.ps1') -Destination $vps
    # The real reader: the webhook comes on standard input, as it does with no
    # keyboard (#4346).
    Copy-Item -LiteralPath (Join-Path $src 'Send-Secret.ps1') -Destination $vps
    $utf8 = New-Object Text.UTF8Encoding $false
    $channel = '123456789012345678'
    [IO.File]::WriteAllText((Join-Path (Join-Path $work 'bot') 'staff-channel.txt'), $channel, $utf8)
    # Functions shadow cmdlets of the same name, so Discord's answer about
    # where a webhook posts is stood in here too.
    [IO.File]::WriteAllText((Join-Path $vps 'Vps.ps1'), @"
function Get-ThornswoodVpsUser { 'x' }
function Get-ThornswoodVpsAddress { '127.0.0.1' }
function Invoke-ThornswoodNative(`$c) { @((`$env:TS4207_SAYS -split '\|') | Where-Object { `$_ }) }
function Invoke-RestMethod { [pscustomobject]@{ channel_id = '$channel' } }
"@, $utf8)
    [IO.File]::WriteAllText((Join-Path $vps 'Send-Script.ps1'), @'
function Invoke-ThornswoodRemote {
  param($Target, $SshArgs, $Script)
  return @(($env:TS4207_SAYS -split '\|') | Where-Object { $_ })
}
'@, $utf8)
    [IO.File]::WriteAllText((Join-Path $vps 'Lock-Folder.ps1'), "function Get-ThornswoodLockedFolderScript(`$Root) { '' }`n", $utf8)
    [IO.File]::WriteAllText((Join-Path $vps 'ServerHold.ps1'), "function Get-ThornswoodHoldScript { '' }`n", $utf8)

    $pwsh = (Get-Process -Id $PID).Path
    function Run([string]$switch, [string]$says) {
        $env:TS4207_SAYS = $says
        try {
            $out = @('https://discord.com/api/webhooks/1/abc' | & $pwsh -NoProfile -File (Join-Path $vps 'Watch-Services.ps1') "-$switch" -NoPause -Vps 127.0.0.1 -User x 2>&1 | ForEach-Object { "$_" })
            return [pscustomobject]@{ Code = $LASTEXITCODE; Said = ($out -join "`n") }
        } finally { Remove-Item Env:TS4207_SAYS -ErrorAction SilentlyContinue }
    }
    $watching = 'started again within five minutes'

    $r = Run 'Install' 'wrote     C:\Thornswood-Watch\watch.ps1  9 bytes|FAILED    the task could not be registered: access is denied'
    Yes "1. -Install: a FAILED line ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   and does not say it is watching' (-not $r.Said.Contains($watching))
    $r = Run 'Install' ''
    Yes "2. -Install: nothing back from the box ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   and does not say it is watching' (-not $r.Said.Contains($watching))
    $r = Run 'Install' 'wrote     C:\Thornswood-Watch\watch.ps1  9 bytes|made      the task, every five minutes, at priority 4|ran       the task once'
    Yes "3. -Install: every step done ends 0 (exit $($r.Code))" ($r.Code -eq 0)
    Yes '   and says what it does from now on' ($r.Said.Contains($watching))

    # The box's half runs only on Windows Server, so what it says when a step
    # fails is read from the script itself.
    $text = [IO.File]::ReadAllText((Join-Path $src 'Watch-Services.ps1'))
    $at = $text.IndexOf('if ($Install) {')
    $box = $(if ($at -ge 0) { $text.Substring($at) } else { '' })
    Yes '4. -Install, on the box: a write of watch.ps1 that throws says FAILED' ($box -match '(?s)try \{\s*\[IO\.File\]::WriteAllBytes\(''\$Root\\watch\.ps1''.*?\} catch \{ ''FAILED')
    Yes '   and one of say-staff.ps1' ($box -match '(?s)try \{\s*\[IO\.File\]::WriteAllBytes\(''\$Root\\say-staff\.ps1''.*?\} catch \{ ''FAILED')
    Yes '   the task is read back after it is registered, and not there says FAILED' ($box -match 'Get-ScheduledTask -TaskName ''\$Task'' -ErrorAction SilentlyContinue' -and $box.Contains("'FAILED    the task is not there after registering it"))
    Yes '   and a first run the box refused says FAILED' ($box -match '(?s)schtasks /run /tn ''\$Task''.*?if \(`\$LASTEXITCODE -ne 0\) \{ ''FAILED')

    $r = Run 'SetWebhook' 'FAILED    icacls exited with 5 locking C:\Thornswood-Watch\alerts-webhook.txt|posted    a test message. Look for it in the channel.'
    Yes "5. -SetWebhook: a lock that failed ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    $r = Run 'SetWebhook' 'saved     C:\Thornswood-Watch\alerts-webhook.txt, readable by SYSTEM and Administrators only|FAILED    the test message: HTTP 404'
    Yes "6. -SetWebhook: a test message that did not go ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    $r = Run 'SetWebhook' ''
    Yes "7. -SetWebhook: nothing back from the box ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    $r = Run 'SetWebhook' 'saved     C:\Thornswood-Watch\alerts-webhook.txt, readable by SYSTEM and Administrators only|posted    a test message. Look for it in the channel.'
    Yes "8. -SetWebhook: saved and posted ends 0 (exit $($r.Code))" ($r.Code -eq 0)
    Yes '   having asked where the webhook posts, and been told #staff-updates' ($r.Said -match 'which is #staff-updates')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
