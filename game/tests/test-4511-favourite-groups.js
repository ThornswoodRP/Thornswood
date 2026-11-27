// test-4511-favourite-groups.js
//
// SkyUI's favourite groups are kept per character on the machine and put
// back at the next start. Issue #4511.
//
// WHY. SkyUI keeps its eight favourite groups only in SKI_FavoritesManager's
// arrays, which live in the save. There is no save here, so OnInit made them
// empty at every session's start. The front plugin now reads them when the
// Favorites menu closes (getScriptVariable, engine fork) and writes them to
// Data\Platform\thornswood-favourite-groups.json under the server and
// character, and fills them back (setScriptVariable) once SkyUI has made them
// at the next start. The launcher keeps the file with the account's settings.
//
// This lifts the block out of thornswood-front.js and drives it with a
// stand-in Skyrim Platform whose script variables are plain arrays, in a
// folder of its own. It also checks the launcher, the site and Ship-Rules name
// the same file.
//
// Read only, but for its own temp folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const FRONT = process.env.FRONT || path.join(ROOT, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
let failed = 0;
function yes(what, ok) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + what);
  if (!ok) { failed++; }
}

const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');
const FS = "  // ---------------------------------------------- SkyUI's favourite groups (#4511)";
const FE = "  // ---------------------------------------------- end SkyUI's favourite groups";
const a = front.indexOf(FS);
const b = a < 0 ? -1 : front.indexOf(FE, a);
yes('thornswood-front.js has its favourite groups block', a >= 0 && b > a);
if (a < 0 || b <= a) { process.exit(1); }
const block = front.slice(a, b);

const QUEST = 0xfe000a2a;
const FILE = 'Data/Platform/thornswood-favourite-groups.json';
// Load order: index 0 Skyrim.esm, 1 Dawnguard.esm; light 0x2a SkyUI_SE.esp, 0x31 Thornswood-Last.esp.
const MODS = ['Skyrim.esm', 'Dawnguard.esm'];
const LIGHT = {};
LIGHT[0x2a] = 'SkyUI_SE.esp';
LIGHT[0x31] = 'Thornswood-Last.esp';

function arrays() {
  const z = (n, v) => new Array(n).fill(v);
  return {
    _items1: z(128, null), _itemIds1: z(128, 0), _items2: z(128, null), _itemIds2: z(128, 0),
    _itemInvalidFlags2: z(128, false),
    _groupMainHandItems: z(8, null), _groupMainHandItemIds: z(8, 0),
    _groupOffHandItems: z(8, null), _groupOffHandItemIds: z(8, 0),
    _groupIconItems: z(8, null), _groupIconItemIds: z(8, 0)
  };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-favourites-'));
fs.mkdirSync(path.join(dir, 'Data', 'Platform'), { recursive: true });
const home = process.cwd();
process.chdir(dir);

function world(opts) {
  opts = opts || {};
  const w = { handlers: {}, vars: opts.vars === undefined ? arrays() : opts.vars, logs: [], sets: [] };
  const form = (id) => ({ id: id >>> 0 });
  w.form = form;
  w.sp = {
    on: function (name, fn) { (w.handlers[name] = w.handlers[name] || []).push(fn); },
    Form: { from: function (raw) { return raw ? { getFormID: function () { return raw.id; } } : null; } },
    Game: {
      getModName: function (i) { return MODS[i] || ''; },
      getLightModName: function (i) { return LIGHT[i] || ''; },
      getFormFromFile: function (local, file) {
        if (file === 'SkyUI_SE.esp' && local === 0x82a) { return { getFormID: function () { return QUEST; } }; }
        const i = MODS.indexOf(file);
        if (i >= 0) { return form((i << 24) | local); }
        for (const k of Object.keys(LIGHT)) { if (LIGHT[k] === file) { return form(0xfe000000 | (Number(k) << 12) | local); } }
        return null;
      }
    },
    getScriptVariable: function (q, script, name) {
      if (q !== QUEST || script !== 'SKI_FavoritesManager' || !w.vars) { return undefined; }
      return w.vars[name] === undefined ? undefined : w.vars[name].slice();
    },
    setScriptVariable: function (q, script, name, value) {
      if (q !== QUEST || script !== 'SKI_FavoritesManager' || !w.vars || !w.vars[name]) { return false; }
      if (!Array.isArray(value) || value.length !== w.vars[name].length) { throw new Error('setScriptVariable: ' + name + ': wrong size'); }
      w.sets.push(name);
      w.vars[name] = value.slice();
      return true;
    }
  };
  const make = new Function('sp', 'guard', 'log', 'HOST', 'require',
    'let PROFILE = ' + (opts.profile === undefined ? 7 : opts.profile) + ';\n' + block +
    '\nreturn { setProfile: function (p) { PROFILE = p; } };');
  w.F = make(w.sp, function (n, f) { return f; }, function () { w.logs.push(Array.prototype.join.call(arguments, ' ')); },
    opts.host || '1.2.3.4', require);
  w.tick = function (n) { for (let i = 0; i < (n || 30); i++) { (w.handlers.update || []).forEach(function (h) { h(); }); } };
  w.close = function (name) { (w.handlers.menuClose || []).forEach(function (h) { h({ name: name || 'FavoritesMenu' }); }); };
  return w;
}
const read = function () { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return null; } };

