<#
  Wipe-Saves.ps1

      .\scripts\ops\Wipe-Saves.ps1

  Starts the world over. Everybody begins again, nothing is claimed, nothing
  has been looted, and every container in the province is holding what
  Bethesda put in it.

  Patrick, 21 September: "we also need an easy way to start the world from
  scratch so all of the property is unclamied, things arent looted, etc so when
  we test things and when launch out of Alpha". This is that, and it is this
  script rather than a second one beside it, because a second one would have
  overlapped this by three quarters and the two would have drifted apart.

  THESE MOVE, and between them they are the whole of what the world
  remembers about the characters in it:

    world                    the changeform database. Every reference the
                             server has ever written to: what is in each
                             container, what has been picked up, which chests
                             it emptied of weapons, who has had their starting
                             purse. Take this away and every chest in Skyrim is
                             full again and untouched.
    private\characters.json  who everybody is.
    private\property.json    who holds which building, which are locked, and
                             the ground each one covers; the notice boards'
                             posts, the hold ledgers and the drop boxes.
    private\farm-claims.json the farms on ground with no building on it.
    private\law.json         which character holds each hold office, and the
                             cell doors guards have turned.
    private\beds.json        who may sleep where tonight, and takings kept.
    private\embassy.json     the embassy and remnant rolls, by character.
    private\books.json       the faction and business books: owners, members,
                             their chat and the prices they sent the guild.
    private\last-left.json   when each character last left the world.
    private\take-limit.json  how much each character has taken from each
                             container lately.
    private\dungeon-rewards-ledger.json and its .initialized mark, every
                             dungeon chest's reservation and the character it
                             paid. Both go, so the next start makes a fresh
                             one, as on a first deploy: one without the other
                             stops the dungeon rewards.
    private\deleted-characters.json, a list of deleted characters the server
                             has not let go of yet (#2351). It names entries in
                             the registers above, so it goes aside with them
                             and comes back with them if the wipe is undone.
                             The new list this writes (below) carries its ids
                             over, so a deletion still waiting is not lost.
    private\trade-cargo.json the trade ships' register (#511): what each
                             hold carries and for which character, and the
                             staff list of ports and routes in force beside
                             it. The goods aboard came out of packs in the
                             world set aside, so they go aside with it, every
                             piece kept, and come back with it if the wipe is
                             undone. The staff list is in that copy too, for
                             staff to confirm again on the fresh world.
    private\trade-carts.json the trade carts' register (#3158), the same
                             shape for the carts, their cart stops and
                             roads, and who drives each cart on the road.
                             It goes aside with the ships' for the same
                             reason.
    private\furniture.json   the furniture set down in held buildings (#2679).
                             The pieces are references in the world, so the
                             register goes aside with it, or a fresh world
                             would stand last world's furniture again.
    private\market-stalls.json the market stalls (#3160): who keeps each
                             stall and what is laid out on it. The goods came
                             out of packs in the world set aside, so they go
                             aside with it, every piece kept; left, the
                             release list would end those stalls and put last
                             world's goods in the fresh world's drop boxes.

  The first two were here from the start. property.json and farm-claims.json
  were added on 21 September: without them a fresh world would have come up
  with every house still claimed by somebody who no longer exists. The rest
  were added on 17 October (#2351): each is a register the gamemode keeps
  that names characters, and a wipe that left them came up with offices, bed
  nights, roll places, book memberships and chest records held by
  characters that no longer exist, and with the embassy rolls pointing at
  form ids the new world hands to new characters.

  TWO STAY. private\mod-settings.json is each person's mod menu choices,
  not the world, and a profile keeps its id through a wipe, so the menu
  stays as they set it. private\merchant-ledger.json is the guild traders'
  purses and shelves, and the merchant code refuses to start without it
  (requireMerchantEvidence), so it is never moved by hand. A deleted
  character's supply waits, commission promises and waiting trade are let
  go by the purse service from the list (#2351, #2652), and so are a wiped
  character's (#2668): once everything is moved, each server gets a new
  private\deleted-characters.json (Release-List.ps1, the list Delete-Person
  writes) naming every character in the world it set aside, by form id only,
  since a profile keeps its id through a wipe and is never named. The parts
  whose registers were just set aside ($WipeDone: farms, property, embassy,
  dungeon, cargo, stalls, carts, books) are marked done in it. 'saves', server-log.js's
  part, is not among them, because mod-settings.json stays; it takes only
  what a profile holds, so Release-List marks it done when the list names
  no profile, which is so unless a deletion still waiting was carried over.
  So only the merchant ledger waits on it, and the first start lets go and
  deletes it. The fresh world hands those form ids to new characters, which
  is why it is written before that start and not left to chance. A server
  whose move did not finish gets no list. Season, the benches and the door
  are the server's, not anybody's, and so are the world stage
  (private\war.json, #513) and the company's terms
  (private\company-terms.json, #2695): both name nobody, because who moved
  or changed them is in the staff log (#2860, #2687).

  It does NOT delete anything. It stops the server, renames the storage out of
  the way with today's date on it, and starts the server again on an empty one.
  The old storage sits beside the new one for 30 days, which means a wipe you
  regret at midnight is a rename away from being undone instead of gone. Then
  the game server's server-log.js deletes it, by the date in its name, and
  says so in server.log (#3620, Patrick's B: the privacy page says a
  character is kept until a wipe, and the copy is a character too).

  Why a wipe is on the table at all: taking a plugin out of the middle of the
  load order shifts the index of every plugin below it, and SkyMP turns a form
  id into a plugin by that index. Stored character references made under the
  old numbering then point at the wrong plugin. A wipe is the version of that
  problem with no half broken characters in it.

  Stop before you run this if people are on. It puts them out.

  It asks you to type WIPE before it does anything. -Yes answers that, for a
  release being run start to finish without somebody sitting at it:

    .\Wipe-Saves.ps1          asks
    .\Wipe-Saves.ps1 -Yes     does not ask

  -Server dev or -Server main wipes only that server: the folder whose
  server-settings.json says thornswoodServer is that name (Deploy-DevGamemode
  writes dev, Deploy-Gamemode main). Without it every server on the box goes,
  as before. Added for #3078, where Patrick chose to wipe dev and leave main
  to its next wipe:

    .\Wipe-Saves.ps1 -Server dev

  The deploy gate runs that one as its Wipe-Dev verb (#3649), with -Yes and
  -NoPause and nothing a caller can add, so a cloud session starts dev over
  for a load order change without a key to the box:

    pwsh scripts/vps/Box-Run.ps1 -Line 'Wipe-Dev'

  Read-Host reads the console rather than standard input, so a wipe run from a
  script or from an agent cannot answer the question however it is fed: it comes
  back empty and the script stops with "Left alone.". That is the whole reason
  this switch exists, and it is a switch rather than the question going away,
  because the question is what stops a wipe nobody meant to run.
#>
[CmdletBinding()]
param(
  [string]$Vps  = '',
  [string]$User = '',
  # There was a -Task here naming one scheduled task. It is gone because the
  # tasks are now read off the box, one per server folder found, and a
  # parameter that no longer decides anything is worse than no parameter: it
  # reads like it works.
  [switch]$NoPause,
  # Only the server whose settings name it (thornswoodServer); every one when
  # left out. See the header.
  [ValidateSet('', 'dev', 'main')]
  [string]$Server = '',
  # Skip the typed confirmation. The list of what would go is still printed
  # first, so an unattended run still leaves a record of exactly what it took.
  [switch]$Yes
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
. (Join-Path $Here 'Release-List.ps1')
# The hold it writes while the servers are stopped (#5155), so the watchdog
# does not start them while their saves are moved.
. (Join-Path $Here '..\vps\ServerHold.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}
function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

$stamp = (Get-Date).ToString('yyyyMMdd-HHmm')
# What a wipe moves aside, in each server folder: the header says why each one.
$Moves = @('world', 'private\characters.json', 'private\property.json', 'private\furniture.json', 'private\farm-claims.json',
           'private\law.json', 'private\beds.json', 'private\embassy.json', 'private\books.json',
           'private\last-left.json', 'private\take-limit.json', 'private\trade-cargo.json', 'private\market-stalls.json',
           'private\trade-carts.json',
           'private\dungeon-rewards-ledger.json', 'private\dungeon-rewards-ledger.initialized',
           'private\deleted-characters.json', 'private\deleted-characters.taken.json', 'private\deleted-characters.taking.json')
# The release parts (game\gamemode.js PARTS) whose registers are all in
# $Moves, so a fresh start has nothing of anybody's in them: the new release
# list marks them done and only 'merchants', the ledger a wipe keeps, waits.
# Not 'saves': mod-settings.json stays (Release-List.ps1 marks it done for a
# list that names no profile, the only thing that part acts on).
$WipeDone = @('farms', 'property', 'embassy', 'dungeon', 'cargo', 'stalls', 'carts', 'books')
# Both lists go across as literals. A single quote inside either would end the
# string early on the far side, so it is doubled first.
function Lit($a) { return (($a | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ',') }
$movesLit = Lit $Moves
$wipeDoneLit = Lit $WipeDone

Write-Host ''
Write-Host '  THORNSWOOD  -  wipe the characters' -ForegroundColor White
Say "  on $Vps" 'DarkGray'

# ------------------------------------------------------------ what is there ---
Head 'What would go'
$lines = Remote @"
`$ErrorActionPreference = 'Continue'
`$roots = @()
foreach (`$d in (Get-ChildItem 'C:\' -Directory -EA SilentlyContinue)) {
  if (Test-Path (Join-Path `$d.FullName 'server-settings.json')) { `$roots += `$d.FullName }
}
if (`$roots.Count -eq 0) { 'NOROOT'; exit }
# Which scheduled task runs out of which folder, read off the task's own action
# rather than guessed from the folder name. The live one is 'Thornswood Server'
# and the dev one is 'Thornswood Dev Server', which no transform of
# 'Thornswood-Server-Dev' produces, so guessing it would stop the wrong server.
#
# Each task takes the LONGEST root its action mentions, not the first one that
# matches. C:\Thornswood-Server is a prefix of C:\Thornswood-Server-Dev, so a
# plain contains test gives the dev task the live folder, and on 22 September
# that stopped the dev server twice and moved the live world out from under a
# server that was still running.
`$taskOf = @{}
foreach (`$t in (Get-ScheduledTask -EA SilentlyContinue)) {
  foreach (`$a in @(`$t.Actions)) {
    `$line = "`$(`$a.Execute) `$(`$a.Arguments) `$(`$a.WorkingDirectory)"
    `$best = ''
    foreach (`$r in `$roots) {
      if (`$line -like ('*' + `$r + '*') -and `$r.Length -gt `$best.Length) { `$best = `$r }
    }
    if (`$best -ne '' -and -not `$taskOf.ContainsKey(`$best)) { `$taskOf[`$best] = `$t.TaskName }
  }
}
foreach (`$r in `$roots) {
  'ROOT|' + `$r
  # Which server this is, as its own settings say (-Server). Settings that
  # cannot be read are said, with why, so -Server never guesses past them.
  try {
    'NAME|' + `$r + '|' + [string]((Get-Content (Join-Path `$r 'server-settings.json') -Raw | ConvertFrom-Json).thornswoodServer)
  } catch {
    'NAMEERR|' + `$r + '|' + ("`$(`$_.Exception.Message)" -replace '[|\r\n]', ' ')
  }
  if (`$taskOf.ContainsKey(`$r)) { 'TASK|' + `$r + '|' + `$taskOf[`$r] } else { 'NOTASK|' + `$r }
  foreach (`$n in @($movesLit)) {
    `$p = Join-Path `$r `$n
    if (-not (Test-Path `$p)) { 'NONE|' + `$n; continue }
    `$b = 0; `$c = 0
    if ((Get-Item `$p).PSIsContainer) {
      foreach (`$f in (Get-ChildItem `$p -Recurse -File -EA SilentlyContinue)) { `$b += `$f.Length; `$c++ }
    } else {
      `$b = (Get-Item `$p).Length; `$c = 1
      # The cards are each character's row under who; any other file is not counted as people.
      if ((Split-Path -Leaf `$p) -eq 'characters.json') {
        try { 'CHARS|' + @((Get-Content `$p -Raw | ConvertFrom-Json).who.PSObject.Properties).Count } catch { }
      }
    }
    'ITEM|' + `$p + '|' + `$b + '|' + `$c
  }
}
"@

# Every root, not the last one. This held a single $root until 22 September,
# and the survey emits a ROOT line per server, so it kept whichever came last.
# On the VPS that is C:\Thornswood-Server-Dev, so every wipe ever run took the
# dev world, left the live world alone, and printed a list of both as though it
# had taken both. Nothing said otherwise and the live characters stayed.
$roots  = @()
$taskOf = @{}
$items  = @()
# -Server: which folders are that server, read before anything is listed, so
# the list says only what this run takes. Every line after a ROOT line is that
# root's, until the next.
$nameOf = @{}
foreach ($l in $lines) {
  $bits = "$l" -split '\|'
  if ($bits[0] -eq 'NAME') { $nameOf[$bits[1]] = $bits[2] }
  if ($bits[0] -eq 'NAMEERR') {
    # Unreadable settings could be the server asked for, so -Server stops
    # rather than leave it; with no -Server every folder goes anyway.
    if ($Server) { Die "The server settings at $($bits[1]) could not be read ($($bits[2])), so it is not known whether that folder is $Server. Nothing was wiped." }
    Say "  the server settings at $($bits[1]) could not be read ($($bits[2]))" 'Yellow'
  }
}
$keep = $true
foreach ($l in $lines) {
  $s = "$l"
  if ($s -eq 'NOROOT') { Die 'No server-settings.json anywhere under C:\ on that machine, so there is no server to wipe.' }
  $bits = $s -split '\|'
  if ($bits[0] -eq 'ROOT') {
    $keep = (-not $Server) -or ($nameOf[$bits[1]] -eq $Server)
    if (-not $keep) { Say "  server at $($bits[1]) is not $Server, so it is left as it is" 'DarkGray'; continue }
  }
  if (-not $keep) { continue }
  switch ($bits[0]) {
    'ROOT'   { $roots += $bits[1]; Say "  server at $($bits[1])" 'DarkGray' }
    'TASK'   { $taskOf[$bits[1]] = $bits[2]; Say ("    run by the '{0}' task" -f $bits[2]) 'DarkGray' }
    'NOTASK' { Say '    no scheduled task runs out of this folder, so it is moved but not restarted' 'Yellow' }
    'ITEM'  { $items += $bits[1]; Say ("  {0,8:n1} MB  {1}   ({2} file(s))" -f ([int64]$bits[2] / 1MB), $bits[1], $bits[3]) 'Yellow' }
    'CHARS' { Say ("  {0} character record(s) in characters.json" -f $bits[1]) 'Yellow' }
    'NONE'  { Say ("  not there: {0}" -f $bits[1]) 'DarkGray' }
  }
}
if ($Server -and -not $roots.Count) { Die "No server on that machine says thornswoodServer is $Server in its server-settings.json, so nothing was wiped." }
if ($items.Count -eq 0) { Die 'Nothing to wipe. Either it is already empty or the paths moved.' }

# ------------------------------------------------------------------- ask it ---
Write-Host ''
Say '  Every character anybody has made on this server goes back to nothing.' 'Red'
Say '  They are renamed rather than deleted, so this is undoable today, but' 'DarkGray'
Say '  anybody who logs in after it starts over and that part is not.' 'DarkGray'
Write-Host ''
if ($Yes) {
  Say '  -Yes was passed, so it is not asking. Going ahead.' 'Yellow'
}
else {
  $typed = Read-Host '  Type WIPE to go ahead'
  if ($typed -cne 'WIPE') { Die 'Left alone.' }
}

# ------------------------------------------------------------------- do it ---
$rootsLit = Lit $roots
$tasksLit = Lit @($roots | Where-Object { $taskOf.ContainsKey($_) } | ForEach-Object { $taskOf[$_] })

Head 'Stopping the servers'
<#
  NOTHING MOVES UNDER A SERVER THAT IS STILL RUNNING. A game server writes
  world and private while it runs, so a file moved from under it is written
  straight back, and the wipe is half done. Until 17 October this slept three
  seconds after ending the tasks and printed what it found still running by
  the program's path, which for the server is node.exe in Program Files and
  never matched, and moved everything anyway. Now: each task is ended, then
  every node or cmd whose command line names a server folder (with its
  trailing backslash, since C:\Thornswood-Server is a prefix of
  C:\Thornswood-Server-Dev), and the node each of those started, is ended
  too, the way Delete-Person.ps1 finds what runs from a folder. It is then
  asked again until none is left, ten seconds at most, and if any still is,
  the wipe stops here with nothing moved.
#>
$out = Remote @"
`$ErrorActionPreference = 'Continue'
$(Get-ThornswoodHoldScript -Script 'Wipe-Saves.ps1')
foreach (`$t in @($tasksLit)) {
  # Held until "Starting them again" below takes it away (#5155).
  Set-ThornswoodHold -Target `$t -Why 'wiping the saves' -By `$HoldBy
  `$null = & schtasks /end /tn `$t 2>&1
  'ended ' + `$t
}
function Holders {
  `$all = @(Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object { `$_.CommandLine })
  `$ids = @()
  foreach (`$r in @($rootsLit)) {
    `$mark = `$r.TrimEnd('\') + '\'
    foreach (`$p in `$all) {
      if (`$p.Name -match '^(node|cmd)(\d|\.)*\.exe$' -and `$p.CommandLine.IndexOf(`$mark, [StringComparison]::OrdinalIgnoreCase) -ge 0) { `$ids += [int]`$p.ProcessId }
    }
  }
  foreach (`$p in `$all) { if (`$p.Name -match '^node(\d|\.)*\.exe$' -and `$ids -contains [int]`$p.ParentProcessId) { `$ids += [int]`$p.ProcessId } }
  return @(`$ids | Where-Object { `$_ -gt 0 -and `$_ -ne `$PID } | Sort-Object -Unique)
}
foreach (`$id in @(Holders)) { Stop-Process -Id `$id -Force -EA SilentlyContinue; 'ended process ' + `$id }
for (`$i = 0; `$i -lt 20 -and @(Holders).Count; `$i++) { Start-Sleep -Milliseconds 500 }
`$still = @(Holders)
if (`$still.Count) { 'STILLRUNNING|' + (`$still -join ',') } else { 'stopped' }
"@
$running = $false
foreach ($l in $out) {
  if ("$l" -like 'STILLRUNNING|*') { $running = $true; Say ("  still running from a server folder after being stopped: process " + "$l".Substring(13)) 'Red' }
  else { Say "  $l" }
}
if ($running) {
  # Nothing was moved and nothing will start them from here, so the watchdog
  # watches them again at once (#5155).
  Remote @"
$(Get-ThornswoodHoldScript)
foreach (`$t in @($tasksLit)) { Clear-ThornswoodHold -Target `$t }
"@ | ForEach-Object { Say "  $_" }
  Die 'A server is still running, so nothing was moved. Find what holds the folder (the process above) and run this again.' }

Head 'Moving the old storage aside'
$moved = Remote @"
`$ErrorActionPreference = 'Continue'
$ThornswoodReleaseList
foreach (`$r in @($rootsLit)) {
`$failed = `$false
foreach (`$n in @($movesLit)) {
  `$p = Join-Path `$r `$n
  if (-not (Test-Path `$p)) { continue }
  `$leaf = Split-Path -Leaf `$p
  `$dir  = Split-Path -Parent `$p
  if (`$leaf -like '*.json') {
    # Each json file keeps its own name, or a fresh world would
    # come up with the property register saved as characters-before-<stamp>.
    `$to = Join-Path `$dir ((`$leaf -replace '[.]json$', '') + '-before-$stamp.json')
  }
  elseif (`$leaf -eq 'world') { `$to = Join-Path `$dir ('world-before-$stamp') }
  # Anything else (the dungeon ledger's .initialized mark) keeps its own name too.
  else { `$to = Join-Path `$dir (`$leaf + '-before-$stamp') }
  try { Move-Item -LiteralPath `$p -Destination `$to -Force -EA Stop; 'moved  ' + `$p + '  ->  ' + `$to }
  catch { `$failed = `$true; 'FAILED ' + `$p + '  ' + `$_.Exception.Message }
}
# The release list (#2668): every character in the world just set aside, by
# form id, with the ids of a list set aside carried over. Not on a server
# whose move did not finish, where a register marked done would still be there.
if (`$failed) { 'RELEASENOTE|' + `$r + ': no release list, because the move did not finish' }
else {
  `$cf = Join-Path `$r 'world-before-$stamp\changeForms'
  `$files = @()
  if (Test-Path -LiteralPath `$cf) {
    `$files = @(Get-ChildItem -LiteralPath `$cf -Filter *.json -File | Where-Object { `$_.BaseName -match '^[0-9]+`$' } | ForEach-Object { `$_.FullName })
  }
  `$found = Get-ThornswoodCharacterIds `$files
  `$found.notes
  # The lists set aside are carried: the requests, and what a server took and
  # had not finished (deleted-characters.taken.json, #4920), or was taking.
  Write-ThornswoodReleaseList -Root `$r -Actors `$found.ids -Carry @((Join-Path `$r 'private\deleted-characters-before-$stamp.json'), (Join-Path `$r 'private\deleted-characters.taken-before-$stamp.json'), (Join-Path `$r 'private\deleted-characters.taking-before-$stamp.json')) -Done @($wipeDoneLit)
}
}
"@
$bad = $false
foreach ($l in $moved) {
  $b = "$l" -split '\|'
  if ("$l" -match '^FAILED') { $bad = $true; Say "  $l" 'Red' }
  elseif ($b[0] -eq 'RELEASE') {
    if ($b[1] -eq 'none') { Say '  release list: nobody to name' 'DarkGray' }
    else { Say ("  release list: {0}, {1} character(s) and {2} profile(s) carried over; the first start lets the merchant ledger go of them" -f $b[1], $b[3], $b[2]) 'Green' }
  }
  elseif ($b[0] -eq 'RELEASENOTE') { Say "  $($b[1])" 'Yellow' }
  # Everything moved, so the wipe stands; what holds the list is said in red.
  elseif ($b[0] -eq 'RELEASEBAD') { Say "  $($b[1])" 'Red' }
  else { Say "  $l" 'Green' }
}
if ($bad) {
  Say '  The server is stopped. Start it again from the panel or re-run once' 'Yellow'
  Say '  whatever is holding those files has let go.' 'Yellow'
}

