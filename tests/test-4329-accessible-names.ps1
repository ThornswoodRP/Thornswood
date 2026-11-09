<#
  test-4329-accessible-names.ps1

      pwsh -NoProfile -File tests\test-4329-accessible-names.ps1

  Issue 4329. A screen reader could not say what the launcher's controls are.
  Nothing in the launcher set AutomationProperties.Name, so each control was
  named from what it shows: the window's three buttons were read as "en
  dash", "ballot box" and "multiplication x", the text boxes and the music
  slider had no name at all, the side menu's buttons hold an icon and a word
  rather than text, and every button that acts on one item of a list (Install
  on an add-on, Delete on a picture, a theme) said only its verb.

  This reads the launcher's window and the C# that builds its rows, and fails
  on any control a person can reach that has neither visible words of its
  own nor a name:

    A. MainWindow.axaml, outside its resources: every Button, CheckBox,
       HyperlinkButton, RepeatButton, ToggleButton or RadioButton needs
       Content with words in it or AutomationProperties.Name; every TextBox,
       Slider or ComboBox needs AutomationProperties.Name.
    B. launcher\app\*.cs: every one of those built in code needs words of its
       own or AutomationProperties.SetName; a button whose click acts on one
       item (its handler is handed one of the member's own locals) needs a
       SetName built from the item, not a fixed string; a text box, slider
       or list needs SetName.

  The setup window (InstallWindow.cs) is #4693's and is not read here.

  Read only. -App <folder> reads another copy of launcher\app.
#>
param([string]$App)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $App) { $App = Join-Path $repo (Join-Path 'launcher' 'app') }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function Read([string]$p) { return [IO.File]::ReadAllText($p).Replace("`r", '') }
function Words([string]$s) {
    # Two letters or more, after the markup's character references are read,
    # so a glyph such as &#x2013; is not words.
    $t = [regex]::Replace($s, '&#x([0-9a-fA-F]+);', { param($m) [string][char][Convert]::ToInt32($m.Groups[1].Value, 16) })
    return ([regex]::Matches($t, '[A-Za-z]')).Count -ge 2
}

# ------------------------------------------------------------------ A. the window
$xamlPath = Join-Path $App 'MainWindow.axaml'
$xaml = Read $xamlPath
$end = $xaml.IndexOf('</Window.Resources>')
Yes 'MainWindow.axaml has its resources, and the window after them' ($end -gt 0)
$body = if ($end -gt 0) { $xaml.Substring($end) } else { $xaml }

$pressed = 'Button|CheckBox|HyperlinkButton|RepeatButton|ToggleButton|RadioButton'
$typed = 'TextBox|Slider|ComboBox'
$seen = 0
$bad = New-Object System.Collections.Generic.List[string]
foreach ($m in [regex]::Matches($body, "<($pressed|$typed)\b([^>]*?)/?>")) {
    $kind = $m.Groups[1].Value
    $attrs = $m.Groups[2].Value
    if ($attrs -match 'Focusable="False"') { continue }   # nobody can reach it
    $seen++
    $id = [regex]::Match($attrs, 'x:Name="([^"]+)"').Groups[1].Value
    if (-not $id) { $id = '(unnamed, line ' + ($xaml.Substring(0, $end + $m.Index).Split("`n").Count) + ')' }
    $name = [regex]::Match($attrs, 'AutomationProperties\.Name="([^"]*)"')
    if ($name.Success -and (Words $name.Groups[1].Value)) { continue }
    if ($attrs -match 'AutomationProperties\.LabeledBy=') { continue }
    $content = [regex]::Match($attrs, '\bContent="([^"]*)"')
    if ($kind -match "^($pressed)$" -and $content.Success -and (Words $content.Groups[1].Value)) { continue }
    $why = if ($kind -match "^($typed)$") { 'no name' } elseif ($content.Success) { 'its only content is "' + $content.Groups[1].Value + '", no words' } else { 'its content is not text, and no name' }
    $bad.Add("$kind $id ($why)")
}
Yes "the window has controls to read ($seen)" ($seen -gt 20)
Yes ('every control in the window has words of its own or a name' + $(if ($bad.Count) { ': ' + ($bad -join '; ') } else { '' })) ($bad.Count -eq 0)

