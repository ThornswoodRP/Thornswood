// test-4474-panel-scale.js
//
//     node game/tests/test-4474-panel-scale.js
//
// #4474: every panel scales with the screen, and with the one text size
// setting. On screens over 1080p the P panel, the notice board, a trade, the
// drop box and the rest stayed at their 1080p size while the skills panel and
// the journal scaled up, and there was no text size at all.
//
// WHAT THIS RUNS. A headless Chrome of this machine's (tests/chrome-audio.js
// finds it; CHROME names another), one blank page, and in it a frame the size
// of each screen. Into each frame go thornswood-bridge.js, thornswood-scale.js
// and one panel's own script, exactly as the game's page loads them; the
// panel is opened the way the front opens it, and its box is measured as
// Chrome draws it.
//
//   A. At 1920 by 1080 each box is drawn at its own size, centred.
//   B. At 2560 by 1440 and 3840 by 2160 each box takes the same share of the
//      screen as at 1920 by 1080 (the skills and journal rule, #958), and at
//      3440 by 1440 the share of the height.
//   C. The text size: at 1920 by 1080, 130 makes each box 1.3 times as big,
//      or as big as fits with 24 pixels to spare, never past the edge.
//   D. The skills panel and the journal ask the same rule, so they take the
//      text size too, and are left to their own fit.
//   E. The Settings panel offers the four sizes, and the front reads, writes
//      and hands over TextSize.
//
// Without a Chrome, A to D print SKIP. Run it against main's game/ui with
// UI=<that folder>: there is no thornswood-scale.js, and B and C fail.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const UI = process.env.UI || path.join(ROOT, 'game', 'ui');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR).join('');
const C = require(path.join(ROOT, 'tests', 'chrome-audio.js'));

let pass = 0, fail = 0, skip = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '  (' + why + ')' : '')); }
}
function skipped(what) { skip++; console.log('SKIP  ' + what); }
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed' + (skip ? ', ' + skip + ' skipped' : ''));
  process.exitCode = fail ? 1 : 0;
}

// How each panel is opened, as the front opens it (game/tests/test-1917-panel-keys.js has the same).
const PANELS = {
  'thornswood-party.js': 'thornswoodParty.open()',
  'thornswood-board.js': "thornswoodBoard.setData({ board: { hold: 'whiterun', x: 1, y: 2, z: 3, where: 'Whiterun', here: true, wall: [], jobs: [] } }); thornswoodBoard.open()",
  'thornswood-trade.js': 'thornswoodTrade.open()',
  'thornswood-box.js': "thornswoodBox.setData({ open: true, hold: 'whiterun', where: 'Whiterun', rows: [], pack: [], packGold: 5 })",
  'thornswood-help.js': 'thornswoodHelp.open()',
  'thornswood-settings.js': 'thornswoodSettings.open()',
  'thornswood-merchant.js': "thornswoodMerchant.setData({ open: true, trader: 'Belethor', offers: [] })",
  'thornswood-repair.js': 'thornswoodRepair.setData({ open: true, items: [] })',
  'thornswood-ride.js': "thornswoodRide.setData({ open: true, name: 'Horse', stable: 'Whiterun' }); thornswoodRide.open()",
  'thornswood-journal.js': 'thornswoodJournal.open()',
  'thornswood-skills.js': 'thornswoodSkills.open()'
};
const SIZES = [[1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160]];

const scalePath = path.join(UI, 'thornswood-scale.js');
const sources = {
  bridge: read(path.join(UI, 'thornswood-bridge.js')),
  scale: fs.existsSync(scalePath) ? read(scalePath) : '',
  panels: {}
};
for (const f of Object.keys(PANELS)) { sources.panels[f] = read(path.join(UI, f)); }

/* The expression Chrome runs: every panel at every size and text size, each in a
   frame of its own, measured once drawn. */
function expression() {
  return '(' + (async function (S, PANELS, SIZES) {
    function frame(w, h) {
      return new Promise(function (ok) {
        var f = document.createElement('iframe');
        f.style.cssText = 'position:absolute;left:0;top:0;border:0;width:' + w + 'px;height:' + h + 'px';
        f.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';
        f.onload = function () { ok(f); };
        document.body.appendChild(f);
      });
    }
    function tick(win) { return new Promise(function (ok) { win.requestAnimationFrame(function () { win.requestAnimationFrame(ok); }); }); }
    var out = [];
    var files = Object.keys(PANELS);
    for (var i = 0; i < files.length; i++) {
      for (var j = 0; j < SIZES.length; j++) {
        for (var t = 0; t < 2; t++) {
          var text = t ? 130 : 100;
          if (text !== 100 && SIZES[j][0] !== 1920) { continue; }
          var f = await frame(SIZES[j][0], SIZES[j][1]);
          var win = f.contentWindow;
          var row = { file: files[i], w: SIZES[j][0], h: SIZES[j][1], text: text };
          try {
            win.skyrimPlatform = { sendMessage: function () {} };
            win.THORNSWOOD = { textSize: text };
            win.eval(S.bridge);
            if (S.scale) { win.eval(S.scale); }
            win.eval(S.panels[files[i]]);
            win.eval(PANELS[files[i]]);
            await tick(win);
            var roots = win.document.body.children, box = null, root = null;
            for (var k = 0; k < roots.length; k++) {
              var p = roots[k].querySelector(':scope > .panel');
              if (p && win.getComputedStyle(roots[k]).display !== 'none') { box = p; root = roots[k]; break; }
            }
            if (!box) { row.err = 'no panel shown'; }
            else {
              var r = box.getBoundingClientRect();
              row.x = r.left; row.y = r.top; row.bw = r.width; row.bh = r.height;
              row.ow = box.offsetWidth; row.oh = box.offsetHeight;
              row.fits = !!(win.thornswoodScale && win.thornswoodScale.SELF_FIT.indexOf(root.id) >= 0);
            }
          } catch (e) { row.err = String(e && e.stack || e); }
          out.push(row);
          f.remove();
        }
      }
    }
    return out;
  }).toString() + ')(' + JSON.stringify(sources) + ',' + JSON.stringify(PANELS) + ',' + JSON.stringify(SIZES) + ')';
}

