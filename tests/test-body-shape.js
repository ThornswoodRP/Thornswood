/*
  test-body-shape.js

      node .\tests\test-body-shape.js

  Body shape stays as made: height and weight, nothing else, and no jiggle.
  Issue #993.

  Patrick, 28 September: "I don't want jiggle physics or the ability to change
  boob/pussy/dick/ass/nipple related stuff during creation." For men and women
  alike. Height and weight stay. And, the same night: characters made before
  this are reset to the default shape.

  THREE PLACES, AND ALL THREE ARE RUN HERE.

  THE SERVER. The BODY SHAPE block is lifted out of game\gamemode.js and run
  against a pretend mp. An appearance that carries a weight past 0 to 100, or
  a field the engine does not know (a breast size, a body morph list), is set
  back with the weight held and the field gone, while the face, the race, the
  sex and a weight inside the range come through untouched. The handler never
  returns false and does nothing to an appearance the engine refused. The
  switch for characters made before, thornswoodBodyReset, is on with no
  setting, runs once per character when it comes online, and is off only when
  the setting is false.

  THE CREATION MENU. The launcher leaves the three body slider scripts and
  CBPC's cbp.dll out of its game folder and takes them out of a folder that
  has them (OwnGame.BodyShapeFiles, Rules 9), and no pack or installer
  carries them (Ship-Rules.ps1, asked through PowerShell). On a machine with a
  game folder, every loose RaceMenu slider script that offers a body shape
  slider is one of those three, and none of the four files is in a folder
  refreshed under Rules 9. Anywhere else that part says SKIP.

  THE PERSON'S OWN GAME. The "body shape" block is lifted out of
  thornswood-front.js and run against a pretend Skyrim Platform with a
  pretend NiOverride. While the race menu is up it takes every change off the
  breast, seat and genital bones RaceMenu's own sliders move, clears body
  morphs, and leaves the height on the root bone and the head alone; out of
  the menu it looks every ten seconds, which is what takes a changed body off
  a character made before; with no NiOverride it does nothing and says so
  once.

  Read only, apart from asking PowerShell what Ship-Rules.ps1 answers.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BS = String.fromCharCode(92);
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function skip(what) { console.log('SKIP  ' + what); }

const gm = read(process.env.GAMEMODE || path.join(ROOT, 'game', 'gamemode.js'));
const front = read(process.env.FRONT || path.join(ROOT, 'game', 'plugins', 'thornswood-front.js'));
const og = read(path.join(ROOT, 'launcher', 'app', 'OwnGame.cs'));
const SHIP_RULES = path.join(ROOT, 'scripts', 'release', 'Ship-Rules.ps1');
const rules = read(SHIP_RULES);

// ============================================================== the server ==

const gmFrom = gm.indexOf('  BODY SHAPE: HEIGHT AND WEIGHT, NOTHING ELSE (#993).');
const gmStart = gmFrom < 0 ? -1 : gm.lastIndexOf('/*', gmFrom);
const gmEndMark = '  }), 5000);\n})();\n';
const gmEnd = gmStart < 0 ? -1 : gm.indexOf(gmEndMark, gmStart);
const gmBlock = gmStart < 0 || gmEnd < 0 ? null : gm.slice(gmStart, gmEnd + gmEndMark.length);
yes('the BODY SHAPE block is in the gamemode', gmBlock !== null);
/*
  What the handler reaches outside the block since #1573: the face arriving
  moves a person in the creation hall on (hasStoredAppearance, chargenOf).
  Lifted from the gamemode as they are, so the handler here runs what the
  server runs. Nobody here is in the hall: chargenOf reads no chargen
  property off this mp. test-unpublished-until-appearance.js has the rest.
*/
function topFn(sig) {
  const a = gm.indexOf('\n' + sig);
  const b = a < 0 ? -1 : gm.indexOf('\n}\n', a + 1);
  return a < 0 || b < 0 ? null : gm.slice(a + 1, b + 3);
}
const storedFn = topFn('function hasStoredAppearance(a) {');
const chargenOfFn = topFn('function chargenOf(actorId) {');
const chargenProp = (/^const CHARGEN_PROPERTY = '[^']+';$/m.exec(gm) || [])[0] || null;
yes('hasStoredAppearance, chargenOf and CHARGEN_PROPERTY are in the gamemode', !!(storedFn && chargenOfFn && chargenProp));

