// PapyrusEventList.js
//
//     node scripts\dev\PapyrusEventList.js            say whether the record is the fork's list at the pin
//     node scripts\dev\PapyrusEventList.js --write    write the record from the fork at the pin
//     node scripts\dev\PapyrusEventList.js --commit <sha> --fork <folder>
//
// The fork's event list, both halves, read out of the fork's source at one
// commit (issue #503). A game script fires only where both halves let it:
//
//   THE CLIENT. skyrim-platform's FridaHooks.cpp, OnSendEventEnter, hooks the
//   game's Papyrus SendEvent on each person's machine. With the blocker on
//   (skymp5-client's blockPapyrusEventsService.ts turns it on) it blanks every
//   event name but the ones it compares against, unless a script on the same
//   object carries one of the exempt names. A script that runs here runs on
//   that one machine, and nobody else sees what it does.
//
//   THE SERVER. The server's own Papyrus machine is sent the names every
//   SendPapyrusEvent call in skymp5-server\cpp spells out, but it attaches a
//   script only to a placed reference, from that reference's record and its
//   base record, and only when its script storage has the script:
//   ScriptStorageFactory.cpp builds that storage from the built in scripts
//   (skymp5-server\standard_scripts, compiled into the binary), the data\scripts
//   folder (the fork's skymp5-scripts\pex, which the server build copies there)
//   and any archive the "archives" setting names. InitScripts drops a few
//   scripts by name, and every script but Sweet* on a form below 05000000 in an
//   exterior while disableVanillaScriptsInExterior is on.
//
// records\papyrus-events.json is the list. scripts\dev\Audit-PapyrusEvents.py
// judges the load order against it, and game\tests\test-papyrus-event-list.js holds
// it to the fork at the pin the repository names. The fork is read from git's
// objects at that commit (git show), never from the working tree, so a fork
// checked out at another commit reads the same.
//
// What the source says in a shape this does not know (a new string in the
// blocker, a SendPapyrusEvent whose name it cannot read, a new storage) is an
// error, not a guess. The parts too intricate to read as a list (the blocker's
// body, the storage factory, InitScripts) are also held by a fingerprint of
// their code with comments and spacing taken out, so any change to them shows.
//
// Read only, apart from the record --write writes. Exit codes: 0 the record is
// the list (or was written), 1 it is not, 2 the fork cannot be read at the
// commit.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const RECORD = path.join(REPO, 'records', 'papyrus-events.json');

const FILES = {
  blocker: 'skyrim-platform/src/platform_se/skyrim_platform/FridaHooks.cpp',
  service: 'skymp5-client/src/services/services/blockPapyrusEventsService.ts',
  clientIndex: 'skymp5-client/src/index.ts',
  storage: 'skymp5-server/cpp/server_guest_lib/script_storages/ScriptStorageFactory.cpp',
  serverCmake: 'skymp5-server/CMakeLists.txt',
  refr: 'skymp5-server/cpp/server_guest_lib/MpObjectReference.cpp',
  worldState: 'skymp5-server/cpp/server_guest_lib/WorldState.h',
};
const STANDARD_DIR = 'skymp5-server/standard_scripts';
const DATA_PEX_DIR = 'skymp5-scripts/pex';
const SERVER_CPP = 'skymp5-server/cpp';
// The searches readClient and readServer make, read together up front.
const SEARCHES = [
  ['blockPapyrusEvents(false)', 'skymp5-client/src'],
  ['SendPapyrusEvent', SERVER_CPP],
  ['GetPapyrusVm().AddObject', SERVER_CPP],
  ['disableVanillaScriptsInExterior', 'skymp5-server'],
];

// ------------------------------------------------------------- reading git --

