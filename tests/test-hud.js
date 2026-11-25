// test-hud.js
//
// The on-screen HUD and the on-screen warning, run rather than read.
//
// Both are updateOwner scripts: JavaScript written as a string inside
// gamemode.js, shipped to the client, and then handing ANOTHER string to the
// browser. Two layers of quoting, no compiler between them, and a mistake in
// either one fails silently on somebody else's screen. So this pulls the real
// functions out of the gamemode, runs what they produce against a fake
// SkyrimPlatform and a fake document, and looks at the markup that comes out.
//
// Patrick, 22 September: "There is no indicator for the hunger food or
// exhasution on screen", "the temp stuff should also have a hud element",
// "hunger and thirst element should have nice icons for them and say the
// percentage", and for the countdown: "I need it to do an onscreen warninjg
// and not just in chat at one minute and at 30 seoconds".
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const BS = String.fromCharCode(92);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/** Lift one whole function out of the source by name. */
function lift(name) {
  const a = src.indexOf('function ' + name + '()');
  if (a < 0) { return null; }
  const b = src.indexOf('\n  }', a);
  const c = src.indexOf('\n}', a);
  const end = (b >= 0 && (c < 0 || b < c)) ? b + 4 : (c >= 0 ? c + 2 : -1);
  return end > 0 ? src.slice(a, end) : null;
}

/** A document that records the one element these scripts build. */
function fakeDoc() {
  const made = {};
  const doc = {
    getElementById: function (id) { return made[id] || null; },
    createElement: function () {
      return { id: '', style: { cssText: '', display: '' }, innerHTML: '' };
    },
    body: { appendChild: function (el) { made[el.id] = el; } }
  };
  return { doc: doc, made: made };
}

/** Run an updateOwner script, then run whatever it handed the browser. */
function run(made, value, state) {
  let handed = null;
  const notes = [];
  const ctx = {
    value: value,
    state: state,
    sp: {
      Debug: { notification: function (t) { notes.push(String(t)); } },
      browser: { executeJavaScript: function (s) { handed = s; } }
    }
  };
  new Function('ctx', made)(ctx);
  const f = fakeDoc();
  if (handed) {
    new Function('document', 'window', 'setTimeout', 'clearTimeout', handed)(
      f.doc, {}, function () { return 1; }, function () { });
  }
  return { handed: handed, made: f.made, notes: notes };
}

// ---------------------------------------------------------------- the HUD
const hud = lift('hudScript');
yes('the HUD script is in the gamemode', hud !== null);

