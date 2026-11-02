// test-bard-instruments.js
//
// The tester note says what is actually wrong with the instruments, and what
// it says is still true of the code and of the plugin.
//
// From the To Do List, entry 306: "Bard instruments render badly and nobody
// has looked at why... Worth half an hour to find out which mod owns them and
// whether it is one of the scripted ones". The Do not report these list on
// the Test These page said only "Bard instruments look wrong.", which tells a
// tester nothing and the next developer less.
//
// Measured on 24 Sep. The flute, lute and drum a Woodwright can make are the
// WEAP records FluteWeapon, LuteWeapon and DrumWeapon in PlayFluteLuteDrum.esp.
// Each one carries the script instrumentOnEquip, and the three effects that
// play a note carry instrumentPlayOcarina, instrumentPlayLute and
// instrumentPlayDrum. The meshes are in the game folder and point at Skyrim's
// own textures, which are in Skyrim - Textures3.bsa. So no file is missing.
// What goes wrong is scripts, and a script attached to a record never fires
// here (the Known Issues page). That is the blocked Papyrus bucket, not something a release
// can fix.
//
// Read only. The plugin half runs only where the game folder is, and says SKIP
// anywhere else, because the build check on GitHub has no Skyrim.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR).join('');

const TESTS = process.env.TESTS_MD || path.join(REPO_DIR, 'site', 'data', 'tests.md');
const EMOTES = path.join(REPO_DIR, 'game', 'plugins', 'thornswood-emotes.js');
const INI = path.join(REPO_DIR, 'launcher', 'Thornswood.ini');
const GM = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const DATA = process.env.GAME_DATA || 'C:\\Thornswood\\Game\\Data';
const PLUGIN = 'PlayFluteLuteDrum.esp';

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the note
const tests = read(TESTS);
const at = tests.indexOf('## Do not report these');
const next = at < 0 ? -1 : tests.indexOf('\n## ', at + 1);
const note = at < 0 ? '' : tests.slice(at, next < 0 ? tests.length : next);
yes('the Do not report these list is on the Test These page', at >= 0);

yes('the vague line is gone', note.indexOf('Bard instruments look wrong') < 0);
yes('it names the plugin the instruments come from', note.indexOf(PLUGIN) >= 0);
yes('it says scripts are the cause, and that they never fire here',
    /scripts that never fire here/.test(note));
yes('it says what the instruments do: look wrong and play nothing',
    /flute, lute or drum looks wrong when you equip it and plays nothing/.test(note));
// Which letter it names is checked below, against the key the wheel is
// actually on.
const wheelSaid = /open the emote wheel with ([A-Z])\b[^.]*then search for Lute, Flute or Drum/.exec(note);
yes('it sends people to the wheel instead: a key, then a search for the three', !!wheelSaid);
yes('the rest of the list is still there',
    note.indexOf('Typing in another window') >= 0 &&
    note.indexOf('Mod settings menus reset') >= 0 &&
    note.indexOf('NPCs keep moving') >= 0 &&
    note.indexOf('You cannot save') >= 0);

const EM = String.fromCharCode(0x2014);
yes('no em dash in it', note.indexOf(EM) < 0);
yes('it never says player', !/player/i.test(note));

// ------------------------------------------------------ what it relies on
/*
  "scripts that never fire here" is the Known Issues page's own reason, and
  the instruments are on it as broken right now. Since #3140 that page is
  written from the issue board: those two rows are the "Known issue:"
  comments on the mod scripts issue and on the instruments issue, which no
  file here holds, so nothing in this harness can read them.
*/

/*
  The wheel's key. The plugin reads WheelKey out of Thornswood.ini, and a
  machine with no ini is given launcher\Thornswood.ini by
  ThornIni.Ensure, so the template's WheelKey is the key a tester has unless
  they rebound it. The 48 in the plugin is only a fallback for a file with no
  WheelKey line, and it is out of date: the wheel moved from B to G on 13 Sep,
  and B is the voice range key now (TEST 11). The first version of this note
  said B because it read that fallback, so this reads the template.
*/
const emotes = read(EMOTES);
yes('the plugin takes the wheel key from WheelKey in the ini',
    /(?:const|let) OPEN_KEY\s*=\s*key\('WheelKey', \d+\);/.test(emotes));

let section = '', wheelCode = NaN;
read(INI).split('\n').forEach(function (line) {
  const t = line.trim();
  const s = /^\[(.+)\]$/.exec(t);
  if (s) { section = s[1]; return; }
  const m = /^WheelKey\s*=\s*(\d+)$/.exec(t);
  if (section === 'Emotes' && m) wheelCode = parseInt(m[1], 10);
});
yes('the ini template sets WheelKey', !isNaN(wheelCode));

const letters = {};
const lt = emotes.indexOf('const LETTERS = {');
const ltEnd = lt < 0 ? -1 : emotes.indexOf('};', lt);
if (lt >= 0 && ltEnd >= 0) {
  const re = /(\d+): '([a-z])'/g;
  let m;
  while ((m = re.exec(emotes.slice(lt, ltEnd))) !== null) letters[m[1]] = m[2].toUpperCase();
}
const wheelLetter = letters[wheelCode] || '';
yes('WheelKey ' + wheelCode + ' is a letter key (' + (wheelLetter || '?') + ')', wheelLetter !== '');
yes('the note names that letter for the wheel, ' + (wheelLetter || '?') +
    (wheelSaid ? ', and it says ' + wheelSaid[1] : ''),
    !!wheelSaid && wheelLetter !== '' && wheelSaid[1] === wheelLetter);

