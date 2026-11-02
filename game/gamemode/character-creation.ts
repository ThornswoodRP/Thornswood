// ---------------------------------------------------------------------------
// character creation
//
// SkyMP has no connect event for the gamemode, and callPapyrusFunction runs on
// the server's own VM: Debug.Notification and Message.Show both resolve their
// target actor from the Papyrus stack, which is empty when the call comes from
// here. So there is no reliable way to put words on somebody's screen from this
// file, and a menu that asks a question and waits for the answer is out of the
// question entirely.
//
// What does work, on mechanisms already proven in this build: the inventory can
// be set from the server. The books were the interface once, and then the
// launcher was, and since 20 September the choice is made in the game, on K,
// in the panel the character block owns. This block runs the hall: the face,
// the wait, the reminder, and the trip to the town when the choices are in.
//
// The state machine is driven by a timer rather than an event, because there is
// no event. It is cheap: a property read per online person every few seconds.
// ---------------------------------------------------------------------------

/**
 * On, because Skyrim Unbound cannot do this job under SkyMP.
 *
 * Unbound ships the room, the appearance menu, the trade list and the location
 * list, and all of it works in single player. It does not survive here: the
 * client calls loadGame() when the server sends CreateActor, which reloads the
 * whole session from a synthetic save, and Unbound's start quest goes with it.
 * The room and the appearance menu run before that reload and so they work. The
 * two menus run after it and so they never appear.
 *
 * Nothing below depends on a quest surviving anything. The writs and passages
 * are inventory items, and the client plugin's message boxes sit on top of them
 * rather than replacing them.
 *
 * Set "thornswoodChargen": false in server-settings.json to switch it off.
 */
function chargenWanted() {
  try {
    const s = mp.getServerSettings();
    if (s && s.thornswoodChargen === false) {
      return false;
    }
  } catch (e) {
    // no settings object. on is the right default.
  }
  return true;
}

const CHARGEN_ENABLED = chargenWanted();

const CHARGEN_PROPERTY = 'thornswoodChargen';
/*
 * Three seconds was costing far more than three seconds.
 *
 * Creation walks a state machine one step per tick, and with the appearance
 * never arriving the path out of the hall is five of them: the state is made,
 * the face is marked, a position baseline is taken, movement is noticed against
 * that baseline, and then the wait below runs out. At three seconds a step that
 * is twelve seconds of pure tick overhead on top of every real wait.
 *
 * The work in a tick is a couple of property reads for at most five people, so
 * the rate was never about cost.
 *
 * IT IS HALF A SECOND, not the one second this comment asked for until 23
 * September. It went to 500 and the sentence naming a number was left behind,
 * which matters more here than it looks: the wait below is written in
 * milliseconds and reasoned about in ticks, so a comment claiming a one second
 * tick makes every one of those sums come out at twice the truth.
 */
const CHARGEN_TICK_MS = 500;

/**
 * How long to leave a client completely alone after it turns up online.
 *
 * A joining client is mid save-load: SkyrimPlatform writes a TESMODPLATFORM
 * save, loads it, and the game rebuilds the player's facegen from the TESNPC
 * record on the way through. Anything the server does to that actor lands in
 * the middle of it. SkyMP's own SpSnippetService already treats this as
 * dangerous, wrapping ShowRaceMenu in a one second delay and switching off form
 * view updates around it.
 */
const SETTLE_MS = 10000;

/* How long to wait for an appearance before opening the race menu, and how long
 * before giving up on it entirely and moving on. Both measured from the moment
 * the creation stage opened, not from the nudge. */

/* Two minutes. Used as the gap between race-menu asks when the open
 * request was lost: no stored face, and the plugin has not reported
 * the menu as up. A one-shot flag left them in the hall forever if
 * that second request was also lost (Djinn, 5 Oct 2026). Asking
 * while /racemenu is already reported is an access violation. */
const NUDGE_MS = 120000;

/* How long somebody has to be walking about before a STORED face lets
 * creation move on. Walking without a stored appearance does not publish
 * them. See hasStoredAppearance.
 *
 * Was eight seconds. Since the appearance stopped arriving this is not a
 * fallback any more, it is the only way anybody leaves the hall, so every
 * second of it is a second spent standing in an empty room waiting for nothing.
 * Four: still far more movement than a stray camera nudge produces, and it
 * comes off the end of a wait that already has the settle in front of it.
 *
 * Down again to two. The settle in front of it is measured from when somebody
 * comes online, not from when creation ends, and creation takes far longer
 * than the settle does, so by the time this matters the settle is long spent
 * and this wait is the entire delay anybody actually feels. At a one second
 * tick, two seconds is still two separate confirmations that a person is on
 * their feet rather than nudging a camera.
 *
 * And down again to one, which at CHARGEN_TICK_MS is 500 ms and one tick.
 *
 * 3 Oct 2026: this wait is no longer a way out of the hall without a face.
 * A stored appearance is required. Walking with no face asks for the race
 * menu again instead of publishing an empty actor. */
const MOVED_ENOUGH_MS = 500;

/* How far counts as having moved, between two consecutive samples.
 *
 * The test used to be any difference at all between two pose samples, with no
 * minimum, so the first report after the baseline counted: the ground snap
 * that lands somebody on the floor of the hall, and the angle normalisation
 * that follows a teleport, both move the numbers by a hair without anybody
 * touching anything. That read as "on their feet" while the race menu was
 * still up, and the teleport could fire under it.
 *
 * 32 units is about half a pace, and well under what a person turning on the
 * spot with the mouse produces. 10 degrees is a glance. */
const MOVED_UNITS = 32;
const MOVED_DEGREES = 10;
/* How often somebody standing in the hall with the panel still to fill in is
 * reminded, in chat, that K opens it. The panel opens itself the moment
 * creation begins; this is for the person who closed it, or whose page had
 * not mounted it yet when the server first asked. */
const CHOOSE_REMIND_MS = 30000;
/*
  How long the reminder holds off once somebody has CLOSED the panel on
  purpose.

  Djinn, 21 September, in "Beack out option": "There is no way to leave the
  character creation screen except to make a character then log out. this
  needs a resolution." He is right, and the reason is this constant. Escape
  and K have always shut the panel; thirty seconds later the reminder above
  pushed it straight back, so closing it did nothing and the only real exit
  was finishing a character you did not want and quitting.

  THE REMINDER IS NOT THE PROBLEM AND IT STAYS. It exists for the person
  whose panel never arrived, who has nothing on screen and no way on: see
  openCreation's fallback sentence. That case is real and it is why this is a
  BACK OFF rather than an off switch.

  What was missing is the difference between a panel that failed to arrive
  and one somebody read and shut. The first needs pushing again; the second
  is a person saying not now, and pushing it back at them is the whole
  complaint. So a deliberate close says so, and the reminder waits ten
  minutes instead of thirty seconds. K still opens it the moment they want
  it, and nothing about their character has been decided either way.
*/
const CHOOSE_LATER_MS = 600000;
/* Five minutes, not forty five seconds. This used to move them on without a
 * face. That published an empty actor (3 Oct 2026, profile 598737699). It
 * now asks for the race menu again and stays unpublished until a face is
 * stored. Being stuck is still the thing worth guarding against; publishing
 * nobody is not the rescue. */
const GIVEUP_MS = 300000;

/*
  AND IT WAITS WHILE THE RACE MENU IS REPORTED UP, for up to half an hour.

  Djinn, 22 September, in "Timed out": "Sitting in the selector window, it
  automatically timed me out to name choice without any input commands, then
  once I named the character it then brought back up the selector and is stuck
  there since the cursor icon F6 button does not show/initiate the cursor to
  choose anything and is now stuck on this window and have to task out exit."

  His session is in the live log: profile 61415365 went to appearance at
  19:50:42, and at 19:55:43, to the second, "appearance never arrived after
  300s, going on to the choices anyway". The same line fired twice more that
  day, 22:15:14 on live and 01:11:15 on dev, each at exactly 300 seconds. Five
  minutes was measured against a race menu that never opened, and the server
  had no way to tell that from one somebody is still using, so it fired on
  people making a face. What it does then is worse than moving them on. The
  client cannot close a race menu (remoteServer.ts in the fork: "TODO:
  Implement closeMenu in SkyrimPlatform"), so the race menu stays on screen
  and the K panel is pushed on top of it. And where there is a face on file,
  closeRaceMenu tells the server the menu is shut, so the face they finish
  afterwards arrives at a server that throws it away, as closeRaceMenu below
  explains. On 22 September that close went out whatever was on file: the
  check for a face went in at 01:12 the next morning (a06abe3).

  So the plugin says when the race menu is up (/racemenu, once when it opens
  and once a minute while it stays open), and while that is fresh the give up
  holds off. Sitting still reading a slider moves nobody on.

  FACE_SEEN_MS is how fresh a report used to have to be before the give up
  treated the menu as gone. That freshness window is not a close: a quiet
  stream after /racemenu was seen is a still-open menu. /face done is the
  close for Escape, Cancel and Done. /racedown is the close when the game
  is quitting (F10, the quit paths) and a half-made face is not done. A
  client that never reports at all, because its plugin is older or the race
  menu never opened, is the lost request and still gets the asks.

  FACE_CAP_MS is for a race menu that is up and wedged: after half an hour of
  it being reported, the give up goes on anyway, because the panel and a home
  are then the only way out of the hall the server has.
*/
const FACE_SEEN_MS = 150000;
const FACE_CAP_MS = 1800000;

/*
  WHO IS IN THE WORLD, AND SINCE WHEN: actorId -> the time the chargen tick
  first saw them online this session. Its first sight is the login, and the
  per-session hook rides on it (chargenTick).

  ON globalThis, SO A HOT RELOAD IS NOT A LOGIN (#3154). A reload runs this
  file again in a fresh module (requireTemp in the fork's gamemodeLoad.ts),
  and while this was a const of the module every reload emptied it. So every
  gamemode deploy logged in again everybody on: the login hook ran for each
  of them (their profession said again, the known spells and the K panel
  sent again), and somebody in the hall read as a reconnect, which starts
  the creation wait over. Measured by tests\test-3154-login-restore.js, which
  runs the whole file and reloads it under a character in the world. The
  needs block already keeps who has arrived on globalThis for the same
  reason. A restart is a new process, so everybody is new again, which is
  right: they all log in again.
*/
if (!(globalThis.__thornswoodFirstSeen instanceof Map)) { globalThis.__thornswoodFirstSeen = new Map(); }
const firstSeen = globalThis.__thornswoodFirstSeen;

