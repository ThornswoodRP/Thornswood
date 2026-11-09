/*
  Reading and writing the site's JSON and documents without leaving half a
  file, and who accepted the rules (#428).
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { noteRules, readDoc, writeDoc };

const fs     = require('fs');
const path   = require('path');
const { DATA, FOR_BOT, LISTS } = require('./base');
const { DOCS } = require('./pages');

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

// The hub's boards, their file and their save (#2188) went in #4359: the
// known issues and the roadmap are written from the issue board (#3140), and
// nothing on the hub edits a board.
// The bot's lists (#3140), or null when there is no file yet or it will not
// read (jsonFile says which).
const readLists = () => jsonFile(LISTS, null);

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

Object.assign(module.exports, { INBOX, jsonFile, putFile, putJson,
  readLists, RESULTS, RULES_OK });

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { heldNow, heldShape } = require('./staff');
