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
    read      MpActor::OnEquip of a book in the pack: onReadBook, then, unless
              it answered false, a spell tome teaches its spell and is spent
              (ReadBookEvent::OnFireSuccess).
    spells    PapyrusActor AddSpell, RemoveSpell, GetSpellCount and
              GetNthSpell over the change form's learnedSpells.
    death     MpActor: onDying, then onDeath, then onRespawn after the delay.
    animate   ActionListener: an animation the client sends for its own
              character is kept as lastAnimEvent (OnUpdateAnimation); a
              movement that is not Standing clears it (OnUpdateMovement), and
              so does coming into the world (PartOne::SetUserActor).
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
/* Each profession's two halves (progression.ts TABLE): the other one is the sister half. */
const HALVES = { warrior: ['bulwark', 'berserker'], alchemist: ['blightbrewer', 'physicker'], cook: ['hearthcook', 'confectioner'],
  smith: ['platewright', 'edgewright'], enchanter: ['bladebinder', 'wardweaver'], tailor: ['liverywright', 'haberdasher'],
  woodworker: ['charburner', 'woodwright'] };

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
  /*
    The gamemode's tables (#5191, #5427): the server reads them from
    <root>\gamemode-tables as it loads, the folder Swap.ps1 moves in beside
    gamemode.js, so the stand-in's root has the same folder, copied from the
    one beside the gamemode it runs.
  */
  fs.cpSync(path.join(path.dirname(SRC), 'gamemode-tables'), path.join(dir, 'gamemode-tables'), { recursive: true });
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

  /*
    A record as mp.lookupEspmRecordById hands it over (ScampServer.cpp):
    { record: { id, editorId, type, flags, fields: [{ type, data }] },
    fileIndex, toGlobalRecordId }, or {} for an id no plugin has. record.id is
    the id as written in its own file: the top byte is the file's place in
    its own masters, and toGlobalRecordId maps such a local id to the load
    order. The plugins themselves are not here, so every file's masters are
    taken to be all the files before it in the load order, which keeps that
    mapping the engine's in every case a record of this stand-in can reach.
    A field's data may be { ref: desc }, four bytes naming that form as the
    record's own file writes it, { bytes: [...], refs: { offset: desc } },
    bytes with such a form id written at each offset, or { floats: [...] };
    anything else is bytes. Records are only what a harness declared with w.record.
  */
  function slotAt(i) { return SLOTS[i]; }
  function slotIndexOf(id) {
    id = id >>> 0;
    if ((id >>> 24) === 0xfe) { const li = (id >>> 12) & 0xfff; return SLOTS.findIndex(function (x) { return x.light && x.index === li; }); }
    const fi = id >>> 24; return SLOTS.findIndex(function (x) { return !x.light && x.index === fi; });
  }
  function globalOf(slot, objectId) {
    return (slot.light ? (0xfe000000 | (slot.index << 12) | (objectId & 0xfff)) : ((slot.index << 24) | (objectId & 0xffffff))) >>> 0;
  }
  function localIn(fileAt, globalId) {
    const target = slotIndexOf(globalId);
    if (target < 0 || target > fileAt) { throw new Error('a record can only name a form of its own file or its masters'); }
    const object = (globalId >>> 0) & (SLOTS[target].light ? 0xfff : 0xffffff);
    return ((target << 24) | object) >>> 0;   // target === fileAt is the file's own: its masters come first
  }
  function bytesIn(realm, list) { const U = realm.Uint8Array; return new U(list); }
  function lookupRecord(id) {
    const r = records.get(id);
    if (!r || !r.type || id >= 0xff000000) { return {}; }
    const at = slotIndexOf(id);
    if (at < 0) { return {}; }
    const realm = proc ? vm.runInContext('({ Uint8Array: Uint8Array, Object: Object })', proc.box) : { Uint8Array: Uint8Array, Object: Object };
    const fields = (r.fields || []).map(function (f) {
      let data;
      if (f.data && f.data.ref !== undefined) {
        const raw = localIn(at, w.idOf(f.data.ref));
        data = bytesIn(realm, [raw & 0xff, (raw >>> 8) & 0xff, (raw >>> 16) & 0xff, raw >>> 24]);
      } else if (f.data && f.data.bytes) {
        const b = f.data.bytes.slice();
        Object.keys(f.data.refs || {}).forEach(function (off) {
          const raw = localIn(at, w.idOf(f.data.refs[off])), o = Number(off);
          b[o] = raw & 0xff; b[o + 1] = (raw >>> 8) & 0xff; b[o + 2] = (raw >>> 16) & 0xff; b[o + 3] = raw >>> 24;
        });
        data = bytesIn(realm, b);
      } else if (f.data && f.data.floats) {
        const b = Buffer.alloc(4 * f.data.floats.length);
        f.data.floats.forEach(function (x, i) { b.writeFloatLE(x, i * 4); });
        data = bytesIn(realm, Array.from(b));
      } else {
        data = bytesIn(realm, Array.from(f.data || []));
      }
      return { type: f.type, data: data };
    });
    return {
      record: { id: localIn(at, id), editorId: r.editorId || '', type: r.type, flags: r.flags || 0, fields: fields },
      fileIndex: at,
      toGlobalRecordId: function (local) {
        local = local >>> 0;
        const b = local >>> 24;
        return globalOf(b < at ? slotAt(b) : slotAt(at), local);
      }
    };
  }

  /* The placed cast and the runtime identities, as WorldState keeps them. */
  let npcExcluded = new Set();
  let runtimeIds = new Map(), nextRuntime = 1;
  function runtimeIdentity(id) { if (!runtimeIds.has(id)) { runtimeIds.set(id, nextRuntime++); } return runtimeIds.get(id); }
  function placedCast() {
    const ids = [];
    for (const [id, r] of records) { if (r.type === 'ACHR') { ids.push(id); } }
    return ids.sort(function (a, b) { return a - b; });
  }
  function baseOf(row) { try { return w.idOf(row.baseDesc); } catch (e) { return 0; } }
  function actorRow(id) {
    const row = store.get(id >>> 0);
    if (!row || row.type !== 'NPC_') { throw new Error('Form with id ' + (id >>> 0).toString(16) + ' is not an actor'); }
    return row;
  }
  function loadPlaced(id) {
    if (store.has(id)) { return store.get(id).type === 'NPC_'; }
    const r = records.get(id);
    const name = (r.fields || []).find(function (f) { return f.type === 'NAME'; });
    const data = (r.fields || []).find(function (f) { return f.type === 'DATA'; });
    if (!name || !name.data || !name.data.ref) { return false; }
    const at = data && data.data && data.data.floats ? data.data.floats : [0, 0, 0, 0, 0, 0];
    store.set(id, {
      type: 'NPC_', profileId: -1, baseDesc: name.data.ref, worldOrCellDesc: r.cell || '3c:Skyrim.esm',
      pos: at.slice(0, 3), angle: at.slice(3, 6).map(function (x) { return x * 180 / Math.PI; }),
      inventory: { entries: [] }, isDead: false, isDisabled: false, isOpen: false
    });
    return true;
  }

  /* What the inventory transactions above share. */
  let savedReceipts = new Map(), savesHeld = false;
  const ITEM_TYPES = ['AMMO', 'ARMO', 'BOOK', 'INGR', 'ALCH', 'SCRL', 'SLGM', 'WEAP', 'MISC', 'LIGH'];   // espm::utils::IsItem
  const ENTRY_INTS = { baseId: 0xffffffff, count: 0xffffffff, enchantmentId: 0xffffffff, poisonId: 0xffffffff, poisonCount: 0xffffffff, soul: 255 };
  const ENTRY_FLOATS = ['health', 'maxCharge', 'chargePercent'];
  const ENTRY_OTHER = ['name', 'removeEnchantmentOnUnequip', 'worn', 'wornLeft', 'made'];
  function inventoryActorId(n) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || n > 0xffffffff) { throw new Error('formId must be a positive uint32 integer'); }
    return n >>> 0;
  }
  function inventorySnapshot(value) {
    const dump = JSON.stringify(value);
    if (dump === undefined || dump.length > 128 * 1024) { throw new Error('Inventory snapshot exceeds 128 KiB'); }
    const json = JSON.parse(dump);
    if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray(json.entries)) { throw new Error('Invalid inventory snapshot'); }
    json.entries.forEach(function (e) {
      if (!e || typeof e !== 'object' || Array.isArray(e)) { throw new Error('Inventory entries must be objects'); }
      if (!('baseId' in e) || !('count' in e)) { throw new Error('Inventory entries require baseId and count'); }
      Object.keys(e).forEach(function (k) {
        if (k in ENTRY_INTS) {
          if (!Number.isInteger(e[k]) || e[k] < 0 || e[k] > ENTRY_INTS[k]) { throw new Error('Inventory integer is outside its native range'); }
        } else if (ENTRY_FLOATS.indexOf(k) >= 0) {
          if (typeof e[k] !== 'number') { throw new Error('Inventory number is outside its native float range'); }
        } else if (ENTRY_OTHER.indexOf(k) < 0) {
          throw new Error('Inventory snapshot cannot be represented exactly');
        }
      });
    });
    return json;
  }
  function checkTransactionInventory(inv) {
    let total = 0;
    inv.entries.forEach(function (e) {
      if (!e.baseId || !e.count) { throw new Error('Invalid transaction inventory entry'); }
      total += e.count;
      if (total > 0xffffffff) { throw new Error('Transaction inventory count exceeds its limit'); }
    });
  }
  function sameInventory(a, b) {
    function canon(v) {
      if (Array.isArray(v)) { return v.map(canon); }
      if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = canon(v[k]); }); return o; }
      return v;
    }
    return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  }
  function receiptOf(row) { return typeof row._inventoryReceipt === 'string' ? row._inventoryReceipt : 'null'; }
  function compareAndSet(id, expectedIn, receipt, nextIn, sequence, profile, property) {
    id = inventoryActorId(id);
    const runtimeAtEntry = runtimeIdentity(id);
    if (!Number.isInteger(sequence) || sequence <= 0 || sequence > Number.MAX_SAFE_INTEGER) { throw new Error('Inventory sequence must be a positive safe integer'); }
    const expected = inventorySnapshot(expectedIn);
    if (typeof receipt !== 'string' || receipt.length < 1 || receipt.length > 1024) { throw new Error('expectedReceipt'); }
    const next = inventorySnapshot(nextIn);
    if (!Number.isInteger(profile) || profile <= 0 || profile > 2147483647) { throw new Error('Inventory profile must be a positive int32 integer'); }
    if (property) {
      if (typeof property.name !== 'string' || !property.name || property.name.length > 128) { throw new Error('property.name'); }
      if (!Number.isInteger(property.expectedLifeGeneration) || property.expectedLifeGeneration < 0) { throw new Error('Inventory lifeGeneration must be a nonnegative safe integer'); }
      if (property.name === '_inventoryReceipt' || BUILT_IN.indexOf(property.name) >= 0 || !made.has(property.name) || madeVisible.has(property.name)) {
        throw new Error('Inventory transaction requires a registered hidden custom property');
      }
      [expected, next].forEach(function (inv) {
        inv.entries.forEach(function (e) {
          const r = records.get(e.baseId >>> 0);
          if (!e.made && (!r || ITEM_TYPES.indexOf(r.type) < 0)) { throw new Error('Invalid inventory transaction base form'); }
        });
      });
    }
    const row = actorRow(id);
    if (runtimeIdentity(id) !== runtimeAtEntry) { return false; }
    if (row.profileId !== profile) { throw new Error('Inventory profile does not match the expected human'); }
    if (receiptOf(row) !== receipt || !sameInventory(row.inventory, expected)) { return false; }
    const identity = w.descOf(id);
    let previous = 0;
    if (receipt !== 'null') {
      const doc = JSON.parse(receipt);
      if (!doc || typeof doc !== 'object' || Object.keys(doc).length !== 3 || doc.actor !== identity || doc.profile !== row.profileId ||
          !Number.isInteger(doc.sequence) || doc.sequence < 0) { throw new Error('Invalid saved inventory receipt'); }
      previous = doc.sequence;
      if (previous === 0) { throw new Error('Invalid saved inventory receipt sequence'); }
    }
    if (sequence <= previous) { throw new Error('Inventory receipt sequence must advance'); }
    checkTransactionInventory(expected);
    checkTransactionInventory(next);
    if (property) {
      if (property.expectedRuntimeIdentity !== undefined && String(property.expectedRuntimeIdentity) !== String(runtimeIdentity(id))) { return false; }
      if (property.expectedLifeGeneration !== (Number(row._skympNpcLifeGeneration) || 0)) { return false; }
      const now = row[property.name] === undefined ? null : row[property.name];
      if (!sameInventory(now, property.expected === undefined ? null : property.expected)) { return false; }
    }
    // Remembered before the write, so the first save after it moves the saved receipt on.
    const key = identity + '|' + row.profileId;
    if (!savedReceipts.has(key) || savedReceipts.get(key).id !== id) { savedReceipts.set(key, { id: id, dump: receiptOf(row) }); }
    row.inventory = copy(next);
    if (property) { row[property.name] = copy(property.replacement); }
    row._inventoryReceipt = JSON.stringify({ actor: identity, profile: row.profileId, sequence: sequence });
    saw(id, 'inventoryTransaction', sequence, copy(next));
    return true;
  }
  /* A save storage acknowledgement: each remembered human's receipt is now its live one. */
  function acknowledgeSaves() {
    if (savesHeld) { return; }
    for (const [key, held] of savedReceipts) {
      const row = store.get(held.id);
      if (row && row.type === 'NPC_' && key === w.descOf(held.id) + '|' + row.profileId) { held.dump = receiptOf(row); }
    }
  }
  w.holdSaves = function (on) { savesHeld = !!on; if (!savesHeld) { acknowledgeSaves(); } };

  // ------------------------------------------------------------ the world --
  /* Every change form, as the engine keeps it, by id. */
  let store = new Map();
  /* What kind of record each reference's base is: DOOR, CONT, FURN, ACTI, NPC_, BOOK ... */
  const records = new Map();
  records.set(0xf, { type: 'MISC', editorId: 'Gold001' });   // the gold every pack carries, Skyrim.esm's own record
  /* Who holds each container or bench open (not saved: the engine keeps it in memory). */
  let occupant = new Map();
  let made = new Set();          // custom properties made with makeProperty, this process
  let madeVisible = new Set();   // those of them the owner or the neighbours see
  let online = [];               // actor ids, by user id order
  let users = new Map();         // actor -> user id
  let nextUser = 0;
  let nextPlaced = 0xff100000;
  let waiting = [];              // lines on the voice service for /commands
  let craftWorkFor = null;       // the actor inside its own onCraftWork
  let craftOutputFor = null;
  let eatScaleFor = null;        // the actor inside its own onEatItem

  w.record = function (desc, type, extra) { records.set(w.idOf(desc) >>> 0, Object.assign({ type: type }, extra || {})); };
  w.cast = function (catalogue, races) {
    races = races || {};
    catalogue.population.keep.forEach(function (r) {
      w.record(r[1], 'NPC_', races[r[12]] ? { race: races[r[12]] } : {});
      w.record(r[0], 'ACHR', { cell: r[2], fields: [{ type: 'NAME', data: { ref: r[1] } }, { type: 'DATA', data: { floats: r[3].concat([0, 0, 0]) } }] });
    });
    Object.keys(catalogue.types).forEach(function (d) { w.record(d, catalogue.types[d]); });
  };
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
      isDead: false, isDisabled: false, percentages: { health: 1, magicka: 1, stamina: 1 },
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
      // progression.ts: 'The sister half is added at novice the moment half is chosen.'
      const pair = HALVES[prof] || [];
      if (half && pair.length === 2) { ranks[pair[0] === half ? pair[1] : pair[0]] = 'novice'; }
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
  /*
    Moving: a movement message that is not Standing, which also clears the
    last animation the client sent (ActionListener::OnUpdateMovement).
  */
  w.moveTo = function (id, cell, pos) { const r = store.get(id >>> 0); r.worldOrCellDesc = cell; r.pos = pos.slice(); r.lastAnimEvent = null; };
  /* An animation the client sent for its own character: the engine keeps its name as lastAnimEvent (ActionListener::OnUpdateAnimation). */
  w.animate = function (id, eventName) { const r = store.get(id >>> 0); r.lastAnimEvent = String(eventName); saw(id >>> 0, 'animation', '', String(eventName)); };
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
          // CraftOutputBinding::Set: baseId, count and name each stay what they were when left out; a null name names none.
          if (v && v.baseId !== undefined) { craftOutputFor.out.baseId = v.baseId >>> 0; }
          if (v && v.count !== undefined) { craftOutputFor.out.count = v.count >>> 0; }
          if (v && v.name === null) { delete craftOutputFor.out.name; } else if (v && v.name !== undefined) { craftOutputFor.out.name = String(v.name); }
          return;
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
      if (options.isVisibleByOwner || options.isVisibleByNeighbors) { madeVisible.add(name); }
    },
    makeEventSource: function () { },
    getDescFromId: function (id) { return w.descOf(id); },
    getIdFromDesc: function (d) { return w.idOf(d); },
    getEspmLoadOrder: function () { return SLOTS.map(function (s) { return s.file; }); },
    lookupEspmRecordById: function (id) { return lookupRecord(id >>> 0); },
    getServerSettings: function () { return JSON.parse(fs.readFileSync(path.join(dir, 'server-settings.json'), 'utf8')); },
    writeFileWhole: function (f, text) { fs.writeFileSync(f, text); },
    /*
      The placed cast (WorldState PrepareNpcLoad, LoadNpcBatch, GetLoadedNpcIds):
      every ACHR record a harness declared, by id, made into an actor the first
      time a batch reaches it, from its record: its base, its cell (w.record's
      cell), its place and turn (the DATA field). The engine skips the human's
      own reference (14:Skyrim.esm) and any excluded placement.
    */
    prepareNpcLoad: function () { return placedCast().length; },
    loadNpcBatch: function (cursor, limit) {
      if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 128) {
        throw new Error('NPC batch requires an unsigned integer cursor and limit from 1 to 128');
      }
      const ids = placedCast();
      if (cursor > ids.length) { throw new Error('NPC batch cursor exceeds the placed cast'); }
      const end = cursor + Math.min(limit, ids.length - cursor);
      const out = [];
      for (let i = cursor; i < end; i++) {
        if (npcExcluded.has(ids[i]) || ids[i] === 0x14) { continue; }
        if (loadPlaced(ids[i])) { out.push(ids[i]); }
      }
      return { nextCursor: end, total: ids.length, actorIds: out };
    },
    getLoadedNpcIds: function () {
      const out = [];
      for (const [id, row] of store) { if (row.type === 'NPC_' && !(row.profileId >= 0) && online.indexOf(id) < 0) { out.push(id); } }
      return out.sort(function (a, b) { return a - b; });
    },
    setNpcPlacementExclusions: function (ids) {
      if (!Array.isArray(ids)) { throw new Error('NPC exclusions must be an array'); }
      ids.forEach(function (id) {
        const r = records.get(id >>> 0);
        if (!r || r.type !== 'ACHR') { throw new Error('An NPC exclusion must name an ACHR record'); }
      });
      npcExcluded = new Set(ids.map(function (id) { return id >>> 0; }));
      npcExcluded.forEach(function (id) { const row = store.get(id); if (row) { row.serverControlled = true; row.isDisabled = true; } });
    },
    setNpcServerControlled: function (id, on) {
      if (typeof on !== 'boolean') { throw new Error('controlled must be boolean'); }
      actorRow(id).serverControlled = on;
    },
    setNpcDifficultyTier: function (id, tier) {
      if (!Number.isInteger(tier) || tier < 0 || tier > 4) { throw new Error('tier must be an integer from 0 to 4'); }
      actorRow(id).difficultyTier = tier;
    },
    updateNpcMovement: function (id, pos, angle, speed) {
      if (!(speed >= 0 && speed <= 300)) { throw new Error('speed must be finite and from 0 to 300'); }
      const row = actorRow(id); row.pos = [pos[0], pos[1], pos[2]]; row.angle = [angle[0], angle[1], angle[2]];
    },
    stopNpcMovement: function (id) { actorRow(id); },
    getNavmeshRecords: function () { return []; },
    getFactionReactions: function (list) { if (!Array.isArray(list)) { throw new Error('factionIds must be an array'); } return []; },
    getLoadedFormCount: function () { return store.size; },
    getActorRuntimeIdentity: function (id) { actorRow(id); return String(runtimeIdentity(id >>> 0)); },
    getNpcAIState: function (id) {
      const row = actorRow(id);
      const ai = (records.get(baseOf(row)) || {}).ai || [0, 4];
      return {
        profileId: typeof row.profileId === 'number' ? row.profileId : -1, pos: row.pos.slice(), rot: row.angle.slice(),
        cellOrWorld: w.idOf(row.worldOrCellDesc), isDead: !!row.isDead, isDisabled: !!row.isDisabled,
        isHuman: row.profileId >= 0, isConnected: online.indexOf(id >>> 0) >= 0, isServerControlled: !!row.serverControlled,
        lifeGeneration: Number(row._skympNpcLifeGeneration) || 0, runtimeLifeIdentity: String(runtimeIdentity(id >>> 0)),
        difficultyTier: row.difficultyTier || 0, aggression: ai[0], confidence: ai[1],
        meleeReach: 0, meleeAllowance: 16, canSwim: false, canFly: false, immobile: false, combatTarget: 0, factions: []
      };
    },
    /* PrivateEconomyLedger.h: the marker once, then the ledger replaced whole, in privDir. */
    writePrivateEconomyLedger: function (name, bytes) {
      name = String(name); bytes = String(bytes);
      if (name !== 'merchant' && name !== 'dungeon-rewards') { throw new Error('Unknown private economy ledger'); }
      const settings = JSON.parse(fs.readFileSync(path.join(dir, 'server-settings.json'), 'utf8'));
      const priv = path.resolve(dir, settings.privDir || 'private');
      fs.mkdirSync(priv, { recursive: true });
      const marker = path.join(priv, name + '-ledger.initialized');
      if (!fs.existsSync(marker)) { fs.writeFileSync(marker, '1'); }
      fs.writeFileSync(path.join(priv, name + '-ledger.json.tmp'), bytes);
      fs.renameSync(path.join(priv, name + '-ledger.json.tmp'), path.join(priv, name + '-ledger.json'));
      return true;
    },
    /*
      Inventory transactions (ScampServer.cpp ValidateInventoryTransaction,
      CompareAndSetInventoryImpl, GetInventoryReceipt, GetSavedInventoryReceipt;
      MpObjectReference::CompareAndSetInventory; WorldState's saved receipts).
      A human's receipt is its _inventoryReceipt field, "null" until the first
      transaction, then {actor, profile, sequence}. The saved receipt is the
      one the last save storage acknowledgement carried: remembered from the
      live one the first time it is asked for, moved on at each save (w.run),
      and forgotten when the server starts over. w.holdSaves(true) keeps the
      save storage from acknowledging anything, as a slow database would.
    */
    validateInventoryTransaction: function (snapshot) { checkTransactionInventory(inventorySnapshot(snapshot)); return true; },
    compareAndSetInventory: function (id, expected, receipt, next, sequence, profile) {
      return compareAndSet(id, expected, receipt, next, sequence, profile, null);
    },
    compareAndSetInventoryAndProperty: function (id, expected, receipt, next, sequence, profile, property) {
      if (!property || typeof property !== 'object') { throw new Error('property must be an object'); }
      return compareAndSet(id, expected, receipt, next, sequence, profile, property);
    },
    /* ScampServer.cpp CompareAndSetActorProperty, MpActor::CompareAndSetActorProperty: one hidden property, no inventory. */
    compareAndSetActorProperty: function (id, profile, property) {
      id = inventoryActorId(id);
      const runtimeAtEntry = runtimeIdentity(id);
      if (!Number.isInteger(profile) || profile <= 0 || profile > 2147483647) { throw new Error('Actor profile must be a positive int32 integer'); }
      if (!property || typeof property !== 'object') { throw new Error('property must be an object'); }
      const runtime = property.expectedRuntimeIdentity;
      if (typeof runtime !== 'string' || !/^[1-9][0-9]{0,19}$/.test(runtime)) { throw new Error('Invalid actor runtime identity'); }
      if (typeof property.name !== 'string' || !property.name || property.name.length > 128) { throw new Error('property.name'); }
      if (!Number.isInteger(property.expectedLifeGeneration) || property.expectedLifeGeneration < 0) { throw new Error('Actor lifeGeneration must be a nonnegative safe integer'); }
      if (property.name[0] === '_' || BUILT_IN.indexOf(property.name) >= 0 || !made.has(property.name) || madeVisible.has(property.name)) {
        throw new Error('Actor metadata requires a registered hidden custom property');
      }
      const row = actorRow(id);
      if (runtimeIdentity(id) !== runtimeAtEntry) { return false; }
      if (!(profile > 0) || row.profileId !== profile || runtime !== String(runtimeIdentity(id))) { return false; }
      if (property.expectedLifeGeneration !== (Number(row._skympNpcLifeGeneration) || 0)) { return false; }
      const now = row[property.name] === undefined ? null : row[property.name];
      if (!sameInventory(now, property.expected === undefined ? null : property.expected)) { return false; }
      row[property.name] = copy(property.replacement);
      saw(id, 'set', property.name, copy(property.replacement));
      return true;
    },
    getInventoryReceipt: function (id) {
      const row = actorRow(inventoryActorId(id));
      if (!(row.profileId > 0)) { throw new Error('Inventory receipts require a human profile'); }
      return receiptOf(row);
    },
    getSavedInventoryReceipt: function (id) {
      id = inventoryActorId(id);
      const row = actorRow(id);
      if (!(row.profileId > 0)) { throw new Error('Inventory receipts require a human profile'); }
      const key = w.descOf(id) + '|' + row.profileId;
      const held = savedReceipts.get(key);
      if (!held || held.id !== id) { savedReceipts.set(key, { id: id, dump: receiptOf(row) }); }
      return savedReceipts.get(key).dump;
    },
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
      /* ScampServer::Place: an NPC_ record becomes an actor (MpActor), anything else a reference of the record's type. */
      const rec = records.get(baseId >>> 0);
      if (rec.type === 'NPC_') { w.ref(id, { base: desc, type: 'NPC_', profileId: -1, isDead: false }); }
      else { w.ref(id, { base: desc, type: rec.type }); }
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
        // MpObjectReference::SetDisplayName keeps the name on the change form, and every listener is told.
        case 'SetDisplayName': row.displayName = String(args[0]); saw(id, 'set', 'displayName', String(args[0])); return undefined;
        case 'Disable': row.isDisabled = true; return undefined;
        case 'Enable': row.isDisabled = false; return undefined;
        case 'Delete': store.delete(id); return undefined;
        case 'GetPositionX': return row.pos[0];
        case 'GetPositionY': return row.pos[1];
        case 'GetPositionZ': return row.pos[2];
      }
    }
    // Actor.DamageActorValue (MpActor::DamageActorValue): the value over the
    // actor's most, off its percentage. Health is modeled; the most is the
    // row's maxHealth, 100 unless the scenario says (a level 1 character's).
    if (key === 'method Actor.DamageActorValue' && row) {
      if (String(args[0]).toLowerCase() === 'health') { w.hurtBy(id, Math.abs(Number(args[1]) || 0), 0); return undefined; }
    }
    // The spell list (PapyrusActor AddSpell, RemoveSpell, GetSpellCount,
    // GetNthSpell): the change form's learnedSpells, by global id. Only a SPEL
    // record is added or taken off; a form no plugin has answers false.
    if (kind === 'method' && cls === 'Actor' && row && row.type === 'NPC_' &&
        (fn === 'AddSpell' || fn === 'RemoveSpell' || fn === 'GetSpellCount' || fn === 'GetNthSpell')) {
      const list = row.learnedSpells = row.learnedSpells || [];
      if (fn === 'GetSpellCount') { return list.length; }
      if (fn === 'GetNthSpell') {
        const n = Number(args[0]);
        return n >= 0 && n < list.length ? { type: 'espm', desc: w.descOf(list[n]) } : undefined;
      }
      let spell = 0;
      try { spell = args[0] && args[0].desc !== undefined ? w.idOf(args[0].desc) : 0; } catch (e) { spell = 0; }
      const rec = spell ? records.get(spell) : null;
      if (!rec || rec.type !== 'SPEL') { return false; }
      const at = list.indexOf(spell);
      if (fn === 'AddSpell') { if (at !== -1) { return false; } list.push(spell); saw(id, 'spell', w.descOf(spell), true); return true; }
      if (at === -1) { return false; }
      list.splice(at, 1); saw(id, 'spell', w.descOf(spell), false); return true;
    }
    // Actor.GetRace: a person's race from their appearance, anyone else's from their base record's (w.record's race).
    if (key === 'method Actor.GetRace' && row && row.type === 'NPC_') {
      const race = row.appearance && row.appearance.raceId ? w.descOf(row.appearance.raceId) : (records.get(baseOf(row)) || {}).race;
      return race ? { type: 'espm', desc: race } : undefined;
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
    /*
      The dice (w.dice) go in before the gamemode loads, so a block that keeps
      Math.random itself (the durability block's api.random) rolls them too.
      Until a scenario holds them they roll as Math.random does.
    */
    vm.runInContext('Math.__standInRandom = Math.random; Math.random = function () {' +
      ' var d = globalThis.__standInDice; return typeof d === "number" ? d : Math.__standInRandom(); };', box);
    proc = { box: box, timers: timers, err: null };
    made = new Set();
    madeVisible = new Set();
    savedReceipts = new Map();      // a new WorldState remembers no saved receipt
    runtimeIds = new Map();         // and every actor it loads is a new runtime object
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
      // The engine's own timers: a body's respawn (MpActor::RespawnWithDelay).
      const due = engineTimers.filter(function (e) { return e.at <= end && (!next || e.at <= next.at); })
        .sort(function (a, b) { return a.at - b.at; })[0];
      if (due) {
        clock = Math.max(clock, due.at);
        engineTimers.splice(engineTimers.indexOf(due), 1);
        due.fn();
        continue;
      }
      // The save storage acknowledges a batch every SAVE_EVERY (WorldState::TickSaveStorage).
      if (saveAt <= end && (!next || saveAt <= next.at)) {
        clock = Math.max(clock, saveAt);
        saveAt += SAVE_EVERY;
        acknowledgeSaves();
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
    row.lastAnimEvent = null;   // not saved client side, so reset (PartOne::SetUserActor)
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
  const engineTimers = [];
  const SAVE_EVERY = 100;
  let saveAt = clock + SAVE_EVERY;
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
    // CraftOutputBinding::Get inside onCraft: the craft's own output until the gamemode names another.
    craftOutputFor = { actor: actorId, out: { baseId: c.output >>> 0, count: c.count || 1 } };
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
  /*
    A book read (MpActor::OnEquip, ReadBook): only one in the pack is read.
    onReadBook goes first; false keeps the book and the spell (the client is
    told to RemoveSpell, OnFireBlocked). Otherwise, for a book whose DATA
    carries TeachesSpell (0x04) with the spell at offset 4, a spell the
    character has not learned is learned and the book leaves the pack; one
    already learned leaves the book where it is (ReadBookEvent::OnFireSuccess).
    Answers { sent, allowed, learned }.
  */
  w.readBook = function (actorId, baseId) {
    actorId = actorId >>> 0; baseId = baseId >>> 0;
    const rec = records.get(baseId);
    if (!rec || rec.type !== 'BOOK') { return { sent: false, why: 'not a book' }; }
    if (w.count(actorId, baseId) < 1) { return { sent: false, why: 'not in the pack' }; }
    const allowed = fire('onReadBook', [actorId, baseId]);
    if (allowed === false) { return { sent: true, allowed: false, learned: false }; }
    const res = lookupRecord(baseId);
    const data = ((res.record && res.record.fields) || []).find(function (f) { return f.type === 'DATA'; });
    const b = data ? data.data : [];
    if (!(b.length >= 8 && (b[0] & 0x04))) { return { sent: true, allowed: allowed, learned: false }; }
    const spellId = res.toGlobalRecordId((b[4] | (b[5] << 8) | (b[6] << 16)) + b[7] * 0x1000000);
    const row = store.get(actorId);
    row.learnedSpells = row.learnedSpells || [];
    if (row.learnedSpells.indexOf(spellId) !== -1) { return { sent: true, allowed: allowed, learned: false }; }
    row.learnedSpells.push(spellId);
    moveItems(actorId, 0, baseId, 1, '');
    return { sent: true, allowed: allowed, learned: true };
  };
  /* The spells the engine holds for a character (ChangeForm learnedSpells), as global ids. */
  w.spellsOf = function (actorId) { const r = store.get(actorId >>> 0); return r && r.learnedSpells ? r.learnedSpells.slice() : []; };
  w.equip = function (actorId, baseId) { return fire('onEquipItemAttempt', [actorId >>> 0, baseId]); };
  w.drop = function (actorId, baseId, count) { return fire('onDropItem', [actorId >>> 0, baseId, count]); };
  /* Going down and dying (MpActor): onDying, onDeath, and onRespawn after delayMs. */
  /*
    MpActor::SendAndSetDeathState: dying and coming back each make the actor
    a new runtime object (InvalidateRuntimeIdentity), and a server-controlled
    one comes back one life generation on (_skympNpcLifeGeneration). A
    delayMs of null leaves the body lying (a placed NPC's respawn is hours);
    left out, the body lies its spawnDelay (MpChangeForm, 25 seconds unless
    something wrote it), as MpActor::RespawnWithDelay reads it.
  */
  /*
    A write that takes health to nothing (MpActor::NetSetPercentages,
    SetPercentage, fork #101): onDying is asked first, and false keeps them
    alive at dyingHealth; otherwise the death is sent, onDeath is raised with
    the killer (none for a bleed), and the body lies its spawnDelay before the
    engine stands it up (RespawnWithDelay).
  */
  function maxHealthOf(row) { return Number(row.maxHealth) > 0 ? Number(row.maxHealth) : 100; }
  w.health = function (actorId) { const r = store.get(actorId >>> 0); return r && r.percentages ? r.percentages.health : undefined; };
  w.hurtBy = function (actorId, points, killerId) {
    actorId = actorId >>> 0;
    const row = store.get(actorId);
    if (!row || row.isDead) { return; }
    const p = Object.assign({ health: 1, magicka: 1, stamina: 1 }, row.percentages || {});
    p.health = Math.max(0, p.health - points / maxHealthOf(row));
    row.percentages = p;
    if (p.health > 0) { return; }
    if (fire('onDying', [actorId, killerId || 0]) === false) {
      row.percentages = Object.assign({}, p, { health: Number(row.dyingHealth) > 0 ? Number(row.dyingHealth) : 0.1 });
      return;
    }
    row.isDead = true;
    runtimeIds.delete(actorId);
    fire('onDeath', [actorId, killerId || 0]);
    const lies = Number(row.spawnDelay);
    engineTimers.push({ at: clock + (lies >= 0 ? lies : 25) * 1000, fn: function () { w.respawn(actorId); } });
  };
  /*
    A blow (ActionListener::OnWeaponHit): the server decides a block, sends
    OnHit to the target (akAggressor, akSource, akProjectile, abPowerAttack,
    abSneakAttack, abBashAttack, abHitBlocked), then works out the damage and
    writes health in the same call. opts: { power, sneak, bash, blocked,
    damage } with damage in health points. A source of 0 is a fist or a claw.
  */
  w.hit = function (targetId, aggressorId, source, opts) {
    opts = opts || {};
    targetId = targetId >>> 0;
    fire('onPapyrusEvent:OnHit', [targetId, { type: 'form', desc: w.descOf(aggressorId >>> 0) },
      source ? { type: 'espm', desc: typeof source === 'string' ? source : w.descOf(source) } : null, null,
      !!opts.power, !!opts.sneak, !!opts.bash, !!opts.blocked]);
    if (opts.damage) { w.hurtBy(targetId, opts.damage, aggressorId >>> 0); }
  };
  /*
    The dice: while a scenario holds them at a number, every Math.random in
    the gamemode comes up that number (a roll it checks, and whatever else
    rolls in that window); w.dice(null) lets them roll for themselves again.
  */
  w.dice = function (value) {
    proc.box.__standInDice = (value === null || value === undefined) ? null : Number(value);
  };
  w.die = function (actorId, killerId, delayMs) {
    actorId = actorId >>> 0;
    fire('onDying', [actorId, killerId || 0]);
    store.get(actorId).isDead = true;
    runtimeIds.delete(actorId);
    fire('onDeath', [actorId, killerId || 0]);
    if (delayMs === null) { return; }
    const lies = Number(store.get(actorId).spawnDelay);
    w.run(delayMs === undefined ? (lies >= 0 ? lies : 25) * 1000 : delayMs);
    w.respawn(actorId);
  };
  /*
    MpActor::Respawn fires RespawnEvent; false from a listener blocks it and
    the actor stays dead (GameModeEvent::Fire, OnFireBlocked). Otherwise
    OnFireSuccess stands it up at GetSpawnPoint(): a character's spawnPoint,
    or a placed reference's own place in the plugin (GetEditorLocationalData),
    wherever it fell.
  */
  w.respawn = function (actorId) {
    actorId = actorId >>> 0;
    const row = store.get(actorId);
    if (!row.isDead) { return; }
    if (fire('onRespawn', [actorId]) === false) { return; }
    if (row.serverControlled) { row._skympNpcLifeGeneration = (Number(row._skympNpcLifeGeneration) || 0) + 1; }
    row.isDead = false;
    runtimeIds.delete(actorId);
    // SendAndSetDeathState: the respawn percentages, full unless written.
    row.percentages = Object.assign({ health: 1, magicka: 1, stamina: 1 }, row.respawnPercentages || {});
    const sp = row.spawnPoint;
    const placed = records.get(actorId);
    if ((row.profileId || actorId >= 0xff000000) && sp && sp.cellOrWorldDesc && Array.isArray(sp.pos)) {
      row.worldOrCellDesc = sp.cellOrWorldDesc;
      row.pos = sp.pos.slice();
    } else if (!(row.profileId >= 0) && actorId < 0xff000000 && placed && placed.type === 'ACHR') {
      // GetSpawnPoint for a placed reference is GetEditorLocationalData: its
      // place in the plugin, wherever it fell.
      const data = (placed.fields || []).find(function (f) { return f.type === 'DATA'; });
      row.worldOrCellDesc = placed.cell || '3c:Skyrim.esm';
      if (data && data.data && data.data.floats) { row.pos = data.data.floats.slice(0, 3); }
    }
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
  /* A file in the private folder written from outside the gamemode, as the door's fetch of the site writes allowed.json. */
  w.writePrivate = function (name, value) {
    fs.writeFileSync(path.join(dir, 'private', name), typeof value === 'string' ? value : JSON.stringify(value));
  };
  return w;
}

/*
  The placed cast and the item records the gamemode's NPC startup reads, out
  of game/gamemode.js itself: NPC_POPULATION_DATA (its plugins, which a world
  with this load order must have, and keep, the placed people), and the
  record type of every item its merchant and quest catalogues name (their
  "types" and "itemTypes" tables and each "item" named with an "itemType").
  w.cast(catalogue, races) declares them all: each kept person's base as an
  NPC_ (with races[species] as its race when given) and its placement as an
  ACHR at its cell, place and turn, and each item record by its type.
*/
let catalogueCache = null;
function npcCatalogue() {
  if (catalogueCache) { return catalogueCache; }
  const gm = fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8');
  const at = gm.indexOf('const NPC_POPULATION_DATA = ');
  const population = JSON.parse(gm.slice(at + 'const NPC_POPULATION_DATA = '.length, gm.indexOf('\n', at)).replace(/;\s*$/, ''));
  // The item catalogues are tables beside the gamemode since #5191 (#5427).
  const tables = path.join(REPO_DIR, 'game', 'gamemode-tables');
  const text = [gm].concat(fs.readdirSync(tables).filter(function (n) { return /\.json$/.test(n); }).sort()
    .map(function (n) { return fs.readFileSync(path.join(tables, n), 'utf8'); })).join('\n');
  const types = {};
  function objectsAfter(key) {
    const out = [];
    for (let from = 0; ;) {
      const k = text.indexOf(key, from);
      if (k < 0) { break; }
      const open = k + key.length - 1;
      let depth = 0, quoted = false, escaped = false;
      for (let n = open; n < text.length; n++) {
        const c = text[n];
        if (quoted) { if (escaped) { escaped = false; } else if (c === '\\') { escaped = true; } else if (c === '"') { quoted = false; } continue; }
        if (c === '"') { quoted = true; } else if (c === '{') { depth++; } else if (c === '}' && --depth === 0) {
          try { out.push(JSON.parse(text.slice(open, n + 1))); } catch (e) { }
          break;
        }
      }
      from = k + 1;
    }
    return out;
  }
  objectsAfter('"types":{').concat(objectsAfter('"itemTypes":{')).forEach(function (o) {
    Object.keys(o).forEach(function (k) { if (typeof o[k] === 'string') { types[k] = o[k]; } });
  });
  const re = /"item":"([0-9a-f]+:[^"]+)"[^{}[\]]*?"itemType":"([A-Z]+)"/g;
  let m;
  while ((m = re.exec(text))) { types[m[1]] = m[2]; }
  catalogueCache = { population: population, types: types };
  return catalogueCache;
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
        // A scenario whose gamemode did not load has checked nothing (#5427).
        c.yes('Y the gamemode loaded and stayed loaded' + (w.loaded() ? '' : ': ' + String(w.loadError()).split('\n')[0]), w.loaded());
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

module.exports = { world: world, checks: checks, npcCatalogue: npcCatalogue, ENGINE_METHODS: ENGINE_METHODS, BUILT_IN: BUILT_IN, REPO_DIR: REPO_DIR };
