/*
  test-3798-file-served.js

      node .\site\tests\test-3798-file-served.js

  The site's /file/ route served any name in its downloads folder. A read only
  diagnostic script put there by hand on the box, naming a staff
  member and the game server's address, went to anyone who asked for it by
  name: hidden only kept it off the Downloads page (#3798).

  Now files.json is the list of what is published. /file/ serves a name only
  when files.json lists it and does not mark it hidden, plus files.json
  itself. Anything else answers 404, and the Downloads list holds to the same
  rule, so it never offers a name that 404s.

  Since #4824 the installer is Velopack's setup program from a GitHub Release,
  not a file in the folder: /file/Thornswood-Setup.exe and
  /file/Thornswood-Dev-Setup.exe answer 302 to the Release's copy, or 404
  while there is none, and the old installer's exe and payload zip, which a
  publish left in the folder and files.json may still list, are never served
  or listed. Finding the Release is test-release-copies.js's; here
  newestSetup is a stand-in.

  The real /file/ route and listFiles are lifted out of site\server.js by text
  and run against a temp downloads folder with a stray script in it. Nothing
  is read from or written to the site's own folders.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const siteFiles = require('../../tests/site-files');

const CR = String.fromCharCode(13);
const src = siteFiles.source().split(CR).join('');
const CSP_HEADER = JSON.parse(src.match(/const CSP_HEADER = ("[^"\r\n]*");/)[1]);
// send() names it beside the CSP (#2762).
const PERMISSIONS_POLICY = src.match(/const PERMISSIONS_POLICY = '([^'\r\n]*)';/)[1];

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// From the first '{' at or after `at` to the brace that closes it.
function block(at) {
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return i + 1; }
  }
  throw new Error('unbalanced braces in site/server.js');
}
function grab(head) {
  const at = src.indexOf(head);
  return at < 0 ? '' : src.slice(at, block(at));
}
// A route inside handle(): from `first` to the end of the if block `guard`.
function route(first, guard) {
  const at = src.indexOf(first);
  if (at < 0) return '';
  const g = src.indexOf(guard, at);
  return g < 0 ? '' : src.slice(at, block(g));
}

// ---- what the lifted code expects to find around it ------------------------
const FILES = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-3798-files-'));
const JSON_AT = src.indexOf('const jsonFile = (p, fallback) => {');
yes('server.js still has jsonFile', JSON_AT >= 0);
const jsonFile = eval('(' + src.slice(src.indexOf('(', JSON_AT), block(JSON_AT)) + ')');
const servedSrc = grab('function oldInstaller(') + '\n' + grab('function downloadServed(');
yes('server.js has the one rule for what is served, downloadServed', /function downloadServed\(/.test(servedSrc));
eval(servedSrc);
eval(grab('function cspFor('));
eval(grab('function send('));
eval(grab('function rangeReply('));
// The setup programs' names, as the site has them (lib/feed.js), and a stand-in for the
// Release lookup (test-release-copies.js drives the real one).
const kindsAt = src.indexOf('const SETUP_KINDS = {');
yes('the site names the setup programs in SETUP_KINDS', kindsAt >= 0);
const SETUP_KINDS = eval('(' + src.slice(src.indexOf('{', kindsAt), block(kindsAt)) + ')');
const MAIN_SETUP = { name: 'Thornswood-Setup.exe', size: 123456789, sha256: 'c'.repeat(64), tag: 'main-build-20261101.3',
  at: 1761998400000, url: 'https://github.com/ThornswoodRP/Thornswood/releases/download/main-build-20261101.3/Thornswood-Setup.exe' };
const setupsNow = { main: MAIN_SETUP, dev: null };
function newestSetup(ch) { return setupsNow[ch] || null; }

const fileSrc = route('const dl = p.match(', "if (dl && req.method === 'GET')");
yes('the /file/ route is where this expects it', !!fileSrc);
yes('and asks downloadServed before it serves anything', /downloadServed\(dl\[1\], meta\)/.test(fileSrc));
const fileRoute = eval('(function (p, req, res, head) {\n' + fileSrc + '\n})');

const lf = grab('function listFiles(');
yes('listFiles is in server.js', !!lf);
eval(lf);

yes('/api/payload, which the old setup program asked for its payload, is gone', src.indexOf("'/api/payload'") < 0);

// ---- the folder: what a publish leaves, and a stray beside it --------------
const STRAY = 'Check-One-Machine.ps1';
const strayBody = '# Give the whole output to a staff member\n$box = "203.0.113.7"\n';
const exe = Buffer.from('the old installer\'s exe');
const zip = Buffer.from('the old installer\'s payload zip');
const notes = Buffer.from('a listed download people may take');
const hiddenNote = Buffer.from('listed, hidden, not the payload');
fs.writeFileSync(path.join(FILES, STRAY), strayBody);
fs.writeFileSync(path.join(FILES, 'Thornswood-Setup.exe'), exe);
fs.writeFileSync(path.join(FILES, 'Thornswood-Setup.zip'), zip);
fs.writeFileSync(path.join(FILES, 'Notes.txt'), notes);
fs.writeFileSync(path.join(FILES, 'Staff-Only.txt'), hiddenNote);
fs.writeFileSync(path.join(FILES, 'Thornswood-Setup-20260901-0900.zip'), Buffer.from('an unlisted older zip'));
fs.mkdirSync(path.join(FILES, 'Listed-Folder'));
const zipSha = crypto.createHash('sha256').update(zip).digest('hex');
const meta = {
  'Thornswood-Setup.exe': { label: 'Thornswood installer', version: '10-26-2026 6:24 PM' },
  'Thornswood-Setup.zip': { label: 'payload', hidden: true, sha256: zipSha.toUpperCase() },
  'Notes.txt': { label: 'Notes' },
  'Staff-Only.txt': { label: 'Staff only', hidden: true },
  'Listed-Folder': { label: 'a folder is never a download' }
};
fs.writeFileSync(path.join(FILES, 'files.json'), JSON.stringify(meta));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const head = req.method === 'HEAD';
  if (head) req.method = 'GET';
  try { fileRoute(p, req, res, head); }
  catch (e) {
    if (!res.headersSent) { res.writeHead(500); res.end(String(e && e.message)); }
    return;
  }
  if (!res.headersSent) { res.writeHead(404); res.end(); }
});

function ask(method, p) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: p,
                               method: method, agent: false }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve({ code: res.statusCode, h: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', (e) => resolve({ code: 0, h: {}, body: Buffer.alloc(0), error: e.message }));
    req.end();
  });
}
const at = (name) => '/file/' + encodeURIComponent(name);

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  // ---- the issue's done-when ---------------------------------------------
  const stray = await ask('GET', at(STRAY));
  yes('a file files.json does not list answers 404 (the stray script)', stray.code === 404);
  yes('  and not one byte of it goes out', !stray.body.toString().includes('203.0.113.7'));
  yes('  a HEAD for it is 404 too', (await ask('HEAD', at(STRAY))).code === 404);
  yes('  and so is its name in another case', (await ask('GET', at(STRAY.toUpperCase()))).code === 404);

  // Listed but hidden: what a stray would become if somebody listed it to
  // keep it off the page. Still not served.
  yes('a listed file marked hidden answers 404',
      (await ask('GET', at('Staff-Only.txt'))).code === 404);
  yes('a listed folder answers 404', (await ask('GET', at('Listed-Folder'))).code === 404);
  yes('a name with a path in it answers 404', (await ask('GET', '/file/..%2Fserver.js')).code === 404);

  // ---- the installer comes from its Release (#4824) -----------------------
  const e = await ask('GET', at('Thornswood-Setup.exe'));
  yes('the installer answers 302 to main\'s Release copy', e.code === 302 && e.h.location === MAIN_SETUP.url);
  yes('  and not one byte of the old exe in the folder goes out', !e.body.toString().includes('old installer'));
  const devNone = await ask('GET', at('Thornswood-Dev-Setup.exe'));
  yes('dev\'s answers 404 while no build Release carries one', devNone.code === 404);
  setupsNow.dev = { name: 'Thornswood-Dev-Setup.exe', size: 5, sha256: 'd'.repeat(64), tag: 'build-20261101.5', at: 1,
    url: 'https://github.com/ThornswoodRP/Thornswood/releases/download/build-20261101.5/Thornswood-Dev-Setup.exe' };
  const dev = await ask('GET', at('Thornswood-Dev-Setup.exe'));
  yes('  and 302 to the newest build Release\'s once there is one', dev.code === 302 && dev.h.location === setupsNow.dev.url);
  setupsNow.main = null;
  const mainNone = await ask('GET', at('Thornswood-Setup.exe'));
  yes('with no Release main-<tag> yet the installer answers 404, never the old exe in the folder',
      mainNone.code === 404 && !mainNone.body.equals(exe));
  setupsNow.main = MAIN_SETUP;
  const z = await ask('GET', at('Thornswood-Setup.zip'));
  yes('the old payload zip answers 404, though files.json still lists it', z.code === 404 && !z.body.equals(zip));
  yes('  and so does an older stamped one', (await ask('GET', at('Thornswood-Setup-20260901-0900.zip'))).code === 404);

  // ---- any other listed, visible download is still served -----------------
  const n = await ask('GET', at('Notes.txt'));
  yes('any other listed, visible download is served', n.code === 200 && n.body.equals(notes));
  const list = await ask('GET', at('files.json'));
  yes('files.json itself is served',
      list.code === 200 && JSON.parse(list.body.toString())['Notes.txt'].label === 'Notes');

  // ---- the Downloads list holds to the same rule --------------------------
  const by = {};
  for (const f of listFiles()) by[f.name] = f;
  yes('the Downloads list leaves the stray out entirely', !(STRAY in by));
  yes('  and the listed hidden file that is not served', !('Staff-Only.txt' in by));
  yes('  and the unlisted zip, and the folder, and files.json',
      !('Thornswood-Setup-20260901-0900.zip' in by) && !('Listed-Folder' in by) && !('files.json' in by));
  const inst = by['Thornswood-Setup.exe'];
  yes('it lists the installer from main\'s Release, shown, with GitHub\'s sha256 and size',
      !!inst && inst.hidden === false && inst.size === MAIN_SETUP.size && inst.sha256 === MAIN_SETUP.sha256 &&
      inst.version === MAIN_SETUP.tag);
  yes('  never the old payload zip', !('Thornswood-Setup.zip' in by));
  yes('  and the other listed download, shown', by['Notes.txt'] && by['Notes.txt'].hidden === false);
  yes('dev\'s setup program is not on the public list', !('Thornswood-Dev-Setup.exe' in by));
  setupsNow.main = null;
  const bare = {};
  for (const f of listFiles()) bare[f.name] = f;
  yes('with no Release main-<tag> yet it lists no installer, not the old exe in the folder',
      !('Thornswood-Setup.exe' in bare) && !!bare['Notes.txt']);

  server.close();
  try { fs.rmSync(FILES, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL  ' + (e && e.stack || e));
  process.exit(1);
});
