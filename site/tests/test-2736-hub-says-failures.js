'use strict';
/*
  test-2736-hub-says-failures.js

      node .\site\tests\test-2736-hub-says-failures.js

  #2736. Two reads on the staff hub dropped their failure with an empty catch:
  refresh(), which fetches /api/all again after a ban, a note or a PK, so a
  failed fetch left staff on the old lists with nothing said; and the staff
  gallery, which read a refused answer as an empty list ("Nothing in the
  gallery yet") and left the old list up when the site did not answer at all.
  Accepting a picture ignored the site's answer, so a refused accept just
  redrew the list.

  Runs the real refresh() and loadGalleryStaff() out of site/public/hub.js
  against a stand-in fetch and page:
    A. refresh rejects on a refused answer and on no answer, and keeps S as it
       was; it fills S on a good answer;
    B. the staff action says "That was done" when only the refresh failed,
       and the site's own sentence when the action itself was refused;
    C. the gallery says it could not be read, naming the answer, for a
       refused read and for no answer, and draws the lists on a good answer;
    D. Accept shows the site's error when it refuses, and says so when the
       site does not answer.

  Nothing leaves the machine.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'site', 'public', 'hub.js'), 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0;
function yes(what, c) {
  if (c) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function slice(from, to) {
  const a = SRC.indexOf(from), b = SRC.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error('not found in hub.js: ' + from);
  return SRC.slice(a, b);
}

const REFRESH = slice('function refresh() {', 'function chrome() {');
const GALLERY = slice('function loadGalleryStaff() {', '/* -------------------------------------------------------------- report -- */');
yes('refresh and loadGalleryStaff are in hub.js', REFRESH.length > 0 && GALLERY.length > 0);
yes('no empty catch is left in either', !/catch\s*\(\s*function\s*\(\s*\)\s*\{\s*\}\s*\)/.test(REFRESH + GALLERY));

// A fetch answer: ok and status, and a body that may not be JSON.
function answer(status, body) {
  return {
    ok: status >= 200 && status < 300, status: status,
    json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body))
  };
}

function page(routes) {
  const els = {};
  const alerts = [];
  const node = (id) => (els[id] = els[id] || { id, innerHTML: '', querySelectorAll: () => [] });
  const box = {
    S: { boards: {}, boardRevs: {}, docs: { kept: 1 } },
    pending: {}, inflight: {},
    alerts,
    api: (p) => {
      const r = routes[p];
      if (!r) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(typeof r === 'function' ? r() : r);
    },
    el: (id) => (id === 'galgrid' ? node(id) : null),
    esc: (s) => String(s),
    each: () => {},
    alert: (t) => alerts.push(t),
    confirm: () => true,
    Promise, JSON, Error, TypeError, Object, String, Date,
  };
  vm.runInNewContext(REFRESH + '\n' + GALLERY, box);
  box.els = els;
  return box;
}
const settle = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  // A
  let p = page({ '/api/all': answer(401, { error: 'sign in first' }) });
  let err = null;
  await p.refresh().catch((e) => { err = e; });
  yes('A1 a refused /api/all rejects (' + (err && err.message) + ')', !!err && /401/.test(err.message));
  yes('A2 and S keeps what it had', p.S.docs.kept === 1);
  p = page({});
  err = null;
  await p.refresh().catch((e) => { err = e; });
  yes('A3 no answer rejects', !!err);
  p = page({ '/api/all': answer(200) });
  err = null;
  await p.refresh().catch((e) => { err = e; });
  yes('A4 an answer that is not JSON rejects', !!err);
  p = page({ '/api/all': answer(200, { docs: { fresh: 1 }, sessions: [1, 2] }) });
  err = null;
  await p.refresh().catch((e) => { err = e; });
  yes('A5 a good answer fills S', !err && p.S.docs.fresh === 1 && p.S.sessions.length === 2);

  // B, by reading the staff action's handler: the two cases are told apart.
  const act = slice("var said = '', taken = false;", '/* ------------------------------------------------------- play sessions -- */');
  yes('B1 the staff action marks the action taken before it refreshes',
      /taken = true;\s*return refresh\(\);/.test(act));
  yes('B2 a refresh that fails after that says it was done and the lists are old',
      /if \(taken\) \{\s*alert\('That was done, but the lists could not be fetched again/.test(act));
  yes('B3 a refused action still shows the site\'s own sentence',
      /alert\(said \|\| 'The site did not take that\.'\);/.test(act));

  // C
  p = page({ '/api/gallery/pending': answer(403, { error: 'staff only' }), '/api/public': answer(200, { gallery: [] }) });
  p.loadGalleryStaff();
  await settle();
  let html = p.els.galgrid.innerHTML;
  yes('C1 a refused read says the gallery could not be read, with the answer (' + html.replace(/<[^>]+>/g, ' ').trim() + ')',
      /could not be read/.test(html) && /403/.test(html) && /\/api\/gallery\/pending/.test(html));
  yes('C2 and does not say the gallery is empty', !/Nothing in the gallery yet/.test(html));
  p = page({ '/api/gallery/pending': answer(200, { pending: [] }) });
  p.loadGalleryStaff();
  await settle();
  html = p.els.galgrid.innerHTML;
  yes('C3 no answer says it could not be read', /could not be read/.test(html) && /Failed to fetch/.test(html));
  p = page({ '/api/gallery/pending': answer(200, { pending: [] }), '/api/public': answer(200, { gallery: [] }) });
  p.loadGalleryStaff();
  await settle();
  yes('C4 two good empty answers say the gallery is empty', /Nothing in the gallery yet/.test(p.els.galgrid.innerHTML));

  // D, the Accept handler by reading it.
  yes('D1 Accept reads the site\'s answer and shows its error',
      /\.then\(function \(a\) \{\s*if \(!a \|\| !a\.ok\) alert\(\(a && a\.error\) \|\| 'The site could not accept that picture\.'\);/.test(GALLERY));
  yes('D2 Accept says when the site does not answer',
      /The site did not answer, so that picture was not accepted\./.test(GALLERY));
  yes('D3 Delete says when the site does not answer',
      /The site did not answer, so that picture was not removed\./.test(GALLERY));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
