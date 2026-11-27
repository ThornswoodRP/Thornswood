using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// Writes a file of the launcher's whole or not at all (#4702).
    ///
    /// config.json, the Discord sign-in files, the door note, the character
    /// list the game's menu reads and SkyrimPlatform.ini were written in place
    /// with File.WriteAllBytes and File.WriteAllText, which empty the file
    /// first and then fill it. A launcher stopped in between (Task Manager, a
    /// crash, the PC losing power) left a short file: Config.Load reads a
    /// config.json that is not JSON as no settings at all, so every choice
    /// went back to its default and a dev install turned into a main one.
    ///
    /// Here the bytes go to path + ".new" first, flushed to the disk, and that
    /// is renamed over path in one call: MoveFileEx with
    /// MOVEFILE_REPLACE_EXISTING and MOVEFILE_WRITE_THROUGH, the call
    /// OwnGame.WriteRecord makes for the folder's records. Until the rename
    /// path is the old file, after it the new one. Killed 150 times on One
    /// (#2591), that rename left the file whole every time, where a delete and
    /// then a move left it missing 30 times and File.Replace 6.
    ///
    /// A launcher stopped before the rename leaves the .new beside the file
    /// and the file as it was; the next write to the same file starts the
    /// .new again from nothing. Off Windows (a harness in a cloud session)
    /// the rename is File.Move over the file, which is rename(2) there and
    /// replaces it in one step as well.
    /// </summary>
    static partial class WholeFile
    {
        /// <summary>The name a write is made under before it is renamed over path.</summary>
        internal static string Next(string path) { return path + ".new"; }

        /// <summary>Puts bytes in path, whole.</summary>
        internal static void Write(string path, byte[] bytes) { Write(path, bytes, null); }

        /// <summary>
        /// Puts bytes in path, whole. beforeSwap, when given, is handed the
        /// written .new before it takes path's place, so a file that has to be
        /// kept to this account (Secrets.LockDown) arrives under its name
        /// already locked.
        /// </summary>
        internal static void Write(string path, byte[] bytes, Action<string> beforeSwap)
        {
            string next = Next(path);
            using (var fs = new FileStream(next, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                fs.Write(bytes, 0, bytes.Length);
                fs.Flush(true);
            }
            if (beforeSwap != null) beforeSwap(next);
            SwapIn(next, path);
        }

        /// <summary>Text in path, whole, UTF-8 with no byte order mark, as File.WriteAllText writes it.</summary>
        internal static void WriteText(string path, string text) { WriteText(path, text, new UTF8Encoding(false), null); }

        /// <summary>Text in path, whole, in encoding, its byte order mark first when it has one.</summary>
        internal static void WriteText(string path, string text, Encoding encoding) { WriteText(path, text, encoding, null); }

        /// <summary>Text in path, whole, with beforeSwap as Write has it.</summary>
        internal static void WriteText(string path, string text, Encoding encoding, Action<string> beforeSwap)
        {
            byte[] mark = encoding.GetPreamble();
            byte[] body = encoding.GetBytes(text ?? "");
            var all = new byte[mark.Length + body.Length];
            Buffer.BlockCopy(mark, 0, all, 0, mark.Length);
            Buffer.BlockCopy(body, 0, all, mark.Length, body.Length);
            Write(path, all, beforeSwap);
        }

        /// <summary>Renames next over path in one call, replacing it.</summary>
        static void SwapIn(string next, string path)
        {
            if (!OperatingSystem.IsWindows())
            {
                File.Move(next, path, true);
                return;
            }
            if (!MoveFileEx(next, path, MoveReplaceExisting | MoveWriteThrough))
                throw new IOException(path + " could not be replaced by " + next + ": " +
                                      new Win32Exception(Marshal.GetLastWin32Error()).Message);
        }

        const int MoveReplaceExisting = 0x1;
        const int MoveWriteThrough = 0x8;

        [LibraryImport("kernel32.dll", EntryPoint = "MoveFileExW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool MoveFileEx(string existing, string replacement, int flags);
    }
}
