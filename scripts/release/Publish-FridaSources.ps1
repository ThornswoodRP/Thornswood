<#
  Publish-FridaSources.ps1

  The source of what is inside frida-gum.lib, on one permanent Release of this
  repository (#3287, Patrick's answer C of 26 Oct 2026).

      pwsh scripts/release/Publish-FridaSources.ps1              make the Release
      pwsh scripts/release/Publish-FridaSources.ps1 -Check       is the source the notes name reachable
      pwsh scripts/release/Publish-FridaSources.ps1 -ForksMayGo  may the six forks be deleted yet

  WHY. SkyrimPlatformImpl.dll links frida-gum.lib, Frida's own build, and that
  lib also holds glib, gobject and proxy-libintl, which are the LGPL with no
  exception for binaries. The dll goes out under the GPL, so their source has
  to stay reachable, with directions to it beside the file (THIRD-PARTY.md,
  the frida-gum paragraph). Until now the directions were six forks of
  Frida's repositories. Patrick's answer C: each part goes up as an archive of
  its commit on one Release of this repository, which stays as long as the
  launcher ships frida-gum, and the forks are deleted once nothing offered
  still names only them. records\frida-sources.json names the parts, their
  commits and each archive's sha256 and bytes.

  MAKE (no switch). Run by .github/workflows/frida-sources.yml with the run's
  own token in GH_TOKEN. For each part: fetches the fork's tag (the
  record's forkTag), checks it is the recorded commit, makes the archive with
  git archive --format=tar --prefix=<name>-<commit>/ (plain tar, because a
  compressed one is not the same bytes from one git to the next: measured 27
  Oct, git 2.43's own gzip and gzip -cn differ), and checks its sha256 and
  bytes against the record. Then a draft Release on the record's tag, every
  archive uploaded, each held to GitHub's own digest, and only then
  published, never as the latest (the newest game release stays that). Run
  again on a published, whole Release, it says so and changes nothing.

  ON THE DAY THE REPOSITORY GOES PUBLIC, NOT BEFORE (Patrick, B on
  q-3287-release-when, 27 Oct 2026). While the repository is private it
  makes nothing: it says so and exits 0. The forks are the source anybody can
  reach until then, and -Check holds them.

  WHAT IT REFUSES. A fork whose tag is not the recorded commit, an archive
  that is not the recorded bytes, and a published Release that lacks an
  archive or holds one that is not the recorded bytes: a published Release is
  never changed. Each says which and exits 1, with nothing published.

  -CHECK. The nightly run (nightly.yml). What the notes beside the files name
  has to answer:
    - the Release, once it is made: published, every archive on it with
      GitHub's digest the recorded sha256 and the recorded bytes. Once the
      repository is public it has to be made: a note since version 3 of
      Source-Notice.ps1 names it first;
    - while the record says forksUp: each fork's tag, at the recorded commit.
  And the record has to be of the Frida that client-licences.json says the
  client files carry: a new Frida is a new set of archives on a new Release.
  Exit 0 all of that holds, 1 something does not, each one said.

  -FORKSMAYGO. Whether the forks may go: the Release is published and whole,
  the repository is public, and nothing offered names only the forks. A note
  names the Release from Source-Notice.ps1's version 3, so: each live feed's
  client runtime carries notice 3 or later, the release each live feed names
  was made from a commit whose Source-Notice.ps1 is version 3 or later (the
  packs, the baseline and on main the installer are made by that release's
  Ship), and so was every Release of this repository's game release tags.
  Exit 0 they may go (then the record's forksUp goes false in the same pull
  request that says so), 2 not yet, each reason said, 1 it could not be read.

  Every call out goes through Invoke-GitHub, Invoke-Git and Get-SiteText, so
  tests\test-3287-frida-sources.ps1 can stand in for GitHub, the forks and
  the site.
#>
[CmdletBinding(DefaultParameterSetName = 'Make')]
param(
    [Parameter(ParameterSetName = 'Check')][switch]$Check,
    [Parameter(ParameterSetName = 'Forks')][switch]$ForksMayGo,
    [string]$Record = '',
    [string]$Site = 'https://thornswood.net'
)

$ErrorActionPreference = 'Stop'
$RepoDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $Record) { $Record = Join-Path $RepoDir 'records\frida-sources.json' }
# The version of the note that names the Release first (Source-Notice.ps1).
$NamesRelease = 3

function Invoke-GitHub([string]$Method, [string]$Uri, $Body = $null, [string]$InFile = '', [string]$Accept = 'application/vnd.github+json') {
    $h = @{ Accept = $Accept; 'X-GitHub-Api-Version' = '2022-11-28' }
    if ($env:GH_TOKEN) { $h.Authorization = 'Bearer ' + $env:GH_TOKEN }
    $a = @{ Method = $Method; Uri = $Uri; Headers = $h }
    if ($InFile) { $a.InFile = $InFile; $a.ContentType = 'application/x-tar' }
    elseif ($null -ne $Body) { $a.Body = ($Body | ConvertTo-Json -Depth 6 -Compress); $a.ContentType = 'application/json' }
    return Invoke-RestMethod @a
}
function Invoke-Git([string[]]$GitArgs) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $o = @(& git @GitArgs 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($o -join "`n") }
    } finally { $ErrorActionPreference = $eap }
}
function Get-SiteText([string]$Uri) { return [string](Invoke-WebRequest -Uri $Uri -MaximumRedirection 5).Content }