/* Skyrim Unbound's own character generation room, which is where a new game
 * already puts everybody, and the marker it stands them on. Falling back to the
 * configured start point is deliberate: if Unbound is ever removed from the load
 * order the flow should still run, just in a less tidy place. */
const HALL = {
  desc: '19bad4:Skyrim Unbound.esp',
  pos: [3755.7, -495.7, -207.7],
  rot: [0, 0, 180],
};

/*
  WHERE A NEW ARRIVAL STANDS IN EACH INN, AND WHERE THE NUMBERS CAME FROM.

  Eight of the nine arrival points below were first written by hand, and all
  eight are the same sum: the inn's front door, moved 110 units along the
  door's own heading, at the door's height and with its facing. Nobody stood
  on any of them. Whether that lands in the room depends on which way the
  door's model happens to face, and for seven of the eight it did not: it
  put the point along the wall beside the door, past the door's edge, or
  110 units behind the door, outside the room.

  1.1.41 replaced five by walking to them (Whiterun, Riften, Windhelm, Morthal
  and Winterhold). Riften's hand point was the one that had been in the room,
  and the walk kept it. Three were still the sum until 24 September:

    Solitude   -178, -1504, 128    on the line of the wall the door is set
                                   in, 54 units past the door's edge, at the
                                   height of the door's middle: in the wall
    Falkreath  673.1, -620.3, 0    110 units behind the front door
    Dawnstar   1824.3, -683.7, 0   110 units behind the front door

  Those three are now the point the game itself puts anybody on who walks in
  through that front door: the teleport carried by the outside half of the
  door (its XTEL), read out of the load order, with the facing it gives,
  which is into the room. Skyrim Unbound's own start marker in each of those
  inns is within 7, 9 and 20 units of them. No number here was made up, and a
  walk can still pick a better spot than the doorway: stand there, press the
  mark key, run Mark-Spot.ps1.

  Markarth is not the sum. It stands 386 units into the room, on the floor,
  and nothing in the records says it is wrong, so it is left as it was.

  tools/test-arrivals.js holds the nine front doors and the game's own point
  for each, and fails when an arrival is not on the room side of its door or
  not on the floor the door opens onto. On a machine with the game folder it
  reads them again from the plugins.

  Interior coordinates belong to their own cell, so two towns' points being
  close means nothing. Moorside Inn and Windpeak Inn are one layout, their
  front doors two units apart, which is the only reason Morthal's and
  Dawnstar's old points looked like one spot.
*/
const CHARGEN = {"shift":[["1be1a:Skyrim.esm",1],["1be1b:Skyrim.esm",1]],"rieklingShift":[["bfd98:Playable Rieklings.esp",1],["bfdb1:Playable Rieklings.esp",1]],"towns":{"e80030:Thornswood-Content.esp":{"key":"whiterun","town":"Whiterun","hold":"Whiterun Hold","arrival":{"cell":"WhiterunBanneredMare","desc":"1605e:Skyrim.esm","pos":[-113.6,-810,69.3],"rot":[0,0,3.7]},"start":{"cell":"WhiterunExterior01","desc":"3c:Skyrim.esm","pos":[19189.1,-12006.5,-4558.4],"rot":[0,0,309.9]}},"e80031:Thornswood-Content.esp":{"key":"riften","town":"Riften","hold":"The Rift","arrival":{"cell":"RiftenBeeandBarb","desc":"16bdf:Skyrim.esm","pos":[-150.2,-598.2,64],"rot":[0,0,36.3]},"start":{"cell":"RiftenPlankside03","desc":"3c:Skyrim.esm","pos":[166478.2,-95072.9,10735.1],"rot":[0,0,89.2]}},"e80032:Thornswood-Content.esp":{"key":"solitude","town":"Solitude","hold":"Haafingar","arrival":{"cell":"SolitudeWinkingSkeever","desc":"16a0e:Skyrim.esm","pos":[504.9,-1075.4,0],"rot":[0,0,270.1]},"start":{"cell":"cell 92be, below Solitude","desc":"3c:Skyrim.esm","pos":[-73387.2,94964.1,-11739],"rot":[0,0,12.1]}},"e80033:Thornswood-Content.esp":{"key":"windhelm","town":"Windhelm","hold":"Eastmarch","arrival":{"cell":"WindhelmCandlehearthHall","desc":"16789:Skyrim.esm","pos":[554.3,-3766.2,64],"rot":[0,0,91.9]},"start":{"cell":"WindhelmAttackStart05","desc":"3c:Skyrim.esm","pos":[135744.9,24540.5,-12865.3],"rot":[0,0,355.3]}},"e80034:Thornswood-Content.esp":{"key":"markarth","town":"Markarth","hold":"The Reach","arrival":{"cell":"MarkarthSilverBloodInn","desc":"16dfe:Skyrim.esm","pos":[-5588.5,-1925.8,-16],"rot":[0,0,180]},"start":{"cell":"MarkarthUnderStoneKeep","desc":"16df2:Skyrim.esm","pos":[-5558.7,-1247.7,6688],"rot":[0,0,37.3]}},"e80035:Thornswood-Content.esp":{"key":"falkreath","town":"Falkreath","hold":"Falkreath Hold","arrival":{"cell":"FalkreathDeadMansDrink","desc":"3a184:Skyrim.esm","pos":[834.6,-100.6,0],"rot":[0,0,53.1]},"start":{"cell":"FalkreathExterior05","desc":"3c:Skyrim.esm","pos":[-35529,-89918.3,-2946.1],"rot":[0,0,107.3]}},"e80036:Thornswood-Content.esp":{"key":"morthal","town":"Morthal","hold":"Hjaalmarch","arrival":{"cell":"MorthalMoorsideInn","desc":"138ce:Skyrim.esm","pos":[1970.6,-160.2,0],"rot":[0,0,270.9]},"start":{"cell":"MorthalExterior06","desc":"3c:Skyrim.esm","pos":[-41159.1,63851.4,-13778.6],"rot":[0,0,45.5]}},"e80037:Thornswood-Content.esp":{"key":"dawnstar","town":"Dawnstar","hold":"The Pale","arrival":{"cell":"DawnstarWindpeakInn","desc":"13a7f:Skyrim.esm","pos":[2010.3,-155.7,0],"rot":[0,0,273.1]},"start":{"cell":"DawnstarWesternMineExterior","desc":"3c:Skyrim.esm","pos":[25623.4,100614.3,-13216.9],"rot":[0,0,56.1]}},"e80038:Thornswood-Content.esp":{"key":"winterhold","town":"Winterhold","hold":"Winterhold","arrival":{"cell":"WinterholdTheFrozenHearth","desc":"13814:Skyrim.esm","pos":[1791.6,7.3,0],"rot":[0,0,88]},"start":{"cell":"WinterholdExterior05","desc":"3c:Skyrim.esm","pos":[111939,99023.6,-8742.5],"rot":[0,0,302.4]}}}};

/* The plain outfit is supplied before a fresh character opens the face menu.
 * Choosing reuses those same owned pieces after the body has settled. */
const SHIFT = CHARGEN.shift;

/* A riekling's own plain clothes, which a new riekling starts in instead of
 * the shift. See dressForRace, beside giveShift. */
const RIEKLING_SHIFT = CHARGEN.rieklingShift || [];

/* Nine towns, each with the inn a new arrival wakes up in. The one table left
 * of the sixteen trades and their kits. The class, the profession and the
 * half are the character block's (progression, further down), and nothing is
 * handed out for any of them: decided by Patrick on 20 September, the starter
 * kits are gone, and everybody begins with the shift and what they earn. */
const PASSAGES = CHARGEN.towns;

/* The panel sends a town as its short key, 'whiterun', because that is
 * stable. The records are keyed by descriptor, which is not: it carries the
 * plugin name and moves whenever the content is rebuilt. */
const TOWN_BY_KEY = (function () {
  const m = {};
  for (const desc in PASSAGES) { m[PASSAGES[desc].key] = desc; }
  return m;
})();

/** The town list as the panel shows it: key and name, in the table's order. */
function townsForPanel() {
  const out = [];
  for (const desc in PASSAGES) {
    const t = PASSAGES[desc];
    // The start spot is what a pick leads to since #2622, and the hold is
    // what the panel shows under the town, the same name the welcome says.
    if (t && t.start) { out.push({ key: t.key, name: t.town, hold: t.hold || '' }); }
  }
  return out;
}

/**
 * The shift goes in the pack at the beginning of appearance creation, and is
 * topped up if it went missing by the time a home is chosen. What is worn is
 * the equipment record, written once by dressNewCharacter below (#1560).
 *
 * A riekling gets its own plain clothes instead, once its race is known: see
 * rieklingShift below (#614). Until the race menu has stored a face there is
 * no race to read, so the shift goes in as for anybody.
 */
function giveShift(actorId) {
  let race = '';
  try { race = raceOf(actorId); } catch (e) { race = ''; }
  if (race.indexOf('riekling') !== -1 && RIEKLING_SHIFT.length) {
    rieklingShift(actorId, race);
    return;
  }
  let inv = { entries: [] };
  try { inv = mp.get(actorId, 'inventory') || { entries: [] }; } catch (e) { return; }
  const entries = (inv.entries || []).slice();
  let added = 0;
  for (const pair of SHIFT) {
    const baseId = idOf(pair[0]);
    if (!baseId) { continue; }
    let have = false;
    for (const e of entries) { if (e.baseId === baseId) { have = true; break; } }
    if (have) { continue; }
    // Worn on the entry too, so the pack and the record say the same thing at
    // the moment a character is made: the client builds the creation save it
    // loads from the pack, and the record is what it dresses from after that
    // (#1560).
    entries.push({ baseId: baseId, count: pair[1], worn: true });
    added++;
  }
  if (added) { mp.set(actorId, 'inventory', { entries: entries }); }

  /*
    SAID OUT LOUD, because "people are not loading in with their clothes on"
    was reported on 21 September and nothing anywhere could answer it.

    This ran silently, so there was no way to tell apart: the shift was never handed over, the shift was
    handed over and something took it off afterwards, or the shift is in the
    pack and the client is not wearing it. Three different faults, one symptom,
    no evidence.

    What goes down is what was decided and what the pack looks like after it,
    which separates the first two. A character who was skipped past creation
    never reaches this function at all, and the absence of this line for them
    is itself the answer.
  */
  let wearing = 0;
  for (const e of entries) { if (e && e.worn) { wearing++; } }
  log('chargen', actorId.toString(16), 'shift:', added, 'handed over,',
      (SHIFT.length - added), 'already there,', entries.length,
      'thing(s) in the pack,', wearing, 'worn');
}

