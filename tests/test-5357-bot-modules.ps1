<#
  test-5357-bot-modules.ps1

      pwsh -NoProfile -File .\tests\test-5357-bot-modules.ps1
      powershell -NoProfile -File .\tests\test-5357-bot-modules.ps1

  Issue #5357. bot\bot.py was 8,698 lines; it is the start now, over the
  modules it imports, bot\bot_*.py, one area of the bot each. bot.py's
  import lines are the one list of those modules, and everything that has to
  know them reads that list. This holds it:

    1. bot.py is a short start: under 300 lines, and no def or class of the
       bot's own besides reading the env file.
    2. Every bot\bot_*.py is imported by bot.py, and every module bot.py
       imports is a file there, so nothing is left behind on a merge and
       nothing goes to the box that bot.py does not load.
    3. Each module imports, at its top, only modules bot.py loads before it,
       and none imports bot itself: run as python bot.py, bot is __main__,
       and an import of bot would load all of it a second time.
    4. Bot-Code.ps1's list is bot.py, _pyguard.py, trust.py, card.py and
       those modules in that order, and only names of the shape bot_<x>.py.
    5. Install-Bot.ps1 packs, sends and parse-checks that list; App-Part.ps1
       zips it into the bot's part of a Release, with nothing else of the
       code; merge-release.yml starts a Release when one of the modules
       changes.
    6. tests\bot-files.js and bot\harness_bot.py, which the harnesses read
       the bot through, name the same modules in the same order.

  Reads the repository and writes one zip under the temp folder, removed at
  the end. Nothing leaves the machine.
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
. (Join-Path $repo 'scripts\deploy\Bot-Code.ps1')

# ---- 1. bot.py is the start
$start = [IO.File]::ReadAllLines((Join-Path $botDir 'bot.py'))
$defs = @($start | Where-Object { $_ -match '^(async\s+)?(def|class)\s+(\w+)' } | ForEach-Object { $_ -replace '^(async\s+)?(def|class)\s+(\w+).*$', '$3' })
Yes ('bot.py is a short start: ' + $start.Count + ' lines, and of its own only ' + ($defs -join ', ')) ($start.Count -lt 300 -and ($defs -join ',') -eq '_load_env_file')

# ---- 2. one list, and it is the files
$parts = @(Get-ThornswoodBotParts $repo)
$onDisk = @(Get-ChildItem -LiteralPath $botDir -Filter 'bot_*.py' -File | ForEach-Object { $_.Name } | Sort-Object)
$missing = @($parts | Where-Object { $onDisk -notcontains $_ })
$stray = @($onDisk | Where-Object { $parts -notcontains $_ })
Yes ('bot.py imports ' + $parts.Count + ' modules, and each is a file in bot\') ($parts.Count -ge 20 -and $missing.Count -eq 0) ($missing -join ', ')
Yes '  and every bot\bot_*.py is one of them' ($stray.Count -eq 0) ($stray -join ', ')

# ---- 3. each imports only what bot.py loads before it, and never bot
$order = @($parts | ForEach-Object { $_ -replace '\.py$', '' })
$late = New-Object System.Collections.Generic.List[string]
$selfs = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $order.Count; $i++) {
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $botDir ($order[$i] + '.py')))) {
        if ($line -cmatch '^(?:from (\w+) import|import (\w+))') {
            $m = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
            if ($m -eq 'bot') { $selfs.Add($order[$i]) }
            $at = [Array]::IndexOf($order, $m)
            if ($at -ge $i) { $late.Add($order[$i] + ' imports ' + $m) }
        }
    }
}
Yes 'each module imports at its top only modules bot.py loads before it' ($late.Count -eq 0) ($late -join '; ')
Yes '  and none imports bot, which is __main__ when the bot runs' ($selfs.Count -eq 0) ($selfs -join ', ')
$baseAt = [Array]::IndexOf($start, 'import bot_base  # noqa: F401')
$firstOther = @(for ($i = 0; $i -lt $start.Count; $i++) { if ($start[$i] -cmatch '^import (?!_pyguard\b|json\b|os\b|sys\b)\w+') { $i } }) | Select-Object -First 1
Yes '  and bot.py loads bot_base, where the roots go in, before any other module and before discord' ($baseAt -gt 0 -and $firstOther -eq $baseAt)

