# The test harnesses

## What they are

Every `test-*.js` and `test-*.ps1` here checks one thing the scripts, the
launcher, the plugins, the gamemode or the site promise, by reading the files
or by running a piece of them against a scratch copy. None of them talks to
the VPS or to GitHub unless it says so at the top (`test-branch-rules.js
--live` is one that does; `test-collection-revision-2.ps1` reads both
servers' manifests over plain HTTP unless given `-Offline`). One that asks a
GitHub repository which commits a branch has asks git, through
`tests\fork-git.js`, and not GitHub's REST API: signed out, that allows 60
requests an hour per address, and a cloud thread's address is shared (#3052).
The nightly checks (`.github/workflows/nightly.yml`) run every one of them
on the VPS each night and open an issue when one fails; on a pull request,
run the ones your change touches yourself.

Most of them run on every pull request as well, in the build check
(`.github/workflows/build.yml`, the job "gate", in five shares on five
runners at once): every
`test-*.js` and `test-*.ps1` here that `gate-excluded.txt` does not name, as
`scripts\dev\Gate-Harnesses.ps1` lists them when the build runs (issue
#3009). A new harness is on that gate the moment it is in this folder, and
touches no shared line; say in its header why it exists. To keep one off the
gate, add a line to `gate-excluded.txt`, `name  reason`, in name order. A
harness build.yml runs in a step of its own (`test-old-name-gone.js`, issue #497)
has a line there too, "own step in build.yml", so the gate does not run it
twice. The "not sorted yet" lines are minutes together, which is why they
come onto the gate a few at a time.

The voice service's own harnesses are beside it in `voice\tests\`, and the
bot's Python ones in `bot\`, because they are run from there.

## Beside their product

The repository's folders are being grouped by product, with each product's
harnesses beside its code (plan line 42, 1 Nov 2026), one product at a time.
A product's harnesses go in a `tests` folder of its own, one folder below the
top: `launcher\tests\`, `site\tests\`. This folder keeps the checks that are
about the whole repository (the gate, the words, the secrets, the scripts'
paths), the shared helpers (`Windows.ps1`, `Launcher-Csc.ps1`,
`launcher-csc.js`, `fork-git.js` and the rest) and `fixtures\`, and every
harness whose product has not moved yet. Moved on 1 Nov 2026: the launcher's
(`launcher\tests\`), voice's (`voice\tests\`), the setup program's
(`installer\tests\`) and the site's (`site\tests\`). Its harnesses are no part of the launcher:
`LauncherVersion.ps1` and Ship's launcher fingerprint leave that folder out,
so a change to one gives no launcher a new number.

The gate and the nightly find both kinds through one list,
`scripts\dev\Harness-Files.ps1`. A harness here goes by its file name, as
before; one beside its product goes by its path from the repository with
forward slashes, `launcher/tests/test-498-msbuild.ps1`, in the gate's report,
in a pull request's pick, in `gate-excluded.txt` and in
`Nightly-Harnesses.ps1 -Only`. A shared helper stays here. A `.ps1` harness
beside its product reaches it from the repository folder, the shape
`test-2957-windows-one-way.ps1` looks for, and a `.js` one two folders up:

```
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')
const lc = require('../../tests/launcher-csc');
```

A check that reads a whole product folder for something its code must never
do leaves that folder's `tests` out, since a harness names the very thing it
looks for (`test-browser-args.ps1`, `test-3003-one-install-rule.ps1`).

Moving a product's harnesses is one pull request for that product, and only
while no open pull request changes any of them: a moved file and an edit to
it in another pull request conflict. The move changes, in that same pull
request, every line that names a moved harness by its old path, here, in the
workflows, in the scripts' comments and in the docs.

## Where they look

They moved here from `tools\` on 25 September (issue #440, phase 5), and
`tools\` itself went on 29 September (phase 10). Each one finds the repository
folder from here, one folder up: a `.js` harness through `REPO_DIR`, declared at
its top as `path.join(__dirname, '..')`, and a `.ps1` harness through the line
after its `$Here = $PSScriptRoot` that points `$Here` at the repository folder.
One beside its product is two folders below the top, so its `REPO_DIR` is
`path.join(__dirname, '..', '..')` and its `$Here` goes up twice.
A new harness does the same; copying the top of an existing one is the easy way.

## Running them

From the repository folder:

```
node tests\test-farming.js
pwsh -NoProfile -File tests\test-ship-rules.ps1
```

and one beside its product by its path, `pwsh -NoProfile -File
launcher\tests\test-498-msbuild.ps1`.

Each prints a PASS or FAIL line per check and ends on `N passed, M failed`,
and exits 1 when anything failed. A harness that reads something only one
machine has, such as the game folder, says SKIP for that part and checks the
rest.

Those lines are what the gate's report is made of (#5295). Every line that
starts PASS, FAIL, SKIP or NOT RUN, after any spaces, is one check, named
by the rest of the line, in the report scripts\dev\Nightly-Harnesses.ps1
-Report writes and on the run's page. So give each check a line of its own
that names it, and print nothing else that starts with one of those words.

## A harness that needs Windows

Windows PowerShell 5.1, cmd.exe, a scheduled task, a folder's ACL and the
.NET Framework are only on Windows, and the harnesses also run under pwsh on
Linux. A `.ps1` harness that needs any of them dot-sources `tests\Windows.ps1`
and asks `$OnWindows` before it names a Windows path:

```
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the runs: they need Windows PowerShell 5.1, which only Windows has'
    Done
}
$ps51 = Get-WindowsPowerShell
$cmd = Get-WindowsPath 'System32\cmd.exe'
```

Off Windows it says SKIP for that part and checks the rest, or, when the
whole harness is about Windows, prints one `NOT RUN` line saying why and
exits 0. When what it runs on the box can run here as well, it may run it in
this shell instead, and says so on a `NOTE` line. On Windows,
`Get-WindowsPowerShell` fails the harness when powershell.exe is not where
Windows keeps it, rather than letting it skip or run pwsh in its place. A
harness that loads `tests\Launcher-Csc.ps1` has `$OnWindows` from it too.

Before issue #2957 each harness found these itself, by joining onto
`$env:SystemRoot` or asking `Get-Command` for powershell.exe, and copied the
line from the harness before it; off Windows the join stopped harness after
harness on its first lines. `test-2957-windows-one-way.ps1` fails on a
harness that names `$env:SystemRoot` or `$env:WINDIR`, runs powershell or cmd
by name, asks `$IsWindows` (which 5.1 does not have), or uses `$OnWindows`
without loading `Windows.ps1`.

The temp folder is `[IO.Path]::GetTempPath()`, never a path built on
`$env:TEMP` or `$env:TMP`, which only Windows sets (#2965). A harness may set
TEMP for a script it runs and put the old value back; `test-temp-folder.ps1`
fails on any other read of them.

A path a harness compares with what a script prints is built with
`Join-Path` or `[IO.Path]::Combine`, and a key written with `\`, like the
swallow baseline's, is made from a path by replacing
`[IO.Path]::DirectorySeparatorChar`. Off Windows `\` is part of a file name.

A `.js` harness does the same with `process.platform === 'win32'`: off
Windows it says SKIP for the part that needs Windows, with why, and checks
the rest. A path it builds from a name written with `\` splits the name
first (`path.join.apply(path, [dir].concat(rel.split('\\')))`), and a script
that reads the game folder matches each folder and file in any case, as
Windows does (`Check-SkyUIMenus.js` `looseFile`). Launcher C# is built by
`tests\launcher-csc.js` (`build`, `run`, `buildProject`), which works on any
machine with the .NET SDK; the bot's Python is `tests\bot-python.js` (#3005).

## A harness that compiles launcher code

A `.ps1` harness that compiles C# out of `launcher\app` dot-sources
`tests\Launcher-Csc.ps1`, which builds it the way
`launcher\app\Thornswood.csproj` does: the .NET 10 SDK, the project's target
framework, `LangVersion` and packages (#4823). That works on Linux as well as
on Windows, so the harness builds and runs the code everywhere, and says SKIP
only for a part where the code under test itself does something only Windows
has (a kernel32 call, an NTFS hard link). `Add-LauncherType` loads a library
into this PowerShell, which runs on .NET 10 too; `Build-LauncherCode -Exe`
with `Invoke-LauncherExe` runs a driver as a program; `-Launcher` builds the
whole launcher beside it; `Add-LauncherAssembly` builds the project itself.
The file's header has every switch. A build throws with the compiler's words
when the code does not build:

```
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
$asm = Add-LauncherType -Source $configSrc, $stub
$T = $asm.GetType('Thornswood.Updater')
```

A few launcher files are also loaded by scripts with `Add-Type`, which under
Windows PowerShell 5.1 is the .NET Framework's own compiler: C# 5, and none
of .NET 10's libraries (`scripts\mods\LoadOrder.ps1` loads
`VortexProfileState.cs`, `scripts\mods\Generated.ps1` loads `Generated.cs`
and the files beside it, `scripts\release\Go.ps1` loads `LastPlugin.cs` and
the `FromGame*.cs` files). A harness for such a file (`test-2791-last-plugin`,
`test-2827-from-game`, `test-vortex-profile-state`) dot-sources
`tests\Framework-Csc.ps1` as well and builds the file with
`Build-FrameworkCode` too: a .NET Framework 4.8 project at C# 5, through the
same .NET SDK, which fetches the Framework's reference assemblies as a
package, so it works on Linux as well. So a file that only .NET 10 compiles
fails in the harness, not on the machine that runs the script. It is for
compiling only; off Windows there is no .NET Framework to run the result on.
The file's header has every switch:

```
. (Join-Path $PSScriptRoot 'Framework-Csc.ps1')
$null = Build-FrameworkCode -File (Join-Path $App 'VortexProfileState.cs') -Reference System.Xml
```

Before issue #2821 eighteen harnesses compiled launcher code with `Add-Type`
or a `CSharpCodeProvider`, copied from one to the next: C# 5 under Windows
PowerShell and .NET 8's libraries under pwsh, never the build's compiler.
`test-2821-launcher-compiler.ps1` fails on a harness that names launcher or
setup code and gives `Add-Type` anything but C# written out in full in the
harness itself (a stand-in server or a probe of a Windows call is that), or
makes a `CSharpCodeProvider`.

## A harness that reads a child's error

pwsh's default error view wraps a script error's message at the console's
width, at a space, and starts the next line with `     | `. A check that looks
for a phrase in that text then passes or fails by how long the temp folder's
path is and how wide the console is: on 20 October two checks failed only on
the runners whose profile folder names are 16 characters longer (#2933). A
child whose error a check reads runs with `$global:ErrorView = 'NormalView'`,
which prints the message as written: as the first line of the script it
writes, or through a launcher like `Child` in `test-bad-json-records.ps1`.

## A harness that starts a service

Several builds run at once on the VPS and share its 127.0.0.1, so a harness
never gives a service a fixed port. It asks the system for one nothing holds
(listen on 0 and read the port back) and passes it in through the setting the
service already reads, `THORNSWOOD_VOICE_PORT` or `THORNSWOOD_DOCS_PORT`. A
server in the harness's own process listens on 0 and is asked on the port it
got. One that starts the voice service or the site asks nothing of the port
until that copy has printed its own `[voice] listening on` or
`[thornswood-docs] listening on` line for it, and fails saying so when the
service stops first because something else took the port. Before issue #1703
a run read another run's `/health` as its own, and before #1727 twelve site
harnesses polled the port they had let go until anything answered.
A `.ps1` harness does the same with its `Wait-OwnLine`, which reads the
child's output up to that line, and so does any stand-in it starts on a port
it let go (the GitHub stand-in in `test-site-assets.ps1`, the game server in
`test-record-sync.ps1`); before #1755 five of them drained the output unread
and polled the port. `test-1703-test-ports.js` fails on any `.js` harness here
or in a product's tests folder that names a fixed port, or on any `.js` or `.ps1` harness that
starts the site without waiting for that line.

## A harness that runs the launcher's voice

Since #4823 the launcher's voice is C# (`launcher\app\VoiceSession.cs` and
the `Voice*.cs` beside it), not the page `voice-host.html` that harnesses ran
in node's vm. A `.js` harness runs it with `tests\voice-launcher.js`, which
builds `tests\voice-launcher\VoiceDriver.csproj` with the .NET 10 SDK on any
machine, into the temp folder, and starts one copy per launcher. The driver
compiles the launcher's own voice files with a stand-in only for the Windows
audio (a tone for a microphone, and the session's own mixer read back for the
speakers), and is driven by JSON lines: `clock: 'manual'` with `wire: 'fake'`
runs the session's jobs and timers only when the harness says, against
sockets the harness answers for the service, and `clock: 'real'` with
`wire: 'ws'` connects it to a voice service the harness started, with real
connections between launchers. The header of `voice-launcher.js` has the
calls.

`test-voice-hrtf.js` holds the launcher's HRTF panner (`launcher\app\VoiceHrtf.cs`)
to Chrome's own: the driver's `--hrtf` tool renders a signal through it, and
`tests\chrome-audio.js` renders the same signal through a PannerNode in a
headless Chrome over the DevTools protocol, with node's own WebSocket and no
packages. `chrome-audio.js` finds Chrome on its own (CHROME names one); with
none on the machine those checks say SKIP.
