using System;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// Is this path really inside that folder? The one rule both exes fence
    /// their writes and deletes with.
    ///
    /// A plain StartsWith is not enough, and it matters most in the places
    /// that write and delete. "C:\Thornswood2\anything" starts with
    /// "C:\Thornswood", so a pack whose file list contained ..\Thornswood2
    /// would pass a prefix test and be treated as ours. Comparing against
    /// the folder plus its separator is the whole fix.
    ///
    /// Setup.csproj compiled this file into the setup program as well (#3561:
    /// its unpack compared against the scratch folder with a bare StartsWith
    /// while the launcher already had this rule) until #4824 retired that
    /// program, which is why it uses nothing else from launcher\app. It compares text and resolves neither
    /// side, so every caller passes a path from Path.GetFullPath.
    /// tests\test-updater.ps1 and installer\tests\test-3561-setup-unpack-fence.ps1 run it.
    /// </summary>
    static class PathFence
    {
        internal static bool Inside(string full, string folder)
        {
            if (string.IsNullOrEmpty(full) || string.IsNullOrEmpty(folder)) return false;
            string fence = folder.TrimEnd(Path.DirectorySeparatorChar,
                                          Path.AltDirectorySeparatorChar)
                         + Path.DirectorySeparatorChar;
            return full.StartsWith(fence, StringComparison.OrdinalIgnoreCase);
        }
    }

    // The prepared form of the setup ownership list is read by setup, uninstall
    // and the Steam cleanup. A receipt records the identity of a completed
    // staging copy, not the name or bytes of whatever is already in Steam.
    static class SetupOwnership
    {
        internal static System.Collections.Generic.IEnumerable<string> PathsIn(string manifest, string game)
        {
            foreach (string raw in File.ReadAllLines(manifest))
            {
                string line = raw.Trim();
                if (line.Length == 0) continue;
                if (!line.StartsWith("setup|", StringComparison.Ordinal)) { yield return line; continue; }
                if (TryPrepared(game, line, out string rel, out string stage, out string identity) &&
                    Published(Path.Combine(game, rel), stage, identity)) yield return rel;
            }
        }

        internal static bool TryPrepared(string game, string line, out string rel, out string stage, out string identity)
        {
            rel = stage = identity = null;
            string[] parts = line.Split('|');
            if (parts.Length != 4 || parts[0] != "setup" || !Guid.TryParseExact(parts[1], "N", out _) ||
                string.IsNullOrEmpty(game) || parts[2].Length == 0 || parts[3].Length == 0 || Path.IsPathRooted(parts[3])) return false;
            string root = Path.GetFullPath(game);
            string dest = Path.GetFullPath(Path.Combine(root, parts[3]));
            if (!PathFence.Inside(dest, root)) return false;
            rel = parts[3];
            identity = parts[2];
            stage = Path.Combine(Path.GetDirectoryName(dest), ".tw-setup-" + parts[1], "payload");
            return true;
        }

        static bool Published(string dest, string stage, string identity)
        {
            try { File.GetAttributes(stage); return false; }
            catch (IOException e) when (e is FileNotFoundException || e is DirectoryNotFoundException)
            {
                // A missing source is necessary, not sufficient: a different
                // file at the destination never inherits the prepared receipt.
                try { return Identity(dest) == identity; }
                catch (IOException missing) when (missing is FileNotFoundException || missing is DirectoryNotFoundException)
                {
                    Swallow.Note("SetupOwnership, prepared copy has no destination at " + dest, missing);
                    return false;
                }
            }
        }

        internal static string Identity(string path)
        {
            if ((File.GetAttributes(path) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) return null;
            if (OperatingSystem.IsWindows())
            {
                using var file = File.OpenHandle(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                if (GetFileInformationByHandle(file, out WindowsFile info) && (info.IndexLow != 0 || info.IndexHigh != 0))
                    return FormattableString.Invariant($"w:{info.Volume:x}:{info.IndexHigh:x}:{info.IndexLow:x}:{info.CreatedHigh:x}:{info.CreatedLow:x}");
            }
            else if (OperatingSystem.IsLinux())
            {
                // statx's fixed-width ABI includes inode, device and birth time.
                const uint wanted = 0x900;
                if (Statx(-100, path, 0x100, wanted, out LinuxFile info) == 0 && (info.Mask & wanted) == wanted)
                    return FormattableString.Invariant($"l:{info.Major:x}:{info.Minor:x}:{info.Inode:x}:{info.Born:x}:{info.BornNanos:x}");
                File.GetAttributes(path); // keep missing-path errors distinct from unknown identity
            }
            throw new IOException("Could not identify the setup copy at " + path + ".");
        }

        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        struct WindowsFile
        {
            public uint Attributes, CreatedLow, CreatedHigh, AccessLow, AccessHigh, WriteLow, WriteHigh;
            public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }

        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Explicit, Size = 256)]
        struct LinuxFile
        {
            [System.Runtime.InteropServices.FieldOffset(0)] public uint Mask;
            [System.Runtime.InteropServices.FieldOffset(32)] public ulong Inode;
            [System.Runtime.InteropServices.FieldOffset(80)] public long Born;
            [System.Runtime.InteropServices.FieldOffset(88)] public uint BornNanos;
            [System.Runtime.InteropServices.FieldOffset(136)] public uint Major;
            [System.Runtime.InteropServices.FieldOffset(140)] public uint Minor;
        }

        [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle file, out WindowsFile info);

        [System.Runtime.InteropServices.DllImport("libc", EntryPoint = "statx", SetLastError = true)]
        static extern int Statx(int dir, [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPUTF8Str)] string path,
                                int flags, uint mask, out LinuxFile info);
    }
}
