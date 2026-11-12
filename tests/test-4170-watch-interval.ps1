<#
  test-4170-watch-interval.ps1

      pwsh -NoProfile -File .\tests\test-4170-watch-interval.ps1

  Issue #4170. The outside watcher (.github\workflows\watch-outside.yml,
  scripts\vps\Watch-Outside.ps1) was started by GitHub's schedule trigger,
  asked for every five minutes, and its messages told staff it checked
  "about every 5 minutes". GitHub's schedule does not keep an interval: the
  issue measured a median of 11 minutes and once 110, and from 2 to 12 Nov
  2026 it started the watcher 3 to 5 times a day, 6 to 8 hours apart (the
  workflow's scheduled runs, counted a day at a time). So the words promised
  a cadence the trigger never gave, and an outage could go unseen for hours.

  This holds the fix:

    1. the workflow keeps the clock itself: one run checks every 5 minutes
       for 55 minutes (-For 55; under the hour the runners' App token lasts)
       and then starts the next run with workflow_dispatch, which GitHub
       starts for the run's own token. The schedule is only how a broken
       chain starts again;
    2. the script's loop starts a pass every 5 minutes by the clock, from
       each pass's start, however long a pass takes;
    3. a pass more than 15 minutes after the one before tells staff once,
       with both times, that the watcher was not checking in between, and a
       pass on a runner that is offline does not count as a check;
    4. no message promises a cadence: the down message says how long before
       it the check before it was, measured.

  The real script is dot-sourced, with the network, the clock and the wait
  replaced. Nothing leaves the machine. Writes only under its own temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ScriptPath = Join-Path (Join-Path (Join-Path $Root 'scripts') 'vps') 'Watch-Outside.ps1'
$WfPath = Join-Path (Join-Path (Join-Path $Root '.github') 'workflows') 'watch-outside.yml'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
  if ($cond) { $script:pass++; Write-Host "PASS  $what" }
  else       { $script:fail++; Write-Host "FAIL  $what" }
}

# ---- 1. the workflow keeps the clock -------------------------------------------
$wf = [IO.File]::ReadAllText($WfPath).Replace("`r`n", "`n")
$watch = [regex]::Match($wf, '(?m)^        run: \./scripts/vps/Watch-Outside\.ps1 -Run .*$').Value
Yes ('1. the watch step checks every 5 minutes for 55 minutes in one run (' + $watch.Trim() + ')') ($watch -match ' -Minutes 5(\s|$)' -and $watch -match ' -For 55(\s|$)')
$timeout = [regex]::Match($wf, '(?m)^    timeout-minutes: (\d+)\s*$')
Yes '   and the job has the time for it, and no more than an hour and a little' ($timeout.Success -and [int]$timeout.Groups[1].Value -ge 58 -and [int]$timeout.Groups[1].Value -le 65)
$next = [regex]::Match($wf, '(?s)\n      - name: Start the next run\n(.*?)(?=\n      - name: |\z)')
Yes '   then it starts the next run of itself, after it kept what it remembers' ($next.Success -and $wf.IndexOf('- name: Keep what it remembers') -ge 0 -and $wf.IndexOf('- name: Keep what it remembers') -lt $next.Index)
$n = $next.Groups[1].Value
Yes '   with gh workflow run on main, the run''s own token, nothing pasted into the script' (
  $n -match 'gh workflow run watch-outside\.yml --ref main' -and $n -match 'GH_TOKEN: \$\{\{ github\.token \}\}' -and $n -notmatch '\$\{\{ (inputs|github\.event)')
Yes '   unless it was a test post or somebody cancelled the run' ($n -match 'if: \$\{\{ !cancelled\(\) && !inputs\.test \}\}')
Yes '   and the job may start a workflow (actions: write), still reading the repository and the Deployments only' (
  $wf -match '(?m)^  actions: write\s*$|(?m)^      actions: write\s*$' -and $wf -match 'contents: read' -and $wf -match 'deployments: read' -and $wf -notmatch 'contents: write')
Yes '   one run at a time, never cancelling the one running, so the next waits for this one' ($wf -match '(?m)^  group: watch-outside\s*$' -and $wf -match '(?m)^  cancel-in-progress: false\s*$')
Yes '   the schedule is still there, to start the chain again when it breaks' ($wf -match "(?m)^    - cron: '")
Yes '   and the header no longer says the schedule runs it every five minutes' ($wf -notmatch '(?m)^# Watches .*\n# every five minutes')

# ---- the script, dot-sourced ----------------------------------------------------
$oldHook = $env:WATCH_WEBHOOK
$env:WATCH_WEBHOOK = ''
. $ScriptPath
$ErrorActionPreference = 'Stop'

$dir = Join-Path ([IO.Path]::GetTempPath()) ('ts-4170-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $dir -Force
try {
  $S = Read-Settings $Root ''
  $S.Minutes = 5
  $script:clock = [datetime]::new(2026, 11, 12, 9, 0, 0, [DateTimeKind]::Utc)
  $script:online = $true
  $script:siteBad = $false
  $script:passes = New-Object 'System.Collections.Generic.List[datetime]'
  $script:posted = New-Object 'System.Collections.Generic.List[string]'
  $script:waits = 0
  function Get-Now { return $script:clock }
  function Test-Online { return $script:online }
  # Each pass takes 70 seconds of the clock, so the loop is held to starting
  # passes 5 minutes apart, not 5 minutes after the last one ended.
  function Invoke-Check($S, $c) {
    if ($c.Name -eq 'site') { $script:passes.Add($script:clock); $script:clock = $script:clock.AddSeconds(70) }
    if ($c.Name -eq 'site' -and $script:siteBad) { return (Wrong 'https://thornswood.net/ did not answer within 20 seconds') }
    return (Ok 'fine')
  }
  function Send-Webhook([string]$url, [string]$text) { $script:posted.Add($text); return '' }
  function Wait-Until([datetime]$t) { $script:waits++; if ($t -gt $script:clock) { $script:clock = $t } }
  $env:WATCH_WEBHOOK = 'https://discord.com/api/webhooks/123456/FAKEHOOK_abc'
  function Posted([string]$like) { return @($script:posted | Where-Object { $_ -like $like }).Count }
  # The next pass $m minutes after the last one started (a pass takes 70
  # seconds of the clock above), or after the last one tried, offline.
  $script:lastTry = $script:clock
  function Next([int]$m) { $script:clock = $script:lastTry.AddMinutes($m); $script:lastTry = $script:clock; $null = Invoke-WatchFor $S $P 5 6>$null }

  # ---- 2. the loop ---------------------------------------------------------------
  $have = [bool](Get-Command Invoke-WatchFor -EA SilentlyContinue)
  Yes '2. Watch-Outside.ps1 has Invoke-WatchFor, the loop -For runs' $have
  if ($have) {
    $P = Paths (Join-Path $dir 'state')
    $start = $script:clock
    $count = Invoke-WatchFor $S $P 55 6>$null
    $gaps = @(for ($i = 1; $i -lt $script:passes.Count; $i++) { ($script:passes[$i] - $script:passes[$i - 1]).TotalMinutes })
    Yes ('   55 minutes is 11 passes (' + $count + ', ' + $script:passes.Count + ' seen)') ($count -eq 11 -and $script:passes.Count -eq 11)
    Yes ('   each started 5 minutes after the one before, by the clock (' + ($gaps -join ', ') + ')') ($gaps.Count -eq 10 -and @($gaps | Where-Object { $_ -ne 5 }).Count -eq 0)
    Yes '   the first at once, the last 50 minutes in, and nothing after it is waited for' ($script:passes[0] -eq $start -and ($script:passes[10] - $start).TotalMinutes -eq 50 -and $script:waits -eq 10)
    Yes '   and a healthy run tells nobody anything' ($script:posted.Count -eq 0)

    # ---- 3. a gap is told -------------------------------------------------------
    $script:lastTry = $start; $script:passes.Clear()
    Next 55
    Yes '3. the next run, 5 minutes after the last pass, tells nothing' ($script:posted.Count -eq 0)
    Next 437
    Yes ('   a pass 7 hours and more after the one before tells once that the watcher was not checking (' + $script:posted.Count + ')') ((Posted '*outside watcher was not checking*') -eq 1)
    $g = @($script:posted | Where-Object { $_ -like '*was not checking*' })[0]
    Yes '   with both times, in each reader''s clock, and how long' ($g -and ([regex]::Matches($g, '<t:\d+:f>')).Count -eq 2 -and $g -match 'about 7\.\d hours')
    Next 5
    Yes '   and not again on the pass after' ((Posted '*was not checking*') -eq 1)
    Next 16
    Yes '   16 minutes is more than 15, and told' ((Posted '*was not checking*') -eq 2)
    Next 15
    Yes '   15 minutes is not' ((Posted '*was not checking*') -eq 2)
    $script:online = $false
    Next 5; Next 5; Next 5
    $script:online = $true
    Next 5
    Yes '   a runner offline for 20 minutes checked nothing, so that is a gap too' ((Posted '*was not checking*') -eq 3)

    # ---- 4. the words ------------------------------------------------------------
    $script:posted.Clear()
    $script:siteBad = $true
    Next 5; Next 5
    $down = @($script:posted | Where-Object { $_ -like '*is down*' })[0]
    Yes '4. the site down on two passes: one message' ((Posted '*is down*') -eq 1)
    Yes '   saying how long before it the check before it was, measured' ($down -match 'The check before this one was about 5 minutes earlier')
    Yes '   and promising no cadence' ($down -notmatch 'about every')
  }
  $src = [IO.File]::ReadAllText($ScriptPath)
  Yes '   no message in the script promises "about every" so many minutes' ($src -notmatch "about every ' \+")
}
finally {
  $env:WATCH_WEBHOOK = $oldHook
  Remove-Item -LiteralPath $dir -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
