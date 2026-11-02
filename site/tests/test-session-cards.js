/*
  test-session-cards.js

  The /sessions page groups by person, not by session.

  Asked for by Patrick on 22 September: one card a person, closed showing the
  Discord name, the id, total playtime and when they last played, and open
  showing every session they have had. The note column came off at the same
  time.

  The arithmetic on that closed card is the part worth a test, because it is
  the part that can be quietly wrong and still look right:

    - total playtime counts only the sessions that reported an END. A row with
      no end carries no minutes, so counting it would make the hours disagree
      with the session count on the same card. The same rule the week's totals
      already use, for the same reason.
    - the NEWEST name wins. Somebody who changed their Discord name should show
      the name they have now, not the one they had on their first session.
    - a row with no Discord id makes no card at all, rather than a card with an
      empty heading.

  This lifts the real functions out of the shipped page by text, so a rename
  fails loudly rather than testing a copy of the logic.

  Read only. It opens one file and runs no server.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

// The hub as it reaches the browser. Its script and style moved out of
// index.html into hub.js and hub.css in #1479 (no inline script or style
// under the content security policy), so its functions are read in hub.js and
// its rules in hub.css.
const PAGE = path.join(REPO_DIR, 'site', 'public', 'hub.js');
const src = ['index.html', 'hub.css', 'hub.js'].map(function (f) {
  return fs.readFileSync(path.join(REPO_DIR, 'site', 'public', f), 'utf8');
}).join('\n');

function grab(name) {
  const at = src.indexOf('function ' + name);
  if (at < 0) throw new Error('site/public/hub.js has no function ' + name);
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

eval([grab('forMins'), grab('sessionAt'), grab('sessionOpen'), grab('sessionPeople')].join('\n'));

let pass = 0, fail = 0;
const yes = (what, c) => {
  if (c) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
};

/* Newest first, which is the order drawSessions sorts into before it calls
   sessionPeople. The grouping relies on that for the name rule. */
const rows = [
  { who:'111', name:'Djinn',   start:5000, end:5000 + 60 * 60000, minutes:60, profile:7, version:'1.1.77', channel:'dev'  },
  { who:'222', name:'Patrick', start:4000, end:4000 + 30 * 60000, minutes:30, profile:9, version:'1.1.77', channel:'main' },
  { who:'111', name:'',        start:3000, end:0,                 minutes:0,  profile:7, version:'1.1.76', channel:'main' },
  { who:'111', name:'OldName', start:2000, end:2000 + 90 * 60000, minutes:90, profile:7, version:'1.1.75', channel:'main' },
  { who:'333', name:'Tester',  start:0,    end:1000,              minutes:15, profile:0, version:'',       channel:'main' }
].sort((a, b) => sessionAt(b) - sessionAt(a));

const people = sessionPeople(rows);

yes('one entry per person, not per session', people.length === 3);
yes('ordered by who played most recently', people[0].who === '111' && people[1].who === '222');

const d = people.find(p => p.who === '111');
yes('every one of that person\'s sessions is kept', d.rows.length === 3);
yes('total playtime adds only the ended sessions, 60 + 90', d.mins === 150);
yes('the open session is counted separately, not as zero minutes', d.open === 1);
yes('the newest name wins over the older one', d.name === 'Djinn');
yes('last played is the newest session', d.last === 5000);

const t = people.find(p => p.who === '333');
yes('a session with no start still dates the card from its end', t.last === 1000);
yes('a person with one session reads one session', t.rows.length === 1);

yes('a row with no Discord id makes no card',
    sessionPeople([{ who:'', name:'x', start:1, end:2, minutes:1 }]).length === 0);

yes('150 minutes reads as hours on the card', forMins(150) === '2.5 hours');
yes('under a minute says so', forMins(0.5) === 'under a minute');

/* The note column is gone, and the endpoint it used is no longer reachable
   from the page. If either comes back, this says so. */
yes('the page has no note column', src.indexOf('<th>Note</th>') < 0);
yes('the page never calls the note endpoint', src.indexOf('/api/session-note') < 0);

/* ---- what a session row says about where it got to ---------------------- */
/*
  A character is picked at the game's main menu, so a session with no
  character never reached either world. Saying "main" for one of those puts a
  session on the live server that was never on it, which is exactly what
  somebody would later be asked to account for.
*/
eval(grab('sessionTable'));
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const onMain  = sessionTable([{ who:'1', profile:7, version:'1.1.78', channel:'main', start:1, end:2, minutes:5, session:'aaaaaaaa' }]);
const onDev   = sessionTable([{ who:'1', profile:7, version:'1.1.78', channel:'dev',  start:1, end:2, minutes:5, session:'bbbbbbbb' }]);
const stuckM  = sessionTable([{ who:'1', profile:0, version:'1.1.78', channel:'main', start:1, end:2, minutes:1, session:'cccccccc' }]);
const stuckD  = sessionTable([{ who:'1', profile:0, version:'1.1.78', channel:'dev',  start:1, end:2, minutes:1, session:'dddddddd' }]);
const stuckU  = sessionTable([{ who:'1', profile:0, version:'', channel:'', start:1, end:2, minutes:1, session:'eeeeeeee' }]);

