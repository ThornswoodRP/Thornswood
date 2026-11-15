# A more modern launcher and installer: the options (#3209)

Patrick asked on 21 Oct 2026 for a more modern launcher and installer,
"whether that means changing the language it uses, the way it's built or
anything", and for the study to "actually look and see if a different
language would be beneficial". The rule for the pick is the issue's: the
one-time cost of rewriting is not a criterion and never a tiebreaker, what
people who play notice comes first, and where two options are equal for them
the differences for the team decide.

This page is the comparison and the recommendation. Patrick made the pick on
his report page on 26 Oct 2026 at 11:46 PM, and the pick is split into
smaller issues.

## Contents

- [Decided](#decided)
- [Where things stand today, measured](#where-things-stand-today-measured)
- [How it was measured](#how-it-was-measured)
- [The comparison](#the-comparison)
- [The options, with pros and cons](#the-options-with-pros-and-cons)
- [The installer](#the-installer)
- [Linux and the Steam Deck](#linux-and-the-steam-deck)
- [Recommendation](#recommendation)
- [Questions for Patrick, answered](#questions-for-patrick-answered)
- [Appendix: the Linux runs](#appendix-the-linux-runs)

## Decided

Patrick's picks, on his report page, 26 Oct 2026, 11:46 PM ([#3209](https://github.com/EvilPatrick06/Thornswood/issues/3209#issuecomment-6434829911)):

1. **The stack is C, Avalonia on .NET 10.** The launcher and the installer
   are rebuilt on it: [#4063](https://github.com/EvilPatrick06/Thornswood/issues/4063).
2. **Windows only.** No Linux or Steam Deck launcher is planned. Avalonia
   stays the pick on its other merits: C#, nothing to install on the machine,
   bindings checked when it builds, and it builds in the cloud.
3. **Size is no limit** on the launcher's download.
4. **The install moves into compiled code and Velopack.** `Setup-Thornswood.ps1`,
   `Setup.bat` and `Install.bat` retire ([#4064](https://github.com/EvilPatrick06/Thornswood/issues/4064)),
   and Velopack installs and updates the launcher.
5. **One update channel.** The game files update through Velopack too, with
   the feed's release record and its checks (the sha256 of every file, the
   signed manifest, the baseline record) rebuilt on top of it, not dropped
   ([#4065](https://github.com/EvilPatrick06/Thornswood/issues/4065)).

Settled by the One runs after the pick: Avalonia ships compiled to native
code. Measured on One, that build starts in 0.5 seconds and holds 135 MB in
one process; the build with the JIT took 6.5 seconds and 150 MB, and today's
launcher takes 3.7 seconds and 333 MB in eight ("The comparison").

## Where things stand today, measured

| | Today | Measured |
|---|---|---|
| Launcher | `Thornswood.exe`, WPF on .NET Framework 4.8.1, C# 13 | Main 1.2.5 is 3,937,024 bytes on the feed (26 Oct 2026), with the header art, the header video and the WebView2 DLLs inside it |
| What it needs on the machine | .NET Framework 4.8.1 and the WebView2 Runtime | Both come with Windows 11 22H2 and later; Windows 10 has 4.8 and needs the 4.8.1 update |
| Window | `launcher/ui.xaml`, about 1,480 lines, parsed at run time | A renamed control is not a build error; `scripts/dev/Check-Controls.ps1` stands in for the compiler |
| Music and voice | Hidden WebView2 pages (`MenuMusic.cs`, `Voice.cs`) | The music moved into WebView2 because WPF's own MediaPlayer needs the Media Feature Pack, which One lacks (`MenuMusic.cs`) |
| Self update | In house: `Updater.cs`, `SelfSwap.cs` | |
| Installer | `Thornswood-Setup.exe` (`installer/setup/Bootstrap.cs`, 2,126 lines) runs `Setup-Thornswood.ps1` (994 lines) in its window | The payload it fetches is 89,962,865 bytes (`/api/payload`, 26 Oct 2026) |
| Signing | Authenticode through Azure Artifact Signing, profile ThornswoodRelease | Launcher, installer and setup stub are all signed, and Ship refuses an unsigned one (`docs/SIGNED-RELEASES.md`, #3312). The issue's first point, "sign the binaries first", is done |

## How it was measured

One small prototype per stack, all the same window: the launcher's art across
1220 by 800, the word THORNSWOOD, a Play button that starts a process, and the
music playing ([prototypes/README.md](prototypes/README.md) has the contract and the code). The
native stacks play the music from their own process; the web view stacks play
it through an HTML `<audio>` element, the way the launcher does today.

- **Sizes** are measured on the Windows builds, made on One on 26 Oct 2026
  (a cloud session made the eleven that can be made off Windows first, and
  got the same sizes to within a few hundredths of a MB, apart from Wails,
  10.43 MB there with another Go). "Install"
  is every file the build needs beside it, "zip" the same files compressed,
  which is about what it adds to a download. Neither counts the art, the
  music or debug symbols.
- **Linux**: every stack that claims Linux was built for Linux and started
  under a virtual display in the same session (appendix). That answers "does
  it run there", not how fast: the display has no graphics card.
- **Start time, memory and the Volume Mixer entry** need a real Windows
  desktop. [Measure-Prototypes.ps1](Measure-Prototypes.ps1) builds all fourteen on One and measures
  each five times; its results go on #3209 and into the table below.

## The comparison

What the builds need beside them on a Windows 11 machine: "WebView2" means
the WebView2 Runtime, which Windows 11 has; ".NET 10" means the .NET 10
Desktop Runtime, which Windows does not have and whose installer is
60,035,296 bytes (10.0.14, 25 Oct 2026).

| Candidate | Language | Install MB | Zip MB | Needs on the machine | First start ms | Start ms | Idle MB, private / working set | Processes | Volume Mixer shows | Linux | Built in the cloud |
|---|---|---|---|---|---|---|---|---|---|---|---|
| WPF on .NET Framework 4.8.1 with WebView2 (today) | C# | 1.17 | 0.39 | .NET Framework 4.8.1, WebView2 | 4051 | 3696 | 332.8 / 534.4 | 8 | Microsoft Edge WebView2 | no | yes |
| WPF on .NET 10, framework dependent | C# | 0.16 | 0.08 | .NET 10 | 2042 | 2311 | 158.3 / 202.4 | 1 | its own name | no | yes |
| WPF on .NET 10, self-contained | C# | 61.85 | 56.62 | nothing | 2676 | 2833 | 212.9 / 293.3 | 1 | its own name | no | yes |
| WPF on .NET 10, self-contained, with WebView2 | C# | 63.00 | 57.13 | WebView2 | 12801 | 7324 | 372.7 / 652.1 | 8 | Microsoft Edge WebView2 | no | yes |
| WinUI 3, unpackaged, self-contained | C# | 225.98 | 90.40 | nothing | stops at start on One, see below | | | | | no | no (needs Windows tools, measured) |
| Avalonia on .NET 10, self-contained, trimmed (JIT) | C# | 19.82 | 14.87 | nothing | 7605 | 6450 | 150.2 / 200.2 | 1 | its own name | yes | yes |
| Avalonia, untrimmed | C# | 46.33 | 41.18 | nothing | not run | | | | | yes | yes |
| Avalonia compiled to native code | C# | 34.83 | 14.32 | nothing | 1523 | 488 | 135.2 / 164.1 | 1 | its own name | yes | no (native compile needs Windows) |
| Tauri 2 | Rust and the page in HTML | 3.17 | 1.44 | WebView2 | 3041 | 2497 | 266.3 / 511.0 | 8 | Microsoft Edge WebView2 | yes | yes |
| Slint | Rust | 8.21 | 4.68 | nothing | 12199 | 2275 | 79.2 / 131.5 | 1 | its exe name | yes | yes |
| egui | Rust | 7.86 | 3.73 | nothing | 2878 | 836 | 443.5 / 201.5 | 1 | its exe name | yes | yes |
| Wails 2 | Go and the page in HTML | 11.24 | 4.61 | WebView2 | 1486 | 645 | 250.8 / 432.3 | 8 | Microsoft Edge WebView2 | yes | yes |
| Electron 45 | TypeScript | 356.67 | 154.82 | nothing | no first frame in 30 s on One, see below | | | | | yes | yes |
| Qt 6 Quick | C++ | 105.39 | 57.45 | nothing | 1911 | 1031 | 108.4 / 127.8 | 1 | its exe name | yes | no for Windows |
| Flutter 3.47 | Dart | 24.55 | 10.49 | nothing | 3359 | 3330 | 224.5 / 237.2 | 1 | its own name | yes | no for Windows |
| Python (PySide6 or similar, frozen) | Python | not built | | | | | | | | | |

The Windows columns are the One runs of 26 Oct 2026, 10:47 to 11:33 PM, at
a0bddcec ([its results on #3209](https://github.com/EvilPatrick06/Thornswood/issues/3209#issuecomment-6434615789)),
and of 27 Oct, 12:11 to 12:21 AM, at 70ff2adb, for Avalonia compiled to
native code and egui ([its results](https://github.com/EvilPatrick06/Thornswood/issues/3209#issuecomment-6435352745)):
Windows 11 Pro, an Intel Core Ultra 9 185H, an RTX 4080 laptop GPU, 31 GB,
WebView2 Runtime 155. "First start" is the first start after the build,
"start" the median of the four after it; memory is three seconds after the
first frame, summed over the prototype and every process under it. "Its own
name" in the mixer is the app's name; "its exe name" is the file name, until
the exe is given a description. The Avalonia untrimmed row is from the cloud
build. egui holds more private memory than it has in memory: it has reserved
memory it has not touched yet.

Two rows have no times:
- **WinUI 3** stopped at its start on One with "Cannot locate resource from
  ms-appx:///Microsoft.UI.Xaml/Themes/themeresources.xaml" (exit code
  -1073741189). Those theme resources come from the app's resources.pri,
  which an unpackaged project makes only with `EnableMsixTooling`; the
  prototype now sets it. That fix is not yet run on Windows.
- **Electron** opened and was still running 30 seconds later without its
  first frame, and said nothing on stdout or stderr. The cause is not
  measured. The prototype now writes what happens on the way to its first
  frame (the page loading, whether Chromium sees the window as hidden, a GPU
  or page process ending) to a log the script keeps; on Linux that log shows
  each step and the ready.

Neither is the pick, so these two rows wait for whenever One next runs the
script (#4073); they change nothing in the decision.

What the run says, for the people who play:
- Every stack that draws its window in WebView2 (today's launcher, Tauri,
  Wails, WPF with WebView2) runs eight processes, holds 250 to 373 MB of its
  own, and shows in the Volume Mixer as "Microsoft Edge WebView2", not as
  Thornswood (#3207).
- The stacks that draw their own window run one process and hold 79 MB
  (Slint), 108 (Qt), 135 (Avalonia compiled to native code), 150 (Avalonia
  with the JIT), 158 to 213 (WPF on .NET 10), 225 (Flutter) and 444 (egui),
  and the mixer names them.
- Later starts: Avalonia compiled to native code 0.5 seconds, Wails 0.6,
  egui 0.8, Qt 1.0, Slint and WPF on .NET 10 2.3 to 2.8, Tauri 2.5, Flutter
  3.3, today 3.7, Avalonia with the JIT 6.5, and WPF with WebView2 in one file
  7.3. Why the Avalonia JIT build is slow was not measured; the native build
  is the one that ships, so it does not need to be.

Python was not built. Freezing a Python program into an exe (PyInstaller and
the like) unpacks the interpreter at every start, gives a large exe once Qt
is in it, and is among the things antivirus flags most often, which is the
worst place to be for the first program a new tester runs. None of that is
offset by anything Python does better here.

What the launcher being open means: it stays open while the game runs (the
feed is read every thirty seconds, `docs/FEED.md`), so its memory is taken
from a heavily modded Skyrim for the whole session. That makes idle memory
the number that matters most after the download.

## The options, with pros and cons

Each option below is a whole direction. Its pros and cons come first for the
people who play, then for the team.

### A. Stay on WPF, move to .NET 10

For people who play:
- Pro: the window looks and behaves as it does today, and WPF on .NET 9 and
  later has a Fluent theme for a newer look with little work.
- Pro: framework dependent it is the smallest download of all (0.08 MB
  zipped), once the .NET 10 Desktop Runtime is on the machine.
- Con: that runtime is not part of Windows. Either the installer fetches it
  (60 MB, once, and again when a new major version is wanted) or the
  launcher carries it self-contained, and then it is the second largest
  option here (57 MB zipped, against 0.39 MB today).
- Con: Windows only. No Linux or Steam Deck launcher, ever.

For the team:
- Pro: WPF and C# are what everybody who works here already reads, and
  Claude threads work well in it.
- Pro: measured: the .NET 10 SDK builds WPF on Linux, so cloud threads and
  Linux CI can build and check the launcher, which they cannot do today with
  .NET Framework and MSBuild.
- Pro: compiled XAML (an `x:Class` window with generated fields) makes a
  renamed control a build error and lets `Check-Controls.ps1` go.
- Con: WPF is in maintenance at Microsoft: fixes and the theme, few new
  features.

### B. WinUI 3 (Windows App SDK)

For people who play:
- Pro: the most native looking Windows 11 window of all: Mica, the Windows 11
  controls and animations.
- Con: Windows 10 1809 or newer and Windows only.
- Con: unpackaged and self-contained it carries the Windows App SDK runtime;
  measured on One it is 226 MB, 90 zipped, the largest after Electron.

For the team:
- Con: measured: it cannot be built off Windows (the Windows App SDK build
  needs Windows' own tools), so no cloud thread can build or check it, and
  every build goes to the Windows runners whose hosted minutes run out.
- Con: unpackaged WinUI 3 has more rough edges than WPF (window sizing,
  single file publish), and fewer people and examples to learn from.

### C. Avalonia on .NET 10 (C#, cross-platform)

For people who play:
- Pro: self-contained and trimmed it needs nothing on the machine and is
  15 MB zipped. Compiled to native code it started in 0.5 seconds on One,
  the fastest of all, and held 135 MB in one process (with the JIT: 6.5
  seconds and 150 MB).
- Pro: it draws every pixel itself with Skia, so the window looks the same on
  every Windows version, and themes and animation are first class.
- Pro: measured: it runs on Linux, so a Linux or Steam Deck launcher is a
  build away if Thornswood ever installs without Vortex (see "Linux and the
  Steam Deck").
- Con: it is not a Windows control set, so it looks like itself, not like
  Windows 11 (it can be styled to).
- Con: its open source packages have no web view control, so voice and the
  music need a native answer (#3208) or a wrapper around WebView2.

For the team:
- Pro: C# and XAML, close to WPF, so the same people and Claude threads work
  in it; compiled bindings make a renamed control a build error.
- Pro: measured: builds on Linux, so cloud threads and Linux CI can build it.
- Con: one more framework to keep up with than WPF; Avalonia moves faster
  than WPF (version 12 is current), so upgrades come more often.

### D. Uno Platform (C#, WinUI's API everywhere)

Not built: on Windows desktop it renders with Skia like Avalonia, so it lands
where Avalonia does on size and look, with WinUI's API. For people who play it
is the same as C. For the team it is a heavier toolchain and project layout
than Avalonia for the same result, so it is not taken further.

### E. Tauri 2 (Rust, the window is a web page)

For people who play:
- Pro: the smallest self-contained download of the lot (1.4 MB zipped).
- Pro: HTML and CSS make the most modern looking window the easiest to get,
  with animation and video.
- Pro: a built-in updater and installer bundler (NSIS or MSI).
- Pro: measured: runs on Linux (with WebKitGTK there).
- Con: the window lives in WebView2, the browser engine #3208 is asking to
  get away from: memory for a browser beside the game while it runs (One run
  numbers), and the Volume Mixer showing WebView2's processes (#3207).

For the team:
- Pro: Tauri is mature and well documented; measured, it builds for Windows
  from Linux (cargo-xwin), so cloud threads can build it.
- Con: Rust is a new language in the repository beside C#, PowerShell,
  JavaScript, Python and the engine's C++. Fewer people here read it.
- Con: two halves to keep in step, Rust for the work and HTML for the window.

### F. Slint or egui (Rust, native)

For people who play:
- Pro: small (4.7 MB and 3.7 MB zipped), nothing needed on the machine, and
  no browser at all.
- Pro: measured: both run on Linux.
- Con: egui redraws the window as a game would and looks plain unless every
  part is painted by hand; it suits tools more than a launcher.
- Con: Slint's widget set is smaller than WPF's or Avalonia's, so more of the
  window is built by hand.

For the team:
- Pro: measured: both build for Windows from Linux.
- Con: Rust is a new language here (as in E).
- Con: Slint is free for desktop programs under its royalty-free licence,
  which asks for an attribution in the program; egui is MIT.

### G. Electron (TypeScript)

For people who play:
- Con: measured: 155 MB zipped and 357 MB installed for this one window,
  which on its own is bigger than the whole payload a new tester downloads
  today (90 MB).
- Con: a whole Chromium beside the game while it runs; its memory comes from
  the One run.
- Pro: the most freedom for a web looking window, and a mature updater.

For the team:
- Pro: TypeScript and JavaScript are already in the repository (site, voice,
  gamemode).
- Con: every Chromium security release means a new launcher release.

### H. Wails 2 (Go, the window is a web page)

For people who play: as Tauri, a little bigger (4.2 MB zipped), with the same
WebView2 cons.

For the team: Go is not used anywhere in Thornswood; its Windows build is the
simplest of all (one `go build`, measured from Linux), but the stack has a
smaller community than Tauri and its next version is still in beta.

### I. Qt 6 (C++)

For people who play:
- Pro: native speed and a mature, themeable widget and Quick (QML) set.
- Pro: measured: runs on Linux.
- Con: its deploy set is 105 MB, 57 zipped (measured on One), and its web
  view (Qt WebEngine) is a whole Chromium if a page is ever needed.

For the team:
- Con: the free licence is the LGPL: Qt has to stay as separate DLLs that a
  person could swap, with its notices shipped. The commercial licence costs
  money, which is ruled out.
- Con: C++ is the language with the most ways to crash; the engine already
  uses it, but nobody works on a C++ window here.
- Con: measured: the Windows build needs Windows (MSVC and the Qt kit), so
  cloud threads cannot build it.

### J. Flutter (Dart)

For people who play:
- Pro: smooth, animated, fully themed windows; measured: runs on Linux.
- Con: an engine and runtime of its own beside the exe (25 MB, 10 zipped,
  measured on One), and audio and web views only through plugins.

For the team:
- Con: Dart is new here; the Windows build needs Windows and Visual Studio
  (measured: it cannot be made from Linux).

## The installer

Whatever the window is drawn with, the install itself has its own options.
They apply to every option above.

| Option | For people who play | For the team |
|---|---|---|
| Keep the C# bootstrapper running `Setup-Thornswood.ps1` | Works today; but a PowerShell script running hidden is what antivirus looks hardest at, and its progress is lines of text | Two languages for one job; the script is tested by the harnesses |
| The bootstrapper does the whole install in compiled code (the PowerShell retired) | One window, real progress, nothing for antivirus to read as a script | One language with the launcher; the install steps become testable code |
| Velopack (install and self-update for .NET, Rust and JavaScript programs) | Installs with no admin prompt, updates with deltas, one Setup.exe; by default it installs under the person's own profile, not in `<Root>\Launcher` beside the game, so either the layout changes or its install folder option is used | Replaces `Updater.cs` and `SelfSwap.cs` for the launcher itself; the game payload stays our own feed |
| WiX (MSI and a Burn bundle) | A classic installer with the Windows Installer rules, repair and uninstall | Heavy to write and debug; MSI's rules fight an install into a folder the person picks on any drive |
| Inno Setup or NSIS | Small, familiar installers | Their own script languages; the install logic moves from PowerShell into another scripting language |
| MSIX | Clean install and removal through Windows | The launcher writes beside the game and into the Steam copy, which MSIX's container makes hard; Windows only |

The study recommended that the game payload update (packs, the release
record, the client runtime) stay Thornswood's own feed, with only the
launcher's own update moving to a framework. Patrick picked one channel
instead (Decided, 5): the game files update through Velopack too, and the
feed's release record and checks are rebuilt on top of it (#4065).

## Linux and the Steam Deck

Every stack but WPF and WinUI 3 runs on Linux (measured). What a native Linux
launcher would get people today is limited by what it launches: the
collection installs through Vortex, which is Windows only, and the game
itself runs on Linux only under Proton. So a Linux build is worth having only
if Thornswood decides to install without Vortex, or to run its Windows
launcher under Proton, where a self-contained build with no WebView2 and no
.NET Framework has the best chance. Patrick ruled a Linux launcher out
(Decided, 2).

## Recommendation

The pick is made ("Decided" above). What was recommended before it, kept as
the record: **C. Avalonia on .NET 10, self-contained and compiled to native
code, with the install done in compiled code and Velopack for the launcher's
own updates, and no web view in the launcher once #3208 settles voice.**

Why, for the people who play: it needs nothing on the machine, it is 15 MB
zipped (WPF self-contained is 57, Electron 155), it carries no browser beside
the game if voice and the music move out of WebView2, and measured on One,
compiled to native code, it starts in 0.5 seconds and holds 135 MB where
today's launcher takes 3.7 seconds and 333 MB, in one process the Volume
Mixer names. Why, between the options that are equal for them, for the team:
it is C# and XAML, the language the launcher, the installer and the people
here already use, its bindings are checked when it builds, and it builds on
Linux, so cloud threads and Linux CI can build and check it while hosted
Windows minutes are short.

What the One run changed and did not:
- Compiled to native code, Avalonia starts faster than every other stack
  (0.5 seconds) and holds 135 MB, more than Slint (79) and Qt (108) and less
  than everything else. Slint's 56 MB less is the one number where another
  stack is better for the people who play; Slint starts in 2.3 seconds and
  is Rust. #4063 starts from the native build.
- Linux and the Deck are ruled out (Decided, 2), which made WPF on .NET 10
  (A) close for the people who play: one process, 158 to 213 MB, 2.3 to 2.8
  seconds. Patrick kept Avalonia on its other merits.
- #3208 still decides whether a web view stays for voice. Under any stack a
  web view costs about 250 MB and seven processes more, and the mixer entry.

Whatever is picked, and now decided:
1. Signing is already done (#3312).
2. The install moves out of PowerShell into compiled code, so
   `Setup-Thornswood.ps1`, `Setup.bat` and `Install.bat` retire (#4064).
3. The launcher and the game files update through Velopack, with the feed's
   release record and checks rebuilt on top of it (#4065, with #3201 and
   #3202).
4. The web view question is settled with #3208 before the window work
   starts.

## Questions for Patrick, answered

All five went on his report page on 27 Oct 2026 and were answered there on
26 Oct at 11:46 PM his time (Decided, above):

1. A Linux or Steam Deck launcher, given Vortex is Windows only: no, Windows
   only (A). The card recommended keeping the door open (B).
2. The download size that is acceptable for the launcher on its own: any
   size (C).
3. The stack: Avalonia on .NET 10 (C), the one recommended.
4. The installer: the install in compiled code, with Velopack (A), the one
   recommended.
5. Whether the game files share the launcher's update channel: yes, one
   channel through the framework, with the release record and its checks
   rebuilt on it (B). The card recommended two channels (A).

## Appendix: the Linux runs

26 Oct 2026, cloud session, a virtual display at 1920 by 1080 with software
drawing (no graphics card), four processors. Start is the time to the first
frame with the art, in milliseconds, for four runs; memory is the resident
size of the program and every process under it, so pages shared between
them are counted more than once. These say each stack runs on Linux; they
are not the Windows numbers.

| Build | Start ms | Memory MB | Processes |
|---|---|---|---|
| Qt | 2746, 277, 280, 292 | 182 to 188 | 1 |
| Slint | 398, 209, 220, 174 | 133 to 147 | 2 |
| egui | 508, 375, 237, 256 | 140 to 147 | 2 |
| Tauri (WebKitGTK) | 3019, 1023, 1031, 944 | 506 to 523 | 4 |
| Wails (WebKitGTK) | 408, 453, 428, 415 | 373 to 374 | 4 |
| Flutter | 755, 401, 408, 391 | 255 to 308 | 1 |
| Avalonia, trimmed | 988, 1088, 1031, 937 | 139 to 145 | 1 |
| Electron | 834, 253, 285, 318 | 656 to 759 | 7 |
