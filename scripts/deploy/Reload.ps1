<#
  Reload.ps1

  A dev gamemode deploy that changes only gamemode.js puts the new one in
  place while the dev server runs, and the server loads it there, with nobody
  dropped and every NPC still in the world (#3196, Patrick's C on 22 Oct
  2026). Dot-sourced by Deploy-DevGamemode.ps1, after Swap.ps1.

  WHY. Every dev gamemode deploy stopped and started the dev server, and a
  start is the whole server: measured on dev on 22 Oct, it is off for 6 to 10
  seconds, everybody on it is dropped and reconnects to a respawn, the NPC
  cast takes 3 min 50 s to load again, and the server is steady about 7
  minutes after the start. None of that is needed for a gamemode change. The
  engine has always watched gamemode.js and loaded it again when it changes
  (skymp5-server ts/index.ts, setupGamemode), and the gamemode is written for
  that: it clears its own timers and keeps what it holds on globalThis. What
  was missing was a way for a deploy to know the reload worked, so the
  deploys restarted.

  HOW IT KNOWS. The engine at Thornswood's fork from #3196 says after every
  load of the gamemode, in server.log:

      [thornswood] gamemode client scripts <digest> (<n>), changed since the last load
      [thornswood] gamemode did not load; the error is above

  and the gamemode says what it is as it loads (game/gamemode.js, gamemodeId):

      [thornswood] gamemode.js is git blob <sha1>, <size> bytes

  and, from #5191, which tables it read with it (game/gamemode.js, tableFolder):

      [thornswood] gamemode tables are git tree <sha1>, <n> files, in <folder>

  So the block below notes where server.log ends, puts the new files in, and
  reads what the log says after that place: the new blob, the new tree, and
  then the client scripts line is the new gamemode loaded; "did not load", or
  a load of any other blob or tree, or nothing within $Wait seconds, is not. Then the old files go
  back the same way and the old blob has to load the same way. Only if that
  fails too is the server restarted, by the put-back swap (Swap.ps1) with
  those old files, which the caller runs.

  WHEN IT RELOADS, and otherwise the deploy restarts as before (the block
  says RELOAD NOT HERE, touching nothing, and why):
    - the run sends gamemode.js, the build stamp and the gamemode's tables
      and nothing else: a plugin, a load order or a setting is read by the
      server only at a start
    - the staged server-settings.json is the running one byte for byte
    - the gamemode the server loads is $Root\gamemode.js
    - the engine on the box says how a load went (the line above is in its
      dist_back\skymp5-server.js)
    - the server is running: something holds its UDP port
  -Restart on Deploy-DevGamemode.ps1 restarts anyway, and -PutBack always
  restarts.

  WHAT IT LEAVES. The files it replaces are copied into $Root\.prev-<stamp>
  first, gamemode.js, thornswood-build.json, server-settings.json and the
  gamemode-tables folder, the same set a swap moves there, so -PutBack puts a
  reload back the way it puts back a swap. The tables go in first, the folder
  in two renames (the old one out into the stage, the new one in), because
  the gamemode reads them only as it loads and nothing loads until
  gamemode.js goes in. Then each new file goes in with one File.Replace
  (ReplaceFile), the stamp first, so the gamemode the server loads is never
  half written and never absent. gamemode.js always goes in, a new file with
  a new write time, and that is what the engine loads again on: a change of
  tables alone is loaded the same way as a change of code. The newest two .prev and .undone folders are kept, as the swap keeps
  them.

  The people on the server are not warned: nobody is dropped. When the reload
  changed what their games run (a property or an event source the gamemode
  makes), the gamemode asks them to log in again, because the engine sends
  those to a game only when it logs in (game/gamemode.js, A RELOAD THAT
  CHANGED WHAT THE GAMES RUN).

  The block ends with one line the caller reads: RELOAD OK, RELOAD NOT HERE,
  RELOAD REFUSED (nothing was touched), RELOAD PUT BACK (the new one did not
  load and the old one is loaded again) or RELOAD FAILED (the old files are
  back on disk, kept in .prev, and the server did not load them either).

  Keep it ASCII: Windows PowerShell 5.1 at the far end reads the file Remote
  sends as ANSI. tests\test-3196-dev-reload.ps1 runs the block against a
  scratch folder with a stand-in engine.
