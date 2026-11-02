<#
  test-not-ours.ps1

  Other people's loose mod files never go into a pack or a release record
  again. Issue #1178.

  WHY THIS EXISTS. Measured 29 September: the installer's payload, the dev
  build, the dev record 20260929-140118-dev and the last main record carried
  424 loose files of other people's mods, 124.7 MB, outside Data\Platform:
  RaceMenu's menus and translations, IED's, MCM Helper's, the Unofficial
  Patch's and interior mods' scripts, BodySlide builds made on some other
  machine, leftovers of mods nothing loads, Bethesda's own meshes, another server's
  haybale and Daedric Online's TrueHUD boss list. None of them Vortex deployed,
  so the rules called them ours. Ship-Rules now names what is ours outside
  Data\Platform and nothing else is (Test-ShipNotOurs); files of Nexus mods the
  collection does not have yet are held until the revision that adds them.

  What this holds, each against the real code:
    1. Ship-Rules: a path from every traced group is not ours; everything of
       ours still ships; what is held ships until revision 2 and not after.
    2. Publish-Update: its Test-Machine asks the rule, so the scan leaves these
       out and no release lists them as removed; the collection revision is
       set before the scan; the gone list still keeps what an earlier release
       took out. Lifted out of the shipped script and run.
    3. Check-Secrets fails a pack that carries one, by rule name.
    4. Rollback-Feed's filter, lifted and run: going back hands none out.
    5. On this machine, where there is one: packing C:\Thornswood\Game the way
       Publish-Update does ships nothing outside
       Data\Platform that is not ours, and the Nemesis patches the generator ran
       are all collection mods'.
  The old installer's Package-Thornswood.ps1 asked the rule too, and its
  stage was what Check-Secrets read here; both went with it (#4824).

  Read only apart from its own scratch folder. Never connects to anything.
#>
[CmdletBinding()]
param([string]$Root = 'C:\Thornswood')
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$RulesPath   = Join-Path $Repo 'scripts\release\Ship-Rules.ps1'
$PublishPath = Join-Path $Repo 'scripts\release\Publish-Update.ps1'
$RollPath    = Join-Path $Repo 'scripts\release\Rollback-Feed.ps1'
$SecretsPath = Join-Path $Repo 'scripts\dev\Check-Secrets.ps1'

$script:pass = 0
$script:fail = 0
$script:skip = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Skip([string]$what) { $script:skip++; Write-Host "SKIP  $what" }
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed, {2} skipped" -f $script:pass, $script:fail, $script:skip)
    if ($script:fail) { exit 1 }
    exit 0
}

. $RulesPath

# ---- 1. the rule ------------------------------------------------------------------
Yes 'with no revision known, nothing held has left yet' ($ShipCollectionRevision -eq 0)

