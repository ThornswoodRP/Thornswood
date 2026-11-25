# Staff commands

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

Staff, testers and admins type these in the game's chat box: Enter opens it. They stay commands, unlike what people do in the world ([Buttons, not chat commands](rules.md#buttons-not-chat-commands)), and the help panel never lists them; the reply to `/help` and to a word the server does not know names `/tp`, `/give`, `/spawn` and `/where` to a tester and nobody else (#1633). [docs/systems/commands.md](../systems/commands.md) has every command there is with the line the server reads it at. The code is `game\gamemode\staff.ts` and the `/tp`, `/give`, `/spawn` and `/where` branches of `handle` in `game\gamemode\chat-commands.ts`. A pull request that adds or changes a staff command changes its row here and on that page too.

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

## Find your commands

| Command | Who | What it shows |
| --- | --- | --- |
| `/testhelp` | Playtesters, staff and admins | Self-only test tools, with syntax and examples, on both Dev and Main |
| `/staffhelp` | Staff and admins | Existing staff moderation tools and the self-only test tools |
| `/adminhelp` | Admins | Admin tools and the lower tiers |

Each list requires the proven chat connection, a current launcher pass and your character in the world. New tool entries appear when their implementation is running on the server. [Playtest and admin commands](../systems/playtest-and-admin-commands.md) records the agreed capabilities and permissions.

## Repair equipment for testing

Playtesters, staff and admins can use `/repairgear` on themselves on both Dev and Main. Admins can use `/repairgear for <person>` on somebody else. A playtester may also name their own character unambiguously.

The command restores every carried weapon, armour piece and garment below 100% to sound condition. Pieces above 100% keep their condition. Jewellery and tools keep their ordinary rules. Custom names, tempering, enchantments, charges, poisons, counts and ownership remain with each piece; no repair kits are spent. The worn record and pack change together, and the action is recorded.

The command requires the server's equipment repair support. If the equipment changed while the repair was being prepared, it refuses rather than guessing which piece was meant. If the server cannot confirm a repair, staff should check that problem before repeating the command.

## Set needs for testing

Playtesters, staff and admins can use `/setneeds <hunger|thirst|rest|temperature> <value>` on themselves on both Dev and Main. Admins can add `for <person>` to change another character. An unambiguous explicit self target also works for a playtester.

Use a decimal number from 0 to 100, including both bounds. Hunger, thirst and rest are full at 100; temperature is comfortable at 50, colder below and hotter above. For example, `/setneeds thirst 25` sets your drink meter to 25, while `/setneeds temperature 50 for Aldis` sets Aldis to comfortable warmth.

The other needs first account for their elapsed time. The selected value is then saved exactly, its penalties and displays refresh, and the change is recorded. Injuries, carried items and ongoing effects retain their ordinary rules. Existing invalid needs are refused; a character with no needs record starts with the ordinary full meters and comfortable temperature before the requested change.

## For yourself

