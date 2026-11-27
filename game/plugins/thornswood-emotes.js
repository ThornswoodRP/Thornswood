// ---------------------------------------------------------------------------
// Thornswood emote wheel, game side.
//
// Why this can be a standalone plugin at all, rather than something welded into
// the SkyMP client: an arbitrary animation name triggered locally does reach
// everybody else. The whole chain takes any string.
//
//   send    AnimationSource hooks sendAnimationEvent and forwards whatever name
//           comes through, minus a short ignore list and a rename of anything
//           containing 'equip'. No whitelist.  (sync/animation.ts:258-285)
//   server  MpActor::SetLastAnimEvent stores it as-is. The only validator,
//           IsValidAnimEventName, guards the gamemode's JSON property, not the
//           relay.                                (MpActor.cpp:905-930)
//   receive applyAnimation calls Debug.sendAnimationEvent with the name it was
//           given. allowedAnims only ever gates *attack* animations on refs with
//           default anims disabled.               (sync/animation.ts:122-199)
//
// So: press the key, play the idle locally, and the client's own hook carries it
// to the server and out to the other four. Nothing here talks to the server
// directly and nothing here needs the gamemode to know it exists.
//
// Three names to avoid, from that same send path: anything containing 'equip'
// is rewritten to SkympFakeEquip, and SneakStart/SneakStop are swallowed
// outright. Every name in the table below but Sing's (see EMOTES) was read out
// of an IDLE record's ENAM field in this setup's own Skyrim.esm and
// Dragonborn.esm, and none of them trip those rules.
//
// What changed: this used to call browser.loadUrl on a page of its own. There
// is one browser, so that threw away whatever was in it, which was the chat and
// the names above heads, and it always called last so it always won. The wheel
// is an overlay inside the front now (Data/Platform/UI/thornswood-emotes.js)
// and this file no longer loads a page, sets visibility, or sets focus. The
// front owns all three; focus is borrowed by name while the wheel is up.
// ---------------------------------------------------------------------------

