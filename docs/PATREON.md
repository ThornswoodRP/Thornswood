# Patreon, every word to paste

The words for Thornswood's Patreon page, pasted into Patreon by hand. This is
the one copy: the page on Patreon is set from it, and
`site/tests/test-998-patreon-copy.js` holds it to the site's open switch and
to what the bot's join panel says (#998), and to what the Patreon pays for
(#2828). It lived on the hub's to do board until the hub's boards went
(#4359).

Once the tiers exist, Patreon hands out the Discord roles by itself and
nothing in our code touches it.

## The page blurb

Settings, then the page editor. Tagline first, then the long one. Check the
last line of About against the open switch whenever it changes.

Tagline:

```
A modded Skyrim roleplay server. Fewer NPCs, more people who matter.
```

About:

```
Thornswood is a modded Skyrim co-op roleplay server set in 4E 252, fifty years after the civil war. The Stormcloaks won. Skyrim has a High King and no Emperor above him. The Thalmor are a criminal remnant, hunted rather than feared.

The world runs with fewer NPCs than vanilla, not none. Enough that a hold still feels lived in at three in the morning, few enough that the person standing next to you is actually a person.

The server is free and always will be. Patreon pays for the server, the domain, and other expenses of keeping it running, never for anybody's time making mods.

Nothing here affects what happens in the world. No gold, no gear, no skills, no land, no favours.

Thornswood is in alpha, and the world is open by application in the Discord. Anyone can download it at thornswood.net.
```

The last line of About follows the site's open switch (#428, #998). While the
alpha is open by application it is the line above. The day the switch is on
and anyone in the Discord can play, replace that last line with:

```
Thornswood is open: anyone in the Discord can play, and anyone can download it at thornswood.net.
```

## The tiers

Monthly membership, not per creation. No shipping, no physical goods. Each
tier's name has to match its Discord role exactly, because the connection
matches on it.

Milk Drinker, $3:

```
Keeps the lights on. You get the Milk Drinker role in Discord, a patron colour on your name, and one extra character slot on top of the base allowance. Your name goes on the credits page at thornswood.net.
```

Talos Worshiper, $7:

```
Everything in Milk Drinker, plus two extra character slots instead of one, priority on support tickets, and the patron channels where things get shown off before they ship. You get a say in what gets built next.
```

Thalmor Boot-Licker, $15:

```
Everything in Talos Worshiper, plus four extra character slots, first look at test builds, and your name on the credits page under its own heading. You also get to live with the name you chose.
```

## Connecting it to Discord

1. Connect Discord to Patreon. This is the part that hands out the roles on
   its own. In Patreon: **Settings**, then **Apps**, then connect
   **Discord**. https://www.patreon.com/dashboard
2. Point each tier at its role, per tier, not once for all three. Still in
   Apps, under Discord: pick the Thornswood server, then set each tier's role
   to the role of the same name.
3. Tell the site where it is. This puts a real Patreon link in the nav and
   the footer instead of the Support page:

   ```powershell
   .\scripts\deploy\Set-DiscordLogin.ps1 -Patreon https://www.patreon.com/<your page> -NoSecrets
   ```

   Paste the real page address in place of the last part. The nav and the
   footer switch from Support to Patreon straight away.
4. Check it: subscribe to the bottom tier for a month, watch the role land,
   then cancel. https://www.patreon.com/thornswood
