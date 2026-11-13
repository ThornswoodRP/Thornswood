// test-cast-table.js
//
// The surviving cast, written down before anything is deleted.
//
// Entry 320, settled by Patrick on 17 September: "What survives: traders you
// can buy from and sell to through the custom economy in entry 214, and the
// carriage and ferry workers in entry 215. Everything else is either rebuilt as
// a custom character or removed." And: "Write the surviving cast down as a list
// before anything is deleted, because the deletion is the part that cannot be
// undone".
//
// scripts/dev/Build-CastTable.py writes that list into tools/cast.json. This drives
// the real script against a small load order built here, byte by byte, where
// every answer is known, and then reads the committed cast.json for the people
// the list has to get right in the real one.
//
// The load order built here carries each trap the script was written around:
//   - a compressed NPC_ record, which has to be inflated before it says anything
//   - a vendor faction at rank -1, which is not membership (Faendal)
//   - a job merchant faction at rank 0 with no vendor faction, which is not a
//     trader either
//   - a vendor-flagged faction with no buy and sell list, which is who owns an
//     inn rather than a shop
//   - IsGuardFaction alone, which the Companions carry and are not the watch
//   - a thin guard whose own race is a wolf and whose name, race and factions
//     all come from its template, and one whose template is a leveled list
//     that names a guard first and a wolf last, read through its first entry
//   - a thin guard at home in a house that names no place, placed by the
//     crime faction of its template, since the crime faction comes with the
//     factions and the thin record has none
//   - templates that give some traits and not others, which the ACBS use bits
//     decide one trait at a time: a carriage driver whose template gives him
//     nothing he is checked on (0x230, the way CFTO.esp builds Bjorlam), and a
//     merchant whose race and name come from the template and whose factions
//     are its own (0xecb, the way Populated Cities builds its merchants). Both
//     are checked by reference. The thin guards above take all three traits
//     from the template, so on their own they cannot tell a pass that reads
//     the bits from one that always follows the template, and on the live
//     load order that pass loses 224 traders, 23 carriage and ferry workers
//     and 361 guards.
//   - the race bit and the name bit set apart: a fishmonger whose race alone
//     comes from its template (0x1) and a stall keeper whose name alone does
//     (0x80), each placed only by a crime faction of its own that its template
//     does not share. Every other templated person here sets both bits or
//     neither, so without these two a pass that reads the race through the
//     name bit, or the name, the unique flag or the crime faction through the
//     wrong one of the two, passed every check. On the live load order that
//     slip is not small: reading the race through the name bit loses 221
//     traders and 287 guards, and reading the crime faction through the race
//     bit puts 239 more people under no hold.
//   - a placement switched off by its own flag
//   - enable parents every way a real one comes: a marker switched off by its
//     own flag, a marker that follows it, a marker set opposite to it, a
//     marker a patch switches back on, a marker that is simply on, and a
//     placed person switched off. A trader hangs off each, so the answer for
//     every one is checked by its reference and not only by a count. Two
//     children of one parent, one plain and one opposite, are not enough on
//     their own: a pass that never read the parent swaps them and the count
//     comes out the same. The guards are uneven for the same reason, two off
//     and one switched on, so their count moves when the parent is not read.
//   - a worldspace's persistent cell, which says it is at 0,0 and is not the
//     ground at 0,0
//   - a patch naming its master SKYRIM.ESM, which is the same file as Skyrim.esm
//     and must not make a second Bjorlam
//   - a plugins.txt that lists Skyrim.esm again as skyrim.esm, the same file,
//     which is read once and not twice
//   - a patch deleting a placement and keeping nothing of it but the flag
//
// Read only apart from a folder in the temp directory, removed at the end.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const TOOL = process.env.CAST_TOOL || path.join(REPO_DIR, 'scripts', 'dev', 'Build-CastTable.py');
yes('scripts/dev/Build-CastTable.py is in the repo', fs.existsSync(TOOL));
// #3543: Thornswood-Last.esp switches off every actor the catalogue cuts. The
// cast is the list written before that deletion, so none of its records are
// read but its places: its locations over the ones before it, and of its cells
// only the location, as Build-NpcPopulation.py reads them (#5089).
const toolText = fs.existsSync(TOOL) ? fs.readFileSync(TOOL, 'utf8') : '';
yes('Thornswood-Last.esp keeps its place in the load order, and of it only the locations and its cells\' locations are read',
  /LAST_PLUGIN = 'Thornswood-Last\.esp'/.test(toolText) &&
  /if name == LAST_PLUGIN:\r?\n[\s\S]*?read\(pl, places\)\r?\n[\s\S]*?\r?\n {12}continue\r?\n {8}read\(pl, t\)\r?\n/.test(toolText));

