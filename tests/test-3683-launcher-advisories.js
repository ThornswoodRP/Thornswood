// test-3683-launcher-advisories.js
//
//     node tests\test-3683-launcher-advisories.js
//
// The libraries the launcher ships have no published security advisory
// (#3683). Patrick, 26 Oct 2026 (report page, q-3683-webview2-watch, A): a
// nightly check asks for advisories on the versions we ship, and a red night
// opens the board issue by itself. Red only when there is a real hole, not on
// every new release of a library.
//
// It began for WebView2, whose three files were copied into launcher\lib from
// Microsoft's NuGet package rather than restored, so nothing else watched
// them. Since #4823 the launcher carries no WebView2 file: it is an SDK
// project whose libraries are PackageReference lines in
// launcher\app\Thornswood.csproj, restored from nuget.org (Avalonia, NLayer,
// ProtectedData, Concentus, SharpSRTP, BouncyCastle, Velopack). Dependabot
// has no nuget entry in .github\dependabot.yml, so this is still what asks.
// Each PackageReference, by the exact version the project names, is asked of
// GitHub's advisory database, where NuGet's advisories are kept:
//   GET https://api.github.com/advisories?ecosystem=nuget&affects=<package>@<v>
// The libraries those pull in (SkiaSharp, HarfBuzzSharp, MicroCom, Tmds.DBus
// and the rest) are not named in the project, so they are not asked here: the
// project restores without a lock file, and their versions are whatever the
// named packages ask for.
// The nightly runs on the box, whose runner account reaches GitHub and
// nothing else on the internet (Install-Runner.ps1's Set-RunnerFirewall), so
// GitHub is the one it can ask (#4092). It asks with no token: GitHub answers
// this path to anybody, sixty an hour from one address, one request for each
// package, and the harness step is given no token on purpose, since every
// harness in the share would hold it.
//
// Only when GitHub gives no answer for a package does it ask osv.dev, which
// carries the same GitHub advisories for NuGet:
//   POST https://api.osv.dev/v1/query
//   {"package":{"name":"<package>","ecosystem":"NuGet"},"version":"<v>"}
// That is the path from a cloud session, whose proxy refuses
// api.github.com/advisories. Either answer with no advisory is a pass. Any
// advisory fails, naming each id and its summary; moving off it is taking the
// fixed version in the project, with its section of THIRD-PARTY.md, the
// credits page and its text in installer\licences in the same pull request.
// One withdrawn by GitHub is not a hole.
// No answer from either is a fail, not a skip: a check that did not happen is
// the failure this exists to stop. It needs the network, so it runs in the
// nightly checks and not in the build check on every pull request
// (tests\gate-excluded.txt).
//
// THORNSWOOD_GHSA_JSON and THORNSWOOD_OSV_JSON, each a path to a saved
// answer, stand in for the network for every package so the verdict can be
// checked by hand. The verdict is also driven over planted answers, so a
// reader that finds nothing cannot pass by accident. Read only.
'use strict';
const fs = require('fs');
const https = require('https');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const PROJECT = path.join('launcher', 'app', 'Thornswood.csproj');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The PackageReference lines of a project, as [{ name, version }], in the
// order written. A reference with no exact version (a range, a floating *, or
// none) is returned with version '' so the caller can say so.
function packages(text) {
  const out = [];
  // A comment is cut until none is left, so one written inside another
  // cannot leave a reference that is not really there.
  let noComments = text, before;
  do { before = noComments; noComments = noComments.replace(/<!--[\s\S]*?-->/g, ''); } while (noComments !== before);
  const re = /<PackageReference\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(noComments)) !== null) {
    const name = /\bInclude="([^"]+)"/.exec(m[1]);
    const ver = /\bVersion="([^"]+)"/.exec(m[1]);
    if (!name) { continue; }
    const v = ver ? ver[1] : '';
    out.push({ name: name[1], version: /^\d+(\.\d+){1,3}(-[0-9A-Za-z.-]+)?$/.test(v) ? v : '' });
  }
  return out;
}

// The advisories in an answer, as [{ id, summary }], or a string saying why
// the answer cannot be read. GitHub answers with a list of advisories,
// osv.dev with an object whose vulns (absent when there is none) are.
function fromGitHub(answer) {
  if (!Array.isArray(answer)) { return 'GitHub answered in a shape this does not read'; }
  return answer.filter(function (a) { return a && !a.withdrawn_at; })
    .map(function (a) { return { id: a.ghsa_id || a.cve_id || '?', summary: a.summary }; });
}
function fromOsv(answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer) ||
      (answer.vulns !== undefined && !Array.isArray(answer.vulns))) { return 'osv.dev answered in a shape this does not read'; }
  return (answer.vulns || []).map(function (v) { return { id: v.id || '?', summary: v.summary }; });
}

// What the advisories say, as { ok, why }.
function verdict(found) {
  if (typeof found === 'string') { return { ok: false, why: found }; }
  if (!Array.isArray(found)) { return { ok: false, why: 'no answer from GitHub\'s advisory database or from osv.dev' }; }
  if (!found.length) { return { ok: true, why: 'no advisory is published for it' }; }
  return { ok: false, why: found.length + ' advisory(ies): ' +
    found.map(function (v) { return String(v.id) + ' ' + String(v.summary || '').split('\n')[0]; }).join('; ') };
}

