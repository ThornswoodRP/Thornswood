// test-open-switch.js
//
// Issue #428: "There is no public mode: the panel, the read-only posts, the
// access list and the age question all describe the closed playtest, and
// nobody ever accepts the rules."
//
// Patrick, 28 Sep: "we are in alpha so the world is open by application".
// So the site says an alpha, open by application; the application in the
// Discord asks whether you accept the rules and the site keeps that answer
// against the Discord id; and the one switch the issue asked for is built and
// left OFF: "open": true in the site's config.json puts Member on the play
// list, tells the bot and the pages through /api/public, and the written
// pages and the home page change with it.
//
// What this proves, by running the code lifted out of site/server.js (it
// opens a port and reads a config when required, so it is cut out and run
// with stand-ins, the way test-bans.js lifts standing()):
//   - standing() gives play to an account holding only Member with the
//     switch on, and not with it off, and never to one without Member;
//   - the switch is off by default and only a real true opens it;
//   - forMode serves only one mode's wording from join, help, rules, terms
//     and home, with no marker left over;
//   - noteRules keeps the latest rules answer per Discord id, keeps the time
//     of the first yes, and never writes over a file it cannot read;
//   - the no role message says apply in the alpha and Member when open;
//   - nothing people read says closed playtest, across line breaks too.
//
// Read only apart from a temporary folder it removes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join('');
const src = siteFiles.source();

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function between(text, a, b) {
  const i = text.indexOf(a);
  const j = i < 0 ? -1 : text.indexOf(b, i + a.length);
  return (i >= 0 && j > i) ? text.slice(i, j) : '';
}

// ------------------------------------------------------------ the switch --
const sw = between(src, '// ==== thornswood open switch ====', '// ==== end thornswood open switch ====');
yes('server.js has the open switch block', sw.length > 0);
const cfgBox = { open: false };
const lift = new Function('cfg', sw + '\nreturn { playRoles: playRoles, forMode: forMode, notAcceptedYet: notAcceptedYet };');
const S = lift(cfgBox);

