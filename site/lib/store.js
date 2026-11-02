/*
  Reading and writing the site's JSON and documents without leaving half a
  file, the issue boards, and who accepted the rules (#428).
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { boardRev, noteRules, readDoc, writeBoardOne, writeDoc };

const fs     = require('fs');
const path   = require('path');
const { DATA, FOR_BOT, LISTS } = require('./base');
const { BOARDS, DOCS } = require('./pages');

const jsonFile = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    // A missing file is the normal empty case. A file that exists but will
    // not parse usually means a crash mid-write left truncated JSON; shout
    // so bans / linked / inbox do not silently become the empty fallback.
    // existsSync answers false rather than throwing, so no try (#2736). The
    // error's name or code and never its message: a newer Node puts a piece
    // of the text in a parse error's message, and these files hold Discord
    // ids and addresses.
    if (fs.existsSync(p)) {
      console.error('[thornswood-docs] JSON will not parse, using fallback for ' + p + ': ' + ((e && (e.code || e.name)) || 'unknown'));
    }
    return fallback;
  }
};
const putJson = (p, o) => putFile(p, () => JSON.stringify(o, null, 2));
const putFile = (p, text) => {
  // Same-folder temp + rename so a crash mid-write cannot leave truncated
  // JSON that jsonFile would then quietly replace with the empty fallback
  // (bans, linked accounts, inbox, and the rest of putJson callers), or a
  // moderation.log cut short by its keeping time (#2353). text is the body,
  // or a function that makes it, so a body that will not stringify is a
  // failed write like any other.
  // A temp file that will not go is said, by its name and the error code
  // (#2736): it holds a whole copy of the file, and a folder full of them is
  // otherwise found by somebody wondering where the disk went. One that was
  // never made is not there to go, and is tested for.
  // A held file that is there and will not read is never written over
  // (#2180, heldNow says it on the log): the write it would be is the empty
  // fallback plus one row, which is every other row gone.
  if (heldShape(p) && heldNow(p).broken) return false;
  const tmp = path.join(path.dirname(p), '.' + path.basename(p) + '.' + process.pid + '.tmp');
  const dropTmp = () => {
    if (!fs.existsSync(tmp)) return;
    try { fs.unlinkSync(tmp); }
    catch (e2) { console.error('[thornswood-docs] could not remove ' + tmp + ' (' + (e2.code || e2.message) + ')'); }
  };
  try {
    const body = typeof text === 'function' ? text() : String(text);
    fs.writeFileSync(tmp, body, 'utf8');
    try { fs.renameSync(tmp, p); }
    catch (e) {
      // Windows: rename onto an existing file can fail; replace then drop tmp.
      try { fs.copyFileSync(tmp, p); } finally { dropTmp(); }
    }
    return true;
  } catch (e) {
    dropTmp();
    return false;
  }
};
const docPath = (n) => Object.prototype.hasOwnProperty.call(DOCS, n)
  ? path.join(DATA, n + '.md') : null;

function readDoc(n) {
  const p = docPath(n);
  if (!p) return null;
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; }
}

function writeDoc(n, text) {
  const p = docPath(n);
  if (!p) return false;
  try {
    // The page is still saved when its .bak cannot be made, and that is said
    // (#2736), so the undo that is not there is not found out when it is
    // needed.
    if (fs.existsSync(p)) {
      try { fs.copyFileSync(p, p + '.bak'); }
      catch (e) { console.error('[thornswood-docs] could not keep ' + path.basename(p) + '.bak before saving it (' + (e.code || e.message) + ')'); }
    }
    fs.writeFileSync(p, text, 'utf8');
    return true;
  } catch (e) { return false; }
}

const BOARDFILE = path.join(DATA, 'board.json');
const readBoard = () => jsonFile(BOARDFILE, {});
// The bot's lists (#3140), or null when there is no file yet or it will not
// read (jsonFile says which).
const readLists = () => jsonFile(LISTS, null);
// EVERY BOARD HAS A REVISION (#2188). One board is saved at a time, so two
// people on two boards never overwrite each other, but until 11 October two
// people on the SAME board did, silently: last save won and the other edit
// was gone. Now board.json keeps _rev, a number per board, bumped on every
// save. /api/all hands the hub each board's number as boardRevs, the hub
// sends back the one it last saw in X-Board-Rev, and a save made from an
// older copy is refused with 409 and a sentence saying to reload, rather
// than written over somebody else's change. A save with no X-Board-Rev at
// all (a hub page opened before this went live) is refused with 428 for the
// same reason: it cannot say which copy it was made from. The check and the
// write are one synchronous step in one process, so two saves cannot both
// pass it.
function boardRev(all, name) {
  const r = all && all._rev && all._rev[name];
  return (typeof r === 'number' && r >= 0 && Math.floor(r) === r) ? r : 0;
}
function writeBoardOne(name, value, seenRev) {
  if (!Object.prototype.hasOwnProperty.call(BOARDS, name)) return { ok: false, status: 400, error: 'no such board' };
  const all = readBoard();
  const now = boardRev(all, name);
  if (seenRev === undefined || seenRev === null || seenRev === '') {
    return { ok: false, status: 428, error: 'no revision', rev: now,
      message: 'This page was opened before boards checked for clashing saves. Reload it, then make your change again.' };
  }
  if (String(seenRev) !== String(now)) {
    return { ok: false, status: 409, error: 'conflict', rev: now,
      message: 'Somebody else saved this board since you opened it, so your change was not saved over theirs. Reload to see their change, then make yours again.' };
  }
  all[name] = value;
  all._rev = Object.assign({}, all._rev && typeof all._rev === 'object' ? all._rev : {});
  all._rev[name] = now + 1;
  // No boards file yet is the first save and has nothing to keep; one that is
  // there and cannot be copied is said, and the save goes ahead (#2736).
  if (fs.existsSync(BOARDFILE)) {
    try { fs.copyFileSync(BOARDFILE, BOARDFILE + '.bak'); }
    catch (e) { console.error('[thornswood-docs] could not keep ' + path.basename(BOARDFILE) + '.bak before saving a board (' + (e.code || e.message) + ')'); }
  }
  if (!putJson(BOARDFILE, all)) return { ok: false, status: 500, error: 'could not save' };
  return { ok: true, status: 200, rev: now + 1 };
}

const RESULTS = path.join(DATA, 'results.json');
const INBOX   = path.join(FOR_BOT, 'inbox.json');

// ==== thornswood rules accepted ====
/* Who accepted the rules, by Discord id (#428). Before this nobody ever did:
   somebody could join for the invite, be let in and press Play having agreed
   to nothing. The alpha application in the Discord asks, the bot sends the
   answer with the ticket, and it is kept here rather than only in the inbox,
   because the inbox is trimmed and this record should not be.

   One row per Discord id: the latest answer, its time and their words, and
   the time of their first yes, which a later answer never moves. A file that
   is there and cannot be read is never written over, so a bad read cannot
   throw everybody else's answers away. */
const RULES_OK = path.join(DATA, 'rules-accepted.json');

function noteRules(file, discordId, rules, by, now) {
  const id = String(discordId || '').replace(/[^0-9]/g, '').slice(0, 20);
  if (!id || !rules || typeof rules !== 'object') return false;
  let book = {};
  if (fs.existsSync(file)) {
    try { book = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
    catch (e) { return false; }
    if (!book || typeof book !== 'object' || Array.isArray(book)) return false;
  }
  const had = (book[id] && typeof book[id] === 'object') ? book[id] : {};
  const yes = rules.yes === true;
  book[id] = {
    yes: yes,
    at: now,
    said: String(rules.said || '').slice(0, 200),
    by: String(by || '').slice(0, 60),
    firstYes: had.firstYes || (yes ? now : null)
  };
  return putJson(file, book);
}
// ==== end thornswood rules accepted ====

Object.assign(module.exports, { INBOX, jsonFile, putFile, putJson, readBoard,
  readLists, RESULTS, RULES_OK });

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { heldNow, heldShape } = require('./staff');
