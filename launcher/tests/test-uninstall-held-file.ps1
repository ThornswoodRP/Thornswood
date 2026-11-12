<#
  test-uninstall-held-file.ps1

      pwsh -NoProfile -File .\launcher\tests\test-uninstall-held-file.ps1

  On One on 12 Nov 2026 a full uninstall (saves not kept) left
  C:\Thornswood\Profile behind with everything in it, the Discord sign-in
  among it, and its farewell called the folder "not Thornswood's, so it was
  left alone". Measured in that Profile's launcher.log:

      Menu music: the theme is on, from C:\Thornswood\Profile\Music\thornswood-theme.mp3
      Swallowed in Uninstall.DeleteTree, delete: The process cannot access the
        file '...\Profile\Music\thornswood-theme.mp3' because it is being used
        by another process.
      Swallowed in Uninstall.RemoveNow, C:\Thornswood\Profile: The directory
        is not empty. : '...\Profile\Music'.

  Three faults, one after the other. The launcher's own menu theme was still
  playing its track out of Profile\Music while the uninstall deleted Profile.
  DeleteTree threw out of its walk at that first folder, so nothing else in
  Profile was even tried. And the farewell knew no reason for a Profile it had
  set out to remove, so it called the launcher's own folder somebody else's.

  WHAT THIS HOLDS THE LAUNCHER TO.
    1. Uninstall.Begin ends the menu music (MenuMusic.End) before anything is
       deleted, beside Hold.Release. End waits until the playback's thread has
       closed the track, the thread closes the track before it touches the
       sound device, and once ended Decide never makes a playback again.
    2. Run: the theme played from a scratch Profile\Music, then End, leaves a
       file that can be deleted at once, and Decide afterwards opens nothing.
       Where the playback really got a sound device (a Windows machine with
       one), the track is shown to be held while it plays, the fault itself.
    3. Run, on Windows: RemoveNow on a Profile with one file held open deletes
       everything else in it, leaves only the held file and the folders it is
       in, and the farewell, run as the uninstall runs it with its message box
       swapped for printing, calls that Profile Thornswood's own and never
       "not Thornswood's". A folder nobody set out to remove still is.
    4. Run: OursInRoot names what the farewell can find in the install folder:
       Profile and config.json when the saves go, neither when they stay.
    5. The launcher itself. Velopack's setup puts it in a folder of its own
       (%LocalAppData%\Thornswood) with shortcuts and its own Installed apps
       entry, and on One the same day the setup afterwards said Thornswood was
       already installed: the uninstall never ran Velopack's uninstall.
       Finish now hands the handover script Velopack's Update.exe, and the
       script, run by cmd with a stand in that writes down how it was called,
       runs it with --uninstall --silent once the install folder has gone and
       before the farewell; with none, it runs nothing of the kind.
    6. The dev build copied beside Root before one install carried both
       channels removed itself after a guessed three seconds (ping -n 4), held
       files or not. Its script waits for the launcher's own process to end,
       the way the uninstall's does.

  HOW. The whole launcher and a driver are built into one program the way the
  project builds (the .NET 10 SDK, tests\Launcher-Csc.ps1) and run on a
  scratch install. Off Windows an open file can be deleted and Windows
  PowerShell is not there, so part 3 says SKIP; part 2 still runs, where the
  playback ends without a sound device.

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

$uninstallSrc = Read 'launcher\app\Uninstall.cs'
$musicSrc = Read 'launcher\app\MenuMusic.cs'
$theme = Join-Path $Repo 'game\ui\thornswood-theme.mp3'