// ------------------------------------------------------------ plugin bytes
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function f32(n) { const b = Buffer.alloc(4); b.writeFloatLE(n, 0); return b; }
function zstr(s) { return Buffer.from(s + '\0', 'utf8'); }
function sub(tag, body) {
  const h = Buffer.alloc(6);
  h.write(tag, 0, 'ascii');
  h.writeUInt16LE(body.length, 4);
  return Buffer.concat([h, body]);
}
function rec(tag, fid, subs, flags, compress) {
  let data = Buffer.concat(subs);
  flags = flags || 0;
  if (compress) {
    data = Buffer.concat([u32(data.length), zlib.deflateSync(data)]);
    flags |= 0x00040000;
  }
  const h = Buffer.alloc(24);
  h.write(tag, 0, 'ascii');
  h.writeUInt32LE(data.length, 4);
  h.writeUInt32LE(flags >>> 0, 8);
  h.writeUInt32LE(fid >>> 0, 12);
  return Buffer.concat([h, data]);
}
function grup(label, type, kids) {
  const body = Buffer.concat(kids);
  const h = Buffer.alloc(24);
  h.write('GRUP', 0, 'ascii');
  h.writeUInt32LE(24 + body.length, 4);
  label.copy(h, 8);
  h.writeUInt32LE(type, 12);
  return Buffer.concat([h, body]);
}
function top(tag, kids) { return grup(Buffer.from(tag, 'ascii'), 0, kids); }
function tes4(masters) {
  const subs = [sub('HEDR', Buffer.concat([f32(1.7), u32(0), u32(0x800)]))];
  masters.forEach(function (m) { subs.push(sub('MAST', zstr(m)), sub('DATA', Buffer.alloc(8))); });
  return rec('TES4', 0, subs, 1);
}
const edid = function (s) { return sub('EDID', zstr(s)); };
const full = function (s) { return sub('FULL', zstr(s)); };
const kwda = function (ids) { return sub('KWDA', Buffer.concat(ids.map(u32))); };
function snam(fid, rank) {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(fid, 0);
  b.writeInt8(rank, 4);
  return sub('SNAM', b);
}
function acbs(flags, uses) {
  const b = Buffer.alloc(24);
  b.writeUInt32LE(flags >>> 0, 0);
  b.writeUInt16LE(uses, 18);
  return sub('ACBS', b);
}
function fdata(flags) { return sub('DATA', u32(flags)); }
function xesp(parent, flags) {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(parent, 0);
  b[4] = flags;
  return sub('XESP', b);
}
function pos(x, y) { return sub('DATA', Buffer.concat([f32(x), f32(y), f32(0), f32(0), f32(0), f32(0)])); }
function xclc(x, y) {
  const b = Buffer.alloc(12);
  b.writeInt32LE(x, 0);
  b.writeInt32LE(y, 4);
  return sub('XCLC', b);
}
function achr(fid, base, more, flags) { return rec('ACHR', fid, [sub('NAME', u32(base))].concat(more || []), flags); }
function children(cell, kids) { return grup(u32(cell), 6, [grup(u32(cell), 8, kids)]); }

const VENDOR = 0x4000, DISABLED = 0x800, DELETED = 0x20;
const UNIQUE = 0x20;
const TRAITS = 0x1, FACTIONS = 0x4, BASE = 0x80;
// Two sets of use bits read off the live load order on 24 September. CFTO's
// Bjorlam (6ae98:CFTO.esp) takes AI data, AI packages and his script from
// KmodCarriageDriverTemplate and nothing else. The Populated Cities merchants
// take race, name, stats, spells, model, script and the rest from theirs, but
// not factions. Neither sets FACTIONS.
const CFTO_USES = 0x230, POPULATED_USES = 0xecb;
// The commonest templated trader on the live load order takes its race from
// the template and its name and factions from its own record: 221 of the 289
// templated traders standing on 24 September set the race bit without the
// name bit. None set the name bit alone, but 17 set it with the factions bit
// and not the race bit, so the two bits really do come apart both ways.
const RACE_ONLY_USES = TRAITS, NAME_ONLY_USES = BASE;
const SQ = 4096;

// Skyrim.esm, the whole world in miniature. Every form id is its own (index 0).
const K = { hold: 0x100, npc: 0x101 };
const R = { nord: 0x200, wolf: 0x201, manakin: 0x202 };
const L = { whiterunHold: 0x300, whiterun: 0x301, riftHold: 0x302, belethors: 0x303 };
const F = {
  belethor: 0x400, follower: 0x401, carriage: 0x402, isGuard: 0x403, guardTalk: 0x404,
  guardWhiterun: 0x405, crimeWhiterun: 0x406, mareOwner: 0x407, jobMerchant: 0x408,
  market: 0x409, riftenMarket: 0x40A, crimeRift: 0x40B,
};
const N = {
  belethor: 0x500, faendal: 0x501, bjorlam: 0x502, guard: 0x503, thin: 0x504, wolf: 0x505,
  mannequin: 0x506, gjalund: 0x507, aela: 0x508, patron: 0x509, nazeem: 0x50A,
  leveled: 0x50B, hermit: 0x50C, riftTrader: 0x50D, market: 0x50E,
  driverTemplate: 0x50F, sigaar: 0x510, merchantTemplate: 0x511, merchant: 0x512,
  fishTemplate: 0x513, fishmonger: 0x514, keeperTemplate: 0x515, keeper: 0x516,
};
// Where Sigaar, the Riften merchant, the fishmonger and the stall keeper are
// placed, so each is found by its reference and not by a name a template could
// have handed it.
const SIGAAR = 0x81C, MERCHANT = 0x81D, FISHMONGER = 0x81E, STALL_KEEPER = 0x81F;
const GUARD_AT_HOME = 0x81B;
const LV = 0x600;
const C = { shop: 0x700, house: 0x701, backRoom: 0x702 };
const W = { tamriel: 0x900, persistent: 0x901, whiterunSq: 0x902, openSq: 0x903, riftSq: 0x904,
  farSq: 0x905, zeroSq: 0x906 };
// The enable parents, all REFRs. marker is switched off by its own flag. chain
// follows marker, so it is off too; flip is set opposite to marker, so it is
// on. relit is switched off here and back on by the patch, last one wins.
// lamp is on and nothing says otherwise, which is why the script never keeps
// a row for it.
const P = { marker: 0x820, chain: 0x821, flip: 0x822, relit: 0x823, lamp: 0x824 };
// Belethor's second placement, switched off by its own flag, is a placed
// person that is also an enable parent.
const OFF_BELETHOR = 0x803;
// One Market Trader hangs off each parent, and the reference says which.
const M = { underMarker: 0x830, oppositeMarker: 0x831, oppositeLamp: 0x832, underChain: 0x833,
  underFlip: 0x834, underRelit: 0x835, underPerson: 0x836 };

