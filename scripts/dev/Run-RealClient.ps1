<#
  Run-RealClient.ps1

      pwsh scripts\dev\Run-RealClient.ps1 [-Root <install>] [-Steps tests\real-client\dev-release.json] [-InstallPlugin] [-Publish]

  Starts the real launcher and the real game on this PC, presses Play the way
  a person does, and walks the game through a list of steps with the test
  plugin, game\plugins\thornswood-test.js (#5197). Writes what happened and a
  screenshot after each step that asks for one into temp\real-client\<run>,
  and with -Publish puts them on the GitHub Release of the newest Dev
  Deployment and a line on that Deployment.

  WHY. Some failures only show in the real game: the frozen choice page, the
  journal that crashed it, the launcher's Play, the collection's load order.
  GitHub's runners have no graphics card or Skyrim, so this runs on One, the
  in-game exception to keeping work off One. Patrick, 12 Nov 2026: it runs on
  One, and once Hermes takes it over each run gets an approval card that
  nothing waits on.

  HOW IT TALKS TO THE GAME. It writes the steps to
  Game\Data\Platform\thornswood-test-run.json before Play; the plugin reads
  and deletes that, then writes one JSON line per event to
  thornswood-test-results.jsonl. A line {"t":"ask","n":N,"do":"shot"|"key"}
  is something only this script can do: a screenshot of the game window, or a
  real key press through Windows. This does it and writes N to
  thornswood-test-ack.txt, which is when the plugin's step is over. The run
  ends at the plugin's {"t":"done"} line, when the game closes by itself (a
  crash, said so), or after -Minutes.

  It refuses to start while the launcher or the game is already running, so
  it never takes over somebody's session. It stops both when it ends.

  Windows only: it drives the launcher through UI Automation and the game
  window through user32.
#>
[CmdletBinding()]
param(
    # The dev install, which Where.ps1 InstallDev finds, unless named.
    [string]$Root = '',
    [string]$Steps = '',
    [string]$Out = '',
    [int]$Minutes = 20,
    [int]$PlayMinutes = 15,
    # Copy this repository's thornswood-test.js into the game first, for a
    # build released before the plugin was in a pack.
    [switch]$InstallPlugin,
    [switch]$Publish,
    [string]$Repo = 'ThornswoodRP/Thornswood'
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Run-RealClient.ps1 drives the real game, so it runs on Windows only.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Root) { $Root = & (Join-Path $repoRoot 'scripts\release\Where.ps1') InstallDev }
if (-not $Steps) { $Steps = Join-Path $repoRoot 'tests\real-client\dev-release.json' }
$runId = (Get-Date).ToString('yyyyMMdd-HHmmss')
if (-not $Out) { $Out = Join-Path $repoRoot ('temp\real-client\' + $runId) }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$game = Join-Path $Root 'Game'
$platform = Join-Path $game 'Data\Platform'
$launcherExe = Join-Path $Root 'Launcher\Thornswood.exe'
$runFile = Join-Path $platform 'thornswood-test-run.json'
$resultsFile = Join-Path $platform 'thornswood-test-results.jsonl'
$ackFile = Join-Path $platform 'thornswood-test-ack.txt'
$logFile = Join-Path $Out 'run.log'

function Say([string]$text) {
    $line = (Get-Date).ToString('HH:mm:ss') + ' ' + $text
    Write-Host $line
    Add-Content -LiteralPath $logFile -Value $line
}

foreach ($p in @($game, $platform, $launcherExe, $Steps)) {
    if (-not (Test-Path -LiteralPath $p)) { throw "Not there: $p" }
}
if (-not (Test-Path -LiteralPath (Join-Path $Root 'Profile\dev-allowed.txt'))) {
    throw "No Profile\dev-allowed.txt under $Root, so the test plugin would not run: the site has not named this install's Discord account a dev."
}

$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -in @('SkyrimSE', 'skse64_loader') -or
    ($_.ProcessName -eq 'Thornswood' -and $_.Path -and $_.Path.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase))
})
if ($running.Count -gt 0) {
    throw ('Already running, so this run would take over somebody''s session: ' + (($running | ForEach-Object { $_.ProcessName + ' ' + $_.Id }) -join ', '))
}

