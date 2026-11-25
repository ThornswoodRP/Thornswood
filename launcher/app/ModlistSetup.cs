// ModlistSetup.cs
//
// The modlist install from start to end (#6244): every archive the
// collection's modlist names, got from wherever it can be got, then Mod
// Organizer 2 and every mod put in, each file held to the modlist's hash.
//
// THE ORDER, each step only for what the ones before left missing:
//   1. 7-Zip, pinned, from its GitHub release (SevenZip.Ensure);
//   2. what the modlist downloads by address, which is Mod Organizer 2, from
//      its GitHub release (ModlistFetch.ByAddress);
//   3. Nexus files already on this PC, in Vortex's downloads or the person's
//      own Downloads (ModlistFetch.FromPlaces);
//   4. for a Nexus Premium account signed in here, the rest from Nexus's API
//      (Nexus.Download);
//   5. for any other account, the rest by hand: each file's page on Nexus
//      opens in turn and the file is taken from Downloads as it lands
//      (ModlistFetch.ByHand);
//   6. the install itself into the Mod Organizer 2 instance
//      (ModlistInstall.Install), and then the record of what goes into the
//      game folder (Deployment), which OwnGame reads in place of Vortex's.
//      A mod's settings file the person changed since the last whole install
//      is kept as they left it (Wrote, ModlistInstall.Changed).
// A run stopped part way keeps what it got: the archives in downloads and
// the files already written, each still the modlist's, so the next run goes
// on from there.
//
// WHERE: the instance is <Root>\Mods, its downloads <Root>\Mods\downloads,
// and 7-Zip <Root>\Mods\tools\7zip-25.01, all the caller's to name. The
// modlist is the one the Release's signed record names (VeloRecord.Modlist).
// The game is not touched here: OwnGame still builds <Root>\Game, and the
// game never runs inside Mod Organizer 2.
//
// tests\test-6244-nexus.ps1 runs it whole against stand-ins for GitHub and
// Nexus.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Thornswood
{
    static class ModlistSetup
    {
        /// <summary>What a run tells the person and asks of them.</summary>
        public sealed class Steps
        {
            /// <summary>A line for the person, as each step goes.</summary>
            public Action<string> Say;
            /// <summary>Opens a page in the person's browser.</summary>
            public Action<string> Open;
            /// <summary>True once the person has stopped the run.</summary>
            public Func<bool> Stop = () => false;
            /// <summary>Bytes arrived of the download going now.</summary>
            /// <summary>Where this PC may already hold archives. ModlistFetch.Places unless a harness says otherwise.</summary>
            public Func<IList<ModlistFetch.Place>> Places = () => ModlistFetch.Places();
            /// <summary>Where a download by hand lands. The person's Downloads unless a harness says otherwise.</summary>
            public Func<string> HandFolder = ModlistFetch.MyDownloads;
            /// <summary>How often a download by hand is looked for.</summary>
            public int EveryMs = 1000;
        }

        /// <summary>
        /// Installs the modlist in <paramref name="modlist"/> into the Mod
        /// Organizer 2 instance <paramref name="mods"/>, downloading what is
        /// missing into its downloads folder, with 7-Zip in
        /// <paramref name="tools"/>. Returns how many files it wrote. Throws
        /// ModlistStop with the reason, keeping what it got.
        /// </summary>
        public static int Run(string modlist, string mods, string tools, string game, Steps s)
        {
            Action<string> say = s.Say ?? (_ => { });
            CollectionModlist m = CollectionModlist.Read(modlist);
            string downloads = Path.Combine(mods, "downloads");
            string sevenZip = SevenZip.Ensure(tools, say);

            List<ModlistArchive> missing = ModlistInstall.Missing(m, downloads);
            say(missing.Count == 0 ? "Every archive of the modlist is here" : missing.Count + " of the modlist's " + m.Archives.Count + " archives to get");
            foreach (ModlistArchive a in missing.Where(a => a.Kind == "http"))
            {
                say("Downloading " + a.Say());
                ModlistFetch.ByAddress(a, downloads, null);
            }

            List<ModlistArchive> nexus = missing.Where(a => a.Kind == "nexus").ToList();
            if (nexus.Count > 0) nexus = ModlistFetch.FromPlaces(nexus, s.Places(), downloads, say);
            Nexus.Account who = nexus.Count > 0 ? Nexus.Who : null;
            if (who != null && who.Premium)
            {
                foreach (ModlistArchive a in nexus)
                {
                    if (s.Stop()) throw new ModlistStop("The install was stopped. What it got is kept; press Install again to go on.");
                    say("Downloading " + a.Say() + " from Nexus");
                    Nexus.Download(a, downloads, null);
                }
                nexus.Clear();
            }
            if (nexus.Count > 0)
            {
                if (s.Open == null) throw new ModlistStop(nexus.Count + " of the modlist's Nexus files are not on this PC, and nothing here can open Nexus for them.");
                nexus = ModlistFetch.ByHand(nexus, s.HandFolder(), downloads, s.Open, say, s.Stop, s.EveryMs);
            }
            if (nexus.Count > 0)
                throw new ModlistStop(nexus.Count + " of the modlist's Nexus files are not downloaded yet (" + string.Join(", ", nexus.Select(a => a.Say())) + "). What is here is kept; press Install again to go on.");

            // The record of what goes into the game folder comes off before a
            // file of a changed modlist is written, so a folder made while the
            // install is part way never takes a mix of two revisions, and goes
            // back once every file is in. It is set aside rather than deleted
            // (LastRecordName): it is also what the last whole install wrote,
            // which says which settings files the person has changed since
            // (Wrote), a run cut short and pressed again included.
            List<string> record = Deployment(m, Sha256Of(modlist));
            string recordFile = Path.Combine(mods, OwnGame.ModsRecordName);
            string lastFile = Path.Combine(mods, LastRecordName);
            bool same = File.Exists(recordFile) && File.ReadAllLines(recordFile).SequenceEqual(record);
            if (!same && File.Exists(recordFile)) File.Move(recordFile, lastFile, true);
            Dictionary<string, ulong> wrote = Wrote(File.Exists(recordFile) ? recordFile : lastFile);

            say("Putting in Mod Organizer 2 and the mods");
            int written = ModlistInstall.Install(m, downloads, mods, game, SevenZip.With(sevenZip), say, wrote);
            if (!same)
            {
                string part = recordFile + ".part";
                File.WriteAllLines(part, record, new UTF8Encoding(false));
                File.Move(part, recordFile, true);
            }
            if (File.Exists(lastFile)) File.Delete(lastFile);
            return written;
        }

        /// <summary>
        /// The record of the last whole install while a changed modlist goes
        /// in, beside the instance's record. OwnGame never reads it.
        /// </summary>
        public const string LastRecordName = "thornswood-deployment-last.txt";

        /// <summary>
        /// Each file a record lists, by its path in the instance
        /// (mods\&lt;mod&gt;\&lt;path&gt;), to the xxHash64 the install that
        /// wrote the record left there. Empty when there is no record. A line
        /// that cannot be read gives nothing, so that file takes the
        /// modlist's copy.
        /// </summary>
        static Dictionary<string, ulong> Wrote(string file)
        {
            var wrote = new Dictionary<string, ulong>(StringComparer.OrdinalIgnoreCase);
            if (!File.Exists(file)) return wrote;
            foreach (string[] p in File.ReadLines(file).Skip(1).Select(line => line.Split('|')))
            {
                ulong h;
                if (p.Length == 5 && ulong.TryParse(p[3], System.Globalization.NumberStyles.AllowHexSpecifier, System.Globalization.CultureInfo.InvariantCulture, out h))
                    wrote["mods\\" + p[1] + "\\" + p[2]] = h;
            }
            return wrote;
        }

        /// <summary>The profile the modlist's instance has on, whose modlist.txt gives the mods' order.</summary>
        public const string Profile = "Thornswood";

        /// <summary>
        /// What goes into Thornswood's game folder from the modlist's mods,
        /// one line a file: the path in the game folder, the mod, the path in
        /// the mod's folder, its xxHash64 and its size, joined with |, after a
        /// line naming the modlist by its sha256 and the collection revision
        /// it is, which OwnGame.ModsRevision reads. Written into the instance as
        /// OwnGame.ModsRecordName once an install is whole, and read by
        /// OwnGame in place of Vortex's deployment record (#6244).
        ///
        /// A mod's files go under Data, except its Root folder, which goes
        /// beside the game (the script extender's loader). Only the mods the
        /// profile's modlist.txt switches on (+) count, its meta.ini never,
        /// and where two mods have a file at one path the one higher in
        /// modlist.txt has it, which is how Mod Organizer 2 orders them.
        /// </summary>
        public static List<string> Deployment(CollectionModlist m, string sha256)
        {
            string orderAt = "profiles\\" + Profile + "\\modlist.txt";
            ModlistFile order = m.Files.FirstOrDefault(f => f.Kind == "InlineFile" && string.Equals(f.To, orderAt, StringComparison.OrdinalIgnoreCase));
            if (order == null) throw new ModlistStop("The modlist has no " + orderAt + ", so the order of its mods is not known and nothing was installed.");
            var rank = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (string l in new UTF8Encoding(false).GetString(m.Data(order.DataId)).Split('\n').Select(line => line.Trim('\r', ' ', '\uFEFF')))
                if (l.Length > 1 && l[0] == '+' && !rank.ContainsKey(l.Substring(1))) rank[l.Substring(1)] = rank.Count;
            var won = new Dictionary<string, KeyValuePair<int, string>>(StringComparer.OrdinalIgnoreCase);
            foreach (ModlistFile f in m.Files)
            {
                string[] p = f.To.Split('\\');
                if (p.Length < 3 || !string.Equals(p[0], "mods", StringComparison.OrdinalIgnoreCase)) continue;
                int r;
                if (!rank.TryGetValue(p[1], out r)) continue;
                string under = string.Join("\\", p, 2, p.Length - 2);
                if (p.Length == 3 && string.Equals(under, "meta.ini", StringComparison.OrdinalIgnoreCase)) continue;
                string rel = p.Length > 3 && string.Equals(p[2], "Root", StringComparison.OrdinalIgnoreCase) ? string.Join("\\", p, 3, p.Length - 3) : "Data\\" + under;
                KeyValuePair<int, string> had;
                if (won.TryGetValue(rel, out had) && had.Key <= r) continue;
                won[rel] = new KeyValuePair<int, string>(r, rel + "|" + p[1] + "|" + under + "|" + f.Hash.ToString("x16") + "|" + f.Size);
            }
            var lines = new List<string> { "modlist=" + sha256 + " revision=" + RevisionOf(m.Version) };
            lines.AddRange(won.Keys.OrderBy(k => k, StringComparer.OrdinalIgnoreCase).Select(k => won[k].Value));
            return lines;
        }

        /// <summary>
        /// The collection revision a modlist is: its version's first number,
        /// which the writer makes the revision (8.0.0.0 is revision 8). 0 when
        /// it has none.
        /// </summary>
        static int RevisionOf(string version)
        {
            string v = version ?? "";
            int dot = v.IndexOf('.');
            int n;
            return int.TryParse(dot < 0 ? v : v.Substring(0, dot), System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out n) ? n : 0;
        }

        /// <summary>Where the modlist a Release names is kept in the instance, for Run.</summary>
        public const string ModlistName = "collection-modlist.wabbajack";

        /// <summary>
        /// Installs the mods from the modlist of the Release
        /// <paramref name="on"/>, the one this launcher's channel is on
        /// (Updater.ChannelOn), into OwnGame.ModsFolder: the modlist
        /// held to that Release's signed record (VeloRecord.Modlist), then
        /// Run, with Mod Organizer 2 pointed at the Steam copy. Throws
        /// ModlistStop with the reason, and whatever VeloRecord throws when
        /// the record cannot be read.
        /// </summary>
        public static int FromRelease(Velopack.SemanticVersion on, Steps s)
        {
            if (on == null)
                throw new ModlistStop("The launcher has not read which Release its channel is on yet, so it does not know which modlist to install. Press it again once the update check has run.");
            if (string.IsNullOrEmpty(Paths.SteamCopy))
                throw new ModlistStop("Steam lists no Skyrim Special Edition on this PC, and the mods are installed for that copy. Install Skyrim Special Edition in Steam first.");
            string said;
            VeloRecord.Manifest m = VeloRecord.Get(on, out said);
            string mods = OwnGame.ModsFolder;
            string file = Path.Combine(mods, ModlistName);
            VeloRecord.Modlist(m, file);
            if (s.Say != null) s.Say("The modlist of " + m.Tag + ", collection revision " + m.CollectionRevision + ", held to its signed record");
            return Run(file, mods, Path.Combine(mods, "tools"), Paths.SteamCopy, s);
        }

        static string Sha256Of(string file)
        {
            using (var fs = File.OpenRead(file))
                return Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();
        }
    }
}
