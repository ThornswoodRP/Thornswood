# The Discord layout

Made from `bot/Build-Discord.py` (ROLES and PLAN) by
`python3.12 bot/Build-Discord.py --layout`. Do not edit it by hand:
change the plan and run that, and `bot/tests/test-3317-layout.py` fails when
the two differ. `Setup-Discord.ps1 -OnBox -Audit` says where the live
server differs from this page. Issue #3317 is where it was set out.

## The staff council

Each staff category has a lead, and the leads are the council: they
decide together, and Owner and Co-Owner make the final call. A person
holds at most one rank in a category (Lead Dev and Dev is a double);
ranks of two categories are fine, and Owner or Co-Owner with a lead is
fine. The audit reports every double.

Nobody on staff holds a seat of the world: a Jarl or a faction leader.
A Jarl is a faction leader with its own application, which lists only
the holds with no Jarl. The audit reports anybody holding both.

Leads and Support hold Manage Roles and give only their own
category's roles (Support gives Playtester). Every staff role sits
above every other role.

| Category | Its space | Lead | Ranks under the lead |
|---|---|---|---|
| Dev | Dev | Lead Dev | Dev |
| Gamemasters | Gamemasters | Lead Gamemaster | Gamemaster, Trial Gamemaster |
| Lore | Lore | Lead Loremaster | Loremaster |
| Moderation | Moderation | Lead Moderator | Moderator |
| Content | Content | Lead Content Creator | Content Creator |
| Support | Support | Lead Support | Support |

Holders of Moderator also talk in the Gamemasters space.

## Roles, top of the list first

| Role | Colour | Shown on its own | Permissions | Made by | What it is |
|---|---|---|---|---|---|
| Owner | #C9A24B | yes | Administrator | the build | Final decision with Co-Owner. Administrator. |
| Co-Owner | #C9A24B | yes | Administrator | the build | Final decision with Owner. Administrator. |
| Lead Dev | #9B7BD4 | yes | council set | the build | Leads the developers; on the council. |
| Lead Gamemaster | #3E8FBF | yes | council set | the build | Leads the gamemasters; on the council. |
| Lead Loremaster | #57B8A0 | yes | council set | the build | Leads the loremasters; on the council. |
| Lead Moderator | #6FA05A | yes | council set | the build | Leads the moderators; on the council. |
| Lead Content Creator | #D2603F | yes | council set | the build | Leads Thornswood's own content; on the council. |
| Lead Support | #B8A04E | yes | council set | the build | Leads support; on the council. |
| Dev | #9B7BD4 | yes | nothing of its own | the build | Builds the game, the launcher, the site and the bot. Plays the dev build. |
| Gamemaster | #4F9BC7 | yes | gamemaster set | the build | Runs scenes and events in the world. |
| Loremaster | #57B8A0 | yes | nothing of its own | the build | Makes and watches the lore, helps with events, and checks that gamemasters keep to the lore. |
| Trial Gamemaster | #79BCDB | yes | gamemaster set | the build | A gamemaster on trial; where every accepted GM starts. |
| Moderator | #6FA05A | yes | moderator set | the build | Moderates the Discord only. No staff powers in the game. |
| Content Creator | #D2603F | yes | nothing of its own | the build | Thornswood's own social media and content, not community creators. |
| Support | #C9B46A | yes | support set | the build | Answers help tickets and playtest applications, and gives Playtester. |
| Jarl of Whiterun | #E0C56A | yes | nothing of its own | the build | The seat of Whiterun. Applied for on its own application. |
| Jarl of Solitude | #E0C56A | yes | nothing of its own | the build | The seat of Solitude. Applied for on its own application. |
| Jarl of Windhelm | #E0C56A | yes | nothing of its own | the build | The seat of Windhelm. Applied for on its own application. |
| Jarl of Riften | #E0C56A | yes | nothing of its own | the build | The seat of Riften. Applied for on its own application. |
| Jarl of Markarth | #E0C56A | yes | nothing of its own | the build | The seat of Markarth. Applied for on its own application. |
| Jarl of Dawnstar | #E0C56A | yes | nothing of its own | the build | The seat of Dawnstar. Applied for on its own application. |
| Jarl of Morthal | #E0C56A | yes | nothing of its own | the build | The seat of Morthal. Applied for on its own application. |
| Jarl of Falkreath | #E0C56A | yes | nothing of its own | the build | The seat of Falkreath. Applied for on its own application. |
| Jarl of Winterhold | #E0C56A | yes | nothing of its own | the build | The seat of Winterhold. Applied for on its own application. |
| Jarl of Raven Rock | #E0C56A | yes | nothing of its own | the build | The seat of Raven Rock. Applied for on its own application. |
| Imperial Embassy Leader | #D9B45A | yes | nothing of its own | the build | Leads Imperial Embassy. Applied for as Faction Leader. |
| Thalmor Leader | #D9B45A | yes | nothing of its own | the build | Leads Thalmor Remnant. Applied for as Faction Leader. |
| Free Skyrim Trading Company Leader | #D9B45A | yes | nothing of its own | the build | Leads Free Skyrim Trading Company. Applied for as Faction Leader. |
| Companions Leader | #D9B45A | yes | nothing of its own | the build | Leads The Companions. Applied for as Faction Leader. |
| College of Winterhold Leader | #D9B45A | yes | nothing of its own | the build | Leads College of Winterhold. Applied for as Faction Leader. |
| Bards College Leader | #D9B45A | yes | nothing of its own | the build | Leads Bards College. Applied for as Faction Leader. |
| Thieves Guild Leader | #D9B45A | yes | nothing of its own | the build | Leads Thieves Guild. Applied for as Faction Leader. |
| Dark Brotherhood Leader | #D9B45A | yes | nothing of its own | the build | Leads Dark Brotherhood. Applied for as Faction Leader. |
| Vigilants of Stendarr Leader | #D9B45A | yes | nothing of its own | the build | Leads Vigilants of Stendarr. Applied for as Faction Leader. |
| Dawnguard Leader | #D9B45A | yes | nothing of its own | the build | Leads Dawnguard. Applied for as Faction Leader. |
| Silver Hand Leader | #D9B45A | yes | nothing of its own | the build | Leads Silver Hand. Applied for as Faction Leader. |
| Forsworn Leader | #D9B45A | yes | nothing of its own | the build | Leads Forsworn. Applied for as Faction Leader. |
| Orc Strongholds Leader | #D9B45A | yes | nothing of its own | the build | Leads Orc Strongholds. Applied for as Faction Leader. |
| Khajiit Caravans Leader | #D9B45A | yes | nothing of its own | the build | Leads Khajiit Caravans. Applied for as Faction Leader. |
| Blades Leader | #D9B45A | yes | nothing of its own | the build | Leads Blades. Applied for as Faction Leader. |
| Volkihar Clan Leader | #D9B45A | yes | nothing of its own | the build | Leads Volkihar Clan. Applied for as Faction Leader. |
| Server Booster | #D98FB0 | yes | left to what makes it | Discord | Boosted the server. |
| Patreon | #F96854 | yes | left to what makes it | Patreon | Supports Thornswood on Patreon; Patreon gives and takes it. |
| Playtester | #C07A4E | yes | nothing of its own | the build | Plays the main build. Opens the Discord past Information. |
| Thalmor Boot-Licker | #9FBE6B | no | nothing of its own | the build | A Patreon tier; Patreon gives and takes it. |
| Talos Worshiper | #D8B24C | no | nothing of its own | the build | A Patreon tier; Patreon gives and takes it. |
| Milk Drinker | #BFD3DE | no | nothing of its own | the build | A Patreon tier; Patreon gives and takes it. |
| Citizen of Whiterun | #8FA9B8 | no | nothing of its own | the build |  |
| Citizen of Solitude | #8FA9B8 | no | nothing of its own | the build |  |
| Citizen of Windhelm | #8FA9B8 | no | nothing of its own | the build |  |
| Citizen of Riften | #8FA9B8 | no | nothing of its own | the build |  |
| Citizen of Markarth | #8FA9B8 | no | nothing of its own | the build |  |
| Citizen of Dawnstar | #8FA9B8 | no | nothing of its own | the build |  |
| Citizen of Morthal | #8FA9B8 | no | nothing of its own | the build |  |
| Citizen of Falkreath | #8FA9B8 | no | nothing of its own | the build |  |
| Citizen of Winterhold | #8FA9B8 | no | nothing of its own | the build |  |
| Citizen of Raven Rock | #8FA9B8 | no | nothing of its own | the build |  |
| Whiterun Court | #A8977A | no | nothing of its own | the build |  |
| Steward of Whiterun | #A8977A | no | nothing of its own | the build |  |
| Guard of Whiterun | #A8977A | no | nothing of its own | the build |  |
| Solitude Court | #A8977A | no | nothing of its own | the build |  |
| Steward of Solitude | #A8977A | no | nothing of its own | the build |  |
| Guard of Solitude | #A8977A | no | nothing of its own | the build |  |
| Windhelm Court | #A8977A | no | nothing of its own | the build |  |
| Steward of Windhelm | #A8977A | no | nothing of its own | the build |  |
| Guard of Windhelm | #A8977A | no | nothing of its own | the build |  |
| Riften Court | #A8977A | no | nothing of its own | the build |  |
| Steward of Riften | #A8977A | no | nothing of its own | the build |  |
| Guard of Riften | #A8977A | no | nothing of its own | the build |  |
| Markarth Court | #A8977A | no | nothing of its own | the build |  |
| Steward of Markarth | #A8977A | no | nothing of its own | the build |  |
| Guard of Markarth | #A8977A | no | nothing of its own | the build |  |
| Dawnstar Court | #A8977A | no | nothing of its own | the build |  |
| Steward of Dawnstar | #A8977A | no | nothing of its own | the build |  |
| Guard of Dawnstar | #A8977A | no | nothing of its own | the build |  |
| Morthal Court | #A8977A | no | nothing of its own | the build |  |
| Steward of Morthal | #A8977A | no | nothing of its own | the build |  |
| Guard of Morthal | #A8977A | no | nothing of its own | the build |  |
| Falkreath Court | #A8977A | no | nothing of its own | the build |  |
| Steward of Falkreath | #A8977A | no | nothing of its own | the build |  |
| Guard of Falkreath | #A8977A | no | nothing of its own | the build |  |
| Winterhold Court | #A8977A | no | nothing of its own | the build |  |
| Steward of Winterhold | #A8977A | no | nothing of its own | the build |  |
| Guard of Winterhold | #A8977A | no | nothing of its own | the build |  |
| Raven Rock Court | #A8977A | no | nothing of its own | the build |  |
| Steward of Raven Rock | #A8977A | no | nothing of its own | the build |  |
| Guard of Raven Rock | #A8977A | no | nothing of its own | the build |  |
| Imperial Embassy | #B08D57 | no | nothing of its own | the build | A member of Imperial Embassy. Its Leader gives and takes it. |
| Thalmor | #B08D57 | no | nothing of its own | the build | A member of Thalmor Remnant. Its Leader gives and takes it. |
| Free Skyrim Trading Company | #B08D57 | no | nothing of its own | the build | A member of Free Skyrim Trading Company. Its Leader gives and takes it. |
| Companions | #B08D57 | no | nothing of its own | the build | A member of The Companions. Its Leader gives and takes it. |
| College of Winterhold | #B08D57 | no | nothing of its own | the build | A member of College of Winterhold. Its Leader gives and takes it. |
| Bards College | #B08D57 | no | nothing of its own | the build | A member of Bards College. Its Leader gives and takes it. |
| Thieves Guild | #B08D57 | no | nothing of its own | the build | A member of Thieves Guild. Its Leader gives and takes it. |
| Dark Brotherhood | #B08D57 | no | nothing of its own | the build | A member of Dark Brotherhood. Its Leader gives and takes it. |
| Vigilants of Stendarr | #B08D57 | no | nothing of its own | the build | A member of Vigilants of Stendarr. Its Leader gives and takes it. |
| Dawnguard | #B08D57 | no | nothing of its own | the build | A member of Dawnguard. Its Leader gives and takes it. |
| Silver Hand | #B08D57 | no | nothing of its own | the build | A member of Silver Hand. Its Leader gives and takes it. |
| Forsworn | #B08D57 | no | nothing of its own | the build | A member of Forsworn. Its Leader gives and takes it. |
| Orc Strongholds | #B08D57 | no | nothing of its own | the build | A member of Orc Strongholds. Its Leader gives and takes it. |
| Khajiit Caravans | #B08D57 | no | nothing of its own | the build | A member of Khajiit Caravans. Its Leader gives and takes it. |
| Blades | #B08D57 | no | nothing of its own | the build | A member of Blades. Its Leader gives and takes it. |
| Volkihar Clan | #B08D57 | no | nothing of its own | the build | A member of Volkihar Clan. Its Leader gives and takes it. |
| Imperial Embassy Officer | #A08560 | no | nothing of its own | the build | An Officer of Imperial Embassy: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Thalmor Officer | #A08560 | no | nothing of its own | the build | An Officer of Thalmor Remnant: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Free Skyrim Trading Company Officer | #A08560 | no | nothing of its own | the build | An Officer of Free Skyrim Trading Company: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Companions Officer | #A08560 | no | nothing of its own | the build | An Officer of The Companions: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| College of Winterhold Officer | #A08560 | no | nothing of its own | the build | An Officer of College of Winterhold: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Bards College Officer | #A08560 | no | nothing of its own | the build | An Officer of Bards College: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Thieves Guild Officer | #A08560 | no | nothing of its own | the build | An Officer of Thieves Guild: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Dark Brotherhood Officer | #A08560 | no | nothing of its own | the build | An Officer of Dark Brotherhood: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Vigilants of Stendarr Officer | #A08560 | no | nothing of its own | the build | An Officer of Vigilants of Stendarr: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Dawnguard Officer | #A08560 | no | nothing of its own | the build | An Officer of Dawnguard: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Silver Hand Officer | #A08560 | no | nothing of its own | the build | An Officer of Silver Hand: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Forsworn Officer | #A08560 | no | nothing of its own | the build | An Officer of Forsworn: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Orc Strongholds Officer | #A08560 | no | nothing of its own | the build | An Officer of Orc Strongholds: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Khajiit Caravans Officer | #A08560 | no | nothing of its own | the build | An Officer of Khajiit Caravans: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Blades Officer | #A08560 | no | nothing of its own | the build | An Officer of Blades: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Volkihar Clan Officer | #A08560 | no | nothing of its own | the build | An Officer of Volkihar Clan: posts its announcements and sits in its leadership. Its Leader gives and takes it, to a member. |
| Business Owner | #A08C6A | no | nothing of its own | the build | Owns a business book in the game. Support gives it. |
| Member | #8D9682 | no | nothing of its own | the build | Joined and answered the rules and age questions. Sees Start Here, Applications and Information. |
| Banned | #4A4A4A | no | nothing of its own | the build | Takes the site and the game away (site/server.js, access.banned). |
| News Pings | #8D9682 | no | left to what makes it | bot.py |  |
| Updates Pings | #8D9682 | no | left to what makes it | bot.py |  |

