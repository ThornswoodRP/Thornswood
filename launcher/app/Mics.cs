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
    /// below). The game's browser can still open one, and asking it for
    /// nothing in particular gets whatever Chromium calls the default.
    /// That is not the same as the one in Windows' own sound settings: on this
    /// machine it took a pair of speakers with an input on them over the
    /// microphone that was actually selected.
    ///
    /// The browser has no way to ask for "whatever Windows would use", so it
    /// has to be told a name. The name cannot be a setting that ships with the
    /// build, because a build goes to everybody and everybody owns a different
    /// microphone. So the launcher reads it off this machine at launch and
    /// writes it into that machine's own ini, which makes it right for each
    /// person without anybody being asked anything.
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
        /// default. The same order Apply writes into the ini, so the game and
        /// voice name the same microphone.
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
        /// Put this machine's microphone name into this machine's ini.
        ///
        /// An explicit choice in the launcher's own settings wins, because a
        /// person who went looking for this meant it. That choice lives in the
        /// launcher's config rather than in the ini, on purpose: the ini is a
        /// mod file, so it is replaced wholesale by an update, and anything
        /// somebody set in it by hand is gone the next time the build changes.
        ///
        /// Returns the name written, or "" when nothing was.
        /// </summary>
        public static string Apply(Config cfg)
        {
            string want = cfg == null ? "" : (cfg.MicrophoneName ?? "").Trim();
            if (want.Length == 0) want = Default();
            // The voice server's port travels the same way. The dev build's
            // launcher talks to the dev voice server, and the plugin in the
            // shared game folder has to be told which one every launch, or a
            // dev session would put its positions on the main server.
            string port = cfg == null ? "" : (cfg.VoicePort ?? "").Trim();
            // And where voice lives. The game overlay opens its own socket and
            // has no other way to be told. VoiceBase, not the raw setting, so
            // the game always gets the https address the launcher uses (#1304).
            string vurl = cfg == null ? "" : cfg.VoiceBase();
            if (want.Length == 0 && port.Length == 0 && vurl.Length == 0) return "";

            string ini = Path.Combine(Paths.Game, "Data\\SKSE\\Plugins\\Thornswood.ini");
            if (!File.Exists(ini)) return "";

            try
            {
                var lines = new List<string>(File.ReadAllLines(ini));
                bool done = false;
                bool vurlDone = false;
                for (int i = 0; i < lines.Count; i++)
                {
                    string t = lines[i].TrimStart();
                    int eq = t.IndexOf('=');
                    if (eq < 0) continue;
                    if (want.Length > 0 && t.StartsWith("MicrophoneName", StringComparison.OrdinalIgnoreCase))
                    {
                        lines[i] = "MicrophoneName = " + want;
                        done = true;
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
                }
                // No line to rewrite, so one is added rather than the name being
                // dropped. The shipped template has never carried this key, so
                // on every machine the name was read off Windows at Play and
                // then written nowhere: the voice plugin found no
                // MicrophoneName, passed an empty name to the page, and the page
                // opened whatever Chromium calls the default, which is the
                // device this class exists to get away from. It goes under
                // [Voice] with the rest of the voice settings, or at the end of
                // the file when there is no such section.
                if (want.Length > 0 && !done)
                {
                    int at = -1;
                    for (int i = 0; i < lines.Count; i++)
                    {
                        if (!lines[i].Trim().Equals("[Voice]", StringComparison.OrdinalIgnoreCase)) continue;
                        at = i + 1;
                        break;
                    }
                    if (at < 0) lines.Add("MicrophoneName = " + want);
                    else lines.Insert(at, "MicrophoneName = " + want);
                    done = true;
                }
                // The shipped template has never carried VoiceUrl, so on every
                // machine there is no line to rewrite and it has to be added or the
                // game would never learn about Caddy at all.
                if (!vurlDone && vurl.Length > 0) { lines.Add("VoiceUrl = " + vurl); }

                File.WriteAllLines(ini, lines.ToArray(), new UTF8Encoding(false));
                return done ? want : "";
            }
            catch { return ""; }
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
