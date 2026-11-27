// nexus-collection.js
//
// The collection.json half of a new collection revision (#2914), run by
// New-NexusRevision.ps1:
//
//   node scripts/release/nexus-collection.js <collection.json> <swaps.json> <out collection.json> <out payload.json>
//
// It reads the collection.json of the revision that is published now, as
// Vortex wrote it, changes the entries swaps.json names to their new Nexus
// file and nothing else, writes the new collection.json the way Vortex
// writes it, and writes the collection_data the v3 API takes with it.
//
// WHY IN NODE. Vortex writes collection.json with JSON.stringify(info,
// undefined, 2) (collectionExport.ts, writeCollectionToFile). Read on 20 October:
// revision 2's collection.json, 1,069,730 bytes, comes back byte for byte from
// JSON.parse and that same JSON.stringify. PowerShell's ConvertTo-Json writes
// a different layout and, in Windows PowerShell 5.1, escapes characters
// differently, so the file is read and written here.
//
// THE PAYLOAD is Vortex's own mapping, ported line for line from
// Nexus-Mods/Vortex src/renderer/src/extensions/nexus_integration/util_v3/
// manifestMapping.ts (toV3CollectionPayload, read at 2e29b16d on 20 October)
// after collectionExport.ts's filterInfo, which is what submitCollectionV3.ts
// sends to POST /collections/{id}/revisions. One thing in it reads oddly and
// is kept as Vortex has it: filterInfo drops each source's fileSize before the
// mapping reads it, so every file_size goes as null. The size is still in
// collection.json inside the archive, where Vortex reads it on install.
//
// WHAT IT REFUSES. A swap changes an entry's file, version, md5, size, file
// name and reference tag. Vortex accepts an equal tag before checking the
// archive hash, so retaining the old tag would accept the old file (#6449).
// That is the whole of what Vortex records for a mod only when the
// entry carries nothing worked out from the archive's contents. So it refuses
// an entry that has choices (an installer's answers) or fileOverrides, and
// one with hashes (the files Vortex checks after install) unless the swap
// gives "hashes" for the new archive. Those need Vortex on One, where
// the collection is built from what is installed
// (docs\COLLECTION-REVISION-2.md). Every refusal exits 1 with the reason on
// stderr and writes nothing.
//
// A PATCHED ENTRY'S FILE LIST ON A MOVE (#6908). A patched entry lists the
// files its archive installs (#6888), so a move of one gives "hashes": the
// files the new archive installs, each with the md5 of the archive's copy,
// which New-NexusRevision.ps1 lists by running its installer with the answers
// records/collection.json keeps for the new file. The list takes the place
// of the old one, held as -Replicate holds one: every path inside the mod,
// each once, and every file the entry still patches in it. A list for an
// entry that lists none is refused: that is -Replicate.
//
// PATCHES AND MOD RULES ON A MOVED ENTRY (#2793). Two things Vortex records
// against the old archive can be carried to the new one, because what they
// need from it is known:
//   - a binary patch is made against one file of the old archive, and
//     Vortex checks that file's CRC-32 before it applies it. "patchCrcs" in
//     the swap gives the CRC-32 of each patched path in the new archive
//     (null where it has no such file), which New-NexusRevision.ps1 reads out
//     of it. A patch whose file is the same bytes stays. A patch named in
//     "dropPatches" goes, so the new archive's own file is what is installed
//     (Thornswood Content 1.2's plugin patch, once the new file carries the
//     plugin as it should be). Any other patch would not apply, and the swap
//     is refused, saying so.
//   - a mod rule names the old archive by its md5, its file name on Nexus
//     ("fileExpression", the name without its extension) and its version
//     ("versionMatch", the version as Vortex reads it, 1.2 as 1.2.0). Each
//     side of a rule that names the moved entry is given the new archive's
//     md5, "fileExpression" from the swap and the new version the same way,
//     so it finds the new file as it found the old. A versionMatch that is a
//     range and not the old version is refused, because what it should
//     become is not known.
//
// swaps.json: [{ "modId": "192762", "fileId": "812345", "version": "1.0.1",
//                "md5": "<32 hex>", "fileSize": 148896610,
//                "logicalFilename": "Thornswood Client Runtime",
//                "fileExpression": "Thornswood Client Runtime 192762 1.0.1 2026-10-20T20-00Z abc",
//                "patchCrcs": { "Thornswood-Content.esp": "0A1B2C3D" },
//                "dropPatches": ["Thornswood-Content.esp"] }]
// fileExpression is needed only when a mod rule names the entry, patchCrcs
// and dropPatches only when it carries patches, hashes only when it lists
// its files.
// On stdout, one line per field changed: <entry name>\t<field>\t<was>\t<now>.
//
// ADDING A MOD (#2969). An entry with "add": true is a mod the revision does
// not carry yet, written the way Vortex writes a mod it installed with its
// basic installer (no installer answers, no file hashes, no patches), or with
// its FOMOD installer when "choices" gives the answers (#5189), which the
// entry carries after its source as Vortex writes them:
//   { "add": true, "modId": "1932", "fileId": "8662", "version": "1.3",
//     "md5": "<32 hex>", "fileSize": 52221104,
//     "logicalFilename": "KS Hairdos Lite SE NoNPCs",
//     "name": "KS Hairdos Lite SE - KS Hairdos Lite SE NoNPCs",
//     "author": "...", "category": "Body, Face, and Hair",
//     "plugins": [{ "name": "KS_Hairdo's_Lite_NoNPCs.esp", "after": ["Playable Rieklings.esp"] }] }
// Each plugin goes at the end of its master or regular group, switched on.
// Its rule must name that group's existing tail, when there is one. Masters
// cannot load after regular plugins. Every "after" has to be a plugin the
// list already has, one added before it, or one the revision installs off
// its list ("unlisted" below). It refuses a file the revision
// already carries and a plugin the list already names. The tag Vortex gives
// an installed mod is made the way shortid makes one, unless "tag" is given.
// On stdout: <entry name>\tadded\t\tfile <id>, and <plugin>\tplugin\t\tafter <names>.
//
// A PATCH (#2979). An entry with "patch": true gives the entry that installs
// Nexus file fileId a binary patch for one of its files, the way Vortex
// records one it made: the file's path in the mod and the CRC-32 of the
// archive's own copy, which Vortex checks before it applies
// patches\<entry name>\<path>.diff (New-NexusRevision.ps1 packs that file):
//   { "patch": true, "fileId": "743640", "path": "RaceMenu.esp", "crc": "1A2B3C4D" }
// It refuses a file the entry already patches. "patches" goes after the
// installer answers and file hashes, where Vortex writes it.
// On stdout: <entry name>\tpatch\t\t<path> CRC-32 <crc>.
//
// FILE HASHES ON A PATCHED ENTRY (#6888). Vortex applies a collection's patch
// only to a mod it installs while it installs the collection (the collections
// extension's did-install-mod handler, InstallDriver.ts, applyPatches). Before
// that it asks whether a mod it already has is the collection's
// (testModReference.ts): up to 1.15 the patch check passes a copy of the same
// Nexus file installed with no patches at all, so a copy somebody had before
// is taken as it is and never patched, and its plugin is the author's bytes,
// not the server's. The file-list check is strict in every version: a mod
// whose files are not the entry's "hashes" is not the collection's, so Vortex
// installs the entry itself, by that list (mod_management/listInstaller.tsx),
// and then patches it. An entry with "replicate": true gives the entry that
// installs Nexus file fileId of mod modId the files it puts in its folder, each
// with the md5 of the archive's own copy, as Vortex writes a "replicate" entry:
//   { "replicate": true, "modId": "12939", "fileId": "536557",
//     "hashes": [ { "path": "DeadlySpellImpacts.esp", "md5": "<32 hex>" }, ... ] }
// The list installer takes the place of the entry's installer, so the
// entry's FOMOD answers go (a Vortex "replicate" entry has none). It refuses
// an entry that has hashes already or fileOverrides, a list that does not name
// every file the entry patches, and a path twice. A patch is refused on an
// entry with no hashes, so every patched entry carries them.
// On stdout: <entry name>\treplicate\t<installer before>\t<n> file hash(es).
//
// INSTALLER ANSWERS (#5531). An entry with "answers": true gives a file the
// revision keeps new FOMOD answers, which take the place of its choices:
//   { "answers": true, "modId": "9141", "fileId": "23215",
//     "choices": { "type": "fomod", "options": [ ... ] } }
// New-NexusRevision.ps1 gives them as Vortex records them on the mod it
// installed, and an added mod's choices the same way: every step, every group,
// what is selected. Vortex counts the mod as the collection's only when the
// entry's choices equal those.
// On stdout: <entry name>\tanswers\t<steps and groups before>\t<after>.
//
// A RULE (27 Oct). An entry with "rule": true gives a plugin the list names,
// or one the revision installs off its list (#6090), a new "load after" rule
// in place of the one it has:
//   { "rule": true, "name": "cheddars_mashups.esl", "after": ["RaceCompatibility.esm"] }
// Every "after" has to be a plugin the list names, one the revision installs
// off its list ("unlisted" below), or one of the five base masters. A plugin
// of the list moves to straight after the last plugin of the list its
// "after" names, so the list keeps its own rules; one installed off the list
// has no place in it, so only its rule changes (revision 9 gives CBBE.esp,
// which Vortex installs switched off, its rule from #4728). Revision 5's rule for
// cheddars_mashups.esl named three plugins the game always loads after it,
// because it loads an .esl as a master, and LOOT reported each as a cyclic
// interaction; Install-NexusRevision.ps1 reads a revision's rules against the
// plugins' headers (PluginRuleLoops.ps1) and stops on one.
// On stdout: <plugin>\trule\tafter <old names>\tafter <new names>.
//
// PLUGINS OFF THE LIST (#4603). An entry with "unlisted" names the plugins
// the revision installs that its plugin list leaves out, so Vortex installs
// them switched off:
//   { "unlisted": ["CBBE.esp", "RaceMenuMorphsCBBE.esp"] }
// collection.json does not say which those are (the list names only the
// plugins it orders, and a FOMOD's files are worked out on install), and the
// game still loads them where the servers do, so a plugin rule may name one:
// revision 6 has CommonClothes.esp after RaceMenuMorphsCBBE.esp. An added
// plugin's "after" and a rule's "after" may name one of these as well as a
// plugin of the list. New-NexusRevision.ps1 gives them from the record
// (records/collection.json, "enabled": false). It refuses a name the list
// already has. It changes nothing by itself and writes no line.
//
// TAKING A MOD OUT (#3649, #4191). An entry with "remove": true takes Nexus
// mod modId out of the revision, with the plugins it puts in Data:
//   { "remove": true, "modId": "24104",
//     "fileExpression": "Atlas Map Markers SE-24104-1-0-1594000000" }
// fileExpression is the entry's file name on Nexus without its extension,
// which New-NexusRevision.ps1 reads from the v1 file record as it does for a
// moved entry; a mod rule may name the entry by that alone.
// Its plugins are the ones its file hashes name at the top of Data. A plugin
// another entry's hashes name too stays on the plugin list, because that
// entry still installs it (Immersive Armors and its Script Free and
// Skypatched file both bring the Hothtrooper44 plugins). Each other one
// comes off the list. An entry with no hashes says nothing of which plugins
// it brings, so the remove gives the files its archive installs, read by
// New-NexusRevision.ps1 as for "replicate" (#4511, MCM Recorder):
//   { "remove": true, "modId": "61719", "fileExpression": "...",
//     "hashes": [ { "path": "McmRecorder.esp", "md5": "<32 hex>" }, ... ] }
// It refuses an entry with no hashes given neither, a list given for an
// entry with hashes of its own, one with patches (their folder is
// in the archive), one a mod rule names by md5, logical file name, tag or
// file name, one whose plugin a plugin rule names, and one whose plugin is a
// master of a plugin the revision still installs, because each of those
// needs the rest of the collection worked out again in Vortex on One.
// collection.json says nothing of masters, so they come in an entry of
// their own, the plugins' masters as the record has them from each header:
//   { "masters": { "IA CBBE Patch.esp": ["Skyrim.esm", "Hothtrooper44_ArmorCompilation.esp"] } }
// A mod whose plugins come off is refused when any plugin the revision still
// installs (on its list or off it) has no masters given, because nothing then
// says the plugin taken out is not one of them. It changes nothing by itself
// and writes no line.
// On stdout: <entry name>\tremoved\t\tfile <id>, <plugin>\tplugin\t\tremoved,
// and <plugin>\tplugin\t\tkept, <entry> installs it too.