/*
  ================= A RIEKLING STARTS IN RIEKLING CLOTHES ===================

  Decided by Patrick on 12 October 2026 (#614): "Rieklings get Riekling
  clothing". The shift is the Belted Tunic and Boots of Skyrim.esm. Their
  armour addons (FarmerTorso01AA, FarmerBoots01AA) list the ten human and
  beast races and no Riekling, and both playable Riekling races (Riekling Blue
  a6746 and Riekling Purple 19f47 of Playable Rieklings.esp) name KhajiitRace
  as their armour race, so the game drew a riekling in the tunic with the human
  sized Khajiit model on a riekling skeleton: the neck in the wrong place and
  the body showing through, again at every door, because a door draws the body
  again. Measured on the dev load order: of 2,704 armour addons only the 148 in
  Playable Rieklings.esp fit a playable riekling.

  So a riekling's shift is that mod's own riekling cut of the same plain
  clothes (CHARGEN.rieklingShift): the Riekling Belted Tunic (bfd98) and the
  Riekling Footwraps (bfdb1), clothing like the shift, whose addons
  (FarmerTorso01AA and PrisonerShoesAA of Playable Rieklings.esp) list both
  playable Riekling races. Patrick chose these over the mod's loincloth and
  cloth wraps, which are light armour, later the same evening.

  WHY HERE AND NOT IN created(). The race is picked in the race menu, which
  opens after the engine has handed the new character over, so created() has
  already dressed it in the shift, and from then on the engine refuses the
  server's write of what it wears (EquipmentBinding::Set in the fork).
  giveShift runs again when the face is stored and creation moves on to
  choosing (beginChoosing), the first moment the race is known. So for a
  riekling it takes the shift back out of the pack, puts the riekling pieces
  in, and asks the owner's game once, through Actor.EquipItem, to put each one
  on: the engine adds the piece if the pack does not hold it and sends that game
  the equip, and the game reports what it then wears, as it reports any change.
  Nothing asks twice or watches whether they went on. If the game did not put
  them on, they are in the pack, where the person puts them on like any other
  clothes. A second pass (a reconnect while choosing) finds the pieces already
  in the pack and does nothing.

  Anybody else gets the shift topped up in giveShift, as before.
*/
function rieklingShift(actorId, race) {
  let inv = { entries: [] };
  try { inv = mp.get(actorId, 'inventory') || { entries: [] }; } catch (e) { return 0; }
  let entries = (inv.entries || []).map(function (e) { return Object.assign({}, e); });
  let took = 0;
  for (const pair of SHIFT) {
    const baseId = idOf(pair[0]);
    if (!baseId) { continue; }
    let left = pair[1];
    for (const e of entries) {
      if (left <= 0) { break; }
      if (e.baseId !== baseId || !(e.count > 0)) { continue; }
      const n = Math.min(left, e.count);
      e.count -= n;
      left -= n;
      took += n;
    }
  }
  entries = entries.filter(function (e) { return e.count > 0; });
  const added = [];
  for (const pair of RIEKLING_SHIFT) {
    const baseId = idOf(pair[0]);
    if (!baseId) { continue; }
    if (entries.some(function (e) { return e.baseId === baseId; })) { continue; }
    entries.push({ baseId: baseId, count: pair[1], worn: true });
    added.push(pair[0]);
  }
  if (!took && !added.length) { return 0; }
  mp.set(actorId, 'inventory', { entries: entries });
  for (const desc of added) {
    try {
      mp.callPapyrusFunction('method', 'Actor', 'EquipItem',
        { type: 'form', desc: mp.getDescFromId(actorId) },
        [{ type: 'espm', desc: desc }, false, true]);
    } catch (e) {
      log('chargen', actorId.toString(16), 'could not ask its game to put on', desc, ':', e);
    }
  }
  log('chargen', actorId.toString(16), 'is a riekling (' + race + '):', took,
      'piece(s) of the shift taken back,', added.length, 'riekling piece(s) put in the pack and asked on once');
  return added.length;
}

/*
  ============== DRESSED FROM THE MOMENT THE CHARACTER IS MADE ==============

  Patrick, 4 October: "my clothes should just stay on from the moment someone
  creates a new character until they take them off", and "as soon as they
  click the new character button in the main menu clothes and gear and gold".

  What a character wears is the engine's equipment record, and the client
  dresses the character it owns from that record. Until #1560 the server could
  read it and not write it, so creation put the shift in the pack marked worn,
  the record stayed empty, and four things grew up to make the client wear it
  anyway: an owner script that kept equipping for fifteen seconds, an ask at
  every login, a watch that asked again when it saw somebody wearing nothing
  (#1604), and the front plugin putting the shift on by itself. The ask at
  login also put back on clothes somebody had taken off. All four are gone.

  Now the server writes the record, once, when the character is made. The
  engine's spawn calls created() below before it hands the new character to
  the person who made it, and that is the one moment the server may write it:
  the engine refuses the write for a character somebody's game owns, because
  from then on that game is where things go on and come off, and it reports
  every change. So the first packet their game gets already has the shift in
  the pack and on the body and the purse in the pack, and nothing afterwards
  has to ask for anything.

  Every entry is worn and in the pack, because the engine refuses anything
  else: this dresses a character in what it has and never hands it anything.
  The class's tool comes when the class is picked, later in creation, because
  it is not known before then.
*/
function dressNewCharacter(actorId) {
  const worn = [];
  for (const pair of SHIFT) {
    const baseId = idOf(pair[0]);
    if (baseId) { worn.push({ baseId: baseId, count: pair[1], worn: true }); }
  }
  if (!worn.length) { return 0; }
  mp.set(actorId, 'equipment', { inv: { entries: worn } });
  return worn.length;
}

/**
 * The face is made. Now the panel.
 *
 * A home town is chosen in the game, on K, checked by the character block,
 * and that one choice brings them back here to arriveAt. Class and
 * profession are chosen on the same panel, in the hall or later in the
 * world. Nothing is chosen anywhere else. The launcher used to send a
 * choice ahead through the voice service and this waited on it, which is what
 * left people standing in this room when the choice went to the wrong service
 * (the dev server asks the dev voice service; the launcher told the live one,
 * 20 September) or never came at all.
 */
function beginChoosing(actorId, state, why) {
  let appearance = null;
  try { appearance = mp.get(actorId, 'appearance'); } catch (e) { appearance = null; }
  if (!hasStoredAppearance(appearance)) {
    log('chargen', actorId.toString(16),
        'not leaving the face step (' + why + '): no appearance is stored yet');
    return;
  }
  state.stage = 'choosing';
  state.at = Date.now();
  state.remindAt = Date.now() + CHOOSE_REMIND_MS;
  setChargen(actorId, state);
  giveShift(actorId);
  closeRaceMenu(actorId);
  const opened = openCreation(actorId);
  /*
    THE PRESS K LINE IS FOR THE PANEL THAT DID NOT OPEN, AND FOR NOBODY ELSE.

    Patrick, 21 September: "during creation it shouldnt put in chat to press k
    to begin blah blah because it brings the menu up automically and that is
    chat spam and is unnescery". His own clips show it twice over, because the
    reminder below says it again every thirty seconds.

    openCreation pushes the panel onto the screen and answers whether it went.
    When it went, the person is looking at the thing the sentence describes and
    being told to press a key to open what is already open is noise. When it
    did NOT go, the sentence is the only way out of the room, so it is said
    then, and it says what has actually happened rather than pretending this is
    the normal greeting.
  */
  /*
    AND ONE LINE EITHER WAY, issue #416, once (tellOnce). The pack has just
    changed under them (giveShift) and the next pick moves them to a town,
    and neither is on the screen. The welcome is beginAppearance's.
  */
  tellOnce(actorId, 'choosing', opened
    ? 'You have been given plain clothes. Choose a home town, and that is ' +
      'where you will start.'
    : 'You have been given plain clothes. The starting panel did not open by ' +
      'itself. Press K to choose where you will start. Your class and ' +
      'profession can be chosen there too, or later in the world.');
  log('chargen', actorId.toString(16), '-> choosing (' + why + ')' +
      (opened ? ', panel opened' : ', panel NOT opened'));
}

/** Ask the character block to push the panel open on this person's screen. */
function openCreation(actorId) {
  try {
    const c = globalThis.__thornswoodCharacter;
    if (c && c.beginCreation) { c.beginCreation(actorId); return true; }
  } catch (e) {
    log('chargen', actorId.toString(16), 'could not open creation:', e);
  }
  return false;
}

/**
 * The home is chosen. Off to the town.
 *
 * Called by the character block when a home is set on somebody whose stage
 * is choosing; class and profession may still be empty, and are picked in
 * the world. Returns true when they were sent.
 */
