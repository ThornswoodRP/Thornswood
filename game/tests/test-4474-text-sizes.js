// test-4474-text-sizes.js
//
//     node game/tests/test-4474-text-sizes.js
//
// #4474, its second half: every word on the game's panels can be read. Some
// text was 10.5 to 11 pixels, faint text was under the 4.5 to 1 small text
// needs, the party strip said "in the same room" by colour alone, inputs had
// no names, and the friend switches read Text and Name without saying what
// they switch.
//
// WHAT THIS RUNS.
//
//   A. Every game/ui script, read: no font size under 12 pixels.
//   B. Every input, select and textarea a script writes as markup has a
//      name (aria-label), or sits inside its <label>.
//   C. In a headless Chrome of this machine's (tests/chrome-audio.js finds it;
//      CHROME names another), each panel opened at 1920 by 1080 as the front
//      opens it, with rows in it, and every word it draws measured as Chrome
//      draws it: at least 12 pixels, and at least 4.5 to 1 against its box,
//      worked out over both a black and a white world behind, so a box that
//      lets the world through is held to the worst of it. What is disabled
//      (disabled or aria-disabled) is left out, as WCAG leaves it out, and so
//      is text drawn straight on the world with no box (the party strip, the
//      microphone), whose contrast is the world's and which carries a shadow.
//      Every input, select and textarea drawn has a name.
//   D. The friend switches say what they switch, and the party strip says
//      "same room" in words beside the distance, not only in green.
//
// Without a Chrome, C and D print SKIP. Run it against another game/ui with
// UI=<that folder>.
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

const SCRIPTS = fs.readdirSync(UI).filter((f) => /^thornswood-.*\.js$/.test(f)).sort();
const SMALLEST = 12;

