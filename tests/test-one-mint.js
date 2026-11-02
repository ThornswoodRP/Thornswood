// test-one-mint.js
//
// Authorized coin sources are explicit and bounded. A character gets forty
// once; dungeon rewards use fixed tier ranges and durable return reservations.
// Merchant NPC starting purses are checked by test-npc-merchant-purses.js and
// test-merchant-ledger-storage.js; receipt-based trading conservation is checked
// by test-merchant-trading.js and test-merchant-settlement.js.
//
// Entry 326 on the To Do List is the economy with a bottom: traders who start
// with a purse and buy and sell against it, "so coin moves between people
// rather than appearing". The traders wait on a design Patrick and Djinn have
// not settled. The bottom is already built. Patrick, 21 September, as the
// spoils block in gamemode.js records it: "all weapons, armour, tools, and
// gold are not spawned in the world at all", and "everyone starts with 40
// gold, and we can add a job for gold later but that's just to start." So
// today the one mint is purse() in the spoils block: forty gold, once per
// character, with the mark on the character.
//
// An economy with a floor is only as good as that staying true, and nothing
// checked it. The entry's own check was Select-String for 'f:Skyrim\.esm'.
// Measured on 24 September, that pattern matches 1,099 descriptors on 228
// lines, frost salts (3ad5f:Skyrim.esm) among them, and not one of them is
// gold, because gold is not written as a descriptor anywhere in the file. So
// this reads the file properly instead:
//
//   1. purse() hands over forty once, and still says no after a restart. The
//      entry names the trap: a purse held in a Map "resets to full on every
//      server update, which is a money printer on a schedule".
//   2. Every write into a pack is in a function on the list below, with the
//      reason it cannot make a coin. A new one fails here until somebody has
//      read it and put it on the list.
//   3. No descriptor in the file names Gold001, so addItem, the shift, the
//      deed, the key, the mold and the testers' /give can never hand gold
//      over, and every addItem caller takes its descriptor out of a table.
//   4. A trade moves coin and never makes it: the total is the same after.
//   5. No recipe in the load order makes gold, and the gamemode never asks
//      Papyrus to AddItem.
//
// WHAT THIS CANNOT SEE. A mod that hands out gold on somebody's own machine
// loses the gold, which known.md says for Tavern Games; that is the engine's
// business and not this file's. And a recipe added to the collection after
// game/data/recipes.json was last built is not in it until Build-RecipeTable.ps1
// runs again.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const RECIPES = process.env.RECIPES || path.join(REPO_DIR, 'game', 'data', 'recipes.json');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* A check that throws is a failed check, not a harness that stops halfway. */
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.message ? e.message : e), false); }
}

function lift(from, to) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(to, a);
  return b < 0 ? null : src.slice(a, b + to.length);
}

/* Gold001. The same number in every load order, which is why the spoils block
   writes it as a number rather than as a descriptor. */
const GOLD = 0x0000000F;

function goldIn(pack) {
  let n = 0;
  const entries = (pack && pack.entries) || [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i] && entries[i].baseId === GOLD) { n += entries[i].count; }
  }
  return n;
}

/*
  A fake mp over a plain store. mp.get hands back a COPY, the way the real
  server does: it converts the property into a fresh JavaScript value on every
  read. A rig that handed back the stored object would let a function change a
  pack without ever writing it, and pass tests the server would fail.
*/
function fakeMp(store, extra) {
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      const row = store[id];
      if (!row) { return undefined; }
      if (row.broken === key) { throw new Error('cannot read ' + key); }
      const v = row[key];
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    },
    set: function (id, key, v) {
      if (!store[id]) { store[id] = {}; }
      store[id][key] = JSON.parse(JSON.stringify(v));
    },
    lookupEspmRecordById: function () { return null; }
  };
  for (const k in (extra || {})) { mp[k] = extra[k]; }
  return mp;
}

// ------------------------------------------------------ reading the file
/*
  TWO COPIES OF THE FILE, EACH THE SAME LENGTH AS IT, so a position in one is
  the same position in the other and the same line.

    code  comments blanked and strings kept, because 'inventory' is a string.
    bare  comments, strings and regular expressions blanked, so every brace
          left is a brace in the code and a function's body can be matched
          from its first brace to its last.

  A reader that lost its place would put a function's end in the wrong place,
  and every answer below would be about the wrong function. So the first check
  is that what is left balances.
*/
function blankOut(s) {
  const n = s.length;
  const code = s.split('');
  const bare = s.split('');
  function wipe(arr, a, b) {
    for (let k = a; k < b && k < n; k++) { if (arr[k] !== '\n') { arr[k] = ' '; } }
  }
  const WORD = /[A-Za-z0-9_$]/;
  const BEFORE_REGEX = '(,=:[!&|?{};+-*%<>~^';
  const KEYWORD = /^(return|typeof|case|in|of|new|delete|void|throw|instanceof|do|else|yield|await)$/;
  let prev = '', word = '';
  let i = 0;
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') {
      let j = s.indexOf('\n', i);
      if (j < 0) { j = n; }
      wipe(code, i, j); wipe(bare, i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = s.indexOf('*/', i + 2);
      j = (j < 0) ? n : j + 2;
      wipe(code, i, j); wipe(bare, i, j);
      i = j;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && s[j] !== c) { j += (s[j] === '\\') ? 2 : 1; }
      wipe(bare, i + 1, j);
      i = j + 1; prev = c; word = '';
      continue;
    }
    if (c === '/' && (word ? KEYWORD.test(word)
                           : (prev === '' || BEFORE_REGEX.indexOf(prev) !== -1))) {
      let j = i + 1, inClass = false;
      while (j < n && s[j] !== '\n') {
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '[') { inClass = true; }
        else if (s[j] === ']') { inClass = false; }
        else if (s[j] === '/' && !inClass) { break; }
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(s[j])) { j++; }
      wipe(bare, i + 1, j);
      i = j; prev = '/'; word = '';
      continue;
    }
    if (c === ' ' || c === '\n' || c === '\t') { i++; continue; }
    if (WORD.test(c)) {
      let j = i;
      while (j < n && WORD.test(s[j])) { j++; }
      word = s.slice(i, j); prev = s[j - 1]; i = j;
      continue;
    }
    prev = c; word = ''; i++;
  }
  return { code: code.join(''), bare: bare.join('') };
}

const read = blankOut(src);
const code = read.code;
const bare = read.bare;
{
  const count = function (ch) { return bare.split(ch).length - 1; };
  yes('the reader kept its place: braces, brackets and parentheses balance',
      code.length === src.length && bare.length === src.length &&
      count('{') === count('}') && count('(') === count(')') &&
      count('[') === count(']'));
}

const lineStarts = [0];
for (let i = 0; i < src.length; i++) {
  if (src.charCodeAt(i) === 10) { lineStarts.push(i + 1); }
}
function lineOf(p) {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= p) { lo = mid; } else { hi = mid - 1; }
  }
  return lo + 1;
}

