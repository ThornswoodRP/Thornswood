// test-sunhelm-gone.js
//
// Nothing a customer reads still sends them to a mod that has left the
// collection, and what the help says about the needs is what the server
// actually does.
//
// WHY THIS EXISTS. To Do List entry 133. Settled by Patrick on 17 September,
// in the entry's words: the mod does not matter, the three needs do. So
// SunHelm Survival and SunHelm Diseases came out, and hunger, thirst, rest and
// temperature were built on the server instead. Respawn - Death Overhaul and
// Tavern Games came out in the same release, and Immersive Armors became its
// script free build.
//
// The removal was done and the server half was live, and the words were not.
// On 24 September the launcher's Help page still said "The needs display is
// configurable in the SunHelm MCM" and promised that "a bedroll or a hot
// drink" warms you, which nothing on the server counts. The Controls page
// said "SunHelm and the older mods live here". Add-CartTravel.ps1 said fast
// travel was switched off by SunHelm, when it is the SkyMP client that does
// it. Every one of those sends somebody looking for a thing that is not there.
// known.md listed all five mods as "in the collection" too; entry 280 fixed
// that table, and since #3137 the page names none of them: a mod taken out on
// purpose is not a known issue.
//
// So this reads the text people read and checks it two ways: it names no mod
// that has gone as though it were still here, and where it describes the
// needs, everything it promises is something gamemode.js does. It checks what
// the text claims rather than the words it uses, so a rewrite of the help
// passes as long as what it says is true. The help it reads is the panel in
// the game since #3146 cut the launcher's Help page.
// On a machine
// with the game built it also checks the entry's doneWhen: no SunHelm in the
// reference plugin list, the game folder or the client's load order, and the
// script free Immersive Armors in its place. On a runner with no game folder
// those say SKIP.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const BS = String.fromCharCode(92);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function skip(what) { console.log('SKIP  ' + what); }

function read(parts) {
  return fs.readFileSync(path.join.apply(path, [REPO_DIR].concat(parts)), 'utf8').split(CR).join('');
}

// The mods that left. Matched loosely, because people write them with and
// without the space.
const GONE = [
  { name: 'SunHelm', re: /sun\s*helm/i },
  { name: 'Respawn - Death Overhaul', re: /respawn\s*-\s*death\s*overhaul/i },
  { name: 'Tavern Games', re: /tavern\s*games/i }
];
function goneIn(text) {
  const hit = [];
  GONE.forEach(function (g) { if (g.re.test(text)) { hit.push(g.name); } });
  return hit;
}

// ---------------------------------------------------------- the gamemode
const GM = read(['game', 'gamemode.js']);
const nA = GM.indexOf('// ==== thornswood needs');
const nB = GM.indexOf('// ==== end thornswood needs ====');
const needs = (nA >= 0 && nB > nA) ? GM.slice(nA, nB) : '';
yes('the needs block is in the gamemode', needs.length > 1000);

const hA = GM.indexOf('function hudScript()');
// To the end of the function, which grew past a fixed 12,000 characters
// when #2247 wrote down where the HUD bars are measured from.
const hEnd = hA >= 0 ? GM.indexOf("].join('\\n');", hA) : -1;
const hud = hA >= 0 ? GM.slice(hA, hEnd > hA ? hEnd : hA + 12000) : '';
yes('the HUD script is in the gamemode', hud.length > 0);

const pA = GM.indexOf('const PLAYER_WORDS = [');
const pB = pA >= 0 ? GM.indexOf('];', pA) : -1;
const playerWords = (pA >= 0 && pB > pA) ? GM.slice(pA, pB) : '';
yes('PLAYER_WORDS is in the gamemode', playerWords.length > 0);

