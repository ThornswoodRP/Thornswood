<#
.SYNOPSIS
  The six script texts that run on the box (issue #2899), for Run-OnBox.ps1 and the others below: the run (Get-ThornswoodOnBoxScript) and its two limited parts, and the keeper that makes the run's folder and removes it, in three parts (its hold, keep and end scripts).

.DESCRIPTION
  The six script texts that run on the box (issue #2899), for Run-OnBox.ps1
  and the others below: the run (Get-ThornswoodOnBoxScript) and, for a run as
  the box's limited account (#6879), its start and its task
  (Get-ThornswoodOnBoxLimitedStartScript, Get-ThornswoodOnBoxLimitedScript),
  and the keeper that makes the run's folder and removes it, in three parts
  (its hold, keep and end scripts). Kept apart so
  tests\test-2899-run-on-box.ps1 runs the same text under PowerShell 7, as
  the box does, against a stand-in folder.

  Besides the functions it sets six variables: $ThornswoodGameArchiveStore,
  the box's folder of Skyrim's own archives, $ThornswoodGameArchives, the
  archives in it, and $ThornswoodScriptPack, the script pack beside them; and
  for the limited run $ThornswoodLimitedTask, its task's name,
  $ThornswoodLimitedMinutes, its time limit, and $ThornswoodLimitedNeverReach,
  what its fail-safe reads besides the services' own list.
  Dot-sourced by Run-OnBox.ps1 and Send-GameArchives.ps1 in scripts\mods,
  Backup-Server.ps1 in scripts\vps and LastPluginOnBox.ps1 in scripts\deploy.

  The keeper's folder is the one way a script here lands files on the box or
  makes them there to bring back (#3035): Open-ThornswoodOnBoxFolder and
  Close-ThornswoodOnBoxFolder, below, for Run-OnBox.ps1 and Backup-Server.ps1
  alike. A script that only needs its text run there sends it through
  Send-Script.ps1 instead, whose run deletes a long one's copy before it runs.

  The far side runs under PowerShell 7: ASCII, and .NET for the
  hashes, not Get-FileHash (ServerContent.ps1 says why).
#>

# Skyrim's own archives the content tools read (Patrick, 20 Oct 2026, A on
# #2899): Interface for the string tables and the menus, Meshes and Textures
# for the notice board and Check-FromGame. Kept on the box in one folder of
# their own, SYSTEM's and Administrators' only, each file read only to
# everyone but SYSTEM, and every one of them the bytes records\skyrim-files.json
# names. scripts\mods\Send-GameArchives.ps1 puts them there, and with them,
# under Strings, the loose string tables records\game-strings.json names: a
# localized master whose names are in no archive (RaceCompatibility.esm,
# measured 20 Oct) stops Build-LastPlugin without them. _ResourcePack.bsa,
# the game's own archive beside _ResourcePack.esl, since #3100: that master
# is localized and its string tables are in that archive alone, so on 21 Oct
# the hunt and ore builders failed on the box with "_ResourcePack.esl:
# localised and no english string table found" (records\skyrim-files.json
# pins its size and sha1 like the others).
$ThornswoodGameArchiveStore = 'C:\Thornswood-GameData'
$ThornswoodGameArchives = @('Skyrim - Interface.bsa', 'Skyrim - Meshes0.bsa', 'Skyrim - Meshes1.bsa') +
    @(0..8 | ForEach-Object { 'Skyrim - Textures' + $_ + '.bsa' }) + @('_ResourcePack.bsa')
# And the script pack (#3105): every Papyrus script a game PC's Data folder
# holds, which scripts\mods\New-ScriptPack.py makes there and
# records\papyrus-scripts.json pins. None of the archives that carry scripts
# is on the box (Skyrim - Misc.bsa, the Creation Club ones, the mods'), so on
# 26 Oct the whole rebuild stopped at the crime table with 14,553 scripts
# missing. Each run links it into its data folder beside the archives, where
# scripts\dev\Audit-PapyrusEvents.py reads it in their place.
$ThornswoodScriptPack = 'papyrus-scripts.zip'

# Text for the box: makes a file readable, and linkable, and nothing more to
# everyone but SYSTEM. A run reaches the archives through hard links, which
# share the file's rules, so a tool that opens one to write is refused and
# the store keeps its bytes; deleting the link needs only the run folder's
# own rules. Making a hard link opens the file for its attributes, so the
# account that links needs WriteAttributes: measured 20 Oct, the build
# runner's account (not elevated) was refused "Access is denied" at the link
# with read alone (run 39470283490), where Administrator on the box was not
# refused. Attributes are not the bytes: writing still needs
# WriteData, which nobody but SYSTEM has.
function Get-ThornswoodArchiveReadOnlyScript {
    return @'
function Set-ThornswoodArchiveReadOnly([string]$Path) {
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-18')), 'FullControl', 'Allow')))
  foreach ($s in @('S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($s)), 'ReadAndExecute, WriteAttributes, Synchronize', 'Allow')))
  }
  [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo](Get-Item -LiteralPath $Path -Force), $acl)
}
'@
}

# Text for the box: names the run's folder $run and holds it through its lock
# for as long as the process that runs this lives. The folder is in use while
# its lock is held (the keeper, below), and a run holds it too, so even with
# the keeper's session gone no other run's sweep takes the folder from under
# what is running in it. The handle goes when the process ends, however it
# ends. A folder no keeper made has no lock, and nothing runs in it.
function Get-ThornswoodOnBoxHoldScript([Parameter(Mandatory = $true)][string]$Run) {
    return @"
`$run = '$Run'
try { `$hold = New-Object IO.FileStream((`$run + '.lock'), 'Open', 'ReadWrite', 'ReadWrite') }
catch { 'STOP. the run''s folder could not be held through its lock, so nothing ran: ' + `$_.Exception.GetBaseException().Message; exit 2 }
"@
}

# Why a tool ended with an exit other than 0, from what the run said (#6351):
# the last STOP line the tool printed between the run's '-------- <tool>
# --------' and '-------- end --------' lines, else the last line it printed
# at all, which for a Python tool that died is its error's own line (the run
# prints the tool's output, then its errors). '' when it printed nothing. On
# 16 Nov 2026 Add-ContentRecords.py died on a file the box's checkout no longer
# had, and the content build's status said only "ended with exit 1".
function Get-ThornswoodToolReason([string[]]$Lines) {
    $in = $false
    $said = New-Object 'Collections.Generic.List[string]'
    foreach ($l in @($Lines)) {
        $t = ([string]$l).Trim()
        if ($t -ceq '-------- end --------') { $in = $false; continue }
        if ($t -cmatch '^-------- .+ --------$') { $in = $true; $said.Clear(); continue }
        if ($in -and $t) { $said.Add($t) }
    }
    $stop = @($said | Where-Object { $_ -cmatch '^STOP\. ' }) | Select-Object -Last 1
    if ($stop) { return $stop.Substring(6) }
    if ($said.Count) { return $said[$said.Count - 1] }
    return ''
}

# THE LIMITED RUN (#6879). Patrick's A on #6879 (26 Nov 2026): a merge the
# queue holds is built on the box before it lands, and its content checks run
# over that build, so a pull request that breaks one never reaches main. The
# queued commit's tools are code nobody has merged yet, so they never run as
# the box's administrator, which every other run here does: Make-LastPlugin.py
# and the tool run in a one-shot scheduled task as NT AUTHORITY\LOCAL SERVICE,
# limited, with the one privilege that lets it walk to its folder
# (SeChangeNotifyPrivilege) and a SID of its own, NT TASK\Thornswood Limited
# Build, the way the game servers run the gamemode the merges deploy
# (scripts\deploy\ServiceAccount.ps1 says why each part is there). So the
# tools can read the game data and change only the run's folder:
#
#   - before anything is laid out, the fail-safe of the services
#     (Test-ThornswoodServiceCannotReach) reads the rules on every place no
#     service may read, with the gate's folder added, and the run stops with
#     nothing run when this account could read one;
#   - the run's folder is made SYSTEM's, the Administrators' and the task's,
#     nothing inherited, so the task changes what is in it and nothing else,
#     and OWNER RIGHTS keeps what it makes from being given to anybody else
#     (a file's owner is LOCAL SERVICE, which every service is);
#   - Skyrim's archives and string tables, linked in read only, get a read
#     rule for the task's SID, once, on the store's own files;
#   - the task's program is this file's wrapper, which puts itself in a
#     Windows job that ends every process in it when it ends, so nothing the
#     tool starts outlives its run; the task ends at its time limit too;
#   - what the wrapper says and the back.zip it makes are taken only as files
#     of their own (no link, no reparse point), and Run-OnBox.ps1 takes from
#     the zip only what the run listed under the paths it watches.
#
# The administrator's part (the rest of Get-ThornswoodOnBoxScript) lays the
# folder out and finds the programs as before; the part from the hashes on
# (-PartB) runs in the wrapper, and its lines come back in said.txt.
$ThornswoodLimitedTask = 'Thornswood Limited Build'
$ThornswoodLimitedMinutes = 40
# What the fail-safe reads besides the services' own list: the gate's folder,
# its checkouts, keys and log, and the box's ssh host keys and the keys that
# let a person in as an administrator. Not the ssh folder itself, which
# every user may read for sshd_config.
$ThornswoodLimitedNeverReach = @('C:\Thornswood-Gate') + @(
    'administrators_authorized_keys', 'ssh_host_ed25519_key', 'ssh_host_ecdsa_key', 'ssh_host_rsa_key', 'ssh_host_dsa_key' |
        ForEach-Object { 'C:\ProgramData\ssh\' + $_ })

function Get-ThornswoodOnBoxLimitedSid {
    . (Join-Path $PSScriptRoot '..\deploy\ServiceAccount.ps1')
    return (Get-ThornswoodTaskSidFromName -TaskName $ThornswoodLimitedTask)
}

function Get-ThornswoodOnBoxLimitedStartScript([Parameter(Mandatory = $true)][string]$Run) {
    . (Join-Path $PSScriptRoot '..\deploy\ServiceAccount.ps1')
    $funcs = ''
    foreach ($n in 'Get-ThornswoodServiceNeverReach', 'Test-ThornswoodServiceCannotReach') {
        $funcs += 'function ' + $n + ' {' + (Get-Item ('function:' + $n)).ScriptBlock.ToString() + "}`n"
    }
    $extra = (@($ThornswoodLimitedNeverReach | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', ')
    $text = @'
# The limited run (OnBox.ps1, THE LIMITED RUN): the fail-safe, then the run's
# folder made the task's to change.
$limitedTask = '__TASK__'
$limitedSid = '__SID__'
__FUNCS__
$limitedProblems = @(Test-ThornswoodServiceCannotReach -Paths (@(Get-ThornswoodServiceNeverReach) + @(__EXTRA__)) -Sids @($limitedSid))
if ($limitedProblems.Count) { 'STOP. the limited account could read a place no build may read, so nothing ran: ' + ($limitedProblems -join '; '); exit 2 }
$fsr = [Security.AccessControl.FileSystemRights]
$tree = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$flat = [Security.AccessControl.PropagationFlags]::None
function Rule([string]$Sid, $Rights) { New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($Sid)), $Rights, $tree, $flat, 'Allow') }
$runAcl = New-Object Security.AccessControl.DirectorySecurity
$runAcl.SetAccessRuleProtection($true, $false)
foreach ($s in @('S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)) { $runAcl.AddAccessRule((Rule $s $fsr::FullControl)) }
$runAcl.AddAccessRule((Rule $limitedSid $fsr::Modify))
$runAcl.AddAccessRule((Rule 'S-1-3-4' $fsr::ReadPermissions))
[IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo](Get-Item -LiteralPath $run), $runAcl)
'limited   the run''s folder is SYSTEM''s, the Administrators'' and NT TASK\' + $limitedTask + '''s alone; nothing in a place no service may read is readable to it'
'@
    return $text.Replace('__TASK__', $ThornswoodLimitedTask).Replace('__SID__', (Get-ThornswoodTaskSidFromName -TaskName $ThornswoodLimitedTask)).Replace('__FUNCS__', $funcs).Replace('__EXTRA__', $extra)
}

# The administrator's side once the folder is laid out: the wrapper and what
# it is given, the read rule on the archives, the task, its wait, and what
# it said. -PartB is the run itself, as the administrator's run has it.
function Get-ThornswoodOnBoxLimitedScript {
    param(
        [Parameter(Mandatory = $true)][string]$Run,
        [Parameter(Mandatory = $true)][string]$Tool,
        [Parameter(Mandatory = $true)][string]$PartB
    )
    $wrapper = @'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$run = '__RUN__'
$said = Join-Path $run 'said.txt'
$utf8 = New-Object Text.UTF8Encoding($false)
& {
  try {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ThornswoodLimitedJob
{
    [StructLayout(LayoutKind.Sequential)] struct Basic { public long A, B; public uint LimitFlags; public UIntPtr C, D; public uint E; public UIntPtr F; public uint G, H; }
    [StructLayout(LayoutKind.Sequential)] struct Io { public ulong A, B, C, D, E, F; }
    [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic Basic; public Io Io; public UIntPtr A, B, C, D; }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended info, int length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    static IntPtr held;
    // A job that ends every process in it when its last handle closes, which
    // is when this process ends, however it ends; this process goes in it,
    // and so does everything it starts.
    public static void Hold()
    {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var info = new Extended();
        info.Basic.LimitFlags = 0x2000;
        if (!SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(Extended)))) throw new Win32Exception();
        if (!AssignProcessToJobObject(job, GetCurrentProcess())) throw new Win32Exception();
        held = job;
    }
}
"@
    [ThornswoodLimitedJob]::Hold()
    $given = [IO.File]::ReadAllText((Join-Path $run 'limited.json')) | ConvertFrom-Json
    $repo = Join-Path $run 'repo'
    $data = Join-Path $run 'data'
    $pluginList = Join-Path $run 'plugins.txt'
    $orderSettings = Join-Path $run 'server-settings.json'
    $python = [string]$given.python
    $exe = [string]$given.exe
    $words = @($given.words | ForEach-Object { [string]$_ })
    foreach ($x in @($python, $exe) | Select-Object -Unique) {
      try { [IO.File]::OpenRead($x).Dispose() }
      catch { throw ($x + ' cannot be read by the limited account (' + $_.Exception.GetBaseException().Message + '): it is installed for one user only. Install it for every user of the box.') }
    }
    $env:PATH = (Split-Path -Parent $python) + ';' + $env:PATH
    # No Set-Location: PowerShell 7 lists every folder above the one it
    # goes to, for its case, and this account may not list those (the
    # box's C:\Windows\Temp). The task starts in the repository already,
    # and the tool is started there below.
    'limited   as ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name + ', in a job that ends what it starts'
__PARTB__
  } catch { 'STOP. ' + $_.Exception.GetBaseException().Message + ' (the limited run)' }
} 2>&1 | ForEach-Object { [IO.File]::AppendAllText($said, ([string]$_) + "`r`n", $utf8) }
'@
    $wrapper = $wrapper.Replace('__RUN__', $Run.Replace("'", "''")).Replace('__PARTB__', $PartB)
    $text = @'
# The limited run (OnBox.ps1, THE LIMITED RUN): what was found above goes to
# the wrapper, which the task runs; then what it said, and how it ended.
$limitedWrapper = Join-Path $run 'limited.ps1'
$limitedSaid = Join-Path $run 'said.txt'
[IO.File]::WriteAllText((Join-Path $run 'limited.json'), (ConvertTo-Json -InputObject @{ python = $python; exe = $exe; words = [string[]]$words } -Depth 3), (New-Object Text.UTF8Encoding($false)))
# The wrapper's text is sent as base64, so nothing in it can end a string here.
[IO.File]::WriteAllBytes($limitedWrapper, [Convert]::FromBase64String('__WRAPPER64__'))
if (Test-Path -LiteralPath $store) {
  foreach ($f in @(Get-ChildItem -LiteralPath $store -File -Recurse)) {
    $a = Get-Acl -LiteralPath $f.FullName
    $has = @($a.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $limitedSid -and [string]$_.AccessControlType -eq 'Allow' -and (([long][int]$_.FileSystemRights -band 1) -ne 0) }).Count
    if (-not $has) {
      $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($limitedSid)), ($fsr::ReadAndExecute -bor $fsr::Synchronize), 'Allow')))
      [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$f, [Security.AccessControl.FileSecurity]$a)
      'limited   NT TASK\' + $limitedTask + ' may read ' + $f.FullName + ' now'
    }
  }
}
$limitedPs = (Get-Process -Id $PID).Path
$old = @(Get-ScheduledTask -TaskName $limitedTask -ErrorAction SilentlyContinue)
foreach ($o in $old) { try { Stop-ScheduledTask -InputObject $o } catch { <# one not running cannot be stopped; it is taken away next #> }; Unregister-ScheduledTask -InputObject $o -Confirm:$false; 'limited   took away the task a run before this one left' }
$limitedEnded = $false
$limitedResult = $null
$limitedWhy = ''
try {
  $action = New-ScheduledTaskAction -Execute $limitedPs -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $limitedWrapper + '"') -WorkingDirectory $repo
  $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited -RequiredPrivilege 'SeChangeNotifyPrivilege' -ProcessTokenSidType Unrestricted
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes __MINUTES__) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 7
  $null = Register-ScheduledTask -TaskName $limitedTask -Action $action -Principal $principal -Settings $settings -Description 'One run of a content tool of a commit not on main yet, as the limited account (scripts/mods/OnBox.ps1, #6879). Made and taken away by the run.' -Force
  $mapped = ''
  try { $mapped = (New-Object Security.Principal.NTAccount('NT TASK', $limitedTask)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { <# not mapped: the line below says so and nothing runs #> }
  if ($mapped -ne $limitedSid) { $limitedWhy = 'Windows gave the task the SID ' + $mapped + ', not ' + $limitedSid + ', which the folder''s rules name, so nothing ran.' }
  else {
    $started = Get-Date
    Start-ScheduledTask -TaskName $limitedTask
    'limited   __TOOL__ runs as NT AUTHORITY\LOCAL SERVICE (NT TASK\' + $limitedTask + '), limited, for __MINUTES__ minutes at most'
    $deadline = $started.AddMinutes(__MINUTES__ + 2)
    do {
      Start-Sleep -Seconds 2
      $t = Get-ScheduledTask -TaskName $limitedTask
      $i = Get-ScheduledTaskInfo -InputObject $t
      $ran = $i.LastRunTime -ge $started.AddSeconds(-5)
    } while (((-not $ran) -or [string]$t.State -eq 'Running' -or [string]$t.State -eq 'Queued') -and (Get-Date) -lt $deadline)
    $limitedEnded = $ran -and [string]$t.State -ne 'Running' -and [string]$t.State -ne 'Queued'
    $limitedResult = '0x{0:x}' -f [int64]$i.LastTaskResult
  }
} finally {
  try { Stop-ScheduledTask -TaskName $limitedTask -ErrorAction SilentlyContinue } catch { <# it has ended already #> }
  try { Unregister-ScheduledTask -TaskName $limitedTask -Confirm:$false -ErrorAction SilentlyContinue } catch { <# never registered: the run stopped before it #> }
}
if ($limitedWhy) { 'STOP. ' + $limitedWhy; exit 2 }
if (-not $limitedEnded) { 'STOP. the limited run had not ended after __MINUTES__ minutes and was stopped, so nothing came back.'; exit 2 }
foreach ($n in 'said.txt', 'back.zip') {
  $p = Join-Path $run $n
  if (-not (Test-Path -LiteralPath $p)) { continue }
  $it = Get-Item -LiteralPath $p -Force
  if (($it -isnot [IO.FileInfo]) -or ($it.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $it.LinkType) { 'STOP. the limited run left ' + $n + ' as a link or a folder, not a file of its own, so nothing of it was read.'; exit 2 }
}
if (-not (Test-Path -LiteralPath $limitedSaid)) { 'STOP. the limited run said nothing (the task ended with ' + $limitedResult + '), so the tool did not run.'; exit 2 }
$limitedLines = @([IO.File]::ReadAllLines($limitedSaid))
$limitedLines
if (-not @($limitedLines | Where-Object { $_ -cmatch '^EXIT -?\d+$' }).Count) { 'STOP. the limited run ended (the task ended with ' + $limitedResult + ') without saying how the tool ended.'; exit 2 }
'@
    $bytes = [Text.Encoding]::UTF8.GetPreamble() + [Text.Encoding]::UTF8.GetBytes($wrapper.Replace("`r`n", "`n").Replace("`n", "`r`n"))
    return $text.Replace('__WRAPPER64__', [Convert]::ToBase64String([byte[]]$bytes)).Replace('__MINUTES__', [string]$ThornswoodLimitedMinutes).Replace('__TOOL__', $Tool.Replace("'", "''"))
}

# -Run is the run's own folder on the box, holding tools.zip; -ServerRoot the
# game server whose plugins folder is copied; -Tool the repository path of
# the tool, a .py run by Python, a .js by node or a .ps1 by PowerShell 7
# (#3100); -Arguments what it is run with, '{data}', '{plugins}',
# '{settings}' and '{repo}' standing for the data folder, the plugin list,
# the load order settings and the repository folder of the run. The plugin
# list is the server's loadOrder as the game's plugins.txt; the load order
# settings are a server-settings.json holding that loadOrder alone, each
# plugin in the run's data folder, for the builders that read a server's
# settings (Build-NpcPopulation.py), so they read this commit's own plugins
# and not the server's copies. Each is made only when an argument names it:
# server-settings.json holds the server's secrets too, so only its loadOrder
# is read, and only the file names in it are written.
#
# FROM THE RECORD (#5191): -Order is the load order the commit records
# (ContentPaths.ps1's Get-ThornswoodContentOrder) and -Collection the box's
# store of the collection's plugins at the record's revision
# (CollectionStore.ps1). The data folder then takes the store's plugins over
# the server's, and the plugin list and settings are that order, not the
# server's: a build for a revision no server runs yet reads the revision's
# own plugins in the order it will run them. Every plugin of the order has to
# be in the data folder, or the run stops before the tool.
function Get-ThornswoodOnBoxScript {
    param(
        [Parameter(Mandatory = $true)][string]$Run,
        [Parameter(Mandatory = $true)][string]$ServerRoot,
        [Parameter(Mandatory = $true)][string]$Tool,
        [string[]]$Arguments = @(),
        [string]$ArchiveStore = $ThornswoodGameArchiveStore,
        # What the run lists and brings back when it changes: folders and
        # files of the repository, with forward slashes. Run-OnBox.ps1 adds
        # every file a step of the content chain writes outside these (#3425).
        [string[]]$Watch = @('game', 'records', 'docs/systems'),
        [string[]]$Order = @(),
        [string]$Collection = '',
        # The plugins this repository makes in game\content. The server's copy
        # of each is left out of the run's Data folder whether or not the
        # commit holds one yet: nothing generated is committed (#5191), so the
        # first step of a content build, which makes the plugin, runs from a
        # commit with no game\content at all (#6351).
        [string[]]$Own = @('Thornswood-Content.esp'),
        # Run the tool, and Make-LastPlugin.py before it, as the limited
        # account and not as the box's administrator (THE LIMITED RUN, at
        # Get-ThornswoodOnBoxLimitedScript): for a commit that is not on
        # main yet, the merge queue's (#6879).
        [switch]$Limited
    )
    foreach ($n in $Own) {
        if ($n -notmatch '^[^\\/:*?"<>|'' \r\n][^\\/:*?"<>|''\r\n]*\.(esp|esm|esl)$') { throw "$n is not a plugin name." }
    }
    $ownText = (@($Own | ForEach-Object { "'" + $_.ToLowerInvariant() + "'" }) -join ', ')
    if ([bool]$Order.Count -ne [bool]$Collection) { throw '-Order and -Collection go together: the record''s order is run with the record''s plugins.' }
    foreach ($n in $Order) {
        if ($n -notmatch '^[^\\/:*?"<>|\r\n]+\.(esp|esm|esl)$') { throw "$n is not a plugin name." }
    }
    if ($Collection -match '[''\r\n]') { throw "$Collection is not a folder this can name on the box." }
    $orderText = (@($Order | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', ')
    $fromRecord = [bool]$Order.Count
    foreach ($w in $Watch) {
        if ($w -notmatch '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$' -or $w -match '(^|/)\.\.?(/|$)') { throw "$w is not a path inside the repository to watch." }
    }
    $watchText = (@($Watch | ForEach-Object { "'" + $_.Replace('/', '\') + "'" }) -join ', ')
    $argText = (@($Arguments | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', ')
    $wantsPlugins = [bool]@($Arguments | Where-Object { $_ -like '*{plugins}*' }).Count
    $wantsSettings = [bool]@($Arguments | Where-Object { $_ -like '*{settings}*' }).Count
    $kind = [IO.Path]::GetExtension($Tool).ToLowerInvariant()
    $toolFar = $Tool.Replace('/', '\')
    $head = @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
# An error nothing below catches says what it was on a STOP line, which
# Run-OnBox.ps1 hands on, instead of ending the run with no EXIT and no
# reason (#6351).
trap { 'STOP. ' + `$_.Exception.Message + ' (run.ps1 line ' + `$_.InvocationInfo.ScriptLineNumber + ')'; exit 2 }
$(Get-ThornswoodOnBoxHoldScript -Run $Run)
$(if ($Limited) { Get-ThornswoodOnBoxLimitedStartScript -Run $Run } else { '' })
`$repo = Join-Path `$run 'repo'
`$data = Join-Path `$run 'data'
`$plugins = '$serverRoot\plugins'
if (-not (Test-Path -LiteralPath `$plugins)) { 'STOP. there is no ' + `$plugins + ' on the box.'; exit 2 }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory((Join-Path `$run 'tools.zip'), `$repo)
New-Item -ItemType Directory -Force -Path `$data | Out-Null
`$ownDir = Join-Path `$repo 'game\content'
`$ownHere = @(if (Test-Path -LiteralPath `$ownDir -PathType Container) { Get-ChildItem -LiteralPath `$ownDir -File })
`$ours = @(@($ownText) + @(`$ownHere | ForEach-Object { `$_.Name.ToLowerInvariant() }))
# Ours the commit does not hold yet: the step that makes them is this one or
# one after it, so they are in no order this run is given (#6351).
`$unmade = @(@($ownText) | Where-Object { `$n = `$_; -not @(`$ownHere | Where-Object { `$_.Name.ToLowerInvariant() -eq `$n }).Count })
foreach (`$f in @(Get-ChildItem -LiteralPath `$plugins -File)) {
  if (`$ours -notcontains `$f.Name.ToLowerInvariant()) { Copy-Item -LiteralPath `$f.FullName -Destination `$data }
}
`$collection = '$Collection'
if (`$collection) {
  if (-not (Test-Path -LiteralPath (Join-Path `$collection 'store.json') -PathType Leaf)) { 'STOP. there is no store of the collection''s plugins at ' + `$collection + ' on the box.'; exit 2 }
  `$laid = 0
  foreach (`$f in @(Get-ChildItem -LiteralPath `$collection -File | Where-Object { `$_.Name -match '\.(esp|esm|esl)`$' })) {
    if (`$ours -notcontains `$f.Name.ToLowerInvariant()) { Copy-Item -LiteralPath `$f.FullName -Destination `$data -Force; `$laid++ }
  }
}
foreach (`$f in `$ownHere) { Copy-Item -LiteralPath `$f.FullName -Destination `$data }
if (`$collection) { 'data      ' + @(Get-ChildItem -LiteralPath `$data -File).Count + ' plugin(s): ' + `$plugins + ', with the ' + `$laid + ' of the collection''s store at ' + `$collection + ' over them and this commit''s own in place of the server''s' }
else { 'data      ' + @(Get-ChildItem -LiteralPath `$data -File).Count + ' plugin(s): ' + `$plugins + ', with this commit''s own in place of the server''s' }
`$store = '$ArchiveStore'
`$linked = 0
if (Test-Path -LiteralPath `$store) {
  foreach (`$f in @(Get-ChildItem -LiteralPath `$store -File -Filter '*.bsa')) {
    `$null = New-Item -ItemType HardLink -Path (Join-Path `$data `$f.Name) -Value `$f.FullName
    `$linked++
  }
}
if (`$linked) { 'archives  ' + `$linked + ' from ' + `$store + ', linked, read only' } else { 'archives  none: ' + `$store + ' holds no Skyrim archive, so a tool that reads one stops' }
`$pack = Join-Path `$store '$ThornswoodScriptPack'
if (Test-Path -LiteralPath `$pack) {
  `$null = New-Item -ItemType HardLink -Path (Join-Path `$data '$ThornswoodScriptPack') -Value `$pack
  'scripts   $ThornswoodScriptPack from ' + `$store + ', linked, read only'
} else { 'scripts   none: ' + `$store + ' holds no $ThornswoodScriptPack, so a tool that reads the scripts stops' }
`$storeStrings = Join-Path `$store 'Strings'
`$linkedStrings = 0
if (Test-Path -LiteralPath `$storeStrings) {
  `$dataStrings = Join-Path `$data 'Strings'
  New-Item -ItemType Directory -Force -Path `$dataStrings | Out-Null
  foreach (`$f in @(Get-ChildItem -LiteralPath `$storeStrings -File)) {
    `$null = New-Item -ItemType HardLink -Path (Join-Path `$dataStrings `$f.Name) -Value `$f.FullName
    `$linkedStrings++
  }
}
if (`$linkedStrings) { 'strings   ' + `$linkedStrings + ' loose string table(s) from ' + `$storeStrings + ', linked, read only' }
`$pluginList = Join-Path `$run 'plugins.txt'
`$orderSettings = Join-Path `$run 'server-settings.json'
`$orderFrom = '$ServerRoot\server-settings.json'
if (`$$fromRecord) {
  `$orderFrom = 'the load order this commit records'
  `$names = @(@($orderText) | Where-Object { `$unmade -notcontains `$_.ToLowerInvariant() })
  if (`$unmade.Count) { 'unmade    ' + (`$unmade -join ', ') + ': not in this commit yet, so left out of ' + `$orderFrom }
  `$missing = @(`$names | Where-Object { -not (Test-Path -LiteralPath (Join-Path `$data `$_) -PathType Leaf) })
  if (`$missing.Count) { 'STOP. ' + `$missing.Count + ' plugin(s) of ' + `$orderFrom + ' are in neither ' + `$plugins + ' nor ' + `$collection + ': ' + (`$missing -join ', '); exit 2 }
} elseif (`$$wantsPlugins -or `$$wantsSettings) {
  try { `$order = @(([IO.File]::ReadAllText(`$orderFrom) | ConvertFrom-Json).loadOrder) } catch { `$order = @() }
  `$names = @(`$order | ForEach-Object { [IO.Path]::GetFileName([string]`$_) } | Where-Object { `$_ })
  if (-not `$names.Count) { 'STOP. ' + `$orderFrom + ' names no loadOrder, so there is no load order to give the tool.'; exit 2 }
}
if (`$$wantsPlugins) {
  `$masters = @('skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm')
  `$lines = @(`$names | Where-Object { `$masters -notcontains `$_.ToLowerInvariant() } | ForEach-Object { '*' + `$_ })
  [IO.File]::WriteAllLines(`$pluginList, [string[]]`$lines, (New-Object Text.UTF8Encoding(`$false)))
  'plugins   ' + `$lines.Count + ' line(s) in plugins.txt: ' + `$(if (`$$fromRecord) { `$orderFrom } else { 'the loadOrder of ' + `$orderFrom }) + ' after the five masters'
}
if (`$$wantsSettings) {
  `$inData = @(`$names | ForEach-Object { (Join-Path `$data `$_).Replace('\', '/') })
  [IO.File]::WriteAllText(`$orderSettings, (ConvertTo-Json -InputObject @{ loadOrder = [string[]]`$inData } -Depth 3), (New-Object Text.UTF8Encoding(`$false)))
  'settings  ' + `$inData.Count + ' plugin(s) in server-settings.json: ' + `$(if (`$$fromRecord) { `$orderFrom + ', in the run''s data folder' } else { 'the loadOrder of ' + `$orderFrom + ', in the run''s data folder, and nothing else of it' })
}

# python.exe itself, named by the py launcher: run through py, a quoted
# path arrived with a space in front of it and Python could not open it.
# Named for every tool, because Rebuild-ContentTables.ps1 runs Python
# builders too: it goes first on the PATH the tool is given.
`$launcher = Get-Command py -CommandType Application -EA SilentlyContinue | Select-Object -First 1
if (-not `$launcher) { 'STOP. there is no Python launcher (py) on the box.'; exit 2 }
`$python = (& `$launcher.Source -3 -c 'import sys; print(sys.executable)' | Select-Object -First 1)
if (-not `$python -or -not (Test-Path -LiteralPath `$python)) { 'STOP. py -3 named no Python on the box.'; exit 2 }
`$env:PATH = (Split-Path -Parent `$python) + ';' + `$env:PATH
`$words = @()
switch ('$kind') {
  '.py' { `$exe = `$python }
  '.js' {
    `$c = Get-Command node -CommandType Application -EA SilentlyContinue | Select-Object -First 1
    if (-not `$c) { 'STOP. there is no node on the box.'; exit 2 }
    `$exe = `$c.Source
  }
  '.ps1' {
    `$c = Get-Command pwsh -CommandType Application -EA SilentlyContinue | Select-Object -First 1
    if (-not `$c) { 'STOP. there is no PowerShell 7 (pwsh) on the box.'; exit 2 }
    `$exe = `$c.Source
    `$words = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File')
  }
  default { 'STOP. ' + '$Tool' + ' is not a .py, .js or .ps1 tool.'; exit 2 }
}
`$given = @($argText)
`$words += '"' + (Join-Path `$repo '$toolFar') + '"'
foreach (`$a in `$given) { `$words += '"' + `$a.Replace('{data}', `$data).Replace('{plugins}', `$pluginList).Replace('{settings}', `$orderSettings).Replace('{repo}', `$repo) + '"' }
"@
    $partB = @"
`$sha = [Security.Cryptography.SHA256]::Create()
function Hashes {
  `$h = @{}
  foreach (`$top in $watchText) {
    `$d = Join-Path `$repo `$top
    if (-not (Test-Path -LiteralPath `$d)) { continue }
    `$files = `$(if (Test-Path -LiteralPath `$d -PathType Leaf) { @(Get-Item -LiteralPath `$d) } else { @(Get-ChildItem -LiteralPath `$d -File -Recurse) })
    foreach (`$f in `$files) {
      `$rel = `$f.FullName.Substring(`$repo.Length + 1).Replace('\', '/')
      `$s = [IO.File]::OpenRead(`$f.FullName)
      try { `$h[`$rel] = [BitConverter]::ToString(`$sha.ComputeHash(`$s)) } finally { `$s.Close() }
    }
  }
  return `$h
}
`$before = Hashes
# Thornswood-Last.esp is this commit's, made from its recipe out of the run's
# data folder (#2791): the plugin is not in the repository, so what the copy
# above put there is the server's, made from whichever recipe it last
# deployed. When this commit's recipe does not make it here (a plugin it
# reads is another copy, the content plugin of a pull request), the server's
# stays and the line says so; Build-LastPlugin.py makes this commit's. It is
# for a tool that reads the plugin a build made, as Build-StationSites.py
# measures over the build it lays: the content chain's steps before
# Build-LastPlugin.py are not given it in their order (Rebuild-ContentTables.ps1,
# #5191), and that step writes the plugin it makes over this one, for the
# steps after it.
`$lastRecipe = Join-Path `$repo 'game\data\last-plugin.recipe'
if (Test-Path -LiteralPath `$lastRecipe) {
  `$lastSaid = @(& `$python (Join-Path `$repo 'scripts\mods\Make-LastPlugin.py') --data `$data --recipe `$lastRecipe 2>&1 | ForEach-Object { "`$_".Trim() } | Where-Object { `$_ })
  if (`$LASTEXITCODE -eq 0) { 'last      Thornswood-Last.esp made from this commit''s recipe: ' + (`$lastSaid -join ' ') }
  else { 'last      Thornswood-Last.esp is the server''s copy, because this commit''s recipe does not make it here: ' + (`$lastSaid -join ' ') }
}
`$env:THORNSWOOD_DATA = `$data
`$env:PYTHONUTF8 = '1'
`$env:PYTHONIOENCODING = 'utf-8'
`$env:PYTHONDONTWRITEBYTECODE = '1'
`$out = Join-Path `$run 'out.txt'
`$err = Join-Path `$run 'err.txt'
`$p = Start-Process -FilePath `$exe -ArgumentList `$words -WorkingDirectory `$repo -NoNewWindow -PassThru -RedirectStandardOutput `$out -RedirectStandardError `$err
# Taking the handle now is what keeps ExitCode: without it, a process
# Start-Process started reports none once it has ended.
`$null = `$p.Handle
try { `$p.PriorityClass = 'BelowNormal' } catch { 'priority left as it was: ' + `$_.Exception.Message }
`$p.WaitForExit()
`$code = `$p.ExitCode
'-------- $tool --------'
Get-Content -LiteralPath `$out -Encoding UTF8
Get-Content -LiteralPath `$err -Encoding UTF8
'-------- end --------'

`$after = Hashes
`$changed = @(`$after.Keys | Where-Object { `$before[`$_] -ne `$after[`$_] } | Sort-Object)
if (`$changed.Count) {
  `$zip = [IO.Compression.ZipFile]::Open((Join-Path `$run 'back.zip'), 'Create')
  try { foreach (`$c in `$changed) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(`$zip, (Join-Path `$repo `$c.Replace('/', '\')), `$c) } } finally { `$zip.Dispose() }
}
foreach (`$c in `$changed) { 'CHANGED ' + `$c }
'EXIT ' + `$code
"@
    if (-not $Limited) { return $head + "`n`n" + $partB }
    return $head + "`n`n" + (Get-ThornswoodOnBoxLimitedScript -Run $Run -Tool $Tool -PartB $partB)
}

# The run's folder lives as long as one far process, the keeper's (#2999).
# Until 21 Oct 2026 the folder was made by one ssh call and removed by
# another at the end, so a run cut before that call (a bridge reset, the
# machine running it going away) left the folder on the box for good, with
# its 383 MB copy of the plugins, and nothing there ever removed it. Now:
#
#   - <run>.lock, beside the folder, is held for as long as the run is going:
#     by this script from before the folder exists until it is removed, and by
#     the run itself (above) while the tool runs. Windows lets go of a handle
#     when its process ends however it ends.
#   - The keeper waits on a named event of its own, $End, made here (a name
#     somebody made first is refused before anything else is done). When it
#     is set, which Close-ThornswoodOnBoxFolder does from a second ssh
#     session, it removes the folder itself and says GONE. Until 21 Oct it
#     waited for its standard input to close, and on the box that never
#     came: sshd passes on nothing written or closed after a session starts
#     (#2912, #3059), so every Close waited for good (#3063). The named
#     event is how the secret proof's watcher is stopped there (#2912).
#   - A folder whose lock nobody holds belongs to a run that is over, so before
#     it makes its own, this removes every such thornswood-onbox-* folder
#     beside it: a folder whose keeper was ended (the box restarting), and
#     one from before the lock (it has none). A folder whose lock is held
#     is a run still going, and is left alone. No age and no time limit decide
#     it: only whether the process that owns the folder is still there.
#   - It also ends when its caller is gone without setting the event (the
#     machine running it going away, a bridge reset). A far process outlives
#     its ssh session on the box (#3059), so the session ending tells it
#     nothing by itself; what does is a write to its standard output, which
#     fails (Win32 error 232) from the moment its session is over (measured
#     on the box 21 Oct 2026, #3063). So while it waits it writes a bare line
#     end every five seconds with WriteFile itself, and when that write fails
#     it removes the folder as if its event had been set. Not through .NET's
#     console stream: that one swallows a broken pipe and reports the write
#     as made. A bare line end is nothing to anybody reading what it says.
#
# Removing takes the lock alone (shared for deleting only, so it can delete
# the lock while it holds it; Windows lets the file go when the handle
# closes), so the run and its keeper, and two runs sweeping at once, never
# remove a folder another holds. Lines out: GONE <folder>, HELD
# <folder>: why (still in use), LEFT <folder>: why (could not be removed),
# MADE <folder> once this run's own is there, and TAKEN <name> when its event
# was made by somebody else first. Each is written and flushed as it happens,
# because Run-OnBox.ps1 waits for MADE while this waits for its end. Short
# enough for the command line on purpose
# (Start-ThornswoodRemote): a script sent as a file first would be one more
# thing on the box a cut session leaves.
function Get-ThornswoodOnBoxKeepScript([Parameter(Mandatory = $true)][string]$Run, [Parameter(Mandatory = $true)][string]$End) {
    if ($End -notmatch '^Global\\Thornswood-OnBoxEnd-[0-9a-f]{32}$') { throw ('not a keeper''s end event: ' + $End) }
    return @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
`$run = '$Run'
`$top = Split-Path -Parent `$run
function Say([string]`$l) { [Console]::Out.WriteLine(`$l); [Console]::Out.Flush() }
`$made = `$false
`$end = [Threading.EventWaitHandle]::new(`$false, [Threading.EventResetMode]::ManualReset, '$End', [ref]`$made)
if (-not `$made) { Say ('TAKEN $End'); exit 2 }
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class ThornswoodKeeperOut{[DllImport("kernel32.dll")]static extern IntPtr GetStdHandle(int n);[DllImport("kernel32.dll",SetLastError=true)]static extern bool WriteFile(IntPtr h,byte[] b,int n,out int d,IntPtr o);public static int Beat(){byte[] b={10};int d;return WriteFile(GetStdHandle(-11),b,1,out d,IntPtr.Zero)?0:Marshal.GetLastWin32Error();}}'
function Drop([string]`$d) {
  try { `$h = New-Object IO.FileStream((`$d + '.lock'), 'OpenOrCreate', 'ReadWrite', 'Delete') }
  catch { Say ('HELD ' + `$d + ': ' + `$_.Exception.GetBaseException().Message); return }
  try {
    if (Test-Path -LiteralPath `$d) { Remove-Item -LiteralPath `$d -Recurse -Force }
    [IO.File]::Delete(`$d + '.lock')
    Say ('GONE ' + `$d)
  } catch { Say ('LEFT ' + `$d + ': ' + `$_.Exception.Message) } finally { `$h.Dispose() }
}
`$seen = @{}
foreach (`$f in @(Get-ChildItem -LiteralPath `$top -Filter 'thornswood-onbox-*' -Force)) {
  if (`$f.Name -notmatch '^(thornswood-onbox-[0-9a-f]{12})(\.lock)?`$') { continue }
  `$d = Join-Path `$top `$Matches[1]
  if (`$d -eq `$run -or `$seen[`$d]) { continue }
  `$seen[`$d] = 1
  Drop `$d
}
`$own = New-Object IO.FileStream((`$run + '.lock'), 'CreateNew', 'ReadWrite', 'ReadWrite')
New-Item -ItemType Directory -Path `$run | Out-Null
Say ('MADE ' + `$run)
while (-not `$end.WaitOne(5000)) { if ([ThornswoodKeeperOut]::Beat()) { break } }
`$own.Dispose()
Drop `$run
`$end.Dispose()
"@
}

# What the second ssh session runs to end a keeper: sets its event. Says END
# SET, or END GONE when no keeper holds that event any more.
function Get-ThornswoodOnBoxEndScript([Parameter(Mandatory = $true)][string]$End) {
    if ($End -notmatch '^Global\\Thornswood-OnBoxEnd-[0-9a-f]{32}$') { throw ('not a keeper''s end event: ' + $End) }
    return "`$e = `$null; if ([Threading.EventWaitHandle]::TryOpenExisting('$End', [ref]`$e)) { [void]`$e.Set(); `$e.Dispose(); 'END SET' } else { 'END GONE' }"
}

# A folder of its own on the box for one run, held by its keeper until
# Close-ThornswoodOnBoxFolder ends it (above). Needs Send-Script.ps1 loaded.
# Hands back Run (the folder, Windows form), Far (with forward slashes, for
# scp), Made, Keeper (the ssh process), Said (what the keeper's sweep of
# earlier folders said before MADE), Rest (the read of what it says after),
# and End, Target and SshArgs for the close. Made false means there is no folder: the caller stops, and still
# hands this to Close-ThornswoodOnBoxFolder.
function Open-ThornswoodOnBoxFolder {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [string[]]$SshArgs = @()
    )
    $run = 'C:\Windows\Temp\thornswood-onbox-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
    # A name nobody can know ahead of the run, so nobody makes it first.
    $end = 'Global\Thornswood-OnBoxEnd-' + [Guid]::NewGuid().ToString('N')
    # The keeper first: it removes what earlier runs left, then makes this
    # run's folder and holds it until its event is set.
    $keeper = Start-ThornswoodRemote -Target $Target -SshArgs $SshArgs -Script (Get-ThornswoodOnBoxKeepScript -Run $run -End $end)
    $said = @()
    $made = $false
    while ($null -ne ($l = $keeper.StandardOutput.ReadLine())) {
        $l = $l.Trim()
        if ($l -eq ('MADE ' + $run)) { $made = $true; break }
        if ($l) { $said += $l }
    }
    # The rest is read as it comes, so the keeper's line ends while it waits
    # never fill the pipe and stop it at a write.
    $rest = $keeper.StandardOutput.ReadToEndAsync()
    return [pscustomobject]@{ Run = $run; Far = $run.Replace('\', '/'); Made = $made; Keeper = $keeper; Said = $said; Rest = $rest; End = $end; Target = $Target; SshArgs = $SshArgs }
}

# Tells the keeper the run is over: a second ssh session sets its event, and
# it removes the folder, says GONE and ends, and its ssh with it. The event is
# set even when the keeper's ssh here has already ended, since on the box the
# keeper outlives its session (#3059). When it could not be set, nothing will
# end that keeper's ssh here, so it is ended, and what the set said is handed
# back with the rest. Hands back Gone (the keeper said its folder is gone, or
# there was none), Told (the event was set, or no keeper holds it any more)
# and Said (the keeper's last lines, then the set's).
function Close-ThornswoodOnBoxFolder([Parameter(Mandatory = $true)]$Folder) {
    $k = $Folder.Keeper
    $told = @(Invoke-ThornswoodRemote -Target $Folder.Target -SshArgs $Folder.SshArgs -Script (Get-ThornswoodOnBoxEndScript -End $Folder.End) 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    if (-not $k.HasExited -and -not ($told -contains 'END SET')) {
        # With the bridge's node under it on One: the whole tree where .NET
        # can (PowerShell 7), the ssh alone where it cannot (5.1).
        if ($PSVersionTable.PSVersion.Major -ge 6) { $k.Kill($true) } else { $k.Kill() }
    }
    $said = @($Folder.Rest.Result -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $k.WaitForExit()
    return [pscustomobject]@{ Gone = ((-not $Folder.Made) -or ($said -contains ('GONE ' + $Folder.Run))); Told = (($told -contains 'END SET') -or ($told -contains 'END GONE')); Said = @($said + @($told | Where-Object { $_ -ne 'END SET' })) }
}