function arriveAt(actorId, townKey) {
  const state = chargenOf(actorId);
  if (!state || state.stage !== 'choosing') { return false; }
  const desc = TOWN_BY_KEY[String(townKey || '').toLowerCase()];
  const entry = desc ? PASSAGES[desc] : null;
  if (!entry || !entry.start) {
    log('chargen', actorId.toString(16), 'no such town', townKey, '- staying in the hall');
    return false;
  }
  /*
    A NEW CHARACTER ARRIVES AT THE TOWN'S START SPOT, NOT IN ITS INN (#2622).
    Djinn, 17 October: inns are the busiest rooms in the game, so a stranger
    landed in the middle of other people's scenes, several picks of one town
    stacked on one spot, and anybody who wanted to harass new players knew
    where they appeared. Each town's start (game\data\chargen.json) is one
    spot Djinn stood on and marked with F8: the stables or carriage stop at
    Whiterun, Solitude, Windhelm and Riften, a spot of his choosing in
    Falkreath, Morthal, Dawnstar and Winterhold, and Understone Keep in
    Markarth. The outdoor ones are in Tamriel (3c), checked against
    Skyrim.esm. The inn spot (arrival) stays for staff, as /tp <town> inn.
  */
  const arrival = entry.start;
  mp.set(actorId, 'spawnPoint', {
    cellOrWorldDesc: arrival.desc, pos: arrival.pos, rot: arrival.rot,
  });
  mp.set(actorId, 'locationalData', {
    cellOrWorldDesc: arrival.desc, pos: arrival.pos, rot: arrival.rot,
  });
  state.stage = 'done';
  state.destination = entry.key;
  state.at = Date.now();
  setChargen(actorId, state);
  closeRaceMenu(actorId);
  log('chargen', actorId.toString(16), 'home =', entry.key, '(' + arrival.cell + ') -> done');
  /*
    ONE LINE ON ARRIVAL, beside the log line and never instead of it.

    The To Do List's entry on narrating creation lists what a stranger meets in
    the first minutes: "a stone room with nobody in it, a race menu, silence,
    an unexplained teleport". This is the teleport. Until now the server
    wrote "home = whiterun" to its own log and the person got a load screen
    and a room they had never seen, with no word from anybody.

    Only this one. Patrick, 21 September, on the panel line: "that is chat
    spam and is unnescery". That line described what was already on the
    screen. This one is said once, after the one pick that ends creation, and
    it says where the server has just moved them, which nothing else does.
    The other steps have one line each since issue #416, through tellOnce,
    each saying what changed and not what is already on the screen.

    say() and not notify(), whose own comment says it may well do nothing
    from here.
  */
  /*
    THE WORDS ARE DJINN'S, 17 October: "Welcome to (insert Hold name here),
    Safe Travels." The hold, not the town, out of the hold field of the town
    table (game\data\chargen.json), so it reads the way the land is named:
    Haafingar for Solitude, the Pale for Dawnstar. Said on this first arrival
    only, as before: arriveAt runs once, at the end of creation.
  */
  say(actorId, 'Welcome to ' + entry.hold + ', Safe Travels.');
  /*
    AND THE FIRST STEPS BEGIN HERE (#3166), and only here: the guide on the
    K panel and the Cook's errand, in the first steps block. One line says
    where they are, because the panel has just closed itself on the home.
  */
  const steps = globalThis.__thornswoodFirstSteps;
  if (steps && steps.begin) {
    try {
      if (steps.begin(actorId, entry.key)) {
        say(actorId, 'Your first steps in ' + entry.town + ' are on the panel behind K.');
      }
    } catch (e) {
      log('chargen', actorId.toString(16), 'the first steps could not begin:', e);
    }
  }
  return true;
}

/*
  A SAVED CHARACTER THE SERVER COULD NOT READ IS KEPT, AND ITS OWNER IS TOLD
  ONCE, issue #1269.

  On the dev server ff000005, profile 902356861's character, was skipped at
  every start because its race could not be read, and the next new character
  was given its id and saved over the file. The engine (fork PR 33) now keeps
  such a record on disk as it was, never hands its id out again, and lists it
  with its profile. The profile then has no character, so spawn makes it a new
  one under a new id, and created() below is that moment.

  Patrick, 5 October, on what the person gets: a new character under a new id,
  and told once, on joining, that the old one was kept. This asks the engine
  for the profile's kept records (getUnreadableChangeForms, added to the fork
  for #1269), writes them on the new character, and says the line only when
  that write reads back, the same order as tellOnce: written first, so it is
  never said twice. created() runs once per new character, so this is once per
  new character; the record on it also tells staff which old ids belong to it.
  Before the chargen switch, because with the hall off this is still the new
  character made because the old one could not be read.

  The line does not name the race. The engine keeps a record for three causes
  (a base form not in the load order, an appearance that will not parse, a
  race not in the load order) and does not say which to the gamemode; the
  server log names the cause, and the race id, at every start.

  An engine without the binding is said once in the log, not passed over in
  silence: such a server keeps nothing aside, so it has nobody to tell, and
  the line says the telling waits on the engine build that has it.
*/
const KEPT_PROPERTY = 'thornswoodKeptCharacters';
const KEPT_LINE =
  'Your earlier character could not be loaded on this server, so this is a ' +
  'new one. The earlier one has been kept as it was. ' +
  'Ask staff with /helpme to have it looked at.';
let keptUnaskableSaid = false;

// Invisible to both: only the server and staff have any use for it.
try {
  mp.makeProperty(KEPT_PROPERTY, {
    isVisibleByOwner: false, isVisibleByNeighbors: false,
    updateOwner: '', updateNeighbor: ''
  });
} catch (e) { /* already made by a previous load. harmless. */ }

function tellKeptCharacter(actorId) {
  const who = actorId.toString(16);
  if (typeof mp.getUnreadableChangeForms !== 'function') {
    if (!keptUnaskableSaid) {
      keptUnaskableSaid = true;
      log('kept', 'this engine build has no getUnreadableChangeForms (#1269), so ' +
          'nobody made a new character is told that an old one was kept');
    }
    return false;
  }
  let pid = 0;
  try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
  if (!pid) {
    log('kept', who, 'has no profile, so there is nothing kept to ask about');
    return false;
  }
  let kept;
  try {
    kept = mp.getUnreadableChangeForms(pid);
  } catch (e) {
    log('kept', who, 'could not ask which saved characters of profile', pid,
        'were kept:', e);
    return false;
  }
  if (!Array.isArray(kept) || !kept.length) { return false; }
  const ids = kept.map(function (id) { return (Number(id) >>> 0).toString(16); });

  let was = null;
  try { was = mp.get(actorId, KEPT_PROPERTY); } catch (e) { was = null; }
  if (was && was.told) { return false; }
  try {
    mp.set(actorId, KEPT_PROPERTY, { profileId: pid, kept: ids, told: Date.now() });
  } catch (e) {
    log('kept', who, 'profile', pid, 'has kept character(s)', ids.join(','),
        'but the record could not be written, so nothing was said:', e);
    return false;
  }
  let back = null;
  try { back = mp.get(actorId, KEPT_PROPERTY); } catch (e) { back = null; }
  if (!back || !back.told) {
    log('kept', who, 'profile', pid, 'has kept character(s)', ids.join(','),
        'but the record did not read back, so nothing was said');
    return false;
  }
  log('kept', who, 'is a new character for profile', pid, 'whose saved character(s)',
      ids.join(','), 'could not be read and were kept; told once');
  say(actorId, KEPT_LINE);
  return true;
}

/* What the character block, further down the file, needs from here. Through
 * the global rather than the scope, the same way it reaches the rules, so the
 * sections stay separable. */
globalThis.__thornswoodChargen = {
  created: function (actorId) {
    tellKeptCharacter(actorId);
    if (!CHARGEN_ENABLED || chargenOf(actorId)) { return; }
    firstSeen.set(actorId, Date.now());
    beginAppearance(actorId);
    // Packed, paid and dressed before the engine hands the character over
    // (#1560). See the note over dressNewCharacter. The purse goes in before
    // the record is written, so the pack is whole when the record names what
    // in it is worn. The purse cannot make a new character read as a returning
    // one: the stage is already persisted above, and gold does not count in
    // that decision (see chargenTick). The tick's purse loop finds it marked.
    const spoils = globalThis.__thornswoodSpoils;
    if (spoils && spoils.purse) {
      try { spoils.purse(actorId); } catch (e) { /* said in the spoils log */ }
    }
    try {
      log('chargen', actorId.toString(16), 'dressed in', dressNewCharacter(actorId),
          'thing(s) before it was handed over');
    } catch (e) {
      log('chargen', actorId.toString(16), 'could not be dressed:', e);
    }
  },
  towns: townsForPanel,
  hasTown: function (key) { return !!TOWN_BY_KEY[String(key || '').toLowerCase()]; },
  isChoosing: function (actorId) {
    const st = chargenOf(actorId);
    return !!(st && st.stage === 'choosing');
  },
  /*
    IN CREATION: the face and then the panel, from the hall to the home.

    Patrick, 24 September, over a tester's screenshot of the hall with the
    needs bars drawn and drifting: "needs menu shouldnt show or be actuive
    during creation". The needs block asks this, and it is the chargen stage
    and nothing else: appearance and choosing are creation, done is the world.

    Before the stage opens there is no record at all for the first SETTLE_MS
    of a session. For that window it is the same physical fact the tick
    decides on: standing in the hall means new, because nobody logs out there.
  */
  inCreation: function (actorId) {
    const st = chargenOf(actorId);
    if (st) { return st.stage === 'appearance' || st.stage === 'choosing'; }
    if (!CHARGEN_ENABLED) { return false; }
    try { return mp.get(actorId, 'worldOrCellDesc') === HALL.desc; } catch (e) { return false; }
  },
  /** The plugin saw the race menu close. Only means something while the face is awaited. */
  faceDone: function (actorId) {
    const st = chargenOf(actorId);
    if (!st || st.stage !== 'appearance') { return false; }
    st.faceDone = Date.now();
    setChargen(actorId, st);
    log('chargen', actorId.toString(16), 'the plugin says the race menu closed');
    return true;
  },
  /*
    The plugin saw the race menu go down with the game (F10 / quit), not
    Escape, Cancel or Done. Only means something while the face is awaited.
    Clears the open marks so a still-connected player can be asked again.
    Does not set faceDone: a half-made face is not a finished face.
  */
  faceDown: function (actorId) {
    const st = chargenOf(actorId);
    if (!st || st.stage !== 'appearance') { return false; }
    delete st.faceOpenAt;
    delete st.faceSeenAt;
    delete st.faceHeld;
    setChargen(actorId, st);
    log('chargen', actorId.toString(16),
        'the plugin says the race menu went down with the game, not a finished face');
    return true;
  },
  /*
    The plugin says the race menu is on screen right now. Only means something
    while the face is awaited. /face done and /racedown are the closes; a
    quiet stream after a report is still open. The first report is logged
    and the once a minute ones after it are not.
  */
  faceOpen: function (actorId) {
    const st = chargenOf(actorId);
    if (!st || st.stage !== 'appearance') { return false; }
    const now = Date.now();
    if (!st.faceOpenAt) {
      st.faceOpenAt = now;
      log('chargen', actorId.toString(16), 'the plugin says the race menu is up');
    }
    st.faceSeenAt = now;
    setChargen(actorId, st);
    return true;
  },
  hasStoredAppearance: hasStoredAppearance,
  publishedForOthers: publishedForOthers,
  /*
    The panel was closed on purpose, so hold the reminder off. See
    CHOOSE_LATER_MS and the 'later' branch of /pick.

    Only while choosing. During appearance the panel is not what is on screen
    and the race menu machinery has its own timers; answering false there
    means the person is simply told to press K, which is true and harmless.
  */
  remindLater: function (actorId) {
    const st = chargenOf(actorId);
    if (!st || st.stage !== 'choosing') { return false; }
    st.remindAt = Date.now() + CHOOSE_LATER_MS;
    setChargen(actorId, st);
    log('chargen', actorId.toString(16), 'closed the panel on purpose; not reminding for',
        Math.round(CHOOSE_LATER_MS / 60000) + ' minutes');
    return true;
  },
  arrive: arriveAt
};

