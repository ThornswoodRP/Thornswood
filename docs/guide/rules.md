# The rules

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

## What this is

Thornswood: a modded co-op Skyrim roleplay server on SkyMP, in alpha and
open by application. This repo is the launcher (launcher\app, C# 13 and WPF on
the .NET Framework 4.8.1, built with MSBuild from launcher\app\Thornswood.csproj,
#498), the game plugins (game\plugins, Skyrim Platform
JavaScript), the site (site, node), the Discord bot (bot,
Python) and every script that ships or runs it. Owner: Patrick (EvilPatrick06).

Nothing here assumes you use Claude: this file is the rules for everybody, and a Claude
reads the same file. CLAUDE.md in the private ops repo only adds what is about a Claude. A new developer
is added as a collaborator on the repository, and on CODEOWNERS beside the
shared files, and agrees once to the contributor terms in `LICENSE`.
Thornswood's own work is all rights reserved (Patrick, 12 Oct, #1331).

Patrick's Grok Bot lanes (Anvil, Herald, Waystone, Wyrd, Smeagle and Codex)
only audit now (Patrick, 30 Oct): they look over the work and file what
they find as plain issues, unclaimed, in Todo. They claim no issue, open no
pull request and run nothing. Every rule in this
file binds them the same as a person. Their own notes are in an Obsidian
vault on the shipping machine; nothing there is a rule, and what is true now
is `ops\status.md` in the private ops repo.

