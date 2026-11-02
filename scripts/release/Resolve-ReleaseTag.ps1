<#
  Resolve-ReleaseTag.ps1

  Says which commit a launcher release builds, or refuses (#2202). The release
  workflow (.github/workflows/release.yml) can be started by hand with a free
  form tag input. It used to hand that string straight to actions/checkout and
  draft the release against the run's own SHA. A branch name, a bare SHA, a tag
  on a commit that never reached main, or a tag that has moved could then be
  built and labelled as a release, with provenance that did not match.

      . .\scripts\release\Resolve-ReleaseTag.ps1
      $commit = Resolve-ThornswoodReleaseTag -Tag v1.2.3 -RepoDir . [-ExpectedSha <sha>] [-MainRef origin/main]

  The tag has to be named v<version>, exist as a tag (refs/tags, not a branch
  or a SHA), point at a commit, and that commit has to be on -MainRef. With
  -ExpectedSha (a tag push's handover passes the commit the tag named when it
  was pushed, #3930; a manual run may pass one) the commit has to be that one
  as well. Anything else throws, naming the tag and why. Returns the full commit SHA. Reads git only; changes nothing.
  Runs in PowerShell 7.

  NO RELEASE IS BUILT FROM A COMMIT OFF MAIN (#3890). An expected SHA used to
  stand in for the main check, and a tag push always passes one, so a v tag
  pushed on a branch commit was built and signed without that commit ever
  going through a pull request (two trial tags were, in September and
  October). Patrick settled it on 27 Oct: never. The expected SHA now only
  narrows which commit on main; it never lets a commit off main through.
#>

function Invoke-ThornswoodReleaseGit([string]$RepoDir, [string[]]$GitArgs) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git -C $RepoDir @GitArgs 2>$null
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $code; Out = (@($out) -join "`n").Trim() }
}

function Resolve-ThornswoodReleaseTag {
    param(
        [Parameter(Mandatory)][string]$Tag,
        [string]$RepoDir = '.',
        [string]$ExpectedSha = '',
        [string]$MainRef = 'origin/main'
    )
    $Tag = $Tag.Trim()
    if ($Tag.StartsWith('refs/tags/')) { $Tag = $Tag.Substring('refs/tags/'.Length) }
    if ($Tag -notmatch '^v[0-9][0-9A-Za-z.\-]*$') {
        throw "Refused: '$Tag' is not a v<version> tag name. Nothing was built."
    }
    $r = Invoke-ThornswoodReleaseGit $RepoDir @('rev-parse', '--verify', '--quiet', ('refs/tags/' + $Tag + '^{commit}'))
    if ($r.Code -ne 0 -or $r.Out -notmatch '^[0-9a-f]{40}$') {
        throw "Refused: there is no tag $Tag in this repository (a branch or a SHA is not a release tag). Nothing was built."
    }
    $commit = $r.Out
    $ExpectedSha = $ExpectedSha.Trim().ToLowerInvariant()
    if ($ExpectedSha) {
        if ($ExpectedSha -notmatch '^[0-9a-f]{7,40}$') { throw "Refused: the expected SHA '$ExpectedSha' is not a commit SHA. Nothing was built." }
        if (-not $commit.StartsWith($ExpectedSha)) {
            throw ("Refused: tag {0} is commit {1}, not the expected {2}. Nothing was built." -f $Tag, $commit, $ExpectedSha)
        }
    }
    $m = Invoke-ThornswoodReleaseGit $RepoDir @('rev-parse', '--verify', '--quiet', ($MainRef + '^{commit}'))
    if ($m.Code -ne 0) { throw "Refused: $MainRef is not in this checkout, so it cannot be told whether tag $Tag is on it. Nothing was built." }
    $a = Invoke-ThornswoodReleaseGit $RepoDir @('merge-base', '--is-ancestor', $commit, $MainRef)
    if ($a.Code -ne 0) {
        throw ("Refused: tag {0} is commit {1}, which is not on {2}. A release is only built from a commit on main (#3890). Nothing was built." -f $Tag, $commit, $MainRef)
    }
    return $commit
}
