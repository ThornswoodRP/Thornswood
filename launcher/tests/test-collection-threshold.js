/*
  test-collection-threshold.js

  How many enabled plugins it takes before the launcher believes the
  collection is installed, asked in one place.

  WHY THIS EXISTS. Two things on screen answer "are the mods installed" from
  the same plugin count: the Mods row on the checks list (Checks.All) and the
  "Your mods are not installed yet" card above Play (Shell.CollectionProblem
  returning "none"). Each had its own 40 written into it. Entry 265 found
  them: "The threshold 40 appears twice, at Shell.cs:4260 and in the Mods row
  at Checks.cs:424, while the reference list has 96 starred plugins, so
  either both move together or the number goes into one place." Moving one
  and not the other gives a green Mods row under a card saying the mods are
  not installed, or a red row with no card.

  The number now lives in Checks.MostPluginsWithoutCollection. This reads
  the C#, finds both comparisons, and evaluates them against every count from
  0 to 200, so it fails if either copy comes back as a literal, if the two
  stop being exact opposites, or if the boundary moves from 40 without
  anybody meaning it to.

  It also holds the doc comment above CollectionProblem to what the method
  does now: one summary, all four answers, and no argument for the old
  po3_StartOnSave.dll sentinel that the revision check replaced.

  Read only. It reads source files and nothing else.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

const APP = path.join(REPO_DIR, 'launcher', 'app');
const CHECKS = fs.readFileSync(path.join(APP, 'Checks.cs'), 'utf8');
const SHELL = fs.readFileSync(path.join(APP, 'Shell.cs'), 'utf8');

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};

// ---- one number ------------------------------------------------------------
const decl = CHECKS.match(/public const int MostPluginsWithoutCollection = (\d+);/g) || [];
yes('Checks.cs declares the threshold once', decl.length === 1);
const value = decl.length === 1 ? Number(/(\d+);/.exec(decl[0])[1]) : NaN;
yes('the threshold is still 40, so nothing behaves differently', value === 40);

/*
  Any plugin count compared against a bare number, anywhere in the launcher.
  The two that used to be here were "Checks.EnabledPlugins() <= 40" and
  "plugins > 40".
*/
const literal = /(EnabledPlugins\(\)|\bplugins)\s*(<=|>=|<|>|==|!=)\s*\d+/;
const offenders = [];
for (const f of fs.readdirSync(APP)) {
  if (!f.endsWith('.cs')) continue;
  const lines = fs.readFileSync(path.join(APP, f), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.trim().startsWith('//')) return;
    if (literal.test(line)) offenders.push(f + ':' + (i + 1) + '  ' + line.trim());
  });
}
yes('no plugin count in the launcher is compared against a bare number', offenders.length === 0);
for (const o of offenders) console.log('      ' + o);

// ---- both places ask it ----------------------------------------------------
/*
  The comparison each one makes, pulled out of the source so it can be run.
  Shell.cs says "none" when the count passes its test; Checks.cs shows the
  Mods row green when the count passes its test.
*/
const noneRe = /if \(Checks\.EnabledPlugins\(\) (<=|>=|<|>) Checks\.MostPluginsWithoutCollection\) return "none";/;
// Two shapes of the Mods row. The first was one line; ModsRow (#709) asks the
// same question as an if that returns the red row, then the green one. Either
// way the test below runs the comparison it actually makes.
const modsRe = /new Check\("Mods", plugins (<=|>=|<|>) MostPluginsWithoutCollection, plugins \+ " plugins"\)/;
// Either return may carry an initializer ({ Problem = "Mods not installed" },
// the Ready card's words, #3203) before its semicolon.
const modsIfRe = /if \(plugins (<=|>=|<|>) MostPluginsWithoutCollection\)\s*return new Check\("Mods", (true|false), plugins \+ " plugins"\)(?:\s*\{[^}]*\})?;\s*return new Check\("Mods", (true|false), plugins \+ " plugins"\)(?:\s*\{[^}]*\})?;/;
const noneM = noneRe.exec(SHELL);
const modsOne = modsRe.exec(CHECKS);
const modsIf = modsOne ? null : modsIfRe.exec(CHECKS);
const modsM = modsOne ? [modsOne[0], modsOne[1], 'true']
            : modsIf && modsIf[2] !== modsIf[3] ? [modsIf[0], modsIf[1], modsIf[2]] : null;
yes('CollectionProblem asks the constant before saying "none"', !!noneM);
yes('the Mods row asks the same constant', !!modsM);

function compare(op, a, b, when) {
  let r = false;
  if (op === '<=') r = a <= b;
  else if (op === '>=') r = a >= b;
  else if (op === '<') r = a < b;
  else if (op === '>') r = a > b;
  // The Mods row is green on the branch that says true.
  return when === 'false' ? !r : r;
}

if (noneM && modsM && !Number.isNaN(value)) {
  let agree = true;
  let firstGreen = -1;
  for (let n = 0; n <= 200; n++) {
    const none = compare(noneM[1], n, value);
    const green = compare(modsM[1], n, value, modsM[2]);
    if (none === green) agree = false;
    if (green && firstGreen < 0) firstGreen = n;
  }
  yes('for every count from 0 to 200 the Mods row is green exactly when there is no "none" card', agree);
  yes('41 plugins is the first count that reads as installed, as it was before', firstGreen === 41);
  yes('40 plugins still reads as not installed', compare(noneM[1], 40, value) && !compare(modsM[1], 40, value, modsM[2]));
  yes('the 94 the shipped reference list enables reads as installed',
      !compare(noneM[1], 94, value) && compare(modsM[1], 94, value, modsM[2]));
  yes('nothing installed reads as not installed', compare(noneM[1], 0, value) && !compare(modsM[1], 0, value, modsM[2]));
} else {
  yes('both comparisons could be read out of the source', false);
}

// ---- the doc comment above CollectionProblem -------------------------------
const at = SHELL.indexOf('static string CollectionProblem(int revision = -1)');
yes('CollectionProblem is still there to read', at > 0);
const before = SHELL.slice(0, at).split(/\r?\n/);
before.pop(); // the indentation in front of the signature
const doc = [];
while (before.length && before[before.length - 1].trim().startsWith('///')) doc.unshift(before.pop().trim());
const docText = doc.join('\n');
yes('it has a doc comment', doc.length > 0);
yes('the doc comment is one summary, not two stacked',
    (docText.match(/<summary>/g) || []).length === 1 && (docText.match(/<\/summary>/g) || []).length === 1);
yes('it names all four answers the method gives',
    docText.indexOf('""') >= 0 && docText.indexOf('"none"') >= 0 &&
    docText.indexOf('"stale"') >= 0 && docText.indexOf('"ahead"') >= 0);
yes('it no longer argues for the Start On Save sentinel',
    !/Start ?On ?Save|po3_StartOnSave/i.test(docText));
yes('it points at the constant the "none" answer uses',
    docText.indexOf('MostPluginsWithoutCollection') >= 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
