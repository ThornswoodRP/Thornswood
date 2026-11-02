<#
  test-server-pick-order.ps1

      pwsh -NoProfile -File .\launcher\tests\test-server-pick-order.ps1

  The server dropdown opens over its own chip, so its first row is where the
  chip was. That row is the server the install is on: Dev on a dev install,
  Main on a main one. Until 11 Oct the rows kept the XAML order, Main then Dev,
  and a dev install opened onto Main (Patrick, 11 Oct).

  WHAT IT CHECKS, in launcher\app\Shell.cs and the window,
  launcher\app\MainWindow.axaml (text only):
    1. Both rows sit in one panel in the XAML, so one can be moved above the other.
    2. DrawServerPick puts the current server's row at index 0 of that panel,
       chosen by cfg.IsDev, and gives the 2 px gap to whichever row is first.
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

$xaml = [IO.File]::ReadAllText((Join-Path $Repo 'launcher\app\MainWindow.axaml'))
$shell = [IO.File]::ReadAllText((Join-Path $Repo 'launcher\app\Shell.cs'))

$panel = [regex]::Match($xaml, '(?s)<Border x:Name="ServerPickPanel".*?</Border>\s*</Popup>').Value
$inner = [regex]::Match($panel, '(?s)<StackPanel>(.*)</StackPanel>').Groups[1].Value
Yes 'both server rows sit in the one panel of the dropdown' (
    $inner.Contains('x:Name="BtnServerMain"') -and $inner.Contains('x:Name="BtnServerDev"'))

$at = $shell.IndexOf('static void DrawServerPick()')
$end = $shell.IndexOf('static void PaintServerChip()', $at)
$draw = if ($at -ge 0 -and $end -gt $at) { $shell.Substring($at, $end - $at) } else { '' }
Yes 'DrawServerPick is in Shell.cs' ($draw.Length -gt 0)
Yes 'the current server''s row is chosen by cfg.IsDev' (
    $draw.Contains('Button first = cfg.IsDev ? btnServerDev : btnServerMain;') -and
    $draw.Contains('Button second = cfg.IsDev ? btnServerMain : btnServerDev;'))
Yes 'and moved to the top of the panel' (
    $draw.Contains('rows.Children.Remove(first);') -and $draw.Contains('rows.Children.Insert(0, first);'))
Yes 'the gap goes under whichever row is first' (
    $draw.Contains('first.Margin = new Thickness(0, 0, 0, 2);') -and $draw.Contains('second.Margin = new Thickness(0);'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
