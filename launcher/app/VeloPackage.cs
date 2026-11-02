using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;

namespace Thornswood
{
    /// <summary>
    /// EVERY FILE IN AN UPDATE PACKAGE, CHECKED BEFORE IT IS APPLIED (#4825).
    ///
    /// The package Velopack downloaded (or rebuilt from the one before and its
    /// deltas) is opened and each file Velopack would put in place is held to
    /// one of two things, so nothing reaches this PC that nobody vouched for:
    ///   - a game file (lib/app/Game/...) must be in the signed release's
    ///     game-files.json with the same size and sha256, and every file that
    ///     list names must be in the package. A file that does not match is
    ///     refused, as the feed's record sync refuses one (Sync.cs).
    ///   - a file beside Game that the install reads on the first start
    ///     (config.json, profile\, applied.txt, the source note and the
    ///     licence texts, scripts/release/Build-SetupFiles.ps1) must be in the
    ///     signed release's setup-files.&lt;channel&gt;.json the same way, and every file it
    ///     names must be there.
    ///   - every program (.exe, .dll) anywhere else, the launcher itself,
    ///     the native libraries beside it and Velopack's own Update.exe and
    ///     starter, must pass Signature.Refusal for ExpectedSigner: Windows
    ///     verifies the signature and its chain, and it is Thornswood's own
    ///     identity from Microsoft's Artifact Signing (Signature.cs says why
    ///     each). This is the signer check the old self update made on the
    ///     downloaded exe before the swap (#912), on every program now.
    /// Nothing else may be under lib/app but Velopack's own version file.
    /// The package's NuGet bookkeeping outside lib/app is never put on disk.
    ///
    /// Checked on the package's contents, not its bytes, because a package
    /// rebuilt from deltas is not byte for byte the one the Release carries;
    /// its contents are.
    /// </summary>
    static class VeloPackage
    {
        const string App = "lib/app/";
        const string GameDir = "lib/app/Game/";

