// test-release-copies.js
//
// Downloads come from this repository's Releases (#3686), while every
// launcher keeps asking thornswood.net/feed[-dev]/assets/<sha256>. The site
// answers an asset with a redirect to where GitHub keeps its Release copy
// once GitHub says the Release of the feed's current release holds it under
// its sha256, with that sha256 as GitHub's own digest and the site's size.
// Until then, and for anything else, the site sends the bytes itself.
//
// Where GitHub keeps a file is asked of the API's asset route, by the
// asset's id, never github.com's download address (#5608): on 9 Nov 2026
// GitHub answered every anonymous request to github.com with 504 while its
// API kept answering. Part 6 drives assetLocation, part 7 the list of
// Releases the launcher reads and the /release/<tag>/<name> route.
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
const STORE = 'https://release-assets.githubusercontent.com/github-production-release-asset/1365246621/';

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
    'return { releaseCopy, releaseCopies, RELEASE_LOOK_MS, feedReleaseTag, newestSetup, assetLocation, ASSET_KEEP_MS,\n' +
    '  releaseAsset, releaseList, RELEASE_KEEP_MS, LIST_SIGNED_MS, signed: (v) => { githubSigned = v; } };');
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
let nextId = 100;
function asset(name, digestSha, size, extra) {
  return Object.assign({ id: nextId++, name, state: 'uploaded', size, digest: 'sha256:' + digestSha }, extra || {});
}

