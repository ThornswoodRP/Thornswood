<#
  test-6244-modlist-fetch.ps1

      pwsh -NoProfile -File .\tests\test-6244-modlist-fetch.ps1

  launcher\app\ModlistFetch.cs (#6244): the pinned 7-Zip the modlist install
  unpacks with, and the modlist's archives it downloads by address (Mod
  Organizer 2 from its GitHub release), both from GitHub only, through
  GitHub.cs's API calls (GitHub.TagOf and GitHub.SaveTo).

  WHY. The launcher will install the mods from the collection's modlist
  instead of from Vortex. Mod Organizer 2 and 14 of the collection's archives
  are not zips, so 7-Zip has to be on the machine, and what the launcher runs
  has to be the 7-Zip it pins, not whatever a download sent. Updates and
  downloads come from GitHub only (Patrick, 11 Nov 2026), and through its API,
  which answered on 9 Nov while github.com's download addresses did not.

  WHAT IT HOLDS, against a stand-in for GitHub's API on 127.0.0.1:
    S  SevenZip.Ensure downloads 7zr.exe and the installer from 7-Zip's
       Release, runs 7zr on the installer for 7z.exe and 7z.dll, and keeps
       just those two, each as pinned; a run again asks GitHub nothing; a
       download that is not the pinned file, an installer whose 7z.exe is not
       the pinned one, and 7zr failing each stop it, naming why, with nothing
       kept and no working folder left;
    U  SevenZip.With unpacks a 7z archive through 7-Zip, and the modlist
       install takes a 7z archive's files through it; a broken archive stops
       the install, naming it (with 7-Zip's own Linux build, which
       scripts\release\Get-SevenZip.ps1 puts in; SKIP where it is not);
    A  ModlistFetch.ByAddress downloads a modlist archive from the GitHub
       Release its address names and puts it in downloads under its name, so
       the install finds it; it refuses, keeping nothing under the name, a
       file whose bytes are not the modlist's (GitHub's sha256 matching), one
       whose size GitHub lists as other than the modlist's (before asking for
       the file), one GitHub's sha256 does not match (leaving no .part), an
       address that is not a file of a GitHub Release, and a list that names
       an asset address outside that repository;
    P  ModlistFetch.FromPlaces takes an archive already on this PC, under any
       name, into downloads under its own name once its size and xxHash64 are
       the modlist's: kept where it was in another manager's folder (Vortex's),
       moved out of the person's Downloads; a file of the size with other bytes
       is left alone, a folder that is not there is passed over, and what is
       still missing comes back in its order;
    V  ModlistFetch.VortexDownloads works out Vortex's downloads folder for
       Skyrim Special Edition the way Vortex does (its default, {USERDATA}
       and {USERNAME} in any case, a relative setting under Vortex's folder),
       and VortexProfileState.DownloadsSetting reads the setting out of a
       state.v2 that tests\fixtures\vortex-state-rows.py writes, or nothing
       when Vortex never changed it;
    H  ModlistFetch.ByHand opens the Nexus page of the first file still
       missing, takes each as it lands in the folder, then opens the next,
       until none is missing; a stop ends it with what is left, and an
       archive that is not a Nexus file is refused before any page opens.

  Builds the launcher from launcher\app\Thornswood.csproj with the modlist
  writer beside it (tests\Launcher-Csc.ps1) and calls these by reflection, with GitHub.OtherApi at the stand-in.
  Nothing leaves 127.0.0.1. Writes only under a folder of its own in the temp
  folder, removed at the end.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$detail = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red; if ($detail) { Write-Host "      $detail" } }
}
function Skip([string]$what) { Write-Host "SKIP  $what" -ForegroundColor Yellow }

