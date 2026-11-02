<#
  test-play-progress.ps1

      pwsh -NoProfile -File .\launcher\tests\test-play-progress.ps1

  The Play button as a progress bar, issue #1145.

  Patrick, 29 Sep: "when the launcher is preparing the own game folder or
  doing an update I want a progress bar on the Play button and not just
  updating or preparing the game folder". Done when: the button fills as a
  progress bar with a percentage and what it is doing in plain words, driven
  by real byte or file counts, never goes backwards, shows a steady state
  when the size is unknown, and returns to Play when done.

  What this drives:

    1. launcher\app\Progress.cs (PlayBar, PlayProgress, ProgressStep) with
       Swallow.cs, built the way the project builds them, by the .NET 10 SDK
       (tests\Launcher-Csc.ps1, #4823, on any machine that has it), into a
       small program that
       feeds it the reports each piece of work makes, in the order they make
       them: an update synced to its release record (checking files, then the
       download), several packs, a self-update, the client download, the own
       game folder (preparing, then checking), a download whose size nobody
       said, and a failure. At every step it checks the button's words, the
       fill, that nothing goes backwards, the moving state, that a burst of
       reports is one redraw, and that the button says Play (or the error it
       said before) once the work ends.
    2. The wiring, read from the real files: the fill in the Primary theme's
       template in MainWindow.axaml, the timer and the fill in ShellProgress.cs,
       DrawStatus putting the words first and keeping the button off, and
       every caller (Updater.Download, Sync, RunUpdate, the client repair,
       OwnGame.Make and Refresh, StartOwnGame, Verify.Bytes) reporting and
       closing what it opens.

  Read only apart from its own temp folder, which it removes.
#>
[CmdletBinding()]
param([string]$AppDir, [string]$Xaml)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's compiler and C# version (#498)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $AppDir) { $AppDir = Join-Path $Repo 'launcher\app' }
if (-not $Xaml) { $Xaml = Join-Path $AppDir 'MainWindow.axaml' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host "$script:pass passed, $script:fail failed"
    exit $(if ($script:fail) { 1 } else { 0 })
}
function Read-Text([string]$p) { return [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }

# Everything between the first line matching $start and the brace that closes it.
function Body([string]$src, [string]$start) {
    $at = $src.IndexOf($start)
    if ($at -lt 0) { return '' }
    $open = $src.IndexOf('{', $at)
    $depth = 0
    for ($i = $open; $i -lt $src.Length; $i++) {
        if ($src[$i] -eq '{') { $depth++ }
        elseif ($src[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $src.Substring($at, $i - $at + 1) } }
    }
    return ''
}

$progressPath = Join-Path $AppDir 'Progress.cs'
Yes 'Progress.cs is in the launcher source' (Test-Path -LiteralPath $progressPath)
if (-not (Test-Path -LiteralPath $progressPath)) { Done }

# ---- 1. build the real model and drive it --------------------------------------
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$driver = @'
using System;
using System.Collections.Generic;
namespace Thornswood
{
    static class Paths { public static string LogFile; }
    static class Drive
    {
        static int pass, fail;
        static PlayBar bar = new PlayBar();
        static List<string> said = new List<string>();
        const long MB = 1048576;

        static void Yes(string what, bool ok)
        {
            if (ok) { pass++; Console.WriteLine("PASS  " + what); }
            else { fail++; Console.WriteLine("FAIL  " + what + "   (text: \"" + bar.Text + "\", fill " + bar.Fill.ToString("0.000") + ", active " + bar.Active + ")"); }
        }
        static void Is(string what, string want)
        {
            Yes(what + ": \"" + want + "\"", bar.Text == want);
        }

        // What ShellProgress.cs does with every report.
        static void Sink(ProgressStep s)
        {
            if (s == null) bar.Stop(); else bar.Offer(s);
            if (bar.Active) said.Add(bar.Text);
        }

        static int Main()
        {
            PlayProgress.Sink = Sink;

            // ---- idle ------------------------------------------------------
            Yes("idle: the button is not working", !bar.Active);
            Yes("idle: the button says what it would anyway", bar.Caption("PLAY") == "PLAY");
            Yes("idle: nothing to redraw", !bar.TakeDirty());
            PlayProgress.Files("Checking files", 5, 10);
            PlayProgress.Part(10, 100);
            Yes("a report with no work open (Fix, Scan, the check before Play) does not touch the button", !bar.Active && !bar.Dirty);

            // ---- an update synced to its release record --------------------
            PlayProgress.Begin("Updating", 1);
            Yes("Begin: the button is working", bar.Active);
            Is("Begin: before anything is counted", "Updating ...");
            Yes("Begin: the fill is the moving state", bar.Fill < 0);
            Yes("Begin: a redraw is due", bar.TakeDirty());
            Yes("Begin: the caption replaces Play", bar.Caption("PLAY") == "Updating ...");

            PlayProgress.Files("Checking files", 1200, 2580);
            Is("checking the install", "Checking files 46%, 1,200 of 2,580 files");
            Yes("checking: fill is 1,200 of 2,580", Math.Abs(bar.Fill - 1200.0 / 2580) < 1e-9);
            PlayProgress.Files("Checking files", 1100, 2580);
            Is("a lower count in the same phase is dropped", "Checking files 46%, 1,200 of 2,580 files");
            Yes("  and the fill stays", Math.Abs(bar.Fill - 1200.0 / 2580) < 1e-9);
            PlayProgress.Report("Checking files", 0, 0, 0, 0, "files");
            Yes("a known total never turns back into an unknown one", bar.Fill > 0.4);
            PlayProgress.Files("Checking files", 2580, 2580);
            Is("checking finished", "Checking files 100%, 2,580 of 2,580 files");

            PlayProgress.Bytes("Updating", 0, 740 * MB);
            Is("a new phase starts from its own beginning", "Updating 0%, 0 of 740 MB");
            Yes("  its fill is empty, not the last phase's", bar.Fill == 0);
            bar.TakeDirty();
            int redraws = 0;
            for (long b = 1; b <= 310 * MB; b += 81920)
            {
                PlayProgress.Bytes("Updating", b, 740 * MB);
                if (b % (50 * 81920) == 1) { if (bar.TakeDirty()) redraws++; }
            }
            PlayProgress.Bytes("Updating", 310 * MB, 740 * MB);
            Is("downloading", "Updating 41%, 310 of 740 MB");
            Yes("downloading: fill is 310 of 740", Math.Abs(bar.Fill - 310.0 / 740) < 1e-9);
            Yes("3,968 reports make one redraw per timer tick, not one each (" + redraws + " ticks asked)", redraws <= 80 && redraws >= 1);
            Yes("  and the last one is still waiting for the next tick", bar.TakeDirty());
            Yes("  and only once", !bar.TakeDirty());
            PlayProgress.Bytes("Updating", 300 * MB, 740 * MB);
            Is("a download that restarts lower does not move the bar back", "Updating 41%, 310 of 740 MB");
            Yes("  nothing to redraw", !bar.TakeDirty());
            PlayProgress.Bytes("Updating", 740 * MB - 1, 740 * MB);
            Yes("one byte short is 99%, not 100%", bar.Text.StartsWith("Updating 99%"));
            PlayProgress.Bytes("Updating", 740 * MB, 740 * MB);
            Is("download finished", "Updating 100%, 740 of 740 MB");
            Yes("  fill is full", bar.Fill == 1);

            // ---- then the launcher itself -----------------------------------
            PlayProgress.Plan("Updating the launcher", 1, "updates");
            Is("the self-update is its own phase", "Updating the launcher ...");
            PlayProgress.Part(0, 3743496);
            PlayProgress.Part(1871748, 3743496);
            Is("the launcher download", "Updating the launcher 50%, 1.7 of 3.5 MB");
            PlayProgress.PartDone();
            PlayProgress.Part(10, 100);
            Is("a second download the plan did not count leaves it alone", "Updating the launcher 50%, 1.7 of 3.5 MB");

            PlayProgress.End();
            Yes("End: the button is not working", !bar.Active);
            Yes("End: the button says Play again", bar.Caption("PLAY") == "PLAY");
            Yes("End: a redraw is due, so it gets back to Play at once", bar.TakeDirty());
            Yes("End: the fill is empty", bar.Fill == 0);
            PlayProgress.End();
            Yes("a second End changes nothing", !bar.Active && !bar.Dirty);

            // ---- several packs: which one, and the bytes of the one under way
            PlayProgress.Begin("Updating", 3);
            PlayProgress.Part(0, 2825);
            PlayProgress.Part(1400, 2825);
            Is("pack one of three, half down", "Updating 16%, 0 of 3 updates");
            PlayProgress.Part(2825, 2825);
            PlayProgress.PartDone();
            Is("pack one in", "Updating 33%, 1 of 3 updates");
            PlayProgress.Part(0, 5000000);
            Is("the next pack starting does not move the bar back", "Updating 33%, 1 of 3 updates");
            PlayProgress.Part(2500000, 5000000);
            Is("pack two half down", "Updating 50%, 1 of 3 updates");
            PlayProgress.PartDone();
            PlayProgress.Part(0, -1);
            PlayProgress.Part(700000, -1);
            Is("pack three with no size said", "Updating 66%, 2 of 3 updates");
            PlayProgress.PartDone();
            Is("all three", "Updating 100%, 3 of 3 updates");
            PlayProgress.End();

            // ---- one small pack, in KB ---------------------------------------
            PlayProgress.Begin("Updating", 1);
            PlayProgress.Part(1400, 2825);
            Is("a small pack", "Updating 49%, 2 of 3 KB");
            PlayProgress.End();

            // ---- a size nobody said ------------------------------------------
            PlayProgress.Begin("Updating", 1);
            PlayProgress.Part(0, -1);
            Is("no size: the steady moving state", "Updating ...");
            Yes("  fill is the moving state", bar.Fill < 0);
            PlayProgress.Part(5 * MB + MB / 2, -1);
            Is("no size: how much so far", "Updating, 5.5 MB so far");
            Yes("  still moving", bar.Fill < 0);
            PlayProgress.Part(12 * MB, -1);
            Is("no size: more so far", "Updating, 12 MB so far");
            PlayProgress.Part(3 * MB, -1);
            Is("no size: less than before is dropped", "Updating, 12 MB so far");
            PlayProgress.End();

            // ---- the client repair -------------------------------------------
            PlayProgress.Begin("Updating", 1);
            PlayProgress.Part(0, 6573503);
            PlayProgress.Part(3286752, 6573503);
            Is("the client download", "Updating 50%, 3.1 of 6.2 MB");
            PlayProgress.End();

            // ---- the own game folder -----------------------------------------
            PlayProgress.Begin("Preparing the game folder", 0);
            Is("preparing, before the folder is walked", "Preparing the game folder ...");
            PlayProgress.Files("Preparing the game folder", 0, 2580);
            PlayProgress.Files("Preparing the game folder", 1200, 2580);
            Is("preparing", "Preparing the game folder 46%, 1,200 of 2,580 files");
            PlayProgress.Files("Preparing the game folder", 2580, 2580);
            PlayProgress.Files("Checking files", 1, 1);
            Is("one file is a file", "Checking files 100%, 1 of 1 file");
            PlayProgress.Files("Checking files", 40, 238);
            Is("a count that would move a finished phase back is dropped", "Checking files 100%, 1 of 1 file");

            // Two pieces of work at once: the button waits for both.
            PlayProgress.Begin("Updating", 1);
            PlayProgress.End();
            Yes("the first of two to finish leaves the button working", bar.Active);
            PlayProgress.End();
            Yes("the second puts it back", !bar.Active);

            // ---- an update downloading while the folder is prepared (#2210) --
            PlayProgress.FolderFirst(true);
            PlayProgress.Begin("Preparing the game folder", 0);
            PlayProgress.Files("Preparing the game folder", 300, 1000);
            Is("the folder has the button", "Preparing the game folder 30%, 300 of 1,000 files");
            var update = new System.Threading.Thread(delegate()
            {
                PlayProgress.Second(true);
                PlayProgress.Begin("Updating", 1);
                PlayProgress.Part(5 * MB, 20 * MB);
                PlayProgress.Bytes("Updating", 5 * MB, 20 * MB);
                PlayProgress.Second(false);
            });
            update.Start(); update.Join();
            Is("the update's reports beside it stay off the button", "Preparing the game folder 30%, 300 of 1,000 files");
            PlayProgress.Files("Preparing the game folder", 1000, 1000);
            PlayProgress.FolderFirst(false);
            PlayProgress.End();
            Yes("the folder done, the update still holds the button", bar.Active);
            update = new System.Threading.Thread(delegate()
            {
                PlayProgress.Second(true);
                PlayProgress.Part(10 * MB, 20 * MB);
                PlayProgress.Second(false);
            });
            update.Start(); update.Join();
            Is("then the update shows itself with its next report", "Updating 50%, 10 of 20 MB");
            PlayProgress.FolderFirst(true);
            PlayProgress.Bytes("Updating", 15 * MB, 20 * MB);
            Is("a thread not marked second still shows", "Updating 75%, 15 of 20 MB");
            PlayProgress.FolderFirst(false);
            PlayProgress.End();
            Yes("and the last End puts the button back", !bar.Active);

            // ---- a failure ---------------------------------------------------
            PlayProgress.Begin("Updating", 1);
            PlayProgress.Part(10 * MB, 20 * MB);
            PlayProgress.End();
            Yes("a failed update gives the button back its own error", bar.Caption("NO ANSWER FROM THE UPDATE SOURCE") == "NO ANSWER FROM THE UPDATE SOURCE");

            // ---- a sink that throws is noted, never thrown -------------------
            PlayProgress.Sink = delegate(ProgressStep s) { throw new Exception("broken sink"); };
            bool threw = false;
            try { PlayProgress.Begin("Updating", 1); PlayProgress.Part(1, 2); PlayProgress.End(); }
            catch (Exception) { threw = true; }
            Yes("a sink that throws never stops the work", !threw);
            PlayProgress.Sink = Sink;

            // ---- the words ---------------------------------------------------
            bool clean = said.Count > 20;
            foreach (string t in said)
                if (t.IndexOf((char)0x2014) >= 0 || t.IndexOf("player", StringComparison.OrdinalIgnoreCase) >= 0) clean = false;
            Yes("none of the " + said.Count + " captions has an em dash or the word player", clean);

            Console.WriteLine("RESULT " + pass + " " + fail);
            return fail == 0 ? 0 : 1;
        }
    }
}
'@
$exe = $null
try { $exe = Build-LauncherCode -File $progressPath, (Join-Path $AppDir 'Swallow.cs') -Source $driver -Exe }
catch { Write-Host ('      ' + $_.Exception.Message) }
Yes 'Progress.cs builds the way the project builds it' ($null -ne $exe)
if (-not $exe) { Done }
$out = Invoke-LauncherExe $exe 2>&1
$code = $LASTEXITCODE
foreach ($line in $out) {
    $l = [string]$line
    if ($l.StartsWith('PASS  ')) { $script:pass++; Write-Host $l }
    elseif ($l.StartsWith('FAIL  ')) { $script:fail++; Write-Host $l }
}
Yes 'the driver ran to the end' (($out | Where-Object { ([string]$_).StartsWith('RESULT ') }).Count -eq 1)
Yes 'the driver exits 0 only when every step passed' (($code -eq 0) -eq (($out | Where-Object { ([string]$_).StartsWith('FAIL  ') }).Count -eq 0))

# ---- 2. the wiring -----------------------------------------------------------------
$xamlText = Read-Text $Xaml
$pAt = $xamlText.IndexOf('<ControlTheme x:Key="Primary"')
$primary = if ($pAt -ge 0) { $xamlText.Substring($pAt, $xamlText.IndexOf('</ControlTheme>', $pAt) - $pAt) } else { '' }
Yes 'MainWindow.axaml: the Primary theme is there' ($primary.Length -gt 0)
$fillAt = $primary.IndexOf('Name="fill"')
Yes 'MainWindow.axaml: the Primary template has the fill' ($fillAt -ge 0)
Yes 'MainWindow.axaml: the fill sits over the face and under the words' ($fillAt -gt $primary.IndexOf('Name="b"') -and $fillAt -lt $primary.IndexOf('<ContentPresenter'))
$fillTag = if ($fillAt -ge 0) { $primary.Substring($primary.LastIndexOf('<', $fillAt), $primary.IndexOf('>', $fillAt) - $primary.LastIndexOf('<', $fillAt)) } else { '' }
Yes 'MainWindow.axaml: the fill starts hidden, empty, from the left, and takes no clicks' ($fillTag -match 'IsVisible="False"' -and $fillTag -match 'Width="0"' -and $fillTag -match 'HorizontalAlignment="Left"' -and $fillTag -match 'IsHitTestVisible="False"')
Yes 'MainWindow.axaml: the fill is the launcher''s accent colour, so every theme keeps its look' (([regex]::Matches($primary, 'Background="\{DynamicResource Accent\}"')).Count -ge 3)
Yes 'MainWindow.axaml: the button keeps its height' ($primary -match '<Setter Property="Height" Value="56"/>')
try {
    $doc = New-Object Xml.XmlDocument
    $doc.LoadXml($xamlText)
    Yes 'MainWindow.axaml still reads as XML' $true
} catch { Yes ('MainWindow.axaml still reads as XML: ' + $_.Exception.Message) $false }

$sp = Read-Text (Join-Path $AppDir 'ShellProgress.cs')
Yes 'ShellProgress.cs: the sink feeds the PlayBar and Stop on the end' ($sp -match 'PlayProgress\.Sink\s*=' -and $sp -match 'playBar\.Stop\(\)' -and $sp -match 'playBar\.Offer\(s\)')
Yes 'ShellProgress.cs: redraws on a timer every PlayBar.DrawEveryMs, only when something changed' ($sp -match 'FromMilliseconds\(PlayBar\.DrawEveryMs\)' -and $sp -match 'if \(playBar\.TakeDirty\(\)\) DrawPlayBar\(\)')
Yes 'ShellProgress.cs: one wake per run, not a BeginInvoke per report' ($sp -match 'Interlocked\.CompareExchange\(ref playBarTicking, 1, 0\)')
Yes 'ShellProgress.cs: finds the fill in the button''s template' ($sp -match 'btnPlay\.GetTemplateDescendants\(\)\.OfType<Control>\(\)\.FirstOrDefault\(c => c\.Name == "fill"\)')
Yes 'ShellProgress.cs: an unknown total slides a band steadily, for ever' ($sp -match 'IterationCount = IterationCount\.Infinite' -and $sp -match 'PlaybackDirection = PlaybackDirection\.Alternate')
Yes 'ShellProgress.cs: a known total sets the width from the fill' ($sp -match 'playFill\.Width = Math\.Max\(0, Math\.Min\(1\.0, f\)\) \* w')
Yes 'ShellProgress.cs: when the work ends the fill goes and DrawStatus puts Play or the reason back' ((Body $sp 'static void DrawPlayBar()') -match 'HidePlayFill\(\);\s*(//[^\n]*\n\s*)*DrawStatus\(\);')
Yes 'ShellProgress.cs: the words read on the fill and on the face (Ink, followed as the theme changes)' (
    $sp -match 'playInk = btnPlay\.Bind\(TemplatedControl\.ForegroundProperty, btnPlay\.GetResourceObservable\("Ink"\)\)' -and $sp -match 'if \(playInk != null\) \{ playInk\.Dispose\(\); playInk = null; \}')
Yes 'ShellProgress.cs: redrawn when the window is resized' ($sp -match 'btnPlay\.SizeChanged')

$shell = Read-Text (Join-Path $AppDir 'Shell.cs')
$draw = Body $shell 'static bool DrawStatus()'
Yes 'Shell.cs: WireProgress is called' ($shell -match 'WireProgress\(\);')
Yes 'DrawStatus: the button is off while work runs' ($draw -match '!working &&')
$wAt = $draw.IndexOf('if (working && !playing)')
Yes 'DrawStatus: the progress words come before every other reason' ($wAt -ge 0 -and $wAt -lt $draw.IndexOf('else if (ownGameBusy && !playing)') -and $wAt -lt $draw.IndexOf('else if (updatePending && !playing)'))
Yes 'DrawStatus: with no work, the fill goes' ($draw -match 'if \(!working\) HidePlayFill\(\);')
Yes 'DrawStatus: PLAY is still the last word' ($draw -match 'btnPlay\.Content = "PLAY";')
$heal = Body $shell 'static void HealClientBackground()'
Yes 'the client repair opens the button before it starts and closes it in its finally' ($heal -match 'PlayProgress\.Begin\("Updating", 1\)' -and $heal -match 'finally\s*\{[^}]*PlayProgress\.End\(\);')

$upd = Read-Text (Join-Path $AppDir 'Updater.cs')
$dl = Body $upd 'static string Download(Config cfg'
Yes 'Updater.Download reports each piece it reads' ($dl -match 'PlayProgress\.Part\(had, length\)' -and $dl -match 'PlayProgress\.PartDone\(\)')
Yes 'Updater.Download reads the size the server gives' ($dl -match 'long length = res\.Content\.Headers\.ContentLength \?\? -1;')
Yes 'Updater.Download no longer uses DownloadFile, and throws a half file away' ($dl -notmatch '\.DownloadFile\(' -and $dl -match 'File\.Delete\(tmp\)')
Yes 'Updater.Download still checks the url and the checksum' ($dl -match 'CheckUrl\(url\)' -and $dl -match 'Checksum did not match')

$sync = Read-Text (Join-Path $AppDir 'Sync.cs')
Yes 'Sync: checking the install counts every file' ($sync -match 'PlayProgress\.Files\("Checking files", \+\+looked, items\.Count\)')
Yes 'Sync: the downloads report their bytes against the total' ($sync -match 'PlayProgress\.Bytes\("Updating", before \+ Math\.Min\(had, f\.Value\), total\)')
Yes 'Sync: Transfer reports as it writes' ((Body $sync 'static void Transfer(') -match 'Http\.CopyBody\([^;]*n => onBytes\(had \+ n\)\);')
Yes 'Sync: packs after a record without its files are planned as downloads' ($sync -match 'PlayProgress\.Plan\("Updating", count, "updates"\)')

$su = Read-Text (Join-Path $AppDir 'ShellUpdate.cs')
# Since #2627 RunUpdate(after) does the work; Fix and, since #3201, Install
# now call it with what to do once the update is in or has failed.
$run = Body $su 'static void RunUpdate(Action<bool> after)'
Yes 'RunUpdate opens the button with one download per pack' ($run -match 'PlayProgress\.Begin\("Updating", downloads\)')
$stages = Read-Text (Join-Path $AppDir 'UpdateStages.cs')
# Since the launcher updates through Velopack (#4825), its download is
# VeloUpdate.FetchLauncher, which FetchUpdate calls.
$velo = Read-Text (Join-Path $AppDir 'VeloUpdate.cs')
Yes 'the update''s download: the self-update is its own phase' (
    (Body $stages 'public static Fetched FetchUpdate(') -match 'FetchLauncher\(launcher, log\);' -and
    (Body $velo 'public static void FetchLauncher(') -match 'PlayProgress\.Plan\("Updating the launcher", 1, "updates"\);\s*PlayProgress\.Part\(0, size\);')
Yes 'RunUpdate marks its thread second, so a folder being prepared keeps the button (#2210)' ($run -match 'PlayProgress\.Second\(true\);' -and $run -match 'finally \{ PlayProgress\.Second\(false\); \}')
Yes 'RunUpdate closes it when it finishes and when it fails, before DrawStatus' (([regex]::Matches($run, 'PlayProgress\.End\(\);\s*((updatePending|updating) = false;\s*)*DrawStatus\(\)')).Count -eq 2)

$sog = Read-Text (Join-Path $AppDir 'ShellOwnGame.cs')
# The overload that does the work. Since #1584 StartOwnGame(make, loud) only
# hands on to StartOwnGame(make, loud, then), which runs a step once the
# bring-up-to-date Play asked for has finished, and since #2627 that hands on
# to the one that also takes what to do when it fails, for Fix.
$start = Body $sog 'static bool StartOwnGame(bool make, bool loud, Action then, Action failed)'
Yes 'StartOwnGame opens the button' ($start -match 'PlayProgress\.Begin\(OwnGame\.Phase, 0\)')
$work = Body $sog 'static void FolderWork('
Yes 'the folder work closes it as soon as the work is over' ($work -match 'ownGameBusy = false;\s*PlayProgress\.End\(\);')
Yes 'the folder work holds the button while it runs and lets go before it finishes (#2210)' ($work -match 'PlayProgress\.FolderFirst\(true\);' -and $work -match 'PlayProgress\.FolderFirst\(false\);\s*try\s*\{\s*Dispatcher\.UIThread\.Post')

$og = Read-Text (Join-Path $AppDir 'OwnGame.cs')
Yes 'OwnGame: the phase is "Preparing the game folder"' ($og -match 'public const string Phase = "Preparing the game folder";')
Yes 'OwnGame.Make counts every file it brings over' ((Body $og 'static string MakeNow(') -match 'PlayProgress\.Files\(Phase, looked\+\+, all\.Count\)')
Yes 'OwnGame.Refresh counts every file it compares' ((Body $og 'static string RefreshNow(') -match 'PlayProgress\.Files\(Phase, looked\+\+, all\.Count\)')

$ver = Read-Text (Join-Path $AppDir 'Verify.cs')
# Full and light (#1715): the light plugins a server publishes are checked
# after its full ones, and counted with them.
$bytesBody = Body $ver 'public static List<Issue> Bytes('
Yes 'Verify.Bytes counts the plugins it checks, full and light' (
    $bytesBody -match 'int all = mods\.Length \+ light\.Length;' -and $bytesBody -match 'PlayProgress\.Files\("Checking files", idx \+ 1, all\)')

# The words, in the two new files.
foreach ($n in @('Progress.cs', 'ShellProgress.cs')) {
    $t = Read-Text (Join-Path $AppDir $n)
    Yes "$n has no em dash and never says player" (-not ($t.Contains([string][char]0x2014) -or $t -match '(?i)player'))
}

Done
