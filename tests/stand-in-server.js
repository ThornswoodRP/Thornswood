'use strict';
/*
  stand-in-server.js

  #5198. The server the scenario harnesses run the WHOLE of game/gamemode.js
  against: the fork's engine, reduced to what the gamemode can see of it, and
  answering each message in the order the fork does. A scenario harness
  (test-scenario-*.js) builds a world with it, loads the gamemode, and then
  does what people do (open a door, put a thing in a chest, say a line from
  the K panel, make something at a bench), each through the same steps the
  engine takes, so a gamemode that only works when its handlers are called in
  some other order, or with arguments the engine never sends, fails here.

  What is taken from the fork, and where (skymp5-server, at the pin):

    loading   ts/gamemodeLoad.ts requireTemp: the file is copied into a fresh
              temp folder and required from there, so __filename and
              __dirname are that folder, not game/. globalThis.mp is the
              server object, kept across reloads; __thornswoodGamemodeLoaded
              is deleted before each load and called after it with
              { reload, clientScriptsChanged }. A reload is the same process
              (same globalThis); a restart or a crash is a new one, with the
              change forms read back through JSON the way the database does.
    events    cpp/addon/ScampServerListener.cpp OnMpApiEvent: the handler is
              mp[name]; none means allowed; its arguments are the event's JSON
              array parsed one element at a time; undefined means allowed,
              false means blocked; a throw is logged and the event is ALLOWED.
              Anything else it answers is not a boolean the engine can read,
              and is a fault here.
    activate  cpp/server_guest_lib/MpObjectReference.cpp Activate: onActivate
              first; blocked means nothing opens. Allowed, a container opens
              for the actor (ProcessActivateNormal: occupant, isOpen) unless
              somebody else holds it within 512 units in the same cell, and a
              bench (FURN) within 256. A second activation of what you hold
              open closes it and fires no event (ProcessActivateSecond).
              A press on a door the client has locked is never sent at all
              (activationService.ts, measured in the gamemode's own note on
              THE SECOND HALF OF A LOCK), so honest() skips it; a client whose
              lock script did not run sends it anyway.
    put/take  MpObjectReference PutItem/TakeItem: the engine refuses (throws,
              no event) unless the actor holds the container open; then
              onPutItem/onTakeItem, and only when allowed do the items move
              (PutItemEvent/TakeItemEvent OnFireSuccess).
    craft     CraftService: onCraftWork first, which may set craftWork.ms only
              inside its own event (CraftWorkBinding); blocked means nothing
              starts. After the work time, onCraft with the entries it would
              take; allowed, the inputs leave the pack and the output (or the
              craftOutput the gamemode set) goes in; blocked, nothing moves.
    eat       MpActor::OnEquip: an ALCH or INGR record in the pack fires
              onEatItem, which alone may set eatItemScale (EatItemScaleBinding);
              then one leaves the pack whatever the handler answered.
    read      MpActor: onReadBook, with the actor and the base id.
    death     MpActor: onDying, then onDeath, then onRespawn after the delay.
    login     ts/systems/thornswoodLogin.ts: mp.onThornswoodLogin({ userId,
              profileId, nonce, proof: null }) at the login; > 0 hands that
              profile over, 0 refuses, anything else waits for the proof.
    mp        cpp/addon/ScampServer.cpp: the methods the server object has.
              A method it does not have is not there here either, so calling
              one throws as it would live. One it has that this does not
              model answers undefined and is counted in unmodeled.
    props     cpp/addon/property_bindings: the built-in keys (inventory,
              locationalData, pos, isOpen, craftWork and the rest) and the
              custom ones. A custom key that was never made with
              makeProperty throws "Property 'x' doesn't exist" (outside the
              private. prefix), as CustomPropertyBinding does; a second
              makeProperty of one name throws, as MakeProperty's isUnique does.
    forms     cpp/server_guest_lib/FormDesc.cpp: descriptors and ids by the
              load order, light plugins as 0xFE000000 | index << 12 | id.

  Lines from a person's game (the front plugin, the K panel, the chat) reach
  the gamemode the way they reach the real one: posted to the voice service,
  which the gamemode polls (GET /commands), and what it says goes back to the
  voice service (POST /say). say() and heard() are those two.

  Read only, apart from its temp folders, which done() removes.
*/
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const vm = require('vm');

const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);

/* The server object's methods (ScampServer.cpp InstanceMethod list, at the pin). */
const ENGINE_METHODS = [
  '_setSelf', 'attachSaveStorage', 'completeSavesForShutdown', 'validateInventoryTransaction',
  'writePrivateEconomyLedger', 'writeFileWhole', 'tick', 'on', 'createActor', 'setUserActor',
  'getUserActor', 'getUserGuid', 'isConnected', 'getActorPos', 'getActorCellOrWorld', 'getActorName',
  'destroyActor', 'setRaceMenuOpen', 'getActorsByProfileId', 'getUnreadableChangeForms', 'setEnabled',
  'createBot', 'getUserByActor', 'getUserIp', 'kick', 'getLocalizedString', 'getServerSettings', 'clear',
  'makeProperty', 'makeEventSource', 'get', 'set', 'compareAndSetInventory',
  'compareAndSetInventoryAndProperty', 'compareAndSetActorProperty', 'getInventoryReceipt',
  'getSavedInventoryReceipt', 'place', 'lookupEspmRecordById', 'getEspmLoadOrder',
  'getNeighborsByPosition', 'getAllForms', 'loadNpcBatch', 'prepareNpcLoad', 'setNpcServerControlled',
  'setNpcDifficultyTier', 'updateNpcMovement', 'stopNpcMovement', 'getNavmeshRecords', 'getNpcAIState',
  'getActorRuntimeIdentity', 'getFactionReactions', 'serverNpcAttack', 'getLoadedFormCount',
  'setNpcPlacementExclusions', 'getLoadedNpcIds', 'getDescFromId', 'getIdFromDesc',
  'callPapyrusFunction', 'registerPapyrusFunction', 'sendCustomPacket', 'setPacketHistoryRecording',
  'getPacketHistory', 'clearPacketHistory', 'requestPacketHistoryPlayback', 'findFormsByPropertyValue',
  'getPrometheusMetrics'
];
/* The built-in keys (PropertyBindingFactory.cpp). Everything else is custom. */
const BUILT_IN = ['actorNeighbors', 'angle', 'appearance', 'baseDesc', 'craftOutput', 'craftStock', 'craftWork',
  'dyingHealth', 'eatItemScale', 'equipment', 'inventory', 'isDead', 'isDisabled', 'isOnline', 'isOpen',
  'locationalData', 'neighbors', 'onlinePlayers', 'percentages', 'pos', 'profileId', 'spawnPoint',
  'spellCastDurationMult', 'type', 'worldOrCellDesc', 'idx', 'consoleCommandsAllowed', 'spawnDelay',
  'templateChain', 'lastAnimEvent', 'respawnPercentages'];
