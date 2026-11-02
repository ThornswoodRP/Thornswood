<#
  test-ship-revision-gate.ps1

      pwsh -NoProfile -File .\tests\test-ship-revision-gate.ps1

  Ship's collection revision gate in scripts\release\Ship-Rules.ps1:
    Get-ShipCollectionRevision  which revision this machine's Vortex has, for
                                the collection config.json names
    Test-ShipHeld               a loose file that waits until the collection
                                carries it (held below its revision)
    Test-ShipNotOurs            somebody else's file, never shipped
  Get-CollectionRevision and Get-CollectionSlug are stubbed, so no Vortex
  state is read. Scratch folders only; no network.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
. (Join-Path $Repo 'scripts\release\Ship-Rules.ps1')

# ---- Get-ShipCollectionRevision ------------------------------------------------
Yes 'with no Get-CollectionRevision loaded the revision is 0' ((Get-ShipCollectionRevision 'C:\nowhere') -eq 0)

$script:slugAsked = @()
$script:revFor = @{ '7essxf' = 2; 'abc123' = '3' }
function Get-CollectionSlug([string]$Url) { $m = [regex]::Match($Url, '/collections/([A-Za-z0-9]+)'); if ($m.Success) { return $m.Groups[1].Value }; return '' }
function Get-CollectionRevision([string]$Slug) { $script:slugAsked += $Slug; if ($script:revFor.ContainsKey($Slug)) { return $script:revFor[$Slug] }; return 0 }

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-gate-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '\[Thornswood] & main')
[void][IO.Directory]::CreateDirectory($T)
function Cfg([string]$text, [bool]$bom = $false) { [IO.File]::WriteAllText((Join-Path $T 'config.json'), $text, (New-Object Text.UTF8Encoding($bom))) }
try {
    $r = Get-ShipCollectionRevision $T
    Yes "no config.json falls back to the shipped collection (7essxf), revision $r" ($r -eq 2 -and $script:slugAsked[-1] -eq '7essxf')
    Cfg '{"CollectionUrl":"https://www.nexusmods.com/games/skyrimspecialedition/collections/abc123"}'
    $r = Get-ShipCollectionRevision $T
    Yes "the collection config.json names is asked for, in a [ ] & folder (abc123, revision $r)" ($r -eq 3 -and $script:slugAsked[-1] -eq 'abc123')
    Yes '  and a revision read as text comes back as a number' ($r -is [int])
    Cfg '{"CollectionUrl":"https://www.nexusmods.com/games/skyrimspecialedition/collections/abc123"}' $true
    Yes 'a config.json with a byte order mark is read the same' ((Get-ShipCollectionRevision $T) -eq 3)
    Cfg '{"CollectionUrl":""}'
    Yes 'an empty CollectionUrl falls back to the shipped collection' ((Get-ShipCollectionRevision $T) -eq 2 -and $script:slugAsked[-1] -eq '7essxf')
    Cfg '{ not json'
    $stop = ''
    try { $null = Get-ShipCollectionRevision $T } catch { $stop = $_.Exception.Message }
    Yes 'a config.json that is not JSON stops Ship before anything is packed (#2711 decision 2 B)' ($stop -match 'does not read' -and $stop -match 'collection revision it names is not known')
    Cfg '{"CollectionUrl":"https://www.nexusmods.com/games/skyrimspecialedition/collections/zzz999"}'
    Yes 'a collection Vortex does not have is revision 0' ((Get-ShipCollectionRevision $T) -eq 0)
}
finally { Remove-Item -LiteralPath (Split-Path -Parent $T) -Recurse -Force -ErrorAction SilentlyContinue }

