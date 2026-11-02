'use strict';
/*
  test-gallery.js

      node .\site\tests\test-gallery.js
      node .\site\tests\test-gallery.js <an older server.js>

  The gallery write side, end to end against a real copy of site\server.js in a
  scratch folder on a spare port. Issue #603: the launcher reads
  /api/public.gallery and /shot for the Play rotate, and the site needed a way
  for a picture to be sent in, wait in a queue, and go public only when an admin
  says so.

  What it proves:
    - a submission with no hub sign in and no launcher ticket is refused;
    - a hub member sends a picture in, and it lands in the pending queue, not on
      the public gallery, and /shot will not serve it while it waits;
    - the launcher sends one in with the same signed ticket it uses at
      /api/play/join, verified the same way: a good ticket is taken, a broken
      one is refused, and a banned account is refused;
    - only images are taken, so a .txt is refused;
    - the pending queue is staff only, and never on /api/public;
    - every staff door takes a launcher ticket for a staff account as well as
      the hub cookie (#743), and refuses a ticket for somebody who may only
      play, a broken one, and a banned one;
    - approve moves a submission onto gallery.json as { name, url, by }, is
      idempotent, and then /api/public and /shot serve it;
    - Delete clears a pending name off the queue (and an approved one off
      gallery.json) and, when asked, unlinks the upload;
    - /api/public still hands out only the approved gallery, never the queue.

  Give it an older server.js to watch it fail on the code from before #603.

  Nothing leaves the machine: the config written here has no bot token, so
  standing() asks Discord nothing and the account ids below decide. Every copy
  is under the temp folder and removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const APP = path.join(__dirname, '..', '..', 'site');
const SITE_SRC = process.argv[2] || path.join(APP, 'server.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-gallery-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const PASSWORD = crypto.randomBytes(12).toString('hex');
const ADMIN_ID = '111111111111111111';
const MEMBER_ID = '222222222222222222';
const BANNED_ID = '333333333333333333';

siteFiles.copy(dir, SITE_SRC);
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
try { fs.copyFileSync(path.join(APP, 'public', 'home.html'), path.join(dir, 'public', 'home.html')); } catch (e) { }
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
// No client id or secret, so the password door is on and the member cookie
// works; no bot token, so standing() decides from the admin list and bans.json
// alone and asks Discord nothing.
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: PASSWORD,
  discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
  botKey: crypto.randomBytes(16).toString('hex'),
  admins: [ADMIN_ID],
  secret: SECRET,
  gameCheckPort: 1,
  onlineFile: path.join(dir, 'online.json')
}, null, 2));
fs.writeFileSync(path.join(dir, 'data', 'bans.json'), JSON.stringify({ [BANNED_ID]: { why: 'test' } }));

// The cookies and ticket the site would make, built here with the copy's own
// secret and password (server.js: identity(), memberToken(), readTicket()).
const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const adminCookie = () => {
  const at = Date.now();
  const raw = ADMIN_ID + '|Admin|' + at + '|' + sign(ADMIN_ID + '|Admin|' + at);
  return 'twa=' + encodeURIComponent(raw);
};
// A Discord cookie for a play-capable account that is not on the admin list.
// With no bot token, standing() gives every non-admin play:true and
// admin/dev false, so this is the member who can submit and report but not
// approve.
const playCookie = () => {
  const at = Date.now();
  const raw = MEMBER_ID + '|Member|' + at + '|' + sign(MEMBER_ID + '|Member|' + at);
  return 'twa=' + encodeURIComponent(raw);
};
const memberCookie = () =>
  'tw=' + crypto.createHash('sha256').update('thornswood:' + PASSWORD).digest('hex');
function ticket(id, name) {
  const b = Buffer.from(JSON.stringify({ d: String(id), n: String(name || 'x'), x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + b + '.' + crypto.createHmac('sha256', SECRET).update('ticket:' + b).digest('hex').slice(0, 32);
}

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
function wait(ms) { return new Promise((ok) => setTimeout(ok, ms)); }

let PORT = 0;
// One request. body is a Buffer or undefined; headers are merged as given, so a
// raw upload sends its file as the body with the note in the query, the way the
// launcher and the hub do.
function ask(method, where, headers, body) {
  return new Promise((done) => {
    const data = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(body));
    const h = Object.assign({}, headers || {});
    if (data && h['content-length'] === undefined) h['content-length'] = data.length;
    // A browser names the page that sent a signed in write, and the site
    // refuses one that names no page (#1367). These come from its own pages.
    if (method !== 'GET' && h.origin === undefined &&
        Object.keys(h).some((k) => k.toLowerCase() === 'cookie')) h.origin = 'http://127.0.0.1:' + PORT;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: where, headers: h, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (d) => { chunks.push(d); });
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const text = raw.toString('utf8');
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

// A short but valid PNG header, enough that what /shot serves back can be
// compared to what went in byte for byte.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f0e0000000049454e44ae426082', 'hex');
// And a JPEG's opening and end, for the launcher's .jpg: since #1585 the site
// refuses (415) a file whose first bytes are not the kind its name says, so
// PNG bytes named game-shot.jpg are no longer a stand-in for a screenshot.
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', f), 'utf8')); } catch (e) { return null; } };

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: String(PORT),
      THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat')
    })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });

  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      if (out.indexOf('listening on ') >= 0) { up = true; break; }
      if (srv.exitCode !== null) break;
      await wait(50);
    }
    if (!up) throw new Error('the scratch site never came up:\n' + out);

    const upQ = (name, by, note) => '/api/gallery/submit?name=' + encodeURIComponent(name) +
      (by ? '&by=' + encodeURIComponent(by) : '') + (note ? '&note=' + encodeURIComponent(note) : '');

    // ---- no way in -----------------------------------------------------------
    let r = await ask('POST', upQ('a.png'), { 'content-type': 'image/png' }, PNG);
    yes('a submission with no hub sign in and no ticket is refused 401 why link',
        r.status === 401 && r.json && r.json.why === 'link');
    yes('and nothing was written to the pending queue', (readJson('gallery-pending.json') || []).length === 0);

    // ---- the hub member ------------------------------------------------------
    r = await ask('POST', upQ('web-shot.png', 'Djinn', 'from the hub'),
                  { 'content-type': 'image/png', cookie: memberCookie() }, PNG);
    yes('a signed in hub member can send a picture in (' + r.status + ')', r.status === 200 && r.json && r.json.ok === true);
    const webName = r.json ? r.json.name : '';
    let pend = readJson('gallery-pending.json') || [];
    const webEntry = pend.find((x) => x.name === webName);
    yes('it is on the pending queue, marked from the web, with the by and note',
        !!webEntry && webEntry.from === 'web' && webEntry.by === 'Djinn' && webEntry.note === 'from the hub' && typeof webEntry.at === 'number');
    yes('and NOT on the public gallery yet', (readJson('gallery.json') || []).length === 0);
    let pub = await ask('GET', '/api/public');
    yes('and /api/public hands out an empty gallery, never the queue',
        pub.json && Array.isArray(pub.json.gallery) && pub.json.gallery.length === 0);
    let shot = await ask('GET', '/shot/' + webName);
    yes('and /shot will not serve a picture that is only pending (' + shot.status + ')', shot.status === 404);

    // ---- several files from the site form (one POST each) --------------------
    r = await ask('POST', upQ('batch-a.png', 'Batch'),
                  { 'content-type': 'image/png', cookie: memberCookie() }, PNG);
    const batchA = r.json && r.json.name;
    const rB = await ask('POST', upQ('batch-b.png', 'Batch'),
                  { 'content-type': 'image/png', cookie: memberCookie() }, PNG);
    const batchB = rB.json && rB.json.name;
    const rC = await ask('POST', upQ('batch-c.png', 'Batch'),
                  { 'content-type': 'image/png', cookie: memberCookie() }, PNG);
    const batchC = rC.json && rC.json.name;
    pend = readJson('gallery-pending.json') || [];
    yes('multi-select batch lands each file on the pending queue',
        r.status === 200 && rB.status === 200 && rC.status === 200 &&
        !!pend.find((x) => x.name === batchA) &&
        !!pend.find((x) => x.name === batchB) &&
        !!pend.find((x) => x.name === batchC) &&
        pend.filter((x) => x.by === 'Batch').length === 3);

    // ---- the launcher ticket -------------------------------------------------
    r = await ask('POST', upQ('game-shot.jpg', 'Ataxayk') + '&ticket=' + encodeURIComponent(ticket(MEMBER_ID, 'Ataxayk')),
                  { 'content-type': 'image/jpeg' }, JPG);
    yes('the launcher can send one in with a valid ticket (' + r.status + ')', r.status === 200 && r.json && r.json.ok === true);
    const gameName = r.json ? r.json.name : '';
    pend = readJson('gallery-pending.json') || [];
    const gameEntry = pend.find((x) => x.name === gameName);
    yes('it is queued, marked from the launcher, with the sender\'s discord id kept',
        !!gameEntry && gameEntry.from === 'launcher' && gameEntry.discordId === MEMBER_ID);
    // gallery.json keeps no account once a shot is approved, because the site
    // hands it out, so the uploads note is how a deletion request finds an
    // approved picture (#2351, scripts\vps\Delete-Person.ps1).
    const gameNote = (readJson(path.join('..', 'uploads', 'uploads.json')) || {})[gameName] || {};
    yes('and the uploads note keeps the sending account too, for a deletion request', gameNote.discordId === MEMBER_ID);

    r = await ask('POST', upQ('bad.png') + '&ticket=' + encodeURIComponent('tk1.nope.nope'),
                  { 'content-type': 'image/png' }, PNG);
    yes('a broken ticket is refused 401 why link', r.status === 401 && r.json && r.json.why === 'link');
    r = await ask('POST', upQ('banned.png') + '&ticket=' + encodeURIComponent(ticket(BANNED_ID, 'Nope')),
                  { 'content-type': 'image/png' }, PNG);
    // A bans.json entry leaves inGuild false. The door asks banned first
    // (#1022), so the reason is the ban and not "not in the Discord".
    yes('a banned account is refused 403 why banned',
        r.status === 403 && r.json && r.json.why === 'banned' &&
        /banned/i.test(String(r.json.error || '')));

    // ---- only images ---------------------------------------------------------
    r = await ask('POST', upQ('notes.txt') + '&ticket=' + encodeURIComponent(ticket(MEMBER_ID, 'Ataxayk')),
                  { 'content-type': 'text/plain' }, Buffer.from('hello'));
    yes('a file that is not an image is refused 415', r.status === 415 && r.json && Array.isArray(r.json.allowed));
    yes('and refusing it added nothing to the queue', (readJson('gallery-pending.json') || []).length === 5);

    // ---- the queue is staff only (access.dev; admin list counts as staff) --
    r = await ask('GET', '/api/gallery/pending', { cookie: memberCookie() });
    yes('a password member cannot read the pending queue (' + r.status + ')', r.status === 403);
    r = await ask('GET', '/api/gallery/pending', { cookie: playCookie() });
    yes('a play-signed-in member cannot read the pending queue (' + r.status + ')', r.status === 403);
    r = await ask('GET', '/api/gallery/pending', { cookie: adminCookie() });
    yes('staff reads the pending queue, all submissions on it',
        r.status === 200 && r.json && Array.isArray(r.json.pending) && r.json.pending.length === 5);

    // ---- approve -------------------------------------------------------------
    r = await ask('POST', '/api/gallery/approve', { cookie: memberCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: webName }));
    yes('a member cannot approve (' + r.status + ')', r.status === 403);
    r = await ask('POST', '/api/gallery/approve', { cookie: playCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: webName }));
    yes('a play member cannot approve either (' + r.status + ')', r.status === 403);
    r = await ask('POST', '/api/gallery/approve', { cookie: adminCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: webName }));
    yes('staff approves the web submission (' + r.status + ')', r.status === 200 && r.json && r.json.approved === true);
    let gal = readJson('gallery.json') || [];
    const galEntry = gal.find((g) => g.name === webName);
    yes('it is now on gallery.json as { name, url: /shot/name, by }',
        !!galEntry && galEntry.url === '/shot/' + webName && galEntry.by === 'Djinn');
    pend = readJson('gallery-pending.json') || [];
    yes('and off the pending queue', !pend.find((x) => x.name === webName) && pend.length === 4);

    pub = await ask('GET', '/api/public');
    yes('/api/public now hands it out, and only it',
        pub.json && pub.json.gallery.length === 1 && pub.json.gallery[0].name === webName &&
        pub.json.gallery[0].url === '/shot/' + webName);
    shot = await ask('GET', '/shot/' + webName, { accept: '*/*' });
    yes('and /shot serves the exact bytes that were sent in',
        shot.status === 200 && shot.raw.equals(PNG));

    // Idempotent, and a "by" override.
    r = await ask('POST', '/api/gallery/approve', { cookie: adminCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: webName, by: 'Djinn (fixed)' }));
    gal = readJson('gallery.json') || [];
    yes('approving the same name again is a 200 that does not duplicate it, and can fix the by',
        r.status === 200 && gal.filter((g) => g.name === webName).length === 1 &&
        gal.find((g) => g.name === webName).by === 'Djinn (fixed)');

    // ---- delete pending (no Reject door) -------------------------------------
    r = await ask('DELETE', '/api/gallery/approved', { cookie: memberCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: gameName }));
    yes('a member cannot delete a pending shot (' + r.status + ')', r.status === 403);
    yes('the upload file for the queued submission is on disk before delete',
        fs.existsSync(path.join(dir, 'uploads', gameName)));
    r = await ask('DELETE', '/api/gallery/approved', { cookie: adminCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: gameName, deleteFile: true }));
    yes('staff deletes the launcher pending submission (' + r.status + ')',
        r.status === 200 && r.json && r.json.removed === 1 && r.json.removedPending === 1);
    pend = readJson('gallery-pending.json') || [];
    yes('it is off the queue', !pend.find((x) => x.name === gameName) && pend.length === 3);
    yes('the upload file was unlinked, because deleteFile was set',
        !fs.existsSync(path.join(dir, 'uploads', gameName)));
    gal = readJson('gallery.json') || [];
    yes('and gallery.json was not touched by deleting a pending shot', gal.length === 1 && gal[0].name === webName);

    // ---- the queue is never public ------------------------------------------
    r = await ask('POST', upQ('one-more.png') + '&ticket=' + encodeURIComponent(ticket(MEMBER_ID, 'Ataxayk')),
                  { 'content-type': 'image/png' }, PNG);
    const moreName = r.json ? r.json.name : '';
    pub = await ask('GET', '/api/public');
    yes('a fresh submission waiting in the queue is not on /api/public',
        r.status === 200 && pub.json && !pub.json.gallery.find((g) => g.name === moreName));

    // ---- play-signed-in web submit ------------------------------------------
    r = await ask('GET', '/api/gallery/who', { cookie: playCookie() });
    yes('/api/gallery/who says a play cookie can submit and is not staff',
        r.status === 200 && r.json && r.json.canSubmit === true && r.json.staff === false);
    r = await ask('GET', '/api/gallery/who', { cookie: adminCookie() });
    yes('/api/gallery/who says staff can submit and is staff',
        r.status === 200 && r.json && r.json.canSubmit === true && r.json.staff === true);
    r = await ask('POST', upQ('play-web.png', 'Member'),
                  { 'content-type': 'image/png', cookie: playCookie() }, PNG);
    yes('a play-signed-in Discord cookie can submit from the web (' + r.status + ')',
        r.status === 200 && r.json && r.json.ok === true);
    const playWebName = r.json ? r.json.name : '';

    // ---- report / list / dismiss --------------------------------------------
    r = await ask('POST', '/api/gallery/report?ticket=' + encodeURIComponent(ticket(BANNED_ID, 'Nope')),
                  { 'content-type': 'application/json' },
                  JSON.stringify({ name: webName, why: 'from a ban' }));
    yes('a banned account reporting a shot is refused 403 why banned',
        r.status === 403 && r.json && r.json.why === 'banned' &&
        /banned/i.test(String(r.json.error || '')));
    r = await ask('POST', '/api/gallery/report', { cookie: playCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: webName, why: 'looks wrong' }));
    yes('a play member can report an approved shot (' + r.status + ')',
        r.status === 200 && r.json && r.json.ok === true && r.json.id);
    const reportId = r.json ? r.json.id : '';
    yes('the shot is still on the public gallery after a report',
        (readJson('gallery.json') || []).some((g) => g.name === webName));
    r = await ask('GET', '/api/gallery/reports', { cookie: playCookie() });
    yes('a play member cannot list reports (' + r.status + ')', r.status === 403);
    r = await ask('GET', '/api/gallery/reports', { cookie: adminCookie() });
    yes('staff lists the open report',
        r.status === 200 && r.json && r.json.reports.some((x) => x.id === reportId && x.name === webName));
    r = await ask('POST', '/api/gallery/report', { 'content-type': 'application/json' },
                  JSON.stringify({ name: webName, why: 'anon' }));
    yes('a report with no sign in and no ticket is refused 401', r.status === 401);
    r = await ask('POST', '/api/gallery/report/dismiss', { cookie: playCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ id: reportId }));
    yes('a play member cannot dismiss a report (' + r.status + ')', r.status === 403);
    r = await ask('POST', '/api/gallery/report/dismiss', { cookie: adminCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ id: reportId }));
    yes('staff dismisses the report (' + r.status + ')', r.status === 200 && r.json && r.json.removed === 1);
    yes('the reports file no longer holds it',
        !(readJson('gallery-reports.json') || []).some((x) => x.id === reportId));

    // ---- delete approved (not reject) ---------------------------------------
    r = await ask('DELETE', '/api/gallery/approved', { cookie: playCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: webName }));
    yes('a play member cannot delete an approved shot (' + r.status + ')', r.status === 403);
    yes('the approved file is on disk before delete',
        fs.existsSync(path.join(dir, 'uploads', webName)));
    // Put a report back so delete clears it (and holds the file for it).
    r = await ask('POST', '/api/gallery/report', { cookie: playCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: webName, why: 'clear me' }));
    const clearId = r.json ? r.json.id : '';
    r = await ask('DELETE', '/api/gallery/approved', { cookie: adminCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: webName, deleteFile: true }));
    yes('staff deletes an approved shot (' + r.status + ')', r.status === 200 && r.json && r.json.removed === 1);
    gal = readJson('gallery.json') || [];
    yes('it is off gallery.json', !gal.find((g) => g.name === webName));
    // It had an open report, so it was taken down after a report: the file is
    // kept out of sight for 30 days for staff, then deleted (#2352, option C).
    const heldNote = (readJson(path.join('..', 'uploads', 'uploads.json')) || {})[webName] || {};
    yes('the upload file is held for the report it had, marked removed, for 30 days',
        fs.existsSync(path.join(dir, 'uploads', webName)) && r.json.heldForReport === true &&
        !!heldNote.removed && Number(heldNote.heldUntil) > Date.now() + 29 * 86400000);
    yes('reports against that name were cleared too',
        !(readJson('gallery-reports.json') || []).some((x) => x.id === clearId || x.name === webName));
    shot = await ask('GET', '/shot/' + webName);
    yes('/shot no longer serves a deleted approved shot (' + shot.status + ')', shot.status === 404);
    // pending was not the target: playWebName and moreName should still be queued
    pend = readJson('gallery-pending.json') || [];
    yes('delete-approved did not clear the pending queue',
        !!pend.find((x) => x.name === playWebName) && !!pend.find((x) => x.name === moreName));

    // ---- a launcher ticket at the staff doors (#743) -------------------------
    // The same signed ticket /api/play/join takes, in the query the way submit
    // and report already read theirs, and st.dev asked of it rather than
    // st.play: ADMIN_ID is on the admin list, so standing() makes it staff,
    // and MEMBER_ID is only allowed to play.
    const staffT = '?ticket=' + encodeURIComponent(ticket(ADMIN_ID, 'Admin'));
    const playT = '?ticket=' + encodeURIComponent(ticket(MEMBER_ID, 'Ataxayk'));
    const asJson = { 'content-type': 'application/json' };

    r = await ask('GET', '/api/gallery/pending');
    yes('no cookie and no ticket is still the 403 staff only it always was (' + r.status + ')',
        r.status === 403 && r.json && r.json.error === 'staff only');
    r = await ask('GET', '/api/gallery/pending?ticket=' + encodeURIComponent('tk1.nope.nope'));
    yes('a ticket that is not signed is the same 403 staff only (' + r.status + ')',
        r.status === 403 && r.json && r.json.error === 'staff only');
    r = await ask('GET', '/api/gallery/pending' + playT);
    yes('a ticket for somebody who may only play cannot read the queue (' + r.status + ')',
        r.status === 403 && r.json && r.json.why === 'role');
    r = await ask('GET', '/api/gallery/pending?ticket=' + encodeURIComponent(ticket(BANNED_ID, 'Nope')));
    yes('a banned account is refused at the queue too, and the reason says banned (' + r.status + ')',
        r.status === 403 && r.json && r.json.why === 'banned' &&
        /banned/i.test(String(r.json.error || '')));
    r = await ask('GET', '/api/gallery/pending' + staffT);
    yes('a staff ticket reads the pending queue (' + r.status + ')',
        r.status === 200 && r.json && Array.isArray(r.json.pending) &&
        r.json.pending.length === 5 && r.json.pending.some((x) => x.name === playWebName));

    r = await ask('POST', '/api/gallery/approve' + playT, asJson, JSON.stringify({ name: playWebName }));
    yes('a play ticket cannot approve (' + r.status + ')', r.status === 403 && r.json && r.json.why === 'role');
    r = await ask('POST', '/api/gallery/approve' + staffT, asJson, JSON.stringify({ name: playWebName, by: 'Member' }));
    yes('a staff ticket approves (' + r.status + ')', r.status === 200 && r.json && r.json.approved === true);
    gal = readJson('gallery.json') || [];
    yes('and the approved shot is on gallery.json with its url and by',
        gal.some((g) => g.name === playWebName && g.url === '/shot/' + playWebName && g.by === 'Member'));

    r = await ask('POST', '/api/gallery/report', { cookie: playCookie(), 'content-type': 'application/json' },
                  JSON.stringify({ name: playWebName, why: 'over a ticket' }));
    const ticketReport = r.json ? r.json.id : '';
    r = await ask('GET', '/api/gallery/reports' + playT);
    yes('a play ticket cannot list reports (' + r.status + ')', r.status === 403 && r.json && r.json.why === 'role');
    r = await ask('GET', '/api/gallery/reports' + staffT);
    yes('a staff ticket lists the open report',
        r.status === 200 && r.json && r.json.reports.some((x) => x.id === ticketReport));
    r = await ask('POST', '/api/gallery/report/dismiss' + staffT, asJson, JSON.stringify({ id: ticketReport }));
    yes('a staff ticket dismisses it (' + r.status + ')', r.status === 200 && r.json && r.json.removed === 1);

    r = await ask('DELETE', '/api/gallery/approved' + playT, asJson, JSON.stringify({ name: playWebName }));
    yes('a play ticket cannot delete an approved shot (' + r.status + ')',
        r.status === 403 && r.json && r.json.why === 'role');
    yes('so the shot is still on gallery.json',
        (readJson('gallery.json') || []).some((g) => g.name === playWebName));
    r = await ask('DELETE', '/api/gallery/approved' + staffT, asJson,
                  JSON.stringify({ name: playWebName, deleteFile: true }));
    yes('a staff ticket deletes it (' + r.status + ')', r.status === 200 && r.json && r.json.removed === 1);
    yes('it is off gallery.json and the file is gone',
        !(readJson('gallery.json') || []).some((g) => g.name === playWebName) &&
        !fs.existsSync(path.join(dir, 'uploads', playWebName)));

    r = await ask('DELETE', '/api/gallery/approved' + playT, asJson, JSON.stringify({ name: moreName }));
    yes('a play ticket cannot delete pending (' + r.status + ')', r.status === 403 && r.json && r.json.why === 'role');
    r = await ask('DELETE', '/api/gallery/approved' + staffT, asJson, JSON.stringify({ name: moreName }));
    yes('a staff ticket deletes pending (' + r.status + ')',
        r.status === 200 && r.json && r.json.removed === 1 && r.json.removedPending === 1);
    pend = readJson('gallery-pending.json') || [];
    yes('and the queue is down to the three batch submissions',
        pend.length === 3 && !pend.find((x) => x.name === moreName));

  } catch (e) {
    fail++;
    console.log('FAIL  the harness itself threw: ' + (e && e.stack ? e.stack : e));
  }

  await new Promise((ok) => {
    srv.on('exit', ok);
    try { srv.kill(); } catch (e) { ok(); }
    setTimeout(ok, 3000);
  });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
