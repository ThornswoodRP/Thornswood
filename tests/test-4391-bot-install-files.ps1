<#
  test-4391-bot-install-files.ps1

      pwsh -NoProfile -File .\tests\test-4391-bot-install-files.ps1
      powershell -NoProfile -File .\tests\test-4391-bot-install-files.ps1

  Issue #4391. bot\README.md lists what goes to the box with the bot and says
  a file it does not name is never on the box, and Install-Bot.ps1's help says
  what it stages. Both had fallen behind what the install really sends:
  _pyguard.py and trust.py, which the bot cannot start without, and the
  staff channel file were named by neither. Nothing held the three together.
  This does:

    1. What the install sends is read from Install-Bot.ps1 itself: the paths
       it packs into the bot artifact (New-ThornswoodArtifact -Paths), with
       the bot's code from Bot-Code.ps1. Everything the run copies comes out
       of that artifact.
    2. Every module of the bot's own that bot.py loads, directly or through
       another module, at the top of a file or inside a function, is one the
       install sends. A module is the bot's own when it is a file in bot\.
    3. The README's "What goes up with it" paragraph names every file the
       install sends, and names no file it does not send. The bot's modules
       may be named together as bot_*.py, the shape Bot-Code.ps1 reads out of
       bot.py; every other file by its own name.
    4. The help at the top of Install-Bot.ps1 has a WHAT IT SENDS paragraph
       that does the same.
    5. Run on a scratch bot that imports a helper the install does not send,
       the check in 2 names that helper, so it can fail.

  Reads the repository and writes a scratch folder under the temp folder,
  removed at the end. Nothing leaves the machine.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$why = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what"; if ($why) { Write-Host "      $why" } }
}

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = (Resolve-Path (Join-Path $Here '..')).Path
$botDir = Join-Path $repo 'bot'
$installPath = Join-Path (Join-Path (Join-Path $repo 'scripts') 'deploy') 'Install-Bot.ps1'
. (Join-Path (Join-Path (Join-Path $repo 'scripts') 'deploy') 'Bot-Code.ps1')

# The leaf of a path the install sends: assets/join-card.png -> join-card.png.
function Leaf([string]$p) { return ($p -split '[\\/]')[-1] }

# ---- 1. what the install sends, from Install-Bot.ps1 itself
$tokens = $null; $errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installPath, [ref]$tokens, [ref]$errs)
$packs = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'New-ThornswoodArtifact' }, $true))
$pathsArg = $null
if ($packs.Count -eq 1) {
    $els = $packs[0].CommandElements
    for ($i = 0; $i -lt $els.Count - 1; $i++) {
        if ($els[$i] -is [System.Management.Automation.Language.CommandParameterAst] -and $els[$i].ParameterName -eq 'Paths') { $pathsArg = $els[$i + 1] }
    }
}
Yes 'Install-Bot.ps1 packs the bot artifact in one place, with -Paths' ($packs.Count -eq 1 -and $null -ne $pathsArg) ('New-ThornswoodArtifact calls: ' + $packs.Count)
$extra = @()
if ($pathsArg) {
    $extra = @($pathsArg.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) |
        ForEach-Object { $_.Value } | Where-Object { $_ -match '^[\w./-]+\.\w+$' })
}
$code = @(Get-ThornswoodBotCode $repo)
$parts = @(Get-ThornswoodBotParts $repo)
$sent = @($code | ForEach-Object { 'bot/' + $_ }) + $extra
Yes ('  it sends ' + $sent.Count + ' files: the bot''s code and ' + ($extra -join ', ')) ($extra.Count -ge 1 -and $code.Count -ge 5)
$sentLeaves = @($sent | ForEach-Object { Leaf $_ })

# ---- 2. every module of the bot's own that bot.py loads is sent
# The modules a file imports, by name: import a, b / from a import x / from
# a.b import x, at the top or indented in a function. Comment lines are not
# read. Only a name that is a file in $dir counts: the rest are Python's or a
# library's.
function Get-LocalImports([string]$dir, [string]$file) {
    $found = New-Object System.Collections.Generic.List[string]
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $dir $file))) {
        $names = @()
        if ($line -cmatch '^\s*from\s+([A-Za-z_]\w*)[\w.]*\s+import\b') { $names = @($Matches[1]) }
        elseif ($line -cmatch '^\s*import\s+([A-Za-z_][\w.]*(?:\s+as\s+\w+)?(?:\s*,\s*[A-Za-z_][\w.]*(?:\s+as\s+\w+)?)*)') {
            $names = @($Matches[1] -split ',' | ForEach-Object { (($_.Trim() -split '\s+')[0] -split '\.')[0] })
        }
        foreach ($n in $names) {
            if ((Test-Path -LiteralPath (Join-Path $dir ($n + '.py')) -PathType Leaf) -and -not $found.Contains($n + '.py')) { $found.Add($n + '.py') }
        }
    }
    return $found.ToArray()
}
# bot.py and everything it reaches, in the order they are first met.
function Get-LoadedModules([string]$dir) {
    $seen = New-Object System.Collections.Generic.List[string]
    $todo = New-Object System.Collections.Generic.Queue[string]
    $todo.Enqueue('bot.py')
    while ($todo.Count) {
        $f = $todo.Dequeue()
        if ($seen.Contains($f)) { continue }
        $seen.Add($f)
        foreach ($m in @(Get-LocalImports $dir $f)) { if (-not $seen.Contains($m)) { $todo.Enqueue($m) } }
    }
    return $seen.ToArray()
}
$loaded = @(Get-LoadedModules $botDir)
$unsent = @($loaded | Where-Object { $sent -notcontains ('bot/' + $_) })
Yes ('every module of the bot''s own that bot.py loads (' + $loaded.Count + ') is one the install sends') ($loaded.Count -gt $parts.Count -and $unsent.Count -eq 0) ('not sent: ' + ($unsent -join ', '))
foreach ($m in 'bot_base.py', '_pyguard.py', 'trust.py', 'card.py') {
    Yes ('  ' + $m + ' is among them, read out of the imports') ($loaded -contains $m)
}

