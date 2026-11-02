// test-3682-github-front.js
//
// What a stranger meets on GitHub before anything else is written for them:
// the issue chooser, the issue forms, the public part of the pull request
// template, the community files and the CODEOWNERS note.
//
// WHY THIS EXISTS. Issue #3682, the going-public audit of 26 Oct 2026. Blank
// issues were on, and the only template was the team's internal work order,
// with words a reader new to English may not know ("do-order", "band-aids",
// "Traps"). The chooser's security button opened GitHub's advisory form, which
// a private repository cannot use (#3650), while SECURITY.md named another
// route. The pull request template was written for staff from its first line,
// and told people to leave out a footer by the name of the tool that writes
// it. There was no CODE_OF_CONDUCT, CONTRIBUTING or SUPPORT file, and the
// CODEOWNERS note ran to 38 lines of rule history.
//
// So this fails when blank issues come back on, when a contact link goes to
// the advisory form while SECURITY.md sends reports elsewhere, when a form for
// outside reports is not labelled triage or uses the team's words, when the
// template's public part names a staff channel, a deploy or an agent, when a
// community file is missing, or when the CODEOWNERS note grows past a few
// lines again.
//
//     node tests/test-3682-github-front.js
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
function read(rel) {
  try { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').replace(/^﻿/, '').replace(/\r/g, ''); }
  catch (e) { return null; }
}

// Words a stranger should not meet: the team's own terms, its channels and
// tools, and the writing rules every page people read keeps.
const EM_DASH = new RegExp(String.fromCharCode(0x2014));
const PLAYER = /\bplayers?\b/i;
const TEAM_WORDS = /\b(band-?aids?|do-order|traps?)\b/i;
const STAFF = /#staff-updates|#dev-coordination|\bShip\b|Deploy-|Install-|\bClaude\b|Lead Dev/;

// ------------------------------------------------------------ the chooser
const DIR = '.github/ISSUE_TEMPLATE';
const config = read(DIR + '/config.yml');
yes('the issue chooser has a config.yml', config !== null);
yes('blank issues are off, so every issue comes through a form', /^blank_issues_enabled:\s*false\s*$/m.test(config || ''));
const security = read('SECURITY.md') || '';
const advisoriesNamed = /security\/advisories\/new|Security tab/.test(security) && !/repository is private/i.test(security);
yes('no contact link opens the advisory form while SECURITY.md sends reports somewhere else (#3650)',
    !/security\/advisories/.test(config || '') || advisoriesNamed);
const links = (config || '').match(/^\s+url:\s*(\S+)\s*$/gm) || [];
yes('every contact link is an https address (' + links.length + ')',
    links.length >= 1 && links.every(function (l) { return /url:\s*https:\/\//.test(l); }));
yes('the security link goes to SECURITY.md', /url:\s*https:\/\/github\.com\/ThornswoodRP\/Thornswood\/blob\/main\/SECURITY\.md/.test(config || ''));

// ------------------------------------------------------------ the forms
const forms = fs.readdirSync(path.join(REPO_DIR, DIR)).filter(function (f) { return /\.ya?ml$/.test(f) && f !== 'config.yml'; }).sort();
const mdTemplates = fs.readdirSync(path.join(REPO_DIR, DIR)).filter(function (f) { return /\.md$/i.test(f); });
yes('the templates are forms, not Markdown templates (' + mdTemplates.join(', ') + ')', mdTemplates.length === 0);
['bug.yml', 'crash.yml', 'suggestion.yml'].forEach(function (f) {
  yes('there is a form ' + f, forms.indexOf(f) >= 0);
});
forms.forEach(function (f) {
  const t = read(DIR + '/' + f);
  const name = /^name:\s*(.+)$/m.exec(t);
  const desc = /^description:\s*(.+)$/m.exec(t);
  const label = /^labels:\s*\[(.*)\]\s*$/m.exec(t);
  const ids = (t.match(/^\s+id:\s*(\S+)\s*$/gm) || []).map(function (l) { return l.trim().slice(3).trim(); });
  const fields = t.match(/^  - type:\s*(textarea|input|dropdown|checkboxes)\s*$/gm) || [];
  yes(f + ' has a name, a description and a body', !!name && !!desc && /^body:\s*$/m.test(t));
  yes(f + ' has fields, each with its own id (' + ids.length + ')', fields.length >= 1 && ids.length === fields.length &&
      ids.every(function (id, i) { return ids.indexOf(id) === i; }));
  yes(f + ' does not use tabs, which YAML refuses', t.indexOf('\t') < 0);
  yes(f + ' has no em dash and never says player', !EM_DASH.test(t) && !PLAYER.test(t));
  const forTeam = /^description:\s*For the Thornswood team/m.test(t);
  if (!forTeam) {
    yes(f + ' is for reports from outside, so it puts on triage', !!label && /"triage"/.test(label[1]));
    yes(f + ' uses none of the team\'s own words', !TEAM_WORDS.test(t.replace(/^description:.*$/m, '')) && !STAFF.test(t));
  } else {
    yes(f + ' is for the team and puts on no triage label', !label || !/"triage"/.test(label[1]));
  }
});

// ------------------------------------------------------------ the pull request template
const tpl = read('.github/pull_request_template.md') || '';
const cut = tpl.indexOf('## For the Thornswood team');
yes('the pull request template has a part for the Thornswood team', cut > 0);
const pub = cut > 0 ? tpl.slice(0, cut) : tpl;
const staffHits = pub.split('\n').filter(function (l) { return STAFF.test(l) || TEAM_WORDS.test(l); });
staffHits.forEach(function (l) { console.log('      in the public part: ' + l.trim()); });
yes('its public part names no staff channel, deploy, agent or team word', staffHits.length === 0);
yes('its public part points a stranger at CONTRIBUTING.md and LICENSE', /CONTRIBUTING\.md/.test(pub) && /LICENSE/.test(pub));
yes('nothing in it names the tool that writes a footer', !/Claude Code/.test(tpl));

// ------------------------------------------------------------ community files
['CODE_OF_CONDUCT.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'SECURITY.md'].forEach(function (f) {
  const t = read(f);
  yes(f + ' is at the root of the repository', t !== null);
  if (t !== null) yes(f + ' names no agent and no staff channel', !/\bClaude\b|#staff-|#dev-/.test(t));
});

// ------------------------------------------------------------ CODEOWNERS
const co = (read('.github/CODEOWNERS') || '').split('\n');
const firstRule = co.findIndex(function (l) { return /^\//.test(l); });
const note = co.slice(0, firstRule).filter(function (l) { return /^#/.test(l); });
yes('the CODEOWNERS note above the rules is a few lines (' + note.length + ')', firstRule > 0 && note.length <= 10);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
