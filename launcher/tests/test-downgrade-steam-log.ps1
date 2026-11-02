<#
  test-downgrade-steam-log.ps1

      pwsh -NoProfile -File .\launcher\tests\test-downgrade-steam-log.ps1

  The Downgrade button hears Steam say a part has started, finished or failed,
  and checks the downloaded SkyrimSE.exe before it replaces anything.

  WHY THIS EXISTS. Patrick, 24 September, with a tester on the main build:
  "it only give you the fiurst one to yuor clipboards and not all of them".
  The next part is asked for only once Steam has said the part before it is
  down, and launcher\app\Downgrade.cs listened for that in the wrong place. It
  read Steam's content_log.txt alone, and took "depot_489831" as the sign a
  download had started. Two downgraders written by other people for these
  same three depots read console_log.txt, and one of them keeps the real
  lines it saw there on 24 August (Mosalah992/Skyrim-downgrader, logwatch.py):

    Downloading depot 489832 (26 files, 7260 MB) ...
    Depot download complete : "C:\...\app_489830\depot_489832" (manifest 8042843504692938467)
    Depot download failed : Failed updating depot 489831 while downloading chunk "..." (Failure) (Content unavailable)

  The start line has no "depot_" in it. Neither log on Patrick's machine has a
  depot line since 10 September, so this could not be measured here; both logs
  are read now and the lines above are what is driven.

  The Downgrader Tool on Nexus (1.0.2) checks the downloaded exe is 1.6.1170
  before copying anything. Downgrade.cs checked only after the copy.

  HOW. The real text of SteamLog, LogStarted, LogHasCompletion, FailedLine,
  Refused, ByHand and DownloadedExe is lifted out of Downgrade.cs by brace
  match and compiled with the .NET SDK the launcher builds with
  (Launcher-Csc.ps1), and
  driven against a made-up Steam folder under a temp folder. Nothing opens
  Steam or touches the real one. The reads of the made-up log files run on
  Windows only: SteamLog finds them by Windows paths (logs\console_log.txt).

  Read only apart from files under its own temp folder.
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
Yes 'launcher\app\Downgrade.cs is there' (Test-Path -LiteralPath $src)
if (-not (Test-Path -LiteralPath $src)) { Done }
$text = [IO.File]::ReadAllText($src)

# From the start of the line the signature is on to the brace that closes it.
# Strings, characters and comments are stepped over, so a brace inside one of
# them cannot end the member early.
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
        if ($c -eq '"' -or $c -eq "'") {
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
            if ($depth -eq 0) {
                $end = $i + 1
                if ($end -lt $all.Length -and $all[$end] -eq ';') { $end++ }
                return $all.Substring($lineStart, $end - $lineStart)
            }
        }
        $i++
    }
    return $null
}

$wanted = [ordered]@{
    'SteamLog'         = 'sealed class SteamLog'
    'LogStarted'       = 'static bool LogStarted(string said, string depot)'
    'LogHasCompletion' = 'static bool LogHasCompletion(string said, string depot)'
    'FailedLine'       = 'static string FailedLine(string said, string depot)'
    'Refused'          = 'static bool Refused(string said, string depot, int part, string cmd, Action<string> log, Action<string> status)'
    'Reason'           = 'static string Reason(string line)'
    'ByHand'           = 'static string ByHand(string cmd)'
    'DownloadedExe'    = 'static string DownloadedExe(string content)'
    'FallbackDepots'   = 'static readonly string[][] FallbackDepots ='
}
$lifted = [ordered]@{}
foreach ($k in $wanted.Keys) {
    $m = Get-Member $text $wanted[$k]
    Yes ("Downgrade.cs has {0}" -f $k) ($null -ne $m)
    if ($null -ne $m) { $lifted[$k] = $m }
}
if ($lifted.Count -lt $wanted.Count) { Done }

