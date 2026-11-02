'use strict';
/*
  test-2298-box-retired.js

      node site/tests/test-2298-box-retired.js

  #2298, Patrick's decision 3 of 15 October, A: the old steward-marked chest
  is retired, and the drop box on the notice board is the only box. Before
  this, a steward could open any container and press a hold on the Office
  page of K, which sent /box <hold>; the server remembered the container
  (touchedBox, the thornswoodBoxAt property), kept it in the register
  (boxes), and answered every put into it (putIn, from mp.onPutItem): only
  gold went in, and it was counted onto the hold's ledger. That was a second
  box with the old rules beside the board's, two truths.

  Alpha has no carry-over (Patrick, alpha no migrations): a chest that was
  marked simply becomes an ordinary container. So this checks:
    1. mp.onPutItem answers nothing for any container, a chest that was a
       hold's box included, and still refuses a session that has not shown
       its join pass, through the real guard() (#410).
    2. Nothing of the marking is left in the gamemode: no /box word, no
       handler, no property, no register key, no office view field.
    3. The K panel draws no box card and sends no /box line.
    4. The documents describe no marked chest, and the command list has no
       /box row.
    5. The board's drop box is untouched: E on it still opens it, and its
       line is still answered.

  Read only.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join(''); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function fnText(code, header) {
  const at = code.indexOf(header);
  if (at < 0) { return ''; }
  let depth = 0;
  for (let i = code.indexOf('{', at); i < code.length; i++) {
    if (code[i] === '{') { depth++; }
    else if (code[i] === '}') { depth--; if (depth === 0) { return code.slice(at, i + 1); } }
  }
  return '';
}
function strip(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const gm = read('game/gamemode.js');
const code = strip(gm);
const P0 = gm.indexOf('// ==== thornswood property ====');
const P1 = P0 < 0 ? -1 : gm.indexOf('// ==== end thornswood property ====', P0);
const prop = (P0 < 0 || P1 < 0) ? '' : strip(gm.slice(P0, P1));
yes('the property block is in the gamemode, between its markers', prop.length > 0);

// ------------------------------------------------- 1. a put, driven for real
{
  // guard() counts its time through countSpent() since #385, so both are lifted.
  const guardText = fnText(gm, 'function guard(name, fn) {') + '\n' + fnText(gm, 'function countSpent(name, began) {');
  const at = gm.indexOf("mp.onPutItem = guard('onPutItem'");
  const putText = at < 0 ? '' : gm.slice(at, gm.indexOf('\n});', at) + 4);
  yes('guard() and the put hook are in the gamemode', guardText.length > 0 && putText.length > 0);

  const HELD = 0xff000001, OK = 0xff000002;
  const GOLD = 0x0000000f, SWORD = 0x00012eb7;
  const WAS_BOX = 0x0004cafe, CHEST = 0x000a1b2c;
  const asked = [];
  const askedProp = [];
  const box = {
    Object: Object, Number: Number,
    console: { error: function () { }, log: function () { } },
    process: { hrtime: function () { return [0, 0]; } }, gmSpent: {},
    mp: {
      get: function (id, what) {
        asked.push([id, what]);
        if (what !== 'profileId') { throw new Error('the put hook read ' + what); }
        return id === HELD ? 700 : (id === OK ? 800 : -1);
      },
      set: function () { throw new Error('the put hook wrote something'); }
    },
    // A property block that still answers the old names, refusing every put
    // the way the marked chest refused a sword: the hook must not ask it.
    __thornswoodProperty: {
      putIn: function () { askedProp.push('putIn'); return false; },
      holdOfBox: function () { askedProp.push('holdOfBox'); return 'whiterun'; }
    },
    __thornswoodPassHeld: function (pid) { return pid === 700; }
  };
  box.globalThis = box;
  vm.createContext(box);
  let ran = true;
  try { vm.runInContext(guardText + '\n' + putText, box); } catch (e) { ran = false; console.log('  ' + e.message); }
  yes('the hook installs over a stand-in engine', ran && typeof box.mp.onPutItem === 'function');
  if (ran && typeof box.mp.onPutItem === 'function') {
    const put = box.mp.onPutItem;
    yes('gold into a chest that was a hold\'s box goes in like anywhere: the answer is exactly undefined',
        put(WAS_BOX, OK, GOLD, 40) === undefined);
    yes('so does a sword into it, which the marked chest used to hand back',
        put(WAS_BOX, OK, SWORD, 1) === undefined);
    yes('and anything into any other chest', put(CHEST, OK, SWORD, 1) === undefined);
    yes('a session that has not shown its join pass is still refused a put (#410)',
        put(CHEST, HELD, GOLD, 1) === false);
    yes('the hook read nothing but who was putting, and asked the property block nothing',
        asked.every(function (a) { return a[1] === 'profileId'; }) && askedProp.length === 0);
  }
}

// --------------------------------------- 2. nothing of the marking is left
{
  const arrayOf = function (name) {
    const m = new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);').exec(gm);
    if (!m) { return null; }
    try { return new Function('return ' + strip(m[1]))(); } catch (e) { return null; }
  };
  const WORDS = arrayOf('WORDS');
  const PLAYER = arrayOf('PLAYER_WORDS');
  yes('/box is not a word the server answers, and /dropbox and /board still are',
      !!WORDS && WORDS.indexOf('/box') === -1 && WORDS.indexOf('/dropbox') !== -1 && WORDS.indexOf('/board') !== -1);
  yes('nor one named to anybody', !!PLAYER && PLAYER.indexOf('/box') === -1);
  yes('no dispatcher hands /box on', !/word === '\/box'/.test(code));
  const gone = ['function boxCmd', 'function putIn', 'function touchedBox', 'function boxAt',
                'function holdOfBox', 'BOX_PROPERTY', "'thornswoodBoxAt'", "loadPart('boxes'",
                'prop.touchedBox', 'prop.putIn', 'prop.holdOfBox'];
  const left = gone.filter(function (g) { return code.indexOf(g) !== -1; });
  yes('no handler, property or register key of the marking is left' + (left.length ? ' (' + left.join(', ') + ')' : ''),
      left.length === 0);
  const saveText = fnText(prop, 'function save() {');
  yes('the register is written without a boxes key', saveText.length > 0 && !/\bboxes\b/.test(saveText) &&
      /funds: funds/.test(saveText) && /dropbox: dropbox/.test(saveText));
  const viewText = fnText(prop, 'function officeView(');
  yes('the Office page view carries no container and no box', viewText.length > 0 &&
      !/\bbox\b/.test(viewText) && /view\.boards\.push/.test(viewText));
  const standing = fnText(prop, 'function holdStanding(');
  yes('standing at a hold is standing at its board, and nothing else',
      /return boardHere\(actorId\) \|\| '';/.test(standing));
  const onActivate = fnText(gm, "mp.onActivate = guard('onActivate'");
  yes('a container somebody opens is not remembered', onActivate.length > 0 && !/touchedBox|thornswoodBoxAt/.test(onActivate));
}

// ------------------------------------------------------------ 3. the K panel
{
  const ui = strip(read('game/ui/thornswood-skills.js'));
  yes('the Office page has no box card', ui.indexOf('function officeBox') === -1 && ui.indexOf('officeBox(') === -1);
  yes('and sends no /box line', !/'\/box /.test(ui));
  yes('and the boards card is still a steward\'s', /if \(o\.steward\) wrap\.appendChild\(officeBoards\(o\.boards\)\);/.test(ui));
  const lead = read('game/ui/thornswood-skills.js');
  yes('the page\'s lead names no container made a box', !/makes a container a hold/.test(lead));
}

// ---------------------------------------------------------- 4. the documents
{
  const cmds = read('docs/systems/commands.md');
  const rows = cmds.split('\n').filter(function (l) { return /^\| /.test(l); });
  const boxRow = rows.filter(function (l) { return /^\| [^|]*`\/box`/.test(l); });
  yes('the command list has no /box row', rows.length > 10 && boxRow.length === 0);
  yes('and the evict and rent row says /box is gone', rows.some(function (l) {
    return /^\| `\/evict`, `\/rent` \|/.test(l) && /`\/box`, which marked a container as a hold's box, is gone/.test(l);
  }));
  const said = [
    ['docs/systems/property.md', /make a container their own hold's box|marking a box|gold-only box|holds' boxes/],
    ['docs/systems/offices.md', /with the ten holds to make it that hold's box|names a hold's\s+box/],
    ['docs/systems/merchants-guild.md', /A marked chest also requires/],
    ['docs/GAMEMODE.md', /`putIn`/],
    ['docs/GAMEMODE-COVERAGE.md', /putIn/]
  ];
  said.forEach(function (s) {
    yes(s[0] + ' describes no marked chest', !s[1].test(read(s[0])));
  });
  const site = fs.readdirSync(path.join(ROOT, 'site', 'data', 'site')).filter(function (n) { return /\.md$/.test(n); });
  const sitePages = site.filter(function (n) {
    return /\/box\b|hold's box from the Office page|mark(?:s|ed)? (?:a|the) (?:container|chest)/i
      .test(read(path.join('site', 'data', 'site', n)));
  });
  yes('no public page describes a marked chest' + (sitePages.length ? ' (' + sitePages.join(', ') + ')' : ''),
      site.length > 0 && sitePages.length === 0);
}

// ------------------------------------------------ 5. the board's box stays
{
  yes('the drop box line is still answered', /word === '\/dropbox'\) \{ return dropboxCmd\(/.test(code));
  yes('E on the drop box still opens it', /dropboxCmd\(\['\/dropbox', 'open'\]/.test(code));
  yes('and the server still stands it beside its board', /var BOX_BASE_DESC = '154d0:Thornswood-Content\.esp';/.test(gm));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
