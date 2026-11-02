/*
  test-collection-revision.js

  Which revision of the collection a machine has installed.

  WHY THIS EXISTS AND WHY IT IS WORTH A TEST. Until 22 September the launcher
  decided "your collection is behind" by asking whether po3_StartOnSave.dll
  was present. That file is not in the collection and never has been:
  Add-Characters.ps1 puts it into a build by hand. So the test was wrong in
  both directions, and it was wrong in the quietest way on the machine that
  matters most.

  Patrick's own machine, which is the one that derives the server's load order
  and the reference plugin list, was sitting on collection revision 2 while
  the collection on Nexus was on revision 4. Nothing on screen said so,
  because the file was there. Two revisions of drift on the shipping machine,
  invisible.

  WHERE THE NUMBER COMES FROM, rewritten 27 September. The first fix read the
  revision out of the mod folder name, collection_<slug>_<rev>_<when>. Current
  Vortex does not name the folder that way any more: it is vortex_collection_
  <opaque id>_, with no slug and no number in it, so the folder name could no
  longer answer and Have went to 0 on every up to date machine. The honest
  source is Vortex's own state.v2, which records the slug and the revision
  NUMBER against the collection's mod, independent of the folder name.

  WHERE THE STATE READER IS TESTED, since 5 October (#1958). This file used to
  carry its own copy of the state rule, a regular expression over raw LevelDB
  bytes, and test that copy. #1582 moved the launcher and the publisher to the
  LevelDB reader in launcher\app\VortexProfileState.cs (#1902 added the newest
  revision and the mod ids to it), which decompresses the tables and reads
  the values as JSON. From then on the copy proved nothing about the reader
  either of them runs, so it went. launcher\tests\test-vortex-collection-state.ps1
  tests the real reader, compiled from that file and through LoadOrder.ps1,
  on real compressed LevelDB folders built by
  tests\fixtures\vortex-collection-state.py: an upgrade in place, two
  collections at once, another slug, a deleted revision, the authoring shape,
  and the broken values.

  This keeps the address-to-slug rule and the legacy folder-name parse (the
  fallback for a machine with no readable state), and checks that the
  launcher and the publisher still go to the shared reader and keep the
  fallback.

  Read only. It builds strings in memory and reads the source files.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const os = require('os');

/*
  The launcher's and the publisher's source, read to check that both go to
  the shared reader and keep the legacy folder fallback.
*/
const CS = fs.readFileSync(path.join(REPO_DIR, 'launcher', 'app', 'Checks.cs'), 'utf8');
const PS = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'mods', 'LoadOrder.ps1'), 'utf8');

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};

/* The legacy folder-name rule, as this test understands it. Current Vortex
   does not write these folders any more; this is the fallback for a machine
   that still has them and no readable state. */
function revisionFrom(names, slug) {
  const prefix = 'collection_' + slug + '_';
  let best = 0;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    const cut = rest.indexOf('_');
    if (cut <= 0) continue;
    const n = Number(rest.slice(0, cut));
    if (!Number.isInteger(n)) continue;
    if (n > best) best = n;
  }
  return best;
}

