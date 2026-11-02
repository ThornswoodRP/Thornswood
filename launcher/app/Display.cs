using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace Thornswood
{
    /// <summary>
    /// Reads and writes the handful of SSE Display Tweaks settings worth having
    /// in a launcher. Several ship commented out with a '#', so setting one has
    /// to uncomment the existing line rather than append a duplicate the game
    /// would ignore.
    /// </summary>
    static partial class Display
    {
        public static string IniPath
        {
            get { return Path.Combine(Paths.Game, "Data\\SKSE\\Plugins\\SSEDisplayTweaks.ini"); }
        }

        public static bool Available { get { return File.Exists(IniPath); } }

        public static string Get(string key)
        {
            try
            {
                if (!Available) return null;
                var rx = new Regex("^\\s*" + Regex.Escape(key) + "\\s*=\\s*(.*?)\\s*$", RegexOptions.IgnoreCase);
                foreach (string line in File.ReadAllLines(IniPath))
                {
                    string t = line.TrimStart();
                    if (t.StartsWith("#") || t.StartsWith(";")) continue;   // commented out means "game default"
                    Match m = rx.Match(line);
                    if (m.Success) return m.Groups[1].Value;
                }
            }
            catch (Exception ex) { Swallow.Note("Display.Get, reading " + IniPath, ex); }
            return null;
        }

        public static bool GetBool(string key, bool fallback)
        {
            string v = Get(key);
            if (v == null) return fallback;
            return v.Trim().Equals("true", StringComparison.OrdinalIgnoreCase) || v.Trim() == "1";
        }

        public static int GetInt(string key, int fallback)
        {
            int n;
            string v = Get(key);
            if (v != null && int.TryParse(v.Trim(), out n)) return n;
            return fallback;
        }

        public static bool Set(string key, string value)
        {
            try
            {
                if (!Available) return false;
                var lines = new List<string>(File.ReadAllLines(IniPath));
                var live = new Regex("^(\\s*)" + Regex.Escape(key) + "\\s*=", RegexOptions.IgnoreCase);
                var dead = new Regex("^(\\s*)[#;]\\s*" + Regex.Escape(key) + "\\s*=", RegexOptions.IgnoreCase);

                for (int i = 0; i < lines.Count; i++)
                {
                    if (live.IsMatch(lines[i])) { lines[i] = key + "=" + value; WriteBack(lines); return true; }
                }
                for (int i = 0; i < lines.Count; i++)
                {
                    if (dead.IsMatch(lines[i])) { lines[i] = key + "=" + value; WriteBack(lines); return true; }
                }

                // Not mentioned at all, so add it under [Render].
                int render = lines.FindIndex(l => l.Trim().Equals("[Render]", StringComparison.OrdinalIgnoreCase));
                if (render >= 0) lines.Insert(render + 1, key + "=" + value);
                else lines.Add(key + "=" + value);
                WriteBack(lines);
                return true;
            }
            catch { return false; }
        }

        static void WriteBack(List<string> lines)
        {
            File.WriteAllLines(IniPath, lines.ToArray());
        }

        // ---- the three display modes, expressed as the two flags the mod uses
        public static string Mode
        {
            get
            {
                if (GetBool("Fullscreen", false)) return "Fullscreen";
                if (GetBool("Borderless", true)) return "Borderless";
                return "Windowed";
            }
        }

        public static void SetMode(string mode)
        {
            if (mode == "Fullscreen") { Set("Fullscreen", "true"); Set("Borderless", "false"); }
            else if (mode == "Windowed") { Set("Fullscreen", "false"); Set("Borderless", "false"); }
            else { Set("Fullscreen", "false"); Set("Borderless", "true"); }
        }

        /// <summary>
        /// Skyrim's own ini decides how big a window it asks for, and Display
        /// Tweaks decides what it actually gets. Leave the two disagreeing and
        /// you get the thing that looks like a broken install: a game window
        /// that does not reach the bottom of the screen, with the desktop
        /// showing underneath.
        ///
        /// Returns what it changed it to, or null when it was already right or
        /// could not be read.
        /// </summary>
        public static string MatchScreen()
        {
            ScreenMode m = Detect();
            if (m == null) return null;
            string want = m.ToString();

            bool moved = false;
            if (Available && !string.Equals(Get("Resolution"), want, StringComparison.OrdinalIgnoreCase))
                moved = Set("Resolution", want) || moved;

            if (SetPrefsSize(m.Width, m.Height)) moved = true;
            return moved ? want : null;
        }

        static string PrefsPath { get { return Path.Combine(Paths.LiveMyGames, "SkyrimPrefs.ini"); } }

        /// <summary>
        /// iSize W and iSize H, written in place. The space in "iSize W" is
        /// Bethesda's, not a typo, and a key written without it is ignored.
        /// </summary>
        static bool SetPrefsSize(int w, int h)
        {
            try
            {
                string file = PrefsPath;
                if (!File.Exists(file)) return false;
                var lines = new List<string>(File.ReadAllLines(file));
                bool changed = false;
                var want = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                want["iSize W"] = w.ToString();
                want["iSize H"] = h.ToString();

                for (int i = 0; i < lines.Count; i++)
                {
                    string t = lines[i].TrimStart();
                    if (t.StartsWith(";") || t.StartsWith("#")) continue;
                    int eq = lines[i].IndexOf('=');
                    if (eq <= 0) continue;
                    string key = lines[i].Substring(0, eq).Trim();
                    string val;
                    if (!want.TryGetValue(key, out val)) continue;
                    if (lines[i].Substring(eq + 1).Trim() == val) continue;
                    lines[i] = key + "=" + val;
                    changed = true;
                }
                if (changed) File.WriteAllLines(file, lines.ToArray());
                return changed;
            }
            catch { return false; }
        }

        // ---- what the screen is actually set to -------------------------------
        //
        // Not SystemParameters, and not Screen.Bounds. Both of those report the
        // size in device independent units, so a 3440x1440 monitor running at
        // 150% comes back as 2293x960 and the game gets told to run at a
        // resolution the screen does not have. EnumDisplaySettings asks the
        // display driver what mode it is in and answers in real pixels, whatever
        // the scaling is set to.
        //
        // The wide version, with the two names as fixed buffers, so the
        // structure is plain memory the call can be handed as it is, with no
        // marshalling code to make at run time (#4823). The answer is the same
        // mode either way.

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        unsafe struct DEVMODE
        {
            public fixed char dmDeviceName[32];
            public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
            public int dmFields;
            public short dmOrientation, dmPaperSize, dmPaperLength, dmPaperWidth,
                         dmScale, dmCopies, dmDefaultSource, dmPrintQuality;
            public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
            public fixed char dmFormName[32];
            public short dmLogPixels;
            public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
            public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType,
                       dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
        }

        [LibraryImport("user32.dll", EntryPoint = "EnumDisplaySettingsW", StringMarshalling = StringMarshalling.Utf16)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

        const int ENUM_CURRENT_SETTINGS = -1;

        public class ScreenMode
        {
            public int Width, Height, Hz;
            public override string ToString() { return Width + "x" + Height; }
        }

        /// <summary>The primary display's current mode, or null if it cannot be read.</summary>
        public static ScreenMode Detect()
        {
            try
            {
                var dm = new DEVMODE();
                dm.dmSize = (short)Marshal.SizeOf<DEVMODE>();
                if (!EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref dm)) return null;

                // Anything outside this is a driver answering nonsense, and a
                // nonsense resolution in the ini is worse than none at all.
                if (dm.dmPelsWidth < 800 || dm.dmPelsHeight < 600) return null;
                if (dm.dmPelsWidth > 16384 || dm.dmPelsHeight > 16384) return null;

                return new ScreenMode {
                    Width = dm.dmPelsWidth,
                    Height = dm.dmPelsHeight,
                    Hz = dm.dmDisplayFrequency
                };
            }
            catch { return null; }
        }
    }
}
