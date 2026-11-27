<#
  test-4218-watch-delivery.ps1

      pwsh -NoProfile -File .\tests\test-4218-watch-delivery.ps1

  The outside watcher (scripts\vps\Watch-Outside.ps1 -Run, which
  watch-outside.yml runs) posts what it finds to #staff-updates. Until #4218
  a missing or refused webhook only wrote a line in watch.log, an alert a day
  old was skipped without a word, and every run ended 0: an outage could be
  found and reach nobody while the workflow stayed green.

  Each case runs the script's own -Run block, cut from the file, in a child
  pwsh, after dot-sourcing the script and replacing only what reaches the
  internet or the clock (Test-Online, Invoke-Check, Send-Webhook, Get-Now).
  The webhook address is a made-up one that matches the shape and is never
  asked; Send-Webhook is a stand-in. The child's exit code is the run's.

    1. no webhook, one message in the outbox: exit 1, the message waits
    2. a webhook Discord refuses (HTTP 403): exit 1, the message waits
    3. the same, through -For as the workflow runs it: exit 1
    4. a message a day old never posted: exit 1, said once as dropped, and
       the next run with the same state ends 0 and drops nothing again
    5. a webhook that takes it: exit 0, posted once
    6. nothing to send: exit 0, nothing posted
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path (Join-Path (Join-Path $Root 'scripts') 'vps') 'Watch-Outside.ps1'
$pwshExe = (Get-Process -Id $PID).Path

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The script's own -Run block, braces counted from "if ($Run) {".
$src = [IO.File]::ReadAllText($ScriptPath).Replace("`r`n", "`n")
$at = $src.IndexOf("`nif (`$Run) {")
Yes 'Watch-Outside.ps1 has its -Run block' ($at -gt 0)
$depth = 0; $end = -1
for ($i = $src.IndexOf('{', $at); $i -lt $src.Length; $i++) {
    if ($src[$i] -eq '{') { $depth++ }
    elseif ($src[$i] -eq '}') { $depth--; if ($depth -eq 0) { $end = $i; break } }
}
$runBlock = $src.Substring($at + 1, $end - $at)

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-4218-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$child = Join-Path $tmp 'run.ps1'
$stub = @'
$ErrorActionPreference = 'Stop'
. $env:TS4218_SCRIPT
$Run = $true; $Folder = $env:TS4218_STATE; $Minutes = 5; $For = [int]$env:TS4218_FOR; $NoPause = $true
function Get-Now { return [datetime]::new(2026, 11, 27, 12, 0, 0, [DateTimeKind]::Utc) }
function Test-Online { return $true }
function Invoke-Check($S, $c) { return (Ok 'fine') }
function Wait-Until([datetime]$t) { }
function Send-Webhook([string]$url, [string]$text) { Add-Content -LiteralPath $env:TS4218_CALLS -Value 'post'; return $env:TS4218_SEND }
function Say($m, $c = 'Gray') { Write-Host $m }
$S = Read-Settings $env:TS4218_REPO ''
'@
[IO.File]::WriteAllText($child, $stub + "`n" + $runBlock + "`nexit 99`n")

$now = [DateTimeOffset]::new(2026, 11, 27, 12, 0, 0, [TimeSpan]::Zero).ToUnixTimeSeconds()
function Alert([string]$id, [int64]$at) { return (ConvertTo-Json @{ id = $id; at = $at; service = 'outside site'; kind = 'down'; text = '**The site is down.** stand-in' } -Compress) }