'use strict';
const fs = require('fs');

// A stop says why and ends with code 1. It is thrown, and the program's end
// below says it, rather than calling node's exit function, which can hang on
// Node 24 (#6036).
class Stop extends Error { }
function stop(msg) {
  throw new Stop(msg);
}

// ------------------------------------------- Vortex's mapping, as it is ---
function omit(obj, keys) {
  const res = {};
  for (const k of Object.keys(obj)) { if (keys.indexOf(k) < 0) res[k] = obj[k]; }
  return res;
}
function filterInfoModSource(source) { return omit(source, ['instructions', 'fileSize', 'tag']); }
function filterInfoMod(mod) {
  const res = omit(mod, ['hashes', 'choices', 'patches', 'details', 'instructions', 'phase', 'fileOverrides']);
  res.source = filterInfoModSource(res.source);
  return res;
}
function filterInfo(input) {
  return { info: omit(input.info, ['installInstructions']), mods: input.mods.map(filterInfoMod) };
}
function str(v) { return (v === undefined || v === null) ? undefined : v.toString(); }
function nn(v) { return (v === undefined || v === null) ? null : v; }
function toV3ManifestModSource(source) {
  return {
    type: source.type,
    mod_id: str(source.modId),
    file_id: str(source.fileId),
    md5: nn(source.md5),
    file_size: nn(source.fileSize),
    update_policy: source.updatePolicy,
    logical_filename: nn(source.logicalFilename),
    file_expression: nn(source.fileExpression),
    url: nn(source.url),
    adult_content: nn(source.adultContent),
  };
}
function toV3ManifestMod(mod) {
  return {
    name: mod.name,
    version: mod.version,
    optional: mod.optional,
    domain_name: mod.domainName,
    source: toV3ManifestModSource(mod.source),
    author: nn(mod.author),
  };
}
function toV3Manifest(manifest) {
  return {
    info: {
      author: manifest.info.author,
      author_url: manifest.info.authorUrl || null,
      name: manifest.info.name,
      description: manifest.info.description || null,
      summary: manifest.info.summary || null,
      domain_name: manifest.info.domainName,
      game_versions: nn(manifest.info.gameVersions),
    },
    mods: manifest.mods.map(toV3ManifestMod),
  };
}
function toV3CollectionPayload(manifest, adultContent) {
  return {
    adult_content: adultContent === undefined ? false : adultContent,
    collection_manifest: toV3Manifest(manifest),
    collection_schema_id: 1,
  };
}

// The collectionExport.ts step is filterInfo first, then the mapping; the
// mapping reads only what filterInfo leaves, so the order is kept.
function payloadOf(collection) { return toV3CollectionPayload(filterInfo(collection)); }

// --------------------------------------------------------------- swaps ---
// Whether a mod rule names the entry. fileExpression, when given, is the
// entry's own file name on Nexus without its extension, which a rule may name
// it by alone (#4191); collection.json does not carry it on the entry.
function named(rule, entry, fileExpression) {
  const s = entry.source;
  for (const side of [rule.source, rule.reference]) {
    if (!side) continue;
    if (s.md5 && side.fileMD5 === s.md5) return true;
    if (s.logicalFilename && side.logicalFileName === s.logicalFilename) return true;
    if (s.tag && side.tag === s.tag) return true;
    if (fileExpression && side.fileExpression === fileExpression) return true;
  }
  return false;
}

