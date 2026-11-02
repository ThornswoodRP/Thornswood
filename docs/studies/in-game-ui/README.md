# Voice, chat, emotes and the in-game UI without a browser: the options (#3208)

Asked for on 21 Oct 2026: "see if there is a better way to do the voice than
webview thing", "also for emotes, textchat, etc", each option with "pros and
cons as well so I can decide", and "I dont care how hard it will be to
translate I want whatever is best"; where options are the same for the people
who play and differ for the team, that difference is included. So the rule
for the pick is the issue's:
the one-time cost of rewriting or translating code is never a criterion and
never a tiebreaker; what the people who play notice comes first; where two
options are equal for them, the differences for the team decide (upkeep,
build speed and tooling, debugging and testing, hosting, signing and running
costs, and how well Claude threads work in it).

Patrick picked both recommendations on the report page on 26 Oct 2026:
**V3** for voice and **U4** for the rest of the UI
([#3208](https://github.com/EvilPatrick06/Thornswood/issues/3208#issuecomment-6422741408),
docs/DECIDED.md). The work each pick needs is filed on the board (the last
section).

## Where things stand today, measured

### Voice

| | Today | Where it is read |
|---|---|---|
| Who holds the microphone | The launcher, in a hidden WebView2 window that loads `launcher/voice-host.html` | `launcher/app/Voice.cs`, head comment |
| Why it left the game | The in-game browser has no permission prompt, an autoplay rule nobody can click past, and a focus flag that takes the keyboard. "Audio never once did" work there | the same comment |
| How sound travels | WebRTC, machine to machine. Every launcher builds a connection to **everybody in the room**, and its one microphone track rides every connection; push to talk only turns the track on and off | `voice-host.html` `open()`, `applyMicTrack()`; `voice-server.js` "every page builds a connection to everybody on the roster" |
| Who hears what | Each launcher works out distance from the positions the service sends and sets that person's level; nothing is decided by the server | `voice-host.html` `place()` |
| NAT | STUN only; the service can hand out a TURN relay but none runs (`/health` says `turn: none`) | `voice/README.md` |
| Echo and noise | Chromium's own echo cancellation, noise suppression and gain control (`getUserMedia` with all three on) | `voice-host.html` `openMic()` |
| Volume Mixer | "Microsoft Edge WebView2", not Thornswood; turning it down there turns down every WebView2 program (#3207, comment on this issue) | WebView2Feedback#2236 |
| The game's own voice code | `game/ui/thornswood-voice.js` still carries a full WebRTC client, used only when no launcher has the audio, and audio never worked there | `docs/systems/voice.md` |

### The in-game browser

| | Today | Where it is read |
|---|---|---|
| Browser | Skyrim Platform's "tilted" backend: CEF 108.4.13, which is **Chromium 108.0.5359.125** (December 2022) | `engine/skymp` `overlay_ports/cef-prebuilt/portfile.cmake` |
| Process | Out of process, `SkyrimPlatformCEF.exe.hidden`, drawn into the game each frame | `launcher/app/Chars.cs` WriteBrowserBackend |
| Other backend | The fork can also run the NirnLab UI Platform (CEF too, 356 MB, another server's framework, kept out of our packs) | `BrowserApi.cpp`, `scripts/release/Ship-Rules.ps1` |
| What runs in it | Character choice, chat, emote wheel, voice overlay, K, P, J, trade, repair, treat, furniture, ride, box, help, board, merchant, ship, maneuvers and the away window: 20 scripts and the page, about 13,000 lines | `game/ui`, `game/plugins/thornswood-front.js` `OVERLAYS` |
| Input | While the browser has focus the game gets no keyboard and no mouse (`DInputHook`). One arbiter in the front plugin decides focus every frame from named claims | `thornswood-front.js` "focus" block |
| Controller | None of the overlays reads a gamepad | `game/ui` |

What the focus layer has cost, from the board: #373, #389, #528, #898,
#958, #1559, #1569, #1675, #1852, #1917, #1920, #2635 (only Task Manager
closed the game) are closed input and focus faults, and three repairs over
causes nobody has found are still open as band-aids: #2131 (the fork puts
focus back on a timer), #2384 (the front lowers and raises focus on every
panel claim) and #2729 (the character choice raises focus four times a
second).