| Command | What it does |
| --- | --- |
| `/setneeds` | Set your own hunger, thirst, rest or temperature. Admins may name another character. |
| `/repairgear` | Repair your carried gear. Admins may name another character. |
| `/tp` | Lists the towns you can name |
| `/tp <place>`, `/goto <place>` | Moves you to a town, or to any inn, keep, shop or house by its name. Part of the name is enough: `/tp bannered mare` |
| `/give <item> [count]` | Puts it in your pack. Any named item in the load order, gold included, or a form id: `/give iron ore 5`, `/give 12eb7:Skyrim.esm`. Up to 100,000 |
| `/spawn <creature> [count] [keep]` | Puts it a few steps in front of you, several spread round you. Any named actor, or a form id: `/spawn troll`, `/spawn skeleton 3`, `/spawn 23aba`. Up to 40. It is temporary unless the line ends in `keep`: when it dies its body lies the usual time and then it is gone, and a restart takes it too. `/spawn troll keep` stays (#2623) |
| `/where` | Your cell, position and facing, for a bug report or a new place. Refused to anybody who is not a tester (#1633) |
| `/tpto <person>` | Teleports your own living character to an unambiguous online person, by name, prefix, profile or character id. Playtesters may use it on Dev and Main; frozen, cuffed and locked-jail movement is refused. It never moves the other person |

The count is the last word, and only when it is a number with a name in front of it.

## Restore vitals for testing

| Command | Who | What it does |
| --- | --- | --- |
| `/heal` | Playtesters, staff and admins, on Dev and Main | Restores your current health, magicka and stamina |
| `/heal for <person>` | Admins for another character; the self-only permission still permits your own named character | Restores the named online character's vitals |

Healing does not undo death, change progression, repair equipment or remove injury decisions. It uses the current character's actual vitals and records a successful change. An invalid command or a refused write never reports a successful heal.

## At somebody else

Staff. With no person named, `/give`, `/spawn` and `/tp` are the ones for yourself, above.

| Command | What it does |
| --- | --- |
| `/give <person> <item> [count]` | Puts it in their pack |
| `/spawn <creature> [count] on <person> [keep]`, `/spawnat <person> <creature> [count] [keep]` | Puts it beside them, temporary unless the line ends in `keep`, as above |
| `/tp <person> <place or person>` | Sends them to a place, or to somebody else |
| `/bring <person>` | Moves them to you |
| `/goto <person>` | Moves you to them |

Somebody frozen stays frozen where another staff member sends them. Their own teleport commands are refused until they are released.

## Inspect a character

| Command | Who | What it shows |
| --- | --- | --- |
| `/inspect` | Playtesters, staff and admins, on Dev or Main | Your character's name and form id, location, vitals, last recorded needs, class, profession and ranks |
| `/inspect for <person>` | Playtesters for their own unambiguous character; admins for somebody else | The same report for the selected character, using a name, unique name prefix, form id or profile number |

The report reads gameplay state without advancing needs or migrating a character. Positions and percentages are rounded to one decimal place. Missing or invalid values say unavailable, including god mode when the engine does not expose its flag. Private account and Discord data are excluded. Each report uses several short chat lines, so all ranks fit.

## Spawned creatures

Staff.

| Command | What it does |
| --- | --- |
| `/despawn` | Takes the creature a spawn command made that is nearest you, within about 20 m in your cell, out of the world for good, kept or not, alive or dead. Never a creature or person the world put there (#2623) |

## Scene tools

These scene tools work for Playtesters on Dev and Main. Modes end when the
session loses its current pass or role, or the actor's authority changes.
They accept no other person's name. [Staff scene tools](../systems/staff-tools.md)
describes their native dependency, lifecycle and game acceptance checks.

| Command | What it does |
| --- | --- |
| `/fly [on\|off]` | Toggles collision-free flight for yourself. Frozen, cuffed or locked-jail movement remains refused |
| `/phase` | Moves you 256 units forward in the same cell, unless frozen, cuffed or held in a locked jail |
| `/godmode [on\|off]` | Toggles flight, damage protection, lethal validated attacks and paused hunger, thirst, Rest and temperature. Existing needs values resume on exit; dead characters cannot enable it |
| `/invisible [on\|off]` | Hides or shows your rendered body and nearby/party name tags; NPC perception stays as it was |
| `/cleareffects` | Clears your alcohol and drug effects, pending crashes, hangover and withdrawal. Existing injuries, disease and unrelated magic remain |

The cleanup command requires the Admin role.

| Command | What it does |
| --- | --- |
| `/killall` (admin only) | Ends up to 40 ordinary hostile encounters or hostile staff spawns within about 20 m in the same cell. Excludes people and protected, essential, unique, town or unreadable actors. Reports counts and logs target IDs for staff. |

## Buildings, stalls and carts

A steward runs `/evict`, `/rent` and `/stall end` in their own hold only; staff run them at any building or stall. The cart stops and roads are staff's alone. The panels send these lines rather than anybody typing them; [docs/systems/commands.md](../systems/commands.md) names each button.

| Command | What it does |
| --- | --- |
| `/evict`, `/rent <gold>`, `/rent -`, `/rent paid <profile> <gold>` | Ends the claim on the door opened in the last minute, sets its rent, takes the rent off, or marks rent paid, at any building. Logged for staff (#2551). Evict, Set rent, No rent and Rent paid on the Office page of K send them |
| `/stall end` | Ends somebody's keeping of a market stall, logged. End this claim on the stall's panel sends it (#3160) |
| `/cart staff`, `/cart draft`, `/cart confirm <base>`, `/cart add <stop>`, `/cart bring <cart>` | The cart stops and roads: opens them, drafts and confirms a change, puts a new cart at a stop, and brings in a cart on the road. Cart stops and roads on the Office page of K opens them (#3158) |

## Guild work

Staff. Typed in chat.

| Command | What it does |
| --- | --- |
| `/book reward <good>`, `/book reward <good> <gold>`, `/book reward <good> start` | Reads, sets or puts back on its starting price what a good pays each in guild commissions (#6180). Name the good as the panel does, or by its record: `/book reward fur boots 12`, `/book reward 86983:Skyrim.esm 9`. Work already taken keeps the pay it was taken at. A hold's submitted price list still sets only what its traders buy and sell |

## Crafting

Staff.

| Command | What it does |
| --- | --- |
| `/craftstaff pick`, `raise`, `recipe`, `recipes`, `give` | The crafting card on the Office page of K (#3167): picks somebody in the world, raises one of their ranks one step, checks why an owned recipe or kept smelt is stuck for them (unowned recipes are outside the check), and gives back an item with a count and a reason. Never on yourself for `raise` and `give`. Sent by the card's buttons, never typed |

## Keeping order

Staff.

| Command | What it does |
| --- | --- |
| `/warn <person> <why>` | Tells them that staff have warned them, why, and that the next step is being removed from the world |
| `/freeze <person> [why]` | Holds them where they stand, across a reconnect |
| `/unfreeze <person>` | Lets them go |
| `/silence <person> [length] [why]` | Stops their voice, what they type, the words above their head and the speaking mark. Takes minutes or the same length forms as `/ban`, such as `30m`, `2h` or `1d`, capped at one day. Defaults to 30 minutes when no length is given; invalid or permanent lengths are refused. Their name stays |
| `/unsilence <person>` | Lets them speak again |
| `/kick <person> [why]` | Tells them, then ends their session four seconds later |

## Rename a character

Admins only, including when renaming yourself. Playtesters and staff without the admin role cannot use either form.

| Command | What it does |
| --- | --- |
| `/rename self <new name>` | Renames your current saved character |
| `/rename <person> <new name>` | Renames another character who is in the world; names, unique name prefixes, form ids and profile numbers work |

Names use 1 to 60 characters: Unicode letters and numbers, spaces, apostrophes, hyphens or periods, with at least one letter or number. Accents are normalized to NFC, outer spaces are trimmed and repeated spaces become one. Controls, invisible direction marks and markup are refused. Existing duplicate names remain allowed; use the character's form id or profile number when a name is ambiguous. The character, account and profile stay the same, the new name survives reconnecting, and the staff record keeps the old and new names.

## Bans, PKs and notes

Staff, apart from `/unpk`. These are kept on the site, on the staff pages at https://thornswood.net/hub, and a ban ends the session at once. A ban lifted there stops counting in the game once the door has fetched and read a newer ban list.

| Command | What it does |
| --- | --- |
| `/ban <person> <how long> <why>` | Bans this character. How long is `30m`, `2h`, `3d`, `1w`, a number of minutes, or `forever`: `/ban Aela 3d spamming the market`. Their other characters can still play |
| `/unban <person>` | Lifts the ban on this character |
| `/banaccount <person> <how long> <why>` | Bans the whole Discord account: every character on it, and any new one |
| `/unbanaccount <person>` | Lifts the ban on the account |
| `/pk <person> <why>` | The character dies for good. It is kept for staff, the account can make a new one, and nobody but you and its owner is told |
| `/unpk <person or character> <why>` | Admins only. Undoes a PK made by mistake: a profile number, the start of the dead character's name, or its owner. It comes back into a free slot on the account; with none free, the site says so and nothing changes. The PK stays on the record with your reason |
| `/note <person> <text>` | Keeps a note against them, for staff to read on the site |

When several bans apply, the message uses an account ban first. Among bans of the same kind, it uses the longest one, with forever lasting longest.

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
| `/close [why]` | Staff (`STAFF_ROLES`, by ID or name), or a role ID in `UPPER_STAFF_ROLES` for a Faction Leader ticket. Manage Threads alone does not qualify | Archives and locks the ticket from inside its own thread |
| `/test-task title body [tag]` | Owner, Dev and Lead Gamemaster (`TEST_TASK_ROLES`) | Posts one thread: tagged Main (the default) in the #test-tasks forum, for testers on main, or tagged Dev in the staff-only #dev-test-tasks, for something someone on dev has to measure (Patrick, 12 Oct). The Live smoke checklist and `/live-smoke` were taken out on 11 October |
