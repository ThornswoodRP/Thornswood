/*
  test-collection-visible.js

  The way to the collection is never out of reach (Djinn, 2 Oct).

  WHY THIS EXISTS. #599 took the Mods page off the rail, and its card was the
  only button to the collection, and the only place that said what revision
  Vortex had. The card by Play comes up only when CollectionProblem can prove
  something is wrong, and it answers "" when it cannot read the revision at
  all, so on a machine where Vortex's state could not be read there was no
  card, no button and no word anywhere.

  This holds four things to the source:
    - Diagnostics puts the collection card after the last Ready to launch
      row and before Bring it up to date from Vortex, not under What the
      launcher can see right now;
    - the bar above Play carries a not-confirmed note with the button when the
      revision cannot be read, and that note never shuts Play;
    - the bar's button opens the collection for the note, and still runs the
      update when an update owns the bar;
    - Play still reaches the game when the collection is current.

  Read only. It reads source files and nothing else.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

const APP = path.join(REPO_DIR, 'launcher', 'app');
const CR = String.fromCharCode(13);
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').split(CR).join('');
const SHELL = read('Shell.cs');
// Since #3201 the bar's button and Settings' share one handler, in ShellUpdate.cs.
const UPDATE = read('ShellUpdate.cs');
const PAGES = read('Pages.cs');
const PACKS = read('ShellPacks.cs');
const XAML = fs.readFileSync(path.join(REPO_DIR, 'launcher', 'app', 'MainWindow.axaml'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};

// ---- Diagnostics placement -------------------------------------------------
const pageAt = XAML.indexOf('x:Name="PageDiag"');
const nextPage = XAML.indexOf('x:Name="PageGallery"');
const diagXaml = pageAt >= 0 && nextPage > pageAt ? XAML.slice(pageAt, nextPage) : '';
const statusList = diagXaml.indexOf('x:Name="StatusList"');
const collectionHost = diagXaml.indexOf('x:Name="DiagCollection"');
// Bring it up to date from Vortex was the first section here until #2627,
// when Scan and Fix took it over; the section after the collection line is
// the icon refresh now.
const vortexHead = diagXaml.indexOf('Text="Refresh the shortcut icon"');
const readingsHead = diagXaml.indexOf('Text="What the launcher can see right now"');
yes('Diagnostics has the Ready to launch list, the collection host, and the maintenance section',
    statusList >= 0 && collectionHost >= 0 && vortexHead >= 0);
yes('the collection host sits after StatusList and before the maintenance section',
    statusList >= 0 && collectionHost > statusList && vortexHead > collectionHost);
yes('the maintenance section is still above What the launcher can see right now',
    vortexHead >= 0 && readingsHead > vortexHead);
yes('the collection host is not under the readings heading',
    collectionHost >= 0 && readingsHead > collectionHost);

const diag = PAGES.slice(PAGES.indexOf('static void BuildDiag()'));
const hostClear = diag.indexOf('diagCollection.Children.Clear();');
const card = diag.indexOf('diagCollection.Children.Add(CollectionStatusCard());');
const readingsClear = diag.indexOf('diagReadings.Children.Clear();');
const rows = diag.indexOf('diagReadings.Children.Add(ReadingRow(r));');
yes('BuildDiag adds the collection card to the host after StatusList', card > 0);
yes('that add is not into DiagReadings, so the line cannot sit under the Vortex section',
    diag.indexOf('diagReadings.Children.Add(CollectionStatusCard());') < 0);
yes('the host is filled before the readings are rebuilt',
    hostClear >= 0 && card > hostClear && readingsClear > card && rows > readingsClear);

const status = PACKS.slice(PACKS.indexOf('static Control CollectionStatusCard()'));
yes('CollectionStatusCard exists', PACKS.indexOf('static Control CollectionStatusCard()') > 0);
yes('it reads the installed revision', /Checks\.CollectionRevision\(cfg\)/.test(status.slice(0, 2500)));
yes('it says when the revision could not be read', status.indexOf('Your mods: not confirmed') > 0);
yes('it is built on the card that has the button to the collection',
    /return CollectionCard\(/.test(status.slice(0, 2500)) && PACKS.indexOf('b.Content = CollectionButtonText();') > 0);

// ---- the note above Play ---------------------------------------------------
yes('there is a flag for the note', SHELL.indexOf('static bool collectionNoteUp = false;') > 0);
const unc = SHELL.slice(SHELL.indexOf('static bool CollectionUnconfirmed(int revision = -1)'));
yes('CollectionUnconfirmed exists', unc.length < SHELL.length);
yes('it is only true when CollectionProblem found nothing and the revision is unreadable',
    /if \(CollectionProblem\(revision\)\.Length > 0\) return false;/.test(unc.slice(0, 800)) &&
    /return revision <= 0;/.test(unc.slice(0, 800)));

const noteAt = SHELL.indexOf('bool unsure = CollectionUnconfirmed(collectionRevision);');
yes('DrawStatus asks it', noteAt > 0);
const note = noteAt > 0 ? SHELL.slice(noteAt, SHELL.indexOf('// Wrong Skyrim build', noteAt)) : '';
yes('the note says the mods could not be confirmed', note.indexOf('Your mods could not be confirmed') >= 0);
yes('the note offers the collection', note.indexOf('InstallLabel(CollectionButtonText());') >= 0);
yes('and the label is on the bar\'s button as well as Settings\' (#3201)', /static void InstallLabel\(string text\)[\s\S]*?btnUpdate\.Content = text;/.test(UPDATE));
yes('the note never sets collectionBarUp, so it never shuts Play', note.indexOf('collectionBarUp = true') < 0);
yes('the note never touches the Play button', note.indexOf('btnPlay') < 0);
const guard = SHELL.slice(SHELL.lastIndexOf('if (updateBar != null', noteAt), noteAt);
yes('the note stays off while an update or the collection card owns the bar',
    guard.indexOf('!collectionBarUp') >= 0 && guard.indexOf('!updatePending') >= 0);

// Play's own gate is unchanged: the note is not in it.
const gate = /btnPlay\.IsEnabled = all && !playing && !updatePending && !collectionBarUp && !ownGameBusy && !working && feedNotice\.Hold == null;/;
yes('Play is enabled by exactly the same test as before', gate.test(SHELL));

// ---- the bar's button --------------------------------------------------------
yes('the bar\'s button opens the collection for the note but not over an update',
    UPDATE.indexOf('if (collectionBarUp || (collectionNoteUp && !updatePending))') > 0 &&
    SHELL.indexOf('btnUpdate.Click += delegate { InstallNowPressed(); };') > 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
