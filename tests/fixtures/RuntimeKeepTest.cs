using System;
using System.IO;

namespace Thornswood
{
    // Environment only. The two classes under test are compiled unmodified.
    static class Paths { public static string Game, ProfileDir, PacksDir, Isolated; }
    class Config { }
    // The installed launcher's package folder, where Heal takes the six
    // client files from since the update feed went (#5608).
    static class Updater { public static string InstalledGame; }
    static class OwnGame { public static void Unshare(string path) { } }
    static class Swallow { public static void Note(string where, Exception error) { throw new Exception(where, error); } }

    class RuntimeKeepTest
    {
        const string Rel = "Data\\Platform\\Plugins\\skymp5-client.js";
        const string Good = "recorded client";
        static int failures, checks, scenario;
        static string root, live, kept;
        static void Put(string path, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, text, new System.Text.UTF8Encoding(false));
        }
        static void Fresh(string oldLive, string oldKept, bool developer)
        {
            string install = Path.Combine(root, (++scenario).ToString());
            Paths.Game = Path.Combine(install, "Game");
            Paths.ProfileDir = Path.Combine(install, "Profile");
            Paths.PacksDir = Path.Combine(Paths.ProfileDir, "Packs");
            Paths.Isolated = Path.Combine(Paths.ProfileDir, "Isolated");
            Directory.CreateDirectory(Paths.Game);
            live = Path.Combine(Paths.Game, Rel); kept = Path.Combine(Keep.Dir, Rel);
            if (oldLive != null) Put(live, oldLive);
            if (oldKept != null) Put(kept, oldKept);
            if (developer) Put(Path.Combine(Paths.ProfileDir, "developer.flag"), "");
        }
        static void Check(string label, bool ok)
        {
            checks++; if (!ok) failures++;
            Console.WriteLine((ok ? "PASS " : "FAIL ") + label);
        }
        static string Read(string path) { return File.Exists(path) ? File.ReadAllText(path) : null; }
        static void Asset(string text)
        {
            Updater.InstalledGame = Path.Combine(Paths.ProfileDir, "package", "Game");
            Put(Path.Combine(Updater.InstalledGame, Rel), text);
        }
        public static int Main(string[] args)
        {
            root = args[0];
            Check("embedded runtime fixture is parsed", ClientRuntime.Recorded().Count == 1);
            Fresh(Good, "previous client", false);
            Keep.Restore();
            Check("startup preserves the installed recorded client", Read(live) == Good);
            Check("startup migrates stale retained bytes from verified live", Read(kept) == Good);
            Keep.Restore();
            Check("repeated Play restore cannot undo migration", Read(live) == Good);

            Fresh("previous client", "previous client", false);
            Keep.Restore();
            Check("equal stale copies still require runtime repair", !ClientRuntime.Good());
            Asset(Good);
            Check("runtime repair from the installed package reports the restored file", ClientRuntime.Heal(new Config(), null) == 1);
            Check("runtime repair installs recorded bytes", Read(live) == Good);
            Check("runtime repair refreshes retained bytes", Read(kept) == Good);
            Keep.Restore();
            Check("Play after runtime repair retains recorded bytes", Read(live) == Good && ClientRuntime.Good());

            Fresh(null, "previous client", false);
            Keep.Restore();
            Check("stale retention cannot resurrect a missing runtime", !File.Exists(live));
            Fresh("other server", Good, false);
            Keep.Restore();
            Check("valid retained runtime restores another server's copy", Read(live) == Good);
            Fresh("other server", Good, true);
            File.SetLastWriteTimeUtc(kept, DateTime.UtcNow.AddMinutes(-5));
            Keep.Restore();
            Check("developer timestamp cannot adopt unrecorded runtime", Read(live) == Good && Read(kept) == Good);

            Fresh("previous client", "previous client", false);
            Asset("unrecorded client");
            Check("a package copy that is not the recorded build cannot count as a successful repair", ClientRuntime.Heal(new Config(), null) == 0);
            Check("wrong asset is not adopted into retention", Read(kept) == "previous client" && !ClientRuntime.Good());
            Keep.Restore();
            Check("stale retention cannot overwrite a rejected asset either", Read(live) == "unrecorded client");

            Fresh(null, null, false);
            string ui = "Data\\Platform\\UI\\index.html";
            Put(Path.Combine(Keep.Dir, ui), "our page"); Put(Path.Combine(Paths.Game, ui), "foreign page");
            Keep.Restore();
            Check("ordinary UI restoration remains intact", Read(Path.Combine(Paths.Game, ui)) == "our page");

            // #2627: Scan asks Changed, which writes nothing, and Fix runs
            // PutBack, which is Restore without the parking.
            Fresh(null, null, false);
            Put(Path.Combine(Keep.Dir, ui), "our page"); Put(Path.Combine(Paths.Game, ui), "foreign page");
            string other = Path.Combine(Paths.Game, "Data\\Platform\\Plugins\\other-server.js");
            Put(other, "theirs");
            var changed = Keep.Changed();
            Check("Changed names the kept page another server changed", changed.Count == 1 && changed[0] == ui);
            Check("and writes nothing", Read(Path.Combine(Paths.Game, ui)) == "foreign page" && File.Exists(other));
            Check("PutBack puts it back and says so", Keep.PutBack() != null && Read(Path.Combine(Paths.Game, ui)) == "our page");
            Check("and parks nothing: parking is for a session", File.Exists(other) && !Directory.Exists(Keep.ParkDir));
            Check("then nothing is changed any more", Keep.Changed().Count == 0 && Keep.PutBack() == null);

            // Simulate a missing or unreadable resource after parser coverage.
            var record = typeof(ClientRuntime).GetField("recorded", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
            record.SetValue(null, new System.Collections.Generic.List<ClientRuntime.Entry>());
            Fresh(Good, "previous client", false);
            Keep.Restore();
            Check("missing build record cannot authorize stale restoration", Read(live) == Good && Read(kept) == "previous client");
            Fresh("other server", Good, true);
            File.SetLastWriteTimeUtc(kept, DateTime.UtcNow.AddMinutes(-5));
            Keep.Restore();
            Check("missing record cannot authorize developer adoption", Read(live) == "other server" && Read(kept) == Good);
            record.SetValue(null, new System.Collections.Generic.List<ClientRuntime.Entry> {
                new ClientRuntime.Entry { Rel = "Data\\SKSE\\Plugins\\SkyrimPlatform.dll", Sha = new string('a', 64), Bytes = 1 }
            });
            Fresh(Good, "previous client", false);
            Keep.Restore();
            Check("a partial record cannot authorize stale restoration", Read(live) == Good && Read(kept) == "previous client");
            Console.WriteLine(checks + " checks, " + failures + " failures");
            return failures == 0 ? 0 : 1;
        }
    }
}
