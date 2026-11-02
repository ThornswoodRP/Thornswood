'use strict';
// test-3147-lines.js
//
//     node site\tests\test-3147-lines.js
//
// #3147: one maintained file of Thornswood's hints and lore lines, which the
// loading screens, the site and the Discord bot all draw from. It is
// site\data\site\lines.md, and its own comment says the rules. This holds
// them, and holds the readers to it:
//
//   1. The file. A Hints list and a Lore lines list, one line each, plain
//      text, 128 characters at most (the most a Discord status holds), the
//      writing rules, no line twice. A lore line is a quote with its source
//      on the line under it, and the quote is found word for word in that
//      source (world.md's account or one of its Accord articles, or
//      lore\factions.md), so a line cannot drift from the lore it quotes.
//   2. The site. parseLines and fillLoreLine, lifted from server.js between
//      their markers, read the file and fill home.html's one empty quote.
//      home.html keeps no lore line of its own. A copy of the site, started
//      on a spare port, shows a line from the file on the front page and
//      hands every line out in /api/public.
//   3. The bot. bot.py keeps none of the lines, starts watch_lines when it
//      comes up, and reads /api/public's lines. With the Python the bot runs
//      on (tests\bot-python.js), status_lines turns what the site hands out
//      into the lines the status steps through. With none, a SKIP line.
//
// Nothing leaves this machine. The site copy and its files are in a scratch
// folder under the system's temp folder.
const fs = require('fs'), path = require('path'), os = require('os');
const net = require('net'), http = require('http');
const { spawn, spawnSync } = require('child_process');
const siteFiles = require('../../tests/site-files');
const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'site');

let pass = 0, fail = 0;
function yes(what, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + what);
  if (condition) pass++; else fail++;
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); }
  catch (e) { return null; }
}
const flat = (s) => String(s).replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------ the file --
const LINES = read('site/data/site/lines.md');
yes('site/data/site/lines.md is there', LINES !== null);
const src = siteFiles.source() || '';
const cut = /\/\/ ==== thornswood lines ====([\s\S]*?)\/\/ ==== end thornswood lines ====/.exec(src);
yes('server.js has the lines block between its markers', !!cut);
const lib = cut ? new Function(cut[1] + '\nreturn { parseLines: parseLines, fillLoreLine: fillLoreLine };')()
                : { parseLines: () => ({ hints: [], lore: [] }), fillLoreLine: (h) => h };
const parsed = lib.parseLines(LINES || '');
yes('it has hints (' + parsed.hints.length + ')', parsed.hints.length >= 10);
yes('and lore lines (' + parsed.lore.length + ')', parsed.lore.length >= 10);

