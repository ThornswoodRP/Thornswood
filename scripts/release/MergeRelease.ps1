<#
  MergeRelease.ps1

  What .github/workflows/merge-release.yml works out between steps (#5179):
  the release's names, the newest Release before it, and which parts the
  merge changed. Dot-sourced; defines functions and nothing else. ASCII, and
  PowerShell 7. tests\test-5179-merge-release.ps1 drives every function.

      . ./scripts/release/MergeRelease.ps1
      New-MergeReleaseNames [-Taken <tags>]
          @{ Tag = 'build-1.3.0'; Velopack = '1.3.0' }
      Resolve-MergeReleaseSince -Commit <sha> -Subject <scriptblock> [-RepoDir .]
          where this history's notes start: the Release before's commit, or
          the same merge in this history when the history was rewritten
      Get-MergeReleaseList [-Repo owner/name]
          every Release, all pages, in GitHub's order (which is not newest first)
      Get-MergeReleasePrevious [-Repo owner/name]
          the highest published build-1.3.<n> Release and its manifest, or $null
      Get-MergeReleasePrint -Manifest <obj> -Part <name>
          one line that changes exactly when the part's content does
      Get-MergeReleaseChanged -Manifest <obj> [-Previous <obj>]
          the parts whose print differs from the Release before
      Test-MergeReleaseVelopack -LauncherVersion <a.b.c> -GameZipSha256 <hex>
                                [-Previous <obj>]
          whether this merge makes a Velopack package, and so builds the
          launcher with the release's Velopack version
      Get-VelopackFullOf -Release <GitHub's Release> -Channel dev|main
          the channel's own full package on it, Name and Version, or $null
      Find-MainPackage -Tag <tag> -Manifest <obj> [-Repo owner/name]
          the main package a promotion of <tag> puts out, and whether its
          Release main-<tag> is out already (promote-main.yml)
      Get-MainPackageProblem -Record <obj> -Have <name to sha256>
          '' when the files are exactly the record's main package
      Push-MainPackage -Folder <dir> -Tag <tag> -Commit <sha>
      Save-MainPackage -Tag <tag> -Commit <sha> (-Into <dir> | -Look)
          main's package of a build kept on GitHub Packages, and read back
          (MAIN'S PACKAGE ON GITHUB PACKAGES below)

  THE NAMES. One number gives both: the tag the agent applies,
  build-1.3.<n>, and the Velopack version, 1.3.<n>, which must be SemVer and
  must grow with every release (Patrick, 8 Nov 2026: back to the three-part
  v1.2.16 style, starting at 1.3.0, from the date numbers
  build-<yyyyMMdd>.<n> and <yyyy>.<M*100+d>.<n> the releases had from 1
  Nov). n is one more than the highest any build-1.3. tag or Release (drafts
  too) already uses, and 0 when there is none: 1.3.0 is the first, a new
  minor after v1.2.16, the last launcher before Velopack. Runs never overlap (one
  concurrency group), so a name is never taken twice. Each part of a Windows
  file version is at most 65534, so n stops there and says so.

  WHERE THE NOTES START. The commit of the Release before, when this history
  holds it. The history was rewritten on 1 Nov (#5231), so a Release from
  before then names a commit this history does not hold, and GitHub can
  compare nothing to it. That Release's merge is still here under another
  id with the same title, ending in its pull request's number, (#N), so the
  first-parent commit of this history whose title ends the same is where
  the notes start. No such commit, or more than one, and it stops.

  WHAT COUNTS AS A CHANGE. Every Release carries every part, so any of them
  can be put back by its tag; only a part whose content changed asks for a
  Deployment of its own, and a merge that changed none publishes nothing. A
  part's print is its files' names and sha256, sorted, with three kinds left
  out: the gamemode's stamp (thornswood-build.json names the commit, so it
  differs on every merge), the server zip (ServerArtifact.ps1 zips it on
  each run; its record, server-build.json, says which build it is) and the
  game files' list (game-files.json names the commit; game.zip is the same
  bytes for the same files, Build-GameFiles.ps1 says how), and the gate's
  verbs.json in the steps after a deploy (it travels with them so the agent
  holds each step to the signed list, #5186, but a change to the gate alone
  is no reason for a Deployment; a step file that changes is). The
  velopack and main parts, dev's and main's Velopack packages, are made from
  the launcher and the game files, so neither is compared on its own.

  THE LAUNCHER'S PRINT is its source number (the manifest's launcherVersion,
  LauncherVersion.ps1), not its files (#4825). The exe carries the Velopack
  version it was packed as (-p:Version, Build-Launcher.ps1), so the same
  sources built for two packages are two different files; a launcher whose
  sources no merge touched is not a change, whatever its bytes.

  ONE NUMBER (#4825). A Velopack package is made when the launcher's sources
  or the game files changed, and the launcher in it is built for it, with
  the package's version, so the number the launcher says is the number
  Velopack installed. Otherwise no package is made and the launcher of the
  Release before is carried. Test-MergeReleaseVelopack makes that call from
  the same prints Get-MergeReleaseChanged compares, before the launcher is
  built, so the two cannot disagree.
#>

$script:MergeReleaseFirst = 0

function New-MergeReleaseNames {
  param([string[]]$Taken = @())
  $n = $script:MergeReleaseFirst - 1
  foreach ($t in @($Taken)) {
    if ([string]$t -match '^(?:main-)?build-1\.3\.(\d{1,9})$') { $n = [Math]::Max($n, [long]$Matches[1]) }
  }
  $n++
  if ($n -gt 65534) { throw "the next release would be 1.3.$n, and a part of a Windows file version is at most 65534" }
  return [pscustomobject]@{
    Tag      = ('build-1.3.{0}' -f $n)
    Velopack = ('1.3.{0}' -f $n)
  }
}

function Resolve-MergeReleaseSince {
  param([Parameter(Mandatory = $true)][string]$Commit, [Parameter(Mandatory = $true)][scriptblock]$Subject, [string]$RepoDir = '.')
  if ($Commit -notmatch '^[0-9a-f]{40}$') { throw "the Release before names $Commit, which is not a commit" }
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    & git -C $RepoDir merge-base --is-ancestor $Commit HEAD 2>$null
    $inHistory = ($LASTEXITCODE -eq 0)
  } finally { $ErrorActionPreference = $eap }
  if ($inHistory) { return $Commit }
  $title = [string](& $Subject $Commit)
  if ($title -notmatch '\(#(\d+)\)\s*$') { throw "the Release before is commit $Commit, which this history does not hold, and its title ($title) names no pull request to find it by" }
  $end = '(#' + $Matches[1] + ')'
  $hits = @(& git -C $RepoDir log --first-parent --format='%H%x09%s' HEAD | Where-Object { ($_ -split "`t", 2)[1].TrimEnd().EndsWith($end) })
  if ($hits.Count -ne 1) { throw "the Release before is commit $Commit, which this history does not hold, and $($hits.Count) commits here end in $end, not one" }
  return ($hits[0] -split "`t", 2)[0]
}

function Get-MergeReleasePrint {
  param([Parameter(Mandatory = $true)]$Manifest, [Parameter(Mandatory = $true)][string]$Part)
  if ($null -eq $Manifest -or $null -eq $Manifest.parts) { return '' }
  $p = $Manifest.parts.PSObject.Properties[$Part]
  if ($null -eq $p) { return '' }
  if ($Part -eq 'launcher') {
    $v = $Manifest.PSObject.Properties['launcherVersion']
    return $(if ($null -eq $v) { '' } else { 'launcherVersion:' + [string]$v.Value })
  }
  $lines = foreach ($f in @($p.Value)) {
    $n = [string]$f.name
    if ($Part -eq 'gamemode' -and $n -eq 'thornswood-build.json') { continue }
    if ($Part -eq 'server' -and $n -ne 'server-build.json') { continue }
    if ($Part -eq 'game' -and $n -ne 'game.zip') { continue }
    if ($Part -eq 'after' -and $n -eq 'verbs.json') { continue }
    $n + ':' + ([string]$f.sha256).ToLowerInvariant()
  }
  $arr = [string[]]@($lines)
  [Array]::Sort($arr, [StringComparer]::Ordinal)
  return ($arr -join ';')
}

function Get-MergeReleaseChanged {
  param([Parameter(Mandatory = $true)]$Manifest, $Previous = $null)
  $changed = New-Object System.Collections.Generic.List[string]
  foreach ($p in @($Manifest.parts.PSObject.Properties)) {
    if ($p.Name -in 'velopack', 'main') { continue }
    if ($null -eq $Previous -or (Get-MergeReleasePrint $Manifest $p.Name) -ne (Get-MergeReleasePrint $Previous $p.Name)) { $changed.Add($p.Name) }
  }
  # Unrolled: callers take it as @(...), which gives an empty array for none.
  return $changed.ToArray()
}

# True when the launcher's source number or the game files differ from the
# Release before, or there is none: the merge makes a Velopack package and
# builds the launcher for it (header, ONE NUMBER). The game files are given
# as game.zip's sha256, the one file of the part that is compared.
function Test-MergeReleaseVelopack {
  param([Parameter(Mandatory = $true)][string]$LauncherVersion, [Parameter(Mandatory = $true)][string]$GameZipSha256, $Previous = $null)
  $m = [pscustomobject]@{
    launcherVersion = $LauncherVersion
    parts           = [pscustomobject]@{
      launcher = @()
      game     = @([pscustomobject]@{ name = 'game.zip'; sha256 = $GameZipSha256; size = 0 })
    }
  }
  $c = @(Get-MergeReleaseChanged -Manifest $m -Previous $Previous)
  return ($c -contains 'launcher' -or $c -contains 'game')
}

# The channel's own full package on a Release, as GitHub lists its assets:
# Name and Version, or $null when it has none. A Release's feed also names the
# full package its delta was made from, but that file is on the Release
# before, so only an asset of this Release counts, and of those the highest
# numbered (merge-release.yml, the delta's base).
function Get-VelopackFullOf {
  param([Parameter(Mandatory = $true)]$Release, [Parameter(Mandatory = $true)][string]$Channel)
  $best = $null
  foreach ($a in @($Release.assets)) {
    if ([string]$a.name -notmatch ('^Thornswood-(\d+\.\d+\.\d+)-' + [regex]::Escape($Channel) + '-full\.nupkg$')) { continue }
    $v = [version]$Matches[1]
    if ($null -eq $best -or $v -gt [version]$best.Version) { $best = [pscustomobject]@{ Name = [string]$a.name; Version = $Matches[1] } }
  }
  return $best
}

# Every Release of the repository, all pages, drafts too. GitHub's list is
# not in the order the Releases were made: on 9 Nov 2026 it gave
# build-1.3.9 before build-1.3.10 to build-1.3.13, and it puts every draft
# ahead of them, so neither its first entry nor its first page is "the
# newest". Whoever wants the newest of something reads all of them and
# orders them itself. Throws when a page cannot be read, so a failed read is
# never taken for a short list.
function Get-MergeReleaseList {
  param([string]$Repo = $env:GITHUB_REPOSITORY, [string]$ReleasesFile = '')
  if ($ReleasesFile) { return @(Get-Content -LiteralPath $ReleasesFile -Raw | ConvertFrom-Json) }
  $all = @()
  for ($page = 1; ; $page++) {
    $raw = gh api "repos/$Repo/releases?per_page=100&page=$page"
    if ($LASTEXITCODE -ne 0) { throw "GitHub did not list page $page of the Releases of $Repo (gh exit $LASTEXITCODE)" }
    $got = @(($raw -join "`n") | ConvertFrom-Json)
    $all += $got
    if ($got.Count -lt 100) { break }
  }
  return $all
}

# The newest published build Release, the highest build-1.3.<n>, with its
# manifest.json read from its assets. By the number in the tag and never by
# GitHub's list order (Get-MergeReleaseList says why): taking the first one
# GitHub listed made build-1.3.10 to build-1.3.13 all start their notes and
# their changed parts from build-1.3.9, so each said "Site pages show
# sooner" again. Drafts are skipped: a run that stopped part way leaves one,
# and it was never applied. $null when there is none yet. Throws when GitHub
# cannot be read, so a failed read is never taken for "no Release before".
function Get-MergeReleasePrevious {
  param([string]$Repo = $env:GITHUB_REPOSITORY, [string]$ReleasesFile = '', [string]$ManifestDir = '')
  $rels = Get-MergeReleaseList -Repo $Repo -ReleasesFile $ReleasesFile
  $builds = @($rels | Where-Object { -not $_.draft -and (Get-MergeReleaseOrder ([string]$_.tag_name)) -ge 0 } |
              Sort-Object { Get-MergeReleaseOrder ([string]$_.tag_name) } -Descending)
  foreach ($r in $builds) {
    $asset = @($r.assets | Where-Object { $_.name -eq 'manifest.json' }) | Select-Object -First 1
    if ($null -eq $asset) { continue }
    if ($ManifestDir) { $m = Get-Content -LiteralPath (Join-Path $ManifestDir ([string]$r.tag_name + '.json')) -Raw | ConvertFrom-Json }
    else {
      $mraw = gh api -H 'Accept: application/octet-stream' ("repos/$Repo/releases/assets/" + $asset.id)
      if ($LASTEXITCODE -ne 0) { throw "GitHub did not hand over manifest.json of $($r.tag_name) (gh exit $LASTEXITCODE)" }
      $m = ($mraw -join "`n") | ConvertFrom-Json
    }
    if ([string]$m.tag -ne [string]$r.tag_name) { throw "$($r.tag_name)'s manifest.json says it is $($m.tag)" }
    return [pscustomobject]@{ Tag = [string]$r.tag_name; Commit = [string]$m.commit; Id = $r.id; Manifest = $m; Assets = @($r.assets) }
  }
  return $null
}

# ---- main's launcher package, put out by the promotion (#5181, #4825) ------------
#
# Every merge that makes dev's Velopack package makes main's too, lists it in
# the signed manifest as the part "main", and keeps its files with its run as
# the artifact main-<tag> (merge-release.yml, MAIN'S PACKAGE). They go out on
# a Release of their own, main-<tag> (VeloRecord.MainRelease; a main launcher
# reads its updates from the Releases that carry releases.main.json), when
# Patrick approves a promotion to main (promote-main.yml), so nothing reaches
# a main launcher unapproved.
#
# The package a promotion of <tag> puts out is the one <tag> runs with: its
# own, or, when its merge made none, that of the newest build Release before
# it that made one. A merge makes no package when neither the launcher's
# sources nor the game files changed (ONE NUMBER above), so every Release in
# between carries the same launcher number and game.zip, which is checked.

# A build Release tag's place in order, build-1.3.<n>, or -1. A tag from the
# date numbers before it (build-<yyyyMMdd>.<n>) is -1 too: the first 1.3.x
# release carries a package of its own, since its merge changed the launcher,
# so no promotion reaches back past it.
function Get-MergeReleaseOrder {
  param([string]$Tag)
  if ($Tag -notmatch '^build-1\.3\.(\d{1,9})$') { return [long]-1 }
  return [long]$Matches[1]
}

# '' when $Have (file name to sha256) is exactly the record's part "main", by
# name and sha256; otherwise why not, as the rest of a sentence about it.
function Get-MainPackageProblem {
  param([Parameter(Mandatory = $true)]$Record, [Parameter(Mandatory = $true)][hashtable]$Have)
  $p = $Record.parts.PSObject.Properties['main']
  if ($null -eq $p -or @($p.Value).Count -eq 0) { return "the record of $($Record.tag) lists no main package" }
  $want = @{}
  foreach ($f in @($p.Value)) { $want[[string]$f.name] = ([string]$f.sha256).ToLowerInvariant() }
  foreach ($n in $want.Keys) {
    if (-not $Have.ContainsKey($n)) { return "lacks $n, which the record of $($Record.tag) lists" }
    if (([string]$Have[$n]).ToLowerInvariant() -ne $want[$n]) { return "holds a $n that is not the one the record of $($Record.tag) lists" }
  }
  foreach ($n in $Have.Keys) {
    if (-not $want.ContainsKey($n)) { return "holds $n, which the record of $($Record.tag) does not list" }
  }
  return ''
}

# The package a promotion of $Tag puts out ($Manifest is $Tag's manifest):
# $null when no build Release up to $Tag made one; otherwise From (the build
# Release that made it), MainTag (main-<From>), Commit and Record (its
# manifest), and Published, true when main-<From> is out already and holds
# exactly those files. Throws when $Tag is not among the Releases read, when
# the Release that made the package carries another launcher or other game
# files than $Tag, and when main-<From> is a draft or holds other files.
function Find-MainPackage {
  param([Parameter(Mandatory = $true)][string]$Tag, [Parameter(Mandatory = $true)]$Manifest,
        [string]$Repo = $env:GITHUB_REPOSITORY, [string]$ReleasesFile = '', [string]$ManifestDir = '')
  $rels = Get-MergeReleaseList -Repo $Repo -ReleasesFile $ReleasesFile
  $at = Get-MergeReleaseOrder $Tag
  if ($at -lt 0) { throw "$Tag is not a build Release tag" }
  if (-not @($rels | Where-Object { [string]$_.tag_name -eq $Tag -and -not $_.draft }).Count) { throw "$Tag is not among the published Releases" }
  $builds = @($rels | Where-Object { -not $_.draft -and (Get-MergeReleaseOrder ([string]$_.tag_name)) -ge 0 -and (Get-MergeReleaseOrder ([string]$_.tag_name)) -le $at } |
              Sort-Object { Get-MergeReleaseOrder ([string]$_.tag_name) } -Descending)
  # Read by property, so a manifest from before a field existed reads as ''.
  $lvOf = { param($x) $v = $x.PSObject.Properties['launcherVersion']; if ($v) { [string]$v.Value } else { '' } }
  $gameOf = {
    param($x)
    $g = $x.parts.PSObject.Properties['game']
    if (-not $g) { return '' }
    @(@($g.Value) | Where-Object { $_.name -eq 'game.zip' } | ForEach-Object { ([string]$_.sha256).ToLowerInvariant() }) -join ';'
  }
  foreach ($r in $builds) {
    $t = [string]$r.tag_name
    if ($t -eq $Tag) { $m = $Manifest }
    else {
      $asset = @($r.assets | Where-Object { $_.name -eq 'manifest.json' }) | Select-Object -First 1
      if ($null -eq $asset) { continue }
      if ($ManifestDir) { $m = Get-Content -LiteralPath (Join-Path $ManifestDir ($t + '.json')) -Raw | ConvertFrom-Json }
      else {
        $mraw = gh api -H 'Accept: application/octet-stream' ("repos/$Repo/releases/assets/" + $asset.id)
        if ($LASTEXITCODE -ne 0) { throw "GitHub did not hand over manifest.json of $t (gh exit $LASTEXITCODE)" }
        $m = ($mraw -join "`n") | ConvertFrom-Json
      }
      if ([string]$m.tag -ne $t) { throw "$t's manifest.json says it is $($m.tag)" }
    }
    if ($null -eq $m.parts.PSObject.Properties['main']) { continue }
    if ($t -ne $Tag -and ((& $lvOf $m) -ne (& $lvOf $Manifest) -or (& $gameOf $m) -ne (& $gameOf $Manifest))) {
      throw ("$Tag made no main package, and $t, the newest Release before it that made one, carries launcher $(& $lvOf $m) and game.zip $(& $gameOf $m), " +
             "where $Tag carries launcher $(& $lvOf $Manifest) and game.zip $(& $gameOf $Manifest), so no package goes with $Tag")
    }
    $mainTag = 'main-' + $t
    $published = $false
    $out = @($rels | Where-Object { [string]$_.tag_name -eq $mainTag })
    if ($out.Count) {
      if ($out[0].draft) { throw "$mainTag is a draft: a promotion stopped while putting it out. Delete the draft and promote again" }
      $have = @{}
      # GitHub's own sha256 of each file, which it measured on upload.
      foreach ($a in @($out[0].assets)) {
        $d = $a.PSObject.Properties['digest']
        $have[[string]$a.name] = $(if ($d -and $d.Value) { ([string]$d.Value) -replace '^sha256:', '' } else { '' })
      }
      $why = Get-MainPackageProblem -Record $m -Have $have
      if ($why) { throw "$mainTag is out already and $why" }
      $published = $true
    }
    return [pscustomobject]@{ From = $t; MainTag = $mainTag; Commit = [string]$m.commit; Record = $m; Published = $published }
  }
  return $null
}

# False when main's newest launcher package up to $Tag can never go out: it
# is not out on its Release main-<tag> already, and either it is not kept as
# a package (MAIN'S PACKAGE ON GITHUB PACKAGES below; a build before 8 Nov
# 2026 kept it as an artifact) or there is no tag main-<tag> for the
# promotion to put that Release on (merge-release.yml, Tag main's package
# for the approval; a run's own token cannot make that tag later, #5489). True when it can, or when no Release up to $Tag made
# one. Throws when GitHub cannot be read, so a failed read never makes a
# package nobody asked for.
function Test-MainPackageReachable {
  param([Parameter(Mandatory = $true)][string]$Tag, [Parameter(Mandatory = $true)]$Manifest,
        [string]$Repo = $env:GITHUB_REPOSITORY, [string]$ReleasesFile = '', [string]$ManifestDir = '',
        [scriptblock]$TagCommit = $null, [scriptblock]$Kept = $null)
  $pkg = Find-MainPackage -Tag $Tag -Manifest $Manifest -Repo $Repo -ReleasesFile $ReleasesFile -ManifestDir $ManifestDir
  if ($null -eq $pkg -or $pkg.Published) { return $true }
  if ($null -eq $Kept) {
    $Kept = {
      param($p)
      $auth = Get-MainPackageAuth -Repo $Repo -Token $env:GH_TOKEN -Scope 'pull' -Registry 'ghcr.io' -Scheme 'https' -Http ${function:Invoke-MainPackageHttp}
      $m = Get-MainPackageManifest -Auth $auth -Tag $p.From -Http ${function:Invoke-MainPackageHttp}
      return ($null -ne $m)
    }
  }
  if (-not (& $Kept $pkg)) { return $false }
  if ($null -eq $TagCommit) {
    $TagCommit = {
      param($name)
      $out = gh api "repos/$Repo/git/matching-refs/tags/$name" --jq '.[] | .ref + " " + .object.type + " " + .object.sha'
      if ($LASTEXITCODE -ne 0) { throw "GitHub did not list the tags $name (gh exit $LASTEXITCODE)" }
      $hit = @(@($out) | Where-Object { $_ -like "refs/tags/$name *" })
      if ($hit.Count -eq 0) { return '' }
      return ($hit[0] -split ' ', 2)[1]
    }
  }
  return ([string](& $TagCommit $pkg.MainTag) -eq ('commit ' + $pkg.Commit))
}

<#
  MAIN'S PACKAGE ON GITHUB PACKAGES (Patrick, 30 Oct and 8 Nov 2026: use
  GitHub's Releases, Deployments and Packages). Every merge that makes main's
  launcher package keeps its files as one package version of this
  repository, ghcr.io/<owner>/thornswood-launcher-main:<build tag>, until
  promote-main.yml puts them out on the Release main-<tag> once Patrick
  approves. Until 8 Nov they were an Actions artifact, kept 90 days at most
  and counted against the artifact storage that was already full (#3399); a
  package version is kept until somebody deletes it.

  One OCI artifact: each file a layer of its own, named by its
  org.opencontainers.image.title, the empty config, and annotations that link
  it to this repository and name the build and its commit. Written and read
  through the registry's own HTTP API with the run's token (packages: write
  to push, read to pull), so no tool is installed. A version already there is
  left as it is when it holds the same files and refused when it holds other
  ones: a build's package is never replaced. Every file read back is held to
  the layer's sha256 here, and to the build's signed record by the caller
  (Get-MainPackageProblem).

  $Http is called as & $Http <method> <url> <headers> <in file> <out file>
  <body bytes> <content type> and returns @{ Status; Location; Text }; a
  harness hands in a stand-in registry.
#>
$script:MainPackageName = 'thornswood-launcher-main'
$script:OciEmpty = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'

function Invoke-MainPackageHttp {
  param([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$InFile = '', [string]$OutFile = '', [byte[]]$Body = $null, [string]$ContentType = '')
  $a = @{ Method = $Method; Uri = $Uri; Headers = $Headers; SkipHttpErrorCheck = $true }
  if ($InFile) { $a.InFile = $InFile }
  if ($OutFile) { $a.OutFile = $OutFile; $a.PassThru = $true }
  if ($null -ne $Body) { $a.Body = $Body }
  if ($ContentType) { $a.ContentType = $ContentType }
  $r = Invoke-WebRequest @a
  $loc = ''
  if ($r.Headers -and $r.Headers['Location']) { $loc = [string]@($r.Headers['Location'])[0] }
  $text = ''
  if (-not $OutFile -and $null -ne $r.Content) {
    # A manifest's media type is not text to PowerShell, so it comes back as bytes.
    $text = $(if ($r.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($r.Content) } else { [string]$r.Content })
  }
  return [pscustomobject]@{ Status = [int]$r.StatusCode; Location = $loc; Text = $text }
}

function Get-MainPackageRef([string]$Repo, [string]$Tag) {
  return ($Repo.Split('/')[0].ToLowerInvariant() + '/' + $script:MainPackageName + ':' + $Tag)
}

function Get-MainPackageAuth {
  param([string]$Repo, [string]$Token, [string]$Scope, [string]$Registry, [string]$Scheme, [scriptblock]$Http)
  if (-not $Repo -or -not $Token) { throw 'GITHUB_REPOSITORY and GH_TOKEN are needed to reach main''s package' }
  $owner = $Repo.Split('/')[0].ToLowerInvariant()
  $name = "$owner/$($script:MainPackageName)"
  $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${owner}:$Token"))
  $r = & $Http 'GET' "${Scheme}://$Registry/token?scope=repository:${name}:$Scope&service=$Registry" @{ Authorization = "Basic $basic" } '' '' $null ''
  if ($r.Status -ne 200) { throw "the registry gave no $Scope token for $Registry/$name (HTTP $($r.Status))" }
  $tok = [string](($r.Text | ConvertFrom-Json).token)
  if (-not $tok) { throw "the registry's answer for $Registry/$name holds no token" }
  return [pscustomobject]@{ Base = "${Scheme}://$Registry/v2/$name"; Headers = @{ Authorization = "Bearer $tok" }; Name = $name }
}

# The package's manifest for $Tag, or $null when there is none.
function Get-MainPackageManifest {
  param($Auth, [string]$Tag, [scriptblock]$Http)
  $h = @{ Accept = 'application/vnd.oci.image.manifest.v1+json' } + $Auth.Headers
  $r = & $Http 'GET' "$($Auth.Base)/manifests/$Tag" $h '' '' $null ''
  if ($r.Status -eq 404) { return $null }
  if ($r.Status -ne 200) { throw "the registry answered $($r.Status) for $($Auth.Name):$Tag" }
  return ($r.Text | ConvertFrom-Json)
}

# name -> sha256 of every layer of a manifest, each a plain file name with a
# sha256 digest. Throws on any other layer.
function Get-MainPackageLayers {
  param($Manifest, [string]$Ref)
  $have = [ordered]@{}
  foreach ($l in @($Manifest.layers)) {
    $t = $null
    if ($l.PSObject.Properties['annotations'] -and $l.annotations) { $t = $l.annotations.PSObject.Properties['org.opencontainers.image.title'] }
    $name = $(if ($t) { [string]$t.Value } else { '' })
    if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { throw "$Ref has a layer that names no plain file ('$name')" }
    if ([string]$l.digest -notmatch '^sha256:([0-9a-f]{64})$') { throw "$Ref names $name by '$($l.digest)', not a sha256" }
    if ($have.Contains($name)) { throw "$Ref holds two files named $name" }
    $have[$name] = [pscustomobject]@{ Sha256 = $Matches[1]; Size = [long]$l.size }
  }
  if (-not $have.Count) { throw "$Ref holds no files" }
  return $have
}

# Keeps every file of $Folder as main's package of $Tag, built at $Commit.
# Returns 'pushed' or 'already'; throws when the version holds other files.
function Push-MainPackage {
  param([Parameter(Mandatory = $true)][string]$Folder, [Parameter(Mandatory = $true)][string]$Tag, [Parameter(Mandatory = $true)][string]$Commit,
        [string]$Repo = $env:GITHUB_REPOSITORY, [string]$Token = $env:GH_TOKEN, [string]$Registry = 'ghcr.io', [string]$Scheme = 'https',
        [scriptblock]$Http = ${function:Invoke-MainPackageHttp})
  if ((Get-MergeReleaseOrder $Tag) -lt 0) { throw "$Tag is not a build Release tag" }
  if ($Commit -notmatch '^[0-9a-f]{40}$') { throw "'$Commit' is not a full commit" }
  $files = @(Get-ChildItem -LiteralPath $Folder -File -Recurse | Sort-Object Name)
  if (-not $files.Count) { throw "$Folder holds no files of main's package" }
  $ref = "$Registry/" + (Get-MainPackageRef $Repo $Tag)
  $want = [ordered]@{}
  foreach ($f in $files) {
    if ($want.Contains($f.Name)) { throw "$Folder holds two files named $($f.Name)" }
    $want[$f.Name] = [pscustomobject]@{ Sha256 = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); Size = [long]$f.Length; Path = $f.FullName }
  }
  $auth = Get-MainPackageAuth -Repo $Repo -Token $Token -Scope 'pull,push' -Registry $Registry -Scheme $Scheme -Http $Http
  $old = Get-MainPackageManifest -Auth $auth -Tag $Tag -Http $Http
  if ($null -ne $old) {
    $was = Get-MainPackageLayers -Manifest $old -Ref $ref
    $same = ($was.Count -eq $want.Count)
    foreach ($k in $want.Keys) { if (-not $was.Contains($k) -or $was[$k].Sha256 -ne $want[$k].Sha256) { $same = $false } }
    if ($same) { return 'already' }
    throw "$ref holds other files already; a build's package is never replaced"
  }
  $send = {
    param([string]$Sha, [string]$Path, [byte[]]$Bytes)
    $digest = "sha256:$Sha"
    $have = & $Http 'HEAD' "$($auth.Base)/blobs/$digest" $auth.Headers '' '' $null ''
    if ($have.Status -eq 200) { return }
    $start = & $Http 'POST' "$($auth.Base)/blobs/uploads/" $auth.Headers '' '' $null ''
    if ($start.Status -ne 202 -or -not $start.Location) { throw "the registry refused an upload of $digest (HTTP $($start.Status))" }
    $loc = $start.Location
    if ($loc -notmatch '^https?://') { $loc = "${Scheme}://$Registry$loc" }
    $sep = $(if ($loc.Contains('?')) { '&' } else { '?' })
    $put = & $Http 'PUT' ($loc + $sep + 'digest=' + [uri]::EscapeDataString($digest)) $auth.Headers $Path '' $Bytes 'application/octet-stream'
    if ($put.Status -ne 201) { throw "the registry did not take $digest (HTTP $($put.Status))" }
  }
  & $send $script:OciEmpty '' ([Text.Encoding]::UTF8.GetBytes('{}'))
  $layers = @()
  foreach ($k in $want.Keys) {
    & $send $want[$k].Sha256 $want[$k].Path $null
    $layers += [ordered]@{ mediaType = 'application/octet-stream'; digest = 'sha256:' + $want[$k].Sha256; size = $want[$k].Size
                           annotations = [ordered]@{ 'org.opencontainers.image.title' = $k } }
  }
  $manifest = [ordered]@{
    schemaVersion = 2
    mediaType = 'application/vnd.oci.image.manifest.v1+json'
    artifactType = 'application/vnd.thornswood.launcher-main.v1'
    config = [ordered]@{ mediaType = 'application/vnd.oci.empty.v1+json'; digest = "sha256:$($script:OciEmpty)"; size = 2 }
    layers = $layers
    annotations = [ordered]@{
      'org.opencontainers.image.source' = "https://github.com/$Repo"
      'org.opencontainers.image.revision' = $Commit
      'org.opencontainers.image.version' = $Tag
      'org.opencontainers.image.description' = "Main's launcher package of $Tag, held for the promotion to main that puts it out on the Release main-$Tag"
    }
  }
  $body = [Text.Encoding]::UTF8.GetBytes(($manifest | ConvertTo-Json -Depth 8 -Compress))
  $put = & $Http 'PUT' "$($auth.Base)/manifests/$Tag" $auth.Headers '' '' $body 'application/vnd.oci.image.manifest.v1+json'
  if ($put.Status -ne 201) { throw "the registry did not take the manifest of $ref (HTTP $($put.Status))" }
  return 'pushed'
}

# Main's package of $Tag, built at $Commit: with -Look, name -> sha256 of its
# files as its manifest names them; otherwise each file saved into $Into
# (made here, empty) and held to its layer's size and sha256, and the same
# map returned. Throws when there is none, or it names another build.
function Save-MainPackage {
  param([Parameter(Mandatory = $true)][string]$Tag, [Parameter(Mandatory = $true)][string]$Commit, [string]$Into = '', [switch]$Look,
        [string]$Repo = $env:GITHUB_REPOSITORY, [string]$Token = $env:GH_TOKEN, [string]$Registry = 'ghcr.io', [string]$Scheme = 'https',
        [scriptblock]$Http = ${function:Invoke-MainPackageHttp})
  $ref = "$Registry/" + (Get-MainPackageRef $Repo $Tag)
  $auth = Get-MainPackageAuth -Repo $Repo -Token $Token -Scope 'pull' -Registry $Registry -Scheme $Scheme -Http $Http
  $m = Get-MainPackageManifest -Auth $auth -Tag $Tag -Http $Http
  if ($null -eq $m) { throw "there is no package ${ref}: main's packages are kept there since 8 Nov 2026 (before, as an artifact), so promote a newer build" }
  $ann = $m.PSObject.Properties['annotations']
  $rev = $(if ($ann -and $ann.Value) { $ann.Value.PSObject.Properties['org.opencontainers.image.revision'] } else { $null })
  if (-not $rev -or [string]$rev.Value -ne $Commit) { throw "$ref names another commit than $Commit, the one that built $Tag" }
  $layers = Get-MainPackageLayers -Manifest $m -Ref $ref
  $map = @{}
  foreach ($k in $layers.Keys) { $map[$k] = $layers[$k].Sha256 }
  if ($Look) { return $map }
  if (-not $Into) { throw 'Save-MainPackage needs -Into or -Look' }
  if ((Test-Path -LiteralPath $Into) -and @(Get-ChildItem -LiteralPath $Into -Force).Count) { throw "$Into is not empty" }
  New-Item -ItemType Directory -Force -Path $Into | Out-Null
  foreach ($k in $layers.Keys) {
    $file = Join-Path $Into $k
    $r = & $Http 'GET' "$($auth.Base)/blobs/sha256:$($layers[$k].Sha256)" $auth.Headers '' $file $null ''
    if ($r.Status -ne 200) { throw "the registry answered $($r.Status) for $k in $ref" }
    $sha = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ((Get-Item -LiteralPath $file).Length -ne $layers[$k].Size -or $sha -ne $layers[$k].Sha256) { throw "$k fetched from $ref is not the file its manifest names" }
  }
  return $map
}
