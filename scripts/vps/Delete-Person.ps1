<#
  Delete-Person.ps1

  Carries out a deletion request (issue #2351). Finds one person's records in
  every store on the box by their Discord id, shows how many there are, and
  when told to, removes them from every copy nothing runs from and asks each
  service that holds some to take the rest out of its own files as it next
  starts, stopping nothing (#2758). Writes the request down so that a restore
  reapplies it. Runs ON the VPS, as Administrator, sent there by Remote.ps1:

      .\scripts\vps\Remote.ps1 -File .\scripts\vps\Delete-Person.ps1 -Arguments '-DiscordId 123456789012345678'
      .\scripts\vps\Remote.ps1 -File .\scripts\vps\Delete-Person.ps1 -Arguments '-DiscordId 123456789012345678 -Delete -By Patrick'
      .\scripts\vps\Remote.ps1 -File .\scripts\vps\Delete-Person.ps1 -Arguments '-Reapply'
      .\scripts\vps\Remote.ps1 -File .\scripts\vps\Delete-Person.ps1 -Arguments '-Reapply -Delete'

  From a cloud session, or any machine with no key to the box, the deploy
  gate's Delete-Person verb runs it on the box the same way (#2862), and
  what it prints comes back sealed to the session that asked:

      pwsh scripts/vps/Box-Run.ps1 -Line 'Delete-Person -DiscordId 123456789012345678'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Delete-Person -DiscordId 123456789012345678 -Delete -By Patrick'
      pwsh scripts/vps/Box-Run.ps1 -Line 'Delete-Person -Reapply'

  WHY. site\data\site\privacy.md promises that somebody who asks in the
  Discord has their Discord link, session records, chat and character
  deleted, by a person, and that staff reapply completed requests before an
  older backup goes back into service. Until this there was no list of where a
  person's records are, no way to remove them but by hand, and no record of
  what had been done. Patrick decided on 12 October 2026 (option A on #2351): a
  staff script that finds, shows counts, deletes with a dry run first, and
  records each request so a restore reapplies it. "Deletion requests" in
  the ops repo's WEBSITE-OPERATIONS.md is the procedure around it.

  A DRY RUN IS THE DEFAULT. Without -Delete nothing is changed or written.
  It prints, for every store, how many of the person's records are there and
  whether a real run removes them or leaves them, and which services still
  have a request for them that they take at their next start ("waiting"), so
  it is also how staff see when a request is done. Counts only, never what a
  record says and never an address.

  WHO. Their Discord id, and their characters: the profile ids linked.json
  holds for them, which the site checked were theirs when they played, and on
  a reapply also the ids the record wrote down. A profile id that another
  account also holds is not theirs to delete and is left, and said.

  WHAT A REAL RUN REMOVES, the person's own records, in every copy on the box
  (the live folder and the copies a restore, a wipe, an install or a character
  reset sets aside beside it). The copies go at once. The live folders are
  each service's own, and it takes them at its next start (below):
    site            their Discord link (linked.json), their answer to the
                    rules (rules-accepted.json), their sign-in rows
                    (signins.json, which hold an address), their session rows
                    (sessions.json) with the launcher logs sent with them
                    (session-logs) and the failed-session alerts about them
                    (for-bot\trouble.json), their characters' rows in
                    roster.json, the tickets, applications and calls for help
                    they sent (for-bot\inbox.json), and their gallery
                    pictures, waiting or approved, with the file
    game servers    each character's change form (world\changeForms, and the
                    world-before-* and _discarded-* copies), its card
                    (private\characters.json and the characters-before-*
                    copies), its mod menu choices (private\mod-settings.json),
                    its take counts (private\take-limit.json) and when it last
                    left (private\last-left.json, and data\last-left.json in a
                    folder set aside before #2582 moved it), live and dev
    voice           every chat line their characters wrote, out of each day's
                    file, live and dev, except the lines said inside a
                    session staff marked kept (#2166), which stay with it.
                    The voice service itself never edits a day
                    (voice\voice-server.js); server-log.js does, before
                    voice starts, and the record keeps each day's line count
                    when the request was made
    the bot         their join number (joins.json; the last number given out
                    stays, so nobody is handed theirs again), and in the
                    joins.json-before-restore-<stamp> copies a restore set
                    aside beside it, and their open ticket (open-tickets.json).
                    Their ticket threads in the
                    Discord and the bot's lines about them in the staff
                    ticket log stay until their 365 days are up (Patrick's B
                    on #3634: the record of what they were told), which the
                    privacy page says

  WHAT IT LEAVES, counted and said:
    - staff's records about them: bans, PKs and notes (bans.json, pk.json,
      notes.json), the staff logs' lines naming them (moderation.log on the
      site and on each game server, the game server's door.log), reports they
      made and reports made about them (inbox.json, gallery-reports.json), and
      a session staff marked kept, with its launcher logs, alerts, the copy
      of its chat and the chat lines in the day files inside its window. The
      privacy page: "What cannot be undone is something you said that
      somebody else has already quoted in a report, because that now belongs
      to the report." Each of these still goes when its keeping time on the
      privacy page is up, by the code that writes it (#2353).
    - the game's registers that it does not let go (below): the old copies a
      game server kept in data: counted, never changed.
    - a gallery picture with an open report against it, or taken down after
      one and still held, which is staff's while they look into it (#2352);
      and one approved before the site kept the sending account in its
      uploads note (16 Oct 2026, #2351), which nothing ties to them, so staff
      remove theirs in the hub by name.
    - logs, which age by their own rule (server.log 30 days, #2349; the
      site's, the gamemode's, voice's and the bot's 90 days, #2166), and the
      encrypted backups, which expire on their schedule and are why the
      record exists.

  WHAT THE GAME SERVER LETS GO AT ITS NEXT START (Patrick, 16 October, option
  A on #2351: "Delete-Person.ps1 writes a list, and the gamemode releases
  those entries at its next start"). The game's registers in a server's
  private folder name a character: a house and its master key in
  property.json, with the notice boards' posts and the drop box and its
  record; a farm in farm-claims.json; an office in law.json; a bed's guests
  and takings in beds.json; the embassy and remnant rolls in embassy.json; a
  dungeon chest's reservation in dungeon-rewards-ledger.json; a faction or
  business book's members, chat and owner in books.json; a line or a hand
  out on the trade ships' manifest in trade-cargo.json (#511); a market
  stall they keep, and what is laid out on it, in market-stalls.json
  (#3160); a line, a hand out or a journey on the trade carts' manifest in
  trade-carts.json (#3158); a guild
  trader's supply waits, commission promises and a trade waiting on them in
  merchant-ledger.json (#2652). This script never
  edits those: what happens to a house or a post held by somebody who is gone
  is each register's own rule, and that rule is in the gamemode. So it counts
  them ("release" in what it prints) and, for every server that holds
  something of theirs, writes private\deleted-characters.json beside them:
  their profile ids and the runtime form ids (#2870) of the characters it
  found there. The
  game server's release block reads it at its start, lets go of every entry
  through the register's own code, logs counts only and deletes the list. A
  faction or business book they own is disbanded then, so the procedure says
  to have staff hand it on in the game first when the group wants to keep it.

  A REAL RUN STOPS NOTHING (#2758). Patrick, 18 Oct 2026, after the first
  real run, on his own account: "it should not restart everytime we want to
  delete a person it should just fully apply the rest upon a server restart".
  The site, a game server, a voice service and the bot each write their files
  while they run, so a file changed underneath one would be written straight
  back over. So this never changes a live service's files. It writes the
  request into the folder of each service that holds something of theirs,
  merged into one still waiting there, and the service takes it out of its own
  files as it next starts, before anything of theirs is open:
    site           data\deletion-requests.json, taken by site\server.js
                   before it listens
    a game server  private\deleted-characters.json: server-log.js, which its
                   task starts it under, deletes their change forms and takes
                   them out of the card, mod menu, take count and last-left
                   files before the engine starts (scripts\vps\Server-Log.js);
                   then the gamemode lets go of the registers (above)
    voice          deletion-requests.json in its folder, with the windows of
                   the sessions staff kept: server-log.js, before voice starts
    the bot        deletion-requests.json in its data folder, taken by
                   bot\bot.py before it connects
  Each says it in its own log with counts, and deletes the request once every
  part took; a part that did not take waits for the next start. Nothing
  restarts on a schedule: a service starts again at a deploy or an install of
  its own, after a crash and after a reboot, which in October 2026 was about
  a day for the game servers and the site and up to a week for voice and the
  bot (#2758 has the count). Until it does, its copy still holds the records;
  the procedure (the ops repo's WEBSITE-OPERATIONS.md) says when the person is told.
  A copy set aside with an unfinished save (.pending-batch in changeForms)
  is refused: the engine would replay it if that copy were put back, and
  could write a deleted character back. Every file is read and checked
  before any is written, and each JSON file is written to a file beside it
  and swapped in, the way the site writes its own.

  THE RECORD. Each request is one line in
  C:\Thornswood-Deletions\requests.jsonl, written when it is made: the
  Discord id, the profile ids, when, who ran it, the counts it removes and
  the services it asked. Nothing else about the person.
  The folder is SYSTEM's and Administrators' only, locked when this makes it,
  with read for the nightly backup's task (-BackupTask). The nightly backup
  takes it (deletions\requests.jsonl), so it leaves the box with every
  backup. Until #2833 the lock gave the backup no read, and the night
  after the first deletion the backup could not read the record.

  -Reapply reads that record and asks for every request in it again, the same
  way: after a backup is put back and before anything starts, so each service
  takes them at the start that puts it back in service (Restore-Box.ps1 runs
  it, and RESTORING.md in the ops repo says when by hand). -Merge names other copies of
  the record (the one in the backup being put back, or one from a newer
  backup); lines the box's record does not have are added to it first.
  -Reapply never adds a line of its own.

  WHAT IT REFUSES, with nothing changed:
    - anywhere that is not the box: a Windows workstation, which a gaming PC
      is, or a machine Windows will not say is a server (BoxGuard.ps1)
    - a Discord id that is not 17 to 20 digits
    - -Delete without -By, the person running it
    - a JSON file, or a line of the record, that is there and will not parse
    - no node on the PATH (the JSON is edited by node, as the site writes it)

  tests\test-2351-delete-person.ps1 runs it against stand-ins of every store.

.PARAMETER DiscordId
  The Discord id of the person who asked, 17 to 20 digits.
.PARAMETER Delete
  Change things. Without it this is a dry run that changes nothing.
.PARAMETER By
  Who is running the request, written into the record. Required with -Delete.
.PARAMETER Reapply
  Remove every request in the record again, after a restore.
.PARAMETER Merge
  With -Reapply: other copies of the record to add to the box's first.
.PARAMETER SiteRoot
  The site's folder.
.PARAMETER GameRoot
  The live game server's folder.
.PARAMETER DevGameRoot
  The dev game server's folder.
.PARAMETER VoiceRoot
  The live voice service's folder.
.PARAMETER DevVoiceRoot
  The dev voice service's folder.
.PARAMETER BotRoot
  The bot's folder.
.PARAMETER RecordRoot
  Where the record of completed requests is kept.
.PARAMETER BackupTask
  The nightly backup's scheduled task (Install-Backup.ps1 -TaskName), whose
  own SID is given read on the record's folder. Nothing is given when no
  task of that name is registered; Install-Backup.ps1 gives it read then.
.PARAMETER AllowGamingPc
  Run on a machine that is not the box, a developer's workstation. Only the
  tests pass it.
#>
[CmdletBinding()]
param(
    [string]$DiscordId = '',
    [switch]$Delete,
    [string]$By = '',
    [switch]$Reapply,
    [string[]]$Merge = @(),
    [string]$SiteRoot     = 'C:\Thornswood-Docs',
    [string]$GameRoot     = 'C:\Thornswood-Server',
    [string]$DevGameRoot  = 'C:\Thornswood-Server-Dev',
    [string]$VoiceRoot    = 'C:\Thornswood-Voice',
    [string]$DevVoiceRoot = 'C:\Thornswood-Voice-Dev',
    [string]$BotRoot      = 'C:\Thornswood-Bot',
    [string]$RecordRoot   = 'C:\Thornswood-Deletions',
    [string]$BackupTask   = 'Thornswood Backup',
    [switch]$AllowGamingPc
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say([string]$m) { Write-Output $m }
function Refuse([string]$m) { Write-Output ('REFUSED: ' + $m); exit 1 }

# ---- BoxGuard.ps1 (copy) ----
function Get-ThornswoodBoxRefusal {
    # scripts\vps\BoxGuard.ps1 says why this asks Windows rather than looking
    # for the game, and why it refuses when it cannot tell (#3041).
    try { $type = [int](Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).ProductType }
    catch { return ('Windows did not say whether this is a server (' + $_.Exception.Message + '), so it is not taken for the box') }
    if ($type -eq 2 -or $type -eq 3) { return '' }
    if ($type -eq 1) { return 'this is a Windows workstation, a gaming PC or a developer''s machine, not the box' }
    return ('Windows gives this machine product type ' + $type + ', which is not a server, so it is not taken for the box')
}
# ---- end BoxGuard.ps1 ----
if (-not $AllowGamingPc) {
    $notBox = Get-ThornswoodBoxRefusal
    if ($notBox) { Refuse ($notBox + '. Nothing was changed.') }
}
# powershell -File hands a list over as one word with commas in it.
$Merge = @($Merge | ForEach-Object { "$_" -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($Reapply -and $DiscordId) { Refuse '-Reapply takes every request in the record; leave -DiscordId off. Nothing was changed.' }
if ($Merge.Count -and -not $Reapply) { Refuse '-Merge goes with -Reapply. Nothing was changed.' }
if (-not $Reapply) {
    if ($DiscordId -notmatch '^\d{17,20}$') { Refuse '-DiscordId takes a Discord id, 17 to 20 digits. Nothing was changed.' }
    if ($Delete -and -not $By.Trim()) { Refuse '-Delete needs -By, the person running the request, for the record. Nothing was changed.' }
}
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Refuse 'node is not on the PATH. Nothing was changed.' }
$node = $nodeCmd.Source
$record = Join-Path $RecordRoot 'requests.jsonl'
$utf8 = New-Object Text.UTF8Encoding($false)

# ---------------------------------------------------------------- record ---
# The folder: SYSTEM, Administrators and the account running this, nothing
# inherited and no Users rule, the rule Lock-Folder.ps1 -Only applies, and
# read for the nightly backup's task, which takes the record off the box
# (#2833). Only the access rules are written back, never the audit part
# (#1120).
# The backup task's own SID (Install-Backup.ps1 registers it with one), or
# '' when no task of that name is registered: NT TASK names only resolve for
# a task that exists, and Install-Backup.ps1 gives the read when it makes one.
function Get-BackupTaskSid {
    if (-not $BackupTask) { return '' }
    try { return (New-Object Security.Principal.NTAccount('NT TASK', $BackupTask)).Translate([Security.Principal.SecurityIdentifier]).Value }
    catch [Security.Principal.IdentityNotMappedException] { return '' }
}
function Write-RecordAcl([string]$Path, $acl) {
    $item = Get-Item -LiteralPath $Path -Force
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]$item, [Security.AccessControl.DirectorySecurity]$acl)
}
function Add-BackupRead($acl, [string]$sid) {
    $tree = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
        (New-Object Security.Principal.SecurityIdentifier($sid)), 'ReadAndExecute', $tree, 'None', 'Allow')))
}
function Lock-RecordFolder([string]$Path) {
    $tree = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $keepers = @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
    $backup = Get-BackupTaskSid
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
        if ($keepers -notcontains $r.IdentityReference.Value) { [void]$acl.RemoveAccessRuleSpecific($r) }
    }
    foreach ($s in $keepers) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
            (New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl', $tree, 'None', 'Allow')))
    }
    if ($backup) { Add-BackupRead $acl $backup }
    Write-RecordAcl $Path $acl
    return $backup
}
function Ensure-RecordFolder {
    if (Test-Path -LiteralPath $RecordRoot) {
        # A folder locked before #2833 has no read for the backup: give it,
        # and take nothing else away.
        $backup = Get-BackupTaskSid
        if (-not $backup) { return }
        $acl = Get-Acl -LiteralPath $RecordRoot
        $has = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object {
            $_.IdentityReference.Value -eq $backup -and $_.AccessControlType -eq 'Allow' -and
            ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAndExecute) -eq [Security.AccessControl.FileSystemRights]::ReadAndExecute })
        if ($has.Count) { return }
        Add-BackupRead $acl $backup
        Write-RecordAcl $RecordRoot $acl
        Say ('read      ' + $RecordRoot + ', given to the nightly backup (' + $BackupTask + ')')
        return
    }
    $null = New-Item -ItemType Directory -Path $RecordRoot -Force
    $backup = Lock-RecordFolder $RecordRoot
    if ($backup) { Say ('locked    ' + $RecordRoot + ', SYSTEM and Administrators only, and read for the nightly backup (' + $BackupTask + ')') }
    else { Say ('locked    ' + $RecordRoot + ', SYSTEM and Administrators only; no ' + $BackupTask + ' task here yet, and Install-Backup.ps1 gives it read') }
}
# Every line of a record, each with its Discord id and profile ids. A line
# that will not parse, or names no Discord id, refuses the run: a record that
# cannot be read in full cannot be reapplied in full.
function Read-Record([string]$file) {
    $rows = @()
    if (-not (Test-Path -LiteralPath $file)) { return ,$rows }
    $n = 0
    foreach ($line in [IO.File]::ReadAllLines($file)) {
        $n++
        if (-not $line.Trim()) { continue }
        $o = $null
        try { $o = $line | ConvertFrom-Json } catch { Refuse ("line $n of $file will not parse. Nothing was changed.") }
        if ("$($o.discordId)" -notmatch '^\d{17,20}$') { Refuse ("line $n of $file names no Discord id. Nothing was changed.") }
        $rows += ,@{ line = $line.Trim(); discordId = "$($o.discordId)"; profiles = @(@($o.profiles) | Where-Object { "$_" -match '^\d{1,12}$' } | ForEach-Object { [long]$_ } | Where-Object { $_ -gt 0 }) }
    }
    return ,$rows
}

# ------------------------------------------------------------------- who ---
$people = @()
if ($Reapply) {
    foreach ($m in $Merge) { if (-not (Test-Path -LiteralPath $m)) { Refuse "-Merge names $m, which is not there. Nothing was changed." } }
    $have = Read-Record $record
    $adds = @()
    foreach ($m in $Merge) {
        foreach ($r in (Read-Record $m)) {
            if (@($have | Where-Object { $_.line -eq $r.line }).Count -or @($adds | Where-Object { $_.line -eq $r.line }).Count) { continue }
            $adds += ,$r
        }
    }
    $byId = [ordered]@{}
    foreach ($r in @($have) + @($adds)) {
        if (-not $byId.Contains($r.discordId)) { $byId[$r.discordId] = @() }
        $byId[$r.discordId] = @($byId[$r.discordId]) + @($r.profiles)
    }
    foreach ($k in $byId.Keys) { $people += ,@{ discordId = $k; profiles = @($byId[$k] | Sort-Object -Unique) } }
    Say ('record    ' + @($have).Count + ' completed request(s) in ' + $record + $(if ($adds.Count) { ', and ' + $adds.Count + ' more in ' + ($Merge -join ', ') } else { '' }))
    if (-not $people.Count) { Say 'NOTHING TO REAPPLY: no record names a request.'; exit 0 }
} else {
    $people = @(@{ discordId = $DiscordId; profiles = @() })
}

# ------------------------------------------------------------------ node ---
# The JSON is read and written by node, as the site, the voice service and
# the game server write their own, so a file goes back the shape it came in.
# It prints lines: WRITER|<service> for each service whose files it would
# change, PERSON|<json> for each person, STOP|<why> when nothing may be done,
# FAILED|<file> for a change that did not take, and DONE|<mode> at the end.
$core = @'
'use strict';
const fs = require('fs');
const path = require('path');
const a = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const say = (s) => process.stdout.write(s + '\n');
function stop(m) { say('STOP|' + m); process.exit(2); }
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// One shape for a character's form id (#2870); game\form-id.js is the
// original and tests\test-2870-form-id-shape.js keeps this copy the same.
function formIdOf(desc) {
  if (typeof desc !== 'string' || !/^[0-9a-f]{1,6}$/i.test(desc)) return 0;
  var local = parseInt(desc, 16);
  return local > 0 ? 0xff000000 + local : 0;
}
function isFormId(n) {
  return Number.isSafeInteger(n) && n > 0xff000000 && n <= 0xffffffff;
}

// What is in a folder, [] when it is not there. Anything else stops.
function names(dir) {
  try { return fs.readdirSync(dir); }
  catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
    stop(dir + ' cannot be listed (' + e.code + '), so nothing was changed');
  }
}
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }

// Every JSON file this run reads, once. A file that is there and cannot be
// read or parsed stops the run before anything is written.
const files = new Map();
function json(p, writer) {
  if (files.has(p)) return files.get(p);
  let t = null;
  try { t = fs.readFileSync(p, 'utf8'); }
  catch (e) { if (e.code !== 'ENOENT') stop(p + ' cannot be read (' + e.code + '), so nothing was changed'); }
  let f;
  if (t === null) f = { p, value: undefined, missing: true, writer, dirty: false };
  else {
    t = t.replace(/^\uFEFF/, '');
    let v;
    try { v = JSON.parse(t); } catch (e) { stop(p + ' will not parse, so nothing was changed'); }
    f = { p, value: v, missing: false, indent: /^[\[{]\s*\r?\n/.test(t) ? 2 : 0, eol: /\n$/.test(t), writer, dirty: false };
  }
  files.set(p, f);
  return f;
}
function want(f, kind) {
  if (f.missing) return false;
  const ok = kind === 'array' ? Array.isArray(f.value) : isObj(f.value);
  if (!ok) stop(f.p + ' is not the shape it should be (' + kind + '), so nothing was changed');
  return true;
}
// A game server's list of deleted characters (the release block in
// game\gamemode.js reads it), with these profiles and form ids merged in and
// what was done cleared, so every part runs for the new ids too. Its actors
// are runtime form ids (#2870); a list still holding local ids, the shape
// from a build before #2870, is not read and never merged into: it waits for
// a person (docs\GAMEMODE.md).
function mergeList(lf, P, A) {
  if (!lf.missing && !(isObj(lf.value) && Array.isArray(lf.value.profiles))) {
    stop(lf.p + ' is not a list of deleted characters, so nothing was changed');
  }
  if (!lf.missing && lf.value.actors !== undefined && !(Array.isArray(lf.value.actors) && lf.value.actors.every(isFormId))) {
    stop(lf.p + ' holds form ids in the old shape, from a build before #2870, and is not read; docs\\GAMEMODE.md says what to do. Nothing was changed');
  }
  const was = lf.missing ? {} : lf.value;
  const ids = (xs) => (Array.isArray(xs) ? xs : []).map(Number).filter((x) => Number.isSafeInteger(x) && x > 0);
  const profiles = Array.from(new Set(ids(was.profiles).concat(Array.from(P)))).sort((x, y) => x - y);
  const actors = Array.from(new Set(ids(was.actors).concat(Array.from(A)))).sort((x, y) => x - y);
  lf.value = { profiles, actors };
}
/*
  Where each service finds the requests it takes at its next start (#2758):
    site           data\deletion-requests.json        site\server.js, before it listens
    a game server  private\deleted-characters.json     server-log.js (their saves), then the gamemode (the registers)
    voice          deletion-requests.json, its folder  server-log.js, before voice starts
    the bot        deletion-requests.json, its data    bot\bot.py, before it connects
*/
const botData = isDir(path.join(a.bot, 'data')) ? path.join(a.bot, 'data') : a.bot;
function requestFile(w) {
  if (w === 'site') return path.join(a.site, 'data', 'deletion-requests.json');
  if (w === 'bot') return path.join(botData, 'deletion-requests.json');
  const tag = w.split(':')[1];
  if (w.indexOf('server:') === 0) return path.join(a.servers.find((s) => s.tag === tag).root, 'private', 'deleted-characters.json');
  return path.join(a.voices.find((v) => v.tag === tag).root, 'deletion-requests.json');
}
function requestFiles() {
  const ws = ['site'].concat(a.servers.map((s) => 'server:' + s.tag), a.voices.map((v) => 'voice:' + v.tag), ['bot']);
  return ws.map((w) => [w, requestFile(w)]);
}
// A request already there, to say it still waits; one that will not parse
// is said by the run that would merge into it.
function peek(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; }
}
const texts = new Map();    // path -> { lines, writer, dirty }
const unlinks = new Map();  // path -> writer
/*
  A change is made now only where nothing runs (writer null: a copy set
  aside). One to a service's live files (writer set) is never written here:
  that service takes the request out of its own files as it next starts
  (#2758), so each change names its writer, and touched collects the writers
  the person being read has something in.
*/
let touched = new Set();
function dirty(f) { f.dirty = true; if (f.writer) touched.add(f.writer); }
function unlink(p, writer) { unlinks.set(p, writer); if (writer) touched.add(writer); }
function text(p, writer) {
  if (texts.has(p)) return texts.get(p);
  let raw = '';
  try { raw = fs.readFileSync(p, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; stop(p + ' cannot be read (' + e.code + '), so nothing was changed'); }
  const lines = raw.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const t = { lines, writer, dirty: false };
  texts.set(p, t);
  return t;
}
function lines(p) {
  try { return fs.readFileSync(p, 'utf8').split(/\r?\n/); }
  catch (e) { if (e.code === 'ENOENT') return []; stop(p + ' cannot be read (' + e.code + '), so nothing was changed'); }
}

// The copies a restore, a wipe or an install leaves beside a folder.
const ASIDE_SITE = /^data-before-restore-\d{8}-\d{6}(-\d+)?$/;
function siteSets(root) {
  const out = [{ tag: 'site', data: path.join(root, 'data'), uploads: path.join(root, 'uploads'), writer: 'site' }];
  for (const n of names(root).sort()) {
    if (!ASIDE_SITE.test(n) || !isDir(path.join(root, n))) continue;
    const up = path.join(root, n.replace(/^data-/, 'uploads-'));
    out.push({ tag: 'site, set aside as ' + n, data: path.join(root, n), uploads: isDir(up) ? up : null, writer: null });
  }
  return out;
}
function serverSets(s) {
  const out = [{ tag: s.tag + ' game server', root: s.root, writer: 'server:' + s.tag }];
  const parent = path.dirname(s.root), leaf = path.basename(s.root).toLowerCase();
  for (const n of names(parent).sort()) {
    const l = n.toLowerCase();
    if (l.indexOf(leaf + '.') !== 0 || !/^\.(prev|undone|failed)-\d{8}-\d{6}$/.test(l.slice(leaf.length))) continue;
    if (isDir(path.join(parent, n))) out.push({ tag: s.tag + ' game server, set aside as ' + n, root: path.join(parent, n), writer: null });
  }
  // Restore-Server.ps1 moves the world and private it replaces into
  // world-before-restore-<stamp> inside the server's folder, a folder of the
  // same shape as the server's own, which a world-before-* match never read
  // into (#3620).
  for (const n of names(s.root).sort()) {
    if (/^world-before-restore-\d{8}-\d{6}$/i.test(n) && isDir(path.join(s.root, n))) {
      out.push({ tag: s.tag + ' game server, restore set aside as ' + n, root: path.join(s.root, n), writer: null });
    }
  }
  return out;
}

/*
  How many places in a register name one of these characters or this account:
  an object with a key that is the profile id, or with an owner-like field
  holding it, or an array of numbers holding it. A count for the person
  running this to read, never a reason to change anything.
*/
const REF_KEY = /^(pid|profile|profileid|owner|ownerpid|holder|who|by|byid|account|discordid|member|guard|tenant|guest|claimant|leader|taken|owedto|deliveredto|downby|doneby|for)$/i;
function refs(v, P, id, A) {
  let n = 0;
  const hit = (x) => (typeof x === 'number' || (typeof x === 'string' && /^\d{1,20}$/.test(x))) && (P.has(Number(x)) || String(x) === id);
  // A character's form id, kept as `actor` by the embassy rolls and the dungeon chests' record.
  const hitActor = (k, x) => !!A && /^actor$/i.test(k) && typeof x === 'number' && A.has(x);
  // The merchant ledger keys a supply wait by [form id, profile, what], and a
  // commission promise (held, or cooling down) by [owner, job], its owner
  // itself [form id, plugin, profile] (game\merchant-commission-state.js);
  // a character's form id there is its runtime form id (#2870).
  // A key that is not JSON names nobody.
  const inKey = (k, depth) => {
    if (typeof k !== 'string' || k[0] !== '[' || depth > 1) return false;
    let ks;
    try { ks = JSON.parse(k); } catch (e) { return false; }
    return Array.isArray(ks) && ks.some((y) => hit(y) || inKey(y, depth + 1));
  };
  (function walk(x, depth) {
    if (depth > 40 || x === null || typeof x !== 'object') return;
    if (Array.isArray(x)) {
      if (x.some(hit)) n++;
      for (const y of x) walk(y, depth + 1);
      return;
    }
    let mine = false;
    for (const k of Object.keys(x)) {
      if (hit(k) || inKey(k, 0)) mine = true;
      else if (REF_KEY.test(k) && hit(x[k])) mine = true;
      else if (hitActor(k, x[k])) mine = true;
    }
    if (mine) n++;
    for (const k of Object.keys(x)) walk(x[k], depth + 1);
  })(v, 0);
  return n;
}
function logLinesNaming(p, P, id) {
  let n = 0;
  for (const line of lines(p)) {
    if (!line.trim()) continue;
    let o = null;
    try { o = JSON.parse(line); } catch (e) { o = null; }
    if (o !== null && typeof o === 'object') { if (refs(o, P, id)) n++; continue; }
    if (line.indexOf(id) >= 0 || Array.from(P).some((pid) => new RegExp('\\b' + pid + '\\b').test(line))) n++;
  }
  return n;
}

const people = a.people.map((x) => ({ discordId: String(x.discordId), profiles: (x.profiles || []).map(Number).filter((n) => n > 0) }));
const linked = json(path.join(a.site, 'data', 'linked.json'), 'site');
want(linked, 'object');
const results = [];
// What each service is asked to take out of its own files at its next start:
// writer -> { people: Map(Discord id -> Set(profile)), actors: Set, kept: [] }.
const asks = new Map();
function ask(w) {
  if (!asks.has(w)) asks.set(w, { people: new Map(), actors: new Set(), kept: [] });
  return asks.get(w);
}

for (const person of people) {
  const id = person.discordId;
  touched = new Set();
  const r = { discordId: id, profiles: [], skipped: [], removed: {}, held: {}, left: {}, release: {}, chat: [], notes: [], waiting: [] };
  const removed = (k, n) => { if (n) r.removed[k] = (r.removed[k] || 0) + n; };
  const releases = (k, n) => { if (n) r.release[k] = (r.release[k] || 0) + n; };
  const held = (k, n) => { if (n) r.held[k] = (r.held[k] || 0) + n; };
  const left = (k, n) => { if (n) r.left[k] = (r.left[k] || 0) + n; };

  // Their characters. An id another account holds is not theirs.
  const P = new Set(person.profiles);
  const L = linked.value || {};
  if (isObj(L[id]) && Array.isArray(L[id].profiles)) for (const n of L[id].profiles) if (Number(n) > 0) P.add(Number(n));
  for (const other of Object.keys(L)) {
    if (other === id || !isObj(L[other]) || !Array.isArray(L[other].profiles)) continue;
    for (const n of L[other].profiles) if (P.has(Number(n))) { P.delete(Number(n)); r.skipped.push(Number(n)); }
  }
  r.profiles = Array.from(P).sort((x, y) => x - y);
  const hasP = (v) => P.has(Number(v));
  // The windows of their sessions staff marked kept, from every copy of the
  // site, so the chat said in them stays (#2166). The same window the site's
  // /api/session-logs reads: a minute either side of start and end, and to
  // now for one still open.
  const keptWindows = [];

  // ---- the site, and each copy of its data a restore set aside
  for (const s of siteSets(a.site)) {
    const D = s.data, FB = path.join(D, 'for-bot'), T = s.tag;
    const lk = json(path.join(D, 'linked.json'), s.writer);
    if (want(lk, 'object') && has(lk.value, id)) { delete lk.value[id]; dirty(lk); removed(T + ': Discord link', 1); }
    const rules = json(path.join(D, 'rules-accepted.json'), s.writer);
    if (want(rules, 'object') && has(rules.value, id)) { delete rules.value[id]; dirty(rules); removed(T + ': answer to the rules', 1); }
    const signins = json(path.join(D, 'signins.json'), s.writer);
    if (want(signins, 'array')) {
      const keep = signins.value.filter((x) => !(isObj(x) && String(x.id) === id));
      if (keep.length !== signins.value.length) { removed(T + ': sign-in rows', signins.value.length - keep.length); signins.value = keep; dirty(signins); }
    }
    const kept = new Set(), gone = new Set();
    const sessions = json(path.join(D, 'sessions.json'), s.writer);
    if (want(sessions, 'array')) {
      const keep = [];
      for (const x of sessions.value) {
        if (isObj(x) && String(x.who) === id) {
          if (x.keep) {
            keep.push(x); kept.add(String(x.session)); held(T + ': session rows staff marked kept', 1);
            // A row with neither a start nor an end has no window to keep.
            if (Number(x.start) || Number(x.end)) {
              keptWindows.push({ voice: x.channel === 'dev' ? 'dev' : 'live', profile: Number(x.profile) || 0,
                                 from: (Number(x.start) || Number(x.end)) - 60000,
                                 to: (Number(x.end) || Number(a.now) || Date.now()) + 60000 });
            }
          }
          else { gone.add(String(x.session)); removed(T + ': session rows', 1); }
        } else keep.push(x);
      }
      if (keep.length !== sessions.value.length) { sessions.value = keep; dirty(sessions); }
    }
    const slogs = path.join(D, 'session-logs');
    for (const f of names(slogs).sort()) {
      if (!/\.json$/i.test(f)) continue;
      const p = path.join(slogs, f);
      // Read and let go, not kept with the files this run may write: there
      // can be a year of them, up to a megabyte each.
      let set = null;
      try { set = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
      catch (e) { left(T + ': launcher logs that would not parse, so were not read', 1); continue; }
      if (!isObj(set)) continue;
      if (String(set.who) !== id && !gone.has(String(set.session))) continue;
      if (kept.has(String(set.session))) held(T + ': launcher logs of kept sessions', 1);
      else { unlink(p, s.writer); removed(T + ': launcher logs', 1); }
    }
    const trouble = json(path.join(FB, 'trouble.json'), s.writer);
    if (want(trouble, 'array')) {
      const keep = [];
      for (const x of trouble.value) {
        const theirs = isObj(x) && (String(x.who) === id || hasP(x.profile) || gone.has(String(x.session)));
        if (theirs && !kept.has(String(x.session))) { removed(T + ': failed-session alerts', 1); continue; }
        if (theirs) held(T + ': failed-session alerts of kept sessions', 1);
        keep.push(x);
      }
      if (keep.length !== trouble.value.length) { trouble.value = keep; dirty(trouble); }
    }
    const roster = json(path.join(D, 'roster.json'), s.writer);
    if (want(roster, 'object')) {
      if (isObj(roster.value.who)) {
        for (const k of Object.keys(roster.value.who)) if (hasP(k)) { delete roster.value.who[k]; dirty(roster); removed(T + ': roster rows', 1); }
      }
      if (isObj(roster.value.servers)) {
        for (const sv of Object.values(roster.value.servers)) {
          if (!isObj(sv)) continue;
          for (const k of ['checked', 'held']) {
            if (!Array.isArray(sv[k])) continue;
            const keep = sv[k].filter((n) => !hasP(n));
            if (keep.length !== sv[k].length) { sv[k] = keep; dirty(roster); }
          }
        }
      }
    }
    const inbox = json(path.join(FB, 'inbox.json'), s.writer);
    if (want(inbox, 'array')) {
      const keep = [];
      for (const x of inbox.value) {
        if (!isObj(x)) { keep.push(x); continue; }
        const sent = String(x.discordId || '') === id || hasP(x.profileId);
        const report = x.kind === 'report' || x.ticket === 'report';
        if (sent && !report) { removed(T + ': tickets, applications and calls for help they sent', 1); continue; }
        keep.push(x);
        if (sent) held(T + ': reports they made', 1);
        else if (hasP(x.aboutProfileId)) held(T + ': reports about them', 1);
      }
      if (keep.length !== inbox.value.length) { inbox.value = keep; dirty(inbox); }
    }
    const pending = json(path.join(D, 'gallery-pending.json'), s.writer);
    if (want(pending, 'array')) {
      const keep = [];
      const meta = s.uploads ? json(path.join(s.uploads, 'uploads.json'), s.writer) : null;
      if (meta) want(meta, 'object');
      for (const x of pending.value) {
        if (!(isObj(x) && String(x.discordId || '') === id)) { keep.push(x); continue; }
        removed(T + ': gallery submissions waiting for staff', 1);
        const name = String(x.name || '');
        if (s.uploads && /^[A-Za-z0-9._ -]+$/.test(name) && name !== 'uploads.json') {
          const fp = path.join(s.uploads, name);
          if (fs.existsSync(fp)) unlink(fp, s.writer);
          if (meta && !meta.missing && has(meta.value, name)) { delete meta.value[name]; dirty(meta); }
        }
      }
      if (keep.length !== pending.value.length) { pending.value = keep; dirty(pending); }
    }
    const greports = json(path.join(D, 'gallery-reports.json'), s.writer);
    const hasReports = want(greports, 'array');
    if (hasReports) held(T + ': reports they made about a gallery picture', greports.value.filter((x) => isObj(x) && String(x.discordId || '') === id).length);
    /*
      Their approved pictures. gallery.json keeps no account, because the site
      hands it out; the uploads note the site writes at submission does
      (site/server.js, #2351). One with an open report against it, or taken
      down after one and still held, is staff's while they look into it, the
      site's own rule (#2352), and is left. A picture approved before the
      note carried the account cannot be found here: Show says so.
    */
    const gallery = json(path.join(D, 'gallery.json'), s.writer);
    const umeta = s.uploads ? json(path.join(s.uploads, 'uploads.json'), s.writer) : null;
    if (want(gallery, 'array') && umeta && want(umeta, 'object')) {
      const reported = new Set(hasReports ? greports.value.filter(isObj).map((x) => String(x.name)) : []);
      for (const name of Object.keys(umeta.value)) {
        const m = umeta.value[name];
        if (!isObj(m) || String(m.discordId || '') !== id || !/^[A-Za-z0-9._ -]+$/.test(name) || name === 'uploads.json') continue;
        const onGallery = gallery.value.some((g) => isObj(g) && String(g.name) === name);
        if (reported.has(name) || (m.removed && Number(m.heldUntil) > a.now)) { held(T + ': gallery pictures held while a report about them is looked into', 1); continue; }
        if (onGallery) {
          gallery.value = gallery.value.filter((g) => !(isObj(g) && String(g.name) === name));
          dirty(gallery);
          removed(T + ': approved gallery pictures', 1);
        } else removed(T + ': other gallery files they sent', 1);
        const fp = path.join(s.uploads, name);
        if (fs.existsSync(fp)) unlink(fp, s.writer);
        delete umeta.value[name];
        dirty(umeta);
      }
    }
    const bans = json(path.join(D, 'bans.json'), s.writer);
    const notes = json(path.join(D, 'notes.json'), s.writer);
    const pk = json(path.join(D, 'pk.json'), s.writer);
    const hasBans = want(bans, 'object'), hasNotes = want(notes, 'object'), hasPk = want(pk, 'object');
    for (const k of [id].concat(r.profiles.map((n) => 'p:' + n))) {
      if (hasBans && has(bans.value, k)) held(T + ': bans', 1);
      if (hasNotes && Array.isArray(notes.value[k])) held(T + ': staff notes', notes.value[k].length);
    }
    if (hasPk) for (const n of r.profiles) if (has(pk.value, String(n))) held(T + ': PK records', 1);
    held(T + ': staff log lines naming them', logLinesNaming(path.join(FB, 'moderation.log'), P, id));
  }

  // ---- the game servers, and each copy set aside beside them
  for (const s of a.servers) {
    for (const g of serverSets(s)) {
      const R = g.root, T = g.tag;
      if (!isDir(R)) continue;
      // The form ids of their characters found here, for the release list.
      const A = new Set();
      const worlds = names(R).filter((n) => /^world(-before-.+)?$/i.test(n)).sort();
      for (const w of worlds) {
        const forms = path.join(R, w, 'changeForms');
        const dirs = [forms].concat(names(forms).filter((n) => /^_discarded-/.test(n)).map((n) => path.join(forms, n)));
        for (const dir of dirs) {
          const fl = names(dir);
          /*
            The engine's own folder, world\changeForms of a live server, is
            the server's to change, at its next start (server-log.js, before
            the engine loads it). Everything else here nothing runs from: a
            world-before-* a wipe left, a _discarded-* a reset left (the
            engine reads only the files at the top of changeForms), and every
            folder set aside. Those change now.
          */
          const live = g.writer && w === 'world' && dir === forms;
          // An unfinished save at a live server's start is server-log.js's to
          // look at (it waits for the next start when the batch holds one of
          // theirs). One in a copy nothing runs from would be replayed only
          // if that copy were put back, and could write a character back.
          if (P.size && fl.indexOf('.pending-batch') >= 0 && !live) {
            stop(path.join(dir, '.pending-batch') + ' is an unfinished save in a copy nothing runs from, which the server would replay if that copy were put back, ' +
                 'and which could write a character back. Delete that copy, or put it back and start it once, then run this again. Nothing was changed');
          }
          for (const f of fl) {
            // <id>.json.bak-<stamp> is Reset-Appearance.ps1's whole copy of a
            // character (#3620), which the engine never loads but which holds
            // them just the same. Nothing runs from it, so it goes now even in
            // a live server's folder.
            const bak = /\.json\.bak-\d{8}-\d{6}$/i.test(f);
            if ((!bak && !/\.json$/i.test(f)) || f[0] === '.') continue;
            const p = path.join(dir, f);
            if (!P.size) continue;
            let o = null;
            try { o = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { left(T + ': change forms that would not parse, so were not read', 1); continue; }
            if (isObj(o) && Number(o.profileId) > 0 && hasP(o.profileId) && !unlinks.has(p)) {
              unlink(p, live && !bak ? g.writer : null);
              removed(T + ': characters' + (bak ? ' in copies an appearance reset kept' : w === 'world' && dir === forms ? '' : ' in ' + path.relative(R, dir)), 1);
              // A character made in the world has a formDesc of its local id alone, no plugin
              // (FormDesc::ToString); the list keeps its runtime form id (#2870).
              if (formIdOf(o.formDesc)) A.add(formIdOf(o.formDesc));
            }
          }
        }
      }
      const priv = path.join(R, 'private'), data = path.join(R, 'data');
      const handled = new Set();
      // The gamemode writes characters.json, mod-settings.json, take-limit.json
      // and private\last-left.json while it runs; a characters-before-* a wipe
      // left and the data\last-left.json from before #2582 (which the gamemode
      // deletes at its start) nothing writes, so those change now.
      for (const f of names(priv)) {
        if (!/^characters(-before-.+)?\.json$/i.test(f) && f.toLowerCase() !== 'mod-settings.json') continue;
        const b = json(path.join(priv, f), /^characters-before-/i.test(f) ? null : g.writer);
        handled.add(path.join(priv, f).toLowerCase());
        if (!want(b, 'object') || !isObj(b.value.who)) continue;
        const label = f.toLowerCase() === 'mod-settings.json' ? 'mod menu choices' : 'character cards' + (f.toLowerCase() === 'characters.json' ? '' : ' in ' + f);
        for (const k of Object.keys(b.value.who)) if (hasP(k)) { delete b.value.who[k]; dirty(b); removed(T + ': ' + label, 1); }
      }
      const take = json(path.join(priv, 'take-limit.json'), g.writer);
      handled.add(path.join(priv, 'take-limit.json').toLowerCase());
      if (want(take, 'object') && isObj(take.value.counts)) {
        for (const k of Object.keys(take.value.counts)) if (hasP(k.split('|')[0])) { delete take.value.counts[k]; dirty(take); removed(T + ': take counts', 1); }
      }
      // The gamemode keeps it in private since #2582; a server folder set aside
      // before that still has it in data, and is the person's record all the same.
      for (const dir of [priv, data]) {
        const lastLeft = json(path.join(dir, 'last-left.json'), dir === priv ? g.writer : null);
        handled.add(path.join(dir, 'last-left.json').toLowerCase());
        if (want(lastLeft, 'object')) {
          for (const k of Object.keys(lastLeft.value)) if (hasP(k)) { delete lastLeft.value[k]; dirty(lastLeft); removed(T + ': when they last left', 1); }
        }
      }
      /*
        The game's registers (#2351, Patrick's A of 16 October): the ones the
        gamemode keeps in private are let go by the game server itself, at
        its next start, through each register's own rule, from the list this
        writes beside them (private\deleted-characters.json, the release
        block in game\gamemode.js). So here they are counted, never edited.
        A server that holds something of theirs gets the list: their profile
        ids and the form ids of their characters found here, merged into a
        list still waiting there, with what was already done cleared so every
        part runs for the new ids too. Nothing is stopped for it (#2758): the
        list is the request, and at the server's next start server-log.js
        takes out their saves (the part "saves") and the gamemode lets go of
        the registers, the merchant ledger among them, which the purse
        service lets go of at NPC startup (#2652). A copy set aside gets one
        too when it holds a register of theirs, which nothing runs from until
        it is put back; its saves go now. Every other file is counted and
        left: the old copies in data.
      */
      const LIST = 'deleted-characters.json';
      const RELEASED = /^(property|law|beds|farm-claims|embassy|books|dungeon-rewards-ledger|trade-cargo|market-stalls|trade-carts|merchant-ledger)\.json$/i;
      handled.add(path.join(priv, LIST).toLowerCase());
      let theirs = 0;
      if (P.size) {
        for (const dir of [priv, data]) {
          for (const f of names(dir).sort()) {
            const p = path.join(dir, f);
            if (!/\.json$/i.test(f) || f[0] === '.' || handled.has(p.toLowerCase())) continue;
            let st; try { st = fs.statSync(p); } catch (e) { continue; }
            if (!st.isFile() || st.size > 64 * 1024 * 1024) continue;
            let v;
            try { v = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
            catch (e) { left(T + ': ' + path.relative(R, p) + ' would not parse, so was not read', 1); continue; }
            const n = refs(v, P, id, A);
            if (dir === priv && RELEASED.test(f)) {
              releases(T + ': places in ' + path.relative(R, p) + ' naming their character', n);
              theirs += n;
              if (f.toLowerCase() === 'books.json' && isObj(v) && Array.isArray(v.books)) {
                releases(T + ': faction and business books they own, disbanded unless staff hand them on first',
                         v.books.filter((b) => isObj(b) && hasP(b.owner)).length);
              }
            } else left(T + ': places in ' + path.relative(R, p) + ' naming their character', n);
          }
        }
      }
      if (g.writer) {
        // A live server: asked when it holds anything of theirs (a save, a
        // card or a register); the list is written after every person is read.
        if (P.size && (theirs || touched.has(g.writer))) {
          const q = ask(g.writer);
          if (!q.people.has(id)) q.people.set(id, new Set());
          for (const n of P) q.people.get(id).add(n);
          for (const n of A) q.actors.add(n);
          releases(T + ': ' + path.relative(R, path.join(priv, LIST)) + ', the request it takes at its next start (their saves, then the registers)', 1);
        }
      } else if (P.size && (theirs || A.size) && isDir(priv)) {
        // The registers live in private; an old copy with none (set aside
        // before the gamemode kept them there) has nothing to let go, so no
        // list is written into a folder that is not there (18 Oct: a real
        // run stopped on ENOENT writing one into Thornswood-Server.prev-20261003).
        const lf = json(path.join(priv, LIST), null);
        mergeList(lf, P, A);
        dirty(lf);
        releases(T + ': ' + path.relative(R, lf.p) + ', the list the game server lets go of at its next start', 1);
      }
      for (const lg of [path.join(priv, 'moderation.log'), path.join(R, 'for-bot', 'moderation.log'), path.join(priv, 'door.log')]) {
        held(T + ': staff log lines naming them (' + path.relative(R, lg) + ')', logLinesNaming(lg, P, id));
      }
    }
  }

  // ---- chat, one day file at a time
  for (const v of a.voices) {
    if (!P.size) break;
    const dir = path.join(v.root, 'chat');
    for (const f of names(dir).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue;
      const p = path.join(dir, f);
      const t = text(p, 'voice:' + v.tag);
      if (!t) continue;
      let inKept = 0;
      const keep = t.lines.filter((line) => {
        let o = null;
        try { o = JSON.parse(line); } catch (e) { return true; }
        if (!(isObj(o) && hasP(o.profileId))) return true;
        const at = Number(o.at) || 0;
        if (keptWindows.some((w) => w.voice === v.tag && w.profile === Number(o.profileId) && at >= w.from && at <= w.to)) { inKept++; return true; }
        return false;
      });
      held(v.tag + ' voice: chat lines in sessions staff marked kept', inKept);
      if (keep.length !== t.lines.length) {
        r.chat.push({ voice: v.tag, file: f, before: t.lines.length, after: keep.length });
        removed(v.tag + ' voice: chat lines', t.lines.length - keep.length);
        t.lines = keep;
        dirty(t);
      }
    }
  }

  // ---- the bot: its data folder since #1104, beside the code before that
  const bd = isDir(path.join(a.bot, 'data')) ? path.join(a.bot, 'data') : a.bot;
  const joins = json(path.join(bd, 'joins.json'), 'bot');
  if (want(joins, 'object')) {
    for (const gv of Object.values(joins.value)) {
      if (isObj(gv) && isObj(gv.members) && has(gv.members, id)) { delete gv.members[id]; dirty(joins); removed('bot: join number', 1); }
    }
  }
  // A restore moves the joins.json it replaces to
  // joins.json-before-restore-<stamp>[-n] beside it (vps-restore-services.ps1),
  // kept 30 days and written by nobody, so edited here at once (#3620).
  for (const n of names(bd).sort()) {
    if (!/^joins\.json-before-restore-\d{8}-\d{6}(-\d+)?$/.test(n)) continue;
    const old = json(path.join(bd, n), null);
    if (!want(old, 'object')) continue;
    for (const gv of Object.values(old.value)) {
      if (isObj(gv) && isObj(gv.members) && has(gv.members, id)) { delete gv.members[id]; dirty(old); removed('bot: join number in a copy a restore set aside', 1); }
    }
  }
  const tickets = json(path.join(bd, 'open-tickets.json'), 'bot');
  if (want(tickets, 'object')) {
    for (const k of Object.keys(tickets.value)) if (k.split(':').pop() === id) { delete tickets.value[k]; dirty(tickets); removed('bot: open ticket', 1); }
  }

  // The site, voice and the bot are asked for whatever of theirs is in their
  // files; voice with the windows of the sessions staff kept on it.
  for (const w of touched) {
    if (/^server:/.test(w)) continue;
    const q = ask(w);
    if (!q.people.has(id)) q.people.set(id, new Set());
    for (const n of P) q.people.get(id).add(n);
    if (/^voice:/.test(w)) {
      const tag = w.slice(6);
      for (const kw of keptWindows) if (kw.voice === tag) q.kept.push({ profile: kw.profile, from: kw.from, to: kw.to });
    }
  }
  // Asked before and not taken yet: each request still waiting that names them.
  for (const [w, p] of requestFiles()) {
    const v = peek(p);
    if (!isObj(v)) continue;
    const named = w.indexOf('server:') === 0
      ? (Array.isArray(v.profiles) && r.profiles.length && r.profiles.every((n) => v.profiles.indexOf(n) >= 0))
      : (Array.isArray(v.people) && v.people.some((x) => isObj(x) && String(x.discordId) === id));
    if (named) r.waiting.push(w);
  }
  results.push(r);
}

// Each request, merged into one still waiting there.
for (const [w, q] of asks) {
  const p = requestFile(w);
  const lf = json(p, null);
  if (w.indexOf('server:') === 0) {
    const P = new Set(), A = q.actors;
    for (const s of q.people.values()) for (const n of s) P.add(n);
    if (!isDir(path.dirname(p))) stop(path.dirname(p) + ' is not there, so the game server cannot be asked; nothing was changed');
    mergeList(lf, P, A);
  } else {
    if (!lf.missing && !(isObj(lf.value) && Array.isArray(lf.value.people))) stop(p + ' is not a list of deletion requests, so nothing was changed');
    const people = new Map();
    for (const x of (lf.missing ? [] : lf.value.people)) {
      if (!isObj(x) || !/^\d{17,20}$/.test(String(x.discordId))) continue;
      people.set(String(x.discordId), new Set((Array.isArray(x.profiles) ? x.profiles : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0)));
    }
    for (const [id, s] of q.people) {
      if (!people.has(id)) people.set(id, new Set());
      for (const n of s) people.get(id).add(n);
    }
    const value = { people: Array.from(people, ([discordId, s]) => ({ discordId, profiles: Array.from(s).sort((x, y) => x - y) })) };
    if (w.indexOf('voice:') === 0) {
      const kept = (!lf.missing && Array.isArray(lf.value.kept) ? lf.value.kept : []).concat(q.kept);
      const seen = new Set();
      value.kept = kept.filter((k) => { const key = k.profile + ':' + k.from + ':' + k.to; if (seen.has(key)) return false; seen.add(key); return true; });
    }
    lf.value = value;
  }
  lf.dirty = true;
}

for (const w of asks.keys()) say('WRITER|' + w);
for (const r of results) say('PERSON|' + JSON.stringify(r));

if (a.mode !== 'apply') { say('DONE|plan'); process.exit(0); }

// Each file to a file beside it, then swapped in, so a write that fails half
// way leaves the old file whole. A change that does not take is named.
const failed = [];
function swap(p, body) {
  const tmp = path.join(path.dirname(p), '.' + path.basename(p) + '.delete-person.tmp');
  try { fs.writeFileSync(tmp, body, 'utf8'); fs.renameSync(tmp, p); }
  catch (e) {
    failed.push(p + ' (' + (e.code || e.message) + ')');
    if (fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); } catch (e2) { failed.push(tmp + ', left behind (' + (e2.code || e2.message) + ')'); }
    }
  }
}
// Only what nothing runs from, and the requests; a service's live files are
// its own to change at its next start.
for (const f of files.values()) {
  if (!f.dirty || f.writer) continue;
  swap(f.p, JSON.stringify(f.value, null, f.indent || undefined) + (f.eol ? '\n' : ''));
}
for (const [p, t] of texts) {
  if (!t.dirty || t.writer) continue;
  swap(p, t.lines.length ? t.lines.join('\n') + '\n' : '');
}
for (const [p, w] of unlinks) {
  if (w) continue;
  try { fs.unlinkSync(p); }
  catch (e) { if (e.code !== 'ENOENT') failed.push(p + ' (' + e.code + ')'); }
}
for (const f of failed) say('FAILED|' + f);
say(failed.length ? 'DONE|failed' : 'DONE|apply');
'@

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-delete-person-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $work -Force
function Run-Core([string]$mode) {
    $plan = @{
        mode    = $mode
        now     = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        people  = @($people | ForEach-Object { @{ discordId = $_.discordId; profiles = @($_.profiles) } })
        site    = $SiteRoot
        servers = @(@{ tag = 'live'; root = $GameRoot }, @{ tag = 'dev'; root = $DevGameRoot })
        voices  = @(@{ tag = 'live'; root = $VoiceRoot }, @{ tag = 'dev'; root = $DevVoiceRoot })
        bot     = $BotRoot
    }
    $af = Join-Path $work ($mode + '.json')
    [IO.File]::WriteAllText($af, (ConvertTo-Json -InputObject $plan -Depth 6), $utf8)
    $cf = Join-Path $work 'core.js'
    [IO.File]::WriteAllText($cf, $core, $utf8)
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $lines = @(& $node $cf $af 2>&1 | ForEach-Object { "$_" }) } finally { $ErrorActionPreference = $eap }
    return ,$lines
}
# What each service is called, by the name the plan uses for it.
$names = [ordered]@{
    'site' = 'the site'; 'server:live' = 'the live game server'; 'server:dev' = 'the dev game server'
    'voice:live' = 'live voice'; 'voice:dev' = 'dev voice'; 'bot' = 'the bot'
}
function Named([string[]]$ws) { return ((@($names.Keys | Where-Object { $ws -contains $_ }) | ForEach-Object { $names[$_] }) -join ', ') }
function Show([string[]]$lines, [string]$verb) {
    foreach ($l in $lines) {
        if ($l -notlike 'PERSON|*') { continue }
        $r = $l.Substring(7) | ConvertFrom-Json
        Say ''
        Say ('Discord id ' + $r.discordId + ': ' + @($r.profiles).Count + ' character(s)')
        foreach ($n in @($r.skipped)) { if ($n) { Say ('  left       profile ' + $n + ': another account holds it too, so it is not theirs to delete') } }
        $any = $false
        foreach ($p in $r.removed.PSObject.Properties) { $any = $true; Say ('  {0,-10} {1,6}  {2}' -f $verb, $p.Value, $p.Name) }
        # The game's registers, let go by the game server at its next start (#2351).
        foreach ($p in $r.release.PSObject.Properties) { $any = $true; Say ('  {0,-10} {1,6}  {2}' -f 'release', $p.Value, $p.Name) }
        foreach ($p in $r.held.PSObject.Properties) { $any = $true; Say ('  {0,-10} {1,6}  {2}' -f 'kept', $p.Value, $p.Name) }
        foreach ($p in $r.left.PSObject.Properties) { $any = $true; Say ('  {0,-10} {1,6}  {2}' -f 'left', $p.Value, $p.Name) }
        foreach ($c in @($r.chat)) { if ($c) { Say ('  chat       {0} {1}: {2} lines before, {3} after' -f $c.voice, $c.file, $c.before, $c.after) } }
        # Asked earlier and not taken yet: the service has not started since (#2758).
        foreach ($w in @($r.waiting)) { if ($w) { $any = $true; Say ('  waiting    ' + $names[$w] + ' has a request for them it takes at its next start') } }
        if (-not $any) { Say '  nothing of theirs on this box' }
    }
    Say ''
    Say '  Left on purpose: their tickets in the Discord and the bot''s lines about them in #ticket-log,'
    Say '  the record of what they were told; the bot deletes each 365 days after it closed (#3634).'
    Say '  Not on this box, so not done here:'
    Say '  gallery pictures approved before the site kept the sending account (remove theirs in the hub by name),'
    Say '  and the encrypted backups (they expire on their schedule; the record reapplies this after a restore).'
}
# Which services were asked, and where each says it took the request (#2758).
function Say-Asked([string[]]$ws) {
    if (-not $ws.Count) { return }
    Say ('Nothing was stopped. Each of these takes the rest out of its own files as it next starts: ' + (Named $ws) + '.')
    Say '  Each says so in its own log, with counts: the site in site.log, each game server and voice in server.log and voice.log'
    Say '  ("deletions:"), a game server''s registers in thornswood.log ("release:"), and the bot in bot.log ("deletion requests:").'
    Say '  Run this again without -Delete to see what still waits; tell them it is done when nothing does.'
}
function Stopped([string[]]$lines) {
    $s = @($lines | Where-Object { $_ -like 'STOP|*' } | Select-Object -First 1)
    if ($s.Count) { return $s[0].Substring(5) }
    if (-not @($lines | Where-Object { $_ -like 'DONE|*' }).Count) { return ('node did not finish: ' + (($lines | Select-Object -Last 3) -join ' / ')) }
    return ''
}

$exit = 0
try {
    $plan = Run-Core 'plan'
    $why = Stopped $plan
    if ($why) { Refuse $why }
    $asked = @($plan | Where-Object { $_ -like 'WRITER|*' } | ForEach-Object { $_.Substring(7) })

    if (-not $Delete) {
        Show $plan 'remove'
        Say ''
        if ($asked.Count) { Say ('A real run stops nothing. These take the rest out of their own files as each next starts: ' + (Named $asked) + '.') }
        Say ('DRY RUN: nothing was changed. Add -Delete' + $(if (-not $Reapply) { ' -By <your name>' } else { '' }) + ' to do it.')
        exit 0
    }

    $done = Run-Core 'apply'
    $why = Stopped $done
    if ($why) { Refuse $why }
    Show $done 'removes'
    $failed = @($done | Where-Object { $_ -like 'FAILED|*' } | ForEach-Object { $_.Substring(7) })
    if ($failed.Count) {
        Say ''
        foreach ($f in $failed) { Say ('COULD NOT CHANGE ' + $f) }
        Say 'NOT FINISHED: the files above were not changed and the request is not in the record. Run it again; what is already gone stays gone.'
        $exit = 1
    } elseif ($Reapply) {
        if ($adds.Count) {
            Ensure-RecordFolder
            foreach ($r in $adds) { [IO.File]::AppendAllText($record, $r.line + "`n", $utf8) }
            Say ('merged    ' + $adds.Count + ' request(s) into ' + $record)
        }
        Say ''
        Say ('REAPPLIED: every request in ' + $record + ' is removed again from every copy nothing runs from, and asked of every service.')
        Say-Asked $asked
    } else {
        $r = ((@($done | Where-Object { $_ -like 'PERSON|*' }))[0]).Substring(7) | ConvertFrom-Json
        $row = [ordered]@{
            at        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
            discordId = $DiscordId
            profiles  = @($r.profiles)
            by        = $By.Trim()
            removes   = $r.removed
            chat      = @($r.chat)
            asked     = @($names.Keys | Where-Object { $asked -contains $_ })
        }
        Ensure-RecordFolder
        [IO.File]::AppendAllText($record, (ConvertTo-Json -InputObject $row -Depth 6 -Compress) + "`n", $utf8)
        Say ''
        Say ('RECORDED, and written down in ' + $record + ' so a restore reapplies it. The nightly backup takes the record from tonight.')
        Say-Asked $asked
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
exit $exit
