<#
  StopAndMove.ps1

  Stopping what runs from a folder, and then moving its files, on the box:
  each process waited for until it has exited, and each move tried once.

  Who takes it:
    - its text, in front of what runs on the box. Swap.ps1 reads it into
      $ThornswoodStopAndMoveText and puts it in front of both swap blocks, so
      Deploy-Server.ps1, Deploy-DevGamemode.ps1, Deploy-Docs.ps1,
      Install-Voice.ps1 and Install-Bot.ps1 take it there; Deploy-Docs.ps1,
      Install-Voice.ps1 and Install-Bot.ps1 also put that text in front of
      their own restart, remove and service blocks, Install-Bot.ps1 in front
      of Bot-Service.ps1 wherever it sends that. Install-Bridge.ps1 and
      Install-AdminService.ps1 read it and put it in front of their swap and
      stop. Reset-Character.ps1, Reset-Npcs.ps1 and Move-World.ps1 read it and
      join it into the script they run on the box;
    - dot-sourced by Reset-Character.ps1, on this machine with -UseLocal, and
      by Read-ServerHolders.ps1, on the box;
    - a copy: Install-ThornswoodServer.ps1 carries a copy of what is below
      this header, since every file Publish-Server.ps1 sends is a call in
      records\remote-commands.json, and test-2928-stop-and-move.ps1 holds the
      two the same.
  tests\test-4678-header-callers.ps1 holds this list to the scripts.

  Keep it ASCII: Windows PowerShell 5.1 on the box reads a file with no byte
  order mark as ANSI.

  WHY, issue #2928. Until 20 Oct 2026 every swap stopped what was running and
  then renamed its files in a loop: ten tries half a second apart in Swap.ps1,
  0.7 s apart in Install-ThornswoodServer.ps1, a second apart for the bot's
  service program, "because a process that has just been told to stop does
  not always let go of its files the same instant", after waiting for its
  port to close and, for the game servers, two seconds more. Measured on the
  box that day, in a folder Windows Defender scans:

    - a node holding a file in a folder, ended with Stop-Process -Force, and
      the folder renamed at once: refused (Windows error 5) 15 times in 15,
      for 8 to 403 ms each time, with the Restart Manager naming nothing that
      held it, because the process was still exiting;
    - the same, renamed once that process had exited: refused 0 times in 15,
      and the log it had been writing up to the end, renamed on its own,
      0 times in 10;
    - a folder of files written that instant (twenty small scripts and a
      fresh executable), renamed at once: refused 0 times in 30, and 110 such
      files renamed one by one, 0 times.

  Stop-Process, Stop-ScheduledTask and Stop-Service return once Windows has
  been asked to end a process, not once it has ended, and a process's files
  stay open until it has. That is the refusal the loops were covering. A
  scanner opening new files (#2888, on One) is not what these swaps meet: the
  box did not show it, and every swap here moves its stage only after its
  checks have read it back, seconds after it was written.

  So: each process is opened before anything is asked to stop, so the wait is
  on that process and never on whatever Windows gives its id to next; then
  whatever is still running is ended, and each is waited for until it has
  exited. Then each move is tried once. A move that is refused says the
  Windows error and what had the path or anything under it open at that
  moment (Get-ThornswoodPathHolders), and the caller refuses or rolls back as
  it always has. Nothing is tried again.
#>

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