# ------------------------------------------------------------------ B. built in code
$made = 'Button|CheckBox|HyperlinkButton|RepeatButton|ToggleButton|RadioButton|TextBox|Slider|ComboBox'
$files = @(Get-ChildItem -LiteralPath $App -Filter '*.cs' | Where-Object { $_.Name -ne 'InstallWindow.cs' } | Sort-Object Name)
$builtSeen = 0
$builtBad = New-Object System.Collections.Generic.List[string]
$items = 0
foreach ($f in $files) {
    $src = Read $f.FullName
    foreach ($m in [regex]::Matches($src, "(?<![\w.])(\w+)\s*=\s*new ($made)\(\)\s*;")) {
        $v = $m.Groups[1].Value
        $kind = $m.Groups[2].Value
        $builtSeen++
        # The member it is built in: from the last member head at the class's
        # indent before it, to the next one, or the file's ends.
        $from = $m.Index
        $heads = [regex]::Matches($src.Substring(0, $from), '\n        (?:static|public|private|internal|protected)\b')
        $start = if ($heads.Count) { $heads[$heads.Count - 1].Index } else { 0 }
        $next = [regex]::Match($src.Substring($from), '\n        (?:static|public|private|internal|protected)\b')
        $scope = if ($next.Success) { $src.Substring($start, $from - $start + $next.Index) } else { $src.Substring($start) }
        $ev = [regex]::Escape($v)
        $where = $f.Name + ':' + ($src.Substring(0, $from).Split("`n").Count) + ' ' + $kind + ' ' + $v

        $set = [regex]::Match($scope, "AutomationProperties\.SetName\(\s*$ev\s*,\s*(.+?)\);\s*\n")
        $setExpr = if ($set.Success) { $set.Groups[1].Value } else { '' }
        $setFromItem = $set.Success -and ([regex]::Replace($setExpr, '"(?:[^"\\]|\\.)*"', '') -match '[A-Za-z_]')

        # Acts on one item: its click hands a call one of the member's own
        # locals or parameters (a pack, a picture's name, a theme, a page),
        # not only the launcher's settings or window.
        $locals = New-Object System.Collections.Generic.HashSet[string]
        foreach ($d in [regex]::Matches($scope, '(?m)^\s*(?:var|string|int|bool|long|double|[A-Z][\w.<>\[\]]*)\s+(\w+)\s*=')) { [void]$locals.Add($d.Groups[1].Value) }
        $sig = [regex]::Match($scope, '^\s*\n?\s*[^\n(]*\(([^)]*)\)')
        if ($sig.Success) { foreach ($p in ($sig.Groups[1].Value -split ',')) { $w = ($p.Trim() -split '\s+'); if ($w.Count -ge 2) { [void]$locals.Add($w[$w.Count - 1]) } } }
        [void]$locals.Remove($v)
        $click = [regex]::Match($scope, "$ev\.Click \+= delegate\s*\{([\s\S]*?)\};")
        $item = $false
        if ($click.Success) {
            foreach ($call in [regex]::Matches($click.Groups[1].Value, '\w+\(([^()]*)\)')) {
                $args = [regex]::Replace($call.Groups[1].Value, '"(?:[^"\\]|\\.)*"', '')
                foreach ($a in [regex]::Matches($args, '(?<![\w.])([A-Za-z_]\w*)')) { if ($locals.Contains($a.Groups[1].Value)) { $item = $true; break } }
                if ($item) { break }
            }
        }

        $content = [regex]::Match($scope, "$ev\.Content = (.+?);\s*\n")
        $words = $false
        if ($content.Success) {
            $c = $content.Groups[1].Value.Trim()
            if ($c -match '^"(.*)"$') { $words = Words $Matches[1] }
            elseif ($c -match '^\w+$' -and $src -match ("(?<![\w.])" + [regex]::Escape($c) + '\s*=\s*new (StackPanel|Grid|Border|Image|Panel|WrapPanel|DockPanel)\(')) { $words = $false }
            else { $words = $true }   # a string worked out at run time
        }

        if ($kind -match '^(TextBox|Slider|ComboBox)$') {
            if (-not $set.Success) { $builtBad.Add("$where (no name)") }
            continue
        }
        if ($item) {
            $items++
            if (-not $setFromItem) {
                $builtBad.Add("$where (acts on one item; " + $(if ($set.Success) { 'its name is a fixed string, ' + $setExpr } else { 'no name says which' }) + ')')
            }
            continue
        }
        if (-not $set.Success -and -not $words) { $builtBad.Add("$where (no words of its own, and no name)") }
    }
}
Yes "the C# that builds rows has controls to read ($builtSeen, $items of them act on one item)" ($builtSeen -gt 10 -and $items -gt 5)
Yes ('every control built in code has words or a name, and every one that acts on an item is named by it' + $(if ($builtBad.Count) { ': ' + ($builtBad -join '; ') } else { '' })) ($builtBad.Count -eq 0)

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
exit $(if ($script:fail) { 1 } else { 0 })