const PRIVATE = 'private.';

const CONTAINER_REACH = 512, BENCH_REACH = 256, WORK_REACH = 512;
/* A person's half when the scenario names only the profession. */
const FIRST_HALF = { smith: 'platewright', cook: 'hearthcook', tailor: 'liverywright', alchemist: 'physicker',
  woodworker: 'woodwright', enchanter: 'wardweaver', warrior: 'bulwark' };

function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/* The load order the server runs (last-plugin.json names it), as FormDesc reads it. */
function readLoadOrder() {
  const lp = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'last-plugin.json'), 'utf8')
    .replace(/^﻿/, ''));
  return lp.loadOrder.slice();
}
function slots(order) {
  let full = 0, light = 0;
  return order.map(function (file) {
    const isLight = /\.esl$/i.test(file);
    return isLight ? { file: file, light: true, index: light++ } : { file: file, light: false, index: full++ };
  });
}

/*
  A world. opts:
    name      what the harness is, for the temp folder
    start     the clock at the start, ms since 1970 (default 26 Oct 2026, noon)
    settings  more server-settings.json
    files     { 'private/property.json': object or text } written before boot
    gm        the gamemode file (default game/gamemode.js, or GM in the environment)
*/
function world(opts) {
  opts = opts || {};
  const SRC = path.resolve(opts.gm || process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js'));
  const gmText = fs.readFileSync(SRC, 'utf8').split(CR).join('');
  const START = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-' + (opts.name || 'world') + '-'));
  ['data', 'private', 'world'].forEach(function (d) { fs.mkdirSync(path.join(dir, d)); });
  fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify(Object.assign({
    dataDir: 'data', privDir: 'private', port: 7777, name: 'scenario ' + (opts.name || ''),
    loadOrder: [], thornswoodRequirePass: false
  }, opts.settings || {})));
  /*
    The join pass (the join pass block in gamemode.js, #937): every session
    with no valid pass is ended three minutes in, so this server shares a
    passKey with the stand-in's site the way Set-Door.ps1 -Connect copies one,
    and the stand-in's launcher signs each person's pass with it the way
    makePass in site/server.js does.
  */
  const PASS_KEY = crypto.randomBytes(32).toString('base64');
  const files = Object.assign({ 'private/door.json': { passKey: PASS_KEY } }, opts.files || {});
  for (const f in files) {
    const p = path.join(dir, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof files[f] === 'string' ? files[f] : JSON.stringify(files[f]));
  }
  process.chdir(dir);

  const SLOTS = slots(opts.loadOrder || readLoadOrder());
  let clock = opts.start || Date.UTC(2026, 9, 26, 12, 0, 0);
  class FakeDate extends Date {
    constructor(...a) { if (a.length) { super(...a); } else { super(clock); } }
    static now() { return clock; }
  }

  const w = {
    dir: dir, SRC: SRC,
    faults: [],      // what the engine would refuse or log as an error
    unmodeled: {},   // engine methods and Papyrus calls this does not model, with counts
    missing: {},     // names asked of the server object that the engine does not have, with counts
    threw: [],       // what a timer threw
    did: [],         // [time, actor, kind, what, value]
    said: [],        // POST /say bodies
    notified: [],    // Debug.Notification texts
    log: []          // the gamemode's console
  };
  function fault(text) { w.faults.push(text); }
  function unmodeled(name) { w.unmodeled[name] = (w.unmodeled[name] || 0) + 1; }
  function saw(actor, kind, what, value) { w.did.push([clock, actor, kind, what, value]); }

  // ------------------------------------------------------------ forms --
  w.idOf = function (desc) {
    const s = String(desc);
    const i = s.indexOf(':');
    if (i < 0) { return (0xff000000 + parseInt(s, 16)) >>> 0; }
    const local = parseInt(s.slice(0, i), 16), file = s.slice(i + 1);
    if (local === 0x3c && file === 'Skyrim.esm') { return 0x3c; }
    const slot = SLOTS.find(function (x) { return x.file.toLowerCase() === file.toLowerCase(); });
    if (!slot) { throw new Error(file + ' not found in loaded files'); }
    const mask = slot.light ? 0xfff : 0xffffff;
    if ((local & ~mask) !== 0) { throw new Error(s + ' names no form: ' + file + ' is a ' + (slot.light ? 'light' : 'full') + ' plugin'); }
    return (slot.light ? (0xfe000000 | (slot.index << 12) | local) : ((slot.index << 24) | local)) >>> 0;
  };
  w.descOf = function (id) {
    id = id >>> 0;
    if (id === 0x3c) { return '3c:Skyrim.esm'; }
    if (id >= 0xff000000) { return (id - 0xff000000).toString(16); }
    let slot;
    if ((id >>> 24) === 0xfe) { const li = (id >>> 12) & 0xfff; slot = SLOTS.find(function (x) { return x.light && x.index === li; }); }
    else { const fi = id >>> 24; slot = SLOTS.find(function (x) { return !x.light && x.index === fi; }); }
    if (!slot) { throw new Error('FromFormId failed due to invalid file index (' + id.toString(16) + ')'); }
    return (id & (slot.light ? 0xfff : 0xffffff)).toString(16) + ':' + slot.file;
  };

  // ------------------------------------------------------------ the world --
  /* Every change form, as the engine keeps it, by id. */
  let store = new Map();
  /* What kind of record each reference's base is: DOOR, CONT, FURN, ACTI, NPC_, BOOK ... */
  const records = new Map();
  /* Who holds each container or bench open (not saved: the engine keeps it in memory). */
  let occupant = new Map();
  let made = new Set();          // custom properties made with makeProperty, this process
  let online = [];               // actor ids, by user id order
  let users = new Map();         // actor -> user id
  let nextUser = 0;
  let nextPlaced = 0xff100000;
  let waiting = [];              // lines on the voice service for /commands
  let craftWorkFor = null;       // the actor inside its own onCraftWork
  let craftOutputFor = null;
  let eatScaleFor = null;        // the actor inside its own onEatItem

  w.record = function (desc, type, extra) { records.set(w.idOf(desc) >>> 0, Object.assign({ type: type }, extra || {})); };
  w.typeOf = function (id) {
    const row = store.get(id >>> 0);
    if (row && row.type) { return row.type; }
    if (!row || !row.baseDesc) { return ''; }
    let base = 0;
    try { base = w.idOf(row.baseDesc); } catch (e) { return ''; }
    const r = records.get(base >>> 0);
    return r ? r.type : '';
  };
  /* A reference in the world. row: { base, type, cell, pos, angle, inventory, ...custom } */
  w.ref = function (id, row) {
    const r = Object.assign({}, row);
    const out = {
      baseDesc: r.base, worldOrCellDesc: r.cell || '3c:Skyrim.esm', pos: r.pos || [0, 0, 0], angle: r.angle || [0, 0, 0],
      inventory: r.inventory || { entries: [] }, isOpen: false, isDisabled: false
    };
    if (r.type) { out.type = r.type; }
    delete r.base; delete r.cell; delete r.pos; delete r.angle; delete r.inventory; delete r.type;
    store.set(id >>> 0, Object.assign(out, r));
    return id >>> 0;
  };
  /*
    A character, offline until arrive(). row: { profileId, name, cell, pos, ...custom }.
    A finished one carries what a finished character carries; a scenario sets
    the rest.
  */
  w.person = function (id, row) {
    const r = Object.assign({}, row);
    const out = {
      type: 'NPC_', profileId: r.profileId, baseDesc: '7:Skyrim.esm',
      appearance: { name: r.name || 'Somebody', raceId: 0x13746, isFemale: false },
      worldOrCellDesc: r.cell || '3c:Skyrim.esm', pos: r.pos || [0, 0, 0], angle: r.angle || [0, 0, 0],
      isDead: false, isDisabled: false,
      inventory: r.inventory || { entries: [{ baseId: 0xf, count: 40 }] },
      equipment: { inv: { entries: [] } }
    };
    if (r.finished !== false) {
      // The character block's record (CHAR_PROPERTY, v 1): the progression
      // state, a novice in the half unless the scenario says otherwise.
      const prof = r.prof || 'smith';
      const half = r.half || FIRST_HALF[prof] || null;
      const ranks = {};
      if (half) { ranks[half] = r.rank || 'novice'; }
      out.thornswoodChargen = { stage: 'done', at: 1, destination: r.town || 'whiterun' };
      out.thornswoodPurse = 1;   // the forty gold every character is handed once, already in the pack
      out.thornswoodCharacter = Object.assign({ v: 1, cls: r.cls || null, prof: prof, half: half, schools: [],
        ranks: ranks, taught: [], spells: null, tree: {}, points: 0, work: {}, placed: {} }, r.character || {});
    }
    delete r.profileId; delete r.name; delete r.cell; delete r.pos; delete r.angle; delete r.inventory;
    delete r.finished; delete r.town; delete r.prof; delete r.half; delete r.rank; delete r.cls; delete r.character;
    store.set(id >>> 0, Object.assign(out, r));
    return id >>> 0;
  };
  w.row = function (id) { return store.get(id >>> 0); };
  w.prop = function (id, key) { const r = store.get(id >>> 0); return r ? copy(r[key]) : undefined; };
  w.count = function (id, baseId) {
    const r = store.get(id >>> 0);
    const e = (r && r.inventory && r.inventory.entries) || [];
    return e.filter(function (x) { return x.baseId === baseId; }).reduce(function (a, x) { return a + x.count; }, 0);
  };
  w.give = function (id, baseId, count, extra) {
    const r = store.get(id >>> 0);
    const e = r.inventory.entries;
    const name = extra && extra.name ? extra.name : '';
    const hit = e.find(function (x) { return x.baseId === baseId && (x.name || '') === name && !x.made; });
    if (hit) { hit.count += count; } else { e.push(Object.assign({ baseId: baseId, count: count }, extra || {})); }
  };
  w.moveTo = function (id, cell, pos) { const r = store.get(id >>> 0); r.worldOrCellDesc = cell; r.pos = pos.slice(); };
  w.online = function () { return online.slice(); };
  w.now = function () { return clock; };

  function near(a, b, reach) {
    const ra = store.get(a), rb = store.get(b);
    if (!ra || !rb || ra.worldOrCellDesc !== rb.worldOrCellDesc) { return false; }
    const d = [0, 1, 2].map(function (i) { return (ra.pos[i] || 0) - (rb.pos[i] || 0); });
    return Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) <= reach;
  }

  // -------------------------------------------------------------- mp --
  function customGet(id, k) {
    if (k.indexOf(PRIVATE) !== 0 && !made.has(k)) { throw new Error('Property \'' + k + '\' doesn\'t exist'); }
    const row = store.get(id);
    return row ? copy(row[k]) : undefined;
  }
  const impl = {
    get: function (id, k) {
      id = id >>> 0;
      if (k === 'onlinePlayers') { return online.slice(); }
      const row = store.get(id);
      if (BUILT_IN.indexOf(k) < 0) {
        if (!row) { throw new Error('Form with id ' + id.toString(16) + ' doesn\'t exist'); }
        return customGet(id, k);
      }
      if (!row) { throw new Error('Form with id ' + id.toString(16) + ' doesn\'t exist'); }
      switch (k) {
        case 'locationalData': return { cellOrWorldDesc: row.worldOrCellDesc, pos: copy(row.pos), rot: copy(row.angle) };
        case 'isOnline': return online.indexOf(id) >= 0;
        case 'isOpen': return !!row.isOpen;
        case 'craftWork': return craftWorkFor && craftWorkFor.actor === id ? { ms: craftWorkFor.ms } : undefined;
        case 'craftOutput': return craftOutputFor && craftOutputFor.actor === id ? copy(craftOutputFor.out) : undefined;
        case 'eatItemScale': return eatScaleFor && eatScaleFor.actor === id ? eatScaleFor.scale : 1;
        case 'type': return row.type === 'NPC_' ? 'MpActor' : 'MpObjectReference';
        case 'neighbors': case 'actorNeighbors': return online.filter(function (a) { return a !== id && near(a, id, 8192); });
        default: return copy(row[k]);
      }
    },
    set: function (id, k, v) {
      id = id >>> 0;
      const row = store.get(id);
      if (!row) { throw new Error('Form with id ' + id.toString(16) + ' doesn\'t exist'); }
      saw(id, 'set', k, copy(v));
      if (BUILT_IN.indexOf(k) < 0) {
        if (k.indexOf(PRIVATE) !== 0 && !made.has(k)) { throw new Error('Property \'' + k + '\' doesn\'t exist'); }
        row[k] = copy(v);
        return;
      }
      switch (k) {
        case 'locationalData': row.worldOrCellDesc = v.cellOrWorldDesc; row.pos = copy(v.pos); row.angle = copy(v.rot); return;
        case 'craftWork':
          if (!craftWorkFor || craftWorkFor.actor !== id) { fault('craftWork set on ' + id.toString(16) + ' outside its own onCraftWork'); return; }
          if (!(v && v.ms >= 0)) { throw new Error('craftWork.ms'); }
          craftWorkFor.ms = v.ms; return;
        case 'craftOutput':
          if (!craftOutputFor || craftOutputFor.actor !== id) { fault('craftOutput set on ' + id.toString(16) + ' outside its own onCraft'); return; }
          craftOutputFor.out = copy(v); return;
        case 'eatItemScale': {
          // EatItemScaleBinding: outside its own onEatItem the engine warns and does nothing.
          if (!eatScaleFor || eatScaleFor.actor !== id) { fault('eatItemScale set on ' + id.toString(16) + ' outside its own onEatItem'); return; }
          if (typeof v !== 'number') { throw new Error('eatItemScale'); }
          eatScaleFor.scale = isNaN(v) || v < 0 ? 0 : (v > 1 ? 1 : v);   // EatItemEvent::SetEffectScale
          return;
        }
        case 'isOpen': case 'isOnline': case 'onlinePlayers': case 'type': case 'neighbors': case 'actorNeighbors':
          throw new Error('Property \'' + k + '\' is read-only');
        default: row[k] = copy(v);
      }
    },
    makeProperty: function (name, options) {
      if (made.has(name)) { throw new Error('Property \'' + name + '\' already exists'); }
      if (!options || typeof options.isVisibleByOwner !== 'boolean' || typeof options.isVisibleByNeighbors !== 'boolean' ||
          typeof options.updateOwner !== 'string' || typeof options.updateNeighbor !== 'string') {
        throw new Error('makeProperty ' + name + ': options are not what the engine takes');
      }
      made.add(name);
    },
    makeEventSource: function () { },
    getDescFromId: function (id) { return w.descOf(id); },
    getIdFromDesc: function (d) { return w.idOf(d); },
    getEspmLoadOrder: function () { return SLOTS.map(function (s) { return s.file; }); },
    lookupEspmRecordById: function (id) {
      const r = records.get(id >>> 0);
      return { record: r ? Object.assign({ id: id >>> 0 }, r) : null };
    },
    getServerSettings: function () { return JSON.parse(fs.readFileSync(path.join(dir, 'server-settings.json'), 'utf8')); },
    writeFileWhole: function (f, text) { fs.writeFileSync(f, text); },
    getUserByActor: function (a) { return users.has(a >>> 0) && online.indexOf(a >>> 0) >= 0 ? users.get(a >>> 0) : -1; },
    getUserActor: function (u) { for (const [a, uu] of users) { if (uu === u && online.indexOf(a) >= 0) { return a; } } return 0; },
    getUserGuid: function (u) { return 'guid-' + u; },
    isConnected: function (u) { return impl.getUserActor(u) !== 0; },
    getActorsByProfileId: function (pid) {
      const out = [];
      for (const [id, row] of store) { if (row.type === 'NPC_' && row.profileId === pid) { out.push(id); } }
      return out;
    },
    getActorPos: function (a) { const r = store.get(a >>> 0); return r ? copy(r.pos) : [0, 0, 0]; },
    getActorCellOrWorld: function (a) { const r = store.get(a >>> 0); return r ? r.worldOrCellDesc : ''; },
    getActorName: function (a) { const r = store.get(a >>> 0); return r && r.appearance ? r.appearance.name : ''; },
    getNeighborsByPosition: function (cell, pos) {
      return online.filter(function (a) { const r = store.get(a); return r && r.worldOrCellDesc === cell; });
    },
    setRaceMenuOpen: function (a, open) { saw(a >>> 0, 'raceMenu', '', !!open); },
    sendCustomPacket: function (u, text) { saw(impl.getUserActor(u), 'packet', '', String(text)); },
    findFormsByPropertyValue: function (k, v) {
      const out = [];
      for (const [id, row] of store) { if (JSON.stringify(row[k]) === JSON.stringify(v)) { out.push(id); } }
      return out;
    },
    place: function (baseId) {
      const desc = w.descOf(baseId);
      if (!records.get(baseId >>> 0)) { throw new Error('place: no record ' + desc); }
      const id = nextPlaced++;
      w.ref(id, { base: desc });
      saw(id, 'placed', desc, null);
      return id;
    },
    kick: function (u) { const a = impl.getUserActor(u); if (a) { w.leave(a); saw(a, 'kicked', '', null); } },
    callPapyrusFunction: function (kind, cls, fn, self, args) { return papyrus(kind, cls, fn, self, args || []); },
    clear: function () { },
    getLocalizedString: function (s) { return String(s); }
  };

  function selfId(self) { return self && self.desc !== undefined ? w.idOf(self.desc) : 0; }
  function papyrus(kind, cls, fn, self, args) {
    const key = kind + ' ' + cls + '.' + fn;
    if (key === 'global Debug.Notification') { w.notified.push(String(args[0])); return undefined; }
    const id = selfId(self);
    const row = store.get(id);
    if (kind === 'method' && cls === 'ObjectReference' && row) {
      switch (fn) {
        case 'SetAngle': row.angle = [Number(args[0]), Number(args[1]), Number(args[2])]; return undefined;
        case 'SetPosition': row.pos = [Number(args[0]), Number(args[1]), Number(args[2])]; return undefined;
        case 'MoveTo': {
          const to = store.get(selfId(args[0]));
          if (!to) { return undefined; }
          row.worldOrCellDesc = to.worldOrCellDesc;
          row.pos = [to.pos[0] + Number(args[1] || 0), to.pos[1] + Number(args[2] || 0), to.pos[2] + Number(args[3] || 0)];
          return undefined;
        }
        case 'Disable': row.isDisabled = true; return undefined;
        case 'Enable': row.isDisabled = false; return undefined;
        case 'Delete': store.delete(id); return undefined;
        case 'GetPositionX': return row.pos[0];
        case 'GetPositionY': return row.pos[1];
        case 'GetPositionZ': return row.pos[2];
      }
    }
    unmodeled('papyrus ' + key);
    return undefined;
  }

  /*
    The server object has the engine's methods and nothing else, so asking it
    for any other name gives undefined and calling that throws, as it does
    live. The gamemode wraps most calls in a try, which hides exactly that
    (#4522: eight ticks called mp.getOnlinePlayers, which no engine has), so
    every name asked for that the engine does not have is counted in
    w.missing, apart from the event handlers the gamemode sets on it.
  */
  function makeMp() {
    const mp = {};
    ENGINE_METHODS.forEach(function (m) {
      mp[m] = impl[m] ? impl[m] : function () { unmodeled('mp.' + m); return undefined; };
    });
    return new Proxy(mp, {
      get: function (o, k) {
        if (typeof k === 'string' && !(k in o) && !/^on[A-Z:]/.test(k)) { w.missing[k] = (w.missing[k] || 0) + 1; }
        return o[k];
      }
    });
  }

  // ---------------------------------------------- the voice service --
  function fakeHttp() {
    function request(o, cb) {
      if (typeof o === 'string') { o = new URL(o); }
      const r = {
        on: function () { return r; }, setTimeout: function () { return r; }, destroy: function () { }, write: function () { },
        end: function (body) {
          const where = String((o && o.path) || (o && o.pathname) || '');
          if (where === '/say' && body) { try { w.said.push(JSON.parse(body)); } catch (e) { } }
          if (where.indexOf('/commands') === 0 && typeof cb === 'function') {
            const list = waiting.splice(0);
            const h = {};
            const res = { statusCode: 200, headers: {}, on: function (ev, fn) { h[ev] = fn; return res; }, setEncoding: function () { }, resume: function () { } };
            cb(res);
            if (h.data) { h.data(JSON.stringify({ commands: list })); }
            if (h.end) { h.end(); }
          }
        }
      };
      return r;
    }
    return { request: request, get: request, createServer: function () { return { listen: function () { }, on: function () { }, close: function () { } }; } };
  }
  const HTTP = fakeHttp();
  function fakeRequire(name) {
    if (name === 'http' || name === 'https') { return HTTP; }
    if (name === 'child_process') { return { exec: function () { }, execFile: function () { }, spawn: function () { return { on: function () { }, stdout: { on: function () { } }, stderr: { on: function () { } } }; } }; }
    return require(name);
  }

  // --------------------------------------------------------- a process --
  let proc = null;
  let reloads = 0;
  function boot() {
    const timers = [];
    function line() { w.log.push([].slice.call(arguments).map(String).join(' ')); }
    const box = {
      mp: makeMp(), require: fakeRequire, process: process, Buffer: Buffer,
      console: { log: line, error: line, warn: line, info: line },
      setInterval: function (fn, ms) { const t = { fn: fn, every: Math.max(1, Number(ms) || 1), at: clock + Math.max(1, Number(ms) || 1) }; t.unref = function () { return t; }; t.ref = t.unref; timers.push(t); return t; },
      clearInterval: function (t) { if (t) { t.gone = true; } },
      setTimeout: function (fn, ms) { const a = [].slice.call(arguments, 2); const t = { fn: function () { fn.apply(null, a); }, at: clock + (Number(ms) || 0) }; t.unref = function () { return t; }; t.ref = t.unref; timers.push(t); return t; },
      clearTimeout: function (t) { if (t) { t.gone = true; } },
      setImmediate: function (fn) { const t = { fn: fn, at: clock }; timers.push(t); return t; },
      clearImmediate: function (t) { if (t) { t.gone = true; } },
      queueMicrotask: queueMicrotask,
      Date: FakeDate, URL: URL, URLSearchParams: URLSearchParams, TextEncoder: TextEncoder, TextDecoder: TextDecoder
    };
    box.globalThis = box;
    vm.createContext(box);
    proc = { box: box, timers: timers, err: null };
    made = new Set();
    occupant = new Map();
    reloads = 0;
    load();
    return proc;
  }
  /* One load of the file into the process, as requireTemp does it. */
  function load() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skymp5-server'));
    const file = path.join(tmp, Math.random() + '-' + clock + '.js');
    fs.writeFileSync(file, gmText);
    delete proc.box.__thornswoodGamemodeLoaded;
    const m = { exports: {} };
    try {
      vm.runInContext('(function (exports, require, module, __filename, __dirname) {' + gmText + '\n})',
        proc.box, { filename: file })
        .call(m.exports, m.exports, fakeRequire, m, file, tmp);
    } catch (e) {
      proc.err = e;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    if (!proc.err) {
      const loaded = proc.box.__thornswoodGamemodeLoaded;
      if (typeof loaded === 'function') {
        try { loaded({ reload: reloads > 0, clientScriptsChanged: false }); } catch (e) { fault('__thornswoodGamemodeLoaded threw: ' + e.message); }
      }
    }
    reloads++;
  }
  /* The clock moved on by ms, every timer due in it run in order. */
  w.run = function (ms) {
    const end = clock + (ms || 0);
    for (;;) {
      let next = null;
      const timers = proc.timers;
      for (let i = 0; i < timers.length; i++) {
        if (!timers[i].gone && (!next || timers[i].at < next.at)) { next = timers[i]; }
      }
      // The launchers renew their passes every minute and the front plugin sends them on.
      if (passAt <= end && (!next || passAt <= next.at)) {
        clock = Math.max(clock, passAt);
        passAt += PASS_EVERY;
        online.forEach(sendPass);
        if (++clientBeats % 2 === 0) { online.forEach(sendActive); }
        continue;
      }
      if (!next || next.at > end) { break; }
      clock = Math.max(clock, next.at);
      if (next.every) { next.at += next.every; } else { next.gone = true; }
      try { next.fn(); } catch (e) { w.threw.push(e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : String(e)); }
    }
    clock = end;
  };
  w.boot = function () { boot(); return w.loaded(); };
  w.loaded = function () { return proc && !proc.err; };
  w.loadError = function () { return proc && proc.err ? (proc.err.stack || String(proc.err)) : ''; };
  w.box = function () { return proc.box; };
  w.timers = function () { return proc.timers.filter(function (t) { return !t.gone; }).map(function (t) { return { every: t.every || 0, at: t.at }; }); };
  w.mp = function () { return proc.box.mp; };
  /* The gamemode deployed again while the server runs: same process, same mp. */
  w.reload = function () { proc.err = null; load(); return w.loaded(); };
  /* The server stopped and started: a new process, the change forms through JSON. */
  w.restart = function () {
    store = new Map(JSON.parse(JSON.stringify(Array.from(store.entries()))));
    for (const row of store.values()) { row.isOpen = false; }
    const was = online.slice();
    online = [];
    boot();
    return { loaded: w.loaded(), wasOnline: was };
  };

  // ------------------------------------------------------------ events --
  /* One event, as OnMpApiEvent hands it over. Answers true when allowed. */
  function fire(name, args, extra) {
    const f = proc.box.mp[name];
    saw(0, 'event', name, copy(args));
    if (typeof f !== 'function') { return true; }
    const parsed = args.map(function (a) { return JSON.parse(JSON.stringify(a === undefined ? null : a)); });
    let r;
    try {
      r = f.apply(proc.box.mp, parsed.concat(extra || []));
    } catch (e) {
      fault(name + ' threw: ' + (e && e.message));
      return true;
    }
    if (r === undefined) { return true; }
    if (typeof r !== 'boolean') { fault(name + ' answered ' + JSON.stringify(r) + ', which is not true, false or undefined'); return true; }
    return r;
  }
  w.fire = fire;

  /* A person comes in through the login (thornswoodLogin.ts). Answers whether they were handed over. */
  w.arrive = function (actorId) {
    actorId = actorId >>> 0;
    const row = store.get(actorId);
    if (!row) { throw new Error('no such character ' + actorId.toString(16)); }
    const user = users.has(actorId) ? users.get(actorId) : nextUser++;
    const hook = proc.box.mp.onThornswoodLogin;
    let handed = row.profileId;
    if (typeof hook === 'function') {
      let r;
      try { r = hook({ userId: user, profileId: row.profileId, nonce: 'n' + user + '-' + clock, proof: null }); }
      catch (e) { fault('onThornswoodLogin threw: ' + e.message); return false; }
      if (!(typeof r === 'number' && r > 0)) { saw(actorId, 'login', 'not handed over', r); return false; }
      handed = r;
    }
    if (handed !== row.profileId) { fault('login handed over profile ' + handed + ' for ' + row.profileId); }
    users.set(actorId, user);
    if (online.indexOf(actorId) < 0) { online.push(actorId); }
    sendPass(actorId);
    saw(actorId, 'login', 'handed over', handed);
    return true;
  };
  /* A person disconnects: what they held open closes, they leave onlinePlayers. */
  w.leave = function (actorId) {
    actorId = actorId >>> 0;
    online = online.filter(function (a) { return a !== actorId; });
    for (const [ref, who] of occupant) {
      if (who === actorId) { occupant.delete(ref); const r = store.get(ref); if (r) { r.isOpen = false; } }
    }
  };
  /* A line from their game, through the voice service, then the poll's two seconds. */
  /*
    Each person's launcher and front plugin: a pass the site signed (makePass:
    profile, server, launcher version, Discord account, issued, ten minute
    expiry), sent as "/joinpass <pass>" over the command relay at the login
    and every minute after (PASS_EVERY).
  */
  const PASS_EVERY = 60000;
  let passAt = clock + PASS_EVERY;
  function b64u(b) { return Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function sendPass(actorId) {
    const row = store.get(actorId >>> 0);
    if (!row || !row.profileId) { return; }
    let server = 'main';
    try { server = String(JSON.parse(fs.readFileSync(path.join(dir, 'server-settings.json'), 'utf8')).thornswoodServer || '').trim().toLowerCase() || 'main'; } catch (e) { }
    const body = b64u(JSON.stringify({ p: row.profileId, s: server, v: '9.9.9', d: 'discord-' + row.profileId, i: clock, x: clock + 600000 }));
    const mac = b64u(crypto.createHmac('sha256', PASS_KEY).update('jp1.' + body).digest());
    waiting.push({ profileId: row.profileId, text: '/joinpass jp1.' + body + '.' + mac, proven: true });
  }
  /*
    The idle prompt's watcher (thornswood-afk.js): while somebody is at the
    keys it says "/afk active" every two minutes at most, so the server knows
    they are there while the character stands still. w.idle(actor) takes
    them off the keys, and then only the server's own sample judges them.
  */
  let clientBeats = 0;
  const offKeys = new Set();
  function sendActive(actorId) {
    const row = store.get(actorId >>> 0);
    if (row && row.profileId && !offKeys.has(actorId >>> 0)) { waiting.push({ profileId: row.profileId, text: '/afk active', proven: true }); }
  }
  w.idle = function (actorId, off) { if (off === false) { offKeys.delete(actorId >>> 0); } else { offKeys.add(actorId >>> 0); } };
  w.say = function (actorId, text) {
    const row = store.get(actorId >>> 0);
    waiting.push({ profileId: row.profileId, text: text, proven: true });
    w.run(2000);
  };
  w.heard = function (actorId) {
    const pid = store.get(actorId >>> 0).profileId;
    return w.said.filter(function (s) { return s.profileId === pid; }).map(function (s) { return s.text; });
  };
  w.heardSince = function (actorId, n) { return w.heard(actorId).slice(n); };

  /*
    A press on a reference (MpObjectReference::Activate). Answers what the
    engine did: { allowed, opened, closed }.
  */
  w.activate = function (ref, actorId) {
    ref = ref >>> 0; actorId = actorId >>> 0;
    const row = store.get(ref);
    if (!row) { throw new Error('no such reference ' + ref.toString(16)); }
    const type = w.typeOf(ref);
    if ((type === 'CONT' || type === 'FURN') && occupant.get(ref) === actorId) {
      // The second activation: closes, and no event (ProcessActivateSecond).
      occupant.delete(ref);
      if (type === 'CONT') { row.isOpen = false; }
      saw(actorId, 'closed', ref, null);
      return { allowed: true, opened: false, closed: true };
    }
    const allowed = fire('onActivate', [ref, actorId]);
    let opened = false;
    if (allowed && !row.isDisabled) {
      if (type === 'CONT' || type === 'FURN') {
        const reach = type === 'CONT' ? CONTAINER_REACH : BENCH_REACH;
        const held = occupant.get(ref);
        const free = !held || !store.has(held) || online.indexOf(held) < 0 || !near(held, ref, reach);
        if (free) {
          occupant.set(ref, actorId);
          if (type === 'CONT') { row.isOpen = true; }
          opened = true;
        }
      } else if (type === 'DOOR') {
        opened = true;
        if (row.teleport) { w.moveTo(actorId, row.teleport.cell, row.teleport.pos); }
      }
    }
    saw(actorId, 'activate', ref, { allowed: allowed, opened: opened });
    return { allowed: allowed, opened: opened, closed: false };
  };
  /*
    The same press from an honest client: a door its lock script locked is
    never sent. The script locks what the server's lock list (thornswoodLocks,
    { shut: [ids], open: [ids] }) names as shut.
  */
  w.honestActivate = function (ref, actorId) {
    const locks = (store.get(actorId >>> 0) || {}).thornswoodLocks;
    if (locks && Array.isArray(locks.shut) && locks.shut.indexOf(ref >>> 0) >= 0) {
      saw(actorId >>> 0, 'activate', ref >>> 0, 'not sent: locked on the client');
      return { allowed: false, opened: false, notSent: true };
    }
    return w.activate(ref, actorId);
  };
  w.holds = function (ref) { return occupant.get(ref >>> 0) || 0; };

  /*
    Moves count of a stack from one pack to another, the way RemoveItems does:
    the stack is the entry with this base and the same extra data (its name),
    since Inventory::Entry carries the name and EqualExceptCount compares it.
  */
  function sameStack(e, baseId, name) { return e.baseId === baseId && (e.name || '') === (name || ''); }
  function moveItems(from, to, baseId, count, name) {
    const ea = store.get(from).inventory.entries;
    const have = ea.filter(function (e) { return sameStack(e, baseId, name); }).reduce(function (n, e) { return n + e.count; }, 0);
    if (have < count) { return false; }
    let left = count;
    for (let i = 0; i < ea.length && left > 0; i++) {
      if (!sameStack(ea[i], baseId, name)) { continue; }
      const n = Math.min(left, ea[i].count);
      ea[i].count -= n; left -= n;
      if (ea[i].count <= 0) { ea.splice(i, 1); i--; }
    }
    if (to) { w.give(to, baseId, count, name ? { name: name } : null); }
    return true;
  }
  /*
    A put or a take. The event's arguments are the container, the actor, the
    base and the count (PutItemEvent: "TODO: implement extra data"), so the
    gamemode never sees the stack's name; the engine still moves that stack.
  */
  function putOrTake(name, ref, actorId, baseId, count, stackName) {
    ref = ref >>> 0; actorId = actorId >>> 0;
    if (occupant.get(ref) !== actorId) {
      // The engine throws before any event: the client is out of step with it.
      saw(actorId, name, ref, 'refused: does not occupy');
      return { sent: false, allowed: false, moved: false };
    }
    const allowed = fire(name, [ref, actorId, baseId, count]);
    let moved = false;
    if (allowed) {
      moved = name === 'onPutItem' ? moveItems(actorId, ref, baseId, count, stackName) : moveItems(ref, actorId, baseId, count, stackName);
      if (!moved) { fault(name + ' allowed ' + count + ' of ' + baseId.toString(16) + ' that was not there'); }
    }
    return { sent: true, allowed: allowed, moved: moved };
  }
  w.put = function (ref, actorId, baseId, count, stackName) { return putOrTake('onPutItem', ref, actorId, baseId, count, stackName); };
  w.take = function (ref, actorId, baseId, count, stackName) { return putOrTake('onTakeItem', ref, actorId, baseId, count, stackName); };

  /*
    A craft at a bench (CraftService). c: { output, count, recipe (id or 0),
    inputs: [{ baseId, count }], effects }. during(), when given, runs once
    the work has started and before its time is up: the person may get up
    (w.craftLeave, the client's craftLeave packet, StopWork) or walk off.
    After the time the engine finishes the craft only if they are still at
    the bench (AtBench: same cell, within 512) and nothing stopped it.
    Answers { started, made, workMs, why }.
  */
  let craftStopped = new Set();
  w.craftLeave = function (actorId) { craftStopped.add(actorId >>> 0); };
  w.craft = function (actorId, bench, c, during) {
    actorId = actorId >>> 0; bench = bench >>> 0;
    const inputs = (c.inputs || []).map(function (x) { return { baseId: x.baseId, count: x.count }; });
    for (const x of inputs) { if (w.count(actorId, x.baseId) < x.count) { return { started: false, made: false, why: 'inputs' }; } }
    const args = [actorId, c.output, c.count || 1, c.recipe || 0, bench, c.effects === undefined ? null : c.effects, inputs];
    craftWorkFor = { actor: actorId, ms: 0 };
    let ok, ms;
    try { ok = fire('onCraftWork', args); } finally { ms = craftWorkFor.ms; craftWorkFor = null; }
    if (!ok) { return { started: false, made: false, workMs: 0, why: 'refused' }; }
    craftStopped.delete(actorId);
    if (during) { during(); }
    w.run(ms);
    if (craftStopped.has(actorId)) { craftStopped.delete(actorId); return { started: true, made: false, workMs: ms, why: 'left the bench' }; }
    if (!near(actorId, bench, WORK_REACH)) { return { started: true, made: false, workMs: ms, why: 'moved away from the bench' }; }
    for (const x of inputs) { if (w.count(actorId, x.baseId) < x.count) { return { started: true, made: false, workMs: ms, why: 'inputs' }; } }
    craftOutputFor = { actor: actorId, out: undefined };
    let allowed, out;
    try { allowed = fire('onCraft', args.concat([[]])); } finally { out = craftOutputFor.out; craftOutputFor = null; }
    if (!allowed) { return { started: true, made: false, workMs: ms, why: 'refused' }; }
    for (const x of inputs) { moveItems(actorId, 0, x.baseId, x.count); }
    const outBase = out && out.baseId ? out.baseId : c.output;
    const outCount = out && out.count ? out.count : (c.count || 1);
    w.give(actorId, outBase, outCount, out && out.name ? { name: out.name } : null);
    return { started: true, made: true, workMs: ms, output: outBase, count: outCount };
  };
  /*
    Eating or drinking (MpActor::OnEquip): the client equips the item; the
    engine goes on only for a record it knows as an ingredient (INGR) or a
    potion or food (ALCH) that is in the pack. It fires onEatItem, in which
    the gamemode may set eatItemScale (0 to 1, how much of the effects land),
    and then takes one off the pack WHATEVER the handler answered: the plain
    stack first, then one that differs only in its name (ResolveRemoval, for
    food named with its days left). Answers { sent, allowed, scale, taken }.
  */
  w.eat = function (actorId, baseId) {
    actorId = actorId >>> 0; baseId = baseId >>> 0;
    const r = records.get(baseId);
    if (!r || (r.type !== 'ALCH' && r.type !== 'INGR')) { return { sent: false, why: 'not food, drink or an ingredient' }; }
    if (w.count(actorId, baseId) < 1) { return { sent: false, why: 'not in the pack' }; }
    eatScaleFor = { actor: actorId, scale: 1 };
    let allowed, scale;
    try { allowed = fire('onEatItem', [actorId, baseId]); } finally { scale = eatScaleFor.scale; eatScaleFor = null; }
    const ea = store.get(actorId).inventory.entries;
    const plain = ea.find(function (e) { return e.baseId === baseId && !e.name && e.count > 0; });
    const named = plain || ea.find(function (e) { return e.baseId === baseId && e.count > 0; });
    const taken = moveItems(actorId, 0, baseId, 1, named.name);
    return { sent: true, allowed: allowed, scale: scale, taken: taken };
  };
  w.readBook = function (actorId, baseId) { return fire('onReadBook', [actorId >>> 0, baseId]); };
  w.equip = function (actorId, baseId) { return fire('onEquipItemAttempt', [actorId >>> 0, baseId]); };
  w.drop = function (actorId, baseId, count) { return fire('onDropItem', [actorId >>> 0, baseId, count]); };
  /* Going down and dying (MpActor): onDying, onDeath, and onRespawn after delayMs. */
  w.die = function (actorId, killerId, delayMs) {
    actorId = actorId >>> 0;
    fire('onDying', [actorId, killerId || 0]);
    store.get(actorId).isDead = true;
    fire('onDeath', [actorId, killerId || 0]);
    w.run(delayMs === undefined ? 5000 : delayMs);
    store.get(actorId).isDead = false;
    fire('onRespawn', [actorId]);
  };

  // ------------------------------------------------------------ the end --
  /* Lines the gamemode logged that match re. */
  w.logged = function (re) { return w.log.filter(function (l) { return re.test(l); }); };
  w.done = function () {
    process.chdir(START);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  };
  w.readPrivate = function (name) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'private', name), 'utf8')); } catch (e) { return null; }
  };
  return w;
}

/* The PASS and FAIL lines every harness prints, and the exit code. */
function checks() {
  let pass = 0, fail = 0;
  const c = {
    yes: function (what, ok) {
      if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
      return !!ok;
    },
    done: function (w) {
      if (w) {
        // Every scenario's last check (#4522): nothing asked the server for a method it does not have.
        const names = Object.keys(w.missing);
        c.yes('Z the gamemode asked the server for no method the engine does not have (' +
              names.map(function (k) { return 'mp.' + k + ' ' + w.missing[k] + 'x'; }).join(', ') + ')', names.length === 0);
        w.done();
      }
      console.log('');
      console.log(pass + ' passed, ' + fail + ' failed');
      process.exit(fail ? 1 : 0);
    }
  };
  return c;
}

module.exports = { world: world, checks: checks, ENGINE_METHODS: ENGINE_METHODS, BUILT_IN: BUILT_IN, REPO_DIR: REPO_DIR };
