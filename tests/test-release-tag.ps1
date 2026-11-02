# test-release-tag.ps1
#
#     pwsh -NoProfile -File .\tests\test-release-tag.ps1
#
# The launcher release builds only a real v<version> tag on the commit meant,
# and only on main (#2202, #3890). Resolve-ThornswoodReleaseTag
# (scripts\release\Resolve-ReleaseTag.ps1) is run against a scratch git
# repository with a main, tags on and off it, a branch and a SHA. Then .github\workflows\release.yml is read for where it
# asks. Offline: nothing is fetched, built or released.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\release\Resolve-ReleaseTag.ps1')

$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Refusal([scriptblock]$b) { try { $null = & $b; return '' } catch { return $_.Exception.Message } }
function G { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $o = & git -C $script:src @args 2>$null } finally { $ErrorActionPreference = $old }; if ($LASTEXITCODE -ne 0) { throw "git $args failed" }; return "$o".Trim() }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-2202 [x] & ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$src = Join-Path $tmp 'repo'
$null = New-Item -ItemType Directory -Path $src
try {
    $null = G init -q -b main
    $null = G config user.email t@example.invalid
    $null = G config user.name test
    $null = G config commit.gpgsign false
    [IO.File]::WriteAllText((Join-Path $src 'a.txt'), "1`n"); $null = G add -A; $null = G commit -q -m one
    $one = G rev-parse HEAD
    $null = G tag v1.0.0
    $null = G tag -a v1.0.1 -m annotated
    $null = G checkout -q -b side
    [IO.File]::WriteAllText((Join-Path $src 'a.txt'), "side`n"); $null = G commit -q -am side
    $side = G rev-parse HEAD
    $null = G tag v9.9.9
    $null = G checkout -q main
    [IO.File]::WriteAllText((Join-Path $src 'a.txt'), "2`n"); $null = G commit -q -am two
    $two = G rev-parse HEAD
    $null = G tag v1.1.0
    $null = G branch vbranch

    Yes 'a tag on main gives its commit' ((Resolve-ThornswoodReleaseTag -Tag v1.1.0 -RepoDir $src -MainRef main) -eq $two)
    Yes 'an older tag on main does too' ((Resolve-ThornswoodReleaseTag -Tag v1.0.0 -RepoDir $src -MainRef main) -eq $one)
    Yes 'an annotated tag gives the commit, not the tag object' ((Resolve-ThornswoodReleaseTag -Tag v1.0.1 -RepoDir $src -MainRef main) -eq $one)
    Yes 'refs/tags/ in front is accepted' ((Resolve-ThornswoodReleaseTag -Tag refs/tags/v1.1.0 -RepoDir $src -MainRef main) -eq $two)
    $why = Refusal { Resolve-ThornswoodReleaseTag -Tag v9.9.9 -RepoDir $src -MainRef main }
    Yes 'a tag off main is refused, naming the tag, the commit and main' ($why -match '^Refused: tag v9\.9\.9 is commit' -and $why.Contains($side) -and $why -match 'not on main')
    # #3890 (Patrick, 27 Oct: never): the expected SHA is not a way past main.
    # A tag push always passes its own SHA, so this is a v tag pushed on a
    # branch commit, which used to be built and signed.
    $why = Refusal { Resolve-ThornswoodReleaseTag -Tag v9.9.9 -RepoDir $src -ExpectedSha $side -MainRef main }
    Yes '  even when its commit is the expected SHA (a tag pushed on a branch)' ($why -match '^Refused: tag v9\.9\.9 is commit' -and $why.Contains($side) -and $why -match 'not on main' -and $why.Contains('#3890'))
    Yes '  and with a short expected SHA too' ((Refusal { Resolve-ThornswoodReleaseTag -Tag v9.9.9 -RepoDir $src -ExpectedSha $side.Substring(0, 10) -MainRef main }) -match 'not on main')
    Yes '  and the refusal no longer offers the expected SHA as the way round' (-not $why.Contains('Pass the commit as the expected SHA'))
    Yes '  and a short expected SHA on main still passes' ((Resolve-ThornswoodReleaseTag -Tag v1.1.0 -RepoDir $src -ExpectedSha $two.Substring(0, 10) -MainRef main) -eq $two)
    Yes '  and an expected SHA with no main to check against is refused, not let by' ((Refusal { Resolve-ThornswoodReleaseTag -Tag v1.1.0 -RepoDir $src -ExpectedSha $two -MainRef origin/main }) -match 'origin/main is not in this checkout')
    $why = Refusal { Resolve-ThornswoodReleaseTag -Tag v1.1.0 -RepoDir $src -ExpectedSha $one -MainRef main }
    Yes 'a tag that is not the expected SHA is refused, even on main' ($why -match 'not the expected' -and $why.Contains($two))
    Yes 'a tag push: its own SHA is the expected one and passes' ((Resolve-ThornswoodReleaseTag -Tag v1.1.0 -RepoDir $src -ExpectedSha $two -MainRef main) -eq $two)
    Yes 'an expected SHA that is not a SHA is refused' ((Refusal { Resolve-ThornswoodReleaseTag -Tag v1.1.0 -RepoDir $src -ExpectedSha 'main' -MainRef main }) -match 'not a commit SHA')
    Yes 'a branch named like a tag is refused: not a tag' ((Refusal { Resolve-ThornswoodReleaseTag -Tag vbranch -RepoDir $src -MainRef main }) -match "not a v<version> tag name|there is no tag")
    Yes 'main itself is refused' ((Refusal { Resolve-ThornswoodReleaseTag -Tag main -RepoDir $src -MainRef main }) -match 'not a v<version> tag name')
    Yes 'a bare SHA is refused' ((Refusal { Resolve-ThornswoodReleaseTag -Tag $two -RepoDir $src -MainRef main }) -match 'not a v<version> tag name')
    Yes 'a v-name that is no tag is refused' ((Refusal { Resolve-ThornswoodReleaseTag -Tag v2.0.0 -RepoDir $src -MainRef main }) -match 'there is no tag v2\.0\.0')
    Yes 'a name with a ref trick in it is refused' ((Refusal { Resolve-ThornswoodReleaseTag -Tag 'v1.1.0^{tree}' -RepoDir $src -MainRef main }) -match 'not a v<version> tag name')
    Yes 'a main that is not there is refused, not guessed' ((Refusal { Resolve-ThornswoodReleaseTag -Tag v1.1.0 -RepoDir $src -MainRef origin/main }) -match 'origin/main is not in this checkout')
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- where the workflow asks
$wf = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\release.yml')).Replace("`r`n", "`n")
$co = $wf.IndexOf('uses: actions/checkout@')
$ask = $wf.IndexOf('Resolve-ThornswoodReleaseTag -Tag $tag')
$build = $wf.IndexOf('.\scripts\release\Build-Launcher.ps1 -Root')
Yes 'release.yml checks out its own commit with every tag and main (fetch-depth 0), not the input' ($co -gt 0 -and $wf.Contains('fetch-depth: 0') -and -not $wf.Contains('ref: ${{ github.event.inputs.tag'))
Yes '  asks Resolve-ThornswoodReleaseTag after that and before the build' ($ask -gt $co -and $build -gt $ask)
Yes '  the expected_sha input says the tag''s commit must be on main either way (#3890)' ($wf.Contains("the tag's commit must be on main either way") -and -not $wf.Contains('without it the tag''s commit must be on main'))
Yes '  a manual run takes the tag and expected_sha through env, and only a manual run builds (#3930)' ($wf.Contains('INPUT_SHA: ${{ github.event.inputs.expected_sha }}') -and $wf.Contains('$tag = $env:INPUT_TAG; $expected = $env:INPUT_SHA') -and $wf.Contains("if (`$env:GITHUB_EVENT_NAME -ne 'workflow_dispatch')") -and $wf.Contains('expected_sha:'))
Yes '  a tag push hands its own ref name and SHA to main''s run as those inputs' ($wf.Contains('inputs = @{ tag = $env:GITHUB_REF_NAME; expected_sha = $env:GITHUB_SHA }'))
Yes '  stops the run on a refusal and checks out exactly the commit it settled' ($wf.Contains("catch { Write-Host ('::error::' + `$_.Exception.Message); exit 1 }") -and $wf.Contains('git checkout --force --detach $commit') -and $wf.Contains('if ($head -ne $commit)'))
Yes '  and drafts the release against that commit, not the run''s SHA' ($wf.Contains('target_commitish = $env:RELEASE_COMMIT') -and -not $wf.Contains('target_commitish = $env:GITHUB_SHA') -and $wf.Contains('RELEASE_COMMIT: ${{ steps.tag.outputs.commit }}'))
# The concurrency group names the tag too (#2163: one group per tag, so a tag
# push and a manual run for it queue). A group is a name GitHub compares,
# never script text, so that one line is not a paste; nothing else is let by.
$pasted = @($wf -split "`n" | Where-Object { $_.Contains('${{ github.event.inputs') -and $_ -notmatch '^\s+INPUT_[A-Z]+: \$\{\{ github\.event\.inputs\.\w+ \}\}$' -and $_ -notmatch '^  group: release-\$\{\{ github\.event\.inputs\.tag \|\| github\.ref_name \}\}$' })
Yes '  no input is pasted anywhere but an env line' ($pasted.Count -eq 0)

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
