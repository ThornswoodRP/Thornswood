/*
  test-uninstall-entry.js

      node tests/test-uninstall-entry.js

  What the launcher does when Windows Settings opens it to uninstall.

  WHY THIS EXISTS. Uninstall under Installed apps runs the launcher with
  -uninstall; Register.cs writes that command. Until 24 September the switch
  changed one thing, the page the window opened on, and everything else ran as
  if somebody had opened the launcher to play: the update check, the server
  scan and ping, the client repair, voice, the Installed apps entry written
  again, the last session's logs sent, the game's INI files corrected, the own
  game folder offered or brought up to date, and the theme playing. The To Do
  List put it as "Somebody who pressed Uninstall in Windows Settings should not
  watch a launcher start up and check for updates".

  None of that can be watched from here, because a Claude does not start the
  launcher. So this reads the C# and walks it. Starting at Run, it follows
  every call a launcher opened with -uninstall makes before its window's
  message loop starts, into every method of the Shell partial class, taking
  the askedToUninstall branches the way that launcher would, and fails if any
  of the startup work can be reached. Event handlers are left out, because
  they run when something happens: anything after +=, a handler given to
  AddHandler, and what OnceOnScreen keeps for the window's first showing. The
  two that fire on their own, the two second timer and the first draw, are
  checked by name. A method handed to the dispatcher as new Action(Name) does
  run, so it is walked. The same walk with the switch off must still reach
  all of it, so a normal start has not lost anything.

  It also holds what must not move: the uninstall still asks both questions,
  still puts the Windows Skyrim folders back before it deletes anything, and
  the command Windows runs is still the exe with -root and -uninstall.

  ONE THING IT USED TO GET WRONG, fixed here rather than in the launcher,
  because the launcher was right and this file was behind. The theme was read
  as `music.Open(...)`, the WPF MediaPlayer. That failed on the ship PC with
  "Windows Media Player version 10 or later is required", so the theme moved
  to MenuMusic, the WebView2 page, and StartMenuMusic calls MenuMusic.Start
  instead (#697). The old regex then matched nothing in either walk: the line
  holding a normal start to the theme failed, and the line keeping the theme
  out of an uninstall passed with nothing left to check. Both read MenuMusic
  now, so both mean what they say again. Since #3207 the theme plays from
  the launcher's own process (MenuMusic, NLayer), still through
  MenuMusic.Start.

  Read only. Give it a folder to read another copy of launcher\app, which is how
  it was shown to fail on the code before the change:

      node tests/test-uninstall-entry.js <folder>
*/
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');

const APP = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPO_DIR, 'launcher', 'app');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function read(name) {
  try { return fs.readFileSync(path.join(APP, name), 'utf8'); } catch (e) { return null; }
}

/*
  Comments and the insides of strings and chars blanked with spaces, so a
  brace or a method name in either cannot be read as code. The same length
  as the source, so a position in one is the same position in the other and
  a method found in the clean text can be read back with its strings.
*/
function clean(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  const blank = function (from, to) { for (let k = from; k < to && k < n; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const s = i; while (i < n && src[i] !== '\n') i++; blank(s, i); continue; }
    if (c === '/' && d === '*') { const s = i; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; blank(s, i); continue; }
    if (c === '@' && d === '"') {
      i += 2; const s = i;
      while (i < n) { if (src[i] === '"' && src[i + 1] === '"') { i += 2; continue; } if (src[i] === '"') break; i++; }
      blank(s, i); i++; continue;
    }
    if (c === '"' || c === '\'') {
      i++; const s = i;
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      blank(s, i); i++; continue;
    }
    i++;
  }
  return out.join('');
}

