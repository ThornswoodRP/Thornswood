# Developer Guide

This is the one guide for working on Thornswood. This page is its index: each task has a short page of its own in `docs\guide`, listed below in the order a first day reads them. A later day opens the page it needs, or finds a section by name in the table of contents. `CLAUDE.md` in the private ops repo adds only what applies to a Claude.

Each page's outline nests the same way: a page is a task, a section is a group inside it, and a subsection is a step.

- Repository: https://github.com/ThornswoodRP/Thornswood
- Board: https://github.com/orgs/ThornswoodRP/projects/1
- Site: https://thornswood.net
- Staff pages: https://thornswood.net/hub
- Long glossary: [docs/GLOSSARY.md](docs/GLOSSARY.md)

## The pages

Each page is one task. A first day reads them in this order; a later day opens the one it needs, or finds a section by name in the table of contents below. A citation names the page and the section, for example `docs/guide/rules.md, "Fix the cause, no band-aids"`.

| Page | What it is for |
| --- | --- |
| [Set up a machine](docs/guide/set-up-a-machine.md) | A new PC from nothing to a clone that builds, and a PC that can sign and publish a release. |
| [Make a change](docs/guide/make-a-change.md) | One issue, one branch, one pull request: start from main, commit, open the pull request, merge it. |
| [The rules](docs/guide/rules.md) | What Thornswood is, the words, fixing the cause instead of a band-aid, and buttons instead of chat commands. |
| [The board, issues and test tasks](docs/guide/the-board.md) | Filing and ordering issues, how an issue and a comment are written, test tasks and known issues, and what is not a reason to skip one. |
| [Settled design, not up for a quiet rewrite](docs/guide/settled-design.md) | The design that stays unless the team agrees to change it. |
| [How work moves: the rules and the long form](docs/guide/how-work-moves.md) | Main, hotfixes and merging, branch names, dev first, signing, the build check and the six shared files, and the long form. |
| [Release to dev](docs/guide/release-to-dev.md) | Putting a change on the dev server and the dev launcher. |
| [Release to main](docs/guide/release-to-main.md) | Putting a release on the live server, a hotfix, and how a release goes out. |
| [After a pull request is merged](docs/guide/after-a-merge.md) | What runs after a merge, part by part. |
| [How the system fits together](docs/guide/the-system.md) | How the pieces fit together, and where things are written down. |
| [The tools, A to O](docs/guide/tools.md) | One letter per tool, from GitHub to the repository map: what it is, then the commands. |
| [Secrets, by name and place, never by value](docs/guide/secrets.md) | Every secret by name and where it lives, never its value. |
| [Staff commands](docs/guide/staff-commands.md) | The commands staff, testers and admins type in the game, and who may run each. |

## Table of Contents