@everyone keeps what the server gives it; the build does not change it,
and the audit prints it. Every other role opens exactly the channels
below that name it.

The bot's own role keeps Administrator, for a build and the rest of the
time (Patrick, 22 Oct 2026: "the bot will keep admin"). The audit counts
it holding Administrator as planned, and its going without as a
difference. What the running bot itself uses is RUN_BITS in the builder.

### The permission sets

- **Administrator**: administrator
- **council set**: attach_files, ban_members, connect, create_events, deafen_members, embed_links, kick_members, manage_events, manage_messages, manage_nicknames, manage_roles, manage_threads, mention_everyone, moderate_members, move_members, mute_members, read_message_history, send_messages, speak, view_audit_log, view_channel
- **moderator set**: attach_files, ban_members, connect, deafen_members, embed_links, kick_members, manage_messages, manage_threads, moderate_members, move_members, mute_members, read_message_history, send_messages, speak, view_channel
- **gamemaster set**: attach_files, connect, embed_links, manage_messages, manage_threads, moderate_members, move_members, mute_members, read_message_history, send_messages, speak, view_channel
- **support set**: manage_roles, manage_threads

## Who a mode lets in

Every category and channel has a mode. Reads means sees and reads back;
talks means posts as well; posts in a read only place means writes and
tidies there. A staff space mode is said for the space it names.

| Mode | Sees | Talks | Posts |
|---|---|---|---|
| public | everybody | everybody | everybody |
| read | everybody | the council | the council |
| membersread | everybody on staff, Member, Playtester | the council | the council |
| open | everybody on staff, Playtester | everybody on staff, Playtester | - |
| pathfind | everybody on staff, Playtester | everybody on staff, Playtester | - |
| testersread | everybody on staff, Playtester | the council | the council |
| staff | everybody on staff | everybody on staff | - |
| staffread | everybody on staff | the council | the council |
| council | the council | the council | - |
| hold (Whiterun) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Whiterun Court, Steward of Whiterun, Guard of Whiterun, Citizen of Whiterun | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Whiterun Court, Steward of Whiterun, Guard of Whiterun, Citizen of Whiterun | - |
| faction (The Companions) | the council, Gamemaster, Trial Gamemaster, Loremaster, Companions, Companions Leader, Companions Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Companions, Companions Leader, Companions Officer | - |
| factionread (The Companions) | the council, Companions, Gamemaster, Trial Gamemaster, Loremaster, Companions Leader, Companions Officer | the council, Companions Leader, Companions Officer | the council, Companions Leader, Companions Officer |
| factionlead (The Companions) | the council, Gamemaster, Trial Gamemaster, Loremaster, Companions Leader, Companions Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Companions Leader, Companions Officer | - |
| factionseats (The Companions) | the council, Companions Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | the council |
| space (Lore) | the council, Loremaster | the council, Loremaster | - |
| spaceread (Lore) | the council, Loremaster | the council | the council |
| spacerules (Lore) | the council, Loremaster | Owner and Co-Owner, Lead Loremaster | Owner and Co-Owner, Lead Loremaster |

## Categories and channels, in order

