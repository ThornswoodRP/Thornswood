// test-download-hash.js
//
// The Downloads page prints the installer's SHA-256 beside its size and date.
// VirusTotal report links, over-cap waiting copy, and the SmartScreen /
// publisher warn above the button are gone: Setup is Authenticode-signed,
// and the site no longer promises a VT report or a Downloads warn block.
//
// TWO HALVES, AND THIS RUNS BOTH, because the value has to survive the whole
// trip and a field name spelt differently at any one stop drops it silently.
// Since #4824 the installer is Velopack's setup program on a GitHub Release,
// and its SHA-256 is the digest GitHub measured on it there (newestSetup in
// server.js, which test-release-copies.js drives):
//
//   server.js listFiles() passes it on to /api/public, beside a file the
//     downloads folder's files.json lists with a sha256 of its own. Lifted and
//     run against a temp folder, with newestSetup a stand-in.
//   home.html builds the download block from /api/public. The whole /downloads
//     branch of the page script is lifted and run with the fetch stubbed.
//
// The publisher takes the same trip when an entry has one (#5275, Patrick's
// answer A on q-installer-publisher): listFiles passes it on, and the page
// says "Published by" that name, the one Windows shows, and never
// "Thornswood". The Release's installer has none, since nothing on the
// Release says who signed it, and the page then names nobody.
//
// Read only. Writes to a temp folder and nowhere else.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const siteFiles = require('../../tests/site-files');

