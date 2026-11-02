<#
  test-2215-play-pressed-by.ps1

      pwsh -NoProfile -File .\launcher\tests\test-2215-play-pressed-by.ps1

  Issue #2215. The game has started again within three seconds of closing 17
  times since 20 September, and only the Play button reaches StartPlay from
  outside. Nothing recorded what pressed it, so this is the measurement: every
  press writes one line to launcher.log naming the input.

  WHAT IT CHECKS, in launcher\app\Shell.cs (text only):
    1. The Play button's Click handler logs PlayPressedBy() before anything else.
    2. PlayPressedBy names the mouse, the keyboard (with the last key down on
       the window) or no device, whether the window was active, and the seconds
       since the last game closed.
    3. The game's close sets gameClosedAt, and the window's handlers, seen on
       the way down before any control (RoutingStrategies.Tunnel), keep the
       last key and note whether the mouse or the keyboard was used last.
       Avalonia keeps no record of the last input device, so these handlers
       are what PlayPressedBy reads.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$shell = [IO.File]::ReadAllText((Join-Path $Repo 'launcher\app\Shell.cs'))

$click = [regex]::Match($shell, '(?s)btnPlay\.Click \+= delegate\s*\{(.*?)StartPlay\(\);').Groups[1].Value
Yes 'the Play button logs what pressed it before it does anything' (
    $click.Contains('LogOnly(PlayPressedBy());') -and
    $click.IndexOf('LogOnly(PlayPressedBy());') -lt $click.IndexOf('if (playing)'))

$at = $shell.IndexOf('static string PlayPressedBy()')
$fn = if ($at -ge 0) { $shell.Substring($at, [Math]::Min(2200, $shell.Length - $at)) } else { '' }
Yes 'PlayPressedBy is in Shell.cs' ($at -ge 0)
Yes 'it names the mouse, the keyboard with its last key, or no device' (
    $fn.Contains('lastInput == "mouse"') -and $fn.Contains('leftButtonDown') -and
    $fn.Contains('lastInput == "keyboard"') -and
    $fn.Contains('lastKeyDown') -and $fn.Contains('no input device'))
Yes 'it says whether the window was active and how long since the game closed' (
    $fn.Contains('win.IsActive') -and $fn.Contains('gameClosedAt'))
Yes 'the game''s close sets gameClosedAt' ($shell -match 'gameClosedAt = DateTime\.Now;\s*\r?\n\s*Log\("Game closed after')
$keyDown = [regex]::Match($shell, '(?s)win\.AddHandler\(InputElement\.KeyDownEvent, delegate \(object s, KeyEventArgs e\)\s*\{(.*?)\}, RoutingStrategies\.Tunnel, true\);')
Yes 'a window-level key handler, before any control, keeps the last key and notes the keyboard' (
    $keyDown.Success -and $keyDown.Groups[1].Value.Contains('lastKeyDown = e.Key;') -and
    $keyDown.Groups[1].Value.Contains('lastKeyDownAt = DateTime.Now;') -and
    $keyDown.Groups[1].Value.Contains('lastInput = "keyboard";'))
$press = [regex]::Match($shell, '(?s)win\.AddHandler\(InputElement\.PointerPressedEvent, delegate \(object s, PointerPressedEventArgs e\)\s*\{(.*?)\}, RoutingStrategies\.Tunnel, true\);')
Yes 'a window-level pointer handler, before any control, notes the mouse and its left button' (
    $press.Success -and $press.Groups[1].Value.Contains('PointerType.Mouse ? "mouse"') -and
    $press.Groups[1].Value.Contains('leftButtonDown = true;'))
$release = [regex]::Match($shell, '(?s)win\.AddHandler\(InputElement\.PointerReleasedEvent, delegate \(object s, PointerReleasedEventArgs e\)\s*\{(.*?)\}, RoutingStrategies\.Tunnel, true\);')
Yes 'the left button coming up is noted the same way' (
    $release.Success -and $release.Groups[1].Value.Contains('leftButtonDown = false;'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
