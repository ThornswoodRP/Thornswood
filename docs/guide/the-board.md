# The board, issues and test tasks

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

## Everything we need to do goes on the board

The one record of outstanding work is the Thornswood To Do board, a board of
the ThornswoodRP organization: https://github.com/orgs/ThornswoodRP/projects/1
(it was Patrick's own account's until #5185 moved it, 1 Nov 2026).

Each piece of work is an issue on this repository, and every issue is on the
board. Decided by Patrick on 25 Sep and approved in #staff-general: the list moved there
from a claude.ai page that nobody without Claude could open. The 169 open
entries became issues #368 to #536, each keeping its old number as its Order.
`docs/archive/todo-list-2026-09-25.md` in the private ops repo holds every entry as it stood that day,
the finished ones included, so a comment in the code that says "entry 243 on
the To Do List" means entry 243 in that file.

Decided by Patrick on 17 Sep. Anything a session turns up goes on the board
before the session ends. A defect, a decision, a correction to something
already on there, or work started and not finished. Saying it in a chat or a
reply is not recording it: that is gone when the window closes and the next
person has no way to know it was ever found. What prompted this was a Google
Ads tag added to the site whose only trace was a paragraph on a neighbouring
entry, with no step telling anybody to deploy it.

How to use it:

- Before filing a new idea or feature, read `docs/DECIDED.md` (what was
  decided against, and the settled rules) and the `docs/systems` page for
  that part of the game, and name that page in the issue. An idea that
  goes against a decision there says so and asks for the decision to be
  changed, instead of quietly reopening it (#3192).
- Order is the do-order. A new issue gets the Order of where it belongs, not
  the end; a number between two others (52.5) is fine. Every open issue
  carries one (Patrick, 27 Oct, #3534): a new issue's card gets 10000 plus
  its number by itself, and the label `order: <number>` (`order: 52.5`) moves
  it to where it belongs, which is how a cloud thread moves one too
  (`.github\workflows\board.yml` sets the Order and takes the label off).
  The weekly review places what `scripts\ops\Check-Board.ps1` names without
  one or sharing one, and looks again at what nobody has touched for 30 days
  (`scripts\ops\List-Untouched.ps1`), never closing it for that.
- Every issue has a type: Bug, Feature or Task. A form sets it; an issue
  filed through the API says it (`-f type=Bug`), and one with none gets Bug
  when it is labelled `bug` or a Findings label, Feature for `Suggestion`,
  and Task otherwise (`.github\workflows\board.yml`).
- Work that fits an existing issue is an edit or a comment on it, not a
  second issue. Say in it what is left; what was measured goes with the
  evidence ("How an issue and a comment are written", below). A new issue
  whose title is like an open one's gets a comment naming it
  (`.github\workflows\duplicate-check.yml`, #5185); if it is the same
  problem, close the new one as a duplicate of the old, and if not, say on
  it how it differs. Nothing is closed for you.
- Uncommitted changes sitting in the repo are outstanding work and belong on
  the board too.
- Labels: `area:` is the part of the project, `needs: patrick` marks what
  waits on him, and `anyone can start` marks what needs nobody in
  particular. `Main Findings` and `Dev Findings` mark what testers found on
  main and on dev, and the bot keeps #known-issues and the site's Known
  Issues page from them. `roadmap: now`, `roadmap: next` and `roadmap: later`
  put an issue on the site's roadmap in that lane, in the words of its last
  `Roadmap:` comment, while it is open; the roadmap has no Done section
  (#3140, Patrick 26 Oct; bot README, "The site's known issues and
  roadmap"). `area: triage`
  marks an issue whose title did not say which part it is:
  `.github\workflows\area-label.yml` gives a new issue with no `area:` label
  the one its title names, or this one, and a person swaps it for the right
  area. `weekly-review` marks what the weekly project review found,
  `Suggestion` an idea somebody asked for, and `bug` something broken;
  nothing reads these three, they are for people sorting the board.
  `claimed: <name>` marks who is on an issue ("What this is" says how the
  Bots use it). Assign yourself when you start one. The stage is Order and
  Status: the `wave:` labels and `needs: the live server` were retired on
  22 Oct (#3192), because nothing read them and Order had replaced them.
- Status: In Progress the moment work starts, Done when it is merged and only
  needs testing (Patrick, 19 Oct). Nobody moves a card: the Status follows
  what GitHub knows (#5185, `.github\workflows\board.yml` and
  `scripts\ops\Sync-Board.js`). A closed issue is Done. An open one is In
  Progress while a pull request that names it (`Closes`, `Fixes`,
  `Resolves`, `Refs` or `Part of #N`, or its test task) is open, or while it
  carries a `claimed:` label; Done once a merged pull request carries its
  test task; Todo otherwise. So to move a card, change the fact: open the
  pull request, put the claim on, or close the issue, and the card follows
  within a minute. The Status options are Todo, In Progress and Done; never
  add one through the API, which rewrites every option and can clear the
  Status on every card. The `board:` labels did this by hand until #5185 and
  are gone. To see the cards, `pwsh scripts/ops/Read-Board.ps1` starts
  `.github\workflows\board-read.yml`, which reads every card's Status and
  Order and changes nothing, and writes them to board.json (#3192).
- A pull request that finishes an issue says `Closes #N`, so merging closes
  it and its card goes to Done. Say in the pull request which issues moved.
- A fix people would notice is the exception: its pull request says `Refs #N`,
  and the issue stays open until the fix reaches main (Patrick, 11 Oct: dev
  is where the team checks that nothing breaks the game, and main is where
  testers test, since we are in alpha). The pull request carries the test
  task as `Test task for #N: <a title of at most 45 characters>`, then
  numbered steps in plain English and what should happen, with no issue
  numbers, links or code. At the merge its card goes to Done by itself, and
  `.github\workflows\done-on-merge.yml` writes the test task on the issue. The main Ship that
  carries the merge closes it (#3279): after it tags the release,
  `scripts\release\Close-ShippedIssues.ps1` reads the board and closes every
  open issue in Done whose done-on-merge comment names a merge the release was
  built from, with a comment whose first line is `Test task: <title>` and the
  steps under it, and names the ones that stay open. Nobody closes these by
  hand. The bot turns that comment into a post in the #test-tasks forum the
  moment the issue closes, tagged Main, so closing it when it merges or when
  it reaches dev sends testers to look for a fix that main does not have.
  The test task in the pull request is Main, in the shape below, unless
  only a developer can make the check (Dev, below). To better the test task
  after the merge, write a newer `Test task:` comment of the same kind on
  the issue and leave it open: the Ship closes it with yours instead. A
  Dev test task never keeps the issue open. Whoever moves an issue to Done
  by hand (a fix spread over several pull requests, a pin, a change on the
  box) writes on it a comment whose first line is `Fixed by <merge commit,
  12 characters> (pull request #N).`, naming the last merge the fix needs,
  then either its Main test task in a fenced block, or the line
  `No test task: nobody would notice this fix.` The Ship reads that line as
  it reads done-on-merge's comment, from anybody, the newer of the two
  winning, and closes the issue when the release carries that merge (#3411).
  A line with neither a test task nor the no-task line keeps the issue open,
  and the Ship names it as trouble. To see what a main Ship
  would close, without closing anything:
  `.\scripts\release\Close-ShippedIssues.ps1 -Commit origin/main -Check`.

## How an issue and a comment are written

Decided by Patrick on 26 Oct (#3692), before the repository goes public:
every new issue and every comment on one is written plain, by everybody, a
person, a lane, a Claude or a workflow. When the repository goes public,
every issue and every comment goes public with it, open or closed, and the
ones written the old way are re-filed and then deleted (#3692). One written
plain never needs that.

- An issue is a plain title, two to five lines a person would write, and a
  last line `Done when:` with one thing somebody can check. The team's issue
  form asks for exactly that.
- A comment is the same: a few plain lines. A `Test task:` comment and a
  `Roadmap:` comment keep their own shapes ("Test tasks and known issues").
- Neither ever holds: who found it ("Found by the ... audit", "Written by",
  a lane's or a Claude's name, a thread or a Desk); a "Generated by/with
  Claude Code" line, a session link or a closing `---` written in by hand;
  the box's address, anybody's home address, a `C:\Users\<name>` path, an
  email, a Discord id or a person's real name; a secret's value; or for a
  security or privacy problem, anything somebody could use to exploit it.
- The one closing line nobody writes and nobody takes off: the platform puts
  `_Generated by [Claude Code](https://claude.ai/code)_` under a `---` at
  the end of everything a cloud Claude writes, on every path, and it cannot
  be turned off. The nightly check leaves that exact line at the very end
  alone and reads everything above it as usual.
- The evidence (files and lines, logs, what was measured, how the fix
  should go) goes in the private ops repo, in `issues/<number>.md` for the
  issue's number, never on the issue. Until that repository exists, it stays
  in the finder's own private notes and moves there with the rest.
- A claim is the `claimed:` label and the card in In Progress, with no
  comment. A comment saying where the work stands is fine, written plain.
- `scripts\dev\Nightly-PlainIssues.ps1`, run by the nightly, names every
  issue and comment of the last day that breaks this, and the night goes
  red until it is rewritten (#3692).

## Test tasks and known issues

The bot checks every post against these rules before it goes up, in all
three forums (`post_problems` in `bot\bot.py`, Patrick 22 Oct). A post that
breaks one is never made, and a post already up is not edited to it; the
issue gets one comment naming each rule broken, and the bot tries again once
the comment is fixed. The rules: no "---" or "Generated by/with Claude Code"
line; a title of 45 characters at most; the Server line matching the forum;
numbered steps; no issue numbers, links or code (backticks) in the text.
Dev: no step a Claude, the Desk, logs, the box, a harness, a workflow or a
command could do (a Dev test task is only for what a human dev must do in
the game; the rest is a "Check (Claude):" comment with its result), and not
ordinary playtester steps with no staff or dev command (that is Main). Main:
the fix commit is in the newest `release/main/` tag, and no staff or dev
command. Known issues: open, no merged pull request names it, no test task.
One post per issue per forum. The bot's token needs issues write to comment.

The same rules run on a pull request before it merges (#5199). The check
`Test tasks in the pull request` (`.github\workflows\test-tasks.yml`, with
`bot\pr_tasks.py`) reads each `Test task for #N:` block in the body the way
done-on-merge.yml will copy it, and calls `post_problems` on it for the forum
its Server line names. It also refuses what only a pull request gets wrong:
two of one kind for one issue, a Main one longer than the bot's first post,
a body that also says `Closes #N` for that issue (the merge would close it
before the test task is copied), and an issue that is closed or is not an
issue. Main's ruleset requires it beside `Build check result`. A body with
no test task passes. When it is red, edit the body; the edit runs it again.
To run it on a body before you push:
`python bot\pr_tasks.py --file <the body, saved as a file>`.

Three Discord forums show testing, and the bot keeps all three from the
board (`bot\README.md`, Testing). Patrick, 22 Oct: "dev test tasks are for
things that only devs can test and can still be there while on main; main
is for just regular testing for our playtesters, only when it's on main",
and known issues are what is on the board whose fix has not landed yet
(Patrick, 26 Oct, #3140). Test tasks never go on the report page; they go in Discord.

- **#test-tasks, Main test tasks.** An ordinary check any playtester can do
  with the normal game. If a playtester could do it once it is on main, it
  is Main, even when a dev command would make it quicker. Its comment is
  written only once a main Ship carries the fix, and the issue is closed
  with it: the main Ship does both from the pull request's test task
  (above), and the bot posts it the moment the issue closes. The shape:

      Test task: <what to try, 45 characters at most>
      Server: Main
      1. <a plain step in the game or the launcher>
      2. <the next step>
      What should happen: <what the tester should see>

  Plain words for testers: no issue numbers, links, commit ids, file
  names, commands they cannot type, or "dev". Commands anyone can type,
  such as `/stuck` or `/needs`, are fine. Nothing else goes in the comment; what
  shipped and where is said in a separate comment.
- **#dev-test-tasks, Dev test tasks.** A check only a dev can do: it needs
  staff or dev commands, the dev server, logs, the box, or a setup testers
  cannot make (a planted record or a hand-edited file counts; owning two
  screens does not). A fix that has reached dev and not yet main is not
  one: checking that a fix works is its Main test task, written when it
  reaches main, however soon that is (#613: Patrick found one in
  #dev-test-tasks, 22 Oct). Staff only. Written as soon as a build carries
  the work, open issue or closed: from the pull request's block, the dev
  Ship that carries the merge writes it on the issue with its Build: line
  naming that release (`Close-ShippedIssues.ps1 -Dev`, #5199), so nobody
  writes it by hand. It is posted at once, whole, with links to
  the issue, its pull requests and commits. It does not hold the issue
  open: the main Ship that carries the fix closes it all the same. It stays
  up while the fix is on main and after the issue closes, beside the Main
  one, until its comment is taken back, a newer Dev one replaces it, or
  staff close the post. The shape:

      Test task: <what to check, 45 characters at most>
      Server: Dev
      Build: <the dev release, gamemode commit or main release it needs>
      What it checks: <one line>
      1. <steps in developer terms: files, commands, log lines>
      What should happen: <what each step should print or show>

  An issue may have both: its Dev test task in #dev-test-tasks and its
  Main one in #test-tasks once it closes. A newer `Server: Dev` comment
  replaces the older Dev post; put every measurement the issue still needs
  in the newest. Put what was measured on the issue.
- **#known-issues.** An open issue labelled `Main Findings` or `Dev
  Findings` whose fix has not landed: it has no test task and is not in
  Done. The bot takes the post down the moment a `Test task:` comment is
  written on it, Done on merge writes its `Pull request #N merged` comment
  on it, or it closes or loses its label. Nobody moves a card by hand since
  #5185, so the comment and the board's Done always come together. A merged
  pull request alone does not take it down (Patrick, 26 Oct, #3140), so a
  measuring step or a partial fix leaves the post up. Every known issue is
  in the threads' work queue, so one is fixed in its turn and none waits
  for somebody to remember it (Patrick, 26 Oct). The site's Known Issues
  page is the same list. Its words come from the last `Known
  issue:` comment: a title of 45 characters at most, then what goes wrong,
  where, and how to avoid it, in plain words.
- **One post per issue per forum, never two.** A changed test task or known
  issue is an edit of its comment, or a newer comment, never a second post
  by hand. Never post a test task by hand (`/test-task`) for something on
  the board: the bot posts it from the comment. Two issues for one fix carry
  one test task, on the issue the fix belongs to. The bot keeps one post per
  issue and per title, open or closed, and `python bot.py --forum-check`
  (`--apply` to delete) finds and removes duplicates in all three forums.
- To take a test task back, edit its comment so its first line no longer
  starts with `Test task:`; the bot takes its post down.

## What is not a reason to skip an issue

Decided by Patrick on 11 Oct, after a pick of ten issues to work left out the
ones that needed him, needed the VPS, or named a later date. Choosing work
from the board, none of these three puts an issue aside:

- **It needs Patrick's decision.** Write the decision out in full, on the
  issue and to him: what is wrong, what was measured, each option and what it
  would do, and which one you recommend. Then he answers and the work goes
  ahead. His words: "If it needs my decision just give me the decision in
  full with my different options so we can get them done".
- **It needs the VPS.** The key is on the shipping machine and the scripts in
  `scripts\vps` and `scripts\deploy` reach the box, so VPS work is done by
  whoever takes the issue, not handed to Patrick. When a tool or permission
  layer refuses a command, say which one and ask Patrick for the rule. His
  words: "You have VPS access so you can do those ones".
- **It waits on a date.** Many dates written in issues were made up by an
  agent that did not want to do the work then. Check whether something real
  waits on that date, a release that is not out yet or a booked event, and if
  nothing does, do the work now. His words: "A date that hasn't come yet
  those might just be made up dates because agents were too lazy do those
  issues now".
