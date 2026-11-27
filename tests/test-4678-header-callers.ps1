<#
  test-4678-header-callers.ps1

      pwsh -NoProfile -File .\tests\test-4678-header-callers.ps1

  Issue #4678. StopAndMove.ps1's header left out Reset-Character.ps1 and
  Install-AdminService.ps1, which put its text in front of what they run on
  the box, and said Install-ThornswoodServer.ps1 loads it from beside itself,
  when the installer carries a copy of it. ServerSettings.ps1's header left
  out Deploy-DevGamemode.ps1, which dot-sources it for its load order check.
  A change to either file checked against its header alone missed them.

  This reads every tracked .ps1 outside the tests, finds each that takes
  StopAndMove.ps1 or ServerSettings.ps1 (or Swap.ps1's copy of StopAndMove's
  text), and holds:
    1. the header (above "WHY") names every one of them;
    2. each that dot-sources the file is named in the header's "dot-sourced"
       line, and each that reads its text in the "its text" line;
    3. StopAndMove.ps1's header names Install-ThornswoodServer.ps1 in its
       "a copy" line, and the installer does carry the copy.

  Read only. Needs nothing of Windows. A few seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$Ast = [System.Management.Automation.Language.Ast]
$CommandAst = [System.Management.Automation.Language.CommandAst]
$AssignAst = [System.Management.Automation.Language.AssignmentStatementAst]
$MemberAst = [System.Management.Automation.Language.InvokeMemberExpressionAst]
$StringAst = [System.Management.Automation.Language.StringConstantExpressionAst]
$VarAst = [System.Management.Automation.Language.VariableExpressionAst]

$files = @(git -C $Repo ls-files '*.ps1' | Where-Object { $_ -notmatch '(^|/)tests/' })
Yes ('there are scripts to read (' + $files.Count + ')') ($files.Count -gt 100)

# Each script's AST, once.
$parsed = @{}
foreach ($f in $files) {
    $errs = $null
    $parsed[$f] = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repo $f), [ref]$null, [ref]$errs)
}

# The text an expression stands for in that script: its own, or, for a bare
# variable, that of every value the script gives it.
function Means($ast, $expr, [string]$name) {
    $t = $expr.Extent.Text
    if ($t -match [regex]::Escape($name)) { return $true }
    if ($expr -is $VarAst) {
        $v = $expr.VariablePath.UserPath
        foreach ($a in $ast.FindAll({ param($n) $n -is $AssignAst }, $true)) {
            if ($a.Left -is $VarAst -and $a.Left.VariablePath.UserPath -eq $v -and $a.Right.Extent.Text -match [regex]::Escape($name)) { return $true }
        }
    }
    return $false
}

# Who takes <name>, in what way: 'dot' (dot-sourced), 'text' (read with
# ReadAllText), 'named' (any string in the code ending in it).
function Takers([string]$name, [string]$self) {
    $out = @{}
    foreach ($f in $files) {
        if ($f -eq $self) { continue }
        $ast = $parsed[$f]
        $ways = @()
        $strings = @($ast.FindAll({ param($n) $n -is $StringAst }, $true) | Where-Object { $_.Value -match ('(^|[\\/])' + [regex]::Escape($name) + '$') })
        if ($strings.Count) { $ways += 'named' }
        foreach ($c in $ast.FindAll({ param($n) $n -is $CommandAst -and $n.InvocationOperator -eq 'Dot' }, $true)) {
            if (Means $ast $c.CommandElements[0] $name) { $ways += 'dot'; break }
        }
        foreach ($m in $ast.FindAll({ param($n) $n -is $MemberAst -and $n.Member.Extent.Text -eq 'ReadAllText' }, $true)) {
            if ($m.Arguments.Count -and (Means $ast $m.Arguments[0] $name)) { $ways += 'text'; break }
        }
        if ($ways.Count) { $out[$f] = $ways }
    }
    return $out
}

function HeaderOf([string]$rel) {
    $text = [IO.File]::ReadAllText((Join-Path $Repo $rel)) -replace "`r`n", "`n"
    $end = $text.IndexOf("`n  WHY")
    if ($end -lt 0) { return '' }
    return $text.Substring(0, $end)
}
function Line([string]$header, [string]$start) {
    # The bullet that starts with $start, to the next bullet or the end.
    $m = [regex]::Match($header, '(?s)\n    - ' + [regex]::Escape($start) + '(.*?)(?=\n    - |\n  [^ ]|$)')
    if ($m.Success) { return $start + $m.Groups[1].Value } else { return '' }
}
function Names([string]$text, [string]$rel) {
    $leaf = [IO.Path]::GetFileName($rel)
    return [regex]::IsMatch($text, '(?<![A-Za-z0-9-])' + [regex]::Escape($leaf) + '(?![A-Za-z0-9])')
}

