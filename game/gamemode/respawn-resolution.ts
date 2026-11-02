// ---------------------------------------------------------------------------
// respawn resolution
//
// Port of respawnResolver.ts. Same five branches, same order. See
// game\data\data.json for where the numbers come from; never hand-edit them.
// (Older comments named respawn-holds.json; that file never lived in this repo.)
// ---------------------------------------------------------------------------

function holdOfCell(cellDesc) {
  const h = DATA.cellToHold[cellDesc];
  return h || null;
}

function capitalPos(hold) {
  const c = DATA.capitals[hold];
  return c ? { x: c.pos[0], y: c.pos[1] } : null;
}

function nearestCapital(pos) {
  let best = null;
  let bestD = Infinity;
  for (const hold in DATA.capitals) {
    const c = DATA.capitals[hold];
    const d = dist2(c.pos[0], c.pos[1], pos.x, pos.y);
    if (d < bestD) { bestD = d; best = hold; }
  }
  return best;
}

/**
 * Nearest single consecrated entrance, weighing every temple and every Hall of
 * the Dead separately rather than picking a city first. Solstheim is excluded:
 * its coordinates are not in Tamriel's frame, so a distance to it is noise.
 */
function nearestEntrance(pos) {
  let best = null;
  let bestD = Infinity;
  for (const key in DATA.destinations) {
    const d = DATA.destinations[key];
    for (const slot in d) {
      const s = d[slot];
      if (!s.entrancePos) continue;
      if (s.entranceWorld && parseInt(s.entranceWorld, 16) === 0x02000800) continue;
      const dd = dist2(s.entrancePos[0], s.entrancePos[1], pos.x, pos.y);
      if (dd < bestD) { bestD = dd; best = { destination: key, slot: slot }; }
    }
  }
  return best;
}

/**
 * `via` is how the hold was decided, `reason` is which destination branch fired.
 * Keep both: "Hjaalmarch, found from the cell, then borrowed Solitude's hall"
 * is a different story from "Hjaalmarch, guessed from coordinates". The first
 * time someone dies in Morthal and wakes somewhere surprising, this is the line
 * you will read.
 */
function arrive(dest, hold, reason, slotOverride, via) {
  const d = DATA.destinations[dest];
  if (!d) return null;
  let slot = slotOverride;
  if (!slot) slot = d[PREFER_SLOT] ? PREFER_SLOT : Object.keys(d)[0];
  const s = d[slot];
  if (!s) return null;
  return {
    destination: dest,
    slot: slot,
    cell: s.cell,
    desc: s.desc,
    pos: s.pos,
    rot: s.rot,
    hold: hold,
    crimeFaction: hold && DATA.holds[hold] ? DATA.holds[hold].crimeFaction : null,
    reason: reason,
    via: via,
  };
}

/**
 * The places to wake in a worldspace with coordinates of its own, or
 * undefined for one laid out in Tamriel's coordinates (and for a room).
 * DATA.ownWorlds is read out of the load order by scripts\dev\Build-WakeTable.js
 * (#1909): every worldspace whose doors do not land beside the doors they lead
 * to in Tamriel's frame is a key, and its value is each hall of the dead,
 * temple and inn whose front door stands in it. Looked up whole and without
 * case, the way the Solstheim branch this replaced compared it.
 */
function ownWorldOf(desc) {
  if (!ownWorldOf.byDesc) {
    ownWorldOf.byDesc = {};
    const t = DATA.ownWorlds || {};
    for (const k in t) ownWorldOf.byDesc[k.toLowerCase()] = t[k];
  }
  return ownWorldOf.byDesc[String(desc || '').toLowerCase()];
}

/**
 * site: { desc: worldOrCellDesc string, pos: [x,y,z], cameIn: the
 *         CAME_IN_PROPERTY record, or nothing }
 */
