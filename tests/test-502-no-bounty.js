// test-502-no-bounty.js
//
// #502. Patrick, 12 October: no bounty for anything, killing, attacking,
// theft, pickpocketing or trespass, "the whole bounty system should be
// removed in its entirety". Nothing Thornswood wrote adds a bounty; Skyrim's
// own crime system does, in each person's game, through the faction that
// tracks the crime. The front plugin sets all six ignore flags (murder,
// assault, stealing, trespass, pickpocket, werewolf) on every faction that
// tracks crime, once a game is loaded. scripts\dev\Build-CrimeTable.py reads
// the factions and every script out of the load order.
//
// This holds together:
//   - the load order itself, when this machine has one: the script is run
//     against it and must read exactly what game\data\crime-factions.json
//     says, so the committed table is the load order and not an old reading;
//   - the plugin's NO_BOUNTY_FACTIONS block and the json, the same factions,
//     every one of them tracking crime, and every hold's crime faction the
//     gamemode knows among them, with the ones that carry their own amounts;
//   - the plugin's noBounty, run against a stand-in Skyrim Platform: all six
//     flags on every faction, read back, and the log line naming any faction
//     that is missing or did not take them; it runs on loadGame, through guard;
//   - the scripts: none that adds gold or jails somebody can run here, and a
//     script that can run only reports a crime, which the flags then ignore;
//   - nothing in game\ adds a bounty itself.
//
// Read only, apart from one reading of the load order written to the
// system's temp folder and removed.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const IGNORE = { murder: 0x80, assault: 0x100, stealing: 0x200, trespass: 0x400, pickpocket: 0x2000, werewolf: 0x10000 };
const ALL = Object.keys(IGNORE).reduce(function (a, k) { return a | IGNORE[k]; }, 0);
const ADDS = ['modcrimegold', 'setcrimegold', 'setcrimegoldviolent', 'sendplayertojail'];
const REPORTS = ['sendassaultalarm', 'sendstealalarm', 'sendtrespassalarm'];

const CR = String.fromCharCode(13);
const front = fs.readFileSync(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'), 'utf8').split(CR).join('');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
let table = null;
try { table = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'crime-factions.json'), 'utf8')); } catch (e) { table = null; }
yes('game/data/crime-factions.json is in the repo, written by the script',
    !!table && table.builtBy === 'scripts/dev/Build-CrimeTable.py' && !!table.factions && !!table.scripts);
yes('scripts/dev/Build-CrimeTable.py is in the repo',
    fs.existsSync(path.join(REPO_DIR, 'scripts', 'dev', 'Build-CrimeTable.py')));
yes('the json names the six ignore flags the plugin sets',
    !!table && !!table.ignoreFlags && Object.keys(table.ignoreFlags).length === 6 &&
    Object.keys(IGNORE).every(function (k) { return table.ignoreFlags[k] === '0x' + IGNORE[k].toString(16); }));

