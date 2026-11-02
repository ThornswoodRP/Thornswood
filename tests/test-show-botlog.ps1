<#
  test-show-botlog.ps1

  Show-BotLog.ps1 reads bot.log.1 before bot.log, so the lines just before a
  roll are not hidden by it, and with no bot.log.1 it reads bot.log exactly as
  it did before.

  WHY THIS EXISTS. Entry 249 on the To Do List: "a log that never rotates".
  The roll itself is entry 220's: run.ps1 calls roll-log.ps1 before each start
  of the bot, and at 4 MB bot.log becomes bot.log.1. The bot is restarted by
  that same start, so right after a roll the lines that say why it restarted
  are in bot.log.1 and bot.log holds only the new run. Show-BotLog read
  bot.log alone, so the one time somebody runs it to find out why the bot
  restarted is the one time it would have shown nothing useful.

  So this checks, in order:

    1. Show-BotLog.ps1 parses, and the script it sends fills in only rootWin,
       filter and Lines, so it is safe to expand here;
    2. run the way the box runs it (PowerShell 7, handed the script as
       an encoded command) against a temp folder standing in for
       C:\Thornswood-Bot: bot.log.1's lines come out, before bot.log's;
    3. the filter still leaves out what the bot did not say itself, in both
       files, and -All still lets it through;
    4. -Lines counts across both files, keeping the newest;
    5. with no bot.log.1 it shows bot.log and no error;
    6. with no bot.log it still says there is none.

  Never connects to anything. It looks at this machine's process list, the
  way the script does on the VPS, which reads and changes nothing. Writes only
  under its own temp folder.

      pwsh -NoProfile -File tests\test-show-botlog.ps1
      pwsh -NoProfile -File tests\test-show-botlog.ps1 -ShowBotLogPath <an older copy>
#>
[CmdletBinding()]
param([string]$ShowBotLogPath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
# What this runs, every machine runs in PowerShell 7 since #5356, the box
# included, and this harness runs in it too.
$boxPs = Get-BoxPowerShell
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $ShowBotLogPath) { $ShowBotLogPath = Join-Path $Here 'scripts\vps\Show-BotLog.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

# ---- 1. it parses, and the script it sends is safe to expand ------------------
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ShowBotLogPath, [ref]$tokens, [ref]$errors)
Yes 'Show-BotLog.ps1 parses' (@($errors).Count -eq 0)
$assign = @($ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $n.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
    $n.Left.VariablePath.UserPath -eq 'script' -and
    $n.Right.Expression -is [System.Management.Automation.Language.ExpandableStringExpressionAst]
}, $true))
Yes 'it builds one script to send' ($assign.Count -eq 1)
if ($assign.Count -ne 1) { Done }
$block = $assign[0].Right.Expression

# Expanding a block runs whatever it nests, on this machine. So it is expanded
# only when every name in it is one of the three this harness sets.
$strays = @()
foreach ($x in $block.NestedExpressions) {
    $ok = ($x -is [System.Management.Automation.Language.VariableExpressionAst]) -and
          (@('rootWin', 'filter', 'Lines') -contains $x.VariablePath.UserPath)
    if (-not $ok) { $strays += ('line {0}: {1}' -f $x.Extent.StartLineNumber, $x.Extent.Text) }
}
Yes ('and it fills in only rootWin, filter and Lines' +
     $(if ($strays.Count) { "`n      " + ($strays -join "`n      ") } else { '' })) ($strays.Count -eq 0)
if ($strays.Count) { Done }

