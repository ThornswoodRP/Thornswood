'use strict';
/*
  test-4535-rebuild-record.js

      node tests/test-4535-rebuild-record.js

  #4535. docs/COLLECTION-REBUILD-7ESSXF.md was written as the body of the pull
  request that moved Thornswood onto the 7essxf collection (#648, 27 September
  2026), and it still read as the present: the content plugin the only plugin,
  nothing tied to the collection shipping, three operator scripts to check
  before running, and a launcher Firewall.cs. By main today the Last plugin
  is made on each machine from the collection's plugins, 122 outfit meshes
  built from collection mods ship until #1259, the three scripts are retired,
  and Firewall.cs is gone. A reader took the page for how things are.

    R  the page opens by saying it is a record, of which pull request and
       which day, and that it is not how things are now
    N  it names what depends on the collection on main: Thornswood-Last.esp
       and its recipe, and the meshes in built-until-1259.txt
    S  the three scripts it once asked to check are named as retired
    F  Firewall.cs is named only as gone
    P  every repository path it writes in backticks is in the tree
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'docs', 'COLLECTION-REBUILD-7ESSXF.md');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

const text = fs.readFileSync(PAGE, 'utf8');
const head = text.split(/\r?\n## /)[0].replace(/\s+/g, ' ');

yes('R the opening says it is a record of #648, 27 September 2026, not how things are now',
    /record/i.test(head) && /#648/.test(head) && /27 September 2026/.test(head) && /not how/i.test(head));

yes('N it names Thornswood-Last.esp and game/data/last-plugin.recipe',
    /Thornswood-Last\.esp/.test(text) && /game\/data\/last-plugin\.recipe/.test(text));
yes('N it names the meshes in scripts/release/built-until-1259.txt',
    /scripts\/release\/built-until-1259\.txt/.test(text) && /122/.test(text) && /#1259/.test(text));

const lines = text.split(/\r?\n/);
for (const s of ['Fix-QuickLoot.ps1', 'Enable-MCM.ps1', 'Add-McmShortcut.ps1']) {
  const at = lines.filter((l) => l.indexOf(s) >= 0);
  yes('S ' + s + ' is named as retired', at.length > 0 && at.every((l) => /retired/i.test(l)));
}

const fw = lines.filter((l) => l.indexOf('Firewall.cs') >= 0);
yes('F Firewall.cs is named only as gone', fw.every((l) => /no longer|gone/i.test(l)));

const missing = [];
const re = /`((?:launcher|scripts|game|records|docs|tests)\/[^`\s]+)`/g;
let m;
while ((m = re.exec(text))) {
  const p = m[1].replace(/[),.]+$/, '');
  if (!fs.existsSync(path.join(ROOT, p))) missing.push(p);
}
yes('P every repository path in backticks is in the tree' + (missing.length ? ' (' + missing.join(', ') + ')' : ''),
    missing.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
