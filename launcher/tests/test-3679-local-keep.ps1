<#
  test-3679-local-keep.ps1

      pwsh -NoProfile -File .\launcher\tests\test-3679-local-keep.ps1

  Issue #3679: the launcher kept launcher.log, the support zips, the Discord
  sign-in with the name and picture beside it, and the WebView2 browser
  folders on the PC with no time limit. Uninstall's "Keep this build's saves
  and settings", ticked by default, kept the whole Profile folder and so all
  of them, and the privacy page said nothing about any of it. Measured on one
  install on 26 Oct: a 478,059 byte log going back to the day it was made,
  and 71 MB of browser folders.

  WHAT THIS HOLDS THE LAUNCHER TO.
    1. launcher\app\LocalKeep.cs, the one place the rule lives: a log past
       30 days is cut at its first line stamped within them, a line with no
       stamp goes or stays with the stamped line before it, the rest is kept
       byte for byte, a log already inside the rule is not written at all, a
       log that is all old is deleted, and one with no stamps is judged by
       when it was written. Support zips older than 30 days go, newer ones and
       anything else in the folder stay. Tidy says in the log what it took.
    2. Shell.Run tidies straight after Paths.Init, before the terms check and
       before anything else writes the log.
    3. Uninstall with the box ticked: the real Targets list and the real
       handover script, run by cmd against a scratch install, remove the log,
       every Discord account file, the support reports and both browser
       folders, and leave the saves, the characters, the launcher's records
       and config.json. With the box unticked Profile and config.json go
       whole, as before. The real farewell names what it should have removed
       and could not, and says nothing of the kind when everything went.
    4. The words: the uninstall box, the privacy page and LocalKeep.Days say
       the same 30 days and the same list.

  HOW. Part 1 and 3 build the whole launcher with a driver into one program,
  the way the project builds (the .NET 10 SDK, tests\Launcher-Csc.ps1), and
  run it on a scratch install. Part 1 runs everywhere. In part 3 the handover
  script is run by cmd, waiting on a process that has already ended, and the
  farewell is run in Windows PowerShell with its message box line swapped for
  printing the message. Off Windows cmd and Windows PowerShell are not there,
  so part 3 says SKIP and the rest is checked.

  Nothing outside its own scratch folder is read or written, beyond reading
  the repository.
#>
[CmdletBinding()]
param([string]$Repo, [string]$Scratch)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # builds launcher code the way the project does (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $Here) }
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}
function Read([string]$rel) { [IO.File]::ReadAllText((Join-Path $Repo $rel)) }

$App = Join-Path $Repo 'launcher\app'
$keepSrc = Read 'launcher\app\LocalKeep.cs'
$shellSrc = Read 'launcher\app\Shell.cs'
$uninstallSrc = Read 'launcher\app\Uninstall.cs'
$discordSrc = Read 'launcher\app\Discord.cs'
$xaml = Read 'launcher\app\MainWindow.axaml'
$privacy = (Read 'site\data\site\privacy.md') -replace "`r`n", "`n"

# ---- 2: the start, by text ---------------------------------------------------
$days = [regex]::Match($keepSrc, 'public const int Days = (\d+);')
Yes 'LocalKeep.Days is a number of days' $days.Success
$days = if ($days.Success) { [int]$days.Groups[1].Value } else { 0 }
Yes 'and it is 30, the time the privacy page gives' ($days -eq 30)
$run = [regex]::Match($shellSrc, '(?s)static void Run\(string\[\] args\)\s*\{(.*?)cfg = Config\.Load')
Yes 'Shell.Run is found, up to Config.Load' $run.Success
$body = $run.Groups[1].Value
$init = $body.IndexOf('Paths.Init(root);')
$tidy = $body.IndexOf('LocalKeep.Tidy(DateTime.Now);')
$terms = $body.IndexOf('Acceptance.')
Yes 'Run tidies the log and the reports straight after Paths.Init, before the terms check' ($init -ge 0 -and $tidy -gt $init -and $terms -gt $tidy)
Yes 'nothing else in the launcher calls Tidy' (@(Get-ChildItem (Join-Path $App '*.cs') -File | Where-Object { $_.Name -ne 'LocalKeep.cs' -and ([IO.File]::ReadAllText($_.FullName) -match 'LocalKeep\.Tidy\(') }).Count -eq 1)

