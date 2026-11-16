# Help

## Getting in

<!-- alpha -->
Thornswood is in alpha and is eighteen and over, and the world is open by
application. Anyone can install it. Come into the Discord, open a ticket and
pick **Apply to be an alpha playtester**. It asks whether you are eighteen or
over and whether you accept the [rules](/rules). When you are accepted you are
given the Playtester role, and that role is what unlocks Play. The
[join](/join) page says more.
<!-- /alpha -->
<!-- open -->
Thornswood is open and is eighteen and over. Anyone can install it, and
anyone in the Discord can play. Being there means accepting the
[rules](/rules). The [join](/join) page has the whole of it.
<!-- /open -->

## Installing it the first time

You need **Skyrim Special Edition** on Steam, on build **1.6.1170**, and
**Vortex** with a free Nexus Mods account. Nothing else has to be installed
first. Anniversary Edition is not required.

Where Thornswood's files go is one box in the install window, **Give
Thornswood a Skyrim folder of its own**, and it starts ticked. Left ticked,
Thornswood writes nothing of its own into your Steam copy: once Vortex has deployed, the launcher
builds a game folder of its own, `Game` in the install folder on the same
drive as Skyrim, out of your Steam copy and what Vortex put into it. Most of it
is hard links to your own files, which take no extra space, and the few files
other programs rewrite are real copies. Unticked, Thornswood's own files
go into your Steam copy, with a list of what went there, and the launcher asks
before it builds the folder. Vortex keeps the mods in a profile of their own,
so switching back to your usual profile and running Purge Mods leaves your own
Skyrim the way it was.

1. From the [Downloads](/downloads) page take the installer. One file. Run it.
   It fetches Thornswood's own content while you watch, about half a gigabyte,
   and puts the launcher, the script extender and Thornswood's content into
   your Skyrim.
2. Open Thornswood from the desktop shortcut. If your Skyrim is newer than
   1.6.1170, which most copies are, a card on the front page says so. Press
   **Downgrade** and Steam downloads that build under your own account. It is
   a few gigabytes, so give it a while.
3. Install the collection in Vortex. The link is on the Downloads page and on
   the launcher's Diagnostics page, and it opens the revision the server was
   built against. Install that revision, not a newer one Nexus may show first.
   Not optional: without it you have a launcher and no mods, and the server
   turns you away when you press Play. Some of the collection's mods are
   marked adult, so first turn on adult content in your Nexus Mods settings,
   or Nexus shows the collection as hidden. On a free account Vortex opens
   each file's page on Nexus and you press **Slow download** there, once for
   each file: 120 files, from 111 mods.
4. Press **Connect Discord** at the bottom of the launcher's left sidebar,
   above Settings. Your browser opens, you say yes, and it closes itself. You
   never do this again.
<!-- alpha -->
   It works once your application has been accepted; before that it says
   your account has not been accepted into the alpha yet, and applying is the
   fix.
<!-- /alpha -->

## When the mods need updating

The mods are a collection on Nexus, and the collection has revisions. When the
server moves to a new one, the launcher says **Your mods need updating** above
Play and names the revision.

Close the game and press the card's **Update in Vortex** button. It brings
Vortex forward. Select the Thornswood profile there, open Collections and
press Update on the Thornswood collection, which puts the new revision in
place of the old one. Do not install the new revision from Nexus: a
collection that comes in by a Nexus link is added beside the one you have,
and the two fight over the same files. Let Vortex finish installing and
deploying it,
then open the launcher and let its own update finish before you press Play.
The collection brings the other authors' mods; the launcher brings
Thornswood's own files.

If the launcher reports a plugin mismatch after that, open **Diagnostics**,
press **Scan**, then **Fix**.

## When your mods are ahead of the server

If the launcher says **The server has not caught up with you** and Play reads
**WAITING FOR THE SERVER**, your collection is on a newer revision than the
one the server was built against. Nothing is wrong with your install and
nothing needs installing. Play opens once the server is rebuilt on your
revision. Say so in the Discord if nobody has.

## When the collection shows as hidden

If the collection's page on Nexus says it is hidden or cannot be found, or
Vortex cannot open it, the Nexus account you are signed in with has adult
content turned off. Some of the collection's mods are marked adult, and Nexus
hides the collection from an account that has not turned it on. Turn on adult
content in your Nexus Mods settings, signed in with the same account Vortex
uses, then open the link from the [Downloads](/downloads) page again. In some
countries Nexus asks you to verify your age first.

<a id='defender'></a>

## Why does Windows or Defender warn about the installer?

The installer is Authenticode-signed (Azure Artifact Signing). Most of the
time Windows lets it through without a fuss.

A brand-new build can still get a soft SmartScreen ask once in a while,
because reputation follows the file hash and a fresh hash has none yet. If
Windows shows a blue **Windows protected your PC** box, press **More info**
and then **Run anyway**. The publisher should not show as Unknown.

