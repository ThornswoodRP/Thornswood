// test-gallery-ux.js
//
// Public gallery themed like the site, home link + slideshow, one staff Accept/Delete grid on the hub Gallery page.
// Hub member upload/list/reports UI removed; public send form and per-image
// report stay on /gallery.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const HOME = path.join(ROOT, 'site', 'public', 'home.html');
const HUB = path.join(ROOT, 'site', 'public', 'index.html');
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// Each page as it reaches the browser: its markup, its style and its script.
// The style and script moved out of the pages into home.css, home.js, hub.css
// and hub.js in #1479 (no inline style or script under the content security
// policy), so each page is read with its two files after it.
function pageOf(html, css, js) {
  return [html, css, js].map(function (f) {
    return fs.readFileSync(path.join(ROOT, 'site', 'public', f), 'utf8').split(CR).join('');
  }).join('\n');
}
const home = pageOf(path.basename(HOME), 'home.css', 'home.js');
const hub = pageOf(path.basename(HUB), 'hub.css', 'hub.js');

// By its opening: #1585 gave the bar an aria-label.
const barA = home.indexOf('<nav class="top" id="nav"');
const barB = home.indexOf('</nav>', barA);
const bar = home.slice(barA, barB);
yes('top bar links to /gallery', /href="\/gallery">Gallery</.test(bar));
// The footer's headings are h2 since #1585 (heading order).
yes('footer Community links to /gallery',
    /<h2>Community<\/h2>\s*<a href="\/gallery">Gallery<\/a>/.test(home));

yes('home has gallery slideshow shell', /id="galleryShow"/.test(home));
yes('home has See the gallery link', /See the gallery/.test(home));
yes('landing build starts a rotating slideshow',
    /setInterval\(function \(\) \{ go\(\(i \+ 1\) % shots\.length\); \}, 5000\)/.test(home) &&
    /function startFlip\(\)/.test(home));
yes('slideshow respects reduced motion',
    /prefers-reduced-motion: reduce/.test(home) &&
    /if \(reduce \|\| paused \|\| shots\.length < 2\) return/.test(home));