### Start Here

Category mode: public.

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #rules | text | read | everybody | the council | posts: the council; written by the build from content.py RULES, with its Changelog thread; topic: Seven rules. Read them. |
| #welcome | text | read | everybody | the council | posts: the council; written by the build from content.py WELCOME, with its Changelog thread; topic: Start here. |
| #start-here | text | read | everybody | the council | posts: the council; written by the build from content.py START, with its Changelog thread; topic: How to actually get in and play. |
| #say-hello | text | public | everybody | everybody | posts: everybody; topic: New here? Say hi and tell us a little about yourself. Slowmode is on. |

### Tickets

Category mode: public.

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #get-help | text | read | everybody | the council | posts: the council; topic: It will not install, start or connect. Open a ticket below. |
| #report-someone | text | read | everybody | the council | posts: the council; topic: Something happened and it should not have. Only you and staff see it. |

### Information

Category mode: membersread.

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #news | announce | membersread | everybody on staff, Member, Playtester | the council | posts: the council; written by the build from content.py NEWS, with its Changelog thread; topic: What changed, every time it changes. |
| #updates | text | membersread | everybody on staff, Member, Playtester | the council | posts: the council; topic: Restarts and outages. Check here before asking why you can't connect. |
| #faq | text | membersread | everybody on staff, Member, Playtester | the council | posts: the council; written by the build from content.py FAQ, with its Changelog thread; topic: Read this before you ask. |

### Roleplay Guide

Category mode: testersread.

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #game-rules | text | testersread | everybody on staff, Playtester | the council | posts: the council; written by the build from content.py GAMERULES, with its Changelog thread; was #game-rules in Thornswood; was #game-rules in In Character; topic: How roleplay works here. Nine rules, and what we let slide. |
| #lore | text | testersread | everybody on staff, Playtester | the council | posts: the council; written by the build from content.py LORE, with its Changelog thread; was #lore in In Character; topic: 4E 252. What happened and who you can be. |
| #factions | text | testersread | everybody on staff, Playtester | the council | posts: the council; written by the build from content.py FACTIONS, with its Changelog thread; topic: The sixteen factions of 4E 252: who they are, where they keep, who leads them. |

### Applications

Category mode: public.

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #apply-to-playtest | text | read | everybody | the council | posts: the council; topic: How you get into the world. Pick the application below. |
| #apply-for-a-seat | text | read | everybody | the council | posts: the council; topic: Jarl and Faction Leader, answered in character. Only open seats are listed. |
| #apply-for-staff | text | read | everybody | the council | posts: the council; topic: Gamemaster, Loremaster, Moderator, Dev and Content Creator. |

### Out of Character

Category mode: open. It was Thornswood.

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #welcome-travelers | text | open | everybody on staff, Playtester | everybody on staff, Playtester | was #welcome-travelers in Thornswood; topic: A card for everybody who joins, posted by the bot. Say hello in #general-chat. |
| #general-chat | text | open | everybody on staff, Playtester | everybody on staff, Playtester | was #general-chat in Thornswood; topic: Out of character chat for everyone. Talk Thornswood, Skyrim, or whatever's on your mind, and keep it friendly. Bug reports go in #test-findings, screenshots and clips go in #media. |
| #media | text | open | everybody on staff, Playtester | everybody on staff, Playtester | was #media in Thornswood; topic: Screenshots and clips. Talk about one in a thread under it. |
| #server-progression-and-economy | text | open | everybody on staff, Playtester | everybody on staff, Playtester | was #server-progression-and-economy in Thornswood; topic: How the server grows and how its economy works: what you have seen, and what you would change. Ideas go in #suggestions. |
| #suggestions | forum | open | everybody on staff, Playtester | everybody on staff, Playtester | was #suggestions in Help; topic: Mods and features you want. Nexus link if it's a mod, because whether it works here depends on how it's built. |
| #jukebox | text | open | everybody on staff, Playtester | everybody on staff, Playtester | never made by the build; was #jukebox in Voice; topic: Music bot commands go here. Jockie Music plays in the voice room you are in. |
| General | voice | open | everybody on staff, Playtester | everybody on staff, Playtester | was General in Voice |
| AFK | voice | open | everybody on staff, Playtester | everybody on staff, Playtester | was AFK in Voice |
| #bugs | forum | open | everybody on staff, Playtester | everybody on staff, Playtester | never made by the build; topic: One post per problem. Logs and screenshots welcome. |
| #logs-and-crashes | text | open | everybody on staff, Playtester | everybody on staff, Playtester | never made by the build; topic: Drag the log in. Explain it after. |

### In Character

Category mode: open.

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #choose-your-hold | text | testersread | everybody on staff, Playtester | the council | posts: the council; was #choose-your-hold in The Holds; topic: Pick your hold with the buttons below. It opens that hold's channels. |
| #character-introductions | forum | open | everybody on staff, Playtester | everybody on staff, Playtester | topic: Who are you playing? One post each. |
| #tales | forum | open | everybody on staff, Playtester | everybody on staff, Playtester | topic: What happened out there. One post per story. |
| #rp-appreciation | text | open | everybody on staff, Playtester | everybody on staff, Playtester | topic: Somebody played a blinder. Say so. |
| #graveyard | text | open | everybody on staff, Playtester | everybody on staff, Playtester | topic: They had it coming. Probably. |

### Imperial Embassy

Category mode: faction (Imperial Embassy).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #imperial-embassy-announcements | text | factionread (Imperial Embassy) | the council, Imperial Embassy, Gamemaster, Trial Gamemaster, Loremaster, Imperial Embassy Leader, Imperial Embassy Officer | the council, Imperial Embassy Leader, Imperial Embassy Officer | posts: the council, Imperial Embassy Leader, Imperial Embassy Officer; topic: What the Leader and the Officers of Imperial Embassy want every member to know. In character. |
| #imperial-embassy | text | faction (Imperial Embassy) | the council, Gamemaster, Trial Gamemaster, Loremaster, Imperial Embassy, Imperial Embassy Leader, Imperial Embassy Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Imperial Embassy, Imperial Embassy Leader, Imperial Embassy Officer | was #imperial-embassy in Factions; topic: Imperial Embassy: its members and its Leader. In character. |
| #imperial-embassy-leadership | text | factionlead (Imperial Embassy) | the council, Gamemaster, Trial Gamemaster, Loremaster, Imperial Embassy Leader, Imperial Embassy Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Imperial Embassy Leader, Imperial Embassy Officer | topic: The Leader and the Officers of Imperial Embassy. In character. |
| #imperial-embassy-seats | text | factionseats (Imperial Embassy) | the council, Imperial Embassy Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Imperial Embassy gives and takes its members and Officers here. |
| Imperial Embassy | voice | faction (Imperial Embassy) | the council, Gamemaster, Trial Gamemaster, Loremaster, Imperial Embassy, Imperial Embassy Leader, Imperial Embassy Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Imperial Embassy, Imperial Embassy Leader, Imperial Embassy Officer | was Imperial Embassy in Factions |

### Thalmor Remnant

Category mode: faction (Thalmor Remnant).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #thalmor-announcements | text | factionread (Thalmor Remnant) | the council, Thalmor, Gamemaster, Trial Gamemaster, Loremaster, Thalmor Leader, Thalmor Officer | the council, Thalmor Leader, Thalmor Officer | posts: the council, Thalmor Leader, Thalmor Officer; topic: What the Leader and the Officers of Thalmor Remnant want every member to know. In character. |
| #thalmor | text | faction (Thalmor Remnant) | the council, Gamemaster, Trial Gamemaster, Loremaster, Thalmor, Thalmor Leader, Thalmor Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Thalmor, Thalmor Leader, Thalmor Officer | was #thalmor in Factions; topic: Thalmor Remnant: its members and its Leader. In character. |
| #thalmor-leadership | text | factionlead (Thalmor Remnant) | the council, Gamemaster, Trial Gamemaster, Loremaster, Thalmor Leader, Thalmor Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Thalmor Leader, Thalmor Officer | topic: The Leader and the Officers of Thalmor Remnant. In character. |
| #thalmor-seats | text | factionseats (Thalmor Remnant) | the council, Thalmor Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Thalmor Remnant gives and takes its members and Officers here. |
| Thalmor Remnant | voice | faction (Thalmor Remnant) | the council, Gamemaster, Trial Gamemaster, Loremaster, Thalmor, Thalmor Leader, Thalmor Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Thalmor, Thalmor Leader, Thalmor Officer | was Thalmor Remnant in Factions |

### Free Skyrim Trading Company

