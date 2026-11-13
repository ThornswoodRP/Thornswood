using System;
using System.IO;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// The only writer of launcher.log (#4630). The install's mutex excludes
    /// another launcher; this gate serializes every thread within this one.
    /// Append, rollover and age pruning share the gate, never a retry or a
    /// catch that discards a record. An I/O refusal reaches the caller.
    ///
    /// Each file is at most 4 MiB of UTF-8, with one older file, launcher.log.1.
    /// A record that fits stays whole. A larger record spans files in UTF-8
    /// chunks; the same two-file retention limit applies to it. On the first
    /// roll of an older, unbounded log, only its newest 4 MiB are retained.
    /// Kept here beside Swallow so every diagnostic-only harness compiles the
    /// same writer as the launcher, without a second implementation.
    /// </summary>
    static class LauncherLog
    {
        public const int MaxBytes = 4 * 1024 * 1024;
        static readonly object gate = new object();
        static readonly Encoding utf8 = new UTF8Encoding(false);

        public static string Older(string path) { return path + ".1"; }

        public static T Holding<T>(Func<T> work)
        {
            lock (gate) return work();
        }

        public static void Line(string message)
        {
            Text(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine);
        }

        public static void Text(string text)
        {
            lock (gate)
            {
                string path = Paths.LogFile;
                // Paths has not been initialized yet. No log exists to write.
                if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(text)) return;
                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                byte[] bytes = utf8.GetBytes(text);
                int at = 0;
                while (at < bytes.Length)
                {
                    int count = Math.Min(MaxBytes, bytes.Length - at);
                    // Never leave a UTF-8 code point straddling two files.
                    if (at + count < bytes.Length)
                        while ((bytes[at + count] & 0xc0) == 0x80) count--;
                    long length = File.Exists(path) ? new FileInfo(path).Length : 0;
                    if (length + count > MaxBytes && length > 0) Roll(path, length);
                    using (var file = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read | FileShare.Delete))
                        file.Write(bytes, at, count);
                    at += count;
                }
            }
        }

        static void Roll(string path, long length)
        {
            string older = Older(path);
            if (length <= MaxBytes)
            {
                File.Move(path, older, true);
                return;
            }
            // Migration from the former unbounded format. Keep its tail, not
            // the beginning, and start at a complete UTF-8 code point.
            using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
            {
                input.Position = length - MaxBytes;
                int first = input.ReadByte();
                while (first >= 0 && (first & 0xc0) == 0x80) first = input.ReadByte();
                using (var output = new FileStream(older, FileMode.Create, FileAccess.Write, FileShare.Read | FileShare.Delete))
                {
                    if (first >= 0) output.WriteByte((byte)first);
                    input.CopyTo(output);
                }
            }
            File.Delete(path);
        }
    }

    /// <summary>
    /// Diagnostic reasons and caught exceptions, without touching a control.
    /// All callers share LauncherLog's writer. A refused write is propagated,
    /// not mistaken for a recorded diagnostic (#4630).
    /// </summary>
    static class Swallow
    {
        public static void Note(string where, Exception e)
        {
            LauncherLog.Line("Swallowed in " + where + ": " +
                (e == null ? "no exception given" : e.ToString()));
        }

        public static void Say(string where, string why)
        {
            LauncherLog.Line("In " + where + ": " +
                (string.IsNullOrEmpty(why) ? "no reason given" : why));
        }
    }
}