Do not turn Defender off and do not add an exclusion for the installer. Check
the file instead: every build's SHA-256 is printed on the
[Downloads](/downloads) page next to the button.

## Starting it after that

Open Thornswood from the desktop shortcut. Not Skyrim, not Steam, not SKSE.
The launcher checks for updates, patches anything that changed, and the Play
button starts the game and connects you. There is no password to type and no
address to enter.

If an update is waiting, the launcher takes it before it lets you play. That is
on purpose: everybody has to be running the same files or nobody can connect.

The launcher also compares every plugin with the server's copy, byte for byte,
when it starts. If one differs it says so. See LOAD ORDER ERROR below.

## Your first character

The game loads to its main menu and lists your characters, with an empty slot
for a new one. Pick the empty slot to make a character. Nothing about a
character is chosen in the launcher.

Give your character a name that belongs in Skyrim: a first name and a family
name or a byname, and not your own. That name is what other people see above
your head, and it cannot be changed later without a new character.

You arrive dressed in a plain tunic and boots in a quiet stone hall.
The race menu opens there to make your face, with your clothes kept on as you
change race. When you are done, the panel behind **K** opens by itself. That panel is
where the rest is chosen: your profession and the half of it you will make your
own, your class, and your Home, the town you start in. Those are the choices
on the [Professions](/classes) page.

Only the town has to be chosen before you leave the hall. Your class and
profession can wait, and can be picked later in the world from the same panel.
Press **Confirm** on the Review page and you are sent to a quiet spot in or
near the town you chose, not its inn.

You start with forty gold, once, and nothing else is handed out, except a tool
to the nine picks whose work needs one: a Miner is handed a pickaxe, a
Woodworker a woodcutter's axe, a Farmer a shovel and seed to sow, a Fisher a
crude fishing pole, a Smith a hammer, a Tailor a pair of shears, a Cook a
wooden ladle, an Alchemist an alembic and an Enchanter a rune knife. Each tool
is handed over at the moment its pick is made.

## Keys

These are the keys a fresh install has. Every one is changed in the game, on
**Settings** at the foot of the help panel and of the K, P and J panels: press
Change beside it, then the key you want. It takes effect at once.

- **Enter** opens the chat, and **/** opens it with the slash already typed.
- **K** your character panel, **P** your friends and party, **J** your journals.
- Looking at somebody: **Y** asks them to be friends, **H** offers a trade, **L**
  stops you hearing them. A friend request, a party invite, or a trade offer
  shows on their screen with Accept and Refuse.
- **V** held to talk, **O** keeps the microphone open until you press it again,
  **B** steps between a whisper, your normal voice and a yell.
- **G** opens the emote wheel. Eight quick slots sit in the middle, and the
  rest of the emotes are a list you can search. **Tab** moves to that search.
  **N** stands you up out of an emote. While the wheel is open, **1** to **8**
  play a slot. With it shut they are Skyrim's own favourites hotkeys.
- **U** presses a blank key mold into the lock of the door you are looking at.
- **F7** opens the help in the game, without the chat: talking, people, living,
  work, land and getting help, with the keys as you have them set. Help on the
  K, P and J panels opens it too.
- **F1** turns the names over heads off and on, and **F2** hides and shows the
  overlay.

## Talking

A line typed in the chat reaches the people near you, in the same place and
within about 60 metres, the same as the line drawn over your head. Treat it as
the room rather than the whole server. Text chat is kept, with the name and
the time. Voice is not recorded.

A few ways of saying a line are typed at the start of it:

- **/me** and what your character does, or **/do** and what there is to see.
  **/me** draws a sword is an attempt: whether it lands is the other person's.
- **/w** whispers it to the people closest to you, and **/s** or **/y** shouts
  it further.
- **/ooc** and what you meant, out of character, in double brackets with your
  name on it. `/ooc can we not` ends any scene at once; the [rules](/rules)
  say what that means.
- **/roll 20** rolls one twenty sided die, and **/roll 6x3** three six sided
  ones. The server rolls it, and the same people /ooc reaches see the result.

Everything else you do in the world is a key, a button or a panel, never a
line in the chat.

## Dyeing your hair

A Tailor (Haberdasher or Liverywright) steeps hair dye at a cooking spot.
Anyone can use one: on yourself from the **K** panel, or on someone else once
they accept.

If you are a Tailor, carry a bottle of water and what the dye needs, press
**E** on the cooking spot, and stay by the fire until the dye is done. Walk
away before then and nothing is made or used. The dye goes into your pack,
under its own name. Anyone who is not a Haberdasher or Liverywright and
tries it is turned away and keeps everything they carry. They are told:
"Steeping hair dye is work for a Haberdasher or Liverywright. Nothing was
taken from your pack."