Category mode: faction (Free Skyrim Trading Company).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #free-skyrim-trading-company-announcements | text | factionread (Free Skyrim Trading Company) | the council, Free Skyrim Trading Company, Gamemaster, Trial Gamemaster, Loremaster, Free Skyrim Trading Company Leader, Free Skyrim Trading Company Officer | the council, Free Skyrim Trading Company Leader, Free Skyrim Trading Company Officer | posts: the council, Free Skyrim Trading Company Leader, Free Skyrim Trading Company Officer; topic: What the Leader and the Officers of Free Skyrim Trading Company want every member to know. In character. |
| #free-skyrim-trading-company | text | faction (Free Skyrim Trading Company) | the council, Gamemaster, Trial Gamemaster, Loremaster, Free Skyrim Trading Company, Free Skyrim Trading Company Leader, Free Skyrim Trading Company Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Free Skyrim Trading Company, Free Skyrim Trading Company Leader, Free Skyrim Trading Company Officer | was #free-skyrim-trading-company in Factions; topic: Free Skyrim Trading Company: its members and its Leader. In character. |
| #free-skyrim-trading-company-leadership | text | factionlead (Free Skyrim Trading Company) | the council, Gamemaster, Trial Gamemaster, Loremaster, Free Skyrim Trading Company Leader, Free Skyrim Trading Company Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Free Skyrim Trading Company Leader, Free Skyrim Trading Company Officer | topic: The Leader and the Officers of Free Skyrim Trading Company. In character. |
| #free-skyrim-trading-company-seats | text | factionseats (Free Skyrim Trading Company) | the council, Free Skyrim Trading Company Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Free Skyrim Trading Company gives and takes its members and Officers here. |
| Free Skyrim Trading Company | voice | faction (Free Skyrim Trading Company) | the council, Gamemaster, Trial Gamemaster, Loremaster, Free Skyrim Trading Company, Free Skyrim Trading Company Leader, Free Skyrim Trading Company Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Free Skyrim Trading Company, Free Skyrim Trading Company Leader, Free Skyrim Trading Company Officer | was Free Skyrim Trading Company in Factions |

### The Companions

Category mode: faction (The Companions).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #companions-announcements | text | factionread (The Companions) | the council, Companions, Gamemaster, Trial Gamemaster, Loremaster, Companions Leader, Companions Officer | the council, Companions Leader, Companions Officer | posts: the council, Companions Leader, Companions Officer; topic: What the Leader and the Officers of The Companions want every member to know. In character. |
| #companions | text | faction (The Companions) | the council, Gamemaster, Trial Gamemaster, Loremaster, Companions, Companions Leader, Companions Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Companions, Companions Leader, Companions Officer | was #companions in Factions; topic: The Companions: its members and its Leader. In character. |
| #companions-leadership | text | factionlead (The Companions) | the council, Gamemaster, Trial Gamemaster, Loremaster, Companions Leader, Companions Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Companions Leader, Companions Officer | topic: The Leader and the Officers of The Companions. In character. |
| #companions-seats | text | factionseats (The Companions) | the council, Companions Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of The Companions gives and takes its members and Officers here. |
| The Companions | voice | faction (The Companions) | the council, Gamemaster, Trial Gamemaster, Loremaster, Companions, Companions Leader, Companions Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Companions, Companions Leader, Companions Officer | was The Companions in Factions |

### College of Winterhold

Category mode: faction (College of Winterhold).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #college-of-winterhold-announcements | text | factionread (College of Winterhold) | the council, College of Winterhold, Gamemaster, Trial Gamemaster, Loremaster, College of Winterhold Leader, College of Winterhold Officer | the council, College of Winterhold Leader, College of Winterhold Officer | posts: the council, College of Winterhold Leader, College of Winterhold Officer; topic: What the Leader and the Officers of College of Winterhold want every member to know. In character. |
| #college-of-winterhold | text | faction (College of Winterhold) | the council, Gamemaster, Trial Gamemaster, Loremaster, College of Winterhold, College of Winterhold Leader, College of Winterhold Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, College of Winterhold, College of Winterhold Leader, College of Winterhold Officer | was #college-of-winterhold in Factions; topic: College of Winterhold: its members and its Leader. In character. |
| #college-of-winterhold-leadership | text | factionlead (College of Winterhold) | the council, Gamemaster, Trial Gamemaster, Loremaster, College of Winterhold Leader, College of Winterhold Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, College of Winterhold Leader, College of Winterhold Officer | topic: The Leader and the Officers of College of Winterhold. In character. |
| #college-of-winterhold-seats | text | factionseats (College of Winterhold) | the council, College of Winterhold Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of College of Winterhold gives and takes its members and Officers here. |
| College of Winterhold | voice | faction (College of Winterhold) | the council, Gamemaster, Trial Gamemaster, Loremaster, College of Winterhold, College of Winterhold Leader, College of Winterhold Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, College of Winterhold, College of Winterhold Leader, College of Winterhold Officer | was College of Winterhold in Factions |

### Bards College

Category mode: faction (Bards College).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #bards-college-announcements | text | factionread (Bards College) | the council, Bards College, Gamemaster, Trial Gamemaster, Loremaster, Bards College Leader, Bards College Officer | the council, Bards College Leader, Bards College Officer | posts: the council, Bards College Leader, Bards College Officer; topic: What the Leader and the Officers of Bards College want every member to know. In character. |
| #bards-college | text | faction (Bards College) | the council, Gamemaster, Trial Gamemaster, Loremaster, Bards College, Bards College Leader, Bards College Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Bards College, Bards College Leader, Bards College Officer | was #bards-college in Factions; topic: Bards College: its members and its Leader. In character. |
| #bards-college-leadership | text | factionlead (Bards College) | the council, Gamemaster, Trial Gamemaster, Loremaster, Bards College Leader, Bards College Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Bards College Leader, Bards College Officer | topic: The Leader and the Officers of Bards College. In character. |
| #bards-college-seats | text | factionseats (Bards College) | the council, Bards College Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Bards College gives and takes its members and Officers here. |
| Bards College | voice | faction (Bards College) | the council, Gamemaster, Trial Gamemaster, Loremaster, Bards College, Bards College Leader, Bards College Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Bards College, Bards College Leader, Bards College Officer | was Bards College in Factions |

### Thieves Guild

Category mode: faction (Thieves Guild).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #thieves-guild-announcements | text | factionread (Thieves Guild) | the council, Thieves Guild, Gamemaster, Trial Gamemaster, Loremaster, Thieves Guild Leader, Thieves Guild Officer | the council, Thieves Guild Leader, Thieves Guild Officer | posts: the council, Thieves Guild Leader, Thieves Guild Officer; topic: What the Leader and the Officers of Thieves Guild want every member to know. In character. |
| #thieves-guild | text | faction (Thieves Guild) | the council, Gamemaster, Trial Gamemaster, Loremaster, Thieves Guild, Thieves Guild Leader, Thieves Guild Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Thieves Guild, Thieves Guild Leader, Thieves Guild Officer | was #thieves-guild in Factions; topic: Thieves Guild: its members and its Leader. In character. |
| #thieves-guild-leadership | text | factionlead (Thieves Guild) | the council, Gamemaster, Trial Gamemaster, Loremaster, Thieves Guild Leader, Thieves Guild Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Thieves Guild Leader, Thieves Guild Officer | topic: The Leader and the Officers of Thieves Guild. In character. |
| #thieves-guild-seats | text | factionseats (Thieves Guild) | the council, Thieves Guild Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Thieves Guild gives and takes its members and Officers here. |
| Thieves Guild | voice | faction (Thieves Guild) | the council, Gamemaster, Trial Gamemaster, Loremaster, Thieves Guild, Thieves Guild Leader, Thieves Guild Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Thieves Guild, Thieves Guild Leader, Thieves Guild Officer | was Thieves Guild in Factions |

### Dark Brotherhood

Category mode: faction (Dark Brotherhood).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #dark-brotherhood-announcements | text | factionread (Dark Brotherhood) | the council, Dark Brotherhood, Gamemaster, Trial Gamemaster, Loremaster, Dark Brotherhood Leader, Dark Brotherhood Officer | the council, Dark Brotherhood Leader, Dark Brotherhood Officer | posts: the council, Dark Brotherhood Leader, Dark Brotherhood Officer; topic: What the Leader and the Officers of Dark Brotherhood want every member to know. In character. |
| #dark-brotherhood | text | faction (Dark Brotherhood) | the council, Gamemaster, Trial Gamemaster, Loremaster, Dark Brotherhood, Dark Brotherhood Leader, Dark Brotherhood Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Dark Brotherhood, Dark Brotherhood Leader, Dark Brotherhood Officer | was #dark-brotherhood in Factions; topic: Dark Brotherhood: its members and its Leader. In character. |
| #dark-brotherhood-leadership | text | factionlead (Dark Brotherhood) | the council, Gamemaster, Trial Gamemaster, Loremaster, Dark Brotherhood Leader, Dark Brotherhood Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Dark Brotherhood Leader, Dark Brotherhood Officer | topic: The Leader and the Officers of Dark Brotherhood. In character. |
| #dark-brotherhood-seats | text | factionseats (Dark Brotherhood) | the council, Dark Brotherhood Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Dark Brotherhood gives and takes its members and Officers here. |
| Dark Brotherhood | voice | faction (Dark Brotherhood) | the council, Gamemaster, Trial Gamemaster, Loremaster, Dark Brotherhood, Dark Brotherhood Leader, Dark Brotherhood Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Dark Brotherhood, Dark Brotherhood Leader, Dark Brotherhood Officer | was Dark Brotherhood in Factions |

### Vigilants of Stendarr

