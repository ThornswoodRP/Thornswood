<#
  test-6723-trade-lines.ps1

      pwsh -NoProfile -File .\tests\test-6723-trade-lines.ps1

  WHY THIS EXISTS. Issue #6723. A trade on Main Playtest #6 duplicated gear,
  and the rest of a potion stack went when half was given away. The server
  writes every trade in its log, and the client writes in skyrim-platform.log
  what it did to put the pack right, but both are on the box, where a cloud
  thread cannot read them. scripts\vps\Read-TradeLines.ps1 reads them there,
  through the gate.

  What it checks:
    1. the reader's words are the others': trade.ts writes "[thornswood
       trade] A and B traded: <what> for <what>" and "HALF A TRADE: ... was
       not, trading <what> for <what>"; Server-Log.js stamps each line
       "[<UTC>Z]" and keeps server.log.<digits> beside server.log; the
       launcher sends skyrim-platform.log and launcher.log in a set; the
       client writes the pack lines the reader takes (read from engine\skymp
       when it is checked out, SKIP otherwise); the gate takes the verb with
       -Days alone and as one that only reads;
    2. the reader, run against server folders and session log sets made
       here: it prints each trade and half trade in the window with its time,
       server and what was given, and not the names; it leaves out a trade
       from before the window, a log that is not the server's and every other
       server line; it prints a set's pack lines in order and none of the rest
       of the log; it leaves out a set written before the window and a set
       with no pack lines; it counts a set that will not read and goes on; it
       prints no account, name, profile or session key; it says so when no
       trade reached the logs; and it stops when the session log folder is
       not there.

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

$reader = Join-Path $repo 'scripts/vps/Read-TradeLines.ps1'
$readerText = [IO.File]::ReadAllText($reader)

# ---- 1. the words ---------------------------------------------------------------------
Write-Host 'the words'
$trade = [IO.File]::ReadAllText((Join-Path $repo 'game/gamemode/trade.ts'))
$roller = [IO.File]::ReadAllText((Join-Path $repo 'scripts/vps/Server-Log.js'))
$discord = [IO.File]::ReadAllText((Join-Path $repo 'launcher/app/Discord.cs'))
Yes 'trade.ts writes its lines after "[thornswood trade]"' ($trade.Contains("var a = ['[thornswood trade]'];"))
Yes '  a trade as "A and B traded: <what> for <what>"' ($trade.Contains("tlog(nameOf(t.a), 'and', nameOf(t.b), 'traded:', whatA, 'for', whatB);"))
Yes '  and a half trade as "HALF A TRADE: ... was not, trading <what> for <what>"' ($trade.Contains("tlog('HALF A TRADE:', nameOf(got), 'was written and', nameOf(not), 'was not, trading', whatA, 'for', whatB);"))
Yes 'Server-Log.js stamps each line with its UTC time in brackets' ($roller.Contains('"[2026-11-01T08:25:00.000Z]"') -and $roller.Contains('return d.toISOString();'))
Yes '  and keeps server.log.<digits> beside server.log' ($roller.Contains("/^\d+$/.test(n.slice(base.length + 1))"))
Yes 'the launcher sends skyrim-platform.log and launcher.log in a set' ($discord.Contains('new string[] { "skyrim-platform.log",') -and $discord.Contains('new string[] { "launcher.log",'))
$inv = Join-Path $repo 'engine/skymp/skymp5-client/src/sync/inventory.ts'
$remote = Join-Path $repo 'engine/skymp/skymp5-client/src/services/services/remoteServer.ts'
if ((Test-Path -LiteralPath $inv) -and (Test-Path -LiteralPath $remote)) {
    $invText = [IO.File]::ReadAllText($inv)
    $remoteText = [IO.File]::ReadAllText($remote)
    Yes 'the client writes the pack lines the reader takes' ($invText.Contains('`removeInventoryItems(${refr.getFormID().toString(16)}, ') -and
        $invText.Contains('`[thornswood] inventory: the game holds ${wanted} fewer than the `') -and
        $invText.Contains('`[thornswood] inventory: the game refused to take away ') -and
        $invText.Contains('printConsole("Refused inventory with an invalid item count");') -and
        $remoteText.Contains('`[thornswood] inventory: this difference was applied five seconds ago `') -and
        $remoteText.Contains("'Owner inventory or outfit did not finish loading; face menu stays closed'"))
} else {
    Write-Host 'SKIP  the client''s pack lines: engine\skymp is not checked out here'
}
$verbs = [IO.File]::ReadAllText((Join-Path $repo 'scripts/vps/gate/verbs.json')) | ConvertFrom-Json
$verb = $verbs.verbs.PSObject.Properties['Read-TradeLines']
Yes 'the gate runs it as a verb that only reads, with -Days alone' ($null -ne $verb -and $verb.Value.script -eq 'scripts/vps/Read-TradeLines.ps1' -and
    $verb.Value.onlyReads -eq $true -and @($verb.Value.params.PSObject.Properties.Name) -join ',' -eq 'Days')
