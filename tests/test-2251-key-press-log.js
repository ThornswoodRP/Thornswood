'use strict';
/*
  test-2251-key-press-log.js

  #2251: pressing the lock key sent /lock through the chat socket like any
  typed line, so the voice service's chat log (and the session pages that
  read it) showed somebody typing /lock. A line the front sends for a key or
  a panel now carries press: true, the log writes it with via: 'press', and
  the hub labels it "key press" instead of "command". The command itself is
  logged and run exactly as before.

  A. The client (game/ui/thornswood-chat.js): chatFrame, lifted and run, and
     say() / the queue flush using it, so a queued key line keeps the flag.
  B. The voice service (voice/voice-server.js): the real chatWrite run into a
     scratch folder, typed and pressed; the chat handler passes msg.press on,
     only when it is exactly true, and still masks /joinpass.
  C. The site (site/server.js) hands via on to the hub, only as 'press'.
  D. The hub (site/public/hub.js): the real chatText run on both kinds.
  E. The front (game/plugins/thornswood-front.js): the lock key sends through
     tellServer, which sends through say (a press) with quiet (#2732).
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const siteFiles = require('./site-files');
const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');
const CHAT = rd('game/ui/thornswood-chat.js'), VOICE = rd('voice/voice-server.js');
const SITE = siteFiles.source(), HUB = rd('site/public/hub.js'), FRONT = rd('game/plugins/thornswood-front.js');
let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
function grab(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return '';
  let d = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  return '';
}

// A
const cf = grab(CHAT, 'chatFrame');
yes('A0 chatFrame is in thornswood-chat.js', cf.length > 0);
const box = {}; vm.runInNewContext(cf + '\nthis.chatFrame = chatFrame;', box);
yes('A1 a typed line goes as { t: chat, text } with no press', JSON.stringify(box.chatFrame('/journal new')) === '{"t":"chat","text":"/journal new"}');
yes('A2 a key line goes with press: true', JSON.stringify(box.chatFrame({ text: '/lock 1a2b', press: true })) === '{"t":"chat","text":"/lock 1a2b","press":true}');
// Since #2732 say() and typed() share send(text, press, notice); say passes
// press, typed does not. test-2732-press-mark.js runs them.
const say = CHAT.slice(CHAT.indexOf('function send(text, press, notice) {'), CHAT.indexOf('state: function ()'));
yes('A3 send() wraps a pressed line as { text, press: true }', /var item = press \? \{ text: text, press: true \} : text;/.test(say));
yes('A4 sends it through chatFrame, and queues the same item', /ws\.send\(JSON\.stringify\(chatFrame\(item\)\)\)/.test(say) && /queue\.push\(item\);/.test(say));
yes('A5 the queue flush after a reconnect goes through chatFrame too, so the flag survives an outage',
    /ws\.send\(JSON\.stringify\(chatFrame\(queue\.shift\(\)\)\)\)/.test(CHAT) && !/text: queue\.shift\(\)/.test(CHAT));

// B
const CHAT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2251-'));
const vbox = { fs, path, CHAT_DIR, positions: new Map(), console: { log() {} }, Date, JSON, String, Number };
vm.runInNewContext(grab(VOICE, 'peerName') + '\n' + grab(VOICE, 'chatDay') + '\n' + grab(VOICE, 'chatWrite') +
  '\nthis.chatWrite = chatWrite; this.chatDay = chatDay;', vbox);
const me = { profileId: 77, name: 'Aela', proven: true, mode: 'local' };
vbox.chatWrite('command', 3, me, '/tp riverwood');
vbox.chatWrite('command', 3, me, '/lock 1a2b', 'press');
vbox.chatWrite('say', 3, me, 'hello', '');
const lines = fs.readFileSync(path.join(CHAT_DIR, vbox.chatDay(Date.now()) + '.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
yes('B1 a typed command is logged as before, with no via', lines[0].kind === 'command' && lines[0].text === '/tp riverwood' && !('via' in lines[0]));
yes('B2 the lock key\'s line is still logged, as a command, with via: press', lines[1].kind === 'command' && lines[1].text === '/lock 1a2b' && lines[1].via === 'press');
yes('B3 a said line has no via', lines[2].kind === 'say' && !('via' in lines[2]));
yes('B4 every line keeps who and whether proven', lines.every((l) => l.profileId === 77 && l.proven === true));
try { fs.rmSync(CHAT_DIR, { recursive: true, force: true }); } catch (e) { }
// Since #1131 the text a command writes comes from commandLogText (the pass
// masked, a waiting menu's repeated /line left out); the press flag is passed
// on exactly as before. Since #2723 commandLogText also reads it, to leave
// the front plugin's own reports out (voice\tests\test-2723-plugin-reports.js).
yes('B5 the chat handler passes msg.press on only when it is exactly true',
    /const press = msg\.press === true;\s*const logged = commandLogText\(me, text, press\);\s*if \(logged\) chatWrite\('command', myId, me, logged, press \? 'press' : ''\);/.test(VOICE));
const lbox = {};
const reportsAt = VOICE.indexOf('const PLUGIN_REPORTS = [');
const reports = reportsAt >= 0 ? VOICE.slice(reportsAt, VOICE.indexOf('];', reportsAt) + 2) : '';
vm.runInNewContext(reports + '\n' + grab(VOICE, 'pluginReport') + '\n' + grab(VOICE, 'commandLogText') +
  '\nthis.commandLogText = commandLogText;', lbox);
yes('B6 and still masks /joinpass, and a key\'s /lock is still written', typeof lbox.commandLogText === 'function' &&
    lbox.commandLogText(me, '/joinpass jp1.abc.def') === '/joinpass [pass]' && lbox.commandLogText(me, '/lock 1a2b') === '/lock 1a2b' &&
    lbox.commandLogText(me, '/lock 1a2b', true) === '/lock 1a2b');

// C
yes('C1 the site hands via to the hub, and only the word press', /via: o\.via === 'press' \? 'press' : ''/.test(SITE));

// D
const ct = grab(HUB, 'chatText');
yes('D0 chatText is in hub.js', ct.length > 0);
const hbox = { Date }; vm.runInNewContext(ct + '\nthis.chatText = chatText;', hbox);
const out = hbox.chatText([
  { at: 0, kind: 'command', name: 'Aela', proven: true, text: '/tp riverwood' },
  { at: 0, kind: 'command', via: 'press', name: 'Aela', proven: true, text: '/lock 1a2b' }
]).split('\n');
yes('D1 a typed command still reads [command]', /\[command\]/.test(out[0]) && !/key press/.test(out[0]));
yes('D2 the lock key reads [key press], not [command]: ' + out[1].trim(), /\[key press\]/.test(out[1]) && !/\[command\]/.test(out[1]));
yes('D3 the session table labels it key press too', /l\.via === 'press' \? '<span class="pill">key press<\/span> '/.test(HUB));

// E
const lp = grab(FRONT, 'lockPress');
yes('E1 the lock key sends through tellServer', /tellServer\('\/' \+ sig\);/.test(lp));
yes('E2 and tellServer sends through say, which marks it a press, quiet', /window\.thornswoodNet\.say\(' \+\s*JSON\.stringify\(toServer\[0\]\) \+ ',\{quiet:true\}\);/.test(grab(FRONT, 'tellServer')));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
