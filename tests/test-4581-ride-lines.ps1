<#
  test-4581-ride-lines.ps1

      pwsh -NoProfile -File .\tests\test-4581-ride-lines.ps1

  WHY THIS EXISTS. Issue #4581. E on a carriage or ferry driver opens no
  panel, and the server logs nothing for a press. scripts\vps\Read-RideLines.ps1
  reads, through the gate, the two places on the box that do hold a press:
  the voice services' chat logs, which keep every "/ride e" and "/merchant e"
  line they took, and the session log sets the launcher sends at game close,
  whose front log says what the plugin did with the press.

  What it checks:
    1. the reader's words are the others': thornswood-front.js writes
       "[front] <clock> " before each line, and writes the drivers, press,
       page, focus and error lines in the shapes the reader reads; it sends
       "/ride e <id>" and "/merchant e <id>"; the voice service writes a chat
       log entry as JSON with at, kind, text and via; the gate takes the verb
       with -Days alone and as one that only reads;
    2. the reader, run against chat logs and session log sets made here: it
       prints the /ride and /merchant e commands in the window with their
       time, server and how they came, and none of the rest; it prints a
       set's driver lines in order and none of the rest of the log; it leaves
       out a set written before the window and a set with no driver lines;
       it counts a set that will not read and goes on; it prints no account,
       name, profile or session key; it says so when nothing reached the box;
       and it stops when the session log folder is not there.

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

$reader = Join-Path $repo 'scripts/vps/Read-RideLines.ps1'
$readerText = [IO.File]::ReadAllText($reader)

# ---- 1. the words ---------------------------------------------------------------------
Write-Host 'the words'
$front = [IO.File]::ReadAllText((Join-Path $repo 'game/plugins/thornswood-front.js'))
$voice = [IO.File]::ReadAllText((Join-Path $repo 'voice/voice-server.js'))
Yes 'every front log line starts "[front] <clock> "' ($front.Contains("const line = '[front] ' + clock() + ' ' +"))
Yes 'the plugin says how many drivers it found, or none' ($front.Contains("say('carriage and ferry drivers: ' + found + ' of '") -and
    $front.Contains("say('carriage and ferry drivers: none of '"))
Yes 'a press says it asked the server' ($front.Contains("say('asked the server where driver ' + hex + ' goes');"))
Yes 'the page coming in is "the ride panel is in"' ($front.Contains("log('the ride panel is in')"))
Yes 'the panel taking the keyboard is "focus claimed by ride"' ($front.Contains("T.claimFocus('ride', true)") -and
    $front.Contains("say('focus ' + (on ? 'claimed by ' : 'released by ') + who +"))
Yes 'a handler error is "<name> threw:"' ($front.Contains("log(name, 'threw:',") -and $front.Contains("guard('keys',") -and
    $front.Contains("guard('ride panel waits',") -and $front.Contains("guard('ride panel opens',") -and $front.Contains("guard('ride distance',"))
Yes 'E sends "/ride e <id>" first and "/merchant e <id>" for any other person' ($front.Contains("tellServer('/ride e ' + hex);") -and
    $front.Contains("tellServer('/merchant e ' + hex);") -and $front.IndexOf('if (driverPress(e)) return;') -lt $front.IndexOf('if (merchantPress(e)) return;'))
Yes 'the chat log entry is JSON with at, kind, text and via press' ($voice.Contains('at: at,') -and $voice.Contains("kind: kind,") -and
    $voice.Contains('text: text') -and $voice.Contains("if (via === 'press') entry.via = 'press';") -and $voice.Contains("chatWrite('command', myId, me, logged, press ? 'press' : '');"))
Yes 'the chat logs are the voice services'' chat folders' ($voice.Contains("path.join(HERE, 'chat')") -and
    $readerText.Contains("'C:\Thornswood-Voice\chat,C:\Thornswood-Voice-Dev\chat'"))
