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
  velopack part is made from the launcher and the game files, so it is never
  compared on its own.
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
    if ($p.Name -eq 'velopack') { continue }
    if ($null -eq $Previous -or (Get-MergeReleasePrint $Manifest $p.Name) -ne (Get-MergeReleasePrint $Previous $p.Name)) { $changed.Add($p.Name) }
  }
  # Unrolled: callers take it as @(...), which gives an empty array for none.
  return $changed.ToArray()
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