/**
 * The race menu is finished with, whatever route got us here.
 *
 * Spawn opens it, and only the appearance arriving closes it. Somebody who
 * left the hall on the movement path or on the give up path still has it set
 * open, CreateActor sends that flag on every later login, and the client dutifully
 * reopens the race menu on a character who has had a face for a week.
 */
/*
  Shut the race menu, EXCEPT ON SOMEBODY THE SERVER HAS NO FACE FOR.

  firstreconboone, 22 September: "Character's already made, however upon
  logging into game the options popped up." Every login, on a character that
  has been played for days.

  IT IS A LOOP AND THIS FUNCTION IS ONE HALF OF IT. Read out of the fork rather
  than guessed at, MpActor.cpp:

      // Actor without appearance would not be visible so we force player to
      // choose appearance
      if (changeForm.appearanceDump.empty()) {
        changeForm.isRaceMenuOpen = true;
      }

  That runs in ApplyChangeForm, which is every login. And the only place an
  appearance is ever stored is ActionListener.cpp:

      const bool isAllowed = actor->IsRaceMenuOpen();
      if (isAllowed) { actor->SetRaceMenuOpen(false); actor->SetAppearance(...); }

  So an appearance that arrives while the server thinks the menu is shut is
  THROWN AWAY. Put the two together: the engine opens the menu because there is
  no face on file, this file closes it a tick later because the character is
  obviously not new, the person makes a face anyway, the upload is refused, the
  dump stays empty, and tomorrow the engine opens it again. For ever.

  The returning branch in the tick has been logging the evidence the whole
  time: "already has a character carrying 4 things, not in the hall, NO FACE,
  so creation is skipped for them".

  So: no face on file, no closing. The menu the engine opened stays open, the
  person makes a face once, it is accepted because the flag was still set, and
  it never opens again. Leaving it open costs somebody one race menu they can
  click straight through; closing it costs them one every login for ever.
*/
function closeRaceMenu(actorId) {
  var has = false;
  try {
    var a = mp.get(actorId, 'appearance');
    has = !!(a && typeof a === 'object');
  } catch (e) {
    // A read that throws is treated as having a face, because the failure this
    // guard exists for is closing the menu on somebody who needs it and the
    // opposite failure is one extra menu once.
    has = true;
  }
  if (!has) {
    log('chargen', actorId.toString(16),
        'has no appearance on file, so the race menu is left open: closing it ' +
        'is what makes the next one be thrown away');
    return;
  }
  try {
    mp.setRaceMenuOpen(actorId, false);
  } catch (e) {
    log('chargen', actorId.toString(16), 'could not close the race menu:', e);
  }
}

/**
 * A short signature of a face, enough to tell one from another.
 *
 * "Has this character got an appearance yet" turned out to be the wrong
 * question. A client carries the last face it made and uploads it the moment it
 * connects, so somebody making their second character arrived already wearing
 * their first one's face: the server saw a finished character, skipped creation
 * and left them standing there. What matters is whether the face CHANGED since
 * the race menu was opened, which needs something to compare against.
 */
function faceMark(a) {
  if (!a || typeof a !== 'object') return '';
  try {
    return [a.raceId, a.isFemale, a.weight, a.hairColor, a.skinColor,
            a.headTextureSetId, a.name,
            (a.headpartIds || []).join('.'),
            (a.tints || []).length].join('|');
  } catch (e) {
    return '';
  }
}

/*
  A STORED APPEARANCE, not a name, not the word Adventurer, not a guess.

  Djinn, 3 Oct 2026 about 22:31 ET on dev, profile 598737699: he picked a
  brand-new slot, the race menu never opened, he was in the world as the
  placeholder, the trade list named him "somebody", and Patrick could not
  see a body. The walking path (MOVED_ENOUGH_MS, half a second) and the
  five-minute give-up both called beginChoosing while appearance was still
  missing. Neighbours then got an actor with no base (player 0x7 is omitted
  on purpose) and no face, so the client correctly refused to place a mesh.
  The trade name fell back because appearance.name was empty. Voice is
  keyed by profile id and was not this.

  THE GATE IS THE OBJECT THE ENGINE STORED. closeRaceMenu already asks
  this: a value that is an object means the race menu wrote a face; null
  or a throw does not. A blank name is still a stored face. A returning
  character whose appearance is already there is not sent back through
  the menu.
*/
function hasStoredAppearance(a) {
  return !!(a && typeof a === 'object');
}

/** True when this person may be in the world for anybody else. */
function publishedForOthers(actorId) {
  try {
    return hasStoredAppearance(mp.get(actorId, 'appearance'));
  } catch (e) {
    // A read that throws is treated as published, because hiding a
    // returning character from the lists is the worse of the two mistakes.
    return true;
  }
}

function chargenOf(actorId) {
  let s = null;
  try {
    s = mp.get(actorId, CHARGEN_PROPERTY);
  } catch (e) {
    s = null;
  }
  if (!s || typeof s !== 'object') return null;
  return s;
}

function setChargen(actorId, state) {
  mp.set(actorId, CHARGEN_PROPERTY, state);
}

/*
  ONE LINE PER STEP OF CREATION, ONCE PER CHARACTER, issue #416.

  Patrick, 28 September, on these lines: "Yes I want it, the problem was it
  kept spamming the same message every like 5 seconds". The old creation line
  was said from the choosing reminder, which runs on a timer and runs again
  straight away every time the tick sees somebody afresh (a reconnect, a drop
  out of onlinePlayers, and until #3154 a hot reload emptying firstSeen). A
  line that rides a timer or a first sighting repeats; a line that rides a
  stage change should not, but only while the stage write sticks, and
  chargenTick re-reads the record every 500 ms.

  So the step is written on the record (told) BEFORE the line goes, and the
  line goes only when the record read back says so. A step already told is
  never told again, whatever calls this; a write that did not stick says
  nothing rather than saying it on every tick. A new character is a new actor
  with no record, so they are told again.
*/
function tellOnce(actorId, step, text) {
  const st = chargenOf(actorId);
  if (!st || (st.told && st.told[step])) { return false; }
  st.told = Object.assign({}, st.told);
  st.told[step] = Date.now();
  setChargen(actorId, st);
  const back = chargenOf(actorId);
  if (!back || !back.told || !back.told[step]) { return false; }
  say(actorId, text);
  return true;
}

/** Add or remove a set of [descriptor, count] pairs in one inventory write. */
function giveItems(actorId, pairs, sign) {
  const inv = mp.get(actorId, 'inventory') || { entries: [] };
  const entries = (inv.entries || []).slice();
  for (const pair of pairs) {
    const baseId = idOf(pair[0]);
    if (!baseId) {
      log('chargen: no form for', pair[0], '- skipped');
      continue;
    }
    const want = pair[1] * sign;
    let at = -1;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].baseId === baseId) { at = i; break; }
    }
    if (at === -1) {
      if (want > 0) entries.push({ baseId: baseId, count: want });
      continue;
    }
    entries[at].count += want;
    if (entries[at].count <= 0) entries.splice(at, 1);
  }
  mp.set(actorId, 'inventory', { entries: entries });
}

/** Put somebody in the creation hall. Once, at the moment the stage opens. */
function sendToHall(actorId) {
  const cell = idOf(HALL.desc);
  if (!cell) {
    log('chargen: the creation hall is not in this load order, staying put');
    return false;
  }
  mp.set(actorId, 'locationalData', {
    cellOrWorldDesc: HALL.desc,
    pos: HALL.pos,
    rot: HALL.rot,
  });
  return true;
}

/**
 * Open the creation stage. Deliberately does NOT touch the race menu.
 *
 * The Spawn system already calls setRaceMenuOpen, in both of its branches: on
 * the create path for a brand new character, and on the load path for one whose
 * appearance has been cleared. Calling it again from here was a second
 * ShowRaceMenu landing across the client's save load, on top of a teleport, and
 * it is the only new thing in the neighbourhood of the crash we saw. Watching
 * for the appearance to arrive is all this needs to do.
 */
function beginAppearance(actorId) {
  // The face they turned up with, so the one they make can be told from it.
  let was = '';
  try { was = faceMark(mp.get(actorId, 'appearance')); } catch (e) { was = ''; }

  // seenAt is the first sight recorded by the tick, so the reconnect check
  // does not read a brand new arrival as somebody coming back (it did, on
  // 20 September, half a second after every arrival: a wrong line and the
  // grace paid twice).
  const state = { stage: 'appearance', at: Date.now(), faceWas: was, seenAt: firstSeen.get(actorId) || 0 };

  // Moved first, asked second, and the asking happens on a later tick.
  //
  // Both used to happen here, in that order, and the order was wrong: the menu
  // opened wherever the client had finished loading, then the teleport landed
  // underneath it and dragged the whole scene through a load screen while
  // somebody was already picking a nose. Which is exactly what it looked like
  // from the chair: creation in a tavern, then the hall, then a wait, then
  // another teleport.
  //
  // startPoints already puts a new character in the hall, so the common case
  // moves nobody and the menu opens on the next pass a second or two later.
  let where = null;
  try {
    where = mp.get(actorId, 'worldOrCellDesc');
  } catch (e) {
    where = null;
  }
  if (where && where !== HALL.desc) {
    if (sendToHall(actorId)) {
      state.moved = true;
      // Long enough for the load screen the teleport just started. Asking for
      // the race menu during one is asking for nothing: showRaceMenu on a game
      // that is mid load does nothing at all and the request is gone.
      state.askAt = Date.now() + 4000;
    }
  }

  setChargen(actorId, state);
  // Persist the stage first, so the supplied clothes cannot make a new
  // character look like a returning character on the next creation tick.
  const persisted = chargenOf(actorId);
  if (!persisted || persisted.stage !== 'appearance' || persisted.at !== state.at) { return; }
  giveShift(actorId);
  log('chargen', actorId.toString(16), '-> appearance',
      state.moved ? '(moving to the hall, menu to follow)' : '(already in the hall)');
  // Issue #416, once (tellOnce): the stone room, and the teleport into it. The
  // race menu is not described: it is on their screen.
  tellOnce(actorId, 'hall', state.moved
    ? 'Welcome to Thornswood. You are going to the creation hall to make your character.'
    : 'Welcome to Thornswood. This is the creation hall, where you make your character.');
}

