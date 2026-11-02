<#
  test-963-perf-settings.ps1

      pwsh -NoProfile -File .\tests\test-963-perf-settings.ps1

  The #963 follow-ups: less lag with the NPCs on, by Patrick's decisions of
  28 September and the four issues the audit filed.

    1. SkyrimPlatform at its normal log level (2, info) with no text window
       (Cmd = false), written by the launcher before every Play (Enforce).
    2. How far people and NPCs are drawn is one number for everybody,
       fLODFadeOutMultActors = Enforce.ActorFade, written into SkyrimPrefs.ini
       before every Play and held in the game by the front plugin, whose
       ACTOR_FADE must be the same number.
    3. The menu music browser is closed, not paused, while the game runs.
    4. Voice keeps full quality: every voice panner is HRTF, none cheaper,
       in the game's voice page and in the launcher's own voice mix.
    5. Half-rate updates for others' movement (SkyMP's skipUpdates) stay off.
    6. #978: while the game runs the launcher lists the machine's processes
       once, not every two seconds, and still sees the game close on the
       same tick.
    7. #977: the voice file channel wakes when the game writes push to talk
       or the mute list, not ten times a second, and not for the logs beside
       them.
    8. #979: the Hold watcher is not woken by the game's log writes.

  HOW. Compiles the shipped Enforce.cs, AutoJoin.cs, Hold.cs, Watched.cs and
  ChannelWait.cs together, with small stand-ins for Paths, Swallow, Config
  and Keep, with the .NET SDK the launcher builds with (Add-LauncherType,
  tests\Launcher-Csc.ps1, #2821, #4823), and runs them against a pretend game
  folder in a temp folder Get-ScratchDir.ps1 names (the repository's temp, or
  %TEMP% outside a checkout). Reads the rest as text. Changes nothing outside
  that folder.

  The compile, the text checks, Watched (6) and ChannelWait (7) run
  everywhere. Enforce (1 and 2), AutoJoin (5) and Hold (8) run on Windows
  only and say SKIP elsewhere: they find the game's files by Windows paths
  (Data\SKSE\Plugins, Data\Platform), and Enforce asks kernel32 whether a
  file is a hard link.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'launcher\app'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's compiler and C# version (#2821)

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Read([string]$rel) { Get-Content -LiteralPath (Join-Path $root $rel) -Raw }

# ------------------------------------------------------------------ compile
$stubs = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
namespace Thornswood963
{
    // Enforce.MakeItOurs splits a hard link with OwnGame.SwapCopyIn (#2599).
    // The real code, lifted out of OwnGame.cs below, as test-2599-whole-swaps.ps1 does.
    static partial class OwnGame
    {
__OWNGAME__
    }
    static class Paths { public static string Game = ""; public static string LiveMyGames = ""; public static string LogFile = ""; }
    static class Swallow { public static int Count; public static void Note(string where, Exception e) { Count++; } }
    class Config { public bool AutoJoin = true; public string ServerPort = "7777"; public string ServerAddress = ""; }
    static class Keep
    {
        public static List<string> Held() { return new List<string>(); }
        public static List<string> ParkedHomes() { return new List<string>(); }
        public static string Build() { return "Thornswood"; }
    }
    public static class Api
    {
        public static void SetGame(string game, string myGames) { Paths.Game = game; Paths.LiveMyGames = myGames; }
        public static int RunEnforce() { return Enforce.Apply(); }
        public static string ActorFade() { return Enforce.ActorFade; }
        public static void ChooseAtMenu(int id) { AutoJoin.SetChooseAtMenu(id); }
        public static string SettingsFile() { return AutoJoin.SettingsFile; }
        // Hold's lines arrive on the watcher's thread, where a PowerShell
        // script block cannot run, so they are collected here.
        public static readonly List<string> Said = new List<string>();
        public static int HoldTake() { return Hold.Take(delegate (string s) { lock (Said) Said.Add(s); }); }
        public static string[] HoldSaid() { lock (Said) return Said.ToArray(); }
        public static void HoldRelease() { Hold.Release(); }
        public static int HoldWakes() { return Hold.Wakes; }
        // The game writing a file a moment from now, from another thread.
        // WrittenAt is the Stopwatch tick just before the write starts.
        public static long WrittenAt;
        public static System.Threading.Tasks.Task WriteLater(string path, string text, int ms)
        {
            return System.Threading.Tasks.Task.Run(delegate
            {
                System.Threading.Thread.Sleep(ms);
                WrittenAt = System.Diagnostics.Stopwatch.GetTimestamp();
                System.IO.File.WriteAllText(path, text);
            });
        }
        // Lines appended the way a busy game log fills: one at a time, a
        // couple of milliseconds apart (about 500 a second).
        public static void AppendPaced(string path, int lines, int gapMs)
        {
            for (int i = 0; i < lines; i++)
            {
                System.IO.File.AppendAllText(path, "frame: line " + i + "\r\n");
                System.Threading.Thread.Sleep(gapMs);
            }
        }
    }
}
'@
# The same two pieces of OwnGame.cs test-2599-whole-swaps.ps1 lifts: the
# #2599 swaps, and ReplaceName with the MoveFileEx they rest on. Enforce.cs
# calls SwapCopyIn since #2599, so it does not compile without them.
$og = [IO.File]::ReadAllText((Join-Path $app 'OwnGame.cs')) -replace "`r`n", "`n"
$region = [regex]::Match($og, '(?s)\n(        (?:internal )?static void WriteRecord\(string path, IEnumerable<string> lines\)\n.*?private static partial bool MoveFileEx\([^)]*\);\n)')
$block = [regex]::Match($og, '(?s)\n(        // ---- #2599: one name of the game folder replaced whole.*?        // ---- end #2599[^\n]*\n)')
Yes 'OwnGame.SwapCopyIn and what it rests on are found in OwnGame.cs, to compile with Enforce.cs' ($region.Success -and $block.Success -and $block.Groups[1].Value -match 'internal static void SwapCopyIn\(')
if (-not ($region.Success -and $block.Success)) { Write-Host ""; Write-Host "$($script:pass) passed, $($script:fail) failed"; exit 1 }
$stubs = $stubs.Replace('__OWNGAME__', $region.Groups[1].Value.TrimEnd() + "`n" + $block.Groups[1].Value.TrimEnd())
$sources = @($stubs)
$usings = New-Object 'Collections.Generic.SortedSet[string]'
foreach ($f in 'Enforce.cs', 'AutoJoin.cs', 'Hold.cs', 'Watched.cs', 'ChannelWait.cs') {
    $cs = Get-Content -LiteralPath (Join-Path $app $f) -Raw
    # One compile of several files: their usings go to the top, once each.
    foreach ($u in [regex]::Matches($cs, '(?m)^using [\w.]+;\s*$')) { $null = $usings.Add($u.Value.Trim()) }
    $cs = [regex]::Replace($cs, '(?m)^using [\w.]+;\s*$', '')
    # Its own namespace, where the stand-ins are.
    $cs = $cs -replace 'namespace Thornswood\b', 'namespace Thornswood963'
    # Internal in the launcher. The two the test makes objects of are made
    # public here; the rest it reaches through Api, in the same assembly.
    $cs = $cs -replace '(?m)^(\s*)class (Watched<T> |ChannelWait\b)', '$1public class $2'
    $sources += $cs
}
$stubUsings = [regex]::Matches($sources[0], '(?m)^using [\w.]+;\s*$')
foreach ($u in $stubUsings) { $null = $usings.Add($u.Value.Trim()) }
$sources[0] = [regex]::Replace($sources[0], '(?m)^using [\w.]+;\s*$', '')
$compiled = $null
try { $null = Add-LauncherType -Source ((@($usings) -join "`n") + "`n" + ($sources -join "`n")); $compiled = $true }
catch { Write-Host ('      ' + $_.Exception.Message); $compiled = $false }
Yes "Enforce.cs, AutoJoin.cs, Hold.cs, Watched.cs and ChannelWait.cs compile with the .NET SDK the launcher builds with, C# $LauncherLangVersion" $compiled
if (-not $compiled) { Write-Host ""; Write-Host "$($script:pass) passed, $($script:fail) failed"; exit 1 }
$Api = [Thornswood963.Api]
$fade = $Api::ActorFade()

$tmp = & (Join-Path $root 'scripts\release\Get-ScratchDir.ps1') ('test-963-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    $game = Join-Path $tmp 'Game'
    $myGames = Join-Path $tmp 'MyGames'
    $plugins = Join-Path $game 'Data\SKSE\Plugins'
    New-Item -ItemType Directory -Force -Path $plugins, $myGames | Out-Null
    $Api::SetGame($game, $myGames)

    if ($OnWindows) {
    # --------------------------------------------- 1. SkyrimPlatform.ini
    # As both installs here had it on 28 September: trace and the window on.
    $spIni = Join-Path $plugins 'SkyrimPlatform.ini'
    $asFound = "[Debug]`r`n`r`n; 0 - trace, 1 - debug, 2 - info, 3 - warn, 4 - error, 5 - critical, 6 - none`r`nLogLevel = 0`r`n`r`n; If enabled, it will run the cmd with the game console data`r`nCmd = true`r`n`r`n; Set left offset for cmd`r`nCmdOffsetLeft = 0`r`n`r`nCmdOffsetTop = 720`r`n`r`nChromiumEnabled = true`r`n`r`n[Main]`r`n`r`nPluginFolders = Data/Platform/Plugins;Data/Platform/PluginsDev`r`n`r`n[Browser]`r`n`r`nBackendName = tilted"
    [IO.File]::WriteAllText($spIni, $asFound, (New-Object Text.UTF8Encoding($true)))

    # --------------------------------------------- 2. SkyrimPrefs.ini
    $prefs = Join-Path $myGames 'SkyrimPrefs.ini'
    [IO.File]::WriteAllText($prefs, "[Display]`r`nfShadowDistance=3000`r`n[LOD]`r`nfLODFadeOutMultObjects=5`r`nfLODFadeOutMultActors=15`r`nfLODFadeOutMultItems=10`r`n")

    $changed = $Api::RunEnforce()
    $sp = Get-Content -LiteralPath $spIni -Raw
    Yes 'SkyrimPlatform: LogLevel written as 2 (info, the normal level)' ($sp -match '(?m)^LogLevel = 2\r?$')
    Yes 'SkyrimPlatform: no trace level left' ($sp -notmatch '(?m)^LogLevel\s*=\s*[01]\s*$')
    Yes 'SkyrimPlatform: the text window is off (Cmd = false)' ($sp -match '(?m)^Cmd = false\r?$')
    Yes 'SkyrimPlatform: the window geometry lines are left alone' ($sp -match '(?m)^CmdOffsetLeft = 0' -and $sp -match '(?m)^CmdOffsetTop = 720')
    Yes 'SkyrimPlatform: the browser and plugin folder lines are left alone' ($sp -match '(?m)^BackendName = tilted' -and $sp -match '(?m)^PluginFolders = Data/Platform/Plugins;Data/Platform/PluginsDev')

    $pf = Get-Content -LiteralPath $prefs -Raw
    Yes "draw distance: fLODFadeOutMultActors=$fade in SkyrimPrefs.ini, in Skyrim's own key=value style" ($pf -match "(?m)^fLODFadeOutMultActors=$fade\r?$")
    Yes 'draw distance: under [LOD], nothing else in the file moved' ($pf -match "\[LOD\]\r?\nfLODFadeOutMultObjects=5\r?\nfLODFadeOutMultActors=$fade\r?\nfLODFadeOutMultItems=10" -and $pf -match 'fShadowDistance=3000')
    # Five: the three here, and the animation replacer's two lines, which are
    # written into a file of their own when it is not there.
    Yes "the first Play changed the three values here, and the animation replacer's two ($changed)" ($changed -eq 5)
    Yes 'a second Play changes nothing' ($Api::RunEnforce() -eq 0)

    # The same for everybody: a person at Low (5) is raised to it too.
    [IO.File]::WriteAllText($prefs, "[LOD]`r`nfLODFadeOutMultActors=5`r`n")
    $null = $Api::RunEnforce()
    Yes 'draw distance: a Low setting is brought to the same number as everybody else' ((Get-Content -LiteralPath $prefs -Raw) -match "(?m)^fLODFadeOutMultActors=$fade\r?$")
    # A prefs file without the key gets it under [LOD].
    [IO.File]::WriteAllText($prefs, "[Display]`r`nfGamma=1.0000`r`n[LOD]`r`nfLODFadeOutMultItems=10`r`n")
    $null = $Api::RunEnforce()
    Yes 'draw distance: a file without the line gets it, under [LOD]' ((Get-Content -LiteralPath $prefs -Raw) -match "\[LOD\]\r?\nfLODFadeOutMultActors=$fade")
    # No file at all is Skyrim's to make, and SkyrimPlatform's likewise.
    Remove-Item -LiteralPath $prefs, $spIni
    $null = $Api::RunEnforce()
    Yes 'no SkyrimPrefs.ini: none is made with one line in it' (-not (Test-Path -LiteralPath $prefs))
    Yes 'no SkyrimPlatform.ini: none is made (its own defaults are info and no window)' (-not (Test-Path -LiteralPath $spIni))
    } else {
        Write-Host 'SKIP  1 and 2, run: Enforce finds SkyrimPlatform.ini and SkyrimPrefs.ini by Windows paths and asks kernel32 about hard links, which only Windows has'
    }

    $enf = Read 'launcher\app\Enforce.cs'
    $front = Read 'game\plugins\thornswood-front.js'
    $m = [regex]::Match($front, 'const ACTOR_FADE = (\d+(?:\.\d+)?);')
    Yes "the front plugin holds the same number in the game ($($m.Groups[1].Value) = $fade)" ($m.Success -and [double]$m.Groups[1].Value -eq [double]$fade)
    Yes 'the front plugin sets the same key' ($front -match "const ACTOR_FADE_KEY = 'fLODFadeOutMultActors:LOD';" -and $front -match 'sp\.Utility\.setINIFloat\(ACTOR_FADE_KEY, ACTOR_FADE\)')
    Yes 'the draw distance is lower than Ultra (15) and above Low (5)' ([double]$fade -lt 15 -and [double]$fade -gt 5)
    $chars = Read 'launcher\app\Chars.cs'
    Yes 'the old rule that left trace alone is gone (one owner for the log level)' ($chars -notmatch 'KeepPlatformLogReadable')

    # --------------------------------------------- 3. menu music output
    # Since #3207 the theme plays from the launcher's own process through
    # waveOut, not from a second WebView2; what #963 asked of that browser
    # holds for the sound output now: nothing open beside the game.
    $shell = Read 'launcher\app\Shell.cs'
    $mm = Read 'launcher\app\MenuMusic.cs'
    $md = [regex]::Match($shell, '(?s)static void MusicDecide\(\)\s*\{(.*?)\n        \}')
    Yes 'Shell: while the game runs MusicDecide closes the music output' ($md.Success -and $md.Groups[1].Value -match 'if \(playing\) \{ try \{ MenuMusic\.Close\(\); \}')
    Yes 'Shell: and returns before asking it to play or pause' ($md.Success -and $md.Groups[1].Value.IndexOf('MenuMusic.Close()') -lt $md.Groups[1].Value.IndexOf('MenuMusic.Decide('))
    $close = [regex]::Match($mm, '(?s)public static void Close\(\)\s*\{(.*?)\n        \}')
    Yes 'MenuMusic.Close stops the playback and lets go of it' ($close.Success -and $close.Groups[1].Value -match 'p\.Stop\(\);' -and $close.Groups[1].Value -match 'playback = null;')
    $run = [regex]::Match($mm, '(?s)void Run\(\)\s*\{(.*?)\n            \}')
    Yes 'the playback closes its sound output when it stops (waveOutReset, then waveOutClose)' ($run.Success -and $run.Groups[1].Value -match '(?s)finally.*waveOutReset\(dev\).*waveOutClose\(dev\)')
    $start = [regex]::Match($mm, '(?s)public static void Start\(.*?\)\s*\{(.*?)\n        \}')
    Yes 'MenuMusic.Start makes no playback (a launcher opened mid game never has one)' ($start.Success -and $start.Groups[1].Value -notmatch 'Open\(\)|Begin\(\)')
    $decide = [regex]::Match($mm, '(?s)public static void Decide\(bool play, double volume\)\s*\{(.*?)\n        \}')
    Yes 'MenuMusic.Decide makes one again when the music is wanted after the game' ($decide.Success -and $decide.Groups[1].Value -match 'if \(play && playback == null\) \{ Open\(\); return; \}')
    Yes 'the menu music makes no browser at all' ($mm -notmatch 'Microsoft\.Web\.WebView2')

    # --------------------------------------------- 4. voice quality kept
    # Two clients since the service's own page went (#1822): the game's voice
    # page, and the launcher's. Since #4823 the launcher's is its own code,
    # VoiceMix.cs, in place of voice-host.html in a web view, so its panner
    # is the HrtfPanner each source in VoiceMix.cs holds (VoiceHrtf.cs, the
    # port of Chromium's) rather than a Web Audio panningModel.
    $t = Read 'game\ui\thornswood-voice.js'
    $models = @([regex]::Matches($t, "panningModel\s*=\s*'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
    Yes "voice: the game's voice page pans with HRTF, not the cheaper equalpower ($($models -join ', '))" ($models.Count -eq 1 -and $models[0] -eq 'HRTF' -and $t -notmatch 'equalpower')
    $mix = Read 'launcher\app\VoiceMix.cs'
    Yes "voice: the launcher's voice mix (VoiceMix.cs) pans with HRTF too, not the cheaper equal power" ($null -ne $mix -and $mix -match 'new HrtfPanner\(' -and $mix -notmatch '\bEqualPower\s*\(')

    # --------------------------------------------- 5. half-rate updates off
    if ($OnWindows) {
    $settings = $Api::SettingsFile()
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settings) | Out-Null
    [IO.File]::WriteAllText($settings, "{`r`n  `"profileId`": 5,`r`n  `"gameData`": { `"profileId`": 5 },`r`n  `"skipUpdates`": true,`r`n  `"server-port`": 7777`r`n}`r`n")
    $Api::ChooseAtMenu(5)
    $s = Get-Content -LiteralPath $settings -Raw
    Yes 'half-rate updates: a settings file that says skipUpdates true is put back to false at Play' ($s -match '"skipUpdates":\s*false' -and $s -notmatch '"skipUpdates":\s*true')
    [IO.File]::WriteAllText($settings, "{`r`n  `"profileId`": 5,`r`n  `"gameData`": { `"profileId`": 5 },`r`n  `"server-port`": 7777`r`n}`r`n")
    $Api::ChooseAtMenu(5)
    Yes 'half-rate updates: absent stays absent (the client reads that as off)' ((Get-Content -LiteralPath $settings -Raw) -notmatch 'skipUpdates')
    } else {
        Write-Host 'SKIP  5, run: AutoJoin finds skymp5-client-settings.txt by its Windows path (Data\Platform\Plugins), which only Windows has'
    }
    $setsTrue = @(Get-ChildItem -Path (Join-Path $root 'launcher'), (Join-Path $root 'game'), (Join-Path $root 'scripts') -Recurse -File -Include *.cs, *.js, *.ps1, *.json, *.txt -ErrorAction SilentlyContinue |
        Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'skipUpdates["'']?\s*[:=]\s*true' })
    Yes 'half-rate updates: nothing we ship turns them on' ($setsTrue.Count -eq 0)

    # --------------------------------------------- 6. #978 process watch
    $checks = Read 'launcher\app\Checks.cs'
    $gp = [regex]::Match($checks, '(?s)public static List<Process> GameProcesses\(\)\s*\{(.*?)\n            return l;')
    # The code, not the comments, which name the old call to say why it went.
    $gpCode = if ($gp.Success) { [regex]::Replace($gp.Groups[1].Value, '(?m)^\s*//.*$', '') } else { '' }
    Yes '#978 GameProcesses lists the processes once (GetProcesses), not once per name' ($gp.Success -and ([regex]::Matches($gpCode, 'Process\.GetProcesses\(\)')).Count -eq 1 -and $gpCode -notmatch 'GetProcessesByName')
    # Out of play the tick returns before it, after redrawing the rows when
    # Steam has started or closed (#3204), so either shape of the return counts.
    Yes '#978 the in-play tick asks GameStillRunning' ($shell -match '(?s)if \(!playing\)(?: return;|\s*\{[^{}]*return;\s*\}).{0,400}if \(Checks\.GameStillRunning\(\)\)')

    # A pretend game: SkyrimSE and a browser helper, up for a minute of two
    # second ticks, then SkyrimSE closes and the helper goes with it.
    $alive = @{ 'SkyrimSE' = $true; 'helper' = $true }
    $looks = 0
    $look = [Func[Collections.Generic.List[string]]] {
        $script:looks++
        $l = New-Object 'Collections.Generic.List[string]'
        foreach ($k in $alive.Keys) { if ($alive[$k]) { $l.Add($k) } }
        return ,$l
    }.GetNewClosure()
    $watch = New-Object 'Thornswood963.Watched[string]' -ArgumentList @(
        $look,
        [Func[string, bool]] { param($p) $alive[$p] }.GetNewClosure(),
        [Action[string]] { param($p) })
    $answers = @()
    for ($i = 0; $i -lt 30; $i++) { $answers += $watch.Any() }
    Yes '#978 a minute of play (30 ticks) makes one full look, not 30 (120 lists before, four names each)' ($watch.Looks -eq 1)
    Yes '#978 and says the game is running on every tick' (@($answers | Where-Object { -not $_ }).Count -eq 0)
    $alive['SkyrimSE'] = $false
    Yes '#978 SkyrimSE closing with its helper still up: still running (the helper counts, as before)' ($watch.Any())
    $alive['helper'] = $false
    Yes '#978 the tick after both are gone says so' (-not $watch.Any())
    Yes '#978 and that answer came from a fresh look, like GameRunning' ($watch.Looks -eq 2)

    # --------------------------------------------- 7. #977 voice channel
    $voice = Read 'launcher\app\Voice.cs'
    $fc = [regex]::Match($voice, '(?s)static void StartFileChannel\(Action<string> log\)(.*?)\n        \}')
    # voice-token-ask.txt joined the two in #1322: the game asking for a join token.
    Yes '#977 the file channel waits on ChannelWait, not a 100 ms sleep' ($fc.Success -and $fc.Groups[1].Value -match 'new ChannelWait\(dirs, "voice-ptt\.txt", "voice-muted\.txt", "voice-token-ask\.txt"\)' -and $fc.Groups[1].Value -notmatch 'Thread\.Sleep\(100\)')
    Yes '#977 the slow tick rewrites voice-status.txt only when a copy is missing or wrong' ($fc.Success -and $fc.Groups[1].Value -match 'RepublishIfLost\(\);' -and $fc.Groups[1].Value -notmatch 'lastStatusLine = "";\s*// On the same slow tick')

    $chan = Join-Path $tmp 'Channel'
    New-Item -ItemType Directory -Force -Path $chan | Out-Null
    $wait = New-Object Thornswood963.ChannelWait -ArgumentList @([string[]]@($chan), [string[]]@('voice-ptt.txt', 'voice-muted.txt'))
    Yes '#977 the channel folder is watched' ($wait.Watching)
    # The game's log and our own status file beside it: none of it wakes. The
    # log fills the way a busy one does, a line every couple of milliseconds.
    $log = Join-Path $chan 'thornswood-front.log'
    $Api::AppendPaced($log, 300, 2)
    [IO.File]::WriteAllText((Join-Path $chan 'voice-status.txt'), '1 0 0 local')
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $woke = $wait.Wait(1000)
    $idle = $sw.ElapsedMilliseconds
    Yes "#977 300 log lines and our own status write do not wake it (woke: $woke, wakes $($wait.Wakes))" (-not $woke -and $wait.Wakes -eq 0)
    Yes "#977 idle, it sleeps the whole slow tick ($idle ms) rather than waking every 100 ms" ($idle -ge 900)
    # Push to talk: the game writes the file; the wait returns at once.
    $ptt = Join-Path $chan 'voice-ptt.txt'
    $writer = $Api::WriteLater($ptt, '1 local', 300)
    $woke = $wait.Wait(2000)
    $at = [Diagnostics.Stopwatch]::GetTimestamp()
    $writer.Wait()
    $lat = [math]::Round(($at - $Api::WrittenAt) * 1000.0 / [Diagnostics.Stopwatch]::Frequency, 1)
    # Woken by the write, not by its 2000 ms running out: the watcher's own
    # count says the file woke it, and with a folder watched there is no poll
    # to come back on. The time from the write to the wake is said, not held
    # to a number: past the event itself it is how soon the runner gives the
    # watcher's thread the CPU. On 21 Oct five gate runs of the same
    # ChannelWait.cs on the VPS runners measured 1.6, 1.8, 1.8 and 3.1 ms, and
    # one on thornswood-vps-3 161.9 ms, which failed the old 50 ms bound on a
    # pull request that did not touch the launcher (#3039).
    Yes "#977 push to talk wakes it through the watcher ($($wait.Wakes) wake(s), $lat ms after the game started writing; the old poll: 0 to 100 ms)" ($woke -and $wait.Wakes -ge 1)
    [IO.File]::WriteAllText((Join-Path $chan 'voice-muted.txt'), '123')
    Yes '#977 the mute list wakes it too' ($wait.Wait(2000))
    $wait.Dispose()
    $none = New-Object Thornswood963.ChannelWait -ArgumentList @([string[]]@((Join-Path $tmp 'nowhere')), [string[]]@('voice-ptt.txt'))
    $sw.Restart(); $r = $none.Wait(2000); $fell = $sw.ElapsedMilliseconds
    Yes "#977 with no folder to watch it falls back to the old 100 ms read ($fell ms)" (-not $none.Watching -and $r -and $fell -lt 1000)

    # --------------------------------------------- 8. #979 Hold watcher
    if ($OnWindows) {
    $plat = Join-Path $game 'Data\Platform'
    New-Item -ItemType Directory -Force -Path (Join-Path $plat 'Plugins'), (Join-Path $plat 'UI') | Out-Null
    $null = $Api::HoldTake()
    $Api::AppendPaced((Join-Path $plat 'thornswood-front.log'), 500, 1)
    [IO.File]::WriteAllText((Join-Path $plat 'voice-status.txt'), '1 0 0 local')
    [IO.File]::WriteAllText((Join-Path $plat 'voice-ptt.txt'), '0 local')
    [Threading.Thread]::Sleep(500)
    $w0 = $Api::HoldWakes()
    Yes "#979 500 log lines and the voice files in Data\Platform wake it $w0 times (every one did before)" ($w0 -eq 0)
    [IO.File]::WriteAllText((Join-Path $plat 'Plugins\another-server.js'), '// not ours')
    [Threading.Thread]::Sleep(500)
    Yes '#979 a file written into Plugins still wakes it' ($Api::HoldWakes() -gt 0)
    Yes '#979 and is still named in the log' (@($Api::HoldSaid() | Where-Object { $_ -match 'another-server\.js' }).Count -eq 1)
    [IO.File]::WriteAllText((Join-Path $plat 'UI\index.html'), '<!-- theirs -->')
    [Threading.Thread]::Sleep(500)
    Yes '#979 as is one written into UI' (@($Api::HoldSaid() | Where-Object { $_ -match 'UI\\index\.html' }).Count -eq 1)
    $Api::HoldRelease()
    } else {
        Write-Host 'SKIP  8, run: Hold watches Data\Platform\Plugins and Data\Platform\UI by their Windows paths, which only Windows has'
    }
}
finally {
    try { $Api::HoldRelease() } catch { }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail -gt 0) { exit 1 }