function Stop-Run([string]$Why) { Write-Host "::error title=Frida sources::$Why"; Write-Host "STOPPED  $Why"; exit 1 }
function Get-Status($e) { try { return [int]$e.Exception.Response.StatusCode } catch { return 0 } }
# A page of a GitHub list, one item each. PowerShell hands a JSON list
# on as one object, so @() around it alone is a list of one list (measured
# 27 Oct on PowerShell 7.6: 20 Releases read as 1).
function Get-GitHubList([string]$Uri) { return @(Invoke-GitHub GET $Uri | ForEach-Object { $_ }) }

# ---- the record ----------------------------------------------------------------
if (-not (Test-Path -LiteralPath $Record)) { Stop-Run "$Record is missing" }
$rec = [IO.File]::ReadAllText($Record).TrimStart([char]0xFEFF) | ConvertFrom-Json
$parts = @($rec.parts)
$tag = [string]$rec.release.tag
$repo = [string]$rec.release.repo
if (-not $parts.Count -or $tag -notmatch '^frida-sources-\d+\.\d+\.\d+$' -or $repo -notmatch '^[\w.-]+/[\w.-]+$') { Stop-Run "$Record names no parts, or no Release" }
foreach ($p in $parts) {
    if ([string]$p.commit -notmatch '^[0-9a-f]{40}$' -or [string]$p.sha256 -notmatch '^[0-9a-f]{64}$' -or [string]$p.archive -ne ([string]$p.name + '-' + [string]$p.commit + '.tar')) {
        Stop-Run "$Record's part $($p.name) has no commit, no sha256, or an archive not named <name>-<commit>.tar"
    }
}
$owner = $repo.Split('/')[0]
$api = 'https://api.github.com/repos/' + $repo
$uploads = 'https://uploads.github.com/repos/' + $repo