function server(settings, stored) {
  const sets = [];
  const logs = [];
  const timers = [];
  const mp = {
    getServerSettings: function () { if (settings === 'throw') { throw new Error('none'); } return settings; },
    get: function (id, prop) {
      if (id === 0 && prop === 'onlinePlayers') { return Object.keys(stored).map(Number); }
      if (prop === 'appearance') { return stored[id] === undefined ? null : JSON.parse(JSON.stringify(stored[id])); }
      throw new Error('no ' + prop);
    },
    set: function (id, prop, v) { sets.push({ id: id, prop: prop, v: v }); if (prop === 'appearance') { stored[id] = v; } },
  };
  const ctx = {
    mp: mp,
    globalThis: {},
    log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    guard: function (name, fn) { return fn; },
    auditPerson: function (id) { return 'person ' + id; },
    setInterval: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
    clearInterval: function () { },
    isFinite: isFinite, Number: Number, String: String, Object: Object, Array: Array, Set: Set,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext([chargenProp, storedFn, chargenOfFn].join('\n') + '\n' + gmBlock +
    '\n;this.__g = bodyShapeGuard; this.__h = mp.onUpdateAppearanceAttempt;', ctx);
  return { ctx: ctx, mp: mp, sets: sets, logs: logs, timers: timers, guard: ctx.__g, handler: ctx.__h };
}

function face(extra) {
  const a = { isFemale: true, raceId: 0x13746, weight: 40, skinColor: -1, hairColor: 12, headpartIds: [1, 2],
              headTextureSetId: 7, options: new Array(19).fill(0.25), presets: [1, 2, 3, 4],
              tints: [{ texturePath: 'x', argb: 1, type: 0 }], name: 'Ada' };
  return Object.assign(a, extra || {});
}

if (gmBlock !== null) {
  const s = server(undefined, {});
  yes('bodyShapeGuard and the handler come out of the block', typeof s.guard === 'function' && typeof s.handler === 'function');

  const same = s.guard(face());
  yes('an appearance with a weight inside 0 to 100 comes through with nothing changed',
      same && same.changes.length === 0 && JSON.stringify(same.appearance) === JSON.stringify(face()));

  const fat = s.guard(face({ weight: 300 }));
  yes('a weight of 300 is held to 100', fat && fat.appearance.weight === 100 && fat.changes.length === 1);
  const thin = s.guard(face({ weight: -200 }));
  yes('a weight of -200 is held to 0', thin && thin.appearance.weight === 0);
  const nan = s.guard(face({ weight: null }));
  yes('a weight that is not a number (NaN arrives as null) becomes 50', nan && nan.appearance.weight === 50);
  const edge = s.guard(face({ weight: 100 }));
  yes('100 and 0 themselves are kept', edge && edge.changes.length === 0 && s.guard(face({ weight: 0 })).changes.length === 0);

  const body = s.guard(face({ bodyMorphs: { Breasts: 1, NippleLength: 1, Butt: 1, Vaginasize: 1 },
                               breastScale: 3, nodeScales: { 'NPC L Butt': 2 } }));
  yes('a field the engine does not know (body morphs, a breast scale, bone scales) is dropped',
      body && !('bodyMorphs' in body.appearance) && !('breastScale' in body.appearance) &&
      !('nodeScales' in body.appearance) && body.changes.length === 3);
  yes('and the face, race, sex, hair, tints and name around it are kept exactly',
      body && JSON.stringify(body.appearance) === JSON.stringify(face()));
  yes('there is nothing to look at in no appearance', s.guard(null) === null && s.guard([]) === null);

  // The handler, as the engine calls it: (actor, appearance, isAllowed).
  const h = server(undefined, {});
  const r1 = h.handler(0xff000001, face({ weight: 250 }), true);
  yes('an accepted appearance with a weight of 250 is set back at 100',
      h.sets.length === 1 && h.sets[0].id === 0xff000001 && h.sets[0].prop === 'appearance' && h.sets[0].v.weight === 100);
  yes('and it is said in the log', h.logs.some(function (l) { return /body shape: person \d+ sent: weight 250 -> 100/.test(l); }));
  const r2 = h.handler(0xff000002, face(), true);
  yes('a normal appearance is not set again', h.sets.length === 1);
  const r3 = h.handler(0xff000003, face({ weight: 999 }), false);
  yes('an appearance the engine refused is left alone', h.sets.length === 1);
  yes('the handler returns true every time, never false', r1 === true && r2 === true && r3 === true);

  // Characters made before: the switch.
  const stored = { 16: face({ weight: 180 }), 17: face(), 18: undefined };
  const on = server(undefined, stored);
  yes('thornswoodBodyReset: with no setting the reset is on, one timer', on.timers.length === 1);
  if (on.timers.length) {
    on.timers[0].fn();
    yes('a character stored with a weight of 180 is set back at 100 when it comes online',
        on.sets.length === 1 && on.sets[0].id === 16 && on.sets[0].v.weight === 100);
    yes('a normal one and one with no appearance are left alone', on.sets.filter(function (x) { return x.id !== 16; }).length === 0);
    stored[16].weight = 190;
    on.timers[0].fn();
    yes('each character is looked at once while it stays online', on.sets.length === 1);
  }
  yes('the reset is on when the setting is true or anything but false',
      server({ thornswoodBodyReset: true }, {}).timers.length === 1 &&
      server({ thornswoodBodyReset: 'yes' }, {}).timers.length === 1 &&
      server('throw', {}).timers.length === 1);
  const off = server({ thornswoodBodyReset: false }, { 20: face({ weight: 500 }) });
  yes('thornswoodBodyReset: false turns it off, and it says so', off.timers.length === 0 &&
      off.logs.some(function (l) { return /thornswoodBodyReset is false/.test(l); }));

  yes('the gamemode registers the handler once, built with guard()',
      (gm.match(/^mp\.onUpdateAppearanceAttempt = guard\('onUpdateAppearanceAttempt', function/mg) || []).length === 1);
  yes('the list of events no longer says onUpdateAppearanceAttempt has no handler',
      !/onUpdateAppearanceAttempt\s+A face sent to the server\. No handler/.test(gm));
}

// ========================================================= the creation menu ==

function member(src, header) {
  const at = src.indexOf(header);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}
const listSrc = member(og, 'static readonly string[] BodyShapeFiles =');
const listed = [];
if (listSrc) {
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(listSrc)) !== null) listed.push(m[1].split(BS + BS).join(BS));
}
const WANT = ['Data' + BS + 'SKSE' + BS + 'Plugins' + BS + 'cbp.dll',
              'Data' + BS + 'Scripts' + BS + 'RaceMenuMorphsCBBE.pex',
              'Data' + BS + 'Scripts' + BS + '_RaceMenuMorphsHIMBO.pex',
              'Data' + BS + 'Scripts' + BS + 'RaceMenuPluginSoS.pex'];
