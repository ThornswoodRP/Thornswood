'use strict';
/*
  test-4449-comments-now.js

      node tests\test-4449-comments-now.js

  Issue #4449. Comments and a study that told how things were before they
  changed:
    A  the game server's allow list comment said the list lives at
       <dataDir>/allowed.json, the folder the server hands to anybody who
       connects, when the door reads it from privDir; and the glossary
       quoted that line;
    B  Secrets.cs said it wraps the server password and the update token,
       which the launcher no longer holds, and named Config.Save as a caller;
       InstallSteps.cs said config.json holds the server password; FEED.md
       said the update token is kept and sent to api.github.com;
    C  the in-game UI study said option C on #2026 was "build the Wave
       prototype first", when it was "each person picks which emotes become
       powers".

  Reads the files only. Under a second.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300) : '')); }
}

// ---- A. the allow list's folder -------------------------------------------
console.log('A. the allow list:');
for (const file of ['game/gamemode/door.ts', 'game/gamemode.js']) {
  const t = read(file);
  const line = (t.split('\n').find((l) => /The allow list lives at/.test(l)) || '');
  const m = /The allow list lives at <(\w+)>\/allowed\.json/.exec(line);
  yes(file + ' says where the allow list lives (' + line.trim() + ')', !!m);
  yes(file + ' names the folder the door reads it from, privDir, and not dataDir',
      !!m && m[1] === 'privDir' && /path\.join\(privDir, 'allowed\.json'\)/.test(t), line);
}
const glossary = read('docs/GLOSSARY.md');
const cited = /`game\\gamemode\.js:(The allow list lives at [^`]+)`/.exec(glossary);
yes('the glossary quotes a line the gamemode has (' + (cited ? cited[1] : 'none') + ')',
    !!cited && read('game/gamemode.js').indexOf(cited[1]) >= 0);
yes('and never the data folder', !/<dataDir>\/allowed\.json/.test(glossary));

// ---- B. the launcher's secrets ----------------------------------------------
console.log('\nB. the launcher\'s secrets:');
const app = path.join(ROOT, 'launcher', 'app');
const cs = fs.readdirSync(app).filter((f) => f.endsWith('.cs'));
const code = (f) => read('launcher/app/' + f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.split('//')[0]).join('\n');
const holders = cs.filter((f) => f !== 'Secrets.cs' && /Secrets\.Protect\b/.test(code(f)));
const secrets = read('launcher/app/Secrets.cs');
const summary = (/\/\/\/ <summary>([\s\S]*?)<\/summary>/.exec(secrets) || ['', ''])[1];
yes('Secrets.cs\'s summary names each file that keeps a secret with it (' + holders.join(', ') + ')',
    holders.length > 0 && holders.every((f) => summary.indexOf(f) >= 0), summary);
yes('the launcher reads no update token and no server password (' +
    cs.filter((f) => /UpdateToken|ServerPassword/.test(code(f))).join(', ') + ')',
    !cs.some((f) => /UpdateToken|ServerPassword/.test(code(f))));
yes('so Secrets.cs no longer says it wraps them',
    !/the server password, the update token/.test(secrets) && !/Config\.Save/.test(secrets));
const callers = /Both callers already catch and say it \(([^)]+)\)/.exec(secrets.replace(/\n\s*\/\/\s*/g, ' '));
yes('the callers Secrets.cs names for a refusal are methods that call it (' + (callers ? callers[1] : 'none') + ')',
    !!callers && callers[1].split(',').map((s) => s.trim()).every((c) => {
      const [file, method] = c.split('.');
      return cs.indexOf(file + '.cs') >= 0 && new RegExp('\\bvoid ' + method + '\\(').test(code(file + '.cs'));
    }));
const steps = read('launcher/app/InstallSteps.cs');
const keep = steps.slice(Math.max(0, steps.indexOf('void KeepToThisAccount') - 600), steps.indexOf('void KeepToThisAccount'));
yes('InstallSteps.cs no longer says config.json holds the server password', keep.length > 0 && !/server password/.test(keep), keep);
const feed = read('docs/FEED.md');
yes('FEED.md no longer says the update token is kept or sent',
    !/`UpdateToken` stay in/.test(feed) && !/update token, if any, goes/.test(feed));

// ---- C. the emote decision --------------------------------------------------
console.log('\nC. the emote decision:');
const study = read('docs/studies/in-game-ui/README.md');
const u6 = study.slice(study.indexOf('### U6.'), study.indexOf('### UI recommendation'));
yes('the study gives option C as it was decided: each person picks which emotes become powers',
    /each person picks which emotes become powers/.test(u6.replace(/\s+/g, ' ')) && !/build the Wave prototype first/.test(u6), u6);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