try {
  { // Nothing is kept before the groups were put back, and nothing before SkyUI made its arrays.
    const w = world({ vars: null });
    w.close();
    yes('a Favorites menu closed before the groups were put back keeps nothing', read() === null);
    w.tick();
    yes('  and while SkyUI has not made its arrays, nothing is written into them', w.sets.length === 0 &&
        w.logs.some(function (l) { return /waiting for SkyUI to make its arrays/.test(l); }));
  }
  { // A first session: empty groups are put, one is made, the close keeps it.
    const w = world();
    w.tick(29);
    yes('the arrays are looked at every 30 frames, not every frame', w.sets.length === 0);
    w.tick(1);
    yes('once SkyUI has made them, a character with nothing kept gets every array, empty',
        w.sets.length === 10 && w.vars._itemIds1.every(function (x) { return x === 0; }));
    // Group 1 (slots 0-31): Iron Sword from Skyrim.esm in slot 0, main hand and icon.
    // Group 5 (slots 128-159, the "2" arrays): a Thornswood-Last.esp item, light.
    w.vars._items1[0] = w.form(0x00012eb7); w.vars._itemIds1[0] = -123456;
    w.vars._groupMainHandItems[0] = w.form(0x00012eb7); w.vars._groupMainHandItemIds[0] = -123456;
    w.vars._groupIconItems[0] = w.form(0x00012eb7); w.vars._groupIconItemIds[0] = -123456;
    w.vars._items2[3] = w.form(0xfe031805); w.vars._itemIds2[3] = 99;
    w.vars._items1[5] = w.form(0xff000123); w.vars._itemIds1[5] = 5;
    w.close('InventoryMenu');
    yes('another menu closing keeps nothing', read() === null);
    w.close();
    const f = read();
    const c = f && f.characters && f.characters['1.2.3.4/7'];
    yes('the Favorites menu closing keeps the groups under the server and character', !!c);
    yes('  each item as its plugin and the id inside it, with its item id',
        c && JSON.stringify(c.slots[0]) === JSON.stringify(['Skyrim.esm|12eb7', -123456]));
    yes('  a light plugin\'s item by its own plugin, slot 131 for group 5',
        c && JSON.stringify(c.slots[131]) === JSON.stringify(['Thornswood-Last.esp|805', 99]));
    yes('  a form the game made this session is left out', c && c.slots[5] === undefined);
    yes('  and the main hand and icon with it', c && JSON.stringify(c.main[0]) === JSON.stringify(['Skyrim.esm|12eb7', -123456]) &&
        JSON.stringify(c.icon[0]) === JSON.stringify(['Skyrim.esm|12eb7', -123456]) && Object.keys(c.off).length === 0);
    yes('  written whole, with no temp file left', !fs.existsSync(FILE + '.tmp'));
  }
  { // The next session puts them back, at the load order of that session.
    LIGHT[0x31] = undefined; LIGHT[0x30] = 'Thornswood-Last.esp';
    const w = world();
    w.tick();
    yes('the next start puts the item back in its slot', w.vars._itemIds1[0] === -123456 && w.vars._items1[0].id === 0x00012eb7);
    yes('  a light plugin\'s item by the id it has now that the load order moved', w.vars._itemIds2[3] === 99 &&
        w.vars._items2[3].id === 0xfe030805);
    yes('  with its main hand and icon', w.vars._groupMainHandItemIds[0] === -123456 && w.vars._groupIconItems[0].id === 0x00012eb7);
    yes('  and says how many', w.logs.some(function (l) { return /put back 2 items for 1\.2\.3\.4\/7/.test(l); }));
    w.tick(300);
    yes('  once a session for each character', w.sets.length === 10);
  }
  { // A record no longer loaded is left out, slot and id alike.
    const keep = LIGHT[0x30];
    LIGHT[0x30] = undefined;
    const w = world();
    w.tick();
    yes('an item whose plugin is not loaded is left out with its id', w.vars._itemIds2[3] === 0 && w.vars._items2[3] === null &&
        w.logs.some(function (l) { return /put back 1 items .*1 whose record is not loaded left out/.test(l); }));
    LIGHT[0x30] = keep;
  }
  { // Another character, and another server, keep their own.
    const w = world({ profile: 8 });
    w.tick();
    yes('another character starts with empty groups', w.vars._itemIds1[0] === 0);
    w.vars._items1[1] = w.form(0x01000800); w.vars._itemIds1[1] = 42;
    w.close();
    const f = read();
    yes('  and keeps its own beside the first', f.characters['1.2.3.4/8'] && f.characters['1.2.3.4/7'] &&
        f.characters['1.2.3.4/8'].slots[1][0] === 'Dawnguard.esm|800');
    w.F.setProfile(7);
    w.close();
    yes('a pick of another character keeps nothing until that one\'s groups are put back',
        read().characters['1.2.3.4/7'].slots[0] !== undefined && read().characters['1.2.3.4/7'].slots[1] === undefined);
    w.tick();
    yes('  then puts that character\'s back over the other\'s', w.vars._itemIds1[0] === -123456 && w.vars._itemIds1[1] === 0);
    const other = world({ host: '9.9.9.9' });
    other.tick();
    yes('the same character number on another server is another character', other.vars._itemIds1[0] === 0);
  }
  { // While one of SkyUI's arrays is missing, it waits and keeps nothing.
    const w = world();
    delete w.vars._groupIconItemIds;
    w.tick();
    yes('while one of the arrays is missing, nothing is put back and it says it waits', w.sets.length === 0 &&
        w.logs.some(function (l) { return /waiting for SkyUI/.test(l); }));
    const before = fs.readFileSync(FILE, 'utf8');
    w.close();
    yes('  and the close keeps nothing over what was kept', fs.readFileSync(FILE, 'utf8') === before);
  }
  { // A put back that stops halfway keeps nothing that session.
    const w = world();
    const real = w.sp.setScriptVariable;
    w.sp.setScriptVariable = function (q, s, n, v) { if (n === '_groupOffHandItems') { return false; } return real(q, s, n, v); };
    w.tick();
    yes('a variable SkyUI does not have stops the put back and says so', w.logs.some(function (l) { return /could not put them back for 1\.2\.3\.4\/7.*SkyUI has no _groupOffHandItems/.test(l); }));
    const before = fs.readFileSync(FILE, 'utf8');
    w.close();
    yes('  and nothing is kept that session', fs.readFileSync(FILE, 'utf8') === before);
  }
  { // The file stays under what the site takes.
    const f = read();
    f.characters = {};
    const slots = {};
    for (let i = 0; i < 256; i++) { slots[i] = ['Thornswood-Last.esp|' + (0x800 + i).toString(16), 100000000 + i]; }
    for (let k = 0; k < 20; k++) { f.characters['1.2.3.4/' + (100 + k)] = { saved: 1000 + k, slots: slots, main: {}, off: {}, icon: {} }; }
    fs.writeFileSync(FILE, JSON.stringify(f));
    const w = world();
    w.tick();
    w.close();
    const after = fs.readFileSync(FILE, 'utf8');
    const kept = JSON.parse(after).characters;
    yes('the file stays under 48 KB, so the site never refuses it', after.length <= 48 * 1024);
    yes('  by leaving out the characters kept longest ago, never the one just kept', !!kept['1.2.3.4/7'] && !kept['1.2.3.4/100'] && !!kept['1.2.3.4/119']);
  }
} finally {
  process.chdir(home);
  fs.rmSync(dir, { recursive: true, force: true });
}

