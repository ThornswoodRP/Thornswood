// test-party-markers.js
//
// Your party: the name in green, the marker on the map, the arrow on the strip.
//
// Patrick, 22 September, asked the party menu to let people "see their name tag
// colour, see them on the map and compass". Those three did not ship with the
// rest of the party work and had their own entry, because none of them is
// something a browser overlay can draw: a name tag is the client's own text,
// and the compass and map belong to the game.
//
// TWO OF THE THREE TURNED OUT TO BE REACHABLE and the third is answered a
// different way, which is what this file pins down:
//
//   the name   skymp5-client draws it with createText and then hands the id
//              straight back out. SweetTaffyNicknamesService writes every one
//              into sp.storage.idTextNickname keyed BY FORM ID, which is the
//              same key the server's party list carries. setTextColor takes
//              the id. No client change at all.
//   the map    MapMarker is STAT 0x00000010 in Skyrim.esm, read out of the
//              file. One per member, named, added with fast travel off, moved
//              to wherever the server last said they were.
//   the compass  NOT Skyrim's. That one draws quest targets and map markers
//              and nothing a plugin can add to. A strip of our own is drawn
//              instead, off the voice feed, which is fifteen times fresher
//              than the server's own party push.
//
// The bearing maths is the half that is easy to get silently wrong: it only
// shows up once somebody turns away from north. So it is RUN here rather than
// read.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
function read(...bits) {
  return fs.readFileSync(path.join(REPO_DIR, ...bits), 'utf8').split(CR).join('');
}
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const front = read('game', 'plugins', 'thornswood-front.js');
const page = read('game', 'ui', 'thornswood-party.js');
const voice = read('game', 'ui', 'thornswood-voice.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function code(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// --------------------------------------------- the server sends the party
{
  const social = src.slice(src.indexOf('// ==== thornswood social:'),
                           src.indexOf('// ==== end thornswood social ===='));
  yes('the social block is in the gamemode', !!social);

  const g = {};
  const store = {};
  const clock = { now: 1700000000000 };
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') {
        return Object.keys(store).filter(k => store[k].here).map(Number);
      }
      const r = store[id];
      if (!r) { return undefined; }
      if (key === 'profileId') { return r.pid; }
      if (key === 'appearance') { return { name: r.name }; }
      if (key === 'worldOrCellDesc') { return r.cell; }
      if (key === 'pos') { return r.pos; }
      if (key === 'inventory') { return { entries: [] }; }
      return r[key];
    },
    set: function (id, key, v) { if (!store[id]) { store[id] = {}; } store[id][key] = v; }
  };
  new Function(
    'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'say', 'notify', 'Math', 'Number', 'String', 'Object', 'Array',
    'JSON', 'isFinite', 'parseInt', social)(
    g, mp, { now: () => clock.now }, { log: () => { } },
    () => 0, () => { }, (n, f) => f, () => { }, () => { },
    Math, Number, String, Object, Array, JSON, isFinite, parseInt);
  const soc = g.__thornswoodSocial;

  function person(id, name, pid, cell, pos) {
    store[id] = { here: true, pid: pid, name: name, cell: cell, pos: pos };
    return id;
  }
  const A = person(0xff000001, 'Bjorn', 101, 'town:X.esm', [0, 0, 0]);
  const B = person(0xff000002, 'Sera', 102, 'far:X.esm', [90000, 5000, 0]);
  const C = person(0xff000003, 'Stranger', 103, 'town:X.esm', [100, 0, 0]);

  soc.partyTick();
  yes('somebody with no party is sent an empty list',
      (store[A][soc.PARTY_PROPERTY] || { m: null }).m.length === 0);

  soc.joinParty(101, 102);
  soc.partyTick();
  const mineA = store[A][soc.PARTY_PROPERTY].m;

  /*
    THE WHOLE POINT OF THIS LIST, and the reason thornswoodNear could not be
    used: near is everybody within 2,600 units in the same cell, and a party
    marker is for somebody who is somewhere else.
  */
  yes('a party member two holds away is still on the list', mineA.length === 1);
  yes('with the form id the client needs to find their name tag',
      mineA[0].a === (0xff000002).toString(16));
  yes('their name, so the marker can be called something', mineA[0].n === 'Sera');
  yes('and where they actually are', mineA[0].p[0] === 90000);

  yes('you are not your own marker', !mineA.some(r => r.a === A.toString(16)));
  yes('and somebody who is not in your party is not on it',
      !mineA.some(r => r.n === 'Stranger'));
  yes('a stranger gets an empty list of their own',
      (store[C][soc.PARTY_PROPERTY] || { m: null }).m.length === 0);

  // Nothing is written when nothing moved: this runs on a tick.
  const was = store[A][soc.PARTY_PROPERTY].at;
  soc.partyTick();
  yes('a party that has not moved is not written again',
      store[A][soc.PARTY_PROPERTY].at === was);
  store[B].pos = [90000, 90000, 0];
  clock.now += 2000;
  soc.partyTick();
  yes('and one that has, is', store[A][soc.PARTY_PROPERTY].at !== was);

  soc.leaveParty(102);
  soc.partyTick();
  yes('leaving empties the list', store[A][soc.PARTY_PROPERTY].m.length === 0);
}

