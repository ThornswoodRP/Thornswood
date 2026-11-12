<#
  test-5946-display-mode.ps1

      pwsh -NoProfile -File .\tests\test-5946-display-mode.ps1

  #5946: the game ran in exclusive full screen while the launcher said
  borderless. SSE Display Tweaks ships its Fullscreen and Borderless lines
  commented out, and then takes the mode from Skyrim's own bFull Screen in
  SkyrimPrefs.ini, which is 1 on plenty of machines. Display.Mode read the
  commented lines as borderless, and nothing on Play made the two agree.

    1. Display.PinMode, on the ini as the collection ships it, writes
       Fullscreen=false and Borderless=true as live lines, and says so.
    2. Run again it writes nothing and says nothing.
    3. A person's own exclusive full screen (Fullscreen=true with Borderless
       still commented) stays exclusive full screen, with Borderless=false
       written out beside it.
    4. Windowed, already written out, is left alone.
    5. No Display Tweaks: nothing written, nothing said.
    6. Play calls Display.PinMode before the game starts, outside the Lock
       resolution check, and logs what it says.

  HOW. Compiles the shipped launcher\app\Display.cs with stand-ins for Paths
  and Swallow, with the .NET SDK the launcher builds with (Add-LauncherType,
  tests\Launcher-Csc.ps1), and runs it against a pretend game folder in a
  temp folder Get-ScratchDir.ps1 names. Reads ShellPlay.cs as text. Changes
  nothing outside that folder. Runs everywhere.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'launcher\app'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# ------------------------------------------------------------------ compile
$cs = [IO.File]::ReadAllText((Join-Path $app 'Display.cs'))
$cs = $cs -replace 'namespace Thornswood\b', 'namespace Thornswood5946'
$stubs = @'
namespace Thornswood5946
{
    static class Paths { public static string Game = ""; public static string LiveMyGames = ""; }
    static class Swallow { public static void Note(string where, System.Exception e) { } }
    public static class Api
    {
        public static void SetGame(string game) { Paths.Game = game; Paths.LiveMyGames = game; }
        public static string Ini() { return Display.IniPath; }
        public static string Pin() { return Display.PinMode(); }
        public static string Mode() { return Display.Mode; }
    }
}
'@
$compiled = $false
try { $null = Add-LauncherType -Source $cs, $stubs; $compiled = $true }
catch { Write-Host ('      ' + $_.Exception.Message) }
Yes "Display.cs compiles with the .NET SDK the launcher builds with, C# $LauncherLangVersion" $compiled
if (-not $compiled) { Write-Host ""; Write-Host "$($script:pass) passed, $($script:fail) failed"; exit 1 }
$Api = [Thornswood5946.Api]

# The [Render] mode lines as the collection's SSEDisplayTweaks.ini has them.
$shipped = @'
[Render]

## Select the display mode.
#
#  Note: This option overrides 'bFull Screen' in SkyrimPrefs.ini if uncommented.
#
#Fullscreen=false

## Select windowed or borderless fullscreen mode. Only applies when Fullscreen=false.
#
#  Note: This option overrides 'bBorderless' in SkyrimPrefs.ini if uncommented.
#
#Borderless=true

Resolution=3440x1440
'@

function Live([string]$text, [string]$key) {
    $m = [regex]::Matches($text, '(?m)^\s*' + $key + '\s*=\s*(\S+)\s*$')
    if ($m.Count -ne 1) { return "($($m.Count) live lines)" }
    $m[0].Groups[1].Value
}