yes('OwnGame.BodyShapeFiles lists the jiggle DLL and the three body slider scripts, and nothing else',
    listed.length === WANT.length && WANT.every(function (w) { return listed.indexOf(w) >= 0; }));
yes('and nothing that height or weight comes from (RaceMenu itself, its plugin script, the skeleton\'s own sliders)',
    !listed.some(function (l) { return /skee64|RaceMenu\.(esp|bsa)|RaceMenuPlugin\.pex|RaceMenuPluginXPMSE|hdtsmp64/i.test(l); }));

const skipBody = member(og, 'static string Skip(string rel)');
yes('Skip leaves them out when a folder is made or refreshed',
    skipBody !== null && /if \(BodyShape\(rel\)\) return "/.test(skipBody));
const refresh = member(og, 'static string RefreshNow(Config cfg, Action<string> say)');
const loopAt = refresh ? refresh.indexOf('foreach (string r in BodyShapeFiles)') : -1;
yes('Refresh deletes them from a folder that has them, recorded or not',
    loopAt >= 0 && /if \(File\.Exists\(dest\)\) \{ DropName\(dest\); removed\+\+; \}/.test(refresh.slice(loopAt, loopAt + 400)));
const rulesNum = /(?:^|\n)\s*const int Rules = (\d+);/.exec(og);
const rulesDoc = /\/\/\/ (\d+): body shape sliders and jiggle/.exec(og);
yes('Rules moved to 9 for it, so every folder already made refreshes once and drops them',
    rulesNum !== null && rulesDoc !== null && Number(rulesDoc[1]) === 9 && Number(rulesNum[1]) >= 9);

const shipBlock = /\$ShipBodyShapeFiles = @\(([\s\S]*?)\)/.exec(rules);
const shipOf = [];
if (shipBlock) {
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(shipBlock[1])) !== null) shipOf.push(m[1]);
}
yes('Ship-Rules.ps1 lists the same four as OwnGame',
    shipOf.length === listed.length && shipOf.every(function (s) {
      return listed.some(function (r) { return r.toLowerCase() === s.toLowerCase(); });
    }));
