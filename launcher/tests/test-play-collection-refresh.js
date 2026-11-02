/*
  test-play-collection-refresh.js

  Play offers the same Vortex bring-up-to-date Diagnostics does.

  WHY THIS EXISTS. The Diagnostics button BtnOwnGameRefresh runs
  StartOwnGame(false), which is OwnGame.Refresh when Vortex has deployed
  since the folder was made (OwnGame.NeedsRefresh). Play never asked
  NeedsRefresh. It checked ownGameBusy and launched. A collection Vortex
  had already deployed while the launcher was open went into the game
  from the last refresh.

  This holds the cause to the source:
    - StartPlay asks OwnGameRefreshIfDue before Discord and before Play();
    - Play() asks it again, because Play() is also the path a running game
      and other callers come through, and the button being grey does
      nothing for those;
    - OwnGameRefreshIfDue is StartOwnGame(false, true), the same call as
      BtnOwnGameRefresh, not a second refresh;
    - when NeedsRefresh is false, StartPlay still reaches Play();
    - when the bring-up-to-date succeeds, StartPlay runs again, so one press
      ends in the game, and only once, so a folder that still does not match
      cannot send it round again;
    - ownGameBusy is read again after the wait, because a bring-up-to-date
      OwnGameAtStart queued can start inside it;
    - a NeedsRefresh that throws is said in the log, not only noted.

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

const own = read('ShellOwnGame.cs');
const chars = read('ShellChars.cs');
const shell = read('Shell.cs');
const due = body(own, 'static bool OwnGameRefreshIfDue()');
const startPlay = body(chars, 'static void StartPlay()');
const play = body(read('ShellPlay.cs'), 'static void Play()');
const wire = body(own, 'static void WireOwnGame()');

yes('OwnGameRefreshIfDue exists', due.length > 0);
yes('it asks OwnGame.NeedsRefresh, the same test Diagnostics refresh uses',
    due.indexOf('OwnGame.NeedsRefresh(cfg)') >= 0);
yes('it runs StartOwnGame(false, true, ...), the same bring-up-to-date as the Diagnostics button',
    /StartOwnGame\(\s*false\s*,\s*true\s*,/.test(due));
// The Diagnostics button went in #2627: Fix runs the same bring-up-to-date
// when Scan finds the folder behind Vortex.
const scanFix = read('ShellScanFix.cs');
yes('Fix on Diagnostics runs that same StartOwnGame(false, true, ...) when Scan finds the folder behind',
    /Has\(rest, IssueKind\.Behind\) &&\s*StartOwnGame\(false, true, /.test(scanFix) &&
    !/btnOwnGameRefresh/.test(wire));
yes('it does not start a second refresh of its own',
    due.indexOf('OwnGame.Refresh(') < 0 && due.indexOf('OwnGame.Make(') < 0);
yes('it leaves a running game alone',
    /playing \|\| Checks\.GameRunning\(\)/.test(due));
yes('it does nothing when the folder is not due',
    /if \(!due\) return false;/.test(due));

// ---- After the bring-up-to-date -------------------------------------------
// Since #2627 the three-argument StartOwnGame hands on to one that also
// takes what to do when the bring-up-to-date fails (Fix carries on then),
// and that one does the work.
const startOwn3 = body(own, 'static void StartOwnGame(bool make, bool loud, Action then)');
const startOwn = body(own, 'static bool StartOwnGame(bool make, bool loud, Action then, Action failed)');
const startOwn2 = body(own, 'static void StartOwnGame(bool make, bool loud)');
yes('StartOwnGame(make, loud) is StartOwnGame(make, loud, null), so startup is unchanged',
    /^\{\s*StartOwnGame\(make, loud, null\);\s*\}$/.test(startOwn2));
yes('and StartOwnGame(make, loud, then) is the same with nothing to do on a failure',
    /^\{\s*StartOwnGame\(make, loud, then, null\);\s*\}$/.test(startOwn3));
// Since #2210 the work runs in FolderWork, which StartOwnGame hands its
// `then` to under OwnGame.Alone, so the finish is FolderWork's.
const folderWork = body(own, 'static void FolderWork(bool make, bool loud, Action then, Action failed, Config c, Action<string> say)');
yes('StartOwnGame hands what comes after to FolderWork, under the folder\'s lock',
    /OwnGame\.Alone\(delegate \{ FolderWork\(make, loud, then, failed, c, say\); \}/.test(startOwn));
yes('FolderWork runs what comes after only when it worked, and never after a make',
    /if \(fail == null && !make && then != null\) then\(\);/.test(folderWork));
yes('and what comes after a failure only when it failed',
    /else if \(fail != null && failed != null\) failed\(\);/.test(folderWork));
yes('that line is inside the finish on the window\'s thread, after the status is drawn again',
    folderWork.indexOf('then();') > folderWork.lastIndexOf('DrawOwnGame();') &&
    folderWork.lastIndexOf('win.Dispatcher.BeginInvoke') < folderWork.indexOf('then();'));
const cont = due.slice(due.indexOf('StartOwnGame(false, true,'));
yes('what comes after is StartPlay from the top, not Play(), so Discord and the character list are not skipped',
    /StartPlay\(\);/.test(cont) && !/[^t]Play\(\);/.test(cont.replace(/StartPlay\(\);/g, '')));
yes('it marks that StartPlay as the one after a bring-up-to-date, and clears the mark however it ends',
    /ownGameRefreshedForPlay = true;\s*try \{ StartPlay\(\); \}\s*finally \{ ownGameRefreshedForPlay = false; \}/.test(cont));
const guardAt = due.indexOf('if (ownGameRefreshedForPlay)');
yes('a folder still due straight after its bring-up-to-date is said, and not started again',
    guardAt > 0 && guardAt < due.indexOf('StartOwnGame(false, true,') &&
    /if \(ownGameRefreshedForPlay\)\s*\{[\s\S]*?Log\([\s\S]*?return true;\s*\}/.test(due));
const waitAt = due.indexOf('Waiting(');
const busyAfter = due.indexOf('if (ownGameBusy)', waitAt);
yes('ownGameBusy is read again after the wait, before anything is started',
    waitAt > 0 && busyAfter > waitAt && busyAfter < due.indexOf('if (!due) return false;'));
yes('a busy folder stops Play with a line saying so, before the wait and after it',
    (due.match(/if \(ownGameBusy\)\s*\{\s*Log\([^;]*\);\s*return true;\s*\}/g) || []).length === 2);
const catchBody = due.slice(due.indexOf('catch (Exception ex)'), due.indexOf('return false;', due.indexOf('catch (Exception ex)')));
yes('a NeedsRefresh that throws is noted and said in the log, and Play goes on from the folder as it is',
    catchBody.indexOf('Swallow.Note(') >= 0 && catchBody.indexOf('Log(') >= 0);

const requiredAt = startPlay.indexOf('if (!OwnGameRequired()) return;');
const dueAt = startPlay.indexOf('if (OwnGameRefreshIfDue()) return;');
const doorAt = startPlay.indexOf('if (!Door.RecentlyCleared)');
yes('StartPlay asks it after OwnGameRequired and before Discord',
    requiredAt >= 0 && dueAt > requiredAt && doorAt > dueAt);
yes('StartPlay still reaches Play() when the folder is current',
    /if \(OwnGameRefreshIfDue\(\)\) return;[\s\S]*\n\s*Play\(\);/.test(startPlay));

const playHead = play.slice(0, 1200);
yes('Play() asks it on the way in, with the other holds',
    playHead.indexOf('if (OwnGameRefreshIfDue()) return;') >= 0);
yes('Play() still checks ownGameBusy before it, so work already going is not started twice',
    playHead.indexOf('if (ownGameBusy)') >= 0 &&
    playHead.indexOf('if (ownGameBusy)') < playHead.indexOf('if (OwnGameRefreshIfDue()) return;'));
yes('Play() still launches when none of those holds fire',
    play.indexOf('Process.Start') >= 0 || play.indexOf('skse64_loader') >= 0 ||
    play.indexOf('Paths.Loader') >= 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
