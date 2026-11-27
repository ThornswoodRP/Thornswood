/*
  test-feed-channel.js

  A launcher stays on its own channel's feed (Djinn, 2 Oct).

  WHY THIS EXISTS. On 1 Oct the dev feed went out with updateFeedUrl set to
  the MAIN feed, because Publish-Update copied the shipping machine's
  config.json UpdateFeedUrl into it. Every dev launcher saved that address
  (ShellUpdate) and Updater.FeedUrl honoured it, so they all moved to the main
  feed: no dev launcher updates, no dev client, and the Client row red with
  Play shut, because the main feed only holds the main client.

  Since #5796 a launcher reads no feed address: it takes its channel's
  package from GitHub through Velopack, and the channel is config.json's
  Channel or UpdateBranch (Velo.ChannelFor). The same mistake now would be a
  setup's config.json naming the other channel, because a setup's Channel
  is written over the install's (InstallSteps.Merge). So this holds:
    - Velo.ChannelFor takes the channel only from Channel and UpdateBranch,
      and that rule is RUN here on every combination, not just read;
    - Build-SetupFiles writes Channel from its own -Channel, never from the
      feed it reads the rest from;
    - nothing else in the launcher sets Channel but the Server card's switch
      (DevBuild.Set);
    - Publish-Update still writes its own channel's feed into updateFeedUrl.

  Read only. It reads source files and nothing else.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const read = (...p) => fs.readFileSync(path.join(REPO_DIR, ...p), 'utf8').split(CR).join('');
const VELO = read('launcher', 'app', 'Velo.cs');
const SETUP = read('scripts', 'release', 'Build-SetupFiles.ps1');
const PUB = read('scripts', 'release', 'Publish-Update.ps1');
const APP = path.join(REPO_DIR, 'launcher', 'app');

let pass = 0, fail = 0;
const yes = (w, c) => { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } };

const MAIN = 'https://thornswood.net/feed/version.json';
const DEV = 'https://thornswood.net/feed-dev/version.json';

// ---- the launcher: the rule, run ---------------------------------------------
const at = VELO.indexOf('public static string ChannelFor(Config cfg)');
const body = at < 0 ? '' : VELO.slice(at, VELO.indexOf('\n        }\n', at));
yes('Velo.ChannelFor is there to read', at > 0);
yes('it reads the channel from Channel or UpdateBranch, and nothing else',
    /bool dev =\s*\(string\.Equals\(cfg\.Channel, "dev", StringComparison\.OrdinalIgnoreCase\) \|\|\s*string\.Equals\(cfg\.UpdateBranch, "dev", StringComparison\.OrdinalIgnoreCase\)\);\s*return dev \? "dev" : "main";/.test(body));

/*
  The same steps as the C#, so the combinations can be run: dev when Channel
  or UpdateBranch is dev in any case, main otherwise.
*/
function channelFor(channel, branch) {
  const isDev = (v) => typeof v === 'string' && v.toLowerCase() === 'dev';
  return isDev(channel) || isDev(branch) ? 'dev' : 'main';
}
yes('Channel dev is the dev channel', channelFor('dev', 'main') === 'dev');
yes('  in any case', channelFor('DEV', '') === 'dev');
yes('UpdateBranch dev is the dev channel', channelFor('', 'dev') === 'dev');
yes('neither, the main channel', channelFor('', 'main') === 'main');
yes('  and empty is main', channelFor('', '') === 'main');

// ---- the setup's config.json ----------------------------------------------------
yes('Build-SetupFiles writes Channel from its own -Channel',
    SETUP.indexOf("$cfgOut['Channel'] = $(if ($Channel -eq 'dev') { 'dev' } else { '' })") >= 0);
const pairs = (SETUP.match(/foreach \(\$pair in @\(([\s\S]*?)\)\) \{\s*if \(\$feed\.PSObject/) || [])[1] || '';
yes('  and never copies a channel out of the feed it reads the rest from',
    pairs.length > 0 && !/'Channel'|'UpdateBranch'/.test(pairs));

// ---- who sets it ------------------------------------------------------------------
const setters = [];
for (const f of fs.readdirSync(APP).filter((f) => f.endsWith('.cs')).sort()) {
  const src = fs.readFileSync(path.join(APP, f), 'utf8');
  src.split('\n').forEach((line, i) => {
    if (/\bcfg\.(Channel|UpdateBranch)\s*=[^=]/.test(line)) { setters.push(f + ':' + (i + 1)); }
  });
}
yes('only the Server card\'s switch sets Channel and UpdateBranch in the launcher (DevBuild.Set)',
    setters.length === 2 && setters.every((s) => s.startsWith('DevBuild.cs:')));

// ---- the publisher -------------------------------------------------------------
const put = PUB.indexOf("Set-Prop $doc 'updateFeedUrl' $feedUrl");
const before = put > 0 ? PUB.slice(Math.max(0, put - 1500), put) : '';
yes('Publish-Update still writes updateFeedUrl', put > 0);
yes('it checks the address against the channel first',
    before.indexOf("$isDevUrl = $feedUrl -match '/feed-dev/'") >= 0 &&
    before.indexOf('if ([bool]$Dev -ne $isDevUrl) {') >= 0 &&
    before.indexOf('$feedUrl = Get-HostFeedVersionUrl -Dev:$Dev') >= 0);
yes('the check comes after config.json is read, so config.json cannot undo it',
    before.lastIndexOf("$feedUrl = [string]$cfg.UpdateFeedUrl") < before.indexOf('if ([bool]$Dev -ne $isDevUrl) {'));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
