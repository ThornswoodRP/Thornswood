'use strict';
/*
  test-998-patreon-copy.js

  #998: Patreon's About text is pasted by hand from the To Do board's
  "every word to paste" section in site/data/board.json, so the repo copy is
  the only one anything can check. It has to:
  A. say nothing about a closed playtest (the words #428 retired),
  B. carry a closing line for each state of the site's open switch, and
  C. say for each state what the bot's join panel says for that state, so
     Patreon cannot claim the world is open while Discord asks for an
     application, or the other way round.

  #2828: Bethesda's terms for mods forbid money for making mods, so
  D. the blurb, the terms page and the classes page all say the Patreon pays
     for the server, the domain and other expenses, and none of them says it
     pays for the time that goes into building Thornswood.
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0;
function yes(what, c) { if (c) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const board = JSON.parse(read('site/data/board.json'));
const sec = ((board.todo || {}).sections || []).find((s) => /every word to paste/i.test(s.name || ''));
yes('the Patreon paste section is on the board', !!sec);
const row = sec && sec.rows.find((r) => /page blurb/i.test(JSON.stringify(r.cells)));
yes('it has the page blurb row', !!row);
const text = row ? Object.values(row.cells).join('\n') : '';

yes('A nothing in the blurb says closed playtest', !/\bclosed[\s-]+playtest/i.test(text));

const ALPHA = /in alpha, and the world is open by application/i;
const OPEN = /Thornswood is open: anyone in the Discord can play/i;
yes('B it has the line for the alpha, open by application', ALPHA.test(text));
yes('B it has the line for the day the switch is on', OPEN.test(text));
yes('B and says which line goes in for which state', /open switch/i.test(text));

const bot = read('bot/bot.py').replace(/'\s*\n\s*'/g, '');
// The words are _PANEL_PLAY_ALPHA and _PANEL_PLAY_OPEN since #3317, shared by
// the one panel of before and the #apply-to-playtest desk's.
yes('C the bot says the same while the alpha is open by application', /_PANEL_PLAY_ALPHA = [\s\S]{0,200}in alpha, and the world is open by application/.test(bot)
    && /PANEL_ALPHA = _PANEL_TOP \+ _PANEL_PLAY_ALPHA/.test(bot));
yes('C the bot says the same once it is open', /_PANEL_PLAY_OPEN = [\s\S]{0,200}Thornswood is open: anyone in the Discord can play/.test(bot)
    && /PANEL_OPEN = _PANEL_TOP \+ _PANEL_PLAY_OPEN/.test(bot));

const terms = read('site/data/site/terms.md').replace(/\s+/g, ' ');
const classes = read('site/data/site/classes.md').replace(/\s+/g, ' ');
const PAYS = /Patreon pays for the server, the domain,? and (the )?other expenses/;
yes('D the blurb says what the Patreon pays for', PAYS.test(text));
yes('D the terms page says the same', PAYS.test(terms));
yes('D the classes page says the same', PAYS.test(classes));
[['the blurb', text], ['the terms page', terms], ['the classes page', classes]].forEach(function (p) {
  yes('D ' + p[0] + ' never says it pays for the time building it', !/time that goes into building|server bill/i.test(p[1]));
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
