using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;
using System.Threading;

namespace Thornswood
{
    /// <summary>
    /// A Windows shortcut (.lnk), made through the shell's own ShellLink
    /// object, as the script's WScript.Shell CreateShortcut made it. Through
    /// generated COM interfaces (ComWrappers), which Native AOT compiles,
    /// rather than [ComImport], which it does not.
    /// </summary>
    static partial class InstallShortcut
    {
        static readonly Guid ShellLinkClass = new Guid("00021401-0000-0000-C000-000000000046");

        /// <summary>
        /// Writes a shortcut at <paramref name="lnk"/> to <paramref name="exe"/>,
        /// started in the exe's folder, with the exe's own icon and the
        /// description the script gave it. Null when it was made, else why not.
        /// Made on a thread of its own in a single threaded apartment, which
        /// the shell's objects want, whatever thread the install runs on.
        /// </summary>
        public static string Make(string lnk, string exe)
        {
            string why = null;
            var t = new Thread(() => why = MakeHere(lnk, exe));
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            t.Join();
            return why;
        }

        static string MakeHere(string lnk, string exe)
        {
            int hr = CoInitializeEx(IntPtr.Zero, CoinitApartmentThreaded);
            if (hr < 0) return "COM would not start on this thread (0x" + hr.ToString("x8") + ")";
            try
            {
                Guid clsid = ShellLinkClass, iid = typeof(IShellLinkW).GUID;
                hr = CoCreateInstance(in clsid, IntPtr.Zero, ClsctxInprocServer, in iid, out IntPtr unknown);
                if (hr < 0) return "Windows would not make a shortcut (0x" + hr.ToString("x8") + ")";
                try
                {
                    var cw = new StrategyBasedComWrappers();
                    object obj = cw.GetOrCreateObjectForComInstance(unknown, CreateObjectFlags.None);
                    var link = (IShellLinkW)obj;
                    link.SetPath(exe);
                    link.SetWorkingDirectory(System.IO.Path.GetDirectoryName(exe));
                    link.SetIconLocation(exe, 0);
                    link.SetDescription("ThornsWood");
                    ((IPersistFile)obj).Save(lnk, true);
                    return null;
                }
                catch (Exception e) when (e is COMException || e is UnauthorizedAccessException || e is System.IO.IOException) { return e.Message; }
                finally { Marshal.Release(unknown); }
            }
            finally { CoUninitialize(); }
        }

        const uint CoinitApartmentThreaded = 0x2, ClsctxInprocServer = 0x1;

        [LibraryImport("ole32.dll")]
        private static partial int CoInitializeEx(IntPtr reserved, uint init);

        [LibraryImport("ole32.dll")]
        private static partial void CoUninitialize();

        [LibraryImport("ole32.dll")]
        private static partial int CoCreateInstance(in Guid clsid, IntPtr outer, uint context, in Guid iid, out IntPtr obj);

        // IShellLinkW, every method in its vtable order. Only the setters are
        // used; the rest are declared so the order is right.
        [GeneratedComInterface(StringMarshalling = StringMarshalling.Utf16)]
        [Guid("000214F9-0000-0000-C000-000000000046")]
        internal partial interface IShellLinkW
        {
            void GetPath(IntPtr file, int max, IntPtr data, uint flags);
            void GetIDList(out IntPtr list);
            void SetIDList(IntPtr list);
            void GetDescription(IntPtr name, int max);
            void SetDescription(string name);
            void GetWorkingDirectory(IntPtr dir, int max);
            void SetWorkingDirectory(string dir);
            void GetArguments(IntPtr args, int max);
            void SetArguments(string args);
            void GetHotkey(out ushort key);
            void SetHotkey(ushort key);
            void GetShowCmd(out int cmd);
            void SetShowCmd(int cmd);
            void GetIconLocation(IntPtr path, int max, out int index);
            void SetIconLocation(string path, int index);
            void SetRelativePath(string path, uint reserved);
            void Resolve(IntPtr hwnd, uint flags);
            void SetPath(string file);
        }

        // IPersistFile, after IPersist's GetClassID.
        [GeneratedComInterface(StringMarshalling = StringMarshalling.Utf16)]
        [Guid("0000010B-0000-0000-C000-000000000046")]
        internal partial interface IPersistFile
        {
            void GetClassID(out Guid clsid);
            [PreserveSig] int IsDirty();
            void Load(string file, uint mode);
            void Save(string file, [MarshalAs(UnmanagedType.Bool)] bool remember);
            void SaveCompleted(string file);
            void GetCurFile(out IntPtr file);
        }
    }
}