// WHAT TO DO NEXT (#4215). A stop says what is wrong and the step that
// follows, so whoever ran it is not left to work that out.

// For a mod number with no entry or more than one: the step for each, and
// the entries by name when there are several.
function entriesNext(hits, none, many) {
  if (!hits.length) return none;
  return 'They are ' + hits.map(m => m.name).join(' and ') + '. ' + many;
}

// A mod rule by what it names, as "Alpha after Charlie", not only its place
// in collection.json.
function sideSays(side) {
  if (!side) return 'nothing';
  if (side.logicalFileName) return String(side.logicalFileName);
  if (side.fileExpression) return String(side.fileExpression);
  if (side.fileMD5) return 'the archive with md5 ' + side.fileMD5;
  if (side.tag) return 'the entry tagged ' + side.tag;
  return 'an entry it does not name';
}
function ruleSays(r) { return sideSays(r.source) + ' ' + String(r.type) + ' ' + sideSays(r.reference); }

// For an added plugin the list already names: the entry whose file hashes
// bring it, and the two ways on from there.
function bringsNext(collection, low, name, addName) {
  const by = collection.mods.find(m => Array.isArray(m.hashes) && m.hashes.some(h => String(h.path || '').toLowerCase() === low));
  if (by) {
    return by.name + ' brings it now: if ' + addName + ' replaces it, take that out first with -Remove ' + by.source.modId +
      ', and if not, leave ' + name + ' off ' + addName + '\'s plugins.';
  }
  return 'No entry\'s file hashes say which mod brings it: leave ' + name + ' off ' + addName + '\'s plugins, or make this revision in Vortex on One.';
}
// "unlisted" entries of the swaps gave them (PLUGINS OFF THE LIST above).
const UNLISTED = new WeakMap();
function unlistedOf(collection) { return UNLISTED.get(collection) || new Set(); }

// Each plugin's masters, lower case, as the "masters" entry of the swaps gave
// them (TAKING A MOD OUT above), or null when none was given.
const MASTERS = new WeakMap();
function mastersOf(collection) { return MASTERS.get(collection) || null; }
function setMasters(collection, swaps) {
  let map = null;
  for (const sw of swaps) {
    if (!sw || sw.masters === undefined) continue;
    if (map) stop('Two "masters" entries were given, and one says every plugin\'s masters.');
    if (!sw.masters || typeof sw.masters !== 'object' || Array.isArray(sw.masters)) stop('"masters" is not each plugin\'s name with the list of its masters.');
    map = new Map();
    for (const n of Object.keys(sw.masters)) {
      const ms = sw.masters[n];
      if (!/^[^\\/]+\.es[mpl]$/i.test(n) || !Array.isArray(ms) || ms.some(x => typeof x !== 'string' || !/\.es[mpl]$/i.test(x))) stop('"masters" gives ' + JSON.stringify(n) + ' as ' + JSON.stringify(ms) + ', which is not a plugin with a list of plugin names.');
      map.set(n.toLowerCase(), ms.map(x => x.toLowerCase()));
    }
  }
  MASTERS.set(collection, map);
}
// Header master facts from the collection record. A light flag on an ESP
// alone does not make it a master. ESM and ESL extensions do.
const MASTER_FLAGS = new WeakMap();
function isMaster(name, flag) { return /\.(esm|esl)$/i.test(name) || flag === true; }
function setMasterFlags(collection, swaps) {
  const flags = new Map();
  for (const sw of swaps) {
    if (!sw || sw.masterFlags === undefined) continue;
    if (!sw.masterFlags || typeof sw.masterFlags !== 'object' || Array.isArray(sw.masterFlags)) stop('"masterFlags" must map plugin names to booleans.');
    for (const [name, flag] of Object.entries(sw.masterFlags)) {
      if (!/^[^\\/]+\.es[mpl]$/i.test(name) || typeof flag !== 'boolean') stop('"masterFlags" has no boolean master fact for ' + name + '.');
      flags.set(name.toLowerCase(), flag);
    }
  }
  MASTER_FLAGS.set(collection, flags);
}
// An entry that only says something about the revision changes nothing by itself.
function onlyContext(sw) { return !!sw && typeof sw === 'object' && Object.keys(sw).length > 0 && Object.keys(sw).every(k => k === 'unlisted' || k === 'masters' || k === 'masterFlags' || k === 'page' || k === 'dev'); }

function setUnlisted(collection, swaps) {
  const set = new Set();
  const listed = new Set((Array.isArray(collection.plugins) ? collection.plugins : []).map(p => String(p.name).toLowerCase()));
  for (const sw of swaps) {
    if (!sw || sw.unlisted === undefined) continue;
    if (!Array.isArray(sw.unlisted)) stop('"unlisted" is not a list of plugin names.');
    for (const n of sw.unlisted) {
      if (typeof n !== 'string' || !/^[^\\/]+\.es[mpl]$/i.test(n)) stop('"unlisted" names ' + JSON.stringify(n) + ', which is not a plugin name (.esm, .esp or .esl).');
      if (listed.has(n.toLowerCase())) stop('"unlisted" names ' + n + ', which the plugin list has, so it is not installed off the list.');
      set.add(n.toLowerCase());
    }
  }
  UNLISTED.set(collection, set);
}

function applySwaps(collection, swaps) {
  const lines = [];
  if (!Array.isArray(collection.mods)) stop('collection.json has no mods list, so it is not a collection Vortex wrote.');
  setUnlisted(collection, swaps);
  setMasters(collection, swaps);
  setMasterFlags(collection, swaps);
  for (const sw of swaps) {
    if (onlyContext(sw)) continue;
    if (sw.add === true) { applyAdd(collection, sw, lines); continue; }
    if (sw.replicate === true) { applyReplicate(collection, sw, lines); continue; }
    if (sw.patch === true) { applyPatch(collection, sw, lines); continue; }
    if (sw.rule === true) { applyRule(collection, sw, lines); continue; }
    if (sw.remove === true) { applyRemove(collection, sw, lines); continue; }
    if (sw.answers === true) { applyAnswers(collection, sw, lines); continue; }
    if (sw.refreshTag === true) { applyTagRefresh(collection, sw.modId, lines); continue; }
    for (const k of ['modId', 'fileId', 'version', 'md5', 'fileSize', 'logicalFilename']) {
      if (sw[k] === undefined || sw[k] === null || sw[k] === '') stop('A swap has no ' + k + '.');
    }
    if (!/^[0-9a-f]{32}$/.test(String(sw.md5))) stop('The md5 for mod ' + sw.modId + ' is not 32 lower case hex characters.');
    const hits = collection.mods.filter(m => m.source && m.source.type === 'nexus' && String(m.source.modId) === String(sw.modId));
    if (hits.length !== 1) stop('The revision has ' + hits.length + ' entries for Nexus mod ' + sw.modId + ', so there is no one entry to change. ' + entriesNext(hits, 'A mod the revision does not carry goes in with -Add, a file naming it and its archive.', 'A mod with more than one entry is changed in Vortex on One.'));
    const e = hits[0];
    // A patched entry lists the files its archive installs (#6888), and a
    // move gives the new archive's list, made by the same installer with the
    // answers the record keeps for the new file (#6908). Answers and
    // fileOverrides on an entry with no list are still worked out in Vortex.
    const listed = Array.isArray(e.hashes) && e.hashes.length > 0;
    if (listed && sw.hashes === undefined) stop(e.name + ' lists the files its archive installs, and the move gives no list for the new one. .\\scripts\\release\\New-NexusRevision.ps1 -Mod ' + sw.modId + ' lists them; run the move through it.');
    if (!listed && sw.hashes !== undefined) stop(e.name + ' lists no files of its own, so a move gives it none. A list for an entry is -Replicate, in a revision of its own.');
    const carried = [...(listed ? [] : ['hashes']), 'choices', 'fileOverrides'].filter(k => {
      const v = e[k];
      if (v === undefined || v === null) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return true;
    });
    if (carried.length) {
      stop(e.name + ' carries ' + carried.join(' and ') + ' worked out from the archive it has now, which would not fit the new one. A new file for it is a revision made in Vortex on One.');
    }
    if (String(e.source.fileId) === String(sw.fileId)) stop(e.name + ' is already file ' + sw.fileId + ' in this revision.');
    // Two entries on one file would install it twice and leave the other
    // entry's mod in a state Vortex never made (#4200); -Add refuses the same.
    const other = collection.mods.find(m => m !== e && m.source && m.source.type === 'nexus' && String(m.source.fileId) === String(sw.fileId));
    if (other) stop('Nexus file ' + sw.fileId + ' is already in this revision, as ' + other.name + ', so ' + e.name + ' cannot move onto it.');
    const set = (obj, key, val, label) => {
      const was = obj[key];
      if (String(was) === String(val)) return;
      obj[key] = val;
      lines.push([e.name, label, String(was), String(val)].join('\t'));
    };
    movePatches(collection, e, sw, lines);
    if (listed) {
      // Held to the patches left once any are dropped: every file the entry
      // still patches is in the new archive's list.
      const bad = hashesProblem(e, sw.hashes);
      if (bad) stop('The new file list for ' + e.name + ' has ' + bad + '.');
      const was = e.hashes.length;
      e.hashes = sw.hashes.map(h => ({ path: String(h.path), md5: String(h.md5) }));
      lines.push([e.name, 'hashes', was + ' file' + (was === 1 ? '' : 's'), e.hashes.length + ' file' + (e.hashes.length === 1 ? '' : 's')].join('\t'));
    }
    const tag = uniqueTag(collection);
    moveRules(collection, e, sw, lines, tag);
    set(e, 'version', String(sw.version), 'version');
    set(e.source, 'fileId', Number(sw.fileId), 'source.fileId');
    set(e.source, 'md5', String(sw.md5), 'source.md5');
    set(e.source, 'fileSize', Number(sw.fileSize), 'source.fileSize');
    set(e.source, 'logicalFilename', String(sw.logicalFilename), 'source.logicalFilename');
    set(e.source, 'tag', tag, 'source.tag');
  }
  return lines;
}