async function main() {
  if (!block) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
  const mainDoc = { launcherVersion: '1.2.7', release: { id: '20261026-170000', channel: 'main', tag: TAG } };

  // ---- 1. a private repository, or no Release yet: the site sends the bytes
  let t = load(() => ({ status: 404, why: 'GitHub answered 404' }), { feed: mainDoc });
  yes('the feed\'s release tag is read from its newest generation', t.api.feedReleaseTag('feed') === TAG);
  yes('while GitHub answers 404 (private, or no Release yet), no redirect', t.api.releaseCopy('feed', A, 10) === 0);
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
    asset(B.slice(0, 63) + 'e', B.slice(0, 63) + 'e', 40, { id: undefined }) // no asset id to ask the API for
  ];
  t = load((p) => p.startsWith('/releases?') ? releases([
      { id: 7, tag_name: 'release/dev/20261026-160000-dev', draft: false },
      { id: 8, tag_name: TAG, draft: false }])
    : p === '/releases/8/assets?per_page=100&page=1' ? releases(assets) : { status: 404, why: 'GitHub answered 404' },
    { feed: mainDoc, 'feed-dev': { release: { tag: 'release/dev/20261026-160000-dev' } } });
  yes('the first ask for a Release is served from the site', t.api.releaseCopy('feed', A, 10) === 0);
  await tick(); await tick(); await tick();
  yes('once GitHub holds it, the asset is the Release copy, by its asset id', t.api.releaseCopy('feed', A, 10) === assets[0].id);
  yes('  never when the site\'s file is another size', t.api.releaseCopy('feed', A, 11) === 0);
  yes('  never for an asset whose name is not GitHub\'s own sha256 of it', t.api.releaseCopy('feed', B, 20) === 0);
  yes('  never for an upload GitHub has not finished', t.api.releaseCopy('feed', C, 30) === 0);
  yes('  never for an asset GitHub gave no id', t.api.releaseCopy('feed', B.slice(0, 63) + 'e', 40) === 0);
  yes('  and a file the Release does not hold is served from the site', t.api.releaseCopy('feed', 'f'.repeat(64), 5) === 0);
  const asked = t.calls.length;
  t.clock.now += 10 * t.api.RELEASE_LOOK_MS;
  t.api.releaseCopy('feed', A, 10); await tick();
  yes('a Release once seen is never asked about again', t.calls.length === asked);
  yes('a file named other than its sha256 is no feed file, the setup program included', t.api.releaseCopy('feed', I, 99) === 0);

  // ---- 3. a draft, a feed with no tag, a tag of another shape -------------
  t = load(() => releases([{ id: 9, tag_name: TAG, draft: true }]), { feed: mainDoc });
  t.api.releaseCopy('feed', A, 10); await tick(); await tick();
  yes('a draft Release is not used', t.api.releaseCopy('feed', A, 10) === 0 && t.calls.length === 1);
  t = load(() => releases([]), { feed: { release: { tag: 'v1.2.7' } }, 'feed-dev': { launcherVersion: '1' } });
  yes('a feed whose release tag is not release/<channel>/<id> asks GitHub nothing',
      t.api.releaseCopy('feed', A, 10) === 0 && t.api.releaseCopy('feed-dev', A, 10) === 0 && t.calls.length === 0);

  // ---- 4. the routes ------------------------------------------------------
  const assetRoute = server.indexOf("const feedAsset = p.match(");
  const assetEnd = server.indexOf('return fs.createReadStream(file).pipe(res);', assetRoute);
  const assetBody = assetRoute >= 0 && assetEnd > assetRoute ? server.slice(assetRoute, assetEnd) : '';
  const redirectAt = assetBody.indexOf('releaseCopy(feedAsset[1], feedAsset[2], st.size)');
  yes('the feed asset route asks for the Release copy after it found its own file',
      redirectAt > assetBody.indexOf('fs.existsSync(file)') && redirectAt > assetBody.indexOf('const st = fs.statSync(file)'));
  yes('  and answers 302 to where GitHub keeps it, from the API\'s asset route, before any byte is sent',
      /const at = copy \? await assetLocation\(copy\) : null;\s*if \(at && at\.url\) \{\s*res\.writeHead\(302, \{ location: at\.url, 'cache-control': 'no-store'/.test(assetBody.slice(redirectAt)) &&
      redirectAt < assetBody.indexOf('rangeReply('));
  const fileRoute = server.indexOf('const dl = p.match(/^\\/file\\/');
  const fileBody = fileRoute >= 0 ? server.slice(fileRoute, server.indexOf('rangeReply(', fileRoute)) : '';
  const setupAt = fileBody.indexOf('newestSetup(ch)');
  yes('/file/ answers a setup program\'s name from its Release, before it looks in the downloads folder',
      setupAt >= 0 && setupAt < fileBody.indexOf('path.join(FILES, dl[1])') &&
      /const ch = setupChannel\(dl\[1\]\);\s*if \(ch\) \{/.test(fileBody));
  yes('  302 to where GitHub keeps it, from the API\'s asset route, or 404 while there is none, and never a byte from the site',
      /if \(!setup\) return errorAnswer\(req, res, 404, /.test(fileBody.slice(setupAt)) &&
      /const at = await assetLocation\(setup\.id\);\s*if \(!at\.url\) \{[^}]*return errorAnswer\(req, res, 503, /.test(fileBody.slice(setupAt)) &&
      /res\.writeHead\(302, \{ location: at\.url/.test(fileBody.slice(setupAt)));
  yes('no address the site gives out is a github.com download any more', server.indexOf('/releases/download/') < 0);

  // ---- 5. the setup programs (#4824) ---------------------------------------
  const SITE = 'https://thornswood.net/release/';
  const E = 'e'.repeat(64), F = 'f'.repeat(64);
  const setupAsset = (tag, name, sha, size, extra) => Object.assign({ id: nextId++, name, state: 'uploaded', size,
    digest: 'sha256:' + sha }, extra || {});
  const rel = (tag, at, assets, extra) => Object.assign({ id: 1, tag_name: tag, draft: false,
    published_at: at, assets }, extra || {});
  // Newest first by when each was published, whatever order GitHub lists them in.
  const list5 = [
    rel('build-20261101.3', '2026-11-01T12:00:00Z', [setupAsset('build-20261101.3', 'Thornswood-Dev-Setup.exe', E, 50)]),
    rel('build-20261101.5', '2026-11-01T15:00:00Z', [setupAsset('build-20261101.5', 'Thornswood-Dev-Setup.exe', F, 60),
      setupAsset('build-20261101.5', 'Thornswood-Dev-Move.exe', E, 8)]),
    rel('build-20261101.6', '2026-11-01T16:00:00Z', [setupAsset('build-20261101.6', 'Thornswood-Dev-Setup.exe', A, 70)], { draft: true }),
    rel('build-20261101.7', '2026-11-01T17:00:00Z', [setupAsset('build-20261101.7', 'Thornswood-Dev-Setup.exe', B, 80, { state: 'starter' })]),
    rel('main-build-20261031.2', '2026-10-31T09:00:00Z', [setupAsset('main-build-20261031.2', 'Thornswood-Setup.exe', C, 90),
      setupAsset('main-build-20261031.2', 'Thornswood-Move.exe', E, 8, { digest: 'sha1:' + 'a'.repeat(40) })]),
    rel('main-build-20261101.3', '2026-11-01T13:00:00Z', [setupAsset('main-build-20261101.3', 'Thornswood-Setup.exe', I, 99, { digest: 'sha1:' + 'a'.repeat(40) })]),
    rel('release/main/20261026-170000', '2026-11-01T18:00:00Z', [setupAsset('release/main/20261026-170000', 'Thornswood-Setup.exe', A, 10)]),
    rel('main-build-20261030.1', '2026-10-30T09:00:00Z', [setupAsset('main-build-20261030.1', 'Thornswood-Setup.exe', A, 11,
      { id: 0 })])
  ];
  t = load((p) => p === '/releases?per_page=100&page=1' ? releases(list5) : { status: 404, why: 'GitHub answered 404' }, {});
  yes('before GitHub has answered there is no setup program to offer', t.api.newestSetup('main') === null && t.api.newestSetup('dev') === null);
  await tick(); await tick();
  yes('  and GitHub was asked once, a hundred Releases a page', t.calls.length === 1 && t.calls[0] === '/releases?per_page=100&page=1');
  const m5 = t.api.newestSetup('main'), d5 = t.api.newestSetup('dev');
  yes('main\'s is Thornswood-Setup.exe on the newest Release main-<tag> that holds it whole',
      !!m5 && m5.name === 'Thornswood-Setup.exe' && m5.tag === 'main-build-20261031.2' && m5.sha256 === C && m5.size === 90 &&
      m5.id === list5[4].assets[0].id && !('url' in m5));
  yes('  passing over one with no sha256 digest, one with no asset id and a tag of another shape',
      !!m5 && m5.tag !== 'main-build-20261101.3' && m5.tag !== 'main-build-20261030.1' && m5.tag !== 'release/main/20261026-170000');
  yes('dev\'s is Thornswood-Dev-Setup.exe on the newest published build Release that holds it',
      !!d5 && d5.name === 'Thornswood-Dev-Setup.exe' && d5.tag === 'build-20261101.5' && d5.sha256 === F && d5.size === 60);
  yes('the move program on the same Release as dev\'s setup is named with it, with GitHub\'s sha256 (feedMove)',
      !!d5 && !!d5.move && d5.move.name === 'Thornswood-Dev-Move.exe' && d5.move.sha256 === E && d5.move.size === 8 &&
      d5.move.id === list5[1].assets[1].id && d5.move.url === SITE + 'build-20261101.5/Thornswood-Dev-Move.exe');
  yes('  and one with no sha256 digest is not, so main has none', !!m5 && m5.move === null);
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
  // The move back to 1.3.x (Patrick, 8 Nov 2026): build-1.3.<n> Releases,
  // published after the date numbered ones, are each channel's newest.
  t = load(() => releases([
    rel('build-20261108.2', '2026-11-08T19:34:00Z', [setupAsset('build-20261108.2', 'Thornswood-Dev-Setup.exe', E, 5)]),
    rel('build-1.3.0', '2026-11-09T10:00:00Z', [setupAsset('build-1.3.0', 'Thornswood-Dev-Setup.exe', F, 6)]),
    rel('main-build-20261108.2', '2026-11-08T19:42:00Z', [setupAsset('main-build-20261108.2', 'Thornswood-Setup.exe', E, 7)]),
    rel('main-build-1.3.0', '2026-11-09T12:00:00Z', [setupAsset('main-build-1.3.0', 'Thornswood-Setup.exe', F, 8)])]), {});
  t.api.newestSetup('main'); await tick(); await tick();
  yes('a build-1.3.<n> Release published after the date numbered ones is the newest, on dev and on main',
      !!t.api.newestSetup('dev') && t.api.newestSetup('dev').tag === 'build-1.3.0' &&
      !!t.api.newestSetup('main') && t.api.newestSetup('main').tag === 'main-build-1.3.0');
  // A main Release older than the first hundred build Releases is still found.
  const page1 = [];
  for (let n = 0; n < 100; n++) page1.push(rel('build-20261101.' + (100 + n), '2026-11-01T10:00:00Z', []));
  t = load((p) => p.endsWith('page=1') ? releases(page1)
    : p.endsWith('page=2') ? releases([rel('main-build-20261001.1', '2026-10-01T10:00:00Z', [setupAsset('main-build-20261001.1', 'Thornswood-Setup.exe', E, 7)])])
    : releases([]), {});
  t.api.newestSetup('main'); for (let n = 0; n < 6; n++) await tick();
  yes('a Release main-<tag> past the first page is found on the next', t.calls.length === 2 &&
      !!t.api.newestSetup('main') && t.api.newestSetup('main').tag === 'main-build-20261001.1');

  // ---- 6. where GitHub keeps an asset, from the API (#5608) ---------------
  const where = (id) => STORE + id + '?sp=r&sig=x';
  t = load((p) => p === '/releases/assets/7' ? { status: 302, location: where(7) }
    : p === '/releases/assets/8' ? { status: 302, location: 'https://github.com/ThornswoodRP/Thornswood/releases/download/x/y' }
    : p === '/releases/assets/9' ? { status: 302, location: 'https://objects.githubusercontent.com.evil.example/9' }
    : { status: 0, why: 'GitHub did not answer inside ten seconds' }, {});
  let got = await t.api.assetLocation(7);
  yes('the API\'s asset route is asked by the asset\'s id, and its 302 to GitHub\'s storage is the answer',
      got.url === where(7) && t.calls.length === 1 && t.calls[0] === '/releases/assets/7');
  got = await t.api.assetLocation(7);
  yes('  kept a while, so many asking at once cost GitHub one call', got.url === where(7) && t.calls.length === 1);
  t.clock.now += t.api.ASSET_KEEP_MS;
  got = await t.api.assetLocation(7);
  yes('  and asked again once that is over, since GitHub signs it for minutes', got.url === where(7) && t.calls.length === 2);
  got = await t.api.assetLocation(8);
  yes('a 302 anywhere but GitHub\'s storage hosts is not passed on, github.com included', !got.url && /storage/.test(got.why));
  got = await t.api.assetLocation(9);
  yes('  nor a host that only starts like one', !got.url);
  got = await t.api.assetLocation(10);
  yes('GitHub not answering is said, not a redirect', !got.url && /ten seconds/.test(got.why));
  const callsBefore = t.calls.length;
  got = await t.api.assetLocation(0);
  yes('no asset id asks GitHub nothing', !got.url && t.calls.length === callsBefore);

  // ---- 7. the Releases the launcher reads, and the Release route -----------
  const list7 = [
    rel('build-1.3.5', '2026-11-09T10:00:00Z', [setupAsset('build-1.3.5', 'releases.dev.json', E, 5),
      setupAsset('build-1.3.5', 'Thornswood-1.3.5-dev-full.nupkg', F, 500), setupAsset('build-1.3.5', 'manifest.json', A, 6),
      setupAsset('build-1.3.5', 'half.nupkg', B, 7, { state: 'starter' })], { name: 'Release build-1.3.5', body: 'notes' }),
    rel('build-1.3.6', '2026-11-09T11:00:00Z', [setupAsset('build-1.3.6', 'releases.dev.json', E, 5)], { draft: true }),
    rel('release/main/20261026-170000', '2026-11-01T18:00:00Z', [setupAsset('release/main/20261026-170000', A, A, 10)])
  ];
  const ids7 = { feed: list7[0].assets[0].id, pkg: list7[0].assets[1].id, man: list7[0].assets[2].id };
  t = load((p) => p === '/releases?per_page=100&page=1' ? releases(list7)
    : p === '/releases/assets/' + ids7.pkg ? { status: 302, location: where(ids7.pkg) }
    : p === '/releases/tags/build-1.3.1' ? releases(rel('build-1.3.1', '2026-11-01T10:00:00Z', [setupAsset('build-1.3.1', 'manifest.cat', C, 3)]))
    : /^\/releases\/assets\/\d+$/.test(p) ? { status: 302, location: where(p.split('/').pop()) }
    : { status: 404, why: 'GitHub answered 404' }, {});
  const body7 = await t.api.releaseList();
  const doc7 = JSON.parse(body7);
  yes('the launcher\'s list is GitHub\'s, the published Releases with a tag a route can carry',
      doc7.length === 1 && doc7[0].tag_name === 'build-1.3.5' && doc7[0].name === 'Release build-1.3.5' &&
      doc7[0].published_at === '2026-11-09T10:00:00Z' && doc7[0].prerelease === false);
  yes('  each finished file named with this site\'s Release route as its address, and nothing of GitHub\'s',
      doc7[0].assets.length === 3 && doc7[0].assets.every((a) => a.browser_download_url === '/release/build-1.3.5/' + a.name && a.url === a.browser_download_url) &&
      !/github\.com|"id"|"body"/.test(body7));
  const listCalls = t.calls.length;
  await t.api.releaseList();
  yes('  kept, and not asked again inside the wait', t.calls.length === listCalls);
  t.clock.now += t.api.LIST_SIGNED_MS;
  await t.api.releaseList();
  yes('  which is ten minutes without the site\'s token', t.calls.length === listCalls);
  t.api.signed(true);
  await t.api.releaseList();
  yes('  and a minute with it', t.calls.length === listCalls + 1);
  got = await t.api.releaseAsset('build-1.3.5', 'Thornswood-1.3.5-dev-full.nupkg');
  yes('/release/<tag>/<name> of a file in the list is where GitHub keeps it', got.url === where(ids7.pkg) &&
      t.calls[t.calls.length - 1] === '/releases/assets/' + ids7.pkg);
  let n7 = t.calls.length;
  got = await t.api.releaseAsset('build-1.3.5', 'half.nupkg');
  yes('  a file GitHub has not finished taking is missing, and GitHub is not asked', got.missing === true && t.calls.length === n7);
  got = await t.api.releaseAsset('build-1.3.6', 'releases.dev.json');
  yes('  a draft\'s file is missing', got.missing === true);
  got = await t.api.releaseAsset('build-1.3.5', '../manifest.json');
  yes('  a name a route cannot carry is missing', got.missing === true);
  n7 = t.calls.length;
  got = await t.api.releaseAsset('anything-at-all', 'x.exe');
  yes('  a tag that is no build Release is missing without asking GitHub, so nobody spends the site\'s calls on names',
      got.missing === true && t.calls.length === n7);
  got = await t.api.releaseAsset('build-1.3.1', 'manifest.cat');
  yes('an older build Release, past the list, is asked for by its tag',
      !!got.url && t.calls.includes('/releases/tags/build-1.3.1'));
  n7 = t.calls.length;
  got = await t.api.releaseAsset('build-1.3.1', 'manifest.json');
  yes('  and kept: a file it does not hold is missing without asking again', got.missing === true && t.calls.length === n7);
  got = await t.api.releaseAsset('build-1.3.2', 'manifest.json');
  yes('  one GitHub has never heard of is missing', got.missing === true && t.calls.includes('/releases/tags/build-1.3.2'));
  n7 = t.calls.length;
  await t.api.releaseAsset('build-1.3.2', 'manifest.json');
  yes('  and not asked again inside RELEASE_KEEP_MS', t.calls.length === n7);
  t = load(() => ({ status: 0, why: 'GitHub did not answer inside ten seconds' }), {});
  yes('with no answer from GitHub yet, there is no list to give (the route says 503)', (await t.api.releaseList()) === null);
  got = await t.api.releaseAsset('build-1.3.9', 'manifest.json');
  yes('  and a file of a build Release GitHub could not be asked about is a why, not a 404', !got.url && !got.missing && /ten seconds/.test(got.why));
  // The move program, on a setup program's Release.
  const mainRel = rel('main-build-1.3.0', '2026-11-08T12:00:00Z',
    [setupAsset('main-build-1.3.0', 'Thornswood-Setup.exe', F, 8), setupAsset('main-build-1.3.0', 'Thornswood-Move.exe', E, 4)]);
  t = load((p) => p.startsWith('/releases?') ? releases([mainRel])
    : /^\/releases\/assets\/\d+$/.test(p) ? { status: 302, location: where(p.split('/').pop()) }
    : { status: 404, why: 'GitHub answered 404' }, {});
  t.api.newestSetup('main'); await tick(); await tick();
  const mv = t.api.newestSetup('main');
  yes('the move program\'s address is this site\'s Release route, which the old launcher allows',
      !!mv && !!mv.move && mv.move.url === SITE + 'main-build-1.3.0/Thornswood-Move.exe');
  got = await t.api.releaseAsset('main-build-1.3.0', 'Thornswood-Move.exe');
  yes('  and that route sends it on to where GitHub keeps it', got.url === where(mv.move.id));
  let lists = 0;
  t = load((p) => p.startsWith('/releases?') ? releases(++lists === 1 ? [mainRel] : [])
    : /^\/releases\/assets\/\d+$/.test(p) ? { status: 302, location: where(p.split('/').pop()) }
    : { status: 404, why: 'GitHub answered 404' }, {});
  t.api.newestSetup('main'); await tick(); await tick();
  got = await t.api.releaseAsset('main-build-1.3.0', 'Thornswood-Setup.exe');
  yes('  a setup program\'s Release past the newest hundred still has its route, from what newestSetup found',
      lists === 2 && got.url === where(mainRel.assets[0].id));

  // The site's routes for the two (serve.js).
  const listRoute = server.indexOf("route === '/api/launcher/releases'");
  const relRoute = server.indexOf('const relFile = p.match(');
  const relBody = relRoute >= 0 ? server.slice(relRoute, server.indexOf('// ----', relRoute)) : '';
  yes('/api/launcher/releases answers the list, or 503 before GitHub has said',
      listRoute >= 0 && /const list = await releaseList\(\);\s*if \(list === null\) return send\(res, 503,/.test(server.slice(listRoute, relRoute)));
  yes('/release/<tag>/<name> answers 302 to where GitHub keeps it, 404 for no such file, 503 when GitHub could not say',
      /const at = await releaseAsset\(relFile\[1\], relFile\[2\]\);/.test(relBody) && /location: at\.url, 'cache-control': 'no-store'/.test(relBody) &&
      /if \(at\.missing\) return errorAnswer\(req, res, 404,/.test(relBody) && /errorAnswer\(req, res, 503,/.test(relBody));
  yes('  both held to the public API\'s rate per address', /launcher\\\/releases\)\$\/\.test\(route\)/.test(server) && /\/\^\\\/release\\\/\/\.test\(route\)/.test(server));

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