# ---- what Run does with them, read off its text --------------------------------
$run = Get-Member $text 'static bool Run(Config cfg, Action<string> log, Action<string> status)'
Yes 'Downgrade.cs has Run' ($null -ne $run)
if ($null -eq $run) { Done }
Yes 'Run no longer reads content_log.txt on its own' ($run -notmatch 'content_log\.txt')
Yes 'Run makes a SteamLog before each command is given' ($run -match 'SteamLog steamLog = new SteamLog\(steam\);[\s\S]*TypeIntoConsole\(cmd, log\)')
$waits = [regex]::Matches($run, 'steamLog\.Since\(\)').Count
Yes ('Run reads Steam''s logs in all three waits (found {0})' -f $waits) ($waits -ge 3)
$refused = [regex]::Matches($run, 'if \(Refused\(said, depot, i \+ 1, cmd, log, status\)\) return false;').Count
Yes ('Run stops on Steam''s failure line in all three waits (found {0})' -f $refused) ($refused -ge 3)
Yes 'Run counts a folder that appeared after the command as the start' ($run -match '!hadFolder && Directory\.Exists\(folder\)')
Yes 'Run waits for the finish on what Steam wrote since the command' ($run -match 'LogHasCompletion\(said, depot\)')
$check = $run.IndexOf('DownloadedExe(content)')
# Since #1218 the copy is OwnGame.TakePinned, into Thornswood's own folder.
$firstCopy = $run.IndexOf('OwnGame.TakePinned(')
Yes 'Run checks the downloaded exe before it replaces anything' ($check -ge 0 -and $firstCopy -gt $check)
Yes 'Run still checks the exe in the game folder after the copy' ($run.IndexOf('bool right = File.Exists(targetExe) && !Wrong(cfg, targetExe);') -gt $firstCopy)
Yes 'nothing tells people Ctrl+Shift+D opens Steam''s console' ($text -notmatch 'Ctrl\+Shift\+D')