Add-Type -AssemblyName System.IO.Compression.FileSystem
# A stand-in for GitHub's API: each path answers with the bytes it was given,
# 404 for the rest, and writes down each path it was asked.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public class TsModlistFetchStandIn
{
    TcpListener listener;
    public int Port;
    readonly Dictionary<string, byte[]> answers = new Dictionary<string, byte[]>();
    public readonly List<string> Seen = new List<string>();

    public void Answer(string path, byte[] body) { lock (answers) answers[path] = body; }
    public void Clear() { lock (answers) answers.Clear(); lock (Seen) Seen.Clear(); }
    public string[] Asked() { lock (Seen) return Seen.ToArray(); }

    public void Start()
    {
        listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var t = new Thread(Loop);
        t.IsBackground = true;
        t.Start();
    }

    public void Stop() { try { listener.Stop(); } catch (Exception) { } }

    void Loop()
    {
        while (true)
        {
            TcpClient c;
            try { c = listener.AcceptTcpClient(); } catch (Exception) { return; }
            try { Serve(c); } catch (Exception) { }
            finally { c.Close(); }
        }
    }

    void Serve(TcpClient c)
    {
        var s = c.GetStream();
        var sb = new StringBuilder();
        int b;
        while ((b = s.ReadByte()) >= 0)
        {
            sb.Append((char)b);
            if (sb.Length >= 4 && sb.ToString(sb.Length - 4, 4) == "\r\n\r\n") break;
        }
        string path = sb.ToString().Split(' ')[1];
        lock (Seen) Seen.Add(path);
        byte[] body;
        string status = "200 OK";
        lock (answers) if (!answers.TryGetValue(path, out body)) { status = "404 Not Found"; body = Encoding.UTF8.GetBytes("{\"message\":\"Not Found\"}"); }
        byte[] h = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + "\r\nContent-Length: " + body.Length + "\r\nX-RateLimit-Remaining: 50\r\nConnection: close\r\n\r\n");
        s.Write(h, 0, h.Length);
        s.Write(body, 0, body.Length);
        s.Flush();
    }
}
'@

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-6244f-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
New-Item -ItemType Directory -Path $T -Force | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
function Bytes([string]$s) { return ,([byte[]]$utf8.GetBytes($s)) }
function Sha([byte[]]$b) { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($b)).ToLowerInvariant() }
function New-Zip([string]$path, [hashtable]$files) {
    $fs = [IO.File]::Create($path)
    try {
        $za = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
        try { foreach ($k in ($files.Keys | Sort-Object)) { $st = $za.CreateEntry($k).Open(); try { $b = [byte[]]$files[$k]; $st.Write($b, 0, $b.Length) } finally { $st.Dispose() } } } finally { $za.Dispose() }
    } finally { $fs.Dispose() }
}
# The message a call stopped with (a ModlistStop), or '' when it did not stop.
function Stop-Of([scriptblock]$run) {
    try { & $run | Out-Null; return '' }
    catch {
        $e = $_.Exception
        while ($e -and $e.GetType().FullName -ne 'Thornswood.ModlistStop') { $e = $e.InnerException }
        if ($e) { return $e.Message }
        return 'not a ModlistStop: ' + $_.Exception.Message
    }
}