- [Glossary](#glossary)
- [Set up a machine](docs/guide/set-up-a-machine.md)
  - [On every PC](docs/guide/set-up-a-machine.md#on-every-pc)
    - [Install the tools](docs/guide/set-up-a-machine.md#install-the-tools)
      - [What each install is](docs/guide/set-up-a-machine.md#what-each-install-is)
    - [Check that the tools open](docs/guide/set-up-a-machine.md#check-that-the-tools-open)
    - [Install the OpenSSH client](docs/guide/set-up-a-machine.md#install-the-openssh-client)
      - [When the class is not registered](docs/guide/set-up-a-machine.md#when-the-class-is-not-registered)
    - [Sign the GitHub CLI into your account](docs/guide/set-up-a-machine.md#sign-the-github-cli-into-your-account)
    - [Clone the repository](docs/guide/set-up-a-machine.md#clone-the-repository)
    - [Open the folder in Visual Studio Code](docs/guide/set-up-a-machine.md#open-the-folder-in-visual-studio-code)
    - [Reach the VPS](docs/guide/set-up-a-machine.md#reach-the-vps)
  - [Setting up a machine](docs/guide/set-up-a-machine.md#setting-up-a-machine)
  - [Shipping from another machine](docs/guide/set-up-a-machine.md#shipping-from-another-machine)
    - [Your own signing sign in](docs/guide/set-up-a-machine.md#your-own-signing-sign-in)
      - [Patrick, once for each person](docs/guide/set-up-a-machine.md#patrick-once-for-each-person)
      - [The person, on their own machine](docs/guide/set-up-a-machine.md#the-person-on-their-own-machine)
      - [Never a device code](docs/guide/set-up-a-machine.md#never-a-device-code)
      - [When somebody stops shipping](docs/guide/set-up-a-machine.md#when-somebody-stops-shipping)
    - [Check the machine and Ship](docs/guide/set-up-a-machine.md#check-the-machine-and-ship)
- [Make a change](docs/guide/make-a-change.md)
  - [On your branch](docs/guide/make-a-change.md#on-your-branch)
    - [Start from a current main](docs/guide/make-a-change.md#start-from-a-current-main)
    - [Save the work in a commit](docs/guide/make-a-change.md#save-the-work-in-a-commit)
    - [After a change to the content plugin](docs/guide/make-a-change.md#after-a-change-to-the-content-plugin)
    - [Switch between branches](docs/guide/make-a-change.md#switch-between-branches)
      - [Commit, then switch](docs/guide/make-a-change.md#commit-then-switch)
      - [Set the edits aside](docs/guide/make-a-change.md#set-the-edits-aside)
    - [Open the pull request](docs/guide/make-a-change.md#open-the-pull-request)
      - [A one-line body](docs/guide/make-a-change.md#a-one-line-body)
      - [A body of several lines](docs/guide/make-a-change.md#a-body-of-several-lines)
      - [When the pull request will not open](docs/guide/make-a-change.md#when-the-pull-request-will-not-open)
    - [Merge your own pull request](docs/guide/make-a-change.md#merge-your-own-pull-request)
- [The rules](docs/guide/rules.md)
  - [What this is](docs/guide/rules.md#what-this-is)
  - [Words](docs/guide/rules.md#words)
  - [Fix the cause, no band-aids](docs/guide/rules.md#fix-the-cause-no-band-aids)
  - [Buttons, not chat commands](docs/guide/rules.md#buttons-not-chat-commands)
- [The board, issues and test tasks](docs/guide/the-board.md)
  - [Everything we need to do goes on the board](docs/guide/the-board.md#everything-we-need-to-do-goes-on-the-board)
  - [How an issue and a comment are written](docs/guide/the-board.md#how-an-issue-and-a-comment-are-written)
  - [Test tasks and known issues](docs/guide/the-board.md#test-tasks-and-known-issues)
  - [What is not a reason to skip an issue](docs/guide/the-board.md#what-is-not-a-reason-to-skip-an-issue)
- [Settled design, not up for a quiet rewrite](docs/guide/settled-design.md)
- [How work moves: the rules and the long form](docs/guide/how-work-moves.md)
  - [How work moves](docs/guide/how-work-moves.md#how-work-moves)
    - [Main, hotfixes, and merging](docs/guide/how-work-moves.md#main-hotfixes-and-merging)
    - [Branch names](docs/guide/how-work-moves.md#branch-names)
    - [Dev first, notes, and open branches](docs/guide/how-work-moves.md#dev-first-notes-and-open-branches)
    - [Signing, the build check, and the six shared files](docs/guide/how-work-moves.md#signing-the-build-check-and-the-six-shared-files)
  - [How work moves, the long form](docs/guide/how-work-moves.md#how-work-moves-the-long-form)
- [Release to dev](docs/guide/release-to-dev.md)
  - [The content plugin goes to the server first](docs/guide/release-to-dev.md#the-content-plugin-goes-to-the-server-first)
  - [Say so, then write the note](docs/guide/release-to-dev.md#say-so-then-write-the-note)
  - [Mark the dev notes again](docs/guide/release-to-dev.md#mark-the-dev-notes-again)
  - [Put the gamemode on the dev server](docs/guide/release-to-dev.md#put-the-gamemode-on-the-dev-server)
  - [Look before you post the news again](docs/guide/release-to-dev.md#look-before-you-post-the-news-again)
  - [What any developer may do](docs/guide/release-to-dev.md#what-any-developer-may-do)
- [Release to main](docs/guide/release-to-main.md)
  - [The version comes from the build](docs/guide/release-to-main.md#the-version-comes-from-the-build)
  - [The content plugin goes to the live server first](docs/guide/release-to-main.md#the-content-plugin-goes-to-the-live-server-first)
  - [Ship main](docs/guide/release-to-main.md#ship-main)
  - [Deploy the live pieces the pull request touched](docs/guide/release-to-main.md#deploy-the-live-pieces-the-pull-request-touched)
  - [A hotfix](docs/guide/release-to-main.md#a-hotfix)
  - [How a release goes out](docs/guide/release-to-main.md#how-a-release-goes-out)
- [After a pull request is merged](docs/guide/after-a-merge.md)
- [How the system fits together](docs/guide/the-system.md)
  - [What Thornswood is](docs/guide/the-system.md#what-thornswood-is)
  - [The pieces](docs/guide/the-system.md#the-pieces)
  - [One Skyrim of its own](docs/guide/the-system.md#one-skyrim-of-its-own)
  - [Where things are written down](docs/guide/the-system.md#where-things-are-written-down)
- [The tools, A to O](docs/guide/tools.md)
  - [A. GitHub](docs/guide/tools.md#a-github)
    - [Sign in and look](docs/guide/tools.md#sign-in-and-look)
    - [Where your commits are](docs/guide/tools.md#where-your-commits-are)
    - [Learn more about GitHub](docs/guide/tools.md#learn-more-about-github)
  - [B. Git](docs/guide/tools.md#b-git)
    - [See the branch and the edits](docs/guide/tools.md#see-the-branch-and-the-edits)
    - [The commands the rest of the guide uses](docs/guide/tools.md#the-commands-the-rest-of-the-guide-uses)
    - [Learn more about Git](docs/guide/tools.md#learn-more-about-git)
  - [C. PowerShell](docs/guide/tools.md#c-powershell)
    - [Where you are](docs/guide/tools.md#where-you-are)
    - [Run a script from the repository folder](docs/guide/tools.md#run-a-script-from-the-repository-folder)
    - [Run a harness by hand](docs/guide/tools.md#run-a-harness-by-hand)
    - [Learn more about PowerShell](docs/guide/tools.md#learn-more-about-powershell)
  - [D. Visual Studio Code](docs/guide/tools.md#d-visual-studio-code)
    - [Open this repository](docs/guide/tools.md#open-this-repository)
    - [The parts of the window](docs/guide/tools.md#the-parts-of-the-window)
    - [Where to click](docs/guide/tools.md#where-to-click)
    - [Learn more about Visual Studio Code](docs/guide/tools.md#learn-more-about-visual-studio-code)
  - [E. VPS](docs/guide/tools.md#e-vps)
    - [Run a verb](docs/guide/tools.md#run-a-verb)
    - [Two reads](docs/guide/tools.md#two-reads)
    - [Learn more about VPS](docs/guide/tools.md#learn-more-about-vps)
  - [F. Website](docs/guide/tools.md#f-website)
    - [Deploy](docs/guide/tools.md#deploy)
    - [Learn more about Website](docs/guide/tools.md#learn-more-about-website)
  - [G. Main Build](docs/guide/tools.md#g-main-build)
    - [Learn more about Main Build](docs/guide/tools.md#learn-more-about-main-build)
  - [H. Dev Build](docs/guide/tools.md#h-dev-build)
    - [Install it from the main launcher](docs/guide/tools.md#install-it-from-the-main-launcher)
    - [The Play page](docs/guide/tools.md#the-play-page)
    - [Learn more about Dev Build](docs/guide/tools.md#learn-more-about-dev-build)
  - [I. Bot](docs/guide/tools.md#i-bot)
    - [Deploy the code](docs/guide/tools.md#deploy-the-code)
    - [Learn more about Bot](docs/guide/tools.md#learn-more-about-bot)
  - [J. Node](docs/guide/tools.md#j-node)
    - [See the version and run a test](docs/guide/tools.md#see-the-version-and-run-a-test)
    - [Learn more about Node](docs/guide/tools.md#learn-more-about-node)
  - [K. Vortex](docs/guide/tools.md#k-vortex)
    - [Install the collection](docs/guide/tools.md#install-the-collection)
    - [Learn more about Vortex](docs/guide/tools.md#learn-more-about-vortex)
  - [L. Pandora](docs/guide/tools.md#l-pandora)
    - [Learn more about Pandora](docs/guide/tools.md#learn-more-about-pandora)
  - [M. Creation Kit](docs/guide/tools.md#m-creation-kit)
    - [Change a record](docs/guide/tools.md#change-a-record)
    - [Learn more about Creation Kit](docs/guide/tools.md#learn-more-about-creation-kit)
  - [N. The repository map](docs/guide/tools.md#n-the-repository-map)
    - [Why it is split this way](docs/guide/tools.md#why-it-is-split-this-way)
    - [How to move around](docs/guide/tools.md#how-to-move-around)
    - [What each folder is](docs/guide/tools.md#what-each-folder-is)
    - [Files you will open often](docs/guide/tools.md#files-you-will-open-often)
    - [Learn more about the repository](docs/guide/tools.md#learn-more-about-the-repository)
  - [O. Others](docs/guide/tools.md#o-others)
    - [Python](docs/guide/tools.md#python)
    - [The .NET Framework](docs/guide/tools.md#the-net-framework)
    - [SkyMP](docs/guide/tools.md#skymp)
    - [HTML](docs/guide/tools.md#html)
    - [CSS](docs/guide/tools.md#css)
    - [JavaScript](docs/guide/tools.md#javascript)
    - [Learn more about the other tools](docs/guide/tools.md#learn-more-about-the-other-tools)
- [Secrets, by name and place, never by value](docs/guide/secrets.md)
- [Staff commands](docs/guide/staff-commands.md)
  - [Who may run them](docs/guide/staff-commands.md#who-may-run-them)
  - [For yourself](docs/guide/staff-commands.md#for-yourself)
  - [At somebody else](docs/guide/staff-commands.md#at-somebody-else)
  - [Keeping order](docs/guide/staff-commands.md#keeping-order)
  - [Bans, PKs and notes](docs/guide/staff-commands.md#bans-pks-and-notes)
  - [Wounds for a scene](docs/guide/staff-commands.md#wounds-for-a-scene)
  - [The embassy and remnant rolls](docs/guide/staff-commands.md#the-embassy-and-remnant-rolls)
  - [Restarts](docs/guide/staff-commands.md#restarts)
  - [In Discord](docs/guide/staff-commands.md#in-discord)

## Glossary

The words this guide uses. The long alphabetical list, with file names, is [docs/GLOSSARY.md](docs/GLOSSARY.md).

| Term | Meaning |
| --- | --- |
| Repository | This project folder plus the history Git keeps for it |
| Clone | The copy of the repository on your PC |
| Commit | One saved step, with a message, on the branch you are on |
| Branch | A named line of commits. The folder shows one branch at a time |
| `main` | The shared branch. A live release is built from it |
| Pull request | The GitHub page that puts a branch's commits onto `main` when it is merged |
| Push | Upload the branch you are on to GitHub |
| Pull | Download new commits from GitHub onto the branch you are on |
| Ship | The command that builds a release and publishes one channel |
| Channel | `dev` or main. Each channel has its own feed, server, and news |
| Dev build | The second launcher, `Thornswood-DevBuild`, used to try a release |
| Main build | The live launcher install |
| Feed | `version.json` for one channel. The launcher reads it from the site |
| Baseline | The record of the files the last release on that channel shipped |
| Note | The release post: a title, then one line starting with `- ` for each thing a person will notice |
| VPS | The remote machine that runs the site, the bot, voice, and both game servers |
| Gamemode | `game\gamemode.js`, the rules the game server runs |
| Hotfix | A live release of one fix, built from the commit that is already live |
| Vortex | The mod manager. The Thornswood profile deploys the collection |
| Pandora | Pandora Behaviour Engine+. It builds the behavior files before a Ship |
| Creation Kit | Bethesda's tool for plugin records. A release does not ship the kit itself |
| Node | The program that runs the website, the voice service, and `node tests\...` |
| Bot | The Discord bot in the `bot` folder |
| Build check result | The check on a pull request: it passes only when Launcher builds and every share of the gate passed. Merge when it, Test tasks in the pull request and Release note say pass |
| Test tasks in the pull request | The check that holds each `Test task for #N:` block in a pull request's body to the bot's post rules before the merge. Editing the body runs it again |
| Release note | The check that holds a pull request's `Release note:` line to its rules, on the pull request and again in the merge queue, so every merge release can write its notes. Editing the body runs it again |
| Worktree | A second folder on this PC, checked out on its own branch |
