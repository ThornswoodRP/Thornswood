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
       end of the old file, is refused.

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
    $n = [Thornswood.ModlistInstall]::Install($m, $dl, $mo2, $game, [Thornswood.ModlistInstall+Unpack]{ param($a, $i) [Thornswood.ModlistInstall]::UnpackZip($a, $i) }, [Action[string]]{ param($s) $said.Add($s) })
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

    $n2 = [Thornswood.ModlistInstall]::Install($m, $dl, $mo2, $game, [Thornswood.ModlistInstall+Unpack]{ param($a, $i) throw 'unpacked again' }, $null)
    Yes "I9 a run again writes nothing and unpacks nothing ($n2)" ($n2 -eq 0)
    [IO.File]::WriteAllBytes((At 'mods\Mod One\Meshes\One.nif'), [byte[]](1, 2, 3))
    [IO.File]::WriteAllText((At 'ModOrganizer.ini'), 'edited')
    $n3 = [Thornswood.ModlistInstall]::Install($m, $dl, $mo2, $game, [Thornswood.ModlistInstall+Unpack]{ param($a, $i) [Thornswood.ModlistInstall]::UnpackZip($a, $i) }, $null)
    Yes "I10 and puts back a file that was changed, and the remapped file ($n3)" ($n3 -eq 2 -and (Same 'mods\Mod One\Meshes\One.nif' $mesh) -and ([IO.File]::ReadAllText((At 'ModOrganizer.ini')) -eq $iniText))

    $dl2 = Join-Path $T 'downloads-short'
    New-Item -ItemType Directory -Path $dl2 -Force | Out-Null
    Copy-Item -LiteralPath $a1 -Destination $dl2
    $fresh = Join-Path $T 'Mods-fresh'
    $why = Stop-Of { [Thornswood.ModlistInstall]::Install($m, $dl2, $fresh, $game, [Thornswood.ModlistInstall+Unpack]{ param($a, $i) [Thornswood.ModlistInstall]::UnpackZip($a, $i) }, $null) }
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