Head 'Starting them again'
$out = Remote @"
`$ErrorActionPreference = 'Continue'
$(Get-ThornswoodHoldScript)
foreach (`$t in @($tasksLit)) { `$null = & schtasks /run /tn `$t 2>&1 }
Start-Sleep -Seconds 12
# Started: the watchdog watches them again (#5155).
foreach (`$t in @($tasksLit)) { Clear-ThornswoodHold -Target `$t }
foreach (`$r in @($rootsLit)) {
  `$r
  `$cf = Join-Path `$r 'private\characters.json'
  if (Test-Path `$cf) {
    try { `$j = Get-Content `$cf -Raw | ConvertFrom-Json; '  now  ' + @(`$j.who.PSObject.Properties).Count + ' character record(s)' } catch { '  now  characters.json is there but unreadable yet' }
  } else { '  now  no characters.json yet, which is what empty looks like' }
  # The tail is read per server and only two lines each, because six lines of
  # one server's log was what made a wipe that touched one of them read as
  # though it had done the lot.
  `$lg = Join-Path `$r 'server.log'
  if (Test-Path `$lg) { Get-Content `$lg -Tail 2 | ForEach-Object { '  log  ' + `$_ } }
}
"@
foreach ($l in $out) { Say "  $l" 'DarkGray' }

Head 'Done'
Say '  The old storage is beside the new one with today''s date on it.' 'Green'
Say '  The game server deletes it 30 days from today and says so in server.log;' 'DarkGray'
Say '  until then it can be put back, as RESTORING.md in the ops repo says.' 'DarkGray'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