# ---- 3, by text: the uninstall takes NotSaves when it keeps the saves --------
$targets = [regex]::Match($uninstallSrc, '(?s)public static string\[\] Targets\(bool keepSaves, bool deleteMods\)(.*?)return leave\.ToArray\(\);')
Yes 'Uninstall.Targets is the list Begin hands back' ($targets.Success -and $uninstallSrc -match 'return Targets\(keepSaves, deleteMods\);')
Yes 'and with the saves kept it takes LocalKeep.NotSaves' ($targets.Groups[1].Value -match '(?s)if \(!keepSaves\)\s*\{[^}]*ProfileDir[^}]*\}\s*else\s*\{[^}]*leave\.AddRange\(LocalKeep\.NotSaves\(\)\);')
Yes 'Discord.Forget deletes the same files the uninstall does (Discord.AccountFiles)' ($discordSrc -match '(?s)public static void Forget\(\)\s*\{\s*foreach \(string f in AccountFiles\(Folder\)\)')
Yes 'NotSaves takes the Discord files from Discord.AccountFiles, and the old voice and music browsers'' folders' ($keepSrc -match 'Discord\.AccountFiles\(Paths\.ProfileDir\)' -and $keepSrc -match 'Path\.Combine\(Paths\.ProfileDir, "VoiceBrowser"\)' -and $keepSrc -match 'Path\.Combine\(Paths\.ProfileDir, "MusicBrowser"\)')

# ---- 4: the words -------------------------------------------------------------
$box = [regex]::Match($xaml, 'x:Name="ChkKeepSaves"[^>]*/>\s*<TextBlock[^>]*Text="([^"]*)"')
Yes 'the uninstall box has its small print' $box.Success
$small = [Net.WebUtility]::HtmlDecode($box.Groups[1].Value)
foreach ($w in @('log', 'Discord sign-in, name and picture', 'support reports', 'voice browser''s data')) {
    Yes ("the small print under the box says the $w go either way") ($small.Contains($w) -and $small.Contains('go either way'))
}
$words = [regex]::Match($keepSrc, 'NotSavesInWords =\s*"([^"]*)"')
Yes 'the uninstall dialog names the same things (LocalKeep.NotSavesInWords)' ($words.Success -and $words.Groups[1].Value.Contains('Discord sign-in, name and picture') -and $shellSrc.Contains('LocalKeep.NotSavesInWords'))
$onPc = [regex]::Match($privacy, '(?s)## What the launcher keeps on your PC\n(.*?)\n## ')
Yes 'the privacy page has a section on what the launcher keeps on the PC' $onPc.Success
$sec = $onPc.Groups[1].Value -replace '\s+', ' '
Yes ('it says the log keeps each line for ' + $days + ' days') ($sec -match ('launcher\.log, the one described above\. Each line is kept for ' + $days + ' days'))
Yes ('and the support reports are kept for ' + $days + ' days') ($sec -match ('Support reports.*Each is kept for ' + $days + ' days'))
Yes 'it names the Discord sign-in, name and picture, until uninstall' ($sec -match 'Your Discord sign-in.*name and picture.*until you uninstall')
Yes 'it says the box keeps only the saves and settings and the rest goes either way' ($sec -match 'Keep this build''s saves and settings' -and $sec -match 'go either way')
# The launcher.log entry among the logs sent when a session ends (#3627).
$logPara = [regex]::Match($privacy, '(?s)\n- \*\*launcher\.log\*\*(.*?)\n(?:- |\n)').Groups[1].Value -replace '\s+', ' '
Yes 'the log''s paragraph names the voice address and port, the profile number and the microphone' ($logPara -match 'address and port' -and $logPara -match 'profile number' -and $logPara -match 'microphone')
Yes ('the keeping times say the copy on the PC keeps ' + $days + ' days') (($privacy -replace '\s+', ' ') -match ('The copy on your PC keeps each line for ' + $days + ' days'))

