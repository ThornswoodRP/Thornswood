// test-refused-play-page.js
//
//     node launcher\tests\test-refused-play-page.js
//
// A refused Play opens the page where it can be fixed (#982).
//
// When Play is refused because the mod list does not match, the launcher
// switches page and puts up a box saying what to do. Until #982 it switched to
// Mods: Scan and Fix had moved to Diagnostics (#607) and Mods was hidden from
// the rail (#599), so somebody refused landed on a mod browser with no Fix
// button and no rail button to find it again.
//
// This reads launcher\app\ShellPlay.cs (where Play() has lived since #2093
// moved it out of Shell.cs for #500), launcher\app\Shell.cs (the page
// constants, the pages array and the rail) and launcher\app\MainWindow.axaml
// (the window since the move to Avalonia, #4823; Shell names each control as
// win.<Name>), and holds:
//   - the page the refusal opens (ShowPage(PageX) in the refusal block),
//     followed through the PageX constant and the pages array to its element
//     in MainWindow.axaml, is the one that holds BtnScan and BtnFix;
//   - that page has its button on the rail;
//   - the refusal's boxes name that page by its title and none of the pages
//     #599 hid and #3146 cut, and never the Add-ons page (a tab of the cut
//     Mods page);
//   - the missing mods box offers to open the collection instead;
//   - the comment under the page arrays says where a blocked Play goes.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read() { return fs.readFileSync(path.join.apply(path, [REPO].concat([].slice.call(arguments))), 'utf8').split(CR).join(''); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const shell = read('launcher', 'app', 'Shell.cs');
const play = read('launcher', 'app', 'ShellPlay.cs');
const xaml = read('launcher', 'app', 'MainWindow.axaml');

// ---- the refusal block ------------------------------------------------------
const start = play.indexOf('Log("Not launching. " + blockers');
const stop = start < 0 ? -1 : play.indexOf('Verify.DeployPersonal', start);
yes('ShellPlay.cs still has the mod list refusal in Play', start > 0 && stop > start);
const block = start > 0 && stop > start ? play.slice(start, stop) : '';

const shows = [];
block.replace(/ShowPage\((\w+)\)/g, function (m, p) { shows.push(p); return m; });
yes('the refusal opens exactly one page (' + shows.join(', ') + ')', shows.length === 1);
const target = shows[0] || '';

// ---- the constant, the pages array, the Grid ----------------------------------
const consts = {};
const cm = /const int (PagePlay[^;]*);/.exec(shell);
if (cm) cm[1].replace(/(Page\w+)\s*=\s*(\d+)/g, function (m, n, v) { consts[n] = +v; return m; });
yes('the PageXxx constants are readable', Object.keys(consts).length >= 5);
const index = consts[target];
yes(target + ' is a page constant (' + index + ')', typeof index === 'number');

const arr = /pages = new Control\[\] \{([\s\S]*?)\};/.exec(shell);
const grids = [];
if (arr) arr[1].replace(/win\.(\w+)/g, function (m, n) { grids.push(n); return m; });
yes('the pages array names its pages (' + grids.length + ')', grids.length === Object.keys(consts).length);
const gridName = grids[index] || '';
yes(target + ' is the page ' + gridName + ' in the pages array', gridName.length > 0);

const titles = /PageTitles\s*=\s*\{([\s\S]*?)\};/.exec(shell);
const titleList = [];
if (titles) titles[1].replace(/"([^"]*)"/g, function (m, t) { titleList.push(t); return m; });
const title = titleList[index] || '';

// The element that opens with x:Name="gridName", up to its own closing tag.
function element(name) {
  const at = xaml.indexOf('x:Name="' + name + '"');
  if (at < 0) return '';
  const open = xaml.lastIndexOf('<', at);
  const tag = /^<([\w:.]+)/.exec(xaml.slice(open))[1];
  const rx = new RegExp('<' + tag.replace('.', '\\.') + '[\\s>/]|</' + tag.replace('.', '\\.') + '>', 'g');
  rx.lastIndex = open;
  let depth = 0, m;
  while ((m = rx.exec(xaml))) {
    if (m[0].charAt(1) === '/') { depth--; if (depth === 0) return xaml.slice(open, m.index + m[0].length); }
    else {
      const end = xaml.indexOf('>', m.index);
      if (xaml.charAt(end - 1) !== '/') depth++;
      else if (depth === 0) return xaml.slice(open, end + 1);
    }
  }
  return '';
}
const page = element(gridName);
yes('MainWindow.axaml has the page ' + gridName, page.length > 0);
yes('the page a refused Play opens holds the Fix button (BtnFix)', /x:Name="BtnFix"/.test(page));
yes('and the Scan button (BtnScan)', /x:Name="BtnScan"/.test(page));
yes('BtnFix is in MainWindow.axaml once, so it is not also somewhere else', (xaml.match(/x:Name="BtnFix"/g) || []).length === 1);
yes('the Mods page does not hold BtnFix, as #607 left it', !/x:Name="BtnFix"/.test(element('PageMods')));

// ---- the rail ---------------------------------------------------------------
// Every page in the arrays has its rail button since #3146 cut the five #599
// had hidden by collapsing theirs.
const navArr = /navButtons = new Button\[\] \{([\s\S]*?)\};/.exec(shell);
const navs = [];
if (navArr) navArr[1].replace(/win\.(\w+)/g, function (m, n) { navs.push(n); return m; });
yes('the page a refused Play opens is on the rail',
    target && typeof index === 'number' && !!navs[index] && navs.length === grids.length &&
    !/navButtons\[[^\]]+\]\.IsVisible\s*=\s*false/.test(shell));
const CUT = ['Server', 'Mods', 'What is installed', 'Saves', 'Logs', 'Help'];

// ---- what the boxes say -----------------------------------------------------
const said = [];
block.replace(/"((?:[^"\\]|\\.)*)"/g, function (m, s) { said.push(s); return m; });
const words = said.join('');
yes('the box names the page it opened, "' + title + ' page"', title && words.indexOf(title + ' page') >= 0);
CUT.forEach(function (t) {
  yes('the refusal sends nobody to the ' + t + ' page, which is gone', !new RegExp('\\b' + t + ' page\\b').test(words));
});
yes('nor to the Add-ons page, a tab of the cut Mods page', words.indexOf('Add-ons') < 0);
yes('the missing mods box offers to open the collection (#5200: in Vortex where Vortex answers Nexus links)',
    /Ask\.YesNo\(missing,/.test(block) && /OpenCollection\(\);/.test(block) &&
    words.indexOf('press Yes to open it and install it in Vortex') >= 0);
yes('and says Fix will not help with a mod that is not installed', words.indexOf('Pressing Fix will not help') >= 0);
yes('no em dash and never the word the project does not use in the boxes', !/—/.test(words) && !/player/i.test(words));

// ---- the comment ------------------------------------------------------------
const pa = shell.indexOf('pages = new Control[] {');
const na = pa < 0 ? -1 : shell.indexOf('/*', pa);
const note = na < 0 ? '' : shell.slice(na, shell.indexOf('*/', na));
yes('the comment under the page arrays says a blocked Play goes to ShowPage(' + target + ')', note.indexOf('ShowPage(' + target + ')') >= 0);
yes('and no longer says it goes to ShowPage(PageMods)', note.indexOf('sends people to it (ShowPage(PageMods))') < 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
