<#
  Publish-ReleaseFiles.ps1

  Puts every file one release names on a GitHub Release of this repository,
  on the release's own tag, so downloads and updates come from Releases
  (#3686, Patrick's decision of 26 Oct for going public).

      pwsh scripts/release/Publish-ReleaseFiles.ps1 -Tag release/main/20261026-170000
      pwsh scripts/release/Publish-ReleaseFiles.ps1 -Tag release/dev/20261026-160000-dev

  Run by .github/workflows/release-files.yml with the run's own token in
  GH_TOKEN; it needs nothing else and no secret.

  WHAT A LAUNCHER SEES. Nothing new: every launcher keeps asking
  thornswood.net/feed[-dev]/assets/<sha256>, and the site answers that with a
  redirect to the Release's copy once GitHub shows it publicly (site/server.js,
  "release copies"). So each file goes up named by its sha256, the name the
  site looks for, and GitHub's own digest of it has to be that sha256.

  WHICH FILES. The tag's message names them (Release-Name.ps1,
  Get-ReleaseFileShas): the record, the launcher, the client runtime, the
  notes, and the signed manifest with its catalog. The record lists every
  other file of the release, by bytes and sha256. A tag made before #3686
  names none; then the channel's live feed is read, and only when it still
  names this very release. Each file is fetched from the site, checked
  against its sha256 (and its bytes, where the record gives them), and only
  then uploaded. A main release also carries the installer the Downloads page
  offers, as Thornswood-Setup.exe, checked against the sha256 the site lists.

  WHAT IT REFUSES.
    - A private repository: a Release asset there answers 404 to a launcher,
      and a Release made now would go public with the repository, with
      whatever it holds. Nothing is uploaded until the repository is public,
      which Patrick does only after #3721's blockers, the files other people
      own among them, are cleared. It says so and exits 0.
    - A tag that is not release/main/<id> or release/dev/<id>.
    - A published Release that lacks a file: a published Release is never
      changed (a new build is a new release). It says which file and exits 1.
  A Release is made as a draft, filled, checked file by file against GitHub's
  digests, and only then published: a dev release as a prerelease, a main
  one as the latest. A draft a stopped run left is filled from where it
  stopped. Run again on a release that is already published and complete, it
  says so and changes nothing.

  EXITS. 0 published, already there, or private. 1 refused or failed, with why.
  tests\test-3686-release-files.ps1 drives it against a stand-in GitHub and site.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [string]$Repo = $env:GITHUB_REPOSITORY,
    [string]$Site = 'https://thornswood.net'
)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = 'ThornswoodRP/Thornswood' }
$script:Api = 'https://api.github.com/repos/' + $Repo
$script:Uploads = 'https://uploads.github.com/repos/' + $Repo