// ------------------------------------------------------------- A. the sizes
for (const f of SCRIPTS) {
  const src = read(path.join(UI, f));
  const small = [];
  const re = /font(?:-size)?\s*:[^;'"}]*?(\d+(?:\.\d+)?)px/g;
  let m;
  while ((m = re.exec(src))) {
    if (Number(m[1]) < SMALLEST) { small.push(src.slice(0, m.index).split('\n').length + ': ' + m[0]); }
  }
  yes('A ' + f + ' sets no text under ' + SMALLEST + ' pixels', small.length === 0, small.join(', '));
}

// ------------------------------------------------------------- B. the names
for (const f of SCRIPTS) {
  const src = read(path.join(UI, f));
  const bare = [];
  const re = /<(input|select|textarea)\b[^>]*>/g;
  let m;
  while ((m = re.exec(src))) {
    if (/aria-label(ledby)?=/.test(m[0])) { continue; }
    // Inside its own <label>: the label's text names it.
    const before = src.slice(Math.max(0, m.index - 200), m.index);
    if (/<label\b[^>]*>[^<]*$/.test(before)) { continue; }
    bare.push(src.slice(0, m.index).split('\n').length + ': ' + m[0].slice(0, 60));
  }
  if (/<(input|select|textarea)\b/.test(src)) {
    yes('B ' + f + ' names every input it writes', bare.length === 0, bare.join(', '));
  }
}

// ------------------------------------------- C and D. drawn, as Chrome draws it
/* How each panel is opened, as the front opens it, with rows to draw. */
const OPEN = {
  'thornswood-party.js': "thornswoodParty.setData({ me: 1000, offer: { kind: 'party', name: 'Ingrid' }, party: [{ name: 'Aldric', me: true, on: true, leader: true }, { name: 'Sera', on: true }, { name: 'Bjorn', on: false }], together: 1, bonus: 10, friends: [{ p: 1001, name: 'Sera', on: true, party: true }, { p: 1002, name: 'Bjorn', on: true, textOff: true, nameOff: true }, { p: 1003, name: 'Hilde', on: false, muted: true }] }); thornswoodParty.open()",
  'thornswood-party.js strip': "window.thornswoodVoice = { who: function () { return { 1000: { name: 'Aldric', pos: [0, 0, 0], angleZ: 0, cell: 7 }, 1001: { name: 'Sera', pos: [0, 700, 0], cell: 7 }, 1002: { name: 'Bjorn', pos: [70000, 0, 0], cell: 8 } }; } }; thornswoodParty.setData({ me: 1000, party: [{ name: 'Aldric', me: true, on: true }, { name: 'Sera', on: true }, { name: 'Bjorn', on: true }], friends: [] }); thornswoodParty.setWhere([{ n: 'Sera' }, { n: 'Bjorn' }])",
  'thornswood-board.js': "thornswoodBoard.setData({ board: { hold: 'whiterun', x: 1, y: 2, z: 3, where: 'Whiterun', here: true, wall: [], jobs: [], dests: [{ hold: 'riften', where: 'Riften' }] } }); thornswoodBoard.open()",
  'thornswood-trade.js': "thornswoodTrade.setData({ open: true, offerVersion: 'a'.repeat(48), them: 'Ingrid', pack: [{ n: 'Iron Sword', c: 3 }], mine: [{ n: 'Iron Dagger', c: 1 }], myGold: 40, iAgreed: false, theirs: [{ n: 'Salt Pile', c: 5 }], theirGold: 25, theyAgreed: true })",
  'thornswood-box.js': "thornswoodBox.setData({ open: true, hold: 'whiterun', where: 'Whiterun', rows: [], pack: [{ slot: 1, what: 'Leek', count: 2 }], packGold: 5 })",
  'thornswood-help.js': 'thornswoodHelp.open()',
  'thornswood-settings.js': 'thornswoodSettings.open()',
  'thornswood-merchant.js': "thornswoodMerchant.setData({ open: true, trader: 'Belethor', offers: [] })",
  'thornswood-repair.js': 'thornswoodRepair.setData({ open: true, items: [] })',
  'thornswood-ride.js': "thornswoodRide.setData({ open: true, name: 'Horse', stable: 'Whiterun' }); thornswoodRide.open()",
  'thornswood-journal.js': "thornswoodJournal.setData({ journals: [{ id: 'j1', title: 'Notes', pages: [{ id: 'p1', title: 'One', text: 'Words.' }] }], friends: [{ p: 1001, name: 'Sera' }] }); thornswoodJournal.open(); var b = document.querySelector('#ts-journal [data-book]'); if (b) { b.click(); }",
  'thornswood-skills.js': 'thornswoodSkills.open()',
  'thornswood-skills.js chosen': "thornswoodSkills.setData(null, { class: 'hunter', profession: 'mage', schools: ['destruction', 'restoration'], ranks: { destruction: 'novice', restoration: 'novice' }, tree: {}, points: 3, creating: false }); thornswoodSkills.open()",
  'thornswood-maneuvers.js': "thornswoodManeuvers.setRows([{ key: 'cover', name: 'Cover', stamina: 20, ready: true }, { key: 'rally', name: 'Rally', stamina: 40, ready: false }], '9'); thornswoodManeuvers.open()",
  'thornswood-treat.js': 'thornswoodTreat.setData({ open: true, needs: [] })',
  'thornswood-preserve.js': 'thornswoodPreserve.setData({ open: true, may: true, salt: 2, wood: 1, fire: true, perWood: 5, rows: [] })',
  'thornswood-furniture.js': 'thornswoodFurniture.setData({ open: true, rows: [] })',
  'thornswood-ship.js': "thornswoodShip.setData({ open: true, mode: 'dock', port: { key: 'solitude', name: 'Solitude docks' }, holds: [], incoming: [], charter: { may: true, why: '' }, pack: [], people: [] })",
  'thornswood-stall.js': "thornswoodStall.setData({ open: true, id: 'whiterun-6b0b6', place: 'Whiterun', free: false, mine: true, keeperHere: true, officer: false, lines: [], max: 24, said: '', pack: [{ base: '13982', nth: 0, count: 2, what: 'Iron Sword' }], found: [{ base: '13983', name: 'Leek' }], lapseDays: 14 })",
  'thornswood-afk.js': 'thornswoodAfk.ask(60)'
};
const sources = { bridge: read(path.join(UI, 'thornswood-bridge.js')), panels: {} };
for (const k of Object.keys(OPEN)) { const f = k.split(' ')[0]; sources.panels[f] = read(path.join(UI, f)); }

function expression() {
  return '(' + (async function (S, OPEN) {
    function frame() {
      return new Promise(function (ok) {
        var f = document.createElement('iframe');
        f.style.cssText = 'position:absolute;left:0;top:0;border:0;width:1920px;height:1080px';
        f.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';
        f.onload = function () { ok(f); };
        document.body.appendChild(f);
      });
    }
    function tick(win) { return new Promise(function (ok) { win.requestAnimationFrame(function () { win.requestAnimationFrame(ok); }); }); }
    function rgba(s) {
      var m = /rgba?\(([^)]*)\)/.exec(s || '');
      if (!m) { return null; }
      var p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    function lum(c) {
      function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    }
    function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
    function over(top, under) { var a = top[3]; return [0, 1, 2].map(function (i) { return top[i] * a + under[i] * (1 - a); }); }
    var out = [];
    var keys = Object.keys(OPEN);
    for (var k = 0; k < keys.length; k++) {
      var f = await frame(), win = f.contentWindow, row = { panel: keys[k], words: [], bare: [], buttons: [] };
      try {
        win.skyrimPlatform = { sendMessage: function () {} };
        win.THORNSWOOD = {};
        win.eval(S.bridge);
        win.eval(S.panels[keys[k].split(' ')[0]]);
        win.eval(OPEN[keys[k]]);
        await tick(win);
        var fields = win.document.querySelectorAll('input,select,textarea');
        for (var i = 0; i < fields.length; i++) {
          var el = fields[i];
          if (!el.getClientRects().length || el.type === 'hidden') { continue; }
          var named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ||
            (el.id && win.document.querySelector('label[for="' + el.id + '"]')) || el.closest('label');
          if (!named) { row.bare.push(el.outerHTML.slice(0, 90)); }
        }
        var bs = win.document.querySelectorAll('button[data-do]');
        for (var j = 0; j < bs.length; j++) { row.buttons.push([bs[j].getAttribute('data-do'), bs[j].textContent]); }
        var all = win.document.body.querySelectorAll('*');
        for (var n = 0; n < all.length; n++) {
          var e = all[n], own = '';
          for (var c = 0; c < e.childNodes.length; c++) { if (e.childNodes[c].nodeType === 3) { own += e.childNodes[c].nodeValue; } }
          own = own.trim();
          if (!own || !e.getClientRects().length) { continue; }
          var cs = win.getComputedStyle(e);
          if (cs.visibility === 'hidden') { continue; }
          var shown = true, op = 1, chain = [];
          for (var a = e; a && a.nodeType === 1; a = a.parentElement) {
            var s = win.getComputedStyle(a);
            if (s.display === 'none') { shown = false; break; }
            op *= Number(s.opacity);
            var bg = rgba(s.backgroundColor);
            if (bg && bg[3] > 0) { chain.push(bg); }
          }
          if (!shown) { continue; }
          var worst = 99;
          [[0, 0, 0, 1], [255, 255, 255, 1]].forEach(function (back) {
            var under = back;
            for (var q = chain.length - 1; q >= 0; q--) { under = over(chain[q], under); }
            var t = rgba(cs.color);
            worst = Math.min(worst, ratio(over([t[0], t[1], t[2], t[3] * op], under), under));
          });
          row.words.push({
            text: own.slice(0, 40), px: parseFloat(cs.fontSize), cr: Math.round(worst * 100) / 100,
            off: !!e.closest('[aria-disabled="true"],:disabled'), world: chain.length === 0,
            what: e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '')
          });
        }
      } catch (err) { row.err = String(err && err.stack || err); }
      out.push(row);
      f.remove();
    }
    return out;
  }).toString() + ')(' + JSON.stringify(sources) + ',' + JSON.stringify(OPEN) + ')';
}