# ---- 1: by text ----------------------------------------------------------------
$begin = [regex]::Match($uninstallSrc, '(?s)public static string\[\] Begin\(Config cfg, bool keepSaves, bool deleteMods, Action<string> say\)\s*\{(.*?)return Targets\(keepSaves, deleteMods\);')
Yes 'Uninstall.Begin is found' $begin.Success
$b = $begin.Groups[1].Value
$end = $b.IndexOf('MenuMusic.End();')
Yes 'Begin ends the menu music, after Hold.Release and before anything is deleted' ($end -gt $b.IndexOf('Hold.Release();') -and $b.IndexOf('Hold.Release();') -ge 0 -and $end -lt $b.IndexOf('Swap.Restore();') -and $end -lt $b.IndexOf('DropScratch(say);'))
Yes 'MenuMusic.End waits for the playback to let go of the track' ($musicSrc -match '(?s)public static void End\(\)\s*\{\s*ended = true;.*?Close\(\);\s*if \(p != null\) p\.WaitReleased\(\);')
Yes 'and once ended Decide makes no playback' ($musicSrc -match '(?s)public static void Decide\(bool play, double volume\)\s*\{\s*if \(ended\) return;')
$fin = [regex]::Match($musicSrc, '(?s)finally\s*\{(.*?)\n                \}')
Yes 'the playback closes the track and says so before it touches the sound device' ($fin.Success -and $fin.Groups[1].Value.IndexOf('file.Dispose()') -ge 0 -and $fin.Groups[1].Value.IndexOf('file.Dispose()') -lt $fin.Groups[1].Value.IndexOf('released.Set();') -and $fin.Groups[1].Value.IndexOf('released.Set();') -lt $fin.Groups[1].Value.IndexOf('waveOutReset'))
Yes 'DeleteTree goes on past a folder it could not remove' ($uninstallSrc -match 'else \{ try \{ DeleteTree\(sub\); \} catch \(Exception ex\) \{ Swallow\.Note\(')
Yes 'the farewell gives what Targets set out to remove a reason of its own' ($uninstallSrc -match 'foreach \(string name in OursInRoot\(keepSaves, deleteMods\)\)')
Yes 'the theme the launcher plays is in the repository' (Test-Path -LiteralPath $theme)
Yes 'Finish hands the script Velopack''s Update.exe (AppUninstaller)' ($uninstallSrc -match 'Script\(targets, Process\.GetCurrentProcess\(\)\.Id, note, AppUninstaller\(\)\)' -and $uninstallSrc -match '(?s)static string AppUninstaller\(\).*?Velo\.Installed.*?Velo\.Locator\.UpdateExePath')
$shellSrc = Read 'launcher\app\Shell.cs'
Yes 'the uninstall''s first question names the launcher''s own folder among what goes' ($shellSrc -match 'goes\.AppendLine\("    " \+ Velo\.Locator\.RootAppDir')
$devSrc = Read 'launcher\app\DevBuild.cs'
$self = [regex]::Match($devSrc, '(?s)public static string RemoveSelf\(\)(.*?)Process\.Start\(psi\);')
Yes 'the old dev copy''s removal waits on its own process, not a guessed time' ($self.Success -and -not $self.Groups[1].Value.Contains('ping 127.0.0.1') -and $self.Groups[1].Value.Contains('Process.GetCurrentProcess().Id') -and $self.Groups[1].Value.Contains('goto wait'))

