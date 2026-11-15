using System;
using System.ComponentModel;
using System.IO;
using System.Net.Http;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text.Json;

namespace Thornswood
{
    /// <summary>
    /// What a person reads when something the launcher tried fails (#4633).
    ///
    /// Every catch in launcher/app that shows, returns or passes on what went
    /// wrong comes here instead of reading the exception's Message. Windows'
    /// own sentence ("The process cannot access the file ... because it is
    /// being used by another process") says what happened in Windows' terms
    /// and nothing about what to do, so it is never what a person reads. It
    /// goes to launcher.log whole, with the stack, through Swallow.Note, and
    /// the person reads which file it was and the next step.
    ///
    /// The launcher's own sentences pass through as written: a plain
    /// Exception, or one of the launcher's own kinds (InstallStop,
    /// GeneratedStop), is only ever thrown by this code with words meant for
    /// a person. Windows and .NET never throw a bare Exception.
    ///
    /// Why is the reason alone, for a line that already says what to do
    /// next. Say is the reason and the next step. Both write the exception to
    /// launcher.log, so a caller never notes it a second time.
    /// launcher/tests/test-4633-plain-failures.ps1 holds every catch to this.
    /// </summary>
    static class Failure
    {
        enum Kind { Ours, InUse, Denied, Missing, Full, TooLong, Offline, NotStarted, Unreadable, Other }

        /// <summary>The reason and the next step, in full sentences. The exception goes to launcher.log.</summary>
        public static string Say(string where, Exception ex) { return Say(where, ex, null); }

        /// <param name="what">The file, folder or thing the caller was working on, when it knows it better than the exception does.</param>
        public static string Say(string where, Exception ex, string what)
        {
            Swallow.Note(where, ex);
            return Words(ex, what, true);
        }

        /// <summary>The reason alone, with no full stop, for a line that already says what to do next. The exception goes to launcher.log.</summary>
        public static string Why(string where, Exception ex) { return Why(where, ex, null); }

        public static string Why(string where, Exception ex, string what)
        {
            Swallow.Note(where, ex);
            return Words(ex, what, false).TrimEnd('.');
        }

        static string Words(Exception ex, string what, bool next)
        {
            ex = Inner(ex);
            if (ex == null) return next ? "It stopped without saying why. If it happens again, send your launcher log to the Discord." : "it stopped without saying why";
            Kind kind = KindOf(ex);
            if (kind == Kind.Ours) return next ? ex.Message.Trim() : ex.Message.Trim().TrimEnd('.');
            string name = Name(ex, what);
            switch (kind)
            {
                case Kind.InUse:
                    return name + " is open in another program, so Windows would not let the launcher change it" +
                        (next ? ". Close Skyrim, Vortex and anything else that has it open, then try again." : "");
                case Kind.Denied:
                    return "Windows refused the launcher access to " + name +
                        (next ? ". Check that it is not marked read-only and that your antivirus is not blocking Thornswood, then try again." : "");
                case Kind.Missing:
                    return name + " is not there" +
                        (next ? ". Press Fix on Diagnostics to put back what the launcher needs, then try again." : "");
                case Kind.Full:
                    return "the drive " + name + " is on is full" +
                        (next ? ". Free some space on it, then try again." : "");
                case Kind.TooLong:
                    return "the path to " + name + " is longer than Windows allows" +
                        (next ? ". Move the Thornswood folder somewhere with a shorter path, such as C:\\Thornswood, then try again." : "");
                case Kind.Offline:
                    return (what ?? "the server") + " could not be reached" +
                        (next ? ". Check your internet connection, then try again." : "");
                case Kind.NotStarted:
                    return "Windows could not start " + name +
                        (next ? ". Check that it is still installed, then try again." : "");
                case Kind.Unreadable:
                    return name + " could not be read, because what is in it is not what the launcher expects" +
                        (next ? ". Press Fix on Diagnostics to put it back, then try again." : "");
                default:
                    return "Windows stopped it while the launcher worked on " + name +
                        (next ? ". Try again, and if it happens again, send your launcher log to the Discord." : "");
            }
        }

        // The exception that says what really happened: not the wrapper a
        // task or a list of tasks puts round it.
        static Exception Inner(Exception ex)
        {
            while (ex != null && ex.InnerException != null &&
                   (ex is AggregateException || ex is System.Reflection.TargetInvocationException || ex is TypeInitializationException))
                ex = ex.InnerException;
            return ex;
        }

        // Windows' error numbers, as HRESULTs: they say the same thing on a
        // Windows in any language, where the message is translated.
        const int FileNotFound = unchecked((int)0x80070002), PathNotFound = unchecked((int)0x80070003),
                  AccessDenied = unchecked((int)0x80070005), SharingViolation = unchecked((int)0x80070020),
                  LockViolation = unchecked((int)0x80070021), HandleDiskFull = unchecked((int)0x80070027),
                  DiskFull = unchecked((int)0x80070070), BadNetPath = unchecked((int)0x80070035);

        static Kind KindOf(Exception ex)
        {
            Type t = ex.GetType();
            if (t == typeof(Exception) || t.Namespace == "Thornswood") return Kind.Ours;
            int h = ex.HResult;
            // A Win32Exception (Process.Start, Process.Kill) carries Windows'
            // own error number, not an HRESULT: the same numbers, unwrapped.
            var w32 = ex as Win32Exception;
            if (w32 != null) h = unchecked((int)0x80070000) | (w32.NativeErrorCode & 0xFFFF);
            if (h == SharingViolation || h == LockViolation) return Kind.InUse;
            if (ex is UnauthorizedAccessException || h == AccessDenied) return Kind.Denied;
            if (h == DiskFull || h == HandleDiskFull) return Kind.Full;
            if (ex is PathTooLongException) return Kind.TooLong;
            if (ex is FileNotFoundException || ex is DirectoryNotFoundException || ex is DriveNotFoundException ||
                h == FileNotFound || h == PathNotFound || h == BadNetPath) return Kind.Missing;
            if (ex is HttpRequestException || ex is SocketException || ex is WebSocketException ||
                ex is TimeoutException || ex is OperationCanceledException) return Kind.Offline;
            if (ex is Win32Exception) return Kind.NotStarted;
            if (ex is InvalidDataException || ex is FormatException || ex is JsonException || ex is EndOfStreamException) return Kind.Unreadable;
            return Kind.Other;
        }

        // Which file it was: what the caller says, else what the exception
        // carries. .NET puts the path of an I/O failure in single quotes in its
        // message; the path itself is the file's, never translated.
        static string Name(Exception ex, string what)
        {
            if (!string.IsNullOrEmpty(what)) return what;
            var fnf = ex as FileNotFoundException;
            if (fnf != null && !string.IsNullOrEmpty(fnf.FileName)) return fnf.FileName;
            string m = ex.Message ?? "";
            int open = m.IndexOf('\'');
            while (open >= 0)
            {
                int close = m.IndexOf('\'', open + 1);
                if (close < 0) break;
                string inside = m.Substring(open + 1, close - open - 1);
                if (inside.IndexOf('\\') >= 0 || inside.IndexOf('/') >= 0 || inside.IndexOf(':') >= 0) return inside;
                open = m.IndexOf('\'', close + 1);
            }
            return "a file the launcher needs";
        }
    }
}
