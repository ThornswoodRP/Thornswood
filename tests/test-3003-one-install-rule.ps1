<#
  test-3003-one-install-rule.ps1

      pwsh -NoProfile -File .\tests\test-3003-one-install-rule.ps1

  The rule that finds the launcher install lives in one place, Where.ps1's
  Find-InstallRoot, and every script asks Where.ps1 Install or InstallDev for
  it.

  WHY THIS EXISTS. Issue #3003. Until 21 October six scripts each carried a
  pasted Find-Root (Publish-Update, Repair-Manifest, Sync-Client, Go,
  Deploy-Gamemode and Check-CollectionRules), and Check-Editions a seventh
  copy written out inline, each pasted from the one before. A change to the
  rule had to be made seven times, and tests\test-feed-rules.ps1 held five
  of the copies word for word against each other, which kept them alike and
  kept them copies. Five of them also stopped off Windows: their first line
  asked Join-Path for C:\Thornswood, and Join-Path throws "Cannot find drive"
  on a machine with no C:. #2989's pull request had just changed
  Check-CollectionRules's copy by hand for that, one copy of seven.

  AND EVERY SCRIPT, issue #3031. Moving the seven left about forty scripts
  that took C:\Thornswood, or a folder under it, as a fixed default instead
  of asking, so on a developer whose launcher is on another drive they read
  or wrote a folder that is not the install unless the path was typed each
  time. Each script had been written with Patrick's own install as its
  default before there was one place to ask, and nothing stopped the next
  one. They ask Where.ps1 now, and part 3 holds every script to it.

  THIS FAILS ON:
    1. a function named Find-Root or Find-InstallRoot in any script outside
       Where.ps1;
    2. any script outside Where.ps1 that walks the drives for
       Launcher\Thornswood.exe, the rule itself under another name or none
       (a Get-PSDrive call and that file name in one script);
    3. one of the seven scripts not asking Where.ps1 Install, or any script
       writing an install folder (C:\Thornswood, C:\Thornswood-DevBuild or
       a folder under either, on any drive) into a string of its own. Left
       out: Where.ps1, whose rule starts there; scripts\oneoff, parked and not
       run (its README); and tests, whose folders are made up. Where a new
       install goes is the launcher's own first start since #4824
       (launcher\app\InstallPlace.cs), not a script, so the leave the old
       installer\Setup-Thornswood.ps1 had went with it. The box's own
       folders (C:\Thornswood-Server, C:/Thornswood-Docs and the rest) are
       not the install and are not read as one;
    4. Where.ps1's rule answering wrong on made up drives, or Install and
       InstallDev not answering as the rule says.
  The readers in 1, 2 and 3 are run over planted scripts first, one per way
  of copying the rule or writing the folder, so a reader that finds nothing
  anywhere cannot pass.

  Read only. The planted scripts are parsed from strings, not written.
#>
[CmdletBinding()]
param([string]$Repo)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $Repo) { $Repo = Split-Path -Parent $PSScriptRoot }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

$FnAst = [System.Management.Automation.Language.FunctionDefinitionAst]
$CmdAst = [System.Management.Automation.Language.CommandAst]
$StrAst = [System.Management.Automation.Language.StringConstantExpressionAst]
$XStrAst = [System.Management.Automation.Language.ExpandableStringExpressionAst]

# A Get-PSDrive that lists every drive rather than asking for one by name
# (Get-PSDrive C, -Name): the walk the rule makes. The value after any other
# parameter (-PSProvider FileSystem, -ErrorAction SilentlyContinue) is not a
# name.
function Test-EveryDrive($cmd) {
    $ParamAst = [System.Management.Automation.Language.CommandParameterAst]
    $els = @($cmd.CommandElements)
    for ($i = 1; $i -lt $els.Count; $i++) {
        $e = $els[$i]
        if ($e -is $ParamAst) {
            if ($e.ParameterName -match '^(?i)(Name|LiteralName)$') { return $false }
            if (-not $e.Argument -and ($i + 1) -lt $els.Count -and $els[$i + 1] -isnot $ParamAst) { $i++ }
            continue
        }
        return $false
    }
    return $true
}