# ---- compiled ------------------------------------------------------------------
$probe = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Probe
{
    static class Swallow
    {
        public static List<string> Notes = new List<string>();
        public static void Note(string where, Exception e) { Notes.Add(where + ": " + e.Message); }
    }

    public static class Downgrade
    {
        const int AppId = 489830;
__LIFTED__
        // What Run sets from PinnedDepots; a feed with no pin leaves the fallback (#471).
        static string[][] Depots = FallbackDepots;
        public static object NewLog(string steam) { return new SteamLog(steam); }
        public static string Since(object l) { return ((SteamLog)l).Since(); }
        public static string Tail(object l, int n) { return ((SteamLog)l).Tail(n); }
    }
}
'@
$body = New-Object System.Text.StringBuilder
foreach ($k in $lifted.Keys) { [void]$body.AppendLine($lifted[$k]) }
$probe = $probe.Replace('__LIFTED__', $body.ToString())

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-downgrade-log-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
try {
    $asm = $null
    try { $asm = Add-LauncherType -Source $probe }
    catch { $out = $_.Exception.Message }
    Yes 'the lifted text compiles with the .NET SDK the launcher builds with' ($null -ne $asm)
    if (-not $asm) { $out -split "`n" | ForEach-Object { Write-Host "      $_" }; Done }

    $T = $asm.GetType('Probe.Downgrade', $true)
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    # PowerShell wraps paths and returned objects; the compiled side wants what
    # is inside.
    function Call([string]$name, [object[]]$argv) {
        $plain = New-Object 'object[]' $argv.Count
        for ($k = 0; $k -lt $argv.Count; $k++) {
            $a = $argv[$k]
            if ($a -is [Management.Automation.PSObject]) { $a = $a.PSObject.BaseObject }
            $plain[$k] = $a
        }
        return $T.GetMethod($name, $flags).Invoke($null, $plain)
    }

    # The lines Steam's console writes, as recorded on 24 August.
    $started2  = '[2026-08-24 08:47:57] Downloading depot 489832 (26 files, 7260 MB) ...'
    $complete2 = '[2026-08-24 10:48:17] Depot download complete : "C:\Program Files (x86)\Steam\steamapps\content\app_489830\depot_489832" (manifest 8042843504692938467)'
    $failed1   = '[2026-08-24 20:36:15] Depot download failed : Failed updating depot 489831 while downloading chunk "0a1b2c" (Failure) (Content unavailable)'
    # The older wording the Steam Console guide quotes.
    $completeOld = 'Depot download complete : "C:\Program Files (x86)\Steam\steamapps\content\app_489830\depot_489833" (54 files, manifest 1914580699073641964)'

    # ---- the words -------------------------------------------------------------
    Yes 'the start line counts as depot 489832 starting' ([bool](Call 'LogStarted' @($started2, '489832')))
    Yes 'the start line does not count for depot 489831' (-not [bool](Call 'LogStarted' @($started2, '489831')))
    Yes 'the start line has no depot_ in it, which is what the old check looked for' ($started2.IndexOf('depot_489832') -lt 0)
    Yes 'the finish line counts as depot 489832 finished' ([bool](Call 'LogHasCompletion' @($complete2, '489832')))
    Yes 'the finish line does not finish depot 489831' (-not [bool](Call 'LogHasCompletion' @($complete2, '489831')))
    Yes 'the older finish wording counts too' ([bool](Call 'LogHasCompletion' @($completeOld, '489833')))
    Yes 'a start line is not a finish' (-not [bool](Call 'LogHasCompletion' @($started2, '489832')))
    Yes 'the failure line is depot 489831''s' ((Call 'FailedLine' @($failed1, '489831')) -eq $failed1.Trim())
    Yes 'the failure line is not depot 489832''s' ((Call 'FailedLine' @($failed1, '489832')) -eq '')
    $bare = 'Depot download failed : No connection'
    Yes 'a failure line naming no depot counts as the one asked for' ((Call 'FailedLine' @($bare, '489833')) -eq $bare)
    Yes 'no failure line, no failure' ((Call 'FailedLine' @(($started2 + "`n" + $complete2), '489832')) -eq '')

    $logs = New-Object System.Collections.Generic.List[string]
    $stat = New-Object System.Collections.Generic.List[string]
    $logA = [Action[string]]{ param($s) $logs.Add($s) }
    $statA = [Action[string]]{ param($s) $stat.Add($s) }
    $cmd1 = 'download_depot 489830 489831 8442952117333549665'
    Yes 'Refused stops part 1 on its failure line' ([bool](Call 'Refused' @($failed1, '489831', 1, $cmd1, $logA, $statA)))
    Yes 'and puts Steam''s own line in the launcher log' (($logs -join "`n").Contains('Content unavailable'))
    Yes 'and says nothing was replaced' (($logs -join "`n").Contains('Nothing in the game folder has been replaced'))
    Yes 'and gives the way by hand with this part''s command' (($logs -join "`n").Contains('steam://open/console') -and ($logs -join "`n").Contains($cmd1))
    Yes 'and the line under the button says which part' (($stat -join "`n").Contains('part 1 of 3'))
    # The entry: the line under the button says why it stopped and what to do
    # next, not only the launcher log. It used to end at "See the log".
    Yes 'and puts Steam''s own reason on the card too, not only in the log' (($stat -join "`n").Contains('Content unavailable'))
    Yes 'and says nothing in the game folder was touched' (($stat -join "`n").Contains('Nothing in the game folder has been replaced'))
    Yes 'and what to do next' (($stat -join "`n").Contains('Press Try again'))
    Yes 'and never sends the person to the launcher log instead' (-not (($stat -join "`n") -match '(?i)see the log'))
    Yes 'the timestamp Steam puts on the line is left off the card' (-not (($stat -join "`n").Contains('[2026-08-24 20:36:15]')))
    Yes 'Reason drops the timestamp and keeps the rest' ((Call 'Reason' @($failed1)) -eq 'Depot download failed : Failed updating depot 489831 while downloading chunk "0a1b2c" (Failure) (Content unavailable)')
    Yes 'a line with no timestamp is left as it is' ((Call 'Reason' @('Depot download failed : No connection')) -eq 'Depot download failed : No connection')
    $logs.Clear(); $stat.Clear()
    Yes 'Refused lets part 2 carry on past part 1''s failure line' (-not [bool](Call 'Refused' @($failed1, '489832', 2, 'x', $logA, $statA)))
    Yes 'and says nothing' ($logs.Count -eq 0 -and $stat.Count -eq 0)

    # ---- the logs on disk --------------------------------------------------------
    # SteamLog finds console_log.txt and content_log.txt by Windows paths
    # (logs\console_log.txt), so the reads of real files run on Windows only.
    if ($OnWindows) {
        $steam = Join-Path $work 'Steam'
        $logsDir = Join-Path $steam 'logs'
        $null = New-Item -ItemType Directory -Force -Path $logsDir
        $console = Join-Path $logsDir 'console_log.txt'
        $contentLog = Join-Path $logsDir 'content_log.txt'
        # Before the command: an old finish for 489832 from another attempt, which
        # must not count, and the appmanifest line that fills Patrick's content log.
        [IO.File]::WriteAllText($console, "[2026-09-01 10:00:00] GameAction [AppID 489830, ActionID 3] : LaunchApp changed task to CheckShaderDepotManifest`n" + $complete2 + "`n")
        $spam = '[2026-09-24 17:13:59] Failed to write app state file "C:\Program Files (x86)\Steam\steamapps\appmanifest_489830.acf" (1156 bytes)'
        [IO.File]::WriteAllText($contentLog, (($spam + "`n") * 40))

        $sl = Call 'NewLog' @($steam)
        Yes 'nothing Steam wrote before the command is read' (-not [bool](Call 'LogHasCompletion' @((Call 'Since' @($sl)), '489832')))

        [IO.File]::AppendAllText($console, $started2 + "`n")
        [IO.File]::AppendAllText($contentLog, (($spam + "`n") * 5))
        $said = Call 'Since' @($sl)
        Yes 'the start written to console_log.txt is heard' ([bool](Call 'LogStarted' @($said, '489832')))
        Yes 'and is not taken as the finish' (-not [bool](Call 'LogHasCompletion' @($said, '489832')))

        [IO.File]::AppendAllText($console, $complete2 + "`n")
        Yes 'the finish written to console_log.txt is heard' ([bool](Call 'LogHasCompletion' @((Call 'Since' @($sl)), '489832')))

        $sl2 = Call 'NewLog' @($steam)
        [IO.File]::AppendAllText($contentLog, $completeOld + "`n")
        Yes 'a finish written to content_log.txt is still heard' ([bool](Call 'LogHasCompletion' @((Call 'Since' @($sl2)), '489833')))

        # Steam restarts: console_log.txt becomes .previous and starts again,
        # shorter than where this was reading from.
        $sl3 = Call 'NewLog' @($steam)
        Move-Item -LiteralPath $console -Destination (Join-Path $logsDir 'console_log.previous.txt') -Force
        [IO.File]::WriteAllText($console, $started2 + "`n" + $complete2 + "`n")
        Yes 'after Steam restarts, the new console_log.txt is read from the top' ([bool](Call 'LogHasCompletion' @((Call 'Since' @($sl3)), '489832')))

        $sl4 = Call 'NewLog' @($steam)
        [IO.File]::AppendAllText($console, $failed1 + "`n")
        [IO.File]::AppendAllText($contentLog, (($spam + "`n") * 30))
        $tail = Call 'Tail' @($sl4, 12)
        Yes 'the tail for the launcher log keeps console_log.txt''s line under its name' ($tail.Contains('console_log.txt:') -and $tail.Contains('Content unavailable'))
        Yes 'and the content log''s spam takes no more than its own twelve lines' (([regex]::Matches($tail, 'appmanifest_489830').Count) -le 12)

        $sl5 = Call 'NewLog' @($steam)
        Yes 'nothing written since, nothing in the tail' ((Call 'Tail' @($sl5, 12)) -eq '')
    } else {
        Write-Host 'SKIP  the logs on disk: SteamLog finds Steam''s logs by Windows paths (logs\console_log.txt), which only Windows has'
    }

    $gone = Join-Path $work 'NoSteamHere'
    $sl6 = Call 'NewLog' @($gone)
    Yes 'a Steam folder with no logs reads as nothing, without throwing' ((Call 'Since' @($sl6)).Trim() -eq '')

    # ---- the downloaded exe ------------------------------------------------------
    $content = Join-Path $work 'content\app_489830'
    foreach ($d in '489831', '489832', '489833') { $null = New-Item -ItemType Directory -Force -Path (Join-Path $content "depot_$d") }
    Yes 'no SkyrimSE.exe in any download reads as none' ((Call 'DownloadedExe' @($content)) -eq '')
    $exe = Join-Path $content 'depot_489833\SkyrimSE.exe'
    [IO.File]::WriteAllBytes($exe, [byte[]](1, 2, 3))
    Yes 'the SkyrimSE.exe at the top of a download is found' ((Call 'DownloadedExe' @($content)) -eq $exe)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