if ($InstallPlugin) {
    $src = Join-Path $repoRoot 'game\plugins\thornswood-test.js'
    Copy-Item -LiteralPath $src -Destination (Join-Path $platform 'Plugins\thornswood-test.js') -Force
    Say 'Copied this repository''s thornswood-test.js into the game.'
}
if (-not (Test-Path -LiteralPath (Join-Path $platform 'Plugins\thornswood-test.js'))) {
    throw 'The game has no Data\Platform\Plugins\thornswood-test.js: the build predates it. Run with -InstallPlugin.'
}

# ---------------------------------------------------------------- Windows --
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('ThornswoodRealClient.Win' -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing, System.Drawing.Primitives -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
namespace ThornswoodRealClient {
  public static class Win {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);

    // The game reads DirectInput scan codes, so the key goes as a scan code,
    // down then up, the way a keyboard sends it.
    public static uint TapScan(ushort scan) {
      INPUT[] i = new INPUT[2];
      i[0].type = 1; i[0].u.ki.wScan = scan; i[0].u.ki.dwFlags = 0x0008;
      i[1].type = 1; i[1].u.ki.wScan = scan; i[1].u.ki.dwFlags = 0x0008 | 0x0002;
      return SendInput(2, i, Marshal.SizeOf(typeof(INPUT)));
    }

    // The game window's picture, the game and our page over it. PrintWindow
    // with PW_RENDERFULLCONTENT asks the window for its own frame, which
    // works for a DirectX window behind another one; the screen is copied
    // when that comes back empty.
    public static string Shot(IntPtr h, string file) {
      RECT r; if (!GetClientRect(h, out r)) return "no client rect";
      int w = r.Right - r.Left, ht = r.Bottom - r.Top;
      if (w <= 0 || ht <= 0) return "the window has no size";
      using (Bitmap b = new Bitmap(w, ht, PixelFormat.Format32bppArgb)) {
        bool ok;
        using (Graphics g = Graphics.FromImage(b)) {
          IntPtr dc = g.GetHdc();
          ok = PrintWindow(h, dc, 3);
          g.ReleaseHdc(dc);
        }
        if (!ok || Blank(b)) {
          POINT p = new POINT(); ClientToScreen(h, ref p);
          using (Graphics g = Graphics.FromImage(b)) { g.CopyFromScreen(p.X, p.Y, 0, 0, new Size(w, ht)); }
          b.Save(file, ImageFormat.Png);
          return Blank(b) ? "copied from the screen, and it is blank" : "copied from the screen";
        }
        b.Save(file, ImageFormat.Png);
        return "from the window";
      }
    }
    static bool Blank(Bitmap b) {
      Color first = b.GetPixel(b.Width / 2, b.Height / 2);
      for (int y = 0; y < b.Height; y += Math.Max(1, b.Height / 16))
        for (int x = 0; x < b.Width; x += Math.Max(1, b.Width / 16))
          if (b.GetPixel(x, y).ToArgb() != first.ToArgb()) return false;
      return true;
    }
  }
}
'@
}

function Get-GameProcess {
    Get-Process -Name SkyrimSE -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
}

# ---------------------------------------------------------------- the run --
$stepsJson = Get-Content -LiteralPath $Steps -Raw | ConvertFrom-Json
$run = [ordered]@{ id = $runId; steps = $stepsJson.steps }
foreach ($f in @($resultsFile, $ackFile)) { if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force } }
[IO.File]::WriteAllText($runFile, ($run | ConvertTo-Json -Depth 8))
[IO.File]::WriteAllText($ackFile, '0')
Say "Run $runId, $($stepsJson.steps.Count) steps from $Steps, into $Out"