# ---- 1 and 3: the launcher, built and run --------------------------------------
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$T = Join-Path $Scratch ('local-keep-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $T

$driver = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Thornswood
{
    static class LocalKeepTest
    {
        static int fails;
        static void Yes(string what, bool ok)
        {
            Console.WriteLine((ok ? "PASS  " : "FAIL  ") + what);
            if (!ok) fails++;
        }
        static string Stamp(DateTime t) { return t.ToString("yyyy-MM-dd HH:mm:ss"); }
        static void Put(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, text, new UTF8Encoding(false));
        }
        static string Text(string path) { return File.Exists(path) ? File.ReadAllText(path) : null; }

        static int Main(string[] args)
        {
            string t = args[0];
            // The farewell and anything else the uninstall writes to the temp
            // folder land in the scratch folder, never the runner's own.
            Environment.SetEnvironmentVariable("TMP", t);
            Environment.SetEnvironmentVariable("TEMP", t);
            DateTime now = DateTime.Now;

            Log(Path.Combine(t, "log"), now);
            Reports(Path.Combine(t, "reports"), now);
            Tidy(Path.Combine(t, "tidy"), now);
            // The handover script is cmd's, so the uninstall runs on Windows.
            if (args.Length > 1 && args[1] == "uninstall") Uninstalls(t);

            Console.WriteLine("driver: done, " + fails + " failed");
            return fails == 0 ? 0 : 1;
        }

        // ---- 1: the log ------------------------------------------------------
        static void Log(string dir, DateTime now)
        {
            string log = Path.Combine(dir, "launcher.log");
            string old1 = Stamp(now.AddDays(-45)) + "  Voice: configured for voice.example:7789 as profile 12" + "\r\n";
            string trace = "System.Exception: an old fault\r\n   at Old.Place()\r\n";
            string old2 = Stamp(now.AddDays(-31)) + "  an old line" + "\r\n";
            string keep = Stamp(now.AddDays(-29)) + "  the first line inside the rule" + "\r\n" +
                          "   at Kept.Trace()\r\n" +
                          Stamp(now.AddMinutes(-5)) + "  a line from today" + "\r\n" +
                          Stamp(now.AddDays(-60)) + "  a clock that went back, after a kept line" + "\r\n";
            Put(log, old1 + trace + old2 + keep);
            int gone = LocalKeep.PruneLog(log, now);
            Yes("a log past " + LocalKeep.Days + " days says it took the 4 lines before its first line within them", gone == 4);
            Yes("and what is left is the rest of the file, byte for byte", Text(log) == keep);
            Yes("and the file it wrote beside the log is gone", !File.Exists(log + ".new"));

            DateTime was = File.GetLastWriteTimeUtc(log);
            Yes("a log already inside the rule is left alone", LocalKeep.PruneLog(log, now) == 0 && Text(log) == keep && File.GetLastWriteTimeUtc(log) == was);

            Put(log, old1 + trace + old2);
            Yes("a log that is all old says every line went", LocalKeep.PruneLog(log, now) == 4);
            Yes("and is deleted", !File.Exists(log));

            Put(log, "no stamp here\r\nnor here\r\n");
            File.SetLastWriteTime(log, now.AddDays(-40));
            Yes("a log with no stamp, last written 40 days ago, is deleted", LocalKeep.PruneLog(log, now) == 2 && !File.Exists(log));
            Put(log, "no stamp here\r\n");
            Yes("one with no stamp written today is kept", LocalKeep.PruneLog(log, now) == 0 && File.Exists(log));

            Yes("no log is nothing to do", LocalKeep.PruneLog(Path.Combine(dir, "none.log"), now) == 0);
        }

        // ---- 1: the support zips ---------------------------------------------
        static void Reports(string dir, DateTime now)
        {
            string oldZip = Path.Combine(dir, "thornswood-20260901-1200.zip");
            string newZip = Path.Combine(dir, "thornswood-20261025-1200.zip");
            string theirs = Path.Combine(dir, "my-own-notes.zip");
            Put(oldZip, "old"); File.SetLastWriteTime(oldZip, now.AddDays(-31));
            Put(newZip, "new"); File.SetLastWriteTime(newZip, now.AddDays(-2));
            Put(theirs, "mine"); File.SetLastWriteTime(theirs, now.AddDays(-90));
            Yes("a support zip older than " + LocalKeep.Days + " days goes, and only it", LocalKeep.PruneReports(dir, now) == 1 && !File.Exists(oldZip));
            Yes("a newer one stays", File.Exists(newZip));
            Yes("a file the launcher did not make stays, however old", File.Exists(theirs));
            Yes("no folder is nothing to do", LocalKeep.PruneReports(Path.Combine(dir, "none"), now) == 0);
        }

        // ---- 1: Tidy, on a scratch install -----------------------------------
        static void Tidy(string root, DateTime now)
        {
            Directory.CreateDirectory(Path.Combine(root, "Launcher"));
            Directory.CreateDirectory(Path.Combine(root, "Profile"));
            Paths.Init(root);
            string zip = Path.Combine(Diag.ReportDir, "thornswood-20260801-0900.zip");
            Put(zip, "old"); File.SetLastWriteTime(zip, now.AddDays(-50));
            string kept = Stamp(now.AddDays(-1)) + "  yesterday" + "\r\n";
            Put(Paths.LogFile, Stamp(now.AddDays(-50)) + "  long ago" + "\r\n" + kept);
            LocalKeep.Tidy(now);
            string after = Text(Paths.LogFile) ?? "";
            Yes("Tidy cuts Profile\\launcher.log and deletes the old zip in Profile\\Reports", after.StartsWith(kept) && !File.Exists(zip));
            Yes("and says so in the log, after the cut", after.Contains("Kept to the last " + LocalKeep.Days + " days on this PC: removed 1 line of launcher.log and 1 support report older than that."));
        }

        // ---- 3: uninstall ------------------------------------------------------
        static string root;
        static string[] saves;

        static void Install(string at)
        {
            root = at;
            Directory.CreateDirectory(root);
            Put(Path.Combine(root, "Launcher\\Thornswood.exe"), "exe");
            Put(Path.Combine(root, "config.json"), "{}");
            Paths.Init(root);
            string p = Paths.ProfileDir;
            Put(Paths.LogFile, "2026-10-26 12:00:00  a line\r\n");
            foreach (string f in Discord.AccountFiles(p)) Put(f, "account");
            Put(Path.Combine(p, "VoiceBrowser\\EBWebView\\Default\\Cache\\data_0"), "cache");
            Put(Path.Combine(p, "MusicBrowser\\EBWebView\\Local State"), "state");
            Put(Path.Combine(Diag.ReportDir, "thornswood-20261026-1200.zip"), "zip");
            saves = new string[]
            {
                Path.Combine(p, "MyGames\\Saves\\Save1.ess"),
                Path.Combine(p, "Characters\\characters.json"),
                Path.Combine(p, "swap.json"),
                Path.Combine(p, "stats.txt"),
                Path.Combine(p, "installed-into-game.txt"),
                Paths.CfgFile,
            };
            foreach (string s in saves) if (!File.Exists(s)) Put(s, "kept");
        }

        static bool Gone(string path) { return !File.Exists(path) && !Directory.Exists(path); }

        static int RunScript(string[] targets, string note, string name)
        {
            // The script waits for the launcher's process to end. Here that is
            // a process that has already ended, so it goes straight on.
            var done = Process.Start(new ProcessStartInfo("cmd.exe", "/c exit 0") { CreateNoWindow = true, UseShellExecute = false });
            done.WaitForExit();
            string text = Uninstall.Script(targets, done.Id, note);
            if (text == null) return -1;
            string script = Path.Combine(Path.GetDirectoryName(root), name + ".cmd");
            File.WriteAllText(script, text, new UTF8Encoding(false));
            var run = Process.Start(new ProcessStartInfo("cmd.exe", "/c \"" + script + "\"") { CreateNoWindow = true, UseShellExecute = false });
            if (!run.WaitForExit(120000)) { try { run.Kill(); } catch { } return -2; }
            return run.ExitCode;
        }

        static void Uninstalls(string t)
        {
            // Kept: only what is not a save or a setting goes.
            Install(Path.Combine(t, "kept", "Thornswood"));
            string[] notSaves = LocalKeep.NotSaves();
            string[] targets = Uninstall.Targets(true, false);
            var list = new List<string>(targets);
            bool all = true;
            foreach (string n in notSaves) if (!list.Contains(n)) all = false;
            Yes("with the box ticked, Targets holds every one of LocalKeep.NotSaves (" + notSaves.Length + ")", all && notSaves.Length == 9);
            Yes("and not Profile or config.json themselves", !list.Contains(Paths.ProfileDir) && !list.Contains(Paths.CfgFile));
            Yes("the handover script ran", RunScript(targets, null, "kept") >= 0);
            Yes("launcher.log is gone", Gone(Paths.LogFile));
            foreach (string f in Discord.AccountFiles(Paths.ProfileDir))
                Yes("Profile\\" + Path.GetFileName(f) + " is gone", Gone(f));
            Yes("Profile\\VoiceBrowser, the old voice browser's folder, is gone", Gone(Path.Combine(Paths.ProfileDir, "VoiceBrowser")));
            Yes("Profile\\MusicBrowser, the old music browser's folder, is gone", Gone(Path.Combine(Paths.ProfileDir, "MusicBrowser")));
            Yes("Profile\\Reports is gone", Gone(Diag.ReportDir));
            foreach (string s in saves)
                Yes(s.Substring(root.Length + 1) + " is still there", File.Exists(s) && Text(s) == (s == Paths.CfgFile ? "{}" : "kept"));
            Yes("the launcher's own folder went", Gone(Paths.LauncherDir));

            // The farewell, with the box ticked: one thing that would not go.
            string note = Uninstall.WriteFarewell(true, false);
            Console.WriteLine("farewell-kept: " + note);
            Put(Paths.LogFile, "held open");
            Console.WriteLine("stuck: " + Paths.LogFile);
            Console.WriteLine("root-kept: " + root);

            // Not kept: Profile and config.json go whole, as before.
            Install(Path.Combine(t, "whole", "Thornswood"));
            targets = Uninstall.Targets(false, false);
            list = new List<string>(targets);
            Yes("with the box unticked, Targets holds Profile and config.json", list.Contains(Paths.ProfileDir) && list.Contains(Paths.CfgFile));
            Yes("and the handover script ran", RunScript(targets, null, "whole") >= 0);
            Yes("Profile went whole, the saves with it", Gone(Paths.ProfileDir));
            Yes("and config.json", Gone(Paths.CfgFile));
            Yes("and with nothing left the install folder went too", Gone(root));
        }
    }
}
'@