// Every line in the two lists is a "- " line, or under a lore line its
// source. Anything else would be read as nothing, and silently.
const body = (LINES || '').replace(/<!--[\s\S]*?-->/g, '');
let section = null, after = false;
const odd = [];
body.split('\n').forEach(function (l, i) {
  const head = /^##\s+(.*)$/.exec(l);
  if (head) { section = head[1].trim(); after = false; return; }
  if (!section || !l.trim()) return;
  if (/^- \S/.test(l)) { after = section === 'Lore lines'; return; }
  if (after && /^ {2}\S/.test(l)) { after = false; return; }
  odd.push((i + 1) + ' ' + l.trim());
});
yes('only the two lists, Hints and Lore lines', /^## Hints$/m.test(body) && /^## Lore lines$/m.test(body) &&
    (body.match(/^## /gm) || []).length === 2);
yes('every line in them is a line, or the source under a lore line' + (odd.length ? ' (' + odd.join(' | ') + ')' : ''),
    odd.length === 0);
yes('every lore line names its source', parsed.lore.every((x) => x.from));

const EMDASH = String.fromCharCode(0x2014);
const all = parsed.hints.concat(parsed.lore.map((x) => x.text));
const bad = function (why, test) {
  const hits = all.filter(test);
  yes('no line ' + why + (hits.length ? ' (' + hits.join(' | ') + ')' : ''), hits.length === 0);
};
bad('is over 128 characters, the most a Discord status holds', (s) => s.length > 128);
bad('carries markdown or HTML, which a status and a loading screen show as it is', (s) => /[*_`<>\[\]]/.test(s));
bad('has an em dash', (s) => s.indexOf(EMDASH) >= 0);
bad('says player', (s) => /\bplayers?\b/i.test(s));
bad('ends without a full stop, a question mark or an exclamation mark', (s) => !/[.?!]$/.test(s));
bad('is there twice', (s) => all.indexOf(s) !== all.lastIndexOf(s));

// The quotes, word for word in their source.
const world = read('site/data/site/world.md') || '';
const factions = read('lore/factions.md') || '';
const account = world.split("<a id='accord'>")[0];
function article(name) {
  const at = world.indexOf('## Article the ' + name + ':');
  if (at < 0) return null;
  const next = world.indexOf('\n## ', at + 1);
  return world.slice(at, next < 0 ? world.length : next);
}
parsed.lore.forEach(function (x) {
  let where = null;
  if (x.from === 'Fifty Years of a Free Skyrim') where = account;
  else if (x.from === 'The Factions of Skyrim') where = factions;
  else {
    const m = /^The White Harbour Accord, Article the (\w+)$/.exec(x.from);
    if (m) where = article(m[1]);
  }
  yes('"' + x.text.slice(0, 40) + '..." is word for word in ' + x.from,
      where !== null && flat(where).indexOf(flat(x.text)) >= 0);
});

// ------------------------------------------------------------ the site --
const home = read('site/public/home.html') || '';
const EMPTY = '<blockquote class="chron" id="loreLine" hidden></blockquote>';
yes('home.html has the one empty lore quote the site fills', home.split(EMPTY).length === 2);
yes('and no lore quote of its own', (home.match(/<blockquote class="chron"/g) || []).length === 1);
const shown = lib.fillLoreLine(home, parsed.lore, 0);
const first = parsed.lore[0] || { text: '', from: '' };
yes('fillLoreLine puts the picked line in, shown, with its source',
    shown.indexOf('<blockquote class="chron" id="loreLine">' + first.text + '<cite>' + first.from + '</cite></blockquote>') >= 0);
const last = parsed.lore[parsed.lore.length - 1] || { text: '' };
yes('a pick just under 1 is the last line', lib.fillLoreLine(home, parsed.lore, 0.9999).indexOf(last.text + '<cite>') >= 0);
yes('no lore lines: the quote stays empty and hidden', lib.fillLoreLine(home, [], 0.5) === home);
yes('a line is put in as text, not HTML',
    lib.fillLoreLine(EMPTY, [{ text: '<b>&</b>', from: 'x"y' }], 0) ===
    '<blockquote class="chron" id="loreLine">&lt;b&gt;&amp;&lt;/b&gt;<cite>x&quot;y</cite></blockquote>');
yes('the site fills it on the pages it serves', /html = fillLoreLine\(html, readLines\(\)\.lore, Math\.random\(\)\);/.test(src));
yes('and hands every line out in /api/public', /lines: readLines\(\)/.test(src));

// ------------------------------------------------------------- the bot --
const bot = read('bot/bot.py') || '';
yes('bot.py starts watch_lines when it comes up', /asyncio\.create_task\(watch_lines\(\)\)/.test(bot));
yes('and reads the lines from /api/public', /def site_lines\(\):[\s\S]*?SITE \+ '\/api\/public'[\s\S]*?\.get\('lines'\)/.test(bot));
const kept = all.filter((s) => bot.indexOf(s) >= 0 || home.indexOf(s) >= 0);
yes('neither bot.py nor home.html keeps a copy of a line' + (kept.length ? ' (' + kept.join(' | ') + ')' : ''),
    kept.length === 0);

const py = require('../../tests/bot-python').find();
if (!py.cmd) console.log('SKIP  the bot half: no Python here loads the bot (' + py.why + ')');
else {
  const probe = [
    'import sys, json',
    'sys.path.insert(0, sys.argv[1])',
    'import bot',
    'got = json.loads(sys.stdin.read())',
    'print(json.dumps({',
    '  "lines": bot.status_lines(got),',
    '  "odd": bot.status_lines({"hints": ["A.", 3, ""], "lore": [{"text": "Q."}, "x", {"from": "y"}]}),',
    '  "none": bot.status_lines(None),',
    '  "every": bot.LINES_EVERY}))'
  ].join('\n');
  const r = spawnSync(py.cmd, py.args.concat(['-c', probe, path.join(ROOT, 'bot')]), {
    input: JSON.stringify(parsed), encoding: 'utf8',
    env: Object.assign({}, process.env, { DISCORD_TOKEN: 'not-a-real-token', PYTHONDONTWRITEBYTECODE: '1',
                                          PYTHONIOENCODING: 'utf-8' })
  });
  let out = null;
  try { out = JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch (e) { out = null; }
  yes('the bot loads and answers', !!out);
  if (!out) console.log(String(r.stderr).split('\n').slice(-8).join('\n'));
  else {
    yes('the status steps through every hint and every lore quote',
        out.lines.length === all.length && all.every((s) => out.lines.indexOf(s) >= 0));
    yes('a hint, then a lore line, in turn',
        out.lines[0] === parsed.hints[0] && out.lines[1] === parsed.lore[0].text &&
        out.lines[2] === parsed.hints[1] && out.lines[3] === parsed.lore[1].text);
    yes('what is not a line is passed over', JSON.stringify(out.odd) === JSON.stringify(['A.', 'Q.']));
    yes('nothing handed out is no lines', out.none.length === 0);
    yes('a new line every fifteen minutes, as lines.md says', out.every === 900 && /every fifteen minutes/.test(LINES || ''));
  }
}

// --------------------------------------------------- a copy of the site --
function freePort() {
  return new Promise(function (ok, no) {
    const s = net.createServer();
    s.on('error', no);
    s.listen(0, '127.0.0.1', function () { const p = s.address().port; s.close(function () { ok(p); }); });
  });
}
function ask(port, route) {
  return new Promise(function (ok) {
    const req = http.request({ host: '127.0.0.1', port: port, method: 'GET', path: route, agent: false }, function (res) {
      const parts = [];
      res.on('data', function (d) { parts.push(d); });
      res.on('end', function () { ok({ status: res.statusCode, body: Buffer.concat(parts).toString('utf8') }); });
    });
    req.on('error', function (e) { ok({ status: 0, body: '', error: e.message }); });
    req.setTimeout(10000, function () { req.destroy(new Error('no answer in ten seconds')); });
    req.end();
  });
}
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const a = path.join(from, f);
    if (fs.statSync(a).isFile()) fs.copyFileSync(a, path.join(to, f));
  }
}

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-3147-'));
  let child = null, out = '', exited = false;
  try {
    siteFiles.copy(dir);
    copyTree(path.join(APP, 'public'), path.join(dir, 'public'));
    copyTree(path.join(APP, 'data', 'site'), path.join(dir, 'data', 'site'));
    fs.copyFileSync(path.join(APP, 'config.example.json'), path.join(dir, 'config.json'));
    const port = await freePort();
    child = spawn(process.execPath, ['server.js'], {
      cwd: dir,
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1',
                                            THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
    });
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { out += d; });
    child.on('exit', function () { exited = true; });
    const end = Date.now() + 10000;
    while (Date.now() < end && out.indexOf('listening on ') < 0 && !exited) await new Promise((ok) => setTimeout(ok, 20));
    yes('a copy of the site comes up', out.indexOf('listening on ') >= 0 && !exited);
    if (exited || out.indexOf('listening on ') < 0) { console.log(out.split('\n').slice(-12).join('\n')); return; }

    const front = await ask(port, '/');
    const q = /<blockquote class="chron" id="loreLine">([\s\S]*?)<cite>([\s\S]*?)<\/cite><\/blockquote>/.exec(front.body);
    yes('the front page shows a lore line, with its source',
        !!q && parsed.lore.some((x) => x.text === q[1].replace(/&#39;|&apos;/g, "'") && x.from === q[2]));
    const api = await ask(port, '/api/public');
    let lines = null;
    try { lines = JSON.parse(api.body).lines; } catch (e) { lines = null; }
    yes('/api/public hands out every line in the file', JSON.stringify(lines) === JSON.stringify(parsed));

    fs.unlinkSync(path.join(dir, 'data', 'site', 'lines.md'));
    const gone = await ask(port, '/');
    yes('with no lines.md the front page still comes, its quote empty and hidden',
        gone.status === 200 && gone.body.indexOf(EMPTY) >= 0);
    yes('and the site says why in its log', /could not read data\/site\/lines\.md/.test(out));
  } finally {
    if (child && !exited) {
      await new Promise(function (ok) { child.once('exit', ok); try { child.kill(); } catch (e) { ok(); } setTimeout(ok, 3000); });
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('left ' + dir + ': ' + e.message); }
    console.log('');
    console.log(pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail ? 1 : 0;
  }
})();
