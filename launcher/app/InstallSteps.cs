using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32.SafeHandles;

namespace Thornswood
{
    /// <summary>
    /// What the install window hands the install: the folder, the own folder
    /// card and the Skyrim it found. Read on the window's thread when Install
    /// is pressed, so the steps on their own thread never touch a control.
    /// </summary>
    sealed class InstallChoice
    {
        /// <summary>The install folder, Root: Profile, Game and config.json go under it.</summary>
        public string Root = "";
        /// <summary>The own folder card's tick (issue #906).</summary>
        public bool MakeOwnGame;
        /// <summary>Choose Vortex's folder, from the same card. "" when none was chosen.</summary>
        public string VortexGame = "";
        /// <summary>Steam's own folder, "" when Steam is not installed.</summary>
        public string SteamRoot = "";
        /// <summary>Steam's copy of Skyrim Special Edition, "" when none was found.</summary>
        public string SteamGame = "";
        /// <summary>
        /// The folder the launcher was installed into with its package: the
        /// launcher, and beside it Game, Thornswood's own game files, and the
        /// rest of what the old payload carried (InstallSteps.PackageGame).
        /// </summary>
        public string Package = "";
    }

    /// <summary>
    /// A stop: the install cannot carry on. Its message is the sentence the
    /// window shows, as the script's Die said it.
    /// </summary>
    sealed class InstallStop : Exception
    {
        public InstallStop(string message) : base(message) { }
    }

    /// <summary>
    /// Every step the install takes, in compiled code (issue #4824). Until
    /// then this was installer\Setup-Thornswood.ps1, which Thornswood-Setup.exe
    /// ran hidden in its window and Setup.bat and Install.bat ran in a
    /// console. Decided 27 Oct: the installer is compiled code plus Velopack,
    /// and the script and both batch files retire. A hidden script is what
    /// antivirus reads hardest, and the install was written in two languages
    /// for one job.
    ///
    /// Velopack's Setup.exe puts the launcher and Thornswood's own game files
    /// on the PC. The launcher's first start then shows InstallWindow, which
    /// asks what Thornswood-Setup.exe asked (the drive, the own folder, the
    /// four boxes) and runs this. Every line it says goes into the window and
    /// into Profile\setup-log.txt; a stop is an InstallStop with the reason.
    ///
    /// It puts Thornswood on this machine. It does not put the game folder
    /// Thornswood plays out of on it. That is Root\Game, and the launcher
    /// builds it itself out of the Steam copy of Skyrim and what Vortex has
    /// deployed into it, most of it as hard links so the collection is not on
    /// the disk twice (OwnGame.cs).
    ///
    /// Where Thornswood's own content goes is the person's choice in the
    /// window (#1226, Patrick, 29 Sep):
    ///   - Thornswood's own folder chosen (MakeOwnGame): into Root\Profile\Payload.
    ///     Nothing at all is written into the Steam copy; the launcher makes
    ///     Root\Game from the Steam copy's game, what Vortex deployed and
    ///     Payload, and removes Payload.
    ///   - Not chosen: where Vortex deploys the collection, which is the Steam
    ///     copy, with a list of what it wrote there so an uninstall, or turning
    ///     the own folder on later, can take it back out again.
    ///
    /// A second run over a folder the launcher already made (Root\Game, with
    /// Profile\OwnGame\files.txt beside it) does not park that folder. It
    /// writes Thornswood's own files into it. A file there that is a hard link
    /// loses that name first, so the write does not go through to the other
    /// name.
    ///
    /// Bethesda's own files are never renamed or deleted.
    ///
    /// WHAT THE SCRIPT DID THAT THIS DOES NOT, and why. The script had a
    /// second shape, for a payload built with every mod in it and no
    /// collection.txt (the old installer's builder made one with -NoVortex
    /// until #4824): a copy of the base
    /// game under Root, the depot download to 1.6.1170, the SHA-1 check of the
    /// three files Steam's copy could have had patched, and taking the
    /// Creation Club files out of the copy. No package carries that shape
    /// now: the Velopack package's game files are the release's
    /// (Build-GameFiles.ps1), which never held the collection's files. The
    /// launcher does those three jobs itself for the folder it makes: the
    /// Downgrade card fetches 1.6.1170 (Downgrade.cs), and OwnGameKinds.cs
    /// holds Skyrim's own files to records\skyrim-files.json by the same
    /// SHA-1. The launcher exe is not copied into Root\Launcher and no desktop
    /// shortcut is made here either: Velopack installs the launcher and makes
    /// its shortcuts.
    /// </summary>
    sealed partial class InstallSteps
    {
        readonly InstallChoice choice;
        readonly Action<string> say;
        readonly Action<double> progress;