#>

# Get-ThornswoodGamemodeBlob and Get-ThornswoodTablesTree, the ids the
# gamemode logs as it loads; their text goes up in front of the block below.
. (Join-Path $PSScriptRoot 'GamemodeId.ps1')

# ==== dev reload block ====
$reloadBlock = @'
$ProgressPreference = 'SilentlyContinue'
$stageDir = Join-Path $Root $Stage
$prevDir  = Join-Path $Root $Prev
$log      = Join-Path $Root 'server.log'
$gm       = Join-Path $Root 'gamemode.js'
# The files a reload may put in, in the order it puts them: the stamp first,
# so the gamemode is never loaded beside a stamp naming the one before it.
$Files    = @('thornswood-build.json', 'gamemode.js')
# The gamemode's tables (#5191), each sent as gamemode-tables/NAME.json and
# put in as the one folder, ahead of both.
$TablesDir = 'gamemode-tables'
$tables    = Join-Path $Root $TablesDir
$tableRels = @(@($Want.Keys) | Where-Object { $_.StartsWith($TablesDir + '/') })

function NotHere([string]$why) {
  'not reloading: ' + $why
  'RELOAD NOT HERE'
  exit 0
}

# ---- whether this deploy can be a reload --------------------------------
# Read only. Each refusal leaves the stage as it is, for the swap, which
# restarts the server with it.
$others = @(@($Want.Keys) | Where-Object { @($Files + 'server-settings.json') -notcontains $_ -and -not $_.StartsWith($TablesDir + '/') })
if ($others.Count) { NotHere ('this run also sends ' + ($others -join ', ') + ', which the server reads only at a start') }
if (-not $Want.Contains('gamemode.js')) { NotHere 'this run sends no gamemode.js' }
$runSettings = Join-Path $Root 'server-settings.json'
$stageSettings = Join-Path $stageDir 'server-settings.json'
if ((Get-FileHash -LiteralPath $runSettings -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $stageSettings -Algorithm SHA256).Hash) {
  NotHere 'the dev settings change, and the server reads them only at a start'
}
$s = $null
try { $s = [IO.File]::ReadAllText($runSettings) | ConvertFrom-Json } catch { NotHere ('the running server-settings.json does not read: ' + $_.Exception.Message) }
# Where the engine loads the gamemode from (skymp5-server ts/settings.ts): the
# settings' gamemodePath, else skymp5-gamemode\gamemode.js when that folder is
# there, else gamemode.js, each against the server's own folder.
$gp = 'gamemode.js'
if (Test-Path -LiteralPath (Join-Path $Root 'skymp5-gamemode') -PathType Container) { $gp = Join-Path 'skymp5-gamemode' 'gamemode.js' }
if ($s.PSObject.Properties.Name -contains 'gamemodePath' -and [string]$s.gamemodePath) { $gp = [string]$s.gamemodePath }
if (-not [IO.Path]::IsPathRooted($gp)) { $gp = Join-Path $Root $gp }
if ([IO.Path]::GetFullPath($gp) -ne [IO.Path]::GetFullPath($gm)) { NotHere ('the server loads its gamemode from ' + $gp + ', not ' + $gm) }
$engine = Join-Path (Join-Path $Root 'dist_back') 'skymp5-server.js'
$says = $false
try { $says = [IO.File]::ReadAllText($engine).Contains('[thornswood] gamemode did not load; the error is above') } catch { NotHere ('the engine at ' + $engine + ' does not read: ' + $_.Exception.Message) }
if (-not $says) { NotHere 'the engine on the box does not say how a gamemode load went (it needs the fork from Thornswood #3196)' }
$port = [int]$s.port
$up = @()
try { $up = @(Get-NetUDPEndpoint -EA Stop | Where-Object { $_.LocalPort -eq $port }) }
catch { NotHere ('the UDP ports could not be listed, so whether the server runs is not known: ' + $_.Exception.Message) }
if (-not $up.Count) { NotHere ('nothing holds UDP ' + $port + ', so the server is not running and starts with the new files') }

