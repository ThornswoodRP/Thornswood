<#
  test-6244-collection-modlist.ps1

      pwsh -NoProfile -File .\tests\test-6244-collection-modlist.ps1

  records\collection-modlist.wabbajack, the published revision as the
  Wabbajack modlist the launcher installs from (#6244), and how it gets into
  every Release.

  WHY. The launcher will install the mods from this modlist instead of from
  Vortex, and takes it only from a Release whose signed record names its
  sha256. So the modlist a Release carries has to be the revision its
  servers run, which is the one records\collection-plugins.json names (the
  merge release writes that number as collectionRevision), and Mod
  Organizer 2 in it has to be the one records\mo2.json pins. A rebuild that
  moved collection-plugins.json and left the modlist behind would hand out
  the old mods with the new revision's number.

  WHAT IT HOLDS:
    M  the committed modlist reads: a zip holding the modlist JSON, game
       Skyrim Special Edition, its version the revision collection-plugins.json
       names, its description the collection; one Nexus archive for each mod,
       each with its mod and file id, and Mod Organizer 2 as records\mo2.json
       pins it (address, name, size); every inline file it names is in the
       zip; and its profile's plugins.txt names every plugin
       collection-plugins.json has but the game's own;
    R  .github\workflows\merge-release.yml adds it as the part "modlist", and
       New-SignedManifest.ps1 takes that part, so its sha256 is in the
       signed record;
    P  Publish-CollectionRecord.ps1 lays a draft out with -Modlist and puts
       the modlist in the records that follow a publish, and
       docs\COLLECTION-REVISIONS.md names it among them.

  Reads the repository only; writes nothing.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$detail = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red; if ($detail) { Write-Host "      $detail" } }
}
function P([string]$rel) { return (Join-Path $Repo $rel) }
Add-Type -AssemblyName System.IO.Compression.FileSystem

