// test-2474-heads.js
//
// Above another person's head: the name in your party's green, and the
// speaking mark, live, in the colour of the distance they speak at (#2474).
//
// Patrick, 12 Oct: "the name above a player's head is supposed to change
// colors if you're in the same party as them and it doesn't. There's also no
// voice indicator above their heads". Then: the mark shows by distance and in
// the colour of the mode they speak in, "party is name only", and it "should
// be live and reflective like the one on your screen and also the one on your
// screen should change colors based on the mode you are speaking in as well".
//
// Two causes, both RUN here rather than read:
//
//   the name   the plugin kept one flag per person, "already green", while
//              the client throws a tag away and makes a new white one every
//              time somebody leaves your sight (formView.ts removeNickname:
//              out of line of sight, past 1000 units, sneaking, behind the
//              camera). The flag stayed set and the new tag was never
//              coloured. It is kept per tag id now.
//   the mark   the voice feed keys marks and words by the SERVER's actor id,
//              and the plugin looked that number up as if it were this
//              machine's. The client places other people's characters with
//              ids of its own (#1275), so no mark or words ever stood over
//              anybody. The gamemode's near script now hands out the client's
//              own converter, thornswoodSocialClientId.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8').split(CR).join(''); }
function code(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }

const front = read('game/plugins/thornswood-front.js');
const gm = read('game/gamemode.js');
const voice = read('game/ui/thornswood-voice.js');

function constLine(src, name) {
  const m = new RegExp('const ' + name + ' = (\\[[^\\]]*\\]);').exec(src);
  return m ? m[1] : null;
}

// ------------------------------------------------------------- the name tags
{
  const a = front.indexOf('  const tagWrote = {};');
  const b = front.indexOf('  function markerFor(hex, name) {');
  yes('the name tag block is in the front plugin', a > 0 && b > a);
  yes('the old per-person flags are gone', !/partyTinted|nameHidden/.test(code(front)));

  const PARTY = constLine(front, 'PARTY_COLOUR');
  const PLAIN = constLine(front, 'PLAIN_COLOUR');
  const HIDDEN = constLine(front, 'HIDDEN_COLOUR');
  yes('the three tag colours are where they were', !!PARTY && !!PLAIN && !!HIDDEN);

  const handlers = [];
  const calls = [];
  const store = {};
  const g = {};
  const sp = {
    storage: store,
    setTextColor: function (id, c) { calls.push([id, c.join(',')]); },
    on: function (ev, fn) { if (ev === 'update') { handlers.push(fn); } }
  };
  const lines = [];
  const make = new Function('sp', 'globalThis', 'guard', 'say', 'nearList',
    'const PARTY_COLOUR = ' + PARTY + ';\nconst PLAIN_COLOUR = ' + PLAIN + ';\n' +
    'const HIDDEN_COLOUR = ' + HIDDEN + ';\n' + front.slice(a, b) +
    '\nreturn { tagWants: tagWants, partyList: partyList };');
  const near = {};
  const T = make(sp, g, function (n, f) { return f; }, function (l) { lines.push(l); },
                 function () { return near; });
  yes('it runs once a frame', handlers.length === 1);
  const frame = handlers[0];

  const green = eval(PARTY).join(',');
  const white = eval(PLAIN).join(',');
  const clear = eval(HIDDEN).join(',');
  const SERA = 0xff000816, HEX = SERA.toString(16);
  const BJORN = 0xff000900;

  // In a party with Sera, and her tag is up.
  T.tagWants({ [HEX]: { a: HEX, n: 'Sera' } });
  store.idTextNickname = { [SERA]: 5, [BJORN]: 6 };
  calls.length = 0;
  frame();
  yes('her name is written green', calls.length === 1 && calls[0][0] === 5 && calls[0][1] === green);
  yes('and a stranger\'s new tag is left as the client made it', !calls.some(c => c[0] === 6));
  calls.length = 0;
  for (let i = 0; i < 100; i++) { frame(); }
  yes('a hundred frames with nothing new write nothing', calls.length === 0);

  /*
    THE DEFECT. You turn away, the client destroys her tag (formView.ts,
    headScreenPos[2] < 0), you turn back and it makes a new one in white. The
    old flag said she was already green and nothing was written.
  */
  delete store.idTextNickname[SERA];
  frame();
  store.idTextNickname[SERA] = 9;
  calls.length = 0;
  frame();
  yes('the new tag after you look away and back is green too',
      calls.length === 1 && calls[0][0] === 9 && calls[0][1] === green);

  // She leaves the party: back to the client's white, on the tag she has now.
  T.tagWants({});
  calls.length = 0;
  frame();
  yes('leaving the party puts her name back to the client\'s white',
      calls.length === 1 && calls[0][0] === 9 && calls[0][1] === white);

  // A name you hid stays blank, party or not, and on a remade tag too.
  near[HEX] = { n: 'Sera', h: 1 };
  T.tagWants({ [HEX]: { a: HEX, n: 'Sera' } });
  calls.length = 0;
  frame();
  yes('a hidden name is blank, even in the party', calls.length === 1 && calls[0][1] === clear);
  store.idTextNickname[SERA] = 14;
  calls.length = 0;
  frame();
  yes('and its next tag is blank from the frame it appears', calls.length === 1 && calls[0][0] === 14 && calls[0][1] === clear);

  delete near[HEX];
  T.tagWants({ [HEX]: { a: HEX, n: 'Sera' } });
  calls.length = 0;
  frame();
  yes('shown again, a party name is green again', calls.length === 1 && calls[0][1] === green);

  g.thornswoodHideAllNames = 1;
  calls.length = 0;
  frame();
  yes('hide every name blanks every tag', calls.length === 2 && calls.every(c => c[1] === clear));
  g.thornswoodHideAllNames = 0;
  calls.length = 0;
  frame();
  yes('and turning it off gives each its own colour back',
      calls.some(c => c[0] === 14 && c[1] === green) && calls.some(c => c[0] === 6 && c[1] === white));
  yes('the colours are said in the log, for the next session to read', lines.some(l => /^name tags: /.test(l)));
}