function gitIn(dir, args) {
  return execFileSync('git', ['-C', dir].concat(args),
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

// The commit engine\skymp is pinned to in HEAD's tree.
function pinOf(repo) {
  return gitIn(repo || REPO, ['rev-parse', 'HEAD:engine/skymp']).trim();
}

// The fork folder: SKYMP when set, else the submodule.
function forkDir(repo) {
  return process.env.SKYMP || path.join(repo || REPO, 'engine', 'skymp');
}

// Whether the fork folder's git has this commit's objects.
function hasCommit(fork, commit) {
  try {
    if (!fs.existsSync(fork)) { return false; }
    return gitIn(fork, ['cat-file', '-t', commit]).trim() === 'commit';
  } catch (e) {
    return false;
  }
}

// What the reader reads at one commit. Each git started on the build box is
// a process, two behind Git's cmd\git.exe, and a Defender scan, and one list
// was about fifteen of them, a git show for every file and a git grep for
// every name (#3835). So the files, the folder listings and the searches a
// list needs are each read in one git (prefetch), and kept; a read nothing
// asked for beforehand still works, in a git of its own.
function Source(fork, commit) {
  this.fork = fork;
  this.commit = commit;
  this.blobs = {};   // path -> text, or null where the commit has no file there
  this.listed = {};  // folder -> its file names
  this.found = {};   // needle + '\0' + folder -> the files that hold it
}
const has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

// Files' text at the commit, from one git cat-file --batch.
Source.prototype.read = function (rels) {
  const self = this;
  const want = rels.filter(function (r) { return !has(self.blobs, r); });
  if (!want.length) { return; }
  const out = execFileSync('git', ['-C', this.fork, 'cat-file', '--batch'], {
    input: want.map(function (r) { return self.commit + ':' + r + '\n'; }).join(''),
    stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  let at = 0;
  want.forEach(function (r) {
    const nl = out.indexOf(10, at);
    const head = out.toString('utf8', at, nl);
    at = nl + 1;
    // "<object> <type> <size>", or "<what was asked> missing".
    const m = /^[0-9a-f]{40,64} (\w+) (\d+)$/.exec(head);
    if (!m) { self.blobs[r] = null; return; }
    const size = Number(m[2]);
    self.blobs[r] = m[1] === 'blob' ? out.toString('utf8', at, at + size) : null;
    at += size + 1;
  });
};
Source.prototype.show = function (rel) {
  this.read([rel]);
  if (this.blobs[rel] === null) { throw new Error(rel + ' is not a file at ' + this.commit); }
  return this.blobs[rel].split('\r').join('');
};

// The names in folders at the commit, from one git ls-tree.
Source.prototype.list = function (dirs) {
  const self = this;
  const want = dirs.filter(function (d) { return !has(self.listed, d); });
  if (!want.length) { return; }
  want.forEach(function (d) { self.listed[d] = []; });
  gitIn(this.fork, ['ls-tree', '--name-only', this.commit].concat(want.map(function (d) { return d + '/'; })))
    .split('\n').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (p) {
      want.forEach(function (d) {
        if (p.indexOf(d + '/') === 0) { self.listed[d].push(p.split('/').pop()); }
      });
    });
};
Source.prototype.names = function (dir) {
  this.list([dir]);
  return this.listed[dir].slice();
};

// Files under folders whose text holds fixed strings at the commit, for
// every [needle, folder] pair, from one git grep that prints each matching
// line, which is then put on the needles it holds.
Source.prototype.search = function (pairs) {
  const self = this;
  const want = pairs.filter(function (p) { return !has(self.found, p[0] + '\0' + p[1]); });
  if (!want.length) { return; }
  want.forEach(function (p) { self.found[p[0] + '\0' + p[1]] = []; });
  const needles = sortedUnique(want.map(function (p) { return p[0]; }));
  const dirs = sortedUnique(want.map(function (p) { return p[1]; }));
  let out = '';
  try {
    out = gitIn(this.fork, ['grep', '-z', '-a', '-n', '-F']
      .concat([].concat.apply([], needles.map(function (n) { return ['-e', n]; })))
      .concat([this.commit, '--']).concat(dirs));
  } catch (e) {
    if (e.status !== 1) { throw e; }   // 1: no line holds any of them
  }
  // "<commit>:<path>\0<line>\0<text>", a line each.
  out.split('\n').forEach(function (line) {
    const f = line.split('\0');
    if (f.length < 3) { return; }
    const file = f[0].slice(f[0].indexOf(':') + 1);
    const text = f.slice(2).join('\0');
    want.forEach(function (p) {
      const hits = self.found[p[0] + '\0' + p[1]];
      if (file.indexOf(p[1] + '/') === 0 && text.indexOf(p[0]) >= 0 && hits.indexOf(file) < 0) { hits.push(file); }
    });
  });
};
Source.prototype.grepFiles = function (needle, dir) {
  this.search([[needle, dir]]);
  return this.found[needle + '\0' + dir].slice();
};

// ---------------------------------------------------------- reading C++ --

// Code with its comments taken out. Strings are kept whole.
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') { i++; }
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { i++; }
      i += 2;
    } else if (c === '"' || (c === '\'' && !/[0-9A-Za-z_]/.test(text[i - 1] || ''))) {
      const q = c;
      out += c; i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') { out += text[i]; i++; }
        out += text[i]; i++;
      }
      out += q; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

function braceBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') { depth++; }
    else if (text[i] === '}') { depth--; if (depth === 0) { return text.slice(open + 1, i); } }
  }
  return null;
}

