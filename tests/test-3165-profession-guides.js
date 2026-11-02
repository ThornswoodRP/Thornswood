// test-3165-profession-guides.js
//
// #3165: a guide per profession on the K panel (Patrick's answer A, 22 Oct:
// "a page per profession on the K panel"): what it makes, where its
// materials come from, how it ranks up.
//
//   A  the block in game/ui/thornswood-skills.js is what
//      scripts/dev/Build-ProfessionGuides.js writes today (--check)
//   B  the block agrees with what the server runs: each half's count is the
//      recipe book's rows for that half in RECIPES_BY_ID, the ladder is the
//      gamemode's tuning, the benches are BENCH_ACCESS, the maneuvers are
//      MANEUVERS, and every class, bench and maneuver has its words
//   C  the page itself, in a stand-in document: in the world it opens on
//      your own profession with your rank, each tab reads another, and it
//      sends nothing; while creating it sits before Home, Review stays last,
//      and it opens on the profession marked
//   D  the words on every page: no em dash, no banned word, no number left
//      unfilled
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read(...bits) { return fs.readFileSync(path.join(REPO, ...bits), 'utf8').split(CR).join(''); }
const ui = read('game', 'ui', 'thornswood-skills.js');
const gm = require('./gamemode-tables.js').joined(read('game', 'gamemode.js'));
const recipes = JSON.parse(read('game', 'data', 'recipes.json'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// ------------------------------------------------------- A. the builder --
const built = cp.spawnSync(process.execPath, [path.join(REPO, 'scripts', 'dev', 'Build-ProfessionGuides.js'), '--check'], { encoding: 'utf8' });
yes('A1 Build-ProfessionGuides.js --check passes (' + (built.stdout + built.stderr).trim() + ')', built.status === 0);
const m = /\n {2}var GUIDES = (\{.*\});\n/.exec(ui);
let G = null;
try { G = JSON.parse(m[1]); } catch (e) { G = null; }
yes('A2 the K panel carries one GUIDES line between the PROFESSION_GUIDES markers, and it parses',
    !!G && ui.split('// ==== PROFESSION_GUIDES ====').length === 2 && ui.split('// ==== end PROFESSION_GUIDES ====').length === 2);
if (!G) { done(); }

// ------------------------------------------------- B. against the server --
// The gamemode reads RECIPES_BY_ID from game/gamemode-tables (#5191).
const BOOK = require('./gamemode-tables.js').inGamemode(gm, 'RECIPES_BY_ID') || {};
const book = {};
Object.keys(BOOK).forEach(function (k) {
  const row = BOOK[k];
  if (!row || !row.half || row.roll) return;
  const h = row.half.toLowerCase();
  book[h] = (book[h] || 0) + 1;
});
const halvesHere = {};
Object.keys(G.professions).forEach(function (p) {
  Object.keys(G.professions[p].halves).forEach(function (h) { halvesHere[h] = G.professions[p].halves[h]; });
});
const mismatched = Object.keys(book).filter(function (h) { return !halvesHere[h] || halvesHere[h].count !== book[h]; })
  .concat(Object.keys(halvesHere).filter(function (h) { return (halvesHere[h].count || 0) !== (book[h] || 0); }));
yes('B1 every half counts exactly the rows the recipe book counts in RECIPES_BY_ID (' + JSON.stringify(book) + ')',
    Object.keys(book).length >= 10 && mismatched.length === 0);
yes('B1 and each half\'s families add up to its count',
    Object.keys(halvesHere).every(function (h) {
      const sum = halvesHere[h].families.reduce(function (n, f) { return n + f[1] + f[2] + f[3] + f[4]; }, 0);
      return sum === halvesHere[h].count;
    }));

const per = /workPerRank: \{ advanced: (\d+), expert: (\d+), master: (\d+) \}/.exec(gm);
yes('B2 the ladder is the gamemode\'s workPerRank (' + JSON.stringify(G.ladder.per) + ')',
    !!per && G.ladder.per.advanced === +per[1] && G.ladder.per.expert === +per[2] && G.ladder.per.master === +per[3]);
yes('B2 the rest a piece costs, the craft floor, the party bonus, the study work and the tool uses are the gamemode\'s',
    G.ladder.rest.novice === 1.5 && G.ladder.rest.master === 0.6 && new RegExp('var CRAFT_REST = ' + G.ladder.craftRest + ';').test(gm) &&
    new RegExp('partyBonus: ' + (G.ladder.party / 100) + ',').test(gm) &&
    new RegExp('study: \\{ perSpell: ' + G.ladder.perSpell + ', perRank: ' + G.ladder.perRank + ' \\}').test(gm) &&
    new RegExp('\\nconst TOOL_USES = ' + G.ladder.toolUses + ';').test(gm));

const ACCESS = JSON.parse(/const BENCH_ACCESS = (\{.*\});/.exec(gm)[1]);
const BUILD = require(path.join(REPO, 'scripts', 'dev', 'Build-ProfessionGuides.js'));
const benchMiss = [];
Object.keys(ACCESS).forEach(function (id) {
  const bench = ACCESS[id];
  if (bench.shut) return;
  Object.keys(bench.halves || {}).forEach(function (h) {
    const words = BUILD.BENCH_WORDS[bench.name];
    const got = (halvesHere[h] && halvesHere[h].benches) || [];
    if (!got.some(function (x) { return x[0] === words; })) benchMiss.push(h + ' ' + bench.name);
  });
});
yes('B3 every bench BENCH_ACCESS opens for a half is on that half\'s page (' + benchMiss.join(', ') + ')', benchMiss.length === 0);
yes('B3 the Skyforge reads at Advanced for a Platewright, and the forge from Novice',
    JSON.stringify(halvesHere.platewright.benches).indexOf('["Skyforge","advanced"]') >= 0 &&
    JSON.stringify(halvesHere.platewright.benches).indexOf('["Forge","novice"]') >= 0);

const bul = halvesHere.bulwark.maneuvers || [], ber = halvesHere.berserker.maneuvers || [];
yes('B4 a warrior\'s maneuvers are MANEUVERS, four a half in rank order (' + bul.map(function (x) { return x[0]; }).concat(ber.map(function (x) { return x[0]; })).join(', ') + ')',
    bul.map(function (x) { return x[0]; }).join() === 'Set,Plant,Cover,Wall' && ber.map(function (x) { return x[0]; }).join() === 'Rush,Heavy,Break,Wreck' &&
    /set: +\{ name: 'Set', +half: 'bulwark', +rank: 'novice', +stamina: 15, cooldown: 45,/.test(gm) &&
    bul[0][2] === 15 && bul[0][3] === 45);

const classes = {};
Object.keys(G.professions).forEach(function (p) { G.professions[p].materials.forEach(function (x) { if (x[2]) classes[x[2]] = true; }); });
const box0 = {};
vm.createContext(box0);
const guideText = /\n {2}var GUIDE_TEXT = (\{[\s\S]*?\n {2}\});\n/.exec(ui);
const guideWho = /\n {2}var GUIDE_WHO = (\{.*\});\n/.exec(ui);
const guideMan = /\n {2}var GUIDE_MANEUVER = (\{[\s\S]*?\n {2}\});\n/.exec(ui);
const TEXT = guideText ? vm.runInContext('(' + guideText[1] + ')', box0) : null;
const WHO = guideWho ? vm.runInContext('(' + guideWho[1] + ')', box0) : null;
const MAN = guideMan ? vm.runInContext('(' + guideMan[1] + ')', box0) : null;
yes('B5 every class a material rests on has its words (' + Object.keys(classes).join(', ') + ')',
    !!WHO && Object.keys(classes).length >= 5 && Object.keys(classes).every(function (c) { return !!WHO[c]; }));
yes('B5 every maneuver has its words', !!MAN && bul.concat(ber).every(function (x) { return !!MAN[x[0]]; }));
yes('B5 every profession has a page and a climb sentence, and every half with no recipe rows says what it makes instead',
    !!TEXT && Object.keys(G.professions).length === 8 && Object.keys(G.professions).every(function (p) {
      const t = TEXT[p];
      if (!t || !t.climb) return false;
      return Object.keys(G.professions[p].halves).every(function (h) {
        return G.professions[p].halves[h].count > 0 || !!(t.makes && t.makes[h]);
      });
    }));
const iron = G.professions.smith.materials.filter(function (x) { return x[0] === 'Iron Ingot'; })[0];
yes('B6 a Smith\'s Iron Ingot is smelted at the smelter from Iron Ore, a Miner\'s at Novice, with the mines that hold it (' + JSON.stringify(iron) + ')',
    !!iron && iron[2] === 'miner' && iron[3] === 'novice' && iron[4] === 'Smelter' && iron[5].join() === 'Iron Ore' &&
    iron[6].length === 3 && iron[6].indexOf('Halted Stream Camp') >= 0);
const fat = G.professions.tailor.materials.filter(function (x) { return x[0] === 'Troll Fat'; })[0];
yes('B6 a Tailor\'s Troll Fat names kinds of troll and no troll with a name of its own (' + JSON.stringify(fat) + ')',
    !!fat && fat[2] === 'hunter' && fat[6].length > 0 && fat[6].every(function (n) { return /Troll/.test(n); }));

// ---------------------------------------------------------- C. the page --
const sentPage = [];
const saidLines = [];
function node(tag) {
  const n = { tag: tag, children: [], style: {}, className: '', _text: '', id: '', onclick: null, title: '' };
  Object.defineProperty(n, 'textContent', {
    get: function () { return n._text + n.children.map(function (c) { return c.textContent; }).join(''); },
    set: function (v) { n._text = String(v); n.children = []; }
  });
  n.appendChild = function (c) { n.children.push(c); return c; };
  n.querySelector = function (sel) { return (n._q && n._q[sel]) || node('div'); };
  return n;
}
const docu = {
  head: node('head'), body: node('body'),
  createElement: function (tag) {
    const n = node(tag);
    Object.defineProperty(n, 'innerHTML', { set: function () {
      const close = node('div'); close._q = { span: node('span'), '.key': node('span') };
      n._q = { '.title': node('div'), '.who': node('div'), '.nav': node('div'), '.body': node('div'),
               '.status': node('div'), '[data-act="confirm"]': node('div'), '[data-act="close"]': close, '.panel': node('div') };
    } });
    return n;
  },
  createTextNode: function (t) { const n = node('#text'); n._text = String(t); return n; }
};
const win = { innerWidth: 1920, innerHeight: 1080, addEventListener: function () { },
              skyrimPlatform: { sendMessage: function (to, msg) { sentPage.push(msg); } },
              thornswoodNet: { say: function (line) { saidLines.push(line); } } };
const box = { window: win, document: docu, setTimeout: function () { }, Date: Date, JSON: JSON, console: console };
vm.createContext(box);
let ran = true;
try { vm.runInContext(ui, box, { filename: 'thornswood-skills.js' }); } catch (e) { ran = false; console.log(e); }
const api = win.thornswoodSkills;
yes('C0 the K panel runs in a stand-in document', ran && !!api);
if (!api) { done(); }
const root = docu.body.children[0];
const nav = root._q['.nav'], body = root._q['.body'], confirmBtn = root._q['[data-act="confirm"]'], status = root._q['.status'];
const navRows = function () { return nav.children.filter(function (r) { return /navrow/.test(r.className); }); };
const navNames = function () { return navRows().map(function (r) { return r.children[0].textContent; }); };
const openNav = function (name) { navRows().filter(function (r) { return r.children[0].textContent === name; })[0].onclick(); };
const all = function (n, out) { out = out || []; out.push(n); n.children.forEach(function (c) { all(c, out); }); return out; };
const tabs = function () { return all(body).filter(function (n) { return /\bhalf\b/.test(n.className); }); };
const tab = function (name) { return tabs().filter(function (t) { return t.children[0].textContent === name; })[0]; };
const pages = [];
function seen() { pages.push(body.textContent); return body.textContent; }

const smith = { profession: 'smith', half: 'platewright', 'class': 'miner', ranks: { platewright: 'advanced', edgewright: 'novice', mine: 'novice' },
                tree: {}, placed: {}, points: 0, perks: {}, spells: {}, spellPoints: 0, creating: false, towns: [] };
api.open();
api.setData(null, { panel: smith });
yes('C1 in the world K lists Profession guides after the skill tree (' + navNames().join(', ') + ')',
    navNames().indexOf('Profession guides') > navNames().indexOf('Skill tree') && navNames().indexOf('Skill tree') >= 0);
openNav('Profession guides');
let text = seen();
yes('C1 it has a tab for each of the eight professions, its own marked yours and open',
    tabs().length === 8 && /\bon\b/.test(tab('Smith').className) && /\bmine\b/.test(tab('Smith').className) && /yours/.test(tab('Smith').textContent));
yes('C2 a Smith reads their rank in both halves (' + text.slice(0, 400) + ')', /You are Advanced Platewright and Novice Edgewright\./.test(text));
yes('C2 what it makes: each half, its benches with the rank each opens at, and its families',
    /What it makes/.test(text) && /Platewright: Armour/.test(text) && /Edgewright: Weapons/.test(text) &&
    /Works at the Forge, Smelter and Tanning rack from Novice; the Skyforge at Advanced\./.test(text) &&
    /Body armour/.test(text) && /\d+ novice, \d+ advanced, \d+ expert, \d+ master/.test(text) && /A new Novice can start with /.test(text));
yes('C2 where the materials come from, Iron Ingot with the smelter, the Miner and the mines',
    /Where the materials come from/.test(text) &&
    /Iron Ingot\d+ recipes ask for itMade at the smelter from Iron Ore, out of a Miner's work at Novice\. Veins in [^.]*Halted Stream Camp[^.]*, and \d+ more places\./.test(text) &&
    /burns one charcoal for each piece/.test(text));
yes('C2 how to rank up: what counts, the ladder, rest, the bench floor, the sister half and the party',
    /How to rank up/.test(text) && /Every craft that goes through at a bench of your half is one piece of work\./.test(text) &&
    /100 into Advanced, 250 into Expert and 600 into Master/.test(text) && /1\.5 at Novice, 1\.2 at Advanced, 0\.9 at Expert, 0\.6 at Master/.test(text) &&
    /Under 15 rest, nothing is made at a bench\./.test(text) && /sister half/.test(text) && /banks 15% more/.test(text));
yes('C3 the page has no Confirm and its line says nothing is sent',
    confirmBtn.style.display === 'none' && /Nothing here is picked or sent/.test(status.textContent));

tab('Warrior').onclick();
text = seen();
yes('C4 the Warrior tab reads the warrior: maneuvers by rank and kills, and the nav names it (' + navRows().filter(function (r) { return /Profession guides/.test(r.textContent); })[0].textContent + ')',
    /\bon\b/.test(tab('Warrior').className) && /Set/.test(text) && /Novice: a block costs half the stamina for 8 seconds\. 15 stamina, then 45 seconds to wait/.test(text) &&
    /Wreck/.test(text) && /a dragon 16/.test(text) && !/nothing is made at a bench/.test(text) &&
    /Profession guidesWarrior/.test(navRows().filter(function (r) { return /Profession guides/.test(r.textContent); })[0].textContent));
tab('Mage').onclick();
text = seen();
yes('C4 the Mage tab counts each school\'s spells and says what a school climbs on',
    /Destruction3 novice, 9 advanced, 6 expert, 3 master spells/.test(text) && /A spell learned is 5 work in its school/.test(text) &&
    /is 10 work in every school you hold/.test(text) && !/Each piece of work costs rest/.test(text));
tab('Alchemist').onclick();
text = seen();
yes('C4 the Alchemist tab says what a Blightbrewer makes with no recipes, and where ingredients come from',
    /Poisons, mixed at the alchemy lab/.test(text) && /Works at the Alchemy lab from Novice\./.test(text) && /a Gatherer's plants, a Hunter's parts/.test(text));
tab('Cook').onclick();
text = seen();
yes('C4 the Cook tab names what a new Confectioner can start with, the way the recipe book does (the perks came off in #4826)',
    /Confectioner: Desserts, breads, sweets/.test(text) && /A new Novice can start with Apple Dumpling/.test(text));
['Enchanter', 'Tailor', 'Woodworker'].forEach(function (p) { tab(p).onclick(); seen(); });
yes('C5 nothing on any tab was sent to the server or said in the chat', sentPage.filter(function (x) { return /pick/.test(x); }).length === 0 && saidLines.length === 0);
api.close();
api.open();
api.setData(null, { panel: smith });
openNav('Profession guides');
yes('C5 K shut and opened again reads your own profession, not the last tab', /\bon\b/.test(tab('Smith').className) && !/\bon\b/.test(tab('Woodworker').className));
if (process.env.SHOW) console.log(pages.join('\n\n'));
api.close();

// Somebody new: no profession yet, while creating, with Cook marked.
const fresh = { profession: null, half: null, 'class': null, ranks: {}, tree: {}, placed: {}, points: 0, perks: {}, spells: {},
                spellPoints: 0, creating: true, towns: [{ key: 'whiterun', name: 'Whiterun', hold: 'Whiterun Hold' }] };
api.open();
api.setData(null, { panel: fresh });
const crNav = navNames();
yes('C6 while creating the guides sit before Home and Review stays last (' + crNav.join(', ') + ')',
    crNav.indexOf('Profession guides') >= 0 && crNav.indexOf('Profession guides') === crNav.indexOf('Home') - 1 &&
    crNav[crNav.length - 1] === 'Review');
openNav('Profession');
const cookCard = all(body).filter(function (n) { return /\bcard\b/.test(n.className) && /^Cook/.test(n.textContent); })[0];
if (cookCard) cookCard.onclick();
openNav('Profession guides');
text = seen();
yes('C6 and they open on the profession marked, with no rank line and no Confirm',
    !!cookCard && /\bon\b/.test(tab('Cook').className) && !/You are /.test(text) && confirmBtn.style.display === 'none');
api.close();

// ---------------------------------------------------------- D. the words --
const help = read('game', 'ui', 'thornswood-help.js');
yes('D2 the help\'s Work topic says where the guides are', /Its Profession guides have a page for every ' \+\s*'profession/.test(help));
const words = pages.join('\n');
yes('D1 no em dash on any page', words.indexOf('—') < 0 && !/&mdash;/.test(words));
yes('D1 no banned word on any page', !/\bplayers?\b/i.test(words));
yes('D1 no number left unfilled, and nothing undefined', !/\{\w+\}/.test(words) && !/undefined|NaN/.test(words));
done();