function npc(fid, name, race, more, flags, compress) {
  return rec('NPC_', fid, [edid(name.replace(/[^A-Za-z0-9]/g, '')), full(name), sub('RNAM', u32(race))]
    .concat(more || []), flags, compress);
}

const skyrim = Buffer.concat([
  tes4([]),
  top('KYWD', [rec('KYWD', K.hold, [edid('LocTypeHold')]), rec('KYWD', K.npc, [edid('ActorTypeNPC')])]),
  top('RACE', [
    rec('RACE', R.nord, [edid('NordRace'), kwda([K.npc])]),
    rec('RACE', R.wolf, [edid('WolfRace')]),
    rec('RACE', R.manakin, [edid('ManakinRace'), kwda([K.npc])]),
  ]),
  top('LCTN', [
    rec('LCTN', L.whiterunHold, [edid('WhiterunHoldLocation'), full('Whiterun'), kwda([K.hold])]),
    rec('LCTN', L.whiterun, [edid('WhiterunLocation'), full('Whiterun city'), sub('PNAM', u32(L.whiterunHold))]),
    rec('LCTN', L.riftHold, [edid('RiftHoldLocation'), full('the Rift'), kwda([K.hold])]),
    rec('LCTN', L.belethors, [edid('BelethorsLocation'), sub('PNAM', u32(L.whiterun))]),
  ]),
  top('FACT', [
    rec('FACT', F.belethor, [edid('ServicesWhiterunBelethorsGoods'), fdata(VENDOR), sub('VEND', u32(0))]),
    rec('FACT', F.follower, [edid('CurrentFollowerFaction'), fdata(VENDOR), sub('VEND', u32(0))]),
    rec('FACT', F.carriage, [edid('CarriageSystemFaction'), fdata(0)]),
    rec('FACT', F.isGuard, [edid('IsGuardFaction'), fdata(0)]),
    rec('FACT', F.guardTalk, [edid('GuardDialogueFaction'), fdata(0)]),
    rec('FACT', F.guardWhiterun, [edid('GuardFactionWhiterun'), fdata(0)]),
    rec('FACT', F.crimeWhiterun, [edid('CrimeFactionWhiterun'), fdata(0)]),
    rec('FACT', F.mareOwner, [edid('WhiterunBanneredMareFaction'), fdata(VENDOR)]),
    rec('FACT', F.jobMerchant, [edid('JobMerchantFaction'), fdata(0)]),
    rec('FACT', F.market, [edid('ServicesWhiterunMarketStall'), fdata(VENDOR), sub('VEND', u32(0))]),
    rec('FACT', F.riftenMarket, [edid('ServicesRiftenMarketStall'), fdata(VENDOR), sub('VEND', u32(0))]),
    rec('FACT', F.crimeRift, [edid('CrimeFactionRift'), fdata(0)]),
  ]),
  top('NPC_', [
    // Compressed, so nothing about Belethor is known until it is inflated.
    npc(N.belethor, 'Belethor', R.nord, [snam(F.belethor, 0), snam(F.jobMerchant, -1),
      sub('CRIF', u32(F.crimeWhiterun)), acbs(UNIQUE, 0)], 0, true),
    npc(N.faendal, 'Faendal', R.nord, [snam(F.follower, -1), snam(F.jobMerchant, 0), acbs(UNIQUE, 0)]),
    npc(N.bjorlam, 'Bjorlam', R.nord, [snam(F.carriage, 0), acbs(UNIQUE, 0)]),
    npc(N.guard, 'Whiterun Guard', R.nord, [snam(F.guardWhiterun, 0), snam(F.isGuard, 0), snam(F.guardTalk, 0),
      sub('CRIF', u32(F.crimeWhiterun))]),
    // A thin record: its own race is a wolf and it names nobody. Everything
    // comes from the template, the way 6,521 real placements are built.
    rec('NPC_', N.thin, [edid('GuardThin'), sub('RNAM', u32(R.wolf)), sub('TPLT', u32(N.guard)),
      acbs(0, TRAITS | FACTIONS | BASE)]),
    npc(N.wolf, 'Wolf', R.wolf),
    npc(N.mannequin, 'Mannequin', R.manakin),
    rec('NPC_', N.gjalund, [edid('DLC2RRGjalundSaltSageWindhelm'), full('Gjalund Salt-Sage'),
      sub('RNAM', u32(R.nord)), acbs(UNIQUE, 0)]),
    npc(N.aela, 'Aela the Huntress', R.nord, [snam(F.isGuard, 0), acbs(UNIQUE, 0)]),
    npc(N.patron, 'Patron', R.nord, [snam(F.mareOwner, 0)]),
    npc(N.nazeem, 'Nazeem', R.nord, [sub('CRIF', u32(F.crimeWhiterun)), acbs(UNIQUE, 0)]),
    rec('NPC_', N.leveled, [edid('GuardLeveled'), sub('RNAM', u32(R.wolf)), sub('TPLT', u32(LV)),
      acbs(0, TRAITS | FACTIONS | BASE)]),
    npc(N.hermit, 'Hermit', R.nord),
    npc(N.riftTrader, 'Rift Peddler', R.nord, [snam(F.belethor, 0)]),
    npc(N.market, 'Market Trader', R.nord, [snam(F.market, 0)]),
    // Sigaar is built the way CFTO builds Bjorlam. His name, race and carriage
    // faction are his own and the use bits take none of them from the
    // template, which is in no faction and has a name of its own. A pass that
    // always follows a template makes him a stranger called Carriage Driver.
    rec('NPC_', N.driverTemplate, [edid('KmodCarriageDriverTemplate'), full('Carriage Driver'),
      sub('RNAM', u32(R.nord)), acbs(0, 0)]),
    rec('NPC_', N.sigaar, [edid('KmodSigaar'), full('Sigaar'), sub('RNAM', u32(R.nord)),
      snam(F.carriage, 0), sub('TPLT', u32(N.driverTemplate)), acbs(UNIQUE, CFTO_USES)]),
    // The Riften merchant is built the way Populated Cities builds its
    // merchants: race and name come from the template, and with the name the
    // unique flag, but the factions are its own. The thin record still says
    // wolf and unique, leftovers nothing should read. The template is in a job
    // faction and sells nothing, so a pass that takes factions through the
    // template, or through the race or name bit, loses a trader.
    rec('NPC_', N.merchantTemplate, [edid('PCMerchantTemplate'), full('Riften Merchant'),
      sub('RNAM', u32(R.nord)), snam(F.jobMerchant, 0), acbs(0, 0)]),
    rec('NPC_', N.merchant, [edid('PCRiftenMerchant'), sub('RNAM', u32(R.wolf)),
      snam(F.riftenMarket, 0), sub('TPLT', u32(N.merchantTemplate)), acbs(UNIQUE, POPULATED_USES)]),
    // The fishmonger takes its race from the template and nothing else. Its
    // name, unique flag, vendor faction and CrimeFactionRift are its own, and
    // the thin record still says wolf. The template has no name, is in no
    // vendor faction, is not unique and answers to Whiterun, so reading the
    // name, the flag or the crime faction through the race bit gets each wrong,
    // and reading the race through the name bit loses the fishmonger to the
    // wolf.
    rec('NPC_', N.fishTemplate, [edid('EncTraderTemplate'), sub('RNAM', u32(R.nord)),
      snam(F.jobMerchant, 0), sub('CRIF', u32(F.crimeWhiterun)), acbs(0, 0)]),
    rec('NPC_', N.fishmonger, [edid('PCRiftenFishmonger'), full('Fishmonger'), sub('RNAM', u32(R.wolf)),
      snam(F.riftenMarket, 0), sub('CRIF', u32(F.crimeRift)), sub('TPLT', u32(N.fishTemplate)),
      acbs(UNIQUE, RACE_ONLY_USES)]),
    // The stall keeper is the other way round: its name, and with the name the
    // unique flag, come from the template, and its race, vendor faction and
    // CrimeFactionRift are its own. It has no name on its own record. The
    // template is a wolf in a job faction that answers to Whiterun, so a pass
    // that reads the race through the name bit loses a trader, and one that
    // reads the name, the flag or the crime faction through the race bit gets
    // each wrong.
    rec('NPC_', N.keeperTemplate, [edid('PCStallKeeperTemplate'), full('Stall Keeper'),
      sub('RNAM', u32(R.wolf)), snam(F.jobMerchant, 0), sub('CRIF', u32(F.crimeWhiterun)),
      acbs(UNIQUE, 0)]),
    rec('NPC_', N.keeper, [edid('PCRiftenStallKeeper'), sub('RNAM', u32(R.nord)),
      snam(F.riftenMarket, 0), sub('CRIF', u32(F.crimeRift)), sub('TPLT', u32(N.keeperTemplate)),
      acbs(0, NAME_ONLY_USES)]),
  ]),
  // A guard first and a wolf last, so a pass that reads the list through its
  // last entry turns the leveled guard into a wolf and the counts move.
  top('LVLN', [rec('LVLN', LV, [edid('LvlGuard'),
    sub('LVLO', Buffer.concat([Buffer.from([1, 0, 0, 0]), u32(N.guard), Buffer.from([1, 0, 0, 0])])),
    sub('LVLO', Buffer.concat([Buffer.from([1, 0, 0, 0]), u32(N.wolf), Buffer.from([1, 0, 0, 0])]))])]),
  top('CELL', [grup(u32(0), 2, [grup(u32(0), 3, [
    rec('CELL', C.shop, [edid('WhiterunBelethorsGeneralGoods'), full("Belethor's General Goods"),
      sub('DATA', Buffer.from([1, 0])), sub('XLCN', u32(L.belethors))]),
    children(C.shop, [
      achr(0x800, N.belethor),
      achr(0x801, N.faendal),
      achr(0x802, N.mannequin),
      achr(OFF_BELETHOR, N.belethor, [], DISABLED),
      achr(0x804, N.patron),
      achr(0x807, N.nazeem),
      achr(0x80F, N.aela),
    ]),
    rec('CELL', C.house, [edid('NazeemsHouse'), sub('DATA', Buffer.from([1, 0]))]),
    // A guard at home. The house names no place and the thin record has no
    // crime faction, so only its template's CrimeFactionWhiterun places it.
    children(C.house, [achr(0x805, N.nazeem), achr(0x806, N.hermit), achr(GUARD_AT_HOME, N.thin)]),
    // A back room that names no place either, so only the crime faction each
    // trader in it carries puts it in a hold.
    rec('CELL', C.backRoom, [edid('RiftenBackRoom'), sub('DATA', Buffer.from([1, 0]))]),
    children(C.backRoom, [achr(FISHMONGER, N.fishmonger), achr(STALL_KEEPER, N.keeper)]),
  ])])]),
  top('WRLD', [
    rec('WRLD', W.tamriel, [edid('Tamriel')]),
    grup(u32(W.tamriel), 1, [
      // The ground first and the persistent cell after it, so a pass that let
      // the persistent cell's 0,0 stand for the ground would lose the Rift.
      grup(u32(0), 4, [grup(u32(0), 5, [
        rec('CELL', W.whiterunSq, [sub('DATA', Buffer.from([0, 0])), xclc(6, -1), sub('XLCN', u32(L.whiterun))]),
        rec('CELL', W.openSq, [sub('DATA', Buffer.from([0, 0])), xclc(20, -20)]),
        rec('CELL', W.riftSq, [sub('DATA', Buffer.from([0, 0])), xclc(22, -20), sub('XLCN', u32(L.riftHold))]),
        rec('CELL', W.farSq, [sub('DATA', Buffer.from([0, 0])), xclc(25, -20), sub('XLCN', u32(L.whiterun))]),
        rec('CELL', W.zeroSq, [sub('DATA', Buffer.from([0, 0])), xclc(0, 0), sub('XLCN', u32(L.riftHold))]),
        children(W.openSq, [
          achr(0x817, N.riftTrader, [pos(20 * SQ + 5, -20 * SQ + 5)]),
          achr(MERCHANT, N.merchant, [pos(20 * SQ + 6, -20 * SQ + 6)]),
        ]),
      ])]),
      rec('CELL', W.persistent, [sub('DATA', Buffer.from([0, 0])), xclc(0, 0)]),
      children(W.persistent, [
        achr(0x810, N.bjorlam, [pos(6 * SQ + 10, -1 * SQ + 10)]),
        achr(0x811, N.gjalund, [pos(-9000, 9000), sub('XLCN', u32(L.riftHold))]),
        achr(SIGAAR, N.sigaar, [pos(22 * SQ + 10, -20 * SQ + 10)]),
        achr(0x812, N.thin, [pos(6 * SQ + 20, -1 * SQ + 20)]),
        achr(0x813, N.leveled, [pos(6 * SQ + 30, -1 * SQ + 30)]),
        achr(0x814, N.wolf, [pos(6 * SQ + 40, -1 * SQ + 40)]),
        // Three guards behind parents: two off, one on. With a plain and an
        // opposite child only, the count could not tell a parent read from
        // one never looked at.
        achr(0x815, N.thin, [pos(6 * SQ + 50, -1 * SQ + 50), xesp(P.marker, 0)]),
        achr(0x816, N.thin, [pos(6 * SQ + 60, -1 * SQ + 60), xesp(P.marker, 1)]),
        achr(0x81A, N.thin, [pos(6 * SQ + 65, -1 * SQ + 65), xesp(P.chain, 0)]),
        achr(0x818, N.belethor, [pos(6 * SQ + 70, -1 * SQ + 70)], DELETED),
        achr(0x819, N.hermit, [pos(100, 100)]),
        rec('REFR', P.marker, [sub('NAME', u32(0x999)), pos(6 * SQ, -1 * SQ)], DISABLED),
        rec('REFR', P.chain, [sub('NAME', u32(0x999)), pos(6 * SQ, -1 * SQ), xesp(P.marker, 0)]),
        rec('REFR', P.flip, [sub('NAME', u32(0x999)), pos(6 * SQ, -1 * SQ), xesp(P.marker, 1)]),
        rec('REFR', P.relit, [sub('NAME', u32(0x999)), pos(6 * SQ, -1 * SQ)], DISABLED),
        rec('REFR', P.lamp, [sub('NAME', u32(0x999)), pos(6 * SQ, -1 * SQ)]),
        achr(M.underMarker, N.market, [pos(6 * SQ + 80, -1 * SQ + 80), xesp(P.marker, 0)]),
        achr(M.oppositeMarker, N.market, [pos(6 * SQ + 81, -1 * SQ + 81), xesp(P.marker, 1)]),
        achr(M.oppositeLamp, N.market, [pos(6 * SQ + 82, -1 * SQ + 82), xesp(P.lamp, 1)]),
        achr(M.underChain, N.market, [pos(6 * SQ + 83, -1 * SQ + 83), xesp(P.chain, 0)]),
        achr(M.underFlip, N.market, [pos(6 * SQ + 84, -1 * SQ + 84), xesp(P.flip, 0)]),
        achr(M.underRelit, N.market, [pos(6 * SQ + 85, -1 * SQ + 85), xesp(P.relit, 0)]),
        achr(M.underPerson, N.market, [pos(6 * SQ + 86, -1 * SQ + 86), xesp(OFF_BELETHOR, 0)]),
      ]),
    ]),
  ]),
]);