// PATCHES AND MOD RULES ON A MOVED ENTRY, above.
function movePatches(collection, e, sw, lines) {
  const drop = Array.isArray(sw.dropPatches) ? sw.dropPatches.map(String) : [];
  const patches = e.patches && typeof e.patches === 'object' ? e.patches : {};
  const keys = Object.keys(patches);
  for (const d of drop) {
    if (!keys.some(k => k.toLowerCase() === d.toLowerCase())) stop(e.name + ' has no patch for ' + d + ' to drop.');
  }
  if (!keys.length) return;
  const crcs = sw.patchCrcs && typeof sw.patchCrcs === 'object' ? sw.patchCrcs : null;
  const crcOf = (k) => {
    if (!crcs) return undefined;
    const hit = Object.keys(crcs).find(c => c.toLowerCase() === k.toLowerCase());
    return hit === undefined ? undefined : crcs[hit];
  };
  for (const k of keys) {
    if (drop.some(d => d.toLowerCase() === k.toLowerCase())) {
      lines.push([e.name, 'patches.' + k, String(patches[k]), 'dropped'].join('\t'));
      delete patches[k];
      continue;
    }
    const now = crcOf(k);
    if (now === undefined) stop(e.name + ' patches ' + k + ', and the swap does not say what the new archive holds there.');
    if (now !== null && String(now).toUpperCase() === String(patches[k]).toUpperCase()) continue;
    stop(e.name + ' patches ' + k + ', made against the file with CRC-32 ' + patches[k] + ' in the archive it has now, and the new archive ' +
      (now === null ? 'has no ' + k : 'holds ' + k + ' with CRC-32 ' + now) + ', so the patch would not apply. Drop it to install the new archive\'s own file (-DropPatch ' + sw.modId + ':' + k + ').');
  }
  if (!Object.keys(patches).length) delete e.patches;
}

// The version as Vortex matches it: semver's coerce, 1.2 as 1.2.0.
function coerce(v) {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v));
  return m ? [m[1], m[2] || '0', m[3] || '0'].map(Number).join('.') : null;
}

// Whether one side of a mod rule names this entry (#4200): by the most
// exact thing the side gives, as Vortex matches a reference. A side with an
// md5 names the archive with that md5 and no other, whatever its file name;
// without one, a tag names the entry Vortex gave it; only a side with
// neither is matched by its file name. Before, any one of them was enough,
// so a rule naming another mod by its md5 that shared the file name "Main
// File" was moved with the swapped entry.
function sideNames(side, entry) {
  const s = entry.source;
  if (side.fileMD5 !== undefined) return !!s.md5 && side.fileMD5 === s.md5;
  if (side.tag !== undefined) return !!s.tag && side.tag === s.tag;
  return !!s.logicalFilename && side.logicalFileName === s.logicalFilename;
}

function moveRules(collection, e, sw, lines, tag) {
  const s = e.source;
  const oldVersion = coerce(e.version);
  const newVersion = coerce(sw.version);
  (collection.modRules || []).forEach((r, i) => {
    const says = ruleSays(r);
    for (const sideName of ['source', 'reference']) {
      const side = r[sideName];
      if (!side || !sideNames(side, e)) continue;
      const label = 'modRules[' + i + '].' + sideName + '.';
      const put = (key, val) => {
        if (String(side[key]) === String(val)) return;
        lines.push([e.name, label + key, String(side[key]), String(val)].join('\t'));
        side[key] = val;
      };
      if (side.fileMD5 !== undefined) put('fileMD5', String(sw.md5));
      if (side.tag !== undefined) put('tag', tag);
      if (side.fileExpression !== undefined) {
        if (!sw.fileExpression) stop('Mod rule ' + i + ' (' + says + ') names ' + e.name + ' by its file name on Nexus, and the swap gives no fileExpression for the new one. .\\scripts\\release\\New-NexusRevision.ps1 -Mod ' + sw.modId + ' reads that name from Nexus; run the move through it.');
        put('fileExpression', String(sw.fileExpression));
      }
      if (side.logicalFileName !== undefined && side.logicalFileName === s.logicalFilename) put('logicalFileName', String(sw.logicalFilename));
      if (side.versionMatch !== undefined && side.versionMatch !== '*') {
        if (!oldVersion || side.versionMatch !== oldVersion || !newVersion) stop('Mod rule ' + i + ' (' + says + ') matches ' + e.name + ' by the version "' + side.versionMatch + '", which is not its version ' + e.version + ' as Vortex reads it, so what it should become for ' + sw.version + ' is not known. Move it to the new file in Vortex on One, which writes the rule again for the version it installs.');
        put('versionMatch', newVersion);
      }
    }
  });
}

// shortid's alphabet, which Vortex's reference tags are drawn from.
const TAG_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';
function newTag() {
  const bytes = require('crypto').randomBytes(10);
  let t = '';
  for (const b of bytes) t += TAG_CHARS[b % TAG_CHARS.length];
  return t;
}

function uniqueTag(collection) {
  let tag;
  do { tag = newTag(); } while (collection.mods.some(m => m.source && m.source.tag === tag));
  return tag;
}

// Repair an already-published identity without moving its archive (#6449).
function applyTagRefresh(collection, modId, lines, chosenTag) {
  if (!/^[1-9][0-9]{0,8}$/.test(String(modId))) stop('An identity refresh has no valid mod number.');
  const hits = collection.mods.filter(m => m.source && m.source.type === 'nexus' && String(m.source.modId) === String(modId));
  if (hits.length !== 1) stop('The revision has ' + hits.length + ' entries for mod ' + modId + ', so there is no one entry to refresh.');
  const e = hits[0], was = e.source.tag, tag = chosenTag || uniqueTag(collection);
  if (typeof was !== 'string' || !was || collection.mods.some(m => m !== e && m.source && m.source.tag === was)) {
    stop(e.name + ' has no unique existing reference tag to refresh.');
  }
  for (const r of collection.modRules || []) {
    for (const key of ['source', 'reference']) {
      if (r[key] && r[key].tag === was) r[key].tag = tag;
    }
  }
  e.source.tag = tag;
  lines.push([e.name, 'source.tag', was, tag].join('\t'));
}

