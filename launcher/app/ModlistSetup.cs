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
//      (ModlistInstall.Install).
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
            public Action<long> OnBytes;
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
                ModlistFetch.ByAddress(a, downloads, s.OnBytes);
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
                    Nexus.Download(a, downloads, s.OnBytes);
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

            say("Putting in Mod Organizer 2 and the mods");
            return ModlistInstall.Install(m, downloads, mods, game, SevenZip.With(sevenZip), say);
        }
    }
}
