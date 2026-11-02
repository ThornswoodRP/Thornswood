<#
  test-crash-snapshot.ps1

      pwsh -NoProfile -File .\launcher\tests\test-crash-snapshot.ps1

  Issue #2626, which replaces #1191's rule. A full crash snapshot was turned
  on by itself for the dev build and staff PCs and described as about 1 GB.
  The one written on Djinn's PC on 17 October was 9.2 GB, and nobody had told
  him. Djinn: off unless the person turns it on, in the launcher, with the
  size said and a folder they choose; after a crash, show it and ask whether
  to keep it.

  The launcher does it with Crash Logger's own switch (Crash Log Write
  Minidump in the install's CrashLogger.ini, launcher\app\CrashDump.cs),
  written before every Play to match Settings, Crash snapshots:

    1. off for everybody until ticked (Config.CrashSnapshots is false);
    2. turning it off stops new snapshots and deletes none already saved;
    3. on: Max Minidumps = 2, and the launcher deletes all but the newest
       two, in Crash Logger's folder and the chosen one;
    4. written into that install's file only: a CrashLogger.ini that is a
       hard link to another copy is split first, and nothing goes in the
       registry or asks for administrator;
    5. as the game closes after a crash with it on, the snapshot is moved to
       the chosen folder, the line names it and its size, and the launcher
       asks whether to keep it;
    6. nothing sends a snapshot anywhere (session logs, the report zip);
    7. kept until looked at (#2319, Patrick, 12 Oct): each snapshot is
       remembered against the session it crashed in, the check in asks the
       site which of those staff marked looked at, and Tidy deletes those,
       keeping the rest up to two. site\tests\test-2319-crash-looked-at.js runs
       the site's half.

  HOW. Builds the shipped CrashDump.cs and Enforce.cs as a program with the
  .NET SDK the launcher builds with (Launcher-Csc.ps1, #4823), with small
  stand-ins for Paths, Files, Swallow and Config, and drives it against
  pretend installs in a temp folder Get-ScratchDir.ps1 names (the
  repository's temp, or %TEMP% outside a checkout). Reads Config.cs, Shell.cs,
  Ask.cs, MainWindow.axaml, Diag.cs and Discord.cs as text. Changes nothing outside its temp
  folder and its build under out\harness.

  The build and every check by the source run on every machine. Driving it
  runs on Windows only: CrashDump and Enforce name Crash Logger's files as
  Data\SKSE\Plugins\..., a Windows path, and Enforce splits a hard link with
  kernel32, so elsewhere those checks say SKIP.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$app = Join-Path $root 'launcher\app'

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host "$script:pass passed, $script:fail failed"
    if ($script:fail -gt 0) { exit 1 } else { exit 0 }
}
function Read([string]$rel) { Get-Content -LiteralPath (Join-Path $root $rel) -Raw }

# ------------------------------------------------------------------ compile
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Thornswood
{
    // Enforce.MakeItOurs splits a hard link with OwnGame.SwapCopyIn (#2599).
    // The real code, lifted out of OwnGame.cs below, as test-2599-whole-swaps.ps1 does.
    static partial class OwnGame
    {
__OWNGAME__
    }
    static class Paths { public static string Game = ""; public static string LiveMyGames = ""; public static string ProfileDir = ""; }
    // The same line as Files.cs; the text check below holds the two together.
    static class Files { public static string SkseLogDir { get { return Path.Combine(Paths.LiveMyGames, "SKSE"); } } }
    static class Swallow { public static void Note(string where, Exception e) { Console.WriteLine("SWALLOW=" + where + ": " + e.Message); } }
    class Config { public bool CrashSnapshots; public string CrashSnapshotFolder = ""; }

    static class CrashSnapshotTest
    {
        static string Flat(string s) { return s == null ? "(none)" : s.Replace("\r", " ").Replace("\n", " "); }

        // apply   <game> <mygames> <on 0|1> <folder or ->
        // after   <game> <mygames> <on 0|1> <folder or -> <since, local ticks>
        // tidy    <game> <mygames> <on 0|1> <folder or -> [looked at, csv or -]   (what Keep does)
        // remember <game> <mygames> <on 0|1> <folder or -> <crash log> <session>
        public static int Main(string[] a)
        {
            Paths.Game = a[1];
            Paths.LiveMyGames = a[2];
            // Profile\MyGames, so the profile folder is the one above it, as Paths.cs lays it out.
            Paths.ProfileDir = Path.GetDirectoryName(a[2]);
            var cfg = new Config();
            cfg.CrashSnapshots = a[3] == "1";
            cfg.CrashSnapshotFolder = a[4] == "-" ? "" : a[4];
            if (a[0] == "apply")
            {
                Console.WriteLine("WANTED=" + CrashDump.Wanted(cfg));
                Console.WriteLine("SAID=" + Flat(CrashDump.Apply(cfg)));
                Console.WriteLine("ENFORCE=" + Flat(string.Join(" | ", Enforce.Said.ToArray())));
                return 0;
            }
            if (a[0] == "after")
            {
                DateTime since = new DateTime(long.Parse(a[5]), DateTimeKind.Local);
                string snapshot;
                Console.WriteLine("SAID=" + Flat(CrashDump.AfterSession(since, CrashDump.Wanted(cfg), CrashDump.KeptIn(cfg), out snapshot)));
                Console.WriteLine("SNAP=" + (snapshot ?? "(none)"));
                return 0;
            }
            if (a[0] == "tidy")
            {
                if (a.Length > 5) CrashDump.NoteLookedAt(a[5] == "-" ? "" : a[5]);
                int looked;
                int gone = CrashDump.Tidy(CrashDump.KeptIn(cfg), out looked);
                Console.WriteLine("GONE=" + gone);
                Console.WriteLine("LOOKED=" + looked);
                Console.WriteLine("LINE=" + Flat(CrashDump.TidyLine(gone, looked)));
                Console.WriteLine("HELD=" + CrashDump.HeldSessions());
                return 0;
            }
            if (a[0] == "remember")
            {
                CrashDump.Remember(a[5], a[6]);
                Console.WriteLine("HELD=" + CrashDump.HeldSessions());
                return 0;
            }
            return 2;
        }
    }
}
'@

$tmp = & (Join-Path $root 'scripts\release\Get-ScratchDir.ps1') ('test-crash-snapshot-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    # The same two pieces of OwnGame.cs test-2599-whole-swaps.ps1 lifts: the
    # #2599 swaps, and ReplaceName with the MoveFileEx they rest on.
    $og = [IO.File]::ReadAllText((Join-Path $app 'OwnGame.cs')) -replace "`r`n", "`n"
    $region = [regex]::Match($og, '(?s)\n(        (?:internal )?static void WriteRecord\(string path, IEnumerable<string> lines\)\n.*?private static partial bool MoveFileEx\([^)]*\);\n)')
    $block = [regex]::Match($og, '(?s)\n(        // ---- #2599: one name of the game folder replaced whole.*?        // ---- end #2599[^\n]*\n)')
    Yes 'OwnGame.SwapCopyIn and what it rests on are found in OwnGame.cs, to compile with Enforce.cs' ($region.Success -and $block.Success -and $block.Groups[1].Value -match 'internal static void SwapCopyIn\(')
    if (-not ($region.Success -and $block.Success)) { Done }
    $driver = $driver.Replace('__OWNGAME__', $region.Groups[1].Value.TrimEnd() + "`n" + $block.Groups[1].Value.TrimEnd())

    $exe = $null
    try { $exe = Build-LauncherCode -Exe -Main 'Thornswood.CrashSnapshotTest' -Source $driver -File (Join-Path $app 'CrashDump.cs'), (Join-Path $app 'Enforce.cs') }
    catch { ($_.Exception.Message -split "`n") | ForEach-Object { Write-Host "      $_" } }
    Yes 'CrashDump.cs and Enforce.cs build with the .NET SDK the launcher builds with' ($null -ne $exe)
    if (-not $exe) { Done }

    # ------------------------------------------- by the source, on every machine
    # 1. off until ticked
    $cfgText = Read 'launcher\app\Config.cs'
    Yes 'the setting is off for everybody until ticked (Config.CrashSnapshots = false)' ($cfgText -match '\[JsonInclude\] public bool CrashSnapshots = false;')
    # 4. nothing in the registry
    $src = Read 'launcher\app\CrashDump.cs'
    $code = [regex]::Replace($src, '(?m)^\s*///?.*$', '')
    Yes 'nothing in the registry and nothing that asks for administrator (no LocalDumps, no runas)' ($code -notmatch 'Registry|LocalDumps|runas|HKEY|HKLM|HKCU')
    # ------------------------------------------- 6. the launcher around it
    $shell = (Get-ChildItem -LiteralPath $app -Filter 'Shell*.cs' | Sort-Object Name | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
    $play = [regex]::Match($shell, '(?s)static void Play\(\)\s*\{(.*?)\n        \}\r?\n')
    $body = $play.Groups[1].Value
    $iEnf = $body.IndexOf('Enforce.Apply()'); $iDump = $body.IndexOf('CrashDump.Apply(cfg)'); $iSaid = $body.IndexOf('foreach (string note in Enforce.Said)'); $iNote = $body.IndexOf('Keep.LeaveNote')
    Yes 'Play writes it every time, after the other held settings and before the game starts' ($play.Success -and $iEnf -ge 0 -and $iDump -gt $iEnf -and $iSaid -gt $iDump -and $iNote -gt $iDump)
    Yes 'the game closing works from what Crash Logger was told at Play, off the window''s thread' ($shell -match 'bool keptAtPlay = CrashDump\.AppliedAtPlay;' -and $shell -match 'ThreadPool\.QueueUserWorkItem\(delegate\s*\{\s*string snapshot = null, crashed = null;' -and $shell -match 'CrashDump\.AfterSession\(crashSince, keptAtPlay, keptIn, out snapshot\)')
    # The question is Ask.YesNo, Windows' own box over the launcher's window
    # (Ask.Owner), since Avalonia has none (#4823).
    $ask = [regex]::Match($shell, '(?s)static void AskKeepSnapshot\(string snapshot, string keptIn\)\s*\{(.*?)\n        \}\r?\n')
    $askBody = $ask.Groups[1].Value
    $askCs = Read 'launcher\app\Ask.cs'
    Yes 'and asks about a saved snapshot back on the window''s thread, in a box over the launcher''s window' ($shell -match '(?s)Dispatcher\.UIThread\.Post\(new Action\(delegate\s*\{[^{}]*if \(snapshot != null\) AskKeepSnapshot\(snapshot, keptIn\);' -and $askBody -match 'bool r = Ask\.YesNo\(' -and $askCs -match 'return MessageBoxW\(Owner, ')
    Yes 'Apply remembers what it wrote at Play' ($src -match 'AppliedAtPlay = Wanted\(cfg\);')
    Yes 'asking: Yes keeps it and only then tidies older ones, No deletes it' ($ask.Success -and $askBody -match '(?s)if \(r\)\s*\{.*?int gone = CrashDump\.Tidy\(keptIn, out looked\);.*?return;' -and $askBody.IndexOf('File.Delete(snapshot);') -gt $askBody.IndexOf('CrashDump.Tidy(keptIn'))
    Yes 'Wanted(cfg) is the person''s own setting and nothing else' ($src -match 'return cfg != null && cfg\.CrashSnapshots;' -and $src -notmatch 'Discord\.' -and $src -notmatch 'IsDev')
    $ui = Read 'launcher\app\MainWindow.axaml'
    Yes 'Settings has the box, the size said beside it, and a folder button' ($ui -match 'x:Name="ChkCrashSnapshots"' -and $ui -match 'One can be 9 GB or more' -and $ui -match 'x:Name="BtnCrashFolder"' -and $ui -match 'x:Name="TxtCrashFolder"')
    Yes 'the box and the folder are saved to the config when changed' ($shell -match 'cfg\.CrashSnapshots = chkCrashSnapshots\.IsChecked == true;' -and $shell -match 'cfg\.CrashSnapshotFolder = chosen;')
    $files = Read 'launcher\app\Files.cs'
    Yes 'Crash Logger''s folder is the crash log folder (the stand-in above says what Files.cs says)' ($files -match 'public static string SkseLogDir \{ get \{ return Path\.Combine\(Paths\.LiveMyGames, "SKSE"\); \} \}' -and $src -match 'return Files\.SkseLogDir;')
    $discord = Read 'launcher\app\Discord.cs'
    Yes 'the session logs never carry a snapshot (only crash-*.log)' ($discord -notmatch '\.dmp' -and $discord -match 'Directory\.GetFiles\(dir, "crash-\*\.log"\)')
    $diag = Read 'launcher\app\Diag.cs'
    $report = [regex]::Match($diag, '(?s)Entry crash = Files\.NewestCrash\(\);\s*if \(crash != null\) Grab\(work, "crash log", crash\.FullPath\);')
    Yes 'the report zip takes the crash log, not the snapshot' ($report.Success -and $diag -notmatch '\.dmp' -and $files -match '"crash-\*\.log"')
    # 7. kept until looked at (#2319)
    Yes 'the check in sends the sessions held and takes the site''s lookedAt only from an answer that carried it' ($discord -match 'string held = CrashDump\.HeldSessions\(\);' -and $discord -match '",\\"snapshots\\":\\"" \+ Escape\(held\)' -and $discord -match 'if \(st\.Ok && reply\.Contains\("\\"lookedAt\\""\)\) CrashDump\.NoteLookedAt\(Field\(reply, "lookedAt"\)\);')
    Yes 'the session logs remember the crash''s session before they go up' ($discord -match 'CrashDump\.Remember\(want\[1\]\[1\], session\);' -and $discord.IndexOf('CrashDump.Remember(') -lt $discord.IndexOf('/api/play/logs", sb.ToString()'))
    Yes 'the person is told at the prompt that a kept snapshot waits for staff, two at most' ($shell -match 'Yes keeps it until staff mark this crash looked at on the sessions page' -and $shell -match 'Two are kept at most')
    Yes 'and the setting says so before it is ticked' ($ui -match 'Each is kept until staff have looked at that crash, two at most\.' -and $src -match 'Each is kept until staff have looked at that crash, two at most\.')

    # ------------------------------------------- driven, on Windows
    if (-not $OnWindows) {
        Write-Host 'SKIP  1 to 5 and 7, CrashDump and Enforce driven against pretend installs: they name Crash Logger''s files by the Windows path Data\SKSE\Plugins\..., and Enforce splits a hard link with kernel32, which only Windows has'
        Done
    }
    function Run([string[]]$argv) {
        $lines = Invoke-LauncherExe $exe @argv
        $r = @{}
        foreach ($l in $lines) { $i = $l.IndexOf('='); if ($i -gt 0) { $r[$l.Substring(0, $i)] = $l.Substring($i + 1) } }
        return $r
    }
    # A pretend install: Game\Data\SKSE\Plugins with Crash Logger in it, and
    # Profile\MyGames\SKSE for the logs, as C:\Thornswood lays them out.
    function NewInstall([string]$name, [bool]$withIni = $true, [bool]$withDll = $true) {
        $r = Join-Path $tmp $name
        $game = Join-Path $r 'Game'
        $my = Join-Path $r 'Profile\MyGames'
        $plugins = Join-Path $game 'Data\SKSE\Plugins'
        New-Item -ItemType Directory -Force -Path $plugins, (Join-Path $my 'SKSE') | Out-Null
        if ($withDll) { [IO.File]::WriteAllBytes((Join-Path $plugins 'CrashLogger.dll'), [byte[]](1, 2, 3)) }
        if ($withIni) { [IO.File]::WriteAllText((Join-Path $plugins 'CrashLogger.ini'), $script:shippedIni, (New-Object Text.UTF8Encoding($true))) }
        return @{ Game = $game; My = $my; Ini = (Join-Path $plugins 'CrashLogger.ini'); Skse = (Join-Path $my 'SKSE') }
    }

    # The lines of Crash Logger 1.24's own CrashLogger.ini that matter, as
    # C:\Thornswood\Game and C:\Thornswood-DevBuild\Game had them on 29 Sep
    # (#1191), with a BOM as it ships.
    $script:shippedIni = "; Crash Log Settings`r`n`r`n[Debug]`r`n`r`n; Crashlog output directory. If blank, defaults to `"Documents\my games\Skyrim Special Edition\SKSE\`"`r`nCrashlog Directory = `r`n`r`n;Maximum number of crash logs to keep. Default: 20`r`nMax Crash Logs = 20`r`n`r`n;Maximum number of minidump files to keep. Minidumps are very large, so a low limit is recommended. Default: 1`r`n;Set to 0 to disable minidump cleanup.`r`nMax Minidumps = 1`r`n`r`nAuto Open Crash Log = true`r`n`r`n;Also create minidump file (.dmp) for crash log WinDbg analysis. Default: false`r`nCrash Log Write Minidump = false`r`n`r`n;Also create minidump file (.dmp) for thread dump WinDbg analysis. Default: false`r`nThread Dump Write Minidump = false`r`n`r`nLog Level = 2`r`n"


    function Apply($inst, [bool]$on, [string]$folder = '-') {
        Run @('apply', $inst.Game, $inst.My, $(if ($on) { '1' } else { '0' }), $folder)
    }
    function After($inst, [bool]$on, [string]$folder, [datetime]$since) {
        Run @('after', $inst.Game, $inst.My, $(if ($on) { '1' } else { '0' }), $folder, [string]$since.Ticks)
    }
    function IniText($inst) { if (Test-Path -LiteralPath $inst.Ini) { Get-Content -LiteralPath $inst.Ini -Raw } else { '' } }
    function Live([string]$text, [string]$key) {
        $m = [regex]::Matches($text, '(?m)^\s*' + [regex]::Escape($key) + '\s*=\s*(.*?)\s*$')
        return ,@($m | ForEach-Object { $_.Groups[1].Value })
    }
    function Dump([string]$dir, [string]$name, [int]$minutesAgo) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $p = Join-Path $dir $name
        [IO.File]::WriteAllBytes($p, [byte[]](0x4D, 0x44, 0x4D, 0x50))
        (Get-Item -LiteralPath $p).LastWriteTime = (Get-Date).AddMinutes(-$minutesAgo)
        return $p
    }

    # ------------------------------------------- 1. off until ticked
    $inst = NewInstall 'off'
    $r = Apply $inst $false
    Yes 'off: Crash Log Write Minidump = false, and the launcher says nothing (already Crash Logger''s default)' ((Live (IniText $inst) 'Crash Log Write Minidump')[0] -eq 'false' -and $r['WANTED'] -eq 'False' -and $r['SAID'] -eq '(none)')
    $m = NewInstall 'noini-off' $false $true
    $null = Apply $m $false
    Yes 'off and no ini: none is made (Crash Logger''s default is off)' (-not (Test-Path -LiteralPath $m.Ini))

    # ------------------------------------------- 2. turning it off deletes nothing
    $inst = NewInstall 'turnedoff'
    [IO.File]::WriteAllText($inst.Ini, ($script:shippedIni -replace 'Crash Log Write Minidump = false', 'Crash Log Write Minidump = true' -replace 'Thread Dump Write Minidump = false', 'Thread Dump Write Minidump = true'))
    $d = Dump $inst.Skse 'crash-2026-10-17-13-13-14.dmp' 5
    $r = Apply $inst $false
    $t = IniText $inst
    Yes 'turned off: Crash Log Write Minidump back to false' ((Live $t 'Crash Log Write Minidump')[0] -eq 'false')
    Yes 'turned off: the hang snapshot switch is held off too' ((Live $t 'Thread Dump Write Minidump')[0] -eq 'false')
    Yes 'turned off: a snapshot already saved is left where it is' (Test-Path -LiteralPath $d)
    Yes 'turned off: the log says so, and where they are' ($r['SAID'] -match 'Crash snapshots are off\. Any already saved are left where they are' -and $r['SAID'] -match [regex]::Escape($inst.Skse))

    # ------------------------------------------- 3. on: only the newest kept
    $inst = NewInstall 'on'
    $chosen = Join-Path $tmp 'chosen-on'
    $r = Apply $inst $true $chosen
    $t = IniText $inst
    Yes 'on: Crash Log Write Minidump = true and Max Minidumps = 2' ((Live $t 'Crash Log Write Minidump')[0] -eq 'true' -and (Live $t 'Max Minidumps')[0] -eq '2' -and $r['WANTED'] -eq 'True')
    Yes 'on: the log says where they go, how big they get, that each is kept until looked at, two at most, and that they stay on this PC' ($r['SAID'] -match [regex]::Escape($chosen) -and $r['SAID'] -match '9 GB or more' -and $r['SAID'] -match 'kept until staff have looked at that crash, two at most' -and $r['SAID'] -match 'stays on this PC')
    $again = Apply $inst $true $chosen
    Yes 'on: a second Play changes nothing and says nothing' ($again['SAID'] -eq '(none)' -and (IniText $inst) -eq $t)
    Yes 'on: the rest of Crash Logger''s file is left alone' ((Live $t 'Max Crash Logs')[0] -eq '20' -and (Live $t 'Auto Open Crash Log')[0] -eq 'true' -and (Live $t 'Thread Dump Write Minidump')[0] -eq 'false' -and (Live $t 'Log Level')[0] -eq '2')
    $old = Dump $inst.Skse 'crash-2026-09-20-10-00-00.dmp' 600
    $mid = Dump $chosen 'crash-2026-09-25-10-00-00.dmp' 300
    $new = Dump $chosen 'crash-2026-09-29-10-00-00.dmp' 10
    [IO.File]::WriteAllText((Join-Path $inst.Skse 'crash-2026-09-20-10-00-00.log'), 'log')
    $r = Apply $inst $true $chosen
    Yes 'on: past two, the oldest is deleted, across both folders, and the newest two kept' (-not (Test-Path -LiteralPath $old) -and (Test-Path -LiteralPath $mid) -and (Test-Path -LiteralPath $new))
    Yes 'on: and the log says so' ($r['SAID'] -match 'Deleted 1 older crash snapshot past the 2 kept\.')
    Yes 'crash logs are never touched' (Test-Path -LiteralPath (Join-Path $inst.Skse 'crash-2026-09-20-10-00-00.log'))

    # ------------------------------------------- 4. only that install's file
    $vortex = Join-Path $tmp 'VortexCopy.ini'
    [IO.File]::WriteAllText($vortex, $script:shippedIni)
    $h = NewInstall 'linked' $false $true
    New-Item -ItemType HardLink -Path $h.Ini -Target $vortex | Out-Null
    $r = Apply $h $true
    Yes 'a CrashLogger.ini that is a hard link to another copy: the other copy is not written' ((Get-Content -LiteralPath $vortex -Raw) -eq $script:shippedIni)
    Yes 'and this install''s own file is' ((Live (IniText $h) 'Crash Log Write Minidump')[0] -eq 'true')
    Yes 'and the log says the file was split' ($r['ENFORCE'] -match 'It has its own copy now')
    $m = NewInstall 'noini' $false $true
    $null = Apply $m $true
    $t = IniText $m
    Yes 'on, Crash Logger there but its ini missing: made with both lines under [Debug]' ($t -match '(?s)\[Debug\].*Crash Log Write Minidump = true' -and (Live $t 'Max Minidumps')[0] -eq '2')
    $m = NewInstall 'nocrashlogger' $false $false
    $null = Apply $m $true
    Yes 'no Crash Logger at all: nothing is made' (-not (Test-Path -LiteralPath $m.Ini))

    # ------------------------------------------- 5. as the game closes
    $s = NewInstall 'session'
    $chosen = Join-Path $tmp 'chosen-session'
    $since = (Get-Date).AddMinutes(-30)
    [IO.File]::WriteAllText((Join-Path $s.Skse 'crash-2026-09-28-09-00-00.log'), 'yesterday')
    (Get-Item -LiteralPath (Join-Path $s.Skse 'crash-2026-09-28-09-00-00.log')).LastWriteTime = (Get-Date).AddMinutes(-1500)
    $r = After $s $true $chosen $since
    Yes 'a session that did not crash: no crash line (yesterday''s log does not count)' ($r['SAID'] -eq '(none)' -and $r['SNAP'] -eq '(none)')
    $older = Dump $chosen 'crash-2026-09-28-09-00-00.dmp' 1500
    [IO.File]::WriteAllText((Join-Path $s.Skse 'crash-2026-10-17-13-13-14.log'), 'today')
    $dmp = Dump $s.Skse 'crash-2026-10-17-13-13-14.dmp' 1
    $r = After $s $true $chosen $since
    $moved = Join-Path $chosen 'crash-2026-10-17-13-13-14.dmp'
    Yes 'crashed, on: the line names the crash log and where it is' ($r['SAID'] -match 'The game crashed\. Its crash log is crash-2026-10-17-13-13-14\.log in ' -and $r['SAID'] -match [regex]::Escape($s.Skse))
    Yes 'crashed, on: the snapshot is moved to the chosen folder and named with its size' ((Test-Path -LiteralPath $moved) -and -not (Test-Path -LiteralPath $dmp) -and $r['SNAP'] -eq $moved -and $r['SAID'] -match [regex]::Escape($moved) -and $r['SAID'] -match ', \d+ (MB|GB)\.')
    Yes 'crashed, on: and the line says it holds what was in memory and stays on this PC' ($r['SAID'] -match "It holds what was in the game's memory, so it stays on this PC and nothing sends it anywhere")
    Yes 'crashed, on: nothing older is deleted before the person answers' ((Test-Path -LiteralPath $older) -and (Test-Path -LiteralPath $moved))
    $other = Dump $chosen 'crash-report-from-another-program.dmp' 3000
    $r = Run @('tidy', $s.Game, $s.My, '1', $chosen)
    Yes 'kept, with one older: both are kept, nobody has looked at either' ((Test-Path -LiteralPath $older) -and (Test-Path -LiteralPath $moved) -and $r['GONE'] -eq '0')
    $oldest = Dump $chosen 'crash-2026-09-27-09-00-00.dmp' 2000
    $r = Run @('tidy', $s.Game, $s.My, '1', $chosen)
    Yes 'kept, a third: the oldest is deleted, the newest two kept' (-not (Test-Path -LiteralPath $oldest) -and (Test-Path -LiteralPath $older) -and (Test-Path -LiteralPath $moved) -and $r['GONE'] -eq '1' -and $r['LOOKED'] -eq '0')
    Yes 'kept: a file in the chosen folder that is not one of Crash Logger''s is never deleted' (Test-Path -LiteralPath $other)
    $s2 = NewInstall 'session-off'
    [IO.File]::WriteAllText((Join-Path $s2.Skse 'crash-2026-10-17-14-00-00.log'), 'today')
    $stray = Dump $s2.Skse 'crash-2026-10-17-14-00-00.dmp' 1
    $r = After $s2 $false '-' $since
    Yes 'crashed, off: the crash log line, no snapshot named, and nothing moved or deleted' ($r['SAID'] -match 'The game crashed\.' -and $r['SAID'] -notmatch 'crash snapshot' -and $r['SNAP'] -eq '(none)' -and (Test-Path -LiteralPath $stray))

    # ------------------------------------------- 7. kept until looked at (#2319)
    $l = NewInstall 'looked'
    $chosen = Join-Path $tmp 'chosen-looked'
    $profDir = Split-Path -Parent $l.My
    $held = Join-Path $profDir 'crash-snapshots.txt'
    $sA = 'a' * 32; $sB = 'b' * 32; $sC = 'c' * 32
    $dA = Dump $chosen 'crash-2026-10-18-20-00-00.dmp' 10
    $dB = Dump $chosen 'crash-2026-10-18-19-00-00.dmp' 70
    $dC = Dump $l.Skse 'crash-2026-10-18-18-00-00.dmp' 130
    $r = Run @('remember', $l.Game, $l.My, '1', $chosen, (Join-Path $l.Skse 'crash-2026-10-18-20-00-00.log'), $sA)
    $null = Run @('remember', $l.Game, $l.My, '1', $chosen, (Join-Path $l.Skse 'crash-2026-10-18-19-00-00.log'), $sB)
    $r = Run @('remember', $l.Game, $l.My, '1', $chosen, (Join-Path $l.Skse 'crash-2026-10-18-18-00-00.log'), $sC)
    Yes 'each snapshot is remembered against the session it crashed in, in the profile folder' ((Test-Path -LiteralPath $held) -and $r['HELD'] -eq "$sA,$sB,$sC")
    Yes '  and never beside the snapshots, in the folder the person chose' (-not (Test-Path -LiteralPath (Join-Path $chosen 'crash-snapshots.txt')))
    $r = Run @('remember', $l.Game, $l.My, '1', $chosen, (Join-Path $l.Skse 'crash-2026-10-18-17-00-00.log'), 'not-a-session')
    Yes '  a session id that is not one is not remembered' ($r['HELD'] -eq "$sA,$sB,$sC")
    $r = Run @('remember', $l.Game, $l.My, '1', $chosen, (Join-Path $l.Skse 'thing.log'), ('e' * 32))
    Yes '  nor a log that is not Crash Logger''s' ($r['HELD'] -eq "$sA,$sB,$sC")
    $r = Run @('tidy', $l.Game, $l.My, '1', $chosen, '-')
    Yes 'nobody has looked at any: the newest two kept, the third deleted' ((Test-Path -LiteralPath $dA) -and (Test-Path -LiteralPath $dB) -and -not (Test-Path -LiteralPath $dC) -and $r['GONE'] -eq '1' -and $r['LOOKED'] -eq '0')
    Yes '  and the deleted one is no longer asked about' ($r['HELD'] -eq "$sA,$sB")
    $r = Run @('tidy', $l.Game, $l.My, '1', $chosen, $sB)
    Yes 'staff looked at one: that snapshot is deleted, the other kept' ((Test-Path -LiteralPath $dA) -and -not (Test-Path -LiteralPath $dB) -and $r['GONE'] -eq '1' -and $r['LOOKED'] -eq '1')
    Yes '  and the log says it went because it was looked at' ($r['LINE'] -eq 'Deleted 1 crash snapshot staff have looked at.')
    Yes '  and it is no longer asked about' ($r['HELD'] -eq $sA)
    $r = Run @('tidy', $l.Game, $l.My, '1', $chosen, '-')
    Yes 'a mark taken off: the snapshot is kept' ((Test-Path -LiteralPath $dA) -and $r['GONE'] -eq '0')
    $dD = Dump $chosen 'crash-2026-10-18-21-00-00.dmp' 5
    $dE = Dump $chosen 'crash-2026-10-18-22-00-00.dmp' 2
    $dX = Dump $l.Skse 'crash-2026-10-18-15-00-00.dmp' 300
    $r = Run @('tidy', $l.Game, $l.My, '1', $chosen, $sA)
    Yes 'looked at and past two in one tidy: both go, counted apart' (-not (Test-Path -LiteralPath $dA) -and -not (Test-Path -LiteralPath $dX) -and $r['GONE'] -eq '2' -and $r['LOOKED'] -eq '1')
    Yes '  and said apart' ($r['LINE'] -eq 'Deleted 1 crash snapshot staff have looked at and 1 older crash snapshot past the 2 kept.')
    Yes '  a snapshot with no session remembered is kept like an unread one' ((Test-Path -LiteralPath $dD) -and (Test-Path -LiteralPath $dE))
    $o = NewInstall 'looked-off'
    $chosenOff = Join-Path $tmp 'chosen-looked-off'
    $dF = Dump $o.Skse 'crash-2026-10-18-20-00-00.dmp' 10
    $null = Run @('remember', $o.Game, $o.My, '0', '-', (Join-Path $o.Skse 'crash-2026-10-18-20-00-00.log'), $sA)
    $null = Apply $o $false
    Yes 'snapshots turned off: even one staff looked at is left where it is' (Test-Path -LiteralPath $dF)
    $many = NewInstall 'looked-many'
    for ($i = 0; $i -lt 10; $i++) { $r = Run @('remember', $many.Game, $many.My, '1', '-', (Join-Path $many.Skse ('crash-2026-10-18-10-00-0' + $i + '.log')), ([string]$i * 32)) }
    Yes 'at most eight sessions are remembered, the newest' (($r['HELD'] -split ',').Count -eq 8 -and $r['HELD'] -notmatch ('0' * 32) -and $r['HELD'] -match ('9' * 32))
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Done
