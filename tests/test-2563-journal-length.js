'use strict';
/*
  test-2563-journal-length.js

  #2563. A journal page in J was cut short on its way to the server without a
  word: the chat socket kept a command to COMMAND_CHARS (2,000 after #2554),
  the server kept a page to SOCIAL.pageChars (4,000) with a slice, and the
  page sent the whole text with each newline as two characters. The fix holds
  the three to one length:
    - the socket carries the longest page the panel can send, whole;
    - writePage refuses a page over pageChars and says so, and never cuts;
    - the panel holds the text box to pageChars and the title to 60, and
      refuses a Save over the limit in its footer instead of sending it.

  The real writePage and the real chat line cut run here over stand ins.
  Read only.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js'));
const journal = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-journal.js'));
const voice = read(path.join(REPO_DIR, 'voice', 'voice-server.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const num = function (re, src) { const m = re.exec(src); return m ? Number(m[1]) : NaN; };
const pageChars = num(/pageChars: (\d+),/, gm);
const titleCut = num(/page\.title = String\(title \|\| 'Page'\)\.slice\(0, (\d+)\);/, gm);
const commandChars = num(/const COMMAND_CHARS = (\d+);/, voice);
const panelPage = num(/var PAGE_CHARS = (\d+);/, journal);
const panelTitle = num(/var TITLE_CHARS = (\d+);/, journal);

yes('the numbers are all found (page ' + pageChars + ', title ' + titleCut + ', socket ' + commandChars + ')',
    pageChars > 0 && titleCut > 0 && commandChars > 0);
yes('the panel holds a page to the server\'s pageChars', panelPage === pageChars);
yes('the panel holds a title to the server\'s title cut', panelTitle === titleCut);
yes('the text box and the title box carry those maxlengths',
    /'-text" maxlength="' \+ PAGE_CHARS \+ '"/.test(journal) && /'-ptitle" maxlength="' \+ TITLE_CHARS \+ '"/.test(journal));

// The longest line Save can send: the ids the server makes, the longest title, a page of all newlines.
const jid = 'j' + (Math.pow(36, 9) - 1).toString(36) + (999).toString(36);
const pid = 'p' + (Math.pow(36, 9) - 1).toString(36) + (59).toString(36);
const worst = '/journal page ' + jid + ' ' + pid + ' ' + 'T'.repeat(titleCut) + ' :: ' + '\\n'.repeat(pageChars);
yes('the longest page line (' + worst.length + ') fits a command on the chat socket (' + commandChars + ')',
    worst.length <= commandChars);

// The real cut in the chat handler.
const cutLines = /(const long = pageText\(msg\.text\)\.slice\(0, COMMAND_CHARS\);\s*const text = [^\n]+)/.exec(voice);
// The cut reads the line through pageText (#4206), so it runs with the real one.
const pageTextFn = (/function pageText\(v\) \{[\s\S]*?\r?\n\}/.exec(voice) || [''])[0];
yes('the chat handler\'s cut is found', !!cutLines && !!pageTextFn);
if (cutLines && pageTextFn) {
  const run = function (line) {
    const box = { msg: { text: line }, COMMAND_CHARS: commandChars, SAID_CHARS: 400,
                  headlines: { floatLine: function (l) { return /^\/(me|do|w|s|ooc)\b/.test(l); } }, out: null };
    vm.runInNewContext(pageTextFn + '\n' + cutLines[1] + '\nout = text;', box);
    return box.out;
  };
  yes('that longest page line goes through the socket whole', run(worst) === worst);
  yes('a line said to the room still keeps 400', run('x'.repeat(5000)).length === 400);
}

// The real writePage.
const wp = /(function writePage\([\s\S]*?\n  \})\n/.exec(gm);
yes('writePage is found', !!wp);
if (wp) {
  yes('writePage no longer cuts the text with a slice', !/slice\(0, SOCIAL\.pageChars\)/.test(wp[1]));
  const state = { journals: [{ id: 'j1', pages: [] }] };
  let writes = 0;
  const box = {
    SOCIAL: { pageChars: pageChars, mostPages: 60 },
    stateOf: function () { return state; },
    findJournal: function (s, id) { return s.journals.filter(function (j) { return j.id === id; })[0] || null; },
    write: function () { writes++; }
  };
  vm.runInNewContext(wp[1] + '\nthis.writePage = writePage;', box);
  const full = 'a\n'.repeat(pageChars / 2);
  yes('a page of exactly pageChars is saved whole', box.writePage(1, 'j1', '', 'Full', full) === '' &&
      state.journals[0].pages.length === 1 && state.journals[0].pages[0].text === full && writes === 1);
  const said = box.writePage(1, 'j1', state.journals[0].pages[0].id, 'Over', full + 'x');
  yes('a page one character over is refused and says how long it is (' + said + ')',
      /too long/.test(said) && said.indexOf(String(pageChars + 1)) !== -1);
  yes('and the page that was there is left as it was', state.journals[0].pages[0].text === full &&
      state.journals[0].pages[0].title === 'Full' && writes === 1);
}

// The panel refuses before sending.
const save = /if \(verb === 'save'\) \{([\s\S]*?)\n    \}/.exec(journal);
yes('Save checks the length and tells the footer before it sends',
    !!save && /raw\.length > PAGE_CHARS/.test(save[1]) && /-foot/.test(save[1]) &&
    save[1].indexOf('raw.length > PAGE_CHARS') < save[1].indexOf('net('));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
