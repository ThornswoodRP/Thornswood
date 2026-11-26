'use strict';
/*
  #4442. The merchant, offices and voice pages say what the code does.

  The pages were written while the work they describe was still being built,
  and nothing compared them with the code afterwards, so they kept saying the
  old 249-trader roster, "unbound" and "required" work that is bound and
  tested, a commission count the activation list does not have, no Citizen
  role for Raven Rock, and two different things about the voice switches.

  Every number here is read from the code or the activation list, never
  copied, so a page fails this again when the code moves:
    C  the commission count: every count of commissions on the merchant
       pages is game/data/merchant-quest-activation.json's commissions;
    R  the roster: merchants-guild.md names the roster's kept traders, the
       history it keeps, and their opening total from the purse the ledger
       opens a trader with, and not the old 249-trader roster as current;
    S  scarce and retrieval work: every scarce quest has its one appointed
       specialist and every retrieval its specialist, so none of the seven
       pages Patrick named calls that work unbound, unfinished or not
       switched on, and the regressions they name are harnesses that exist;
    O  offices.md gives Raven Rock the Citizen role the bot makes for it;
    V  voice.md says what /silence and /unsilence do as staff.ts runs them,
       and one thing about where the three switches are.

  Ends by setting process.exitCode, never process.exit (#6036).
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const has = (rel) => fs.existsSync(path.join(ROOT, rel));

let pass = 0, fail = 0;
function yes(name, ok, why) {
  if (ok) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
function valueOf(token) {
  const t = String(token).toLowerCase().replace(/,/g, '');
  if (/^\d+$/.test(t)) return Number(t);
  if (t === 'hundred' || t === 'a hundred') return 100;
  const i = WORDS.indexOf(t);
  return i < 0 ? NaN : i;
}
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const PAGES = {
  guild: 'docs/systems/merchants-guild.md',
  expansion: 'docs/systems/merchant-expansion.md',
  catalogue: 'docs/systems/merchant-quest-catalogue.md',
  legacy: 'docs/systems/merchant-legacy-offers.md',
  pearl: 'docs/systems/merchant-pearl-bed.md',
  allHold: 'docs/systems/merchant-all-hold-deliveries.md',
  geode: 'docs/systems/merchant-geode-work.md',
  longfin: 'docs/systems/merchant-longfin-work.md',
  regional: 'docs/systems/merchant-regional-deliveries.md',
  offices: 'docs/systems/offices.md',
  voice: 'docs/systems/voice.md'
};
const page = {};
for (const k of Object.keys(PAGES)) page[k] = read(PAGES[k]);

// ------------------------------------------------------------- the code
const activation = JSON.parse(read('game/data/merchant-quest-activation.json'));
const COMMISSIONS = activation.commissions.length;
const SCENES = activation.killScenes.length;

const roster = JSON.parse(read('game/data/merchant-roster.json'));
const KEPT = roster.merchants.length;
const HISTORY = roster.history.length;

const purses = read('game/gamemode/npc-merchant-purses.ts');
const purseMatch = /state=\{version:1,reference:identity\.reference,base:identity\.base,purse:(\d+),stock:\[\]\}/.exec(purses);
const PURSE = purseMatch ? Number(purseMatch[1]) : NaN;

const quests = read('game/gamemode/custom-quests.ts');
const scarceBlock = (/var SCARCE = \[([\s\S]*?)\n  \];/.exec(quests) || [])[1] || '';
const SCARCE = (scarceBlock.match(/\bid: '([a-z]+)'/g) || []).map((m) => m.slice(5, -1));
const offerBlock = (/var LEGACY_OFFER_REF = \{([\s\S]*?)\};/.exec(quests) || [])[1] || '';
const OFFER = {};
(offerBlock.match(/([a-z]+):'([^']+)'/g) || []).forEach((m) => { const i = m.indexOf(':'); OFFER[m.slice(0, i)] = m.slice(i + 2, -1); });
const sceneBlock = (/var SCENE = \[([\s\S]*?)\n  \];/.exec(quests) || [])[1] || '';
const RETRIEVALS = (sceneBlock.match(/id: '([a-z]+)'[^\n]*kind: 'retrieval'/g) || []).map((m) => /id: '([a-z]+)'/.exec(m)[1]);
const terms = read('scripts/dev/Build-MerchantRetrievalSources.py');
const termBlock = (/TERMS = \[([\s\S]*?)\n\]/.exec(terms) || [])[1] || '';
const TERM_ROWS = (termBlock.match(/\('([a-z]+)', [^\n]*'(Smith|Woodworker|Tailor|Enchanter|Cook|Alchemist)', \d+, \d+\)/g) || [])
  .map((m) => /\('([a-z]+)'/.exec(m)[1]);

const staff = read('game/gamemode/staff.ts');
const SILENCE_DEFAULT = Number((/var SILENCE_DEFAULT_MIN = (\d+);/.exec(staff) || [])[1]);
const maxMatch = /var SILENCE_MAX_MIN = (\d+) \* (\d+);/.exec(staff);
const SILENCE_MAX = maxMatch ? Number(maxMatch[1]) * Number(maxMatch[2]) : NaN;
const silenceBranch = (/if \(word === '\/silence'\) \{([\s\S]*?)\n    \}/.exec(staff) || [])[1] || '';
const unsilenceBranch = (/if \(word === '\/unsilence'\) \{([\s\S]*?)\n    \}/.exec(staff) || [])[1] || '';

const party = read('game/ui/thornswood-party.js');
const partyRows = party.slice(party.indexOf("html += '<div><h3>Your party</h3>';"), party.indexOf("html += '<div><h3>Friends</h3>';"));
const friendRows = party.slice(party.indexOf("html += '<div><h3>Friends</h3>';"), party.indexOf("html += '<div><h3>Near you</h3>';"));

const discord = read('bot/Apply-Discord.py');
const botHolds = (/^HOLDS = \[([\s\S]*?)\]/m.exec(discord) || [])[1] || '';

yes('0 the code reads: ' + COMMISSIONS + ' commissions, ' + KEPT + ' of ' + HISTORY + ' traders kept at ' + PURSE + ', ' +
    SCARCE.length + ' scarce and ' + RETRIEVALS.length + ' retrievals, silence ' + SILENCE_DEFAULT + ' to ' + SILENCE_MAX + ' minutes',
    COMMISSIONS > 0 && SCENES > 0 && KEPT > 0 && HISTORY > KEPT && PURSE > 0 && SCARCE.length > 0 && RETRIEVALS.length > 0 &&
    SILENCE_DEFAULT > 0 && SILENCE_MAX > SILENCE_DEFAULT && !!silenceBranch && !!unsilenceBranch && !!partyRows && !!friendRows);

// ------------------------------------------------- C: the commission count
const MERCHANT_PAGES = ['guild', 'expansion', 'catalogue', 'legacy', 'pearl', 'allHold', 'geode', 'longfin', 'regional'];
const COUNT = /\b(?:the |a )?(hundred|\d[\d,]*|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty) (?:delivery |parcel |guild |published |authored )?commissions\b/gi;
for (const k of MERCHANT_PAGES) {
  const wrong = [];
  let m;
  while ((m = COUNT.exec(page[k])) !== null) {
    // "A character may hold three commissions" is a limit, not a count.
    if (/\bhold $/.test(page[k].slice(Math.max(0, m.index - 5), m.index))) continue;
    if (valueOf(m[1]) !== COMMISSIONS) wrong.push(m[0]);
  }
  yes('C1 ' + PAGES[k] + ': every count of commissions is the activation list\'s ' + COMMISSIONS,
      wrong.length === 0, 'says: ' + wrong.join(' | '));
}
yes('C2 the catalogue gives the activation list\'s ' + COMMISSIONS + ' delivery commissions and ' + SCENES + ' kill scenes',
    page.catalogue.indexOf(COMMISSIONS + ' delivery commissions') !== -1 &&
    new RegExp('\\b' + WORDS[SCENES] + ' kill scenes', 'i').test(page.catalogue));
yes('C3 the legacy offers page gives the same ' + COMMISSIONS,
    new RegExp('\\b' + COMMISSIONS + '\\s+parcel\\s+commissions').test(page.legacy));

// ----------------------------------------------------------- R: the roster
yes('R1 merchants-guild.md does not call the 249-trader roster current',
    !/249-trader count below\s+describes the current controller/.test(page.guild) &&
    !/The 249 retained, authored traders/.test(page.guild) &&
    !/across those 249 references/.test(page.guild));
yes('R2 it names the ' + KEPT + ' guild traders and the ' + HISTORY + ' identities the ledger keeps',
    new RegExp('\\b' + KEPT + ' guild traders').test(page.guild) &&
    new RegExp('\\b' + HISTORY + ' ').test(page.guild) && new RegExp('\\b' + (HISTORY - KEPT) + ' retired').test(page.guild));
yes('R3 its opening total is ' + KEPT + ' times ' + PURSE + ', ' + grouped(KEPT * PURSE) + ' gold',
    page.guild.indexOf(grouped(KEPT * PURSE) + ' gold') !== -1 && page.guild.indexOf('62,250') === -1);

// ------------------------------------------------- S: scarce and retrievals
const unappointed = SCARCE.filter((id) => !OFFER[id]);
yes('S0 the code appoints a specialist to each of the ' + SCARCE.length + ' scarce works, and binds each of the ' +
    RETRIEVALS.length + ' retrievals to a hold\'s trade',
    unappointed.length === 0 && RETRIEVALS.length === TERM_ROWS.length &&
    RETRIEVALS.every((id) => TERM_ROWS.indexOf(id) !== -1), 'unappointed: ' + unappointed.join(', '));
const STALE = [
  /(?:regressions|bindings|interactions|retrievals|interaction work in the issue) (?:also )?remains? (?:required|unbound)/i,
  /remain unbound in this\s+section/i,
  /interactions are unfinished/i,
  /enable the thirteen unbound contracts/i,
  /keeps its earlier offers\s+until/i,
  /does not enable the expanded profession/i,
  /No new quest, unbound objective, roster cut or reward is enabled/i,
  /the quest work is not finished/i
];
for (const k of ['pearl', 'allHold', 'legacy', 'geode', 'longfin', 'catalogue', 'expansion', 'regional']) {
  const said = STALE.filter((re) => re.test(page[k])).map((re) => (re.exec(page[k]) || [''])[0]);
  yes('S1 ' + PAGES[k] + ' calls no bound work unbound, unfinished or not switched on', said.length === 0, 'says: ' + said.join(' | '));
}
yes('S2 the legacy offers page says all ' + WORDS[SCARCE.length] + ' scarce works and all ' + WORDS[RETRIEVALS.length] + ' retrievals are bound',
    new RegExp('all ' + WORDS[SCARCE.length] + ' scarce', 'i').test(page.legacy) &&
    new RegExp('all ' + WORDS[RETRIEVALS.length] + ' retrievals', 'i').test(page.legacy));
for (const k of ['geode', 'longfin']) {
  const named = page[k].match(/game\/tests\/test-[a-z0-9-]+\.js/g) || [];
  const missing = named.filter((p) => !has(p));
  yes('S3 ' + PAGES[k] + ' names the pearl, crimson and geode regressions by harness, and each exists',
      ['test-merchant-pearl-bed.js', 'test-merchant-crimson.js', 'test-merchant-geode.js'].every((t) => named.indexOf('game/tests/' + t) !== -1) &&
      missing.length === 0, 'named ' + named.join(', ') + (missing.length ? '; missing ' + missing.join(', ') : ''));
}

// ------------------------------------------------------- O: Raven Rock
yes('O0 the bot makes a Citizen role for each of its holds, Raven Rock among them',
    /'Raven Rock'/.test(botHolds) && /for _h in HOLDS:[\s\S]{0,200}ROLES\.append\(\('Citizen of ' \+ _h/.test(discord));
yes('O1 offices.md gives Raven Rock its Citizen role and channels',
    !/Raven Rock has no Citizen role/.test(page.offices) && /Citizen of\s+Raven Rock/.test(page.offices) &&
    /discord\.md#raven-rock/.test(page.offices));

// ------------------------------------------------------------ V: voice
yes('V0 staff.ts: /silence saves the end, and /unsilence saves the removal after checking for self-release',
    /requireRestraintSave\(pid, function \(doc\) \{\s*doc\.silenced\[them\.pid\] = \{ until: Date\.now\(\) \+ mins \* 60000/.test(silenceBranch) &&
    /if \(them\.pid === pid\) \{[^}]*return true;\s*\}[\s\S]*requireRestraintSave\(pid, function \(doc\) \{ delete doc\.silenced\[them\.pid\];/.test(unsilenceBranch));
const staffPart = page.voice.slice(page.voice.indexOf('## Staff silence'), page.voice.indexOf('## Voice as words'));
yes('V1 voice.md: ' + SILENCE_DEFAULT + ' minutes unless said, a day at most (' + SILENCE_MAX + ' minutes)',
    SILENCE_MAX === 24 * 60 && new RegExp('minutes if not ' + SILENCE_DEFAULT + ' \\(a day at most\\)').test(staffPart));
yes('V2 voice.md: /silence on somebody already silenced starts their time again from then, longer or shorter',
    /`\/silence` on somebody already silenced starts their time again/.test(staffPart) && !/`\/silence` again lifts/.test(page.voice));
yes('V3 voice.md: /unsilence lifts it, from any staff member but the one silenced',
    /`\/unsilence` and the name, from any staff member but the one silenced,\s+lifts it/.test(staffPart));
yes('V4 the party rows on P carry no switches, a friend\'s row carries all three',
    partyRows.indexOf('data-do="mute"') === -1 && partyRows.indexOf('data-do="mtext"') === -1 &&
    friendRows.indexOf('data-do="mute"') !== -1 && friendRows.indexOf('data-do="mtext"') !== -1 && friendRows.indexOf('data-do="mname"') !== -1);
yes('V5 voice.md says one thing about the switches: the look-at prompt has the voice switch alone, the party rows none',
    !/The look-at prompt offers the same three/.test(page.voice) &&
    !/three switches for each friend and for each person in\s+your party/.test(page.voice) &&
    (page.voice.match(/look-at\s+prompt\s+offers\s+only\s+the\s+voice\s+switch/g) || []).length >= 1 &&
    /party\s+rows\s+on\s+P\s+have\s+no\s+switches/.test(page.voice));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
