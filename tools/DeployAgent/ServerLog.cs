#nullable enable
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Thornswood.DeployAgent;

public static class Files
{
    /// <summary>Opens a file for reading while letting its writer go on, and
    /// rename or delete it: server-log.js rolls server.log by renaming it, and
    /// a reader without delete sharing would stop the roll.</summary>
    public static FileStream OpenShared(string path) =>
        new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);

    public static byte[] ReadShared(string path)
    {
        using var f = OpenShared(path);
        using var ms = new MemoryStream();
        f.CopyTo(ms);
        return ms.ToArray();
    }

    /// <summary>Writes beside the file and renames over it, so a reader never
    /// meets a half written file.</summary>
    public static void WriteWhole(string path, byte[] bytes)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".agent-new";
        File.WriteAllBytes(tmp, bytes);
        Into(tmp, path);
    }

    /// <summary>Puts from in place of to in one rename, while readers that
    /// opened to sharing delete (the engine, the site, this agent's own
    /// reads) hold it: they keep the old bytes and the next open gets the new.
    /// File.Move with overwrite is MoveFileEx with MOVEFILE_REPLACE_EXISTING,
    /// which Windows refuses with "Access is denied" while any handle is open
    /// on the file it replaces, even one sharing delete (#2727 measured it:
    /// 1616 of 2000 swaps refused beside a reader). So on Windows this is the
    /// rename Feed-Store.ps1 uses, FileRenameInfoEx with
    /// FILE_RENAME_FLAG_POSIX_SEMANTICS (Windows Server 2019 or later on NTFS;
    /// the box is 2022). A handle opened without delete sharing still refuses
    /// it, as it should. Elsewhere File.Move is rename(2), which already
    /// does this.</summary>
    public static void Into(string from, string to)
    {
        if (!OperatingSystem.IsWindows()) { File.Move(from, to, true); return; }
        string source = Path.GetFullPath(from), target = Path.GetFullPath(to);
        using var h = Rename.CreateFileW(source, Rename.Access, Rename.ShareAll, IntPtr.Zero, Rename.OpenExisting, Rename.WriteThrough, IntPtr.Zero);
        if (h.IsInvalid) throw Rename.Failed(from, to, Marshal.GetLastPInvokeError());
        // FILE_RENAME_INFO: Flags, RootDirectory (none), FileNameLength in
        // bytes, then the name.
        var name = Encoding.Unicode.GetBytes(target);
        int lengthAt = IntPtr.Size * 2, nameAt = lengthAt + 4, size = nameAt + name.Length + 2;
        var info = Marshal.AllocHGlobal(size);
        try
        {
            for (int i = 0; i < size; i++) Marshal.WriteByte(info, i, 0);
            Marshal.WriteInt32(info, 0, Rename.Flags);
            Marshal.WriteInt32(info, lengthAt, name.Length);
            Marshal.Copy(name, 0, IntPtr.Add(info, nameAt), name.Length);
            if (!Rename.SetFileInformationByHandle(h, Rename.FileRenameInfoEx, info, (uint)size)) throw Rename.Failed(from, to, Marshal.GetLastPInvokeError());
        }
        finally { Marshal.FreeHGlobal(info); }
    }

    static class Rename
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle file, int infoClass, IntPtr info, uint size);
        // DELETE | SYNCHRONIZE | FILE_READ_ATTRIBUTES on the new file, shared
        // all ways, write-through as MOVEFILE_WRITE_THROUGH opens it.
        public const uint Access = 0x00010000 | 0x00100000 | 0x80;
        public const uint ShareAll = 0x1 | 0x2 | 0x4;
        public const uint OpenExisting = 3;
        public const uint WriteThrough = 0x80000000;
        public const int FileRenameInfoEx = 22;
        // FILE_RENAME_FLAG_REPLACE_IF_EXISTS | FILE_RENAME_FLAG_POSIX_SEMANTICS
        public const int Flags = 0x1 | 0x2;
        public static IOException Failed(string from, string to, int error) =>
            new(to + " could not be replaced by " + from + ": " + new System.ComponentModel.Win32Exception(error).Message);
    }

    /// <summary>A copy that inherits the folder it lands in, flushed to disk.</summary>
    public static void Copy(string from, string to)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(to)!);
        using var src = OpenShared(from);
        using var dst = new FileStream(to, FileMode.Create, FileAccess.Write, FileShare.None);
        src.CopyTo(dst);
        dst.Flush(true);
    }

    /// <summary>The git blob id of a gamemode.js, worked out the way the
    /// gamemode works it out as it loads (game/gamemode.js, gamemodeId) and
    /// Reload.ps1 does: every CR LF made LF, then git's blob hash.</summary>
    public static string GamemodeBlob(string path) => GamemodeBlob(ReadShared(path));

    /// <summary>The same, of bytes already read.</summary>
    public static string GamemodeBlob(byte[] b)
    {
        var lf = new MemoryStream(b.Length);
        for (int i = 0; i < b.Length; i++)
        {
            if (b[i] == '\r' && i + 1 < b.Length && b[i + 1] == '\n') continue;
            lf.WriteByte(b[i]);
        }
        var body = lf.ToArray();
        var head = Encoding.ASCII.GetBytes($"blob {body.Length}\0");
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA1);
        sha.AppendData(head);
        sha.AppendData(body);
        return Convert.ToHexStringLower(sha.GetHashAndReset());
    }
}

