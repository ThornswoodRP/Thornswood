<#
  test-6244-modlist-install.ps1

      pwsh -NoProfile -File .\tests\test-6244-modlist-install.ps1

  launcher\app\ModlistInstall.cs, the launcher's reader of the collection's
  Wabbajack modlist and the Mod Organizer 2 install it makes from it (#6244).

  WHY. The launcher will install the mods from the modlist each Release
  carries (records\collection-modlist.wabbajack) instead of from Vortex. What
  it writes into <Root>\Mods has to be every file the modlist names, each one
  held to its hash, and nothing a modlist could name outside that folder. So
  a modlist the writer (scripts\release\WabbajackModlist.cs) makes has to
  install whole, and one that names anything the launcher does not take has
  to stop before a file is written.

  WHAT IT HOLDS, on a modlist the writer makes from two zip archives here:
    I  it reads (archives, files, version), and installs: each file from its
       archive at its path, found whatever the case of the path in the
       archive; the patched file as the patch makes it; the inline files; the
       remapped file with the game, MO2 and downloads folders put in, in each
       of the three ways the format writes them; a run again writes nothing,
       and puts back a file that was changed; an archive not there, or there
       with other bytes, stops the install before anything is written, naming
       the mod and file on Nexus; and records\collection-modlist.wabbajack,
       the modlist every merge release carries, reads whole for the revision
       records\collection-plugins.json names;
    R  the read stops, naming it, on a directive kind it does not take, a
       path that leaves the install (.., a drive, a rooted path, a name
       Windows refuses), two files at one path whatever their case, an inline
       file whose bytes are not its hash, a file taken from an archive the
       modlist does not list, a game that is not Skyrim Special Edition, a
       download that is not GitHub over https, and a file that is not a zip;
    O  a patch whose result is not the file it names, or that copies past the
       end of the old file, is refused;
    T  an install takes out of the modlist's mod folders what the modlist no
       longer names there (an earlier revision's file, a .part), and leaves
       other mod folders and the profile alone;
    K  a settings file (.ini, .toml) in a mod that the person changed since the
       last whole install wrote it is kept as they left it, from an archive
       or inline, and said; one still as that install wrote it, any other
       file changed, and every file when the last copy is not known, take
       the modlist's; a deleted one comes back; a mod's meta.ini is not one;
    D  the record of what goes into the game folder (ModlistSetup.Deployment):
       a mod's files under Data and its Root folder's beside the game, the mod
       higher in the profile's modlist.txt winning a shared path, a switched
       off mod and meta.ini left out, and no modlist.txt refused; its first
       line names the revision, which OwnGame.ModsRevision and
       Checks.CollectionRevision read for an install in Mod Organizer 2;
    U  the window installs the modlist of the Release the channel is on, off
       its thread with a Stop, from the collection card and button once the
       mods come from Mod Organizer 2, and offered beside Vortex's until then
       (read from the source, which cannot be drawn here).

  Builds the launcher from its project with the writer beside it
  (tests\Launcher-Csc.ps1).
  Writes only under a folder of its own in the temp folder, removed at the end.
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
# The whole launcher as its project builds it, with the writer beside it, so
# both name files by the launcher's one XxHash64.
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')
[void](Add-LauncherType -Launcher -File (P 'scripts/release/WabbajackModlist.cs'))

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-6244i-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
$utf8 = New-Object Text.UTF8Encoding($false)

# A zip archive holding the named entries, its bytes as given.
function New-Zip([string]$path, [hashtable]$files) {
    $fs = [IO.File]::Create($path)
    try {
        $za = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($k in ($files.Keys | Sort-Object)) {
                $st = $za.CreateEntry($k).Open()
                try { $b = [byte[]]$files[$k]; $st.Write($b, 0, $b.Length) } finally { $st.Dispose() }
            }
        } finally { $za.Dispose() }
    } finally { $fs.Dispose() }
}
function Bytes([string]$s) { return ,([byte[]]$utf8.GetBytes($s)) }
function HashOf([byte[]]$b) { return [Thornswood.XxHash64]::OfBytes($b) }

# The message a read or an install stopped with, or '' when it did not stop.
function Stop-Of([scriptblock]$run) {
    try { & $run | Out-Null; return '' }
    catch {
        $e = $_.Exception
        while ($e -and -not ($e -is [Thornswood.ModlistStop])) { $e = $e.InnerException }
        if ($e) { return $e.Message }
        return 'not a ModlistStop: ' + $_.Exception.Message
    }
}

try {
    $dl = Join-Path $T 'downloads'
    New-Item -ItemType Directory -Path $dl -Force | Out-Null

    # ------------------------------------------------------------- fixture ----
    # A plugin of 64 KiB and the same with a few bytes changed in its middle,
    # so the patch copies most of it from the old file.
    $espOld = New-Object byte[] 65536
    (New-Object Random 6244).NextBytes($espOld)
    $espNew = [byte[]]$espOld.Clone()
    for ($i = 30000; $i -lt 30016; $i++) { $espNew[$i] = [byte](255 - $espNew[$i]) }
    $mesh = [byte[]](0..255 | ForEach-Object { [byte]$_ })
    $tex = Bytes 'DDS texture'
    New-Zip (Join-Path $dl 'Mod One-100-1-0.zip') @{ 'Data/Meshes/One.nif' = $mesh; 'data/Textures/One.dds' = $tex }
    New-Zip (Join-Path $dl 'Mod Two-200-2-0.zip') @{ 'Two.esp' = $espOld }
    $a1 = Join-Path $dl 'Mod One-100-1-0.zip'
    $a2 = Join-Path $dl 'Mod Two-200-2-0.zip'
    $h1 = [Thornswood.XxHash64]::OfFile($a1)
    $h2 = [Thornswood.XxHash64]::OfFile($a2)

    $w = New-Object Thornswood.Layout.Modlist
    $w.Name = 'Thornswood'; $w.Version = '8.0.0.0'
    $w.AddNexusArchive('Mod One-100-1-0.zip', (Get-Item $a1).Length, $h1, 'skyrimspecialedition', 100, 1000, 'Mod One', '1.0')
    $w.AddNexusArchive('Mod Two-200-2-0.zip', (Get-Item $a2).Length, $h2, 'skyrimspecialedition', 200, 2000, 'Mod Two', '2.0')
    $w.FromArchive($h1, 'Data\Meshes\One.nif', (HashOf $mesh), $mesh.Length, 'mods\Mod One\Meshes\One.nif')
    # The archive spells it data\, the modlist Data\: a zip's case is not the modlist's.
    $w.FromArchive($h1, 'Data\Textures\One.dds', (HashOf $tex), $tex.Length, 'mods\Mod One\Textures\One.dds')
    $w.PatchedFromArchive($h2, 'Two.esp', (HashOf $espOld), [Thornswood.Layout.OctoDelta]::Make($espOld, $espNew), (HashOf $espNew), $espNew.Length, 'mods\Mod Two\Two.esp')
    $plugins = Bytes "*Two.esp`r`n"
    $w.Inline($plugins, 'profiles\Thornswood\plugins.txt', $false)
    $ini = Bytes "[General]`r`ngamePath=@ByteArray({--||GAME_PATH_MAGIC_DOUBLE_BACK||--})`r`nbase={--||MO2_PATH_MAGIC_BACK||--}`r`ndl={--||DOWNLOAD_PATH_MAGIC_FORWARD||--}`r`n"
    $w.Inline($ini, 'ModOrganizer.ini', $true)
    $good = Join-Path $T 'good.wabbajack'
    $w.Save($good)

    # ------------------------------------------------------------------ I ----
    $m = [Thornswood.CollectionModlist]::Read($good)
    Yes 'I1 the modlist the writer makes reads: two archives, five files, its version' ($m.Archives.Count -eq 2 -and $m.Files.Count -eq 5 -and $m.Version -eq '8.0.0.0' -and $m.Archives[0].Kind -eq 'nexus') ("$($m.Archives.Count) archives, $($m.Files.Count) files, version $($m.Version)")

    $game = Join-Path $T 'Game'
    $mo2 = Join-Path $T 'Mods'
    $said = New-Object Collections.Generic.List[string]
    $n = [Thornswood.ModlistInstall]::Install($m, $dl, $mo2, $game, [Thornswood.ModlistInstall+Unpack]{ param($a, $i) [Thornswood.ModlistInstall]::UnpackZip($a, $i) }, [Action[string]]{ param($s) $said.Add($s) }, $null)
    function At([string]$rel) { return (Join-Path $mo2 ($rel -replace '\\', [IO.Path]::DirectorySeparatorChar)) }
    function Same([string]$rel, [byte[]]$want) { $f = At $rel; return ((Test-Path -LiteralPath $f -PathType Leaf) -and [Linq.Enumerable]::SequenceEqual([byte[]][IO.File]::ReadAllBytes($f), $want)) }
    Yes "I2 it writes all five files ($n)" ($n -eq 5)
    Yes 'I3 each file from its archive is at its path, its bytes the archive''s, whatever the case in the zip' ((Same 'mods\Mod One\Meshes\One.nif' $mesh) -and (Same 'mods\Mod One\Textures\One.dds' $tex))
    Yes 'I4 the patched file is the one the patch makes' (Same 'mods\Mod Two\Two.esp' $espNew)
    Yes 'I5 the inline file is the modlist''s own copy' (Same 'profiles\Thornswood\plugins.txt' $plugins)
    $iniText = if (Test-Path -LiteralPath (At 'ModOrganizer.ini')) { [IO.File]::ReadAllText((At 'ModOrganizer.ini')) } else { '' }
    $back = { param($p) [IO.Path]::GetFullPath($p).TrimEnd('\', '/').Replace('/', '\') }
    $gb = & $back $game; $mb = & $back $mo2; $db = & $back $dl
    Yes 'I6 the remapped file has the game, MO2 and downloads folders put in, doubled, back and forward' ($iniText -notmatch 'PATH_MAGIC' -and $iniText.Contains('gamePath=@ByteArray(' + $gb.Replace('\', '\\') + ')') -and $iniText.Contains('base=' + $mb + "`r`n") -and $iniText.Contains('dl=' + $db.Replace('\', '/') + "`r`n")) $iniText
    Yes 'I7 it says each archive it installed from by its mod and file on Nexus' ($said.Count -eq 2 -and ($said -join '|').Contains('Mod One (mod 100, file 1000): 2 files'))
    Yes 'I8 and leaves no unpack folder or .part file behind' (-not (Test-Path -LiteralPath (Join-Path $mo2 '.unpack')) -and @(Get-ChildItem -LiteralPath $mo2 -Recurse -Filter '*.part').Count -eq 0)

    $n2 = [Thornswood.ModlistInstall]::Install($m, $dl, $mo2, $game, [Thornswood.ModlistInstall+Unpack]{ param($a, $i) throw 'unpacked again' }, $null, $null)
    Yes "I9 a run again writes nothing and unpacks nothing ($n2)" ($n2 -eq 0)
    [IO.File]::WriteAllBytes((At 'mods\Mod One\Meshes\One.nif'), [byte[]](1, 2, 3))
    [IO.File]::WriteAllText((At 'ModOrganizer.ini'), 'edited')
    $n3 = [Thornswood.ModlistInstall]::Install($m, $dl, $mo2, $game, [Thornswood.ModlistInstall+Unpack]{ param($a, $i) [Thornswood.ModlistInstall]::UnpackZip($a, $i) }, $null, $null)
    Yes "I10 and puts back a file that was changed, and the remapped file ($n3)" ($n3 -eq 2 -and (Same 'mods\Mod One\Meshes\One.nif' $mesh) -and ([IO.File]::ReadAllText((At 'ModOrganizer.ini')) -eq $iniText))

    # ------------------------------------------------------------------ T ----
    # What an earlier revision left in a mod folder goes; what is not the
    # modlist's mod folders stays.
    New-Item -ItemType Directory -Force -Path (At 'mods\Mod One\Stale'), (At 'mods\Mine') | Out-Null
    [IO.File]::WriteAllText((At 'mods\Mod One\Meshes\Old.nif'), 'old')
    [IO.File]::WriteAllText((At 'mods\Mod One\Stale\deep.txt'), 'old')
    [IO.File]::WriteAllText((At 'mods\Mod Two\Two.esp.part'), 'cut short')
    [IO.File]::WriteAllText((At 'mods\Mine\Mine.esp'), 'mine')
    [IO.File]::WriteAllText((At 'profiles\Thornswood\extra.txt'), 'kept')
    $said.Clear()
    $n4 = [Thornswood.ModlistInstall]::Install($m, $dl, $mo2, $game, [Thornswood.ModlistInstall+Unpack]{ param($a, $i) throw 'unpacked again' }, [Action[string]]{ param($s) $said.Add($s) }, $null)
    Yes "T1 a file in one of the modlist's mod folders that it does not name is taken out, a .part too, and says how many ($n4, $($said -join '|'))" ($n4 -eq 0 -and -not (Test-Path -LiteralPath (At 'mods\Mod One\Meshes\Old.nif')) -and -not (Test-Path -LiteralPath (At 'mods\Mod Two\Two.esp.part')) -and ($said -join '|').Contains('3 files the modlist no longer has'))
    Yes 'T2 a folder left empty goes with it' (-not (Test-Path -LiteralPath (At 'mods\Mod One\Stale')))
    Yes 'T3 a mod folder the modlist does not name, and the profile, are left as they are' ((Test-Path -LiteralPath (At 'mods\Mine\Mine.esp')) -and (Test-Path -LiteralPath (At 'profiles\Thornswood\extra.txt')))
    Yes 'T4 and every file the modlist names is still there' ((Same 'mods\Mod One\Meshes\One.nif' $mesh) -and (Same 'mods\Mod One\Textures\One.dds' $tex) -and (Same 'mods\Mod Two\Two.esp' $espNew))

    # ------------------------------------------------------------------ K ----
    # Two revisions of a mod with settings files. The person changes some
    # after the first install; the second keeps what they changed.
    $k1 = @{ kept = (Bytes "[A]`r`nx=1`r`n"); taken = (Bytes "[B]`r`ny=1`r`n"); esp = (Bytes 'K plugin 1'); inl = (Bytes "a = 1`n") }
    $k2 = @{ kept = (Bytes "[A]`r`nx=2`r`n"); taken = (Bytes "[B]`r`ny=2`r`n"); esp = (Bytes 'K plugin 2'); inl = (Bytes "a = 2`n") }
    function New-K([hashtable]$v, [string]$name) {
        $zip = Join-Path $dl "$name.zip"
        New-Zip $zip @{ 'Kept.ini' = $v.kept; 'Taken.ini' = $v.taken; 'K.esp' = $v.esp }
        $hz = [Thornswood.XxHash64]::OfFile($zip)
        $wk = New-Object Thornswood.Layout.Modlist
        $wk.Name = 'Thornswood'; $wk.Version = '8.0.0.0'
        $wk.AddNexusArchive("$name.zip", (Get-Item $zip).Length, $hz, 'skyrimspecialedition', 300, 3000, 'Mod K', '1.0')
        $wk.FromArchive($hz, 'Kept.ini', (HashOf $v.kept), $v.kept.Length, 'mods\Mod K\SKSE\Plugins\Kept.ini')
        $wk.FromArchive($hz, 'Taken.ini', (HashOf $v.taken), $v.taken.Length, 'mods\Mod K\SKSE\Plugins\Taken.ini')
        $wk.FromArchive($hz, 'K.esp', (HashOf $v.esp), $v.esp.Length, 'mods\Mod K\K.esp')
        $wk.Inline($v.inl, 'mods\Mod K\SKSE\Plugins\K.toml', $false)
        $wk.Inline((Bytes "[General]`r`nversion=$name`r`n"), 'mods\Mod K\meta.ini', $false)
        $out = Join-Path $T "$name.wabbajack"
        $wk.Save($out)
        return [Thornswood.CollectionModlist]::Read($out)
    }
    function Wrote([hashtable]$v) {
        $d = New-Object 'Collections.Generic.Dictionary[string,uint64]' ([StringComparer]::OrdinalIgnoreCase)
        $d['mods\Mod K\SKSE\Plugins\Kept.ini'] = (HashOf $v.kept); $d['mods\Mod K\SKSE\Plugins\Taken.ini'] = (HashOf $v.taken)
        $d['mods\Mod K\K.esp'] = (HashOf $v.esp); $d['mods\Mod K\SKSE\Plugins\K.toml'] = (HashOf $v.inl)
        return $d
    }
    $unzip = [Thornswood.ModlistInstall+Unpack]{ param($a, $i) [Thornswood.ModlistInstall]::UnpackZip($a, $i) }
    $mk1 = New-K $k1 'K-1'; $mk2 = New-K $k2 'K-2'
    $mk = Join-Path $T 'Mods-k'
    function KAt([string]$rel) { return (Join-Path $mk ($rel -replace '\\', [IO.Path]::DirectorySeparatorChar)) }
    function KSame([string]$rel, [byte[]]$want) { $f = KAt $rel; return ((Test-Path -LiteralPath $f -PathType Leaf) -and [Linq.Enumerable]::SequenceEqual([byte[]][IO.File]::ReadAllBytes($f), $want)) }
    [void][Thornswood.ModlistInstall]::Install($mk1, $dl, $mk, $game, $unzip, $null, $null)
    $mine = Bytes "[A]`r`nx=1`r`nmine=1`r`n"; $mineT = Bytes "a = 1`nmine = 1`n"; $mineE = Bytes 'my plugin'; $mineM = Bytes "[General]`r`nnotes=mine`r`n"
    [IO.File]::WriteAllBytes((KAt 'mods\Mod K\SKSE\Plugins\Kept.ini'), $mine)
    [IO.File]::WriteAllBytes((KAt 'mods\Mod K\SKSE\Plugins\K.toml'), $mineT)
    [IO.File]::WriteAllBytes((KAt 'mods\Mod K\K.esp'), $mineE)
    [IO.File]::WriteAllBytes((KAt 'mods\Mod K\meta.ini'), $mineM)
    $said.Clear()
    $nk = [Thornswood.ModlistInstall]::Install($mk2, $dl, $mk, $game, $unzip, [Action[string]]{ param($s) $said.Add($s) }, (Wrote $k1))
    Yes "K1 a settings file the person changed since the last install is kept, from an archive and inline ($nk)" ((KSame 'mods\Mod K\SKSE\Plugins\Kept.ini' $mine) -and (KSame 'mods\Mod K\SKSE\Plugins\K.toml' $mineT))
    Yes 'K2 one still as the last install wrote it takes the new copy' (KSame 'mods\Mod K\SKSE\Plugins\Taken.ini' $k2.taken)
    Yes 'K3 a plugin the person changed, and the mod''s meta.ini, take the modlist''s copy' ((KSame 'mods\Mod K\K.esp' $k2.esp) -and (KSame 'mods\Mod K\meta.ini' (Bytes "[General]`r`nversion=K-2`r`n")) -and $nk -eq 3)
    $kSaid = ($said | Where-Object { $_.StartsWith('Kept ') }) -join '|'
    Yes 'K4 and it says which it kept, and that deleting one takes the modlist''s copy' ($kSaid.Contains('Kept 2 settings files you changed') -and $kSaid.Contains('mods\Mod K\SKSE\Plugins\Kept.ini') -and $kSaid.Contains('Delete one')) $kSaid
    $nk = [Thornswood.ModlistInstall]::Install($mk2, $dl, $mk, $game, [Thornswood.ModlistInstall+Unpack]{ param($a, $i) throw 'unpacked again' }, $null, (Wrote $k2))
    Yes "K5 run again with the record that install wrote, they are still kept and nothing is unpacked ($nk)" ($nk -eq 0 -and (KSame 'mods\Mod K\SKSE\Plugins\Kept.ini' $mine) -and (KSame 'mods\Mod K\SKSE\Plugins\K.toml' $mineT))
    Remove-Item -LiteralPath (KAt 'mods\Mod K\SKSE\Plugins\Kept.ini')
    [void][Thornswood.ModlistInstall]::Install($mk2, $dl, $mk, $game, $unzip, $null, (Wrote $k2))
    Yes 'K6 a kept one the person deletes comes back as the modlist''s' (KSame 'mods\Mod K\SKSE\Plugins\Kept.ini' $k2.kept)
    [void][Thornswood.ModlistInstall]::Install($mk2, $dl, $mk, $game, $unzip, $null, $null)
    Yes 'K7 with no last copy known, a changed one takes the modlist''s' (KSame 'mods\Mod K\SKSE\Plugins\K.toml' $k2.inl)
    $editable = @('mods\A\x.ini', 'mods\A\SKSE\Plugins\y.TOML', 'mods\A\Root\z.ini') | Where-Object { [Thornswood.ModlistInstall]::Editable($_) }
    $not = @('mods\A\meta.ini', 'mods\A\x.esp', 'ModOrganizer.ini', 'profiles\Thornswood\Skyrim.ini') | Where-Object { [Thornswood.ModlistInstall]::Editable($_) }
    Yes 'K8 a settings file is an .ini or .toml in a mod''s folder; meta.ini, plugins and files outside the mods are not' ($editable.Count -eq 3 -and $not.Count -eq 0) (($editable + $not) -join ', ')

    # ------------------------------------------------------------------ D ----
    # The record of what goes into the game folder (ModlistSetup.Deployment).
    $wd = New-Object Thornswood.Layout.Modlist
    $wd.Name = 'Thornswood'; $wd.Version = '8.0.0.0'
    $wd.AddNexusArchive('A.zip', 10, 11, 'skyrimspecialedition', 1, 1, 'A', '1')
    $dds1 = Bytes 'high'; $dds2 = Bytes 'low'; $ldr = Bytes 'loader'; $pex = Bytes 'pex'; $off = Bytes 'off'
    $wd.FromArchive(11, 'a\x.dds', (HashOf $dds1), $dds1.Length, 'mods\High\textures\x.dds')
    $wd.FromArchive(11, 'b\x.dds', (HashOf $dds2), $dds2.Length, 'mods\Low\textures\x.dds')
    $wd.FromArchive(11, 'b\y.dds', (HashOf $dds2), $dds2.Length, 'mods\Low\textures\y.dds')
    $wd.FromArchive(11, 'c\loader.exe', (HashOf $ldr), $ldr.Length, 'mods\SKSE\Root\skse64_loader.exe')
    $wd.FromArchive(11, 'c\x.pex', (HashOf $pex), $pex.Length, 'mods\SKSE\Scripts\x.pex')
    $wd.FromArchive(11, 'd\off.esp', (HashOf $off), $off.Length, 'mods\Off\off.esp')
    $wd.Inline((Bytes "[General]`r`n"), 'mods\Low\meta.ini', $false)
    $wd.Inline((Bytes "# This file was automatically generated by Mod Organizer.`r`n+High`r`n+SKSE`r`n-Off`r`n+Low`r`n"), 'profiles\Thornswood\modlist.txt', $false)
    $dep = Join-Path $T 'deployment.wabbajack'
    $wd.Save($dep)
    $dm = [Thornswood.CollectionModlist]::Read($dep)
    # ModlistSetup is the launcher's own (internal), so it is called by reflection.
    $deployment = [Thornswood.ModlistInstall].Assembly.GetType('Thornswood.ModlistSetup', $true).GetMethod('Deployment')
    $lines = @($deployment.Invoke($null, [object[]]@($dm, 'abc')))
    $want = @('modlist=abc revision=8',
        ('Data\Scripts\x.pex|SKSE|Scripts\x.pex|' + (HashOf $pex).ToString('x16') + '|3'),
        ('Data\textures\x.dds|High|textures\x.dds|' + (HashOf $dds1).ToString('x16') + '|4'),
        ('Data\textures\y.dds|Low|textures\y.dds|' + (HashOf $dds2).ToString('x16') + '|3'),
        ('skse64_loader.exe|SKSE|Root\skse64_loader.exe|' + (HashOf $ldr).ToString('x16') + '|6'))
    Yes 'D1 each file of a mod goes under Data, a Root folder''s beside the game, with its mod, hash and size, in path order' (($lines -join "`n") -eq ($want -join "`n")) ($lines -join ' / ')
    Yes 'D2 where two mods have one path the one higher in modlist.txt has it' ($lines -contains $want[2] -and -not ($lines -match '\|Low\|textures\\x\.dds'))
    Yes 'D3 a mod modlist.txt switches off, and a meta.ini, are not in it' (-not ($lines -match '\|Off\|') -and -not ($lines -match 'meta\.ini'))
    $wn = New-Object Thornswood.Layout.Modlist
    $wn.Name = 'Thornswood'; $wn.Version = '8.0.0.0'
    $wn.Inline((Bytes 'x'), 'ModOrganizer.ini', $false)
    $noOrder = Join-Path $T 'no-order.wabbajack'
    $wn.Save($noOrder)
    $why = Stop-Of { $deployment.Invoke($null, [object[]]@([Thornswood.CollectionModlist]::Read($noOrder), 'abc')) }
    Yes 'D4 a modlist with no profile modlist.txt stops, saying the order of its mods is not known' ($why.Contains('order of its mods is not known')) $why

    # The modlist every merge release carries makes a record too: every file
    # once, the script extender's loader beside the game, the plugins in Data.
    $recLines = @($deployment.Invoke($null, [object[]]@([Thornswood.CollectionModlist]::Read((Join-Path $Repo 'records/collection-modlist.wabbajack')), 'abc')))
    $beside = @($recLines | Select-Object -Skip 1 | Where-Object { -not $_.StartsWith('Data\') })
    $paths = @($recLines | Select-Object -Skip 1 | ForEach-Object { $_.Split('|')[0].ToLowerInvariant() })
    Yes ("D5 records/collection-modlist.wabbajack makes a record of $($recLines.Count - 1) files, $($beside.Count) beside the game, the loader among them, each path once") ($recLines.Count -gt 1000 -and ($beside | Where-Object { $_.StartsWith('skse64_loader.exe|') }).Count -eq 1 -and @($paths | Select-Object -Unique).Count -eq $paths.Count -and ($recLines -match '^Data\\[^\\|]+\.esm\|').Count -gt 0)
    Yes 'D6 and its first line names the modlist and its revision, 8' ($recLines[0] -ceq 'modlist=abc revision=8') $recLines[0]

    # The revision the launcher reads off an install in Mod Organizer 2, in
    # place of Vortex's, once the mods come from there.
    $root6 = Join-Path $T 'root6'
    $mods6 = Join-Path $root6 'Mods'
    New-Item -ItemType Directory -Force -Path (Join-Path $mods6 'mods') | Out-Null
    $asm = [Thornswood.ModlistInstall].Assembly
    $rootField = $asm.GetType('Thornswood.Paths', $true).GetField('Root')
    $oldRoot = $rootField.GetValue($null)
    $rootField.SetValue($null, [string]$root6)
    try {
        $ownGame = $asm.GetType('Thornswood.OwnGame', $true)
        $modsRev = { $ownGame.GetMethod('ModsRevision').Invoke($null, @()) }
        $checksRev = { $asm.GetType('Thornswood.Checks', $true).GetMethod('CollectionRevision').Invoke($null, [object[]]@([Activator]::CreateInstance($asm.GetType('Thornswood.Config', $true)))) }
        $part = & $modsRev
        [IO.File]::WriteAllLines((Join-Path $mods6 'thornswood-deployment.txt'), [string[]]$recLines)
        $whole = & $modsRev; $viaChecks = & $checksRev
        [IO.File]::WriteAllLines((Join-Path $mods6 'thornswood-deployment.txt'), [string[]]@('modlist=abc'))
        $none = & $modsRev
        Yes "D7 an install in Mod Organizer 2 is on the revision its record names ($whole), and Checks reads that in place of Vortex's ($viaChecks)" ($whole -eq 8 -and $viaChecks -eq 8)
        Yes "D8 one part way, with no record, or a record naming no revision, is on none ($part, $none)" ($part -eq 0 -and $none -eq 0)
    } finally { $rootField.SetValue($null, $oldRoot) }

    # The window runs the install (ShellModlist.cs). It cannot be drawn
    # here, so what wires it is read.
    $app = Join-Path $Repo 'launcher/app'
    $sm = [IO.File]::ReadAllText((Join-Path $app 'ShellModlist.cs'))
    $sh = [IO.File]::ReadAllText((Join-Path $app 'Shell.cs'))
    $sc = [IO.File]::ReadAllText((Join-Path $app 'ShellCollection.cs'))
    $ms = [IO.File]::ReadAllText((Join-Path $app 'ModlistSetup.cs'))
    $vu = [IO.File]::ReadAllText((Join-Path $app 'VeloUpdate.cs'))
    Yes 'U1 the install takes the modlist of the Release the channel is on, held to its signed record' ($vu.Contains('ChannelOn = on;') -and $ms.Contains('VeloRecord.Modlist(m, file);') -and $sm.Contains('ModlistSetup.FromRelease(on, steps)') -and $sm.Contains('Updater.ChannelOn'))
    Yes 'U2 it runs off the window''s thread, says each step, and Stop stops it after the file it is on' ($sm.Contains('await Task.Run(') -and $sm.Contains('steps.Stop = () => modlistStop;') -and $sm.Contains('Dispatcher.UIThread.Post'))
    Yes 'U3 once the mods come from Mod Organizer 2 the collection card and button are its install''s, and Vortex''s card offers it until then' ($sc.Contains('if (OwnGame.FromMods) return ModlistStatusCard();') -and $sh.Contains('if (OwnGame.FromMods) { InstallModlist(); return; }') -and $sh.Contains('if (OwnGame.FromMods) return ModlistButtonText(mine);') -and $sm.Contains('if (!OwnGame.FromMods) diagCollection.Children.Add(ModlistOfferCard());'))

    $dl2 = Join-Path $T 'downloads-short'
    New-Item -ItemType Directory -Path $dl2 -Force | Out-Null
    Copy-Item -LiteralPath $a1 -Destination $dl2
    $fresh = Join-Path $T 'Mods-fresh'
    $why = Stop-Of { [Thornswood.ModlistInstall]::Install($m, $dl2, $fresh, $game, [Thornswood.ModlistInstall+Unpack]{ param($a, $i) [Thornswood.ModlistInstall]::UnpackZip($a, $i) }, $null, $null) }
    Yes 'I11 an archive not in downloads stops the install before anything is written, naming its mod and file' ($why.Contains('Mod Two (mod 200, file 2000)') -and -not (Test-Path -LiteralPath $fresh)) $why
    [IO.File]::WriteAllBytes((Join-Path $dl2 'Mod Two-200-2-0.zip'), [byte[]][IO.File]::ReadAllBytes($a1))
    $miss = [Thornswood.ModlistInstall]::Missing($m, $dl2)
    Yes 'I12 an archive there under its name with other bytes counts as not there' ($miss.Count -eq 1 -and $miss[0].ModId -eq 200)

    # The modlist every merge release carries reads whole, for the revision
    # the servers run.
    $cp = Get-Content -Raw -LiteralPath (Join-Path $Repo 'records/collection-plugins.json') | ConvertFrom-Json
    $rec = [Thornswood.CollectionModlist]::Read((Join-Path $Repo 'records/collection-modlist.wabbajack'))
    $http = @($rec.Archives | Where-Object { $_.Kind -eq 'http' })
    Yes ("I13 records/collection-modlist.wabbajack reads whole: revision $($cp.revision), $($rec.Archives.Count) archives, $($rec.Files.Count) files, Mod Organizer 2 from GitHub") ($rec.Version -eq ([string]$cp.revision + '.0.0.0') -and $rec.Archives.Count -gt 100 -and $rec.Files.Count -gt 1000 -and $http.Count -eq 1 -and $http[0].Url.StartsWith('https://github.com/ModOrganizer2/'))

    # ------------------------------------------------------------------ R ----
    # The good modlist with its JSON changed, as a new file.
    $script:k = 0
    function Changed([scriptblock]$edit) {
        $script:k++
        $out = Join-Path $T ("bad-$($script:k).wabbajack")
        $src = [IO.Compression.ZipFile]::OpenRead($good)
        $parts = @{}
        try {
            foreach ($z in $src.Entries) { $ms = New-Object IO.MemoryStream; $st = $z.Open(); try { $st.CopyTo($ms) } finally { $st.Dispose() }; $parts[$z.FullName] = $ms.ToArray() }
        } finally { $src.Dispose() }
        $parts['modlist'] = Bytes (& $edit ($utf8.GetString($parts['modlist'])))
        New-Zip $out $parts
        return $out
    }
    function Refused([string]$what, [scriptblock]$edit, [string]$says) {
        $f = Changed $edit
        $why = Stop-Of { [Thornswood.CollectionModlist]::Read($f) }
        Yes $what ($why -ne '' -and $why.Contains($says)) $why
    }
    Refused 'R1 a directive kind it does not take stops the read, naming it' { param($j) $j.Replace('"$type":"InlineFile"', '"$type":"CreateBSA"') } 'by CreateBSA, which the launcher does not take'
    Refused 'R2 a path that climbs out of the install' { param($j) $j.Replace('"To":"profiles\\Thornswood\\plugins.txt"', '"To":"..\\..\\plugins.txt"') } 'not a path inside the install'
    Refused 'R3 a path on a drive' { param($j) $j.Replace('"To":"profiles\\Thornswood\\plugins.txt"', '"To":"C:\\Windows\\plugins.txt"') } 'not a path inside the install'
    Refused 'R4 a rooted path' { param($j) $j.Replace('"To":"profiles\\Thornswood\\plugins.txt"', '"To":"\\Windows\\plugins.txt"') } 'not a path inside the install'
    Refused 'R5 a name Windows refuses' { param($j) $j.Replace('"To":"profiles\\Thornswood\\plugins.txt"', '"To":"profiles\\Thorns?wood\\plugins.txt"') } 'not a path inside the install'
    Refused 'R6 two files at one path, whatever their case' { param($j) $j.Replace('"To":"profiles\\Thornswood\\plugins.txt"', '"To":"modorganizer.INI"') } 'twice'
    Refused 'R7 an inline file whose bytes are not its hash' { param($j) $j -replace ('("Hash":")[^"]+(","Size":' + $plugins.Length + ',"SourceDataID")'), ('${1}' + [Thornswood.XxHash64]::Base64(42) + '${2}') } 'is not the file it names'
    Refused 'R8 a file taken from an archive the modlist does not list' { param($j) $j -replace '"ArchiveHashPath":\["[^"]+","Data\\\\Meshes', ('"ArchiveHashPath":["' + [Thornswood.XxHash64]::Base64(7) + '","Data\\Meshes') } 'from an archive it does not list'
    Refused 'R9 a file taken from a path that leaves its archive' { param($j) $j.Replace('"Data\\Meshes\\One.nif"', '"..\\One.nif"') } 'not inside its archive'
    Refused 'R10 a game that is not Skyrim Special Edition' { param($j) $j.Replace('"GameType":"SkyrimSpecialEdition"', '"GameType":"Fallout4"') } 'is for Fallout4'
    Refused 'R11 a Nexus file for another game' { param($j) $j.Replace('"GameName":"SkyrimSpecialEdition","ImageURL":null,"IsNSFW":false,"ModID":100', '"GameName":"Fallout4","ImageURL":null,"IsNSFW":false,"ModID":100') } 'no Skyrim Special Edition mod and file on Nexus'
    $wh = New-Object Thornswood.Layout.Modlist
    $wh.AddHttpArchive('ModOrganizer.7z', 10, 99, 'https://example.com/ModOrganizer.7z')
    $wh.Inline((Bytes 'x'), 'portable.txt', $false)
    $hf = Join-Path $T 'http.wabbajack'; $wh.Save($hf)
    $why = Stop-Of { [Thornswood.CollectionModlist]::Read($hf) }
    Yes 'R12 a download from anywhere but GitHub' ($why.Contains('downloads only from GitHub over https')) $why
    $wh = New-Object Thornswood.Layout.Modlist
    $wh.AddHttpArchive('ModOrganizer.7z', 10, 99, 'http://github.com/ModOrganizer2/modorganizer/releases/download/v2.5.2/ModOrganizer.7z')
    $wh.Inline((Bytes 'x'), 'portable.txt', $false)
    $wh.Save($hf)
    $why = Stop-Of { [Thornswood.CollectionModlist]::Read($hf) }
    Yes 'R13 or from GitHub not over https' ($why.Contains('downloads only from GitHub over https')) $why
    $nz = Join-Path $T 'not.wabbajack'; [IO.File]::WriteAllText($nz, 'not a zip')
    $why = Stop-Of { [Thornswood.CollectionModlist]::Read($nz) }
    Yes 'R14 a file that is not a zip' ($why.Contains('is not a modlist')) $why

    # ------------------------------------------------------------------ O ----
    $delta = [Thornswood.Layout.OctoDelta]::Make($espOld, $espNew)
    Yes "O1 a patch the writer makes, copying most of the old file ($($delta.Length) bytes), gives the new file" ($delta.Length -lt 8192 -and [Linq.Enumerable]::SequenceEqual([Thornswood.OctoDeltaApply]::Apply($espOld, $delta), $espNew))
    $other = [byte[]]$espOld.Clone(); $other[100] = [byte](255 - $other[100])
    $why = Stop-Of { [Thornswood.OctoDeltaApply]::Apply($other, $delta) }
    Yes 'O2 a patch put on other bytes, whose result is not the file it names, is refused' ($why.Contains('does not make the file it names')) $why
    $why = Stop-Of { [Thornswood.OctoDeltaApply]::Apply([byte[]](1, 2, 3), $delta) }
    Yes 'O3 a patch that copies past the end of the old file is refused' ($why.Contains('copies past the end')) $why
}
finally {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
