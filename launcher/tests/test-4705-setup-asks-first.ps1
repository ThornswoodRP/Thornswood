<#
  test-4705-setup-asks-first.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4705-setup-asks-first.ps1

  #4705. The first-run setup did two things to what is the person's, not
  the setup's, without asking first:
    - InstallSkyrim.Stop sent every open Skyrim window a close request
      (CloseMainWindow, the window's own close button, which ends an unsaved
      game at once), and asked only about what was still running after;
    - InstallSteps.Run moved an old Game folder aside with a log line and
      no question.
  Now the open windows are named in a Yes or No box before any request is
  sent, and the move is named in one before the folder is touched.

  This compiles the real InstallSkyrim.cs with Process swapped for a fake
  one, and the real old-folder block of InstallSteps.Run, lifted out of the
  file, against a temp folder. No Skyrim, launcher or setup is started.
  Cases, one each:
    1. Cancel at the close question: the game is asked about before anything
       is sent, No stops the install, and the game got no request and no kill.
    2. Yes at the close question sends the one request, and a game that closes
       on it is never asked about again.
    3. A helper with no window gets no close request; it goes to the end-it
       question, and No there ends nothing.
    4. Cancel at the move question: the install stops and Game is where it
       was, every file in it.
    5. Yes at the move question: Game is now Game-old-<date>, with the same
       files and the same bytes, and the question named both places.
    6. Ordinary setup, no Skyrim open and no old Game folder: no question.
       This one passes on main by behaviour too; it guards that the new
       questions only come when there is something to ask about.
    7. A folder the launcher made (Profile\OwnGame\files.txt) is never asked
       about and never moved.

  On main 1, 4 and 5 fail by behaviour: the request goes out before any
  question, and the folder moves with none. The lifted block calls
  MoveOldGameQuestion, which main does not have, so on main the whole run
  stops at the compile.
#>
$ErrorActionPreference = 'Stop'
$app = Join-Path (Split-Path -Parent $PSScriptRoot) 'app'
$pass = 0; $fail = 0
function Yes([string]$name, [bool]$ok) { if ($ok) { $script:pass++; Write-Host "PASS  $name" } else { $script:fail++; Write-Host "FAIL  $name" } }

$sky = [IO.File]::ReadAllText((Join-Path $app 'InstallSkyrim.cs'))
$steps = [IO.File]::ReadAllText((Join-Path $app 'InstallSteps.cs'))

# The old-folder block, from its if to its closing brace, and the question.
$move = [regex]::Match($steps, '(?ms)^            if \(!madeOwn && Directory\.Exists\(ownGame\)\)\r?\n.*?^            \}\r?\n').Value
$question = [regex]::Match($steps, '(?ms)^        public static string MoveOldGameQuestion\(string from, string to\)\r?\n.*?^        \}\r?\n').Value
Yes 'the old Game folder block is found in InstallSteps.Run' ($move.Length -gt 0)
Yes 'and so is the question it asks (MoveOldGameQuestion)' ($question.Length -gt 0)
Yes 'InstallWindow hands the steps a Yes or No box' (
    [IO.File]::ReadAllText((Join-Path $app 'InstallWindow.cs')).Contains('new InstallSteps(choice, Line, Progress, q => Dispatcher.UIThread.Invoke(() => Ask.YesNo(q, Title_, Ask.Icon.Warning)))'))
if (-not $move -or -not $question) { Write-Host "$pass passed, $fail failed"; exit 1 }

# Process is the fake for the whole compilation; the waits are the real code's.
$sky = $sky.Replace('using System.Diagnostics;', "using System.Diagnostics;`nusing Process = Thornswood.FakeProcess;")
$driver = @'
namespace Thornswood
{
    public sealed class FakeProcess : IDisposable
    {
        public static List<FakeProcess> Running = new List<FakeProcess>();
        public static Func<string, bool> Seen;
        public static FakeProcess[] GetProcessesByName(string name) { return Running.FindAll(p => p.ProcessName == name).ToArray(); }
        public string ProcessName { get; set; }
        public bool HasWindow, ClosesOnRequest;
        public bool HasExited { get; private set; }
        public int Closes, Kills;
        public IntPtr MainWindowHandle { get { return HasWindow ? new IntPtr(1) : IntPtr.Zero; } }
        public bool CloseMainWindow() { Closes++; if (ClosesOnRequest) HasExited = true; return true; }
        public bool WaitForExit(int ms) { return HasExited; }
        public void Kill() { Kills++; HasExited = true; }
        public void Dispose() { }
    }
    public sealed class InstallStop : Exception { public InstallStop(string text) : base(text) { } }
    static class Failure
    {
        public static string Why(string stage, Exception error, string name) { return error.Message; }
        public static string Say(string stage, Exception error) { return error.Message; }
    }
    public static class FolderProbe
    {
        public static string RootDir;
        public static List<string> Said = new List<string>();
        static string Root { get { return RootDir; } }
        static void Say(string s) { Said.Add(s); }
        static InstallStop Die(string m) { return new InstallStop(m); }
__QUESTION__
        public static void Run(bool madeOwn, Func<string, bool> askYesNo)
        {
            string ownGame = Path.Combine(Root, "Game");
__MOVE__
        }
    }
}
'@
$src = $sky.Replace('using System.ComponentModel;', "using System.ComponentModel;`nusing System.Globalization;`nusing System.IO;") + "`n" + $driver.Replace('__QUESTION__', $question).Replace('__MOVE__', $move)
Add-Type -TypeDefinition $src -Language CSharp

