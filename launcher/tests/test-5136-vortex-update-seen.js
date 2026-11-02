/*
  test-5136-vortex-update-seen.js

  The launcher notices a collection update finished in Vortex by itself.

  WHY THIS EXISTS. On 31 October Patrick updated his dev install to
  collection revision 6 in Vortex, through the launcher's "Open revision 6"
  card, and came back to the Play page. The card stayed up and Play stayed
  shut until he pressed Scan and Fix on Diagnostics. Two causes, both in
  the source:
    - nothing read Vortex's revision again while the launcher sat on the
      Play page: DrawStatus reads it fresh, but only a page change, a scan,
      a feed answer or Steam starting or stopping runs DrawStatus;
    - the mod updates that waited on the collection were never asked for
      again: OnVersionDoc returns early while ModsMissing, with none
      pending, and only Scan handed a feed answer back to it.

  This holds the fix to the source:
    - the two second tick, when no game is up, runs WatchVortex;
    - WatchVortex looks only while the collection card or the note is up,
      never starts a second look, stays out of Fix and an update, and reads
      the revision on a pool thread only when Vortex's files changed;
    - the listing is state.v2 and plugins.txt by size and write time, and
      does not read Vortex's database itself;
    - DrawStatus records what the card was drawn from, from the one
      observation it already takes;
    - VortexChanged draws again only when that moved, and when the card
      came down shuts Play on CHECKING and asks the feed again on a pool
      thread, through CheckUpdatesBackground, which hands the answer to
      OnVersionDoc and then UpdateBySelf;
    - the page lists ShellVortexWatch.cs with the Shell.

  Read only. It reads source files and nothing else.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');

const APP = path.join(REPO_DIR, 'launcher', 'app');
const CR = String.fromCharCode(13);
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};

function body(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}
// Code only: comments taken out, so a line that merely talks about a call
// does not count as making it.
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const shell = read('Shell.cs');
const watch = read('ShellVortexWatch.cs');
const update = read('ShellUpdate.cs');

// ------------------------------------------------------------ the tick
const tickAt = shell.indexOf('timer.Tick += delegate');
const tick = tickAt < 0 ? '' : body(shell.slice(tickAt), 'timer.Tick += delegate');
const idle = body(tick, 'if (!playing)');
yes('the two second tick runs WatchVortex while no game is up',
    code(idle).indexOf('WatchVortex();') >= 0 &&
    code(idle).indexOf('WatchVortex();') < code(idle).indexOf('return;'));

// ------------------------------------------------------------ the look
const look = code(body(watch, 'static void WatchVortex()'));
yes('WatchVortex exists', look.length > 0);
yes('it looks only while the collection card or the note is up, and forgets the last listing otherwise',
    /if \(!collectionBarUp && !collectionNoteUp\) \{ vortexSeen = null; return; \}/.test(look));
yes('it never starts a second look, and stays out of Fix, an update and a game',
    /if \(vortexLooking \|\| fixing \|\| updating \|\| playing\) return;/.test(look));
const pool = look.indexOf('ThreadPool.QueueUserWorkItem');
const revAt = look.indexOf('Checks.CollectionRevision(cfg)');
yes('the revision is read on a pool thread, not the UI thread',
    pool >= 0 && revAt > pool);
yes('it is read only when the listing changed',
    /look = now != null && now != was;/.test(look) &&
    look.indexOf('if (look)') >= 0 && look.indexOf('if (look)') < revAt);
yes('the answer goes back to the UI thread, which clears the look and draws there',
    look.indexOf('Dispatcher.UIThread.Post') > revAt &&
    /vortexLooking = false;/.test(look) && look.indexOf('VortexChanged(revision, problem)') >= 0);

const disk = code(body(watch, 'static string VortexOnDisk()'));
yes('the listing is Vortex\'s state.v2 folder and the plugin list Play reads',
    disk.indexOf('"Vortex\\\\state.v2"') >= 0 && disk.indexOf('Paths.Live, "plugins.txt"') >= 0);
yes('by size and write time',
    disk.indexOf('.Length') >= 0 && disk.indexOf('LastWriteTimeUtc') >= 0);
yes('the listing does not read Vortex\'s database',
    disk.indexOf('VortexProfileState') < 0 && disk.indexOf('CollectionRevision') < 0 &&
    disk.indexOf('ReadAll') < 0);

// ------------------------------------------------------------ what the card was drawn from
const draw = code(body(shell, 'static bool DrawStatus()'));
yes('DrawStatus records what the card was drawn from, from its one observation',
    draw.indexOf('collectionDrawn = CollectionKey(collectionRevision, CollectionProblem(collectionRevision));') >= 0);
yes('DrawStatus still takes exactly one revision observation',
    (draw.match(/Checks\.CollectionRevision\(cfg\)/g) || []).length === 1);

// ------------------------------------------------------------ what a change does
const changed = code(body(watch, 'static void VortexChanged(int revision, string problem)'));
yes('VortexChanged exists', changed.length > 0);
yes('nothing is drawn when the card already says what Vortex says',
    /if \(CollectionKey\(revision, problem\) == collectionDrawn\) return;/.test(changed));
yes('a change draws the card again',
    changed.indexOf('DrawStatus();') >= 0);
const ask = changed.indexOf('CheckUpdatesBackground(false)');
yes('when the card came down, the feed is asked again on a pool thread',
    ask >= 0 && /ThreadPool\.QueueUserWorkItem\(delegate \{ CheckUpdatesBackground\(false\); \}\);/.test(changed) &&
    /if \(!barWasUp \|\| collectionBarUp\)/.test(changed) &&
    changed.indexOf('if (!barWasUp || collectionBarUp)') < ask);
yes('and Play stays shut on CHECKING until it answers',
    /updatePending = true;\s*updateAnswered = false;\s*DrawStatus\(\);/.test(changed) &&
    changed.indexOf('updatePending = true;') < ask);
yes('the log says what Vortex has now',
    /Log\("Vortex now has collection revision " \+ revision/.test(changed));

// ------------------------------------------------------------ the feed answer
const check = code(body(update, 'static void CheckUpdatesBackground(bool loud)'));
yes('CheckUpdatesBackground hands its answer to OnVersionDoc and then UpdateBySelf, so automatic updates go in',
    /OnVersionDoc\(v, loud\); UpdateBySelf\(\);/.test(check));
const onDoc = code(body(update, 'static void OnVersionDoc(VersionDoc v, bool loud)'));
const held = body(onDoc.slice(onDoc.indexOf('if (ModsMissing())')), 'if (ModsMissing())');
yes('OnVersionDoc still holds the mod updates while the collection card is up, which is why it is asked again',
    held.indexOf('updatePending = false;') >= 0 && held.indexOf('ShowCollectionBar();') >= 0);

// ------------------------------------------------------------ the page
const page = read('ARCHITECTURE.md');
yes('ARCHITECTURE.md lists ShellVortexWatch.cs with the Shell',
    /\*\*Shell\*\* \([^)]*ShellVortexWatch\.cs/.test(page));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
