<#
  Nightly-Stray.ps1

  Names every pull request open more than two days and every branch with no
  open pull request, in this repository and in the engine fork, reading every
  page GitHub has. A repository's long-lived branches (below) are never
  named. A pull request labelled held is listed as held and does not count
  (#1273). Run by .github/workflows/nightly.yml in its step "Stray pull
  requests and branches", with GH_TOKEN and REPO set:

      .\scripts\dev\Nightly-Stray.ps1 -Run

  Exits 1 when it names anything, so the night is red and Nightly-Issue.ps1
  puts it on the board.

  WHY (issue #1201). The step this replaces read branches?per_page=100 and
  pulls?state=open&per_page=100 once each and never asked for page 2. With
  more than a hundred branches, which a day of claude/ and lane branches
  passes, a branch past the first page was never checked, and a branch whose
  open pull request was past the first page of pulls was called stray when it
  was not. This reads page by page until a page comes back short, the same
  way Nightly-Issue.ps1 reads the open issues.

  THE FORK (issue #4142). Every address was built from REPO, the workflow's
  own repository, so the engine fork, ThornswoodRP/skymp, was never read and
  its pull requests sat open for weeks with nothing naming them. The fork is
  read the same way, by the same rules, and what it names says which
  repository it is in.

  The token is the workflow's own GITHUB_TOKEN (pull-requests: read, contents:
  read). The fork is public, so that token reads its pull requests and
  branches too, as engine-prune.yml reads its branch. Nothing here prints it.

  tests\test-nightly-stray.ps1 runs this against a stand-in GitHub.
#>
[CmdletBinding()]
param(
    # Read GitHub and say what is stray. Without it the script only defines
    # its functions, which is how the harness loads it.
    [switch]$Run
)

$ErrorActionPreference = 'Stop'

# The engine fork, read beside REPO (#4142).
$ForkRepo = 'ThornswoodRP/skymp'

# The branches of a repository that live on with no pull request: the ones
# records\github-repo-settings.json protects by a ruleset. Thornswood's is its
# default branch, main. The fork's are thornswood/engine-changes, where its
# pull requests go, and main.
$LongLived = @{
    $ForkRepo = @('main', 'thornswood/engine-changes')
}
function Get-StrayLongLived {
    param([string]$Repo)
    if ($LongLived.ContainsKey($Repo)) { return $LongLived[$Repo] }
    return @('main')
}

# One call to the GitHub API. The tests replace Invoke-RestMethod under it.
function Invoke-StrayApi {
    param([string]$Path, [string]$Repo = $env:REPO)
    $h = @{ Authorization = "Bearer $env:GH_TOKEN"; 'User-Agent' = 'thornswood-nightly'; Accept = 'application/vnd.github+json' }
    # Into a variable first: Invoke-RestMethod hands a JSON array down the pipe
    # as one object, and returning the variable hands on its items.
    $r = Invoke-RestMethod -Method GET -Headers $h -Uri "https://api.github.com/repos/$Repo/$Path"
    return $r
}

# Every item of a list GitHub pages, 100 to a page, until a page comes back
# short. $Path may carry a query of its own; the page is added to it.
function Get-StrayPages {
    param([string]$Path, [string]$Repo = $env:REPO)
    $join = if ($Path.Contains('?')) { '&' } else { '?' }
    $all = @()
    $page = 1
    while ($true) {
        $batch = @(Invoke-StrayApi ($Path + $join + 'per_page=100&page=' + $page) $Repo)
        $all += $batch
        if ($batch.Count -lt 100) { break }
        $page++
        if ($page -gt 50) { throw ('More than 5,000 in ' + $Repo + ' ' + $Path + ': stopped reading pages.') }
    }
    return $all
}

# The label a pull request held back on purpose carries (#1273): one marker
# read exactly, where held work had four spellings in titles and none at all
# in others. A held pull request is listed every night and does not turn it
# red; the label comes off when it is let go.
$HeldLabel = 'held'

# The pull requests of one repository open more than $Days days, apart from
# the held ones, and its branches, other than the long-lived ones, that no
# open pull request is made from.
function Find-Stray {
    param([int]$Days = 2, [DateTime]$Now = [DateTime]::UtcNow, [string]$Repo = $env:REPO)
    $old = $Now.AddDays(-$Days)
    $pulls = @(Get-StrayPages 'pulls?state=open' $Repo)
    $aged = @($pulls | Where-Object { ([DateTime]$_.created_at).ToUniversalTime() -lt $old })
    $isHeld = { param($p) @($p.labels | ForEach-Object { [string]$_.name }) -contains $HeldLabel }
    $held = @($aged | Where-Object { & $isHeld $_ })
    $prs = @($aged | Where-Object { -not (& $isHeld $_) })
    $open = @($pulls | ForEach-Object { [string]$_.head.ref })
    $keep = @(Get-StrayLongLived $Repo)
    $branches = @(Get-StrayPages 'branches' $Repo | ForEach-Object { [string]$_.name } | Where-Object { $keep -notcontains $_ })
    $stray = @($branches | Where-Object { $open -notcontains $_ })
    return [pscustomobject]@{ Repo = $Repo; OldPulls = $prs; HeldPulls = $held; Stray = $stray; Branches = $branches.Count; Pulls = $pulls.Count }
}

# Every repository the night reads: this one, then the fork.
function Get-StrayRepos {
    return @($env:REPO, $ForkRepo | Select-Object -Unique)
}

if ($Run) {
    $oldCount = 0
    $strayCount = 0
    foreach ($r in Get-StrayRepos) {
        $found = Find-Stray -Repo $r
        # This repository's lines read as they always did; the fork's say where.
        $pr = if ($r -eq $env:REPO) { 'pull request #' } else { "pull request $r#" }
        $br = if ($r -eq $env:REPO) { 'branch ' } else { "branch of $r " }
        foreach ($p in $found.HeldPulls) { Write-Host ("::notice::{0}{1} is held ({2}), open since {3}: {4}" -f $pr, $p.number, $HeldLabel, $p.created_at, $p.title) }
        foreach ($p in $found.OldPulls) { Write-Host ("::error::{0}{1} has been open since {2}: {3}" -f $pr, $p.number, $p.created_at, $p.title) }
        foreach ($b in $found.Stray) { Write-Host ("::error::{0}{1} has no open pull request" -f $br, $b) }
        Write-Host ("{0}: read {1} branch(es) other than {2} and {3} open pull request(s), {4} of them old and held" -f $r, $found.Branches, ((Get-StrayLongLived $r) -join ' and '), $found.Pulls, $found.HeldPulls.Count)
        $oldCount += $found.OldPulls.Count
        $strayCount += $found.Stray.Count
    }
    if ($oldCount -or $strayCount) {
        Write-Host ("{0} old pull request(s), {1} stray branch(es)" -f $oldCount, $strayCount)
        exit 1
    }
    Write-Host 'no stray pull requests or branches'
    exit 0
}