# ---- Test-ShipHeld ---------------------------------------------------------------
# The lines a collection revision settles. The one the content plugin settles
# (-WhileContentNamesIt) is tests\test-2298-held-board.ps1's.
$byRevision = @($ShipHeldForCollection | Where-Object { -not [string]$_.ContentModel })
$folder = @($byRevision | Where-Object { ([string]$_.Path).EndsWith('\') })[0]
$file = @($byRevision | Where-Object { -not ([string]$_.Path).EndsWith('\') })[0]
Yes ("the held list has folders and files ({0} entries)" -f $ShipHeldForCollection.Count) ($folder -and $file)
Yes 'every held entry names its mod and exactly one way out: a revision, or the content plugin naming it' (@($ShipHeldForCollection | Where-Object {
    -not $_.Mod -or (([int]$_.Revision -ge 1) -eq [bool][string]$_.ContentModel) }).Count -eq 0)
$inFolder = [string]$folder.Path + 'sub\x.nif'
$hr = [int]$folder.Revision
Yes "a file under a held folder is held below revision $hr" (Test-ShipHeld $inFolder ($hr - 1))
Yes '  and not at it' (-not (Test-ShipHeld $inFolder $hr))
Yes '  nor above it' (-not (Test-ShipHeld $inFolder ($hr + 1)))
Yes '  whatever the case of the path' (Test-ShipHeld $inFolder.ToUpperInvariant() ($hr - 1))
Yes 'the held folder''s name alone, with no file under it, is not held' (-not (Test-ShipHeld ([string]$folder.Path).TrimEnd('\') 0))
Yes 'a sibling folder that starts with the same letters is not held' (-not (Test-ShipHeld (([string]$folder.Path).TrimEnd('\') + 'x\a.nif') 0))
Yes 'a held file is held by its exact path, any case' ((Test-ShipHeld ([string]$file.Path) 0) -and (Test-ShipHeld ([string]$file.Path).ToLowerInvariant() 0))
Yes '  and a file beside it is not' (-not (Test-ShipHeld ([string]$file.Path + '.bak') 0))
$fwd = $inFolder.Replace('\', '/')
Yes "a forward-slash path under a held folder is held below its revision ($fwd)" (Test-ShipHeld $fwd ($hr - 1))
Yes '  and not at it' (-not (Test-ShipHeld $fwd $hr))
Yes '  mixed slashes and any case too' (Test-ShipHeld ($inFolder.Substring(0, 5) + $fwd.Substring(5).ToUpperInvariant()) ($hr - 1))
Yes 'a held file with forward slashes is held by its exact path' (Test-ShipHeld ([string]$file.Path).Replace('\', '/') 0)
Yes '  and a forward-slash sibling folder is still not held' (-not (Test-ShipHeld ((([string]$folder.Path).TrimEnd('\') + 'x/a.nif').Replace('\', '/')) 0))
Yes 'a forward-slash held path still ships below its revision (not "not ours")' (-not (Test-ShipNotOurs $fwd ($hr - 1)))
$was = $ShipCollectionRevision
$ShipCollectionRevision = 0
Yes 'with no revision passed it uses $ShipCollectionRevision (0: held)' (Test-ShipHeld $inFolder)
$ShipCollectionRevision = $hr
Yes '  (at the revision: not held)' (-not (Test-ShipHeld $inFolder))
$ShipCollectionRevision = $was

# ---- Test-ShipNotOurs --------------------------------------------------------------
Yes 'a held file is not "not ours" below its revision: it still ships' (-not (Test-ShipNotOurs $inFolder ($hr - 1)))
Yes '  and is somebody else''s from that revision on' (Test-ShipNotOurs $inFolder $hr)
Yes 'a stranger''s loose file is not ours at any revision' ((Test-ShipNotOurs 'Data\meshes\nobody\thing.nif' 0) -and (Test-ShipNotOurs 'Data\meshes\nobody\thing.nif' 99))
Yes 'anything under Data\Platform is left to the other rules (never "not ours" here)' (-not (Test-ShipNotOurs 'Data\Platform\UI\x.js' 99))
if ($ShipOursFiles.Count) { Yes ("a listed file of ours is ours at every revision ({0})" -f $ShipOursFiles[0]) (-not (Test-ShipNotOurs ([string]$ShipOursFiles[0]) 99)) }
# The first one not held for its permission (#2454): a held file is never ours.
$unheld = @($ShipBuiltUntil1259 | Where-Object { -not (Test-ShipPermissionHeld $_) })
if ($unheld.Count) { $b = $unheld[0]; Yes "a #1259 outfit is ours until that list goes ($b)" (-not (Test-ShipNotOurs $b 99)) }
if ($ShipRequiredDataFiles.Count) { Yes ("required data is ours ({0})" -f $ShipRequiredDataFiles[0]) (-not (Test-ShipNotOurs ([string]$ShipRequiredDataFiles[0]) 99)) }

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }