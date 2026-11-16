/*
  The gold and trade log (#6270): every trade and every move of gold between
  people, by Discord account and character, for staff to search on the hub.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { cleanLedgerRow, ledgerDay, searchLedger, sweepLedger, takeLedger };

const fs   = require('fs');
const path = require('path');
const { DATA } = require('./base');

/*
  WHAT IT IS FOR. Sura the Mad, an auditor, 15 Nov 2026: their server logged
  every time somebody moved a suspicious amount of gold, and with the log an
  admin takes back gold gained by a dupe instead of wiping or letting the
  economy break. Patrick took it up the same evening. Before this, a trade
  and gold picked up or dropped were lines in thornswood.log by character
  name only: no account, no flag and nothing staff could search.

  HOW IT ARRIVES. Each game server keeps the rows in memory as they happen
  and sends what it holds every 15 seconds, POST /api/ledger with the door
  key (the ledger block in game\gamemode.js); the dev server's door names
  the site with /dev, so its rows land on /dev/api/ledger and are kept apart.
  One request for many rows rather than a write on the game server per
  move: the game server's loop does no file work for it, and a move costs
  it a few lookups and an array push (measured in the load test, #6270).

  HOW IT IS KEPT. One file a server a day, data\ledger\<server>-<day>.jsonl,
  one row a line, appended. LEDGER_KEEP_DAYS, 90, the same as the gamemode's
  own log the lines came from: the hourly sweep deletes a whole day file once
  its day is past, and the privacy page says the same number.

  A ROW is a time, the server, a kind (trade, sale, take, drop or put), who
  it came from and who it went to (profile, character name and Discord
  account, either of which can be nobody: gold dropped goes to the ground),
  the gold and the things, what came back the other way in a trade, where
  it came from (a chest, a body, the ground), and whether it was flagged.
  Everything is held to that shape on the way in; nothing else is kept.
*/
const LEDGER = path.join(DATA, 'ledger');
const LEDGER_KEEP_DAYS = 90;
const LEDGER_KINDS = ['trade', 'halftrade', 'sale', 'take', 'drop', 'put'];
// The most rows one push may carry, and the most one search hands back.
const LEDGER_PUSH_MOST = 5000;
const LEDGER_FIND_MOST = 500;
const GOLD_MOST = 1000000000;

/* The box's own date, as the economy's days are (same box as the game). */
function ledgerDay(t) {
  const d = new Date(t);
  const two = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}

function cleanText(v, most) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, most); }
function cleanGold(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= GOLD_MOST ? n : 0;
}
function cleanPerson(p) {
  if (!p || typeof p !== 'object') return null;
  const pid = Number(p.pid);
  const out = {
    pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
    name: cleanText(p.name, 64),
    account: /^\d{5,25}$/.test(String(p.account || '')) ? String(p.account) : ''
  };
  return (out.pid || out.name || out.account) ? out : null;
}
function cleanThings(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const t of list.slice(0, 48)) {
    if (!t || typeof t !== 'object') continue;
    const c = Number(t.c);
    if (!Number.isInteger(c) || c <= 0 || c > GOLD_MOST) continue;
    out.push({ n: cleanText(t.n, 80), desc: cleanText(t.desc, 80), c: c });
  }
  return out;
}

/* One row held to its shape, or null for one that is not a row. */
function cleanLedgerRow(o, srv, now) {
  if (!o || typeof o !== 'object') return null;
  const kind = String(o.kind || '');
  if (LEDGER_KINDS.indexOf(kind) < 0) return null;
  let at = Number(o.at);
  // A time from the future or past the keeping time is the game server's
  // clock or a stale row; it is kept at the time it arrived instead of lost.
  if (!Number.isFinite(at) || at > now + 60000 || at < now - LEDGER_KEEP_DAYS * 86400000) at = now;
  const row = {
    at: Math.floor(at), server: srv, kind: kind,
    from: cleanPerson(o.from), to: cleanPerson(o.to),
    gold: cleanGold(o.gold), things: cleanThings(o.things),
    source: cleanText(o.source, 120), where: cleanText(o.where, 80),
    flagged: o.flagged === true
  };
  if (kind === 'trade' || kind === 'halftrade' || kind === 'sale') {
    row.backGold = cleanGold(o.backGold);
    row.backThings = cleanThings(o.backThings);
  }
  if (!row.from && !row.to) return null;
  if (!row.gold && !row.things.length && !row.backGold && !(row.backThings && row.backThings.length)) return null;
  return row;
}

function dayFile(srv, day) { return path.join(LEDGER, srv + '-' + day + '.jsonl'); }

/*
  A push's rows, each into the file of its own day. Returns how many were
  kept, or -1 when the folder or a file could not be written, so the route
  answers 500 and the game server keeps them for its next push.
*/
function takeLedger(srv, rows, now) {
  if (!Array.isArray(rows)) return 0;
  const byDay = {};
  let n = 0;
  for (const raw of rows.slice(0, LEDGER_PUSH_MOST)) {
    const row = cleanLedgerRow(raw, srv, now);
    if (!row) continue;
    const day = ledgerDay(row.at);
    (byDay[day] = byDay[day] || []).push(JSON.stringify(row));
    n++;
  }
  try {
    fs.mkdirSync(LEDGER, { recursive: true });
    for (const day of Object.keys(byDay)) fs.appendFileSync(dayFile(srv, day), byDay[day].join('\n') + '\n');
  } catch (e) {
    console.log('[thornswood-docs] could not write the gold and trade log: ' + e.message);
    return -1;
  }
  return n;
}

/* The day files of one server, or of both, newest day first. */
function dayFiles(srv) {
  let names = [];
  try { names = fs.readdirSync(LEDGER); } catch (e) { return []; }
  const re = /^(main|dev)-(\d{4}-\d{2}-\d{2})\.jsonl$/;
  return names.map((n) => re.exec(n)).filter((m) => m && (!srv || m[1] === srv))
    .sort((a, b) => (a[2] === b[2] ? a[1].localeCompare(b[1]) : (a[2] < b[2] ? 1 : -1)))
    .map((m) => ({ file: path.join(LEDGER, m[0]), server: m[1], day: m[2] }));
}

function matches(person, q) {
  if (!person) return false;
  if (q.account && person.account === q.account) return true;
  if (q.pid && person.pid === q.pid) return true;
  if (q.name && person.name.toLowerCase().indexOf(q.name) >= 0) return true;
  return false;
}

/*
  Staff's search, newest first. q is a Discord account (a long number), a
  profile number (a short one) or the start or any part of a character's
  name; empty finds everything. flagged keeps only the flagged rows. At most
  LEDGER_FIND_MOST rows, and the answer says when there were more.
*/
function searchLedger(text, srv, flaggedOnly, now) {
  text = String(text || '').trim();
  const q = {};
  if (/^\d{15,25}$/.test(text)) q.account = text;
  else if (/^\d{1,14}$/.test(text)) q.pid = Number(text);
  else if (text) q.name = text.toLowerCase();
  const any = !text;
  const cut = ledgerDay(now - (LEDGER_KEEP_DAYS - 1) * 86400000);
  const rows = [];
  let more = false;
  for (const f of dayFiles(srv === 'main' || srv === 'dev' ? srv : '')) {
    if (f.day < cut) continue;
    let lines = [];
    try { lines = fs.readFileSync(f.file, 'utf8').split('\n'); } catch (e) { continue; }
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      let row;
      try { row = JSON.parse(lines[i]); } catch (e) { continue; }
      if (flaggedOnly && !row.flagged) continue;
      if (!any && !matches(row.from, q) && !matches(row.to, q)) continue;
      if (rows.length >= LEDGER_FIND_MOST) { more = true; break; }
      rows.push(row);
    }
    if (more) break;
  }
  rows.sort((a, b) => b.at - a.at);
  return { keepDays: LEDGER_KEEP_DAYS, rows, more };
}

/* The hourly sweep's part: a day file past the keeping time goes whole. */
function sweepLedger(now) {
  const cut = ledgerDay(now - (LEDGER_KEEP_DAYS - 1) * 86400000);
  let gone = 0;
  for (const f of dayFiles('')) {
    if (f.day >= cut) continue;
    try { fs.unlinkSync(f.file); gone++; }
    catch (e) { console.log('[thornswood-docs] could not delete ' + path.basename(f.file) + ' past its 90 days: ' + e.message); }
  }
  return gone;
}

Object.assign(module.exports, { LEDGER, LEDGER_KEEP_DAYS, LEDGER_KINDS });
