'use strict';
/*
  test-3218-gallery-copies.js

      node .\site\tests\test-3218-gallery-copies.js

  A gallery picture's smaller copies (#3218, Patrick's answer B on 22 Oct
  2026: the one who sends a picture makes them, because the site cannot).
  Against a real copy of site\server.js in a scratch folder on a spare port,
  with pictures that are only their headers, since the site reads a
  picture's size off its header and never decodes one.

  What it proves:
    - only whoever sent a waiting picture, or staff, may send its copies, and
      the sender only once for each width, so a copy does not change after
      staff have seen it;
    - a copy is refused unless it is 800 or 1600 wide, a WebP or a JPEG,
      exactly the picture's shape, and narrower than the picture; a camera
      JPEG turned a quarter by its Exif is measured as it is shown;
    - staff see the copies at /up/<name>?w= while the picture waits;
    - Accept puts out only the copies the card showed, in a srcset that ends
      with the picture at its own width, and a caller naming none (a
      launcher from before this) puts it out at full size;
    - /shot/<name>?w= serves a copy the gallery names and no other, and
      /api/public and the /gallery page hand the srcset out;
    - staff can add a copy to a picture already on the gallery, and it goes
      out at once; the sender cannot;
    - deleting the picture deletes its copies;
    - the upload page, the hub and the launcher are wired to all of it.

  Nothing leaves the machine: no bot token, so standing() asks Discord
  nothing and the admin list decides who is staff.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'site');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-copies-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_ID = '111111111111111111';
const MEMBER_ID = '222222222222222222';
const OTHER_ID = '444444444444444444';

siteFiles.copy(dir);
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.copyFileSync(path.join(APP, 'public', 'home.html'), path.join(dir, 'public', 'home.html'));
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
  botKey: crypto.randomBytes(16).toString('hex'),
  admins: [ADMIN_ID],
  secret: SECRET,
  gameCheckPort: 1,
  onlineFile: path.join(dir, 'online.json')
}, null, 2));

function ticket(id) {
  const b = Buffer.from(JSON.stringify({ d: String(id), n: 'x', x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + b + '.' + crypto.createHmac('sha256', SECRET).update('ticket:' + b).digest('hex').slice(0, 32);
}
const T = (id) => 'ticket=' + encodeURIComponent(ticket(id));

// ---- pictures that are only their headers ---------------------------------
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(b, 0);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  b[24] = 8; b[25] = 6;
  return b;
}
function webpX(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii'); b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}
function webpLossy(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'ascii');
  b.write('VP8 ', 12, 'ascii'); b.writeUInt32LE(10, 16);
  Buffer.from('9d012a', 'hex').copy(b, 23);
  b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28);
  return b;
}
function webpLossless(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'ascii');
  b.write('VP8L', 12, 'ascii'); b.writeUInt32LE(10, 16);
  b[20] = 0x2f; b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  return b;
}
// A JPEG: an Exif block (orientation turn, big-endian TIFF), then a frame header.
function jpg(w, h, turn) {
  const parts = [Buffer.from('ffd8', 'hex')];
  if (turn) {
    const tiff = Buffer.alloc(8 + 2 + 12 + 4);
    tiff.write('MM', 0, 'latin1'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8);
    tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(turn, 18);
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const head = Buffer.alloc(4); head[0] = 0xff; head[1] = 0xe1; head.writeUInt16BE(body.length + 2, 2);
    parts.push(head, body);
  }
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8;
  sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7); sof[9] = 3;
  parts.push(sof, Buffer.from('ffd9', 'hex'));
  return Buffer.concat(parts);
}

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
let PORT = 0;
function ask(method, where, headers, body) {
  return new Promise((done) => {
    const data = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(body));
    const h = Object.assign({}, headers || {});
    if (data) h['content-length'] = data.length;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: where, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks), text = raw.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        done({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body: text, raw: raw, json: json });
      });
    });
    req.on('error', (e) => done({ status: 0, body: String(e), json: null }));
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    if (data) req.write(data);
    req.end();
  });
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', f), 'utf8')); } catch (e) { return null; } };
const small = (name, w, ext) => path.join(dir, 'uploads', 'small', name + '.w' + w + ext);
const submit = (id, file, bytes, type) => ask('POST', '/api/gallery/submit?' + T(id) + '&name=' + encodeURIComponent(file) + '&by=Djinn',
  { 'content-type': type }, bytes);
const copy = (id, name, w, bytes, type) => ask('POST', '/api/gallery/copy?' + (id ? T(id) + '&' : '') + 'name=' + encodeURIComponent(name) + '&w=' + w,
  { 'content-type': type }, bytes);
const approve = (name, copies) => ask('POST', '/api/gallery/approve?' + T(ADMIN_ID), { 'content-type': 'application/json' },
  JSON.stringify(copies === undefined ? { name: name } : { name: name, copies: copies }));
const pendingOf = (name) => (readJson('gallery-pending.json') || []).find((x) => x.name === name);
const shownOf = (name) => (readJson('gallery.json') || []).find((x) => x.name === name);

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  try {
    for (let i = 0; i < 100 && out.indexOf('listening on ') < 0 && srv.exitCode === null; i++) await wait(50);
    if (out.indexOf('listening on ') < 0) throw new Error('the scratch site never came up:\n' + out);

    // ---- a picture, sent from the launcher ----------------------------------
    let r = await submit(MEMBER_ID, 'Shot one.png', png(2000, 1000), 'image/png');
    yes('a picture 2000 by 1000 goes in (' + r.status + ')', r.status === 200 && r.json && r.json.ok);
    const A = r.json ? r.json.name : '';
    yes('it waits with no copies listed', !!pendingOf(A) && !(pendingOf(A).copies || []).length);

    r = await copy('', A, 800, webpX(800, 400), 'image/webp');
    yes('a copy with no sign in and no ticket is refused 401 (' + r.status + ')', r.status === 401);
    r = await copy(OTHER_ID, A, 800, webpX(800, 400), 'image/webp');
    yes('a copy from an account that did not send the picture is refused 403 (' + r.status + ')', r.status === 403);
    r = await copy(MEMBER_ID, A, 1200, webpX(1200, 600), 'image/webp');
    yes('a width that is not 800 or 1600 is refused 400 (' + r.status + ')', r.status === 400);
    r = await copy(MEMBER_ID, A, 800, Buffer.from('not a picture'), 'text/plain');
    yes('a copy that is not a WebP or a JPEG is refused 415 (' + r.status + ')', r.status === 415);
    r = await copy(MEMBER_ID, A, 800, png(800, 400), 'image/webp');
    yes('a copy whose bytes are not the kind it says is refused 415 (' + r.status + ')', r.status === 415);
    r = await copy(MEMBER_ID, A, 800, webpX(800, 450), 'image/webp');
    yes('a copy that is not the picture\'s shape is refused 422 and says both sizes (' + r.status + ')',
        r.status === 422 && /800 by 450/.test(r.json && r.json.error) && /800 by 400/.test(r.json && r.json.error));
    r = await copy(MEMBER_ID, A, 800, webpX(820, 410), 'image/webp');
    yes('a copy that is not the width it says is refused 422 (' + r.status + ')', r.status === 422);
    yes('and no refused copy is left on disk or on the queue',
        !fs.existsSync(small(A, 800, '.webp')) && !(pendingOf(A).copies || []).length &&
        fs.readdirSync(path.join(dir, 'uploads')).filter((n) => /copy/.test(n)).length === 0);

    r = await copy(MEMBER_ID, A, 800, webpX(800, 400), 'image/webp');
    yes('the sender\'s 800 copy goes in (' + r.status + ')', r.status === 200 && r.json && r.json.w === 800);
    yes('it is kept as uploads/small/<name>.w800.webp and listed on the queue',
        fs.existsSync(small(A, 800, '.webp')) && JSON.stringify(pendingOf(A).copies) === '[800]');
    r = await copy(MEMBER_ID, A, 800, webpX(800, 400), 'image/webp');
    yes('the sender cannot send that width again, so it cannot change after staff look (' + r.status + ')', r.status === 409);
    r = await copy(MEMBER_ID, A, 1600, jpg(1600, 800), 'image/jpeg');
    yes('the 1600 copy goes in as a JPEG (' + r.status + ')', r.status === 200 && fs.existsSync(small(A, 1600, '.jpg')));
    yes('and the queue lists both, narrowest first', JSON.stringify(pendingOf(A).copies) === '[800,1600]');
    r = await ask('GET', '/api/gallery/pending?' + T(ADMIN_ID));
    const listed = r.json && (r.json.pending || []).find((x) => x.name === A);
    yes('the staff queue hands the copies out', !!listed && JSON.stringify(listed.copies) === '[800,1600]');
    yes('and nothing on the queue holds an object, which the launcher\'s reader could not split',
        !/\{[^{}]*\{/.test(JSON.stringify((r.json && r.json.pending) || []).slice(1)));

    r = await ask('GET', '/up/' + encodeURIComponent(A) + '?w=800&' + T(ADMIN_ID));
    yes('staff see the 800 copy at /up/<name>?w=800 (' + r.status + ')', r.status === 200 && /image\/webp/.test(r.type));
    r = await ask('GET', '/up/' + encodeURIComponent(A) + '?w=1600&' + T(ADMIN_ID));
    yes('and the 1600 copy as a JPEG', r.status === 200 && /image\/jpeg/.test(r.type));
    r = await ask('GET', '/up/' + encodeURIComponent(A) + '?w=800&' + T(MEMBER_ID));
    yes('somebody who is not staff does not (' + r.status + ')', r.status === 403);
    r = await ask('GET', '/shot/' + encodeURIComponent(A) + '?w=800');
    yes('and no copy is public while it waits (' + r.status + ')', r.status === 404);

    // ---- Accept puts out what the card showed --------------------------------
    r = await approve(A, [800]);
    yes('Accept naming the 800 copy answers which went out', r.status === 200 && r.json && JSON.stringify(r.json.copies) === '[800]');
    let item = shownOf(A);
    const enc = '/shot/' + encodeURIComponent(A);
    yes('gallery.json names the copy and then the picture at its own width',
        !!item && item.srcset === enc + '?w=800 800w, ' + enc + ' 2000w');
    yes('and leaves out the 1600 copy the card did not show', !!item && item.srcset.indexOf('?w=1600') < 0);
    yes('and url is still the whole picture, which the launcher reads', !!item && item.url === '/shot/' + A);
    r = await ask('GET', enc + '?w=800');
    yes('/shot/<name>?w=800 serves the copy (' + r.status + ')', r.status === 200 && /image\/webp/.test(r.type) &&
        r.raw.equals(webpX(800, 400)));
    r = await ask('GET', enc + '?w=1600');
    yes('/shot/<name>?w=1600 does not, since the gallery does not name it (' + r.status + ')', r.status === 404);
    r = await ask('GET', enc + '?w=12');
    yes('nor any other width (' + r.status + ')', r.status === 404);
    r = await ask('GET', enc);
    yes('/shot/<name> is still the picture', r.status === 200 && r.raw.equals(png(2000, 1000)));
    r = await ask('GET', '/api/public');
    yes('/api/public hands the srcset out', !!(r.json && r.json.gallery.find((g) => g.name === A && g.srcset === item.srcset)));
    r = await ask('GET', '/api/gallery?offset=0&limit=24');
    yes('and so does /api/gallery', !!(r.json && r.json.gallery.find((g) => g.name === A && g.srcset === item.srcset)));
    r = await ask('GET', '/gallery', { 'user-agent': 'Googlebot' });
    yes('and the /gallery page as served names it with its sizes',
        r.body.indexOf('srcset="' + item.srcset.replace(/&/g, '&amp;') + '" sizes="(max-width: 620px) calc(100vw - 48px), 34vw"') >= 0);

    r = await copy(MEMBER_ID, A, 1600, jpg(1600, 800), 'image/jpeg');
    yes('once it is accepted the sender cannot send a copy (' + r.status + ')', r.status === 403);
    r = await copy(ADMIN_ID, A, 1600, webpLossy(1600, 800), 'image/webp');
    yes('staff can, from the hub, and it goes out at once (' + r.status + ')', r.status === 200);
    item = shownOf(A);
    yes('the srcset now names both copies', !!item && item.srcset === enc + '?w=800 800w, ' + enc + '?w=1600 1600w, ' + enc + ' 2000w');
    yes('and the staff WebP replaced the sender\'s JPEG at that width',
        fs.existsSync(small(A, 1600, '.webp')) && !fs.existsSync(small(A, 1600, '.jpg')));
    r = await ask('GET', enc + '?w=1600');
    yes('so /shot/<name>?w=1600 is the staff copy', r.status === 200 && r.raw.equals(webpLossy(1600, 800)));

    // ---- a launcher from before the copies ----------------------------------
    r = await submit(MEMBER_ID, 'old.png', png(1700, 850), 'image/png');
    const B = r.json ? r.json.name : '';
    await copy(MEMBER_ID, B, 800, webpLossless(800, 400), 'image/webp');
    yes('a lossless WebP copy is measured too', JSON.stringify((pendingOf(B) || {}).copies) === '[800]');
    r = await approve(B);
    yes('an Accept that names no copies puts the picture out at full size',
        r.status === 200 && !!shownOf(B) && !shownOf(B).srcset && JSON.stringify(r.json.copies) === '[]');
    r = await ask('GET', '/shot/' + encodeURIComponent(B) + '?w=800');
    yes('and its copy, never shown to staff, is not served (' + r.status + ')', r.status === 404);

    // ---- narrow, and turned ----------------------------------------------------
    r = await submit(MEMBER_ID, 'narrow.png', png(700, 400), 'image/png');
    const C = r.json ? r.json.name : '';
    r = await copy(MEMBER_ID, C, 800, webpX(800, 457), 'image/webp');
    yes('a picture 700 wide needs no 800 copy, and is told so (' + r.status + ')', r.status === 400 && /700 pixels wide/.test(r.json.error));
    r = await submit(MEMBER_ID, 'phone.jpg', jpg(2000, 1000, 6), 'image/jpeg');
    const D = r.json ? r.json.name : '';
    r = await copy(MEMBER_ID, D, 800, jpg(800, 400), 'image/jpeg');
    yes('a camera JPEG turned a quarter is measured as shown: 800 by 400 is refused (' + r.status + ')', r.status === 422);
    r = await copy(MEMBER_ID, D, 800, jpg(800, 1600), 'image/jpeg');
    yes('and 800 by 1600 goes in (' + r.status + ')', r.status === 200);

    // ---- deleting the picture deletes its copies ------------------------------
    r = await ask('DELETE', '/api/gallery/approved?' + T(ADMIN_ID), { 'content-type': 'application/json' }, JSON.stringify({ name: A }));
    yes('deleting the picture answers that its file went (' + r.status + ')', r.status === 200 && r.json && r.json.fileDeleted === true);
    yes('and its copies went with it',
        !fs.existsSync(small(A, 800, '.webp')) && !fs.existsSync(small(A, 1600, '.webp')) && !fs.existsSync(path.join(dir, 'uploads', A)));
    yes('the other pictures\' copies are still there', fs.existsSync(small(B, 800, '.webp')) && fs.existsSync(small(D, 800, '.jpg')));
  } catch (e) {
    fail++;
    console.log('FAIL  the harness itself threw: ' + (e && e.stack ? e.stack : e));
  }

  await new Promise((ok) => { srv.on('exit', ok); try { srv.kill(); } catch (e) { ok(); } setTimeout(ok, 3000); });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }

  // ---- the three clients -----------------------------------------------------
  const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
  const HOME_HTML = read('site', 'public', 'home.html'), HUB_HTML = read('site', 'public', 'index.html');
  const HOME = read('site', 'public', 'home.js'), HUB = read('site', 'public', 'hub.js'), COPIES = read('site', 'public', 'copies.js');
  const GALLERY = read('launcher', 'app', 'Gallery.cs'), SHELL = read('launcher', 'app', 'Shell.cs');
  yes('the front page and the hub load copies.js before their own script',
      HOME_HTML.indexOf('<script src="/copies.js"></script>') >= 0 &&
      HOME_HTML.indexOf('<script src="/copies.js">') < HOME_HTML.indexOf('<script src="/home.js">') &&
      HUB_HTML.indexOf('<script src="/copies.js"></script>') >= 0 &&
      HUB_HTML.indexOf('<script src="/copies.js">') < HUB_HTML.indexOf('<script src="/hub.js">'));
  yes('copies.js makes 800 and 1600 copies, WebP or JPEG, and posts them to /api/gallery/copy',
      /var WIDTHS = \[800, 1600\];/.test(COPIES) && /'image\/webp', 0\.8/.test(COPIES) && /'image\/jpeg', 0\.85/.test(COPIES) &&
      /'\/api\/gallery\/copy\?name=' \+ encodeURIComponent\(name\) \+ '&w=' \+ width/.test(COPIES));
  yes('the upload form sends a picture\'s copies once the site has taken it, by the name it gave',
      /return sendCopies\(sent, x\.j\.name\)/.test(HOME) && /window\.galleryCopies\.send\(file, name\)/.test(HOME));
  yes('the front page and the gallery page use the srcset',
      /img\.srcset = shots\[n\]\.srcset;/.test(HOME) && /g\.srcset \? ' srcset="' \+ esc\(g\.srcset\)/.test(HOME));
  yes('the hub shows a waiting picture\'s copies and Accept names them',
      /href \+ '\?w=' \+ n/.test(HUB) && /copies: b\.dataset\.galshown \? b\.dataset\.galshown\.split\(','\)\.map\(Number\) : \[\]/.test(HUB));
  yes('the hub makes copies for a picture that has none, from the picture on the card',
      /window\.galleryCopies\.send\(blob, b\.dataset\.galcopy\)/.test(HUB) && /Make smaller copies/.test(HUB));
  yes('the launcher sends JPEG copies to /api/gallery/copy after the picture',
      /copies = SendCopies\(data, ext, Str\(reply, "name"\)\);/.test(GALLERY) &&
      /"\/api\/gallery\/copy\?ticket="/.test(GALLERY) && /PostBytes\(url, jpg, "image\/jpeg"/.test(GALLERY) &&
      /CopyWidths = new int\[\] \{ 800, 1600 \}/.test(GALLERY));
  yes('the launcher reads the queue\'s copies, fetches them for the card, and Accept names them',
      /p\.Copies = Widths\(body, "copies"\);/.test(GALLERY) && /Gallery\.FetchCopy\(holdItem, holdWidth\)/.test(SHELL) &&
      /",\\"copies\\":\["/.test(GALLERY));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