// The publisher checks the actual draft archive before publishing a repair.
// Only the selected identities and their tagged ordering references may differ.
function checkRefreshedTags(before, after, ids) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids.map(String)).size !== ids.length) stop('Say distinct mod numbers to check.');
  const expected = JSON.parse(JSON.stringify(before));
  if (!Array.isArray(expected.mods) || !Array.isArray(after.mods)) stop('A tag check needs two collection mod lists.');
  const oldTags = new Set(expected.mods.map(m => m.source && m.source.tag).filter(Boolean));
  const fresh = new Set();
  for (const id of ids) {
    if (!/^[1-9][0-9]{0,8}$/.test(String(id))) stop('An identity check has an invalid mod number.');
    const matches = c => c.mods.filter(m => m.source && m.source.type === 'nexus' && String(m.source.modId) === String(id));
    const old = matches(expected), next = matches(after);
    if (old.length !== 1 || next.length !== 1) stop('The tag check has no one entry for mod ' + id + '.');
    const tag = next[0].source.tag;
    if (!/^[A-Za-z0-9_-]{10}$/.test(String(tag)) || oldTags.has(tag) || fresh.has(tag)) stop('Mod ' + id + ' has no fresh unique reference tag in the draft.');
    applyTagRefresh(expected, id, [], tag);
    fresh.add(tag);
  }
  // The page text is independently supplied by the page record.
  if (expected.info && after.info) {
    for (const key of ['summary', 'description', 'installInstructions']) {
      if (Object.prototype.hasOwnProperty.call(after.info, key)) expected.info[key] = after.info[key];
      else delete expected.info[key];
    }
  }
  if (JSON.stringify(expected) !== JSON.stringify(after)) stop('The identity repair changed files, choices, plugins or unrelated metadata.');
}

function checkRepairFiles(before, after) {
  const path = require('path'), crypto = require('crypto');
  function inventory(root) {
    const rows = [];
    function walk(rel) {
      const full = path.join(root, rel);
      for (const e of fs.readdirSync(full, { withFileTypes: true })) {
        const name = rel ? rel + '/' + e.name : e.name;
        if (e.isSymbolicLink()) stop('An identity repair archive contains a symbolic link.');
        if (e.isDirectory()) { rows.push([name, 'directory']); walk(name); }
        else if (e.isFile()) {
          if (name !== 'collection.json') rows.push([name, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]);
        } else stop('An identity repair archive contains a non-file entry.');
      }
    }
    walk('');
    return rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  }
  if (JSON.stringify(inventory(before)) !== JSON.stringify(inventory(after))) {
    stop('The identity repair changed archive entries outside collection.json.');
  }
}

function applyAdd(collection, add, lines) {
  for (const k of ['modId', 'fileId', 'version', 'md5', 'fileSize', 'logicalFilename', 'name', 'author', 'category']) {
    if (add[k] === undefined || add[k] === null || add[k] === '') stop('A mod to add has no ' + k + '.');
  }
  if (!/^\d+$/.test(String(add.modId)) || !/^\d+$/.test(String(add.fileId))) stop('A mod to add has a mod number or file id that is not a number.');
  if (!/^[0-9a-f]{32}$/.test(String(add.md5))) stop('The md5 for mod ' + add.modId + ' is not 32 lower case hex characters.');
  const plugins = Array.isArray(add.plugins) ? add.plugins : [];
  const same = collection.mods.find(m => m.source && m.source.type === 'nexus' && String(m.source.fileId) === String(add.fileId));
  if (same) stop(same.name + ' is already file ' + add.fileId + ' in this revision, so it is not added again.');
  if (!Array.isArray(collection.plugins)) collection.plugins = [];
  if (!collection.pluginRules || typeof collection.pluginRules !== 'object') collection.pluginRules = { plugins: [], groups: [] };
  if (!Array.isArray(collection.pluginRules.plugins)) collection.pluginRules.plugins = [];
  const known = new Set(collection.plugins.map(p => String(p.name).toLowerCase()));
  for (const m of ['skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm']) known.add(m);
  for (const u of unlistedOf(collection)) known.add(u);
  // The list and this mod's own plugins so far, lower case: Windows and the
  // game read a plugin's name in any case, so two that differ only in case
  // are one file in Data (#4200).
  const own = new Set();
  const ruleNames = new Set(collection.pluginRules.plugins.map(r => String(r.name).toLowerCase()));
  const flags = new Map(MASTER_FLAGS.get(collection));
  const tails = new Map();
  for (const p of collection.plugins) {
    const low = String(p.name).toLowerCase();
    if (p.enabled !== false) tails.set(isMaster(low, flags.get(low)), p.name);
  }
  for (const p of plugins) {
    if (!p || !p.name || !/\.es[mpl]$/i.test(p.name)) stop('A plugin of ' + add.name + ' has no plugin name (.esm, .esp or .esl).');
    const low = String(p.name).toLowerCase();
    if (collection.plugins.some(q => String(q.name).toLowerCase() === low)) stop('The plugin list already names ' + p.name + ', so ' + add.name + ' would put a second one in Data. ' + bringsNext(collection, low, p.name, add.name));
    if (own.has(low)) stop(add.name + ' names ' + low + ' twice, in names that differ only in case, and Data holds one file by that name.');
    if (ruleNames.has(low)) stop('The plugin rule list already names ' + p.name + ', so adding it would write a second rule.');
    own.add(low);
    const recordedMaster = flags.get(low);
    if (recordedMaster !== undefined && p.master !== undefined && p.master !== recordedMaster) {
      stop(p.name + ' has a master flag that conflicts with the collection record.');
    }
    const master = isMaster(low, recordedMaster ?? p.master);
    const after = Array.isArray(p.after) ? p.after : [];
    if (!after.length) stop(p.name + ' says nothing to load after, so Vortex and LOOT would place it where they liked.');
    for (const a of after) {
      const target = String(a).toLowerCase();
      if (!known.has(target)) stop(p.name + ' is to load after ' + a + ', which the plugin list does not name and the revision does not install off its list.');
      if (master && !isMaster(target, flags.get(target))) stop(p.name + ' loads as a master and ' + a + ' does not, so that load-after rule would make a cycle.');
    }
    const tail = tails.get(master);
    if (tail && !after.some(a => String(a).toLowerCase() === String(tail).toLowerCase())) {
      stop(p.name + ' must name the tail ' + tail + ' in its load-after rules; a rule to an earlier plugin does not hold the end of the list.');
    }
    flags.set(low, master);
    tails.set(master, p.name);
    known.add(low);
  }
  if (add.choices !== undefined && add.choices !== null) checkChoices(add);
  const entry = {
    name: String(add.name),
    version: String(add.version),
    optional: false,
    domainName: (collection.info && collection.info.domainName) || 'skyrimspecialedition',
    source: {
      type: 'nexus',
      modId: Number(add.modId),
      fileId: Number(add.fileId),
      md5: String(add.md5),
      fileSize: Number(add.fileSize),
      logicalFilename: String(add.logicalFilename),
      updatePolicy: 'exact',
      tag: add.tag ? String(add.tag) : newTag(),
    },
  };
  // A FOMOD's answers go after the source, where Vortex writes them, so it
  // runs the script with them and shows no dialog.
  if (add.choices !== undefined && add.choices !== null) entry.choices = add.choices;
  entry.author = String(add.author);
  entry.details = { category: String(add.category), type: '' };
  entry.phase = 0;
  MASTER_FLAGS.set(collection, flags);
  collection.mods.push(entry);
  lines.push([String(add.name), 'added', '', 'file ' + add.fileId].join('\t'));
  for (const p of plugins) {
    const name = String(p.name);
    const master = flags.get(name.toLowerCase());
    const at = master ? collection.plugins.findLastIndex(q => isMaster(String(q.name), flags.get(String(q.name).toLowerCase()))) + 1 : collection.plugins.length;
    collection.plugins.splice(at, 0, { name, enabled: true });
    collection.pluginRules.plugins.push({ name: String(p.name).toLowerCase(), after: p.after.map(a => String(a).toLowerCase()) });
    lines.push([String(p.name), 'plugin', '', 'after ' + p.after.join(', ')].join('\t'));
  }
}