Yes 'it reads the two servers'' folders and the session logs by default' ($readerText.Contains("[string]`$Server = 'C:\Thornswood-Server,C:\Thornswood-Server-Dev'") -and
    $readerText.Contains("[string]`$Folder = 'C:\Thornswood-Docs\data\session-logs'"))

# ---- 2. the reader --------------------------------------------------------------------
Write-Host ''; Write-Host ('the reader, in ' + $PSVersionTable.PSEdition + ' ' + $PSVersionTable.PSVersion)
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-6723-' + [guid]::NewGuid().ToString('N'))
$sets = Join-Path $tmp 'session-logs'
$main = Join-Path $tmp 'Thornswood-Server'
$dev = Join-Path $tmp 'Thornswood-Server-Dev'
New-Item -ItemType Directory -Path $sets, $main, $dev | Out-Null
try {
    function Set-Logs([string]$name, [string]$who, [hashtable]$logs, [int]$hoursAgo) {
        $file = Join-Path $sets ($name + '.json')
        [IO.File]::WriteAllText($file, (@{ who = $who; logs = $logs } | ConvertTo-Json -Depth 4))
        (Get-Item -LiteralPath $file).LastWriteTime = (Get-Date).AddHours(-$hoursAgo)
    }
    function Stamp([int]$hoursAgo) { return '[' + (Get-Date).ToUniversalTime().AddHours(-$hoursAgo).ToString('yyyy-MM-ddTHH:mm:ss.fffZ') + '] ' }

    $traded = 'Ebony Armor, 3 Potion of Healing for 200 gold'
    $half = '2 Iron Ingot for nothing'
    [IO.File]::WriteAllText((Join-Path $main 'server.log'), ((@(
        ((Stamp 2) + '[thornswood trade] Secret Seller and Hidden Buyer traded: ' + $traded),
        ((Stamp 2) + '[thornswood trade] ready: two piles, two confirmations, and any change takes both back'),
        ((Stamp 2) + '[thornswood] Secret Seller logged in as profile 1992045742'),
        ((Stamp 1) + '[thornswood trade] Secret Seller was written and Hidden Buyer was not.'),
        ((Stamp 1) + '[thornswood trade] HALF A TRADE: Secret Seller was written and Hidden Buyer was not, trading ' + $half)
    ) -join "`n") + "`n"))
    [IO.File]::WriteAllText((Join-Path $main 'server.log.20261124230000123'), ((Stamp 400) + '[thornswood trade] Old One and Older One traded: Old Sword for nothing' + "`n" +
        (Stamp 3) + '[thornswood trade] Rolled One and Rolled Two traded: 5 Firewood for 10 gold' + "`n"))
    (Get-Item -LiteralPath (Join-Path $main 'server.log.20261124230000123')).LastWriteTime = (Get-Date).AddHours(-3)
    [IO.File]::WriteAllText((Join-Path $main 'thornswood.log'), ((Stamp 2) + '[thornswood trade] Copy One and Copy Two traded: Not From Here for nothing' + "`n"))
    [IO.File]::WriteAllText((Join-Path $dev 'server.log'), ((Stamp 1) + '[thornswood trade] Dev One and Dev Two traded: 1 Leather Strip for 4 gold' + "`n"))

    $remove = 'removeInventoryItems(14, 2e4f4, 2, [[0,1,{"baseId":193012,"count":1}]], 0)'
    $fewer = '[thornswood] inventory: the game holds 3 fewer than the difference takes away, of Potion of Healing x3'
    $again = '[thornswood] inventory: this difference was applied five seconds ago and is still there, applying it again: [{"baseId":193012,"count":-1}]'
    $owner = '[01:02:03:004] [error] RemoteServer: Owner inventory or outfit did not finish loading; face menu stays closed'
    Set-Logs 'key-one-secret' 'Someone Secret' @{
        'skyrim-platform.log' = ("[20:09:00:000] platform_se v2.9.0`n" + $owner + "`n[20:10:00:000] registering browser api`n" + $remove + "`n" + $fewer + "`n" + $again)
        'launcher.log' = '2026-11-24 20:08:33  Starting the game on launcher 1.3.120, game files of build-1.3.120, borderless.'
        'thornswood-front.log' = '[front] 20:10:01.000 removeInventoryItems( not this log'
    } 2
    Set-Logs 'key-old' 'Old Person' @{ 'skyrim-platform.log' = $remove } (24 * 30)
    Set-Logs 'key-quiet' 'Quiet Person' @{ 'skyrim-platform.log' = '[09:00:00:000] game data loaded' } 3
    [IO.File]::WriteAllText((Join-Path $sets 'key-broken.json'), '{ not json')

    $out = (& pwsh -NoProfile -File $reader -Folder $sets -Server ($main + ',' + $dev) -Days 7 2>&1 | Out-String)
    $code = $LASTEXITCODE
    Yes 'it exits 0' ($code -eq 0)
    Yes 'it prints each trade in the window with what each side gave' ($out.Contains('traded: ' + $traded) -and $out.Contains('traded: 5 Firewood for 10 gold') -and
        $out.Contains('traded: 1 Leather Strip for 4 gold'))
    Yes '  with which server and its time in UTC' ($out -match '\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\s+Main\s+traded: Ebony Armor' -and
        $out -match 'UTC\s+Dev\s+traded: 1 Leather Strip')
    Yes '  and a half trade as one' ($out -match 'UTC\s+Main\s+HALF A TRADE, only one pack was written: 2 Iron Ingot for nothing')
    Yes '  in the order the logs have them, the rolled copy first' ($out.IndexOf('5 Firewood') -lt $out.IndexOf('Ebony Armor') -and $out.IndexOf('Ebony Armor') -lt $out.IndexOf('2 Iron Ingot'))
    Yes '  and leaves out a trade from before the window, thornswood.log and every other line' (-not $out.Contains('Old Sword') -and
        -not $out.Contains('Not From Here') -and -not $out.Contains('ready: two piles') -and -not $out.Contains('logged in'))
    Yes 'it prints the pack lines of the set' ($out.Contains($remove) -and $out.Contains($fewer) -and $out.Contains($again) -and $out.Contains($owner))
    Yes '  in the order the log has them' ($out.IndexOf($owner) -lt $out.IndexOf($remove) -and $out.IndexOf($remove) -lt $out.IndexOf($fewer) -and $out.IndexOf($fewer) -lt $out.IndexOf($again))
    Yes '  and leaves out the rest of the log, and the other logs' (-not $out.Contains('platform_se') -and -not $out.Contains('registering browser') -and
        -not $out.Contains('not this log'))
    Yes 'it names the launcher the set ran on' ($out.Contains('on launcher 1.3.120'))
    Yes 'it leaves out a set written before the window and one with no pack lines' (([regex]::Matches($out, '(?m)^Session \d+,')).Count -eq 1)
    Yes 'it counts the trades, the sets read and the one that would not read' ($out.Contains('3 trade(s) and 1 half trade(s) in the server logs; 2 session log sets read, 1 that would not read, 1 with pack lines'))
    Yes 'it prints no account, name, profile or session key' (-not $out.Contains('Secret') -and -not $out.Contains('Hidden') -and -not $out.Contains('key-one') -and
        -not $out.Contains('Person') -and -not $out.Contains('Rolled One') -and -not $out.Contains('Dev One') -and -not $out.Contains('1992045742'))

    Remove-Item -LiteralPath (Join-Path $main 'server.log'), (Join-Path $main 'server.log.20261124230000123'), (Join-Path $dev 'server.log')
    $none = (& pwsh -NoProfile -File $reader -Folder $sets -Server ($main + ',' + (Join-Path $tmp 'no-dev')) -Days 7 2>&1 | Out-String)
    Yes 'with no trade in the window it says so' ($LASTEXITCODE -eq 0 -and $none.Contains('No trade reached the server logs in the window.'))
    Yes '  and names a server folder that is not there' ($none -match 'Dev: no .*no-dev here')

    $gone = (& pwsh -NoProfile -File $reader -Folder (Join-Path $tmp 'nothing') -Server $main -Days 7 2>&1 | Out-String)
    Yes 'it stops when the session log folder is not there' ($LASTEXITCODE -eq 1 -and $gone.Contains('STOP. There is no'))
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Done
