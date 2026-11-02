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
// page writer on planted lists, and the step Deploy-Docs -Board runs on the
// box on planted boards.
//
// Read only, apart from a scratch folder it removes.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const siteFiles = require('../../tests/site-files');
const { knownPage, knownWriter } = require('../../tests/fixtures/known-page');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function yes(what, cond) { if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }
function read(rel) { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return null; } }

const server = siteFiles.source() || '';
const hub = read('site/public/hub.js') || '';
const deploy = read('scripts/deploy/Deploy-Docs.ps1') || '';
const bot = read('bot/bot.py') || '';
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

// 6. Deploy-Docs puts a board on the box: once by itself, then as typed.
//    No board in the repo carries the seeded mark now, so the step runs on a
//    planted one.
yes('Deploy-Docs takes -Board', /\[string\[\]\]\$Board,/.test(deploy));
yes('and refuses it beside -Boards or -SeedDocs', /if \(\$Board -and \(\$Boards -or \$SeedDocs\)\) \{\s*throw/.test(deploy));
yes('every plain deploy asks for the boards the repo marks seeded',
    /\$bp\.Value\.PSObject\.Properties\.Name -contains 'seeded'\) \{ \$seedNames \+= \$bp\.Name \}/.test(deploy) &&
    /\$boardArgs = @\(\$boardNames \| ForEach-Object \{ \$_ \+ '=force' \}\) \+ @\(\$seedNames \| ForEach-Object \{ \$_ \+ '=seed' \}\)/.test(deploy));
yes('the step on the box is plain ASCII, as Set-Content -Encoding ASCII writes it',
    /^[\x00-\x7F]*$/.test((/Set-Content -LiteralPath `\$js -Encoding ASCII -Value @'\n([\s\S]*?)\n'@/.exec(deploy) || [])[1] || String.fromCharCode(255)));
{
  const js = (/^(var fs = require\('fs'\);[\s\S]*?^\}\n)'@$/m.exec(deploy) || [])[1] || '';
  yes('the step it runs on the box is in the script', js.length > 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2414-'));
  try {
    const step = path.join(tmp, 'step.js');
    fs.writeFileSync(step, js);
    const live = path.join(tmp, 'board.json'), repo = path.join(tmp, 'board.json.from-repo');
    const planted = { intro: 'the repo copy', seeded: '2414', sections: [{ name: 'S', rows: [] }] };
    const typed = { active: { intro: 'typed on the site', sections: [] }, known: { intro: 'stale', sections: [] }, _rev: { active: 4, known: 9 } };
    fs.writeFileSync(live, String.fromCharCode(0xFEFF) + JSON.stringify(typed, null, 2));
    fs.writeFileSync(repo, JSON.stringify({ active: { intro: 'the repo copy', sections: [] }, known: planted }, null, 2));
    const run = (asks) => cp.spawnSync(process.execPath, [step, live, repo].concat(asks), { encoding: 'utf8' });
    const now = () => JSON.parse(fs.readFileSync(live, 'utf8'));

    let r = run(['known=seed']);
    let after = now();
    yes('a live board without the mark is seeded from the repo', r.status === 0 && JSON.stringify(after.known) === JSON.stringify(planted));
    yes('every other board is left as it was typed', after.active.intro === 'typed on the site');
    yes('that board\'s revision moves on, and only that one', after._rev.known === 10 && after._rev.active === 4);
    yes('what was there is kept in board.json.bak', /"stale"/.test(fs.readFileSync(live + '.bak', 'utf8')));
    yes('and it says so', /BOARD REPLACED known, now at revision 10/.test(r.stdout));

    // Somebody edits it in the hub: the save keeps the mark.
    after.known.sections[0].rows.push({ id: 'typed', done: false, cells: {}, at: 1, by: 'a person' });
    fs.writeFileSync(live, JSON.stringify(after, null, 2));
    r = run(['known=seed']);
    yes('the next deploy finds it seeded and leaves what was typed', r.status === 0 && /BOARD KEPT known/.test(r.stdout) &&
        now().known.sections[0].rows.some((x) => x.id === 'typed') && now()._rev.known === 10);

    r = run(['known=force']);
    yes('-Board puts the repo copy in all the same', r.status === 0 && /BOARD REPLACED known, now at revision 11/.test(r.stdout) &&
        !now().known.sections[0].rows.some((x) => x.id === 'typed'));

    const before = fs.readFileSync(live, 'utf8');
    r = run(['nosuch=force']);
    yes('a board the repo does not have is refused, and the file is left alone',
        r.status !== 0 && /BOARD NOT REPLACED/.test(r.stdout) && fs.readFileSync(live, 'utf8') === before);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
