<#
  test-shipped-not-ours.ps1

      pwsh -NoProfile -File .\tests\test-shipped-not-ours.ps1

  Other authors' loose files our old packs shipped leave every install they
  reached, where the bytes still match, and never anybody's own copy (#1178).

  WHY THIS EXISTS. Until 29 September the packs carried other authors' loose
  files as ours: RaceMenu's interface, MCM Helper's and IED's scripts, body
  refits of other mods' outfits, and the other server's haybale. The scrub that
  day took them out of the packs and the records. #1261 (2 October) makes a
  release list such a file as gone at the sha256 we shipped, so the launcher
  deletes it while the bytes still match, but only when the release before
  named it, and after the scrub none did. Measured on 12 October: the main
  install on the shipping machine still held 166 of them, 67.6 MB, and no
  record had ever listed one as gone. records\shipped-not-ours.json names
  165 of them with their bytes, and Publish-Update puts each in every record.
  The 166th is the haybale, whose path names the other server, which no
  tracked file may (#400, tests\test-other-server-name-gone.js): the
  launcher's Leaks.cs takes it out of Thornswood's own folder by its shape
  and bytes instead.

  What this holds, against the real code:
    1. The committed record reads at version 1, names the 165 files, and Ship-
       Rules' Get-ShipShippedNotOurs calls every one another author's.
    2. A record naming Bethesda's file, one machine's own, a backup, a file of
       ours or a path outside Data is refused, naming it.
    3. Publish-Update's block, lifted out between its markers and run: each
       file goes into the record as gone at its sha256, except one the release
       ships and one Ship-Rules deletes everywhere; it sits after the #1261
       loop and before the record guards, which pass over its result.
    4. The launcher's sync deletes a sha256 gone file only when its bytes match
       and Vortex does not deploy the path, and Leaks.cs takes the haybale out
       of Thornswood's own folder only, by shape and bytes, at every start.

  Offline. Writes only bad copies of the record, in its own scratch folder.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$RecordPath  = Join-Path $Repo 'records\shipped-not-ours.json'
$PublishPath = Join-Path $Repo 'scripts\release\Publish-Update.ps1'
$SyncPath    = Join-Path $Repo 'launcher\app\Sync.cs'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Refusal([scriptblock]$b) { try { $null = & $b; return '' } catch { return $_.Exception.Message } }

. (Join-Path $Repo 'scripts\release\Ship-Rules.ps1')

# ---- 1. the committed record -------------------------------------------------
$doc = $null
Yes 'the committed record reads at a known version with its fields' ((Refusal { $script:doc = Read-ThornswoodRecord -Path $RecordPath -Kind shipped-not-ours }) -eq '')
$doc = Read-ThornswoodRecord -Path $RecordPath -Kind shipped-not-ours
$rows = @($doc.files.PSObject.Properties)
$bytes = [int64]0
foreach ($r in $rows) { $bytes += [int64]$r.Value.bytes }
# 166 files and 67.6 MB were measured; the haybale (44,541 bytes) is Leaks.cs's.
Yes 'it names 165 of the 166 files measured on 12 October, 67.5 MB' ($rows.Count -eq 165 -and [math]::Round($bytes / 1MB, 1) -eq 67.5 -and $bytes + 44541 -eq 70850409)
Yes '  and says it is version 1' ([int]$doc.version -eq 1)
$map = $null
Yes 'Get-ShipShippedNotOurs reads it' ((Refusal { $script:map = Get-ShipShippedNotOurs }) -eq '')
$map = Get-ShipShippedNotOurs
Yes '  every file, another author''s by Ship-Rules' ($map.Count -eq 165)
Yes '  none of them Bethesda''s, one machine''s own or a backup' (-not @($map.Keys | Where-Object { (Test-ShipBethesda $_) -or (Test-ShipOneMachine $_) -or (Test-ShipBackup $_) }).Count)
Yes '  each at a lowercase sha256' (-not @($map.Values | Where-Object { $_ -cnotmatch '^[0-9a-f]{64}$' }).Count)
foreach ($k in 'Data\Scripts\IED.pex', 'Data\Scripts\MCM.pex', 'Data\Scripts\MCM_ConfigBase.pex',
               'Data\Interface\racesex_menu.swf', 'Data\textures\actors\character\facegendata\facetint\fishinginskyrim.esp\00025905.tga',
               'Data\meshes\surwhiterunmeshes\outfit_0.nif', 'Data\meshes\0CCE\f\0CCE_Hoodf.tri') {
    Yes "  it names $k" ($map.Contains($k))
}
Yes '  MCM Helper''s old script at the bytes the packs shipped' ($map['Data\Scripts\MCM_ConfigBase.pex'] -eq '0bf7f4e533da9e784dad8f70fadac99f5830e9a70a4ec6489e5679f489ea7d85')
Yes '  and no path of it under a weapons prefix folder named for the file in it' (-not @($map.Keys | Where-Object { $_ -match '^Data\\meshes\\weapons\\([^\\]+)\\\1_' }).Count)

# ---- 2. bad copies are refused -------------------------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-1178 [x] & ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp
$realRecord = $ShipShippedNotOursRecord
try {
    $sha = 'ab' * 32
    function With-Path([string]$rel) {
        $d = Get-Content -LiteralPath $RecordPath -Raw | ConvertFrom-Json
        $d.files | Add-Member -NotePropertyName $rel -NotePropertyValue ([pscustomobject]@{ sha256 = $sha; bytes = 10 })
        $p = Join-Path $tmp 'shipped-not-ours.json'
        [IO.File]::WriteAllText($p, ($d | ConvertTo-Json -Depth 5))
        $script:ShipShippedNotOursRecord = $p
        return (Refusal { Get-ShipShippedNotOurs })
    }
    foreach ($rel in 'Data\Skyrim.esm', 'Data\Dawnguard.esm', 'Data\SKSE\Plugins\foo.log', 'Data\MCM\Settings\foo.ini',
                     'Data\Platform\settings.json', 'Data\Scripts\IED.pex.bak', 'Data\Platform\UI\index.html') {
        $why = With-Path $rel
        Yes "a record naming $rel is refused, naming it" ($why -match 'does not call another author' -and $why.Contains($rel))
    }
    foreach ($rel in 'SkyrimSE.exe', 'Data\..\SkyrimSE.exe', 'Data/meshes/x.nif', 'Data\meshes\x.nif\', 'C:\Data\x.nif', 'Data\\meshes\x.nif') {
        $why = With-Path $rel
        Yes "a record naming $rel is refused as not a file under Data" ($why -match 'is not a file under Data')
    }
    $d = Get-Content -LiteralPath $RecordPath -Raw | ConvertFrom-Json
    $d.PSObject.Properties.Remove('version')
    $p = Join-Path $tmp 'no-version.json'
    [IO.File]::WriteAllText($p, ($d | ConvertTo-Json -Depth 5))
    $script:ShipShippedNotOursRecord = $p
    Yes 'a record with no version is refused' ((Refusal { Get-ShipShippedNotOurs }) -match 'it has no version')
    $d = Get-Content -LiteralPath $RecordPath -Raw | ConvertFrom-Json
    @($d.files.PSObject.Properties)[0].Value.sha256 = 'abc'
    [IO.File]::WriteAllText($p, ($d | ConvertTo-Json -Depth 5))
    Yes 'a file with no whole sha256 is refused' ((Refusal { Get-ShipShippedNotOurs }) -match 'has no sha256')
    $script:ShipShippedNotOursRecord = Join-Path $tmp 'not-there.json'
    Yes 'a missing record stops it' ((Refusal { Get-ShipShippedNotOurs }) -match 'there is no shipped-not-ours record')
} finally {
    $script:ShipShippedNotOursRecord = $realRecord
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 3. Publish-Update ---------------------------------------------------------
function Get-Block([string]$src, [string]$name) {
    $a = $src.IndexOf("# ==== thornswood $name ====")
    $b = $src.IndexOf("# ==== end thornswood $name ====")
    if ($a -lt 0 -or $b -le $a) { return $null }
    return $src.Substring($a, $b - $a)
}
$pub = Get-Content -LiteralPath $PublishPath -Raw
$block = Get-Block $pub 'shipped not ours'
Yes 'the block is in Publish-Update.ps1' ($null -ne $block)
if ($block) {
    $at = $pub.IndexOf('# ==== thornswood shipped not ours ====')
    Yes '  after the #1261 loop, which it adds to' ($at -gt $pub.IndexOf('# #1261: other authors'' files we once shipped leave as gone'))
    Yes '  before the loop that keeps a sha256 gone entry' ($at -lt $pub.IndexOf('# A hash-matched gone entry stays (#1261)'))
    Yes '  before what is gone goes into the record' ($at -lt $pub.IndexOf('foreach ($k in @($gone.Keys)) { $now['':gone:'' + $k] = [string]$gone[$k] }'))
    Yes '  and before the record guards' ($at -lt $pub.IndexOf('# ==== thornswood no bethesda in the record ===='))
    Yes '  which keeps a sha256 gone entry whatever the rules say of the path' ($pub -match "if \(\[string\]\`$gone\[\`$k\] -match '\^\[0-9a-fA-F\]\{64\}\$'\) \{ continue \}")

    $now = @{ 'Data\Platform\UI\index.html' = '1:aa'; 'Data\Scripts\MCM.pex' = '1155:' + ('cd' * 32) }
    $gone = @{ 'Data\Scripts\IED.pex' = 'always'; 'Data\Interface\racesex_menu.swf' = 'removed'; 'Data\meshes\old.nif' = 'removed' }
    Invoke-Expression $block
    Yes 'every file goes into the record as gone' (@($map.Keys | Where-Object { $gone.ContainsKey($_) -or $now.ContainsKey($_) -or $_ -eq 'Data\Scripts\IED.pex' }).Count -eq 165)
    Yes '  at the sha256 we shipped' ($gone['Data\Scripts\MCM_ConfigBase.pex'] -eq '0bf7f4e533da9e784dad8f70fadac99f5830e9a70a4ec6489e5679f489ea7d85')
    Yes '  a removed entry for one becomes its sha256, so only those bytes are taken out' ($gone['Data\Interface\racesex_menu.swf'] -eq 'ab3901335a28bbe53b360ce73be4dee5e74190c1efbb447ce22004f0638280e9')
    Yes '  except a file this release ships, which is its own again' (-not $gone.ContainsKey('Data\Scripts\MCM.pex'))
    Yes '  and one Ship-Rules deletes everywhere stays always' ($gone['Data\Scripts\IED.pex'] -eq 'always')
    # 165 of the record, less the one the release ships, plus the one that was there.
    Yes '  and nothing else on the list moves' ($gone['Data\meshes\old.nif'] -eq 'removed' -and $gone.Count -eq 165)

    function Die($m) { throw "STOP $m" }
    foreach ($k in @($gone.Keys)) { $now[':gone:' + $k] = [string]$gone[$k] }
    foreach ($g in 'no bethesda in the record', 'no one machine''s files in the record') {
        $guard = Get-Block $pub $g
        Yes "the record guard ($g) is in Publish-Update.ps1" ($null -ne $guard)
        if ($guard) { Yes "  and passes the record with every one of them gone" ((Refusal { Invoke-Expression $guard }) -eq '') }
    }
}

# ---- 4. the launcher -----------------------------------------------------------
$sync = Get-Content -LiteralPath $SyncPath -Raw
Yes 'the launcher reads a sha256 gone entry' ($sync -match 'bool byHash = IsSha\(g\.Value\);')
Yes '  leaves it when Vortex deploys the path' ($sync -match 'if \(!always\)\s*\{\s*if \(deployed == null\) deployed = DeployedNow\(cfg\);\s*if \(deployed\.Contains\(rel\)\) \{ shared\+\+; continue; \}')
Yes '  and deletes it only while the bytes match' ($sync -match 'if \(!string\.Equals\(Sha256\(full\), g\.Value, StringComparison\.OrdinalIgnoreCase\)\)\s*continue;')

$leaks = Get-Content -LiteralPath (Join-Path $Repo 'launcher\app\Leaks.cs') -Raw
$m = [regex]::Match($leaks, '(?s)static readonly string\[\]\[\] OtherServer = \{(.*?)\n        \};')
Yes 'Leaks.cs has the other server''s file by shape (OtherServer)' $m.Success
Yes '  the haybale: the weapons folder, its leaf, its size and the sha256 it shipped at' ($m.Groups[1].Value -match '"Data\\\\meshes\\\\weapons", "_haybale\.nif", "44541",\s*"88c2739744b8fc951f103eedea30ccfa9a83cc525dfc5d349c56054c7798c6c3"')
$clean = [regex]::Match($leaks, '(?s)static string CleanOtherServer\(\).*?\n        \}').Value
Yes '  taken out of Thornswood''s own folder only, never the Steam copy' ($clean -match '(?s)bool own;\s*try \{ own = OwnGame\.Active; \}.*?if \(!own\) return null;.*?Path\.Combine\(OwnGame\.Folder, s\[0\]\)' -and $clean -notmatch 'Paths\.Game|OwnGame\.Source|SteamCopy')
Yes '  only a file named for the prefix folder it sits in' ($clean -match 'Path\.Combine\(sub, Path\.GetFileName\(sub\) \+ s\[1\]\)')
Yes '  only at the size and bytes it shipped as, this folder''s name for it only' ($clean -match 'Length != long\.Parse\(s\[2\]\)' -and $clean -match 'Sha256\(p\), s\[3\]' -and $clean -match 'OwnGame\.DropName\(p\);')
Yes '  and Leaks.Clean, which runs at every start, calls it' ([regex]::Match($leaks, '(?s)public static string Clean\(Config cfg\).*?\n        \}').Value -match 'CleanOtherServer\(\)')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
