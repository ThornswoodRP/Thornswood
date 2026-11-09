<#
  test-4327-music-slider-keys.ps1

      pwsh -NoProfile -File tests\test-4327-music-slider-keys.ps1

  Issue 4327. Tab never reached the launcher's music volume slider and the
  arrow keys could not move it, so only a mouse could set the volume. The
  slider's theme (ThornSlider in launcher\app\MainWindow.axaml) set Focusable
  to False on the slider itself, so keyboard navigation passed it by and no
  key ever reached it, and its template had nothing to show focus with.

  This reads the markup: the theme leaves the slider focusable, keeps the
  thumb and the track's halves out of the Tab order so the slider is one
  stop, and carries the buttons' focus ring (Primary and Solid): the same
  dashed edge, hidden until :focus-visible. The keyboard itself is driven on
  the real window by launcher\tests\test-window-starts.ps1.

  Read only. -Xaml <file> reads another copy of the markup.
#>
param([string]$Xaml)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Xaml) { $Xaml = Join-Path $repo (Join-Path 'launcher' (Join-Path 'app' 'MainWindow.axaml')) }
$src = [IO.File]::ReadAllText($Xaml).Replace("`r", '')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}

# One control theme's text, by its key.
function Theme([string]$key) {
    $a = $src.IndexOf('<ControlTheme x:Key="' + $key + '"')
    if ($a -lt 0) { return $null }
    $b = $src.IndexOf('</ControlTheme>', $a)
    if ($b -lt 0) { return $null }
    return $src.Substring($a, $b - $a)
}
# The theme's own setters, outside its template.
function OwnSetters([string]$t) {
    $at = $t.IndexOf('<Setter Property="Template">')
    if ($at -lt 0) { return $t }
    $end = $t.IndexOf('</Setter>', $t.IndexOf('</ControlTemplate>', $at))
    if ($end -lt 0) { return $t.Substring(0, $at) }
    return $t.Substring(0, $at) + $t.Substring($end)
}
# The attributes of the element named ring in a theme's template.
function Ring([string]$t) {
    if (-not $t) { return $null }
    $m = [regex]::Match($t, '<Rectangle\s+Name="ring"([^>]*)/>')
    if (-not $m.Success) { return $null }
    $out = @{}
    foreach ($a in [regex]::Matches($m.Groups[1].Value, '([\w.]+)="([^"]*)"')) { $out[$a.Groups[1].Value] = $a.Groups[2].Value }
    return $out
}

$slider = Theme 'ThornSlider'
Yes 'MainWindow.axaml has the ThornSlider theme' ($null -ne $slider)
if ($null -ne $slider) {
    $own = OwnSetters $slider
    Yes 'the theme leaves the slider focusable (no Focusable False setter)' ($own -notmatch '<Setter\s+Property="Focusable"\s+Value="False"\s*/>')
    Yes 'the theme keeps the slider a Tab stop (no IsTabStop False setter)' ($own -notmatch '<Setter\s+Property="(KeyboardNavigation\.)?IsTabStop"\s+Value="False"\s*/>')
    Yes 'the thumb stays out of the Tab order, so the slider is one stop' ($slider -match '<Thumb\b[^>]*Focusable="False"')
    Yes 'so do both halves of the track' ($slider -match 'Name="PART_DecreaseButton"\s+Focusable="False"' -and $slider -match 'Name="PART_IncreaseButton"\s+Focusable="False"')

    $r = Ring $slider
    Yes "the slider's template has a focus ring" ($null -ne $r)
    Yes 'the ring is hidden until focus shows it, and takes no clicks' ($null -ne $r -and $r['IsVisible'] -eq 'False' -and $r['IsHitTestVisible'] -eq 'False')
    Yes 'keyboard focus shows it (:focus-visible)' ($slider.Contains('<Style Selector="^:focus-visible /template/ Rectangle#ring"><Setter Property="IsVisible" Value="True"/></Style>'))
    Yes 'the ring is drawn in a colour of the theme, not a literal one' ($null -ne $r -and [string]$r['Stroke'] -match '^\{DynamicResource \w+\}$')

    foreach ($key in 'Primary', 'Solid') {
        $b = Ring (Theme $key)
        Yes "the $key button has the ring it is matched to" ($null -ne $b)
        $same = $null -ne $r -and $null -ne $b
        if ($same) { foreach ($p in 'RadiusX', 'RadiusY', 'StrokeThickness', 'StrokeDashArray') { if ($r[$p] -ne $b[$p]) { $same = $false } } }
        Yes "the slider's ring is the $key button's: corners, line and dashes" $same
    }
}

$m = [regex]::Match($src, '<Slider\s+x:Name="SldMusic"([^>]*)/>')
Yes 'the Settings page has the music slider' $m.Success
$attrs = if ($m.Success) { $m.Groups[1].Value } else { '' }
Yes 'it wears ThornSlider' ($m.Success -and $attrs -match 'Theme="\{StaticResource ThornSlider\}"')
Yes 'and turns neither focus nor its Tab stop off itself' ($m.Success -and $attrs -notmatch 'Focusable="False"' -and $attrs -notmatch 'IsTabStop="False"')
Yes 'its arrow keys move it by its ticks (TickFrequency with snapping)' ($m.Success -and $attrs -match 'TickFrequency="\d+"' -and $attrs -match 'IsSnapToTickEnabled="True"')

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
exit $(if ($script:fail) { 1 } else { 0 })
