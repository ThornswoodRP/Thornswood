using System;
using System.IO;

namespace Thornswood
{
    // Everything the launcher touches, resolved once from the exe location.
    static class Paths
    {
        public static string Root, Game, LauncherDir, ProfileDir, MyGames, LocalAD, Golden, Personal;
        // Where another server's files go when they are moved aside. Never deleted.
        public static string Isolated;
        // Where a plugin goes, whole, before Fix writes the server's copy over it.
        public static string Replaced;
        public static string StateFile, PlayedFile, CfgFile, AppliedFile, LogFile;
        // One file per installed optional pack, listing what it put on disk.
        public static string PacksDir;
        public static string WinMyGames, WinLocalAD;

        // Where Skyrim really reads its plugin list and settings from for this
        // install. Two answers, because there are two kinds of install.
        public static string Live, LiveMyGames;

        /// <summary>
        /// True when the mods come from the Nexus collection, deployed by
        /// Vortex into the person's own Skyrim, rather than from a copy of the
        /// game this launcher installed for itself.
        ///
        /// Decided by looking, not by a setting. An install made before 1.1
        /// has its own Game folder sitting next to the launcher and keeps
        /// working exactly as it did. A fresh install has no such folder,
        /// because the installer stopped shipping one, so the game is the
        /// Steam copy and the mods are Vortex's.
        ///
        /// Anything that behaves differently between the two reads this, and
        /// nothing else has to know which kind of install it is in.
        /// </summary>
        public static bool Collection;

        /// <summary>
        /// The Steam copy of Skyrim Special Edition, or "" when Steam lists none.
        /// Read for the game's build and what Vortex deployed there; the
        /// launcher writes into it only when it is also Game.
        /// </summary>
        public static string SteamCopy;

        /// <summary>
        /// Profile\Payload: Thornswood's own game files while its own folder is
        /// chosen and not made yet (#1226). The installer lays its payload here
        /// instead of into the Steam copy when the own folder is ticked, and
        /// OwnGame.Make takes it into Root\Game and removes it.
        /// </summary>
        public static string Payload;

        /// <summary>
        /// The own folder was chosen at install and is not made yet (#1226).
        /// Then Game is Payload rather than the Steam copy, so nothing the
        /// launcher writes before the folder exists (the client settings,
        /// Thornswood.ini, packs, Keep, the client runtime) reaches the Steam
        /// copy, by where Game points and not by each writer remembering to
        /// look. Collection stays true: there is no folder to play from yet.
        ///
        /// Patrick, 29 Sep: "it should only do that if you choose own folder
        /// during install; otherwise it still uses Steam's copy until you
        /// turn own game folder on later". So without Payload an install with
        /// no folder of its own is what it always was: Game is the Steam copy,
        /// and turning the folder on later takes Thornswood's files back out
        /// of it once the folder is made (OwnGame.CleanSteamCopy).
        /// </summary>
        public static bool OwnFirst;

        public static void Init(string rootOverride)
        {
            // The exe's own path: a native build has no assembly file of its
            // own, so Assembly.Location is empty there (#4823).
            string exeDir = Path.GetDirectoryName(Environment.ProcessPath);
            Root = string.IsNullOrEmpty(rootOverride) ? Path.GetDirectoryName(exeDir) : rootOverride;

            string own = Path.Combine(Root, "Game");
            string steam = "";
            try { steam = Steam.SkyrimPath(); } catch (Exception ex) { Swallow.Note("Paths.Init, Steam.SkyrimPath", ex); }
            SteamCopy = steam ?? "";

            // The launcher's own copy wins whenever it is there, so an upgrade
            // never moves somebody's game out from under them mid-session.
            // Only an install that has no copy of its own goes to Steam, and
            // not even that one when its own folder was chosen at install: its
            // files wait in Payload until the folder is made.
            Payload     = Path.Combine(Root, "Profile\\Payload");
            Collection  = !Directory.Exists(own) && !string.IsNullOrEmpty(steam);
            OwnFirst    = Collection && Directory.Exists(Payload);
            Game        = !Collection ? own : OwnFirst ? Payload : steam;
            LauncherDir = Path.Combine(Root, "Launcher");
            ProfileDir  = Path.Combine(Root, "Profile");
            MyGames     = Path.Combine(ProfileDir, "MyGames");
            LocalAD     = Path.Combine(ProfileDir, "LocalAppData");
            Golden      = Path.Combine(ProfileDir, "Default");
            Personal    = Path.Combine(Root, "Your Mods");
            Isolated    = Path.Combine(ProfileDir, "Isolated");
            Replaced    = Path.Combine(ProfileDir, "Replaced");
            StateFile   = Path.Combine(ProfileDir, "swap.json");
            PlayedFile  = Path.Combine(ProfileDir, "played.flag");
            AppliedFile = Path.Combine(ProfileDir, "applied.txt");
            PacksDir    = Path.Combine(ProfileDir, "Packs");
            LogFile     = Path.Combine(ProfileDir, "launcher.log");
            CfgFile     = Path.Combine(Root, "config.json");

            WinMyGames = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "My Games\\Skyrim Special Edition");
            WinLocalAD = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Skyrim Special Edition");

            // Under the collection the launcher redirects nothing, so the live
            // files are the Windows ones and Vortex's active profile is what
            // writes them. In an older install they are the redirected copies
            // under Profile, which is what the junction points at.
            Live        = Collection ? WinLocalAD : LocalAD;
            LiveMyGames = Collection ? WinMyGames : MyGames;
        }

        // SkyMP has no client executable of its own. MpClientPlugin.dll is an
        // SKSE plugin, so the game is started by the script extender's loader
        // exactly as a single player session would be, and the multiplayer
        // layer comes up inside it.
        public static string Loader { get { return Path.Combine(Game, "skse64_loader.exe"); } }

        // What to look for to decide the multiplayer layer is actually
        // installed. Used by the status checks rather than by anything that
        // launches.
        public static string MpClient
        {
            get { return Path.Combine(Game, "Data\\SKSE\\Plugins\\MpClientPlugin.dll"); }
        }
        public static string Exe { get { return Path.Combine(Game, "SkyrimSE.exe"); } }

        /// <summary>
        /// The Skyrim the facts about the game are read from: its exe, the
        /// script extender beside it and the plugins Vortex deployed. Game,
        /// except while the own folder is chosen and not made (OwnFirst,
        /// #1226): Game is then Profile\Payload, Thornswood's own files only,
        /// and the game the folder will be made from is the Steam copy's, which
        /// Checks.All reads too. For reading only, never a path to write to,
        /// which is why Exe, Loader and MpClient stay under Game (#1235).
        /// </summary>
        public static string Skyrim { get { return OwnFirst ? SteamCopy : Game; } }
        public static string SkyrimExe { get { return Path.Combine(Skyrim, "SkyrimSE.exe"); } }

        /// <summary>
        /// The script extender plugin folders the game's plugins are read
        /// from: Skyrim's, and Game's when that is another folder, since while
        /// OwnFirst Thornswood's own plugins wait in Payload and the rest are
        /// what Vortex deployed into the Steam copy (#1235).
        /// </summary>
        public static string[] SksePluginDirs
        {
            get
            {
                string skyrim = Path.Combine(Skyrim, "Data\\SKSE\\Plugins");
                string game = Path.Combine(Game, "Data\\SKSE\\Plugins");
                if (string.Equals(skyrim, game, StringComparison.OrdinalIgnoreCase)) return new string[] { game };
                return new string[] { skyrim, game };
            }
        }
    }
}