// ------------------------------------------------------- the help in the game
// The launcher's Help page until #3146 cut it: help is the panel on F7 now,
// game/ui/thornswood-help.js, and its Living topic is what says the needs.
// Each topic's text, run with the keys a fresh install has, the way a person
// reads it.
function helpTopics() {
  const page = read(['game', 'ui', 'thornswood-help.js']);
  const a = page.indexOf('  var TOPICS = [');
  const b = a < 0 ? -1 : page.indexOf('\n  ];\n', a);
  const k = /var keys = (\{[\s\S]*?\});/.exec(page);
  if (a < 0 || b < 0 || !k) { return []; }
  try {
    const keys = new Function('return ' + k[1])();
    return new Function('return ' + page.slice(page.indexOf('[', a), b + 4))()
      .map(function (t) { return { id: t.id, text: t.text(keys).join(' ') }; });
  } catch (e) { return []; }
}
const topics = helpTopics();
yes('the help in the game has its topics, ' + topics.length + ' of them', topics.length >= 5);
const helpGone = [];
topics.forEach(function (t) {
  goneIn(t.text).forEach(function (g) { helpGone.push(g + ' in ' + t.id); });
});
yes('the help in the game names no mod that has left' + (helpGone.length ? ': ' + helpGone.join('; ') : ''),
    helpGone.length === 0);

const living = topics.filter(function (t) { return t.id === 'living'; });
yes('the help has a Living topic, once', living.length === 1);
const body = living.length ? living[0].text : '';
yes('it sends nobody to an MCM, which went with SunHelm', !/\bMCM\b/.test(body));

// Where the needs are shown, checked against the thing that draws them.
// /needs went with #1631 (nothing people do is typed, Patrick, 4 Oct): the
// numbers behind the bars are the Body page on K, which the K panel draws
// from the needs block's own view, put on the panel by writeState. It came
// back on 11 Oct as the bars in a line of text for somebody who hid them
// (#2267), one of the words everybody is told, so the item may name it.
const SKILLS = read(['game', 'ui', 'thornswood-skills.js']);
const bodyPage = /sections\.push\('body'\)/.test(SKILLS) && /function drawNeeds\(\)/.test(SKILLS) &&
    /view\.body = N\.view\(actorId\)/.test(GM);
yes('it names the Body page on K', /Body page on K/.test(body));
yes('and the K panel draws a Body page out of the needs block\'s view', bodyPage);
const slashes = [];
body.replace(/(^|\s)(\/[a-z]+)\b/g, function (all, pre, w) {
  if (slashes.indexOf(w) < 0) { slashes.push(w); }
  return all;
});
const untold = slashes.filter(function (w) { return playerWords.indexOf("'" + w + "'") < 0; });
yes('every command it names (' + (slashes.join(' ') || 'none') + ') is one everybody is told about, not only a playtester' +
    (untold.length ? ': not ' + untold.join(', ') : ''), untold.length === 0);
yes('it tells nobody to type /eat, /drink or /bard, which the gamemode no longer answers (#1631)',
    !/\/(eat|drink|bard)\b/.test(body) &&
    !/'\/(eat|drink|bard)'/.test(playerWords) && !/word === '\/(eat|drink|bard)'/.test(GM));
yes('and /needs, when it names it, is answered and on the list everybody is told (#2267)',
    !/\/needs\b/.test(body) ||
    (/'\/needs'/.test(playerWords) && /word === '\/needs'/.test(GM)));

