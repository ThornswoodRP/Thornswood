# Issue #2454: files Thornswood never hands on (scripts\release\permission-held.txt)
# never ship, whichever list calls them ours, and a release that drops one an
# earlier release shipped lists it as gone with its sha256, so installs lose
# our copy and keep the collection's. Patrick, 17 Oct, relayed by Smeagle:
# Immersive Armors is used as-is through the collection and nothing built from
# it is redistributed. No game folder needed; a second or two.
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
# What this runs, every machine runs in PowerShell 7 since #5356, the box
# included, and this harness runs in it too.
$boxPs = Get-BoxPowerShell
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $Repo 'scripts\release\Ship-Rules.ps1')
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$ok) { if ($ok) { $script:pass++; Write-Host "PASS $what" } else { $script:fail++; Write-Host "FAIL $what" } }
function Refuses([string]$what, [scriptblock]$do, [string]$like = '*') {
    $msg = $null
    try { & $do | Out-Null } catch { $msg = $_.Exception.Message }
    Yes $what ($null -ne $msg -and $msg -like $like)
    if ($msg -and $msg -notlike $like) { Write-Host "      said: $msg" }
}

$list = Join-Path $Repo 'scripts\release\permission-held.txt'
Yes 'the permission hold list is beside Ship-Rules' (Test-Path -LiteralPath $list)
Yes ('  it holds something ({0})' -f @($ShipPermissionHeld).Count) (@($ShipPermissionHeld).Count -gt 0)
Yes '  every hold names the issue that carries its question' (@($ShipPermissionHeld | Where-Object { $_.Reason -notmatch '#\d+' }).Count -eq 0)
$text = [IO.File]::ReadAllText($list)
Yes '  and the list says how a hold is released' ($text -match 'TO RELEASE A HOLD' -and $text -match 'asset-provenance')

# The Bosmer armour: held as a folder.
$folder = 'Data\meshes\armor\bosmerarmormaty743\'
Yes 'the Bosmer armour folder is held, for #2454, on Patrick''s ruling' (@($ShipPermissionHeld | Where-Object { $_.Path -ieq $folder -and $_.Reason -match '#2454' -and $_.Reason -match 'as-is through the collection' }).Count -eq 1)

# Its 18 .tri morphs, as the published records of 12 and 17 Oct name them,
# leave the next pack.
# On main they are still lines of built-until-1259.txt (no file is deleted);
# #2454 takes them off that list. Either way none of them ships.
$morphs = @('1stpersonarmortorso.tri', 'boots.tri', 'bracers.tri', 'bracersengravedf.tri', 'cape\fullcape.tri',
    'cape\fullcapef.tri', 'cape\shouldercape.tri', 'cape\shouldercapef.tri', 'cape\shoulderengravedcapef.tri',
    'metalglovesm.tri', 'torso.tri', 'torsofengraved.tri', 'torsometal.tri', 'wildhunt\huntbootsm.tri',
    'wildhunt\huntfemaletorsolight.tri', 'wildhunt\huntgloves.tri', 'wildhunt\huntlightglovesf.tri', 'wildhunt\hunttorso.tri') | ForEach-Object { $folder + $_ }
$tri = @($ShipBuiltUntil1259 | Where-Object { $_ -like ($folder + '*') })
Yes ('built-until-1259.txt lists all 18 Bosmer morphs, or none once #2454 drops them ({0})' -f $tri.Count) ($tri.Count -eq 0 -or ($tri.Count -eq 18 -and @($morphs | Where-Object { -not $ShipBuiltUntil1259.Contains($_) }).Count -eq 0))
Yes '  none of the 18 is ours while held' (@($morphs | Where-Object { Test-ShipOurs $_ }).Count -eq 0)
Yes '  every one is left out of packs and the installer' (@($morphs | Where-Object { -not (Test-ShipNotOurs $_) }).Count -eq 0)
Yes '  and with forward slashes, as a zip or git path' ((Test-ShipPermissionHeld 'Data/meshes/armor/bosmerarmormaty743/boots.tri') -and (Test-ShipNotOurs 'Data/meshes/armor/bosmerarmormaty743/boots.tri'))
Yes '  held whatever the collection revision' ((Test-ShipNotOurs ($folder + 'torso.tri') 1) -and (Test-ShipNotOurs ($folder + 'torso.tri') 99))

# Nothing built from its BodySlide sets ships either, should any appear.
foreach ($n in 'torsof_0.nif', 'torsofengraved_1.nif', 'bracersf_0.nif', 'metalglovesf_1.nif', 'cape\fullcapef_0.nif', 'cape\shoulderengravedcapef_1.nif') {
    Yes "  a built $n would not ship" ((Test-ShipNotOurs ($folder + $n)) -and -not (Test-ShipOurs ($folder + $n)))
}