// A patch that spells its master SKYRIM.ESM. It repeats Bjorlam and his
// placement word for word, and deletes Nazeem's second placement keeping only
// the flag. Read with the spelling as written, that is a second Bjorlam and a
// Nazeem nobody deleted. It also switches the relit marker back on, so the
// Market Trader behind it stands only if the last word on a parent wins.
const patch = Buffer.concat([
  tes4(['SKYRIM.ESM']),
  top('NPC_', [npc(N.bjorlam, 'Bjorlam', R.nord, [snam(F.carriage, 0), acbs(UNIQUE, 0)])]),
  top('CELL', [grup(u32(0), 2, [grup(u32(0), 3, [
    rec('CELL', C.shop, [edid('WhiterunBelethorsGeneralGoods'), full("Belethor's General Goods"),
      sub('DATA', Buffer.from([1, 0])), sub('XLCN', u32(L.belethors))]),
    children(C.shop, [rec('ACHR', 0x807, [], DELETED)]),
  ])])]),
  top('WRLD', [
    rec('WRLD', W.tamriel, [edid('Tamriel')]),
    grup(u32(W.tamriel), 1, [
      rec('CELL', W.persistent, [sub('DATA', Buffer.from([0, 0])), xclc(0, 0)]),
      children(W.persistent, [
        achr(0x810, N.bjorlam, [pos(6 * SQ + 10, -1 * SQ + 10)]),
        rec('REFR', P.relit, [sub('NAME', u32(0x999)), pos(6 * SQ, -1 * SQ)]),
      ]),
    ]),
  ]),
]);