# ---- 4. Bot-Code.ps1's list
$code = @(Get-ThornswoodBotCode $repo)
$want = @('bot.py', '_pyguard.py', 'trust.py', 'card.py') + $parts
Yes ('Bot-Code.ps1 lists bot.py, _pyguard.py, trust.py, card.py and the modules, in bot.py''s order (' + $code.Count + ')') (($code -join ',') -ceq ($want -join ','))
Yes '  and nothing that is not of the shape bot_<x>.py comes from bot.py' (@($parts | Where-Object { $_ -cnotmatch '^bot_[a-z0-9_]+\.py$' }).Count -eq 0)
$fake = Join-Path ([IO.Path]::GetTempPath()) ('tw-5357-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fake 'bot') -Force | Out-Null
try {
    [IO.File]::WriteAllText((Join-Path $fake 'bot\bot.py'), "import _pyguard`nimport bot_base  # noqa`n# import bot_comment`nimport bot_Upper`nimport joins.json`n  import bot_inside`nimport bot_core`n")
    Yes '  read from bot.py''s import lines only, the way Python reads them' ((@(Get-ThornswoodBotParts $fake) -join ',') -ceq 'bot_base.py,bot_core.py')
    [IO.File]::WriteAllText((Join-Path $fake 'bot\bot.py'), "import _pyguard`n")
    $threw = $false
    try { $null = Get-ThornswoodBotParts $fake } catch { $threw = $true }
    Yes '  and a bot.py that imports no module stops it, rather than sending the start alone' $threw
} finally {
    Remove-Item -LiteralPath $fake -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 5. what sends it
$install = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Install-Bot.ps1'))
Yes 'Install-Bot.ps1 reads the list from Bot-Code.ps1' ($install.Contains(". (Join-Path `$Here 'Bot-Code.ps1')"))
Yes '  packs it into the bot artifact' ($install.Contains("-Paths (@(Get-ThornswoodBotCode `$Repo | ForEach-Object { 'bot/' + `$_ }) + @("))
Yes '  sends it' ($install.Contains("foreach (`$f in @(Get-ThornswoodBotCode `$Repo) + @('staff-channel.txt', 'dev-channel.txt', 'requirements.txt', 'factions.json')) {"))
Yes '  and parse-checks it on the box before the bot is stopped' ($install.Contains("`$hashes @(Get-ThornswoodBotCode `$Repo)) + `$serviceCheckBlock"))

$pwsh = Get-Command pwsh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$zip = Join-Path ([IO.Path]::GetTempPath()) ('tw-5357-' + [Guid]::NewGuid().ToString('N') + '.zip')
if (-not $pwsh) { Write-Host 'SKIP  App-Part.ps1 -Part discord: no pwsh here, which it runs in' }
else { try {
    $null = & $pwsh.Source -NoProfile -File (Join-Path $repo 'scripts\release\App-Part.ps1') -Part discord -Out $zip 2>&1
    $names = @()
    if (Test-Path -LiteralPath $zip) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($zip)
        try { $names = @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() }
    }
    $py = @($names | Where-Object { $_ -like '*.py' } | Sort-Object)
    $wantPy = @($code | Sort-Object)
    Yes ('App-Part.ps1 -Part discord zips exactly that code (' + $py.Count + ' .py files)') ($names.Count -gt 0 -and ($py -join ',') -ceq ($wantPy -join ',')) (($py -join ',') + ' / ' + ($wantPy -join ','))
} finally {
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
} }

$wf = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\merge-release.yml'))
Yes 'merge-release.yml starts a Release when bot.py or one of its modules changes' ($wf -match "(?m)^\s+- 'bot/bot\.py'\s*$" -and $wf -match "(?m)^\s+- 'bot/bot_\*\.py'\s*$")

# ---- 6. what the harnesses read the bot through
$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($node) {
    $js = @(& $node.Source -e "console.log(require(process.argv[1]).parts().join(','))" (Join-Path $repo 'tests\bot-files.js') 2>&1 | ForEach-Object { "$_" })
    Yes 'tests\bot-files.js names the same modules in the same order' (($js -join '') -ceq ($order -join ','))
} else { Write-Host 'SKIP  tests\bot-files.js: no node here' }
$python = $null
foreach ($c in 'python3.12', 'python3', 'python') {
    $python = Get-Command $c -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($python) { break }
}
if ($python) {
    $said = @(& $python.Source -I -c "import sys; sys.path.insert(0, sys.argv[1]); import harness_bot; print(','.join(harness_bot.parts()))" $botDir 2>&1 | ForEach-Object { "$_" })
    Yes 'bot\harness_bot.py names the same modules in the same order' (($said -join '') -ceq ($order -join ',')) ($said -join ' ')
} else { Write-Host 'SKIP  bot\harness_bot.py: no python here' }

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
