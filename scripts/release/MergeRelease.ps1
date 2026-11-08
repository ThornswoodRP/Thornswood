<#
  MergeRelease.ps1

  What .github/workflows/merge-release.yml works out between steps (#5179):
  the release's names, the newest Release before it, and which parts the
  merge changed. Dot-sourced; defines functions and nothing else. ASCII, and
  PowerShell 7. tests\test-5179-merge-release.ps1 drives every function.

      . ./scripts/release/MergeRelease.ps1
      New-MergeReleaseNames -Utc <DateTime> [-Taken <tags>]
          @{ Tag = 'build-20261101.7'; Velopack = '2026.1101.7' }
      Resolve-MergeReleaseSince -Commit <sha> -Subject <scriptblock> [-RepoDir .]
          where this history's notes start: the Release before's commit, or
          the same merge in this history when the history was rewritten
      Get-MergeReleasePrevious [-Repo owner/name]
          the newest published build-* Release and its manifest, or $null
      Get-MergeReleasePrint -Manifest <obj> -Part <name>
          one line that changes exactly when the part's content does
      Get-MergeReleaseChanged -Manifest <obj> [-Previous <obj>]
          the parts whose print differs from the Release before
      Test-MergeReleaseVelopack -LauncherVersion <a.b.c> -GameZipSha256 <hex>
                                [-Previous <obj>]
          whether this merge makes a Velopack package, and so builds the
          launcher with the release's Velopack version
      Find-MainPackage -Tag <tag> -Manifest <obj> [-Repo owner/name]
          the main package a promotion of <tag> puts out, and whether its
          Release main-<tag> is out already (promote-main.yml)
      Get-MainPackageProblem -Record <obj> -Have <name to sha256>
          '' when the files are exactly the record's main package
      Select-MainPackageArtifact -Artifacts <list> -Name main-<tag> -Commit <sha>
          the artifact merge-release.yml kept main's package in

  THE NAMES. The day and a number give both: the tag the agent applies,
  build-<yyyyMMdd>.<n>, and the Velopack version, which must be SemVer and
  must grow with every release: <yyyy>.<M*100+d>.<n> (no leading zero, so
  2 Jan is 102). n is one more than the highest the day's tags and Releases
  (drafts too) already use, so a name is never taken twice. It was the run
  number until 1 Nov, when renaming the workflow started its runs at 1 again
  and the first run asked for build-20261101.1, a tag the gamemode workflow
  had made that morning. Runs never overlap (one concurrency group), and a
  later day or a higher n is always the higher version.

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

function New-MergeReleaseNames {
  param([Parameter(Mandatory = $true)][DateTime]$Utc, [string[]]$Taken = @())
  $u = $Utc.ToUniversalTime()
  $day = $u.ToString('yyyyMMdd')
  $n = 0
  foreach ($t in @($Taken)) {
    if ([string]$t -match ('^build-' + $day + '\.(\d{1,9})$')) { $n = [Math]::Max($n, [int]$Matches[1]) }
  }
  $n++
  return [pscustomobject]@{
    Tag      = ('build-{0}.{1}' -f $day, $n)
    Velopack = ('{0}.{1}.{2}' -f $u.Year, ($u.Month * 100 + $u.Day), $n)
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

# The newest published build-* Release, by GitHub's own order (newest first),
# with its manifest.json read from its assets. Drafts are skipped: a run that
# stopped part way leaves one, and it was never applied. $null when there is
# none yet. Throws when GitHub cannot be read, so a failed read is never taken
# for "no Release before".
function Get-MergeReleasePrevious {
  param([string]$Repo = $env:GITHUB_REPOSITORY, [string]$ReleasesFile = '', [string]$ManifestDir = '')
  if ($ReleasesFile) { $rels = Get-Content -LiteralPath $ReleasesFile -Raw | ConvertFrom-Json }
  else {
    $raw = gh api "repos/$Repo/releases?per_page=50"
    if ($LASTEXITCODE -ne 0) { throw "GitHub did not list the Releases of $Repo (gh exit $LASTEXITCODE)" }
    $rels = ($raw -join "`n") | ConvertFrom-Json
  }
  foreach ($r in @($rels)) {
    if ($r.draft -or [string]$r.tag_name -notmatch '^build-') { continue }
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

# A build Release tag's place in time, build-<yyyyMMdd>.<n>, or -1.
function Get-MergeReleaseOrder {
  param([string]$Tag)
  if ($Tag -notmatch '^build-(\d{8})\.(\d{1,9})$') { return [long]-1 }
  return ([long]$Matches[1] * 1000000000 + [long]$Matches[2])
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
  if ($ReleasesFile) { $rels = @(Get-Content -LiteralPath $ReleasesFile -Raw | ConvertFrom-Json) }
  else {
    $raw = gh api "repos/$Repo/releases?per_page=100"
    if ($LASTEXITCODE -ne 0) { throw "GitHub did not list the Releases of $Repo (gh exit $LASTEXITCODE)" }
    $rels = @(($raw -join "`n") | ConvertFrom-Json)
  }
  $at = Get-MergeReleaseOrder $Tag
  if ($at -lt 0) { throw "$Tag is not a build Release tag" }
  if (-not @($rels | Where-Object { [string]$_.tag_name -eq $Tag -and -not $_.draft }).Count) { throw "$Tag is not among the hundred newest published Releases" }
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
# is not out on its Release main-<tag> already, and there is no tag
# main-<tag> for the promotion to put that Release on (merge-release.yml,
# Tag main's package for the approval; a run's own token cannot make that
# tag later, #5489). True when it can, or when no Release up to $Tag made
# one. Throws when GitHub cannot be read, so a failed read never makes a
# package nobody asked for.
function Test-MainPackageReachable {
  param([Parameter(Mandatory = $true)][string]$Tag, [Parameter(Mandatory = $true)]$Manifest,
        [string]$Repo = $env:GITHUB_REPOSITORY, [string]$ReleasesFile = '', [string]$ManifestDir = '',
        [scriptblock]$TagCommit = $null)
  $pkg = Find-MainPackage -Tag $Tag -Manifest $Manifest -Repo $Repo -ReleasesFile $ReleasesFile -ManifestDir $ManifestDir
  if ($null -eq $pkg -or $pkg.Published) { return $true }
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

# The artifact main-<tag> merge-release.yml kept for $Commit on main: the one
# that has not expired, from a run on main at that commit. Throws when there
# is none, or more than one.
function Select-MainPackageArtifact {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()]$Artifacts, [Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][string]$Commit)
  $hit = @(@($Artifacts) | Where-Object { [string]$_.name -eq $Name -and -not $_.expired -and [string]$_.workflow_run.head_branch -eq 'main' -and [string]$_.workflow_run.head_sha -eq $Commit })
  if ($hit.Count -eq 1) { return $hit[0] }
  if ($hit.Count -gt 1) { throw "$($hit.Count) artifacts named $Name were kept for $Commit, not one" }
  if (@(@($Artifacts) | Where-Object { [string]$_.name -eq $Name -and $_.expired }).Count) { throw "$Name has expired (GitHub keeps an artifact 90 days), so main's package of that build can no longer go out; promote a newer build" }
  throw "no artifact $Name was kept for $Commit on main"
}
