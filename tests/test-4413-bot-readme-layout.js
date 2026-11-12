'use strict';
/*
  test-4413-bot-readme-layout.js

      node tests\test-4413-bot-readme-layout.js

  #4413. After the staff council rework (#3317), bot\README.md still named
  channels the builder no longer makes, counted eighteen hold roles where the
  plan has twenty, said a Lead Gamemaster is not staff to the bot when the
  bot's own STAFF_ROLES default lists every lead, listed roles in an old order
  without the council, and said staff give Member after an application is
  accepted.

  The builder's plan is docs\systems\discord.md: Build-Discord.py --layout
  writes it from ROLES and PLAN, and bot\tests\test-3317-layout.py fails
  when the two differ. This reads that page and the bot's STAFF_ROLES
  default, and holds bot\README.md to them:

    C  every #channel the readme names is one the build makes, or one of the
       three the plan keeps by name that something else makes (KEPT below);
    H  every count of hold roles the readme gives is the number of Jarl and
       Citizen roles in the plan;
    S  the readme's STAFF_ROLES default is the bot's, and it never says a
       role in that default is not staff;
    R  the readme's roles table has every staff rank of the council table,
       in the plan's order;
    M  the readme never says staff give Member after an application.

  Read only.
*/
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond, more) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (more ? '  (' + more + ')' : '')); }
}
const ROOT = path.join(__dirname, '..');
function read(...p) {
  const f = path.join(ROOT, ...p);
  const there = fs.existsSync(f);
  yes('reads ' + path.join(...p), there);
  return there ? fs.readFileSync(f, 'utf8').split('\r\n').join('\n') : '';
}

const LAYOUT = read('docs', 'systems', 'discord.md');
const README = read('bot', 'README.md');
const CORE = read('bot', 'bot_core.py');

/* ---- the plan ----------------------------------------------------------- */
const made = new Set();
const keptByName = new Set();
const chanAt = LAYOUT.indexOf('## Categories and channels');
for (const line of LAYOUT.slice(chanAt < 0 ? LAYOUT.length : chanAt).split('\n')) {
  const m = /^\| #([a-z0-9-]+) \|/.exec(line);
  if (!m) continue;
  (/never made by the build/.test(line) ? keptByName : made).add(m[1]);
}
yes('the plan lists the channels it makes (' + made.size + ')', made.size > 100);

/* Kept by name and never made by the build, yet on the server: the bot's
   staff channel (staff-channel.txt, by id), the dev test task forum the bot
   makes with --setup-channels, and the music bot's channel made by hand. Each
   has to be one the plan keeps by name. */
const KEPT = ['staff-updates', 'dev-test-tasks', 'jukebox'];
yes('each channel made outside the build is one the plan keeps by name',
  KEPT.every((n) => keptByName.has(n)), KEPT.filter((n) => !keptByName.has(n)).join(', '));

