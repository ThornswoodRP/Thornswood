
/*
  The hero video starts once the page has loaded, not as this script runs
  (#2777). It is 3.3 MB, and asked for at once it shared a phone's connection
  with the still under it, the picture the page opens on, which then took 3.4
  to 6.8 seconds to show. The still has the line to itself until it is in,
  and the video paints over it when it plays.

  It never starts for somebody who has asked their system for less motion:
  there is no autoplay attribute, so nothing plays that this does not start,
  and the still is what stays. Nor once somebody has pressed the button
  before the page loaded, which is their answer.

  Nothing here throws: matchMedia is asked only where it exists (narrow()
  below asks it unguarded), so no try is needed (#2736).
*/
var m = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

var bannerVideo = document.querySelector('video.art'), bannerMotion = document.getElementById('bannerMotion');
if (bannerVideo && bannerMotion) {
  var bannerAsked = false;
  bannerMotion.hidden = false;
  function motionLabel() { bannerMotion.textContent = bannerVideo.paused ? 'Play background animation' : 'Pause background animation'; }
  bannerVideo.addEventListener('play', motionLabel);
  bannerVideo.addEventListener('pause', motionLabel);
  bannerMotion.addEventListener('click', function () {
    bannerAsked = true;
    if (bannerVideo.paused) bannerVideo.play().catch(motionLabel);
    else bannerVideo.pause();
  });
  if (!(m && m.matches)) {
    window.addEventListener('load', function () {
      if (!bannerAsked) bannerVideo.play().catch(motionLabel);
    });
  }
  motionLabel();
}

var burger = document.getElementById('burger'), nav = document.getElementById('nav');
// The same width home.css folds the menu at (#3293).
function narrow(){ return window.matchMedia('(max-width:1080px)').matches; }
function shut(){ if (narrow()) { nav.hidden = true; burger.setAttribute('aria-expanded','false'); burger.setAttribute('aria-label','Open menu'); } else { nav.hidden = false; } }
shut();
window.addEventListener('resize', shut);
burger.onclick = function(){
  nav.hidden = !nav.hidden;
  burger.setAttribute('aria-expanded', String(!nav.hidden));
  burger.setAttribute('aria-label', nav.hidden ? 'Open menu' : 'Close menu');
};
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
    shut(); if (burger.focus) burger.focus();
  }
});
Array.prototype.forEach.call(nav.querySelectorAll('a'), function(a){ a.onclick = shut; });

/*
  A small router. Every section is a real address because a link to the roadmap
  should open the roadmap, not the front page with instructions to scroll.
  The written pages are markdown on the server, so fixing a sentence is an edit
  to a file rather than a deploy.
*/
var PAGES = { '/world':1, '/rules':1, '/join':1, '/credits':1,
              '/classes':1, '/known':1, '/help':1,
              '/privacy':1, '/terms':1, '/cookies':1 };
var here = location.pathname.replace(/\/+$/, '').toLowerCase() || '/';


/* The anchor in a fetched page. Called after the markdown is on the page,
   because until then there is nothing with that id to scroll to. */
function jumpToHash() {
  var id = (location.hash || '').replace(/^#/, '');
  if (!id) return;
  var go = function () {
    var el = document.getElementById(id) ||
             document.querySelector('[name="' + id.replace(/"/g, '') + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView();
  };
  // Twice: once now, and once after the browser has laid the page out, because
  // a long document reflows as the fonts land and the first position is wrong.
  go();
  if (window.requestAnimationFrame) requestAnimationFrame(function () { setTimeout(go, 60); });
  else setTimeout(go, 60);
}

// A deadline covers the response body too. Never retry a submission silently.
function request(url, options) {
  options = options || {};
  var ctl = window.AbortController && !options.signal ? new AbortController() : null;
  var opts = Object.assign({}, options);
  if (ctl) opts.signal = ctl.signal;
  var duration = options.body && typeof options.body.size === 'number' ? 120000 : 15000;
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      if (ctl) ctl.abort();
      reject(new Error('The site did not answer in time.'));
    }, duration);
    fetch(url, opts).then(function (r) {
      return r.json().catch(function (e) { if (!r.ok) return {}; throw e; }).then(function (data) {
        if (!r.ok && (!opts.method || opts.method === 'GET')) throw new Error('The site could not load this information.');
        return {ok:r.ok, status:r.status, json:function () { return Promise.resolve(data); }};
      });
    }).then(function (r) { clearTimeout(timer); resolve(r); }, function (e) { clearTimeout(timer); reject(e); });
  });
}
// Reduce large still pictures before uploading. Animated GIFs stay intact.
function preparePicture(file) {
  if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error('Pictures must be 25 MB or smaller.'));
  if (file.size <= 2 * 1024 * 1024 || /\.gif$/i.test(file.name) ||
      !window.createImageBitmap || !window.File) return Promise.resolve(file);
  return createImageBitmap(file).then(function (image) {
    var scale = Math.min(1, 2560 / Math.max(image.width, image.height));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    var context = canvas.getContext('2d');
    if (!context) { image.close(); return file; }
    context.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        resolve(blob && blob.type === 'image/webp' && blob.size < file.size
          ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', {type:'image/webp'}) : file);
      }, 'image/webp', 0.85);
    });
  }).catch(function () { return file; });
}
/* A picture's smaller copies (#3218), made and sent by copies.js after the
   picture. '' when they went or none was needed, or a sentence saying
   which did not go. */
function sendCopies(file, name) {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name || '')) return Promise.resolve('');
  return window.galleryCopies.send(file, name).then(function (r) {
    return r.bad ? r.bad + ', so it will show at full size until staff make them.' : '';
  });
}
function show(html) {
  var headingSeen = false;
  html = html.replace(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/gi, function (all, attrs, text) {
    if (!headingSeen) { headingSeen = true; return all; }
    return '<h2' + attrs + '>' + text + '</h2>';
  });
  document.getElementById('landing').hidden = true;
  var page = document.getElementById('page');
  page.hidden = false;
  document.getElementById('pagebody').innerHTML = html;
  // The server wrote this page's own title from its one list of them (BLURB
  // in server.js, #3138). A page that list does not name keeps the bare name,
  // and takes its heading instead.
  var h1 = document.querySelector('#pagebody h1');
  if (document.title === 'Thornswood' && h1 && h1.textContent) document.title = h1.textContent + ' \u00b7 Thornswood';
}

