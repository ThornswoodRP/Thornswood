'use strict';
/*
  Verify-FormIdShape.js

      node scripts\ops\Verify-FormIdShape.js --server <folder>

  Read only. The deploy that carries #2870 runs it first on each server, with
  that game server stopped, to know whether the server holds a version 1
  merchant ledger and whether its release list names characters by the old
  shape (docs\GAMEMODE.md says what is done with each). It counts, register
  by register, how many records name a character by its runtime form id
  (0xff000000 | local, the one shape since #2870) and how many by anything
  else, in the game server's privDir:

    list        deleted-characters.json actors: full, local (the old shape),
                other
    embassy     embassy.json rows (both rolls): full, local, other
    dungeon     dungeon-rewards-ledger.json chests: full, local, other,
                released (an actor of 0, let go of by the release list)
    cargo       trade-cargo.json loaders, recipients and receivers:
                full, local, other
    merchants   merchant-ledger.json: its version, whether its sha256
                matches, pending trades; supply waits keyed full, desc (the
                old [formDesc, profile, item]), plugin (a placed form's desc),
                itemOnly (the oldest, by item alone) or other; commission
                owners full, local (the old [local, '', profile]), plugin
                (a placed form, kept as it is) or other

  A merchants version of 1 is a ledger the gamemode refuses; list.actors.local
  above 0 is a release list it does not read. Exits 1 on a file it cannot
  read, 0 otherwise.

  Prints one JSON object. It writes nothing.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// One shape for a character's form id (#2870); game\form-id.js is the
// original and tests\test-2870-form-id-shape.js keeps this copy the same.
function formIdOf(desc) {
  if (typeof desc !== 'string' || !/^[0-9a-f]{1,6}$/i.test(desc)) return 0;
  var local = parseInt(desc, 16);
  return local > 0 ? 0xff000000 + local : 0;
}
function isFormId(n) {
  return Number.isSafeInteger(n) && n > 0xff000000 && n <= 0xffffffff;
}

const LOCAL = (n) => Number.isSafeInteger(n) && n > 0 && n <= 0xffffff;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const shape = (n) => (isFormId(n) ? 'full' : LOCAL(n) ? 'local' : 'other');
function parseArray(text, length) {
  if (typeof text !== 'string' || text[0] !== '[') return null;
  try {
    const row = JSON.parse(text);
    return Array.isArray(row) && row.length === length ? row : null;
  } catch (e) { return null; }
}

function load(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { present: false };
    return { present: true, unreadable: String((e && e.code) || e) };
  }
  try { return { present: true, doc: JSON.parse(text.replace(/^\uFEFF/, '')) }; }
  catch (e) { return { present: true, unreadable: 'cannot be parsed (' + e.message + ')' }; }
}

function count(server) {
  let settings;
  try { settings = JSON.parse(fs.readFileSync(path.join(server, 'server-settings.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { return { server: path.resolve(server), unreadable: 'server-settings.json (' + ((e && e.code) || e.message) + ')' }; }
  const priv = path.resolve(server, isObj(settings) && settings.privDir ? String(settings.privDir) : 'private');
  const out = { server: path.resolve(server), privDir: priv };

  const list = load(path.join(priv, 'deleted-characters.json'));
  out.list = { present: list.present };
  if (list.unreadable) out.list.unreadable = list.unreadable;
  else if (list.present) {
    const d = list.doc;
    if (!isObj(d) || (d.actors !== undefined && !Array.isArray(d.actors))) out.list.unreadable = 'not a release list';
    else {
      out.list.actors = { full: 0, local: 0, other: 0 };
      (d.actors || []).forEach((n) => out.list.actors[shape(n)]++);
      out.list.profiles = Array.isArray(d.profiles) ? d.profiles.length : 0;
      out.list.done = isObj(d.done) ? Object.keys(d.done).sort() : [];
    }
  }

  const embassy = load(path.join(priv, 'embassy.json'));
  out.embassy = { present: embassy.present };
  if (embassy.unreadable) out.embassy.unreadable = embassy.unreadable;
  else if (embassy.present) {
    out.embassy.actors = { full: 0, local: 0, other: 0 };
    for (const roll of ['embassy', 'remnant']) {
      const rows = isObj(embassy.doc) && Array.isArray(embassy.doc[roll]) ? embassy.doc[roll] : [];
      rows.forEach((r) => out.embassy.actors[shape(r && r.actor)]++);
    }
  }

  const dungeon = load(path.join(priv, 'dungeon-rewards-ledger.json'));
  out.dungeon = { present: dungeon.present };
  if (dungeon.unreadable) out.dungeon.unreadable = dungeon.unreadable;
  else if (dungeon.present) {
    out.dungeon.version = isObj(dungeon.doc) ? dungeon.doc.version : undefined;
    out.dungeon.actors = { full: 0, local: 0, other: 0, released: 0 };
    const entries = isObj(dungeon.doc) && isObj(dungeon.doc.entries) ? dungeon.doc.entries : {};
    for (const k of Object.keys(entries)) {
      const e = entries[k];
      if (!isObj(e) || e.kind === 'body' || e.actor === undefined) continue;
      out.dungeon.actors[e.actor === 0 ? 'released' : shape(e.actor)]++;
    }
  }

  const cargo = load(path.join(priv, 'trade-cargo.json'));
  out.cargo = { present: cargo.present };
  if (cargo.unreadable) out.cargo.unreadable = cargo.unreadable;
  else if (cargo.present) {
    out.cargo.actors = { full: 0, local: 0, other: 0 };
    const holds = isObj(cargo.doc) && isObj(cargo.doc.cargo) && isObj(cargo.doc.cargo.holds) ? cargo.doc.cargo.holds : {};
    const party = (p) => { if (p !== null && p !== undefined) out.cargo.actors[shape(p.actor)]++; };
    for (const id of Object.keys(holds)) {
      const h = holds[id] || {};
      for (const k of Object.keys(isObj(h.lines) ? h.lines : {})) { party(h.lines[k] && h.lines[k].by); party(h.lines[k] && h.lines[k].for); }
      (Array.isArray(h.outs) ? h.outs : []).forEach((o) => party(o && o.who));
    }
  }

  const ledger = load(path.join(priv, 'merchant-ledger.json'));
  out.merchants = { present: ledger.present };
  if (ledger.unreadable) out.merchants.unreadable = ledger.unreadable;
  else if (ledger.present) {
    const d = ledger.doc;
    const m = out.merchants;
    m.version = isObj(d) ? d.version : undefined;
    m.sha256 = isObj(d) && typeof d.sha256 === 'string' &&
      d.sha256 === crypto.createHash('sha256').update(JSON.stringify([d.version, d.entries])).digest('hex');
    m.entries = 0;
    m.pending = 0;
    m.supply = { full: 0, desc: 0, plugin: 0, itemOnly: 0, other: 0 };
    m.owners = { full: 0, local: 0, plugin: 0, other: 0 };
    const entries = isObj(d) && isObj(d.entries) ? d.entries : {};
    const owner = (name) => {
      const parts = parseArray(name, 2);
      const row = parts && parseArray(parts[0], 3);
      if (!row || typeof row[1] !== 'string') m.owners.other++;
      else if (row[1]) m.owners[LOCAL(row[0]) ? 'plugin' : 'other']++;
      else m.owners[isFormId(row[0]) ? 'full' : LOCAL(row[0]) ? 'local' : 'other']++;
    };
    for (const ref of Object.keys(entries)) {
      const s = entries[ref];
      if (!isObj(s)) continue;
      m.entries++;
      if (s.pending !== undefined && s.pending !== null) m.pending++;
      for (const key of Object.keys(isObj(s.supply) ? s.supply : {})) {
        if (key[0] !== '[') { m.supply.itemOnly++; continue; }
        const row = parseArray(key, 3);
        if (!row) m.supply.other++;
        else if (isFormId(row[0])) m.supply.full++;
        else if (formIdOf(row[0])) m.supply.desc++;
        else if (typeof row[0] === 'string' && /^[0-9a-f]{1,6}:/i.test(row[0])) m.supply.plugin++;
        else m.supply.other++;
      }
      const k = isObj(s.commissions) ? s.commissions : {};
      Object.keys(isObj(k.held) ? k.held : {}).forEach(owner);
      Object.keys(isObj(k.cool) ? k.cool : {}).forEach(owner);
    }
  }
  return out;
}

module.exports = { formIdOf, isFormId, count };

if (require.main === module) {
  process.exitCode = cli();
}
// Run as a program. A function, so a stop is a return and not node's exit
// function, which can hang on Node 24 (#6036).
function cli() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--server' || !args[1]) {
    console.error('Usage: node scripts\\ops\\Verify-FormIdShape.js --server <folder>');
    return 2;
  }
  const now = count(args[1]);
  console.log(JSON.stringify(now, null, 2));
  const bad = now.unreadable || ['list', 'embassy', 'dungeon', 'cargo', 'merchants'].some((k) => now[k] && now[k].unreadable);
  return bad ? 1 : 0;
}