Category mode: faction (Vigilants of Stendarr).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #vigilants-of-stendarr-announcements | text | factionread (Vigilants of Stendarr) | the council, Vigilants of Stendarr, Gamemaster, Trial Gamemaster, Loremaster, Vigilants of Stendarr Leader, Vigilants of Stendarr Officer | the council, Vigilants of Stendarr Leader, Vigilants of Stendarr Officer | posts: the council, Vigilants of Stendarr Leader, Vigilants of Stendarr Officer; topic: What the Leader and the Officers of Vigilants of Stendarr want every member to know. In character. |
| #vigilants-of-stendarr | text | faction (Vigilants of Stendarr) | the council, Gamemaster, Trial Gamemaster, Loremaster, Vigilants of Stendarr, Vigilants of Stendarr Leader, Vigilants of Stendarr Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Vigilants of Stendarr, Vigilants of Stendarr Leader, Vigilants of Stendarr Officer | was #vigilants-of-stendarr in Factions; topic: Vigilants of Stendarr: its members and its Leader. In character. |
| #vigilants-of-stendarr-leadership | text | factionlead (Vigilants of Stendarr) | the council, Gamemaster, Trial Gamemaster, Loremaster, Vigilants of Stendarr Leader, Vigilants of Stendarr Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Vigilants of Stendarr Leader, Vigilants of Stendarr Officer | topic: The Leader and the Officers of Vigilants of Stendarr. In character. |
| #vigilants-of-stendarr-seats | text | factionseats (Vigilants of Stendarr) | the council, Vigilants of Stendarr Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Vigilants of Stendarr gives and takes its members and Officers here. |
| Vigilants of Stendarr | voice | faction (Vigilants of Stendarr) | the council, Gamemaster, Trial Gamemaster, Loremaster, Vigilants of Stendarr, Vigilants of Stendarr Leader, Vigilants of Stendarr Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Vigilants of Stendarr, Vigilants of Stendarr Leader, Vigilants of Stendarr Officer | was Vigilants of Stendarr in Factions |

### Dawnguard

Category mode: faction (Dawnguard).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #dawnguard-announcements | text | factionread (Dawnguard) | the council, Dawnguard, Gamemaster, Trial Gamemaster, Loremaster, Dawnguard Leader, Dawnguard Officer | the council, Dawnguard Leader, Dawnguard Officer | posts: the council, Dawnguard Leader, Dawnguard Officer; topic: What the Leader and the Officers of Dawnguard want every member to know. In character. |
| #dawnguard | text | faction (Dawnguard) | the council, Gamemaster, Trial Gamemaster, Loremaster, Dawnguard, Dawnguard Leader, Dawnguard Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Dawnguard, Dawnguard Leader, Dawnguard Officer | was #dawnguard in Factions; topic: Dawnguard: its members and its Leader. In character. |
| #dawnguard-leadership | text | factionlead (Dawnguard) | the council, Gamemaster, Trial Gamemaster, Loremaster, Dawnguard Leader, Dawnguard Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Dawnguard Leader, Dawnguard Officer | topic: The Leader and the Officers of Dawnguard. In character. |
| #dawnguard-seats | text | factionseats (Dawnguard) | the council, Dawnguard Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Dawnguard gives and takes its members and Officers here. |
| Dawnguard | voice | faction (Dawnguard) | the council, Gamemaster, Trial Gamemaster, Loremaster, Dawnguard, Dawnguard Leader, Dawnguard Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Dawnguard, Dawnguard Leader, Dawnguard Officer | was Dawnguard in Factions |

### Silver Hand

Category mode: faction (Silver Hand).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #silver-hand-announcements | text | factionread (Silver Hand) | the council, Silver Hand, Gamemaster, Trial Gamemaster, Loremaster, Silver Hand Leader, Silver Hand Officer | the council, Silver Hand Leader, Silver Hand Officer | posts: the council, Silver Hand Leader, Silver Hand Officer; topic: What the Leader and the Officers of Silver Hand want every member to know. In character. |
| #silver-hand | text | faction (Silver Hand) | the council, Gamemaster, Trial Gamemaster, Loremaster, Silver Hand, Silver Hand Leader, Silver Hand Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Silver Hand, Silver Hand Leader, Silver Hand Officer | was #silver-hand in Factions; topic: Silver Hand: its members and its Leader. In character. |
| #silver-hand-leadership | text | factionlead (Silver Hand) | the council, Gamemaster, Trial Gamemaster, Loremaster, Silver Hand Leader, Silver Hand Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Silver Hand Leader, Silver Hand Officer | topic: The Leader and the Officers of Silver Hand. In character. |
| #silver-hand-seats | text | factionseats (Silver Hand) | the council, Silver Hand Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Silver Hand gives and takes its members and Officers here. |
| Silver Hand | voice | faction (Silver Hand) | the council, Gamemaster, Trial Gamemaster, Loremaster, Silver Hand, Silver Hand Leader, Silver Hand Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Silver Hand, Silver Hand Leader, Silver Hand Officer | was Silver Hand in Factions |

### Forsworn

Category mode: faction (Forsworn).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #forsworn-announcements | text | factionread (Forsworn) | the council, Forsworn, Gamemaster, Trial Gamemaster, Loremaster, Forsworn Leader, Forsworn Officer | the council, Forsworn Leader, Forsworn Officer | posts: the council, Forsworn Leader, Forsworn Officer; topic: What the Leader and the Officers of Forsworn want every member to know. In character. |
| #forsworn | text | faction (Forsworn) | the council, Gamemaster, Trial Gamemaster, Loremaster, Forsworn, Forsworn Leader, Forsworn Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Forsworn, Forsworn Leader, Forsworn Officer | was #forsworn in Factions; topic: Forsworn: its members and its Leader. In character. |
| #forsworn-leadership | text | factionlead (Forsworn) | the council, Gamemaster, Trial Gamemaster, Loremaster, Forsworn Leader, Forsworn Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Forsworn Leader, Forsworn Officer | topic: The Leader and the Officers of Forsworn. In character. |
| #forsworn-seats | text | factionseats (Forsworn) | the council, Forsworn Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Forsworn gives and takes its members and Officers here. |
| Forsworn | voice | faction (Forsworn) | the council, Gamemaster, Trial Gamemaster, Loremaster, Forsworn, Forsworn Leader, Forsworn Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Forsworn, Forsworn Leader, Forsworn Officer | was Forsworn in Factions |

### Orc Strongholds

Category mode: faction (Orc Strongholds).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #orc-strongholds-announcements | text | factionread (Orc Strongholds) | the council, Orc Strongholds, Gamemaster, Trial Gamemaster, Loremaster, Orc Strongholds Leader, Orc Strongholds Officer | the council, Orc Strongholds Leader, Orc Strongholds Officer | posts: the council, Orc Strongholds Leader, Orc Strongholds Officer; topic: What the Leader and the Officers of Orc Strongholds want every member to know. In character. |
| #orc-strongholds | text | faction (Orc Strongholds) | the council, Gamemaster, Trial Gamemaster, Loremaster, Orc Strongholds, Orc Strongholds Leader, Orc Strongholds Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Orc Strongholds, Orc Strongholds Leader, Orc Strongholds Officer | was #orc-strongholds in Factions; topic: Orc Strongholds: its members and its Leader. In character. |
| #orc-strongholds-leadership | text | factionlead (Orc Strongholds) | the council, Gamemaster, Trial Gamemaster, Loremaster, Orc Strongholds Leader, Orc Strongholds Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Orc Strongholds Leader, Orc Strongholds Officer | topic: The Leader and the Officers of Orc Strongholds. In character. |
| #orc-strongholds-seats | text | factionseats (Orc Strongholds) | the council, Orc Strongholds Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Orc Strongholds gives and takes its members and Officers here. |
| Orc Strongholds | voice | faction (Orc Strongholds) | the council, Gamemaster, Trial Gamemaster, Loremaster, Orc Strongholds, Orc Strongholds Leader, Orc Strongholds Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Orc Strongholds, Orc Strongholds Leader, Orc Strongholds Officer | was Orc Strongholds in Factions |

### Khajiit Caravans

Category mode: faction (Khajiit Caravans).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #khajiit-caravans-announcements | text | factionread (Khajiit Caravans) | the council, Khajiit Caravans, Gamemaster, Trial Gamemaster, Loremaster, Khajiit Caravans Leader, Khajiit Caravans Officer | the council, Khajiit Caravans Leader, Khajiit Caravans Officer | posts: the council, Khajiit Caravans Leader, Khajiit Caravans Officer; topic: What the Leader and the Officers of Khajiit Caravans want every member to know. In character. |
| #khajiit-caravans | text | faction (Khajiit Caravans) | the council, Gamemaster, Trial Gamemaster, Loremaster, Khajiit Caravans, Khajiit Caravans Leader, Khajiit Caravans Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Khajiit Caravans, Khajiit Caravans Leader, Khajiit Caravans Officer | was #khajiit-caravans in Factions; topic: Khajiit Caravans: its members and its Leader. In character. |
| #khajiit-caravans-leadership | text | factionlead (Khajiit Caravans) | the council, Gamemaster, Trial Gamemaster, Loremaster, Khajiit Caravans Leader, Khajiit Caravans Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Khajiit Caravans Leader, Khajiit Caravans Officer | topic: The Leader and the Officers of Khajiit Caravans. In character. |
| #khajiit-caravans-seats | text | factionseats (Khajiit Caravans) | the council, Khajiit Caravans Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Khajiit Caravans gives and takes its members and Officers here. |
| Khajiit Caravans | voice | faction (Khajiit Caravans) | the council, Gamemaster, Trial Gamemaster, Loremaster, Khajiit Caravans, Khajiit Caravans Leader, Khajiit Caravans Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Khajiit Caravans, Khajiit Caravans Leader, Khajiit Caravans Officer | was Khajiit Caravans in Factions |

