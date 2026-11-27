// test-7167-horn.js
//
// #7167. The emote wheel's Horn (IdleBlowHornStormcloak) played with no horn
// in the pack, and no bench made a horn. Measured on the box on 27 Nov 2026
// (List-GameData -Lister ToolRecords): Skyrim's own Nord War Horn is MISC
// 200b6 and its Imperial War Horn MISC 200ba, both of Skyrim.esm, and nothing
// in the load order made either.
//
//   B  scripts/mods/Add-ContentRecords.py makes the Nord War Horn at the
//      woodworking bench, with the instruments, from a horker tusk and a
//      leather strip, under a form id of the plugin's own.
//   E  the wheel's Horn needs a horn in the pack, Nord or Imperial: it is
//      refused without one, saying so, and plays with either. The lute,
//      flute and drum still ask for what they asked for.
//   T  the recipe table, built on the box from that plugin, has the horn as
//      a Woodwright's recipe at the woodworking bench, making the Nord War
//      Horn (a content check: it reads game/data/recipes.json).
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------------ B
const tool = fs.readFileSync(path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py'), 'utf8');
const consts = {}, byValue = {};
const re = /^([A-Z][A-Z0-9_]*) = 0x([0-9A-Fa-f]+)\b/gm;
let m;
while ((m = re.exec(tool)) !== null) {
  const v = parseInt(m[2], 16);
  consts[m[1]] = v;
  (byValue[v] = byValue[v] || []).push(m[1]);
}
yes('B1 HORN is Skyrim\'s own Nord War Horn, 0x200b6', consts.HORN === 0x200B6);
yes('B1 HORKER_TUSK is Skyrim\'s Horker Tusk, 0x3ad68', consts.HORKER_TUSK === 0x3AD68);
const v = consts.RECIPE_HORN;
yes('B2 RECIPE_HORN is the plugin\'s own, from 0x501B000 on, and no other name has its number',
    typeof v === 'number' && v >= 0x501B000 && v <= 0x501BFFF && byValue[v].length === 1);
const start = tool.indexOf('def thornswood_records(');
const end = start < 0 ? -1 : tool.indexOf('\ndef ', start + 1);
const body = start < 0 ? '' : tool.slice(start, end < 0 ? undefined : end);
yes('B3 thornswood_records writes ThornswoodRecipeInstrumentHorn: a horker tusk and a leather strip make the horn at the woodworking bench',
    /cobj\(RECIPE_HORN, 'ThornswoodRecipeInstrumentHorn', \[\(HORKER_TUSK, 1\), \(LEATHER_STRIPS, 1\)\],\s*HORN, WOODWORKING_KEYWORD\)/.test(body));
yes('B4 the plugin\'s description names it with the instruments',
    tool.indexOf("(r'COBJ ThornswoodRecipeInstrument(Flute|Lute|Drum|Horn)$', 'own', 'instruments')") >= 0);

// ------------------------------------------------------------------ E
const emotes = fs.readFileSync(path.join(ROOT, 'game', 'plugins', 'thornswood-emotes.js'), 'utf8');
const horn = /\{ name: 'Horn', event: '([^']+)' \}/.exec(emotes);
yes('E0 the wheel has Horn, blowing Skyrim\'s horn', !!horn && horn[1] === 'IdleBlowHornStormcloak');
const from = emotes.indexOf('const INSTRUMENT_FILE');
const to = emotes.indexOf('function playNamed(');
let check = null;
try {
  check = new Function('sp', 'player', 'log',
    emotes.slice(from, to) + '\nreturn { refuseInstrument: refuseInstrument };');
} catch (e) { check = null; }
yes('E0 the wheel\'s instrument check can be read on its own', !!check && from >= 0 && to > from);

// A pack of these records (as "id:file"), and what the person was told.
function wheel(pack) {
  const told = [];
  const forms = {};
  const sp = {
    Game: { getFormFromFile: (id, file) => (forms[id.toString(16) + ':' + file] = forms[id.toString(16) + ':' + file] || { key: id.toString(16) + ':' + file }) },
    Debug: { notification: (text) => told.push(text) }
  };
  const pc = { getItemCount: (form) => (pack.indexOf(form.key) >= 0 ? 1 : 0) };
  const w = check(sp, () => pc, () => {});
  return { refuse: (name) => w.refuseInstrument(name), told };
}
if (check) {
  const none = wheel([]);
  yes('E1 Horn is refused with no horn in the pack', none.refuse('Horn') === true);
  yes('E1 and the person is told they need a horn', none.told.join('|') === 'You need a horn.');
  yes('E2 it plays with the Nord War Horn in the pack', wheel(['200b6:Skyrim.esm']).refuse('Horn') === false);
  yes('E2 and with the Imperial War Horn', wheel(['200ba:Skyrim.esm']).refuse('Horn') === false);
  yes('E2 a flute is no horn', wheel(['d62:PlayFluteLuteDrum.esp']).refuse('Horn') === true);
  yes('E3 the flute still asks for what it asked for',
      wheel(['d62:PlayFluteLuteDrum.esp']).refuse('Flute') === false && wheel([]).refuse('Flute') === true);
  yes('E3 and a horn is no flute, lute or drum',
      ['Flute', 'Lute', 'Drum'].every((n) => wheel(['200b6:Skyrim.esm']).refuse(n) === true));
  yes('E4 an emote that is no instrument needs nothing', wheel([]).refuse('Wave') === false);
}

// ------------------------------------------------------------------ T
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'recipes.json'), 'utf8'));
const desc = typeof v === 'number' ? (v & 0xFFFFFF).toString(16) + ':Thornswood-Content.esp' : '';
const row = (recipes.recipes || {})[desc];
yes('T1 the recipe table has the horn as a Woodwright\'s recipe at the woodworking bench, making the Nord War Horn',
    !!row && row.editorId === 'ThornswoodRecipeInstrumentHorn' && row.out === '200b6:Skyrim.esm' && row.makes === 1 &&
    row.benchName === 'ThornswoodCraftingWoodworking' && row.owner === 'Woodworker' && row.half === 'Woodwright' &&
    row.book !== 'cut' &&
    JSON.stringify(row.inputItems.map((x) => [x.item, x.count]).sort()) ===
      JSON.stringify([['3ad68:Skyrim.esm', 1], ['800e4:Skyrim.esm', 1]]));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