/* Every named function, from its first brace to its last. */
const fns = [];
{
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(bare)) !== null) {
    let k = m.index + m[0].length - 1, depth = 0;
    for (; k < bare.length; k++) {
      if (bare[k] === '(') { depth++; }
      else if (bare[k] === ')') { depth--; if (depth === 0) { break; } }
    }
    const open = bare.indexOf('{', k);
    let end = -1;
    depth = 0;
    for (let q = open; q >= 0 && q < bare.length; q++) {
      if (bare[q] === '{') { depth++; }
      else if (bare[q] === '}') { depth--; if (depth === 0) { end = q; break; } }
    }
    fns.push({ name: m[1], open: open, end: end });
  }
}

/* Every hand written block between its ==== markers, by its short name. */
const blocks = [];
{
  const re = /^\/\/ ==== thornswood ([a-z ]+?)(?:[:,][^\n]*)? ====$/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const endAt = src.indexOf('// ==== end thornswood ' + m[1] + ' ====', m.index);
    blocks.push({ name: m[1], start: m.index, end: endAt < 0 ? src.length : endAt });
  }
}

/* Where a position is: the block, then the innermost named function. */
function where(p) {
  let block = 'outer';
  for (const b of blocks) { if (p >= b.start && p < b.end) { block = b.name; } }
  let fn = null;
  for (const f of fns) {
    if (f.open <= p && p <= f.end && (!fn || f.open > fn.open)) { fn = f; }
  }
  return block + '/' + (fn ? fn.name : '(top)');
}

/* A function's body, out of code by default or out of bare when a check must
   not be fooled by a word inside a string. */
function bodyOf(key, text) {
  for (const f of fns) {
    if (f.end > f.open && where(f.open) === key) { return (text || code).slice(f.open, f.end + 1); }
  }
  return null;
}

// ------------------------------------------------------------ 1. the mint
/*
  purse(), driven out of the real spoils block over a fake mp.

  THE RESTART IS THE CHECK THAT MATTERS. A fresh copy of the block over the
  same store is what the server coming back up looks like, and a deploy of the
  gamemode is the same thing. A purse that remembered who had been paid in a
  Map would pay everybody again every time; the mark on the character is what
  stops it.
*/
const spoils = lift('// ==== thornswood spoils ====', '// ==== end thornswood spoils ====');
yes('the spoils block is in the gamemode', spoils !== null);

function spoilsOver(store) {
  try {
    const fn = new Function(
      'globalThis', 'mp', 'console', 'idOf', 'TOOLS', 'setTimeout',
      spoils + '\nreturn globalThis.__thornswoodSpoils;');
    const api = fn({}, fakeMp(store), { log: function () { } },
                   function () { return 0; }, {}, function () { });
    return (api && typeof api.purse === 'function') ? api : null;
  } catch (e) {
    return null;
  }
}

const packs = {};
const first = spoils !== null ? spoilsOver(packs) : null;
yes('and it hands out a purse', first !== null);
if (first !== null) {
  const A = 0xff000058, B = 0xff000059;
  packs[A] = { inventory: { entries: [] } };

  yes('the purse is forty, the number Patrick gave', first.PURSE === 40);
  yes('a character nobody has paid is handed it', first.purse(A) === true);
  yes('and it is forty gold, as Gold001', goldIn(packs[A].inventory) === 40);
  yes('a second time they are handed nothing',
      first.purse(A) === false && goldIn(packs[A].inventory) === 40);

  const afterRestart = spoilsOver(packs);
  yes('AFTER A RESTART they are still handed nothing, because the mark is on the character',
      afterRestart !== null && afterRestart.purse(A) === false &&
      goldIn(packs[A].inventory) === 40);

  packs[B] = { inventory: { entries: [] }, broken: first.PURSE_PROPERTY };
  yes('when the mark cannot be read, nothing is handed over',
      first.purse(B) === false && goldIn(packs[B].inventory) === 0);
}

// ---------------------------------------------- 2. every write into a pack
/*
  Every mp.set of 'inventory' in the file, by the function it is in, and the
  number of them there. Each is here with the reason it cannot make a coin.

  THIS LIST IS THE CHECK. Measured on 24 September: thirteen functions write a
  pack, fourteen writes between them. A function that is not on it fails until
  somebody has read it and added it with its reason, and one that has stopped
  writing a pack fails too, so that a new function which happens to take its
  name is read rather than waved through.
*/
const WRITERS = {
  'outer/addItem': [1, 'adds by descriptor, and section 3 says no descriptor in this file is gold'],
  'outer/addItemsAtomic': [1, 'adds verified fish, hanging-game and carcass descriptor bundles; the caller audit below pins those paths'],
  'outer/takeItem': [1, 'only takes things away'],
  'outer/takeItemById': [1, 'only takes things away'],
  'outer/giveShift': [1, 'the shift, out of CHARGEN.shift'],
  'outer/rieklingShift': [1, 'a new riekling\'s shift taken back and its own plain clothes, out of CHARGEN.rieklingShift, put in (#614): clothing descriptors, never gold'],
  'outer/giveItems': [1, 'descriptor pairs, and nothing calls it (checked below)'],
  'outer/packAsServerHasIt': [1, 'the take limit sends back the pack the server already holds, so it adds nothing'],
  'staff spells/(top)': [1, 'a refused spell tome sends back the pack the server already holds (#2261), so it adds nothing'],
  'property/giveDeed': [1, 'one deed, DEED'],
  'property/giveNamed': [1, 'one named key or mold, KEY or MOLD'],
  'property/takeBlankMold': [1, 'only takes a mold away'],
  'property/takeGold': [1, 'takes a notice, job or letter fee or a fare out and never puts any in (checked below)'],
  'property/payOut': [1, 'a letter\'s held 15 back out of the ledger it was counted on, to its courier or its sender; payHeld is its one caller and takes the same off that ledger (#1374, checked below)'],
  'spoils/purse': [1, 'THE MINT: forty gold, once per character'],
  'trade/moveById': [2, 'moves a pile from one pack to the other, one write each (section 4)'],
  'trade/saleById': [2, 'a company sale (#1393): the things out of the seller\'s pack and out of the world with the seller\'s share in, and the price less the worker\'s cut out of the worker\'s pack, which is never less than the share; one write each (section 4)'],
  'furniture/takeOne': [1, 'takes one furniture item off a pack to set its piece down; it never adds (#2679)'],
  'furniture/giveOne': [1, 'hands back one furniture item, a MISC out of game/data/furniture.json, for a piece picked up; never gold (#2679, test-2679-furniture.js)'],
  'durability/writePack': [1, 'writes back a pack or chest it has just read: a stack renamed for its condition, or a kit or a broken piece taken away. No base is added and no count grows (test-1384-condition.js)'],
  'spoilage/writeInventory': [1, 'writes back a pack or chest it has just read: food renamed for its days left or its salting or smoking, food that went off turned into as many Spoiled Food (19100:Thornswood-Content.esp, never gold) named for it, and the Salt Pile or Firewood a cook used. A preserved stack is split off the stack it came from, so no count grows (#3163, test-3163-spoilage.js)'],
  'farming/compost': [2, 'one Spoiled Food taken off the pack it has just read to work into a plot, and that same pack put back as it was when the plot will not take the write; it never adds (#3526, test-3526-compost.js)'],
  'hair dye/setPack': [1, 'writes back the pack it has just read: a hair dye\'s inputs taken and one entry named for the dye added to the list\'s item (a Bowl, never gold), or one dye taken away, or the pack it read put back when the hair would not take (#2675, test-2675-hair-dye-wiring.js)'],
  'property/boxLeave': [1, 'takes a stack off the pack into the drop box record, and refuses gold, which goes in through takeGold (#2298); it never adds'],
  'trade ships/packTake': [1, 'the dock\'s load (#2700) and a cart stop\'s (#3158, the same function through __thornswoodCargoHands): a stack off the pack onto a trade ship\'s or cart\'s manifest, coin refused before the pack is read; it only takes away (test-2700-trade-ship-dock.js, test-3158-trade-carts.js)'],
  'trade ships/packGive': [1, 'the dock\'s hand out (#2700) and a cart\'s collect, take back and raid (#3158, the same function through __thornswoodCargoHands): only a piece the manifest begin() hands back, or the piece a refused load just took, each first debited off a pack, so never coin (trade-cargo refuses base 0xF aboard) and never more than was loaded (test-2700-trade-ship-dock.js, test-3158-trade-carts.js)'],
  'market stalls/writePack': [1, 'the market stalls (#3160): packTake lays a stack out of the keeper\'s pack and refuses coin; packPay takes a price out of the buyer\'s pack; packGive puts in only what the stall book hands back, a piece laid out (the book refuses coin on a stall), or the very pieces packPay just took, to the keeper or back to the buyer when the sale cannot finish. No count grows (test-3160-market-stalls.js)'],
  'property/boxTake': [1, 'hands back a thing out of the drop box record, which holds only what boxLeave took off a pack; gold comes out through payOut, never more than the row holds, and the row goes down by the same (#2298, test-2298-dropbox.js)']
};