# Every call to GitHub and the site goes through these three, so the harness
# can stand in for both.
function Invoke-GitHub([string]$Method, [string]$Uri, $Body = $null, [string]$InFile = '', [string]$ContentType = 'application/json') {
    $h = @{ Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
    if ($env:GH_TOKEN) { $h.Authorization = 'Bearer ' + $env:GH_TOKEN }
    $a = @{ Method = $Method; Uri = $Uri; Headers = $h }
    if ($InFile) { $a.InFile = $InFile; $a.ContentType = $ContentType }
    elseif ($null -ne $Body) { $a.Body = ($Body | ConvertTo-Json -Depth 6 -Compress); $a.ContentType = $ContentType }
    return Invoke-RestMethod @a
}
function Get-SiteFile([string]$Uri, [string]$OutFile) {
    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -MaximumRedirection 5 | Out-Null
}
function Get-SiteJson([string]$Uri) { return Invoke-RestMethod -Uri $Uri }

function Stop-Run([string]$Why) { Write-Host "::error title=Release files::$Why"; Write-Host "STOPPED  $Why"; exit 1 }

if ($Tag -notmatch '^release/(main|dev)/(\d{8}-\d{4,6}(-dev)?)$') { Stop-Run "'$Tag' is not release/main/<id> or release/dev/<id>; nothing was uploaded" }
$channel = $Matches[1]
$id = $Matches[2]
$feedDir = if ($channel -eq 'dev') { 'feed-dev' } else { 'feed' }

# ---- the repository is public, or nothing goes up ---------------------------
$r = Invoke-GitHub GET $script:Api
if ($r.private) {
    Write-Host "PRIVATE  $Repo is private, so nothing goes on a Release: a launcher could not download it, and it would go public with the repository. The site sends every file of $Tag itself."
    exit 0
}

# ---- the files the tag names --------------------------------------------------
function Read-TagShas([string]$Message) {
    $out = [ordered]@{}
    foreach ($line in ($Message -split "`r?`n")) {
        if ($line -match '^(record|exe|runtime|news|manifest|catalog) +([0-9a-f]{64})\s*$') { $out[$Matches[1]] = $Matches[2] }
    }
    return $out
}
# The same labels, read off a feed the way Get-ReleaseFileShas reads one.
function Read-FeedShas($Doc) {
    . (Join-Path $PSScriptRoot 'Release-Name.ps1')
    return Get-ReleaseFileShas $Doc
}

$ref = Invoke-GitHub GET ($script:Api + '/git/ref/tags/' + $Tag)
if ([string]$ref.object.type -ne 'tag') { Stop-Run "$Tag is not an annotated release tag; nothing was uploaded" }
$tagObj = Invoke-GitHub GET ($script:Api + '/git/tags/' + $ref.object.sha)
$shas = Read-TagShas ([string]$tagObj.message)
if (-not $shas.Contains('record')) {
    # A tag from before #3686: the live feed, while it still names this release.
    $work0 = Join-Path ([IO.Path]::GetTempPath()) ('release-files-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work0 -Force | Out-Null
    $vf = Join-Path $work0 'version.json'
    Get-SiteFile "$Site/$feedDir/version.json" $vf
    $doc = [IO.File]::ReadAllText($vf).TrimStart([char]0xFEFF) | ConvertFrom-Json
    if ($doc.PSObject.Properties['settings'] -and [string]$doc.settings.sha256 -match '^[0-9a-f]{64}$') {
        # The split feed (#1050): the rest of it is one more asset.
        $sf = Join-Path $work0 'settings.json'
        Get-SiteFile "$Site/$feedDir/assets/$($doc.settings.sha256)" $sf
        $rest = [IO.File]::ReadAllText($sf) | ConvertFrom-Json
        foreach ($p in $rest.PSObject.Properties) { if (-not $doc.PSObject.Properties[$p.Name]) { $doc | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value } }
    }
    $named = if ($doc.PSObject.Properties['release'] -and $doc.release) { [string]$doc.release.tag } else { '' }
    if ($named -ne $Tag) { Stop-Run "$Tag names none of its files, and the $channel feed now names '$named', so this release's files are not known here; nothing was uploaded" }
    $shas = Read-FeedShas $doc
    Remove-Item -LiteralPath $work0 -Recurse -Force
    if (-not $shas.Contains('record')) { Stop-Run "the $channel feed names no record for $Tag; nothing was uploaded" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('release-files-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    # Fetched once, checked, kept until the upload: name -> @{ Path; Sha; Bytes }.
    $want = [ordered]@{}
    function Get-Checked([string]$Uri, [string]$Sha, [long]$Bytes = -1) {
        $f = Join-Path $work ([Guid]::NewGuid().ToString('N'))
        Get-SiteFile $Uri $f
        $got = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($got -ne $Sha) { Stop-Run "$Uri is $got, not $Sha; nothing was published" }
        if ($Bytes -ge 0 -and (Get-Item -LiteralPath $f).Length -ne $Bytes) { Stop-Run "$Uri is $((Get-Item -LiteralPath $f).Length) bytes, not $Bytes; nothing was published" }
        return $f
    }
    foreach ($k in $shas.Keys) {
        $s = $shas[$k]
        if (-not $want.Contains($s)) { $want[$s] = @{ Sha = $s; Bytes = -1; What = $k } }
    }
    # The record names every other file, "<bytes>:<sha256>" under its path.
    $recFile = Get-Checked "$Site/$feedDir/assets/$($shas['record'])" $shas['record']
    $want[$shas['record']].Path = $recFile
    $rec = [IO.File]::ReadAllText($recFile).TrimStart([char]0xFEFF) | ConvertFrom-Json
    foreach ($p in $rec.PSObject.Properties) {
        if ([string]$p.Value -match '^(\d+):([0-9a-f]{64})$') {
            $s = $Matches[2]
            if (-not $want.Contains($s)) { $want[$s] = @{ Sha = $s; Bytes = [long]$Matches[1]; What = $p.Name } }
        }
    }
    $installer = $null
    if ($channel -eq 'main') {
        $pub = Get-SiteJson "$Site/api/public"
        $row = @($pub.files | Where-Object { $_.name -eq 'Thornswood-Setup.exe' }) | Select-Object -First 1
        if ($row -and [string]$row.sha256 -match '^[0-9a-f]{64}$') { $installer = @{ Sha = [string]$row.sha256; Bytes = [long]$row.size } }
        else { Write-Host "  the site lists no installer with a sha256, so $Tag goes up without one" }
    }
    $count = $want.Count + $(if ($installer) { 1 } else { 0 })
    Write-Host "$Tag names $count file(s)"

    # ---- the Release: found (a draft included), or made as a draft ---------
    # GitHub's answer comes back as one object holding the JSON array, so every page
    # is spread through ForEach-Object: wrapped in @() as it comes, a page of
    # 100 counts as 1, and the paging stopped after the first (#3686: the dev
    # release's 253 files read as 100, and 153 "still lacked" after upload).
    function Get-Page([string]$Uri) { return @(Invoke-GitHub GET $Uri | ForEach-Object { $_ }) }
    $rel = $null
    for ($page = 1; $page -le 10 -and -not $rel; $page++) {
        $list = Get-Page ($script:Api + '/releases?per_page=100&page=' + $page)
        $rel = $list | Where-Object { $_.tag_name -eq $Tag } | Select-Object -First 1
        if ($list.Count -lt 100) { break }
    }
    function Get-Assets($Rel) {
        $all = @()
        for ($page = 1; $page -le 20; $page++) {
            $got = Get-Page ($script:Api + '/releases/' + $Rel.id + '/assets?per_page=100&page=' + $page)
            $all += $got
            if ($got.Count -lt 100) { break }
        }
        return $all
    }
    function Test-Held($Assets, [string]$Name, [string]$Sha) {
        return [bool](@($Assets | Where-Object { $_.name -eq $Name -and $_.state -eq 'uploaded' -and [string]$_.digest -eq ('sha256:' + $Sha) }).Count)
    }
    $names = @($want.Keys) + $(if ($installer) { @('Thornswood-Setup.exe') } else { @() })
    $shaOf = @{}; foreach ($s in $want.Keys) { $shaOf[$s] = $s }; if ($installer) { $shaOf['Thornswood-Setup.exe'] = $installer.Sha }

    if ($rel -and -not $rel.draft) {
        $have = Get-Assets $rel
        $missing = @($names | Where-Object { -not (Test-Held $have $_ $shaOf[$_]) })
        if ($missing.Count) { Stop-Run ("the published Release of $Tag lacks $($missing.Count) of its files (first: $($missing[0])); a published Release is never changed, so nothing was uploaded") }
        Write-Host "ALREADY  the Release of $Tag is published and holds all $count file(s)"
        exit 0
    }
    if (-not $rel) {
        $rel = Invoke-GitHub POST ($script:Api + '/releases') @{
            tag_name = $Tag; name = "Thornswood $channel release $id"; draft = $true; prerelease = ($channel -eq 'dev')
            body = "The files of Thornswood's $channel release $id, each named by its sha256. Launchers fetch them through thornswood.net, which sends them here."
        }
        Write-Host "  made a draft Release for $Tag"
    }

    # ---- fill it: whatever the draft does not already hold, checked first --
    $have = Get-Assets $rel
    foreach ($name in $names) {
        $sha = $shaOf[$name]
        if (Test-Held $have $name $sha) { continue }
        foreach ($wrong in @($have | Where-Object { $_.name -eq $name })) {
            # A half upload or another file under this name, on a draft only.
            Invoke-GitHub DELETE ($script:Api + '/releases/assets/' + $wrong.id) | Out-Null
        }
        if ($name -eq 'Thornswood-Setup.exe') { $f = Get-Checked "$Site/file/Thornswood-Setup.exe" $sha $installer.Bytes }
        elseif ($want[$sha].Path) { $f = $want[$sha].Path }
        else { $f = Get-Checked "$Site/$feedDir/assets/$sha" $sha $want[$sha].Bytes }
        Invoke-GitHub POST ($script:Uploads + '/releases/' + $rel.id + '/assets?name=' + [uri]::EscapeDataString($name)) -InFile $f -ContentType 'application/octet-stream' | Out-Null
        if ($f -ne $want[$sha].Path) { Remove-Item -LiteralPath $f -Force }
        Write-Host "  up  $name"
    }

    # ---- every file there, by GitHub's own digest, then published ----------
    $have = Get-Assets $rel
    $missing = @($names | Where-Object { -not (Test-Held $have $_ $shaOf[$_]) })
    if ($missing.Count) { Stop-Run ("the draft of $Tag still lacks $($missing.Count) file(s) after the upload (first: $($missing[0])); it stays a draft, and a run again fills it") }
    Invoke-GitHub PATCH ($script:Api + '/releases/' + $rel.id) @{ draft = $false; make_latest = $(if ($channel -eq 'main') { 'true' } else { 'false' }) } | Out-Null
    Write-Host "PUBLISHED  the Release of $Tag, $count file(s)"
    exit 0
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}
