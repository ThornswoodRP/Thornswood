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
[`2921bc88`](https://github.com/ThornswoodRP/skymp/tree/2921bc88b3fc7ade68a7698cf317bc113197027e).
That commit starts from
[SkyMP](https://github.com/skyrim-multiplayer/skymp) at `2849e676`, and
[every change Thornswood made](https://github.com/ThornswoodRP/skymp/compare/2849e676...2921bc88)
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

**The launcher** carries three libraries for proximity voice: Concentus
2.2.2, by Logan Stromberg, the Opus codec written in C# from the Opus
reference library by Xiph.Org and its contributors, under the Opus BSD
licence; SharpSRTP 0.5.8, by Lukas Volf, which encrypts each call, under the
MIT licence; and BouncyCastle 2.7.0, by the Legion of the Bouncy Castle, the
cryptography SharpSRTP is built on, under the MIT licence. Their licences are
at the bottom of this page, and their sources are on GitHub:
[Concentus](https://github.com/lostromb/concentus) at commit `6c2328dc`,
[SharpSRTP](https://github.com/jimm98y/SharpSRTP) at commit `ede1d045` and
[BouncyCastle](https://github.com/bcgit/bc-csharp) at commit `4007498b`.
It also carries NLayer 3.0.0, by Mark
Heath, Andrew Ward and contributors, the MP3 decoder it plays its menu theme
with, under the MIT licence, which is at the bottom of this page too. Its
source is [on GitHub](https://github.com/naudio/NLayer), at commit
`046c7ce4`. And it carries zlib's compressor, from zlib 1.3 by Jean-loup
Gailly and Mark Adler, under the zlib licence. It is translated into C# so
that the main menu the launcher makes from your game comes out the same on
every machine.

Its voice places everybody around your head with Chromium's HRTF panner, the
one the game's browser uses, ported into the launcher from Chromium (commit
`dd2ed7a2`), by Google and the Chromium authors under the BSD licence. It
filters each voice with impulse responses derived by Chris Rogers from the
[IRCAM Listen HRTF Database](http://recherche.ircam.fr/equipes/salles/listen/),
by IRCAM (Institut de Recherche et Coordination Acoustique/Musique), which
is public and available for any use. The notices and terms are at the bottom
of this page.

**The launcher is built on** .NET 10 by Microsoft and the .NET Foundation,
compiled into it so you need nothing installed, under the MIT licence;
Avalonia 12.1.4, by the AvaloniaUI project, its window and controls, under
the MIT licence; SkiaSharp 3.119.4 and HarfBuzzSharp 8.3.1.3, by Microsoft,
under the MIT licence, with Google's Skia, which draws everything, and
HarfBuzz, which shapes the text, under their own licences, and ANGLE, which
Avalonia draws through on Windows, under the BSD licence; MicroCom, by
Nikita Tsukanov, under the MIT licence; and Velopack 1.2.161, by Velopack Ltd,
Caelan Sayler and Kevin Bost, which installs and updates it, under the MIT
licence. Their licences are at the bottom of this page, and their sources are
on GitHub: [.NET](https://github.com/dotnet/dotnet) at commit `0427b9ab`,
[Avalonia](https://github.com/AvaloniaUI/Avalonia) at commit `2d79ba55` and
[its ANGLE](https://github.com/AvaloniaUI/angle) at commit `1c898059`,
[SkiaSharp and HarfBuzzSharp](https://github.com/mono/SkiaSharp) at commits
`f568ac94` and `2888c737`, [Skia](https://github.com/google/skia),
[HarfBuzz](https://github.com/harfbuzz/harfbuzz),
[MicroCom](https://github.com/kekekeks/MicroCom) at commit `76785efc` and
[Velopack](https://github.com/velopack/velopack) at commit `92d6a1c9`.

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

## Concentus licence

```
Copyright (c) by various holding parties, including (but not limited to): 
Skype Limited, Xiph.Org Foundation, CSIRO, Microsoft Corporation,
Jean-Marc Valin, Gregory Maxwell, Mark Borgerding, Timothy B. Terriberry,
Logan Stromberg. All rights are reserved by their respective holders.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of Internet Society, IETF or IETF Trust, nor the
   names of specific contributors, may be used to endorse or promote
   products derived from this software without specific prior written
   permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


This repository and its redistributable packages contain independently compiled
versions of the Opus C reference library, which is maintained by Xiph.org and the
Opus open-source contributors. The source code for these libraries is freely available
at https://gitlab.xiph.org/xiph/opus/-/tags/v1.5.2, and all binaries are being
redistributed to you under the same terms of the general Opus license dictated above.
```

## SharpSRTP licence

```
MIT License

Copyright (c) 2025 Lukas Volf

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

## BouncyCastle licence

```
MIT License (https://opensource.org/licenses/MIT)

Copyright (c) 2000-2026 The Legion of the Bouncy Castle Inc. (https://www.bouncycastle.org).
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sub license, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions: The above copyright notice and this
permission notice shall be included in all copies or substantial portions of the Software.

**THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.**
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

## Chromium HRTF licence

The notices of the Chromium files the launcher's HRTF panner is ported from,
at Chromium commit `dd2ed7a2`. `hrtf_panner.cc` and `delay.cc`:

```
Copyright (C) 2010, Google Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1.  Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2.  Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
DAMAGE.
```

`hrtf_elevation.cc`, `hrtf_kernel.cc`, `hrtf_database.cc`, `fft_frame.cc` and
`fft_convolver.cc`:

```
Copyright (C) 2010 Google Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1.  Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
2.  Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in the
    documentation and/or other materials provided with the distribution.
3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
    its contributors may be used to endorse or promote products derived
    from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

`media/base/sinc_resampler.cc`, `rustfft_ffi.rs` and `panner_handler.cc`, under
Chromium's `LICENSE` at that commit:

```
// Copyright 2015 The Chromium Authors
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google LLC nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## IRCAM Listen HRTF terms

What Firefox's copy of the impulse responses says of them
(`dom/media/webaudio/blink/IRC_Composite_C_R0195-incl.cpp`):

```
"The sample data in the arrays here was derived for Webkit by Chris Rogers
through averaging of impulse responses from the IRCAM Listen HRTF
Database. The responses here are half the length of the Listen responses.
This sample data has been granted to the Public Domain."
```

The IRCAM Listen HRTF Database's terms, as the Ambisonic Toolkit's licensing
notes quote them (IRCAM's own page could not be reached on 1 November 2026):

```
"Copyright (c) 2002 IRCAM (Institut de Recherche et Coordination
Acoustique/Musique). All Rights Reserved"

"Use of Materials: The Listen database is public and available for any
use. We would however appreciate an acknowledgment of the database
somewhere in the description of your work (e.g. paper) or in your
development."
```

## .NET licence

```
The MIT License (MIT)

Copyright (c) .NET Foundation and Contributors

All rights reserved.

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

## Avalonia licence

```
The MIT License (MIT)

Copyright (c) AvaloniaUI OÜ
All Rights Reserved

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

## SkiaSharp and HarfBuzzSharp licence

```
Copyright (c) 2015-2016 Xamarin, Inc.
Copyright (c) 2017-2018 Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Skia licence

```
// Copyright (c) 2011 Google Inc. All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google Inc. nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## HarfBuzz licence

```
HarfBuzz is licensed under the so-called "Old MIT" license.  Details follow.
For parts of HarfBuzz that are licensed under different licenses see individual
files names COPYING in subdirectories where applicable.

Copyright © 2010,2011,2012  Google, Inc.
Copyright © 2012  Mozilla Foundation
Copyright © 2011  Codethink Limited
Copyright © 2008,2010  Nokia Corporation and/or its subsidiary(-ies)
Copyright © 2009  Keith Stribley
Copyright © 2009  Martin Hosken and SIL International
Copyright © 2007  Chris Wilson
Copyright © 2006  Behdad Esfahbod
Copyright © 2005  David Turner
Copyright © 2004,2007,2008,2009,2010  Red Hat, Inc.
Copyright © 1998-2004  David Turner and Werner Lemberg

For full copyright notices consult the individual files in the package.


Permission is hereby granted, without written agreement and without
license or royalty fees, to use, copy, modify, and distribute this
software and its documentation for any purpose, provided that the
above copyright notice and the following two paragraphs appear in
all copies of this software.

IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES
ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN
IF THE COPYRIGHT HOLDER HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH
DAMAGE.

THE COPYRIGHT HOLDER SPECIFICALLY DISCLAIMS ANY WARRANTIES, INCLUDING,
BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE.  THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE COPYRIGHT HOLDER HAS NO OBLIGATION TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.
```

## ANGLE licence

```
// Copyright 2018 The ANGLE Project Authors.
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions
// are met:
//
//     Redistributions of source code must retain the above copyright
//     notice, this list of conditions and the following disclaimer.
//
//     Redistributions in binary form must reproduce the above
//     copyright notice, this list of conditions and the following
//     disclaimer in the documentation and/or other materials provided
//     with the distribution.
//
//     Neither the name of TransGaming Inc., Google Inc., 3DLabs Inc.
//     Ltd., nor the names of their contributors may be used to endorse
//     or promote products derived from this software without specific
//     prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
// FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
// COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
// INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
// BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
// LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
// ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.
```

## Velopack licence

```
Copyright © 2021 Caelan Sayler
Copyright © 2024 Velopack Ltd.

Permission is hereby granted,  free of charge,  to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to  use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## MicroCom licence

```
MIT License

Copyright (c) 2021 Nikita Tsukanov

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