// Each claim about the bars is checked only if the item makes it, and has to
// be true of hudScript when it does.
const HUD_ROWS = [];
hud.replace(/row\("(\w+)", "(\w+)"/g, function (all, key, label) { HUD_ROWS.push(label); return all; });
yes('the HUD draws its bars by name, ' + HUD_ROWS.join(', '), HUD_ROWS.length >= 4);
if (/bottom left/i.test(body)) {
  yes('it says the bars are bottom left, and the HUD is anchored bottom left',
      /position:fixed;left:[^;]+;bottom:[^;]+;/.test(hud));
}
const COUNT = { two: 2, three: 3, four: 4, five: 5, six: 6 };
const counted = /\b(two|three|four|five|six) bars\b/i.exec(body);
if (counted) {
  yes('it says there are ' + counted[1].toLowerCase() + ' bars, and the HUD draws ' + HUD_ROWS.length,
      COUNT[counted[1].toLowerCase()] === HUD_ROWS.length);
}
['Hunger', 'Thirst', 'Rest', 'Temp', 'Warmth', 'Food', 'Water', 'Fatigue', 'Cold'].forEach(function (label) {
  // Only a label it gives as a bar's name, capitalised mid sentence the way
  // "are Hunger, Thirst, Rest and Temp" does. A sentence that starts with
  // "Food" is not naming a bar.
  if (new RegExp('[a-z,] ' + label + '\\b').test(body)) {
    yes('it names a bar called ' + label + ', and the HUD draws one', HUD_ROWS.indexOf(label) >= 0);
  }
});

/*
  What warms you. Every source the item promises has to be one the needs
  block counts, and the ones SunHelm had and the server does not must not be
  promised. That is the half of the old text that was wrong without naming
  SunHelm at all.
*/
const lowBody = body.toLowerCase();
const lowNeeds = needs.toLowerCase();
['bedroll', 'hot drink', 'hot food', 'hot meal'].forEach(function (w) {
  yes('it promises no ' + w + ' unless the needs block counts one',
      lowBody.indexOf(w) < 0 || lowNeeds.indexOf(w) >= 0);
});
yes('it says a fire warms you, and the needs block has a fire',
    /fires? warms? you/i.test(body) && /\bfire:\s*\{\s*at:/.test(needs));
if (/burns? you/i.test(body)) {
  yes('it says standing in one burns you, and the needs block has a burn',
      /\bburn:\s*\{\s*spread:/.test(needs));
}
if (/roof/i.test(body)) {
  yes('it says a roof keeps the weather off, and the needs block reads a roof', /\broof\b/.test(needs));
}

const mat = /material:\s*\{([^}]*)\}/.exec(needs);
const worth = {};
if (mat) {
  mat[1].replace(/(\w+):\s*([\d.]+)/g, function (all, k, v) { worth[k] = Number(v); return all; });
}
const kinds = Object.keys(worth).filter(function (k) { return k !== 'none'; });
const best = kinds.slice().sort(function (a, b) { return worth[b] - worth[a]; })[0];
const worst = kinds.slice().sort(function (a, b) { return worth[a] - worth[b]; })[0];
yes('the needs block says what each material is worth, ' + kinds.length + ' of them', kinds.length >= 4);
if (/fur is the warmest/i.test(body)) {
  yes('it says fur is the warmest, and fur is the best material there (' + best + ')', best === 'fur');
}
if (/metal the worst|metal is the worst/i.test(body)) {
  yes('it says metal is the worst, and heavy armour is the worst material there (' + worst + ')',
      worst === 'heavy');
}

// ------------------------------------------------- Settings in the game
// The launcher's Controls page until #3126; its rows are on Settings in the
// game now, game/ui/thornswood-settings.js.
const settingsPage = read(['game', 'ui', 'thornswood-settings.js']);
const pagesStrings = (settingsPage.match(/'(?:[^'\\\n]|\\.)*'/g) || [])
  .map(function (l) { return l.slice(1, -1).replace(/\\'/g, "'"); });
yes('Settings in the game has text to read, ' + pagesStrings.length + ' strings', pagesStrings.length > 20);
const pagesGone = [];
pagesStrings.forEach(function (s) {
  goneIn(s).forEach(function (g) { pagesGone.push(g + ' in "' + s.slice(0, 60) + '"'); });
});
yes('Settings in the game names no mod that has left' + (pagesGone.length ? ': ' + pagesGone.join('; ') : ''),
    pagesGone.length === 0);

const mAt = pagesStrings.indexOf('Mod Configuration');
const mcmRow = mAt >= 0 ? (pagesStrings[mAt + 1] || '') : '';
yes('the Mod Configuration row is on Settings in the game', mcmRow.length > 0);

// The MCM page each example stands for, as a script in the build.
const MCM_PAGES = { 'QuickLoot': 'QuickLootIEMCM.pex', 'Skyrim Unbound': 'SkyrimUnboundMCMScript.pex' };
const named = Object.keys(MCM_PAGES).filter(function (k) { return mcmRow.indexOf(k) >= 0; });
yes('the row gives an example of a mod whose page is there', named.length > 0);

// Known Issues is the page /known writes, from the bot's list since #3140 (#2414).
const KNOWN = require('./fixtures/known-page').knownPage() || '';
yes('the row does not say the choices are kept in your save, when Known Issues says menus reset',
    !(/reset every session/i.test(KNOWN) && /kept in your save/i.test(mcmRow)));

// --------------------------------------------------------- Known Issues
/* Since #3137 Known Issues lists only what is broken right now, so the table
   of mods the collection took out came off it: a mod taken out on purpose is
   not a bug. Nothing on it may name one of them now. */
yes('Known Issues names none of the mods that left', KNOWN.length > 0 &&
    GONE.every(function (g) { return !g.re.test(KNOWN); }));

// ------------------------------------------------------- Add-CartTravel.ps1
const CART = read(['scripts', 'oneoff', 'Add-CartTravel.ps1']);
const says = [];
CART.split('\n').forEach(function (line) {
  const m = /^\s*Say\s+'((?:[^']|'')*)'/.exec(line) || /^\s*Say\s+"([^"]*)"/.exec(line);
  if (m) { says.push(m[1]); }
});
yes('Add-CartTravel.ps1 has lines it prints, ' + says.length + ' of them', says.length > 5);
const cartGone = says.filter(function (s) { return goneIn(s).length > 0; });
yes('none of them names a mod that has left' + (cartGone.length ? ': ' + cartGone.join(' | ') : ''),
    cartGone.length === 0);
yes('and the fast travel line says the SkyMP client turns it off',
    says.some(function (s) { return /fast travel/i.test(s) && /SkyMP client/i.test(s); }));

/*
  ---------------------------------------- the scripts run on the shipping PC

  The words are only half of it. Two operator scripts still named a mod that
  had left in the one place a name has to be true, the plugin they reach for,
  and neither would have failed until somebody ran it in the middle of a
  release.

  Fix-QuickLoot.ps1 inserts MCMHelper.esp into the server list behind the
  plugin -After names, and the default was SunHelmDiseases.esp, read off one
  machine's plugins.txt in September. Add-TempleRespawn.ps1 installed Respawn
  - Death Overhaul and put it back into plugins.txt and loadorder.txt.

  So the anchor is checked to be a plugin that is still here, and checked
  against the master MCMHelper.esp cannot load without, which is where the
  entry has to go rather than a line number that goes stale on the next bake.
  Add-TempleRespawn.ps1 is checked to refuse before it reaches any of the
  install.
*/
const QUICKLOOT = read(['scripts', 'oneoff', 'Fix-QuickLoot.ps1']);
const anchor = /\[string\]\s*\$After\s*=\s*'([^']+)'/.exec(QUICKLOOT);
yes('Fix-QuickLoot.ps1 has a default plugin to insert behind', anchor !== null);
const anchorName = anchor ? anchor[1] : '';
yes('and it is not a mod that has left, it is ' + anchorName, goneIn(anchorName).length === 0);