function resolveArrival(site) {
  // 1. A worldspace with coordinates of its own: Solstheim, Blackreach, the
  //    Soul Cairn, Sovngarde, Apocrypha, the Forgotten Vale, the arena's
  //    floors. Its numbers mean nothing on the mainland's map, so it never
  //    reaches the capitals or the mainland's doors below (#1909). Until then
  //    only Solstheim was caught, and always woke in the Raven Rock temple;
  //    every other one got whichever hold its own numbers fell nearest, which
  //    for all 171 Soul Cairn spots was Whiterun.
  //
  //    Patrick, 5 Oct: it wakes the person in the nearest hall of the dead,
  //    temple or inn in that worldspace, measured door to door in its own
  //    coordinates. On Solstheim that is the Raven Rock temple or the
  //    Retching Netch. A worldspace with none of the three (every other one,
  //    measured 5 Oct) wakes where a death in the hold of the door they came
  //    in by would wake (Patrick, 5 Oct; see THE DOOR A PERSON CAME IN BY
  //    below), via came-in-by. Only a person with no door recorded into this
  //    worldspace, or none with a hold, wakes at the fallback temple, and the
  //    death log says which: own-world-no-door or own-world-no-hold.
  const own = ownWorldOf(site.desc);
  if (own) {
    let best = null;
    let bestD = Infinity;
    for (const w of own) {
      const d = dist2(w.door[0], w.door[1], site.pos[0], site.pos[1]);
      if (d < bestD) { bestD = d; best = w; }
    }
    if (!best) {
      const came = site.cameIn;
      const here = String(site.desc).toLowerCase();
      if (!came || !came.world || String(came.world).toLowerCase() !== here) {
        return arrive(FALLBACK_DESTINATION, null, 'fallback', null, 'own-world-no-door');
      }
      if (!came.hold) return arrive(FALLBACK_DESTINATION, null, 'fallback', null, 'own-world-no-hold');
      return holdWake(came.hold, capitalPos(came.hold) || { x: 0, y: 0 }, 'own-ground', 'came-in-by') ||
        arrive(FALLBACK_DESTINATION, came.hold, 'fallback', null, 'came-in-by');
    }
    return {
      destination: best.destination || '',
      slot: best.kind,
      cell: best.cell,
      desc: best.desc,
      pos: best.pos,
      rot: best.rot,
      hold: best.hold,
      crimeFaction: best.hold && DATA.holds[best.hold] ? DATA.holds[best.hold].crimeFaction : null,
      reason: 'own-ground',
      via: 'own-world',
    };
  }

  const outdoors = WORLDSPACES.has(site.desc);
  const pos = { x: site.pos[0], y: site.pos[1] };

  // 2. Died indoors: the cell names the hold outright.
  let hold = outdoors ? null : holdOfCell(site.desc);
  let via = hold ? 'cell' : null;
  let reason = 'own-ground';

  // 3. Died outdoors, in Tamriel's coordinates (step 1 took every other
  //    worldspace): nearest of the nine hold capitals. Resolving the HOLD
  //    first is what keeps the mapping in charge. Dawnstar proves it: Solitude
  //    is closer as the crow flies, but the Pale answers to Windhelm.
  if (!hold) {
    hold = nearestCapital(pos);
    via = outdoors ? 'nearest-capital' : 'unmapped-interior';
  }

  if (hold) {
    // 4. An interior's coordinates are local to that cell, so a borrowed door
    //    is measured from the hold's capital instead. See holdWake.
    const a = holdWake(hold, outdoors ? pos : (capitalPos(hold) || pos), reason, via);
    if (a) return a;
  }

  return arrive(FALLBACK_DESTINATION, hold, 'fallback', null, via);
}

/**
 * Where a death in this hold wakes: its own consecrated ground, or, for a
 * hold with none of its own (the Pale, Hjaalmarch, Winterhold, Falkreath), the
 * nearest temple or Hall of the Dead door to `from`, which must be a position
 * genuinely in Tamriel's frame. Null when neither answers.
 */