function closeOf(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Every static method in the given source: name, clean body, raw body. An
// overload adds its body to the same name, which is what a walk wants.
function methodsOf(raw, into) {
  const code = clean(raw);
  const re = /\bstatic\s+[\w.<>\[\], ]+?\s(\w+)(?:<\w+>)?\s*\([^()]*\)\s*(?:where\s+\w+\s*:\s*\w+\s*)?\{/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(code, open);
    if (close < 0) continue;
    const name = m[1];
    const prev = into[name] || { code: '', raw: '' };
    into[name] = {
      code: prev.code + '\n' + code.slice(open + 1, close),
      raw: prev.raw + '\n' + raw.slice(open + 1, close)
    };
    re.lastIndex = close + 1;
  }
  return into;
}

/*
  Handlers out. "x += delegate (...) { ... }" and the lambda forms run when
  something happens, not on the way in, so they are not part of the walk.
  So does a delegate given to AddHandler (Avalonia's routed events) and the
  one OnceOnScreen keeps until the window is first shown.
  A delegate handed to ThreadPool or the dispatcher does run, and stays.
*/
function withoutHandlers(code) {
  const body = '(?:new\\s+[\\w.<>]+\\s*\\(\\s*)?(?:delegate\\s*(?:\\([^()]*\\))?|\\([^()]*\\)\\s*=>|\\w+\\s*=>)\\s*\\{';
  const re = new RegExp('(\\+=\\s*|\\bOnceOnScreen\\s*\\(\\s*|\\.\\s*AddHandler\\s*\\([^,()]*,\\s*)' + body, 'g');
  let out = code, m;
  while ((m = re.exec(out)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(out, open);
    if (close < 0) break;
    const kept = m[1].charAt(0) === '+' ? '+= HANDLER' : m[1] + 'HANDLER';
    out = out.slice(0, m.index) + kept + out.slice(close + 1);
    re.lastIndex = m.index + kept.length;
  }
  return out;
}

/*
  One body as a launcher with askedToUninstall set (or not) would run it.
  Only the shapes this code base uses: a bare "if (askedToUninstall) {...}"
  that returns, an "if (... || askedToUninstall) return;", a guard
  "if (!askedToUninstall) statement", and the ternary Run used to have.
*/
function asMode(code, uninstalling) {
  let b = code;

  b = b.replace(/\baskedToUninstall\s*\?\s*([\w.]+)\s*:\s*([\w.]+)/g, function (_, a, c) { return uninstalling ? a : c; });

  // if (!askedToUninstall) X
  const neg = /if\s*\(\s*!\s*askedToUninstall\s*\)\s*/g;
  let m;
  while ((m = neg.exec(b)) !== null) {
    const at = m.index + m[0].length;
    let end;
    if (b[at] === '{') end = closeOf(b, at) + 1;
    else end = b.indexOf(';', at) + 1;
    if (end <= 0) break;
    const kept = uninstalling ? '' : b.slice(at, end);
    b = b.slice(0, m.index) + kept + b.slice(end);
    neg.lastIndex = m.index + kept.length;
  }

  // if (askedToUninstall) { ... }
  const pos = /if\s*\(\s*askedToUninstall\s*\)\s*\{/g;
  while ((m = pos.exec(b)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(b, open);
    if (close < 0) break;
    const inner = b.slice(open + 1, close);
    if (!uninstalling) { b = b.slice(0, m.index) + b.slice(close + 1); pos.lastIndex = m.index; continue; }
    if (/return\s*;\s*$/.test(inner.trim())) return b.slice(0, m.index) + inner;
    b = b.slice(0, m.index) + inner + b.slice(close + 1);
    pos.lastIndex = m.index + inner.length;
  }

  // if (A || askedToUninstall) return;
  const early = /if\s*\(([^()]*)\)\s*return\s*;/g;
  while ((m = early.exec(b)) !== null) {
    const cond = m[1];
    if (!/\baskedToUninstall\b/.test(cond) || /!\s*askedToUninstall/.test(cond) || /&&/.test(cond)) continue;
    if (uninstalling) return b.slice(0, m.index);
    b = b.slice(0, m.index) + b.slice(m.index + m[0].length);
    early.lastIndex = m.index;
  }
  return b;
}

const KEYWORDS = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'return',
  'typeof', 'sizeof', 'default', 'new', 'delegate', 'base', 'this', 'checked', 'unchecked', 'fixed']);

function callsIn(code) {
  const out = [];
  const re = /\b((?:[A-Za-z_]\w*\s*\.\s*)*[A-Za-z_]\w*)\s*(?:<[\w.,\s]*>\s*)?\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const name = m[1].replace(/\s+/g, '');
    if (KEYWORDS.has(name)) continue;
    out.push(name);
  }
  return out;
}

// Everything reachable from Run, in one mode or the other.
function walk(methods, uninstalling) {
  const seen = new Set();
  const calls = new Set();
  const order = [];
  let text = '';
  const todo = ['Run'];
  while (todo.length) {
    const name = todo.shift();
    if (seen.has(name) || !methods[name]) continue;
    seen.add(name);
    order.push(name);
    let body = asMode(withoutHandlers(methods[name].code), uninstalling);
    // A method made into an Action and handed on (to the dispatcher) runs.
    body = body.replace(/\bnew\s+Action\s*\(\s*(\w+)\s*\)/g, '$1()');
    // Landing on Settings draws nothing (checked below), so it is a leaf.
    body = body.replace(/\bShowPage\s*\(\s*PageSettings\s*\)/g, 'ShowSettingsPage()');
    text += '\n// ---- ' + name + '\n' + body;
    for (const c of callsIn(body)) {
      calls.add(c);
      if (methods[c] && !seen.has(c)) todo.push(c);
    }
  }
  return { seen: seen, calls: calls, text: text, order: order };
}

// ---- read the launcher ------------------------------------------------------
const files = (function () {
  try { return fs.readdirSync(APP).filter(function (f) { return /\.cs$/i.test(f); }); } catch (e) { return []; }
})();
yes('the launcher source is there to read, in ' + APP, files.length > 10);

const shell = {};
const shellFiles = [];
for (const f of files) {
  const raw = read(f);
  if (raw && /partial\s+class\s+Shell\b/.test(raw)) { shellFiles.push(f); methodsOf(raw, shell); }
}
yes('Run, Wire and DoUninstall are found in the Shell partial class', !!(shell.Run && shell.Wire && shell.DoUninstall));
if (!shell.Run || !shell.Wire || !shell.DoUninstall) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// ---- the switch -------------------------------------------------------------
yes('Run still reads -uninstall off the command line into askedToUninstall',
    /"-uninstall"/.test(shell.Run.raw) && /askedToUninstall\s*=\s*true/.test(shell.Run.code));

const branch = /if\s*\(\s*askedToUninstall\s*\)\s*\{\s*OpenForUninstall\s*\(\s*\)\s*;\s*return\s*;\s*\}/.exec(shell.Run.code);
yes('Run turns off into OpenForUninstall and returns, rather than going on to start up', !!branch);
yes('OpenForUninstall exists in the Shell partial class', !!shell.OpenForUninstall);

// ---- what a launcher opened to uninstall can reach ---------------------------
const un = walk(shell, true);

// Named by what they do, because the list is the argument.
const MUST_NOT = [
  ['CheckUpdatesBackground', 'the update check'],
  ['CheckUpdatesInPlay', 'the in-play update check'],
  ['StartPing', 'the server test'],
  ['RunScan', 'the mod list check against the server'],
  ['HealClientBackground', 'the client repair, which can download into the game folder about to be deleted'],
  ['AutoDisplayOnce', 'the first-run display settings'],
  ['ClearLeftovers', 'ending a stuck game on the way in'],
  ['RefreshDiscord', 'the Discord card'],
  ['CheckVoice', 'the voice service health probe'],
  ['OwnGameAtStart', 'the own game folder check'],
  ['StartOwnGame', 'the own game folder being made or brought up to date'],
  ['AskOwnGame', 'the offer to make the own game folder'],
  ['MusicDecide', 'the theme playing'],
  ['Register.Ensure', 'the Installed apps entry written again on the way out'],
  ['Discord.SendPendingLogs', 'the last session\'s logs sent'],
  ['AutoJoin.Ensure', 'the client settings file written'],
  ['Hold.Take', 'the game files held'],
  ['Keep.Seed', 'this build\'s files kept'],
  ['Keep.Unpark', 'parked plugins put back'],
  ['Keep.TakeNote', 'the session note'],
  ['Swap.Restore', 'the redirect put back at startup (the uninstall does it itself, in its own order)'],
  ['Leaks.Clean', 'the leak clean-up'],
  ['ThornIni.Ensure', 'Thornswood.ini written'],
  ['SteamUpdates.Report', 'Steam\'s Updates setting for Skyrim read and reported'],
  ['Display.MatchScreen', 'the game set to the screen'],
  ['Icons.Ensure', 'the shortcut icon'],
  ['Uninstall.DropScratch', 'the installer leftovers cleared at startup (the uninstall does it itself)'],
  ['Voice.Start', 'voice'],
  ['Presence.Start', 'presence']
];
for (const pair of MUST_NOT) {
  yes('opened to uninstall, nothing reaches ' + pair[1] + ' (' + pair[0] + ')', !un.calls.has(pair[0]));
}

const NETWORK = [
  [/WebRequest\s*\.\s*Create/, 'a web request'],
  [/new\s+Ping\s*\(/, 'a ping'],
  [/\bTcpClient\b/, 'a TCP connect'],
  [/\bWebClient\b/, 'a web client'],
  [/\bHttpClient\b/, 'an HTTP client']
];
for (const pair of NETWORK) {
  yes('opened to uninstall, nothing on the way in makes ' + pair[1], !pair[0].test(un.text));
}
yes('opened to uninstall, the theme is never started or told to play',
    !un.calls.has('MenuMusic.Start') && !un.calls.has('MenuMusic.Decide'));

// The window has to be the real one, drawn, and on the right page.
yes('the real window is still made and bound, because DoUninstall reads its controls',
    un.calls.has('MainWindow') && un.calls.has('Bind'));
yes('the buttons are still wired, so Uninstall does something', un.calls.has('Wire'));
yes('the Settings page still draws its folder rows', un.calls.has('BuildPathRows'));
yes('it lands on the Settings page', un.calls.has('ShowSettingsPage'));
yes('and no other page, which would draw that page\'s work', !un.calls.has('ShowPage'));
yes('ShowPage draws nothing for the Settings page, which is why landing there is cheap',
    shell.ShowPage && !/\bPageSettings\b/.test(shell.ShowPage.code));
yes('it says in the log why it opened, which is the line a person reads back', un.calls.has('Log') &&
    !!shell.OpenForUninstall && /Log\s*\(\s*"[^"]*uninstall/i.test(shell.OpenForUninstall.raw));

// The loop: the window closing has to end it, so Main returns and frees the
// mutex, or the next launch finds it "already open".
const opener = shell.OpenForUninstall ? shell.OpenForUninstall.code : '';
const runAt = opener.search(/\bwin\s*\.\s*Show\s*\(\s*\)/);
const loopAt = opener.search(/Dispatcher\s*\.\s*UIThread\s*\.\s*MainLoop\s*\(\s*closed\s*\.\s*Token\s*\)/);
yes('OpenForUninstall shows the window and runs its loop itself', runAt >= 0 && loopAt > runAt);
yes('closing the window ends the loop',
    /win\s*\.\s*Closed\s*\+=\s*delegate\s*\{\s*closed\s*\.\s*Cancel\s*\(\s*\)\s*;\s*\}/.test(opener) &&
    opener.search(/win\s*\.\s*Closed\s*\+=/) < runAt);
yes('a fault on the window thread is logged and kept, as Run does', /Dispatcher\s*\.\s*UIThread\s*\.\s*UnhandledException\s*\+=/.test(opener));

// The two things that fire on their own once the message loop runs.
const stopAt = opener.search(/\btimer\s*\.\s*Stop\s*\(\s*\)/);
yes('Wire starts the two second timer (so something has to stop it)', /\btimer\s*\.\s*Start\s*\(\s*\)/.test(withoutHandlers(shell.Wire.code)));
yes('the two second timer, which pings the server and watches the game, is stopped before the window runs',
    stopAt >= 0 && runAt >= 0 && stopAt < runAt);
const ownAt = opener.search(/\bownGameStarted\s*=\s*true\s*;/);
yes('the own game folder check on first draw is stood down before the window runs',
    ownAt >= 0 && runAt >= 0 && ownAt < runAt);
(function () {
  const w = shell.WireOwnGame ? shell.WireOwnGame.code : '';
  const m = /OnceOnScreen\s*\(\s*delegate\s*\{/.exec(w);
  let ok = false;
  if (m) {
    const open = m.index + m[0].length - 1;
    const inner = w.slice(open + 1, closeOf(w, open));
    const guard = inner.search(/if\s*\(\s*ownGameStarted\s*\)\s*return\s*;/);
    const call = inner.search(/\bOwnGameAtStart\s*\(/);
    ok = guard >= 0 && call > guard;
  }
  yes('which works because the first-draw handler returns on ownGameStarted before OwnGameAtStart', ok);
})();

// A game still running when this opens: the Closing handler reads playing.
yes('a game still running is noticed, so closing the window does not unpark plugins under it',
    /\bplaying\s*=\s*Checks\s*\.\s*GameRunning\s*\(\s*\)/.test(opener) &&
    /if\s*\(\s*!\s*playing\s*\)\s*\{?\s*try\s*\{\s*Keep\s*\.\s*Unpark/.test(shell.Wire.code));

yes('the uninstall is scrolled into view, not focused', /btnUninstall\s*\.\s*BringIntoView\s*\(/.test(opener) &&
    !/btnUninstall\s*\.\s*Focus\s*\(/.test(opener));

// ---- a normal start keeps all of it ------------------------------------------
const play = walk(shell, false);
const MUST = ['CheckUpdatesBackground', 'StartPing', 'RunScan', 'HealClientBackground',
              'RefreshDiscord', 'CheckVoice', 'Register.Ensure', 'Voice.Start',
              'Keep.Seed', 'AutoJoin.Ensure', 'Discord.SendPendingLogs', 'SteamUpdates.Report'];
for (const name of MUST) yes('a normal start still reaches ' + name, play.calls.has(name));
yes('a normal start still plays the theme', play.calls.has('MenuMusic.Start'));
yes('a normal start still opens on Play', /\bShowPage\s*\(\s*PagePlay\s*\)/.test(play.text));
yes('a normal start never goes through OpenForUninstall', !play.calls.has('OpenForUninstall'));

// ---- the uninstall itself, untouched -----------------------------------------
const du = shell.DoUninstall.code;
yes('DoUninstall still asks whether to keep the characters (ChkKeepSaves)', /chkKeepSaves\s*\.\s*IsChecked/.test(du));
yes('DoUninstall still asks whether to keep the game files (ChkDeleteMods)', /chkDeleteMods\s*\.\s*IsChecked/.test(du));
yes('and confirms twice before anything goes', (du.match(/\bAsk\s*\.\s*(?:YesNo|Tell|OkCancel)\s*\(/g) || []).length >= 3 &&
    (du.match(/\bAsk\s*\.\s*YesNo\s*\(/g) || []).length >= 2);
yes('DoUninstall hands over to Uninstall.Begin and Uninstall.Finish', /Uninstall\s*\.\s*Begin\s*\(/.test(du) && /Uninstall\s*\.\s*Finish\s*\(/.test(du));
yes('both ticks are bound from the real window, by name',
    shell.Bind && /chkKeepSaves\s*=\s*win\s*\.\s*ChkKeepSaves\s*;/.test(shell.Bind.raw) &&
    /chkDeleteMods\s*=\s*win\s*\.\s*ChkDeleteMods\s*;/.test(shell.Bind.raw));
yes('the Uninstall button still runs DoUninstall on the main build',
    /btnUninstall\s*\.\s*Click\s*\+=\s*delegate\s*\{\s*DoUninstall\s*\(\s*\)\s*;\s*\}/.test(shell.Wire.code));

(function () {
  const raw = read('Uninstall.cs');
  const u = raw ? methodsOf(raw, {}) : {};
  const b = u.Begin ? u.Begin.code : '';
  const restore = b.search(/Swap\s*\.\s*Restore\s*\(/);
  const firsts = ['DropShortcuts', 'Register\\s*\\.\\s*Forget', 'DropScratch', 'RemoveOurGameFiles']
    .map(function (n) { return b.search(new RegExp('\\b' + n + '\\s*\\(')); });
  yes('Uninstall.Begin still puts the Windows Skyrim folders back before it removes anything',
      restore >= 0 && firsts.every(function (i) { return i > restore; }));
  yes('and refuses to go on while a Windows Skyrim folder is still redirected',
      !!raw && /still redirected at this build/.test(raw));
  // #3205: shortcuts go by what they run, the pinned taskbar copy among them.
  // Deleting Thornswood.lnk by name left the pin, and the next pin was
  // "Thornswood (2)".
  const ds = u.DropShortcuts ? u.DropShortcuts.code : '';
  yes('Uninstall.DropShortcuts deletes every shortcut that runs this launcher (Icons.Drop), not one name',
      /Icons\s*\.\s*Drop\s*\(\s*Icons\s*\.\s*Exe\s*\)/.test(ds) && !/"Thornswood\.lnk"/.test(ds));
  const dev = read('DevBuild.cs') || '';
  yes('removing the dev build does the same, from the main build and from inside it',
      /Icons\s*\.\s*Drop\s*\(\s*Exe\s*\)/.test(dev) && /Icons\s*\.\s*ShortcutsTo\s*\(\s*Icons\s*\.\s*Exe\s*\)/.test(dev) &&
      !/ShortcutPaths/.test(dev));
})();

// ---- what Windows runs -------------------------------------------------------
(function () {
  const raw = read('Register.cs') || '';
  const m = /SetValue\(\s*"UninstallString"\s*,([\s\S]*?)\)\s*;/.exec(raw);
  const v = m ? m[1] : '';
  yes('UninstallString is still the exe, with -root and -uninstall',
      /\bexe\b/.test(v) && /-root/.test(v) && /\broot\b/.test(v) && /-uninstall/.test(v));
  yes('it names the running exe, so an install still on the old exe name registers that name',
      /return Environment\.ProcessPath \?\? "";/.test(raw) && /string exe = Exe\(\);/.test(raw));
  yes('NoModify and NoRepair are still set, and no Modify or Repair command is offered',
      /SetValue\(\s*"NoModify"\s*,\s*1\s*,\s*RegistryValueKind\.DWord\s*\)/.test(raw) &&
      /SetValue\(\s*"NoRepair"\s*,\s*1\s*,\s*RegistryValueKind\.DWord\s*\)/.test(raw) &&
      !/"ModifyPath"/.test(raw));
})();

console.log('');
console.log('walked ' + un.order.length + ' methods opened to uninstall, ' + play.order.length + ' on a normal start, across ' + shellFiles.length + ' Shell files');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