What Skyrim Platform already offers without a browser, read in the fork
(`skyrim-platform/src/platform_se/codegen/convert-files/skyrimPlatform.ts`):
`Ui.openCustomMenu(swfPath, flags)` opens a Scaleform menu of our own,
`Ui.invokeString`, `invokeStringA`, `invokeInt` and the rest call into it,
`Ui.setString` and `getString` read and write it, and the `modEvent` event
brings back what the menu sends with `skse.SendModEvent`. So a native Skyrim
menu driven from the same plugin JavaScript needs no new engine code.

## What was measured for this study

All in a cloud session on 26 Oct 2026, Linux, 4 cores. The scripts are in
[measure](measure) and run again with the commands at their top.

### Today's voice, by the size of the room

[measure/voice-mesh.js](measure/voice-mesh.js) runs the real `voice-server.js`
on loopback, a small TLS front for it, and the real `launcher/voice-host.html`,
unchanged, in Chromium off disk with the launcher's own switch for mDNS. One
page talks, in a Chromium of its own; everybody else is a page in a second
one. It reads what the talker's connections send (`getStats`) and the
processor time of the talker's Chromium, with push to talk up and then down.

| Room | Connections up | Talker upload, push to talk up, kbit/s (RTP / all) | Talker upload, talking, kbit/s (RTP / all) | Per connection, up / talking, kbit/s | Packets sent a second | Talker Chromium CPU %, up / talking |
|---|---|---|---|---|---|---|
| 2 | 1 of 1 | 25.6 / 32.9 | 35.5 / 42.9 | 32.9 / 42.9 | 50 | 14.9 / 13.7 |
| 4 | 3 of 3 | 76.7 / 98.8 | 107.8 / 129.9 | 32.9 / 43.3 | 152 | 24.9 / 22.1 |
| 8 | 4 of 7 | 102.1 / 131.7 | 144.4 / 173.6 | 32.9 / 43.4 | 202 | 31.4 / 26.6 |
| 12 | 7 of 11 | 179.5 / 228.6 | 247.1 / 297.4 | 32.7 / 42.5 | 354 | 46.1 / 37.0 |

A room of 16 ran past the session's time limit with 8 of 15 connections up,
and is not in the table. "All" is the transport's own count (RTP, SRTP, DTLS
and STUN). The processor time includes Chromium's fake microphone and is this
machine's, for comparing rows, not a number for somebody's PC; it grows by
about three points per connection here.

What it shows:

- **Every connection costs the same, so a person's upload grows with the
  room.** About 33 kbit/s per other person while nobody talks and about
  43 kbit/s while talking, RTP and transport together. A room of 50 is about
  1.6 Mbit/s up and the same down for every person with voice on, all the
  time; 200 is about 6.5 Mbit/s.
- **Silence is sent at full packet rate.** With push to talk up the track is
  turned off, and Chromium then sends 50 packets a second of encoded silence
  on every connection: idle upload is three quarters of talking upload.
  #3429, because it costs people bandwidth today whatever is picked here.
- **Some pairs never connect, and nothing says so.** Most runs from four
  people up left pairs unconnected: of the talker's own connections, 3 of 7
  at eight people, 4 of 11 at twelve, and 7 of 15 at sixteen stayed at ICE
  state `new` on both sides, with the descriptions exchanged. Every new pair starts with both
  sides offering at once; in every pair that failed, the side that gave way
  sent the other no candidates. The page only reports `failed`, which never
  comes, so those two people simply never hear each other. Measured here on
  loopback in headless Chromium, not yet on Windows: #3430.

### A box that forwards each voice to the people in range

[measure/box-forwarder.js](measure/box-forwarder.js) is the other design: one
WebRTC connection from each person to the box, and the box copies each packet
from a talker to the people in range, rewriting only the stream id. It uses
libdatachannel through node-datachannel 0.33.4 (MPL 2.0), the same native
library a launcher without a browser would use. The talker is a native client
sending one Opus-sized packet (80 bytes, 32 kbit/s) every 20 ms.

