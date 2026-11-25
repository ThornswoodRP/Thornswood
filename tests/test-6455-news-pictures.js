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
assert(!html.includes('style=') && html.includes('loading="lazy"'));
for (const name of ['home.css', 'hub.css']) {
  const css = fs.readFileSync(path.join(__dirname, '../site/public', name), 'utf8');
  assert(css.includes('.news-picture-image{display:block;width:100%;height:auto}') && css.includes('.news-picture figcaption{overflow-wrap:anywhere}'));
}
assert.equal(pictures.html({url:'javascript:alert(1)',alt:'bad'}), '');
assert.equal(pictures.html(null), '');
console.log('PASS News screenshot contract, shared browser/server rendering, escaping and safe URLs');

async function integration() {
  const fixture = { launcher: '1.3.99', news: [{ title: 'A clearer character panel', details: ['Keep this text'], image: cases[1].image }] };
  const home = fs.readFileSync(path.join(__dirname, '../site/public/home.js'), 'utf8');
  const branch = home.slice(home.indexOf("} else if (here === '/news') {") + "} else if (here === '/news') {".length, home.indexOf("} else if (here === '/gallery') {"));
  const hub = fs.readFileSync(path.join(__dirname, '../site/public/hub.js'), 'utf8');
  const start = hub.indexOf('function drawNews() {');
  const draw = hub.slice(start, hub.indexOf('\n}', start) + 2);
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  for (const helper of [pictures, null]) {
    let output = '';
    const context = { window: { ThornswoodNewsPictures: helper }, request: () => Promise.resolve({json: () => Promise.resolve(fixture)}),
      show: html => { output = html; }, esc: escape };
    vm.createContext(context); vm.runInContext(branch, context);
    await new Promise(resolve => setImmediate(resolve));
    assert(output.includes('Keep this text') && !output.includes('Could not load'));
    assert.equal(output.includes('news-picture'), !!helper, 'public client renderer tolerates a missing helper');
    assert(output.includes('&lt;tags&gt;'), 'public client preserves the caption even without its image helper');
    const page = {innerHTML:''}; Object.assign(context, {S: {news: fixture}, head: () => '', el: () => page});
    vm.runInContext(draw + ';drawNews();', context);
    assert(page.innerHTML.includes('Keep this text'));
    assert.equal(page.innerHTML.includes('news-picture'), !!helper, 'Hub renderer tolerates a missing helper');
    assert(page.innerHTML.includes('&lt;tags&gt;'), 'Hub preserves the caption even without its image helper');
  }
  const siteFiles = require('./site-files'), os = require('os'), crypto = require('crypto');
  const {spawn} = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-news-pictures-'));
  let child;
  try {
    siteFiles.copy(dir);
    for (const file of ['home.html','home.js','index.html','hub.js']) fs.copyFileSync(path.join(siteFiles.APP, 'public', file), path.join(dir, 'public', file));
    fs.mkdirSync(path.join(dir, 'data'), {recursive:true});
    fs.writeFileSync(path.join(dir, 'data/news.json'), JSON.stringify(fixture));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({password:crypto.randomBytes(24).toString('hex'), secret:crypto.randomBytes(32).toString('hex'), passKey:crypto.randomBytes(32).toString('hex')}));
    child = spawn(process.execPath, ['server.js'], {cwd:dir, windowsHide:true, env:{...process.env,
      THORNSWOOD_DOCS_PORT:'0', THORNSWOOD_DOCS_LOCAL:'1', THORNSWOOD_GITHUB_API:'http://127.0.0.1:1', THORNSWOOD_CHAT_DIR:path.join(dir,'chat')}});
    const running = await siteFiles.listening(child);
    const base = 'http://127.0.0.1:' + running.port;
    const api = await (await fetch(base + '/api/releases')).json();
    assert.deepStrictEqual(api.news[0].image, fixture.news[0].image, 'normal public API retains the screenshot');
    const page = await (await fetch(base + '/news')).text();
    assert(page.includes('news-picture') && page.includes('&lt;tags&gt;'), 'SSR shows the escaped image and caption');
    assert(page.includes('/news-pictures.js'), 'public shell loads the helper');
    const shell = await (await fetch(base + '/index.html')).text();
    assert(shell.includes('/news-pictures.js'), 'Hub shell loads the helper');
    const asset = await fetch(base + '/news-pictures.js');
    assert.equal(asset.status, 200); assert((await asset.text()).includes('ThornswoodNewsPictures'));
    console.log('PASS News screenshots through HTTP API, SSR, public client, Hub and both script entry points');
  } finally {
    if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    fs.rmSync(dir, {recursive:true,force:true});
  }
}
integration().catch(error => { console.error(error); process.exitCode = 1; });