$launcherLog = Join-Path $Root 'Profile\launcher.log'
$launcherLogStart = if (Test-Path -LiteralPath $launcherLog) { (Get-Item -LiteralPath $launcherLog).Length } else { 0 }

$launcher = Start-Process -FilePath $launcherExe -WorkingDirectory (Split-Path $launcherExe) -PassThru
Say "Started the launcher, process $($launcher.Id)"

$result = 'unfinished'
$note = ''
try {
    # Play, through UI Automation, once the launcher lets it be pressed: an
    # update or the mod check may be holding it.
    $ae = [System.Windows.Automation.AutomationElement]
    $cond = New-Object System.Windows.Automation.PropertyCondition ($ae::AutomationIdProperty, 'BtnPlay')
    $deadline = (Get-Date).AddMinutes($PlayMinutes)
    $pressed = $false
    $toldWaiting = $false
    while (-not $pressed) {
        if ((Get-Date) -gt $deadline) { throw "Play was not there to press in $PlayMinutes minutes" }
        if ($launcher.HasExited) { throw "The launcher closed by itself, exit code $($launcher.ExitCode)" }
        $launcher.Refresh()
        $h = $launcher.MainWindowHandle
        if ($h -ne [IntPtr]::Zero) {
            $win = $ae::FromHandle($h)
            $btn = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
            if ($btn -and $btn.Current.IsEnabled) {
                $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
                $pressed = $true
                Say ('Pressed Play (' + $btn.Current.Name + ')')
                break
            }
            if (-not $toldWaiting) { Say 'The launcher is up; Play is not pressable yet.'; $toldWaiting = $true }
        }
        Start-Sleep -Milliseconds 500
    }

    $deadline = (Get-Date).AddMinutes($Minutes)
    $read = 0
    $sawGame = $false
    $shots = 0
    while ($true) {
        if ((Get-Date) -gt $deadline) { $result = 'timeout'; $note = "no end in $Minutes minutes"; break }
        $proc = Get-GameProcess
        if ($proc) { if (-not $sawGame) { Say "The game is up, process $($proc.Id)" }; $sawGame = $true }
        elseif ($sawGame) { $result = 'crashed'; $note = 'the game closed before the run ended'; break }

        $lines = @()
        if (Test-Path -LiteralPath $resultsFile) {
            $all = [IO.File]::ReadAllLines($resultsFile)
            if ($all.Count -gt $read) { $lines = $all[$read..($all.Count - 1)]; $read = $all.Count }
        }
        $ended = $false
        foreach ($line in $lines) {
            if (-not $line.Trim()) { continue }
            $o = $line | ConvertFrom-Json
            switch ($o.t) {
                'step' { Say ('step ' + $o.i + ' ' + $o.do + ': ' + ($(if ($o.ok) { 'pass' } else { 'FAIL' })) + ' in ' + $o.ms + ' ms ' + $o.note) }
                'menu' { Say ('menu ' + $o.name + ($(if ($o.open) { ' opened' } else { ' closed' }))) }
                'start' { Say "The plugin took the run ($($o.steps) steps)" }
                'done' { $result = $(if ($o.ok) { 'passed' } else { 'failed' }); $note = "$($o.passed) of $($o.steps) steps passed. $($o.note)" }
                'ask' {
                    $proc = Get-GameProcess
                    if ($o.do -eq 'shot') {
                        $shots++
                        $name = ('{0:00}-{1}.png' -f $shots, ($o.arg -replace '[^\w\-]', '_'))
                        $how = if ($proc) { [ThornswoodRealClient.Win]::Shot($proc.MainWindowHandle, (Join-Path $Out $name)) } else { 'no game window' }
                        Say "shot $name ($how)"
                    } elseif ($o.do -eq 'key') {
                        if ($proc) {
                            [void][ThornswoodRealClient.Win]::SetForegroundWindow($proc.MainWindowHandle)
                            $sent = [ThornswoodRealClient.Win]::TapScan([uint16]$o.arg)
                            $fg = [ThornswoodRealClient.Win]::GetForegroundWindow()
                            Say ("key $($o.arg) sent ($sent events" + $(if ($fg -ne $proc.MainWindowHandle) { ', but the game window does not have the keyboard' } else { '' }) + ')')
                        } else { Say "key $($o.arg): no game window" }
                    } elseif ($o.do -eq 'end') { $ended = $true }
                    [IO.File]::WriteAllText($ackFile, [string]$o.n)
                }
            }
        }
        if ($ended) { break }
        Start-Sleep -Milliseconds 200
    }
} catch {
    $result = 'error'
    $note = $_.Exception.Message
    Say "Stopped: $note"
} finally {
    $proc = Get-Process -Name SkyrimSE -ErrorAction SilentlyContinue
    if ($proc) { $proc | Stop-Process -Force; Say 'Closed the game.' }
    if (-not $launcher.HasExited) { $launcher | Stop-Process -Force; Say 'Closed the launcher.' }
    if (Test-Path -LiteralPath $runFile) { Remove-Item -LiteralPath $runFile -Force; Say 'The plugin never took the run file; removed it so the next Play does not run it.' }
}