// One HTTPS request, answering the parsed JSON, or null with a line saying why.
function request(who, options, body) {
  return new Promise(function (resolve) {
    const req = https.request(Object.assign({ timeout: 30000 }, options), function (res) {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { text += c; });
      res.on('end', function () {
        if (res.statusCode !== 200) { console.log('  ' + who + ' answered HTTP ' + res.statusCode + ': ' + text.slice(0, 200).replace(/\s+/g, ' ')); return resolve(null); }
        try { resolve(JSON.parse(text)); } catch (e) { console.log('  ' + who + '\'s answer is not JSON: ' + e.message); resolve(null); }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('no answer in 30 seconds')); });
    req.on('error', function (e) { console.log('  ' + who + ': ' + e.message); resolve(null); });
    req.end(body);
  });
}

function askGitHub(pkg) {
  return request('GitHub', {
    host: 'api.github.com', method: 'GET',
    headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'thornswood-launcher-advisories' },
    path: '/advisories?ecosystem=nuget&per_page=100&affects=' + encodeURIComponent(pkg.name + '@' + pkg.version)
  });
}

function askOsv(pkg) {
  const body = JSON.stringify({ package: { name: pkg.name, ecosystem: 'NuGet' }, version: pkg.version });
  return request('osv.dev', {
    host: 'api.osv.dev', path: '/v1/query', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
}

function saved(name) {
  const file = process.env[name];
  if (!file) { return undefined; }
  console.log('  reading the answer from ' + file + ' (' + name + '), not the network');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log('  ' + e.message); return null; }
}

(async function () {
  // ---- the readers, over planted text --------------------------------------
  const planted = packages('<Project>\n  <ItemGroup>\n    <PackageReference Include="A.B" Version="1.2.3" />\n' +
    '    <!-- <PackageReference Include="Commented" Version="9.9.9" /> -->\n' +
    '    <PackageReference Include="C" Version="[1.0,2.0)" />\n    <PackageReference Version="4.5.6" Include="D"></PackageReference>\n  </ItemGroup>\n</Project>\n');
  yes('the project reader finds each planted PackageReference and its version, in either attribute order',
      planted.length === 3 && planted[0].name === 'A.B' && planted[0].version === '1.2.3' && planted[2].name === 'D' && planted[2].version === '4.5.6');
  yes('  and not one in a comment', !planted.some(function (p) { return p.name === 'Commented'; }));
  yes('  and a version that is not exact reads as none', planted[1].name === 'C' && planted[1].version === '');
  yes('GitHub answering an empty list passes', verdict(fromGitHub([])).ok === true);
  const gh = verdict(fromGitHub([{ ghsa_id: 'GHSA-xxxx-yyyy-zzzz', summary: 'A hole\nmore', withdrawn_at: null }]));
  yes('  an advisory from GitHub fails and names it', gh.ok === false && gh.why.indexOf('GHSA-xxxx-yyyy-zzzz A hole') >= 0 && gh.why.indexOf('more') < 0);
  yes('  one GitHub withdrew does not', verdict(fromGitHub([{ ghsa_id: 'GHSA-aaaa-bbbb-cccc', summary: 'Not a hole', withdrawn_at: '2026-01-01T00:00:00Z' }])).ok === true);
  yes('  and an answer that is not a list fails', verdict(fromGitHub({ message: 'Not Found' })).ok === false);
  yes('osv.dev answering nothing passes', verdict(fromOsv({})).ok === true);
  const osv = verdict(fromOsv({ vulns: [{ id: 'GHSA-xxxx-yyyy-zzzz', summary: 'A hole' }] }));
  yes('  an advisory from osv.dev fails and names it', osv.ok === false && osv.why.indexOf('GHSA-xxxx-yyyy-zzzz A hole') >= 0);
  yes('  and an answer in another shape fails', verdict(fromOsv({ vulns: 'x' })).ok === false && verdict(fromOsv([])).ok === false);
  yes('no answer from either fails', verdict(null).ok === false);

  // ---- the real packages ---------------------------------------------------
  const projectPath = path.join(REPO, PROJECT);
  const shipped = fs.existsSync(projectPath) ? packages(fs.readFileSync(projectPath, 'utf8')) : [];
  yes(PROJECT + ' names the packages the launcher ships (' +
      (shipped.map(function (p) { return p.name + ' ' + (p.version || '?'); }).join(', ') || 'none found') + ')', shipped.length > 0);
  const loose = shipped.filter(function (p) { return !p.version; });
  yes('  each by one exact version, so the advisory asked is for what ships' +
      (loose.length ? ', not: ' + loose.map(function (p) { return p.name; }).join(', ') : ''), loose.length === 0);
  for (const pkg of shipped.filter(function (p) { return p.version; })) {
    let found = null;
    let answer = saved('THORNSWOOD_GHSA_JSON');
    if (answer === undefined && !process.env.THORNSWOOD_OSV_JSON) { answer = await askGitHub(pkg); }
    if (answer) {
      console.log('  GitHub\'s advisory database answered for ' + pkg.name);
      found = fromGitHub(answer);
    } else {
      console.log('  no answer from GitHub for ' + pkg.name + ', so osv.dev is asked');
      answer = saved('THORNSWOOD_OSV_JSON');
      if (answer === undefined) { answer = await askOsv(pkg); }
      if (answer) { console.log('  osv.dev answered'); found = fromOsv(answer); }
    }
    const v = verdict(found);
    yes(pkg.name + ' ' + pkg.version + ': ' + v.why, v.ok);
  }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL  the test itself threw: ' + (e && e.stack || e));
  process.exit(1);
});