### Blades

Category mode: faction (Blades).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #blades-announcements | text | factionread (Blades) | the council, Blades, Gamemaster, Trial Gamemaster, Loremaster, Blades Leader, Blades Officer | the council, Blades Leader, Blades Officer | posts: the council, Blades Leader, Blades Officer; topic: What the Leader and the Officers of Blades want every member to know. In character. |
| #blades | text | faction (Blades) | the council, Gamemaster, Trial Gamemaster, Loremaster, Blades, Blades Leader, Blades Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Blades, Blades Leader, Blades Officer | was #blades in Factions; topic: Blades: its members and its Leader. In character. |
| #blades-leadership | text | factionlead (Blades) | the council, Gamemaster, Trial Gamemaster, Loremaster, Blades Leader, Blades Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Blades Leader, Blades Officer | topic: The Leader and the Officers of Blades. In character. |
| #blades-seats | text | factionseats (Blades) | the council, Blades Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Blades gives and takes its members and Officers here. |
| Blades | voice | faction (Blades) | the council, Gamemaster, Trial Gamemaster, Loremaster, Blades, Blades Leader, Blades Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Blades, Blades Leader, Blades Officer | was Blades in Factions |

### Volkihar Clan

Category mode: faction (Volkihar Clan).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #volkihar-clan-announcements | text | factionread (Volkihar Clan) | the council, Volkihar Clan, Gamemaster, Trial Gamemaster, Loremaster, Volkihar Clan Leader, Volkihar Clan Officer | the council, Volkihar Clan Leader, Volkihar Clan Officer | posts: the council, Volkihar Clan Leader, Volkihar Clan Officer; topic: What the Leader and the Officers of Volkihar Clan want every member to know. In character. |
| #volkihar-clan | text | faction (Volkihar Clan) | the council, Gamemaster, Trial Gamemaster, Loremaster, Volkihar Clan, Volkihar Clan Leader, Volkihar Clan Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Volkihar Clan, Volkihar Clan Leader, Volkihar Clan Officer | was #volkihar-clan in Factions; topic: Volkihar Clan: its members and its Leader. In character. |
| #volkihar-clan-leadership | text | factionlead (Volkihar Clan) | the council, Gamemaster, Trial Gamemaster, Loremaster, Volkihar Clan Leader, Volkihar Clan Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Volkihar Clan Leader, Volkihar Clan Officer | topic: The Leader and the Officers of Volkihar Clan. In character. |
| #volkihar-clan-seats | text | factionseats (Volkihar Clan) | the council, Volkihar Clan Leader, Gamemaster, Trial Gamemaster, Loremaster | the council | posts: the council; topic: The Leader of Volkihar Clan gives and takes its members and Officers here. |
| Volkihar Clan | voice | faction (Volkihar Clan) | the council, Gamemaster, Trial Gamemaster, Loremaster, Volkihar Clan, Volkihar Clan Leader, Volkihar Clan Officer | the council, Gamemaster, Trial Gamemaster, Loremaster, Volkihar Clan, Volkihar Clan Leader, Volkihar Clan Officer | was Volkihar Clan in Factions |

### Whiterun

Category mode: hold (Whiterun).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #whiterun-announcements | text | holdread (Whiterun) | the council, Citizen of Whiterun, Guard of Whiterun, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Steward of Whiterun, Whiterun Court | the council, Jarl of Whiterun, Steward of Whiterun, Whiterun Court | posts: the council, Jarl of Whiterun, Steward of Whiterun, Whiterun Court; topic: What the Jarl and the court of Whiterun want every citizen to know. In character. |
| #whiterun | text | hold (Whiterun) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Whiterun Court, Steward of Whiterun, Guard of Whiterun, Citizen of Whiterun | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Whiterun Court, Steward of Whiterun, Guard of Whiterun, Citizen of Whiterun | was #whiterun in The Holds; topic: Everybody passes through eventually. |
| #whiterun-court | text | holdcourt (Whiterun) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Steward of Whiterun, Whiterun Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Steward of Whiterun, Whiterun Court | topic: The Jarl, the Steward and the court of Whiterun. In character. |
| #whiterun-guard | text | holdguard (Whiterun) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Guard of Whiterun | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Guard of Whiterun | topic: The Jarl and the guards of Whiterun. In character. |
| Whiterun Court | voice | holdcourt (Whiterun) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Steward of Whiterun, Whiterun Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Whiterun, Steward of Whiterun, Whiterun Court |  |

### Solitude

Category mode: hold (Solitude).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #solitude-announcements | text | holdread (Solitude) | the council, Citizen of Solitude, Guard of Solitude, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Solitude, Steward of Solitude, Solitude Court | the council, Jarl of Solitude, Steward of Solitude, Solitude Court | posts: the council, Jarl of Solitude, Steward of Solitude, Solitude Court; topic: What the Jarl and the court of Solitude want every citizen to know. In character. |
| #solitude | text | hold (Solitude) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Solitude, Solitude Court, Steward of Solitude, Guard of Solitude, Citizen of Solitude | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Solitude, Solitude Court, Steward of Solitude, Guard of Solitude, Citizen of Solitude | was #solitude in The Holds; topic: Court, trade, and the one Imperial embassy left in Skyrim. |
| #solitude-court | text | holdcourt (Solitude) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Solitude, Steward of Solitude, Solitude Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Solitude, Steward of Solitude, Solitude Court | topic: The Jarl, the Steward and the court of Solitude. In character. |
| #solitude-guard | text | holdguard (Solitude) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Solitude, Guard of Solitude | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Solitude, Guard of Solitude | topic: The Jarl and the guards of Solitude. In character. |
| Solitude Court | voice | holdcourt (Solitude) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Solitude, Steward of Solitude, Solitude Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Solitude, Steward of Solitude, Solitude Court |  |

### Windhelm

Category mode: hold (Windhelm).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #windhelm-announcements | text | holdread (Windhelm) | the council, Citizen of Windhelm, Guard of Windhelm, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Windhelm, Steward of Windhelm, Windhelm Court | the council, Jarl of Windhelm, Steward of Windhelm, Windhelm Court | posts: the council, Jarl of Windhelm, Steward of Windhelm, Windhelm Court; topic: What the Jarl and the court of Windhelm want every citizen to know. In character. |
| #windhelm | text | hold (Windhelm) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Windhelm, Windhelm Court, Steward of Windhelm, Guard of Windhelm, Citizen of Windhelm | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Windhelm, Windhelm Court, Steward of Windhelm, Guard of Windhelm, Citizen of Windhelm | was #windhelm in The Holds; topic: The High King sits here. |
| #windhelm-court | text | holdcourt (Windhelm) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Windhelm, Steward of Windhelm, Windhelm Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Windhelm, Steward of Windhelm, Windhelm Court | topic: The Jarl, the Steward and the court of Windhelm. In character. |
| #windhelm-guard | text | holdguard (Windhelm) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Windhelm, Guard of Windhelm | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Windhelm, Guard of Windhelm | topic: The Jarl and the guards of Windhelm. In character. |
| Windhelm Court | voice | holdcourt (Windhelm) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Windhelm, Steward of Windhelm, Windhelm Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Windhelm, Steward of Windhelm, Windhelm Court |  |

### Riften

Category mode: hold (Riften).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #riften-announcements | text | holdread (Riften) | the council, Citizen of Riften, Guard of Riften, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Riften, Steward of Riften, Riften Court | the council, Jarl of Riften, Steward of Riften, Riften Court | posts: the council, Jarl of Riften, Steward of Riften, Riften Court; topic: What the Jarl and the court of Riften want every citizen to know. In character. |
| #riften | text | hold (Riften) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Riften, Riften Court, Steward of Riften, Guard of Riften, Citizen of Riften | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Riften, Riften Court, Steward of Riften, Guard of Riften, Citizen of Riften | was #riften in The Holds; topic: Fish, mead, and the Ratway under the canal. |
| #riften-court | text | holdcourt (Riften) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Riften, Steward of Riften, Riften Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Riften, Steward of Riften, Riften Court | topic: The Jarl, the Steward and the court of Riften. In character. |
| #riften-guard | text | holdguard (Riften) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Riften, Guard of Riften | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Riften, Guard of Riften | topic: The Jarl and the guards of Riften. In character. |
| Riften Court | voice | holdcourt (Riften) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Riften, Steward of Riften, Riften Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Riften, Steward of Riften, Riften Court |  |

### Markarth