// The same file everywhere it is named.
const readRepo = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };
yes('the launcher keeps it with the account\'s settings as game/favourite-groups.json',
    /all\["game\/favourite-groups\.json"\] = Path\.Combine\(Paths\.Game, "Data\\\\Platform\\\\thornswood-favourite-groups\.json"\);/.test(readRepo('launcher/app/YourSettings.cs')));
const ys = require(path.join(ROOT, 'site', 'lib', 'your-settings.js'));
yes('  and the site keeps that name', ys.nameOk('game/favourite-groups.json'));
yes('Ship-Rules counts it as the machine\'s, so nobody\'s file ships',
    readRepo('scripts/release/Ship-Rules.ps1').indexOf("'Data\\Platform\\thornswood-favourite-groups.json',") >= 0);
yes('the front names the same file', block.indexOf("'" + FILE + "'") >= 0);
yes('the engine calls it needs are declared by the fork', (function () {
  const d = path.join(ROOT, 'engine', 'skymp', 'skyrim-platform', 'src', 'platform_se', 'codegen', 'convert-files', 'skyrimPlatform.ts');
  if (!fs.existsSync(d)) { return true; }
  const t = fs.readFileSync(d, 'utf8');
  return /function getScriptVariable\(/.test(t) && /function setScriptVariable\(/.test(t);
})());

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
