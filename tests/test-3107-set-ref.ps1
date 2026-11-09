<#
  test-3107-set-ref.ps1

      pwsh -NoProfile -File .\tests\test-3107-set-ref.ps1

  A cloud session's git cannot write refs: the cloud environment's proxy
  refuses a tag push and every ref write (#3107, #3314). So a session asks
  .github\workflows\git-ref.yml, through scripts\ops\Set-Ref.ps1, to make a
  release tag or delete a branch with the run's own token, and Ship's tag
  step does that in a cloud session (Release-Name.ps1, Add-ReleaseTag).

  WHAT IT HOLDS THEM TO.
    1. git-ref.yml: started by hand only; a token that can write refs and
       read pull requests and nothing else; on GitHub's runner with a
       timeout; no token kept by the checkout; main's Set-Ref.ps1 -OnGitHub under pwsh with no
       profile; the inputs reach it through the environment, nothing pasted
       into its script.
    2. Set-Ref.ps1 -OnGitHub, the workflow's half, against a stand-in for
       GitHub's REST answers that writes down each call:
       - a release tag on a commit main has is one annotated tag object, by
         github-actions[bot], with the message, then its ref; the answer is
         TAGGED, as an annotation titled Set-Ref;
       - a tag already on that commit is ALREADY and makes nothing; one on
         another commit, a v<...> or any other name, a commit main does not
         have, a commit GitHub does not know, an empty message and a short
         commit id each stop with why and make nothing;
       - a branch at the commit given, with no open pull request from it or
         onto it, is one DELETE, its name escaped part by part with the
         slashes kept; the answer is DELETED;
       - a branch already gone, or gone between the read and the delete, is
         GONE; a branch that moved on, one an open pull request comes from
         or is built onto, and the default branch each stop and delete
         nothing.
       - a tag at the commit given, through its tag object, with no release
         on it, is one DELETE of its ref, DELETED; one gone is GONE; one on
         another commit, or with a release on it (a draft too, read past the
         first page of releases), stays (#4177);
       - a draft is one DELETE, DRAFT-DELETED; one gone is DRAFT-GONE; a
         published release is refused;
       - nothing publishes a launcher draft or puts one back on its tag any
         more (#5385): the old inputs do nothing but stop the run.
    3. Set-Ref.ps1 in a session, against a stand-in for gh: it starts
       git-ref.yml on main with the inputs on gh's standard input, reads the
       runner's annotation and says what it did, exit 0; a stopped runner is
       1; a run not ended in time is 2 with the -Run line; and a name it would
       refuse is refused before anything is started. -Fork starts the fork's
       thornswood-git-ref.yml instead, for a branch only. -DeleteTag
       and -DeleteDraft send their one input each, and -PublishLauncher and
       -RetagLauncher are no parameters of it.
    4. Add-ReleaseTag in a cloud session (CLAUDE_CODE_REMOTE true): it hands
       the tag, the commit and the release's own message to the checkout's
       Set-Ref.ps1 and tags nothing in the checkout; a refusal says what to
       run, and a run that had not ended is said without one.

  Nothing connects anywhere. Everything it writes is in its own temp folder.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$setRef = Join-Path $repo 'scripts/ops/Set-Ref.ps1'
$wf = Join-Path $repo '.github/workflows/git-ref.yml'
Yes 'scripts/ops/Set-Ref.ps1 is there' (Test-Path -LiteralPath $setRef)
Yes '.github/workflows/git-ref.yml is there' (Test-Path -LiteralPath $wf)
if (-not (Test-Path -LiteralPath $setRef) -or -not (Test-Path -LiteralPath $wf)) { Done }
$e = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($setRef, [ref]$null, [ref]$e)
Yes 'Set-Ref.ps1 parses' (@($e).Count -eq 0)

# ---- 1. the workflow ---------------------------------------------------------
Write-Host ''; Write-Host 'the workflow'
$y = [IO.File]::ReadAllText($wf) -replace "`r`n", "`n"
$code = (@($y -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n")
$on = [regex]::Match($code, '(?ms)^on:\n(.*?)^\S').Groups[1].Value
Yes 'it is started by hand and by nothing else' ($on -match '^\s{2}workflow_dispatch:' -and @([regex]::Matches($on, '(?m)^  \S')).Count -eq 1)
$perm = [regex]::Match($code, '(?ms)^permissions:\n(.*?)^\S').Groups[1].Value.Trim()
Yes ("its token writes refs, reads pull requests and starts release-files.yml (#3686), nothing else ($($perm -replace '\s+', ' '))") ($perm -eq "contents: write`n  pull-requests: read`n  actions: write")
Yes '  and no job asks for more' ($code -notmatch '(?m)^    permissions:')
Yes 'it runs on GitHub''s Windows runner (#3685, #4983)' ($code -match ('(?m)^    runs-on: ' + [regex]::Escape('windows-latest') + '$'))
Yes '  with a timeout' ($code -match '(?m)^    timeout-minutes: \d+$')
Yes '  in no environment, so it holds no secret' ($code -notmatch '(?m)^\s+environment:' -and $code -notmatch 'secrets\.')
Yes 'the checkout keeps no token' ($code -match 'uses: actions/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+persist-credentials: false')
$step = [regex]::Match($code, '(?ms)- name: Make the tag or delete the branch\n(.*?)(?=^\s+- name: |\z)').Groups[1].Value
Yes 'the step is pwsh with no profile' ($step -match "shell: pwsh -NoProfile -NonInteractive -Command `". '\{0\}'`"")
$run = [regex]::Match($step, '(?ms)run: \|\n(.*)$').Groups[1].Value
Yes '  running main''s Set-Ref.ps1 -OnGitHub' ($run -match "scripts/ops/Set-Ref\.ps1'\) -OnGitHub")
Yes '  with nothing pasted into its script' ($run -notmatch '\$\{\{')
# After a release tag it made, it starts release-files.yml by name (#3686):
# a tag the run's own token makes starts no workflow by itself.
$next = [regex]::Match($code, '(?ms)- name: Start release-files\.yml for the release tag\n(.*?)(?=^\s+- name: |\z)').Groups[1].Value
$nextRun = [regex]::Match($next, '(?ms)run: \|\n(.*)$').Groups[1].Value
Yes 'then it starts release-files.yml, for a tag only' ($next -match "(?m)^\s+if: \$\{\{ inputs\.tag != '' \}\}$" -and $nextRun -match 'actions/workflows/release-files\.yml/dispatches')
Yes '  only for a release tag, read from the environment, nothing pasted into its script' ($nextRun -match '\$env:REF_TAG -notmatch' -and $nextRun -notmatch '\$\{\{')
foreach ($k in 'REF_TAG: ${{ inputs.tag }}', 'REF_DELETE_BRANCH: ${{ inputs.delete_branch }}', 'REF_DELETE_TAG: ${{ inputs.delete_tag }}', 'REF_DELETE_DRAFT: ${{ inputs.delete_draft }}', 'REF_COMMIT: ${{ inputs.commit }}', 'REF_MESSAGE: ${{ inputs.message }}', 'GH_TOKEN: ${{ github.token }}') {
    Yes "  $($k.Split(':')[0]) reaches it through the environment" ($step.Contains($k))
}

# ---- 2. the GitHub half ------------------------------------------------------
Write-Host ''; Write-Host 'the GitHub half'
$main = 'a' * 40
$other = 'b' * 40
$tagObj = 'c' * 40
$newObj = 'd' * 40
# What the stand-in GitHub holds for a case, and every call made of it.
$global:TSgh = $null
$global:TScalls = @()
function Invoke-WebRequest {
    param($Method, $Uri, $Headers, $Body, $ContentType, [switch]$SkipHttpErrorCheck, $TimeoutSec, $OutFile, [switch]$PassThru)
    $p = ([string]$Uri).Substring(('https://api.test/repos/owner/repo/').Length)
    $global:TScalls += ,([pscustomobject]@{ Method = $Method; Path = $p; Body = $(if ($Body) { $Body | ConvertFrom-Json } else { $null }); Auth = $Headers.Authorization })
    $s = $global:TSgh
    function A([int]$c, $o) { return [pscustomobject]@{ StatusCode = $c; Content = $(if ($null -ne $o) { ConvertTo-Json -InputObject $o -Depth 6 -Compress } else { '' }) } }
    if ($Method -eq 'GET' -and $p -match '^compare/([0-9a-f]{40})\.\.\.main$') {
        if ($s.compare.ContainsKey($Matches[1])) { return (A 200 @{ status = $s.compare[$Matches[1]] }) }
        return (A 404 @{ message = 'Not Found' })
    }
    if ($Method -eq 'GET' -and $p -match '^git/ref/(.+)$') {
        $r = [Uri]::UnescapeDataString($Matches[1])
        if ($s.refs.ContainsKey($r)) { return (A 200 @{ ref = "refs/$r"; object = $s.refs[$r] }) }
        return (A 404 @{ message = 'Not Found' })
    }
    if ($Method -eq 'GET' -and $p -match '^git/tags/([0-9a-f]{40})$') { return (A 200 @{ sha = $Matches[1]; object = @{ type = 'commit'; sha = $s.tagObjects[$Matches[1]] } }) }
    if ($Method -eq 'POST' -and $p -eq 'git/tags') { return (A 201 @{ sha = $newObj }) }
    if ($Method -eq 'POST' -and $p -eq 'git/refs') { return (A $s.postRef @{ ref = 'x' }) }
    if ($Method -eq 'GET' -and $p -match '^pulls\?state=open&per_page=100&head=') { return (A 200 @($s.from | ForEach-Object { @{ number = $_ } })) }
    if ($Method -eq 'GET' -and $p -match '^pulls\?state=open&per_page=100&base=') { return (A 200 @($s.onto | ForEach-Object { @{ number = $_ } })) }
    # raced: the ref went between the read and the delete, so the delete
    # answers 422 and a read after it 404. Without it a 422 leaves the ref,
    # the way a ruleset's refusal does.
    if ($Method -eq 'DELETE' -and $p -match '^git/refs/((heads|tags)/.+)$') {
        if ($s.raced) { $s.refs.Remove([Uri]::UnescapeDataString($Matches[1])) }
        return (A $s.delete $(if ($s.delete -eq 422 -and -not $s.raced) { @{ message = 'Repository rule violations found' } } else { $null }))
    }
    if ($Method -eq 'GET' -and $p -match '^releases\?per_page=100&page=(\d+)$') {
        return (A 200 @(@($s.releases) | Select-Object -Skip ((([int]$Matches[1]) - 1) * 100) -First 100))
    }
    if ($Method -eq 'GET' -and $p -match '^releases/assets/(\d+)$') {
        if ($s.assetCode -ne 200) { return (A $s.assetCode @{ message = 'no' }) }
        # An asset with a body (SHA256SUMS) is those bytes; any other is a
        # line that names it.
        $id = $Matches[1]
        $one = @(@($s.releases) | ForEach-Object { @($_.assets) } | Where-Object { $_ -is [hashtable] -and [string]$_['id'] -eq $id })
        $text = if ($one.Count -and $one[0].ContainsKey('body')) { [string]$one[0]['body'] } else { "asset $id" }
        [IO.File]::WriteAllText($OutFile, $text)
        return (A 200 $null)
    }
    if ($Method -eq 'GET' -and $p -match '^releases/(\d+)$') {
        $r = @(@($s.releases) | Where-Object { [string]$_.id -eq $Matches[1] })
        if ($r.Count) { return (A 200 $r[0]) }
        return (A 404 @{ message = 'Not Found' })
    }
    if ($Method -eq 'DELETE' -and $p -match '^releases/\d+$') { return (A $s.delete $null) }
    if ($Method -eq 'PATCH' -and $p -match '^releases/(\d+)$') {
        # GitHub keeps what the edit names, unless the case says it does not.
        if (-not $s['patchIgnored']) {
            $id = $Matches[1]; $b = $Body | ConvertFrom-Json
            foreach ($rel in @(@($s.releases) | Where-Object { [string]$_.id -eq $id })) {
                foreach ($q in $b.PSObject.Properties) { $rel | Add-Member -NotePropertyName $q.Name -NotePropertyValue $q.Value -Force }
            }
        }
        return (A 200 @{ id = 1 })
    }
    return (A 500 @{ message = "the stand-in has no answer for $Method $p" })
}
function OnGitHub([hashtable]$envs, [hashtable]$state) {
    $base = @{ compare = @{ $main = 'ahead' }; refs = @{}; tagObjects = @{}; postRef = 201; from = @(); onto = @(); delete = 204; raced = $false; releases = @(); assetCode = 200 }
    foreach ($k in $state.Keys) { $base[$k] = $state[$k] }
    $global:TSgh = $base
    $global:TScalls = @()
    $all = @{ GITHUB_ACTIONS = 'true'; GH_TOKEN = 'run-token'; GITHUB_REPOSITORY = 'owner/repo'; GITHUB_API_URL = 'https://api.test'
              REF_TAG = ''; REF_DELETE_BRANCH = ''; REF_DELETE_TAG = ''; REF_DELETE_DRAFT = ''; REF_PUBLISH_LAUNCHER = ''; REF_RETAG_LAUNCHER = ''
              REF_COMMIT = $main; REF_MESSAGE = ''; REF_DEFAULT_BRANCH = 'main' }
    foreach ($k in $envs.Keys) { $all[$k] = $envs[$k] }
    $was = @{}
    foreach ($k in $all.Keys) { $was[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $all[$k]) }
    try {
        $global:LASTEXITCODE = 0
        $out = @(& $global:TSscript -OnGitHub 6>&1 2>&1 | ForEach-Object { "$_" })
        $rc = $LASTEXITCODE
    } finally {
        foreach ($k in $was.Keys) { [Environment]::SetEnvironmentVariable($k, $was[$k]) }
    }
    return [pscustomobject]@{ Out = ($out -join "`n"); Code = $rc; Calls = @($global:TScalls) }
}
function Writes($r) { return @($r.Calls | Where-Object { $_.Method -ne 'GET' }) }
$global:TSscript = $setRef

$msg = "Thornswood dev release 20261022-154916-dev`n`nlauncher  1.2.6.6`npacks     none"
$t = 'release/dev/20261022-154916-dev'
$r = OnGitHub @{ REF_TAG = $t; REF_MESSAGE = $msg } @{}
$w = @(Writes $r)
Yes ("a release tag on a commit main has: exit 0, TAGGED ($($r.Code))") ($r.Code -eq 0 -and $r.Out -match "::notice title=Set-Ref::TAGGED $([regex]::Escape($t)) $main")
Yes '  one annotated tag object on the commit, with the message, by github-actions[bot]' (
    $w.Count -eq 2 -and $w[0].Path -eq 'git/tags' -and $w[0].Body.tag -eq $t -and $w[0].Body.object -eq $main -and $w[0].Body.type -eq 'commit' -and
    $w[0].Body.message -eq ($msg + "`n") -and $w[0].Body.tagger.name -eq 'github-actions[bot]')
Yes '  then its ref, on that object' ($w[1].Path -eq 'git/refs' -and $w[1].Body.ref -eq "refs/tags/$t" -and $w[1].Body.sha -eq $newObj)
Yes '  every call with the run''s own token' (@($r.Calls | Where-Object { $_.Auth -ne 'Bearer run-token' }).Count -eq 0)
$r = OnGitHub @{ REF_TAG = 'release/main/20261017-205912'; REF_MESSAGE = 'Thornswood main release 20261017-205912' } @{}
Yes 'a main release tag is made the same way' ($r.Code -eq 0 -and @(Writes $r).Count -eq 2)

$r = OnGitHub @{ REF_TAG = $t; REF_MESSAGE = $msg } @{ refs = @{ "tags/$t" = @{ type = 'tag'; sha = $tagObj } }; tagObjects = @{ $tagObj = $main } }
Yes 'a tag already on that commit: ALREADY, exit 0, nothing made' ($r.Code -eq 0 -and $r.Out -match 'Set-Ref::ALREADY' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_TAG = $t; REF_MESSAGE = $msg } @{ refs = @{ "tags/$t" = @{ type = 'tag'; sha = $tagObj } }; tagObjects = @{ $tagObj = $other } }
Yes 'a tag already on another commit: left alone, exit 1' ($r.Code -eq 1 -and $r.Out -match '::error title=Set-Ref::.*already names commit' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_TAG = $t; REF_MESSAGE = $msg } @{ postRef = 422 }
Yes 'a ref GitHub says is there by the time it is made, read back' ($r.Code -eq 1 -and $r.Out -match 'Set-Ref::' -and @($r.Calls | Where-Object { $_.Path -like 'git/ref/tags/*' }).Count -eq 2)
foreach ($bad in 'v1.2.6.6', 'release/dev/20261022-154916', 'release/main/20261022-154916-dev', 'release/dev/../main/x', 'refs/heads/main') {
    $r = OnGitHub @{ REF_TAG = $bad; REF_MESSAGE = $msg } @{}
    Yes "  $bad is not a release tag: refused, nothing asked" ($r.Code -eq 1 -and $r.Calls.Count -eq 0)
}
$r = OnGitHub @{ REF_TAG = $t; REF_MESSAGE = $msg; REF_COMMIT = $other } @{ compare = @{ $other = 'diverged' } }
Yes 'a commit main does not have: refused, nothing made' ($r.Code -eq 1 -and $r.Out -match 'is not on main' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_TAG = $t; REF_MESSAGE = $msg; REF_COMMIT = $other } @{}
Yes 'a commit GitHub does not know: refused, nothing made' ($r.Code -eq 1 -and $r.Out -match 'has no commit' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_TAG = $t; REF_MESSAGE = '   ' } @{}
Yes 'an empty message: refused' ($r.Code -eq 1 -and $r.Calls.Count -eq 0)
$r = OnGitHub @{ REF_TAG = $t; REF_MESSAGE = $msg; REF_COMMIT = 'aaaaaaa' } @{}
Yes 'a short commit id: refused' ($r.Code -eq 1 -and $r.Calls.Count -eq 0)
$r = OnGitHub @{ REF_TAG = $t; REF_DELETE_BRANCH = 'claude/x'; REF_MESSAGE = $msg } @{}
Yes 'a tag and a branch at once: refused' ($r.Code -eq 1 -and $r.Calls.Count -eq 0)
$r = OnGitHub @{} @{}
Yes 'neither: refused' ($r.Code -eq 1 -and $r.Calls.Count -eq 0)

$b = 'claude/old-idea'
$r = OnGitHub @{ REF_DELETE_BRANCH = $b } @{ refs = @{ "heads/$b" = @{ type = 'commit'; sha = $main } } }
$w = @(Writes $r)
Yes ("a branch at the commit given, nothing open on it: one DELETE, exit 0, DELETED ($($r.Code))") ($r.Code -eq 0 -and $r.Out -match "Set-Ref::DELETED $([regex]::Escape($b))" -and $w.Count -eq 1 -and $w[0].Method -eq 'DELETE')
Yes '  its name escaped part by part, the slashes kept' ($w[0].Path -eq 'git/refs/heads/claude/old-idea')
Yes '  after asking for open pull requests from it and onto it' (@($r.Calls | Where-Object { $_.Path -match 'head=owner%3Aclaude%2Fold-idea|head=owner:claude%2Fold-idea' }).Count -eq 1 -and @($r.Calls | Where-Object { $_.Path -match 'base=claude%2Fold-idea' }).Count -eq 1)
$r = OnGitHub @{ REF_DELETE_BRANCH = $b } @{}
Yes 'a branch already gone: GONE, exit 0, nothing deleted' ($r.Code -eq 0 -and $r.Out -match 'Set-Ref::GONE' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_DELETE_BRANCH = $b } @{ refs = @{ "heads/$b" = @{ type = 'commit'; sha = $main } }; delete = 422; raced = $true }
Yes 'a branch gone between the read and the delete: GONE, exit 0' ($r.Code -eq 0 -and $r.Out -match 'Set-Ref::GONE')
$r = OnGitHub @{ REF_DELETE_BRANCH = $b } @{ refs = @{ "heads/$b" = @{ type = 'commit'; sha = $main } }; delete = 422 }
Yes 'a branch delete a rule refuses (422, still there when read again): exit 1, with what GitHub said' ($r.Code -eq 1 -and $r.Out -notmatch 'Set-Ref::GONE' -and $r.Out -match 'did not delete' -and $r.Out -match 'Repository rule violations')
$r = OnGitHub @{ REF_DELETE_BRANCH = $b } @{ refs = @{ "heads/$b" = @{ type = 'commit'; sha = $other } } }
Yes 'a branch that moved on: stays, exit 1' ($r.Code -eq 1 -and $r.Out -match 'stays' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_DELETE_BRANCH = $b } @{ refs = @{ "heads/$b" = @{ type = 'commit'; sha = $main } }; from = @(3300) }
Yes 'a branch an open pull request comes from: stays, says which' ($r.Code -eq 1 -and $r.Out -match '#3300' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_DELETE_BRANCH = $b } @{ refs = @{ "heads/$b" = @{ type = 'commit'; sha = $main } }; onto = @(3301) }
Yes 'a branch an open pull request is built onto: stays' ($r.Code -eq 1 -and $r.Out -match '#3301' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_DELETE_BRANCH = 'main' } @{ refs = @{ 'heads/main' = @{ type = 'commit'; sha = $main } } }
Yes 'the default branch: never' ($r.Code -eq 1 -and $r.Calls.Count -eq 0)
foreach ($bad in 'claude/../main', '/x', 'x/', 'a b', 'x.lock') {
    $r = OnGitHub @{ REF_DELETE_BRANCH = $bad } @{}
    Yes "  '$bad' is not a branch name it deletes" ($r.Code -eq 1 -and $r.Calls.Count -eq 0)
}

# A tag (#4177): the record of what it named is the caller's, so it goes
# only at the commit given, and never from under a release.
$dt = 'release/dev/20261003-173559-dev'
$atTag = @{ refs = @{ "tags/$dt" = @{ type = 'tag'; sha = $tagObj } }; tagObjects = @{ $tagObj = $main } }
$r = OnGitHub @{ REF_DELETE_TAG = $dt } $atTag
$w = @(Writes $r)
Yes ("a tag at the commit given, no release on it: one DELETE of its ref, exit 0, DELETED ($($r.Code))") ($r.Code -eq 0 -and $r.Out -match "Set-Ref::DELETED $([regex]::Escape($dt)) $main" -and $w.Count -eq 1 -and $w[0].Method -eq 'DELETE' -and $w[0].Path -eq "git/refs/tags/$dt")
Yes '  after reading the commit through its tag object' (@($r.Calls | Where-Object { $_.Path -eq "git/tags/$tagObj" }).Count -eq 1)
$r = OnGitHub @{ REF_DELETE_TAG = 'live-1.1.94' } @{ refs = @{ 'tags/live-1.1.94' = @{ type = 'commit'; sha = $main } } }
Yes 'a lightweight tag on the commit given: DELETED' ($r.Code -eq 0 -and $r.Out -match 'Set-Ref::DELETED live-1\.1\.94')
$r = OnGitHub @{ REF_DELETE_TAG = $dt } @{}
Yes 'a tag already gone: GONE, exit 0, nothing deleted' ($r.Code -eq 0 -and $r.Out -match 'Set-Ref::GONE' -and @(Writes $r).Count -eq 0)
# #4177, 31 Oct: the release tags ruleset (refs/tags/v*) refused the run's
# delete of v1.1.47 with 422, and this said GONE with the tag still there.
$s2 = $atTag.Clone(); $s2.refs = @{ "tags/$dt" = $atTag.refs["tags/$dt"] }; $s2.delete = 422
$r = OnGitHub @{ REF_DELETE_TAG = $dt } $s2
Yes 'a tag delete a rule refuses (422, still there when read again): exit 1, never GONE, with what GitHub said' ($r.Code -eq 1 -and $r.Out -notmatch 'Set-Ref::GONE' -and $r.Out -match 'did not delete' -and $r.Out -match 'Repository rule violations')
Yes '  having read it again after the delete' (@($r.Calls | Where-Object { $_.Method -eq 'GET' -and $_.Path -eq "git/ref/tags/$dt" }).Count -eq 2)
$s2 = $atTag.Clone(); $s2.refs = @{ "tags/$dt" = $atTag.refs["tags/$dt"] }; $s2.delete = 422; $s2.raced = $true
$r = OnGitHub @{ REF_DELETE_TAG = $dt } $s2
Yes 'a tag gone between the read and the delete: GONE, exit 0' ($r.Code -eq 0 -and $r.Out -match 'Set-Ref::GONE')
$r = OnGitHub @{ REF_DELETE_TAG = $dt; REF_COMMIT = $other } $atTag
Yes 'a tag on another commit than the one given: stays, exit 1' ($r.Code -eq 1 -and $r.Out -match 'so it stays' -and @(Writes $r).Count -eq 0)
$many = @(1..100 | ForEach-Object { [pscustomobject]@{ id = $_; tag_name = "v0.0.$_"; draft = $false } }) + @([pscustomobject]@{ id = 397526532; tag_name = $dt; draft = $true })
$s2 = $atTag.Clone(); $s2.releases = $many
$r = OnGitHub @{ REF_DELETE_TAG = $dt } $s2
Yes 'a tag a draft is on, on the second page of releases: stays, says which' ($r.Code -eq 1 -and $r.Out -match '397526532 \(a draft\)' -and @(Writes $r).Count -eq 0)
$s2 = $atTag.Clone(); $s2.releases = @([pscustomobject]@{ id = 5; tag_name = $dt; draft = $false })
$r = OnGitHub @{ REF_DELETE_TAG = $dt } $s2
Yes 'a tag a published release is on: stays' ($r.Code -eq 1 -and $r.Out -match 'keeps its tag' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_DELETE_TAG = $dt; REF_COMMIT = 'abc' } $atTag
Yes 'a tag with a short commit id: refused, nothing asked' ($r.Code -eq 1 -and $r.Calls.Count -eq 0)
$r = OnGitHub @{ REF_DELETE_TAG = $dt; REF_DELETE_BRANCH = $b } $atTag
Yes 'a tag and a branch at once: refused' ($r.Code -eq 1 -and $r.Calls.Count -eq 0)

# A draft.
$drafts = @{ releases = @([pscustomobject]@{ id = 397526903; tag_name = 'v1.1.96'; draft = $true }, [pscustomobject]@{ id = 404010285; tag_name = 'v1.1.106'; draft = $false }) }
$r = OnGitHub @{ REF_DELETE_DRAFT = '397526903'; REF_COMMIT = '' } $drafts
$w = @(Writes $r)
Yes ("a draft: one DELETE, exit 0, DRAFT-DELETED with its tag ($($r.Code))") ($r.Code -eq 0 -and $r.Out -match 'Set-Ref::DRAFT-DELETED 397526903 v1\.1\.96' -and $w.Count -eq 1 -and $w[0].Path -eq 'releases/397526903')
$r = OnGitHub @{ REF_DELETE_DRAFT = '404010285'; REF_COMMIT = '' } $drafts
Yes 'a published release: refused, nothing deleted' ($r.Code -eq 1 -and $r.Out -match 'only drafts' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_DELETE_DRAFT = '1'; REF_COMMIT = '' } $drafts
Yes 'a draft already gone: DRAFT-GONE, exit 0' ($r.Code -eq 0 -and $r.Out -match 'Set-Ref::DRAFT-GONE 1' -and @(Writes $r).Count -eq 0)
$r = OnGitHub @{ REF_DELETE_DRAFT = '12x'; REF_COMMIT = '' } $drafts
Yes 'an id that is not a number: refused, nothing asked' ($r.Code -eq 1 -and $r.Calls.Count -eq 0)

# Launchers go out only on merge-release.yml's and promote-main.yml's
# Releases since Velopack (#4825), so publishing and retagging the old
# launcher drafts went with release.yml (#5385).
Yes 'git-ref.yml takes no launcher to publish or put back' ($code -notmatch 'publish_launcher|retag_launcher|REF_PUBLISH_LAUNCHER|REF_RETAG_LAUNCHER')
$r = OnGitHub @{ REF_PUBLISH_LAUNCHER = 'v1.2.11'; REF_RETAG_LAUNCHER = 'v1.2.13'; REF_COMMIT = '' } @{}
Yes 'the old launcher inputs reach nothing: the run is given nothing to do, nothing asked' ($r.Code -eq 1 -and $r.Out -match 'given nothing to do' -and $r.Calls.Count -eq 0)

# ---- 3. the session half -----------------------------------------------------
Write-Host ''; Write-Host 'the session half'
$global:TSghCalls = @()
$global:TSghBody = $null
$global:TSghRun = ''
$global:TSghNotes = '[]'
function gh {
    $a = @($args | ForEach-Object { [string]$_ })
    $global:TSghCalls += ,($a -join ' ')
    $p = @($a | Where-Object { $_ -match '^repos/' }) | Select-Object -First 1
    if ($a -contains '--input') { $global:TSghBody = (@($input) -join "`n") | ConvertFrom-Json }
    $global:LASTEXITCODE = 0
    if ($p -match '/actions/workflows/(thornswood-)?git-ref\.yml/dispatches$') { return '{"workflow_run_id":88,"html_url":"https://github.com/x/actions/runs/88"}' }
    if ($p -match '/actions/runs/88$') { return $global:TSghRun }
    if ($p -match '/actions/runs/88/jobs$') { return '{"jobs":[{"id":556}]}' }
    if ($p -match '/check-runs/556/annotations$') { return $global:TSghNotes }
    $global:LASTEXITCODE = 1
    return 'gh: Not Found (HTTP 404)'
}
$done = '{"status":"completed","conclusion":"success","path":".github/workflows/git-ref.yml","html_url":"https://github.com/x/actions/runs/88"}'
function Session([hashtable]$a, [string]$run, [object[]]$notes) {
    $global:TSghCalls = @(); $global:TSghBody = $null
    $global:TSghRun = $run
    $global:TSghNotes = ConvertTo-Json -InputObject @($notes) -Compress
    $global:LASTEXITCODE = 0
    $out = @(& $setRef @a 6>&1 2>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Out = ($out -join "`n"); Code = $LASTEXITCODE; Calls = @($global:TSghCalls); Body = $global:TSghBody }
}
function Note([string]$level, [string]$message) { return @{ annotation_level = $level; title = 'Set-Ref'; message = $message } }

$s = Session @{ Tag = $t; Commit = $main; Message = $msg } $done @((Note 'notice' "TAGGED $t $main"))
Yes ("a tag: it starts git-ref.yml on main and says the tag is on GitHub, exit 0 ($($s.Code))") ($s.Code -eq 0 -and $s.Out -match 'is on GitHub' -and $s.Calls[0] -match 'actions/workflows/git-ref\.yml/dispatches' -and $s.Body.ref -eq 'main')
Yes '  the tag, the commit and the message in the inputs' ($s.Body.inputs.tag -eq $t -and $s.Body.inputs.commit -eq $main -and $s.Body.inputs.message -eq $msg)
Yes '  on gh''s standard input, on no command line' (-not (($s.Calls -join ' ').Contains('launcher  1.2.6.6')))
$s = Session @{ DeleteBranch = $b; Commit = $main } $done @((Note 'notice' "DELETED $b $main"))
Yes 'a branch: delete_branch and the commit in the inputs, exit 0' ($s.Code -eq 0 -and $s.Body.inputs.delete_branch -eq $b -and $s.Body.inputs.commit -eq $main -and -not $s.Body.inputs.PSObject.Properties['tag'])
$s = Session @{ DeleteBranch = $b; Commit = $main } $done @((Note 'failure' "$b stays: open pull request(s) #3300 come from it or are built onto it."))
Yes 'a stopped runner: exit 1 with its reason' ($s.Code -eq 1 -and $s.Out -match '#3300')
$s = Session @{ DeleteBranch = $b; Commit = $main; WaitMinutes = '0' } $done.Replace('"completed"', '"queued"') @()
Yes 'a run not ended in time: exit 2 with the -Run line' ($s.Code -eq 2 -and $s.Out -match 'Set-Ref\.ps1 -Run 88')
$s = Session @{ Run = '88' } $done @((Note 'notice' "GONE $b"))
Yes '-Run reads the answer later' ($s.Code -eq 0 -and $s.Out -match 'already gone')
$s = Session @{ Run = '88' } $done.Replace('git-ref.yml', 'build.yml') @((Note 'notice' "GONE $b"))
Yes '  of a git-ref run only' ($s.Code -eq 1)
$s = Session @{ Fork = $true; DeleteBranch = $b; Commit = $main } $done.Replace('git-ref.yml', 'thornswood-git-ref.yml') @((Note 'notice' "DELETED $b $main"))
Yes '-Fork: it starts the fork''s thornswood-git-ref.yml on main with the branch, exit 0' (
    $s.Code -eq 0 -and $s.Calls[0] -match '^api -X POST repos/ThornswoodRP/skymp/actions/workflows/thornswood-git-ref\.yml/dispatches' -and $s.Body.ref -eq 'main' -and $s.Body.inputs.delete_branch -eq $b)
$s = Session @{ Fork = $true; Run = 88 } $done @((Note 'notice' "GONE $b"))
Yes '  and -Fork -Run reads only a run of that workflow' ($s.Code -eq 1)
$threw = $false
try { & $setRef -Fork -Tag $t -Commit $main -Message 'x' 6>$null } catch { $threw = $true }
Yes '  and makes no tags' $threw
$s = Session @{ Tag = 'v1.2.6.6'; Commit = $main; Message = 'x' } $done @()
Yes 'a name it would refuse is refused before anything is started' ($s.Code -eq 1 -and $s.Calls.Count -eq 0)
$s = Session @{ Tag = $t; Commit = $main } $done @()
Yes '  and so is a tag with no message' ($s.Code -eq 1 -and $s.Calls.Count -eq 0)
$s = Session @{ DeleteTag = 'v1.1.47'; Commit = $main } $done @((Note 'notice' "DELETED v1.1.47 $main"))
Yes '-DeleteTag: delete_tag and the commit in the inputs, and nothing else, exit 0' (
    $s.Code -eq 0 -and $s.Body.inputs.delete_tag -eq 'v1.1.47' -and $s.Body.inputs.commit -eq $main -and @($s.Body.inputs.PSObject.Properties).Count -eq 2 -and $s.Out -match 'is deleted on GitHub')
$s = Session @{ DeleteDraft = 397526903 } $done @((Note 'notice' 'DRAFT-DELETED 397526903 v1.1.96'))
Yes '-DeleteDraft: delete_draft alone in the inputs, exit 0' ($s.Code -eq 0 -and $s.Body.inputs.delete_draft -eq '397526903' -and @($s.Body.inputs.PSObject.Properties).Count -eq 1 -and $s.Out -match 'v1\.1\.96 draft, is deleted')
$sp = (Get-Command $setRef).Parameters
Yes '-PublishLauncher and -RetagLauncher are no parameters any more' (-not $sp.ContainsKey('PublishLauncher') -and -not $sp.ContainsKey('RetagLauncher'))
$s = Session @{ DeleteTag = 'a b'; Commit = $main } $done @()
Yes '  and so is a tag name it would not delete' ($s.Code -eq 1 -and $s.Calls.Count -eq 0)
Remove-Item Function:\gh

# ---- 4. Ship's tag step in a cloud session -----------------------------------
Write-Host ''; Write-Host 'Add-ReleaseTag in a cloud session'
. (Join-Path $repo 'scripts/release/Release-Name.ps1')
$Scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-3107-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$work = Join-Path $Scratch 'work'
New-Item -ItemType Directory -Force -Path (Join-Path $work 'scripts/ops') | Out-Null
$enc = New-Object Text.UTF8Encoding($false)
$was = @{ CLAUDE_CODE_REMOTE = $env:CLAUDE_CODE_REMOTE; GIT_AUTHOR_NAME = $env:GIT_AUTHOR_NAME; GIT_AUTHOR_EMAIL = $env:GIT_AUTHOR_EMAIL; GIT_COMMITTER_NAME = $env:GIT_COMMITTER_NAME; GIT_COMMITTER_EMAIL = $env:GIT_COMMITTER_EMAIL }
try {
    foreach ($k in 'GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME') { [Environment]::SetEnvironmentVariable($k, 'Thornswood test') }
    foreach ($k in 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL') { [Environment]::SetEnvironmentVariable($k, 'test@thornswood.invalid') }
    & git init -q $work 2>&1 | Out-Null
    [IO.File]::WriteAllText((Join-Path $work 'a.txt'), 'one', $enc)
    & git -C $work add a.txt 2>&1 | Out-Null
    & git -C $work -c commit.gpgsign=false commit -q -m one 2>&1 | Out-Null
    $c = (& git -C $work rev-parse HEAD | Out-String).Trim()
    # A stand-in Set-Ref.ps1 in the checkout, which writes down what it was
    # given and the message file's text, and exits as the case says.
    $said = Join-Path $Scratch 'set-ref-said.json'
    [IO.File]::WriteAllText((Join-Path $work 'scripts/ops/Set-Ref.ps1'), @'
param([string]$Tag, [string]$Commit, [string]$MessageFile)
[IO.File]::WriteAllText($env:TS_SAID, (ConvertTo-Json -Compress @{ Tag = $Tag; Commit = $Commit; Message = [IO.File]::ReadAllText($MessageFile) }))
exit [int]$env:TS_RC
'@, $enc)
    $id = '20261022-154916-dev'
    $vf = Join-Path $Scratch 'feed/version.json'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $vf) | Out-Null
    $doc = [pscustomobject][ordered]@{
        launcherVersion = '1.2.6.6'
        packs = @([pscustomobject]@{ id = $id })
        baseline = [pscustomobject]@{ id = $id; sha256 = ('c' * 64); url = 'x'; entries = 1 }
    }
    $doc | Add-Member -NotePropertyName release -NotePropertyValue (New-ReleaseRecord $id 'dev' '1.2.6.6' @($id) $id $c 'main' 0)
    [IO.File]::WriteAllText($vf, ($doc | ConvertTo-Json -Depth 6), $enc)
    $env:CLAUDE_CODE_REMOTE = 'true'
    $env:TS_SAID = $said
    $env:TS_RC = '0'
    $tg = Add-ReleaseTag $work $vf $id 'origin' 'https://thornswood.net/feed-dev/version.json'
    $got = if (Test-Path -LiteralPath $said) { [IO.File]::ReadAllText($said) | ConvertFrom-Json } else { $null }
    Yes ("it hands the tag and the commit to the checkout's Set-Ref.ps1 ({0})" -f $(if ($tg.Why) { $tg.Why } else { 'no complaint' })) (
        -not $tg.Why -and $got -and $got.Tag -eq "release/dev/$id" -and $got.Commit -eq $c)
    Yes '  with the release''s own message' ($got -and ($got.Message -replace "`r`n", "`n").TrimEnd() -eq (Get-ReleaseTagMessage $doc.release 'https://thornswood.net/feed-dev/version.json' $doc))
    Yes '  which names the sha256 of the record, for release-files.yml (#3686)' ($got -and ($got.Message -replace "`r`n", "`n") -match ('(?m)^record    ' + ('c' * 64) + '$'))
    Yes '  and tags nothing in the checkout' (((& git -C $work tag -l | Out-String).Trim()) -eq '')
    $env:TS_RC = '1'
    $global:LASTEXITCODE = 0
    $tg = Add-ReleaseTag $work $vf $id 'origin'
    Yes ("a refusal says so and what to run ({0})" -f $tg.PutRight) ($tg.Why -match 'did not put' -and $tg.PutRight -match "^pwsh scripts/ops/Set-Ref\.ps1 -Tag release/dev/$id -Commit $c -Message ")
    Yes '  and leaves the exit code as it was, because Ship''s own is its last one' ($global:LASTEXITCODE -eq 0)
    $env:TS_RC = '2'
    $tg = Add-ReleaseTag $work $vf $id 'origin'
    Yes 'a run that had not ended is said, with nothing to run' ($tg.Why -match 'had not ended' -and -not $tg.PutRight)
} finally {
    foreach ($k in $was.Keys) { [Environment]::SetEnvironmentVariable($k, $was[$k]) }
    Remove-Item Env:TS_SAID, Env:TS_RC -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Done