yes('and Test-ShipMachine asks Test-ShipBodyShape',
    /function Test-ShipMachine\([^)]*\) \{[\s\S]*?if \(Test-ShipBodyShape \$rel\) \{ return \$true \}/.test(rules));

const probe = WANT.concat(['data' + BS + 'skse' + BS + 'plugins' + BS + 'CBP.DLL',
                           'Data' + BS + 'Scripts' + BS + 'RaceMenuPlugin.pex',
                           'Data' + BS + 'SKSE' + BS + 'Plugins' + BS + 'hdtsmp64.dll']);
const cmd = ". '" + SHIP_RULES.replace(/'/g, "''") + "'; " +
  probe.map(function (p) { return "'" + p + "=' + [string](Test-ShipBodyShape '" + p + "')"; }).join('; ');
let run = null;
const env = Object.assign({}, process.env);
for (const k of Object.keys(env)) if (k.toLowerCase() === 'psmodulepath') delete env[k];
for (const shell of ['pwsh', 'powershell']) {
  run = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
                  { encoding: 'utf8', env: env });
  if (!run.error) break;
}
if (!run || run.error) {
  skip('no PowerShell here to ask Ship-Rules.ps1');
} else {
  const got = {};
  String(run.stdout || '').split(/\r?\n/).forEach(function (l) {
    const i = l.lastIndexOf('=');
    if (i > 0) got[l.slice(0, i)] = l.slice(i + 1).trim();
  });
  yes('Ship-Rules.ps1 dot-sources and answers', run.status === 0 && Object.keys(got).length === probe.length);
  if (run.status !== 0) console.log(run.stderr);
  yes('no pack or installer carries any of the four, in any letter case',
      WANT.every(function (w) { return got[w] === 'True'; }) && got[probe[4]] === 'True');
  yes('RaceMenu\'s own plugin script (height) and FSMP (hair and capes) are not caught',
      got[probe[5]] === 'False' && got[probe[6]] === 'False');
}

// On this machine: the scripts RaceMenu would show.
const GAME = process.env.GAME || 'C:' + BS + 'Thornswood' + BS + 'Game';
const DATA = path.join(GAME, 'Data');
const BODY_WORDS = /breast|butt|glute|genital|nipple|vagina|pussy|scrot|schlong|penis|clit/i;
const srcDirs = [path.join(DATA, 'Scripts', 'Source'), path.join(DATA, 'Source', 'Scripts')];
const seenScripts = {};
for (const d of srcDirs) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!/\.psc$/i.test(f)) continue;
    const text = read(path.join(d, f));
    if (!/extends\s+RaceMenuBase/i.test(text)) continue;
    const sliderLines = text.split('\n').filter(function (l) { return /AddSlider/i.test(l) && !/^\s*;/.test(l); });
    const offersBody = sliderLines.some(function (l) { return BODY_WORDS.test(l); }) ||
                       /SetBodyMorph|SetMorphValue/i.test(text);
    seenScripts[f.replace(/\.psc$/i, '').toLowerCase()] = offersBody;
  }
}
const names = Object.keys(seenScripts);
if (!names.length) {
  skip('no game folder with RaceMenu slider scripts at ' + DATA);
} else {
  const leftOut = listed.map(function (l) { return path.basename(l).replace(/\.pex$/i, '').toLowerCase(); });
  const bodyScripts = names.filter(function (n) { return seenScripts[n]; });
  const missed = bodyScripts.filter(function (n) { return leftOut.indexOf(n) < 0; });
  yes('every loose RaceMenu slider script on this machine that offers a body shape slider is left out (' +
      bodyScripts.join(', ') + ')' + (missed.length ? '; not left out: ' + missed.join(', ') : ''),
      bodyScripts.length > 0 && missed.length === 0);
  yes('and the ones left in offer none (' + names.filter(function (n) { return !seenScripts[n]; }).join(', ') + ')',
      names.filter(function (n) { return !seenScripts[n] && leftOut.indexOf(n) >= 0; }).length === 0);

  const made = path.join(GAME, '..', 'Profile', 'OwnGame', 'made.txt');
  let madeRules = null;
  try {
    const m = /^rules=(\d+)$/m.exec(read(made));
    madeRules = m ? Number(m[1]) : null;
  } catch (e) { madeRules = null; }
  if (madeRules === null || madeRules < 9) {
    skip('this game folder was not refreshed under Rules 9 yet (' + (madeRules === null ? 'no record' : 'rules ' + madeRules) +
         '), so the four files may still be there');
  } else {
    const still = WANT.filter(function (w) { return fs.existsSync(path.join(GAME, w)); });
    yes('none of the four is in this game folder' + (still.length ? ': ' + still.join(', ') : ''), still.length === 0);
  }
}