// Thornswood-Last.esp, which the gamemode's load order ends in (#2468). It is
// built from the catalogue and switches off the actors the catalogue cuts:
// here Belethor's standing placement and Nazeem at home. Read as an input it
// would list them as off at the start; the cast is written before anything
// is deleted, so its actors are not read and every count stays as it was.
const last = Buffer.concat([
  tes4(['Skyrim.esm']),
  top('CELL', [grup(u32(0), 2, [grup(u32(0), 3, [
    rec('CELL', C.shop, [edid('WhiterunBelethorsGeneralGoods'), full("Belethor's General Goods"),
      sub('DATA', Buffer.from([1, 0])), sub('XLCN', u32(L.belethors))]),
    children(C.shop, [achr(0x800, N.belethor, [], DISABLED)]),
    rec('CELL', C.house, [sub('DATA', Buffer.from([1, 0]))]),
    children(C.house, [achr(0x805, N.nazeem, [], DISABLED)]),
  ])])]),
]);

function findPython() {
  const tries = [['python', []], ['py', ['-3']], ['python3', []]];
  for (let i = 0; i < tries.length; i++) {
    const r = spawnSync(tries[i][0], tries[i][1].concat(['--version']), { encoding: 'utf8' });
    if (r.status === 0) { return tries[i]; }
  }
  return null;
}

