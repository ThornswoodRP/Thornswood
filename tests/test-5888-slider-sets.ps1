# Issue #5888: a collection layout says which BodySlide slider sets it
# places, as metadata only. #4571 needs every set Common Clothes and Armors
# -3BA- Bodyslide and More Craftable Equipment - CBBE Bodyslide carry, with
# its outputs, and until now no layout record kept anything of an .osp but
# its sha256 in files.txt. Install-NexusRevision.ps1 now reads each placed
# .osp under Data\CalienteTools\BodySlide\SliderSets while its unpacked copy
# is there and writes slidersets.json beside layout.json: per file its path,
# sha256, size, mod and file id, and per set its name, OutputPath,
# OutputFile and GenWeights. No .osp is kept.
#   1. SliderSets.ps1 reads an .osp's sets, GenWeights as the launcher does,
#      and refuses a DTD, a file that is not a SliderSetInfo, a nameless set.
#   2. The record lists only placed slider set files, sorted, with the
#      sha256 files.txt has, and stops on one never read.
#   3. Install-NexusRevision.ps1 reads them in every mode before the
#      unpacked copy goes, writes slidersets.json with the other records,
#      and a -Record folder may hold it.
#   4. nexus-verbs.json names SliderSets.ps1 under Install-NexusRevision's
#      reads, so a change to it waits for Patrick as the script does.
# No Nexus, no network; under a second.
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$ok) { if ($ok) { $script:pass++; Write-Host "PASS $what" } else { $script:fail++; Write-Host "FAIL $what" } }
function Refuses([string]$what, [scriptblock]$do, [string]$like = '*') {
    $msg = $null
    try { & $do | Out-Null } catch { $msg = $_.Exception.Message }
    Yes $what ($null -ne $msg -and $msg -like $like)
    if ($msg -and $msg -notlike $like) { Write-Host "      said: $msg" }
}

$helper = Join-Path $Repo 'scripts/release/SliderSets.ps1'
Yes 'scripts/release/SliderSets.ps1 is there' (Test-Path -LiteralPath $helper -PathType Leaf)
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { Write-Host ''; Write-Host "$pass passed, $fail failed"; exit 1 }
. $helper

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-5888-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    # ---- 1. one .osp -----------------------------------------------------------
    $osp = Join-Path $tmp 'clothes.osp'
    [IO.File]::WriteAllText($osp, @'
<?xml version="1.0" encoding="UTF-8"?>
<SliderSetInfo version="1">
    <SliderSet name="Common Clothes 1">
        <SourceFile>CommonClothes.nif</SourceFile>
        <OutputPath>meshes\armor\travel clothes\clothes</OutputPath>
        <OutputFile GenWeights="true">1clothesf</OutputFile>
        <Shape target="Top">Top</Shape>
    </SliderSet>
    <SliderSet name="Common Clothes 1 Boots">
        <OutputPath> meshes\armor\travel clothes\boots </OutputPath>
        <OutputFile GenWeights="false">bootsf</OutputFile>
    </SliderSet>
    <SliderSet name="Hood">
        <OutputPath>meshes\hood</OutputPath>
        <OutputFile>hoodf</OutputFile>
    </SliderSet>
</SliderSetInfo>
'@)
    $sets = Read-SliderSetFile $osp 'clothes.osp'
    Yes '1. every set in the file, in its order' ((($sets | ForEach-Object { $_.name }) -join '|') -eq 'Common Clothes 1|Common Clothes 1 Boots|Hood')
    Yes '   with its OutputPath and OutputFile, trimmed' ($sets[0].outputPath -eq 'meshes\armor\travel clothes\clothes' -and $sets[0].outputFile -eq '1clothesf' -and $sets[1].outputPath -eq 'meshes\armor\travel clothes\boots')
    Yes '   GenWeights true only when OutputFile says "true", as the launcher reads it' ($sets[0].genWeights -eq $true -and $sets[1].genWeights -eq $false -and $sets[2].genWeights -eq $false)
    Yes '   and nothing else of the set: no shapes, sliders or source file' ((@($sets[0].Keys) -join ',') -eq 'name,outputPath,outputFile,genWeights')
    $one = Join-Path $tmp 'one.osp'
    [IO.File]::WriteAllText($one, '<SliderSetInfo><SliderSet name="Only"><OutputPath>meshes\o</OutputPath><OutputFile GenWeights="true">o</OutputFile></SliderSet></SliderSetInfo>')
    $only = Read-SliderSetFile $one 'one.osp'
    Yes '   a file with one set gives a list of one' ($only.Count -eq 1 -and $only[0].name -eq 'Only')
    $dtd = Join-Path $tmp 'dtd.osp'
    [IO.File]::WriteAllText($dtd, '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/hostname">]><SliderSetInfo><SliderSet name="&e;"/></SliderSetInfo>')
    Refuses '   a DTD is refused, naming the file' { Read-SliderSetFile $dtd 'dtd.osp' } 'dtd.osp is not XML BodySlide reads*'
    $other = Join-Path $tmp 'other.osp'
    [IO.File]::WriteAllText($other, '<ModuleConfig/>')
    Refuses '   a file that is not a SliderSetInfo is refused' { Read-SliderSetFile $other 'other.osp' } '*not a slider set file*'
    $noname = Join-Path $tmp 'noname.osp'
    [IO.File]::WriteAllText($noname, '<SliderSetInfo><SliderSet><OutputPath>meshes\x</OutputPath></SliderSet></SliderSetInfo>')
    Refuses '   a set with no name is refused' { Read-SliderSetFile $noname 'noname.osp' } '*no name*'
    Yes '   only a .osp straight in CalienteTools\BodySlide\SliderSets is a slider set file' ((Test-SliderSetRel 'CalienteTools\BodySlide\SliderSets\A.osp') -and (Test-SliderSetRel 'calientetools\bodyslide\slidersets\b.OSP') -and -not (Test-SliderSetRel 'CalienteTools\BodySlide\SliderSets\x\A.osp') -and -not (Test-SliderSetRel 'CalienteTools\BodySlide\ShapeData\A.osp') -and -not (Test-SliderSetRel 'CalienteTools\BodySlide\SliderSets\A.xml'))

    # ---- 2. the record ----------------------------------------------------------
    $entries = @(
        [pscustomobject]@{ ModId = 83980; FileId = 355184 },
        [pscustomobject]@{ ModId = 44666; FileId = 338437 }
    )
    $placed = @(
        [pscustomobject]@{ Rel = 'Data\CalienteTools\BodySlide\SliderSets\Zed.osp'; Full = '/u/1/z.osp'; Entry = 1; Size = 20; Sha256 = 'bb' },
        [pscustomobject]@{ Rel = 'Data\CalienteTools\BodySlide\SliderSets\clothes.osp'; Full = '/u/0/c.osp'; Entry = 0; Size = 10; Sha256 = 'aa' },
        [pscustomobject]@{ Rel = 'Data\meshes\armor\x.nif'; Full = '/u/0/x.nif'; Entry = 0; Size = 5; Sha256 = 'cc' },
        [pscustomobject]@{ Rel = 'Data\CalienteTools\BodySlide\ShapeData\x\x.nif'; Full = '/u/0/s.nif'; Entry = 0; Size = 5; Sha256 = 'dd' }
    )
    $read = @{ '/u/0/c.osp' = $sets; '/u/1/z.osp' = $only }
    $rec = New-SliderSetRecord '7essxf' 12 $placed $read $entries
    Yes '2. the record names the collection and revision' ($rec.schema -eq 1 -and $rec.collection -eq '7essxf' -and $rec.revision -eq 12)
    Yes '   only the slider set files, by path ignoring case' ((@($rec.files | ForEach-Object { $_.path }) -join '|') -eq 'Data\CalienteTools\BodySlide\SliderSets\clothes.osp|Data\CalienteTools\BodySlide\SliderSets\Zed.osp')
    Yes '   each with the sha256 and size files.txt has, its mod and file id' ($rec.files[0].sha256 -eq 'aa' -and $rec.files[0].size -eq 10 -and $rec.files[0].modId -eq 83980 -and $rec.files[0].fileId -eq 355184 -and $rec.files[1].fileId -eq 338437)
    Yes '   and its sets' ($rec.files[0].sets.Count -eq 3 -and $rec.files[1].sets[0].name -eq 'Only')
    $json = $rec | ConvertTo-Json -Depth 6
    $back = $json | ConvertFrom-Json
    Yes '   it writes as JSON and reads back the same' ($back.files.Count -eq 2 -and $back.files[0].sets[2].name -eq 'Hood' -and $back.files[1].sets.Count -eq 1)
    Refuses '   a placed slider set file that was never read stops it' { New-SliderSetRecord '7essxf' 12 $placed @{ '/u/0/c.osp' = $sets } $entries } '*SliderSets\Zed.osp was not read*'
    $none = New-SliderSetRecord '7essxf' 12 @($placed[2]) @{} $entries
    Yes '   a layout with no slider set file says so with an empty list' ($none.files.Count -eq 0 -and (($none | ConvertTo-Json -Depth 6) -match '"files": \[\]'))
}
finally { Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue }

