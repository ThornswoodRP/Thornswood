# vps-dev-instance.ps1
#
# Runs ON the VPS. Makes the dev game server and the dev voice server beside
# the live ones, from copies of the live installs, on their own ports, with
# their own scheduled tasks and firewall rules. Nothing about the live
# instances is touched. Safe to run again: every step checks before it acts.
# The watchdog's dev checks come with Watch-Services.ps1 -Install, not from
# here.
#
#   live game server   C:\Thornswood-Server       UDP/TCP 7777, resources TCP 3000
#   dev game server    C:\Thornswood-Server-Dev   UDP/TCP 7787, resources TCP 7788 (the server picks port+1 itself)
#   live voice         C:\Thornswood-Voice        TCP 7778
#   dev voice          C:\Thornswood-Voice-Dev    TCP 7789, loopback only, behind Caddy's /voice-dev
#
# The dev world starts empty: characters and the world state are not copied,
# because a dev server is for breaking things.
#
# NOTHING PRIVATE OF LIVE'S COMES ACROSS (issues #1082 and #1083).
#   The game server's private folder holds live's door.json (the live site's
#   address and the key the site trusts), allowed.json and characters.json.
#   It is never copied, nor data's copies of the door or the list: dev's
#   private starts with an empty characters.json and nothing else, and
#   Publish-Server.ps1 -Channel dev writes dev's own door.json, asking the dev
#   list, on its first run (#964).
#   Voice is copied by name, the program (voice-server.js and headlines.js,
#   which it requires) and the log roller, and nothing else: never live's
#   chat logs, token-key.txt (dev voice makes its own), turn-key.txt or the
#   old secret.txt.
#   Dev voice starts with auth on and bound to 127.0.0.1, the way live runs,
#   never with the service's own fallback of letting unproven joins in on
#   every address, and its port is not opened in the firewall: Caddy carries
#   /voice-dev to it over loopback.
#   Both dev folders take nothing from C:\, whose rule lets every service
#   account on the box read them (#1105): SYSTEM and Administrators only.
#   Deploy-Docs.ps1 gives the site its read on dev's server.log and chat.
#
#   -FilesOnly   the copies, the folders' rules and the run file, and no task,
#                firewall rule or watchdog line. tests\test-dev-instance.ps1
#                runs it against scratch folders.
param(
    [switch]$Start,
    [string]$Live      = 'C:\Thornswood-Server',
    [string]$Dev       = 'C:\Thornswood-Server-Dev',
    [string]$LiveVoice = 'C:\Thornswood-Voice',
    [string]$DevVoice  = 'C:\Thornswood-Voice-Dev',
    [switch]$FilesOnly,
    # Register the dev tasks as SYSTEM, Highest, the way they were before #2578,
    # and grant nothing. The way back if dev will not run as LOCAL SERVICE.
    [switch]$AsSystem
)
$ErrorActionPreference = 'Stop'
function Say($m) { Write-Output $m }
# The account the dev tasks run as and what they may reach (#2578). A copy of
# scripts\deploy\ServiceAccount.ps1, held to it by
# tests\test-2578-service-principals.ps1, since this file runs alone on the box.
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

# Registers a dev task as LOCAL SERVICE, Limited, with its own task SID and
# the grants on its root; back on SYSTEM when either cannot be done. A task an
# earlier run left on SYSTEM is moved too.
function Register-DevTask([string]$Name, $Action, $Triggers, $Settings, [string]$Root, [string[]]$Writable, [string[]]$Files) {
    $old = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($old) {
        if ($AsSystem -or $old.Principal.UserId -notmatch '(?i)SYSTEM$') { Say "  task $Name already there"; return }
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }
    Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Triggers -Principal (New-ThornswoodServicePrincipal -AsSystem:$AsSystem) -Settings $Settings | Out-Null
    Say "  task $Name registered"
    if ($AsSystem) { return }
    $why = ''
    $sid = Get-ThornswoodTaskSid $Name
    if (-not $sid) { $why = "the task SID NT TASK\$Name could not be looked up" }
    else {
        try {
            foreach ($l in @(Grant-ThornswoodServiceFolder -Root $Root -Sid $sid -Writable $Writable -Files $Files)) { Say "    $l" }
            # What it makes is its own, not every service's (#4077).
            foreach ($l in @(Set-ThornswoodTaskOwner -TaskName $Name -Sid $sid -Action $Action -Roots $Root)) { Say "    $l" }
        } catch { $why = 'its folder could not be granted to it: ' + $_.Exception.Message }
    }
    if ($why) {
        Say "  $why, so the task goes back on SYSTEM"
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
        Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Triggers -Principal (New-ThornswoodServicePrincipal -AsSystem) -Settings $Settings | Out-Null
    } else { Say "  $Name runs as LOCAL SERVICE, Limited, as NT TASK\$Name" }
}