To dye your own hair, open the Hair dye page of the **K** panel and press Dye
my hair. To dye somebody else's, look at them and press **K**, then Offer to
dye, or press Dye hair beside them under Near you on the **P** panel. With
more than one dye in your pack, that button names the dye. They get Accept
and Refuse, and nothing is used or changed until they press Accept. Hair,
beard and brows take the one colour, and it stays until it is dyed again.

## Voice

Voice runs in the launcher, not in the game. Leave the launcher open while you
play.

Hold **V** to talk, or press **O** to keep the microphone open for a song or a
long speech. **B** steps between a whisper, about 7 metres, your normal voice,
about 30, and a yell, about 85. **Diagnostics** on the launcher says whether
the server's voice is answering.

If nobody can hear you, check that the launcher is still open and that Windows
has not handed your microphone to something else.

## Getting staff in game

Type **/helpme** and a few words about what is wrong. Anybody from staff in the
world is told at once, with where you are, and it goes to the staff channel in
the Discord. **/report**, the person's name and what they did, reaches staff and
nobody else. The game tells you whether it got through; if it did not, open a
ticket in the Discord.

Wedged in a wall or a rock and cannot walk out? Type **/stuck**. It takes you
back a few steps to where you were last standing safely, or to the nearest
temple when there is no such spot. It works once every 5 minutes, not while you
are dead, and in a fight it waits 15 seconds first, which moving or being hit
cancels. It is only for being truly stuck: every use is logged for staff, and
using it to get out of a fight or to travel can mean a warning or a ban.

## When something goes wrong

1. Look at [Known Issues](/known) first. It lists what is broken right now
   that the team already knows about.
2. If it is not there, [report it](/report). One line about what happened is
   enough to start with.
3. If you have a screenshot or a crash log, drag it into your ticket in the
   Discord, or say in the report that you have one. Where the logs are is below.

A launcher last opened before 26 September says it cannot read the update
source, or never offers an update. Updates are asked for at thornswood.net now
(the site may send the launcher on to GitHub for the files themselves), and a
launcher that old still looks for them where they used to be, so it
cannot find the new place by itself. Take the installer again from the
[Downloads](/downloads) page and run it over your install. Your characters live
on the server and nothing is lost.

## LOAD ORDER ERROR

The game compares every plugin with the server's at login: the same names, in
the same order, with the same bytes. If one differs you are turned away with
that message.

Close the game, open **Diagnostics** in the launcher and press **Scan**. It
names the plugin that differs. Then press **Fix**, and press Play again. When
the plugin that differs is another author's mod, Scan and Fix name the mod to
update or reinstall in Vortex: Fix only has a copy of Thornswood's own
plugin, from the latest release, and nobody else's.

What Fix does: it puts your plugin list in the server's order, puts back
plugins Vortex has that the game folder lost, downloads Thornswood's own
plugin from the latest release when its bytes differ from the server's, names
the mod to update or reinstall in Vortex when another author's plugin differs,
and moves another server's files and stray Creation Club plugins aside, never
deleting them.

Scan also looks at the rest of the install: an update waiting, Thornswood's
game folder behind what Vortex has deployed or missing files, this build's own
files changed, Windows' Skyrim folders left pointed at Thornswood after a
crash, the shortcut icon, the multiplayer client, Steam and the Skyrim build.
Fix puts right everything it can, bringing the game folder up to date from
Vortex first and taking a waiting update last. Then it looks again and says
only what is still wrong, why, and what will put it right.

If Scan says a plugin is missing rather than different, the collection is not
fully installed or the wrong Vortex profile is active. The launcher says which.

## Where the logs are

The launcher's own log, for anything that went wrong before the game started:

```
C:\Thornswood\Profile\launcher.log
```

Crash logs, if the game closed itself, are in Thornswood's own My Games
folder:

```
C:\Thornswood\Profile\MyGames\SKSE\
```

The easy way to send them: in the launcher open **Diagnostics** and press
**Build the report**. It makes one zip with the newest crash log, the script
extender log, your plugin list and the launcher log, and opens the folder it
is in. Drag that zip into your ticket in the Discord. **Settings**, **Open log**
opens the launcher log on its own.

You often do not need to: when the game closes, the launcher sends the site
that session's logs on its own, so staff may already see what went wrong.
The [privacy](/privacy) page says which files go and what is in them.

## When you die

You wake at the temple of the hold you died in. A hold with no temple of its
own sends you to the nearest temple or Hall of the Dead, and anywhere on
Solstheim sends you to Raven Rock. Nobody else can end your character without
your agreement; the [rules](/rules) say how that works.

## Restart warnings

A countdown in the chat and on screen comes first. A notice means the world
freezes for a few seconds and your game does not close. For an update, your
launcher closes the game when the count runs out, installs it and puts you
back in, unless it already has it. A restart means the server is going down:
get somewhere safe and log out before then.