# One path from each group traced on 29 September, as the records spelled it.
$theirs = @(
    # RaceMenu's menus and translations, the same bytes as the collection's RaceMenu.bsa.
    'Data\Interface\racesex_menu.swf', 'Data\Interface\racemenu\bottombar.swf', 'Data\Interface\vr\racesex_menu.swf',
    'Data\Interface\Translations\racemenu_english.txt',
    # Other mods' scripts: IED, old MCM Helper, the Unofficial Patch, interior mods.
    'Data\Scripts\IED.pex', 'Data\Scripts\MCM.pex', 'Data\Scripts\MCM_ConfigBase.pex',
    'Data\Scripts\dlc1vcmoondialscript.pex', 'Data\Scripts\wbptlightonscript.pex', 'Data\Scripts\rp_trapcactusscript.pex',
    # A travel clothes file that is byte for byte Common Clothes' own (the
    # collection installs it), refits nobody traced, and leftovers of mods
    # nothing loads.
    'Data\meshes\armor\travel clothes\clothes\3clothesf_0.nif',
    'Data\meshes\armor\dragon priests\krosis\dragonpriestclothingf_krosis_0.nif', 'Data\meshes\MCE\Clothing\F\0MCE_(1f)_Romper.tri',
    'Data\meshes\0CCE\f\0CCE_Hoodf.tri',
    'Data\meshes\surarmorcustommeshes\redf_0.nif', 'Data\meshes\surwhiterunmeshes\outfit_0.nif',
    'Data\meshes\clothes\saviik\banker\bankeroutfitf_0.nif', 'Data\meshes\clothes\sheogorath\sheogorathoutfit.nif',
    'Data\meshes\pulcharmsolis\rhino beetle\armorloinclothm_0.nif', 'Data\meshes\Armor_Replacer\steel\armor1m_0.nif',
    'Data\meshes\actors\character\character assets\femaletailkhajiit.nif',
    # Bethesda's own meshes and textures, loose.
    'Data\meshes\actors\draugr\character assets\draugrfemale.nif', 'Data\meshes\dlc01\actors\skeleton\armorskeleton1.nif',
    'Data\textures\clutter\books\largenote01.dds', 'Data\textures\architecture\riften\riftencanalwood01.dds',
    # The Creation Kit's face tint export; Thornswood Content carries the .dds.
    'Data\textures\actors\character\facegendata\facetint\fishinginskyrim.esp\00025905.tga',
    # Another server's.
    'Data\meshes\weapons\otherserver\otherserver_haybale.nif', 'Data\SKSE\Plugins\TrueHUD\RP_Bosses.ini',
    # Settings a mod or the launcher writes on each machine, and a mod nobody has.
    'Data\Interface\skyui\config.shipped.txt', 'Data\SKSE\Plugins\OpenAnimationReplacer_ImGui.ini',
    'Data\SKSE\Plugins\CommunityShaders\SettingsUser.json', 'Data\SKSE\Plugins\ImGuiVRHelper.toml',
    # Anything else nobody named, anywhere outside Data\Platform.
    'Data\meshes\tools\anvil.nif', 'Data\SomeoneElse.esp', 'd3d11.dll', 'enbseries\enbeffect.fx'
)
foreach ($rel in $theirs) {
    Yes "$rel is not ours and never ships" (Test-ShipNotOurs $rel)
}
Yes 'the rule is not asked through Test-ShipMachine, so a scrub of one machine''s files leaves these alone' (
    @($theirs | Where-Object { $_ -like 'Data\Interface\*' -or $_ -like 'Data\meshes\*' } | Where-Object { Test-ShipMachine $_ }).Count -eq 0)
Yes 'any case' (Test-ShipNotOurs 'DATA\INTERFACE\RACESEX_MENU.SWF')

# Ours. Each of these ships.
$ours = @($ShipOursFiles) + @($ShipOwnArt) + @($ShipClientFiles) + @($ShipRequiredDataFiles) + @(
    'Data\Platform\UI\index.html', 'Data\Platform\Plugins\thornswood-front.js', 'Data\Platform\Fonts\Tavern.ttf',
    # Nemesis's output, generated from the collection's own patches.
    'Data\meshes\animationdatasinglefile.txt', 'Data\meshes\animationsetdatasinglefile.txt',
    'Data\meshes\actors\character\behaviors\0_master.hkx', 'Data\meshes\actors\character\_1stperson\behaviors\mt_behavior.hkx',
    'Data\meshes\actors\character\characters\defaultmale.hkx', 'Data\meshes\actors\character\characters female\defaultfemale.hkx',
    'Data\Scripts\fnis.pex')
foreach ($rel in $ours) {
    Yes "$rel is ours" ((Test-ShipOurs $rel) -and -not (Test-ShipNotOurs $rel))
}
Yes 'the client runtime is named by its record, all six' (@($ShipClientFiles).Count -eq 6)
Yes 'our menu backdrop is the three files Go.ps1 writes' (@($ShipOwnArt).Count -eq 3)
Yes 'required data is read from game\required-data, README left out' (@($ShipRequiredDataFiles | Where-Object { $_ -like '*README*' }).Count -eq 0)
Yes 'a behaviour graph outside a behaviors folder is not taken for Nemesis''s' (Test-ShipNotOurs 'Data\meshes\actors\character\animations\mt_idle.hkx')
Yes 'nor a file named like ours in another folder' (Test-ShipNotOurs 'Data\Interface\old\startmenu.swf')

