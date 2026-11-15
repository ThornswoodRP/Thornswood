using System;
using System.Collections.Generic;
using System.IO;

namespace Thornswood
{
    /// <summary>
    /// Puts the files Thornswood makes from the person's own game into the
    /// game folder (#2827): the main menu with no Bethesda logo, the notice
    /// board's and drop box's meshes, and the collection's item menus and HUD
    /// with no gold values (#3113). FromGame.cs says why they are made here
    /// and not shipped, and makes them; this decides when, and writes them.
    ///
    /// Before every Play (ShellPlay, beside Thornswood.ini) and from Fix
    /// (Upkeep), only for a file that is missing or not the bytes Thornswood
    /// makes: a game folder that has them right is read and left as it is.
    /// The archives are read from Paths.Skyrim, the game the facts are read
    /// from, and the files go to Paths.Game.
    ///
    /// A game whose files differ from the ones the recipes were written
    /// against (another Skyrim build, archives a mod replaced, or another
    /// version of SkyUI, SkyHUD or moreHUD than the collection's) makes
    /// nothing, and the line says which file differs. Nothing stands in for a
    /// file that could not be made: the game shows its own menu, the boards
    /// have no mesh and the mods' menus show gold values until the game and
    /// the collection are the ones Thornswood pins, and Scan says so.
    ///
    /// Each file is written beside its place and moved in. The name in the
    /// game folder is taken off first, whatever the layout: in an own folder
    /// it may be a link into the Steam copy, and under the collection into
    /// Vortex's staging, and a write through either would change that copy
    /// too (OwnGame.Detach says why).
    ///
    /// THORNSWOOD-LAST.ESP, the same way, from the person's own plugins
    /// (#2791, LastPlugin.cs). It is made only when the release put its recipe,
    /// Data\Thornswood-Last.recipe, into the game folder, and from the
    /// plugins and string tables of Paths.Game's Data, where Vortex deployed
    /// the collection, because they are what the game loads. A collection of
    /// another revision makes nothing, and the line names the plugin that
    /// differs. It is never fetched from the server instead (Verify).
    /// </summary>
    static class MadeFromGame
    {
        /// <summary>The files, under the game folder, that are missing or not the bytes Thornswood makes.</summary>
        public static List<string> OutOfDate()
        {
            var l = new List<string>();
            foreach (string rel in FromGame.Files) if (!FromGame.IsCurrent(Paths.Game, rel)) l.Add(rel);
            if (LastPlugin.HasRecipe(Paths.Game) && !LastPlugin.IsCurrent(Paths.Game)) l.Add(LastPlugin.File);
            return l;
        }

        /// <summary>
        /// Makes them from this machine's game, without writing anything.
        /// Thornswood-Last.esp only when <paramref name="rels"/> names it: it
        /// reads every plugin of the load order, which takes seconds.
        /// </summary>
        public static List<FromGameFile> Make(List<string> rels)
        {
            List<FromGameFile> l = FromGame.Build(Path.Combine(Paths.Skyrim, "Data"));
            if (rels.Contains(LastPlugin.File)) l.Add(MakeLast());
            return l;
        }

        static FromGameFile MakeLast()
        {
            var f = new FromGameFile { Rel = LastPlugin.File, Expected = LastPlugin.Expected(Paths.Game) };
            try { f.Bytes = LastPlugin.Make(Paths.Game); f.Sha256 = f.Expected; }
            catch (LastPlugin.CannotMake ex) { f.Problem = Failure.Why("MadeFromGame, the last plugin", ex); f.NotEnglish = ex.NotEnglish; }
            catch (IOException ex) { f.Problem = "a plugin could not be read (" + Failure.Why("MadeFromGame, reading a plugin", ex) + ")"; }
            catch (UnauthorizedAccessException ex) { f.Problem = "a plugin could not be read (" + Failure.Why("MadeFromGame, reading a plugin", ex) + ")"; }
            return f;
        }

        /// <summary>
        /// Makes and writes whichever is out of date. Returns a line for the
        /// log, or null when all of them were already right.
        /// Throws when a made file cannot be written.
        /// </summary>
        public static string Ensure()
        {
            List<string> off = OutOfDate();
            if (off.Count == 0) return null;
            var wrote = new List<string>();
            var not = new List<string>();
            foreach (FromGameFile f in Make(off))
            {
                if (!off.Contains(f.Rel)) continue;
                if (f.Problem != null) { not.Add(Path.GetFileName(f.Rel) + ": " + f.Problem.TrimEnd('.')); continue; }
                Write(Path.Combine(Paths.Game, f.Rel), f.Bytes);
                wrote.Add(Path.GetFileName(f.Rel));
            }
            var said = new List<string>();
            if (wrote.Count > 0) said.Add("Made " + string.Join(", ", wrote.ToArray()) + " from your game's own files.");
            if (not.Count > 0)
                said.Add("Could not make " + string.Join("; ", not.ToArray()) + ". Until that is put right " + Shows(off) + ".");
            return string.Join(" ", said.ToArray());
        }

        /// <summary>Whether the file is one of the collection's mods' menus rather than one of the game's.</summary>
        public static bool FromMod(string rel)
        {
            foreach (MenuRecipe m in MenuRecipe.Mods) if (rel.Equals(m.Path, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>What the game shows while these files are not made, as a clause.</summary>
        public static string Shows(List<string> rels)
        {
            bool menu = false, board = false, mods = false, last = false;
            foreach (string rel in rels)
            {
                if (rel.Equals(FromGame.MenuFile, StringComparison.OrdinalIgnoreCase)) menu = true;
                else if (rel.Equals(LastPlugin.File, StringComparison.OrdinalIgnoreCase)) last = true;
                else if (FromMod(rel)) mods = true;
                else board = true;
            }
            var l = new List<string>();
            if (menu) l.Add("the game shows its own main menu");
            if (board) l.Add("the notice boards have no mesh");
            if (mods) l.Add("the item menus and the line under an item you look at still show gold values");
            if (last) l.Add("the game's plugins are not the server's, because " + LastPlugin.Name + " is not the one this release makes");
            if (l.Count == 1) return l[0];
            return string.Join(", ", l.GetRange(0, l.Count - 1).ToArray()) + " and " + l[l.Count - 1];
        }

        static void Write(string dest, byte[] bytes)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            string next = dest + ".thornswood-new";
            File.WriteAllBytes(next, bytes);
            if (File.Exists(dest)) OwnGame.DropName(dest);
            File.Move(next, dest);
        }
    }
}