$verbs = [IO.File]::ReadAllText((Join-Path $repo 'scripts/vps/gate/verbs.json')) | ConvertFrom-Json
$verb = $verbs.verbs.PSObject.Properties['Read-RideLines']
Yes 'the gate runs it as a verb that only reads, with -Days alone' ($null -ne $verb -and $verb.Value.script -eq 'scripts/vps/Read-RideLines.ps1' -and
    $verb.Value.onlyReads -eq $true -and @($verb.Value.params.PSObject.Properties.Name) -join ',' -eq 'Days')

# ---- 2. the reader --------------------------------------------------------------------
Write-Host ''; Write-Host ('the reader, in ' + $PSVersionTable.PSEdition + ' ' + $PSVersionTable.PSVersion)
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4581-' + [guid]::NewGuid().ToString('N'))
$sets = Join-Path $tmp 'session-logs'
$main = Join-Path $tmp 'voice-chat'
$dev = Join-Path $tmp 'voice-dev-chat'
New-Item -ItemType Directory -Path $sets, $main, $dev | Out-Null
try {
    function Set-Logs([string]$name, [string]$who, [hashtable]$logs, [int]$hoursAgo) {
        $file = Join-Path $sets ($name + '.json')
        [IO.File]::WriteAllText($file, (@{ who = $who; logs = $logs } | ConvertTo-Json -Depth 4))
        (Get-Item -LiteralPath $file).LastWriteTime = (Get-Date).AddHours(-$hoursAgo)
    }
    function Entry([long]$at, [string]$kind, [string]$text, [bool]$press) {
        $e = [ordered]@{ at = $at; kind = $kind; peer = 7; profileId = 1992045742; name = 'Secret Name'; proven = $true; mode = 'play'; text = $text }
        if ($press) { $e.via = 'press' }
        return ($e | ConvertTo-Json -Compress)
    }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $hour = 3600000L
    $old = $now - 30L * 24L * $hour
    [IO.File]::WriteAllText((Join-Path $main 'today.jsonl'), ((@(
        (Entry ($now - 2 * $hour) 'command' '/ride e 1bbbf6d' $true),
        (Entry ($now - 2 * $hour + 1000) 'say' 'where is the ride' $false),
        (Entry ($now - 2 * $hour + 2000) 'command' '/merchant e 1bbbf6e' $true),
        (Entry ($now - 2 * $hour + 3000) 'command' '/lock' $true),
        (Entry ($now - 2 * $hour + 4000) 'command' '/ride Riften' $true),
        '{ not json',
        (Entry $old 'command' '/ride e 1bbbf00' $true)
    ) -join "`n") + "`n"))
    [IO.File]::WriteAllText((Join-Path $dev 'today.jsonl'), (Entry ($now - $hour) 'command' '/ride e 1b14c6d' $false) + "`n")

    $drivers = '[front] 20:10:01.000 carriage and ferry drivers: 27 of 27 bases found'
    $asked = '[front] 20:10:01.010 asked the server where driver 1bbbf6d goes'
    $page = '[front] 20:09:00.000 the ride panel is in'
    $arrived = '[front] 20:10:01.300 the server sent the ride panel for driver 1bbbf6d'
    $waits = '[front] 20:10:01.310 the ride panel waits for the Dialogue Menu to close'
    $claimed = '[front] 20:10:03.000 focus claimed by ride (holding: ride)'
    $released = '[front] 20:10:09.000 focus released by ride (holding: nobody)'
    $threw = '[front] 20:10:05.000 ride panel opens threw: TypeError: x is undefined'
    Set-Logs 'key-one-secret' 'Someone Secret' @{
        'thornswood-front.log' = ($page + "`n[front] 20:09:30.000 door: Whiterun`n" + $drivers + "`n" + $asked + "`n" + $arrived + "`n" + $waits + "`n" + $claimed + "`n" + $threw + "`n[front] 20:10:08.000 focus claimed by journal (holding: ride, journal)`n" + $released)
        'launcher.log' = '2026-11-26 20:08:33  Starting the game on launcher 1.3.128, game files of build-1.3.128, borderless.'
        'skyrim-platform.log' = '[20:10:01:000] asked the server where driver not this log'
    } 2
    Set-Logs 'key-old' 'Old Person' @{ 'thornswood-front.log' = $asked } (24 * 30)
    Set-Logs 'key-page' 'Page Person' @{ 'thornswood-front.log' = $page } 3
    [IO.File]::WriteAllText((Join-Path $sets 'key-broken.json'), '{ not json')

    $out = (& pwsh -NoProfile -File $reader -Folder $sets -Chat ($main + ',' + $dev) -Days 7 2>&1 | Out-String)
    $code = $LASTEXITCODE
    Yes 'it exits 0' ($code -eq 0)
    Yes 'it prints the /ride and /merchant e commands in the window' ($out.Contains('/ride e 1bbbf6d') -and $out.Contains('/merchant e 1bbbf6e') -and
        $out.Contains('/ride Riften') -and $out.Contains('/ride e 1b14c6d'))
    Yes '  with which server''s chat and how each came' ($out -match 'Main\s+press\s+/ride e 1bbbf6d' -and $out -match 'Dev\s+typed\s+/ride e 1b14c6d')
    Yes '  and their time in UTC' ($out -match '\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\s+Main\s+press\s+/ride e 1bbbf6d')
    Yes '  and none of the other lines, nor one from before the window' (-not $out.Contains('/lock') -and -not $out.Contains('where is the ride') -and -not $out.Contains('1bbbf00'))
    Yes 'it prints the driver lines of the set' ($out.Contains($drivers) -and $out.Contains($asked) -and $out.Contains($page) -and
        $out.Contains($arrived) -and $out.Contains($waits) -and $out.Contains($claimed) -and $out.Contains($threw) -and $out.Contains($released))
    Yes '  in the order the log has them' ($out.IndexOf($page) -lt $out.IndexOf($drivers) -and $out.IndexOf($drivers) -lt $out.IndexOf($asked) -and
        $out.IndexOf($asked) -lt $out.IndexOf($arrived) -and $out.IndexOf($arrived) -lt $out.IndexOf($waits) -and $out.IndexOf($waits) -lt $out.IndexOf($claimed) -and $out.IndexOf($claimed) -lt $out.IndexOf($threw) -and $out.IndexOf($threw) -lt $out.IndexOf($released))
    Yes '  and leaves out the rest of the log, and the other logs' (-not $out.Contains('door: Whiterun') -and -not $out.Contains('claimed by journal') -and
        -not $out.Contains('not this log'))
    Yes 'it names the launcher the set ran on' ($out.Contains('on launcher 1.3.128'))
    Yes 'it leaves out a set written before the window and one with only the page line' (([regex]::Matches($out, '(?m)^Session \d+,')).Count -eq 1)
    Yes 'it counts the lines, the sets read and the one that would not read' ($out.Contains('3 /ride line(s) and 1 /merchant e line(s) in the chat logs; 2 session log sets read, 1 that would not read, 1 with driver lines'))
    Yes 'it prints no account, name, profile or session key' (-not $out.Contains('Secret') -and -not $out.Contains('key-one') -and
        -not $out.Contains('Person') -and -not $out.Contains('1992045742'))

    Remove-Item -LiteralPath (Join-Path $sets 'key-one-secret.json'), (Join-Path $main 'today.jsonl'), (Join-Path $dev 'today.jsonl')
    $none = (& pwsh -NoProfile -File $reader -Folder $sets -Chat ($main + ',' + (Join-Path $tmp 'no-dev-chat')) -Days 7 2>&1 | Out-String)
    Yes 'it says so when nothing reached the box' ($LASTEXITCODE -eq 0 -and $none.Contains('No press on a driver reached the box in the window'))
    Yes '  and names a chat folder that is not there' ($none.Contains('Dev: no ') -and $none.Contains('no-dev-chat'))

    $missing = (& pwsh -NoProfile -File $reader -Folder (Join-Path $tmp 'not-there') -Chat $main 2>&1 | Out-String)
    Yes 'it stops when the session log folder is not there' ($LASTEXITCODE -eq 1 -and $missing.Contains('STOP.'))
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Done
