'use strict';
/*
  test-4143-hub-weight.js

      node site\tests\test-4143-hub-weight.js

  Issue #4143. The members' hub (site\public\index.html, the sign-in page and
  the hub around it) drew logo.png, 89 KB, in two places that show it at 82
  and 74 px: the sign-in box and the hub home's hero (hub.js). #2780 moved
  only the public header to the small webp copies, and logo-84.webp was
  already there. The page also loaded marked-12.0.2.min.js in its head with
  no defer, so the sign-in page waited on 35 KB it never uses; only hub.js
  reads marked, and hub.js loads at the end of the body.

    A  neither the hub page nor hub.js names /logo.png.
    B  the sign-in logo and the hub home's logo are logo-84.webp, which is
       there and under 10 KB, with their drawn size given.
    C  marked is not in the head; it loads in the body, after the sign-in
       box and before hub.js (which reads it), and still as a plain script
       so it runs before hub.js does.

  Reads the files only. Nothing leaves the machine.
*/
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const CR = String.fromCharCode(13);
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8').split(CR).join('');
const PAGE = read('index.html'), HUB = read('hub.js');
const MARKED = 'marked-12.0.2.min.js';

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why) : '')); }
}

// ---- A ----------------------------------------------------------------
yes('A1 index.html names no /logo.png', PAGE.indexOf('/logo.png') < 0,
  (PAGE.match(/.*\/logo\.png.*/) || [''])[0].trim());
yes('A2 hub.js names no /logo.png', HUB.indexOf('/logo.png') < 0,
  (HUB.match(/.*\/logo\.png.*/) || [''])[0].trim());

// ---- B ----------------------------------------------------------------
const small = path.join(PUBLIC, 'logo-84.webp');
const size = fs.existsSync(small) ? fs.statSync(small).size : -1;
yes('B1 logo-84.webp is there and under 10 KB (' + size + ' bytes)', size > 0 && size < 10240);
const gate = (/<img[^>]*class="gate-logo"[^>]*>/.exec(PAGE) || [''])[0];
yes('B2 the sign-in logo is logo-84.webp at 82 by 82 (' + gate + ')',
  /src="\/logo-84\.webp"/.test(gate) && /width="82"/.test(gate) && /height="82"/.test(gate));
const at = HUB.indexOf('<div class="hero">');
const hero = at < 0 ? '' : ((/<img[^>]*>/.exec(HUB.slice(at, at + 400)) || [''])[0]);
yes('B3 the hub home\'s logo is logo-84.webp at 74 by 74 (' + hero + ')',
  /src="\/logo-84\.webp"/.test(hero) && /width="74"/.test(hero) && /height="74"/.test(hero));

// ---- C ----------------------------------------------------------------
const head = PAGE.slice(0, PAGE.indexOf('</head>'));
yes('C1 marked is not loaded in the head', head.indexOf(MARKED) < 0);
const tag = '<script src="/' + MARKED + '"></script>';
const m = PAGE.indexOf(tag), h = PAGE.indexOf('<script src="/hub.js"></script>'), g = PAGE.indexOf('id="gate"');
const named = PAGE.split(MARKED).length - 1;
yes('C2 marked loads once, as a plain script, after the sign-in box and before hub.js',
  m > 0 && named === 1 && g > 0 && g < m && h > m, 'marked named ' + named + ' time(s), its tag at ' + m + ', gate at ' + g + ', hub.js at ' + h);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
