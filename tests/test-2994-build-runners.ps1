<#
  test-2994-build-runners.ps1

      pwsh -NoProfile -File .\tests\test-2994-build-runners.ps1

  Holds the cap on how many heavy jobs run on the box at once (#2994).
  On 21 October seven builds ran on the VPS together, each harness step took
  34 to 39 minutes instead of about 15, and the 40-minute limit cancelled
  three pull requests' builds that were passing. Past four at once the box's
  six cores finish no more builds an hour. So the heavy jobs ask for the
  label thornswood-build, which only the runners records\build-runners.json
  lists carry, and scripts\deploy\Set-BuildRunners.ps1 makes GitHub match it.
  The pull request build asks for records\pr-build-runners.json's label
  instead, which on the box only build runners carry, and not all of them:
  one is kept for main's build (#4010).

  Since the flip those jobs run in Thornswood-Ops, and no workflow here asks
  for a runner of the box (#4983). This reads the record and the workflows. Since #3107 the labels are put
  right by the box's admin service (scripts\vps\admin\admin.js), which
  github-admin.yml asks and Set-BuildRunners.ps1 starts; the rules this test
  held Set-BuildRunners.ps1 to before (a listed runner gets the label, any
  other loses it, an off-box runner never has it, a record whose runners
  GitHub does not have stops) are held there by tests\test-3107-admin.js,
  against stand-in runner lists. Asks GitHub nothing. A few seconds.
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
function Under([string[]]$parts) { [IO.Path]::Combine([string[]](@($Repo) + $parts)) }

# ---- 1. the record ---------------------------------------------------------------
$recPath = Under @('records', 'build-runners.json')
$rec = Get-Content -LiteralPath $recPath -Raw | ConvertFrom-Json
$nums = @($rec.runners | ForEach-Object { [int]$_ })
Yes "the record names the build label ($($rec.label))" ($rec.label -eq 'thornswood-build')
Yes "it lists the runners that carry it ($($nums -join ', '))" ($nums.Count -ge 1 -and @($nums | Where-Object { $_ -lt 1 }).Count -eq 0 -and @($nums | Sort-Object -Unique).Count -eq $nums.Count)
Yes '  no more than four: past four at once the box finishes no more builds an hour, each one only takes longer' ($nums.Count -le 4)
Yes '  and says what was measured' ("$($rec.measured)" -match 'jobs an hour' -and "$($rec.about)" -match 'Set-BuildRunners\.ps1')

# The pull request builds' record (#4010, Patrick's A, 27 Oct 2026): its box
# runners are build runners too, so the cap holds, and one build runner is
# not among them, kept for main's build.
$pr = Get-Content -LiteralPath (Under @('records', 'pr-build-runners.json')) -Raw | ConvertFrom-Json
$prNums = @($pr.runners | ForEach-Object { [int]$_ })
Yes "the pull request record names its own label ($($pr.label))" ($pr.label -eq 'thornswood-pr-build' -and $pr.label -ne $rec.label)
Yes "  its box runners ($($prNums -join ', ')) are build runners too, so the box's cap still holds" ($prNums.Count -ge 1 -and @($prNums | Where-Object { $nums -notcontains $_ }).Count -eq 0)
Yes '  and at least one build runner is not among them, kept for main''s build' (@($nums | Where-Object { $prNums -notcontains $_ }).Count -ge 1)
Yes '  the build record names no off-box runner: off the box only the pull request label is carried' (-not $rec.PSObject.Properties['offBox'])

# ---- 2. which jobs ask for it -----------------------------------------------------
# None here (#4983). The box's runners serve Thornswood-Ops alone since the
# flip (#4013), and since #5270 no job there asks for the build label: the
# gate under a trace (#3114) is gate-map.yml here, on GitHub's runner. Every
# workflow of this repository runs on GitHub's runners, the pull request
# build and main's build with no VPS fallback.
$wfDir = Under @('.github', 'workflows')
foreach ($l in @($rec.label, $pr.label, 'thornswood-vps')) {
    $on = @(Get-ChildItem -LiteralPath $wfDir -Filter *.yml | Where-Object { [IO.File]::ReadAllText($_.FullName) -match ('(?m)^\s*runs-on:.*\b' + [regex]::Escape($l) + '\b') } | ForEach-Object { $_.Name })
    Yes ("no workflow here asks for $l (" + ($on -join ', ') + ")") ($on.Count -eq 0)
}

# ---- 3. Install-Runner.ps1 registers a listed runner with it ----------------------
$ir = [IO.File]::ReadAllText((Under @('scripts', 'deploy', 'Install-Runner.ps1')))
Yes 'Install-Runner.ps1 reads the same record' ($ir -match [regex]::Escape('records\build-runners.json'))
Yes '  and registers with the labels it worked out' ($ir -match [regex]::Escape("--labels '`$registerLabels'"))
Yes '  never for an off-box runner' ($ir -match [regex]::Escape("if (-not `$OffBox -and -not `$PSBoundParameters.ContainsKey('Label'))"))
Yes '  and the pull request record too, for a box runner by number and an off-box one by name' ($ir -match [regex]::Escape('records\pr-build-runners.json') -and $ir -match [regex]::Escape("@(`$prRecord.offBox) -contains `$RunnerName") -and $ir -match [regex]::Escape("@(`$prRecord.runners | ForEach-Object { [int]`$_ }) -contains `$Number"))

# ---- 4. who puts it on GitHub ------------------------------------------------------
# Set-BuildRunners.ps1 calls no runner API itself: it starts github-admin.yml,
# whose run the box's admin service answers (#3107). The planning rules are
# in admin.js and run by tests\test-3107-admin.js.
$set = [IO.File]::ReadAllText((Under @('scripts', 'deploy', 'Set-BuildRunners.ps1')))
Yes 'Set-BuildRunners.ps1 starts github-admin.yml' ($set.Contains("`$workflow = 'github-admin.yml'") -and $set.Contains('Start-ThornswoodWorkflow'))
Yes '  and changes no label itself' ($set -notmatch 'actions/runners/|/labels')
Yes 'tests\test-3107-admin.js holds the rules' ((Test-Path -LiteralPath (Under @('tests', 'test-3107-admin.js'))) -and
    ([IO.File]::ReadAllText((Under @('tests', 'test-3107-admin.js')))).Contains('a record whose runners GitHub has none of is refused'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