function holdWake(hold, from, reason, via) {
  const dest = DATA.holdToDestination[hold];
  if (dest) {
    const a = arrive(dest, hold, reason, null, via);
    if (a) return a;
  }
  const near = nearestEntrance(from);
  if (near) {
    const a = arrive(near.destination, hold, 'borrowed', near.slot, via);
    if (a) return a;
  }
  return null;
}

/*
  THE DOOR A PERSON CAME IN BY (#1909).

  Patrick, 5 Oct: a worldspace of its own with no hall of the dead, temple or
  inn (47 of the 48) wakes the person where a death in the hold of the door
  they came in by would wake: that hold's own death place, so the Pit under
  Windhelm wakes them in Windhelm's temple. Nothing in the gamemode recorded
  that door before: the property block keeps the last door touched in memory
  for /claim, for minutes, and nothing else keeps a door at all. So onActivate
  writes it here, on the character (CAME_IN_PROPERTY), which the server saves
  in the change form, so a relog or a restart keeps it.

  The record is { lastHold, world, hold, door }:
    lastHold  the last hold they pressed anything in: a room the load order
              maps to a hold, or a worldspace in Tamriel's coordinates by its
              nearest capital. A room it does not map (the Pit's waiting room)
              and a worldspace of its own leave it as it was.
    world     the worldspace of its own the door they came in by leads into,
              out of DATA.ownWorldDoors (Build-WakeTable.js);
    hold      the hold that door was pressed from: where they stood if that
              has a hold, the hold they came into that worldspace with if they
              stood in one of its own (Alftand's worldspace into Blackreach),
              else lastHold;
    door      that door's descriptor, for the log.
  The doors of a room whose only ways out lead into the same worldspace (the
  side rooms of Blackreach, Sovngarde's hall) are not in DATA.ownWorldDoors,
  so going in and out of one does not move the record.
*/
const CAME_IN_PROPERTY = 'thornswoodCameIn';

/** The hold a place answers to, or null: a room by DATA.cellToHold, a
 *  worldspace in Tamriel's coordinates by its nearest capital. */
function holdAt(place) {
  if (!place || !place.desc) return null;
  if (ownWorldOf(place.desc)) return null;
  if (WORLDSPACES.has(place.desc)) {
    const p = place.pos || [];
    return nearestCapital({ x: Number(p[0]) || 0, y: Number(p[1]) || 0 });
  }
  return holdOfCell(place.desc);
}

/** The record after pressing doorDesc while standing at place. Pure. */
function nextCameIn(rec, doorDesc, place) {
  const r = {
    lastHold: (rec && rec.lastHold) || null,
    world: (rec && rec.world) || '',
    hold: (rec && rec.hold) || null,
    door: (rec && rec.door) || '',
  };
  const here = holdAt(place);
  if (here) r.lastHold = here;
  const into = DATA.ownWorldDoors && DATA.ownWorldDoors[doorDesc];
  if (into) {
    const from = place && place.desc ? String(place.desc).toLowerCase() : '';
    const carried = r.world && r.world.toLowerCase() === from ? r.hold : null;
    r.world = into;
    r.hold = here || carried || r.lastHold;
    r.door = doorDesc;
  }
  return r;
}

/** The record on this character, or null when there is none to read. */
function cameInOf(actorId) {
  try {
    const r = mp.get(actorId, CAME_IN_PROPERTY);
    return r && typeof r === 'object' ? r : null;
  } catch (e) {
    return null;
  }
}

/**
 * Called from onActivate for every press a person makes: the door (or
 * anything) they pressed, where they stood. Writes only when the record
 * changes, so a press in the same hold as the last costs three reads.
 */
