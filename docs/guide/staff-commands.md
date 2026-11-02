# Staff commands

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

Staff, testers and admins type these in the game's chat box: Enter opens it. They stay commands, unlike what people do in the world ([Buttons, not chat commands](rules.md#buttons-not-chat-commands)), and the help panel never lists them; the reply to `/help` and to a word the server does not know names `/tp`, `/give`, `/spawn` and `/where` to a tester and nobody else (#1633). [docs/systems/commands.md](../systems/commands.md) has every command there is with the line the server reads it at. The code is the staff block of `game\gamemode.js` (`// ==== thornswood staff ====`) and the `/tp`, `/give`, `/spawn` and `/where` branches of `handle` in its chat commands block. A pull request that adds or changes a staff command changes its row here and on that page too.

## Who may run them

| Tier | Who | Runs |
| --- | --- | --- |
| Tester | The Playtester role on Discord, which is the door's allowed list, and the profiles in `thornswoodPlaytesters` in the game server's `server-settings.json` on the VPS | [For yourself](#for-yourself) |
| Staff | The Discord staff roles, Owner, Dev, Gamemaster, Moderator and Loremaster, and the profiles in `thornswoodDevs` | Everything a tester runs, and everything below except the admin rows |
| Admin | The Owner and Dev roles, and the profiles in `thornswoodAdmins` | Everything, and `/unpk`, `/embassy` and `/remnant` |

An admin is staff and staff are testers, so nobody is listed twice. Anybody else is told "That one is not yours to run." Every tier also needs the launcher's join pass, so leave the Thornswood launcher open while you play.

A staff command also needs the chat to have proved who you are. When it has not, the answer says so: "Staff commands need the chat to have proved who you are" means close the game, open the launcher and press Play; "Staff commands need your launcher's pass" means the launcher was closed, so open it and wait a minute.

A person, wherever these say `<person>`, is their name or the start of it while only one name starts that way, the form id the crosshair gives, or their profile number. A profile number reaches somebody who has left, for a ban, a note or `/unsilence`.

Each staff command answers you in your chat, tells the person it was done to, writes a line to `thornswood.log`, and writes a line to `for-bot\moderation.log` beside the server, which the bot says in the staff channel.

## For yourself

| Command | What it does |
| --- | --- |
| `/tp` | Lists the towns you can name |
| `/tp <place>`, `/goto <place>` | Moves you to a town, or to any inn, keep, shop or house by its name. Part of the name is enough: `/tp bannered mare` |
| `/give <item> [count]` | Puts it in your pack. Any named item in the load order, gold included, or a form id: `/give iron ore 5`, `/give 12eb7:Skyrim.esm`. Up to 100,000 |
| `/spawn <creature> [count]` | Puts it a few steps in front of you, several spread round you. Any named actor, or a form id: `/spawn troll`, `/spawn skeleton 3`, `/spawn 23aba`. Up to 40 |
| `/where` | Your cell, position and facing, for a bug report or a new place. Refused to anybody who is not a tester (#1633) |

The count is the last word, and only when it is a number with a name in front of it.

## At somebody else

Staff. With no person named, `/give`, `/spawn` and `/tp` are the ones for yourself, above.

| Command | What it does |
| --- | --- |
| `/give <person> <item> [count]` | Puts it in their pack |
| `/spawn <creature> [count] on <person>`, `/spawnat <person> <creature> [count]` | Puts it beside them |
| `/tp <person> <place or person>` | Sends them to a place, or to somebody else |
| `/bring <person>` | Moves them to you |
| `/goto <person>` | Moves you to them |

Somebody frozen stays frozen where they are sent.

## Keeping order

Staff.

| Command | What it does |
| --- | --- |
| `/warn <person> <why>` | Tells them that staff have warned them, why, and that the next step is being removed from the world |
| `/freeze <person> [why]` | Holds them where they stand, across a reconnect |
| `/unfreeze <person>` | Lets them go |
| `/silence <person> [minutes] [why]` | Stops their voice, what they type, the words above their head and the speaking mark. 30 minutes unless you say, a day at most. Their name stays |
| `/unsilence <person>` | Lets them speak again |
| `/kick <person> [why]` | Tells them, then ends their session four seconds later |

## Bans, PKs and notes

Staff, apart from `/unpk`. These are kept on the site, on the staff pages at https://thornswood.net/hub, and a ban ends the session at once.

| Command | What it does |
| --- | --- |
| `/ban <person> <how long> <why>` | Bans this character. How long is `30m`, `2h`, `3d`, `1w`, a number of minutes, or `forever`: `/ban Aela 3d spamming the market`. Their other characters can still play |
| `/unban <person>` | Lifts the ban on this character |
| `/banaccount <person> <how long> <why>` | Bans the whole Discord account: every character on it, and any new one |
| `/unbanaccount <person>` | Lifts the ban on the account |
| `/pk <person> <why>` | The character dies for good. It is kept for staff, the account can make a new one, and nobody but you and its owner is told |
| `/unpk <person or character> <why>` | Admins only. Undoes a PK made by mistake: a profile number, the start of the dead character's name, or its owner. It comes back into a free slot on the account; with none free, the site says so and nothing changes. The PK stays on the record with your reason |
| `/note <person> <text>` | Keeps a note against them, for staff to read on the site |

## Wounds for a scene

Staff. For a Gamemaster's scene, or an agreed loss the person said yes to out of character. [docs/systems/injury.md](../systems/injury.md) says what each one does.

| Command | What it does |
| --- | --- |
| `/hurt <person>` | What they have now |
| `/hurt <person> cut`, `bite`, `break arm`, `break leg` | A wound |
| `/hurt <person> chill`, `food`, `fouled`, `fever`, `bitesick` | A disease, caught now with no roll |
| `/hurt <person> agreed hand`, `eye`, `scar <what people are told>` | An agreed loss |
| `/hurt <person> unagree hand`, `eye`, `scar` | Takes back an agreed loss written down by mistake |
| `/hurt <person> clear` | Every wound and disease, but not an agreed loss |

## The embassy and remnant rolls

Admins only.

| Command | What it does |
| --- | --- |
| `/embassy` | The roll, how many are on it, and which building it is |
| `/embassy add <person>`, `/embassy add <person> armed` | Onto the roll, marked armed or not. 20 at most, 6 of them armed |
| `/embassy arm <person>`, `/embassy disarm <person>` | Marks them armed, or not |
| `/embassy remove <person>` | Off the roll |
| `/remnant`, `/remnant add <person>`, `/remnant remove <person>` | The Thalmor remnant roll, once an application is accepted |

## Restarts

Not from the chat: `/restart` and `/shutdown` answer that restarts are not run from chat. A developer counts the server down from a machine the VPS knows, with `scripts\vps\Request-Restart.ps1` (the list under [After a pull request is merged](after-a-merge.md)).

## In Discord

| Command | Who | What it does |
| --- | --- | --- |
| `/close [why]` | Staff, in a ticket: the bot's `STAFF_ROLES`, by id or name, never Manage Threads alone (#1342) | Closes the ticket |
| `/test-task title body [tag]` | Owner, Dev and Lead Gamemaster (`TEST_TASK_ROLES`) | Posts one thread: tagged Main (the default) in the #test-tasks forum, for testers on main, or tagged Dev in the staff-only #dev-test-tasks, for something someone on dev has to measure (Patrick, 12 Oct). The Live smoke checklist and `/live-smoke` were taken out on 11 October |
