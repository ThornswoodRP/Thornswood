// NexusLayout.cs
//
// The install half of Install-NexusRevision.ps1 (#2754): what Vortex does with
// one revision of a collection, from collection.json and the mods' archives to
// the files it deploys, without Vortex. Compiled by the script with Add-Type,
// so it needs PowerShell 7 (System.Text.Json, the same .NET as the runner).
//
// Every rule here was read in Vortex at 2e29b16d (Nexus-Mods/Vortex, 20 Oct)
// and in the FOMOD installer it runs, @nexusmods/fomod-installer-native 0.13.4
// (Nexus-Mods/fomod-installer at af3c835). The file names below are where.
// The code is written here from that reading; none of it is copied.
//
//   WHICH INSTALLER. Vortex tries its installers by priority and takes the
//   first that says yes (InstallManager.getInstaller). For Skyrim SE that is:
//     a hashes list   collections pass the entry's hashes as a file list, and
//                     the list installer copies each listed md5 to its path
//                     (mod_management/listInstaller.tsx)
//     0  nested .fomod  not done here: it stops
//     10 FOMOD script   fomod\ModuleConfig.xml, run with the entry's choices
//                       and no dialog (installer_fomod_native, XmlScriptExecutor)
//     10 script extender  skse64_loader.exe (extensions/script-extender-installer)
//     50 dinput8.dll    (extensions/modtype-dinput)
//     100 FOMOD basic   everything, cut at the first stop pattern (Installer.cs
//                       BasicModInstall, ArchiveStructure.FindPathPrefix)
//   Both FOMOD kinds then drop a leading Data\ from every destination
//   (Installer.cs, "pluginPath").
//
//   THE FILE LIST every installer sees is Vortex's walk of the unpacked
//   archive (InstallManager buildFileList, util/walk.ts): a folder's own
//   entries first in the order the disk gives them, folders with a trailing
//   separator, then each subfolder in turn. The stop patterns pick the first
//   matching path in that order, so the order is kept.
//
//   PATCHES. A patched entry's file is put through bsdiff after it is
//   installed, only when its CRC-32 is the one recorded
//   (collections/util/binaryPatching.ts applyPatches). Vortex skips a patch
//   whose CRC differs and says nothing; this stops instead, because the file
//   it would deploy is then not the curator's.
//
//   DEPLOYMENT. A mod's files go to Data, or to the game folder for the
//   dinput type. Where two mods have a file, the one later in the order the
//   mod rules give wins (mod_management/util/sort.ts, graphlib topsort). Where
//   no rule orders two mods that share a file, Vortex's pick depends on its
//   own state, so this stops and names them. meta.ini and the other names on
//   DEPLOY_BLACKLIST are never deployed (mod_management/constants.ts).
//
//   FOMOD CONDITIONS on plugins are answered from the game's own plugins
//   (records\skyrim-files.json), all active, as a new Vortex profile sees them
//   while a collection installs: nothing of the collection is deployed until
//   its phase ends. The game version is that record's build.
//
//   OFF WINDOWS (#2969). Every path inside a mod is kept the way Vortex has it
//   on Windows, joined with \ and compared ignoring case, and the string work
//   on those paths (WinPath) follows .NET on Windows, so a layout worked out
//   in a Linux cloud session is the one worked out on One. Only where a path
//   meets the disk does the platform show: the walk sorts each folder's
//   entries as NTFS lists them, takes two folders whose names differ only in
//   case as the one folder Windows would have made, named by the archive's
//   first entry for it as 7-Zip on Windows names it, and stops on two files
//   that would be one file on Windows; a \ inside a name that 7-Zip kept is
//   made the folders Windows makes of it (SplitBackslashNames); a path is
//   found on disk ignoring case (OnDisk); and a link is link(2) instead of
//   CreateHardLink.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Thornswood.Layout
{
    // ------------------------------------------------------------ the record ---

    public sealed class PresetChoice { public string Name; public long Idx; }
    public sealed class PresetGroup { public string Name; public List<PresetChoice> Choices = new List<PresetChoice>(); }
    public sealed class PresetStep { public string Name; public List<PresetGroup> Groups = new List<PresetGroup>(); }

    public sealed class HashItem { public string Path; public string Md5; }

    public sealed class Ref
    {
        public string FileMD5, LogicalFileName, FileExpression, VersionMatch;
        public string Say()
        {
            if (!string.IsNullOrEmpty(LogicalFileName)) return LogicalFileName;
            if (!string.IsNullOrEmpty(FileExpression)) return FileExpression;
            return "md5 " + FileMD5;
        }
    }

    public sealed class ModRule { public string Type; public Ref Source; public Ref Reference; }

    public sealed class Entry
    {
        public int Index;
        public string Name, Version, Domain, SourceType, Md5, LogicalFilename, FileExpression, Type;
        public bool Optional;
        public long ModId, FileId, Size;
        public int Phase;
        public List<HashItem> Hashes = new List<HashItem>();
        public string ChoicesType;
        public List<PresetStep> Choices;
        public List<KeyValuePair<string, string>> Patches = new List<KeyValuePair<string, string>>();
        public bool FileOverrides, Instructions;
        public string Say() { return Name + " (mod " + ModId + ", file " + FileId + ")"; }
    }

    public sealed class Plugin { public string Name; public bool Enabled; }
    public sealed class PluginRule { public string Name; public List<string> After = new List<string>(); public List<string> Other = new List<string>(); }

    public sealed class Collection
    {
        public string Name, Author, Domain;
        public List<string> GameVersions = new List<string>();
        public List<Entry> Entries = new List<Entry>();
        public List<ModRule> Rules = new List<ModRule>();
        public List<Plugin> Plugins = new List<Plugin>();
        public bool PluginsListed;
        public List<PluginRule> PluginRules = new List<PluginRule>();
        public int PluginGroups;
        public List<string> Odd = new List<string>();
    }

    // ------------------------------------------------------------- the plan ---

    public sealed class Copy
    {
        public string Source;       // relative to the unpacked archive
        public string Destination;  // as the installer wrote it
        public Copy(string s, string d) { Source = s; Destination = d; }
    }

    public sealed class ModPlan
    {
        public Entry Entry;
        public string Installer = "";
        public string SetModType;
        public List<Copy> Copies = new List<Copy>();
        public List<string> Warnings = new List<string>();
        public string Stop;
        // destination key (lower case, \) -> the file the mod deploys there
        public Dictionary<string, Staged> Files = new Dictionary<string, Staged>(StringComparer.Ordinal);
    }

    public sealed class Staged
    {
        public string Rel;      // relative to the mod's own folder, as Vortex names it
        public string Full;     // the file on disk that holds its bytes
        public string Patched;  // set when a patch made it
    }

    public sealed class Placed
    {
        public string Rel;      // relative to the game folder: Data\... or a root file
        public string Full;
        public int Entry;
        public long Size;
        public string Sha256;
        public List<int> Over = new List<int>();   // entries whose copy of the path lost
    }

    public static class NexusLayout
    {
        // --------------------------------------------------- collection.json ---

        static string Str(JsonElement o, string name)
        {
            JsonElement v;
            if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out v)) return null;
            if (v.ValueKind == JsonValueKind.String) return v.GetString();
            if (v.ValueKind == JsonValueKind.Number) return v.GetRawText();
            if (v.ValueKind == JsonValueKind.True) return "true";
            if (v.ValueKind == JsonValueKind.False) return "false";
            return null;
        }
        static long Num(JsonElement o, string name)
        {
            string s = Str(o, name);
            long n;
            return s != null && long.TryParse(s, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out n) ? n : 0;
        }
        static bool Has(JsonElement o, string name, out JsonElement v)
        {
            v = default(JsonElement);
            return o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out v) && v.ValueKind != JsonValueKind.Null && v.ValueKind != JsonValueKind.Undefined;
        }
        static bool NotEmpty(JsonElement o, string name)
        {
            JsonElement v;
            if (!Has(o, name, out v)) return false;
            if (v.ValueKind == JsonValueKind.Array) return v.GetArrayLength() > 0;
            if (v.ValueKind == JsonValueKind.Object) return v.EnumerateObject().Any();
            if (v.ValueKind == JsonValueKind.String) return v.GetString().Length > 0;
            return v.ValueKind != JsonValueKind.False;
        }
        static Ref ReadRef(JsonElement o)
        {
            return new Ref { FileMD5 = Str(o, "fileMD5"), LogicalFileName = Str(o, "logicalFileName"), FileExpression = Str(o, "fileExpression"), VersionMatch = Str(o, "versionMatch") };
        }

        public static Collection ReadCollection(string path)
        {
            var c = new Collection();
            using (var doc = JsonDocument.Parse(File.ReadAllBytes(path), new JsonDocumentOptions { AllowTrailingCommas = false }))
            {
                JsonElement root = doc.RootElement, info, mods, v;
                if (!Has(root, "info", out info) || !Has(root, "mods", out mods) || mods.ValueKind != JsonValueKind.Array)
                    throw new InvalidDataException(path + " has no info and mods, so it is not a collection.json Vortex wrote.");
                c.Name = Str(info, "name"); c.Author = Str(info, "author"); c.Domain = Str(info, "domainName");
                if (Has(info, "gameVersions", out v) && v.ValueKind == JsonValueKind.Array)
                    foreach (var g in v.EnumerateArray()) if (g.ValueKind == JsonValueKind.String) c.GameVersions.Add(g.GetString());
                int i = 0;
                foreach (var m in mods.EnumerateArray())
                {
                    var e = new Entry { Index = i++ };
                    e.Name = Str(m, "name"); e.Version = Str(m, "version"); e.Domain = Str(m, "domainName");
                    e.Optional = Str(m, "optional") == "true";
                    e.Phase = (int)Num(m, "phase");
                    JsonElement src, det;
                    if (Has(m, "source", out src))
                    {
                        e.SourceType = Str(src, "type"); e.ModId = Num(src, "modId"); e.FileId = Num(src, "fileId");
                        e.Md5 = (Str(src, "md5") ?? "").ToLowerInvariant(); e.Size = Num(src, "fileSize");
                        e.LogicalFilename = Str(src, "logicalFilename"); e.FileExpression = Str(src, "fileExpression");
                    }
                    e.Type = Has(m, "details", out det) ? (Str(det, "type") ?? "") : "";
                    if (Has(m, "hashes", out v) && v.ValueKind == JsonValueKind.Array)
                        foreach (var h in v.EnumerateArray()) e.Hashes.Add(new HashItem { Path = Str(h, "path"), Md5 = Str(h, "md5") });
                    if (Has(m, "choices", out v) && v.ValueKind == JsonValueKind.Object)
                    {
                        e.ChoicesType = Str(v, "type");
                        JsonElement opts;
                        if (Has(v, "options", out opts) && opts.ValueKind == JsonValueKind.Array)
                        {
                            e.Choices = new List<PresetStep>();
                            foreach (var st in opts.EnumerateArray())
                            {
                                var ps = new PresetStep { Name = Str(st, "name") ?? "" };
                                JsonElement gs;
                                if (Has(st, "groups", out gs) && gs.ValueKind == JsonValueKind.Array)
                                    foreach (var g in gs.EnumerateArray())
                                    {
                                        var pg = new PresetGroup { Name = Str(g, "name") ?? "" };
                                        JsonElement cs;
                                        if (Has(g, "choices", out cs) && cs.ValueKind == JsonValueKind.Array)
                                            foreach (var ch in cs.EnumerateArray()) pg.Choices.Add(new PresetChoice { Name = Str(ch, "name") ?? "", Idx = Num(ch, "idx") });
                                        ps.Groups.Add(pg);
                                    }
                                e.Choices.Add(ps);
                            }
                        }
                    }
                    if (Has(m, "patches", out v) && v.ValueKind == JsonValueKind.Object)
                        foreach (var p in v.EnumerateObject()) e.Patches.Add(new KeyValuePair<string, string>(p.Name, p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.GetRawText()));
                    e.FileOverrides = NotEmpty(m, "fileOverrides");
                    e.Instructions = NotEmpty(m, "instructions");
                    c.Entries.Add(e);
                }
                if (Has(root, "modRules", out v) && v.ValueKind == JsonValueKind.Array)
                    foreach (var r in v.EnumerateArray())
                    {
                        JsonElement s, rf;
                        c.Rules.Add(new ModRule { Type = Str(r, "type"), Source = Has(r, "source", out s) ? ReadRef(s) : new Ref(), Reference = Has(r, "reference", out rf) ? ReadRef(rf) : new Ref() });
                    }
                if (Has(root, "plugins", out v) && v.ValueKind == JsonValueKind.Array)
                {
                    c.PluginsListed = true;
                    foreach (var p in v.EnumerateArray()) c.Plugins.Add(new Plugin { Name = Str(p, "name"), Enabled = Str(p, "enabled") != "false" });
                }
                JsonElement pr;
                if (Has(root, "pluginRules", out pr))
                {
                    if (Has(pr, "plugins", out v) && v.ValueKind == JsonValueKind.Array)
                        foreach (var p in v.EnumerateArray())
                        {
                            var rule = new PluginRule { Name = Str(p, "name") };
                            foreach (var prop in p.EnumerateObject())
                            {
                                if (prop.Name == "name") continue;
                                if (prop.Name == "after" && prop.Value.ValueKind == JsonValueKind.Array)
                                {
                                    foreach (var a in prop.Value.EnumerateArray())
                                        rule.After.Add(a.ValueKind == JsonValueKind.String ? a.GetString() : Str(a, "name"));
                                    continue;
                                }
                                rule.Other.Add(prop.Name);
                            }
                            c.PluginRules.Add(rule);
                        }
                    if (Has(pr, "groups", out v) && v.ValueKind == JsonValueKind.Array) c.PluginGroups = v.GetArrayLength();
                }
                foreach (var prop in root.EnumerateObject())
                    if (!new[] { "info", "mods", "modRules", "tools", "plugins", "pluginRules", "collectionConfig" }.Contains(prop.Name)) c.Odd.Add(prop.Name);
            }
            return c;
        }

        // What in a collection this does not lay out the way Vortex would, before
        // anything is downloaded. Empty means every entry is a kind done here.
        public static List<string> Unsupported(Collection c, string domain)
        {
            var no = new List<string>();
            if (!string.Equals(c.Domain, domain, StringComparison.Ordinal)) no.Add("the collection is for " + c.Domain + ", not " + domain);
            foreach (var k in c.Odd) no.Add("collection.json has a \"" + k + "\" section, which Vortex at 2e29b16d does not write");
            var md5s = new Dictionary<string, Entry>(StringComparer.Ordinal);
            foreach (var e in c.Entries)
            {
                if (e.SourceType != "nexus") no.Add(e.Name + ": its source is " + (e.SourceType ?? "not given") + ", and only Nexus mods are downloaded here");
                if (e.Optional) no.Add(e.Say() + " is optional, and Vortex asks which optional mods to install");
                if (e.Phase != 0) no.Add(e.Say() + " is in phase " + e.Phase + "; Vortex deploys between phases, which changes what a later installer sees");
                if (e.FileOverrides) no.Add(e.Say() + " has fileOverrides");
                if (e.Instructions) no.Add(e.Say() + " has instructions for the person installing it");
                if (!string.Equals(e.Domain, c.Domain, StringComparison.Ordinal)) no.Add(e.Say() + " is for " + e.Domain);
                if (e.Type != "" && e.Type != "dinput") no.Add(e.Say() + " is mod type \"" + e.Type + "\", which is not deployed here");
                if (e.ChoicesType != null && e.ChoicesType != "fomod") no.Add(e.Say() + " has installer choices of type " + e.ChoicesType);
                if (e.ChoicesType == "fomod" && e.Choices == null) no.Add(e.Say() + " has FOMOD choices with no options list");
                if (e.Hashes.Count > 0 && e.Choices != null) no.Add(e.Say() + " has both hashes and choices");
                foreach (var h in e.Hashes)
                    if (string.IsNullOrEmpty(h.Md5) || string.IsNullOrEmpty(h.Path)) { no.Add(e.Say() + " has a hashes item without a path and an md5 (an xxh64 list is not done here)"); break; }
                if (!Regex.IsMatch(e.Md5 ?? "", "^[0-9a-f]{32}$") || e.Size <= 0 || e.FileId <= 0 || e.ModId <= 0) no.Add(e.Say() + " does not give a file id, an md5 and a size to check the archive against");
                Entry was;
                if (!string.IsNullOrEmpty(e.Md5) && md5s.TryGetValue(e.Md5, out was)) no.Add(e.Say() + " and " + was.Say() + " are the same archive");
                else if (!string.IsNullOrEmpty(e.Md5)) md5s[e.Md5] = e;
            }
            foreach (var r in c.Rules)
            {
                if (r.Type != "before" && r.Type != "after" && r.Type != "conflicts")
                {
                    no.Add("a mod rule of type " + r.Type + " (" + r.Source.Say() + ", " + r.Reference.Say() + ")");
                    continue;
                }
                string why;
                Entry s = Match(c, r.Source, out why);
                if (why != null) { no.Add(why); continue; }
                Entry t = Match(c, r.Reference, out why);
                if (why != null) { no.Add(why); continue; }
                if (r.Type == "conflicts" && s != null && t != null) no.Add(s.Say() + " has a conflicts rule against " + t.Say() + ", which are both in the collection");
            }
            if (c.PluginGroups > 0) no.Add("pluginRules has " + c.PluginGroups + " LOOT groups, and LOOT's group order is not done here");
            foreach (var p in c.PluginRules)
                if (p.Other.Count > 0) no.Add("the plugin rule for " + p.Name + " has " + string.Join(", ", p.Other) + ", and only after is checked here");
            if (!c.PluginsListed) no.Add("collection.json has no plugins list, so there is no order to write");
            return no;
        }

        // The entry a rule's reference names, by its archive's md5. A reference
        // that names a mod only by its file name could match the way
        // testModReference does, with version ranges, which is not done here, so
        // it is said rather than guessed. A reference to nothing in the
        // collection matches nothing, as in Vortex.
        static Entry Match(Collection c, Ref r, out string why)
        {
            why = null;
            if (!string.IsNullOrEmpty(r.FileMD5))
            {
                var hit = c.Entries.FirstOrDefault(e => string.Equals(e.Md5, r.FileMD5, StringComparison.OrdinalIgnoreCase));
                if (hit != null) return hit;
            }
            foreach (var e in c.Entries)
            {
                if ((!string.IsNullOrEmpty(r.LogicalFileName) && r.LogicalFileName == e.LogicalFilename) ||
                    (!string.IsNullOrEmpty(r.FileExpression) && r.FileExpression == e.FileExpression))
                {
                    why = "a mod rule names " + e.Say() + " by its name and version (" + (r.VersionMatch ?? "any") + ") rather than by the archive the collection lists";
                    return null;
                }
            }
            return null;
        }

        // ------------------------------------------------------- the file list ---

        // Vortex's buildFileList over an unpacked archive: each folder's own
        // entries in the order the disk lists them, folders with a trailing \,
        // then every subfolder the same way, one after another.
        public static List<string> FileList(string dir) { return FileList(dir, null); }

        // archiveOrder is the archive's paths in the order 7-Zip lists them,
        // which is the order it unpacks them in. Off Windows it says which
        // letter case a folder gets when the archive names it more than one
        // way: on Windows the first entry that makes the folder names it, and
        // every later entry goes into it as it is. Measured 21 Oct on
        // Immersive Armours' CBBE 3BA BodySlide file (461940): its folder
        // entry meshes/ comes first and twelve files under Meshes/armor/
        // later, and One's layout holds all 362 meshes under Data\meshes.
        public static List<string> FileList(string dir, string[] archiveOrder)
        {
            var list = new List<string>();
            var index = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            Walk(new List<string> { dir }, "", list, index, FirstCasing(archiveOrder));
            lock (Indexes) Indexes[Path.GetFullPath(dir)] = index;
            return list;
        }

        // Each folder path in the archive (any case, \ between folders) and
        // the name its first entry gives the last folder in it. A \ inside a
        // name is a folder break here, as SplitBackslashNames makes it.
        static Dictionary<string, string> FirstCasing(string[] archiveOrder)
        {
            if (archiveOrder == null || OperatingSystem.IsWindows()) return null;
            var first = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var path in archiveOrder)
            {
                var parts = (path ?? "").Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries);
                string prefix = "";
                foreach (var part in parts)
                {
                    prefix += part;
                    if (!first.ContainsKey(prefix)) first[prefix] = part;
                    prefix += "\\";
                }
            }
            return first;
        }
        // One folder of the walk, as Windows would hold it. On Windows that is
        // one folder on disk, listed in the disk's order. Off Windows it is
        // every folder on disk whose name differs only in case (7-Zip on Linux
        // makes Textures and textures as two, where Windows makes one), named
        // as the archive's first entry names it (FileList's archiveOrder), and
        // their entries are sorted as NTFS lists them: by name ignoring case.
        static void Walk(List<string> dirs, string relPrefix, List<string> list, Dictionary<string, string> index, Dictionary<string, string> firstCasing)
        {
            var entries = new List<KeyValuePair<string, string>>();
            foreach (var d in dirs)
                foreach (var p in Directory.EnumerateFileSystemEntries(d))
                    entries.Add(new KeyValuePair<string, string>(Path.GetFileName(p), p));
            if (!OperatingSystem.IsWindows())
                entries = entries.OrderBy(e => e.Key, StringComparer.OrdinalIgnoreCase).ThenBy(e => e.Key, StringComparer.Ordinal).ToList();
            var subs = new List<KeyValuePair<string, List<string>>>();
            var seen = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            foreach (var e in entries)
            {
                if (e.Key.IndexOf('\\') >= 0) throw new InvalidDataException("the archive unpacked a name with a \\ in it, " + relPrefix + e.Key + ", which SplitBackslashNames was not run on");
                bool isDir = (File.GetAttributes(e.Value) & FileAttributes.Directory) != 0;
                bool wasDir;
                if (seen.TryGetValue(e.Key, out wasDir))
                {
                    if (!isDir || !wasDir) throw new InvalidDataException("the archive holds " + relPrefix + e.Key + " twice, differing only in case, and on Windows one would have overwritten the other");
                    subs.First(x => string.Equals(x.Key, relPrefix + e.Key + "\\", StringComparison.OrdinalIgnoreCase)).Value.Add(e.Value);
                    continue;
                }
                seen[e.Key] = isDir;
                string name = e.Key, named;
                if (isDir && firstCasing != null && firstCasing.TryGetValue(relPrefix + e.Key, out named)) name = named;
                string rel = relPrefix + name;
                if (isDir) { list.Add(rel + "\\"); subs.Add(new KeyValuePair<string, List<string>>(rel + "\\", new List<string> { e.Value })); }
                else { list.Add(rel); index[rel] = e.Value; }
            }
            foreach (var s in subs) Walk(s.Value, s.Key, list, index, firstCasing);
        }

        // A zip made on Windows can keep \ between its folders. 7-Zip on Windows
        // makes folders of it; off Windows it keeps the \ inside one name
        // (measured 21 Oct on Skyrim Priority SE AE, file 355110, whose
        // Data\SKSE\Plugins\PriorityMod.dll came out as one file). So off
        // Windows each such name is moved to the folders Windows would have
        // made, deepest first, before the walk; a name that would land on one
        // already there stops, as on Windows one would overwrite the other.
        // Returns how many names were moved.
        public static int SplitBackslashNames(string dir)
        {
            if (OperatingSystem.IsWindows()) return 0;
            var odd = Directory.EnumerateFileSystemEntries(dir, "*", SearchOption.AllDirectories)
                .Where(p => Path.GetFileName(p).IndexOf('\\') >= 0).OrderByDescending(p => p.Length).ToList();
            foreach (var p in odd)
            {
                var parts = Path.GetFileName(p).Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
                string target = Path.Combine(new[] { Path.GetDirectoryName(p) }.Concat(parts).ToArray());
                if (parts.Length == 0 || File.Exists(target) || Directory.Exists(target))
                    throw new InvalidDataException("the archive holds " + p.Substring(dir.Length).TrimStart('/') + ", which Windows unpacks onto a name the archive already has");
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                if (Directory.Exists(p)) Directory.Move(p, target); else File.Move(p, target);
            }
            return odd.Count;
        }

        // Each walked folder's files by their path inside the mod, for OnDisk.
        static readonly Dictionary<string, Dictionary<string, string>> Indexes = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);

        // A file of the unpacked archive by its path inside the mod (\ or /,
        // any case), as Windows would find it. Off Windows the walk's index is
        // asked, so a FOMOD script naming Textures\x.dds finds textures/x.dds.
        public static string OnDisk(string unpacked, string rel)
        {
            string j = JoinRel(rel ?? "") ?? "";
            if (OperatingSystem.IsWindows()) return Path.Combine(unpacked, j);
            Dictionary<string, string> index;
            string full;
            lock (Indexes) Indexes.TryGetValue(Path.GetFullPath(unpacked), out index);
            if (index != null && index.TryGetValue(j, out full)) return full;
            return Path.Combine(unpacked, j.Replace('\\', '/'));
        }

        // Forgets a walked folder's index once its unpacked copy is gone.
        public static void Forget(string unpacked)
        {
            lock (Indexes) Indexes.Remove(Path.GetFullPath(unpacked));
        }

        // ------------------------------------------------------- installers ---

        static readonly string[] TopLevel = { "distantlod", "textures", "meshes", "music", "shaders", "video", "interface", "fonts", "scripts", "facegen", "menus", "lodsettings", "lsdata", "sound", "strings", "trees", "asi", "tools", "calientetools" };
        static string Word(string s) { return "(^|/)" + s + "(/|$)"; }
        // installer_fomod_shared/utils/gameSupport.ts, stopPatterns("skyrimse")
        public static readonly string[] StopPatterns = new[] { Word("fomod") }
            .Concat(new[] { "[^/]*\\.esp$", "[^/]*\\.esm$", "[^/]*\\.esl$", "[^/]*\\.bsa$", "[^/]*\\.ba2$", "fomod/ModuleConfig.xml$" })
            .Concat(TopLevel.Select(Word)).Concat(new[] { Word("skse") }).ToArray();

        // ArchiveStructure.FindPathPrefix: the first path in the list that any
        // pattern matches, cut where the match starts.
        public static string FindPathPrefix(IList<string> files, IList<string> patterns)
        {
            var skip = new Regex("^__MACOSX", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            var match = new Regex(string.Join("|", patterns), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            foreach (var f in files)
            {
                if (skip.IsMatch(f)) continue;
                var m = match.Match(f.Replace('\\', '/'));
                if (m.Success) return f.Substring(0, m.Index);
            }
            return "";
        }

        static bool IsDir(string f) { return f.EndsWith("\\", StringComparison.Ordinal); }
        static string Leaf(string f) { return WinPath.FileName(f.TrimEnd('\\')); }
        static string NodeDirname(string f)
        {
            int i = f.LastIndexOf('\\');
            return i < 0 ? "." : f.Substring(0, i);
        }

        // ModFormatManager.ScriptMatch: a file whose name holds the script's
        // name, in a folder whose name holds "fomod", both ignoring case.
        static bool ScriptMatch(string f, string script)
        {
            if (IsDir(f)) return false;
            string parent = WinPath.FileName(WinPath.DirectoryName(f));
            return WinPath.FileName(f).IndexOf(script, StringComparison.OrdinalIgnoreCase) >= 0 && parent.IndexOf("fomod", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        public static ModPlan PlanMod(Entry e, string unpacked, List<string> files, Fomod.World world)
        {
            var plan = new ModPlan { Entry = e };
            if (e.Hashes.Count > 0)
            {
                plan.Installer = "list";
                var lookup = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var f in files)
                {
                    if (IsDir(f)) continue;
                    lookup[Md5Of(OnDisk(unpacked, f))] = f;
                }
                foreach (var h in e.Hashes)
                {
                    string src;
                    if (lookup.TryGetValue(h.Md5.ToLowerInvariant(), out src)) plan.Copies.Add(new Copy(src, h.Path));
                    else plan.Warnings.Add(h.Path + " (checksum: " + h.Md5 + ") missing");
                }
                return Finish(plan, unpacked);
            }
            Func<string, bool> fomodSegment = f => f.ToLowerInvariant().Split('\\').Contains("fomod");
            if (files.Any(f => !IsDir(f) && fomodSegment(f) && Leaf(f).Equals("script.cs", StringComparison.OrdinalIgnoreCase)))
            { plan.Stop = "its archive has a C# FOMOD script, which Vortex asks before it runs"; return plan; }
            if (files.Any(f => WinPath.Extension(f.TrimEnd('\\')) == ".fomod"))
            { plan.Stop = "its archive holds another .fomod archive, which Vortex installs as a nested mod"; return plan; }
            bool hasXml = files.Any(f => !IsDir(f) && fomodSegment(f) && (Leaf(f).Equals("moduleconfig.xml", StringComparison.OrdinalIgnoreCase) || Leaf(f).Equals("script.xml", StringComparison.OrdinalIgnoreCase)));
            string scriptXml = files.FirstOrDefault(f => ScriptMatch(f, "script.xml"));
            string moduleConfig = files.FirstOrDefault(f => ScriptMatch(f, "ModuleConfig.xml"));
            bool scripted = hasXml && (scriptXml != null || moduleConfig != null);
            bool skse = files.Any(f => !IsDir(f) && Leaf(f) == "skse64_loader.exe");
            if (scripted)
            {
                if (skse) { plan.Stop = "its archive has both a FOMOD script and skse64_loader.exe, two installers of the same priority"; return plan; }
                if (scriptXml != null) { plan.Stop = "its FOMOD script is " + scriptXml + ", an old script.xml, which is not done here"; return plan; }
                if (e.Choices == null) { plan.Stop = "its archive has a FOMOD script and the collection gives no choices for it, so Vortex would show its dialog"; return plan; }
                plan.Installer = "fomod";
                Fomod.Install(plan, unpacked, files, moduleConfig, world);
                if (plan.Stop != null) return plan;
                StripPluginPath(plan);
                return Finish(plan, unpacked);
            }
            if (skse)
            {
                plan.Installer = "script-extender";
                string se = files.First(f => !IsDir(f) && Leaf(f).Equals("skse64_loader.exe", StringComparison.OrdinalIgnoreCase));
                int idx = se.IndexOf(Leaf(se), StringComparison.Ordinal);
                string rootPath = NodeDirname(se);
                foreach (var f in files)
                    if (f.IndexOf(rootPath, StringComparison.Ordinal) != -1 && !IsDir(f)) plan.Copies.Add(new Copy(f, f.Substring(idx)));
                plan.SetModType = "dinput";
                return Finish(plan, unpacked);
            }
            string dinput = files.FirstOrDefault(f => !IsDir(f) && Leaf(f).ToLowerInvariant() == "dinput8.dll");
            if (dinput != null)
            {
                plan.Installer = "dinput";
                string basePath = NodeDirname(dinput);
                foreach (var f in files)
                    if (!IsDir(f) && (basePath == "." || f.StartsWith(basePath + "\\", StringComparison.Ordinal)))
                        plan.Copies.Add(new Copy(f, basePath == "." ? f : f.Substring(basePath.Length + 1)));
                return Finish(plan, unpacked);
            }
            if (files.Count == 0) { plan.Stop = "its archive is empty"; return plan; }
            plan.Installer = "basic";
            string prefix = FindPathPrefix(files, StopPatterns);
            foreach (var f in files)
            {
                if (IsDir(f)) continue;
                plan.Copies.Add(new Copy(f, f.StartsWith(prefix, StringComparison.Ordinal) ? f.Substring(prefix.Length) : f));
            }
            StripPluginPath(plan);
            return Finish(plan, unpacked);
        }

        static void StripPluginPath(ModPlan plan)
        {
            foreach (var c in plan.Copies)
                if (c.Destination.StartsWith("Data\\", StringComparison.OrdinalIgnoreCase)) c.Destination = c.Destination.Substring(5);
        }

        // path.join(destination, rel) as node does it on Windows: separators made
        // \, empty and . segments dropped, .. taken back. Null when it leaves.
        public static string JoinRel(string rel)
        {
            var parts = new List<string>();
            foreach (var p in rel.Replace('/', '\\').Split('\\'))
            {
                if (p.Length == 0 || p == ".") continue;
                if (p == "..") { if (parts.Count == 0) return null; parts.RemoveAt(parts.Count - 1); continue; }
                parts.Add(p);
            }
            return string.Join("\\", parts);
        }

        public static readonly Regex Blacklist = new Regex("(^|\\\\)(\\.git\\\\|_macosx\\\\|__macosx\\\\)|(^|\\\\)(\\.gitignore|\\.hgignore|\\.gitattributes|meta\\.ini|vortex_override_instructions\\.json)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        // InstallManager.extractArchive: directory copies skipped, the rest
        // sorted by destination length (a stable sort) and linked in that
        // order, a later link to a name already there replacing it.
        static ModPlan Finish(ModPlan plan, string unpacked)
        {
            var copies = plan.Copies.Where(c => !c.Source.EndsWith("\\", StringComparison.Ordinal) && !c.Source.EndsWith("/", StringComparison.Ordinal))
                .Select((c, i) => new { c, i }).OrderBy(x => x.c.Destination.Length).ThenBy(x => x.i).Select(x => x.c).ToList();
            foreach (var c in copies)
            {
                string rel = JoinRel(c.Destination);
                if (rel == null || rel.Length == 0) { plan.Stop = "its installer gives the destination \"" + c.Destination + "\", outside the mod's folder"; return plan; }
                string full = OnDisk(unpacked, c.Source);
                if (!File.Exists(full)) { plan.Warnings.Add("the installer named " + c.Source + ", which is not in the archive"); continue; }
                string key = rel.ToLowerInvariant();
                Staged was;
                if (plan.Files.TryGetValue(key, out was) && !string.Equals(was.Full, full, StringComparison.OrdinalIgnoreCase) && !SameBytes(was.Full, full))
                {
                    plan.Stop = "its installer puts two different files at " + rel + " (" + c.Source + " and another), and Vortex links them at the same time";
                    return plan;
                }
                // A later link to the same name removes the first and takes its
                // place, so the file's own name is the later one's.
                plan.Files[key] = new Staged { Rel = rel, Full = full };
            }
            return plan;
        }

        static bool SameBytes(string a, string b)
        {
            var fa = new FileInfo(a); var fb = new FileInfo(b);
            if (fa.Length != fb.Length) return false;
            return Sha256Of(a) == Sha256Of(b);
        }

        // ------------------------------------------------------------ patches ---

        public static string Crc32Of(string path)
        {
            uint[] table = new uint[256];
            for (uint i = 0; i < 256; i++) { uint c = i; for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320U ^ (c >> 1) : c >> 1; table[i] = c; }
            uint crc = 0xFFFFFFFFU;
            using (var fs = File.OpenRead(path))
            {
                var buf = new byte[1 << 20]; int n;
                while ((n = fs.Read(buf, 0, buf.Length)) > 0) for (int i = 0; i < n; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >> 8);
            }
            return (crc ^ 0xFFFFFFFFU).ToString("X8");
        }

        // BSDIFF40: a 32 byte header (magic, control length, diff length, new
        // size, each a sign-magnitude int64), then three bzip2 blocks. The
        // script unpacks the blocks with 7-Zip and gives them here.
        public static long[] BsdiffHeader(string patch)
        {
            var b = File.ReadAllBytes(patch);
            if (b.Length < 32 || Encoding.ASCII.GetString(b, 0, 8) != "BSDIFF40") throw new InvalidDataException(patch + " is not a BSDIFF40 patch.");
            return new[] { OffT(b, 8), OffT(b, 16), OffT(b, 24) };
        }
        static long OffT(byte[] b, int at)
        {
            long y = b[at + 7] & 0x7F;
            for (int i = 6; i >= 0; i--) y = y * 256 + b[at + i];
            if ((b[at + 7] & 0x80) != 0) y = -y;
            return y;
        }
        public static void BsdiffApply(string oldFile, byte[] ctrl, byte[] diff, byte[] extra, long newSize, string outFile)
        {
            byte[] old = File.ReadAllBytes(oldFile);
            byte[] nw = new byte[newSize];
            long oldPos = 0, newPos = 0; int ci = 0, di = 0, ei = 0;
            while (newPos < newSize)
            {
                if (ci + 24 > ctrl.Length) throw new InvalidDataException("the patch's control block ends early");
                long add = OffT(ctrl, ci), copy = OffT(ctrl, ci + 8), seek = OffT(ctrl, ci + 16); ci += 24;
                if (add < 0 || copy < 0 || newPos + add > newSize || di + add > diff.Length) throw new InvalidDataException("the patch is corrupt");
                for (long i = 0; i < add; i++)
                {
                    byte o = (oldPos + i >= 0 && oldPos + i < old.Length) ? old[oldPos + i] : (byte)0;
                    nw[newPos + i] = (byte)(diff[di + i] + o);
                }
                di += (int)add; newPos += add; oldPos += add;
                if (newPos + copy > newSize || ei + copy > extra.Length) throw new InvalidDataException("the patch is corrupt");
                Buffer.BlockCopy(extra, ei, nw, (int)newPos, (int)copy);
                ei += (int)copy; newPos += copy; oldPos += seek;
            }
            File.WriteAllBytes(outFile, nw);
        }

        // ------------------------------------------------------------ hashes ---

        public static string Md5Of(string path)
        {
            using (var md5 = MD5.Create()) using (var fs = File.OpenRead(path)) return Hex(md5.ComputeHash(fs));
        }
        public static string Sha256Of(string path)
        {
            using (var sha = SHA256.Create()) using (var fs = File.OpenRead(path)) return Hex(sha.ComputeHash(fs));
        }
        static string Hex(byte[] b) { var sb = new StringBuilder(b.Length * 2); foreach (var x in b) sb.Append(x.ToString("x2")); return sb.ToString(); }

        // ------------------------------------------------------- deployment ---

        // Before and after edges from the collection's mod rules, matched by
        // archive md5 (Unsupported has already refused the rest).
        public static List<int>[] Edges(Collection c)
        {
            var after = new List<int>[c.Entries.Count];   // after[i]: entries that must deploy before i
            for (int i = 0; i < after.Length; i++) after[i] = new List<int>();
            foreach (var r in c.Rules)
            {
                if (r.Type != "before" && r.Type != "after") continue;
                string why;
                var s = Match(c, r.Source, out why); var t = Match(c, r.Reference, out why);
                if (s == null || t == null) continue;
                if (r.Type == "before") after[t.Index].Add(s.Index); else after[s.Index].Add(t.Index);
            }
            return after;
        }

        // Every entry that has to deploy before i, through any chain of rules.
        public static HashSet<int>[] Before(List<int>[] after, out string cycle)
        {
            cycle = null;
            var all = new HashSet<int>[after.Length];
            var state = new int[after.Length];
            for (int i = 0; i < after.Length; i++) if (state[i] == 0) { Visit(i, after, all, state, ref cycle); if (cycle != null) return null; }
            return all;
        }
        static void Visit(int i, List<int>[] after, HashSet<int>[] all, int[] state, ref string cycle)
        {
            state[i] = 1;
            var set = new HashSet<int>();
            foreach (int j in after[i])
            {
                if (state[j] == 1) { cycle = j + " and " + i; return; }
                if (state[j] == 0) { Visit(j, after, all, state, ref cycle); if (cycle != null) return; }
                set.Add(j); set.UnionWith(all[j]);
            }
            all[i] = set; state[i] = 2;
        }

        // ------------------------------------------------------------- links ---

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateHardLink(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);
        [DllImport("libc", EntryPoint = "link", SetLastError = true)]
        static extern int Link(string oldpath, string newpath);

        // A file of its own at to: a hard link to from when they are on one
        // volume (the unpacked copy is deleted after, so the link is the only
        // name), otherwise a copy. Returns false for a copy.
        public static bool LinkOrCopy(string from, string to)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(to));
            if (OperatingSystem.IsWindows() ? CreateHardLink(@"\\?\" + to, @"\\?\" + from, IntPtr.Zero) : Link(from, to) == 0) return true;
            File.Copy(from, to, false);
            return false;
        }
    }

    // ------------------------------------------------------------ WinPath ---
    //
    // Path.Combine, GetFileName, GetDirectoryName and GetExtension as .NET
    // answers them on Windows, where Vortex and its FOMOD installer run: \ and
    // / both separate, a rooted second part replaces the first, and
    // GetDirectoryName gives \. On Linux .NET takes only /, so the same calls
    // on a mod's Windows paths would answer differently there (#2969).
    public static class WinPath
    {
        static bool Sep(char c) { return c == '\\' || c == '/'; }
        public static string Combine(string a, string b)
        {
            if (string.IsNullOrEmpty(b)) return a ?? "";
            if (string.IsNullOrEmpty(a)) return b;
            if (Sep(b[0]) || (b.Length >= 2 && b[1] == ':')) return b;
            char last = a[a.Length - 1];
            return Sep(last) || last == ':' ? a + b : a + "\\" + b;
        }
        public static string FileName(string p)
        {
            if (p == null) return "";
            int i = p.Length - 1;
            while (i >= 0 && !Sep(p[i]) && !(i == 1 && p[i] == ':')) i--;
            return p.Substring(i + 1);
        }
        public static string DirectoryName(string p)
        {
            if (string.IsNullOrEmpty(p)) return "";
            int i = p.Length - 1;
            while (i >= 0 && !Sep(p[i])) i--;
            if (i <= 0) return "";
            int j = i;
            while (j > 0 && Sep(p[j - 1])) j--;
            return p.Substring(0, j).Replace('/', '\\');
        }
        public static string Extension(string p)
        {
            string n = FileName(p);
            int i = n.LastIndexOf('.');
            return i < 0 || i == n.Length - 1 ? "" : n.Substring(i);
        }
    }

    // --------------------------------------------------------------- FOMOD ---
    //
    // A ModuleConfig.xml of schema 5.0 run with a collection's choices and no
    // dialog, as XmlScriptExecutor does when it has a preset and is not asked
    // to preselect (collections install unattended). The steps, groups and
    // options keep the order the parser gives them: an order attribute missing
    // means Ascending in the schema, which sorts by name, steps with
    // SortedThreadSafeObservableCollection's quicksort and groups and options
    // with its binary insertion. Strings compare ordinally, because the native
    // build runs with InvariantGlobalization.
    public static class Fomod
    {
        public sealed class World
        {
            public HashSet<string> Present = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            public HashSet<string> Active = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            public string GameVersion = "";
        }

        enum Order { Explicit, Ascending, Descending }
        enum GroupType { SelectAtLeastOne, SelectAtMostOne, SelectExactlyOne, SelectAll, SelectAny }
        enum OptType { Required, Optional, Recommended, NotUsable, CouldBeUsable }
        enum PState { Missing, Inactive, Active }

        sealed class FileItem : IComparable<FileItem>
        {
            public string Source, Destination; public bool IsFolder, AlwaysInstall, InstallIfUsable; public int Priority;
            public int CompareTo(FileItem o)
            {
                int r = Priority.CompareTo(o.Priority);
                if (r == 0) r = IsFolder.CompareTo(o.IsFolder);
                if (r == 0) r = string.Compare(Source, o.Source, StringComparison.OrdinalIgnoreCase);
                if (r == 0) r = string.Compare(Destination, o.Destination, StringComparison.OrdinalIgnoreCase);
                return r;
            }
        }

        sealed class State
        {
            public Dictionary<string, KeyValuePair<string, Option>> Flags = new Dictionary<string, KeyValuePair<string, Option>>(StringComparer.Ordinal);
            public World World;
            public void Set(string name, string value, Option owner) { Flags[name] = new KeyValuePair<string, Option>(value, owner); }
            public void Remove(Option owner) { foreach (var k in Flags.Keys.ToList()) if (Flags[k].Value == owner) Flags.Remove(k); }
        }

        abstract class Cond { public abstract bool Eval(State s); }
        sealed class Composite : Cond
        {
            public bool Or; public List<Cond> Items = new List<Cond>();
            public override bool Eval(State s)
            {
                bool all = !Or;
                foreach (var c in Items) { bool v = c.Eval(s); if (Or) all |= v; else all &= v; }
                return all;
            }
        }
        sealed class FlagCond : Cond
        {
            public string Name, Value;
            public override bool Eval(State s)
            {
                KeyValuePair<string, Option> v; string have = s.Flags.TryGetValue(Name, out v) ? v.Key : null;
                if (string.IsNullOrEmpty(Value)) return string.IsNullOrEmpty(have);
                return string.Equals(Value, have, StringComparison.Ordinal);
            }
        }
        sealed class PluginCond : Cond
        {
            public string File; public PState State;
            public override bool Eval(State s)
            {
                bool active = s.World.Active.Contains(File), present = s.World.Present.Contains(File);
                if (State == PState.Active) return active;
                if (State == PState.Inactive) return present && !active;
                return !present;
            }
        }
        // gameDependency and the script extender ones: Vortex's
        // getExtenderVersion answers with the game's version too
        // (installer_fomod_shared/delegates/SharedDelegates.ts).
        sealed class VersionCond : Cond
        {
            public Version Min; public bool Extender;
            public override bool Eval(State s)
            {
                Version have = Extender ? null : new Version(0, 0, 0, 0);
                try { if (!string.IsNullOrEmpty(s.World.GameVersion)) have = new Version(s.World.GameVersion.Split('-')[0]); } catch (Exception) { /* GameVersionCondition: an unparsable version counts as 0.0.0.0 */ }
                return have != null && have >= Min;
            }
        }

        abstract class TypeResolver { public abstract OptType Resolve(State s); }
        sealed class StaticType : TypeResolver { public OptType Type; public override OptType Resolve(State s) { return Type; } }
        sealed class CondType : TypeResolver
        {
            public OptType Default; public List<KeyValuePair<OptType, Cond>> Patterns = new List<KeyValuePair<OptType, Cond>>();
            public override OptType Resolve(State s) { foreach (var p in Patterns) if (p.Value.Eval(s)) return p.Key; return Default; }
        }

        sealed class Option
        {
            public string Name; public TypeResolver Type; public List<FileItem> Files = new List<FileItem>(); public List<KeyValuePair<string, string>> Flags = new List<KeyValuePair<string, string>>();
        }
        sealed class Group { public string Name; public GroupType Type; public List<Option> Options = new List<Option>(); }
        sealed class Step { public string Name; public Cond Visible; public List<Group> Groups = new List<Group>(); }
        sealed class Script
        {
            public Cond Prerequisites; public List<FileItem> Required = new List<FileItem>();
            public List<Step> Steps = new List<Step>(); public List<KeyValuePair<Cond, List<FileItem>>> Conditional = new List<KeyValuePair<Cond, List<FileItem>>>();
        }

        // ------------------------------------------------------------ parsing

        sealed class Refused : Exception { public Refused(string m) : base(m) { } }

        static string Attr(XElement e, string name, string dflt)
        {
            var a = e.Attribute(name);
            return a == null ? dflt : a.Value;
        }
        static T Enum<T>(string v, string what) where T : struct
        {
            T r;
            if (!System.Enum.TryParse<T>(v, false, out r) || !System.Enum.IsDefined(typeof(T), r)) throw new Refused("its FOMOD script has " + what + " \"" + v + "\"");
            return r;
        }
        static Order SortOrder(string v)
        {
            if (string.IsNullOrEmpty(v)) return Order.Explicit;
            if (v == "Ascending") return Order.Ascending;
            if (v == "Descending") return Order.Descending;
            return Order.Explicit;
        }
        static Version ParseVersion(string v) { try { return new Version(v); } catch (Exception) { return new Version(0, 0, 0, 0); } }

        static Cond LoadCond(XElement e)
        {
            if (e == null) return null;
            switch (e.Name.LocalName)
            {
                case "dependencies": case "visible": case "moduleDependencies":
                    var c = new Composite { Or = Enum<OrOp>(Attr(e, "operator", "And"), "a dependency operator") == OrOp.Or };
                    foreach (var x in e.Elements()) c.Items.Add(LoadCond(x));
                    return c;
                case "fileDependency":
                    return new PluginCond { File = Attr(e, "file", "").ToLowerInvariant(), State = Enum<PState>(Attr(e, "state", ""), "a file state") };
                case "flagDependency":
                    return new FlagCond { Name = Attr(e, "flag", ""), Value = Attr(e, "value", "") };
                case "gameDependency":
                    return new VersionCond { Min = ParseVersion(Attr(e, "version", "")) };
                case "skseDependency": case "foseDependency": case "nvseDependency": case "f4seDependency":
                    return new VersionCond { Min = ParseVersion(Attr(e, "version", "")), Extender = true };
                case "fommDependency":
                    throw new Refused("its FOMOD script asks for the mod manager's version (fommDependency), which is Vortex's own and not answered here");
            }
            throw new Refused("its FOMOD script has a condition " + e.Name.LocalName + ", which schema 5.0 does not have");
        }
        enum OrOp { And = 1, Or = 2 }

        static List<FileItem> ReadFiles(XElement list)
        {
            var files = new List<FileItem>();
            if (list == null) return files;
            foreach (var f in list.Elements())
            {
                string src = Attr(f, "source", null);
                if (src == null) throw new Refused("its FOMOD script has a " + f.Name.LocalName + " with no source");
                var d = f.Attribute("destination");
                decimal pri;
                if (!decimal.TryParse(Attr(f, "priority", "0"), System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out pri)) throw new Refused("its FOMOD script has a priority that is not a number");
                if (pri > int.MaxValue) pri = int.MaxValue; else if (pri < int.MinValue) pri = int.MinValue;
                var item = new FileItem
                {
                    Source = src, Destination = d == null ? src : d.Value,
                    AlwaysInstall = Bool(Attr(f, "alwaysInstall", "false")), InstallIfUsable = Bool(Attr(f, "installIfUsable", "false")), Priority = (int)pri,
                };
                if (f.Name.LocalName == "file") item.IsFolder = false;
                else if (f.Name.LocalName == "folder") item.IsFolder = true;
                else throw new Refused("its FOMOD script has a file entry " + f.Name.LocalName);
                files.Add(item);
            }
            files.Sort();
            return files;
        }
        static bool Bool(string v)
        {
            if (v == "true" || v == "1") return true;
            if (v == "false" || v == "0") return false;
            throw new Refused("its FOMOD script has a true or false that is \"" + v + "\"");
        }

        static int NameCompare(Order o, string x, string y)
        {
            if (o == Order.Explicit) return 0;
            if (o == Order.Descending) { var t = x; x = y; y = t; }
            if (string.IsNullOrEmpty(x)) return string.IsNullOrEmpty(y) ? 0 : -1;
            return string.CompareOrdinal(x, y);
        }
        // SortedThreadSafeObservableCollection.InsertItem: a binary search, an
        // equal name found goes in at that place.
        static void Insert<T>(List<T> list, T item, Order o, Func<T, string> name)
        {
            if (o == Order.Explicit) { list.Add(item); return; }
            int left = 0, right = list.Count - 1, at = -1;
            while (true)
            {
                if (right < left) { at = left; break; }
                int mid = (right + left) / 2;
                int r = NameCompare(o, name(item), name(list[mid]));
                if (r == 0) { at = mid; break; }
                if (r < 0) right = mid - 1; else left = mid + 1;
            }
            list.Insert(at, item);
        }
        // Its quicksort, for the steps, which are sorted after they are read.
        static void Quicksort<T>(List<T> list, int left, int right, Order o, Func<T, string> name)
        {
            if (right <= left) return;
            int pivotIndex = (right + left) / 2;
            T pivot = list[pivotIndex];
            Swap(list, pivotIndex, right);
            int store = left;
            for (int i = left; i < right; i++) if (NameCompare(o, name(list[i]), name(pivot)) < 1) { Swap(list, i, store); store++; }
            Swap(list, store, right);
            Quicksort(list, left, store - 1, o, name);
            Quicksort(list, store + 1, right, o, name);
        }
        static void Swap<T>(List<T> l, int a, int b) { T t = l[a]; l[a] = l[b]; l[b] = t; }

        static Script Parse(string xml)
        {
            var vm = Regex.Match(xml, "xsi:noNamespaceSchemaLocation=\"[^\"]*((XmlScript)|(ModConfig))(.*?).xsd", RegexOptions.Singleline);
            string version = vm.Success && vm.Groups[4].Value.Length > 0 ? vm.Groups[4].Value : "1.0";
            if (version != "5.0") throw new Refused("its FOMOD script is schema " + version + ", and only 5.0 is done here");
            XElement root = XElement.Parse(xml);
            if (root.Name.LocalName != "config" || root.Name.NamespaceName != "") throw new Refused("its FOMOD script's root is not a config element");
            var s = new Script();
            s.Prerequisites = LoadCond(root.Element("moduleDependencies"));
            s.Required = ReadFiles(root.Element("requiredInstallFiles"));
            var steps = root.Element("installSteps");
            if (steps != null)
            {
                foreach (var st in steps.Elements())
                {
                    var step = new Step { Name = Attr(st, "name", ""), Visible = LoadCond(st.Element("visible")) };
                    var groups = st.Element("optionalFileGroups");
                    if (groups == null) throw new Refused("its FOMOD step " + step.Name + " has no optionalFileGroups");
                    Order go = SortOrder(Attr(groups, "order", "Ascending"));
                    foreach (var g in groups.Elements())
                    {
                        var group = new Group { Name = Attr(g, "name", ""), Type = Enum<GroupType>(Attr(g, "type", ""), "a group type") };
                        var plugins = g.Element("plugins");
                        if (plugins == null) throw new Refused("its FOMOD group " + group.Name + " has no plugins");
                        Order oo = SortOrder(Attr(plugins, "order", "Ascending"));
                        foreach (var p in plugins.Elements()) Insert(group.Options, ReadOption(p), oo, x => x.Name);
                        Insert(step.Groups, group, go, x => x.Name);
                    }
                    s.Steps.Add(step);
                }
                Order so = SortOrder(Attr(steps, "order", "Ascending"));
                if (so != Order.Explicit) Quicksort(s.Steps, 0, s.Steps.Count - 1, so, x => x.Name);
            }
            var cfi = root.Element("conditionalFileInstalls");
            if (cfi != null)
            {
                var patterns = cfi.Element("patterns");
                if (patterns != null)
                    foreach (var p in patterns.Elements())
                        s.Conditional.Add(new KeyValuePair<Cond, List<FileItem>>(LoadCond(p.Element("dependencies")), ReadFiles(p.Element("files"))));
            }
            return s;
        }

        static Option ReadOption(XElement p)
        {
            var o = new Option { Name = Attr(p, "name", "") };
            var td = p.Element("typeDescriptor");
            var first = td == null ? null : td.Elements().FirstOrDefault();
            if (first == null) throw new Refused("its FOMOD option " + o.Name + " has no typeDescriptor");
            if (first.Name.LocalName == "type") o.Type = new StaticType { Type = Enum<OptType>(Attr(first, "name", ""), "an option type") };
            else if (first.Name.LocalName == "dependencyType")
            {
                var dt = first.Element("defaultType");
                var ct = new CondType { Default = Enum<OptType>(dt == null ? "" : Attr(dt, "name", ""), "an option type") };
                var pats = first.Element("patterns");
                if (pats != null)
                    foreach (var pat in pats.Elements())
                    {
                        var t = pat.Element("type");
                        var dep = pat.Element("dependencies");
                        if (dep == null) throw new Refused("its FOMOD option " + o.Name + " has a pattern with no dependencies");
                        ct.Patterns.Add(new KeyValuePair<OptType, Cond>(Enum<OptType>(t == null ? "" : Attr(t, "name", ""), "an option type"), LoadCond(dep)));
                    }
                o.Type = ct;
            }
            else throw new Refused("its FOMOD option " + o.Name + " has a typeDescriptor " + first.Name.LocalName);
            o.Files.AddRange(ReadFiles(p.Element("files")));
            var flags = p.Element("conditionFlags");
            if (flags != null) foreach (var f in flags.Elements()) o.Flags.Add(new KeyValuePair<string, string>(Attr(f, "name", ""), f.Value));
            return o;
        }

        // ------------------------------------------------------------ running

        sealed class Run
        {
            public State St; public HashSet<Option> Selected = new HashSet<Option>(); public List<PresetStep> Preset;
            public void Enable(Option o) { Selected.Add(o); foreach (var f in o.Flags) St.Set(f.Key, f.Value, o); }
            public void Disable(Option o) { Selected.Remove(o); St.Remove(o); }
            public OptType Type(Option o) { return o.Type.Resolve(St); }
        }

        sealed class Instr { public string Type, Source, Destination; public int Priority; }

        // TextUtil.ByteToString: a StreamReader that reads the byte order mark.
        static string ReadText(byte[] data)
        {
            using (var r = new StreamReader(new MemoryStream(data), true)) return r.ReadToEnd();
        }

        // What a ModuleConfig.xml asks, a line each, in the order Vortex shows
        // it, for whoever writes a collection's choices for a mod
        // (Read-NexusFile.ps1, #5189): each step and when it is shown, its
        // groups, their options with the idx a collection's choices give them
        // and what each sets, and the files each one, the script as a whole
        // and its flags put in place. A script this cannot run says why.
        public static List<string> Describe(string path)
        {
            var o = new List<string>();
            Script s;
            try { s = Parse(ReadText(File.ReadAllBytes(path))); }
            catch (Refused r) { o.Add("not run here: " + r.Message); return o; }
            catch (System.Xml.XmlException x) { o.Add("not XML that reads: " + x.Message); return o; }
            if (s.Prerequisites != null) o.Add("runs only when " + SayCond(s.Prerequisites));
            foreach (var f in s.Required) o.Add("always installs " + SayFile(f));
            foreach (var st in s.Steps)
            {
                o.Add("step \"" + st.Name + "\"" + (st.Visible != null ? ", shown only when " + SayCond(st.Visible) : ""));
                foreach (var g in st.Groups)
                {
                    o.Add("  group \"" + g.Name + "\", " + g.Type);
                    for (int i = 0; i < g.Options.Count; i++)
                    {
                        var op = g.Options[i];
                        var line = "    option \"" + op.Name + "\", idx " + i + ", " + SayType(op.Type);
                        if (op.Flags.Count > 0) line += ", sets " + string.Join(", ", op.Flags.Select(f => f.Key + "=" + f.Value));
                        o.Add(line);
                        foreach (var f in op.Files) o.Add("      " + SayFile(f));
                    }
                }
            }
            foreach (var c in s.Conditional)
                foreach (var f in c.Value) o.Add("when " + SayCond(c.Key) + ", installs " + SayFile(f));
            return o;
        }
        static string SayFile(FileItem f) { return (f.IsFolder ? "folder " : "file ") + f.Source + " -> " + (f.Destination.Length > 0 ? f.Destination : "(the mod's top)"); }
        static string SayType(TypeResolver t)
        {
            var st = t as StaticType;
            if (st != null) return st.Type.ToString();
            var ct = (CondType)t;
            return string.Join("", ct.Patterns.Select(p => p.Key + " when " + SayCond(p.Value) + ", ")) + ct.Default + " otherwise";
        }
        static string SayCond(Cond c)
        {
            var f = c as FlagCond; if (f != null) return "flag " + f.Name + " is \"" + f.Value + "\"";
            var p = c as PluginCond; if (p != null) return p.File + " is " + p.State.ToString().ToLowerInvariant();
            var v = c as VersionCond; if (v != null) return (v.Extender ? "the script extender" : "the game") + " is " + v.Min + " or later";
            var k = c as Composite;
            if (k != null) return k.Items.Count == 1 ? SayCond(k.Items[0]) : "(" + string.Join(k.Or ? " or " : " and ", k.Items.Select(SayCond)) + ")";
            return "a condition";
        }

        public static void Install(ModPlan plan, string unpacked, List<string> files, string moduleConfig, World world)
        {
            Script script;
            try { script = Parse(ReadText(File.ReadAllBytes(NexusLayout.OnDisk(unpacked, moduleConfig)))); }
            catch (Refused r) { plan.Stop = r.Message; return; }
            catch (System.Xml.XmlException x) { plan.Stop = "its FOMOD script is not XML that reads: " + x.Message; return; }

            // Mod.GetScriptFile: the folder above fomod\ModuleConfig.xml is the
            // prefix every source in the script is relative to.
            string prefix;
            int offset = moduleConfig.IndexOf("fomod\\ModuleConfig.xml", StringComparison.OrdinalIgnoreCase);
            prefix = offset == -1 ? NexusLayout.FindPathPrefix(files, NexusLayout.StopPatterns) : moduleConfig.Substring(0, offset);

            var run = new Run { St = new State { World = world }, Preset = plan.Entry.Choices };
            var instr = new List<Instr>();
            try
            {
                if (script.Prerequisites != null && !script.Prerequisites.Eval(run.St))
                { plan.Stop = "its FOMOD script's prerequisites are not met, so Vortex stops it"; return; }
                FixSteps(script, run);
                foreach (var step in script.Steps)
                {
                    if (step.Visible != null && !step.Visible.Eval(run.St)) continue;
                    Preselect(step, run);
                    FixSelected(step, run);
                }
                var toInstall = new List<FileItem>();
                var seen = new HashSet<FileItem>();
                Action<FileItem> add = f => { if (seen.Add(f)) toInstall.Add(f); };
                foreach (var step in script.Steps)
                    foreach (var g in step.Groups)
                        foreach (var o in g.Options)
                        {
                            if (run.Selected.Contains(o)) foreach (var f in o.Files) add(f);
                            else foreach (var f in o.Files) if (f.AlwaysInstall || (f.InstallIfUsable && run.Type(o) != OptType.NotUsable)) add(f);
                        }
                const int offsetP = 1000000000;
                bool issues = false;
                foreach (var f in script.Required) if (!InstallFile(f, -offsetP, prefix, files, instr)) issues = true;
                if (!issues) foreach (var f in toInstall) if (!InstallFile(f, 0, prefix, files, instr)) issues = true;
                if (!issues)
                    foreach (var set in script.Conditional)
                        if (set.Key.Eval(run.St)) foreach (var f in set.Value) if (!InstallFile(f, offsetP, prefix, files, instr)) issues = true;
            }
            catch (Refused r) { plan.Stop = r.Message; return; }
            catch (FolderFailed ff) { plan.Stop = "its FOMOD script fails: " + ff.Message; return; }
            foreach (var i in instr)
            {
                if (i.Type == "copy") plan.Copies.Add(new Copy(i.Source, i.Destination));
                else if (i.Type == "warning") plan.Warnings.Add(i.Source);
            }
        }

        sealed class FolderFailed : Exception { public FolderFailed(string m) : base(m) { } }

        static void FixSteps(Script s, Run run)
        {
            foreach (var step in s.Steps)
                foreach (var g in step.Groups)
                {
                    int required = g.Options.Count(o => run.Type(o) == OptType.Required);
                    if (required > 1 && g.Type == GroupType.SelectAtMostOne) g.Type = GroupType.SelectAny;
                    else if (required > 1 && g.Type == GroupType.SelectExactlyOne) g.Type = GroupType.SelectAtLeastOne;
                }
        }

        static void FixSelected(Step step, Run run)
        {
            foreach (var g in step.Groups)
                foreach (var o in g.Options)
                {
                    var t = run.Type(o);
                    if (t == OptType.Required) run.Enable(o);
                    else if (t == OptType.NotUsable) run.Disable(o);
                }
        }

        static void Preselect(Step step, Run run)
        {
            var stepPresets = run.Preset.Where(p => p.Name == step.Name).ToList();
            foreach (var g in step.Groups)
            {
                var groupPresets = new List<PresetGroup>();
                foreach (var sp in stepPresets) groupPresets.AddRange(sp.Groups.Where(pg => pg.Name == g.Name));
                if (g.Options.Any(o => run.Selected.Contains(o))) continue;
                bool setFirst = g.Type == GroupType.SelectExactlyOne;
                foreach (var o in g.Options)
                {
                    var t = run.Type(o);
                    bool isPreset = groupPresets.Any(gp => gp.Choices.Any(c => c.Name == o.Name));
                    if (isPreset && t == OptType.NotUsable) { o.Type = new StaticType { Type = OptType.CouldBeUsable }; t = OptType.CouldBeUsable; }
                    if (t == OptType.Required || g.Type == GroupType.SelectAll || isPreset)
                    {
                        setFirst = false;
                        if (groupPresets.Count > 0 && !isPreset) run.Disable(o); else run.Enable(o);
                    }
                }
                if (setFirst) run.Enable(g.Options[0]);
            }
        }

        static string NormalizeSeparators(string p) { return p.Replace('/', '\\'); }
        static string NormalizePath(string p, bool dirTerminate)
        {
            string t = p.Replace("\\\\", "\\").Replace("//", "/").Replace('/', '\\').Trim('\\').ToLowerInvariant();
            if (dirTerminate && t.Length > 0) t += "\\";
            return t;
        }
        // Mod.GetFiles, recursive: every path under the folder, compared as
        // NormalizePath writes them, and folders with nothing under them.
        static List<string> GetFiles(string target, List<string> modFiles)
        {
            var files = new List<string>(); var dirs = new List<string>();
            string pre = NormalizePath(target, true);
            foreach (var f in modFiles)
            {
                bool isDir = f.EndsWith("\\", StringComparison.Ordinal);
                string norm = NormalizePath(f, true);
                if ((!isDir || norm != pre) && norm.StartsWith(pre, StringComparison.Ordinal))
                {
                    if (isDir || f.EndsWith("/", StringComparison.Ordinal)) dirs.Add(f); else files.Add(f);
                }
            }
            foreach (var d in dirs) if (!files.Any(x => x.IndexOf(d, StringComparison.OrdinalIgnoreCase) >= 0)) files.Add(d);
            return files;
        }

        static bool InstallFile(FileItem f, int offset, string prefix, List<string> modFiles, List<Instr> instr)
        {
            if (f.IsFolder)
            {
                var list = GetFiles(WinPath.Combine(prefix, f.Source), modFiles);
                string from = NormalizeSeparators(WinPath.Combine(prefix, f.Source));
                if (!from.EndsWith("\\", StringComparison.Ordinal)) from += "\\";
                string to = NormalizeSeparators(f.Destination);
                if (to.Length > 0 && !to.EndsWith("\\", StringComparison.Ordinal)) to += "\\";
                foreach (var m in list)
                {
                    int len = m.Length - from.Length;
                    if (len <= 0) throw new FolderFailed("Failed to install \"" + from + "\" as folder");
                    string name = m.Substring(from.Length, len);
                    if (to.Length > 0) name = WinPath.Combine(to, name);
                    FromMod(m, name, f.Priority, instr);
                }
                return true;
            }
            string src = NormalizeSeparators(WinPath.Combine(prefix, f.Source));
            int count = GetFiles(src, modFiles).Count;
            if (count == 1) FromMod(src, NormalizeSeparators(f.Destination), f.Priority + offset, instr);
            else instr.Add(new Instr { Type = "warning", Source = count == 0 ? "Source doesn't match any files: \"" + src + "\"" : "Source matches a directory, was supposed to be a file: \"" + src + "\"" });
            return true;
        }

        static void FromMod(string from, string to, int priority, List<Instr> instr)
        {
            if (to.EndsWith("/", StringComparison.Ordinal) || to.EndsWith("\\", StringComparison.Ordinal)) { instr.Add(new Instr { Type = "mkdir", Destination = to }); return; }
            if (to == "") to = WinPath.FileName(from);
            int idx = instr.FindIndex(i => i.Type == "copy" && i.Destination == to);
            var next = new Instr { Type = "copy", Source = from, Destination = to, Priority = priority };
            if (idx == -1) instr.Add(next);
            else
            {
                var old = instr[idx];
                bool update = priority != old.Priority ? priority > old.Priority : string.CompareOrdinal(from, old.Source) > 0;
                if (update) instr[idx] = next;
            }
        }
    }
}
