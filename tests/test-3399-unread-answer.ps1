<#
  test-3399-unread-answer.ps1

      pwsh -NoProfile -File .\tests\test-3399-unread-answer.ps1

  Issue #3399. On 30 Oct Box-Run ping and Nexus-Run Set-NexusKey ran, but
  their sealed answers never came back (runs 41116819564 and 41116954793), and
  Box-Run.ps1 still printed ENDED 0 and exited 0: an answer it could not open
  was a yellow line, and the exit code came from the run's ENDED line alone.
  Nexus-Run.ps1 and Install-Tunnel.ps1 -ThroughGate had the same rule copied.
  The rule is now one function, Get-ThornswoodRunExit in scripts\ops\Sealed.ps1,
  and all three end with it. Held here:
    A. the rule: the verb's own code when the answer was read, never 0 when
       it was not, the verb's own failure kept either way, -1 with no answer;
    B. each of the three ends through it, and none keeps its own copy of the
       ENDED-to-exit-code switch or the yellow "left no output" line.
  Read only. Runs anywhere pwsh does.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Text([string]$rel) { return [IO.File]::ReadAllText((Join-Path $Repo $rel)) }

# ---- A. the rule -------------------------------------------------------------
. (Join-Path $Repo 'scripts/ops/Sealed.ps1')
$has = [bool](Get-Command Get-ThornswoodRunExit -ErrorAction SilentlyContinue)
Yes 'Sealed.ps1 has Get-ThornswoodRunExit' $has
if ($has) {
    function A($state, $text) { return [pscustomobject]@{ State = $state; Text = $text } }
    Yes 'A  ENDED 0, answer read: 0' ((Get-ThornswoodRunExit (A 'answer' 'ENDED 0 ping main abc') $true) -eq 0)
    Yes 'A  ENDED 0, answer NOT read: 1, never 0 (the 30 Oct runs)' ((Get-ThornswoodRunExit (A 'answer' 'ENDED 0 ping main abc') $false) -eq 1)
    Yes 'A  ENDED 3, answer read: 3, the verb''s own' ((Get-ThornswoodRunExit (A 'answer' 'ENDED 3 Get-Logs') $true) -eq 3)
    Yes 'A  ENDED 3, answer not read: still 3, the verb''s own failure kept' ((Get-ThornswoodRunExit (A 'answer' 'ENDED 3 Get-Logs') $false) -eq 3)
    Yes 'A  stopped with ENDED 0: 1' ((Get-ThornswoodRunExit (A 'stopped' 'ENDED 0 ping') $true) -eq 1)
    Yes 'A  stopped with no ENDED line: 1' ((Get-ThornswoodRunExit (A 'stopped' 'cancelled') $true) -eq 1)
    Yes 'A  an answer with no ENDED line, not read: 1' ((Get-ThornswoodRunExit (A 'answer' 'REFUSED x') $false) -eq 1)
    Yes 'A  no answer at all: -1, for the caller to stop on' ((Get-ThornswoodRunExit (A 'none' '') $true) -eq -1)
}

# ---- B. the three callers ----------------------------------------------------
$callers = [ordered]@{
    'scripts/vps/Box-Run.ps1'          = 'Get-ThornswoodRunExit $a $read'
    'scripts/release/Nexus-Run.ps1'    = 'Get-ThornswoodRunExit $a $read'
    'scripts/deploy/Install-Tunnel.ps1' = 'Get-ThornswoodRunExit $a ([bool]$o.Ok)'
}
foreach ($rel in $callers.Keys) {
    $t = Text $rel
    $code = ($t -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
    Yes "B  $rel ends through Get-ThornswoodRunExit" ($code.Contains($callers[$rel]))
    Yes "B  $rel has no ENDED-to-exit switch of its own" (-not ($code -match "exit \[int\]\`$Matches\[1\]"))
    Yes "B  $rel does not pass an unread answer off as a yellow note" (-not ($code -match "left no (sealed )?output[^\n]*'Yellow'") -and -not ($code -match "only its end can be read[^\n]*'Yellow'"))
}
# Box-Run and Nexus-Run count the answer read only where the sealed output opened.
foreach ($rel in 'scripts/vps/Box-Run.ps1', 'scripts/release/Nexus-Run.ps1') {
    $t = Text $rel
    $ok = $t.IndexOf('if ($o.Ok) {')
    $set = $t.IndexOf('$read = $true')
    Yes "B  $rel counts the answer read only once Open-ThornswoodSealedRun said Ok" ($t.Contains('$read = $false') -and $ok -ge 0 -and $set -gt $ok -and $set -lt $t.IndexOf('} else {', $ok))
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