| Listeners in range of one talker | Connections up | Box CPU % of one core | Talker CPU % | Packets forwarded a second | Packets received a second | Box upload kbit/s |
|---|---|---|---|---|---|---|
| 10 | 11 of 11 | 3.2 | 1.9 | 494 | 494 | 514 |
| 50 | 51 of 51 | 6.2 | 2.0 | 2,466 | 2,466 | 2,564 |
| 100 | 101 of 101 | 10.0 | 2.0 | 4,936 | 4,936 | 5,134 |
| 200 | 201 of 201 | 17.7 | 1.8 | 9,882 | 9,882 | 10,277 |

The box's upload is counted from the packets it forwarded, at 130 bytes each
on the wire (RTP header, 80 bytes of Opus, the SRTP tag, UDP and IP).

What it shows:

- **Every connection came up, every time.** The box makes the offer and the
  client answers, so the collision behind #3430 cannot happen.
- **The talker's cost does not grow with the room.** One stream up, about
  2% of a core here for the native client, against Chromium's 14% for the
  page with one connection (that number includes the fake microphone, so the
  two are not a like for like comparison; the point is that it stays flat).
- **The box's cost is small and linear.** About 0.09% of a core per forwarded
  stream, so 200 listeners hearing one person, or forty people talking to
  five each, is under a fifth of one core of this machine. The box's own
  cores need the same run (below).

### Sizes and licences of the native pieces

