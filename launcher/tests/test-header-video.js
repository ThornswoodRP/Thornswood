/*
  test-header-video.js

  The moving strip behind the title on the Play page stops while the game runs.

  WHY THIS EXISTS. To Do List entry 195. StartHeaderVideo in Shell.cs plays the
  video only while somebody can see it, and until 24 September "see it" meant
  the Play page is showing and the window is not minimised. The entry says what
  that missed: "with Keep Launcher Open on, the launcher is not minimised while
  the game runs, so the video keeps playing behind the game and nothing pauses
  it". The music (MusicDecide) has always stopped while the game runs. Playing,
  the video measured 3 to 14% of one core.

  The launcher cannot be started from here (the ops repo's CLAUDE.md), so this does two things:

    - It lifts the video's own decide delegate out of Shell.cs as it is written
      and runs it against a stand-in window and page and the signal the
      decoding thread waits on (seenNow): a game start and a game close with
      the window up, minimising and restoring while the game runs, a launcher
      opened on a game already running, and the old cases (another page,
      minimised) so they still behave as Djinn measured them.
    - It reads the source for the wiring: the decoding thread waits on that
      signal before it decodes the next frame, so a stopped video carries on
      from the frame it stopped on; every place that changes playing once the
      window is up tells the video straight after, and the one at startup runs
      before the window is shown.

  Read only. It reads launcher\app\*.cs and nothing else.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

const APP = path.join(REPO_DIR, 'launcher', 'app');
const CR = String.fromCharCode(13);
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8').split(CR).join(''); }
const SHELL = read('Shell.cs');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

/* From the opening brace at or after `from` to its matching closing brace. */
function braces(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return { open: open, close: i, inner: src.slice(open + 1, i) }; }
  }
  return null;
}
function method(src, signature) {
  const at = src.indexOf(signature);
  if (at < 0) return '';
  const b = braces(src, at);
  return b ? src.slice(at, b.close + 1) : '';
}

// ---- the video's decide, lifted and run ---------------------------------------
const start = method(SHELL, 'static void StartHeaderVideo()');
yes('StartHeaderVideo is in Shell.cs', start.length > 0);
if (!start) done();

const decideAt = start.indexOf('Action decide = delegate');
yes('StartHeaderVideo still has its decide delegate', decideAt > 0);
if (decideAt < 0) done();
const decideSrc = braces(start, decideAt).inner;

// C# to JavaScript, for this one delegate only. It is a few lines of
// conditions and calls, so the handful of C# spellings it uses are swapped
// for JavaScript ones and the rest runs as it is.
const decideJs = decideSrc
  .replace(/\bbool\s+(\w+)\s*=/g, 'var $1 =');
let decideFn = null;
try {
  // `with` so that the delegate's own names (page, win, seenNow, playing,
  // gone) read and write the stand-in's fields, as the C# closure does.
  decideFn = new Function('env', 'with (env) {' + decideJs + '\n}');
} catch (e) {
  console.log('      ' + e.message);
}
yes('the decide delegate reads as a function the stand-ins can run', decideFn !== null);
if (!decideFn) done();

/* A stand-in for seenNow, the ManualResetEventSlim the decoding thread waits
   on: set, the thread decodes and puts up frames; reset, it waits on the frame
   it is at. */
function makeSignal() {
  const s = { IsSet: false, calls: [] };
  s.Set = function () { s.IsSet = true; s.calls.push('Set'); };
  s.Reset = function () { s.IsSet = false; s.calls.push('Reset'); };
  return s;
}
function makeWorld(o) {
  o = o || {};
  const env = {
    gone: false,
    seenNow: makeSignal(),
    playing: !!o.playing,
    page: { IsVisible: o.visible !== false },
    win: { IsVisible: o.shown !== false, WindowState: o.minimised ? 'Minimized' : 'Normal' },
    WindowState: { Minimized: 'Minimized', Normal: 'Normal', Maximized: 'Maximized' }
  };
  env.decide = function () { decideFn(env); };
  return env;
}
function runs(env) { return env.seenNow.IsSet; }

let threw = null;
try {
  // A game started with Keep Launcher Open ticked: the window stays up and the
  // Play page stays on it.
  let w = makeWorld();
  w.decide();
  yes('before the game, with the Play page up, the video plays', runs(w));
  w.playing = true; w.decide();
  yes('the game starts with the window still up: the video stops', !runs(w));
  w.win.WindowState = 'Minimized'; w.decide();
  w.win.WindowState = 'Normal'; w.decide();
  yes('minimising and restoring while the game runs does not start it', !runs(w));
  w.page.IsVisible = false; w.decide();
  w.page.IsVisible = true; w.decide();
  yes('another page and back while the game runs does not start it', !runs(w));
  w.playing = false; w.decide();
  yes('the game closes: the video plays again', runs(w));

  // Keep Launcher Open off: Play minimises the window after the start. The
  // game ends while it is still minimised, and restoring it is what resumes.
  w = makeWorld();
  w.decide();
  w.playing = true; w.decide();
  w.win.WindowState = 'Minimized'; w.decide();
  yes('the game starts and the window is minimised: stopped', !runs(w));
  w.playing = false; w.decide();
  yes('the game closes while minimised: still stopped', !runs(w));
  w.win.WindowState = 'Normal'; w.decide();
  yes('the window comes back: it plays', runs(w));

  // A launcher opened while the game is already running. The first decide
  // runs before the window is shown; showing the window (its Opened event) is
  // the next decide, and the game is still up.
  w = makeWorld({ shown: false });
  w.decide();
  yes('before the window is shown, the video is stopped', !runs(w));
  w.playing = true;
  w.win.IsVisible = true; w.decide();
  yes('a launcher opened on a running game shows its window with the video stopped', !runs(w));
  w.playing = false; w.decide();
  yes('and the video starts when that game closes', runs(w));

  // What Djinn measured stays as it was.
  w = makeWorld();
  w.decide();
  w.page.IsVisible = false; w.decide();
  yes('another page, no game: stopped, as before', !runs(w));
  w.page.IsVisible = true; w.decide();
  yes('back on the Play page: plays again, as before', runs(w));
  w.win.WindowState = 'Minimized'; w.decide();
  yes('minimised, no game: stopped, as before', !runs(w));
  w.win.WindowState = 'Maximized'; w.decide();
  yes('maximised counts as seen, as before', runs(w));
  w.decide(); w.decide();
  yes('deciding twice in the same state changes nothing', runs(w));
  w.win.WindowState = 'Minimized'; w.decide(); w.decide();
  yes('nor twice while stopped', !runs(w));

  // A video that failed to play is left alone, game or no game.
  w = makeWorld();
  w.gone = true;
  w.playing = true; w.decide();
  w.playing = false; w.decide();
  yes('once the video has been dropped, deciding does nothing', w.seenNow.calls.length === 0);
} catch (e) {
  threw = e;
}
yes('the lifted decide ran without an error' + (threw ? ' (' + threw.message + ')' : ''), threw === null);