/* ------------------------------------------------ the load order itself */
const data = process.env.THORNSWOOD_DATA || 'C:\\Thornswood\\Game\\Data';
const plugins = process.env.THORNSWOOD_PLUGINS || 'C:\\Thornswood\\Profile\\Default\\plugins.txt';
if (fs.existsSync(data) && fs.existsSync(plugins)) {
  const out = path.join(os.tmpdir(), 'test-502-no-bounty-' + process.pid + '.json');
  const py = process.platform === 'win32' ? 'py' : 'python3';
  const r = cp.spawnSync(py, [path.join(REPO_DIR, 'scripts', 'dev', 'Build-CrimeTable.py'), '--check',
                              '--json', out, '--data', data, '--plugins', plugins],
                         { encoding: 'utf8', timeout: 600000 });
  let read = null;
  try { read = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { read = null; }
  try { fs.unlinkSync(out); } catch (e) { }
  yes('the load order on this machine was read (' + data + ')', r.status === 0 && !!read);
  if (read && table) {
    const a = Object.keys(read.factions).sort(), b = Object.keys(table.factions).sort();
    yes('it has the same factions tracking crime as the committed json (' + a.length + ')', a.join(',') === b.join(','));
    yes('with the same flags and charges', a.every(function (k) {
      return table.factions[k] && JSON.stringify(read.factions[k]) === JSON.stringify(table.factions[k]);
    }));
    const sa = Object.keys(read.scripts.scripts).sort(), sb = Object.keys(table.scripts.scripts).sort();
    yes('and the same scripts that touch a bounty (' + sa.length + '), each able to run or not the same way',
        sa.join(',') === sb.join(',') && sa.every(function (k) {
          return JSON.stringify(read.scripts.scripts[k]) === JSON.stringify(table.scripts.scripts[k]);
        }));
  }
} else {
  console.log('      no load order on this machine (' + data + '), so the committed reading is what is checked');
}

/* ------------------------------------------- the json and the plugin block */
const START = '  // ==== NO_BOUNTY_FACTIONS, generated ====';
const END = "  sp.on('loadGame', guard('no bounty', noBounty));";
const a = front.indexOf(START);
const b = front.indexOf(END);
yes('the front plugin carries the generated block and the function after it', a >= 0 && b > a);
yes('they are in the plugin once', front.indexOf(START, a + 1) < 0 && front.indexOf(END, b + 1) < 0);
yes('the kill-only list it replaces is gone', front.indexOf('KILL_CRIME_FACTIONS') < 0 && front.indexOf('noKillBounty') < 0);
const body = (a >= 0 && b > a) ? front.slice(a, b) : '';

let rows = null;
try { rows = new Function(body.slice(0, body.indexOf('  function noBounty(')) + '\nreturn NO_BOUNTY_FACTIONS;')(); } catch (e) { rows = null; }
yes('the block is a list of [form id, plugin, editor id]', Array.isArray(rows) && rows.length > 0 &&
    rows.every(function (r) { return Array.isArray(r) && r.length === 3 && Number.isInteger(r[0]) &&
                                     typeof r[1] === 'string' && typeof r[2] === 'string'; }));
const descs = (rows || []).map(function (r) { return r[0].toString(16) + ':' + r[1]; });
const fromJson = table ? Object.keys(table.factions).sort() : [];
yes('the block and the json list the same factions (' + descs.length + ')',
    descs.slice().sort().join(',') === fromJson.join(','));
yes('and give each the same editor id', (rows || []).every(function (r) {
  const j = table && table.factions[r[0].toString(16) + ':' + r[1]];
  return !!j && j.edid === r[2];
}));
yes('every one of them tracks crime, by its flags', fromJson.every(function (k) {
  return (parseInt(table.factions[k].flags, 16) & 0x40) !== 0;
}));
yes('each says what it charges for every crime, and which flags it lacked', fromJson.every(function (k) {
  const f = table.factions[k];
  return f.charges && ['murder', 'assault', 'trespass', 'pickpocket', 'steal', 'escape', 'werewolf']
    .every(function (c) { return typeof f.charges[c] === 'number'; }) && Array.isArray(f.lacks);
}));

// Every hold's crime faction the gamemode knows, by DATA.holds.
const dataLine = gm.split('\n').filter(function (l) { return l.indexOf('const DATA = ') === 0; })[0] || '';
let DATA = null;
try { DATA = JSON.parse(dataLine.slice('const DATA = '.length).replace(/;\s*$/, '')); } catch (e) { DATA = null; }
const holdFactions = [];
if (DATA && DATA.holds) {
  for (const h in DATA.holds) {
    const c = DATA.holds[h].crimeFaction;
    if (c) { holdFactions.push(parseInt(c, 16).toString(16) + ':Skyrim.esm'); }
  }
}
yes('the gamemode names nine hold crime factions', holdFactions.length === 9);
const missingHolds = holdFactions.filter(function (d) { return descs.indexOf(d) < 0; });
yes('every hold crime faction is on the list' + (missingHolds.length ? ' (not: ' + missingHolds.join(', ') + ')' : ''),
    missingHolds.length === 0);
yes('Raven Rock\'s is on it', descs.indexOf('18279:Dragonborn.esm') >= 0);
function own(d) { return table && table.factions[d] && table.factions[d].useDefaults === false; }
yes('the Reach is on it, with amounts of its own that no game setting would reach', own('2816c:Skyrim.esm'));
yes('the Companions are on it, who charge for a pickpocket and a theft out of their own record',
    own('48362:Skyrim.esm') && table.factions['48362:Skyrim.esm'].charges.pickpocket > 0 &&
    table.factions['48362:Skyrim.esm'].charges.steal > 0);
const costly = fromJson.filter(function (k) {
  const f = table.factions[k];
  const map = { murder: 'murder', assault: 'assault', trespass: 'trespass', pickpocket: 'pickpocket',
                steal: 'stealing', werewolf: 'werewolf' };
  return Object.keys(map).some(function (c) { return f.charges[c] > 0 && f.lacks.indexOf(map[c]) >= 0; });
});
yes('theft, trespass and pickpocketing cost gold in the game as it ships (' + costly.length + ' factions), ' +
    'which is what the flags answer', costly.length > 0 && fromJson.some(function (k) {
  return table.factions[k].charges.trespass > 0 && table.factions[k].charges.pickpocket > 0 &&
         table.factions[k].charges.steal > 0;
}));
yes('escape has no flag, and the json says why it cannot happen', !!table && /jails nobody/.test(String(table.escape)));

/* ------------------------------------------------------------- the scripts */
const scripts = (table && table.scripts && table.scripts.scripts) || {};
const names = Object.keys(scripts);
yes('the json read every script in the load order and found the ones that touch a bounty (' + names.length + ')',
    !!table && table.scripts.read > 10000 && names.length > 0);
const liveAdds = names.filter(function (n) {
  return scripts[n].canFire.length && scripts[n].natives.some(function (x) { return ADDS.indexOf(x) >= 0; });
});
for (const n of liveAdds) { console.log('      can run and adds a bounty: ' + n); }
yes('no script that adds gold or sends somebody to jail can run here', liveAdds.length === 0);
const liveOther = names.filter(function (n) {
  return scripts[n].canFire.length && !scripts[n].natives.every(function (x) { return REPORTS.indexOf(x) >= 0; });
});
yes('any script that can run only reports a crime, which every faction now ignores', liveOther.length === 0);
yes('each says why it cannot add one', names.every(function (n) { return typeof scripts[n].why === 'string' && scripts[n].why; }));
yes('the guard dialogue that demands payment or jails somebody is among them, and cannot run',
    names.some(function (n) {
      return /^TIF__/i.test(n) && scripts[n].natives.indexOf('sendplayertojail') >= 0 && !scripts[n].canFire.length;
    }) && names.some(function (n) {
      return scripts[n].natives.indexOf('playerpaycrimegold') >= 0 && !scripts[n].canFire.length;
    }));

/* The plugin's function, run against a stand-in Skyrim Platform. */
function run(opts) {
  const flags = {};
  const logged = [];
  const sp = {
    Game: {
      getFormFromFile: function (id, file) {
        const k = id.toString(16) + ':' + file;
        if (opts.absent && opts.absent.indexOf(k) >= 0) { return null; }
        return { k: k };
      }
    },
    Faction: {
      from: function (form) {
        if (!form) { return null; }
        const k = form.k;
        return {
          setFactionFlag: function (f) {
            if (opts.throwOn === k) { throw new Error('no SKSE'); }
            if (opts.sticky === k && f === 0x400) { return; }
            flags[k] = (flags[k] || 0) | f;
          },
          isFactionFlagSet: function (f) { return ((flags[k] || 0) & f) !== 0; }
        };
      }
    }
  };
  const say = function (t) { logged.push(t); };
  const fn = new Function('sp', 'say', body + '\nreturn noBounty;')(sp, say);
  fn();
  return { flags: flags, logged: logged };
}

let r = null;
try { r = run({}); } catch (e) { console.log('      threw: ' + e); r = null; }
yes('noBounty runs', !!r);
if (r) {
  const every = descs.filter(function (d) { return ((r.flags[d] || 0) & ALL) === ALL; });
  yes('every faction on the list now ignores all six crimes (' + every.length + ' of ' + descs.length + ')',
      every.length === descs.length);
  yes('no other flag is touched', Object.keys(r.flags).every(function (k) { return r.flags[k] === ALL; }));
  yes('the log says all of them took it', r.logged.length === 1 &&
      r.logged[0].indexOf(descs.length + ' of ' + descs.length + ' crime factions now ignore') >= 0 &&
      r.logged[0].indexOf('REFUSED') < 0);
}
try {
  const r2 = run({ absent: ['2816c:Skyrim.esm'], throwOn: '267ea:Skyrim.esm', sticky: '2816b:Skyrim.esm' });
  yes('a faction missing from the load order is named, not skipped in silence',
      r2.logged[0].indexOf('not in this load order: CrimeFactionReach') >= 0);
  yes('one that throws is named as refused, with what it threw',
      r2.logged[0].indexOf('CrimeFactionWhiterun (Error: no SKSE)') >= 0);
  yes('one where a single flag does not stay is named as refused',
      r2.logged[0].indexOf('CrimeFactionRift (the flags did not stay)') >= 0);
  yes('and the rest still took it', r2.logged[0].indexOf((descs.length - 3) + ' of ' + descs.length) >= 0);
} catch (e) {
  yes('the failures run (' + e + ')', false);
}

yes('it runs when a game is loaded, through guard', front.indexOf(END) >= 0);

// Nothing in game\ adds a bounty itself.
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); }
    else if (/\.js$/.test(e.name)) { out.push(p); }
  }
  return out;
}
const adds = [];
for (const file of walk(path.join(REPO_DIR, 'game'), [])) {
  const src = fs.readFileSync(file, 'utf8');
  const rx = /\.(modCrimeGold|setCrimeGold|setCrimeGoldViolent|sendAssaultAlarm|sendPlayerToJail|sendStealAlarm|sendTrespassAlarm)\s*\(/g;
  let m;
  while ((m = rx.exec(src)) !== null) { adds.push(path.relative(REPO_DIR, file) + ': ' + m[1]); }
}
for (const x of adds) { console.log('      adds a bounty: ' + x); }
yes('no gamemode, plugin or page code adds a bounty or raises an alarm', adds.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