$srv = New-Object TsModlistFetchStandIn
$srv.Start()
try {
    Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
    # The whole launcher as its project builds it, with the modlist writer
    # beside it, so both name files by the launcher's one XxHash64.
    $asm = $null
    try { $asm = Add-LauncherType -Launcher -File (Join-Path $Repo 'scripts/release/WabbajackModlist.cs') } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'the launcher builds from its project, the way the build makes it, with the modlist writer' ($null -ne $asm)
    if ($null -eq $asm) { throw 'no launcher to hold' }

    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    $G = $asm.GetType('Thornswood.GitHub')
    $SZ = $asm.GetType('Thornswood.SevenZip')
    $MF = $asm.GetType('Thornswood.ModlistFetch')
    $PinT = $asm.GetType('Thornswood.SevenZip+Pin')
    $api = "http://127.0.0.1:$($srv.Port)/repos/"
    $G.GetField('OtherApi', $flags).SetValue($null, $api)
    function Forget { $srv.Clear(); [void]$G.GetMethod('Forget', $flags).Invoke($null, @()) }
    function New-Pin([string]$name, [byte[]]$b) {
        $p = [Activator]::CreateInstance($PinT)
        $PinT.GetField('Name').SetValue($p, $name); $PinT.GetField('Size').SetValue($p, [long]$b.Length); $PinT.GetField('Sha256').SetValue($p, (Sha $b))
        return $p
    }
    # A Release as GitHub's API gives it, its assets at this stand-in.
    function Release-Json([string]$repo, [string]$tag, $assets) {
        $list = @(foreach ($a in $assets) {
            '{"id":' + $a.id + ',"url":"' + $(if ($a.url) { $a.url } else { $api + $repo + '/releases/assets/' + $a.id }) + '","name":"' + $a.name + '","size":' + $a.size + ',"state":"uploaded","digest":"sha256:' + $a.sha + '"}'
        })
        return Bytes ('{"tag_name":"' + $tag + '","name":"' + $tag + '","draft":false,"prerelease":false,"published_at":"2025-08-03T00:00:00Z","assets":[' + ($list -join ',') + ']}')
    }

    # ------------------------------------------------------------------ S ----
    $unpacker = Bytes 'a stand-in for 7zr.exe'
    $exeB = Bytes 'a stand-in for 7z.exe'
    $dllB = Bytes 'a stand-in for 7z.dll'
    $instZip = Join-Path $T 'installer.zip'
    New-Zip $instZip @{ '7z.exe' = $exeB; '7z.dll' = $dllB; 'Uninstall.exe' = (Bytes 'not kept') }
    $installer = [IO.File]::ReadAllBytes($instZip)
    $SZ.GetField('Unpacker', $flags).SetValue($null, (New-Pin '7zr.exe' $unpacker))
    $SZ.GetField('Installer', $flags).SetValue($null, (New-Pin '7z2501-x64.exe' $installer))
    $kept = [Array]::CreateInstance($PinT, 2)
    $kept.SetValue((New-Pin '7z.exe' $exeB), 0); $kept.SetValue((New-Pin '7z.dll' $dllB), 1)
    $SZ.GetField('Kept', $flags).SetValue($null, $kept)

    # The runner the stand-in 7zr is: takes the named files out of the
    # installer (a zip here) into -o, or does what a case asks.
    $script:ran = @()
    $script:runMode = 'ok'
    $run = [Func[string, Collections.Generic.IList[string], Tuple[int, string]]] {
        param($exe, $argv)
        $script:ran += , ([string[]](@($exe) + @($argv)))
        if ($script:runMode -eq 'fail') { return [Tuple]::Create(2, 'ERROR: stand-in failure') }
        $out = (@($argv) | Where-Object { $_.StartsWith('-o') } | Select-Object -First 1).Substring(2)
        $arc = @($argv)[5]
        New-Item -ItemType Directory -Path $out -Force | Out-Null
        $za = [IO.Compression.ZipFile]::OpenRead($arc)
        try {
            foreach ($n in @($argv)[6..(@($argv).Count - 1)]) {
                $e = $za.GetEntry($n); $to = Join-Path $out $n
                [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $to, $true)
                if ($script:runMode -eq 'other' -and $n -eq '7z.exe') { [IO.File]::WriteAllText($to, 'another 7z.exe') }
            }
        } finally { $za.Dispose() }
        return [Tuple]::Create(0, '')
    }
    $realRun = $SZ.GetField('Run', $flags).GetValue($null)
    $SZ.GetField('Run', $flags).SetValue($null, $run)
    function Serve-7Zip([byte[]]$u, [byte[]]$i, [string]$iSha = '') {
        if (-not $iSha) { $iSha = Sha $i }
        $srv.Answer('/repos/ip7z/7zip/releases/tags/25.01', (Release-Json 'ip7z/7zip' '25.01' @(
            @{ id = 11; name = '7zr.exe'; size = $u.Length; sha = (Sha $u) },
            @{ id = 12; name = '7z2501-x64.exe'; size = $i.Length; sha = $iSha })))
        $srv.Answer('/repos/ip7z/7zip/releases/assets/11', $u)
        $srv.Answer('/repos/ip7z/7zip/releases/assets/12', $i)
    }
    $ensure = $SZ.GetMethod('Ensure', $flags)
    function Ensure([string]$tools) { return [string]$ensure.Invoke($null, @($tools, $null)) }

    Forget; Serve-7Zip $unpacker $installer
    $tools = Join-Path $T 'tools'
    $exe = Ensure $tools
    $dir = Join-Path $tools '7zip-25.01'
    Yes 'S1 7-Zip goes in from its Release: 7z.exe and 7z.dll as pinned, and nothing else kept' ($exe -eq (Join-Path $dir '7z.exe') -and [IO.File]::ReadAllText($exe) -eq 'a stand-in for 7z.exe' -and [IO.File]::ReadAllText((Join-Path $dir '7z.dll')) -eq 'a stand-in for 7z.dll' -and @(Get-ChildItem -LiteralPath $dir).Count -eq 2 -and @(Get-ChildItem -LiteralPath $tools).Count -eq 1) (@(Get-ChildItem -LiteralPath $tools -Recurse | ForEach-Object Name) -join ', ')
    $a0 = if ($script:ran.Count) { $script:ran[0] } else { @() }
    Yes 'S2 by running the downloaded 7zr on the installer for just 7z.exe and 7z.dll' ($script:ran.Count -eq 1 -and (Split-Path -Leaf $a0[0]) -eq '7zr.exe' -and $a0[1] -eq 'x' -and (Split-Path -Leaf $a0[6]) -eq '7z2501-x64.exe' -and $a0[7] -eq '7z.exe' -and $a0[8] -eq '7z.dll') ($a0 -join ' ')
    Yes 'S3 through the API: the Release by its tag, then each file by its asset address' ((@($srv.Asked()) -join ' ') -eq '/repos/ip7z/7zip/releases/tags/25.01 /repos/ip7z/7zip/releases/assets/11 /repos/ip7z/7zip/releases/assets/12') (@($srv.Asked()) -join ' ')
    Forget
    $exe2 = Ensure $tools
    Yes 'S4 a run again asks GitHub nothing' ($exe2 -eq $exe -and @($srv.Asked()).Count -eq 0 -and $script:ran.Count -eq 1)

    $t2 = Join-Path $T 'tools2'
    Forget; $other = Bytes 'another installer'; Serve-7Zip $unpacker $other
    $why = Stop-Of { Ensure $t2 }
    Yes 'S5 a download that is not the pinned file stops it, with nothing kept' ($why.Contains('7z2501-x64.exe from 7-Zip''s GitHub release is not the file the launcher pins') -and -not (Test-Path -LiteralPath (Join-Path $t2 '7zip-25.01')) -and -not (Test-Path -LiteralPath (Join-Path $t2 '7zip-25.01.fetch'))) $why
    Forget; Serve-7Zip $unpacker $installer; $script:runMode = 'other'
    $why = Stop-Of { Ensure $t2 }
    Yes 'S6 an installer whose 7z.exe is not the pinned one stops it, with nothing kept' ($why.Contains('7z.exe in 7-Zip''s installer is not the file the launcher pins') -and -not (Test-Path -LiteralPath (Join-Path $t2 '7zip-25.01')) -and -not (Test-Path -LiteralPath (Join-Path $t2 '7zip-25.01.fetch'))) $why
    Forget; Serve-7Zip $unpacker $installer; $script:runMode = 'fail'
    $why = Stop-Of { Ensure $t2 }
    Yes 'S7 7zr failing stops it, with what it said' ($why.Contains('exit 2') -and $why.Contains('stand-in failure') -and -not (Test-Path -LiteralPath (Join-Path $t2 '7zip-25.01'))) $why
    $script:runMode = 'ok'
    $SZ.GetField('Run', $flags).SetValue($null, $realRun)

    # ------------------------------------------------------------------ U ----
    $zz = $null
    if (-not $OnWindows) { $zz = (& pwsh -NoProfile -File (Join-Path $Repo 'scripts/release/Get-SevenZip.ps1') -Check 2>$null | Select-Object -Last 1) }
    if ($zz -and (Test-Path -LiteralPath $zz)) {
        $dlU = Join-Path $T 'dl-7z'; New-Item -ItemType Directory -Path $dlU -Force | Out-Null
        $src = Join-Path $T 'src7z'; New-Item -ItemType Directory -Path (Join-Path $src 'Data') -Force | Out-Null
        $esp = Bytes 'a plugin inside a 7z'
        [IO.File]::WriteAllBytes((Join-Path $src 'Data/Seven.esp'), $esp)
        $arc = Join-Path $dlU 'Seven-300-3-0.7z'
        Push-Location $src; try { & $zz a -bso0 -bsp0 $arc 'Data' | Out-Null } finally { Pop-Location }
        $ha = [Thornswood.XxHash64]::OfFile($arc)
        $w = New-Object Thornswood.Layout.Modlist
        $w.AddNexusArchive('Seven-300-3-0.7z', (Get-Item $arc).Length, $ha, 'skyrimspecialedition', 300, 3000, 'Seven', '3.0')
        $w.FromArchive($ha, 'Data\Seven.esp', [Thornswood.XxHash64]::OfBytes($esp), $esp.Length, 'mods\Seven\Seven.esp')
        $wf = Join-Path $T 'seven.wabbajack'; $w.Save($wf)
        $m = [Thornswood.CollectionModlist]::Read($wf)
        $with = $SZ.GetMethod('With', $flags).Invoke($null, @([string]$zz))
        $mo2 = Join-Path $T 'Mods-7z'
        $n = [Thornswood.ModlistInstall]::Install($m, $dlU, $mo2, (Join-Path $T 'Game'), $with, $null, $null)
        $got = Join-Path $mo2 (Join-Path 'mods' (Join-Path 'Seven' 'Seven.esp'))
        Yes 'U1 the install takes a 7z archive''s files through 7-Zip' ($n -eq 1 -and (Test-Path -LiteralPath $got) -and [IO.File]::ReadAllText($got) -eq 'a plugin inside a 7z')
        Remove-Item -LiteralPath $mo2 -Recurse -Force
        $broken = [IO.File]::ReadAllBytes($arc); [Array]::Clear($broken, 32, $broken.Length - 32)
        $wb = New-Object Thornswood.Layout.Modlist
        $hb = [Thornswood.XxHash64]::OfBytes($broken)
        [IO.File]::WriteAllBytes($arc, $broken)
        $wb.AddNexusArchive('Seven-300-3-0.7z', $broken.Length, $hb, 'skyrimspecialedition', 300, 3000, 'Seven', '3.0')
        $wb.FromArchive($hb, 'Data\Seven.esp', [Thornswood.XxHash64]::OfBytes($esp), $esp.Length, 'mods\Seven\Seven.esp')
        $wb.Save($wf)
        $mb = [Thornswood.CollectionModlist]::Read($wf)
        $why = Stop-Of { [Thornswood.ModlistInstall]::Install($mb, $dlU, $mo2, (Join-Path $T 'Game'), $with, $null, $null) }
        Yes 'U2 a broken archive stops the install, naming it and what 7-Zip said' ($why.Contains('7-Zip could not unpack Seven-300-3-0.7z (exit ')) $why
    } else {
        Skip 'U1 the install takes a 7z archive''s files through 7-Zip (7-Zip''s Linux build is not here: pwsh scripts/release/Get-SevenZip.ps1)'
        Skip 'U2 a broken archive stops the install, naming it'
    }

    # ------------------------------------------------------------------ A ----
    $mo2B = [byte[]](1..200 | ForEach-Object { [byte]$_ })
    $mo2Url = 'https://github.com/ModOrganizer2/modorganizer/releases/download/v2.5.2/Mod.Organizer-2.5.2.7z'
    function New-Http([string]$url, [byte[]]$b) {
        $a = New-Object Thornswood.ModlistArchive
        $a.Name = 'Mod.Organizer-2.5.2.7z'; $a.Size = $b.Length; $a.Hash = [Thornswood.XxHash64]::OfBytes($b); $a.Kind = 'http'; $a.Url = $url
        return $a
    }
    function Serve-Mo2([byte[]]$b, [long]$size = -1, [string]$sha = '', [string]$assetUrl = '') {
        if ($size -lt 0) { $size = $b.Length }
        if (-not $sha) { $sha = Sha $b }
        $srv.Answer('/repos/ModOrganizer2/modorganizer/releases/tags/v2.5.2', (Release-Json 'ModOrganizer2/modorganizer' 'v2.5.2' @(@{ id = 21; name = 'Mod.Organizer-2.5.2.7z'; size = $size; sha = $sha; url = $assetUrl })))
        $srv.Answer('/repos/ModOrganizer2/modorganizer/releases/assets/21', $b)
    }
    $byAddress = $MF.GetMethod('ByAddress', $flags)
    function By([Thornswood.ModlistArchive]$a, [string]$dl) { [void]$byAddress.Invoke($null, @($a, $dl, $null)) }
    $dlA = Join-Path $T 'dl-http'
    $mine = Join-Path $dlA 'Mod.Organizer-2.5.2.7z'

    Forget; Serve-Mo2 $mo2B
    $a = New-Http $mo2Url $mo2B
    By $a $dlA
    Yes 'A1 an archive by address comes from the Release its address names, into downloads under its name' ((Test-Path -LiteralPath $mine) -and [Linq.Enumerable]::SequenceEqual([byte[]][IO.File]::ReadAllBytes($mine), $mo2B) -and (@($srv.Asked()) -join ' ') -eq '/repos/ModOrganizer2/modorganizer/releases/tags/v2.5.2 /repos/ModOrganizer2/modorganizer/releases/assets/21' -and @(Get-ChildItem -LiteralPath $dlA).Count -eq 1) (@($srv.Asked()) -join ' ')
    $wm = New-Object Thornswood.Layout.Modlist
    $wm.AddHttpArchive('Mod.Organizer-2.5.2.7z', $mo2B.Length, $a.Hash, $mo2Url)
    $wm.Inline((Bytes 'x'), 'portable.txt', $false)
    $wmf = Join-Path $T 'mo2.wabbajack'; $wm.Save($wmf)
    Yes 'A2 so the install finds it there' ([Thornswood.ModlistInstall]::Missing([Thornswood.CollectionModlist]::Read($wmf), $dlA).Count -eq 0)
    Remove-Item -LiteralPath $mine

    $otherB = [byte[]]$mo2B.Clone(); $otherB[5] = 0
    Forget; Serve-Mo2 $otherB
    $why = Stop-Of { By $a $dlA }
    Yes 'A3 bytes GitHub vouches for that are not the modlist''s are not kept' ($why.Contains('is not the file the modlist names') -and @(Get-ChildItem -LiteralPath $dlA).Count -eq 0) $why
    Forget; Serve-Mo2 $mo2B ($mo2B.Length + 1)
    $why = Stop-Of { By $a $dlA }
    Yes 'A4 a size GitHub lists other than the modlist''s stops it before the file is asked for' ($why.Contains('and the modlist names ' + $mo2B.Length) -and @($srv.Asked()).Count -eq 1 -and @(Get-ChildItem -LiteralPath $dlA).Count -eq 0) $why
    Forget; Serve-Mo2 $mo2B -1 (Sha $otherB)
    $why = Stop-Of { By $a $dlA }
    Yes 'A5 a file GitHub''s own sha256 does not match is not kept, and leaves no .part' ($why.Contains('and GitHub lists it as') -and @(Get-ChildItem -LiteralPath $dlA).Count -eq 0) $why
    Forget; Serve-Mo2 $mo2B
    $why = Stop-Of { By (New-Http 'https://github.com/ModOrganizer2/modorganizer/archive/refs/heads/master.zip' $mo2B) $dlA }
    Yes 'A6 an address that is not a file of a GitHub Release is refused' ($why.Contains('which is not a file of a Release on GitHub') -and @($srv.Asked()).Count -eq 0) $why
    Forget; Serve-Mo2 $mo2B -1 '' 'http://127.0.0.1:9/elsewhere/21'
    $why = Stop-Of { By $a $dlA }
    Yes 'A7 a list naming an asset address outside that repository is refused' ($why.Contains('which is not one of ModOrganizer2/modorganizer''s Release files') -and @(Get-ChildItem -LiteralPath $dlA).Count -eq 0) $why

    # ------------------------------------------------------------------ P ----
    function New-Nexus([string]$name, [byte[]]$b, [long]$mod, [long]$file) {
        $a = New-Object Thornswood.ModlistArchive
        $a.Name = $name; $a.Size = $b.Length; $a.Hash = [Thornswood.XxHash64]::OfBytes($b); $a.Kind = 'nexus'; $a.Game = 'SkyrimSpecialEdition'; $a.ModId = $mod; $a.FileId = $file; $a.ModName = $name
        return $a
    }
    function Page-Of($a) { return [string]$MF.GetMethod('Page').Invoke($null, [object[]]@($a.psobject.BaseObject)) }
    $PlaceT = $asm.GetType('Thornswood.ModlistFetch+Place')
    function New-Place([string]$folder, [bool]$move) {
        $p = [Activator]::CreateInstance($PlaceT)
        $p.Folder = $folder; $p.Move = $move
        return $p
    }
    function Archives($list) {
        $l = New-Object 'Collections.Generic.List[Thornswood.ModlistArchive]'
        foreach ($x in $list) { $l.Add($x) }
        return ,$l.psobject.BaseObject
    }
    function Places($list) {
        $l = [Activator]::CreateInstance([Collections.Generic.List`1].MakeGenericType($PlaceT))
        foreach ($x in $list) { $l.Add($x) }
        return ,$l.psobject.BaseObject
    }
    $fromPlaces = $MF.GetMethods($flags) | Where-Object { $_.Name -eq 'FromPlaces' -and $_.IsPublic } | Select-Object -First 1
    function Take-From($missing, $places, [string]$dl) { $argv = [object[]]@((Archives $missing).psobject.BaseObject, (Places $places).psobject.BaseObject, [string]$dl, $null)
        return ,($fromPlaces.Invoke($null, $argv)) }

    $oneB = [byte[]](1..90 | ForEach-Object { [byte]($_ * 3 % 256) })
    $twoB = [byte[]](1..70 | ForEach-Object { [byte]($_ * 5 % 256) })
    $sameSizeB = [byte[]]$oneB.Clone(); $sameSizeB[0] = 9
    $threeB = [byte[]](1..50 | ForEach-Object { [byte]($_ * 7 % 256) })
    $one = New-Nexus 'One-100-1-0.7z' $oneB 100 1000
    $two = New-Nexus 'Two-200-2-0.zip' $twoB 200 2000
    $three = New-Nexus 'Three-300-3-0.rar' $threeB 300 3000
    $vx = Join-Path $T 'vortex-downloads'; $mydl = Join-Path $T 'my-downloads'; $dlP = Join-Path $T 'dl-places'
    New-Item -ItemType Directory -Path $vx, $mydl -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $vx 'One renamed by Vortex.7z'), $oneB)
    [IO.File]::WriteAllBytes((Join-Path $vx 'not-one.7z'), $sameSizeB)
    [IO.File]::WriteAllBytes((Join-Path $mydl 'Two-200-2-0.zip'), $twoB)
    [IO.File]::WriteAllBytes((Join-Path $mydl 'unrelated.txt'), (Bytes 'something else'))
    $left = Take-From @($one, $two, $three) @((New-Place (Join-Path $T 'not-there') $false), (New-Place $vx $false), (New-Place $mydl $true)) $dlP
    $oneTo = Join-Path $dlP 'One-100-1-0.7z'; $twoTo = Join-Path $dlP 'Two-200-2-0.zip'
    Yes 'P1 an archive in Vortex''s folder under another name is taken into downloads under its own name, and Vortex keeps its copy' ((Test-Path -LiteralPath $oneTo) -and [Linq.Enumerable]::SequenceEqual([byte[]][IO.File]::ReadAllBytes($oneTo), $oneB) -and (Test-Path -LiteralPath (Join-Path $vx 'One renamed by Vortex.7z')))
    Yes 'P2 an archive in the person''s Downloads is moved into downloads' ((Test-Path -LiteralPath $twoTo) -and [Linq.Enumerable]::SequenceEqual([byte[]][IO.File]::ReadAllBytes($twoTo), $twoB) -and -not (Test-Path -LiteralPath (Join-Path $mydl 'Two-200-2-0.zip')))
    Yes 'P3 a file of the size with other bytes, and files of other sizes, are left where they are' ((Test-Path -LiteralPath (Join-Path $vx 'not-one.7z')) -and (Test-Path -LiteralPath (Join-Path $mydl 'unrelated.txt')) -and @(Get-ChildItem -LiteralPath $dlP).Count -eq 2)
    Yes 'P4 what is still missing comes back, and a folder that is not there is passed over' ($left.Count -eq 1 -and $left[0].Name -eq 'Three-300-3-0.rar')
    $wp = New-Object Thornswood.Layout.Modlist
    foreach ($x in @(@($one, $oneB), @($two, $twoB))) { $wp.AddNexusArchive($x[0].Name, $x[1].Length, $x[0].Hash, 'skyrimspecialedition', $x[0].ModId, $x[0].FileId, $x[0].Name, '1.0') }
    $wp.Inline((Bytes 'x'), 'portable.txt', $false)
    $wpf = Join-Path $T 'places.wabbajack'; $wp.Save($wpf)
    Yes 'P5 so the install finds them there' ([Thornswood.ModlistInstall]::Missing([Thornswood.CollectionModlist]::Read($wpf), $dlP).Count -eq 0)

    # ------------------------------------------------------------------ V ----
    $vd = $MF.GetMethod('VortexDownloads', $flags)
    $ud = Join-Path $T 'AppData-Vortex'
    function Vd($setting) { return @($vd.Invoke($null, [object[]]@([string]$setting, [string]$ud, 'Ada'))) }
    $default = [IO.Path]::Combine($ud, 'downloads', 'skyrimse')
    $got = @(Vd $null)
    Yes 'V1 with no setting, Vortex''s own default: its folder, downloads, skyrimse' ($got.Count -eq 1 -and $got[0] -eq $default) ($got -join ' | ')
    $got = @(Vd ([IO.Path]::Combine('{UserData}', 'Mods for {USERNAME}')))
    Yes 'V2 a setting with {UserData} and {USERNAME} in it, any case, then the default' ($got.Count -eq 2 -and $got[0] -eq [IO.Path]::Combine($ud, 'Mods for Ada', 'skyrimse') -and $got[1] -eq $default) ($got -join ' | ')
    $got = @(Vd 'relative')
    Yes 'V3 a relative setting is under Vortex''s own folder' ($got[0] -eq [IO.Path]::GetFullPath([IO.Path]::Combine($ud, 'relative', 'skyrimse'))) ($got -join ' | ')
    $vcases = Join-Path $T 'vortex-cases'
    $vspec = Join-Path $T 'vortex-cases.json'
    $settingText = 'D:\Mods\{game}'
    [IO.File]::WriteAllText($vspec, (ConvertTo-Json -Depth 6 -InputObject ([ordered]@{
        'moved' = [ordered]@{ table = @([pscustomobject]@{ key = 'settings###downloads###path'; value = (ConvertTo-Json $settingText) }); log = @() }
        'never' = [ordered]@{ table = @([pscustomobject]@{ key = 'settings###interface###language'; value = '"en"' }); log = @() }
    })), $utf8)
    $python = @('python', 'python3') | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
    if ($python) {
        & $python (Join-Path $Repo 'tests/fixtures/vortex-state-rows.py') $vcases $vspec
        $wrote = $LASTEXITCODE -eq 0
        $VP = $asm.GetType('Thornswood.VortexProfileState')
        $moved = $VP.GetMethod('DownloadsSetting').Invoke($null, @([IO.Path]::Combine($vcases, 'moved', 'Vortex', 'state.v2')))
        $unset = $VP.GetMethod('DownloadsSetting').Invoke($null, @([IO.Path]::Combine($vcases, 'never', 'Vortex', 'state.v2')))
        Yes 'V4 Vortex''s download folder setting is read out of its state, and is nothing when Vortex never changed it' ($wrote -and $moved -eq $settingText -and $null -eq $unset) "$moved | $unset"
    } else { Skip 'V4 Vortex''s download folder setting is read out of its state (no python here for tests/fixtures/vortex-state-rows.py)' }

    # ------------------------------------------------------------------ H ----
    $byHand = $MF.GetMethod('ByHand', $flags)
    function Hand($list, [string]$dl, $open, $stop) {
        $argv = [object[]]@((Archives $list).psobject.BaseObject, [string]$watch, $dl, $open, $null, $stop, 10)
        return ,($byHand.Invoke($null, $argv))
    }
    $watch = Join-Path $T 'watched'; $dlH = Join-Path $T 'dl-hand'
    New-Item -ItemType Directory -Path $watch -Force | Out-Null
    $script:opened = @()
    $bytesOf = @{ (Page-Of $one) = @($one.Name, $oneB); (Page-Of $two) = @('Two (1).zip', $twoB); (Page-Of $three) = @($three.Name, $threeB) }
    # The person: presses Manual Download on each page as it opens, and the
    # browser saves it in the watched folder, the second under a name of its own.
    $open = [Action[string]] { param($page) $script:opened += $page; $f = $bytesOf[$page]; [IO.File]::WriteAllBytes((Join-Path $watch $f[0]), [byte[]]$f[1]) }
    $never = [Func[bool]] { $false }
    $left = Hand @($one, $two, $three) $dlH $open $never
    Yes 'H1 each Nexus page opens in turn, and each file is taken from the folder as it lands' ($left.Count -eq 0 -and ($script:opened -join ' ') -eq ((@($one, $two, $three) | ForEach-Object { Page-Of $_ }) -join ' ') -and @(Get-ChildItem -LiteralPath $dlH).Count -eq 3 -and @(Get-ChildItem -LiteralPath $watch).Count -eq 0) ($script:opened -join ' ')
    Yes 'H2 the page is the file''s own on Nexus, with its Manual Download' ((Page-Of $one) -eq 'https://www.nexusmods.com/skyrimspecialedition/mods/100?tab=files&file_id=1000')
    $script:opened = @()
    $script:looks = 0
    $soon = [Func[bool]] { $script:looks++; return $script:looks -gt 3 }
    $nothing = [Action[string]] { param($page) $script:opened += $page }
    $left = Hand @($one, $two) (Join-Path $T 'dl-hand-2') $nothing $soon
    Yes 'H3 a stop ends it with what is left, the first page opened once' ($left.Count -eq 2 -and $script:opened.Count -eq 1)
    $script:opened = @()
    $why = Stop-Of { Hand @($one, (New-Http $mo2Url $mo2B)) $dlH $nothing $never }
    Yes 'H4 an archive that is not a Nexus file is refused before any page opens' ($why.Contains('is not a Nexus file') -and $script:opened.Count -eq 0) $why
}
finally {
    $srv.Stop()
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
