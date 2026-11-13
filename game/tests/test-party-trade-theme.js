// test-party-trade-theme.js
//
// The party window behind P and the trade window wear the K panel's theme, as
// the journal does, and still do what they did.
//
// Patrick, 23 September, about the journal: "the journal menu works but is
// ugly asf and doesn't match the theme we use with our other menus". The
// journal was restyled to the K panel's theme by pull request 240 and
// game/tests/test-journal-theme.js holds it there. The party and trade windows were
// drawn from the same old template the journal had been: system-ui sans serif,
// a rounded 12px panel and 7px controls, flat grey #1b1f26 and #212630, and a
// brass #d9ab52, the To Do List web page's palette rather than the game's.
// They are the same complaint.
//
// So this reads the stylesheets of all four overlays, the K panel's out of
// thornswood-skills.js and the journal's, party's and trade's by running them,
// and holds party and trade to the K panel value for value and to the journal
// where the K panel has no rule of the same kind (section heads, small print).
// If the K panel's theme moves, this says the two windows have not followed.
//
// THE TRADE WINDOW IS WHERE ITEMS CHANGE HANDS. A restyle that shrank or hid a
// button, a quantity or Agree would be a real defect, so every button's and
// box's font size, padding and line height are held to at least what the old
// file gave them. The old heights were measured in Edge at 1920 by 1080 under
// the front's own reset (read out of Data\Platform\UI\build.js) on
// 24 September: the party's buttons 29px, trade's row buttons 24px, Agree and
// Walk away 35px, the find and gold boxes 32px. The new files come out at the
// same heights and wider, since uppercase and spaced is wider.
//
// AND THE OTHER HALF: only the look was to change. Both windows are RUN here,
// in a small stand-in for the page, and every button is pressed, so a restyle
// that broke an id or a class the script reads fails this too. Those checks
// pass on the old files and the new ones alike.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
function read(...bits) {
  return fs.readFileSync(path.join(REPO_DIR, ...bits), 'utf8').split(CR).join('');
}
const SRC = {
  party: read('game', 'ui', 'thornswood-party.js'),
  trade: read('game', 'ui', 'thornswood-trade.js'),
  journal: read('game', 'ui', 'thornswood-journal.js')
};
const skillsSrc = read('game', 'ui', 'thornswood-skills.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function code(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ------------------------------------------------------ a page to run it in
/*
  Just enough of a document for these windows: elements made from the markup
  they write, found again by id or by tag and attribute, with onclick,
  oninput, value, style and getAttribute. Every element a string of markup
  makes is kept on the element that string was written into, so a search from
  the root reaches what draw() writes into the body and the columns.
*/
function unesc(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
function makeEl(tag) {
  const e = {
    tagName: String(tag).toLowerCase(), attrs: {}, kids: [], children: [], html: '', style: {},
    id: '', className: '', textContent: '', value: '', onclick: null, oninput: null,
    appendChild(c) { this.children.push(c); return c; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    focus() { },
    querySelectorAll(sel) {
      const tests = sel.split(',').map(function (s) { return matcher(s.trim()); });
      const out = [];
      (function walk(list) {
        list.forEach(function (k) {
          if (tests.some(function (t) { return t(k); })) { out.push(k); }
          walk(k.kids);
        });
      })(this.kids.concat(this.children));
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  Object.defineProperty(e, 'innerHTML', {
    get() { return this.html; },
    set(h) { this.html = h; this.kids = parse(h); }
  });
  return e;
}
function matcher(sel) {
  const m = /^([a-z0-9]*)(?:#([\w-]+))?(?:\[([\w-]+)\])?$/i.exec(sel);
  if (!m) { throw new Error('the stand-in page cannot read the selector ' + sel); }
  return function (el) {
    if (m[1] && el.tagName !== m[1].toLowerCase()) { return false; }
    if (m[2] && el.attrs.id !== m[2]) { return false; }
    if (m[3] && !Object.prototype.hasOwnProperty.call(el.attrs, m[3])) { return false; }
    return true;
  };
}
function parse(html) {
  const out = [];
  const tag = /<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/gi;
  let m;
  while ((m = tag.exec(html))) {
    const el = makeEl(m[1]);
    const attr = /([a-z-]+)(?:="([^"]*)")?/gi;
    let a;
    while ((a = attr.exec(m[2]))) { el.attrs[a[1]] = a[2] == null ? '' : unesc(a[2]); }
    el.id = el.attrs.id || '';
    el.className = el.attrs['class'] || '';
    if (el.tagName === 'input') { el.value = el.attrs.value || ''; }
    const shut = html.indexOf('</' + m[1] + '>', tag.lastIndex);
    if (el.tagName === 'button' && shut > 0) { el.textContent = unesc(html.slice(tag.lastIndex, shut)); }
    out.push(el);
  }
  return out;
}
// Everything a window has drawn, its own markup and what was written into it.
function allHtml(el) {
  return el.html + el.kids.concat(el.children).map(allHtml).join('');
}

function load(name, initial) {
  const page = { told: [], sent: [], keys: {} };
  const doc = {
    head: makeEl('head'),
    body: makeEl('body'),
    activeElement: null,
    createElement: makeEl,
    addEventListener(type, fn) { page.keys[type] = fn; }
  };
  const win = {
    skyrimPlatform: { sendMessage(to, what) { page.told.push(to + ' ' + what); } },
    thornswoodNet: { say(line) { page.sent.push(line); return true; } },
    // The journal is scaled to the screen (test-journal-scale.js holds that).
    innerWidth: 1920, innerHeight: 1080,
    addEventListener() { }
  };
  Object.assign(win, initial || {});
  new Function('window', 'document', SRC[name])(win, doc);
  page.win = win;
  page.doc = doc;
  page.style = doc.head.children[0];
  page.root = doc.body.children[0];
  page.css = page.style ? page.style.textContent : '';
  return page;
}

// -------------------------------------------------------------- read the css
function rules(css) {
  const out = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].replace(/\s+/g, ' ').trim();
    const d = out[sel] || (out[sel] = {});
    m[2].split(';').forEach(function (bit) {
      const at = bit.indexOf(':');
      if (at < 0) { return; }
      d[bit.slice(0, at).trim()] = bit.slice(at + 1).replace(/\s+/g, ' ').trim();
    });
  }
  return out;
}
const kMatch = /var css = \[([\s\S]*?)\]\.join\(''\);/.exec(skillsSrc);
const kCss = kMatch ? new Function('return [' + kMatch[1] + '].join("");')() : '';
const K = rules(kCss);
function k(sel, prop) { return (K['#ts-skills' + sel] || {})[prop]; }
yes('the K panel\'s stylesheet was read out of thornswood-skills.js', !!K['#ts-skills'] && !!K['#ts-skills .panel']);

const journal = load('journal');
const JR = rules(journal.css);
function j(sel, prop) { return (JR['#ts-journal' + sel] || {})[prop]; }
yes('the journal\'s stylesheet is read too', !!JR['#ts-journal'] && !!JR['#ts-journal .panel']);

const COLOUR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
function norm(c) { return c.toLowerCase().replace(/\s+/g, ''); }
const kColours = {};
(kCss.match(COLOUR) || []).forEach(function (c) { kColours[norm(c)] = true; });
const OLD_COLOURS = [['#1b1f26', 'flat grey panel'], ['#212630', 'grey list rows'],
  ['#d9ab52', 'To Do List page\'s brass'], ['#3a424e', 'grey borders'], ['#2b313a', 'grey hairlines'],
  ['#79828f', 'grey small print'], ['#98a2ae', 'grey second line'], ['#e9e7e1', 'off white text'],
  ['#13161b', 'grey text box']];

// ======================================================= the theme, per window
function theme(name, ID, W, page, drawn) {
  function w(sel, prop) { return (W['#' + ID + sel] || {})[prop]; }
  const said = name === 'party' ? 'the party window' : 'the trade window';
  const src = code(SRC[name]);
  const look = page.css + '\n' + drawn;   // its stylesheet and every line of markup it drew

  yes(said + ': its stylesheet is in the page', page.css.length > 0);

  // the fonts
  const stack = k('', 'font-family');
  yes(said + ' is set in the K panel\'s Palatino stack', /^"Palatino Linotype",Palatino,/.test(stack || '') &&
      w('', 'font-family') === stack);
  const faces = [];
  Object.keys(W).forEach(function (s) {
    const f = W[s]['font-family'];
    if (f && f !== stack && f !== 'inherit') { faces.push(s + ' ' + f); }
  });
  yes(said + ': nothing inside it picks another type' + (faces.length ? ' (' + faces.join('; ') + ')' : ''), !faces.length);
  yes(said + ': no system-ui or sans serif anywhere in the file', !/system-ui|sans-serif/.test(src));
  yes(said + ': no font off the network, the game\'s browser has only the machine\'s',
      !/@font-face|@import|url\(/.test(page.css));

  // the colours
  const stray = {};
  (look.match(COLOUR) || []).forEach(function (c) { if (!kColours[norm(c)]) { stray[norm(c)] = true; } });
  const list = Object.keys(stray);
  yes(said + ': every colour in its stylesheet and its markup is one the K panel uses' +
      (list.length ? ' (not: ' + list.join(' ') + ')' : ''), list.length === 0);
  yes(said + ': the text is the K panel\'s parchment', w('', 'color') === k('', 'color'));
  OLD_COLOURS.forEach(function (old) {
    yes(said + ': the old template\'s ' + old[1] + ' ' + old[0] + ' is gone',
        look.toLowerCase().indexOf(old[0]) < 0);
  });
  yes(said + ': #1b1f26 and #212630 are nowhere in the file',
      src.toLowerCase().indexOf('#1b1f26') < 0 && src.toLowerCase().indexOf('#212630') < 0);

  // backdrop, panel, corners
  yes(said + ': the screen behind is the K panel\'s dark vignette',
      /radial-gradient/.test(w('', 'background') || '') && w('', 'background') === k('', 'background'));
  ['background', 'border', 'outline', 'outline-offset', 'box-shadow'].forEach(function (p) {
    yes(said + ': the panel\'s ' + p + ' is the K panel\'s', !!k(' .panel', p) && w(' .panel', p) === k(' .panel', p));
  });
  yes(said + ': the panel has no 12px rounded corner', !w(' .panel', 'border-radius') &&
      !/border-radius:\s*12px/.test(src));
  const rounded = [];
  Object.keys(W).forEach(function (s) {
    if (W[s]['border-radius'] && !/::-webkit-scrollbar-thumb$/.test(s)) { rounded.push(s); }
  });
  yes(said + ': square corners, no rounding but the scrollbar\'s, which the K panel has too' +
      (rounded.length ? ' (' + rounded.join('; ') + ')' : ''), rounded.length === 0);
  yes(said + ': and none in the markup it draws', !/border-radius/.test(drawn));
  yes(said + ': the title is the K panel\'s title, in size and colour',
      w(' h2', 'color') === k(' .title', 'color') && w(' h2', 'font-size') === k(' .title', 'font-size'));
  yes(said + ': the lines across the panel are the K panel\'s gold hairline',
      w(' h2', 'border-bottom') === k(' .head', 'border-bottom') &&
      w(' .foot', 'border-top') === k(' .foot', 'border-top'));
  yes(said + ': the small print at the foot is the K panel\'s status line',
      w(' .foot', 'color') === k(' .status', 'color') && w(' .foot', 'font-style') === k(' .status', 'font-style'));

  // what the journal has and the K panel has no rule of the same kind for
  yes(said + ': its section heads are the journal\'s',
      ['font-size', 'letter-spacing', 'text-transform', 'color', 'font-weight', 'border-bottom'].every(function (p) {
        return !!j(' h3', p) && w(' h3', p) === j(' h3', p);
      }));
  yes(said + ': "nothing here" reads as the journal\'s does',
      w(' .none', 'color') === j(' .none', 'color') && w(' .none', 'font-style') === j(' .none', 'font-style'));

  // buttons and boxes
  yes(said + ': a button is the K panel\'s, uppercase, spaced, gold on dark',
      w(' button', 'text-transform') === 'uppercase' &&
      w(' button', 'letter-spacing') === k(' .tsbtn', 'letter-spacing') &&
      w(' button', 'color') === k(' .tsbtn', 'color') &&
      w(' button', 'border') === k(' .tsbtn', 'border') &&
      w(' button', 'background') === k(' .tsbtn', 'background'));
  yes(said + ': and the primary is the K panel\'s gold one with dark words',
      w(' button.go', 'background') === k(' .tsbtn.primary', 'background') &&
      w(' button.go', 'border-color') === k(' .tsbtn.primary', 'border-color') &&
      w(' button.go', 'color') === k(' .tsbtn.primary', 'color'));
  yes(said + ': a button is the same as the journal\'s',
      ['border', 'background', 'color', 'letter-spacing', 'text-transform'].every(function (p) {
        return w(' button', p) === j(' button', p);
      }));
  const moving = Object.keys(W).filter(function (s) { return /:hover/.test(s) || W[s].transition; });
  yes(said + ': no :hover and no transitions, the K panel\'s rule' +
      (moving.length ? ' (' + moving.join('; ') + ')' : ''), moving.length === 0);

  // scrollbars
  const theirs = Object.keys(K).filter(function (s) { return /^::-webkit-scrollbar/.test(s); });
  yes(said + ': the K panel\'s scrollbar rules were found', theirs.length >= 4);
  theirs.forEach(function (s) {
    const mine = W['#' + ID + ' ' + s];
    yes(said + ' carries ' + s + ' as the K panel writes it',
        !!mine && JSON.stringify(mine) === JSON.stringify(K[s]));
  });

  // nothing is hidden
  const hides = [];
  Object.keys(W).forEach(function (s) {
    const d = W[s];
    if (s === '#' + ID && d.display === 'none') { return; }     // closed until it opens, as before
    if (d.display === 'none' || d.visibility === 'hidden' || d['font-size'] === '0' ||
        d.color === 'transparent' || (d.opacity != null && !(s === '#' + ID + ' button.off' && Number(d.opacity) >= 0.55))) {
      hides.push(s);
    }
  });
  yes(said + ': no rule hides or fades a control, beyond Agree\'s own .55 once agreed' +
      (hides.length ? ' (' + hides.join('; ') + ')' : ''), hides.length === 0);
}

// ------------------------------------------------ no control got any smaller
/*
  What the old files gave each control, measured in Edge at 1920 by 1080
  under the front's reset on 24 September: font size and padding out of the
  stylesheet, and the line each one's text sat on, which the old type gave
  without a rule. Height is line + padding + a 1px border top and bottom.
*/
function px(v) { const m = /^(-?[\d.]+)px$/.exec(String(v || '').trim()); return m ? Number(m[1]) : null; }
function pad(v) {
  const p = String(v || '').trim().split(/\s+/).map(px);
  if (!p.length || p.some(function (x) { return x == null; })) { return null; }
  return { v: p[0], h: p.length > 1 ? p[1] : p[0], b: p.length > 2 ? p[2] : p[0] };
}
function sizes(said, W, list) {
  list.forEach(function (c) {
    function get(prop) {
      for (let i = 0; i < c.from.length; i++) {
        const d = W[c.from[i]] || {};
        if (d[prop] != null) { return d[prop]; }
        // font:inherit hands size and line height down from the parent, so
        // whatever the rule after it would have said, the font decides
        if (d.font === 'inherit') { return null; }
      }
      return null;
    }
    const size = px(get('font-size'));
    const p = pad(get('padding'));
    const line = px(get('line-height'));
    if (c.size != null) {
      yes(said + ': ' + c.what + ', a font size of at least the ' + c.size + 'px it had' + (size != null ? ' (' + size + 'px)' : ''),
          size != null && size >= c.size);
    }
    yes(said + ': ' + c.what + ', at least the padding it had, ' + c.pad.join('px ') + 'px',
        !!p && p.v >= c.pad[0] && p.b >= c.pad[0] && p.h >= c.pad[1]);
    const tall = (line != null && p) ? line + p.v + p.b + 2 : null;
    yes(said + ': ' + c.what + ', at least the ' + c.height + 'px tall it was, whatever the font' +
        (tall != null ? ' (' + tall + 'px)' : ' (no line height is pinned, so it rests on the font)'),
        tall != null && tall >= c.height);
  });
}

// ============================================================== the party
const party = load('party');
const P = rules(party.css);
{
  const pr = party.root;
  yes('the party window loads and says it is ready', !!party.win.thornswoodParty &&
      party.told.indexOf('thornswood-front party:ready') >= 0);
  party.win.thornswoodParty.setData({
    me: 'p1',
    offer: { kind: 'party', name: 'Ingrid' },
    party: [{ name: 'Aldric', me: true, on: true, leader: true }, { name: 'Sera', on: true }, { name: 'Bjorn', on: false }],
    together: 1, bonus: 10,
    friends: [
      { name: 'Sera', on: true, party: true },
      { name: 'Bjorn', on: true },
      { name: 'Hilde', on: false, muted: true }
    ]
  });
  party.win.thornswoodParty.open();
  yes('opening shows the party window and tells the plugin', pr.className === 'on' &&
      party.told.indexOf('thornswood-front party:opened') >= 0);

  theme('party', 'ts-party', P, party, allHtml(pr));

  yes('the party window is still 880 by 620', (P['#ts-party .panel'] || {}).width === '880px' &&
      (P['#ts-party .panel'] || {}).height === '620px');
  yes('with the title, the body and the foot, in that order',
      (P['#ts-party .panel'] || {})['grid-template-rows'] === 'auto 1fr auto');
  yes('online is lit in the K panel\'s green for what is yours, and offline is not',
      (P['#ts-party .dot.on'] || {}).background === '#7fb877' &&
      (P['#ts-party .dot'] || {}).background !== (P['#ts-party .dot.on'] || {}).background);

  sizes('the party window', P, [
    { what: 'every button', from: ['#ts-party button'], size: 13, pad: [5, 11], height: 29 }
  ]);

  const body = pr.querySelector('#ts-party-body');
  function press(verb, who) {
    const b = body.querySelectorAll('button[data-do]').filter(function (x) {
      return x.getAttribute('data-do') === verb && (!who || x.getAttribute('data-who') === who);
    })[0];
    if (!b) { return null; }
    b.onclick.call(b);
    return party.sent[party.sent.length - 1];
  }
  yes('the offer\'s Yes sends /yes', press('yes') === '/yes');
  yes('and No sends /no', press('no') === '/no');
  yes('Leave sends /party leave', press('leave') === '/party leave');
  yes('Ask to party names the friend', press('ask', 'Bjorn') === '/party Bjorn');
  yes('Mute names the friend', press('mute', 'Sera') === '/mute Sera');
  yes('Remove names the friend', press('drop', 'Hilde') === '/friend remove Hilde');
  yes('a friend who is already in the party has no Ask button', !body.querySelectorAll('button[data-do]').some(function (x) {
    return x.getAttribute('data-do') === 'ask' && x.getAttribute('data-who') === 'Sera';
  }));
  yes('the ids the script reads are all there', ['#ts-party-sub', '#ts-party-body', '#ts-party-foot', '#ts-party-close']
      .every(function (s) { return !!pr.querySelector(s); }));
  yes('the title still counts the friends', pr.querySelector('#ts-party-sub').textContent === '3 friends');
  yes('the foot still says how to close it', /Escape or P closes this/.test(pr.querySelector('#ts-party-foot').textContent));
  yes('the classes it draws with are all still styled', ['.row', '.dot', '.dot.on', '.tag', '.tag.p', '.tag.m', '.ask', '.note', '.none', 'button.go']
      .every(function (c) { return !!P['#ts-party ' + c]; }));
  const close = pr.querySelector('#ts-party-close');
  close.onclick.call(close);
  yes('Close closes it and tells the plugin', pr.className === '' &&
      party.told.indexOf('thornswood-front party:closed') >= 0);
  party.win.thornswoodParty.open();
  party.keys.keydown({ key: 'Escape', preventDefault() { } });
  yes('Escape closes it too', pr.className === '' && !party.win.thornswoodParty.isOpen());

  /*
    #1591: a group book invite is an offer of kind book. The panel and the
    ask card both word an offer from its kind, and both used to know only
    friend and party, so a book invite read as a trade. It names the book.
  */
  party.win.thornswoodParty.setData({
    me: 'p1', offer: { kind: 'book', name: 'Ingrid', about: 'the business The <Bee>' },
    party: [], together: 0, bonus: 10, friends: []
  });
  party.win.thornswoodParty.open();
  const panelAsk = allHtml(pr);
  yes('#1591: a book invite on the P panel reads as one and names the book, escaped',
      /Ingrid<\/b> invites you into the business The &lt;Bee&gt;/.test(panelAsk) && !/offering to trade/.test(panelAsk));
  const askCard = party.doc.body.children.filter(function (c) { return c.id === 'ts-ask'; })[0];
  yes('#1591: and the ask card says the same, not a trade',
      !!askCard && /Ingrid<\/b> invites you into the business The &lt;Bee&gt;\./.test(askCard.html) &&
      !/trade/.test(askCard.html));
  const cardYes = askCard ? askCard.querySelectorAll('button[data-do]').filter(function (b) {
    return b.getAttribute('data-do') === 'yes';
  })[0] : null;
  if (cardYes) { cardYes.onclick.call(cardYes); }
  yes('#1591: Accept on the card still sends /yes, which joins the book', party.sent[party.sent.length - 1] === '/yes');
  party.win.thornswoodParty.setData({
    me: 'p1', offer: { kind: 'book', name: 'Ingrid' }, party: [], together: 0, bonus: 10, friends: []
  });
  yes('#1591: an invite with no book named still reads as a group book',
      /invites you into a group book\./.test(askCard ? askCard.html : '') &&
      /invites you into a group book/.test(allHtml(pr)));
  party.win.thornswoodParty.close();
}

// ============================================================== the trade
const trade = load('trade');
const T = rules(trade.css);
{
  const tr = trade.root;
  yes('the trade window loads and says it is ready', !!trade.win.thornswoodTrade &&
      trade.told.indexOf('thornswood-front trade:ready') >= 0);
  const offer = {
    open: true, them: 'Ingrid',
    pack: [{ n: 'Iron Sword', c: 3 }, { n: 'Leek', c: 1 }],
    mine: [{ n: 'Iron Dagger', c: 1 }], myGold: 40, iAgreed: false,
    theirs: [{ n: 'Salt Pile', c: 5 }], theirGold: 25, theyAgreed: false
  };
  trade.win.thornswoodTrade.setData(offer);
  yes('a trade opens the window by itself and tells the plugin', tr.className === 'on' &&
      trade.told.indexOf('thornswood-front trade:opened') >= 0);

  theme('trade', 'ts-trade', T, trade, allHtml(tr));

  yes('the trade window is still 1020 by 640', (T['#ts-trade .panel'] || {}).width === '1020px' &&
      (T['#ts-trade .panel'] || {}).height === '640px');
  yes('with its three columns', (T['#ts-trade .cols'] || {})['grid-template-columns'] === '1fr 1fr 1fr');
  yes('and the gold box still 110px', (T['#ts-trade .gold input'] || {}).width === '110px');
  const field = T['#ts-trade input'] || {};
  yes('a text box has a gold hairline and square corners, as the journal\'s does',
      /^1px solid rgba\(198,170,109,/.test(field.border || '') && !field['border-radius'] &&
      field.border === (JR['#ts-journal input,#ts-journal textarea,#ts-journal select'] || {}).border &&
      field.background === (JR['#ts-journal input,#ts-journal textarea,#ts-journal select'] || {}).background);
  yes('agreed reads in the K panel\'s green', (T['#ts-trade .ok'] || {}).color === '#9fcf92');

  sizes('the trade window', T, [
    { what: 'a button in a row (+1, all, take back, Set)', from: ['#ts-trade button'], size: 12.5, pad: [3, 9], height: 24 },
    { what: 'Agree and Walk away', from: ['#ts-trade .foot button', '#ts-trade button'], size: 14, pad: [7, 16], height: 35 },
    { what: 'the find and gold boxes', from: ['#ts-trade input'], size: null, pad: [6, 9], height: 32 }
  ]);

  function lastSent() { return trade.sent[trade.sent.length - 1]; }
  const pack = tr.querySelector('#ts-trade-pack');
  const adds = pack.querySelectorAll('button[data-add]');
  yes('every item in your pack has Add 1, and All when there is more than one',
      adds.length === 3 && adds.filter(function (b) { return b.textContent === 'All'; }).length === 1);
  adds[0].onclick.call(adds[0]);
  yes('Add 1 offers one', lastSent() === '/trade add Iron Sword 1');
  const qty = pack.querySelectorAll('input').filter(function (el) {
    return el.getAttribute('data-for') === 'Iron Sword';
  })[0];
  yes('each pack line has a box for a count', !!qty);
  qty.value = '2';
  if (qty.oninput) { qty.oninput.call(qty); }
  const addTyped = pack.querySelector('button[data-qty]');
  addTyped.onclick.call(addTyped);
  yes('a typed count offers that many', lastSent() === '/trade add Iron Sword 2');
  adds[1].onclick.call(adds[1]);
  yes('All offers every one of them', lastSent() === '/trade add Iron Sword 3');
  const back = tr.querySelector('#ts-trade-mine').querySelector('button[data-rem]');
  back.onclick.call(back);
  yes('take back takes it back', lastSent() === '/trade remove Iron Dagger');
  tr.querySelector('#ts-trade-gold').value = '55';
  const set = tr.querySelector('#ts-trade-mine').querySelector('button[data-do]');
  set.onclick.call(set);
  yes('Set offers the gold in the box', lastSent() === '/trade gold 55');
  const ok = tr.querySelector('#ts-trade-ok');
  yes('Agree is the gold primary until you agree', ok.className === 'go' && ok.textContent === 'Agree');
  ok.onclick.call(ok);
  yes('Agree sends /trade ok', lastSent() === '/trade ok');
  const cancel = tr.querySelector('#ts-trade-cancel');
  cancel.onclick.call(cancel);
  yes('Walk away sends /trade cancel', lastSent() === '/trade cancel');
  yes('the other side\'s offer is drawn, gold included',
      /Salt Pile/.test(tr.querySelector('#ts-trade-theirs').innerHTML) && />25</.test(tr.querySelector('#ts-trade-theirs').innerHTML));

  const find = tr.querySelector('#ts-trade-find');
  find.value = 'leek';
  find.oninput.call(find);
  const left = tr.querySelector('#ts-trade-pack').querySelectorAll('button[data-add]');
  yes('the find box still narrows the pack', left.length === 1 && left[0].getAttribute('data-add') === 'Leek');

  trade.win.thornswoodTrade.setData(Object.assign({}, offer, { iAgreed: true }));
  const okNow = tr.querySelector('#ts-trade-ok');
  yes('once you agree, Agree says Agreed and is drawn as .off, as before',
      okNow.className === 'off' && okNow.textContent === 'Agreed');
  yes('the state line says who it is waiting for', /Waiting for Ingrid/.test(tr.querySelector('#ts-trade-state').textContent));
  yes('the ids the script reads are all there', ['#ts-trade-title', '#ts-trade-pack', '#ts-trade-mine', '#ts-trade-theirs',
    '#ts-trade-state', '#ts-trade-cancel', '#ts-trade-ok', '#ts-trade-find', '#ts-trade-gold']
      .every(function (s) { return !!tr.querySelector(s); }));
  yes('the title says who you are trading with', tr.querySelector('#ts-trade-title').textContent === 'Trading with Ingrid');
  yes('the classes it draws with are all still styled', ['.col', '.line', '.line .nm', '.line .c', '.gold', '.ok', '.wait', '.none', 'button.go', 'button.off']
      .every(function (c) { return !!T['#ts-trade ' + c]; }));

  const before = trade.sent.length;
  trade.keys.keydown({ key: 'Escape', preventDefault() { } });
  yes('Escape walks away rather than hiding the window', trade.sent.length === before + 1 &&
      lastSent() === '/trade cancel' && tr.className === 'on');
  trade.win.thornswoodTrade.setData({ open: false });
  yes('the server ending the trade closes the window and tells the plugin', tr.className === '' &&
      trade.told.indexOf('thornswood-front trade:closed') >= 0);
}

// #1718: each line is one piece, and its buttons ask for that piece by the
// number the server gave it, never by a name two pieces can share.
{
  const pieces = load('trade');
  const pr = pieces.root;
  function sent() { return pieces.sent[pieces.sent.length - 1]; }
  pieces.win.thornswoodTrade.setData({
    open: true, them: 'Ingrid',
    pack: [{ p: 1, n: 'Key to Breezehome', c: 1, k: 'Keys' }, { p: 2, n: 'Key to Honeyside', c: 1, k: 'Keys' },
           { p: 3, n: 'Steel Dagger (enchanted)', c: 2, k: 'Weapons' }, { p: 4, n: 'Steel Dagger (enchanted)', c: 3, k: 'Weapons' }],
    mine: [{ p: 2, n: 'Key to Honeyside', c: 1 }], myGold: 0, iAgreed: false,
    theirs: [{ p: 7, n: 'Iron Sword (85%)', c: 1 }], theirGold: 0, theyAgreed: false
  });
  const packCol = pr.querySelector('#ts-trade-pack');
  const add1 = packCol.querySelectorAll('button[data-add]').filter(function (b) { return b.textContent === 'Add 1'; });
  yes('#1718 each piece is its own line with its own Add 1', add1.length === 4 &&
      /Key to Breezehome/.test(packCol.innerHTML) && /Key to Honeyside/.test(packCol.innerHTML));
  add1[1].onclick.call(add1[1]);
  yes('#1718 Add 1 on the Honeyside line asks for that piece by its number', sent() === '/trade add #2 1');
  const boxes = packCol.querySelectorAll('input').filter(function (el) { return el.getAttribute('data-side') === 'add'; });
  boxes[3].value = '2';
  if (boxes[3].oninput) { boxes[3].oninput.call(boxes[3]); }
  const adds = packCol.querySelectorAll('button[data-qty]');
  adds[3].onclick.call(adds[3]);
  yes('#1718 two lines that read the same each read their own box and send their own piece',
      sent() === '/trade add #4 2');
  adds[2].onclick.call(adds[2]);
  yes('#1718 and the other line\'s box is its own', sent() === '/trade add #3 1');
  const takeBack = pr.querySelector('#ts-trade-mine').querySelectorAll('button[data-rem]')
    .filter(function (b) { return b.textContent === 'Take back'; })[0];
  takeBack.onclick.call(takeBack);
  yes('#1718 Take back asks for the piece on that line', sent() === '/trade remove #2');
  yes('#1718 the other side\'s piece is drawn under its own name',
      /Iron Sword \(85%\)/.test(pr.querySelector('#ts-trade-theirs').innerHTML));
}


// Owner state arrives before the async overlay script in a cold browser (#1275).
{
  const social = { me: 701, friends: [{ name: 'Second', on: true }], party: [],
    together: 0, bonus: 15, offer: null, journals: [], shared: [], muted: {} };
  const p = load('party', { thornswoodSocialView: social });
  p.win.thornswoodParty.open();
  yes('a late party script uses the already received friends instead of waiting',
    /Second/.test(allHtml(p.root)) && !/Waiting for the server/.test(allHtml(p.root)));
  const j = load('journal', { thornswoodSocialView: social });
  j.win.thornswoodJournal.open();
  yes('a late journal script also consumes the already received owner view',
    !/Waiting for the server/.test(allHtml(j.root)));
  const accepted = { open: true, them: 'Second', pack: [], mine: [], theirs: [],
    myGold: 0, theirGold: 0, iAgreed: false, theyAgreed: false };
  const t = load('trade', { thornswoodTradeView: accepted });
  yes('a trade accepted before its script mounts opens when the script becomes ready',
    t.root.className === 'on' && /Second/.test(allHtml(t.root)) && t.told.includes('thornswood-front trade:opened'));
  const closed = load('trade', { thornswoodTradeView: { open: false } });
  yes('a closed cached trade never opens a stale window', closed.root.className !== 'on');
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