// ---------------------------------------------------------- the server's id
{
  yes('the gamemode\'s near script hands out the client\'s own converter',
      /globalThis\.thornswoodSocialClientId = ctx\.getFormIdInClientFormat;/.test(gm));
  const m = /function nearScript\(\) \{\n    return (\[[\s\S]*?\])\.join\('\\n'\);/.exec(gm);
  yes('the near script was found', !!m);
  if (m) {
    const body = eval(m[1]).join('\n');
    const g = {};
    const conv = function (id) { return id; };
    new Function('ctx', 'globalThis', body)({
      value: { w: {}, at: 5 }, state: {},
      getFormIdInServerFormat: conv, getFormIdInClientFormat: conv
    }, g);
    yes('and running it puts both converters where the plugin reads them',
        g.thornswoodSocialClientId === conv && g.thornswoodSocialServerId === conv);
  }

  const a = front.indexOf('  function localRef(serverId) {');
  const b = front.indexOf('  function overheadMessage(what) {');
  yes('the overhead block converts the id before it looks', a > 0 && b > a &&
      /refr = localRef\(key\);/.test(front.slice(a, b)));
  if (a > 0 && b > a) {
    const asked = [];
    const g = {};
    const refs = { 0xff000003: { local: true } };
    const sp = {
      Game: { getFormEx: function (id) { asked.push(id); return refs[id] || null; }, getPlayer: function () { return null; } },
      ObjectReference: { from: function (f) { return f; } }
    };
    const localRef = new Function('sp', 'globalThis', front.slice(a, b) + '\nreturn localRef;')(sp, g);
    yes('with no converter yet, nobody is guessed at', localRef(0xff000816) === null && asked.length === 0);
    g.thornswoodSocialClientId = function (id) { return id === 0xff000816 ? 0xff000003 : 0; };
    yes('the server\'s id finds this machine\'s reference', localRef(0xff000816) === refs[0xff000003] &&
        asked[0] === 0xff000003);
    yes('and the server\'s id is never looked up as if it were this machine\'s', asked.indexOf(0xff000816) === -1);
    yes('somebody this machine has not placed is nobody', localRef(0xff000999) === null);
  }
}

// ------------------------------------------------- the mark, live, by mode
{
  const MARK = /const MARK_COLOUR = \{([\s\S]*?)\};/.exec(front);
  yes('the mark keeps one colour per mode', !!MARK);
  const marks = MARK ? new Function('return {' + MARK[1] + '};')() : {};
  function hex(c) {
    return '#' + c.slice(0, 3).map(v => ('0' + Math.round(v * 255).toString(16)).slice(-2)).join('');
  }
  const MODES = /var MODES = \{([\s\S]*?)\};/.exec(voice);
  const modes = MODES ? new Function('return {' + MODES[1] + '};')() : {};
  yes('your own microphone has a colour for each of the three distances',
      ['whisper', 'local', 'yell'].every(k => modes[k] && /^#[0-9a-f]{6}$/.test(modes[k].colour)));
  yes('and each is the mark\'s colour for that distance, so you see what others see',
      ['whisper', 'local', 'yell'].every(k => marks[k] && modes[k] && hex(marks[k]) === modes[k].colour));
  yes('whisper pale blue, ordinary white, yell amber, as the voice page says',
      modes.whisper.colour === '#9ec7f2' && modes.local.colour === '#ffffff' && modes.yell.colour === '#edad38');
  const PARTY = constLine(front, 'PARTY_COLOUR');
  yes('no mode is the party\'s green, which is the name\'s alone',
      ['whisper', 'local', 'yell'].every(k => marks[k].join(',') !== eval(PARTY).join(',')));
  yes('the microphone takes the mode\'s colour while you speak',
      /var colour = live \? modeOf\(myMode\)\.colour/.test(voice));

  // Live: the page sends the list on every position tick, and only people
  // inside the distance of the mode they speak in.
  const pub = /function publishMarks\(\) \{[\s\S]*?\n  \}/.exec(voice);
  yes('the voice page publishes marks', !!pub);
  if (pub) {
    const sent = [];
    const run = new Function('lastWho', 'cfg', 'muted', 'hushed', 'MODES', 'UNITS_PER_METRE', 'window',
      'var markSig = "";\n' + pub[0] + '\nreturn publishMarks;');
    const who = {
      1: { pos: [0, 0, 0], cell: 'c', actor: 0xff000001 },
      2: { pos: [20 * 70, 0, 0], cell: 'c', actor: 0xff000002, talk: 1, mode: 'local' },
      3: { pos: [20 * 70, 0, 0], cell: 'c', actor: 0xff000003, talk: 1, mode: 'whisper' },
      4: { pos: [80 * 70, 0, 0], cell: 'c', actor: 0xff000004, talk: 1, mode: 'yell' },
      5: { pos: [5 * 70, 0, 0], cell: 'c', actor: 0xff000005, talk: 0, mode: 'local' }
    };
    const publish = run(who, { profileId: 1 }, {}, {}, modes, 70,
      { skyrimPlatform: { sendMessage: function (to, m) { sent.push(m); } } });
    publish();
    const list = sent.length ? JSON.parse(sent[0].slice(6)) : [];
    const by = {};
    list.forEach(r => { by[r.a] = r.m; });
    yes('ordinary speech at 20 metres is marked, white', by[0xff000002] === 'local');
    yes('a whisper at 20 metres is not: you cannot hear it', !(0xff000003 in by));
    yes('a yell at 80 metres is marked, amber', by[0xff000004] === 'yell');
    yes('somebody close with the key up has no mark', !(0xff000005 in by));
    who[5].talk = 1;
    publish();
    yes('and the moment they press to talk, they do', sent.length === 2 && /4278190085/.test(sent[1]));
    who[5].talk = 0;
    publish();
    yes('and it goes when they let go', sent.length === 3 && !/4278190085/.test(sent[2]));
  }

  const c = code(front);
  yes('the mark breathes on the microphone\'s own beat',
      /MARK_BEAT_MS = 1150/.test(c) && /MARK_LOW = 0\.58/.test(c) &&
      /twPulse 1\.15s ease-in-out infinite/.test(voice) && /50%\{opacity:\.58\}/.test(voice));
  yes('its colour is written when it changes, so a new distance shows without a new mark',
      /if \(String\(colour\) !== rec\.colour\) \{ sp\.setTextColor\(rec\.id, colour\);/.test(c));
  yes('it is a round dot from Thornswood\'s own OFL sprite font (#1317)',
      /MARK_TEXT = '\\u2022'/.test(c) && /MARK_FONT = 'Barlow-SemiBold'/.test(c));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