// ---- the wiring -----------------------------------------------------------------
yes('headerVideoDecide is a field that does nothing until the video starts, so a call can never throw',
    /\bstatic Action headerVideoDecide = delegate \{ \};/.test(SHELL));
// The thread waits on seenNow before it decodes the next frame, and takes its
// clock from then, so a stopped video carries on from the frame it stopped on
// at its own speed, not from the start and not racing to catch up.
const wait = start.indexOf('if (!seenNow.IsSet) { seenNow.Wait(); due = clock.Elapsed; }');
yes('the decoding thread waits while nobody can see the strip, then carries on from the same frame',
    wait > 0 && start.indexOf('frames.Next()', wait) > wait);
const handOver = start.indexOf('headerVideoDecide = decide;');
const lastWire = start.indexOf('if (e.Property == Visual.IsVisibleProperty) decide();');
yes('StartHeaderVideo hands its decide over', handOver > 0);
yes('only once the video is set up and wired to the window and the page',
    handOver > 0 && lastWire > 0 && handOver > lastWire);
yes('the window being minimised still decides', start.indexOf('win.StateChanged += delegate { decide(); };') > 0);
yes('and so does the window being shown', start.indexOf('win.Opened += delegate { decide(); };') > 0);

// Every assignment to playing in the Shell class, whichever file it is in.
const shellFiles = fs.readdirSync(APP).filter(function (f) {
  return f.endsWith('.cs') && (f === 'Shell.cs' || /\bpartial class Shell\b/.test(read(f)));
});
yes('the Shell class is found in more than one file, and all of them are read', shellFiles.length > 1);

const runBody = method(SHELL, 'static void Run(string[] args)');
const shown = runBody.indexOf('win.Show();');
let assignments = 0;
for (const f of shellFiles) {
  const lines = read(f).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    const m = /(^|[^.\w])playing\s*=(?!=)\s*([^;]+);/.exec(line);
    if (!m) continue;
    assignments++;
    const where = f + ':' + (i + 1) + ' playing = ' + m[2].trim();
    if (m[2].trim() === 'true' || m[2].trim() === 'false') {
      // Straight after, in the same block, before anything can return.
      const indent = line.length - line.trimStart().length;
      let told = false;
      for (let k = i + 1; k < lines.length && k <= i + 3; k++) {
        const next = lines[k];
        if (next.trim() === '') continue;
        if (next.length - next.trimStart().length < indent) break;
        if (/\breturn\b/.test(next)) break;
        if (next.trim() === 'headerVideoDecide();') { told = true; break; }
      }
      yes(where + ' tells the video straight after', told);
    } else if (f === 'Shell.cs' && m[2].trim() === 'Checks.GameRunning()') {
      // The launcher opened on a game already running. The window is shown by
      // win.Show, and its Opened event is the decide that counts.
      const inRun = runBody.indexOf(line.trim());
      yes(where + ' is in Run, before the window is shown', inRun > 0 && shown > 0 && inRun < shown);
      yes('and the video cannot play before the window is shown, because it needs the window visible',
          /bool seen = win\.IsVisible && page\.IsVisible\b/.test(decideSrc));
    } else if (m[2].trim() === 'Checks.GameRunning()') {
      // The same check in another way in, such as OpenForUninstall in
      // ShellUninstall.cs (pull request 270): it has to come before that
      // method shows the window with its own win.Show, for the same reason.
      let runAt = -1;
      for (let k = i + 1; k < lines.length; k++) {
        if (/^\s*(public |private |internal )?static\s+\w[\w<>\[\]]*\s+\w+\s*\(/.test(lines[k])) break;
        if (lines[k].indexOf('win.Show();') >= 0) { runAt = k; break; }
      }
      yes(where + ' comes before its own method shows the window', runAt > i);
    } else {
      yes(where + ' is an assignment this harness does not know: tell the video after it and add it here', false);
    }
  }
}
yes('the four places that change playing are all found (' + assignments + ')', assignments >= 4);

// The music has the same rule, and the video now reads the same flag.
yes('the music still stops while the game runs', /bool want = [^;]*!playing/.test(method(SHELL, 'static void MusicDecide()')));
yes('the video reads the same flag the music does', /bool seen = [^;]*!playing/.test(decideSrc));

done();
