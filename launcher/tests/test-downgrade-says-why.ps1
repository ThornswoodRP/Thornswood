<#
  test-downgrade-says-why.ps1

      pwsh -NoProfile -File .\launcher\tests\test-downgrade-says-why.ps1

  The Downgrade button reaches Steam even when Windows will not open a steam://
  link, says on the card why it stopped whenever it stops, and shows how far it
  has got.

  WHY THIS EXISTS. Patrick, 24 September, a tester on 1.1.94: "the dowgrader
  this time didnt even upon the steam console let alone put the commands in for
  you", then that another server's downgrader "does this so it is possible", and
  "they have a progress bar of it in the launcher". Read from
  launcher\app\Downgrade.cs that evening:

    1. Every request to Steam was Process.Start("steam://...") inside catch { }.
       Where the link does not open, that threw, the throw was thrown away,
       Steam was never asked, and nothing was written anywhere.
    2. Every early stop (no Steam install found, Skyrim running, another
       Skyrim running, Steam not starting, a copy that failed) went to the
       launcher log alone. The line under the button kept its old words, so the
       button looked like it did nothing.
    3. With Steam in the tray and no window, the console was asked for once:
       the second request sat below the check for a window.
    4. The card said "7,145 MB down so far" with no end, and had no bar.

  WHAT WAS STILL MISSING, read again on 27 September, with the issue reopened
  as a real open bug that no released launcher had fixed:

    5. The bar only came up once bytes started landing. Opening Steam, signing
       in and getting the console to take the first command take minutes
       between them, so the longest wait in the run had nothing moving.
    6. The three downloads had the whole bar, so it filled to the end when the
       last part came down and then started again at nothing for the copy.
    7. Three stops did reach the card and then said "see the log": the
       deadline, Steam refusing a part, and a download that was not the build.
       The entry asks for why and what to do next, not a file to go and find.
    8. AskSteam reported false and nothing read it, so a machine that could
       not be made to open Steam at all waited ninety seconds first.

  HOW. The real text of AskSteam, Stop, Progress, SizedLine, Percent,
  DepotBytes, ProgressLine, ClipboardLine, Next and Parts is lifted out of
  Downgrade.cs by brace match and compiled with the .NET SDK the launcher
  builds with (tests\Launcher-Csc.ps1), beside a Process that records what it was asked to
  start instead of starting it, and a Steam install in a temp folder. Nothing
  opens Steam. The rest is read off Run's and TypeIntoConsole's text.

  Read only apart from its own temp folder.
#>
[CmdletBinding()]
param([string]$AppPath)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in launcher\tests\, the repository is two folders up.
$Here = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $AppPath) { $AppPath = Join-Path $Here 'launcher\app' }

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

$src = Join-Path $AppPath 'Downgrade.cs'
$text = [IO.File]::ReadAllText($src)

# From the start of the line the signature is on to the brace that closes it,
# stepping over strings (verbatim ones too), characters and comments.
function Get-Member([string]$all, [string]$signature) {
    $at = $all.IndexOf($signature)
    if ($at -lt 0) { return $null }
    $lineStart = $all.LastIndexOf("`n", $at) + 1
    $open = $all.IndexOf('{', $at + $signature.Length)
    if ($open -lt 0) { return $null }
    $depth = 0
    $i = $open
    while ($i -lt $all.Length) {
        $c = $all[$i]
        if ($c -eq '@' -and $i + 1 -lt $all.Length -and $all[$i + 1] -eq '"') {
            $i += 2
            while ($i -lt $all.Length) {
                if ($all[$i] -eq '"') { if ($i + 1 -lt $all.Length -and $all[$i + 1] -eq '"') { $i += 2; continue }; break }
                $i++
            }
        }
        elseif ($c -eq '"' -or $c -eq "'") {
            $q = $c; $i++
            while ($i -lt $all.Length -and $all[$i] -ne $q) { if ($all[$i] -eq '\') { $i++ }; $i++ }
        }
        elseif ($c -eq '/' -and $i + 1 -lt $all.Length -and $all[$i + 1] -eq '/') {
            $i = $all.IndexOf("`n", $i); if ($i -lt 0) { return $null }
        }
        elseif ($c -eq '/' -and $i + 1 -lt $all.Length -and $all[$i + 1] -eq '*') {
            $i = $all.IndexOf('*/', $i + 2); if ($i -lt 0) { return $null }; $i++
        }
        elseif ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0) { return $all.Substring($lineStart, $i + 1 - $lineStart) }
        }
        $i++
    }
    return $null
}