# ---------------------------------------------------------------- M ----
$wjPath = P 'records/collection-modlist.wabbajack'
Yes 'M0 records/collection-modlist.wabbajack is there' (Test-Path -LiteralPath $wjPath -PathType Leaf)
$entries = @{}
if (Test-Path -LiteralPath $wjPath -PathType Leaf) {
    $za = [IO.Compression.ZipFile]::OpenRead($wjPath)
    try {
        foreach ($z in $za.Entries) {
            $ms = New-Object IO.MemoryStream
            $st = $z.Open()
            try { $st.CopyTo($ms) } finally { $st.Dispose() }
            $entries[$z.FullName] = $ms.ToArray()
        }
    } finally { $za.Dispose() }
}
$utf8 = New-Object Text.UTF8Encoding($false)
$wj = $null
if ($entries.ContainsKey('modlist')) { $wj = $utf8.GetString($entries['modlist']) | ConvertFrom-Json }
Yes 'M1 it is a zip holding the modlist JSON, for Skyrim Special Edition' ($null -ne $wj -and [string]$wj.GameType -eq 'SkyrimSpecialEdition')
$cp = Get-Content -Raw -LiteralPath (P 'records/collection-plugins.json') | ConvertFrom-Json
$mo2 = Get-Content -Raw -LiteralPath (P 'records/mo2.json') | ConvertFrom-Json
if ($null -ne $wj) {
    Yes ("M2 its version is revision $($cp.revision), the one collection-plugins.json names, and its description names collection $($cp.collection)") ([string]$wj.Version -eq ([string]$cp.revision + '.0.0.0') -and ([string]$wj.Description).Contains('collection ' + [string]$cp.collection + ', revision ' + [string]$cp.revision + ',')) ("version $($wj.Version), description: $($wj.Description)")
    $nexus = @(@($wj.Archives) | Where-Object { $_.State.'$type' -eq 'NexusDownloader, Wabbajack.Lib' })
    $http = @(@($wj.Archives) | Where-Object { $_.State.'$type' -eq 'HttpDownloader, Wabbajack.Lib' })
    $mods = @(@($wj.Archives) | Where-Object { $_.State.'$type' -eq 'NexusDownloader, Wabbajack.Lib' -and [long]$_.State.ModID -gt 0 -and [long]$_.State.FileID -gt 0 -and [string]$_.State.GameName -eq 'SkyrimSpecialEdition' })
    Yes ("M3 every archive but MO2 is a Nexus file with its mod and file id ($($nexus.Count) of them)") ($nexus.Count -gt 0 -and $mods.Count -eq $nexus.Count -and $nexus.Count + $http.Count -eq @($wj.Archives).Count)
    Yes 'M4 Mod Organizer 2 is the one records/mo2.json pins: its address, name and size' ($http.Count -eq 1 -and [string]$http[0].State.Url -eq [string]$mo2.url -and [string]$http[0].Name -eq [string]$mo2.name -and [long]$http[0].Size -eq [long]$mo2.size) ($(if ($http.Count) { "$($http[0].State.Url), $($http[0].Name), $($http[0].Size)" }))
    $ids = @(@($wj.Directives) | ForEach-Object { foreach ($k in 'SourceDataID', 'PatchID') { if ($_.PSObject.Properties[$k]) { [string]$_.$k } } })
    $missing = @($ids | Where-Object { -not $entries.ContainsKey($_) })
    Yes ("M5 every inline file and patch it names is in the zip ($($ids.Count))") ($ids.Count -gt 0 -and $missing.Count -eq 0) ($missing -join ', ')
    $pl = @(@($wj.Directives) | Where-Object { [string]$_.To -eq 'profiles\Thornswood\plugins.txt' })
    $names = @()
    if ($pl.Count -eq 1 -and $entries.ContainsKey([string]$pl[0].SourceDataID)) {
        $names = @($utf8.GetString($entries[[string]$pl[0].SourceDataID]) -split "`r?`n" | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object { $_.TrimStart('*').ToLowerInvariant() })
    }
    # The game's own plugins (records\skyrim-files.json) are not in an MO2
    # profile's plugins.txt: MO2 loads them first by itself.
    $game = @{}
    foreach ($f in @((Get-Content -Raw -LiteralPath (P 'records/skyrim-files.json') | ConvertFrom-Json).files.PSObject.Properties.Name)) { if ($f -match '^(?i)Data\\([^\\]+\.es[mlp])$') { $game[$Matches[1].ToLowerInvariant()] = $true } }
    $lack = @(@($cp.plugins) | ForEach-Object { [string]$_.name } | Where-Object { -not $game.ContainsKey($_.ToLowerInvariant()) -and $names -notcontains $_.ToLowerInvariant() })
    Yes 'M6 its profile''s plugins.txt names every plugin collection-plugins.json has but the game''s own' ($names.Count -gt 0 -and $game.Count -gt 0 -and $lack.Count -eq 0) ($lack -join ', ')
}

# ---------------------------------------------------------------- R ----
$wf = [IO.File]::ReadAllText((P '.github/workflows/merge-release.yml'))
Yes 'R1 merge-release.yml adds it as the part modlist' ($wf.Contains("`$adds += @('modlist=' + (Resolve-Path 'records\collection-modlist.wabbajack').Path)"))
$nsm = [IO.File]::ReadAllText((P 'scripts/release/New-SignedManifest.ps1'))
Yes 'R2 New-SignedManifest.ps1 takes the part modlist into the signed record' ($nsm -match "\`$addParts = @\([^)]*'modlist'[^)]*\)")

# ---------------------------------------------------------------- P ----
$pub = [IO.File]::ReadAllText((P 'scripts/release/Publish-CollectionRecord.ps1'))
Yes 'P1 Publish-CollectionRecord.ps1 lays the draft out with -Modlist' ($pub.Contains('KeepPlugins = $true; Modlist = $true'))
Yes 'P2 and puts the modlist in the records that follow a publish' ($pub.Contains("Copy-Item -LiteralPath (Join-Path `$lay 'thornswood.wabbajack') -Destination (Join-Path `$Out 'collection-modlist.wabbajack')"))
$doc = [IO.File]::ReadAllText((P 'docs/COLLECTION-REVISIONS.md'))
Yes 'P3 docs/COLLECTION-REVISIONS.md names it among those records' ($doc.Contains('`collection-modlist.wabbajack`'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