        /// <summary>
        /// Empty when every file in the package at <paramref name="nupkg"/>
        /// is vouched for (above); otherwise why not, as the rest of a
        /// sentence starting "The update package". <paramref name="said"/> is
        /// the line for launcher.log when it passed. Reports how far it has
        /// got to <paramref name="files"/> (done, total).
        /// </summary>
        public static string Refusal(string nupkg, VeloRecord.GameList list, VeloRecord.GameList setup, string expectedSigner,
                                     Action<long, long> files, out string said)
        {
            said = "";
            var want = new Dictionary<string, VeloRecord.GameFile>(StringComparer.OrdinalIgnoreCase);
            string bad = Wanted(list, "game-files.json", want);
            if (bad.Length > 0) return bad;
            var wantSetup = new Dictionary<string, VeloRecord.GameFile>(StringComparer.OrdinalIgnoreCase);
            string setupName = "setup-files." + setup.Channel + ".json";
            bad = Wanted(setup, setupName, wantSetup);
            if (bad.Length > 0) return bad;
            foreach (string p in wantSetup.Keys)
            {
                if (p.StartsWith("Game/", StringComparison.OrdinalIgnoreCase) || p.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || p.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
                    return "has a " + setupName + " that names " + p + ", which is a game file or a program, and those are held to their own checks.";
            }

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var seenSetup = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int programs = 0;
            string signerSaid = "";
            using (ZipArchive zip = ZipFile.OpenRead(nupkg))
            {
                long total = zip.Entries.Count, done = 0;
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    done++;
                    if (files != null && (done % 50 == 0 || done == total)) files(done, total);
                    if (e.FullName.EndsWith("/", StringComparison.Ordinal)) continue;
                    // NuGet writes each name escaped, a space as %20; Velopack
                    // reads them back the same way (NugetUtil.GetPath).
                    string name = Uri.UnescapeDataString(e.FullName.Replace('\\', '/')).TrimStart('/');
                    if (name.Contains("../", StringComparison.Ordinal) || name.Contains("/..", StringComparison.Ordinal))
                        return "carries " + name + ", a path that climbs out of its folder.";

                    if (name.StartsWith(GameDir, StringComparison.OrdinalIgnoreCase))
                    {
                        string rel = name.Substring(GameDir.Length);
                        VeloRecord.GameFile f;
                        if (!want.TryGetValue(rel, out f))
                            return "carries the game file " + rel + ", which the signed release's game-files.json does not list.";
                        string why = Differs(e, rel, f);
                        if (why.Length > 0) return why;
                        seen.Add(rel);
                        continue;
                    }

                    if (name.StartsWith(App, StringComparison.OrdinalIgnoreCase))
                    {
                        VeloRecord.GameFile f;
                        string rel = name.Substring(App.Length);
                        if (wantSetup.TryGetValue(rel, out f))
                        {
                            string why = Differs(e, rel, f);
                            if (why.Length > 0) return why;
                            seenSetup.Add(rel);
                            continue;
                        }
                    }

                    bool program = name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                                   name.EndsWith(".dll", StringComparison.OrdinalIgnoreCase);
                    if (program)
                    {
                        // The copy is named here, never from the entry: only
                        // its kind (.exe or .dll, which the check above
                        // settled) comes from the package.
                        string ext = name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? ".exe" : ".dll";
                        string tmp = Path.Combine(Path.GetTempPath(), "thornswood-velo-" + Guid.NewGuid().ToString("N") + ext);
                        try
                        {
                            e.ExtractToFile(tmp, true);
                            string why = Signature.Refusal(tmp, expectedSigner, out signerSaid);
                            if (why.Length > 0) return "carries the program " + name + ", which " + why;
                        }
                        finally
                        {
                            try { File.Delete(tmp); } catch (Exception ex) { Swallow.Note("VeloPackage.Refusal, delete " + tmp, ex); }
                        }
                        programs++;
                        continue;
                    }

                    // Outside lib/app: the package's own NuGet bookkeeping,
                    // which Velopack reads and never puts on disk.
                    if (!name.StartsWith(App, StringComparison.OrdinalIgnoreCase)) continue;
                    if (string.Equals(name, App + "sq.version", StringComparison.OrdinalIgnoreCase)) continue;
                    return "carries " + name + ", which is neither a signed program nor a file the signed release lists.";
                }
            }

            var missing = new List<string>();
            foreach (string p in want.Keys) if (!seen.Contains(p)) missing.Add(p);
            if (missing.Count > 0)
                return "lacks " + missing.Count + " of the game files the signed release lists, " + missing[0] + (missing.Count > 1 ? " among them." : ".");
            foreach (string p in wantSetup.Keys) if (!seenSetup.Contains(p)) missing.Add(p);
            if (missing.Count > 0)
                return "lacks " + missing.Count + " of the files beside the game files the signed release lists, " + missing[0] + (missing.Count > 1 ? " among them." : ".");
            if (programs == 0) return "carries no program at all, so there is no launcher in it.";

            said = "Every file in the update package checked: " + seen.Count + " game files and " + seenSetup.Count +
                   " files beside them match the signed release's lists, and " +
                   programs + (programs == 1 ? " program is" : " programs are") + " signed by Thornswood. " + signerSaid;
            return "";
        }

        /// <summary>The list as a map by path, or why it cannot be one.</summary>
        static string Wanted(VeloRecord.GameList list, string named, Dictionary<string, VeloRecord.GameFile> want)
        {
            foreach (VeloRecord.GameFile f in list.Files)
            {
                if (f == null || string.IsNullOrEmpty(f.Path) || string.IsNullOrEmpty(f.Sha256)) return "has a " + named + " naming a file it gives no path or checksum for.";
                string p = f.Path.Replace('\\', '/');
                if (p.StartsWith("/", StringComparison.Ordinal) || p.Contains("../", StringComparison.Ordinal) || p.Contains("/..", StringComparison.Ordinal))
                    return "has a " + named + " naming " + p + ", a path that climbs out of its folder.";
                if (want.ContainsKey(p)) return "has a " + named + " that lists " + p + " twice.";
                want[p] = f;
            }
            return "";
        }

        /// <summary>Empty when the entry is the listed file, by size and sha256; otherwise why not.</summary>
        static string Differs(ZipArchiveEntry e, string rel, VeloRecord.GameFile f)
        {
            if (e.Length != f.Size)
                return "carries " + rel + " at " + e.Length + " bytes, and the signed list says " + f.Size + ".";
            string sha;
            using (Stream s = e.Open()) sha = VeloRecord.Sha256(s);
            if (!string.Equals(sha, f.Sha256, StringComparison.OrdinalIgnoreCase))
                return "carries " + rel + " with the checksum " + sha + ", and the signed list says " + f.Sha256 + ".";
            return "";
        }
    }
}
