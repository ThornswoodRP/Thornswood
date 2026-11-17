// The browser and server use the same screenshot parser and renderer.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const cases = require('./fixtures/news-picture-cases.json');
const file = path.join(__dirname, '../site/public/news-pictures.js');
const pictures = require(file);
for (const c of cases) assert.deepStrictEqual(pictures.parse(c.line), c.image, c.line);
const browser = { window: {} }; vm.createContext(browser); vm.runInContext(fs.readFileSync(file, 'utf8'), browser);
assert.equal(browser.window.ThornswoodNewsPictures.html(cases[0].image), pictures.html(cases[0].image));
const html = pictures.html(cases[1].image);
assert(html.includes('&lt;tags&gt;') && html.includes('&quot;quotes&quot;'));
assert(html.includes('height:auto') && html.includes('width:100%') && html.includes('loading="lazy"'));
assert.equal(pictures.html({url:'javascript:alert(1)',alt:'bad'}), '');
assert.equal(pictures.html(null), '');
console.log('PASS News screenshot contract, shared browser/server rendering, escaping and safe URLs');
