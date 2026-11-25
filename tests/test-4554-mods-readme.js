'use strict';
// test-4554-mods-readme.js
//
//     node tests/test-4554-mods-readme.js
//
// Every script in scripts/mods (.ps1, .py, .js) has a row in scripts/mods/README.md,
// and every row in scripts/mods/README.md points to a script that exists in scripts/mods.
//
// WHY THIS EXISTS. Issue #4554: scripts/README.md lists every PowerShell script
// under scripts, noting that node and Python scripts are not in its list.
// scripts/mods has Python and node tools that were indexed nowhere.
// This harness ensures scripts/mods/README.md stays in step with the folder.
//
// Read only.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODS_DIR = path.join(ROOT, 'scripts', 'mods');
const README_PATH = path.join(MODS_DIR, 'README.md');

let passes = 0;
let failures = 0;

function check(desc, ok) {
    if (ok) {
        passes++;
        console.log(`PASS  ${desc}`);
    } else {
        failures++;
        console.log(`FAIL  ${desc}`);
    }
}

const readmeExists = fs.existsSync(README_PATH);
check('scripts/mods/README.md exists', readmeExists);

const readmeText = readmeExists ? fs.readFileSync(README_PATH, 'utf8') : '';
const lines = readmeText.split(/\r?\n/);

const tableRows = lines.filter(l => l.startsWith('| ['));
check('scripts/mods/README.md contains script rows', tableRows.length > 0);

const listedScripts = [];
for (const row of tableRows) {
    const match = row.match(/^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.*?)\s*\|$/);
    if (!match) {
        check(`Row matches table format: ${row}`, false);
        continue;
    }
    const name = match[1];
    const link = match[2];
    const purpose = match[3];

    check(`Link matches name for ${name}`, name === link);
    check(`Purpose is not empty for ${name}`, purpose.trim().length > 0);
    listedScripts.push(name);
}

// Check scripts in folder
const files = fs.readdirSync(MODS_DIR);
const actualScripts = files.filter(f => /\.(ps1|py|js)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

check(`scripts/mods has ${actualScripts.length} scripts`, actualScripts.length > 0);

const missingFromReadme = actualScripts.filter(s => !listedScripts.includes(s));
check(`all scripts in scripts/mods are listed in README.md${missingFromReadme.length ? ' (missing: ' + missingFromReadme.join(', ') + ')' : ''}`, missingFromReadme.length === 0);

const staleInReadme = listedScripts.filter(s => !actualScripts.includes(s));
check(`no stale scripts listed in README.md${staleInReadme.length ? ' (stale: ' + staleInReadme.join(', ') + ')' : ''}`, staleInReadme.length === 0);

const duplicates = listedScripts.filter((item, index) => listedScripts.indexOf(item) !== index);
check(`no duplicate entries in README.md${duplicates.length ? ' (duplicates: ' + duplicates.join(', ') + ')' : ''}`, duplicates.length === 0);

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures > 0 ? 1 : 0;
