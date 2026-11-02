<#
.SYNOPSIS
  The part of a gate trace that runs on the VPS, as an administrator: an ETW
  session that sees every file each gate harness opens, and the reading of it
  into one list of paths a harness (#3114).

.DESCRIPTION
  Not run by hand. scripts\dev\Trace-Gate.ps1 sends this to the box with the
  mode it wants set in $TraceMode at the top, the way Install-Runner.ps1
  sends its scripts, and PowerShell 7 runs it there.

    selftest  starts a session, runs a probe whose file work is known, stops
              the session and reads it back. Every line says PASS or FAIL;
              it exits 1 on any FAIL, and then no gate trace is worth
              running.
    start     starts the gate's session. One that a failed run left is
              stopped first.
    stop      stops it and says how many events were lost. A lost event is a
              file open nobody saw, so a trace with any is refused (exit 1).
    read      reads the stopped session against the start log of the run
              ($TraceStarts, the lines Nightly-Harnesses.ps1 -StartLog wrote,
              and $TraceWorkspace, the run's checkout) and prints every
              harness's paths, gzipped, as base64 lines between BEGIN and
              END. Then it deletes the trace.
    clean     deletes whatever a trace left, but for the trace task's own
              folders.
    install   installs the trace task (scripts\dev\Trace-Gate-Task.ps1),
              from $TraceBoxText, $TraceTaskText and $TraceRunners, the
              build runners' folders and accounts: see -Install in
              Trace-Gate.ps1.
    status    what the trace task is doing.
    uninstall takes it off, with its folders in each build runner's.
    library   nothing: the trace task loads this for its functions.

  WHAT IS SEEN. Microsoft-Windows-Kernel-File's create events: every open of
  a file or folder, whether it is there or not, which on Windows is also how
  a file's attributes are read. Its directory enumerations (DirEnum), each
  with the folder's open and the pattern asked for: a folder is listed only
  when it is enumerated with a wildcard or none, and one name asked for
  (cmd's if exist, FindFirstFile on a plain name) is a look at that name.
  Every process opens folders it never lists (its own, a script's), so
  without these a change beside any file a harness ran reran it (the second
  gate trace, run 39740245070: every harness opened tests and the checkout's
  top). Only those event ids are kept (an event id filter), since the
  keyword that carries DirEnum carries far more. And
  Microsoft-Windows-Kernel-Process's starts and stops, so each open is put on
  the process that made it, and each process on the harness whose process
  started it, however deep: the harness's own process is the one with the id
  and start time the start log gives. Only paths inside the run's checkout
  are kept. The trace itself, which sees the whole box, never leaves C:\Thornswood-Trace,
  a folder only administrators can read, and is deleted once read.

  A process that was already running when the session started has no start
  event in it, so the session's start also writes down every process then
  running, its id and its name, beside the trace (gate.etl.procs). Without
  that, such a process came out as a bare id and could not be matched to
  the readers below, so its opens counted as strays (the first gate trace,
  run 39731778532 on 22 Oct: 136 opens of scripts the harnesses ran, all by
  one such id).

  WHAT MAKES A HARNESS ALWAYS RUN. A process that is no harness's (not
  Defender's or the indexer's, which read files without acting on them)
  opening something in the checkout while a harness runs: whatever it read
  may have been on that harness's behalf, so every harness running then is
  marked. And a short (8.3) name in the checkout that no longer resolves.
#>

$ErrorActionPreference = 'Stop'
$traceRoot = 'C:\Thornswood-Trace'
$sessionName = 'thornswood-gate-trace'
# The trace task's (scripts\dev\Trace-Gate-Task.ps1): its session, its
# scheduled task, its log and its two folders in C:\Thornswood-Trace, task
# for its scripts and main for the traces it is taking and reading.
$mainSession = 'thornswood-main-trace'
$taskName = 'Thornswood Gate Trace'
$taskLog = Join-Path $traceRoot 'task.log'
$taskFolders = @('task', 'main')

# PowerShell 7 builds against only the assemblies named here, so each one the
# C# uses is named (#5356).
Add-Type -ReferencedAssemblies System.Runtime, System.Collections, System.Text.RegularExpressions, System.Diagnostics.EventLog, System.Runtime.InteropServices -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics.Eventing.Reader;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public static class ThornswoodTrace {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int StartTraceW(out ulong handle, string name, IntPtr props);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern int ControlTraceW(ulong handle, string name, IntPtr props, uint code);
    [DllImport("advapi32.dll")]
    static extern int EnableTraceEx2(ulong handle, ref Guid provider, uint code, byte level, ulong any, ulong all, uint timeout, IntPtr param);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern uint QueryDosDeviceW(string device, StringBuilder target, int max);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetLongPathNameW(string shortPath, StringBuilder longPath, int max);

    const int PropsSize = 120 + 2048 + 2048;

    static IntPtr Props(string etl, int maxMb) {
        IntPtr p = Marshal.AllocHGlobal(PropsSize);
        for (int i = 0; i < PropsSize; i++) Marshal.WriteByte(p, i, 0);
        Marshal.WriteInt32(p, 0, PropsSize);              // Wnode.BufferSize
        Marshal.WriteInt32(p, 40, 1);                     // Wnode.ClientContext: QPC
        Marshal.WriteInt32(p, 44, 0x00020000);            // Wnode.Flags: WNODE_FLAG_TRACED_GUID
        byte[] g = Guid.NewGuid().ToByteArray();
        Marshal.Copy(g, 0, new IntPtr(p.ToInt64() + 24), 16);
        Marshal.WriteInt32(p, 48, 256);                   // BufferSize, KB
        Marshal.WriteInt32(p, 52, 64);                    // MinimumBuffers
        Marshal.WriteInt32(p, 56, 512);                   // MaximumBuffers
        Marshal.WriteInt32(p, 60, maxMb);                 // MaximumFileSize, MB: 0 for none
        Marshal.WriteInt32(p, 64, 0x1);                   // LogFileMode: sequential file
        Marshal.WriteInt32(p, 68, 1);                     // FlushTimer, seconds
        Marshal.WriteInt32(p, 112, 120 + 2048);           // LogFileNameOffset
        Marshal.WriteInt32(p, 116, 120);                  // LoggerNameOffset
        if (etl != null) {
            byte[] f = Encoding.Unicode.GetBytes(etl + "\0");
            Marshal.Copy(f, 0, new IntPtr(p.ToInt64() + 120 + 2048), f.Length);
        }
        return p;
    }

    public static Guid ProviderId(string name) { return new ProviderMetadata(name).Id; }

    // The keywords of a provider whose names match, OR'd, and the names.
    public static ulong Keywords(string provider, string pattern, List<string> names) {
        ulong k = 0;
        Regex re = new Regex(pattern);
        foreach (EventKeyword w in new ProviderMetadata(provider).Keywords) {
            if (w.Name != null && re.IsMatch(w.Name)) { k |= (ulong)w.Value; names.Add(w.Name + " 0x" + ((ulong)w.Value).ToString("x")); }
        }
        return k;
    }
    public static List<string> KeywordNames(string provider) {
        List<string> all = new List<string>();
        foreach (EventKeyword w in new ProviderMetadata(provider).Keywords) all.Add(w.Name + " 0x" + ((ulong)w.Value).ToString("x"));
        return all;
    }

    // Starts a session writing to etl, with each provider at its keywords
    // and, where ids[i] is not null, only the events with those ids (an
    // EVENT_FILTER_TYPE_EVENT_ID filter, so a keyword that also carries
    // events nobody reads costs nothing). A sequential file stops taking
    // events at maxMb, and each one after that is counted lost, so a trace
    // that reached it is refused. Returns 0, or the Windows error.
    public static int Start(string name, string etl, Guid[] providers, ulong[] keywords, int[][] ids, int maxMb) {
        IntPtr p = Props(etl, maxMb);
        try {
            ulong h;
            int e = StartTraceW(out h, name, p);
            if (e != 0) return e;
            for (int i = 0; i < providers.Length; i++) {
                Guid g = providers[i];
                IntPtr param = IntPtr.Zero, filter = IntPtr.Zero, desc = IntPtr.Zero;
                try {
                    if (ids[i] != null) {
                        // EVENT_FILTER_EVENT_ID: FilterIn, Reserved, Count, then the ids.
                        int size = 4 + 2 * ids[i].Length;
                        filter = Marshal.AllocHGlobal(size);
                        Marshal.WriteByte(filter, 0, 1);
                        Marshal.WriteByte(filter, 1, 0);
                        Marshal.WriteInt16(filter, 2, (short)ids[i].Length);
                        for (int j = 0; j < ids[i].Length; j++) Marshal.WriteInt16(filter, 4 + 2 * j, (short)ids[i][j]);
                        // EVENT_FILTER_DESCRIPTOR: Ptr, Size, Type.
                        desc = Marshal.AllocHGlobal(16);
                        Marshal.WriteInt64(desc, 0, filter.ToInt64());
                        Marshal.WriteInt32(desc, 8, size);
                        Marshal.WriteInt32(desc, 12, unchecked((int)0x80000200));
                        // ENABLE_TRACE_PARAMETERS, version 2: the filter at 32, its count at 40.
                        param = Marshal.AllocHGlobal(48);
                        for (int j = 0; j < 48; j++) Marshal.WriteByte(param, j, 0);
                        Marshal.WriteInt32(param, 0, 2);
                        Marshal.WriteInt64(param, 32, desc.ToInt64());
                        Marshal.WriteInt32(param, 40, 1);
                    }
                    e = EnableTraceEx2(h, ref g, 1, 5, keywords[i], 0, 0, param);
                } finally {
                    if (param != IntPtr.Zero) Marshal.FreeHGlobal(param);
                    if (desc != IntPtr.Zero) Marshal.FreeHGlobal(desc);
                    if (filter != IntPtr.Zero) Marshal.FreeHGlobal(filter);
                }
                if (e != 0) { Stop(name); return e; }
            }
            return 0;
        } finally { Marshal.FreeHGlobal(p); }
    }

    // The ids of a provider's events whose task is named by the pattern, or
    // that carry one of the keywords, and the keywords those events carry.
    public static int[] EventIds(string provider, string task, ulong keywords, out ulong carried) {
        SortedSet<int> o = new SortedSet<int>();
        carried = 0;
        // PowerShell hands a $null string over as "", which as a pattern would
        // match every task.
        Regex re = string.IsNullOrEmpty(task) ? null : new Regex(task);
        foreach (EventMetadata m in new ProviderMetadata(provider).Events) {
            ulong k = 0;
            if (m.Keywords != null) foreach (EventKeyword w in m.Keywords) k |= (ulong)w.Value;
            bool byTask = re != null && m.Task != null && m.Task.Name != null && re.IsMatch(m.Task.Name);
            if (byTask || (k & keywords) != 0) { o.Add((int)m.Id); if (byTask) carried |= k; }
        }
        int[] a = new int[o.Count]; o.CopyTo(a); return a;
    }
    public static string TaskNames(string provider) {
        SortedSet<string> o = new SortedSet<string>(StringComparer.Ordinal);
        foreach (EventMetadata m in new ProviderMetadata(provider).Events) o.Add(m.Id + " " + (m.Task != null ? m.Task.Name : "?"));
        return string.Join(", ", new List<string>(o).ToArray());
    }

    // Stops a session: { Windows error, events lost, buffers written,
    // log buffers lost, real time buffers lost }.
    public static long[] Stop(string name) {
        IntPtr p = Props(null, 0);
        try {
            int e = ControlTraceW(0, name, p, 1);
            return new long[] { e, Marshal.ReadInt32(p, 88), Marshal.ReadInt32(p, 92), Marshal.ReadInt32(p, 96), Marshal.ReadInt32(p, 100) };
        } finally { Marshal.FreeHGlobal(p); }
    }

    // \Device\HarddiskVolumeN to C:, for every drive letter.
    static Dictionary<string, string> Devices() {
        Dictionary<string, string> d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (char c = 'A'; c <= 'Z'; c++) {
            StringBuilder sb = new StringBuilder(1024);
            if (QueryDosDeviceW(c + ":", sb, 1024) > 0) {
                string t = sb.ToString();
                if (!d.ContainsKey(t)) d[t] = c + ":";
            }
        }
        return d;
    }
    static string DosPath(string nt, Dictionary<string, string> devices) {
        if (nt == null) return null;
        if (nt.StartsWith(@"\??\")) return nt.Substring(4);
        if (nt.Length > 2 && nt[1] == ':') return nt;
        int i = nt.IndexOf('\\', 8);
        string dev = i > 0 ? nt.Substring(0, i) : nt;
        string drive;
        if (!devices.TryGetValue(dev, out drive)) return null;
        return drive + (i > 0 ? nt.Substring(i) : "\\");
    }

    // The names of each event's fields, by provider, id and version, from
    // its manifest, so a field is read by name and not by place.
    static Dictionary<string, string[]> Fields(string provider) {
        Dictionary<string, string[]> f = new Dictionary<string, string[]>();
        Regex re = new Regex("<data\\s+name=\"([^\"]+)\"");
        foreach (EventMetadata m in new ProviderMetadata(provider).Events) {
            List<string> names = new List<string>();
            if (m.Template != null) foreach (Match x in re.Matches(m.Template)) names.Add(x.Groups[1].Value);
            f[m.Id + "/" + m.Version] = names.ToArray();
        }
        return f;
    }
    // What an event's fields are called, for the self-test to print.
    public static string FieldNames(string provider, int id) {
        List<string> o = new List<string>();
        foreach (KeyValuePair<string, string[]> kv in Fields(provider)) if (kv.Key.StartsWith(id + "/")) o.Add("v" + kv.Key.Substring(kv.Key.IndexOf('/') + 1) + " " + string.Join(" ", kv.Value));
        return string.Join("; ", o.ToArray());
    }
    // A pointer field, as the reader hands it over.
    static ulong Address(object o) {
        if (o is IntPtr) return unchecked((ulong)((IntPtr)o).ToInt64());
        string x = o as string;
        if (x != null) return x.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? Convert.ToUInt64(x.Substring(2), 16) : Convert.ToUInt64(x);
        return Convert.ToUInt64(o);
    }
    static object Field(EventRecord r, Dictionary<string, string[]> fields, string name) {
        string[] names;
        if (!fields.TryGetValue(r.Id + "/" + r.Version, out names)) return null;
        int i = Array.IndexOf(names, name);
        if (i < 0 || i >= r.Properties.Count) return null;
        return r.Properties[i].Value;
    }

    class Inst {
        public int Pid; public DateTime Start; public DateTime End = DateTime.MaxValue;
        public Inst Parent; public string Harness; public string Image; public bool Driver;
    }
    public class Harness {
        public string Name; public int Pid; public DateTime Start; public DateTime End = DateTime.MaxValue;
        public int Code; public double Secs; public bool Skipped; public bool Ended;
        public SortedDictionary<string, string> Paths = new SortedDictionary<string, string>(StringComparer.Ordinal);
        public SortedSet<string> Images = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        public string Always;
    }

    static readonly string[] Readers = { "msmpeng.exe", "mpdefendercoreservice.exe", "nissrv.exe", "searchindexer.exe", "searchprotocolhost.exe", "searchfilterhost.exe", "mssense.exe", "system", "registry", "memory compression" };

    static string Leaf(string image) {
        if (string.IsNullOrEmpty(image)) return "";
        int i = image.LastIndexOf('\\');
        return (i >= 0 ? image.Substring(i + 1) : image).ToLowerInvariant();
    }

    // Reads an ETL against the harnesses' roots. workspace is the checkout;
    // strays gets one line for each process outside the harnesses that
    // opened something in it while a harness ran.
    // running: the processes running as the session started, id to name,
    // since those have no start event in it.
    // enumIds: the ids of the provider's directory enumeration events
    // (DirEnum), whose FileName is the pattern asked for and whose FileObject
    // names the folder's open. A folder enumerated with a wildcard, or with
    // no pattern, is listed ("list"); one asked for a single name is a look
    // at that name ("read"); a folder only opened is neither listed nor
    // looked into, and stays "read".
    public static Dictionary<string, Harness> Read(string etl, string workspace, List<Harness> roots, Dictionary<int, string> running, int[] enumIds, List<string> strays, List<string> notes) {
        Dictionary<string, string> devices = Devices();
        Dictionary<string, string[]> fileFields = Fields("Microsoft-Windows-Kernel-File");
        Dictionary<string, string[]> procFields = Fields("Microsoft-Windows-Kernel-Process");
        Guid fileId = ProviderId("Microsoft-Windows-Kernel-File"), procId = ProviderId("Microsoft-Windows-Kernel-Process");
        string ws = Path.GetFullPath(workspace).TrimEnd('\\');
        string wsLow = ws.ToLowerInvariant() + "\\";
        StringBuilder sb = new StringBuilder(1024);
        Dictionary<string, Harness> byName = new Dictionary<string, Harness>(StringComparer.Ordinal);
        Dictionary<int, List<Harness>> rootsByPid = new Dictionary<int, List<Harness>>();
        DateTime first = DateTime.MaxValue, last = DateTime.MinValue;
        foreach (Harness h in roots) {
            byName[h.Name] = h;
            List<Harness> l;
            if (!rootsByPid.TryGetValue(h.Pid, out l)) { l = new List<Harness>(); rootsByPid[h.Pid] = l; }
            l.Add(h);
            if (h.Start < first) first = h.Start;
            if (h.End > last || last == DateTime.MinValue) last = h.End;
        }
        Dictionary<int, List<Inst>> insts = new Dictionary<int, List<Inst>>();
        foreach (KeyValuePair<int, string> kv in running) {
            Inst n = new Inst();
            n.Pid = kv.Key; n.Start = DateTime.MinValue; n.Image = kv.Value;
            insts[kv.Key] = new List<Inst> { n };
        }
        Func<int, DateTime, Inst> at = (pid, t) => {
            List<Inst> l;
            if (!insts.TryGetValue(pid, out l)) return null;
            for (int i = l.Count - 1; i >= 0; i--) if (l[i].Start <= t) return l[i].End >= t.AddSeconds(-1) ? l[i] : null;
            return null;
        };
        // The newest open of each file object inside the checkout, by address;
        // an address opened outside it is taken out, since it may be reused.
        Dictionary<ulong, string> objects = new Dictionary<ulong, string>();
        // The newest process started from each image, by its full path, for
        // csrss's look at <image>.Config or .Manifest as that image starts.
        Dictionary<string, Inst> started = new Dictionary<string, Inst>(StringComparer.OrdinalIgnoreCase);
        long events = 0, opens = 0, kept = 0, enums = 0, listed = 0;
        using (EventLogReader reader = new EventLogReader(new EventLogQuery(etl, PathType.FilePath))) {
            EventRecord r;
            while ((r = reader.ReadEvent()) != null) {
                using (r) {
                    events++;
                    if (!r.TimeCreated.HasValue || !r.ProviderId.HasValue) continue;
                    DateTime t = r.TimeCreated.Value.ToUniversalTime();
                    if (r.ProviderId.Value == procId) {
                        object pidO = Field(r, procFields, "ProcessID");
                        if (pidO == null) continue;
                        int pid = Convert.ToInt32(pidO);
                        object parentO = Field(r, procFields, "ParentProcessID");
                        if (parentO != null) {
                            Inst n = new Inst();
                            n.Pid = pid; n.Start = t;
                            n.Image = Convert.ToString(Field(r, procFields, "ImageName"));
                            n.Parent = at(Convert.ToInt32(parentO), t);
                            List<Harness> hs;
                            if (rootsByPid.TryGetValue(pid, out hs)) {
                                foreach (Harness h in hs) if (Math.Abs((h.Start - t).TotalSeconds) < 5) { n.Harness = h.Name; if (n.Parent != null) n.Parent.Driver = true; }
                            }
                            if (n.Harness == null && n.Parent != null) n.Harness = n.Parent.Harness;
                            if (n.Harness != null) byName[n.Harness].Images.Add(Leaf(n.Image));
                            string ip = DosPath(n.Image, devices);
                            if (ip != null) started[ip] = n;
                            List<Inst> l;
                            if (!insts.TryGetValue(pid, out l)) { l = new List<Inst>(); insts[pid] = l; }
                            l.Add(n);
                        } else if (Field(r, procFields, "ExitTime") != null || Field(r, procFields, "ExitCode") != null) {
                            Inst n = at(pid, t);
                            if (n != null) n.End = t;
                        }
                        continue;
                    }
                    if (r.ProviderId.Value != fileId) continue;
                    object nameO = Field(r, fileFields, "FileName");
                    object objO = Field(r, fileFields, "FileObject");
                    int ppid = r.ProcessId.HasValue ? r.ProcessId.Value : -1;
                    Inst who = at(ppid, t);
                    if (Array.IndexOf(enumIds, r.Id) >= 0) {
                        enums++;
                        string folder;
                        if (objO == null || !objects.TryGetValue(Address(objO), out folder)) continue;
                        string pat = nameO == null ? "" : Convert.ToString(nameO);
                        bool wild = pat.Length == 0 || pat.IndexOfAny(new char[] { '*', '?', '<', '>', '"' }) >= 0;
                        string what = wild ? folder : (folder == "." ? "" : folder + "/") + pat;
                        if (who != null && who.Harness != null) {
                            Harness h = byName[who.Harness];
                            if (wild) { h.Paths[what] = "list"; listed++; }
                            else if (!h.Paths.ContainsKey(what)) h.Paths[what] = "read";
                            continue;
                        }
                        Stray(who, ppid, t, first, last, what, wild ? "listed" : "looked for", roots, strays);
                        continue;
                    }
                    if (nameO == null) continue;
                    opens++;
                    string p = DosPath(Convert.ToString(nameO), devices);
                    if (p == null) { if (objO != null) objects.Remove(Address(objO)); continue; }
                    string low = p.ToLowerInvariant();
                    bool inside = low == wsLow.TrimEnd('\\') || low.StartsWith(wsLow);
                    if (!inside && low.IndexOf('~') >= 0) {
                        sb.Length = 0;
                        if (GetLongPathNameW(p, sb, 1024) > 0) { string lp = sb.ToString(); string ll = lp.ToLowerInvariant(); if (ll.StartsWith(wsLow)) { p = lp; low = ll; inside = true; } }
                    }
                    if (!inside) { if (objO != null) objects.Remove(Address(objO)); continue; }
                    // A folder opened for a lookup by pattern comes with its
                    // separator: sub\ is the folder sub.
                    string rel = low.Length <= wsLow.Length ? "." : p.Substring(wsLow.Length).Replace('\\', '/').TrimEnd('/');
                    if (rel.Length == 0) rel = ".";
                    if (objO != null) objects[Address(objO)] = rel;
                    // csrss looks at <image>.Config and .Manifest for a process
                    // as it starts: that look is the starting process's own.
                    if (who != null && who.Harness == null && Leaf(who.Image) == "csrss.exe") {
                        Inst st;
                        string img = Regex.Replace(p, "\\.(config|manifest|local)$", "", RegexOptions.IgnoreCase);
                        if (img != p && started.TryGetValue(img, out st) && st.Harness != null && (t - st.Start).TotalSeconds < 60) who = st;
                    }
                    if (who != null && who.Harness != null) {
                        Harness h = byName[who.Harness];
                        if (rel.IndexOf('~') >= 0) {
                            sb.Length = 0;
                            if (GetLongPathNameW(p, sb, 1024) > 0 && sb.ToString().ToLowerInvariant().StartsWith(wsLow)) rel = sb.ToString().Substring(wsLow.Length).Replace('\\', '/');
                            else if (h.Always == null) h.Always = "opened a short name in the checkout that no longer resolves (" + rel + ")";
                        }
                        if (!h.Paths.ContainsKey(rel)) h.Paths[rel] = "read";
                        kept++;
                        continue;
                    }
                    Stray(who, ppid, t, first, last, rel, "opened", roots, strays);
                }
            }
        }
        notes.Add(events + " events, " + opens + " opens, " + kept + " in the checkout by a harness, " + strays.Count + " by something else");
        notes.Add(enums + " directory enumerations, " + listed + " of them a listing in the checkout by a harness");
        return byName;
    }

    // Something no harness started, in the checkout while a harness ran:
    // every harness running then always runs.
    static void Stray(Inst who, int ppid, DateTime t, DateTime first, DateTime last, string rel, string did, List<Harness> roots, List<string> strays) {
        if (who != null && who.Driver) return;
        string img = who != null ? Leaf(who.Image) : (ppid == 4 ? "system" : "pid " + ppid);
        if (Array.IndexOf(Readers, img) >= 0) return;
        if (t < first || t > last) return;
        strays.Add(t.ToString("o") + " " + img + " " + rel);
        foreach (Harness h in roots) {
            if (h.Start <= t && t <= h.End && h.Always == null) h.Always = "another process (" + img + ") " + did + " " + rel + " in the checkout while it ran";
        }
    }

    static string Q(string s) {
        StringBuilder b = new StringBuilder("\"");
        foreach (char c in s) {
            if (c == '"' || c == '\\') b.Append('\\').Append(c);
            else if (c < ' ') b.Append("\\u").Append(((int)c).ToString("x4"));
            else b.Append(c);
        }
        return b.Append('"').ToString();
    }
    // One line of JSON a harness, in the shape Trace-HarnessReads.js writes.
    public static string Json(Harness h) {
        StringBuilder b = new StringBuilder();
        b.Append("{\"harness\":").Append(Q(h.Name)).Append(",\"platform\":\"windows\",\"listings\":\"enumerated\"");
        b.Append(",\"exit\":").Append(h.Ended ? h.Code : -1);
        b.Append(",\"seconds\":").Append(h.Secs.ToString(System.Globalization.CultureInfo.InvariantCulture));
        b.Append(",\"skipped\":").Append(h.Skipped ? "true" : "false");
        if (h.Always != null) b.Append(",\"always\":").Append(Q(h.Always));
        b.Append(",\"execs\":[");
        bool f = true;
        foreach (string i in h.Images) { if (!f) b.Append(','); f = false; b.Append(Q(i)); }
        b.Append("],\"paths\":{");
        f = true;
        foreach (KeyValuePair<string, string> kv in h.Paths) { if (!f) b.Append(','); f = false; b.Append(Q(kv.Key)).Append(':').Append(Q(kv.Value)); }
        return b.Append("}}").ToString();
    }
}
'@

# Only administrators and the system read or write the trace folder.
function New-TraceFolder {
    if (-not (Test-Path -LiteralPath $traceRoot)) { $null = New-Item -ItemType Directory -Path $traceRoot }
    $null = & icacls.exe $traceRoot /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('could not close ' + $traceRoot + ' to everyone but administrators (icacls exit ' + $LASTEXITCODE + ')') }
}

# The two providers and their keywords, by name. A provider whose keywords
# are not named the way this expects is said, with every name it has.
function Get-TraceProviders {
    $fileNames = New-Object 'System.Collections.Generic.List[string]'
    $procNames = New-Object 'System.Collections.Generic.List[string]'
    $fk = [ThornswoodTrace]::Keywords('Microsoft-Windows-Kernel-File', '^KERNEL_FILE_KEYWORD_(CREATE|CREATE_NEW_FILE)$', $fileNames)
    # The opens, by their keywords, and the directory enumerations, by their
    # task, with the keyword that carries them; only those ids are kept.
    $carried = [UInt64]0
    $script:enumIds = [ThornswoodTrace]::EventIds('Microsoft-Windows-Kernel-File', '^DirEnum$', 0, [ref]$carried)
    if (-not $script:enumIds.Count) { throw ('Microsoft-Windows-Kernel-File has no event whose task is DirEnum; its events: ' + [ThornswoodTrace]::TaskNames('Microsoft-Windows-Kernel-File')) }
    $none = [UInt64]0
    $openIds = [ThornswoodTrace]::EventIds('Microsoft-Windows-Kernel-File', $null, $fk, [ref]$none)
    $fileIds = [int[]](@($openIds) + @($script:enumIds) | Sort-Object -Unique)
    $pk = [ThornswoodTrace]::Keywords('Microsoft-Windows-Kernel-Process', '^WINEVENT_KEYWORD_PROCESS$', $procNames)
    if (-not $fk) { throw ('Microsoft-Windows-Kernel-File has no create keyword by the name this looks for; it has: ' + ([ThornswoodTrace]::KeywordNames('Microsoft-Windows-Kernel-File') -join ', ')) }
    if (-not $pk) { throw ('Microsoft-Windows-Kernel-Process has no process keyword by the name this looks for; it has: ' + ([ThornswoodTrace]::KeywordNames('Microsoft-Windows-Kernel-Process') -join ', ')) }
    'keywords: Kernel-File ' + ($fileNames -join ' ') + ' and 0x' + $carried.ToString('x') + ' for DirEnum; Kernel-Process ' + ($procNames -join ' ')
    'Kernel-File events kept: opens ' + (@($openIds) -join ' ') + ', enumerations ' + (@($script:enumIds) -join ' ')
    $script:providers = [Guid[]]@([ThornswoodTrace]::ProviderId('Microsoft-Windows-Kernel-File'), [ThornswoodTrace]::ProviderId('Microsoft-Windows-Kernel-Process'))
    $script:keywords = [UInt64[]]@(($fk -bor $carried), $pk)
    $script:ids = New-Object 'int[][]' 2
    $script:ids[0] = $fileIds
}

function Start-TraceSession([string]$name, [string]$etl, [int]$maxMb = 0) {
    $null = [ThornswoodTrace]::Stop($name)
    Remove-Item -LiteralPath $etl -Force -ErrorAction SilentlyContinue
    $e = [ThornswoodTrace]::Start($name, $etl, $script:providers, $script:keywords, $script:ids, $maxMb)
    if ($e -ne 0) { throw ('could not start the trace session ' + $name + ' (Windows error ' + $e + ')') }
    # After the start, so a process is in the trace or in this list or both.
    $procs = @(Get-CimInstance Win32_Process | ForEach-Object { [string]$_.ProcessId + "`t" + $_.Name })
    [IO.File]::WriteAllLines($etl + '.procs', [string[]]$procs)
    'session ' + $name + ' started, writing ' + $etl + ', with the ' + $procs.Count + ' processes running then'
}
function Read-Running([string]$etl) {
    $running = New-Object 'System.Collections.Generic.Dictionary[int,string]'
    foreach ($line in [IO.File]::ReadAllLines($etl + '.procs')) {
        $f = $line.Split("`t")
        $running[[int]$f[0]] = $f[1]
    }
    return ,$running
}
function Stop-TraceSession([string]$name) {
    $s = [ThornswoodTrace]::Stop($name)
    if ($s[0] -ne 0) { throw ('could not stop the trace session ' + $name + ' (Windows error ' + $s[0] + ')') }
    'session ' + $name + ' stopped: ' + $s[2] + ' buffers written, ' + $s[1] + ' events lost, ' + $s[3] + ' log buffers lost, ' + $s[4] + ' real time buffers lost'
    $script:lost = $s[1] + $s[3] + $s[4]
}

# A time from the start log: a string in Windows PowerShell 5.1, already a
# date in 7.
function ConvertTo-Utc($v) {
    if ($v -is [datetime]) { return $v.ToUniversalTime() }
    [DateTime]::Parse([string]$v, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}
function New-Root([string]$name, [int]$id, [datetime]$start) {
    $h = New-Object ThornswoodTrace+Harness
    $h.Name = $name; $h.Pid = $id; $h.Start = $start.ToUniversalTime()
    $h
}

function ConvertTo-Gzip([byte[]]$bytes) {
    $ms = New-Object IO.MemoryStream
    $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
    $gz.Write($bytes, 0, $bytes.Length); $gz.Close()
    return ,$ms.ToArray()
}

# Reads a stopped trace against a run's start log (the lines
# Nightly-Harnesses.ps1 -StartLog wrote) and its checkout: what it says
# about the read (Lines), and every harness's paths as one line of JSON
# each (Bytes, UTF-8), Count harnesses. Only paths inside the checkout.
function Read-GateTrace([string]$etl, [string]$startsText, [string]$workspace) {
    if (-not (Test-Path -LiteralPath $etl)) { throw ('no trace at ' + $etl) }
    $roots = New-Object 'System.Collections.Generic.List[ThornswoodTrace+Harness]'
    $byName = @{}
    foreach ($line in @($startsText -split "`n" | Where-Object { $_.Trim() })) {
        $o = $line | ConvertFrom-Json
        if ($null -ne $o.pid) {
            $h = New-Root $o.name ([int]$o.pid) (ConvertTo-Utc $o.start)
            $roots.Add($h); $byName[$o.name] = $h
        } elseif ($byName.ContainsKey($o.name)) {
            $h = $byName[$o.name]
            $h.End = ConvertTo-Utc $o.end
            $h.Code = [int]$o.code; $h.Secs = [double]$o.secs; $h.Skipped = [bool]$o.skipped; $h.Ended = $true
        }
    }
    if (-not $roots.Count) { throw 'the start log names no harness' }
    $strays = New-Object 'System.Collections.Generic.List[string]'
    $notes = New-Object 'System.Collections.Generic.List[string]'
    $null = [ThornswoodTrace]::Read($etl, $workspace, $roots, (Read-Running $etl), $script:enumIds, $strays, $notes)
    $lines = @($notes)
    if ($strays.Count) { $lines += 'strays (first 20): ' + (@($strays | Select-Object -First 20) -join '; ') }
    $sb = New-Object Text.StringBuilder
    foreach ($h in $roots) { [void]$sb.Append([ThornswoodTrace]::Json($h)).Append("`n") }
    return @{ Lines = $lines; Bytes = [Text.Encoding]::UTF8.GetBytes($sb.ToString()); Count = $roots.Count }
}

New-TraceFolder
Get-TraceProviders

# scripts\dev\Trace-Gate-Task.ps1 loads this for its functions and the
# reader, and runs no mode.
if ($TraceMode -eq 'library') { return }

switch ($TraceMode) {
    'selftest' {
        $fail = 0
        function Check([string]$what, [bool]$ok) { if ($ok) { 'PASS  ' + $what } else { 'FAIL  ' + $what; $script:fail++ } }
        $probe = Join-Path $traceRoot ('probe-' + [Guid]::NewGuid().ToString('N'))
        $null = New-Item -ItemType Directory -Path (Join-Path $probe 'sub'), (Join-Path $probe 'look'), (Join-Path $probe 'only')
        [IO.File]::WriteAllText((Join-Path $probe 'a.txt'), 'a')
        [IO.File]::WriteAllText((Join-Path $probe 'sub\b.txt'), 'b')
        [IO.File]::WriteAllText((Join-Path $probe 'other.txt'), 'o')
        $etl = Join-Path $traceRoot 'selftest.etl'
        # Something already running when the session starts, which opens a
        # file in the probe's folder once the probe has started: the read must
        # name it by its name, from the list of what was running.
        [IO.File]::WriteAllText((Join-Path $probe 'early.txt'), 'e')
        $go = Join-Path $probe 'go'
        $early = Start-Process -FilePath pwsh.exe -ArgumentList @('-NoProfile', '-Command', ("for (`$i = 0; `$i -lt 300 -and -not [IO.File]::Exists('" + $go + "'); `$i++) { Start-Sleep -Milliseconds 100 }; `$null = [IO.File]::ReadAllText('" + (Join-Path $probe 'early.txt') + "')")) -PassThru -WindowStyle Hidden
        $null = $early.Handle
        Start-TraceSession 'thornswood-trace-selftest' $etl
        Start-Sleep -Seconds 2
        # The probe: a file read, a file's attributes read, a file that is not
        # there looked for, a folder listed, and a child process that reads a
        # file and looks for another, each the way a harness does them; then
        # node doing the same through libuv, when the box has node.
        [IO.File]::WriteAllText((Join-Path $probe 'stat.txt'), 's')
        [IO.File]::WriteAllText((Join-Path $probe 'node-stat.txt'), 'n')
        $node = Get-Command node -ErrorAction SilentlyContinue
        $probeScript = @"
Set-Location -LiteralPath '$probe'
[Environment]::CurrentDirectory = '$probe'
`$null = [IO.File]::ReadAllText('a.txt')
`$null = [IO.File]::GetAttributes('stat.txt')
`$null = [IO.File]::Exists('missing.txt')
`$null = @(Get-ChildItem -LiteralPath 'sub')
`$null = [IO.Directory]::Exists('only')
& cmd.exe /c "type sub\b.txt > nul & if exist look\c-missing.txt echo no"
$(if ($node) { "& '" + $node.Source + "' -e `"const fs=require('fs');fs.statSync('node-stat.txt');try{fs.statSync('node-missing.txt')}catch(e){};fs.readdirSync('sub')`"" })
exit 0
"@
        $probeFile = Join-Path $traceRoot ('probe-' + [Guid]::NewGuid().ToString('N') + '.ps1')
        [IO.File]::WriteAllText($probeFile, $probeScript)
        $p = Start-Process -FilePath pwsh.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $probeFile + '"')) -PassThru -WindowStyle Hidden
        $null = $p.Handle
        [IO.File]::WriteAllText($go, 'go')
        $p.WaitForExit()
        $early.WaitForExit()
        $began = $p.StartTime.ToUniversalTime()
        # Something no harness started, opening a file in the probe's folder
        # while the probe "runs": the read must name it as a stray.
        $q = Start-Process -FilePath cmd.exe -ArgumentList @('/c', ('type "' + (Join-Path $probe 'other.txt') + '" > nul')) -PassThru -WindowStyle Hidden
        $q.WaitForExit()
        Start-Sleep -Seconds 3
        Stop-TraceSession 'thornswood-trace-selftest'
        Check ('no event was lost (' + $script:lost + ')') ($script:lost -eq 0)
        $root = New-Root 'probe' $p.Id $began
        $root.End = [DateTime]::UtcNow
        $roots = New-Object 'System.Collections.Generic.List[ThornswoodTrace+Harness]'
        $roots.Add($root)
        $strays = New-Object 'System.Collections.Generic.List[string]'
        $notes = New-Object 'System.Collections.Generic.List[string]'
        $read = [ThornswoodTrace]::Read($etl, $probe, $roots, (Read-Running $etl), $script:enumIds, $strays, $notes)
        $notes
        $got = @($read['probe'].Paths.Keys)
        'the probe opened: ' + ($got -join ', ')
        'its processes: ' + (@($read['probe'].Images) -join ', ')
        'Kernel-File create fields: ' + [ThornswoodTrace]::FieldNames('Microsoft-Windows-Kernel-File', 12)
        'Kernel-Process start fields: ' + [ThornswoodTrace]::FieldNames('Microsoft-Windows-Kernel-Process', 1)
        'Kernel-Process stop fields: ' + [ThornswoodTrace]::FieldNames('Microsoft-Windows-Kernel-Process', 2)
        # cmd's if exist opens the folder, look, and asks it for the one name
        # (a directory enumeration with that name as its pattern), so the
        # name is a look at look/c-missing.txt and the folder is no listing.
        $wants = @('a.txt', 'stat.txt', 'missing.txt', 'sub', 'sub/b.txt', 'look', 'look/c-missing.txt', 'only')
        if ($node) { $wants += @('node-stat.txt', 'node-missing.txt') } else { 'no node on this box, so the probe did not run it' }
        foreach ($want in $wants) {
            Check ('the probe''s ' + $want + ' is in its list') ($got -contains $want)
        }
        $kinds = $read['probe'].Paths
        Check ('the folder it listed is a listing (sub: ' + $kinds['sub'] + ')') ($kinds['sub'] -eq 'list')
        Check ('a folder it only looked at is not (only: ' + $kinds['only'] + ')') ($kinds['only'] -eq 'read')
        Check ('nor the folder cmd looked one name up in (look: ' + $kinds['look'] + ')') ($kinds['look'] -eq 'read')
        Check 'the child process it started is its own (cmd.exe)' (@($read['probe'].Images) -contains 'cmd.exe')
        if ($node) { Check '  and so is node' (@($read['probe'].Images) -contains 'node.exe') }
        Check ('what no harness started is named as a stray (' + ($strays -join '; ') + ')') (@($strays | Where-Object { $_ -match ' cmd\.exe other\.txt$' }).Count -ge 1)
        Check 'and not put on the probe' ($got -notcontains 'other.txt')
        Check ('what was running before the session is named as a stray by its name (pwsh.exe early.txt)') (@($strays | Where-Object { $_ -match ' pwsh\.exe early\.txt$' }).Count -ge 1)
        Remove-Item -LiteralPath $etl, ($etl + '.procs'), $probe, $probeFile -Recurse -Force -ErrorAction SilentlyContinue
        if ($fail) { 'the self-test FAILED: no gate trace from this box can be trusted until it passes'; exit 1 }
        'the self-test passed'
        exit 0
    }
    'start' {
        $free = (Get-PSDrive C).Free
        if ($free -lt 20GB) { throw ('only ' + [Math]::Round($free / 1GB, 1) + ' GB free on C:, under the 20 GB a gate trace may need') }
        Start-TraceSession $sessionName (Join-Path $traceRoot 'gate.etl')
        exit 0
    }
    'stop' {
        Stop-TraceSession $sessionName
        if ($script:lost) { 'REFUSED: ' + $script:lost + ' lost, so some opens were never seen and the trace proves nothing. Trace-Gate.ps1 deletes it.'; exit 1 }
        exit 0
    }
    'read' {
        $r = Read-GateTrace (Join-Path $traceRoot 'gate.etl') $TraceStarts $TraceWorkspace
        $r.Lines
        $b64 = [Convert]::ToBase64String((ConvertTo-Gzip $r.Bytes))
        'traces of ' + $r.Count + ' harnesses, ' + $r.Bytes.Length + ' bytes, ' + $b64.Length + ' as base64'
        'BEGIN'
        for ($i = 0; $i -lt $b64.Length; $i += 1000) { $b64.Substring($i, [Math]::Min(1000, $b64.Length - $i)) }
        'END'
        Remove-Item -LiteralPath (Join-Path $traceRoot 'gate.etl'), (Join-Path $traceRoot 'gate.etl.procs') -Force
        exit 0
    }
    'clean' {
        $null = [ThornswoodTrace]::Stop($sessionName)
        $null = [ThornswoodTrace]::Stop('thornswood-trace-selftest')
        # The trace task's own folders are its to empty, and -Uninstall's.
        Get-ChildItem -LiteralPath $traceRoot -Force | Where-Object { ($taskFolders + 'task.log', 'task.log.1') -notcontains $_.Name } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        'the trace folder is empty but for the trace task''s own, and no session but the task''s is running'
        exit 0
    }
    'install' {
        # The trace task (#3114, Patrick's option A on q-3114-map-refresh):
        # the scripts into C:\Thornswood-Trace\task, which only
        # administrators can read, the two folders in each build runner's
        # own folder, and the scheduled task that runs as SYSTEM.
        $runners = @(($TraceRunners | ConvertFrom-Json).runners)
        if (-not $runners.Count) { throw 'no build runners were named' }
        $taskDir = Join-Path $traceRoot 'task'
        $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($t) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
        $null = [ThornswoodTrace]::Stop($mainSession)
        $null = New-Item -ItemType Directory -Force -Path $taskDir
        # With a byte order mark: Windows PowerShell 5.1 reads a file without
        # one in the machine's code page.
        $bom = New-Object Text.UTF8Encoding($true)
        [IO.File]::WriteAllText((Join-Path $taskDir 'Trace-Gate-Box.ps1'), $TraceBoxText, $bom)
        [IO.File]::WriteAllText((Join-Path $taskDir 'Trace-Gate-Task.ps1'), $TraceTaskText, $bom)
        foreach ($f in 'Trace-Gate-Box.ps1', 'Trace-Gate-Task.ps1') {
            $errs = $null
            [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $taskDir $f), [ref]$null, [ref]$errs)
            if ($errs -and $errs.Count) { throw ($f + ' does not parse on the box: ' + $errs[0].Message) }
        }
        $kept = @()
        foreach ($w in $runners) {
            $root = [string]$w.root
            if ($root -notmatch '^C:\\Thornswood-Runner\d*$' -or -not (Test-Path -LiteralPath $root -PathType Container)) { throw ('no runner folder ' + $root) }
            $sid = (New-Object Security.Principal.NTAccount([string]$w.account)).Translate([Security.Principal.SecurityIdentifier]).Value
            # trace: the runner's to write, as its folder is; the task reads it.
            $trace = Join-Path $root 'trace'
            $null = New-Item -ItemType Directory -Force -Path $trace
            # gate-map: the task's to write and the runner's only to read, so
            # no job can change the map another job is held to. Owned by
            # Administrators (an owner may always change the rules) and taking
            # nothing from the runner's folder, where the account may write.
            $map = Join-Path $root 'gate-map'
            $null = New-Item -ItemType Directory -Force -Path $map
            $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            $o1 = & icacls.exe $map /setowner '*S-1-5-32-544' /T /C /Q 2>&1
            $c1 = $LASTEXITCODE
            $o2 = & icacls.exe $map /reset /T /C /Q 2>&1
            $c2 = $LASTEXITCODE
            $o3 = & icacls.exe $map /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ('*' + $sid + ':(OI)(CI)RX') /C /Q 2>&1
            $c3 = $LASTEXITCODE
            $o4 = & icacls.exe $map /inheritance:r /C /Q 2>&1
            $c4 = $LASTEXITCODE
            $ErrorActionPreference = $old
            if ($c1 -or $c2 -or $c3 -or $c4) { throw ('icacls could not lock ' + $map + ': ' + ((@($o1) + @($o2) + @($o3) + @($o4) | ForEach-Object { "$_" }) -join ' ')) }
            $acl = Get-Acl -LiteralPath $map
            $write = [Security.AccessControl.FileSystemRights]'Write, Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership, AppendData, CreateFiles'
            $open = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object {
                "$($_.AccessControlType)" -eq 'Allow' -and @('S-1-5-18', 'S-1-5-32-544') -notcontains $_.IdentityReference.Value -and ($_.FileSystemRights -band $write) })
            if (-not $acl.AreAccessRulesProtected -or $open.Count -or $acl.Owner -notmatch 'Administrators') { throw ($map + ' is still open to writing by ' + (@($open | ForEach-Object { $_.IdentityReference.Value }) -join ', ')) }
            $kept += [ordered]@{ root = $root; account = [string]$w.account; sid = $sid }
            $root + ': ' + $trace + ' for its asks, ' + $map + ' locked to reading for ' + $w.account
        }
        [IO.File]::WriteAllText((Join-Path $taskDir 'task.json'), ((@{ runners = $kept }) | ConvertTo-Json -Depth 4))
        $a = New-ScheduledTaskAction -Execute (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe') -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $taskDir 'Trace-Gate-Task.ps1') + '"')
        # At startup and never on a timer: the task's loop holds every fault
        # it meets and writes it to task.log, and a task that is not running
        # shows on every main build ("the trace task did not answer") and in
        # -Status, to be found and fixed, not restarted over.
        # Priority 7, Task Scheduler's below normal, on purpose: nothing it
        # does may slow a build or the game servers, and a build waits up to
        # a minute for its answer.
        # SYSTEM, and not LOCAL SERVICE as the services are
        # (scripts\deploy\ServiceAccount.ps1): only an administrator, SYSTEM
        # or the Performance Log Users group may start a kernel trace session,
        # and putting LOCAL SERVICE in that group would hand it to the site,
        # voice and Caddy as well. The task runs nothing a job hands it: an
        # ask is a few checked fields, read as data.
        $set = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 7
        $who = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $null = Register-ScheduledTask -TaskName $taskName -Action $a -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $set -Principal $who -Description 'Traces every main build''s gate for the pull request map (#3114, scripts\dev\Trace-Gate-Task.ps1)' -Force
        Start-ScheduledTask -TaskName $taskName
        Start-Sleep -Seconds 5
        $t = Get-ScheduledTask -TaskName $taskName
        'task ' + $taskName + ': ' + $t.State
        if (Test-Path -LiteralPath $taskLog) { Get-Content -LiteralPath $taskLog -Tail 5 }
        exit 0
    }
    'status' {
        $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if (-not $t) { 'task ' + $taskName + ': NOT INSTALLED'; exit 1 }
        $i = Get-ScheduledTaskInfo -TaskName $taskName
        'task ' + $taskName + ': ' + $t.State + ', last started ' + $i.LastRunTime + ', result ' + $i.LastTaskResult
        $conf = [IO.File]::ReadAllText((Join-Path $traceRoot 'task\task.json')) | ConvertFrom-Json
        foreach ($w in @($conf.runners)) {
            $latest = Join-Path $w.root 'gate-map\latest.json'
            if (Test-Path -LiteralPath $latest) { $w.root + ': map ' + [IO.File]::ReadAllText($latest) } else { $w.root + ': no map yet' }
        }
        'free on C: ' + [Math]::Round((Get-PSDrive C).Free / 1GB, 1) + ' GB'
        '--- task.log, last 25 ---'
        if (Test-Path -LiteralPath $taskLog) { Get-Content -LiteralPath $taskLog -Tail 25 }
        exit 0
    }
    'uninstall' {
        $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($t) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
        $null = [ThornswoodTrace]::Stop($mainSession)
        $conf = $null
        $cf = Join-Path $traceRoot 'task\task.json'
        if (Test-Path -LiteralPath $cf) { $conf = [IO.File]::ReadAllText($cf) | ConvertFrom-Json }
        # Without the two folders a main build asks nothing and a pull request
        # runs the whole gate, as before the task.
        foreach ($w in @($(if ($conf) { $conf.runners }))) {
            foreach ($d in 'trace', 'gate-map') {
                Remove-Item -LiteralPath (Join-Path $w.root $d) -Recurse -Force -ErrorAction SilentlyContinue
                if (Test-Path -LiteralPath (Join-Path $w.root $d)) { 'COULD NOT remove ' + (Join-Path $w.root $d) } else { 'removed ' + (Join-Path $w.root $d) }
            }
        }
        foreach ($d in $taskFolders) { Remove-Item -LiteralPath (Join-Path $traceRoot $d) -Recurse -Force -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $taskLog, ($taskLog + '.1') -Force -ErrorAction SilentlyContinue
        'the trace task is gone: ' + $(if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { 'STILL REGISTERED' } else { 'unregistered' })
        exit 0
    }
    default { throw ('no such mode: ' + $TraceMode) }
}