$live = $Live.TrimEnd('\');  $dev = $Dev.TrimEnd('\')
$liveVoice = $LiveVoice.TrimEnd('\'); $devVoice = $DevVoice.TrimEnd('\')
$devPort = 7787; $devVoicePort = 7789
$node = 'C:\Program Files\nodejs\node.exe'
# The fail-safe, before any task is registered: dev goes onto LOCAL SERVICE
# only where LOCAL SERVICE can read none of what no service may.
if (-not $FilesOnly -and -not $AsSystem) {
    $cannot = @(Test-ThornswoodServiceCannotReach (Get-ThornswoodServiceNeverReach -Own $dev -Box (Split-Path -Parent $dev)))
    if ($cannot.Count) {
        $cannot | ForEach-Object { Say "  $_" }
        throw 'LOCAL SERVICE could read what no service may, so dev is not moved onto it. Lock those (scripts\vps\Lock-VpsFolders.ps1), or pass -AsSystem. Nothing was changed.'
    }
}


# SYSTEM, which every task here runs as, and Administrators; nothing from
# C:\ and no Users, Everyone, Authenticated Users or CREATOR OWNER rule. Any
# other rule already set on the folder by name (the site's, from
# Deploy-Docs.ps1) stays.
function Lock-Dir([string]$dir) {
    $broad = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-3-0')
    $acl = Get-Acl -LiteralPath $dir
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
        if ($broad -contains $r.IdentityReference.Value) { [void]$acl.RemoveAccessRuleSpecific($r) }
    }
    foreach ($s in 'S-1-5-18', 'S-1-5-32-544', [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
            (New-Object Security.Principal.SecurityIdentifier($s)), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))
    }
    # Writes back only the access rules. Set-Acl can also try to write the audit
    # part, which needs a privilege the build runner's account does not have
    # (issue #1120, Set-ThornswoodAclAccess in Bot-Service.ps1).
    $item = Get-Item -LiteralPath $dir -Force
    if ($item -is [IO.DirectoryInfo]) { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]$item, [Security.AccessControl.DirectorySecurity]$acl) }
    else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]$item, [Security.AccessControl.FileSecurity]$acl) }
}

# ------------------------------------------------------------- game server
if (-not (Test-Path $dev)) { New-Item -ItemType Directory -Path $dev | Out-Null }
Lock-Dir $dev
Say "  $dev is SYSTEM's and Administrators' only"
# Program files and plugins, not the world, not the data, not the private
# folder, not the logs. The rolled ones too, server.log.1 and the rest, or dev
# starts with live's.
& robocopy $live $dev /E /XD data world private "world-before-*" /XF *.log *.log.* /NFL /NDL /NJH /NJS /NP | Out-Null
Say ("  server files copied (robocopy code {0})" -f $LASTEXITCODE)

# Data: the manifest and the scripts and api folders come across, and nothing
# else of live's: no door and no allowed list, which are private and live's.
$dd = Join-Path $dev 'data'
$pd = Join-Path $dev 'private'
if (-not (Test-Path $dd)) { New-Item -ItemType Directory -Path $dd | Out-Null }
if (-not (Test-Path $pd)) { New-Item -ItemType Directory -Path $pd | Out-Null }
Lock-Dir $pd

foreach ($n in @('manifest.json')) {
    $src = Join-Path $live "data\$n"
    if ((Test-Path $src) -and -not (Test-Path (Join-Path $dd $n))) { Copy-Item $src (Join-Path $dd $n) }
}
foreach ($d in 'scripts', 'api') {
    $src = Join-Path $live "data\$d"
    if ((Test-Path $src) -and -not (Test-Path (Join-Path $dd $d))) { Copy-Item $src (Join-Path $dd $d) -Recurse }
}

