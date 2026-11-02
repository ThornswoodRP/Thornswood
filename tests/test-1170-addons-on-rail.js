// test-1170-addons-on-rail.js
//
//     node tests\test-1170-addons-on-rail.js
//
// The optional packs and the collection card are on a page the rail shows (#1170).
//
// #599 took the Mods page off the rail, and #982 moved the refused Play to
// Diagnostics, so nothing in the launcher opened the Mods page any more. Its
// Add-ons tab was the only place an optional pack could be installed, and its
// collection card was the only button to the collection until Djinn's card on
// Diagnostics (#1578). Publish-Pack still told whoever ships a pack that it
// shows "on the Add-ons tab of the Mods page".
//
// This reads launcher\app\*.cs, launcher\app\MainWindow.axaml, Publish-Pack.ps1 and the
// pages that tell people where the collection link is, and holds:
//   - the hosts of the add-ons (DiagAddons) and of the collection card
//     (DiagCollection), followed from the window to their page's Grid, the pages
//     array and the PageXxx constant, are on a page the rail does not hide;
//   - opening that page runs the builder that fills both hosts, and the
//     builder fills them: the collection card, then DrawAddons;
//   - DrawAddons draws a row per pack in the feed's optional list with
//     PackRow, and draws nothing without one (the Mods page and its tab
//     were cut with the other pages #599 hid, #3146);
//   - installing or removing a pack, and every update check, redraws it;
//   - Publish-Pack, the scripts index, the feed doc, the join page, the help
//     page and the installer's read me name that page, never the Add-ons tab
//     or an Add-ons page.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read() { return fs.readFileSync(path.join.apply(path, [REPO].concat([].slice.call(arguments))), 'utf8').split(CR).join(''); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const shell = read('launcher', 'app', 'Shell.cs');
const pages = read('launcher', 'app', 'Pages.cs');
const packs = read('launcher', 'app', 'ShellPacks.cs');
const update = read('launcher', 'app', 'ShellUpdate.cs');
const xaml = read('launcher', 'app', 'MainWindow.axaml');

// The body of a C# method, from its declaration to its closing brace.
function method(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}

// ---- the constants, the pages array, the titles, the rail ---------------------
const consts = {};
const cm = /const int (PagePlay[^;]*);/.exec(shell);
if (cm) cm[1].replace(/(Page\w+)\s*=\s*(\d+)/g, function (m, n, v) { consts[n] = +v; return m; });
yes('the PageXxx constants are readable', Object.keys(consts).length >= 5);
const byIndex = {};
Object.keys(consts).forEach(function (k) { byIndex[consts[k]] = k; });

const arr = /pages = new Control\[\] \{([\s\S]*?)\};/.exec(shell);
const grids = [];
if (arr) arr[1].replace(/win\.(\w+)/g, function (m, n) { grids.push(n); return m; });
yes('the pages array names a Grid for every constant (' + grids.length + ')', grids.length === Object.keys(consts).length);

const titles = /PageTitles\s*=\s*\{([\s\S]*?)\};/.exec(shell);
const titleList = [];
if (titles) titles[1].replace(/"([^"]*)"/g, function (m, t) { titleList.push(t); return m; });

// #599 hid five pages by collapsing their rail buttons; #3146 cut them, so
// every page in the arrays has its button on the rail. A page is on the rail
// while the rail names a button for it and nothing collapses one again.
const navArr = /navButtons = new Button\[\] \{([\s\S]*?)\};/.exec(shell);
const navs = [];
if (navArr) navArr[1].replace(/win\.(\w+)/g, function (m, n) { navs.push(n); return m; });
yes('the rail names a button for every page (' + navs.length + ')', navs.length > 0 && navs.length === grids.length);
yes('nothing collapses a rail button', !/navButtons\[[^\]]+\]\.IsVisible\s*=\s*false/.test(shell) && !/hiddenNav/.test(shell));
const hidden = [];

// The page Grid a named control sits in: the nearest Grid named in the pages
// array that opens before it.
function pageOf(name) {
  const at = xaml.indexOf('x:Name="' + name + '"');
  if (at < 0) return '';
  let best = '', bestAt = -1;
  grids.forEach(function (g) {
    const open = xaml.indexOf('x:Name="' + g + '"');
    if (open < 0 || open > at || open < bestAt) return;
    best = g; bestAt = open;
  });
  return best;
}

function onRail(host, what) {
  yes('the window has ' + host + ' once', (xaml.match(new RegExp('x:Name="' + host + '"', 'g')) || []).length === 1);
  const grid = pageOf(host);
  const index = grids.indexOf(grid);
  const constant = byIndex[index] || '';
  yes(what + ' (' + host + ') is on the page ' + grid + ', ' + constant + ', "' + (titleList[index] || '') + '"', constant.length > 0);
  yes(what + ' is on a page the rail shows', constant.length > 0 && hidden.indexOf(constant) < 0);
  return constant;
}