$wanted = [ordered]@{
    'AskSteam'      = 'static bool AskSteam(string link, Action<string> log)'
    'Stop'          = 'static bool Stop(string why, Action<string> log, Action<string> status)'
    'Progress'      = 'static void Progress(int percent)'
    'SizedLine'     = 'static string SizedLine(int part, int of, long bytes, long total, bool pasted)'
    'Percent'       = 'static int Percent(int index, int of, long bytes, long total)'
    'DepotBytes'    = 'static long DepotBytes(string said, string depot)'
    'ProgressLine'  = 'static string ProgressLine(int part, int of, long bytes, bool pasted)'
    'ClipboardLine' = 'static string ClipboardLine(int part, int of)'
    'Next'          = 'static string Next(int part, int of)'
    'Parts'         = 'static string Parts(int from, int to, string one, string many)'
}
$lifted = [ordered]@{}
foreach ($k in $wanted.Keys) {
    $m = Get-Member $text $wanted[$k]
    Yes ("Downgrade.cs has {0}" -f $k) ($null -ne $m)
    if ($null -ne $m) { $lifted[$k] = $m }
}
$onProgress = [regex]::Match($text, '(?m)^\s*public static Action<int> OnProgress;\s*$')
Yes 'Downgrade.cs has the OnProgress hook the card''s bar listens on' $onProgress.Success

# ---- what Run and TypeIntoConsole do, read off their text -----------------------
$run = Get-Member $text 'static bool Run(Config cfg, Action<string> log, Action<string> status)'
$type = Get-Member $text 'static bool TypeIntoConsole(string cmd, Action<string> log)'
$wait = Get-Member $text 'static bool WaitForSteam(Action<string> log, Action<string> status)'
Yes 'Run, TypeIntoConsole and WaitForSteam are there' ($null -ne $run -and $null -ne $type -and $null -ne $wait)
if ($null -eq $run -or $null -eq $type -or $null -eq $wait) { Done }
Yes 'nothing in Downgrade.cs starts a steam:// link past AskSteam' ($text -notmatch 'Process\.Start\(new ProcessStartInfo\("steam://')
$silent = [regex]::Matches($run, 'log\([^;]*\);\s*return false;')
Yes ('no stop in Run goes to the log alone (found {0})' -f $silent.Count) ($silent.Count -eq 0)
$stops = [regex]::Matches($run, 'return Stop\(').Count
Yes ('the early stops in Run go through Stop (found {0})' -f $stops) ($stops -ge 7)
Yes 'Steam not starting says so on the card' ($wait -match 'Stop\("Steam did not start')
# Since #1218 the Steam copy is never downgraded; what can already be there is
# 1.6.1170's own download, which a first build is made from.
Yes '1.6.1170''s files already downloaded says on the card that nothing needs downloading' ($run -match 'status\("1\.6\.1170''s files are already downloaded\. Thornswood''s own folder is made from them next\."\);')
Yes 'TypeIntoConsole asks Steam through AskSteam' ($type -match 'AskSteam\("steam://open/console", log\);')
$reask = $type.IndexOf('if (!reopened && (DateTime.Now - start).TotalSeconds > 8)')
$check = $type.IndexOf('if (h == IntPtr.Zero) continue;')
Yes 'Steam is asked again halfway before the check for a window, so a Steam with no window is asked twice' ($reask -ge 0 -and $check -gt $reask)
Yes 'with no window at all it asks for Steam''s main window too' ($type -match 'MainWindow\(\) == IntPtr\.Zero \? "steam://open/main" : "steam://open/console"')
Yes 'the card''s line during a part comes from SizedLine, with Steam''s size once it is given' ($run -match 'status\(SizedLine\(i \+ 1, Depots\.Length, size, total, pasted\)\);' -and $run -match 'if \(total <= 0\) total = DepotBytes\(said, depot\);')

