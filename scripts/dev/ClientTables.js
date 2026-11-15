// ClientTables.js
//
// Where a builder puts a table the front plugin reads (#5191, stage 4).
//
// game/plugins/thornswood-front.js carried three tables pasted between
// markers (PLACED_WATERS, STALL_SPOTS and NO_BOUNTY_FACTIONS), so every load
// order change rewrote the plugin's own source and the tables could not leave
// git. Now each is a plugin of its own, game/plugins/thornswood-table-<name>.js,
// which puts its rows on globalThis.Thornswood.clientTables, and the front
// plugin reads them there when it uses them. Each opens with the whose-game
// reader every plugin but the front one opens with (tests/test-whose-game-gate.js),
// so it sets its rows on the first tick, and only when the game is ours; the
// front plugin uses a table only once a game is loaded, long after that tick.
// The launcher ships every game/plugins/*.js, so they go where the front plugin is.
//
// One row to a line, each compact, so the same rows give the same bytes from
// JavaScript and from Python (client_tables.py), and a change to one row is
// one line; game/tests/test-5191-client-tables.js holds the two alike.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'game', 'plugins');
const NAME = /^[A-Z][A-Z0-9_]*$/;
// The reader, character for character as tests/test-whose-game-gate.js holds it.
const READER = [
  "// ------------------------------------------------------------ whose game ----",
  "// thornswood-front.js owns the whose-game check (issue #485): the client",
  "// settings must point at this server and the launcher's session note must be",
  "// fresh, or every Thornswood plugin stays idle. Front publishes the check as",
  "// globalThis.Thornswood.whoseGame, and only when it says ours. This plugin",
  "// runs nothing until the first tick: Skyrim Platform runs every file in",
  "// Data/Platform/Plugins in one pass and sends that tick after the pass",
  "// (TickImpl in the fork's skyrim-platform SkyrimPlatform.cpp), so by then",
  "// front has published the check or did not load, whichever order the files",
  "// came in. Nothing published means idle; so does the check saying not ours.",
  "(function (start) {",
  "  skyrimPlatform.once('tick', function () {",
  "    const T = globalThis.Thornswood;",
  "    if (!T || typeof T.whoseGame !== 'function' || !T.whoseGame()) { return; }",
  "    start();",
  "  });",
  "})(function () {",
  "'use strict';"
].join('\n');
const PREFIX = '((globalThis.Thornswood = globalThis.Thornswood || {}).clientTables = globalThis.Thornswood.clientTables || {}).';

function file(name, dir) {
  if (!NAME.test(name)) { throw new Error('a client table is named like the constant the front plugin used, not ' + name); }
  return path.join(dir || DIR, 'thornswood-table-' + name.toLowerCase().replace(/_/g, '-') + '.js');
}

// The line the plugin says in the console once its rows are in, so a log
// shows the table loaded and how many rows it had.
function said(name) {
  return "skyrimPlatform.printConsole('[thornswood-table] " + name + ": ' + globalThis.Thornswood.clientTables." + name + ".length + ' rows');\n";
}

function body(name, value, by) {
  const rows = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(rows)) { throw new Error('the client table ' + name + ' is a list of rows'); }
  return '// ' + name + ', a table the front plugin reads (#5191). Built by ' + by + ';\n' +
    '// the content build writes it, so do not hand edit.\n' + READER + '\n' +
    PREFIX + name + ' = [' + (rows.length ? '\n' + rows.map(function (r) { return JSON.stringify(r); }).join(',\n') + '\n' : '') + '];\n' + said(name) + '});\n';
}

function isCurrent(name, value, by, dir) {
  try { return fs.readFileSync(file(name, dir), 'utf8') === body(name, value, by); } catch (e) { if (e.code === 'ENOENT') { return false; } throw e; }
}

function write(name, value, by, dir) {
  if (isCurrent(name, value, by, dir)) { return false; }
  const f = file(name, dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body(name, value, by));
  return true;
}

// The rows, read the way the front plugin gets them, without running the file.
function read(name, dir) {
  const text = fs.readFileSync(file(name, dir), 'utf8');
  const at = text.indexOf(PREFIX + name + ' = ');
  if (at < 0) { throw new Error(file(name, dir) + ' does not set ' + name); }
  const from = at + PREFIX.length + name.length + 3;
  const end = text.indexOf('];\n', from);
  if (end < 0) { throw new Error(file(name, dir) + ' does not close ' + name); }
  return JSON.parse(text.slice(from, end + 1));
}

module.exports = { DIR, READER, PREFIX, file, body, isCurrent, write, read };
