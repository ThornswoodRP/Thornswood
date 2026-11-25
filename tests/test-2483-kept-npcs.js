// test-2483-kept-npcs.js
//
//     node tests/test-2483-kept-npcs.js
//
// #2483: a kept NPC stood twice for a moment. Each game spawned the server's
// copy with placeAtMe and left the plugin's placed copy standing until the
// world cleaner picked it at random. The fix is in the fork
// (engine/skymp/skymp5-client/src/view/formView.ts): the view takes the placed
// reference (refrId - 0x100000000) instead of spawning a second one.
//
// This runs the fork's own harness, skymp5-client/test-kept-npc-adopt.js,
// against the pinned engine/skymp. It needs the submodule checked out
// (git submodule update --init engine/skymp). Without it this says SKIP,
// which is the pull request gate and the nightly's harness shares; the
// nightly's fork step fetches it and runs this with THORNSWOOD_FORK_REQUIRED.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const client = path.join(__dirname, '..', 'engine', 'skymp', 'skymp5-client');
const harness = path.join(client, 'test-kept-npc-adopt.js');
if (!fs.existsSync(client)) {
  // The gate and the nightly's harness shares have no fork. The nightly's
  // fork step fetches it at the pin and sets THORNSWOOD_FORK_REQUIRED=1, as
  // for test-papyrus-event-list.js: there a missing fork is a failure,
  // because a check that did not happen is not a pass.
  if (process.env.THORNSWOOD_FORK_REQUIRED === '1') {
    console.log('FAIL  engine/skymp is not checked out (THORNSWOOD_FORK_REQUIRED is set, so not having it is a failure)');
    process.exitCode = 1;
    return;
  }
  console.log('SKIP  engine/skymp is not checked out here; the nightly fetches it at the pin and runs this');
  return;
}
if (!fs.existsSync(harness)) {
  console.log('FAIL  engine/skymp is checked out but its pin is older than the #2483 fix: ' + harness);
  process.exitCode = 1;
  return;
}
const r = spawnSync(process.execPath, [harness], { stdio: 'inherit' });
process.exitCode = r.status === null ? 1 : r.status;