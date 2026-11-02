using System;
using System.Runtime.InteropServices;

namespace Thornswood
{
    /// <summary>
    /// The launcher's message boxes: Windows' own, through MessageBoxW, the
    /// same box WPF's MessageBox showed. Avalonia has no message box, and a
    /// window of our own would be async where every caller here waits for the
    /// answer before its next line. MessageBoxW also works before Avalonia has
    /// started, which the second copy check in Shell.Main and its "could not
    /// start" box need.
    /// </summary>
    static partial class Ask
    {
        public enum Icon : uint { None = 0, Error = 0x10, Question = 0x20, Warning = 0x30, Info = 0x40 }

        const uint MB_OK = 0x0, MB_OKCANCEL = 0x1, MB_YESNOCANCEL = 0x3, MB_YESNO = 0x4;
        const uint MB_DEFBUTTON2 = 0x100, MB_SETFOREGROUND = 0x10000, MB_TASKMODAL = 0x2000;
        const int IDOK = 1, IDCANCEL = 2, IDYES = 6, IDNO = 7;

        [LibraryImport("user32.dll", EntryPoint = "MessageBoxW", StringMarshalling = StringMarshalling.Utf16)]
        private static partial int MessageBoxW(IntPtr owner, string text, string caption, uint type);

        /// <summary>
        /// The window boxes belong to, set by Shell once the main window is up,
        /// so a box sits over the launcher and blocks it rather than hiding
        /// behind it. Zero before then.
        /// </summary>
        public static IntPtr Owner;

        static int Show(string text, string title, uint buttons, Icon icon)
        {
            uint type = buttons | (uint)icon | MB_SETFOREGROUND;
            if (Owner == IntPtr.Zero) type |= MB_TASKMODAL;
            return MessageBoxW(Owner, text ?? "", string.IsNullOrEmpty(title) ? "Thornswood" : title, type);
        }

        /// <summary>A box with OK.</summary>
        public static void Tell(string text, string title = "Thornswood", Icon icon = Icon.Info)
        {
            Show(text, title, MB_OK, icon);
        }

        /// <summary>Yes or No; true for Yes.</summary>
        public static bool YesNo(string text, string title = "Thornswood", Icon icon = Icon.Question, bool noIsDefault = false)
        {
            return Show(text, title, MB_YESNO | (noIsDefault ? MB_DEFBUTTON2 : 0), icon) == IDYES;
        }

        /// <summary>OK or Cancel; true for OK.</summary>
        public static bool OkCancel(string text, string title = "Thornswood", Icon icon = Icon.Question)
        {
            return Show(text, title, MB_OKCANCEL, icon) == IDOK;
        }

        /// <summary>Yes, No or Cancel: true, false, or null for Cancel.</summary>
        public static bool? YesNoCancel(string text, string title = "Thornswood", Icon icon = Icon.Question)
        {
            int r = Show(text, title, MB_YESNOCANCEL, icon);
            if (r == IDYES) return true;
            if (r == IDNO) return false;
            return null;
        }
    }
}
