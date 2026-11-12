/*
  Each Discord account's settings, kept here and nowhere else (#5939).

  Patrick, 12 Nov: "chacrthers, saves, and settings should all be cloud saved
  by the server and linked to your discord and not all be saved locally".
  Until then every setting a person chose lived only on their PC: the keys,
  field of view, chat fade and needs bars the in-game Settings panel writes
  into Data\SKSE\Plugins\Thornswood.ini, the emote wheel's slots, whether the
  scroll is shown before the character choice, what they saved in each mod's
  own menu (MCM Helper's Data\MCM\Settings), and the launcher's own choices in
  config.json. An uninstall, a new game folder or another PC started them all
  over.

  So the site keeps them as files under the Discord id, in settings.json:

    { "<discord id>": { at, files: { "<name>": "<text>" } } }

  The launcher puts them in place before the game starts and sends them back
  when it closes (YourSettings.cs), and sends launcher.json whenever one of
  its own choices changes. What belongs to the PC (the microphone's name,
  the voice address, screen and graphics settings) is never among them.

  Only the names below, only text, each and all of them capped, so an account
  can keep its settings and nothing else here. Pure apart from the path:
  the route reads the file, calls merge, and writes it.
*/

'use strict';

const path = require('path');
const { DATA } = require('./base');

const SETTINGS = path.join(DATA, 'settings.json');
// The names an account may keep. A mod menu's file is named by the mod, so
// that one is a shape and not a list.
const NAMES = [
  /^launcher\.json$/,
  /^game\/Thornswood\.ini$/,
  /^game\/thornswood-emote-slots\.json$/,
  /^game\/thornswood-intro\.txt$/,
  /^mcm\/[A-Za-z0-9 _.()'-]{1,80}\.ini$/
];
// Thornswood.ini is 8,523 bytes on One (12 Nov); a mod menu's file is one
// mod's few dozen values. Room for both to grow, and a cap on all of it.
const FILE_MOST = 64 * 1024;
const FILES_MOST = 200;
const ALL_MOST = 1024 * 1024;

function nameOk(n) { return typeof n === 'string' && !n.includes('..') && NAMES.some((re) => re.test(n)); }

/*
  The account's files with what was sent laid over them: a text replaces the
  file of that name, null removes it. Returns { files } or { why } when the
  whole of it is refused, and then nothing changes.
*/
function merge(have, sent) {
  if (!sent || typeof sent !== 'object' || Array.isArray(sent)) return { why: 'no files were sent' };
  const files = Object.assign({}, (have && have.files && typeof have.files === 'object') ? have.files : {});
  for (const n of Object.keys(sent)) {
    if (!nameOk(n)) return { why: n.slice(0, 100) + ' is not a setting the site keeps' };
    const v = sent[n];
    if (v === null) { delete files[n]; continue; }
    if (typeof v !== 'string') return { why: n + ' is not text' };
    if (Buffer.byteLength(v, 'utf8') > FILE_MOST) return { why: n + ' is larger than ' + (FILE_MOST / 1024) + ' KB' };
    files[n] = v;
  }
  const names = Object.keys(files);
  if (names.length > FILES_MOST) return { why: 'more than ' + FILES_MOST + ' files' };
  let all = 0;
  for (const n of names) all += Buffer.byteLength(files[n], 'utf8');
  if (all > ALL_MOST) return { why: 'more than ' + (ALL_MOST / 1024) + ' KB of settings' };
  return { files };
}

module.exports = { merge, nameOk, SETTINGS };