function noteCameIn(actorId, pressedDesc) {
  const place = { desc: mp.get(actorId, 'worldOrCellDesc'), pos: mp.get(actorId, 'pos') };
  const was = cameInOf(actorId);
  const now = nextCameIn(was, pressedDesc, place);
  if (JSON.stringify(now) === JSON.stringify(was)) return;
  mp.set(actorId, CAME_IN_PROPERTY, now);
  if (now.door !== ((was && was.door) || '')) {
    log('came in', actorId.toString(16), 'to', now.world, 'by', now.door, 'from', place.desc, 'hold=' + now.hold);
  }
}

function ensureProperties() {
  try {
    // Seen by its owner, the same as the character property the K panel
    // reads: an old trade left here by migrate() is still on their screen
    // (issue #509). Neighbours see nothing. makeProperty cannot change a
    // property already made, so this takes a real restart, not a hot reload.
    mp.makeProperty(CHARGEN_PROPERTY, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: '',
      updateNeighbor: '',
    });
    // How much work each tool in the pack has done (wearTool). Nothing on the
    // client reads it and nobody standing next to you has any business knowing
    // it, so it is invisible to both.
    mp.makeProperty(TOOL_PROPERTY, {
      isVisibleByOwner: false,
      isVisibleByNeighbors: false,
      updateOwner: '',
      updateNeighbor: '',
    });
    // The door a person came in by (#1909, see nextCameIn). Only the death
    // code on the server reads it, so it is invisible to both.
    mp.makeProperty(CAME_IN_PROPERTY, {
      isVisibleByOwner: false,
      isVisibleByNeighbors: false,
      updateOwner: '',
      updateNeighbor: '',
    });
    /*
      HOW MUCH IS LEFT IN A SEAM, AND WHY THIS LINE IS THE WHOLE OF THE DEFECT.

      Patrick, 21 September: "the quearry was infinite or close to it just got
      100 ore in one vein vs the 20 it's supposed to be".

      DEPOSIT_PROPERTY was the only property in this file never registered.
      Every read of an unregistered property throws, depositLeft catches it and
      answers DEPOSIT_SIZE, and mp.set throws too, so nothing was ever written:
      every swing read a full seam, took one out of it, failed to record that,
      and read a full seam again. A seam with no bottom.

      The fail-open in depositLeft is still right and stays: a seam the server
      cannot read should be workable rather than dead, because failing shut
      there takes every seam in the province out of the game at once. What was
      wrong is that the unreadable case was ALL of them, every time, and
      nothing said so. takeFromDeposit now logs a failed write once per seam,
      so this cannot be silent again.

      Invisible to both: how worked out a seam is is not something the client
      needs and not something a neighbour has any business being told.
    */
    mp.makeProperty(DEPOSIT_PROPERTY, {
      isVisibleByOwner: false,
      isVisibleByNeighbors: false,
      updateOwner: '',
      updateNeighbor: '',
    });
    /*
      THE SWING, AND WHY THE SERVER HAS TO ASK FOR IT.

      Patrick, 21 September: "Mining is still skipping the animation".

      Nothing is skipping it. It never played. A vanilla ore vein is an ACTI
      whose animation comes from MineOreScript, and no Papyrus object script
      runs under SkyMP at all, which is the same reason the Whiterun gate stays
      locked and the same reason the client has to re-activate levers. Letting
      the press through, which is what ALLOW does, hands it to an engine whose
      script will not start. There was never anything there to skip.

      So the server asks the person's own client to play it, through the one
      channel that already exists for this: updateOwner, the same mechanism the
      door locks use. ctx.sp is Skyrim Platform on their machine.

      THE EVENT NAMES ARE READ OUT OF Skyrim.esm, not guessed. IdlePickaxeEnter
      is the event on IDLE a82c6 under PickaxeRoot, and IdleWoodChopStart is
      the event on IDLE 6c1df under WoodChopRoot. Both exit through
      IdleChairExitStart, which is what every one of those records names as its
      exit, however odd it reads.

      Visible to the owner and to nobody else. A neighbour sees the animation
      because Skyrim is playing it on a body they can see, not because they
      were sent anything.

      ===== updateOwner RUNS EVERY FRAME, NOT ON CHANGE, AND THAT IS THE TRAP.

      Patrick, 22 September: "you get stuck in the animation no way out even
      when tping, a fresh game load, trying to walk away, trying to escape menu
      anyuthing its trapped in that state", "it stops making the noise as its
      supposed", "the mining animation doesnt always use your pick and tehre
      are two".

      All four of those are one defect. Read in the client this server ships,
      skymp5-client/src/services/services/gamemodeUpdateService.ts: onUpdate is
      bound with `this.controller.on("update", ...)`, controller.on IS sp.on,
      and sp.on('update') is the PER FRAME event. onUpdate then walks every
      updateOwner property and calls its function with the value that is there,
      and there is no comparison against the value it used last time anywhere
      in that file. updateNeighbor diffs; updateOwner does not.

      So every comment in this file that says an updateOwner script runs "every
      time the property changes" is wrong, including the one this paragraph
      replaces. It runs sixty times a second for as long as the property holds
      any value that is not undefined.

      WHAT THAT DID TO MINING. One strike wrote the property, and from that
      frame on the client sent IdlePickaxeEnter to the person every frame,
      forever, and queued a 2.5 second exit every frame behind it. The idle
      restarted before it ever reached the annotation that plays the strike, so
      there was no noise and no pick in hand; Enter and the exits fought each
      other, which is the second animation; and the person was held in it
      because the next frame put them straight back. Walking away, a map
      marker, the escape menu and a fresh load all did nothing, because
      NOTHING EVER CLEARED THE PROPERTY: it is stored on the character, it is
      sent to the owner again on the next login, and the loop started over.

      TWO THINGS FIX IT AND BOTH ARE NEEDED. The script below is edge
      triggered on v.at, which only moves when swing() is called, so a value
      sitting unchanged costs one comparison a frame and plays nothing. And
      swing() clears the property once the swing is over, so a character can
      never carry one into the next session.

      AND THE EXIT IS TWO EVENTS NOW. IdleChairExitStart is what those IDLE
      records name, and it is a transition the behaviour graph only takes from
      the state it belongs to. IdleForceDefaultState is the graph's
      unconditional reset and is what actually gets somebody out from
      anywhere, so it goes behind the named exit rather than in place of it.
    */
    mp.makeProperty(SWING_PROPERTY, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: swingScript(),
      updateNeighbor: '',
    });
    // A plant that gave something, emptied on the presser's machine. See
    // PICKED_PROPERTY.
    mp.makeProperty(PICKED_PROPERTY, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: pickedScript(),
      updateNeighbor: '',
    });
    /*
      SOMETHING ON THE SCREEN, FOR THE THINGS PEOPLE MUST NOT MISS.

      Patrick, 22 September: "I need it to do an onscreen warninjg and not just
      in chat at one minute and at 30 seoconds before you get kciked from the
      server incase people miss the message in chat."

      He is right and the chat overlay is the wrong place for this. It is a
      small panel somebody may have scrolled, moved, or not be looking at, and
      the one message that must not be missed is the one that ends with being
      thrown out mid sentence.

      TWO PLACES AT ONCE, because neither is certain on its own. Debug
      .notification is Skyrim's own corner message and needs no browser at all,
      so it lands even if the overlay never mounted. The banner is a panel this
      script builds ITSELF in the overlay document, with no dependency on any
      page having exposed a function for it: a page from before this existed
      still shows it.

      EDGE TRIGGERED, like the swing above, and for the reason written out
      there: updateOwner runs EVERY FRAME. Without the stamp guard this would
      redraw a banner and fire a notification sixty times a second for as long
      as the property held a value, which is the exact fault that trapped
      people in the mining animation.
    */
    mp.makeProperty(ALERT_PROPERTY, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: false,
      updateOwner: alertScript(),
      updateNeighbor: '',
    });
  } catch (e) {
    // already made, or made by a previous load. harmless.
  }
}

