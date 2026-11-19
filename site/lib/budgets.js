'use strict';

const READ_WINDOW = 60000;
const UPLOAD_WINDOW = 3600000;
const UPLOAD_BYTES = 500 * 1048576;

// Reserve one of the 4096 rows for arrivals without a dedicated row. They
// share a real budget, rather than going unmetered or evicting live counts.
// Keep using that row until it expires, even if a dedicated slot opens.
function budgetRows(window, slots, make) {
  const rows = new Map();
  let reserve;
  const expired = (row, now) => !row.active && now - row.start >= window;
  return (key, now) => {
    for (const [id, row] of rows) if (expired(row, now)) rows.delete(id);
    if (reserve && expired(reserve, now)) reserve = undefined;
    if (rows.has(key)) return rows.get(key);
    if (reserve) return reserve;
    const row = make(now);
    if (rows.size < slots) rows.set(key, row);
    else reserve = row;
    return row;
  };
}

function wait(row, window, now) {
  return Math.max(1, Math.ceil((row.start + window - now) / 1000));
}

function readBudget(slots = 4095) {
  const rowFor = budgetRows(READ_WINDOW, slots, start => ({start, count:0}));
  return (key, now) => {
    const row = rowFor(key, now);
    if (row.count >= 120) return wait(row, READ_WINDOW, now);
    row.count++;
    return 0;
  };
}

function uploadBudget(slots = 4095) {
  const rowFor = budgetRows(UPLOAD_WINDOW, slots, start => ({start, count:0, bytes:0, active:0}));
  return (key, now, copy) => {
    const row = rowFor(key, now);
    if (row.active >= 2 || row.count >= 40 || row.bytes >= UPLOAD_BYTES) {
      return {wait:wait(row, UPLOAD_WINDOW, now)};
    }
    if (!copy) row.count++;
    row.active++;
    return {row};
  };
}

module.exports = { readBudget, uploadBudget, UPLOAD_BYTES };
