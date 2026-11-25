/*
  Which accounts play from the same PC (Patrick's answer A on q-hwid-collect,
  16 Nov 2026), for staff on the hub's Linked page.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { notePc, pcsSharedBy, sweepPcs, withSharedPcs };

const crypto = require('crypto');
const path   = require('path');
const { DATA } = require('./base');
const { cfg } = require('./config');
const { jsonFile, putJson } = require('./store');

/*
  WHAT ARRIVES. The launcher sends, with each join pass it asks for, a
  one-way hash of the machine id Windows gives a PC at install (MachineGuid,
  Discord.cs PcId). The id itself never leaves the PC.

  WHAT IS KEPT. That hash hashed again with this site's own secret, so the
  file names no PC anybody else could look up, beside the Discord account
  and when it was last seen: one row per account and PC, in data\pcs.json.
  Thirty days, the same as sign-in addresses: a row goes once its account
  has not played from that PC for 30 days, on the hourly sweep and whenever
  a row is written. A deletion request takes an account's rows with it
  (deletion.js). The privacy page says all of this under "This PC".

  WHAT IT IS FOR. Staff see, beside each account on the Linked page, the
  other accounts that played from one of its PCs in that time: a second
  account of somebody banned, or one person playing two. A shared family PC
  looks the same, which is why it is only shown, never acted on by itself.
*/
const PCS = path.join(DATA, 'pcs.json');
const PCS_DAYS = 30;
const PCS_MOST = 20000;

function pcKey(sent) { return crypto.createHmac('sha256', String(cfg.secret)).update('pc:' + sent).digest('hex').slice(0, 32); }

function fresh(rows, now) {
  const cut = now - PCS_DAYS * 86400000;
  return (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' &&
    /^\d{5,25}$/.test(String(r.id)) && /^[0-9a-f]{32}$/.test(String(r.pc)) && Number(r.at) >= cut);
}

/*
  One account seen on one PC. sent is what the launcher sent: 64 hex
  characters, or anything else for a launcher that sent none, which keeps
  nothing. Returns false only when the file could not be written.
*/
function notePc(account, sent, now) {
  account = String(account || '');
  sent = String(sent || '');
  if (!/^\d{5,25}$/.test(account) || !/^[0-9a-f]{64}$/.test(sent)) return true;
  const pc = pcKey(sent);
  const rows = fresh(jsonFile(PCS, []), now).filter((r) => !(r.id === account && r.pc === pc));
  rows.unshift({ id: account, pc: pc, at: now });
  if (putJson(PCS, rows.slice(0, PCS_MOST))) return true;
  console.log('[thornswood-docs] could not write which accounts share a PC (pcs.json)');
  return false;
}

/* Account -> the other accounts seen on one of its PCs, for those that have any. */
function pcsSharedBy(now) {
  const byPc = {};
  for (const r of fresh(jsonFile(PCS, []), now)) (byPc[r.pc] = byPc[r.pc] || new Set()).add(r.id);
  const out = {};
  for (const pc of Object.keys(byPc)) {
    const ids = Array.from(byPc[pc]);
    if (ids.length < 2) continue;
    for (const id of ids) {
      const set = new Set(out[id] || []);
      for (const other of ids) if (other !== id) set.add(other);
      out[id] = Array.from(set).sort();
    }
  }
  return out;
}

/* The Linked page's accounts, each with sharesPc when another shares a PC. */
function withSharedPcs(linked, shared) {
  return (Array.isArray(linked) ? linked : []).map((u) => {
    const others = u && shared[String(u.id)];
    return others ? Object.assign({}, u, { sharesPc: others }) : u;
  });
}

/* The hourly sweep's part: rows past their 30 days go. */
function sweepPcs(now) {
  const raw = jsonFile(PCS, []);
  const rows = Array.isArray(raw) ? raw : [];
  const kept = fresh(rows, now);
  const out = { rows: rows.length, kept: kept.length, written: false };
  if (kept.length === rows.length) return out;
  out.written = putJson(PCS, kept);
  if (!out.written) console.log('[thornswood-docs] could not drop the rows of pcs.json past their 30 days');
  return out;
}

Object.assign(module.exports, { PCS, PCS_DAYS });
