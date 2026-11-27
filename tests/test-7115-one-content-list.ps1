<#
  test-7115-one-content-list.ps1

      pwsh -NoProfile -File .\tests\test-7115-one-content-list.ps1

  Issue #7115. In the merge group for #7083 (run 45924876133, 6:54 PM
  Mountain, 26 Nov 2026) the job "Tree checks" asked GitHub's artifacts API
  for content-dev on its own, through .github/actions/lay-content, got one
  HTTP 502, and stopped with "GitHub did not list the artifacts named
  content-dev". The job "Pick the gate harnesses" of the same run had
  already listed and laid that build a minute before and handed it to the
  gate's shares as the artifact content-laid. So every build check asked
  the artifacts API twice where one answer was needed, and either answer
  failing failed the check, in the job that did not own the list.

  This reads build.yml and build-pr.yml (generated from it) and holds:
    1. the pick is the one job that lists the content builds
       (uses .github/actions/lay-content), and it hands its build on;
    2. "Tree checks" waits for the pick and runs only when it passed, so a
       failed list is said once, by the pick;
    3. "Tree checks" takes the pick's content-laid with GitHub's download
       step and lays it with Get-ContentBuild.ps1 -ArtifactDir, right after
       its checkout and before any check reads the tables;
    4. and holds no token: no actions: read and no github.token, so it can
       ask GitHub for nothing about the builds.
  Reads the files only.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# A job's text, from its id line to the next job id at two spaces.
function Job([string]$wf, [string]$id) {
    $at = $wf.IndexOf("`n  ${id}:`n")
    if ($at -lt 0) { return '' }
    $body = $wf.Substring($at + 1)
    $end = [regex]::Match($body.Substring(3), '\n  [a-z][a-z-]*:\n')
    if ($end.Success) { $body = $body.Substring(0, $end.Index + 3) }
    return $body
}
# Lines that are code, not comments.
function Code([string]$t) { return (($t -split "`n") | Where-Object { $_ -notmatch '^\s*#' }) -join "`n" }

$lay = 'uses: ./.github/actions/lay-content'
foreach ($f in 'build.yml', 'build-pr.yml') {
    $wf = ([IO.File]::ReadAllText((Join-Path $Repo ".github/workflows/$f")) -replace "`r`n", "`n")
    $pick = Job $wf 'pick'
    $checks = Job $wf 'checks'
    Yes "$f has its pick and its Tree checks jobs" ($pick -ne '' -and $checks -match '(?m)^    name: Tree checks$')

    # 1. One list of the content builds.
    $listers = @([regex]::Matches((Code $wf), [regex]::Escape($lay))).Count
    Yes "1. $f lists the content builds once, in the pick ($listers job(s) use lay-content)" ($listers -eq 1 -and (Code $pick).Contains($lay))
    Yes "1. $f`: the pick hands that build to the jobs after it as content-laid" ($pick -match '(?s)- name: Hand the build to the shares.*?name: content-laid\s')

    # 2. Tree checks waits for the pick.
    $needs = [regex]::Match($checks, '(?m)^    needs: (.+)$').Groups[1].Value
    $if = [regex]::Match($checks, '(?m)^    if: (.+)$').Groups[1].Value
    Yes "2. $f`: Tree checks needs the pick (needs: $needs)" ($needs -match '(^|[\[ ,])pick([\], ]|$)')
    Yes "2. $f`: and runs only when the pick passed, so a failed list is said once, by the pick" ($if -eq '' -or $if -match "needs\.pick\.result == 'success'")

    # 3. It lays the pick's build, right after its checkout.
    $steps = Code $checks
    $co = $steps.IndexOf('uses: actions/checkout@')
    $fetch = [regex]::Match($steps, "(?s)- name: Fetch the content build the pick laid\n        uses: actions/download-artifact@[0-9a-f]{40} # v\S+\n        with:\n          name: content-laid\n          path: \$\{\{ runner\.temp \}\}/content-laid\n")
    $layIt = [regex]::Match($steps, "(?s)- name: Lay the content build the pick laid\n        shell: pwsh\n        run: \|\n          \./scripts/release/Get-ContentBuild\.ps1 -Newest -ArtifactDir \(Join-Path \`$env:RUNNER_TEMP 'content-laid'\)\n          exit \`$LASTEXITCODE\n")
    $firstCheck = $steps.IndexOf('- name: Scan the tree for secrets')
    Yes "3. $f`: Tree checks fetches the pick's content-laid with GitHub's download step" ($fetch.Success)
    Yes "3. $f`: and lays it from that folder with Get-ContentBuild.ps1 -ArtifactDir" ($layIt.Success)
    Yes "3. $f`: after its checkout and before its first check" ($fetch.Success -and $layIt.Success -and $co -ge 0 -and $co -lt $fetch.Index -and $fetch.Index -lt $layIt.Index -and $firstCheck -gt $layIt.Index)

    # 4. No token to ask with.
    Yes "4. $f`: Tree checks holds no actions: read and hands no step the run's token" ($steps -notmatch '(?m)^      actions: read' -and $steps -notmatch 'github\.token|GH_TOKEN|secrets\.GITHUB_TOKEN')
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
