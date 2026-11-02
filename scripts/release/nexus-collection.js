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
// WHAT IT REFUSES. A swap changes an entry's file, version, md5, size and
// file name. That is the whole of what Vortex records for a mod only when the
// entry carries nothing worked out from the archive's contents. So it refuses
// an entry that has hashes (the files Vortex checks after install), choices
// (an installer's answers) or fileOverrides. Those need Vortex on One, where
// the collection is built from what is installed
// (docs\COLLECTION-REVISION-2.md). Every refusal exits 1 with the reason on
// stderr and writes nothing.
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
// and dropPatches only when it carries patches.
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
// Each plugin goes on the end of the plugin list, switched on, and its
// "after" becomes a plugin rule, lower case as Vortex keeps them, so Vortex
// and LOOT put it where the list does. Every "after" has to be a plugin the
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
// A RULE (27 Oct). An entry with "rule": true gives a plugin the list already
// names a new "load after" rule in place of the one it has:
//   { "rule": true, "name": "cheddars_mashups.esl", "after": ["RaceCompatibility.esm"] }
// Every "after" has to be a plugin the list names, one the revision installs
// off its list ("unlisted" below), or one of the five base masters. The
// plugin moves in the list to straight after the last plugin of the list its
// "after" names, so the list keeps its own rules. Revision 5's rule for
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
// TAKING A MOD OUT (#3649). An entry with "remove": true takes Nexus mod
// modId out of the revision, with the plugins it puts in Data:
//   { "remove": true, "modId": "24104" }
// Its plugins are the ones its file hashes name at the top of Data, and each
// comes off the plugin list. It refuses an entry with no hashes (nothing in
// the revision says which plugins it brings), one with patches (their folder
// is in the archive), one a mod rule names, and one whose plugin a plugin
// rule names, because each of those needs the rest of the collection worked
// out again in Vortex on One.
// On stdout: <entry name>\tremoved\t\tfile <id>, and <plugin>\tplugin\t\tremoved.

'use strict';
const fs = require('fs');