// The body of the function whose header is `header`, comments out.
function functionBody(code, header, where) {
  const a = code.indexOf(header);
  if (a < 0) { throw new Error(where + ': ' + header + ' is not there'); }
  const open = code.indexOf('{', a + header.length);
  const body = open < 0 ? null : braceBody(code, open);
  if (body === null) { throw new Error(where + ': the body of ' + header + ' does not close'); }
  return body;
}

function firstArg(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\') { i++; } i++; }
    } else if (c === '(') { depth++; }
    else if (c === ')') { if (depth === 0) { return text.slice(start, i).trim(); } depth--; }
    else if (c === ',' && depth === 0) { return text.slice(start, i).trim(); }
  }
  return null;
}

function literals(code) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(code)) !== null) { out.push(m[1]); }
  return out;
}

// A fingerprint of code that ignores comments and spacing.
function fingerprint(code) {
  const flat = stripComments(code).replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(flat, 'utf8').digest('hex');
}

function sortedUnique(list) {
  return list.filter(function (n, i, a) { return a.indexOf(n) === i; })
    .sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0; });
}

// ------------------------------------------------------------ the client --

function readClient(src) {
  const frida = stripComments(src.show(FILES.blocker));
  const body = functionBody(frida, 'void OnSendEventEnter(GumInvocationContext* ic)', FILES.blocker);

  const letsThrough = [];
  let m;
  const pass = /strcmp\(\s*\*eventName\s*,\s*"([^"]+)"\s*\)\s*!=\s*0/g;
  while ((m = pass.exec(body)) !== null) { letsThrough.push(m[1]); }

  // The SkyUI test: a pointer named for the prefix, then its characters
  // compared one by one, with case.
  const prefixes = [];
  const pre = /const\s+char\s*\*\s*(\w+)\s*=\s*"([^"]+)"\s*;/g;
  while ((m = pre.exec(body)) !== null) {
    const v = m[1], lit = m[2];
    const len = new RegExp('strlen\\(\\s*name\\s*\\)\\s*>=\\s*' + lit.length + '\\b').test(body);
    let every = true;
    for (let i = 0; i < lit.length; i++) {
      if (!new RegExp('name\\[' + i + '\\]\\s*==\\s*' + v + '\\[' + i + '\\]').test(body)) { every = false; }
    }
    if (!len || !every) { throw new Error(FILES.blocker + ': "' + lit + '" is not compared as a prefix of the script name in a way this reads'); }
    prefixes.push(lit);
  }

  const exemptNames = [];
  const named = /stricmp\(\s*name\s*,\s*"([^"]+)"\s*\)/g;
  while ((m = named.exec(body)) !== null) { exemptNames.push(m[1]); }

  // Every string in the hook has to be one of those, or the empty name it
  // blanks with.
  const known = letsThrough.concat(prefixes, exemptNames, ['']);
  const unknown = literals(body).filter(function (s) { return known.indexOf(s) < 0; });
  if (unknown.length) {
    throw new Error(FILES.blocker + ': OnSendEventEnter has strings this cannot place: ' +
      unknown.map(function (s) { return '"' + s + '"'; }).join(', '));
  }
  if (!/gum_invocation_context_replace_nth_argument\(\s*ic\s*,\s*2\s*,/.test(body)) {
    throw new Error(FILES.blocker + ': OnSendEventEnter no longer replaces the event name');
  }
  if (!/^\s*if\s*\(\s*Override::IsOverriden\(\)\s*\)\s*\{\s*return\s*;\s*\}/.test(body)) {
    throw new Error(FILES.blocker + ': OnSendEventEnter no longer starts by returning during a Skyrim Platform call');
  }

  // Who turns it on, and that nothing in the client turns it off.
  const service = src.show(FILES.service);
  const index = stripComments(src.show(FILES.clientIndex));
  const on = /blockPapyrusEvents\(\s*true\s*\)/.test(stripComments(service)) &&
             /new\s+BlockPapyrusEventsService\s*\(/.test(index);
  const offIn = src.grepFiles('blockPapyrusEvents(false)', 'skymp5-client/src');

  return {
    blockerOn: on && offIn.length === 0,
    letsThrough: sortedUnique(letsThrough),
    exemptPrefixes: sortedUnique(prefixes),
    exemptPrefixCase: 'kept',
    exemptNames: sortedUnique(exemptNames),
    exemptNameCase: 'ignored',
    neverBlanksDuringASkyrimPlatformCall: true,
    blockerFingerprint: fingerprint(body),
    serviceFingerprint: fingerprint(service),
  };
}

// ------------------------------------------------------------ the server --

function readServer(src) {
  // Every name a Papyrus event is sent under, read off every call.
  const sends = [], unread = [];
  const sending = src.grepFiles('SendPapyrusEvent', SERVER_CPP);
  src.read(sending.filter(function (f) { return /\.cpp$/.test(f); }));
  sending.forEach(function (file) {
    if (!/\.cpp$/.test(file)) { return; }
    const body = stripComments(src.show(file));
    const re = /(^|[^\w:])SendPapyrusEvent\s*\(/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const arg = firstArg(body, m.index + m[0].length);
      const names = (arg || '').match(/"([A-Za-z]+)"/g) || [];
      if (names.length) {
        names.forEach(function (s) { sends.push(s.replace(/"/g, '')); });
      } else if (!(path.basename(file) === 'PapyrusEventEvent.cpp' && arg === 'form')) {
        unread.push(path.basename(file) + ' ' + arg);
      }
    }
  });
  if (unread.length) {
    throw new Error('a SendPapyrusEvent call sends a name this cannot read: ' + unread.join('; '));
  }

  // Where scripts are loaded from.
  const storage = stripComments(src.show(FILES.storage));
  const kinds = ['DirectoryScriptStorage', 'BsaArchiveScriptStorage', 'AssetsScriptStorage'];
  const made = [];
  const mk = /make_shared<(\w+ScriptStorage)>/g;
  let m;
  while ((m = mk.exec(storage)) !== null) { made.push(m[1]); }
  const odd = made.filter(function (k) { return k !== 'CombinedScriptStorage' && kinds.indexOf(k) < 0; });
  if (odd.length) { throw new Error(FILES.storage + ': a script storage this does not know: ' + odd.join(', ')); }
  kinds.forEach(function (k) {
    if (made.indexOf(k) < 0) { throw new Error(FILES.storage + ': no ' + k + ' any more'); }
  });
  if (!/\/\s*"scripts"\s*\)/.test(storage)) { throw new Error(FILES.storage + ': the folder is no longer dataDir/scripts'); }
  if (!/"archives"/.test(storage)) { throw new Error(FILES.storage + ': archives no longer come from the "archives" setting'); }

  // CMake comments start with #; a C reader would take standard_scripts/* for one.
  const cmake = src.show(FILES.serverCmake).replace(/#[^\n]*/g, '');
  if (!/file\(\s*GLOB_RECURSE\s+standard_scripts[\s\S]*?standard_scripts\/\*/.test(cmake) ||
      !/cmrc_add_resource_library\(\s*server_standard_scripts\s+\$\{standard_scripts\}/.test(cmake)) {
    throw new Error(FILES.serverCmake + ': the built in scripts are no longer every file in standard_scripts');
  }
  const stem = function (f) { return f.replace(/\.pex$/i, ''); };
  const builtIn = sortedUnique(src.names(STANDARD_DIR).filter(function (f) { return /\.pex$/i.test(f); }).map(stem));
  const dataScripts = sortedUnique(src.names(DATA_PEX_DIR).filter(function (f) { return /\.pex$/i.test(f); }).map(stem));

  // What gets attached, and what is dropped.
  const refr = stripComments(src.show(FILES.refr));
  const init = functionBody(refr, 'void MpObjectReference::InitScripts()', FILES.refr);
  if (!/for\s*\(\s*auto\s+record\s*:\s*\{\s*base\.rec\s*,\s*refr\.rec\s*\}\s*\)/.test(init)) {
    throw new Error(FILES.refr + ': InitScripts no longer reads a reference\'s own record and its base record');
  }
  const attachers = src.grepFiles('GetPapyrusVm().AddObject', SERVER_CPP);
  if (attachers.length !== 1 || attachers[0] !== FILES.refr) {
    throw new Error('scripts are attached somewhere other than InitScripts: ' + attachers.join(', '));
  }
  const drops = [];
  const dn = /stricmp\(\s*val\.data\(\)\s*,\s*"([^"]+)"\s*\)/g;
  while ((m = dn.exec(init)) !== null) { drops.push(m[1]); }
  const sweet = /kPrefix\s*=\s*"([^"]+)"/.exec(init);
  const below = /GetFormId\(\)\s*<\s*(0x[0-9A-Fa-f]+)/.exec(init);
  const ws = stripComments(src.show(FILES.worldState));
  const flag = /bool\s+disableVanillaScriptsInExterior\s*=\s*(true|false)\s*;/.exec(ws);
  if (!sweet || !below || !flag) { throw new Error(FILES.refr + ': the exterior rule in InitScripts is not in a shape this reads'); }
  const setters = src.grepFiles('disableVanillaScriptsInExterior', 'skymp5-server')
    .filter(function (f) { return f !== FILES.refr && f !== FILES.worldState; });

  return {
    sends: sortedUnique(sends),
    attachesTo: 'references',
    dropsByName: sortedUnique(drops),
    exterior: {
      on: flag[1] === 'true' && setters.length === 0,
      formIdBelow: below[1].toLowerCase(),
      keepsPrefix: sweet[1],
    },
    loads: { builtIn: builtIn, dataScripts: dataScripts },
    storageFingerprint: fingerprint(storage),
    attachFingerprint: fingerprint(init),
  };
}

// The list at one commit of one fork folder.
function readList(fork, commit) {
  const src = new Source(fork, commit);
  src.read(Object.keys(FILES).map(function (k) { return FILES[k]; }));
  src.list([STANDARD_DIR, DATA_PEX_DIR]);
  src.search(SEARCHES);
  return { client: readClient(src), server: readServer(src) };
}

// ------------------------------------------------------- the repository --

// Every file here that writes or edits the server's settings, and whether
// any of them names an "archives" setting. Comments are left out.
function archivesWriters(repo) {
  const dirs = ['scripts/deploy', 'installer'];
  const hits = [];
  dirs.forEach(function (d) {
    const full = path.join(repo, d);
    if (!fs.existsSync(full)) { return; }
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); return; }
        if (!/\.(ps1|psm1|js|json|cmd|bat)$/i.test(e.name)) { return; }
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        lines.forEach(function (line, i) {
          const code = line.replace(/(^|\s)#.*$/, '').replace(/\/\/.*$/, '');
          if (/(^|[^\w-])['"]?archives['"]?\s*(=|:)(?!=)/.test(code)) {
            hits.push(path.relative(repo, p).split(path.sep).join('/') + ':' + (i + 1));
          }
        });
      });
    })(full);
  });
  return hits;
}

