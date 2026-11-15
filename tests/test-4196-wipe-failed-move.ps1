<#
  test-4196-wipe-failed-move.ps1

      pwsh -NoProfile -File .\tests\test-4196-wipe-failed-move.ps1

  Issue #4196. When a file would not move aside, scripts\ops\Wipe-Saves.ps1
  printed that the server was stopped, then went on to "Starting them
  again": every server came up on a half-moved world (characters gone, the
  other registers still the old world's), the hold came off, and the run
  ended as if it worked. Running it again as it said then moved that fresh
  world aside too.

  This lifts the script's last three steps (move, start, done) and runs
  them with a stand-in Remote that answers as the box does and records what
  each call would run there. It holds:

    1. a move with a FAILED line starts no server: nothing runs schtasks
       /run, and no hold is cleared, so the watchdog leaves them stopped too;
    2. it ends 1, saying how many moved and how many did not, with each
       moved and each failed line said as the box gave it;
    3. a move with no FAILED line still starts the servers and clears the
       holds, as before.

  Reads the script only. Connects to nothing.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$text = [IO.File]::ReadAllText((Join-Path $Repo ('scripts\ops\Wipe-Saves.ps1'.Replace('\', [IO.Path]::DirectorySeparatorChar)))).Replace("`r`n", "`n")
$tokens = $null; $errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
Yes 'Wipe-Saves.ps1 parses' (@($errors).Count -eq 0)
$from = $text.IndexOf("Head 'Moving the old storage aside'")
$to = $text.IndexOf("if (-not `$NoPause) { [void](Read-Host 'Enter to close') }")
Yes 'the move, the start and the end are in the script, in that order' ($from -ge 0 -and $to -gt $from -and $text.IndexOf("Head 'Starting them again'") -gt $from)
$tail = $text.Substring($from, $to - $from)

# Runs the tail. Each Remote call is recorded, and the first one (the move)
# answers with $moveSaid; the others answer nothing.
function Run-Tail([string[]]$moveSaid) {
    $sb = [scriptblock]::Create(@"
param(`$moveSaid)
`$calls = New-Object System.Collections.ArrayList
`$said = New-Object System.Collections.ArrayList
function Remote(`$s) { [void]`$calls.Add([string]`$s); if (`$calls.Count -eq 1) { return `$moveSaid } return @() }
function Say(`$m, `$c) { [void]`$said.Add([string]`$m) }
function Head(`$m) { [void]`$said.Add('## ' + `$m) }
function Die(`$m) { [void]`$said.Add('STOP. ' + `$m); throw 'DIED' }
function Get-ThornswoodHoldScript { param([string]`$Script) 'function Clear-ThornswoodHold {}' }
`$ThornswoodReleaseList = ''
`$rootsLit = "'C:\Thornswood-Server-Dev'"
`$tasksLit = "'Thornswood Dev Server'"
`$movesLit = "'world','private\characters.json'"
`$wipeDoneLit = "'farms'"
`$stamp = '20261113-0100'
`$died = `$false
try {
$tail
} catch { if ("`$(`$_.Exception.Message)" -ne 'DIED') { throw }; `$died = `$true }
return @{ calls = @(`$calls); said = @(`$said); died = `$died }
"@)
    return (& $sb $moveSaid)
}
function Started($r) { @($r.calls | Where-Object { $_ -match 'schtasks /run' }).Count -gt 0 }
function Cleared($r) { @($r.calls | Where-Object { $_ -match 'Clear-ThornswoodHold -Target' }).Count -gt 0 }

# ---- 1 and 2. a move that did not finish --------------------------------------
$half = Run-Tail @(
    'moved  C:\Thornswood-Server-Dev\world  ->  C:\Thornswood-Server-Dev\world-before-20261113-0100',
    'FAILED C:\Thornswood-Server-Dev\private\characters.json  The process cannot access the file because it is being used by another process.',
    'RELEASENOTE|C:\Thornswood-Server-Dev: no release list, because the move did not finish')
$all = ($half.said -join "`n")
Yes '1. a move that did not finish starts no server (no schtasks /run is sent)' (-not (Started $half))
Yes '   and takes no hold off, so the watchdog leaves them stopped too' (-not (Cleared $half))
Yes '   and never says it is starting them' ($all -notmatch '## Starting them again' -and $all -notmatch '## Done')
Yes '2. it ends 1 (Die)' ($half.died)
Yes '   saying how many moved and how many did not' ($all -match '1 moved aside and 1 not')
Yes '   with the moved line and the failed line as the box gave them' (
    $all -match 'moved  C:\\Thornswood-Server-Dev\\world  ->' -and $all -match 'FAILED C:\\Thornswood-Server-Dev\\private\\characters\.json')
Yes '   and never tells anyone to start it from the panel' ($all -notmatch 'from the panel')

# ---- 3. a move that finished ----------------------------------------------------
$whole = Run-Tail @(
    'moved  C:\Thornswood-Server-Dev\world  ->  C:\Thornswood-Server-Dev\world-before-20261113-0100',
    'moved  C:\Thornswood-Server-Dev\private\characters.json  ->  C:\Thornswood-Server-Dev\private\characters-before-20261113-0100.json',
    'RELEASE|none')
Yes '3. a move that finished still starts the servers' (Started $whole)
Yes '   and takes their holds off' (Cleared $whole)
Yes '   and ends without stopping' (-not $whole.died -and ($whole.said -join "`n") -match '## Done')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
