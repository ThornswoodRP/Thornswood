<#
  NpcReset.ps1

  The box half of Reset-Npcs.ps1 (#4595): which saved change forms are NPCs,
  and moving those aside so each NPC starts again from its plugin record.
  Dot-sourced by Reset-Npcs.ps1, which sends $ThornswoodNpcReset to the box
  with the step that stops and starts the server, and by
  tests\test-4595-npc-reset.ps1, which runs it over stand-in server folders.
  It does nothing on its own. Keep it ASCII. It runs on the box, in
  PowerShell 7.

  WHY. The engine fork's #98 gives an NPC only the gear it fights and looks
  with, marked as its own (npcEquipment), and never its plugin's death list.
  It does that when the NPC's inventory is first made from its record
  (MpObjectReference::EnsureBaseContainerAdded). An NPC saved by an engine
  before #98 already has that inventory, unmarked, with the vanilla coin and
  pockets in it, and the engine keeps a saved inventory through every death
  and respawn. So those NPCs go on paying vanilla loot until their saved
  change form is gone. Wipe-Saves.ps1 would do that too, but it also starts
  every character over and sets aside every private register. This takes
  only the NPCs.

  WHAT IS AN NPC HERE. Each file in <world>\changeForms is one saved
  reference, named for its formDesc (FileDatabase.cpp: ToString('_') plus
  .json). One is moved aside only when all of these hold:
    - it reads as JSON, and its file name is its own formDesc's;
    - recType is 1, an actor (MpChangeForms.h: 0 is any other reference:
      a chest, a door, a dropped item, a board, a piece of furniture);
    - profileId is below 0. A character carries its profile's id, 0 or
      above, and is never moved.
  Everything else stays as it is, including a file that does not read or
  does not say what it is: what cannot be told apart is kept and named.
  There are no followers or horses to keep: Thornswood-Last.esp stops the
  follower and stables quests (Patrick, 12 Oct 2026, #2468), and nothing in
  the gamemode hands either out.

  The NPCs moved are said by kind, so a survey says what a run will take:
    placed      an NPC a plugin places (its formDesc names the plugin); it
                comes back from its record at the next start;
    patrol      a Thalmor patrol member (thornswoodNpcPatrol); the patrol
                keeper stands its slot up again at the next start;
    staff-run   a creature staff spawned for one run (thornswoodNpcCommanded
                run); the gamemode removes these at every start anyway;
    staff-kept  a creature staff spawned with the word keep. Nothing makes
                it again, so each one is named with its record and place,
                for staff to spawn it again with keep if they still want it;
    runtime     any other actor made by the server with no profile.

  WHAT IT MEASURES AS WELL.
    - What the NPCs carry, in three counts: every item marked with #98's
      mark (npcEquipment), at least one item without it, and nothing at
      all. #98 puts only weapons, armour, ammunition, scrolls and carried
      lights into a new NPC, so a record with none of them (most animals
      and many creatures) starts with nothing, and there is nothing to
      mark (EnsureBaseContainerAdded). Before the reset on a server running
      #98, the NPCs with an unmarked item are what this is for; after it,
      an NPC saved again is marked or carries nothing.
    - Kill contracts. A character's quest record (thornswoodQuests) keeps
      killHistory, the highest life of each NPC it was credited for, and a
      kill of that NPC at a life no higher is refused as a duplicate. An NPC
      moved aside starts again at life 0 (_skympNpcLifeGeneration is on its
      change form), so the count of characters holding history for an NPC
      being moved is said, with the NPCs.

  THE SAVE JOURNAL. The engine writes each save batch to
  changeForms\.pending-batch, then writes its files, then deletes it; a
  server ended part way through leaves it, and the next start writes the
  batch again (FileDatabase::Recover). Left in place it would write the NPCs
  in it straight back. So the journal is read the way Recover reads it: the
  checksum is the SHA-256 of the batch exactly as it is in the file, a
  journal that does not match stops the reset with nothing moved, and a
  matching one has each entry that is not an NPC written to its file, as
  the start would have, and is then moved aside with the NPCs.

  WHERE IT GOES. Into changeForms\_discarded-<yyyyMMdd-HHmmss>, the folder a
  character reset uses. The engine reads only the .json files directly in
  changeForms, so nothing in that folder is loaded, and the game server's
  server-log.js deletes it 30 days after its stamp (#3620). Moving them
  back undoes the reset.

  Lines it prints, besides plain ones:
    NPCRESET|<moved>|<characters kept>|<other references kept>|<not read>
    NPCKINDS|placed=<n>|patrol=<n>|staff-run=<n>|staff-kept=<n>|runtime=<n>
    NPCMARKS|<every item marked>|<an item without the mark>|<carrying nothing>
    KILLHISTORY|<characters>|<npcs>
    STAFFKEPT|<formDesc>|<baseDesc>|<world or cell>|<x,y,z>
    NOTREAD|<file>|<why>
    STOP|<why>                      nothing was moved

  THE SERVER BUILD. Test-ThornswoodServerBuild reads the server-build.json
  a deploy puts in the server's folder (Deploy-Server.ps1, Publish-Server)
  and says whether it is the build records\server-build.json holds on main:
    SERVERBUILD|<same, differs or unknown>|<the box's fork commit>|<its sha256>|<main's fork commit>|<main's sha256>
  Reset-Npcs.ps1 moves nothing unless it says same, since an NPC made again
  by a server without #98 is unmarked again.
#>
$ThornswoodNpcReset = @'
# ---- the NPC reset (scripts\ops\NpcReset.ps1, #4595) ----
function Test-ThornswoodWhole($v) {
  return ($v -is [int] -or $v -is [long] -or $v -is [decimal] -or ($v -is [double] -and $v -eq [math]::Floor($v)))
}
function Get-ThornswoodField($o, [string]$Name) {
  if ($null -eq $o -or -not ($o -is [System.Management.Automation.PSCustomObject])) { return $null }
  $p = $o.PSObject.Properties[$Name]
  if ($p) { return $p.Value }
  return $null
}
# What one saved change form is: @{ kind; npc; why; desc; ... }. $File is
# its name in changeForms, which must be its own formDesc's.
function Get-ThornswoodFormKind($o, [string]$File) {
  $r = @{ kind = ''; npc = $false; why = ''; desc = ''; gear = 'empty'; life = $null }
  if (-not ($o -is [System.Management.Automation.PSCustomObject])) { $r.kind = 'unread'; $r.why = 'it is not a JSON object'; return $r }
  $desc = Get-ThornswoodField $o 'formDesc'
  if (-not ($desc -is [string]) -or $desc -notmatch '^[0-9a-f]{1,8}(:[^:\\/]+)?$') { $r.kind = 'unread'; $r.why = 'its formDesc is not one'; return $r }
  if ((($desc -replace ':', '_') + '.json') -ne $File) { $r.kind = 'unread'; $r.why = 'its file name is not its formDesc ' + $desc; return $r }
  $r.desc = $desc
  $rec = Get-ThornswoodField $o 'recType'
  if (-not (Test-ThornswoodWhole $rec)) { $r.kind = 'unread'; $r.why = 'recType is not a number'; return $r }
  if ($rec -ne 1) { $r.kind = 'object'; return $r }
  $prof = Get-ThornswoodField $o 'profileId'
  if (-not (Test-ThornswoodWhole $prof)) { $r.kind = 'unread'; $r.why = 'profileId is not a number'; return $r }
  if ($prof -ge 0) { $r.kind = 'character'; return $r }
  $r.npc = $true
  $df = Get-ThornswoodField $o 'dynamicFields'
  $cmd = Get-ThornswoodField $df 'thornswoodNpcCommanded'
  if ($desc.Contains(':')) { $r.kind = 'placed' }
  elseif ($null -ne (Get-ThornswoodField $df 'thornswoodNpcPatrol')) { $r.kind = 'patrol' }
  elseif ($null -ne $cmd -and (Get-ThornswoodField $cmd 'keep') -eq $true) { $r.kind = 'staff-kept' }
  elseif ($null -ne $cmd) { $r.kind = 'staff-run' }
  else { $r.kind = 'runtime' }
  $inv = Get-ThornswoodField $o 'inv'
  foreach ($e in @(Get-ThornswoodField $inv 'entries')) {
    if ($null -eq $e) { continue }
    if ((Get-ThornswoodField $e 'npcEquipment') -eq $true) { if ($r.gear -eq 'empty') { $r.gear = 'marked' } }
    else { $r.gear = 'unmarked'; break }
  }
  $r.life = Get-ThornswoodField $df '_skympNpcLifeGeneration'
  return $r
}
# Whether the server in $Root is the build main's record names (#98 and
# later): one SERVERBUILD line, said the same way whether it reads or not.
function Test-ThornswoodServerBuild([string]$Root, [string]$WantCommit, [string]$WantSha) {
  $path = Join-Path $Root 'server-build.json'
  $rec = $null; $why = ''
  if (-not (Test-Path -LiteralPath $path)) { $why = 'none there' }
  else { try { $rec = Read-ThornswoodJson $path } catch { $why = 'it will not read' } }
  $commit = [string](Get-ThornswoodField (Get-ThornswoodField $rec 'source') 'commit')
  $sha = [string](Get-ThornswoodField $rec 'sha256')
  if (-not $why -and (-not $commit -or -not $sha)) { $why = 'it names no commit or sha256' }
  $state = if ($why) { 'unknown' } elseif ($sha -eq $WantSha -and $commit -eq $WantCommit) { 'same' } else { 'differs' }
  if ($why) { $commit = $why; $sha = '' }
  return ('SERVERBUILD|' + $state + '|' + $commit + '|' + $sha + '|' + $WantCommit + '|' + $WantSha)
}
function Read-ThornswoodJson([string]$Path) {
  return ([IO.File]::ReadAllText($Path) -replace '^\uFEFF', '' | ConvertFrom-Json)
}
# The journal FileDatabase.cpp leaves when a server is ended part way through
# a save: { ok; entries = @(@{ file; json }); why }. Its text is
# {"batch":<batch>,"checksum":"<sha256 of <batch>>","version":1}, nlohmann's
# dump with its keys in order, so the batch is checked byte for byte.
function Read-ThornswoodSaveJournal([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  $text = [Text.Encoding]::UTF8.GetString($bytes)
  $head = '{"batch":'
  $m = [regex]::Match($text, ',"checksum":"([0-9a-f]{64})","version":1\}$')
  if (-not $text.StartsWith($head) -or -not $m.Success) { return @{ ok = $false; why = 'it is not a save journal of the shape the engine writes' } }
  $tail = [Text.Encoding]::UTF8.GetByteCount($m.Value)
  $count = $bytes.Length - $head.Length - $tail
  if ($count -le 2) { return @{ ok = $false; why = 'its batch is empty' } }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash($bytes, $head.Length, $count) } finally { $sha.Dispose() }
  $hex = -join ($hash | ForEach-Object { $_.ToString('x2') })
  if ($hex -ne $m.Groups[1].Value) { return @{ ok = $false; why = 'its checksum does not match its batch, so the engine would refuse it too' } }
  $batch = $null
  try { $batch = [Text.Encoding]::UTF8.GetString($bytes, $head.Length, $count) | ConvertFrom-Json } catch { return @{ ok = $false; why = 'its batch does not read: ' + $_.Exception.Message } }
  $entries = @()
  foreach ($e in @($batch)) {
    $f = Get-ThornswoodField $e 'file'
    $j = Get-ThornswoodField $e 'json'
    if (-not ($f -is [string]) -or $f -notmatch '^[0-9a-f]{1,8}(_[^:\\/*?"<>|]+)?\.json$' -or -not ($j -is [string])) {
      return @{ ok = $false; why = 'an entry names no file of its own' }
    }
    $entries += @{ file = $f; json = $j }
  }
  return @{ ok = $true; entries = $entries }
}
# Surveys, or with -Move resets, the NPCs of the server in $Root, and says
# so in the lines the header lists. A STOP or FAILED line is a failure.
function Invoke-ThornswoodNpcReset([string]$Root, [string]$Stamp, [switch]$Move) {
  $settings = Join-Path $Root 'server-settings.json'
  $db = 'world'
  if (Test-Path -LiteralPath $settings) {
    try { $cfg = Read-ThornswoodJson $settings } catch { 'STOP|' + $settings + ' will not read, so where the world is saved is not known: ' + $_.Exception.Message; return }
    $name = Get-ThornswoodField $cfg 'databaseName'
    if ($name) { $db = [string]$name }
  }
  $forms = Join-Path (Join-Path $Root $db) 'changeForms'
  if (-not (Test-Path -LiteralPath $forms -PathType Container)) { 'NPCRESET|0|0|0|0'; 'nothing is saved at ' + $forms + ' yet, so there is nothing to reset'; return }
  $aside = Join-Path $forms ('_discarded-' + $Stamp)
  if (Test-Path -LiteralPath $aside) { 'STOP|' + $aside + ' is there already. Nothing was moved.'; return }

  # The journal first: what it holds is newer than the files.
  $journal = Join-Path $forms '.pending-batch'
  $newer = @{}
  if (Test-Path -LiteralPath $journal) {
    $j = Read-ThornswoodSaveJournal $journal
    if (-not $j.ok) { 'STOP|' + $journal + ': ' + $j.why + '. Nothing was moved.'; return }
    foreach ($e in $j.entries) {
      $o = $null
      try { $o = $e.json | ConvertFrom-Json } catch { 'STOP|' + $journal + ': its entry for ' + $e.file + ' does not read. Nothing was moved.'; return }
      $k = Get-ThornswoodFormKind $o $e.file
      if ($k.kind -eq 'unread') { 'STOP|' + $journal + ': its entry for ' + $e.file + ' cannot be told apart (' + $k.why + '). Nothing was moved.'; return }
      $newer[$e.file] = @{ json = $e.json; kind = $k }
    }
    'an unfinished save batch of ' + $j.entries.Count + ' form(s) is there; ' + @($newer.Values | Where-Object { $_.kind.npc }).Count + ' of them NPCs'
  }

  $moves = @()
  $kinds = [ordered]@{ 'placed' = 0; 'patrol' = 0; 'staff-run' = 0; 'staff-kept' = 0; 'runtime' = 0 }
  $chars = 0; $objects = 0; $unread = 0; $gear = @{ 'marked' = 0; 'unmarked' = 0; 'empty' = 0 }
  $npcDescs = @{}
  $histories = @()
  $staffKept = @()
  $names = @{}
  foreach ($f in @(Get-ChildItem -LiteralPath $forms -Filter *.json -File)) { $names[$f.Name] = $true }
  foreach ($n in $newer.Keys) { $names[$n] = $true }
  foreach ($n in @($names.Keys | Sort-Object)) {
    $o = $null; $k = $null
    if ($newer.ContainsKey($n)) { $k = $newer[$n].kind; $o = $newer[$n].json | ConvertFrom-Json }
    else {
      try { $o = Read-ThornswoodJson (Join-Path $forms $n) } catch { $unread++; 'NOTREAD|' + $n + '|' + ($_.Exception.Message -replace '[|\r\n]', ' '); continue }
      $k = Get-ThornswoodFormKind $o $n
    }
    if ($k.kind -eq 'unread') { $unread++; 'NOTREAD|' + $n + '|' + $k.why; continue }
    if ($k.kind -eq 'object') { $objects++; continue }
    if ($k.kind -eq 'character') {
      $chars++
      $q = Get-ThornswoodField (Get-ThornswoodField $o 'dynamicFields') 'thornswoodQuests'
      $h = Get-ThornswoodField $q 'killHistory'
      if ($h -is [System.Management.Automation.PSCustomObject]) { $histories += ,@($h.PSObject.Properties | ForEach-Object { $_.Name }) }
      continue
    }
    $kinds[$k.kind]++
    $gear[$k.gear]++
    $npcDescs[$k.desc] = $true
    if ($k.kind -eq 'staff-kept') {
      $pos = @(Get-ThornswoodField $o 'position' | ForEach-Object { [math]::Round([double]$_) }) -join ','
      $staffKept += ('STAFFKEPT|' + $k.desc + '|' + (Get-ThornswoodField $o 'baseDesc') + '|' + (Get-ThornswoodField $o 'worldOrCellDesc') + '|' + $pos)
    }
    $moves += $n
  }
  $heldBy = 0; $heldFor = @{}
  foreach ($h in $histories) {
    $hit = @($h | Where-Object { $npcDescs.ContainsKey($_) })
    if ($hit.Count) { $heldBy++; foreach ($d in $hit) { $heldFor[$d] = $true } }
  }

  $done = 0; $failed = 0
  if ($Move) {
    $null = New-Item -ItemType Directory -Path $aside -Force
    # What the start would have written from the journal, NPCs left out.
    foreach ($n in $newer.Keys) {
      if ($newer[$n].kind.npc) { continue }
      try { [IO.File]::WriteAllText((Join-Path $forms $n), $newer[$n].json, (New-Object Text.UTF8Encoding($false))) }
      catch { 'STOP|' + $n + ' from the save journal could not be written: ' + $_.Exception.Message + '. Nothing was moved.'; return }
    }
    foreach ($n in $moves) {
      $from = Join-Path $forms $n
      if (-not (Test-Path -LiteralPath $from)) { $done++; continue }   # only in the journal
      try { [IO.File]::Move($from, (Join-Path $aside $n)); $done++ }
      catch { $failed++; 'FAILED|' + $n + '|' + ($_.Exception.Message -replace '[|\r\n]', ' ') }
    }
    if ($newer.Count -and -not $failed) {
      try { [IO.File]::Move($journal, (Join-Path $aside '.pending-batch')) }
      catch { $failed++; 'FAILED|.pending-batch|' + ($_.Exception.Message -replace '[|\r\n]', ' ') }
    }
  }

  'NPCRESET|' + $(if ($Move) { $done } else { $moves.Count }) + '|' + $chars + '|' + $objects + '|' + $unread
  'NPCKINDS|' + (($kinds.Keys | ForEach-Object { $_ + '=' + $kinds[$_] }) -join '|')
  'NPCMARKS|' + $gear['marked'] + '|' + $gear['unmarked'] + '|' + $gear['empty']
  'KILLHISTORY|' + $heldBy + '|' + $heldFor.Count
  $staffKept
  if ($Move) {
    if ($failed) { "$failed NPC file(s) could not be moved and are still loaded; the ones moved are at $aside"; return }
    elseif ($done) { "moved $done NPC change form(s) to $aside" } else { 'no NPC was saved, so nothing was moved' }
  }
}
'@
