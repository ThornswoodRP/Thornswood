/*
  test-2705-hair-dye-help.js

  The Help page (site/data/help.md, thornswood.net/help) says how to dye your
  hair in the world, in the words a player sees, and nothing more (#2705).

  WHY THIS EXISTS. #2675 built hair dye (held draft #2699): a dye steeps at a
  cooking spot the way water boils, and only a Tailor (either half,
  Haberdasher or Liverywright, from novice) may steep one (Patrick, 18 Oct
  2026, #2699 at 2567ddae); anybody else is told whose work it is and nothing
  is taken. Using a dye is anybody's: your own hair is dyed from the Hair dye
  page of K, and somebody else's through an offer, from that page with them
  under the crosshair or from Dye hair under Near you on P, that they Accept.
  The how-to is a player page, so it describes presses and in-world actions
  only: no slash command, no issue number and no code. The colours, what
  makes them, how long a steep takes and whether there is a wash are the
  staff's list (game/data/hair-dyes.json), so the page names none of them and
  this fails if a staff setting turns up in it.

  Once the hair dye panels are in the repository, the button names the page
  uses have to be the ones the panels show, so a rename on either side fails
  here. Once the hair dye block is, the tailor gate has to be there, and the
  refusal line the page quotes has to be the one the block builds from the
  staff list's who, so a change to who may steep fails here until the page
  follows. Before then, those halves say SKIP.

  Read only.
*/
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) {
  const p = path.join(REPO_DIR, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '') : null;
}

const help = read('site/data/help.md') || '';
const m = /^## Dyeing your hair\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(help);
yes('the Help page has a Dyeing your hair section', !!m);
const body = m ? m[1] : '';
const flat = body.replace(/\*\*/g, '').replace(/\s+/g, ' ');

// ------------------------------------------------------------- what it says
yes('it opens with a Tailor (Haberdasher or Liverywright) steeping it at a cooking spot',
    /^A Tailor \(Haberdasher or Liverywright\) steeps hair dye at a cooking spot\./.test(flat.trim()));
yes('anyone can use one, on themselves from K or on someone else once they accept',
    /Anyone can use one: on yourself from the K panel, or on someone else once they accept\./.test(flat));
yes('the how-to is for a Tailor', /If you are a Tailor, carry a bottle of water/.test(flat));
yes('it takes a bottle of water and what the dye needs', /bottle of water/i.test(flat) && /what the dye needs/i.test(flat));
yes('somebody who is not a Tailor is turned away and keeps what they carry',
    /Anyone who is not a Haberdasher or Liverywright and tries it is turned away and keeps everything they carry/.test(flat));
const REFUSAL = 'Steeping hair dye is work for a Haberdasher or Liverywright. Nothing was taken from your pack.';
yes('the page quotes the refusal line', flat.indexOf('"' + REFUSAL + '"') >= 0);
yes('you press E on the cooking spot and stay by the fire', /press E on the cooking spot/.test(flat) && /stay by the fire/i.test(flat));
yes('walking away early makes and uses nothing', /Walk away[^.]*nothing is made or used/i.test(flat));
yes('your own hair is from the Hair dye page of the K panel, Dye my hair',
    /Hair dye page of the K panel/.test(flat) && /Dye my hair/.test(flat));
yes('somebody else\'s is K while looking at them, then Offer to dye',
    /look at them and press K, then Offer to dye/.test(flat));
yes('or Dye hair beside them under Near you on the P panel', /Dye hair beside them under Near you on the P panel/.test(flat));
yes('with more than one dye the button names the dye', /more than one dye in your pack, that button names the dye/.test(flat));
yes('they answer Accept or Refuse, and nothing changes until Accept',
    /Accept and Refuse/.test(flat) && /nothing is used or changed until they press Accept/.test(flat));
yes('hair, beard and brows take one colour', /Hair, beard and brows/.test(flat));