const addonsPage = onRail('DiagAddons', 'the add-ons');
const collectionPage = onRail('DiagCollection', 'the collection card');
yes('both are on the same page', addonsPage === collectionPage);

// ---- the page's builder fills both hosts ---------------------------------------
const show = method(shell, 'static void ShowPage(int i)');
const built = new RegExp('else if \\(i == ' + addonsPage + '\\) (\\w+)\\(\\);').exec(show);
const builder = built ? built[1] : '';
yes('opening ' + addonsPage + ' runs ' + (builder || 'a builder'), builder.length > 0);

const diag = method(pages, 'static void ' + builder + '()');
yes(builder + ' is in Pages.cs', diag.length > 0);
const card = diag.indexOf('diagCollection.Children.Add(CollectionStatusCard());');
const draw = diag.indexOf('DrawAddons();');
yes(builder + ' adds the collection card', card > 0);
yes(builder + ' draws the add-ons after the collection card', draw > card && card > 0);

yes('Pages.cs binds DiagAddons to diagAddons', /diagAddons = win\.DiagAddons;/.test(pages));
yes('DiagAddons sits after DiagCollection on the page',
    xaml.indexOf('x:Name="DiagAddons"') > xaml.indexOf('x:Name="DiagCollection"'));

// ---- DrawAddons -----------------------------------------------------------------
const addons = method(packs, 'static void DrawAddons()');
yes('DrawAddons is in ShellPacks.cs', addons.length > 0);
yes('it does nothing when the page has no host, so a missing control cannot take the page with it',
    /if \(diagAddons == null\) return;/.test(addons));
yes('it clears the host before drawing, so a redraw never doubles the rows',
    addons.indexOf('diagAddons.Children.Clear();') > 0 &&
    addons.indexOf('diagAddons.Children.Clear();') < addons.indexOf('PackRow('));
yes('it reads the feed\'s optional list',
    /pendingDoc == null \? null : pendingDoc\.optional/.test(addons));
yes('a row per pack, from PackRow, with its installed state',
    /PackRow\(p, Updater\.IsInstalled\(p\.id\)\)/.test(addons));
yes('a pack with no id is skipped', /if \(p == null \|\| string\.IsNullOrEmpty\(p\.id\)\) continue;/.test(addons));
yes('nothing is drawn before the feed answers or when it lists no pack',
    /if \(have == null\) return;/.test(addons) && /if \(rows\.Count == 0\) return;/.test(addons) &&
    addons.indexOf('if (rows.Count == 0) return;') < addons.indexOf('head.Text = "Add-ons";'));
yes('the section is headed Add-ons', addons.indexOf('head.Text = "Add-ons";') > 0);
yes('its words say a pack is never a plugin', /never a plugin/.test(addons));
yes('no em dash and never the word the project does not use in its words', !/—/.test(addons) && !/player/i.test(addons));

// ---- redrawn when something changes ---------------------------------------------
const action = method(packs, 'static void PackAction(Pack p, bool installed)');
yes('PackAction redraws the add-ons when a pack starts working and when it is done',
    (action.match(/DrawAddons\(\);/g) || []).length === 2);
const onDoc = method(update, 'static void OnVersionDoc(VersionDoc v, bool loud)');
yes('every update check redraws them from the new document', onDoc.indexOf('DrawAddons();') > onDoc.indexOf('pendingDoc = v;'));

// ---- what people and the person who ships are told --------------------------------
const publish = read('scripts', 'release', 'Publish-Pack.ps1');
const pageTitle = titleList[consts[addonsPage]] || '';
yes('Publish-Pack says the packs show on the ' + pageTitle + ' page',
    publish.indexOf("They show under Add-ons on the launcher's " + pageTitle + ' page.') > 0);
yes('Publish-Pack no longer sends anybody to the Mods page', !/Mods page/.test(publish) && !/Add-ons tab/.test(publish));
yes('the scripts index says the same', read('scripts', 'README.md').indexOf('under Add-ons on its ' + pageTitle + ' page') > 0);
yes('the feed doc names DrawAddons for the optional list', /Add-ons on the Diagnostics page \(`ShellPacks\.cs DrawAddons`/.test(read('docs', 'FEED.md')));

[['site', 'data', 'site', 'join.md'], ['site', 'data', 'help.md']].forEach(function (f) {
  const text = read.apply(null, f).replace(/\s+/g, ' ');
  const name = f.join('/');
  yes(name + ' puts the collection link on the launcher\'s ' + pageTitle + ' page',
      text.indexOf("the launcher's " + pageTitle + ' page') >= 0);
  yes(name + ' sends nobody to an Add-ons page or tab', !/Add-ons (page|tab)/.test(text));
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