yes('the switch is off by default: open: false in the defaults',
    /\n  open: false,\n  access: \{/.test(src));
yes('only a real true opens it', /cfg\.open = cfg\.open === true;/.test(src));
yes('and the play list is built from it once the config is read',
    src.indexOf('cfg.access.play = playRoles(cfg.access.play, cfg.open);') >
    src.indexOf("cfg.access  = Object.assign({ admin:[], play:[], banned:[] }, cfg.access || {});"));
yes('/api/public tells the bot and the pages', /\n      open: cfg\.open === true,\n      invite: cfg\.discord\.invite/.test(src));

const PLAY = ['Owner', 'Dev', 'Moderator', 'Gamemaster', 'Loremaster', 'Content Creator', 'Playtester'];
yes('off: the play list is exactly what it was', JSON.stringify(S.playRoles(PLAY, false)) === JSON.stringify(PLAY));
yes('on: Member is added', S.playRoles(PLAY, true).indexOf('Member') >= 0);
yes('LOCKED closed: committed defaults keep open: false (#428 Patrick 15 Oct)',
    /\n  open: false,\n  access: \{/.test(src) && /LOCKED 12 Oct and 15 Oct/.test(src));
yes('LOCKED closed: open-switch comment forbids flipping from this card',
    /LOCKED closed \(Patrick, 12 Oct option B \+ 15 Oct via Smeagle\)/.test(src));
yes('LOCKED closed: playRoles(off) never injects Member',
    S.playRoles(PLAY, false).indexOf('Member') < 0 &&
    S.playRoles(['Playtester'], false).indexOf('Member') < 0 &&
    S.playRoles([], false).indexOf('Member') < 0);
yes('on: once, however often it runs', S.playRoles(S.playRoles(PLAY, true), true).filter((n) => n === 'Member').length === 1);
yes('"true" as a string is not on', S.playRoles(PLAY, 'true').indexOf('Member') < 0);
yes('it never changes the list it was given', PLAY.indexOf('Member') < 0);
yes('a config with no play list still works', JSON.stringify(S.playRoles(undefined, true)) === '["Member"]');

// ----------------------------------------------------- standing(), run --
const stHead = 'async function standing(discordId) {';
const stFrom = src.indexOf(stHead);
// Through holdsStaffRole (#481), holdsNamedRole (#1417, #1420) and
// leaderRoles (#3317), which standing() calls and which follow it, in that
// order.
const stStaff = src.indexOf('\nfunction holdsStaffRole(', stFrom);
const stNamed = src.indexOf('\nfunction holdsNamedRole(', stFrom);
const stLead = src.indexOf('\nfunction leaderRoles(', stFrom);
const stRoles = Math.max(stStaff, stNamed, stLead);
const stTo = stFrom < 0 ? -1 : src.indexOf('\n}\n', stRoles > stFrom ? stRoles : stFrom);
const stSrc = (stFrom >= 0 && stTo > stFrom) ? src.slice(stFrom, stTo + 2) : '';
yes('standing() is in server.js', stSrc.length > 0);

const ROLE_IDS = { r1: 'Member', r2: 'Playtester', r3: 'Banned', r4: 'Moderator' };
function standingWith(open, roleIds) {
  const cfg = {
    admins: [],
    discord: { botToken: 'x', guildId: 'y' },
    access: { admin: ['Owner', 'Dev'], play: S.playRoles(PLAY, open), banned: ['Banned'],
              dev: ['Owner', 'Dev'], jarl: ['Jarl'] }
  };
  // standing() reads bans through bansNow() since #2186.
  const make = new Function('cfg', 'jsonFile', 'BANS', 'memberOf', 'roleNames', 'bansNow', 'BANS_BROKEN_WHY',
                            stSrc + '\nreturn standing;');
  const standing = make(cfg, () => ({}), 'bans.json',
    async () => ({ ok: true, body: { roles: roleIds, user: { username: 'ann' } } }),
    async () => ROLE_IDS, () => ({ table: {}, broken: '' }), '');
  return standing('123');
}

(async function () {
  const offMember = await standingWith(false, ['r1']);
  const onMember = await standingWith(true, ['r1']);
  const offTester = await standingWith(false, ['r1', 'r2']);
  const onNone = await standingWith(true, []);
  const onBanned = await standingWith(true, ['r1', 'r3']);
  yes('switch OFF: an account with only Member cannot play', offMember.play === false && offMember.inGuild === true);
  yes('switch ON: an account with only Member can play', onMember.play === true);
  yes('switch OFF: a Playtester can play, as today', offTester.play === true);
  yes('switch ON: an account with no role at all still cannot', onNone.play === false);
  yes('switch ON: Banned still wins over Member', onBanned.play === false && onBanned.banned === true);
  yes('switch ON: Member alone is not staff or dev', onMember.admin === false && onMember.dev === false);

  // ------------------------------------------------ the written pages --
  function modes(rel) {
    const raw = read(rel);
    cfgBox.open = false; const off = S.forMode(raw, false);
    cfgBox.open = true; const on = S.forMode(raw, true);
    cfgBox.open = false;
    return { raw: raw, off: off, on: on };
  }
  const join = modes('site/data/site/join.md');
  yes('join.md has both wordings', /<!-- alpha -->/.test(join.raw) && /<!-- open -->/.test(join.raw));
  yes('join, off: step 1 is Apply, with the rules and the age question',
      /## 1\. Apply/.test(join.off) && /Apply to be an alpha playtester/.test(join.off) &&
      /whether you accept the rules/.test(join.off) && /eighteen or over/.test(join.off));
  yes('join, off: none of the open wording', !/## 1\. Come into the Discord/.test(join.off));
  yes('join, on: step 1 is come into the Discord, no application',
      /## 1\. Come into the Discord/.test(join.on) && !/Apply to be an alpha playtester/.test(join.on) &&
      !/## 1\. Apply/.test(join.on));
  yes('join, on: eighteen and over stays', /eighteen and over/.test(join.on));
  yes('join: no marker is left in either', !/<!--/.test(join.off) && !/<!--/.test(join.on));
  yes('join: everything outside the markers is in both',
      /## 2\. Take the installer/.test(join.off) && /## 2\. Take the installer/.test(join.on));

  const help = modes('site/data/help.md');
  yes('help, off: says open by application', /open by\s+application/.test(help.off) && !/Thornswood is open /.test(help.off));
  yes('help, on: says anyone in the Discord can play', /anyone in the Discord can play/.test(help.on.replace(/\s+/g, ' ')) && !/open by\s+application/.test(help.on));
  yes('help: the numbered steps survive the markers in both',
      /4\. Press \*\*Connect Discord\*\*/.test(help.off) &&
      /It works once your application has been accepted/.test(help.off.replace(/\s+/g, ' ')) &&
      !/It works once your application/.test(help.on) &&
      /4\. Press \*\*Connect Discord\*\*/.test(help.on) && !/<!--/.test(help.off + help.on));
  const rules = modes('site/data/site/rules.md');
  yes('rules, off: the application asks whether you accept these rules',
      /asks whether you accept these rules/.test(rules.off) && !/<!--/.test(rules.off));
  yes('rules, on: being here means accepting them',
      /Being in the Discord or in the world means accepting these rules/.test(rules.on) &&
      !/asks whether you accept these rules/.test(rules.on));
  const terms = modes('site/data/site/terms.md');
  yes('terms, off: applying means accepting them', /Applying means accepting them/.test(terms.off));
  yes('terms, on: no application sentence', !/Applying means accepting them/.test(terms.on) && !/<!--/.test(terms.on));

  const home = modes('site/public/home.html');
  yes('home, off: the notice says alpha and Apply',
      /<b>Alpha, eighteen and over\.<\/b>/.test(home.off) && !/<b>Open, eighteen and over\.<\/b>/.test(home.off));
  yes('home, on: the notice says open and Join the Discord',
      /<b>Open, eighteen and over\.<\/b>/.test(home.on) && !/<b>Alpha, eighteen and over\.<\/b>/.test(home.on));
  yes('home, on: the closing button is Join the Discord, not Apply',
      />Join the Discord<\/a>/.test(home.on) && !/rel="noopener">Apply in the Discord<\/a>\n/.test(home.on));
  yes('home: no mode marker left in either', !/<!-- \/?(?:alpha|open) -->/.test(home.off + home.on));
  yes('the site serves home.html through the switch',
      /let html = forMode\(fs\.readFileSync\(path\.join\(PUBLIC, 'home\.html'\), 'utf8'\), cfg\.open\);/.test(src));
  yes('and every written page', /return forMode\(fs\.readFileSync\(file, 'utf8'\), cfg\.open\);/.test(src));
  // Their script moved out of home.html into home.js in #1479 (no inline
  // script under the content security policy).
  yes('the downloads page and the status line follow /api/public open',
      ((home.raw + '\n' + read('site/public/home.js')).match(/d\.open === true/g) || []).length >= 5);

  // ---------------------------------------- what somebody not in is told --
  cfgBox.open = false;
  const alphaSay = S.notAcceptedYet();
  cfgBox.open = true;
  const openSay = S.notAcceptedYet();
  const openInner = S.notAcceptedYet(true);
  cfgBox.open = false;
  yes('alpha: told to apply, by name', /not been accepted into the alpha yet/.test(alphaSay) &&
      /Apply to be an alpha playtester/.test(alphaSay));
  yes('open: told about Member, not an application', /Member role/.test(openSay) && !/Apply/.test(openSay));
  yes('the sign in page reads on from "That account is in the Discord, but"', /^it /.test(openInner));
  yes('the launcher door and the join pass both use it',
      (src.match(/why:'role', message:\n\s+notAcceptedYet\(\),/g) || []).length === 1 &&
      (src.match(/why: 'role', message:\n\s+notAcceptedYet\(\) \}\);/g) || []).length === 1);
  yes('no refusal still says "no role that lets it in" on the play routes',
      !/\/api\/play\/(?:join|pass)[\s\S]{0,4000}no role that lets it in yet/.test(
        between(src, "if (p === '/api/play/join'", "if ((p === '/api/play/start'")) &&
      !/no role that lets it in yet/.test(between(src, "if (p === '/api/play/pass'", "\n  }\n")));

  // ------------------------------------------------- the rules record --
  const rulesBlock = between(src, '// ==== thornswood rules accepted ====', '// ==== end thornswood rules accepted ====');
  yes('server.js has the rules record block', rulesBlock.length > 0);
  const putJson = (p, o) => { try { fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8'); return true; } catch (e) { return false; } };
  const R = new Function('fs', 'path', 'DATA', 'putJson', rulesBlock + '\nreturn { noteRules: noteRules, RULES_OK: RULES_OK };')(
    fs, path, os.tmpdir(), putJson);
  yes('it is kept in the data folder as rules-accepted.json', path.basename(R.RULES_OK) === 'rules-accepted.json');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-rules-'));
  try {
    const file = path.join(tmp, 'rules-accepted.json');
    const bookOf = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    yes('a yes is written down against the Discord id',
        R.noteRules(file, '111', { said: 'Yes, I accept', yes: true }, 'ann', 1000) === true &&
        bookOf()['111'].yes === true && bookOf()['111'].at === 1000 &&
        bookOf()['111'].said === 'Yes, I accept' && bookOf()['111'].firstYes === 1000);
    R.noteRules(file, '222', { said: 'no', yes: false }, 'bea', 2000);
    yes('a no is written down as a no, with no first yes', bookOf()['222'].yes === false && bookOf()['222'].firstYes === null);
    yes('and the first person is still there', bookOf()['111'].yes === true);
    R.noteRules(file, '111', { said: 'yes again', yes: true }, 'ann', 3000);
    yes('a later yes moves the time but not the first yes', bookOf()['111'].at === 3000 && bookOf()['111'].firstYes === 1000);
    R.noteRules(file, '222', { said: 'ok, yes', yes: true }, 'bea', 4000);
    yes('a yes after a no is the first yes', bookOf()['222'].firstYes === 4000);
    yes('the id is digits only', R.noteRules(file, '12<script>3', { said: 'y', yes: true }, 'x', 5) === true &&
        Object.prototype.hasOwnProperty.call(bookOf(), '123'));
    yes('no id, nothing written', R.noteRules(file, '', { yes: true }, 'x', 6) === false);
    yes('no answer, nothing written', R.noteRules(file, '999', null, 'x', 7) === false &&
        !Object.prototype.hasOwnProperty.call(bookOf(), '999'));
    yes('"yes" as a string is not a yes', R.noteRules(file, '333', { said: 'y', yes: 'true' }, 'x', 8) === true &&
        bookOf()['333'].yes === false);
    const long = 'x'.repeat(500);
    R.noteRules(file, '444', { said: long, yes: true }, long, 9);
    yes('what they said and their name are capped', bookOf()['444'].said.length === 200 && bookOf()['444'].by.length === 60);
    fs.writeFileSync(file, 'not json at all');
    yes('a file that cannot be read is never written over',
        R.noteRules(file, '555', { yes: true }, 'x', 10) === false &&
        fs.readFileSync(file, 'utf8') === 'not json at all');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const ticket = between(src, "if (route === '/api/ticket' && req.method === 'POST') {", "if (route === '/api/roadmap'");
  yes('/api/ticket writes the rules answer after the ticket is saved',
      ticket.indexOf('noteRules(RULES_OK, o.discordId, o.rules, o.by, Date.now())') >
      ticket.indexOf('putJson(INBOX, trimInbox(list))'));
  yes('and only when the bot sent one', /if \(o\.rules && !noteRules\(/.test(ticket));

  // -------------------------------------- nothing people read says it --
  const PEOPLE = ['README.md', 'SECURITY.md', 'site/data/help.md',
                  'site/public/home.html', 'site/public/home.js', 'bot/content.py',
                  'launcher/app/MainWindow.axaml', 'launcher/app/ShellPacks.cs']
    .concat(fs.readdirSync(path.join(ROOT, 'site/data/site')).filter((n) => /\.md$/.test(n))
      .map((n) => 'site/data/site/' + n));
  const said = PEOPLE.filter((rel) => fs.existsSync(path.join(ROOT, rel)) &&
                                      /closed[\s-]+playtest/i.test(read(rel)));
  yes('no people-facing file says closed playtest, across line breaks too (' + PEOPLE.length +
      ' read' + (said.length ? '; still in ' + said.join(', ') : '') + ')', said.length === 0);
  const board = JSON.parse(read('site/data/board.json'));
  yes('nor the Patreon wording kept on the board', !/closed[\s-]+playtest/i.test(JSON.stringify(board)));
  // Known Issues is the page /known writes, from the bot's list since #3140 (#2414).
  yes('nor the Known Issues page, across line breaks too',
      !/closed[\s-]+playtest/i.test(require('../../tests/fixtures/known-page').knownPage() || ''));
  yes('the launcher no longer holds the collection back until an application is accepted',
      !/b\.Content = "Apply first"/.test(read('launcher/app/ShellPacks.cs')) &&
      !/The collection opens once you have been accepted/.test(read('launcher/app/ShellPacks.cs')) &&
      !/Connect Discord first and this opens the collection/.test(read('launcher/app/Shell.cs')));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL  the test itself threw: ' + (e && e.stack || e));
  process.exit(1);
});