// ------------------------------------------------------- what it never says
yes('no slash command', !/(^|\s)\/[a-z]/i.test(body));
yes('no issue number', !/#\d/.test(body));
yes('no code', !/\x60|[{}<>]|\.js\b|\.json\b/.test(body));
yes('no steep time', !/\b(second|minute|hour)s?\b/i.test(flat));
yes('no wash, which is the staff\'s to ship or not', !/wash/i.test(flat));

const listText = read('game/data/hair-dyes.json');
if (listText) {
  const list = JSON.parse(listText);
  const dyes = Array.isArray(list.dyes) ? list.dyes : [];
  function namedIn(text) {
    const low = text.toLowerCase();
    return dyes.filter(function (d) {
      return [d.name, d.id].some(function (w) { return w && low.indexOf(String(w).toLowerCase()) >= 0; });
    }).map(function (d) { return d.name; });
  }
  const named = namedIn(flat);
  yes('no dye from the staff list is named', named.length === 0);
  if (named.length) { console.log('      names ' + named.join(', ')); }
  yes('no colour from the staff list is given', !dyes.some(function (d) { return d.colour && body.toLowerCase().indexOf(d.colour) >= 0; }) && !/#[0-9a-f]{6}/i.test(body));
  yes('the planted dye name check catches a dye named on the page',
      dyes.length > 0 && namedIn(flat + ' Try the ' + dyes[dyes.length - 1].name + '.').length === 1);
} else {
  console.log('SKIP  no staff dye list (game/data/hair-dyes.json) yet');
}

// ------------------------------------------------ the panels' own words
const skills = read('game/ui/thornswood-skills.js') || '';
const party = read('game/ui/thornswood-party.js') || '';
if (/hairDye/.test(skills) && /dye/.test(party)) {
  yes('K has a page called Hair dye', /title: 'Hair dye'/.test(skills));
  yes('K\'s button is Dye my hair', /Dye my hair/.test(skills));
  yes('K\'s offer button is Offer to dye', /Offer to dye/.test(skills));
  yes('P\'s button under Near you is Dye hair', /'Dye hair'/.test(party));
  yes('P names the dye when there is more than one', /'Dye: '/.test(party));
  yes('the offer prompt\'s buttons are Accept and Refuse', />Accept<\/button>/.test(party) && />Refuse<\/button>/.test(party));
} else {
  console.log('SKIP  the hair dye panels are not in this checkout yet');
}

// ------------------------------------------- who may steep, and the refusal
const gm = require('./gamemode-tables.js').joined(read('game/gamemode.js')) || '';
if (listText && /==== thornswood hair dye ====/.test(gm)) {
  const who = JSON.parse(listText).who || {};
  const halves = who.halves || {};
  const names = Object.keys(halves).sort();
  yes('the staff list says not just anyone may steep', who.anyone === false);
  yes('the staff list\'s steepers are the Tailor\'s two halves, Haberdasher and Liverywright',
      names.join(',') === 'haberdasher,liverywright');
  yes('both halves from novice, so the page names no rank',
      names.every(function (h) { return halves[h] === 'novice'; }));
  const block = gm.slice(gm.indexOf('==== thornswood hair dye ===='));
  yes('the block refuses a steep the list does not allow (the tailor gate)',
      /if \(!HAIR_DYE\.mayMake\(LIST, canWork\(actorId\)\)\) \{ return notYours\(\); \}/.test(block));
  yes('the gate asks the benches\' own rank check', /P\.canWork\(C\.stateOf\(actorId\), half, rank\)/.test(block));
  yes('the refusal line is built the way the page quotes it',
      block.indexOf("'Steeping hair dye is ' + (whose ? 'work for a ' + whose") >= 0 &&
      block.indexOf("'. Nothing was taken from your pack.'") >= 0 &&
      /\.join\(', '\) \+ ' or ' \+ /.test(block));
  // What the block builds from this list, the halves named the way the
  // professions table names them (a capital), joined with "or".
  const said = names.map(function (h) {
    return h.charAt(0).toUpperCase() + h.slice(1) + (halves[h] === 'novice' ? '' : ' at ' + halves[h]);
  });
  const built = 'Steeping hair dye is work for a ' +
      (said.length === 1 ? said[0] : said.slice(0, -1).join(', ') + ' or ' + said[said.length - 1]) +
      '. Nothing was taken from your pack.';
  yes('the line the page quotes is the one the block builds from the list', built === REFUSAL);
  yes('the professions table names both halves that way',
      names.every(function (h) { return gm.indexOf('"half":"' + h.charAt(0).toUpperCase() + h.slice(1) + '"') >= 0; }));
} else {
  console.log('SKIP  the hair dye block (tailor gate) is not in this checkout yet');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
