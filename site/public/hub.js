
/*
  One page, real addresses. Every section is its own URL, so /downloads can be
  sent to somebody and it opens the downloads page, the back button works, and
  a link inside a document can point at /help rather than "third thing on the
  left". The server hands the same file to every address and this reads the
  address and draws that section.

  Three tiers. The password gets you in; Discord makes you staff or an admin.
  The server decides which is which and simply does not send what you may not
  see, so the page only has to decide what to draw, never what to hide. Staff
  is the access.dev roles and it opens the pages the server marks 'staff',
  which is the Gallery page and the gallery doors under it (#742).
*/

/* ---------------------------------------------------------------- state -- */
var S = {
  me:{member:false,admin:false,dev:false,name:''}, titles:{}, level:{},
  docs:{}, boards:{}, results:{}, files:[], uploads:[], inbox:[], linked:[],
  sessions:[], records:{bans:{}, notes:{}, pk:{}, names:{}},
  news:{news:[]}, invite:'', at:'home', editing:false, discord:false
};

var ROUTES = {
  '/hub':'home',
  '/uploads':'uploads', '/linked':'linked', '/sessions':'sessions', '/inbox':'inbox',
  '/economy':'economy'
};
var PATHS = {};
Object.keys(ROUTES).forEach(function (u) { PATHS[ROUTES[u]] = u; });

/* The hub stopped editing the issue boards in #433, and the Known Issues
   board, the last one it edited (#2414), went in #3140: /known is written
   from the issue board now. So no page here is a board. */
var BOARDKEYS = [];
var isBoard = function (k) { return BOARDKEYS.indexOf(k) >= 0; };

var ABOUT = {
  uploads:     'Staff Accept waiting shots and Delete pending or live ones. Send and browse pictures on /gallery.',
  inbox:       'Bugs and ideas from the public report page, reports about people, and calls for help from the game.',
  linked:      'Everybody who has linked a Discord account to a copy of the game.',
  sessions:    'One card a person, newest first by when they last played. ' +
               'Open one for every session they have had, with its logs and ' +
               'what they said in it.',
  economy:     'What each hold gathers, makes and trades, counted in pieces, so a hold out of balance shows.'
};

/* Hub trimmed (#433): Gallery, Sessions, Linked Accounts, Inbox. Issue
   boards and work pages left the hub, the Known Issues board last (#3140).
   No site theme/appearance prefs. */
var GROUPS = [
  { label:'',     keys:['home'] },
  { label:'Hub',  keys:['uploads','sessions','linked','inbox','economy'] }
];

var el = function (id) { return document.getElementById(id); };
var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
};
function label(k) {
  if (k === 'home') return 'Home';
  if (k === 'uploads') return 'Gallery';
  if (k === 'inbox') return 'Inbox';
  if (k === 'linked') return 'Linked accounts';
  if (k === 'sessions') return 'Play sessions';
  if (k === 'economy') return 'Hold economy';
  return S.titles[k] || k;
}
/* The level the server sent for this page, against who the server says we are.
   'staff' is the access.dev roles (Owner, Dev, Gamemaster, Moderator,
   Loremaster), which is who the gallery doors behind /uploads let in (#742).
   The server's dev already folds admin in; admin is named here as well so the
   page does not quietly depend on that being true at the other end. */
function maySee(k) {
  if (k === 'home') return true;
  if (S.level[k] === 'admin') return !!S.me.admin;
  if (S.level[k] === 'staff') return !!(S.me.dev || S.me.admin);
  return true;
}
/* Staff of any kind: who the hub opens for at all. */
function inHub() { return !!(S.me.admin || S.me.dev); }
/* The word the server put on this page, shown beside its name so a tab says
   whether it is an admin page or a staff one rather than always saying admin. */
function levelTag(k, cls) {
  if (!S.level[k]) return '';
  return '<span class="' + cls + '">' + esc(S.level[k]) + '</span>';
}

function api(path, opts) {
  opts = opts || {};
  opts.credentials = 'same-origin';
  return fetch(path, opts);
}

function remember(k, v) {
  try {
    if (v === undefined) return localStorage.getItem('tw:' + k) || '';
    localStorage.setItem('tw:' + k, v);
  } catch (e) { return ''; }
  return v;
}

/* Markdown inside a table cell. Short things stay on one line; anything with a
   fenced block or a line break is a small document. */
