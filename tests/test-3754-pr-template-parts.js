// test-3754-pr-template-parts.js
//
// The pull request template's parts list names the same parts as the table in
// docs/guide/after-a-merge.md, "After a pull request is merged", and gives no command of
// its own.
//
// WHY THIS EXISTS. Issue #3754: the template's list was a second copy of the
// guide's table, commands included. When -GamemodeOnly and the content
// plugin's order came into the table, the copy was not changed, so a developer
// who followed the template for a live gamemode change was sent to the full
// server deploy, which needs a fork build, and the content plugin and the bot
// avatar had no line at all. Nothing checked that the two agreed.
//
// So the template now names parts only and points at the table for the
// commands. This fails when the two drift: a row added to the table with no
// line in the template, a path the table names that the template does not,
// or a command written back into the template.
//
//     node tests/test-3754-pr-template-parts.js
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').replace(/^﻿/, '').replace(/\r/g, ''); }

// ------------------------------------------------------------ the guide's table
// The table is the guide's page of its own, docs/guide/after-a-merge.md.
const guide = read('docs/guide/after-a-merge.md').split('\n');
const start = guide.findIndex(function (l) { return /^# After a pull request is merged\s*$/.test(l); });
yes('docs/guide/after-a-merge.md has the title "After a pull request is merged"', start >= 0);
const rows = [];
for (let i = start + 1; start >= 0 && i < guide.length && !/^#{1,3} /.test(guide[i]); i++) {
  const l = guide[i];
  if (!/^\|/.test(l)) continue;
  if (/^\|\s*-/.test(l) || /^\|\s*You changed\s*\|/.test(l)) continue;
  rows.push(l.split('|')[1]);
}
yes('the table has rows to compare (' + rows.length + ')', rows.length >= 8);

// ------------------------------------------------------------ the template's list
const tpl = read('.github/pull_request_template.md');
const sec = /#{2,3} Which parts it touches[^\n]*\n([\s\S]*?)\n#{2,3} /.exec(tpl);
yes('the template has its "Which parts it touches" section', sec !== null);
const body = sec ? sec[1] : '';
const boxes = body.split('\n').filter(function (l) { return /^- \[ \] /.test(l); });
const parts = boxes.filter(function (l) { return !/^- \[ \] Docs only\s*$/.test(l); });
yes('the template has one part line for each row of the table (' + parts.length + ' lines, ' + rows.length + ' rows)',
    parts.length === rows.length);
yes('and a "Docs only" line', boxes.length === parts.length + 1);

const missing = [];
rows.forEach(function (r) {
  (r.match(/`[^`]+`/g) || []).forEach(function (p) { if (body.indexOf(p) < 0) missing.push(p); });
});
missing.forEach(function (p) { console.log('      named in the table, not in the template: ' + p); });
yes('every path the table names is on a line of the template', missing.length === 0);

yes('the template points at the table by its heading', /After a pull request is merged/.test(body));

// The commands live in the table only. A script name or a switch in the
// template is the second copy coming back.
const CMD = /\b(Deploy|Install|Publish)-[A-Z][A-Za-z]*|\.ps1\b|\s-[A-Z][A-Za-z]+\b/;
const cmds = body.split('\n').filter(function (l) { return CMD.test(l); });
cmds.forEach(function (l) { console.log('      a command in the template: ' + l.trim()); });
yes('the template names no command, so there is one copy of them', cmds.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
