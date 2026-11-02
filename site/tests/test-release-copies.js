// test-release-copies.js
//
// Downloads come from this repository's Releases (#3686), while every
// launcher keeps asking thornswood.net/feed[-dev]/assets/<sha256>. The site
// answers an asset with a redirect to its GitHub Release copy once GitHub,
// asked without a token, says the Release of the feed's current release holds
// it under its sha256, with that sha256 as GitHub's own digest and the site's
// size. Until then, and for anything else, the site sends the bytes itself.
//
// The "release copies" block is lifted out of site/server.js by its markers
// and run with GitHub's answers stubbed, against a temp feed folder. Then the
// two routes that use it are checked for the redirect in front of the bytes.
//
// The same block holds the setup programs (#4824): the download is Velopack's
// Thornswood-Setup.exe from the newest Release main-<tag>, and dev's
// Thornswood-Dev-Setup.exe from the newest build Release <tag>, each with
// GitHub's own sha256 beside it. Part 5 drives that half: what is found and
// what is passed over, the wait between asks, what a failed ask keeps, and
// the /file/ route's 302, or its 404 while there is none.
//
// Read only. Writes to a temp folder and nowhere else.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const CR = String.fromCharCode(13);
const server = siteFiles.source().split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), I = 'd'.repeat(64);
const TAG = 'release/main/20261026-170000';
const DL = 'https://github.com/ThornswoodRP/Thornswood/releases/download/release/main/20261026-170000/';

const from = server.indexOf('/* ---- release copies (#3686) ----');
const to = server.indexOf('/* ---- end release copies ---- */');
yes('the release copies block is in server.js, between its markers', from >= 0 && to > from);
const block = from >= 0 && to > from ? server.slice(from, to) : '';

// The block, with its GitHub call replaced by what each test says GitHub
// answers, and feedFile pointed at a temp store.
function load(answer, feedDocs) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-release-copies-'));
  const files = {};
  for (const ch of Object.keys(feedDocs)) {
    const f = path.join(tmp, ch + '-00000001.json');
    fs.writeFileSync(f, JSON.stringify(feedDocs[ch]));
    files[ch] = f;
  }
  const calls = [];
  const env = {
    https: null,
    feedFile: (ch) => files[ch] || null,
    readJsonQuiet: (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } },
    calls
  };
  const make = new Function('env', 'Date', 'console',
    'const { https, feedFile, readJsonQuiet } = env;\n' + block + '\n' +
    'releaseGitHub = (p) => { env.calls.push(p); return Promise.resolve(env.answer(p)); };\n' +
    'return { releaseCopy, releaseCopies, RELEASE_LOOK_MS, feedReleaseTag, newestSetup };');
  // releaseGitHub is a function declaration in the block, so it can be
  // replaced by assignment inside the same function body.
  env.answer = answer;
  const clock = { now: 1000 };
  const FakeDate = { now: () => clock.now, parse: Date.parse };
  const quiet = { log: () => {}, error: () => {} };
  return { api: make(env, FakeDate, quiet), calls, clock, env };
}
const tick = () => new Promise((r) => setImmediate(r));

function releases(list) { return { status: 200, body: list }; }
function asset(name, digestSha, size, extra) {
  return Object.assign({ name, state: 'uploaded', size, digest: 'sha256:' + digestSha,
    browser_download_url: DL + name }, extra || {});
}