# The Release on the tag, a draft included, or $null. A draft has no tag yet,
# so it is found in the list, not by /releases/tags/.
function Find-Release {
    for ($page = 1; $page -le 10; $page++) {
        $list = Get-GitHubList ($api + '/releases?per_page=100&page=' + $page)
        $r = $list | Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1
        if ($r) { return $r }
        if ($list.Count -lt 100) { break }
    }
    return $null
}
function Get-Assets($Rel) {
    $all = @()
    for ($page = 1; $page -le 5; $page++) {
        $got = Get-GitHubList ($api + '/releases/' + $Rel.id + '/assets?per_page=100&page=' + $page)
        $all += $got
        if ($got.Count -lt 100) { break }
    }
    return $all
}
function Test-Held($Assets, $Part) {
    return [bool](@($Assets | Where-Object { $_.name -eq $Part.archive -and $_.state -eq 'uploaded' -and [string]$_.digest -eq ('sha256:' + $Part.sha256) -and [long]$_.size -eq [long]$Part.bytes }).Count)
}
# The commit a fork's tag names, or '' when the fork or the tag is not there.
function Get-ForkCommit($Part) {
    $g = Invoke-Git @('ls-remote', ('https://github.com/' + $owner + '/' + $Part.name), ('refs/tags/' + $rec.forkTag), ('refs/tags/' + $rec.forkTag + '^{}'))
    if ($g.Code -ne 0) { return '' }
    $lines = @($g.Out -split "`n" | Where-Object { $_ -match '^[0-9a-f]{40}\s' })
    $peeled = @($lines | Where-Object { $_ -match '\^\{\}$' })
    $line = if ($peeled.Count) { $peeled[0] } elseif ($lines.Count) { $lines[0] } else { '' }
    return $(if ($line) { $line.Substring(0, 40) } else { '' })
}
function Get-Visibility {
    $r = Invoke-GitHub GET $api
    return [bool]$r.private
}

# ==== -Check ======================================================================
if ($Check) {
    $bad = @()
    $isPrivate = Get-Visibility

    $cl = Join-Path (Split-Path -Parent $Record) 'client-licences.json'
    if (Test-Path -LiteralPath $cl) {
        $l = [IO.File]::ReadAllText($cl).TrimStart([char]0xFEFF) | ConvertFrom-Json
        if ($l.ports.PSObject.Properties['frida-gum'] -and [string]$l.ports.'frida-gum'.version -ne [string]$rec.frida) {
            $bad += "the client files carry frida-gum $($l.ports.'frida-gum'.version), and the record is of Frida $($rec.frida): a new Frida needs its own archives on a new Release"
        }
    }

    $rel = Find-Release
    if (-not $rel) {
        if ($isPrivate) { Write-Host "  not made yet  the Release $tag; the repository is private, so the forks are the source anybody can reach" }
        else { $bad += "the repository is public and the Release $tag is not there; every note since version $NamesRelease names it" }
    } elseif ($rel.draft) {
        $bad += "the Release $tag is a draft; a run of frida-sources.yml fills and publishes it"
    } else {
        $have = Get-Assets $rel
        $off = @($parts | Where-Object { -not (Test-Held $have $_) } | ForEach-Object { $_.archive })
        if ($off.Count) { $bad += "the Release $tag lacks $($off.Count) archive(s), or holds other bytes under their names: $($off -join ', ')" }
        else { Write-Host "  whole  the Release $tag holds all $($parts.Count) archives, each the recorded bytes" }
    }

    if ($rec.forksUp) {
        foreach ($p in $parts) {
            $c = Get-ForkCommit $p
            if ($c -ne $p.commit) { $bad += "the fork $($p.name)'s tag $($rec.forkTag) is $(if ($c) { 'at ' + $c } else { 'not there' }), not at $($p.commit), and notes name it" }
        }
        if (-not ($bad | Where-Object { $_ -match "^the fork " })) { Write-Host "  up  all $($parts.Count) forks, each tag at its recorded commit" }
    }

    if ($bad.Count) {
        foreach ($b in $bad) { Write-Host "::error title=Frida sources::$b"; Write-Host "BAD  $b" }
        exit 1
    }
    Write-Host 'OK  the source of what is inside frida-gum.lib is where the notes say'
    exit 0
}

