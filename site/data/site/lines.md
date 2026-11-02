# Hints and lore lines

This is the one copy of Thornswood's hints and lore lines (#3147).
Everything that shows a hint or a line of lore takes it from here, so a line
changed here changes everywhere at the next deploy:

- the site's front page shows one lore line under The World, picked at random
  each time the page is served (`site\server.js`, `readLines`);
- the site hands the lot out in `/api/public` as `lines`, and the Discord bot
  shows one of them as its status, a new one every fifteen minutes
  (`bot\bot.py`, `watch_lines`);
- the in-game loading screen shows one hint, a new one at every load
  (`game\ui\thornswood-loadscreen.js`), from the copy `scripts\release\Go.ps1`
  writes into the game folder at every Ship (`Write-ThornswoodHints`), so a
  hint changed here reaches the game with the next release (#3130).

This is not a page: no address serves it. `Deploy-Docs.ps1 -Site` sends it
with the public pages, and the bot reads it from the site, so a new line
needs no bot install.

The rules, which `site\tests\test-3147-lines.js` checks:

- one line each, a dash and the line, plain text with no bold, links, code or
  HTML, because a status line and a loading screen show none of it;
- 128 characters at most, the most a Discord status holds;
- a hint is true on main, in the words people use; the
  [help page](/help) has the long form;
- a lore line is a quote, word for word, with its source on the line under
  it, indented two spaces. The source is "Fifty Years of a Free Skyrim" (the
  account at the top of the [world page](/world)), "The White Harbour Accord,
  Article the" and its number (that article on the world page), or "The
  Factions of Skyrim" (`lore\factions.md`). The test finds each quote in its
  source, so a line cannot drift from the lore it quotes.

## Hints

- Press K for your character panel. Your profession, your class and your Home town are chosen there.
- Press F7 for the help in the game, with the keys as you have them set.
- Enter opens the chat, and / opens it with the slash already typed.
- A line in the chat reaches the people within about 60 metres of you, not the whole server.
- Hold V to talk, or press O to keep the microphone open until you press it again.
- B steps your voice between a whisper, your normal voice and a yell.
- Voice runs in the launcher, so leave the launcher open while you play.
- Press G for the emote wheel. N stands you up out of an emote.
- Looking at somebody, Y asks them to be friends and H offers them a trade.
- P opens your friends and party, and J your journals.
- U presses a blank key mold into the lock of the door you are looking at.
- F1 turns the names over heads off and on, and F2 hides and shows the overlay.
- /me says what your character does, and /do what there is to see. Whether a /me lands is the other person's to say.
- /w whispers a line to the people closest to you, and /s or /y shouts it further.
- /roll 20 rolls a twenty sided die. The server rolls it, and the people near you see the result.
- Something wrong in the world? Type /helpme and a few words, and staff are told where you are.
- Wedged in a rock? /stuck takes you back to where you last stood safely. It works once every 5 minutes.
- There is no saving. The server holds your character, so quitting is safe.
- No levelling, no fast travel, and the difficulty is fixed at Expert.
- Sleeping and waiting do not move the clock. Time runs at the server's pace for everybody.
- Menus do not pause the world. The inventory, the crafting menu and the map all keep it running.
- When you die, you wake at the temple of the hold you died in.
- Text chat is kept, with the name and the time. Voice is not recorded.
- Settings, on the help panel (F7) and the K, P and J panels, changes any key, and it works at once.
- Turned away with LOAD ORDER ERROR? Close the game, open Diagnostics in the launcher, press Scan, then Fix.
- Diagnostics, Build the report makes one zip of your logs to drag into your ticket in the Discord.
- When the countdown says restart, the server is going down. Get somewhere safe and log out before it ends.

## Lore lines

- The terms were short. Skyrim would govern Skyrim. Imperial soldiers would leave by the first thaw.
  Fifty Years of a Free Skyrim
- The Empire kept its claim on paper and nothing else.
  Fifty Years of a Free Skyrim
- The Thalmor have been illegal in Skyrim for forty-three years, and some of them are still here.
  Fifty Years of a Free Skyrim
- The Empire could not come back with soldiers, so it came back with trade.
  Fifty Years of a Free Skyrim
- The Empire wanted the province. It got a warehouse. Skyrim wanted the Empire gone for good. It got grain.
  Fifty Years of a Free Skyrim
- The signs over the old doors still say East Empire in places, and the Company has not painted them over.
  Fifty Years of a Free Skyrim
- The crown sits above the holds and below nothing. There is no Emperor over it.
  Fifty Years of a Free Skyrim
- The roads are safer than they were, and still not safe. The mines are running.
  Fifty Years of a Free Skyrim
- There is an embassy in Solitude flying a flag that used to fly over all of this.
  Fifty Years of a Free Skyrim
- Plenty of people alive today remember the war.
  Fifty Years of a Free Skyrim
- The embassy is not a country. Its walls are a courtesy, not a border.
  The White Harbour Accord, Article the Fourth
- If the Empire wants a man, it asks the Jarl. If Skyrim wants a man out of the embassy, it asks the Ambassador.
  The White Harbour Accord, Article the Fourth
- Knowledge of Dominion agents shall be shared freely and without price.
  The White Harbour Accord, Article the Fifth
- Neither party shall arm, pay, or shelter bandits against the other. Both parties have broken this one.
  The White Harbour Accord, Article the Seventh
- The Greybeards take nobody.
  The Factions of Skyrim
- A veteran of either side is a person with a past, not a member of a faction.
  The Factions of Skyrim