/// <summary>Reads what server.log says after a mark, the way Reload.ps1 does.
/// server-log.js rolls the log at midnight and at 4 MB by renaming it to
/// server.log.&lt;digits&gt; and starting a new one (scripts/vps/Server-Log.js),
/// so a rolled name that was not there at the mark holds the end of what
/// followed it, and the rest is in the new server.log from its start. Each
/// look reads up to the last whole line.</summary>
public sealed class ServerLog(string root)
{
    static readonly Regex RolledName = new(@"^server\.log\.\d+$");
    static readonly Regex BlobLine = new(@"gamemode\.js is git blob ([0-9a-f]{40})");
    static readonly Regex TreeLine = new(@"gamemode tables are git tree ([0-9a-f]{40})");
    long at;
    HashSet<string> rolled = new();
    public List<string> Tail { get; } = new();

    IEnumerable<string> RolledFiles() =>
        Directory.EnumerateFiles(root).Where(f => RolledName.IsMatch(Path.GetFileName(f))).OrderBy(f => f, StringComparer.Ordinal);

    public void Mark()
    {
        rolled = RolledFiles().ToHashSet();
        var log = Path.Combine(root, "server.log");
        at = File.Exists(log) ? new FileInfo(log).Length : 0;
    }

    static (string text, long end)? ReadFrom(string path, long from, bool whole)
    {
        try
        {
            using var f = Files.OpenShared(path);
            if (from > f.Length) return null;
            f.Seek(from, SeekOrigin.Begin);
            var buf = new byte[f.Length - from];
            int got = 0, n;
            while (got < buf.Length && (n = f.Read(buf, got, buf.Length - got)) > 0) got += n;
            int use = whole ? got : Array.LastIndexOf(buf, (byte)'\n', Math.Max(0, got - 1)) + 1;
            if (got == 0) use = 0;
            return (Encoding.UTF8.GetString(buf, 0, use), from + use);
        }
        catch (FileNotFoundException) { return null; }
        catch (IOException) { return null; }
    }

    /// <summary>The whole lines written since the last look.</summary>
    public List<string> Lines()
    {
        var text = new StringBuilder();
        foreach (var f in RolledFiles())
        {
            if (!rolled.Add(f)) continue;
            if (ReadFrom(f, at, true) is { } r) text.Append(r.text);
            at = 0;
        }
        if (ReadFrom(Path.Combine(root, "server.log"), at, false) is { } t)
        {
            text.Append(t.text);
            at = t.end;
        }
        var outLines = new List<string>();
        foreach (var l in text.ToString().Replace("\r\n", "\n").Split('\n'))
        {
            if (l == "") continue;
            outLines.Add(l);
            Tail.Add(l);
            if (Tail.Count > 30) Tail.RemoveAt(0);
        }
        return outLines;
    }

