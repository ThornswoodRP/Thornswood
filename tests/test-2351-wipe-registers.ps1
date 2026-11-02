<#
  test-2351-wipe-registers.ps1

      pwsh -NoProfile -File .\tests\test-2351-wipe-registers.ps1

  Issue #2351: scripts\ops\Wipe-Saves.ps1 moved only the world, the character
  cards, property.json and farm-claims.json, and left every newer register
  the gamemode keeps naming characters that no longer exist after a wipe:
  the offices in law.json, the beds, the embassy rolls (by form id, which
  the new world hands to new characters), the books, when each character
  last left, the take counts, the dungeon chests' record, and a list of
  deleted characters the server had not let go of yet.

  Wipe-Saves runs its steps on the VPS over ssh. This lifts the three it
  sends (the survey, the stop and the move) out of the real script, fills
  them in as the script does, and runs each under PowerShell 7, which is
  what runs them there since #5356, against a stand-in server folder in a
  scratch folder:

    - the list of what moves names every register that names a character,
      and leaves the mod menu choices and the merchant ledger
    - the survey counts the characters in characters.json, and only there
    - the move puts each one aside under its own name with the date, the
      dungeon ledger's mark included, and touches nothing else
    - the stop ends a process running from a server folder and says
      stopped, and the script stops with nothing moved while one still runs

  Nothing leaves this machine. The one process it starts is a node that
  waits, and it is ended before this finishes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$Script = Join-Path $Repo 'scripts\ops\Wipe-Saves.ps1'

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

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$tokens, [ref]$errors)
Yes 'Wipe-Saves.ps1 parses' ($errors.Count -eq 0)
$text = [IO.File]::ReadAllText($Script)

# ---- what moves ----------------------------------------------------------------
$assign = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($n.Left)" -eq '$Moves' }, $true))
Yes 'there is one list of what moves, $Moves' ($assign.Count -eq 1)
$Moves = @()
if ($assign.Count -eq 1) { $Moves = @(& ([scriptblock]::Create($assign[0].Right.Extent.Text))) }
foreach ($n in 'world', 'private\characters.json', 'private\property.json', 'private\farm-claims.json',
               'private\law.json', 'private\beds.json', 'private\embassy.json', 'private\books.json',
               'private\last-left.json', 'private\take-limit.json', 'private\trade-cargo.json', 'private\market-stalls.json', 'private\trade-carts.json',
               'private\dungeon-rewards-ledger.json', 'private\dungeon-rewards-ledger.initialized', 'private\deleted-characters.json') {
    Yes "  it moves $n" ($Moves -contains $n)
}
Yes '  and leaves the mod menu choices and the merchant ledger' (-not ($Moves -contains 'private\mod-settings.json') -and -not ($Moves -contains 'private\merchant-ledger.json'))
Yes 'the survey and the move both read that list, and no second copy of it is written out' (
    ([regex]::Matches($text, '@\(\$movesLit\)')).Count -eq 2 -and ([regex]::Matches($text, "'world', 'private")).Count -eq 1)

# ---- the three steps it sends, as it fills them in --------------------------------
function Body([string]$after) {
    $at = $text.IndexOf($after)
    if ($at -lt 0) { return $null }
    $open = $text.IndexOf('Remote @"', $at)
    $start = $text.IndexOf("`n", $open) + 1
    $end = $text.IndexOf("`n" + '"@', $start)
    if ($open -lt 0 -or $end -lt 0) { return $null }
    return $text.Substring($start, $end - $start)
}
$survey = Body "Head 'What would go'"
$stop = Body "Head 'Stopping the servers'"
$move = Body "Head 'Moving the old storage aside'"
Yes 'the survey, the stop and the move are found in the script' ($survey -and $stop -and $move)

. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell

