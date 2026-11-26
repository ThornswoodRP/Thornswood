<#
  Run-RealClient.ps1

      pwsh scripts\dev\Run-RealClient.ps1 [-Root <install>] [-Steps tests\real-client\dev-release.json] [-Publish]

  Starts the real launcher and the real game on this PC, presses Play the way
  a person does, and walks the game through a list of steps with the test
  plugin, game\plugins\thornswood-test.js (#5197). Writes what happened and a
  screenshot after each step that asks for one into temp\real-client\<run>,
  and with -Publish puts them on a draft Release of their own, which only
  the team sees, with a line on the newest Dev Deployment that links it.

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
  real key press through Windows. This writes {n:N,ok:true|false,note:...} to
  thornswood-test-ack.txt; the plugin fails a rejected key step. The run
  ends at the plugin's {"t":"done"} line, when the game closes by itself (a
  crash, said so), or after -Minutes.

  It refuses to start while the launcher or the game is already running, so
  it never takes over somebody's session. Its steps are for a dev release, so
  an install on the main channel is put on dev for the run, the way the
  launcher's Server card switch does it (launcher\app\DevBuild.cs Set): the
  launcher takes dev's package by itself when it starts, and Play is pressed
  only once the launcher running is dev's. When the run ends the install's
  channel is put back as it was, and the launcher takes that channel's
  package again at its next start. It stops the launcher and the game when it
  ends.

  Windows only: it drives the launcher through UI Automation and the game
  window through user32.