# ---- 2, 3 and 4: the launcher, built and run -----------------------------------
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$T = Join-Path $Scratch ('held-file-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $T

$driver = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace Thornswood
{
    static class HeldFileTest
    {
        static int fails;
        static void Yes(string what, bool ok)
        {
            Console.WriteLine((ok ? "PASS  " : "FAIL  ") + what);
            if (!ok) fails++;
        }
        static void Put(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, text, new UTF8Encoding(false));
        }
        static bool Gone(string path) { return !File.Exists(path) && !Directory.Exists(path); }
        static bool CanDelete(string path)
        {
            try { File.Delete(path); return !File.Exists(path); }
            catch { return false; }
        }

        static int Main(string[] args)
        {
            string t = args[0];
            string theme = args[1];
            bool windows = args.Length > 2 && args[2] == "windows";
            Environment.SetEnvironmentVariable("TMP", t);
            Environment.SetEnvironmentVariable("TEMP", t);

            Music(Path.Combine(t, "music", "Thornswood"), theme);
            InRoot(Path.Combine(t, "names", "Thornswood"));
            Scripts(Path.Combine(t, "script", "Thornswood"), windows);
            if (windows) Held(Path.Combine(t, "held", "Thornswood"));

            Console.WriteLine("driver: done, " + fails + " failed");
            return fails == 0 ? 0 : 1;
        }

        static void Install(string root)
        {
            Directory.CreateDirectory(root);
            Put(Path.Combine(root, "Launcher", "Thornswood.exe"), "exe");
            Put(Path.Combine(root, "config.json"), "{}");
            Paths.Init(root);
            Put(Paths.LogFile, "2026-11-12 12:41:44  a line\r\n");
        }

        // ---- 2: the menu music lets go of its track ---------------------------
        static void Music(string root, string theme)
        {
            Install(root);
            string track = Path.Combine(Paths.ProfileDir, "Music", "thornswood-theme.mp3");
            Directory.CreateDirectory(Path.GetDirectoryName(track));
            File.Copy(theme, track, true);

            var said = new List<string>();
            Action<string> say = delegate(string m) { lock (said) said.Add(m); };
            MenuMusic.Start(track, 0, "Thornswood test", null, say);
            int opened = MenuMusic.Opened;
            MenuMusic.Decide(true, 0);
            Yes("the theme makes a playback when it is wanted", MenuMusic.Opened == opened + 1);

            // How far the playback got: playing, or ended without a sound
            // device. Read from what it says, the way the log reads it.
            string got = null;
            var watch = Stopwatch.StartNew();
            while (got == null && watch.Elapsed.TotalSeconds < 20)
            {
                lock (said)
                    foreach (string m in said)
                        if (m.StartsWith("Menu music: the theme is on") || m.StartsWith("Menu music: stopped") ||
                            m.StartsWith("Menu music: Windows would not open") || m.StartsWith("Menu music: did not start") ||
                            m.StartsWith("Menu music: waveOut")) { got = m; break; }
                if (got == null) Thread.Sleep(50);
            }
            Console.WriteLine("      the playback said: " + (got ?? "nothing in 20 s"));
            bool playing = got != null && got.StartsWith("Menu music: the theme is on");
            if (playing && OperatingSystem.IsWindows())
            {
                bool held;
                try { using (new FileStream(track, FileMode.Open, FileAccess.Read, FileShare.None)) { } held = false; }
                catch (IOException) { held = true; }
                Yes("while it plays, Windows will not let the track go (the fault on One)", held);
            }
            else Console.WriteLine("SKIP  the track held while it plays: this machine gave the playback no sound device");

            MenuMusic.End();
            Yes("after MenuMusic.End the track can be deleted at once", CanDelete(track));
            MenuMusic.Decide(true, 0);
            Yes("and Decide after End makes no new playback", MenuMusic.Opened == opened + 1);
            MenuMusic.End();
            Yes("End again, with nothing playing, returns", true);
        }

        // ---- 4: what the farewell can find in the install folder -------------
        static void InRoot(string root)
        {
            Install(root);
            var gone = new List<string>(Uninstall.OursInRoot(false, false));
            Yes("with the saves going, OursInRoot names Profile, config.json and Launcher",
                gone.Contains("Profile") && gone.Contains("config.json") && gone.Contains("Launcher"));
            Yes("and nothing that is not directly in the install folder", !gone.Exists(delegate(string n) { return n.Contains("\\") || n.Contains("/"); }));
            var kept = new List<string>(Uninstall.OursInRoot(true, false));
            Yes("with the saves kept, neither Profile nor config.json", !kept.Contains("Profile") && !kept.Contains("config.json") && kept.Contains("Launcher"));
        }

        // ---- 5: the launcher itself goes by Velopack's own uninstall --------
        static void Scripts(string root, bool windows)
        {
            Install(root);
            string upd = Path.Combine(Path.GetDirectoryName(root), "app", "Update.cmd");
            string said = Path.Combine(Path.GetDirectoryName(root), "app", "called.txt");
            // A stand in for Update.exe: writes down its arguments, and whether
            // the install folder was still there when it ran.
            Put(upd, "@echo off\r\n(echo %*& if exist \"" + root + "\" (echo root still there) else (echo root gone)) > \"" + said + "\"\r\n");
            string[] targets = Uninstall.Targets(false, false);
            string with = Uninstall.Script(targets, 1, null, upd) ?? "";
            string without = Uninstall.Script(targets, 1, null) ?? "";
            Yes("given Update.exe, the script runs it with --uninstall --silent", with.Contains("call \"" + upd + "\" --uninstall --silent"));
            Yes("after the install folder and before the farewell", with.IndexOf("--uninstall") > with.IndexOf("rmdir \"" + Paths.Root + "\""));
            Yes("given none, it runs no uninstall of the kind", !without.Contains("--uninstall"));
            if (!windows) return;

            var done = Process.Start(new ProcessStartInfo("cmd.exe", "/c exit 0") { CreateNoWindow = true, UseShellExecute = false });
            done.WaitForExit();
            string text = Uninstall.Script(targets, done.Id, null, upd);
            string script = Path.Combine(Path.GetDirectoryName(root), "handover.cmd");
            File.WriteAllText(script, text, new UTF8Encoding(false));
            var run = Process.Start(new ProcessStartInfo("cmd.exe", "/c \"" + script + "\"") { CreateNoWindow = true, UseShellExecute = false });
            bool ended = run.WaitForExit(120000);
            if (!ended) { try { run.Kill(); } catch (Exception ex) { Console.WriteLine("      could not stop the script: " + ex.Message); } }
            string got = File.Exists(said) ? File.ReadAllText(said) : "";
            Yes("run by cmd, the script ran the stand in with --uninstall --silent", ended && got.Contains("--uninstall --silent"));
            Yes("and only once the install folder had gone", got.Contains("root gone"));
        }

        // ---- 3: one held file stops only itself -------------------------------
        static void Held(string root)
        {
            Install(root);
            string p = Paths.ProfileDir;
            string track = Path.Combine(p, "Music", "thornswood-theme.mp3");
            Put(track, "theme");
            var others = new List<string>();
            foreach (string f in Discord.AccountFiles(p)) { Put(f, "account"); others.Add(f); }
            foreach (string rel in new[] { "MyGames\\Skyrim.ini", "OwnGame\\files.txt", "accepted.json", "voice-port.txt" })
            {
                string f = Path.Combine(p, rel);
                Put(f, "ours");
                others.Add(f);
            }
            others.Add(Paths.LogFile);

            string[] later;
            using (new FileStream(track, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                later = Uninstall.RemoveNow(Uninstall.Targets(false, false), Path.Combine(root, "..", "elsewhere"));
            }
            Yes("RemoveNow leaves the script nothing when the launcher runs from outside", later.Length == 0);
            bool rest = true;
            foreach (string f in others) if (!Gone(f)) { rest = false; Console.WriteLine("      still there: " + f); }
            Yes("with one file in Profile held open, everything else in Profile went", rest);
            Yes("Profile's other folders went with it", Gone(Path.Combine(p, "MyGames")) && Gone(Path.Combine(p, "OwnGame")));
            Yes("only the held file stayed, and the folders it is in", File.Exists(track) && Directory.GetFileSystemEntries(p).Length == 1);
            Yes("config.json and the launcher's folder went", Gone(Paths.CfgFile) && Gone(Paths.LauncherDir));

            Put(Path.Combine(root, "notes-of-mine.txt"), "mine");
            string note = Uninstall.WriteFarewell(false, false);
            Console.WriteLine("farewell-held: " + note);
        }
    }
}
'@

$dll = $null
try { $dll = Build-LauncherCode -Launcher -Source $driver -Exe -Main 'Thornswood.HeldFileTest' }
catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'the whole launcher and the driver build the way the project does' ($null -ne $dll)
if ($null -eq $dll) { Done }

$out = Invoke-LauncherExe $dll $T $theme $(if ($OnWindows) { 'windows' } else { 'elsewhere' }) 2>&1 | ForEach-Object { "$_" }
$farewell = $null
foreach ($l in $out) {
    if ($l -match '^PASS  ') { $script:pass++; Write-Host $l }
    elseif ($l -match '^FAIL  ') { $script:fail++; Write-Host $l }
    elseif ($l -match '^farewell-held: (.+)$') { $farewell = $Matches[1] }
    elseif ($l -match '^driver: ') { }
    else { Write-Host $l }
}
Yes 'the driver ran and reported' (@($out | Where-Object { $_ -match '^driver: ' }).Count -eq 1)
if (-not $OnWindows) {
    Write-Host 'SKIP  3, one held file in Profile: off Windows an open file can be deleted, and the farewell is Windows PowerShell''s'
    try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host "      (scratch left at $T)" }
    Done
}

