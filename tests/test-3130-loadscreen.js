'use strict';
// test-3130-loadscreen.js
//
//     node tests\test-3130-loadscreen.js
//
// #3130: the in-game loading screen is Thornswood's animated backdrop and one
// of its own hints, with no still first. The engine tells the page the moment
// the game's Loading Menu opens and closes (ThornswoodRP/skymp,
// LoadingScreen.h: window event 'skyrimPlatform:loading' with detail.loading,
// and window.skyrimPlatformLoading) and draws the page while it is open. This
// holds the page's half:
//
//   1. The page. index.html loads thornswood-hints.js and
//      thornswood-loadscreen.js from its start, after the choice, because the
//      plugins hear of a load only after it.
//   2. The screen. thornswood-loadscreen.js in a vm with a stand-in page: the
//      loop loaded and paused before any load, no still picture anywhere, up
//      on the event with a hint from window.THORNSWOOD_HINTS, never the same
//      hint twice running, down on the event, the loop paused, the times sent
//      to the plugin, up at once for a page that comes up mid load, the mp4
//      when the webm will not play, and not over the character choice while
//      it is up, then up when it goes.
//   3. The hints. Go.ps1's Write-ThornswoodHints, lifted out with
//      PowerShell's own parser and run on site\data\site\lines.md (with pwsh;
//      a SKIP line without it): the file it writes holds exactly the hints
//      site\server.js's parseLines reads, as ASCII with CRLF, the same bytes
//      on a second run, and Go.ps1 writes it in the overlays section and
//      Remove-RetiredOverlays keeps it.
//   4. The record. thornswood-front.js logs the screen's 'load:' lines.
//
// Read only apart from its own temp folder. Nothing connects to anything.
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { spawnSync } = require('child_process');
const siteFiles = require('./site-files');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// ------------------------------------------------------------- the page --
const page = read('game/ui/index.html');
const at = (s) => page.indexOf('<script src="' + s + '"></script>');
yes('index.html loads the hints and the loading screen', at('thornswood-hints.js') > 0 && at('thornswood-loadscreen.js') > 0);
yes('the hints before the screen, and both after the choice',
  at('thornswood-select.js') > 0 && at('thornswood-hints.js') > at('thornswood-select.js') &&
  at('thornswood-loadscreen.js') > at('thornswood-hints.js'));
yes('the plugin does not inject the loading screen as well (it is in the page from its start)',
  !/OVERLAYS\s*=\s*\[[^\]]*thornswood-loadscreen\.js/.test(read('game/plugins/thornswood-front.js')));

// ----------------------------------------------------------- the screen --
const SCREEN = read('game/ui/thornswood-loadscreen.js');
yes('the screen names no still picture', !/\.jpg|\.png|\.webp|backgroundImage|poster/.test(SCREEN));

function stage(opts) {
  opts = opts || {};
  const sent = [], listeners = {}, observers = [];
  const byId = {};
  function el(tag) {
    const e = {
      tagName: String(tag).toUpperCase(), children: [], parentNode: null, style: {}, attrs: {},
      className: '', textContent: '', id: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) {
        if (c.parentNode) { const i = c.parentNode.children.indexOf(c); if (i >= 0) c.parentNode.children.splice(i, 1); }
        c.parentNode = this; this.children.push(c);
        if (c.id) byId[c.id] = c;
        return c;
      },
      remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
    };
    if (e.tagName === 'VIDEO') {
      e.currentTime = 0; e.duration = 24; e.paused = true; e.plays = 0; e.src = '';
      e.play = function () { this.paused = false; this.plays++; return { catch() { } }; };
      e.pause = function () { this.paused = true; };
    }
    return e;
  }
  const body = el('body'), head = el('head');
  const document = {
    body, head, documentElement: el('html'),
    createElement: el,
    getElementById(id) { const e = byId[id]; return e && e.parentNode ? e : null; },
    addEventListener() { }
  };
  if (opts.choice) {
    const s = el('div'); s.id = 'ts-select'; s.className = opts.choice === 'gone' ? 'gone' : '';
    body.appendChild(s);
  }
  const window = {
    THORNSWOOD_HINTS: opts.hints || ['Hint one.', 'Hint two.', 'Hint three.'],
    skyrimPlatformLoading: opts.loading,
    skyrimPlatform: { sendMessage(to, what) { sent.push([to, what]); } },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  };
  let clock = 1000;
  const box = {
    window, document,
    Date: { now: () => clock },
    Math: opts.random ? Object.assign(Object.create(Math), { random: opts.random }) : Math,
    MutationObserver: function (fn) { this.observe = (t, o) => observers.push({ t, o, fn }); }
  };
  vm.createContext(box);
  vm.runInContext(SCREEN, box);
  const root = () => document.getElementById('ts-load');
  const video = () => { const r = root(); return r && r.children.find((c) => c.tagName === 'VIDEO'); };
  const hint = () => { const r = root(); const h = r && r.children.find((c) => c.className === 'hint'); return h ? h.textContent : null; };
  return {
    window, document, sent, root, video, hint, body,
    tick(ms) { clock += ms; },
    loading(v) { window.skyrimPlatformLoading = v; (listeners['skyrimPlatform:loading'] || []).forEach((fn) => fn({ detail: { loading: v } })); },
    choiceGoes() { const s = document.getElementById('ts-select'); s.className = 'gone'; observers.forEach((w) => w.fn([])); },
    up() { const r = root(); return !!(r && r.className === 'up'); }
  };
}