yes('a session with a character on main reads main', onMain.indexOf('>main<') >= 0);
yes('a session with a character on dev reads dev', onDev.indexOf('>dev<') >= 0);

/* The three that never reached a world, told apart as far as the row allows. */
yes('stuck on the main build reads Main Launcher', stuckM.indexOf('>Main Launcher<') >= 0);
yes('stuck on the dev build reads Dev Launcher', stuckD.indexOf('>Dev Launcher<') >= 0);
yes('stuck with no build reported reads plain Launcher', stuckU.indexOf('>Launcher<') >= 0);

yes('a stuck main session does NOT also claim the main world', stuckM.indexOf('>main<') < 0);
yes('a stuck dev session does NOT also claim the dev world', stuckD.indexOf('>dev<') < 0);
yes('a stuck session says which world it would have joined',
    stuckM.indexOf('never reached the main world') >= 0);
yes('and the unknown one says the build was not reported, rather than guessing',
    stuckU.indexOf('the build was not reported') >= 0);

/* ---- the logs button ---------------------------------------------------- */
yes('every session offers More details', onMain.indexOf('More details') >= 0);
yes('the button carries the session and the Discord id',
    onMain.indexOf('data-s="aaaaaaaa"') >= 0 && onMain.indexOf('data-w="1"') >= 0);
yes('the log row spans the whole table', onMain.indexOf('colspan="6"') >= 0);
/* Matched on the dl class and the handler rather than the whole class
   attribute, which changed when these were rebuilt on the site's own .btn
   instead of a bespoke one. */
yes('the page has a download control for a log',
    src.indexOf('small dl') >= 0 && src.indexOf('button.dl') >= 0);
yes('the controls use the site\'s own button and bar classes, not invented ones',
    src.indexOf('class="tools"') < 0 && src.indexOf('btn small moreBtn') >= 0);
yes('search boxes and pickers have a site-wide style at last',
    src.indexOf('input[type=search],input[type=text]') >= 0);
yes('logs are fetched per session, not with the page', src.indexOf('/api/session-logs?session=') >= 0);

/* ---- one session coloured, never the whole card ------------------------- */
const red = sessionTable([{ who:'1', profile:7, channel:'main', start:1, end:2, minutes:5,
  session:'ffffffff', trouble:'the game crashed', troubleAt:'bad' }]);
const yel = sessionTable([{ who:'1', profile:7, channel:'main', start:1, end:2, minutes:5,
  session:'gggggggg', trouble:'an update did not install', troubleAt:'warn' }]);
const fine = sessionTable([{ who:'1', profile:7, channel:'main', start:1, end:2, minutes:5,
  session:'hhhhhhhh' }]);

yes('a crashed session is the red row', red.indexOf('<tr class="bad">') >= 0);
yes('an update or load order failure is the yellow row', yel.indexOf('<tr class="warn">') >= 0);
yes('a clean session is neither', fine.indexOf('class="bad"') < 0 && fine.indexOf('class="warn"') < 0);
yes('red says went wrong', red.indexOf('>went wrong<') >= 0);
yes('yellow says would not play, not went wrong',
    yel.indexOf('>would not play<') >= 0 && yel.indexOf('>went wrong<') < 0);
yes('the reason is shown beside the tag', red.indexOf('the game crashed') >= 0);

/* The card itself must never be coloured: one bad evening out of forty does
   not make a red person, and a red card buries the session worth reading. */
yes('the person card has no colour rule of its own',
    src.indexOf('.person.bad') < 0 && src.indexOf('.person.warn') < 0);

/* ---- the launcher's own blockers and warnings --------------------------- */
eval(grab('issuesHtml'));
const withIssues = issuesHtml({
  issues: [
    { text:'SkyUI_SE.esp is not the server\'s copy', blocking:true, absent:false,
      plugin:'SkyUI_SE.esp', wantSize:1234567, wantCrc:0x1a2b3c4d, wantIndex:42 },
    { text:'_ResourcePack.esl is loaded on its own', blocking:false, absent:false, plugin:'' }
  ],
  checks: [{ name:'Voice', detail:'no microphone was chosen' }]
});
yes('a blocker is marked as one', withIssues.indexOf('>blocker</span>') >= 0);
yes('a warning is marked as one', withIssues.indexOf('>warning</span>') >= 0);
yes('a failing readiness check is listed too', withIssues.indexOf('no microphone was chosen') >= 0);
yes('the plugin name is shown, which the launcher window does not',
    withIssues.indexOf('SkyUI_SE.esp') >= 0);