# ------------------------------------------------------------ what it saw --
if (Test-Path -LiteralPath $resultsFile) { Copy-Item -LiteralPath $resultsFile -Destination (Join-Path $Out 'results.jsonl') }
if (Test-Path -LiteralPath $launcherLog) {
    $fs = [IO.File]::Open($launcherLog, 'Open', 'Read', 'ReadWrite')
    try {
        [void]$fs.Seek([Math]::Min($launcherLogStart, $fs.Length), 'Begin')
        $sr = New-Object IO.StreamReader($fs)
        [IO.File]::WriteAllText((Join-Path $Out 'launcher.log'), $sr.ReadToEnd())
    } finally { $fs.Dispose() }
}

$summary = @(
    "# Real game run $runId",
    '',
    "Result: $result. $note",
    "Install: $Root",
    "Steps: $Steps",
    '',
    '## What happened',
    ''
) + (Get-Content -LiteralPath $logFile | ForEach-Object { '    ' + $_ })
[IO.File]::WriteAllLines((Join-Path $Out 'summary.md'), $summary)
Say "Result: $result. $note"

if ($Publish) {
    $dep = gh api "repos/$Repo/deployments?environment=Dev&per_page=1" | ConvertFrom-Json | Select-Object -First 1
    if (-not $dep -or -not $dep.payload.release) { throw 'No Dev Deployment with a release to put the run on.' }
    $tag = $dep.payload.release
    $zip = Join-Path (Split-Path $Out) ("real-client-$runId.zip")
    Compress-Archive -Path (Join-Path $Out '*') -DestinationPath $zip -Force
    $md = Join-Path (Split-Path $Out) ("real-client-$runId.md")
    Copy-Item -LiteralPath (Join-Path $Out 'summary.md') -Destination $md -Force
    gh release upload $tag $zip $md --repo $Repo --clobber
    if ($LASTEXITCODE -ne 0) { throw "Could not put the run on the release $tag" }
    $state = (gh api "repos/$Repo/deployments/$($dep.id)/statuses?per_page=1" | ConvertFrom-Json | Select-Object -First 1).state
    if (-not $state) { $state = 'success' }
    $desc = ("Real game run: $result. $note")
    if ($desc.Length -gt 140) { $desc = $desc.Substring(0, 137) + '...' }
    $body = @{ state = $state; description = $desc; log_url = "https://github.com/$Repo/releases/download/$tag/real-client-$runId.md"; auto_inactive = $false } | ConvertTo-Json -Compress
    $body | gh api --method POST "repos/$Repo/deployments/$($dep.id)/statuses" --input - | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not say the run on Deployment $($dep.id)" }
    Say "On Deployment $($dep.id) ($tag), its state left $state."
}

if ($result -ne 'passed') { exit 1 }