/*
  Lute, Flute and Drum are names on the one list. The wheel used to keep
  them in a Revelry category. The note now says to search for them.
*/
const listAt = emotes.indexOf('const EMOTES = [');
const listEnd = listAt < 0 ? -1 : emotes.indexOf('\n];', listAt);
const list = (listAt >= 0 && listEnd >= 0) ? emotes.slice(listAt, listEnd) : '';
yes('the wheel lists Lute, Flute and Drum, played by Skyrim\'s own idles',
    /name: 'Lute',\s*event: 'IdleLuteStart'/.test(list) &&
    /name: 'Flute',\s*event: 'IdleFluteStart'/.test(list) &&
    /name: 'Drum',\s*event: 'IdleDrumStart'/.test(list));
yes('those three ask for the made instrument before they play',
    /lute:\s*\{\s*id:\s*0x1d9b/.test(emotes) &&
    /flute:\s*\{\s*id:\s*0xd62/.test(emotes) &&
    /drum:\s*\{\s*id:\s*0x287f/.test(emotes) &&
    /getItemCount/.test(emotes) &&
    /You need /.test(emotes));
yes('an emote idle this character did not just ask for is dropped',
    /ctx\.animEventName = ''/.test(emotes));
yes('standing up still works while the wheel is open, and not while a name is being typed',
    /__stand/.test(emotes) &&
    /function standUp\(/.test(emotes) &&
    /k\.toLowerCase\(\) === standChar/.test(read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-emotes.js'))));

/*
  The instruments a person can actually hold are the three this plugin adds,
  because they are the only instruments anybody can make. Skyrim's own lute,
  drum and flute are MISC records and cannot be held at all.
*/
const gm = require('./gamemode-tables.js').joined(read(GM));
const made = {};
// The gamemode reads RECIPES_BY_ID from game/gamemode-tables (#5191).
const BOOK = require('./gamemode-tables.js').table('RECIPES_BY_ID');
Object.keys(BOOK).forEach(function (k) {
  const m = /^([0-9a-f]+):PlayFluteLuteDrum\.esp$/.exec(BOOK[k].out || '');
  if (m) made[BOOK[k].name] = m[1];
});
yes('a flute, a lute and a drum can be made, and all three are ' + PLUGIN + '\'s',
    made.Flute === 'd62' && made.Lute === '1d9b' && made.Drum === '287f');

// ------------------------------------------------------------ the plugin
/*
  A plain walk of the plugin: records, groups, and the subrecords of each
  record. What it looks for is the script name in each record's VMAD and the
  mesh in its MODL.
*/
function records(buf) {
  const out = [];
  (function walk(s, e) {
    let p = s;
    while (p + 24 <= e) {
      const type = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (type === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      const flags = buf.readUInt32LE(p + 8);
      const id = (buf.readUInt32LE(p + 12) & 0xFFFFFF).toString(16);
      let body = buf.slice(p + 24, p + 24 + size);
      if (flags & 0x40000) body = zlib.inflateSync(body.slice(4));
      const subs = {};
      let q = 0, big = null;
      while (q + 6 <= body.length) {
        const st = body.toString('latin1', q, q + 4);
        let ss = body.readUInt16LE(q + 4);
        q += 6;
        if (st === 'XXXX') { big = body.readUInt32LE(q); q += ss; continue; }
        if (big !== null) { ss = big; big = null; }
        if (!subs[st]) subs[st] = body.slice(q, q + ss);
        q += ss;
      }
      out.push({ type: type, id: id, subs: subs });
      p += 24 + size;
    }
  })(0, buf.length);
  return out;
}
const str = (b) => b ? b.toString('latin1').replace(/\0+$/, '') : '';

const espPath = path.join(DATA, PLUGIN);
if (!fs.existsSync(espPath)) {
  console.log('SKIP  no ' + espPath + ' on this machine, so the plugin itself is not read');
} else {
  const recs = records(fs.readFileSync(espPath));
  const byId = {};
  recs.forEach(function (r) { byId[r.type + ' ' + r.id] = r; });

  [['Flute', 'd62'], ['Lute', '1d9b'], ['Drum', '287f']].forEach(function (w) {
    const r = byId['WEAP ' + w[1]];
    yes('the ' + w[0] + ' is a WEAP record in the plugin', !!r);
    if (!r) return;
    yes('the ' + w[0] + ' runs instrumentOnEquip when equipped',
        str(r.subs.VMAD).indexOf('instrumentOnEquip') >= 0);
    const nif = str(r.subs.MODL);
    yes('the ' + w[0] + '\'s mesh ' + nif + ' is in the game folder',
        nif !== '' && fs.existsSync(path.join(DATA, 'meshes', nif)));
  });

  [['PlayFluteEffect', 'instrumentPlayOcarina'],
   ['PlayLuteEffect', 'instrumentPlayLute'],
   ['PlayDrumEffect', 'instrumentPlayDrum']].forEach(function (e) {
    const r = recs.filter(function (x) { return x.type === 'MGEF' && str(x.subs.EDID) === e[0]; })[0];
    yes(e[0] + ' plays its notes through ' + e[1],
        !!r && str(r.subs.VMAD).indexOf(e[1]) >= 0);
  });
}


// ------------------------------------- bard is RP-only, not a class privilege
/*
  Issue #391: bard is roleplay only. Chargen must not hand PlayInstrumentSpell
  for state.class === bard any more.
*/
{
  const gm = require('./gamemode-tables.js').joined(read(GM));
  const code = gm
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('chargen no longer arms instruments for the old bard class key',
      !/if\s*\(\s*state\.class\s*===\s*['"]bard['"]/.test(code));
  yes('armBard is not called from an arriving-stage bard privilege',
      !/state\.class\s*===\s*['"]bard['"][\s\S]{0,80}armBard/.test(code));
  yes('RP_ONLY lists bard', /var RP_ONLY = \{[\s\S]*?\bbard:\s*\{/.test(gm));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