# ---- 3. the README names each, and nothing else
# Every file name in the paragraph, in backticks or not: a word ending in one
# of the extensions the bot's files have.
function Get-NamedFiles([string]$text) {
    return @([regex]::Matches($text, '[\w*-]+\.(?:py|txt|json|png|cs)\b') | ForEach-Object { $_.Value } | Select-Object -Unique)
}
# What a paragraph leaves out of what is sent, and what it names that is not.
function Compare-Named([string]$text) {
    $named = @(Get-NamedFiles $text)
    $glob = $named -contains 'bot_*.py'
    $left = @($sentLeaves | Where-Object { $named -notcontains $_ -and -not ($glob -and $parts -contains $_) })
    $odd = @($named | Where-Object { $_ -ne 'bot_*.py' -and $sentLeaves -notcontains $_ })
    return @{ Left = $left; Odd = $odd }
}
$readme = [IO.File]::ReadAllText((Join-Path $botDir 'README.md')).Replace("`r`n", "`n")
$at = $readme.IndexOf('What goes up with it')
$para = ''
if ($at -ge 0) { $end = $readme.IndexOf("`n`n", $at); if ($end -lt 0) { $end = $readme.Length }; $para = $readme.Substring($at, $end - $at) }
Yes 'bot\README.md has its "What goes up with it" paragraph' ($para -ne '')
$r = Compare-Named $para
Yes '  it names every file the install sends' ($para -ne '' -and $r.Left.Count -eq 0) ('not named: ' + ($r.Left -join ', '))
Yes '  and no file the install does not send' ($para -ne '' -and $r.Odd.Count -eq 0) ('not sent: ' + ($r.Odd -join ', '))
$named = @(Get-NamedFiles $para)
$unnamed = @($loaded | Where-Object { $named -notcontains $_ -and -not ($named -contains 'bot_*.py' -and $parts -contains $_) })
Yes '  every module bot.py loads is named there' ($para -ne '' -and $unnamed.Count -eq 0) ('not named: ' + ($unnamed -join ', '))

# ---- 4. the install's help names each, and nothing else
$install = [IO.File]::ReadAllText($installPath).Replace("`r`n", "`n")
$helpEnd = $install.IndexOf('#>')
$help = if ($install.StartsWith('<#') -and $helpEnd -gt 0) { $install.Substring(0, $helpEnd) } else { '' }
$hat = $help.IndexOf("`n  WHAT IT SENDS")
$hpara = ''
if ($hat -ge 0) { $hend = $help.IndexOf("`n`n", $hat + 1); if ($hend -lt 0) { $hend = $help.Length }; $hpara = $help.Substring($hat, $hend - $hat) }
Yes 'Install-Bot.ps1''s help has a WHAT IT SENDS paragraph' ($hpara -ne '')
$h = Compare-Named $hpara
Yes '  it names every file the install sends' ($hpara -ne '' -and $h.Left.Count -eq 0) ('not named: ' + ($h.Left -join ', '))
Yes '  and no file the install does not send' ($hpara -ne '' -and $h.Odd.Count -eq 0) ('not sent: ' + ($h.Odd -join ', '))

# ---- 5. the import check can fail
$fake = Join-Path ([IO.Path]::GetTempPath()) ('tw-4391-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fake -Force | Out-Null
try {
    [IO.File]::WriteAllText((Join-Path $fake 'bot.py'), "import _pyguard  # noqa`nimport os, json`n# import ghost`nimport bot_base`n")
    [IO.File]::WriteAllText((Join-Path $fake '_pyguard.py'), "")
    [IO.File]::WriteAllText((Join-Path $fake 'ghost.py'), "")
    [IO.File]::WriteAllText((Join-Path $fake 'bot_base.py'), "from helper.inner import thing`ndef f():`n    import trust as T, os`n")
    [IO.File]::WriteAllText((Join-Path $fake 'helper.py'), "")
    [IO.File]::WriteAllText((Join-Path $fake 'trust.py'), "")
    $got = @(Get-LoadedModules $fake)
    Yes ('on a scratch bot it finds the helper and the module imported in a function, and not a commented one (' + ($got -join ', ') + ')') (($got -join ',') -ceq 'bot.py,_pyguard.py,bot_base.py,helper.py,trust.py')
    $fakeSent = @('bot.py', '_pyguard.py', 'bot_base.py', 'trust.py')
    $miss = @($got | Where-Object { $fakeSent -notcontains $_ })
    Yes '  and names helper.py as loaded but not sent' (($miss -join ',') -ceq 'helper.py')
} finally {
    Remove-Item -LiteralPath $fake -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
