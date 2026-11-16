<#
  test-4204-restart-fails-said.ps1

      pwsh -NoProfile -File scripts/tests/test-4204-restart-fails-said.ps1

  Issue #4204. Restart-Server.ps1 printed what came back from the box after
  the stop and start (COULD NOT RESTART, a service that stayed Stopped, a
  task that was not Running, a port that never answered) and ended 0 all
  the same, so Request-Restart.ps1, which reads only its exit code, said
  everybody was kicked and the server restarted while it was down.

  This runs the real script in a scratch copy of scripts\vps, with the files
  it loads for the box (Vps.ps1, Send-Script.ps1, ServerHold.ps1,
  RestartNotice.ps1) replaced by stand-ins: the remote call answers with the
  lines a case gives, and nothing leaves this machine.
    1. the bot service: a failed Restart-Service ends 1 and says so
    2. the bot service: one that stays Stopped ends 1 and says so
    3. the bot service: Running ends 0
    4. a task: a start the box refused ends 1 and says so
    5. a task: one that is Ready, not Running, ends 1 and says so
    6. a task: Running ends 0
    7. a game server: Running but its port never answered ends 1, naming it
    8. a game server: Running and answering ends 0
    9. the start of a task is no longer told to be silent about failing
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

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4204-' + [Guid]::NewGuid().ToString('N'))
try {
    $null = New-Item -ItemType Directory -Force -Path $work
    Copy-Item -LiteralPath (Join-Path $src 'Restart-Server.ps1') -Destination $work
    $utf8 = New-Object Text.UTF8Encoding $false
    [IO.File]::WriteAllText((Join-Path $work 'Vps.ps1'), "function Get-ThornswoodVpsUser { 'x' }`nfunction Get-ThornswoodVpsAddress { '127.0.0.1' }`n", $utf8)
    [IO.File]::WriteAllText((Join-Path $work 'ServerHold.ps1'), "function Get-ThornswoodHoldScript { param(`$Script) '' }`n", $utf8)
    [IO.File]::WriteAllText((Join-Path $work 'RestartNotice.ps1'), "`$ThornswoodRestartNoticeText = ''`n", $utf8)
    # The bounce is the remote script that sets the hold; it answers with the
    # case's lines. Every other remote script (the log tail) answers nothing.
    [IO.File]::WriteAllText((Join-Path $work 'Send-Script.ps1'), @'
function Invoke-ThornswoodRemote {
  param($Target, $SshArgs, $Script)
  if ($Script -match 'Set-ThornswoodHold') { return @($env:TS4204_SAYS -split '\|') }
  return @()
}
'@, $utf8)

    $pwsh = (Get-Process -Id $PID).Path
    function Run([string]$service, [string]$says) {
        $env:TS4204_SAYS = $says
        try {
            $out = @(& $pwsh -NoProfile -File (Join-Path $work 'Restart-Server.ps1') -Service $service -Now -NoPause -Vps 127.0.0.1 -User x 2>&1 | ForEach-Object { "$_" })
            return [pscustomobject]@{ Code = $LASTEXITCODE; Said = ($out -join "`n") }
        } finally { Remove-Item Env:TS4204_SAYS -ErrorAction SilentlyContinue }
    }

    $r = Run 'bot' 'COULD NOT RESTART: the service did not answer|state Stopped'
    Yes "1. the bot service: a failed Restart-Service ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   and says the restart failed' ($r.Said -match 'STOP\..*(not restarted|did not restart|could not restart)')
    $r = Run 'bot' 'state Stopped'
    Yes "2. the bot service: one that stays Stopped ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   and says it is Stopped' ($r.Said -match 'STOP\..*Stopped')
    $r = Run 'bot' 'state Running'
    Yes "3. the bot service: Running ends 0 (exit $($r.Code))" ($r.Code -eq 0)

    $r = Run 'docs' 'COULD NOT START: access is denied|state Ready'
    Yes "4. a task: a start the box refused ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   and says the start failed' ($r.Said -match 'STOP\..*access is denied')
    $r = Run 'docs' 'state Ready'
    Yes "5. a task: Ready, not Running, ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   and says it is Ready' ($r.Said -match 'STOP\..*Ready')
    $r = Run 'docs' 'state Running'
    Yes "6. a task: Running ends 0 (exit $($r.Code))" ($r.Code -eq 0)

    $r = Run 'dev' 'PORT DOWN|state Running'
    Yes "7. a game server: Running but never answering on its port ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   and names the port' ($r.Said -match 'STOP\..*7788')
    $r = Run 'dev' 'PORT UP|state Running'
    Yes "8. a game server: Running and answering ends 0 (exit $($r.Code))" ($r.Code -eq 0)

    $text = [IO.File]::ReadAllText((Join-Path $src 'Restart-Server.ps1'))
    Yes '9. the start of a task is not told to be silent about failing' ($text -notmatch 'Start-ScheduledTask[^\r\n]*SilentlyContinue')
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