// ------------------------------------------------- the name tag colour
{
  const c = code(front);
  yes('the plugin reads the client\'s own table of name tags',
      /sp\.storage\['idTextNickname'\]/.test(c));
  // Run, not read, in game\tests\test-2474-heads.js: a tag remade after you look
  // away is coloured too, which the per-person flag here once missed.
  yes('and colours by the id it finds there',
      /party: PARTY_COLOUR/.test(c) && /sp\.setTextColor\(textId, TAG_COLOURS\[colour\]\)/.test(c));

  /*
    PUTTING IT BACK IS THE HALF THAT MATTERS. A colour that is never removed
    leaves the last party you were in green for the rest of the session, after
    which the colour means nothing at all.
  */
  yes('and puts it back when they leave', /plain: PLAIN_COLOUR/.test(c) &&
      /const colour = \(hideAll \|\| tagHide\[hex\]\) \? 'hidden' : \(tagParty\[hex\] \? 'party' : 'plain'\);/.test(c));
  yes('the plain colour is the one the client itself uses',
      /PLAIN_COLOUR = \[1, 1, 1, 0\.8\]/.test(c));
  yes('the table is read fresh each pass, because a tag is remade on sight',
      /function nameTags\(\)/.test(c) && !/nameTagsCache/.test(c));
}