# ---- the bar covers the whole run, not the downloads alone ---------------------
#
# Four stretches: the three downloads, then the copy into the game. The
# downloads used to have the whole bar, so it filled when the last part came
# down and started again at nothing for the copy.
Yes 'the bar is divided into the three downloads and the copy' ($text -match '(?m)^\s*static readonly int Stages = Depots\.Length \+ 1;\s*$')
$atBar = $run.IndexOf('Progress(-2);')
Yes 'the bar is up from the moment the run starts, before Steam is even opened' ($atBar -ge 0 -and $run.IndexOf('Steam.Path_()') -gt $atBar)
Yes 'the bar moves during a part, and moves without a number before Steam gives a size' ($run -match 'Progress\(total > 0 \? Percent\(i, Stages, size, total\) : -2\);')
Yes 'a part that is already downloaded still moves the bar on' ($run -match 'Progress\(\(i \+ 1\) \* 100 / Stages\);\s*continue;')
Yes 'and so does one that has just come down' (([regex]::Matches($run, 'Progress\(\(i \+ 1\) \* 100 / Stages\);')).Count -eq 2)
Yes 'the copy carries the same bar on rather than starting it again' ($run -match 'Progress\(Percent\(Depots\.Length, Stages, 0, toCopy\)\);' -and $run -match 'Progress\(Percent\(Depots\.Length, Stages, copied, all\)\);')
Yes 'nothing puts the bar back to nothing part way' ($run -notmatch 'Progress\(0\);')
Yes 'the bar reaches 100 only when Skyrim is on 1.6.1170' ($run -match 'status\("Done\. Skyrim is on 1\.6\.1170\."\);\s*Progress\(100\);')

# ---- and every stop says why on the card, not "see the log" --------------------
#
# The entry's words: the line under the button says why it stopped and what to
# do next, not only the launcher log. Three stops used to hand the person a
# file to go and find instead: the deadline, Steam refusing a part, and a
# download that was not the build.
Yes 'no line under the button sends the person to the launcher log' ($text -notmatch '(?i)status\("[^"]*see the log')
Yes 'the deadline says how long, which part, and what to do' ($run -match 'return Stop\("Steam did nothing for " \+ GiveUpMinutes' -and $run -match 'press Try again')
Yes 'a download that is not the build says so and what to do' ($run -match 'return Stop\("Steam''s download is not the build we need')
Yes 'Steam that cannot be asked at all says so rather than waiting ninety seconds' ($wait -match 'if \(!AskSteam\("steam://open/main", log\)\)\s*return Stop\("Steam could not be started')

