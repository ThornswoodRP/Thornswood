// test-voice-range.js
//
// Whisper, local and yell actually carry different distances, and the handoff
// to the launcher answers nothing on the socket.
//
// TWO ENTRIES ON THE TO DO LIST, and they are in the same file for the same
// underlying reason: something was being set that nothing read.
//
//   "Whisper, local and yell all carry the same distance, because the page
//    changes a number WebAudio does not read." The three modes were applied by
//    writing refDistance and maxDistance onto a panner whose distanceModel is
//    'inverse', and the inverse model DOES NOT READ maxDistance. Only the
//    linear model does. So nothing ever stopped being audible at any distance,
//    and a yell was not louder than a whisper standing in the same place.
//
//   "Relay mode never leaves the room, because the method it calls does not
//    exist." enterRelay called n.leave() behind an `if (n.leave)` guard, and
//    thornswoodNet has never had a leave. The guard was always false, so the
//    page carried on being handed every voice message on the shared socket and
//    rebuilt the peer connections it had just dropped.
//
// Both of those are invisible from the outside: a number that is ignored and a
// guard that is false both read exactly like working code. So this drives the
// REAL functions out of the page rather than reading them.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const UI = path.join(REPO_DIR, 'game', 'ui');
const overlay = fs.readFileSync(path.join(UI, 'thornswood-voice.js'), 'utf8');
const chat = fs.readFileSync(path.join(UI, 'thornswood-chat.js'), 'utf8');

/* Lift a function out of a page by name, braces balanced. */
function lift(src, head) {
  const a = src.indexOf(head);
  if (a < 0) { return null; }
  let depth = 0, i = src.indexOf('{', a);
  if (i < 0) { return null; }
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { depth++; }
    else if (src[j] === '}') { depth--; if (!depth) { return src.slice(a, j + 1); } }
  }
  return null;
}

// ------------------------------------------------ the overlay's three modes
{
  const modes = /var MODES = \{[\s\S]*?\n  \};/.exec(overlay);
  yes('the overlay has a modes table', !!modes);
  const levelFor = lift(overlay, 'function levelFor(');
  yes('and works the level out itself rather than leaving it to the panner',
      !!levelFor);

  if (modes && levelFor) {
    const f = new Function(
      'isFinite', 'Number',
      modes[0] + '\nfunction modeOf(n){return MODES[n]||MODES.local;}\n' +
      levelFor + '\nreturn levelFor;')(isFinite, Number);

    yes('a whisper is full strength at the table', f('whisper', 1) > 0.5);
    yes('and gone across a room', f('whisper', 8) === 0);
    yes('local is gone across a market', f('local', 40) === 0);
    yes('a yell carries across one', f('yell', 40) > 0);
    yes('and is gone eventually, rather than trailing off for ever',
        f('yell', 200) === 0);

    /*
      THE CHECK THE OLD ARRANGEMENT COULD NOT HAVE PASSED. Three modes that
      differ only in refDistance on an inverse panner are three modes with no
      cut off at all, and they cannot make a yell louder than a whisper at the
      same distance either.
    */
    yes('at the same distance a yell is louder than local, and local than a whisper',
        f('yell', 5) > f('local', 5) && f('local', 5) > f('whisper', 5));
    yes('every mode reaches exactly nothing at its own limit',
        f('whisper', 7) === 0 && f('local', 30) === 0 && f('yell', 85) === 0);
    yes('and each one carries further than the one below it',
        f('yell', 40) > 0 && f('local', 40) === 0 &&
        f('local', 20) > 0 && f('whisper', 20) === 0);

    // Nonsense in, silence out, rather than a throw inside the audio loop.
    yes('a distance that is not a number does not throw',
        f('local', NaN) >= 0 && f('local', undefined) >= 0 && f('nosuchmode', 1) > 0);
  }

  // And the panner is told to keep out of it.
  yes('the panner does direction only', /panner\.rolloffFactor = 0;/.test(overlay));
  yes('so nothing is set on it that WebAudio ignores',
      !/panner\.maxDistance/.test(overlay));
  yes('the dead rolloff constant went with it', !/ROLLOFF/.test(overlay));
  yes('and the level is ramped rather than assigned, so it does not click',
      /setTargetAtTime/.test(overlay) && !/rec\.gain\.gain\.value = 1/.test(overlay));
}

// The plain browser page the service once served had the same fault and the
// same fix, until the page went (#1822).

// -------------------------------------------------------- the relay handoff
{
  /*
    THE CODE, NOT THE COMMENT. The first version of this searched the whole
    file for n.leave() and found it inside the paragraph explaining why it was
    removed, which is a check that can never pass on a file that documents its
    own history. This repo's comments quote old code on purpose; a check that
    reads them as code is a check that punishes writing them.
  */
  const code = overlay.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  yes('the call to a method that never existed is gone', !/n\.leave\(\)/.test(code));
  /*
    Handing over keeps the page on the socket (#1959). Taking it off, as
    this checked for until then, also cut off the positions the speaking
    marks and the party strip are drawn from. The signalling is kept out by
    the guard instead; tests\test-1959-relay-keeps-reading.js runs both
    orders through the real service.
  */
  yes('handing over leaves the page on the socket', !/\.off\(/.test(code) && /n\.board\(onNet\)/.test(code));
  yes('and the chat has no way off it to call', !/off: function/.test(chat));
  yes('a guard keeps the signalling out in relay mode',
      /inRelay\(\) && \(m\.t === 'sdp' \|\| m\.t === 'ice' \|\| m\.t === 'peers'\)/.test(code));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
