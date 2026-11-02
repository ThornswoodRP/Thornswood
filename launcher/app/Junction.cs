using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Thornswood
{
    /// <summary>
    /// Makes an NTFS junction (a folder that is really another folder) without
    /// going through cmd.exe.
    ///
    /// The save folder redirect used to shell out to "cmd /c mklink /J" and
    /// throw away everything cmd said. When that failed on a tester's machine
    /// the log held one line, "Could not point the save folder at character 1",
    /// and nothing about why: whether the folder would not clear, whether
    /// Windows refused the link, whether cmd itself was blocked. This does the
    /// same thing Windows does for mklink /J, sets the reparse point itself,
    /// and hands back Windows' own words when it cannot.
    /// </summary>
    static partial class Junction
    {
        const uint FSCTL_SET_REPARSE_POINT    = 0x000900A4;
        const uint IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003;
        const uint GENERIC_WRITE                = 0x40000000;
        const uint FILE_SHARE_READ              = 0x00000001;
        const uint FILE_SHARE_WRITE             = 0x00000002;
        const uint OPEN_EXISTING                = 3;
        const uint FILE_FLAG_BACKUP_SEMANTICS   = 0x02000000;
        const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;

        [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        private static partial SafeFileHandle CreateFile(string lpFileName, uint dwDesiredAccess, uint dwShareMode,
            IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool DeviceIoControl(SafeFileHandle hDevice, uint dwIoControlCode, IntPtr lpInBuffer, int nInBufferSize,
            IntPtr lpOutBuffer, int nOutBufferSize, out int lpBytesReturned, IntPtr lpOverlapped);

        // REPARSE_DATA_BUFFER with the MountPointReparseBuffer arm, laid out
        // the way FSCTL_SET_REPARSE_POINT wants it: an 8 byte header, four
        // ushorts, then both names as UTF-16 with a null after each. The
        // names' room is a fixed buffer, so the whole structure is plain
        // memory with no marshalling code to make at run time (#4823).
        [StructLayout(LayoutKind.Sequential)]
        unsafe struct ReparseData
        {
            public uint ReparseTag;
            public ushort ReparseDataLength;
            public ushort Reserved;
            public ushort SubstituteNameOffset;
            public ushort SubstituteNameLength;
            public ushort PrintNameOffset;
            public ushort PrintNameLength;
            public fixed byte PathBuffer[0x3FF0];
        }

        /// <summary>True when the folder is a junction or symbolic link, not a plain folder.</summary>
        public static bool IsLink(string p)
        {
            try
            {
                if (!Directory.Exists(p)) return false;
                return (new DirectoryInfo(p).Attributes & FileAttributes.ReparsePoint) != 0;
            }
            catch { return false; }
        }

        /// <summary>
        /// Makes <paramref name="link"/> point at <paramref name="target"/>. The
        /// link must not exist or must be an empty folder. On failure the reason
        /// is Windows' own message for it, with the error number, and a second
        /// attempt goes through cmd's mklink in case the first way was the
        /// problem rather than the folder.
        /// </summary>
        public static bool Create(string link, string target, out string why)
        {
            why = null;
            string direct = null;
            bool made = false;
            try
            {
                if (!Directory.Exists(link)) { Directory.CreateDirectory(link); made = true; }
                Set(link, target, out direct);
            }
            catch (Exception ex) { direct = ex.Message; }
            if (IsLink(link)) return true;

            // Set failed and left behind the empty folder made for it a moment
            // ago. That folder has to go. It sits exactly where the person's
            // own folder has to be put back, and Restore will not move a
            // backup onto a name that already exists. It also unblocks the
            // mklink attempt below, which refuses a path that is already there.
            if (made) { try { Directory.Delete(link); } catch (Exception ex) { Swallow.Note("Junction.Create, removing leftover " + link, ex); } }

            string shell = null;
            try
            {
                var psi = new ProcessStartInfo("cmd.exe", "/c mklink /J \"" + link + "\" \"" + target + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (var pr = Process.Start(psi))
                {
                    string o = pr.StandardOutput.ReadToEnd();
                    string e = pr.StandardError.ReadToEnd();
                    pr.WaitForExit();
                    shell = (e + " " + o).Trim();
                    if (shell.Length == 0) shell = "mklink exit code " + pr.ExitCode;
                }
            }
            catch (Exception ex) { shell = ex.Message; }
            if (IsLink(link)) return true;

            why = (direct ?? "no reason given");
            if (!string.IsNullOrEmpty(shell) && shell.IndexOf("Junction created", StringComparison.OrdinalIgnoreCase) < 0)
                why += "; mklink said: " + shell;
            return false;
        }

        static bool Set(string link, string target, out string why)
        {
            why = null;
            string full = Path.GetFullPath(target).TrimEnd('\\');
            byte[] sub = Encoding.Unicode.GetBytes("\\??\\" + full);
            byte[] print = Encoding.Unicode.GetBytes(full);
            if (sub.Length + print.Length + 4 > 0x3FF0) { why = "the path is too long for a junction"; return false; }

            using (SafeFileHandle h = CreateFile(link, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero,
                                                 OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero))
            {
                if (h.IsInvalid) { why = "could not open the folder to make it a link: " + Win32(); return false; }

                var data = new ReparseData();
                data.ReparseTag = IO_REPARSE_TAG_MOUNT_POINT;
                data.ReparseDataLength = (ushort)(8 + sub.Length + 2 + print.Length + 2);
                data.Reserved = 0;
                data.SubstituteNameOffset = 0;
                data.SubstituteNameLength = (ushort)sub.Length;
                data.PrintNameOffset = (ushort)(sub.Length + 2);
                data.PrintNameLength = (ushort)print.Length;
                unsafe
                {
                    var names = new Span<byte>(data.PathBuffer, 0x3FF0);
                    sub.CopyTo(names);
                    print.CopyTo(names.Slice(sub.Length + 2));
                }

                int size = Marshal.SizeOf<ReparseData>();
                IntPtr buf = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(data, buf, false);
                    int got;
                    if (!DeviceIoControl(h, FSCTL_SET_REPARSE_POINT, buf, data.ReparseDataLength + 8, IntPtr.Zero, 0, out got, IntPtr.Zero))
                    {
                        why = "Windows refused the link: " + Win32();
                        return false;
                    }
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
            return true;
        }

        static string Win32()
        {
            int code = Marshal.GetLastWin32Error();
            string text = new Win32Exception(code).Message.TrimEnd('.', ' ');
            return text + " (error " + code + ")";
        }
    }
}
