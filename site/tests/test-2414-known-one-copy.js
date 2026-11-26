// test-2414-known-one-copy.js
//
//     node site/tests/test-2414-known-one-copy.js
//
// The Known Issues text has one copy: the "Known issue:" comment on each
// issue on the board labelled Main Findings or Dev Findings. The bot posts
// those in #known-issues and writes the same list into the site's
// data/from-bot/lists.json, and /known and /api/page/known write that out
// through knownMarkdown in site/server.js.
//
// Issue #2414: the text was kept twice, site/data/known.md for the page and a
// known board that nothing showed. The board went stale: after #504 it still
// said "NPCs stand still when nobody is nearby | SkyMP has no server side AI".
// On 12 October the hub board became the one copy. Issue #3140 then found the
// board and #known-issues saying different things, because one was typed in
// the hub and the other came off the issue board, so the site's page comes off
// the issue board too and the known board is gone.
//
// This fails if a second copy comes back, if the page stops being the bot's
// list, or if the bot and the site stop naming the same file. It also runs the
// page writer on planted lists. The step Deploy-Docs -Board ran on the box
// went with the boards in #4359.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const siteFiles = require('../../tests/site-files');
const { knownPage, knownWriter } = require('../../tests/fixtures/known-page');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function yes(what, cond) { if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }
function read(rel) { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return null; } }

const server = siteFiles.source() || '';
const hub = read('site/public/hub.js') || '';
const bot = require('../../tests/bot-files').source().replace(/\r\n/g, '\n');
const service = read('scripts/vps/Bot-Service.ps1') || '';
const install = read('scripts/deploy/Install-Bot.ps1') || '';
const board = JSON.parse(read('site/data/board.json') || '{}');
const page = knownPage();

// 1. The page is the bot's list, and nothing else holds it.
yes('there is no site/data/known.md', read('site/data/known.md') === null);
const boardsDecl = (server.match(/const BOARDS = \{([\s\S]*?)\};/) || [])[1] || '';
yes('BOARDS has no Known Issues board and no roadmap board', !/\bknown:/.test(boardsDecl) && !/\broadmap:/.test(boardsDecl));
yes('board.json has neither', !('known' in board) && !('roadmap' in board));
yes('known is not a document read off the disk',
    !/const PUBLIC_DOCS = \[[^\]]*'known'[^\]]*\]/.test(server));
yes('pageMarkdown writes /known out of the bot\'s lists through knownMarkdown',
    /function pageMarkdown\(name\) \{\s*if \(name === 'known'\) \{[\s\S]{0,200}knownMarkdown\(readLists\(\)\)/.test(server));
yes('the writer sits between its markers in server.js', !!knownWriter(server));
yes('the page is there and starts with its title', !!page && /^# Known Issues\n/.test(page));

// 2. The hub no longer edits it: a row typed there would be a second copy.
yes('the hub has no /hub/known page', !/'\/hub\/known'/.test(hub) && !/'\/hub\/known'/.test(server));
yes('and edits no known or roadmap board', !/BOARDKEYS = \[[^\]]*'(known|roadmap)'/.test(hub));
yes('known needs no level of its own', !/const LEVEL = \{[^}]*\bknown:/.test(server));

// 3. The bot and the site name the same file, and the bot may write it.
{
  const botFile = (/PUBLIC_LISTS_FILE', r'([^']+)'/.exec(bot) || [])[1] || '';
  yes('the bot writes data\\from-bot\\lists.json under the site', /\\data\\from-bot\\lists\.json$/.test(botFile));
  yes('the site reads data/from-bot/lists.json',
      /const FROM_BOT = path\.join\(DATA, 'from-bot'\);/.test(server) && /const LISTS = path\.join\(FROM_BOT, 'lists\.json'\);/.test(server) &&
      /const readLists = \(\) => jsonFile\(LISTS, null\);/.test(server));
  yes('the site makes the folder when it starts', /for \(const dir of \[[^\]]*\bFROM_BOT\b[^\]]*\]\)/.test(server));
  yes('Bot-Service gives the bot Modify on it', /\$fromBot = Join-Path \$DocsData 'from-bot'/.test(service) && /\$fromBot[\s\S]{0,400}'Modify'/.test(service));
  yes('Install-Bot stops before changing anything when the folder is not there yet', /NO FROM-BOT/.test(install) && /Nothing on the box was changed/.test(install));
}

// 4. No second copy under any name.
{
  const copies = [];
  Object.keys(board).forEach(function (k) {
    if (k.charAt(0) === '_') { return; }
    if (/known issues/i.test(String((board[k] || {}).intro || ''))) { copies.push(k + ' (intro)'); }
  });
  fs.readdirSync(path.join(ROOT, 'site', 'data')).filter((f) => /\.md$/.test(f)).forEach(function (f) {
    if (/^# Known Issues/m.test(read('site/data/' + f) || '')) { copies.push('site/data/' + f); }
  });
  if (copies.length) { console.log('      ' + copies.join('; ')); }
  yes('no board and no document is a Known Issues page of its own', copies.length === 0);
  yes('nothing says NPCs stand still with nobody near, which #504 fixed',
      !/NPCs stand still when nobody is nearby/i.test(JSON.stringify(board)) && !/NPCs stand still when nobody is nearby/i.test(page || ''));
}

// 5. The writer, on planted lists.
{
  const w = knownWriter(server) || function () { return ''; };
  const at = '2026-10-26T13:05:00Z';
  const md = w({ at: at, known: [
    { title: 'Doors stick', text: 'A door sticks.\nPush it twice.', where: ['Main'] },
    { title: 'Killmoves', text: '', where: ['Dev', 'Main'] },
    { title: '', text: 'no title', where: [] }] });
  yes('each known issue is a heading with its words under it',
      md.indexOf('### Doors stick\n\nA door sticks.\nPush it twice.\n\n*Found on main.*') >= 0);
  yes('where it was found is said in words', md.indexOf('### Killmoves\n\n*Found on main and the dev server.*') >= 0);
  yes('a row with no title is left out', md.indexOf('no title') < 0);
  yes('the page says when the board was read, on the 12 hour clock', md.indexOf('*Read from the issue board 26 Oct 2026, 1:05 PM UTC.*') >= 0);
  yes('an empty list says nothing is listed', w({ at: at, known: [] }).indexOf('Nothing is listed right now.') >= 0);
  const unread = [w(null), w({ at: at }), w({ known: [] })];
  yes('a list the bot has not written is said, never drawn as an empty list',
      unread.every((t) => /could not be read from the issue board/.test(t) && t.indexOf('Nothing is listed') < 0 && t.indexOf('## Broken right now') < 0));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