function near(a, b, slack) { return Math.abs(a - b) <= (slack || 2); }

async function main() {
  yes('thornswood-scale.js is in the game\'s page, after the bridge',
      /thornswood-bridge\.js"><\/script><script src="thornswood-scale\.js">/.test(read(path.join(UI, 'index.html'))));
  const exe = C.find() || (fs.existsSync('/opt/pw-browsers/chromium/chrome-linux/chrome') ? '/opt/pw-browsers/chromium/chrome-linux/chrome' : null);
  if (!exe) {
    ['A', 'B', 'C', 'D'].forEach((s) => skipped(s + ': no Chrome on this machine (CHROME names one)'));
  } else {
    const rows = await C.evaluate(exe, expression(), 180000);
    const at = (f, w, h, text) => rows.find((r) => r.file === f && r.w === w && r.h === h && r.text === text);
    for (const f of Object.keys(PANELS)) {
      const one = at(f, 1920, 1080, 100);
      if (!one || one.err) { yes(f + ' opens and draws a panel', false, one ? one.err : 'not run'); continue; }
      yes('A ' + f + ' at 1920 by 1080 is drawn at its own size, ' + Math.round(one.ow) + ' by ' + Math.round(one.oh) + ', centred',
          near(one.bw, one.ow) && near(one.bh, one.oh) && near(one.x + one.bw / 2, 960) && near(one.y + one.bh / 2, 540));
      for (const [w, h] of SIZES.slice(1)) {
        const r = at(f, w, h, 100);
        if (!r || r.err) { yes('B ' + f + ' at ' + w + ' by ' + h + ' draws', false, r ? r.err : 'not run'); continue; }
        const s = Math.min(w / 1920, h / 1080);
        yes('B ' + f + ' at ' + w + ' by ' + h + ' is drawn ' + s.toFixed(3) + ' times its size (' + Math.round(r.bw) + ' by ' + Math.round(r.bh) + '), centred',
            near(r.bw, one.ow * s, 3) && near(r.bh, one.oh * s, 3) && near(r.x + r.bw / 2, w / 2) && near(r.y + r.bh / 2, h / 2),
            Math.round(r.bw) + 'x' + Math.round(r.bh));
      }
      const big = at(f, 1920, 1080, 130);
      if (!big || big.err) { yes('C ' + f + ' at text size 130 draws', false, big ? big.err : 'not run'); continue; }
      const want = Math.max(1, Math.min(1.3, (1920 - 48) / one.ow, (1080 - 48) / one.oh));
      yes('C ' + f + ' at text size 130 is drawn ' + want.toFixed(3) + ' times its size, inside the screen',
          near(big.bw, one.ow * want, 3) && near(big.bh, one.oh * want, 3) && big.x >= 23 && big.y >= 23 &&
          big.x + big.bw <= 1920 - 23 && big.y + big.bh <= 1080 - 23,
          Math.round(big.bw) + 'x' + Math.round(big.bh) + ' at ' + Math.round(big.x) + ',' + Math.round(big.y));
      if (f === 'thornswood-journal.js' || f === 'thornswood-skills.js') {
        yes('D ' + f + ' fits itself, so the shared scale leaves its root alone', one.fits === true);
      }
    }
  }

  const settings = read(path.join(UI, 'thornswood-settings.js'));
  const front = read(path.join(ROOT, 'game', 'plugins', 'thornswood-front.js'));
  yes('E the Settings panel offers the text sizes and asks the front to set TextSize',
      /data-text="/.test(settings) && /tell\('set TextSize ' \+/.test(settings) && /state\.textChoices/.test(settings));
  yes('E the front offers 100, 115, 130 and 150, reads TextSize, and anything else is 100',
      /const TEXT_SIZE_CHOICES = \[100, 115, 130, 150\];/.test(front) && /TextSize\\s\*=/.test(front) &&
      /TEXT_SIZE_CHOICES\.indexOf\(v\) >= 0 \? v : 100/.test(front));
  yes('E the front writes TextSize from the panel, 100 taking its line out',
      /name === 'TextSize'/.test(front) && /value = v === 100 \? null : String\(v\);/.test(front));
  yes('E the front hands the page textSize and has every panel fitted again',
      /c\.textSize=' \+ TEXT_SIZE/.test(front) && /window\.thornswoodScale\.settings\(\)/.test(front) &&
      (front.match(/textSize: TEXT_SIZE/g) || []).length === 3);
  const scale = sources.scale;
  yes('E the page\'s choices are the front\'s', /var TEXT_CHOICES = \[100, 115, 130, 150\];/.test(scale));
  done();
}

main().catch((e) => { yes('the harness ran', false, e && e.stack || e); done(); });
