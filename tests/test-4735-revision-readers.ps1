<#
  test-4735-revision-readers.ps1

      pwsh -NoProfile -File .\tests\test-4735-revision-readers.ps1

  Issue #4735. The collection revision readers in scripts\mods\LoadOrder.ps1
  guessed or gave 0 when they could not read:

    1. Get-CollectionRevision fell back to the legacy collection_<slug>_<rev>_
       folder name, or 0, when Vortex's state.v2 was there but could not be
       read (Vortex open, or a table whose checksum does not match), so Ship
       and Publish-Update were handed a number nobody read.
    2. Get-CollectionState took the newest revision from Vortex's own record
       only, so a machine whose Vortex had never heard of revision 5 passed
       Deploy-Gamemode's behind check while Nexus was on 5.
    3. Get-CollectionInstalledFolder looked only under Vortex's default
       staging folder, %APPDATA%\Vortex\skyrimse\mods, so a staging folder
       moved in Vortex's settings read as "not installed" and
       Check-CollectionRules said SKIP.

  What this holds, one part per part of the issue's Done when:
    A. state.v2 that is a database but does not read: Get-CollectionRevision
       throws, naming state.v2, and never answers the legacy folder's number;
       Get-CollectionNewest and Get-CollectionModIds throw too;
       Get-CollectionState is not Known and says why. A machine with no
       database at all still reads the legacy folder, the one case it is for.
    B. Get-CollectionState checks the newest against Nexus: installed 2, Vortex
       knowing only 2, Nexus on 5 is Behind; Nexus not answering is not Known
       and says so.
    C. A staging folder Vortex was moved to is found from Vortex's own record
       of it (the stagingPath in Data\vortex.deployment.json of the folder the
       install's made.txt names), and a made.txt whose record cannot be read
       stops rather than falling back to the default folder.

  Read only apart from its own temp folder. No Nexus: the newest is passed in,
  or asked of an address nothing listens on.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
. (Join-Path (Join-Path (Join-Path $Repo 'scripts') 'mods') 'LoadOrder.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
# What a call threw, or '' when it did not.
function Thrown([scriptblock]$b) {
    try { $null = & $b; return '' } catch { return [string]$_.Exception.Message }
}

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4735-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$cases = Join-Path $T 'cases'
$null = New-Item -ItemType Directory -Force -Path $cases
$saved = @{ APPDATA = $env:APPDATA; STANDIN = $env:THORNSWOOD_NEXUS_STANDIN }
$z = 'vortex_collection_ZRT7NjhN_'
$url = 'https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf'
function Row([string]$key, $json) { [pscustomobject]@{ key = $key; value = $json } }
function Attr([string]$modId, [string]$name, $valueJson) { Row "persistent###mods###skyrimse###$modId###attributes###$name" $valueJson }
function At([string]$case) { $env:APPDATA = Join-Path $cases $case }

try {
    # Two LevelDB folders, written by the same writer the reader's own
    # harnesses use: revision 2 installed with Vortex knowing nothing newer,
    # and the same state with its table's checksum broken.
    $spec = [ordered]@{
        'installed-2' = [ordered]@{ table = @((Attr $z 'collectionSlug' '"7essxf"'), (Attr $z 'revisionNumber' '2'), (Attr $z 'newestVersion' '"2"')); log = @() }
        'unreadable'  = [ordered]@{ table = @((Attr $z 'collectionSlug' '"7essxf"'), (Attr $z 'revisionNumber' '2'), (Attr $z 'newestVersion' '"2"')); log = @() }
    }
    $specPath = Join-Path $T 'cases.json'
    [IO.File]::WriteAllText($specPath, (ConvertTo-Json -InputObject $spec -Depth 6), (New-Object Text.UTF8Encoding($false)))
    & python (Join-Path (Join-Path $Here 'fixtures') 'vortex-state-rows.py') $cases $specPath
    if ($LASTEXITCODE) { throw 'tests\fixtures\vortex-state-rows.py could not write the cases' }
    $table = Join-Path (Join-Path (Join-Path (Join-Path $cases 'unreadable') 'Vortex') 'state.v2') '000001.ldb'
    $bytes = [IO.File]::ReadAllBytes($table); $bytes[0] = $bytes[0] -bxor 1
    [IO.File]::WriteAllBytes($table, $bytes)
    # A legacy folder beside the unreadable state: the guess the old reader made.
    $null = New-Item -ItemType Directory -Force -Path (Join-Path (Join-Path (Join-Path (Join-Path (Join-Path $cases 'unreadable') 'Vortex') 'skyrimse') 'mods') 'collection_7essxf_4_2026-09-20T10-00-00Z')

    # ---- A. an unreadable revision stops and says why ------------------------------
    Write-Host 'A. an unreadable revision'
    At 'unreadable'
    $why = Thrown { Get-CollectionRevision '7essxf' }
    Yes 'state.v2 that does not read throws, never the legacy folder''s 4 or 0' ($why -ne '')
    Yes '  naming state.v2 and saying to close Vortex' ($why -match 'state\.v2' -and $why -match 'Close Vortex')
    Yes 'the newest Vortex knows of throws too' ((Thrown { Get-CollectionNewest '7essxf' }) -match 'state\.v2')
    Yes 'and so do the mod ids that find its folder' ((Thrown { Get-CollectionModIds '7essxf' }) -match 'state\.v2')
    $cs = $null; $csWhy = Thrown { $script:cs = Get-CollectionState $url -Published 2 }
    Yes 'Get-CollectionState does not throw' ($csWhy -eq '')
    Yes '  and is not Known, saying why' ($script:cs -and -not $script:cs.Known -and ([string]$script:cs.Why) -match 'state\.v2')
    # With no database at all, the legacy folder is the only record there is.
    $env:APPDATA = Join-Path $T 'legacy'
    $null = New-Item -ItemType Directory -Force -Path (Join-Path (Join-Path (Join-Path (Join-Path $env:APPDATA 'Vortex') 'skyrimse') 'mods') 'collection_7essxf_3_2026-09-20T10-00-00Z')
    Yes 'with no Vortex database at all, the legacy folder name is still read' ((Get-CollectionRevision '7essxf') -eq 3)

    # ---- B. the newest is checked against Nexus ------------------------------------
    Write-Host ''; Write-Host 'B. the newest revision'
    At 'installed-2'
    $script:cs = $null; $csWhy = Thrown { $script:cs = Get-CollectionState $url -Published 5 }
    Yes 'Vortex knowing only 2 and Nexus on 5: Newest is 5' ($csWhy -eq '' -and $script:cs.Newest -eq 5 -and $script:cs.Have -eq 2)
    Yes '  so it is Known and Behind' ($script:cs.Known -and $script:cs.Behind)
    $script:cs = $null; $csWhy = Thrown { $script:cs = Get-CollectionState $url -Published 2 }
    Yes 'on the newest published revision it is Known and not Behind' ($csWhy -eq '' -and $script:cs.Known -and -not $script:cs.Behind)
    # Asked of Nexus itself: an address nothing listens on stands in for a Nexus
    # that does not answer.
    $env:THORNSWOOD_NEXUS_STANDIN = 'http://127.0.0.1:9'
    $script:cs = $null; $csWhy = Thrown { $script:cs = Get-CollectionState $url }
    Yes 'with no number given it asks Nexus, and a Nexus that does not answer is not Known' ($csWhy -eq '' -and $script:cs -and -not $script:cs.Known -and -not $script:cs.Behind)
    Yes '  and says Nexus did not answer' (([string]$script:cs.Why) -match 'Nexus')
    $env:THORNSWOOD_NEXUS_STANDIN = $saved.STANDIN
    $src = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $Repo 'scripts') 'deploy') 'Deploy-Gamemode.ps1'))
    Yes 'Deploy-Gamemode says the newest is Nexus''s, not Vortex''s' ($src -notmatch 'newest Vortex knows of' -and $src -match 'newest published on Nexus')
    Yes '  and prints why the revision could not be read' ($src -match '\$cs\.Why')

    # ---- C. a moved staging folder is found ----------------------------------------
    Write-Host ''; Write-Host 'C. a moved staging folder'
    At 'installed-2'
    $root = Join-Path $T 'Thornswood'
    $vortexGame = Join-Path (Join-Path (Join-Path (Join-Path $T 'Steam') 'steamapps') 'common') 'Skyrim Special Edition'
    $moved = Join-Path (Join-Path (Join-Path $T 'D-drive') 'Vortex Mods') 'skyrimse'
    $own = Join-Path (Join-Path $root 'Profile') 'OwnGame'
    $null = New-Item -ItemType Directory -Force -Path $own, (Join-Path $vortexGame 'Data'), (Join-Path $moved $z)
    [IO.File]::WriteAllText((Join-Path (Join-Path $moved $z) 'collection.json'), '{}')
    [IO.File]::WriteAllText((Join-Path $own 'made.txt'), "source=$vortexGame`r`ngame=$vortexGame`r`nrules=13`r`nkinds=1`r`n")
    $record = [ordered]@{ instance = 'x'; version = 1; deploymentMethod = 'hardlink_activator'; stagingPath = $moved; targetPath = (Join-Path $vortexGame 'Data'); files = @() }
    $vrec = Join-Path (Join-Path $vortexGame 'Data') 'vortex.deployment.json'
    [IO.File]::WriteAllText($vrec, ($record | ConvertTo-Json -Depth 4))
    $found = $null; $fWhy = Thrown { $script:found = Get-CollectionInstalledFolder '7essxf' $root }
    Yes 'the staging folder Vortex was moved to is found from its own deployment record' (
        $fWhy -eq '' -and $script:found -and [IO.Path]::GetFullPath($script:found.FullName) -eq [IO.Path]::GetFullPath((Join-Path $moved $z)))
    Remove-Item -LiteralPath $vrec
    $fWhy = Thrown { Get-CollectionInstalledFolder '7essxf' $root }
    Yes 'a made.txt whose Vortex record cannot be read stops, naming the record' ($fWhy -match 'vortex\.deployment\.json')
    $cr = [IO.File]::ReadAllText((Join-Path (Join-Path (Join-Path $Repo 'scripts') 'mods') 'Check-CollectionRules.ps1'))
    Yes 'Check-CollectionRules asks for the folder with its install root' ($cr -match 'Get-CollectionInstalledFolder \$slug \$Root')
}
finally {
    $env:APPDATA = $saved.APPDATA
    $env:THORNSWOOD_NEXUS_STANDIN = $saved.STANDIN
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ('{0} passed, {1} failed' -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