// ------------------------------------------------------------ whose game ----
// thornswood-front.js owns the whose-game check (issue #485): the client
// settings must point at this server and the launcher's session note must be
// fresh, or every Thornswood plugin stays idle. Front publishes the check as
// globalThis.Thornswood.whoseGame, and only when it says ours. This plugin
// runs nothing until the first tick: Skyrim Platform runs every file in
// Data/Platform/Plugins in one pass and sends that tick after the pass
// (TickImpl in the fork's skyrim-platform SkyrimPlatform.cpp), so by then
// front has published the check or did not load, whichever order the files
// came in. Nothing published means idle; so does the check saying not ours.
(function (start) {
  skyrimPlatform.once('tick', function () {
    const T = globalThis.Thornswood;
    if (!T || typeof T.whoseGame !== 'function' || !T.whoseGame()) { return; }
    start();
  });
})(function () {
'use strict';

const sp = skyrimPlatform;
const T = (globalThis.Thornswood = globalThis.Thornswood || {});

/**
 * Keys come out of Data/SKSE/Plugins/Thornswood.ini rather than living here.
 *
 * Not for the sake of a config file: it is so the Settings panel in the game
 * (game/ui/thornswood-settings.js, #3126) can show and rebind them next to
 * every other Thornswood key. It reads and writes this same file, which is
 * why it cannot drift, and a key hardcoded in here would be invisible to it.
 * Values are DirectInput scan codes, which is already what buttonEvent
 * reports, so nothing has to be translated.
 */
const INI = 'Data/SKSE/Plugins/Thornswood.ini';

function readIni(path) {
  const out = {};
  try {
    const fs = require('fs');
    const text = fs.readFileSync(path, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t[0] === ';' || t[0] === '#' || t[0] === '[') { continue; }
      const at = t.indexOf('=');
      if (at < 0) { continue; }
      out[t.slice(0, at).trim().toLowerCase()] = t.slice(at + 1).trim();
    }
  } catch (e) {
    // no file, or unreadable. the defaults below stand.
  }
  return out;
}

let ini = readIni(INI);

function key(name, fallback) {
  const raw = ini[name.toLowerCase()];
  const n = raw === undefined ? NaN : parseInt(raw, 10);
  return isNaN(n) ? fallback : n;
}

let OPEN_KEY  = key('WheelKey', 34);   // G, the template's since 13 Sep
let PAGE_KEY  = key('PageKey', 15);    // Tab, while the wheel is open
let CLOSE_KEY = key('CloseKey', 1);    // Escape
let STOP_KEY  = key('StopKey', 49);    // N
let CHAT_KEY  = key('ChatKey', 28);    // Enter, owned by the front

/*
  A key moved on the Settings panel in the game (#3126): the front writes
  Thornswood.ini and hands every plugin that reads it the new text, and the
  wheel's keys are the file's from the next press. The page is told its
  letters the next time the wheel opens (pushWheel).
*/
(T.settingsListeners = T.settingsListeners || []).push(function () {
  ini = readIni(INI);
  OPEN_KEY  = key('WheelKey', 34);
  PAGE_KEY  = key('PageKey', 15);
  CLOSE_KEY = key('CloseKey', 1);
  STOP_KEY  = key('StopKey', 49);
  CHAT_KEY  = key('ChatKey', 28);
  log('keys read again: wheel on scan code', OPEN_KEY, 'stop on', STOP_KEY);
});
const STOP = 'IdleForceDefaultState';

/*
 * One list, not categories.
 *
 * The wheel's middle is eight quick slots. Click a slot, or press 1 to 8
 * while the wheel is open. The full list sits on the right of the wheel, with
 * a search, in alphabetical order. Tab moves to that search.
 *
 * With the wheel shut, 1 to 8 are Skyrim's own favourites hotkeys (the Q
 * menu) and nothing here listens to them. Until 6 October they also played
 * a slot, so a favourite on 1 was equipped and the first slot played on the
 * same press: two actions on one key, and an equip on top of an idle is the
 * road to the weapon-drawn pin described in standUp below.
 *
 * Every event below but Sing's is an IDLE record's ENAM from Skyrim.esm or
 * Dragonborn.esm, an animation under Actors\Character\Behaviors. The name on
 * the list is ours; the string in `event` is the game's. Chop wood, Drink, Eat, Hoe and Drink
 * potion are the animation only. They do not perform the class verb.
 *
 * Lute, Flute, Drum and Sing are the bard (#1631). The server reads the last
 * animation it was sent for this character, and the instrument in the pack,
 * and counts somebody playing one of them as a bard for the people resting
 * in the same place: the needs block's BARD_PLAYS. Skyrim has no singing
 * idle (its bards sing over the lute), so Sing is the nearest the base game
 * has: IdleDialogueHappyStart, an event of its own behaviour graph
 * (0_master), the happy talking NPCs do in a conversation. It was read out of
 * the graph's event list, not out of an IDLE record. Whether it lasts until
 * you stand up, the way the lute does, is still to be seen in the game. Sit
 * is read the same way, as a seat on the ground: GROUND_SIT in the property
 * block's beds. Renaming any of their events is a change on the server too.
 *
 * Three to avoid, from skymp5-client's send path: anything containing 'equip'
 * is rewritten to SkympFakeEquip, and SneakStart and SneakStop are swallowed
 * outright. Nothing here trips those.
 */
const EMOTES = [
  { name: 'Ache', event: 'IdleBracedPain' },
  { name: 'Agitated', event: 'IdleCiceroAgitated' },
  { name: 'Applaud', event: 'IdleApplaud2' },
  { name: 'Arms crossed', event: 'IdleOffsetArmsCrossedStart' },
  { name: 'At ease', event: 'IdleHandsBehindBack' },
  { name: 'Attention', event: 'IdleSnapToAttention' },
  { name: 'Bar drink', event: 'IdleBarDrinkingStart' },
  { name: 'Blessing', event: 'IdleBlessingKneelEnter' },
  { name: 'Bow', event: 'IdleSilentBow' },
  { name: 'Cheer', event: 'IdleCivilWarCheer' },
  { name: 'Chop wood', event: 'IdleWoodChopStart' },
  { name: 'Clean blade', event: 'IdleCleanSword' },
  { name: 'Come here', event: 'IdleComeThisWay' },
  { name: 'Crouch warm', event: 'IdleWarmHandsCrouched' },
  { name: 'Dance', event: 'IdleCiceroDance1' },
  { name: 'Drink', event: 'idleDrinkingStandingStart' },
  { name: 'Drink potion', event: 'IdleDrinkPotion' },
  { name: 'Drum', event: 'IdleDrumStart' },
  { name: 'Eat', event: 'idleEatingStandingStart' },
  { name: 'Examine', event: 'IdleExamine' },
  { name: 'Flute', event: 'IdleFluteStart' },
  { name: 'Get attention', event: 'IdleGetAttention' },
  { name: 'Give', event: 'IdleGive' },
  { name: 'Grave bow', event: 'IdleBowHeadAtGrave_01' },
  { name: 'Hard clap', event: 'IdleApplaud3' },
  { name: 'Hoe', event: 'IdleHoe' },
  { name: 'Horn', event: 'IdleBlowHornStormcloak' },
  { name: 'Jig', event: 'IdleCiceroDance2' },
  { name: 'Kneel', event: 'IdleKneelingEnter' },
  { name: 'Laugh', event: 'IdleLaugh' },
  { name: 'Lean', event: 'IdleWallLeanStart' },
  { name: 'Ledger', event: 'IdleWriteLedgerEnter' },
  { name: 'Long clap', event: 'IdleApplaud5' },
  { name: 'Look far', event: 'IdleLookFar' },
  { name: 'Lute', event: 'IdleLuteStart' },
  { name: 'Nervous', event: 'IdleNervous' },
  { name: 'Oath', event: 'IdleHandCut' },
  { name: 'Ovation', event: 'IdleApplaud4' },
  { name: 'Pick up', event: 'IdlePickup_Ground' },
  { name: 'Point', event: 'IdlePointClose' },
  { name: 'Point farther', event: 'IdlePointFar_02' },
  { name: 'Point yonder', event: 'IdlePointFar_01' },
  { name: 'Pray', event: 'IdlePray' },
  { name: 'Read', event: 'IdleNoteRead' },
  { name: 'Read book', event: 'IdleBook_Reading' },
  { name: 'Reel', event: 'IdleCiceroDance3' },
  { name: 'Salute', event: 'IdleSalute' },
  { name: 'Sing', event: 'IdleDialogueHappyStart' },
  { name: 'Sit', event: 'IdleSitCrossLeggedEnter' },
  { name: 'Slow clap', event: 'IdleApplaudSarcastic' },
  { name: 'Study', event: 'IdleStudy' },
  { name: 'Surrender', event: 'IdleSurrender' },
  { name: 'Sweep', event: 'idleLooseSweepingStart' },
  { name: 'Take', event: 'IdleTake' },
  { name: 'Warm arms', event: 'IdleWarmArms' },
  { name: 'Warm close', event: 'IdleWarmHands' },
  { name: 'Warm hands', event: 'IdleWarmHandsStanding' },
  { name: 'Wave', event: 'IdleWave' },
  { name: 'Wipe brow', event: 'IdleWipeBrow' },
  { name: 'Write', event: 'IdleWriteTableStandingEnter' },
];

const SLOT_COUNT = 8;
const SLOT_FILE = 'Data/Platform/thornswood-emote-slots.json';
const DEFAULT_SLOTS = ['Wave', 'Bow', 'Laugh', 'Point', 'Pray', 'Dance', 'Lute', 'Drink'];
/* The creation room. While you are standing in it the wheel refuses to open:
 * you are picking a face and a trade, not waving. Resolved through
 * getFormFromFile so it does not depend on a load order position. */
const HALL_LOCAL_ID = 0x19BAD4;
const HALL_PLUGIN = 'Skyrim Unbound.esp';

let open = false;
let hallId = null;

function emoteByName(name) {
  const low = String(name || '').toLowerCase();
  for (let i = 0; i < EMOTES.length; i++) {
    if (EMOTES[i].name.toLowerCase() === low) { return EMOTES[i]; }
  }
  return null;
}

function readSlots() {
  const out = DEFAULT_SLOTS.slice();
  try {
    const raw = fsm ? fsm.readFileSync(SLOT_FILE, 'utf8') : '';
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed)) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        const item = emoteByName(parsed[i]);
        out[i] = item ? item.name : '';
      }
    }
  } catch (e) { }
  return out;
}