# ==== -ForksMayGo =================================================================
if ($ForksMayGo) {
    $not = @()
    try {
        if (Get-Visibility) { $not += 'the repository is private, so a stranger cannot reach the Release' }
        $rel = Find-Release
        if (-not $rel -or $rel.draft) { $not += "the Release $tag is not published" }
        else {
            $have = Get-Assets $rel
            if (@($parts | Where-Object { -not (Test-Held $have $_) }).Count) { $not += "the Release $tag is not whole" }
        }

        # The version of Source-Notice.ps1 a commit has, or 0 when it has none.
        $seen = @{}
        function Get-NoticeAt([string]$Commit) {
            if ($seen.ContainsKey($Commit)) { return $seen[$Commit] }
            $v = 0
            try {
                $t = [string](Invoke-GitHub GET ($api + '/contents/scripts/release/Source-Notice.ps1?ref=' + $Commit) -Accept 'application/vnd.github.raw')
                $m = [regex]::Match($t, '(?m)^\$SourceNoticeVersion = (\d+)')
                if ($m.Success) { $v = [int]$m.Groups[1].Value }
            } catch { if ((Get-Status $_) -ne 404) { throw } }
            $seen[$Commit] = $v
            return $v
        }

        foreach ($feed in @('feed', 'feed-dev')) {
            $doc = Get-SiteText "$Site/$feed/version.json" | ConvertFrom-Json
            if ($doc.PSObject.Properties['settings'] -and [string]$doc.settings.sha256 -match '^[0-9a-f]{64}$') {
                # The split feed (#1050): the rest of it is one more asset.
                $rest = Get-SiteText "$Site/$feed/assets/$($doc.settings.sha256)" | ConvertFrom-Json
                foreach ($p in $rest.PSObject.Properties) { if (-not $doc.PSObject.Properties[$p.Name]) { $doc | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value } }
            }
            if ($doc.PSObject.Properties['clientRuntime'] -and $doc.clientRuntime) {
                $n = if ($doc.clientRuntime.PSObject.Properties['notice']) { [int]$doc.clientRuntime.notice } else { 0 }
                if ($n -lt $NamesRelease) { $not += "$feed's client runtime carries notice $n, which does not name the Release" }
            }
            $c = if ($doc.PSObject.Properties['release'] -and $doc.release) { [string]$doc.release.commit } else { '' }
            if ($c -notmatch '^[0-9a-f]{7,40}$') { $not += "$feed names no release commit, so what its downloads say is not known" }
            elseif ((Get-NoticeAt $c) -lt $NamesRelease) { $not += "$feed's release was made from $($c.Substring(0, 8)), whose notes do not name the Release" }
        }

        for ($page = 1; $page -le 10; $page++) {
            $list = Get-GitHubList ($api + '/releases?per_page=100&page=' + $page)
            foreach ($r in @($list | Where-Object { [string]$_.tag_name -match '^release/(main|dev)/' })) {
                $ref = Invoke-GitHub GET ($api + '/git/ref/tags/' + $r.tag_name)
                $sha = [string]$ref.object.sha
                if ([string]$ref.object.type -eq 'tag') { $sha = [string](Invoke-GitHub GET ($api + '/git/tags/' + $sha)).object.sha }
                if ((Get-NoticeAt $sha) -lt $NamesRelease) { $not += "the Release of $($r.tag_name) was made from $($sha.Substring(0, 8)), whose notes do not name the Release" }
            }
            if ($list.Count -lt 100) { break }
        }
    } catch {
        Write-Host "::error title=Frida sources::$($_.Exception.Message)"
        Write-Host "COULD NOT READ  $($_.Exception.Message)"
        exit 1
    }
    if ($not.Count) {
        foreach ($n in $not) { Write-Host "NOT YET  $n" }
        exit 2
    }
    Write-Host "YES  the forks may go: the Release $tag is whole and public, and everything offered names it. Set forksUp to false in $Record in the same pull request."
    exit 0
}

