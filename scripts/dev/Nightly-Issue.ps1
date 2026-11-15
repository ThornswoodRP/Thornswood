<#
  Nightly-Issue.ps1

  Keeps one issue on the board for a failing nightly, and closes it the
  night the checks pass. Run by .github/workflows/nightly.yml as its last
  step, with GH_TOKEN, REPO and RUN set:

      .\scripts\dev\Nightly-Issue.ps1 -Result failure
      .\scripts\dev\Nightly-Issue.ps1 -Result success

  failure  the open "Nightly checks failed" issue gets a comment with the
           date and the run, and after it each failed test with its FAIL
           lines and the command that runs it alone (#4178), as
           Merge-HarnessReports.ps1 -Failed wrote them and nightly.yml hands
           them on in NIGHTLY_FAILED; with none open, one is opened.
  success  every open "Nightly checks failed" issue is closed, with a
           comment naming the green run, so nobody closes it by hand.

  WHY (issues #905 and #1120). On 29 September the step this replaces read
  only the first page of open issues, missed #905 (open since the 28th) once
  more than a hundred issues were open, and opened #1120 beside it. #1155
  made that step read every page; this also collapses any duplicates that
  are already open (the oldest is kept, the rest are closed pointing to it,
  whichever way the night went), and closes the issue the first night the
  checks pass. Until now each body said "close this once the nightly run is
  green again" and waited for a person, so a fixed nightly stayed on the
  board as a failure. A pull request is an issue to this API, and is
  skipped.

  The token is the workflow's own GITHUB_TOKEN (issues: write). Nothing
  here prints it.

  tests\test-nightly-issue.ps1 runs this against a stand-in GitHub.
#>
[CmdletBinding()]
param(
    [ValidateSet('failure', 'success', '')]
    [string]$Result = '',
    # The failed tests, as Merge-HarnessReports.ps1 -Failed wrote them; the
    # harness report job's output, in env.
    [string]$Failed = $env:NIGHTLY_FAILED
)

$ErrorActionPreference = 'Stop'

$script:NightlyTitle = 'Nightly checks failed'

# One call to the GitHub API. The tests replace this with a stand-in.
function Invoke-NightlyApi {
    param([string]$Method, [string]$Path, $Body = $null)
    $h = @{ Authorization = "Bearer $env:GH_TOKEN"; 'User-Agent' = 'thornswood-nightly'; Accept = 'application/vnd.github+json' }
    $uri = "https://api.github.com/repos/$env:REPO/$Path"
    # Into a variable first: Invoke-RestMethod hands a JSON array down the pipe
    # as one object, and returning the variable hands on its items.
    if ($null -ne $Body) {
        $r = Invoke-RestMethod -Method $Method -Headers $h -Uri $uri -Body ($Body | ConvertTo-Json) -ContentType 'application/json'
    } else {
        $r = Invoke-RestMethod -Method $Method -Headers $h -Uri $uri
    }
    return $r
}

# Every open issue (not pull request) with the title, oldest first, from
# every page, not only the first.
function Get-NightlyIssues {
    $found = @()
    $page = 1
    while ($true) {
        $batch = @(Invoke-NightlyApi 'GET' ("issues?state=open&sort=created&direction=asc&per_page=100&page=$page"))
        foreach ($i in $batch) {
            if ($i.pull_request) { continue }
            if ([string]$i.title -eq $script:NightlyTitle) { $found += $i }
        }
        if ($batch.Count -lt 100) { break }
        $page++
        if ($page -gt 50) { throw 'More than 5,000 open issues: stopped reading pages.' }
    }
    return @($found | Sort-Object { [int]$_.number })
}

function Close-NightlyIssue([int]$Number, [string]$Why) {
    [void](Invoke-NightlyApi 'POST' "issues/$Number/comments" @{ body = $Why })
    [void](Invoke-NightlyApi 'PATCH' "issues/$Number" @{ state = 'closed'; state_reason = 'completed' })
}

# What the step does. Returns one line saying what it did.
function Update-NightlyIssue {
    param([ValidateSet('failure', 'success')][string]$Result, [string]$Run, [string]$Day, [string]$Failed = '')
    $open = @(Get-NightlyIssues)
    $said = @()

    # One issue, never two: the oldest is kept, the others go as duplicates.
    if ($open.Count -gt 1) {
        $keep = $open[0]
        foreach ($d in ($open | Select-Object -Skip 1)) {
            Close-NightlyIssue ([int]$d.number) ("Closed by the nightly as a duplicate of #$($keep.number), which carries every failed night from here on.")
            $said += "closed #$($d.number) as a duplicate of #$($keep.number)"
        }
        $open = @($keep)
    }

    if ($Result -eq 'failure') {
        $line = "The nightly checks failed on ${Day}: $Run. The failed step says which check; the last lines of each harness job name every harness that failed or did not get to run."
        if ($Failed -and $Failed.Trim()) {
            $line += "`n`nThe tests that failed, each with its FAIL lines and the command that runs it alone from the repository's root:`n`n" + $Failed.Trim()
        }
        if ($open.Count) {
            [void](Invoke-NightlyApi 'POST' "issues/$($open[0].number)/comments" @{ body = $line })
            $said += "added to #$($open[0].number)"
        } else {
            $i = Invoke-NightlyApi 'POST' 'issues' @{ title = $script:NightlyTitle; body = ($line + "`n`nThe nightly closes this by itself the first night every check passes.") }
            $said += "opened #$($i.number)"
        }
    } else {
        foreach ($o in $open) {
            Close-NightlyIssue ([int]$o.number) ("The nightly checks passed on ${Day}: $Run. Closed by the nightly itself.")
            $said += "closed #$($o.number), the nightly passed"
        }
        if (-not $open.Count) { $said += 'nothing open, nothing to close' }
    }
    return ($said -join '; ')
}

if ($Result) {
    foreach ($n in 'GH_TOKEN', 'REPO', 'RUN') {
        if (-not [Environment]::GetEnvironmentVariable($n)) { throw "$n is not set. The nightly workflow sets it." }
    }
    $day = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
    Write-Host (Update-NightlyIssue -Result $Result -Run $env:RUN -Day $day -Failed $Failed)
}