// The choices of a mod added with a FOMOD installer, as Vortex writes them:
// { type: 'fomod', options: [{ name, groups: [{ name, choices: [{ name, idx }] }] }] }.
function checkChoices(add) {
  const c = add.choices;
  const bad = () => stop('The choices for mod ' + add.modId + ' are not { type: "fomod", options: [steps of { name, groups: [{ name, choices: [{ name, idx }] }] }] }.');
  if (!c || typeof c !== 'object' || c.type !== 'fomod' || !Array.isArray(c.options) || !c.options.length) bad();
  for (const st of c.options) {
    if (!st || typeof st.name !== 'string' || !Array.isArray(st.groups)) bad();
    for (const g of st.groups) {
      if (!g || typeof g.name !== 'string' || !Array.isArray(g.choices)) bad();
      for (const ch of g.choices) if (!ch || typeof ch.name !== 'string' || !Number.isInteger(ch.idx) || ch.idx < 0) bad();
    }
  }
}

// New installer answers for a file the revision keeps (#5531): the entry's
// choices become the ones given, in place, which New-NexusRevision.ps1 worked
// out by running the mod's FOMOD script with them, as Vortex records them.
function applyAnswers(collection, an, lines) {
  for (const k of ['modId', 'fileId']) if (an[k] === undefined || an[k] === null || an[k] === '') stop('Installer answers have no ' + k + '.');
  const hits = collection.mods.filter(m => m.source && m.source.type === 'nexus' && String(m.source.fileId) === String(an.fileId) && String(m.source.modId) === String(an.modId));
  if (hits.length !== 1) stop('The revision has ' + hits.length + ' entries for Nexus file ' + an.fileId + ' of mod ' + an.modId + ', so there is no one entry to give answers.');
  const e = hits[0];
  if (!e.choices || e.choices.type !== 'fomod') stop(e.name + ' carries no FOMOD answers, so it is not a mod with an installer to give new ones.');
  checkChoices(an);
  const steps = c => c.options.length + ' step(s), ' + c.options.reduce((n, s) => n + s.groups.length, 0) + ' group(s)';
  const was = steps(e.choices);
  e.choices = an.choices;
  lines.push([String(e.name), 'answers', was, steps(an.choices)].join('\t'));
}

// FILE HASHES ON A PATCHED ENTRY, above.
function hashesProblem(e, hashes) {
  if (!Array.isArray(hashes) || !hashes.length) return 'no file hashes';
  const seen = new Set();
  for (const h of hashes) {
    if (!h || typeof h !== 'object' || Object.keys(h).join(',') !== 'path,md5') return 'a file hash that is not { path, md5 }';
    const p = String(h.path);
    if (!p || /^[\\/]/.test(p) || /(^|[\\/])\.\.?([\\/]|$)/.test(p) || /\//.test(p) || /^[A-Za-z]:/.test(p)) return 'the path ' + JSON.stringify(p) + ', which is not a path inside the mod as Vortex writes it';
    if (!/^[0-9a-f]{32}$/.test(String(h.md5))) return 'the md5 ' + JSON.stringify(h.md5) + ' for ' + p + ', which is not 32 lower case hex characters';
    const low = p.toLowerCase();
    if (seen.has(low)) return p + ' twice';
    seen.add(low);
  }
  const patches = e.patches && typeof e.patches === 'object' ? Object.keys(e.patches) : [];
  for (const k of patches) if (!seen.has(k.toLowerCase())) return 'no ' + k + ', which the entry patches';
  return '';
}

function replicated(e, hashes) {
  const next = {};
  for (const k of Object.keys(e)) {
    if (k === 'choices' || k === 'hashes') continue;
    next[k] = e[k];
    if (k === 'source') next.hashes = hashes.map(h => ({ path: String(h.path), md5: String(h.md5) }));
  }
  return next;
}

function applyReplicate(collection, rp, lines) {
  for (const k of ['modId', 'fileId']) if (rp[k] === undefined || rp[k] === null || rp[k] === '') stop('File hashes have no ' + k + '.');
  const hits = collection.mods.filter(m => m.source && m.source.type === 'nexus' && String(m.source.fileId) === String(rp.fileId) && String(m.source.modId) === String(rp.modId));
  if (hits.length !== 1) stop('The revision has ' + hits.length + ' entries for Nexus file ' + rp.fileId + ' of mod ' + rp.modId + ', so there is no one entry to give file hashes.');
  const e = hits[0];
  if (Array.isArray(e.hashes) && e.hashes.length) stop(e.name + ' already carries file hashes.');
  if (e.fileOverrides !== undefined && e.fileOverrides !== null && !(Array.isArray(e.fileOverrides) && !e.fileOverrides.length)) stop(e.name + ' carries fileOverrides, which a file list would not keep.');
  const bad = hashesProblem(e, rp.hashes);
  if (bad) stop('The file hashes for ' + e.name + ' have ' + bad + '.');
  const was = e.choices ? 'FOMOD answers' : 'its own installer';
  collection.mods[collection.mods.indexOf(e)] = replicated(e, rp.hashes);
  lines.push([String(e.name), 'replicate', was, rp.hashes.length + ' file hash' + (rp.hashes.length === 1 ? '' : 'es')].join('\t'));
}

// The publisher reads the draft archive before it publishes: against the
// published revision, only the named entries may differ, and each only by its
// file hashes in place of its FOMOD answers; the archive's other files are the
// same (checkRepairFiles).
// ids are the Nexus file ids of the entries, which a mod with two entries
// (More Craftable Equipment) needs: its number names neither alone.
function checkReplicated(before, after, ids) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids.map(String)).size !== ids.length) stop('Say distinct file ids to check.');
  const expected = JSON.parse(JSON.stringify(before));
  if (!Array.isArray(expected.mods) || !Array.isArray(after.mods)) stop('A file hash check needs two collection mod lists.');
  for (const id of ids) {
    if (!/^[1-9][0-9]{0,11}$/.test(String(id))) stop('A file hash check has an invalid file id.');
    const matches = c => c.mods.filter(m => m.source && m.source.type === 'nexus' && String(m.source.fileId) === String(id));
    const old = matches(expected), next = matches(after);
    if (old.length !== 1 || next.length !== 1) stop('The file hash check has no one entry for Nexus file ' + id + '.');
    if (Array.isArray(old[0].hashes) && old[0].hashes.length) stop(old[0].name + ' carried file hashes already.');
    const bad = hashesProblem(old[0], next[0].hashes);
    if (bad) stop('The draft\'s file hashes for ' + old[0].name + ' have ' + bad + '.');
    expected.mods[expected.mods.indexOf(old[0])] = replicated(old[0], next[0].hashes);
  }
  if (expected.info && after.info) {
    for (const key of ['summary', 'description', 'installInstructions']) {
      if (Object.prototype.hasOwnProperty.call(after.info, key)) expected.info[key] = after.info[key];
      else delete expected.info[key];
    }
  }
  if (JSON.stringify(expected) !== JSON.stringify(after)) stop('The draft changes more than the file hashes of the named entries.');
}

