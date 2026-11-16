/*
  Taking gold or a thing back out of a character (#6271), asked for by an
  admin on the hub and done by the game server that holds the character.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { askTakeBack, cleanTakeBackAsk, takeBackRows, takeBackTurn };

const crypto = require('crypto');
const path   = require('path');
const { DATA } = require('./base');
const { jsonFile, putJson } = require('./store');

/*
  WHY. Patrick, 16 Nov 2026: "With trade logs you can just delete ill gotten
  gold instead of having to wipe or let your economy get fucked". The gold
  and trade log (#6270) says who has gold gained by cheating; nothing let
  an admin take it out of a character, and most of the time that character
  is not online.

  WHY THE GAME SERVER DOES IT, NOT THE DATABASE. The game server reads the
  whole world into memory when it starts and writes changed characters back
  to its store as they change. An edit made straight in the store (the
  files, or MongoDB once #6237 moves the worlds there) is written over the
  next time that character changes in the running server, and lost at the
  next start if it does not. So the ask waits here and the game server that
  holds the character does it, online or not: the engine keeps every
  character in memory whether its owner is connected or not, and saves the
  change like any other.

  HOW. An admin (the Owner, the Co-Owner and the Dev rank, the same as the
  play sessions) asks on the hub's Gold and trades page: which server, the
  profile, gold or a thing by its record (12eb7:Skyrim.esm, the record the
  log shows), how many, and why. The ask waits in data\takeback.json. Each
  game server asks POST /api/takeback (door key in the X-Thornswood-Key
  header, /dev/api/takeback for dev) every 30 seconds, hands back what it
  did with the asks it had, and gets the ones still waiting for it. It
  takes what the character holds, up to the count asked, never more, and
  marks the ask on the character itself, in the same save as the pack, so
  an answer that never reached the site cannot make it take twice.

  The site writes one line in moderation.log when the game server says it
  is done, which the bot says in the staff channel: who asked, whose
  character, what was taken of what was asked, and why.

  KEPT like a staff record, 365 days from the ask, then dropped by the
  hourly sweep (retention.js). The privacy page's staff log line covers it.
*/
const TAKEBACK = path.join(DATA, 'takeback.json');
const TAKEBACK_DAYS = 365;
const TAKEBACK_MOST = 1000000000;
const TAKEBACK_SHOWN = 200;
// A record the engine names: a form id in hex, a colon, a plugin.
const RECORD = /^[0-9a-f]{1,8}:[^:\\/]{1,80}\.(esm|esp|esl)$/i;
const GOLD_RECORD = 'f:Skyrim.esm';

function readAll(now) {
  const doc = jsonFile(TAKEBACK, { rows: [] });
  const rows = (doc && Array.isArray(doc.rows)) ? doc.rows : [];
  const cut = (Number(now) || Date.now()) - TAKEBACK_DAYS * 86400000;
  // A row with no time that reads is kept rather than guessed at (#2353).
  return rows.filter((r) => r && typeof r === 'object' && !(Number(r.at) > 0 && Number(r.at) < cut));
}

/*
  An admin's ask held to its shape, or { error } in words for the hub.
  o: { server, profileId, record, count, why }. record '' or 'gold' is gold.
*/
function cleanTakeBackAsk(o) {
  if (!o || typeof o !== 'object') return { error: 'nothing was asked' };
  const server = o.server === 'dev' ? 'dev' : (o.server === 'main' ? 'main' : '');
  if (!server) return { error: 'say which server: main or dev' };
  const pid = Number(o.profileId);
  if (!Number.isInteger(pid) || pid <= 0) return { error: 'a profile number names the character' };
  let record = String(o.record == null ? '' : o.record).trim();
  if (!record || record.toLowerCase() === 'gold') record = GOLD_RECORD;
  if (!RECORD.test(record)) return { error: 'a thing is named by its record, like 12eb7:Skyrim.esm, or gold' };
  const count = Number(o.count);
  if (!Number.isInteger(count) || count <= 0 || count > TAKEBACK_MOST) return { error: 'how many is a whole number above nothing' };
  const why = String(o.why == null ? '' : o.why).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
  if (!why) return { error: 'say why: it goes in the staff log' };
  const name = String(o.name == null ? '' : o.name).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
  return { server, pid, record, count, why, name: record === GOLD_RECORD ? 'gold' : (name || record) };
}

/* Keeps an ask an admin made. Returns the row, or null when it could not be saved. */
function askTakeBack(ask, w, whoName, now) {
  const rows = readAll(now);
  const row = {
    id: crypto.randomBytes(8).toString('hex'), at: now, server: ask.server, pid: ask.pid,
    whoName: String(whoName || '').slice(0, 80), record: ask.record, name: ask.name, count: ask.count,
    why: ask.why, by: String(w.id || ''), byName: String(w.name || '').slice(0, 60), state: 'waiting'
  };
  rows.push(row);
  return putJson(TAKEBACK, { rows }) ? row : null;
}

/* What the hub shows: the newest asks first. */
function takeBackRows(now) {
  return readAll(now).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0)).slice(0, TAKEBACK_SHOWN);
}

/*
  A game server's turn: what it did with the asks it had (done: [{ id, ok,
  took, why }]), and the asks still waiting for it. Returns { waiting,
  finished, saved }: finished are the rows this turn closed, for the
  moderation line, and saved is false when the file could not be written,
  so the route answers 500 and the game server hands the same answers
  back next time.
*/
function takeBackTurn(server, done, now) {
  const rows = readAll(now);
  const byId = {};
  rows.forEach((r) => { byId[r.id] = r; });
  const finished = [];
  for (const d of (Array.isArray(done) ? done : []).slice(0, 500)) {
    if (!d || typeof d !== 'object') continue;
    const r = byId[String(d.id || '')];
    if (!r || r.server !== server || r.state !== 'waiting') continue;
    const took = Number(d.took);
    r.state = d.ok === true ? 'done' : 'failed';
    r.took = Number.isInteger(took) && took >= 0 && took <= r.count ? took : 0;
    r.answer = String(d.why == null ? '' : d.why).replace(/[\u0000-\u001f]/g, ' ').slice(0, 300);
    r.doneAt = now;
    finished.push(r);
  }
  const saved = finished.length ? putJson(TAKEBACK, { rows }) : true;
  const waiting = rows.filter((r) => r.server === server && r.state === 'waiting')
    .map((r) => ({ id: r.id, pid: r.pid, record: r.record, count: r.count, why: r.why, byName: r.byName }));
  return { waiting, finished: saved ? finished : [], saved };
}

/* The hourly sweep's part: asks past 365 days go. */
function sweepTakeBack(now) {
  const doc = jsonFile(TAKEBACK, null);
  if (!doc || !Array.isArray(doc.rows)) return 0;
  const kept = readAll(now);
  const gone = doc.rows.length - kept.length;
  if (gone > 0) putJson(TAKEBACK, { rows: kept });
  return gone;
}

Object.assign(module.exports, { GOLD_RECORD, sweepTakeBack, TAKEBACK, TAKEBACK_DAYS });