const writes = {};
{
  const re = /\bmp\.set\(\s*[^,()]+,\s*(['"])inventory\1/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const at = where(m.index);
    (writes[at] = writes[at] || []).push(lineOf(m.index));
  }
}
yes('the writes into a pack were found at all', Object.keys(writes).length >= 10);
for (const at of Object.keys(writes).sort()) {
  const lines = writes[at];
  const known = WRITERS[at];
  if (!known) {
    yes(at + ' writes a pack at line ' + lines.join(', ') + ' and is not on the list. Read it for ' +
        'whether it can put a coin in a pack, then add it to WRITERS with the reason', false);
  } else if (known[0] !== lines.length) {
    yes(at + ' writes a pack ' + lines.length + ' time(s), at line ' + lines.join(', ') +
        ', and the list says ' + known[0] + '. Read the new one', false);
  } else {
    yes(at + ' writes a pack: ' + known[1], true);
  }
}
for (const at of Object.keys(WRITERS)) {
  if (!writes[at]) {
    yes(at + ' is on the list and no longer writes a pack. Take it off', false);
  }
}

{
  // Every 'inventory' in the code is read or written through mp.get or
  // mp.set by name, so no pack is written under a name the list cannot see.
  const re = /(['"])inventory\1/g;
  const loose = [];
  let m;
  while ((m = re.exec(code)) !== null) {
    const before = code.slice(Math.max(0, m.index - 80), m.index);
    if (!/\bmp\.(get|set)\(\s*[^,()]+,\s*$/.test(before)) { loose.push(lineOf(m.index)); }
  }
  yes('every inventory in the code goes through mp.get or mp.set by name' +
      (loose.length ? ', and line ' + loose.join(', ') + ' does not' : ''), loose.length === 0);
}

{
  const calls=code.match(/\b\w+\.compareAndSetInventory\(/g) || [];
  yes('the merchant native inventory writer is the single audited profile-bound CAS',
    calls.length===1 && calls[0]==='mp.compareAndSetInventory(' &&
    /mp\.compareAndSetInventory\(id, expected, receipt, next, sequence, profile\)/.test(code));
  yes('merchant credit comes from durable finite stock or its debited purse, checked by the settlement and trading regressions',
    /nextPurse = npcBuys \? state\.purse - gold : state\.purse \+ gold/.test(code) &&
    /credit = gold > 0 \? \[\{baseId:GOLD_BASE,count:gold\}\] : \[\]/.test(code) &&
    /saved !== pending\.debitReceipt/.test(code) && /pending\.phase !== 'credit'/.test(code));
}

{
  // Of all the writers, only four name gold: the mint that hands it out,
  // the fee that takes it, the ledger paying a letter's held pay back out
  // (#1374), and a company sale (#1393), which puts the seller's share in
  // and takes more than that out of the worker's pack in the same step,
  // driven in section 4. A fifth one naming gold is a second mint until
  // somebody has read it.

  const namesGold = /\b(GOLD|GOLD_ID|goldId)\b|\b0x0*[fF]\b/;
  const naming = [];
  for (const at of Object.keys(WRITERS)) {
    const body = bodyOf(at, bare);
    if (body !== null && namesGold.test(body)) { naming.push(at); }
  }
  naming.sort();
  // The drop box (#2298) names gold only to send it the way it came: boxLeave
  // refuses it, and boxTake hands a gold row back through payOut.
  yes('of the writers, only purse, takeGold, payOut, a company sale and the drop box name gold' +
      (naming.length ? ' (' + naming.join(', ') + ')' : ''),
      naming.join(',') === 'property/boxLeave,property/boxTake,property/payOut,property/takeGold,spoils/purse,trade/saleById');
}

{
  // giveItems adds whatever pairs it is handed, with a sign. Nothing calls it
  // today; the day something does, what it is handed has to be read.
  const calls = (code.match(/\bgiveItems\(/g) || []).length;
  yes('nothing calls giveItems', calls === 1);
}

{
  const re = /\baddItemsAtomic\(/g;
  const callers = [];
  let match;
  while ((match = re.exec(code)) !== null) {
    if (/function\s+$/.test(code.slice(Math.max(0, match.index - 20), match.index))) { continue; }
    callers.push(where(match.index));
  }
  callers.sort();
  yes('atomic item bundles are only paid by the checked dungeon reward and three harvests',
      callers.join(',') === 'dungeon loot/give,outer/fish,outer/game,outer/loot');
  const reward=bodyOf('dungeon loot/give') || '';
  yes('the dungeon reward bundles its fixed gold and rolled goods into one inventory write',
      /if\(rolled\.gold>0\) goods\.push\(\{item:GOLD_DESC,count:rolled\.gold\}\)/.test(reward) &&
      /addItemsAtomic\(actorId,goods\)/.test(reward) &&
      /var GOLD_SPAN = \{ 1: \[5, 15\], 2: \[12, 35\], 3: \[25, 70\], 4: \[50, 120\] \};/.test(code));
}

{
  /*
    takeGold only ever takes. Driven out of the property block: it takes the
    fee from a pack that has it, refuses one that does not, and in neither
    case is there more gold afterwards than before.

    It does not refuse a negative amount, and a negative amount would add.
    Nothing hands it one: the board passes a fee that is one of two positive
    constants, a letter passes its fee and pay, and a ride (#1394) passes its
    fare, which is one of three and is refused at 0 or less before takeGold is
    reached. All are checked here rather than trusted.
  */
  const take = lift('  function takeGold(actorId, amount) {', '\n  }\n');
  yes('the fee taker is in the gamemode', take !== null);
  if (take !== null) {
    attempt('driving takeGold', function () {
      const A = 0xff000058;
      const store = {};
      store[A] = { inventory: { entries: [{ baseId: GOLD, count: 50 }] } };
      const takeGold = new Function('mp', 'GOLD_ID', take + '\nreturn takeGold;')(fakeMp(store), GOLD);
      yes('a fee comes out of a pack that has it',
          takeGold(A, 20) === true && goldIn(store[A].inventory) === 30);
      yes('the last of it clears the pack of gold',
          takeGold(A, 30) === true && goldIn(store[A].inventory) === 0 &&
          store[A].inventory.entries.length === 0);
      store[A].inventory.entries.push({ baseId: GOLD, count: 10 });
      yes('a fee a pack cannot pay takes nothing',
          takeGold(A, 20) === false && goldIn(store[A].inventory) === 10);
    });
  }
  const callers = [];
  const re = /\btakeGold\(\s*[^,()]+,\s*([^()]+?)\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (code.slice(Math.max(0, m.index - 9), m.index) === 'function ') { continue; }
    callers.push(m[1].trim());
  }
  const notice = /\bvar NOTICE_FEE = (\d+);/.exec(code);
  const job = /\bvar JOB_FEE = (\d+);/.exec(code);
  const letterFee = /\bvar LETTER_FEE = (\d+);/.exec(code);
  const letterPay = /\bvar LETTER_PAY = (\d+);/.exec(code);
  /*
    A HAUL (#1393). Posting a haul takes the company's haul fee (its terms,
    #512, #2695, apart from JOB_FEE) and the pay, a whole number
    above nothing, onto the ledger. It takes; it puts none in. A company
    sale is the trade block's saleById, section 4. A night in a bed was a
    caller too (#1392) until #1603: a night is paid in a trade now, and the
    server takes no price for one.
  */
  // And gold put in the drop box (#2298): n, a whole number above nothing, or refused first.
  // A post's cost (#2554) is its fee, NOTICE_FEE or JOB_FEE, and a job's reward, a whole number above nothing.
  yes('its five callers pass a post\'s cost, NOTICE_FEE, or JOB_FEE and the reward, a letter\'s cost, LETTER_FEE and ' +
      'LETTER_PAY, a haul\'s cost, the company\'s haul fee and the pay, a ride\'s fare, and gold put in the drop box',
      callers.slice().sort().join(',') === 'cost,cost,cost,n,price' &&
      /var n = Math\.floor\(Number\(amount\)\);\s*\n\s*if \(!\(n > 0\)/.test(code) &&
      /\bvar fee = isJob \? JOB_FEE : NOTICE_FEE;\s*\n\s*var cost = fee \+ reward;/.test(code) &&
      /reward = \/\^\\d\+\$\/\.test\(first\) \? Number\(first\) : 0;\s*\n\s*if \(!\(reward > 0\)/.test(code) &&
      /\bvar cost = LETTER_FEE \+ LETTER_PAY;/.test(code) &&
      /\bvar fee = co\.haulFee\(\);\s*\n\s*var cost = fee \+ pay;/.test(code));
  const fares = ['FARE_FERRY', 'FARE_CARRIAGE_IN_HOLD', 'FARE_CARRIAGE', 'FARE_CROSSING'].map(function (n) {
    const m = new RegExp('\\bvar ' + n + ' = (\\d+);').exec(code);
    return m ? Number(m[1]) : 0;
  });
  yes('the fare is fare(), refused at 0 or less, and all four fares are more than nothing',
      /\bvar price = fare\(from, to\);\s*\n(\s*\/\/[^\n]*\n)*\s*if \(!\(price > 0\)\) \{ return /.test(code) &&
      fares.every(function (n) { return n > 0; }));
  yes('and every one of those is more than nothing',
      !!notice && !!job && Number(notice[1]) > 0 && Number(job[1]) > 0 &&
      !!letterFee && !!letterPay && Number(letterFee[1]) > 0 && Number(letterPay[1]) > 0);
  /*
    A NIGHT IN A BED moves no gold since #1603: it is paid in a trade between
    two people, and the server keeps no price. What #1392's book kept for a
    holder who was away is only ever handed out, once, through payOut, and
    nothing adds to it: the book reads it back as whole gold above nothing,
    and no line in the gamemode writes a sum into it.
  */
  const load = lift('  function loadBedBook() {', '\n  }\n');
  const kept = lift('  function payTakings(online) {', '\n  }\n');
  yes('nothing takes a price for a night any more',
      code.indexOf('function payNight(') === -1 && code.indexOf('function bedCmd(') === -1);
  yes('the kept takings are read back as whole gold above nothing',
      load !== null && /if \(\(Number\(tp\) \|\| 0\) > 0 && gold > 0 && Math\.floor\(gold\) === gold\) \{/.test(load));
  yes('and they never grow: nothing writes a sum into them',
      (code.match(/bedBook\.takings\[[^\]]+\] = /g) || []).length === 0 &&
      kept !== null && /delete bedBook\.takings\[pid\];/.test(kept));
  yes('and what was kept is handed over through payOut, then taken off the book',
      kept !== null && /payOut\(online\[i\], gold\)/.test(kept) &&
      kept.indexOf('payOut(online[i], gold)') < kept.indexOf('delete bedBook.takings[pid];'));
}

{
  /*
    payOut puts gold in a pack, so it is read the way takeGold is (#1374).
    Its one caller is payHeld, which pays a letter's own held pay, never more
    than that hold's ledger holds, takes the same count off the ledger, and
    zeroes the pay so it is paid once. Driven here: packs plus ledger add up
    to the same after a payout, and a ledger short of the pay pays nothing.
  */
  const calls = [];
  const re = /\bpayOut\(/g;
  let m2;
  while ((m2 = re.exec(code)) !== null) {
    if (code.slice(Math.max(0, m2.index - 9), m2.index) === 'function ') { continue; }
    calls.push(where(m2.index));
  }
  /*
    And the company (#1393). handHaul pays a haul's held gold, the hauler's
    pay less the tenth or the poster's pay back, and haulTick what a haul
    held for somebody who was away, each taking the same off the ledger
    through withdraw, which never takes more than that haul holds. postHaul
    gives back the cost it has just taken when the ledger would not take it
    (test-1393-company.js).
  */
  // And the drop box (#2298): boxTake hands back gold a row holds, gold a
  // pack or a fare put in, and takes the row down by the same.
  yes('payOut\'s callers are payHeld, the takings #1392 kept for a holder, handed over once (#1603), the haul (#1393) and the drop box (#2298)',
      calls.slice().sort().join(',') ===
      'property/boxTake,property/handHaul,property/haulTick,property/payHeld,property/payTakings,property/postHaul');

  /*
    THE LEDGER GOES DOWN ONLY BY A PAYOUT (#1393). Coin comes off a ledger
    in two places: payHeld, for a letter's 15, and withdraw. withdraw's
    callers are handHaul and haulTick, and each hands the same count into a
    pack, first, in the same function. So a ledger never goes down without
    the same gold appearing in a pack, and packs plus ledgers add up after.
  */
  const down = [];
  const reDown = /\bfunds\[[^\]]+\] = \(Number\(funds\[[^\]]+\]\) \|\| 0\) - /g;
  let m3;
  while ((m3 = reDown.exec(code)) !== null) { down.push(where(m3.index)); }
  yes('a ledger is counted down in payHeld and withdraw, and nowhere else',
      down.slice().sort().join(',') === 'property/payHeld,property/withdraw');
  const wd = [];
  const reWd = /\bwithdraw\(/g;
  while ((m3 = reWd.exec(code)) !== null) {
    if (code.slice(Math.max(0, m3.index - 9), m3.index) === 'function ') { continue; }
    wd.push(where(m3.index));
  }
  const hand = bodyOf('property/handHaul');
  const tick = bodyOf('property/haulTick');
  yes('withdraw\'s callers are handHaul and haulTick, and each puts the same count in a pack before it',
      wd.slice().sort().join(',') === 'property/handHaul,property/haulTick' &&
      !!hand && hand.indexOf('payOut(to, amount)') > 0 && hand.indexOf('payOut(to, amount)') < hand.indexOf('withdraw(hold, amount,') &&
      !!tick && tick.indexOf('payOut(to, owed)') > 0 && tick.indexOf('payOut(to, owed)') < tick.indexOf('withdraw(hold, owed,'));
  const drive = ['noticeHolds', 'heldOn', 'mayWithdraw', 'withdraw', 'handHaul'].map(function (n) {
    return lift('  function ' + n + '(', '\n  }\n');
  });
  const holds = lift('  var LEDGER_HOLDS = [', ';\n');
  yes('the ledger\'s withdrawal and the haul\'s hand over are in the gamemode', drive.every(Boolean) && !!holds);
  if (drive.every(Boolean) && holds) {
    attempt('driving a haul\'s payout', function () {
      const A = 0xff000058;
      const store = {};
      store[A] = { inventory: { entries: [{ baseId: GOLD, count: 5 }] }, profileId: 7 };
      const funds = { riften: 110 };
      const notices = { riften: [
        { haul: true, job: true, pay: 80, dest: 'whiterun', taken: 7 },
        { letter: true, job: true, pay: 15 }
      ] };
      funds.riften += 15;
      const api = new Function('mp', 'GOLD_ID', 'funds', 'notices', 'plog', 'save', 'onlineActorOf',
        holds + '\n' + lift('  function payOut(actorId, amount) {', '\n  }\n') + '\n' + drive.join('\n') + '\nreturn { handHaul: handHaul, withdraw: withdraw };')(
        fakeMp(store), GOLD, funds, notices, function () { }, function () { },
        function (pid) { return pid === 7 ? A : 0; });
      const before = goldIn(store[A].inventory) + funds.riften;
      const r = api.handHaul('riften', notices.riften[0], 7, 72, 'test', 'hauled');
      yes('a haul\'s 72 goes from the ledger to the pack, and packs plus the ledger add up the same',
          !r.why && !r.owed && goldIn(store[A].inventory) === 77 && funds.riften === 53 &&
          goldIn(store[A].inventory) + funds.riften === before && notices.riften[0].pay === 0);
      yes('what is left is the fee, the tenth and the letter\'s held 15, and the 15 cannot be withdrawn',
          api.withdraw('riften', 39, 'x') === false && api.withdraw('riften', 38, 'x') === true && funds.riften === 15);
      const away = { haul: true, job: true, pay: 40, dest: 'whiterun', taken: 9 };
      notices.riften.push(away);
      funds.riften += 40;
      const r2 = api.handHaul('riften', away, 9, 40, 'test', 'back');
      yes('to somebody away nothing leaves the ledger, and it stays held as owed',
          !r2.why && r2.owed === true && funds.riften === 55 && away.owed === 40 && away.pay === 0 &&
          api.withdraw('riften', 1, 'x') === false);
    });
  }
  const pay = lift('  function payOut(actorId, amount) {', '\n  }\n');
  const held = lift('  function payHeld(hold, n, actorId) {', '\n  }\n');
  yes('the payout and the held pay are in the gamemode', pay !== null && held !== null);
  if (pay !== null && held !== null) {
    attempt('driving payHeld', function () {
      const A = 0xff000058;
      const store = {};
      store[A] = { inventory: { entries: [{ baseId: GOLD, count: 5 }] } };
      const ledger = { riften: 35 };
      const api = new Function('mp', 'GOLD_ID', 'funds', 'plog',
        pay + '\n' + held + '\nreturn { payHeld: payHeld, payOut: payOut };')(
        fakeMp(store), GOLD, ledger, function () { });
      const api2 = api.payHeld;
      const letter = { letter: true, job: true, pay: 15 };
      const before = goldIn(store[A].inventory) + ledger.riften;
      yes('a letter\'s 15 goes from the ledger to the pack, and the total is the same',
          api2('riften', letter, A) === 15 && goldIn(store[A].inventory) === 20 &&
          ledger.riften === 20 && goldIn(store[A].inventory) + ledger.riften === before);
      yes('and it is paid once', api2('riften', letter, A) === 0 && goldIn(store[A].inventory) === 20);
      const short = { riften: 10 };
      const api3 = new Function('mp', 'GOLD_ID', 'funds', 'plog',
        pay + '\n' + held + '\nreturn payHeld;')(fakeMp(store), GOLD, short, function () { });
      yes('a ledger short of the pay pays nothing',
          api3('riften', { letter: true, job: true, pay: 15 }, A) === -1 &&
          goldIn(store[A].inventory) === 20 && short.riften === 10);
      yes('a notice holds nothing to pay', api2('riften', { pay: 15 }, A) === 0 &&
          goldIn(store[A].inventory) === 20);
      // A job's reward (#2554) is held the same way and comes back the same way; a haul's is handHaul's.
      yes('a haul\'s pay is not payHeld\'s to pay', api2('riften', { haul: true, job: true, pay: 15 }, A) === 0 &&
          goldIn(store[A].inventory) === 20 && ledger.riften === 20);
      const job = { job: true, title: 'Clear the cellar', pay: 12 };
      yes('a job\'s 12 reward goes from the ledger to the pack, once, and the total is the same',
          api2('riften', job, A) === 12 && goldIn(store[A].inventory) === 32 && ledger.riften === 8 &&
          api2('riften', job, A) === 0 && goldIn(store[A].inventory) === 32);
      yes('payOut refuses a count that is not more than nothing',
          api.payOut(A, 0) === false && api.payOut(A, -5) === false && goldIn(store[A].inventory) === 32);
    });
  }
}

// ------------------------------------- 3. no descriptor in the file is gold
/*
  addItem, giveShift, giveDeed and giveNamed take a descriptor and hand over
  that form. Every descriptor they are ever given is a string in this file:
  the ore, plant, crop, fish, game and hunt tables, the recipe outputs, ITEMS,
  CHARGEN, TOOLS, and the deed, key and mold. So if no string in the file
  names Gold001, none of them can hand gold over.

  PARSED, NOT MATCHED. A descriptor is a hex number, a colon and a plugin.
  Gold is the number fifteen in Skyrim.esm however it is written: f, F, 0f,
  0000000F. Frost salts are 3ad5f and are not gold, which is the difference
  between this and the entry's Select-String.
*/
function goldDescriptors(text) {
  const re = /(["'])([0-9a-f]{1,8}):([^"'\n]+?\.es[mpl])\1/gi;
  const out = { seen: 0, all: new Set(), gold: [] };
  let m;
  while ((m = re.exec(text)) !== null) {
    out.seen++;
    out.all.add(m[2] + ':' + m[3]);
    if (parseInt(m[2], 16) === GOLD && m[3].toLowerCase() === 'skyrim.esm') { out.gold.push(m[0]); }
  }
  return out;
}

{
  const planted = goldDescriptors('a = "f:Skyrim.esm"; b = \'0000000F:skyrim.esm\'; c = "3ad5f:Skyrim.esm";');
  yes('the reader finds gold however it is written, and does not take frost salts for it',
      planted.seen === 3 && planted.gold.length === 2);

  /*
    EXCEPT THE TESTERS' TWO TABLES. Patrick, 27 September: "/give is an
    admin/tester command I should be able /give any item I like". So
    ITEM_NAMES and ADMIN_NAMES, which only /give and /spawn read, name gold
    like any other item. That is a tester's tool behind the playtester gate,
    not a mint anybody playing can reach, and the checks after this one hold
    both halves of that: nothing else reads those tables, and /give stays
    behind the gate. Everything outside them still names no gold.
  */
  function cut(text, start, end) {
    const a = text.indexOf(start);
    const b = a < 0 ? -1 : text.indexOf(end, a);
    return a < 0 || b < 0 ? null : text.slice(0, a) + text.slice(b + end.length);
  }
  const noItems = cut(src, '  var ITEM_NAMES = ', ';\n');
  const noAdminItems = noItems && cut(noItems, '  var ADMIN_ITEMS = ', ';\n');
  const noAdmin = noAdminItems && cut(noAdminItems, '  var ADMIN_ACTORS = ', ';\n');
  const noDungeon = noAdmin && cut(noAdmin,'// ==== thornswood dungeon loot ====','// ==== end thornswood dungeon loot ====');
  /*
    AND THE RECIPES SET IN EACH GAME (#613, #3115). RECIPES_SET_IN_GAME names
    gold only as a recipe input it takes to 0: Patrick, q-3115 B, a forge
    recipe costs no coins. A count of 0 takes nothing and mints nothing, and
    the check below holds that every gold row there asks 0.
  */
  const setInGame = lift('var RECIPES_SET_IN_GAME = ', ';\n') || '';
  const setRows = (/var RECIPES_SET_IN_GAME = (\{.*\});/.exec(setInGame) || [])[1];
  let setTable = null;
  try { setTable = JSON.parse(setRows); } catch (e) { setTable = null; }
  yes('a recipe set in each game names gold only to take it to 0',
      !!setTable && Object.keys(setTable).every(function (k) {
        return setTable[k].inputs.every(function (i) { return goldDescriptors('"' + i[0] + '"').gold.length === 0 || i[2] === 0; });
      }));
  /*
    AND THE RECIPES MOVED IN EACH GAME (#3120). RECIPES_MOVED_IN_GAME names a
    moved recipe's inputs as its mod's record asks them, so the eyepatch moved
    to the loom names its one gold coin there. Its counts are also set in each
    game, where that coin goes to 0, and recipeMovedInGame leaves a recipe set
    in game to recipeSetInGame. So gold may stand in that block only as an
    input of a recipe RECIPES_SET_IN_GAME takes it to 0 in.
  */
  const movedInGame = lift('var RECIPES_MOVED_IN_GAME = ', ';\n') || '';
  const movedRows = (/var RECIPES_MOVED_IN_GAME = (\{.*\});/.exec(movedInGame) || [])[1];
  let movedTable = null;
  try { movedTable = JSON.parse(movedRows); } catch (e) { movedTable = null; }
  yes('a recipe moved in each game names gold only where the recipes set in each game take it to 0',
      !!movedTable && !!setTable && Object.keys(movedTable).every(function (k) {
        return movedTable[k].inputs.every(function (i) {
          if (goldDescriptors('"' + i[0] + '"').gold.length === 0) { return true; }
          return !!setTable[k] && setTable[k].inputs.some(function (s) { return s[0] === i[0] && s[1] === i[1] && s[2] === 0; });
        });
      }));
  const noSet = noDungeon && cut(noDungeon, 'var RECIPES_SET_IN_GAME = ', ';\n');
  const outside = noSet && cut(noSet, 'var RECIPES_MOVED_IN_GAME = ', ';\n');
  const dungeon=lift('// ==== thornswood dungeon loot ====','// ==== end thornswood dungeon loot ====');
  const dungeonGold=goldDescriptors(dungeon || '');
  yes('the checked dungeon reward names exactly one gold descriptor as GOLD_DESC',
      dungeonGold.gold.length===1 && /var GOLD_DESC = 'f:Skyrim.esm';/.test(dungeon || ''));
  const sceneQuest = lift('// ==== thornswood custom quests ====','// ==== end thornswood custom quests ====');
  const sceneGold = goldDescriptors(sceneQuest || '');
  yes('scene finish gold is the named GOLD_DESC row, and those lines stay in the scan',
      !!sceneQuest && sceneGold.gold.length === 0 &&
      (sceneQuest.match(/\{item: GOLD_DESC, count: row\.gold\}/g) || []).length === 2 &&
      !/addItem\(actor, GOLD_DESC/.test(sceneQuest) &&
      /if \(!keep\(actor, b, changes\)\)/.test(sceneQuest) &&
      /var GOLD_DESC = deps\.goldDesc;/.test(sceneQuest));
  yes('the testers\' two tables were found and set aside', !!outside);
  const inside = goldDescriptors(src);
  yes('and they do name gold, so /give gold works for a tester', inside.gold.length > 0);
  const real = goldDescriptors(outside || src);
  yes('it read ' + real.seen + ' descriptors out of the gamemode', real.seen > 10000);
  yes('including the tables that hand things over: the wolf pelt a body gives, corundum ore, ' +
      'a salt pile, the shift and an armour recipe\'s output',
      real.all.has('3ad74:Skyrim.esm') && real.all.has('5acdb:Skyrim.esm') &&
      real.all.has('34cdf:Skyrim.esm') && real.all.has('1be1a:Skyrim.esm') &&
      real.all.has('d62:Hothtrooper44_ArmorCompilation.esp'));
  yes('and outside the testers\' tables and checked dungeon reward not one of them is gold' +
      (real.gold.length ? ': ' + real.gold.slice(0, 5).join(', ') : ''),
      real.gold.length === 0);
  if (outside) {
    const outCode = blankOut(outside).code;
    const refs = function (name) { return (outCode.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length; };
    const build = bodyOf('chat commands/buildThings') || '';
    const beasts = bodyOf('chat commands/buildBeasts') || '';
    /*
      And the drop box's names (#2298): itemName reads the two tables for the
      name the box's panel and records show, by the record a row already
      holds. It turns a record into a name, never a name into a thing, and
      writes nothing.
    */
    const names = bodyOf('property/itemName') || '';
    /*
      And the hold economy's names (#3164): recordNames reads the two tables
      to name a counted record on staff's page, the same one way round as the
      drop box, and hands nothing out. And a market stall's Find (#3160): the
      names a goods price can ask for, so the buyer pays with something out of
      their own pack. It hands back names and records, coin left out, never a
      thing, and writes nothing.
    */
    const counted = bodyOf('hold economy/recordNames') || '';
    const stallFind = bodyOf('market stalls/find') || '';
    const inNames = function (name) {
      const re = new RegExp('\\b' + name + '\\b', 'g');
      return (names.match(re) || []).length + (counted.match(re) || []).length +
        (stallFind.match(re) || []).length;
    };
    yes('ITEM_NAMES and ADMIN_ITEMS are read by the /give index, and by the drop box, the hold economy and a stall\'s Find only for a name',
        refs('ITEM_NAMES') === (build.match(/\bITEM_NAMES\b/g) || []).length + inNames('ITEM_NAMES') &&
        refs('ADMIN_ITEMS') === (build.match(/\bADMIN_ITEMS\b/g) || []).length + inNames('ADMIN_ITEMS') &&
        refs('ADMIN_ITEMS') > 0 && !!names && !!counted && !!stallFind &&
        !/\bmp\.set\(|\baddItem\(|\bpayOut\(/.test(names) && !/\bmp\.set\(|\baddItem\(|\bpayOut\(/.test(counted) &&
        !/\bmp\.set\(|\baddItem\(|\bpayOut\(|\bpackGive\(|\bwritePack\(/.test(stallFind) && /BOOK\.isCoin\(base\)/.test(stallFind));
    yes('ADMIN_ACTORS is read by the /spawn index and nothing else',
        refs('ADMIN_ACTORS') > 0 && refs('ADMIN_ACTORS') === (beasts.match(/\bADMIN_ACTORS\b/g) || []).length);
    yes('and /give and /spawn still refuse anybody who is not a playtester',
        /if \(word === '\/give' \|\| word === '\/spawn'\) \{\s*if \(!isPlaytester\(profileId\)\) \{/.test(src));
  }
}

{
  /*
    Every addItem caller, by what it hands over. Each is a row out of a table
    or a constant in this file, which section 3 has already read. A caller
    handing over something worked out at runtime, a form id turned back into
    a descriptor for instance, could name anything, gold included, so a new
    one fails here until somebody has read where its descriptor comes from.
  */
  const ADD_FROM = {
    'tool.give': 'a starting tool, TOOLS',
    'ITEMS.saltPile': 'a salt pile, ITEMS',
    'ITEMS.fishTrap': 'a fish trap refund, ITEMS',
    'rare': 'fire, frost or void salts, ITEMS',
    'seam.ore': 'ore, ORES_BY_BASE',
    'extra.ore': 'the chance of one more ore off a swing, a row of ORES_BY_BASE (#1380)',
    'ITEMS.firewood': 'firewood, ITEMS',
    'ITEMS[grade]': 'charcoal, ITEMS',
    'ITEMS.butter': 'butter off the churn, ITEMS',
    'ITEMS.milk': 'milk off a living cow, ITEMS (#396)',
    'ITEMS.chickenEgg': 'an egg off a chicken nest, ITEMS (#628)',
    'ITEMS.honeycomb': 'honeycomb off a placed hive, ITEMS (#1377)',
    'plant.produce': 'a plant, HARVESTS_BY_BASE',
    'caught.produce': 'a fish, FISH_BY_BASE',
    'hung.produce': 'game, GAME_BY_BASE',
    'g.item': 'what a body gives, HUNTS_BY_BASE',
    'crop.produce': 'a crop, CROPS',
    'CROPS[d].produce': 'starting seeds, CROPS',
    'hit.desc': 'the testers\' /give, out of the index built from these same tables',
    'GOLD_DESC': 'scene finish gold, the same named GOLD_DESC row the checked dungeon reward uses',
    'open.itemDesc': 'puts back the retrieval good the place row already handed over; not a coin',
    'place.item': 'the unbound scene container good on the place row; not a coin',
    'row.out': 'Grand Chef\'s second batch, the output of a Cook row of RECIPES_BY_ID (#1398), and section 5 says no recipe makes gold',
    'KEY_INGOT': 'puts back the iron ingot a key at a forge took a line before, when the key could not be handed over (#1637); an iron ingot, not a coin',
    'NEEDS.waterItems.full': 'a bottle of water for the empty bottle a well took a line before, a constant of the needs block (#1382); Glacier Water, not a coin',
    'NEEDS.waterItems.empty': 'puts back the empty bottle a well took, when the water could not be handed over (#1382); not a coin',
    'CUFFS_DESC': 'one pair of Prisoner\'s Cuffs (10e039:Skyrim.esm, clothing), a constant of the cuffs block (#2573): issued to a guard with none at most once a day, or moved from guard to prisoner and back, never gold'
  };
  const re = /\baddItem\(\s*[^,()]+,\s*([^,]+?),/g;
  const unknown = [];
  let calls = 0;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (code.slice(Math.max(0, m.index - 9), m.index) === 'function ') { continue; }
    calls++;
    const arg = m[1].trim();
    if (!Object.prototype.hasOwnProperty.call(ADD_FROM, arg)) {
      unknown.push(arg + ' at line ' + lineOf(m.index));
    }
  }
  yes('every one of the ' + calls + ' addItem calls hands over a row of a table in this file' +
      (unknown.length ? ', and these do not: ' + unknown.join('; ') : ''),
      calls > 10 && unknown.length === 0);

  // The testers' /give can only hand over what its index holds, and the index
  // is built out of this file's own tables and nothing the engine is asked.
  // Patrick decided on 27 September that /give reaches every item, gold
  // included; section 3 says where that is allowed and holds the gate.
  const build = bodyOf('chat commands/buildThings');
  yes('the /give index is built out of this file\'s tables and never asks the engine for a form',
      build !== null && /ORES_BY_BASE/.test(build) && /RECIPES_BY_ID/.test(build) &&
      !/\bmp\./.test(build));
}

// --------------------------------------------- 4. a trade moves, never makes
/*
  Driven out of the real trade block over a fake mp. The total gold across
  the two packs is the same after a trade as before it, whichever way the
  coin goes, and a trade that can no longer be paid moves nothing.

  A TRADE WITH YOURSELF. moveById reads both packs before it writes either,
  so a pile moved from somebody to themselves is written back with the pile
  added and nothing taken away. Measured on 24 September: moveById(A, A) with
  forty gold turned a pack of 100 into 140, and begin(A, A) opens a trade.
  Two things stop that ever reaching a pack, and both are checked here: the
  command refuses to offer a trade to yourself ("That is you."), and a trade
  whose two sides are the same person can never have both sides agreed,
  because the second agreement lands on the first side.
*/
const tradeBlock = lift('// ==== thornswood trade ====', '// ==== end thornswood trade ====');
yes('the trade block is in the gamemode', tradeBlock !== null);

function tradeWorld() {
  const store = {};
  const g = {};
  const mp = fakeMp(store, {
    lookupEspmRecordById: function (baseId) {
      const name = baseId === GOLD ? 'Gold' : 'Leek';
      return { record: { type: 'MISC', editorId: name, fields: [{ type: 'FULL', data: name }] } };
    }
  });
  new Function(
    'globalThis', 'mp', 'console', 'setInterval', 'clearInterval', 'guard', 'say', 'notify',
    require('./fixtures/ordinary-quest-items') + tradeBlock)(
    g, mp, { log: function () { } }, function () { return 1; }, function () { },
    function (n, f) { return f; }, function () { }, function () { });
  return {
    trade: g.__thornswoodTrade,
    store: store,
    person: function (id, pack) {
      store[id] = { worldOrCellDesc: 'town:X.esm', pos: [0, 0, 0], inventory: { entries: pack } };
      return id;
    },
    gold: function (id) { return goldIn(store[id].inventory); }
  };
}

const LEEK = 0x901;
if (tradeBlock !== null) {
  attempt('a trade both ways', function () {
    const w = tradeWorld();
    const A = w.person(0xff000001, [{ baseId: GOLD, count: 100 }]);
    const B = w.person(0xff000002, [{ baseId: GOLD, count: 5 }, { baseId: LEEK, count: 3 }]);
    w.trade.begin(A, B);
    w.trade.gold(A, 40);
    w.trade.gold(B, 5);
    w.trade.add(B, 'Leek', 3);
    w.trade.confirm(A);
    w.trade.confirm(B);
    yes('coin going both ways in one trade lands where it was sent',
        w.gold(A) === 65 && w.gold(B) === 40);
    yes('and there is exactly as much gold after the trade as before it',
        w.gold(A) + w.gold(B) === 105);
  });
  attempt('a trade that can no longer be paid', function () {
    const w = tradeWorld();
    const A = w.person(0xff000001, [{ baseId: GOLD, count: 100 }]);
    const B = w.person(0xff000002, [{ baseId: LEEK, count: 1 }]);
    w.trade.begin(A, B);
    w.trade.gold(A, 40);
    w.trade.add(B, 'Leek', 1);
    w.trade.confirm(A);
    w.store[A].inventory = { entries: [{ baseId: GOLD, count: 10 }] };   // spent it meanwhile
    w.trade.confirm(B);
    yes('coin that is gone by the time both agree moves nothing at all',
        w.gold(A) === 10 && w.gold(B) === 0);
  });
  attempt('moving a pile', function () {
    const w = tradeWorld();
    const A = w.person(0xff000001, [{ baseId: GOLD, count: 30 }, { baseId: GOLD, count: 30 }]);
    const B = w.person(0xff000002, []);
    yes('a pile taken across two stacks arrives whole and the total holds',
        w.trade.moveById(A, B, [[GOLD, 50]]) === true &&
        w.gold(A) === 10 && w.gold(B) === 50);
    yes('and a pile bigger than the pack is refused with nothing written',
        w.trade.moveById(A, B, [[GOLD, 500]]) === false &&
        w.gold(A) === 10 && w.gold(B) === 50);
  });
  /*
    A SALE OUT OF SKYRIM (#1393). saleById is the trade block's other
    writer: the seller's share in, the price less the worker's cut out. The
    worker's pack loses more than the seller's gains, by the 10% that leaves
    the server, so the total goes down and never up.
  */
  attempt('a company sale', function () {
    const w = tradeWorld();
    const A = w.person(0xff000001, [{ baseId: GOLD, count: 100 }]);
    const B = w.person(0xff000002, [{ baseId: LEEK, count: 2 }]);
    yes('a sale of 50: 40 to the seller, the worker pays 45, 5 leaves, the leek is gone, and nothing is made',
        w.trade.saleById(B, A, [{ id: LEEK, c: 1, n: 'Leek' }], 40, 45) === true &&
        w.gold(B) === 40 && w.gold(A) === 55 && w.gold(A) + w.gold(B) === 95 &&
        w.store[B].inventory.entries.some(function (e) { return e.baseId === LEEK && e.count === 1; }));
    yes('a share bigger than what the worker pays is refused with nothing written',
        w.trade.saleById(B, A, [{ id: LEEK, c: 1, n: 'Leek' }], 30, 20) === false && w.gold(B) === 40 && w.gold(A) === 55);
    yes('and a price bigger than the worker\'s pack is refused with nothing written',
        w.trade.saleById(B, A, [{ id: LEEK, c: 1, n: 'Leek' }], 400, 500) === false && w.gold(B) === 40 && w.gold(A) === 55);
  });
  attempt('a trade with yourself', function () {
    const w = tradeWorld();
    const A = w.person(0xff000001, [{ baseId: GOLD, count: 100 }]);
    // Refusing it outright would be better still, and passes too. What may
    // never happen is that it opens and then swaps, which closes it.
    const opened = w.trade.begin(A, A) === '';
    if (opened) {
      w.trade.gold(A, 40);
      w.trade.confirm(A);
      w.trade.confirm(A);
    }
    yes('a trade with yourself can never have both sides agreed, so nothing moves',
        w.gold(A) === 100 && (!opened || !!w.trade.tradeOf(A)));
  });
}
{
  const guard = code.indexOf('if (them === actorId) { toProfile(profileId, \'That is you.\'); return true; }');
  const offer = code.indexOf('var refused = soc.offer(kind, actorId, them);');
  yes('and nobody can offer a trade to themselves in the first place',
      guard !== -1 && offer !== -1 && guard < offer);
}

// ---------------------------------------------- 5. and nothing else makes it
{
  /*
    CRAFTING IS THE ENGINE'S, AND IT IS THE ONE WAY IN THIS FILE CANNOT SEE.
    A recipe hands over its output without the gamemode writing anything, and
    a recipe nobody owns may be made by anybody. game/data/recipes.json is every
    COBJ record in the load order, so a recipe that made gold would be a mint
    open to everybody. None does. Twenty one take gold as an input, measured
    on 24 September, Immersive Armors and Immersive Weapons, and that is coin
    leaving the world rather than coin coming into it.
  */
  let book = null;
  try { book = JSON.parse(fs.readFileSync(RECIPES, 'utf8')); } catch (e) { book = null; }
  yes('game/data/recipes.json is there to read', book !== null);
  if (book !== null) {
    let rows = 0;
    const makes = [];
    for (const part of ['recipes', 'unowned', 'refused']) {
      const table = book[part] || {};
      for (const k of Object.keys(table)) {
        rows++;
        const out = String((table[k] && table[k].out) || '');
        const hit = /^([0-9a-f]{1,8}):(.+)$/i.exec(out);
        if (hit && parseInt(hit[1], 16) === GOLD && hit[2].toLowerCase() === 'skyrim.esm') {
          makes.push(k + ' ' + (table[k].editorId || ''));
        }
      }
    }
    yes('it holds every recipe in the load order, ' + rows + ' of them', rows > 4000);
    yes('and not one of them makes gold' + (makes.length ? ': ' + makes.slice(0, 5).join(', ') : ''),
        makes.length === 0);
  }
}

yes('the gamemode never asks Papyrus to AddItem', !/(['"])AddItem\1/.test(code));

{
  // The world hands no gold over, and nothing in the gamemode has to refuse
  // it: no container holds what the world put there (forbiddenBaseContainer,
  // #3078), and Thornswood-Last.esp switches off every placed MISC, which
  // Gold001 is, and every coin purse (#3077).
  const builder = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'mods', 'Build-LastPlugin.py'), 'utf8');
  const deploy = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'deploy', 'Deploy-Gamemode.ps1'), 'utf8');
  yes('and the world does not hand gold over: no container is filled, and no coin or coin purse lies on the floor',
      /forbiddenBaseContainer -NotePropertyValue @\('CONT'\)/.test(deploy) &&
      /FLOOR_TYPES = \([^)]*b'MISC'/.test(builder) && /COIN_PURSES = \(/.test(builder));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