    /// <summary>Reads server.log until it says how the load of the gamemode
    /// with this blob went, or the time is up. "" when that gamemode loaded,
    /// else why not, with the lines that said so. This waits on the server
    /// saying something, which the server orders after the load; it is not a
    /// guess at how long a load takes. The load is held to the tree of its
    /// tables as well (#5191), the line the gamemode logs after its blob; tree
    /// "" is a folder with no tables, which a gamemode from before #5191 runs
    /// beside, and then only the blob is held.</summary>
    public (string why, List<string> said) AwaitLoad(string blob, string tree, TimeSpan within, TimeSpan tick)
    {
        var said = new List<string>();
        var last = "";
        var lastTree = "";
        var deadline = DateTime.UtcNow + within;
        while (true)
        {
            foreach (var l in Lines())
            {
                var m = BlobLine.Match(l);
                var t = TreeLine.Match(l);
                if (m.Success) { last = m.Groups[1].Value; lastTree = ""; said.Add(l); }
                else if (t.Success) { lastTree = t.Groups[1].Value; said.Add(l); }
                else if (l.Contains("[thornswood] gamemode client scripts "))
                {
                    said.Add(l);
                    if (last == "") return ("a gamemode loaded without saying which it is", said);
                    if (last != blob) return ("a different gamemode loaded, git blob " + last, said);
                    if (tree == "" || lastTree == tree) return ("", said);
                    return (lastTree != "" ? "the gamemode loaded a different set of tables, git tree " + lastTree : "the gamemode loaded without saying which tables it read", said);
                }
                else if (l.Contains("[thornswood] gamemode did not load") || l.Contains("Bad syntax, ignoring"))
                {
                    said.Add(l);
                    return ("it did not load", said);
                }
            }
            if (DateTime.UtcNow > deadline) return ($"nothing in server.log said it loaded within {(int)within.TotalSeconds} seconds", said);
            Thread.Sleep(tick);
        }
    }
}

/// <summary>The one turn at the game server folders the nightly backup and
/// every deploy take (#3247, scripts/deploy/ServerFolderTurn.ps1): the file
/// server-folders.turn in the backup's folder, opened with no sharing, and who
/// has it written beside it. Waiting for it is waiting for another process to
/// finish, which that process orders; it is not a step tried again.</summary>
public sealed class Turn : IDisposable
{
    FileStream? held;

    /// <summary>Waits up to within for the turn. With no turn folder there is
    /// nothing to take turns with, and it holds nothing.</summary>
    public static Turn Take(string folder, string who, TimeSpan within, Action<string> tell)
    {
        if (folder == "" || !Directory.Exists(folder)) return new Turn();
        var path = Path.Combine(folder, "server-folders.turn");
        var note = Path.Combine(folder, "server-folders.turn.who");
        var deadline = DateTime.UtcNow + within;
        var told = false;
        while (true)
        {
            try
            {
                var f = new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                File.WriteAllText(note, $"{who}, pid {System.Environment.ProcessId}, since {DateTime.Now:h:mm:ss tt}");
                return new Turn { held = f };
            }
            catch (IOException e) when (e.GetType() == typeof(IOException) && IsTaken(e))
            {
                var holder = "a run that has not said who it is";
                try { holder = File.ReadAllText(note).Trim(); } catch (IOException) { }
                if (DateTime.UtcNow > deadline) throw new TimeoutException($"the server folders are still taken after {(int)within.TotalSeconds} s, by {holder}");
                if (!told) { tell("waiting for the server folders, which " + holder + " has"); told = true; }
                Thread.Sleep(TimeSpan.FromSeconds(2));
            }
        }
    }

    // Only "another process has it open" is a wait: 0x80070020 or 21 on
    // Windows, 11 (EWOULDBLOCK) where .NET locks with flock.
    static bool IsTaken(IOException e) => e.HResult is unchecked((int)0x80070020) or unchecked((int)0x80070021) or 11 || (e.HResult & 0xFFFF) is 0x20 or 0x21;

    public void Dispose() { held?.Dispose(); held = null; }
}
