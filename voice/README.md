# Proximity voice and chat

## What it is

`voice-server.js` is one file of node with nothing to install from npm; it
carries its own WebSocket code. The game server posts where everybody is to it
five times a second over loopback (`POST /positions`). Every client holds a
WebSocket to it for those positions, for the WebRTC signalling that sets up
voice between two people, and for text chat, which it relays to the room and
writes to `chat\`, one file a day. Slash lines are written there too, a
key's or a panel's marked as a key press, but not the front plugin's own
reports to the game server (`PLUGIN_REPORTS`, `voice\tests\test-2723-plugin-reports.js`).
The audio goes straight between people and
never passes through it. The `test-*.js` files in `voice\tests` are its harnesses
(they sat beside it until 1 Nov 2026, and joined the build check's gate when they
moved there).
It serves no page of its own: its two clients are the launcher's voice page
and the game's overlay, both loaded off disk. The plain browser page it used
to serve at `/` went in #1822, because it had no way to get a join token and
so could never get in. The game server's half of the position feed is the
block between the voice feed markers in `game\gamemode.js`. It reads its port
from `server-settings.json`, so the dev server feeds the dev service. The
older copy of that block that sat here went in #2736, with the deploy script
that wrote it into the gamemode: nothing ran the copy, and the script could
only put the older block back.

A socket opened by a browser has to come from a page loaded off disk, which
says `null` or `file://`: the game's pages and the launcher's voice page. A
page on any website is refused with 403 before the handshake (#1321), this
host included since its own page went (#1822). A client that sends no Origin
is not a browser and is let in.

## On your machine

Run it from a scratch copy, as its harnesses do, not from the checkout: on its
first start it makes `token-key.txt` beside itself, the key that signs join
tokens, and `chat\` once anybody talks. Git ignores both, but a signing key
has no business sitting in a checkout. From the copy:

```
$env:THORNSWOOD_VOICE_PORT = '7900'; $env:THORNSWOOD_VOICE_BIND = '127.0.0.1'; node voice-server.js
```

then open http://127.0.0.1:7900/health. Only a caller on the same machine,
with no forwarding header, gets the whole answer; anything Caddy carries
(https://thornswood.net/voice/health) is told `{"ok":true}` and nothing
more, so the build, the deploy record and the counts below are read on the
box (#3806). It reads `THORNSWOOD_VOICE_PORT`
(7778 when unset), `THORNSWOOD_VOICE_BIND` (loopback when unset since #1304;
`0.0.0.0` answers every interface, and even then `/token` and the handshake
refuse anything that did not come over TLS: straight off the network, or
through a proxy whose `X-Forwarded-Proto` is not https, and a token that came
that way is spent),
`THORNSWOOD_CHAT_RANGE` (off when
unset, though Install-Voice.ps1 sets it on for live and dev: every typed
line goes to everybody; `on` keeps a line to the same cell
and 4000 units, a number sets the units, and /me, /do, /w and /s work),
`THORNSWOOD_CHAT_BURST` and `THORNSWOOD_CHAT_REFILL_MS` (5 and 1500 when
unset: how many said lines one connection gets out at once, and how often it
earns another; slash lines are never counted), `THORNSWOOD_TOKEN_PER_MINUTE`
and `THORNSWOOD_SOCKETS_PER_MINUTE` (20 and 60 when unset: how many token
requests and sockets one address gets a minute before it is answered 429;
behind Caddy the address is the last `X-Forwarded-For` hop, and this machine
itself is never counted, #1323) and `THORNSWOOD_SITE`, the
site `/token` asks whether a Discord ticket owns the profile it wants a join
token for. A connection that cannot prove itself with a token is refused,
and `/token` mints one only when the site says yes: with the site unset, down
or answering anything else, it answers 503 and mints nothing (#1303, #1315).
The token goes with the WebSocket handshake, as the protocol offered after
`thornswood`, and a handshake without one is answered 403 before it is a
socket (#1337). A token opens that one connection and no other and is good
for two minutes (`THORNSWOOD_TOKEN_SECONDS`, 120 when unset), so the
launcher's voice page and the game's chat each ask the launcher for a fresh
one whenever they connect; a token presented twice is refused and written
down as copied (#1322).
`THORNSWOOD_VOICE_MOST` is the most people who hold a voice place at once
(#481): on the roster, sent the roster, and let trade signalling. Only
somebody the game server's position feed has in the world holds one
(#3570: voice is proximity only, so nobody at the menu could be heard). Every socket a join token proves is let in and carries text chat and
commands, so somebody waiting in line at the menu has the chat socket that
says "/line" and no voice place, is on nobody's roster and is sent none. A
place is the profile's, so a person's voice page and chat, and a reconnect
overlapping the socket it replaces, share one; it is taken the moment the
feed has them in the world, and when the feed drops them their own pages are
sent an empty roster so they let go of every connection. Somebody in the
world past the number keeps text chat, is told once in one chat line that
voice is full, and takes a place when one frees; `/health` gives `most`,
`people` (places held) and `refusedFull` (kept off voice for numbers). Unset
or 0 is no cap. Install-Voice.ps1 sets it from `voice` in
`records\most-online.json` (its `dev` object's for `C:\Thornswood-Voice-Dev`),
which is never fewer than that server's seats, so everybody seated has a
place. `test-most.js` and `voice\tests\test-3570-voice-line-room.js` cover it. `load-voice.js` is not a harness: it
plays an evening at a copy of the service with no people (two sockets each, a
join storm, the WebRTC signalling for every pair, walking and talk) and prints
what the service cost at each size, which is where that number came from.
It sends every message from its own one thread, so past a hundred or so
people its signalling time is its own; `load-signalling.js` measures what the
service itself takes to relay a full room's signalling (#2390).
The joins and leaves one turn of the event loop handles share one roster, so
a restart that brings every page back at once costs each socket a few
rosters rather than one per arrival (#2332, `test-roster-once.js`).
What one turn sends a socket goes to the kernel in writes of about 16 KB
rather than one write a message (#2390): at 200 people, every pair trading an
offer, an answer and six candidates each way took the service 5.5 to 6.0 s
before and 2.4 to 2.6 s after, measured with `load-signalling.js`.
`THORNSWOOD_CAPTIONS` (off when unset) is voice shown as words above the
speaker's head (#2475). The words are made on the speaker's own machine and
only the text comes here, as `{ t: 'caption', text }`; with it `on`, a
caption goes to the speaker and to the people in the same cell within the
reach of the speaker's voice mode (7, 30 or 85 metres), and only after the
speaker said `{ t: 'captions', share: true }` and while their talk key is
down or was up less than two seconds ago. `{ see: false }` stops a person
getting anybody's, a text mute stops that speaker's, staff silence stops all
of the speaker's, and none is written to the chat log or the service log.
`/health` gives `captions`: whether it is on, how many went out and how
many did not, and the settings below.
`THORNSWOOD_CAPTION_TAIL_MS` (2000), `THORNSWOOD_CAPTION_BURST` (3),
`THORNSWOOD_CAPTION_REFILL_MS` (1000), `THORNSWOOD_CAPTION_REACH` (unset: the
voice reach; a number of units caps it, never past the voice reach) and
`THORNSWOOD_CAPTION_TEXT_MUTE` (`off` leaves captions to the voice switch
alone) tune it without a release. Nothing sends one yet, so every service is left without it
until the questions on #2475 are decided.
`voice\tests\test-2475-voice-captions.js` covers it.
`THORNSWOOD_VOICE_AUTH`, which once let unproven joins in, is not read any
more. `/health`
reports
the `BUILD` string at the top of the file, which is the only way to tell from
outside which copy is running, so change it whenever behaviour changes. The
harnesses run the real file in a temporary folder on a port the system hands
out, and ask it nothing until that copy has said it is listening there,
because several builds run at once on the VPS and a fixed port let one run
answer another (#1703). They need nothing else. Most put their own
`token-key.txt` beside their copy and sign the tokens they join with. A
harness that joins the moment its copy is up asks that copy's `/token`
instead, with a small site of its own that says yes, as `test-auth.js` does
(`test-local-chat.js`, `test-1351`, and `test-1304` and `test-1821` in
`tests`): on Windows two node processes can read the wall clock a few ms
apart, and a token signed in the harness then can read as minted before the
service started, which it refuses (#1867).
`node voice\tests\test-auth.js` and the rest.

A TURN relay, for the pairs of people who cannot reach each other directly,
is `THORNSWOOD_TURN_URL`. Its key is `THORNSWOOD_TURN_SECRET` or, so it stays
off the command line `Install-Voice.ps1` builds, `turn-key.txt` beside the
service, put there by hand. Unless both are there, `/ice` offers STUN only; with
neither, `/health` says `turn: none`, which is how every box runs today.
`Install-Voice.ps1 -TurnUrl` sets the address. `test-turn-key.js` covers it.
The pages in the room get the list on every roster (`{ t: 'peers', peers,
iceServers }`), over the socket their join token proved, which is when they
build their connections, so the relay comes with it however long they have
been in (#1821). `/ice` hands the relay only to this machine itself, which is
how `Install-Voice.ps1` reads the running relay; anybody else, token or none,
gets the STUN list (#1307).

## Where it runs

On the VPS beside the game servers: the live service in `C:\Thornswood-Voice`
on 7778, task `Thornswood Voice`, and the dev one in `C:\Thornswood-Voice-Dev`
on 7789, task `Thornswood Dev Voice`. Caddy carries
https://thornswood.net/voice/ and /voice-dev/ to them. What it carries comes
from loopback as the gamemode does, so the gamemode's routes (`/positions`,
`/commands`, `/silenced`, `/textmute`, `/say`) also refuse any request with a
forwarding header on it, which Caddy always sets (#1797). Its clients are the
launcher's hidden voice page (`launcher`), the in-game overlays
(`game\ui`) and the two gamemodes. The bot pass before every dev
Deployment runs a copy of its own beside its server copy, and its bots join
it the way the chat page does (`scripts\bot\relay.js`, #5196). `.\scripts\deploy\Install-Voice.ps1` copies
`voice-server.js` and `headlines.js`, restarts the task and waits
for `/health` on the box; the dev service is the same script with
`-Root C:\Thornswood-Voice-Dev -Port 7789 -TaskName 'Thornswood Dev Voice'`.
`Go.ps1` without `-SkipServer` also copies this file over the live one and
restarts it.