# ---- the log, from here on ---------------------------------------------
# What server.log says after this moment. server-log.js rolls it at midnight
# and at 4 MB by renaming it to server.log.<digits> and starting a new one
# (scripts\vps\Server-Log.js), so a roll is seen as a rolled name that was not
# there before: what followed this place is at the end of that file, and the
# rest is in the new server.log from its start. Each look reads up to the
# last whole line, and a server.log shorter than this place is one being
# rolled that moment, read at the next look.
$logAt = 0
$rolledSeen = @{}
$logTail = New-Object System.Collections.Generic.List[string]
function Rolled {
  @(Get-ChildItem -LiteralPath $Root -File -Force -Filter 'server.log.*' -EA SilentlyContinue |
    Where-Object { $_.Name -match '^server\.log\.\d+$' } | Sort-Object Name | ForEach-Object { $_.FullName })
}
function LogFrom([string]$f, [long]$at, [bool]$whole) {
  $h = $null
  try {
    $h = New-Object IO.FileStream($f, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $len = $h.Length
    if ($at -gt $len) { return $null }
    $null = $h.Seek($at, [IO.SeekOrigin]::Begin)
    $n = [int]($len - $at)
    $buf = New-Object byte[] $n
    $got = 0
    while ($got -lt $n) { $r = $h.Read($buf, $got, $n - $got); if ($r -le 0) { break }; $got += $r }
    $use = $got
    if (-not $whole) { $use = [Array]::LastIndexOf($buf, [byte]10, [Math]::Max(0, $got - 1)) + 1; if ($got -eq 0) { $use = 0 } }
    return @{ Text = [Text.Encoding]::UTF8.GetString($buf, 0, $use); End = $at + $use }
  } catch [IO.FileNotFoundException] { return $null }
  catch [IO.IOException] { return $null }
  finally { if ($h) { $h.Close() } }
}
function LogMark {
  foreach ($f in Rolled) { $script:rolledSeen[$f] = $true }
  $script:logAt = 0
  if (Test-Path -LiteralPath $log) { $script:logAt = (Get-Item -LiteralPath $log).Length }
}
function LogLines {
  $text = ''
  foreach ($f in Rolled) {
    if ($rolledSeen.ContainsKey($f)) { continue }
    $script:rolledSeen[$f] = $true
    $r = LogFrom $f $logAt $true
    if ($r) { $text += $r.Text }
    $script:logAt = 0
  }
  $r = LogFrom $log $logAt $false
  if ($r) { $text += $r.Text; $script:logAt = $r.End }
  foreach ($l in @($text -split "`r?`n")) {
    if (-not $l) { continue }
    $logTail.Add($l)
    if ($logTail.Count -gt 30) { $logTail.RemoveAt(0) }
    $l
  }
}
# Waits for the gamemode with this blob to load, with the tables of this tree
# ('' is a folder this deploy does not hold it to). $loadSaid holds the lines
# that said how it went; the answer is LOADED or the reason it did not.
$loadSaid = New-Object System.Collections.Generic.List[string]
function AwaitLoad([string]$blob, [string]$tree) {
  $loadSaid.Clear()
  $until = (Get-Date).AddSeconds($Wait)
  $last = ''
  $lastTree = ''
  while ($true) {
    foreach ($l in @(LogLines)) {
      if ($l -match 'gamemode\.js is git blob ([0-9a-f]{40})') { $last = $Matches[1]; $lastTree = ''; $loadSaid.Add($l) }
      elseif ($l -match 'gamemode tables are git tree ([0-9a-f]{40})') { $lastTree = $Matches[1]; $loadSaid.Add($l) }
      elseif ($l.Contains('[thornswood] gamemode client scripts ')) {
        $loadSaid.Add($l)
        if ($last -ne $blob) {
          if ($last) { return ('a different gamemode loaded, git blob ' + $last) }
          return 'a gamemode loaded without saying which it is'
        }
        if ($tree -and $lastTree -ne $tree) {
          if ($lastTree) { return ('the gamemode loaded a different set of tables, git tree ' + $lastTree) }
          return 'the gamemode loaded without saying which tables it read'
        }
        return 'LOADED'
      }
      elseif ($l.Contains('[thornswood] gamemode did not load') -or $l.Contains('Bad syntax, ignoring')) {
        $loadSaid.Add($l)
        return 'it did not load'
      }
    }
    if ((Get-Date) -gt $until) { return ('nothing in server.log said it loaded within ' + $Wait + ' seconds') }
    Start-Sleep -Milliseconds 500
  }
}

# One file into place in one step: ReplaceFile over the one there, a move
# when there is none. $putWhy says why when Windows refuses.
$putWhy = ''
function PutIn([string]$from, [string]$to) {
  $script:putWhy = ''
  try {
    # [NullString]::Value, since a $null handed to a string is '' and no
    # backup file is wanted: the copy in .prev is the one kept.
    if (Test-Path -LiteralPath $to) { [IO.File]::Replace($from, $to, [NullString]::Value) } else { [IO.File]::Move($from, $to) }
    return $true
  } catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    $script:putWhy = $e.Message.Trim()
    return $false
  }
}