Category mode: hold (Markarth).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #markarth-announcements | text | holdread (Markarth) | the council, Citizen of Markarth, Guard of Markarth, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Markarth, Steward of Markarth, Markarth Court | the council, Jarl of Markarth, Steward of Markarth, Markarth Court | posts: the council, Jarl of Markarth, Steward of Markarth, Markarth Court; topic: What the Jarl and the court of Markarth want every citizen to know. In character. |
| #markarth | text | hold (Markarth) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Markarth, Markarth Court, Steward of Markarth, Guard of Markarth, Citizen of Markarth | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Markarth, Markarth Court, Steward of Markarth, Guard of Markarth, Citizen of Markarth | was #markarth in The Holds; topic: Stone, silver, and grudges older than the war. |
| #markarth-court | text | holdcourt (Markarth) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Markarth, Steward of Markarth, Markarth Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Markarth, Steward of Markarth, Markarth Court | topic: The Jarl, the Steward and the court of Markarth. In character. |
| #markarth-guard | text | holdguard (Markarth) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Markarth, Guard of Markarth | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Markarth, Guard of Markarth | topic: The Jarl and the guards of Markarth. In character. |
| Markarth Court | voice | holdcourt (Markarth) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Markarth, Steward of Markarth, Markarth Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Markarth, Steward of Markarth, Markarth Court |  |

### Dawnstar

Category mode: hold (Dawnstar).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #dawnstar-announcements | text | holdread (Dawnstar) | the council, Citizen of Dawnstar, Guard of Dawnstar, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Dawnstar, Steward of Dawnstar, Dawnstar Court | the council, Jarl of Dawnstar, Steward of Dawnstar, Dawnstar Court | posts: the council, Jarl of Dawnstar, Steward of Dawnstar, Dawnstar Court; topic: What the Jarl and the court of Dawnstar want every citizen to know. In character. |
| #dawnstar | text | hold (Dawnstar) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Dawnstar, Dawnstar Court, Steward of Dawnstar, Guard of Dawnstar, Citizen of Dawnstar | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Dawnstar, Dawnstar Court, Steward of Dawnstar, Guard of Dawnstar, Citizen of Dawnstar | was #dawnstar in The Holds; topic: Cold. The ships still come in. |
| #dawnstar-court | text | holdcourt (Dawnstar) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Dawnstar, Steward of Dawnstar, Dawnstar Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Dawnstar, Steward of Dawnstar, Dawnstar Court | topic: The Jarl, the Steward and the court of Dawnstar. In character. |
| #dawnstar-guard | text | holdguard (Dawnstar) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Dawnstar, Guard of Dawnstar | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Dawnstar, Guard of Dawnstar | topic: The Jarl and the guards of Dawnstar. In character. |
| Dawnstar Court | voice | holdcourt (Dawnstar) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Dawnstar, Steward of Dawnstar, Dawnstar Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Dawnstar, Steward of Dawnstar, Dawnstar Court |  |

### Morthal

Category mode: hold (Morthal).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #morthal-announcements | text | holdread (Morthal) | the council, Citizen of Morthal, Guard of Morthal, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Morthal, Steward of Morthal, Morthal Court | the council, Jarl of Morthal, Steward of Morthal, Morthal Court | posts: the council, Jarl of Morthal, Steward of Morthal, Morthal Court; topic: What the Jarl and the court of Morthal want every citizen to know. In character. |
| #morthal | text | hold (Morthal) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Morthal, Morthal Court, Steward of Morthal, Guard of Morthal, Citizen of Morthal | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Morthal, Morthal Court, Steward of Morthal, Guard of Morthal, Citizen of Morthal | was #morthal in The Holds; topic: A swamp, a few houses, and the Jarl's hall. |
| #morthal-court | text | holdcourt (Morthal) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Morthal, Steward of Morthal, Morthal Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Morthal, Steward of Morthal, Morthal Court | topic: The Jarl, the Steward and the court of Morthal. In character. |
| #morthal-guard | text | holdguard (Morthal) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Morthal, Guard of Morthal | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Morthal, Guard of Morthal | topic: The Jarl and the guards of Morthal. In character. |
| Morthal Court | voice | holdcourt (Morthal) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Morthal, Steward of Morthal, Morthal Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Morthal, Steward of Morthal, Morthal Court |  |

### Falkreath

Category mode: hold (Falkreath).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #falkreath-announcements | text | holdread (Falkreath) | the council, Citizen of Falkreath, Guard of Falkreath, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Falkreath, Steward of Falkreath, Falkreath Court | the council, Jarl of Falkreath, Steward of Falkreath, Falkreath Court | posts: the council, Jarl of Falkreath, Steward of Falkreath, Falkreath Court; topic: What the Jarl and the court of Falkreath want every citizen to know. In character. |
| #falkreath | text | hold (Falkreath) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Falkreath, Falkreath Court, Steward of Falkreath, Guard of Falkreath, Citizen of Falkreath | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Falkreath, Falkreath Court, Steward of Falkreath, Guard of Falkreath, Citizen of Falkreath | was #falkreath in The Holds; topic: Pines, and a graveyard bigger than the town. |
| #falkreath-court | text | holdcourt (Falkreath) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Falkreath, Steward of Falkreath, Falkreath Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Falkreath, Steward of Falkreath, Falkreath Court | topic: The Jarl, the Steward and the court of Falkreath. In character. |
| #falkreath-guard | text | holdguard (Falkreath) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Falkreath, Guard of Falkreath | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Falkreath, Guard of Falkreath | topic: The Jarl and the guards of Falkreath. In character. |
| Falkreath Court | voice | holdcourt (Falkreath) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Falkreath, Steward of Falkreath, Falkreath Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Falkreath, Steward of Falkreath, Falkreath Court |  |

### Winterhold

Category mode: hold (Winterhold).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #winterhold-announcements | text | holdread (Winterhold) | the council, Citizen of Winterhold, Guard of Winterhold, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Winterhold, Steward of Winterhold, Winterhold Court | the council, Jarl of Winterhold, Steward of Winterhold, Winterhold Court | posts: the council, Jarl of Winterhold, Steward of Winterhold, Winterhold Court; topic: What the Jarl and the court of Winterhold want every citizen to know. In character. |
| #winterhold | text | hold (Winterhold) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Winterhold, Winterhold Court, Steward of Winterhold, Guard of Winterhold, Citizen of Winterhold | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Winterhold, Winterhold Court, Steward of Winterhold, Guard of Winterhold, Citizen of Winterhold | was #winterhold in The Holds; topic: What's left of it. |
| #winterhold-court | text | holdcourt (Winterhold) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Winterhold, Steward of Winterhold, Winterhold Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Winterhold, Steward of Winterhold, Winterhold Court | topic: The Jarl, the Steward and the court of Winterhold. In character. |
| #winterhold-guard | text | holdguard (Winterhold) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Winterhold, Guard of Winterhold | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Winterhold, Guard of Winterhold | topic: The Jarl and the guards of Winterhold. In character. |
| Winterhold Court | voice | holdcourt (Winterhold) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Winterhold, Steward of Winterhold, Winterhold Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Winterhold, Steward of Winterhold, Winterhold Court |  |

### Raven Rock

Category mode: hold (Raven Rock).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #raven-rock-announcements | text | holdread (Raven Rock) | the council, Citizen of Raven Rock, Guard of Raven Rock, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Raven Rock, Steward of Raven Rock, Raven Rock Court | the council, Jarl of Raven Rock, Steward of Raven Rock, Raven Rock Court | posts: the council, Jarl of Raven Rock, Steward of Raven Rock, Raven Rock Court; topic: What the Jarl and the court of Raven Rock want every citizen to know. In character. |
| #raven-rock | text | hold (Raven Rock) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Raven Rock, Raven Rock Court, Steward of Raven Rock, Guard of Raven Rock, Citizen of Raven Rock | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Raven Rock, Raven Rock Court, Steward of Raven Rock, Guard of Raven Rock, Citizen of Raven Rock | was #raven-rock in The Holds; topic: On Solstheim, across the water. The ash still falls. |
| #raven-rock-court | text | holdcourt (Raven Rock) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Raven Rock, Steward of Raven Rock, Raven Rock Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Raven Rock, Steward of Raven Rock, Raven Rock Court | topic: The Jarl, the Steward and the court of Raven Rock. In character. |
| #raven-rock-guard | text | holdguard (Raven Rock) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Raven Rock, Guard of Raven Rock | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Raven Rock, Guard of Raven Rock | topic: The Jarl and the guards of Raven Rock. In character. |
| Raven Rock Court | voice | holdcourt (Raven Rock) | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Raven Rock, Steward of Raven Rock, Raven Rock Court | the council, Dev, Gamemaster, Trial Gamemaster, Loremaster, Moderator, Jarl of Raven Rock, Steward of Raven Rock, Raven Rock Court |  |

### Playtesters