const roleRows = [];
const rolesAt = LAYOUT.indexOf('## Roles, top of the list first');
for (const line of LAYOUT.slice(rolesAt < 0 ? LAYOUT.length : rolesAt).split('\n')) {
  if (/^### |^## Who/.test(line)) break;
  const m = /^\| ([^|]+?) \| #[0-9A-F]{6} \|/.exec(line);
  if (m) roleRows.push(m[1]);
}
const HOLD_ROLES = roleRows.filter((r) => /^(Jarl|Citizen) of /.test(r)).length;
yes('the plan has its hold roles, Jarl and Citizen (' + HOLD_ROLES + ')', HOLD_ROLES > 0);

const ranks = [];
const councilAt = LAYOUT.indexOf('| Category | Its space | Lead | Ranks under the lead |');
for (const line of LAYOUT.slice(councilAt < 0 ? LAYOUT.length : councilAt).split('\n').slice(2)) {
  const m = /^\| [^|]+ \| [^|]+ \| ([^|]+) \| ([^|]+) \|$/.exec(line);
  if (!m) break;
  ranks.push(m[1].trim());
  for (const r of m[2].split(',')) ranks.push(r.trim());
}
const STAFF_RANKS = ['Owner', 'Co-Owner'].concat(ranks);
yes('the plan\'s council table names its staff ranks (' + STAFF_RANKS.length + ')', ranks.length >= 12);

const sm = /os\.environ\.get\('STAFF_ROLES',\s*((?:'[^']*'\s*)+)\)/.exec(CORE);
const STAFF_DEFAULT = sm ? sm[1].replace(/'\s*'/g, '').replace(/'/g, '').split(',').map((s) => s.trim()).filter(Boolean) : [];
yes('bot_core.py has a STAFF_ROLES default (' + STAFF_DEFAULT.join(', ') + ')', STAFF_DEFAULT.length > 0);

/* ---- C: the channels the readme names ----------------------------------- */
console.log('\nC, the channels the readme names:');
const named = new Set();
const re = /(?<![\w\/.&<])#([a-z][a-z0-9-]*)(?![\w<-]*>)/g;
let m;
while ((m = re.exec(README))) named.add(m[1]);
const unknown = [...named].filter((n) => !made.has(n) && KEPT.indexOf(n) < 0).sort();
yes('every #channel bot\\README.md names is one the build makes, or one of ' + KEPT.join(', '),
  named.size > 0 && unknown.length === 0, unknown.map((n) => '#' + n).join(' '));

/* ---- H: hold role counts ------------------------------------------------ */
console.log('\nH, the hold role count:');
const WORDS = { ten: 10, twelve: 12, sixteen: 16, eighteen: 18, twenty: 20, 'twenty-two': 22 };
const counts = [];
const hr = /\b([A-Za-z-]+|\d+) hold roles\b/g;
while ((m = hr.exec(README))) {
  const w = m[1].toLowerCase();
  const n = /^\d+$/.test(w) ? Number(w) : WORDS[w];
  if (n !== undefined) counts.push(m[1] + '=' + n);
}
yes('every count of hold roles in the readme is the plan\'s ' + HOLD_ROLES,
  counts.length > 0 && counts.every((c) => Number(c.split('=')[1]) === HOLD_ROLES), counts.join(', ') || 'none given');

/* ---- S: who is staff to the bot ----------------------------------------- */
console.log('\nS, who is staff to the bot:');
const said = /`STAFF_ROLES`[^()]*\(([^)]*?)\s+by\s+default\)/.exec(README);
const readmeStaff = said ? said[1].replace(/\s+/g, ' ').split(/, | and /).map((s) => s.trim()).filter(Boolean) : [];
yes('the readme gives STAFF_ROLES\'s default as the bot\'s',
  readmeStaff.length === STAFF_DEFAULT.length && STAFF_DEFAULT.every((r) => readmeStaff.indexOf(r) >= 0),
  'readme: ' + readmeStaff.join(', '));
const flat = README.replace(/\s+/g, ' ');
const saysNot = STAFF_DEFAULT.filter((r) => new RegExp(r + '[^.]{0,80}\\bnot (in that list|staff)').test(flat) ||
  new RegExp('Neither is staff to the bot').test(flat) && r === 'Lead Gamemaster');
yes('the readme never says a role in that default is not staff', saysNot.length === 0, saysNot.join(', '));

/* ---- R: the roles table ------------------------------------------------- */
console.log('\nR, the roles table:');
const rolesSec = README.slice(README.indexOf('## Roles'));
const tableNames = [];
for (const line of rolesSec.split('\n')) {
  const r = /^\| ([^|]+?) \|/.exec(line);
  if (r && r[1] !== 'Role' && !/^-+$/.test(r[1])) tableNames.push(r[1]);
  if (tableNames.length && !/^\|/.test(line)) break;
}
const missing = STAFF_RANKS.filter((r) => tableNames.indexOf(r) < 0);
yes('the readme\'s roles table has every staff rank in the plan', missing.length === 0, 'missing ' + missing.join(', '));
const inPlan = tableNames.filter((r) => roleRows.indexOf(r) >= 0);
const ordered = inPlan.every((r, i) => i === 0 || roleRows.indexOf(inPlan[i - 1]) < roleRows.indexOf(r));
yes('and the roles it shares with the plan are in the plan\'s order', inPlan.length > 0 && ordered, inPlan.join(' > '));

/* ---- M: Member ---------------------------------------------------------- */
console.log('\nM, Member:');
yes('the readme never says staff give Member after an application',
  !/Staff give \**Member\**/i.test(flat) && !/Given by staff after an application/i.test(flat) &&
  !/Member is what staff give/i.test(flat));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
