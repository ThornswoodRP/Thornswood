<#
  Install-ThornswoodServer.ps1

  Run this ON THE VPS, after Bootstrap-VPS.ps1, as Administrator.

  Unpacks the payload beside the running server, checks it there, and only
  then stops the server, swaps the new folder in and starts it. Registers a
  scheduled task so the server comes back after a reboot.

  Why a scheduled task rather than a real service: node.exe is not a service
  binary, so New-Service cannot drive it, and NSSM is not installed. A task with
  an "at startup" trigger and "run whether logged on or not" is built into
  Windows and does the same job. The cost is that it does not restart on crash
  by itself, which is what -RestartOnFailure adds via a second repeating trigger.

  STAGED, CHECKED, THEN SWAPPED, issue #446: "A failed publish deletes the live
  server before checking the new one". Until 28 September this stopped the
  server, deleted the whole root, unpacked the payload into the empty folder,
  and only then checked the load order, so a payload naming a plugin it did
  not carry left no server at all, and Publish-Server said "Nothing local was
  changed". Now, in this order:

    1. The zip is held to the hash it left the laptop with (-ZipSha256) and
       unpacked into <root>.stage-<stamp>, beside the root. The load order is
       resolved there, with the root's own prefix mapped onto the stage,
       gamemode.js is parsed, and every server file the fork builds (the
       binary, the JavaScript half and the rest ServerBuild.ps1 names, beside
       this script) is held to server-build.json (#1214). Anything wrong
       clears the stage, says INSTALL REFUSED and exits 1, with nothing
       stopped.
    2. The server is stopped, the root is renamed to <root>.prev-<stamp> and
       the stage to the root, and the world, the roster, the runtime data and
       the logs are carried across (below).
    3. It is started, and has -Wait seconds to answer on its game port and its
       resources port (left off, the shared ceiling in ServerReadyWait.ps1,
       #1938). If it does not, it is stopped, what was carried goes
       back, the new folder is renamed <root>.failed-<stamp>, the previous one
       comes back as the root and is started again: INSTALL ROLLED BACK, exit 1.

  THE SETTINGS THE SERVER RUNS ARE ITS OWN, issue #1222. The payload's
  server-settings.json is the build's, not the server's: on 29 September a
  dev publish came up with thornswoodServer, thornswoodLoadOrderRefuse and
  thornswoodRequirePass empty and an npcSettings "default" key that refused
  every NPC. So in step 1 the stage's settings are made from the running
  server's own, with only the keys a release is meant to change taken from
  the payload (ServerSettings.ps1, beside this script, says which and why).
  After the swap in step 2 the new root's settings are read back against the
  file the old server had, and any other key that differs puts the previous
  folder back before anything is started: INSTALL ROLLED BACK. A put-back
  carries the running settings into the folder it brings back the same way.

  THE JOIN PASS SWITCH IS TRUE OR FALSE, OR NOTHING IS STOPPED (#1804). The
  gamemode holds every session until its join pass arrives unless
  thornswoodRequirePass is false, so a missing or odd value reads as on
  (#1319), and a server with such a value would start holding the moment a
  new gamemode reached it, with nobody having asked. In step 1 a stage whose
  settings hold neither true nor false is refused, a running server's and a
  first install's alike, and the reason names -RequirePass on|off, which
  Publish-Server.ps1 passes here and this sets over the running server's (or
  into the payload's, on a first install) and lets the read-back find moved.
  No build carries the switch (#1223), so a first install always needs it.
  Deploy-Server.ps1 and Deploy-DevGamemode.ps1 refuse the same way.

  A LOAD ORDER THAT DROPS WHAT THE SERVER LOADS IS REFUSED (#2320). On
  5 Oct at 9:56 PM a dev publish of a fresh engine build carried the engine's
  own order, the five base masters, and this took it over the 48 plugins the
  dev server ran, because every plugin it named was there. In step 1 the
  stage's order is held to the running server's: one that leaves out any
  plugin the running order has is refused, unless -DropPlugins names each
  one (Publish-Server.ps1 -DropPlugins passes it; ServerSettings.ps1,
  Test-ThornswoodLoadOrderDrop, says why). A first install has no running
  order and a put-back brings an order that ran, so neither is held to it.

  The newest two .prev folders are kept, and the last .failed one to read.
  -PutBack puts the newest .prev folder back the same way, keeping what it
  took out as <root>.undone-<stamp>. The renames keep every path the task and
  server-settings.json name the same, so nothing has to be rewritten.

  -FromStore TAKES THE SERVER BUILD OUT OF THE BOX'S STORE (#459). The
  payload Publish-Server.ps1 -FromStore sends carries no server build and no
  plugins: the gamemode and its stamp, server-build.json (the record the
  commit holds), the settings a release sets (how many it holds, and the
  port, read only) and any plugin of ours the running order names. In step 1
  the record's build is taken out of the store (-Store, C:\Thornswood-Deploys
  \server) into the stage, held to the record exactly as a payload's own
  files are (Expand-ThornswoodStoredServerBuild, ServerBuild.ps1), and every
  plugin the running server's load order names under its plugins folder that
  the payload did not bring is copied from the running root. The running
  server keeps its own load order and start point, so it goes onto a running
  server only, never a first install; an engine that reads light plugins
  another way than the running one would move every form id in that order
  (ServerOrder.ps1, #1715), so that is refused too; and a plugin of ours the
  order does not name is refused, because changing the order is a full
  publish's. Everything after is the same stage, swap and way back.

  -TaskOnly REGISTERS THE TASK AGAIN AND NOTHING ELSE (#2491). No zip, no
  stage, no swap, no setting: the server already in -Root is stopped, the
  task is registered with this installer's action and settings, with the
  log writer that action runs (server-log.js, #2349) put in the root beside
  it, and the server is started through it and given -Wait seconds to
  answer on both ports. If it does not answer, the task it had goes back, exactly as it was
  exported, and is started again: INSTALL ROLLED BACK. It is how a box takes a
  change to the task itself (its priority, #2491) without a release.
  Publish-Server.ps1 -TaskOnly sends this and runs it.
#>
[CmdletBinding()]
param(
    [string]$Zip      = 'C:\thornswood-server.zip',
    [string]$Root     = 'C:\Thornswood-Server',
    [string]$TaskName = 'Thornswood Server',
    [switch]$NoTask,          # unpack only, start it by hand
    [switch]$StartNow,
    # The SHA-256 of the zip as it left the laptop. Publish-Server passes it;
    # an exit code from scp says a copy ended, not what arrived.
    [string]$ZipSha256 = '',
    # Start with no world. The old one is not deleted: it stays in the .prev
    # folder the old root becomes, for as long as that is kept.
    [switch]$FreshWorld,
    # Put the newest <root>.prev-<stamp> back as the root, checked the same way.
    [switch]$PutBack,
    # How long a started server has to answer before the previous one goes back.
    # Left off, the shared ceiling in ServerReadyWait.ps1, derived from
    # measured Live and Dev starts (#1938). A start that never answers still
    # rolls back.
    [int]$Wait,
    # thornswoodRequirePass for the server this installs: on holds a session
    # until its join pass arrives, off lets it act meanwhile. Set over the
    # running server's, or into a first install's; left off, the running
    # server keeps its own, and a server with neither true nor false is
    # refused (#1804, see the header). Publish-Server.ps1 -RequirePass passes it.
    [ValidateSet('', 'on', 'off')]
    [string]$RequirePass = '',
    # The plugins this install may leave out of the running server's load
    # order (#2320), as base64 of the names one to a line, because a name with
    # a space does not survive the ssh command line Publish-Server.ps1 runs
    # this on. Publish-Server.ps1 -DropPlugins writes it. Left off, an order
    # that drops any plugin the running server loads is refused.
    [string]$DropPlugins = '',
    # How many <root>.prev-<stamp> folders to keep.
    [int]$Keep = 2,
    # Register the task again for the server already in -Root, stop it and
    # start it through the new task, and touch no file (#2491, the header).
    [switch]$TaskOnly,
    # Take the server build out of the box's store instead of the payload, and
    # the plugins from the running root (#459, the header). Publish-Server.ps1
    # -FromStore passes it.
    [switch]$FromStore,
    # The store's server folder, for -FromStore.
    [string]$Store = 'C:\Thornswood-Deploys\server',
    # With -FromStore: Thornswood-Last.esp, made on the box from this commit's
    # recipe by the publish (#2791, LastPluginOnBox.ps1), and its sha256 as
    # game\data\last-plugin.json names it. It goes into the stage in place of
    # the running server's, held to that sha256 here.
    [string]$LastPlugin = '',
    [string]$LastSha256 = '',
    # Register the task as SYSTEM, Highest, the way it was before #2578, and
    # grant nothing. The way back if the server will not run as LOCAL SERVICE
    # (ServiceAccount.ps1 says what it is given).
    [switch]$AsSystem,
    # Lets tests\test-install-server.ps1 run this on a developer's machine, a
    # workstation, against a scratch root. Nothing else passes it.
    [switch]$AllowGamingPc
)

$ErrorActionPreference = 'Stop'

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
    if ($notBox) { throw ($notBox + '. Nothing was changed.') }
}
if (-not $PutBack -and -not $TaskOnly -and -not (Test-Path -LiteralPath $Zip)) { throw "not found: $Zip" }

# A shell started before the bootstrap installed Node carries the old PATH, and
# every SSH and RDP session inherits it, so "open a new window" is advice that
# does not survive contact with remote administration. Pick the machine and user
# PATH up from the registry instead and only complain if Node is genuinely absent.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { Write-Host 'picked Node up from the machine PATH' -ForegroundColor DarkGray }
}
if (-not $node) {
    throw 'node is not installed. Run Bootstrap-VPS.ps1 on this machine first.'
}
Write-Host ("node {0}  at {1}" -f (& node --version), $node.Source) -ForegroundColor DarkGray

$Root     = $Root.TrimEnd('\')
$parent   = Split-Path -Parent $Root
$leaf     = Split-Path -Leaf $Root
$stamp    = Get-Date -Format 'yyyyMMdd-HHmmss'
$stageDir = "$Root.stage-$stamp"

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }
# The one way out. A hold this run wrote when it stopped the server (#5155,
# StopServer) goes here, whatever the outcome: started and answering, rolled
# back, or given up on and left to the watchdog.
$script:heldTask = ''
$script:openTrace = $null
function Finish([string]$marker, [int]$code) {
    # The trace of who opens the server's folder (#5211) is stopped on every
    # way out, read or not. Remove-ThornswoodOpenTrace is in the
    # StopAndMove.ps1 copy below, loaded before anything starts the trace.
    if ($script:openTrace) { Remove-ThornswoodOpenTrace $script:openTrace; $script:openTrace = $null }
    if ($script:heldTask) { Say (Clear-ThornswoodHold -Target $script:heldTask) 'DarkGray' }
    Write-Host ''; Write-Host $marker; exit $code
}

# Which settings come from the payload and which stay the server's: beside
# this script, where Publish-Server sends it and where the repository keeps it.
$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$settingsLib = Join-Path $here 'ServerSettings.ps1'
if (-not (Test-Path -LiteralPath $settingsLib)) {
    Say "ServerSettings.ps1 is not beside this installer, so the running server's settings could not be carried across. Nothing was changed." 'Red'
    Finish 'INSTALL REFUSED' 1
}
. $settingsLib
# What this run asked the settings to become (#1804): the join pass switch,
# when -RequirePass was given. A put-back carries the running server's
# settings into the folder it brings back and sets nothing, so asking with
# it would be a switch that does nothing; it is refused instead.
$asked = New-Object PSObject -Property (New-ThornswoodAsked $RequirePass)
$askedKeys = @(Get-ThornswoodSettingNames $asked)
$passScript = '.\scripts\release\Publish-Server.ps1'
$dropNames = @()
try { $dropNames = @(ConvertFrom-ThornswoodNamesArg $DropPlugins) }
catch { Say "-DropPlugins does not read as the names Publish-Server.ps1 sends: $($_.Exception.Message). Nothing was changed." 'Red'; Finish 'INSTALL REFUSED' 1 }
if ($PutBack -and $dropNames.Count) {
    Say '-PutBack brings back an order the server ran and drops nothing on purpose, so it does not take -DropPlugins. Nothing was changed.' 'Red'
    Finish 'INSTALL REFUSED' 1
}
if ($PutBack -and $askedKeys.Count) {
    Say '-PutBack sets no setting: it puts the previous folder back with the running server''s own settings. Run it without -RequirePass. Nothing was changed.' 'Red'
    Finish 'INSTALL REFUSED' 1
}
# -FromStore installs a build onto a running server (#459); a put-back and
# -TaskOnly install none.
if ($FromStore -and ($PutBack -or $TaskOnly)) {
    Say '-FromStore installs a server build out of the store, and -PutBack and -TaskOnly install none. Nothing was changed.' 'Red'
    Finish 'INSTALL REFUSED' 1
}
# -TaskOnly touches the task and nothing else (#2491), so a switch that
# changes a folder, a setting or the world would do nothing, and is refused.
if ($TaskOnly) {
    $with = @()
    if ($PutBack) { $with += '-PutBack' }
    if ($NoTask) { $with += '-NoTask' }
    if ($FreshWorld) { $with += '-FreshWorld' }
    if ($askedKeys.Count) { $with += '-RequirePass' }
    if ($dropNames.Count) { $with += '-DropPlugins' }
    if ($with.Count) {
        Say ('-TaskOnly registers the task again and changes no file or setting, so it does not take ' + ($with -join ', ') + '. Nothing was changed.') 'Red'
        Finish 'INSTALL REFUSED' 1
    }
    if (-not $StartNow) {
        Say '-TaskOnly stops the server to register its task again, so it takes -StartNow to start it again. Nothing was changed.' 'Red'
        Finish 'INSTALL REFUSED' 1
    }
}
# Which server files the record holds, and holding them (#1214): beside this
# script too, sent with it.
$buildLib = Join-Path $here 'ServerBuild.ps1'
if (-not (Test-Path -LiteralPath $buildLib)) {
    Say "ServerBuild.ps1 is not beside this installer, so the payload's server files could not be held to their record. Nothing was changed." 'Red'
    Finish 'INSTALL REFUSED' 1
}
. $buildLib
# The record contracts (#2180, slice 4): beside this script too, sent with it
# (Read-JsonFile.ps1 and RecordShape.ps1), or in scripts\release when it runs
# from a checkout. Without them a broken settings file or record would be read
# as whatever ConvertFrom-Json made of it, so nothing runs.
$shapeDir = $here
if (-not (Test-Path -LiteralPath (Join-Path $here 'RecordShape.ps1'))) { $shapeDir = Join-Path $here '..\release' }
foreach ($lib in 'Read-JsonFile.ps1', 'RecordShape.ps1') {
    if (-not (Test-Path -LiteralPath (Join-Path $shapeDir $lib))) {
        Say "$lib is not beside this installer, so the payload's settings and record could not be held to their shape. Nothing was changed." 'Red'
        Finish 'INSTALL REFUSED' 1
    }
}
. (Join-Path $shapeDir 'Read-JsonFile.ps1')
. (Join-Path $shapeDir 'RecordShape.ps1')
# How long a start may take to answer on both ports (#1938): beside this
# script too, sent with it. Without it there is no ceiling, so nothing runs.
$waitLib = Join-Path $here 'ServerReadyWait.ps1'
if (-not (Test-Path -LiteralPath $waitLib)) {
    Say "ServerReadyWait.ps1 is not beside this installer, so how long a start may take to answer has no source. Nothing was changed." 'Red'
    Finish 'INSTALL REFUSED' 1
}
. $waitLib
# The account the task runs as and what it may reach (#2578). A copy of the
# functions in ServiceAccount.ps1, kept here rather than sent beside this
# installer, because every file Publish-Server.ps1 sends is a call in
# records\remote-commands.json. tests\test-2578-service-principals.ps1 fails
# when this copy and ServiceAccount.ps1 differ.
# ---- ServiceAccount.ps1 (copy) ----
function New-ThornswoodServicePrincipal {
    param([switch]$AsSystem)
    if ($AsSystem) {
        return New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    }
    return New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited `
        -RequiredPrivilege 'SeChangeNotifyPrivilege' -ProcessTokenSidType Unrestricted
}
function Get-ThornswoodTaskSid {
    param([string]$TaskName)
    try {
        return (New-Object Security.Principal.NTAccount('NT TASK', $TaskName)).Translate([Security.Principal.SecurityIdentifier]).Value
    } catch { return '' }
}
function Get-ThornswoodServiceNeverReach {
    param([string]$Own = '', [string]$Box = 'C:\')
    $own = $Own.TrimEnd('\')
    $list = @(foreach ($n in 'Thornswood-Backup', 'Thornswood-Deploys', 'Thornswood-Watch') { Join-Path $Box $n })
    foreach ($r in 'Thornswood-Server', 'Thornswood-Server-Dev') {
        $r = Join-Path $Box $r
        if ($r -ine $own) { $list += (Join-Path $r 'private') }
    }
    foreach ($r in 'Thornswood-Voice', 'Thornswood-Voice-Dev') {
        $r = Join-Path $Box $r
        if ($r -ine $own) { $list += (Join-Path $r 'token-key.txt') }
    }
    return $list
}
function Test-ThornswoodServiceCannotReach {
    param([string[]]$Paths, [string[]]$Sids = @())
    $who = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-19') + @($Sids | Where-Object { $_ })
    # ReadData (ListDirectory on a folder), GENERIC_READ and GENERIC_ALL.
    $read = [long]0x90000001
    $problems = @()
    foreach ($p in @($Paths)) {
        if (-not $p) { continue }
        # A denied look is an error, not a no: without Stop, Test-Path says
        # False and the path would be passed over as if it were not there.
        try { if (-not (Test-Path -LiteralPath $p -ErrorAction Stop)) { continue } }
        catch { $problems += ($p + ': whether it is there could not be checked (' + $_.Exception.Message + ')'); continue }
        try { $acl = Get-Acl -LiteralPath $p }
        catch { $problems += ($p + ': its rules could not be read (' + $_.Exception.Message + ')'); continue }
        foreach ($r in @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) {
            if ([string]$r.AccessControlType -ne 'Allow') { continue }
            if ($who -notcontains $r.IdentityReference.Value) { continue }
            if (([long][int]$r.FileSystemRights -band $read) -eq 0) { continue }
            $problems += ($p + ': ' + $r.IdentityReference.Value + ' may read it (' + $r.FileSystemRights + ')')
        }
    }
    # Unrolled: callers wrap it in @(), so none is a count of 0.
    return $problems
}
function Set-ThornswoodServiceAcl {
    param([string]$Path, $Acl)
    $item = Get-Item -LiteralPath $Path -Force
    if ($item -is [IO.DirectoryInfo]) { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]$item, [Security.AccessControl.DirectorySecurity]$Acl) }
    else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, [Security.AccessControl.FileSecurity]$Acl) }
}
function Grant-ThornswoodServiceFolder {
    param([string]$Root, [string]$Sid, [string[]]$Writable = @(), [string[]]$Files = @())
    if (-not $Root -or -not (Test-Path -LiteralPath $Root)) { throw ('not here: ' + $Root) }
    if (-not $Sid) { throw 'no SID to grant to' }
    $fsr  = [Security.AccessControl.FileSystemRights]
    $inh  = [Security.AccessControl.InheritanceFlags]
    $prop = [Security.AccessControl.PropagationFlags]
    $tree = $inh::ContainerInherit -bor $inh::ObjectInherit
    $who  = New-Object Security.Principal.SecurityIdentifier($Sid)
    $made = New-Object Security.Principal.SecurityIdentifier('S-1-3-0')
    $said = @()

    $acl = Get-Acl -LiteralPath $Root
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($who, $fsr::ReadAndExecute, $tree, $prop::None, 'Allow')))
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($who, ($fsr::CreateFiles -bor $fsr::CreateDirectories), $inh::None, $prop::None, 'Allow')))
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($made, $fsr::Modify, $tree, $prop::InheritOnly, 'Allow')))
    Set-ThornswoodServiceAcl $Root $acl
    $said += ('read and run in ' + $Root + ', make files there, change only what it made')

    foreach ($w in @($Writable | Where-Object { $_ })) {
        $d = Join-Path $Root $w
        if (-not (Test-Path -LiteralPath $d)) { continue }
        $a = Get-Acl -LiteralPath $d
        $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($who, $fsr::Modify, $tree, $prop::None, 'Allow')))
        Set-ThornswoodServiceAcl $d $a
        $said += ('change ' + $d)
    }
    foreach ($pat in @($Files | Where-Object { $_ })) {
        foreach ($f in @(Get-ChildItem -LiteralPath $Root -File -Force -Filter $pat -ErrorAction SilentlyContinue)) {
            $a = Get-Acl -LiteralPath $f.FullName
            $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($who, $fsr::Modify, 'Allow')))
            Set-ThornswoodServiceAcl $f.FullName $a
            $said += ('change ' + $f.FullName)
        }
    }
    return $said
}
function Get-ThornswoodTaskSidFromName {
    param([string]$TaskName)
    $sha = [Security.Cryptography.SHA1]::Create()
    try { $h = $sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($TaskName.ToUpperInvariant())) }
    finally { $sha.Dispose() }
    $parts = @()
    for ($i = 0; $i -lt 20; $i += 4) { $parts += [BitConverter]::ToUInt32($h, $i) }
    return ('S-1-5-87-' + ($parts -join '-'))
}
function Get-ThornswoodOwnerLaunchSource {
    return @'
using System;
using System.Runtime.InteropServices;
using System.Text;

static class ThornswoodOwner
{
    const int NotStarted = 77;
    const uint TokenQuery = 0x0008, TokenAdjustDefault = 0x0080;
    const int TokenOwnerClass = 4;
    const uint Infinite = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    struct TokenOwner { public IntPtr Owner; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct StartupInfo
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInformation { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern IntPtr GetCommandLineW();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern int GetModuleFileNameW(IntPtr module, StringBuilder name, int size);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool ConvertStringSidToSidW(string text, out IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr token, int kind, ref TokenOwner owner, int size);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr buffer, int size, out int needed);
    [DllImport("advapi32.dll")] static extern bool EqualSid(IntPtr a, IntPtr b);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string app, StringBuilder line, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref StartupInfo si, out ProcessInformation pi);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);

    static int Refuse(string why)
    {
        Console.Error.WriteLine("thornswood-owner: " + why + ". Nothing was started.");
        return NotStarted;
    }

    // What follows this program's own name on its command line, whether
    // Task Scheduler quoted the name or not.
    static string Rest(string line)
    {
        StringBuilder me = new StringBuilder(32768);
        GetModuleFileNameW(IntPtr.Zero, me, me.Capacity);
        string self = me.ToString();
        string t = line.TrimStart();
        if (self.Length > 0 && t.StartsWith("\"" + self + "\"", StringComparison.OrdinalIgnoreCase)) return t.Substring(self.Length + 2);
        if (self.Length > 0 && t.StartsWith(self, StringComparison.OrdinalIgnoreCase)) return t.Substring(self.Length);
        if (t.StartsWith("\"")) { int q = t.IndexOf('"', 1); return q < 0 ? "" : t.Substring(q + 1); }
        int sp = t.IndexOfAny(new char[] { ' ', '\t' });
        return sp < 0 ? "" : t.Substring(sp);
    }

    static int Main()
    {
        string rest = Rest(Marshal.PtrToStringUni(GetCommandLineW())).TrimStart();
        int cut = rest.IndexOfAny(new char[] { ' ', '\t' });
        if (cut < 0) return Refuse("it takes a SID and the program to run");
        string sid = rest.Substring(0, cut);
        string run = rest.Substring(cut).TrimStart();
        if (!sid.StartsWith("S-1-") || run.Length == 0) return Refuse("it takes a SID and the program to run");

        IntPtr want;
        if (!ConvertStringSidToSidW(sid, out want)) return Refuse(sid + " is not a SID (error " + Marshal.GetLastWin32Error() + ")");
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), TokenQuery | TokenAdjustDefault, out token))
            return Refuse("its own token could not be opened (error " + Marshal.GetLastWin32Error() + ")");
        TokenOwner o = new TokenOwner();
        o.Owner = want;
        if (!SetTokenInformation(token, TokenOwnerClass, ref o, Marshal.SizeOf(typeof(TokenOwner))))
            return Refuse(sid + " could not be made the owner (error " + Marshal.GetLastWin32Error() + "); it has to be in this process's token and allowed to own");
        // Read back: the owner Windows now gives everything this process makes.
        int size;
        GetTokenInformation(token, TokenOwnerClass, IntPtr.Zero, 0, out size);
        IntPtr got = Marshal.AllocHGlobal(size);
        bool same = GetTokenInformation(token, TokenOwnerClass, got, size, out size) && EqualSid(Marshal.ReadIntPtr(got), want);
        Marshal.FreeHGlobal(got);
        CloseHandle(token);
        LocalFree(want);
        if (!same) return Refuse("the owner did not read back as " + sid);

        StartupInfo si = new StartupInfo();
        si.cb = Marshal.SizeOf(typeof(StartupInfo));
        ProcessInformation pi;
        if (!CreateProcessW(null, new StringBuilder(run), IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi))
            return Refuse("it could not start " + run + " (error " + Marshal.GetLastWin32Error() + ")");
        CloseHandle(pi.hThread);
        // The program keeps the task's working directory; this process lets
        // go of it, so nothing of the launcher's holds the service's folder
        // while an install moves it.
        Environment.CurrentDirectory = Environment.SystemDirectory;
        WaitForSingleObject(pi.hProcess, Infinite);
        uint code;
        if (!GetExitCodeProcess(pi.hProcess, out code)) code = 1;
        CloseHandle(pi.hProcess);
        return unchecked((int)code);
    }
}
'@
}
function Install-ThornswoodOwnerLaunch {
    param([string]$Dir = '', [string[]]$AlsoMay = @())
    if (-not $Dir) { $Dir = Join-Path $env:ProgramFiles 'Thornswood' }
    $src = Get-ThornswoodOwnerLaunchSource
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $h = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($src.Replace("`r`n", "`n"))) }
    finally { $sha.Dispose() }
    $name = 'thornswood-owner-' + (-join ($h[0..5] | ForEach-Object { $_.ToString('x2') }))
    $exe = Join-Path $Dir ($name + '.exe')
    if (-not (Test-Path -LiteralPath $exe)) {
        if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'thornswood-owner.exe is built with the .NET Framework compiler, which only Windows has' }
        $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
        if (-not (Test-Path -LiteralPath $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
        if (-not (Test-Path -LiteralPath $csc)) { throw ('no .NET Framework compiler at ' + $csc) }
        if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
        $cs = Join-Path $Dir ($name + '.cs')
        [IO.File]::WriteAllText($cs, $src)
        $eap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $said = @(& $csc /nologo /target:exe /optimize+ ('/out:' + $exe) $cs 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ }) }
        finally { $ErrorActionPreference = $eap }
        $built = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $exe))
        Remove-Item -LiteralPath $cs -Force -ErrorAction SilentlyContinue
        if (-not $built) { throw ('thornswood-owner.exe did not build: ' + ($said -join ' ')) }
    }
    # Writing, deleting, or changing its rules or owner, and the generic
    # write and all.
    $change = [long]0x500D0156
    $may = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464') + @($AlsoMay | Where-Object { $_ })
    foreach ($p in @($exe, $Dir)) {
        foreach ($r in @((Get-Acl -LiteralPath $p).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) {
            if ([string]$r.AccessControlType -ne 'Allow' -or $may -contains $r.IdentityReference.Value) { continue }
            if (($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and $p -eq $Dir) { continue }
            if (([long][int]$r.FileSystemRights -band $change) -ne 0) { throw ($p + ': ' + $r.IdentityReference.Value + ' could change it (' + $r.FileSystemRights + ')') }
        }
    }
    return $exe
}
function New-ThornswoodOwnedAction {
    param([string]$Launcher, [string]$Sid, [string]$Execute, [string]$Argument = '', [string]$WorkingDirectory = '')
    $line = $Sid + ' "' + $Execute + '"'
    if ($Argument) { $line += ' ' + $Argument }
    if ($WorkingDirectory) { return New-ScheduledTaskAction -Execute $Launcher -Argument $line -WorkingDirectory $WorkingDirectory }
    return New-ScheduledTaskAction -Execute $Launcher -Argument $line
}
function Get-ThornswoodPlainAction {
    param($Action)
    $exe = [string]$Action.Execute
    $arg = [string]$Action.Arguments
    if ((Split-Path -Leaf $exe) -like 'thornswood-owner-*.exe') {
        $m = [regex]::Match($arg, '^\s*S-1-[0-9-]+\s+"([^"]+)"\s*(.*)$', 'Singleline')
        if (-not $m.Success) { throw ('the launcher''s arguments are not a SID and a quoted program: ' + $arg) }
        $exe = $m.Groups[1].Value
        $arg = $m.Groups[2].Value
    }
    return @{ Execute = $exe; Argument = $arg; WorkingDirectory = [string]$Action.WorkingDirectory }
}
function Enable-ThornswoodRestorePrivilege {
    if (-not ('ThornswoodRestorePrivilege' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ThornswoodRestorePrivilege
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct One { public int Count; public long Luid; public int Attributes; }
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, int access, out IntPtr token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool LookupPrivilegeValueW(string system, string name, out long luid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool none, ref One state, int size, IntPtr previous, IntPtr needed);
    // 0 when it is on; otherwise the Windows error (1300: not held).
    public static int Enable()
    {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), 0x28, out token)) return Marshal.GetLastWin32Error();
        One p = new One();
        p.Count = 1;
        p.Attributes = 2;
        int error;
        if (!LookupPrivilegeValueW(null, "SeRestorePrivilege", out p.Luid)) error = Marshal.GetLastWin32Error();
        else if (!AdjustTokenPrivileges(token, false, ref p, 0, IntPtr.Zero, IntPtr.Zero)) error = Marshal.GetLastWin32Error();
        else error = Marshal.GetLastWin32Error();
        CloseHandle(token);
        return error;
    }
}
'@
    }
    $e = [ThornswoodRestorePrivilege]::Enable()
    if ($e -ne 0) { throw ('the restore privilege could not be turned on (Windows error ' + $e + '), and giving a file to the task needs it') }
}
function Get-ThornswoodServiceItemAcl {
    param($Item)
    $s = [Security.AccessControl.AccessControlSections]'Owner, Access'
    if ($Item -is [IO.DirectoryInfo]) { return [IO.FileSystemAclExtensions]::GetAccessControl([IO.DirectoryInfo]$Item, $s) }
    return [IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]$Item, $s)
}
function Repair-ThornswoodServiceOwner {
    param([string]$Root, [string]$Sid)
    if (-not $Root -or -not (Test-Path -LiteralPath $Root)) { throw ('not here: ' + $Root) }
    if (-not $Sid) { throw 'no SID to give them to' }
    $ls = 'S-1-5-19'
    $who = New-Object Security.Principal.SecurityIdentifier($Sid)
    $top = Get-Item -LiteralPath $Root -Force
    $items = @($top) + @(Get-ChildItem -LiteralPath $Root -Recurse -Force -ErrorAction Stop)
    $owned = 0; $ruled = 0; $on = $false
    $heads = @($top)
    foreach ($i in $items) {
        $acl = Get-ThornswoodServiceItemAcl $i
        if ($i -is [IO.DirectoryInfo] -and $i.FullName -ne $top.FullName -and $acl.AreAccessRulesProtected) { $heads += $i }
        $mine = ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $ls)
        $rules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) |
                   Where-Object { $_.IdentityReference.Value -eq $ls -and [string]$_.AccessControlType -eq 'Allow' })
        if (-not $mine -and -not $rules.Count) { continue }
        if ($mine) {
            if (-not $on) { Enable-ThornswoodRestorePrivilege; $on = $true }
            $acl.SetOwner($who)
            $owned++
        }
        foreach ($r in $rules) { [void]$acl.RemoveAccessRuleSpecific($r); $ruled++ }
        Set-ThornswoodServiceAcl $i.FullName $acl
    }
    if ($owned -or $ruled) {
        foreach ($d in $heads) {
            $a = Get-ThornswoodServiceItemAcl $d
            $a.SetAccessRuleProtection($a.AreAccessRulesProtected, $true)
            Set-ThornswoodServiceAcl $d.FullName $a
        }
    }
    $said = @()
    if ($owned) { $said += ('gave the task ' + $owned + ' file(s) and folder(s) in ' + $Root + ' that LOCAL SERVICE owned') }
    if ($ruled) { $said += ('took ' + $ruled + ' LOCAL SERVICE rule(s) off in ' + $Root) }
    if (-not $said.Count) { $said += ('nothing in ' + $Root + ' is LOCAL SERVICE''s') }
    return $said
}
function Set-ThornswoodTaskOwner {
    param([string]$TaskName, [string]$Sid, $Action, [string[]]$Roots = @(), [string]$Launcher = '')
    if (-not $Sid) { throw 'no SID to give the task' }
    $said = @()
    foreach ($r in @($Roots | Where-Object { $_ })) { $said += @(Repair-ThornswoodServiceOwner -Root $r -Sid $Sid) }
    if (-not $Launcher) { $Launcher = Install-ThornswoodOwnerLaunch }
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if (-not $Action) { $Action = @($t.Actions)[0] }
    $plain = Get-ThornswoodPlainAction $Action
    $owned = New-ThornswoodOwnedAction -Launcher $Launcher -Sid $Sid -Execute $plain.Execute -Argument $plain.Argument -WorkingDirectory $plain.WorkingDirectory
    $t.Actions = $owned
    $t | Set-ScheduledTask -ErrorAction Stop | Out-Null
    $got = @((Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).Actions)[0]
    if ([string]$got.Execute -ne $Launcher -or [string]$got.Arguments -ne [string]$owned.Arguments) { throw ('the task''s action did not read back as the launcher: ' + $got.Execute) }
    $said += ('starts through ' + $Launcher + ', so what it makes is ' + $Sid + '''s')
    return $said
}
# ---- end ServiceAccount.ps1 ----
# The fail-safe (#2578), before anything is stopped or changed: the server
# goes onto LOCAL SERVICE only where LOCAL SERVICE can read none of what no
# service may.
if (-not $AsSystem -and -not $NoTask) {
    $cannot = @(Test-ThornswoodServiceCannotReach (Get-ThornswoodServiceNeverReach -Own $Root -Box (Split-Path -Parent $Root)))
    if ($cannot.Count) {
        Say 'LOCAL SERVICE could read what no service may, so the server is not moved onto it:' 'Red'
        foreach ($c in $cannot) { Say ('  ' + $c) 'Red' }
        Say 'Lock those (scripts\vps\Lock-VpsFolders.ps1), or pass -AsSystem. Nothing was changed.' 'Red'
        Finish 'INSTALL REFUSED' 1
    }
}
# The log writer the task runs the server under (#2349): beside this script,
# sent with it, or in scripts\vps from a checkout. Without it the task could
# not start the server, so nothing runs.
if (-not (Test-Path -LiteralPath (Join-Path $here 'Server-Log.js')) -and
    -not (Test-Path -LiteralPath (Join-Path $here '..\vps\Server-Log.js'))) {
    Say "Server-Log.js is not beside this installer, and the server's task runs the server under it. Nothing was changed." 'Red'
    Finish 'INSTALL REFUSED' 1
}
if (-not $PSBoundParameters.ContainsKey('Wait')) {
    $Wait = Get-ThornswoodServerReadyWait
}
$script:running = $null

# The game port a root's settings name, and the resources port that follows
# from it: skymp5-server/ts/ui.ts gives 3000 for 7777 and the game port plus
# one otherwise. Publish-Server and Deploy-Server use the same rule.
#
# No settings file, or one with no port, is the server's own default, 7777.
# One that is there and does not read stops the run: guessing 7777 for it
# would have a dev root take the live server's answer for its own (#2711).
function GamePortOf([string]$dir) {
    $sp = Join-Path $dir 'server-settings.json'
    if (-not (Test-Path -LiteralPath $sp)) { return 7777 }
    $cfg = $null
    try { $cfg = [IO.File]::ReadAllText($sp) | ConvertFrom-Json }
    catch { throw ("$sp does not read, so the port this server answers on is not known: " + $_.Exception.Message) }
    if ($null -ne $cfg -and $cfg.port) { return [int]$cfg.port }
    return 7777
}

# Stopping the server and waiting until each of its processes has exited,
# and each folder rename tried once, saying why when Windows refuses it
# (#2928). A copy of scripts\deploy\StopAndMove.ps1 below its header, kept
# here for the reason the ServiceAccount.ps1 copy above is: every file
# Publish-Server.ps1 sends is a call in records\remote-commands.json.
# tests\test-2928-stop-and-move.ps1 fails when this copy and StopAndMove.ps1
# differ. Until 20 Oct the renames were tried ten times, 0.7 s apart.
# ---- StopAndMove.ps1 (copy) ----

# How long a process that has been ended may take to exit before its caller
# is told it has not. Measured on the box: 8 to 403 ms (#2928). One still there
# after this is stuck in the kernel, and moving its files would be refused.
$ThornswoodExitSeconds = 30

# The processes with these ids that are running, each with its handle open,
# so that Stop-ThornswoodProcessHeld waits on that process and no other.
# Opened before anything is asked to stop; the caller takes them with @().
# An id with nothing running is left out: there is nothing to wait for. One
# that is running and cannot be opened goes in $ThornswoodNotHeld, a line
# each, for the caller to say and to move nothing it holds.
$ThornswoodNotHeld = @()
function Get-ThornswoodProcessHeld([int[]]$Ids) {
  $script:ThornswoodNotHeld = @()
  foreach ($id in @($Ids | Where-Object { $_ -gt 0 -and $_ -ne $PID } | Sort-Object -Unique)) {
    $p = Get-Process -Id $id -EA SilentlyContinue
    if (-not $p) { continue }
    $name = $p.ProcessName
    try { $null = $p.Handle; $p }
    catch {
      if (Get-Process -Id $id -EA SilentlyContinue) {
        $script:ThornswoodNotHeld += ('COULD NOT OPEN pid ' + $id + ' (' + $name + ') to wait for it to exit: ' + $_.Exception.Message)
      }
    }
  }
}

# Ends each process Get-ThornswoodProcessHeld opened that is still running,
# and returns once every one has exited. Says nothing for one that exits,
# because each caller says what it stopped in its own words; says each one
# that had not exited after $ThornswoodExitSeconds, and leaves its id in
# $ThornswoodStillRunning, so the caller moves nothing it holds.
$ThornswoodStillRunning = @()
function Stop-ThornswoodProcessHeld($Held) {
  $script:ThornswoodStillRunning = @()
  $why = @{}
  $names = @{}
  foreach ($p in @($Held | Where-Object { $_ })) {
    if ($p.HasExited) { continue }
    $names[$p.Id] = $p.ProcessName
    # Refused when it is already on its way out, which the wait below sees.
    try { $p.Kill() } catch { $why[$p.Id] = $_.Exception.Message }
  }
  $until = (Get-Date).AddSeconds($ThornswoodExitSeconds)
  foreach ($p in @($Held | Where-Object { $_ })) {
    $left = [int][Math]::Max(0, ($until - (Get-Date)).TotalMilliseconds)
    if ($p.WaitForExit($left)) { continue }
    $script:ThornswoodStillRunning += $p.Id
    $line = 'pid ' + $p.Id + ' (' + $names[$p.Id] + ') was ended and had not exited after ' + $ThornswoodExitSeconds + ' seconds'
    if ($why.ContainsKey($p.Id)) { $line += '; ending it said: ' + $why[$p.Id] }
    $line
  }
}

# The C# the looks and the folder rename below use, compiled once, when this
# text is loaded, in one go. Add-Type runs the compiler, which takes seconds,
# so it is done before anything is stopped: on 22 Oct 2026 at 5:38 AM a
# refused rename compiled two of these after the refusal and so looked at
# the folder seconds late, and the two ids it could not name were the
# compiler's own processes (#3262). $ThornswoodTypesWhy is '' once they are
# loaded, else why not (off Windows, where they do not exist, too), and each
# look says so in place of its answer, and a folder is moved by .NET.
$ThornswoodTypesCs = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class ThornswoodOpeners {
  [StructLayout(LayoutKind.Sequential)] struct IOSB { public IntPtr Status; public IntPtr Info; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr template);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationFile(IntPtr h, out IOSB iosb, IntPtr buf, int len, int cls);
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int cls, IntPtr buf, int len, out int ret);
  public static string Error;
  // The ids with the path open, or null with why in Error.
  public static long[] Of(string path) {
    Error = null;
    // Attributes only, sharing everything: asked alongside any holder.
    IntPtr h = CreateFile(path, 0x80, 7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
    if (h == new IntPtr(-1)) { Error = "the path could not be opened to ask (Windows error " + Marshal.GetLastWin32Error() + ")"; return null; }
    try {
      int len = 1 << 12;
      while (true) {
        IntPtr buf = Marshal.AllocHGlobal(len);
        try {
          IOSB io;
          int st = NtQueryInformationFile(h, out io, buf, len, 47);
          if (st == unchecked((int)0xC0000004)) { len *= 4; if (len > (1 << 24)) { Error = "too many to list"; return null; } continue; }
          if (st != 0) { Error = "Windows would not say (0x" + st.ToString("X8") + ")"; return null; }
          int n = Marshal.ReadInt32(buf);
          long[] ids = new long[n];
          for (int i = 0; i < n; i++) ids[i] = Marshal.ReadIntPtr(buf, IntPtr.Size + i * IntPtr.Size).ToInt64();
          return ids;
        } finally { Marshal.FreeHGlobal(buf); }
      }
    } finally { CloseHandle(h); }
  }
  public static int Unasked;
  public static string FirstUnasked;
  // For each process with any of the files open: id, how many, the first.
  public static List<object[]> OfFiles(string[] paths) {
    Unasked = 0;
    FirstUnasked = null;
    Dictionary<long, object[]> by = new Dictionary<long, object[]>();
    foreach (string p in paths) {
      long[] ids = Of(p);
      if (ids == null) { if (Unasked++ == 0) FirstUnasked = p + " (" + Error + ")"; continue; }
      foreach (long id in ids) {
        object[] e;
        if (!by.TryGetValue(id, out e)) { e = new object[] { id, 0, p }; by[id] = e; }
        e[1] = (int)e[1] + 1;
      }
    }
    return new List<object[]>(by.Values);
  }
  // Every process running: id, parent id, start (FILETIME, UTC) and name.
  public static List<object[]> Running() {
    int len = 1 << 20, ret, st;
    IntPtr buf;
    while (true) {
      buf = Marshal.AllocHGlobal(len);
      st = NtQuerySystemInformation(5, buf, len, out ret);
      if (st == 0) break;
      Marshal.FreeHGlobal(buf);
      if (len >= (1 << 28)) throw new Exception("the processes could not be listed (0x" + st.ToString("X8") + ")");
      len *= 2;
    }
    List<object[]> all = new List<object[]>();
    try {
      // SYSTEM_PROCESS_INFORMATION: CreateTime at 32, ImageName at 56, then
      // BasePriority, then the process's and its parent's ids, each aligned
      // to a pointer.
      int us = IntPtr.Size == 8 ? 16 : 8;
      int idAt = 56 + us + 4;
      if (idAt % IntPtr.Size != 0) idAt += IntPtr.Size - idAt % IntPtr.Size;
      long at = buf.ToInt64();
      while (true) {
        IntPtr e = new IntPtr(at);
        long id = Marshal.ReadIntPtr(e, idAt).ToInt64();
        long parent = Marshal.ReadIntPtr(e, idAt + IntPtr.Size).ToInt64();
        long created = Marshal.ReadInt64(e, 32);
        int nameLen = Marshal.ReadInt16(e, 56) & 0xFFFF;
        IntPtr nameAt = Marshal.ReadIntPtr(e, 56 + IntPtr.Size);
        string name = (nameAt == IntPtr.Zero || nameLen == 0) ? (id == 0 ? "Idle" : "System") : Marshal.PtrToStringUni(nameAt, nameLen / 2);
        all.Add(new object[] { id, parent, created, name });
        int next = Marshal.ReadInt32(e);
        if (next == 0) break;
        at += next;
      }
    } finally { Marshal.FreeHGlobal(buf); }
    return all;
  }
}
public static class ThornswoodHandles {
  [StructLayout(LayoutKind.Sequential)] struct ENTRY { public IntPtr Object; public IntPtr Pid; public IntPtr Handle; public uint Access; public ushort Creator; public ushort Type; public uint Attr; public uint Reserved; }
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int cls, IntPtr buf, int len, out int ret);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DuplicateHandle(IntPtr sp, IntPtr sh, IntPtr tp, out IntPtr th, uint access, bool inherit, uint opt);
  [DllImport("kernel32.dll")] static extern uint GetFileType(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern uint GetFinalPathNameByHandle(IntPtr h, StringBuilder sb, uint len, uint flags);
  static string found;
  public static string Under(string path) {
    found = null;
    Thread t = new Thread(delegate() { found = Look(path); });
    t.IsBackground = true;
    t.Start();
    if (!t.Join(20000)) return "the handle list did not finish in 20 seconds";
    return found;
  }
  static string Look(string path) {
    string under = path.TrimEnd('\\');
    int len = 1 << 22, ret, st;
    IntPtr buf;
    while (true) {
      buf = Marshal.AllocHGlobal(len);
      st = NtQuerySystemInformation(64, buf, len, out ret);
      if (st == 0) break;
      Marshal.FreeHGlobal(buf);
      if (len >= (1 << 30)) return "the handles could not be listed (0x" + st.ToString("X8") + ")";
      len *= 2;
    }
    Dictionary<int, IntPtr> procs = new Dictionary<int, IntPtr>();
    Dictionary<int, List<string>> held = new Dictionary<int, List<string>>();
    List<int> unopened = new List<int>();
    try {
      long count = Marshal.ReadIntPtr(buf).ToInt64();
      int size = Marshal.SizeOf(typeof(ENTRY));
      long first = buf.ToInt64() + IntPtr.Size * 2;
      IntPtr me = GetCurrentProcess();
      for (long i = 0; i < count; i++) {
        ENTRY e = (ENTRY)Marshal.PtrToStructure(new IntPtr(first + i * size), typeof(ENTRY));
        int pid = (int)e.Pid.ToInt64();
        if (pid <= 4) continue;
        // The masks a synchronous pipe is opened with: reading its path can wait for ever.
        if (e.Access == 0x0012019F || e.Access == 0x00120189 || e.Access == 0x00100000 || e.Access == 0x0016019F) continue;
        IntPtr p;
        if (!procs.TryGetValue(pid, out p)) {
          p = OpenProcess(0x40, false, pid);
          procs[pid] = p;
          if (p == IntPtr.Zero) unopened.Add(pid);
        }
        if (p == IntPtr.Zero) continue;
        IntPtr d;
        if (!DuplicateHandle(p, e.Handle, me, out d, 0, false, 2)) continue;
        try {
          if (GetFileType(d) != 1) continue;
          StringBuilder sb = new StringBuilder(1024);
          uint n = GetFinalPathNameByHandle(d, sb, 1024, 0);
          if (n == 0 || n >= 1024) continue;
          string at = sb.ToString();
          if (at.StartsWith(@"\\?\")) at = at.Substring(4);
          if (!at.Equals(under, StringComparison.OrdinalIgnoreCase) && !at.StartsWith(under + @"\", StringComparison.OrdinalIgnoreCase)) continue;
          if (!held.ContainsKey(pid)) held[pid] = new List<string>();
          held[pid].Add(at + " (access 0x" + e.Access.ToString("X") + ")");
        } finally { CloseHandle(d); }
      }
    } finally {
      foreach (IntPtr p in procs.Values) if (p != IntPtr.Zero) CloseHandle(p);
      Marshal.FreeHGlobal(buf);
    }
    List<string> said = new List<string>();
    foreach (KeyValuePair<int, List<string>> h in held) {
      List<string> paths = h.Value;
      string more = paths.Count > 6 ? " and " + (paths.Count - 6) + " more" : "";
      if (paths.Count > 6) paths = paths.GetRange(0, 6);
      said.Add("pid " + h.Key + " " + Name(h.Key) + ": " + string.Join(", ", paths.ToArray()) + more);
    }
    string text = said.Count > 0 ? string.Join("; ", said.ToArray()) : "none in any process it could look into";
    if (unopened.Count > 0) {
      // As an administrator these are the protected few; run as anybody
      // else it is nearly every process, and the count says so.
      List<string> names = new List<string>();
      for (int i = 0; i < unopened.Count && i < 12; i++) names.Add(unopened[i] + " " + Name(unopened[i]));
      text += "; could not look into " + (unopened.Count > 12 ? unopened.Count + " processes, among them " : "") + string.Join(", ", names.ToArray());
    }
    return text;
  }
  static string Name(int pid) {
    try { return System.Diagnostics.Process.GetProcessById(pid).ProcessName; } catch { return "(exited)"; }
  }
}
public static class ThornswoodRename {
  [StructLayout(LayoutKind.Sequential)] struct IOSB { public IntPtr Status; public IntPtr Info; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr template);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtSetInformationFile(IntPtr h, out IOSB iosb, IntPtr buf, int len, int cls);
  [DllImport("ntdll.dll")] static extern int RtlNtStatusToDosError(int status);
  // "open" when the folder would not open to be renamed, "rename" when it
  // opened and the rename was refused.
  public static string Step;
  // 0 once from is renamed to to (full paths, one volume), else the Windows error.
  public static int Move(string from, string to) {
    Step = "open";
    // Delete access, which a rename needs, sharing everything, as MoveFile asks.
    IntPtr h = CreateFile(from, 0x00010000 | 0x00100000 | 0x80, 7, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
    if (h == new IntPtr(-1)) return Marshal.GetLastWin32Error();
    try {
      Step = "rename";
      // FILE_RENAME_INFORMATION: ReplaceIfExists (no), RootDirectory (none),
      // FileNameLength, then the new name as an NT path.
      string name = @"\??\" + to;
      int nameAt = 2 * IntPtr.Size + 4;
      int len = nameAt + (name.Length + 1) * 2;
      IntPtr buf = Marshal.AllocHGlobal(len);
      try {
        for (int i = 0; i < len; i++) Marshal.WriteByte(buf, i, 0);
        Marshal.WriteInt32(buf, 2 * IntPtr.Size, name.Length * 2);
        Marshal.Copy(name.ToCharArray(), 0, new IntPtr(buf.ToInt64() + nameAt), name.Length);
        IOSB io;
        int st = NtSetInformationFile(h, out io, buf, len, 10);
        return st == 0 ? 0 : RtlNtStatusToDosError(st);
      } finally { Marshal.FreeHGlobal(buf); }
    } finally { CloseHandle(h); }
  }
}
'@
function Use-ThornswoodTypes {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { return 'Windows has these lists and this is not Windows' }
  if (('ThornswoodOpeners' -as [type]) -and ('ThornswoodHandles' -as [type]) -and ('ThornswoodRename' -as [type])) { return '' }
  try { Add-Type -TypeDefinition $ThornswoodTypesCs; return '' } catch { return 'the C# it needs would not compile: ' + $_.Exception.Message }
}
$ThornswoodTypesWhy = Use-ThornswoodTypes

# What has $Path or anything under it open right now, quickest first, because
# a holder that exits a moment after the refusal is gone from anything asked
# later (#3262). On 22 Oct 2026 a dev publish was refused with 0x80070020
# and named nothing: the Restart Manager, asked first, took 41 s over the dev
# server's 12,424 files, and only then were the handles listed.
#
#   1. Which processes have the path itself open, asked of Windows directly
#      (FileProcessIdsUsingFileInformation). For a folder that is exactly
#      the sharing violation: a handle on the folder, such as a process's
#      current directory, opened without delete sharing. It names protected
#      processes, Windows Defender among them, which nothing else here can
#      look into. With it, every process running at that instant: name,
#      parent and start time, so an id named anywhere below is still named
#      once it has gone.
#   2. Every handle on the box under the path (Get-ThornswoodPathHandles):
#      files and folders inside it, which the first does not see.
#   3. The command line of each process named, while it still runs.
#   4. Which processes have each file under it open, asked of Windows the
#      same way as 1, file by file (Get-ThornswoodFileHolders), last because
#      it walks the whole tree. This was the Restart Manager until #3274,
#      which asks Windows the same thing through one session lock shared by
#      the whole box: with two builds on the box that lock was not had in
#      time (its session would not start: 121), and it took the 41 s above.
function Get-ThornswoodPathHolders([string]$Path) {
  $snap = Get-ThornswoodPathOpeners $Path
  $handles = Get-ThornswoodPathHandles $Path
  $said = 'open itself in: ' + $snap.Said + '; handles: ' + $handles
  $ids = @()
  foreach ($m in [regex]::Matches($snap.Said + ' ' + $handles, '(?:pid |into |, |among them )(\d+) (?!processes)')) { $ids += [int]$m.Groups[1].Value }
  $now = Get-Date
  $recent = @()
  foreach ($k in @($snap.Procs.Keys)) {
    $p = $snap.Procs[$k]
    if ($p.Started -and ($now - $p.Started).TotalSeconds -le 120 -and $k -ne $PID) { $recent += $k }
  }
  # Each line is kept under its id, never read back out of the line: a
  # command line can hold a line break (a release note passed as -Notes), and
  # an id parsed back out of such a line was the whole line, which no [int]
  # takes, so the refusal threw where it should have said who held the path.
  $who = @{}
  $lines = @{}
  $noLines = ''
  $named = @($ids + $recent | Sort-Object -Unique)
  if ($named.Count) {
    try { foreach ($w in @(Get-CimInstance Win32_Process -ErrorAction Stop)) { if ($named -contains [int]$w.ProcessId) { $lines[[int]$w.ProcessId] = $w.CommandLine } } }
    catch { $noLines = '; the command lines could not be read: ' + $_.Exception.Message }
  }
  foreach ($id in $named) {
    $line = 'pid ' + $id + ' ' + (Get-ThornswoodProcessWords $snap.Procs $id)
    if ($lines.ContainsKey($id) -and $lines[$id]) { $line += ', command line ' + $lines[$id] }
    elseif (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { $line += ', gone by the time its command line was asked' }
    $who[$id] = $line
  }
  if ($ids.Count) { $said += '; who they are: ' + (@($named | Where-Object { $ids -contains $_ } | ForEach-Object { $who[$_] }) -join '; ') }
  $new = @($named | Where-Object { $recent -contains $_ } | ForEach-Object { $who[$_] })
  $said += '; started in the 2 minutes before: ' + $(if ($new.Count) { $new -join '; ' } else { 'nothing' }) + $noLines
  return $said + '; files under it open in: ' + (Get-ThornswoodFileHolders $Path $snap.Procs)
}

# How one process from Get-ThornswoodPathOpeners's snapshot reads: its name,
# its parent's id and name, and when it started, or that it was not running.
function Get-ThornswoodProcessWords($Procs, [int]$Id) {
  if (-not $Procs.ContainsKey($Id)) { return '(not running when the refusal was looked at)' }
  $p = $Procs[$Id]
  $parent = 'parent ' + $p.Parent + ' ' + $(if ($Procs.ContainsKey($p.Parent)) { $Procs[$p.Parent].Name } else { '(not running)' })
  $at = if ($p.Started) { 'started ' + $p.Started.ToString('yyyy-MM-dd h:mm:ss.fff tt') } else { 'start time not given' }
  return ($p.Name + ' (' + $parent + ', ' + $at + ')')
}

# Which processes have $Path itself open, and every process running at that
# instant, in one look that opens nothing but $Path. Returns Said, the
# openers as "pid name" words or why they could not be asked, and Procs, by
# id, each with Name, Parent and Started (local time). This process's own
# look at the path is left out of the openers.
function Get-ThornswoodPathOpeners([string]$Path) {
  if ($ThornswoodTypesWhy) { return @{ Said = 'Windows could not be asked: ' + $ThornswoodTypesWhy; Procs = @{} } }
  $ids = $null
  $why = ''
  try { $ids = [ThornswoodOpeners]::Of([IO.Path]::GetFullPath($Path)); if ($null -eq $ids) { $why = [ThornswoodOpeners]::Error } }
  catch { $why = 'Windows could not be asked: ' + $_.Exception.Message }
  $procs = @{}
  try {
    foreach ($r in [ThornswoodOpeners]::Running()) {
      $started = $null
      if ([long]$r[2] -gt 0) { $started = [DateTime]::FromFileTimeUtc([long]$r[2]).ToLocalTime() }
      $procs[[int]$r[0]] = @{ Name = [string]$r[3]; Parent = [int]$r[1]; Started = $started }
    }
  } catch { $why += $(if ($why) { '; ' } else { '' }) + $_.Exception.Message }
  if ($why) { return @{ Said = $why; Procs = $procs } }
  $others = @($ids | Where-Object { [int]$_ -ne $PID })
  if (-not $others.Count) { return @{ Said = 'no process but this one, asking'; Procs = $procs } }
  $words = @($others | ForEach-Object { 'pid ' + $_ + ' ' + $(if ($procs.ContainsKey([int]$_)) { $procs[[int]$_].Name } else { '(gone)' }) })
  return @{ Said = ($words -join ', '); Procs = $procs }
}

# Which processes have a file at or under $Path open right now, as "pid
# name (n files, the first <path>)" groups, from Windows's own list for each
# file (ThornswoodOpeners, Get-ThornswoodPathOpeners), with the files it
# could not ask about counted. Names come from $Procs, that function's
# snapshot. This process's own look at each file is left out.
function Get-ThornswoodFileHolders([string]$Path, $Procs) {
  if ($ThornswoodTypesWhy) { return 'not asked: ' + $ThornswoodTypesWhy }
  if (-not $Procs) { $Procs = @{} }
  $files = @($Path)
  if (Test-Path -LiteralPath $Path -PathType Container) {
    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -EA SilentlyContinue | ForEach-Object { $_.FullName })
    if (-not $files.Count) { return 'none: the folder holds no files' }
  }
  try { $found = [ThornswoodOpeners]::OfFiles([string[]]$files) }
  catch { return 'not asked: ' + $_.Exception.Message }
  $groups = @()
  foreach ($r in $found) {
    $id = [int]$r[0]
    if ($id -eq $PID) { continue }
    $name = if ($Procs.ContainsKey($id)) { $Procs[$id].Name } else { '(not running when the refusal was looked at)' }
    $groups += ('pid ' + $id + ' ' + $name + ' (' + $r[1] + ' file(s), the first ' + $r[2] + ')')
  }
  $said = if ($groups.Count) { $groups -join '; ' } else { 'no process but this one, asking, in ' + $files.Count + ' file(s)' }
  if ([ThornswoodOpeners]::Unasked) { $said += '; ' + [ThornswoodOpeners]::Unasked + ' file(s) could not be asked about, the first ' + [ThornswoodOpeners]::FirstUnasked }
  return $said
}

# Every handle on the box that names $Path or a path under it, this
# process's own among them, as "pid name: path (access 0x...)" groups, then
# the processes it could not look into
# (protected ones, Windows Defender among them, which even an administrator
# cannot open). Read only: each handle is copied into this process, its path
# read, and the copy closed. A handle whose path cannot be read without
# waiting (a pipe with a read pending) is passed over by its access mask, and
# the whole look is given 20 seconds and says so if it ran out.
function Get-ThornswoodPathHandles([string]$Path) {
  if ($ThornswoodTypesWhy) { return 'the handles could not be listed: ' + $ThornswoodTypesWhy }
  # Without the debug privilege an administrator cannot open the services'
  # processes; a run without it says so beside what it found.
  $noDebug = ''
  try { [System.Diagnostics.Process]::EnterDebugMode() } catch { $noDebug = '; without the debug privilege (' + $_.Exception.Message + ')' }
  try { return [ThornswoodHandles]::Under([IO.Path]::GetFullPath($Path)) + $noDebug }
  catch { return 'the handles could not be listed: ' + $_.Exception.Message }
}

# Moves a file or a folder on one volume, once, making the folder it goes
# into. $false when Windows refuses, with why in $ThornswoodMoveWhy.
#
# A folder is opened for the rename and then renamed through that handle,
# which is what MoveFile does, so a refusal says which of the two it was
# (#3262). Measured on a box runner on 22 Oct 2026: the open is refused with
# error 32 when a process has the folder itself open without delete sharing,
# a current directory there the usual one; it opens, and the rename is
# refused with error 5, when a file under it is open. Each is looked at the
# moment it is refused.
$ThornswoodMoveWhy = ''
function Move-ThornswoodPath([string]$From, [string]$To) {
  $script:ThornswoodMoveWhy = ''
  $folder = $false
  try {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $To))
    $folder = Test-Path -LiteralPath $From -PathType Container
    if (-not $folder) { [IO.File]::Move($From, $To); return $true }
    if ($ThornswoodTypesWhy) { [IO.Directory]::Move($From, $To); return $true }
  } catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    $script:ThornswoodMoveWhy = ('{0} (0x{1:X8}); open under it then: {2}' -f $e.Message.Trim(), $e.HResult, (Get-ThornswoodPathHolders $From))
    return $false
  }
  $full = [IO.Path]::GetFullPath($From)
  $into = [IO.Path]::GetFullPath($To)
  $err = [ThornswoodRename]::Move($full, $into)
  if ($err -eq 0) { return $true }
  $step = [ThornswoodRename]::Step
  $what = if ($step -eq 'open') { 'the folder would not open to be renamed' } else { 'the folder opened, and the rename was refused' }
  $msg = (New-Object ComponentModel.Win32Exception($err)).Message
  $script:ThornswoodMoveWhy = ('{0}: {1} (0x{2:X8}); open under it then: {3}' -f $what, $msg, (0x80070000 -bor $err), (Get-ThornswoodPathHolders $From))
  return $false
}

# ---- who opened a folder itself, recorded as it happened (#5211) ----------
#
# WHY. On 31 Oct 2026 at 7:00 PM box time Publish-Server-Main could not open
# C:\Thornswood-Server to rename it (error 32), and the look taken the instant
# after (Get-ThornswoodPathHolders) found nothing holding it: no process but
# the installer had it open, and no handle on it in any process it could look
# into. The same refusal named nothing on 22 Oct (#3262). Read through the
# gate on the running server (Read-ServerHolders, 1 Nov), the folder itself is
# open only in the cmd and the two nodes StopServer stops and waits for; the
# task's launcher and conhost do not have it open. So what refused the rename
# opened the folder during the install and let go within milliseconds, and no
# look afterwards can name it. Windows can: its own trace of every open
# (Microsoft-Windows-Kernel-File, Create events, which name the process
# whatever it is, a protected one or the kernel's own included) and of every
# process started and ended (Microsoft-Windows-Kernel-Process). These record
# both from before the stop to just after the move, and when the move is
# refused, say every open of the folder itself in that time: when, by which
# process, and what it shares. It changes nothing: a trace session is read
# only, stopped on every way out, and its file removed.
$ThornswoodTraceWhy = ''
function Start-ThornswoodOpenTrace([string]$Name) {
  $script:ThornswoodTraceWhy = ''
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { $script:ThornswoodTraceWhy = 'Windows has this trace and this is not Windows'; return $null }
  $logman = Join-Path $env:SystemRoot 'System32\logman.exe'
  $etl = Join-Path ([IO.Path]::GetTempPath()) ($Name + '.etl')
  $pf = Join-Path ([IO.Path]::GetTempPath()) ($Name + '.providers')
  Remove-Item -LiteralPath $etl, $pf -Force -EA SilentlyContinue
  # Opens (the create keyword, 0x80) and process starts and ends (0x10).
  [IO.File]::WriteAllLines($pf, [string[]]@('"Microsoft-Windows-Kernel-File" 0x80 0x5', '"Microsoft-Windows-Kernel-Process" 0x10 0x5'))
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $said = @(& $logman start $Name -pf $pf -o $etl -bs 1024 -nb 64 512 -ets 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ }) }
  finally { $ErrorActionPreference = $eap }
  Remove-Item -LiteralPath $pf -Force -EA SilentlyContinue
  if ($LASTEXITCODE -ne 0) { $script:ThornswoodTraceWhy = 'logman would not start it (exit ' + $LASTEXITCODE + '): ' + ($said -join ' '); return $null }
  return @{ Name = $Name; Etl = $etl; Logman = $logman; Stopped = $false }
}

# Stops the trace. Nothing comes back; Read-ThornswoodOpenTrace reads it.
function Stop-ThornswoodOpenTrace($Trace) {
  if (-not $Trace -or $Trace.Stopped) { return }
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $null = & $Trace.Logman stop $Trace.Name -ets 2>&1 } finally { $ErrorActionPreference = $eap }
  $Trace.Stopped = $true
}

# Every open of $Path itself in the trace, in time order, then every
# process started or ended in the three seconds before this process's last
# open of it (the refused one) and the second after; then removes the
# trace's file.
function Read-ThornswoodOpenTrace($Trace, [string]$Path) {
  if (-not $Trace) { return @('no trace was recorded: ' + $ThornswoodTraceWhy) }
  Stop-ThornswoodOpenTrace $Trace
  $lines = @()
  try {
    $leaf = '\' + (Split-Path -Leaf ([IO.Path]::GetFullPath($Path)))
    $names = @{}
    $namesWhy = ''
    try { foreach ($r in [ThornswoodOpeners]::Running()) { $names[[int]$r[0]] = [string]$r[3] } }
    catch { $namesWhy = '; the processes running now could not be listed for their names (' + $_.Exception.Message + '), so only those the trace saw start are named' }
    $events = @(Get-WinEvent -Path $Trace.Etl -Oldest -ErrorAction Stop)
    $opens = 0
    $procs = @()
    $found = @()
    $anchor = $null
    foreach ($e in $events) {
      if ([string]$e.ProviderName -eq 'Microsoft-Windows-Kernel-Process') {
        if ($e.Id -ne 1 -and $e.Id -ne 2) { continue }
        $d = @{}
        foreach ($x in @(([xml]$e.ToXml()).Event.EventData.Data)) { $d[[string]$x.Name] = [string]$x.'#text' }
        $id = 0
        if ($d['ProcessID']) { $id = [int]$d['ProcessID'] }
        if ($d['ImageName'] -and $id) { $names[$id] = Split-Path -Leaf $d['ImageName'] }
        $procs += , @($e.TimeCreated, $id, $(if ($e.Id -eq 1) { 'started' } else { 'ended' }), $d['ParentProcessID'])
        continue
      }
      $opens++
      $hit = $false
      foreach ($v in @($e.Properties)) { if (([string]$v.Value).EndsWith($leaf, [StringComparison]::OrdinalIgnoreCase)) { $hit = $true; break } }
      if (-not $hit) { continue }
      $d = @{}
      foreach ($x in @(([xml]$e.ToXml()).Event.EventData.Data)) { $d[[string]$x.Name] = [string]$x.'#text' }
      $raw = [string]$d['ShareAccess']
      $share = -1
      try { $share = if ($raw -like '0x*') { [Convert]::ToInt32($raw.Substring(2), 16) } else { [int]$raw } }
      catch { $share = -1 <# not a number: the line below gives the field as Windows wrote it #> }
      $shares = if ($share -lt 0) { 'shares ' + $raw } else {
        'shares ' + $(@(@(1, 'read'), @(2, 'write'), @(4, 'delete')) | Where-Object { $share -band $_[0] } | ForEach-Object { $_[1] }) -join ', ' +
        $(if (-not ($share -band 4)) { ' (NOT delete: a rename is refused while it is open)' } else { '' }) }
      $id = [int]$e.ProcessId
      if ($id -eq $PID) { $anchor = $e.TimeCreated }
      $found += , @($e.TimeCreated, $id, ('opened ' + $d['FileName'] + ', ' + $shares + ', options ' + $d['CreateOptions'] + ', thread ' + $d['IssuingThreadId']))
    }
    if (-not $anchor -and $events.Count) { $anchor = $events[$events.Count - 1].TimeCreated }
    foreach ($p in $procs) {
      if ($anchor -and $p[0] -ge $anchor.AddSeconds(-3) -and $p[0] -le $anchor.AddSeconds(1)) {
        $found += , @($p[0], $p[1], ($p[2] + $(if ($p[3]) { ', parent ' + $p[3] } else { '' })))
      }
    }
    $lines += ('the trace holds ' + $opens + ' open(s) on the box, ' + $procs.Count + ' process start(s) and end(s), from ' +
      $(if ($events.Count) { $events[0].TimeCreated.ToString('h:mm:ss.fff tt') + ' to ' + $events[$events.Count - 1].TimeCreated.ToString('h:mm:ss.fff tt') } else { 'nothing' }) +
      '; this process is ' + $PID + ', and its last open of the folder, the refused one, was at ' + $(if ($anchor) { $anchor.ToString('h:mm:ss.fff tt') } else { '(not in the trace)' }) + $namesWhy)
    foreach ($f in @($found | Sort-Object { $_[0] })) {
      $id = [int]$f[1]
      $who = 'process ' + $id + ' ' + $(if ($names.ContainsKey($id)) { $names[$id] } elseif ($id -eq 4) { 'System' } else { '?' })
      $lines += ('  ' + $f[0].ToString('h:mm:ss.fff tt') + '  ' + $who + ' ' + $f[2])
    }
  } catch { $lines += ('the trace could not be read: ' + $_.Exception.Message) }
  finally { Remove-Item -LiteralPath $Trace.Etl -Force -EA SilentlyContinue }
  return $lines
}

# Stops the trace and removes its file unread: the move went through.
function Remove-ThornswoodOpenTrace($Trace) {
  if (-not $Trace) { return }
  Stop-ThornswoodOpenTrace $Trace
  Remove-Item -LiteralPath $Trace.Etl -Force -EA SilentlyContinue
}
# ---- end StopAndMove.ps1 ----

# The server folders' turn, which the nightly backup takes too (#3247). A copy
# of scripts\deploy\ServerFolderTurn.ps1 below its header, for the reason the
# StopAndMove.ps1 copy above is; tests\test-3247-server-folder-turn.ps1 fails
# when the two differ.
# ---- ServerFolderTurn.ps1 (copy) ----

# The server folders' turn (#3247). The nightly backup reads each game
# server's folder while it runs, and a server install or deploy stops that
# server and renames its folder or its files. On 22 Oct 2026 at 2:21 AM a dev
# publish stopped dev and was refused the folder swap ("Access to the path is
# denied"), because the backup, started 2:15 AM, still had files open under
# it: its log has game-dev\world taken from 2:19:33 to 2:22:00 AM, and the
# dev folders done at 2:27:01 AM. Nothing made the two take turns.
#
# So each takes the turn first: the backup for as long as it reads the server
# folders, an install or a deploy before it stops a server, held until the
# script ends. The turn is server-folders.turn in the backup's own folder
# (C:\Thornswood-Backup on the box, beside the server folders), opened with
# no sharing, so only one process at a time has it open, and Windows gives
# it back when that process ends however it ends: no turn is ever left taken
# by a run that died. Whoever has it writes who and since when beside it, in
# server-folders.turn.who, for the one waiting to say. With no backup folder
# beside the server folders (a scratch root in a harness, a box the backup
# was never installed on) there is nothing to take turns with, and it hands
# back $null.
#
# Hands back the open file, which the caller keeps until it is done; throws
# when the turn has not come in $WaitSeconds, naming who has it, so the
# caller refuses with nothing stopped. $Tell says the one line about waiting.
function Enter-ThornswoodServerFolderTurn([string]$Folder, [string]$Who, [int]$WaitSeconds, [scriptblock]$Tell) {
  if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { return $null }
  $turn = Join-Path $Folder 'server-folders.turn'
  $note = Join-Path $Folder 'server-folders.turn.who'
  $until = (Get-Date).AddSeconds($WaitSeconds)
  $told = $false
  while ($true) {
    try {
      $held = [IO.File]::Open($turn, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      [IO.File]::WriteAllText($note, ($Who + ', pid ' + $PID + ', since ' + (Get-Date).ToString('h:mm:ss tt')))
      return $held
    } catch [IO.IOException] {
      # Only "another process has it open" is a wait: 0x80070020 or 21 on
      # Windows, 11 where .NET locks with flock. Anything else is thrown.
      $e = $_.Exception
      if ($e.GetType() -ne [IO.IOException] -or @(0x80070020, 0x80070021, 11) -notcontains $e.HResult) { throw }
      $who = ''
      try { $who = [IO.File]::ReadAllText($note).Trim() } catch { $who = 'a run that has not said who it is (' + $_.Exception.Message + ')' }
      if ((Get-Date) -ge $until) { throw ('the server folders are still taken after ' + $WaitSeconds + ' s, by ' + $who) }
      if (-not $told) { [void](& $Tell ('waiting for the server folders, which ' + $who + ' has')); $told = $true }
      Start-Sleep -Seconds 2
    }
  }
}
# ---- end ServerFolderTurn.ps1 ----

# The hold (#5155): the server stopped on purpose says so, so the box's
# watchdog does not start it in the middle of the install. A copy of
# scripts\vps\ServerHold.ps1 below its header, for the reason the
# StopAndMove.ps1 copy above is; tests\test-5155-server-holds.ps1 fails when
# the two differ. StopServer writes it, and Finish, the one way out, takes it
# away.
# ---- ServerHold.ps1 (copy) ----

# The folder the watchdog lives in on the box. Holds go in holds\ under it.
$ThornswoodHoldRoot = 'C:\Thornswood-Watch'
# Minutes: what a hold is when nobody says, and the most it can be.
$ThornswoodHoldUsual = 30
$ThornswoodHoldMost = 120

# Where the hold for a task or service lives.
function Get-ThornswoodHoldFile {
    param([Parameter(Mandatory = $true)][string]$Target, [string]$Root = $ThornswoodHoldRoot)
    $name = ($Target -replace '[^A-Za-z0-9]+', '-').Trim('-')
    return (Join-Path (Join-Path $Root 'holds') ($name + '.json'))
}

# Writes the hold and says it in one line. $Target is the task or service
# name the watchdog knows it by ('Thornswood Server', 'ThornswoodBot'), $Why
# what the stop is for, $By who is stopping it, $Minutes how long, which is
# put between 1 and the most. With no watchdog folder there is no watchdog to
# hold back, and it says so and writes nothing.
function Set-ThornswoodHold {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)][string]$Why,
        [string]$By = '',
        [int]$Minutes = $ThornswoodHoldUsual,
        [string]$Root = $ThornswoodHoldRoot
    )
    if (-not $Root -or -not (Test-Path -LiteralPath $Root -PathType Container)) {
        return ('no hold   ' + $Target + ': there is no ' + $Root + ', so no watchdog runs here to hold back')
    }
    if ($Minutes -lt 1) { $Minutes = 1 }
    if ($Minutes -gt $ThornswoodHoldMost) { $Minutes = $ThornswoodHoldMost }
    if (-not $By) { $By = '' + $env:USERNAME }
    $file = Get-ThornswoodHoldFile -Target $Target -Root $Root
    $dir = Split-Path -Parent $file
    $now = Get-Date
    $until = $now.AddMinutes($Minutes)
    try {
        if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -Force -ErrorAction Stop }
        $row = ConvertTo-Json @{
            target = $Target; by = $By; why = $Why
            set = ([DateTimeOffset]$now).ToUnixTimeSeconds(); until = ([DateTimeOffset]$until).ToUnixTimeSeconds()
        } -Compress
        # Written beside it and moved over it, so the watchdog never reads half a file.
        $tmp = $file + '.tmp'
        [IO.File]::WriteAllText($tmp, $row, (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $tmp -Destination $file -Force -ErrorAction Stop
    } catch {
        return ('NO HOLD   ' + $Target + ': ' + $file + ' could not be written (' + $_.Exception.Message + '), so the watchdog may start it again within five minutes')
    }
    return ('held      ' + $Target + ' until ' + $until.ToString('HH:mm', [Globalization.CultureInfo]::InvariantCulture) + ' box time (' + $Minutes + ' min), by ' + $By + ': ' + $Why)
}

# Takes the hold away and says so in one line. From then on the watchdog
# treats the server as it treats any other: not answering is started again.
function Clear-ThornswoodHold {
    param([Parameter(Mandatory = $true)][string]$Target, [string]$Root = $ThornswoodHoldRoot)
    if (-not $Root) { return ('no hold   ' + $Target + ' to take away') }
    $file = Get-ThornswoodHoldFile -Target $Target -Root $Root
    if (-not (Test-Path -LiteralPath $file)) { return ('no hold   ' + $Target + ' to take away') }
    try { Remove-Item -LiteralPath $file -Force -ErrorAction Stop }
    catch { return ('HOLD LEFT ' + $Target + ': ' + $file + ' could not be removed (' + $_.Exception.Message + '), so the watchdog leaves it alone until the hold runs out') }
    return ('released  ' + $Target + ', the watchdog watches it again')
}

# The holds there are, one line each, for a person or a script to read.
function Get-ThornswoodHolds {
    param([string]$Root = $ThornswoodHoldRoot)
    $dir = Join-Path $Root 'holds'
    $files = @(Get-ChildItem -LiteralPath $dir -Filter '*.json' -File -EA SilentlyContinue)
    if (-not $files.Count) { return 'holds     none' }
    foreach ($f in $files) {
        $j = $null
        try { $j = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json }
        catch {
            # A file that does not read is a hold all the same: said on the next line.
            $j = $null
        }
        if (-not $j) { 'held      ' + $f.BaseName + ': the file does not read, so it holds for ' + $ThornswoodHoldUsual + ' min from ' + $f.LastWriteTime.ToString('HH:mm'); continue }
        $until = [DateTimeOffset]::FromUnixTimeSeconds([int64]$j.until).LocalDateTime
        $most = $f.LastWriteTime.AddMinutes($ThornswoodHoldMost)
        if ($until -gt $most) { $until = $most }
        'held      ' + $j.target + ' until ' + $until.ToString('HH:mm') + ' box time, by ' + $j.by + ': ' + $j.why
    }
}

# The text a script sends in front of what runs on the box: these functions
# and the three values, so the box needs nothing of its own. With -Script, a
# $HoldBy line too, naming that script and where it was started
# (Get-ThornswoodHoldBy), for the holds it writes.
function Get-ThornswoodHoldScript {
    param([string]$Script = '')
    $parts = @(
        ('$ThornswoodHoldRoot = ''' + $ThornswoodHoldRoot + ''''),
        ('$ThornswoodHoldUsual = ' + $ThornswoodHoldUsual),
        ('$ThornswoodHoldMost = ' + $ThornswoodHoldMost)
    )
    if ($Script) { $parts += ('$HoldBy = ''' + (Get-ThornswoodHoldBy -Script $Script).Replace("'", "''") + '''') }
    foreach ($n in 'Get-ThornswoodHoldFile', 'Set-ThornswoodHold', 'Clear-ThornswoodHold', 'Get-ThornswoodHolds') {
        $parts += ('function ' + $n + ' {' + (Get-Item ('function:' + $n)).ScriptBlock.ToString() + '}')
    }
    return (($parts -join "`r`n") + "`r`n")
}

# Who is stopping it, for the hold's by: the script and the machine it was
# started on, so staff reading the watchdog's message know who to ask.
function Get-ThornswoodHoldBy {
    param([Parameter(Mandatory = $true)][string]$Script)
    $who = '' + $env:USERNAME
    $where = '' + $env:COMPUTERNAME
    if (-not $where) { $where = '' + [Environment]::MachineName }
    if ($who) { return ($Script + ' (' + $who + ' on ' + $where + ')') }
    return ($Script + ' (on ' + $where + ')')
}
# ---- end ServerHold.ps1 ----

# A folder rename on one volume, once (Move-ThornswoodPath above), saying why
# when it is refused.
function MoveDir([string]$from, [string]$to) {
    if (Move-ThornswoodPath $from $to) { return $true }
    Say ("could not move {0} to {1}: {2}" -f $from, $to, $ThornswoodMoveWhy) 'Red'
    return $false
}

<#
  THE OLD SERVER LETTING GO, WHICH IT DOES NOT ALWAYS DO ON ITS OWN.

  Stopping a scheduled task asks the process to end. It does not wait for it,
  and node does not drop its file handles the instant it is asked: the
  resources server under data\api holds the plugin files it is serving. A
  folder cannot be renamed while anything in it is open, so what is still
  running under this root is stopped outright and each process is waited for
  until it has exited, which is when its handles are closed (#2928: on the box
  a folder whose file a just-stopped node held was refused 15 times in 15 when
  renamed at once, and 0 in 15 once that node had exited).

  By this root and nothing else, because the live and the dev server are both
  node. The task runs cmd.exe, which starts server-log.js under node with this
  root's paths on its line, and that node starts the server with a relative
  path on its command line (#2349), so cmd and the writer are found by the
  root on their lines and the server as the writer's child. The trailing backslash matters: C:\Thornswood-Server
  is a prefix of C:\Thornswood-Server-Dev.
#>
# Ours only: cmd.exe with this root's log on its line, the node it started
# (whose own line is relative), and any node with the root on its line. The
# game port alone is not proof: a scratch root holding a copy of the live
# settings names 7777, and the process there is the live server
# (RESTORING.md in the ops repo installs into one). Each as its Win32_Process.
function ServerProcesses([string]$dir) {
    $mark = $dir + '\'
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine })
    $ids = @()
    foreach ($p in $all) {
        if (($p.Name -eq 'node.exe' -or $p.Name -eq 'cmd.exe') -and
            $p.CommandLine.IndexOf($mark, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $ids += [int]$p.ProcessId }
    }
    foreach ($p in $all) {
        if ($p.Name -eq 'node.exe' -and $ids -contains [int]$p.ParentProcessId) { $ids += [int]$p.ProcessId }
    }
    @($all | Where-Object { $ids -contains [int]$_.ProcessId })
}

function StopServer([string]$dir) {
    # Held on purpose from the first stop until Finish (#5155), under the
    # task's name, which is how the watchdog knows it.
    if (-not $NoTask -and -not $script:heldTask) {
        Say (Set-ThornswoodHold -Target $TaskName -Why ('installing a server build into ' + $Root) -By (Get-ThornswoodHoldBy -Script 'Install-ThornswoodServer.ps1')) 'DarkGray'
        $script:heldTask = $TaskName
    }
    # Found and opened before the task is stopped, so what is waited for
    # below is these processes and nothing given their ids afterwards.
    $ids = @(ServerProcesses $dir | ForEach-Object { [int]$_.ProcessId })
    $held = @(Get-ThornswoodProcessHeld $ids)
    foreach ($l in @($ThornswoodNotHeld)) { Say $l 'Red' }
    # No task yet is nothing to stop. One that is there and will not stop is
    # said: its processes are ended by id below whatever it does.
    if (-not $NoTask -and (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
        try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop }
        catch { Say ("the task {0} would not stop ({1}); its processes are stopped by id instead" -f $TaskName, $_.Exception.Message) 'Yellow' }
    }
    foreach ($p in $held) { Say ("stopped pid {0}" -f $p.Id) 'Yellow' }
    # Each waited for until it has exited, which is when its files and its
    # ports are closed. One that has not is said, and the folder rename that
    # follows is refused and says what holds it; this is a rollback's path as
    # well as an install's, so it does not stop half way.
    foreach ($l in @(Stop-ThornswoodProcessHeld $held)) { Say $l 'Red' }
}

# Both of its ports, from the box itself, for up to -Wait seconds (the shared
# ceiling unless this run passed -Wait, ServerReadyWait.ps1, #1938). UDP alone
# is not enough: the resources port is what the launcher and the client fetch
# from, and it only opens once the native server has been built without throwing.
function Answers([string]$dir) {
    $port = GamePortOf $dir
    $res = if ($port -eq 7777) { 3000 } else { $port + 1 }
    $until = (Get-Date).AddSeconds($Wait)
    $why = ''
    while ($true) {
        # Listed whole and filtered, as StopServer does: nothing on the port yet
        # is what an empty list says, not an error. A list that cannot be had
        # is not answering, and is said when the wait runs out.
        $udp = $false
        try { $udp = @(Get-NetUDPEndpoint -ErrorAction Stop | Where-Object { $_.LocalPort -eq $port }).Count -gt 0 }
        catch { $why = 'the UDP ports could not be listed: ' + $_.Exception.Message }
        $tcp = $false
        if ($udp) {
            $c = New-Object Net.Sockets.TcpClient
            try {
                $null = $c.BeginConnect('127.0.0.1', $res, $null, $null).AsyncWaitHandle.WaitOne(500)
                $tcp = $c.Connected
            } catch { $why = $_.Exception.Message }
            finally { $c.Close() }
        }
        if ($tcp) { return $true }
        if ((Get-Date) -gt $until) {
            if ($why) { Say ("not answering on {0} or {1}; the last try said: {2}" -f $port, $res, $why) 'Yellow' }
            return $false
        }
        Start-Sleep -Milliseconds 700
    }
}

function TailLog([string]$dir) {
    $log = Join-Path $dir 'server.log'
    if (Test-Path -LiteralPath $log) {
        Get-Content -LiteralPath $log -Tail 30 | ForEach-Object { Say "    $_" 'Yellow' }
    } else {
        Say '    nothing was written, so node never started. Check that node is on the machine PATH.' 'Yellow'
    }
}

<#
  WHAT SURVIVES A REINSTALL, carried from the folder going out to the one
  coming in. Moved rather than copied, so nothing is set aside in %TEMP% any
  more and never cleaned up, and so the folder going out keeps what it
  shipped with and nothing it did not.

  world holds every character on the server. private holds the roster:
  door.json, allowed.json and characters.json; gamemode.js wrote down on
  20 September what losing it costs ("the character register silently stops
  being saved, the door silently never fetches a roster, and /tp silently
  refuses everybody"), and Patrick hit it on 21 September on the dev server.
  Neither has anything a build ships, so each moves whole, and only into a
  folder that has none: -FreshWorld leaves the world where it was, and a
  put-back keeps the world the folder it brings back already has. for-bot
  moves the same way (#2321): the gamemode's staff log, moderation.log,
  which the bot reads by the rule on that folder, and the rule moves with it.

  data does have shipped contents. The gamemode writes runtime state into it
  while people are online, so every file in it that the incoming folder's
  payload did not bring is copied across: runtime state comes along, and
  anything the build ships stays at the version being installed. What a
  payload brought is listed in .payload-data.txt as it is unpacked; a folder
  from before that list existed falls back to the old rule, only what it does
  not have.

  Except data\thornswood-deploy.json (#459). It is not runtime state: it is
  the deploy record of the folder it sits in, the artifact that folder's
  gamemode came from. Carried, the new folder named the old one's gamemode
  (30 Sep: e445101a, with 32dea10d installed), and a put-back had the newer
  folder's record copied over the one that came back. So each folder keeps its
  own, Publish-Server.ps1 writes the new one once this has said INSTALL OK,
  and after a put-back the folder that came back is recorded by its own
  (Restore-ThornswoodServerRecord, Artifact.ps1).

  And the logs, entry 220: server.log and thornswood.log sat in the root and
  went with every install, taking the evidence for whatever the server did
  before it. They move across and are rolled, never deleted.
#>
function Carry([string]$from, [string]$to, [bool]$skipWorld) {
    foreach ($name in 'world', 'private', 'for-bot') {
        if ($name -eq 'world' -and $skipWorld) { Say "the world is left in $from, as -FreshWorld asked" 'Yellow'; continue }
        $a = Join-Path $from $name
        $b = Join-Path $to $name
        if (-not (Test-Path -LiteralPath $a)) { continue }
        if (Test-Path -LiteralPath $b) { Say "$b is already there, so the $name in $from is left where it is" 'Yellow'; continue }
        if (MoveDir $a $b) { Say "$name carried across" 'Cyan' }
        else { Say "COULD NOT MOVE $a TO $b" 'Red'; $script:carryFailed = $true }
    }
    $a = Join-Path $from 'data'
    $b = Join-Path $to 'data'
    if (Test-Path -LiteralPath $a) {
        $list = Join-Path $to '.payload-data.txt'
        $shipped = $null
        if (Test-Path -LiteralPath $list) {
            $shipped = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
            foreach ($l in [IO.File]::ReadAllLines($list)) { if ($l) { [void]$shipped.Add($l) } }
        }
        $kept = 0
        # Listed from the long path. $a follows $from, which can be a
        # short 8.3 path, and FullName is the long one (issue #1156).
        $listedA = (Get-Item -LiteralPath $a).FullName
        foreach ($f in @(Get-ChildItem -LiteralPath $listedA -Recurse -File -Force -ErrorAction SilentlyContinue)) {
            $rel = $f.FullName.Substring($listedA.Length).TrimStart('\')
            # The folder's own deploy record stays with it (#459, above).
            if ($rel -eq 'thornswood-deploy.json') { continue }
            $dest = Join-Path $b $rel
            if ($shipped) { if ($shipped.Contains($rel)) { continue } }
            elseif (Test-Path -LiteralPath $dest) { continue }
            New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
            Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
            $kept++
        }
        if ($kept -gt 0) { Say ("kept $kept runtime file" + $(if ($kept -eq 1) { '' } else { 's' }) + ' in data, including the character book') 'Cyan' }
    }
    # A log left behind is said, never passed over (#2349): server.log and
    # its rolled copies hold the address of every connection, and the 30 days
    # are kept by server-log.js in the folder the task runs, so one left in
    # $from is outside them until somebody deletes it there. With the server
    # stopped, only another program reading it can hold it.
    $moved = 0
    foreach ($f in @(Get-ChildItem -LiteralPath $from -File -Force -ErrorAction SilentlyContinue |
                     Where-Object { $_.Name -match '\.log(\.\d+)?$' })) {
        $dest = Join-Path $to $f.Name
        if (Test-Path -LiteralPath $dest) { continue }
        try { Move-Item -LiteralPath $f.FullName -Destination $dest -Force -ErrorAction Stop; $moved++ }
        catch { Say ("could not carry {0} across ({1}); it stays in {2}, where nothing keeps it to 30 days, so delete it there" -f $f.Name, $_.Exception.Message, $from) 'Yellow' }
    }
    if ($moved -gt 0) { Say 'logs carried across, to be rolled rather than deleted' 'Cyan' }
}

# The newest few of each kind of folder beside the root. One it cannot
# remove is said, with what Windows answered: until #3183 both the listing
# and the removal threw their errors away, and eleven dev copies (about
# 0.4 GB each) piled up over nine days with nothing saying why.
function Prune([string]$kind, [int]$n) {
    # A first install into a folder not made yet has nothing beside it.
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { return }
    $old = @(Get-ChildItem -LiteralPath $parent -Directory -Force -ErrorAction Stop |
        Where-Object { $_.Name -like ($leaf + $kind) } | Sort-Object Name -Descending | Select-Object -Skip $n)
    foreach ($d in $old) {
        try { Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction Stop }
        catch { Say ("PRUNE FAILED: could not remove {0}, one of the old copies past the newest {1}: {2}" -f $d.FullName, $n, $_.Exception.Message) 'Yellow' }
    }
}

# ---- the task --------------------------------------------------------------
# What the task runs and how, registered over whatever task has the name.
# $writer is server-log.js in the root.
function Register-ServerTask([string]$writer) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }

    # The server runs under server-log.js, which writes its log (#2349). A
    # scheduled task throws its child's stdout and stderr away, so a server
    # that refuses to start would leave nothing behind at all: the task
    # reports it ran, the port never opens, and there is no way to find out
    # why without sitting in an ssh session running it by hand. server-log.js
    # starts the server with both streams piped to it and writes them to
    # server.log, rolled at midnight and at 4 MB, and keeps no line in it or
    # in any rolled copy for longer than 30 days (Patrick, 12 Oct 2026: the
    # engine writes every connecting address there). Until then this was
    # cmd's >> server.log 2>&1, which held the file open for as long as the
    # server ran, so it could only be rolled by size in front of a start
    # (Roll-Log.ps1) and never by age. See scripts\vps\Server-Log.js.
    #
    # It goes through cmd's start /high, for the priority (below), and
    # server-log.js gives the server its own priority as it starts it. /b
    # keeps it in cmd's console and /wait keeps cmd, and so the task, running
    # until the server ends. server-log.js ends with the server's exit code,
    # and start leaves cmd's exit code 0 whatever that was, so call exit
    # %^errorlevel% hands it back, and the task's last result says how the
    # server ended, as it did before (measured 12 Oct: 3 for a node that
    # exited 3, 0 without it). The log path is on the line, which is how
    # ServerProcesses finds this root's cmd.exe.
    #
    # --also thornswood.log (#2166): the gamemode's own log, in this same
    # folder (the task's working directory), names people too and used to
    # roll by size only. server-log.js moves it aside daily and cuts every
    # rolled copy of it to 90 days, so nothing in game\ had to change.
    $log = Join-Path $Root 'server.log'
    $cmd = ('/c "start "" /b /wait /high "{0}" "{1}" --log "{2}" --also thornswood.log dist_back/skymp5-server.js & call exit %^errorlevel%"' -f $node.Source, $writer, $log)
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" `
                                      -Argument $cmd `
                                      -WorkingDirectory $Root
    $triggers = @(New-ScheduledTaskTrigger -AtStartup)

    # High, above everything else on the box (#2491). Decided by Patrick on
    # 12 Oct 2026 at about 6:20 PM: "we need to fix it so the servers run on
    # high priority". The VPS has six cores, and the six build runners are
    # Windows services at Normal (Install-Runner.ps1), so until then a build
    # took the processor from both game servers at the same priority as them.
    # Voice runs High the same way (Install-Voice.ps1); the site, Caddy, the
    # bot and the runners stay Normal.
    #
    # It takes both halves. -Priority 1 is HIGH_PRIORITY_CLASS in Microsoft's
    # table (0 is realtime, never used here: it can hold back the box's own
    # disk and network work; 2 and 3 are above normal, 4 to 6 normal), and it
    # starts the task's cmd.exe High. But a process started from a High one
    # runs Normal unless it is asked for another class (CreateProcess hands
    # the parent's class on only for Idle and BelowNormal), so node, cmd's
    # child, still ran Normal at priority 1: measured 12 Oct on a scratch task
    # as SYSTEM, cmd High and its child Normal. start /high asks for High.
    # Measured the same way with both: node High, I/O priority 2 and memory
    # priority 5, the same I/O and memory priority it had at 4.
    #
    # Never left at Task Scheduler's default of 7, which is where this began
    # (#1931). A task registered without -Priority starts its process below
    # normal, with I/O priority 1 (low) and memory priority 2, and node,
    # started by the task's cmd.exe, inherits all three. Measured on the VPS
    # on 5 October: both game servers ran BelowNormal, I/O priority 1, memory
    # priority 2, while the build runners, the bot and lsass ran Normal, 2
    # and 5.
    #
    # The low I/O priority is what the server waited on when somebody first
    # entered a cell (#1931). The kernel trace of 4 October 17:19
    # (logs\dev\stall-trace-20261004-173319) has the dev server's main thread
    # reading its own memory back from pagefile.sys: 91 reads in a login that
    # took 1.9 s, 51 in the 2.1 s after a move into WhiterunWorld. Every read
    # went out at low priority and took 24 ms on average, up to 78 ms, held
    # back in steps of the 15.6 ms clock tick, while none of the 79,000 normal
    # priority I/Os on the same disk in those 90 s took 5 ms. Windows holds
    # low priority I/O back while normal priority I/O is going, and on the VPS
    # it always is, mostly from the two servers' own saves; low priority I/O
    # waited longest in the seconds the build job did no I/O at all.
    #
    # Memory priority 2 puts the server's pages below every service's: first
    # to be trimmed from its working set, and once trimmed, first to be given
    # to other uses, after which touching them again is a read from the page
    # file. Priority 1 gives memory priority 5, so nothing else sets it.
    #
    # tests\test-server-task-priority.ps1 registers a task with these settings
    # and this command line, and measures the CPU, I/O and memory priority of
    # the program it starts.
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
                                             -DontStopIfGoingOnBatteries `
                                             -StartWhenAvailable `
                                             -RestartCount 999 `
                                             -RestartInterval (New-TimeSpan -Minutes 1) `
                                             -ExecutionTimeLimit ([TimeSpan]::Zero) `
                                             -Priority 1
    # LOCAL SERVICE, Limited, with a SID of its own, and the grants on its
    # folder that go to that SID (#2578, ServiceAccount.ps1). -AsSystem is
    # SYSTEM, Highest, as it was. A task whose SID cannot be looked up, or
    # whose grants cannot be written, goes back on SYSTEM rather than start a
    # server that cannot write its world.
    $principal = New-ThornswoodServicePrincipal -AsSystem:$AsSystem

    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
                           -Settings $settings -Principal $principal | Out-Null
    if (-not $AsSystem) {
        $why = ''
        $sid = Get-ThornswoodTaskSid $TaskName
        if (-not $sid) { $why = "the task's own SID, NT TASK\$TaskName, could not be looked up" }
        else {
            try {
                foreach ($l in @(Grant-ThornswoodServiceFolder -Root $Root -Sid $sid -Writable 'world', 'data', 'private', 'for-bot' -Files '*.log', '*.log.*')) { Say $l 'DarkGray' }
                # What it makes is its own, not every service's (#4077), and
                # what it made in the copies an install moved aside too.
                $copies = @(Get-ChildItem -LiteralPath (Split-Path -Parent $Root) -Directory -Force -ErrorAction SilentlyContinue |
                            Where-Object { $_.Name -like ((Split-Path -Leaf $Root) + '.*') } | ForEach-Object { $_.FullName })
                foreach ($l in @(Set-ThornswoodTaskOwner -TaskName $TaskName -Sid $sid -Action $action -Roots (@($Root) + $copies))) { Say $l 'DarkGray' }
            } catch { $why = 'its folder could not be granted to it: ' + $_.Exception.Message }
        }
        if ($why) {
            Say ("$why, so the task goes back on SYSTEM") 'Red'
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
                                   -Settings $settings -Principal (New-ThornswoodServicePrincipal -AsSystem) | Out-Null
        } else { Say "the task runs as LOCAL SERVICE, Limited, as NT TASK\$TaskName" 'Cyan' }
    }
    Write-Host "scheduled task '$TaskName' registered, starts at boot, restarts every minute if it stops" -ForegroundColor Cyan
}

# ---- the log writer (#2349) -------------------------------------------------
# Server-Log.js goes into the root as server-log.js, from beside this script
# (Publish-Server sends the two together to C:\) or, run from a checkout,
# from scripts\vps. The full path in the root, or '' when neither is there:
# the task cannot start the server without it, so the callers refuse.
function Copy-LogWriter {
    $here = $PSScriptRoot
    $src = $null
    foreach ($cand in @((Join-Path $here 'Server-Log.js'), (Join-Path $here '..\vps\Server-Log.js'))) {
        if (Test-Path -LiteralPath $cand) { $src = $cand; break }
    }
    if (-not $src) { return '' }
    $to = Join-Path $Root 'server-log.js'
    Copy-Item -LiteralPath $src -Destination $to -Force
    return $to
}

# An install's roll: today's server.log moved aside whatever its size, so the
# run this install starts has a file of its own and the tail read after it is
# only this run, and every rolled file cut to the last 30 days. Never deleted
# whole: deleting it is how the evidence for the last crash disappeared.
# thornswood.log is aged with it, to 90 days (#2166).
function Roll-ServerLog([string]$writer) {
    $log = Join-Path $Root 'server.log'
    $gm = Join-Path $Root 'thornswood.log'
    & $node.Source $writer --log $log --also $gm --roll | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
    if ($LASTEXITCODE -ne 0) { Say ("server-log.js could not roll server.log (exit {0}); the server appends to it and rolls it at midnight" -f $LASTEXITCODE) 'Yellow' }
}

# The priority node runs at under this root, read back after a start (#2491).
function Show-ServerPriority([string]$dir) {
    $nodes = @(ServerProcesses $dir | Where-Object { $_.Name -eq 'node.exe' })
    if (-not $nodes.Count) { Say "no node is running under $dir, so there is no priority to read" 'Yellow'; return }
    foreach ($p in $nodes) {
        $class = 'unreadable'
        $proc = Get-Process -Id ([int]$p.ProcessId) -ErrorAction SilentlyContinue
        if (-not $proc) { Say ("node, pid {0}, has already gone" -f $p.ProcessId) 'Yellow'; continue }
        try { $class = [string]$proc.PriorityClass } catch { $class = 'unreadable (' + $_.Exception.Message + ')' }
        Say ("node, pid {0}, runs at {1} priority" -f $p.ProcessId, $class) $(if ($class -eq 'High') { 'Green' } else { 'Yellow' })
    }
}

# ---- -TaskOnly: the task again, and nothing else (#2491) -----------------------
if ($TaskOnly) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root 'dist_back\skymp5-server.js'))) {
        Say "there is no server in $Root (no dist_back\skymp5-server.js), so there is nothing for the task to start. Nothing was changed." 'Red'
        Finish 'INSTALL REFUSED' 1
    }
    $writer = Copy-LogWriter
    # The task as it is now, for the way back.
    $oldXml = $null
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { $oldXml = (Export-ScheduledTask -TaskName $TaskName | Out-String) }
    $gamePort = GamePortOf $Root
    $resPort = if ($gamePort -eq 7777) { 3000 } else { $gamePort + 1 }
    Say 'stopping the server' 'Cyan'
    StopServer $Root
    Register-ServerTask $writer
    Roll-ServerLog $writer
    Start-ScheduledTask -TaskName $TaskName
    Say ("started through the new task, giving it {0} seconds to answer on UDP {1} and on {2}" -f $Wait, $gamePort, $resPort) 'DarkGray'
    if (Answers $Root) {
        Say ("the server is answering on {0}, game port {1}" -f $resPort, $gamePort) 'Green'
        Show-ServerPriority $Root
        Finish 'INSTALL OK' 0
    }
    Write-Host ''
    Say 'the server did not come up under the new task. Its log says:' 'Red'
    TailLog $Root
    if (-not $oldXml) {
        Say "there was no task named $TaskName before this, so there is none to put back" 'Red'
        Finish 'INSTALL FAILED' 1
    }
    Say 'putting the task it had back' 'Yellow'
    StopServer $Root
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $TaskName -Xml $oldXml | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    if (Answers $Root) { Say ("the task it had is back and the server is answering on {0}" -f $resPort) 'Yellow' }
    else { Say "THE TASK IT HAD IS BACK AND THE SERVER STILL IS NOT ANSWERING on $resPort" 'Red'; TailLog $Root }
    Finish 'INSTALL ROLLED BACK' 1
}

# ---- Windows's own record of who opens the server's folder (#5211) ----------
# From here until the folder is moved: when the move is refused, every open
# of the folder itself in that time is said, by which process and sharing
# what, which no look taken after the refusal could name (StopAndMove.ps1,
# Start-ThornswoodOpenTrace). Reads only; Finish stops it on every way out.
if (Test-Path -LiteralPath $Root) {
    $script:openTrace = Start-ThornswoodOpenTrace ('thornswood-install-' + $PID)
    if (-not $script:openTrace) { Say ("Windows's open trace is not running, so a refused move can only say what holds the folder afterwards: " + $ThornswoodTraceWhy) 'DarkGray' }
}

# ---- the stage: nothing running is touched -----------------------------------
if (-not $PutBack) {
    $bad = @()
    function Refuse([string[]]$why) {
        Write-Host ''
        foreach ($w in $why) { Say "REFUSED: $w" 'Red' }
        Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
        Say 'the stage is cleared, and the server was not stopped or changed' 'Red'
        Finish 'INSTALL REFUSED' 1
    }
    if ($ZipSha256) {
        $have = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash
        if ($have -ne $ZipSha256.ToUpperInvariant()) { Refuse @("$Zip arrived different from what was sent") }
        Say 'the zip is what was sent' 'DarkGray'
    }
    # A stage a run that died part way left behind was never swapped in.
    Prune '.stage-*' 0
    New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
    Expand-Archive -LiteralPath $Zip -DestinationPath $stageDir -Force
    Say "unpacked to $stageDir" 'Cyan'
    # -FromStore (#459, the header): the record's build out of the store, into
    # the stage, before what the payload brought into data is listed, so the
    # compiled Papyrus counts as shipped. Onto a running server only.
    if ($FromStore) {
        $runSettings = Join-Path $Root 'server-settings.json'
        if (-not (Test-Path -LiteralPath $runSettings)) {
            Refuse @("-FromStore keeps the running server's load order, start point and plugins, and there is no server in $Root to keep them from. A first install takes a whole payload: Publish-Server.ps1 with -Dist.")
        }
        $rp = Join-Path $stageDir 'server-build.json'
        $want = $null
        try { $want = Read-ThornswoodRecord -Path $rp -Kind server-build } catch { Refuse @("the payload's server-build.json cannot be trusted, so nothing says which build to take out of the store: $($_.Exception.Message)") }
        $got = Expand-ThornswoodStoredServerBuild -Store $Store -Record $want -RecordSum (Get-ThornswoodRecordSum ([IO.File]::ReadAllBytes($rp))) -Into $stageDir
        if ($got.Problem) { Refuse @($got.Problem) }
        foreach ($l in $got.Said) { Say $l 'Cyan' }
        # The light plugin rule of the engine the running order was written for
        # (ServerOrder.ps1, #1715), against this one's: lightPlugins true or not.
        $runRec = Join-Path $Root 'server-build.json'
        $runLight = $false
        if (Test-Path -LiteralPath $runRec) {
            try { $rl = [IO.File]::ReadAllText($runRec) | ConvertFrom-Json; $runLight = ($rl.PSObject.Properties.Name -contains 'lightPlugins' -and $rl.lightPlugins -eq $true) } catch { $runLight = $false }
        }
        $newLight = ($want.PSObject.Properties.Name -contains 'lightPlugins' -and $want.lightPlugins -eq $true)
        if ($runLight -ne $newLight) {
            Refuse @(('the running server''s load order was written for an engine that ' + $(if ($runLight) { 'loads' } else { 'does not load' }) + ' light plugins, and this build ' +
                      $(if ($newLight) { 'loads' } else { 'does not load' }) + ' them, so every form id after the first light plugin would move (ServerOrder.ps1, #1715). ' +
                      'That goes with a load order written for it: Deploy-Gamemode.ps1, then Publish-Server.ps1 with -Dist.'))
        }
    }
    # What this payload brought into data, for Carry to leave alone.
    $sd = Join-Path $stageDir 'data'
    $shippedData = @()
    if (Test-Path -LiteralPath $sd) {
        $listedSd = (Get-Item -LiteralPath $sd).FullName
        $shippedData = @(Get-ChildItem -LiteralPath $listedSd -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($listedSd.Length).TrimStart('\') })
    }
    [IO.File]::WriteAllLines((Join-Path $stageDir '.payload-data.txt'), [string[]]$shippedData)

    # ---- check the stage before trusting it ----------------------------------
    # A byte order mark on this file is fatal and says nothing useful when it
    # happens: node stops on the first character with "Unexpected token" and the
    # stack points into skymp's settings loader, not at whatever wrote the file.
    # PowerShell 5.1 puts one there when 7 does not, so a payload built on one
    # machine can start fine and the same payload built on another cannot. Taken
    # off here as well as fixed at the source, because payloads built before that
    # fix are still sitting in people's folders.
    $settingsPath = Join-Path $stageDir 'server-settings.json'
    $s = $null
    if (-not (Test-Path -LiteralPath $settingsPath)) { Refuse @('the payload has no server-settings.json') }
    $bytes = [IO.File]::ReadAllBytes($settingsPath)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        [IO.File]::WriteAllBytes($settingsPath, $bytes[3..($bytes.Length - 1)])
        Say 'took a byte order mark off server-settings.json, node cannot parse one' 'Yellow'
    }
    try { $s = Read-ThornswoodRecord -Path $settingsPath -Kind server-settings } catch { Refuse @("the payload's settings cannot be trusted: $($_.Exception.Message)") }

    # The running server's own settings, with only the release's keys taken
    # from the payload (#1222, see the header). Written into the stage, so
    # every check below is of the file that will run. A root with no settings
    # has no server to keep them from, and takes the payload's whole, so those
    # are held to what no server should start with.
    $runPath = Join-Path $Root 'server-settings.json'
    if (Test-Path -LiteralPath $runPath) {
        try { $script:running = [IO.File]::ReadAllText($runPath) | ConvertFrom-Json }
        catch { Refuse @("the settings $Root runs on do not parse ($($_.Exception.Message)), so they cannot be carried across") }
        $m = Join-ThornswoodServerSettings $script:running $s $ThornswoodInstallKeys $asked
        foreach ($l in $m.Said) { Say $l 'Cyan' }
        $s = $m.Settings
        # Before the file is written, so a refusal leaves only the stage to clear.
        # An order that leaves out a plugin the running server loads (#2320).
        $drop = Test-ThornswoodLoadOrderDrop $script:running $s $dropNames
        foreach ($l in $drop.Said) { Say $l 'Yellow' }
        if ($drop.Problem) { Refuse @($drop.Problem) }
        $passWhy = Get-ThornswoodPassSwitchProblem $s $passScript
        if ($passWhy) { Refuse @($passWhy) }
        [IO.File]::WriteAllText($settingsPath, (ConvertTo-Json -InputObject $s -Depth 30), (New-Object Text.UTF8Encoding($false)))
    } else {
        foreach ($k in $askedKeys) {
            $s | Add-Member -NotePropertyName $k -NotePropertyValue $asked.$k -Force
            Say "set as this run asked: $k" 'Cyan'
        }
        $first = @(Get-ThornswoodServerSettingsProblems $s | ForEach-Object { "the payload's settings have $_, and there is no server here whose own settings would be kept instead" })
        $passWhy = Get-ThornswoodPassSwitchProblem $s $passScript
        if ($passWhy) { $first += $passWhy }
        if ($first.Count) { Refuse $first }
        if ($askedKeys.Count) { [IO.File]::WriteAllText($settingsPath, (ConvertTo-Json -InputObject $s -Depth 30), (New-Object Text.UTF8Encoding($false))) }
        Say "there are no settings in $Root yet, so the payload's are its first" 'DarkGray'
    }

    # -FromStore (#459): the running server's plugins, by its own order, into
    # the stage where the payload did not bring one (ours), and none of ours
    # that the order does not name.
    if ($LastPlugin -and -not $FromStore) { Refuse @('-LastPlugin goes with -FromStore: a whole payload carries its own Thornswood-Last.esp.') }
    if ($FromStore) {
        $plugDir = Join-Path $stageDir 'plugins'
        $null = [IO.Directory]::CreateDirectory($plugDir)
        # Thornswood-Last.esp made on the box for this commit (#2791), the one
        # plugin no payload carries, in place of the running server's.
        if ($LastPlugin) {
            if ($LastSha256 -notmatch '^[0-9a-fA-F]{64}$') { Refuse @('-LastPlugin came with no sha256 to hold it to.') }
            if (-not (Test-Path -LiteralPath $LastPlugin -PathType Leaf)) { Refuse @("there is no $LastPlugin, the Thornswood-Last.esp the publish made on the box.") }
            $lastSum = (Get-FileHash -LiteralPath $LastPlugin -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($lastSum -ne $LastSha256.ToLowerInvariant()) { Refuse @("$LastPlugin has sha256 $lastSum, and game\data\last-plugin.json names $($LastSha256.ToLowerInvariant()).") }
            Copy-Item -LiteralPath $LastPlugin -Destination (Join-Path $plugDir 'Thornswood-Last.esp') -Force
            Say "Thornswood-Last.esp made on the box for this commit, sha256 $lastSum, into the stage" 'Cyan'
        }
        $named = @{}
        $taken = 0
        foreach ($p in @($s.loadOrder)) {
            $at = ([string]$p) -replace '/', '\'
            # Not $leaf: that is the root's own name, which Prune and the put
            # back read later in this same scope (#3183).
            $plugLeaf = [IO.Path]::GetFileName($at)
            if ($plugLeaf) { $named[$plugLeaf.ToLowerInvariant()] = $true }
            if (-not $at.StartsWith($Root + '\plugins\', [StringComparison]::OrdinalIgnoreCase)) { continue }
            $into = Join-Path $plugDir $plugLeaf
            if (Test-Path -LiteralPath $into) { continue }
            $from = Join-Path (Join-Path $Root 'plugins') $plugLeaf
            if (Test-Path -LiteralPath $from) { Copy-Item -LiteralPath $from -Destination $into -Force; $taken++ }
        }
        $brought = @(Get-ChildItem -LiteralPath $plugDir -File -Force | Where-Object { -not $named.ContainsKey($_.Name.ToLowerInvariant()) } | ForEach-Object { $_.Name })
        if ($brought.Count) {
            Refuse @(('the payload carries ' + ($brought -join ', ') + ', which the running server''s load order does not name, and -FromStore keeps that order. A change to the order goes with a full publish.'))
        }
        Say ("$taken plugin(s) the running server's load order names taken from $Root\plugins into the stage") 'Cyan'
    }

    # The load order resolves, against the stage. The paths in it are written
    # out in full under the root (Export-ServerPayload writes them for the root
    # it is told), so the root's prefix is read as the stage's: the files are
    # in the stage now and will be at those paths once it is the root. A
    # shortened load order shifts every index after the gap, so a plugin that
    # is nowhere is a refusal, not a warning.
    $order = @($s.loadOrder)
    if (-not $order.Count) { $bad += 'server-settings.json has no loadOrder' }
    $missing = @()
    foreach ($p in $order) {
        $at = ([string]$p) -replace '/', '\'
        if ($at.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) { $at = $stageDir + $at.Substring($Root.Length) }
        if (-not (Test-Path -LiteralPath $at)) { $missing += $p }
    }
    if ($missing.Count) {
        Say ("{0} plugin(s) in the load order are not in the payload or on disk:" -f $missing.Count) 'Red'
        foreach ($m in $missing) { Say "    $m" 'Red' }
        $bad += 'load order does not resolve. The server would refuse to start, and a shortened load order would shift every index after the gap.'
    }
    # What the task starts.
    if (-not $NoTask -and -not (Test-Path -LiteralPath (Join-Path $stageDir 'dist_back\skymp5-server.js'))) {
        $bad += 'the payload has no dist_back\skymp5-server.js, which is what the task starts'
    }
    # The gamemode is there and parses, here, before anything is stopped. A
    # payload with none used to pass this without a word and start a server
    # with no gamemode at all: no door, no join pass (#1336).
    $gm = Join-Path $stageDir 'gamemode.js'
    if (-not (Test-Path -LiteralPath $gm)) {
        $bad += 'the payload has no gamemode.js, so the server would start with no gamemode: no door and no join pass'
    } else {
        # Continue for the call: under Stop, Windows PowerShell turns the first
        # line node writes to stderr into an error that ends this script.
        $eap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { $said = @(& $node.Source --check $gm 2>&1) } finally { $ErrorActionPreference = $eap }
        if ($LASTEXITCODE -ne 0) { $bad += ('gamemode.js does not parse: ' + ((@($said | ForEach-Object { "$_".Trim() } | Where-Object { $_ }) | Select-Object -First 6) -join ' | ')) }
    }
    # And its tables (#5191), the gamemode-tables folder the gamemode reads as
    # it loads: a load without them stops, so a payload with none stops here.
    # The folder is the payload's own and is never carried from the old one.
    $tablesAt = Join-Path $stageDir 'gamemode-tables'
    if (-not @(Get-ChildItem -LiteralPath $tablesAt -Filter '*.json' -File -ErrorAction SilentlyContinue).Count) {
        $bad += 'the payload has no gamemode-tables, so the gamemode would stop as it loads (#5191)'
    }
    # Every server file is the build the payload's own record names: the
    # binary, the JavaScript half the task starts, and the rest the fork
    # builds, and no server file the record does not list (#1214). A payload
    # with no record is server files nobody recorded: Export-ServerPayload
    # puts records\server-build.json in every one.
    $rec = Join-Path $stageDir 'server-build.json'
    if (-not (Test-Path -LiteralPath $rec)) {
        $bad += 'the payload carries no server-build.json, so nothing says its server files are a recorded build'
    } else {
        try {
            $recObj = Read-ThornswoodRecord -Path $rec -Kind server-build
            $bad += @(Get-ThornswoodServerBuildProblems $recObj (Get-ThornswoodServerFolderSums $stageDir) 'the payload' 'server-build.json')
        } catch { $bad += "the payload's server-build.json cannot be trusted: $($_.Exception.Message)" }
    }
    if ($bad.Count) { Refuse $bad }
    Say ("load order: all {0} plugins present" -f $order.Count) 'Green'

    $candidate = $stageDir
    $aside     = "$Root.prev-$stamp"
    $failedAs  = "$Root.failed-$stamp"
} else {
    $last = @(Get-ChildItem -LiteralPath $parent -Directory -Force -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -like ($leaf + '.prev-*') } | Sort-Object Name -Descending | Select-Object -First 1)
    if (-not $last.Count) {
        Say "there is no $leaf.prev-<stamp> beside $Root, so there is nothing to put back" 'Red'
        Finish 'INSTALL REFUSED' 1
    }
    $candidate = $last[0].FullName
    $aside     = "$Root.undone-$stamp"
    # A put-back that does not answer goes back to being the .prev it was.
    $failedAs  = $candidate
    Say "putting back $candidate" 'Cyan'
    # What it brings back is the older release, not the older settings: the
    # running server's go into it, with only the release's keys kept (#1222).
    # A running file that cannot be read does not stop a put-back, which is
    # the way out of a bad install; the folder then goes back as it was.
    $runPath = Join-Path $Root 'server-settings.json'
    $backPath = Join-Path $candidate 'server-settings.json'
    if ((Test-Path -LiteralPath $runPath) -and (Test-Path -LiteralPath $backPath)) {
        try {
            $run = [IO.File]::ReadAllText($runPath) | ConvertFrom-Json
            $back = [IO.File]::ReadAllText($backPath) | ConvertFrom-Json
            $m = Join-ThornswoodServerSettings $run $back $ThornswoodInstallKeys
            foreach ($l in $m.Said) { Say $l 'Cyan' }
            [IO.File]::WriteAllText($backPath, (ConvertTo-Json -InputObject $m.Settings -Depth 30), (New-Object Text.UTF8Encoding($false)))
            $script:running = $run
        } catch {
            Say "the settings could not be read ($($_.Exception.Message)), so $candidate goes back with its own" 'Yellow'
        }
    } else {
        # Said, the same as a file that will not read (#1336): with either
        # missing nothing is carried and nothing is read back afterwards.
        $gone = @(@($runPath, $backPath) | Where-Object { -not (Test-Path -LiteralPath $_) })
        Say ("there is no " + ($gone -join ' and no ') + ", so no settings are carried and $candidate goes back with its own") 'Yellow'
    }
}

# ---- the swap ------------------------------------------------------------------
$hadRoot = Test-Path -LiteralPath $Root
$script:carryFailed = $false
if ($hadRoot) {
    # The nightly backup reads this folder; one of the two at a time (#3247,
    # Enter-ThornswoodServerFolderTurn above). Held until this script ends.
    $turnWhy = ''
    try { $script:serverTurn = Enter-ThornswoodServerFolderTurn (Join-Path $parent 'Thornswood-Backup') ('the server install into ' + $Root) 1200 { param($m) Say $m 'Yellow' } }
    catch { $turnWhy = $_.Exception.Message }
    if ($turnWhy) {
        Say ($turnWhy + ', so nothing was stopped or swapped.') 'Red'
        if (-not $PutBack) { Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue }
        Finish 'INSTALL REFUSED' 1
    }
    Say 'stopping the server' 'Cyan'
    StopServer $Root
    $movedAside = MoveDir $Root $aside
    Stop-ThornswoodOpenTrace $script:openTrace
    if (-not $movedAside) {
        # MoveDir has said what holds it. Start the old one again, and stop
        # rather than half installing. The old folder is exactly as it was.
        Say "could not move $Root aside, so nothing was swapped." 'Red'
        if (-not $PutBack) { Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue }
        if ($StartNow -and -not $NoTask) { Start-ScheduledTask -TaskName $TaskName; Say 'the old server was started again, as it was' 'Yellow' }
        # Read once the old server is starting again, since reading takes
        # seconds and nobody should wait on it.
        Say ("what opened $Root itself from the stage to the refused move, from Windows's own trace (#5211):") 'Yellow'
        foreach ($l in @(Read-ThornswoodOpenTrace $script:openTrace $Root)) { Say ('  ' + $l) 'Yellow' }
        $script:openTrace = $null
        Finish 'INSTALL REFUSED' 1
    }
}
Remove-ThornswoodOpenTrace $script:openTrace
$script:openTrace = $null
if (-not (MoveDir $candidate $Root)) {
    Say "COULD NOT MOVE $candidate TO $Root" 'Red'
    if ($hadRoot -and (MoveDir $aside $Root)) {
        if ($StartNow -and -not $NoTask) { Start-ScheduledTask -TaskName $TaskName }
        Say 'the old server is back where it was' 'Yellow'
        Finish 'INSTALL REFUSED' 1
    }
    Finish 'INSTALL FAILED' 1
}
Say "swapped in; what it replaced is $aside" 'Cyan'
if ($hadRoot) { Carry $aside $Root ([bool]$FreshWorld) }

# The way back: what was carried goes back, the new folder is kept as
# $failedAs to read, the previous one is the root again and, when this run
# starts servers, is started and asked whether it answers.
function GoBack([string]$keptAs) {
    Say 'putting the previous server back' 'Yellow'
    StopServer $Root
    Carry $Root $aside ([bool]$FreshWorld)
    if (-not (MoveDir $Root $failedAs)) {
        Say "COULD NOT MOVE $Root ASIDE, so the previous server is still in $aside. Look at the box." 'Red'
        Finish 'INSTALL FAILED' 1
    }
    if (-not (MoveDir $aside $Root)) {
        Say "COULD NOT MOVE $aside BACK TO $Root. The new one is in $failedAs. Look at the box." 'Red'
        Finish 'INSTALL FAILED' 1
    }
    # The task this install registered runs the server under server-log.js
    # in the root (#2349), and a folder from before it has none.
    $null = Copy-LogWriter
    if ($StartNow -and -not $NoTask) {
        Start-ScheduledTask -TaskName $TaskName
        $gp = GamePortOf $Root
        $rp = if ($gp -eq 7777) { 3000 } else { $gp + 1 }
        if (Answers $Root) { Say ("the previous server is back and answering on {0}" -f $rp) 'Yellow' }
        else { Say "THE PREVIOUS SERVER IS BACK AND IT STILL IS NOT ANSWERING on $rp" 'Red'; TailLog $Root }
    } else {
        Say 'the previous server is back in place, not started, as this run starts nothing' 'Yellow'
    }
    if (-not $PutBack) { Say "$keptAs is kept as $failedAs to read" 'DarkGray' }
    if ($script:carryFailed) { Finish 'INSTALL FAILED' 1 }
    Finish 'INSTALL ROLLED BACK' 1
}

<#
  READ BACK, BEFORE ANYTHING STARTS (#1222). The settings now in the root
  against the file the old server had when it was stopped: every key outside
  the release's own must be the same. The stage was made from the running
  file, so a difference means it moved after that (a deploy that ran in
  between, say), or that the carry did not hold, and either way the new
  folder would start with settings nobody chose. The previous folder goes
  back instead, with what it had.
#>
if ($hadRoot -and $null -ne $script:running) {
    $was = $null
    $now = $null
    $unread = @()
    try { $was = [IO.File]::ReadAllText((Join-Path $aside 'server-settings.json')) | ConvertFrom-Json } catch { $unread += ('the server-settings.json the server had, which cannot be read: ' + $_.Exception.Message) }
    try { $now = [IO.File]::ReadAllText((Join-Path $Root 'server-settings.json')) | ConvertFrom-Json } catch { $unread += ('the server-settings.json now in place, which cannot be read: ' + $_.Exception.Message) }
    if (-not $unread.Count -and ($null -eq $was -or $null -eq $now)) { $unread += 'server-settings.json, which is empty' }
    $moved = $unread
    # What this run asked for (#1804) moved on purpose, as the release's keys did.
    if (-not $unread.Count) { $moved = @(Compare-ThornswoodCarried $was $now @($ThornswoodInstallKeys + $askedKeys)) }
    if ($moved.Count) {
        Say ('read back: ' + ($moved -join ', ') + ' would not be what the server had, so nothing is started and the previous folder goes back') 'Red'
        GoBack 'the folder whose settings did not read back'
    }
    Say 'read back: every setting outside this release is the one the server had' 'Green'
}

# See Carry. A root that has never had a private folder gets an empty one:
# the door writes allowed.json itself once it has fetched, and the register
# writes characters.json, but neither can write into a folder that is not
# there. Saying so here is the difference between "this server has no roster
# yet" and the silence that cost three reports.
$privDir = Join-Path $Root 'private'
if (-not (Test-Path -LiteralPath $privDir)) {
    New-Item -ItemType Directory -Path $privDir -Force | Out-Null
    Say 'no roster to restore: this root has never had a private folder.' 'Yellow'
    Say '  /tp will refuse everybody until door.json is put there.' 'Yellow'
}
# Where the gamemode writes its staff log for the bot (#2321), made here so
# the bot's rule is on the folder before the first staff action makes the
# file, which then takes it. Locked below.
$forBotDir = Join-Path $Root 'for-bot'
if (-not (Test-Path -LiteralPath $forBotDir)) { New-Item -ItemType Directory -Path $forBotDir -Force | Out-Null }

<#
  WHO MAY READ THE SERVER'S FOLDERS, issue #1105.

  A folder made under C:\ inherits Windows' rule that BUILTIN\Users may read
  it and make files in it, and every service account on the box is in Users:
  the bot's NT SERVICE\ThornswoodBot, the site's LOCAL SERVICE, the build
  runner's. So every one of them could read private\door.json, the key the
  site trusts, and the rest of this folder. The stage this install swapped in
  was made under C:\ like any other, so it is locked here, every install:

    the root and everything under it takes nothing from C:\. SYSTEM, which
      the server's task runs as, and Administrators have Full Control. The
      rules put on the folder it replaced by name are carried across: the
      site's read on the files directly in the root and in data
      (Deploy-Docs.ps1 -RunAs), and anything else set on purpose. Users,
      Everyone, Authenticated Users and CREATOR OWNER never are.
    private\ takes nothing from the root either: SYSTEM and Administrators
      only.
    for-bot\ takes nothing from the root either (#2321): SYSTEM and
      Administrators, the rules it has by name, and read for the bot's
      account, NT SERVICE\ThornswoodBot, when the bot's service is on the box,
      on the folder and so on the staff log the gamemode makes in it later.
      Install-Bot.ps1 gives the same rule; given here too, so a server that
      has had no bot install since #2321 does not start a staff log the bot
      cannot open.
    what it replaced, <root>.prev-<stamp> or .undone-<stamp>, is locked the
      same way, since it holds the old settings and data.

  tests\test-server-acl.ps1 runs this on scratch folders and reads it back.
#>
# $readers: SIDs given read on the folder and everything in it (the bot's, on for-bot).
function Lock-ServerDir([string]$dir, [string]$from, [string[]]$readers = @()) {
    $broad = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-3-0')
    $tree = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $carried = @()
    if ($from -and (Test-Path -LiteralPath $from)) {
        $carried = @((Get-Acl -LiteralPath $from).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) |
                     Where-Object { $broad -notcontains $_.IdentityReference.Value })
    }
    $acl = Get-Acl -LiteralPath $dir
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
        if ($broad -contains $r.IdentityReference.Value) { [void]$acl.RemoveAccessRuleSpecific($r) }
    }
    foreach ($r in $carried) { $acl.AddAccessRule($r) }
    foreach ($s in 'S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
            (New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl', $tree, 'None', 'Allow')))
    }
    foreach ($s in @($readers | Where-Object { $_ })) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
            (New-Object Security.Principal.SecurityIdentifier($s)), 'Read', $tree, 'None', 'Allow')))
    }
    # Writes back only the access rules. Set-Acl can also try to write the audit
    # part, which needs a privilege the build runner's account does not have
    # (issue #1120, Set-ThornswoodAclAccess in Bot-Service.ps1).
    $item = Get-Item -LiteralPath $dir -Force
    if ($item -is [IO.DirectoryInfo]) { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]$item, [Security.AccessControl.DirectorySecurity]$acl) }
    else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, [Security.AccessControl.FileSecurity]$acl) }
}
function Lock-ServerRoot([string]$dir, [string]$from, [string]$botSid = '') {
    try {
        Lock-ServerDir $dir $from
        $d = Join-Path $dir 'data'
        if (Test-Path -LiteralPath $d) { Lock-ServerDir $d $(if ($from) { Join-Path $from 'data' } else { '' }) }
        $p = Join-Path $dir 'private'
        if (Test-Path -LiteralPath $p) { Lock-ServerDir $p '' }
        $fb = Join-Path $dir 'for-bot'
        if (Test-Path -LiteralPath $fb) { Lock-ServerDir $fb '' @($botSid) }
        Say "locked $dir to SYSTEM and Administrators, with the rules it had by name; private is theirs alone" 'Cyan'
        if ((Test-Path -LiteralPath $fb) -and $botSid) { Say "the bot's account may read $fb, where the gamemode writes its staff log" 'Cyan' }
    } catch { Say "COULD NOT LOCK ${dir}: $($_.Exception.Message)" 'Red' }
}
# The bot's account, when its service is on this box, for for-bot (#2321).
$botSid = ''
if (Get-Service -Name 'ThornswoodBot' -ErrorAction SilentlyContinue) {
    try { $botSid = (New-Object Security.Principal.NTAccount('NT SERVICE\ThornswoodBot')).Translate([Security.Principal.SecurityIdentifier]).Value }
    catch { Say "the bot's service is here but its account could not be looked up ($($_.Exception.Message)), so for-bot has no rule for it: run .\scripts\deploy\Install-Bot.ps1 once" 'Yellow' }
} else { Say "no bot service on this box, so nothing reads for-bot yet" 'DarkGray' }
Lock-ServerRoot $Root $(if ($hadRoot) { $aside } else { '' }) $botSid
if ($hadRoot -and (Test-Path -LiteralPath $aside)) { Lock-ServerRoot $aside '' }
# The site reads server.log and data here (Deploy-Docs.ps1). Once the Users
# rule is gone it reads them only through its own rule, which a box whose
# site deploy came before this folder existed does not have yet.
$siteTask = Get-ScheduledTask -TaskName 'Thornswood Docs' -ErrorAction SilentlyContinue
if ($siteTask -and $siteTask.Principal.UserId -and $siteTask.Principal.UserId -notmatch '(?i)^(NT AUTHORITY\\)?SYSTEM$') {
    $siteSid = ''
    try { $siteSid = (New-Object Security.Principal.NTAccount([string]$siteTask.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value }
    catch { Say ("the site's task runs as {0}, which does not translate to an account here ({1}), so whether it may read server.log is not known" -f $siteTask.Principal.UserId, $_.Exception.Message) 'Yellow' }
    # On LOCAL SERVICE the site's rule names its task's own SID (#4077).
    if ($siteSid -eq 'S-1-5-19') { $siteSid = Get-ThornswoodTaskSidFromName 'Thornswood Docs' }
    if ($siteSid) {
        $has = @((Get-Acl -LiteralPath $Root).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference.Value -eq $siteSid })
        if (-not $has.Count) { Say "the site's account has no rule on $Root yet, so it cannot read server.log: run .\scripts\deploy\Deploy-Docs.ps1 once" 'Yellow' }
    }
}

# The log writer the task runs the server under (#2349), into the root.
# Found before anything changed (the refusal near the top), so it is there.
$writer = Copy-LogWriter
# A box that had the old roller in its root keeps nothing that runs it.
$oldRoller = Join-Path $Root 'roll-log.ps1'
if (Test-Path -LiteralPath $oldRoller) { Remove-Item -LiteralPath $oldRoller -Force }

# ---- scheduled task --------------------------------------------------------
# Register-ServerTask, above, says what the task is and why.
if (-not $NoTask) { Register-ServerTask $writer }

function Tidy {
    Prune '.prev-*' $Keep
    Prune '.undone-*' 2
    Prune '.failed-*' 1
}

if (-not ($StartNow -and -not $NoTask)) {
    Tidy
    Say 'not started, so not checked. Start it and watch the resources port answer.' 'Yellow'
    Finish 'INSTALL OK' 0
}

# Rolled whatever its size rather than deleted (Roll-ServerLog), so the run
# this install starts has a file of its own and the tail below reads only it.
Roll-ServerLog $writer

Start-ScheduledTask -TaskName $TaskName

<#
  THE PORT OF THE SERVER THIS SCRIPT JUST INSTALLED, NOT 3000.

  This probed 127.0.0.1:3000 whatever it had installed. 3000 is the LIVE
  server's resources port, and the live server is up, so a DEV install
  asked the live server whether dev had started and was told yes. Read out
  of the settings that were just swapped in, so it is right for any root
  without anybody passing a number.
#>
$gamePort = GamePortOf $Root
$resPort = if ($gamePort -eq 7777) { 3000 } else { $gamePort + 1 }
Say ("started, giving it {0} seconds to answer on UDP {1} and on {2}" -f $Wait, $gamePort, $resPort) 'DarkGray'
if (Answers $Root) {
    Say ("the server is answering on {0}, game port {1}" -f $resPort, $gamePort) 'Green'
    Show-ServerPriority $Root
    Tidy
    Say ("the task writes everything the server prints to {0}\server.log through server-log.js, rolled at midnight and at 4 MB, nothing kept past 30 days" -f $Root) 'DarkGray'
    Finish 'INSTALL OK' 0
}

Write-Host ''
Say 'the server did not come up. Its log says:' 'Red'
TailLog $Root
if (-not $hadRoot) {
    Say 'there was no server here before this one, so there is nothing to go back to.' 'Red'
    Finish 'INSTALL FAILED' 1
}

# ---- the way back ----------------------------------------------------------------
GoBack 'what did not start'