        public InstallSteps(InstallChoice choice, Action<string> say, Action<double> progress)
        {
            this.choice = choice;
            this.say = say;
            this.progress = progress;
        }

        /// <summary>How many checks at the end failed, and how many come from the collection next.</summary>
        public int Bad, Later;

        /// <summary>
        /// Thornswood's own game files, in the launcher's package: the folder
        /// merge-release.yml packs beside Thornswood.exe as Game. The script's
        /// payload folder, under the name the package gives it.
        /// </summary>
        public static string PackageGame(string package) { return Path.Combine(package, "Game"); }

        string Root { get { return choice.Root; } }
        string ProfileDir { get { return Path.Combine(Root, "Profile"); } }

        // Where Thornswood's own files go, and the Skyrim the build is read
        // from: the game folder, except with Thornswood's own folder chosen,
        // where the files go to Profile\Payload and the game it will be made
        // from is the Steam copy (#1226).
        string gameDir, exeDir;
        bool madeOwn, ownFirst;

        void Say(string s) { say(s); }

        void Head(string m)
        {
            say("");
            say(m);
            say(new string('-', m.Length));
        }

        static InstallStop Die(string m) { return new InstallStop(m); }

        /// <summary>
        /// The size of SkyrimSE.exe at 1.6.1170, the build the server runs,
        /// from records\skyrim-files.json, which the launcher carries inside
        /// itself (Thornswood.csproj). The script had the number typed in; the
        /// record is where every other check of the build reads it.
        /// </summary>
        static long TargetExeBytes()
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("skyrim-files.json"))
            {
                if (s == null) throw Die("This launcher was built without the list of Skyrim's own files (records\\skyrim-files.json), so it cannot tell which build of Skyrim is the server's.");
                using (JsonDocument doc = JsonDocument.Parse(s))
                    return doc.RootElement.GetProperty("files").GetProperty("SkyrimSE.exe").GetProperty("bytes").GetInt64();
            }
        }

        long ExeBytes()
        {
            string p = Path.Combine(exeDir, "SkyrimSE.exe");
            return File.Exists(p) ? new FileInfo(p).Length : 0;
        }

        /// <summary>
        /// Runs every step. Throws InstallStop when it cannot carry on; Bad
        /// above zero afterwards means a check at the end failed, which stops
        /// the install the same way.
        /// </summary>
        public void Run()
        {
            long targetExe = TargetExeBytes();
            string payload = PackageGame(choice.Package);

            Say("");
            Say("  THORNSWOOD");
            Say("  Setup");

            if (!Directory.Exists(payload))
                throw Die("Thornswood's own game files are not beside the launcher in " + payload + ". Run Thornswood's setup again to put them back.");

            // ------------------------------------------------- agreements
            // The window locks Install until the age box and the three
            // agreement boxes are ticked, and writes Profile\accepted.json
            // before it starts this (issue #1009). The note must be there, or
            // nothing is installed: an install with no note is what #1018
            // closed.
            string accepted = Path.Combine(ProfileDir, InstallAgreements.AcceptedFile);
            if (!File.Exists(accepted))
                throw Die("Setup found no note that you accepted the terms, the privacy policy and the rules, so nothing was installed. " +
                          "Close Thornswood and open it again to answer them.");

            // ------------------------------------------------- find steam
            Head("Finding Skyrim");
            // Steam's own folder is what finds Skyrim. InstallWindow finds
            // both the way the launcher does (Steam.cs).
            if (choice.SteamRoot.Length == 0 && choice.SteamGame.Length == 0) throw Die("Steam is not installed on this PC.");
            if (choice.SteamGame.Length == 0) throw Die("Skyrim Special Edition was not found in any Steam library. Install it first.");
            string steamGame = Path.GetFullPath(choice.SteamGame);
            Say("  " + steamGame);

            // ---- which shape of install this is ---------------------------
            //
            // The package is built with the collection's files left out, so
            // it cannot stand up its own Skyrim: most of that Skyrim is what
            // was left out. It goes into the Steam copy instead, which is
            // where Vortex deploys the collection.
            //
            // The launcher settles this the same way and has to agree:
            // Paths.Collection is true only when Root\Game does not exist.
            // Build one here and the launcher reads its own empty profile,
            // counts zero plugins, and reports a broken install over a
            // collection that installed perfectly.
            //
            // A folder the launcher has already made is not that first
            // install (#1233). Root\Game with Profile\OwnGame\files.txt beside
            // it is the working folder. Parking it as Game-old-<date> threw it
            // aside and left the launcher to build another one, and the
            // parked one stayed on the disk. This run writes the files into
            // the folder that is already there.
            string ownGame = Path.Combine(Root, "Game");
            string madeRecord = Path.Combine(ProfileDir, "OwnGame", "files.txt");
            madeOwn = Directory.Exists(ownGame) && File.Exists(madeRecord);
            ownFirst = choice.MakeOwnGame && !madeOwn;

            if (madeOwn)
            {
                gameDir = ownGame;
                exeDir = gameDir;
                Say("  Thornswood's own Skyrim folder is already here.");
                Say("  This updates Thornswood's own files in it and does not move it.");
                Say("  Your Steam copy stays yours.");
            }
            else if (ownFirst)
            {
                gameDir = Path.Combine(ProfileDir, "Payload");
                exeDir = steamGame;
                Say("  Thornswood's own Skyrim folder is chosen, so nothing is written into");
                Say("  this copy. The launcher makes the folder from it and from what Vortex");
                Say("  deploys into it, and your Steam copy stays yours.");
            }
            else
            {
                gameDir = steamGame;
                exeDir = gameDir;
                Say("  Thornswood installs into this copy. The mods come from the collection");
                Say("  in Vortex, which deploys into it too.");
            }

            // A Game folder left over from an older install is not harmless.
            // The launcher decides which Skyrim it is looking at by whether
            // that folder exists, so one sitting there sends it back to a
            // build that now has no mods in it, and the collection just
            // installed is never counted.
            //
            // Moved rather than deleted. It is twenty gigabytes of somebody's
            // disk and not this program's to throw away, and a rename is
            // undone in a second if any of this turns out to be wrong.
            //
            // Not a folder the launcher made. That one has
            // Profile\OwnGame\files.txt and madeOwn above leaves it where it
            // is (#1233).
            if (!madeOwn && Directory.Exists(ownGame))
            {
                string parked = Path.Combine(Root, "Game-old-" + DateTime.Now.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture));
                Say("");
                Say("  There is an old Game folder here from a previous install.");
                Say("  The launcher reads that one instead of your Steam copy, so it has to");
                Say("  move out of the way. Nothing is deleted.");
                try
                {
                    Directory.Move(ownGame, parked);
                }
                catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
                {
                    Say("");
                    Say("  It would not move: " + e.Message);
                    Say("  Close Skyrim, Vortex and the launcher, then run this again.");
                    throw Die("The old Game folder is in the way and the launcher will read it instead.");
                }
                Say("  moved to " + parked);
                Say("  Delete that yourself once Thornswood starts properly.");
                Say("");
            }

            // No downgrade here: the exe belongs to Steam and is not ours to
            // replace, and the launcher never replaces it either (#1218). Say
            // so now rather than at the end.
            string exeNow = Path.Combine(steamGame, "SkyrimSE.exe");
            long bytesNow = File.Exists(exeNow) ? new FileInfo(exeNow).Length : 0;
            if (bytesNow != targetExe)
            {
                Say("");
                Say("  This Skyrim is not build 1.6.1170, which is the one the server runs.");
                Say("  Thornswood installs anyway. Open the launcher and press Downgrade:");
                Say("  Steam downloads 1.6.1170's files and Thornswood makes its own game");
                Say("  folder from them. Your Steam copy stays on the build it is on.");
                Say("");
            }

            // ------------------------------------------------- space
            // The launcher, Thornswood's own content and the script extender,
            // and nothing else: the fifteen gigabytes of Bethesda archives are
            // already on the disk and stay where they are. The window says the
            // same number (InstallPlace.Needed) before Install is pressed.
            long needGB = InstallPlace.Needed / 1073741824L;
            string dl = DriveName(Root);
            double freeGB = FreeGB(Root);
            Say("  Installing to " + Root);
            Say("  " + Gb1(freeGB) + " GB free on " + dl);
            if (freeGB < needGB) throw Die("You need about " + needGB + " GB free on " + dl + ". Close this, open Thornswood again and pick a different drive.");
            if (!ownFirst && !madeOwn)
            {
                // The files land on whichever drive Steam keeps Skyrim on,
                // which is not necessarily the one just checked. With the own
                // folder chosen they land under Root, which is.
                string sd = DriveName(steamGame);
                if (sd.Length > 0 && !string.Equals(sd, dl, StringComparison.OrdinalIgnoreCase))
                {
                    double sf = FreeGB(steamGame);
                    Say("  " + Gb1(sf) + " GB free on " + sd + ", where Steam keeps Skyrim");
                    if (sf < 3) throw Die("Only " + Gb1(sf) + " GB free on " + sd + ", and Thornswood's own content needs about 3 GB there.");
                }
            }

            // ------------------------------------------------- the base game
            // Copying Bethesda's files into the Steam folder they are already
            // in would be fifteen gigabytes of writing a file over itself.
            Head("The base game");
            if (madeOwn) Say("  Already made. Thornswood's own files are updated in it.");
            else if (ownFirst) Say("  Your Steam copy. Thornswood's own folder is made from it by the launcher.");
            else Say("  Already here, this is your Steam copy.");
            Directory.CreateDirectory(ProfileDir);

            // ------------------------------------------------- the files
            Head("Installing the mods");
            Say("  Several thousand files, a few minutes.");
            List<string> files = PayloadFiles(payload);
            RecordIntoGame(files);
            if (madeOwn) RemoveSharedNames(payload, files, gameDir);
            CopyPayload(payload, files, gameDir);
            Say("  Done");

            // ------------------------------------------------- profile
            Settings();

            // ------------------------------------------------- own folder and config.json
            Dictionary<string, JsonNode> ownCard = OwnFolderCard();
            MergeConfig(ownCard);

            Shortcut();

            // ------------------------------------------------- verify
            Checks(targetExe);
            progress(1);
        }

        // ---------------------------------------------------------------- files

        /// <summary>
        /// Every file in the package's game files, as a path relative to it,
        /// hidden and system ones too, as robocopy /E took them.
        /// </summary>
        static List<string> PayloadFiles(string payload)
        {
            var opts = new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = 0, IgnoreInaccessible = false };
            var list = new List<string>();
            foreach (string f in Directory.EnumerateFiles(payload, "*", opts))
                list.Add(Path.GetRelativePath(payload, f));
            list.Sort(StringComparer.OrdinalIgnoreCase);
            return list;
        }

        // ---- a record of what we put in somebody else's game ----------------
        //
        // An install into the Steam copy of Skyrim writes into somebody
        // else's game. The uninstaller only ever deletes paths under Root, on
        // purpose, because that folder is the person's own game and Vortex's
        // hard links are in it. So without this list Thornswood's own content
        // stayed behind forever and an uninstall left the folder bigger than
        // it found it.
        //
        // Not with Thornswood's own folder chosen: nothing goes into the Steam
        // copy then, and a list an earlier install left stays as it is,
        // because it is what the launcher takes back out of the Steam copy
        // once the folder is made (OwnGame.CleanSteamCopy).
        void RecordIntoGame(List<string> files)
        {
            if (ownFirst || madeOwn || files.Count == 0) return;
            Directory.CreateDirectory(ProfileDir);
            string manifest = Path.Combine(ProfileDir, "installed-into-game.txt");
            File.WriteAllLines(manifest, files, new UTF8Encoding(false));
            Say("  " + files.Count.ToString("n0", CultureInfo.InvariantCulture) + " files recorded, so uninstalling can take them back out");
        }

        // A hard link is one file under two names. A copy writes into the file
        // it finds, so copying over a linked name in the made folder would
        // change the Steam copy or Vortex's staging as well. Every name the
        // files are about to replace comes off first. A hard link would take
        // the write through to its other name; the other name keeps its bytes,
        // and the copy that follows belongs here alone. The launcher does the
        // same before it writes (OwnGame.Detach).
        void RemoveSharedNames(string payload, List<string> files, string to)
        {
            int n = 0;
            foreach (string rel in files)
            {
                string dest = Path.Combine(to, rel);
                if (!File.Exists(dest)) continue;
                bool linked = Links(dest) > 1;
                File.SetAttributes(dest, FileAttributes.Normal);
                File.Delete(dest);
                if (linked) n++;
            }
            if (n > 0) Say("  " + n + " linked file(s) separated, so the copy does not write through them");
        }

        /// <summary>
        /// Copies the files into the game folder with the window's bar on the
        /// bytes copied. A file that will not copy stops the install, naming
        /// both folders: robocopy's codes 8 and above did that (#2201), and a
        /// half copied game folder that looked finished is what they caught.
        /// Copied rather than moved: the package's own folder is Velopack's,
        /// which it reads again for the next update.
        /// </summary>
        void CopyPayload(string payload, List<string> files, string to)
        {
            long total = 0;
            foreach (string rel in files) total += new FileInfo(Path.Combine(payload, rel)).Length;
            long done = 0;
            var clock = Stopwatch.StartNew();
            Directory.CreateDirectory(to);
            foreach (string rel in files)
            {
                string from = Path.Combine(payload, rel);
                string dest = Path.Combine(to, rel);
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    File.Copy(from, dest, true);
                }
                catch (Exception e) when (e is IOException || e is UnauthorizedAccessException)
                {
                    throw Die("Could not copy " + from + " to " + dest + " (" + e.Message + "). " +
                              "Check the disk has room and nothing has those files open, then run this again.");
                }
                done += new FileInfo(from).Length;
                // The copy is nearly all of the time an install takes, so it
                // is nearly all of the bar: 5 to 90 percent, by bytes.
                progress(0.05 + 0.85 * (total > 0 ? (double)done / total : 1));
            }
            Say(string.Format(CultureInfo.InvariantCulture, "  installing the mods, {0:mm\\:ss}", clock.Elapsed));
        }

        // ---------------------------------------------------------------- settings

        void Settings()
        {
            Head("Settings");
            string pMyGames = Path.Combine(ProfileDir, "MyGames");
            string pLocalAD = Path.Combine(ProfileDir, "LocalAppData");
            string golden = Path.Combine(ProfileDir, "Default");
            foreach (string d in new[] { pMyGames, pLocalAD, golden, Path.Combine(pMyGames, "Saves") })
                Directory.CreateDirectory(d);

            string src = Path.Combine(choice.Package, "profile");
            if (Directory.Exists(src))
            {
                foreach (string f in Directory.GetFiles(src)) File.Copy(f, Path.Combine(golden, Path.GetFileName(f)), true);
                foreach (string f in Directory.GetFiles(golden, "*.ini")) File.Copy(f, Path.Combine(pMyGames, Path.GetFileName(f)), true);
                foreach (string f in Directory.GetFiles(golden, "*.txt")) File.Copy(f, Path.Combine(pLocalAD, Path.GetFileName(f)), true);
                string plug = Path.Combine(pLocalAD, "plugins.txt");
                int n = 0;
                if (File.Exists(plug)) foreach (string l in File.ReadAllLines(plug)) if (l.StartsWith("*", StringComparison.Ordinal)) n++;
                Say("  Load order installed, " + n + " plugins");
            }
            else
            {
                // Expected. Vortex writes the real plugins.txt into AppData
                // and that is what the launcher reads, so there is nothing for
                // this build to lay down.
                Say("  Load order comes from Vortex, nothing to install here.");
            }

            // Every pack this build already contains, so the launcher does not
            // offer the whole history of the project as a pending update the
            // moment it opens. Only written when there is not one already: a
            // reinstall over an existing profile has a real record and this
            // one is a snapshot from build time.
            string appliedSrc = Path.Combine(choice.Package, "applied.txt");
            string appliedDst = Path.Combine(ProfileDir, "applied.txt");
            if (File.Exists(appliedSrc) && !File.Exists(appliedDst))
            {
                File.Copy(appliedSrc, appliedDst, true);
                int na = 0;
                foreach (string l in File.ReadAllLines(appliedDst)) if (l.Trim().Length > 0) na++;
                Say("  " + na + " updates marked as already in this build");
            }

            // Where the source of the SkyMP files is. The package carries it
            // from the build records. It goes into the install folder because
            // entry 170 on the To Do List asked for it "from inside the
            // installed folder". Uninstall.cs names it among the files it
            // removes, or the install folder would never come out empty.
            CopyIfThere(Path.Combine(choice.Package, "SOURCE CODE.txt"), Path.Combine(Root, "SOURCE CODE.txt"));

            // Full GPL / AGPL texts and the launcher's libraries' licences beside
            // SOURCE CODE.txt (#421, #4823; installer\licences\README.txt lists them).
            foreach (string lic in LicenceFiles)
                CopyIfThere(Path.Combine(choice.Package, lic), Path.Combine(Root, lic));

            // The licence texts of the libraries inside the SkyMP files, which
            // SOURCE CODE.txt lists (#3099). The folder is replaced whole, so
            // a text of a library an older client had does not stay behind;
            // Uninstall.cs names it.
            string libFrom = Path.Combine(choice.Package, "licences");
            if (Directory.Exists(libFrom))
            {
                string libTo = Path.Combine(Root, "licences");
                if (Directory.Exists(libTo)) Directory.Delete(libTo, true);
                CopyTree(libFrom, libTo);
            }
        }

        /// <summary>
        /// The licence texts the package carries beside SOURCE CODE.txt and the
        /// install puts beside it in Root: the GPL and AGPL of the SkyMP files,
        /// and the texts of every library built into the launcher or shipped
        /// with it, and of the voice's HRTF code and data (#421, #4823, #963). Build-SetupFiles.ps1 packs the same names
        /// from installer\licences, whose README.txt says where each is from,
        /// and Uninstall.cs removes them.
        /// </summary>
        internal static readonly string[] LicenceFiles =
        {
            "GPL-3.0.txt", "AGPL-3.0.txt",
            "Concentus-LICENSE.txt", "SharpSRTP-LICENSE.txt", "BouncyCastle-LICENSE.txt",
            "dotnet-LICENSE.txt", "dotnet-THIRD-PARTY-NOTICES.txt",
            "Avalonia-LICENSE.txt", "MicroCom-LICENSE.txt", "Tmds.DBus-LICENSE.txt",
            "SkiaSharp-LICENSE.txt", "SkiaSharp-THIRD-PARTY-NOTICES.txt", "ANGLE-LICENSE.txt",
            "Velopack-LICENSE.txt", "Velopack-Rust-crates.txt", "NLayer-LICENSE.txt",
            "Chromium-HRTF-LICENSE.txt", "IRCAM-Listen-HRTF.txt",
        };

        static void CopyIfThere(string from, string to)
        {
            if (File.Exists(from)) File.Copy(from, to, true);
        }

        static void CopyTree(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (string f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)), true);
            foreach (string d in Directory.GetDirectories(from)) CopyTree(d, Path.Combine(to, Path.GetFileName(d)));
        }

        // ---------------------------------------------------------------- own folder

        /// <summary>
        /// Thornswood's own Skyrim folder, as the window's card left it. The
        /// launcher makes the folder itself (OwnGame.Make) once Vortex has
        /// deployed, so all this does is answer its question in advance and
        /// name Vortex's folder. The same check as the launcher's
        /// OwnGame.PointAt: a Skyrim, with Vortex's record in it. Anything
        /// else is said and left out, never a stop, because the launcher's
        /// own Settings button can still set it.
        /// </summary>
        Dictionary<string, JsonNode> OwnFolderCard()
        {
            var own = new Dictionary<string, JsonNode>(StringComparer.Ordinal);
            string vortex = choice.VortexGame ?? "";
            if (!choice.MakeOwnGame && vortex.Length == 0) return own;
            Head("Thornswood's own Skyrim folder");
            if (choice.MakeOwnGame)
            {
                own["MakeOwnGame"] = JsonValue.Create(true);
                Say("  On. The launcher makes it by itself once Vortex has deployed the Thornswood collection.");
            }
            if (vortex.Length > 0)
            {
                string vg = vortex.Trim().Trim('"').Trim().TrimEnd('\\');
                if (!File.Exists(Path.Combine(vg, "SkyrimSE.exe")))
                    Say("  " + vg + " has no SkyrimSE.exe in it, so it is not a Skyrim folder. Choose Vortex's folder in the launcher's Settings instead.");
                else if (!File.Exists(Path.Combine(vg, "Data", "vortex.deployment.json")))
                    Say("  Vortex has not deployed into " + vg + ", so it was not saved. Choose Vortex's folder in the launcher's Settings instead.");
                else
                {
                    own["VortexGame"] = JsonValue.Create(vg);
                    Say("  Vortex's folder is set to " + vg);
                }
            }
            return own;
        }

        // ---------------------------------------------------------------- config.json

        /// <summary>
        /// config.json is merged rather than copied over. The one in the
        /// package is deliberately blank where the credentials go, so a
        /// straight copy would wipe a working install's password on every
        /// upgrade. Anything the package does not name is left exactly as it
        /// was, and a blank field in the package never overwrites a filled one
        /// on the disk. The own folder card's answer is this run's, so it goes
        /// over whatever was there.
        /// </summary>
        void MergeConfig(Dictionary<string, JsonNode> ownCard)
        {
            string cfgFrom = Path.Combine(choice.Package, "config.json");
            string cfgTo = Path.Combine(Root, "config.json");
            if (!File.Exists(cfgFrom) && ownCard.Count == 0) return;

            JsonObject neu = ReadJson(cfgFrom);
            JsonObject old = ReadJson(cfgTo);
            JsonObject merged = Merge(old, neu, ownCard);
            WriteJson(cfgTo, merged);
            KeepToThisAccount(cfgTo);
        }

        /// <summary>
        /// The merge on its own: what was on the disk, then each field of the
        /// package's that is not blank or not there yet, then the card's.
        /// Blank is what PowerShell's "$value" made an empty string of: no
        /// value, an empty string, or an empty list.
        /// </summary>
        internal static JsonObject Merge(JsonObject old, JsonObject neu, Dictionary<string, JsonNode> ownCard)
        {
            var outObj = new JsonObject();
            if (old != null) foreach (KeyValuePair<string, JsonNode> kv in old) outObj[kv.Key] = kv.Value == null ? null : kv.Value.DeepClone();
            if (neu != null)
            {
                foreach (KeyValuePair<string, JsonNode> kv in neu)
                {
                    if (!Blank(kv.Value) || !outObj.ContainsKey(kv.Key))
                        outObj[kv.Key] = kv.Value == null ? null : kv.Value.DeepClone();
                }
            }
            foreach (KeyValuePair<string, JsonNode> kv in ownCard) outObj[kv.Key] = kv.Value.DeepClone();
            return outObj;
        }

        static bool Blank(JsonNode v)
        {
            if (v == null) return true;
            if (v is JsonArray a) return a.Count == 0;
            if (v is JsonValue jv && jv.GetValueKind() == JsonValueKind.String) return jv.GetValue<string>().Length == 0;
            return false;
        }

        /// <summary>
        /// The file as a JSON object, a byte order mark or not, or null when it
        /// is not there or is not JSON: then the merge starts from nothing, as
        /// the script's Read-Json did.
        /// </summary>
        internal static JsonObject ReadJson(string path)
        {
            if (!File.Exists(path)) return null;
            byte[] raw = File.ReadAllBytes(path);
            int skip = raw.Length >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF ? 3 : 0;
            try { return JsonNode.Parse(new ReadOnlySpan<byte>(raw, skip, raw.Length - skip)) as JsonObject; }
            catch (JsonException) { return null; }
        }

        static void WriteJson(string path, JsonObject o)
        {
            using (var ms = new MemoryStream())
            {
                using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { Indented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
                    o.WriteTo(w);
                // UTF-8 with no byte order mark: the game stops dead on one,
                // and the launcher's Config reads it either way.
                File.WriteAllBytes(path, ms.ToArray());
            }
        }

        /// <summary>
        /// Nobody but this account has any business reading config.json. It
        /// holds the server password once the launcher has fetched one. The
        /// script did this with Set-Acl; a refusal is said and the install goes
        /// on, as it did there, because the file is still only in this
        /// person's own folder.
        /// </summary>
        void KeepToThisAccount(string path)
        {
            if (!OperatingSystem.IsWindows()) return;
            try
            {
                var fi = new FileInfo(path);
                var acl = fi.GetAccessControl();
                acl.SetAccessRuleProtection(true, false);
                string me = System.Security.Principal.WindowsIdentity.GetCurrent().Name;
                acl.SetAccessRule(new System.Security.AccessControl.FileSystemAccessRule(
                    me, System.Security.AccessControl.FileSystemRights.FullControl, System.Security.AccessControl.AccessControlType.Allow));
                fi.SetAccessControl(acl);
            }
            catch (Exception e) when (e is UnauthorizedAccessException || e is IOException || e is InvalidOperationException ||
                                      e is System.Security.Principal.IdentityNotMappedException || e is PlatformNotSupportedException)
            {
                Say("  config.json could not be kept to this account only: " + e.Message);
            }
        }

        // ---------------------------------------------------------------- shortcut

        /// <summary>
        /// Thornswood.lnk in the install folder, for whoever goes looking for
        /// Thornswood there. The desktop and Start menu shortcuts are
        /// Velopack's, made when it installs the launcher.
        /// </summary>
        void Shortcut()
        {
            string exe = Environment.ProcessPath ?? "";
            if (!OperatingSystem.IsWindows() || exe.Length == 0) return;
            string why = InstallShortcut.Make(Path.Combine(Root, "Thornswood.lnk"), exe);
            if (why == null) Say("  Shortcut in " + Root);
            else Say("  No shortcut in " + Root + ": " + why);
        }

        // ---------------------------------------------------------------- checks

        void Checks(long targetExe)
        {
            Head("Checking");
            // SkyMP has no client exe of its own: the client is
            // MpClientPlugin.dll under SKSE\Plugins, which is what the
            // launcher itself checks.
            //
            // The load order is the one Vortex writes into the person's own
            // AppData, which is exactly what the launcher reads once there is
            // no Game folder to look at instead.
            string winLocalAD = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Skyrim Special Edition");
            // The script extender and the address library are read where the
            // game is: with the own folder chosen that is the Steam copy
            // Vortex deploys into, and the multiplayer client is Thornswood's
            // own, in Profile\Payload.
            var checks = new List<KeyValuePair<string, bool>>
            {
                new KeyValuePair<string, bool>("Game 1.6.1170", ExeBytes() == targetExe),
                new KeyValuePair<string, bool>("Script Extender", File.Exists(Path.Combine(exeDir, "skse64_1_6_1170.dll"))),
                new KeyValuePair<string, bool>("Multiplayer", File.Exists(Path.Combine(gameDir, "Data", "SKSE", "Plugins", "MpClientPlugin.dll"))),
                new KeyValuePair<string, bool>("Address library", File.Exists(Path.Combine(exeDir, "Data", "SKSE", "Plugins", "versionlib-1-6-1170-0.bin"))),
                new KeyValuePair<string, bool>("Load order", File.Exists(Path.Combine(winLocalAD, "plugins.txt"))),
                // The launcher is what runs this, from where Velopack put it.
                new KeyValuePair<string, bool>("Launcher", File.Exists(Environment.ProcessPath ?? "")),
            };
            // Two of these are not ours to install. The script extender and
            // the address library both come out of the collection, which
            // Vortex installs in the NEXT step, after this. Counting them as
            // failures here tells somebody their install is broken at the
            // exact moment they are doing it in the right order, and the line
            // underneath sends them to staff with a screenshot of a working
            // install. Checked against the collection's own manifest rather
            // than guessed: address library is "All in one (all game
            // versions)", Nexus 32444, and skse is deployed by Vortex into the
            // game root the same way.
            var fromCollection = new HashSet<string>(StringComparer.Ordinal) { "Script Extender", "Address library" };
            Bad = 0;
            Later = 0;
            foreach (KeyValuePair<string, bool> c in checks)
            {
                if (c.Value) Say("  [ok]   " + c.Key);
                else if (fromCollection.Contains(c.Key))
                {
                    Say("  [next] " + c.Key + "  the collection installs this");
                    Later++;
                }
                else if (c.Key == "Game 1.6.1170")
                {
                    // A wrong build is not a failed install: the launcher's
                    // Downgrade button fetches 1.6.1170 for Thornswood's own
                    // folder and leaves the Steam copy as it is (#1218).
                    Say("  [next] " + c.Key + "  the launcher's Downgrade button fixes this");
                    Later++;
                }
                else
                {
                    Say("  [MISS] " + c.Key);
                    Bad++;
                }
            }

            Say("");
            if (Bad > 0)
            {
                Say(Bad + " check" + (Bad == 1 ? "" : "s") + " failed. Send staff a screenshot of this window in the Discord.");
                return;
            }
            if (Later > 0) Say("Installed. " + Later + " thing" + (Later == 1 ? "" : "s") + " still to come from the collection, which is the next step.");
            else Say("Installed.");
            Say("");
            Say("Make a character named after yourself, save once, then connect.");
            Say("");
            Say("The launcher opens on the collection if your mods are not in yet.");
            Say("Install it in Vortex and switch to the profile it makes. Without");
            Say("that you have a launcher and no mods.");
            if (choice.MakeOwnGame)
            {
                Say("Once Vortex has deployed it, the launcher makes Thornswood's own");
                Say("Skyrim folder by itself and restarts.");
            }
            if (ownFirst || madeOwn) Say("Nothing was written into your Steam copy of Skyrim.");
            if (madeOwn) Say("Thornswood's own folder was updated in place.");
            Say("");
            Say("Opening Thornswood now.");
        }

        // ---------------------------------------------------------------- helpers

        /// <summary>"D:" for a path on D:, as the script's Split-Path -Qualifier said it.</summary>
        static string DriveName(string path)
        {
            string r = Path.GetPathRoot(Path.GetFullPath(path)) ?? "";
            return r.Length > 1 ? r.TrimEnd('\\') : r;
        }

        static double FreeGB(string path)
        {
            string r = Path.GetPathRoot(Path.GetFullPath(path));
            return Math.Round(new DriveInfo(r).AvailableFreeSpace / 1073741824.0, 1);
        }

        static string Gb1(double gb) { return gb.ToString("0.0", CultureInfo.InvariantCulture); }

        // How many names a file has, asked with a handle that may read the
        // file's attributes and nothing else, as OwnGame.Links asks it
        // (#2210). On anything but Windows there is no such call, and nothing
        // the launcher makes is a hard link there, so the answer is one.
        static int Links(string path)
        {
            if (!OperatingSystem.IsWindows()) return 1;
            string p = path.Length >= 260 && !path.StartsWith(@"\\?\", StringComparison.Ordinal) ? @"\\?\" + Path.GetFullPath(path) : path;
            using (SafeFileHandle h = CreateFileW(p, FileReadAttributes, FileShareAll, IntPtr.Zero, OpenExisting, BackupSemantics, IntPtr.Zero))
            {
                if (h.IsInvalid) Marshal.ThrowExceptionForHR(Marshal.GetHRForLastWin32Error());
                FileInfoByHandle info;
                if (!GetFileInformationByHandle(h, out info)) return 1;
                return (int)info.NumberOfLinks;
            }
        }

        const uint FileReadAttributes = 0x80, FileShareAll = 7, OpenExisting = 3, BackupSemantics = 0x02000000;

        // BY_HANDLE_FILE_INFORMATION. Each FILETIME is two DWORDs, so the
        // struct packs on four bytes, which two uints each keep.
        [StructLayout(LayoutKind.Sequential)]
        struct FileInfoByHandle
        {
            public uint FileAttributes;
            public uint CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh;
            public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
        }

        [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
        private static partial SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static partial bool GetFileInformationByHandle(SafeFileHandle h, out FileInfoByHandle info);
    }
}
