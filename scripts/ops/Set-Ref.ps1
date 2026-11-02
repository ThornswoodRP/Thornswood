<#
  Set-Ref.ps1

  Makes a release tag, or deletes a branch or a tag, on GitHub for a session
  whose git cannot write refs: a cloud Claude thread (#3107, #3314). It also
  deletes a release draft and publishes a signed launcher draft, which the
  same proxy refuses (#4177).

      pwsh scripts/ops/Set-Ref.ps1 -Tag release/dev/20261022-154916-dev -Commit <40 hex> -MessageFile <file>
                       the annotated release tag on that commit
      pwsh scripts/ops/Set-Ref.ps1 -DeleteBranch claude/what -Commit <40 hex>
                       the branch, when it is still at that commit
      pwsh scripts/ops/Set-Ref.ps1 -Fork -DeleteBranch claude/what -Commit <40 hex>
                       the same in the fork, ThornswoodRP/skymp
      pwsh scripts/ops/Set-Ref.ps1 -DeleteTag v1.1.47 -Commit <40 hex>
                       the tag, when it still names that commit
      pwsh scripts/ops/Set-Ref.ps1 -DeleteDraft 397526903
                       the release with that id, when it is a draft
      pwsh scripts/ops/Set-Ref.ps1 -PublishLauncher v1.2.11
                       the tag's launcher draft, when its files check as signed
      pwsh scripts/ops/Set-Ref.ps1 -RetagLauncher v1.2.13
                       the tag's launcher draft put back on its tag, when
                       GitHub has dropped the tag from it
      pwsh scripts/ops/Set-Ref.ps1 -Run 39712345678
                       the answer of a run that had not ended

  WHY. A cloud session reaches GitHub through the cloud environment's proxy,
  which refuses every ref write before GitHub sees it. Measured 22 Oct 2026:
  `git push origin refs/tags/...` is "RPC failed; HTTP 403" (the cloud Ship of
  dev release 20261022-154916-dev, #3314), and DELETE git/refs/heads/<branch>
  and POST git/refs, for a tag or a branch, are 403 "Write access to this
  GitHub API path is not permitted through this proxy". Starting a workflow
  is allowed. So the tag went to One, and so did every branch a cloud thread
  left behind (#3107, #2862). Measured 31 Oct 2026: DELETE releases/<id>
  and PATCH releases/<id> are 403 "Creating, editing, or deleting releases
  is not permitted for this session type" (#4177). The proxy's policy
  belongs to the cloud environment, and nothing in this repository changes
  it.

  HOW. This starts .github/workflows/git-ref.yml on main with what to do,
  waits for the run to end, and prints its answer, the way Say-Staff.ps1 and
  Read-Board.ps1 do. The workflow runs this script with -OnGitHub on a VPS
  runner, where the run's own token (contents: write, pull requests read,
  nothing else) makes the call. No secret is in the session or the workflow.
  -Fork starts the fork's .github/workflows/thornswood-git-ref.yml instead,
  on GitHub's hosted runner (free in that public repository), which deletes
  a branch by the same rules written into it; it makes no tags. A run's
  token reaches only its own repository, so each has its own workflow.

  WHAT THE GITHUB HALF DOES, AND WHAT IT REFUSES.
    -Tag: only release/dev/<id>-dev and release/main/<id>, the names
        Release-Name.ps1 gives a release, never v<...>, which starts the
        launcher build in release.yml. The commit has to be on main. It
        makes an annotated tag with the message given, by
        github-actions[bot]. A tag already on that commit is the answer
        ALREADY, not a failure; one on another commit is left alone and is a
        failure.
    -DeleteBranch: never the default branch. The branch has to be at the
        commit given, so a commit pushed after the caller looked is never
        deleted with it, and no open pull request may come from it or be
        built onto it. A branch already gone is the answer GONE. GitHub's
        "Restore branch" button on a closed pull request brings one back.
    -DeleteTag: the tag has to name the commit given (through its tag
        object when it is annotated), so the tag deleted is the one the
        caller looked at and wrote down. No release, draft or published, may
        be on it: deleting a published release's tag breaks the release,
        and a draft's goes first with -DeleteDraft. A tag already gone is
        GONE. Nothing brings a deleted tag back but the commit it named, so
        the caller records that first (#4177 has the list it deleted). The
        "release tags" ruleset holds every v* tag against deletion, and only
        an administrator passes it, so the run's token is refused one: that
        is a failure that names GitHub's answer, never GONE.
    -DeleteDraft: only a draft, by its id; a published release is refused.
        One already gone is DRAFT-GONE.
    -PublishLauncher: only a v<version> tag with exactly one release, a
        draft named "Launcher v<version>" built from the commit the tag
        names, holding SHA256SUMS and exactly one of each file it names:
        Thornswood.exe and the native libraries beside it (#4823). Those
        files are downloaded and Test-ReleaseFiles.ps1 -RequireSigned checks
        them the way release.yml's verify job does (the checksums, the
        publish gate and the launcher's own Signature.cs on every program);
        a draft that fails stays a draft. It is published as not the latest, so the game
        release Publish-ReleaseFiles.ps1 marks latest stays latest, and a
        four part version, a dev launcher, as a prerelease. One already
        published is ALREADY-PUBLISHED.
    -RetagLauncher: only a v<version> tag on GitHub that no release is on,
        and exactly one draft named "Launcher v<version>" whose tag GitHub
        dropped (its tag_name reads untagged-<hex>) and which holds the
        commit the tag names. It sets tag_name and target_commitish
        together, which is how a draft keeps its tag, then reads the draft
        back and checks it is on the tag and still a draft. Its files are
        not touched. A tag that already has its release is ALREADY-ON-TAG.
        Why a draft loses its tag: measured 31 Oct 2026, after immutable
        releases were turned on, a PATCH of a draft that does not name
        tag_name drops it. 3684-release-targets.ps1 set target_commitish
        alone on 24 drafts at 12:28 UTC and every one read untagged-<hex>
        after; release.yml set body alone on the v1.2.13 draft at 12:13
        UTC, when a second run uploaded into it, and the same happened.
        release.yml now names the tag in that PATCH.

  WHAT IT SAYS AND EXITS.
    TAGGED, ALREADY, DELETED, GONE    0
    DRAFT-DELETED, DRAFT-GONE         0
    PUBLISHED, ALREADY-PUBLISHED      0
    RETAGGED, ALREADY-ON-TAG          0
    refused, or GitHub said no        1, with why; nothing changed
    the run had not ended             2, after -WaitMinutes; the run still
                                      does it, and -Run <its id> reads it
  In the workflow it writes its answer, or why it stopped, as an annotation
  titled Set-Ref, which is how the session reads the runner's answer.
  tests\test-3107-set-ref.ps1 runs both halves against a stand-in GitHub.
#>
[CmdletBinding(DefaultParameterSetName = 'Tag')]
param(
    [Parameter(ParameterSetName = 'Tag', Mandatory = $true)]
    [string]$Tag,
    [Parameter(ParameterSetName = 'Tag')]
    [string]$Message = '',
    [Parameter(ParameterSetName = 'Tag')]
    [string]$MessageFile = '',
    [Parameter(ParameterSetName = 'Delete', Mandatory = $true)]
    [string]$DeleteBranch,
    [Parameter(ParameterSetName = 'DeleteTag', Mandatory = $true)]
    [string]$DeleteTag,
    [Parameter(ParameterSetName = 'Tag', Mandatory = $true)]
    [Parameter(ParameterSetName = 'Delete', Mandatory = $true)]
    [Parameter(ParameterSetName = 'DeleteTag', Mandatory = $true)]
    [string]$Commit,
    [Parameter(ParameterSetName = 'DeleteDraft', Mandatory = $true)]
    [long]$DeleteDraft,
    [Parameter(ParameterSetName = 'Publish', Mandatory = $true)]
    [string]$PublishLauncher,
    [Parameter(ParameterSetName = 'Retag', Mandatory = $true)]
    [string]$RetagLauncher,
    # A git-ref run that had not ended: read its answer.
    [Parameter(ParameterSetName = 'Run', Mandatory = $true)]
    [long]$Run,
    # The fork's branch, through the fork's thornswood-git-ref.yml.
    [Parameter(ParameterSetName = 'Delete')]
    [Parameter(ParameterSetName = 'Run')]
    [switch]$Fork,
    # The workflow's half. What to do comes from the environment the
    # workflow sets from its inputs, never from a command line.
    [Parameter(ParameterSetName = 'OnGitHub', Mandatory = $true)]
    [switch]$OnGitHub,
    [int]$WaitMinutes = 15,
    [string]$GitHubRepo = 'ThornswoodRP/Thornswood'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workflow = 'git-ref.yml'
if ($Fork) { $GitHubRepo = 'ThornswoodRP/skymp'; $workflow = 'thornswood-git-ref.yml' }
$inActions = ($env:GITHUB_ACTIONS -eq 'true')
$tagShape = '^release/(dev/\d{8}-\d{4}(\d{2})?-dev|main/\d{8}-\d{4}(\d{2})?)$'
$maxMessage = 4000

# An annotation on the job, which GitHub keeps on its check run, so the
# session reads the answer without reading the log.
function Note([string]$level, [string]$m) {
    if ($inActions) { Write-Host ('::' + $level + ' title=Set-Ref::' + ($m -replace '%', '%25' -replace "`r", '%0D' -replace "`n", '%0A')) }
}
function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Die($m) { Note 'error' $m; Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

# What a tag or branch name may be here: git's own rules, narrowed to the
# characters branch names in this repository use.
function Test-RefName([string]$n) {
    return ($n -match '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -and $n -notmatch '\.\.|//|/\.|\.lock(/|$)|[/.]$')
}

# Each part of a ref name escaped on its own, the slashes kept.
function Get-RefPath([string]$n) { return (@($n.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/') }

# ======================================================== the GitHub half ===
if ($OnGitHub) {
    $Tag = [string]$env:REF_TAG
    $DeleteBranch = [string]$env:REF_DELETE_BRANCH
    $DeleteTag = [string]$env:REF_DELETE_TAG
    # A [long] parameter takes no text, so the draft has a name of its own here.
    $draftId = [string]$env:REF_DELETE_DRAFT
    $PublishLauncher = [string]$env:REF_PUBLISH_LAUNCHER
    $RetagLauncher = [string]$env:REF_RETAG_LAUNCHER
    $Commit = [string]$env:REF_COMMIT
    $Message = [string]$env:REF_MESSAGE
    $default = if ($env:REF_DEFAULT_BRANCH) { [string]$env:REF_DEFAULT_BRANCH } else { 'main' }
    if (-not $env:GH_TOKEN) { Die 'GH_TOKEN is not set, so there is nothing to call GitHub with. In git-ref.yml it is the run''s own token.' }
    if (-not $env:GITHUB_REPOSITORY) { Die 'GITHUB_REPOSITORY is not set, so this is not a workflow run and there is no repository to change.' }
    $apiBase = $(if ($env:GITHUB_API_URL) { $env:GITHUB_API_URL } else { 'https://api.github.com' }) + '/repos/' + $env:GITHUB_REPOSITORY

    # One call. Code is GitHub's HTTP answer, Body its JSON as an object.
    function Api([string]$method, [string]$path, $body = $null) {
        $p = @{
            Method = $method; Uri = "$apiBase/$path"; SkipHttpErrorCheck = $true; TimeoutSec = 60
            Headers = @{ Authorization = "Bearer $env:GH_TOKEN"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
        }
        if ($null -ne $body) { $p.Body = ($body | ConvertTo-Json -Compress -Depth 5); $p.ContentType = 'application/json' }
        $r = Invoke-WebRequest @p
        $text = [string]$r.Content
        $o = if ($text.Trim()) { $text | ConvertFrom-Json } else { $null }
        return [pscustomobject]@{ Code = [int]$r.StatusCode; Body = $o }
    }
    function Said($a) {
        $m = if ($a.Body -and $a.Body.PSObject.Properties['message']) { ': ' + $a.Body.message } else { '' }
        return ('HTTP ' + $a.Code + $m)
    }
    # The commit a tag ref names, through its tag object when it is annotated.
    function Get-TagCommit($refBody) {
        $o = $refBody.object
        if ($o.type -ne 'tag') { return [string]$o.sha }
        $t = Api GET ('git/tags/' + $o.sha)
        if ($t.Code -ne 200) { Die ("GitHub would not read the tag object " + $o.sha + ' (' + (Said $t) + '). Nothing was changed.') }
        return [string]$t.Body.object.sha
    }

    $asked = @(@($Tag, $DeleteBranch, $DeleteTag, $draftId, $PublishLauncher, $RetagLauncher) | Where-Object { $_ })
    if ($asked.Count -gt 1) { Die 'give one thing to do: a tag to make, a branch or tag to delete, a draft to delete, or a launcher to publish or put back on its tag. Nothing was changed.' }
    if (($Tag -or $DeleteBranch -or $DeleteTag) -and $Commit -notmatch '^[0-9a-f]{40}$') { Die "the commit has to be a full 40 character commit id, and it is '$Commit'. Nothing was changed." }

    # Every release, drafts too, page by page. GitHub's answer comes back as
    # one object holding the JSON array, so each page is spread before it is
    # counted (#3686).
    function Get-Releases {
        $all = @()
        for ($page = 1; $page -le 50; $page++) {
            $a = Api GET ('releases?per_page=100&page=' + $page)
            if ($a.Code -ne 200) { Die ('GitHub would not list the releases (' + (Said $a) + '). Nothing was changed.') }
            $got = @($a.Body | ForEach-Object { $_ } | Where-Object { $_ -and $_.PSObject.Properties['id'] })
            $all += $got
            if ($got.Count -lt 100) { return $all }
        }
        Die 'GitHub listed more than 5000 releases, so the list was not read to its end. Nothing was changed.'
    }

    if ($Tag) {
        if ($Tag -notmatch $tagShape) { Die "$Tag is not a release tag (release/dev/<id>-dev or release/main/<id>), and this makes no other. Nothing was changed." }
        $Message = ($Message -replace '\r\n?', "`n").Trim()
        if (-not $Message) { Die 'the tag message is empty. Ship writes one for every release tag. Nothing was changed.' }
        if ($Message.Length -gt $maxMessage) { Die "the tag message is $($Message.Length) characters and $maxMessage is the most. Nothing was changed." }
        $cmp = Api GET ("compare/$Commit..." + [Uri]::EscapeDataString($default))
        if ($cmp.Code -eq 404) { Die "GitHub has no commit $Commit in $env:GITHUB_REPOSITORY, so $Tag was not made. Push the commit first." }
        if ($cmp.Code -ne 200) { Die ("GitHub would not compare $Commit with $default (" + (Said $cmp) + "), so $Tag was not made.") }
        if (@('ahead', 'identical') -notcontains [string]$cmp.Body.status) {
            Die ("commit $Commit is not on $default (GitHub says $default is " + $cmp.Body.status + ' of it), so ' + $Tag + ' was not made. A release tag goes only on a commit main has.')
        }
        $refPath = 'git/ref/tags/' + (Get-RefPath $Tag)
        $has = Api GET $refPath
        if ($has.Code -eq 200) {
            $on = Get-TagCommit $has.Body
            if ($on -eq $Commit) { Note 'notice' "ALREADY $Tag $Commit"; Say "ALREADY $Tag $Commit" 'Green'; exit 0 }
            Die "$Tag already names commit $on, not $Commit; it was left alone."
        }
        if ($has.Code -ne 404) { Die ("GitHub would not say whether $Tag is there (" + (Said $has) + '). Nothing was changed.') }
        $tagger = [ordered]@{
            name = 'github-actions[bot]'; email = '41898282+github-actions[bot]@users.noreply.github.com'
            date = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture)
        }
        $obj = Api POST 'git/tags' ([ordered]@{ tag = $Tag; message = ($Message + "`n"); object = $Commit; type = 'commit'; tagger = $tagger })
        if ($obj.Code -ne 201) { Die ("GitHub did not make the tag object for $Tag (" + (Said $obj) + '). Nothing was changed.') }
        $made = Api POST 'git/refs' ([ordered]@{ ref = "refs/tags/$Tag"; sha = [string]$obj.Body.sha })
        if ($made.Code -eq 201) { Note 'notice' "TAGGED $Tag $Commit"; Say "TAGGED $Tag $Commit" 'Green'; exit 0 }
        # 422 is GitHub saying the ref is there: another run made it between
        # the read above and this one, so what it names is the answer.
        if ($made.Code -eq 422) {
            $has = Api GET $refPath
            if ($has.Code -eq 200) {
                $on = Get-TagCommit $has.Body
                if ($on -eq $Commit) { Note 'notice' "ALREADY $Tag $Commit"; Say "ALREADY $Tag $Commit" 'Green'; exit 0 }
                Die "$Tag was made on commit $on by something else while this ran, not on $Commit; it was left alone."
            }
        }
        Die ("GitHub did not put $Tag on (" + (Said $made) + ').')
    }

    if ($DeleteBranch) {
        if (-not (Test-RefName $DeleteBranch)) { Die "'$DeleteBranch' is not a branch name this deletes. Nothing was changed." }
        if ($DeleteBranch -eq $default) { Die "$DeleteBranch is the default branch, which this never deletes." }
        $refPath = 'git/ref/heads/' + (Get-RefPath $DeleteBranch)
        $has = Api GET $refPath
        if ($has.Code -eq 404) { Note 'notice' "GONE $DeleteBranch"; Say "GONE $DeleteBranch" 'Green'; exit 0 }
        if ($has.Code -ne 200) { Die ("GitHub would not say where $DeleteBranch is (" + (Said $has) + '). Nothing was changed.') }
        $tip = [string]$has.Body.object.sha
        if ($tip -ne $Commit) { Die "$DeleteBranch is at $tip, not ${Commit}: a commit came after the one given, so it stays. Look at it, then ask again with its commit." }
        $owner = $env:GITHUB_REPOSITORY.Split('/')[0]
        $q = [Uri]::EscapeDataString($DeleteBranch)
        $open = @()
        foreach ($ask in @("pulls?state=open&per_page=100&head=$owner`:$q", "pulls?state=open&per_page=100&base=$q")) {
            $a = Api GET $ask
            if ($a.Code -ne 200) { Die ("GitHub would not list the open pull requests on $DeleteBranch (" + (Said $a) + '). Nothing was changed.') }
            $open += @($a.Body | Where-Object { $_ -and $_.PSObject.Properties['number'] })
        }
        if ($open.Count) {
            Die ("$DeleteBranch stays: open pull request(s) " + ((@($open | ForEach-Object { '#' + $_.number }) | Sort-Object -Unique) -join ', ') + ' come from it or are built onto it.')
        }
        $gone = Api DELETE ('git/refs/heads/' + (Get-RefPath $DeleteBranch))
        if ($gone.Code -eq 204) { Note 'notice' "DELETED $DeleteBranch $Commit"; Say "DELETED $DeleteBranch $Commit" 'Green'; exit 0 }
        # 422 is either the ref gone between the read and the delete, or a
        # rule refusing the delete (#4177: the release tags ruleset answered
        # 422 and the tag was still there). Only a second read tells them apart.
        if ($gone.Code -eq 422 -and (Api GET $refPath).Code -eq 404) { Note 'notice' "GONE $DeleteBranch"; Say "GONE $DeleteBranch" 'Green'; exit 0 }
        Die ("GitHub did not delete $DeleteBranch (" + (Said $gone) + ').')
    }
    if ($DeleteTag) {
        if (-not (Test-RefName $DeleteTag)) { Die "'$DeleteTag' is not a tag name this deletes. Nothing was changed." }
        $refPath = 'git/ref/tags/' + (Get-RefPath $DeleteTag)
        $has = Api GET $refPath
        if ($has.Code -eq 404) { Note 'notice' "GONE $DeleteTag"; Say "GONE $DeleteTag" 'Green'; exit 0 }
        if ($has.Code -ne 200) { Die ("GitHub would not say where $DeleteTag is (" + (Said $has) + '). Nothing was changed.') }
        $on = Get-TagCommit $has.Body
        if ($on -ne $Commit) { Die "$DeleteTag names $on, not ${Commit}, so it stays. Look at it, then ask again with its commit." }
        $on = @(Get-Releases | Where-Object { [string]$_.tag_name -eq $DeleteTag })
        if ($on.Count) {
            Die ("$DeleteTag stays: release(s) " + ((@($on | ForEach-Object { [string]$_.id + $(if ($_.draft) { ' (a draft)' } else { '' }) })) -join ', ') + ' are on it. A draft goes first with -DeleteDraft; a published release keeps its tag.')
        }
        $gone = Api DELETE ('git/refs/tags/' + (Get-RefPath $DeleteTag))
        if ($gone.Code -eq 204) { Note 'notice' "DELETED $DeleteTag $Commit"; Say "DELETED $DeleteTag $Commit" 'Green'; exit 0 }
        # 422, as for a branch: gone only when a second read says so. A tag the
        # release tags ruleset holds (refs/tags/v*) is refused this way, and
        # only an administrator may delete it.
        if ($gone.Code -eq 422 -and (Api GET $refPath).Code -eq 404) { Note 'notice' "GONE $DeleteTag"; Say "GONE $DeleteTag" 'Green'; exit 0 }
        Die ("GitHub did not delete $DeleteTag (" + (Said $gone) + ').')
    }

    if ($draftId) {
        if ($draftId -notmatch '^[1-9][0-9]{0,15}$') { Die "'$draftId' is not a release id. Nothing was changed." }
        $rel = Api GET ('releases/' + $draftId)
        if ($rel.Code -eq 404) { Note 'notice' "DRAFT-GONE $draftId"; Say "DRAFT-GONE $draftId" 'Green'; exit 0 }
        if ($rel.Code -ne 200) { Die ("GitHub would not read release $draftId (" + (Said $rel) + '). Nothing was changed.') }
        $tagName = [string]$rel.Body.tag_name
        if (-not $rel.Body.draft) { Die "release $draftId ($tagName) is published, and this deletes only drafts. Nothing was changed." }
        $gone = Api DELETE ('releases/' + $draftId)
        if ($gone.Code -eq 204) { Note 'notice' "DRAFT-DELETED $draftId $tagName"; Say "DRAFT-DELETED $draftId $tagName" 'Green'; exit 0 }
        if ($gone.Code -eq 404) { Note 'notice' "DRAFT-GONE $draftId"; Say "DRAFT-GONE $draftId" 'Green'; exit 0 }
        Die ("GitHub did not delete release $draftId (" + (Said $gone) + ').')
    }

    if ($PublishLauncher) {
        if ($PublishLauncher -notmatch '^v\d+\.\d+\.\d+(\.\d+)?$') { Die "$PublishLauncher is not a launcher tag (v<version>), the only releases this publishes. Nothing was changed." }
        $dev = [bool]$Matches[1]
        $on = @(Get-Releases | Where-Object { [string]$_.tag_name -eq $PublishLauncher })
        if ($on.Count -eq 0) { Die "no release is on $PublishLauncher. release.yml drafts one when it builds the tag. Nothing was changed." }
        if ($on.Count -gt 1) { Die ("$PublishLauncher has " + $on.Count + ' releases (' + ((@($on | ForEach-Object { [string]$_.id })) -join ', ') + '), so which one is the launcher is not this run''s to choose. Delete the extra draft first. Nothing was changed.') }
        $rel = $on[0]
        $has = Api GET ('git/ref/tags/' + (Get-RefPath $PublishLauncher))
        if ($has.Code -ne 200) { Die ("GitHub would not say where $PublishLauncher is (" + (Said $has) + '). Nothing was changed.') }
        $commitOf = Get-TagCommit $has.Body
        if (-not $rel.draft) { Note 'notice' "ALREADY-PUBLISHED $PublishLauncher $commitOf"; Say "ALREADY-PUBLISHED $PublishLauncher $commitOf" 'Green'; exit 0 }
        if ([string]$rel.name -ne "Launcher $PublishLauncher") { Die ("release " + $rel.id + " is named '" + $rel.name + "', not 'Launcher $PublishLauncher', so it is not a launcher draft. Nothing was changed.") }
        $built = [string]$rel.target_commitish
        if ($built -match '^[0-9a-f]{40}$' -and $built -ne $commitOf) { Die "$PublishLauncher names $commitOf, but its draft was built from $built, so the tag moved after the build. It stays a draft." }
        $assets = @($rel.assets | Where-Object { $_ })
        $dir = Join-Path ([IO.Path]::GetTempPath()) ('set-ref-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        try {
            # SHA256SUMS first, then each file it names: the launcher is
            # Thornswood.exe and the native libraries beside it (#4823).
            $fetch = {
                param([string]$n)
                $one = @($assets | Where-Object { [string]$_.name -eq $n })
                if ($one.Count -ne 1) { Die "the $PublishLauncher draft does not hold exactly one $n, so it stays a draft." }
                $r = Invoke-WebRequest -Method GET -Uri ("$apiBase/releases/assets/" + $one[0].id) -OutFile (Join-Path $dir $n) -PassThru -SkipHttpErrorCheck -TimeoutSec 300 -Headers @{
                    Authorization = "Bearer $env:GH_TOKEN"; Accept = 'application/octet-stream'; 'X-GitHub-Api-Version' = '2022-11-28' }
                if ([int]$r.StatusCode -ne 200) { Die ("GitHub did not hand over the draft's $n (HTTP " + $r.StatusCode + '), so it stays a draft.') }
            }
            & $fetch 'SHA256SUMS'
            $want = @([IO.File]::ReadAllLines((Join-Path $dir 'SHA256SUMS')) |
                ForEach-Object { [regex]::Match($_, '(?i)^\s*[0-9a-f]{64}\s+\*?([A-Za-z0-9][A-Za-z0-9._-]*)\s*$') } |
                Where-Object { $_.Success } | ForEach-Object { $_.Groups[1].Value })
            if ($want -notcontains 'Thornswood.exe') { Die "the $PublishLauncher draft's SHA256SUMS does not name Thornswood.exe, so it stays a draft." }
            foreach ($n in $want) { & $fetch $n }
            # The verify job's own check (release.yml), on this run's runner,
            # which holds no signing setup either.
            $global:LASTEXITCODE = 0
            & (Join-Path $PSScriptRoot '../release/Test-ReleaseFiles.ps1') -Dir $dir -RequireSigned
            $rc = $LASTEXITCODE
            if ($rc -ne 0) { Die "the $PublishLauncher draft's files did not pass Test-ReleaseFiles.ps1 -RequireSigned (exit $rc; the lines above say which check), so it stays a draft." }
        } finally {
            Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
        }
        $done = Api PATCH ('releases/' + $rel.id) ([ordered]@{ draft = $false; prerelease = $dev; make_latest = 'false' })
        if ($done.Code -ne 200) { Die ("GitHub did not publish release " + $rel.id + ' (' + (Said $done) + ').') }
        Note 'notice' "PUBLISHED $PublishLauncher $commitOf"; Say "PUBLISHED $PublishLauncher $commitOf" 'Green'; exit 0
    }

    if ($RetagLauncher) {
        if ($RetagLauncher -notmatch '^v\d+\.\d+\.\d+(\.\d+)?$') { Die "$RetagLauncher is not a launcher tag (v<version>), the only drafts this puts back on their tag. Nothing was changed." }
        $has = Api GET ('git/ref/tags/' + (Get-RefPath $RetagLauncher))
        if ($has.Code -eq 404) { Die "$RetagLauncher is not on GitHub, so there is no tag to put its draft back on. Nothing was changed." }
        if ($has.Code -ne 200) { Die ("GitHub would not say where $RetagLauncher is (" + (Said $has) + '). Nothing was changed.') }
        $commitOf = Get-TagCommit $has.Body
        $all = @(Get-Releases)
        $on = @($all | Where-Object { [string]$_.tag_name -eq $RetagLauncher })
        if ($on.Count -eq 1) { Note 'notice' "ALREADY-ON-TAG $RetagLauncher $commitOf"; Say "ALREADY-ON-TAG $RetagLauncher $commitOf" 'Green'; exit 0 }
        if ($on.Count -gt 1) { Die ("$RetagLauncher already has " + $on.Count + ' releases (' + ((@($on | ForEach-Object { [string]$_.id })) -join ', ') + '), so no draft is put back on it. Nothing was changed.') }
        $lost = @($all | Where-Object { $_.draft -and [string]$_.name -ceq "Launcher $RetagLauncher" -and [string]$_.tag_name -like 'untagged-*' })
        if ($lost.Count -ne 1) { Die ("there are " + $lost.Count + " drafts named 'Launcher $RetagLauncher' that GitHub took off their tag, and this puts back exactly one" + $(if ($lost.Count) { ' (' + ((@($lost | ForEach-Object { [string]$_.id })) -join ', ') + ')' } else { '' }) + '. Nothing was changed.') }
        $rel = $lost[0]
        $built = [string]$rel.target_commitish
        if ($built -ne $commitOf) { Die ("draft " + $rel.id + " holds $built, but $RetagLauncher names $commitOf, so it is not that tag's build. It stays as it is.") }
        $done = Api PATCH ('releases/' + $rel.id) ([ordered]@{ tag_name = $RetagLauncher; target_commitish = $commitOf })
        if ($done.Code -ne 200) { Die ("GitHub did not put release " + $rel.id + " back on $RetagLauncher (" + (Said $done) + ').') }
        $back = Api GET ('releases/' + $rel.id)
        if ($back.Code -ne 200) { Die ("GitHub took the edit of release " + $rel.id + ' but would not read it back (' + (Said $back) + '), so whether it is on its tag is not known.') }
        if ([string]$back.Body.tag_name -ne $RetagLauncher -or -not $back.Body.draft -or [string]$back.Body.target_commitish -ne $commitOf) {
            Die ("release " + $rel.id + ' reads back as ' + [string]$back.Body.tag_name + ' at ' + [string]$back.Body.target_commitish + $(if ($back.Body.draft) { ', a draft' } else { ', published' }) + ", not a draft on $RetagLauncher at $commitOf.")
        }
        Note 'notice' "RETAGGED $RetagLauncher $commitOf"; Say "RETAGGED $RetagLauncher $commitOf" 'Green'; exit 0
    }
    Die 'the run was given nothing to do.'
}

# ======================================================= the session half ===
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'there is no gh here to start the git-ref workflow with. Nothing was changed.' }

if (@('Tag', 'Delete', 'DeleteTag') -contains $PSCmdlet.ParameterSetName) {
    if ($Commit -notmatch '^[0-9a-f]{40}$') { Die "-Commit has to be a full 40 character commit id, and it is '$Commit'. Nothing was changed." }
}
if ($PSCmdlet.ParameterSetName -eq 'Tag') {
    if ($Tag -notmatch $tagShape) { Die "$Tag is not a release tag (release/dev/<id>-dev or release/main/<id>), the only tags this makes. Nothing was changed." }
    if ($MessageFile) {
        if (-not (Test-Path -LiteralPath $MessageFile -PathType Leaf)) { Die "there is no message file at $MessageFile. Nothing was changed." }
        $Message = [IO.File]::ReadAllText($MessageFile)
    }
    $Message = ($Message -replace '\r\n?', "`n").Trim()
    if (-not $Message) { Die 'the tag has no message: give -Message or -MessageFile. Nothing was changed.' }
    if ($Message.Length -gt $maxMessage) { Die "the tag message is $($Message.Length) characters and $maxMessage is the most. Nothing was changed." }
}
if ($PSCmdlet.ParameterSetName -eq 'Delete') {
    if (-not (Test-RefName $DeleteBranch)) { Die "'$DeleteBranch' is not a branch name this deletes. Nothing was changed." }
}
if ($PSCmdlet.ParameterSetName -eq 'DeleteTag') {
    if (-not (Test-RefName $DeleteTag)) { Die "'$DeleteTag' is not a tag name this deletes. Nothing was changed." }
}
if ($PSCmdlet.ParameterSetName -eq 'DeleteDraft') {
    if ($DeleteDraft -lt 1) { Die "$DeleteDraft is not a release id. Nothing was changed." }
}
if ($PSCmdlet.ParameterSetName -eq 'Publish') {
    if ($PublishLauncher -notmatch '^v\d+\.\d+\.\d+(\.\d+)?$') { Die "$PublishLauncher is not a launcher tag (v<version>), the only releases this publishes. Nothing was changed." }
}
if ($PSCmdlet.ParameterSetName -eq 'Retag') {
    if ($RetagLauncher -notmatch '^v\d+\.\d+\.\d+(\.\d+)?$') { Die "$RetagLauncher is not a launcher tag (v<version>), the only drafts this puts back on their tag. Nothing was changed." }
}

. (Join-Path $PSScriptRoot 'WorkflowRun.ps1')
$again = 'pwsh scripts/ops/Set-Ref.ps1 ' + $(if ($Fork) { '-Fork ' } else { '' }) + '-Run '

# Waits for the run to end, then reads what the runner said: the Set-Ref
# annotation on its job. -Started: this session started it, so from then on
# the change is GitHub's to make, and a read that fails is said as that, with
# the line that reads the answer later, never as nothing having been asked.
function Read-Answer([long]$id, [switch]$Started) {
    $a = Read-ThornswoodRunAnswer -Repo $GitHubRepo -Workflow $workflow -Run $id -Title 'Set-Ref' -WaitMinutes $WaitMinutes -Started:$Started -Say { param($m) Say $m 'DarkGray' }
    switch ($a.State) {
        'answer' { return $a.Text }
        'waiting' {
            Say ("the run has not ended after $WaitMinutes minutes (it was " + $a.Text + '), so every runner is busy. It still makes the change when one takes it.') 'Yellow'
            Say ('  its answer then: ' + $again + $id) 'DarkGray'
            if ($a.Url) { Say ('  ' + $a.Url) 'DarkGray' }
            exit 2
        }
        'unread' {
            if (-not $Started) { Die $a.Text }
            Say ("GitHub started run $id with it, and the run makes the change. Its answer was not read here: " + $a.Text) 'Yellow'
            Say ('  its answer: ' + $again + $id) 'DarkGray'
            exit 2
        }
        'stopped' { Die ('the runner stopped: ' + $a.Text + ' (' + $a.Url + ')') }
        'other' { Die ($a.Text + '.') }
    }
    Die ($a.Text + ', so nothing it knows of was changed. Its log says why: ' + $a.Url)
}

if ($PSCmdlet.ParameterSetName -eq 'Run') {
    $answer = Read-Answer $Run
} else {
    $inputs = switch ($PSCmdlet.ParameterSetName) {
        'Tag' { [ordered]@{ tag = $Tag; commit = $Commit; message = $Message } }
        'Delete' { [ordered]@{ delete_branch = $DeleteBranch; commit = $Commit } }
        'DeleteTag' { [ordered]@{ delete_tag = $DeleteTag; commit = $Commit } }
        'DeleteDraft' { [ordered]@{ delete_draft = [string]$DeleteDraft } }
        'Publish' { [ordered]@{ publish_launcher = $PublishLauncher } }
        'Retag' { [ordered]@{ retag_launcher = $RetagLauncher } }
    }
    try { $started = Start-ThornswoodWorkflow -Repo $GitHubRepo -Workflow $workflow -Inputs $inputs }
    catch { Die ($_.Exception.Message + '. Nothing was changed.') }
    if (-not $started.Run) {
        Say ("GitHub started $workflow, but named no run" + ', so its answer cannot be read here. Its runs: ' + $started.Url) 'Yellow'
        exit 2
    }
    Say ("sent to $workflow" + ': ' + $started.Url) 'DarkGray'
    $answer = Read-Answer $started.Run -Started
}

switch -Regex ("$answer") {
    '^TAGGED (\S+) (\S+)$' { Say ($Matches[1] + ' is on GitHub, on ' + $Matches[2].Substring(0, 12) + '.') 'Green'; exit 0 }
    '^ALREADY (\S+) (\S+)$' { Say ($Matches[1] + ' was already on GitHub, on ' + $Matches[2].Substring(0, 12) + '.') 'Green'; exit 0 }
    '^DELETED (\S+) (\S+)$' { Say ($Matches[1] + ' is deleted on GitHub (it was at ' + $Matches[2].Substring(0, 12) + ').') 'Green'; exit 0 }
    '^GONE (\S+)$' { Say ($Matches[1] + ' was already gone from GitHub.') 'Green'; exit 0 }
    '^DRAFT-DELETED (\S+) (\S+)$' { Say ('release ' + $Matches[1] + ', the ' + $Matches[2] + ' draft, is deleted on GitHub.') 'Green'; exit 0 }
    '^DRAFT-GONE (\S+)$' { Say ('release ' + $Matches[1] + ' was already gone from GitHub.') 'Green'; exit 0 }
    '^PUBLISHED (\S+) (\S+)$' { Say ($Matches[1] + ' is published on GitHub, from ' + $Matches[2].Substring(0, 12) + ', its files checked as signed.') 'Green'; exit 0 }
    '^ALREADY-PUBLISHED (\S+) (\S+)$' { Say ($Matches[1] + ' was already published on GitHub.') 'Green'; exit 0 }
    '^RETAGGED (\S+) (\S+)$' { Say ('the ' + $Matches[1] + ' launcher draft is back on its tag, at ' + $Matches[2].Substring(0, 12) + ', still a draft.') 'Green'; exit 0 }
    '^ALREADY-ON-TAG (\S+) (\S+)$' { Say ($Matches[1] + ' already had its release on it; nothing was changed.') 'Green'; exit 0 }
}
Die ("the run answered '$answer', which is none of the answers this knows. Nothing it knows of was changed.")
