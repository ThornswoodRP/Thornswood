// ---------------------------------------------------------------------------
// gathering stations
// ---------------------------------------------------------------------------

/*
  EVERY ORE SEAM IN THE LOAD ORDER, AND IT IS GENERATED.

  Everything between the declaration below and the line that closes the block
  is written by tools\Build-OreTable.ps1, out of the ACTI and FURN records
  carrying MineOreScript that also built tools\ores.json: 581 veins across 101
  plugins, counted on 20 September. DO NOT HAND EDIT IT. The next run of that
  script replaces every line between them, and a correction made here goes with
  it and leaves no trace that it was ever made. Same arrangement as
  CROPS_BY_BASE and SPELL_IDS further down, for the same reason.

  It is seeded empty and the script fills it. A row says what the record says
  and nothing else:

    ore     the MISC record the vein's MineOreScript points its Ore property
            at, which is what comes away in somebody's hands.
    name    what that ore is called, so a refusal and a yield can both say it.
    rank    the Miner rank the seam asks for, which is the ore's value in gold
            against the bands at the top of ores.json: up to 14 novice, up to
            29 advanced, up to 59 expert, anything above that master.
    yield   FOUR PAIRS, novice first, each the least and the most that rank
            takes away. A pair of zeroes is a rank that cannot work that seam
            at all, which is how mineOre refuses without a second table of
            thresholds standing beside this one to disagree with it. Measured
            across all 581 rows on 20 September: the first pair that is not
            zero and zero sits at exactly the rank named beside it, every time.
*/
  var ORES_BY_BASE = table('ORES_BY_BASE');

/*
  The four ranks in order, for the code that runs above the progression block.

  That block keeps its own copy in RANKS and this is not a second opinion: the
  file loads top to bottom, the stations are read hundreds of lines before the
  block registers itself on globalThis, and a station cannot borrow a name that
  does not exist yet. The two spellings have to agree or a seam gates on a rank
  nobody can hold, so the mining harness reads both out of this file and checks
  them word for word rather than leaving it to whoever edits one of them.
*/
const RANK_LADDER = ['novice', 'advanced', 'expert', 'master'];

const COOLDOWN_MS = 20000;

/*
  A SEAM HAS NO WAIT OF ITS OWN HERE. MINE_COOLDOWN_MS, until #1413, refused
  the person who struck a seam for ten minutes to four hours by its rank, kept
  per character in lastUse. #1413 put the seams on a deposit instead,
  twenty in a seam and one a swing, back for everybody at once on Patrick's
  clock (miner.md, and the comment in mineOre), and nothing read the table after
  that. It came out in #1831.
*/

const lastUse = new Map();   // "actorId:refrId" -> timestamp

/*
  WHAT TAKES A ROW BACK OUT OF lastUse.

  From the To Do List: "Any cache keyed by something unbounded gets an eviction
  rule: a size cap, an age sweep, or removal when the session ends." Every press
  that gives something adds a row here, one per character and per reference:
  the quarry, the kiln, every plant, every churn, nest, hive and cow. Nothing
  ever took one out, so the map was bounded only by how long the server had
  been up. Measured on 24 September: about 140 bytes a row.

  The rivers, the hanging game and the carcasses kept their rows here until
  #1413. Since then they wait on the shared resource stock, on the record and
  for everybody (createSharedResourceStock), and the seams are deposits, so no
  row here is asked about against the seams' old waits or the fish, game or
  hunt tables any more (#1641, #1831).

  A row older than the longest wait anybody asks about gives the answer a
  missing row gives, which is ready, because cooldownLeft reads a missing row
  as a stamp at time zero. So dropping those rows changes no answer anybody
  gets, and that is the whole rule. It is not removal when somebody leaves: a
  ten minute wait on a picked plant has to outlast logging out and back.

  The longest wait is read off the constants rather than typed here. A number
  typed here that ever fell below one of them would hand a source back early.
  A new wait that stamps this map goes in longestWaitMs, and
  test-cooldown-sweep.js fails until it does. A table that no row here is read
  against stays out of it, or rows are kept for hours nothing asks about.

  The sweep runs when a stamp takes the map past a mark, not on a timer. A
  stamp is the only way a row gets in, so this bounds the map without another
  interval to lose on a hot reload. After a sweep the mark moves to twice what
  is left, so a map full of rows that are all still waiting is walked once per
  doubling rather than on every press.
*/
const LAST_USE_SWEEP_FROM = 5000;
let lastUseSweepAt = LAST_USE_SWEEP_FROM;

function longestWaitMs() {
  return Math.max(COOLDOWN_MS, HARVEST_COOLDOWN_MS);
}

