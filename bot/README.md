# The Thornswood Discord

What `Setup-Discord.ps1` builds, why it is shaped that way, and the handful of
things a bot is not allowed to do for you.

## The shape of it

`docs/systems/discord.md` is the whole layout: every category, channel and
role in order, who sees, talks and posts in each, and what each was before.
It is made from the builder's plan (`python3.12 bot/Build-Discord.py
--layout`) and `test-3317-layout.py` fails when the two differ, so read it
there rather than here. `Setup-Discord.ps1 -OnBox -Audit` says where the live
server differs from it. What follows is only what the bot itself depends on.

The sidebar reads in the order somebody meets it (#3317, Patrick, 22 Oct,
page card q-3317-discord-order, A): Start Here, Tickets, Information,
Roleplay Guide, Applications, Out of Character, In Character, a category per
faction, a category per hold, Playtesters, Staff, and the staff spaces.
Somebody who joins sees Start Here, Tickets and Applications, and nothing
else until the Member button in `#start-here` (THE GATE in the builder).

### Tickets and Applications

Each of these five channels has its own panel, with only its kinds of ticket
(`TICKET_DESKS` in `bot.py`; page card q-3317-ticket-split, A):

| Channel | Category | What it opens |
|---|---|---|
| `#get-help` | Tickets | Cannot install, start or connect. Support answers |
| `#report-someone` | Tickets | A report about somebody. Moderation answers |
| `#apply-to-playtest` | Applications | The playtest application |
| `#apply-for-a-seat` | Applications | Jarl and Faction Leader, listing only open seats |
| `#apply-for-staff` | Applications | Gamemaster, Loremaster, Moderator, Dev, Content Creator |

Each ticket opens a private thread off its channel that only the person and
the roles pulled into that kind can read. Faction Leader tickets go only to
the role IDs in `UPPER_STAFF_ROLES` (Owner ID and each Lead department ID);
empty means the ticket is refused. They were all in one dropdown in
`#tickets-and-applications`, which the builder retires with the old closed
ticket log `#tickets`; `-Prune` leaves a channel while a thread in it is still
open, so no open ticket goes with it.

`#ticket-log`, in Staff, is every closed ticket with a link back to it, and
the whole of any ticket whose private thread would not open. It has to stay
the council's only, because a report about somebody lands there when its
thread fails. The bot checks the channel's permissions rather than its name,
and passes over a log anybody else can read.

Installing and connecting problems are a ticket, not a public forum. Half of
them involve somebody's machine, their paths, or their account, and none of
that belongs in a channel everybody reads. `#bugs` and `#logs-and-crashes`
are gone; the builder still names both (`make=False`) so that a prune never
deletes a channel of either name and no run makes them again.

### Out of Character