# A folder from one place to another in one rename. $putWhy says why when
# Windows refuses.
function MoveDir([string]$from, [string]$to) {
  $script:putWhy = ''
  try { [IO.Directory]::Move($from, $to); return $true }
  catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    $script:putWhy = $e.Message.Trim()
    return $false
  }
}

$oldBlob = Get-ThornswoodGamemodeBlob $gm
$oldTree = Get-ThornswoodTablesTree $tables
# The tables the new gamemode has to load with: the ones sent, or the ones
# there when none are.
$wantTree = $oldTree
if ($tableRels.Count) { $wantTree = $NewTree }
$changes = ($oldBlob -ne $NewBlob) -or ($wantTree -ne $oldTree)

# ---- the reload ------------------------------------------------------------
# The nightly backup reads this server's folder; one of the two at a time
# (#3247), the turn a swap takes, held until this block ends.
$turnWhy = ''
try { $serverTurn = Enter-ThornswoodServerFolderTurn (Join-Path (Split-Path -Parent $Root.TrimEnd('\')) 'Thornswood-Backup') ('a gamemode reload in ' + $Root) 1200 { param($m) Write-Host $m } }
catch { $turnWhy = $_.Exception.Message }
if ($turnWhy) {
  $turnWhy + ', so nothing was put in'
  Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
  'RELOAD REFUSED'
  exit 1
}

# What it replaces, copied into .prev first, the set a swap would move there.
try {
  $null = New-Item -ItemType Directory -Path $prevDir -Force
  foreach ($rel in @($Files + 'server-settings.json')) {
    $at = Join-Path $Root $rel
    if (Test-Path -LiteralPath $at) { [IO.File]::Copy($at, (Join-Path $prevDir $rel), $true) }
  }
  if ($tableRels.Count -and (Test-Path -LiteralPath $tables -PathType Container)) {
    $keep = Join-Path $prevDir $TablesDir
    $null = New-Item -ItemType Directory -Path $keep -Force
    foreach ($f in @(Get-ChildItem -LiteralPath $tables -File -Force)) { [IO.File]::Copy($f.FullName, (Join-Path $keep $f.Name), $true) }
  }
} catch {
  'could not keep the running files in ' + $prevDir + ': ' + $_.Exception.Message + ', so nothing was put in'
  Remove-Item -LiteralPath $prevDir -Recurse -Force -EA SilentlyContinue
  Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
  'RELOAD REFUSED'
  exit 1
}
if ($tableRels.Count -and $oldTree) { 'the running gamemode is git blob ' + $oldBlob + ' with tables git tree ' + $oldTree + '; they and its stamp are kept in ' + $prevDir }
else { 'the running gamemode is git blob ' + $oldBlob + '; it and its stamp are kept in ' + $prevDir }

LogMark
$placed = @()
$why = ''
# The tables first: the old folder into the stage, where the way back finds
# it, and the new one in. A first deploy with tables has no old folder.
$tablesWas = Join-Path $stageDir ($TablesDir + '.was')
$tablesIn = $false
if ($tableRels.Count) {
  $hadTables = Test-Path -LiteralPath $tables -PathType Container
  if ($hadTables -and -not (MoveDir $tables $tablesWas)) { $why = 'could not move the running tables out of the way: ' + $putWhy }
  elseif (-not (MoveDir (Join-Path $stageDir $TablesDir) $tables)) {
    $why = 'could not put the new tables in place: ' + $putWhy
    if ($hadTables -and -not (MoveDir $tablesWas $tables)) { $why += '; AND COULD NOT PUT THE RUNNING TABLES BACK: ' + $putWhy }
  } else { $tablesIn = $true }
}
foreach ($rel in $Files) {
  if ($why) { break }
  if (-not $Want.Contains($rel)) { continue }
  if (-not (PutIn (Join-Path $stageDir $rel) (Join-Path $Root $rel))) { $why = 'could not put the new ' + $rel + ' in place: ' + $putWhy; break }
  $placed += $rel
}
$withTables = ''
if ($wantTree) { $withTables = ' with tables git tree ' + $wantTree }
if (-not $why -and -not $changes) {
  'the server already runs git blob ' + $NewBlob + $withTables + ', so it has nothing to load; the stamp is the new one'
}
if (-not $why -and $changes) {
  'put in git blob ' + $NewBlob + $withTables + ', waiting up to ' + $Wait + ' seconds for the server to load it'
  $got = AwaitLoad $NewBlob $wantTree
  foreach ($l in $loadSaid) { '  ' + $l }
  if ($got -ne 'LOADED') { $why = 'the new gamemode did not take: ' + $got }
}
if (-not $why) {
  if ($changes) { 'PASS: the dev server loaded git blob ' + $NewBlob + $withTables + ' without a restart' }
  Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
  # The last two sets of replaced files stay, newest first by their stamp,
  # and the last two a -PutBack took out, as after a swap.
  foreach ($kind in '.prev-*', '.undone-*') {
    $pastTwo = @(Get-ChildItem -LiteralPath $Root -Directory -Force |
      Where-Object { $_.Name -like $kind } | Sort-Object Name -Descending | Select-Object -Skip 2)
    foreach ($pd in $pastTwo) {
      try { Remove-Item -LiteralPath $pd.FullName -Recurse -Force -ErrorAction Stop }
      catch { 'PRUNE FAILED: could not remove ' + $pd.FullName + ', one of the old copies past the newest 2: ' + $_.Exception.Message }
    }
  }
  'RELOAD OK'
  exit 0
}

# ---- the way back ----------------------------------------------------------
# The old files go back the way the new ones came, from their copies in
# .prev through the stage, and the old gamemode has to load again.
$why
if ($logTail.Count -and $changes -and $placed -contains 'gamemode.js') { '--- server.log since the new gamemode went in, last 30 ---'; $logTail }
'putting the previous files back'
$clean = $true
$back = @($placed)
[array]::Reverse($back)
LogMark
# The tables first, as they went in: the new folder back out into the stage,
# and the one that ran back from where it was moved.
if ($tablesIn) {
  if (-not (MoveDir $tables (Join-Path $stageDir ($TablesDir + '.new')))) { 'COULD NOT TAKE THE NEW TABLES BACK OUT: ' + $putWhy; $clean = $false }
  elseif ((Test-Path -LiteralPath $tablesWas -PathType Container) -and -not (MoveDir $tablesWas $tables)) { 'COULD NOT PUT THE OLD TABLES BACK: ' + $putWhy; $clean = $false }
}
foreach ($rel in $back) {
  $kept = Join-Path $prevDir $rel
  if (-not (Test-Path -LiteralPath $kept)) { continue }
  try { [IO.File]::Copy($kept, (Join-Path $stageDir $rel), $true) }
  catch { 'COULD NOT STAGE THE OLD ' + $rel + ': ' + $_.Exception.Message; $clean = $false; continue }
  if (-not (PutIn (Join-Path $stageDir $rel) (Join-Path $Root $rel))) { 'COULD NOT PUT THE OLD ' + $rel + ' BACK: ' + $putWhy; $clean = $false }
}
$loaded = $true
if ($clean) {
  $now = Get-ThornswoodGamemodeBlob $gm
  $nowTree = Get-ThornswoodTablesTree $tables
  if ($now -ne $oldBlob) { 'gamemode.js is git blob ' + $now + ' after the put-back, not the old ' + $oldBlob; $clean = $false }
  elseif ($nowTree -ne $oldTree) { 'the tables are git tree ' + $nowTree + ' after the put-back, not the old ' + $oldTree; $clean = $false }
  elseif ($changes -and $placed -contains 'gamemode.js') {
    'the old gamemode is back on disk, waiting up to ' + $Wait + ' seconds for the server to load it'
    $got = AwaitLoad $oldBlob $oldTree
    foreach ($l in $loadSaid) { '  ' + $l }
    if ($got -ne 'LOADED') { 'the old gamemode did not take either: ' + $got; $loaded = $false }
  }
}
Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
if ($clean -and $loaded) {
  Remove-Item -LiteralPath $prevDir -Recurse -Force -EA SilentlyContinue
  'the dev server runs the gamemode it ran before, git blob ' + $oldBlob + ', and was never stopped'
  'RELOAD PUT BACK'
} else {
  'what it ran before is kept in ' + $prevDir + ', for the put-back swap to start the server with'
  'RELOAD FAILED'
}
exit 1
'@
# ==== end dev reload block ====

# The block's values: the swap's (SwapVars), the blob it waits for, and the
# git tree of the tables it sends ('' for a run that sends none). The
# folders' turn (#3247) and the blob and tree functions go in front, as text,
# so the box has them.
function ReloadVars([string]$farRoot, [string]$taskName, [string]$stageName, [string]$prevName, [int]$waitSeconds, $sums, [string]$newBlob, [string]$newTree = '') {
  if ($newBlob -notmatch '^[0-9a-f]{40}$') { throw ('not a git blob id: ' + $newBlob) }
  $sendsTables = @(@($sums.Keys) | Where-Object { $_.StartsWith('gamemode-tables/') }).Count -gt 0
  if ($sendsTables -and $newTree -notmatch '^[0-9a-f]{40}$') { throw ('the run sends tables, and this is not a git tree id: ' + $newTree) }
  if (-not $sendsTables -and $newTree) { throw 'a tables tree was given for a run that sends no tables' }
  return (SwapVars $farRoot $taskName $stageName $prevName $waitSeconds $sums) + ('$NewBlob = ''' + $newBlob + '''' + "`r`n") + ('$NewTree = ''' + $newTree + '''' + "`r`n")
}
$ThornswoodGamemodeBlobText = 'function Get-ThornswoodGamemodeBlob {' + "`n" + (Get-Command Get-ThornswoodGamemodeBlob).Definition + "`n}`r`n" +
  'function Get-ThornswoodTablesTree {' + "`n" + (Get-Command Get-ThornswoodTablesTree).Definition + "`n}`r`n"
$reloadBlock = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'ServerFolderTurn.ps1')) + "`r`n" + $ThornswoodGamemodeBlobText + $reloadBlock