function slugFrom(url) {
  if (!url) return '';
  const at = url.toLowerCase().lastIndexOf('/collections/');
  if (at < 0) return '';
  let s = url.slice(at + '/collections/'.length).trim();
  const q = s.search(/[/?#]/);
  if (q >= 0) s = s.slice(0, q);
  return /^[A-Za-z0-9]+$/.test(s) ? s : '';
}

// ---- the slug --------------------------------------------------------------
yes('the slug comes out of a collection address',
    slugFrom('https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf') === '7essxf');
yes('a trailing slash does not become part of it',
    slugFrom('https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf/') === '7essxf');
yes('a query string does not become part of it',
    slugFrom('https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf?tab=mods') === '7essxf');
yes('an address that is not a collection gives nothing',
    slugFrom('https://www.nexusmods.com/skyrimspecialedition/mods/12345') === '');
yes('an empty address gives nothing', slugFrom('') === '');
/* A slug is used to build a folder search pattern, so anything that is not
   letters and digits is refused rather than passed through. */
yes('a slug with punctuation in it is refused', slugFrom('https://x/collections/../../evil') === '');

// ---- the revision from the legacy folder name, the fallback ----------------
const real = ['collection_7essxf_2_2026-09-15T21-08-00Z'];
yes('the legacy folder still reads as revision 2', revisionFrom(real, '7essxf') === 2);

yes('the newest wins when an upgrade leaves the old one behind',
    revisionFrom([
      'collection_7essxf_2_2026-09-15T21-08-00Z',
      'collection_7essxf_4_2026-09-22T10-00-00Z',
      'collection_7essxf_3_2026-09-19T10-00-00Z'
    ], '7essxf') === 4);

yes('double figures beat single figures, rather than sorting as text',
    revisionFrom([
      'collection_7essxf_9_2026-09-15T21-08-00Z',
      'collection_7essxf_10_2026-09-22T10-00-00Z'
    ], '7essxf') === 10);

yes('another collection in the same folder is ignored',
    revisionFrom([
      'collection_7essxf_2_2026-09-15T21-08-00Z',
      'collection_somebodyelse_99_2026-09-22T10-00-00Z'
    ], '7essxf') === 2);

yes('an ordinary mod folder is ignored',
    revisionFrom(['SunHelm Survival-39414-3-1-4-1661703641'], '7essxf') === 0);
/* The opaque folder name carries no number, so the legacy parser says nothing
   about it, and that is now correct: the revision comes from state instead
   (proved above), not from this name. */
yes('the opaque vortex_collection_* folder name has no revision to parse',
    revisionFrom(['vortex_collection_qUAAu3jC3'], '7essxf') === 0);
yes('nothing installed reads as 0, which means say nothing', revisionFrom([], '7essxf') === 0);
yes('a name with no revision part reads as 0', revisionFrom(['collection_7essxf_'], '7essxf') === 0);
yes('a name whose revision is not a number reads as 0',
    revisionFrom(['collection_7essxf_two_2026-09-15T21-08-00Z'], '7essxf') === 0);

// ---- entry points and legacy fallbacks ------------------------------------
/*
  Compressed-state and sequence behavior is exercised through the actual shared
  reader by test-vortex-collection-state.ps1. These keep the entry points and
  legacy folder fallback connected to it.
*/
const READER = fs.readFileSync(path.join(REPO_DIR, 'launcher', 'app', 'VortexProfileState.cs'), 'utf8');
yes('the launcher reads the installed revision from Vortex state',
    CS.indexOf('CollectionRevisionFromState') >= 0 &&
    CS.indexOf('collectionSlug') >= 0 && CS.indexOf('revisionNumber') >= 0 &&
  CS.indexOf('newestFileId') >= 0);
yes('the launcher delegates current installed metadata to the shared reader',
    CS.indexOf('return VortexProfileState.CollectionRevision(dir, slug);') >= 0 &&
    READER.indexOf('prefix + "revisionNumber"') >= 0);
yes('the launcher keeps the legacy folder parse as a fallback',
    CS.indexOf('CollectionRevisionFromFolder') >= 0 && CS.indexOf('collection_') >= 0);
yes('the launcher refuses a slug that is not letters and digits',
    /IsLetterOrDigit/.test(CS));
yes('the publisher reads it the same way, from state',
    PS.indexOf('Get-CollectionRevisionFromState') >= 0 &&
    PS.indexOf('collectionSlug') >= 0 && PS.indexOf('revisionNumber') >= 0 &&
  PS.indexOf('newestFileId') >= 0);
yes('the publisher delegates to that same installed metadata reader',
    PS.indexOf('[Thornswood.VortexProfileState]::CollectionRevision($st, $Slug)') >= 0);
yes('the publisher keeps the legacy folder parse as a fallback',
    PS.indexOf('Get-CollectionRevisionFromFolder') >= 0 && PS.indexOf('collection_') >= 0);
yes('the publisher refuses a bad slug', /\^\[A-Za-z0-9\]\+\$/.test(PS));

/* The thing this replaced must not creep back as the test. */
yes('nothing decides staleness from po3_StartOnSave any more',
    fs.readFileSync(path.join(REPO_DIR, 'launcher', 'app', 'Shell.cs'), 'utf8')
      .indexOf('if (!Checks.StartOnSaveInstalled()) return "stale"') < 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