# What in one parsed script copies the install rule, as lines a person can
# read; nothing when it copies none.
function Get-RuleCopies($ast) {
    $out = @()
    foreach ($f in $ast.FindAll({ param($n) $n -is $FnAst -and $n.Name -match '^(?i)Find-(Install)?Root$' }, $true)) {
        $out += ("line {0}: function {1}" -f $f.Extent.StartLineNumber, $f.Name)
    }
    $drives = @($ast.FindAll({ param($n) $n -is $CmdAst -and $n.GetCommandName() -eq 'Get-PSDrive' }, $true) | Where-Object { Test-EveryDrive $_ })
    $exe = @($ast.FindAll({ param($n) ($n -is $StrAst -or $n -is $XStrAst) -and $n.Value -match '(?i)Launcher[\\/]Thornswood\.exe' }, $true))
    if ($drives.Count -and $exe.Count) {
        $out += ("line {0}: walks the drives for Launcher\Thornswood.exe" -f $drives[0].Extent.StartLineNumber)
    }
    return $out
}
function Parse-Text([string]$text) {
    $t = $null; $e = $null
    return [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$t, [ref]$e)
}
function Parse-File([string]$path) {
    $t = $null; $e = $null
    return [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$t, [ref]$e)
}

# ---- 1. the reader, over planted scripts -------------------------------------
Write-Host ''
Write-Host 'the reader, over planted scripts'
$walk = @'
    foreach ($d in @(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Za-z]:\\$' })) {
        $cand = Join-Path $d.Root 'Thornswood'
        if (Test-Path -LiteralPath (Join-Path $cand 'Launcher\Thornswood.exe')) { return $cand }
    }
'@
$planted = [ordered]@{
    'a pasted Find-Root'            = "function Find-Root {`n    `$first = 'C:\Thornswood'`n$walk    return `$first`n}"
    'the rule under another name'   = "function Get-Install {`n$walk    return 'C:\Thornswood'`n}"
    'the rule inline, as Check-Editions had it' = "`$root = 'C:\Thornswood'`nif (-not `$Data) {`n$walk}"
    'a Find-InstallRoot of its own' = "function Find-InstallRoot { return 'C:\Thornswood' }"
}
foreach ($k in $planted.Keys) {
    Yes ("found: $k") (@(Get-RuleCopies (Parse-Text $planted[$k])).Count -gt 0)
}
$clean = @'
$root = [string](& $whereScript Install)
$free = (Get-PSDrive C).Free
Write-Host 'no launcher at C:\Thornswood\Launcher\Thornswood.exe' # a word about it is not a copy
'@
Yes 'not found: a script that asks Where.ps1, and reads a drive for another reason' (@(Get-RuleCopies (Parse-Text $clean)).Count -eq 0)