One general, `#general-chat`: a second one only ever splits the same
conversation in half. It was `#general` until it was renamed, and its topic is
written by hand, so the builder leaves the topic alone. `#welcome-travelers` is
where the join cards go, and the server's system channel points at it. The
card is a file, so the builder gives the bot Attach Files in that channel's
overwrite for the bot (#2341).

The General and AFK voice rooms are here, since the Voice category went
(Patrick, 22 Oct). Proximity voice is in the launcher, so these are for
before, after, and whoever is not in the world. AFK is the server's real AFK
channel, so Discord moves people into it after five minutes of silence.
The Support voice, where a ticket goes when typing is slower than talking, is
in the Support category, open to everybody; the support staff's own room
there is Support Staff.

`#game-rules` is in Roleplay Guide and carries the nine in-world rules, read
out of the "In the World" part of `site\data\site\rules.md`, the /rules page,
so the two cannot disagree.

### The holds

`#choose-your-hold` in In Character has the bot's hold buttons and, under
them, the office panel, where a Jarl gives and takes their hold's Court,
Steward and Guards (#2551). Each hold then has a category of its own:
`#<hold>-announcements`, the hold's hall, `#<hold>-court`, `#<hold>-guard`
and a `<Hold> Court` voice room. A hold's Citizen role opens its category.

### The factions

Each of the sixteen factions in `factions.json` has a category of its own
(#3317, Patrick, 22 Oct; page card q-3317-faction-category, C):
`#<faction>-announcements` (its members read; the Leader and Officers post),
the faction's chat, `#<faction>-leadership` (the Leader and Officers),
`#<faction>-seats` and a voice room. The faction's member role opens its
category.

`#<faction>-seats` is the Leader's panel, and only the Leader and the faction
staff see it: Add and Remove for the faction's members and its Officers
(`<short> Officer`, one role per faction; Patrick picked it over a Court and
a Steward, and named the channel leadership "since it's not a court"). The
panel's faction is the channel's. The Officer role goes only to a member,
and taking somebody's membership takes it with it.
The shared `#seats` and its one panel, in the Factions category, are retired;
until `-Prune` deletes it, the old panel says where the panels went.

### Testing

The Playtesters category (Testing until #3317): `#test-tasks` (a forum),
`#known-issues`, `#test-findings` (a forum, `test-results` until 11
October) and the Playtester Voice room (play-testing until #3317), with the
playtesters' announcements, rules, sessions and chat. Playtesters and staff
see it, and nobody else. The bot finds the three testing channels by these
names.

`#test-tasks` replaces `#test-these`, which was deleted in the channel cleanup,
and `#test-these` is in the builder's retired list so a re-run does not bring
it back. Until 11 October `#test-tasks` carried the Live smoke checklist
(dated sessions with Pass, Fail, Skip and Fail-known rows, `/live-smoke`).
Patrick's card of that day took all of it out.

**Test tasks.** One thread per test task, from a title and a body, tagged
Main or Dev. Main, the default, goes to `#test-tasks` for testers on main;
Dev goes to the staff-only `#dev-test-tasks` (below), for something someone
on dev has to measure. `#test-tasks` itself only ever holds Main (Patrick,
#2276). On 12 Oct Patrick gave hand posts the Dev choice back, now that Dev
has a forum of its own; #2413 had made them Main only.

    /test-task title body [tag]   in Discord: Owner, Dev and Lead Gamemaster; tag is Main (default) or Dev
    python bot.py --env-file C:\Thornswood-Bot\bot.env.json --post-task --title "..." --body-file task.txt [--tag Dev]

Who may post is `TEST_TASK_ROLES` in `bot.env.json`, by role id (preferred) or
name, Owner, Dev, Lead Gamemaster and Lead GM by default. A `bot.env.json`
that still carries `LIVE_SMOKE_ADMIN_ROLES` is read for it. A thread already
open under the same title is handed back rather than made twice.

**Known issues and test tasks, from the board** (Patrick, 11 Oct: "it is
supposed to be automatic as we add things and fix things"). Three forums are
kept from `ThornswoodRP/Thornswood`, every five minutes (`KNOWN_ISSUES_EVERY`,
never under a minute), with a token for that repository's issues: the one
the box admin service's App makes every half hour into
`C:\Thornswood-Admin\for-bot\github-token.json` (`GITHUB_TOKEN_FILE`), issues
write on Thornswood alone (#5184), or while that has none, `GITHUB_TOKEN` from
`bot.env.json`. Reading them is all these forums need; the token
also needs issues write, for the comments the bot leaves on an issue and for
Report a problem below, which files new ones. No token, none is kept, said
once in the log.

- `#known-issues`, read only: one post per open issue labelled Dev Findings
  or Main Findings whose fix has not landed yet, tagged Dev or Main
  (Patrick, 22 Oct). Its fix has landed once the issue has a `Test task:`
  comment or is in Done: done-on-merge.yml's comment on it, `Pull request #N
  merged (...)` written by the workflow, which comes with the card's Done
  (since #5185 nobody moves a card by hand, and no `board: Done` label goes
  on). Then it is not a known issue and its post goes at once. A merged pull request alone does
  not take a post down (#3140): when any merged pull request that named the
  issue did, a measuring step on the scripts finding, partial fixes and a
  `Refs` written by mistake kept bugs people still meet off the list. Each
  post taken down says why in the log, `known issues: took #N down:`. Its title and body are the issue's
  last comment that starts `Known issue:` (a short title, at most 45
  characters, then what goes wrong, where, and how to avoid it), the same
  shape as a test task below; until somebody writes one, the issue's own title
  and a plain line. No issue number and no link, because testers have no
  GitHub. The post is deleted the moment the issue is no longer an open
  finding: fixed and closed, closed any other way, its label taken off,
  moved to Done, or a test task written on it.
  Its tag says where it was found and stays Dev or Main as before.
- `#test-tasks`: one post for each issue closed as fixed from the day this
  began, always tagged Main. Its title and body are the issue's last
  `Test task:` comment that is not `Server: Dev`, written when a main Ship
  carries the fix (a newer Dev one beside it does not hide it):

      Test task: <what to try, at most 45 characters>
      <numbered steps in the game, then what should happen>

  `Test task:` with nothing after the colon takes the issue's own title. A
  closed issue also gets a post when its latest `Test task:` comment was
  written after that day, however long ago it closed. A fixed finding with no
  such comment gets its own title and a plain line asking testers to check
  it on main; a fixed issue that is neither a finding nor has that comment
  gets no post. A reopened issue loses its test task and comes
  back to `#known-issues` if it is still a finding. Staff close a test task
  in Discord once it is confirmed.
- `#dev-test-tasks`, in Staff and seen only by staff (Patrick, 12 Oct): one
  post per issue from its last `Test task:` comment that has `Server: Dev`
  straight under its first line, tagged Dev. That is a check only a dev can do: it
  needs staff or dev commands, the dev server, logs, the box, or a setup
  testers cannot make (Patrick, 22 Oct). The post is made as soon as the
  comment is there, open issue or closed, and it stays when the issue
  closes, because a dev check can still be wanted while the fix is on main.
  A newer Main `Test task:` comment beside it, such as the one the main Ship
  writes when it closes the issue, leaves it up. It goes when the comment is
  taken back; staff close it once it is done. An issue can have both: its
  Dev post here and its Main one in `#test-tasks` once it closes. The post is deleted when it goes, so what was measured belongs
  on the issue.

  A dev post is written for developers, who have GitHub (Patrick, 12 Oct):
  it links the issue and says its state and labels, links every pull request
  of this repository that mentions the issue and is merged or still open,
  and every commit of this repository that names it (both read from the
  issue's timeline, which the same issues token reads; a commit there can be
  a branch commit as well as a merge), names the build it needs from a
  `Build:` line in the comment or the issue (a dev release id or a gamemode
  commit), links the comment, and then gives the whole test task. That
  comment may be written in developer terms, with file names, log lines,
  commands and what each should print. Nothing is cut: Discord takes 2000
  characters in a message, so the rest goes in follow-up messages in the
  post, in order, kept in step when the comment changes (their ids are in
  the record's `more`). The links are as of the last change to the issue.
  `#test-tasks` posts stay exactly as they were: the test task alone, plain
  words, no numbers, links or code, because testers are not developers. A Dev test task posted by hand (`/test-task` with the tag Dev) also
  lands here; it belongs to no issue, so the bot leaves it for staff to close.

**One post per issue, never two** (Patrick, 22 Oct, after duplicates in all
three forums). Before it makes a post, the bot looks for a post of its own
with that title among the open and the closed ones, and takes that one up:
until 22 Oct only open posts were looked at, so a post staff closed, or one
Discord closed after quiet days, was made again whenever its record was lost.
A test task taken back (its comment edited so the first line no longer
starts `Test task:`) takes its post down. The Claude Code line GitHub puts
under a comment a Claude writes never shows in a post. To find and remove
duplicates already there, with the bot running or stopped:

    python bot.py --env-file C:\Thornswood-Bot\bot.env.json --forum-check           (says what it would delete)
    python bot.py --env-file C:\Thornswood-Bot\bot.env.json --forum-check --apply   (deletes them)

Of two posts with one title it keeps the one an issue owns (or the oldest)
and deletes the rest; two issues owning one title are said and left, to be
fixed on the issues.

**When an issue is closed** (Patrick, 11 Oct): dev is where the team checks
that nothing breaks the game, and main is where testers test, since we are in
alpha. So a fix people would notice is closed, with its `Test task:` comment,
when it reaches main, not when its pull request merges or when it reaches
dev. The bot posts a test task the moment the issue closes, so closing it
earlier sends testers to look for a fix main does not have. That is why every
test task in `#test-tasks` is tagged Main. Write `Server: Main` (or no
`Server:` line) under `Test task:` for testers on main, and `Server: Dev`
only for a check only a dev can do, which sends it to `#dev-test-tasks` for
staff. If a playtester could do it with the normal game once it is on
main, it is Main, even when a dev command would make it quicker (#613's
forge re-cost, Patrick, 22 Oct). An issue has one dev post, so a newer
`Server: Dev` comment replaces the one before it. The line never shows in the post. `Server: Dev`
counts only on a comment written from the day `#dev-test-tasks` began (the
bot's first pass that finds it, `dev_since` in `data\known-issues.json`), so
the comments written before that, which all carried a `Server:` line, stay in
`#test-tasks`. Under `Known issue:` the line still sets the tag.

A rewritten `Known issue:` or `Test task:` comment edits its post (title,
body and tag) on the next pass. Comments are read only for an issue GitHub
says changed since the last pass, or whose record was made with an older
form of the post: each record in `data\known-issues.json` holds the form it
was written with (`TASK_FORM` and `KNOWN_FORM` in `bot.py`). When the way a
post is written changes, that number goes up by one, and on the first pass
after the bot is updated every older post is written again, once. Form 2
(11 Oct) is test tasks tagged Main and both plain lines saying main. A test
task posted by hand with
`--post-task` can be given to its issue so it is kept up to date too, with
the bot stopped (the running bot holds the file in memory):

    python bot.py --adopt-task --issue N --thread <post id>

Which post is which issue is kept in `data\known-issues.json`, written
straight after each post, and a post is matched back by its title among the
bot's own, so neither a restart nor a crash between a post and its save posts
twice.

**Report a problem** (Patrick, 21 Oct, #3155). Testers file a problem on the
board themselves, from two places, and each one becomes an issue in
`ThornswoodRP/Thornswood` labelled `Tester report` and `area: triage`
(`PROBLEM_LABELS`), never Main or Dev Findings, so it does not go public in
`#known-issues` until somebody on the team looks at it and labels it.

- In the game: Report a problem at the end of Getting help on the help panel
  (F7), a box and Send. The gamemode sends it to the site's
  `/api/report/game` as kind `problem`, with the character, the cell and the
  position; the site adds the Discord account and the launcher session open
  on that server, and writes it to `data\for-bot\inbox.json` like a
  `/report`. `watch_problems` reads that inbox every `REPORTS_EVERY` seconds,
  files each problem once, oldest first, and says it in the staff channel
  with its number. Which rows are filed is kept in
  `data\problems-filed.json`, written after each one, so a stop part way never
  files one twice; a record that will not read files nothing until it does.
  A GitHub refusal stops that look and is said once in the log.
- In Discord: the Report a problem post the bot makes and pins in
  `#test-findings` (`PROBLEM_CHANNEL`), with a button that opens a form:
  what went wrong, what they were doing and where, and which server. Only
  playtesters (`TESTER_ROLES`, Playtester by default) and staff may use it,
  five an hour each. The bot files the issue at once and answers only them.
  The pin needs Manage Threads, which the bot has through Administrator.

The logs are never copied into the issue. They reach the site from the
launcher when the game closes, as they always have, and the issue links the
hub's Sessions page at that session (`/sessions?find=<session>`), or, from
Discord, at the account's sessions. What the tester typed goes into the
issue inside a `<pre>` block, so nothing in it can mention anybody or turn
into markup. `bot\tests\test-3155-problems.py` holds the bot's half and
`tests\test-3155-report-problem.js` the game's and the site's.

**The one-time setup.** Moving a server from the old shape is the only channel
change the bot makes, Patrick's explicit exception for these three changes. It
runs only when asked, never on a start:

    python bot.py --env-file C:\Thornswood-Bot\bot.env.json --setup-channels           (preview, changes nothing)
    python bot.py --env-file C:\Thornswood-Bot\bot.env.json --setup-channels --apply   (does it, once)

It turns `#test-tasks` into a forum with the Dev and Main tags. Discord cannot
convert a text channel to a forum, so when it refuses, a new forum is made in
the same category and position with the old channel's permission overwrites,
and the old channel is renamed `#test-tasks-archive` with sending switched off
for everyone but the bot. Nothing is deleted. It renames `#test-results` to
`#test-findings`, and makes the `#known-issues` forum beside it, seen by the
same people and read only for all but the bot. A server set up before
`#known-issues` was a forum gets that one step on its next apply: the old text
channel is deleted when it holds only the bot's own posts (otherwise renamed
`#known-issues-archive` and locked), and the forum takes the name. A finished apply is written to `data\channel-setup.json` and a
second run does nothing; an apply that stopped part way does only what is left.

The third step (Patrick, 12 Oct) makes the `#dev-test-tasks` forum, tagged
Dev, in the category whose id is `DEV_TASKS_CATEGORY` (the Staff category,
1549254990110134374, by default), with that category's permission overwrites
copied, so the same staff see it, and the bot's own overwrite from
`#test-tasks` with the forum rights on (see it, post, reply, delete its posts,
read them back). A server set up before gets this step alone on its next
apply. Its id goes into `data\channel-setup.json` as `dev_tasks_id`, and the
bot finds the forum by that id from then on, never by its name: a rename
keeps it, and no second one is made. A forum of that name already in the
category is taken as it is, with the Dev tag and the bot's rights added. If
the recorded forum is deleted, the bot says so in its log once and posts no
dev test tasks until the next apply makes it again. `Build-Discord.py` names
it in Staff with `make=False` and in its never-delete list, so `-Prune`
leaves it. `test-testing-channels.py` holds all of this.

### The site's known issues and roadmap

The site's Known Issues page (`/known`) and its roadmap (`/roadmap`, and the
front page's) are written from the issue board, so they cannot go stale
(Patrick, #3140). The bot writes both into `data\from-bot\lists.json` under
the site's folder (`PUBLIC_LISTS_FILE`), which the site makes and reads, after
every pass over the board (every five minutes, `KNOWN_ISSUES_EVERY`), the
whole file at once.

- The known list is the `#known-issues` posts above, word for word, with where
  each was found. Nothing is typed into the site for it.
- The roadmap has three lanes: Being built now, Next and Later. An open
  issue labelled `roadmap: now`, `roadmap: next` or `roadmap: later` is in
  that lane. Once it closes, however, it leaves the roadmap: there is no
  Done section (Patrick, 26 Oct, "Done section needs removed from the
  roadmap"). Its words are the issue's last comment that starts `Roadmap:`:

      Roadmap: <what, at most 45 characters>
      <where it stands, in a sentence or two>

- What keeps a row off: no `Roadmap:` comment, two lane labels, a title over
  45 characters, nothing under the first line, an issue number, a link or
  code, an em dash, or the word for the people who play that docs/guide/rules.md
  bans in its Words section. The last two hold for known issue text too,
  since the site shows it to anybody. The issue gets one comment naming the rule, the same as a test
  task; fixing the comment puts the row on at the next pass.
- A "---" and "Generated by" footer under the comment is left off the row.
- Comments are read again only for an issue whose update time moved.
- A part the bot could not read on a pass is left out of the file rather than
  written empty, and the site says the list could not be read rather than
  showing nothing. The bot writes the folder with Modify rights that
  `Bot-Service.ps1` gives it, and `Install-Bot.ps1` stops if the site has not
  made the folder yet.

### Staff

`#staff-announcements` (the staff `#news` until #3317, where the dev updates
webhook posts), `#council-decisions`, `#staff-updates`, `#staff-general`,
`#council`, `#ticket-log` and a Staff Room. Invisible to everybody else.
`#dev-test-tasks` (a forum the bot keeps, see Testing above) and
`#dev-test-findings` are in the Dev space.

A staff notice can be filed as an issue labelled `notice: staff`, its body
the notice: the bot says it in `#staff-updates` within a minute, comments and
closes the issue, and the label `notice: take back` takes it out again
(#5187). That is how `scripts\ops\Say-Staff.ps1` posts from a machine with
no ssh to the box. The issue is public, so a notice that must stay with
staff goes over ssh.

`#dev-notes`, `#deploys` and `#reports` were here and are gone, and like
`#bugs` the builder keeps their names so that a prune cannot take a channel of
that name and no run makes them again.

## Roles

Top of the list downwards. They are Thornswood's own names rather than job
titles, because "Moderator" sitting beside "Jarl of Whiterun" reads like two
different servers stitched together.

| Role | Colour | What it means |
|---|---|---|
| Owner | gold | Runs the place. You |
| Lead Gamemaster | deep blue | Runs the gamemasters, and posts test tasks |
| Dev | violet | Builds and deploys it |
| Gamemaster | blue | Runs things in world |
| Loremaster | teal | Writes the world |
| Trial Gamemaster | pale blue | A gamemaster on trial. Sees every hold, not the staff channels |
| Moderator | green | Moderates |
| Content Creator | rust | Makes videos about it |
| Server Booster | pink | Boosted the server. Discord's own role, never made here |
| Playtester | copper | Tests the builds |
| Milk Drinker, Talos Worshiper, Thalmor Boot-Licker | | The three Patreon tiers |
| Jarl of *hold* | bright gold | Holds that hold. Ten of them, one each: the nine holds and Raven Rock |
| Citizen of *hold* | slate | Where your character lives |
| *Hold* Court, Steward of *hold*, Guard of *hold* | tan | The offices that hold's Jarl gives (#2551): an officer at its drop box; its Steward; its Guards. Three for each of the nine holds and Raven Rock, never hoisted, so they never show as a group of their own. In the game one character of the account holds each |
| Member | grey | Given by staff after an application is accepted |
| Banned | grey | What the site keys a ban off. No permissions, not hoisted |
| Patreon, News Pings, Updates Pings | | Made by Patreon and by the bot, never here. They are in the builder's list for their place in the order and nothing else |

Owner, Dev, Moderator and Gamemaster are staff as far as the channels are
concerned: they see the staff channels and can post in the read only ones.
Lead Gamemaster and Trial Gamemaster are not in that list, so neither opens
`#reports`; both see every hold, and the lead gamemaster role is named on
`#test-tasks` by that channel's own line in the plan. Loremaster sees every
hold as well.

Neither is staff to the bot either. Closing a ticket, with `/close` or the
Close ticket button, and skipping the one open ticket rule and the cooldown
take one of the `STAFF_ROLES` roles in `bot.env.json` (Owner, Dev, Gamemaster,
Moderator and Loremaster by default), matched by id or name, and nothing
else. Faction Leader tickets are pulled to the role IDs in `UPPER_STAFF_ROLES`
only (Install-Bot `-UpperStaffRoles`: the Owner ID and the Lead Gamemaster
ID). Names are ignored. Empty or unset refuses the ticket. A future Lead
role is added there by its ID. `/close` on a Faction Leader thread also
lets through a member holding one of those IDs; `is_staff` is unchanged,
so they still wait out the ticket limits. The Manage Threads that both of them carry on every channel used to
count as staff there, and it no longer does (#1342). `test-staff-gate.py`
runs every staff and admin command and button as somebody who is not staff
for it, and fails on any new one whose gate is not written down in it.

Both close a ticket and nothing else: a thread off a `TICKET_CHANNEL`
channel, where the panel opens them. In any other thread, a `#test-tasks`
post or a `#tales` post, they answer that they only work inside a ticket
and archive and write down nothing (#1776, `test-1776-close-tickets-only.py`).

A closed ticket is kept for 365 days and then the bot deletes the thread
(#2353, `TICKET_KEEP_DAYS`, `tests/test-2353-ticket-keeping.py`). When it
closed is Discord's own archive time, so opening a ticket again and closing it
starts the year over, and a ticket nobody closed ages from when Discord
archived it after a week with nothing said. Every hour the bot asks Discord
for the closed private threads in each `TICKET_CHANNEL` channel and deletes
those it opened that closed more than a year ago, one `closed tickets:` line
in bot.log each. Threads a Gamemaster opened there by hand are never touched.
The bot's own messages in the `TICKET_LOG` channels (`#ticket-log`, and an old
`#tickets`) go the same way, 365 days after each was posted (#3634): a whole
ticket that went there because its thread would not open, and the Closed line
written at each close, which names the thread and so the person who opened
it. The Closed line goes a year after that close, with the thread it points
at. One `ticket log:` line in bot.log says how many went from each channel.

Staff roles are job titles on purpose. Thane, Steward, Warden and Housecarl are
all things somebody should be able to play, and a moderator wearing one makes
every in-world use of the word ambiguous.

The hold roles grant nothing in Discord. Somebody playing a Jarl still needs
Member to get through the door, which means a Jarl can be banned like anyone
else without unpicking their title first. In the game they are the offices
(#2551): the site reads them with the other roles, and the game reads the
Jarl, the Court, the Steward and the Guards of each hold from them and
nothing else. The builder never deletes any of them (KEEP). The running bot
makes any Jarl or office role that is missing when it starts
(`ensure_office_roles`), so they exist without a build, which would ask for
the token at a prompt. In the game the office is held by one character of the
account: the one the Jarl named there, or the one its holder chooses on the
Office page of K.

The office panel is a second message in `#choose-your-hold`, under the hold
panel: Add and Remove beside the Court, the Steward and the Guard. They work
only for whoever holds a hold's Jarl role, and only for that hold. Add asks
who, Remove offers who holds it, and the bot gives or takes the role with the
reason in Discord's audit log. If two accounts hold the same hold's Jarl
role, neither can use it until staff take it from all but one. Each change is
said in the staff channel with who changed what (`office_change`). A Jarl's
change from the game's Office page is made by the site with the bot's token
and comes to the same channel through the site's `moderation.log`, and so do
two accounts holding one Jarl role and the end of that (`office_text`).
Staff ending a claim or setting or taking off the rent at a building's door
(#2551) comes from the game's own `moderation.log` as `evict`, `rent` and
`norent`, said like the other staff actions with the building and its hold.
`test-2551-hold-offices.py` holds the roles and the panel.

Eighteen hold roles sounds like a lot for a small server. Discord only shows a
hoisted group in the member list when somebody in it is online, so the empty
ones stay invisible until they are not.

Owner and Dev are administrators. Moderator can time out, kick, ban and delete.
Gamemaster can time out and manage threads but not ban. The rest is ordinary.

Give the people testing with you **Playtester**. That role is access.play,
and it is what opens the game. Staff give **Member** after an application is
accepted. Discord has no default-role setting. Then the person picks a hold.

## The three things the bot cannot do

1. **Turn on Community.** Server Settings, Enable Community. Without it there
   are no forum channels, no announcement channel and no rules screen. Run
   `Setup-Discord.ps1` again afterwards and the text channels standing in for
   forums are replaced with real ones.

2. **Point the rules screen at the rules.** Community, then Safety Setup. That
   is what makes people accept the rules before they can type.

3. **Hand Member out on join.** It cannot. Discord has no default-role
   setting, so there is nothing to turn on under Server Settings, Roles.
   Staff give Member after an application is accepted. Playtester
   (access.play) is what opens the game.

## Changing the words later

`content.py` holds every read only post. Edit it, run `Setup-Discord.ps1`
again, and the posts are rewritten in place. It deletes what the bot wrote last
time rather than adding a second copy, so the rules never end up posted twice.

`Setup-Discord.ps1` asks for the bot token at a hidden prompt. With `-OnBox`
it asks for nothing: the build runs on the VPS with the token the running bot
already holds in `C:\Thornswood-Bot\bot.env.json`, so anybody with the VPS key
can run it and the token never leaves the box (#2519, #2341). The running bot
has the smaller permission set, so a change that needs Administrator is named
under "did not manage" until the bot's role has it again.

## Reading what the live server really allows

The plan only says what a channel the build makes gets, and much of the live
server was gated by hand. `Setup-Discord.ps1 -OnBox -Audit` reads the live
server and changes nothing (#3317). It says the bot's own permissions against
the running set, each role's permissions against the plan, who holds each
staff rank, anybody holding two ranks of one staff category, every planned
category and channel whose overwrites differ from what its mode gives, and the
channels the plan does not name. Each difference starts `DIFFERS`, and the
last line counts them. Run it before and after any change to roles or access.

## Running the bot's tests

The bot and its tests need Python 3.11 or newer (Pillow 13 needs it, #1401),
and the bot runs on 3.12.
On a Windows PC with more than one Python installed, plain `python` is
whichever comes first on PATH (on One that is 3.9), so run them with the
launcher:

    py -3.12 bot\tests\test-testing-channels.py

With the libraries from `bot\requirements.txt`. On an older Python, bot.py
and every test stop at once and say so, rather than failing somewhere deep in
a test (#2276). The check is `_pyguard.py`, imported first by bot.py and by
every `test-*.py`, and Install-Bot.ps1 sends it with bot.py.
`test-python-version.py` holds that.

## Putting a bot change on the VPS

A merged change to the bot's files goes on by itself (#5187): the merge's
Release carries `discord.zip`, its Deployment to **Discord bot** is applied
by the box's deploy agent the way `-CodeOnly` below does it, libraries
included when `requirements.txt` changed, and the old files go back when the
bot does not say it is watching its server. `docs/DEPLOY-AGENT.md` has how.
What follows is the hand way, for a box without the agent or a change that is
not merged.

From a checkout of main that has just been pulled, never from a copy of the
repository that was downloaded earlier:

    git checkout main
    git pull
    .\scripts\deploy\Install-Bot.ps1 -CodeOnly

The pull comes first because a deploy sends what the commit holds. A stale
folder sends the bot as it was before the change and says nothing about it,
and the same folder builds the Discord as it was before the change if
`Setup-Discord.ps1` is run from it. That is how a live smoke went out of a
folder in Downloads that had not been pulled for days.

`-CodeOnly` stages the code beside the running bot and checks it there, then
stops the service, renames the new files in, starts it again by its name and
waits for it to say it is watching the server. If it does not, the old files
go back and it is started on those. Python, the libraries, the token and the
service itself are left alone.

So a library moved in `requirements.txt`, by a Dependabot pull request or by
hand, does not reach the box with `-CodeOnly`: that sends the file and leaves
`py-libs` as it was. The full run, `.\scripts\deploy\Install-Bot.ps1 -NoToken`,
installs the pinned versions into a new `py-libs` and swaps it in with the
code, so a bump that stops the bot from starting puts the old libraries back.
The pull request build only parses the bot; the nightly runs its harnesses.
So before merging a bump, install the new pins and run `bot\tests\test-*.py` on
them, the way [Setting up a machine](../docs/guide/set-up-a-machine.md#setting-up-a-machine)
installs them (#1401).

What goes up with it: `bot.py`, `card.py`, the channel ids, the card artwork,
`requirements.txt`, and `factions.json`, the named factions the Faction
Leader form reads from beside itself. A file the bot reads and this list does
not name is a file that is only ever on main, never on the box.

Nothing else stays in the bot's folder (#1184). It holds what that list sends
and what is the bot's own: `bot.env.json`, `thornswood-deploy.json` (the
record of what runs there), `data`, `service`, `webhooks`, `py-libs`, and,
until a full run moves them into `data` or takes them off, the log, the
records and the old loop's `run.ps1` and `roll-log.ps1` from before the
service. Every run moves anything else there aside into `.prev-<stamp>`, with
the code it replaced, and names each one; `Get-ThornswoodBotOwned` in
`scripts\vps\Bot-Service.ps1` is that rule. `-PutBack` puts them back with
that code, and they leave the box with that `.prev` folder two deploys later.
So a file copied in by hand, `backfill.py` or `redraw.py` for a run of it,
is copied from the repository for that run, and the next install moves it
aside, rather than sitting on the bot's import path from then on.

The bot's log is `C:\Thornswood-Bot\data\bot.log`: in the data folder under
the bot's folder, the one folder its account writes, rather than beside the
code where it used to be. Every `-CodeOnly` run leaves that file on the box,
empty if the bot has not written to it yet, so the path is always something to
look at. `.\scripts\vps\Show-BotLog.ps1` reads whichever of the two files the
bot is really writing, which on a box whose service program is older is still
the one beside the code.

Those paths are on the VPS, not on the machine you run the deploy from, so
`Test-Path C:\Thornswood-Bot\data\bot.log` there answers for a folder that
machine does not have. `Show-BotLog.ps1` and `.\scripts\vps\Get-Logs.ps1` are
how to look at them.

You do not have to check by hand at all. Once the swap has answered, every
run asks the box itself and prints one line per file, under the heading
"What the box has, at the folder the swap moved them to":

```text
asked of THORNSWOOD-VPS, where the bot runs from C:\Thornswood-Bot
Test-Path C:\Thornswood-Bot\bot.py  True
Test-Path C:\Thornswood-Bot\card.py  True
Test-Path C:\Thornswood-Bot\data\bot.log  True
```

A run that ends green has printed True for every file it sent and for
`data\bot.log`. A file that is not there turns the run red and names it by
its full path on the box, so a swap that says SWAP OK while something is
missing from the install root cannot pass for a good deploy. If a line says
False, that is the box talking and it is worth looking at; a False you typed
yourself on the deploy machine is only that machine saying it has no such
folder.

## Release notes posting themselves

Since #5187 a release's news is posted when the release is deployed. The box's
deploy agent leaves each deployed Release's notes in
`C:\Thornswood-Deploys\for-bot`, and the bot posts each release once: a
merge's release in the dev updates channel (`dev-channel.txt`), a main release
in #news (`news-channel.txt`, by id). Notes that say nothing people would
notice are not posted. What follows is how a Ship posts, which still holds
for a release the agent does not deploy.

The build makes a webhook in `#news` and saves it to `news-webhook.txt` beside
these files. `Ship.ps1` calls `Publish-Discord.ps1` at the end of every
release, which reads the newest entry out of `version.json` and posts it.

The same entry goes to `thornswood.net/news` at the same moment, from the same
source, so the launcher, the site and the Discord cannot disagree about what
shipped.

`news-webhook.txt` is a one way address into that one channel. It is not a
password and it cannot read anything, but anybody holding it can post as
Thornswood, so do not put it in the repository or paste it anywhere.

## Being told when the bot or the VPS stops, from outside

The watchdog on the VPS tells #staff-updates when something there dies,
and One watches the site from outside (issue #448). Neither can say anything
when the whole VPS is off or cut off while One is off too. So the bot pings an
outside uptime monitor once a minute while it is on Discord, and when the
pings stop for five minutes the monitor emails you (issue #449). That covers
a bot that stopped, hung or lost Discord, and a VPS that went down.

The monitor is **Cronitor** (cronitor.io): its free plan needs no card, keeps
five checks, and you sign in with GitHub. The bot only needs a web address to
ping, so healthchecks.io (free, no card, signs in by an emailed link) works the
same way if Cronitor ever does not suit.

Once, on One:

1. Go to cronitor.io, Sign up, **Sign up with GitHub**, and sign in as
   EvilPatrick06. If it offers a trial that asks for a card, pick the free
   plan instead; it needs none.
2. Make a new monitor of the kind **Heartbeat**. Name it `Thornswood bot`.
   Expected every **5 minutes**, grace period **5 minutes**. Cronitor's
   free Hacker plan lists its fastest check frequency as 5 minutes
   (https://cronitor.io/pricing), so do not set this to 1 minute. The bot
   still pings about once a minute, which is inside that window.
3. Alerts: leave the default notification list, which emails the address on
   the account. To hear it in Discord as well, add a Discord webhook to that
   list; the monitor posts it itself, so it arrives even when the VPS is
   down.
4. Save, then copy the monitor's ping address (its telemetry URL, starting
   `https://cronitor.link/p/`). It is a secret: whoever has it can keep the
   monitor quiet. Do not paste it anywhere but the prompt below.
5. From the repository folder, once the pull request that added this is
   merged and pulled:

   ```
   .\scripts\deploy\Install-Bot.ps1 -NoToken
   .\scripts\deploy\Install-Bot.ps1 -SetPing
   ```

   The first is the full run, which installs the service and sends the
   bot code that pings. -CodeOnly refuses until that service exists. The
   second asks for the address hidden, puts it in
   `C:\Thornswood-Bot\bot.env.json` as `PING_URL` over ssh's standard
   input, restarts the bot by name, and prints the bot's first line about
   it: `reached the outside monitor` is right. The monitor's page then
   shows a ping a minute.

To stop it, run `-SetPing` again and type `off`, then pause or delete the
check on the monitor, or it emails you that the bot went quiet. A full
`Install-Bot.ps1` run keeps the address. The bot says in `bot.log` once when a
ping fails and once when they work again, never the address; a slow or dead
monitor never holds up anything the bot does on Discord.

## Community setup, field by field

These three are on the Enable Community screen, which only a person can go
through. Take what it offers for the last two: the next `Setup-Discord.ps1`
run moves them.

| Field | On the Enable Community screen | After the build |
|---|---|---|
| Rules or guidelines channel | `#rules` | leave it |
| Community Updates Channel | `#general-chat`, because nothing else exists yet | `#staff-updates`, set by the build |
| Safety Notifications Channel | `#general-chat` | `#staff-updates`, set by the build |

Both of the last two carry Discord's notices about your own server, moderation
and safety among them and some of it about specific people, so they do not
belong in a channel everybody reads, and they are notices, so they go where
staff notices go: `#staff-updates`, never `#staff-general`, which is for talk.
`Build-Discord.py` finds `#staff-updates` by the id in `bot\staff-channel.txt`,
the same one the bot speaks in, and says under "did not manage" when it could
not move them. `-Check` says `would change` when either one points anywhere
else.

**Server description.** This is what shows in the embed whenever somebody
pastes your invite link anywhere, so it is worth more than it looks:

> A Skyrim roleplay server set fifty years after the civil war. Fewer NPCs, not
> none, so the world is still alive at three in the morning. Free, and Special
> Edition is all you need.

## Onboarding

Server Settings, Onboarding. This is the thing that turns a wall of channels
into a door. `Build-Onboarding.py` sets it with the bot, from the rows it was
written out in (issue #427, the board's "Discord onboarding, field by field"),
so the words live in one file and every role and channel is looked up by name
on the server when it runs:

    .\scripts\deploy\Set-DiscordOnboarding.ps1 -Check    says what it would set, changes nothing
    .\scripts\deploy\Set-DiscordOnboarding.ps1 -Off      writes it, leaves it off for Preview
    .\scripts\deploy\Set-DiscordOnboarding.ps1           writes it and switches it on

Run `-Check` first, every time. It names every channel Discord would refuse
and why, and sends nothing while anything fails. The bot needs Manage Server
and Manage Roles for the write, which it has: it keeps Administrator (#3317,
Patrick, 22 Oct 2026).

Discord will not switch onboarding on until it has **at least 7 default
channels and at least 5 of them that everybody can post in**, and it only
takes channels everybody can see. Read only channels do not count toward the
five.

What it sets:

- **Default channels**: `#welcome` `#rules` `#start-here` `#news`, read only,
  and `#general` `#media` `#character-introductions` `#tales`
  `#rp-appreciation`, where people talk. Nine, five writable, which is exactly
  the minimum.
- **What are you here for?** Pick several, optional, channels only: Roleplay
  shows `#tales`, Just playing `#general`, I want to help test
  `#apply-to-playtest` (testing starts with an application), I make
  videos `#media`.

`Build-Onboarding.py` still names `general` and `test-these`, which the server
no longer has: they are `#general-chat` and `#test-tasks` now. It looks every
channel up by name on the server, so `-Check` names both and sends nothing
until the script is caught up. That is its own change and its own issue on the
board.
- **Which hold does your character call home?** Only with `-GrantMember`. Pick
  one, members must answer. Each hold gives Member and its own Citizen role,
  which opens that hold's channel; Not decided yet gives Member only. Off by
  default, because Member is what staff give once an application is accepted
  (the gate in `Build-Discord.py`), and a hold is picked in `#choose-your-hold`
  after that.
- **Rules and age.** `-Rules` and `-Age` each add one required question, off
  by default until it is decided that they belong here (entry 181).

It never hands out anything but Member and the Citizen roles, and refuses one
that carries a power such as Administrator or Manage Roles. The role that opens
the game is given by a person when an application is accepted. The Server
Guide (the welcome sign, the to do list and the resource pages) has no bot
side, so it stays a by hand step.

Then walk it: Server Settings, Onboarding, **Preview** at the top right, and
check every answer gives the role you meant.
