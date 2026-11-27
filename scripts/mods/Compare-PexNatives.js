// Compare-PexNatives.js
//
//     node scripts/mods/Compare-PexNatives.js --scripts <scripts.json> --fork <skymp clone> --out <folder>
//
// Which of the native functions the collection's scripts call the server can
// run, sorted into the four groups #5035 names (#5792): mod setup menus,
// character creation helpers, spell and item scripts, world mechanics.
//
// WHY THIS EXISTS. #5035 has the server run the game's and mods' own scripts
// by building the engine functions they call into the fork. Which those are
// needs measuring, not guessing from names: scripts.json (Read-PexCalls.js,
// written by Install-NexusRevision -Scripts through Nexus-Run, #7000) lists
// every call a placed script makes to a native function, with its caller and
// instruction. This holds those calls to what the fork registers.
//
// THE FORK'S SIDE. Every native the server's Papyrus machine has is an
// AddMethod or AddStatic inside a Register of a class in
// skymp5-server/cpp/server_guest_lib/script_classes. The class's Papyrus name
// is its GetName literal, or, for a base shared by several (PapyrusLeveledBase,
// PapyrusEffectBase), each name a constructor hands it. For each registered
// function this gives the file and line of its registration and of its
// implementation. Registration is not implementation (#5035, PapyrusQuest
// returns 0): an implementation whose body says it is a stub or not
// implemented, or only returns one that is, is marked stub.
//
// THE COMPARISON. Only the copy of each script the game takes counts. A call
// that scripts.json settled names the script that declares the native; it is
// implemented, stub or missing by the fork's registration of that name. A call
// scripts.json could not settle (its type's script is the game's own, in
// Skyrim - Misc.bsa, or a mod's that is not in the collection) is unresolved,
// with scripts.json's reason, and with the fork's registration of the type it
// is called on when there is one, which the chain may or may not reach.
//
// THE GROUPS, by what each script is, read from scripts.json alone, first rule
// that holds:
//   mod setup menus             the script extends SKI_ConfigBase (an MCM page)
//   character creation helpers  it extends RaceMenuBase, or calls
//                               Game.ShowRaceMenu, ShowLimitedRaceMenu, or a
//                               native of NiOverride, CharGen or RaceMenu
//   spell and item scripts      it extends ActiveMagicEffect (spells,
//                               potions, enchantments, scrolls), or makes a
//                               call from OnEquipped or OnUnequipped
//   world mechanics             every other script
// Each script's row says which rule placed it.
//
// WHAT IT WRITES. natives.json, the whole inventory: per group, per native
// function, its state, the fork's file and line, and every caller (mod, file
// id, script, caller, instruction); and natives.md, the same per function
// with counts, for #5035. Metadata only: names, numbers and paths, as
// scripts.json holds. Exits 0 when it wrote both, 1 when it could not.
//
// tests/test-5792-pex-natives.js runs it against a fork and a scripts.json
// it makes itself.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CLASSES = path.join('skymp5-server', 'cpp', 'server_guest_lib', 'script_classes');
const GROUPS = ['mod setup menus', 'character creation helpers', 'spell and item scripts', 'world mechanics'];

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

// The body of a definition that opens at index: from its first { to the }
// that closes it.
function bodyAt(text, index) {
  const open = text.indexOf('{', index);
  if (open < 0) { return ''; }
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') { depth++; }
    else if (text[i] === '}') { depth--; if (depth === 0) { return text.slice(open, i + 1); } }
  }
  return text.slice(open);
}