# ==== make the Release ============================================================
$work = & (Join-Path $PSScriptRoot 'Get-ScratchDir.ps1') ('frida-sources-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    if (Get-Visibility) {
        Write-Host "PRIVATE  $repo is private, so the Release $tag waits for the day it goes public; until then the forks are the source anybody can reach. Nothing was made."
        exit 0
    }
    $rel = Find-Release
    if ($rel -and -not $rel.draft) {
        $have = Get-Assets $rel
        $off = @($parts | Where-Object { -not (Test-Held $have $_) } | ForEach-Object { $_.archive })
        if ($off.Count) { Stop-Run "the published Release $tag lacks $($off.Count) archive(s), or holds other bytes under their names (first: $($off[0])); a published Release is never changed, so nothing was uploaded" }
        Write-Host "ALREADY  the Release $tag is published and holds all $($parts.Count) archives"
        exit 0
    }

    # Every archive made and checked before anything goes up.
    $made = @{}
    foreach ($p in $parts) {
        $git = Join-Path $work ($p.name + '.git')
        $g = Invoke-Git @('init', '-q', '--bare', $git)
        if ($g.Code -ne 0) { Stop-Run "git init failed for $($p.name): $($g.Out)" }
        $from = 'https://github.com/' + $owner + '/' + $p.name
        $g = Invoke-Git @('-C', $git, 'fetch', '-q', '--depth', '1', $from, ('refs/tags/' + $rec.forkTag + ':refs/tags/' + $rec.forkTag))
        if ($g.Code -ne 0) { Stop-Run "could not fetch $($rec.forkTag) from $from ($($g.Out)); nothing was uploaded" }
        $g = Invoke-Git @('-C', $git, 'rev-parse', ($rec.forkTag + '^{commit}'))
        if ($g.Code -ne 0 -or $g.Out.Trim() -ne $p.commit) { Stop-Run "$from's $($rec.forkTag) is $($g.Out.Trim()), not $($p.commit); nothing was uploaded" }
        $f = Join-Path $work $p.archive
        # Written by git itself (--output): PowerShell's pipeline would read the bytes as text.
        $g = Invoke-Git @('-C', $git, 'archive', '--format=tar', ('--prefix=' + $p.name + '-' + $p.commit + '/'), ('--output=' + $f), $p.commit)
        if ($g.Code -ne 0) { Stop-Run "git archive failed for $($p.name); nothing was uploaded" }
        $sha = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()
        $len = (Get-Item -LiteralPath $f).Length
        if ($sha -ne $p.sha256 -or $len -ne [long]$p.bytes) { Stop-Run "$($p.archive) is $len bytes, $sha, not the recorded $($p.bytes) bytes, $($p.sha256); nothing was uploaded" }
        $made[$p.archive] = $f
        Write-Host "  made  $($p.archive)"
    }

    if (-not $rel) {
        $lines = @(
            "The source of what is inside frida-gum.lib $($rec.frida), Frida's own build, which SkyrimPlatformImpl.dll in the Thornswood client files links. Each archive is the source at the commit Frida $($rec.frida) built that part from.",
            ''
        )
        foreach ($p in $parts) { $lines += ('- ' + $p.holds + ': `' + $p.archive + '`, ' + $p.upstream + ' at ' + $p.commit) }
        $lines += @('', 'Their licences are in the client files'' licences\frida-gum.txt and in THIRD-PARTY.md. This Release stays as long as the launcher ships frida-gum.')
        $rel = Invoke-GitHub POST ($api + '/releases') @{
            tag_name = $tag; target_commitish = 'main'; name = "Frida $($rec.frida) sources"; draft = $true; prerelease = $false
            body = ($lines -join "`n")
        }
        Write-Host "  made a draft Release for $tag"
    }

    $have = Get-Assets $rel
    foreach ($p in $parts) {
        if (Test-Held $have $p) { continue }
        foreach ($wrong in @($have | Where-Object { $_.name -eq $p.archive })) {
            # A half upload, on a draft only.
            Invoke-GitHub DELETE ($api + '/releases/assets/' + $wrong.id) | Out-Null
        }
        Invoke-GitHub POST ($uploads + '/releases/' + $rel.id + '/assets?name=' + [uri]::EscapeDataString($p.archive)) -InFile $made[$p.archive] | Out-Null
        Write-Host "  up  $($p.archive)"
    }

    $have = Get-Assets $rel
    $off = @($parts | Where-Object { -not (Test-Held $have $_) } | ForEach-Object { $_.archive })
    if ($off.Count) { Stop-Run "the draft of $tag still lacks $($off.Count) archive(s) after the upload (first: $($off[0])); it stays a draft, and a run again fills it" }
    Invoke-GitHub PATCH ($api + '/releases/' + $rel.id) @{ draft = $false; make_latest = 'false' } | Out-Null
    Write-Host "PUBLISHED  the Release $tag, $($parts.Count) archives"
    exit 0
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}