const py = findPython();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-cast-'));
try {
  if (!py) {
    console.log('SKIP  no python on this machine, so the script could not be driven');
  } else if (fs.existsSync(TOOL)) {
    fs.writeFileSync(path.join(dir, 'Skyrim.esm'), skyrim);
    ['Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'].forEach(function (m) {
      fs.writeFileSync(path.join(dir, m), tes4([]));
    });
    fs.writeFileSync(path.join(dir, 'Patch.esp'), patch);
    fs.writeFileSync(path.join(dir, 'Thornswood-Last.esp'), last);
    // One patch, and Skyrim.esm listed again in another spelling. Windows
    // opens skyrim.esm as Skyrim.esm, so read twice every placement in it
    // would stand twice.
    fs.writeFileSync(path.join(dir, 'plugins.txt'),
      '# a load order of one patch\r\n*skyrim.esm\r\n*Patch.esp\r\n*Thornswood-Last.esp\r\n');
    const out = path.join(dir, 'cast.json');
    const run = spawnSync(py[0], py[1].concat([TOOL, '--data', dir, '--plugins',
      path.join(dir, 'plugins.txt'), '--out', out]), { encoding: 'utf8' });
    yes('the script runs to the end on a load order it has never seen', run.status === 0);
    if (run.status !== 0) { console.log(run.stdout + run.stderr); }

    const check = spawnSync(py[0], py[1].concat([TOOL, '--data', dir, '--plugins',
      path.join(dir, 'plugins.txt'), '--out', path.join(dir, 'not-written.json'), '--check']),
      { encoding: 'utf8' });
    yes('--check says what it found and writes nothing',
      check.status === 0 && !fs.existsSync(path.join(dir, 'not-written.json')));

    let j = null;
    try { j = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) { j = null; }
    yes('and writes cast.json', j !== null);
    j = j || { counts: {}, holds: {} };
    const hold = function (name) { return j.holds[name] || { traders: [], transport: [], guards: {}, everyoneElse: {}, offAtStart: [], offAtStartBy: {} }; };
    const wr = hold('Whiterun'), rift = hold('the Rift'), none = hold('no hold');
    const named = function (rows, name) { return rows.filter(function (r) { return r.name === name; }); };
    // Every form in the load order built here is Skyrim.esm's own, and the
    // script writes a reference as <hex>:<plugin>.
    const refOf = function (fid) { return fid.toString(16) + ':Skyrim.esm'; };
    const refsOf = function (rows) {
      return named(rows, 'Market Trader').map(function (r) { return r.ref; }).sort().join(' ');
    };

    yes('nothing was lost to a record that would not inflate', j.counts.failedToInflate === 0);
    yes('seven plugins in the load order, though plugins.txt lists Skyrim.esm again as skyrim.esm, Thornswood-Last.esp among them',
      /^7 plugins in load order \(names sha256 [0-9a-f]{12}\)$/.test(j.readFrom || ''));
    yes('32 placements read, 2 of them deleted, one by a patch that kept only the flag',
      j.counts.placed === 32 && j.counts.deleted === 2);
    yes('a wolf and a mannequin are counted, not listed as people', j.counts.notPeople === 2);

    const bel = named(wr.traders, 'Belethor');
    yes('Belethor is a trader in Whiterun, out of a compressed record',
      bel.length === 1 && bel[0].unique === true);
    yes('because of his vendor faction, and not his job faction at rank -1',
      bel.length === 1 && bel[0].because.join() === 'ServicesWhiterunBelethorsGoods');
    yes('his hold came up from the shop he stands in, through the city to the hold',
      bel.length === 1 && bel[0].holdFrom === 'the cell it stands in');
    yes('his second placement, switched off by its own flag, is named apart and not counted as cast',
      wr.offAtStart.some(function (r) {
        return r.name === 'Belethor' && r.ref === refOf(OFF_BELETHOR) && r.offBy === 'its own flag';
      }));
    yes('Faendal, in a vendor faction at rank -1 and a job faction at rank 0, is not a trader',
      named(wr.traders, 'Faendal').length === 0 && wr.everyoneElse.Faendal === 1);
    yes('a vendor-flagged faction with no buy and sell list makes nobody a trader',
      named(wr.traders, 'Patron').length === 0 && wr.everyoneElse.Patron === 1);
    yes('the only traders standing in Whiterun are Belethor and three Market Traders',
      wr.traders.length === 4 && bel.length === 1 && named(wr.traders, 'Market Trader').length === 3);

    const bj = named(wr.transport, 'Bjorlam');
    yes('Bjorlam is transport in Whiterun, once, though a patch spells the master SKYRIM.ESM',
      bj.length === 1 && wr.transport.length === 1);
    yes('placed from the persistent cell by the ground under him', bj.length === 1 && bj[0].holdFrom === 'the ground it stands on');
    const gj = named(rift.transport, 'Gjalund Salt-Sage');
    yes('Gjalund, the Solstheim ferry in no faction, is transport by his record',
      gj.length === 1 && gj[0].because.join() === 'DLC2RRGjalundSaltSageWindhelm' && gj[0].holdFrom === 'its own location');

    // The template use bits, one trait at a time. Each is found by its
    // reference, because a template that wrongly hands over a name also hands
    // over a column, and a name search would miss both.
    const atRef = function (rows, fid) { return rows.filter(function (r) { return r.ref === refOf(fid); }); };
    const sg = atRef(rift.transport, SIGAAR);
    yes('Sigaar, whose use bits take nothing he is checked on from his template (0x230, as CFTO builds Bjorlam), drives a carriage by his own faction',
      sg.length === 1 && sg[0].name === 'Sigaar' && sg[0].because.join() === 'CarriageSystemFaction');
    yes('and keeps his own unique flag, since the name and the flag are his own too',
      sg.length === 1 && sg[0].unique === true);
    const pc = atRef(rift.traders, MERCHANT);
    yes('a merchant whose race and name come from its template and whose factions are its own (0xecb, as Populated Cities builds them) is a trader',
      pc.length === 1 && pc[0].name === 'Riften Merchant' && pc[0].because.join() === 'ServicesRiftenMarketStall');
    yes('and takes its unique flag from the template with its name, not the leftover on the thin record',
      pc.length === 1 && pc[0].unique === false);
    yes('neither template walks the Rift as a stranger in their place',
      !rift.everyoneElse['Carriage Driver'] && !rift.everyoneElse['Riften Merchant'] &&
      !rift.everyoneElse.Sigaar && !rift.everyoneElse.PCRiftenMerchant);

    // The race bit and the name bit apart. Each of these two sets one and not
    // the other, and stands where only its own crime faction places it, so a
    // trait read through the wrong bit moves it, renames it or loses it.
    const fm = atRef(rift.traders, FISHMONGER);
    yes('a fishmonger whose race alone comes from its template (0x1, the commonest templated trader on the live load order) is a person and a trader by its own faction',
      fm.length === 1 && fm[0].because.join() === 'ServicesRiftenMarketStall');
    yes('and keeps its own name and unique flag, since the name bit is not set',
      fm.length === 1 && fm[0].name === 'Fishmonger' && fm[0].unique === true);
    yes('and stands in the Rift by its own crime faction, not the Whiterun one its template carries',
      fm.length === 1 && fm[0].holdFrom === 'whose law it answers to');
    const sk = atRef(rift.traders, STALL_KEEPER);
    yes('a stall keeper whose name alone comes from its template (0x80) is a person by its own race, though the template is a wolf',
      sk.length === 1 && sk[0].because.join() === 'ServicesRiftenMarketStall');
    yes('and takes its name and unique flag from the template, having no name of its own',
      sk.length === 1 && sk[0].name === 'Stall Keeper' && sk[0].unique === true);
    yes('and stands in the Rift by its own crime faction too',
      sk.length === 1 && sk[0].holdFrom === 'whose law it answers to');
    yes('the Rift has four traders standing: the peddler, the merchant, the fishmonger and the stall keeper',
      rift.traders.length === 4);

    yes('the guards are counted through their templates: a thin one, a leveled one read through its first entry and not the wolf at its last, one switched on by an opposite parent, and one at home',
      wr.guards['Whiterun Guard'] === 4 && Object.keys(wr.guards).length === 1);
    yes('the guard at home, in a house that names no place, is placed by the crime faction its template carries',
      Object.keys(none.guards).length === 0 && !rift.guards['Whiterun Guard']);
    yes('the two guards behind a switched-off parent, one directly and one two steps up, are counted off',
      wr.offAtStartBy.guards === 2);

    // One Market Trader behind each kind of enable parent. A trader is listed
    // by reference, standing or off, so each answer is checked on its own
    // rather than hidden in a total that two wrong answers can balance.
    const standing = function (fid) {
      return wr.traders.some(function (r) { return r.ref === refOf(fid); }) &&
        !wr.offAtStart.some(function (r) { return r.ref === refOf(fid); });
    };
    const offByParent = function (fid) {
      return wr.offAtStart.some(function (r) { return r.ref === refOf(fid) && r.offBy === 'its enable parent'; }) &&
        !wr.traders.some(function (r) { return r.ref === refOf(fid); });
    };
    yes('a trader behind a marker switched off by its own flag starts off', offByParent(M.underMarker));
    yes('a trader set opposite to that switched-off marker is standing', standing(M.oppositeMarker));
    yes('a trader set opposite to a marker that is on starts off', offByParent(M.oppositeLamp));
    yes('a trader behind a marker that follows a switched-off one starts off, two steps up',
      offByParent(M.underChain));
    yes('a trader behind a marker set opposite to a switched-off one is standing', standing(M.underFlip));
    yes('a trader behind a marker a patch switched back on is standing, because the last word wins',
      standing(M.underRelit));
    yes('a trader whose enable parent is a placed person switched off by its own flag starts off',
      offByParent(M.underPerson));
    yes('and those are all the Market Traders there are, three standing and four off',
      refsOf(wr.traders) === [M.oppositeMarker, M.underFlip, M.underRelit].map(refOf).sort().join(' ') &&
      refsOf(wr.offAtStart) === [M.underMarker, M.oppositeLamp, M.underChain, M.underPerson].map(refOf).sort().join(' '));
    yes('five traders in Whiterun start off: Belethor by his own flag and four Market Traders by a parent',
      wr.offAtStartBy.traders === 5);
    yes('IsGuardFaction alone does not make a guard', wr.everyoneElse['Aela the Huntress'] === 1);

    yes('Nazeem, in a house that names no place, is placed by whose law he answers to', wr.everyoneElse.Nazeem === 1);
    yes('and his deleted second placement is gone', j.counts.everyoneElse === 6);
    yes('a person on open ground takes the hold of the nearest named place, the Rift two cells off and not Whiterun five off',
      named(rift.traders, 'Rift Peddler').length === 1 && named(rift.traders, 'Rift Peddler')[0].holdFrom === 'the nearest named place');
    yes('the persistent cell at 0,0 is not taken for the ground at 0,0', rift.everyoneElse.Hermit === 1);
    yes('and somebody nothing places is under no hold', none.everyoneElse.Hermit === 1);
    yes('the totals add up: 8 traders, 3 transport, 4 guards, 6 everyone else, 7 off, 28 people',
      j.counts.traders === 8 && j.counts.transport === 3 && j.counts.guards === 4 &&
      j.counts.everyoneElse === 6 && j.counts.offAtStart === 7 && j.counts.people === 28);
  }
} catch (e) {
  yes('the load order built here was driven without throwing: ' + e.message, false);
} finally {
  // A scanner may still hold a file it was just handed, so this retries, and
  // a folder left behind in the temp directory is a note rather than a failure.
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (e) {
    console.log('NOTE  could not remove ' + dir + ': ' + e.message);
  }
}