if (hud) {
  const made = new Function(hud + '\nreturn hudScript();')();
  const full = { food: 100, drink: 100, rest: 100, temp: 50 };

  // S1: it runs, builds an element, and hands the browser something.
  {
    const r = run(made, { food: 62, drink: 41, rest: 88, temp: 22 }, {});
    yes('S1 the HUD runs and hands the browser a script', !!r.handed);
    const el = r.made['ts-hud'];
    yes('S1 and builds one element with a known id', !!el);
    if (el) {
      yes('S1 the markup carries no stray backslash from the quoting',
          el.innerHTML.indexOf(BS) === -1);
      yes('S1 it is fixed to the screen and does not eat clicks',
          el.style.cssText.indexOf('position:fixed') !== -1 &&
          el.style.cssText.indexOf('pointer-events:none') !== -1);
    }
  }

  // S2: what Patrick asked for by name. Icons and a percentage.
  {
    const r = run(made, { food: 62, drink: 41, rest: 88, temp: 22 }, {});
    const h = r.made['ts-hud'].innerHTML;
    yes('S2 every row has an icon', (h.match(/<svg /g) || []).length === 4);
    yes('S2 and the icons are drawn, not linked to a file',
        h.indexOf('<path d="') !== -1 && h.indexOf('src=') === -1);
    yes('S2 the percentage is written out', h.indexOf('62%') !== -1 &&
        h.indexOf('41%') !== -1 && h.indexOf('88%') !== -1);
    /*
      HUNGER AND THIRST, NOT FOOD AND WATER. Patrick, 23 September: "also
      rename to Hunger and Thirst". They are the words the rest of the genre
      uses and they are what he asked for.
    */
    yes('S2 all four rows are named, and they are the words he asked for',
        h.indexOf('>Hunger<') !== -1 && h.indexOf('>Thirst<') !== -1 &&
        h.indexOf('>Rest<') !== -1 && h.indexOf('>Temp<') !== -1 &&
        h.indexOf('>Heat<') === -1 && h.indexOf('>Water<') === -1);
  }

  /*
    S3: TEMPERATURE IS A WORD AND A NUMBER, NOT A PERCENTAGE.

    Patrick, 23 September: "heat shouldnt be a percentage to it should be a
    number plus a color to reflect hot, cold, cmoftroable, anbd the
    ionbetweens", and "instead of heat it should say Temp".

    A percentage said 20% for freezing AND 20% for overheating, which are
    opposite states, and a percentage of what was never answerable.
  */
  {
    function tempReadout(temp) {
      const r = run(made, { food: 100, drink: 100, rest: 100, temp: temp }, {});
      const seg = r.made['ts-hud'].innerHTML.split('>Temp<')[1] || '';
      const m = />([A-Za-z]+) (\d+)<\/span>/.exec(seg);
      return m ? { word: m[1], num: Number(m[2]), html: seg } : null;
    }
    const cold = tempReadout(8);
    const fine = tempReadout(50);
    const hot = tempReadout(92);
    /*
      THE READOUT, NOT THE WHOLE ROW. The first version of this asked whether
      the row contained a percent sign anywhere, and of course it does: the
      bar's own style says height:100% and width:8%. It reported a correct
      readout as wrong, which is the SECOND time in this file that reading CSS
      as if it were content has produced a false failure. Match the readout
      span and nothing else.

      Matching at all is the check: a percentage readout renders as >8%</span>
      and cannot match a word followed by a number.
    */
    yes('S3 it reads as a word and the number itself, with no percent sign',
        !!cold && !!fine && !!hot &&
        cold.num === 8 && fine.num === 50 && hot.num === 92);
    yes('S3 the two ends say opposite things rather than the same thing',
        cold.word !== hot.word);
    yes('S3 cold reads cold, the middle comfortable, hot reads hot',
        /freez|cold/i.test(cold.word) && /fine|comfort/i.test(fine.word) &&
        /hot|burn/i.test(hot.word));
    function colourAt(t) {
      const seg = tempReadout(t).html;
      const m = /color:(#[0-9a-f]{6})/i.exec(seg);
      return m ? m[1].toLowerCase() : null;
    }
    const shades = [8, 25, 35, 50, 65, 80, 95].map(colourAt);
    yes('S3 and every band has its own colour, including the in betweens',
        shades.every(function (c) { return !!c; }) &&
        new Set(shades).size === shades.length);
  }

  /*
    S3b: readable, which the first one was not.

    Patrick: "the indicators are too small and hard to see with the color they
    are ... that's all trasparent". It drew at 0.38 opacity, 12px, with no
    backing, over whatever happened to be behind it.
  */
  {
    const r = run(made, { food: 100, drink: 100, rest: 100, temp: 50 }, {});
    const el = r.made['ts-hud'];
    yes('S3b a healthy HUD is not faded out of sight',
        !/opacity:0\.[0-7]/.test(el.innerHTML));
    yes('S3b it has a backing so it does not fight the scene',
        /background:rgba\(/.test(el.style.cssText));
    /*
      In the HUD's own pixels since #2247 (see S3c): 10 of them, which is
      15px at 1920x1080. Under 14px at 1080p is what "too small" meant.
    */
    const size = /font-size:calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/.exec(el.style.cssText);
    yes('S3b and the text is big enough to read at 1080p', !!size && Number(size[1]) * 1.5 >= 14);
  }

  /*
    S3c: SIZED BY THE HUD, AND CLEAR OF ITS BARS AT EVERY SCREEN (#2247).

    Patrick asked on 23 September for everything 1.5x (22px text, 198px
    bars, 28px icons), in screen pixels from the bottom left corner. Djinn on
    26 September: "The survival UI box blocks the magicka bar. It needs to
    be resized and moved." Four rows that size were about 514 by 193 pixels
    at 1080p and covered the bars people see there.

    Now the strip is sized in the HUD's own pixels, --ts, the screen's height
    over 720 or its width over 1280, whichever is smaller, which is how the
    game shows a 1280x720 menu whole (kShowAll). The bars below are measured
    from the collection's files, in those same pixels (the note over CSS in
    hudScript says where each number comes from):

      TrueHUD's player widget, which hides the game's own bars: magicka,
      health and stamina frames down to y 686.4, and the enchantment charge
      meter, x 575 to 705, y 689 to 708.
      SkyHUD's places for the game's own bars, if TrueHUD's widget is ever
      off: y 602 to 640.

    The strip is worked out from its own CSS at each screen and must not
    touch any of them, and must stay on the screen.
  */
  {
    const r = run(made, { food: 100, drink: 100, rest: 100, temp: 50 }, {});
    const css = r.made['ts-hud'].style.cssText;
    const unit = /--ts:min\(0\.078125vw,0\.1388889vh\)/.test(css);
    yes('S3c the unit is one pixel of the 1280x720 HUD, shown whole', unit);
    const num = function (re) { const m = re.exec(css); return m ? Number(m[1]) : NaN; };
    const L = num(/left:calc\(50vw - (\d+(?:\.\d+)?) \* var\(--ts\)\)/);
    const B = num(/bottom:calc\(50vh - (\d+(?:\.\d+)?) \* var\(--ts\)\)/);
    const W = num(/width:calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/);
    const H = num(/height:calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/);
    yes('S3c it is placed and sized only in those units (left, bottom, width, height)',
        [L, B, W, H].every(function (v) { return isFinite(v) && v > 0; }) &&
        /box-sizing:border-box/.test(css) && !/\btop:|\bright:/.test(css));
    // Every box in the HUD's pixels: [x1, x2, y1, y2].
    const BARS = {
      'TrueHUD magicka': [64.5, 349.5, 667.2, 686.4],
      'TrueHUD health': [497.5, 782.5, 667.2, 686.4],
      'TrueHUD stamina': [930.5, 1215.5, 667.2, 686.4],
      'TrueHUD charge meter': [575, 705, 689, 708],
      'SkyHUD magicka': [117.9, 410.7, 610.8, 640.0],
      'SkyHUD health': [393.9, 886.1, 617.5, 637.2],
      'SkyHUD stamina': [870.3, 1163.1, 610.4, 639.8],
      'SkyHUD charge meter': [137.0, 392.2, 602.9, 615.9]
    };
    const SCREENS = [[1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160],
                     [1920, 1200], [2560, 1600], [2560, 1080], [3440, 1440], [1280, 1024]];
    const hits = [];
    SCREENS.forEach(function (sc) {
      const vw = sc[0], vh = sc[1];
      const s = Math.min(vw / 1280, vh / 720);
      const ox = (vw - 1280 * s) / 2, oy = (vh - 720 * s) / 2;
      // The strip on the screen, from its own CSS.
      const x1 = vw / 2 - L * s, x2 = x1 + W * s;
      const y2 = vh - (vh / 2 - B * s), y1 = y2 - H * s;
      if (x1 < 0 || y1 < 0 || x2 > vw || y2 > vh) { hits.push(vw + 'x' + vh + ' off the screen'); }
      Object.keys(BARS).forEach(function (k) {
        const b = BARS[k];
        const bx1 = ox + b[0] * s, bx2 = ox + b[1] * s, by1 = oy + b[2] * s, by2 = oy + b[3] * s;
        if (x1 < bx2 && bx1 < x2 && y1 < by2 && by1 < y2) { hits.push(vw + 'x' + vh + ' ' + k); }
      });
    });
    yes('S3c the strip clears every bar at ' + SCREENS.length + ' screens' +
        (hits.length ? ': not ' + hits.join(', ') : ''), hits.length === 0 && isFinite(L));
    yes('S3c and it covers less of the screen than the box that covered the magicka bar (514 by 193 at 1080p)',
        (W * 1.5) * (H * 1.5) < 514 * 193 / 2 && H * 1.5 < 193 / 4);
  }

  // S3d: what is inside fits the strip: every row's widths and gaps, added
  // up from the markup, within the strip less its padding and border.
  {
    const r = run(made, { food: 8, drink: 100, rest: 100, temp: 8 }, {});
    const el = r.made['ts-hud'];
    const css = el.style.cssText;
    const W = Number((/width:calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/.exec(css) || [])[1]);
    const pad = Number((/padding:0 calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/.exec(css) || [])[1]);
    const bord = Number((/border:calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/.exec(css) || [])[1]);
    let used = 0;
    el.innerHTML.replace(/(?:^|[;"])(?:width|margin-right|margin-left):calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/g,
      function (all, n) { used += Number(n); return all; });
    el.innerHTML.replace(/margin:0 calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/g,
      function (all, n) { used += 2 * Number(n); return all; });
    yes('S3d the four rows (' + used + ') fit inside the strip (' + (W - 2 * pad - 2 * bord) + ')',
        used > 0 && isFinite(W) && used <= W - 2 * pad - 2 * bord);
  }

  /*
    S3e: DRUNK AND HIGH, AN ICON EACH, ONLY WHILE IT APPLIES (#3143).

    Patrick, 22 October: "An icon that shows only while drunk or high", not
    a bar. The four rows fill the strip (S3d), so the icons are their own
    small panel on the strip's left end, and that panel must clear every bar
    S3c knows about. kShowAll scales the whole 1280x720 HUD by one number,
    so a box that clears the bars in the HUD's own pixels clears them at
    every screen; this works it out in those pixels from the CSS.
  */
  {
    const icons = function (v) {
      const r = run(made, Object.assign({ food: 80, drink: 80, rest: 80, temp: 50 }, v), {});
      const h = r.made['ts-hud'].innerHTML;
      return { h: h, svgs: (h.match(/<svg /g) || []).length, marks: h.indexOf('id="ts-hud-marks"') !== -1 };
    };
    const sober = icons({});
    yes('S3e sober and clean: no icon panel, only the four rows', !sober.marks && sober.svgs === 4);
    const drunk = icons({ drunk: true });
    yes('S3e drunk: one icon over the strip', drunk.marks && drunk.svgs === 5 && drunk.h.indexOf('#e3b04b') !== -1);
    const high = icons({ drugged: true });
    yes('S3e high: one icon, a different one', high.marks && high.svgs === 5 && high.h.indexOf('#c58cf0') !== -1 &&
        high.h.indexOf('#e3b04b') === -1);
    const both = icons({ drunk: true, drugged: true });
    yes('S3e both: two icons', both.marks && both.svgs === 6);
    yes('S3e the altitude field called high is not read as high', !icons({ high: 9000 }).marks);
    yes('S3e no stray backslash in the panel', both.h.indexOf(BS) === -1);

    const st = {};
    const a = run(made, { food: 80, drink: 80, rest: 80, temp: 50 }, st);
    const b = run(made, { food: 80, drink: 80, rest: 80, temp: 50, drunk: true }, st);
    const c = run(made, { food: 80, drink: 80, rest: 80, temp: 50, drunk: true }, st);
    const d = run(made, { food: 80, drink: 80, rest: 80, temp: 50 }, st);
    yes('S3e becoming drunk redraws though no meter moved, once', !!a.handed && !!b.handed && !c.handed);
    yes('S3e and sobering up redraws without the icon', !!d.handed &&
        d.made['ts-hud'].innerHTML.indexOf('ts-hud-marks') === -1);

    // The panel in the HUD's pixels, from the strip's CSS and its own.
    const css = run(made, { food: 80, drink: 80, rest: 80, temp: 50 }, {}).made['ts-hud'].style.cssText;
    const num = function (re, t) { const m = re.exec(t); return m ? Number(m[1]) : NaN; };
    const L = num(/left:calc\(50vw - (\d+(?:\.\d+)?) \* var\(--ts\)\)/, css);
    const B = num(/bottom:calc\(50vh - (\d+(?:\.\d+)?) \* var\(--ts\)\)/, css);
    const H = num(/height:calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/, css);
    const bord = num(/border:calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/, css);
    const panel = (/<div id="ts-hud-marks" style="([^"]*)"/.exec(both.h) || [])[1] || '';
    const pl = num(/left:calc\((-?\d+(?:\.\d+)?) \* var\(--ts\)\)/, panel);
    const pb = num(/bottom:calc\(100% \+ (\d+(?:\.\d+)?) \* var\(--ts\)\)/, panel);
    const pw = num(/width:calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/, panel);
    const ph = num(/height:calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/, panel);
    yes('S3e the panel is placed and sized only in the HUD\'s units',
        /position:absolute/.test(panel) && /box-sizing:border-box/.test(panel) &&
        [L, B, H, bord, pl, pb, pw, ph].every(function (v) { return isFinite(v); }));
    // The strip's padding box is where an absolute child is placed from.
    const x1 = 640 - L + bord + pl, x2 = x1 + pw;
    const y2 = 360 + B - H + bord - pb, y1 = y2 - ph;
    const BARS = {
      'TrueHUD magicka': [64.5, 349.5, 667.2, 686.4],
      'TrueHUD health': [497.5, 782.5, 667.2, 686.4],
      'TrueHUD charge meter': [575, 705, 689, 708],
      'SkyHUD magicka': [117.9, 410.7, 610.8, 640.0],
      'SkyHUD charge meter': [137.0, 392.2, 602.9, 615.9]
    };
    const hits = Object.keys(BARS).filter(function (k) {
      const q = BARS[k];
      return x1 < q[1] && q[0] < x2 && y1 < q[3] && q[2] < y2;
    });
    yes('S3e with both icons up the panel (x ' + x1 + ' to ' + x2 + ', y ' + y1 + ' to ' + y2 +
        ') is on the screen and clears every bar' + (hits.length ? ': not ' + hits.join(', ') : ''),
        hits.length === 0 && x1 >= 0 && y1 >= 0 && x2 <= 1280 && y2 <= 720 - H);
    // And the two icons fit inside it: its padding and border, then the
    // icons and the gap between them, read from the markup after its tag.
    const pp = num(/padding:0 calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/, panel);
    const pbd = num(/border:calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/, panel);
    const inner = both.h.split('id="ts-hud-marks"')[1].split('>').slice(1).join('>');
    let used = 0;
    inner.replace(/(?:width|margin-left):calc\((\d+(?:\.\d+)?) \* var\(--ts\)\)/g,
      function (all, n) { used += Number(n); return all; });
    yes('S3e and the two icons (' + used + ') fit inside it (' + (pw - 2 * pp - 2 * pbd) + ')',
        used > 0 && used <= pw - 2 * pp - 2 * pbd);
  }

  // S4: THE PER-FRAME GUARD. updateOwner runs every frame; this is what stops
  // the HUD being rebuilt sixty times a second for ever.
  {
    const st = {};
    const a = run(made, { food: 62.4, drink: 41, rest: 88, temp: 22 }, st);
    yes('S4 the first frame draws', !!a.handed);
    const b = run(made, { food: 62.4, drink: 41, rest: 88, temp: 22 }, st);
    yes('S4 the same numbers again draw nothing', !b.handed);
    // A number that moves but rounds the same must also draw nothing: these
    // meters move continuously and the screen does not.
    const c = run(made, { food: 62.49, drink: 41, rest: 88, temp: 22 }, st);
    yes('S4 and neither does a value that rounds to the same whole number', !c.handed);
    const d = run(made, { food: 61, drink: 41, rest: 88, temp: 22 }, st);
    yes('S4 but a real change does draw', !!d.handed);
  }

  // S5: no state, no drawing. Fails shut rather than every frame.
  {
    const r = run(made, { food: 50, drink: 50, rest: 50, temp: 50 }, null);
    yes('S5 with nowhere to remember the last frame it draws nothing', !r.handed);
  }

  // S6: rubbish in does not throw.
  {
    let threw = false;
    try {
      run(made, { food: 'x', drink: null, rest: undefined, temp: {} }, {});
      run(made, null, {});
      run(made, {}, {});
    } catch (e) { threw = true; }
    yes('S6 a broken or missing value is ignored rather than thrown', !threw);
  }
}

// ------------------------------------------------------------- the warning
const alert = lift('alertScript');
yes('the on-screen warning script is in the gamemode', alert !== null);

if (alert) {
  const made = new Function(alert + '\nreturn alertScript();')();

  {
    const r = run(made, { text: 'You are put back to the launcher in 1 minute.', tone: 'bad', ms: 9000, at: 111 }, {});
    yes('S7 the warning reaches Skyrim\'s own corner message', r.notes.length === 1);
    const el = r.made['ts-alert'];
    yes('S7 and builds a banner', !!el);
    if (el) {
      yes('S7 carrying the words', el.innerHTML.indexOf('put back to the launcher') !== -1);
      yes('S7 with no stray backslash', el.innerHTML.indexOf(BS) === -1);
    }
  }

  // S8: the same guard as the HUD, on the stamp.
  {
    const st = {};
    const a = run(made, { text: 'one', tone: 'bad', ms: 9000, at: 7 }, st);
    const b = run(made, { text: 'one', tone: 'bad', ms: 9000, at: 7 }, st);
    const c = run(made, { text: 'two', tone: 'bad', ms: 9000, at: 8 }, st);
    yes('S8 a warning shows once per stamp, not once per frame',
        !!a.handed && !b.handed && !!c.handed);
  }

  // S9: the countdown only shouts at the two marks Patrick named.
  {
    const tick = src.slice(src.indexOf('function restartTick'), src.indexOf('function poll'));
    yes('S9 the banner fires at one minute and at thirty seconds',
        /m === 60 \|\| m === 30/.test(tick));
    yes('S9 and the ten second mark is deliberately left to chat',
        tick.indexOf('alertAll') !== -1 && !/m === 10/.test(tick));
    yes('S9 update mode is left to chat, no banner for a launcher that may be up to date (#610)',
        /restart\.mode !== 'update'/.test(tick));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