#>
[CmdletBinding()]
param(
    # The install, which Where.ps1 Install finds, unless named. Dev is a
    # channel of that one install, set on the launcher's Settings page.
    [string]$Root = '',
    [string]$Steps = '',
    [string]$Out = '',
    [int]$Minutes = 20,
    [int]$PlayMinutes = 15,
    [switch]$Publish,
    [string]$Repo = 'ThornswoodRP/Thornswood'
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Run-RealClient.ps1 drives the real game, so it runs on Windows only.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$where = Join-Path $repoRoot 'scripts\release\Where.ps1'
if (-not $Root) { $Root = & $where Install }
$Root = $Root.TrimEnd('\')
if (-not $Steps) { $Steps = Join-Path $repoRoot 'tests\real-client\dev-release.json' }
$runId = (Get-Date).ToString('yyyyMMdd-HHmmss')
if (-not $Out) { $Out = Join-Path $repoRoot ('temp\real-client\' + $runId) }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$game = Join-Path $Root 'Game'
$platform = Join-Path $game 'Data\Platform'
# The launcher of this install. A launcher from the setup is a Velopack
# install in this account's own folder (MachineData, %LOCALAPPDATA%\Thornswood),
# with Thornswood.exe in its current folder and the install folder it serves
# written in install-root.txt beside it (launcher\app\InstallPlace.cs). Until
# 15 Nov this script looked only in <Root>\Launcher, the layout from before
# Velopack, and so stopped on "Not there" on every install the setup makes.
# A folder with that older layout, such as a ship root, keeps its own.
$veloHome = & $where MachineData
$veloRecord = Join-Path $veloHome 'install-root.txt'
$veloRoot = ''
if (Test-Path -LiteralPath $veloRecord) { $veloRoot = ([IO.File]::ReadAllText($veloRecord)).Trim().TrimEnd('\') }
if ($veloRoot -and [string]::Equals($veloRoot, $Root, [StringComparison]::OrdinalIgnoreCase)) {
    $launcherExe = Join-Path $veloHome 'current\Thornswood.exe'
} else {
    $launcherExe = Join-Path $Root 'Launcher\Thornswood.exe'
}
$runFile = Join-Path $platform 'thornswood-test-run.json'
$resultsFile = Join-Path $platform 'thornswood-test-results.jsonl'

# The plugin appends a line to the results file for each thing it does, while
# this reads it. A read must let that append go on: [IO.File]::ReadAllLines
# opens the file sharing reading only, so an append that came at that moment
# failed, its line was never written, and the run waited 30 s for a screenshot
# it had never been asked for (#5197, 16 Nov). The file is opened sharing
# writing and deleting, as launcher.log is below, and only whole lines are
# taken: a line the plugin is still writing is read once its end is there.
$script:resultsReadAt = 0
function Read-NewResultLines {
    if (-not (Test-Path -LiteralPath $resultsFile)) { return @() }
    $fs = [IO.File]::Open($resultsFile, 'Open', 'Read', 'ReadWrite, Delete')
    try {
        $have = $fs.Length - $script:resultsReadAt
        if ($have -le 0) { return @() }
        [void]$fs.Seek($script:resultsReadAt, 'Begin')
        $buf = New-Object byte[] $have
        $n = 0
        while ($n -lt $buf.Length) {
            $got = $fs.Read($buf, $n, $buf.Length - $n)
            if ($got -le 0) { break }
            $n += $got
        }
        if ($n -le 0) { return @() }
        $end = [Array]::LastIndexOf($buf, [byte]10, $n - 1)
        if ($end -lt 0) { return @() }
        $script:resultsReadAt += $end + 1
        return @([Text.Encoding]::UTF8.GetString($buf, 0, $end + 1) -split "`n" | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_ })
    } finally { $fs.Dispose() }
}
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
# The run joins whichever server the install is on, and its steps are for a
# dev release (-Publish puts it on the newest Dev Deployment). The channel is
# five fields of config.json, which the launcher's Server card switch sets
# together (launcher\app\DevBuild.cs Set): Channel, UpdateBranch, and the
# server's game and voice ports and voice address. An install on main is put
# on dev here the same way, and put back when the run ends (Set-RunChannel).
$cfgFile = Join-Path $Root 'config.json'
$channelFields = @('Channel', 'UpdateBranch', 'ServerPort', 'VoicePort', 'VoiceUrl')
function Read-ChannelFields {
    try { $c = [IO.File]::ReadAllText($cfgFile) | ConvertFrom-Json }
    catch { throw "No readable config.json in $Root, so which server this install joins is not known: $($_.Exception.Message)" }
    $f = [ordered]@{}
    foreach ($n in $channelFields) {
        if (-not $c.PSObject.Properties[$n]) { throw "config.json in $Root has no $n, so its channel cannot be set the way the launcher sets it." }
        $f[$n] = [string]$c.$n
    }
    $f
}
# Writes the five fields into config.json as they are given and leaves every
# other byte of it as the launcher wrote it.
function Set-RunChannel($fields) {
    $text = [IO.File]::ReadAllText($cfgFile)
    foreach ($n in $channelFields) {
        $rx = [regex]('("' + $n + '"\s*:\s*)("(?:[^"\\]|\\.)*"|null)')
        if (-not $rx.IsMatch($text)) { throw "config.json in $Root has no string $n to set." }
        $value = ConvertTo-Json -InputObject ([string]$fields[$n]) -Compress
        $text = $rx.Replace($text, { param($m) $m.Groups[1].Value + $value }, 1)
    }
    [IO.File]::WriteAllText($cfgFile, $text, (New-Object System.Text.UTF8Encoding $false))
}
# The dev voice address from the main one (DevBuild.DevVoiceUrl).
function Get-DevVoiceUrl([string]$u) {
    $u = $u.Trim().TrimEnd('/')
    if (-not $u -or $u.EndsWith('-dev', [StringComparison]::OrdinalIgnoreCase)) { return $u }
    $u + '-dev'
}
$leftOn = Read-ChannelFields
$wasDev = $leftOn.Channel -eq 'dev' -or $leftOn.UpdateBranch -eq 'dev'
# The channel of the launcher Velopack has in place: the <channel> its
# current\sq.version names (Velo.ChannelFor reads the same when there is no
# config.json). Empty for a launcher Velopack did not install.
function Get-InstalledChannel {
    $sq = Join-Path (Split-Path $launcherExe) 'sq.version'
    if (-not (Test-Path -LiteralPath $sq)) { return '' }
    $m = [regex]::Match([IO.File]::ReadAllText($sq), '<channel>\s*([^<\s]+)\s*</channel>')
    if ($m.Success) { $m.Groups[1].Value } else { '' }
}
if (-not (Test-Path -LiteralPath (Join-Path $Root 'Profile\dev-allowed.txt'))) {
    throw "No Profile\dev-allowed.txt under $Root, so the test plugin would not run: the site has not named this install's Discord account a dev."
}

$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -in @('SkyrimSE', 'skse64_loader') -or
    ($_.ProcessName -eq 'Thornswood' -and $_.Path -and
     [string]::Equals($_.Path, $launcherExe, [StringComparison]::OrdinalIgnoreCase))
})
if ($running.Count -gt 0) {
    throw ('Already running, so this run would take over somebody''s session: ' + (($running | ForEach-Object { $_.ProcessName + ' ' + $_.Id }) -join ', '))
}

# The plugin the game runs is the build's own: the launcher keeps its
# build's Data\Platform files and puts them back before every Play, so a copy
# laid in by hand never reaches the game (26 Nov: the run's own copy was
# put back before Play, and the run took that for a failure of its steps).
# The steps are this checkout's, so the run says when the two differ.
if (-not (Test-Path -LiteralPath (Join-Path $platform 'Plugins\thornswood-test.js'))) {
    throw 'The game has no Data\Platform\Plugins\thornswood-test.js: the build in place predates it.'
}
function Get-PluginMismatch {
    $inGame = Join-Path $platform 'Plugins\thornswood-test.js'
    $ours = Join-Path $repoRoot 'game\plugins\thornswood-test.js'
    $a = (Get-FileHash -LiteralPath $inGame -Algorithm SHA256).Hash.ToLowerInvariant()
    $b = (Get-FileHash -LiteralPath $ours -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($a -eq $b) { return '' }
    $sq = Join-Path (Split-Path $launcherExe) 'sq.version'
    $ver = ''
    if (Test-Path -LiteralPath $sq) { $m = [regex]::Match([IO.File]::ReadAllText($sq), '<version>\s*([^<\s]+)\s*</version>'); if ($m.Success) { $ver = $m.Groups[1].Value } }
    'the game runs the thornswood-test.js of the build in place' + $(if ($ver) { " ($ver)" } else { '' }) + ', ' + $a.Substring(0, 12) +
        ', not this checkout''s, ' + $b.Substring(0, 12) + ': run from the commit of that build, so its steps are the ones its plugin knows'
}
$pluginOff = ''

# ---------------------------------------------------------------- Windows --
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('ThornswoodRealClient.Win' -as [type])) {
    # Under PowerShell 7 Bitmap is in System.Drawing.Common, which needs its own
    # references to compile against (System.Private.Windows.GdiPlus and more),
    # and Rectangle is in System.Drawing.Primitives. So the helper is compiled
    # against the assemblies those types are loaded from and what Bitmap's
    # assembly references, not by name (16 Nov: CS1069 on One, before Play).
    $drawing = [System.Drawing.Bitmap].Assembly
    $drawingRefs = @($drawing.Location, [System.Drawing.Rectangle].Assembly.Location) +
        @($drawing.GetReferencedAssemblies() | ForEach-Object { [Reflection.Assembly]::Load($_).Location }) |
        Select-Object -Unique
    Add-Type -ReferencedAssemblies $drawingRefs -TypeDefinition @'
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
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, System.Text.StringBuilder s, ref uint n);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    // Which window is in front, for a key step that could not get the game
    // window there: its process, its id and its title (26 Nov: Windows
    // refused the focus at step 20 and the run could not say what had it).
    public static string ForegroundWho() {
      IntPtr h = GetForegroundWindow();
      if (h == IntPtr.Zero) return "no window";
      uint pid; GetWindowThreadProcessId(h, out pid);
      System.Text.StringBuilder t = new System.Text.StringBuilder(256);
      GetWindowText(h, t, t.Capacity);
      // The process by its file, asked with the least access there is
      // (PROCESS_QUERY_LIMITED_INFORMATION), which an elevated one allows too.
      string name = "an unknown process";
      IntPtr p = OpenProcess(0x1000, false, pid);
      if (p != IntPtr.Zero) {
        System.Text.StringBuilder f = new System.Text.StringBuilder(1024);
        uint n = (uint)f.Capacity;
        if (QueryFullProcessImageName(p, 0, f, ref n)) { string full = f.ToString(); name = full.Substring(full.LastIndexOf('\\') + 1); }
        CloseHandle(p);
      }
      return name + " " + pid + " \"" + t.ToString() + "\"";
    }
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);

    // One transition per call. Invoke-GameKey holds the key between them so
    // the browser's current-state input reader can observe a down state.
    public static uint SendScan(ushort scan, bool up) {
      INPUT[] i = new INPUT[1];
      i[0].type = 1; i[0].u.ki.wScan = scan; i[0].u.ki.dwFlags = 0x0008;
      if (up) i[0].u.ki.dwFlags |= 0x0002;
      return SendInput(1, i, Marshal.SizeOf(typeof(INPUT)));
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
    # A living process may temporarily have no window. Keep it so a queued
    # key can fail with "no game window" instead of being called a crash.
    Get-Process -Name SkyrimSE -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Invoke-GameKey([IntPtr]$handle, $code) {
    # These plans use ordinary set-1 make codes. Extended/E1 keys require
    # another encoding; refuse them instead of silently sending another key.
    $scan = 0
    if (-not [int]::TryParse([string]$code, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$scan) -or
        $scan -lt 1 -or $scan -gt 0x7f) {
        return @{ ok = $false; note = "unsupported non-extended scan code $code" }
    }
    $code = [uint16]$scan
    if ($handle -eq [IntPtr]::Zero) { return @{ ok = $false; note = 'no game window' } }
    if ([ThornswoodRealClient.Win]::GetForegroundWindow() -ne $handle) {
        if (-not [ThornswoodRealClient.Win]::SetForegroundWindow($handle)) {
            return @{ ok = $false; note = 'Windows refused to give the game window the keyboard; in front: ' + [ThornswoodRealClient.Win]::ForegroundWho() }
        }
    }
    # Check before SendInput: acknowledging a key after noticing another
    # foreground window counted undelivered keys as passed steps.
    if ([ThornswoodRealClient.Win]::GetForegroundWindow() -ne $handle) {
        return @{ ok = $false; note = 'the game window does not have the keyboard; no input sent; in front: ' + [ThornswoodRealClient.Win]::ForegroundWho() }
    }
    $why = ''
    try {
        $down = [ThornswoodRealClient.Win]::SendScan($code, $false)
        if ($down -ne 1) { $why = "SendInput sent $down of 1 key-down events" }
        else {
            # A human-length tap, below key-repeat delay. The pinned engine's
            # DInputHook samples GetDeviceState for its CEF listener: down+up
            # in one SendInput can be gone before that snapshot, even though
            # native buffered menus saw it (b0b869cb, main.cpp MyInputListener).
            Start-Sleep -Milliseconds 120
            if ([ThornswoodRealClient.Win]::GetForegroundWindow() -ne $handle) {
                $why = 'the game window lost the keyboard during input; in front: ' + [ThornswoodRealClient.Win]::ForegroundWho()
            }
        }
    } catch { $why = 'the key press failed: ' + $_.Exception.Message }
    finally {
        # Release even if down, the hold, or the focus check failed. This is
        # cleanup, including after focus loss; no second key-down is tried.
        try {
            $up = [ThornswoodRealClient.Win]::SendScan($code, $true)
            if ($up -ne 1) { $why += "; SendInput sent $up of 1 key-up events" }
        } catch { $why += '; the key release failed: ' + $_.Exception.Message }
    }
    if ($why) { return @{ ok = $false; note = $why.TrimStart(';', ' ') } }
    if ([ThornswoodRealClient.Win]::GetForegroundWindow() -ne $handle) {
        return @{ ok = $false; note = 'the game window lost the keyboard during input' }
    }
    return @{ ok = $true; note = 'key-down, held 120 ms, key-up; game window focused' }
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
$script:launcherLogReadAt = $launcherLogStart

# What the launcher writes to launcher.log from where the run began: whole
# lines only, sharing the file as the launcher writes it, each line read once.
function Read-LauncherLines {
    if (-not (Test-Path -LiteralPath $launcherLog)) { return @() }
    $fs = [IO.File]::Open($launcherLog, 'Open', 'Read', 'ReadWrite, Delete')
    try {
        # The launcher starts the log afresh past its size limit.
        if ($fs.Length -lt $script:launcherLogReadAt) { $script:launcherLogReadAt = 0 }
        $have = $fs.Length - $script:launcherLogReadAt
        if ($have -le 0) { return @() }
        [void]$fs.Seek($script:launcherLogReadAt, 'Begin')
        $buf = New-Object byte[] $have
        $n = 0
        while ($n -lt $buf.Length) {
            $got = $fs.Read($buf, $n, $buf.Length - $n)
            if ($got -le 0) { break }
            $n += $got
        }
        if ($n -le 0) { return @() }
        $end = [Array]::LastIndexOf($buf, [byte]10, $n - 1)
        if ($end -lt 0) { return @() }
        $script:launcherLogReadAt += $end + 1
        return @([Text.Encoding]::UTF8.GetString($buf, 0, $end + 1) -split "`n" | ForEach-Object { $_.TrimEnd("`r") })
    } finally { $fs.Dispose() }
}
$launcherStamp = '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ  '

# The launcher's own word that Play went wrong. A Play that fails writes
# "Failed to start: <why>" to launcher.log and leaves the launcher open with
# no game, and the run waited the whole -Minutes for a game that was never
# coming, with the launcher sitting there (26 Nov, 10:59 AM: "Could not
# redirect ... Skyrim Special Edition"). A reason of several lines comes in
# one write, so its lines that carry no time stamp are its own.
function Read-LauncherFailure {
    $why = $null
    foreach ($l in @(Read-LauncherLines)) {
        if ($null -eq $why) {
            if ($l -match ($launcherStamp + 'Failed to start: (.*)$')) { $why = $Matches[1] }
        } elseif ($l -match $launcherStamp) { break }
        elseif ($l.Trim()) { $why += ' ' + $l.Trim() }
    }
    if ($null -eq $why) { return '' }
    return $why.Trim()
}

# Windows' two Skyrim folders, and whether either still points at this build.
function Get-StillRedirected {
    $docs = [Environment]::GetFolderPath('MyDocuments')
    @((Join-Path $docs 'My Games\Skyrim Special Edition'), (Join-Path $env:LOCALAPPDATA 'Skyrim Special Edition')) | Where-Object {
        $i = Get-Item -LiteralPath $_ -Force -ErrorAction SilentlyContinue
        $i -and ($i.Attributes -band [IO.FileAttributes]::ReparsePoint)
    }
}

$launcher = $null
$switched = $false
$result = 'unfinished'
$note = ''
try {
    if (-not $wasDev) {
        Set-RunChannel ([ordered]@{ Channel = 'dev'; UpdateBranch = 'dev'; ServerPort = '7787'; VoicePort = '7789'; VoiceUrl = (Get-DevVoiceUrl $leftOn.VoiceUrl) })
        $switched = $true
        Say "The install was on the $($leftOn.UpdateBranch) channel; put it on dev for the run, as the launcher's Server card does. It goes back when the run ends."
    }
    $launcher = Start-Process -FilePath $launcherExe -WorkingDirectory (Split-Path $launcherExe) -PassThru
    Say "Started the launcher, process $($launcher.Id)"

    # Play, through UI Automation, once the launcher lets it be pressed and
    # the launcher running is dev's: an update or the mod check may be holding
    # it, and an install just put on dev takes dev's package first. Taking an
    # update closes the launcher and Velopack starts the new one, so a launcher
    # that closes is followed to the one started after it.
    $ae = [System.Windows.Automation.AutomationElement]
    $cond = New-Object System.Windows.Automation.PropertyCondition ($ae::AutomationIdProperty, 'BtnPlay')
    $deadline = (Get-Date).AddMinutes($PlayMinutes)
    $pressed = $false
    $toldWaiting = $false
    $toldChannel = ''
    $launcherGoneSince = $null
    $sawPlay = ''
    # What the loop saw, said each time it changes: the window it looks in and
    # Play in it (26 Nov: launcher 1.3.125 was Ready with a clean scan, and
    # for 15 minutes Play was never pressable, with nothing to say whether
    # the window, the button or its enabled state was missing).
    function Get-PlayState($h, $btn) {
        if ($h -eq [IntPtr]::Zero) { return 'no main window' }
        $title = ''
        try { $title = $ae::FromHandle($h).Current.Name } catch { $title = '(unreadable)' }
        $w = 'window ' + $h + ' "' + $title + '"'
        if (-not $btn) { return $w + ', no BtnPlay in it' }
        $w + ', BtnPlay "' + $btn.Current.Name + '" ' + $(if ($btn.Current.IsEnabled) { 'enabled' } else { 'disabled' }) +
            $(if ($btn.Current.IsOffscreen) { ', off screen' } else { '' })
    }
    # The launcher's top-level windows, for when Play never came.
    function Get-LauncherWindows($procId) {
        $byProc = New-Object System.Windows.Automation.PropertyCondition ($ae::ProcessIdProperty, [int]$procId)
        @($ae::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $byProc) | ForEach-Object {
            '"' + $_.Current.Name + '" (' + $_.Current.ClassName + ', ' + $_.Current.NativeWindowHandle + ')'
        }) -join '; '
    }
    while (-not $pressed) {
        if ((Get-Date) -gt $deadline) {
            # A fresh read of the process, not a refresh of the one followed:
            # tests\test-real-client-restart-grace.ps1 runs this loop's start,
            # up to its first refresh, against doubles.
            $now = Get-Process -Id $launcher.Id -ErrorAction SilentlyContinue
            if ($now) {
                Say ('At the end, the launcher''s windows: ' + (Get-LauncherWindows $now.Id))
                if ($now.MainWindowHandle -ne [IntPtr]::Zero) {
                    $how = [ThornswoodRealClient.Win]::Shot($now.MainWindowHandle, (Join-Path $Out 'launcher-no-play.png'))
                    Say "shot launcher-no-play ($how)"
                }
            }
            $ch = Get-InstalledChannel
            if ($ch -and $ch -ne 'dev') { throw "The launcher was still $ch's after $PlayMinutes minutes, so it never took dev's package: is Settings, Updates, automatic updates off?" }
            throw "Play was not there to press in $PlayMinutes minutes"
        }
        if ($launcher.HasExited) {
            # A followed Get-Process object can have no exit metadata. Count
            # from our own observation instead of treating a null ExitTime
            # as an exit before the cutoff and restoring the channel mid-update.
            if ($null -eq $launcherGoneSince) { $launcherGoneSince = Get-Date }
            $next = Get-Process -Name Thornswood -ErrorAction SilentlyContinue | Where-Object {
                $_.Id -ne $launcher.Id -and $_.Path -and [string]::Equals($_.Path, $launcherExe, [StringComparison]::OrdinalIgnoreCase)
            } | Select-Object -First 1
            if ($next) { Say "The launcher closed (exit code $($launcher.ExitCode)) and Velopack started it again, process $($next.Id): following that one."; $launcher = $next; $launcherGoneSince = $null; $toldWaiting = $false; continue }
            if (((Get-Date) - $launcherGoneSince).TotalMinutes -ge 2) { throw "The launcher closed by itself, exit code $($launcher.ExitCode), and no launcher started after it in two minutes" }
            Start-Sleep -Milliseconds 500
            continue
        }
        $launcherGoneSince = $null
        $launcher.Refresh()
        $h = $launcher.MainWindowHandle
        $ch = Get-InstalledChannel
        if ($ch -and $ch -ne 'dev') {
            if ($toldChannel -ne $ch) { Say "The launcher in place is $ch's; waiting for it to take dev's package."; $toldChannel = $ch }
            Start-Sleep -Milliseconds 500
            continue
        }
        $btn = $null
        if ($h -ne [IntPtr]::Zero) {
            $win = $ae::FromHandle($h)
            $btn = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
        }
        $state = Get-PlayState $h $btn
        if ($state -ne $sawPlay) { Say ('Launcher ' + $launcher.Id + ': ' + $state); $sawPlay = $state }
        if ($h -ne [IntPtr]::Zero) {
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
    $script:resultsReadAt = 0
    $sawGame = $false
    $shots = 0
    while ($true) {
        if ((Get-Date) -gt $deadline) { $result = 'timeout'; $note = "no end in $Minutes minutes"; break }
        $proc = Get-GameProcess
        if (-not $proc -and -not $sawGame) {
            $failed = Read-LauncherFailure
            if ($failed) { throw "The launcher could not start the game: $failed" }
        }
        if ($proc) {
            if (-not $sawGame) {
                Say "The game is up, process $($proc.Id)"
                $pluginOff = Get-PluginMismatch
                if ($pluginOff) { Say ('Note: ' + $pluginOff + '.') }
            }
            $sawGame = $true
        }
        elseif ($sawGame) { $result = 'crashed'; $note = 'the game closed before the run ended'; break }

        $lines = @(Read-NewResultLines)
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
                    $reply = [ordered]@{ n = $o.n; ok = $true; note = '' }
                    if ($o.do -eq 'shot') {
                        $shots++
                        $name = ('{0:00}-{1}.png' -f $shots, ($o.arg -replace '[^\w\-]', '_'))
                        $how = if ($proc) { [ThornswoodRealClient.Win]::Shot($proc.MainWindowHandle, (Join-Path $Out $name)) } else { 'no game window' }
                        Say "shot $name ($how)"
                    } elseif ($o.do -eq 'key') {
                        $handle = if ($proc) { $proc.MainWindowHandle } else { [IntPtr]::Zero }
                        $delivery = Invoke-GameKey $handle $o.arg
                        $reply.ok = $delivery.ok
                        $reply.note = $delivery.note
                        Say "key $($o.arg): $($delivery.note) (ok=$($delivery.ok))"
                    } elseif ($o.do -eq 'end') { $ended = $true }
                    [IO.File]::WriteAllText($ackFile, ($reply | ConvertTo-Json -Compress))
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
    # The launcher points Windows' Skyrim folders at this build for the game
    # and puts them back when it sees the game close, or when its window is
    # closed. Ending both by force skipped that, and after every run the two
    # folders were left pointing into Profile with the person's own moved
    # aside, until the next launcher start cleaned up "a redirect left behind
    # by a crash" (26 Nov, 12:42 PM on One). So the steps go in order: the
    # game closes, the launcher says it has put the folders back, and then its
    # window is closed as a person closes it.
    $ours = @(Get-Process -Name Thornswood -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [string]::Equals($_.Path, $launcherExe, [StringComparison]::OrdinalIgnoreCase) })
    $proc = Get-Process -Name SkyrimSE -ErrorAction SilentlyContinue
    if ($proc) {
        $proc | Stop-Process -Force
        Say 'Closed the game.'
        if ($ours.Count) {
            # The launcher looks for the game every two seconds.
            $until = (Get-Date).AddSeconds(60)
            $back = $false
            while (-not $back -and (Get-Date) -lt $until) {
                foreach ($l in @(Read-LauncherLines)) { if ($l -match ($launcherStamp + 'Game closed after ')) { $back = $true } }
                if (-not $back) { Start-Sleep -Milliseconds 500 }
            }
            if ($back) { Say 'The launcher saw the game close and put the Skyrim folders back.' }
            else { Say 'The launcher did not say in 60 s that it saw the game close.' }
        }
    }
    foreach ($lp in $ours) {
        if ($lp.HasExited) { continue }
        [void]$lp.CloseMainWindow()
        if ($lp.WaitForExit(30000)) { Say "Closed the launcher, process $($lp.Id)." }
        else {
            # Its window did not close: a dialog or a wait in it. It is ended
            # rather than left open on somebody's PC, and the folders it held
            # are named below.
            $lp | Stop-Process -Force
            Say "The launcher, process $($lp.Id), did not close its window in 30 s, so it was ended."
        }
    }
    $left = @(Get-StillRedirected)
    if ($left.Count) {
        $leftNote = 'Windows'' Skyrim folders still point at this build after the run: ' + ($left -join '; ') + '. The next launcher start puts them back.'
        Say $leftNote
        $note = ($note + ' ' + $leftNote).Trim()
        if ($result -eq 'passed') { $result = 'failed' }
    }
    if (Test-Path -LiteralPath $runFile) { Remove-Item -LiteralPath $runFile -Force; Say 'The plugin never took the run file; removed it so the next Play does not run it.' }
    if ($switched) {
        Set-RunChannel $leftOn
        Say "Put the install back on the $($leftOn.UpdateBranch) channel it was left on; the launcher takes that channel's package at its next start."
    }
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

if ($pluginOff) { $note = ($note + ' (' + $pluginOff + ')').Trim() }
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
    # The run goes on a draft Release of its own. The build's Release cannot
    # take it: Releases here are immutable once published, and GitHub refused
    # the upload with 422 (16 Nov). A draft is never published, so it makes no
    # tag and only the team sees it, which suits screenshots of somebody's
    # game; every reader of Releases here leaves drafts out, as the content
    # builds' drafts rely on (#5191).
    $relTag = "real-client-$runId"
    $files = @($md, $zip) + @(Get-ChildItem -LiteralPath $Out -Filter '*.png' | ForEach-Object { $_.FullName })
    $relUrl = (gh release create $relTag @files --repo $Repo --draft --target $dep.sha --title "Real game run $runId on $tag" --notes-file $md | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or -not $relUrl) { throw "Could not put the run on a draft Release $relTag" }
    $relUrl = ([string]$relUrl).Trim()
    Say "The run is on the draft Release $relTag ($relUrl)."
    # The ten newest runs stay, as the content builds keep a few drafts: a
    # run is read while its build is the one being tried.
    $rels = @()
    for ($page = 1; $page -le 50; $page++) {
        $got = @(gh api "repos/$Repo/releases?per_page=100&page=$page" | ConvertFrom-Json | ForEach-Object { $_ })
        if ($LASTEXITCODE -ne 0) { throw "Could not list the Releases to find older runs" }
        $rels += $got
        if ($got.Count -lt 100) { break }
    }
    $old = @($rels |
        Where-Object { $_.draft -and ([string]$_.tag_name).StartsWith('real-client-') } |
        Sort-Object { [datetime]$_.created_at } -Descending | Select-Object -Skip 10)
    foreach ($r in $old) {
        gh api --method DELETE "repos/$Repo/releases/$($r.id)" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not take down the older run $($r.tag_name)" }
        Say "Took down the older run $($r.tag_name)."
    }
    $state = (gh api "repos/$Repo/deployments/$($dep.id)/statuses?per_page=1" | ConvertFrom-Json | Select-Object -First 1).state
    if (-not $state) { $state = 'success' }
    $desc = ("Real game run: $result. $note")
    if ($desc.Length -gt 140) { $desc = $desc.Substring(0, 137) + '...' }
    $body = @{ state = $state; description = $desc; log_url = $relUrl; auto_inactive = $false } | ConvertTo-Json -Compress
    $body | gh api --method POST "repos/$Repo/deployments/$($dep.id)/statuses" --input - | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not say the run on Deployment $($dep.id)" }
    Say "On Deployment $($dep.id) ($tag), its state left $state."
}

if ($result -ne 'passed') { exit 1 }
