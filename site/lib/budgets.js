'use strict';
/*
  budgets.js: the site's per-sender counts, kept in bounded tables that a
  full table cannot lock everybody out of (#4316).

  The public read limit and the upload budget each kept one row per sender
  (an address, an IPv6 /64) in a table of at most 4096, and once it held 4096
  they refused every sender it had no row for. One machine spraying /64s
  could fill a table, and then every new visitor was answered "busy" for a
  minute (/api/public and the other public reads) or an hour (gallery and hub
  uploads), while the one doing it carried on.

  Each sender is now named at three widths: its own address (an IPv6 /64, an
  IPv4 address), then its wider network (/48, or /24), then the widest (/32,
  or /16), each width with a table of its own (senderKeys in limits.js). A
  sender is counted at the narrowest width that has its row or room for one.
  So once the narrow table is full, a sprayer's next addresses share the row
  of the network they all come from, and somebody arriving from anywhere else
  gets a row of their own at that width. Every table stays bounded, so memory
  does too. Only a sender whose widest network has no row and no room, which
  takes thousands of /32s at once, is refused for being unseen, as before.

  Rows go when their window has passed and nothing is still using them (an
  upload in progress keeps its row until it is done).
*/

const TABLE_ROWS = 4096;
const READ_WINDOW = 60000, READ_CAP = 120;
const UPLOAD_WINDOW = 3600000, UPLOAD_FILES = 40, UPLOAD_AT_ONCE = 2;
const UPLOAD_BYTES = 500 * 1048576;

function senderRows(window, make, slots) {
  const tables = [];
  const gone = (row, now) => !row.active && now - row.start >= window;
  return (keys, now) => {
    while (tables.length < keys.length) tables.push(new Map());
    for (const table of tables) {
      for (const [key, row] of table) if (gone(row, now)) table.delete(key);
    }
    for (let i = 0; i < keys.length; i++) {
      const table = tables[i];
      const row = table.get(keys[i]);
      if (row) return row;
      if (table.size < slots) {
        const fresh = make(now);
        table.set(keys[i], fresh);
        return fresh;
      }
    }
    return null;
  };
}

function waitFor(row, window, now) {
  return Math.max(1, Math.ceil((row.start + window - now) / 1000));
}

// (keys, now) -> 0 to read now, or the seconds to wait.
function readBudget(slots = TABLE_ROWS) {
  const rowFor = senderRows(READ_WINDOW, (start) => ({ start, count: 0 }), slots);
  return (keys, now) => {
    const row = rowFor(keys, now);
    if (!row) return 1;
    if (row.count >= READ_CAP) return waitFor(row, READ_WINDOW, now);
    row.count++;
    return 0;
  };
}

// (keys, now, copy) -> { row } to take the upload, { wait } when this sender
// has used its hour, or { full: true } when no width has room for it.
function uploadBudget(slots = TABLE_ROWS) {
  const rowFor = senderRows(UPLOAD_WINDOW,
    (start) => ({ start, count: 0, bytes: 0, active: 0 }), slots);
  return (keys, now, copy) => {
    const row = rowFor(keys, now);
    if (!row) return { full: true };
    if (row.active >= UPLOAD_AT_ONCE || row.count >= UPLOAD_FILES || row.bytes >= UPLOAD_BYTES) {
      return { wait: waitFor(row, UPLOAD_WINDOW, now) };
    }
    if (!copy) row.count++;
    row.active++;
    return { row };
  };
}

module.exports = { readBudget, uploadBudget, TABLE_ROWS, UPLOAD_BYTES };