const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(path.join(REPO_DIR, p), 'utf8').split(CR).join('');
const server = siteFiles.source();
// The page is home.html and the script that builds it, which moved out of
// home.html into home.js in #1479. The downloads builder and esc are in the
// script; the words people read are in either.
const page = read(path.join('site', 'public', 'home.html')) + '\n' + read(path.join('site', 'public', 'home.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-download-hash-'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function main() {
  // ---------------------------------------------------- server.js listFiles
  const lf = /\nfunction listFiles\(\) \{\n[\s\S]*?\n\}\n/.exec(server);
  yes('listFiles is in server.js', !!lf);
  if (lf) {
    const files = path.join(tmp, 'files');
    fs.mkdirSync(files);
    const exeBytes = Buffer.from('the setup program');
    const good = sha(exeBytes);
    const guideBytes = Buffer.from('a guide people may take');
    const guideSha = sha(guideBytes);
    fs.writeFileSync(path.join(files, 'Guide.pdf'), guideBytes);
    fs.writeFileSync(path.join(files, 'Extra.zip'), 'an extra');
    fs.writeFileSync(path.join(files, 'notes.txt'), 'no entry in files.json');
    // The old installer a publish left in the folder, still in files.json.
    fs.writeFileSync(path.join(files, 'Thornswood-Setup.exe'), 'the old exe');
    const meta = {
      // Get-FileHash writes upper case.
      'Guide.pdf': { label: 'The guide', version: 'launcher 1.2.3', sha256: guideSha.toUpperCase(),
        publisher: 'Someone Signing' },
      'Extra.zip': { label: 'extra', sha256: '"><img src=x onerror=alert(1)>' },
      'Thornswood-Setup.exe': { label: 'Thornswood installer', sha256: sha(Buffer.from('the old exe')) }
    };
    // What GitHub said of main's Release (newestSetup, test-release-copies.js).
    const setup = { name: 'Thornswood-Setup.exe', size: 123456789, sha256: good, tag: 'main-build-20261101.3', at: 5,
      url: 'https://github.com/ThornswoodRP/Thornswood/releases/download/main-build-20261101.3/Thornswood-Setup.exe' };
    fs.writeFileSync(path.join(files, 'files.json'), JSON.stringify(meta));
    const jsonFile = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fb; } };
    // listFiles lists only what /file/ serves (downloadServed, #3798).
    const rule = ['function oldInstaller(', 'function downloadServed('].map((h) => {
      const m = new RegExp('\\n' + h.replace('(', '\\(') + '[\\s\\S]*?\\n\\}\\n').exec(server);
      return m ? m[0] : '';
    }).join('');
    yes('the rule for what is served is in server.js', /function downloadServed\(/.test(rule));
    const listFiles = new Function('fs', 'path', 'FILES', 'jsonFile', 'newestSetup',
      rule + lf[0] + '\nreturn listFiles;')(fs, path, files, jsonFile, (ch) => ch === 'main' ? setup : null);
    const list = () => {
      const by = {};
      for (const f of listFiles()) by[f.name] = f;
      return by;
    };
    const by = list();
    const e = by['Thornswood-Setup.exe'] || {};
    const g = by['Guide.pdf'] || {};
    yes('/api/public carries the installer\'s sha256, GitHub\'s from its Release', e.sha256 === good);
    yes('  with the Release\'s size and tag, not the old exe left in the folder',
        e.size === setup.size && e.version === setup.tag && e.hidden === false);
    yes('  and names no publisher, which the Release does not say', e.publisher === '');
    yes('a folder file\'s sha256 from files.json goes out, in lower case', g.sha256 === guideSha);
    yes('  with its publisher', g.publisher === 'Someone Signing');
    yes('an entry with no publisher sends an empty one', (by['Extra.zip'] || {}).publisher === '');
    yes('a value that is not a SHA-256 does not go out', (by['Extra.zip'] || {}).sha256 === '');
    yes('a file files.json says nothing about is not listed at all (#3798)',
        !('notes.txt' in by));
    yes('and nothing that was there before is lost',
        g.label === 'The guide' && g.version === 'launcher 1.2.3' &&
        g.size === guideBytes.length && g.hidden === false);

    // VirusTotal fields no longer go out on /api/public.
    yes('listFiles does not emit vt', !('vt' in e));
    yes('listFiles does not emit vtSkipped', !('vtSkipped' in e));
    yes('listFiles has no VT_CAP constant any more', !/VT_CAP/.test(lf[0]));

    // Stale vtUrl / vtSkipped in files.json must not leak onto the API.
    const withMeta = (extra) => {
      const m = JSON.parse(JSON.stringify(meta));
      Object.assign(m['Guide.pdf'], extra);
      fs.writeFileSync(path.join(files, 'files.json'), JSON.stringify(m));
      return list()['Guide.pdf'] || {};
    };
    const leaked = withMeta({
      vtUrl: 'https://www.virustotal.com/gui/file/' + good,
      vtSubmittedAt: '2026-09-27 03:10',
      vtSkipped: true,
      vtSkipReason: 'key out of quota'
    });
    yes('stale vtUrl in files.json does not appear on the API', !('vt' in leaked) && leaked.sha256 === guideSha);
    yes('stale vtSkipped in files.json does not appear on the API', !('vtSkipped' in leaked));
    yes('and a skip-reason string never goes out either',
        !('vtSkipReason' in leaked) && !JSON.stringify(leaked).includes('quota'));
    fs.writeFileSync(path.join(files, 'files.json'), JSON.stringify(meta));
  }

  // ------------------------------------------------ home.html /downloads
  const a = page.indexOf("} else if (here === '/downloads') {");
  const b = page.indexOf("} else if (here === '/report') {", a);
  const body = (a >= 0 && b > a) ? page.slice(a + "} else if (here === '/downloads') {".length, b) : '';
  const escSrc = (/function esc\(s\)\{[\s\S]*?\}\); \}/.exec(page) || [''])[0];
  yes('the downloads builder and esc are both on the page', !!body && !!escSrc);
  if (body && escSrc) {
    const esc = new Function(escSrc + '\nreturn esc;')();
    function render(payload) {
      let html = null;
      const fetch = () => Promise.resolve({ json: () => payload });
      // The builder asks through request(), the page's fetch with a time
      // limit (#1585); here both answer with the same payload.
      new Function('fetch', 'request', 'show', 'esc', body)(fetch, fetch, (h) => { html = h; }, esc);
      return new Promise((r) => setImmediate(() => r(html || '')));
    }
    const H = sha(Buffer.from('thornswood'));
    const exe = (size, hash, extra) => Object.assign({ name: 'Thornswood-Setup.exe', size: size,
      at: 2, hidden: false, label: 'Thornswood installer', version: '2026-09-24 01:00',
      note: '', sha256: hash, publisher: 'Someone & Signing' }, extra || {});
    const zip = (hidden) => ({ name: 'Extra.zip', size: 385154603,
      at: 1, hidden: hidden, label: 'extra', version: '', note: '', sha256: '' });
    const SIZE = /\d (KB|MB|GB)\b/;
    const small = (html) => {
      const m = html.match(/<p class="also faintly">[\s\S]*?<\/p>/g) || [];
      return m.filter((p) => SIZE.test(p))[0] || '';
    };

    const cases = [
      ['the installer alone', [exe(560000000, H)]],
      ['with a hidden zip on the site', [exe(400000, H), zip(true)]],
      ['with a zip people may take', [exe(400000, H), zip(false)]]
    ];
    for (const c of cases) {
      const html = await render({ files: c[1] });
      const p = small(html);
      yes(c[0] + ': the page renders', !!html && !/Could not load it/.test(html));
      yes(c[0] + ': the SHA-256 is printed', p.indexOf('SHA-256') >= 0 && p.indexOf(H) >= 0);
      yes(c[0] + ': beside the size and the date',
          SIZE.test(p) && p.indexOf('9-24-2026 1:00 AM') >= 0 && p.indexOf(H) > p.indexOf('9-24-2026'));
      yes(c[0] + ': it says it is published by the signer Windows shows',
          p.indexOf('Published by Someone &amp; Signing<br>') >= 0);
      yes(c[0] + ': and never by Thornswood', !/Published by Thornswood/.test(html));
      yes(c[0] + ': with no VirusTotal report line',
          !/virustotal/i.test(html) && !/VirusTotal report/.test(html));
      yes(c[0] + ': and no SmartScreen / publisher warn above the button',
          !/SmartScreen/i.test(html) && !/Why this happens/.test(html) &&
          !/signed as /.test(html) && !/Unknown publisher/i.test(html));
      yes(c[0] + ': one button, and no payload to take beside it (#4824)',
          (html.match(/Download the installer/g) || []).length === 1 && !/its payload/.test(html) &&
          !/Do not unzip/.test(html));
    }
    const missing = await render({ files: [zip(false)] });
    yes('with no installer published yet, the page says so and offers no button',
        /The installer is not published yet\./.test(missing) && !/Download the installer/.test(missing));

    const none = await render({ files: [exe(560000000, '')] });
    yes('no hash on the site: the size and date still show', / MB/.test(small(none)));
    yes('and no SHA-256 line and nothing about VirusTotal at all',
        none.indexOf('SHA-256') < 0 && !/virustotal/i.test(none));
    const nobody = small(await render({ files: [exe(560000000, H, { publisher: '' })] }));
    yes('an entry from before the publisher was written names nobody',
        / MB/.test(nobody) && !/Published by/.test(nobody));
    const old = await render({ files: [exe(560000000, undefined)] });
    yes('a site older than this, with no sha256 field at all, shows no hash either',
        old.indexOf('SHA-256') < 0 && !/virustotal/i.test(old) && / MB/.test(small(old)));
    const bad = await render({ files: [exe(560000000, '"><img src=x onerror=alert(1)>')] });
    yes('a value that is not a SHA-256 is never put in the page',
        bad.indexOf('<img') < 0 && bad.indexOf('SHA-256') < 0 && !/virustotal/i.test(bad));

    // Stale vt fields from an older API must not paint a report on the page.
    const staleVt = await render({ files: [exe(560000000, H, {
      vt: 'https://www.virustotal.com/gui/file/' + H,
      vtSkipped: true
    })] });
    yes('a stale vt field on the payload is ignored',
        staleVt.indexOf(H) >= 0 && !/virustotal\.com/i.test(staleVt) &&
        !/VirusTotal report/.test(staleVt));

    yes('the page has no VT_CAP constant any more', !/VT_CAP/.test(body));
    yes('and does not mention VirusTotal\'s 650 MB upload cap',
        !/650 MB upload cap/.test(body) && !/VirusTotal/i.test(body));
  }

  // ----------------------------------------------- what the entry ruled out
  yes('the detection name appears at most once on the page',
      (page.match(/Wacatac/g) || []).length <= 1);
  yes('nobody is told to upload the file to VirusTotal themselves',
      !/(put|upload|drop) (the|this) file (in)?to VirusTotal/i.test(page));
  yes('nobody is told to switch Defender off',
      !/(switch|turn)(ing)? off[^.<]{0,40}Defender|Defender[^.<]{0,40}(switch|turn)(ed)? off/i.test(page));
  yes('the page does not claim the installer is unsigned',
      !/not signed yet/i.test(page) && !/publisher Unknown/i.test(page));
}

main().catch((e) => { fail++; console.log('FAIL  ' + (e && e.stack || e)); }).then(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
