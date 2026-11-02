# Chat commands

Every line starting with a slash that the game answers, who may use it,
what it does, where it is read, and where people are told about it.

The rule is on [Thornswood systems](../GAME-SYSTEMS.md), "Buttons, not
commands". Decided by Patrick on 4 Oct: anything a person does in the
world is a key, a prompt, a panel, or the thing itself activated. Staff
and dev commands stay commands. Each command for people below has an
issue that turns it into buttons, except `/stuck`, `/helpme` and
`/report`, which stay commands (Patrick, later on 4 Oct: "change it to
except the /stuck and the ones for getting help from GMs"), and the
ways of saying a line and `/roll`, which stay commands with no buttons
(Patrick, 4 Oct, #1639: "Allow those commands and don't do buttons"),
and `/needs`, the needs bars as a line of text for somebody who hid them
(Patrick, 11 Oct, #2267). Report a problem is the one help line with a
button, on the help panel (Patrick, 21 Oct, #3155); it sends `/problem`,
below with the lines the game sends itself.
The umbrella is #1620.

File and line numbers are main at 9b5a667 on 4 Oct. They move as the
files change, so each row also names the function or block.

## How a line travels

Enter opens the chat box (`game/ui/thornswood-chat.js`). A line that
starts with a slash goes to the voice service, which is not the game
server. The voice service says `/me`, `/do`, `/w` and `/s` itself and
never passes them on (`voice/voice-server.js:CHAT_VERBS`). Every other slash
line is queued for the game server, which collects the queue in the
chat commands block of `game/gamemode.js`: `dispatch` first,
then `handle`.

Two lists in that block decide what people are told. `WORDS` is every
word the server answers. `PLAYER_WORDS` is the words named to everybody,
and since #1633 it is exactly the commands that stay, the rows below that
say so: `/stuck`, `/helpme`, `/report`, `/me`, `/do`, `/w`, `/s`, `/y`,
`/ooc`, `/roll` and `/needs`. `helpLine` reads it: the answer to `/help` and
`/commands`, and the end of the reply to a word the server does not know,
"No command called ... Help is a panel: F7 opens it ... Typed in the
chat: ...". In the tables below, "the list" means `PLAYER_WORDS`.

The help in the game is a panel since #1633 (`game/ui/thornswood-help.js`):
its own key, HelpKey in `Thornswood.ini` (F7), changed on Settings in the
game (#3126), and Help on the K, P and J panels (Patrick's answer on #1633). Its
topics are talking, people, living, work, land and getting help, written
as keys, prompts and panels, with every key named as that machine has it
bound. It names the commands that stay and no other.

Other places that tell people to type a command: the help panel, the
site's help (`site/data/help.md`; the launcher's Help page went with
#3146), the system pages in this folder, the site's pages in `site/data/site`, and
the server's own answers. Each conversion issue took its commands out of
all of them.

## Commands for people

Each of these becomes buttons, except the rows that say they stay.
The server may keep a line as an internal message that a key or a panel
sends, the way Y, H and L on the look prompt send `/friend`, `/trade`
and `/mute` with the id under the crosshair. Nobody is told to type it,
and help text never lists it.

| Command | Who | What it does | Read at | Where people are told | Buttons today, then to come | Issue |
| --- | --- | --- | --- | --- | --- | --- |
| `/notice <title> :: <body>`, `/job <reward> <title> :: <body>`, `/job done <n>` | Anybody at a board; `/job done` only the job's poster | Posts a notice for 20 gold or a job for 30 and its reward, held until it is done; pays a taken job's reward to its taker | `postWords`, `post` and `jobDone` in the property block | Nowhere. [Notice boards](noticeboards.md) names the buttons | Make a post on the board panel sends the first two, and Pay the reward the third. Never in the list or the help. | #1627, #2554 |
| `/take <n>`, `/unpin <n>`, `/dropjob <n>` | Anybody at a board | Takes a job, takes your own down, hands a job back | `take`, `unpin`, `dropJob` in the property block | Nowhere. [Notice boards](noticeboards.md), [Trading company](trading-company.md) and [Gold](gold.md) name the buttons | Take, Take down and Put it back on the board panel send them. Never in the list or the help. | #1627 |
| `/board <hold>` | Anybody | Puts any town's board on J, read only, with your jobs under it | `board`, then `boardsView`, in the property block | Nowhere. [Notice boards](noticeboards.md) names J's Boards tab | E on the board opens the panel there. Picking a town under Boards on J sends it. Never in the list or the help. | #1627 |
| `/jobs` | Nobody | Gone. The jobs you have taken, in every town, are Your jobs | `jobsOf` in the property block | Nowhere | Your jobs on the board panel, with Put it back for that board's, and under Boards on J. | #1627 |
| `/haul <pay> <hold> <words>`, `/haul done <hold> <n>` | Anybody at a board; the poster or a steward confirms | Sends a haul, and confirms one at the destination | `gamemode.js`, `haulCmd` in the property block | Nowhere. [Trading company](trading-company.md) names the buttons | Send a haul and Confirm on the board panel send it. Never in the list or the help. | #1393 |
| `/letter "<name>" <words>`, `/deliver <id>` | Anybody | Writes a letter at a board; hands it over and pays the courier | `postLetter`, `deliver` in the property block | Nowhere. [Notice boards](noticeboards.md) names the form and the key | Write a letter on the board panel sends `/letter`. Hand over the letter on the look prompt, E while you carry a letter for the person under the crosshair, sends `/deliver` with their id. Never in the list or the help. | #1595 |
| `/friend <name>`, `/friend`, `/friend remove <name>` | Anybody | Asks to be friends, lists them, drops one | `gamemode.js:word === '/friend'`, the social branch of `handle` | Nowhere. [Friends](friends.md) names the key and the buttons | Y on the look prompt and Add friend under Near you on P ask; the P panel lists them, and Remove beside a friend drops that friend by profile id. Never in the list or the help. | #1628 |
| `/trade <name>`, `/trade add`, `remove`, `gold`, `ok`, `cancel`, `sale` | Anybody; `sale` is a company worker's | Offers a trade, and works it; `sale` makes it a sale out of Skyrim (#1393) | `gamemode.js:word === '/trade'` | Nowhere. [Trade](trade.md) names the key and the buttons | H on the look prompt and Trade under Near you on P offer; the trade window sends every verb, and Buy for the company sends `sale`. Asking while in a trade brings its window back. Never in the list or the help. | #1628 |
| `/mute <name>`, `/mute`, `/mute text <name>` | Anybody | Stops hearing somebody, lists who, turns their text off | `gamemode.js:if (word === '/mute') {`, `gamemode.js:word === '/mute' && (rest === ''`, `gamemode.js:if (word === '/mute' && rest.indexOf('text ') === 0)` | Nowhere. [Voice](voice.md) names the key and the buttons | L on the look prompt; Mute and Text on P beside a friend, anybody under Near you, and anybody under Muted and hidden, which is the list. Never in the list or the help. | #1628 |
| `/hidename <name>`, `/hidename`, `/hidename all` | Anybody | Hides a name above a head, lists them, hides every name | `gamemode.js:word === '/hidename'` | Nowhere. [Voice](voice.md) names the buttons | Name on P beside a friend, anybody under Near you, and anybody under Muted and hidden, which is the list; Hide every name on P. Never in the list or the help. | #1628 |
| `/yes`, `/no` | Anybody | Answers whatever somebody has offered | `gamemode.js:word === '/yes'` | Nowhere | Accept and Refuse on the prompt, and on P. Never in the list or the help. | #1628 |
| `/party <name>`, `/party`, `/party leave`, `disband`, `kick <name>`, `lead <name>` | Anybody; the leader kicks, hands the lead and disbands | Asks, lists, leaves and runs a party | `gamemode.js:word === '/party' && (rest === ''` and the branches after it, the offer under `gamemode.js:} else if (o.kind === 'party') {` | Nowhere. [Party](party.md) names the key and the buttons | P on somebody not in your party sends the ask with their form id, as the look prompt's "Ask to party" says; P otherwise opens the P panel, which lists the party and has Leave, Disband, Kick, Lead, and Ask beside an online friend, which sends that friend's profile id (#1695). Out of the list, the pages and the server's lines. | #1629 |
| `/journal` and its verbs | Anybody | Journals, pages and sharing them | `journalCommand` in the chat commands block | Nowhere. [Journals](journal.md) names J and its buttons | J sends every verb. Out of the list, the pages and the server's own lines. | #1630 |
| `/book` and its verbs | Anybody; founding a business needs Business Owner or Dev, and a faction's book its Leader role | Group books: found, invite, leave, roles, prices | The `/book` branch of `handle`, then the books block's `command` | Nowhere. [Factions](factions.md) names J and its buttons | J sends every verb: Invite names the person in front of you when J opens, and each role's permissions are buttons. The board panel submits a price list. The invite reads as one on the P prompt (#1591). Out of the list, `/help people`, the pages and the server's own lines. | #1630 |
| `/rest sit`, `campfire`, `inn`, `up` | Anybody | Where you are resting, for the rest meter | `bedRest` in the property block's beds | Nowhere. [Exhaustion](exhaustion.md) names sitting, lying down and the wheel's Sit | Sitting down sends `/rest sit`, lying down `/rest bed` and getting up `/rest up`, and the server answers by the furniture it saw pressed, whatever the word (#1603). Sit on the emote wheel sends nothing: the server reads the last animation the game sent for the person, and the wheel's Sit is a seat on the ground (#1631). Out of the list and `/help living`. | #1631 |
| `/needs`, `/need` | Anybody | The four needs bars as one line of text: Hunger, Thirst and Rest as a per cent with their band, Temp as its word and number and where it is heading, and where you are resting. It changes nothing | The `/needs` branch of `handle`, then `textView` in the needs block | The list; the help panel's Living; the line under the needs bars on Settings in the game; the Type a command row on Settings and `Thornswood.ini` | Stays a command, and the help names it (Patrick, 11 Oct, #2267): it is another view of the bars and the Body page on K, for somebody who hid the bars. It went with #1631 and came back on its own. | #2267 |
| `/eat`, `/drink`, `/drink ale` | Nobody | Gone (#1631). They gave food or drink with no item | None | Nowhere | Eating or drinking the item, which the engine reports to the server itself (`mp.onEatItem`, `eaten` in the needs block, #3136). Said on #1382. | #1631 |
| `/bard` | Nobody | Gone (#1631). The bard is somebody the server sees playing | `playing` and `bardSeen` in the needs block | Nowhere. [Exhaustion](exhaustion.md), [Emotes](emotes.md) and [People beside you](people.md) name the wheel | Lute, Flute or Drum on the emote wheel with that instrument in the pack, or Sing (Patrick, 4 Oct), read from the last animation the game sent for the person. | #1631 |
| `/helpme <what>`, `/help-me`, `/report <name> <what>` | Anybody | Reaches staff; reports somebody to staff | The `/helpme` branch of `handle`, then the asking staff block's `ask` | The list; the help panel's Getting help; the site's help "Getting staff in game"; `site/data/site/privacy.md` | Stays a command, and the help names it (Patrick, 4 Oct). | None |
| `/stuck` | Anybody | Out of a wedged spot, a few steps back or to a temple | The `/stuck` branch of `handle`, then the stuck block's `command` | The list; the help panel's Getting help; the site's help "Getting staff in game"; `site/data/site/privacy.md` | Stays a command, and the help names it (Patrick, 4 Oct). | None |
| `/help`, `/commands` | Anybody, typed out of habit | Says where the help panel is and names the list; a tester is told theirs as well | The `/help` branch of `handle`, `helpLine` | Nowhere. The site's help and the reply to a word nobody has point at the panel | The help panel, on HelpKey (F7) and on Help on the K, P and J panels. Nobody is told to type `/help`. | #1633 |
| `/merchant <id>`, `/merchant buy`, `sell`, `supply`, `close` | Anybody at a guild trader | A trader's wares | The `/merchant` branch of `handle`, then the merchant block's `command` | Nowhere. [Merchant's Guild](merchants-guild.md) names E and the panel | E on a trader opens the panel, which sends the rest. Out of the list and the page (#1633). | #1633 |
| `/apprentice <id> <half>`, `/apprentice end <id> <half>`, `/apprentice leave <half>`, `/apprentice` | A Master takes on; either of them ends it | Takes somebody on, ends it from either side, says who is whose | `apprenticeCommand` in the character block | Nowhere. [Masters and apprentices](apprenticeship.md) names the prompt row and the K page | K on the look prompt, for a Master looking at somebody they could take on, opens the Masters and apprentices page on K with Take on for each half; End there for each side; Accept and Refuse for the learner. Never in the list or the help. | #1634 |
| `/study` | Anybody at a study desk in the College halls | A spell point in a semester | Never a word. E at a study desk is the semester (`deskActivated` in the college block, from `mp.onActivate`); `/pick study` only tells an old K panel where the desks are | [Magic](magic.md), [Masters and apprentices](apprenticeship.md) | E at a study desk in one of the four halls (Patrick, 22 Oct, #1387). | #1387 |
| `/ride`, `/ride <stop>` | Anybody at a driver | Where the driver goes and the fares; pay and go | The `/ride` branch of `handle`, then the carriages block's `command` | Nowhere. [Carriages and ferries](carriages.md) names E and the panel | E on a driver opens the panel of his stops and fares, and its Ride button sends `/ride` and the stop. Never in the list or the help. | #1635 |
| `/cart load`, `drive`, `pullin`, `collect`, `return`, `close`; `/cart raid <id>`, `take`; `/cart staff`, `draft`, `confirm`, `add`, `bring` | Anybody at a cart stop; anybody near a driver for `raid` and `take`; staff for the rest | Loads, drives, brings in and collects a trade cart; raids one on the road; keeps the stops and roads | The `/cart` branch of `handle`, then the trade carts block's `command` | Nowhere. [Trade carts](carts.md) names E, the panel and Raid cart | E on a cart stop's crate opens the stop's panel, which sends the rest; Raid cart under Near you on P sends `raid`; Cart stops and roads on the Office page of K is staff's. Never in the list or the help. | #3158 |
| `/plant`, `/plot`, `/claim` at a plot | Anybody with the class | Sows a plot, says what is in it, claims the farm | `command` in the character block, then the farming block's `command` | Nowhere since #1636; [Farmer](classes/farmer.md) names the line and the keys | A crop under the crosshair draws a line of what is in the ground and whose farm it is; E on an empty plot sows it, and X claims the farm when the line says so. Out of the list and the help. | #1636 |
| `/claim` at a door, `/deed`, `/deeds` | Anybody | Claims a building and hands the deed; lists what you hold | `command` in the character block, then the property block's `command` | Nowhere since #1637; [Property](property.md) names the key | X at a door just opened, while its line says Claim, sends `/claim <id>`; the property page on K lists what you hold, with the rent owed and the farm. Out of the list and the help. | #1637 |
| `/lock`, `/unlock` | The holder, or whoever carries the deed, at the door | Locks and unlocks the building | The property block's `command`, `setLock` | Nowhere since #1637; [Property](property.md) names the key | X at a door just opened sends `/lock <id>` or `/unlock <id>`, as its line says. Out of the list and the help. | #1637 |
| `/mold`, `/key` | A smith | A mold at a door, a key at a forge | The property block's `command`, `mold` and `cutKey` | Nowhere since #1637; [Property](property.md) names the keys | U presses a blank mold into the door; X at a forge, carrying a mold that has been pressed into a door, sends `/key <id>` and cuts a key for an iron ingot; U there sends `/key <id> master` and cuts the building's master key for 2 iron ingots (#2254). Out of the list and the help. | #1637 |
| `/office <court|steward|guard> <hold> <id>`, `-<id>`, `/office hold <office> <hold>` | The Jarl of that hold, by the "Jarl of <Hold>" Discord role, alone, on the character that holds it; `hold`: any character whose account holds that role | Gives or takes that hold's Court, Steward or Guard role: the server asks the site, which sets the Discord role with the bot's token | `officeCmd` in the property block, through the character block's `command`; `/api/office` on the site | Nowhere. [Offices](offices.md) names the page | Name beside a person in the world, and Remove beside a holder (asked twice), on the Office page of K, send the person's profile id; Hold it here, pressed twice beside an office the account holds, sends `/office hold`, and that character holds the office (one character an office, Patrick, 16 Oct). It replaced `/jarl`, `/guard` and `/steward`. Never in the list or the help. | #2551 |
| `/evict`, `/rent` | A steward (the Steward or the Jarl of a hold, by the Discord role), in their own hold; staff evict and set rent at any building, logged for staff (#2551); anybody asks the rent | Ends a claim, sets rent | `evict` and `rentCmd` in the property block | Nowhere. [Property](property.md) names the page | Evict, Set rent, No rent and Rent paid (`/rent paid <profile> <gold>`, #3895) for the door opened in the last minute, on the Office page of K. The board panel says what the hold has been paid. `/box`, which marked a container as a hold's box, is gone (Patrick, 15 Oct, #2298): the drop box on the board is the only box. Never in the list or the help. | #1638 |
| `/dropbox gold`, `/dropbox leave`, `/dropbox take`, `/dropbox records` | Anybody at a hold's drop box; Records only that hold's officers | Puts gold in, leaves something for somebody, takes out what is yours (an officer anything), shows the records | `dropboxCmd` in the property block | Nowhere. [Notice boards](noticeboards.md) names the box | Put in, Leave it, Take back or Take, and Records on the drop box's panel, which E on the box opens. Never in the list or the help. | #2298 |
| `/stall claim`, `/stall lay`, `/stall price`, `/stall back`, `/stall buy`, `/stall find`, `/stall letgo`, `/stall end`, `/stall close` | Anybody at a market stall; lay, price, back and letgo only its keeper; buy only while the keeper is at it; end only a steward of the stall's hold, or staff, logged | Claims a free stall, lays out goods at a price in gold or goods, changes a price, takes goods back, buys, finds what a goods price can name, lets the stall go, ends somebody's keeping | `command` in the market stalls block | Nowhere. [Market stalls](stalls.md) names the key and the panel | Claim this stall, Lay it out, Set price, Take back, Buy, Find, Let the stall go and End this claim on the stall's panel, which X at a stall opens. Never in the list or the help. | #3160 |
| `/board move <hold>`, `/board here` | A steward of that hold (its Steward or its Jarl) | Moves a notice board | `board` and `moveBoard` in the property block | Nowhere. [Notice boards](noticeboards.md) names the page | A board's town on the Office page of K, pressed twice, sends `/board move <hold>`. Nothing sends `/board here`. Never in the list or the help. | #1638 |
| `/me`, `/do`, `/whisper`, `/w`, `/shout`, `/s`, `/yell`, `/y` | Anybody | How a line is said, and how far it carries | `voice/voice-server.js:CHAT_VERBS`, `voice/headlines.js:SHOUT` | The list, as `/me`, `/do`, `/w`, `/s` and `/y`; the help panel's Talking; the site's help "Talking"; [Text chat](chat.md), [People beside you](people.md), [Emotes](emotes.md); the voice service's usage lines | Stays a command, with no buttons, and the help names it (Patrick, 4 Oct). | None |
| `/ooc`, `/o` | Anybody | Out of character, to whoever is near | `gamemode.js:word === '/ooc'` | The list; the help panel's Talking; the site's help "Talking"; [Text chat](chat.md), [Factions](factions.md), [Notice boards](noticeboards.md); `site/data/site/rules.md` | Stays a command, with no buttons, and the help names it (Patrick, 4 Oct). | None |
| `/roll`, `/r` | Anybody | Dice, rolled on the server | `game/ui/thornswood-chat.js:/roll, because a shop full of haggling needs one`, `gamemode.js:word === '/roll'` | The list; the help panel's Talking; the site's help "Talking"; [Text chat](chat.md) | Stays a command, with no buttons, and the help names it (Patrick, 4 Oct). | None |
| `/repair`, `/repair mend <base> <condition> <name>` | Anybody with a repair kit | Opens the repair panel; a row's Mend button mends that piece with a kit | The `/repair` branch of `handle`, then `panel` in the durability block | Nowhere. [Durability](durability.md) names the key and the panel | U in the inventory, with a kit in the pack, opens the panel, and Mend sends `mend`. Never in the list or the help. | #1384 |
| `/preserve`, `/preserve salt <base> <days left> <name>`, `/preserve smoke <base> <days left> <name>` | A Hearthcook or a Confectioner | Opens the preserving panel; a row's Salt or Smoke button salts or smokes that stack | The `/preserve` branch of `handle`, then `panel` in the spoilage block | Nowhere. [Spoilage](spoilage.md) names the key and the panel | Y in the inventory, with raw food that spoils in the pack, opens the panel, and Salt or Smoke sends the rest. Never in the list or the help. | #3163 |
| `/treat`, `/treat <id>`, `/treat <me or id> <cloth, bandage, splint, poultice, remedy or set>` | Anybody, on themselves or on somebody hurt within about 4 metres | Opens the wounds panel for you or for them; a row's button gives that treatment | The `/treat` branch of `handle`, then `panel` in the injury and disease block | Nowhere. [Injury](injury.md) names the keys and the panel | H in the inventory, while you have a wound to tend, opens yours; X on somebody hurt, as the look prompt says, opens theirs; each button sends the treatment. Never in the list or the help. | #1383 |
| `/furniture`, `/furniture look`, `/furniture place <piece>`, `/furniture move <id>`, `/furniture down`, `/furniture turn`, `/furniture pick <id>` | The holder of the building they stand in, or whoever carries its deed or master key | Opens the furniture panel; sets a piece down, moves it, turns it or picks it up | The `/furniture` branch of `handle`, then `command` in the furniture block | Nowhere. [Property](property.md) names the keys and the panel | X in the inventory, inside a building you may arrange, opens the panel, and Place sends `place`; U and X on a piece, or with one in hand, send the rest; the plugin sends `look` on entering a cell and opening the inventory. Never in the list or the help. | #2679 |
| `/maneuver <name>`, `/maneuver` | A warrior | Starts a warrior's maneuver; with no name, says which you hold | `gamemode.js`, `use` in the warrior maneuvers block | Nowhere. [Warrior](professions/warrior.md) names the key | The maneuver key (9) opens a panel of yours, and a number or a click there sends it. Never in the list or the help. | #1386 |

`/pick` and `/spend` are the K panel's lines (`gamemode.js:if (word !== '/pick' && word !== '/spend') { return false; }`):
profession, class, town, spells and points, `/pick perk fontofmagic`
from the Use button beside Font of Magic, `/pick study`, which only
tells a K panel from before the study desks to press E at one (#1387), and `/pick weave warmth` or
`/pick weave armour` from Warmth and Armour on a Master Weaver's
profession card (#1398). K sends them and nothing tells anybody to
type them, so there is nothing to turn.

## Staff and dev commands

These stay commands. How to run each one, with examples:
[Staff commands](../guide/staff-commands.md) in the Developer Guide.

| Command | Who | What it does | Read at | Where staff are told |
| --- | --- | --- | --- | --- |
| `/tp <place>`, `/goto <place>`, `/tp` | Testers and dev: the Playtester role on Discord (the door's allowed list), the written playtester and dev lists, and the admins | Moves you to a town or a named place; `/tp` alone lists the places | `gamemode.js:word === '/tp'`, `isPlaytester` | The reply to `/help` and to a word nobody has adds a line for them, and for nobody else (`helpLine`) |
| `/give <item> [count]`, `/spawn <creature> [count] [keep]` | Testers and dev | Makes items in your pack, or creatures beside you. A spawned creature is temporary unless the line ends in `keep` (#2623): when it dies its body lies the usual time, then it is gone, and a restart takes it too. Who may use `keep` is `SPAWN_KEEP_WHO` (testers and staff for now) | `gamemode.js:word === '/give'` | The same line |
| `/where` | Testers and dev, refused to everybody else the way `/give` is (#1633) | The cell, position and angle you stand at | The `/where` branch of `handle`, `isPlaytester` | The same line |
| `/kick`, `/freeze`, `/unfreeze`, `/bring`, `/goto <person>`, `/silence`, `/unsilence`, `/warn`, `/spawnat`, and `/give`, `/spawn` and `/tp` aimed at a person | Staff: Owner, Dev, Gamemaster, Moderator, Loremaster, the admins and the dev list, on a proven connection with a join pass | Moderation in the world | The staff block's `command`, from `gamemode.js:if (word === '/kick') {` | The staff block's header; [Voice](voice.md) for silence |
| `/ban`, `/unban`, `/banaccount`, `/unbanaccount`, `/pk`, `/note` | Staff | Bans, a character killed for good, and notes, kept on the site | `gamemode.js:word === '/ban'` | The staff pages on the site (`site/public/hub.js`) |
| `/unpk` | Admins only | Undoes a PK made by mistake | `gamemode.js:if (word === '/unpk') { return unpk(words, pid, me); }` | The staff pages on the site |
| `/embassy`, `/embassy add <name> [armed]`, `arm`, `disarm`, `remove` | Admins only | Shows and writes the embassy roll: 20, of whom 6 may be marked armed; the 21st and the 7th armed are refused (#1390) | `command` in the embassy and remnant block | [The Imperial Embassy](embassy.md), [Offices](offices.md) |
| `/remnant`, `/remnant add <name>`, `remove` | Admins only | Shows and writes the Thalmor remnant roll, once an application is accepted (#1390) | `command` in the embassy and remnant block | [The Thalmor](thalmor.md) |
| `/despawn` | Staff | Takes the creature a spawn command made that is nearest you (within about 20 m, in your cell) out of the world for good, kept or not, alive or dead. Never a creature or person the world put there (#2623) | The staff block's `command`, `removeSpawned` | The staff block's header |
| `/craftstaff pick`, `raise`, `recipe`, `recipes`, `give` | Staff, never on themselves for `raise` and `give` | The crafting card on the Office page of K (#3167): picks somebody in the world, raises one of their ranks one step through the rulebook, says why a recipe is stuck for them and hands their game the craft gate's list when it holds an older one, and gives back an item with a count and a reason. Sent by the card's buttons, never typed | The staff block's `command`, which hands it to `command` in the staff crafting block | The Office page of K; [Professions](professions.md) |
| `/hurt <person> [what]` | Staff | A cut, a bite, a break or a disease for a scene, an agreed loss written down after a yes given out of character, or what somebody carries (#1383) | The staff block's `command`, which hands it to `staff` in the injury and disease block | The staff block's header; [Injury](injury.md) |
| `/restart`, `/shutdown` | Nobody | Answers that restarts are not run from chat | `gamemode.js:word === '/restart'` | Nowhere |
| `/close` (Discord), and the Close ticket button | Staff: the bot's `STAFF_ROLES` (Owner, Dev, Gamemaster, Moderator, Loremaster), by id or name; Manage Threads alone is not staff (#1342) | Closes a ticket, and only in a ticket's own thread; anywhere else it says it only works inside a ticket (#1776) | `close_here`, `is_ticket_thread` and `is_staff` in `bot/bot.py` | Discord's own command list |
| `/test-task` (Discord) | Owner, Dev and Lead Gamemaster (`TEST_TASK_ROLES`) | One thread in the #test-tasks forum, tagged Dev or Main | `test_task_cmd` and `post_test_task` in `bot/bot.py` | Discord's own command list |
| `python bot.py --setup-channels [--apply]` (VPS, by hand) | Whoever runs it on the VPS | The one-time testing channel setup: #test-tasks to a forum, #test-results to #test-findings, #known-issues made; a preview without `--apply`, never twice | `channel_setup` in `bot/bot.py` | `data\channel-setup.json` |

## Lines the game sends itself

Nobody types these, and nothing tells anybody to. They are how the
client reports what only it can see. They stay.

The voice service's chat log, which staff read for a report, leaves out
the ones the front plugin sends by itself (#2723,
`voice/voice-server.js:PLUGIN_REPORTS`): `/joinpass`, `/place`, `/burn`,
`/loadorder` and `/loadorderlight`, `/afk active`, `/face done`,
`/racemenu` and `/racedown`, `/modset`, `/chopped`, `/tspicks`,
`/rest`, and the panels' `refresh`. It writes the ones a key, E, a pick
or a button sends, marked as a key press (#2251; the chat page marks
every line that does not come from the chat box, #2732), and the wait in line
once when it starts and once when it ends (#1131). Every one of them
still reaches the game server, and the same line typed in the chat box
is written as typed.

| Line | Sent by | What it reports | Read at |
| --- | --- | --- | --- |
| `/joinpass <pass>` | The front plugin | The launcher's join pass | `gamemode.js:word === '/joinpass'` |
| `/line`, `/line leave`, `hand`, `gone` | The front plugin at the menu, and the voice service | The line to get in while the world is full | `gamemode.js:word === '/line'` |
| `/afk active`, `here`, `out` | The front plugin | Whether somebody is at the game | `gamemode.js:word === '/afk'` |
| `/face done`, `/racemenu` | The front plugin | The race menu closed, or is up | `gamemode.js:if (word === '/face') {` |
| `/modset` | The front plugin | Mod settings menu values that changed | `gamemode.js:if (word === '/modset') {` |
| `/place`, `/burn` | The front plugin | Where you stand for warmth, and being on fire, which is also timed for a burn wound | `gamemode.js:if (word === '/place') {`, `gamemode.js:word === '/burn'` |
| `/chopped` | The front plugin | A fall of the axe at a chopping block | `gamemode.js:if (word === '/chopped') {` |
| `/loadorder` | The front plugin | The client's load order | `gamemode.js:word === '/loadorder'` |
| `/tspicks <n>` | The front plugin | Lockpicks that broke | `gamemode.js:word === '/tspicks'` |
| `/tspicked <id>` | The front plugin | A property door shut to you opened on its lock, a pick, so its holder is sent word (#2680) | `gamemode.js:word === '/tspicked'` |
| `/moldhere <id>` | U at a door | A key mold pressed into that door | `gamemode.js:word === '/moldhere'` |
| `/claim <id>`, `/lock <id>`, `/unlock <id>`, `/key <id>` | X at a door just opened, or at a forge (#1637) | Claims, locks or unlocks the building of the door just opened; cuts a key from the mold in the pack | The property block's `command`, `forgeHere` |
| `/plot <id>`, `/claim <id>` at a crop | A crop under the crosshair, and X at it (#1636) | Asks for the line at that plot; claims the farm around it | The farming block's `command`, `plotLine` and `claim` |
| `/rest bed`, `/rest sit`, `/rest up` | Lying down, sitting down and getting up | Resting in a bed or on a seat, as the server measures it | `bedRest` in the property block's beds |
| `/sleephere <id>`, `/sleephere stop <profile> <building>` | U on a person inside a building you hold, and Stop on the K panel's property page | Lets them sleep there for a night, or ends their night (#1603) | `sleepHere` in the property block's beds |
| `/problem <what went wrong>` | Send under Report a problem on the help panel (#3155) | A problem for the board: the site takes it with where you are and the open launcher session, and the bot files it as an issue | `gamemode.js:if (word === '/problem') {`, then the asking staff block's `ask` |
| `/dropbox open` | E on a hold's drop box (#2298) | Open the box's panel, filtered for who opened it | `dropboxCmd` in the property block |
| `/stall open <id>` | X at a market stall (#3160) | Open that stall's panel, for who opened it | `command` in the market stalls block |
| `/ride e <id>`, `/merchant e <id>` | E on a driver or a trader | Which one was pressed | `gamemode.js:if (word === '/ride') {`, `gamemode.js:if (word === '/merchant') {` |
| `/party refresh`, `/trade refresh`, `/pick refresh` | A panel as it opens | Send the panel its view | `gamemode.js:if (word === '/party' && rest === 'refresh') {`, `gamemode.js:word === '/trade'`, `gamemode.js:if (word === '/pick') {` |
| `/skill` | The client's unused skills menus | Nothing: the page drops it before it is sent | `game/ui/thornswood-bridge.js:isSkillSpam` |
