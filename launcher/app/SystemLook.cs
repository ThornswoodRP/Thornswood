using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Thornswood
{
    /// <summary>
    /// What Windows asks of how a window looks (#4409): whether a contrast
    /// theme is on, the colours that theme draws in, and the text size set in
    /// Settings, Accessibility, Text size. Avalonia applies neither by itself.
    /// The display scale it does apply; the text size is a setting of its
    /// own that only Windows' own UI frameworks read.
    ///
    /// The install window (InstallWindow.cs) takes one when it is made: with
    /// a contrast theme on it draws in Themes.Contrast, made of these colours,
    /// in place of Forge, and every text size in it is its size at 100 times
    /// TextScale. A test hands it a planted one instead, which is how
    /// launcher\tests\test-4409-setup-look.ps1 runs it without Windows.
    /// </summary>
    sealed partial class SystemLook
    {
        /// <summary>A Windows contrast theme is on.</summary>
        public bool HighContrast;

        /// <summary>Windows' text size, 1 for 100%, up to LargestText.</summary>
        public double TextScale = 1.0;

        /// <summary>
        /// The colours Windows draws in, by the names in Themes.SystemNames,
        /// as #RRGGBB. Read whether or not a contrast theme is on; only a
        /// contrast theme puts them on screen.
        /// </summary>
        public Dictionary<string, string> Colours = new Dictionary<string, string>();

        /// <summary>The far end of Windows' Text size slider, 225%.</summary>
        public const double LargestText = 2.25;

        const uint SPI_GETHIGHCONTRAST = 0x0042;
        const uint HCF_HIGHCONTRASTON = 0x00000001;

        [StructLayout(LayoutKind.Sequential)]
        struct HighContrastInfo
        {
            public uint Size;
            public uint Flags;
            public IntPtr DefaultScheme;
        }

        [LibraryImport("user32.dll", EntryPoint = "SystemParametersInfoW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool SystemParametersInfoW(uint action, uint param, ref HighContrastInfo info, uint winIni);

        [LibraryImport("user32.dll", EntryPoint = "GetSysColor")]
        private static partial uint GetSysColor(int index);

        // GetSysColor's number for each name in Themes.SystemNames, in the
        // same order: COLOR_WINDOW, COLOR_WINDOWTEXT, COLOR_HIGHLIGHT,
        // COLOR_HIGHLIGHTTEXT, COLOR_BTNFACE, COLOR_BTNTEXT, COLOR_GRAYTEXT
        // and COLOR_HOTLIGHT.
        static readonly int[] Indexes = { 5, 8, 13, 14, 15, 18, 17, 26 };

        /// <summary>
        /// This PC's: the contrast theme from SystemParametersInfo, its
        /// colours from GetSysColor, and the text size from the value Windows
        /// keeps it in, HKCU\Software\Microsoft\Accessibility, TextScaleFactor
        /// (a percentage; absent at 100%). Anywhere but Windows, no contrast
        /// theme and 100%.
        /// </summary>
        public static SystemLook Read()
        {
            var look = new SystemLook();
            if (!OperatingSystem.IsWindows()) return look;

            var hc = new HighContrastInfo { Size = (uint)Marshal.SizeOf<HighContrastInfo>() };
            if (SystemParametersInfoW(SPI_GETHIGHCONTRAST, hc.Size, ref hc, 0))
                look.HighContrast = (hc.Flags & HCF_HIGHCONTRASTON) != 0;

            for (int i = 0; i < Themes.SystemNames.Length; i++)
                look.Colours[Themes.SystemNames[i]] = Hex(GetSysColor(Indexes[i]));

            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Accessibility"))
                look.TextScale = Scale(k == null ? null : k.GetValue("TextScaleFactor"));
            return look;
        }

        /// <summary>
        /// TextScaleFactor as a multiplier: 100 to 225 becomes 1 to 2.25.
        /// Anything else, or nothing, is 100%, because Windows itself draws
        /// nothing at another value.
        /// </summary>
        public static double Scale(object percent)
        {
            if (!(percent is int p) || p < 100 || p > 225) return 1.0;
            return p / 100.0;
        }

        /// <summary>A COLORREF, 0x00BBGGRR, as #RRGGBB.</summary>
        public static string Hex(uint colorref)
        {
            return "#" + (colorref & 0xFF).ToString("X2", CultureInfo.InvariantCulture)
                       + ((colorref >> 8) & 0xFF).ToString("X2", CultureInfo.InvariantCulture)
                       + ((colorref >> 16) & 0xFF).ToString("X2", CultureInfo.InvariantCulture);
        }
    }
}
