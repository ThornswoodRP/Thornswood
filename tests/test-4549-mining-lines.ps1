<#
  test-4549-mining-lines.ps1

      pwsh -NoProfile -File .\tests\test-4549-mining-lines.ps1

  WHY THIS EXISTS. Issue #4549. After a mining spell the character can be
  left unable to jump, sprint or use a forge until the pickaxe is put on and
  taken off. thornswood-front.js writes the character's state and the
  animation events around the end of a spell (#2244), those lines reach the
  box in each session's log set, and scripts\vps\Read-MiningLines.ps1 reads
  them there for a cloud thread through the gate.

  What it checks:
    1. the reader's words are the front log's: thornswood-front.js writes
       "[front] <clock> " before each line, and writes the swing's lines,
       the state after a spell, the events after it and the hands line in
       the shapes the reader reads;
    2. the reader, run against session log sets made here: it prints a set's
       mining, after-mining and hands lines in order and none of the rest of
       it, leaves out a set written before the window, a set with none of
       them and a set with only hands lines, counts a set that will not read
       and goes on, prints no account or session key, says so when there are
       no lines, and stops when the folder is not there.

  Nothing connects anywhere. Everything it writes is in its own temp folder.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

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

$reader = Join-Path $repo 'scripts/vps/Read-MiningLines.ps1'
$readerText = [IO.File]::ReadAllText($reader)

# ---- 1. the words ---------------------------------------------------------------------
Write-Host 'the words'
$front = [IO.File]::ReadAllText((Join-Path $repo 'game/plugins/thornswood-front.js'))
Yes 'every front log line starts "[front] <clock> "' ($front.Contains("const line = '[front] ' + clock() + ' ' +"))
Yes 'the swing writes "mining: " lines' ($front.Contains("say('mining: swing started on ' + name);") -and
    $front.Contains("say('mining: swing ended on ' + name + ', '") -and $front.Contains("say('mining: ' + name + ' arrived '"))
Yes 'the state after a spell is "after mining, <when>: "' ($front.Contains("say('after mining, ' + label + ': ' + parts.join(', '));"))
Yes 'the events after it are "after mining: <event> sent"' ($front.Contains("say('after mining: ' + name + ' sent '"))
Yes 'the hands line is "hands at <event>: "' ($front.Contains("say('hands at ' + eventName + ': ' + ["))
Yes 'the reader names where its words come from' ($readerText.Contains('thornswood-front.js''s words (watchTheSwing, afterLine'))

# ---- 2. the reader --------------------------------------------------------------------
Write-Host ''; Write-Host ('the reader, in ' + $PSVersionTable.PSEdition + ' ' + $PSVersionTable.PSVersion)
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4549-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    function Set-Logs([string]$name, [string]$who, [hashtable]$logs, [int]$hoursAgo) {
        $file = Join-Path $tmp ($name + '.json')
        [IO.File]::WriteAllText($file, (@{ who = $who; logs = $logs } | ConvertTo-Json -Depth 4))
        (Get-Item -LiteralPath $file).LastWriteTime = (Get-Date).AddHours(-$hoursAgo)
    }
    $hands = '[front] 20:11:02.100 hands at WeaponDraw: right weapon 000e3c16 (Pickaxe), left weapon none, right object 000e3c16 (Pickaxe), left object none, right type 6, left type 0, iRightHandType 6, iLeftHandType 0, weapon out yes'
    $started = '[front] 20:11:05.410 mining: swing started on IdlePickaxeEnter'
    $arrived = '[front] 20:11:05.900 mining: SoundPlay.NPCHumanPickaxe arrived 490ms into the swing'
    $ended = '[front] 20:11:12.020 mining: swing ended on IdleChairExitStart, 6610ms in'
    $atEnd = '[front] 20:11:12.030 after mining, at the end (IdleChairExitStart): sit 0, sleep 0, weapon out no, right type 0, left type 0, bAnimationDriven 1, bInJumpState 0, iState 0, Speed 0'
    $sent = '[front] 20:11:12.040 after mining: IdleForceDefaultState sent 10ms after the end'
    $later = '[front] 20:11:15.030 after mining, 3 s later: sit 0, sleep 0, weapon out no, right type 0, left type 0, bAnimationDriven 1, bInJumpState 0, iState 0, Speed 0'
    Set-Logs 'key-one-secret' 'Someone Secret' @{
        'thornswood-front.log' = ("[front] 20:10:00.000 choice page: ready 2 slots`n" + $hands + "`n" + $started + "`n" + $arrived + "`n[front] 20:11:08.000 door: Riverwood`n" + $ended + "`n" + $atEnd + "`n" + $sent + "`n" + $later)
        'launcher.log' = '2026-11-24 20:09:33  Starting the game on launcher 1.3.126, game files of build-1.3.126, borderless.'
        'skyrim-platform.log' = '[20:11:12:000] mining: not this log'
    } 2
    Set-Logs 'key-old' 'Old Person' @{ 'thornswood-front.log' = $started } (24 * 30)
    Set-Logs 'key-quiet' 'Quiet Person' @{ 'thornswood-front.log' = '[front] 09:00:00.000 choice page: ready 2 slots' } 3
    Set-Logs 'key-draws' 'Draw Person' @{ 'thornswood-front.log' = $hands } 4
    [IO.File]::WriteAllText((Join-Path $tmp 'key-broken.json'), '{ not json')

    $out = (& pwsh -NoProfile -File $reader -Folder $tmp -Days 7 2>&1 | Out-String)
    $code = $LASTEXITCODE
    Yes 'it exits 0' ($code -eq 0)
    Yes 'it prints the hands, swing and after-mining lines of the set' ($out.Contains($hands) -and $out.Contains($started) -and $out.Contains($arrived) -and
        $out.Contains($ended) -and $out.Contains($atEnd) -and $out.Contains($sent) -and $out.Contains($later))
    Yes '  in the order the log has them' ($out.IndexOf($hands) -lt $out.IndexOf($started) -and $out.IndexOf($started) -lt $out.IndexOf($arrived) -and
        $out.IndexOf($arrived) -lt $out.IndexOf($ended) -and $out.IndexOf($ended) -lt $out.IndexOf($atEnd) -and $out.IndexOf($atEnd) -lt $out.IndexOf($sent) -and
        $out.IndexOf($sent) -lt $out.IndexOf($later))
    Yes '  and leaves out the rest of the log, and the other logs' (-not $out.Contains('ready 2 slots') -and -not $out.Contains('door: Riverwood') -and -not $out.Contains('not this log'))
    Yes 'it names the launcher the set ran on' ($out.Contains('on launcher 1.3.126'))
    Yes 'it leaves out a set written before the window, one with no lines and one with only draws' (([regex]::Matches($out, '(?m)^Session \d+,')).Count -eq 1)
    Yes 'it counts the sets read and the one that would not read' ($out.Contains('3 session log sets read, 1 that would not read, 1 with mining lines'))
    Yes 'it prints no account or session key' (-not $out.Contains('Secret') -and -not $out.Contains('key-one') -and -not $out.Contains('Person'))

    Remove-Item -LiteralPath (Join-Path $tmp 'key-one-secret.json')
    $none = (& pwsh -NoProfile -File $reader -Folder $tmp -Days 7 2>&1 | Out-String)
    Yes 'it says so when there are no mining lines' ($LASTEXITCODE -eq 0 -and $none.Contains('No mining lines in the window'))

    $missing = (& pwsh -NoProfile -File $reader -Folder (Join-Path $tmp 'not-there') 2>&1 | Out-String)
    Yes 'it stops when the folder is not there' ($LASTEXITCODE -eq 1 -and $missing.Contains('STOP.'))
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Done