/** Drops every row older than the longest wait, and moves the mark. */
function forgetOldUses(now) {
  const keep = longestWaitMs();
  lastUse.forEach(function (at, key) {
    if (now - at > keep) lastUse.delete(key);
  });
  lastUseSweepAt = Math.max(LAST_USE_SWEEP_FROM, lastUse.size * 2);
}

/** Seconds still to wait, 0 if ready. Read only: a refused action must not
 *  start a cooldown, or walking up to a kiln without firewood locks you out.
 *  spanMs is how long this source stays worked out and defaults to the twenty
 *  seconds the stations use, because the quarry and the kiln were the only two
 *  callers when this was written. */
function cooldownLeft(actorId, refrId, spanMs) {
  const span = spanMs || COOLDOWN_MS;
  const prev = lastUse.get(actorId + ':' + refrId) || 0;
  const left = span - (Date.now() - prev);
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** Start the cooldown. Call this only once the yield has actually been given.
 *  Every row goes in through here, so the sweep above sees every one. */
function stampCooldown(actorId, refrId) {
  const now = Date.now();
  lastUse.set(actorId + ':' + refrId, now);
  if (lastUse.size >= lastUseSweepAt) {
    try { forgetOldUses(now); } catch (e) { lastUseSweepAt = lastUse.size * 2; }
  }
}

/**
 * A wait said the way a person says one.
 *
 * cooldownLeft answers in seconds and the quarry can say '14 more seconds'
 * because its wait is twenty. A master seam is four hours and '14400 more
 * seconds' is not a sentence anybody reads. Whole units, and the smaller one
 * only when it is not zero, which is the shape the farming block already says
 * a grow time in.
 */
function waitWord(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return s + (s === 1 ? ' second' : ' seconds');
  const m = Math.ceil(s / 60);
  if (m < 60) return m + (m === 1 ? ' minute' : ' minutes');
  const h = Math.floor(m / 60);
  const rest = m - h * 60;
  const said = h + (h === 1 ? ' hour' : ' hours');
  if (rest === 0) return said;
  return said + ' and ' + rest + (rest === 1 ? ' minute' : ' minutes');
}

/*
  ENTRIES THE SERVER MADE INTO SOMETHING ELSE ARE NOT THE PLAIN ITEM (#2675).

  A hair dye is a Bowl entry with the dye's name on it: one record, and the
  entry says which dye, the way a deed says which house. Anything that reads
  the record alone (addItem stacking onto the first entry of it, takeItem
  taking from the first, a merchant counting and taking what you carry) would
  take a dye for a plain bowl and a plain bowl for a dye. So each block that
  makes such entries registers a test here, by its own name so a reload
  replaces it, and every one of those readers asks mintedEntry and leaves a
  made entry alone. An entry nobody registered is plain, exactly as before:
  a piece's condition in its name (#1719) is still the piece.
*/
function mintedBy(owner, test) {
  if (!globalThis.__thornswoodMinted || typeof globalThis.__thornswoodMinted !== 'object') {
    globalThis.__thornswoodMinted = {};
  }
  globalThis.__thornswoodMinted[owner] = test;
}

function mintedEntry(entry) {
  // Inherited NPC gear is owned for combat, not an ordinary stock/reward
  // stack. Explicit grants of the same item must remain separate from it.
  if (entry && entry.npcEquipment === true) { return true; }
  const tests = globalThis.__thornswoodMinted;
  if (!entry || !tests || typeof tests !== 'object') { return false; }
  for (const owner of Object.keys(tests)) {
    if (typeof tests[owner] !== 'function') { continue; }
    try { if (tests[owner](entry)) { return true; } }
    catch (e) { log('minted', owner + '\'s test threw on an entry, so it does not count as theirs:', e); }
  }
  return false;
}

function addItem(actorId, itemDesc, count) {
  const baseId = idOf(itemDesc);
  if (!baseId) return false;
  const inv = mp.get(actorId, 'inventory') || { entries: [] };
  const entries = inv.entries || [];
  let found = false;
  for (const e of entries) {
    if (e.baseId === baseId && !mintedEntry(e)) { e.count += count; found = true; break; }
  }
  if (!found) entries.push({ baseId: baseId, count: count });
  mp.set(actorId, 'inventory', { entries: entries });
  return true;
}

function withinResourceReach(actorId,refrId) {
  try {
    const actor=mp.get(actorId,'locationalData'),source=mp.get(refrId,'locationalData');
    return actor && source && actor.cellOrWorldDesc===source.cellOrWorldDesc &&
      Math.hypot(...actor.pos.map((v,i)=>v-source.pos[i]))<=400;
  } catch(error) { return false; }
}

function addItemsAtomic(actorId,goods) {
  const resolved=goods.map(g=>({baseId:idOf(g.item),count:g.count}));
  if(resolved.some(g=>!g.baseId || !Number.isSafeInteger(g.count) || g.count<=0)) return false;
  const inventory=mp.get(actorId,'inventory');
  if(!inventory || !Array.isArray(inventory.entries)) throw new Error('Inventory unavailable');
  const entries=inventory.entries.map(entry=>({...entry}));
  for(const good of resolved) {
    const existing=entries.find(entry=>entry.baseId===good.baseId && !mintedEntry(entry));
    if(existing) {
      if(!Number.isSafeInteger(existing.count+good.count) || existing.count+good.count>0xffffffff)
        throw new Error('Inventory count overflow');
      existing.count+=good.count;
    } else entries.push(good);
  }
  mp.set(actorId,'inventory',{entries});
  return true;
}

/*
  WHICH RUN OF THE SERVER THIS IS (#2623). Made once per server process and
  kept on globalThis, which a gamemode reload keeps (the NPC startup below
  finds the previous controllers there), so a reload is the same run and a
  restart is a new one. A temporary spawn carries the run it was made in.
*/
function serverRunId() {
  if (typeof globalThis.__thornswoodServerRun !== 'string' || !globalThis.__thornswoodServerRun) {
    globalThis.__thornswoodServerRun = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  return globalThis.__thornswoodServerRun;
}

/*
  WHETHER AN ACTOR IS A SPAWN NOBODY KEPT (#2623), read off the actor's own
  marker rather than the NPC population's table, because that table is empty
  for the few seconds after a gamemode reload until discovery runs, and a
  temporary spawn that died then would otherwise stand up again. Any run, not
  only this one: a temporary spawn is removed whenever it dies. Only the
  marker as it is written now, { run, keep }, is read (#3265).
*/
function isTemporarySpawn(actorId) {
  let marker = null;
  try { marker = mp.get(actorId, 'thornswoodNpcCommanded'); } catch (e) { return false; }
  return !!marker && typeof marker === 'object' && marker.keep !== true && typeof marker.run === 'string';
}

/*
  TAKES A TEMPORARY SPAWNED CREATURE OUT OF THE WORLD FOR GOOD (#2623).

  Three steps, in this order, each for a reason read out of the engine (the
  fork at the commit engine\skymp pins):
  - ObjectReference.Delete marks its saved record deleted
    (MpObjectReference::Delete sets isDeleted and takes it off the grid), and
    a record marked deleted is skipped when the server loads the world
    (PartOne's load, "Skipping deleted form"), so it does not come back at a
    restart.
  - destroyActor takes it out of the server's memory (WorldState::DestroyForm).
    The respawn timer a death starts holds only a weak reference to the actor
    (MpActor::RespawnWithDelay, lifetime.lock()), so once it is destroyed that
    timer finds nothing and nothing stands up again.
  - The habitat count and the shared NPC runtime let go of its id, so nothing
    is left waiting on an actor that is gone.
  Never called inside the engine's death event: DeathEvent::OnFireSuccess
  starts the respawn timer on the actor after every listener has run, so
  mp.onDeath asks for this on the next turn of the event loop, after the event
  is over.
*/
function removeSpawned(actorId) {
  try {
    const population = globalThis.__thornswoodNpcPopulation;
    if (population && population.release) population.release(actorId);
  } catch (e) { log('removeSpawned', actorId.toString(16), 'could not release its habitat slot:', e); }
  try {
    const runtime = globalThis.__thornswoodNpcRuntime;
    if (runtime && runtime.forget) runtime.forget(actorId);
  } catch (e) { log('removeSpawned', actorId.toString(16), 'could not leave the NPC runtime:', e); }
  try {
    mp.callPapyrusFunction('method', 'ObjectReference', 'Delete',
      { type: 'form', desc: mp.getDescFromId(actorId) }, []);
  } catch (e) { log('removeSpawned', actorId.toString(16), 'could not mark its record deleted:', e); }
  try {
    mp.destroyActor(actorId);
  } catch (e) { log('removeSpawned', actorId.toString(16), 'could not destroy it:', e); return false; }
  log('removeSpawned', actorId.toString(16), 'a temporary spawn is gone');
  return true;
}

/*
  Puts count new actors of the NPC record baseId away units out from where
  ({ desc, pos, rot }): one straight ahead of the way they face (rot[2], in
  degrees), several spread round them. Returns { made, why }. Shared by /spawn
  and the staff block's /spawnat (#959).

  mp.place and not mp.createActor. createActor's first argument is the form
  id the NEW actor gets, not the record to build it from (PartOne::CreateActor),
  so it made a bare actor with no base under the troll record's own id, and
  nothing appeared. mp.place builds an actor from the record, at the middle of
  Tamriel, and the locationalData set moves it here, the way PlaceAtMe does.
  Anything that is not an NPC record is refused before it is placed, since a
  placed object cannot be moved and would stay at the middle of Tamriel.

  A fifth argument, commanded, is true for tester and staff spawn commands.
  The private population marker exempts these actors from habitat capacity,
  while admission and native runtime enrollment still establish authority.

  A SPAWNED CREATURE IS TEMPORARY UNLESS STAFF KEEP IT (#2623). Djinn, 17
  October, after wolves and a vampire he spawned in The Winking Skeever for a
  test were still there days later and attacked a new character: "A creature
  spawned by a staff member should never be made permanent unless we want to
  make it permanent." The marker used to be plain true, and the population
  gave every commanded actor a saved home and a spawn point there, so it came
  back to that spot after every death and every restart, for good. Now the
  marker says which: { keep: true } for a creature staff asked to keep (the
  word keep on the command), or { run } naming this run of the server for a
  temporary one. A temporary one is removed when it dies (removeSpawned, from
  mp.onDeath) and, if it is still standing, when the server next starts
  (createNpcPopulation sees a run that is not this one). A spawn from before
  this change carries plain true, which nobody chose to keep, so it is
  removed the first time the gamemode loads with this code, a deploy
  included, not only at a restart. The sixth argument, keep, is the staff's
  choice.
*/
function placeActors(baseId, where, count, away, commanded, keep) {
  const run = serverRunId();
  let rec = null;
  try { rec = (mp.lookupEspmRecordById(baseId) || {}).record || null; } catch (e) { rec = null; }
  if (rec && rec.type && rec.type !== 'NPC_') {
    return { made: 0, why: 'that record is a ' + rec.type + ', not a creature or a person' };
  }
  const facing = Number(where.rot && where.rot[2]) || 0;
  let made = 0, why = '';
  for (let s = 0; s < count; s++) {
    // Skyrim's heading: 0 is north (+y), 90 is east (+x).
    const ang = (facing / 180) * Math.PI + (s / Math.max(1, count)) * Math.PI * 2;
    let ref = 0;
    try {
      ref = mp.place(baseId);
      mp.set(ref, 'locationalData', {
        cellOrWorldDesc: where.desc,
        pos: [where.pos[0] + Math.sin(ang) * away, where.pos[1] + Math.cos(ang) * away, where.pos[2]],
        // Turned to face the person who asked for it.
        rot: [0, 0, (facing + 180) % 360]
      });
      // Persist the exemption before admission: the five-second discovery
      // pass and a later gamemode reload must recognize the same command.
      const population=globalThis.__thornswoodNpcPopulation;
      if(commanded && population) mp.set(ref,'thornswoodNpcCommanded',keep ? {keep:true} : {run:run});
      if(population && !population.admit(ref,mp.getNpcAIState(ref))) {
        throw new Error('This species has no available population slot in this habitat');
      }
      if(globalThis.__thornswoodNpcRuntime) globalThis.__thornswoodNpcRuntime.enroll(ref);
      made++;
    } catch (e) {
      why = String(e && e.message ? e.message : e);
      // Placed but not moved: it would stand at the middle of Tamriel.
      if (ref) {
        try { mp.destroyActor(ref); } catch (e2) { }
        try {
          if(globalThis.__thornswoodNpcPopulation) globalThis.__thornswoodNpcPopulation.release(ref);
        } catch(e3) { }
      }
      break;
    }
  }
  return { made: made, why: why };
}

function takeItem(actorId, itemDesc, count) {
  const baseId = idOf(itemDesc);
  if (!baseId) return false;
  const inv = mp.get(actorId, 'inventory') || { entries: [] };
  const entries = inv.entries || [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].baseId !== baseId || mintedEntry(entries[i])) continue;
    if (entries[i].count < count) return false;
    entries[i].count -= count;
    if (entries[i].count <= 0) entries.splice(i, 1);
    mp.set(actorId, 'inventory', { entries: entries });
    return true;
  }
  return false;
}

/*
  The same as takeItem, by form id rather than by descriptor.

  wearTool already knows the id of the tool in the pack, because it had to find
  out which of six pickaxes somebody is carrying. Turning that back into a
  descriptor to hand to takeItem would be a round trip through
  mp.getDescFromId for no reason, and one that can throw.
*/
function takeItemById(actorId, baseId, count) {
  if (!baseId) { return false; }
  let inv = null;
  try {
    inv = mp.get(actorId, 'inventory');
  } catch (e) {
    return false;
  }
  const entries = (inv && inv.entries) || [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].baseId !== baseId || mintedEntry(entries[i])) { continue; }
    if (entries[i].count < count) { return false; }
    entries[i].count -= count;
    if (entries[i].count <= 0) { entries.splice(i, 1); }
    mp.set(actorId, 'inventory', { entries: entries });
    return true;
  }
  return false;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