Six Hermes Bots take over the work from the Claude threads (Patrick, 30 Oct):
Bramble picks, claims, merges and runs every release step, and Rift, Sprocket,
Echo, Magpie and Wisp each own a part of the project. A Bot marks what it is
on with its `claimed: <Bot>` label and the board card in In Progress, the
way everybody claims. When the issue closes, `.github\workflows\drop-claims.yml`
takes every `claimed:` label off it (#1863). A change that needs something
done once it is deployed says so in a step file of its own under
`deploy\after\` (its README has the shape, #5186): a gate verb for the box
deploy agent to run after the Deployment succeeds, or a check for a person in
the game, which becomes an issue labelled `check: in game`. The agent runs
each step once and says how it went on the Deployment, so nobody keeps or
runs a note. When no gate verb does what is needed, the same pull request
adds one to `scripts\vps\gate\verbs.json` and lists it in that verb's
`afterDeploy`. No new run note goes in the private ops repo's
`ops\claude-queue\`; Bramble runs the notes already there and takes them
away as they are (since 1 Nov the Claude Desk neither runs those notes nor
merges). A step only a person can take outside the game (a click in Vortex's
own window) is a card on Patrick's report page, never a note, and a main or
live run still waits for Patrick's word. Bot branches carry the Bot's name
(`wisp/3150-what-it-is`). On the shipping machine `C:\Thornswood-Repo` is
shared and sits detached at `origin/main`: branch work goes in a worktree in
its ignored `worktrees` folder, removed with its branch once the pull request
merges.

A Bot writes test tasks the way "Test tasks and known issues" says, in
its pull request and on the issue: Main for what any playtester can check,
Dev only for what needs a dev, one per issue and kind, never posted by hand
in Discord.

## Words

The people in the world are customers, clients, people, testers, partners.
Never "player". No em dashes anywhere written for people. Plain, direct
sentences, no filler, no placeholders. Secrets (server passwords, site keys,
Discord tokens, the news webhook, anything out of a config.json or .env on the
VPS) are named by location only; never printed, pasted, committed or logged.

What checks these, since 29 Sep (issue #460). Every pull request's build
(`Launcher builds`, step "Check the writing rules") runs
`scripts\dev\Check-Words.ps1` over every Markdown file outside `lore\` and
`docs\archive\`, the launcher's window, the bot's channel posts,
the public pages of the site, and the installer's read
me. Each hit names the file, the line and the rule, and turns the build red:

| Rule | What it refuses |
| --- | --- |
| `em-dash` | an em dash, typed or as an HTML entity |
| `banned-word` | the word this section bans, any case; multiplayer and playtest pass |
| `old-owner` | the old owner name |
| `open-alpha` | calling the alpha a playtest that is closed; it is open by application |
| `placeholder` | a marker left for later, in capitals (to do, to be decided, fix me), or filler Latin |
| `names-person` | a person's name in README.md or the six component READMEs (launcher, site, voice, game\plugins, game\ui, installer\setup) |

A line that has to say it anyway (this section naming the word it bans, a
document quoting a note as it went out) goes in
`scripts\dev\Check-Words.allow.txt` with its reason; an allowance that no
longer matches anything is itself a hit. Release notes are not files, so
`scripts\release\Note-Rules.ps1` checks them when Ship or Rollback-Feed runs,
before anything is built. The same build step runs `tests\test-check-words.ps1`
and `tests\test-note-rules.ps1`, which plant a break of every rule and fail
if either check lets one through. Secrets are checked by
`scripts\dev\Check-Secrets.ps1` in the same build. It reads the files of
`engine\skymp` too whenever the fork is checked out, and says so when it is
not (#1326); the build leaves it out, and the nightly fetches it at its pin
and reads it every night (`tests\test-1326-engine-secrets.ps1`).

Two names are in no tracked file at all, code, tests, records, data,
`docs\archive` and binary files included, and the build turns red when one
comes back: the multiplayer mod this build replaced (#497,
`tests\test-old-name-gone.js`), and the SkyMP server `Thornswood-Content.esp`
was salvaged from (#400, Patrick, 12 Oct: "no records may keep it";
`tests\test-other-server-name-gone.js`), along with that server's two short
forms, the prefix its editor ids, scripts and folders carried (Patrick,
15 Oct, decision C). Say "the other server" in prose and OtherServer in a
file, folder or code name. A check that has to find that server's leftovers
on a machine matches them by their shape, never by its name: its parking
folder in Data is `_disabledBy` and a name, its backup and plugin list
beside the game are `<name>-backup-<version>` and `_<name>-plugins-off`
(`scripts\release\Ship-Rules.ps1`, Test-ShipOtherServer), and any other file
of its is simply not on the list of ours.

No machine checks these, so the person writing keeps them: plain, direct
sentences with no filler; the text inside code (the launcher's messages, the
game's chat lines, the bot's replies), because a word check there cannot
tell a message from a name in the code or one of Skyrim's own record names;
and names in the other documents, which record who decided something and
who holds what on purpose.

## Fix the cause, no band-aids

Decided by Patrick on 4 Oct: "lets ban patching or bandaids for fixes and
actually fix things", and in the same conversation, no band-aids and no patch
work at all. What prompted it: a Riekling lost its clothes walking out of the
Bannered Mare to the remount added for #614, code that existed to cover a
neck fault nobody had found, and the first fix offered for that was a second
layer that made the remount retry (#1601, closed unmerged).

A fix finds why something goes wrong and changes that. None of these is a
fix, whoever writes it and however small:

- code that notices the damage and undoes it: re-equip loops, putting
  something back when it is found off, a watcher on a timer that repairs
  state, a second ask in case the first one was ignored;
- a retry, a wait or a delay that hopes a race comes out right, instead of
  putting the steps in order;
- taking something off and putting it back, or reloading it, so the engine
  draws it again;
- a layer over an earlier band-aid to cover what that one broke;
- catching an error and carrying on, hiding a message, or turning a check off
  so the symptom stops showing.

Before a fix is written, its issue says what causes the problem and how that
was measured: the log line and its time, the file, the record, the steps that
make it happen. While the cause is not known, finding it is the work: write
on the issue what was measured and what is still unknown, and ship nothing for
it in the meantime. A cause in the engine is fixed in the fork
(`engine\skymp`), not worked around in a plugin or the gamemode.

The band-aids already in the tree are defects, and each one goes on the
board. Taking one out means finding the cause it covered and fixing that in
the same pull request. The dress asks came out with their cause, an
equipment record the server could not write (#1560): in `game\gamemode.js`
the wear script's retries, the `wearWhatIsWorn` ask at login and the
`dressIfBare` watch (#1604), and in `game\plugins\thornswood-front.js` the
front putting the shift on by itself. The Riekling and Goblin clothes remount
(#614) came out on 4 Oct (#1681) before its cause was found, decided by
Patrick because it was taking clothes off at every door; the front plugin's
race read is measuring that cause, and #614 stays open until it is fixed.

A retry is allowed only where failing is outside our control and expected:
a request over the network, a file another program has open. The reason is
written beside it, and it stops and says so instead of looping.

Every pull request says, under What changed, what the cause was and how it
was found. One that cannot say it is not merged.

## Buttons, not chat commands

Decided by Patrick on 4 Oct: "no more commands for things [people] do,
only for dev and staff commands; everything else takes buttons and GUI".
Anything a person does in the world is a key, a prompt, a panel or the
thing itself activated, never a line typed in the chat. Staff and dev
commands stay commands. So do `/stuck` and the lines that reach staff,
`/helpme` and `/report`, and help text names them (Patrick, later on
4 Oct: "change it to except the /stuck and the ones for getting help
from GMs"). So do the ways of saying a line, `/me`, `/do`, `/w`, `/s`,
`/y` and `/ooc`, and `/roll`, with no buttons for them (Patrick, 4 Oct:
"Allow those commands and don't do buttons"). So does `/needs`, the
needs bars as a line of text for somebody who hid them (Patrick,
11 Oct, #2267). Never add another chat command for people. A panel
may send the server a line, but no person is told to type it and help text never lists it. [docs/GAME-SYSTEMS.md](../GAME-SYSTEMS.md), "Buttons, not
commands", is the rule and what counts as a button;
[docs/systems/commands.md](../systems/commands.md) lists every command
there is today and the issue that converts each one that does not stay.