async function main() {
  const exe = C.find() || (fs.existsSync('/opt/pw-browsers/chromium/chrome-linux/chrome') ? '/opt/pw-browsers/chromium/chrome-linux/chrome' : null);
  if (!exe) {
    ['C', 'D'].forEach((s) => skipped(s + ': no Chrome on this machine (CHROME names one)'));
    done();
    return;
  }
  const rows = await C.evaluate(exe, expression(), 180000);
  for (const r of rows) {
    if (r.err) { yes('C ' + r.panel + ' opens and draws', false, r.err.split('\n')[0]); continue; }
    yes('C ' + r.panel + ' draws words to measure (' + r.words.length + ')', r.words.length > 0);
    const small = r.words.filter((w) => w.px < SMALLEST);
    yes('C ' + r.panel + ': every word is at least ' + SMALLEST + ' pixels', small.length === 0,
        small.slice(0, 4).map((w) => w.what + ' "' + w.text + '" ' + w.px + 'px').join('; '));
    const faint = r.words.filter((w) => !w.off && !w.world && w.cr < 4.5);
    yes('C ' + r.panel + ': every word reads at 4.5 to 1 or better on its box', faint.length === 0,
        faint.slice(0, 4).map((w) => w.what + ' "' + w.text + '" ' + w.cr).join('; '));
    yes('C ' + r.panel + ': every input, select and textarea drawn has a name', r.bare.length === 0, r.bare.join('; '));
  }

  const party = rows.find((r) => r.panel === 'thornswood-party.js');
  const said = (verb) => (party ? party.buttons : []).filter((b) => b[0] === verb).map((b) => b[1]);
  yes('D the voice switch says it is the voice: ' + said('mute').join(', '),
      said('mute').length > 0 && said('mute').every((t) => /^(Mute|Unmute) voice$/.test(t)));
  yes('D the text switch says it is their text: ' + said('mtext').join(', '),
      said('mtext').length > 0 && said('mtext').every((t) => /^(Hide|Show) text$/.test(t)) &&
      said('mtext').indexOf('Show text') >= 0);
  yes('D the name switch says it is their name: ' + said('mname').join(', '),
      said('mname').length > 0 && said('mname').every((t) => /^(Hide|Show) name$/.test(t)) &&
      said('mname').indexOf('Show name') >= 0);
  const strip = rows.find((r) => r.panel === 'thornswood-party.js strip');
  const stripWords = strip ? strip.words.map((w) => w.text).join(' | ') : '';
  yes('D the party strip says "same room" beside the distance for somebody in your room (' + stripWords + ')',
      /10 m, same room/.test(stripWords));
  yes('D and not for somebody somewhere else', /1(\.0)? km/.test(stripWords) && !/km, same room/.test(stripWords));
  done();
}

main().catch((e) => { yes('the harness ran', false, e && e.stack || e); done(); });