if (-not (Test-Path (Join-Path $pd 'characters.json'))) { Set-Content (Join-Path $pd 'characters.json') '[]' -Encoding ASCII }
Say '  data and private folders ready (fresh characters.json, nothing of live''s private)'
if (-not (Test-Path (Join-Path $pd 'door.json'))) {
    Say '  dev has no door.json yet: .\scripts\release\Publish-Server.ps1 -Channel dev writes its own'
}

# server-settings.json: the dev port, the dev name, plugin paths under the dev folder.
$settingsFile = Join-Path $dev 'server-settings.json'
$s = Get-Content (Join-Path $live 'server-settings.json') -Raw | ConvertFrom-Json
$s.port = $devPort
$s.name = 'Thornswood Dev'
$s.loadOrder = @($s.loadOrder | ForEach-Object { $_ -replace [regex]::Escape(($live -replace '\\', '/') + '/'), (($dev -replace '\\', '/') + '/') })
[IO.File]::WriteAllText($settingsFile, ($s | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
Say ("  server-settings.json: port {0}, name Thornswood Dev, {1} plugins" -f $devPort, $s.loadOrder.Count)

# The task, the same shape as the live one (at boot, restart on failure),
# with the folder swapped, as LOCAL SERVICE (#2578).
if (-not $FilesOnly) {
    $liveTask = Get-ScheduledTask -TaskName 'Thornswood Server'
    # Without the launcher live's action may start through: it names live's
    # own SID, and dev gets its own (#4077).
    $a = Get-ThornswoodPlainAction $liveTask.Actions[0]
    $args2 = $a.Argument -replace [regex]::Escape($live), $dev
    $action = New-ScheduledTaskAction -Execute $a.Execute -Argument $args2 -WorkingDirectory $dev
    Register-DevTask 'Thornswood Dev Server' $action $liveTask.Triggers $liveTask.Settings $dev @('world', 'data', 'private', 'for-bot') @('*.log', '*.log.*')
}

# ------------------------------------------------------------------- voice
if (Test-Path $liveVoice) {
    if (-not (Test-Path $devVoice)) { New-Item -ItemType Directory -Path $devVoice | Out-Null }
    Lock-Dir $devVoice
    Say "  $devVoice is SYSTEM's and Administrators' only"
    # By name: the program, every file it requires, and the log writer it runs
    # under (#2166).
    # voice-server.js requires headlines.js at its first lines since #1406,
    # and stops there without it (#1870); tests\test-dev-instance.ps1 reads
    # the requires out of voice\voice-server.js and holds this list to them.
    # Nothing else in live's folder is dev's to have, the page live may still
    # keep in public included: the service serves none since #1822.
    & robocopy $liveVoice $devVoice voice-server.js headlines.js server-log.js /XF *.log *.log.* /NFL /NDL /NJH /NJS /NP | Out-Null
    Say ("  voice program copied (robocopy code {0})" -f $LASTEXITCODE)
    # The settings come from the environment. A run file sets them, so the
    # task command stays free of cmd's quoting rules. Auth on and loopback,
    # as live runs; Install-Voice.ps1 -Root C:\Thornswood-Voice-Dev keeps both.
    # server-log.js came across with the rest and runs voice, writing
    # voice.log itself: rolled at midnight and at 4 MB, each line stamped, and
    # nothing kept past 90 days (#2166), the way Install-Voice.ps1 runs live.
    # node goes through start /high, so dev voice runs High the way
    # Install-Voice.ps1 starts it (#2491); the task's own priority, copied
    # from live voice's, makes only this cmd.exe High.
    $run = Join-Path $devVoice 'run-dev-voice.cmd'
    $lines = @(
        '@echo off',
        ('set THORNSWOOD_VOICE_PORT={0}' -f $devVoicePort),
        'set THORNSWOOD_VOICE_AUTH=on',
        'set THORNSWOOD_VOICE_BIND=127.0.0.1',
        'set THORNSWOOD_SITE=https://thornswood.net',
        ('cd /d "{0}"' -f $devVoice),
        ('start "" /b /wait /high "{0}" "{1}\server-log.js" --log "{1}\voice.log" --days 90 --stamp voice-server.js' -f $node, $devVoice)
    )
    [IO.File]::WriteAllLines($run, [string[]]$lines, (New-Object Text.ASCIIEncoding))
    Say '  dev voice runs with auth on, on 127.0.0.1 only'
    if (-not $FilesOnly) {
        $liveVoiceTask = Get-ScheduledTask -TaskName 'Thornswood Voice'
        # The run file's path in two pairs of quotes: cmd /c drops the outer
        # pair whenever the path holds an & or another of its own characters,
        # and the inner pair keeps the path whole (issues #1042, #1115).
        $taskArg = ('/c ""{0}""' -f $run)
        $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument $taskArg -WorkingDirectory $devVoice
        Register-DevTask 'Thornswood Dev Voice' $action $liveVoiceTask.Triggers $liveVoiceTask.Settings $devVoice @('chat') @('voice.log', 'voice.log.*', 'token-key.txt')
    }
}

if ($FilesOnly) { Say 'done, files only'; return }

# ---------------------------------------------------------------- firewall
# Not the dev voice port: it answers on loopback only, behind Caddy. A rule
# an earlier run of this left open is taken down. The rules live in the box's
# own policy store, the only place the firewall takes a rule from once
# Set-InboundRules.ps1 -Own has run, and Group Policy is refreshed after a
# change (scripts\vps\BoxFirewall.ps1, #3896).
# ---- BoxFirewall.ps1 (copy) ----
function Sync-ThornswoodFirewall {
    # scripts\vps\BoxFirewall.ps1 (#3896): the firewall takes the box's policy
    # store when Group Policy is refreshed, so every change to the store ends here.
    $was = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $said = @(& gpupdate.exe /target:computer /force 2>&1 | ForEach-Object { [string]$_ } | Where-Object { $_.Trim() })
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $was
    if ($rc -ne 0) { throw ('gpupdate did not refresh the box''s policy, so the firewall has not taken the change (exit ' + $rc + '): ' + ($said -join ' ')) }
}
# ---- end BoxFirewall.ps1 ----
$rules = @(
    @{ Name = 'Thornswood Dev game (UDP)';      Protocol = 'UDP'; Port = $devPort },
    @{ Name = 'Thornswood Dev game (TCP)';      Protocol = 'TCP'; Port = $devPort },
    @{ Name = 'Thornswood Dev resources (TCP)'; Protocol = 'TCP'; Port = ($devPort + 1) }
)
$fwChanged = 0
foreach ($r in $rules) {
    if (-not (Get-NetFirewallRule -PolicyStore localhost -DisplayName $r.Name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -PolicyStore localhost -DisplayName $r.Name -Direction Inbound -Action Allow -Protocol $r.Protocol -LocalPort $r.Port | Out-Null
        $fwChanged++
        Say ("  firewall: {0} open" -f $r.Name)
    }
}
if (Get-NetFirewallRule -PolicyStore localhost -DisplayName 'Thornswood Dev Voice' -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -PolicyStore localhost -DisplayName 'Thornswood Dev Voice'
    $fwChanged++
    Say '  firewall: Thornswood Dev Voice closed, dev voice is on loopback'
}
if ($fwChanged) { Sync-ThornswoodFirewall; Say '  firewall: taken (Group Policy refreshed)' }

# ---------------------------------------------------------------- watchdog
# The dev checks are in Watch-Services.ps1's own list, and its -Install is
# what puts them on the box. This only says whether the installed watcher
# has them; it writes nothing into it (issue #1106).
$watch = 'C:\Thornswood-Watch\watch.ps1'
if ((Test-Path $watch) -and ((Get-Content $watch -Raw) -match 'Thornswood Dev Server')) {
    Say '  watchdog already watches the dev server and dev voice'
} else {
    Say '  watchdog: run .\scripts\vps\Watch-Services.ps1 -Install from your machine to put the dev checks on the box'
}

if ($Start) {
    Start-ScheduledTask -TaskName 'Thornswood Dev Server'
    if (Get-ScheduledTask -TaskName 'Thornswood Dev Voice' -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName 'Thornswood Dev Voice' }
    Start-Sleep -Seconds 20
    Get-NetUDPEndpoint | Where-Object { $_.LocalPort -eq $devPort } | ForEach-Object { Say ("  dev game server listening on UDP {0}" -f $_.LocalPort) }
    Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in ($devPort + 1), $devVoicePort } | ForEach-Object { Say ("  listening on TCP {0} ({1})" -f $_.LocalPort, $_.LocalAddress) }
    Get-Content (Join-Path $dev 'server.log') -Tail 8 -ErrorAction SilentlyContinue
    Get-Content (Join-Path $devVoice 'voice.log') -Tail 3 -ErrorAction SilentlyContinue
}
Say 'done'
