using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Thornswood
{
    /// <summary>
    /// Removing the build, in the one order that is safe.
    ///
    /// The dangerous part is not deleting the game folder, it is the profile
    /// redirect. While this build is running, Windows' own Skyrim settings and
    /// saves folders are junctions pointing into Profile, and the real ones are
    /// sitting next to them renamed .st-backup. Delete Profile with those
    /// junctions live and Windows follows them: your saves go with it, and the
    /// backup is left orphaned under a name nothing looks for. So Swap.Restore
    /// runs first, every time, and nothing else happens until it has.
    ///
    /// Nothing here touches the Skyrim you own on Steam. An install made
    /// before 1.1 keeps its own copy of the game under Root and that copy is
    /// what goes. Under the collection there is no such copy: the mods are
    /// Vortex's, deployed into the Steam game as hardlinks, and Purge Mods in
    /// Vortex is what removes them. Either way the last step here only ever
    /// deletes paths under Root, and that is checked rather than assumed.
    ///
    /// The launcher cannot delete the folder it is running from, so the last
    /// step hands a small script to cmd, which waits for this process to exit
    /// and then finishes the job.
    /// </summary>
    static class Uninstall
    {
        /// <summary>
        /// Refuses anything that does not look like one of our installs. A
        /// wrong Root here would be a very bad afternoon, and the check costs
        /// nothing.
        /// </summary>
        public static string WhyNot()
        {
            string root = Paths.Root;
            if (string.IsNullOrEmpty(root)) return "The install folder is not set.";
            if (!Directory.Exists(root)) return "The install folder is already gone.";

            try
            {
                var di = new DirectoryInfo(root);
                if (di.Parent == null) return "The install folder is a drive root, which this will not touch.";
            }
            catch { return "The install folder could not be read."; }

            // Under the collection Paths.Game is the Steam copy of Skyrim,
            // which exists on every machine that can run any of this, so it
            // proves nothing about Root and must not be what this check looks
            // at. Profile and Launcher are ours either way.
            bool looksRight = Directory.Exists(Paths.ProfileDir) || Directory.Exists(Paths.LauncherDir)
                              || (!Paths.Collection && Directory.Exists(Paths.Game));
            if (!looksRight)
                return "That folder does not contain a Launcher or Profile folder, so it is not this build.";

            // Somebody pointing Root at their Steam library would be the one
            // mistake worth refusing outright.
            string steam = Environment.GetEnvironmentVariable("ProgramFiles(x86)");
            if (!string.IsNullOrEmpty(steam) &&
                root.StartsWith(Path.Combine(steam, "Steam"), StringComparison.OrdinalIgnoreCase))
                return "That is inside your Steam folder. This will not remove it.";

            return null;
        }

        /// <summary>
        /// The scratch folder the setup program unpacks into, which nothing
        /// has ever deleted.
        ///
        /// The installer makes Thornswood-setup at the root of whichever drive
        /// the install is going to, unzips the whole payload into it, and runs
        /// Setup.bat out of it. Setup moves the mods from there into the game,
        /// so the big part empties, but the folder, the scripts and a copy of
        /// the launcher stay behind for good. It is not under Root, so the
        /// fence in Finish correctly refuses to touch it, and it has been
        /// sitting on every machine that has ever run this. That is most of
        /// the difference somebody sees when they uninstall and the disk does
        /// not go back to where it was.
        ///
        /// Found by looking rather than remembered, because an install can be
        /// moved and the scratch stays on the drive it was made on.
        /// </summary>
        public static string[] Scratch()
        {
            var found = new System.Collections.Generic.List<string>();
            var seen  = new System.Collections.Generic.List<string>();
            var roots = new System.Collections.Generic.List<string>();

            try { roots.Add(Path.GetPathRoot(Paths.Root)); } catch (Exception ex) { Swallow.Note("Uninstall.Scratch, path root", ex); }
            try { roots.Add(Path.GetTempPath()); } catch (Exception ex) { Swallow.Note("Uninstall.Scratch, temp path", ex); }
            try
            {
                foreach (DriveInfo d in DriveInfo.GetDrives())
                {
                    try { if (d.DriveType == DriveType.Fixed && d.IsReady) roots.Add(d.RootDirectory.FullName); }
                    catch (Exception ex) { Swallow.Note("Uninstall.Scratch, drive ready", ex); }
                }
            }
            catch (Exception ex) { Swallow.Note("Uninstall.Scratch, listing drives", ex); }

            foreach (string r in roots)
            {
                if (string.IsNullOrEmpty(r)) continue;
                string full;
                try { full = Path.GetFullPath(Path.Combine(r, "Thornswood-setup")); }
                catch { continue; }

                // Belt and braces before a recursive delete: whatever the path
                // in front of it turned out to be, the last element has to be
                // exactly that name.
                if (!string.Equals(Path.GetFileName(full.TrimEnd('\\')), "Thornswood-setup",
                                   StringComparison.OrdinalIgnoreCase)) continue;
                string key = full.ToLowerInvariant();
                if (seen.Contains(key)) continue;
                seen.Add(key);
                if (Directory.Exists(full)) found.Add(full);
            }
            return found.ToArray();
        }

        /// <summary>
        /// Removes them, and says how much that got back. Safe to call on a
        /// working install at any time: once setup has run, nothing in there
        /// is ever read again.
        /// </summary>
        /// <summary>
        /// A recursive delete that stops at junctions instead of walking
        /// through them.
        ///
        /// Directory.Delete(path, true) on .NET Framework follows a reparse
        /// point and deletes what is on the far side of it. This build makes
        /// junctions at Windows' own Skyrim folders pointing into Profile, so
        /// one junction anywhere under a folder being cleared is the whole
        /// install, or somebody's saves, going with it. Measure already refuses
        /// to walk them for exactly this reason and a delete is the half where
        /// it actually costs something.
        ///
        /// A junction found here has the link removed and its target left
        /// alone, which is what deleting a shortcut should mean.
        /// </summary>
        static void DeleteTree(string dir)
        {
            foreach (string sub in Directory.GetDirectories(dir))
            {
                bool link = false;
                try { link = (new DirectoryInfo(sub).Attributes & FileAttributes.ReparsePoint) != 0; }
                catch { link = true; }   // unreadable is treated as do not enter

                if (link) { try { Directory.Delete(sub, false); } catch (Exception ex) { Swallow.Note("Uninstall.DeleteTree, delete dir", ex); } }
                else DeleteTree(sub);
            }
            foreach (string f in Directory.GetFiles(dir))
            {
                try { File.SetAttributes(f, FileAttributes.Normal); } catch (Exception ex) { Swallow.Note("Uninstall.DeleteTree, attributes", ex); }
                try { File.Delete(f); } catch (Exception ex) { Swallow.Note("Uninstall.DeleteTree, delete", ex); }
            }
            Directory.Delete(dir, false);
        }

        /// <summary>
        /// Removes them, and says how much that got back. Safe to call on a
        /// working install at any time: once setup has run, nothing in there
        /// is ever read again.
        /// </summary>
        public static long DropScratch(Action<string> say)
        {
            long freed = 0;
            foreach (string dir in Scratch())
            {
                // Never step into one that is itself a link to somewhere else.
                try
                {
                    if ((new DirectoryInfo(dir).Attributes & FileAttributes.ReparsePoint) != 0)
                    {
                        try { Directory.Delete(dir, false); } catch (Exception ex) { Swallow.Note("Uninstall.DropScratch, delete dir", ex); }
                        continue;
                    }
                }
                catch { continue; }

                int n = 0;
                long bytes = Measure(dir, ref n);
                try
                {
                    DeleteTree(dir);
                    freed += bytes;
                    if (say != null) say("Removed the setup leftovers in " + dir + ".");
                }
                catch (Exception ex)
                {
                    if (say != null)
                        say("Could not remove " + dir + ": " + ex.Message +
                            "  Nothing uses that folder, so it is safe to delete by hand.");
                }
            }
            return freed;
        }

        public static long Measure(string dir, ref int files)
        {
            long total = 0;
            try
            {
                foreach (string f in Directory.GetFiles(dir)) { try { total += new FileInfo(f).Length; files++; } catch (Exception ex) { Swallow.Note("Uninstall.Measure, file length", ex); } }
                foreach (string d in Directory.GetDirectories(dir))
                {
                    // Never walk through a junction while measuring either.
                    try { if ((new DirectoryInfo(d).Attributes & FileAttributes.ReparsePoint) != 0) continue; } catch { continue; }
                    total += Measure(d, ref files);
                }
            }
            catch (Exception ex) { Swallow.Note("Uninstall.Measure", ex); }
            return total;
        }

        /// <summary>
        /// The files a collection install put into the person's own Skyrim, and
        /// how many bytes they come to.
        ///
        /// Setup-Thornswood.ps1 writes the list at install time. Nothing is
        /// guessed from what happens to be in the game folder, because most of
        /// what is in there belongs to Bethesda or to Vortex, and the one thing
        /// this must never do is delete either.
        /// </summary>
        public static string[] OurGameFiles(Config cfg, out long bytes, out int count)
        {
            bytes = 0; count = 0;
            var outp = new System.Collections.Generic.List<string>();
            string into = InstalledInto(cfg);
            if (into.Length == 0) return outp.ToArray();

            string list = Path.Combine(Paths.ProfileDir, "installed-into-game.txt");
            if (!File.Exists(list)) return outp.ToArray();

            // Anything Vortex is deploying is the collection's, whatever our
            // own list says. A mod that happens to ship a file at a path we
            // also wrote would otherwise be taken out from under it.
            //
            // Read through OwnGame, which knows both of Vortex's records: the
            // one under Data and the one in the game's root. The root record is
            // where the script extender's loader and its dlls are listed, so
            // reading only the Data one counted those as ours and offered to
            // delete files that belong to a mod.
            System.Collections.Generic.HashSet<string> vortex;
            try { vortex = OwnGame.DeployedIn(into); }
            catch { vortex = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase); }

            string game;
            try { game = Path.GetFullPath(into).TrimEnd('\\') + "\\"; }
            catch { return outp.ToArray(); }

            foreach (string raw in File.ReadAllLines(list))
            {
                string rel = (raw ?? "").Trim();
                if (rel.Length == 0) continue;
                if (vortex.Contains(rel)) continue;

                string full;
                try { full = Path.GetFullPath(Path.Combine(into, rel)); }
                catch { continue; }
                // A relative path with .. in it would escape the game folder.
                if (!full.StartsWith(game, StringComparison.OrdinalIgnoreCase)) continue;
                if (!File.Exists(full)) continue;

                try { bytes += new FileInfo(full).Length; } catch (Exception ex) { Swallow.Note("Uninstall.OurGameFiles, file length", ex); }
                count++;
                outp.Add(full);
            }
            return outp.ToArray();
        }

        /// <summary>
        /// Deletes those files and then any folder under the game that our own
        /// removal left empty. Runs in process rather than in the handover
        /// script, because the script's last fence refuses anything outside
        /// Root and that fence is worth keeping exactly as it is.
        /// </summary>
        /// <summary>
        /// The Skyrim the installer wrote into. Under the collection that is the
        /// Steam copy. With Thornswood's own folder (OwnGame) it is the Steam
        /// copy the folder was made from: an install that did not choose the
        /// folder in the setup window put its files in there before the folder
        /// existed, and the first start after the folder is made takes them
        /// back out (OwnGame.CleanSteamCopy, #1226), which empties the list.
        /// One that chose it wrote nothing there and has no list. Empty for an
        /// install that never wrote into a Steam copy at all, which is an own
        /// Game folder from an installer older than the collection. Not
        /// Paths.Game under the collection: with the folder chosen and not
        /// made yet that is Profile\Payload.
        /// </summary>
        static string InstalledInto(Config cfg)
        {
            if (Paths.Collection) return Paths.SteamCopy;
            try
            {
                if (OwnGame.Active) return OwnGame.Source(cfg);
            }
            catch (Exception ex) { Swallow.Note("Uninstall.InstalledInto, OwnGame source", ex); }
            return "";
        }

        static int RemoveOurGameFiles(Config cfg, Action<string> say)
        {
            long bytes; int count;
            string[] ours = OurGameFiles(cfg, out bytes, out count);
            if (ours.Length == 0) return 0;

            say("Taking Thornswood's files back out of your Skyrim...");
            var dirs = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int gone = 0;
            foreach (string f in ours)
            {
                try
                {
                    string d = Path.GetDirectoryName(f);
                    File.SetAttributes(f, FileAttributes.Normal);
                    File.Delete(f);
                    gone++;
                    if (!string.IsNullOrEmpty(d)) dirs.Add(d);
                }
                catch (Exception ex) { Swallow.Note("Uninstall.RemoveOurGameFiles", ex); }
            }

            // Deepest first, so a folder that only held other empty folders goes
            // too. Never recursive, never forced: a directory with anything left
            // in it stays, which is what keeps this away from Vortex's files.
            string game;
            try { game = Path.GetFullPath(InstalledInto(cfg)).TrimEnd('\\') + "\\"; }
            catch { return gone; }
            var ordered = new System.Collections.Generic.List<string>(dirs);
            ordered.Sort(delegate(string a, string b) { return b.Length.CompareTo(a.Length); });
            foreach (string d in ordered)
            {
                string cur = d;
                while (!string.IsNullOrEmpty(cur) &&
                       cur.StartsWith(game, StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        if (Directory.GetFileSystemEntries(cur).Length != 0) break;
                        Directory.Delete(cur, false);
                        cur = Path.GetDirectoryName(cur);
                    }
                    catch { break; }
                }
            }
            return gone;
        }

        static void Kill()
        {
            try { Checks.CloseGame(); } catch (Exception ex) { Swallow.Note("Uninstall.Kill, process", ex); }
        }

        /// <summary>
        /// Every shortcut to this launcher, the pinned taskbar copy and the one
        /// in the install folder among them (Icons.Drop, #3205). A pin left
        /// behind keeps its name, and the next install's pin becomes
        /// "Thornswood (2)".
        /// </summary>
        static void DropShortcuts()
        {
            try { Icons.Drop(Icons.Exe); } catch (Exception ex) { Swallow.Note("Uninstall.DropShortcuts", ex); }
        }

        /// <summary>
        /// Everything that can be done from inside a running launcher. Returns
        /// what is left for the handover script, or an empty array if nothing
        /// is.
        /// </summary>
        public static string[] Begin(Config cfg, bool keepSaves, bool deleteMods, Action<string> say)
        {
            say("Closing the game...");
            Kill();

            // Hold still has our files open, and Keep has other servers'
            // plugins moved into Profile\Parked. Moved, not copied. With saves
            // not kept, Profile is one of the folders this hands to the
            // removal script, so uninstalling while the game was up took
            // somebody else's plugin with it and left that launcher with
            // nothing to put back. Both calls are safe whether or not the game
            // ever ran, and neither throws.
            Hold.Release();
            int back = Keep.Unpark();
            if (back > 0)
                say(back + (back == 1 ? " plugin" : " plugins") + " from another server or build put back.");

            say("Putting the Windows Skyrim folders back...");
            Swap.Restore();

            // Refusing to continue while a junction is still live is the whole
            // safety property of this. Better a failed uninstall than a deleted
            // saves folder.
            foreach (string win in new[] { Paths.WinMyGames, Paths.WinLocalAD })
            {
                try
                {
                    if (Directory.Exists(win) &&
                        (new DirectoryInfo(win).Attributes & FileAttributes.ReparsePoint) != 0)
                    {
                        throw new Exception(
                            "Windows' Skyrim folder is still redirected at this build:\n\n    " + win +
                            "\n\nNothing has been removed. Close Skyrim, press Scan and then Fix on Diagnostics, which puts it back, and try again.");
                    }
                }
                catch (Exception ex) { if (ex.Message.StartsWith("Windows'")) throw; }
            }

            // A leftover backup folder means the person's own My Games or
            // LocalAppData is still parked beside where Windows looks for it
            // and Restore could not put it back. Taking this build away now
            // would remove the launcher that knows about that folder and leave
            // them with a name nothing reads. Better a failed uninstall.
            foreach (string win in new[] { Paths.WinMyGames, Paths.WinLocalAD })
            {
                string bak = win + ".st-backup";
                if (Directory.Exists(bak))
                {
                    throw new Exception(
                        "Your own Skyrim folder is still set aside at:\n\n    " + bak +
                        "\n\nNothing has been removed. Close Skyrim, press Scan and then Fix on Diagnostics, which puts it back, and try again. " +
                        "If it still will not go back, move what is in that folder into\n\n    " + win +
                        "\n\nyourself, delete the empty one it came from, and run this again.");
                }
            }

            say("Removing the shortcut...");
            DropShortcuts();

            // And the entry in Windows Settings, Installed apps. Before the
            // files go, so a half finished uninstall never leaves a listing
            // whose uninstall button points at a launcher that is not there.
            Register.Forget();

            say("Clearing the setup leftovers...");
            DropScratch(say);

            // A collection install has no Game folder of ours, but it did write
            // our own content into the person's Steam copy. That comes back out
            // here, from the list the installer left, and nothing else in that
            // folder is touched. The same for an install that began that way
            // and then made Thornswood's own folder: the folder goes with the
            // rest in Targets, and what the installer left in the Steam copy
            // goes here.
            if (deleteMods && InstalledInto(cfg).Length > 0)
            {
                int gone = RemoveOurGameFiles(cfg, say);
                if (gone > 0) say(gone.ToString("n0") + " files removed from your Skyrim on Steam.");
            }

            return Targets(keepSaves, deleteMods);
        }

        /// <summary>
        /// What the handover script deletes once the launcher has exited, and
        /// nothing else: Begin has done everything that needs the launcher
        /// running by the time this is asked. Deletes nothing itself, so
        /// launcher\tests\test-3679-local-keep.ps1 runs it against a scratch install.
        /// </summary>
        public static string[] Targets(bool keepSaves, bool deleteMods)
        {
            var leave = new System.Collections.Generic.List<string>();

            // The Game folder is only ours to delete in an install that built
            // one. Under the collection Paths.Game is the Skyrim the person
            // owns on Steam, and the mods in it are Vortex's hardlinks. Adding
            // it here would hand rmdir /s /q their entire game, so it is not
            // added, whatever the box said. Purge Mods in Vortex is what takes
            // the mods out, and the launcher says so on the uninstall page.
            // With the own folder chosen and not made yet, Paths.Game is
            // Profile\Payload, Thornswood's own files under Root, and it goes
            // with the mods even when the saves in Profile stay (#1226).
            if (deleteMods && (!Paths.Collection || Paths.OwnFirst)) leave.Add(Paths.Game);

            leave.Add(Paths.Personal);
            if (!keepSaves)
            {
                leave.Add(Paths.ProfileDir);
                leave.Add(Paths.CfgFile);
            }
            else
            {
                // The box keeps saves and settings, and Profile holds more
                // than those: the log, the Discord sign-in with the name and
                // picture beside it, the support zips and the music's old
                // browser folder. Keeping all of Profile kept them on the PC
                // under a box that named none of them (#3679). They go here,
                // and the farewell names any that are still there.
                leave.AddRange(LocalKeep.NotSaves());
            }
            // The rest of what setup and updating left in the install folder.
            //
            // Finish already tries to remove the install folder itself when
            // both boxes say delete, and it only works on an empty one so that
            // anything a person put there by hand survives. It has never once
            // succeeded, because these sit beside the folders above and nothing
            // took them out: _dist alone was 1.5 GB of downloaded packs and the
            // setup exe on the machine this was found on. So a full uninstall
            // said it was done and left the folder there with most of a
            // download still in it.
            //
            // _dist is pure leftovers; DropScratch's own note says nothing in
            // there is ever read again once setup has run. tools is the handful
            // of scripts shipped beside the launcher. The shortcut in the
            // install folder went with the others in DropShortcuts.
            //
            // _quarantine is deliberately NOT here. It holds files taken out of
            // somebody's game and set aside, another server's among them, and
            // those are not ours to destroy on the way out. It keeps the folder
            // from being empty, which is the right outcome: the folder staying
            // is how anybody finds out it is still holding something.
            leave.Add(Path.Combine(Paths.Root, "_dist"));
            leave.Add(Path.Combine(Paths.Root, "tools"));
            // The note on where the SkyMP source is. The install puts it here
            // (InstallSteps.cs), beside the folders above, so without this line the
            // install folder is never empty and the farewell calls our own
            // note "not Thornswood's".
            leave.Add(Path.Combine(Paths.Root, "SOURCE CODE.txt"));
            // The licence texts the install puts beside SOURCE CODE.txt: the GPL
            // and AGPL (issue #421) and the launcher's libraries' (#4823).
            foreach (string lic in InstallSteps.LicenceFiles) leave.Add(Path.Combine(Paths.Root, lic));
            // The libraries' licence texts SOURCE CODE.txt lists (issue #3099).
            leave.Add(Path.Combine(Paths.Root, "licences"));

            leave.Add(Paths.LauncherDir);
            return leave.ToArray();
        }

        /// <summary>
        /// Hands the rest to cmd and returns. The launcher has to be gone before
        /// its own folder can go, so this waits on the process id rather than
        /// guessing at a delay.
        /// </summary>
        public static void Finish(string[] targets, bool keepSaves, bool deleteMods)
        {
            // Said after the deletes in the script, so it reports what is
            // actually there rather than what was expected to be.
            string note = null;
            try { note = WriteFarewell(keepSaves, deleteMods); }
            catch (Exception ex) { Swallow.Note("Uninstall.Finish, farewell", ex); }

            string text = Script(targets, Process.GetCurrentProcess().Id, note);
            if (text == null)
            {
                try { if (note != null) File.Delete(note); } catch (Exception ex) { Swallow.Note("Uninstall.Finish, clearing the unused farewell", ex); }
                return;
            }

            string script = Path.Combine(Path.GetTempPath(), "thornswood-uninstall.cmd");
            // UTF-8 with no byte order mark, to match the chcp at the top. The
            // machine's ANSI code page cannot hold every path this may name.
            File.WriteAllText(script, text, new UTF8Encoding(false));

            var psi = new ProcessStartInfo("cmd.exe", "/c \"" + script + "\"");
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            psi.WorkingDirectory = Path.GetTempPath();
            Process.Start(psi);
        }

        /// <summary>
        /// The handover script's text: wait for process waitFor to exit, delete
        /// the targets that are under Root, then run the farewell note, when
        /// there is one. Null when Root cannot be fenced, and then nothing is
        /// deleted at all.
        /// </summary>
        public static string Script(string[] targets, int waitFor, string note)
        {
            var sb = new StringBuilder();
            sb.AppendLine("@echo off");
            // cmd reads a .cmd file in the console's OEM code page, not in the
            // one the file was written in. A user name or an install path with
            // any character outside ASCII reached rmdir and del as different
            // bytes, they matched nothing, and the uninstall said it was done
            // having removed none of it. The script goes out as UTF-8 below,
            // and this tells cmd to read it that way.
            sb.AppendLine("chcp 65001 >nul");
            sb.AppendLine("setlocal");
            sb.AppendLine(":wait");
            sb.AppendLine("tasklist /fi \"PID eq " + waitFor + "\" | find \"" + waitFor + "\" >nul 2>&1");
            sb.AppendLine("if not errorlevel 1 ( timeout /t 1 /nobreak >nul & goto wait )");

            // Last fence. Everything this script deletes has to live under
            // Root. Every caller already gets that right; this is here so that
            // one wrong path in a list somewhere can never turn into rmdir /s
            // /q pointed at somebody's game or their documents.
            string root;
            try { root = Path.GetFullPath(Paths.Root).TrimEnd('\\') + "\\"; }
            catch { return null; }
            if (root.Length < 4) return null;

            foreach (string t in targets)
            {
                if (string.IsNullOrEmpty(t)) continue;
                string full;
                try { full = Path.GetFullPath(t); }
                catch { continue; }
                if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                sb.AppendLine("rmdir /s /q \"" + full + "\" 2>nul");
                sb.AppendLine("del /f /q \"" + full + "\" 2>nul");
            }

            // An empty _quarantine is just a folder with a worrying name.
            //
            // Its contents are never deleted: they came out of somebody's game,
            // another server's among them. But once whatever was in it has been
            // put back or taken away, the folder itself is nothing. rmdir
            // without /s refuses a folder with anything at all in it, so this
            // takes the empty one and cannot touch the other.
            sb.AppendLine("rmdir \"" + Path.Combine(Paths.Root, "_quarantine") + "\" 2>nul");

            // Then the install folder, on the same rule and for the same
            // reason. It used to be tried only when both boxes said delete,
            // which missed the case where somebody kept nothing but the folder
            // still had to go. rmdir refuses a folder that is not empty, so
            // trying it always is safe: anything left keeps it, which is the
            // point, and an install that really did remove everything no longer
            // leaves an empty Thornswood behind.
            sb.AppendLine("rmdir \"" + Paths.Root + "\" 2>nul");

            // Last, say what survived and why.
            if (note != null)
            {
                sb.AppendLine("powershell -NoProfile -ExecutionPolicy Bypass -File \"" + note + "\" >nul 2>&1");
                sb.AppendLine("del /f /q \"" + note + "\" >nul 2>&1");
            }

            sb.AppendLine("del /f /q \"%~f0\" >nul 2>&1");
            return sb.ToString();
        }
        /// <summary>
        /// The note that comes up once everything has been deleted, listing what
        /// is still in the install folder and why.
        ///
        /// Written as its own PowerShell file rather than squeezed into the cmd,
        /// because the message has quotes and newlines in it and cmd's quoting
        /// rules are how the last three bugs in this file happened.
        ///
        /// It runs after the deletes, so it reports what actually survived
        /// rather than what was predicted. If the folder went, it says nothing
        /// at all: a person whose uninstall left nothing behind does not need a
        /// box telling them so.
        /// </summary>
        public static string WriteFarewell(bool keepSaves, bool deleteMods)
        {
            var ps = new StringBuilder();
            ps.AppendLine("$ErrorActionPreference = 'SilentlyContinue'");
            ps.AppendLine("$root = " + PsQuote(Paths.Root));
            ps.AppendLine("if (-not (Test-Path -LiteralPath $root)) { exit 0 }");
            ps.AppendLine("$left = @(Get-ChildItem -LiteralPath $root -Force | Select-Object -First 40)");
            ps.AppendLine("if (-not $left) { Remove-Item -LiteralPath $root -Force; exit 0 }");
            ps.AppendLine();

            // One reason per thing that can still be there. Anything not named
            // here was not put there by Thornswood, which is itself the reason.
            ps.AppendLine("$why = @{}");
            ps.AppendLine("$why['_quarantine'] = 'files taken out of your game and set aside, another server''s among them. Not ours to delete.'");
            if (!deleteMods)
                ps.AppendLine("$why['Game'] = 'Thornswood''s copy of the game. You chose to keep it, so a reinstall can reuse it.'");
            if (keepSaves)
            {
                ps.AppendLine("$why['Profile'] = 'your characters, saves and settings, and the launcher''s record of what it installed. You chose to keep them.'");
                ps.AppendLine("$why['config.json'] = 'your settings. You chose to keep them.'");
            }
            ps.AppendLine();

            // What the script was told to take out of a kept Profile and could
            // not (a browser still closing, a file held open). Named one by one,
            // because "your saves and settings" would be wrong about each of
            // them (#3679).
            ps.AppendLine("$stuck = @()");
            if (keepSaves)
            {
                foreach (string p in LocalKeep.NotSaves())
                    ps.AppendLine("if (Test-Path -LiteralPath " + PsQuote(p) + ") { $stuck += '  ' + " + PsQuote(p) + " }");
            }
            ps.AppendLine();

            ps.AppendLine("$lines = foreach ($e in $left) {");
            ps.AppendLine("  $r = $why[$e.Name]");
            ps.AppendLine("  if (-not $r) { $r = 'not Thornswood''s, so it was left alone.' }");
            ps.AppendLine("  '  ' + $e.Name + '  -  ' + $r");
            ps.AppendLine("}");
            ps.AppendLine();

            ps.AppendLine("$msg = \"Thornswood is uninstalled.`r`n`r`nThis was left at\" + \"`r`n`r`n    \" + $root + \"`r`n`r`n\" + ($lines -join \"`r`n\") + \"`r`n`r`nDelete that folder yourself once you are done with them.\"");
            ps.AppendLine("if ($stuck) { $msg += \"`r`n`r`nThese are not saves or settings and should have gone, but could not be removed. Delete them yourself:`r`n`r`n\" + ($stuck -join \"`r`n\") }");
            ps.AppendLine("Add-Type -AssemblyName System.Windows.Forms");
            ps.AppendLine("[void][System.Windows.Forms.MessageBox]::Show($msg, 'Thornswood', 'OK', 'Information')");

            string note = Path.Combine(Path.GetTempPath(), "thornswood-farewell.ps1");
            File.WriteAllText(note, ps.ToString(), new UTF8Encoding(false));
            return note;
        }

        /// <summary>A path as a PowerShell single quoted string.</summary>
        static string PsQuote(string s)
        {
            return "'" + (s == null ? "" : s.Replace("'", "''")) + "'";
        }

    }
}