/* Hard eighteen-and-over door on /downloads and /join only. Remembered in
   localStorage, with a cookie fallback. Confirming is a statement kept as a
   record, not verification of age. The rest of the site stays open.

   BOTH COPIES EXPIRE, AND BOTH CARRY THE POLICY (#2192). Until 11 October the
   localStorage copy was a bare "1" that never expired, so clearing cookies
   left the gate open for ever, against the one year privacy.md promises.
   Now localStorage holds {"v": AGE_POLICY, "until": <ms>}, one year out, the
   same as the cookie, and the cookie's value is AGE_POLICY. Raising
   AGE_POLICY (when the gate's wording changes what somebody agreed to) makes
   every earlier answer ask again. A stored value that is not that shape, is
   for another policy, has passed its day, or claims a day more than a year
   and a bit away (a clock set back, or a value typed in) is dropped and the
   gate asks. MIGRATION: the old bare "1" is honoured only while the old
   cookie still is, since the cookie is the copy that had a year on it; then
   it is restamped in the new shape. Without the cookie it is dropped.

   localStorage throws where the browser will not let this site use it
   (blocked site data, some private windows), and setItem throws when the
   store is full. Each of those catches says so in its braces: the cookie is
   the answer the gate reads last, so a store that cannot be used is read as
   one with nothing in it and nothing else is lost (#2736). */
var AGE_KEY = 'tw-age-18';
var AGE_PATHS = { '/downloads': 1, '/join': 1 };
var AGE_POLICY = 1;
var AGE_DAYS = 365;
var AGE_DAY_MS = 86400000;
function ageCookie() {
  return new RegExp('(?:^|;\\s*)tw-age-18=' + AGE_POLICY + '(?:;|$)').test(document.cookie || '');
}
function ageStore(until) {
  try { localStorage.setItem(AGE_KEY, JSON.stringify({ v: AGE_POLICY, until: until })); }
  catch (e) { /* blocked or full: the cookie written beside it holds the answer */ }
}
function ageOk() {
  var now = Date.now(), raw = null;
  try { raw = localStorage.getItem(AGE_KEY); }
  catch (e) { /* blocked: read as nothing stored, and the cookie decides */ }
  if (raw !== null) {
    var rec = null;
    try { rec = JSON.parse(raw); }
    catch (e) { /* not JSON, so not a value this page wrote: dropped below */ }
    if (rec && typeof rec === 'object' && rec.v === AGE_POLICY && typeof rec.until === 'number' &&
        rec.until > now && rec.until <= now + (AGE_DAYS + 2) * AGE_DAY_MS) return true;
    if (raw === '1' && ageCookie()) { ageStore(now + AGE_DAYS * AGE_DAY_MS); return true; }
    // getItem just answered, so the store can be used and this does not throw.
    localStorage.removeItem(AGE_KEY);
  }
  return ageCookie();
}
function ageRemember() {
  ageStore(Date.now() + AGE_DAYS * AGE_DAY_MS);
  var exp = new Date(Date.now() + AGE_DAYS * AGE_DAY_MS);
  document.cookie = 'tw-age-18=' + AGE_POLICY + '; path=/; expires=' + exp.toUTCString() + '; SameSite=Lax' +
    (location.protocol === 'https:' ? '; Secure' : '');
}
function showAgeGate() {
  show(
    '<div class="age-gate" id="ageGate">' +
    '<h1>Eighteen and over</h1>' +
    '<p>Thornswood is an adult roleplay server. It contains sexual content between adult characters, violence, and language that is not written for children.</p>' +
    '<p>Confirming here is you stating that you are eighteen or older. That ' +
    'statement is kept as a record of what you said, not as verification of your age.</p>' +
    '<p class="quiet">The <a href="/rules">rules</a> and <a href="/terms">terms</a> say the same.</p>' +
    '<div class="acts">' +
    '<button class="btn first" type="button" id="ageYes">I am eighteen or older</button>' +
    '<a class="btn ghost" href="/">Leave</a>' +
    '</div></div>'
  );
  var yes = document.getElementById('ageYes');
  if (yes) {
    yes.addEventListener('click', function () {
      ageRemember();
      location.reload();
    });
    yes.focus();
  }
}

