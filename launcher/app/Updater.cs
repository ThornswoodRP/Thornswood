using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Thornswood
{
    static partial class Updater
    {
        // The launcher's number, the one the build gave the exe (#4825): the
        // build passes it as -p:Version (scripts\release\Build-Launcher.ps1),
        // and in a merge release it is the version of the Velopack package
        // the exe goes out in (merge-release.yml, MergeRelease.ps1), so the
        // launcher, the package and the signed release record say the same
        // number. A bare build says 0.0.0. Until #4825 the build wrote the
        // number into this line and put it back afterwards; nothing writes a
        // source file for the build any more.
        public static readonly string Version = BuiltVersion();

        /// <summary>
        /// The exe's own version, three parts, or four when the build gave
        /// four (a dev Ship's number, Ship.ps1). Read from the assembly's name,
        /// which the native build keeps.
        /// </summary>
        static string BuiltVersion()
        {
            System.Version v = typeof(Updater).Assembly.GetName().Version;
            if (v == null) return "0.0.0";
            string three = v.Major + "." + v.Minor + "." + Math.Max(0, v.Build);
            return v.Revision > 0 ? three + "." + v.Revision : three;
        }

        /// <summary>
        /// The collection revision of the Release this install's channel runs,
        /// from that Release's signed record (VeloRecord.Manifest
        /// CollectionRevision, which New-SignedManifest.ps1 writes from
        /// records\collection-plugins.json), or 0 until it has been read. Set
        /// by CheckLauncher on every launcher check (#5767).
        ///
        /// It was the feed's collectionRevision until 11 Nov, which only a Ship
        /// writes. Releases stopped going through a Ship, so revision 8 sat
        /// behind 7 from 8 to 11 Nov and a launcher on 8 was told the server
        /// had not caught up with it.
        ///
        /// Held here rather than in Config because it is not a setting: it is
        /// a fact about the server, and writing it into config.json would mean
        /// a stale copy outliving the release it came from.
        /// </summary>
        public static int ServerCollectionRevision;

        /// <summary>
        /// Every path Vortex says it has deployed into the game folder. Under
        /// a folder of Thornswood's own the record lives in the folder Vortex
        /// deploys into (OwnGame.DeploysInto), never in Thornswood's folder,
        /// because the refresh leaves Vortex's own records behind. That is the
        /// Steam copy, unless Vortex deploys into another folder, and then the
        /// record is there and not in the Steam copy (OwnGame.Source), which is
        /// why this does not read Source (review, 24 September). Empty when
        /// there is nothing to read, which leaves the removal as it was.
        /// </summary>
        static HashSet<string> DeployedNow(Config cfg)
        {
            try
            {
                string src = OwnGame.Active ? OwnGame.DeploysInto(cfg) : Paths.Game;
                if (string.IsNullOrEmpty(src)) return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                return OwnGame.DeployedIn(src);
            }
            catch (Exception ex) { Swallow.Note("Updater.DeployedNow", ex); return new HashSet<string>(StringComparer.OrdinalIgnoreCase); }
        }

        static string Sha256(string file)
        {
            using (var s = File.OpenRead(file))
            using (var h = SHA256.Create())
            {
                byte[] d = h.ComputeHash(s);
                var sb = new StringBuilder();
                foreach (byte b in d) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }


        /// <summary>
        /// Files an update has just created inside the Steam copy join the list
        /// the uninstaller works from, so taking Thornswood out later takes
        /// them out too. The installer writes that list at install time and
        /// knows nothing about what arrived afterwards. Paths in it are
        /// relative to the game folder, one per line, which is what the
        /// uninstaller reads. Nothing is done on an install that has a game
        /// folder of its own, because that whole folder goes at uninstall, nor
        /// on one whose own folder was chosen and is not made yet, whose game
        /// files are in Profile\Payload and never in the Steam copy (#1226).
        /// The list is also what OwnGame.CleanSteamCopy takes out of the Steam
        /// copy once the folder is made.
        /// </summary>
        static void NoteInstalledIntoGame(List<string> rels)
        {
            if (!Paths.Collection || Paths.OwnFirst || rels == null || rels.Count == 0) return;
            try
            {
                string list = Path.Combine(Paths.ProfileDir, "installed-into-game.txt");
                var have = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (File.Exists(list))
                    foreach (string l in File.ReadAllLines(list))
                        if (l.Trim().Length > 0) have.Add(l.Trim());
                var add = new List<string>();
                foreach (string r in rels)
                    if (!have.Contains(r)) { have.Add(r); add.Add(r); }
                if (add.Count == 0) return;
                Directory.CreateDirectory(Paths.ProfileDir);
                File.AppendAllText(list, string.Join(Environment.NewLine, add.ToArray()) + Environment.NewLine);
            }
            catch (Exception ex) { Swallow.Note("Updater.NoteInstalledIntoGame, append", ex); }
        }

        /// <summary>
        /// Who every program of an update has to be signed by: the launcher,
        /// the libraries beside it and Velopack's own programs in the package
        /// (VeloPackage.cs), Velopack's Update.exe, and the catalog of each
        /// release record (VeloRecord.cs).
        ///
        /// Match on a distinctive part of the certificate's Subject line rather
        /// than the whole of it, because certificate authorities add and
        /// reorder fields between renewals and an exact-match check would
        /// refuse a perfectly good update the day the certificate is renewed.
        ///
        /// Since #912 this is the last of five checks, not the only one:
        /// Signature.cs first has Windows verify the signature and pins
        /// Microsoft's Artifact Signing and Thornswood's durable identity.
        /// scripts\release\Assert-PublishSigned.ps1 reads this line.
        ///
        /// This is one layer, not the only one. The sha256 a release names
        /// decides the bytes are the ones published, the signed release record
        /// decides somebody holding the signing right published them, and this
        /// decides who built each program. Removing any of them because the
        /// others exist would be a straight loss.
        ///
        /// The launcher updates through Velopack (#4825), from this
        /// repository's Releases on GitHub (#5608), with every check in
        /// VeloUpdate.cs.
        /// </summary>
        public const string ExpectedSigner = "Gavin Knotts";
    }
}