# Ours for now, until #1259: the outfits built in BodySlide keep shipping until
# Thornswood builds them itself from the collection's BodySlide projects.
$builtList = Join-Path $Repo 'scripts\release\built-until-1259.txt'
Yes 'the BodySlide builds shipped for now are listed beside Ship-Rules' (Test-Path -LiteralPath $builtList)
$builtText = $(if (Test-Path -LiteralPath $builtList) { Get-Content -LiteralPath $builtList -Raw } else { '' })
Yes '  and the list says it is for now, until #1259 replaces it' ($builtText -match '#1259' -and $builtText -match 'FOR NOW')
Yes ('  122 of them: the 140 measured on 29 September less the 18 Bosmer morphs #2454 dropped ({0})' -f $ShipBuiltUntil1259.Count) ($ShipBuiltUntil1259.Count -eq 122)
# Except what is never handed on (#2454,
# permission-held.txt, tests\test-ship-permission-held.ps1): listed, not shipped.
$builtHeld = @($ShipBuiltUntil1259 | Where-Object { Test-ShipPermissionHeld $_ })
$builtOut = @($ShipBuiltUntil1259 | Where-Object { -not (Test-ShipPermissionHeld $_) } | Where-Object { -not (Test-ShipOurs $_) -or (Test-ShipNotOurs $_) })
Yes ('  every one ships as ours, but the {0} never handed on' -f $builtHeld.Count) ($builtOut.Count -eq 0)
Yes '  and a held one does not ship' (@($builtHeld | Where-Object { -not (Test-ShipNotOurs $_) }).Count -eq 0)
$builtWhere = @($ShipBuiltUntil1259 | ForEach-Object { ($_ -split '\\')[0..3] -join '\' } | Sort-Object -Unique)
Yes ('  all in the two folders still waiting on our build ({0})' -f ($builtWhere -join ', ')) (
    @($builtWhere | Where-Object { $_ -notin @('Data\meshes\armor\travel clothes', 'Data\meshes\MCE\clothes') }).Count -eq 0)
Yes '  by exact path: a file beside them that is not listed does not ship' (
    (Test-ShipNotOurs 'Data\meshes\armor\travel clothes\clothes\3clothesf_0.nif') -and (Test-ShipNotOurs 'Data\meshes\armor\bosmerarmormaty743\new.tri'))
Yes '  and none is held for the collection, which could not carry built output' (@($ShipBuiltUntil1259 | Where-Object { Test-ShipHeld $_ 1 }).Count -eq 0)

# Held for the collection.
Yes 'something is held for revision 2' (@($ShipHeldForCollection).Count -gt 0)
foreach ($h in $ShipHeldForCollection) {
    $p = [string]$h.Path
    $rel = $(if ($p.EndsWith('\')) { $p + 'x.nif' } else { $p })
    if ([string]$h.ContentModel) {
        # No revision settles it: it ships while the committed plugin names it
        # (#2298), at every revision, and at none once it does not. Since #2298
        # the board names Thornswood's own mesh, so the old one ships at none.
        # tests\test-2298-held-board.ps1 has the rest.
        $named = Test-ShipContentNames ([string]$h.ContentModel)
        Yes ("{0} ships at every revision exactly while the content plugin names it (names it: {1})" -f $rel, $named) (
            ((-not (Test-ShipNotOurs $rel 0)) -eq $named) -and ((-not (Test-ShipNotOurs $rel 2)) -eq $named) -and
            ((-not (Test-ShipNotOurs $rel 99)) -eq $named))
        continue
    }
    Yes ("{0} ships until revision {1}" -f $rel, $h.Revision) (-not (Test-ShipNotOurs $rel 0) -and -not (Test-ShipNotOurs $rel 1))
    Yes ('  and not from revision {0}: {1}' -f $h.Revision, $h.Mod) ((Test-ShipNotOurs $rel ([int]$h.Revision)) -and (Test-ShipNotOurs $rel 3))
}
Yes 'a held folder does not hold a folder that only starts the same way' (Test-ShipNotOurs 'Data\meshes\clothes\thalmorx\hood.nif' 1)
Yes 'the male face morphs are held, the tails beside them are not' (
    -not (Test-ShipNotOurs 'Data\meshes\actors\character\character assets\beards\humanbeardlong01.tri' 1) -and
    (Test-ShipNotOurs 'Data\meshes\actors\character\character assets\femaletailargonian.nif' 1))
$ShipCollectionRevision = 2
Yes 'the revision the release is built against is the one asked by default' (Test-ShipNotOurs 'Data\meshes\clothes\thalmor\thalmorhoodf_0.nif')
$ShipCollectionRevision = 0

# Get-ShipCollectionRevision reads config.json's collection and asks Vortex.
$T = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-not-ours-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
try {
    Yes 'with nothing to ask Vortex, the revision is 0' ((& { Get-ShipCollectionRevision $T }) -eq 0)
    $got = & {
        function Get-CollectionSlug([string]$Url) { return $Url.Substring($Url.LastIndexOf('/') + 1) }
        function Get-CollectionRevision([string]$Slug) { if ($Slug -eq 'abc123') { return 2 } return 0 }
        [IO.File]::WriteAllText((Join-Path $T 'config.json'), '{"CollectionUrl":"https://www.nexusmods.com/games/skyrimspecialedition/collections/abc123"}')
        $a = Get-ShipCollectionRevision $T
        Remove-Item -LiteralPath (Join-Path $T 'config.json')
        $b = Get-ShipCollectionRevision $T
        return @($a, $b)
    }
    Yes 'it asks for the collection config.json names' ($got[0] -eq 2)
    Yes 'and for 7essxf, the launcher''s own, when there is no config.json' ($got[1] -eq 0)

    # ---- 2. Publish-Update ---------------------------------------------------------
    $pub = Get-Content -LiteralPath $PublishPath -Raw
    $tm = [regex]::Match($pub, '(?m)^function Test-Machine\(.*$')
    Yes 'Publish-Update''s Test-Machine asks Test-ShipNotOurs' ($tm.Success -and $tm.Value -match 'Test-ShipNotOurs \$rel')
    $revAt = $pub.IndexOf('$ShipCollectionRevision = Get-ShipCollectionRevision $Root')
    Yes '  the collection revision is set before the scan' ($revAt -gt 0 -and $revAt -lt $pub.IndexOf('Say ''  Scanning the build...'''))
    Yes '  and after LoadOrder.ps1, which it needs, is loaded' ($revAt -gt $pub.IndexOf(". (Join-Path `$Here '..\mods\LoadOrder.ps1')"))
    Yes '  the scan leaves out what Test-Machine claims' ($pub -match 'if \(Test-Machine \$rel\) \{ continue \}')
    Yes '  the removals are filtered by Test-Machine' ($pub -match '(?m)^\$removed\s+= @\(\$removed \| Where-Object \{[^\r\n]*Test-Machine \$_')
    Yes '  and the gone list by Test-ShipMachine, so what an earlier release took out stays gone' (
        $pub -match '\(Test-Runtime \$k\) -or \(Test-ShipMachine \$k\) -or \(Test-OtherServer \$k\)\) \{ \$gone\.Remove\(\$k\) \}')
    $diff = [regex]::Match($pub, '(?ms)^\$changed = @\(\); \$removed = @\(\)\r?$.*?^\$removed\s+= @\(\$removed \| Where-Object \{[^\r\n]*Test-Machine[^\r\n]*\r?$')
    Yes '  the diff can be lifted' $diff.Success
    if ($tm.Success -and $diff.Success) {
        . ([scriptblock]::Create($tm.Value))
        # The last release carried RaceMenu's menu, a held face morph, our
        # page and a page of ours that has gone. The game folder still has
        # all but the last.
        $menu = 'Data\Interface\racesex_menu.swf'
        $morph = 'Data\meshes\actors\character\character assets\MaleHead.tri'
        $prev = @{}
        foreach ($k in @($menu, $morph, 'Data\Platform\UI\index.html', 'Data\Platform\UI\thornswood-old.js')) { $prev[$k] = '1:' + ('a' * 64) }
        function Invoke-Diff([int]$rev) {
            $ShipCollectionRevision = $rev
            $now = @{}
            foreach ($rel in @($menu, $morph, 'Data\Platform\UI\index.html')) {
                if (Test-Machine $rel) { continue }
                $now[$rel] = $prev[$rel]
            }
            . ([scriptblock]::Create($diff.Value))
            return @{ Now = $now; Removed = $removed; Changed = $changed }
        }
        $r1 = Invoke-Diff 1
        Yes 'at revision 1 the next pack record leaves RaceMenu''s menu out' (-not $r1.Now.ContainsKey($menu))
        Yes '  and does not list it as removed, so no install loses it' ($r1.Removed -notcontains $menu)
        Yes '  while the held face morph is still in the record' ($r1.Now.ContainsKey($morph))
        Yes '  and a page of ours that went is still removed' ($r1.Removed -contains 'Data\Platform\UI\thornswood-old.js')
        $r2 = Invoke-Diff 2
        Yes 'at revision 2 the face morph leaves the record too' (-not $r2.Now.ContainsKey($morph))
        Yes '  and is not listed as removed either' ($r2.Removed -notcontains $morph)
        Yes '  our page stays, neither changed nor removed' ($r2.Now.ContainsKey('Data\Platform\UI\index.html') -and $r2.Removed -notcontains 'Data\Platform\UI\index.html')
    }

    # ---- 3. Check-Secrets --------------------------------------------------------------
    # Each folder is a pack's shape (game\...), zipped and read as a pack.
    $pwsh = (Get-Process -Id $PID).Path
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    function Invoke-Secrets([string]$dir) {
        $zip = $dir + '.zip'
        [IO.Compression.ZipFile]::CreateFromDirectory($dir, $zip)
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $o = & $pwsh -NoProfile -NonInteractive -File $SecretsPath -Zip $zip 2>&1 | Out-String }
        finally { $ErrorActionPreference = $old }
        return @{ Code = $LASTEXITCODE; Out = $o }
    }
    $clean = Join-Path $T 'clean'
    $dirty = Join-Path $T 'dirty'
    foreach ($f in @('game\Data\Platform\UI\index.html', 'game\Data\Scripts\fnis.pex', 'game\Data\Interface\loadwaitspinner.swf')) {
        foreach ($d in $clean, $dirty) {
            $p = Join-Path $d $f; New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
            [IO.File]::WriteAllText($p, 'x')
        }
    }
    $p = Join-Path $dirty 'game\Data\Interface\racesex_menu.swf'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    [IO.File]::WriteAllText($p, 'x')
    $rc = Invoke-Secrets $clean
    Yes 'Check-Secrets passes a pack of ours alone' ($rc.Code -eq 0)
    $rd = Invoke-Secrets $dirty
    Yes '  and fails one that carries RaceMenu''s loose menu, by rule name' ($rd.Code -ne 0 -and $rd.Out -match 'never-ship-not-ours')
    # The main menu is made on each machine from its own game since #2827,
    # so a pack that carries it hands on Bethesda's file.
    $menu = Join-Path $T 'menu'
    $p = Join-Path $menu 'game\Data\Interface\startmenu.swf'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    [IO.File]::WriteAllText($p, 'x')
    $rm = Invoke-Secrets $menu
    Yes '  and one that carries the main menu, which is made from each game (#2827)' ($rm.Code -ne 0 -and $rm.Out -match 'never-ship-bethesda')

    # ---- 4. Rollback-Feed --------------------------------------------------------------
    $roll = Get-Content -LiteralPath $RollPath -Raw
    $a = $roll.IndexOf('# ==== thornswood no bethesda in a rollback ====')
    $b = $roll.IndexOf('# ==== end thornswood no bethesda in a rollback ====')
    Yes 'the rollback filter is in Rollback-Feed.ps1' ($a -ge 0 -and $b -gt $a)
    if ($a -ge 0 -and $b -gt $a) {
        $filter = $roll.Substring($a, $b - $a)
        function Say($m, $c) { }
        $curMap = @{ 'Data\Platform\UI\index.html' = '1:aa'; 'Data\Interface\racesex_menu.swf' = '2:bb'; ':gone:Data\meshes\LostArk\KamenSword.nif' = 'removed' }
        $tgtMap = @{ 'Data\Platform\UI\index.html' = '1:cc'; 'Data\Interface\racesex_menu.swf' = '2:dd'; 'Data\meshes\weapons\otherserver\otherserver_haybale.nif' = '3:ee';
                     'Data\meshes\actors\character\behaviors\0_master.hkx' = '4:ff' }
        Invoke-Expression $filter
        Yes 'going back to an old record hands none of them out' (-not $tgtMap.ContainsKey('Data\Interface\racesex_menu.swf') -and -not $tgtMap.ContainsKey('Data\meshes\weapons\otherserver\otherserver_haybale.nif'))
        Yes '  nor lists them as gone going forward' (-not $curMap.ContainsKey('Data\Interface\racesex_menu.swf'))
        Yes '  while what an earlier release took out stays gone' ($curMap.ContainsKey(':gone:Data\meshes\LostArk\KamenSword.nif'))
        Yes '  and ours stays, Nemesis''s output with it' ($tgtMap.ContainsKey('Data\Platform\UI\index.html') -and $tgtMap.ContainsKey('Data\meshes\actors\character\behaviors\0_master.hkx'))
        Yes ('  and it says how many it left out ({0})' -f $notOurs) ($notOurs -eq 3)
    }
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 5. this machine ------------------------------------------------------------------
# Join-Path stops on a drive this machine does not have (C: off Windows),
# so whether the folder is here at all is asked first.
if (-not (Test-Path -LiteralPath $Root)) {
    Skip "no $Root on this machine"
    Done
}
$game = Join-Path $Root 'Game'
$profileDir = Join-Path $Root 'Profile'
$collection = Get-ShipOwnGameCollection $profileDir
if (-not (Test-Path -LiteralPath $game) -or $null -eq $collection) {
    Skip "no $game with a Profile\OwnGame\files.txt on this machine"
    Done
}
$prefix = $game.TrimEnd('\') + '\'
$shipped = @(); $leftOut = 0; $leftBytes = [long]0; $held = 0
foreach ($f in (Get-ChildItem -LiteralPath $game -Recurse -File -Force)) {
    $rel = $f.FullName.Substring($prefix.Length)
    if ($collection.Contains($rel)) { continue }
    if ((Test-ShipVanilla $rel) -or (Test-ShipForeignFramework $rel) -or (Test-ShipRuntime $rel) -or (Test-ShipMachine $rel)) { continue }
    if ($f.Extension -in '.pdb', '.log') { continue }
    if (Test-ShipNotOurs $rel 1) { $leftOut++; $leftBytes += $f.Length; continue }
    if (-not (Test-ShipOurs $rel)) { $held++ }
    $shipped += [pscustomobject]@{ Rel = $rel; Len = $f.Length }
}
Write-Host ("      {0}: {1:n0} files would ship, {2:n0} of other people's loose files left out ({3:n1} MB), {4} held for revision 2" -f $game, $shipped.Count, $leftOut, ($leftBytes / 1MB), $held)
$strays = @($shipped | Where-Object { -not $_.Rel.StartsWith('Data\Platform\', 'OrdinalIgnoreCase') -and -not (Test-ShipOurs $_.Rel) -and -not (Test-ShipHeld $_.Rel 1) })
Yes 'nothing outside Data\Platform would ship that is not ours or held' ($strays.Count -eq 0)
foreach ($s in @($strays | Select-Object -First 10)) { Write-Host "      $($s.Rel)" }
# Assigned, not wrapped in @(): the function hands back one array.
$looseLeft = Get-ShipLooseArt @($shipped | Where-Object { -not (Test-ShipHeld $_.Rel 1) })
Yes 'the loose art report has nothing left to name but what is held' ($looseLeft.Count -eq 0)
foreach ($l in $looseLeft) { Write-Host ("      {0} {1} file(s)" -f $l.Folder, $l.Files) }
# 166 on 29 September, once the 140 BodySlide builds kept until #1259 and the
# 102 held for revision 2 are counted apart.
Yes ('the other people''s files the 29 September measurement found are left out (at least 160, {0} here)' -f $leftOut) ($leftOut -ge 160)

# The generator's own record of the patches it ran, and whose they are.
$settings = Join-Path $game 'Data\Nemesis_Engine\cache\mod settings'
if (Test-Path -LiteralPath $settings) {
    $ids = @([regex]::Matches((Get-Content -LiteralPath $settings -Raw), 'skyrimspecialedition/mods/(\d+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    $cjson = $null
    try {
        . (Join-Path $Repo 'scripts\mods\LoadOrder.ps1')
        $cf = Get-CollectionInstalledFolder '7essxf'
        if ($cf) { $cjson = Get-CollectionJsonPath $cf.FullName }
    } catch { $cjson = $null }
    if ($cjson -and (Test-Path -LiteralPath $cjson)) {
        $inColl = @((Get-Content -LiteralPath $cjson -Raw | ConvertFrom-Json).mods | ForEach-Object { [string]$_.source.modId })
        Yes ('Nemesis ran only collection mods'' patches ({0})' -f ($ids -join ', ')) ($ids.Count -gt 0 -and @($ids | Where-Object { $inColl -notcontains $_ }).Count -eq 0)
        Yes '  and Nemesis itself is in the collection (60033)' ($inColl -contains '60033')
    } else {
        Skip 'the collection''s own collection.json is not on this machine'
    }
} else {
    Skip "no Nemesis mod settings in $game"
}
Done