yes('the size the server wanted is shown', withIssues.indexOf('1,234,567 bytes') >= 0);
yes('the crc is shown in hex', withIssues.indexOf('1a2b3c4d') >= 0);
yes('the manifest index is shown', withIssues.indexOf('manifest index 42') >= 0);
yes('a session with nothing wrong renders no issues block', issuesHtml({}) === '');

/* ---- searching and filtering -------------------------------------------- */
/*
  The risk here is a filter that hides something quietly. Every check below is
  about the page showing what it claims to show.
*/
eval(grab('sessionMatches'));

const mk = (o) => Object.assign({
  who:'1', name:'Djinn', profile:7, version:'1.1.79', channel:'main',
  start:1000, end:2000, minutes:5, session:'s1'
}, o);

const crashed = mk({ trouble:'the game crashed', troubleAt:'bad', troubleLine:'Uncaught TypeError: boom' });
const wonting = mk({ trouble:'an update did not install', troubleAt:'warn' });
const clean   = mk({});
const openOne = mk({ end:0, minutes:0 });
const keptOne = mk({ keep:true });
const onDevW  = mk({ channel:'dev' });
const stuckOn = mk({ profile:0 });

yes('show=all keeps everything', ['all'].every(() =>
  [crashed, wonting, clean, openOne].every(s => sessionMatches(s, '', 'all', 'all'))));
yes('show=bad keeps only the crash',
    sessionMatches(crashed,'','bad','all') && !sessionMatches(wonting,'','bad','all') && !sessionMatches(clean,'','bad','all'));
yes('show=warn keeps only the would-not-play',
    sessionMatches(wonting,'','warn','all') && !sessionMatches(crashed,'','warn','all'));
yes('show=any keeps both kinds of trouble and not the clean one',
    sessionMatches(crashed,'','any','all') && sessionMatches(wonting,'','any','all') && !sessionMatches(clean,'','any','all'));
yes('show=clean keeps only the ones with nothing wrong',
    sessionMatches(clean,'','clean','all') && !sessionMatches(crashed,'','clean','all'));
yes('show=open keeps only a session that never reported an end',
    sessionMatches(openOne,'','open','all') && !sessionMatches(clean,'','open','all'));
yes('show=kept keeps only what is held as evidence',
    sessionMatches(keptOne,'','kept','all') && !sessionMatches(clean,'','kept','all'));

yes('where=main keeps a session that reached the main world',
    sessionMatches(clean,'','all','main') && !sessionMatches(onDevW,'','all','main'));
yes('where=dev keeps a session that reached dev',
    sessionMatches(onDevW,'','all','dev') && !sessionMatches(clean,'','all','dev'));
yes('where=stuck keeps only the ones that never reached a world',
    sessionMatches(stuckOn,'','all','stuck') && !sessionMatches(clean,'','all','stuck'));
yes('a session that never reached a world is NOT counted as main',
    !sessionMatches(stuckOn,'','all','main'));

yes('search finds a name', sessionMatches(clean,'djinn','all','all'));
yes('search is not case sensitive', sessionMatches(clean,'DJINN','all','all'));
yes('search finds a character id', sessionMatches(clean,'7','all','all'));
yes('search finds a build', sessionMatches(clean,'1.1.79','all','all'));
yes('search finds words from the fault itself, which is the point',
    sessionMatches(crashed,'TypeError','all','all'));
yes('search that matches nothing keeps nothing', !sessionMatches(clean,'zzzznope','all','all'));

yes('a search and a filter narrow together rather than either winning',
    sessionMatches(crashed,'djinn','bad','main') && !sessionMatches(wonting,'djinn','bad','main'));

/* The page must always say what it is hiding, or a filter left on and an
   empty server look identical and one of them is alarming. */
yes('the page says how many are hidden', src.indexOf('Showing ') >= 0 && src.indexOf(' of ') >= 0);
yes('and says so when a filter hides everything', src.indexOf('are hidden by the filters above') >= 0);

/* One person's search is their own. */
yes('a card keeps its own search, per Discord id', src.indexOf('SFIND.mine[') >= 0);
yes('a card search only appears once there is enough to search', src.indexOf('n > 3') >= 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
