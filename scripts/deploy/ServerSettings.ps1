<#
  ServerSettings.ps1

  Which settings a game server install takes from the release, and which it
  keeps from the server it replaces. Dot-sourced by Install-ThornswoodServer.ps1
  (on the box, from beside it: Publish-Server.ps1 sends the two together),
  Export-ServerPayload.ps1 and Deploy-Server.ps1. Deploy-Server also sends
  this file's text to the box in front of $settingsCarryBlock, so the carry
  is done there, against the file the running server has.

  WHY, issue #1222. Dev rollout 6, 29 September: Publish-Server.ps1 -Channel
  dev unpacked the build's server-settings.json over the dev server's own,
  with only the port, the voice port and the name made the dev ones. The dev
  server came up with thornswoodServer, thornswoodLoadOrderRefuse and
  thornswoodRequirePass empty and an npcSettings "default" key, which refuses
  every NPC, until Deploy-DevGamemode.ps1 put them back. A live publish would
  have done the same to live, and so would a Deploy-Server.ps1 from a build
  whose settings are not the live server's (#1221).

  THE RULE. The settings a server runs are its own. An install starts from the
  file the running server has, and takes from the release only the keys the
  release is meant to change:

    a server install, Publish-Server.ps1 and Install-ThornswoodServer.ps1
    ($ThornswoodInstallKeys):
      loadOrder             the payload carries the plugins it names, and
                            every form id resolves against their order
      startPoints           a form id, whose file index is that order's
      thornswoodMostOnline  how many it holds, and the engine's seats over it
      maxPlayers            for staff, from records\most-online.json (the
                            channel's own numbers), which
                            Publish-Server holds to the commit and every deploy
                            writes the same (#481)

    Deploy-Server.ps1, the second half of the live pair
    ($ThornswoodGamemodeKeys): those, and what Deploy-Gamemode.ps1 writes for
    the live server on purpose, because Deploy-Gamemode then Deploy-Server is
    the one route that changes them on live: offlineMode, the live voice
    port, thornswoodServer main, and the NPC, gear, reloot and damage settings.

  THE JOIN PASS AND THE WRITTEN ROLE LISTS ARE NEVER TAKEN FROM A BUILD
  (#1223). thornswoodRequirePass, thornswoodDevs and thornswoodPlaytesters
  used to be release keys, written into a machine's build by
  Deploy-Gamemode.ps1 -RequirePass, -Devs and -Playtesters and kept in that
  build for good, so every later Deploy-Server from that machine sent them
  again: a second machine given -RequirePass off a week before would turn the
  live hold off with nothing said but the key's name. Now they are the
  server's own, like every switch, and change on live only when the person
  deploying asks in that run: Deploy-Server.ps1 -RequirePass on|off, -Devs,
  -Playtesters, set on the box by the carry ($Asked, below), the way
  Deploy-DevGamemode.ps1 -RequirePass sets dev's. A server install takes the
  join pass the same way (#1804): Publish-Server.ps1 -RequirePass on|off,
  which Install-ThornswoodServer.ps1 sets over the running server's, or into
  a first install's.

  Everything else stays as the running server has it: every other thornswood
  switch (the load order refusal, the join pass), npcSettings, the role lists,
  the ports, the name, dataDir, and anything the release does not name. A key
  the release has and the server does not is not added, and a release key the
  release does not have stays as the server has it. On dev,
  Deploy-DevGamemode.ps1 is what changes the switches; on live, Deploy-Gamemode
  then Deploy-Server, and Deploy-Server's own switches for the join pass and
  the role lists. The two boxes keep their own, on their own folders.

  A GAMEMODE-ONLY DEPLOY TAKES NO KEY AT ALL (#1089). Deploy-Server.ps1
  -GamemodeOnly sends no settings and has no build to take any from, so the
  stage gets the running server's own file, copied unchanged on the box
  ($settingsKeepBlock), and the swap lets no key move. It takes none of
  -RequirePass, -Devs and -Playtesters; those are a full deploy.

  Values are compared as compact JSON, so an array and an object compare by
  what they hold. Nothing here prints a value: server-settings.json is the
  server's config, and only key names are said.

  Keep it ASCII. It runs on the box, in PowerShell 7.
#>

$ThornswoodInstallKeys = @('loadOrder', 'startPoints', 'thornswoodMostOnline', 'maxPlayers')
$ThornswoodGamemodeKeys = @($ThornswoodInstallKeys + @(
    'offlineMode', 'thornswoodVoicePort', 'thornswoodServer', 'npcEnabled', 'npcAllowCrimeFaction',
    'npcAllowEssential', 'npcSettings', 'forbiddenReloot', 'forbiddenBaseContainer', 'equipmentSlotCheckEnabled',
    'equipmentSpellCheckEnabled', 'equipmentInventoryCheckEnabled', 'equipItemAttemptEnabled', 'damageMultFormulaSettings'))
# The keys only the person deploying sets, in that run, never a build (#1223):
# Deploy-Server.ps1 -RequirePass, -Devs and -Playtesters.
$ThornswoodAskedKeys = @('thornswoodRequirePass', 'thornswoodDevs', 'thornswoodPlaytesters')

# What a Deploy-Server run asked for (#1223), as the $Asked that
# Join-ThornswoodServerSettings takes: only the switches that were given.
function New-ThornswoodAsked([string]$RequirePass = '', [long[]]$Devs = @(), [long[]]$Playtesters = @()) {
    $a = [ordered]@{}
    if ($RequirePass) { $a['thornswoodRequirePass'] = ($RequirePass -eq 'on') }
    if (@($Devs).Count) { $a['thornswoodDevs'] = @($Devs) }
    if (@($Playtesters).Count) { $a['thornswoodPlaytesters'] = @($Playtesters) }
    return $a
}

# The line Deploy-Server puts in front of $settingsCarryBlock, so the box has
# $Asked: booleans and profile numbers only, as JSON in one quoted string.
function Get-ThornswoodAskedLine($Asked) {
    $json = ConvertTo-Json -InputObject $Asked -Compress -Depth 5
    return ('$Asked = ''' + $json.Replace("'", "''") + ''' | ConvertFrom-Json' + "`r`n")
}

function Get-ThornswoodSettingText($Value) {
    if ($null -eq $Value) { return 'null' }
    return (ConvertTo-Json -InputObject $Value -Compress -Depth 30)
}

function Get-ThornswoodSettingNames($Settings) {
    if ($null -eq $Settings) { return @() }
    return @($Settings.PSObject.Properties | ForEach-Object { $_.Name })
}

<#
  The running server's settings with the release's keys put in. Returns
  Settings (the object to write), Changed (release keys that move), Kept
  (keys the release had differently, or had and the server does not, left as
  the server has them), Absent (release keys the release does not carry at
  all, left as the server has them), and Said, the lines to print.

  Absent used to go unsaid (#1336). A live deploy whose build carried no
  thornswoodRequirePass, or no role lists, kept the running server's and the
  run said only which keys moved, so it read the same as one that had set
  them. Now each is named. Names only, never a value.

  $Asked (#1223) is what the person deploying asked for in this run, as an
  object of key and value: Deploy-Server.ps1 -RequirePass, -Devs and
  -Playtesters. Each is put in over the running server's, whatever the
  release has, and comes back as Set (the asked keys that move) and in Said.
  A key asked for is never taken from the release and never called kept or
  absent, even when $Keys names it (Deploy-Server's read-back list does).
#>
function Join-ThornswoodServerSettings($Running, $Release, [string[]]$Keys, $Asked = $null) {
    $runNames = Get-ThornswoodSettingNames $Running
    $relNames = Get-ThornswoodSettingNames $Release
    $askNames = Get-ThornswoodSettingNames $Asked
    $out = [ordered]@{}
    foreach ($n in $runNames) { $out[$n] = $Running.$n }
    $changed = @()
    foreach ($k in $Keys) {
        if ($relNames -notcontains $k -or $askNames -contains $k) { continue }
        if ($runNames -notcontains $k -or (Get-ThornswoodSettingText $Running.$k) -ne (Get-ThornswoodSettingText $Release.$k)) { $changed += $k }
        $out[$k] = $Release.$k
    }
    $set = @()
    foreach ($k in $askNames) {
        if ($runNames -notcontains $k -or (Get-ThornswoodSettingText $Running.$k) -ne (Get-ThornswoodSettingText $Asked.$k)) { $set += $k }
        $out[$k] = $Asked.$k
    }
    $kept = @()
    foreach ($k in $relNames) {
        if ($Keys -contains $k -or $askNames -contains $k) { continue }
        if ($runNames -notcontains $k -or (Get-ThornswoodSettingText $Running.$k) -ne (Get-ThornswoodSettingText $Release.$k)) { $kept += $k }
    }
    $absent = @($Keys | Where-Object { $relNames -notcontains $_ -and $askNames -notcontains $_ })
    $said = @()
    if ($changed.Count) { $said += ('the settings this release changes: ' + ($changed -join ', ')) }
    else { $said += 'this release changes none of the settings' }
    if ($set.Count) { $said += ('set as this run asked: ' + ($set -join ', ')) }
    $same = @($askNames | Where-Object { $set -notcontains $_ })
    if ($same.Count) { $said += ('already as this run asked, so unchanged: ' + ($same -join ', ')) }
    if ($absent.Count) { $said += ('not in the release, so left as the running server has them: ' + ($absent -join ', ')) }
    if ($kept.Count) { $said += ('kept as the running server has them, not as the release had them: ' + ($kept -join ', ')) }
    $said += ('every other setting of the ' + $runNames.Count + ' the running server has is carried across as it is')
    return [pscustomobject]@{ Settings = [pscustomobject]$out; Changed = $changed; Set = $set; Kept = $kept; Absent = $absent; Said = $said }
}

# The keys outside -Keys whose values differ between two settings objects, or
# that one has and the other does not: what a read-back after an install
# refuses.
function Compare-ThornswoodCarried($Before, $After, [string[]]$Keys) {
    $a = Get-ThornswoodSettingNames $Before
    $b = Get-ThornswoodSettingNames $After
    $moved = @()
    foreach ($k in @($a + $b | Sort-Object -Unique)) {
        if ($Keys -contains $k) { continue }
        if (($a -contains $k) -ne ($b -contains $k)) { $moved += $k; continue }
        if ((Get-ThornswoodSettingText $Before.$k) -ne (Get-ThornswoodSettingText $After.$k)) { $moved += $k }
    }
    return $moved
}

<#
  The join pass hold (#410) fails closed in the gamemode (#1319): false is the
  one way to turn it off, and anything that is neither true nor false holds.
  A server whose settings hold neither would change what it does the moment a
  new gamemode reached it, with nobody having asked, so Deploy-Server's carry
  refuses one until Deploy-Server.ps1 -RequirePass says which (#1223), and
  Install-ThornswoodServer.ps1 until Publish-Server.ps1 -RequirePass does
  (#1804). $Script is the one that says which, as the reason names it. Returns
  '' for true or false, otherwise the reason, which names the key and not its
  value.
#>
function Get-ThornswoodPassSwitchProblem($Settings, [string]$Script = '.\scripts\deploy\Deploy-Server.ps1') {
    $names = Get-ThornswoodSettingNames $Settings
    if ($names -contains 'thornswoodRequirePass' -and $Settings.thornswoodRequirePass -is [bool]) { return '' }
    $had = 'missing'
    if ($names -contains 'thornswoodRequirePass') { $had = 'neither true nor false' }
    return ('thornswoodRequirePass is ' + $had + ' on this server and this run did not say which, and the gamemode reads ' +
            'that as on (#1319). Say which with ' + $Script + ' -RequirePass on, or off.')
}

<#
  A LOAD ORDER THAT DROPS WHAT THE SERVER LOADS (#2320). On 5 Oct at 9:56 PM
  Publish-Server.ps1 -Channel dev sent a payload built from a fresh engine
  build (720a5f7c) whose server-settings.json still held the engine's own
  order, the five base masters, before Deploy-Gamemode.ps1 -Vortex had written
  the collection's into it. The installer took loadOrder from the release, as
  a release key, and checked only that every plugin it named was there, which
  five masters are. The dev server ran 48 plugins before and started on five:
  nine Riekling characters were set aside with "bad raceId", every NPC change
  from Populated Cities failed to parse, and the NPC runtime refused to start,
  until the 10:01 PM start had the order again.

  A plugin the running server loads and the new order does not is every form
  of it gone from the world, and every full plugin after it one index lower,
  which is the shape ServerOrder.ps1 already says out loud for the light
  order. So an install or a deploy that takes loadOrder over a running
  server's refuses one that leaves out any plugin the running order has,
  unless the person running it names each one that may go, in that run:
  Publish-Server.ps1, Deploy-Server.ps1 and Deploy-DevGamemode.ps1 -Dist all
  take -DropPlugins. Names are compared by file name, any case, whatever the
  folder in front. A plugin added, or the same plugins in another order, is
  not this check's.

  Returns Dropped (every plugin the running order has and the next does not),
  Unasked (those -DropPlugins did not name), Said (the lines to print) and
  Problem ('' when nothing unasked goes, otherwise the refusal). A running
  server with no loadOrder, or a next one with none, drops nothing here: the
  first has nothing to keep, and the second keeps the running one.
#>
function Get-ThornswoodPluginLeaf([string]$Path) {
    return @("$Path".Trim() -split '[\\/]')[-1]
}
function Test-ThornswoodLoadOrderDrop($Running, $Next, [string[]]$Allowed = @()) {
    $out = [pscustomobject]@{ Dropped = @(); Unasked = @(); Said = @(); Problem = '' }
    if ($null -eq $Running -or $null -eq $Next) { return $out }
    if ((Get-ThornswoodSettingNames $Running) -notcontains 'loadOrder' -or (Get-ThornswoodSettingNames $Next) -notcontains 'loadOrder') { return $out }
    $was = @(@($Running.loadOrder) | ForEach-Object { Get-ThornswoodPluginLeaf $_ } | Where-Object { $_ })
    $now = @{}
    foreach ($p in @($Next.loadOrder)) { $n = Get-ThornswoodPluginLeaf $p; if ($n) { $now[$n.ToLowerInvariant()] = $true } }
    $ok = @{}
    foreach ($a in @($Allowed)) { $n = Get-ThornswoodPluginLeaf $a; if ($n) { $ok[$n.ToLowerInvariant()] = $true } }
    $dropped = @()
    foreach ($n in $was) { if (-not $now.ContainsKey($n.ToLowerInvariant()) -and $dropped -notcontains $n) { $dropped += $n } }
    $unasked = @($dropped | Where-Object { -not $ok.ContainsKey($_.ToLowerInvariant()) })
    $said = @()
    $named = @($dropped | Where-Object { $ok.ContainsKey($_.ToLowerInvariant()) })
    if ($named.Count) { $said += ('the load order drops ' + $named.Count + ' plugin(s) this run named with -DropPlugins: ' + ($named -join ', ')) }
    $notDropped = @(@($Allowed) | ForEach-Object { Get-ThornswoodPluginLeaf $_ } | Where-Object { $_ -and $now.ContainsKey($_.ToLowerInvariant()) })
    if ($notDropped.Count) { $said += ('-DropPlugins named ' + ($notDropped -join ', ') + ', which the load order keeps, so nothing is dropped for it') }
    $problem = ''
    if ($unasked.Count) {
        $list = @($unasked | Select-Object -First 12) -join ', '
        if ($unasked.Count -gt 12) { $list += (', and ' + ($unasked.Count - 12) + ' more') }
        $problem = ('the load order this run would install has ' + @($Next.loadOrder).Count + ' plugins and leaves out ' + $unasked.Count +
                    ' of the ' + $was.Count + ' the running server loads: ' + $list + '. Every form of theirs would be gone from the world ' +
                    'and every full plugin after one would move up an index (#2320). Build the release with the server''s order ' +
                    '(Deploy-Gamemode.ps1 keeps it), or name each plugin that may go with -DropPlugins in this run.')
    }
    $out.Dropped = $dropped
    $out.Unasked = $unasked
    $out.Said = $said
    $out.Problem = $problem
    return $out
}

<#
  -DropPlugins as it crosses an ssh command line to Install-ThornswoodServer.ps1:
  plugin names have spaces in them, which do not survive that line the same
  way twice, so Publish-Server.ps1 sends them as base64 of the names one to a
  line, and the installer reads them back.
#>
function ConvertTo-ThornswoodNamesArg([string[]]$Names) {
    $t = (@($Names | Where-Object { $_ }) -join "`n")
    if (-not $t) { return '' }
    return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))
}
function ConvertFrom-ThornswoodNamesArg([string]$Arg) {
    if (-not $Arg) { return @() }
    return @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Arg)) -split "`n" | Where-Object { $_ })
}
# The line Deploy-Server puts in front of $settingsCarryBlock, so the box has
# $DropPlugins: the names as single quoted strings.
function Get-ThornswoodDropLine([string[]]$Names) {
    $q = @(@($Names) | Where-Object { $_ } | ForEach-Object { "'" + $_.Replace("'", "''") + "'" })
    return ('$DropPlugins = @(' + ($q -join ', ') + ')' + "`r`n")
}

<#
  What makes a settings file wrong to send at all, whatever it is carried
  into. Any channel: an npcSettings "default" key, which the engine reads as a
  plugin name and so refuses every NPC (#879). -Channel main: anything that is
  the dev server's (#1114, #1221): a port that is not 7777, the dev voice port
  7789, the name Thornswood Dev, thornswoodServer dev.
#>
function Get-ThornswoodServerSettingsProblems($Settings, [string]$Channel = '') {
    $why = @()
    $names = Get-ThornswoodSettingNames $Settings
    if ($names -contains 'npcSettings' -and $null -ne $Settings.npcSettings -and
        (Get-ThornswoodSettingNames $Settings.npcSettings) -contains 'default') {
        $why += 'an npcSettings "default" key, which refuses every NPC'
    }
    if ($Channel -eq 'main') {
        $port = 'none'
        if ($names -contains 'port') { $port = [string]$Settings.port }
        if ($port -ne '7777') { $why += ('port ' + $port + ', not 7777') }
        if ($names -contains 'thornswoodVoicePort' -and [string]$Settings.thornswoodVoicePort -eq '7789') { $why += 'the dev voice port 7789' }
        if ($names -contains 'name' -and [string]$Settings.name -eq 'Thornswood Dev') { $why += 'the name Thornswood Dev' }
        if ($names -contains 'thornswoodServer' -and [string]$Settings.thornswoodServer -eq 'dev') { $why += 'thornswoodServer dev' }
    }
    return $why
}

<#
  Deploy-Server.ps1's carry, run on the box against its stage, after the files
  are up and before the stage is checked. It takes $Root, $Stage and
  $ReleaseKeys from the lines SwapVars puts in front of it, $Asked (what this
  run asked for, #1223; absent is nothing) and $DropPlugins (#2320; absent
  is none) from the lines Deploy-Server puts after those, and this file's
  functions from the text in front of them all. An order that leaves out a
  plugin the server loads, not named in $DropPlugins, is CARRY REFUSED.
  Ends with CARRIED <sha256 of the settings it wrote> or CARRY REFUSED.
#>
$settingsCarryBlock = @'
$ProgressPreference = 'SilentlyContinue'
if (-not (Test-Path -LiteralPath variable:Asked)) { $Asked = $null }
$stageDir = Join-Path $Root $Stage
$sp = Join-Path $stageDir 'server-settings.json'
$run = $null
$rel = $null
$unread = @()
try { $run = [IO.File]::ReadAllText((Join-Path $Root 'server-settings.json')) | ConvertFrom-Json } catch { $unread += ('the settings the server runs on: ' + $_.Exception.Message) }
try { $rel = [IO.File]::ReadAllText($sp) | ConvertFrom-Json } catch { $unread += ('the settings sent: ' + $_.Exception.Message) }
if (-not $unread.Count -and $null -eq $run) { $unread += 'the settings the server runs on: the file is empty' }
if (-not $unread.Count -and $null -eq $rel) { $unread += 'the settings sent: the file is empty' }
if ($unread.Count) {
  'the settings the server runs on, or the ones sent, cannot be read, so nothing can be carried across'
  foreach ($u in $unread) { '  ' + $u }
  Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
  'the stage is cleared and the server was not touched'
  'CARRY REFUSED'
} else {
  $m = Join-ThornswoodServerSettings $run $rel $ReleaseKeys $Asked
  foreach ($l in $m.Said) { $l }
  if (-not (Test-Path -LiteralPath variable:DropPlugins)) { $DropPlugins = @() }
  $drop = Test-ThornswoodLoadOrderDrop $run $m.Settings $DropPlugins
  foreach ($l in $drop.Said) { $l }
  $passWhy = Get-ThornswoodPassSwitchProblem $m.Settings
  if ($drop.Problem) { $passWhy = $drop.Problem }
  if ($passWhy) {
    $passWhy
    Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
    'the stage is cleared and the server was not touched'
    'CARRY REFUSED'
  } else {
    [IO.File]::WriteAllText($sp, (ConvertTo-Json -InputObject $m.Settings -Depth 30), (New-Object Text.UTF8Encoding($false)))
    'CARRIED ' + (Get-FileHash -LiteralPath $sp -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
'@

<#
  Deploy-Server.ps1 -GamemodeOnly's settings (#1089), in place of the carry:
  the running server's own server-settings.json copied into the stage as it
  is, with no key taken from anywhere, because a gamemode-only deploy sends
  no settings and has no build to take any from. The swap reads it back with
  no key allowed to move (SwapVars with release keys @()).

  It holds the stage to the two things the run checked before it sent
  anything, read again here because a full deploy or a hand edit could have
  moved them since: the box's server-build.json is still the record the
  commit holds ($WantRecord, Get-ThornswoodRecordSum from ServerBuild.ps1),
  and the join pass switch is true or false (#1319), which this run cannot
  set. Takes $Root and $Stage from SwapVars, $WantRecord from the line
  Deploy-Server puts after it, this file's functions and the record sum from
  the text in front. Ends with CARRIED <sha256 of the copy> or CARRY REFUSED,
  the same last line as the carry, so Deploy-Server reads both one way.
#>
$settingsKeepBlock = @'
$ProgressPreference = 'SilentlyContinue'
$stageDir = Join-Path $Root $Stage
$sp = Join-Path $stageDir 'server-settings.json'
$why = @()
$rp = Join-Path $Root 'server-build.json'
$has = 'none'
if (Test-Path -LiteralPath $rp) { $has = Get-ThornswoodRecordSum ([IO.File]::ReadAllBytes($rp)) }
if ($has -ne $WantRecord) {
  $why += ('server-build.json on this server is not the record the commit holds any more (' + $has.Substring(0, [Math]::Min(12, $has.Length)) +
           ', the commit ' + $WantRecord.Substring(0, 12) + '), so the server build running here is not the one this gamemode was committed with')
}
$run = $null
$runWhy = ''
try { $run = [IO.File]::ReadAllText((Join-Path $Root 'server-settings.json')) | ConvertFrom-Json } catch { $runWhy = $_.Exception.Message }
if (-not $runWhy -and $null -eq $run) { $runWhy = 'the file is empty' }
if ($runWhy) { $why += ('the settings the server runs on cannot be read: ' + $runWhy) }
else {
  $passWhy = Get-ThornswoodPassSwitchProblem $run
  if ($passWhy) { $why += $passWhy }
}
if ($why.Count) {
  foreach ($w in $why) { $w }
  Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
  'the stage is cleared and the server was not touched'
  'CARRY REFUSED'
} else {
  Copy-Item -LiteralPath (Join-Path $Root 'server-settings.json') -Destination $sp -Force
  'the server keeps its own settings as they are: a gamemode-only deploy changes none of them'
  'CARRIED ' + (Get-FileHash -LiteralPath $sp -Algorithm SHA256).Hash.ToLowerInvariant()
}
'@

<#
  Deploy-Server.ps1 -FromStore's settings (#459), in place of the carry: the
  running server's own server-settings.json copied into the stage unchanged,
  as for -GamemodeOnly. A server build out of the store moves the engine and
  the gamemode, and the server keeps its load order, start point and every
  switch, so no key may move at the swap (SwapVars with release keys @()).

  It holds the stage to what the run read before it sent anything: the box's
  server-build.json is still the record it read then ($WasRecord, its sum), so
  a deploy that ran in between is not undone unseen, and the join pass switch
  is true or false (#1319), which this run cannot set. Takes $Root and $Stage
  from SwapVars, $WasRecord from the line Deploy-Server puts after it, this
  file's functions and the record sum from the text in front. Ends with
  CARRIED <sha256 of the copy> or CARRY REFUSED, the same last line as the
  carry.
#>
$settingsStoreBlock = @'
$ProgressPreference = 'SilentlyContinue'
$stageDir = Join-Path $Root $Stage
$sp = Join-Path $stageDir 'server-settings.json'
$why = @()
$rp = Join-Path $Root 'server-build.json'
$has = 'none'
if (Test-Path -LiteralPath $rp) { $has = Get-ThornswoodRecordSum ([IO.File]::ReadAllBytes($rp)) }
if ($has -ne $WasRecord) {
  $why += ('server-build.json on this server changed since this run read it (' + $has.Substring(0, [Math]::Min(12, $has.Length)) + ', read as ' +
           $WasRecord.Substring(0, [Math]::Min(12, $WasRecord.Length)) + '), so another deploy ran in between; run this again to deploy over what is there now')
}
$run = $null
$runWhy = ''
try { $run = [IO.File]::ReadAllText((Join-Path $Root 'server-settings.json')) | ConvertFrom-Json } catch { $runWhy = $_.Exception.Message }
if (-not $runWhy -and $null -eq $run) { $runWhy = 'the file is empty' }
if ($runWhy) { $why += ('the settings the server runs on cannot be read: ' + $runWhy) }
else {
  $passWhy = Get-ThornswoodPassSwitchProblem $run
  if ($passWhy) { $why += $passWhy }
}
if ($why.Count) {
  foreach ($w in $why) { $w }
  Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
  'the stage is cleared and the server was not touched'
  'CARRY REFUSED'
} else {
  Copy-Item -LiteralPath (Join-Path $Root 'server-settings.json') -Destination $sp -Force
  $orderWhy = ''
  if ((Test-Path -LiteralPath variable:OrderWire) -and $OrderWire) {
    # -FromRecord (#4069): the recorded order over the server's, and the
    # start point to Skyrim Unbound.esp's place in it. Nothing else moves,
    # and the swap reads every other key back as the server had it.
    $names = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($OrderWire)) -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $far = ($Root -replace '\\', '/') + '/plugins/'
    $newOrder = @($names | ForEach-Object { $far + $_ })
    'the load order moves from ' + @($run.loadOrder).Count + ' plugins to ' + $newOrder.Count
    $isLight = $null
    if ($LoadsLight) {
      $lightOf = @{}
      foreach ($leaf in $names) {
        $f = Join-Path (Join-Path $stageDir 'plugins') $leaf
        if (-not (Test-Path -LiteralPath $f)) { $f = Join-Path (Join-Path $Root 'plugins') $leaf }
        if ($leaf -ieq 'Thornswood-Last.esp' -and -not (Test-Path -LiteralPath $f)) { $lightOf[$leaf.ToLowerInvariant()] = $false; continue }
        try { $lightOf[$leaf.ToLowerInvariant()] = Test-ThornswoodPluginLight $f } catch { $orderWhy = ('whether ' + $leaf + ' is light cannot be read (' + $_.Exception.Message + '), so where new characters start in the new order is not known') }
      }
      $isLight = { param($n) [bool]$lightOf[$n.ToLowerInvariant()] }.GetNewClosure()
    }
    $s = $run
    $pt = @($s.startPoints)[0]
    $unb = Get-ThornswoodFullIndex ([string[]]$newOrder) $isLight 'Skyrim Unbound.esp'
    if (-not $orderWhy -and $pt -and $unb -ge 0) {
      $raw = ([string]$pt.worldOrCell).Trim()
      $startWas = -1
      if ($raw -match '^0[xX][0-9a-fA-F]+$') { $startWas = [Convert]::ToInt64($raw.Substring(2), 16) } elseif ($raw -match '^[0-9]+$') { $startWas = [int64]$raw }
      if ($startWas -lt 0) { $orderWhy = ('the start point ' + $raw + ' does not read as a form id') }
      else {
        $startWant = ($unb * 0x01000000) + ($startWas -band 0x00FFFFFF)
        if ($startWant -ne $startWas) {
          $pt.worldOrCell = ('0x{0:X8}' -f $startWant)
          $s | Add-Member -NotePropertyName startPoints -NotePropertyValue @(@($pt) + @(@($s.startPoints) | Select-Object -Skip 1)) -Force
          'the start point moves from 0x{0:X8} to 0x{1:X8}: Skyrim Unbound.esp is full plugin {2} in the new order' -f $startWas, $startWant, $unb
        } else { 'the start point stays 0x{0:X8}: Skyrim Unbound.esp keeps its place' -f $startWas }
      }
    } elseif (-not $orderWhy -and $unb -lt 0) { 'Skyrim Unbound.esp is not a full plugin of the new order, so the start point stays as it is' }
    if (-not $orderWhy) {
      $s | Add-Member -NotePropertyName loadOrder -NotePropertyValue $newOrder -Force
      [IO.File]::WriteAllText($sp, (ConvertTo-Json -InputObject $s -Depth 30), (New-Object Text.UTF8Encoding($false)))
    }
  } else {
    'the server keeps its own settings as they are: a server build out of the store changes none of them'
  }
  if ($orderWhy) {
    $orderWhy
    Remove-Item -LiteralPath $stageDir -Recurse -Force -EA SilentlyContinue
    'the stage is cleared and the server was not touched'
    'CARRY REFUSED'
  } else {
    'CARRIED ' + (Get-FileHash -LiteralPath $sp -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
'@
