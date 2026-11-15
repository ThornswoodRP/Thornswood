// test-2262-equip-attempt-setting.js
//
// Both servers ask the gamemode before an item goes on (#2262).
//
// The fork's onEquipItemAttempt (skymp#73, at thornswood/engine-changes
// b109bbac) asks the gamemode about each item an equipment update puts on
// that the saved record does not already have on, before the update is
// stored, and takes off only an item it answers false to. It is off unless
// server-settings.json says equipItemAttemptEnabled: true, so the strength
// gate (#2262) is never asked on a server that does not say so. This checks
// that both deploys say true, that dev rewrites a file that does not, and
// that the swap's key lists carry the key. With the fork checked out (the
// nightly fetches it at the pin and sets THORNSWOOD_FORK_REQUIRED=1) it also
// checks the pinned engine reads the key and fires the event before storing.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8').split(CR).join(''); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* Every value a script gives equipItemAttemptEnabled, as written. */
function given(text) {
  const out = [];
  const re = /-NotePropertyName equipItemAttemptEnabled -NotePropertyValue (\S+) -Force/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

// ---- live: Deploy-Gamemode writes the server's settings ----------------------
{
  const live = read('scripts/deploy/Deploy-Gamemode.ps1');
  const g = given(live);
  yes('L1 Deploy-Gamemode gives equipItemAttemptEnabled once, and it is $true',
      g.length === 1 && g[0] === '$true');
  yes('L2 the reason is written beside it', /#2262/.test(live) && /onEquipItemAttempt/.test(live));
}

// ---- dev: Deploy-DevGamemode edits the staged copy -----------------------------
{
  const dev = read('scripts/deploy/Deploy-DevGamemode.ps1').split('`$').join('$');
  const g = given(dev);
  yes('D1 Deploy-DevGamemode gives equipItemAttemptEnabled once, and it is $true, as live',
      g.length === 1 && g[0] === '$true');
  yes('D2 and a file without it, or with it not true, is rewritten even when nothing else moved',
      /-notcontains 'equipItemAttemptEnabled' -or \$s\.equipItemAttemptEnabled -ne \$true\) \{ \$wantEquip = \$true \}/.test(dev));
  const keys = /\$DevSettingsKeys = @\(([\s\S]*?)\)/.exec(dev);
  yes('D3 and hands the key to the swap\'s read-back ($DevSettingsKeys)',
      !!keys && /'equipItemAttemptEnabled'/.test(keys[1]));
}

// ---- the keys a release carries ------------------------------------------------
{
  const ss = read('scripts/deploy/ServerSettings.ps1');
  const keys = /\$ThornswoodGamemodeKeys = @\(([\s\S]*?)\)\)/.exec(ss);
  yes('K1 ServerSettings.ps1 counts equipItemAttemptEnabled among the gamemode\'s keys',
      !!keys && /'equipItemAttemptEnabled'/.test(keys[1]));
}

// ---- the pinned engine reads it ------------------------------------------------
{
  const lib = path.join(REPO, 'engine', 'skymp', 'skymp5-server', 'cpp');
  if (!fs.existsSync(lib)) {
    if (process.env.THORNSWOOD_FORK_REQUIRED === '1') {
      yes('E0 engine/skymp is checked out (THORNSWOOD_FORK_REQUIRED is set)', false);
    } else {
      console.log('SKIP  engine/skymp is not checked out here; the nightly fetches it at the pin and runs E1 and E2');
    }
  } else {
    const server = fs.readFileSync(path.join(lib, 'addon', 'ScampServer.cpp'), 'utf8');
    yes('E1 the pinned engine reads equipItemAttemptEnabled from the server settings',
        /"equipItemAttemptEnabled"/.test(server) && /worldState\.equipItemAttemptEnabled\s*=/.test(server));
    const al = fs.readFileSync(path.join(lib, 'server_guest_lib', 'ActionListener.cpp'), 'utf8');
    const at = al.indexOf('void ActionListener::OnUpdateEquipment(');
    const body = at < 0 ? '' : al.slice(at, al.indexOf('\n}\n', at));
    yes('E2 and fires EquipItemAttemptEvent in OnUpdateEquipment, only when it is on',
        /equipItemAttemptEnabled/.test(body) && /EquipItemAttemptEvent/.test(body) &&
        body.indexOf('equipItemAttemptEnabled') < body.indexOf('EquipItemAttemptEvent'));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