$dll = $null
try { $dll = Build-LauncherCode -Launcher -Source $driver -Exe -Main 'Thornswood.LocalKeepTest' }
catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'the whole launcher and the driver build the way the project does' ($null -ne $dll)
if ($null -eq $dll) { Done }

$out = Invoke-LauncherExe $dll $T $(if ($OnWindows) { 'uninstall' } else { 'tidy-only' }) 2>&1 | ForEach-Object { "$_" }
$farewell = $null; $stuck = $null; $rootKept = $null
foreach ($l in $out) {
    if ($l -match '^PASS  ') { $script:pass++; Write-Host $l }
    elseif ($l -match '^FAIL  ') { $script:fail++; Write-Host $l }
    elseif ($l -match '^farewell-kept: (.+)$') { $farewell = $Matches[1] }
    elseif ($l -match '^stuck: (.+)$') { $stuck = $Matches[1] }
    elseif ($l -match '^root-kept: (.+)$') { $rootKept = $Matches[1] }
    elseif ($l -match '^driver: ') { }
    else { Write-Host $l }
}
Yes 'the driver ran and reported' (@($out | Where-Object { $_ -match '^driver: ' }).Count -eq 1)
if (-not $OnWindows) {
    Write-Host 'SKIP  3, the uninstall on a scratch install: its handover script is cmd''s and its farewell is Windows PowerShell''s, which only Windows has'
    try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host "      (scratch left at $T)" }
    Done
}
$winps = Get-WindowsPowerShell