function cellHtml(v) {
  var s = String(v == null ? '' : v);
  if (!s) return '';
  // breaks on, for cells only: somebody typing two lines into a box means two
  // lines, and asking them for a blank line between every one is a rule nobody
  // will remember.
  if (/```|\n/.test(s)) return '<div class="mdc">' + marked.parse(s, { breaks: true }) + '</div>';
  return '<div class="mdc">' + marked.parseInline(s) + '</div>';
}

/* ------------------------------------------------------------- sign in -- */
el('go').onclick = signIn;
el('pw').onkeydown = function (e) { if (e.key === 'Enter') signIn(); };


function signIn() {
  var pw = el('pw').value;
  el('err').textContent = '';
  api('/api/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ password: pw })
  }).then(function (r) {
    if (!r.ok) { el('err').textContent = 'Not that one.'; return; }
    start();
  }).catch(function () { el('err').textContent = 'Could not reach the server.'; });
}

/* --------------------------------------------------------------- route -- */
function keyFor(pathname) {
  var clean = String(pathname || '/').replace(/\/+$/, '').toLowerCase() || '/';
  return ROUTES[clean] || 'home';
}

function go(key, push, still) {
  if (!maySee(key)) key = 'home';
  S.at = key;
  S.editing = false;
  if (push !== false && PATHS[key]) history.pushState({}, '', PATHS[key]);
  document.title = key === 'home' ? 'Thornswood' : label(key) + ' · Thornswood';
  draw();
  var m = document.querySelector('main');
  if (m) m.scrollTop = 0;
  /* A page change is said by moving focus to the new page's heading, which
     a screen reader reads out, and which puts the next Tab at the top of the
     new page rather than back in the sidebar (#5033). Not on the first draw
     after sign in: nothing changed there, the page simply opened. */
  if (!still) {
    var h = el('page').querySelector('h1');
    if (h) h.focus();
  }
}

window.onpopstate = function () { go(keyFor(location.pathname), false); };

document.addEventListener('click', function (e) {
  var a = e.target.closest ? e.target.closest('a') : null;
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
  var href = a.getAttribute('href') || '';
  if (!/^\//.test(href) || /^\/(file|up|api|auth)\//.test(href)) return;
  var clean = href.split('?')[0].replace(/\/+$/, '').toLowerCase() || '/';
  if (!ROUTES[clean]) return;
  e.preventDefault();
  go(ROUTES[clean]);
});

/* ---------------------------------------------------------------- boot -- */
function start() {
  api('/api/all').then(function (r) {
    if (!r.ok) throw 0;
    return r.json();
  }).then(function (d) {
    S.me = d.me || S.me;
    S.titles = d.titles; S.level = d.level || {};
    S.docs = d.docs || {}; S.boards = d.boards || {}; S.boardRevs = d.boardRevs || {};
    S.results = d.results || {}; S.files = d.files || [];
    S.uploads = d.uploads || []; S.inbox = d.inbox || [];
    S.linked = d.linked || []; S.invite = d.invite || '';
    S.sessions = d.sessions || [];
    S.records = d.records || { bans: {}, notes: {} };
    S.news = d.news || { news: [] };
    el('gate').style.display = 'none';
    el('shell').style.display = 'grid';
    chrome();
    go(keyFor(location.pathname), false, true);
  }).catch(function () { el('gate').style.display = 'grid'; });
}

/* Fetches /api/all again after a staff action. A failure is the caller's to
   say: an answer that is not ok (signed out, the site down) or a body that is
   not JSON rejects, and nothing in S changes, so the page never shows stale
   lists as if they were fresh (#2736). */
function refresh() {
  return api('/api/all').then(function (r) {
    if (!r.ok) throw new Error('the site answered ' + r.status);
    return r.json();
  }).then(function (d) {
    // A board with a save waiting or on its way keeps its own copy and
    // number, or the refresh would undo the edit and the save would clash.
    var boards = d.boards || {}, revs = d.boardRevs || {};
    Object.keys(S.boards || {}).forEach(function (k) {
      if (pending[k] || inflight[k]) { boards[k] = S.boards[k]; revs[k] = (S.boardRevs || {})[k]; }
    });
    S.docs = d.docs || {}; S.boards = boards; S.boardRevs = revs;
    S.results = d.results || {}; S.files = d.files || [];
    S.uploads = d.uploads || []; S.inbox = d.inbox || [];
    S.linked = d.linked || []; S.sessions = d.sessions || [];
    S.records = d.records || { bans: {}, notes: {} };
  });
}

function chrome() {
  var out = '';
  GROUPS.forEach(function (g) {
    var keys = g.keys.map(function (u) { return ROUTES['/' + u] || u; })
                     .filter(function (k) { return maySee(k); });
    if (!keys.length) return;
    if (g.label) out += '<div class="group">' + esc(g.label) + '</div>';
    keys.forEach(function (k) {
      out += '<a class="tab" data-k="' + k + '" href="' + PATHS[k] + '">' + esc(label(k)) +
             levelTag(k, 'key') + '</a>';
    });
  });
  el('tabs').innerHTML = out;

  el('whoami').innerHTML = inHub()
    ? '<div class="me">Signed in as <b>' + esc(S.me.name || (S.me.admin ? 'admin' : 'staff')) +
      '</b><br>' + (S.me.admin ? 'admin' : 'staff') + '</div>' +
      '<button class="out" id="out">sign out</button>'
    : '<a class="discord ghost" href="/auth/discord?back=' +
      encodeURIComponent(location.pathname) + '">Sign in with Discord</a>' +
      '<button class="out" id="out">sign out</button>';
  if (S.invite) {
    el('whoami').insertAdjacentHTML('afterbegin',
      '<a class="discord compact" href="' + esc(S.invite) + '" target="_blank">' +
      'Thornswood Discord</a>');
  }
  el('out').onclick = function () {
    api('/api/logout', { method:'POST' }).then(function () { location.href = '/'; });
  };
}

/* ------------------------------------------------------------ getting in -- */
/* These two once lived inside a <style> block (before hub.css), which meant
   the browser read them as broken CSS and threw them away. drawLink and
   drawLinked did not exist at all, so clicking either tab left whatever was
   already on the screen there. */
function drawLink() {
  el('page').innerHTML = head() +
    '<div class="doc">' + marked.parse(
      'Getting into Thornswood goes through Discord. Not for the sake of ' +
      'another login: it means one list decides who is allowed in, and that ' +
      'list is the Discord server everybody is already in.\n\n' +
      '## How it works\n\n' +
      '1. Open the launcher and press **Connect Discord** on the main page.\n' +
      '2. Your browser opens, you say yes, and it closes itself.\n' +
      '3. The launcher remembers. You do not do this again.\n\n' +
      'From then on every time you press Play, the launcher checks with the ' +
      'site that your Discord account is still in the server and still allowed ' +
      'in, and only then gets what it needs to connect you.\n\n' +
      '## What that means\n\n' +
      '- The server password is not written down anywhere on your machine any ' +
      'more. Nobody can pass it on, because nobody has it.\n' +
      '- Leaving the Discord, or being banned in it, stops the next launch. ' +
      'There is no second list to remember to update.\n' +
      '- A ban is a ban everywhere at once: the game, this site, and the chat.\n\n' +
      '## If the launcher says you are not linked\n\n' +
      'Press Connect Discord again. If it says you are not in the Discord, ' +
      (S.invite ? '[join it](' + S.invite + ') and try again.'
                : 'ask somebody for an invite and try again.') + '\n\n' +
      'If it says you have no role yet, say so in the Discord and somebody ' +
      'will sort it. It takes a moment.\n\n' +
      'If it says you are banned, you know why.'
    ) + '</div>' +
    (S.invite ? '<div class="mt-22"><a class="discord" href="' +
      esc(S.invite) + '" target="_blank">Open the Thornswood Discord</a></div>' : '');
  dressCode();
}

/* ------------------------------------------------------ linked accounts -- */
function drawLinked() {
  var list = S.linked.slice().sort(function (a, b) { return (b.seen || 0) - (a.seen || 0); });
  var out = head();
  if (!list.length) {
    out += '<div class="empty">Nobody has linked a Discord account yet.</div>';
  } else {
    out += '<div class="tablewrap"><table class="board"><thead><tr>' +
      '<th>Name</th><th>Discord id</th><th>Roles</th><th>First linked</th>' +
      '<th>Last played</th></tr></thead><tbody>';
    list.forEach(function (u) {
      out += '<tr>' +
        '<td data-label="Name"><div class="cell">' + esc(u.name || u.handle || '') + '</div></td>' +
        '<td data-label="Discord id"><div class="cell"><code>' + esc(u.id) + '</code></div></td>' +
        '<td data-label="Roles"><div class="cell">' + esc((u.roles || []).join(', ')) + '</div></td>' +
        '<td data-label="First linked"><div class="cell">' +
          (u.first ? new Date(u.first).toLocaleDateString() : '') + '</div></td>' +
        '<td data-label="Last played"><div class="cell">' +
          (u.played ? new Date(u.played).toLocaleString() : 'never') + '</div></td>' +
      '</tr>' +
      '<tr class="notesrow"><td colspan="5" data-label="Notes"><div class="cell">' +
        linkedNotes(u, S.records, Date.now()) + linkedControls(u, S.records, Date.now(), !!S.me.admin) +
      '</div></td></tr>';
    });
    out += '</tbody></table></div>';
  }
  var loose = looseBans(S.records, Date.now(), S.linked);
  if (loose) out += '<h3 class="mt-22">Banned by profile</h3>' + loose;
  var dead = deadList(S.records);
  if (dead) out += '<h3 class="mt-22">Dead for good</h3>' + dead;
  out += '<p class="lede mt-20">Every staff role can do these, from here or in ' +
    'the game. <b>Ban account</b> (/banaccount) keeps every character on that account out of both ' +
    'worlds, and stops it making new ones, until it ends. <b>Ban character</b> (/ban) keeps that ' +
    'one character out and leaves the rest. <b>PK</b> (/pk) kills a character for good: it can ' +
    'never be played or picked again, it is kept here for staff, the account can make a new ' +
    'character, and nobody but its owner is told. <b>Undo PK</b> (/unpk) is for a PK made by ' +
    'mistake and only an admin can use it: the character comes back into a free slot on its ' +
    'account, or stays dead while every slot is taken, and the PK stays on its record with the ' +
    'undo beside it. Anybody banned or dead for good who is in the ' +
    'world has their session ended. The <b>Banned</b> role in Discord still works too, for good. ' +
    'Notes are for staff and nobody else sees them.</p>';
  el('page').innerHTML = out;
  wireLinked();
}

/* When a ban ends, in words. */
function banUntil(b) {
  return Number(b && b.until) > 0 ? 'until ' + new Date(Number(b.until)).toLocaleString() : 'for good';
}

/* Who did it, from where and when, in brackets after a record. */
function byLine(r) {
  return ' (by ' + esc(r.by || 'staff') + (r.from ? ', from ' + esc(r.from) : '') +
    (r.at ? ', ' + esc(new Date(Number(r.at)).toLocaleString()) : '') + ')';
}

/* A character's name, from the game server's roster or the record, or ''. */
function charName(pid, rec) {
  rec = rec || {};
  var n = (rec.names || {})[String(pid)];
  if (n) return n;
  var pk = (rec.pk || {})[String(pid)];
  if (pk && pk.name) return pk.name;
  var b = (rec.bans || {})['p:' + pid];
  return (b && b.name) || '';
}

/* One character under an account (#1010): its name and profile, and whether
   it is dead for good or banned by itself, with why, who and when. */
function charLine(pid, rec, now) {
  rec = rec || {};
  var name = charName(pid, rec);
  var out = '<div class="char">' + (name ? esc(name) : 'Unnamed character') +
    ' <span class="said">profile ' + esc(pid) + '</span> ';
  var pk = (rec.pk || {})[String(pid)];
  var b = (rec.bans || {})['p:' + pid];
  // Every earlier PK an admin undid, oldest first, then the row itself (#1010).
  var past = pk ? (pk.history || []).concat(pk.undone ? [pk] : []) : [];
  var was = past.map(function (h) {
    return '<div class="said">PK ' + esc(h.why || '') + byLine(h) + (h.undone
      ? ', undone by an admin: ' + esc(h.undone.why || '') + byLine(h.undone) : '') + '</div>';
  }).join('');
  if (pk && !pk.undone) {
    out += '<span class="pill fail">Dead for good (PK)</span> ' + esc(pk.why || '') + byLine(pk);
  } else if (b && b.active) {
    out += '<span class="pill fail">Character banned ' + esc(banUntil(b)) + '</span> ' +
      esc(b.why || '') + byLine(b);
  } else if (b) {
    out += '<span class="said">A character ban ' + esc(banUntil(b)) + ' has ended: ' + esc(b.why || '') + '</span>';
  }
  return out + was + '</div>';
}

/* The Notes line under one account (#412, #1010): the account's ban if there
   is one, each of its characters with a PK or a ban of its own, then every
   staff note, newest first, each with who wrote it and when. */
function linkedNotes(u, rec, now) {
  rec = rec || { bans: {}, notes: {} };
  var id = String(u && u.id || '');
  var b = (rec.bans || {})[id];
  var notes = (rec.notes || {})[id] || [];
  var chars = (u && u.profiles) || [];
  var out = '<div class="notes"><b>Notes</b>';
  if (b && b.active) {
    out += '<div class="ban pill fail">Account banned ' + esc(banUntil(b)) + ', every character on it: ' +
      esc(b.why || '') + byLine(b) + '</div>';
  } else if (b) {
    out += '<div class="said">An account ban ' + esc(banUntil(b)) + ' has ended: ' + esc(b.why || '') +
      ' (by ' + esc(b.by || 'staff') + ')</div>';
  }
  chars.forEach(function (pid) { out += charLine(pid, rec, now); });
  if (!notes.length && !b) out += ' <span class="said">no notes yet</span>';
  notes.forEach(function (n) {
    out += '<div class="note">' + esc(n.text || '') + ' <span class="said">(' +
      esc(n.by || 'staff') + ', ' + esc(new Date(Number(n.at) || 0).toLocaleString()) +
      (n.from ? ', ' + esc(n.from) : '') + ')</span></div>';
  });
  return out + '</div>';
}

/* How long a ban lasts, staff's choice, for good included. */
function lengthPick(key) {
  var lengths = [['30', '30 minutes'], ['120', '2 hours'], ['1440', '1 day'], ['4320', '3 days'],
                 ['10080', '1 week'], ['43200', '30 days'], ['0', 'for good']];
  return '<select class="banlen" data-id="' + key + '">' +
    lengths.map(function (l) { return '<option value="' + l[0] + '">' + l[1] + '</option>'; }).join('') +
    '</select>';
}

/* A note and the account's ban for one account, then for each of its
   characters a ban of its own and PK (#1010). A dead character offers Undo
   PK to an admin and says so to the other staff roles (29 September). */
function linkedControls(u, rec, now, admin) {
  rec = rec || {};
  var raw = String(u && u.id || '');
  var id = esc(raw);
  var b = (rec.bans || {})[raw];
  var out = '<div class="bar notesbar">' +
    '<input class="notetext" data-id="' + id + '" placeholder="A note for staff">' +
    '<button class="btn small" data-act="note" data-id="' + id + '">Add note</button>' +
    lengthPick(id) +
    '<input class="banwhy" data-id="' + id + '" placeholder="Why the account is banned">' +
    '<button class="btn small" data-act="ban" data-id="' + id + '">Ban account</button>' +
    (b && b.active ? '<button class="btn small" data-act="unban" data-id="' + id + '">Lift account ban</button>' : '') +
    '</div>';
  ((u && u.profiles) || []).forEach(function (pid) {
    var key = id + ':' + esc(pid);
    var name = charName(pid, rec) || ('profile ' + pid);
    var pk = (rec.pk || {})[String(pid)];
    var cb = (rec.bans || {})['p:' + pid];
    if (pk && !pk.undone) {
      out += '<div class="bar notesbar charbar"><span class="said">' + esc(name) + ' is dead for good.</span>' +
        (admin
          ? '<input class="unpkwhy" data-id="' + key + '" placeholder="Why the PK is undone">' +
            '<button class="btn small" data-act="unpk" data-id="' + id + '" data-pid="' + esc(pid) + '" data-name="' + esc(name) + '">Undo PK</button>'
          : ' <span class="said">Only an admin can undo a PK.</span>') +
        '</div>';
      return;
    }
    out += '<div class="bar notesbar charbar"><span class="said">' + esc(name) + '</span>' +
      lengthPick(key) +
      '<input class="banwhy" data-id="' + key + '" placeholder="Why, for a ban or a PK">' +
      '<button class="btn small" data-act="ban" data-id="' + id + '" data-pid="' + esc(pid) + '">Ban character</button>' +
      (cb && cb.active ? '<button class="btn small" data-act="unban" data-id="' + id + '" data-pid="' + esc(pid) + '">Lift character ban</button>' : '') +
      '<button class="btn small" data-act="pk" data-id="' + id + '" data-pid="' + esc(pid) + '" data-name="' + esc(name) + '">PK</button>' +
      '</div>';
  });
  return out;
}

/* Bans held against a profile no linked account holds (made in the game). */
function looseBans(rec, now, linked) {
  var bans = (rec || {}).bans || {};
  var held = {};
  (linked || []).forEach(function (u) { ((u && u.profiles) || []).forEach(function (n) { held[String(n)] = true; }); });
  var out = '';
  Object.keys(bans).forEach(function (k) {
    var b = bans[k];
    if (k.indexOf('p:') !== 0 || !b || !b.active || held[k.slice(2)]) return;
    out += '<div class="note">Profile ' + esc(k.slice(2)) + (b.name ? ' (' + esc(b.name) + ')' : '') +
      ': banned ' + esc(banUntil(b)) + ': ' + esc(b.why || '') + ' <span class="said">(by ' +
      esc(b.by || 'staff') + ')</span></div>';
  });
  return out;
}

/* Every character dead for good, newest first, so staff can find them for an event. */
function deadList(rec) {
  var pk = (rec || {}).pk || {};
  var keys = Object.keys(pk).filter(function (k) { return pk[k] && !pk[k].undone; })
    .sort(function (a, b) { return (Number(pk[b].at) || 0) - (Number(pk[a].at) || 0); });
  var out = '';
  keys.forEach(function (k) {
    var r = pk[k] || {};
    out += '<div class="note">' + esc(charName(k, rec) || 'Unnamed character') +
      ' <span class="said">profile ' + esc(k) + (r.account ? ', Discord ' + esc(r.account) : '') + '</span>: ' +
      esc(r.why || '') + ' <span class="said">' + byLine(r) + '</span></div>';
  });
  return out;
}

function wireLinked() {
  var page = el('page');
  if (!page || !page.querySelectorAll) return;
  var pick = function (cls, id) {
    var all = page.querySelectorAll('.' + cls);
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-id') === id) return all[i];
    return null;
  };
  var bs = page.querySelectorAll('button[data-act]');
  for (var i = 0; i < bs.length; i++) {
    bs[i].onclick = function () {
      var act = this.getAttribute('data-act'), id = this.getAttribute('data-id');
      var pid = this.getAttribute('data-pid') || '';
      var key = pid ? id + ':' + pid : id;
      var bodyOf = { id: id };
      if (pid) bodyOf.profileId = Number(pid);
      if (act === 'note') bodyOf.text = (pick('notetext', id) || {}).value || '';
      if (act === 'ban') {
        bodyOf.minutes = Number((pick('banlen', key) || {}).value || 0);
        bodyOf.why = (pick('banwhy', key) || {}).value || '';
        if (!bodyOf.why.trim()) { alert('Say why they are banned.'); return; }
      }
      if (act === 'pk') {
        bodyOf.why = (pick('banwhy', key) || {}).value || '';
        if (!bodyOf.why.trim()) { alert('Say why the character dies.'); return; }
        if (!confirm('PK ' + (this.getAttribute('data-name') || 'this character') + '? It dies for good and ' +
                     'can never be played again. It is kept for staff, and only an admin can undo it.')) return;
      }
      if (act === 'unpk') {
        bodyOf.why = (pick('unpkwhy', key) || {}).value || '';
        if (!bodyOf.why.trim()) { alert('Say why the PK is undone.'); return; }
        if (!confirm('Undo the PK of ' + (this.getAttribute('data-name') || 'this character') + '? It can be ' +
                     'played again from a free slot on its account. The PK stays on its record.')) return;
      }
      if (act === 'note' && !bodyOf.text.trim()) return;
      // The site's own sentence when it has one: Undo PK says why it did not.
      // taken is set once the site has done it, so a refresh that fails after
      // that says the lists are old rather than that nothing happened.
      var said = '', taken = false;
      api('/api/staff/' + act, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(bodyOf) })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            said = (j && j.message) || '';
            if (!r.ok) throw 0;
            taken = true;
            return refresh();
          });
        })
        .then(function () { drawLinked(); })
        .catch(function (e) {
          if (taken) {
            alert('That was done, but the lists could not be fetched again (' +
                  ((e && e.message) || 'no answer from the site') +
                  '), so this page still shows them as they were. Reload the page to see it.');
            return;
          }
          alert(said || 'The site did not take that.');
        });
    };
  }
}

/* ------------------------------------------------------- play sessions -- */
/*
  One row a session, as the launcher reported it: a start when the game was
  started and an end when it closed. A row with no end is somebody still
  playing, or a machine that never got the end out. That is open, not broken,
  and the page says so in those words.

  The note is the sheet part. A staff member types what was tested against the
  session it happened in, and it saves on its own.
*/
function forMins(m) {
  var n = Number(m) || 0;
  if (n < 1) return 'under a minute';
  if (n < 60) return Math.round(n) + ' min';
  var h = n / 60;
  return (h < 10 ? h.toFixed(1) : String(Math.round(h))) + ' hours';
}
function sessionAt(s) { return s.start || s.end || 0; }
/* No end means the game has not closed, or the closing word never reached the
   site. Either way the session is open and the page says open. */
function sessionOpen(s) { return !s.end; }

/*
  The week's totals, counting only the sessions that reported an end.

  A row with no end carries no minutes, so counting it raised the session and
  the people counts while the hours stayed where they were, and the three
  numbers on one screen disagreed with each other. Open rows are counted on
  their own and said separately, which is the honest shape: this is what was
  played, and this many rows never reported an end.
*/
function sessionTotals(list) {
  var week = Date.now() - 7 * 86400000;
  var n = 0, mins = 0, open = 0, who = {};
  list.forEach(function (s) {
    if (sessionAt(s) < week) return;
    if (sessionOpen(s)) { open++; return; }
    n++;
    mins += Number(s.minutes) || 0;
    if (s.who) who[s.who] = true;
  });
  return { n:n, mins:mins, open:open, people:Object.keys(who).length };
}

/*
  One entry a person, newest first by when they last played.

  Total playtime counts only the sessions that reported an end, for the same
  reason the week's totals do: a row with no end carries no minutes, and
  counting it would make the hours disagree with the session count on the same
  card. Open rows are counted separately and said separately.

  The name is taken from the newest row that carries one. The list is sorted
  newest first before this runs, so the first one wins, and somebody who
  changed their Discord name shows the name they have now rather than the one
  they had on their first session.
*/
function sessionPeople(list) {
  var by = {}, order = [];
  list.forEach(function (s) {
    var k = String(s.who || '');
    if (!k) return;
    if (!by[k]) { by[k] = { who:k, name:'', mins:0, last:0, open:0, rows:[] }; order.push(k); }
    var p = by[k];
    if (!p.name && s.name) p.name = s.name;
    if (sessionOpen(s)) p.open++; else p.mins += Number(s.minutes) || 0;
    var at = sessionAt(s);
    if (at > p.last) p.last = at;
    p.rows.push(s);
  });
  return order.map(function (k) { return by[k]; })
              .sort(function (a, b) { return b.last - a.last; });
}

/*
  One session's logs, behind a button.

  Not fetched with the page. Most sessions are never opened and a log set is
  up to a megabyte, so the page would carry tens of megabytes nobody reads.
  One request per session, when somebody asks for it.
*/
function bytesFor(n) {
  var b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

/* Straight to a file on the person's machine, made in the browser out of
   what it already has. No round trip, and it works for the server slice too,
   which was never a file anywhere. */
function downloadBlob(name, blob) {
  try {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    // Neither throws: the link was made and put in the page just above.
    setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 0);
  } catch (e) { saidNow('could not download'); }
}

function downloadText(name, text) {
  downloadBlob(name, new Blob([text], { type: 'text/plain;charset=utf-8' }));
}

/* --------------------------------------------------- download all (zip) -- */
/*
  Every file under one session in one download, asked for by Patrick on
  5 October: a crash report meant pressing Download nine times and getting
  nine loose files with the session's first eight characters in front of each.

  The zip is made here in the browser, out of the same text the page shows,
  so the site sends nothing new and a log reads the same in the zip as it does
  on the page. The files are stored, not compressed: a session's logs are
  capped at about a megabyte on the server, so compressing would save a
  moment and cost a library or an asynchronous stream on every browser.

  Inside is one folder named like the zip, so opening it does not scatter a
  dozen files across somebody's Downloads folder.
*/

/* CRC-32 as zip wants it (the IEEE polynomial, reflected). */
function crc32(bytes) {
  var table = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* A moment as the two 16-bit MS-DOS fields a zip entry carries, in the
   viewer's own time, which is what an unzipped file shows. Zip cannot say
   anything before 1980 or after 2107, and a bad time becomes now. */
function dosStamp(ms) {
  var t = new Date(Number(ms));
  if (isNaN(t.getTime())) t = new Date();
  var y = Math.min(2107, Math.max(1980, t.getFullYear()));
  return {
    time: (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate()
  };
}

/* A zip of text files, each [{ name, text }] stored as UTF-8 with its name
   marked UTF-8 (general purpose bit 11) so a name outside ASCII survives.
   Returns the bytes. */
function zipStore(files, when) {
  var enc = new TextEncoder();
  var stamp = dosStamp(when);
  var parts = [];
  var central = [];
  var offset = 0;
  files.forEach(function (f) {
    var name = enc.encode(String(f.name));
    var data = enc.encode(String(f.text == null ? '' : f.text));
    var crc = crc32(data);

    var local = new Uint8Array(30 + name.length);
    var l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);   // local file header
    l.setUint16(4, 20, true);           // version needed: 2.0
    l.setUint16(6, 0x0800, true);       // the name is UTF-8
    l.setUint16(8, 0, true);            // stored
    l.setUint16(10, stamp.time, true);
    l.setUint16(12, stamp.date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true); // compressed size
    l.setUint32(22, data.length, true); // size
    l.setUint16(26, name.length, true);
    l.setUint16(28, 0, true);           // no extra field
    local.set(name, 30);

    var cd = new Uint8Array(46 + name.length);
    var c = new DataView(cd.buffer);
    c.setUint32(0, 0x02014b50, true);   // central directory header
    c.setUint16(4, 20, true);           // made by: 2.0
    c.setUint16(6, 20, true);           // version needed: 2.0
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, stamp.time, true);
    c.setUint16(14, stamp.date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint16(30, 0, true);           // extra
    c.setUint16(32, 0, true);           // comment
    c.setUint16(34, 0, true);           // disk
    c.setUint16(36, 1, true);           // internal attributes: text
    c.setUint32(38, 0, true);           // external attributes
    c.setUint32(42, offset, true);      // where its local header is
    cd.set(name, 46);

    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  });

  var cdSize = 0;
  central.forEach(function (b) { cdSize += b.length; });
  var end = new Uint8Array(22);
  var e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);     // end of central directory
  e.setUint16(8, files.length, true);   // entries on this disk
  e.setUint16(10, files.length, true);  // entries in all
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);        // where the central directory starts

  var all = parts.concat(central, [end]);
  var total = 0;
  all.forEach(function (b) { total += b.length; });
  var out = new Uint8Array(total);
  var at = 0;
  all.forEach(function (b) { out.set(b, at); at += b.length; });
  return out;
}

/* The two files the page makes rather than receives, named the same wherever
   they are saved from. */
function serverLogName(d) {
  return 'server-' + (d && d.channel === 'dev' ? 'dev' : 'main') + '.log';
}
function chatFileName(row) {
  return 'chat-' + (row && row.profile ? row.profile : 'unknown') + '.txt';
}

/* What they said as plain text, so it reads in a text editor rather than as
   the page's markup, and still makes sense away from the page: whose, and
   when. */
function chatText(chat) {
  return (chat || []).map(function (l) {
    return new Date(l.at).toLocaleString() +
      // A key or a panel sent it, nobody typed it (#2251).
      (l.kind === 'command' ? (l.via === 'press' ? '  [key press]' : '  [command]') : '') +
      (l.proven ? '' : '  [unproven]') +
      (l.mode ? '  [' + l.mode + ']' : '') +
      '  ' + (l.name || '(no name)') + ': ' + (l.text || '');
  }).join('\n');
}

/* Every file More details shows for one session, in the order it shows them:
   the logs from that machine, the game server's lines for the window, and
   what they said. */
function sessionFiles(d, row) {
  var files = [];
  var client = (d && d.client) || {};
  Object.keys(client).forEach(function (n) {
    files.push({ name: n, text: String(client[n]) });
  });
  var srv = ((d && d.server) || []).join('\n');
  if (srv) files.push({ name: serverLogName(d), text: srv });
  var chat = (d && d.chat) || [];
  if (chat.length) files.push({ name: chatFileName(row), text: chatText(chat) });
  return files;
}

/*
  Where the logs came from, as a file of its own in the zip, because the zip
  is the thing that gets passed on and the page is not.

  The checksums are the ones the site took when the logs arrived, over the
  same text that is in the zip, so a log from this zip can be checked against
  the copy on the server later. The server lines and the chat are cut from
  the game server's and the voice service's own logs at the moment of the
  download, so they carry none.
*/
function provenanceText(sid, d) {
  if (!d || !d.sent) return '';
  var lines = [
    'Session ' + sid,
    'Sent by Discord id ' + (d.sent.who || 'unknown') + ', taken off the signed ticket, not the upload',
    'Arrived ' + (d.sent.at ? new Date(d.sent.at).toISOString() : 'at an unknown time'),
    'Size ' + bytesFor(d.sent.bytes),
    d.sent.resent
      ? 'A further set was sent ' + d.sent.resent + ' time(s) and refused. These are the first.'
      : 'No further set was sent for this session.',
    d.keep ? 'Held on the server past the year.' : 'Ages out on the server after a year unless it is held.',
    '',
    'SHA-256 of each log from that machine, as the site stored it:'
  ];
  var sums = d.sent.sha256 || {};
  Object.keys(sums).forEach(function (n) { lines.push('  ' + sums[n] + '  ' + n); });
  lines.push('');
  lines.push('The server log and the chat were cut from the game server\'s and the voice');
  lines.push('service\'s own logs when this zip was made, so they have no checksum here.');
  return lines.join('\n') + '\n';
}

/* The name the zip and its folder share: the first eight characters of the
   session id, the character, and the day the session started. */
function sessionZipStem(sid, row) {
  var ms = row ? sessionAt(row) : 0;
  var day = 'undated';
  if (ms) {
    var t = new Date(ms);
    var two = function (v) { return (v < 10 ? '0' : '') + v; };
    day = t.getFullYear() + '-' + two(t.getMonth() + 1) + '-' + two(t.getDate());
  }
  var stem = String(sid).slice(0, 8) + '-' +
    (row && row.profile ? row.profile : 'no-character') + '-' + day;
  return stem.replace(/[^A-Za-z0-9._-]/g, '-');
}

/* The Download all button: ask for the session, zip what comes back, save it. */
function downloadSessionZip(b) {
  var sid = b.dataset.s, who = b.dataset.w;
  var row = null;
  for (var i = 0; i < S.sessions.length; i++) {
    if (S.sessions[i].session === sid) { row = S.sessions[i]; break; }
  }
  var was = b.textContent;
  b.disabled = true;
  b.textContent = 'Fetching...';
  api('/api/session-logs?session=' + encodeURIComponent(sid) + '&who=' + encodeURIComponent(who))
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (d) {
      b.disabled = false;
      b.textContent = was;
      var files = sessionFiles(d, row);
      if (!files.length) { saidNow('nothing to download for that session'); return; }
      var prov = provenanceText(sid, d);
      if (prov) files.push({ name: 'provenance.txt', text: prov });
      var stem = sessionZipStem(sid, row);
      files.forEach(function (f) { f.name = stem + '/' + f.name; });
      var when = (d.sent && d.sent.at) || (row && (row.end || row.start)) || Date.now();
      downloadBlob(stem + '.zip', new Blob([zipStore(files, when)], { type: 'application/zip' }));
      saidNow('downloaded ' + files.length + ' file(s) in ' + stem + '.zip');
    })
    .catch(function (e) {
      b.disabled = false;
      b.textContent = was;
      saidNow(e === 404 ? 'the site has no record of that session' : 'could not fetch the logs');
    });
}

/* Every log kept for this session, so the download names cannot collide and
   the click handlers have something to read. Keyed by session id. */
var LOGS = {};

function logFileHtml(sid, name, text) {
  return '<details class="logf">' +
    '<summary>' +
      '<span class="chev">&#9654;</span>' +
      '<span class="nm">' + esc(name) + '</span>' +
      '<span class="sz">' + esc(bytesFor(text.length)) + '</span>' +
      '<button class="btn small dl" data-s="' + esc(sid) + '" data-n="' + esc(name) + '">Download</button>' +
    '</summary>' +
    '<pre>' + esc(text) + '</pre>' +
  '</details>';
}

/*
  What the launcher itself was unhappy about, with MORE than its own window
  shows.

  The launcher shows the sentence and a Fix button, which is the right amount
  in front of somebody who just wants to play. The Issue behind it always
  carried more: which plugin, whether the file is absent or merely the wrong
  bytes, and the size, CRC and manifest index the server expected. That detail
  is noise on the launcher and is the whole point here, where the person is
  not in the room to be asked.
*/
function issuesHtml(row) {
  var issues = row.issues || [];
  var checks = row.checks || [];
  if (!issues.length && !checks.length) return '';

  var blocking = issues.filter(function (i) { return i.blocking; }).length;
  var out = '<div class="issues"><div class="ihead">' +
    'The launcher at the end of this session: ' +
    (blocking ? blocking + ' blocker(s)' : 'no blockers') +
    (issues.length - blocking ? ', ' + (issues.length - blocking) + ' warning(s)' : '') +
    (checks.length ? ', ' + checks.length + ' check(s) not passing' : '') +
    '</div>';

  issues.forEach(function (i) {
    var d = [];
    if (i.plugin) d.push(i.plugin);
    if (i.absent) d.push('not in Data at all');
    else if (i.plugin) d.push('the file is there and the bytes are not the server\'s');
    if (i.wantSize) d.push('server wants ' + Number(i.wantSize).toLocaleString() + ' bytes');
    if (i.wantCrc) d.push('crc ' + (i.wantCrc >>> 0).toString(16));
    if (i.wantIndex) d.push('manifest index ' + i.wantIndex);
    out += '<div class="i ' + (i.blocking ? 'blk' : 'wrn') + '">' +
      '<span class="t">' + (i.blocking ? '<span class="pill fail">blocker</span> ' :
                                         '<span class="pill warn">warning</span> ') +
      esc(i.text) + '</span>' +
      (d.length ? '<span class="d">' + esc(d.join('  ')) + '</span>' : '') +
    '</div>';
  });

  checks.forEach(function (c) {
    out += '<div class="i wrn">' +
      '<span class="t"><span class="pill warn">check</span> ' + esc(c.name) + '</span>' +
      (c.detail ? '<span class="d">' + esc(c.detail) + '</span>' : '') +
    '</div>';
  });

  return out + '</div>';
}

function drawLogs(box, sid, d) {
  var out = '';

  /* The row this belongs to, for the launcher's own blockers and warnings,
     which came with the logs and live on the row rather than in the log set. */
  var row = null;
  for (var i = 0; i < S.sessions.length; i++) {
    if (S.sessions[i].session === sid) { row = S.sessions[i]; break; }
  }

  /* The line that decided the colour, first, because it is the reason
     somebody opened this. */
  if (row && row.trouble && row.troubleLine) {
    out += '<div class="issues"><div class="ihead">' +
      (row.troubleAt === 'warn' ? 'Why this session is yellow' : 'Why this session is red') +
      '</div><div class="i ' + (row.troubleAt === 'warn' ? 'wrn' : 'blk') + '">' +
      '<span class="t">' + esc(row.trouble) + '</span>' +
      '<span class="d">' + esc(row.troubleFile || '') + '</span>' +
      '<span class="d">' + esc(row.troubleLine) + '</span>' +
    '</div></div>';
  }

  /* A crash staff have looked at (#2319). The crash snapshot, when the
     person turned snapshots on, stays on their PC until this is marked (two
     at most), and their launcher deletes it at a Play after that. */
  if (row && row.troubleFile === 'crash.log') {
    out += '<div class="prov">' +
      (row.looked
        ? '<b>looked at by</b> ' + esc(row.lookedBy || 'unknown') +
          '  <b>at</b> ' + esc(row.lookedAt ? new Date(row.lookedAt).toLocaleString() : 'unknown')
        : '<b>nobody has marked this crash looked at</b>') +
      '<br><span class="said">If they have crash snapshots turned on, their launcher keeps this ' +
      'crash\'s snapshot until it is marked looked at here, two at most, and deletes it at a Play ' +
      'after that. Mark it once nobody needs the snapshot.</span>' +
      '<div class="mt-9">' +
        '<button class="btn small lookedBtn' + (row.looked ? ' on' : '') + '" ' +
          'data-s="' + esc(row.session) + '" data-w="' + esc(row.who || '') + '">' +
          (row.looked ? 'Looked at, take the mark off' : 'Mark this crash looked at') + '</button>' +
      '</div>' +
    '</div>';
  }

  if (row) out += issuesHtml(row);

  /* Where this came from, because the point of keeping it is to be able to
     say so later. A second set having been tried is worth shouting about. */
  if (d.sent) {
    /*
      WHAT KEEPING IS FOR, WHEN YOU CAN ALREADY DOWNLOAD, which is a fair
      question and the button did not answer it.

      Download gives you a copy on your own machine. That copy is a plain file:
      anybody could have edited it, and it carries nothing that says otherwise.
      Keeping holds the copy ON THE SERVER past the one year everything else
      ages out at, and that is the copy with the checksum, the Discord id taken
      off the signed ticket, and the refusal to be written over. It is the one
      worth pointing at when somebody disputes what happened.

      So: download to read it or send it to somebody. Keep so that in fourteen
      months the authoritative copy is still there to check it against.
    */
    out += '<div class="prov">' +
      '<b>sent by</b> ' + esc(d.sent.who || 'unknown') +
      '  <b>at</b> ' + esc(d.sent.at ? new Date(d.sent.at).toLocaleString() : 'unknown') +
      '  <b>size</b> ' + esc(bytesFor(d.sent.bytes)) +
      (d.sent.resent
        ? '<br><span class="warn">A further set was sent for this session ' +
          esc(d.sent.resent) + ' time(s) and refused. The first set is what is kept.</span>'
        : '') +
      '<br><span class="said">Downloading gives you a copy that anybody could ' +
      'have edited. This one carries a checksum and the id off the signed ticket, ' +
      'and cannot be written over. Everything ages out after a year unless it is held.</span>' +
      '<div class="mt-9">' +
        '<button class="btn small keepBtn' + (d.keep ? ' on' : '') + '" ' +
          'data-s="' + esc(d.session) + '" data-w="' + esc(d.sent.who || '') + '">' +
          (d.keep ? 'Held, stop holding it' : 'Hold this past the year') + '</button>' +
      '</div>' +
      '</div>';
  }

  var names = Object.keys(d.client || {});
  LOGS[sid] = {};
  names.forEach(function (n) { LOGS[sid][n] = d.client[n]; });

  if (names.length) {
    names.forEach(function (n) { out += logFileHtml(sid, n, d.client[n]); });
  } else {
    out += '<div class="none">No logs came from that machine. The launcher sends them ' +
      'as the game closes, so a session from before that was added, or one whose ' +
      'launcher never came back, has none.</div>';
  }

  var srv = (d.server || []).join('\n');
  if (srv) {
    var sn = serverLogName(d);
    LOGS[sid][sn] = srv;
    out += logFileHtml(sid, sn, srv);
  } else {
    out += '<div class="none">Nothing in the game server\'s log for that window' +
      (d.serverWhy ? ': ' + esc(d.serverWhy) : '.') + '</div>';
  }

  /*
    WHAT THEY SAID, IN THIS SESSION, here with the rest of it.

    This was a page of its own: the whole chat log, a day at a time, for
    everybody at once. Answering "what did this person do" meant reading a
    session here, working out when it ran, going to that page, picking the
    day, filtering by name, and holding the two together in your head. Patrick
    on 22 September: put it under each person, split per session. The server
    does the splitting, by profile number and this session's own window, so
    what arrives is already only this person in only this session.

    It is a details block like the log files, and it downloads like them, so
    a report is one folder of files from one place. Slash commands are kept
    and marked, because somebody typed those too and nobody else in the room
    saw them. A line marked unproven came from a connection that could not
    show a signed token for the profile it claimed: worth reading, not worth
    hanging anybody on. Voice is not recorded, only text.
  */
  var chat = d.chat || [];
  if (chat.length) {
    /* The same lines as plain text, so Download gives a readable file rather
       than the page's markup. Registered under a name that says whose and
       from when, because it lands in somebody's downloads folder beside the
       logs and has to still make sense there. */
    var cn = chatFileName(row);
    LOGS[sid][cn] = chatText(chat);

    out += '<details class="logf">' +
      '<summary>' +
        '<span class="chev">&#9654;</span>' +
        '<span class="nm">What they said</span>' +
        '<span class="sz">' + chat.length + ' line(s)</span>' +
        '<button class="btn small dl" data-s="' + esc(sid) + '" data-n="' + esc(cn) + '">Download</button>' +
      '</summary>' +
      '<div class="tablewrap"><table class="board"><thead><tr>' +
        '<th>When</th><th>Said</th></tr></thead><tbody>';
    chat.forEach(function (l) {
      out += '<tr' + (l.kind === 'command' ? ' class="warn"' : '') + '>' +
        '<td data-label="When"><div class="cell">' +
          esc(new Date(l.at).toLocaleTimeString()) +
          (l.proven ? '' : '<div class="said"><span class="pill fail">unproven</span></div>') +
        '</div></td>' +
        '<td data-label="Said"><div class="cell">' +
          (l.kind === 'command' ? (l.via === 'press' ? '<span class="pill">key press</span> ' : '<span class="pill warn">command</span> ') : '') +
          esc(l.text || '') +
          (l.mode ? '<div class="said">' + esc(l.mode) + '</div>' : '') +
        '</div></td>' +
      '</tr>';
    });
    out += '</tbody></table></div></details>';
  } else {
    out += '<div class="none">' +
      (d.chatWhy
        ? esc(d.chatWhy)
        : 'They said nothing in this session. Voice is not recorded, only text.') +
      '</div>';
  }

  box.innerHTML = out;

  each(box, 'button.dl', function (b) {
    b.onclick = function (ev) {
      /* Inside a summary, so a plain click would also toggle the details. */
      ev.preventDefault();
      ev.stopPropagation();
      var s = b.dataset.s, n = b.dataset.n;
      var text = (LOGS[s] || {})[n];
      if (text == null) { saidNow('nothing to download'); return; }
      downloadText(s.slice(0, 8) + '-' + n, text);
    };
  });

  /* Holding this one past the retention rule. Beside the provenance, because
     that is what it is about: the copy on the server outliving the year, not
     anything to do with the session itself. */
  each(box, 'button.keepBtn', function (b) {
    b.onclick = function () {
      var on = !b.classList.contains('on');
      b.disabled = true;
      saidNow('saving');
      api('/api/session-keep', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: b.dataset.s, who: b.dataset.w, keep: on })
      }).then(function (r) {
        b.disabled = false;
        saidNow(r.ok ? 'saved' : 'did not save');
        if (!r.ok) return;
        b.classList.toggle('on', on);
        b.textContent = on ? 'Held, stop holding it' : 'Hold this past the year';
        S.sessions.forEach(function (s) {
          if (s.session === b.dataset.s) s.keep = on;
        });
      }).catch(function () { b.disabled = false; saidNow('did not save'); });
    };
  });

  /* A crash looked at, or the mark taken off (#2319). */
  each(box, 'button.lookedBtn', function (b) {
    b.onclick = function () {
      var on = !b.classList.contains('on');
      b.disabled = true;
      saidNow('saving');
      api('/api/session-looked', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: b.dataset.s, who: b.dataset.w, looked: on })
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j || {} }; });
      }).then(function (a) {
        b.disabled = false;
        saidNow(a.ok ? 'saved' : (a.j.message || 'did not save'));
        if (!a.ok) return;
        S.sessions.forEach(function (s) {
          if (s.session !== b.dataset.s) return;
          s.looked = !!a.j.looked;
          s.lookedBy = a.j.lookedBy || '';
          s.lookedAt = a.j.lookedAt || 0;
        });
        drawLogs(box, sid, d);
      }).catch(function () { b.disabled = false; saidNow('did not save'); });
    };
  });
}

/* The sessions of one person, as the table this page used to be. */
function sessionTable(rows) {
  var out = '<div class="tablewrap"><table class="board"><thead><tr>' +
    '<th>Character</th><th>Build</th><th>Where</th><th>Started</th>' +
    '<th>Stopped</th><th>For</th></tr></thead><tbody>';
  rows.forEach(function (s) {
    var open = sessionOpen(s);
    /*
      One session red, never the whole card. A person who had one bad evening
      out of forty is not a red person, and colouring their card would bury
      the session that actually needs reading among thirty-nine that do not.
      The marker is set once when the logs arrive, by reading them, so nobody
      has to open anything for it to be known.
    */
    out += '<tr' + (s.trouble ? ' class="' + (s.troubleAt === 'warn' ? 'warn' : 'bad') + '"' : '') + '>' +
      '<td data-label="Character"><div class="cell">' +
        (s.trouble
          ? (s.troubleAt === 'warn'
              ? '<span class="pill warn">would not play</span>'
              : '<span class="pill fail">went wrong</span>') +
            (s.troubleFile === 'crash.log' && s.looked ? ' <span class="pill pass">looked at</span>' : '') +
            '<div class="said">' + esc(s.trouble) + '</div>'
          : '') +
        (s.profile ? '<code>' + esc(s.profile) + '</code>' : 'none picked') + '</div></td>' +
      '<td data-label="Build"><div class="cell">' + esc(s.version || 'not said') + '</div></td>' +
      /*
        Where they actually GOT TO, not which feed the launcher follows, and
        as precisely as the row allows.

        A character is picked at the game's main menu, so a session with no
        character never reached either world: it got no further than the
        launcher and the menu in front of it. Calling that "main" put a session
        on the live server that was never on it, which is exactly the kind of
        thing somebody would later be asked to account for.

        Three answers, most precise first. Reached a world: main or dev.
        Did not, but the build is known: Main Launcher or Dev Launcher. Did
        not and the build is not known either, which is a row from a launcher
        that sent no channel at all: Launcher.
      */
      '<td data-label="Where"><div class="cell">' +
        (s.profile
          ? (s.channel === 'dev'
              ? '<span class="pill left">dev</span>'
              : '<span class="pill pass">main</span>')
          : (s.channel === 'dev'
              ? '<span class="pill skip">Dev Launcher</span>' +
                '<div class="said">never picked a character, so never reached the dev world</div>'
              : s.channel === 'main'
                ? '<span class="pill skip">Main Launcher</span>' +
                  '<div class="said">never picked a character, so never reached the main world</div>'
                : '<span class="pill skip">Launcher</span>' +
                  '<div class="said">never picked a character, and the build was not reported</div>')
          ) + '</div></td>' +
      '<td data-label="Started"><div class="cell">' +
        (s.start
          ? esc(new Date(s.start).toLocaleString())
          : '<span class="pill left">start never seen</span>' +
            '<div class="said">the launcher was replaced or restarted while ' +
            'they were playing, so only the end reached us</div>') + '</div></td>' +
      '<td data-label="Stopped"><div class="cell">' +
        (open
          ? '<span class="pill left">no end reported</span>'
          : esc(new Date(s.end).toLocaleString()) +
            (s.why === 'update' ? '<div class="said">closed for an update</div>' : '')) +
        '</div></td>' +
      '<td data-label="For"><div class="cell">' +
        (open ? 'open' : esc(forMins(s.minutes))) + '</div></td>' +
    '</tr>' +
    /* The logs sit in a row of their own under the session, spanning the
       table, so the columns above stay readable and a long log does not
       stretch a cell. */
    '<tr class="morerow"><td colspan="6">' +
      '<div class="moreWrap">' +
        '<button class="btn small moreBtn" data-s="' + esc(s.session) + '" data-w="' + esc(s.who) + '">More details</button>' +
        /* Every file More details would show, in one zip, without opening
           it first. */
        '<button class="btn small zipBtn" data-s="' + esc(s.session) + '" data-w="' + esc(s.who) + '">Download all</button>' +
        /* Kept as evidence moved INSIDE More details, beside the provenance
           it belongs to. It was a second button on every row and it earned
           nothing there: it is not about this session, it is about the copy
           on the server outliving the retention rule, and that only means
           anything once somebody is reading the logs. */
        (s.keep
          ? '<span class="pill warn">held</span>' +
            (s.keptBy ? '<span class="keptBy">by ' + esc(s.keptBy) + '</span>' : '')
          : '') +
        '<div class="logs" hidden></div>' +
      '</div>' +
    '</td></tr>';
  });
  return out + '</tbody></table></div>';
}

/* The More details buttons on whatever is currently drawn. Called after every
   draw, and again each time a card is opened, because a card's table is in
   the page from the start and only hidden by details. */
function wireMore(root) {
  each(root, 'button.zipBtn', function (b) {
    if (b.dataset.wired) return;
    b.dataset.wired = '1';
    b.onclick = function () { downloadSessionZip(b); };
  });
  each(root, 'button.moreBtn', function (b) {
    if (b.dataset.wired) return;
    b.dataset.wired = '1';
    b.onclick = function () {
      var box = b.parentNode.querySelector('.logs');
      if (!box) return;
      /* Second press folds it away rather than asking again. */
      if (!box.hidden) { box.hidden = true; b.textContent = 'More details'; return; }
      if (box.dataset.got) { box.hidden = false; b.textContent = 'Hide details'; return; }

      b.disabled = true;
      b.textContent = 'Fetching...';
      api('/api/session-logs?session=' + encodeURIComponent(b.dataset.s) +
          '&who=' + encodeURIComponent(b.dataset.w))
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (d) {
          drawLogs(box, b.dataset.s, d);
          box.dataset.got = '1';
          box.hidden = false;
          b.disabled = false;
          b.textContent = 'Hide details';
        })
        .catch(function (e) {
          box.innerHTML = '<div class="none">Could not fetch the logs' +
            (e === 404 ? ': the site has no record of that session.' : '.') + '</div>';
          box.hidden = false;
          b.disabled = false;
          b.textContent = 'More details';
        });
    };
  });
}

/*
  What the page is filtered to. Held outside the draw so it survives one, and
  so a filter set at the top and a search set inside one person's card are the
  same idea rather than two.

  ONE PERSON'S SEARCH IS ITS OWN. A card search is kept per Discord id in
  `mine`, because looking through one person's forty sessions is a different
  question from looking across everybody, and typing in one should not empty
  somebody else's card.
*/
var SFIND = { q: '', show: 'all', chan: 'all', sort: 'recent', mine: {} };

/* Does this session match what is being asked for? Used by both the global
   filter and a card's own, with the card passing its own text. */
function sessionMatches(s, q, show, chan) {
  if (show === 'bad'   && s.troubleAt !== 'bad')  return false;
  if (show === 'warn'  && s.troubleAt !== 'warn') return false;
  if (show === 'any'   && !s.trouble)             return false;
  if (show === 'clean' && s.trouble)              return false;
  if (show === 'open'  && !sessionOpen(s))        return false;
  if (show === 'kept'  && !s.keep)                return false;
  if (show === 'unlooked' && !(s.troubleFile === 'crash.log' && !s.looked)) return false;

  if (chan === 'main' && !(s.profile && s.channel === 'main')) return false;
  if (chan === 'dev'  && !(s.profile && s.channel === 'dev'))  return false;
  if (chan === 'stuck' && s.profile)                           return false;

  if (q) {
    var hay = [
      s.session, s.name, s.who, s.profile, s.version, s.channel,
      s.trouble, s.troubleLine, s.troubleFile,
      s.start ? new Date(s.start).toLocaleString() : '',
      s.end ? new Date(s.end).toLocaleString() : ''
    ].join(' ').toLowerCase();
    if (hay.indexOf(q.toLowerCase()) < 0) return false;
  }
  return true;
}

function drawSessions() {
  var all = S.sessions.slice().sort(function (a, b) { return sessionAt(b) - sessionAt(a); });
  var list = all.filter(function (s) {
    return sessionMatches(s, SFIND.q, SFIND.show, SFIND.chan);
  });
  var t = sessionTotals(list);
  var people0 = sessionPeople(list);

  /*
    The controls, shaped like the questions actually asked of this page:
    who is this, what went wrong, and which build was it on. All three narrow
    the same list, and the count under them says what is being hidden so a
    filter left on is never mistaken for an empty server.
  */
  var out = head() +
    '<div class="bar bar-mb-16">' +
      '<input type="search" id="sfind" value="' + esc(SFIND.q) + '" ' +
        'placeholder="A name, an id, a character, a build, anything in a fault">' +
      '<select id="sshow" aria-label="Show">' +
        [['all','Everything'],['any','Anything that went wrong'],['bad','Crashed only'],
         ['unlooked','Crashes nobody has looked at'],['warn','Would not play only'],['clean','Nothing wrong'],['open','Never reported an end'],
         ['kept','Kept as evidence']].map(function (o) {
          return '<option value="' + o[0] + '"' + (SFIND.show === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') +
      '</select>' +
      '<select id="schan" aria-label="Where">' +
        [['all','Anywhere'],['main','Reached main'],['dev','Reached dev'],
         ['stuck','Never reached a world']].map(function (o) {
          return '<option value="' + o[0] + '"' + (SFIND.chan === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') +
      '</select>' +
      '<select id="ssort" aria-label="Sort">' +
        [['recent','Last played'],['most','Most played'],['sessions','Most sessions'],
         ['trouble','Most gone wrong'],['name','Name']].map(function (o) {
          return '<option value="' + o[0] + '"' + (SFIND.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') +
      '</select>' +
      ((SFIND.q || SFIND.show !== 'all' || SFIND.chan !== 'all' || SFIND.sort !== 'recent')
        ? '<button class="btn" id="sreset">Reset</button>' : '') +
    '</div>' +
    '<div class="tally">' +
      '<span class="pill pass">' + t.n + (t.n === 1 ? ' session' : ' sessions') +
        ' in the last seven days</span>' +
      '<span class="pill skip">' + (t.mins < 1 ? 'no time yet' : esc(forMins(t.mins)) + ' of it') + '</span>' +
      (t.open ? '<span class="pill left">' + t.open + ' with no end reported</span>' : '') +
      '<span class="pill left">' + t.people + (t.people === 1 ? ' person' : ' people') + '</span>' +
    '</div>';

  /* What is being hidden, always, because a filter left on and an empty
     server look identical and one of them is alarming. */
  if (list.length !== all.length) {
    out += '<div class="said said-show">Showing ' + list.length +
      ' of ' + all.length + ' session(s), across ' + people0.length +
      (people0.length === 1 ? ' person' : ' people') + '.</div>';
  }

  if (!all.length) {
    out += '<div class="empty">Nobody has played yet. A card lands here the ' +
      'moment somebody presses Play, and fills in when they stop.</div>';
  } else if (!list.length) {
    out += '<div class="empty">Nothing matches that. ' + all.length +
      ' session(s) are hidden by the filters above.</div>';
  } else {
    var people = people0;

    /* Most played and most gone wrong are what you want when deciding who to
       talk to; last played is what you want the rest of the time, so it is
       the default. */
    if (SFIND.sort === 'most')          people.sort(function (a, b) { return b.mins - a.mins; });
    else if (SFIND.sort === 'sessions') people.sort(function (a, b) { return b.rows.length - a.rows.length; });
    else if (SFIND.sort === 'name')     people.sort(function (a, b) { return String(a.name || a.who).localeCompare(String(b.name || b.who)); });
    else if (SFIND.sort === 'trouble')  people.sort(function (a, b) {
      var c = function (p) { return p.rows.filter(function (s) { return s.trouble; }).length; };
      return c(b) - c(a);
    });

    out += '<div class="people">';
    people.forEach(function (p) {
      /* This person's own search, so forty sessions can be narrowed without
         touching the page filter or anybody else's card. */
      var mq = SFIND.mine[p.who] || '';
      var rows = mq
        ? p.rows.filter(function (s) { return sessionMatches(s, mq, 'all', 'all'); })
        : p.rows;
      var n = p.rows.length;
      var bad = p.rows.filter(function (s) { return s.troubleAt === 'bad'; }).length;
      var warn = p.rows.filter(function (s) { return s.troubleAt === 'warn'; }).length;
      var kept = p.rows.filter(function (s) { return s.keep; }).length;

      // Opened as well when the page search leaves one person, which is
      // how a problem on the board links its session (#3155).
      out += '<details class="person"' + (mq || (SFIND.q && people.length === 1) ? ' open' : '') + '>' +
        '<summary>' +
          '<span class="pf"><span class="lab">Discord name</span>' +
            '<span class="val nm">' + esc(p.name || 'not linked') + '</span></span>' +
          '<span class="pf"><span class="lab">ID</span>' +
            '<span class="val id">' + esc(p.who) + '</span></span>' +
          '<span class="pf"><span class="lab">Total playtime</span>' +
            '<span class="val hrs">' + (p.mins < 1 ? 'none yet' : esc(forMins(p.mins))) + '</span></span>' +
          '<span class="pf"><span class="lab">Last played</span>' +
            '<span class="val when">' +
              (p.last ? esc(new Date(p.last).toLocaleString()) : 'never') + '</span></span>' +
          '<span class="chev">&#9654;</span>' +
        '</summary>' +
        '<div class="pbody">' +
          '<div class="tally tally-pad">' +
            '<span class="pill pass">' + n + (n === 1 ? ' session' : ' sessions') + '</span>' +
            (p.open ? '<span class="pill left">' + p.open + ' with no end reported</span>' : '') +
            (bad ? '<span class="pill fail">' + bad + ' went wrong</span>' : '') +
            (warn ? '<span class="pill warn">' + warn + ' would not play</span>' : '') +
            (kept ? '<span class="pill left">' + kept + ' kept as evidence</span>' : '') +
          '</div>' +
          /* Only worth a search box once there is enough to search. */
          (n > 3
            ? '<div class="bar">' +
                '<input type="search" class="findmine" data-w="' + esc(p.who) + '" ' +
                  'value="' + esc(mq) + '" placeholder="Search this person\'s ' + n + ' sessions">' +
                (mq ? '<button class="btn small clearmine" data-w="' + esc(p.who) + '">Clear</button>' : '') +
              '</div>'
            : '') +
          (rows.length
            ? sessionTable(rows)
            : '<div class="empty empty-pad">Nothing of theirs matches that.</div>') +
          (mq && rows.length !== n
            ? '<div class="said said-pad">' + rows.length + ' of ' + n + '</div>'
            : '') +
        '</div>' +
      '</details>';
    });
    out += '</div>';
  }

  out += '<p class="lede mt-20">One card a person, newest ' +
    'first by when they last played. Open one for every session they have had: ' +
    'which character, which build, and where they got to. Where reads Launcher ' +
    'when no character was ever picked, which means the session never reached ' +
    'either world. More details under a session fetches the logs from that ' +
    'machine and the game server\'s own lines for that window, and Download ' +
    'all beside it saves every one of those files in one zip. ' +
    'The launcher sends both ends of every session, so a session appears as ' +
    'somebody starts and fills in when they stop. One still open is somebody ' +
    'playing right now, or a machine that never got the closing word out. ' +
    'Total playtime counts only the sessions that reported an end. Nothing ' +
    'here is typed by the person playing.</p>';
  el('page').innerHTML = out;
  wireMore(el('page'));

  /* Redrawn on every keystroke, which is fine: this is a few hundred rows in
     memory and no request goes anywhere. The caret is put back afterwards or
     typing a second letter would jump to the start. */
  var refind = function (id, set) {
    var box = el(id);
    if (!box) return;
    box.oninput = function () {
      var at = box.selectionStart;
      set(box.value);
      drawSessions();
      var again = el(id);
      // A type="search" box takes a selection, so this does not throw.
      if (again) { again.focus(); again.setSelectionRange(at, at); }
    };
  };
  refind('sfind', function (v) { SFIND.q = v; });
  if (el('sshow')) el('sshow').onchange = function () { SFIND.show = this.value; drawSessions(); };
  if (el('schan')) el('schan').onchange = function () { SFIND.chan = this.value; drawSessions(); };
  if (el('ssort')) el('ssort').onchange = function () { SFIND.sort = this.value; drawSessions(); };
  if (el('sreset')) el('sreset').onclick = function () {
    SFIND.q = ''; SFIND.show = 'all'; SFIND.chan = 'all'; SFIND.sort = 'recent';
    drawSessions();
  };

  /* One person's own search. Same shape, kept per Discord id, and the card it
     belongs to is reopened after the redraw because a details element closes
     when its HTML is replaced. */
  each(el('page'), 'input.findmine', function (box) {
    box.oninput = function () {
      var at = box.selectionStart, who = box.dataset.w;
      SFIND.mine[who] = box.value;
      if (!box.value) delete SFIND.mine[who];
      drawSessions();
      each(el('page'), 'input.findmine', function (b2) {
        if (b2.dataset.w !== who) return;
        b2.focus();
        b2.setSelectionRange(at, at);
      });
    };
  });
  each(el('page'), 'button.clearmine', function (b) {
    b.onclick = function () { delete SFIND.mine[b.dataset.w]; drawSessions(); };
  });
}

/* -------------------------------------------------------- what was said -- */
/*
  There was a page here: the whole chat log, a day at a time, for everybody at
  once, with a day picker, a person box and a words box.

  It is gone. Answering "what did this person do" meant reading a session on
  /sessions, working out when it ran, coming here, picking the day, filtering
  by name, and holding the two together in your head. What people said now
  lives under the person who said it, inside the session they said it in, in
  More details beside that session's own logs, and it downloads with them.
  Decided by Patrick on 22 September.

  The splitting is the server's: chatSlice in site\server.js matches the
  session's profile number and its own window, and /api/session-logs hands
  the lines back with the rest of that session. drawLogs draws them.
*/

/* ---------------------------------------------------------------- draw -- */
function draw() {
  /* The open tab says so in words as well as in colour (#5033): the one
     tab carries aria-current="page", and no other does. */
  Array.prototype.forEach.call(el('tabs').querySelectorAll('a.tab'), function (a) {
    var here = a.dataset.k === S.at;
    a.className = 'tab' + (here ? ' on' : '');
    if (here) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.body.className = isBoard(S.at) ? 'wide' : '';
  if (S.at === 'home')    return drawHome();
  if (S.at === 'news')    return drawNews();
  if (S.at === 'uploads') return drawUploads();
  if (S.at === 'report')  return drawReport();
  if (S.at === 'inbox')   return drawInbox();
  if (S.at === 'link')    return drawLink();
  if (S.at === 'linked')  return drawLinked();
  if (S.at === 'sessions') return drawSessions();
  if (S.at === 'economy') return drawEconomy();
  if (isBoard(S.at))      return drawBoard();
  if (S.editing)          return drawEdit();
  drawDoc();
}

function crumb() {
  return '<div class="crumb"><a href="/hub">Thornswood</a> / ' + esc(label(S.at)) +
         ' <span class="float-right"><a href="/">the public site</a></span></div>';
}
/* Every page's one top heading (#5033). It was an h2 under no h1, so only
   Home had a top heading. tabindex -1 lets go() put focus on it at a page
   change without adding a stop to the Tab order. */
function head(extra, noLede) {
  return crumb() +
    '<div class="bar"><h1 tabindex="-1">' + esc(label(S.at)) +
    ' ' + levelTag(S.at, 'tagline') + '</h1>' +
    '<span class="said" id="said"></span>' + (extra || '') + '</div>' +
    (ABOUT[S.at] && !noLede ? '<p class="lede">' + esc(ABOUT[S.at]) + '</p>' : '');
}
function saidNow(t) {
  var s = el('said');
  if (!s) return;
  s.textContent = t;
  if (t === 'saved') setTimeout(function () { if (el('said') === s) s.textContent = ''; }, 1600);
}

/* ------------------------------------------------------------- economy -- */
/*
  WHAT EACH HOLD GATHERS, MAKES AND TRADES (#3164). Patrick, 22 Oct: staff's
  hold economy view is a staff page on the hub. Each game server counts the
  pieces gathered, crafted, bought from and sold to the hold's traders, and
  the hauls between holds, by the day and the hold, and sends them here every
  five minutes; GET /api/economy hands them to staff. Items have no gold
  price on this server, so it is pieces, never value.

  Shaped like the question asked of it, which hold is out of step: the table
  is one row a hold, each count beside its share of every hold's, and a card
  a hold under it with what was counted. The item box narrows all of it to
  one good, so "where does the iron ore come from" is one word typed.

  Fetched when the page opens rather than with /api/all: thirty days of
  counts is the biggest answer the hub reads, and most visits never open it.
*/
var EFIND = { srv: 'main', span: '7', q: '' };
var ECON = null;
var ECON_HOLDS = [
  ['whiterun', 'Whiterun'], ['solitude', 'Haafingar (Solitude)'], ['riften', 'The Rift (Riften)'],
  ['markarth', 'The Reach (Markarth)'], ['windhelm', 'Eastmarch (Windhelm)'], ['falkreath', 'Falkreath'],
  ['morthal', 'Hjaalmarch (Morthal)'], ['dawnstar', 'The Pale (Dawnstar)'], ['winterhold', 'Winterhold'],
  ['ravenrock', 'Solstheim (Raven Rock)'], ['elsewhere', 'No hold']
];
var ECON_KINDS = [
  ['gathered', 'Gathered'], ['crafted', 'Crafted'], ['bought', 'Bought from traders'],
  ['sold', 'Sold to traders'], ['hauled', 'Hauls out'], ['hauledIn', 'Hauls in']
];
function econHoldName(h) {
  for (var i = 0; i < ECON_HOLDS.length; i++) if (ECON_HOLDS[i][0] === h) return ECON_HOLDS[i][1];
  return h;
}

/* The days the span covers, counted back from the server's own today. */
function econDays(srv, span) {
  var today = srv.today || '';
  var days = Object.keys(srv.days || {}).sort();
  if (!today) today = days.length ? days[days.length - 1] : '';
  if (!today) return [];
  var n = Number(span) || 1;
  var t = Date.parse(today + 'T12:00:00Z');
  var want = {};
  for (var i = 0; i < n; i++) want[new Date(t - i * 86400000).toISOString().slice(0, 10)] = true;
  return days.filter(function (d) { return want[d]; });
}

/*
  The counts of one server over some days, added up: per hold, per kind, per
  item key. Hauls are counted where they left; Hauls in is the same hauls read
  from the other end, keyed by the hold they came from.
*/
function econSum(srv, days, q) {
  var out = {};
  ECON_HOLDS.forEach(function (h) { out[h[0]] = {}; });
  var names = srv.names || {};
  var match = function (kind, key) {
    if (!q) return true;
    var shown = kind === 'hauled' ? econHoldName(key) : (names[key] || key);
    return String(shown).toLowerCase().indexOf(q) >= 0;
  };
  days.forEach(function (d) {
    var holds = srv.days[d] || {};
    Object.keys(holds).forEach(function (h) {
      if (!out[h]) return;
      ECON_KINDS.forEach(function (k) {
        var items = (holds[h] || {})[k[0]];
        if (!items) return;
        Object.keys(items).forEach(function (key) {
          if (!match(k[0], key)) return;
          var n = Number(items[key]) || 0;
          var row = out[h][k[0]] = out[h][k[0]] || {};
          row[key] = (row[key] || 0) + n;
          if (k[0] === 'hauled' && out[key]) {
            var back = out[key].hauledIn = out[key].hauledIn || {};
            back[h] = (back[h] || 0) + n;
          }
        });
      });
    });
  });
  return out;
}
function econTotal(items) {
  var n = 0;
  Object.keys(items || {}).forEach(function (k) { n += items[k]; });
  return n;
}

function loadEconomy() {
  ECON = { loading: true };
  api('/api/economy').then(function (r) {
    if (!r.ok) throw new Error('the site answered ' + r.status);
    return r.json();
  }).then(function (d) {
    ECON = { servers: (d && d.servers) || {}, keepDays: (d && d.keepDays) || 30 };
    if (S.at === 'economy') drawEconomy();
  }).catch(function (e) {
    // Said in the page, never shown as an empty economy (#2736).
    ECON = { failed: String((e && e.message) || e) };
    if (S.at === 'economy') drawEconomy();
  });
}

function drawEconomy() {
  if (!ECON) loadEconomy();
  var out = head('<button class="btn" id="ereload">Read again</button>') +
    '<div class="bar bar-mb-16">' +
      '<select id="esrv" aria-label="Server">' +
        [['main', 'Main server'], ['dev', 'Dev server']].map(function (o) {
          return '<option value="' + o[0] + '"' + (EFIND.srv === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') +
      '</select>' +
      '<select id="espan" aria-label="Days">' +
        [['1', 'Today'], ['7', 'The last 7 days'], ['30', 'The last 30 days']].map(function (o) {
          return '<option value="' + o[0] + '"' + (EFIND.span === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') +
      '</select>' +
      '<input type="search" id="efind" value="' + esc(EFIND.q) + '" placeholder="One good, or a hold for hauls: iron ore, wheat, Riften">' +
    '</div>';

  if (!ECON || ECON.loading) {
    el('page').innerHTML = out + '<div class="empty">Reading the counts.</div>';
    return wireEconomy();
  }
  if (ECON.failed) {
    el('page').innerHTML = out + '<div class="empty">The counts could not be read: ' + esc(ECON.failed) +
      '. Read again, or reload the page if you were signed out.</div>';
    return wireEconomy();
  }
  var srv = ECON.servers[EFIND.srv];
  if (!srv || !Object.keys(srv.days || {}).length) {
    el('page').innerHTML = out + '<div class="empty">Nothing counted on the ' +
      (EFIND.srv === 'dev' ? 'dev' : 'main') + ' server yet. Its game server sends what it has ' +
      'counted every five minutes once something is gathered, made or traded.</div>';
    return wireEconomy();
  }

  var q = EFIND.q.trim().toLowerCase();
  var days = econDays(srv, EFIND.span);
  var sum = econSum(srv, days, q);
  var all = {};
  ECON_KINDS.forEach(function (k) {
    all[k[0]] = 0;
    ECON_HOLDS.forEach(function (h) { all[k[0]] += econTotal(sum[h[0]][k[0]]); });
  });
  var at = srv.at ? new Date(srv.at).toLocaleString() : 'never';
  out += '<div class="said said-show">Counted on the game server by the day it was done, ' +
    days.length + (days.length === 1 ? ' day' : ' days') + ' with counts in this span. ' +
    'Last sent ' + esc(at) + '. Kept ' + esc(String(ECON.keepDays)) + ' days.</div>';

  /* One row a hold. Each count has its share of every hold's beside it,
     which is the number that says one hold is doing all of it. */
  out += '<div class="tablewrap"><table class="board econ"><thead><tr><th>Hold</th>' +
    ECON_KINDS.map(function (k) { return '<th class="num">' + esc(k[1]) + '</th>'; }).join('') +
    '</tr></thead><tbody>';
  ECON_HOLDS.forEach(function (h) {
    var row = sum[h[0]];
    var any = ECON_KINDS.some(function (k) { return econTotal(row[k[0]]) > 0; });
    if (h[0] === 'elsewhere' && !any) return;
    out += '<tr><td data-label="Hold"><div class="cell">' + esc(h[1]) + '</div></td>' +
      ECON_KINDS.map(function (k) {
        var n = econTotal(row[k[0]]);
        var share = all[k[0]] ? Math.round(n * 100 / all[k[0]]) : 0;
        return '<td class="num" data-label="' + esc(k[1]) + '"><div class="cell">' + n +
          (n ? ' <span class="share">' + share + '%</span>' : '') + '</div></td>';
      }).join('') + '</tr>';
  });
  out += '</tbody></table></div>';

  /* A card a hold, with what each count was made of, most first. */
  var names = srv.names || {};
  var cards = '';
  ECON_HOLDS.forEach(function (h) {
    var row = sum[h[0]];
    var total = 0;
    ECON_KINDS.forEach(function (k) { total += econTotal(row[k[0]]); });
    if (!total) return;
    var body = '';
    ECON_KINDS.forEach(function (k) {
      var items = row[k[0]] || {};
      var keys = Object.keys(items).sort(function (a, b) { return items[b] - items[a] || String(a).localeCompare(String(b)); });
      if (!keys.length) return;
      body += '<div class="section-label">' + esc(k[1]) + ' &middot; ' + econTotal(items) + '</div>' +
        '<div class="tablewrap"><table class="board econ"><thead><tr><th>' +
        (k[0] === 'hauled' ? 'To' : k[0] === 'hauledIn' ? 'From' : 'Item') +
        '</th><th class="num">Pieces</th></tr></thead><tbody>' +
        keys.map(function (key) {
          var shown = (k[0] === 'hauled' || k[0] === 'hauledIn') ? econHoldName(key) : (names[key] || key);
          return '<tr><td data-label="' + (k[0] === 'hauled' ? 'To' : k[0] === 'hauledIn' ? 'From' : 'Item') +
            '"><div class="cell">' + esc(shown) + '</div></td>' +
            '<td class="num" data-label="Pieces"><div class="cell">' + items[key] + '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
    });
    cards += '<details class="person econhold"><summary>' +
      '<span class="pf"><span class="lab">Hold</span><span class="val nm">' + esc(h[1]) + '</span></span>' +
      '<span class="pf"><span class="lab">Counted</span><span class="val hrs">' + total + ' pieces</span></span>' +
      '<span class="chev" aria-hidden="true">&#9654;</span></summary>' +
      '<div class="pbody econbody">' + body + '</div></details>';
  });
  out += cards
    ? '<div class="section-label">By hold</div><div class="people">' + cards + '</div>'
    : '<div class="empty">' + (q ? 'Nothing matches that in this span.' : 'Nothing was counted in this span.') + '</div>';

  el('page').innerHTML = out;
  wireEconomy();
}

function wireEconomy() {
  var r = el('ereload');
  if (r) r.onclick = function () { ECON = null; drawEconomy(); };
  var s = el('esrv');
  if (s) s.onchange = function () { EFIND.srv = s.value; drawEconomy(); };
  var d = el('espan');
  if (d) d.onchange = function () { EFIND.span = d.value; drawEconomy(); };
  var f = el('efind');
  if (f) {
    f.oninput = function () {
      EFIND.q = f.value;
      clearTimeout(wireEconomy.t);
      wireEconomy.t = setTimeout(function () {
        drawEconomy();
        var again = el('efind');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 250);
    };
  }
}

/* ---------------------------------------------------------------- home -- */
function tallyOf() {
  var n = { pass:0, fail:0, skip:0 };
  Object.keys(S.results).forEach(function (k) {
    var s = (S.results[k] || {}).status;
    if (n[s] !== undefined) n[s]++;
  });
  return n;
}
function rowCount(k) {
  var b = S.boards[k];
  if (!b) return 0;
  var n = 0;
  (b.sections || []).forEach(function (s) { n += (s.rows || []).length; });
  return n;
}
function countFor(k) {
  if (k === 'tests') {
    var t = tallyOf(), done = t.pass + t.fail + t.skip;
    var total = (S.docs.tests || '').split('\n')
      .filter(function (l) { return /^##\s+test\b/i.test(l); }).length;
    return total ? done + ' of ' + total + ' marked' : 'nothing to test yet';
  }
  if (k === 'uploads') return 'see /gallery';
  if (k === 'news')    return (S.news.news || []).length + ' releases';
  if (k === 'report')  return 'takes a minute';
  if (k === 'help')    return 'read me first';
  if (k === 'inbox') {
    var open = S.inbox.filter(function (i) { return i.state === 'new'; }).length;
    return open ? open + ' waiting' : 'nothing waiting';
  }
  if (k === 'link')   return 'Discord decides';
  if (k === 'economy') return 'per hold, the last 30 days';
  if (k === 'linked') return S.linked.length + ' linked';
  if (k === 'sessions') {
    var w = sessionTotals(S.sessions);
    return w.n ? w.n + ' in the last seven days' : 'nobody yet';
  }
  var n = rowCount(k);
  return n === 1 ? '1 entry' : n + ' entries';
}
function card(k, lead) {
  if (!maySee(k)) return '';
  return '<a class="card' + (lead ? ' lead' : '') + '" href="' + PATHS[k] + '">' +
    '<div class="t">' + esc(label(k)) +
      (lead ? ' <span class="mark">start here</span>' : '') +
      ' ' + levelTag(k, 'mark') + '</div>' +
    '<div class="d">' + esc(ABOUT[k] || '') + '</div>' +
    '<div class="n">' + esc(countFor(k)) + '</div>' +
  '</a>';
}

function drawHome() {
  var out =
    '<div class="hero">' +
      '<img src="/logo.png" alt="Thornswood">' +
      '<div><h1 tabindex="-1">Hub</h1>' +
      '<div class="sub">Gallery, sessions, linked accounts, the report inbox and the hold economy. ' +
      'The public site is at <a href="/">thornswood.net</a>.</div></div>' +
    '</div>' +
    '<div class="rule"></div>';

  // Staff as well as admins, and card() drops the ones they may not open, so
  // a Gamemaster lands on a home page with Gallery on it and nothing else.
  if (inHub()) {
    out += '<div class="cards">' +
      card('uploads') + card('sessions') + card('linked') + card('inbox') + card('economy') +
      '</div>';
  } else {
    out += '<p class="lede">Signing in with Discord opens the hub.</p>' +
      '<a class="discord" href="/auth/discord?back=' +
      encodeURIComponent(location.pathname) + '">Sign in with Discord</a>';
  }
  el('page').innerHTML = out;
}

/* --------------------------------------------------------------- board -- */
/*
  A board is sections, each section a table with its own columns. That is the
  shape the notes were already in, and it means a column added to Open does not
  appear on Shipped where it would be empty.

  Editing is a click on the cell. No edit mode, no form, no save button: the
  cell becomes a box, Enter puts it back, and the board is saved half a second
  later. Adding is a row that is always sitting at the bottom waiting to be
  typed in, so putting something down is one click and one Enter.
*/
/*
  Each save says which revision of the board it was made from (#2188), and
  the server refuses one made from an older copy than it holds, so two people
  on one board cannot silently overwrite each other. One save per board is on
  the wire at a time: an edit made while one is out waits for its answer and
  goes with the new number, so somebody typing quickly never clashes with
  themselves.
*/
var pending = {}, inflight = {}, again = {};
function saveBoard(k) {
  saidNow('saving');
  clearTimeout(pending[k]);
  pending[k] = setTimeout(function () { pending[k] = 0; sendBoard(k); }, 500);
}
function sendBoard(k) {
  if (inflight[k]) { again[k] = true; return; }
  inflight[k] = true;
  S.boardRevs = S.boardRevs || {};
  var done = function () {
    inflight[k] = false;
    if (again[k]) { again[k] = false; sendBoard(k); }
  };
  api('/api/board/' + k, {
    method:'PUT',
    headers:{ 'Content-Type':'application/json', 'X-Board-Rev': String(S.boardRevs[k] === undefined ? '' : S.boardRevs[k]) },
    body: JSON.stringify(S.boards[k])
  }).then(function (r) {
    return r.json().catch(function () { return null; }).then(function (j) {
      if (r.ok) {
        if (j && typeof j.rev === 'number') S.boardRevs[k] = j.rev;
        saidNow('saved');
        return done();
      }
      // A clash is not retried: what is on screen is older than what is
      // saved, and sending it again would be the overwrite this refuses.
      if (r.status === 409 || r.status === 428) again[k] = false;
      // "did not save" on its own sends somebody looking in the wrong place.
      // Say which it was.
      saidNow(r.status === 401 ? 'not saved: signed out, reload the page'
            : r.status === 403 ? 'not saved: you are not an admin here'
            : r.status === 409 ? 'not saved: somebody else saved this board since you opened it. Reload to see their change, then make yours again'
            : r.status === 428 ? 'not saved: this page is older than the board check. Reload, then make your change again'
            : 'not saved: ' + (j && j.error ? j.error : r.status));
      done();
    });
  }).catch(function () { saidNow('not saved: could not reach the server'); done(); });
}

var newId = function (p) {
  return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
};
var sectionOf = function (k, sid) {
  return (S.boards[k].sections || []).filter(function (s) { return s.id === sid; })[0];
};
var rowOf = function (sec, rid) {
  return (sec.rows || []).filter(function (r) { return r.id === rid; })[0];
};

function drawBoard() {
  var k = S.at, admin = S.me.admin;
  var b = S.boards[k] || { intro:'', sections:[] };
  S.boards[k] = b;
  b.sections = b.sections || [];

  var out = head(admin
    ? '<button class="btn small" id="addsec">Add section</button>' +
      (k !== 'archive' ? '<button class="btn small" id="archall">Archive everything ticked</button>' : '')
    : '', !!b.intro);

  /* The intro and each section's note are markdown, and an admin edits them
     in place like a cell (#2414): the Known Issues page is written from this
     board, so its prose has to be editable here or it has no editor at all. */
  if (b.intro) out += '<div class="doc doc-intro"' + (admin ? ' data-intro="1" title="Click to change"' : '') + '>' +
    marked.parse(b.intro) + '</div>';
  else if (admin) out += '<div class="doc doc-intro empty-note" data-intro="1">Add an intro</div>';

  if (!b.sections.length) {
    out += '<div class="empty">Nothing here yet.' +
      (admin ? ' Add a section to start.' : '') + '</div>';
  }

  b.sections.forEach(function (sec) {
    var cols = sec.columns || (sec.columns = []);
    var rows = sec.rows || (sec.rows = []);
    out += '<div class="sec" data-s="' + sec.id + '">' +
      '<div class="sechead">' +
        '<h3' + (admin ? ' contenteditable="plaintext-only" data-secname="1"' : '') + '>' +
          esc(sec.name || 'Untitled') + '</h3>' +
        '<span class="count">' + rows.length + '</span>' +
        (admin ? '<div class="acts">' +
          '<button class="btn small" data-addcol="' + sec.id + '">Add column</button>' +
          '<button class="btn small" data-delsec="' + sec.id + '">Remove section</button>' +
        '</div>' : '') +
      '</div>';
    if (sec.note) out += '<div class="secnote mdc"' + (admin ? ' data-note="' + sec.id + '" title="Click to change"' : '') + '>' +
      marked.parse(sec.note) + '</div>';
    else if (admin) out += '<div class="secnote empty-note" data-note="' + sec.id + '">Add a note</div>';

    /* A section of prose alone (a note and no columns) has no table to draw,
       and the adder below needs a first column to type into. Add column
       gives it one. */
    if (!cols.length) { out += '</div>'; return; }

    out += '<div class="tablewrap' + (admin ? ' edit' : '') + '"><table class="board"><thead><tr>' +
      '<th class="tick"></th>';
    cols.forEach(function (c) {
      out += '<th data-c="' + c.id + '"><span class="nm"' +
        (admin ? ' contenteditable="plaintext-only" data-colname="' + sec.id + '|' + c.id + '"' : '') +
        '>' + esc(c.name) + '</span>' +
        (admin && cols.length > 1 ? '<button class="x" data-delcol="' + sec.id + '|' + c.id +
          '" title="Remove this column">&times;</button>' : '') + '</th>';
    });
    if (admin) out += '<th class="rowacts"></th>';
    out += '</tr></thead><tbody>';

    rows.forEach(function (r) {
      out += '<tr data-r="' + r.id + '" class="' + (r.done ? 'done' : '') + '">' +
        '<td class="tick"><input type="checkbox"' + (r.done ? ' checked' : '') +
          (admin ? '' : ' disabled') + ' data-tick="' + sec.id + '|' + r.id + '"></td>';
      cols.forEach(function (c) {
        out += '<td data-label="' + esc(c.name) + '" data-cell="' + sec.id + '|' + r.id + '|' + c.id + '">' +
          '<div class="cell">' + cellHtml(r.cells ? r.cells[c.id] : '') + '</div></td>';
      });
      if (admin) {
        out += '<td class="rowacts">' +
          (k !== 'archive'
            ? '<button data-arch="' + sec.id + '|' + r.id + '" title="Move to the archive">Archive</button>'
            : '') +
          '<button class="del" data-delrow="' + sec.id + '|' + r.id + '" title="Delete">&times;</button>' +
        '</td>';
      }
      out += '</tr>';
    });

    if (admin) {
      out += '<tr class="adder"><td class="tick"><span class="plus">+</span></td>' +
        '<td colspan="' + (cols.length + 1) + '">' +
        '<input placeholder="Add to ' + esc(sec.name || 'this') + ', then Enter" ' +
        'data-add="' + sec.id + '"></td></tr>';
    }
    out += '</tbody></table></div></div>';
  });

  el('page').innerHTML = out;
  wireBoard(k);
}

function wireBoard(k) {
  var page = el('page'), admin = S.me.admin;
  var b = S.boards[k];

  if (!admin) { dressCode(); return; }

  var add = el('addsec');
  if (add) add.onclick = function () {
    b.sections.push({ id:newId('s'), name:'New section', note:'',
      columns:[{id:newId('c'),name:'Item'},{id:newId('c'),name:'Notes'}], rows:[] });
    saveBoard(k); draw();
  };
  var archall = el('archall');
  if (archall) archall.onclick = function () {
    var n = 0;
    b.sections.forEach(function (sec) {
      (sec.rows || []).slice().forEach(function (r) {
        if (r.done) { moveToArchive(k, sec, r, true); n++; }
      });
    });
    if (!n) { saidNow('nothing is ticked'); return; }
    saveBoard(k); saveBoard('archive'); draw();
  };

  var intro = page.querySelector('[data-intro]');
  if (intro) intro.onclick = function () {
    openText(k, intro, b.intro || '', function (v) { b.intro = v; });
  };
  each(page, '[data-note]', function (div) {
    div.onclick = function () {
      var sec = sectionOf(k, div.dataset.note); if (!sec) return;
      openText(k, div, sec.note || '', function (v) { sec.note = v; });
    };
  });

  each(page, '[data-secname]', function (h) {
    h.onblur = function () {
      var sec = sectionOf(k, h.closest('.sec').dataset.s);
      if (!sec) return;
      var v = h.textContent.trim();
      if (v !== sec.name) { sec.name = v; saveBoard(k); }
    };
    h.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); h.blur(); } };
  });

  each(page, '[data-colname]', function (sp) {
    sp.onblur = function () {
      var parts = sp.dataset.colname.split('|');
      var sec = sectionOf(k, parts[0]); if (!sec) return;
      var col = sec.columns.filter(function (c) { return c.id === parts[1]; })[0];
      if (col && col.name !== sp.textContent.trim()) { col.name = sp.textContent.trim(); saveBoard(k); }
    };
    sp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); sp.blur(); } };
  });

  each(page, '[data-addcol]', function (btn) {
    btn.onclick = function () {
      var sec = sectionOf(k, btn.dataset.addcol); if (!sec) return;
      sec.columns.push({ id:newId('c'), name:'New column' });
      saveBoard(k); draw();
      var last = page.querySelector('.sec[data-s="' + sec.id + '"] th:nth-last-child(2) .nm');
      if (last) { last.focus(); document.execCommand && document.execCommand('selectAll', false, null); }
    };
  });

  each(page, '[data-delcol]', function (btn) {
    btn.onclick = function () {
      var parts = btn.dataset.delcol.split('|');
      var sec = sectionOf(k, parts[0]); if (!sec) return;
      var col = sec.columns.filter(function (c) { return c.id === parts[1]; })[0];
      if (!confirm('Remove the column "' + (col ? col.name : '') + '" and everything in it?')) return;
      sec.columns = sec.columns.filter(function (c) { return c.id !== parts[1]; });
      sec.rows.forEach(function (r) { if (r.cells) delete r.cells[parts[1]]; });
      saveBoard(k); draw();
    };
  });

  each(page, '[data-delsec]', function (btn) {
    btn.onclick = function () {
      var sec = sectionOf(k, btn.dataset.delsec); if (!sec) return;
      if (!confirm('Remove "' + sec.name + '" and its ' + sec.rows.length + ' rows?')) return;
      b.sections = b.sections.filter(function (s) { return s.id !== sec.id; });
      saveBoard(k); draw();
    };
  });

  each(page, '[data-tick]', function (box) {
    box.onchange = function () {
      var parts = box.dataset.tick.split('|');
      var sec = sectionOf(k, parts[0]); if (!sec) return;
      var r = rowOf(sec, parts[1]); if (!r) return;
      r.done = box.checked;
      r.at = Date.now();
      box.closest('tr').className = r.done ? 'done' : '';
      saveBoard(k);
    };
  });

  each(page, '[data-arch]', function (btn) {
    btn.onclick = function () {
      var parts = btn.dataset.arch.split('|');
      var sec = sectionOf(k, parts[0]); if (!sec) return;
      var r = rowOf(sec, parts[1]); if (!r) return;
      moveToArchive(k, sec, r, true);
      saveBoard(k); saveBoard('archive'); draw();
    };
  });

  each(page, '[data-delrow]', function (btn) {
    btn.onclick = function () {
      var parts = btn.dataset.delrow.split('|');
      var sec = sectionOf(k, parts[0]); if (!sec) return;
      if (!confirm('Delete this row? Archive keeps it, this does not.')) return;
      sec.rows = sec.rows.filter(function (r) { return r.id !== parts[1]; });
      saveBoard(k); draw();
    };
  });

  each(page, '[data-add]', function (inp) {
    inp.onkeydown = function (e) {
      if (e.key !== 'Enter') return;
      var v = inp.value.trim();
      if (!v) return;
      var sec = sectionOf(k, inp.dataset.add); if (!sec) return;
      var cells = {};
      cells[sec.columns[0].id] = v;
      sec.rows.push({ id:newId('r'), done:false, at:Date.now(), by:S.me.name, cells:cells });
      saveBoard(k);
      inp.value = '';
      var keep = sec.id;
      draw();
      var again = el('page').querySelector('[data-add="' + keep + '"]');
      if (again) again.focus();
    };
  });

  each(page, '[data-cell] .cell', function (div) {
    div.onclick = function () { openCell(k, div.parentNode); };
  });

  dressCode();
}

function each(root, sel, fn) {
  Array.prototype.forEach.call(root.querySelectorAll(sel), fn);
}

/* A cell becomes a box, and putting it back saves it. Enter commits because
   most of these are one line; shift and Enter when a line break is wanted. */
function openCell(k, td) {
  if (td.querySelector('textarea')) return;
  var parts = td.dataset.cell.split('|');
  var sec = sectionOf(k, parts[0]); if (!sec) return;
  var row = rowOf(sec, parts[1]); if (!row) return;
  row.cells = row.cells || {};
  var was = row.cells[parts[2]] || '';

  var ta = document.createElement('textarea');
  ta.value = was;
  td.innerHTML = '';
  td.appendChild(ta);
  var grow = function () { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
  grow();
  ta.oninput = grow;
  ta.focus();
  ta.setSelectionRange(was.length, was.length);

  var close = function (commit) {
    var v = commit ? ta.value : was;
    row.cells[parts[2]] = v;
    td.innerHTML = '<div class="cell">' + cellHtml(v) + '</div>';
    td.querySelector('.cell').onclick = function () { openCell(k, td); };
    dressCode();
    if (commit && v !== was) { row.at = Date.now(); saveBoard(k); }
  };
  ta.onblur = function () { close(true); };
  ta.onkeydown = function (e) {
    if (e.key === 'Escape') { e.preventDefault(); ta.onblur = null; close(false); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      var tds = Array.prototype.slice.call(el('page').querySelectorAll('[data-cell]'));
      var i = tds.indexOf(td);
      ta.blur();
      var nxt = tds[i + (e.shiftKey ? -1 : 1)];
      if (nxt) openCell(k, nxt);
    }
  };
}

/* A board's intro or a section's note becomes a box (#2414). Paragraphs are
   the point of these, so Enter is a new line here, not the end: clicking away
   saves, Escape puts back what was there. */
function openText(k, holder, was, put) {
  if (holder.querySelector('textarea')) return;
  var ta = document.createElement('textarea');
  ta.className = 'notebox';
  ta.value = was;
  holder.onclick = null;
  holder.innerHTML = '';
  holder.appendChild(ta);
  var grow = function () { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
  grow();
  ta.oninput = grow;
  ta.focus();
  var close = function (commit) {
    var v = commit ? ta.value.replace(/\s+$/, '') : was;
    if (commit && v !== was) { put(v); saveBoard(k); }
    draw();
  };
  ta.onblur = function () { close(true); };
  ta.onkeydown = function (e) {
    if (e.key === 'Escape') { e.preventDefault(); ta.onblur = null; close(false); }
  };
}

function moveToArchive(from, sec, row, tick) {
  var arch = S.boards.archive;
  if (!arch) return;
  arch.sections = arch.sections || [];
  var name = label(from) + ' · ' + (sec.name || '');
  var tgt = arch.sections.filter(function (s) { return s.name === name; })[0];
  if (!tgt) {
    tgt = { id:newId('s'), name:name, note:'',
            columns:[{ id:newId('c'), name:'When' }], rows:[] };
    arch.sections.unshift(tgt);
  }
  var cells = {};
  cells[tgt.columns[0].id] = new Date().toLocaleDateString();
  (sec.columns || []).forEach(function (c) {
    var m = tgt.columns.filter(function (x) { return x.name === c.name; })[0];
    if (!m) { m = { id:newId('c'), name:c.name }; tgt.columns.push(m); }
    cells[m.id] = (row.cells || {})[c.id] || '';
  });
  tgt.rows.unshift({ id:newId('r'), done:false, at:Date.now(), by:S.me.name, cells:cells });
  sec.rows = sec.rows.filter(function (r) { return r.id !== row.id; });
}

/* ------------------------------------------------------------ document -- */
function drawDoc() {
  var md = S.docs[S.at] || '';
  el('page').innerHTML = head(S.me.admin ? '<button class="btn" id="edit">Edit</button>' : '') +
    (S.at === 'tests' ? '<div class="tally" id="tally"></div>' : '') +
    '<div class="doc" id="body">' + marked.parse(md) + '</div>';
  var e = el('edit');
  if (e) e.onclick = function () { S.editing = true; draw(); };
  dressCode();
  if (S.at === 'tests') { dressTests(); tally(); }
}

function drawEdit() {
  el('page').innerHTML = head(
      '<button class="btn" id="cancel">Cancel</button>' +
      '<button class="btn key" id="save">Save</button>') +
    '<textarea class="md" id="ta"></textarea>' +
    '<p class="said mt-12">Markdown. Three backticks make a ' +
    'command block with a copy button. A heading that starts with the word ' +
    'Test gets the pass, fail and skip buttons under it.</p>';
  el('ta').value = S.docs[S.at] || '';
  el('cancel').onclick = function () { S.editing = false; draw(); };
  el('save').onclick = function () {
    var text = el('ta').value;
    saidNow('saving');
    api('/api/doc/' + S.at, { method:'PUT', body:text }).then(function (r) {
      if (!r.ok) throw 0;
      S.docs[S.at] = text; S.editing = false; draw(); saidNow('saved');
    }).catch(function () { saidNow('did not save'); });
  };
}

function dressCode() {
  each(el('page'), 'pre', function (pre) {
    if (pre.parentNode.classList.contains('cmd')) return;
    var box = document.createElement('div');
    box.className = 'cmd';
    pre.parentNode.insertBefore(box, pre);
    box.appendChild(pre);
    var b = document.createElement('button');
    b.className = 'copy'; b.textContent = 'copy';
    b.onclick = function (e) {
      e.stopPropagation();
      navigator.clipboard.writeText(pre.innerText).then(function () {
        b.textContent = 'copied'; b.classList.add('done');
        setTimeout(function () { b.textContent = 'copy'; b.classList.remove('done'); }, 1400);
      });
    };
    box.appendChild(b);
  });
}

/* --------------------------------------------------------------- tests -- */
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function dressTests() {
  each(el('body'), 'h2', function (h) {
    if (!/^test\b/i.test(h.textContent.trim())) return;
    var id = slug(h.textContent);
    var r = S.results[id] || {};
    var bar = document.createElement('div');
    bar.className = 'res';
    bar.innerHTML =
      ['pass','fail','skip'].map(function (v) {
        return '<button class="mark' + (r.status === v ? ' on' : '') +
               '" data-v="' + v + '">' + v.toUpperCase() + '</button>';
      }).join('') +
      '<input class="note" placeholder="what happened" value="' + esc(r.notes || '') + '">' +
      '<input class="who" placeholder="you" value="' + esc(r.by || remember('who')) + '">' +
      '<span class="when">' + (r.at ? new Date(r.at).toLocaleDateString() : '') + '</span>';
    h.parentNode.insertBefore(bar, h.nextSibling);

    var note = bar.querySelector('.note'), whoIn = bar.querySelector('.who');
    each(bar, '.mark', function (b) {
      b.onclick = function () {
        var cur = S.results[id] || {};
        cur.status = (cur.status === b.dataset.v) ? '' : b.dataset.v;
        cur.by = whoIn.value || cur.by || remember('who');
        cur.notes = note.value;
        if (whoIn.value) remember('who', whoIn.value);
        saveResult(id, cur, bar);
      };
    });
    var push = function () {
      var cur = S.results[id] || {};
      cur.notes = note.value; cur.by = whoIn.value;
      if (whoIn.value) remember('who', whoIn.value);
      saveResult(id, cur, bar);
    };
    note.onchange = push; whoIn.onchange = push;
  });
}

function saveResult(id, rec, bar) {
  rec.at = Date.now();
  S.results[id] = rec;
  api('/api/results', {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(S.results)
  }).then(function () {
    if (bar) {
      each(bar, '.mark', function (b) {
        b.className = 'mark' + (rec.status === b.dataset.v ? ' on' : '');
      });
      bar.querySelector('.when').textContent = new Date(rec.at).toLocaleDateString();
    }
    tally();
  });
}

function tally() {
  var box = el('tally');
  if (!box) return;
  var n = tallyOf();
  box.innerHTML =
    '<span class="pill pass">' + n.pass + ' passed</span>' +
    '<span class="pill fail">' + n.fail + ' failed</span>' +
    '<span class="pill skip">' + n.skip + ' skipped</span>';
}

/* ---------------------------------------------------------------- news -- */
function drawNews() {
  var list = S.news.news || [];
  var out = head();
  if (!list.length) {
    out += '<div class="empty">No releases recorded yet.</div>';
  }
  list.forEach(function (n) {
    out += '<div class="entry">' +
      '<div class="when">' + esc(n.date || '') + '</div>' +
      '<h3>' + esc(n.title || '') + '</h3>' +
      (n.body ? '<p class="det">' + esc(n.body) + '</p>' : '') +
      ((n.details && n.details.length)
        ? '<div class="det">' + n.details.map(function (d) {
            return '<span>' + esc(d) + '</span>'; }).join('') + '</div>'
        : '') +
      ((n.files && n.files.length)
        ? '<details><summary>' + n.files.length + ' files</summary><ul>' +
          n.files.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') +
          '</ul></details>'
        : '') +
    '</div>';
  });
  el('page').innerHTML = out;
}

/* ----------------------------------------------------------- downloads -- */

/*
  The downloads page used to live here too, behind the sign in, which was
  backwards: the installer is the one thing on this site that has to be
  reachable by somebody who has never been here before. It is /downloads on the
  public front now. Nothing in the panel links to it, and nothing here draws it.
*/

/* ------------------------------------------------------------- uploads -- */
/*
  Hub Gallery is one staff grid: pending shots show Accept + Delete, accepted
  shots show Delete. No Reject. Public send/browse stays on /gallery.
*/
function drawUploads() {
  var out = head() +
    (S.me.dev || S.me.admin
      ? '<div id="galgrid"></div>'
      : '');
  el('page').innerHTML = out;
  if (S.me.dev || S.me.admin) loadGalleryStaff();
}

/* Staff Gallery grid. Pending and accepted share one list so Accept sits on
   the waiting card rather than a separate queue section. Pending comes from
   /api/gallery/pending; accepted from /api/public (same set /gallery shows).
   Accept posts /api/gallery/approve; Delete uses DELETE /api/gallery/approved
   which also clears a pending name.

   Smaller copies (#3218). A waiting card shows each copy that came with the
   picture beside it, and Accept names the copies it showed, so only those
   go out with it. A still picture with no copies (one sent before them, or
   from a launcher that sends none) has Make smaller copies: they are made
   here, from the picture on the card, by copies.js. On a live picture they
   go out at once. */
var GAL_STILL = /\.(png|jpe?g|webp)$/i;
function loadGalleryStaff() {
  var box = el('galgrid');
  if (!box) return;
  // Either read failing is said in the grid. It used to read a refused answer
  // as an empty list ("Nothing in the gallery yet") and to leave the old list
  // up when the site did not answer at all (#2736).
  var read = function (path) {
    return api(path).then(function (r) {
      if (!r.ok) throw new Error('the site answered ' + r.status + ' to ' + path);
      return r.json();
    });
  };
  Promise.all([read('/api/gallery/pending'), read('/api/public')]).then(function (pair) {
    if (!el('galgrid')) return;
    box = el('galgrid');
    var pending = (pair[0] && pair[0].pending) || [];
    var live = (pair[1] && pair[1].gallery) || [];
    var waiting = pending.length;
    var out = '<div class="section-label">Gallery' +
      (waiting ? ' &middot; ' + waiting + ' waiting' : '') +
      (live.length ? (waiting ? ', ' : ' &middot; ') + live.length + ' live' : '') +
      '</div>';
    out += '<p class="lede lede-gallery">Pending shots need Accept before they appear on /gallery or Play. Delete removes a pending or live shot. Anyone can Report; only staff Accept or Delete.</p>';
    if (!pending.length && !live.length) {
      out += '<div class="empty">Nothing in the gallery yet.</div>';
    } else {
      pending.forEach(function (g) {
        var href = '/up/' + encodeURIComponent(g.name);
        var copies = (g.copies || []).filter(function (n) { return n === 800 || n === 1600; });
        var shown = copies.map(function (n) {
          var at = href + '?w=' + n;
          return '<a class="thumb sm" href="' + at + '" target="_blank" title="The ' + n + ' pixel copy"><img src="' + at + '" alt="The ' + n + ' pixel copy" loading="lazy"></a>';
        }).join('');
        out += '<div class="file">' +
          '<a class="thumb" href="' + href + '" target="_blank"><img src="' + href + '" alt="' + esc(g.by || 'Pending gallery image') + '" loading="lazy"></a>' + shown +
          '<div class="who"><div class="nm">' + esc(g.name) + ' <span class="pill">waiting</span></div>' +
          '<div class="meta">' + (g.by ? esc(g.by) + '  &middot;  ' : '') +
            'from ' + esc(g.from || '?') + '  &middot;  ' + new Date(g.at).toLocaleString() +
            (g.note ? '<br>' + esc(g.note) : '') +
            (copies.length ? '<br>Beside it, its smaller copies: what most screens are shown once it is accepted.' : '') + '</div></div>' +
          (!copies.length && GAL_STILL.test(g.name) ? '<button class="btn" data-galcopy="' + esc(g.name) + '" data-galfrom="' + href + '">Make smaller copies</button>' : '') +
          '<button class="btn key" data-galok="' + esc(g.name) + '" data-galshown="' + copies.join(',') + '">Accept</button>' +
          '<button class="btn" data-galdel="' + esc(g.name) + '" data-galpend="1">Delete</button>' +
        '</div>';
      });
      live.forEach(function (g) {
        var href = g.url || ('/shot/' + encodeURIComponent(g.name));
        out += '<div class="file compact">' +
          '<a class="thumb sm" href="' + esc(href) + '" target="_blank"><img src="' + esc(href) + '" alt="' + esc(g.by || 'Live gallery image') + '" loading="lazy"></a>' +
          '<div class="who"><div class="nm">' + esc(g.name) + '</div>' +
          '<div class="meta">' + (g.by ? esc(g.by) : 'no by') + '</div></div>' +
          (!g.srcset && GAL_STILL.test(g.name) ? '<button class="btn" data-galcopy="' + esc(g.name) + '" data-galfrom="' + esc(href) + '">Make smaller copies</button>' : '') +
          '<button class="btn" data-galdel="' + esc(g.name) + '">Delete</button>' +
        '</div>';
      });
    }
    box.innerHTML = out;
    each(box, '[data-galok]', function (b) {
      b.onclick = function () {
        b.disabled = true; b.textContent = 'accepting';
        api('/api/gallery/approve', { method:'POST', headers:{ 'content-type':'application/json' },
            body: JSON.stringify({ name: b.dataset.galok,
              copies: b.dataset.galshown ? b.dataset.galshown.split(',').map(Number) : [] }) })
          .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
          .then(function (a) {
            if (!a || !a.ok) alert((a && a.error) || 'The site could not accept that picture.');
            loadGalleryStaff();
          }, function () {
            alert('The site did not answer, so that picture was not accepted.');
            loadGalleryStaff();
          });
      };
    });
    each(box, '[data-galcopy]', function (b) {
      b.onclick = function () {
        b.disabled = true; b.textContent = 'making copies';
        api(b.dataset.galfrom).then(function (r) {
          if (!r.ok) throw new Error('the site answered ' + r.status + ' for the picture');
          return r.blob();
        }).then(function (blob) {
          return window.galleryCopies.send(blob, b.dataset.galcopy);
        }).then(function (done) {
          if (done.bad) alert(done.bad + '.');
          else if (!done.made.length) alert('That picture is narrow enough that it needs no smaller copy.');
          loadGalleryStaff();
        }, function (e) {
          alert('The picture could not be read to make its copies (' + ((e && e.message) || 'no answer') + ').');
          loadGalleryStaff();
        });
      };
    });
    each(box, '[data-galdel]', function (b) {
      b.onclick = function () {
        var pendingOne = b.getAttribute('data-galpend') === '1';
        // One question (#2352, option C): removing deletes the file. The site
        // keeps a picture somebody reported, out of sight, for 30 days so
        // staff can look into the report, then deletes it.
        var ask = (pendingOne
          ? ('Delete ' + b.dataset.galdel + ' from the waiting queue?')
          : ('Delete ' + b.dataset.galdel + ' from the live gallery?')) +
          '\n\nIts file is deleted from the site. If somebody reported it, the site keeps the file out of sight for 30 days for staff, then deletes it.';
        if (!confirm(ask)) return;
        b.disabled = true; b.textContent = 'deleting';
        api('/api/gallery/approved', { method:'DELETE', headers:{ 'content-type':'application/json' },
            body: JSON.stringify({ name: b.dataset.galdel }) })
          .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
          .then(function (a) {
            if (!a || !a.ok) alert((a && a.error) || 'The site could not finish removing that picture.');
            loadGalleryStaff();
          }, function () {
            alert('The site did not answer, so that picture was not removed.');
            loadGalleryStaff();
          });
      };
    });
  }).catch(function (e) {
    box = el('galgrid');
    if (!box) return;
    box.innerHTML = '<div class="section-label">Gallery</div>' +
      '<div class="empty">The gallery could not be read (' +
      esc((e && e.message) || 'no answer from the site') + '). Reload the page to see it.</div>';
  });
}

/* -------------------------------------------------------------- report -- */
var reportKind = 'bug';
function drawReport() {
  el('page').innerHTML = head() +
    '<div class="form">' +
      '<div class="pick">' +
        '<button data-kind="bug" class="' + (reportKind === 'bug' ? 'on' : '') + '">Something is broken</button>' +
        '<button data-kind="idea" class="' + (reportKind === 'idea' ? 'on' : '') + '">I have an idea</button>' +
      '</div>' +
      '<label for="rt">In one line</label>' +
      '<input id="rt" placeholder="' + (reportKind === 'bug'
        ? 'Doors in Whiterun will not open' : 'Add Cloaks of Skyrim') + '">' +
      '<label for="rd">What happened, and what you were doing</label>' +
      '<textarea id="rd" placeholder="' + (reportKind === 'bug'
        ? 'Where you were, what you pressed, what you expected, what happened instead. If you have a screenshot or a log, send it on the public Gallery and say so here.'
        : 'What it would add, and a Nexus link if it is a mod.') + '"></textarea>' +
      '<label for="rw">Your name</label>' +
      '<input id="rw" value="' + esc(remember('who')) + '" placeholder="so we know who to ask">' +
      '<div class="formfoot">' +
        '<button class="btn key" id="rsend">Send it</button>' +
        '<span class="said" id="rsaid"></span>' +
      '</div>' +
    '</div>' +
    '<p class="lede mt-18">Check <a href="/known">Known Issues</a> ' +
    'first. A lot of what looks broken is a limit of how the server works and is ' +
    'already written down there.</p>';

  each(el('page'), '[data-kind]', function (b) {
    b.onclick = function () { reportKind = b.dataset.kind; drawReport(); };
  });
  el('rsend').onclick = function () {
    var title = el('rt').value.trim();
    if (!title) { el('rsaid').textContent = 'say what it is first'; el('rt').focus(); return; }
    var byName = el('rw').value.trim();
    if (byName) remember('who', byName);
    el('rsend').disabled = true;
    el('rsaid').textContent = 'sending';
    api('/api/report', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ kind:reportKind, title:title,
        detail:el('rd').value, by:byName })
    }).then(function (r) {
      if (!r.ok) throw 0;
      el('page').innerHTML = head() +
        '<div class="form form-center">' +
        '<h3 class="form-sent-title">Sent</h3>' +
        '<p class="said">It is in front of whoever is fixing things. If you have a ' +
        'screenshot or a log, the public <a href="/gallery">Gallery</a> takes those.</p>' +
        '<div class="formfoot formfoot-center">' +
        '<button class="btn" id="another">Send another</button></div></div>';
      el('another').onclick = function () { drawReport(); };
    }).catch(function () {
      el('rsend').disabled = false;
      el('rsaid').textContent = 'did not send, try again';
    });
  };
}

/* --------------------------------------------------------------- inbox -- */
function saveInbox() {
  saidNow('saving');
  api('/api/inbox', {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(S.inbox)
  }).then(function (r) { saidNow(r.ok ? 'saved' : 'did not save'); })
    .catch(function () { saidNow('did not save'); });
}

function drawInbox() {
  var out = head();
  if (!S.inbox.length) {
    out += '<div class="empty">Nothing sent in yet.</div>';
  }
  S.inbox.forEach(function (n) {
    // A report about a person and a call for help from the game (#414) say
    // what they are, rather than reading as a bug.
    var label = (n.kind === 'idea' || n.kind === 'report' || n.kind === 'help' ||
                 n.kind === 'ticket' || n.kind === 'problem') ? n.kind : 'bug';
    out += '<div class="note' + (n.state !== 'new' ? ' done' : '') + '" data-i="' + n.id + '">' +
      '<span class="kind ' + (n.kind === 'idea' ? 'idea' : 'bug') + '">' +
        label + '</span>' +
      '<div class="mid">' +
        '<div class="t">' + (n.about ? 'About ' + esc(n.about) + ': ' : '') + esc(n.title) + '</div>' +
        (n.detail ? '<div class="d">' + esc(n.detail) + '</div>' : '') +
        '<div class="m">' + (n.by ? esc(n.by) + '  &middot;  ' : '') +
          new Date(n.at).toLocaleString() +
          (n.state !== 'new' ? '  &middot;  ' + esc(n.state) : '') + '</div>' +
        (n.state === 'new' ? '<div class="acts">' +
          '<button class="btn small" data-dismiss="' + n.id + '">Not doing this</button>' +
        '</div>' : '<div class="acts">' +
          '<button class="btn small" data-reopen="' + n.id + '">Put it back</button>' +
          '<button class="btn small" data-forget="' + n.id + '">Delete</button></div>') +
      '</div></div>';
  });
  el('page').innerHTML = out;

  var find = function (id) {
    return S.inbox.filter(function (x) { return x.id === id; })[0];
  };

  each(el('page'), '[data-dismiss]', function (b) {
    b.onclick = function () {
      var item = find(b.dataset.dismiss);
      if (item) { item.state = 'not doing this'; saveInbox(); draw(); }
    };
  });
  each(el('page'), '[data-reopen]', function (b) {
    b.onclick = function () {
      var item = find(b.dataset.reopen);
      if (item) { item.state = 'new'; saveInbox(); draw(); }
    };
  });
  each(el('page'), '[data-forget]', function (b) {
    b.onclick = function () {
      if (!confirm('Delete this for good?')) return;
      S.inbox = S.inbox.filter(function (x) { return x.id !== b.dataset.forget; });
      saveInbox(); draw();
    };
  });
}

/* ---------------------------------------------------------------- open -- */
/* Hub markdown goes into innerHTML. Match site/server.js makePageRenderer:
   no raw HTML tokens, and only http/https/mailto on links and images. (#1327) */
(function hardenMarked() {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escOnce(s) {
    return String(s == null ? '' : s)
      .replace(/&(?!#\d{1,7};|#[Xx][0-9A-Fa-f]{1,6};|\w+;)/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function address(href) {
    var h;
    try { h = encodeURI(String(href == null ? '' : href)).replace(/%25/g, '%'); }
    catch (e) { return null; }
    var scheme = /^([^:/?#]*):/.exec(h);
    if (scheme && !/^(https?|mailto)$/i.test(scheme[1])) return null;
    return esc(h);
  }
  function hrefOf(token, fallback) {
    if (token && typeof token === 'object' && 'href' in token) return token.href;
    return fallback;
  }
  function titleOf(token, fallback) {
    if (token && typeof token === 'object' && 'title' in token) return token.title;
    return fallback;
  }
  function textOf(token, fallback) {
    if (token && typeof token === 'object' && 'text' in token) return token.text;
    return fallback;
  }
  marked.setOptions({ breaks: false, gfm: true });
  marked.use({
    tokenizer: {
      html: function () { return undefined; },
      tag: function () { return undefined; }
    },
    renderer: {
      html: function (token) {
        var text = typeof token === 'string' ? token : textOf(token, '');
        var block = token && typeof token === 'object' && token.block;
        return block ? '<p>' + esc(text) + '</p>\n' : esc(text);
      },
      link: function (token, title, text) {
        var href = hrefOf(token, token);
        var tit = titleOf(token, title);
        var body = textOf(token, text);
        var to = address(href);
        if (to === null) return body || '';
        return '<a href="' + to + '"' + (tit ? ' title="' + escOnce(tit) + '"' : '') + '>' + (body || '') + '</a>';
      },
      image: function (token, title, text) {
        var href = hrefOf(token, token);
        var tit = titleOf(token, title);
        var body = textOf(token, text);
        var to = address(href);
        if (to === null) return escOnce(body || '');
        return '<img src="' + to + '" alt="' + escOnce(body || '') + '"' +
               (tit ? ' title="' + escOnce(tit) + '"' : '') + '>';
      }
    }
  });
})();

// A problem filed on the board links its session as /sessions?find=<id>
// (#3155): the page search starts with it.
(function () {
  var f = new URLSearchParams(location.search).get('find');
  if (f) SFIND.q = String(f).slice(0, 80);
})();

// Discord sends people back here with a word about how it went.
(function () {
  var q = new URLSearchParams(location.search).get('discord');
  if (!q) return;
  history.replaceState({}, '', location.pathname);
  setTimeout(function () {
    var s = el('said');
    if (s) s.textContent = q === 'cancelled' ? 'Discord sign in cancelled' : 'Discord sign in failed';
  }, 400);
})();

api('/api/hello').then(function (r) {
  return r.json().then(function (d) { return { ok:r.ok, d:d }; });
}).then(function (x) {
  S.discord = !!(x.d && x.d.discord);
  if (!S.discord) {
    el('gatediscord').hidden = true;
    el('pwbox').hidden = false;
  }
  if (x.ok) start(); else showGate();
}).catch(function () { showGate(); });

// The sign in button on the gate had a bare /auth/discord with no back, so
// everybody who signed in from here landed on the public front page and had to
// find their way to the panel a second time. Send them back to the page they
// were already trying to open.
function showGate() {
  var a = el('gatediscord');
  if (a) {
    var back = location.pathname;
    if (!/^\/[A-Za-z0-9\/_-]*$/.test(back) || back === '/') back = '/hub';
    a.href = '/auth/discord?back=' + encodeURIComponent(back);
  }
  el('gate').style.display = 'grid';
}