if (AGE_PATHS[here] && !ageOk()) {
  showAgeGate();
} else if (PAGES[here] && document.getElementById('pagebody').children.length) {
  /* The server sent this page with its words already in it (entry 247), so
     there is nothing to fetch. The browser finds /world#accord on its own
     now; this is for the reflow once the fonts land. */
  jumpToHash();
} else if (PAGES[here]) {
  /* Only for a page that came without its body, which is a server.js that
     has not been restarted since this file went up. html is the server's
     render; one that old sends only the markdown, and the words are still
     worth showing unformatted for the minute that lasts. */
  request('/api/page/' + here.slice(1))
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (d) {
      show(d.html || '<pre class="pre-wrap">' + esc(d.md) + '</pre>');
      /* /world#accord is linked from the footer and from the world page
         itself. The anchor it points at is inside the markdown, which is
         fetched after the browser has already given up looking for it, so the
         link landed at the top of a very long page every time. Scroll to it
         once the body is actually on the page. */
      jumpToHash();
    })
    .catch(function () { show('<h1>Not here</h1><p>That page does not exist yet.</p>'); });
} else if (here === '/roadmap') {
  request('/api/roadmap').then(function (r) { return r.json(); }).then(function (b) {
    var out = '<h1>Roadmap</h1>';
    // Rendered by the server, like the written pages.
    if (b.introHtml) out += b.introHtml;
    else if (b.intro) out += '<p>' + esc(b.intro) + '</p>';
    // Every section is drawn, in its order, none filtered by name (#2560: a
    // Done filter here once kept finished work off the page). Which lanes
    // there are is the bot's to say, and since 26 Oct it writes no Done.
    var live = b.sections || [];
    live.forEach(function (sec) {
      var cols = sec.columns || [], rows = sec.rows || [];
      if (!rows.length) return;
      out += '<div class="lane"><h2>' + esc(sec.name) + '</h2><div class="card-row">';
      rows.forEach(function (r) {
        var c = r.cells || {};
        var title = cols[0] ? (c[cols[0].id] || '') : '';
        var rest = cols.slice(1).map(function (col) { return c[col.id]; })
                       .filter(Boolean).join(' \u00b7 ');
        out += '<div class="r"><b>' + esc(title) + '</b>' +
               (rest ? '<span>' + esc(rest) + '</span>' : '') + '</div>';
      });
      out += '</div></div>';
    });
    // Built from the issue board by the bot (#3140): a roadmap it could not
    // read is said, never drawn as an empty one.
    if (b.unread) out += '<p>The roadmap could not be read from the issue board just now. Try again in a few minutes.</p>';
    else if (!live.some(function (s) { return (s.rows || []).length; })) {
      out += '<p>Nothing on it yet.</p>';
    }
    if (b.at) out += '<p><em>Read from the issue board ' + esc(b.at) + '.</em></p>';
    show(out);
  }).catch(function () { show('<h1>Roadmap</h1><p>Could not load it.</p>'); });
} else if (here === '/news') {
  request('/api/releases').then(function (r) { return r.json(); }).then(function (d) {
    var out = '<h1>Every release</h1>';
    if (d.launcher) out += '<p>Launcher <b>' + esc(d.launcher) + '</b> is current.</p>';
    if (!(d.news || []).length) out += '<p>No release notes are available yet.</p>';
    (d.news || []).forEach(function (n) {
      /* An entry whose details were written as one line came through as a
         string, .map threw on it, and because the catch below sits on the same
         chain as this render, the page said it could not load when it had
         loaded fine. Take a list or a line. */
      var det = Array.isArray(n.details) ? n.details : (n.details ? [n.details] : []);
      out += '<div class="rel"><div class="when">' + esc(n.date || '') + '</div>' +
             '<h2>' + esc(n.title || '') + '</h2>' +
             (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
             (det.length
               ? '<ul>' + det.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
                 (n.files ? '<li>' + n.files + ' files changed</li>' : '') + '</ul>'
               : '') +
             '</div>';
    });
    show(out);
  }).catch(function () { show('<h1>Every release</h1><p>Could not load it.</p>'); });
} else if (here === '/gallery') {
  /* Public approved shots and a themed submit form for signed-in members.
     Staff Accept and Delete live on the hub Gallery page.
     Public report is the per-image flag on live shots; bug reports go to Inbox. */
  /* The pictures are drawn as soon as /api/public answers, and drawn again
     with the Send and Report parts once /api/gallery/who has said who is
     asking (#1096). They used to wait for both, so a signed in visitor saw
     nothing while the site asked Discord who they were. */
  var galData = null, galWho = null;
  request('/api/gallery/who', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .catch(function () { return {}; })
    .then(function (w) { galWho = w || {}; if (galData) drawGallery(); });
  request('/api/public?galleryLimit=24').then(function (r) { return r.json(); }).then(function (d) {
    galData = d || {};
    drawGallery();
  }).catch(function () { show('<h1>From the world</h1><p>Could not load it.</p>'); });
  function drawGallery() {
    var d = galData;
    var waiting = !galWho;
    var who = galWho || {};
    var shots = d.gallery || [];
    var out = '<h1>From the world</h1><p>Every picture here was taken by ' +
      'somebody playing. Send yours in and it waits for staff to put it up.</p>';

    if (who.canSubmit) {
      out += '<div class="gal-box" id="galSubmit">' +
        '<h2>Send a picture</h2>' +
        '<p class="hint">png, jpg, webp or gif, up to 25 MB each. Large still pictures are reduced to at most 2560 pixels and converted to WebP when that makes them smaller. Animated GIFs stay unchanged. They go to the queue, not live.</p>' +
        '<div class="form">' +
        '<div class="gal-field">' +
        '<span class="gal-label">Pictures</span>' +
        '<div class="gal-drop" id="galDrop">' +
        '<input type="file" id="galFile" accept=".png,.jpg,.jpeg,.webp,.gif,image/*" multiple tabindex="-1" aria-hidden="true">' +
        '<p class="gal-drop-lead">Drop pictures here or choose files</p>' +
        '<div class="file-pick">' +
        '<button class="btn gal-pick" type="button" id="galPick">Choose pictures</button>' +
        '<span class="file-name" id="galFileName">No file chosen</span>' +
        '</div>' +
        '<ul class="gal-chosen" id="galChosen" hidden></ul>' +
        '</div></div>' +
        '<div class="gal-field">' +
        '<label class="gal-label" for="galBy">By</label>' +
        '<input type="text" id="galBy" maxlength="40" placeholder="a name for the caption" autocomplete="nickname">' +
        '</div>' +
        '<div class="gal-field">' +
        '<label class="gal-label" for="galNote">Note<span class="gal-opt">optional</span></label>' +
        '<input type="text" id="galNote" maxlength="300" placeholder="a short note for staff">' +
        '</div>' +
        '<p class="hint">Submit only pictures you have permission to share. Staff review them before publication. ' +
        'Avoid personal information. <a href="/terms">Submission terms</a> and <a href="/privacy">privacy details</a>.</p>' +
        '<div><button class="btn first" type="button" id="galSend">Send pictures</button></div>' +
        '<p class="said" id="galSaid" role="status" aria-live="polite" hidden></p>' +
        '</div></div>';
    } else if (waiting) {
      out += '<div class="gal-box"><p class="hint">Checking who you are.</p></div>';
    } else if (who.signed && who.asked === false) {
      out += '<div class="gal-box"><p class="hint">Thornswood could not ask Discord about your ' +
        'account just now, so sending a picture has to wait. Try again in a minute.</p></div>';
    } else if (who.signed) {
      out += '<div class="gal-box"><p class="hint">Your Discord account is signed in, ' +
        'but it does not have a role that can send pictures yet.</p></div>';
    } else {
      out += '<div class="gal-box"><p class="hint">Sign in with Discord to send a picture. ' +
        'The launcher can send one in from the game as well.</p>' +
        '<p><a class="btn first" href="/auth/discord?back=' + encodeURIComponent('/gallery') +
        '">Sign in with Discord</a></p></div>';
    }

    function galleryCards(items) {
      return items.map(function (g) {
        var description = esc(g.alt || 'Skyrim scene shared by ' + (g.by || 'the Thornswood community'));
        var recording = /\.(mp4|webm)$/i.test(g.name || '');
        var media = recording
          ? '<video controls preload="metadata" aria-label="' + description + '"><source src="' + esc(g.url) + '"></video>'
          : '<img src="' + esc(g.url) + '"' +
            // Its smaller copies (#3218). A card is a column of a grid at
            // least 260 wide: one column up to 620, then about a third.
            (g.srcset ? ' srcset="' + esc(g.srcset) + '" sizes="(max-width: 620px) calc(100vw - 48px), 34vw"' : '') +
            ' alt="' + description + '" loading="lazy">';
        var card = '<div class="shot-card"><div class="shot">' + media + '</div>';
        if (g.by) card += '<div class="also faintly">' + esc(g.by) + '</div>';
        // Per-image report for live public shots only. No staff inbox here.
        if (who.signed || who.canSubmit) {
          card += '<div class="shot-actions">' +
            '<button class="btn ghost" type="button" data-galreport="' + esc(g.name) +
            '">Report</button></div>';
        }
        card += '</div>';
        return card;
      }).join('');
    }
    if (!shots.length) out += '<p class="faint-mt-28">No approved pictures are available yet.</p>';
    out += '<div class="gallery" id="galleryCards">' + galleryCards(shots) + '</div>';
    if (d.galleryNext !== null && d.galleryNext !== undefined) {
      out += '<p><button class="btn ghost" type="button" id="galMore">Load more pictures</button></p>' +
        '<p id="galMoreStatus" role="status" aria-live="polite"></p>';
    }
    show(out);
    var more = document.getElementById('galMore');
    if (more && d.galleryNext !== null && d.galleryNext !== undefined) more.addEventListener('click', function () {
      if (more.disabled) return;
      more.disabled = true; more.textContent = 'Loading pictures';
      request('/api/gallery?offset=' + d.galleryNext).then(function (r) { return r.json(); }).then(function (page) {
        galData.gallery = galData.gallery.concat(page.gallery || []);
        galData.galleryNext = page.next;
        document.getElementById('galleryCards').insertAdjacentHTML('beforeend', galleryCards(page.gallery || []));
        bindGalleryReports();
        more.disabled = false; more.textContent = 'Load more pictures';
        var status = document.getElementById('galMoreStatus');
        status.textContent = 'Loaded ' + (page.gallery || []).length + ' more pictures.';
        if (page.next === null || page.next === undefined) {
          more.hidden = true; status.tabIndex = -1; status.focus();
        }
      }).catch(function () {
        more.disabled = false; more.textContent = 'Load more pictures';
        document.getElementById('galMoreStatus').textContent = 'Could not load more pictures. Try again.';
      });
    });

    function said(msg, bad) {
      var el = document.getElementById('galSaid');
      if (!el) return;
      el.hidden = false;
      el.textContent = msg;
      el.style.color = bad ? 'var(--faint)' : 'var(--gold)';
    }

    var f = document.getElementById('galFile');
    var pick = document.getElementById('galPick');
    var nameEl = document.getElementById('galFileName');
    var chosenEl = document.getElementById('galChosen');
    var box = document.getElementById('galDrop');
    var picked = [];
    var previewUrls = [];

    function clearPreviews() {
      // revokeObjectURL does not throw, even for a URL already revoked.
      previewUrls.forEach(function (u) { URL.revokeObjectURL(u); });
      previewUrls = [];
    }

    function fmtSize(n) {
      if (n == null || isNaN(n)) return '';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) {
        var kb = n / 1024;
        return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB';
      }
      return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function showPicked() {
      if (!nameEl) return;
      if (!picked.length) nameEl.textContent = 'No file chosen';
      else if (picked.length === 1) nameEl.textContent = picked[0].name;
      else nameEl.textContent = picked.length + ' files chosen';

      if (!chosenEl) return;
      clearPreviews();
      chosenEl.innerHTML = '';
      if (!picked.length) {
        chosenEl.hidden = true;
        return;
      }
      chosenEl.hidden = false;
      picked.forEach(function (file, idx) {
        var li = document.createElement('li');
        li.className = 'gal-chosen-item';

        var thumb = document.createElement('div');
        thumb.className = 'gal-chosen-thumb';
        if (/^image\//.test(file.type || '') ||
            /\.(png|jpe?g|webp|gif)$/i.test(file.name || '')) {
          var img = document.createElement('img');
          var url = URL.createObjectURL(file);
          previewUrls.push(url);
          img.src = url;
          // This local preview repeats the filename and size below, so it is decorative by design.
          img.alt = '';
          thumb.appendChild(img);
        }

        var meta = document.createElement('div');
        meta.className = 'gal-chosen-meta';
        var nm = document.createElement('div');
        nm.className = 'gal-chosen-name';
        nm.textContent = file.name || 'picture';
        var sz = document.createElement('div');
        sz.className = 'gal-chosen-size';
        sz.textContent = fmtSize(file.size);
        meta.appendChild(nm);
        meta.appendChild(sz);

        var rm = document.createElement('button');
        rm.className = 'btn ghost gal-chosen-x';
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Remove ' + (file.name || 'picture'));
        rm.textContent = 'Remove';
        rm.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          picked.splice(idx, 1);
          if (f) f.value = '';
          showPicked();
        });

        li.appendChild(thumb);
        li.appendChild(meta);
        li.appendChild(rm);
        chosenEl.appendChild(li);
      });
    }

    function takeFiles(list) {
      var add = Array.prototype.slice.call(list || []).filter(function (file) {
        if (!file) return false;
        if (/^image\//.test(file.type || '')) return true;
        return /\.(png|jpe?g|webp|gif)$/i.test(file.name || '');
      });
      if (!add.length) return;
      picked = picked.concat(add);
      showPicked();
    }

    if (pick && f) {
      pick.addEventListener('click', function () { f.click(); });
      f.addEventListener('change', function () {
        picked = Array.prototype.slice.call((f.files && f.files) || []);
        showPicked();
      });
    }

    if (box) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        box.addEventListener(ev, function (e) {
          e.preventDefault(); e.stopPropagation();
          box.classList.add('drag');
        });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        box.addEventListener(ev, function (e) {
          e.preventDefault(); e.stopPropagation();
          if (ev === 'dragleave') box.classList.remove('drag');
        });
      });
      box.addEventListener('drop', function (e) {
        box.classList.remove('drag');
        var dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) takeFiles(dt.files);
      });
    }

    var send = document.getElementById('galSend');
    if (send) {
      send.addEventListener('click', function () {
        if (send.disabled) return;
        var list = picked.length ? picked.slice() :
          (f && f.files ? Array.prototype.slice.call(f.files) : []);
        if (!list.length) { said('Choose a picture first.', true); return; }
        var by = (document.getElementById('galBy').value || '').trim();
        var note = (document.getElementById('galNote').value || '').trim();
        send.disabled = true; send.textContent = 'Sending';
        // One request per file, in order. The submit door writes gallery-pending.json
        // as read-modify-write, so parallel posts could drop an entry.
        var i = 0, names = [], fail = null, copyBad = '';
        function next() {
          if (fail || i >= list.length) {
            if (fail) said(fail, true);
            else {
              said((names.length === 1
                ? 'Sent. Staff will look at it before it goes up.'
                : ('Sent ' + names.length + '. Staff will look at them before they go up.')) +
                (copyBad ? ' ' + copyBad : ''));
              picked = [];
              if (f) f.value = '';
              showPicked();
            }
            send.disabled = false; send.textContent = 'Send pictures';
            return;
          }
          var sent;
          preparePicture(list[i++]).then(function (file) {
            sent = file;
            var q = '/api/gallery/submit?name=' + encodeURIComponent(file.name) +
            (by ? '&by=' + encodeURIComponent(by) : '') +
            (note ? '&note=' + encodeURIComponent(note) : '');
            return request(q, { method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': file.type || 'application/octet-stream' },
            body: file });
          })
            .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
            .then(function (x) {
              if (x.ok && x.j && x.j.ok) {
                names.push(x.j.name);
                // Then its smaller copies; one that does not go is said, and
                // the picture is still in.
                return sendCopies(sent, x.j.name).then(function (bad) {
                  if (bad && !copyBad) copyBad = bad;
                  next();
                });
              }
              else {
                fail = (x.j && (x.j.error || x.j.why)) || 'Could not send it.';
                if (names.length) fail = 'Sent ' + names.length + ', then stopped: ' + fail;
                next();
              }
            })
            .catch(function (e) {
              fail = e.message || 'Could not send it.';
              if (names.length) fail = 'Sent ' + names.length + ', then stopped: ' + fail;
              next();
            });
        }
        next();
      });
    }

    function bindGalleryReports() {
    document.querySelectorAll('[data-galreport]:not([data-report-bound])').forEach(function (b) {
      b.setAttribute('data-report-bound', 'true');
      b.addEventListener('click', function () {
        var why = window.prompt('Why are you reporting this picture?', '');
        if (why === null) return;
        b.disabled = true;
        request('/api/gallery/report', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: b.getAttribute('data-galreport'), why: why })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (x) {
            if (x.ok) { b.textContent = 'Reported'; }
            else { b.disabled = false; window.alert((x.j && x.j.error) || 'Could not report it.'); }
          })
          .catch(function () { b.disabled = false; window.alert('Could not report it.'); });
      });
    });
    }
    bindGalleryReports();
  }
} else if (here === '/downloads') {
  /* This is the How to join section off the front page. It lived there and on
     this page in two different shapes, which meant two places to keep right
     and a front page that would not end. It is one place now, and this is the
     page the front page points at. */
  request('/api/public?galleryLimit=24').then(function (r) { return r.json(); }).then(function (d) {
    var files = d.files || [];

    // The stamp under the download button, read the way a clock is read.
    //
    // A file in the downloads folder may carry a 24 hour time, which is shown
    // to people, not to a machine. Anything that is not a plain date and time
    // is left exactly as it is: the installer's is the tag of the Release it
    // is on (build-20261101.7 and the like), which says which build it is.
    function clock(v) {
      var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v || ''));
      if (!m) return v;
      var h = parseInt(m[4], 10);
      var half = h < 12 ? 'AM' : 'PM';
      h = h % 12; if (h === 0) { h = 12; }
      return parseInt(m[2], 10) + '-' + parseInt(m[3], 10) + '-' + m[1] +
             ' ' + h + ':' + m[5] + ' ' + half;
    }

    function human(b) {
      if (!b) return '';
      if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
      if (b >= 1048576)    return Math.round(b / 1048576) + ' MB';
      return Math.max(1, Math.round(b / 1024)) + ' KB';
    }
    // The installer's SHA-256, under the size and date, as GitHub measured it
    // on the Release. A file with none shows nothing rather than a link to
    // nothing.
    function hash(f) {
      return f && /^[0-9a-f]{64}$/.test(f.sha256 || '') ? f.sha256 : '';
    }
    function sum(f) {
      var h = hash(f);
      if (!h) return '';
      // The label is held together with white-space:nowrap so the browser cannot
      // soft-break it at the ASCII hyphen (SHA- / 256). The non-breaking space
      // keeps the whole label on the same line as the hash's start, and the hash
      // wraps within itself if the column is narrow.
      return '<br><span class="nowrap">SHA-256</span>&nbsp;' +
             '<span class="wrap-anywhere">' + h + '</span>';
    }
    // hidden is a file on the site for something other than people, never on
    // this page.
    function pick(ext) {
      for (var i = 0; i < files.length; i++) {
        if (files[i].hidden) continue;
        if ((files[i].name || '').toLowerCase().slice(-ext.length) === ext) return files[i];
      }
      return null;
    }
    // The installer is Velopack's setup program from a GitHub Release, the
    // launcher's package inside it (#4824): one file, nothing beside it.
    var exe = pick('.exe');

    var out = '<h1>Download</h1>';
    if (d.launcher) out += '<p>Launcher <strong>' + esc(d.launcher) + '</strong> is current.</p>';

    out += '<p class="lede">You need a legitimate copy of <strong>Skyrim Special ' +
           'Edition</strong> on Steam, on build <strong>1.6.1170</strong> (if yours is ' +
           'newer, the launcher has a button that puts it back; Steam does the download ' +
           'under your own account), and ' +
           '<strong>Vortex</strong> with a free Nexus Mods account, which is how the ' +
           'mods get to you.</p>' +
           '<p class="lede"><strong>Eighteen and over.</strong> Downloading or playing ' +
           'Thornswood is you stating that you are eighteen or older.</p>' +
           // The one switch (#428): /api/public says open when the site's
           // config does, and this says what is true either way.
           (d.open === true
             ? '<p class="lede"><strong>Thornswood is open.</strong> Anyone can download ' +
               'it, and anyone in the Discord can play. Being there means accepting the ' +
               '<a href="/rules">rules</a>.</p>'
             : '<p class="lede"><strong>Thornswood is in alpha, and the world is open by ' +
               'application.</strong> The installer is open to anybody, so you can download ' +
               'and install it now. Play unlocks once you have applied in the Discord and been ' +
               'given the Playtester role. The application asks whether you are eighteen or ' +
               'over and whether you accept the <a href="/rules">rules</a>, and your answers ' +
               'are kept against your Discord account.</p>');

    // The button belongs under the step that tells you to take it, not above
    // the list where it is the first thing you meet and the instructions are
    // something you scroll past afterwards.
    // "Published by" names who Windows names (#5275, Patrick's answer A on
    // q-installer-publisher), when the entry says so. It said "Thornswood",
    // which is not what the Windows prompt says next. An entry with no
    // publisher names nobody, which the Release's installer is until the site
    // can say who signed it.
    var by = exe && exe.publisher ? 'Published by ' + esc(exe.publisher) + '<br>' : '';
    var grab = '';
    if (!exe) {
      grab = '<p class="faint">The installer is not published yet.</p>';
    } else {
      grab = '<div class="grab"><a class="btn first" href="/file/' + encodeURIComponent(exe.name) + '">' +
             'Download the installer</a>' +
             '<p class="also faintly">' + by + esc(human(exe.size)) +
             (exe.version ? ' · ' + esc(clock(exe.version)) : '') + sum(exe) + '</p></div>';
    }

    out += (d.open === true
             ? '<h2>Join the Discord, then four steps</h2>' +
               '<div class="steps">' +
               '<div class="step"><div><h3>Come into the Discord</h3>' +
                 '<p>Anyone in the Discord can play. Read the <a href="/rules">rules</a>, ' +
                 'because being there means accepting them. Your Discord account is what ' +
                 'lets you through, so there is nothing else to sign up for.</p>'
             : '<h2>Apply in Discord, then four steps</h2>' +
               '<div class="steps">' +
               '<div class="step"><div><h3>Come into the Discord and apply</h3>' +
                 '<p>The installer is open to anybody, and this is the step that unlocks ' +
                 'Play. Read the <a href="/rules">rules</a>, then open a ticket and pick ' +
                 'Apply to be an alpha playtester. It asks whether you are eighteen or over, ' +
                 'whether you accept the rules, and a few lines about who you want to play. ' +
                 'It is not an essay, and somebody answers. Once you are accepted your ' +
                 'Discord account is what lets you through, so there is nothing else to sign ' +
                 'up for.</p>') +
             // The first step is the only one that had no way to do it from
             // here. The installer has its two buttons and the collection has
             // one, and this said come into the Discord without a door. The
             // invite comes from version.json by way of the feed, the same as
             // the collection's address, so there is one copy of it.
             (d.invite
               ? '<div class="grab"><a class="btn first" href="' + esc(d.invite) +
                 '" target="_blank" rel="noopener">Open the Discord</a>' +
                 '<p class="also faintly">The invite never expires.' +
                 (d.open === true ? '' : ' Open a ticket once you are in.') + '</p></div>'
               : '') +
             '</div></div>' +
           '<div class="step"><div><h3>Take the installer</h3>' +
             '<p>One file. Download it and run it. The mods are not in it. It puts in ' +
             'the launcher with Thornswood&rsquo;s own content and opens it, and the ' +
             'launcher asks where to install, puts in the script extender and ' +
             'builds a game folder of its own from the Skyrim you already have, with ' +
             'most of it as hard links, and leaves your own Skyrim alone. The SkyMP files in it are free software, and the credits page ' +
             // Beside the download button because that is where the files are
             // handed over. Entry 170 on the To Do List: the source had to be
             // reachable "from the download page". It says where the source is
             // rather than that it is all public, because one SkyMP build in
             // the installer has no recorded version and the page says so.
             'says <a href="/credits#source">where their source code is</a>.</p>' +
             grab + '</div></div>' +
           '<div class="step"><div><h3>Install the collection in Vortex</h3>' +
             '<p>Not optional. Without it you have a launcher and no mods, and the ' +
             'server turns you away when you press Play. The mods come from a ' +
             'collection on Nexus, so every one of them arrives from its own author ' +
             'rather than from a copy of ours, and a mod update stops meaning a ' +
             'reinstall. Vortex keeps them in a profile of their own, so switching ' +
             'back to your usual profile and running Purge Mods leaves you where you ' +
             'started.</p>' +
             // The step said install the collection and never said where. The
             // address comes from version.json by way of the news feed, so there
             // is one copy of it and it cannot go stale here.
             // The link opens the revision the server was built against, not
             // the collection's page, which Nexus always shows at its newest
             // (#4115): a newer revision than the server's keeps Play shut.
             (d.collection
               ? '<div class="grab"><a class="btn first" href="' + esc(d.collection) +
                 '" target="_blank" rel="noopener">' +
                 (d.collectionRevision > 0 ? 'Open revision ' + esc(String(d.collectionRevision)) : 'Open the collection') +
                 '</a>' +
                 '<p class="also faintly">' +
                 (d.collectionRevision > 0
                   ? 'Opens revision ' + esc(String(d.collectionRevision)) + ' on Nexus, the one the ' +
                     'server was built against. Install that one in Vortex, not a newer one ' +
                     'Nexus may show first.'
                   : 'Opens on Nexus. Vortex takes it from there.') +
                 '</p></div>'
               : '') +
             '</div></div>' +
           '<div class="step"><div><h3>Connect your Discord in the launcher</h3>' +
             '<p>One click. Your browser opens, you say yes, and it closes itself. ' +
             'You never do it again.</p></div></div>' +
           '<div class="step"><div><h3>Press Play</h3>' +
             '<p>No address to type, no password to remember. Once your Discord has the ' +
             'role, the launcher patches anything that changed and puts you in the ' +
             'world.</p></div></div>' +
           '</div>';

    out += (d.open === true
             ? '<p class="lede lede-mt-34">The installer is open to anybody, ' +
               'and so is the world: the launcher asks Discord who you are every time it ' +
               'starts, and being in the Discord is enough.</p>'
             : '<p class="lede lede-mt-34">The installer is open to anybody, ' +
               'and the world is open by application: the launcher asks Discord who you are ' +
               'every time it starts, so downloading it before you have been accepted just ' +
               'means you are ready when you are.</p>') +
           '<div class="acts acts-start">' +
           '<a class="btn first" href="' + esc(d.invite || '/join') + '" target="_blank" ' +
           'rel="noopener">' + (d.open === true ? 'Join the Discord' : 'Apply in the Discord') + '</a>' +
           '<a class="btn ghost" href="/join">The long version</a></div>';

    show(out);
  }).catch(function () { show('<h1>Download</h1><p>Could not load it.</p>'); });

} else if (here === '/report') {
  /* Open to anybody. Somebody whose install will not start cannot sign in to
     say so, and telling them to ask in Discord first is how a bug becomes
     nobody bothering. */
  show('<h1>Report a problem</h1>' +
    '<p>Something broken, or an idea. Either one lands in front of whoever is ' +
    'fixing things. You do not need an account and nothing here is public.</p>' +
    '<p>Somebody behaving badly goes here too: tick the box about a person. ' +
    'That one needs you signed in with Discord, and only staff read it.</p>' +
    '<form id="rep" class="form">' +
    '<div><label for="rTitle">What happened</label>' +
      '<span class="hint">One line. The rest goes below.</span>' +
      '<input id="rTitle" type="text" maxlength="200" required></div>' +
    '<div><label for="rDetail">Anything else</label>' +
      '<span class="hint">What you were doing, what you expected, where it was.</span>' +
      '<textarea id="rDetail" maxlength="8000"></textarea></div>' +
    '<div><label for="rBy">Your Discord name</label>' +
      '<span class="hint">So somebody can come back to you. Optional.</span>' +
      '<input id="rBy" type="text" maxlength="40"></div>' +
    // Off the page and out of the tab order, so a person never meets it and a
    // script that fills in every box does. The site keeps nothing that comes
    // back with it filled in.
    '<div aria-hidden="true" class="hp-trap"><label for="rHome">Leave this empty</label>' +
      '<input id="rHome" name="homepage" type="text" tabindex="-1" ' +
      'autocomplete="off"></div>' +
    '<label class="check"><input type="checkbox" id="rIdea"> ' +
      'This is an idea, not a fault</label>' +
    /* Reporting a person (#414). Never anonymous: the site keeps it against
       the Discord account that sent it, so this half asks for a sign in and
       the server refuses it without one. */
    '<label class="check"><input type="checkbox" id="rPerson"> ' +
      'This is about a person, not the game</label>' +
    '<div id="rWhoBox" hidden><label for="rWho">Who</label>' +
      '<span class="hint">Their character name, or their Discord name. It goes to ' +
      'staff and nobody else, and staff see that it came from you.</span>' +
      '<input id="rWho" type="text" maxlength="60">' +
      '<p id="rSign" class="hint" hidden>Reporting somebody needs you signed in, so staff ' +
      'can come back to you about it. <a href="/auth/discord?back=/report">Sign in with ' +
      'Discord</a>. In the game, /report does the same.</p>' +
      '<p id="rNo" class="hint" hidden></p></div>' +
    '<p class="hint">We use what you send to investigate and respond. Your Discord name is optional for game faults and ideas. ' +
      'Do not send passwords, access tokens, payment details, or unrelated personal information. ' +
      '<a href="/privacy">How reports are stored and used</a>. Staff work in their own time; there is no guaranteed response time.</p>' +
    // Cloudflare Turnstile's check that a person is sending it (#3216),
    // drawn here when the site has a key for it.
    '<div id="rCheck" class="ts-check" hidden></div>' +
    '<div><button class="btn first" type="submit">Send report</button></div>' +
    '<p id="rSaid" class="said" role="status" aria-live="polite" hidden></p>' +
    '</form>');
  var form = document.getElementById('rep');
  /* Turnstile (#3216). The site says whether the check is on and with which
     key; off, nothing is loaded from Cloudflare and the form is as it was.
     On, the widget's pass goes with the report, and a pass is good once, so
     the widget is drawn again after every answer. tsWanted is true while the
     check is on and has not given a pass yet. */
  var tsWanted = false, tsToken = '', tsWidget = null;
  function tsReset() {
    tsToken = '';
    if (tsWidget !== null && window.turnstile) window.turnstile.reset(tsWidget);
  }
  request('/api/report/form').then(function (r) { return r.json(); }).then(function (d) {
    var key = d && d.turnstile;
    if (!key) return;
    tsWanted = true;
    var box = document.getElementById('rCheck');
    box.hidden = false;
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = function () {
      tsWidget = window.turnstile.render(box, {
        sitekey: key, action: 'report', theme: 'dark',
        callback: function (t) { tsToken = t; },
        'expired-callback': function () { tsToken = ''; },
        'error-callback': function () { tsToken = ''; }
      });
    };
    s.onerror = function () {
      box.textContent = 'The check that you are a person could not load, so this form cannot send. ' +
        'Something in this browser may be blocking challenges.cloudflare.com.';
    };
    document.head.appendChild(s);
  }).catch(function () { /* the form still sends; the site says if it needed the check */ });
  /* Who is asking, told apart (#1097): not signed in gets the sign in link;
     signed in but not let in, banned, or Discord not answering gets the
     site's own sentence (personSays, what /api/report would answer) and no
     link, because they are signed in already. letIn is null until the site
     answers, and the button waits for it. */
  var letIn = null, personSays = '', needsSignIn = true;
  request('/api/gallery/who', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      d = d || {};
      letIn = !d.personWhy;
      needsSignIn = d.personWhy === 'sign in';
      personSays = d.personSays || '';
      personBox();
    })
    .catch(function () { letIn = false; personBox(); });
  function personBox() {
    var on = document.getElementById('rPerson').checked;
    var sign = document.getElementById('rSign');
    var no = document.getElementById('rNo');
    document.getElementById('rWhoBox').hidden = !on;
    sign.hidden = !on || letIn !== false || !needsSignIn;
    no.hidden = !on || letIn !== false || needsSignIn || !personSays;
    no.textContent = personSays;
    document.getElementById('rIdea').disabled = on;
    form.querySelector('button').disabled = on && !letIn;
  }
  document.getElementById('rPerson').addEventListener('change', personBox);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var said = document.getElementById('rSaid');
    var btn = form.querySelector('button');
    if (btn.disabled) return;
    // Said at once, on the button and under it, so a press never looks like
    // nothing happened (#467). The site answers inside a second; if nothing
    // has come back in fifteen, the page stops waiting and says so rather
    // than leaving the button grey.
    btn.disabled = true;
    btn.textContent = 'Sending';
    said.hidden = false;
    said.textContent = 'Sending it.';
    var ctl = window.AbortController ? new AbortController() : null;
    var gaveUp = false;
    var timer = setTimeout(function () { gaveUp = true; if (ctl) ctl.abort(); }, 15000);
    function finish(text) {
      clearTimeout(timer);
      said.hidden = false;
      said.textContent = text;
      btn.textContent = 'Send report';
      btn.disabled = false;
      personBox();
    }
    if (tsWanted && !tsToken) {
      finish('Wait for the tick under the form, then send it again.');
      return;
    }
    var aboutPerson = document.getElementById('rPerson').checked;
    request('/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', signal: ctl ? ctl.signal : undefined,
      body: JSON.stringify({
        title:  document.getElementById('rTitle').value,
        detail: document.getElementById('rDetail').value,
        by:     document.getElementById('rBy').value,
        homepage: document.getElementById('rHome').value,
        about:  aboutPerson ? document.getElementById('rWho').value : '',
        turnstile: tsToken,
        kind:   aboutPerson ? 'report'
              : (document.getElementById('rIdea').checked ? 'idea' : 'bug')
      })
    }).then(function (r) {
        // An answer that is not JSON (a proxy's error page) still ends here
        // with a message, not in the catch with the button left waiting.
        return r.json().catch(function () { return {}; })
          .then(function (j) { return { ok: r.ok, j: j || {} }; });
      })
      .then(function (res) {
        tsReset();
        if (res.ok) {
          form.querySelectorAll('input, textarea').forEach(function (i) {
            if (i.type === 'checkbox') { i.checked = false; } else { i.value = ''; }
          });
          finish(aboutPerson
            ? 'Sent to staff, and to nobody else. Somebody will read it.'
            : 'Sent. Somebody will read it.');
        } else {
          finish(res.j.error || 'That did not send. Try again in a minute.');
        }
      }).catch(function () {
        tsReset();
        finish(gaveUp
          ? 'No answer from the site after fifteen seconds, so it may not have gone. Try again in a minute.'
          : 'That did not send. Try again in a minute.');
      });
  });
}

