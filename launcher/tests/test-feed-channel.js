/*
  test-feed-channel.js

  A launcher stays on its own channel's feed (Djinn, 2 Oct).

  WHY THIS EXISTS. On 1 Oct the dev feed went out with updateFeedUrl set to
  the MAIN feed, because Publish-Update copied the shipping machine's
  config.json UpdateFeedUrl into it. Every dev launcher saved that address
  (ShellUpdate) and Updater.FeedUrl honoured it, so they all moved to the main
  feed: no dev launcher updates, no dev client, and the Client row red with
  Play shut, because the main feed only holds the main client.

  This holds both halves:
    - the launcher reads no saved feed address at all since #5796, when its
      updates came straight from GitHub (Updater.FeedUrl went then);
    - Publish-Update writes its own channel's feed into updateFeedUrl.

  Read only. It reads source files and nothing else.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const UPD = fs.readFileSync(path.join(REPO_DIR, 'launcher', 'app', 'Updater.cs'), 'utf8').split(CR).join('');
const PUB = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'release', 'Publish-Update.ps1'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
const yes = (w, c) => { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } };

const MAIN = 'https://thornswood.net/feed/version.json';
const DEV = 'https://thornswood.net/feed-dev/version.json';

// ---- the launcher: no saved address to cross over -------------------------------
// Since #5796 (11 Nov) the launcher takes its updates straight from GitHub,
// and Dev is a channel of the one install. Updater.FeedUrl went with it, so
// no saved feed address is read at all, and the 1 Oct case cannot come back
// through the launcher. What is held now is that it stays gone: no launcher
// source reads updateFeedUrl, and only the config merge still names the key
// (so an old config.json carries it without anything reading it).
const APP = path.join(REPO_DIR, 'launcher', 'app');
const readers = [];
for (const f of fs.readdirSync(APP)) {
  if (!f.endsWith('.cs')) continue;
  const t = fs.readFileSync(path.join(APP, f), 'utf8');
  if (/updateFeedUrl|FeedUrl\s*\(/i.test(t.replace(/"UpdateFeedUrl" or /g, ''))) readers.push(f);
}
yes('no launcher source reads a saved update feed address (' + (readers.join(', ') || 'none') + ')', readers.length === 0);
yes('Updater has no FeedUrl any more', UPD.indexOf('FeedUrl(') < 0);

// ---- the publisher -------------------------------------------------------------
const at = PUB.indexOf("Set-Prop $doc 'updateFeedUrl' $feedUrl");
const before = at > 0 ? PUB.slice(Math.max(0, at - 1500), at) : '';
yes('Publish-Update still writes updateFeedUrl', at > 0);
yes('it checks the address against the channel first',
    before.indexOf("$isDevUrl = $feedUrl -match '/feed-dev/'") >= 0 &&
    before.indexOf('if ([bool]$Dev -ne $isDevUrl) {') >= 0 &&
    before.indexOf('$feedUrl = Get-HostFeedVersionUrl -Dev:$Dev') >= 0);
yes('the check comes after config.json is read, so config.json cannot undo it',
    before.lastIndexOf("$feedUrl = [string]$cfg.UpdateFeedUrl") < before.indexOf('if ([bool]$Dev -ne $isDevUrl) {'));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