# ---- StopAndMove.ps1 --------------------------------------------------------
Write-Host ''
Write-Host 'StopAndMove.ps1:'
$sm = 'scripts/deploy/StopAndMove.ps1'
$head = HeaderOf $sm
Yes 'its header ends before WHY' ($head.Length -gt 0)
$takers = Takers 'StopAndMove.ps1' $sm
# Swap.ps1's $ThornswoodStopAndMoveText, put in front by those who load Swap.ps1.
$swapLoaders = Takers 'Swap.ps1' 'scripts/deploy/Swap.ps1'
foreach ($f in $swapLoaders.Keys) { if (-not $takers.ContainsKey($f)) { $takers[$f] = @('swap') } }
foreach ($f in $files) {
    if ($f -eq $sm -or $takers.ContainsKey($f)) { continue }
    if ([IO.File]::ReadAllText((Join-Path $Repo $f)).Contains('$ThornswoodStopAndMoveText')) { $takers[$f] = @('swap') }
}
$copyHolder = 'scripts/deploy/Install-ThornswoodServer.ps1'
$carries = [IO.File]::ReadAllText((Join-Path $Repo $copyHolder)).Contains('# ---- StopAndMove.ps1 (copy) ----')
Yes 'Install-ThornswoodServer.ps1 carries a copy of it' $carries
if ($carries) { $takers[$copyHolder] = @('copy') }
Yes ('scripts take it (' + (($takers.Keys | Sort-Object | ForEach-Object { [IO.Path]::GetFileName($_) }) -join ', ') + ')') ($takers.Count -ge 10)
$textLine = Line $head 'its text'
$dotLine = Line $head 'dot-sourced'
$copyLine = Line $head 'a copy'
Yes 'its header has an "its text", a "dot-sourced" and an "a copy" line' ($textLine -and $dotLine -and $copyLine)
foreach ($f in ($takers.Keys | Sort-Object)) {
    $w = $takers[$f]
    Yes ("1 the header names " + [IO.Path]::GetFileName($f) + ' (' + ($w -join ', ') + ')') (Names $head $f)
    if ($w -contains 'dot') { Yes ('2 ' + [IO.Path]::GetFileName($f) + ' is in the dot-sourced line') (Names $dotLine $f) }
    if ($w -contains 'text') { Yes ('2 ' + [IO.Path]::GetFileName($f) + ' is in the its text line') (Names $textLine $f) }
}
Yes '3 Install-ThornswoodServer.ps1 is in the a copy line, and not said to load it' (
    (Names $copyLine $copyHolder) -and $head -notmatch 'Install-ThornswoodServer(\.ps1)?\s+loads it')

# ---- ServerSettings.ps1 -----------------------------------------------------
Write-Host ''
Write-Host 'ServerSettings.ps1:'
$ss = 'scripts/deploy/ServerSettings.ps1'
$head = HeaderOf $ss
Yes 'its header ends before WHY' ($head.Length -gt 0)
$takers = Takers 'ServerSettings.ps1' $ss
Yes ('scripts take it (' + (($takers.Keys | Sort-Object | ForEach-Object { [IO.Path]::GetFileName($_) }) -join ', ') + ')') ($takers.Count -ge 5)
$textLine = Line $head 'its text'
$dotLine = Line $head 'dot-sourced'
Yes 'its header has a "dot-sourced" and an "its text" line' ($textLine -and $dotLine)
foreach ($f in ($takers.Keys | Sort-Object)) {
    $w = $takers[$f]
    Yes ("1 the header names " + [IO.Path]::GetFileName($f) + ' (' + ($w -join ', ') + ')') (Names $head $f)
    if ($w -contains 'dot') { Yes ('2 ' + [IO.Path]::GetFileName($f) + ' is in the dot-sourced line') (Names $dotLine $f) }
    if ($w -contains 'text') { Yes ('2 ' + [IO.Path]::GetFileName($f) + ' is in the its text line') (Names $textLine $f) }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
exit ([int]($script:fail -gt 0))
