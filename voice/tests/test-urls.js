// Lift the url builders out of the shipped files so this tests them, not a copy.
// The launcher's voice is C# since #4823 (launcher/app/VoiceSession.cs), so
// its side is run, not lifted: tests/voice-launcher.js builds it with the
// .NET 10 SDK and this reads the address it dials, on a socket it answers.
//
// Since #1304 every client builds https and wss and nothing else: the raw
// port they fell back to without an https address is shut, and the service
// refuses a join token over plain ws. Config.cs's side is held by
// tests/test-1304-voice-tls-only.js.
const fs = require('fs');
const R = require('path').resolve(__dirname, '..', '..');
const VL = require(R + '/tests/voice-launcher');

function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no ' + name);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* What the launcher's voice dials, configured as Voice.cs configures it with
   this base and socket: the address, or '' when it dials nothing. */
async function dialled(cfg) {
  const l = await VL.start({ clock: 'manual', wire: 'fake' });
  try {
    await l.send({ do: 'configure', profileId: 7, name: '', token: 'a token', base: cfg.base || '', socket: cfg.socket || '' });
    const d = l.dials();
    return d.length ? d.map((x) => x.url).join(' ') : '';
  } finally { await l.quit(); }
}

const chat = fs.readFileSync(R + '/game/ui/thornswood-chat.js', 'utf8');
const chatUrl = new Function('CFG', 'HOST', 'PORT', lift(chat, 'url') + '; return url;');

let fail = 0;
function check(what, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + what.padEnd(40) + JSON.stringify(got) + (ok ? '' : '   want ' + JSON.stringify(want)));
}

(async () => {
console.log('the launcher\'s voice:');
check('only host and port: no address', await dialled({ host: '203.0.113.7', port: '7778' }), '');
check('launcher sent both', await dialled({ base: 'https://thornswood.net/voice', socket: 'wss://thornswood.net/voice/' }), 'wss://thornswood.net/voice/');
check('base only, socket derived', await dialled({ base: 'https://thornswood.net/voice' }), 'wss://thornswood.net/voice/');
check('trailing slash trimmed', await dialled({ base: 'https://thornswood.net/voice/' }), 'wss://thornswood.net/voice/');
check('plain http is no address, not ws', await dialled({ base: 'http://box/voice' }), '');
check('a ws socket is not taken, wss derived', await dialled({ base: 'https://box/voice', socket: 'ws://box/voice/' }), 'wss://box/voice/');

console.log('\nthe chat socket in the game:');
check('no base: no address, not ws', chatUrl({}, '203.0.113.7', 7778)(), '');
check('base set', chatUrl({ base: 'https://thornswood.net/voice' }, 'x', 1)(), 'wss://thornswood.net/voice/');
check('base with trailing slash', chatUrl({ base: 'https://thornswood.net/voice/' }, 'x', 1)(), 'wss://thornswood.net/voice/');
check('dev base', chatUrl({ base: 'https://thornswood.net/voice-dev' }, 'x', 1)(), 'wss://thornswood.net/voice-dev/');
check('plain http base: no address', chatUrl({ base: 'http://box/voice' }, 'x', 1)(), '');

console.log('\n' + (fail ? fail + ' FAILED' : 'all agree with the C# side'));
process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('FAIL the harness itself: ' + (e && e.stack || e)); process.exitCode = 1; });