# ---- compiled ------------------------------------------------------------------
$probe = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Probe
{
    public class ProcessStartInfo
    {
        public string FileName; public string Arguments = "";
        public bool UseShellExecute { get; set; }
        public ProcessStartInfo(string file) { FileName = file; }
        public ProcessStartInfo(string file, string args) { FileName = file; Arguments = args; }
    }
    // Records what it was asked to start. With LinkBroken set, a steam:// link
    // opened through the shell throws, the way Windows does when the link has
    // no handler.
    public class Process
    {
        public static List<string> Started = new List<string>();
        public static bool LinkBroken;
        public static Process Start(ProcessStartInfo i)
        {
            if (i.UseShellExecute && LinkBroken && i.FileName.StartsWith("steam://"))
                throw new InvalidOperationException("The system cannot find the file specified");
            Started.Add((i.UseShellExecute ? "shell " : "exe ") + i.FileName + (i.Arguments.Length > 0 ? " " + i.Arguments : ""));
            return new Process();
        }
    }
    public static class Steam { public static string Root = ""; public static string Path_() { return Root; } }
    public static class Swallow { public static void Note(string w, Exception e) { } }

    public static class Downgrade
    {
        const int AppId = 489830;
        public static List<string> Logged = new List<string>();
        public static List<string> Status = new List<string>();
        public static List<int> Bar = new List<int>();
        public static void Reset() { Logged.Clear(); Status.Clear(); Bar.Clear(); Process.Started.Clear(); OnProgress = delegate (int p) { Bar.Add(p); }; }
        public static bool Ask(string link) { return AskSteam(link, delegate (string s) { Logged.Add(s); }); }
        public static bool StopWith(string why) { return Stop(why, delegate (string s) { Logged.Add(s); }, delegate (string s) { Status.Add(s); }); }
__LIFTED__
    }
}
'@
$body = New-Object System.Text.StringBuilder
foreach ($k in $lifted.Keys) { [void]$body.AppendLine($lifted[$k]) }
if ($onProgress.Success) { [void]$body.AppendLine($onProgress.Value) }
$probe = $probe.Replace('__LIFTED__', $body.ToString())

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet) -or $lifted.Count -lt $wanted.Count -or -not $onProgress.Success) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-downgrade-why-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $asm = $null
    try { $asm = Add-LauncherType -Source $probe }
    catch { $out = $_.Exception.Message }
    Yes 'the lifted text compiles with the .NET SDK the launcher builds with' ($null -ne $asm)
    if (-not $asm) { $out -split "`n" | ForEach-Object { Write-Host "      $_" }; Done }

    $D = $asm.GetType('Probe.Downgrade', $true)
    $P = $asm.GetType('Probe.Process', $true)
    $S = $asm.GetType('Probe.Steam', $true)
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    function Call([string]$name, [object[]]$argv) {
        $plain = New-Object 'object[]' $argv.Count
        for ($k = 0; $k -lt $argv.Count; $k++) { $a = $argv[$k]; if ($a -is [Management.Automation.PSObject]) { $a = $a.PSObject.BaseObject }; $plain[$k] = $a }
        return $D.GetMethod($name, $flags).Invoke($null, $plain)
    }
    function Field($t, [string]$name) { return $t.GetField($name, $flags) }
    $started = (Field $P 'Started').GetValue($null)
    $logged = (Field $D 'Logged').GetValue($null)
    $status = (Field $D 'Status').GetValue($null)
    $bar = (Field $D 'Bar').GetValue($null)

    $steamRoot = Join-Path $work 'Steam'
    $null = New-Item -ItemType Directory -Force -Path $steamRoot
    [IO.File]::WriteAllText((Join-Path $steamRoot 'steam.exe'), 'stand-in')
    (Field $S 'Root').SetValue($null, [string]$steamRoot)

    # ---- asking Steam ----------------------------------------------------------
    Call 'Reset' @() | Out-Null
    (Field $P 'LinkBroken').SetValue($null, $false)
    $ok = Call 'Ask' @('steam://open/console')
    Yes 'a link that opens goes through Windows, as a click would' ($ok -and $started.Count -eq 1 -and $started[0] -eq 'shell steam://open/console')
    Yes 'and says nothing' ($logged.Count -eq 0)

    Call 'Reset' @() | Out-Null
    (Field $P 'LinkBroken').SetValue($null, $true)
    $ok = Call 'Ask' @('steam://open/console')
    $exeLine = 'exe ' + (Join-Path $steamRoot 'steam.exe') + ' -- "steam://open/console"'
    Yes 'a link Windows will not open goes to steam.exe itself, with the arguments Windows registers' ($ok -and $started.Count -eq 1 -and $started[0] -eq $exeLine)
    Yes 'and the log says why it went that way' (($logged -join "`n") -match 'Windows would not open steam://open/console')

    Call 'Reset' @() | Out-Null
    (Field $S 'Root').SetValue($null, [string](Join-Path $work 'NoSteamHere'))
    $ok = Call 'Ask' @('steam://open/main')
    Yes 'with no steam.exe either, it says so and reports false rather than failing in silence' (-not $ok -and $started.Count -eq 0 -and (($logged -join "`n") -match 'steam\.exe is not where'))
    (Field $S 'Root').SetValue($null, [string]$steamRoot)
    (Field $P 'LinkBroken').SetValue($null, $false)

    # ---- stopping --------------------------------------------------------------
    Call 'Reset' @() | Out-Null
    $r = Call 'StopWith' @('Skyrim is running. Close it, then press the button again.')
    Yes 'Stop returns false' ($r -eq $false)
    Yes 'Stop puts the reason on the card as well as in the log' ($status.Count -eq 1 -and $logged.Count -eq 1 -and $status[0] -eq $logged[0])
    Yes 'Stop hides the bar' ($bar.Count -eq 1 -and $bar[0] -eq -1)

    # ---- the size and the share ------------------------------------------------
    $line = '[2026-08-24 08:47:57] Downloading depot 489832 (26 files, 7260 MB) ...'
    Yes 'Steam''s start line gives the part''s size' ((Call 'DepotBytes' @($line, '489832')) -eq (7260 * 1048576))
    Yes 'with a thousands comma too' ((Call 'DepotBytes' @('Downloading depot 489831 (41 files, 3,412 MB) ...', '489831')) -eq (3412 * 1048576))
    Yes 'another depot''s line is not this one''s size' ((Call 'DepotBytes' @($line, '489831')) -eq 0)
    Yes 'nothing said yet is no size' ((Call 'DepotBytes' @('', '489832')) -eq 0)

    $half = 3630L * 1048576
    $total = 7260L * 1048576
    Yes 'with a size the card says how much of how much, and the share' ((Call 'SizedLine' @(2, 3, $half, $total, $false)) -eq 'Part 2 of 3: 3,630 of 7,260 MB (50%)')
    Yes 'without one it says what it always said' ((Call 'SizedLine' @(2, 3, $half, 0L, $false)) -eq (Call 'ProgressLine' @(2, 3, $half, $false)))
    Yes 'a part on the clipboard with nothing down still says where to paste' ((Call 'SizedLine' @(1, 3, 0L, $total, $true)) -eq (Call 'ClipboardLine' @(1, 3)))
    Yes 'and once it is coming down it says the next part follows' ((Call 'SizedLine' @(1, 3, $half, $total, $true)) -match '^Part 1 of 3: 3,630 of 7,260 MB \(50%\)\. Parts 2 and 3 follow here when it is down\.$')
    Yes 'the share never reads 100 while downloading' ((Call 'SizedLine' @(3, 3, $total, $total, $false)) -match '\(99%\)$')

    Yes 'half of the first part is a sixth of the way' ((Call 'Percent' @(0, 3, $half, $total)) -eq 16)
    Yes 'the start of the second part is a third' ((Call 'Percent' @(1, 3, 0L, $total)) -eq 33)
    Yes 'the end of the last part is 99, not 100' ((Call 'Percent' @(2, 3, $total, $total)) -eq 99)
    Yes 'no size is the whole parts before it' ((Call 'Percent' @(2, 3, $half, 0L)) -eq 66)

    # Over the four stretches Run divides the bar into: three downloads, then
    # the copy. The copy starts where the downloads left the bar and goes on
    # from there, so the bar never drops back.
    Yes 'half of the first download is an eighth of the whole run' ((Call 'Percent' @(0, 4, $half, $total)) -eq 12)
    Yes 'the last download ending leaves the bar three quarters along' ((Call 'Percent' @(3, 4, 0L, $total)) -eq 75)
    Yes 'the copy starts where the downloads stopped' ((Call 'Percent' @(3, 4, 0L, $total)) -ge (Call 'Percent' @(2, 4, $total, $total)))
    Yes 'and ends at 99, so 100 is left for the run being done' ((Call 'Percent' @(3, 4, $total, $total)) -eq 99)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