# Nothing else changes.
Yes 'a travel clothes mesh on the same list still ships' ((Test-ShipOurs 'Data\meshes\armor\travel clothes\beltedrobe\1beltedrobef_0.nif') -and -not (Test-ShipNotOurs 'Data\meshes\armor\travel clothes\beltedrobe\1beltedrobef_0.nif'))
Yes '  and the executioner' (Test-ShipOurs 'Data\meshes\MCE\clothes\executioner\f\body_0.nif')
Yes 'a folder whose name only starts the same is not held' (-not (Test-ShipPermissionHeld 'Data\meshes\armor\bosmerarmormaty743x\a.nif'))
Yes 'our own plugin still ships' (Test-ShipOurs 'Data\Thornswood-Content.esp')

# A release that drops a held file an earlier one shipped lists it as gone
# with the sha256 we shipped (#1261): Publish-Update makes no exception for it.
$pu = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\Publish-Update.ps1'))
Yes 'Publish-Update turns a held file an earlier release shipped into a hash-matched gone' (($pu -notmatch 'Test-ShipPermissionHeld') -and ($pu -match 'if \(-not \(Test-ShipNotOurs \$k\)\) \{ continue \}'))
Yes '  none of the 18 morphs is a file kind that is never made a gone (Bethesda''s, one machine''s, a backup)' (@($morphs | Where-Object { (Test-ShipBethesda $_) -or (Test-ShipOneMachine $_) -or (Test-ShipBackup $_) }).Count -eq 0)

# Reading the list, and releasing a hold.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-held-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$saved = $ShipPermissionHeld
try {
    $p = Join-Path $tmp 'held.txt'
    [IO.File]::WriteAllText($p, "# a note`r`nData\x\y.nif  #1 why`r`nData\z\`t#2 why too`r`n")
    $r = @(Read-ShipPermissionHeld $p)
    Yes 'a list reads one hold a line, by two spaces or a tab' ($r.Count -eq 2 -and $r[0].Path -eq 'Data\x\y.nif' -and $r[1].Path -eq 'Data\z\' -and $r[1].Reason -eq '#2 why too')
    [IO.File]::WriteAllText($p, "Data\x\y.nif`r`n")
    Refuses 'a hold with no reason is refused' { Read-ShipPermissionHeld $p } '*reason*'
    [IO.File]::WriteAllText($p, "Data\x\y.nif  because`r`n")
    Refuses 'a hold whose reason names no issue is refused' { Read-ShipPermissionHeld $p } '*issue*'
    Refuses 'a missing list is refused when read, so no hold is lost with it' { Read-ShipPermissionHeld (Join-Path $tmp 'gone.txt') } '*missing*'
    # A copy of Ship-Rules without its lists, as test fixtures make (the same
    # files test-client-by-hash copies), loads with no holds.
    $lone = Join-Path $tmp 'lone'; $loneTools = Join-Path $lone 'scripts\release'; $loneRec = Join-Path $lone 'records'
    New-Item -ItemType Directory $loneTools, $loneRec | Out-Null
    foreach ($f in 'Ship-Rules.ps1', 'RecordShape.ps1', 'Read-JsonFile.ps1', 'RepoPlugins.ps1', 'CollectionRevision.ps1') { Copy-Item -LiteralPath (Join-Path $Repo ('scripts\release\' + $f)) -Destination $loneTools }
    Copy-Item -LiteralPath (Join-Path $Repo 'records\ui-gone.json') -Destination $loneRec
    $n = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -Command "& { `$ErrorActionPreference = 'Stop'; . '$loneTools\Ship-Rules.ps1'; 'held=' + `$ShipPermissionHeld.Count }" 2>$null)
    Yes ('a copy of Ship-Rules with no list beside it loads with no holds ({0})' -f ($n -join ' ')) (@($n | Where-Object { $_ -eq 'held=0' }).Count -eq 1)

    # Releasing a hold (only on a new ruling): the same list without its line.
    # Shown on a path another list calls ours (a travel clothes mesh, on
    # built-until-1259.txt): held, it does not ship; its line out, it ships.
    $ours = 'Data\meshes\armor\travel clothes\beltedrobe\1beltedrobef_0.nif'
    [IO.File]::WriteAllText($p, "Data\meshes\armor\travel clothes\beltedrobe\  #2454 a hold made for this check`r`n")
    $script:ShipPermissionHeld = @(Read-ShipPermissionHeld $p)
    Yes 'a hold beats every list that calls a file ours' ((Test-ShipNotOurs $ours) -and -not (Test-ShipOurs $ours))
    [IO.File]::WriteAllText($p, "# released`r`n")
    $script:ShipPermissionHeld = @(Read-ShipPermissionHeld $p)
    Yes '  and with its line taken out, the file ships again' ((Test-ShipOurs $ours) -and -not (Test-ShipNotOurs $ours))
} finally {
    $script:ShipPermissionHeld = $saved
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Yes 'and the real holds are back after the check' (Test-ShipNotOurs ($folder + 'boots.tri'))

Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 }
exit 0
