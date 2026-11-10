<#
  test-4364-site-comment-paths.ps1

      pwsh -NoProfile -File .\tests\test-4364-site-comment-paths.ps1

  Issue #4364. Comments in the site named files that had moved: harnesses
  that were under the old tools folder and are in tests\ or site\tests\ now,
  and the launcher's header, which is in launcher\. Others said a list or a
  setting lives in server.js after the site was split into site\lib\, so a
  reader went to a file that does not hold it. Nothing read the paths a
  comment names, so a move left them behind.

  This reads every comment in the site's code (site\, its tests too) and
  fails on:
    1. a repository path in a comment that is not a file in this checkout.
       A path counts when it starts with a folder at the top of the
       repository (tests\, launcher\, the old tools folder and so on) and
       ends in a file name with an extension. It may also be read from
       site\, so tests\x.js in a site harness may mean site\tests\x.js. In
       site\tests only a path under the old tools folder counts, because a
       harness's comments name the files it proves are gone;
    2. a NAME said to be in a file ("BLURB in server.js", "server.js
       (CSP_HEADER)") when that file does not declare it and another file of
       the site does. A NAME no file of the site declares is a word, not a
       constant, and is left alone. The site's harnesses are left out of
       this one: they read the whole site as server.js on purpose.
  Both readers are then run over planted text first, so a reader that finds
  nothing cannot pass by accident.

  Read only.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$Site = Join-Path $Repo 'site'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# ---- what a comment is ------------------------------------------------------
# The comments of one file, each as { Line, Text }. A run of // lines is one
# comment. Continuation marks (// and a leading *) are taken out and the lines
# joined, so a name wrapped onto the next line ("(BLURB" then "// in
# server.js") reads as one phrase.
function Get-Comments([string]$text, [string]$ext) {
    $rx = switch ($ext) {
        '.html' { '<!--[\s\S]*?-->' }
        '.css'  { '/\*[\s\S]*?\*/' }
        '.ps1'  { '<#[\s\S]*?#>|(?m)#[^\r\n]*(?:\r?\n[ \t]*#[^\r\n]*)*' }
        default { '/\*[\s\S]*?\*/|(?m)//[^\r\n]*(?:\r?\n[ \t]*//[^\r\n]*)*' }
    }
    $out = @()
    foreach ($m in [regex]::Matches($text, $rx)) {
        $line = 1 + ([regex]::Matches($text.Substring(0, $m.Index), "`n")).Count
        $joined = [regex]::Replace($m.Value, '\s*\r?\n\s*(?://+|#|\*(?!/))?\s*', ' ')
        $out += [pscustomobject]@{ Line = $line; Text = $joined }
    }
    return $out
}

# ---- 1. repository paths ----------------------------------------------------
$top = @(Get-ChildItem -LiteralPath $Repo -Directory -Force |
    Where-Object { $_.Name -ne '.git' } | ForEach-Object { [regex]::Escape($_.Name) })
# Not after a letter, a dot, a slash or a colon, so C:\Thornswood-Docs\site\x
# and https://host/site/x are not read as this repository's site\x.
$pathRx = [regex]('(?<![\w.\\/:-])((?:' + ($top -join '|') + ')[\\/][\w.\\/-]*\.[A-Za-z0-9]+)')
function Find-Path([string]$p) {
    $rel = $p -replace '[\\/]+', [IO.Path]::DirectorySeparatorChar
    foreach ($root in @($Repo, $Site)) {
        if (Test-Path -LiteralPath (Join-Path $root $rel) -PathType Leaf) { return $true }
    }
    return $false
}
function Get-StalePaths([string]$comment) {
    $bad = @()
    foreach ($m in $pathRx.Matches($comment)) {
        if (-not (Find-Path $m.Groups[1].Value)) { $bad += $m.Groups[1].Value }
    }
    return $bad
}

# Planted first. The old folder's name is built, so this file's own text is
# not a path into it.
$T = 'to' + 'ols'
$planted = "see $T\test-site-render.js and $T/launcher-header.mp4, and tests\test-site-local.js"
$found = @(Get-StalePaths $planted)
Yes ('a path under the old ' + $T + ' folder is caught, one that is there is not (' + ($found -join ', ') + ')') (
    $found.Count -eq 2 -and $found[0] -like '*test-site-render.js' -and $found[1] -like '*launcher-header.mp4')
Yes 'a box path or an address is not read as a path here' (
    @(Get-StalePaths 'C:\Thornswood-Docs\site\gone.js and https://thornswood.net/site/gone.js').Count -eq 0)

$exts = @('.js', '.mjs', '.html', '.css', '.ps1')
$files = @(Get-ChildItem -LiteralPath $Site -Recurse -File | Where-Object { $exts -contains $_.Extension })
$comments = @{}
$stale = @()
$named = 0
foreach ($f in $files) {
    $rel = $f.FullName.Substring($Repo.Length + 1) -replace '\\', '/'
    $list = @(Get-Comments ([IO.File]::ReadAllText($f.FullName)) $f.Extension)
    $comments[$rel] = $list
    # A harness's comments name the files it proves are gone (site/data/
    # board.json, since #4359), so in site/tests only a path under the old
    # folder counts. Everywhere else in the site, any path does.
    $harness = $rel -like 'site/tests/*'
    foreach ($c in $list) {
        $named += $pathRx.Matches($c.Text).Count
        foreach ($p in (Get-StalePaths $c.Text)) {
            if ($harness -and $p -notmatch ('^' + $T + '[\\/]')) { continue }
            $stale += ('{0}:{1}  {2}' -f $rel, $c.Line, $p)
        }
    }
}
foreach ($s in $stale) { Write-Host "      names a file that is not there: $s" }
Yes ("every path a comment in site names is a file here ($($files.Count) files, $named paths)") (
    $stale.Count -eq 0 -and $files.Count -gt 50 -and $named -gt 20)

# ---- 2. NAME in file --------------------------------------------------------
$nameIn = [regex]'\b([A-Z][A-Z0-9_]{2,})\s+in\s+([\w.\\/-]+\.js)\b'
$fileName = [regex]'(?<![\w.\\/-])([\w.\\/-]+\.js)\s+\(([A-Z][A-Z0-9_]{2,})\)'
$sources = @($files | Where-Object { $_.Extension -eq '.js' -and $_.FullName -notlike ('*' + [IO.Path]::DirectorySeparatorChar + 'tests' + [IO.Path]::DirectorySeparatorChar + '*') })
$text = @{}
foreach ($f in $sources) { $text[$f.FullName] = [IO.File]::ReadAllText($f.FullName) }
function Test-Declares([string]$src, [string]$name) {
    return [regex]::IsMatch($src, '\b(?:const|let|var|function|class)\s+' + [regex]::Escape($name) + '\b')
}
# Where NAME is declared, and whether the file the comment names is one of
# them. $null when no file of the site declares NAME, or when the file named
# is not one of the site's (gamemode.js).
function Get-Misplaced([string]$name, [string]$file) {
    $homes = @($sources | Where-Object { Test-Declares $text[$_.FullName] $name })
    if (-not $homes.Count) { return $null }
    $leaf = Split-Path -Leaf ($file -replace '\\', '/')
    $said = @($sources | Where-Object {
        $_.Name -eq $leaf -and ($file -notmatch '[\\/]' -or ($_.FullName -replace '\\', '/') -like ('*/' + ($file -replace '\\', '/'))) })
    if (-not $said.Count) { return $null }
    if (@($said | Where-Object { Test-Declares $text[$_.FullName] $name }).Count) { return $null }
    return (($homes | ForEach-Object { $_.FullName.Substring($Repo.Length + 1) -replace '\\', '/' }) -join ', ')
}
function Get-Claims([string]$comment) {
    $out = New-Object System.Collections.Generic.List[object]
    foreach ($m in $nameIn.Matches($comment)) { $out.Add([pscustomobject]@{ Name = $m.Groups[1].Value; File = $m.Groups[2].Value; At = $m.Index }) }
    foreach ($m in $fileName.Matches($comment)) { $out.Add([pscustomobject]@{ Name = $m.Groups[2].Value; File = $m.Groups[1].Value; At = $m.Index }) }
    return @($out | Sort-Object At)
}

$claims = @(Get-Claims 'the list (BLURB in server.js, #3138) and the content rules in server.js (CSP_HEADER), HTML in server.js')
Yes ('"NAME in file" and "file (NAME)" are both read (' + (($claims | ForEach-Object { $_.Name + ' in ' + $_.File }) -join '; ') + ')') (
    $claims.Count -eq 3 -and $claims[0].Name -eq 'BLURB' -and $claims[1].Name -eq 'CSP_HEADER' -and $claims[2].Name -eq 'HTML')
Yes 'a NAME no file of the site declares is a word and left alone' ($null -eq (Get-Misplaced 'HTML' 'server.js'))
Yes 'and one said to be in a file that does not declare it is caught (BLURB in server.js)' ($null -ne (Get-Misplaced 'BLURB' 'server.js'))
Yes 'but not when the file does (BLURB in site/lib/pages.js)' ($null -eq (Get-Misplaced 'BLURB' 'site/lib/pages.js'))

$wrong = @()
$claimed = 0
foreach ($f in $files) {
    if ($f.FullName -like ('*' + [IO.Path]::DirectorySeparatorChar + 'tests' + [IO.Path]::DirectorySeparatorChar + '*')) { continue }
    $rel = $f.FullName.Substring($Repo.Length + 1) -replace '\\', '/'
    foreach ($c in $comments[$rel]) {
        foreach ($cl in (Get-Claims $c.Text)) {
            $claimed++
            $at = Get-Misplaced $cl.Name $cl.File
            if ($at) { $wrong += ('{0}:{1}  {2} in {3}, which is in {4}' -f $rel, $c.Line, $cl.Name, $cl.File, $at) }
        }
    }
}
foreach ($w in $wrong) { Write-Host "      says a NAME is in a file that does not hold it: $w" }
Yes ("every NAME a comment says is in a file of the site is declared there ($claimed said)") (
    $wrong.Count -eq 0 -and $claimed -gt 0)

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
