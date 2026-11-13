// test-3078-containers-empty.js
//
// A container starts empty: nothing from its plugin record, on either server.
//
// Patrick, 21 October 2026: "not fill them with anything vannilla onky our
// speacil ones for the caves with our items abd refill times, and dont fill
// any storages that shouldnt be filled".
//
// The engine copied a container's plugin contents in on the first press
// (MpObjectReference::EnsureBaseContainerAdded), after the gamemode's hook,
// and the gamemode took part of it back out on a timer. The fork now reads
// forbiddenBaseContainer from server-settings.json and puts none of a named
// base type's record in (skymp#96). This checks that both servers are given
// CONT, and nothing else, and that the swap's key lists carry the key. With
// the fork checked out (the nightly fetches it at the pin and sets
// THORNSWOOD_FORK_REQUIRED=1) it also checks the pinned engine reads it.
// game\tests\test-spoils.js checks the gamemode no longer touches a container.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8').split(CR).join(''); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* Every value a script gives forbiddenBaseContainer, as the list of types. */
function given(text) {
  const out = [];
  const re = /-NotePropertyName forbiddenBaseContainer -NotePropertyValue @\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(text))) {
    out.push(m[1].split(',').map(function (t) { return t.trim().replace(/^'|'$/g, ''); }).filter(Boolean));
  }
  return out;
}

// ---- live: Deploy-Gamemode writes the server's settings ----------------------
{
  const live = read('scripts/deploy/Deploy-Gamemode.ps1');
  const g = given(live);
  yes('L1 Deploy-Gamemode gives forbiddenBaseContainer once', g.length === 1);
  yes('L2 and it is CONT and nothing else, so NPCs keep what they carry',
      g.length === 1 && g[0].length === 1 && g[0][0] === 'CONT');
  yes('L3 the reason is written beside it', /#3078/.test(live) && /EnsureBaseContainerAdded/.test(live));
}

// ---- dev: Deploy-DevGamemode edits the staged copy -----------------------------
{
  const dev = read('scripts/deploy/Deploy-DevGamemode.ps1');
  const g = given(dev.split('`$').join('$'));
  yes('D1 Deploy-DevGamemode gives forbiddenBaseContainer once', g.length === 1);
  yes('D2 and dev carries the same CONT as live', g.length === 1 && g[0].join() === 'CONT');
  const keys = /\$DevSettingsKeys = @\(([\s\S]*?)\)/.exec(dev);
  yes('D3 and hands the key to the swap\'s read-back ($DevSettingsKeys)',
      !!keys && /'forbiddenBaseContainer'/.test(keys[1]));
}

// ---- the keys a release carries ------------------------------------------------
{
  const ss = read('scripts/deploy/ServerSettings.ps1');
  const keys = /\$ThornswoodGamemodeKeys = @\(([\s\S]*?)\)\)/.exec(ss);
  yes('K1 ServerSettings.ps1 counts forbiddenBaseContainer among the gamemode\'s keys',
      !!keys && /'forbiddenBaseContainer'/.test(keys[1]));
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
    const ref = fs.readFileSync(path.join(lib, 'server_guest_lib', 'MpObjectReference.cpp'), 'utf8');
    const at = ref.indexOf('void MpObjectReference::EnsureBaseContainerAdded(');
    const body = at < 0 ? '' : ref.slice(at, ref.indexOf('\n}\n', at));
    yes('E1 the pinned engine skips a forbidden base type before it reads the record',
        /IsBaseContainerForbidden\(baseType\)/.test(body) &&
        body.indexOf('IsBaseContainerForbidden') < body.indexOf('GetInventoryObjects'));
    const server = fs.readFileSync(path.join(lib, 'addon', 'ScampServer.cpp'), 'utf8');
    yes('E2 and reads forbiddenBaseContainer from the server settings',
        /"forbiddenBaseContainer"/.test(server) && /SetForbiddenBaseContainerTypes/.test(server));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
