// ==== thornswood thalmor patrols ====
/*
  THE THALMOR PATROLS ARE STOOD UP HERE (#1390). docs/systems/thalmor.md,
  Patrols: 2 to 4 on a road between holds, never inside a walled city, at
  most 3 patrols in the province and one on a road; not people; no coin.

  WHAT STAFF DECIDE. game/data/thalmor-patrols.json: whether any patrol is
  out (on, false as shipped), the province cap (most), and for each road its
  points (one member each, 2 to 4), the record each member is made from, how
  long a dead one takes to come back and how far one strays. The three roads
  it ships with are the cut Immersive Patrols II Justiciar placements in the
  Pale, Haafingar and Hjaalmarch, at their own positions: candidates, all on,
  under the file's own on. thalmorPatrolTable (the NPC population policy)
  checks the file; nothing in code names a road, a number of members or a
  time.

  WHAT THIS DOES, ONCE AT START AND ON A GAMEMODE RELOAD, WITH NO TIMER. For
  each road that may stand, each point is a slot. The register, in the
  private folder and naming nobody, says which form fills each slot. A slot
  whose form is still there and still carries that road's marker and record
  is left alone, standing or dead: the engine brings a dead member back at
  its point after the road's return time (spawnDelay, set by the policy), so a
  return replaces it and never stacks a second group. A slot whose form is
  gone gets a new member: made from its record at its point, marked with
  {road, slot}, admitted by the population (which gives it the road's rule)
  and enrolled in the shared NPC runtime. Members of a road that is off, gone,
  over the cap or changed are taken out of the world (removeSpawned). Running
  it again changes nothing.

  WHAT IT NEVER DOES. With the file unreadable or the register unreadable it
  stands nobody up and takes nobody down, and writes nothing. It sets no
  timer, adds no command, and tells nobody to do anything: a patrol is a fight
  on the road for whoever meets it, and the people decide what comes of it.

  NOT PEOPLE, NO COIN. A member has no profile, so it does not wake in a
  temple, and killing one is a warrior's work as for a bandit. Nobody can open
  a body (the spoils block), and the dungeon body roll answers no key for a
  runtime reference, so a body gives no coin and nothing else.

  WALKING THE ROAD. The shared runtime keeps an NPC inside a leash around its
  home. A member's home is its own point on the road and the leash is the
  road's, so the group keeps to its stretch of road. A route between holds is
  not built.
*/
(function () {
  'use strict';
  var g = globalThis;
  var fs = require('fs');
  var path = require('path');
  var REGISTER = 'thalmor-patrol-slots.json';
  var HEX = /^[0-9a-f]{1,8}$/;

  function tlog() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[patrols]');
    console.log(a.join(' '));
  }

  function privateDir() {
    var dir = 'private';
    try {
      var cfg = mp.getServerSettings();
      if (cfg && cfg.privDir) { dir = String(cfg.privDir); }
    } catch (e) { }
    return dir;
  }

  /*
    THE WORLD STAGE, FOR THE PER-STAGE CAP (#2697). The one read of the world
    stage register (#2685): its worldStage().id and its stages(), nothing else.
    No register (not merged, or it failed to load), no worldStage or no id is
    no stage, and then the cap is the plain most. A register that is there
    and throws is not "no stage": the cap for the stage the world is at is not
    known, so, as for an unreadable slot register, no patrol is stood up or
    taken down (broken, below). Read once per start or reload, so a stage staff
    confirm takes effect the next time the gamemode loads.
  */
  function stageRegister() {
    var reg = g.__thornswoodWorldStage;
    return reg && typeof reg.worldStage === 'function' ? reg : null;
  }

  // { id: the stage id or null, broken: the error when the register threw }
  function currentStage(reg) {
    if (!reg) { return { id: null, broken: null }; }
    try {
      var st = reg.worldStage();
      return { id: st && typeof st.id === 'string' && st.id ? st.id : null, broken: null };
    } catch (e) {
      return { id: null, broken: String((e && e.message) || e) };
    }
  }

  // Each stageMost key the register does not list (a typo, or a stage taken
  // out of war-stages.json): logged, never refused. No register, or no list
  // from it, logs nothing.
  function unknownStageKeys(table, reg) {
    var keys = Object.keys(table.stageMost || {});
    if (!reg || typeof reg.stages !== 'function' || !keys.length) { return []; }
    var list;
    try { list = reg.stages(); } catch (e) { return []; }
    if (!Array.isArray(list)) { return []; }
    var known = {};
    list.forEach(function (s) { if (s && typeof s.id === 'string') { known[s.id] = true; } });
    return keys.filter(function (k) { return !Object.prototype.hasOwnProperty.call(known, k); });
  }

  // The staff's file, checked. null when it cannot be used at all.
  function readTable(stage) {
    var doc = null;
    try {
      // #2873: on a server the file is not beside this one; STAFF_DATA carries it.
      doc = typeof STAFF_DATA !== 'undefined' && STAFF_DATA['thalmor-patrols.json']
        ? JSON.parse(JSON.stringify(STAFF_DATA['thalmor-patrols.json']))
        : JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'thalmor-patrols.json'), 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      tlog('game/data/thalmor-patrols.json would not read, so no patrol is stood up or taken down:', e && e.message);
      return null;
    }
    try {
      return thalmorPatrolTable(doc, NPC_POPULATION_DATA.keep, stage.id);
    } catch (e2) {
      tlog(String(e2 && e2.message) + ', so no patrol is stood up or taken down');
      return null;
    }
  }

  // { roads: { <road>: { <slot>: <form id in hex> } } }. No file yet is an
  // empty register. A file that is there and will not read is null, and then
  // nothing is changed or written over.
  function readRegister() {
    var text = null;
    try {
      text = fs.readFileSync(path.join(privateDir(), REGISTER), 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') { return { version: 1, roads: {} }; }
      return null;
    }
    try {
      var doc = JSON.parse(String(text).replace(/^\uFEFF/, ''));
      if (!doc || doc.version !== 1 || !doc.roads || typeof doc.roads !== 'object' || Array.isArray(doc.roads)) { return null; }
      var clean = { version: 1, roads: {} };
      Object.keys(doc.roads).forEach(function (road) {
        var slots = doc.roads[road];
        if (!/^[a-z0-9-]{1,32}$/.test(road) || !slots || typeof slots !== 'object') { return; }
        var keep = {};
        Object.keys(slots).forEach(function (s) {
          if (/^[0-3]$/.test(s) && typeof slots[s] === 'string' && HEX.test(slots[s])) { keep[s] = slots[s]; }
        });
        clean.roads[road] = keep;
      });
      return clean;
    } catch (e2) {
      return null;
    }
  }

  function writeRegister(reg) {
    var dir = privateDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { }
    var file = path.join(dir, REGISTER);
    fs.writeFileSync(file + '.tmp', JSON.stringify(reg, null, 2) + '\n', 'utf8');
    fs.renameSync(file + '.tmp', file);
  }

  // The form is still there, still this road's slot, still made from the
  // record staff gave that point. A form id the engine reused for something
  // else carries no such marker.
  function holds(id, road, slot, base) {
    try {
      var mark = mp.get(id, 'thornswoodNpcPatrol');
      if (!mark || mark.road !== road || mark.slot !== slot) { return false; }
      if (base === undefined) { return true; }
      return mp.getIdFromDesc(String(mp.get(id, 'baseDesc'))) === mp.getIdFromDesc(base);
    } catch (e) {
      return false;
    }
  }

  function place(road, slot, population, runtime) {
    var ref = 0;
    try {
      ref = mp.place(mp.getIdFromDesc(road.bases[slot]));
      mp.set(ref, 'locationalData', {
        cellOrWorldDesc: THALMOR_PATROL_WORLD,
        pos: road.points[slot].slice(),
        rot: [0, 0, 0]
      });
      // Before admission, so the population and every later start read it.
      mp.set(ref, 'thornswoodNpcPatrol', { road: road.id, slot: slot });
      if (!population.admit(ref, mp.getNpcAIState(ref))) { throw new Error('the NPC population did not admit it'); }
      if (runtime && typeof runtime.enroll === 'function') { runtime.enroll(ref); }
      return ref;
    } catch (e) {
      tlog(road.id, 'slot', slot, 'could not be stood up:', e && e.message);
      if (ref) {
        try { mp.destroyActor(ref); } catch (e2) { }
        try { population.release(ref); } catch (e3) { }
      }
      return 0;
    }
  }

  function keepPatrols() {
    var worldReg = stageRegister();
    var stage = currentStage(worldReg);
    var table = readTable(stage);
    if (table && stage.broken !== null) {
      // The cap for this stage is not known. The population keeps what stands
      // (hold) and the keeper stands nobody up and takes nobody down.
      table.hold = true;
      g.__thornswoodThalmorPatrols = table;
      tlog('the world stage register failed (' + stage.broken + '), so no patrol is stood up or taken down');
      return;
    }
    g.__thornswoodThalmorPatrols = table;
    if (!table) { return; }
    table.refused.forEach(function (r) { tlog('road', r.id, r.why); });
    unknownStageKeys(table, worldReg).forEach(function (k) {
      tlog('stageMost names', k, 'but the world stage list has no such stage, so that cap is never used');
    });
    var population = g.__thornswoodNpcPopulation;
    var runtime = g.__thornswoodNpcRuntime;
    if (!population || typeof population.admit !== 'function') {
      tlog('no NPC population on this server, so no patrol is stood up or taken down');
      return;
    }
    var reg = readRegister();
    if (!reg) {
      tlog(REGISTER, 'would not read, so no patrol is stood up or taken down');
      return;
    }
    var standing = {};
    table.roads.forEach(function (r) { standing[r.id] = r; });
    var changed = false, made = 0, kept = 0, gone = 0;

    Object.keys(reg.roads).forEach(function (rid) {
      var slots = reg.roads[rid], road = standing[rid];
      Object.keys(slots).forEach(function (s) {
        var slot = Number(s), id = parseInt(slots[s], 16) >>> 0;
        if (road && slot < road.points.length && (!holds(id, rid, slot) || holds(id, rid, slot, road.bases[slot]))) { return; }
        if (holds(id, rid, slot)) { removeSpawned(id); gone++; }
        delete slots[s];
        changed = true;
      });
      if (!Object.keys(slots).length) { delete reg.roads[rid]; changed = true; }
    });

    table.roads.forEach(function (road) {
      var slots = reg.roads[road.id] || {};
      for (var slot = 0; slot < road.points.length; slot++) {
        var had = slots[slot] ? parseInt(slots[slot], 16) >>> 0 : 0;
        if (had && holds(had, road.id, slot, road.bases[slot])) { kept++; continue; }
        var ref = place(road, slot, population, runtime);
        if (ref) { slots[slot] = (ref >>> 0).toString(16); made++; changed = true; }
        else if (had) { delete slots[slot]; changed = true; }
      }
      if (Object.keys(slots).length) { reg.roads[road.id] = slots; }
    });

    if (changed) {
      try { writeRegister(reg); } catch (e) { tlog('the register could not be written:', e && e.message); }
    }
    tlog(table.on ? 'on' : 'off', '- stage', table.stage || '(none)', 'cap', thalmorPatrolCap(table), '-', table.roads.length, 'road(s) may stand;', made, 'stood up,', kept, 'already there,', gone, 'taken down');
  }

  try { keepPatrols(); } catch (e) { tlog('the patrol keeper failed:', e && e.message); }
})();
// ==== end thornswood thalmor patrols ====