# One run of the -Run block. State is a folder the case fills first.
function Invoke-Case([string]$name, [string[]]$alerts, [string]$hook, [string]$send, [int]$for = 0, [string]$state = '') {
    if (-not $state) {
        $state = Join-Path $tmp $name
        New-Item -ItemType Directory -Force -Path $state | Out-Null
        if ($alerts.Count) { [IO.File]::WriteAllText((Join-Path $state 'alerts.jsonl'), (($alerts -join "`r`n") + "`r`n")) }
    }
    $calls = Join-Path $state 'calls.txt'
    Remove-Item -LiteralPath $calls -Force -ErrorAction SilentlyContinue
    $env:TS4218_SCRIPT = $ScriptPath; $env:TS4218_REPO = $Root; $env:TS4218_STATE = $state
    $env:TS4218_FOR = [string]$for; $env:TS4218_SEND = $send; $env:TS4218_CALLS = $calls
    $env:WATCH_WEBHOOK = $hook
    $out = @(& $pwshExe -NoProfile -NonInteractive -File $child 2>&1 | ForEach-Object { [string]$_ })
    $code = $LASTEXITCODE
    $sent = Join-Path $state 'alerts-sent.txt'
    # Built here, not inside $( ): a subexpression unrolls an empty array to
    # $null and one id to a bare string, and StrictMode then refuses .Count.
    [string[]]$posted = @()
    if (Test-Path -LiteralPath $calls) { $posted = @(Get-Content -LiteralPath $calls | Where-Object { $_ }) }
    [string[]]$sentIds = @()
    if (Test-Path -LiteralPath $sent) { $sentIds = @(Get-Content -LiteralPath $sent | Where-Object { $_ }) }
    return [pscustomobject]@{
        Code = $code; Out = ($out -join "`n"); State = $state
        Posts = [int]$posted.Length
        Sent = $sentIds
    }
}

$fakeHook = 'https://discord.com/api/webhooks/1/standin'
try {
    $fresh = Alert 'outside-20261127120000-site-down' $now

    $r = Invoke-Case 'no-webhook' @($fresh) '' ''
    Yes "1. no webhook: the run ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   and says what was not delivered, by id' ($r.Out -match 'NOT DELIVERED' -and $r.Out -match 'outside-20261127120000-site-down')
    Yes '   and the message waits in the outbox, unposted' ($r.Posts -eq 0 -and $r.Sent.Count -eq 0)

    $r = Invoke-Case 'refused' @($fresh) $fakeHook 'HTTP 403'
    Yes "2. a refused webhook: the run ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   having tried it once, and the message waits' ($r.Posts -eq 1 -and $r.Sent.Count -eq 0 -and $r.Out -match 'NOT DELIVERED')

    $r = Invoke-Case 'refused-for' @($fresh) $fakeHook 'HTTP 403' 5
    Yes "3. the same through -For, as the workflow runs it: ends 1 (exit $($r.Code))" ($r.Code -eq 1)

    $old = Alert 'outside-20261126060000-site-down' ($now - 30 * 3600)
    $r = Invoke-Case 'dropped' @($old) $fakeHook ''
    Yes "4. a message a day old never posted: the run ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   saying it was dropped, by id, and posting nothing' ($r.Out -match 'DROPPED' -and $r.Out -match 'outside-20261126060000-site-down' -and $r.Posts -eq 0)
    $again = Invoke-Case 'dropped' @() $fakeHook '' 0 $r.State
    Yes "   and the next run on that state drops nothing again: ends 0 (exit $($again.Code))" ($again.Code -eq 0 -and $again.Out -notmatch 'DROPPED')

    $r = Invoke-Case 'delivered' @($fresh) $fakeHook ''
    Yes "5. a webhook that takes it: the run ends 0 (exit $($r.Code))" ($r.Code -eq 0)
    Yes '   posted once, and remembered as sent' ($r.Posts -eq 1 -and ($r.Sent -contains 'outside-20261127120000-site-down'))

    $r = Invoke-Case 'quiet' @() $fakeHook ''
    Yes "6. nothing to send: the run ends 0 (exit $($r.Code)), nothing posted" ($r.Code -eq 0 -and $r.Posts -eq 0)
} finally {
    $env:WATCH_WEBHOOK = $null
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