$tmp = & (Join-Path $root 'scripts\release\Get-ScratchDir.ps1') ('test-5946-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    $Api::SetGame($tmp)
    # Display.IniPath joins Windows separators; the file is written at
    # exactly that path, so the same check runs on Linux.
    $ini = $Api::Ini()
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($ini)) | Out-Null

    # 5. No Display Tweaks.
    Yes "5. with no SSEDisplayTweaks.ini, PinMode says nothing" ($null -eq $Api::Pin())
    Yes "5. and writes no ini" (-not [IO.File]::Exists($ini))

    # 1. The shipped ini.
    [IO.File]::WriteAllText($ini, $shipped)
    Yes "1. the shipped ini reads as borderless" ($Api::Mode() -eq 'Borderless')
    $said = $Api::Pin()
    $after = [IO.File]::ReadAllText($ini)
    Yes "1. PinMode says what it wrote: $said" ($null -ne $said -and $said.Contains('borderless'))
    Yes "1. Fullscreen=false is a live line" ((Live $after 'Fullscreen') -eq 'false')
    Yes "1. Borderless=true is a live line" ((Live $after 'Borderless') -eq 'true')
    # [ \t], not \s: \s also takes a line break, so "#" alone on the line
    # above a live Fullscreen=false read as a commented copy.
    Yes "1. no commented copy of either is left to read as a second setting" (-not ($after -match '(?m)^[ \t]*#[ \t]*(Fullscreen|Borderless)[ \t]*='))
    Yes "1. the resolution is untouched" ((Live $after 'Resolution') -eq '3440x1440')
    Yes "1. Mode is still borderless" ($Api::Mode() -eq 'Borderless')

    # 2. Again.
    $stamp = [IO.File]::GetLastWriteTimeUtc($ini)
    Start-Sleep -Milliseconds 50
    Yes "2. a second PinMode says nothing" ($null -eq $Api::Pin())
    Yes "2. and leaves the file as it was" ([IO.File]::ReadAllText($ini) -eq $after -and [IO.File]::GetLastWriteTimeUtc($ini) -eq $stamp)

    # 3. Exclusive full screen chosen on the Display page, Borderless still commented.
    [IO.File]::WriteAllText($ini, ($shipped -replace '#Fullscreen=false', 'Fullscreen=true'))
    Yes "3. Fullscreen=true reads as Fullscreen" ($Api::Mode() -eq 'Fullscreen')
    $said = $Api::Pin()
    $after = [IO.File]::ReadAllText($ini)
    Yes "3. PinMode names exclusive full screen: $said" ($null -ne $said -and $said.Contains('exclusive full screen'))
    Yes "3. Fullscreen stays true" ((Live $after 'Fullscreen') -eq 'true')
    Yes "3. Borderless=false is written beside it" ((Live $after 'Borderless') -eq 'false')
    Yes "3. Mode is still Fullscreen" ($Api::Mode() -eq 'Fullscreen')

    # 4. Windowed, written out.
    $windowed = ($shipped -replace '#Fullscreen=false', 'Fullscreen=false') -replace '#Borderless=true', 'Borderless=false'
    [IO.File]::WriteAllText($ini, $windowed)
    Yes "4. windowed, already written out, PinMode says nothing" ($null -eq $Api::Pin())
    Yes "4. and the file is unchanged" ([IO.File]::ReadAllText($ini) -eq $windowed)
}
finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }

# ------------------------------------------------------------------ 6. Play
$play = [IO.File]::ReadAllText((Join-Path $app 'ShellPlay.cs'))
$pin = $play.IndexOf('Display.PinMode()')
$start = $play.IndexOf('Process.Start(psi)')
$lock = $play.IndexOf('if (!cfg.LockResolution)')
Yes "6. Play calls Display.PinMode once" ($pin -ge 0 -and $play.IndexOf('Display.PinMode()', $pin + 1) -lt 0)
Yes "6. before the game starts" ($pin -ge 0 -and $start -gt $pin)
# The Lock resolution block is the braces after its if; PinMode comes after they close.
$close = -1
if ($lock -ge 0) {
    $open = $play.IndexOf('{', $lock); $depth = 0
    for ($i = $open; $i -lt $play.Length; $i++) {
        if ($play[$i] -eq '{') { $depth++ }
        elseif ($play[$i] -eq '}') { $depth--; if ($depth -eq 0) { $close = $i; break } }
    }
}
Yes "6. outside the Lock resolution check, so a locked resolution still gets the mode" ($close -ge 0 -and $pin -gt $close)
Yes "6. what it says goes in the log" ($play -match 'string pinned = Display\.PinMode\(\);\s*if \(pinned != null\) Log\(pinned\);')

Write-Host ""
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }
