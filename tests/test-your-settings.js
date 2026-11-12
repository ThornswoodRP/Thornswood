// test-your-settings.js
//
// Each Discord account's settings are kept by the site (#5939), so a
// reinstall, a new game folder or another PC finds them again. Until this the
// keys, field of view, chat and needs bars in Thornswood.ini, the emote
// wheel, the scroll before the character choice, each mod menu's saved
// values and the launcher's own choices lived only on the PC.
//
// Runs site\lib\your-settings.js itself, and the /api/play/settings route
// lifted out of the site with stand-ins for the files, Discord and the reply,
// the way test-play-characters.js runs /api/play/characters. Then reads the
// launcher: YourSettings.cs puts the files in place before the game starts,
// sends them back when it closes, keeps the microphone's line on the PC, and
// asks only for names the site keeps.
//
// Read only. Nothing here touches settings.json.
const fs = require('fs');
const path = require('path');
const siteFiles = require('./site-files');
const ys = require('../site/lib/your-settings');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ---- the module ---------------------------------------------------------------

yes('the launcher\'s choices are a name the site keeps', ys.nameOk('launcher.json'));
yes('so are Thornswood.ini, the emote slots and the intro', ys.nameOk('game/Thornswood.ini') &&
    ys.nameOk('game/thornswood-emote-slots.json') && ys.nameOk('game/thornswood-intro.txt'));
yes('and a mod menu\'s file', ys.nameOk('mcm/SkyUI (SE).ini') && ys.nameOk("mcm/Someone's Mod.ini"));
yes('a screen or graphics file is not', !ys.nameOk('game/Skyrim.ini') && !ys.nameOk('game/SkyrimPrefs.ini'));
yes('nor a path out of the folder', !ys.nameOk('mcm/../launcher.json') && !ys.nameOk('mcm/a/b.ini') && !ys.nameOk('../x'));
yes('nor anything that is not text', !ys.nameOk(null) && !ys.nameOk(7));

{
  const first = ys.merge(null, { 'game/Thornswood.ini': 'a=1', 'launcher.json': '{}' });
  yes('an account with nothing kept keeps what was sent', first.files &&
      first.files['game/Thornswood.ini'] === 'a=1' && first.files['launcher.json'] === '{}');
  const second = ys.merge({ files: first.files }, { 'game/Thornswood.ini': 'a=2' });
  yes('a file sent again replaces the one kept, and the rest stay', second.files['game/Thornswood.ini'] === 'a=2' &&
      second.files['launcher.json'] === '{}');
  const third = ys.merge({ files: second.files }, { 'launcher.json': null });
  yes('null removes a file', !('launcher.json' in third.files) && third.files['game/Thornswood.ini'] === 'a=2');
  const odd = ys.merge({ files: second.files }, { 'game/Thornswood.ini': 'a=3', 'game/Skyrim.ini': 'x' });
  yes('a name the site does not keep refuses the whole of it', !!odd.why && !odd.files);
  yes('and nothing kept changed', second.files['game/Thornswood.ini'] === 'a=2');
  yes('a file that is not text is refused', !!ys.merge(null, { 'launcher.json': { a: 1 } }).why);
  yes('a file over 64 KB is refused', !!ys.merge(null, { 'launcher.json': 'x'.repeat(64 * 1024 + 1) }).why);
  yes('a file of 64 KB is kept', !!ys.merge(null, { 'launcher.json': 'x'.repeat(64 * 1024) }).files);
  const many = {};
  for (let i = 0; i < 201; i++) many['mcm/m' + i + '.ini'] = 'v';
  yes('more than 200 files are refused', !!ys.merge(null, many).why);
  const big = {};
  for (let i = 0; i < 17; i++) big['mcm/b' + i + '.ini'] = 'x'.repeat(63 * 1024);
  yes('more than 1 MB in all is refused', !!ys.merge(null, big).why);
  yes('nothing sent is refused', !!ys.merge(null, null).why && !!ys.merge(null, []).why);
}

// ---- the route ----------------------------------------------------------------