$T = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2351-wipe-' + [Guid]::NewGuid().ToString('N'))
$Root = Join-Path $T 'Thornswood-Server'
$waiter = $null
function Put([string]$path, [string]$body) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $body)
}
function Lit($a) { return (($a | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ',') }
# Filled in the way the script fills them: its own variables, expanded.
# The move sends the release list's writer too (#2668), so it is loaded here
# as the script loads it, with the parts a wipe marks done.
. (Join-Path $Repo 'scripts\ops\Release-List.ps1')
# The stop and the start send the watchdog's hold too (#5155), loaded the
# same way, its folder a scratch one that is never made, so no hold is written.
. (Join-Path $Repo 'scripts\vps\ServerHold.ps1')
$ThornswoodHoldRoot = Join-Path $T 'no-watchdog-here'
$wd = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and "$($n.Left)" -eq '$WipeDone' }, $true))
$WipeDone = @()
if ($wd.Count -eq 1) { $WipeDone = @(& ([scriptblock]::Create($wd[0].Right.Extent.Text))) }
function Fill([string]$body, [string]$stamp) {
    $rootsLit = Lit @($Root)
    $movesLit = Lit $Moves
    $wipeDoneLit = Lit $WipeDone
    $tasksLit = ''
    $stamp = $stamp
    return $ExecutionContext.InvokeCommand.ExpandString($body)
}
function RunBox([string]$body) {
    $f = Join-Path $T ('step-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, $body)
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { return @(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $f 2>&1 | ForEach-Object { "$_" }) }
    finally { $ErrorActionPreference = $eap; Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
}

try {
    Put (Join-Path $Root 'server-settings.json') '{}'
    Put (Join-Path $Root 'world\changeForms\ff000a01.json') '{"formDesc":"a01","profileId":5001}'
    # A character's change form is named by its slot number (0.json); the new release list names it (#2668).
    Put (Join-Path $Root 'world\changeForms\0.json') '{"formDesc":"a01","profileId":5001}'
    Put (Join-Path $Root 'private\characters.json') '{"who":{"5001":{"name":"A"},"6001":{"name":"B"},"7001":{"name":"C"}}}'
    foreach ($f in 'property.json', 'farm-claims.json', 'law.json', 'beds.json', 'embassy.json', 'books.json', 'last-left.json',
                   'take-limit.json', 'trade-cargo.json', 'market-stalls.json', 'trade-carts.json', 'dungeon-rewards-ledger.json', 'deleted-characters.json', 'mod-settings.json', 'merchant-ledger.json',
                   'season.json', 'benches.json', 'door.json', 'war.json', 'company-terms.json') {
        Put (Join-Path $Root "private\$f") ('{"file":"' + $f + '"}')
    }
    Put (Join-Path $Root 'private\dungeon-rewards-ledger.initialized') '1'
    Put (Join-Path $Root 'private\merchant-ledger.initialized') '1'

    # ---- the survey
    # The survey finds server folders under C:\ on the box; here, under the scratch folder.
    $out = RunBox ((Fill $survey '').Replace("Get-ChildItem 'C:\'", "Get-ChildItem '" + $T + "'"))
    Yes 'the survey names the server folder' (@($out | Where-Object { $_ -eq ('ROOT|' + $Root) }).Count -eq 1)
    $chars = @($out | Where-Object { $_ -like 'CHARS|*' })
    Yes ('the survey counts the 3 characters in characters.json, and only there (' + ($chars -join ' ') + ')') ($chars.Count -eq 1 -and $chars[0] -eq 'CHARS|3')
    $items = @($out | Where-Object { $_ -like 'ITEM|*' })
    Yes ('the survey lists the 16 things there that would go (' + $items.Count + ')') ($items.Count -eq 16 -and @($out | Where-Object { $_ -like '*|data\*' }).Count -eq 0)

    # ---- the stop, with a process running from the folder
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if ($OnWindows -and $node) {
        $hold = Join-Path $Root 'hold.js'
        Put $hold 'setTimeout(function () {}, 120000);'
        $waiter = Start-Process -FilePath $node.Source -ArgumentList ('"' + $hold + '"') -PassThru -WindowStyle Hidden
        # Until Windows shows its command line, five seconds at most.
        for ($i = 0; $i -lt 50; $i++) {
            $seen = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $waiter.Id) -ErrorAction SilentlyContinue
            if ($seen -and $seen.CommandLine) { break }
            Start-Sleep -Milliseconds 100
        }
        $out = RunBox (Fill $stop '')
        Yes ('the stop ends what runs from a server folder and says stopped (' + ($out -join ' / ') + ')') (
            @($out | Where-Object { $_ -eq ('ended process ' + $waiter.Id) }).Count -eq 1 -and ($out -contains 'stopped'))
        Yes '  and that process is gone' ($null -eq (Get-Process -Id $waiter.Id -ErrorAction SilentlyContinue))
    } elseif (-not $OnWindows) { Write-Host 'SKIP  the stop: it finds the server through Win32_Process, which only Windows has' }
    else { Write-Host 'SKIP  the stop needs node to stand in for the server' }
    Yes 'the script stops with nothing moved while a server is still running, and takes its holds away first (#5155)' (
        $text -match "(?s)if \(\`$running\) \{.{0,400}?Clear-ThornswoodHold.{0,300}?Die 'A server is still running, so nothing was moved\." -and
        $text.IndexOf("if (`$running) {") -lt $text.IndexOf("Head 'Moving the old storage aside'"))
    Yes 'and no longer sleeps and looks for the server by the program''s path' ($text -notmatch "Start-Sleep -Seconds 3" -and $text -notmatch "Path\)`" -like '\*Thornswood-Server\*'")

    # ---- the move
    $stamp = '20261017-0100'
    $out = RunBox (Fill $move $stamp)
    Yes 'the move says nothing failed' (@($out | Where-Object { $_ -like 'FAILED*' }).Count -eq 0 -and @($out | Where-Object { $_ -like 'moved*' }).Count -eq 16)
    $P = Join-Path $Root 'private'
    Yes 'the world goes aside as world-before-<date>' ((Test-Path (Join-Path $Root "world-before-$stamp\changeForms\ff000a01.json")) -and -not (Test-Path (Join-Path $Root 'world')))
    $ok = $true
    foreach ($f in 'characters', 'property', 'farm-claims', 'law', 'beds', 'embassy', 'books', 'last-left', 'take-limit', 'trade-cargo', 'market-stalls', 'trade-carts', 'dungeon-rewards-ledger') {
        if (-not (Test-Path (Join-Path $P "$f-before-$stamp.json")) -or (Test-Path (Join-Path $P "$f.json"))) { $ok = $false; Write-Host "      not moved: $f.json" }
    }
    Yes 'every register naming a character goes aside under its own name with the date' $ok
    # The waiting list goes aside as it was, and a new one names the wiped
    # character by form id (#2668; test-2668-reset-wipe-release.ps1 has the rest).
    $newList = Join-Path $P 'deleted-characters.json'
    Yes 'the waiting list goes aside as it was, and the new release list names the wiped character' (
        (Test-Path (Join-Path $P "deleted-characters-before-$stamp.json")) -and
        [IO.File]::ReadAllText((Join-Path $P "deleted-characters-before-$stamp.json")) -eq '{"file":"deleted-characters.json"}' -and
        (Test-Path $newList) -and ([IO.File]::ReadAllText($newList) -like '{"profiles":`[`],"actors":`[4278192641`],"done":{*'))
    Yes 'the dungeon ledger''s mark goes with it under its own name, so the next start makes a fresh ledger' (
        (Test-Path (Join-Path $P "dungeon-rewards-ledger.initialized-before-$stamp")) -and -not (Test-Path (Join-Path $P 'dungeon-rewards-ledger.initialized')))
    $kept = $true
    foreach ($f in 'mod-settings.json', 'merchant-ledger.json', 'merchant-ledger.initialized', 'season.json', 'benches.json', 'door.json',
                   'war.json', 'company-terms.json') {
        if (-not (Test-Path (Join-Path $P $f))) { $kept = $false; Write-Host "      gone: $f" }
    }
    Yes 'the mod menu choices, the merchant ledger and its mark, the season, the benches, the door, the world stage and the company''s terms stay' $kept
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message) $false
}
finally {
    if ($waiter -and -not $waiter.HasExited) { Stop-Process -Id $waiter.Id -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
}
Done
