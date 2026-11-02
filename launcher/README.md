# The launcher

## What it is

Everything `Thornswood.exe` is built from. The C# is in `launcher\app`, an
SDK project on .NET 10 with Avalonia (`launcher\app\Thornswood.csproj`,
#4823), and `launcher\app\ARCHITECTURE.md` says what each class owns and how
Play runs. The window is `launcher\app\MainWindow.axaml`, compiled with the
launcher, so a control renamed there and not in the C# is a build error;
`launcher\app\App.axaml` is the application, which loads Avalonia's Fluent
theme. The install window is the launcher's own too (`launcher\app\Install*.cs`,
#4824), shown on the first start after Velopack's Setup.exe.

Beside `app` are the icon (`app.ico`), the emblem (`logo.png`), the dev
build's icon and emblem (`app-dev.ico`, `logo-dev.png`, picked in `Icons.cs`
and `Art.cs`), the strip of art behind the title (`launcher-header.jpg`) and
the same strip moving (`launcher-header.webp`, an animated WebP the launcher
decodes itself with SkiaSharp, made from `launcher-header.mp4`, which stays
as its source and is not built in), and the key template the launcher writes
when a machine has none (`Thornswood.ini`). `logo-192.png` is the emblem at
192 pixels, which the setup program carried until #4824; nothing builds it in
now. `art` holds the source pictures for the main menu backdrop and its spec
(`BACKDROP-SPEC.md`, `ART-PROMPT.md`), which `scripts\dev\Build-Backdrop.py`
reads; the launcher does not ship them (#3680).

The libraries the launcher uses come from nuget.org as package references in
`Thornswood.csproj`, not as files kept here: Avalonia and SkiaSharp for the
window, NLayer for the menu theme's MP3, Concentus, SharpSRTP and
BouncyCastle for voice, and Velopack for the install and the updates.
`THIRD-PARTY.md` at the root names each with its version and licence.

Proximity voice runs in the launcher's own code (`launcher\app\Voice.cs`
and the `Voice*.cs` files beside it, #4823): it holds the microphone through
Windows' audio API, makes the WebRTC connections between people, encodes and
decodes with Opus and plays the mix, none of which the game's own browser ever
managed. It needs no web view. It talks to the voice service (`voice`) on the
same protocol as the in-game page. Push to
talk reaches it through the launcher, which hears it from the game plugin over
a local socket and a small file in `Data\Platform`.

Five files in `launcher\app` are touched from every machine and need a line in
#staff-updates before they change: Shell.cs, Checks.cs, Keep.cs, Hold.cs and
Updater.cs.

## On your machine

`scripts\release\Build-Launcher.ps1` runs `dotnet publish` on
`launcher\app\Thornswood.csproj` for win-x64 with Native AOT: the C#, the
compiled window and the .NET runtime become one native `Thornswood.exe`,
self-contained, with the art, the key template and the records it reads
inside it as resources by name (the project file lists them), and beside it
the native libraries Avalonia draws with (`libSkiaSharp.dll`,
`libHarfBuzzSharp.dll`, `av_libglesv2.dll`). It writes that folder into
`<Root>\Launcher` and touches nothing else; the shortcut and the icon are
`scripts\release\Install-Launcher.ps1`, which Ship runs. To compile without
replacing an installed launcher, build into a scratch root:

```
.\scripts\release\Build-Launcher.ps1 -Root "$env:TEMP\ts-build" -NoPause
```

It needs the .NET 10 SDK and, for the native step, the Visual Studio 2022 C++
build tools ("Desktop development with C++"), which Native AOT links with, so
the native exe is published on Windows only. A plain `dotnet build
launcher\app\Thornswood.csproj` builds it with the JIT on any machine, Linux
included, which is enough to see whether it compiles. A resource added to the
launcher goes into Thornswood.csproj by the name the code asks for, and into
`THIRD-PARTY.md`, whose harness reads every resource the project embeds.

What the launcher does is written to its own log, `Profile\launcher.log`,
which is where to look first when anything about it is wrong, voice included.

## Where it runs

On every machine with Thornswood. A merge that changes the launcher or the
game files publishes a Velopack package of both
(`.github\workflows\merge-release.yml`, #4825); Velopack's Setup.exe installs
it, and each launcher updates itself from its channel's package on GitHub,
with every file checked against the signed release record before it goes in.
The dev build, on the dev channel, gets it first. Moved here from `tools\` on
25 September (issue #440, phase 7).
