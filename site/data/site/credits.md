# Credits

Thornswood is a free fan project. Nobody is paid and nothing is sold.

## Standing on

**SkyMP** is the multiplayer engine underneath all of this. Skyrim was never
built to be played together, and SkyMP is the reason it can be at all.

**SKSE** and **Skyrim Platform**, which everything else in turn stands on.

**Bethesda Game Studios**, for the game. Thornswood is not affiliated with or
endorsed by Bethesda Softworks. The Elder Scrolls and Skyrim are their
trademarks, and you need your own copy to play. THIS MOD IS NOT MADE,
GUARANTEED OR SUPPORTED BY ZENIMAX OR ITS AFFILIATES.

## The mod list

Every mod in Thornswood was made by somebody who gave it away. The full list is
the collection on Nexus, linked from the [Downloads](/downloads) page, and each
mod in it links to its own page and its author. Go and endorse the ones you
like.

## Thornswood's own work

Thornswood's own code (the launcher, the installer, the overlays, the
gamemode, the code behind this site, the bot and the voice service) is under
the MIT licence. Its own lore, art, music and game content are under
[Creative Commons Attribution-NonCommercial-ShareAlike 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/):
share and adapt them, not for money, crediting Thornswood and keeping the same
licence. The Thornswood name and logo are under neither, and stay
Thornswood's with all rights reserved. The theme music is its composer's,
with all rights reserved: it is licensed to Thornswood alone and is not under
that licence. What other people made keeps its own licence, as the rest of
this page says.

<a id='source'></a>

## Source code

SkyMP is free software, and Thornswood ships part of it. The installer and the
launcher's updates put SkyMP files into your Skyrim folder, and the server you
connect to runs on SkyMP as well. Six of those files, and the server's engine,
are built from Thornswood's public copy of SkyMP, with Thornswood's changes on
top:

**[github.com/ThornswoodRP/skymp](https://github.com/ThornswoodRP/skymp)**, on
the branch `thornswood/engine-changes`. Anybody can read it or download it,
with no account.

<!-- engine-pin:credits -->
The server's engine recorded for the next release, `scam_native.node`, is
built from one commit,
[`ec8e20f9`](https://github.com/ThornswoodRP/skymp/tree/ec8e20f99c268cb7e21d546b38841d448b85a7c1).
That commit starts from
[SkyMP](https://github.com/skyrim-multiplayer/skymp) at `2849e676`, and
[every change Thornswood made](https://github.com/ThornswoodRP/skymp/compare/2849e676...ec8e20f9)
is the difference between the two.
<!-- /engine-pin:credits -->

The server's engine goes to our test server first, then to the main server.
Each server records which commit it runs, and this page names it here once
that record can be read.

The six client files are built from the commit named by the feed a person
got them from (`clientRuntime.forkCommit` in that channel's `version.json`).
That is not always the commit above. The dev feed moves when main does, and
the public feed moves on the next Ship of that channel. Both commits are on
the same public branch:

| Channel | Feed | The six client files are built from |
|---|---|---|
| Public | `feed/version.json` | the commit that feed names |
| Dev | `feed-dev/version.json` | the commit that feed names |

| File | Built from | Licence |
|---|---|---|
| `skymp5-client.js` | `skymp5-client` | GNU GPL version 3 |
| `SkyrimPlatform.dll` | `skyrim-platform` | GNU GPL version 3 |
| `SkyrimPlatformImpl.dll` | `skyrim-platform` | GNU GPL version 3 |
| `SkyrimPlatformCEF.exe.hidden` | `skyrim-platform` | GNU GPL version 3 |
| `TESModPlatform.pex` | `skyrim-platform` | GNU GPL version 3 |
| `MpClientPlugin.dll` | `skymp5-server` | GNU AGPL version 3 |
| `scam_native.node`, the server's engine | `skymp5-server` | GNU AGPL version 3 |

Each licence is the `LICENSE` file in that folder of the repository.

The four `.dll` and `.exe.hidden` files are also built with other people's
libraries, whose code is inside them: among them OpenSSL, zlib, fmt, spdlog,
Frida with GLib, and Node.js. Every download that carries one of the four
has a `licences` folder with each library's own licence, and its note lists
which library is in which file. The installer puts that folder in your
Thornswood folder. Frida is Frida's own build, with other libraries inside
it, and the note names where their source is: one archive of each, at the
commit Frida built it from, on
**[Thornswood's release of Frida's sources](https://github.com/ThornswoodRP/Thornswood/releases/tag/frida-sources-16.0.19)**.
Until that repository is public, the same commits are in Thornswood's
copies of Frida's repositories, which the note names too.

SkyMP's in-game interface, `build.js` with the fonts, pictures and sounds
beside it, is built from the same public copy too: from its `skymp5-front`
folder, under the GNU GPL version 3, at the commit of the six client files
of the same release. Releases made since 20 October 2026 carry that build. The
public channel's releases from before then carry an older one, below.

### SkyMP files Thornswood did not build

The installer carries these too, and the launcher's updates can. Thornswood
did not build them, and nobody recorded which version of SkyMP they came from,
so no commit is named for them here. Their source is SkyMP's own, at
**[github.com/skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp)**.

| File | What it is | Its folder in SkyMP, and that folder's licence |
|---|---|---|
| `build.js` in releases made before 20 October 2026, with the fonts, pictures and sounds it loads | SkyMP's in-game interface | `skymp5-front`, GNU GPL version 3 |
| `skyrimPlatform.ts` | Skyrim Platform's type declarations | `skyrim-platform`, GNU GPL version 3 |
| `MpClientPlugin.pex` | A compiled Papyrus script | `client-deps`, which has no `LICENSE` file and keeps no source for it |

One more SkyMP file reached people through Nexus Mods instead, in version
1.0.0 of the Thornswood Client Runtime (below), which the collection's first
two revisions still install: `___systemPolyfill.js`, a small Skyrim Platform
script, from `skyrim-platform` under the GNU GPL version 3. Version 1.0.1,
which the collection installs since its third revision, leaves it out. It is
the last version SkyMP had before it removed the script in June 2026, so its
source is in SkyMP's history rather than its current code:
[the change that removed it](https://github.com/skyrim-multiplayer/skymp/pull/2711)
shows every line of it.

## What else Thornswood hands you that somebody else wrote

**The launcher** carries three files from Microsoft's WebView2 SDK, version
1.0.2903.40. They give it the browser that voice runs in. Microsoft's licence
for them is at the bottom of this page. It also carries NLayer 3.0.0, by Mark
Heath, Andrew Ward and contributors, the MP3 decoder it plays its menu theme
with, under the MIT licence, which is at the bottom of this page too. Its
source is [on GitHub](https://github.com/naudio/NLayer), at commit
`046c7ce4`. And it carries zlib's compressor, from zlib 1.3 by Jean-loup
Gailly and Mark Adler, under the zlib licence. It is translated into C# so
that the main menu the launcher makes from your game comes out the same on
every machine.

**The Thornswood Client Runtime** is Thornswood's own mod on
[Nexus Mods](https://www.nexusmods.com/skyrimspecialedition/mods/192762), and
the collection installs it for you. It is the browser and script engine Skyrim
Platform runs on, and Thornswood wrote none of it but the README: the Chromium
Embedded Framework and Chromium 108, ANGLE and ICU's data (BSD and Unicode
licences), Node.js 23.2.0 (MIT) and Microsoft's Direct3D shader compiler
(version 1.0.0 also had the one SkyMP script above). The licence texts come
with it, in `Data\Docs\Thornswood Client Runtime`. The shader compiler,
`d3dcompiler_47.dll`, is Microsoft's, unmodified and signed by Microsoft. It is
on the Windows SDK's list of files that may be handed on with a Windows
program ([Windows SDK redist lists](https://learn.microsoft.com/en-us/legal/windows-sdk/redist)),
under the Windows SDK's licence terms for that code, and it remains
Microsoft's property. The mod's README says what those terms ask of you.

**The main menu's interface file**, `Data\Interface\startmenu.swf`, is
Skyrim's own, edited so the menu shows no logo and no button list. The notice
board and drop box meshes are put together from pieces of Skyrim's own meshes
with the game's own textures. Thornswood ships none of the three: the launcher
makes them on your computer from your own copy of the game.

**The animation files** in `Data\meshes\actors\character` (its `behaviors`
and `characters` folders) and `Data\meshes\animationdatasinglefile.txt` and
`animationsetdatasinglefile.txt` are Skyrim's own, with the animation patches
of Precision and True Directional Movement, both by Ersh, merged in by Pandora
Behaviour Engine+, by the Pandora Behaviour Engine Team. The launcher runs the
collection's Pandora on your computer to make them; Thornswood wrote none of
them, and they never come with Thornswood.

**The bodies** are built on your computer by the launcher, in the
collection's BodySlide, each with underwear, at its own slider defaults, and
never come with Thornswood. The women's is CBBE 3BA, by Acro, and Astrid's is
CBBE's, both on CBBE by Ousnius, Caliente and Jeir. The men's,
`malebody_0.nif` and `malebody_1.nif`, is Highly Improved Male Body Overhaul
(HIMBO), by Kreiste and Novelyst, changed only by that build. HIMBO's body is
under the
[Creative Commons Attribution-ShareAlike 4.0 licence](https://creativecommons.org/licenses/by-sa/4.0/),
and so are these two files.

**SkyHUD's settings**, `Data\Interface\skyhud\skyhud.txt`, are Thornswood's
preset for SkyHUD 0.90B, by the SkyHUD Team, the version the collection
installs. SkyHUD's author lets anybody share a preset that says which version
it is for, and nothing else of SkyHUD's comes with it.

**QuickLoot IE's settings**, `Data\SKSE\Plugins\QuickLootIE.json`, are
QuickLoot IE 4.1.3's own settings file with one line added by Thornswood, so
its loot menu shows weight and no gold value. QuickLoot IE is released under
the GPL-3.0-or-later, and so is this file.

**SkyUI's item lists and item card, SkyHUD's line under an item and moreHUD's
value to weight** show no gold value on Thornswood, because an item here has
no gold price. **SkyUI's journal** has no saving, loading, Skyrim help or
Creation Club on its System page, because Thornswood keeps your character on
the server and has its own help. They are the work of the SkyUI Team, the
SkyHUD Team and Ahzaab, moreHUD's author. Thornswood ships none of those
files: the launcher makes them on your computer from your own copy of each
mod.

**Tavern**, the font Skyrim Platform draws its text in, is Typey McTypeface by
Paul J. Miller and Dieter Steffmann, under the SIL Open Font License. It comes
with SkyMP.

**Big Shoulders**, the font SkyMP's in-game interface draws its buttons and
text boxes in since 31 October 2026, is by Patric King (XO Type Co) and the
Big Shoulders Project Authors, under the SIL Open Font License, version 1.1.
Before it, that interface drew them in **Bankir-Retro**, by Gophmann A.L.
(2006), and the dots of a hidden password in **icomoon**, made with IcoMoon;
both came with SkyMP, in its `skymp5-front`. **Barlow SemiBold**, the
font that interface draws the rest of its text in since 20 October 2026, is by
Jeremy Tribby and the Barlow Project Authors, under the SIL Open Font License,
version 1.1. Thornswood also draws the dot over somebody who is speaking in
Barlow SemiBold, made into a Skyrim Platform font, and its licence goes with
it into your game folder.

**This site** is set in Cinzel, by the Cinzel Project Authors, and Spectral,
by the Spectral Project Authors, both under the SIL Open Font License. It
draws its written pages with marked, by Christopher Jeffrey, under the MIT
licence. All three are served from here, and so are their licences:
[marked's](/marked-LICENSE.txt), [Cinzel's](/cinzel-OFL.txt) and
[Spectral's](/spectral-OFL.txt).

## Microsoft WebView2 SDK licence

```
Copyright (C) Microsoft Corporation. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * The name of Microsoft Corporation, or the names of its contributors
may not be used to endorse or promote products derived from this
software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## NLayer licence

```
MIT License

Copyright (c) 2018 Mark Heath, Andrew Ward & Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
