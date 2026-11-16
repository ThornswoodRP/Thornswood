// test-own-press.js
//
// Only the person's own press is a press.
//
// Patrick, 21 September, from playing it: "Theres a weird thing when yoiu walk
// my quarries an npc will spawn and force you to start mining when one you
// didnt click on it and two you have no pickaxe and arent a miner".
//
// MEASURED IN HIS OWN TWO CLIPS, frames pulled at one every ten seconds:
// he walks past the Whiterun farms and the quarry with nothing under the
// crosshair, and the chat fills up on its own:
//
//   Thornswood: Only a miner can work a seam. Ask one.     x4
//   Thornswood: Only a farmer can bring a crop in. Ask one. x3
//
// and at the end of the second clip an NPC is standing over him while he is
// down in the mining pose.
//
// WHY. sp.on('activate') fires for EVERY activation in the loaded area, by
// anybody. The comment on the log line inside the handler already said so:
// "every door an NPC opens and every crate anybody walks past". Whiterun's
// own miners and farmhands work their seams and their crops all day. The
// handler had no idea whose press it was holding, so the ACTI branch at the
// bottom re-activated the thing AS THE PERSON, with pc out of
// Game.getPlayer(). That ran the vanilla mine script on him, which is the
// animation and the marker he read as an NPC spawning, and the client
// forwarded the same activation to the server, which is where the seven
// refusals came from: the server was answering presses he never made.
//
// caster is the actionRef out of TESActivateEvent, set beside target in
// EventHandler.cpp in the fork. 0x14 is the person's own reference.
//
// This lifts the shipped handler out of thornswood-front.js and drives it.
// Nothing that decides anything is stubbed: the handler is the real text.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT ||
            path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const OPEN = "  sp.on('activate', guard('activate', (e) => {";
const SHUT = '\n  }));\n';
const a = src.indexOf(OPEN);
const b = a < 0 ? -1 : src.indexOf(SHUT, a);
const body = (a >= 0 && b >= 0) ? src.slice(a, b + SHUT.length) : null;

yes('the activate handler is in the plugin', body !== null);

/*
  One handler, with a pretend game under it.

  sp.Game.getPlayer returns the reference the re-activation is made with, and
  ran[] is every re-activation the handler asked for. said[] is every line it
  put on the screen. Both are how a press is told from an echo here.
*/
function rig() {
  const ran = [], said = [], serverBases = {};
  const clock = { now: 5000000 };
  const pc = { id: 0x14 };
  const fn = new Function(
    'sp', 'guard', 'say', 'serverBases', 'lastForced', 'lastLogged',
    'Date', 'Math', 'ran',
    'let reActivating = false;\n' +
    body +
    '\nreturn {};');

  let handler = null;
  const sp = {
    on: function (what, f) { if (what === 'activate') { handler = f; } },
    Game: { getPlayer: function () { return pc; } },
    Utility: { wait: function () { return { then: function () { } }; } },
    ObjectReference: { from: function () { return null; } }
  };
  const api = fn(
    sp,
    function (name, f) { return f; },
    function (line) { said.push(line); },
    serverBases, {}, {},
    { now: function () { return clock.now; } },
    Math, ran);
  // The handler is registered by the lifted line itself, so it is picked up
  // from the pretend sp rather than passed in.
  api.fire = handler;
  api.ran = ran; api.said = said; api.bases = serverBases; api.clock = clock;
  return api;
}

/** A pressable thing: 24 is kActivator, 29 is a door. */
function ref(id, baseId, type, name) {
  const self = {
    getFormID: function () { return id; },
    getBaseObject: function () {
      return { getFormID: function () { return baseId; },
               getType: function () { return type; },
               getName: function () { return name || ''; } };
    },
    isActivationBlocked: function () { return false; },
    getOpenState: function () { return 3; },
    activate: function (who) { self.activatedBy = who; }
  };
  return self;
}

if (body !== null) {
  const VEIN = 0x5c000, VEIN_BASE = 0xe4e0;

  // S1: THE WHOLE POINT. A farmhand's swing is not the person's press.
  {
    const r = rig();
    const seam = ref(VEIN, VEIN_BASE, 24, 'Iron Ore Vein');
    r.fire({ target: seam, caster: { getFormID: function () { return 0xff00002a; } } });
    yes('S1 an NPC working a seam is not re-activated as the person',
        seam.activatedBy === undefined);
    yes('S1 and nothing is put on the screen for it', r.said.length === 0);
  }

  // S2: the game activating something while a cell loads carries no actionRef.
  {
    const r = rig();
    const seam = ref(VEIN, VEIN_BASE, 24, 'Iron Ore Vein');
    r.fire({ target: seam, caster: null });
    yes('S2 an activation with no actor behind it is dropped',
        seam.activatedBy === undefined);
  }

  // S3: and the person's own press still works exactly as it did.
  {
    const r = rig();
    const lever = ref(0x7001, 0x7002, 24, 'a handle');
    r.fire({ target: lever, caster: { getFormID: function () { return 0x14; } } });
    yes('S3 the person\'s own press on a handle still runs its script',
        lever.activatedBy !== undefined);
  }

  // S4: a base the server answers for is still left alone, as before.
  {
    const r = rig();
    r.bases[VEIN_BASE] = true;
    const seam = ref(VEIN, VEIN_BASE, 24, 'Iron Ore Vein');
    r.fire({ target: seam, caster: { getFormID: function () { return 0x14; } } });
    yes('S4 a seam the server answers for is not pressed twice',
        seam.activatedBy === undefined);
  }

  // S5: a body is an NPC_ and was never re-activated; that has not changed.
  {
    const r = rig();
    const deer = ref(0x8001, 0x8002, 43, 'Deer');
    r.fire({ target: deer, caster: { getFormID: function () { return 0x14; } } });
    yes('S5 a body is still left to the server', deer.activatedBy === undefined);
  }

  // S6: a second NPC swing on the same seam is dropped too. The old handler
  //     had a two second gate per target, which would have hidden how often
  //     this happened without stopping any of it.
  {
    const r = rig();
    const seam = ref(VEIN, VEIN_BASE, 24, 'Iron Ore Vein');
    const npc = { getFormID: function () { return 0xff00002a; } };
    for (let i = 0; i < 5; i++) { r.clock.now += 3000; r.fire({ target: seam, caster: npc }); }
    yes('S6 five NPC swings over fifteen seconds are still five nothings',
        seam.activatedBy === undefined && r.said.length === 0);
  }
}

// ---------------------------------------------------------------- structure
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('the handler asks whose press it is',
      /casterId !== 0x14/.test(code));
  // lastActivateAt went with the stuck rescue, its only reader (#2620).
  yes('and keeps no last-activation time for a rescue that is gone',
      code.indexOf('lastActivateAt') < 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