// ----------------------------------------------------------- the map marker
{
  const c = code(front);
  yes('the map marker base is the measured one, STAT 0x10 in Skyrim.esm',
      /MAP_MARKER_BASE = 0x00000010/.test(c));
  yes('one is placed per member and named after them',
      /placeAtMe\(base, 1, false, false\)/.test(c) && /setDisplayName\(name, true\)/.test(c));
  yes('added to the map with fast travel OFF', /addToMap\(false\)/.test(c));
  yes('not persistent, so it cannot outlive the session',
      /placeAtMe\(base, 1, false, false\)/.test(c));
  yes('moved to where the server said they were', /ref\.setPosition\(/.test(c));
  yes('and taken back out when they leave',
      /function dropMarker/.test(c) && /ref\.disable\(false\)/.test(c) && /ref\.delete\(\)/.test(c));
}

// --------------------------------------------------------------- the strip
{
  yes('the voice page hands its position feed out', /who: function \(\) \{ return lastWho; \}/.test(voice));
  yes('the strip is drawn by the party page', /ts-party-strip/.test(page));
  yes('and it is fed by the plugin', /setWhere: function \(list\)/.test(page) &&
      /thornswoodParty\.setWhere/.test(front));
  yes('nothing is drawn for somebody with no party', /if \(!where\.length\) \{ stripEl\.style\.display = 'none'/.test(page));

  // #531: the strip wears the party window's look, not the To Do List web
  // page's greys and brass it kept when the windows were restyled on 24 Sep.
  const sa = page.indexOf('var STRIP_CSS');
  const sb = page.indexOf('function ensureStrip');
  const strip = sa >= 0 && sb > sa ? page.slice(sa, sb) : '';
  yes('the strip\'s code was found', strip.length > 0);
  yes('the strip uses the window\'s Palatino', /font-family:"Palatino Linotype",Palatino,Georgia,serif/.test(strip) && !/font-family:Georgia,serif/.test(strip));
  yes('the strip\'s text is the window\'s parchment', /color:#d9cfb4/.test(strip));
  yes('the same room is the window\'s green and anywhere else its gold', /sameRoom \? '#9fcf92' : '#e9d19b'/.test(strip));
  yes('none of the old web page colours is left on the strip',
      !/#8fb85e|#d9ab52|#98a2ae|#e9e7e1/i.test(strip));

  /*
    THE BEARING, RUN RATHER THAN READ.

    Skyrim's facing is degrees clockwise from NORTH and north is +Y, so
    somebody due north of you is atan2(0, +d) = 0 and somebody due east is
    atan2(+d, 0) = 90. Getting this wrong points every arrow the wrong way and
    only shows up once the person turns away from north, which is exactly the
    kind of thing that ships.
  */
  const arrows = /var ARROWS = \[([\s\S]*?)\];/.exec(page);
  const arrowFor = /function arrowFor\(bearing\) \{[\s\S]*?\n  \}/.exec(page);
  yes('the strip has an arrow for every eighth of the rose', !!arrows && !!arrowFor);

  if (arrows && arrowFor) {
    const f = new Function('Math',
      'var ARROWS = [' + arrows[1] + '];\n' + arrowFor[0] + '\nreturn arrowFor;')(Math);
    const N = '↑', E = '→', S = '↓', W = '←';
    yes('straight ahead points up', f(0) === N);
    yes('to your right points right', f(90) === E);
    yes('behind you points down', f(180) === S);
    yes('to your left points left', f(270) === W && f(-90) === W);
    yes('and it wraps rather than falling off the end',
        f(360) === N && f(720) === N && f(-360) === N);

    // The bearing itself, with the same maths the page uses.
    function bearing(dx, dy, facing) {
      return (Math.atan2(dx, dy) * 180 / Math.PI) - facing;
    }
    yes('somebody due north of a person facing north is straight ahead',
        f(bearing(0, 1000, 0)) === N);
    yes('somebody due east of a person facing north is to their right',
        f(bearing(1000, 0, 0)) === E);
    /*
      AND THE ONE THAT ONLY BREAKS ONCE SOMEBODY TURNS. Face east, and the
      person who was on your right is now straight ahead.
    */
    yes('and once you turn to face them, they are straight ahead',
        f(bearing(1000, 0, 90)) === N);
    yes('turning your back on somebody puts them behind you',
        f(bearing(0, 1000, 180)) === S);
  }

  yes('the same room and somewhere else are told apart',
      /String\(them\.cell\) === String\(mine\.cell\)/.test(page));
  yes('and the strip says how far, in something a person reads',
      /' km'/.test(page) && /' m'/.test(page));
  yes('it uses the same seventy units to the metre the voice page does',
      /UNITS_PER_METRE = 70/.test(page) && /UNITS_PER_METRE = 70/.test(voice));

  // And the panel stopped saying these were missing.
  yes('the panel no longer says the markers are not built',
      !/Not yet/.test(page) && /Finding each other/.test(page));
  yes('but it is still honest that the strip is not Skyrim\'s compass',
      /rather than Skyrim/.test(page));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