function applyPatch(collection, pt, lines) {
  for (const k of ['fileId', 'path', 'crc']) {
    if (pt[k] === undefined || pt[k] === null || pt[k] === '') stop('A patch has no ' + k + '.');
  }
  if (!/^[0-9A-F]{8}$/.test(String(pt.crc))) stop('The CRC-32 for ' + pt.path + ' is not 8 upper case hex characters.');
  const hits = collection.mods.filter(m => m.source && m.source.type === 'nexus' && String(m.source.fileId) === String(pt.fileId));
  if (hits.length !== 1) stop('The revision has ' + hits.length + ' entries for Nexus file ' + pt.fileId + ', so there is no one entry to patch.');
  const i = collection.mods.indexOf(hits[0]);
  const e = hits[0];
  const low = String(pt.path).toLowerCase();
  if (e.patches && Object.keys(e.patches).some(k => k.toLowerCase() === low)) stop(e.name + ' already patches ' + pt.path + '.');
  // FILE HASHES ON A PATCHED ENTRY, above: without them Vortex can take a copy
  // somebody already had as the collection's and never apply this patch.
  if (!Array.isArray(e.hashes) || !e.hashes.length) stop(e.name + ' carries no file hashes, so Vortex would take a copy somebody already has as the collection\'s and never apply the patch (#6888). Give it its hashes in the same run ("replicate").');
  if (!e.hashes.some(h => String(h.path).toLowerCase() === low)) stop(e.name + '\'s file hashes do not name ' + pt.path + ', so Vortex would not install the file the patch is for.');
  if (e.patches) { e.patches[String(pt.path)] = String(pt.crc); }
  else {
    const at = ['choices', 'hashes', 'source'].find(k => Object.prototype.hasOwnProperty.call(e, k));
    const next = {};
    for (const k of Object.keys(e)) {
      next[k] = e[k];
      if (k === at) next.patches = { [String(pt.path)]: String(pt.crc) };
    }
    collection.mods[i] = next;
  }
  lines.push([String(e.name), 'patch', '', String(pt.path) + ' CRC-32 ' + String(pt.crc)].join('\t'));
}

function applyRule(collection, ru, lines) {
  if (!ru.name || !/\.es[mpl]$/i.test(String(ru.name))) stop('A rule has no plugin name (.esm, .esp or .esl).');
  const low = String(ru.name).toLowerCase();
  if (!Array.isArray(collection.plugins)) collection.plugins = [];
  const at = collection.plugins.findIndex(p => String(p.name).toLowerCase() === low);
  // A plugin installed off the list ("unlisted") has no place in the list,
  // but Vortex keeps its rule all the same (#6090).
  const offList = at < 0 && unlistedOf(collection).has(low);
  if (at < 0 && !offList) stop('The plugin list does not name ' + ru.name + ' and the revision does not install it off its list, so there is no plugin to give a rule.');
  const after = Array.isArray(ru.after) ? ru.after.map(a => String(a)) : [];
  if (!after.length) stop(ru.name + ' says nothing to load after, so Vortex and LOOT would place it where they liked.');
  const base = ['skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm'];
  let last = -1;
  for (const a of after) {
    const al = a.toLowerCase();
    if (al === low) stop(ru.name + ' is to load after itself.');
    const i = collection.plugins.findIndex(p => String(p.name).toLowerCase() === al);
    if (i < 0 && base.indexOf(al) < 0 && !unlistedOf(collection).has(al)) stop(ru.name + ' is to load after ' + a + ', which the plugin list does not name and the revision does not install off its list.');
    if (i >= 0 && i !== at) last = Math.max(last, i);
  }
  if (!collection.pluginRules || typeof collection.pluginRules !== 'object') collection.pluginRules = { plugins: [], groups: [] };
  if (!Array.isArray(collection.pluginRules.plugins)) collection.pluginRules.plugins = [];
  const rules = collection.pluginRules.plugins;
  const ri = rules.findIndex(r => String(r.name).toLowerCase() === low);
  const was = ri >= 0 && Array.isArray(rules[ri].after) ? rules[ri].after.map(a => String(a)) : [];
  const now = after.map(a => a.toLowerCase());
  if (ri >= 0 && Object.keys(rules[ri]).some(k => k !== 'name' && k !== 'after')) stop(ru.name + '\'s rule says more than what it loads after (' + Object.keys(rules[ri]).join(', ') + '), which this does not change.');
  if (JSON.stringify(was) === JSON.stringify(now)) stop(ru.name + ' already loads after ' + after.join(', ') + '.');
  if (ri >= 0) rules[ri].after = now;
  else rules.push({ name: low, after: now });
  if (!offList) {
    const entry = collection.plugins.splice(at, 1)[0];
    const to = last < 0 ? 0 : (last > at ? last : last + 1);
    collection.plugins.splice(to, 0, entry);
  }
  lines.push([String(ru.name), 'rule', 'after ' + was.join(', '), 'after ' + now.join(', ')].join('\t'));
}

function applyRemove(collection, rm, lines) {
  if (!/^\d+$/.test(String(rm.modId))) stop('A mod to take out has no mod number.');
  const hits = collection.mods.filter(m => m.source && m.source.type === 'nexus' && String(m.source.modId) === String(rm.modId));
  if (hits.length !== 1) stop('The revision has ' + hits.length + ' entries for Nexus mod ' + rm.modId + ', so there is no one entry to take out. ' + entriesNext(hits, 'Nothing was taken out: -Remove takes a mod the revision carries, by the number in its page\'s address.', 'Take it out in Vortex on One.'));
  const e = hits[0];
  if (e.patches && Object.keys(e.patches).length) stop(e.name + ' carries patches, whose folder is in the archive. Take it out in Vortex on One.');
  // A mod rule may name the entry by its file name on Nexus alone, which
  // only the v1 file record gives (#4191).
  if (!rm.fileExpression || typeof rm.fileExpression !== 'string') stop('The mod to take out gives no fileExpression for ' + e.name + ', its file name on Nexus, so a mod rule naming it by that alone would not be found.');
  const rules = (collection.modRules || []).filter(r => named(r, e, rm.fileExpression));
  if (rules.length) stop(rules.length + ' of the collection\'s mod rules name ' + e.name + '. Take it out in Vortex on One.');
  // An entry with no hashes is given the files its archive installs, as
  // New-NexusRevision.ps1 reads them (#4511); one with hashes keeps its own.
  const own = Array.isArray(e.hashes) && e.hashes.length;
  if (own && rm.hashes !== undefined) stop(e.name + ' carries file hashes, and the mod to take out gives another list of its files.');
  if (!own) {
    if (rm.hashes === undefined) stop(e.name + ' has no file hashes and the mod to take out gives none read from its archive, so nothing says which plugins it brings.');
    const bad = hashesProblem(e, rm.hashes);
    if (bad) stop('The files read from ' + e.name + '\'s archive have ' + bad + '.');
  }
  const filesOf = (m) => (m === e && !own) ? rm.hashes : (Array.isArray(m.hashes) ? m.hashes : []);
  const pluginsOf = (m) => {
    const out = [];
    for (const h of filesOf(m)) {
      const p = String(h.path || '');
      if (/^[^\\/]+\.es[mpl]$/i.test(p) && out.indexOf(p.toLowerCase()) < 0) out.push(p.toLowerCase());
    }
    return out;
  };
  // A plugin another entry's hashes name too is still installed by that
  // entry, so it stays (#4191); only the rest leave Data.
  const kept = new Map();
  for (const m of collection.mods) {
    if (m === e) continue;
    for (const p of pluginsOf(m)) if (!kept.has(p)) kept.set(p, m.name);
  }
  const brought = pluginsOf(e);
  const plugins = brought.filter(p => !kept.has(p));
  const pr = (collection.pluginRules && Array.isArray(collection.pluginRules.plugins)) ? collection.pluginRules.plugins : [];
  for (const r of pr) {
    const names = [r.name].concat(r.after || [], r.before || []).map(n => String(n).toLowerCase());
    const hit = plugins.find(p => names.indexOf(p) >= 0);
    if (hit) stop('A plugin rule names ' + hit + ', which ' + e.name + ' brings. Take it out in Vortex on One.');
  }
  // A plugin the revision still installs that has one of these as a master
  // would stop the game loading (#4191). collection.json does not say what
  // a plugin's masters are, so each plugin left has to be given them.
  if (plugins.length) {
    const masters = mastersOf(collection);
    const listedName = (p) => { const q = (collection.plugins || []).find(x => String(x.name).toLowerCase() === p); return q ? String(q.name) : p; };
    const left = (Array.isArray(collection.plugins) ? collection.plugins : []).map(q => String(q.name).toLowerCase()).filter(n => plugins.indexOf(n) < 0);
    for (const u of unlistedOf(collection)) if (plugins.indexOf(u) < 0 && left.indexOf(u) < 0) left.push(u);
    for (const n of left) {
      const ms = masters ? masters.get(n) : undefined;
      if (ms === undefined) stop('Nothing says which masters ' + listedName(n) + ' has, so taking out ' + e.name + ' cannot be shown not to take one of them away. The masters come from records\\collection.json when it follows the revision this starts from.');
      const hit = plugins.find(p => ms.indexOf(p) >= 0);
      if (hit) stop(listedName(n) + ', which the revision still installs, has ' + listedName(hit) + ' as a master, and taking out ' + e.name + ' takes it away. Take it out in Vortex on One, with what needs it.');
    }
  }
  collection.mods.splice(collection.mods.indexOf(e), 1);
  lines.push([String(e.name), 'removed', '', 'file ' + e.source.fileId].join('\t'));
  if (Array.isArray(collection.plugins)) {
    for (const p of brought) {
      const at = collection.plugins.findIndex(q => String(q.name).toLowerCase() === p);
      if (at < 0) continue;
      if (kept.has(p)) { lines.push([String(collection.plugins[at].name), 'plugin', '', 'kept, ' + kept.get(p) + ' installs it too'].join('\t')); continue; }
      lines.push([String(collection.plugins[at].name), 'plugin', '', 'removed'].join('\t'));
      collection.plugins.splice(at, 1);
    }
  }
}

