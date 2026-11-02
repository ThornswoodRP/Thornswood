<#
  test-deploy-server-swap.ps1

  Deploy-Server.ps1 stages and checks before it stops anything, and puts the
  old files back when the new server does not answer.

  WHY THIS EXISTS. Entry 209 on the To Do List: "Upload to a staging path,
  verify there, the shortest possible stop, an atomic rename, a real health
  check." Until then the script that runs most often stopped the live server
  first, copied straight over the running folder, waited six seconds and
  printed SERVER IS NOT LISTENING without exiting non-zero or putting anything
  back.

  HOW. The two blocks that run on the box are taken out of Deploy-Server.ps1
  from between its markers, given a scratch folder in place of
  C:\Thornswood-Server, and run by PowerShell 7, which is what runs them on
  the box. The server is a node stub that holds its game port on UDP
  and its resources port on TCP the way skymp5-server does, and a second stub
  on other ports stands in for the server that is not being deployed. The
  stop, the port checks, the renames and the health check are the real ones.
  Only the task scheduler is not: Start-ScheduledTask and Stop-ScheduledTask
  are replaced by functions that start the stub, so nothing here registers or
  touches a real task. Get-ScheduledTask and Set-ScheduledTask are replaced
  too, by ones that find no task (#2015): the real ones would load the
  ScheduledTasks module, whose commands are functions, and that load puts the
  real Start-ScheduledTask back over the stand-in.

  It proves:
    - a load order naming a plugin that is nowhere leaves the live files as
      they were and the server answering, and so does a port that moves, a
      file that arrived different, a byte order mark, a binary that is not
      the recorded build, a JavaScript half that is not, and server files
      sent with no record (#1214)
    - a new server that hangs on its game port, or that dies on start, gets
      the old files back, the old server started again, and SWAP ROLLED BACK
    - a good deploy swaps every file in, keeps what it replaced, answers,
      keeps the newest two .prev folders, and never touches the other server
    - the build stamp is one of the staged files, so it goes in beside
      gamemode.js on a good deploy and goes back with it on a rollback
    - Deploy-Server.ps1 -GamemodeOnly (#1089), run whole with ssh and scp
      stand-ins against the scratch root: only gamemode.js, the stamp and the
      box's own settings are swapped, and our plugin only when its size is
      not the box's; a box running another server build, or with a join pass
      switch that is neither true nor false, is refused after one read with
      nothing sent; a settings key that moves after the copy puts the old
      files back; and -PutBack brings the old gamemode back

  Connects to nothing but 127.0.0.1.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here

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

# ---- the blocks, out of the script itself -----------------------------------
# Swap.ps1 since issue #446, which Deploy-Server.ps1 and Deploy-DevGamemode.ps1
# both load.
$src = Get-Content -LiteralPath (Join-Path $Here 'scripts\deploy\Deploy-Server.ps1') -Raw
$lib = Get-Content -LiteralPath (Join-Path $Here 'scripts\deploy\Swap.ps1') -Raw
$a = $lib.IndexOf('# ==== deploy-server remote blocks ====')
$b = $lib.IndexOf('# ==== end deploy-server remote blocks ====')
Yes 'Swap.ps1 keeps the blocks that run on the box between their markers' ($a -ge 0 -and $b -gt $a)
if ($a -lt 0 -or $b -le $a) { Done }
$checkBlock = $null
$swapBlock = $null
# SwapVars names who holds the server it stops (#5155, ServerHold.ps1).
. (Join-Path $Here 'scripts\vps\ServerHold.ps1')
Invoke-Expression $lib.Substring($a, $b - $a)
$c = $lib.IndexOf('# ==== put-back pick ====')
$d = $lib.IndexOf('# ==== end put-back pick ====')
$putBackPick = $null
if ($c -ge 0 -and $d -gt $c) { Invoke-Expression $lib.Substring($c, $d - $c) }
Yes 'the stage check, the swap, the put-back pick and SwapVars are all there' (
    [bool]$checkBlock -and [bool]$swapBlock -and [bool]$putBackPick -and [bool](Get-Command SwapVars -EA SilentlyContinue))
# The check holds the server files to their record with ServerBuild.ps1
# (#1214), which Swap.ps1 puts in front of it below its end marker; the same
# here, since the blocks were taken from between the markers.
$serverBuildPath = Join-Path $Here 'scripts\deploy\ServerBuild.ps1'
Yes 'Swap.ps1 puts ServerBuild.ps1 in front of the stage check' (
    $lib.Substring($b).Contains('$checkBlock = [IO.File]::ReadAllText((Join-Path $PSScriptRoot ''ServerBuild.ps1'')) + "`r`n" + $checkBlock'))
$checkBlock = [IO.File]::ReadAllText($serverBuildPath) + "`r`n" + $checkBlock
# And the record contracts (#2180, slice 4), the way Swap.ps1 puts them in front.
Yes 'Swap.ps1 puts Read-JsonFile.ps1 and RecordShape.ps1 in front of the stage check' (
    $lib.Substring($b).Contains('$checkBlock = $ThornswoodRecordShapeText + $checkBlock'))
$checkBlock = [IO.File]::ReadAllText((Join-Path $Here 'scripts\release\Read-JsonFile.ps1')) + "`r`n" +
              [IO.File]::ReadAllText((Join-Path $Here 'scripts\release\RecordShape.ps1')) + "`r`n" + $checkBlock
# The swap's own text, before anything goes in front of it: what it stops is
# read from this (below), because StopAndMove.ps1 reads command lines only
# to name what held a refused rename (#3262), never to choose what to stop.
$ownSwapBlock = $swapBlock
# And the stop and the renames (#2928), the way Swap.ps1 puts them in front.
Yes 'Swap.ps1 puts StopAndMove.ps1 in front of the swap' (
    $lib.Substring($b).Contains('$swapBlock = $ThornswoodStopAndMoveText + $swapBlock'))
$swapBlock = [IO.File]::ReadAllText((Join-Path $Here 'scripts\deploy\StopAndMove.ps1')) + "`r`n" + $swapBlock
# And the server folders' turn (#3247), the same way. The scratch root has no
# Thornswood-Backup beside it, so here it takes no turn.
Yes 'Swap.ps1 puts ServerFolderTurn.ps1 in front of the swap' (
    $lib.Substring($b).Contains('$swapBlock = $ThornswoodServerFolderTurnText + $swapBlock'))
$swapBlock = [IO.File]::ReadAllText((Join-Path $Here 'scripts\deploy\ServerFolderTurn.ps1')) + "`r`n" + $swapBlock
# And the hold (#5155), the same way, pointed at a watchdog folder that is
# not there, so a run here holds nothing on whatever machine runs it: the
# box's own C:\Thornswood-Watch is never written by this.
Yes 'Swap.ps1 puts ServerHold.ps1 in front of the swap and the service swap' (
    $lib.Substring($b).Contains('$swapBlock = $ThornswoodHoldText + $swapBlock') -and
    $lib.Contains('$serviceSwapBlock = $ThornswoodHoldText + $serviceSwapBlock'))
Yes 'the swap holds its server just before the stop and takes the hold away on every way out after it' (
    $ownSwapBlock.IndexOf('Set-ThornswoodHold -Target $Task') -gt 0 -and
    $ownSwapBlock.IndexOf('Set-ThornswoodHold -Target $Task') -lt $ownSwapBlock.IndexOf("`nStopOurs") -and
    ([regex]::Matches($ownSwapBlock, 'Clear-ThornswoodHold -Target \$Task')).Count -eq 3 -and
    ([regex]::Matches($ownSwapBlock, '(?m)^\s*exit ')).Count -eq ([regex]::Matches($ownSwapBlock.Substring($ownSwapBlock.IndexOf('Set-ThornswoodHold')), '(?m)^\s*exit ')).Count + 2)
$swapBlock = (Get-ThornswoodHoldScript) + ('$ThornswoodHoldRoot = ''' + (Join-Path ([IO.Path]::GetTempPath()) ('ts-swap-no-watch-' + [Guid]::NewGuid().ToString('N'))) + '''') + "`r`n" + $swapBlock
Yes 'Deploy-Server.ps1 loads Swap.ps1' ($src -match "\. \(Join-Path \`$Here 'Swap\.ps1'\)")
# Which settings Deploy-Server takes from the build and which stay the live
# server's (#1222), and the carry it runs on the box: ServerSettings.ps1.
$settingsLibPath = Join-Path $Here 'scripts\deploy\ServerSettings.ps1'
$settingsLibText = [IO.File]::ReadAllText($settingsLibPath)
$settingsCarryBlock = $null
. $settingsLibPath
Yes 'ServerSettings.ps1 has the carry block and the live keys, in plain ASCII' (
    [bool]$settingsCarryBlock -and @($ThornswoodGamemodeKeys).Count -gt 4 -and $settingsLibText -notmatch '[^\x00-\x7F]')
# The keys it checks and swaps with are $liveKeys: the live keys and what the
# run asked for (#1223), or none at all on -GamemodeOnly (#1089).
Yes 'Deploy-Server.ps1 loads it, sends it with the carry, and checks and swaps with the live keys' (
    $src -match "\. \(Join-Path \`$Here 'ServerSettings\.ps1'\)" -and $src.Contains('$settingsCarryBlock') -and
    $src.Contains('$liveKeys = @($ThornswoodGamemodeKeys + @($asked.Keys))') -and
    ([regex]::Matches($src, '\$hashes \$liveKeys\) \+ \$(checkBlock|swapBlock)')).Count -eq 2)

# ---- -GamemodeOnly, read (#1089) ---------------------------------------------
# A machine other than One puts a gamemode live with no server build: the
# artifact's gamemode.js, the stamp made from it, and the box's own settings
# copied on the box, with no key allowed to move.
$dsCmd = $null
try { $dsCmd = Get-Command -Name (Join-Path $Here 'scripts\deploy\Deploy-Server.ps1') -EA Stop } catch { }
Yes 'Deploy-Server.ps1 takes -GamemodeOnly (#1089)' ($null -ne $dsCmd -and $dsCmd.Parameters.ContainsKey('GamemodeOnly'))
Yes '  and on it the box''s own settings are copied in the stage and no key may move at the check or the swap' (
    [bool]$settingsKeepBlock -and $src.Contains('$settingsKeepBlock') -and
    $src -match '(?s)if \(\$GamemodeOnly\) \{\s*(#[^\r\n]*\s*)*\$liveKeys = @\(\)')
$serverBuildText = [IO.File]::ReadAllText($serverBuildPath)
. $serverBuildPath
Yes '  and the record the box runs is compared by Get-ThornswoodRecordSum, kept as text for the box, in plain ASCII' (
    [bool]$ThornswoodRecordSumText -and [bool](Get-Command Get-ThornswoodRecordSum -EA SilentlyContinue) -and
    $serverBuildText -notmatch '[^\x00-\x7F]' -and $src.Contains('$ThornswoodRecordSumText'))
if (Get-Command Get-ThornswoodRecordSum -EA SilentlyContinue) {
    $lf = [Text.Encoding]::ASCII.GetBytes("{`n  `"a`": 1`n}`n")
    $crlf = [Text.Encoding]::ASCII.GetBytes("{`r`n  `"a`": 1`r`n}`r`n")
    $other = [Text.Encoding]::ASCII.GetBytes("{`n  `"a`": 2`n}`n")
    Yes '  which reads a record checked out with CR LF as the same record, and any other byte as another' (
        (Get-ThornswoodRecordSum $lf) -eq (Get-ThornswoodRecordSum $crlf) -and (Get-ThornswoodRecordSum $lf) -ne (Get-ThornswoodRecordSum $other) -and
        (Get-ThornswoodRecordSum $lf) -match '^[0-9a-f]{64}$')
}
$noKeys = SwapVars 'C:/Thornswood-Server' 'Thornswood Server' '.stage-x' '.prev-x' 7 ([ordered]@{}) @()
Yes '  and SwapVars given no keys sends $ReleaseKeys = @(), a read-back that lets nothing move, not $null, which is none' (
    $noKeys.Contains('$ReleaseKeys = @()') -and -not $noKeys.Contains('$ReleaseKeys = $null'))
$keepParses = $false
if ($settingsKeepBlock) {
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($settingsKeepBlock, [ref]$tokens, [ref]$errors)
    $keepParses = ($errors.Count -eq 0 -and $settingsKeepBlock -notmatch '[^\x00-\x7F]')
}
Yes '  and the keep block parses, in plain ASCII' $keepParses

# ---- read, not run ----------------------------------------------------------
Yes 'the blocks are plain ASCII, which the far end reads right with or without a byte order mark' (
    ($checkBlock + $swapBlock + $putBackPick) -notmatch '[^\x00-\x7F]')

# The narrowing on 17 September was a fix. The TCP port one above the game
# port is 7778 on the live root, which is the voice service.
Yes 'the stop is still by the UDP port and nothing else' (
    $ownSwapBlock.Contains('Get-NetUDPEndpoint -EA Stop | Where-Object { $_.LocalPort -eq $port }') -and
    $ownSwapBlock -notmatch 'Get-NetTCPConnection' -and
    $ownSwapBlock -notmatch 'Win32_Process' -and
    $ownSwapBlock -notmatch 'CommandLine')
Yes 'the stage check stops nothing' ($checkBlock -notmatch 'Stop-Process|Stop-ScheduledTask')

$flow = $src.Substring([Math]::Max(0, $src.IndexOf('# ------------------------------------------------------------- the stage')))
$iStage = $flow.IndexOf('$checkBlock)')
$iWarn  = $flow.IndexOf('# ------------------------------------------------------------- the warning')
$iSwap  = $flow.IndexOf('$swapBlock)')
Yes 'the stage is checked before anybody is warned, and the swap comes after both' (
    $iStage -ge 0 -and $iWarn -gt $iStage -and $iSwap -gt $iWarn)
Yes 'a stage that does not check out ends the run' ($flow -match "-notcontains 'STAGE OK'")
Yes 'nothing is copied straight over the live folder any more' (
    $flow -notmatch ':\$Root/' -and $flow -notmatch ':\$remotePlugins/')
Yes 'a swap that is not SWAP OK exits 1' ($flow -match "-notcontains 'SWAP OK'\)\s*\{[\s\S]*?exit 1")

# A plugin name is free text. One with an apostrophe in it must not end the
# string early on the far side.
$pre = SwapVars 'C:/Thornswood-Server' "Tom's Task" '.stage-x' '.prev-x' 7 ([ordered]@{ "plugins/Bob's.esp" = 'ab12' })
Yes 'SwapVars turns the root to backslashes and doubles every single quote' (
    $pre -match [regex]::Escape("`$Root  = 'C:\Thornswood-Server'") -and
    $pre -match [regex]::Escape("`$Task  = 'Tom''s Task'") -and
    $pre -match [regex]::Escape("`$Want['plugins/Bob''s.esp'] = 'ab12'"))
$tokens = $null; $errors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($pre + $swapBlock, [ref]$tokens, [ref]$errors)
Yes 'and what it makes parses with the swap behind it' ($errors.Count -eq 0)

# ---- run, against a scratch folder ------------------------------------------
$node = Get-Command node -EA SilentlyContinue
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the runs: the swap finds the server by its port with Get-NetUDPEndpoint, which only Windows has, and this is not Windows'
    Done
}
$boxPs = Get-BoxPowerShell
if (-not $node -or -not (Get-Command Get-NetUDPEndpoint -EA SilentlyContinue)) {
    Write-Host 'SKIP  the runs need node and Get-NetUDPEndpoint as well, and this machine lacks one'
    Done
}

function Free([int]$p) {
    (-not @(Get-NetUDPEndpoint -LocalPort $p -EA SilentlyContinue).Count) -and
    (-not @(Get-NetTCPConnection -LocalPort $p -EA SilentlyContinue).Count)
}
$rand = New-Object Random
function PickPorts {
    do { $script:P = $rand.Next(41000, 48000) } until ((Free $script:P) -and (Free ($script:P + 1)))
    do { $script:Q = $rand.Next(41000, 48000) } until ([Math]::Abs($script:Q - $script:P) -gt 2 -and
                                                        (Free $script:Q) -and (Free ($script:Q + 1)))
}

$work  = Join-Path ([IO.Path]::GetTempPath()) ('ts-swap-' + [Guid]::NewGuid().ToString('N'))
$root   = Join-Path $work 'Thornswood-Server'
$other  = Join-Path $work 'Thornswood-Server-Other'
$pidLog = Join-Path $work 'pids.txt'
$stub   = Join-Path $work 'stub.js'
$bob    = "Bob's Armour - Extra.esp"
$utf8   = New-Object Text.UTF8Encoding($false)

function Put([string]$path, [string]$text, [switch]$Bom) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding([bool]$Bom)))
}
function Sha([string]$text) {
    $h = [Security.Cryptography.SHA256]::Create()
    try { return (($h.ComputeHash($utf8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join '') }
    finally { $h.Dispose() }
}
function SettingsJson([string]$forRoot, [int]$port, [string[]]$names, [hashtable]$extra = @{}) {
    $far = ($forRoot -replace '\\', '/') + '/plugins/'
    $s = [ordered]@{ port = $port; name = 'Thornswood Test'; loadOrder = @($names | ForEach-Object { $far + $_ }) }
    foreach ($k in $extra.Keys) { $s[$k] = $extra[$k] }
    return ($s | ConvertTo-Json -Depth 8)
}
function Tree([string]$dir) {
    $rows = @()
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force)) {
        if ($f.Name -eq 'server.log') { continue }
        $rows += ($f.FullName.Substring($dir.Length) + '|' + (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash)
    }
    foreach ($d in @(Get-ChildItem -LiteralPath $dir -Recurse -Directory -Force)) {
        $rows += ($d.FullName.Substring($dir.Length) + '|folder')
    }
    return (($rows | Sort-Object) -join "`n")
}
function Owner([int]$port) {
    $e = @(Get-NetUDPEndpoint -LocalPort $port -EA SilentlyContinue)
    if ($e.Count) { return [int]$e[0].OwningProcess }
    return 0
}
function Answers([int]$port) {
    if (-not (Owner $port)) { return $false }
    $ok = $false
    try {
        $c = New-Object Net.Sockets.TcpClient
        $null = $c.BeginConnect('127.0.0.1', $port + 1, $null, $null).AsyncWaitHandle.WaitOne(500)
        $ok = $c.Connected
        $c.Close()
    } catch { }
    return $ok
}
function WaitUp([int]$port) {
    for ($i = 0; $i -lt 40; $i++) { if (Answers $port) { return $true }; Start-Sleep -Milliseconds 250 }
    return $false
}
function StartStub([string]$dir) {
    $p = Start-Process -FilePath $node.Source -WindowStyle Hidden -PassThru `
                       -ArgumentList ('"' + $stub + '" "' + $dir + '" "' + $pidLog + '"')
    return $p.Id
}

# What gets staged. Every argument is what a real deploy could get wrong.
function MakeStage {
    param([string]$Name, [string]$Gamemode = '// new gamemode', [int]$Port = $P,
          [string[]]$Order = @('Skyrim.esm', $bob, 'New Plugin.esp'),
          [switch]$Bom, [string]$RecordFor = 'new binary', [string]$RecordJs = 'new server js', [string]$SentGamemode = '', [hashtable]$Settings = @{},
          [switch]$NoRecord)
    $dir = Join-Path $root $Name
    $files = [ordered]@{}
    $files['plugins/' + $bob]        = 'bob v2'
    $files['plugins/New Plugin.esp'] = 'brand new'
    $files['gamemode.js']            = $Gamemode
    $files['server-settings.json']   = SettingsJson $root $Port $Order $Settings
    # Every server file the fork builds goes up together, held to the record
    # sent with them (#1214, ServerBuild.ps1).
    $server = [ordered]@{ 'scam_native.node' = 'new binary'; 'dist_back/skymp5-server.js' = 'new server js'; 'dist_back/skymp5-server.js.map' = 'new map'
                          'package.json' = '{ "name": "skymp5-server" }'; 'yarn.lock' = 'new lock'; 'launch_server.bat' = 'new bat'; 'data/scripts/ActiveMagicEffect.pex' = 'new pex' }
    $c = 'abcdef0123456789abcdef0123456789abcdef01'
    $recFiles = [ordered]@{}
    foreach ($k in $server.Keys) {
        $files[$k] = $server[$k]
        $said = $server[$k]
        if ($k -eq 'scam_native.node') { $said = $RecordFor }
        if ($k -eq 'dist_back/skymp5-server.js') { $said = $RecordJs }
        $recFiles[$k] = [ordered]@{ sha256 = (Sha $said); bytes = 1; commit = $c }
    }
    if (-not $NoRecord) {
        $files['server-build.json'] = ([ordered]@{ binary = 'scam_native.node'; sha256 = (Sha $RecordFor); bytes = 1; source = [ordered]@{ commit = $c }; files = $recFiles } | ConvertTo-Json -Depth 5)
    }
    # The build stamp Deploy-Gamemode leaves beside gamemode.js goes up in the
    # stage with it, so a rollback cannot leave a new stamp describing the old
    # gamemode. tests\test-build-stamp.ps1 leans on this harness for that.
    $files['thornswood-build.json']  = '{ "gamemode": "' + (Sha $Gamemode) + '" }'
    $want = [ordered]@{}
    foreach ($k in $files.Keys) {
        $path = Join-Path $dir ($k -replace '/', '\')
        Put $path $files[$k] -Bom:($Bom -and $k -eq 'server-settings.json')
        $want[$k] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    if ($SentGamemode) { $want['gamemode.js'] = Sha $SentGamemode }
    return $want
}

# The far side, as Deploy-Server sends it: SwapVars, then the block. The two
# task cmdlets are replaced in between, and nothing else is.
function RunFar([string]$block, [string]$stageName, [string]$prevName, [int]$wait, $want, [string[]]$keys = $null) {
    $mock = @"
function Get-ScheduledTask { [CmdletBinding()] param([string]`$TaskName) }
function Set-ScheduledTask { [CmdletBinding()] param([Parameter(ValueFromPipeline = `$true)]`$InputObject) }
function Stop-ScheduledTask { [CmdletBinding()] param([string]`$TaskName) }
function Start-ScheduledTask { [CmdletBinding()] param([string]`$TaskName)
  Start-Process -FilePath '$($node.Source)' -WindowStyle Hidden -ArgumentList '"$stub" "$root" "$pidLog"'
}

"@
    $body = (SwapVars $root 'Thornswood Test Swap' $stageName $prevName $wait $want $keys) + $mock + $block
    $f = Join-Path $work ('far-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, $body, (New-Object Text.UTF8Encoding($true)))
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $f 2>&1 | ForEach-Object { "$_".Trim() }) }
    finally { $ErrorActionPreference = $eap }
    $script:lastFar = $out
    return $out
}
function Show {
    foreach ($l in $script:lastFar) { Write-Host ('        ' + $l) }
}

$stubJs = @'
// A stand-in for skymp5-server: the game port on UDP, the resources port on
// TCP (3000 for 7777, otherwise the game port plus one), both on 127.0.0.1 so
// no firewall prompt comes up. A gamemode saying will-not-start dies on start;
// one saying udp-only holds the game port and never opens the resources port.
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const net = require('net');
const root = process.argv[2];
fs.appendFileSync(process.argv[3], process.pid + '\n');
function log(m) { fs.appendFileSync(path.join(root, 'server.log'), m + '\n'); }
const gm = fs.readFileSync(path.join(root, 'gamemode.js'), 'utf8');
if (gm.indexOf('will-not-start') >= 0) { log('Error: this gamemode will not start'); process.exit(1); }
const s = JSON.parse(fs.readFileSync(path.join(root, 'server-settings.json'), 'utf8'));
const res = s.port === 7777 ? 3000 : s.port + 1;
dgram.createSocket('udp4').bind(s.port, '127.0.0.1');
if (gm.indexOf('udp-only') < 0) { net.createServer(function (c) { c.end(); }).listen(res, '127.0.0.1'); }
log('listening on ' + s.port + (gm.indexOf('udp-only') < 0 ? ' and ' + res : ' only'));
// Gone when the harness clears its scratch folder, and after ten minutes
// whatever happens, so a harness that is killed part way leaves nothing.
// Not a short fixed life. It was three minutes, and in a sweep of every
// harness on a busy machine the other server's stub was gone before the good
// deploy ran, with only one 'stopped pid' line from the stop, so the deploy
// had not touched it and the timer is what ended it.
setInterval(function () { if (!fs.existsSync(root)) { process.exit(0); } }, 1000);
setTimeout(function () { process.exit(0); }, 600000);
'@

try {
    Put $stub $stubJs
    Put (Join-Path $root 'scam_native.node') 'old binary'
    # The rest of the server files a running root has had since its install.
    foreach ($rel in 'dist_back\skymp5-server.js', 'dist_back\skymp5-server.js.map', 'package.json', 'yarn.lock', 'launch_server.bat', 'data\scripts\ActiveMagicEffect.pex') {
        Put (Join-Path $root $rel) ('old ' + $rel)
    }
    Put (Join-Path $root 'package.json') '{ "name": "skymp5-server", "old": true }'
    Put (Join-Path $root 'gamemode.js') '// old gamemode'
    Put (Join-Path $root 'server-build.json') ('{ "sha256": "' + (Sha 'old binary') + '" }')
    Put (Join-Path $root 'thornswood-build.json') ('{ "gamemode": "' + (Sha '// old gamemode') + '" }')
    Put (Join-Path $root 'plugins\Skyrim.esm') 'skyrim'
    Put (Join-Path $root ('plugins\' + $bob)) 'bob v1'
    Put (Join-Path $root 'data\keep.txt') 'the character book'
    Put (Join-Path $root 'world\w.txt') 'every character'
    Put (Join-Path $other 'gamemode.js') '// the other server'

    # A port that looks free can still be one Windows has reserved, and a bind
    # there fails. A few goes rather than a flaky harness.
    $up = $false
    for ($try = 0; $try -lt 5 -and -not $up; $try++) {
        PickPorts
        Put (Join-Path $root 'server-settings.json') (SettingsJson $root $P @('Skyrim.esm', $bob))
        Put (Join-Path $other 'server-settings.json') (SettingsJson $other $Q @('Skyrim.esm'))
        $oldPid = StartStub $root
        $otherPid = StartStub $other
        $up = (WaitUp $P) -and (WaitUp $Q)
        if (-not $up) { Stop-Process -Id $oldPid, $otherPid -Force -EA SilentlyContinue }
    }
    Yes "the stand-in server is answering on UDP $P and TCP $($P + 1), and the other one on $Q and $($Q + 1)" $up
    if (-not $up) { throw 'no stand-in server came up, so there is nothing to deploy over' }
    $before = Tree $root

    # ---- refusals: nothing stops, nothing moves ------------------------------
    $n = 0
    foreach ($case in @(
        @{ Label = 'a load order naming a plugin that is nowhere'; Why = 'not on disk: .*Nowhere\.esp';
           Args = @{ Order = @('Skyrim.esm', $bob, 'New Plugin.esp', 'Nowhere.esp') } },
        @{ Label = 'a port that moves'; Why = ('on port ' + ($P + 5) + ' and it is on ' + $P);
           Args = @{ Port = ($P + 5) } },
        @{ Label = 'a file that arrived different'; Why = 'arrived different from what was sent: gamemode\.js';
           Args = @{ SentGamemode = '// what left the laptop' } },
        @{ Label = 'settings with a byte order mark'; Why = 'byte order mark';
           Args = @{ Bom = $true } },
        @{ Label = 'a binary that is not the recorded build'; Why = 'not the build server-build\.json records';
           Args = @{ RecordFor = 'some other binary' } },
        @{ Label = 'a JavaScript half that is not the recorded build (#1214)'; Why = 'dist_back/skymp5-server\.js in the stage is not the build server-build\.json records';
           Args = @{ RecordJs = 'the 24 Sep JavaScript half' } },
        @{ Label = 'server files with no record sent beside them (#1214)'; Why = 'server files came with no server-build\.json to hold them to: .*scam_native\.node';
           Args = @{ NoRecord = $true } },
        @{ Label = 'a gamemode that does not parse'; Why = 'gamemode\.js does not parse';
           Args = @{ Gamemode = 'function ( { this is not javascript' } }
    )) {
        $n++
        $stageName = '.stage-20260924-00010' + $n
        $a = $case.Args
        $w = MakeStage -Name $stageName @a
        $failed = $script:fail
        $out = RunFar $checkBlock $stageName '.prev-unused' 4 $w
        $label = $case.Label
        Yes "$label is refused" (($out -contains 'STAGE REFUSED') -and ($out -notcontains 'STAGE OK'))
        Yes "  and it says why" (($out -join "`n") -match $case.Why)
        Yes "  and the stage is cleared, leaving the live folder as it was" ((Tree $root) -eq $before)
        Yes "  and the server was never stopped" (((Owner $P) -eq $oldPid) -and (Answers $P))
        if ($script:fail -gt $failed) { Show }
    }

    # ---- a new server that hangs on its game port ----------------------------
    $w = MakeStage -Name '.stage-20260924-000201' -Gamemode '// new gamemode, udp-only'
    $out = RunFar $checkBlock '.stage-20260924-000201' '.prev-20260924-000201' 4 $w
    Yes 'a good stage checks out' ($out -contains 'STAGE OK')
    if ($out -notcontains 'STAGE OK') { Show }
    Yes '  and checking it stopped nothing' (((Owner $P) -eq $oldPid) -and (Answers $P))
    $failed = $script:fail
    $out = RunFar $swapBlock '.stage-20260924-000201' '.prev-20260924-000201' 4 $w
    $said = $out -join "`n"
    Yes 'a new server that holds its game port and never opens the resources port is SWAP ROLLED BACK' ($out -contains 'SWAP ROLLED BACK')
    Yes '  and it says FAIL, naming both ports' ($said -match ('FAIL: nothing answered on UDP ' + $P + ' and ' + ($P + 1)))
    Yes '  and the old server was stopped by its port' ($out -contains ('stopped pid ' + $oldPid))
    Yes '  and so was the new one that hung' (@($out | Where-Object { $_ -like 'stopped pid *' }).Count -ge 2)
    Yes '  and every live file is back as it was, with no stage or .prev left' ((Tree $root) -eq $before)
    Yes '  and the old server is answering again, as a new process' ((WaitUp $P) -and ((Owner $P) -ne $oldPid))
    Yes '  and the other server was never touched' (((Owner $Q) -eq $otherPid) -and (Answers $Q))
    if ($script:fail -gt $failed) { Show }

    # ---- a new server that dies on start -------------------------------------
    $running = Owner $P
    $w = MakeStage -Name '.stage-20260924-000301' -Gamemode '// new gamemode, will-not-start'
    $out = RunFar $checkBlock '.stage-20260924-000301' '.prev-20260924-000301' 4 $w
    $failed = $script:fail
    $out = RunFar $swapBlock '.stage-20260924-000301' '.prev-20260924-000301' 4 $w
    $said = $out -join "`n"
    Yes 'a new server that dies on start is SWAP ROLLED BACK' ($out -contains 'SWAP ROLLED BACK')
    Yes '  and the tail of server.log shows why' ($said -match 'this gamemode will not start')
    Yes '  and every live file is back as it was' ((Tree $root) -eq $before)
    Yes '  and the old server is answering again' ((WaitUp $P) -and ((Owner $P) -ne $running))
    Yes '  and the other server was never touched' ((Owner $Q) -eq $otherPid)
    if ($script:fail -gt $failed) { Show }

    # ---- a good deploy -------------------------------------------------------
    foreach ($old in 1..4) { Put (Join-Path $root ('.prev-20000101-00000' + $old + '\gamemode.js')) '// long ago' }
    $running = Owner $P
    $w = MakeStage -Name '.stage-20260924-000401'
    $out = RunFar $checkBlock '.stage-20260924-000401' '.prev-20260924-000401' 30 $w
    $failed = $script:fail
    $out = RunFar $swapBlock '.stage-20260924-000401' '.prev-20260924-000401' 30 $w
    $said = $out -join "`n"
    Yes 'a good deploy is SWAP OK' ($out -contains 'SWAP OK')
    Yes '  and says PASS from the resources port' ($said -match ('PASS: the server is answering on ' + ($P + 1) + ', game port ' + $P))
    $allIn = $true
    foreach ($k in $w.Keys) {
        $at = Join-Path $root ($k -replace '/', '\')
        if (-not (Test-Path -LiteralPath $at) -or
            (Get-FileHash -LiteralPath $at -Algorithm SHA256).Hash.ToLowerInvariant() -ne $w[$k]) { $allIn = $false }
    }
    Yes '  and every staged file is in place, the new plugin and the changed one with them' $allIn
    $prev = Join-Path $root '.prev-20260924-000401'
    Yes '  and what it replaced is kept in .prev, and a plugin that is new has nothing there' (
        ([IO.File]::ReadAllText((Join-Path $prev 'scam_native.node')) -eq 'old binary') -and
        ([IO.File]::ReadAllText((Join-Path $prev 'gamemode.js')) -eq '// old gamemode') -and
        ([IO.File]::ReadAllText((Join-Path $prev 'thornswood-build.json')) -match (Sha '// old gamemode')) -and
        ([IO.File]::ReadAllText((Join-Path $prev ('plugins\' + $bob))) -eq 'bob v1') -and
        -not (Test-Path -LiteralPath (Join-Path $prev 'plugins\New Plugin.esp')))
    Yes '  and the stage is gone' (-not (Test-Path -LiteralPath (Join-Path $root '.stage-20260924-000401')))
    $kept = @(Get-ChildItem -LiteralPath $root -Directory -Force | Where-Object { $_.Name -like '.prev-*' } |
              Sort-Object Name | ForEach-Object { $_.Name })
    Yes '  and the newest two .prev folders are kept, not three (#1121)' (
        ($kept -join ',') -eq '.prev-20000101-000004,.prev-20260924-000401')
    Yes '  and the world and the data folder are untouched' (
        ([IO.File]::ReadAllText((Join-Path $root 'data\keep.txt')) -eq 'the character book') -and
        ([IO.File]::ReadAllText((Join-Path $root 'world\w.txt')) -eq 'every character'))
    Yes '  and the server answering is the new one' ((Answers $P) -and ((Owner $P) -ne $running))
    Yes '  and the other server was never touched' (((Owner $Q) -eq $otherPid) -and (Answers $Q))
    if ($script:fail -gt $failed) { Show }

    # ---- -PutBack: the newest .prev goes back in, checked -------------------
    # Issue #446. Deploy-Server.ps1 -PutBack sends SwapVars with no files, then
    # $putBackPick, which makes the newest .prev folder the stage, then the
    # same swap block.
    $afterGood = Tree $root
    $running = Owner $P
    $failed = $script:fail
    $out = RunFar ($putBackPick + $swapBlock) '.stage-none' '.undone-none' 30 ([ordered]@{})
    $said = $out -join "`n"
    Yes '-PutBack is SWAP OK' ($out -contains 'SWAP OK')
    Yes '  and it named the .prev folder it put back' ($said -match [regex]::Escape('.prev-20260924-000401 kept'))
    Yes '  and the old binary, gamemode, stamp and plugin are live again' (
        ([IO.File]::ReadAllText((Join-Path $root 'scam_native.node')) -eq 'old binary') -and
        ([IO.File]::ReadAllText((Join-Path $root 'gamemode.js')) -eq '// old gamemode') -and
        ([IO.File]::ReadAllText((Join-Path $root 'thornswood-build.json')) -match (Sha '// old gamemode')) -and
        ([IO.File]::ReadAllText((Join-Path $root ('plugins\' + $bob))) -eq 'bob v1'))
    $undone = @(Get-ChildItem -LiteralPath $root -Directory -Force | Where-Object { $_.Name -like '.undone-*' })
    Yes '  and what it took out is kept in one .undone folder' (
        $undone.Count -eq 1 -and
        ([IO.File]::ReadAllText((Join-Path $undone[0].FullName 'gamemode.js')) -eq '// new gamemode'))
    Yes '  and the .prev folder it emptied is gone, the older one kept' (
        -not (Test-Path -LiteralPath (Join-Path $root '.prev-20260924-000401')) -and
        (Test-Path -LiteralPath (Join-Path $root '.prev-20000101-000004')))
    Yes '  and a plugin the deploy added stays, since nothing came before it' (
        Test-Path -LiteralPath (Join-Path $root 'plugins\New Plugin.esp'))
    Yes '  and the server answering is a new process, on the old files' ((Answers $P) -and ((Owner $P) -ne $running))
    Yes '  and the other server was never touched' (((Owner $Q) -eq $otherPid) -and (Answers $Q))
    if ($script:fail -gt $failed) { Show }

    # ---- a put-back whose old files do not start ----------------------------
    Put (Join-Path $root '.prev-20990101-000001\gamemode.js') '// the kept one, will-not-start'
    Put (Join-Path $root '.prev-20990101-000001\server-settings.json') (SettingsJson $root $P @('Skyrim.esm', $bob))
    $beforeBack = Tree $root
    $running = Owner $P
    $failed = $script:fail
    $out = RunFar ($putBackPick + $swapBlock) '.stage-none' '.undone-none' 4 ([ordered]@{})
    Yes 'a put-back whose files do not start is SWAP ROLLED BACK' ($out -contains 'SWAP ROLLED BACK')
    Yes '  and what was running is back, and the .prev folder is kept full, as it was' ((Tree $root) -eq $beforeBack)
    Yes '  and the server is answering again' ((WaitUp $P) -and ((Owner $P) -ne $running))
    Yes '  and the other server was never touched' ((Owner $Q) -eq $otherPid)
    if ($script:fail -gt $failed) { Show }

    # ---- the live server keeps its own settings (#1221, #1222) ----------------
    # Deploy-Server's carry, run on the box against the stage: the build's
    # server-settings.json has none of the live server's switches and other
    # values for some of the keys Deploy-Gamemode writes. What goes live is
    # the server's own file with only those keys from the build.
    $far = ($root -replace '\\', '/') + '/plugins/'
    $own = [ordered]@{ port = $P; name = 'Thornswood'; dataDir = 'data'; loadOrder = @(($far + 'Skyrim.esm'), ($far + $bob))
                       thornswoodServer = 'main'; thornswoodLoadOrderRefuse = $true; thornswoodRequirePass = $true; thornswoodVoicePort = 7778
                       npcSettings = [ordered]@{}; npcEnabled = $true; thornswoodSomethingNew = 'the server''s own' }
    Put (Join-Path $root 'server-settings.json') ($own | ConvertTo-Json -Depth 8)
    $own = [IO.File]::ReadAllText((Join-Path $root 'server-settings.json')) | ConvertFrom-Json
    $running = Owner $P
    $w = MakeStage -Name '.stage-20260929-000601' -Settings @{ name = 'Thornswood'; npcEnabled = $false; thornswoodVoicePort = 7778; npcSettings = @{} }
    $failed = $script:fail
    $out = RunFar ($settingsLibText + "`r`n" + $settingsCarryBlock) '.stage-20260929-000601' '.prev-20260929-000601' 30 $w $ThornswoodGamemodeKeys
    $said = $out -join "`n"
    $c = @($out | Where-Object { $_ -match '^CARRIED [0-9a-f]{64}$' })
    Yes 'the carry runs on the box, says what it kept, and hashes what it wrote' (
        $c.Count -eq 1 -and $said -match 'the settings this release changes: .*npcEnabled' -and $said -match 'loadOrder')
    if ($c.Count) { $w['server-settings.json'] = $c[0].Substring(8) }
    $out = RunFar $checkBlock '.stage-20260929-000601' '.prev-20260929-000601' 30 $w $ThornswoodGamemodeKeys
    Yes '  and the stage it carried into checks out' ($out -contains 'STAGE OK')
    $out = RunFar $swapBlock '.stage-20260929-000601' '.prev-20260929-000601' 30 $w $ThornswoodGamemodeKeys
    $said = $out -join "`n"
    $after = [IO.File]::ReadAllText((Join-Path $root 'server-settings.json')) | ConvertFrom-Json
    Yes '  and the swap reads it back before the start and is SWAP OK' (
        ($out -contains 'SWAP OK') -and $said -match 'read back: every setting outside this release is the one the server had' -and
        $said.IndexOf('read back') -lt $said.IndexOf('started, giving it'))
    Yes '  and the live server keeps its switches, its name and what the build does not name' (
        $after.thornswoodLoadOrderRefuse -eq $true -and $after.thornswoodRequirePass -eq $true -and $after.thornswoodServer -eq 'main' -and
        $after.name -eq 'Thornswood' -and $after.dataDir -eq 'data' -and $after.thornswoodSomethingNew -eq 'the server''s own')
    Yes '  while what Deploy-Gamemode writes for live comes from the build' ($after.npcEnabled -eq $false -and @($after.loadOrder).Count -eq 3)
    Yes '  and the server answering is the new one, the other untouched' ((WaitUp $P) -and ((Owner $P) -ne $running) -and ((Owner $Q) -eq $otherPid))
    if ($script:fail -gt $failed) { Show }

    # Settings that moved between the carry and the swap: the staged file has
    # the load order refusal off and the running server has it on. The swap
    # reads that back before it starts anything and puts the old files back.
    $before = Tree $root
    $running = Owner $P
    $moved = @{ name = 'Thornswood'; dataDir = 'data'; thornswoodServer = 'main'; thornswoodLoadOrderRefuse = $false; thornswoodRequirePass = $true
                thornswoodVoicePort = 7778; npcSettings = @{}; npcEnabled = $false; thornswoodSomethingNew = 'the server''s own' }
    $w = MakeStage -Name '.stage-20260929-000701' -Settings $moved
    $out = RunFar $checkBlock '.stage-20260929-000701' '.prev-20260929-000701' 30 $w $ThornswoodGamemodeKeys
    $failed = $script:fail
    $out = RunFar $swapBlock '.stage-20260929-000701' '.prev-20260929-000701' 30 $w $ThornswoodGamemodeKeys
    $said = $out -join "`n"
    Yes 'a staged settings file that moves a switch the server has is SWAP ROLLED BACK' ($out -contains 'SWAP ROLLED BACK')
    Yes '  and it names the switch, and nothing new was started' (
        $said -match 'read back: thornswoodLoadOrderRefuse would not be what the server had' -and $said -notmatch 'started, giving it')
    Yes '  and every live file is back as it was' ((Tree $root) -eq $before)
    Yes '  and the old server is answering again' ((WaitUp $P) -and ((Owner $P) -ne $running))
    if ($script:fail -gt $failed) { Show }

    # ---- Deploy-Server.ps1, whole: a build that is not live's goes nowhere (#1221)
    # The shared clone's build held the dev server's settings on 29 Sep. Run
    # with ssh and scp stand-ins that write down any call, and none may come.
    $shell = (Get-Process -Id $PID).Path
    $dsBin = Join-Path $work 'ds-bin'
    $dsCalls = Join-Path $work 'ds-calls.log'
    foreach ($n in 'ssh', 'scp') {
        Put (Join-Path $dsBin ($n + '.ps1')) ("[IO.File]::AppendAllText(`$env:TS_DS_CALLS, ('$n ' + (`$args -join ' ') + [Environment]::NewLine))`r`nexit 1`r`n")
    }
    $dsDist = Join-Path $work 'ds-dist'
    Put (Join-Path $dsDist 'scam_native.node') 'a binary'
    Put (Join-Path $dsDist 'gamemode.js') '// the build copy'
    $oldPath = $env:PATH
    $env:PATH = $dsBin + ';' + $oldPath
    $env:TS_DS_CALLS = $dsCalls
    try {
        foreach ($case in @(
            @{ Label = 'the dev server''s settings'; Settings = [ordered]@{ port = 7787; name = 'Thornswood Dev'; thornswoodVoicePort = 7789; thornswoodServer = 'dev'; loadOrder = @('c:/x/Skyrim.esm') }
               Why = @('port 7787, not 7777', 'the dev voice port 7789', 'the name Thornswood Dev', 'thornswoodServer dev') },
            @{ Label = 'an npcSettings default key'; Settings = [ordered]@{ port = 7777; name = 'Thornswood'; thornswoodVoicePort = 7778; loadOrder = @('c:/x/Skyrim.esm')
                                                                        npcSettings = @{ default = @{ spawnInInterior = $true } } }
               Why = @('refuses every NPC') }
        )) {
            Put (Join-Path $dsDist 'server-settings.json') ($case.Settings | ConvertTo-Json -Depth 6)
            if (Test-Path -LiteralPath $dsCalls) { Remove-Item -LiteralPath $dsCalls -Force }
            $eap = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                $o = (& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Here 'scripts\deploy\Deploy-Server.ps1') `
                        -Dist $dsDist -Vps 127.0.0.1 -User test -Root 'C:/Thornswood-Server' -Now 2>&1 | Out-String)
                $code = $LASTEXITCODE
            } finally { $ErrorActionPreference = $eap }
            $failed = $script:fail
            Yes ("Deploy-Server with a build holding $($case.Label) is refused (exit $code)") ($code -ne 0 -and $o -match "is not the live server's")
            Yes ('  naming ' + ($case.Why -join ', ')) (@($case.Why | Where-Object { -not $o.Contains($_) }).Count -eq 0)
            Yes '  before anything went to the box: no ssh, no scp' (-not (Test-Path -LiteralPath $dsCalls))
            if ($script:fail -gt $failed) { Write-Host (($o -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 12) -join "`n") }
        }
        # The live server's settings and a JavaScript half that is not the
        # one records\server-build.json names (#1214): refused, nothing sent.
        Put (Join-Path $dsDist 'server-settings.json') (([ordered]@{ port = 7777; name = 'Thornswood'; thornswoodVoicePort = 7778; loadOrder = @('c:/x/Skyrim.esm') }) | ConvertTo-Json -Depth 6)
        Put (Join-Path $dsDist 'dist_back\skymp5-server.js') '// a JavaScript half from 24 Sep'
        if (Test-Path -LiteralPath $dsCalls) { Remove-Item -LiteralPath $dsCalls -Force }
        $eap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $o = (& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Here 'scripts\deploy\Deploy-Server.ps1') `
                    -Dist $dsDist -Vps 127.0.0.1 -User test -Root 'C:/Thornswood-Server' -Now 2>&1 | Out-String)
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $eap }
        $failed = $script:fail
        Yes ("Deploy-Server with a JavaScript half that is not the recorded build is refused (exit $code, #1214)") (
            $code -ne 0 -and $o -match 'not the build this release recorded' -and $o -match 'dist_back/skymp5-server\.js in .* is not the build')
        Yes '  before anything went to the box: no ssh, no scp' (-not (Test-Path -LiteralPath $dsCalls))
        if ($script:fail -gt $failed) { Write-Host (($o -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 12) -join "`n") }
    } finally {
        $env:PATH = $oldPath
        Remove-Item Env:\TS_DS_CALLS -ErrorAction SilentlyContinue
    }

    # ---- -GamemodeOnly on the box: the blocks (#1089) ------------------------
    # The box's own settings, copied into the stage unchanged by the keep
    # block, check out; and a key that moves on the running server between the
    # copy and the swap puts the old files back, because no key may move.
    # The shape RecordShape.ps1 holds a server record to since #2180: without
    # sha256, bytes and files the deploy stopped at the record and none of the
    # -GamemodeOnly cases below reached the box.
    $gmBin = 'b' * 64
    $gmRecordLf = "{`n  `"binary`": `"scam_native.node`",`n  `"sha256`": `"$gmBin`",`n  `"bytes`": 5,`n  `"source`": { `"commit`": `"1234567890abcdef1234567890abcdef12345678`" },`n  `"files`": { `"scam_native.node`": { `"sha256`": `"$gmBin`", `"bytes`": 5 } }`n}`n"
    $gmRecordSum = Get-ThornswoodRecordSum ([Text.Encoding]::ASCII.GetBytes($gmRecordLf))
    Put (Join-Path $root 'server-build.json') $gmRecordLf.Replace("`n", "`r`n")
    $ownSettings = [IO.File]::ReadAllBytes((Join-Path $root 'server-settings.json'))
    $keepFor = { param([string]$sum) $settingsLibText + "`r`n" + $ThornswoodRecordSumText + "`r`n" + "`$WantRecord = '" + $sum + "'`r`n" + $settingsKeepBlock }
    $gmStage = '.stage-20261005-000801'
    $w = [ordered]@{}
    foreach ($k in 'gamemode.js', 'thornswood-build.json') {
        $t = '// gamemode only, staged'
        if ($k -ne 'gamemode.js') { $t = '{ "gamemode": "' + (Sha '// gamemode only, staged') + '" }' }
        Put (Join-Path $root ($gmStage + '\' + $k)) $t
        $w[$k] = Sha $t
    }
    $failed = $script:fail
    $out = RunFar (& $keepFor $gmRecordSum) $gmStage '.prev-20261005-000801' 30 $w @()
    $c = @($out | Where-Object { $_ -match '^CARRIED [0-9a-f]{64}$' })
    $staged = Join-Path $root ($gmStage + '\server-settings.json')
    Yes '-GamemodeOnly: the keep block copies the running server''s settings into the stage byte for byte, and hashes the copy' (
        $c.Count -eq 1 -and (Test-Path -LiteralPath $staged) -and
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($staged)) -eq [Convert]::ToBase64String($ownSettings) -and
        (($out -join "`n") -match 'keeps its own settings as they are'))
    if ($c.Count) { $w['server-settings.json'] = $c[0].Substring(8) }
    $out = RunFar $checkBlock $gmStage '.prev-20261005-000801' 30 $w @()
    Yes '  and a stage of gamemode.js, the stamp and those settings checks out' ($out -contains 'STAGE OK')
    if ($script:fail -gt $failed) { Show }
    $moved = [IO.File]::ReadAllText((Join-Path $root 'server-settings.json')) | ConvertFrom-Json
    $moved.thornswoodLoadOrderRefuse = $false
    Put (Join-Path $root 'server-settings.json') ($moved | ConvertTo-Json -Depth 8)
    # As it is, leaving out the stage, which the rollback clears.
    $before = ((Tree $root) -split "`n" | Where-Object { $_ -notmatch ('^\\' + [regex]::Escape($gmStage)) }) -join "`n"
    $running = Owner $P
    $failed = $script:fail
    $out = RunFar $swapBlock $gmStage '.prev-20261005-000801' 30 $w @()
    $said = $out -join "`n"
    Yes '  and when a key of the running settings moved after the copy, the swap is SWAP ROLLED BACK' ($out -contains 'SWAP ROLLED BACK')
    Yes '  naming the key, with nothing new started' (
        $said -match 'read back: thornswoodLoadOrderRefuse would not be what the server had' -and $said -notmatch 'started, giving it')
    Yes '  and every live file is back as it was, the server answering again' ((Tree $root) -eq $before -and (WaitUp $P) -and ((Owner $P) -ne $running))
    if ($script:fail -gt $failed) { Show }
    [IO.File]::WriteAllBytes((Join-Path $root 'server-settings.json'), $ownSettings)

    $before = Tree $root
    $w = [ordered]@{ 'gamemode.js' = (Sha '// gamemode only, staged') }
    Put (Join-Path $root '.stage-20261005-000901\gamemode.js') '// gamemode only, staged'
    $out = RunFar (& $keepFor ('ab' * 32)) '.stage-20261005-000901' '.prev-20261005-000901' 30 $w @()
    $failed = $script:fail
    Yes '  and a box whose server-build.json is not the commit''s record is CARRY REFUSED, the stage cleared' (
        ($out -contains 'CARRY REFUSED') -and (($out -join "`n") -match 'not the record the commit holds') -and (Tree $root) -eq $before)
    if ($script:fail -gt $failed) { Show }

    # ---- -GamemodeOnly, the whole script (#1089) -----------------------------
    # Deploy-Server.ps1 run in this shell, from a scratch repository, with ssh
    # and scp stand-ins that run what it sends against this scratch root in
    # PowerShell 7, the way the box would, with the box's fixed
    # places (the script folder, the deploy store) mapped into the scratch
    # folder. No -Dist: nothing is read out of a build on this machine.
    $gmRepo = Join-Path $work 'gm-repo'
    $gmFarTemp = Join-Path $work 'gm-far-temp'
    $gmStore = Join-Path $work 'gm-deploys'
    $null = [IO.Directory]::CreateDirectory($gmFarTemp)
    $null = [IO.Directory]::CreateDirectory($gmRepo)
    Copy-Item -LiteralPath (Join-Path $Here 'scripts') -Destination (Join-Path $gmRepo 'scripts') -Recurse
    Copy-Item -LiteralPath (Join-Path $Here 'layout.json') -Destination (Join-Path $gmRepo 'layout.json')
    Put (Join-Path $gmRepo 'scripts\vps\vps.json') '{ "address": "127.0.0.1" }'
    Put (Join-Path $gmRepo '.gitignore') "out/`n"
    Put (Join-Path $gmRepo 'game\gamemode.js') '// gamemode only, one'
    # And its tables (#5191), which the gamemode artifact carries with it.
    Put (Join-Path $gmRepo 'game\gamemode-tables\WAY_OUT.json') '{}'
    Put (Join-Path $gmRepo 'game\content\Thornswood-Content.esp') 'our plugin, two, longer'
    Put (Join-Path $gmRepo 'records\server-build.json') $gmRecordLf
    $gmPrelude = @"
function Get-ScheduledTask { [CmdletBinding()] param([string]`$TaskName) }
function Set-ScheduledTask { [CmdletBinding()] param([Parameter(ValueFromPipeline = `$true)]`$InputObject) }
function Stop-ScheduledTask { [CmdletBinding()] param([string]`$TaskName) }
function Start-ScheduledTask { [CmdletBinding()] param([string]`$TaskName)
  Start-Process -FilePath '$($node.Source)' -WindowStyle Hidden -ArgumentList '"$stub" "$root" "$pidLog"'
}

"@
    $global:TsGm = [pscustomobject]@{ BoxPs = $boxPs; FarTemp = $gmFarTemp; Store = $gmStore; Work = $work; Prelude = $gmPrelude
                                      Ssh = (New-Object Collections.Generic.List[string]); Scp = (New-Object Collections.Generic.List[string]) }
    function global:TsGmMap([string]$s) {
        return $s.Replace('C:/Windows/Temp/', ($global:TsGm.FarTemp + '\')).Replace('C:\Windows\Temp\', ($global:TsGm.FarTemp + '\')).
                  Replace('C:/Thornswood-Deploys', $global:TsGm.Store.Replace('\', '/')).Replace('C:\Thornswood-Deploys', $global:TsGm.Store)
    }
    function global:ssh {
        $in = @($input)
        $cmd = [string]@($args)[-1]
        $body = ''
        $m = [regex]::Match($cmd, 'EncodedCommand\s+(\S+)')
        if ($m.Success) {
            $body = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))
            # A long script goes by scp to a copy of its own, which
            # Send-Script.ps1's runner takes off the box and runs (#3059), so
            # it is read from there and taken off the same way.
            $r = [regex]::Match($body, "^\`$ThornswoodRunFile = '(C:\\Windows\\Temp\\thornswood-remote-[0-9a-f]{32}\.ps1)'")
            if ($r.Success) { $copy = TsGmMap $r.Groups[1].Value; $body = [IO.File]::ReadAllText($copy); Remove-Item -LiteralPath $copy -Force }
            $body = TsGmMap $body
        }
        else {
            $m = [regex]::Match($cmd, '-File\s+(\S+)\s*$')
            if ($m.Success) { $body = TsGmMap ([IO.File]::ReadAllText((TsGmMap $m.Groups[1].Value))) }
            else {
                $m = [regex]::Match($cmd, '-Command\s+(.*)$')
                if ($m.Success) { $body = TsGmMap $m.Groups[1].Value }
            }
        }
        [void]$global:TsGm.Ssh.Add($body)
        $f = Join-Path $global:TsGm.Work ('gm-far-' + [Guid]::NewGuid().ToString('N') + '.ps1')
        [IO.File]::WriteAllText($f, ($global:TsGm.Prelude + $body), (New-Object Text.UTF8Encoding($true)))
        $eap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $o = @(& $global:TsGm.BoxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $f 2>&1 | ForEach-Object { "$_".TrimEnd() }) }
        finally { $ErrorActionPreference = $eap }
        $code = $LASTEXITCODE
        Remove-Item -LiteralPath $f -Force -EA SilentlyContinue
        foreach ($l in $o) { $l }
        $global:LASTEXITCODE = $code
    }
    function global:scp {
        $all = @($args | ForEach-Object { [string]$_ })
        $global:LASTEXITCODE = 1
        $m = [regex]::Match($all[-1], '^[^@\s]+@[^:\s]+:(.+)$')
        if (-not $m.Success) { return }
        $to = TsGmMap $m.Groups[1].Value
        [void]$global:TsGm.Scp.Add($to)
        if (-not (Test-Path -LiteralPath (Split-Path -Parent $to))) { return }
        Copy-Item -LiteralPath $all[-2] -Destination $to -Force
        $global:LASTEXITCODE = 0
    }
    function GmCommit {
        $eap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            if (-not (Test-Path -LiteralPath (Join-Path $gmRepo '.git'))) { & git -C $gmRepo init -q 2>&1 | Out-Null }
            & git -C $gmRepo add -A 2>&1 | Out-Null
            & git -C $gmRepo -c user.name=harness -c user.email=harness@invalid -c commit.gpgsign=false commit -q -m step 2>&1 | Out-Null
        } finally { $ErrorActionPreference = $eap }
    }
    function GmDeploy([hashtable]$more = @{}) {
        $a = @{ Vps = '127.0.0.1'; User = 'test'; Root = $root; Task = 'Thornswood Test Swap'; Wait = 30; Now = $true; GamemodeOnly = $true }
        foreach ($k in $more.Keys) { $a[$k] = $more[$k] }
        foreach ($k in @($a.Keys)) { if ($null -eq $a[$k]) { $a.Remove($k) } }
        $script:gmSshBefore = $global:TsGm.Ssh.Count
        $script:gmScpBefore = $global:TsGm.Scp.Count
        $global:LASTEXITCODE = 0
        $threw = ''
        $lines = New-Object Collections.Generic.List[string]
        try { & (Join-Path $gmRepo 'scripts\deploy\Deploy-Server.ps1') @a *>&1 | ForEach-Object { [void]$lines.Add("$_") } }
        catch { $threw = $_.Exception.Message }
        $script:lastFar = @($lines) + @($threw)
        return [pscustomobject]@{ Ok = ((-not $threw) -and $global:LASTEXITCODE -eq 0); Said = ($script:lastFar -join "`n"); Threw = $threw
                                  Ssh = ($global:TsGm.Ssh.Count - $script:gmSshBefore); Scp = ($global:TsGm.Scp.Count - $script:gmScpBefore)
                                  # What scp put anywhere but a script's own copy. A read whose
                                  # command line is past Send-Script.ps1's limit goes by scp to
                                  # a copy its runner takes off before it runs (16 Oct: the
                                  # -GamemodeOnly read is 7,020 characters encoded, past the
                                  # 6,000 limit; #3059), which sends nothing to the server.
                                  Sent = @($global:TsGm.Scp | Select-Object -Skip $script:gmScpBefore | Where-Object { (Split-Path -Leaf $_) -notmatch '^thornswood-remote-[0-9a-f]{32}\.ps1$' }).Count }
    }
    function Text([string]$path) { if (Test-Path -LiteralPath $path) { return [IO.File]::ReadAllText($path) }; return $null }
    function Prevs { return @(Get-ChildItem -LiteralPath $root -Directory -Force | Where-Object { $_.Name -like '.prev-*' } | Sort-Object Name | ForEach-Object { $_.FullName }) }
    # What a gamemode-only deploy may change in the live folder: the three
    # files it swaps, our plugin, the record the box writes of what it runs,
    # and the .prev and .stage folders. Everything else must stay byte for byte.
    function Untouched([string]$dir) {
        $rows = @()
        foreach ($l in ((Tree $dir) -split "`n")) {
            if ($l -match '^\\(gamemode\.js|thornswood-build\.json|server-settings\.json|plugins\\Thornswood-Content\.esp|data\\thornswood-deploy\.json)\|' -or
                $l -match '^\\\.(prev|stage|undone)-') { continue }
            $rows += $l
        }
        return ($rows -join "`n")
    }

    try {
        Yes '-GamemodeOnly, whole: ssh and scp are the stand-ins here, so nothing can reach a server' (
            (Get-Command ssh).CommandType -eq 'Function' -and (Get-Command scp).CommandType -eq 'Function')
        GmCommit
        Put (Join-Path $root 'plugins\Thornswood-Content.esp') 'our plugin, one'
        # The kept .prev an earlier case left, dated 2099 so it is the newest,
        # goes, so the put-backs below take the folders these runs made.
        Get-ChildItem -LiteralPath $root -Directory -Force | Where-Object { $_.Name -like '.prev-2099*' } |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
        $origGamemode = Text (Join-Path $root 'gamemode.js')
        $origStamp = Text (Join-Path $root 'thornswood-build.json')

        # Refused with nothing asked of the box: the switches that set a setting.
        foreach ($case in @(@{ Label = '-RequirePass on'; More = @{ RequirePass = 'on' }; Why = 'sets no setting' },
                            @{ Label = '-Devs'; More = @{ Devs = [long[]]@(123) }; Why = 'sets no setting' },
                            @{ Label = '-PutBack'; More = @{ PutBack = $true }; Why = 'Run it without -GamemodeOnly' })) {
            $before = Tree $root
            $r = GmDeploy $case.More
            $failed = $script:fail
            Yes ('-GamemodeOnly with ' + $case.Label + ' is refused before the box is asked anything: no ssh, no scp') (
                (-not $r.Ok) -and $r.Said -match $case.Why -and $r.Ssh -eq 0 -and $r.Scp -eq 0 -and (Tree $root) -eq $before)
            if ($script:fail -gt $failed) { Show }
        }

        # Refused after one read of the box, with nothing sent: a box that runs
        # another server build, and one whose join pass switch is neither.
        Put (Join-Path $root 'server-build.json') $gmRecordLf.Replace('1234567890abcdef', 'fedcba0987654321')
        $before = Tree $root
        $running = Owner $P
        $r = GmDeploy
        $failed = $script:fail
        Yes '-GamemodeOnly onto a box whose server-build.json is not the commit''s record is refused, naming both builds' (
            (-not $r.Ok) -and $r.Said -match 'runs another server build \(commit fedcba09\)' -and $r.Said -match 'commit 12345678' -and
            $r.Said -match 'Nothing was sent and the server was not touched')
        Yes '  after reading the box and nothing sent: no file to the server or the store, the live folder and the server as they were' (
            $r.Ssh -ge 1 -and $r.Sent -eq 0 -and -not (Test-Path -LiteralPath $gmStore) -and (Tree $root) -eq $before -and (Owner $P) -eq $running)
        if ($script:fail -gt $failed) { Show }
        Put (Join-Path $root 'server-build.json') $gmRecordLf.Replace("`n", "`r`n")
        $passOff = [IO.File]::ReadAllText((Join-Path $root 'server-settings.json')) | ConvertFrom-Json
        $passOff.thornswoodRequirePass = 'yes'
        Put (Join-Path $root 'server-settings.json') ($passOff | ConvertTo-Json -Depth 8)
        $before = Tree $root
        $r = GmDeploy
        $failed = $script:fail
        Yes '-GamemodeOnly onto a box whose join pass switch is neither true nor false is refused the same way (#1319)' (
            (-not $r.Ok) -and $r.Said -match 'thornswoodRequirePass is neither true nor false' -and
            $r.Ssh -ge 1 -and $r.Sent -eq 0 -and -not (Test-Path -LiteralPath $gmStore) -and (Tree $root) -eq $before)
        if ($script:fail -gt $failed) { Show }
        [IO.File]::WriteAllBytes((Join-Path $root 'server-settings.json'), $ownSettings)

        # A good one, with our plugin of another size on the box. The box's
        # record has CR LF where the commit's has LF: the same record.
        $before = Untouched $root
        $prevsBefore = Prevs
        $running = Owner $P
        $r = GmDeploy
        $said = $r.Said
        $failed = $script:fail
        Yes '-GamemodeOnly onto the build the commit records, its record checked out with CR LF, is SWAP OK and PASS' (
            $r.Ok -and $said -match 'SWAP OK' -and $said -match 'PASS\. The server is up at 127\.0\.0\.1')
        if ($script:fail -gt $failed) { Show }
        $new = @(Prevs | Where-Object { $prevsBefore -notcontains $_ })
        $kept = @()
        if ($new.Count -eq 1) { $kept = @(Get-ChildItem -LiteralPath $new[0] -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($new[0].Length + 1) } | Sort-Object) }
        Yes '  and swapped only gamemode.js, the stamp, the box''s own settings and our plugin, which had another size' (
            ($kept -join ',') -eq 'gamemode.js,plugins\Thornswood-Content.esp,server-settings.json,thornswood-build.json' -and
            $said -match 'swapped in 4 file\(s\)')
        Yes '  and the settings live are the server''s own, byte for byte, read back with no key allowed to move' (
            [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'server-settings.json'))) -eq [Convert]::ToBase64String($ownSettings) -and
            $said -match 'read back: every setting outside this release is the one the server had')
        $stampNow = (Text (Join-Path $root 'thornswood-build.json')) | ConvertFrom-Json
        Yes '  and the gamemode live is the commit''s, with a main stamp naming it' (
            (Text (Join-Path $root 'gamemode.js')) -eq '// gamemode only, one' -and $stampNow.channel -eq 'main' -and
            $stampNow.gamemodeSha256 -eq (Sha '// gamemode only, one'))
        Yes '  and our plugin is the repository''s, the old one kept in .prev' (
            (Text (Join-Path $root 'plugins\Thornswood-Content.esp')) -eq 'our plugin, two, longer' -and
            $new.Count -eq 1 -and (Text (Join-Path $new[0] 'plugins\Thornswood-Content.esp')) -eq 'our plugin, one')
        Yes '  and nothing else in the live folder moved: no server file, no record, no other plugin' ((Untouched $root) -eq $before)
        Yes '  and the box records the gamemode artifact, the server answering as a new process, the other untouched' (
            (Text (Join-Path $root 'data\thornswood-deploy.json')) -match 'gamemode-' -and
            @(Get-ChildItem -LiteralPath (Join-Path $gmStore 'gamemode') -Filter 'gamemode-*.zip' -EA SilentlyContinue).Count -eq 1 -and
            (WaitUp $P) -and ((Owner $P) -ne $running) -and ((Owner $Q) -eq $otherPid))
        if ($script:fail -gt $failed) { Show }

        # Our plugin now the same bytes (size and sha256, #2308): only the
        # gamemode, the stamp and the settings go, and the record the box had
        # goes into .prev with them.
        Put (Join-Path $gmRepo 'game\gamemode.js') '// gamemode only, two'
        GmCommit
        $prevsBefore = Prevs
        $r = GmDeploy
        $said = $r.Said
        $failed = $script:fail
        $new = @(Prevs | Where-Object { $prevsBefore -notcontains $_ })
        $kept = @()
        if ($new.Count -eq 1) { $kept = @(Get-ChildItem -LiteralPath $new[0] -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($new[0].Length + 1) } | Sort-Object) }
        Yes '-GamemodeOnly with our plugin the same bytes as the box''s sends it not, and swaps only the three' (
            $r.Ok -and $said -match 'our plugins \(Thornswood-Content\.esp[^)]*\) are on the VPS at the same bytes' -and $said -match 'swapped in 3 file\(s\)' -and
            ($kept -join ',') -eq 'data\thornswood-deploy.json,gamemode.js,server-settings.json,thornswood-build.json' -and
            (Text (Join-Path $root 'gamemode.js')) -eq '// gamemode only, two')
        if ($script:fail -gt $failed) { Show }

        # -PutBack, twice: the gamemode before, then the one before that and
        # the plugin it replaced.
        $r = GmDeploy @{ GamemodeOnly = $null; PutBack = $true }
        $failed = $script:fail
        Yes 'Deploy-Server -PutBack after it brings the previous gamemode and its stamp back, the server answering' (
            $r.Ok -and (Text (Join-Path $root 'gamemode.js')) -eq '// gamemode only, one' -and
            ((Text (Join-Path $root 'thornswood-build.json')) | ConvertFrom-Json).gamemodeSha256 -eq (Sha '// gamemode only, one') -and (WaitUp $P))
        if ($script:fail -gt $failed) { Show }
        $r = GmDeploy @{ GamemodeOnly = $null; PutBack = $true }
        $failed = $script:fail
        Yes '  and once more brings back the gamemode and plugin from before the first, the settings unchanged throughout' (
            $r.Ok -and (Text (Join-Path $root 'gamemode.js')) -eq $origGamemode -and (Text (Join-Path $root 'thornswood-build.json')) -eq $origStamp -and
            (Text (Join-Path $root 'plugins\Thornswood-Content.esp')) -eq 'our plugin, one' -and
            [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'server-settings.json'))) -eq [Convert]::ToBase64String($ownSettings) -and
            (WaitUp $P) -and ((Owner $Q) -eq $otherPid))
        if ($script:fail -gt $failed) { Show }

        # ---- -FromStore, the whole script (#459) -------------------------------
        # The server build the commit records, out of the box's store, with no
        # build on this machine. The commit now records a build of every
        # server file (ServerBuild.ps1); the box runs the earlier record.
        . (Join-Path $Here 'scripts\deploy\ServerArtifact.ps1')
        $sbDir = Join-Path $work 'store-build'
        foreach ($kv in @(@('scam_native.node', 'the store''s binary'), @('dist_back\skymp5-server.js', '// the store''s JavaScript half'),
                          @('dist_back\skymp5-server.js.map', '{ "version": 3 }'), @('package.json', '{ "name": "skymp5-server" }'),
                          @('yarn.lock', '# yarn lockfile v1'), @('launch_server.bat', 'node dist_back/skymp5-server.js'),
                          @('data\scripts\ActiveMagicEffect.pex', 'compiled papyrus'))) { Put (Join-Path $sbDir $kv[0]) $kv[1] }
        $sbSums = Get-ThornswoodServerFolderSums $sbDir
        $sbFiles = [ordered]@{}
        foreach ($k in @($sbSums.Keys | Sort-Object)) { $sbFiles[$k] = [ordered]@{ sha256 = $sbSums[$k]; bytes = 1; commit = '1234567890abcdef1234567890abcdef12345678' } }
        $sbRecord = ([ordered]@{ binary = 'scam_native.node'; sha256 = $sbSums['scam_native.node']; bytes = 1
                                 source = [ordered]@{ commit = '1234567890abcdef1234567890abcdef12345678' }; files = $sbFiles } | ConvertTo-Json -Depth 5) + "`n"
        Put (Join-Path $gmRepo 'records\server-build.json') $sbRecord
        GmCommit
        $sbArt = New-ThornswoodServerBuildArtifact -From $sbDir -Record (Join-Path $gmRepo 'records\server-build.json') -OutDir (Join-Path $work 'store-ci')

        $before = Tree $root
        $running = Owner $P
        $r = GmDeploy @{ GamemodeOnly = $null; FromStore = $true }
        $failed = $script:fail
        Yes '-FromStore whose build the store does not keep is refused, saying so' (
            (-not $r.Ok) -and $r.Said -match 'keeps no server build of 12345678 with the record this commit holds' -and $r.Said -match 'Nothing was sent and the server was not touched')
        Yes '  after reading the box, with nothing sent: no file to the server or the store, the live folder and the server as they were' (
            $r.Sent -eq 0 -and (Tree $root) -eq $before -and (Owner $P) -eq $running)
        if ($script:fail -gt $failed) { Show }

        $prevsBefore = Prevs
        $r = GmDeploy @{ GamemodeOnly = $null; FromStore = $true; ServerBuild = $sbArt.Zip }
        $said = $r.Said
        $failed = $script:fail
        Yes '-FromStore -ServerBuild sends the build to the store, takes it into the stage there, and is SWAP OK and PASS' (
            $r.Ok -and $said -match ([regex]::Escape('STORED ' + $sbArt.Name)) -and $said -match 'SWAP OK' -and $said -match 'PASS\. The server is up at 127\.0\.0\.1')
        Yes '  the build kept in the store by name, the bytes it was made with' ((Get-FileHash -LiteralPath (Join-Path $gmStore ('server\' + $sbArt.Name)) -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash -eq $sbArt.Sha256.ToUpperInvariant())
        $rootSums = Get-ThornswoodServerFolderSums $root
        Yes '  every server file live is the build the commit records, and so is the record' (
            @($sbFiles.Keys | Where-Object { $rootSums[$_] -ne $sbFiles[$_].sha256 }).Count -eq 0 -and (Text (Join-Path $root 'server-build.json')) -eq $sbRecord)
        Yes '  and the settings live are the server''s own, byte for byte, with no key allowed to move' (
            [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'server-settings.json'))) -eq [Convert]::ToBase64String($ownSettings) -and
            $said -match 'a server build out of the store changes none of them')
        $new = @(Prevs | Where-Object { $prevsBefore -notcontains $_ })
        Yes '  and what it replaced is in .prev, the old record among it' ($new.Count -eq 1 -and (Text (Join-Path $new[0] 'server-build.json')) -eq $gmRecordLf.Replace("`n", "`r`n"))
        Yes '  the server answering as a new process, the other untouched' ((WaitUp $P) -and ((Owner $P) -ne $running) -and ((Owner $Q) -eq $otherPid))
        if ($script:fail -gt $failed) { Show }
    } finally {
        Remove-Item -Path function:global:ssh, function:global:scp, function:global:TsGmMap -ErrorAction SilentlyContinue
        Remove-Variable -Name TsGm -Scope Global -ErrorAction SilentlyContinue
    }

    # ---- nothing to put back --------------------------------------------------
    $empty = Join-Path $work 'no-prev-root'
    Put (Join-Path $empty 'gamemode.js') '// nothing kept'
    $pre = SwapVars $empty 'Thornswood Test Swap' '.stage-none' '.undone-none' 4 ([ordered]@{})
    $f = Join-Path $work 'far-empty.ps1'
    [IO.File]::WriteAllText($f, ($pre + $putBackPick + $swapBlock), (New-Object Text.UTF8Encoding($true)))
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $out = @(& $boxPs -NoProfile -ExecutionPolicy Bypass -File $f 2>&1 | ForEach-Object { "$_".Trim() }) }
    finally { $ErrorActionPreference = $eap }
    Yes 'a root with no .prev folder is SWAP REFUSED, and stops nothing' (
        ($out -contains 'SWAP REFUSED') -and ($out -notcontains 'SWAP OK') -and
        -not (@($out | Where-Object { $_ -like 'stopped pid *' }).Count))
}
catch {
    Yes ('the runs finished without an error: ' + $_.Exception.Message) $false
}
finally {
    # Only the stubs this run started, by pid and by their command line, so a
    # pid Windows has handed to something else since is left alone.
    if (Test-Path -LiteralPath $pidLog) {
        foreach ($id in @(Get-Content -LiteralPath $pidLog)) {
            $proc = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$id) -EA SilentlyContinue
            if ($proc -and $proc.CommandLine -and $proc.CommandLine.Contains($work)) {
                Stop-Process -Id ([int]$id) -Force -EA SilentlyContinue
            }
        }
    }
    Start-Sleep -Milliseconds 300
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

Done