// ======================================================= the person's game ==

const frFrom = front.indexOf('  const BODY_NODES = [');
const frEndMark = "\n  }));\n";
const frHandler = frFrom < 0 ? -1 : front.indexOf("sp.on('update', guard('body shape', () => {", frFrom);
const frEnd = frHandler < 0 ? -1 : front.indexOf(frEndMark, frHandler);
const frBlock = frFrom < 0 || frEnd < 0 ? null : front.slice(frFrom, frEnd + frEndMark.length);
yes('the "body shape" block is in the front plugin', frBlock !== null);
yes('and its note names what the launcher leaves out and why the rest is undone here',
    /OwnGame\.BodyShapeFiles/.test(front) && /beside Height, which stays/.test(front));

// RaceMenu's own body sliders, read out of RaceMenuPlugin.psc in RaceMenu.bsa
// (RaceMenu Anniversary Edition 0.4.20) on 28 September: the nodes its
// breast, breast curve and glute sliders scale, and the two it must not lose.
const RACEMENU_BODY = ['NPC L Breast', 'NPC R Breast', 'NPC L Breast01', 'NPC R Breast01', 'NPC L Butt', 'NPC R Butt'];
const RACEMENU_KEEP = ['NPC', 'NPC Head [Head]'];

function game(opts) {
  const calls = [];
  const logs = [];
  const handlers = [];
  let now = 1000;
  const state = { menu: false, morphs: opts.morphs || [], keys: opts.keys || {} };
  const base = { getSex: function () { return opts.female ? 1 : 0; } };
  const pc = { getBaseObject: function () { return base; } };
  const sp = {
    Game: { getPlayer: function () { return pc; } },
    ActorBase: { from: function (f) { return f; } },
    on: function (ev, fn) { handlers.push({ ev: ev, fn: fn }); },
    callNative: function (cls, fn, self) {
      const a = Array.prototype.slice.call(arguments, 3);
      calls.push({ cls: cls, fn: fn, self: self, args: a });
      if (opts.noSkee) { throw new Error('Unable to find NiOverride.' + fn); }
      if (cls !== 'NiOverride') { throw new Error('not faked: ' + cls); }
      const k = function () { return (a[1] ? '1' : '3') + '|' + a[3]; };
      switch (fn) {
        case 'GetMorphNames': return state.morphs.slice();
        case 'ClearMorphs': state.morphs = []; return undefined;
        case 'UpdateModelWeight': return undefined;
        case 'GetNodeTransformKeys': return (state.keys[k()] || []).slice();
        case 'RemoveNodeTransformScale': {
          const list = state.keys[k()] || [];
          state.keys[k()] = list.filter(function (x) { return x !== a[4]; });
          return true;
        }
        case 'RemoveNodeTransformPosition': case 'RemoveNodeTransformRotation': case 'UpdateNodeTransform':
          return true;
      }
      throw new Error('not faked: ' + fn);
    },
  };
  const ctx = {
    sp: sp,
    log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    guard: function (name, fn) { return fn; },
    raceMenuOpen: function () { return state.menu; },
    Date: { now: function () { return now; } },
    Array: Array,
  };
  vm.createContext(ctx);
  vm.runInContext(frBlock + '\n;this.__reset = bodyShapeReset; this.__nodes = BODY_NODES;', ctx);
  const upd = handlers.filter(function (h) { return h.ev === 'update'; });
  return {
    calls: calls, logs: logs, state: state, nodes: ctx.__nodes, reset: ctx.__reset,
    frame: function () { upd.forEach(function (h) { h.fn(); }); },
    at: function (t) { now = t; },
    updates: upd.length,
  };
}