{
  const s = stage();
  yes('the screen is in the page before any load, and down', !!s.root() && !s.up());
  yes('the loop is loaded before any load: thornswood-menu.webm, preload auto, muted, looping, paused',
    !!s.video() && s.video().src === 'thornswood-menu.webm' && s.video().preload === 'auto' &&
    s.video().muted === true && s.video().loop === true && s.video().paused === true);
  yes('it takes no clicks and sits over every overlay', /pointer-events:none/.test(SCREEN) && /z-index:2147483647/.test(SCREEN));
  yes('nothing is said to the plugin before a load', s.sent.length === 0);

  s.loading(true);
  yes('up when the load starts', s.up());
  yes('the loop plays', s.video().paused === false && s.video().plays === 1);
  yes('with a hint from THORNSWOOD_HINTS', ['Hint one.', 'Hint two.', 'Hint three.'].indexOf(s.hint()) >= 0);
  yes('and is the last thing in the page, over overlays of the same z-index', s.body.children[s.body.children.length - 1] === s.root());
  yes('the plugin is told it went up, by the page clock',
    s.sent.length === 1 && s.sent[0][0] === 'thornswood-front' && s.sent[0][1] === 'load:up at 1000');

  const first = s.hint();
  s.tick(1580); s.video().currentTime = 1.55;
  s.loading(false);
  yes('down when the load ends', !s.up());
  yes('the loop is paused', s.video().paused === true);
  yes('the plugin is told how long it was up and how far the loop played',
    s.sent.length === 2 && s.sent[1][1] === 'load:down at 2580, up 1580 ms, the loop played 1.55 s');

  s.loading(true);
  yes('the next load has another hint', s.up() && s.hint() !== first);
  s.loading(true);
  yes('a second open while up changes nothing', s.sent.length === 3 && s.video().plays === 2);
  s.loading(false);
  s.loading(false);
  yes('a second close while down says nothing', s.sent.length === 4);
}

{
  // Math.random always the same: the next hint along, not the same one.
  const s = stage({ random: () => 0 });
  s.loading(true); const a = s.hint(); s.loading(false);
  s.loading(true); const b = s.hint(); s.loading(false);
  yes('never the same hint twice running, even when the pick repeats', a === 'Hint one.' && b === 'Hint two.');
}

{
  const s = stage({ loading: true });
  yes('a page that comes up mid load is up at once', s.up());
}

{
  const s = stage({ hints: [] });
  s.loading(true);
  yes('with no hints, still up, with no hint line', s.up() && s.hint() === '' && /\.hint:empty\{display:none\}/.test(SCREEN));
}

{
  const s = stage();
  s.video().onerror();
  yes('the mp4 when the webm will not play', s.video().src === 'thornswood-menu.mp4');
  s.video().onerror();
  yes('with neither, the loop is taken out and the plugin told', !s.video() && /no loop plays here/.test(s.sent.map((x) => x[1]).join('|')));
  s.loading(true);
  yes('and the screen still comes up, dark, with its hint', s.up() && !!s.hint());
}

{
  const s = stage({ choice: 'up' });
  s.loading(true);
  yes('not over the character choice while it is up', !s.up());
  s.choiceGoes();
  yes('up when the choice goes and the load is still on', s.up());
}

{
  const s = stage({ choice: 'up' });
  s.loading(true); s.loading(false);
  s.choiceGoes();
  yes('not when the choice goes after the load ended', !s.up());
}

{
  const s = stage({ choice: 'gone' });
  s.loading(true);
  yes('up over a choice that is gone', s.up());
}

// ------------------------------------------------------------ the hints --
const go = path.join(ROOT, 'scripts', 'release', 'Go.ps1');
const goText = read('scripts/release/Go.ps1');
const overlays = goText.indexOf("foreach ($f in Get-ChildItem -LiteralPath $uiSrc -Filter *.js)");
const call = goText.indexOf('Write-ThornswoodHints $linesMd $hintsJs');
yes('Go.ps1 writes the hints in the overlays section', overlays > 0 && call > overlays);
yes('from site\\data\\site\\lines.md, as Data\\Platform\\UI\\thornswood-hints.js, listed as installed',
  /\$linesMd = Join-Path \$Here '\.\.\\\.\.\\site\\data\\site\\lines\.md'/.test(goText) &&
  /\$hintsJs = Join-Path \$ui 'thornswood-hints\.js'/.test(goText) &&
  /\$script:installed\.Add\(\$hintsJs\)/.test(goText));
