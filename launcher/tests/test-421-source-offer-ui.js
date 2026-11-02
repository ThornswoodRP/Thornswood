'use strict';
/*
  test-421-source-offer-ui.js

  The SkyMP source is offered where the server is used, not only on the site,
  the installer and the packs (#421, the 19 Oct review: AGPL section 13 asks
  for a prominent offer to everybody who uses the server over a network).

  A. THE LAUNCHER. The window (MainWindow.axaml) has the Source code link
     under the version lines, Shell.cs wires it to ClientRuntime.SourceUrl,
     and the patterns ClientRuntime.cs reads the embedded record with give
     the fork at the commit records\client-build.json names.
  B. THE GAME. The help panel's Getting help topic says where the source is.

  Read only.
*/
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(...bits) { return fs.readFileSync(path.join(REPO, ...bits), 'utf8').split(CR).join(''); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

// ---- A. the launcher -----------------------------------------------------------
const xaml = read('launcher', 'app', 'MainWindow.axaml');
const shell = read('launcher', 'app', 'Shell.cs');
const runtime = read('launcher', 'app', 'ClientRuntime.cs');
const record = read('records', 'client-build.json');

const at = xaml.indexOf('x:Name="BtnSource"');
yes('the window has the Source code link', at >= 0 && /x:Name="BtnSource"[^>]*Content="Source code"/.test(xaml));
yes('  under the version lines in the sidebar', at > xaml.indexOf('x:Name="TxtBuildLine"') && xaml.indexOf('x:Name="TxtBuildLine"') > 0);
yes('Shell.cs opens ClientRuntime.SourceUrl from it',
  /Button btnSource = win\.BtnSource;/.test(shell) && /ClientRuntime\.SourceUrl/.test(shell) && /btnSource\.Click \+= delegate \{ Open\(source\); \}/.test(shell));
yes('  and the credits page\'s source section when the exe carries no record', /\/credits#source"/.test(shell));

// The two patterns ClientRuntime.cs reads the record with, as C# string
// literals, run here on the real record.
function csPattern(name) {
  const m = new RegExp('Match ' + name + ' = Regex\\.Match\\(text, "((?:[^"\\\\]|\\\\.)*)"\\);').exec(runtime);
  return m ? JSON.parse('"' + m[1] + '"') : null;
}
const pf = csPattern('f'), pc = csPattern('c');
yes('ClientRuntime.cs reads the fork and the commit out of the record', !!pf && !!pc);
const doc = JSON.parse(record);
const fm = pf ? new RegExp(pf).exec(record) : null;
const cm = pc ? new RegExp(pc).exec(record) : null;
yes('  the fork it reads is the record\'s', !!fm && fm[1] === doc.fork);
yes('  the commit it reads is the record\'s', !!cm && cm[1].toLowerCase() === String(doc.forkCommit).toLowerCase());
yes('  and the link is the fork\'s tree at that commit', /source = f\.Groups\[1\]\.Value \+ "\/tree\/" \+ c\.Groups\[1\]\.Value/.test(runtime));

// ---- B. the game -----------------------------------------------------------------
const help = read('game', 'ui', 'thornswood-help.js');
const topic = (/\{ id: 'help', title: 'Getting help'[\s\S]*?\] *;\s*\} \}/.exec(help) || [''])[0];
yes('the help panel\'s Getting help topic names the source', topic.indexOf('thornswood.net/credits#source') >= 0 && /free software/.test(topic));
yes('  and the words never say player and have no em dash', !/player/i.test(topic) && topic.indexOf('—') < 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
