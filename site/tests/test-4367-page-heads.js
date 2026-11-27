'use strict';
/*
  test-4367-page-heads.js

      node .\site\tests\test-4367-page-heads.js
      node .\site\tests\test-4367-page-heads.js <an older server.js>

  Issue #4367. The Not allowed in page, which somebody gets after signing in
  with Discord when they may not come in, wrote its own document with no
  <html lang="en">, no viewport meta and no main landmark, so a phone drew it
  at desktop width and shrank it, and a screen reader could read it in the
  wrong voice. plainPage, which every other page the site writes itself goes
  through, had all three.

  From a copy of the site in a scratch folder (its config.json written here,
  with an invite and a role list so every branch has something to say):

    A  every page the site's code writes itself, rendered: the page for an
       unknown address, the page for each error status a browser can reach,
       the two sign in pages (Discord did not answer, could not save), and
       the Not allowed in page for each of its four reasons (Discord could not
       be asked, banned, not in the Discord, no role that lets them in). Each
       must start with <!doctype html><html lang="en">, hold the viewport
       meta and have its words inside one <main>.
    B  the site's code starts an HTML document in exactly one place, so a
       page written by hand somewhere else cannot come back without this
       check seeing it.

  The pages that come from public\index.html and public\home.html are files
  that carry their own <html lang="en"> and viewport; this is the pages built
  in code. Nothing leaves the machine. The scratch folder is removed at the
  end.
*/
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const SITE = process.argv[2] || path.join(ROOT, 'site', 'server.js');
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 400).split('\n').join('\n      ') : '')); }
}

// What a page needs: the language, the viewport, and its words in one main.
function heads(html) {
  const s = String(html);
  const missing = [];
  if (s.indexOf('<!doctype html><html lang="en">') !== 0) missing.push('<html lang="en"> at the start');
  if (!/<meta name="viewport" content="width=device-width,\s*initial-scale=1[^"]*">/.test(s)) missing.push('the viewport meta');
  const mains = s.match(/<main\b/g) || [];
  if (mains.length !== 1 || !/<main\b[^>]*>[\s\S]*<h1>[\s\S]*<\/main>/.test(s)) missing.push('one <main> holding the page');
  return missing;
}

const dir = fs.mkdtempSync(path.join(TEMP, 'ts-4367-'));
try {
  siteFiles.copy(dir, SITE);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: 'https://discord.gg/harness' },
    botKey: crypto.randomBytes(24).toString('hex'), admins: ['222222222'],
    secret: crypto.randomBytes(32).toString('hex'),
    access: { play: ['Citizen'] },
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  // GitHub on a port nothing answers, as test-4435 does: loading the site's
  // code asks it which setup programs are published, and nothing here may
  // leave the machine.
  process.env.THORNSWOOD_GITHUB_API = 'http://127.0.0.1:1';
  const passes = require(path.join(dir, 'lib', 'passes.js'));

  console.log('A. every page the site writes itself has its language, the viewport and a main:');
  const me = { id: '123456789', username: 'harness' };
  const PAGES = [
    ['the page for an unknown address', passes.notFoundPage()]
  ];
  for (const status of [400, 401, 403, 404, 500, 503]) {
    PAGES.push(['the error page for ' + status, passes.errorPage(status)]);
  }
  PAGES.push(['the error page with its own words', passes.errorPage(404, ['That picture was taken away.'])]);
  PAGES.push(['Discord did not answer', passes.plainPage('Discord did not answer', ['Discord did not answer.', 'Try again.'])]);
  PAGES.push(['the site could not sign you in', passes.plainPage('The site could not sign you in', ['The site could not save your sign in.', 'Try again in a minute.'])]);
  PAGES.push(['Not allowed in: Discord could not be asked', passes.notAllowedPage(me, { lookupFailed: 'Discord answered 500' })]);
  PAGES.push(['Not allowed in: banned', passes.notAllowedPage(me, { banned: true, inGuild: true })]);
  PAGES.push(['Not allowed in: not in the Discord', passes.notAllowedPage(me, { inGuild: false })]);
  PAGES.push(['Not allowed in: no role that lets them in', passes.notAllowedPage(me, { inGuild: true, roles: ['Visitor'] })]);
  for (const [what, html] of PAGES) {
    const missing = heads(html);
    yes(what + (missing.length ? ': missing ' + missing.join(', ') : ''), missing.length === 0, html);
  }

  // What each Not allowed in page says is still said, links and all.
  const notIn = passes.notAllowedPage(me, { inGuild: false });
  yes('the Not allowed in page still links the invite, names the account and its id',
      notIn.indexOf('<a href="https://discord.gg/harness">Join it here</a>') >= 0 &&
      notIn.indexOf('<b>harness</b>') >= 0 && notIn.indexOf('<code>123456789</code>') >= 0, notIn);
  const noRole = passes.notAllowedPage(me, { inGuild: true, roles: ['Visitor'] });
  yes('and the roles it can see and the ones it needs',
      noRole.indexOf('<b>Visitor</b>') >= 0 && noRole.indexOf('<b>Citizen</b>') >= 0, noRole);

  console.log('\nB. the site starts an HTML document in one place:');
  const starts = [];
  for (const rel of siteFiles.files(SITE)) {
    const text = fs.readFileSync(path.join(dir, rel), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (/<!doctype html/i.test(line)) starts.push(rel + ':' + (i + 1) + ': ' + line.trim().slice(0, 120));
    });
  }
  yes('one line in the site\'s code writes <!doctype html> (' + starts.length + ' do)', starts.length === 1, starts.join('\n'));
} catch (e) {
  yes('the harness ran to the end: ' + (e && e.stack || e), false);
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