if (frBlock !== null) {
  const g0 = game({});
  yes('it registers one update handler', g0.updates === 1);
  yes('its bones cover every body slider RaceMenu itself shows (breast, breast curve, glute)',
      RACEMENU_BODY.every(function (n) { return g0.nodes.indexOf(n) >= 0; }));
  yes('and the skeleton\'s genital bones and the women\'s body\'s own',
      ['NPC GenitalsBase [GenBase]', 'NPC Genitals01 [Gen01]', 'NPC GenitalsScrotum [GenScrot]', 'VaginaB1', 'Clitoral1']
        .every(function (n) { return g0.nodes.indexOf(n) >= 0; }));
  yes('and never the root bone that is height, or the head',
      RACEMENU_KEEP.every(function (n) { return g0.nodes.indexOf(n) < 0; }));

  const keys = {
    '3|NPC L Breast': ['RSMPlugin'], '1|NPC L Breast': ['RSMPlugin'], '3|NPC R Butt': ['RSMPlugin', 'Other'],
    '3|NPC Genitals01 [Gen01]': ['XPMSE'],
    '3|NPC': ['RSMPlugin'], '3|NPC Head [Head]': ['RSMPlugin'],
  };
  const g = game({ female: true, morphs: ['Breasts', 'NippleLength', 'Butt', 'VaginaSize'], keys: keys });
  g.state.menu = true;
  g.at(5000);
  g.frame();
  yes('with the race menu up, the breast, seat and genital changes are all taken off',
      !(g.state.keys['3|NPC L Breast'] || []).length && !(g.state.keys['1|NPC L Breast'] || []).length &&
      !(g.state.keys['3|NPC R Butt'] || []).length && !(g.state.keys['3|NPC Genitals01 [Gen01]'] || []).length);
  yes('and the body morphs are cleared and the body redrawn',
      g.state.morphs.length === 0 && g.calls.some(function (c) { return c.fn === 'ClearMorphs'; }) &&
      g.calls.some(function (c) { return c.fn === 'UpdateModelWeight'; }));
  yes('the height on the root bone and the head size are left as made',
      (g.state.keys['3|NPC'] || []).join() === 'RSMPlugin' && (g.state.keys['3|NPC Head [Head]'] || []).join() === 'RSMPlugin');
  yes('it asks with the character\'s own sex, as RaceMenu stored them',
      g.calls.filter(function (c) { return c.fn === 'GetNodeTransformKeys'; }).every(function (c) { return c.args[2] === true; }));
  yes('every call is a NiOverride global, on the person\'s own character',
      g.calls.every(function (c) { return c.cls === 'NiOverride' && c.self === undefined; }));
  yes('nothing is logged while the menu is up', g.logs.length === 0);

  // A slider dragged again: undone at the next half second, not before.
  g.state.keys['3|NPC L Breast'] = ['RSMPlugin'];
  const before = g.calls.length;
  g.at(5300); g.frame();
  yes('inside half a second nothing is asked', g.calls.length === before);
  g.at(5550); g.frame();
  yes('at half a second it is taken off again', !(g.state.keys['3|NPC L Breast'] || []).length);

  g.state.menu = false;
  g.at(5600); g.frame();
  yes('when the menu closes it looks once more and says how much it took off, once',
      g.logs.length === 1 && /body shape: took \d+ body change\(s\) back off the character/.test(g.logs[0]));

  // Out of the menu: every ten seconds.
  const c1 = g.calls.length;
  g.at(12000); g.frame();
  yes('out of the menu it does not look again inside ten seconds', g.calls.length === c1);
  g.state.morphs = ['Breasts'];
  g.at(15700); g.frame();
  yes('and at ten seconds it clears a body morph a character made before this still had', g.state.morphs.length === 0);

  const male = game({ female: false, keys: { '3|NPC GenitalsBase [GenBase]': ['XPMSE'] } });
  male.at(100000); male.frame();
  yes('a man\'s genital bone changes are taken off the same way',
      !(male.state.keys['3|NPC GenitalsBase [GenBase]'] || []).length &&
      male.calls.filter(function (c) { return c.fn === 'GetNodeTransformKeys'; }).every(function (c) { return c.args[2] === false; }));

  const bare = game({ noSkee: true });
  bare.at(100000); bare.frame();
  const n1 = bare.calls.length;
  bare.at(200000); bare.frame();
  yes('with no NiOverride it stops after one try and says so once',
      n1 === 1 && bare.calls.length === 1 && bare.logs.length === 1 && /NiOverride is not there/.test(bare.logs[0]));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
