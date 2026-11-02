/*
  test-5020-local-server-kept.js

      node .\launcher\tests\test-5020-local-server-kept.js

  A launcher whose config.json points at a server on this machine keeps that
  address and its ports when the update feed answers (#5020). The restore
  rehearsal in docs RESTORING.md points config.json at 127.0.0.1 and the port
  Restore-Server.ps1 -Rehearse printed, then presses Play. Before this,
  Shell.OnVersionDoc copied the feed's serverAddress and serverPort over
  that on the first check (the main feed names the public server's
  address and 7777), saved config.json and said "The server moved", so Play loaded the
  live character instead of the restored one.

  It reads launcher\app\ShellUpdate.cs and checks:
    - OnVersionDoc asks SkyMp.IsLocal(cfg) before any server field is taken
    - serverAddress, serverPort and voicePort are taken only when not local
    - collectionUrl and the other fields are still taken either way
    - launcher.log is told once, with the address and port, why they were not
  and launcher\app\SkyMp.cs, that IsLocal is the loopback test Play uses.
*/
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const app = path.join(root, 'launcher', 'app');
const read = (f) => fs.readFileSync(path.join(app, f), 'utf8');

let failed = 0;
function check(ok, what) {
  console.log((ok ? 'PASS ' : 'FAIL ') + what);
  if (!ok) failed++;
}

const upd = read('ShellUpdate.cs');
const start = upd.indexOf('static void OnVersionDoc(');
check(start >= 0, 'ShellUpdate.cs has OnVersionDoc');
// The body up to the next method's summary is enough: every field the feed
// moves is taken in the first part of it.
const end = upd.indexOf('ShowNotice(v);', start);
check(end > start, 'OnVersionDoc reaches ShowNotice');
const body = upd.slice(start, end);

const localAt = body.search(/bool\s+local\s*=\s*SkyMp\.IsLocal\(cfg\)\s*;/);
check(localAt >= 0, 'OnVersionDoc asks SkyMp.IsLocal(cfg)');

function takeLine(field, cfgField) {
  const re = new RegExp('^.*' + cfgField.replace('.', '\\.') + '\\s*=\\s*v\\.' + field + '\\b.*$', 'm');
  const m = body.match(re);
  return m ? { line: m[0], at: body.indexOf(m[0]) } : null;
}

for (const [field, cfgField] of [['serverAddress', 'cfg.ServerAddress'], ['serverPort', 'cfg.ServerPort']]) {
  const t = takeLine(field, cfgField);
  check(t !== null, field + ' is taken in OnVersionDoc');
  if (t) {
    check(/!\s*local\s*&&/.test(t.line), field + ' is taken only when the config is not local');
    check(t.at > localAt, field + ' is taken after local is known');
  }
}

// voicePort sits in an if block of its own, the line before the assignment.
const vp = body.match(/^\s*if\s*\((.*v\.voicePort.*)\)\s*\{?\s*\n?\s*cfg\.VoicePort\s*=\s*v\.voicePort/m);
check(vp !== null, 'voicePort is taken in OnVersionDoc');
if (vp) check(/!\s*local\s*&&/.test(vp[1]), 'voicePort is taken only when the config is not local');

// The rest of what the feed carries is about the release, not where the
// server is, and still moves for a local config.
const coll = takeLine('collectionUrl', 'cfg.CollectionUrl');
check(coll !== null && !/local/.test(coll.line), 'collectionUrl is still taken whatever the server');
const site = takeLine('siteUrl', 'cfg.SiteUrl');
check(site !== null && !/local/.test(site.line), 'siteUrl is still taken whatever the server');

// Said in launcher.log once, with the address and port.
check(/LogOnly\("This launcher points at a server on this machine \(" \+ cfg\.ServerAddress \+ ":" \+ cfg\.ServerPort/.test(body),
  'launcher.log says once that the feed\'s server address and ports are not taken, naming the local one');
check(/static bool localSaid;/.test(upd) && /if \(local && !localSaid\)/.test(body) && /if \(!local\) localSaid = false;/.test(body),
  'the line is said once while local, and again after the config names a server elsewhere and comes back');

const sky = read('SkyMp.cs');
const isLocal = sky.match(/public static bool IsLocal\(Config cfg\)\s*\{([\s\S]*?)\n        \}/);
check(isLocal !== null, 'SkyMp.cs has IsLocal');
if (isLocal) {
  check(/"127\.0\.0\.1"/.test(isLocal[1]) && /"localhost"/.test(isLocal[1]) && /"::1"/.test(isLocal[1]),
    'IsLocal is 127.0.0.1, localhost and ::1, and nothing wider');
}

console.log(failed === 0 ? 'ALL PASS' : failed + ' FAILED');
process.exit(failed === 0 ? 0 : 1);
