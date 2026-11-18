/*
  #4353: the Developer Guide names one clone folder and the claim labels the
  repository has, each once.

  Measured on main 0638ff5: the guide put the clone in three places,
  C:\Dev\Thornswood (set-up-a-machine.md, tools.md),
  C:\Users\<you>\Downloads\Thornswood-Repo (set-up-a-machine.md,
  the-system.md, release-to-main.md) and C:\Thornswood-Repo (rules.md,
  how-work-moves.md), cloned the repository in two places, and named no
  claim label but a `claimed: <name>` pattern. C:\Thornswood-Repo is the
  one every script example and recorded ship root uses
  (scripts/release/Setup-ShipMachine.ps1, Where.ps1, Update-Checkout.ps1).

  The claim labels are the six the Bots claim with, as the repository
  has them (labels "Claimed by <Bot>, a Thornswood Hermes Bot").
  Read only.
*/
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const CLONE = 'C:\\Thornswood-Repo';
const HOME = 'docs/guide/set-up-a-machine.md';
const BOARD = 'docs/guide/the-board.md';
const BOTS = ['Bramble', 'Echo', 'Magpie', 'Rift', 'Sprocket', 'Wisp'];

let pass = 0;
let fail = 0;
function yes(name, ok) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
}

const pages = ['Developer-Guide.md'].concat(
  fs.readdirSync(path.join(root, 'docs', 'guide')).filter((f) => f.endsWith('.md')).sort().map((f) => 'docs/guide/' + f));
const text = {};
for (const p of pages) text[p] = fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

yes('the guide pages are there to read (' + pages.length + ')', pages.length > 5 && Boolean(text[HOME]) && Boolean(text[BOARD]));

// One clone folder.
const other = [
  ['C:\\Dev\\Thornswood', /C:\\Dev\\Thornswood/],
  ['a Thornswood-Repo in Downloads', /Downloads\\Thornswood-Repo/],
];
for (const [what, re] of other) {
  const where = pages.filter((p) => re.test(text[p]));
  yes('no guide page puts the clone at ' + what + (where.length ? ' (' + where.join(', ') + ')' : ''), where.length === 0);
}

// The repository is cloned once, into C:\Thornswood-Repo.
const clones = [];
for (const p of pages) {
  text[p].split('\n').forEach((l, i) => {
    if (/git clone https:\/\/github\.com\/ThornswoodRP\/Thornswood(\.git)?\b/.test(l)) clones.push({ p, i: i + 1, l: l.trim() });
  });
}
yes('the guide clones the repository in one place (' + clones.map((c) => c.p + ':' + c.i).join(', ') + ')', clones.length === 1);
const only = clones.length === 1 ? clones[0] : null;
yes('that place is ' + HOME + ', "Clone the repository"', only !== null && only.p === HOME &&
  text[HOME].indexOf('### Clone the repository') > -1 &&
  text[HOME].indexOf('### Clone the repository') < text[HOME].indexOf(only.l));
yes('it clones into ' + CLONE, only !== null && (/ C:\\Thornswood-Repo$/.test(only.l) ||
  (/ Thornswood-Repo$/.test(only.l) && /cd C:\\\n/.test(text[HOME]))));

// The folder is said once: one sentence says where the clone lives.
const says = [];
for (const p of pages) {
  text[p].split(/\n\s*\n/).forEach((para) => {
    const flat = para.replace(/\s+/g, ' ');
    if (/(clone|repository folder)[^.]*(is|lives at|at|sits at) `?C:\\Thornswood-Repo`?/i.test(flat) ||
        /C:\\Thornswood-Repo`? is (shared|the clone)/i.test(flat) ||
        /that folder is `C:\\Thornswood-Repo`/.test(flat)) says.push(p);
  });
}
yes('one paragraph says where the clone lives (' + says.join(', ') + ')', says.length === 1 && says[0] === HOME);

// The claim labels: the six, listed once, on the board page.
const listed = {};
for (const p of pages) {
  const names = new Set();
  for (const m of text[p].matchAll(/`claimed: ([A-Za-z]+)`/g)) names.add(m[1]);
  if (names.size) listed[p] = [...names].sort();
}
const where = Object.keys(listed);
yes('one page lists the claim labels (' + (where.join(', ') || 'none') + ')', where.length === 1 && where[0] === BOARD);
const got = listed[BOARD] || [];
yes('it lists the six the repository has (' + (got.join(', ') || 'none') + ')',
  got.length === BOTS.length && BOTS.every((b) => got.includes(b)));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