yes('no hints or no file fails the run', /Gone 'site\\data\\site\\lines\.md has no hints/.test(goText) &&
  /Gone 'site\\data\\site\\lines\.md is not there/.test(goText));
const retired = /function Remove-RetiredOverlays[\s\S]*?\n}\n/.exec(goText);
yes('Remove-RetiredOverlays keeps it', !!retired && /\$have \+= 'thornswood-hints\.js'/.test(retired[0]));

const cut = /\/\/ ==== thornswood lines ====([\s\S]*?)\/\/ ==== end thornswood lines ====/.exec(siteFiles.source());
const parseLines = cut ? new Function(cut[1] + '\nreturn parseLines;')() : null;
yes('site\\server.js has parseLines', !!parseLines);
const want = parseLines ? parseLines(read('site/data/site/lines.md')).hints : [];

const pwsh = spawnSync(process.platform === 'win32' ? 'pwsh.exe' : 'pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
if (pwsh.error || pwsh.status !== 0) {
  console.log('SKIP  Write-ThornswoodHints: no pwsh here');
} else {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-3130-'));
  try {
    const out = path.join(work, 'UI', 'thornswood-hints.js');
    const lines = path.join(ROOT, 'site', 'data', 'site', 'lines.md');
    const ps = [
      '$ErrorActionPreference = "Stop"',
      '$t = $null; $e = $null',
      '$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:GO, [ref]$t, [ref]$e)',
      'if ($e.Count) { throw "Go.ps1 does not parse" }',
      '$f = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq "Write-ThornswoodHints" }, $true) | Select-Object -First 1',
      'if (-not $f) { throw "no Write-ThornswoodHints" }',
      '. ([ScriptBlock]::Create($f.Extent.Text))',
      'Write-ThornswoodHints $env:LINES $env:OUT'
    ].join('\n');
    const run = (o) => spawnSync('pwsh', ['-NoProfile', '-Command', ps], { encoding: 'utf8', env: Object.assign({}, process.env, { GO: go, LINES: lines, OUT: o }) });
    const r1 = run(out);
    yes('Write-ThornswoodHints runs', r1.status === 0);
    if (r1.status !== 0) process.stdout.write(r1.stdout + r1.stderr);
    yes('and says how many it wrote (' + want.length + ')', String(r1.stdout).trim() === String(want.length));
    const bytes = fs.existsSync(out) ? fs.readFileSync(out) : Buffer.alloc(0);
    yes('the file is ASCII', bytes.length > 0 && bytes.every((b) => b < 0x80));
    const text = bytes.toString('latin1');
    yes('with CRLF line ends only', /\r\n/.test(text) && !/[^\r]\n/.test(text));
    const box = { window: {} };
    let ran = true;
    try { vm.createContext(box); vm.runInContext(text, box); } catch (e) { ran = false; }
    yes('it runs as a script and sets window.THORNSWOOD_HINTS', ran && Array.isArray(box.window.THORNSWOOD_HINTS));
    yes('holding exactly the hints parseLines reads', ran && JSON.stringify(box.window.THORNSWOOD_HINTS) === JSON.stringify(want));
    const out2 = path.join(work, 'again', 'thornswood-hints.js');
    run(out2);
    yes('the same bytes on a second run', fs.existsSync(out2) && Buffer.compare(fs.readFileSync(out2), bytes) === 0);

    // Quotes, backslashes and anything outside ASCII, which lines.md does not
    // hold today and a hint may one day.
    const odd = path.join(work, 'odd.md');
    fs.writeFileSync(odd, '# x\n\n<!-- - not a hint -->\n## Hints\n\n- Say "hello" to C:\\Thornswood.\n- Caf\u00e9 and \u2603.\n\n## Lore lines\n\n- Not a hint.\n  Its source\n');
    const out3 = path.join(work, 'odd', 'thornswood-hints.js');
    const r3 = spawnSync('pwsh', ['-NoProfile', '-Command', ps], { encoding: 'utf8', env: Object.assign({}, process.env, { GO: go, LINES: odd, OUT: out3 }) });
    const box3 = { window: {} };
    try { vm.createContext(box3); vm.runInContext(fs.readFileSync(out3, 'latin1'), box3); } catch (e) { }
    yes('quotes, backslashes and other letters come through, and only the Hints list',
      r3.status === 0 && JSON.stringify(box3.window.THORNSWOOD_HINTS) === JSON.stringify(['Say "hello" to C:\\Thornswood.', 'Caf\u00e9 and \u2603.']));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ----------------------------------------------------------- the record --
const front = read('game/plugins/thornswood-front.js');
yes("thornswood-front.js logs the screen's load: lines",
  /if \(what\.indexOf\('load:'\) === 0\) \{[^}]*log\('loading screen:', what\.slice\(5\)\)/.test(front));

done();