function stop(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
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
function named(rule, entry) {
  const s = entry.source;
  for (const side of [rule.source, rule.reference]) {
    if (!side) continue;
    if (s.md5 && side.fileMD5 === s.md5) return true;
    if (s.logicalFilename && side.logicalFileName === s.logicalFilename) return true;
    if (s.tag && side.tag === s.tag) return true;
  }
  return false;
}

// The plugins the revision installs off its list, lower case, as the
// "unlisted" entries of the swaps gave them (PLUGINS OFF THE LIST above).
const UNLISTED = new WeakMap();
function unlistedOf(collection) { return UNLISTED.get(collection) || new Set(); }

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
  for (const sw of swaps) {
    if (sw.unlisted !== undefined && Object.keys(sw).length === 1) continue;
    if (sw.add === true) { applyAdd(collection, sw, lines); continue; }
    if (sw.patch === true) { applyPatch(collection, sw, lines); continue; }
    if (sw.rule === true) { applyRule(collection, sw, lines); continue; }
    if (sw.remove === true) { applyRemove(collection, sw, lines); continue; }
    for (const k of ['modId', 'fileId', 'version', 'md5', 'fileSize', 'logicalFilename']) {
      if (sw[k] === undefined || sw[k] === null || sw[k] === '') stop('A swap has no ' + k + '.');
    }
    if (!/^[0-9a-f]{32}$/.test(String(sw.md5))) stop('The md5 for mod ' + sw.modId + ' is not 32 lower case hex characters.');
    const hits = collection.mods.filter(m => m.source && m.source.type === 'nexus' && String(m.source.modId) === String(sw.modId));
    if (hits.length !== 1) stop('The revision has ' + hits.length + ' entries for Nexus mod ' + sw.modId + ', so there is no one entry to change.');
    const e = hits[0];
    const carried = ['hashes', 'choices', 'fileOverrides'].filter(k => {
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
    const set = (obj, key, val, label) => {
      const was = obj[key];
      if (String(was) === String(val)) return;
      obj[key] = val;
      lines.push([e.name, label, String(was), String(val)].join('\t'));
    };
    movePatches(collection, e, sw, lines);
    moveRules(collection, e, sw, lines);
    set(e, 'version', String(sw.version), 'version');
    set(e.source, 'fileId', Number(sw.fileId), 'source.fileId');
    set(e.source, 'md5', String(sw.md5), 'source.md5');
    set(e.source, 'fileSize', Number(sw.fileSize), 'source.fileSize');
    set(e.source, 'logicalFilename', String(sw.logicalFilename), 'source.logicalFilename');
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

function moveRules(collection, e, sw, lines) {
  const s = e.source;
  const oldVersion = coerce(e.version);
  const newVersion = coerce(sw.version);
  (collection.modRules || []).forEach((r, i) => {
    for (const sideName of ['source', 'reference']) {
      const side = r[sideName];
      if (!side || !named({ source: side }, e)) continue;
      const label = 'modRules[' + i + '].' + sideName + '.';
      const put = (key, val) => {
        if (String(side[key]) === String(val)) return;
        lines.push([e.name, label + key, String(side[key]), String(val)].join('\t'));
        side[key] = val;
      };
      if (side.fileMD5 !== undefined) put('fileMD5', String(sw.md5));
      if (side.fileExpression !== undefined) {
        if (!sw.fileExpression) stop('Mod rule ' + i + ' names ' + e.name + ' by its file name on Nexus, and the swap gives no fileExpression for the new one.');
        put('fileExpression', String(sw.fileExpression));
      }
      if (side.logicalFileName !== undefined && side.logicalFileName === s.logicalFilename) put('logicalFileName', String(sw.logicalFilename));
      if (side.versionMatch !== undefined && side.versionMatch !== '*') {
        if (!oldVersion || side.versionMatch !== oldVersion || !newVersion) stop('Mod rule ' + i + ' matches ' + e.name + ' by the version "' + side.versionMatch + '", which is not its version ' + e.version + ' as Vortex reads it, so what it should become for ' + sw.version + ' is not known.');
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
  for (const p of plugins) {
    if (!p || !p.name || !/\.es[mpl]$/i.test(p.name)) stop('A plugin of ' + add.name + ' has no plugin name (.esm, .esp or .esl).');
    const low = String(p.name).toLowerCase();
    if (collection.plugins.some(q => String(q.name).toLowerCase() === low)) stop('The plugin list already names ' + p.name + ', so ' + add.name + ' would put a second one in Data.');
    const after = Array.isArray(p.after) ? p.after : [];
    if (!after.length) stop(p.name + ' says nothing to load after, so Vortex and LOOT would place it where they liked.');
    for (const a of after) if (!known.has(String(a).toLowerCase())) stop(p.name + ' is to load after ' + a + ', which the plugin list does not name and the revision does not install off its list.');
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
  collection.mods.push(entry);
  lines.push([String(add.name), 'added', '', 'file ' + add.fileId].join('\t'));
  for (const p of plugins) {
    collection.plugins.push({ name: String(p.name), enabled: true });
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
  if (at < 0) stop('The plugin list does not name ' + ru.name + ', so there is no plugin to give a rule.');
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
  const entry = collection.plugins.splice(at, 1)[0];
  const to = last < 0 ? 0 : (last > at ? last : last + 1);
  collection.plugins.splice(to, 0, entry);
  lines.push([String(ru.name), 'rule', 'after ' + was.join(', '), 'after ' + now.join(', ')].join('\t'));
}

function applyRemove(collection, rm, lines) {
  if (!/^\d+$/.test(String(rm.modId))) stop('A mod to take out has no mod number.');
  const hits = collection.mods.filter(m => m.source && m.source.type === 'nexus' && String(m.source.modId) === String(rm.modId));
  if (hits.length !== 1) stop('The revision has ' + hits.length + ' entries for Nexus mod ' + rm.modId + ', so there is no one entry to take out.');
  const e = hits[0];
  if (e.patches && Object.keys(e.patches).length) stop(e.name + ' carries patches, whose folder is in the archive. Take it out in Vortex on One.');
  const rules = (collection.modRules || []).filter(r => named(r, e));
  if (rules.length) stop(rules.length + ' of the collection\'s mod rules name ' + e.name + '. Take it out in Vortex on One.');
  if (!Array.isArray(e.hashes) || !e.hashes.length) stop(e.name + ' has no file hashes, so nothing in the revision says which plugins it brings. Take it out in Vortex on One.');
  const plugins = [];
  for (const h of e.hashes) {
    const path = String(h.path || '');
    if (/^[^\\/]+\.es[mpl]$/i.test(path) && plugins.indexOf(path.toLowerCase()) < 0) plugins.push(path.toLowerCase());
  }
  const pr = (collection.pluginRules && Array.isArray(collection.pluginRules.plugins)) ? collection.pluginRules.plugins : [];
  for (const r of pr) {
    const names = [r.name].concat(r.after || [], r.before || []).map(n => String(n).toLowerCase());
    const hit = plugins.find(p => names.indexOf(p) >= 0);
    if (hit) stop('A plugin rule names ' + hit + ', which ' + e.name + ' brings. Take it out in Vortex on One.');
  }
  collection.mods.splice(collection.mods.indexOf(e), 1);
  lines.push([String(e.name), 'removed', '', 'file ' + e.source.fileId].join('\t'));
  if (Array.isArray(collection.plugins)) {
    for (const p of plugins) {
      const at = collection.plugins.findIndex(q => String(q.name).toLowerCase() === p);
      if (at < 0) continue;
      lines.push([String(collection.plugins[at].name), 'plugin', '', 'removed'].join('\t'));
      collection.plugins.splice(at, 1);
    }
  }
}

function main(argv) {
  if (argv.length !== 4) stop('usage: node nexus-collection.js <collection.json> <swaps.json> <out collection.json> <out payload.json>');
  const [inPath, swapsPath, outPath, payloadPath] = argv;
  let collection, swaps;
  try { collection = JSON.parse(fs.readFileSync(inPath, 'utf8')); }
  catch (e) { stop(inPath + ' is not JSON this can read: ' + e.message); }
  try { swaps = JSON.parse(fs.readFileSync(swapsPath, 'utf8').replace(/^﻿/, '')); }
  catch (e) { stop(swapsPath + ' is not JSON this can read: ' + e.message); }
  if (!Array.isArray(swaps)) swaps = [swaps];
  if (!swaps.some(sw => !(sw && sw.unlisted !== undefined && Object.keys(sw).length === 1))) stop('There are no swaps, so the revision would be the same as the one published.');
  const lines = applySwaps(collection, swaps);
  fs.writeFileSync(outPath, JSON.stringify(collection, undefined, 2));
  fs.writeFileSync(payloadPath, JSON.stringify(payloadOf(collection)));
  process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { payloadOf, applySwaps, applyAdd, applyPatch, applyRule, applyRemove, filterInfo, toV3CollectionPayload };
