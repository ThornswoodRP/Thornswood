<#
  Load-Box.ps1

      pwsh scripts/vps/Box-Run.ps1 -Line 'Load-Test -From dev -Shape crowd -Steps 10,25,50 -Play fight,host,trade'

  #4623. The load test with the collection's world: its NPCs, the gamemode's
  NPC runtime, merchants and quests, and bots that fight, host the NPCs near
  them and ask the guild traders to trade. The collection's plugins are
  other people's and are only on the box, so this runs there, through the
  deploy gate (verbs.json "Load-Test"), and nothing of the collection leaves
  it. The runner's load test (.github\workflows\load-test.yml) is the same
  bots on the five masters.

  What it does, in order:
    1. stops unless nobody is on the live server or the dev server (their
       online.json on 3000 and 7788, as Read-Online.ps1 reads them), and
       unless the copy's ports are free;
    2. lays out a copy of the installed server (-From live is
       C:\Thornswood-Server, dev is C:\Thornswood-Server-Dev) in a folder of
       its own under the account's temp folder (New-LoadServer.js --from):
       the server's program and gamemode.js and the plugins its loadOrder
       names, read and never written, with its own port, its own voice
       service on 127.0.0.1, an empty world and a pass key made for the run;
    3. runs Load-Test.js on it, which also stops before each step if
       anybody joins either server, and at 60% of the box's CPU, because the
       box's cores are the game servers' as well;
    4. puts result.json, the summary and the last of the copy's logs in -Out
       (the gate seals them to the session that asked), and removes the copy.
  Nothing it starts listens anywhere but the copy's ports, and every process
  of the copy ends with it. The installed servers are only read.

  Windows PowerShell 5.1 on the box, and pwsh anywhere.
#>
[CmdletBinding()]
param(
    [ValidateSet('live', 'dev')]
    [string]$From = 'dev',
    [ValidateSet('crowd', 'spread')]
    [string]$Shape = 'crowd',
    [ValidatePattern('^[0-9]{1,3}(,[0-9]{1,3}){0,7}$')]
    [string]$Steps = '10,25,50',
    [ValidatePattern('^[0-9]{2,3}$')]
    [string]$Hold = '60',
    [ValidatePattern('^((fight|host|trade)(,(fight|host|trade)){0,2})?$')]
    [string]$Play = 'fight,host,trade',
    [string]$Out = '',
    # For the harness: the folder the servers are installed in and the
    # online.json addresses, which on the box are the ones below.
    [string]$ServersRoot = 'C:\',
    [string]$Watch = 'http://127.0.0.1:3000/online.json,http://127.0.0.1:7788/online.json'
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Port = 7797        # the copy's game port; its resources port is the next one up
$VoicePort = 7799   # the copy's voice service, on 127.0.0.1 only

function Say($m) { Write-Output $m }
function Stop-Run($m) { Say ('LOAD TEST STOPPED: ' + $m); exit 1 }

if (-not $Out) { Stop-Run 'no -Out folder (the gate gives one)' }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { Stop-Run 'node is not on this machine' }
$node = $node.Source

$root = Join-Path $ServersRoot $(if ($From -eq 'live') { 'Thornswood-Server' } else { 'Thornswood-Server-Dev' })
if (-not (Test-Path -LiteralPath (Join-Path $root 'server-settings.json'))) { Stop-Run ('there is no server installed at ' + $root) }

# 1. Nobody on either server, and the copy's ports free.
foreach ($u in ($Watch -split ',' | Where-Object { $_ })) {
    try {
        $raw = (Invoke-WebRequest -Uri $u -TimeoutSec 15 -UseBasicParsing).Content
        if ($raw -is [byte[]]) { $raw = [System.Text.Encoding]::UTF8.GetString($raw) }
        $j = $raw | ConvertFrom-Json
        if ($null -eq $j.now) { Stop-Run ($u + ' has no "now" count, so nobody can say it is empty') }
        if ([int]$j.now -gt 0) { Stop-Run ([string][int]$j.now + ' on ' + $u + '. The load test runs only while nobody is on.') }
        Say ($u + ': 0 on')
    } catch {
        Stop-Run ($u + ' could not be read (' + $_.Exception.Message + '), so nobody can say it is empty')
    }
}
foreach ($p in @($Port, ($Port + 1), $VoicePort)) {
    $busyTcp = @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
    $busyUdp = @(Get-NetUDPEndpoint -LocalPort $p -ErrorAction SilentlyContinue)
    if ($busyTcp.Count -or $busyUdp.Count) { Stop-Run ('port ' + $p + ' is in use on this machine, so the copy cannot have it') }
}

$most = ($Steps -split ',' | ForEach-Object { [int]$_ } | Measure-Object -Maximum).Maximum
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('thornswood-load-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$code = 1
$why = ''
try {
    # 2. The copy.
    & $node (Join-Path $Here 'New-LoadServer.js') --from $root --out $work --shape $Shape --seats ([string]$most) --port ([string]$Port) --voice-port ([string]$VoicePort)
    if ($LASTEXITCODE -ne 0) {
        $why = 'the copy could not be laid out (above)'
    } else {
        # 3. The bots.
        $summary = Join-Path $Out 'summary.md'
        $nodeArgs = @((Join-Path $Here 'Load-Test.js'), '--root', $work, '--out', (Join-Path $Out 'result.json'), '--steps', $Steps,
                      '--hold', $Hold, '--shape', $Shape, '--busy', '0.6', '--watch', $Watch, '--summary', $summary)
        if ($Play) { $nodeArgs += @('--play', $Play) }
        & $node @nodeArgs
        $code = $LASTEXITCODE
        if (Test-Path -LiteralPath $summary) { Get-Content -LiteralPath $summary | ForEach-Object { Say $_ } }

        # 4. What comes back: the result, the samples, and the last of the logs.
        foreach ($f in @('load-samples.jsonl', 'voice-samples.jsonl')) {
            $a = Join-Path $work $f
            if (Test-Path -LiteralPath $a) { Copy-Item -LiteralPath $a -Destination (Join-Path $Out $f) }
        }
        foreach ($f in @('load-test-server.log', 'load-test-voice.log')) {
            $a = Join-Path $work $f
            if (Test-Path -LiteralPath $a) { Get-Content -LiteralPath $a -Tail 3000 | Set-Content -LiteralPath (Join-Path $Out $f) -Encoding UTF8 }
        }
    }
} finally {
    if (Test-Path -LiteralPath $work) {
        try { Remove-Item -LiteralPath $work -Recurse -Force } catch { Say ('the copy at ' + $work + ' could not be removed: ' + $_.Exception.Message) }
    }
}
if ($why) { Stop-Run $why }
Say ('LOAD TEST ENDED ' + $code)
exit $code