Category mode: pathfind. It was Testing.

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #playtester-announcements | text | testersread | everybody on staff, Playtester | the council | posts: the council; topic: Announcements for playtesters. The council posts here. |
| #playtester-rules | text | testersread | everybody on staff, Playtester | the council | posts: the council; written by the build from content.py TESTERRULES, a draft waiting on approval; topic: How playtesting works here. |
| #test-tasks | forum | pathfind | everybody on staff, Playtester | everybody on staff, Playtester | was #Test-Tasks in Testing; was #test-tasks in Testing; topic: One thread per test task, tagged Main. |
| #known-issues | text | pathfind | everybody on staff, Playtester | everybody on staff, Playtester | was #known-issues in Testing; topic: Known issues the team is working on. Kept by the bot. |
| #test-findings | forum | pathfind | everybody on staff, Playtester | everybody on staff, Playtester | was #test-findings in Testing; topic: Pass, fail, and what went wrong. |
| #playtest-sessions | text | pathfind | everybody on staff, Playtester | everybody on staff, Playtester | topic: Call a session and say you are coming. |
| #playtester-chat | text | pathfind | everybody on staff, Playtester | everybody on staff, Playtester | topic: Talk about testing: what you are trying and what you found. |
| Playtester Voice | voice | pathfind | everybody on staff, Playtester | everybody on staff, Playtester | was play-testing in Testing |

### Staff

Category mode: staff.

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #staff-announcements | announce | staffread | everybody on staff | the council | posts: the council; was #news in Staff; topic: Announcements for every staff member. The council posts here. |
| #council-decisions | text | staffread | everybody on staff | the council | posts: the council; topic: Every council decision, with its date. The council posts here. |
| #staff-updates | text | staff | everybody on staff | everybody on staff | never made by the build; topic: Only what every staff member must act on: a restart, an outage, or a change to how staff work. The bot and the watchdog post here. |
| #staff-general | text | staff | everybody on staff | everybody on staff | topic: Nobody else can see this. |
| #council | text | council | the council | the council | topic: The council: Owner, Co-Owner and the leads. |
| #ticket-log | text | council | the council | the council | was #tickets in Applications; topic: Every ticket that gets closed, with a link back to it, and any ticket whose private thread would not open. The council only. |
| Staff Room | voice | staff | everybody on staff | everybody on staff |  |
| #dev-notes | text | staff | everybody on staff | everybody on staff | never made by the build; topic: What we’re on, and what broke doing it. |
| #deploys | text | staff | everybody on staff | everybody on staff | never made by the build; topic: Every ship and restart lands here. |
| #reports | text | staff | everybody on staff | everybody on staff | never made by the build; topic: Reports about people. Staff only. |

### Gamemasters

Category mode: space (Gamemasters).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #gm-announcements | text | spaceread | the council, Gamemaster, Trial Gamemaster, Moderator, Loremaster | the council | posts: the council; topic: Announcements for Gamemasters. The council posts here. |
| #gm-rules | text | spacerules | the council, Gamemaster, Trial Gamemaster, Moderator | Owner and Co-Owner, Lead Gamemaster | posts: Owner and Co-Owner, Lead Gamemaster; topic: The GM Rules. Lead Gamemaster, Owner and Co-Owner post here. |
| #gm-event-plans | text | space | the council, Loremaster, Gamemaster, Trial Gamemaster, Moderator | the council, Gamemaster, Trial Gamemaster, Moderator | topic: What an event will be, before it runs. Loremasters read it. |
| #gm-scene-summaries | text | space | the council, Loremaster, Gamemaster, Trial Gamemaster, Moderator | the council, Gamemaster, Trial Gamemaster, Moderator | topic: What happened in a scene you ran, after it ends. |
| #gm-chat | text | space | the council, Gamemaster, Trial Gamemaster, Moderator | the council, Gamemaster, Trial Gamemaster, Moderator | topic: Planning, handoffs and questions between gamemasters. |
| #gm-suggestions | text | space | the council, Gamemaster, Trial Gamemaster, Moderator | the council, Gamemaster, Trial Gamemaster, Moderator | topic: Ideas for scenes, events and how we run them. |
| #gm-discipline | text | space | the council, Gamemaster, Trial Gamemaster, Moderator | the council, Gamemaster, Trial Gamemaster, Moderator | topic: Reprimands, punishments and bans only. Nothing else. |
| GM Voice | voice | space | the council, Gamemaster, Trial Gamemaster, Moderator | the council, Gamemaster, Trial Gamemaster, Moderator |  |
| #gm | text | space | the council, Gamemaster, Trial Gamemaster, Moderator | the council, Gamemaster, Trial Gamemaster, Moderator | never made by the build |

### Lore

Category mode: space (Lore).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #lore-announcements | text | spaceread | the council, Loremaster | the council | posts: the council; topic: Announcements for Lore. The council posts here. |
| #lore-rules | text | spacerules | the council, Loremaster | Owner and Co-Owner, Lead Loremaster | posts: Owner and Co-Owner, Lead Loremaster; written by the build from content.py LORERULES, a draft waiting on approval; topic: How Lore works. Lead Loremaster, Owner and Co-Owner post here. |
| #lore-chat | text | space | the council, Loremaster | the council, Loremaster | topic: Talk between Lore. |
| Lore Voice | voice | space | the council, Loremaster | the council, Loremaster |  |

### Moderation

Category mode: space (Moderation).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #mod-announcements | text | spaceread | the council, Moderator | the council | posts: the council; topic: Announcements for Moderation. The council posts here. |
| #mod-rules | text | spacerules | the council, Moderator | Owner and Co-Owner, Lead Moderator | posts: Owner and Co-Owner, Lead Moderator; written by the build from content.py MODRULES, a draft waiting on approval; topic: How Moderation works. Lead Moderator, Owner and Co-Owner post here. |
| #mod-chat | text | space | the council, Moderator | the council, Moderator | topic: Talk between Moderation. |
| Moderation Voice | voice | space | the council, Moderator | the council, Moderator |  |

### Support

Category mode: space (Support).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| Support | voice | open | everybody on staff, Playtester | everybody on staff, Playtester | was Help Voice in Voice; was Support in Help |
| #support-announcements | text | spaceread | the council, Support | the council | posts: the council; topic: Announcements for Support. The council posts here. |
| #support-rules | text | spacerules | the council, Support | Owner and Co-Owner, Lead Support | posts: Owner and Co-Owner, Lead Support; written by the build from content.py SUPPORTRULES, a draft waiting on approval; topic: How Support works. Lead Support, Owner and Co-Owner post here. |
| #support-chat | text | space | the council, Support | the council, Support | topic: Talk between Support. |
| Support Staff | voice | space | the council, Support | the council, Support | was Support Voice in Support |

### Content

Category mode: space (Content).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #content-announcements | text | spaceread | the council, Content Creator | the council | posts: the council; topic: Announcements for Content. The council posts here. |
| #content-rules | text | spacerules | the council, Content Creator | Owner and Co-Owner, Lead Content Creator | posts: Owner and Co-Owner, Lead Content Creator; written by the build from content.py CONTENTRULES, a draft waiting on approval; topic: How Content works. Lead Content Creator, Owner and Co-Owner post here. |
| #content-chat | text | space | the council, Content Creator | the council, Content Creator | topic: Talk between Content. |
| Content Voice | voice | space | the council, Content Creator | the council, Content Creator |  |

### Dev

Category mode: space (Dev).

| Channel | Kind | Mode | Sees | Talks | Notes |
|---|---|---|---|---|---|
| #dev-announcements | text | spaceread | the council, Dev | the council | posts: the council; topic: Announcements for Dev. The council posts here. |
| #dev-rules | text | spacerules | the council, Dev | Owner and Co-Owner, Lead Dev | posts: Owner and Co-Owner, Lead Dev; written by the build from content.py DEVRULES, a draft waiting on approval; topic: How Dev works. Lead Dev, Owner and Co-Owner post here. |
| #dev-test-tasks | forum | space | the council, Dev | the council, Dev | never made by the build; was #dev-test-tasks in Staff; topic: Test tasks someone on dev has to measure, from the board. Kept by the bot: a post goes when its issue closes as fixed or its test task no longer says Server: Dev. |
| #dev-test-findings | forum | space | the council, Dev | the council, Dev | was #dev-test-findings in Staff; was #dev-test-results in Staff; topic: Pass, fail, and what went wrong, for the test tasks in #dev-test-tasks. |
| #dev-coordination | text | space | the council, Dev | the council, Dev | topic: Developers only: a shared file being edited, the dev feed taken. Say it here before you do it. |
| #dev-chat | text | space | the council, Dev | the council, Dev | topic: Talk between Dev. |
| Dev Voice | voice | space | the council, Dev | the council, Dev |  |

## Retired

Categories retired by the plan, removed by `-Prune` once empty: Help, The Holds, Voice, Factions.

Channel names the build no longer wants, removed by `-Prune`: tech-help, looking-for-group, off-topic, downloads, links-and-credits, Small Table, The Longhouse, Away, screenshots, clips, bot-commands, The Bannered Mare, The Road, test-these, test-tasks-archive, tickets-and-applications, tickets, seats.

Channels never deleted by anything in the build: council, council-decisions, dev-test-findings, dev-test-results, dev-test-tasks, general-chat, gm, gm voice, gm-chat, gm-discipline, gm-rules, gm-scene-summaries, gm-suggestions, help voice, jukebox, known-issues, news, play-testing, playtester voice, server-progression-and-economy, staff-announcements, staff-updates, suggestions, support, test-findings, test-results, test-tasks, ticket-log, welcome-travelers.

Roles never deleted: every Jarl, Citizen and office role, and every faction's Leader, member and Officer role.
