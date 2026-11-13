// test-2384-cursor-focus.js
//
// Issue 2384. The front plugin's keepCursor lowered and raised browser focus
// on every panel claim, and the J block did the same once after the game's
// journal shut. Both answered a Cursor Menu that browser.setFocused had only
// queued (BrowserApiTilted.cpp in the fork), so they fired on the first
// frame of every claim. The cursor is now kept in the fork (CursorFocus.h,
// the Cursor Menu's close event). This checks they are gone from the plugin
// and that nothing left in game\ or tests\ still leans on them.
//
// Read only.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SRC = process.env.FRONT || path.join(ROOT, 'game', 'plugins', 'thornswood-front.js');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

yes('no keepCursor in the plugin', !/keepCursor/.test(src));
yes('none of its counters or caps either', !/CURSOR_TRIES|CURSOR_AGAIN_MS|cursorTries|cursorTriedAt/.test(src));
yes('no "raised it again" log line, from keepCursor or the J block', !/raised it again/.test(src));
yes('nowhere does the plugin lower focus and raise it straight back',
    !/setFocused\(false\);\s*(?:sp\.browser\.)?setFocused\(true\)/.test(src));

const a = src.indexOf("sp.on('update', guard('journal after'");
const b = a < 0 ? -1 : src.indexOf('\n  }));\n', a);
const after = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
yes('the J block\'s journal after watcher is still there', after !== null);
yes('and it no longer touches focus', after !== null && !/setFocused/.test(after));
yes('and it still measures the book going', after !== null && /was gone ' \+\s*since/.test(after));

const tick = /applyFocus\(\);\n\s*\} catch \(e\) \{ \}/.test(src);
yes('the tick ends at applyFocus, with no cursor call after it', tick);

// Nothing else in game\ or tests\ still names it.
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) { continue; }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); } else if (/\.(js|ts|json)$/.test(e.name)) { out.push(p); }
  }
  return out;
}
const self = path.resolve(__filename);
const users = walk(path.join(ROOT, 'game'), []).concat(walk(path.join(ROOT, 'tests'), []))
  .filter(function (p) { return path.resolve(p) !== self; })
  .filter(function (p) { return /\bkeepCursor\s*\(|\bCURSOR_TRIES\s*[;)<>=]|cursor was down, raised it again/.test(fs.readFileSync(p, 'utf8')); });
yes('nothing in game\\ or tests\\ calls keepCursor or reads its log line' +
    (users.length ? ' (' + users.map(function (p) { return path.relative(ROOT, p); }).join(', ') + ')' : ''),
    users.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
