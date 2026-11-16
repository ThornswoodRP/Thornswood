<#
  ReleaseRevision.ps1

      . (Join-Path $PSScriptRoot 'ReleaseRevision.ps1')
      $r = Get-ChannelReleaseRevision -Channel main    # { Tag; Revision }

  The collection revision a channel's servers run: the one in the signed
  manifest of the Release that channel is on (#5767). Dev is on the newest
  published build-1.3.<n> Release; main on the build its newest published
  main-build-1.3.<n> Release was promoted from. New-SignedManifest.ps1 writes
  collectionRevision from the commit's records\collection-plugins.json, and
  the launcher (VeloUpdate.cs) and the site (feed.js serverRevision) read the
  same number from the same Release.

  Asked through GitHub's REST API, signed in with GH_TOKEN (or GITHUB_TOKEN,
  or gh's own sign in) when there is one. Throws with the reason when the
  Release or its manifest cannot be read, and for a manifest from before the
  field, which names no revision.
#>

function Invoke-ReleaseRevisionApi([string]$Repo, [string]$Path, [string]$Accept = 'application/vnd.github+json') {
    $h = @{ 'User-Agent' = 'thornswood-release-revision'; Accept = $Accept; 'X-GitHub-Api-Version' = '2022-11-28' }
    $token = [string]$env:GH_TOKEN
    if (-not $token) { $token = [string]$env:GITHUB_TOKEN }
    if (-not $token -and (Get-Command gh -ErrorAction SilentlyContinue)) { $token = [string](& gh auth token 2>$null) }
    if ($token) { $h['Authorization'] = 'Bearer ' + $token.Trim() }
    return Invoke-RestMethod -Uri ("https://api.github.com/repos/$Repo/" + $Path) -Headers $h
}

function Get-ChannelReleaseRevision([ValidateSet('main', 'dev')][string]$Channel, [string]$Repo = 'ThornswoodRP/Thornswood') {
    $rx = if ($Channel -eq 'main') { '^main-build-1\.3\.\d+$' } else { '^build-1\.3\.\d+$' }
    $on = $null
    for ($page = 1; $page -le 5 -and -not $on; $page++) {
        # Through the pipeline: PowerShell 7's Invoke-RestMethod hands a JSON array back whole.
        $list = @(Invoke-ReleaseRevisionApi $Repo ("releases?per_page=100&page=$page") | ForEach-Object { $_ })
        $on = $list | Where-Object { -not $_.draft -and [string]$_.tag_name -match $rx } |
            Sort-Object { [DateTimeOffset]::Parse([string]$_.published_at, [Globalization.CultureInfo]::InvariantCulture) } -Descending |
            Select-Object -First 1
        if ($list.Count -lt 100) { break }
    }
    if (-not $on) { throw "no published $Channel Release was found" }
    $tag = ([string]$on.tag_name) -replace '^main-', ''
    $rel = Invoke-ReleaseRevisionApi $Repo ('releases/tags/' + $tag)
    $asset = @($rel.assets | Where-Object { $_.name -eq 'manifest.json' -and $_.state -eq 'uploaded' })[0]
    if (-not $asset) { throw "$tag has no manifest.json" }
    $m = Invoke-ReleaseRevisionApi $Repo ('releases/assets/' + $asset.id) 'application/octet-stream'
    if ($m -is [string]) { $m = $m | ConvertFrom-Json }
    if ([string]$m.tag -ne $tag) { throw "the manifest.json of $tag names another Release" }
    $n = 0
    if (-not $m.PSObject.Properties['collectionRevision'] -or -not [int]::TryParse([string]$m.collectionRevision, [ref]$n) -or $n -lt 1) {
        throw "the manifest of $tag names no collection revision (a Release from before #5767)"
    }
    return [pscustomobject]@{ Tag = $tag; Revision = $n }
}