// The chain at the top of Enable-MCM.ps1 is where the masters are written
// down: "MCMHelper.esp   NOT light, masters SkyUI_SE.esp".
const ENABLE_MCM = read(['scripts', 'oneoff', 'Enable-MCM.ps1']);
const master = /MCMHelper\.esp\b[^\n]*masters\s+(\S+\.es[pml])/i.exec(ENABLE_MCM);
yes('Enable-MCM.ps1 says what MCMHelper.esp masters', master !== null);
yes('and the anchor is that master, so the entry lands where the server can read it',
    master !== null && anchorName.toLowerCase() === master[1].toLowerCase());
yes('a missing anchor stops the script rather than guessing a place',
    /throw \("?\$After is not in the server load order/.test(QUICKLOOT));

const TEMPLE = read(['scripts', 'oneoff', 'Add-TempleRespawn.ps1']);
const stopAt = TEMPLE.indexOf('throw (\'STOP.');
const installAt = TEMPLE.indexOf('Head \'Making room\'');
yes('Add-TempleRespawn.ps1 throws a STOP', stopAt >= 0);
yes('and it throws before it looks for an archive or writes anything',
    stopAt >= 0 && installAt > stopAt);
yes('and it says why, which is the mod it installed leaving the collection',
    stopAt >= 0 && goneIn(TEMPLE.slice(stopAt, stopAt + 600)).length > 0);

// Add-Characters.ps1 installed Start On Save by hand. It was a STOP guard
// from #781 until #394 took the mod out for good; now it is deleted, so no
// run can put the mod back into a build (tests\test-start-on-save-gone.js).
yes('Add-Characters.ps1 is gone from scripts\\mods',
    !fs.existsSync(path.join(REPO_DIR, 'scripts', 'mods', 'Add-Characters.ps1')));

const RUN_EVERYTHING = read(['scripts', 'oneoff', 'Run-Everything.ps1']);
yes('Run-Everything.ps1 no longer runs Add-Characters as a step',
    !/Script\s*=\s*'Add-Characters\.ps1'/.test(RUN_EVERYTHING));
yes('and it no longer wants po3_StartOnSave.dll',
    !/po3_StartOnSave\.dll/.test(RUN_EVERYTHING));

// ------------------------------------------------------- this machine
const ROOT = process.env.TS_ROOT || ('C:' + BS + 'Thornswood');
const PLUGINS = path.join(ROOT, 'Profile', 'Default', 'plugins.txt');
const DATA = path.join(ROOT, 'Game', 'Data');
const ORDER = path.join(DATA, 'Platform', 'thornswood-loadorder.txt');
const CLIENT = path.join(DATA, 'Platform', 'Plugins', 'skymp5-client.js');
const SCRIPTS = path.join(DATA, 'Scripts');
const IA = 'Hothtrooper44_ArmorCompilation.esp';
const GONE_FILES = /sun\s*helm|respawn - death overhaul|taverngames/i;

if (fs.existsSync(PLUGINS)) {
  const lines = fs.readFileSync(PLUGINS, 'utf8').split(/\r?\n/);
  const left = lines.filter(function (l) { return GONE_FILES.test(l); });
  yes('the reference plugin list carries none of the mods that left' + (left.length ? ': ' + left.join(', ') : ''),
      left.length === 0);
  yes('and it has the script free Immersive Armors, ' + IA, lines.indexOf('*' + IA) >= 0);
} else {
  skip('no reference plugin list at ' + PLUGINS);
}

if (fs.existsSync(DATA)) {
  const there = fs.readdirSync(DATA).filter(function (f) { return /sun\s*helm/i.test(f); });
  yes('the game folder has no SunHelm file' + (there.length ? ': ' + there.join(', ') : ''), there.length === 0);
  const esp = path.join(DATA, IA);
  if (fs.existsSync(esp)) {
    // The scripted build hands armour out through quests. Measured 24
    // September: the one in the game folder has no QUST record at all.
    yes('the Immersive Armors plugin carries no quest record, so it is the script free build',
        fs.readFileSync(esp).indexOf('QUST', 0, 'latin1') < 0);
  } else {
    skip('no ' + IA + ' in ' + DATA);
  }
} else {
  skip('no game folder at ' + DATA);
}

if (fs.existsSync(ORDER)) {
  const order = fs.readFileSync(ORDER, 'utf8');
  yes('the client load order names no SunHelm plugin', !/sun\s*helm/i.test(order));
  yes('and names the script free Immersive Armors', order.indexOf(IA) >= 0);
} else {
  skip('no client load order at ' + ORDER);
}

if (fs.existsSync(CLIENT)) {
  yes('the SkyMP client in the game folder turns fast travel off itself',
      fs.readFileSync(CLIENT, 'utf8').indexOf('enableFastTravel(false)') >= 0);
} else {
  skip('no skymp5-client.js at ' + CLIENT);
}

if (fs.existsSync(SCRIPTS)) {
  named.forEach(function (k) {
    yes('the page the Controls row names for ' + k + ' is in the build, ' + MCM_PAGES[k],
        fs.existsSync(path.join(SCRIPTS, MCM_PAGES[k])));
  });
} else {
  skip('no Scripts folder at ' + SCRIPTS);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