function readFork(forkRoot) {
  const dir = path.join(forkRoot, CLASSES);
  if (!fs.existsSync(dir)) { throw new Error('no ' + CLASSES + ' under ' + forkRoot + ', so it is not a SkyMP clone'); }
  const files = fs.readdirSync(dir).filter(function (f) { return /\.(h|cpp)$/.test(f); }).sort();
  const text = {};
  for (const f of files) { text[f] = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n'); }
  const rel = function (f) { return (CLASSES + path.sep + f).split(path.sep).join('/'); };

  // The Papyrus names of each C++ class.
  const names = {};
  const add = function (cls, n) { (names[cls] = names[cls] || []).indexOf(n) < 0 && names[cls].push(n); };
  for (const f of files) {
    const t = text[f];
    const decl = /class\s+(\w+)[^{;]*\{/g;
    let m;
    while ((m = decl.exec(t))) {
      const lit = /GetName\(\)\s*override\s*\{\s*return\s*"(\w+)"/.exec(bodyAt(t, m.index));
      if (lit) { add(m[1], lit[1]); }
    }
    const init = /:\s*(\w+)\(\s*"(\w+)"\s*\)/g;
    while ((m = init.exec(t))) { add(m[1], m[2]); }
  }

  // Each class's implementations: where each member is defined and its body.
  function definition(cls, member) {
    const re = new RegExp('^[^\\s/#][^\\n;]*\\b' + cls + '::' + member + '\\s*\\(', 'm');
    for (const f of files) {
      const m = re.exec(text[f]);
      if (m) { return { file: rel(f), line: lineOf(text[f], m.index), body: bodyAt(text[f], m.index) }; }
    }
    return null;
  }

  const reg = {};
  for (const f of files) {
    const t = text[f];
    const regFn = /^void\s+(\w+)::Register\s*\(/gm;
    let m;
    while ((m = regFn.exec(t))) {
      const cls = m[1];
      const body = bodyAt(t, m.index);
      const bodyStart = t.indexOf(body, m.index);
      const addRe = /\b(AddMethod|AddStatic)\s*\(\s*vm\s*,\s*"(\w+)"\s*,\s*&(\w+)::(\w+)\s*\)/g;
      let a;
      while ((a = addRe.exec(body))) {
        const impl = definition(a[3], a[4]);
        const entry = {
          kind: a[1] === 'AddStatic' ? 'static' : 'method',
          name: a[2],
          registered: rel(f) + ':' + lineOf(t, bodyStart + a.index),
          implemented: impl ? impl.file + ':' + impl.line : null,
          member: a[3] + '::' + a[4],
          body: impl ? impl.body : ''
        };
        for (const n of names[cls] || []) {
          const k = n.toLowerCase();
          reg[k] = reg[k] || { name: n, fns: {} };
          reg[k].fns[a[2].toLowerCase()] = entry;
        }
      }
    }
  }

  // Stubs: a body that says so, or one that only hands the call to a stub.
  const STUB = /\/\/\s*stub\b|not implemented/i;
  for (const k of Object.keys(reg)) {
    for (const e of Object.values(reg[k].fns)) {
      if (STUB.test(e.body)) { e.stub = (/not implemented/i.test(e.body) ? 'its body says it is not implemented' : 'its body is marked a stub'); }
    }
  }
  for (const k of Object.keys(reg)) {
    for (const e of Object.values(reg[k].fns)) {
      if (e.stub) { continue; }
      const d = /^\{\s*return\s+(\w+)\s*\(\s*self\s*,\s*arguments\s*\)\s*;\s*\}$/.exec(e.body.trim());
      const to = d && reg[k].fns[d[1].toLowerCase()];
      if (to && to.stub) { e.stub = 'it only returns ' + to.name + ', and ' + to.stub.replace(/^its/, 'that one\'s'); }
    }
  }
  for (const k of Object.keys(reg)) { for (const e of Object.values(reg[k].fns)) { delete e.body; } }

  let commit = null;
  try { commit = execFileSync('git', ['-C', forkRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { commit = null; }
  return { commit: commit, classes: reg };
}

function compare(doc, fork) {
  if (!doc || doc.schema !== 1 || !Array.isArray(doc.scripts)) { throw new Error('this is not a scripts.json of schema 1 (Read-PexCalls.js)'); }
  const taken = doc.scripts.filter(function (r) { return r.taken && !r.error; });
  const byObject = {};
  for (const r of taken) { byObject[r.object.toLowerCase()] = r; }
  function chain(r) {
    const out = [r.object];
    const seen = {};
    let p = r.parent;
    while (p && !seen[p.toLowerCase()]) {
      seen[p.toLowerCase()] = true;
      out.push(p);
      const up = byObject[p.toLowerCase()];
      p = up ? up.parent : '';
    }
    return out.map(function (s) { return s.toLowerCase(); });
  }
  const CHARGEN_TYPES = ['nioverride', 'chargen', 'racemenu'];
  function groupOf(r) {
    const c = chain(r);
    if (c.indexOf('ski_configbase') >= 0) { return [0, 'extends SKI_ConfigBase']; }
    const all = (r.natives || []).concat(r.unsettled || []);
    if (c.indexOf('racemenubase') >= 0) { return [1, 'extends RaceMenuBase']; }
    for (const x of all) {
      const t = String(x[3]).toLowerCase(), fn = String(x[4]).toLowerCase();
      const decl = x.length > 5 ? String(x[5]).toLowerCase() : '';
      if (t === 'game' && (fn === 'showracemenu' || fn === 'showlimitedracemenu')) { return [1, 'calls Game.' + x[4]]; }
      if (CHARGEN_TYPES.indexOf(t) >= 0 || CHARGEN_TYPES.indexOf(decl) >= 0) { return [1, 'calls a native of ' + x[3]]; }
    }
    if (c.indexOf('activemagiceffect') >= 0) { return [2, 'extends ActiveMagicEffect']; }
    for (const x of all) {
      const fn = String(x[0]).split('.').pop().toLowerCase();
      if (fn === 'onequipped' || fn === 'onunequipped') { return [2, 'calls from ' + String(x[0]).split('.').pop()]; }
    }
    return [3, 'none of the rules above'];
  }

  const groups = GROUPS.map(function (g) { return { group: g, scripts: [], natives: {}, unresolved: {} }; });
  for (const r of taken) {
    if (!(r.natives || []).length && !(r.unsettled || []).length) { continue; }
    const [gi, rule] = groupOf(r);
    const g = groups[gi];
    g.scripts.push({ script: r.object, path: r.path + (r.inner ? '|' + r.inner : ''), mod: r.mod, fileId: r.fileId, rule: rule });
    const who = function (c) { return [r.mod, r.fileId, r.object, c[0], c[1]]; };
    for (const c of r.natives || []) {
      const key = c[5] + '.' + c[4];
      const k = key.toLowerCase();
      if (!g.natives[k]) {
        const cls = fork.classes[String(c[5]).toLowerCase()];
        const e = cls && cls.fns[String(c[4]).toLowerCase()];
        g.natives[k] = {
          native: (cls ? cls.name : c[5]) + '.' + (e ? e.name : c[4]),
          state: e ? (e.stub ? 'stub' : 'implemented') : 'missing',
          registered: e ? e.registered : null,
          implemented: e ? e.implemented : null,
          why: e ? (e.stub || '') : 'the fork registers no ' + c[4] + ' on ' + c[5],
          callers: []
        };
      }
      g.natives[k].callers.push(who(c));
    }
    for (const c of r.unsettled || []) {
      const key = (c[3] || '?') + '.' + c[4];
      const k = key.toLowerCase();
      if (!g.unresolved[k]) {
        const cls = c[3] ? fork.classes[String(c[3]).toLowerCase()] : null;
        const e = cls && cls.fns[String(c[4]).toLowerCase()];
        g.unresolved[k] = {
          call: key,
          state: 'unresolved',
          why: c[5],
          fork: e ? { registered: e.registered, implemented: e.implemented, stub: e.stub || null } : null,
          callers: []
        };
      }
      g.unresolved[k].callers.push(who(c));
    }
  }
  const sortRows = function (o) {
    return Object.values(o).sort(function (a, b) { return b.callers.length - a.callers.length || (a.native || a.call).localeCompare(b.native || b.call); });
  };
  const out = groups.map(function (g) {
    const natives = sortRows(g.natives);
    const unresolved = sortRows(g.unresolved);
    const count = function (rows, st) { return rows.filter(function (x) { return x.state === st; }).reduce(function (n, x) { return n + x.callers.length; }, 0); };
    return {
      group: g.group,
      counts: {
        scripts: g.scripts.length,
        implementedCalls: count(natives, 'implemented'), stubCalls: count(natives, 'stub'), missingCalls: count(natives, 'missing'),
        unresolvedCalls: count(unresolved, 'unresolved'),
        implementedFunctions: natives.filter(function (x) { return x.state === 'implemented'; }).length,
        stubFunctions: natives.filter(function (x) { return x.state === 'stub'; }).length,
        missingFunctions: natives.filter(function (x) { return x.state === 'missing'; }).length,
        unresolvedFunctions: unresolved.length
      },
      scripts: g.scripts.sort(function (a, b) { return a.script.localeCompare(b.script); }),
      natives: natives,
      unresolved: unresolved
    };
  });
  return {
    schema: 1,
    tool: 'scripts/mods/Compare-PexNatives.js (#5792)',
    collection: doc.collection || null,
    fork: { branch: 'thornswood/engine-changes', commit: fork.commit },
    scriptsCounts: doc.counts || null,
    notTaken: doc.scripts.length - taken.length,
    about: 'Per group of #5035, each native function the taken scripts call: implemented, stub or missing on the fork, with the file and line of its registration and implementation, and every caller as [mod, Nexus file id, script, caller, instruction]. unresolved holds the calls scripts.json could not settle, with why, and the fork\'s registration on the called type when it has one. Metadata only.',
    groups: out
  };
}

function markdown(inv) {
  const L = [];
  const c = inv.collection || {};
  L.push('Collection ' + (c.slug || c.collection || '?') + ' revision ' + (c.revision || '?') + ' against the fork at ' + (inv.fork.commit || '?') + ' (thornswood/engine-changes).');
  L.push('');
  L.push('| Group | Scripts | Implemented calls | Stub calls | Missing calls | Unresolved calls |');
  L.push('|---|---|---|---|---|---|');
  for (const g of inv.groups) {
    const n = g.counts;
    L.push('| ' + g.group + ' | ' + n.scripts + ' | ' + n.implementedCalls + ' (' + n.implementedFunctions + ') | ' + n.stubCalls + ' (' + n.stubFunctions + ') | ' + n.missingCalls + ' (' + n.missingFunctions + ') | ' + n.unresolvedCalls + ' (' + n.unresolvedFunctions + ') |');
  }
  L.push('');
  L.push('Calls, with the number of distinct functions in brackets.');
  for (const g of inv.groups) {
    L.push('');
    L.push('### ' + g.group);
    L.push('');
    if (!g.natives.length && !g.unresolved.length) { L.push('No script in this group calls a native.'); continue; }
    L.push('| Native | State | Calls | Fork | First caller |');
    L.push('|---|---|---|---|---|');
    for (const x of g.natives) {
      const f = x.callers[0];
      L.push('| ' + x.native + ' | ' + x.state + (x.why ? ': ' + x.why : '') + ' | ' + x.callers.length + ' | ' + (x.implemented || x.registered || 'none') + ' | ' + f[2] + ' ' + f[3] + ' @' + f[4] + ' |');
    }
    for (const x of g.unresolved) {
      const f = x.callers[0];
      L.push('| ' + x.call + ' | unresolved: ' + x.why + ' | ' + x.callers.length + ' | ' + (x.fork ? (x.fork.implemented || x.fork.registered) + (x.fork.stub ? ' (stub)' : '') + ', registered on the type called' : 'none') + ' | ' + f[2] + ' ' + f[3] + ' @' + f[4] + ' |');
    }
  }
  return L.join('\n') + '\n';
}

module.exports = { readFork: readFork, compare: compare, markdown: markdown, GROUPS: GROUPS };

function main(args) {
  const at = function (name) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : ''; };
  if (!at('scripts') || !at('fork') || !at('out')) {
    console.log('Use: --scripts <scripts.json> --fork <skymp clone> --out <folder>');
    return 1;
  }
  let inv;
  try {
    const doc = JSON.parse(fs.readFileSync(at('scripts'), 'utf8').replace(/^\uFEFF/, ''));
    inv = compare(doc, readFork(at('fork')));
  } catch (e) {
    console.log('Nothing was written: ' + e.message + '.');
    return 1;
  }
  fs.mkdirSync(at('out'), { recursive: true });
  fs.writeFileSync(path.join(at('out'), 'natives.json'), JSON.stringify(inv) + '\n');
  fs.writeFileSync(path.join(at('out'), 'natives.md'), markdown(inv));
  for (const g of inv.groups) {
    const n = g.counts;
    console.log(g.group + ': ' + n.scripts + ' scripts; ' + n.implementedCalls + ' calls implemented, ' + n.stubCalls + ' stub, ' + n.missingCalls + ' missing, ' + n.unresolvedCalls + ' unresolved');
  }
  return 0;
}

if (require.main === module) { process.exitCode = main(process.argv.slice(2)); }