function readRecord(file) {
  return JSON.parse(fs.readFileSync(file || RECORD, 'utf8'));
}

// The parts of the record the fork decides, as one comparable object.
function forkPart(rec) {
  const c = rec.client || {}, s = rec.server || {};
  return {
    client: {
      blockerOn: c.blockerOn, letsThrough: c.letsThrough, exemptPrefixes: c.exemptPrefixes,
      exemptPrefixCase: c.exemptPrefixCase, exemptNames: c.exemptNames, exemptNameCase: c.exemptNameCase,
      neverBlanksDuringASkyrimPlatformCall: c.neverBlanksDuringASkyrimPlatformCall,
      blockerFingerprint: c.blockerFingerprint, serviceFingerprint: c.serviceFingerprint,
    },
    server: {
      sends: s.sends, attachesTo: s.attachesTo, dropsByName: s.dropsByName, exterior: s.exterior,
      loads: { builtIn: (s.loads || {}).builtIn, dataScripts: (s.loads || {}).dataScripts },
      storageFingerprint: s.storageFingerprint, attachFingerprint: s.attachFingerprint,
    },
  };
}

// Each place the record and the fork's list differ, in words.
function differences(rec, list) {
  const a = forkPart(rec), b = forkPart(list);
  const out = [];
  (function walk(x, y, at) {
    if (Array.isArray(x) || Array.isArray(y)) {
      const xs = Array.isArray(x) ? x : [], ys = Array.isArray(y) ? y : [];
      const gone = xs.filter(function (n) { return ys.indexOf(n) < 0; });
      const added = ys.filter(function (n) { return xs.indexOf(n) < 0; });
      if (gone.length || added.length || !Array.isArray(x) || !Array.isArray(y)) {
        out.push(at + ': ' + (added.length ? 'the fork adds ' + added.join(', ') : '') +
          (added.length && gone.length ? '; ' : '') + (gone.length ? 'the fork no longer has ' + gone.join(', ') : '') +
          (!added.length && !gone.length ? 'missing from the record' : ''));
      }
      return;
    }
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      Object.keys(Object.assign({}, x, y)).forEach(function (k) { walk(x[k], y[k], at ? at + '.' + k : k); });
      return;
    }
    if (x !== y) {
      out.push(at + ': the record says ' + JSON.stringify(x) + ', the fork says ' + JSON.stringify(y) +
        (/Fingerprint$/.test(at) ? ' (that code changed: read it at the pin before rewriting the record)' : ''));
    }
  })(a, b, '');
  return out;
}

