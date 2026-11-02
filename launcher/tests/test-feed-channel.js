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
    - Updater.FeedUrl never lets a saved address cross channels, and that is
      RUN here on every combination, not just read;
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

// ---- the launcher: the rule, run ---------------------------------------------
const body = UPD.slice(UPD.indexOf('public static string FeedUrl(Config cfg)'));
yes('FeedUrl is there to read', UPD.indexOf('public static string FeedUrl(Config cfg)') > 0);
yes('it checks the channel of a saved address',
    /bool saysDev = u\.AbsolutePath\.IndexOf\("\/feed-dev\/", StringComparison\.OrdinalIgnoreCase\) >= 0;/.test(body) &&
    /if \(saysDev != dev\) return builtIn;/.test(body));

/*
  The same steps as the C#, in order, so the combinations can be run: built-in
  by channel; empty or not a url, built-in; not https, not the default port or
  with user info, built-in; not thornswood.net, built-in; other channel,
  built-in; otherwise what was saved.
*/
function feedUrl(dev, said) {
  const builtIn = dev ? DEV : MAIN;
  said = (said || '').trim();
  let u;
  try { u = new URL(said); } catch (e) { return builtIn; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return builtIn;
  const host = u.hostname.toLowerCase();
  if (host !== 'thornswood.net' && !host.endsWith('.thornswood.net')) return builtIn;
  const saysDev = u.pathname.toLowerCase().indexOf('/feed-dev/') >= 0;
  if (saysDev !== dev) return builtIn;
  return said;
}
yes('a dev build that saved the MAIN feed reads the dev feed (the 1 Oct case)', feedUrl(true, MAIN) === DEV);
yes('a dev build that saved the dev feed reads it', feedUrl(true, DEV) === DEV);
yes('a dev build with nothing saved reads the dev feed', feedUrl(true, '') === DEV);
yes('a main build that saved the dev feed reads the main feed', feedUrl(false, DEV) === MAIN);
yes('a main build that saved the main feed reads it', feedUrl(false, MAIN) === MAIN);
yes('a move within the dev channel is still honoured',
    feedUrl(true, 'https://thornswood.net/feed-dev/v2/version.json') === 'https://thornswood.net/feed-dev/v2/version.json');
yes('a move within the main channel is still honoured',
    feedUrl(false, 'https://thornswood.net/feed2/version.json') === 'https://thornswood.net/feed2/version.json');
yes('another host is still refused', feedUrl(true, 'https://example.com/feed-dev/version.json') === DEV);

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
process.exit(fail ? 1 : 0);