/* The line under the title and the figure beside it: whether the world is
   up and who is in it, from /api/public. */
function paintStatus(d) {
  var dot = document.getElementById('dot'), t = document.getElementById('livetext');
  if (dot && t) {
    if (d.status && d.status.up) {
      dot.className = 'dot on';
      var n = d.status.online || 0;
      if (n === 0) {
        /* Patrick's line, 28 Sep (#884). The second half goes to /join,
           which says how to apply. Built from nodes, not markup. */
        t.textContent = 'The world is open, ';
        var apply = document.createElement('a');
        apply.href = '/join';
        /* With the one switch on (#428) there is nothing to apply for. */
        apply.textContent = d.open === true
          ? 'come into the Discord and play!'
          : 'apply to be an alpha playtester in the Discord!';
        t.appendChild(apply);
      } else {
        /* N of the most the world holds (#481). The site sends the number
           even when the server has not said it, from records\most-online.json.
           It is every seat, the staff seats too (Patrick, 12 Oct: "of 30"),
           so full can come before N reaches it: the seats past the door's
           number are kept for the staff roles, and the page says so.
           And how many wait at the menu when anybody does. */
        var most = d.status.max > 0 ? d.status.max : 0;
        var seen = most ? Math.min(n, most) : n;
        var waiting = d.status.line > 0 ? d.status.line : 0;
        if (most && (n >= most || d.status.full === true)) {
          t.textContent = 'The world is full, ' + seen + ' of ' + most + ' people are in it' +
            (n < most ? ' and the rest of the seats are kept for staff' : '') +
            (waiting ? ', ' + waiting + ' waiting for a seat' : '');
        } else if (most) {
          t.textContent = seen + ' of ' + most + ' people in the world';
        } else {
          t.textContent = n === 1 ? '1 person in the world' : n + ' people in the world';
        }
      }
      var f = document.getElementById('figOnline');
      var w = document.getElementById('figOnlineWrap');
      // Only worth a tile of its own once there is somebody in it.
      if (f && w && n > 0) {
        f.textContent = d.status.max > 0 ? Math.min(n, d.status.max) + ' of ' + d.status.max : String(n);
        w.hidden = false;
      } else if (w) {
        w.hidden = true;
      }
    } else {
      dot.className = 'dot';
      t.textContent = 'Server offline';
      var gone = document.getElementById('figOnlineWrap');
      if (gone) gone.hidden = true;
    }
  }
}