# ---- 3. the layout -------------------------------------------------------------
$inr = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/release/Install-NexusRevision.ps1'))
Yes '3. Install-NexusRevision.ps1 loads SliderSets.ps1' ($inr -match "\. \(Join-Path \`$Here 'SliderSets\.ps1'\)")
$loop = $inr.IndexOf('foreach ($w in $plan.Warnings)')
$rec1 = $inr.IndexOf('if ($Record) {', [Math]::Max(0, $loop))
$read1 = $inr.IndexOf('$script:SliderSetsRead[$s.Full] = ', [Math]::Max(0, $loop))
Yes '   it reads each slider set file in the install loop, before the -Record block takes the unpacked copy' ($loop -gt 0 -and $read1 -gt $loop -and $read1 -lt $rec1)
Yes '   from the staged copy, so a patched .osp is read as it is placed' ($inr.Contains('$script:SliderSetsRead[$s.Full] = Step { Read-SliderSetFile $s.Full $s.Rel }'))
Yes '   and writes slidersets.json with the other records' ($inr -match "New-SliderSetRecord \`$Slug \`$Revision \`$placed \`$script:SliderSetsRead \`$col\.Entries" -and $inr -match "Join-Path \`$dir 'slidersets\.json'")
Yes '   a -Record folder may already hold slidersets.json' ($inr -match "@\('layout\.json', 'files\.txt', 'plugins\.txt', 'loadorder\.txt', 'slidersets\.json',")
Yes '   and a game folder''s old slidersets.json goes with its other records' ($inr -match "foreach \(\`$n in 'layout\.json', 'files\.txt', 'plugins\.txt', 'loadorder\.txt', 'slidersets\.json', 'placed\.tsv'\)")

# ---- 4. the verb ---------------------------------------------------------------
$verbs = [IO.File]::ReadAllText((Join-Path $Repo 'scripts/release/nexus-verbs.json')) | ConvertFrom-Json
Yes '4. Install-NexusRevision''s reads name SliderSets.ps1' (@($verbs.verbs.'Install-NexusRevision'.reads) -contains 'scripts/release/SliderSets.ps1')

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
exit 0
