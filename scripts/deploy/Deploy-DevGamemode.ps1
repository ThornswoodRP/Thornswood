<#
  Deploy-DevGamemode.ps1

  Sends game\gamemode.js to the dev server on the VPS, which loads it while it
  runs when nothing else changes, and otherwise restarts only that server.
  THE RELOAD, below, says when and how. The dev server is a copy of the live install on its own ports
  (vps-dev-instance.ps1: C:\Thornswood-Server-Dev, UDP/TCP 7787, resources
  7788, task 'Thornswood Dev Server').

  Deploy-Server.ps1 is for the live server and must not be pointed at the dev
  root. It would do two wrong things there: send server-settings.json
  rewritten from the local build, which carries the live port and name and
  would start the dev server on 7777 next to the live one, and stop every node
  process whose command line contains skymp5-server, which is the live server
  too. This script sends gamemode.js alone and stops only the process that is
  listening on the dev port.

    .\Deploy-DevGamemode.ps1        syntax check, copy, point at 7789,
                                   restart, tail the log

    .\Deploy-DevGamemode.ps1 -LoadOrder
                                   the same, and first send every plugin the
                                   dev server's own load order names that it
                                   does not hold at these bytes: our content
                                   plugin from this checkout, the rest from
                                   the collection (see WHERE THE ORDER COMES
                                   FROM below)

    .\Deploy-DevGamemode.ps1 -LoadOrder -Dist <built server folder>
                                   the same, with the load order a server
                                   build names, written over the dev one

    .\Deploy-DevGamemode.ps1 -LoadOrderRefuse on
                                   the same, and end a session whose plugins
                                   are not the server's (#402); off only warns

    .\Deploy-DevGamemode.ps1 -RequirePass on
                                   the same, and hold a session until its
                                   join pass arrives (#410); off lets it act
                                   meanwhile. A session with no pass is ended
                                   at three minutes either way (#937). A dev
                                   server whose settings hold neither true
                                   nor false is refused until this says which
                                   (#1319)

    .\Deploy-DevGamemode.ps1 -Npcs off
                                   the same, with no NPCs kept alive by the
                                   server; -Npcs on puts them back (#385)

    .\Deploy-DevGamemode.ps1 -Minutes 3
                                   a longer warning for the people on it
    .\Deploy-DevGamemode.ps1 -Mode restart
                                   tells them to log out, and puts out
                                   whoever is still on when it runs out
    .\Deploy-DevGamemode.ps1 -Now  no warning and no wait, which is what this
                                   did for everybody until 24 September

    .\Deploy-DevGamemode.ps1 -Restart
                                   stop and start the dev server even when only
                                   the gamemode changes

    .\Deploy-DevGamemode.ps1 -PutBack
                                   the files the last run replaced go back in,
                                   after the same warning, checked the same way

    .\Deploy-DevGamemode.ps1 -Note "The door answers on the first knock
    - The door no longer needs a second try before it opens."

  -Note is required on every deploy except -PutBack. It is the same shape
  Ship takes: a title, then "- " lines from the side of the person playing.
  It is the one parameter taken without its name, so a bare string after the
  script is the note; every other one is given by name (#1929).
  After a successful deploy it posts to the dev updates channel through
  Publish-Discord.ps1 -Dev -GamemodeDeploy, the same embed style as a dev
  Ship, with footer "dev server". Issue #594.

    .\Deploy-DevGamemode.ps1 -ShipFollows
                                   posts nothing, because the dev Ship run
                                   next carries the same change to the
                                   launcher and says it, once (#3320)

  A note that says again a title or line the dev feed or the dev updates
  channel has already had is refused before anything is sent
  (Note-Repeats.ps1, #3320). On 22 Oct a deploy and the Ship after it posted
  the same note twice, and that is what -ShipFollows is for: one change, one
  post, from the Ship.

  STAGED, CHECKED, THEN SWAPPED (issue #446). Nothing is copied over the
  running dev server any more. The new files and an edited copy of the dev
  settings go into $Root\.stage-<stamp> while it runs, the box checks them
  there, and only then is anybody warned and the server stopped. If it does
  not answer on its ports afterwards, the old files go back and this exits 1.
  What a run replaced is kept in $Root\.prev-<stamp>, the newest two, and
  -PutBack puts the newest back. See THE STAGE below and Swap.ps1.

  THE RELOAD (#3196, Patrick's C on 22 Oct 2026). A run that sends only
  gamemode.js and its stamp, to a dev server that is running an engine which
  says how a gamemode load went, with its settings unchanged, does not stop
  it: the new gamemode goes in while it runs, the engine loads it there, and
  this reads server.log until the server says the new gamemode loaded. Nobody
  is dropped, so nobody is warned, and the NPCs stay where they are. When it
  does not load, the old one goes back and has to load the same way, and the
  run fails with the server never stopped; when the old one does not load
  either, the dev server restarts with the old files, as -PutBack would. A
  run that also sends plugins or changes a setting restarts as before, since
  the server reads those only at a start, and -Restart restarts anyway.
  Reload.ps1 has the block and the measurements.

  A gamemode change that also changes the CHARGEN records needs
  Deploy-Gamemode.ps1 -Vortex first. Code-only changes do not.

  WHO IS ON, AND A WARNING BEFORE THE STOP.

  Stopping the dev server drops everybody on it. Their games reconnect when it
  comes back and a reconnect is a respawn, which from a chair is a teleport, a
  burst of equipping and an inventory that flashes. On 23 September this
  script did that to Patrick six times in an hour while he was testing: "I
  randomly teleportes as I was typing this and I heard the noise of things
  equipping", and then "I did the teleport thing again, it was while looking
  in the forge". The dev server.log has it: 'gamemode loaded' at 20:39:00.5
  and 'login ff000003 put 2 worn thing(s) back on' at 20:39:47.2, and the same
  pair at 20:44:05.0 and 20:44:52.1. About 47 seconds each time, and not one
  restart request in that log before either of them.

  So it now reads online.json on the dev box before anything is stopped and
  says how many are on, and who: the gamemode keeps their names in
  online-names.json in the private folder, not the served one. Nobody on
  means straight down, as before. Anybody on means
  the same warning Ship.ps1 and Deploy-Server.ps1 give: Request-Restart.ps1
  drops restart.json into the dev server's data folder, the dev gamemode
  announces it in chat and on screen, and this waits out the countdown before
  the stop, leaving early if the room empties. -Mode notice is the default,
  as it is in Deploy-Server, because it puts nobody out; -Mode restart asks
  them to log out and clears the room at zero.

  It will not stop a dev server with people on it without telling them. If
  the warning does not go out, or the box cannot say who is on, it stops
  there and the dev server is left running exactly as it was. -Now is how to
  take it down anyway, for a fix that cannot wait a minute.

  A server that is not running has nobody on it, whatever online.json says.
  The gamemode writes that file only when the count moves, so a killed or
  crashed process leaves its last count behind. The same read asks whether
  anything is on the dev game port, and nothing there means nobody on. And
  the stop removes any restart.json the old process never read, so the next
  one does not find it and count down on its own.

  THE LOAD ORDER, AND WHY -LoadOrder HAD TO EXIST.

  Until 22 September nothing in this repo could move a load order onto the dev
  server. Deploy-Server.ps1 is the live half and refuses this root on purpose.
  This script sent gamemode.js alone. The only thing that ever wrote the dev
  loadOrder was vps-dev-instance.ps1, which runs ON the VPS, copies from live,
  and nothing in the normal dev flow calls it. So the dev server kept whatever
  order it was built with while live moved on, and the client compares the two
  position by position and refuses the session on any disagreement.

  Measured on 22 September. Live was handing out 57 plugins and matched the
  game exactly. The dev server was handing out 60: the order from 21 September,
  still carrying Respawn - Death Overhaul.esp, SunHelmSurvival.esp,
  SunHelmDiseases.esp, TavernGames.esp and Hothtrooper44_Armor_Ecksstra.esp,
  and missing RaceCompatibility.esm and Playable Rieklings.esp. The lists part
  company at position 7 and everything after it is out of place. Its
  Thornswood-Content.esp was 151,288 bytes, which is the stale copy named in
  Deploy-Server.ps1's own comment as the one that stopped going to live that
  same day; the repo has been on 141,234 since. Four things for the launcher to
  find, and Play refused before the game ever started.

  -LoadOrder sends the plugins the load order names that the box does not
  hold at these bytes. With -Dist it rewrites the dev loadOrder to that
  build's, and nothing else about the dev settings is touched: the port, the
  name and the voice port stay the dev ones, which is the whole reason
  Deploy-Server.ps1 is refused here. That list goes up as a file rather than
  inside the settings block, so the dev settings file is edited in place the
  way everything else here edits it. Without -Dist the order is the dev
  server's own and is left as it is (WHERE THE ORDER COMES FROM, below).

  Our own plugin comes from the repo and not from a game folder, for the reason
  written out at length in Deploy-Server.ps1: there have been four copies of
  Thornswood-Content.esp on this machine at three different sizes, and the game
  folder is not the one that is authoritative. It goes up whenever its sha256
  is not the box's, not only its size (#2308): Ship refuses a release whose
  content plugin the server does not hold byte for byte (ServerContent.ps1),
  and a plugin edited to the same length would otherwise be one this run left
  behind and Ship then refused, with no way past either.

  WHERE THE ORDER COMES FROM (#2309). This script runs only from a clean
  checkout at origin (#2118), which on the shipping machine is a fresh
  worktree, and a fresh worktree has no engine build. Until 11 Oct -LoadOrder
  read the order from the built server's server-settings.json under
  Where.ps1 ServerDist inside the checkout, so it could never run from the one
  place the guard lets it: at 10:13 PM and 10:16 PM that day it stopped with
  "-LoadOrder needs the built server's settings", and the run that went out
  had -Dist pointed at another folder's build by hand.

  The order is the server's own. Deploy-Gamemode.ps1, which writes every
  server build's load order, keeps the order the server already runs and only
  puts a new plugin on the end, because the world keys every saved form on a
  plugin's place in it; Publish-Server.ps1 -Channel dev then installs that
  order on the dev box with the plugins it names (ServerSettings.ps1,
  loadOrder is a release key). So the dev box's own server-settings.json is
  the order the installed server build carries, and it is there for any
  checkout to read. -LoadOrder reads it there, in the same call that reads
  which content plugin the box holds, sends the plugins it names that the box
  does not hold at these bytes, and leaves the order as it is.

  A new order is made by a server build, on the machine that has one, and
  goes out with it (Publish-Server.ps1 -Channel dev). -Dist <that build's
  dist\server> is the way to send only its order and plugins: then the order
  is read from that build and written over the dev one, as -LoadOrder did
  before. Nothing names a build folder by default any more.

  FROM THE RECORD (#4069). A new collection revision moves the order and
  brings plugins no machine but One had, so until 31 Oct 2026 a server could
  only move to one from One's Vortex game. -LoadOrder -FromRecord is the move
  from the box, through the deploy gate:

      pwsh scripts/vps/Box-Run.ps1 -Line 'Deploy-DevGamemode -LoadOrder -FromRecord -ShipFollows'

  The order is game\data\last-plugin.json's loadOrder, the one every table
  and the Last plugin of this commit were built against, with
  Thornswood-Last.esp on the end. The collection's plugins come from the
  box's store of the revision records\collection-plugins.json names
  (CollectionStore.ps1), which this fills from Nexus through Nexus-Run when
  it is not whole, each held to the record's sha256 before it goes in and
  again before it is sent. An order that drops a plugin the dev server loads
  is refused as -Dist's is, unless records\collection-dropped.json names it
  for that revision, with why its forms can go: the repository says what a
  move may take out, never the line that runs it.
#>
[CmdletBinding()]
param(
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Root = 'C:/Thornswood-Server-Dev',
  [string]$Task = 'Thornswood Dev Server',
  # The dev voice service. gamemode.js reads this out of the dev server's
  # own server-settings.json; without it the dev server talks to the live
  # voice service on 7778, pushes its positions over the live ones and
  # drains the live command and choice queues.
  [int]$VoicePort = 7789,
  # Bring the dev server's load order and plugins up to what the built server
  # has. Off by default: a code-only gamemode change does not need it, and the
  # plugin sizes are one extra call to the box.
  [switch]$LoadOrder,
  # thornswoodLoadOrderRefuse in the dev settings (#402): on ends a session
  # whose plugins are not the server's, or that never reports them; off only
  # tells the person and logs WOULD REFUSE. Left off, the box keeps what it has.
  [ValidateSet('', 'on', 'off')]
  [string]$LoadOrderRefuse = '',
  # thornswoodRequirePass in the dev settings (#937, #410): on holds a session
  # until its join pass arrives, off lets it act meanwhile, and a session with
  # no pass is ended at three minutes either way. Left off, the box keeps what
  # it has, and a box with neither true nor false is refused before anything
  # is sent, because the gamemode reads that as on (#1319).
  [ValidateSet('', 'on', 'off')]
  [string]$RequirePass = '',
  # npcEnabled in the dev settings (#385): on keeps every NPC in the world
  # alive on the server, off keeps none. It is the before and after for "is
  # the lag the NPCs", so it is one switch and a restart. Left off, the box
  # keeps what it has.
  [ValidateSet('', 'on', 'off')]
  [string]$Npcs = '',
  # A built server (Deploy-Gamemode.ps1's dist\server) whose load order
  # -LoadOrder writes over the dev one. Left out, -LoadOrder keeps the order
  # the dev server already has and reads it off the box (WHERE THE ORDER COMES
  # FROM in the header, #2309); no build folder is assumed.
  [string]$Dist = '',
  # The order collection revision the repository records, from the box
  # (#4069): with -LoadOrder, the order game\data\last-plugin.json was built
  # against is written over the dev one, and the collection's plugins come
  # from the box's own store of that revision (CollectionStore.ps1), which
  # this fills from Nexus through Nexus-Run when it is not whole. For the
  # deploy gate, on the box; in place of -Dist and -Data. FROM THE RECORD in
  # the header.
  [switch]$FromRecord,
  # The plugins the dev server loads that the -Dist build's order may leave
  # out, each by its file name (#2320). Left off, an order from -Dist that
  # drops any plugin the dev server loads is refused before anything is sent.
  # A comma list is split. Not a gate parameter: through the gate, what a
  # move may drop is records\collection-dropped.json's (-FromRecord).
  [string[]]$DropPlugins = @(),
  # Where the other plugins live on this machine. Ours is taken from the repo
  # instead; see the header.
  [string]$Data = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
  # The warning, the same four switches Deploy-Server.ps1 has. See WHO IS ON in
  # the header. Why is only worded into -Mode restart.
  [double]$Minutes = 1,
  [ValidateSet('notice','restart')]
  [string]$Mode = 'notice',
  [string]$Why = 'a gamemode update',
  [switch]$Now,
  # How long the new dev server has to answer on its game port and its
  # resources port before the old files go back. Left off, the shared
  # ceiling in ServerReadyWait.ps1, derived from measured Live and Dev
  # starts (#1938). A start that never answers still rolls back.
  [int]$Wait,
  # Put the files the last run replaced back in, and send nothing. See the
  # header.
  [switch]$PutBack,
  # Stop and start the dev server even when only the gamemode changes, which
  # it otherwise loads where it runs (THE RELOAD in the header, #3196).
  [switch]$Restart,
  # What goes to the dev updates channel after a successful deploy. The same
  # shape Ship takes: first line the title, "- " lines the details. Not taken
  # on -PutBack, which sends nothing and posts nothing.
  # Position 0, and the only parameter with one, which leaves every other
  # parameter named only (#1929). With none set, PowerShell numbered them in
  # the order above, so a bare note bound to -Vps: on 5 Oct the refusal's own
  # example became the VPS address and the script refused again.
  [Parameter(Position = 0)][string]$Note = '',
    # The dev Ship that follows says this change, so this posts nothing and
    # takes no -Note (#3320).
    [switch]$ShipFollows,
    # Go ahead from a checkout that is not exactly origin/main and clean (#2118). Loud.
    [switch]$AllowStaleCheckout
)

$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
# A stale or dirty checkout sends old or unlanded code; refuse it (#2118).
. (Join-Path $PSScriptRoot '..\deploy\Fresh-Checkout.ps1'); Assert-FreshCheckout -RepoDir (Join-Path $PSScriptRoot '..\..') -What 'Deploy-DevGamemode' -Target $Vps -AnyBranch -AllowStale:$AllowStaleCheckout

$ssh  = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
. (Join-Path $Here 'Swap.ps1')
. (Join-Path $Here 'Reload.ps1')   # the reload in place, #3196
. (Join-Path $Here '..\release\Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named
if (-not $PSBoundParameters.ContainsKey('Wait')) {
  $Wait = Get-ThornswoodServerReadyWait
}
if ($PutBack -and $LoadOrder) { throw '-PutBack puts the last files back and sends nothing, so it does not take -LoadOrder.' }
$DropPlugins = @(@($DropPlugins) | ForEach-Object { ([string]$_) -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (@($DropPlugins).Count -and -not $LoadOrder) { throw '-DropPlugins goes with -LoadOrder -Dist or -LoadOrder -FromRecord, the runs here that write a load order over the dev server''s. Nothing was sent.' }
if ($FromRecord -and -not $LoadOrder) { throw '-FromRecord says where -LoadOrder takes the order and the plugins from, so it goes with -LoadOrder. Nothing was sent.' }
if ($ShipFollows -and $Note.Trim()) { throw '-ShipFollows posts nothing, so it takes no -Note: give the note to the Ship that follows. Nothing was sent.' }
if ($ShipFollows -and $PutBack) { throw '-PutBack posts nothing already, so it does not take -ShipFollows. Nothing was sent.' }
if (-not $PutBack -and -not $ShipFollows) {
  if (-not $Note.Trim()) {
    Write-Host ''
    Write-Host '  STOP. A dev gamemode deploy needs -Note so the dev updates channel' -ForegroundColor Red
    Write-Host '  can be told what changed. Nothing was sent.' -ForegroundColor Red
    Write-Host ''
    Write-Host '  The shape, written from the side of the person playing:' -ForegroundColor DarkGray
    # By name, and the quote left open until the last line, so the two lines
    # pasted together are one command with one note of two lines (#1929).
    Write-Host '      .\scripts\deploy\Deploy-DevGamemode.ps1 -Note "The door answers on the first knock' -ForegroundColor DarkGray
    Write-Host '      - The door no longer needs a second try before it opens."' -ForegroundColor DarkGray
    exit 1
  }
  . (Join-Path $Here '..\release\Note-Rules.ps1')
  $noteProblems = @(Get-NoteShapeProblems $Note) + @(Get-NoteProblems $Note)
  if ($noteProblems.Count) {
    Write-Host ''
    Write-Host '  STOP. These notes are for the people who play, and they say things only' -ForegroundColor Red
    Write-Host '  we would understand. Nothing was sent. Rewrite these:' -ForegroundColor Red
    foreach ($p in $noteProblems) { Write-Host "    $p" -ForegroundColor Yellow }
    Write-Host ''
    Write-Host '  Say what somebody will notice in the game, in plain words.' -ForegroundColor DarkGray
    exit 1
  }
  # And only what the dev channel has not had yet (#3320).
  . (Join-Path $Here '..\release\Note-Repeats.ps1')
  try { $told = Get-ChannelPosts 'dev' }
  catch { throw ('What the dev channel has already been told could not be read, so this note cannot be checked for repeats. Nothing was sent: ' + $_.Exception.Message) }
  $repeats = @(Get-NoteRepeats $Note $told.Posts $null)
  if ($repeats.Count) {
    Write-Host ''
    Write-Host '  STOP. This note says again what the dev channel has already been told.' -ForegroundColor Red
    Write-Host '  Nothing was sent. Write only what this deploy adds:' -ForegroundColor Red
    foreach ($r in $repeats) { Write-Host "    $r" -ForegroundColor Yellow }
    Write-Host ''
    Write-Host '  When a dev Ship follows with this change, deploy with -ShipFollows and give the note to the Ship.' -ForegroundColor DarkGray
    exit 1
  }
  Write-Host "  $Note" -ForegroundColor DarkGray
}
$Gamemode = Join-Path $Here '..\..\game\gamemode.js'
if (-not (Test-Path -LiteralPath $Gamemode)) { throw "There is no gamemode at $Gamemode" }

# What goes up is the gamemode artifact (issue #459, Artifact.ps1):
# game\gamemode.js as the commit holds it, in one zip named by commit and hash,
# checked here and only then sent to the box's store. From here $Gamemode is
# the artifact's copy, so the check, the stamp and the send are all of what
# the zip holds.
# A gamemode with uncommitted changes is refused before the box is touched,
# and so are the other files this sends out of the repository: the number
# of people it holds (records\most-online.json) and, with -LoadOrder, our
# plugin (#1121). There used to be a -Gamemode to send a file from anywhere;
# that was a way round the commit, so it is gone.
# -PutBack builds and sends nothing. records\server-build.json is read below as
# the record of the server build this commit's gamemode is written for
# (#2076), so it is held to the commit too: an uncommitted record would be
# compared with the box in place of the one the commit holds (#2132).
. (Join-Path $Here 'Artifact.ps1')
$artifact = $null
if (-not $PutBack) {
$alsoSends = @('records/most-online.json', 'records/server-build.json')
# Every plugin of ours, held to the commit like the gamemode: the names in
# RepoPlugins.ps1 (#2486), written out so tests\test-deploy-artifact.ps1 can read them.
# Thornswood-Last.esp is made on the box from the recipe (#2791,
# LastPluginOnBox.ps1), which goes up with the make's own tools.
if ($LoadOrder) { $alsoSends += 'game/content/Thornswood-Content.esp', 'game/data/last-plugin.recipe', 'game/data/last-plugin.json' }
# The gamemode's tables (#5191) are in the artifact with it: the gamemode
# reads them from the folder beside it as it loads.
$artifact = New-ThornswoodArtifact -Component gamemode -RepoDir (Join-Path $Here '..\..') -Paths 'game/gamemode.js', 'game/gamemode-tables' -AlsoSends $alsoSends
Write-Host ('  artifact ' + (Format-ThornswoodArtifact $artifact))
$Gamemode = Join-Path $artifact.Folder 'game\gamemode.js'
$GamemodeTables = Join-Path $artifact.Folder 'game\gamemode-tables'

# Syntax first, before the artifact leaves this machine. A gamemode that does
# not parse takes the dev server down at start, for everybody testing on it.
# node is required, as it is for Deploy-Gamemode.ps1 and Deploy-Server.ps1:
# this used to skip the check with a warning where node was missing, then
# stop the dev server and send a file nobody had checked (#1857), and the
# artifact went to the box's store before the check either way. -PutBack
# sends no gamemode, so it has none to check.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is not on this machine, so gamemode.js cannot be checked before it goes live. Nothing was sent.' }
& node --check $Gamemode
if ($LASTEXITCODE -ne 0) { throw 'gamemode.js does not parse. Nothing was sent.' }
Write-Host '  gamemode.js parses'
# The ids the gamemode logs as it loads (Reload.ps1), which a reload waits
# for: its own blob, and the tree of the tables it reads.
$newBlob = Get-ThornswoodGamemodeBlob $Gamemode
$newTree = Get-ThornswoodTablesTree $GamemodeTables
if (-not $newTree) { throw "the artifact holds no game\gamemode-tables, and the gamemode reads its tables from there (#5191). Nothing was sent." }

# THE ENGINE THIS GAMEMODE IS WRITTEN FOR (#2076). A gamemode goes onto the
# server build its commit records, the comparison Deploy-Server -GamemodeOnly
# makes for live (#1089). Asked before the artifact leaves this machine, so a
# refusal sends nothing and stops nothing. -PutBack sends no gamemode.
. (Join-Path $Here 'ServerBuild.ps1')
$devRecordPath = Join-Path $Here '..\..\records\server-build.json'
if (-not (Test-Path -LiteralPath $devRecordPath)) { throw 'there is no records\server-build.json, so nothing says which server build this gamemode is written for. Nothing was sent.' }
$devRecordSum = Get-ThornswoodRecordSum ([IO.File]::ReadAllBytes($devRecordPath))
# RecordShape.ps1 (#2180): the record must be a version this checkout knows,
# with the fields read below, or the deploy stops here, before anything is sent.
. (Join-Path $Here '..\release\RecordShape.ps1')
$devRecord = Read-ThornswoodRecord -Path $devRecordPath -Kind server-build
$devRecordCommit = [string]$devRecord.source.commit
# Whether the engine loads light plugins, for the start point below: this
# record's, which the check below holds the dev server's own record to.
$devRecordLight = ($devRecord.PSObject.Properties.Name -contains 'lightPlugins' -and $devRecord.lightPlugins -eq $true)
$devBoxSaid = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script ($ThornswoodRecordSumText + "`r`n" + @"
`$rp = Join-Path '$($Root.Replace('/', '\').Replace("'", "''"))' 'server-build.json'
if (Test-Path -LiteralPath `$rp) {
  'RECORD ' + (Get-ThornswoodRecordSum ([IO.File]::ReadAllBytes(`$rp)))
  try { 'RECORDCOMMIT ' + [string](([IO.File]::ReadAllText(`$rp) | ConvertFrom-Json).source.commit) }
  catch { 'RECORDUNREADABLE ' + `$_.Exception.Message }
} else { 'RECORD none' }
"@) | ForEach-Object { "$_".Trim() })
$devBoxSum = ''; $devBoxCommit = ''; $devBoxUnread = ''
foreach ($l in $devBoxSaid) {
  if ($l -match '^RECORD ([0-9a-f]{64}|none)$') { $devBoxSum = $Matches[1] }
  elseif ($l -match '^RECORDCOMMIT ([0-9a-f]*)$') { $devBoxCommit = $Matches[1] }
  elseif ($l -match '^RECORDUNREADABLE (.*)$') { $devBoxUnread = $Matches[1] }
}
$devBuildProblem = Get-ThornswoodBoxBuildProblem $devBoxSum $devBoxCommit $devRecordSum $devRecordCommit 'dev server' 'scripts\release\Publish-Server.ps1 -Channel dev'
# Its record that does not read sums to something else, so it is refused above
# as "an unreadable one"; this says what reading it said.
if ($devBuildProblem -and $devBoxUnread) { $devBuildProblem += ' Its server-build.json does not read: ' + $devBoxUnread }
if ($devBuildProblem) {
  Write-Host ('  ' + $devBuildProblem) -ForegroundColor Red
  throw 'The dev server does not run the server build this gamemode is written for. Nothing was sent and the dev server was not touched.'
}
Write-Host ('  the dev server runs the build this commit records, commit ' + $devRecordCommit.Substring(0, [Math]::Min(8, $devRecordCommit.Length)))

Send-ThornswoodArtifact -Artifact $artifact -Target "$User@$Vps" -SshArgs $ssh
}

function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

$rootWin = $Root.Replace('/', '\')

# What this gamemode is, written down to go up beside it, so the dev server can
# say which build it runs. Made here, before anything is stopped, so nothing
# about it can leave the dev server down. The fields and the reasons are in
# BuildStamp.ps1. -RepoDir is this script's own repo, which is the branch being
# tried, and the dev feed is where the four part number lives.
. (Join-Path $Here '..\release\BuildStamp.ps1')
$stampFile = Join-Path ([IO.Path]::GetTempPath()) 'thornswood-dev-build.json'
$buildStamp = Save-ThornswoodBuildStamp -Gamemode $Gamemode -Channel dev -RepoDir (Split-Path -Parent (Split-Path -Parent $Here)) -Path $stampFile -Artifact $artifact
Write-Host ('  build stamp: ' + (Format-ThornswoodBuildStamp $buildStamp))

# How many the dev server holds at once, read here so a number the engine
# would refuse stops this while the dev server is still up. MaxOnline.ps1 says
# where it lives (records\most-online.json) and why. The dev server's own
# numbers, its dev object (Patrick, 12 Oct: 5 at once on dev).
. (Join-Path $Here 'MaxOnline.ps1')
$got = Get-MostOnline -Channel dev
$maxOnline = $got.Value
$seats = $got.Seats
if ($got.Note) { Write-Host ('  most online: ' + $got.Note) -ForegroundColor Yellow }
if ($maxOnline -gt 0) { Write-Host ('  most online on dev: {0}, engine seats {1} ({2} over it for staff roles), from {3}' -f $maxOnline, $seats, $got.Staff, $got.From) }
else { Write-Host ('  most online: {0} gave no number ({1}), so the dev server keeps the one it has' -f $got.From, $got.Why) -ForegroundColor Yellow }

# --------------------------------------------------------- the load order ---
#
# Worked out before anything is stopped, so a missing plugin or an unreadable
# build stops this while the dev server is still up and serving.
$remotePlugins = ($Root -replace '\\', '/') + '/plugins'
$orderWire     = ''
$pluginNames   = @()
$sendPlugins   = @()
$changed       = @()

if ($LoadOrder) {
  # ==== thornswood dev load order source ====
  # The dev server's own load order and the content plugin it holds, in one
  # read of the box (ServerContent.ps1). WHERE THE ORDER COMES FROM in the
  # header says why the order is the box's unless -Dist names a build.
  . (Join-Path $Here 'ServerContent.ps1')
  $boxContent = Read-ThornswoodServerContent -Channel dev -Root $Root -Target "$User@$Vps" -SshArgs $ssh
  if (-not $boxContent.Answered) {
    throw ("the dev server did not say what it holds (it answered: " + ((@($boxContent.Said | Where-Object { $_ }) | Select-Object -Last 3) -join ' | ') +
           "), so there is no telling which plugins it needs. Nothing was sent and the dev server was not touched.")
  }
  if (@($DropPlugins).Count -and -not $Dist -and -not $FromRecord) {
    throw '-DropPlugins goes with -Dist or -FromRecord: without either the dev server keeps its own load order, so nothing is dropped. Nothing was sent.'
  }
  if ($FromRecord) {
    if ($Dist) { throw '-FromRecord takes the order from the repository''s record and the plugins from the box''s store, so it does not go with -Dist. Nothing was sent.' }
    # FROM THE RECORD (#4069): the order last-plugin.json was built against,
    # which is the order every table and the Last plugin of this commit read,
    # and the collection's plugins from the box's store of the record's
    # revision. Thornswood-Last.esp goes on the end below, as always.
    . (Join-Path $Here 'CollectionStore.ps1')
    $repoRoot = (Resolve-Path -LiteralPath (Join-Path $Here '..\..')).ProviderPath
    $recordPath = Join-Path $repoRoot 'records\collection-plugins.json'
    $store = Get-ThornswoodCollectionStore -RecordPath $recordPath -Fetch { param($w, $h) Invoke-ThornswoodCollectionFetch -Work $w -Head $h -Repo $repoRoot } -Say { param($m) Write-Host $m -ForegroundColor DarkGray }
    $Data = $store.Dir
    $lastDoc = Join-Path $repoRoot 'game\data\last-plugin.json'
    $built = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($lastDoc)) $lastDoc
    # Thornswood-Last.esp on the end here, before the order is held to the
    # running one: last-plugin.json's order never names the Last plugin, and
    # the dev server loads it, so held without it the move read as dropping
    # it (31 Oct 2026, gate run at d88ab73e: "leaves out 1 of the 103 the
    # running server loads: Thornswood-Last.esp"). The same order the live
    # move writes (Deploy-Server.ps1 -FromRecord, $recordOrder).
    . (Join-Path $Here 'LastPluginRecipe.ps1')
    $pluginNames = @(@(@($built.loadOrder) | ForEach-Object { [string]$_ } | Where-Object { $_ -and $_ -ine $ThornswoodLastPlugin }) + $ThornswoodLastPlugin)
    if ($pluginNames.Count -lt 2) { throw "$lastDoc has no loadOrder, so there is no order to write. Nothing was sent and the dev server was not touched." }
    Write-Host ('  load order from {0} ({1} plugins, collection revision {2}), written over the dev server''s' -f 'game\data\last-plugin.json', $pluginNames.Count, $store.Revision) -ForegroundColor DarkGray
    # What the move may drop is the repository's word, not the caller's:
    # records\collection-dropped.json, for the revision the record names.
    $dropDoc = Join-Path $repoRoot 'records\collection-dropped.json'
    $mayDrop = @($DropPlugins)
    if (Test-Path -LiteralPath $dropDoc -PathType Leaf) {
      $dd = ConvertFrom-ThornswoodJson ([IO.File]::ReadAllText($dropDoc)) $dropDoc
      if ([string]$dd.collection -eq $store.Slug -and [string]$dd.revision -eq [string]$store.Revision) {
        $mayDrop += @(@($dd.dropped) | ForEach-Object { [string]$_.name } | Where-Object { $_ })
      } else {
        Write-Host ('  records\collection-dropped.json is for revision {0}, not {1}, so it lets nothing go' -f [string]$dd.revision, $store.Revision) -ForegroundColor DarkGray
      }
    }
    if ($boxContent.OrderRead) {
      . (Join-Path $Here 'ServerSettings.ps1')
      $drop = Test-ThornswoodLoadOrderDrop ([pscustomobject]@{ loadOrder = @($boxContent.Order) }) ([pscustomobject]@{ loadOrder = $pluginNames }) $mayDrop
      foreach ($l in $drop.Said) { Write-Host ('  ' + $l) -ForegroundColor Yellow }
      if ($drop.Problem) { throw ($drop.Problem + ' A plugin a new revision takes out goes in records\collection-dropped.json, with why its forms can go. Nothing was sent and the dev server was not touched.') }
    }
  } elseif ($Dist) {
    $settingsSrc = Join-Path $Dist 'server-settings.json'
    if (-not (Test-Path -LiteralPath $settingsSrc)) {
      throw "-Dist names no built server: there is no $settingsSrc. Leave -Dist out to keep the dev server's own load order. Nothing was sent."
    }
    $built = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $settingsSrc -Raw) $settingsSrc
    if (-not $built.loadOrder) { throw "$settingsSrc has no loadOrder" }
    $pluginNames = @($built.loadOrder | ForEach-Object { @(([string]$_) -split '[\\/]')[-1] })
    Write-Host ('  load order from the build at {0}, written over the dev server''s' -f $Dist) -ForegroundColor DarkGray
    # Held to the order the dev server runs (#2320): one that leaves out a
    # plugin it loads is refused unless -DropPlugins names each one.
    if ($boxContent.OrderRead) {
      . (Join-Path $Here 'ServerSettings.ps1')
      $drop = Test-ThornswoodLoadOrderDrop ([pscustomobject]@{ loadOrder = @($boxContent.Order) }) ([pscustomobject]@{ loadOrder = $pluginNames }) $DropPlugins
      foreach ($l in $drop.Said) { Write-Host ('  ' + $l) -ForegroundColor Yellow }
      if ($drop.Problem) { throw ($drop.Problem + ' Nothing was sent and the dev server was not touched.') }
    }
  } else {
    if (-not $boxContent.OrderRead) {
      throw ("the dev server's server-settings.json gave no load order, so there is nothing to send plugins for. " +
             'A server publish puts one there: .\scripts\release\Publish-Server.ps1 -Channel dev. Nothing was sent.')
    }
    $pluginNames = @($boxContent.Order)
    Write-Host ('  load order: the dev server''s own, {0} plugins, kept as it is' -f $pluginNames.Count) -ForegroundColor DarkGray
  }
  # ==== end thornswood dev load order source ====

  # THE PLUGIN THAT LOADS LAST (#2468). Made on the box from this commit's
  # recipe (#2791, LastPluginOnBox.ps1), never sent, and the dev server's last
  # plugin whatever order it had: every cut actor it switches off and every
  # quest it stops is only right with nothing after it. When this moves the
  # order, the order goes up the way a build's does (-Dist), so a plain
  # -LoadOrder puts it there. It is made when the dev server does not hold
  # the bytes game\data\last-plugin.json names (#2308, by sha256), into the
  # stage below, after the plugins this sends are in it.
  . (Join-Path $Here 'LastPluginOnBox.ps1')
  $lastName = $ThornswoodLastPlugin
  $lastWant = Get-ThornswoodLastPluginWant (Join-Path $Here '..\..')
  $makeLast = $false
  $orderMoved = $false
  if ($lastWant) {
    $wantNames = @(@($pluginNames | Where-Object { $_ -ine $lastName }) + $lastName)
    if ((@($pluginNames) -join '|') -ne ($wantNames -join '|')) {
      $orderMoved = $true
      Write-Host ('  load order: {0} goes last, plugin {1}' -f $lastName, $wantNames.Count) -ForegroundColor Yellow
    }
    $pluginNames = $wantNames
  }
  $ours = Join-Path $Here '..\..\game\content\Thornswood-Content.esp'

  # Name and size, the same question Deploy-Server.ps1 asks of the live box and
  # for the same reason: a plugin already there by name may not be the same
  # plugin any more. Size and not a hash, because a hash of 57 plugins is tens
  # of megabytes of reading on a box that is also running two servers.
  $thereRaw = @(Remote ("Get-ChildItem -LiteralPath '" + $remotePlugins.Replace('/','\') +
                        "' -File | ForEach-Object { `$_.Name + '|' + `$_.Length }"))
  $thereSize = @{}
  foreach ($row in $thereRaw) {
    $bits = "$row".Trim() -split '\|'
    if ($bits.Count -eq 2 -and $bits[0] -match '\.es[pml]$') { $thereSize[$bits[0]] = [int64]$bits[1] }
  }
  # An unreadable folder and an empty one look the same from here, and the
  # difference is 57 plugins going up over a slow link for no reason, or an scp
  # into a path that does not exist. Neither should happen quietly.
  if ($thereSize.Count -eq 0) {
    Write-Host ''
    Write-Host ("  Nothing readable at $remotePlugins on the dev box.") -ForegroundColor Red
    foreach ($row in $thereRaw) { Write-Host ("    " + $row) -ForegroundColor DarkGray }
    throw "could not read the dev server's plugin folder, so there is no way to tell what it already has"
  }

  foreach ($n in $pluginNames) {
    if ($lastWant -and $n -ieq $lastName) {
      $boxLast = Get-ThornswoodServerPlugin $boxContent $n
      if (-not (Test-ThornswoodContentSame $boxLast $lastWant.Bytes $lastWant.Sha)) {
        $makeLast = $true
        $changed += ('{0}  {1:N0} -> {2:N0} bytes, sha256 {3} -> {4}, made on the box from the recipe' -f $n, $boxLast.Bytes, $lastWant.Bytes,
                     $(if ($boxLast.Sha) { $boxLast.Sha.Substring(0, 12) } else { 'none' }), $lastWant.Sha.Substring(0, 12))
      }
      continue
    }
    # Combine, not Join-Path: a machine with no game folder (a cloud one, #2903)
    # has no C: drive, and Join-Path refuses a path on a drive that is not
    # there. The path then just is not there, which is the case handled below.
    $local = [IO.Path]::Combine($Data, $n)
    # Ours (RepoPlugins.ps1) comes from the repo, never -Data (#2486).
    $isOurs = $false
    if (Test-ThornswoodRepoPlugin $n) {
      $own = Get-ThornswoodRepoPluginPath (Join-Path $Here '..\..') $n
      if (Test-Path -LiteralPath $own) { $local = $own; $isOurs = $true }
    }
    if (-not $thereSize.ContainsKey($n)) {
      if (Test-Path -LiteralPath $local) { $sendPlugins += $local }
      else { throw "the load order names $n, the dev server does not have it, and it is not at $local either" }
      continue
    }
    # There already. A plugin this machine does not have is left alone: the
    # box's copy is then the only copy, and overwriting it with nothing is the
    # one outcome worse than it being stale.
    if (-not (Test-Path -LiteralPath $local)) { continue }
    $localLen = (Get-Item -LiteralPath $local).Length
    if ($isOurs) {
      # Ours by sha256 as well as size (#2308): Ship holds a release to the
      # server's copy byte for byte, so this has to send it on the same test.
      $mine = Get-ThornswoodLocalContent $local
      $boxPlugin = Get-ThornswoodServerPlugin $boxContent $n
      if (-not (Test-ThornswoodContentSame $boxPlugin $mine.Bytes $mine.Sha)) {
        $sendPlugins += $local
        $changed += ('{0}  {1:N0} -> {2:N0} bytes, sha256 {3} -> {4}' -f $n, $boxPlugin.Bytes, $mine.Bytes,
                     $(if ($boxPlugin.Sha) { $boxPlugin.Sha.Substring(0, 12) } else { 'none' }), $mine.Sha.Substring(0, 12))
      }
      continue
    }
    if ($localLen -ne $thereSize[$n]) {
      $sendPlugins += $local
      $changed += ('{0}  {1:N0} -> {2:N0} bytes' -f $n, $thereSize[$n], $localLen)
    }
  }

  # THE COLLECTION'S BYTES, NOT THIS MACHINE'S (#2019). A plugin goes up when
  # its size differs from the box's, from whatever -Data holds. On 5 Oct that
  # sent a 3BBB.esp from another installer choice to both servers and blocked
  # Play for everybody on the collection. Every plugin about to go, except our
  # own, has to be the one records\collection-plugins.json holds; a deploy
  # that would send any other stops here, naming it, with nothing sent. With
  # no record it stops too: nothing else can say those bytes are the
  # collection's. Only the plugins about to go are read.
  . (Join-Path $Here 'CollectionPlugins.ps1')
  Assert-ThornswoodCollectionPlugins -RecordPath (Join-Path $Here '..\..\records\collection-plugins.json') -Files $sendPlugins -Exempt $ThornswoodRepoPlugins -What 'this deploy'
  Write-Host ''
  Write-Host ('  load order: {0} plugins, paths rewritten to {1}' -f $pluginNames.Count, $remotePlugins) -ForegroundColor DarkGray
  if ($sendPlugins.Count -or $makeLast) {
    Write-Host ('  {0} plugin(s) will go up before the restart:' -f $sendPlugins.Count) -ForegroundColor Yellow
    foreach ($p in $sendPlugins) { Write-Host ('    ' + (Split-Path $p -Leaf)) -ForegroundColor Yellow }
    if ($makeLast) { Write-Host ('  and {0} will be made on the box from the recipe' -f $lastName) -ForegroundColor Yellow }
    foreach ($c in $changed) { Write-Host ('    changed: ' + $c) -ForegroundColor Yellow }
  } else {
    Write-Host '  every plugin the load order names is on the dev server at the same bytes' -ForegroundColor DarkGray
  }

  # Only a build's order goes up to be written over the dev one (-Dist). The
  # dev server's own order needs no list: it stays as it is.
  # The list goes inside the settings block below that reads it, as base64 of
  # its UTF-8 so no name can break the quoting, and so it reaches the box the
  # way that block does (Send-Script.ps1: when it is long, by scp, and its
  # run deletes the copy before it runs, #3059). Until 21 Oct 2026 (#3035) it
  # went up as a file of its own in C:\Windows\Temp, because a block that long
  # on a command line was cut short, and a deploy that stopped between the
  # copy and the block that removed it left the file there for good. Nothing
  # of it stays on the box now: the dev settings file is edited in place here rather than
  # written from a local build, which is the rule this script is built on.
  if ($Dist -or $FromRecord -or $orderMoved) {
    $orderWire = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pluginNames -join "`n"))
  }
}

# ------------------------------------------------------------ the warning ---
#
# Who is on, and a warning in the game before anything stops. It comes after
# the load order is worked out, so a missing plugin still stops this before
# anybody has been told an update is coming. WHO IS ON in the header says why.
#
# The functions sit between markers so tests\test-dev-deploy-warning.ps1 can
# load them and drive them with no VPS behind them.
# ==== thornswood dev deploy warning ====
function Read-DevRoom($lines) {
  # What the box answered, as the port, the data folder and a head count.
  # Online -1 means it could not tell, which is not the same thing as nobody.
  $room = @{ Port = 0; Data = ''; Online = -1; Up = $null; Stale = -1; Names = @(); Notes = @(); Said = @($lines) }
  foreach ($line in @($lines)) {
    $t = "$line".Trim()
    if ($t -match '^PORT (\d+)$') { $room.Port = [int]$Matches[1] }
    elseif ($t -match '^NOTE (.+)$') { $room.Notes += $Matches[1].Trim() }
    elseif ($t -match '^DATA (.+)$') { $room.Data = $Matches[1].Trim() }
    elseif ($t -match '^ONLINE (\d+)$') { $room.Online = [int]$Matches[1] }
    elseif ($t -match '^NAME (.+)$') { $room.Names += $Matches[1].Trim() }
    elseif ($t -match '^UP (yes|no)$') { $room.Up = ($Matches[1] -eq 'yes') }
  }
  # Nothing on the game port is no server, and no server has nobody on it,
  # whatever online.json says. The gamemode writes that file only when the
  # count moves, so a process that was killed or crashed leaves its last count
  # behind. Measured in review on 24 September: online.json {"now":1} with
  # nothing on the port read as one on, and this warned a room that was not
  # there, waited 80 seconds, and left restart.json for the next boot. When
  # the box could not list its ports there is no UP line, and the count is
  # kept, which errs toward a warning.
  if ($room.Up -eq $false) { $room.Stale = $room.Online; $room.Online = 0; $room.Names = @() }
  return $room
}

function Get-DevRoom {
  # The data folder is read from the dev settings the way the dev gamemode
  # reads it, because restart.json only reaches the room if it lands where the
  # gamemode looks, and online.json is written to the same place. No
  # online.json at all means the server has never run there, so nobody. A
  # file with no count in it is unknown, not nobody: Windows PowerShell reads
  # an empty file as nothing at all rather than an error, which came out as
  # nobody on until the test for this caught it.
  # Both files are read sharing write and delete (#2740). The gamemode
  # replaces them whole with a POSIX rename, which a reader that does not
  # share delete refuses (Get-Content does not share it), and a refused write
  # leaves the count it was replacing.
  # UP says whether anything is on the game port. Every endpoint is listed and
  # filtered here, because -LocalPort with nothing on it is an error, and an
  # error has to stay distinct from nothing there.
  Read-DevRoom (Remote @"
function ReadShared(`$f) {
  `$h = New-Object IO.FileStream(`$f, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  try { return (New-Object IO.StreamReader(`$h, (New-Object Text.UTF8Encoding(`$false)), `$true)).ReadToEnd() } finally { `$h.Dispose() }
}
`$s = Get-Content '$rootWin\server-settings.json' -Raw | ConvertFrom-Json
`$port = [int]`$s.port
'PORT ' + `$port
`$d = 'data'
if (`$s.dataDir) { `$d = [string]`$s.dataDir }
`$d = [IO.Path]::Combine('$rootWin', `$d)
`$p = 'private'
if (`$s.privDir) { `$p = [string]`$s.privDir }
'DATA ' + `$d.Replace('\', '/')
if (`$port -gt 0) {
  try {
    `$u = @(Get-NetUDPEndpoint -EA Stop | Where-Object { `$_.LocalPort -eq `$port })
    if (`$u.Count) { 'UP yes' } else { 'UP no' }
  } catch { 'NOTE the box could not list its UDP ports (' + `$_.Exception.Message + '), so the count is online.json''s alone' }
}
`$o = Join-Path `$d 'online.json'
if (-not (Test-Path `$o)) { 'ONLINE 0' }
else {
  try {
    `$j = ReadShared `$o | ConvertFrom-Json -EA Stop
    if (`$null -eq `$j -or `$null -eq `$j.now) { throw 'no count' }
    'ONLINE ' + [int]`$j.now
  } catch { 'ONLINE unreadable' }
}
# Names, for saying whose evening this interrupts. Kept in the private folder,
# not the served one. A gamemode older than the file writes none, and then the
# count is all there is to say.
`$nf = [IO.Path]::Combine('$rootWin', `$p, 'online-names.json')
if (Test-Path -LiteralPath `$nf) {
  try {
    `$n = ReadShared `$nf | ConvertFrom-Json
    foreach (`$x in @(`$n.names)) { if (`$x) { 'NAME ' + `$x } }
  } catch { 'NOTE ' + `$nf + ' does not read (' + `$_.Exception.Message + '), so nobody is named' }
}
"@)
}

function Format-DevNames($names) {
  $n = @($names | Where-Object { $_ })
  if (-not $n.Count) { return '' }
  return ' (' + ($n -join ', ') + ')'
}

function Warn-DevRoom {
  # One look. The second look two seconds on that was here, for a read that
  # landed on online.json half written, came out with its cause (#2740): the
  # gamemode writes the file whole, so a read gets one count or the other.
  $room = Get-DevRoom
  # The stop below refuses 7777 as well, but by then the live room would
  # already have been told an update was coming.
  if ($room.Port -eq 7777) {
    throw "Refused: $Root is on port 7777, which is the live server. Nobody was warned and nothing was stopped."
  }
  $known = ($room.Port -gt 0 -and $room.Online -ge 0 -and $room.Data)
  $who = Format-DevNames $room.Names
  # What the box could not read, though the count stands without it.
  foreach ($n in @($room.Notes)) { Write-Host ('  ' + $n) -ForegroundColor Yellow }

  if ($Now) {
    if (-not $known) { Write-Host '  -Now: could not tell who is on the dev server, and nobody is warned' -ForegroundColor Yellow }
    elseif ($room.Online -gt 0) {
      Write-Host ('  -Now: {0}{1} on the dev server and not warned. They respawn when it comes back.' -f $room.Online, $who) -ForegroundColor Yellow
    }
    else { Write-Host '  -Now: nobody is on the dev server' }
    return
  }

  if (-not $known) {
    Write-Host ''
    Write-Host '  Could not tell who is on the dev server, so there is no knowing who the' -ForegroundColor Red
    Write-Host '  stop would drop. Nothing has been stopped. What the box said:' -ForegroundColor Red
    foreach ($l in $room.Said) { Write-Host ('    ' + $l) -ForegroundColor DarkGray }
    Write-Host '  Run this again, or pass -Now to go down without warning anybody.' -ForegroundColor Red
    throw 'could not read who is on the dev server, so it was left running'
  }

  if ($room.Online -eq 0) {
    if ($room.Up -eq $false) {
      Write-Host ('  the dev server is not running, nothing is on UDP {0}, so nobody is on it' -f $room.Port)
      if ($room.Stale -gt 0) {
        Write-Host ('  online.json still says {0}, left over from before it stopped' -f $room.Stale) -ForegroundColor DarkGray
      }
      return
    }
    Write-Host '  nobody is on the dev server, going straight down'
    return
  }

  $unit = 'minutes'
  if ($Minutes -eq 1) { $unit = 'minute' }
  Write-Host ('  {0}{4} on the dev server. Warning them in the game: {1}, {2} {3}.' -f
              $room.Online, $Mode, $Minutes, $unit, $who) -ForegroundColor Yellow

  $ask = Join-Path $Here '..\vps\Request-Restart.ps1'
  $code = 1
  if (Test-Path -LiteralPath $ask) {
    # -RestartFollows because this script stops and starts the process a few
    # lines below, which is the promise Request-Restart wants before it lets
    # -Mode restart put anybody out.
    $global:LASTEXITCODE = 0
    try {
      & $ask -Minutes $Minutes -Mode $Mode -Why $Why -Vps $Vps -User $User -Data $room.Data -RestartFollows
      $code = $LASTEXITCODE
    } catch {
      Write-Host ('  ' + $_.Exception.Message) -ForegroundColor Red
      $code = 1
    }
  } else {
    Write-Host '  Request-Restart.ps1 is not beside this script.' -ForegroundColor Red
  }
  # Read, not assumed. Deploy-Server once called this and never looked, so a
  # warning that failed dropped everybody with no notice while the log said the
  # countdown had been given.
  if ($code -ne 0) {
    Write-Host ''
    Write-Host ('  THE WARNING DID NOT GO OUT. {0}{1} on the dev server would be dropped with' -f $room.Online, $who) -ForegroundColor Red
    Write-Host '  no notice. Nothing has been sent or stopped. Run this again once the box' -ForegroundColor Red
    Write-Host '  answers, or pass -Now to go down without warning them.' -ForegroundColor Red
    throw 'the warning did not go out, so the dev server was left running'
  }

  # The countdown, plus twenty seconds so its last line lands before the stop,
  # the same margin Deploy-Server gives. Out early the moment the room is
  # empty: nobody left on is nobody left to wait for.
  $deadline = (Get-Date).AddMinutes($Minutes).AddSeconds(20)
  while ($true) {
    $rest = ($deadline - (Get-Date)).TotalSeconds
    if ($rest -le 0) { break }
    Start-Sleep -Seconds ([int][Math]::Ceiling([Math]::Min(15, $rest)))
    $left = (Get-DevRoom).Online
    if ($left -eq 0) { Write-Host '  the room is empty, going now'; return }
    if ($left -gt 0) {
      Write-Host ('  {0} still on, {1} seconds to go' -f $left,
                  [int][Math]::Max(0, ($deadline - (Get-Date)).TotalSeconds))
    }
  }
  Write-Host '  the countdown has run out in the game, going now'
}
# ==== end thornswood dev deploy warning ====

# ------------------------------------------------------------ the stage ---
#
# Issue #446. This used to stop the dev server first and then copy gamemode.js,
# the stamp and any plugins straight over the running files, edit the settings
# in place, start it, and print DEV SERVER IS NOT LISTENING if it did not come
# up, with nothing put back. So a copy that failed half way, or a gamemode that
# would not start, left the dev server down until somebody noticed.
#
# Now everything goes into $Root\.stage-<stamp> while the dev server runs: the
# files from here, and a copy of its settings, edited there by the block below
# rather than in place. The box checks the stage with the same block
# Deploy-Server.ps1 uses (every file by its hash, the settings with no byte
# order mark and parsing, the port not moving, every plugin in the load order
# on disk, gamemode.js parsing), and only then is anybody warned. The stop, the
# renames, the start and the way back are Swap.ps1's $swapBlock, the same as
# live. -PutBack puts the newest .prev folder back the same way.
$stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
$stageName = '.stage-' + $stamp
$prevName  = '.prev-' + $stamp
$stageWin  = "$rootWin\$stageName"
$stageFar  = ($Root -replace '\\', '/') + '/' + $stageName
$hashes    = [ordered]@{}

if (-not $PutBack) {
  Write-Host ''
  Write-Host "Staging in $stageWin..."
  # A stage a run that died part way left is cleared first; it was never
  # swapped in. The running settings are copied in to be edited there, and a
  # root on the live port is refused before anything is sent.
  $made = @(Remote @"
`$s = Get-Content '$rootWin\server-settings.json' -Raw | ConvertFrom-Json
if ([int]`$s.port -eq 7777) { 'REFUSING: $rootWin is on port 7777, which is the live server'; exit 9 }
if (-not '$RequirePass' -and -not (`$s.thornswoodRequirePass -is [bool])) { 'NO PASS SWITCH'; exit 8 }
Get-ChildItem -LiteralPath '$rootWin' -Directory -Force -EA SilentlyContinue |
  Where-Object { `$_.Name -like '.stage-*' } |
  ForEach-Object { Remove-Item -LiteralPath `$_.FullName -Recurse -Force -EA SilentlyContinue }
New-Item -ItemType Directory -Path '$stageWin\plugins', '$stageWin\gamemode-tables' -Force | Out-Null
Copy-Item -LiteralPath '$rootWin\server-settings.json' -Destination '$stageWin\server-settings.json' -Force
'dev port ' + `$s.port + ', name ' + `$s.name
'STAGE MADE'
"@ | ForEach-Object { "$_".Trim() })
  foreach ($l in $made) { Write-Host "  $l" }
  if ($made -match '^REFUSING') { throw 'Refused: that root is the live server. Nothing was sent or stopped.' }
  # The gamemode holds every session until its pass arrives unless the switch
  # is false, so a box with neither true nor false would change what it does
  # the moment this gamemode reached it, with nobody having asked (#1319).
  if ($made -contains 'NO PASS SWITCH') {
    throw ('Refused: thornswoodRequirePass on the dev server is neither true nor false, and the gamemode ' +
           'reads that as on (#1319). Run again with -RequirePass on or -RequirePass off. Nothing was sent or stopped.')
  }
  if ($made -notcontains 'STAGE MADE') { throw "could not make $stageWin on the dev box. Nothing was sent or stopped." }

  $send = [ordered]@{}
  $send['gamemode.js'] = $Gamemode
  # The stamp goes up in the stage with the gamemode it describes, so a
  # rollback cannot leave a new stamp naming the old gamemode.
  $send['thornswood-build.json'] = $stampFile
  foreach ($p in $sendPlugins) { $send['plugins/' + (Split-Path $p -Leaf)] = $p }
  foreach ($rel in $send.Keys) {
    Invoke-ThornswoodNative { & scp @ssh $send[$rel] "$User@${Vps}:$stageFar/$rel" }
    if ($LASTEXITCODE -ne 0) { throw "scp failed for $rel. The dev server has not been touched." }
    Write-Host "  $rel"
  }
  # The tables (#5191), in one scp: each is held to its hash on the box like
  # any file sent, and the swap and the reload put the folder in whole.
  $tableFiles = @(Get-ThornswoodTableFiles $GamemodeTables)
  Invoke-ThornswoodNative { & scp @ssh @($tableFiles | ForEach-Object { $_.FullName }) "$User@${Vps}:$stageFar/gamemode-tables/" }
  if ($LASTEXITCODE -ne 0) { throw "scp failed for the gamemode tables. The dev server has not been touched." }
  foreach ($t in $tableFiles) { $send['gamemode-tables/' + $t.Name] = $t.FullName }
  Write-Host ('  gamemode-tables/ ({0} tables, git tree {1})' -f $tableFiles.Count, $newTree)
  $hashes = Get-SwapHashes $send
  # Thornswood-Last.esp, made into the stage from the plugins just sent and
  # then the dev server's own (#2791); the stage check holds it to the
  # manifest's sha256 like a file that was sent.
  if ($LoadOrder -and $makeLast) {
    $lastMade = Invoke-ThornswoodLastPluginMake -Target "$User@$Vps" -SshArgs $ssh -RepoDir (Join-Path $Here '..\..') `
      -Reads @("$stageWin\plugins", "$rootWin\plugins") -Into "$stageWin\plugins" -Want $lastWant
    Write-Host ('  plugins/{0}, made on the box: {1:N0} bytes, sha256 {2}' -f $lastName, $lastMade.Bytes, $lastMade.Sha.Substring(0, 12))
    $hashes['plugins/' + $lastName] = $lastMade.Sha
  }

  Write-Host ''
  Write-Host 'Pointing the dev server at the dev voice service...'
  # Deliberately not sent from here. server-settings.json on the dev box
  # carries the dev port and name and must not be overwritten from a local
  # build, which is the whole reason this script exists rather than
  # Deploy-Server.ps1. One key is set in place instead, and the old file is
  # kept beside it.
  # WHAT YOU ARE WEARING STAYS ON, and the three keys below are why. Measured on
  # 20 September from the live server.log: 24 refused equipment updates over two
  # days, every one of them 'inventory does not contain item 13790', which is
  # IronWarAxe. Skyrim Unbound hands out starting gear inside the client's own
  # game and the server never sees it happen, so the first equipment update a new
  # character sends names an item the server has no record of, and upstream throws
  # the WHOLE update away for it. The equipment record then stays empty all
  # session, and on the next spawn the client empties the pack and refills it from
  # that empty record, four times in a second and a half. equipmentSlotCheckEnabled
  # and equipmentSpellCheckEnabled are the other two refusals, neither of which the
  # log shows firing, both switchable in our fork already.
  # equipmentInventoryCheckEnabled is the one that matters and it needs the server
  # rebuilt from thornswood/engine-changes before it does anything; an unknown key
  # is ignored until then.
  #
  # AND THE START POINT MOVES WITH THE LOAD ORDER, added 23 September.
  #
  # The block below rewrites loadOrder on the dev box whenever the build's
  # order differs from the one up there. startPoints sits in the same file and
  # holds a form id, and a form id is fileIndex * 0x01000000 + local id, so
  # moving the load order under it silently points it at a different plugin,
  # or at no plugin at all.
  #
  # That is what happened. The dev settings were written on 22 September when
  # Skyrim Unbound.esp was at index 58; the order moved and Unbound is at 54
  # there now, in a list of 57. Every new character on dev died at login with
  #   Error: FromFormId failed due to invalid file index 58  (spawn.ts:38)
  # and the client showed its OOPS box with no way to tell what was wrong.
  # Patrick hit it on 23 September at 18:30.
  #
  # The index is recomputed here from whatever load order this run leaves on
  # the box, and only the index: the local id is kept exactly as it was, so
  # this fixes a moved plugin and never decides where the creation room is.
  # Deploy-Gamemode.ps1 computes the same thing the same way for the live
  # server, which is why live was right and dev was not.
  #
  # AND THE INDEX COUNTS FULL PLUGINS ONLY, added 5 October for #2011. With an
  # engine that loads light plugins (#1715) the list holds them too, and a form
  # id's top byte is a plugin's place among the full plugins, never its place
  # in the list. This counted the list, so the 10:01 PM deploy of 5 October put
  # the start point at 0x5E19BAD4 (Unbound 94th in the list, 45th among full
  # plugins) and every new character died at login with
  #   Error: FromFormId failed due to invalid file index 94 (5e19bad4)
  # It counts with Get-ThornswoodFullIndex now, the one Deploy-Gamemode,
  # Publish-Server and Check-Chargen use, sent up with the block. Light ones
  # count as unnumbered only when the record this commit holds says the
  # engine loads them (the check before anything is sent holds the box's
  # record to it).
  #
  # WHICH PLUGINS ARE LIGHT IS READ ON THE BOX, from the plugins the dev
  # server loads, since #2947: a plugin this run sends from the stage, every
  # other from its plugins folder, by Test-ThornswoodPluginLight sent up with
  # the block. Until then it was read here, from the headers in -Data, so a
  # machine with no game folder (a cloud one) sent no table and left the
  # start point where it was even when the order moved under it, and a game
  # folder with another copy of a plugin could answer for the wrong file. A
  # plugin in the order the box cannot read leaves the start point alone and
  # says so, rather than guessing its index.
  #
  # AND HOW MANY IT HOLDS AT ONCE, #481. thornswoodMostOnline is the number the
  # gamemode turns people away past, and maxPlayers, the engine's own slot
  # count, is set that plus the staff seats, both from records\most-online.json
  # read above, its dev numbers. With no number both are left as the box has them and that does
  # not count as a reason to rewrite.
  #
  # AND NO "default" KEY IN npcSettings, added 28 September for issue #879. The
  # engine reads every key of npcSettings as a plugin name and refuses every NPC
  # when one names no loaded plugin, so {"default": {...}} emptied the world:
  # NPCs showed for a moment and went, or never showed. Deploy-Gamemode stopped
  # writing it in #880, but this script never sends the settings file, so the
  # dev box kept the old one. The key is dropped here and the rest of npcSettings
  # is left as it is.
  #
  # AND THE PEOPLE COME BACK, added 28 September for issue #956. Two more gates
  # in the engine refuse an NPC, both off unless a setting says otherwise, and no
  # script here ever said so: npcAllowCrimeFaction (anyone in a hold's crime
  # faction, which is every guard and nearly every townsperson) and
  # npcAllowEssential (essential, protected and unique actors, which is every
  # named shopkeeper and resident). Animals are in neither, which is why they
  # came back with #879 and the people did not. Measured with the server binary
  # over the dev load order: 1406 of 4942 people in Skyrim.esm load with both
  # off, 3274 with both on; across the other plugins 275 of 1445 against 1243.
  # Belethor, Hulda and Nazeem are refused on both counts. Both are set true
  # here on every run.
  #
  # AND WHETHER A WRONG LOAD ORDER ENDS THE SESSION, added 28 September for
  # #402. -LoadOrderRefuse on sets thornswoodLoadOrderRefuse true, off sets it
  # false, and leaving the switch off keeps whatever the box has. This is the
  # only place the dev settings are edited, so the switch lives here.
  #
  # AND WHETHER A SESSION NEEDS A JOIN PASS, added 28 September for #937.
  # -RequirePass on sets thornswoodRequirePass true, off sets it false, and no
  # switch keeps what the box has. thornswoodServer is always dev here, so a pass
  # the site issued for the live server is refused on this one.
  #
  # AND WHETHER THE SERVER KEEPS NPCS ALIVE, added 28 September for #385.
  # -Npcs off sets npcEnabled false and -Npcs on sets it true, which with the
  # empty npcSettings above is every NPC in the world. Nothing else changes, so
  # the same spot on dev with it off and then on is the before and after.
  #
  # This comment is HERE and not inside the here-string below on purpose. Anything
  # in that string is base64 encoded and sent as an ssh command line, where it
  # counts double and the far end truncates at about 8191 characters. Ten lines of
  # comment in there took the block from roughly 7,400 to 10,252 and the VPS
  # received a script that stopped in the middle of the line that writes the file.
  #
  # EVERY KEY THE BLOCK BELOW MAY SET, and no other (#1224). The stage is a
  # copy of the running settings taken before the countdown, so anything that
  # changed the running file meanwhile (a second run, Publish-Server -Channel
  # dev, a hand edit) would be overwritten by the older copy at the swap, and
  # nothing said so. These are handed to the swap, which reads every other key
  # of the staged file back against the running one before it starts anything
  # and puts the old files back when one moved: the read-back #1222 gave
  # Deploy-Server. tests\test-dev-settings-keys.ps1 holds this list to the
  # keys the block writes.
  $DevSettingsKeys = @(
    'loadOrder', 'startPoints', 'thornswoodMostOnline', 'maxPlayers', 'npcSettings',
    'npcAllowCrimeFaction', 'npcAllowEssential', 'thornswoodLoadOrderRefuse',
    'thornswoodRequirePass', 'thornswoodServer', 'npcEnabled', 'thornswoodVoicePort',
    'equipmentSlotCheckEnabled', 'equipmentSpellCheckEnabled', 'equipmentInventoryCheckEnabled',
    'equipItemAttemptEnabled', 'forbiddenReloot', 'forbiddenBaseContainer'
  )
  # The counting function (#2011) and the light rule (#2947) the block below
  # takes up, both from ServerOrder.ps1.
  . (Join-Path $Here 'ServerOrder.ps1')
  $fullIndexDef = 'function Get-ThornswoodFullIndex {' + "`n" + (Get-Command Get-ThornswoodFullIndex).Definition + "`n}"
  $lightDef = 'function Test-ThornswoodPluginLight {' + "`n" + (Get-Command Test-ThornswoodPluginLight).Definition + "`n}"
  & {
    # The block below edits the staged copy, never the running one: $rootWin
    # is the stage folder for as long as it runs (issue #446).
    $rootWin = $stageWin
Remote @"
`$p = Join-Path '$rootWin' 'server-settings.json'
if (-not (Test-Path `$p)) { 'NO server-settings.json AT ' + `$p; exit 0 }
# Read once, as bytes, for the byte order mark below as well. A file that is
# there and does not read stops the block before anything is written, and the
# exit code stops the deploy.
`$raw = `$null; `$s = `$null
try { `$raw = [IO.File]::ReadAllBytes(`$p); `$s = Get-Content `$p -Raw -ErrorAction Stop | ConvertFrom-Json }
catch { 'SETTINGS UNREADABLE on the stage: ' + `$_.Exception.Message + '. Nothing was written.'; exit 1 }
if (`$null -eq `$s) { 'SETTINGS UNREADABLE on the stage: it is empty. Nothing was written.'; exit 1 }
`$have = 0
if (`$s.PSObject.Properties.Name -contains 'thornswoodVoicePort') { `$have = [int]`$s.thornswoodVoicePort }
`$wantEquip = `$false
foreach (`$k in 'equipmentSlotCheckEnabled','equipmentSpellCheckEnabled','equipmentInventoryCheckEnabled') {
  if (`$s.PSObject.Properties.Name -notcontains `$k) { `$wantEquip = `$true }
  elseif (`$s.`$k -ne `$false) { `$wantEquip = `$true }
}
# The one equipment switch that is on, the engine asking before it puts an
# item on (#2262, written out in Deploy-Gamemode.ps1).
if (`$s.PSObject.Properties.Name -notcontains 'equipItemAttemptEnabled' -or `$s.equipItemAttemptEnabled -ne `$true) { `$wantEquip = `$true }
`$wantOrder = `$false
`$newOrder = @()
`$orderWire = '$orderWire'
if (`$orderWire) {
  `$names = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(`$orderWire)) -split "``n" | ForEach-Object { `$_.Trim() } | Where-Object { `$_ })
  if (`$names.Count) {
    `$newOrder = @(`$names | ForEach-Object { '$remotePlugins/' + `$_ })
    `$oldOrder = @(`$s.loadOrder)
    if ((`$oldOrder -join '|') -ne (`$newOrder -join '|')) {
      `$wantOrder = `$true
      'the load order moves from ' + `$oldOrder.Count + ' plugins to ' + `$newOrder.Count
      `$n = [Math]::Max(`$oldOrder.Count, `$newOrder.Count)
      for (`$i = 0; `$i -lt `$n; `$i++) {
        `$a = ''; `$b = ''
        if (`$i -lt `$oldOrder.Count) { `$a = Split-Path `$oldOrder[`$i] -Leaf }
        if (`$i -lt `$newOrder.Count) { `$b = Split-Path `$newOrder[`$i] -Leaf }
        if (`$a -ne `$b) { '  they first differ at position ' + `$i + ': had ' + `$a + ', now ' + `$b; break }
      }
    } else {
      'the load order is already the ' + `$newOrder.Count + ' the build names'
    }
  }
}
# The start point, against the order this run leaves behind.
`$wantStart = `$false
`$startWas = 0
`$startWant = 0
`$order2 = @(`$(if (`$wantOrder) { `$newOrder } else { @(`$s.loadOrder) }))
$fullIndexDef
$lightDef
`$loadsLight = `$$devRecordLight
`$lightOf = @{}
`$unread = @()
`$isLight = `$null
if (`$loadsLight) {
  foreach (`$o in `$order2) {
    `$leaf = Split-Path `$o -Leaf
    `$f = Join-Path '$rootWin' ('plugins\' + `$leaf)
    if (-not (Test-Path -LiteralPath `$f)) { `$f = '$remotePlugins/' + `$leaf }
    try { `$lightOf[`$leaf.ToLowerInvariant()] = Test-ThornswoodPluginLight `$f } catch { `$unread += `$leaf.ToLowerInvariant() }
  }
  `$isLight = { param(`$n) [bool]`$lightOf[`$n.ToLowerInvariant()] }.GetNewClosure()
}
`$unb = Get-ThornswoodFullIndex ([string[]]`$order2) `$isLight 'Skyrim Unbound.esp'
`$pt = @(`$s.startPoints)[0]
if (`$unread.Count) {
  'cannot tell whether ' + (`$unread -join ', ') + ' is light, so the start point is left alone'
} elseif (`$pt -and `$unb -ge 0) {
  `$startWas = [int64]`$pt.worldOrCell
  `$startWant = (`$unb * 0x01000000) + (`$startWas -band 0x00FFFFFF)
  if (`$startWas -ne `$startWant) {
    `$wantStart = `$true
    'the start point names file index ' + [int](`$startWas -shr 24) +
      ', and Skyrim Unbound.esp is full plugin ' + `$unb + ' in this load order. A new character cannot spawn.'
  }
} elseif (-not `$pt) { 'no startPoints in the dev settings, leaving that alone' }
elseif (`$unb -lt 0) { 'Skyrim Unbound.esp is not in this load order, leaving the start point alone' }
`$wantNpc = (`$s.npcSettings -and (`$s.npcSettings.PSObject.Properties.Name -contains 'default'))
if (`$wantNpc) { 'npcSettings has a default key, which refuses every NPC. Dropping it.' }
`$wantPeople = (`$s.npcAllowCrimeFaction -ne `$true -or `$s.npcAllowEssential -ne `$true)
if (`$wantPeople) { 'guards, shopkeepers and named people were refused (npcAllowCrimeFaction ' + `$s.npcAllowCrimeFaction + ', npcAllowEssential ' + `$s.npcAllowEssential + '). Letting them in.' }
`$wantMax = `$false
if ($maxOnline -gt 0 -and ([int]`$s.thornswoodMostOnline -ne $maxOnline -or [int]`$s.maxPlayers -ne [int]'$seats')) {
  `$wantMax = `$true
  'the most online moves from ' + `$s.thornswoodMostOnline + ' to $maxOnline, engine seats from ' + `$s.maxPlayers + ' to $seats'
}
`$wantRefuse = `$false
`$refuse = ('$LoadOrderRefuse' -eq 'on')
if ('$LoadOrderRefuse' -and `$s.thornswoodLoadOrderRefuse -ne `$refuse) {
  `$wantRefuse = `$true
  'thornswoodLoadOrderRefuse moves from ' + `$s.thornswoodLoadOrderRefuse + ' to ' + `$refuse
}
`$wantPass = `$false
`$needPass = ('$RequirePass' -eq 'on')
if ('$RequirePass' -and (-not (`$s.thornswoodRequirePass -is [bool]) -or `$s.thornswoodRequirePass -ne `$needPass)) {
  `$wantPass = `$true
  'thornswoodRequirePass moves from ' + `$s.thornswoodRequirePass + ' to ' + `$needPass
}
`$wantServer = (`$s.thornswoodServer -ne 'dev')
if (`$wantServer) { 'thornswoodServer moves from ' + `$s.thornswoodServer + ' to dev' }
`$wantNpcs = `$false
`$npcOn = ('$Npcs' -eq 'on')
if ('$Npcs' -and `$s.npcEnabled -ne `$npcOn) {
  `$wantNpcs = `$true
  'npcEnabled moves from ' + `$s.npcEnabled + ' to ' + `$npcOn
}

# A byte order mark counts as needing a rewrite even when the number is
# already right. The run on 18 September set the value AND wrote a mark, so
# a second run that only compared the number would have said 'already 7789'
# and left the server unable to parse its own settings.
`$bom = (`$raw.Length -gt 0 -and `$raw[0] -eq 0xEF)
if (`$bom) { 'the settings file starts with a byte order mark, rewriting it without one' }
if (`$have -eq $VoicePort -and -not `$bom -and -not `$wantEquip -and -not `$wantOrder -and -not `$wantStart -and -not `$wantMax -and -not `$wantNpc -and -not `$wantPeople -and -not `$wantRefuse -and -not `$wantPass -and -not `$wantServer -and -not `$wantNpcs) {
  'thornswoodVoicePort is already $VoicePort, both equipment checks are already off, and the load order is already right'
} else {
  Copy-Item `$p (`$p + '.before-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force
  if (`$wantOrder) { `$s | Add-Member -NotePropertyName loadOrder -NotePropertyValue `$newOrder -Force }
  if (`$wantStart) {
    `$pt.worldOrCell = ('0x{0:X8}' -f `$startWant)
    `$s | Add-Member -NotePropertyName startPoints -NotePropertyValue @(`$pt) -Force
    'start point moved to 0x{0:X8}, index {1}' -f `$startWant, `$unb
  }
  if (`$wantMax) {
    `$s | Add-Member -NotePropertyName thornswoodMostOnline -NotePropertyValue $maxOnline -Force
    `$s | Add-Member -NotePropertyName maxPlayers -NotePropertyValue $seats -Force
  }
  if (`$wantNpc) { `$s.npcSettings.PSObject.Properties.Remove('default') }
  `$s | Add-Member -NotePropertyName npcAllowCrimeFaction -NotePropertyValue `$true -Force
  `$s | Add-Member -NotePropertyName npcAllowEssential -NotePropertyValue `$true -Force
  if (`$wantRefuse) { `$s | Add-Member -NotePropertyName thornswoodLoadOrderRefuse -NotePropertyValue `$refuse -Force }
  if (`$wantPass) { `$s | Add-Member -NotePropertyName thornswoodRequirePass -NotePropertyValue `$needPass -Force }
  `$s | Add-Member -NotePropertyName thornswoodServer -NotePropertyValue 'dev' -Force
  if (`$wantNpcs) { `$s | Add-Member -NotePropertyName npcEnabled -NotePropertyValue `$npcOn -Force }
  `$s | Add-Member -NotePropertyName thornswoodVoicePort -NotePropertyValue $VoicePort -Force
  `$s | Add-Member -NotePropertyName equipmentSlotCheckEnabled  -NotePropertyValue `$false -Force
  `$s | Add-Member -NotePropertyName equipmentSpellCheckEnabled -NotePropertyValue `$false -Force
  `$s | Add-Member -NotePropertyName equipmentInventoryCheckEnabled -NotePropertyValue `$false -Force
  `$s | Add-Member -NotePropertyName equipItemAttemptEnabled -NotePropertyValue `$true -Force
  # Nothing in the world comes back except FLOR and TREE, which is the hanging
  # meat, the garlic, the elves ears, every plant and every crop. The argument
  # and the census behind the exception are written out in Deploy-Gamemode.ps1;
  # dev carries the same list so that a thing tested here behaves the same live.
  `$s | Add-Member -NotePropertyName forbiddenReloot -NotePropertyValue @(
      'CONT',
      'WEAP', 'ARMO', 'AMMO', 'MISC', 'ALCH', 'INGR', 'BOOK', 'SLGM', 'SCRL',
      'LIGH', 'KEYM', 'NOTE'
  ) -Force
  # A container starts with none of its record's contents (#3078): the
  # argument is written out in Deploy-Gamemode.ps1, and dev carries the same.
  `$s | Add-Member -NotePropertyName forbiddenBaseContainer -NotePropertyValue @('CONT') -Force
  # NOT Set-Content -Encoding UTF8. At the far end of ssh this is Windows
  # PowerShell 5.1, where that means UTF-8 WITH a byte order mark, and the
  # server reads this file with JSON.parse, which refuses one:
  #   SyntaxError: Unexpected token 'ï»¿' is not valid JSON
  # On 18 September that took the dev server down on the first run of this
  # step. pwsh 7 writes no mark for the same flag, so it looks fine here and
  # breaks there. WriteAllText with an explicit UTF8Encoding($false) is the
  # one spelling that means the same thing in both.
  `$json = `$s | ConvertTo-Json -Depth 30
  [IO.File]::WriteAllText(`$p, `$json, (New-Object Text.UTF8Encoding `$false))
  'thornswoodVoicePort set to $VoicePort, was ' + `$have + '. Old file kept as server-settings.json.before-<stamp>'
  # Proved rather than assumed: reparse what was written, and check the
  # first byte is not a mark.
  try {
    `$back = Get-Content `$p -Raw | ConvertFrom-Json
    `$b0 = [IO.File]::ReadAllBytes(`$p)[0]
    if (`$b0 -eq 0xEF) { 'WROTE A BYTE ORDER MARK. The server will not start. Put the .before- copy back.' }
    else { 'read back fine, thornswoodVoicePort is ' + `$back.thornswoodVoicePort +
            ', gear strip ' + `$back.equipmentSlotCheckEnabled +
            ', spell strip ' + `$back.equipmentSpellCheckEnabled +
            ', unknown item vetoes ' + `$back.equipmentInventoryCheckEnabled +
            ', load order ' + @(`$back.loadOrder).Count + ' plugins' +
            ', most online ' + `$back.thornswoodMostOnline + ', engine seats ' + `$back.maxPlayers +
            ', npcSettings keys ' + @(`$back.npcSettings.PSObject.Properties).Count +
            ', guards and townsfolk ' + `$back.npcAllowCrimeFaction + ', named people ' + `$back.npcAllowEssential +
            ', load order refusal ' + `$back.thornswoodLoadOrderRefuse +
            ', join pass required ' + `$back.thornswoodRequirePass + ' on ' + `$back.thornswoodServer +
            ', NPCs ' + `$back.npcEnabled +
            ', start point ' + @(`$back.startPoints)[0].worldOrCell }
  } catch {
    'THE FILE NO LONGER PARSES: ' + `$_.Exception.Message + '. Put the .before- copy back.'
  }
}
"@ | ForEach-Object { "  $_" }
  }
  if ($LASTEXITCODE -ne 0) { throw "the staged settings could not be edited on the dev box (exit $LASTEXITCODE), the lines above say why. The dev server has not been touched." }

  # The settings the block above left in the stage are hashed there, so the
  # check holds them to what was written, like every file sent from here.
  $sum = @(Remote "(Get-FileHash -LiteralPath '$stageWin\server-settings.json' -Algorithm SHA256).Hash" |
           ForEach-Object { "$_".Trim() } | Where-Object { $_ -match '^[0-9A-Fa-f]{64}$' })
  if (-not $sum.Count) { throw "the staged settings could not be read back on the dev box. The dev server has not been touched." }
  $hashes['server-settings.json'] = $sum[0].ToLowerInvariant()

  $checkOut = @(Remote ((SwapVars $Root $Task $stageName $prevName $Wait $hashes) + $checkBlock) |
                ForEach-Object { Write-Host ('  ' + $_); "$_".Trim() })
  if ($checkOut -notcontains 'STAGE OK') {
    Write-Host ''
    Write-Host '  THE STAGE DID NOT CHECK OUT, so nothing was stopped and nobody was warned.' -ForegroundColor Red
    Write-Host '  The dev server is still running exactly as it was. The lines above say why.' -ForegroundColor Red
    throw 'the stage did not check out, so the dev server was left running'
  }
}

# ------------------------------------------------------------ the reload ---
#
# A run that sends only the gamemode and its stamp puts them in while the dev
# server runs, and the server loads the new gamemode there (#3196, Reload.ps1
# says how and when). Nobody is dropped, so nobody is warned. Anything else,
# or -Restart, or -PutBack, is the warning and the swap below, which restart.
# $outcome: swap (restart), reloaded, refused (the reload put nothing in, or
# put the old one back and the server loaded it), or recover (the old files
# are back on disk and the server did not load them, so the swap starts it
# with them, as -PutBack does).
$outcome = 'swap'
if (-not $PutBack -and -not $Restart) {
  Write-Host ''
  Write-Host 'Loading the new gamemode in the running dev server...'
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $reloadOut = @(Remote ((ReloadVars $Root $Task $stageName $prevName $Wait $hashes $newBlob $newTree) + $reloadBlock) |
                   ForEach-Object { Write-Host ('  ' + $_); "$_".Trim() })
  } finally { $ErrorActionPreference = $eap }
  if ($reloadOut -contains 'RELOAD OK') { $outcome = 'reloaded' }
  elseif ($reloadOut -contains 'RELOAD NOT HERE') { Write-Host '  so the dev server restarts with it' }
  elseif ($reloadOut -contains 'RELOAD FAILED') {
    $outcome = 'recover'
    Write-Host ''
    Write-Host '  FAIL. The new gamemode did not load, the old one is back on disk, and the' -ForegroundColor Red
    Write-Host '  server did not load that either. It restarts now with the old files.' -ForegroundColor Red
  } else {
    $outcome = 'refused'
    Write-Host ''
    if ($reloadOut -contains 'RELOAD PUT BACK') {
      Write-Host '  FAIL. The new gamemode did not load, so the old one was put back and the' -ForegroundColor Red
      Write-Host '  dev server loaded it again. It was never stopped. The lines above say why.' -ForegroundColor Red
    } elseif ($reloadOut -contains 'RELOAD REFUSED') {
      Write-Host '  FAIL. Nothing was put in and the dev server runs as it was. The lines above say why.' -ForegroundColor Red
    } else {
      Write-Host '  FAIL, AND THE BOX MAY NOT BE AS IT WAS: the reload did not say how it ended.' -ForegroundColor Red
      Write-Host "  What it replaced is in $rootWin\$prevName. Look at the dev server before anything else." -ForegroundColor Red
    }
  }
}

$swapped = $false
if ($outcome -eq 'swap' -or $outcome -eq 'recover') {
Write-Host ''
Write-Host 'Who is on the dev server...'
Warn-DevRoom

# The stop, the renames, the start, the check that it answers on its game port
# and its resources port, and the way back if it does not: Swap.ps1's
# $swapBlock, the one Deploy-Server.ps1 runs on live. It stops only whatever
# holds this root's own UDP port, so the live server is never touched, and it
# removes any restart.json the old process never read, so the next one does
# not count down on its own. What it replaced is kept in .prev-<stamp>.
# After a reload that ended with the old files on disk and not loaded, it is
# the put-back: those files, from the .prev the reload kept them in.
Write-Host ''
Write-Host 'Stopping the dev server...'
$pick = ''
if ($PutBack -or $outcome -eq 'recover') { $pick = $putBackPick }
# A put-back sends nothing and edits nothing, so it has no keys of its own and
# no read-back: what it puts back is the whole previous set of files.
$readBackKeys = $null
if (-not $PutBack -and $outcome -eq 'swap') { $readBackKeys = $DevSettingsKeys }
# A stray line on stderr must not stop this side reading while the far side is
# half way through a swap.
$eap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $swapOut = @(Remote ((SwapVars $Root $Task $stageName $prevName $Wait $hashes $readBackKeys) + $pick + $swapBlock) |
               ForEach-Object { Write-Host ('  ' + $_); "$_".Trim() })
} finally { $ErrorActionPreference = $eap }
$swapped = Show-SwapResult $swapOut "$rootWin\.prev-<stamp>"
}

Write-Host ''
Write-Host 'What it is running...'
Remote @"
`$s = Get-Content '$rootWin\server-settings.json' -Raw | ConvertFrom-Json
`$port = [int]`$s.port
if (Get-NetUDPEndpoint -LocalPort `$port -EA SilentlyContinue) { 'dev server up on UDP ' + `$port } else { 'DEV SERVER IS NOT LISTENING on UDP ' + `$port }
# The manifest is what the client actually compares its game against, and the
# server writes it at startup out of the settings above. Saying the settings
# were written is not the same as saying the server agreed to them.
`$dataDir = 'data'
if (`$s.dataDir) { `$dataDir = [string]`$s.dataDir }
`$mf = Join-Path (Join-Path '$rootWin' `$dataDir) 'manifest.json'
if (Test-Path `$mf) {
  try {
    `$m = Get-Content `$mf -Raw | ConvertFrom-Json
    'manifest: ' + @(`$m.loadOrder).Count + ' plugins, written ' + (Get-Item `$mf).LastWriteTime
  } catch { 'manifest: UNREADABLE, ' + `$_.Exception.Message }
} else { 'manifest: not written yet' }
if (Test-Path '$rootWin\server.log') {
  '--- server.log, last 15 ---'
  Get-Content '$rootWin\server.log' -Tail 15
}
"@ | ForEach-Object { "  $_" }

# Deployed: a reload the server loaded, or a swap that answered. A reload
# that did not take has deployed nothing, even when the put-back swap after it
# answered, and the record beside the server still names what it runs, since
# only a deploy that worked writes one.
$deployed = ($outcome -eq 'reloaded') -or ($outcome -eq 'swap' -and $swapped)
if (-not $deployed) { exit 1 }

# The new gamemode is in place and the dev server answers: the box records
# that it runs this artifact, and serves the record from its data folder, so
# http://<box>:7788/thornswood-deploy.json says which commit it runs. The
# record it had goes into .prev with the files it describes (Swap.ps1, and
# Reload.ps1 for a reload), and after -PutBack the record that came back with
# them is the one recorded.
if ($PutBack) { Restore-SwapRecord "$User@$Vps" $ssh $Root $swapOut "$Root/data/thornswood-deploy.json" 'gamemode' }
else {
  Save-SwapPreviousRecord "$User@$Vps" $ssh $Root $prevName "$Root/data/thornswood-deploy.json"
  $null = Set-ThornswoodArtifactCurrent -Artifact $artifact -Target "$User@$Vps" -SshArgs $ssh -Root $Root -Beside "$Root/data/thornswood-deploy.json"
}

if ($deployed -and $ShipFollows) {
  Write-Host ''
  Write-Host '  -ShipFollows: nothing posted, the dev Ship that follows says this change.' -ForegroundColor DarkGray
}
elseif ($deployed -and -not $PutBack) {
  $discord = Join-Path $Here '..\ops\Publish-Discord.ps1'
  if (Test-Path -LiteralPath $discord) {
    Write-Host ''
    Write-Host 'Telling the dev updates channel...'
    try {
      & $discord -Dev -Note $Note -GamemodeDeploy
    } catch {
      Write-Host "  COULD NOT POST TO DISCORD: $_" -ForegroundColor Red
      exit 1
    }
    if ($global:ThornswoodDiscordResult -eq 'failed') { exit 1 }
  } else {
    Write-Host '  Publish-Discord.ps1 is missing, the dev updates channel was not told.' -ForegroundColor Yellow
    exit 1
  }
}