const CR = String.fromCharCode(13);
const src = siteFiles.source().split(CR).join('');
const HEAD = "  if (p === '/api/play/settings' && req.method === 'POST') {";
const at = src.indexOf(HEAD);
let route = '';
if (at >= 0) {
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { route = src.slice(at, i + 1); break; } }
  }
}
yes('the site has the /api/play/settings route', !!route);
yes('the site loads your-settings.js', siteFiles.files().indexOf('lib/your-settings.js') >= 0);
const deletion = fs.readFileSync(path.join(__dirname, '..', 'site', 'lib', 'deletion.js'), 'utf8');
yes('a deletion request removes the account\'s settings', /\[\s*'settings'\s*,\s*SETTINGS\s*,/.test(deletion));

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
async function ask(files, ticket, req, standing, writes) {
  let sent = null;
  const env = {
    p: '/api/play/settings', req: { method: 'POST' }, res: {},
    body: async function () { return JSON.stringify(Object.assign({ ticket }, req)); },
    passBodyFailure: function (e) { throw e; },
    readTicket: function (s) { return s ? { d: String(s), n: 'n' } : null; },
    standingCached: async function () { return Object.assign({ play: true, banned: false, roles: [] }, standing || {}); },
    accountBanned: function () { return 'banned'; },
    jsonFile: function (f, d) { return f in files ? clone(files[f]) : d; },
    putJson: function (f, v) { if (writes === false) return false; files[f] = clone(v); return true; },
    yourSettings: ys, SETTINGS: ys.SETTINGS,
    sendJson: function (r, c, o) { sent = { code: c, obj: o }; return sent; }
  };
  const names = Object.keys(env);
  await new AsyncFunction(names.join(','), route + '\nreturn null;').apply(null, names.map((n) => env[n]));
  return sent;
}

(async function () {
  if (route) {
    const files = {};
    const S = ys.SETTINGS;
    const none = await ask(files, 'D1', { op: 'get' });
    yes('an account with nothing kept gets no files', none.code === 200 && none.obj.ok && Object.keys(none.obj.files).length === 0);
    const put = await ask(files, 'D1', { op: 'put', files: { 'game/Thornswood.ini': '[Keys]\nChat=T' } });
    yes('sending a file keeps it', put.code === 200 && put.obj.ok && put.obj.files === 1);
    yes('under the Discord id in settings.json', files[S] && files[S].D1 &&
        files[S].D1.files['game/Thornswood.ini'] === '[Keys]\nChat=T' && files[S].D1.at > 0);
    // Another PC: nothing local, the same Discord account.
    const elsewhere = await ask(files, 'D1', { op: 'get' });
    yes('the same account on another PC gets it back', elsewhere.obj.files['game/Thornswood.ini'] === '[Keys]\nChat=T');
    const other = await ask(files, 'D2', { op: 'get' });
    yes('another account does not', Object.keys(other.obj.files).length === 0);
    const refused = await ask(files, 'D1', { op: 'put', files: { 'game/SkyrimPrefs.ini': 'x' } });
    yes('a name the site does not keep is a 400, and says why', refused.code === 400 && /not a setting/.test(refused.obj.message));
    yes('and what was kept is still kept', files[S].D1.files['game/Thornswood.ini'] === '[Keys]\nChat=T' &&
        !('game/SkyrimPrefs.ini' in files[S].D1.files));
    const odd = await ask(files, 'D1', { op: 'wipe' });
    yes('an op the site does not know is a 400', odd.code === 400);
    const noTicket = await ask(files, '', { op: 'get' });
    yes('no ticket is a 401', noTicket.code === 401);
    const banned = await ask(files, 'D1', { op: 'get' }, { banned: true });
    yes('a banned account is refused', banned.code === 403);
    const unwritten = await ask(files, 'D1', { op: 'put', files: { 'launcher.json': '{}' } }, null, false);
    yes('a settings.json the site could not write is a 503, not an ok', unwritten.code === 503 && unwritten.obj.ok === false);
  }

  // ---- the launcher -------------------------------------------------------------
  const app = path.join(__dirname, '..', 'launcher', 'app');
  const read = (n) => fs.readFileSync(path.join(app, n), 'utf8');
  const cs = read('YourSettings.cs');
  yes('YourSettings.cs asks /api/play/settings', cs.indexOf('"/api/play/settings"') >= 0);
  const names = [];
  const re = /all\["([^"]+)"\]/g;
  let m;
  while ((m = re.exec(cs))) names.push(m[1]);
  names.push('launcher.json');
  yes('every game file it sends is one the site keeps (' + names.length + ')',
      names.length >= 4 && names.every((n) => ys.nameOk(n)));
  yes('and the mod menus go as mcm/<file>', /all\["mcm\/"\s*\+\s*Path\.GetFileName\(f\)\]/.test(cs));
  yes('no screen or graphics file is among them', !/Skyrim(Prefs|Custom)?\.ini/i.test(cs.replace(/\/\/.*$/gm, '')));
  yes('the microphone\'s line stays on the PC', /MachineLines\s*=\s*\{\s*"MicrophoneName"\s*\}/.test(cs) &&
      /files\[kv\.Key\]\s*=\s*Strip\(/.test(cs));
  yes('the launcher\'s choices are sent one at a time, newest last', /static void SendPending\(\)/.test(cs) &&
      /if \(sending\) return;/.test(cs));

  const play = read('ShellPlay.cs');
  const putAt = play.indexOf('YourSettings.PutInPlace()');
  yes('Play puts the account\'s settings in place before the microphone is written', putAt >= 0 &&
      play.indexOf('Mics.Apply(cfg)') > putAt);
  const shell = read('Shell.cs');
  yes('the launcher sends them back once the game has closed', /YourSettings\.SendBack\(\)/.test(shell));
  yes('and takes its own choices from the account as it starts', /YourSettings\.TakeLauncher\(cfg,\s*\d+\)/.test(shell));
  yes('config.json\'s Save tells YourSettings, hung on as the launcher starts and before it takes the account\'s choices',
      /saved\(this\)/.test(read('Config.cs')) && /Config\.Saved\s*=\s*YourSettings\.Noted;/.test(shell) &&
      shell.indexOf('Config.Saved = YourSettings.Noted;') < shell.indexOf('YourSettings.TakeLauncher('));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
