using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// Which microphone Windows is set to record from.
    ///
    /// Voice opens the microphone itself (VoiceAudio.cs, through OpenForVoice
    /// below): the one chosen in the launcher's settings, otherwise the one
    /// Windows holds for communications. Asking for nothing in particular, as
    /// the old browser voice did, got whatever Chromium calls the default,
    /// which on one machine was a pair of speakers with an input on them
    /// rather than the microphone actually selected.
    ///
    /// The launcher is the one voice client (#4667, decided 26 Oct as V3), so
    /// the name goes nowhere else. Until then it was written into the game's
    /// Thornswood.ini at every Play for the game's own browser voice, which
    /// never carried the audio once the launcher had it.
    ///
    /// Read through the MMDevice COM API, which is the documented way to ask,
    /// declared in VoiceCom.cs as source-generated COM so that it works in
    /// the native build.
    /// The registry holds the same information, but which endpoint currently
    /// holds a role is recorded in undocumented binary values that have moved
    /// between Windows versions, and guessing at those would trade a hundred
    /// lines of interop for a thing that silently breaks on somebody else's
    /// machine.
    /// </summary>
    static class Mics
    {
        // eCapture, and the communications role first: that is the one Windows
        // means by "the microphone apps should use for voice", and it is set
        // separately from the console default in the same dialog.
        const int eCapture = VoiceCom.eCapture;
        const int eConsole = VoiceCom.eConsole;
        const int eCommunications = VoiceCom.eCommunications;
        const int DEVICE_STATE_ACTIVE = VoiceCom.DEVICE_STATE_ACTIVE;

        /// <summary>
        /// The friendly name of the default recording device, or "" if it
        /// cannot be read. Never throws.
        /// </summary>
        public static string Default()
        {
            string s = "";
            try { s = Endpoint(eCommunications); } catch (Exception ex) { Swallow.Note("Mics.Default, communications endpoint", ex); }
            if (s.Length == 0) { try { s = Endpoint(eConsole); } catch (Exception ex) { Swallow.Note("Mics.Default, console endpoint", ex); } }
            return s;
        }

        /// <summary>Every active recording device, for the log and for a picker.</summary>
        public static List<string> All()
        {
            var outp = new List<string>();
            bool com = VoiceCom.Enter();
            VoiceCom.IMMDeviceEnumerator en = null;
            VoiceCom.IMMDeviceCollection col = null;
            try
            {
                int hr;
                en = VoiceCom.Enumerator(out hr);
                if (en == null) return outp;
                if (en.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, out col) != 0 || col == null)
                    return outp;

                int count;
                if (col.GetCount(out count) != 0) return outp;
                for (int i = 0; i < count; i++)
                {
                    VoiceCom.IMMDevice dev = null;
                    try
                    {
                        if (col.Item(i, out dev) != 0 || dev == null) continue;
                        string n = VoiceCom.NameOf(dev);
                        if (n.Length > 0) outp.Add(n);
                    }
                    catch (Exception ex) { Swallow.Note("Mics.All, reading one device", ex); }
                    finally { VoiceCom.Release(dev); }
                }
            }
            catch (Exception ex) { Swallow.Note("Mics.All, enumerating devices", ex); }
            finally { VoiceCom.Release(col); VoiceCom.Release(en); VoiceCom.Leave(com); }
            return outp;
        }

        /// <summary>
        /// The recording device voice opens: the one chosen in the launcher's
        /// settings when a device by that name is plugged in, otherwise the
        /// one Windows holds for communications, otherwise its console
        /// default. The same order Apply names for the log.
        ///
        /// The voice page could not do this. It asked the browser for a
        /// microphone and got whatever Chromium calls the default, which is
        /// the device this class was written to get away from. Voice opens
        /// the device itself now (VoiceAudio.cs), so it takes it from here.
        ///
        /// The caller owns the device and COM on its thread; null when there
        /// is no recording device at all, with the reason in why.
        /// </summary>
        public static VoiceCom.IMMDevice OpenForVoice(VoiceCom.IMMDeviceEnumerator en, Config cfg, out string name, out string why)
        {
            name = "";
            why = "";
            string want = cfg == null ? "" : (cfg.MicrophoneName ?? "").Trim();
            if (want.Length > 0)
            {
                VoiceCom.IMMDeviceCollection col = null;
                try
                {
                    int count;
                    if (en.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, out col) == 0 && col != null &&
                        col.GetCount(out count) == 0)
                    {
                        for (int i = 0; i < count; i++)
                        {
                            VoiceCom.IMMDevice dev;
                            if (col.Item(i, out dev) != 0 || dev == null) continue;
                            string n = VoiceCom.NameOf(dev);
                            if (string.Equals(n, want, StringComparison.OrdinalIgnoreCase)) { name = n; return dev; }
                            VoiceCom.Release(dev);
                        }
                    }
                }
                finally { VoiceCom.Release(col); }
                why = "the chosen microphone '" + want + "' is not plugged in, so the Windows default is used. ";
            }

            foreach (int role in new int[] { eCommunications, eConsole })
            {
                VoiceCom.IMMDevice dev;
                int hr = en.GetDefaultAudioEndpoint(eCapture, role, out dev);
                if (hr == 0 && dev != null) { name = VoiceCom.NameOf(dev); return dev; }
                if (role == eConsole) why += "Windows has no recording device (0x" + hr.ToString("X8") + ")";
            }
            return null;
        }

        /// <summary>
        /// Put where voice lives into this machine's ini, for the game's
        /// overlay, and name the microphone voice will ask for.
        ///
        /// The overlay opens its own socket to the voice service for where
        /// everybody is, which the speaking marks and the party strip are drawn
        /// from, and has no other way to be told the address. The microphone's
        /// name is not written: the launcher opens the microphone, and the
        /// line the game's browser voice read (MicrophoneName) is taken out of
        /// an ini an older launcher left it in (#4667).
        ///
        /// Returns the microphone's name for the log, or "" when Windows names
        /// none.
        /// </summary>
        public static string Apply(Config cfg)
        {
            string want = cfg == null ? "" : (cfg.MicrophoneName ?? "").Trim();
            if (want.Length == 0) want = Default();
            // The voice server's port. The dev build's launcher talks to the
            // dev voice server, and the plugin in the shared game folder has
            // to be told which one every launch, or a dev session would put
            // its positions on the main server.
            string port = cfg == null ? "" : (cfg.VoicePort ?? "").Trim();
            // And where voice lives. VoiceBase, not the raw setting, so the
            // game always gets the https address the launcher uses (#1304).
            string vurl = cfg == null ? "" : cfg.VoiceBase();
            string vsocket = cfg == null ? "" : cfg.VoiceSocket();

            string ini = Path.Combine(Paths.Game, "Data\\SKSE\\Plugins\\Thornswood.ini");
            if (!File.Exists(ini)) return want;

            try
            {
                var lines = new List<string>(File.ReadAllLines(ini));
                bool vurlDone = false;
                bool vsocketDone = false;
                for (int i = lines.Count - 1; i >= 0; i--)
                {
                    string t = lines[i].TrimStart();
                    int eq = t.IndexOf('=');
                    if (eq < 0) continue;
                    string key = t.Substring(0, eq).Trim();
                    if (key.Equals("MicrophoneName", StringComparison.OrdinalIgnoreCase))
                    {
                        lines.RemoveAt(i);
                    }
                    else if (port.Length > 0 && t.StartsWith("VoicePort", StringComparison.OrdinalIgnoreCase))
                    {
                        lines[i] = "VoicePort = " + port;
                    }
                    else if (t.StartsWith("VoiceUrl", StringComparison.OrdinalIgnoreCase))
                    {
                        // Written even when empty, so clearing it here clears
                        // it in the game too rather than leaving a stale one.
                        lines[i] = "VoiceUrl = " + vurl;
                        vurlDone = true;
                    }
                    else if (key.Equals("VoiceSocketUrl", StringComparison.OrdinalIgnoreCase))
                    {
                        // Rewrite on every Play, including a switch back to Main.
                        lines[i] = "VoiceSocketUrl = " + vsocket;
                        vsocketDone = true;
                    }
                }
                // The shipped template has never carried VoiceUrl, so on every
                // machine there is no line to rewrite and it has to be added or the
                // game would never learn about Caddy at all.
                if (!vurlDone && vurl.Length > 0) { lines.Add("VoiceUrl = " + vurl); }
                if (!vsocketDone && vsocket.Length > 0) { lines.Add("VoiceSocketUrl = " + vsocket); }

                File.WriteAllLines(ini, lines.ToArray(), new UTF8Encoding(false));
            }
            catch (Exception ex) { Swallow.Note("Mics.Apply, Thornswood.ini", ex); }
            return want;
        }

        // ------------------------------------------------------------- interop
        // The interfaces themselves are in VoiceCom.cs, shared with voice,
        // which opens the device this class names.

        static string Endpoint(int role)
        {
            bool com = VoiceCom.Enter();
            VoiceCom.IMMDeviceEnumerator en = null;
            VoiceCom.IMMDevice dev = null;
            try
            {
                int hr;
                en = VoiceCom.Enumerator(out hr);
                if (en == null) return "";
                if (en.GetDefaultAudioEndpoint(eCapture, role, out dev) != 0 || dev == null)
                    return "";
                return VoiceCom.NameOf(dev);
            }
            finally { VoiceCom.Release(dev); VoiceCom.Release(en); VoiceCom.Leave(com); }
        }
    }
}