$P = [Thornswood.FakeProcess]
$Sky = [Thornswood.InstallSkyrim]
function Stops([scriptblock]$b) { try { & $b; return $false } catch { if ($_.Exception.InnerException -is [Thornswood.InstallStop] -or $_.Exception -is [Thornswood.InstallStop] -or $_.Exception.GetBaseException() -is [Thornswood.InstallStop]) { return $true }; throw } }
function Game([string]$name, [bool]$window, [bool]$closes) {
    $g = New-Object Thornswood.FakeProcess
    $g.ProcessName = $name; $g.HasWindow = $window; $g.ClosesOnRequest = $closes
    $P::Running.Clear(); $P::Running.Add($g); return $g
}

# ---- 1. cancel at the close question --------------------------------------------
$g = Game 'SkyrimSE' $true $true
$asked = New-Object System.Collections.Generic.List[string]
$closesWhenAsked = -1
$stopped = Stops { $Sky::Stop([Func[string, bool]]{ param($q) $asked.Add($q); $script:closesWhenAsked = $g.Closes; return $false }) }
Yes '1. an open game is asked about before anything is sent to it' ($asked.Count -eq 1 -and $closesWhenAsked -eq 0 -and $asked[0].Contains('SkyrimSE') -and $asked[0].Contains('Ask it to close now?'))
Yes '   No stops the install' $stopped
Yes '   and the game got no close request and no kill, and is still running' ($g.Closes -eq 0 -and $g.Kills -eq 0 -and -not $g.HasExited)

# ---- 2. yes at the close question ------------------------------------------------
$g = Game 'SkyrimSE' $true $true
$asked.Clear()
$n = $Sky::Stop([Func[string, bool]]{ param($q) $asked.Add($q); return $true })
Yes '2. Yes sends the one close request' ($g.Closes -eq 1 -and $g.Kills -eq 0 -and $n -eq 1)
Yes '   and a game that closes on it is asked about only once' ($asked.Count -eq 1)

# ---- 3. a helper with no window ----------------------------------------------------
$g = Game 'skse64_loader' $false $false
$asked.Clear()
$stopped = Stops { $Sky::Stop([Func[string, bool]]{ param($q) $asked.Add($q); return $false }) }
Yes '3. a helper with no window gets no close request' ($g.Closes -eq 0)
Yes '   it is named in the end-it question, and No there ends nothing' ($stopped -and $asked.Count -eq 1 -and $asked[0].Contains('Close it now?') -and $g.Kills -eq 0)

# ---- the old Game folder, in a temp folder ---------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4705-' + [Guid]::NewGuid().ToString('n'))
function Fresh {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
    $game = Join-Path $work 'Game'
    [void][IO.Directory]::CreateDirectory((Join-Path $game 'Data'))
    [IO.File]::WriteAllBytes((Join-Path $game 'SkyrimSE.exe'), [byte[]](1..200))
    [IO.File]::WriteAllText([IO.Path]::Combine($game, 'Data', 'Somebody.esp'), 'kept')
    [Thornswood.FolderProbe]::RootDir = $work
}
function Files([string]$dir) {
    if (-not (Test-Path -LiteralPath $dir)) { return '' }
    (Get-ChildItem -LiteralPath $dir -Recurse -File | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($dir.Length) + '=' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join ';'
}
try {
    # ---- 4. cancel at the move question ----------------------------------------------
    Fresh
    $game = Join-Path $work 'Game'
    $before = Files $game
    $asked.Clear()
    $stopped = Stops { [Thornswood.FolderProbe]::Run($false, [Func[string, bool]]{ param($q) $asked.Add($q); return $false }) }
    Yes '4. an old Game folder is asked about before it is touched' ($asked.Count -eq 1 -and $asked[0].Contains($game) -and $asked[0].Contains('Move it now?'))
    Yes '   No stops the install' $stopped
    Yes '   and Game is where it was, every file in it' ((Files $game) -eq $before -and $before.Length -gt 0 -and @(Get-ChildItem -LiteralPath $work -Directory -Filter 'Game-old-*').Count -eq 0)

    # ---- 5. yes at the move question --------------------------------------------------
    Fresh
    $before = Files $game
    $asked.Clear()
    [Thornswood.FolderProbe]::Run($false, [Func[string, bool]]{ param($q) $asked.Add($q); return $true })
    $parked = @(Get-ChildItem -LiteralPath $work -Directory -Filter 'Game-old-*')
    Yes '5. Yes moves it to Game-old-<date>' ($parked.Count -eq 1 -and -not (Test-Path -LiteralPath $game))
    Yes '   with the same files and the same bytes' ($parked.Count -eq 1 -and (Files $parked[0].FullName) -eq $before)
    Yes '   and the question named where it was and where it went' ($asked.Count -eq 1 -and $parked.Count -eq 1 -and $asked[0].Contains($game) -and $asked[0].Contains($parked[0].FullName))

    # ---- 6. ordinary setup ---------------------------------------------------------------
    $P::Running.Clear()
    $never = [Func[string, bool]]{ param($q) throw "asked when there was nothing to ask about: $q" }
    Yes '6. no Skyrim open: no question, and nothing to close' ($Sky::Stop($never) -eq 0)
    Remove-Item -LiteralPath $work -Recurse -Force
    [void][IO.Directory]::CreateDirectory($work)
    [Thornswood.FolderProbe]::Run($false, $never)
    Yes '   no old Game folder: no question, and nothing made' (@(Get-ChildItem -LiteralPath $work).Count -eq 0)

    # ---- 7. the launcher's own folder ----------------------------------------------------
    Fresh
    $before = Files $game
    [Thornswood.FolderProbe]::Run($true, $never)
    Yes '7. a folder the launcher made is never asked about and never moved' ((Files $game) -eq $before)
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
    $P::Running.Clear()
}

Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
