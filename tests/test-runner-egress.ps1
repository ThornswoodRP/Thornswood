<#
  test-runner-egress.ps1

      pwsh -NoProfile -File tests\test-runner-egress.ps1

  The box runners' way out (#5495): the proxy Install-RunnerEgress.ps1 puts
  on the box. It was made for tw-hermes-box, and its checks lived in that
  runner's harness until the runner came off on 9 Nov 2026 (#5565); #5577
  says whether the proxy stays. Until then this holds what it still is:
    1. records\runner-egress.json listens on loopback with a port, and its
       list names GitHub's runner hosts by name, the token host among them;
    2. RunnerEgress.ps1 reads that record, and Ask-Egress says nothing
       answered when no proxy listens;
    3. the gate runs Install-RunnerEgress and its -Status, and its -Remove
       only as Remove-RunnerEgress (#5577); -Remove stops while a runner record still sends a runner
       through it and reads back the task, program, folder and port;
    4. no runner record sends a runner through it, and Install-Runner.ps1
       has no part that does.
  Asks GitHub nothing and changes nothing on the box. A few seconds.
#>
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# ---- 1. the record -----------------------------------------------------------------
$eg = Get-Content -LiteralPath (Join-Path $Repo 'records/runner-egress.json') -Raw | ConvertFrom-Json
Yes "the way out listens on loopback ($($eg.listen))" ($eg.listen -match '^127\.0\.0\.1:\d+$')
Yes '  and its list takes GitHub''s runner hosts by name, the token host by pattern' (@($eg.allow) -contains '*.actions.githubusercontent.com' -and @($eg.allow) -contains 'github.com' -and @($eg.allow) -contains 'api.github.com')
Yes '  and holds no address' (@($eg.allow | Where-Object { [string]$_ -match '^[0-9.:]+$' }).Count -eq 0)

# ---- 2. what reads it --------------------------------------------------------------
. (Join-Path $Repo 'scripts/deploy/RunnerEgress.ps1')
$got = Get-ThornswoodRunnerEgress $Repo
Yes "RunnerEgress.ps1 reads its address and port ($($got.Url))" ($got.Listen -eq $eg.listen -and $got.Port -eq [int]$eg.listen.Split(':')[1] -and $got.Url -eq ('http://' + $eg.listen))
. ([scriptblock]::Create((Get-ThornswoodEgressAskScript)))
$l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $l.Start(); $free = $l.LocalEndpoint.Port; $l.Stop()
Yes 'Ask-Egress says nothing answered when no proxy listens' ((Ask-Egress $free 'github.com') -like 'no answer on 127.0.0.1:*')

# ---- 3. the gate -------------------------------------------------------------------
$verbs = Get-Content -LiteralPath (Join-Path $Repo 'scripts/vps/gate/verbs.json') -Raw | ConvertFrom-Json
$v = $verbs.verbs.'Install-RunnerEgress'
Yes 'the gate runs Install-RunnerEgress with -Status beside it and nothing else' ($v.script -eq 'scripts/deploy/Install-RunnerEgress.ps1' -and (@($v.params.PSObject.Properties.Name) -join ',') -eq 'Status')
$r = $verbs.verbs.'Remove-RunnerEgress'
Yes '  and its -Remove only as Remove-RunnerEgress, which takes nothing beside it (#5577)' ($r.script -eq $v.script -and (@($r.fixed) -join ' ') -eq '-Remove -NoPause' -and @($r.params.PSObject.Properties).Count -eq 0)
$ie = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/deploy/Install-RunnerEgress.ps1'))
$rm = $ie.Substring($ie.IndexOf('if ($Remove) {'))
$rm = $rm.Substring(0, $rm.IndexOf('# ----'))
Yes '  and -Remove stops before it sends anything while a runner record still uses it' ($rm -match 'still send a runner through it\. Nothing was sent' -and $rm.IndexOf('egress })') -lt $rm.IndexOf('Remote @'))
Yes '  and takes off the task, the program and the folder, then reads each back with the port' ($rm -match 'Unregister-ScheduledTask' -and $rm -match 'Stop-Process' -and $rm -match "Remove-Item -LiteralPath '\`$Root' -Recurse" -and $rm -match 'NOT REGISTERED' -and $rm -match 'nothing listens on' -and $rm -match "Where-Object \{ \`$_ -match 'STILL' \}")

# ---- 4. no runner goes through it --------------------------------------------------
$sent = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'records') -Filter '*-runner.json' -File | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json).egress })
Yes 'no runner record sends a runner through it (#5565)' ($sent.Count -eq 0)
$ir = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/deploy/Install-Runner.ps1'))
Yes '  and Install-Runner.ps1 has no -Hermes, no proxy part and no Python part' ($ir -notmatch '\[switch\]\$Hermes' -and $ir -notmatch 'Set-RunnerProxy' -and $ir -notmatch 'RunnerEgress\.ps1' -and $ir -notmatch 'Install-RunnerPython')

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }
exit 0
