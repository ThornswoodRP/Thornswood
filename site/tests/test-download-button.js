// test-download-button.js
//
// The one gold button in the site's top bar is Download, and Admin login is in
// the footer only.
//
// From the To Do List, entry 189: "make the one highlighted button on the site
// Download". Before this, the only link in the bar with the gold border
// (class="enter") was Admin login, pointing at /hub, which only staff can use.
// A stranger landing on the front page had their eye sent to the one door on
// the site that is shut to them, while Download sat in the bar as plain grey
// text.
//
// The rest of that entry, deleting the hub, is not decided again yet: the hub
// now holds the sessions page, the chat logs and the report inbox, and none of
// them has a home in Discord. So the footer keeps its Admin login link, and
// this checks that it did.
//
// Every page on the site is home.html with a different body, so this one file
// is the bar on every page. The server only swaps DISCORD_URL and the og tags
// into it, neither of which touches these links.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.HOME_HTML ||
  path.join(REPO_DIR, 'site', 'public', 'home.html');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// Every <a ...>text</a> in a piece of markup, with its class, href and words.
function links(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const cls = /\bclass="([^"]*)"/.exec(attrs);
    const href = /\bhref="([^"]*)"/.exec(attrs);
    out.push({
      classes: cls ? cls[1].split(/\s+/).filter(Boolean) : [],
      href: href ? href[1] : '',
      text: m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    });
  }
  return out;
}

// ------------------------------------------------------------------ the bar
// Found by its opening, not the whole tag: #1585 gave the bar an aria-label.
const a = src.indexOf('<nav class="top" id="nav"');
const b = a < 0 ? -1 : src.indexOf('</nav>', a);
const bar = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
yes('the top bar is in home.html', bar !== null);

const inBar = bar ? links(bar) : [];
const gold = inBar.filter(function (l) { return l.classes.indexOf('enter') >= 0; });

yes('exactly one link in the bar is the gold button', gold.length === 1);
yes('the gold button goes to /downloads',
    gold.length === 1 && gold[0].href === '/downloads');
yes('the gold button says Download',
    gold.length === 1 && gold[0].text === 'Download');
yes('the gold button is the last link in the bar, where the narrow screen rule for .enter sets it apart',
    inBar.length > 0 && inBar[inBar.length - 1].classes.indexOf('enter') >= 0);
yes('the bar names /downloads once, not as a plain link and a button both',
    inBar.filter(function (l) { return l.href === '/downloads'; }).length === 1);
yes('nothing in the bar goes to /hub',
    inBar.filter(function (l) { return l.href === '/hub'; }).length === 0);
yes('nothing in the bar says Admin login',
    inBar.filter(function (l) { return /admin login/i.test(l.text); }).length === 0);
yes('the bar still has its other links (Rules, Professions, Roadmap, News, Patreon, Discord)',
    ['Rules', 'Professions', 'Roadmap', 'News', 'Patreon', 'Discord'].every(function (t) {
      return inBar.some(function (l) { return l.text === t; });
    }));

// The gold border is the .enter class. Anywhere else on the page it would be a
// second highlighted button, which is what the entry says there should not be.
const everywhere = links(src).filter(function (l) { return l.classes.indexOf('enter') >= 0; });
yes('no other link on the page carries the gold button class', everywhere.length === 1);

// --------------------------------------------------------------- the footer
const f = src.indexOf('<footer');
const g = f < 0 ? -1 : src.indexOf('</footer>', f);
const foot = (f >= 0 && g >= 0) ? src.slice(f, g) : null;
yes('the footer is in home.html', foot !== null);

const inFoot = foot ? links(foot) : [];
const admin = inFoot.filter(function (l) { return l.text === 'Admin login'; });
yes('the footer keeps its Admin login link', admin.length === 1);
yes('the footer Admin login still goes to /hub, since the hub is not deleted',
    admin.length === 1 && admin[0].href === '/hub');
yes('the footer Admin login is a plain link, not a second gold button',
    admin.length === 1 && admin[0].classes.indexOf('enter') < 0);
yes('the footer still has its Download link',
    inFoot.some(function (l) { return l.text === 'Download' && l.href === '/downloads'; }));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