/* Back to this page from another one shows it as it was left (#3218: the
   public pages are no longer no-store, so the browser keeps them in its back
   and forward cache). Everything on it holds still except who is in the
   world, which is asked again rather than shown from minutes ago. */
window.addEventListener('pageshow', function (e) {
  if (!e.persisted) return;
  request('/api/public?galleryLimit=24', { credentials:'same-origin' })
    .then(function (r) { return r.json(); })
    .then(paintStatus)
    .catch(function () {
      // As on a first load that could not ask: say nothing rather than a
      // line from before that may no longer be true.
      var t = document.getElementById('livetext'), dot = document.getElementById('dot');
      if (t) t.textContent = '';
      if (dot) dot.className = 'dot';
    });
});

/* The three live things on the front page, all of them honest about being
   empty rather than filled with something invented. */
request('/api/public?galleryLimit=24', { credentials:'same-origin' })
  .then(function(r){ return r.json(); })
  .then(function(d){
    /* Both Patreon links are written into the markup, so they work before
       this fetch lands and they work if it never does. The config still wins
       when it says something different, which is the one place to change the
       address. This used to point at /support and be rewritten here; that
       page said what a tier cost while there was nowhere else to read it,
       and Patreon says it now. */
    if (d.patreon) {
      var links = [document.getElementById('navPatreon'),
                   document.getElementById('footPatreon')];
      for (var i = 0; i < links.length; i++) {
        if (links[i]) { links[i].href = d.patreon; }
      }
    }

    paintStatus(d);

    var rel = document.getElementById('releases');
    if (!rel) return;
    (d.news || []).slice(0, 4).forEach(function(n){
      var el = document.createElement('div');
      el.className = 'release';
      el.innerHTML = '<div class="when">' + esc(n.date || '') + '</div>' +
                     '<div class="what">' + esc(n.title || '') + '</div>';
      rel.appendChild(el);
    });
    if (!(d.news || []).length) {
      rel.innerHTML = '<p class="lede">Nothing shipped yet.</p>';
    }

    // Home slideshow of approved public shots. Hidden until there is at least
    // one, because an empty carousel is worse than no band. Staff tools stay
    // on the hub; this only turns through what strangers already see.
    var show = document.getElementById('galleryShow');
    var dots = document.getElementById('galleryDots');
    var band = document.getElementById('gallerySection');
    var shots = (d.gallery || []).filter(function (shot) { return !/\.(mp4|webm)$/i.test(shot.name || ''); });
    if (show && band && shots.length) {
      band.hidden = false;
      var i = 0;
      /* Only the picture on show and the one after it are fetched (#3218).
         Every picture had its address from the start, and loading="lazy" did
         not hold the rest back: they are stacked in the same box, so all of
         them are "in view" once the box is, and scrolling down to it fetched
         every shot in the gallery at once, 5 MB on 21 Oct 2026. Lazy now, as
         the band is far below the first screen. */
      var frames = shots.map(function (s, n) {
        var img = document.createElement('img');
        img.alt = s.alt || 'Skyrim scene shared by ' + (s.by || 'the Thornswood community');
        img.loading = 'lazy';
        if (n === 0) img.className = 'on';
        show.appendChild(img);
        return img;
      });
      // A picture's smaller copies (#3218) are set with its address, so
      // neither is fetched early. The band is the page's width less its
      // margins, at most 1480.
      function fetchFrame(n) {
        var img = frames[n];
        if (!img || img.getAttribute('src')) return;
        if (shots[n].srcset) {
          img.sizes = '(max-width: 1528px) calc(100vw - 48px), 1480px';
          img.srcset = shots[n].srcset;
        }
        img.src = shots[n].url;
      }
      fetchFrame(0);
      fetchFrame(1 % shots.length);
      var cap = document.createElement('div');
      cap.className = 'gal-cap';
      cap.innerHTML = (shots[0].by ? esc(shots[0].by) + ' \u00b7 ' : '') +
        '<a href="/gallery">Open the gallery</a>';
      show.appendChild(cap);
      if (shots.length > 1 && dots) {
        dots.hidden = false;
        shots.forEach(function (_s, n) {
          var b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('aria-label', 'Picture ' + (n + 1));
          if (n === 0) b.className = 'on';
          b.onclick = function () { go(n); };
          dots.appendChild(b);
        });
      }
      function go(n) {
        i = ((n % shots.length) + shots.length) % shots.length;
        fetchFrame(i);
        fetchFrame((i + 1) % shots.length);
        var imgs = show.querySelectorAll('img');
        for (var k = 0; k < imgs.length; k++) {
          imgs[k].className = k === i ? 'on' : '';
        }
        if (dots) {
          var bs = dots.querySelectorAll('button');
          for (var k = 0; k < bs.length; k++) {
            bs[k].className = k === i ? 'on' : '';
          }
        }
        cap.innerHTML = (shots[i].by ? esc(shots[i].by) + ' \u00b7 ' : '') +
          '<a href="/gallery">Open the gallery</a>';
      }
      var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      var timer = null;
      var paused = false;
      function stopFlip() {
        if (timer) { clearInterval(timer); timer = null; }
      }
      function startFlip() {
        stopFlip();
        if (reduce || paused || shots.length < 2) return;
        timer = setInterval(function () { go((i + 1) % shots.length); }, 5000);
      }
      function userStep(n) {
        go(n);
        paused = true;
        stopFlip();
        setTimeout(function () { paused = false; startFlip(); }, 8000);
      }
      if (shots.length > 1) {
        var prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'gal-nav gal-prev';
        prev.setAttribute('aria-label', 'Previous picture');
        prev.innerHTML = '&#8249;';
        prev.onclick = function () { userStep(i - 1); };
        var next = document.createElement('button');
        next.type = 'button';
        next.className = 'gal-nav gal-next';
        next.setAttribute('aria-label', 'Next picture');
        next.innerHTML = '&#8250;';
        next.onclick = function () { userStep(i + 1); };
        show.appendChild(prev);
        show.appendChild(next);
        show.addEventListener('mouseenter', function () { paused = true; stopFlip(); });
        show.addEventListener('mouseleave', function () { paused = false; startFlip(); });
        if (dots) {
          var bs0 = dots.querySelectorAll('button');
          for (var d = 0; d < bs0.length; d++) {
            (function (n) {
              bs0[n].onclick = function () { userStep(n); };
            })(d);
          }
        }
        startFlip();
      }
    }
  })
  .catch(function(){
    var t = document.getElementById('livetext');
    if (t) t.textContent = '';
  });

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