| Piece | Licence | Size |
|---|---|---|
| libdatachannel (WebRTC transport, C and C++, with OpenSSL) | MPL 2.0 | 7.5 MB unpacked for Windows x64 as node-datachannel 0.33.4 ships it |
| Concentus (Opus in C#, no native code) | BSD 3-Clause | 392 KB (`netstandard2.0`) |
| Windows Voice Capture DSP (echo cancellation, noise suppression, gain control) | Part of Windows since Vista (`CLSID_CWMAudioAEC`, `Mfwmaaec.dll`) | nothing to ship |
| SIPSorcery 10.0.17 (WebRTC in C#) | BSD 3-Clause **plus a clause forbidding use, modification or distribution in Israel and the Occupied Territories** | 5.3 MB, plus BouncyCastle 4.9 MB |

SIPSorcery is the obvious C# library and it is ruled out here: its licence is
not an open source licence, and a release handed to anybody who applies
cannot keep to a rule about where they live.

## Voice: the options

Each option is a whole direction. Its pros and cons come first for the
people who play, then for the team. The last line of each says whose process
the sound comes from, which is what the Volume Mixer shows (#3207).

### V1. Keep it: WebView2 in the launcher, every launcher to every other

For people who play:
- Pro: it works today for most pairs, with Chromium's echo cancellation and
  noise suppression.
- Con: upload and download grow with the room, measured above: about
  1.6 Mbit/s each way at 50 people, all the time, talking or not.
- Con: some pairs never connect and are not told (measured above), and
  people behind strict routers cannot reach each other at all with no relay.
- Con: every person's internet address goes to everybody in the room, since
  the connections are direct. The privacy page does not say this (#3431).
- Con: a browser runs beside the game the whole session (`msedgewebview2.exe`
  processes), and the WebView2 runtime is installed when missing.

For the team:
- Pro: no work.
- Con: two clients of the same protocol to keep (`voice-host.html` and the
  game's `thornswood-voice.js`), negotiation glare and roster ordering are
  ours to keep right (#1869, #1924, #1925, #1959), and none of it can be
  debugged without a browser's tools.

Mixer: Microsoft Edge WebView2, not Thornswood.

### V2. WebView2 in the launcher, the box forwards

The same page, connected once to the box, which sends each voice only to the
people in range.

For people who play:
- Pro: upload is one stream whatever the room; download is only the voices in
  range; nobody's address goes to anybody but the box; one connection to one
  well connected address fails far less than a mesh of home routers.
- Con: still a browser beside the game, still the WebView2 runtime.

For the team:
- Pro: proximity, mute and staff silence move into the server, where they are
  enforced rather than asked for: a muted or silenced voice is simply not
  sent.
- Con: the box carries the voice traffic (measured above), and the privacy
  page changes from "passed between people" to "passed through our server,
  never recorded".

Mixer: Microsoft Edge WebView2, not Thornswood.

### V3. A native voice engine in the launcher, the box forwards (recommended)

The launcher captures the microphone with WASAPI through Windows' Voice
Capture DSP (echo cancellation, noise suppression and gain control, built into
Windows), encodes Opus (Concentus), and sends one stream over WebRTC
(libdatachannel) to the box, which forwards it as in V2. Playback is the
launcher's own WASAPI stream, with direction and distance applied in the
launcher as `voice-host.html` does today.

For people who play:
- Pro: everything V2 gives: one stream up, only voices in range down, no
  address shared with other people, fewer failed pairs.
- Pro: no browser beside the game, no WebView2 runtime to install, and less
  memory for the launcher while the game runs (to be measured on Windows).
  With the menu music already moving out of WebView2 (#3207, PR #3427), voice
  is the last thing that needs it, so the launcher carries no browser at all.
- Pro: the sound is the launcher's own, so the mixer shows it as Thornswood
  (and Thornswood Dev on the dev build), and the voice level there is ours
  alone.
- Con: Windows' echo cancellation is older than Chromium's; how it compares
  on speakers without a headset needs a test on a real PC (below).
- Con: the first time the launcher sends voice, Windows Firewall may ask
  about Thornswood itself, since the launcher now owns the connection. The
  installer can add the rule once.

For the team:
- Pro: one voice client instead of two (the game's WebRTC copy goes), in C#,
  in a library the launcher calls, so it moves with the launcher whatever
  #3209 picks (WPF today, Avalonia or WPF on .NET 10 later).
- Pro: the engine can be tested without a browser or a game: the forwarder
  measurement above already drives native clients against a box.
- Pro: the box and the launcher use the same transport library
  (libdatachannel), so a fault is looked for in one place.
- Con: a native DLL (libdatachannel) is signed and shipped with the launcher.
  The launcher publishes one exe today and embeds WebView2's DLLs; this one
  is embedded the same way, or the update carries a second file (#3209's
  updater question).
- Con: the box needs node-datachannel's Windows build beside `voice-server.js`
  and more upload: about 52 kbit/s for each voice it sends to each listener
  (Opus, SRTP and the UDP and IP headers), so ten people talking at once with
  five in range of each is about 2.6 Mbit/s, where the box measured
  93 Mbit/s (`voice/tests/test-cull.js`).
- Con: voice needs a UDP port on the box that Cloudflare does not carry. The
  game servers' ports already reach the box directly, so this opens no
  address that is not already known.
- Pro: it lines up with #3209's recommendation, which wants no web view in
  the launcher once this issue settles voice.

Mixer: Thornswood, from the launcher's own process.

### V4. A native voice engine in the launcher, every launcher to every other

V3's engine with today's mesh and no forwarder.

For people who play:
- Pro: no browser, and Thornswood in the mixer, as V3.
- Con: the mesh's costs stay: upload and download grow with the room, failed
  pairs, every address shared.

For the team:
- Pro: the box carries no voice.
- Con: everything hard about the mesh stays ours, now in native code.

Mixer: Thornswood.

### V5. A native voice helper program

V3's engine as a small program of its own (`Thornswood Voice.exe`, in C++ or
Rust) that the launcher starts.

For people who play:
- Same as V3, except a second program runs and Windows Firewall asks about it
  by its own name.
- Pro: if voice crashes, the launcher stays up.

For the team:
- Pro: independent of the launcher's stack.
- Con: a second signed program, a second updater path, and a local channel
  between the two to keep; C++ or Rust, which fewer people here read.

Mixer: its own process, which can name its sound Thornswood.

### V6. Voice inside the game (a native plugin in the fork)

The engine in C++ inside the SkyMP client, where push to talk and positions
already are.

For people who play:
- Pro: push to talk and position with no hop through files and a local port.
- Con: a fault in voice takes the game down, not just voice.
- Con: voice exists only while the game runs.
- Con: the sound is Skyrim's, so the mixer shows Skyrim, and turning Skyrim
  down turns voice down.

For the team:
- Con: only the VPS runners build the fork, and it is debugged only in the
  game.

Mixer: Skyrim, not Thornswood.

### V7. Mumble (a Murmur server on the box)

For people who play:
- Pro: a mature voice program with positional audio and good echo handling.
- Con: a second program to install and run, with its own window and
  settings, and a second account step.

For the team:
- Pro: proven server software, nothing to write for the audio.
- Con: proximity in Mumble is the client's, from a shared memory link a game
  plugin writes; distance culling on the server is not built in, so every
  voice in a channel is sent to everybody in it. Staff silence and mutes
  become Mumble's permissions, a second system beside ours.

Mixer: Mumble.

### V8. Vivox (Unity)

For people who play:
- Pro: positional voice with good audio processing, run by Unity.
- Con: every voice goes through Unity's servers, a change to the privacy
  page and a third party holding the audio path.

For the team:
- Con: free only up to a number of people at once, then paid, and Unity's
  terms change on their own schedule; a closed SDK whose faults we cannot fix
  at their cause. Unity's own support page has said there is no C# SDK
  outside Unity, and their current page points to a C++ Core SDK.

Mixer: Thornswood if the SDK plays from the launcher.

### V9. Discord's Social SDK

For people who play:
- Pro: everybody already signs in with Discord.
- Con: voice calls are meant for about 25 people at most, so a room has to
  be split into many calls that people join and leave as they walk, with a
  gap each time.

For the team:
- Con: Discord's terms, a closed SDK, and rate limits on joining calls.

Mixer: Thornswood if the SDK plays from the launcher.

Steam's voice is not an option: it needs a Steam app id of our own.

### Voice recommendation

**V3: a native voice engine in the launcher, and the box forwards each voice
only to the people in range.** For the people who play it is the only option
that removes the browser, shows as Thornswood in the mixer, sends one stream
up whatever the room, stops sending addresses to other people and stops pairs
failing silently. V2 has the same network gains and keeps the browser; V4
keeps the browser out and keeps the mesh. Between V3 and V5, equal for the
people who play but for a second program, V3 is less to sign, ship and keep.

What would change it: if Windows' echo cancellation is clearly worse than
Chromium's on speakers, the audio processing moves to WebRTC's own audio
processing library (BSD, native) inside the same engine; the rest of V3
stands.

## Chat, emotes and the rest of the UI: the options

### U1. Keep the in-game browser (CEF) and keep working around focus

For people who play:
- Pro: everything exists and looks the way it does now.
- Con: the keyboard and mouse belong to either the game or the browser, and
  getting that wrong has stranded people (twelve closed faults, three open
  repairs, above).
- Con: no controller in any panel.
- Con: a Chromium from December 2022 runs beside the game, and its rendering
  is copied into every frame.

For the team:
- Pro: HTML, CSS and JavaScript, which everybody here and every Claude thread
  reads well; the `tests/test-*.js` harnesses already load the overlays in
  node.
- Con: the focus layer is the most repaired code in the game, and the fork's
  input hook is ours to keep.
- Con: Chromium 108 gets no fixes; moving CEF means rebuilding the fork's
  CEF port.

### U2. A lighter HTML renderer in the game: Prisma UI (Ultralight)

Prisma UI is an SKSE plugin that draws HTML, CSS and JavaScript with
Ultralight, a cut down WebKit, inside the game. It would be a third backend in
the fork beside tilted and NirnLab (the NirnLab adapter, `BrowserApiNirnLab.cpp`,
is 182 lines), so the overlays keep their code.

For people who play:
- Pro: no Chromium beside the game; its makers claim it is ten times lighter
  (not measured here).
- Pro: it has IME support for typed text.
- Con: it is still an overlay with its own focus: whether it gets input
  right is unmeasured.
- Con: no controller unless we write it.

For the team:
- Pro: the same web code and harnesses.
- Con: Ultralight is a closed binary; its licence forbids looking inside it,
  so a fault there cannot be fixed at its cause, only reported. The
  "a cause in the engine is fixed in the fork" rule cannot hold for it.
- Con: free only while Thornswood's revenue and funding stay under US$100,000
  a year; then a paid licence.
- Con: young (a GitHub project with 30 stars, no published releases), and
  modified copies may not be published.

### U3. NirnLab UI Platform

The fork's other backend: CEF again, out of process.

For people who play:
- Con: everything U1 has, plus a 356 MB download and a firewall prompt for its
  own program.

For the team:
- Con: another server's framework, kept out of our packs on purpose.

### U4. Skyrim's own menus (Scaleform), driven from the plugins (recommended)

Each panel becomes a Skyrim menu, a SWF opened with `Ui.openCustomMenu` and
fed with `Ui.invoke*` from the same plugin JavaScript; what the person picks
comes back as a `modEvent`. Chat on screen is a HUD widget; typing is a small
menu with Skyrim's own text field, as the console has. SkyUI, already in the
collection, is built this way.

For people who play:
- Pro: the game owns the keyboard, mouse and cursor while a menu is open, the
  way it does for the inventory. The focus layer and its repairs go away with
  the browser.
- Pro: controller support the way Skyrim's menus have it.
- Pro: the panels look and sound like the rest of the game, at Skyrim's own
  cost, with no browser process.
- Con: Scaleform's text and layout are plainer than a browser's, and every
  font has to be inside the SWF (with #1317's licence rules).

For the team:
- Con: SWFs are binary. They are built from ActionScript 2 with JPEXS Free
  Flash Decompiler's command line (`-xml2swf`, `-importScript`, GPL, Java),
  which runs on Linux; Adobe's tools no longer make ActionScript 2. The build
  step is ours to write and keep, and was not tried here: the session could
  not download FFDec's release from GitHub.
- Con: ActionScript 2 is old; Claude threads read and write it less well than
  JavaScript, and it can be debugged only in the game.
- Pro: no browser layer to keep in the fork; the browser backend can be set
  to `off`.

### U5. Dear ImGui menus from a native plugin

For people who play:
- Con: it looks like a developer tool.

For the team:
- Pro: quick to write in C++, good for staff and dev tools.
- Con: the fork's build only, and its own input capture to keep.

### U6. Emotes as lesser powers on the Q menu (#2026)

Already decided (option C on #2026: build the Wave prototype first). It puts
emotes in Skyrim's favourites, with a controller, beside whatever the wheel
becomes. It is not a replacement for the panels.

### UI recommendation

**U4: Skyrim's own menus for every panel people use in the world, with chat
as a HUD widget and Skyrim's text field, and emotes on the Q menu as #2026
already decided.** For the people who play it is the only option that takes
the keyboard question away instead of moving it, and the only one with a
controller. U2 keeps more for the team and nothing for people that U4 does
not give better, and puts a closed renderer where we cannot fix faults.

The first step proves it before anything else moves: one panel, the away
window (`thornswood-afk.js`, the smallest), built as a Scaleform menu from
the plugin, measured in the game against the browser version for frame time,
memory and input. If Scaleform cannot carry the chat's typing, the fallback
for the chat alone is U2.

## What is still to measure, and who takes it

| Measurement | Why | Who |
|---|---|---|
| Today's voice on Windows, a room of at least four launchers: per connection upload, and any pair that stays `new` | Confirms the cloud numbers and the failed pairs on WebView2 | Local Desk on One, with dev test clients |
| Echo on speakers: Windows' Voice Capture DSP against Chromium's | The one place V3 may be worse for people | A dev on a PC with speakers, once the prototype engine exists |
| Frame time and memory with the browser shown and hidden, and with the Scaleform away window | U1 against U4 for people, in numbers | A dev in the game (a Dev test task) |
| The launcher's memory with and without WebView2 voice | V3's memory gain | Local Desk on One, with #3209's measuring script |
| `measure/box-forwarder.js` on the box, at a quiet hour | The forwarder's cost on the box's own cores, beside the game servers (#3181) | The Cloud Desk, through `scripts\vps\Remote.ps1 -File` |

## The work each pick needs

Filed now, because they stand whatever is picked:

- #3429: voice sends every other person in the room 50 packets a second of
  silence while nobody talks.
- #3430: some voice pairs never connect and nothing says so.
- #3431: the privacy page does not say voice sends each person's address to
  everybody in the voice room.

Filed on 26 Oct 2026 for the picks, in this order:

Voice (V3):

1. #3511: the box forwards each voice only to the people in range, and the
   launcher's page connects once to the box meanwhile.
2. #3513: the launcher's native voice engine.
3. #3514: the browser goes from voice.

The rest of the UI (U4):

1. #3515: the Scaleform build, and the away window as the first menu,
   measured in the game against the browser one.
2. #3516: every other panel, then the browser backend off with the focus
   layer and its three repairs (#2131, #2384, #2729) removed.