// ----------------------------------------------------- what it may not do
{
  const src = fs.existsSync(TOOL) ? fs.readFileSync(TOOL, 'utf8') : '';
  const writes = (src.match(/io\.open\([^)]*'w'/g) || []).length;
  yes('the script writes one file and one file only', writes === 1);
  yes('and never opens the gamemode or a plugin to write', !/gamemode/.test(src) && !/\.esp'\s*,\s*'w/.test(src));
}

// ------------------------------------------------ the committed list, by eye
{
  const CAST = path.join(REPO_DIR, 'game', 'data', 'cast.json');
  let j = null;
  try { j = JSON.parse(fs.readFileSync(CAST, 'utf8')); } catch (e) { j = null; }
  yes('game/data/cast.json is in the repo, written by the script', j !== null && j.builtBy === 'scripts/dev/Build-CastTable.py');
  j = j || { holds: {}, counts: {} };
  const rows = function (h, col) { return ((j.holds[h] || {})[col]) || []; };
  const bel = rows('Whiterun', 'traders').filter(function (r) { return r.name === 'Belethor'; });
  yes('Belethor sells in Whiterun, through ServicesWhiterunBelethorsGoods',
    bel.length === 1 && bel[0].because.indexOf('ServicesWhiterunBelethorsGoods') !== -1);
  yes('Bjorlam drives the Whiterun carriage, once, as CFTO placed him',
    rows('Whiterun', 'transport').filter(function (r) { return r.name === 'Bjorlam'; }).length === 1);
  yes('the vanilla Bjorlam CFTO switched off is named apart',
    rows('Whiterun', 'offAtStart').some(function (r) { return r.name === 'Bjorlam' && r.base === '13669:Skyrim.esm'; }));
  yes('Gjalund Salt-Sage runs the Solstheim ferry from both ends',
    rows('Eastmarch', 'transport').some(function (r) { return r.name === 'Gjalund Salt-Sage'; }) &&
    rows('Solstheim', 'transport').some(function (r) { return r.name === 'Gjalund Salt-Sage'; }));
  yes('Faendal is not a trader anywhere', Object.keys(j.holds).every(function (h) {
    return rows(h, 'traders').every(function (r) { return r.name !== 'Faendal'; });
  }));
  const holds = ['Whiterun', 'Haafingar', 'Falkreath', 'Hjaalmarch', 'the Pale', 'the Rift',
    'Winterhold', 'Eastmarch', 'the Reach', 'Solstheim'];
  yes('all nine holds and Solstheim have traders and guards counted', holds.every(function (h) {
    const c = (j.holds[h] || {}).counts || {};
    return c.traders > 0 && c.guards > 0;
  }));
  yes('the Companions are not counted as guards', Object.keys(j.holds).every(function (h) {
    return !((j.holds[h] || {}).guards || {})['Aela the Huntress'];
  }));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