# ---- 3: the farewell, run with its message printed instead of shown -----------
$winps = Get-WindowsPowerShell
Yes 'the driver wrote the farewell into its own temp folder' ($farewell -and $farewell.StartsWith($T) -and (Test-Path -LiteralPath $farewell))
if ($farewell -and (Test-Path -LiteralPath $farewell)) {
    $src = [IO.File]::ReadAllText($farewell)
    $show = '[void][System.Windows.Forms.MessageBox]::Show($msg, ''Thornswood'', ''OK'', ''Information'')'
    Yes 'the farewell shows its message with one line, which this swaps for printing it' $src.Contains($show)
    $copy = Join-Path $T 'farewell-printed.ps1'
    [IO.File]::WriteAllText($copy, $src.Replace($show, 'Write-Output $msg'), (New-Object Text.UTF8Encoding($false)))
    $said = (& $winps -NoProfile -ExecutionPolicy Bypass -File $copy 2>&1 | Out-String)
    Write-Host ($said.Trim() -replace '(?m)^', '      ')
    Yes 'it calls the Profile that could not go Thornswood''s own, and says it should have gone' ($said -match 'Profile  -  Thornswood''s own\. It should have gone, but could not be removed\.')
    Yes 'and never "not Thornswood''s"' (-not ($said -match 'Profile  -  not Thornswood'))
    Yes 'a file nobody set out to remove is still not Thornswood''s' ($said -match 'notes-of-mine\.txt  -  not Thornswood''s')
}

try { Remove-Item -LiteralPath $T -Recurse -Force } catch { Write-Host "      (scratch left at $T)" }
Done