# The filter Show-BotLog uses without -All, read out of the script itself so a
# change to it is what gets tested.
$own = @($ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
    $n.Value.StartsWith('^\s*\[')
}, $true))
Yes 'its filter for the bot''s own lines is there to read' ($own.Count -eq 1)
if ($own.Count -ne 1) { Done }
$botOnly = $own[0].Value

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-show-botlog-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
if ($work.Contains("'")) {
    Write-Host "SKIP  the temp folder has a quote in it, and the script puts the folder in single quotes: $work"
    Done
}
$null = New-Item -ItemType Directory -Force -Path $work
try {
    # One folder per case, so nothing is deleted between reads. A file written
    # a moment ago can be held by a virus scanner, and a delete refused then
    # left a bot.log.1 behind once on 24 September.
    $script:case = 0
    # Untyped, because a [string] parameter turns $null into an empty string
    # and "no bot.log.1" would become an empty one.
    function NewCase($one, $current) {
        $script:case++
        $dir = Join-Path $work ('case' + $script:case)
        $null = New-Item -ItemType Directory -Force -Path $dir
        $utf8 = New-Object Text.UTF8Encoding($false)
        if ($null -ne $one) { [IO.File]::WriteAllText((Join-Path $dir 'bot.log.1'), $one, $utf8) }
        if ($null -ne $current) { [IO.File]::WriteAllText((Join-Path $dir 'bot.log'), $current, $utf8) }
        return $dir
    }
    # The script expanded the way Show-BotLog expands it and run the way the
    # VPS runs it.
    function ShowBotLog([string]$dir, [string]$filterFor, [int]$count) {
        $rootWin = $dir
        $filter = $filterFor
        $Lines = $count
        $s = & ([scriptblock]::Create($block.Extent.Text))
        $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($s))
        return @(& $boxPs -NoProfile -EncodedCommand $enc 2>&1 | ForEach-Object { "$_" })
    }
    # Up to three reads before it counts as a failure, for the same scanner.
    # Code that does not read bot.log.1 fails all three.
    function ShowUntil([string]$dir, [string]$filterFor, [int]$count, [string]$want) {
        $out = @()
        foreach ($try in 1..3) {
            $out = @(ShowBotLog $dir $filterFor $count)
            if (@($out | Where-Object { $_.Contains($want) }).Count) { break }
            Start-Sleep -Milliseconds 300
        }
        return $out
    }
    function At([string[]]$out, [string]$what) {
        for ($i = 0; $i -lt $out.Count; $i++) { if ($out[$i].Contains($what)) { return $i } }
        return -1
    }
    function Show([string[]]$out) { $out | ForEach-Object { Write-Host "      $_" } }

    $one = '[thornswood-bot] the reason the last run ended' + "`r`n" +
           'discord.py noise from before the roll' + "`r`n"
    $current = '[thornswood-bot] up again' + "`r`n" +
               'discord.py noise from this run' + "`r`n"

    # ---- 2 and 3. bot.log.1, then bot.log, the bot's lines only -----------------
    $dir = NewCase $one $current
    $out = @(ShowUntil $dir $botOnly 40 'the reason the last run ended')
    $a = At $out 'the reason the last run ended'
    $b = At $out 'up again'
    Yes 'Show-BotLog shows the lines in bot.log.1' ($a -ge 0)
    Yes 'and the ones in bot.log, after them' ($b -gt $a -and $a -ge 0)
    Yes 'and still leaves out what the bot did not say itself, in both files' (
        (At $out 'discord.py noise') -lt 0)
    Yes 'and says nothing about a file it could not find' (@($out | Where-Object { $_ -match 'cannot find|does not exist' }).Count -eq 0)
    if ($a -lt 0 -or $b -le $a) { Show $out }

    $out = @(ShowUntil $dir '.' 40 'noise from before the roll')
    $a = At $out 'noise from before the roll'
    $b = At $out 'noise from this run'
    Yes 'with -All, the rest of bot.log.1 comes through as well, before bot.log''s' ($a -ge 0 -and $b -gt $a)
    if ($a -lt 0 -or $b -le $a) { Show $out }

    # ---- 4. -Lines counts across both, newest kept ------------------------------
    $dir = NewCase ('[thornswood-bot] OLD-1' + "`r`n" + '[thornswood-bot] OLD-2' + "`r`n") (
                    '[thornswood-bot] NEW-1' + "`r`n" + '[thornswood-bot] NEW-2' + "`r`n")
    $out = @(ShowUntil $dir $botOnly 3 'OLD-2')
    $said = @($out | Where-Object { $_ -match '^\s*\[thornswood-bot\]' })
    Yes ('-Lines 3 shows the last three across both files, in order ({0})' -f ($said -join ' / ')) (
        $said.Count -eq 3 -and $said[0].Contains('OLD-2') -and $said[1].Contains('NEW-1') -and $said[2].Contains('NEW-2'))

    # ---- 5. no bot.log.1, bot.log as before ------------------------------------
    $dir = NewCase $null $current
    $out = @(ShowUntil $dir $botOnly 40 'up again')
    Yes 'with no bot.log.1, it shows bot.log as before' ((At $out 'up again') -ge 0)
    Yes 'and no error for the file that is not there' (@($out | Where-Object { $_ -match 'cannot find|does not exist' }).Count -eq 0)
    if ((At $out 'up again') -lt 0) { Show $out }

    # ---- 6. no bot.log at all -------------------------------------------------------
    $dir = NewCase $null $null
    $out = @(ShowBotLog $dir $botOnly 40)
    Yes 'with no bot.log, it still says there is none' ((At $out 'there is no bot.log on the VPS yet') -ge 0)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

Done