let slots = DEFAULT_SLOTS.slice();

// Not under Data/Platform/Plugins. SkyrimPlatform watches that folder and
// reloads every plugin whenever anything in it changes, so a log written there
// is a plugin reload per line.
const LOG_FILE = 'Data/Platform/thornswood-emotes.log';

let fsm = null;
try { fsm = require('fs'); fsm.writeFileSync(LOG_FILE, ''); } catch (e) { fsm = null; }
slots = readSlots();

function log() {
  const line = '[emotes] ' + Array.prototype.slice.call(arguments).join(' ');
  try { sp.printConsole(line); } catch (e) { }
  if (fsm) { try { fsm.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { fsm = null; } }
}

/**
 * The letter a scan code prints, so the page can swallow the key that opened
 * the wheel instead of typing it into whatever has focus.
 *
 * While the wheel is up it holds browser focus, and no key press reaches this
 * file as a buttonEvent. DInputHook::GetDeviceData in the fork does read the
 * keyboard and call ProcessKeyboardData whoever has focus, but that feeds
 * OnKeyStateChange in the fork's main.cpp, which returns unless the browser
 * has focus and then only injects the key into the page. buttonEvent comes
 * from the game's own input events, and with focus up the game's buffer gets
 * no key downs; since #898 it gets only the key up of a key it already held
 * (HeldKeyRelease), so nothing stays held. thornswood-front.js measured the
 * same and gives the code path, in its note on typing over wantTyping.
 *
 * So with the wheel up only the page hears a key, and the page closes it on
 * this letter, on CLOSE_KEY's letter and on Escape by sending __close
 * (#1852). The front's two-minute cap asks the same way: CAP_CLOSES names
 * thornswoodEmotes, and close() sends __close so this plugin's open follows
 * (#1918). The branches of the keys handler below that shut an open wheel on
 * OPEN_KEY or CLOSE_KEY are reached only while the wheel is drawn without
 * the keyboard. This comment used to say the opposite, that buttonEvent
 * keeps arriving the whole time the wheel is up (#1675).
 *
 * An earlier page closed the wheel on this letter too, and a log of
 * 25 September has one tap opening the wheel and shutting it again before it
 * was drawn. The client records/client-build.json names (fork a247ef27)
 * cannot do that. ProcessKeyboardData compares every keyboard snapshot with
 * the last one whoever has focus, and OnKeyStateChange hands the page a
 * change only while the browser has focus. The snapshot is read in the same
 * GetDeviceData call that hands the game the key going down (the game's
 * buffer is read first and the snapshot right after it), or in an earlier
 * call. So by the time this file hears the press and the wheel takes the
 * keyboard, the snapshot already has the key down, or missed a tap that
 * quick altogether, and the page hears at most the key coming up.
 * tests/test-1852-wheel-keys.js plays that path through.
 */
const LETTERS = {
  30: 'a', 48: 'b', 46: 'c', 32: 'd', 18: 'e', 33: 'f', 34: 'g', 35: 'h',
  23: 'i', 36: 'j', 37: 'k', 38: 'l', 50: 'm', 49: 'n', 24: 'o', 25: 'p',
  16: 'q', 19: 'r', 31: 's', 20: 't', 22: 'u', 47: 'v', 17: 'w', 45: 'x',
  21: 'y', 44: 'z'
};

/**
 * Every handler this plugin registers goes through here.
 *
 * SkyrimPlatform dispatches all plugins' handlers for an event together, so a
 * handler that throws can take the rest of that dispatch with it, and the rest
 * of that dispatch includes skymp5-client's own update loop. That loop is what
 * loads you into the world past the main menu. An unguarded throw in here is
 * not a bug in this plugin, it is the whole client failing to start.
 */
function guard(name, fn) {
  return function () {
    try { return fn.apply(null, arguments); }
    catch (e) { log(name, 'threw:', e && e.stack ? e.stack : e); return undefined; }
  };
}

/** Game.getPlayer throws at the main menu rather than returning null. */
function player() {
  try { return sp.Game.getPlayer() || null; } catch (e) { return null; }
}

function js(src) {
  if (T.js) { return T.js(src); }
  try { sp.browser.executeJavaScript(src); return true; }
  catch (e) { log('executeJavaScript failed:', e); return false; }
}

function pushWheel() {
  js('window.thornswoodSetWheel && window.thornswoodSetWheel(' +
     JSON.stringify(EMOTES) + ',' +
     JSON.stringify(slots) + ',' +
     JSON.stringify(LETTERS[OPEN_KEY] || '') + ',' +
     JSON.stringify(LETTERS[STOP_KEY] || 'n') + ',' +
     JSON.stringify(LETTERS[CLOSE_KEY] || '') + ')');
}

function saveSlots() {
  if (!fsm) { return; }
  try { fsm.writeFileSync(SLOT_FILE, JSON.stringify(slots)); } catch (e) { }
}

/* The name on the one line above the head. Not a chat line, and not
   for standing up, which never calls this. */
function sayEmote(name) {
  js('try{window.thornswoodNet&&window.thornswoodNet.post({t:"emote",name:' +
     JSON.stringify(String(name || '')) + '});}catch(e){}');
}

/*
  The instruments the wheel asks for, each as the records that count: a
  local id and the plugin it is in. The lute, flute and drum are
  PlayFluteLuteDrum.esp's weapons, which #4509 is settling. The horn is
  Skyrim's own war horn (#7167): the Horn emote blows a horn the animation
  puts in the hand, so it needs one in the pack, Nord or Imperial. The
  Woodwright makes the Nord one at the woodworking bench.
*/
const INSTRUMENT_FILE = 'PlayFluteLuteDrum.esp';
const INSTRUMENTS = {
  lute: { forms: [[0x1d9b, INSTRUMENT_FILE]], word: 'a lute' },
  flute: { forms: [[0xd62, INSTRUMENT_FILE]], word: 'a flute' },
  drum: { forms: [[0x287f, INSTRUMENT_FILE]], word: 'a drum' },
  horn: { forms: [[0x200b6, 'Skyrim.esm'], [0x200ba, 'Skyrim.esm']], word: 'a horn' }
};

function instrumentOf(name) {
  return INSTRUMENTS[String(name || '').toLowerCase()] || null;
}

function carryingInstrument(need) {
  const pc = player();
  if (!pc || !need) { return false; }
  for (const [id, file] of need.forms) {
    try {
      const form = sp.Game.getFormFromFile(id, file);
      if (form && pc.getItemCount(form) > 0) { return true; }
    } catch (e) { }
  }
  return false;
}

/* True when this name is an instrument the person does not have. */
function refuseInstrument(name) {
  const need = instrumentOf(name);
  if (!need) { return false; }
  if (carryingInstrument(need)) { return false; }
  try { sp.Debug.notification('You need ' + need.word + '.'); } catch (e) { }
  log('refused', name, 'without', need.word);
  return true;
}

function playNamed(name) {
  const item = emoteByName(name);
  if (!item) { return; }
  log('picked', item.name);
  setOpen(false);
  play(item.event, item.name);
}

function playSlot(n) {
  const item = emoteByName(slots[n - 1]);
  if (!item) { return; }
  log('slot', n, item.name);
  setOpen(false);
  play(item.event, item.name);
}

/** True while the game is showing anything of its own: a menu, or a load screen. */
function gameIsBusy() {
  try { return sp.Utility.isInMenuMode(); }
  catch (e) { return true; }   // cannot tell, so keep the wheel shut
}

function anotherPanelHasInput() {
  try { return !open && sp.browser.isFocused(); }
  catch (e) { return false; }
}

/** True while the person is still in character creation. */
function inCreationRoom() {
  try {
    if (hallId === null) {
      const form = sp.Game.getFormFromFile(HALL_LOCAL_ID, HALL_PLUGIN);
      hallId = form ? form.getFormID() : 0;
    }
    if (!hallId) { return false; }   // Unbound is not loaded, so no room to be in
    const pc = player();
    const cell = pc ? pc.getParentCell() : null;
    return !!cell && cell.getFormID() === hallId;
  } catch (e) { return false; }
}

/**
 * Show or hide the wheel.
 *
 * Nothing here touches browser visibility or focus. The front holds visibility
 * on while you are playing and off in every game menu, and the focus flag is
 * claimed by name so that the chat and the wheel cannot take it from each other
 * and neither can leave it raised by accident. That flag is the one that
 * withholds DirectInput from the game, so a plugin setting it directly is a
 * plugin that can lock somebody out of their own character.
 */
function setOpen(v) {
  if (open === v) { return; }
  open = v;
  // Logged both ways. The last run's log had two closes in it and no opens,
  // which is what finally showed the wheel was appearing and shutting itself,
  // but only because closes happened to be logged and opens were not.
  log(v ? 'opening the wheel' : 'closing the wheel');
  if (v) {
    if (T.setTyping) { T.setTyping(false); }
    pushWheel();
    if (T.claimFocus) { T.claimFocus('wheel', true); }
  } else {
    js('window.thornswoodHideWheel && window.thornswoodHideWheel()');
    if (T.claimFocus) { T.claimFocus('wheel', false); }
  }
}

/**
 * Play an idle on the local character. The client's own sendAnimationEvent hook
 * picks it up from here; there is nothing to send by hand.
 */
/*
 * Queued on purpose, never played on the spot.
 *
 * Every Papyrus native SkyrimPlatform exposes needs a live VM and stack, and it
 * only has one for the length of a game update. main.cpp's OnUpdate sets
 * g_nativeCallRequirements.vm, runs JsTick(env, true), and nulls it again;
 * CallNativeApi throws "<name> can't be called in this context" whenever that
 * pointer is null.
 *
 * A click on the wheel does not arrive inside one of those updates. The page's
 * message comes off a CEF thread and is handed over with AddTickTask, and tick
 * tasks run under JsTick(env, false), where there is no VM. So calling
 * Debug.sendAnimationEvent straight from the browserMessage handler threw every
 * single time, which is exactly what the log showed:
 *
 *   [emotes] clicked Wave
 *   [emotes] sendAnimationEvent threw on IdleWave: Error:
 *     'Debug.sendAnimationEvent' can't be called in this context
 *
 * The keyboard shortcuts failed for the same reason by a longer road: opening
 * the wheel raises browser focus, the game gets no key downs, so buttonEvent
 * goes quiet and the page handles the digits instead, sending them back down
 * the same message path. The note over LETTERS has the fork's code path.
 *
 * Parking the name here and playing it from the update handler puts the call
 * where the VM is. The wait is at most one frame.
 */
const queued = [];
/* The one idle drain() is about to send. Anything else from this list, on
   this character, is the game or a load or a door, and is dropped. */
let permit = '';
let inFlight = null;

function play(event, name) {
  if (typeof event !== 'string' || !event.length) { return; }
  // One emote at a time. Holding a key or double clicking should not stack up
  // a dozen idles to fire on consecutive frames.
  if (queued.length) { queued.length = 0; }
  queued.push({ event, name: name || '', resetDone: false });
}

/**
 * Runs inside a game update, so the natives below have a VM to run on.
 *
 * Two events, a frame apart, not one.
 *
 * The call was already succeeding. The log said 'played IdleWave' with no
 * throw and nothing happened on screen, which rules out the whole message and
 * context chain and leaves Skyrim's own behaviour graph. These idles only play
 * from the default standing state: with a weapon out or fists up, the graph is
 * in a combat state that has no transition to IdleWave, so the event arrives,
 * is refused, and nobody is told.
 *
 * Request sheathing and observe it finish before resetting the graph.
 * Sending IdleForceDefaultState during that transition can interrupt it.
 * Reset and the chosen idle then run on separate updates.
 */
function drain() {
  if (inFlight) {
    if (inFlight.accepted === undefined && Date.now() < inFlight.until) { return; }
    if (inFlight.accepted) {
      if (inFlight.name) { sayEmote(inFlight.name); }
      log('played', inFlight.event);
    } else {
      log('animation graph refused or did not acknowledge', inFlight.event);
      sp.Debug.notification('That gesture could not start.');
    }
    inFlight = null;
    permit = '';
  }
  if (!queued.length) { return; }
  if (!T.ready || (T.isTyping && T.isTyping()) || anotherPanelHasInput() ||
      gameIsBusy() || inCreationRoom()) { queued.length = 0; return; }
  const pc = player();
  if (!pc) { queued.length = 0; log('no character yet, nothing to animate'); return; }

  const request = queued.shift();
  const event = request.event;
  if (refuseInstrument(request.name)) { return; }

  if (!request.sheatheStarted) {
    try {
      // A relayed equipment event can leave the stance pinned. Stop alone
      // does not clear that pin or sheathe, so the old queue never advanced.
      sp.TESModPlatform.setWeaponDrawnMode(pc, -1);
      if (pc.isWeaponDrawn && pc.isWeaponDrawn()) {
        pc.sheatheWeapon();
      }
      request.sheatheStarted = true;
      request.sheatheDeadline = Date.now() + 5000;
      queued.unshift(request);
      return;
    } catch (e) { log('could not reset gesture stance:', e); return; }
  }

  if (pc.isWeaponDrawn && pc.isWeaponDrawn()) {
    if (Date.now() < request.sheatheDeadline) { queued.unshift(request); }
    else {
      log('sheathing did not finish, gesture cancelled');
      sp.Debug.notification('Your gear could not be stowed. Try again once it is lowered.');
    }
    return;
  }

  if (!request.resetDone) {
    try {
      sp.Debug.sendAnimationEvent(pc, STOP);
      if (event === STOP) { return; }
      request.resetDone = true;
      queued.unshift(request);
    } catch (e) { log('could not reset gesture stance:', e); }
    return;
  }

  try {
    permit = event === STOP ? '' : event;
    inFlight = request;
    request.until = Date.now() + 2000;
    // The native dispatch runs after this JS update. Keep the permit until
    // the hook acknowledges that particular queued request.
    sp.Debug.sendAnimationEvent(pc, event);
  } catch (e) {
    inFlight = null;
    permit = '';
    log('sendAnimationEvent threw on', event + ':', e);
  }
}

/*
  A load and a door both play the last idle again, and the behaviour graph
  will start a lute or a mug on its own. Those are the wheel's idles. On this
  character they are kept only for the one drain() just asked for.

  A potion, a meal, a chop and a hoe use the same names as four of the wheel's
  rows, and the game sends those for the real action, so they are left alone.
*/
const emoteEvent = {};
for (let i = 0; i < EMOTES.length; i++) {
  emoteEvent[EMOTES[i].event.toLowerCase()] = true;
}
const gameplayEvent = {
  idledrinkpotion: true,
  idleeatingstandingstart: true,
  idlewoodchopstart: true,
  idlehoe: true
};
try {
  sp.hooks.sendAnimationEvent.add({
    enter: (ctx) => {
      try {
        if (ctx.selfId !== 0x14) { return; }
        const low = String(ctx.animEventName || '').toLowerCase();
        if (permit && inFlight && permit.toLowerCase() === low) {
          ctx.storage.set('thornswoodEmoteRequest', inFlight);
          return;
        }
        if (!emoteEvent[low] || gameplayEvent[low]) { return; }
        ctx.animEventName = '';
      } catch (e) { }
    },
    leave: (ctx) => {
      if (ctx.selfId === 0x14 && inFlight &&
          ctx.storage.get('thornswoodEmoteRequest') === inFlight) {
        inFlight.accepted = !!ctx.animationSucceeded;
        permit = '';
      }
    }
  });
} catch (e) {
  log('could not watch emote idles:', e);
}

// The front closes the wheel for us in a menu, but only for focus. The overlay
// itself has to be told, or it stays drawn over the inventory.
sp.on('update', guard('hold', () => {
  drain();
  if (open && gameIsBusy()) { setOpen(false); }
}));

sp.on('browserMessage', guard('browserMessage', (event) => {
  const a = event.arguments;
  if (!a || a[0] !== 'thornswood-emote') { return; }
  const what = a[1];
  if (typeof what !== 'string') { return; }

  if (what === '__ready') { log('overlay is up'); return; }
  if (what === '__close') { log('the page asked to close'); setOpen(false); return; }
  if (what === '__back') { setOpen(false); return; }
  if (!open) { return; }

  // The middle stands you up. It does not change which list is showing.
  if (what === '__hub' || what === '__stand') {
    setOpen(false);
    standUp();
    return;
  }

  if (what.indexOf('__assign ') === 0) {
    const rest = what.slice(9);
    const sp2 = rest.indexOf(' ');
    const n = parseInt(sp2 === -1 ? rest : rest.slice(0, sp2), 10);
    const name = sp2 === -1 ? '' : rest.slice(sp2 + 1);
    const item = emoteByName(name);
    if (!item || !(n >= 1 && n <= SLOT_COUNT)) { return; }
    slots[n - 1] = item.name;
    saveSlots();
    log('assigned', n, item.name);
    return;
  }

  if (what.indexOf('__slot ') === 0) {
    const n = parseInt(what.slice(7), 10);
    if (n >= 1 && n <= SLOT_COUNT) { playSlot(n); }
    return;
  }

  if (what.indexOf('__play ') === 0) {
    playNamed(what.slice(7));
    return;
  }

  // A click from the older page, which sent an index and a name.
  if (what.indexOf('__pick ') === 0) {
    const rest = what.slice(7);
    const sp2 = rest.indexOf(' ');
    const name = sp2 === -1 ? '' : rest.slice(sp2 + 1);
    if (name) { playNamed(name); }
  }
}));

sp.on('buttonEvent', guard('keys', (e) => {
  if (e.device !== 0 || !e.isDown || e.isUp || e.isRepeating || e.isHeld) { return; }
  if (!T.ready) { return; }
  // While somebody is typing, every key belongs to the chat box.
  if (T.isTyping && T.isTyping()) { return; }
  if (anotherPanelHasInput()) { return; }
  if (e.code === CHAT_KEY && !open) { return; }
  if (!open && gameIsBusy()) { return; }

  if (e.code === OPEN_KEY) {
    // Open here means drawn without the keyboard: see the note over LETTERS.
    if (open) { setOpen(false); return; }
    if (gameIsBusy()) { return; }
    if (inCreationRoom()) {
      log('still in character creation, the wheel stays shut');
      return;
    }
    setOpen(true);
    return;
  }
  // 1 to 8 with the wheel shut belong to the game: they are Skyrim's
  // favourites hotkeys, and playing a slot on them as well equipped the
  // favourite and played the emote on one press. While the wheel is open the
  // page holds the keyboard and hears 1 to 8 itself (it sends __slot), and
  // the game hears none of them.
  if (!open) { return; }
  if (e.code === CLOSE_KEY) { setOpen(false); return; }
}));

// A way out of an idle that has no natural end. Works whether or not the wheel
// is open, because the usual reason you want it is that you are stuck in one.
// With the wheel open the page sends __stand, so a letter typed into the
// search is not also a stand-up. With the wheel shut this key is the way.
function standUp() {
  play(STOP);
  /*
   * The same key also takes off a stuck weapon-drawn pin, because the two
   * problems feel identical from the chair: you are locked into something
   * and want out.
   *
   * skymp5-client turns any animation event with "equip" in its name into
   * SkympFakeEquip, and whoever receives that calls
   * TESModPlatform.setWeaponDrawnMode(actor, 1). That value is stored and
   * never expires, and while it is 1 a Frida hook rewrites every sheathe
   * into a draw, so the hands cannot go down again by any means the game
   * offers. Putting clothes on is enough to trigger it.
   *
   * -1 is WEAP_DRAWN_MODE_DEFAULT, which means stop overriding rather than
   * sheathe, so the sheathe below is what actually lowers the hands.
   */
  // drain clears the pin and sheaths inside an update, where natives can run.
}

sp.on('buttonEvent', guard('stopKey', (e) => {
  if (e.device === 0 && e.isDown && !e.isUp && !e.isRepeating && !e.isHeld &&
      e.code === STOP_KEY && !open) { standUp(); }
}));

log('plugin loaded,', EMOTES.length, 'emotes,', SLOT_COUNT, 'quick slots -',
    'wheel on scan code', OPEN_KEY, '(' + (LETTERS[OPEN_KEY] || '?') + ')',
    'stop on', STOP_KEY);

});
