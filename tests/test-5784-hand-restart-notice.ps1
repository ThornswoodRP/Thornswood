<#
  test-5784-hand-restart-notice.ps1

      pwsh -NoProfile -File .\tests\test-5784-hand-restart-notice.ps1

  The restart notice the scripts that stop a game server by hand leave for
  the Discord bot (#5784): scripts\vps\RestartNotice.ps1, run here as the box
  runs it, against a folder of its own in place of
  C:\Thornswood-Deploys\for-bot.

  It holds:
    - a "coming" for C:\Thornswood-Server is restart-main.json with a new id,
      the time it goes down and why, in the fields the deploy agent writes
      (tools\DeployAgent\RestartNotice.cs) and the bot reads
      (bot\bot_restarts.py); the dev server's is restart-dev.json;
    - "back", "down" and "off" keep the id, the time and the why of the
      coming they end, and say nothing when no restart is coming;
    - a folder that is not a game server's says nothing;
    - with no for-bot folder it says NOTICE FAILED and writes nothing;
    - Request-Restart, Swap.ps1 and Restart-Server.ps1 send it to the box.

  Nothing leaves this machine.
#>
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$pass = 0; $fail = 0
function Ok([bool]$cond, [string]$what) {
    if ($cond) { $script:pass++; Write-Host ('PASS  ' + $what) }
    else { $script:fail++; Write-Host ('FAIL  ' + $what) -ForegroundColor Red }
}

. (Join-Path $Repo 'scripts\vps\RestartNotice.ps1')
Invoke-Expression $ThornswoodRestartNoticeText

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-5784-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $ThornswoodRestartNoticeDir = $tmp
    # -DateKind String: PowerShell 7 would otherwise turn downUtc into a local date.
    $read = { param($env) Get-Content -Raw -LiteralPath (Join-Path $tmp ('restart-' + $env + '.json')) | ConvertFrom-Json -AsHashtable -DateKind String }

    $said = Set-ThornswoodRestartNotice 'C:\Thornswood-Server' 'back'
    Ok ($said -like 'NOTICE NONE:*' -and -not (Test-Path (Join-Path $tmp 'restart-main.json'))) 'an end with no restart coming says nothing and writes nothing'

    $before = (Get-Date).ToUniversalTime()
    $said = Set-ThornswoodRestartNotice 'C:\Thornswood-Server\' 'coming' 5 'a server update'
    $doc = & $read 'main'
    Ok ($said -match '^NOTICE SAID: main-\d{8}-\d{6}-hand coming$') 'a coming for the live server says NOTICE SAID with its id'
    Ok ((@($doc.Keys) | Sort-Object) -join ',' -eq 'downUtc,environment,id,state,why,writtenUtc') '  in the fields the agent writes and the bot reads'
    Ok ($doc.environment -eq 'main' -and $doc.state -eq 'coming' -and $doc.why -eq 'a server update') '  environment main, state coming, and why'
    $down = [DateTime]::ParseExact([string]$doc.downUtc, 'yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]'AdjustToUniversal,AssumeUniversal')
    $ahead = ($down - $before).TotalSeconds
    Ok ($ahead -ge 295 -and $ahead -le 305) ('  it goes down five minutes on (' + [int]$ahead + ' s)')
    Ok (-not (Test-Path (Join-Path $tmp 'restart-main.json.new'))) '  no half-written file is left'

    $id = $doc.id
    $said = Set-ThornswoodRestartNotice 'C:\Thornswood-Server' 'back'
    $end = & $read 'main'
    Ok ($said -eq ('NOTICE SAID: ' + $id + ' back') -and $end.state -eq 'back') 'back keeps the id of the coming it ends'
    Ok ($end.downUtc -eq $doc.downUtc -and $end.why -eq 'a server update') '  and its time and why'
    $said = Set-ThornswoodRestartNotice 'C:\Thornswood-Server' 'down'
    Ok ($said -like 'NOTICE NONE:*' -and (& $read 'main').state -eq 'back') 'a second end says nothing and leaves the first'

    $said = Set-ThornswoodRestartNotice 'C:/Thornswood-Server-Dev' 'coming' 1 'a "quoted" fix'
    Ok ($said -match '^NOTICE SAID: dev-.* coming$' -and (& $read 'dev').environment -eq 'dev') 'the dev server is restart-dev.json'
    $said = Set-ThornswoodRestartNotice 'C:\Thornswood-Server-Dev' 'off'
    $off = & $read 'dev'
    Ok ($off.state -eq 'off' -and $off.why -eq 'a "quoted" fix') 'off keeps a why with quotes in it as it was'

    $said = Set-ThornswoodRestartNotice 'C:\Thornswood-Server-Old' 'coming' 5
    Ok ($said -like 'NOTICE NONE:*' -and @(Get-ChildItem $tmp).Count -eq 2) 'a folder that is not a game server says nothing'

    $ThornswoodRestartNoticeDir = Join-Path $tmp 'none'
    $said = Set-ThornswoodRestartNotice 'C:\Thornswood-Server' 'coming' 5
    Ok ($said -like 'NOTICE FAILED:*' -and -not (Test-Path $ThornswoodRestartNoticeDir)) 'no for-bot folder is NOTICE FAILED and makes nothing'
} finally {
    Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
}

$rr = Get-Content -Raw (Join-Path $Repo 'scripts\vps\Request-Restart.ps1')
$sw = Get-Content -Raw (Join-Path $Repo 'scripts\deploy\Swap.ps1')
$rs = Get-Content -Raw (Join-Path $Repo 'scripts\vps\Restart-Server.ps1')
Ok ($rr -match 'RestartNotice\.ps1' -and $rr -match '\$ThornswoodRestartNoticeText') 'Request-Restart sends the notice to the box'
Ok ($sw -match '\$ThornswoodRestartNoticeText' -and $sw -match 'Set-ThornswoodRestartNotice[^\r\n]*-State back') 'Swap.ps1 says the server is back after a swap'
Ok ($rs -match 'Request-Restart' -and $rs -match 'Set-ThornswoodRestartNotice[^\r\n]*-State back') 'Restart-Server says it ahead and says it is back'

Write-Host ''
Write-Host ("$pass passed, $fail failed")
if ($fail) { exit 1 }
exit 0