const NOTE = 'The fork\'s Papyrus event list, both halves, read out of the fork\'s source at readAt by ' +
  'scripts\\dev\\PapyrusEventList.js (issue #503). A game script fires only where both halves let it. ' +
  'client: what the blocker in skyrim-platform FridaHooks.cpp (OnSendEventEnter) lets through on each ' +
  'person\'s machine, where a script that runs is seen by that one machine only. server: the event names ' +
  'the server\'s own Papyrus machine is sent, and which scripts it can load and attach (only to placed ' +
  'references). loads.archives is not the fork\'s: it is the "archives" setting Thornswood writes, which ' +
  'no deploy script writes today. The fingerprints hold the code too intricate to read as a list. ' +
  'game\\tests\\test-papyrus-event-list.js holds this to the fork at the pin; when the fork changes the list, ' +
  'run node scripts\\dev\\PapyrusEventList.js --write and commit what it writes.';

function build(list, commit, archives) {
  return {
    _note: NOTE,
    readAt: commit,
    client: list.client,
    server: Object.assign({}, list.server, {
      loads: { builtIn: list.server.loads.builtIn, dataScripts: list.server.loads.dataScripts, archives: archives || [] },
    }),
  };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = function (name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const write = args.indexOf('--write') >= 0;
  const fork = opt('--fork') || forkDir(REPO);
  let commit = opt('--commit');
  try { commit = commit || pinOf(REPO); } catch (e) {
    console.log('STOP. Cannot read the engine pin from this checkout: ' + e.message);
    return 2;
  }
  if (!hasCommit(fork, commit)) {
    console.log('STOP. ' + fork + ' does not have the fork commit ' + commit + '.');
    console.log('  git submodule update --init engine/skymp   fetches it at the pin.');
    return 2;
  }
  let list;
  try { list = readList(fork, commit); } catch (e) {
    console.log('STOP. The fork at ' + commit.slice(0, 8) + ' cannot be read as a list: ' + e.message);
    console.log('  Read the code it names, then teach this script the new shape.');
    return 1;
  }
  let rec = null;
  try { rec = readRecord(); } catch (e) { rec = null; }
  if (write) {
    const archives = rec && rec.server && rec.server.loads && Array.isArray(rec.server.loads.archives) ? rec.server.loads.archives : [];
    const out = build(list, commit, archives);
    fs.writeFileSync(RECORD, JSON.stringify(out, null, 2) + '\n');
    const was = rec ? differences(rec, list) : ['there was no record'];
    console.log('Wrote records\\papyrus-events.json from the fork at ' + commit.slice(0, 8) + '.');
    if (was.length) {
      console.log('What changed in the list:');
      was.forEach(function (d) { console.log('  ' + d); });
      console.log('Rerun py scripts\\dev\\Audit-PapyrusEvents.py and put what it says on issue #503.');
    } else {
      console.log('The list itself is the same; only readAt moved.');
    }
    return 0;
  }
  if (!rec) { console.log('There is no records\\papyrus-events.json. Write it with --write.'); return 1; }
  const diff = differences(rec, list);
  if (diff.length) {
    console.log('records\\papyrus-events.json is not the fork\'s list at ' + commit.slice(0, 8) + ':');
    diff.forEach(function (d) { console.log('  ' + d); });
    console.log('Write it again: node scripts\\dev\\PapyrusEventList.js --write');
    return 1;
  }
  console.log('records\\papyrus-events.json is the fork\'s list at ' + commit.slice(0, 8) +
    (rec.readAt === commit ? '.' : ' (read at ' + String(rec.readAt).slice(0, 8) + ', the same list).'));
  return 0;
}

module.exports = {
  RECORD: RECORD, FILES: FILES, pinOf: pinOf, forkDir: forkDir, hasCommit: hasCommit,
  readList: readList, readRecord: readRecord, differences: differences, archivesWriters: archivesWriters,
  stripComments: stripComments, fingerprint: fingerprint, build: build,
};

if (require.main === module) { process.exit(main(process.argv)); }
