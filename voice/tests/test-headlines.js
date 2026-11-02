// test-headlines.js
//
// Words above the head, an emote's name on that line, and the speaking mark.
// The distances are the ones on the chat and voice pages. The box being
// worldwide does not make the line above the head worldwide.
//
//   node voice/tests/test-headlines.js
'use strict';
const path = require('path');
const heads = require(path.join(__dirname, '..', '..', 'voice', 'headlines.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const say = heads.floatLine('hello there');
yes('a plain line floats', say && say.kind === 'say' && say.head === 'hello there' && say.reach === 4000 && say.local === false);
yes('a plain line is not kept to the box only', say && say.head === 'hello there');

const far = heads.floatLine('x'.repeat(90));
yes('the line above the head stops at 80 characters', far && far.head.length === 80 && far.head.slice(-3) === '...');
yes('the box keeps more than the line above the head', far && far.words.length === 90);

yes('another command does not float', heads.floatLine('/bard') === null);
yes('/trade does not float', heads.floatLine('/trade Ahlam') === null);
yes('/roll does not float', heads.floatLine('/roll 20') === null);

const me = heads.floatLine('/me draws a sword');
yes('a /me floats as the action', me && me.local && me.kind === 'me' && me.head === 'draws a sword' && me.reach === 4000);
yes('an empty /me explains itself', heads.floatLine('/me').empty === true);

const whisper = heads.floatLine('/w quietly');
yes('a whisper floats inside about 14 metres', whisper && whisper.reach === 1000 && whisper.head === 'quietly');
const shout = heads.floatLine('/s across the market');
yes('a shout floats inside about 171 metres', shout && shout.reach === 12000 && shout.head === 'across the market');

const ooc = heads.floatLine('/ooc can we not');
yes('an /ooc floats in brackets', ooc && ooc.local && ooc.kind === 'ooc' && ooc.head === '(( can we not ))' && ooc.reach === 4000);

const scene = heads.floatLine('/do The door is barred.');
yes('a /do floats as what there is to see', scene && scene.head === 'The door is barred.' && scene.reach === 4000);

yes('an emote name is the line', heads.emoteHead('Wave') === 'Wave');
yes('an empty emote name is not a line', heads.emoteHead('  ') === '');

const here = { cell: 'Whiterun', pos: [0, 0, 0] };
const close = { cell: 'Whiterun', pos: [3000, 0, 0] };
const past = { cell: 'Whiterun', pos: [5000, 0, 0] };
const other = { cell: 'Markarth', pos: [10, 0, 0] };
yes('57 metres in the same cell can read it', heads.sameCellWithin(here, close, 4000));
yes('past 57 metres cannot', !heads.sameCellWithin(here, past, 4000));
yes('another cell cannot, even standing on the same spot', !heads.sameCellWithin(here, other, 4000));
yes('a shout reaches past a plain line', heads.sameCellWithin(here, past, 12000));

yes('a whisper mark shows inside 7 metres', heads.markVisible({ talking: true, mode: 'whisper', metres: 6, sameCell: true }));
yes('a whisper mark is gone at 7 metres', !heads.markVisible({ talking: true, mode: 'whisper', metres: 8, sameCell: true }));
yes('ordinary speech is gone at 30 metres', !heads.markVisible({ talking: true, mode: 'local', metres: 31, sameCell: true }));
yes('a yell shows inside 85 metres', heads.markVisible({ talking: true, mode: 'yell', metres: 80, sameCell: true }));
yes('you do not see your own mark', !heads.markVisible({ talking: true, self: true, metres: 0 }));
yes('a voice mute hides the mark', !heads.markVisible({ talking: true, voiceMuted: true, metres: 1 }));
yes('staff silence hides the mark', !heads.markVisible({ talking: true, silenced: true, metres: 1 }));
yes('a closed microphone has no mark', !heads.markVisible({ talking: false, metres: 1 }));
yes('another cell has no mark', !heads.markVisible({ talking: true, sameCell: false, metres: 1 }));
yes('hiding a name does not hide the mark', heads.markVisible({ talking: true, metres: 1, nameHidden: true }));
yes('turning off their text does not hide the mark', heads.markVisible({ talking: true, metres: 1, textMuted: true }));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