async function main() {
  if (!block) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
  const mainDoc = { launcherVersion: '1.2.7', release: { id: '20261026-170000', channel: 'main', tag: TAG } };

  // ---- 1. a private repository, or no Release yet: the site sends the bytes
  let t = load(() => ({ status: 404, why: 'GitHub answered 404' }), { feed: mainDoc });
  yes('the feed\'s release tag is read from its newest generation', t.api.feedReleaseTag('feed') === TAG);
  yes('while GitHub answers 404 (private, or no Release yet), no redirect', t.api.releaseCopy('feed', A, 10) === '');
  await tick(); await tick();
  yes('  and GitHub was asked once, for the Release list', t.calls.length === 1 && t.calls[0] === '/releases?per_page=30');
  t.api.releaseCopy('feed', A, 10); await tick();
  yes('  and not again inside the wait', t.calls.length === 1);
  t.clock.now += t.api.RELEASE_LOOK_MS;
  t.api.releaseCopy('feed', A, 10); await tick();
  yes('  but again once the wait is over', t.calls.length === 2);

  // ---- 2. the Release is there: the files GitHub vouches for redirect -----
  const assets = [
    asset(A, A, 10),                                        // good
    asset(B, C, 20),                                        // name is not GitHub's digest
    asset(C, C, 30, { state: 'starter' }),                  // not finished uploading
    asset('Thornswood-Setup.exe', I, 99),                   // a setup program, not a feed file
    asset(B.slice(0, 63) + 'e', B.slice(0, 63) + 'e', 40,
      { browser_download_url: 'https://evil.example/' + B.slice(0, 63) + 'e' }) // not this repository
  ];
  t = load((p) => p.startsWith('/releases?') ? releases([
      { id: 7, tag_name: 'release/dev/20261026-160000-dev', draft: false },
      { id: 8, tag_name: TAG, draft: false }])
    : p === '/releases/8/assets?per_page=100&page=1' ? releases(assets) : { status: 404, why: 'GitHub answered 404' },
    { feed: mainDoc, 'feed-dev': { release: { tag: 'release/dev/20261026-160000-dev' } } });
  yes('the first ask for a Release is served from the site', t.api.releaseCopy('feed', A, 10) === '');
  await tick(); await tick(); await tick();
  yes('once GitHub holds it, the asset redirects to the Release copy', t.api.releaseCopy('feed', A, 10) === DL + A);
  yes('  never when the site\'s file is another size', t.api.releaseCopy('feed', A, 11) === '');
  yes('  never for an asset whose name is not GitHub\'s own sha256 of it', t.api.releaseCopy('feed', B, 20) === '');
  yes('  never for an upload GitHub has not finished', t.api.releaseCopy('feed', C, 30) === '');
  yes('  never for an address outside this repository\'s Releases', t.api.releaseCopy('feed', B.slice(0, 63) + 'e', 40) === '');
  yes('  and a file the Release does not hold is served from the site', t.api.releaseCopy('feed', 'f'.repeat(64), 5) === '');
  const asked = t.calls.length;
  t.clock.now += 10 * t.api.RELEASE_LOOK_MS;
  t.api.releaseCopy('feed', A, 10); await tick();
  yes('a Release once seen is never asked about again', t.calls.length === asked);
  yes('a file named other than its sha256 is no feed file, the setup program included', t.api.releaseCopy('feed', I, 99) === '');

  // ---- 3. a draft, a feed with no tag, a tag of another shape -------------
  t = load(() => releases([{ id: 9, tag_name: TAG, draft: true }]), { feed: mainDoc });
  t.api.releaseCopy('feed', A, 10); await tick(); await tick();
  yes('a draft Release is not used', t.api.releaseCopy('feed', A, 10) === '' && t.calls.length === 1);
  t = load(() => releases([]), { feed: { release: { tag: 'v1.2.7' } }, 'feed-dev': { launcherVersion: '1' } });
  yes('a feed whose release tag is not release/<channel>/<id> asks GitHub nothing',
      t.api.releaseCopy('feed', A, 10) === '' && t.api.releaseCopy('feed-dev', A, 10) === '' && t.calls.length === 0);

  // ---- 4. the routes ------------------------------------------------------
  const assetRoute = server.indexOf("const feedAsset = p.match(");
  const assetEnd = server.indexOf('return fs.createReadStream(file).pipe(res);', assetRoute);
  const assetBody = assetRoute >= 0 && assetEnd > assetRoute ? server.slice(assetRoute, assetEnd) : '';
  const redirectAt = assetBody.indexOf('releaseCopy(feedAsset[1], feedAsset[2], st.size)');
  yes('the feed asset route asks for the Release copy after it found its own file',
      redirectAt > assetBody.indexOf('fs.existsSync(file)') && redirectAt > assetBody.indexOf('const st = fs.statSync(file)'));
  yes('  and answers 302 to it before any byte is sent',
      /if \(copy\) \{\s*res\.writeHead\(302, \{ location: copy/.test(assetBody.slice(redirectAt)) &&
      redirectAt < assetBody.indexOf('rangeReply('));
  const fileRoute = server.indexOf('const dl = p.match(/^\\/file\\/');
  const fileBody = fileRoute >= 0 ? server.slice(fileRoute, server.indexOf('rangeReply(', fileRoute)) : '';
  const setupAt = fileBody.indexOf('newestSetup(ch)');
  yes('/file/ answers a setup program\'s name from its Release, before it looks in the downloads folder',
      setupAt >= 0 && setupAt < fileBody.indexOf('path.join(FILES, dl[1])') &&
      /if \(dl\[1\] !== SETUP_KINDS\[ch\]\.name\) continue;/.test(fileBody));
  yes('  302 to the Release\'s copy, or 404 while there is none, and never a byte from the site',
      /if \(!setup\) return send\(res, 404, /.test(fileBody.slice(setupAt)) &&
      /res\.writeHead\(302, \{ location: setup\.url/.test(fileBody.slice(setupAt)));

  // ---- 5. the setup programs (#4824) ---------------------------------------
  const MDL = 'https://github.com/ThornswoodRP/Thornswood/releases/download/';
  const E = 'e'.repeat(64), F = 'f'.repeat(64);
  const setupAsset = (tag, name, sha, size, extra) => Object.assign({ name, state: 'uploaded', size,
    digest: 'sha256:' + sha, browser_download_url: MDL + tag + '/' + name }, extra || {});
  const rel = (tag, at, assets, extra) => Object.assign({ id: 1, tag_name: tag, draft: false,
    published_at: at, assets }, extra || {});
  // Newest first by when each was published, whatever order GitHub lists them in.
  const list5 = [
    rel('build-20261101.3', '2026-11-01T12:00:00Z', [setupAsset('build-20261101.3', 'Thornswood-Dev-Setup.exe', E, 50)]),
    rel('build-20261101.5', '2026-11-01T15:00:00Z', [setupAsset('build-20261101.5', 'Thornswood-Dev-Setup.exe', F, 60)]),
    rel('build-20261101.6', '2026-11-01T16:00:00Z', [setupAsset('build-20261101.6', 'Thornswood-Dev-Setup.exe', A, 70)], { draft: true }),
    rel('build-20261101.7', '2026-11-01T17:00:00Z', [setupAsset('build-20261101.7', 'Thornswood-Dev-Setup.exe', B, 80, { state: 'starter' })]),
    rel('main-build-20261031.2', '2026-10-31T09:00:00Z', [setupAsset('main-build-20261031.2', 'Thornswood-Setup.exe', C, 90)]),
    rel('main-build-20261101.3', '2026-11-01T13:00:00Z', [setupAsset('main-build-20261101.3', 'Thornswood-Setup.exe', I, 99, { digest: 'sha1:' + 'a'.repeat(40) })]),
    rel('release/main/20261026-170000', '2026-11-01T18:00:00Z', [setupAsset('release/main/20261026-170000', 'Thornswood-Setup.exe', A, 10)]),
    rel('main-build-20261030.1', '2026-10-30T09:00:00Z', [setupAsset('main-build-20261030.1', 'Thornswood-Setup.exe', A, 11,
      { browser_download_url: 'https://evil.example/Thornswood-Setup.exe' })])
  ];
  t = load((p) => p === '/releases?per_page=100&page=1' ? releases(list5) : { status: 404, why: 'GitHub answered 404' }, {});
  yes('before GitHub has answered there is no setup program to offer', t.api.newestSetup('main') === null && t.api.newestSetup('dev') === null);
  await tick(); await tick();
  yes('  and GitHub was asked once, a hundred Releases a page', t.calls.length === 1 && t.calls[0] === '/releases?per_page=100&page=1');
  const m5 = t.api.newestSetup('main'), d5 = t.api.newestSetup('dev');
  yes('main\'s is Thornswood-Setup.exe on the newest Release main-<tag> that holds it whole',
      !!m5 && m5.name === 'Thornswood-Setup.exe' && m5.tag === 'main-build-20261031.2' && m5.sha256 === C && m5.size === 90 &&
      m5.url === MDL + 'main-build-20261031.2/Thornswood-Setup.exe');
  yes('  passing over one with no sha256 digest, another repository\'s address and a tag of another shape',
      !!m5 && m5.tag !== 'main-build-20261101.3' && m5.tag !== 'main-build-20261030.1' && m5.tag !== 'release/main/20261026-170000');
  yes('dev\'s is Thornswood-Dev-Setup.exe on the newest published build Release that holds it',
      !!d5 && d5.name === 'Thornswood-Dev-Setup.exe' && d5.tag === 'build-20261101.5' && d5.sha256 === F && d5.size === 60);
  yes('  passing over a draft and an upload GitHub has not finished', !!d5 && d5.tag !== 'build-20261101.6' && d5.tag !== 'build-20261101.7');
  t.api.newestSetup('main'); await tick();
  yes('not asked again inside the wait', t.calls.length === 1);
  t.env.answer = () => ({ status: 0, why: 'GitHub did not answer inside ten seconds' });
  t.clock.now += t.api.RELEASE_LOOK_MS;
  t.api.newestSetup('main'); await tick(); await tick();
  yes('asked again once the wait is over, and a failed ask keeps what was found',
      t.calls.length === 2 && t.api.newestSetup('main') === m5 && t.api.newestSetup('dev') === d5);
  t = load(() => releases([rel('build-20261101.9', '2026-11-01T19:00:00Z', [setupAsset('build-20261101.9', 'Thornswood-Dev-Setup.exe', E, 5)])]), {});
  t.api.newestSetup('main'); await tick(); await tick();
  yes('with no Release main-<tag> yet, main has none and dev has its own',
      t.api.newestSetup('main') === null && !!t.api.newestSetup('dev') && t.api.newestSetup('dev').tag === 'build-20261101.9');
  // A main Release older than the first hundred build Releases is still found.
  const page1 = [];
  for (let n = 0; n < 100; n++) page1.push(rel('build-20261101.' + (100 + n), '2026-11-01T10:00:00Z', []));
  t = load((p) => p.endsWith('page=1') ? releases(page1)
    : p.endsWith('page=2') ? releases([rel('main-build-20261001.1', '2026-10-01T10:00:00Z', [setupAsset('main-build-20261001.1', 'Thornswood-Setup.exe', E, 7)])])
    : releases([]), {});
  t.api.newestSetup('main'); for (let n = 0; n < 6; n++) await tick();
  yes('a Release main-<tag> past the first page is found on the next', t.calls.length === 2 &&
      !!t.api.newestSetup('main') && t.api.newestSetup('main').tag === 'main-build-20261001.1');

  // The Downloads list offers main's from its Release and never the old
  // installer's files the downloads folder may still hold.
  const lf = server.indexOf('function listFiles()');
  const lfBody = lf >= 0 ? server.slice(lf, server.indexOf('\n}\n', lf)) : '';
  yes('the Downloads list offers main\'s setup program with GitHub\'s sha256',
      /const setup = newestSetup\('main'\);/.test(lfBody) && /sha256: setup\.sha256/.test(lfBody));
  const ds = server.indexOf('function downloadServed(');
  const dsBody = ds >= 0 ? server.slice(ds, server.indexOf('\n}\n', ds)) : '';
  const oi = server.indexOf('function oldInstaller(');
  const oiBody = oi >= 0 ? server.slice(oi, server.indexOf('\n}\n', oi)) : '';
  const old = new Function(oiBody + '\n}\nreturn oldInstaller;')();
  yes('  and the old installer\'s files in the folder are neither served nor listed',
      /if \(oldInstaller\(name\)\) return false;/.test(dsBody) &&
      ['Thornswood-Setup.exe', 'Thornswood-Setup.zip', 'Thornswood-Setup-20260927-0257.exe', 'Thornswood-Dev-Setup.exe'].every(old) &&
      !['Thornswood-Setup-notes.txt', 'licences.zip', 'files.json'].some(old));
  yes('/api/payload, the old setup program\'s, is gone', server.indexOf("'/api/payload'") < 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.log('FAIL  ' + (e && e.stack)); process.exit(1); });
