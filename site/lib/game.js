/*
  The game server as the site sees it: whether it answers, how many are in
  the world and in line, and the most it holds.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { mostOnlineFallback, seatsFull, worldFull };

const net    = require('net');
const fs     = require('fs');
const path   = require('path');
const { ROOT } = require('./base');
const { cfg } = require('./config');
const { feedFile } = require('./feed');

/*
  Whether the game server is up, and how many people are in it.

  Two different questions with two different answers. The gamemode already
  writes data/online.json whenever the count moves, so that is where the number
  comes from. But it only writes on a CHANGE, so a quiet server has an old
  timestamp and that file cannot tell you whether anything is running. For that
  the site opens a socket to the game's resources port on this same machine,
  which is the only answer that is never stale.

  The port matters. This used to connect to 7777, which is where the game's
  own traffic goes, and that traffic is UDP. Opening a TCP socket to a UDP port
  fails every time, so the front page said Server offline for as long as this
  code has existed, including while the server was up with people in it.

  Checked every ten seconds rather than per request, because the front page is
  the most requested thing here and none of this changes that fast.
*/
/*
  And the most the world holds at once (#481): the gamemode writes the
  server's own number into the same file as max, so the page says "3 of 30"
  and /api/play/join can say the world is full before the game starts. max
  is every seat, the staff seats too (Patrick, 12 Oct: "the real cap is 30
  but 25 for people with non staff roles I still want it to say of 30
  awake"); full says whether somebody without a staff role would wait.
*/
/*
  And how many wait at the menu for a seat (line), and whether somebody
  picking now would wait too (full), which the gamemode's seats block works
  out and writes beside the count.
*/
// Changed in place by pollGame, never replaced, so every module that took it
// reads the newest count (#5357).
const gameStatus = { up: false, online: 0, max: 0, line: 0, full: false, at: 0 };
/* online.json that is there and cannot be read is said (#2736), once, and
   again only after a read has worked, since this runs every ten seconds. No
   file is the normal case while the game server is down, and is tested for
   rather than thrown. */
let onlineUnread = '';
function pollGame() {
  const sock = new net.Socket();
  let done = false;
  const finish = (up) => {
    if (done) return;
    done = true;
    sock.destroy();
    let online = 0, max = 0, line = 0, full = false;
    let o = null, why = '';
    if (fs.existsSync(cfg.onlineFile)) {
      try { o = JSON.parse(fs.readFileSync(cfg.onlineFile, 'utf8')); }
      catch (e) { why = e.code || 'not JSON'; }
    }
    if (why && why !== onlineUnread) {
      console.error('[thornswood-docs] could not read the online count in ' + cfg.onlineFile + ' (' + why +
                    '), so the site shows nobody on until it reads again');
    }
    onlineUnread = why;
    if (o && typeof o.now === 'number') online = o.now;
    if (o && typeof o.max === 'number' && o.max > 0) max = o.max;
    if (o && typeof o.line === 'number' && o.line > 0) line = o.line;
    if (o && o.full === true) full = true;
    Object.assign(gameStatus, { up, online: up ? online : 0, max: up ? max : 0, line: up ? line : 0,
                                full: up && full, at: Date.now() });
  };
  sock.setTimeout(1500);
  sock.once('connect', () => finish(true));
  sock.once('timeout', () => finish(false));
  sock.once('error', () => finish(false));
  try { sock.connect(Number(cfg.gameCheckPort) || 3000, '127.0.0.1'); }
  catch (e) { finish(false); }
}
pollGame();
setInterval(pollGame, 10000).unref?.();

/*
  Whether somebody pressing Play now would wait for a seat, and what they are
  told (#481). Nobody is refused for numbers any more: Patrick, 29 Sep, a
  full world lets them into the game's menu, where they wait in line and join
  by themselves when it is their turn. The gamemode keeps the line.
*/
function seatsFull(st) {
  return !!(st && st.up && (st.full === true || (st.max > 0 && st.online >= st.max)));
}
function worldFull(online) {
  // The people in the world now, not max: max counts the staff seats, which
  // somebody told to wait cannot take, so "30 are in the world" at 25 is wrong.
  return 'Thornswood is full right now' + (online > 0 ? ': ' + online + ' people are in the world, the most it holds' : '') +
    ' at once during the alpha. Pick your character anyway: you will wait at the menu with your ' +
    'place in line on screen, and join by yourself when a seat frees.';
}

/*
  The most the world holds, for the home page and /api/public, when the
  server has not said (#481). Patrick, 29 Sep: "I still want it to say N of
  25 anyway"; 12 Oct, it is every seat, the staff seats too, "of 30".
  records\most-online.json is the one place the number lives: read here
  when the site runs from the repository (main's people and staffSeats), and
  otherwise the main feed's maxOnline, which Publish-Update.ps1 writes from
  that same file as the same seats and which the site on the VPS already
  serves. The server's own max still wins.
*/
const MOST_ONLINE_RECORD = path.join(ROOT, '..', 'records', 'most-online.json');
let mostOnlineSeen = { file: '', mtime: -1, size: -1, v: 0 };
function mostOnlineFallback() {
  for (const file of [MOST_ONLINE_RECORD, feedFile('feed')]) {
    if (!file) continue;
    let st;
    try { st = fs.statSync(file); } catch (e) { continue; }
    if (mostOnlineSeen.file === file && mostOnlineSeen.mtime === st.mtimeMs && mostOnlineSeen.size === st.size) {
      if (mostOnlineSeen.v > 0) return mostOnlineSeen.v;
      continue;
    }
    let v = 0;
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) || {};
      const n = file === MOST_ONLINE_RECORD
        ? Number(doc.people) + (Number(doc.staffSeats) > 0 ? Number(doc.staffSeats) : 0)
        : Number(doc.maxOnline);
      if (n > 0 && Math.floor(n) === n) v = n;
    } catch (e) { v = 0; }
    mostOnlineSeen = { file, mtime: st.mtimeMs, size: st.size, v };
    if (v > 0) return v;
  }
  return 0;
}

Object.assign(module.exports, { gameStatus });
