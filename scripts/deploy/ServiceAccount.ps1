<#
  ServiceAccount.ps1

  The account the services that run code we deploy run as (#2578): both game
  servers, both voice services and Caddy. Until 16 Oct 2026 each of their
  installers registered its task as SYSTEM at the highest run level, so
  anything gamemode.js, voice-server.js or caddy.exe did, it did as SYSTEM:
  every secret on the box, the backups and their passphrase, the runners.

  Now each task runs as NT AUTHORITY\LOCAL SERVICE, Limited, the way the
  site already does (Deploy-Docs.ps1 -RunAs, which says why each part is
  there):
    - SeChangeNotifyPrivilege and no other privilege. LOCAL SERVICE is given
      "Impersonate a client" and "Replace a process level token" by default,
      and either can be turned into SYSTEM, so the task asks for the one it
      needs and is started without the rest.
    - ProcessTokenSidType Unrestricted, which puts a SID of the task's own
      (NT TASK\<task name>) in its token. Every grant below goes to that SID,
      not to LOCAL SERVICE, so the site and the other services, which are
      LOCAL SERVICE too, get nothing from them.

  A task's folder (Grant-ThornswoodServiceFolder):
    - the root and everything in it: read and execute, so the code the deploy
      put there is readable and nothing in it can be changed or deleted;
    - the root itself: make files and folders in it, for the logs and the
      folders a first start makes. CREATOR OWNER gets Modify on what it makes,
      so a log the service started it can write to, roll and cut, and a file
      somebody else put there it cannot;
    - the folders it keeps its state in (-Writable): Modify;
    - files already there that it must keep writing (-Files, the logs a
      SYSTEM task left behind): Modify on each.

  WHO OWNS WHAT A SERVICE MAKES (#4077). Windows makes the owner of a new
  file the token's default owner, and for a LOCAL SERVICE task that is LOCAL
  SERVICE, not the task's own SID: measured on the box on 27 Oct 2026, every
  Thornswood task's token had owner S-1-5-19. So CREATOR OWNER above became
  "LOCAL SERVICE: Modify" on each file a service made, and the owner's own
  right to read and change a file's rules went to LOCAL SERVICE as well:
  every service on the box could read and change the others' logs, worlds,
  chat logs and backups. The same measurement found the task's own SID in
  the token with the flag that lets it be owner (0xe), so each task now
  starts through thornswood-owner.exe (Get-ThornswoodOwnerLaunchSource),
  which makes that SID the default owner and then runs the task's program,
  whose children inherit it. CREATOR OWNER then names that one service, and
  so does every file's owner. Set-ThornswoodTaskOwner puts the launcher on
  a task once its folder is granted, and Repair-ThornswoodServiceOwner gives
  the task what LOCAL SERVICE made in its folders before, with the rules
  CREATOR OWNER gave LOCAL SERVICE made again for the new owner. The
  launcher is built on the box by the .NET Framework's compiler, the way the
  bot's service program is, into Program Files, where only Administrators
  can change it. -AsSystem needs none of it: SYSTEM's files are SYSTEM's.

  THE FAIL-SAFE (Test-ThornswoodServiceCannotReach). Before any installer
  moves a task to LOCAL SERVICE it reads the rules on the places no service
  may read (Get-ThornswoodServiceNeverReach), and refuses, with nothing
  changed, when Everyone, Authenticated Users, Users or LOCAL SERVICE may read
  one. -AsSystem on each installer registers the task as it was, SYSTEM and
  Highest, and is the way back.

  Install-ThornswoodServer.ps1 runs on the box and carries a copy of these
  functions (every file Publish-Server.ps1 sends is a recorded remote call);
  the test fails when the copy differs. Install-Voice.ps1 and
  Setup-Domain.ps1 run on this machine, so they send the functions as text
  inside the script they run on the box (Get-ThornswoodServiceAccountScript).
  tests\test-2578-service-principals.ps1 runs it on scratch folders, and
  tests\test-4077-service-owner.ps1 builds the launcher and runs it.
#>

function New-ThornswoodServicePrincipal {
    param([switch]$AsSystem)
    if ($AsSystem) {
        return New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    }
    return New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited `
        -RequiredPrivilege 'SeChangeNotifyPrivilege' -ProcessTokenSidType Unrestricted
}

# The SID of a task registered with ProcessTokenSidType Unrestricted, or ''.
function Get-ThornswoodTaskSid {
    param([string]$TaskName)
    try {
        return (New-Object Security.Principal.NTAccount('NT TASK', $TaskName)).Translate([Security.Principal.SecurityIdentifier]).Value
    } catch { return '' }
}

# The places no service that runs our code may read. -Own is the root of the
# service asking, whose own private folder or key it does need. -Box is the
# folder the Thornswood folders sit side by side in, C:\ on the box; a caller
# passes the folder its own root is in, so an install into a scratch box is
# checked against that box and not the real one (#1273).
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

# Each rule that lets a broad group, LOCAL SERVICE or one of -Sids read one of
# -Paths, as a line. None means the move is safe. A path that is not there is
# passed over; one this account cannot even look for, or whose rules cannot be
# read, is a problem.
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

# Writes back only the access rules, never the audit part (#1120).
function Set-ThornswoodServiceAcl {
    param([string]$Path, $Acl)
    $item = Get-Item -LiteralPath $Path -Force
    if ($item -is [IO.DirectoryInfo]) { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]$item, [Security.AccessControl.DirectorySecurity]$Acl) }
    else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, [Security.AccessControl.FileSecurity]$Acl) }
}

# What one service's task may do in its folder (the header). Throws when a
# rule cannot be written; the caller puts the task back on SYSTEM then.
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

# The SID Windows gives NT TASK\<name>, worked out from the name the way it
# does (S-1-5-87- and the SHA-1 of the name in upper case as UTF-16, read as
# five 32 bit numbers, as for NT SERVICE in Bot-Service.ps1), so an action
# or a rule can name it from the name alone. icacls still refuses to grant it
# until the task is registered, because only then does Windows map it
# (#4968, #4973). Checked on the box on 27 Oct 2026
# against what Windows said for Thornswood Bridge and Thornswood Docs.
function Get-ThornswoodTaskSidFromName {
    param([string]$TaskName)
    $sha = [Security.Cryptography.SHA1]::Create()
    try { $h = $sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($TaskName.ToUpperInvariant())) }
    finally { $sha.Dispose() }
    $parts = @()
    for ($i = 0; $i -lt 20; $i += 4) { $parts += [BitConverter]::ToUInt32($h, $i) }
    return ('S-1-5-87-' + ($parts -join '-'))
}

# thornswood-owner.exe (the header, WHO OWNS WHAT A SERVICE MAKES).
#     thornswood-owner.exe <task SID> <program> [its arguments]
# It makes <task SID> the default owner in its own token, reads that back,
# then runs the rest of its command line as Windows gave it and ends with
# that program's exit code. When the owner cannot be set it starts nothing
# and ends with 77, which the task's last result shows.
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

# Builds thornswood-owner.exe with the .NET Framework's compiler, which every
# Windows Server has, into -Dir, and returns its full path. Named by its
# source's hash, so a new source is a new file and never has to replace one
# a running task holds; one already built is used as it is. Throws when it
# cannot be built, or when anything but SYSTEM, Administrators and
# TrustedInstaller (and -AlsoMay, a harness's own account in its scratch
# folder) could change it, because every service would then run what
# another could write.
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

# A task action that starts -Execute and -Argument through the launcher,
# with -Sid as the owner of what it makes.
function New-ThornswoodOwnedAction {
    param([string]$Launcher, [string]$Sid, [string]$Execute, [string]$Argument = '', [string]$WorkingDirectory = '')
    $line = $Sid + ' "' + $Execute + '"'
    if ($Argument) { $line += ' ' + $Argument }
    if ($WorkingDirectory) { return New-ScheduledTaskAction -Execute $Launcher -Argument $line -WorkingDirectory $WorkingDirectory }
    return New-ScheduledTaskAction -Execute $Launcher -Argument $line
}

# The program and arguments an action runs, with the launcher taken off when
# it is on: @{ Execute; Argument; WorkingDirectory }. For a copy of another
# task's action (the dev server copies the live one), which needs its own SID.
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

# Turns on the restore privilege in this process's token, which an elevated
# Administrator holds and which setting an owner other than itself needs.
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

# A file's or folder's owner and access rules, read without its audit part.
function Get-ThornswoodServiceItemAcl {
    param($Item)
    $s = [Security.AccessControl.AccessControlSections]'Owner, Access'
    if ($Item -is [IO.DirectoryInfo]) { return [IO.FileSystemAclExtensions]::GetAccessControl([IO.DirectoryInfo]$Item, $s) }
    return [IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]$Item, $s)
}

# What LOCAL SERVICE owns in -Root, and any rule there that names LOCAL
# SERVICE and allows, go to the task (#4077, the header): it owns them, and
# the rule goes. Then the folders whose children take rules from them are
# written again, the root and each one under it that takes nothing from
# above, so a rule CREATOR OWNER gave LOCAL SERVICE when a file was made is
# made again for the file's new owner. Run with the service stopped, or what
# it makes until then is LOCAL SERVICE's again. Throws when an owner cannot
# be set; returns what it did as lines.
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

# The last step of putting a task on LOCAL SERVICE (#4077), once its folders
# are granted: what LOCAL SERVICE made in -Roots goes to the task's own SID,
# and the task starts -Action (left out, the action it was registered with)
# through the launcher, so what it makes from now on is its own as well. The
# principal, triggers and settings are kept.
# Throws, as Grant-ThornswoodServiceFolder does, and the caller puts the task
# back on SYSTEM with -Action as it is.
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

# The functions above as text, for a script that runs on the box.
function Get-ThornswoodServiceAccountScript {
    $out = ''
    foreach ($n in 'New-ThornswoodServicePrincipal', 'Get-ThornswoodTaskSid', 'Get-ThornswoodServiceNeverReach',
                   'Test-ThornswoodServiceCannotReach', 'Set-ThornswoodServiceAcl', 'Grant-ThornswoodServiceFolder',
                   'Get-ThornswoodTaskSidFromName', 'Get-ThornswoodOwnerLaunchSource', 'Install-ThornswoodOwnerLaunch',
                   'New-ThornswoodOwnedAction', 'Get-ThornswoodPlainAction', 'Enable-ThornswoodRestorePrivilege',
                   'Get-ThornswoodServiceItemAcl', 'Repair-ThornswoodServiceOwner', 'Set-ThornswoodTaskOwner') {
        $out += 'function ' + $n + ' {' + (Get-Item ('function:' + $n)).ScriptBlock.ToString() + "}`r`n"
    }
    return $out
}