# ---- 3: the farewell, run with its message printed instead of shown -----------
function Farewell([string]$note) {
    $src = [IO.File]::ReadAllText($note)
    $show = '[void][System.Windows.Forms.MessageBox]::Show($msg, ''Thornswood'', ''OK'', ''Information'')'
    if (-not $src.Contains($show)) { return $null }
    $copy = Join-Path $T ('farewell-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.ps1')
    [IO.File]::WriteAllText($copy, $src.Replace($show, 'Write-Output $msg'), (New-Object Text.UTF8Encoding($false)))
    (& $winps -NoProfile -ExecutionPolicy Bypass -File $copy 2>&1 | Out-String)
}
Yes 'the driver wrote the farewell into its own temp folder' ($farewell -and $farewell.StartsWith($T) -and (Test-Path -LiteralPath $farewell))
if ($farewell -and (Test-Path -LiteralPath $farewell)) {
    $said = Farewell $farewell
    Yes 'the farewell shows its message with one line, which this swaps for printing it' ($null -ne $said)
    if ($null -ne $said) {
        Yes 'it says what was left in the kept install: Profile, as the saves and settings' ($said -match 'Profile  -  your characters, saves and settings' -and $said -match 'config\.json  -  your settings')
        Yes 'and names the log it should have removed and could not' ($stuck -and $said.Contains('could not be removed') -and $said.Contains($stuck))
        Remove-Item -LiteralPath $stuck -Force
        $said = Farewell $farewell
        Yes 'with everything gone that should have, it says nothing of the kind' ($null -ne $said -and -not $said.Contains('could not be removed') -and $said.Contains('Thornswood is uninstalled'))
    }
}

try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host "      (scratch left at $T)" }
Done
