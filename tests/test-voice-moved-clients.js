// test-voice-moved-clients.js
//
// Issue #482: after the whole view on the first tick, the voice service sends
// { t: 'moved' } with only the rows that changed and the ids that left the
// view (gone), and nothing when nothing changed. A client that still replaced
// its table with each message would keep only the people who moved, and
// everybody standing still would fall silent.
//
// Both clients are checked here: the launcher's voice and the game's overlay
// (whose table the party strip reads too). The overlay has the shared helper
// run, and has to route 'moved' to it rather than to the replace. The
// launcher's voice is C# since #4823 (launcher\app\VoiceSession.cs), so it is
// run, in a room this harness answers in the service's place
// (tests\voice-launcher.js), and what it plays is read back: somebody
// standing still is still heard after a 'moved' that leaves them out. The
// plain browser page the service once served was a third, until it went
// (#1822). voice/tests/test-moved.js checks the same thing against the real
// service. Read only, but for the voice driver's build in the temp folder.
const fs = require('fs');
const path = require('path');
const VL = require('./voice-launcher');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(__dirname, rel), 'utf8').split(CR).join(''); }

function helper(src, name) {
  // Up to the brace at the function's own indent, not the first inner one.
  const m = /^([ \t]*)function applyMoved\(table, m\) \{[\s\S]*?\n\1\}\n/m.exec(src);
  yes(name + ' has the helper', !!m);
  if (!m) { return null; }
  return new Function('Object', m[0] + '\nreturn applyMoved;')(Object);
}

function exercise(apply, name) {
  if (!apply) { return; }
  const table = {
    1: { pos: [0, 0, 0], angleZ: 0, cell: 'c', name: 'me' },
    2: { pos: [100, 0, 0], angleZ: 0, cell: 'c', name: 'still' },
    3: { pos: [200, 0, 0], angleZ: 0, cell: 'c', name: 'walker' },
    4: { pos: [300, 0, 0], angleZ: 0, cell: 'c', name: 'leaver' }
  };
  apply(table, { t: 'moved', at: 1, who: { 3: { pos: [210, 0, 0], angleZ: 5, cell: 'c', name: 'walker' },
                                           5: { pos: [50, 0, 0], angleZ: 0, cell: 'c', name: 'arrival' } },
                 gone: [4] });
  yes(name + ': somebody standing still is kept', !!table[2] && table[2].pos[0] === 100);
  yes(name + ': somebody who moved is where they moved to', table[3].pos[0] === 210 && table[3].angleZ === 5);
  yes(name + ': somebody new in range is added', !!table[5]);
  yes(name + ': somebody in gone is dropped', !table[4]);
  yes(name + ': and their own row is still there', !!table[1]);
}

// Since #1409 each moved branch also reads the silence marks off the rows that
// moved (noteRows) and puts the microphone right, between the helper and the
// return. What matters here is that the table goes through the helper and is
// never replaced by the rows that moved.
function movedBranch(src) {
  const m = /if \(m\.t === 'moved'\) \{( [^\n]*?return; )\}/.exec(src);
  return m ? m[1] : '';
}

const overlay = read('../game/ui/thornswood-voice.js');
exercise(helper(overlay, 'the game overlay'), 'the game overlay');
const overlayMoved = movedBranch(overlay);
yes('the game overlay sends moved to the helper, and the party strip reads the same table',
    /^ applyMoved\(lastWho, m\);/.test(overlayMoved) && /place\(\);/.test(overlayMoved) &&
    /return; $/.test(overlayMoved) && !/lastWho = /.test(overlayMoved) &&
    /who: function \(\) \{ return lastWho; \}/.test(overlay));
yes('and reads the silence marks off the rows that moved', /noteRows\(m\.who \|\| \{\}\);/.test(overlayMoved));

/*
  The launcher's voice, with four others talking, each a tone of their own.
  Positions are Skyrim units, 70 to the metre; everybody here is within a
  metre of me, where a local voice is at full level.
*/
const TONES = { 2: 500, 3: 600, 4: 700, 5: 800 };
const HEARD = 0.05, SILENT = 0.02;
const settle = () => new Promise((ok) => setTimeout(ok, 750));

async function launcher() {
  const r = await VL.room([
    { profileId: 1, name: 'me', tone: 440 },
    { profileId: 2, name: 'still', tone: TONES[2] },
    { profileId: 3, name: 'walker', tone: TONES[3] },
    { profileId: 4, name: 'leaver', tone: TONES[4] },
    { profileId: 5, name: 'arrival', tone: TONES[5] }
  ]);
  try {
    const me = r.at(0);
    await r.all({ t: 'peers', peers: r.rows() });
    for (let i = 1; i < 5; i++) { await r.at(i).send({ do: 'ptt', on: true }); }
    await me.until(() => ['still', 'walker', 'leaver', 'arrival'].every((n) => me.says(new RegExp('^receiving from ' + n + '$'))), 30000, 'audio from all four');
    const row = (x) => ({ pos: [x, 0, 0], angleZ: 0, cell: 'c' });
    async function heard() {
      await settle();
      const lv = await me.hear(Object.keys(TONES).map((k) => TONES[k]));
      const out = {};
      for (const k of Object.keys(TONES)) { out[k] = lv[String(TONES[k])]; }
      return out;
    }
    const say = (lv) => Object.keys(lv).map((k) => k + ' ' + lv[k].toFixed(3)).join(', ');

    // The whole view: everybody but the arrival, who is not in it yet.
    await r.say(0, { t: 'pos', at: 1, who: { 1: row(0), 2: row(20), 3: row(30), 4: row(40) } });
    let lv = await heard();
    yes('the launcher\'s voice: after the whole view, the three in it are heard and the one not in it is not (' + say(lv) + ')',
        lv[2] > HEARD && lv[3] > HEARD && lv[4] > HEARD && lv[5] < SILENT);

    await r.say(0, { t: 'moved', at: 1, who: { 3: Object.assign(row(35), { angleZ: 5 }), 5: row(25) }, gone: [4] });
    lv = await heard();
    yes('the launcher\'s voice: somebody standing still is kept, and heard (' + lv[2].toFixed(3) + ')', lv[2] > HEARD);
    yes('the launcher\'s voice: somebody who moved is heard where they moved to (' + lv[3].toFixed(3) + ')', lv[3] > HEARD);
    yes('the launcher\'s voice: somebody new in range is added, and heard (' + lv[5].toFixed(3) + ')', lv[5] > HEARD);
    yes('the launcher\'s voice: somebody in gone is dropped, and silent (' + lv[4].toFixed(3) + ')', lv[4] < SILENT);

    // My own row was in no 'moved': distance is still measured from it, so
    // the one who stood still walking out of range goes quiet.
    await r.say(0, { t: 'moved', at: 2, who: { 2: row(2000) } });
    lv = await heard();
    yes('the launcher\'s voice: and its own row is still there to measure from (' + lv[2].toFixed(3) + ' once 2000 units off)',
        lv[2] < SILENT && lv[3] > HEARD);
    for (let i = 0; i < 5; i++) {
      const sw = r.at(i).swallowed();
      if (sw) { yes(r.at(i).name + '\'s session swallowed nothing:\n' + sw, false); }
    }
  } finally {
    await r.quit();
  }
}

launcher().then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}).catch((e) => {
  console.log('FAIL  the harness itself: ' + (e && e.stack || e));
  process.exitCode = 1;
});