/**
 * One pass over everybody online.
 *
 * The timer owns two transitions: appearance -> choosing, because the race
 * menu closing is not an event, the appearance simply turns up on the change
 * form and this notices; and the reminder while somebody is choosing. The
 * exit from choosing is the character block's, when the last pick lands.
 */
function chargenTick() {
  if (!CHARGEN_ENABLED) {
    return;
  }
  let online;
  try {
    online = mp.get(0, 'onlinePlayers');
  } catch (e) {
    return;
  }
  if (!Array.isArray(online)) return;

  const now = Date.now();

  // Anyone who has gone offline should not keep a slot in the settle table.
  const here = new Set(online);
  for (const id of Array.from(firstSeen.keys())) {
    if (!here.has(id)) {
      firstSeen.delete(id);
      // The cuffs keep nothing on somebody gone (#2573, wentOut()).
      try {
        const cuffsGone = globalThis.__thornswoodCuffs;
        if (cuffsGone && cuffsGone.wentOut) { cuffsGone.wentOut(id); }
      } catch (e) {
        log('logout', id.toString(16), 'could not clear what the cuffs knew of them:', e);
      }
    }
  }

  for (const actorId of online) {
    if (!firstSeen.has(actorId)) {
      firstSeen.set(actorId, now);

      /*
        Somebody who arrives inside a restart window is probably standing in an
        empty world, and until now nothing said so.

        A kick with no process restart behind it leaves the actor in a state
        where the reconnecting client is never sent the world. That is written
        out in full down in clearTheServer(), from 17 September: one character,
        13 reconnects, every one of them dead with no hits and no deaths and
        all the NPCs gone, and the same character fine after the 01:00 process
        restart. It was reported again on 20 September, and that session's log
        has the server says it is restarting, staying put immediately after
        ready, so the person had joined during the countdown. The site reported
        the server up with nobody online while he was standing in it.

        Joining during the window is a second way into the same state and the
        comment down there does not cover it. The server cannot refuse the
        connection from here, because there is no login hook to refuse it in,
        and it must not kick: a kick is the thing that causes this. So it says
        so, which is the difference between a broken evening and a known one.

        The same test the online writer uses, deliberately, so the two cannot
        disagree about whether a restart is happening. at covers the countdown
        and the tick after it, went covers the rest.
      */
      try {
        const r = globalThis.__thornswoodRestart;
        const inWindow = !!(r && ((r.at && now - r.at < 180000) ||
                                  (r.went && now - r.went < 180000)));
        if (inWindow) {
          log('login', actorId.toString(16),
              'arrived inside a restart window: if the world is empty this is why');
          say(actorId,
              'The server was restarting as you arrived. If nobody is about and ' +
              'the world looks empty, quit to the launcher and come back in a ' +
              'minute. It is not your game.');
        }
      } catch (e) { }

      /*
        Somebody who arrives already dead still gets a temple.

        spawnPoint is only ever written in onDeath, at the moment the body
        falls, so a death that happened while the client was disconnected, or
        during a kick window, leaves the character dead with whatever spawn
        point they had before. The SkyMP server does respawn a dead actor when
        it re-attaches, so they come back, and they come back at the default
        point rather than at the nearest consecrated ground.

        Written here, once, on the tick that first sees them. Nothing is moved
        and nothing is resurrected: this only decides where the respawn the
        server is already going to do puts them.
      */
      let dead = false;
      try { dead = !!mp.get(actorId, 'isDead'); } catch (e) { dead = false; }
      if (dead) {
        try {
          const where = {
            desc: mp.get(actorId, 'worldOrCellDesc'),
            pos: mp.get(actorId, 'pos'),
            cameIn: cameInOf(actorId),
          };
          const back = resolveArrival(where);
          if (back) {
            mp.set(actorId, 'spawnPoint', {
              cellOrWorldDesc: back.desc, pos: back.pos, rot: back.rot,
            });
            log('login', actorId.toString(16), 'came back dead in', where.desc,
                '-> ' + back.cell + ' (' + back.slot + ')');
          }
        } catch (e) {
          log('login', actorId.toString(16), 'could not set a spawn point:', e);
        }
      }

      /*
        Every spell they have learned, back onto the character.

        A blessing survives logging out because Actor.AddSpell records it on
        the server and the list is re-sent on every spawn. A spell learned
        through the panel is the same call and survives the same way, so this
        is not what keeps it: this is what puts back the ones that were
        learned on a build with no form id for them, and the ones lost with a
        change form. AddSpell on a spell somebody already has does nothing, so
        the cost is a call per spell per session.

        This is the one per-session hook there is. It rides on the chargen
        tick, so it goes with it if "thornswoodChargen": false is ever set in
        server-settings.json; that is written down rather than worked around,
        because a second timer over the same list is worse.
      */
      try {
        const c = globalThis.__thornswoodCharacter;
        if (c && c.grantKnown) { c.grantKnown(actorId); }
      } catch (e) {
        log('login', actorId.toString(16), 'could not put the known spells back:', e);
      }

      // A plant picked in an earlier session is not emptied again (#3080, see
      // PICKED_PROPERTY): the order is done with once they are back.
      try {
        const order = mp.get(actorId, PICKED_PROPERTY);
        if (order && order.at) { mp.set(actorId, PICKED_PROPERTY, { ref: 0, at: 0 }); }
      } catch (e) {
        log('login', actorId.toString(16), 'could not clear the last picked plant:', e);
      }

      // Their own profession, said back to them as they arrive, which proves
      // the route from the server to the person's own screen (issue #509).
      try {
        const c = globalThis.__thornswoodCharacter;
        const P = globalThis.__thornswoodProgression;
        const s = c && c.stateOf ? c.stateOf(actorId) : null;
        const prof = s && s.prof && P && P.has(P.TABLE.professions, s.prof)
          ? P.TABLE.professions[s.prof] : null;
        if (prof) {
          notify(actorId, 'Your profession: ' + prof.name +
                 (s.half && c.nameOf ? ', ' + c.nameOf(s.half) : '') + '.');
        }
      } catch (e) {
        log('login', actorId.toString(16), 'could not say the profession:', e);
      }

      // A guard is issued their Prisoner's Cuffs as they arrive, and a new
      // session looks at their pair afresh (#2573, cameIn()).
      try {
        const cuffsHere = globalThis.__thornswoodCuffs;
        if (cuffsHere && cuffsHere.cameIn) { cuffsHere.cameIn(actorId); }
      } catch (e) {
        log('login', actorId.toString(16), 'could not issue the cuffs:', e);
      }

      /*
        AND THE K PANEL'S VIEW, WORKED OUT NOW (#1642), so a Rush, a Font of
        Magic or restoration strain that ran into a restart is not on them
        once they are back. See arrival() in the character block. Last, so
        anything above that changes the character is in it.
      */
      try {
        const c = globalThis.__thornswoodCharacter;
        if (c && c.arrival) { c.arrival(actorId); }
      } catch (e) {
        log('login', actorId.toString(16), 'could not send the panel worked out now:', e);
      }
    }

    if (now - firstSeen.get(actorId) < SETTLE_MS) {
      continue;
    }

    let state, appearance;
    try {
      state = chargenOf(actorId);
      appearance = mp.get(actorId, 'appearance');
    } catch (e) {
      continue;
    }

    if (!state) {
      let pidNew = 0;
      try { pidNew = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pidNew = 0; }

      /*
        Somebody who already exists, decided by what they own.

        The check below this used to come first, on the stated grounds that a
        choice waiting from the launcher is proof the character was made
        seconds ago. It is not. The launcher posts a choice whenever it has a
        trade and a town recorded for a slot, and it has those for every
        character it has ever made, so a character who has been played for
        hours arrives here looking brand new. What follows is creation run a
        second time on somebody who already finished it: another full starter
        kit tipped into a pack that already had one, every piece of it equipped
        over what they were already wearing, and a trip back to the town they
        started in.

        A pack with things in it is proof in the other direction, because
        nobody arrives owning something unless they have played.

        EXCEPT GOLD, AND THAT SENTENCE USED TO READ "it cannot be wrong,
        because nothing hands anybody anything before this point". It stopped
        being true on 21 September, the same evening the starting purse was
        added, and it took creation down for everybody.

        The purse loop runs over everybody online a few lines above this one.
        A brand new character arrived, was handed forty gold, and on THE SAME
        TICK this read their pack, found one entry in it, and concluded they
        had played before. Creation was skipped, they were stamped done, and
        closeRaceMenu shut the menu Spawn had correctly opened for them. Three
        sessions in a row on the live server:

          15:19:54  chargen ff000058 profile 744947683 already has a character
                    carrying 1 thing, in the hall, no face, so creation is
                    skipped for them

        In the hall, no face, and told they had done this before. Djinn
        described it from the other side: the menu never opens after naming and
        you are stuck in the room.

        So gold does not count. The question this is asking is whether somebody
        has PLAYED, and gold the server handed out unprompted is the one thing
        in a pack that is no evidence of that. The purse also moved below the
        chargen loop, so it cannot reach the same tick's decision at all; this
        is the half that does not depend on the order being right.
      */
      const goldId = (globalThis.__thornswoodSpoils
                      && globalThis.__thornswoodSpoils.GOLD) || 0x0000000F;
      let owns = 0;
      try {
        const inv = mp.get(actorId, 'inventory');
        const entries = (inv && inv.entries) || [];
        for (let i = 0; i < entries.length; i++) {
          if (entries[i] && entries[i].baseId !== goldId) { owns++; }
        }
      } catch (e) { owns = 0; }

      /*
        New or returning is decided by two physical facts, in this order, and
        by nothing inferred.

        FIRST, THINGS IN THE PACK MEAN RETURNING, wherever they are standing.
        Nothing hands anybody anything before this point, so nobody arrives
        owning something unless they have played. This is the proof that
        cannot be wrong and it goes first. 7ffe41a demoted it and that was a
        mistake, below.

        SECOND, WITH AN EMPTY PACK, STANDING IN UNBOUND'S HALL MEANS NEW. The
        hall is where the server's start point puts a brand new actor and
        nowhere else; nobody logs out there and nobody wakes up there twice.
        Anywhere else with an empty pack is somebody returning, most often a
        legacy character from before creation existed.

        WHY NOT THE APPEARANCE. 7ffe41a made "has a face" mean "returning", to
        stop played characters being re-created in whatever inn they had last
        chosen. That fixed the inn and broke the hall: on 20 September at
        11:52:26 profile 1043928337, brand new, was logged as already having a
        character and stamped done in the hall with no teleport and no way
        out. SkyMP opens the race menu on spawn, before this tick ever sees
        the actor, and confirming a face takes less than the ten second settle,
        so a new character has an appearance by the time anyone asks. A face
        is not evidence of anything either. Neither is a launcher choice: the
        launcher posts one for every slot it has ever made and the voice
        service keeps them a week, sixty five were waiting that morning.

        A location read that throws counts as not in the hall. Re-creating a
        person is the worse of the two mistakes, so the doubt goes that way.
      */
      let inHall = false;
      try {
        inHall = mp.get(actorId, 'worldOrCellDesc') === HALL.desc;
      } catch (e) { inHall = false; }

      const returning = owns > 0 || !inHall;
      if (returning) {
        log('chargen', actorId.toString(16), 'profile', pidNew,
            'already has a character' +
            (owns > 0 ? ' carrying ' + owns + (owns === 1 ? ' thing' : ' things')
                      : ' and is carrying nothing') +
            (inHall ? ', in the hall' : ', not in the hall') +
            (appearance ? ', face on' : ', no face') +
            ', so creation is skipped for them');
        setChargen(actorId, { stage: 'done', at: now, legacy: true });
        closeRaceMenu(actorId);
        // Issue #416, once (tellOnce): why the race menu shut, if it was up.
        tellOnce(actorId, 'back', 'Welcome back to Thornswood. This character is already made.');
        continue;
      }

      // Genuinely new: an empty pack, standing in the hall.
      log('chargen', actorId.toString(16), 'profile', pidNew,
          'is new, in the hall with nothing' +
          (appearance ? ', face already on' : ''));
      beginAppearance(actorId);
      continue;
    }

    /*
      Bard is RP-only now (see RP_ONLY), not a Class. The old instrument
      ability that was handed out for that class key is gone: nobody gets
      PlayInstrumentSpell for having been a bard. Playing for rest is the
      emote wheel's lute, flute, drum or Sing, which the needs block sees
      (#1631); instruments themselves are woodwright craft.
    */

    // 'arriving' was the kit top-up after the teleport. There are no kits, so
    // anybody still marked arriving from before 20 September is simply done.
    if (state.stage === 'arriving') {
      state.stage = 'done';
      setChargen(actorId, state);
      closeRaceMenu(actorId);
      log('chargen', actorId.toString(16), 'was marked arriving from before the kits went; closed');
      continue;
    }

    /*
      Standing in the hall with the panel to fill in.

      The exit is not here: the character block sends them the moment the
      home is picked (arriveAt). This is the reminder, and the reopen after
      a reconnect, because the page that had the panel is gone with the old
      session and the property does not fire again on its own.
    */
    if (state.stage === 'choosing') {
      const cameOnC = firstSeen.get(actorId) || 0;
      if (state.seenAt !== cameOnC) {
        state.seenAt = cameOnC;
        state.remindAt = now;
        setChargen(actorId, state);
      }
      if (now < (state.remindAt || 0)) { continue; }
      state.remindAt = now + CHOOSE_REMIND_MS;
      setChargen(actorId, state);
      /*
        THE REMINDER STILL PUSHES THE PANEL, SILENTLY. See beginChoosing.

        This is the rescue for a panel that never arrived, and pushing it again
        costs the person nothing. Saying so every thirty seconds cost them a
        chat window, which is what Patrick's clips show. The sentence is kept
        for the case it was written for: the push failed, so there is nothing
        on their screen and a key press is the only way on.
      */
      //
      // And said once (tellOnce, issue #416): this is the timer that repeated
      // the old line, and beginChoosing has already said it on the same step,
      // so a reminder, a reconnect or a hot reload after that says nothing.
      if (!openCreation(actorId)) {
        tellOnce(actorId, 'choosing', 'The starting panel did not open. Press K ' +
                     'to choose where you will start. Your class and profession ' +
                     'can wait until you are there.');
      }
      continue;
    }

    if (state.stage === 'appearance') {
      /*
        A lost open-race-menu request (no /racemenu report, no stored face)
        is asked again every NUDGE_MS. A second setRaceMenuOpen over a menu
        the plugin already says is up is an access violation, so that case
        is never asked. Once a face is stored the asks stop. The two lines
        below are tellOnce: one each for the whole wait, not one per ask.
      */
      const raceMenuIsUp = function () {
        // /face done and /racedown are the closes. A quiet /racemenu
        // stream is not: the plugin reports once a minute, and a gap is
        // a missed line, not a shut menu. Treating faceSeenAt older than
        // FACE_SEEN_MS as closed sent a second setRaceMenuOpen over a
        // menu that was still up (access violation). Once /racemenu has
        // been seen, the menu stays up until /face done, /racedown, or a
        // stored face.
        if (state.faceDone) { return false; }
        return !!(state.faceOpenAt || state.faceSeenAt);
      };
      const askForLostRaceMenu = function (why) {
        if (hasStoredAppearance(appearance) || raceMenuIsUp()) { return false; }
        const last = state.askedMenuAt || 0;
        if (last && now - last < NUDGE_MS) { return false; }
        state.askedMenuAt = now;
        state.menuAsks = (state.menuAsks || 0) + 1;
        setChargen(actorId, state);
        try {
          mp.setRaceMenuOpen(actorId, true);
          log('chargen', actorId.toString(16),
              'asking for the race menu again (' + why + '), ask', state.menuAsks);
        } catch (e) {
          log('chargen', actorId.toString(16), 'could not open the race menu:', e);
        }
        if (state.menuAsks === 2) {
          tellOnce(actorId, 'raceMenuAgain',
              "Your character creation menu didn't open. Opening it again.");
        } else if (state.menuAsks >= 3) {
          tellOnce(actorId, 'raceMenuRelog',
              'The character creation menu still did not open. Relog, and if it ' +
              'still does not open, contact staff.');
        }
        return true;
      };

      /*
        A reconnect starts the wait again from nothing.

        None of the fields below are cleared when somebody drops out of the
        hall and comes back, so a character who walked about for a few seconds
        and then quit returns with liveSince already set, where holding a
        position from the last session, and askedAt already past. The very
        first settled tick then reads that as somebody who has been on their
        feet for as long as they were away, and teleports them to the inn
        while their client is still loading the hall.

        firstSeen is set the moment somebody comes online, so comparing it
        against what the state remembers is what tells a reconnect from the
        session that made it.
      */
      const cameOn = firstSeen.get(actorId) || 0;
      if (state.seenAt !== cameOn) {
        state.seenAt = cameOn;
        delete state.liveSince;
        delete state.where;
        delete state.askedAt;
        delete state.nudged;
        delete state.askedMenuAt;
        delete state.menuAsks;
        // The last session's race menu went with it. This one reports its own.
        delete state.faceOpenAt;
        delete state.faceSeenAt;
        delete state.faceHeld;
        // Long enough for the arrival to settle before a baseline is taken,
        // the same grace a fresh arrival gets.
        state.askAt = now + 4000;
        setChargen(actorId, state);
        log('chargen', actorId.toString(16),
            'came back mid creation, so the wait starts again');
        continue;
      }

      // The baseline, once whatever load screen we started has had time to
      // finish. No menu is opened here, deliberately. See below.
      if (!state.askedAt) {
        if (now < (state.askAt || 0)) { continue; }
        state.askedAt = now;
        // The face they are standing in right now, which after a teleport is
        // the one the client re-sent on arrival. Taken here rather than before
        // the move so that arrival is not mistaken for a finished face.
        state.faceWas = faceMark(appearance);
        setChargen(actorId, state);
        continue;
      }

      // Whether they are on their feet or in a menu, which is the one thing
      // that decides whether opening the race menu would be a rescue or a
      // wrecking ball. The server cannot ask the client what is on screen, but
      // it can see that somebody is turning on the spot: the angle moves every
      // frame while a person has the mouse, and not at all while a menu has it.
      let live = false;
      try {
        const pos = mp.get(actorId, 'pos') || [0, 0, 0];
        const ang = mp.get(actorId, 'angle') || [0, 0, 0];
        const here = [pos[0], pos[1], pos[2], ang[2]].join(',');
        if (state.where && state.where !== here) {
          // Far enough to be a person, not a settle. See MOVED_UNITS.
          const was = String(state.where).split(',');
          const dx = pos[0] - Number(was[0]);
          const dy = pos[1] - Number(was[1]);
          const dz = pos[2] - Number(was[2]);
          let turned = Math.abs(ang[2] - Number(was[3]));
          if (turned > 180) { turned = 360 - turned; }
          const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (moved >= MOVED_UNITS || turned >= MOVED_DEGREES) { live = true; }
        }
        if (state.where !== here) {
          state.where = here;
          // Saved, not just assigned.
          //
          // This is the whole bug. `state` is read back off the actor at the
          // top of every tick, so a field written to the local copy and not
          // passed to setChargen is gone three seconds later. state.where was
          // therefore undefined on every single tick, the comparison above it
          // never had a baseline to compare against, live was never true, and
          // liveSince was never set.
          //
          // Everything after this point is gated on liveSince: the movement
          // path, the two minute nudge that reopens the race menu, and the
          // five minute give up that starts you anyway. All three were dead.
          // Nobody was ever going to leave that room, on any timescale, and
          // the log could not say so because the code that would have logged
          // it was behind the same gate.
          setChargen(actorId, state);
        }
      } catch (e) { }
      if (live && !state.liveSince) {
        state.liveSince = now;
        setChargen(actorId, state);
        log('chargen', actorId.toString(16), 'is on their feet');
      }

      // Changed, not merely present. See faceMark above.
      //
      // And a change here is exact, not a guess. SendInputsService.sendAppearance
      // is the only thing in the client that ever sends one:
      //
      //     var shown = this.sp.Ui.isMenuOpen('RaceSex Menu');
      //     if (shown != this.isRaceSexMenuShown) {
      //       this.isRaceSexMenuShown = shown;
      //       if (!shown) { ...send... }
      //     }
      //
      // One transition, open to closed, nothing else anywhere. So once the menu
      // has been asked for, the next appearance to arrive IS the finished face,
      // whether it took eight seconds or eight minutes.
      //
      // There was a twelve second window here that ignored early changes,
      // added because creation once flashed up and teleported instantly. That
      // was the wrong cure for the right symptom: the real cause was this
      // function teleporting somebody while their race menu was open, which
      // closed the menu, which made the client send the unfinished face. The
      // teleport happens before the menu is asked for now, so there is nothing
      // left to ignore, and ignoring things cost somebody who finished quickly
      // their exit from the hall: the window kept moving the mark forward, so
      // the face they had just made became the face they started with.
      const faceNow = faceMark(appearance);
      const faceIsNew = !!appearance && faceNow !== (state.faceWas || '');

      if (faceIsNew) {
        beginChoosing(actorId, state, 'the face arrived');
        continue;
      }

      // The plugin says the race menu closed (/face done, over the chat
      // socket). That is the fact the mark above is only a proxy for: a face
      // confirmed unchanged, or a name kept, changes no mark. The menu
      // closing is enough only when a face was actually stored. A close
      // without a store is how 598737699 left the hall as a placeholder.
      if (state.faceDone) {
        if (hasStoredAppearance(appearance)) {
          beginChoosing(actorId, state, 'the race menu closed');
        } else {
          log('chargen', actorId.toString(16),
              'the plugin says the race menu closed but no appearance is stored, staying unpublished');
          askForLostRaceMenu('race menu closed with no face');
        }
        continue;
      }

      // Walking used to end creation, whatever the appearance said. That is
      // the 3 Oct 2026 session: half a second on their feet, no face stored,
      // neighbours given an actor with no base and no mesh. Walking is still
      // the sign that no race menu is open, so it is when a missing face
      // should be asked for again, not when they are published.
      const onFeetFor = state.liveSince ? (now - state.liveSince) : 0;

      if (onFeetFor > MOVED_ENOUGH_MS) {
        if (hasStoredAppearance(appearance)) {
          log('chargen', actorId.toString(16), 'walking after',
              Math.round(onFeetFor / 1000) + 's with a face stored.',
              'mark now', JSON.stringify(faceNow) + ',',
              'mark at the start', JSON.stringify(state.faceWas || '') + '.',
              'Going on.');
          beginChoosing(actorId, state, 'on their feet');
          continue;
        }
        log('chargen', actorId.toString(16), 'walking after',
            Math.round(onFeetFor / 1000) + 's and no appearance is stored.',
            'appearance is', appearance ? 'present' : 'MISSING,',
            'mark now', JSON.stringify(faceNow) + ',',
            'mark at the start', JSON.stringify(state.faceWas || '') + '.',
            'Staying unpublished.');
        askForLostRaceMenu('walking with no face');
        continue;
      }

      // Nobody is ever left standing in the hall with nothing to do.
      //
      // This step waits for an appearance to turn up on the change form,
      // because the race menu closing is not an event. That is fine right up
      // until the race menu never opens, and then it waits forever: no menu,
      // no writs, no way forward, and a room with a person in it. Spawn is
      // supposed to open it on both of its branches, and when it does not the
      // reason is somewhere in a client mid save-load, which is not somewhere
      // this can reach.
      //
      // So: keep asking on NUDGE_MS while the request is lost. A character
      // who never saw the race menu is asked again; one whose plugin says
      // the menu is already up is not.
      //
      // But only once it is clear that nobody is standing in a menu already.
      //
      // Spawn opens the race menu itself for every character it creates:
      //
      //     actorId = ctx.svr.createActor(...);
      //     ctx.svr.setRaceMenuOpen(actorId, true);
      //
      // so asking for it here as a matter of course was asking for a second
      // one. Which is what it did: a face was made, done was pressed, and the
      // menu opened again. Then the game went down with an access violation
      // trying to execute freed memory inside
      // NativeFunction1<TESNPC, BGSHeadPart*, unsigned long>, which is a head
      // part call on a character whose last race menu had already been torn
      // down. The second menu and the crash were the same thing.
      //
      // So this is a rescue and nothing else, and it only fires for somebody
      // who is demonstrably on their feet with no face, which is exactly the
      // case it was written for.
      const waited = now - (state.liveSince || state.askedAt || state.at || now);

      /*
        THE GUARD BELOW USED TO COVER BOTH RESCUES AND IT MADE NEITHER OF THEM
        REACHABLE BY THE PEOPLE THEY WERE WRITTEN FOR.

        It read `if (!state.liveSince) { continue; }` and sat above both, so
        everything from here down needed somebody to be MOVING. liveSince is
        only set when the server watches a character turn or walk. Somebody
        stuck at the character menu, on a load screen, or inside a race menu
        that will not close is by definition not moving, so the continue fired
        on every tick for ever and the two rescues below never ran once.

        MEASURED IN THE LIVE SERVER LOG, 21 September, four sessions and the
        same shape every time:

          13:35:33  chargen ff000056 profile 933578397 is new, in the hall
          13:35:33  chargen ff000056 -> appearance (already in the hall)
          13:41:55  disconnect 2

        Six minutes and twenty two seconds, nothing in between. The five minute
        give up should have fired at 13:40:33 and could not. A playtester
        described the same evening from the other side: "when I choose to make
        a new character it instead chooses to stay inside of the menu rather
        then taking me to the character creation".

        The comment over the nudge says "Nobody is ever left standing in the
        hall with nothing to do", and the guard was what made that untrue.

        WHY IT WAS THERE, because it is not wrong about everything. The NUDGE
        opens a race menu, and opening a second one while the first is still up
        took the game down with an access violation in a head part call. That
        is real, and liveSince is a decent proxy for 'no menu is open right
        now', so the nudge keeps the guard.

        THE GIVE UP OPENS NOTHING. It writes the state and moves on to the
        choices. There is no second menu to collide with and no reason it ever
        needed to know whether somebody was walking about. It is the only way
        out for a character who cannot move, which is precisely the character
        it exists for, so it runs on the clock like it says it does.

        THE TWO-MINUTE CLOCK IS NOW THE INTERVAL, not a one-shot. A lost
        request (no /racemenu report, no stored face) is asked again every
        NUDGE_MS. Walking asks on that same helper as soon as they are on
        their feet; standing still becomes eligible at NUDGE_MS. state.nudged
        is no longer the gate, so the old one-shot cannot swallow a later ask.
      */

      if (waited > GIVEUP_MS) {
        // Not while the race menu is still open. /face done and /racedown
        // are the closes, not a quiet report. FACE_CAP_MS is the
        // wedged-menu exception. A stored face is checked first so a
        // quiet stream cannot hold a finished face in the hall.
        const menuUp = raceMenuIsUp();
        const menuFor = state.faceOpenAt ? now - state.faceOpenAt : 0;
        if (hasStoredAppearance(appearance)) {
          if (menuUp) {
            log('chargen', actorId.toString(16), 'the race menu has been up for',
                Math.round(menuFor / 60000), 'minutes, face is stored, going on');
          }
          log('chargen', actorId.toString(16),
              'a face is stored after', Math.round(waited / 1000) + 's,',
              'going on to the choices');
          beginChoosing(actorId, state, 'face stored after ' + Math.round(waited / 1000) + 's');
          continue;
        }
        if (menuUp && menuFor < FACE_CAP_MS) {
          if (!state.faceHeld) {
            state.faceHeld = now;
            setChargen(actorId, state);
            log('chargen', actorId.toString(16), 'no face after',
                Math.round(waited / 1000) + 's, but the race menu is still up,',
                'so the give up waits for it, for at most',
                Math.round(FACE_CAP_MS / 60000), 'minutes');
          }
          continue;
        }
        if (menuUp) {
          log('chargen', actorId.toString(16), 'the race menu has been up for',
              Math.round(menuFor / 60000),
              'minutes, still no appearance stored, staying unpublished');
          continue;
        }
        log('chargen', actorId.toString(16),
            'appearance never arrived after', Math.round(waited / 1000) + 's,',
            'staying unpublished');
      }

      // Lost request: no face, and the menu is not up. Walking already
      // asked and continued. Standing still waits for NUDGE_MS so the
      // spawn request has time to land, then the helper repeats every
      // NUDGE_MS. A quiet stream after a report is still open. /racedown
      // has already cleared the open marks.
      if (!hasStoredAppearance(appearance) && waited > NUDGE_MS) {
        askForLostRaceMenu('no face after ' + Math.round(waited / 1000) + 's');
      }
    }
  }

  /*
    The starting purse, last, and the lastness is the point.

    It is here rather than in a loop of its own because this is the one pass
    that already walks everybody online. It costs a property read per person
    per tick and answers no on all but the first, and the reasoning for the
    forty is written out over purse() in the spoils block.

    IT USED TO RUN ABOVE THE LOOP AND THAT BROKE CREATION FOR EVERYBODY. The
    decision a hundred lines up asks whether somebody has played by looking in
    their pack. Handing a brand new character forty gold first put a thing in
    that pack, so they were read as a character who had already finished, had
    creation skipped and had their race menu closed, all on the first tick they
    were ever seen. Nothing in the log said anything was wrong; it said they
    already had a character, which is what it was written to say.

    So it goes after every decision that reads a pack. The count above also
    ignores gold now, so this being in the wrong place again would not be
    enough on its own to break it a second time.

    It stays outside the chargen state machine on purpose: a character who
    finished creation months ago still needs it, because the world they are
    standing in no longer has a coin in it.
  */
  const spoilsBlock = globalThis.__thornswoodSpoils;
  if (spoilsBlock && spoilsBlock.purse) {
    for (const who of online) {
      try { spoilsBlock.purse(who); } catch (e) { /* said in the spoils log */ }
    }
  }
}

function startChargenTimer() {
  if (!CHARGEN_ENABLED) {
    log('character creation is Skyrim Unbound\'s. The server is staying out of it.');
    return;
  }

  // Hot reload runs this file again in a fresh module, but the Node process and
  // its timers survive. Without this the ticks stack up one per save.
  const g = globalThis;
  if (g.__thornswoodChargenTimer) {
    clearInterval(g.__thornswoodChargenTimer);
  }
  g.__thornswoodChargenTimer = setInterval(guard('chargenTick', chargenTick),
                                           CHARGEN_TICK_MS);
}