yes('slideshow has themed prev next arrows',
    /gal-nav gal-prev/.test(home) && /gal-nav gal-next/.test(home) &&
    /\.gal-show \.gal-nav\{[^}]*border:1px solid var\(--gold\)/.test(home) &&
    /aria-label', 'Previous picture'/.test(home) &&
    /aria-label', 'Next picture'/.test(home));
// Since #1585 a picture's alt is its own stored alt first, then who shared
// it, then the community, and never the bare words Gallery image.
yes('gallery cards use the picture\'s alt, By, or a descriptive fallback',
    /var description = esc\(g\.alt \|\| 'Skyrim scene shared by ' \+ \(g\.by \|\| 'the Thornswood community'\)\);/.test(home) &&
    /alt="' \+ description \+ '"/.test(home));
yes('gallery slideshow uses the picture\'s alt, By, or a descriptive fallback',
    /img\.alt = s\.alt \|\| 'Skyrim scene shared by ' \+ \(s\.by \|\| 'the Thornswood community'\);/.test(home));
yes('hub gallery thumbnails use By or contextual fallback alts',
    /esc\(g\.by \|\| 'Pending gallery image'\)/.test(hub) &&
    /esc\(g\.by \|\| 'Live gallery image'\)/.test(hub));
yes('selected upload previews document their decorative empty alt',
    /decorative by design/.test(home) && /img\.alt = ''/.test(home));
yes('slideshow pauses on hover and arrow use',
    /mouseenter/.test(home) && /mouseleave/.test(home) &&
    /function userStep\(n\)/.test(home) && /stopFlip\(\)/.test(home));
yes('slideshow fills wrap width without max-height shrink',
    /aspect-ratio:16\/9;width:100%/.test(home) &&
    !/gal-show\{[^}]*max-height:480px/.test(home));
yes('site wraps are wider and centered',
    /\.wrap\{width:min\(1480px/.test(home) &&
    /\.page \.wrap\{width:min\(1120px/.test(home) &&
    /margin-inline:auto/.test(home));

yes('gal-box uses stone panel, not iron slab',
    /\.gal-box\{[^}]*background:var\(--stone\)/.test(home));
yes('gal-box heading is gold carve',
    /\.gal-box h2\{[^}]*color:var\(--gold\)/.test(home));

yes('public gallery keeps Send a picture for members',
    /id="galSubmit"/.test(home) && /Send a picture/.test(home));
yes('send form does not show Signed in as',
    !/Signed in as /.test((home.match(/id="galSubmit"[\s\S]{0,900}/) || [''])[0]));
yes('send form hides native file input and offers Choose pictures',
    /\.gal-box \.form input\[type=file\]\{[^}]*clip:rect\(0,0,0,0\)/.test(home) &&
    /id="galPick">Choose pictures</.test(home) &&
    /id="galFileName">No file chosen</.test(home));
yes('chosen list mounts under the drop zone',
    /id="galChosen"/.test(home) &&
    /class="gal-chosen"/.test(home));
yes('chosen list shows thumbnail, filename, size and Remove',
    /gal-chosen-thumb/.test(home) &&
    /gal-chosen-name/.test(home) &&
    /gal-chosen-size/.test(home) &&
    /createObjectURL/.test(home) &&
    /gal-chosen-x/.test(home) &&
    /textContent = 'Remove'/.test(home) &&
    /picked\.splice\(idx, 1\)/.test(home));
yes('chosen list themed charcoal gold',
    /\.gal-box \.form \.gal-chosen-item\{[^}]*background:var\(--iron\)/.test(home) &&
    /\.gal-box \.form \.btn\.gal-chosen-x\{[^}]*color:var\(--gold\)/.test(home));
yes('empty and multi-file labels stay in sync',
    /No file chosen/.test(home) &&
    /files chosen/.test(home) &&
    /picked\.length === 1/.test(home));
yes('send form has a visible dashed drop zone',
    /id="galDrop"/.test(home) &&
    /Drop pictures here or choose files/.test(home) &&
    /\.gal-box \.form \.gal-drop\{[^}]*dashed/.test(home) &&
    /\.gal-box \.form \.gal-drop\.drag\{/.test(home));
yes('Choose pictures button uses gold charcoal theme',
    /\.gal-box \.form \.btn\.gal-pick\{[^}]*border-color:var\(--gold\)/.test(home) &&
    /\.btn\.ghost\{[^}]*background:transparent/.test(home));
yes('file input allows multi-select', /\smultiple[>\s]/.test(
    (home.match(/id="galFile"[^>]*>/) || [''])[0]));
yes('Choose files button opens the hidden input',
    /getElementById\('galPick'\)/.test(home) && /f\.click\(\)/.test(home));
yes('send walks each chosen file in order',
    /picked\.length \? picked\.slice\(\)/.test(home) &&
    /\/api\/gallery\/submit\?name=/.test(home));
yes('submit box accepts drag-and-drop',
    /getElementById\('galDrop'\)/.test(home) &&
    /dataTransfer/.test(home) &&
    /\.gal-box \.form \.gal-drop\.drag\{/.test(home));
yes('By and Note stack as full-width gal-fields with labels above',
    /for="galBy">By</.test(home) &&
    /for="galNote">Note/.test(home) &&
    /\.gal-box \.form \.gal-field\{[^}]*flex-direction:column/.test(home) &&
    !/<label>By<input/.test(home) &&
    !/<label>Note<span class="hint">/.test(home));
yes('By and Note stay inside the themed .form grid',
    // #1585 put the permission and privacy line between Note and Send.
    /id="galChosen"[\s\S]{0,200}gal-field[\s\S]{0,200}galBy[\s\S]{0,300}galNote[\s\S]{0,600}galSend/.test(home) &&
    !/'<\/div><\/div><\/div>' \+[\s\S]{0,40}<label>By/.test(home));
yes('By and Note inputs use charcoal iron night theme',
    /\.gal-box \.form input\[type=text\]\{[^}]*background:var\(--iron\)/.test(home) &&
    /\.gal-box \.form input\[type=text\]\{[^}]*color-scheme:dark/.test(home) &&
    /\.gal-box \.form input\[type=text\]:focus\{[^}]*border-color:var\(--gold\)/.test(home) &&
    /::placeholder\{[^}]*color:var\(--faint\)/.test(home) &&
    /placeholder="a name for the caption"/.test(home) &&
    /placeholder="a short note for staff"/.test(home));
yes('form gap keeps By Note off the drop zone and Send it',
    /\.gal-box \.form\{gap:22px\}/.test(home));

yes('public gallery keeps per-image Report',
    /data-galreport/.test(home));
yes('public gallery has no Waiting for approval queue',
    !/Waiting for approval/.test(home) && !/gal-pending/.test(home));
yes('public gallery has no Reports inbox',
    !/id="galReports"/.test(home) && !/gal-reports/.test(home));
yes('public gallery has no staff Delete on cards',
    !/data-galdel/.test(home));
yes('public gallery copy says staff tools are not here',
    /Staff Accept and Delete live on the hub Gallery page/.test(home));

yes('hub Gallery keeps one staff grid mount',
    /id="galgrid"/.test(hub) &&
    !/id="galqueue"/.test(hub) && !/id="gallive"/.test(hub) &&
    !/id="galreports"/.test(hub));
yes('hub Gallery has no member upload drop or uploaded list',
    !/Drop files here/.test(hub) && !/Nothing uploaded yet/.test(hub) && !/function sendAll/.test(hub));
yes('hub Gallery has no open-reports empty state',
    !/No open reports/.test(hub) && !/loadGalleryReports/.test(hub));
yes('hub still calls gallery pending API',
    /\/api\/gallery\/pending/.test(hub));
yes('hub Gallery no longer loads gallery reports API on this page',
    !/\/api\/gallery\/reports/.test(hub));
yes('hub Gallery has no dashed empty-state to public gallery and Inbox',
    !/Approved pictures live on the public/.test(hub) &&
    !/Bug and idea reports go to/.test(hub));
yes('hub Gallery keeps staff Accept + Delete intro',
    /Staff Accept waiting shots and Delete pending or live ones/.test(hub));

yes('hub Gallery loads one staff grid of pending + live',
    /function loadGalleryStaff\(\)/.test(hub) &&
    /\/api\/gallery\/pending/.test(hub) &&
    /\/api\/public/.test(hub) &&
    /method:'DELETE'/.test(hub) &&
    /\/api\/gallery\/approved/.test(hub));
yes('hub live cleanup uses small thumbs and Delete',
    /thumb sm/.test(hub) && /file compact/.test(hub) &&
    /data-galdel/.test(hub) && /\.thumb\.sm\{/.test(hub));
yes('hub pending cards show Accept and Delete, no Reject',
    /data-galok/.test(hub) && />Accept</.test(hub) &&
    /data-galdel/.test(hub) && !/data-galno/.test(hub) &&
    /\/api\/gallery\/approve/.test(hub) &&
    !/\/api\/gallery\/reject/.test(hub) && !/>Reject</.test(hub));
yes('Accept and Delete refresh the one staff grid',
    /loadGalleryStaff\(\)/.test(hub) && !/loadGalleryQueue\(\)/.test(hub));

yes('new gallery copy has no em dash', !/[\u2014\u2013]/.test(
  (home.match(/Send a picture[\s\S]{0,400}/) || [''])[0] +
  (home.match(/gal-show[\s\S]{0,200}/) || [''])[0] +
  (hub.match(/Staff Accept waiting shots[\s\S]{0,200}/) || [''])[0] +
  (hub.match(/Pending shots need Accept[\s\S]{0,500}/) || [''])[0]
));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