// ------------------------------------------------------ the page (#4537) ---
// An entry { "page": <records/collection-page.json> } gives the page's text,
// which New-NexusRevision always sends. It replaces the summary, the
// description and the install steps the revision before carried, each
// mark made plain, and each mark held to the mods this revision installs
// (collection-page.js). Until #4537 the old text went out again unread.
function applyPage(collection, swaps) {
  const entries = swaps.filter(sw => sw && sw.page !== undefined);
  if (!entries.length) return;
  if (entries.length > 1) stop('The swaps give the page ' + entries.length + ' times; one says what the page is.');
  const ids = new Set(collection.mods.map(m => Number(m.source && m.source.modId)));
  let text;
  try { text = require('./collection-page.js').sendable(entries[0].page, ids); }
  catch (e) { stop(e.message); }
  collection.info.summary = text.summary;
  collection.info.description = text.description;
  collection.info.installInstructions = text.installInstructions;
  // The collection's name and summary for its channel (#7193): Dev has a
  // collection of its own, so its revisions go out named as Dev's, and a
  // revision copied to main's collection goes out named as main's again.
  if (text.name) collection.info.name = text.name;
  if (entries[0].dev === true) {
    if (!text.dev) stop('The page is sent to the Dev collection, and records/collection-page.json gives no "dev" name and summary for it.');
    collection.info.name = text.dev.name;
    collection.info.summary = text.dev.summary;
  }
}

// A published revision copied into another collection (#7193): the same
// archive and every entry as it is, with only the page's text, name and
// summary for the collection it goes to. Anything else in info that would
// change stops it.
function copyRevision(collection, page, channel) {
  if (!collection || !collection.info || !Array.isArray(collection.mods)) stop('collection.json has no info and mods, so it is not a collection Vortex wrote.');
  if (channel !== 'main' && channel !== 'dev') stop('The channel a copy goes to is main or dev, not ' + channel + '.');
  const before = JSON.stringify(Object.assign({}, collection, { info: null }));
  const info = Object.assign({}, collection.info);
  applyPage(collection, [{ page: page, dev: channel === 'dev' }]);
  if (JSON.stringify(Object.assign({}, collection, { info: null })) !== before) stop('The copy changed more than the page.');
  for (const k of Object.keys(Object.assign({}, info, collection.info))) {
    if (['name', 'summary', 'description', 'installInstructions'].indexOf(k) >= 0) continue;
    if (JSON.stringify(info[k]) !== JSON.stringify(collection.info[k])) stop('The copy changed info.' + k + ', which only the page may change.');
  }
  return collection;
}

function main(argv) {
  if (argv[0] === '--copy') {
    if (argv.length !== 6) stop('usage: nexus-collection.js --copy <collection.json> <page.json> <main|dev> <out collection.json> <out payload.json>');
    let collection, page;
    try { collection = JSON.parse(fs.readFileSync(argv[1], 'utf8')); }
    catch (e) { stop(argv[1] + ' is not JSON this can read: ' + e.message); }
    try { page = JSON.parse(fs.readFileSync(argv[2], 'utf8').replace(/^\ufeff/, '')); }
    catch (e) { stop(argv[2] + ' is not JSON this can read: ' + e.message); }
    copyRevision(collection, page, argv[3]);
    fs.writeFileSync(argv[4], JSON.stringify(collection, undefined, 2));
    fs.writeFileSync(argv[5], JSON.stringify(payloadOf(collection)));
    process.stdout.write('copy\tname\t' + collection.info.name + '\n');
    return;
  }
  if (argv[0] === '--check-tags') {
    if (argv.length !== 4) stop('usage: nexus-collection.js --check-tags <published folder> <draft folder> <mod numbers>');
    const path = require('path');
    checkRepairFiles(argv[1], argv[2]);
    checkRefreshedTags(JSON.parse(fs.readFileSync(path.join(argv[1], 'collection.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(argv[2], 'collection.json'), 'utf8')), argv[3].split(','));
    process.stdout.write('The draft refreshes only the requested identities.\n');
    return;
  }
  if (argv[0] === '--check-replicate') {
    if (argv.length !== 4) stop('usage: nexus-collection.js --check-replicate <published folder> <draft folder> <file ids>');
    const path = require('path');
    checkRepairFiles(argv[1], argv[2]);
    checkReplicated(JSON.parse(fs.readFileSync(path.join(argv[1], 'collection.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(argv[2], 'collection.json'), 'utf8')), argv[3].split(','));
    process.stdout.write('The draft gives only the named entries their file hashes.\n');
    return;
  }
  if (argv.length !== 4) stop('usage: node nexus-collection.js <collection.json> <swaps.json> <out collection.json> <out payload.json>');
  const [inPath, swapsPath, outPath, payloadPath] = argv;
  let collection, swaps;
  try { collection = JSON.parse(fs.readFileSync(inPath, 'utf8')); }
  catch (e) { stop(inPath + ' is not JSON this can read: ' + e.message); }
  try { swaps = JSON.parse(fs.readFileSync(swapsPath, 'utf8').replace(/^﻿/, '')); }
  catch (e) { stop(swapsPath + ' is not JSON this can read: ' + e.message); }
  if (!Array.isArray(swaps)) swaps = [swaps];
  if (!swaps.some(sw => !onlyContext(sw))) stop('There are no swaps, so the revision would be the same as the one published.');
  const lines = applySwaps(collection, swaps);
  applyPage(collection, swaps);
  fs.writeFileSync(outPath, JSON.stringify(collection, undefined, 2));
  fs.writeFileSync(payloadPath, JSON.stringify(payloadOf(collection)));
  process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof Stop) process.stderr.write(e.message + '\n'); else console.error(e && e.stack || e);
    process.exitCode = 1;
  }
}
module.exports = { payloadOf, copyRevision, applySwaps, applyAdd, applyPatch, applyReplicate, applyRule, applyRemove, applyPage, checkRefreshedTags, checkReplicated, checkRepairFiles, filterInfo, toV3CollectionPayload };