# ---- 2. every script here -----------------------------------------------------
Write-Host ''
Write-Host 'every script outside Where.ps1'
$where = Join-Path $Repo 'scripts\release\Where.ps1'
$whereFull = [IO.Path]::GetFullPath($where)
$files = @()
foreach ($top in 'scripts', 'installer', 'launcher', 'bot', 'voice', 'site') {
    $dir = Join-Path $Repo $top
    # Not a product's harnesses in its tests folder (plan line 42): their
    # folders are made up, as tests' are.
    if (Test-Path -LiteralPath $dir) { $files += @(Get-ChildItem -LiteralPath $dir -Recurse -File -Filter '*.ps1' | Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' -and $_.FullName.Substring($dir.Length) -notmatch '^[\\/]tests[\\/]' }) }
}
Yes ("there are scripts to read ({0})" -f $files.Count) ($files.Count -gt 100)
$copies = @()
foreach ($f in $files) {
    if ([IO.Path]::GetFullPath($f.FullName) -eq $whereFull) { continue }
    foreach ($c in @(Get-RuleCopies (Parse-File $f.FullName))) {
        $copies += ("{0} {1}" -f $f.FullName.Substring($Repo.Length).TrimStart('\', '/'), $c)
    }
}
Yes 'no script outside Where.ps1 carries the install rule (ask Where.ps1 Install or InstallDev)' ($copies.Count -eq 0)
foreach ($c in $copies) { Write-Host "      $c" }
Yes 'Where.ps1 has it, once' (@((Parse-File $where).FindAll({ param($n) $n -is $FnAst -and $n.Name -eq 'Find-InstallRoot' }, $true)).Count -eq 1)

# ---- 3. no install folder written into a script ------------------------------
# Over string literals only, so a comment that names C:\Thornswood in words
# is not mistaken for a folder written in. A message that names the folder in
# the middle of a sentence is not caught; one that starts with it is, the
# same as a default.
$installLit = '(?i)^[a-z]:[\\/]Thornswood(-DevBuild)?([\\/]|$)'
function Get-InstallLiterals($ast) {
    return @($ast.FindAll({ param($n) ($n -is $StrAst -or $n -is $XStrAst) -and $n.Value -match $installLit }, $true))
}
Write-Host ''
Write-Host 'the install folder reader, over planted scripts'
$plantedLit = [ordered]@{
    'a default of C:\Thornswood'               = "param([string]`$Root = 'C:\Thornswood')"
    'a default under it, on another drive'     = "param([string]`$Data = 'D:\Thornswood\Game\Data')"
    'the dev install, with forward slashes'    = "`$c = if (`$Dev) { 'C:/Thornswood-DevBuild' } else { 'x' }"
    'a folder under it in double quotes'       = "`$p = `"C:\Thornswood\Profile\`$name`""
    'the install in a list'                    = "`$roots = @('C:\Thornswood', 'C:\SkyrimRP')"
}
foreach ($k in $plantedLit.Keys) {
    Yes ("found: $k") (@(Get-InstallLiterals (Parse-Text $plantedLit[$k])).Count -gt 0)
}
$cleanLit = @'
# C:\Thornswood is where the launcher usually is; asked, not written.
param([string]$Root = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
      [string]$Server = 'C:\Thornswood-Server', [string]$Docs = 'C:/Thornswood-Docs', [string]$Any = 'C:\Thornswood-*')
Write-Host ('no launcher at ' + $Root)
'@
Yes 'not found: a script that asks Where.ps1 and names the box''s own folders' (@(Get-InstallLiterals (Parse-Text $cleanLit)).Count -eq 0)

Write-Host ''
Write-Host 'the seven scripts that had a copy ask Where.ps1'
$asks = [regex]"Where\.ps1'\) (Install\b|\`$\(if \(.+\) \{ 'InstallDev' \} else \{ 'Install' \}\))"
foreach ($rel in 'scripts\release\Publish-Update.ps1', 'scripts\release\Repair-Manifest.ps1', 'scripts\release\Sync-Client.ps1',
                 'scripts\release\Go.ps1', 'scripts\deploy\Deploy-Gamemode.ps1', 'scripts\mods\Check-CollectionRules.ps1',
                 'scripts\mods\Check-Editions.ps1') {
    $path = Join-Path $Repo $rel
    $name = ($rel -split '\\')[-1]
    if (-not (Test-Path -LiteralPath $path)) { Yes "$name is here" $false; continue }
    Yes "$name asks Where.ps1 for the install" ($asks.IsMatch([IO.File]::ReadAllText($path)))
}

Write-Host ''
Write-Host 'every script writes no install folder of its own'
# Where each one is let off, and why: the header says.
$letOff = @{
    'scripts/release/Where.ps1'          = 'the rule'
}
# The box scripts' gaming-PC guard looked for C:\Thornswood\Game\SkyrimSE.exe
# and was let off here until #3041; it asks Windows what the machine is now
# (scripts\vps\BoxGuard.ps1), so nothing names the folder for it.
$written = @()
$read = 0
foreach ($f in $files) {
    $rel = $f.FullName.Substring($Repo.Length).TrimStart('\', '/') -replace '\\', '/'
    if ($letOff.ContainsKey($rel) -or $rel -like 'scripts/oneoff/*') { continue }
    $read++
    foreach ($l in @(Get-InstallLiterals (Parse-File $f.FullName))) {
        $written += ("{0} line {1}: {2}" -f $rel, $l.Extent.StartLineNumber, $l.Extent.Text)
    }
}
Yes ("there are scripts to read here too ({0})" -f $read) ($read -gt 100)
Yes 'no script writes the install folder (ask Where.ps1 Install or InstallDev)' ($written.Count -eq 0)
foreach ($w in $written) { Write-Host "      $w" }
foreach ($rel in @($letOff.Keys)) {
    Yes ("  $rel, let off, is still here") (Test-Path -LiteralPath (Join-Path $Repo $rel))
}

# ---- 4. the rule itself -------------------------------------------------------
# Find-InstallRoot is lifted out of Where.ps1 by the parser and driven with
# Test-Path and Get-PSDrive shadowed, so nothing is read off this machine and
# the answer does not depend on which drives it has. Join-Path joins with a
# backslash whatever this machine's separator is, because Join-Path off
# Windows refuses a path on a drive called C.
Write-Host ''
Write-Host 'the rule, on made up drives'
$fn = @((Parse-File $where).FindAll({ param($n) $n -is $FnAst -and $n.Name -eq 'Find-InstallRoot' }, $true))
$fnText = $(if ($fn.Count -eq 1) { $fn[0].Extent.Text } else { '' })
function Run-Rule([string[]]$has, [string[]]$roots) {
    $head = @'
param($has, $roots)
function Test-Path { param([string]$LiteralPath) return ($has -contains $LiteralPath) }
function Get-PSDrive { param([string]$PSProvider, $ErrorAction) return @($roots | ForEach-Object { [pscustomobject]@{ Root = $_ } }) }
function Join-Path { param([string]$Path, [string]$ChildPath) return ($Path.TrimEnd('\', '/') + '\' + $ChildPath) }
'@
    return [string](& ([scriptblock]::Create($head + "`n" + $fnText + "`nFind-InstallRoot")) $has $roots)
}
if ($fnText) {
    $onC = 'C:\Thornswood'
    $onD = 'D:\Thornswood'
    $drives = @('C:\', 'D:\', '/')
    Yes 'the launcher on C: is found first' ((Run-Rule @($onC + '\Launcher\Thornswood.exe', $onD + '\Launcher\Thornswood.exe') $drives) -eq $onC)
    Yes 'a launcher on another drive is found when C: has none' ((Run-Rule @($onD + '\Launcher\Thornswood.exe') $drives) -eq $onD)
    Yes 'no launcher anywhere falls back to C:, so a message names a real place' ((Run-Rule @() $drives) -eq $onC)
    Yes 'a drive whose root is not a letter is not tried' ((Run-Rule @('\Thornswood\Launcher\Thornswood.exe') @('/')) -eq $onC)
}
else { Yes 'Where.ps1 has a Find-InstallRoot to drive' $false }

# Where.ps1 run whole, on this machine: whichever install it finds, InstallDev
# is that with -DevBuild on the end, and neither stops off Windows.
$install = ''; $installDev = ''; $threw = ''
try {
    $install = [string](& $where Install)
    $installDev = [string](& $where InstallDev)
}
catch { $threw = $_.Exception.Message }
# A runner off the box names its own (THORNSWOOD_INSTALL, #3860), and the
# answer is then that and not the rule's.
if ($env:THORNSWOOD_INSTALL) {
    Yes 'Where.ps1 Install answers, on this machine too: the runner''s own folder' (-not $threw -and $install -eq $env:THORNSWOOD_INSTALL)
} else {
    Yes 'Where.ps1 Install answers, on this machine too' (-not $threw -and $install -match '(?i)^[a-z]:\\Thornswood$')
}
if ($threw) { Write-Host "      $threw" }
$saved = $env:THORNSWOOD_INSTALL
try {
    $env:THORNSWOOD_INSTALL = 'X:\Runner\install'
    Yes 'THORNSWOOD_INSTALL, which an off-box runner''s .env sets, is the answer when it is set (#3860)' (([string](& $where Install)) -eq 'X:\Runner\install' -and ([string](& $where InstallDev)) -eq 'X:\Runner\install-DevBuild')
} finally { $env:THORNSWOOD_INSTALL = $saved }
Yes 'Where.ps1 InstallDev is Install with -DevBuild on the end' ($installDev -eq ($install + '-DevBuild'))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
