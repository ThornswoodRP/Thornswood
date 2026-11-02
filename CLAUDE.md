# Build and test tips

Run everything from the repository root, in PowerShell 7 (`pwsh`). The
launcher and the engine build on Windows only. Developer-Guide.md has the
long form of every step, and CONTRIBUTING.md says how a change is sent.

## Build

- The launcher needs the .NET 10 SDK and the Visual Studio 2022 C++ build
  tools ("Desktop development with C++") for its Native AOT publish;
  `.\scripts\release\Build-Launcher.ps1 -Root $env:TEMP\launcher-try -NoSign -NoPause`
  builds it into a folder of its own. `dotnet build launcher\app\Thornswood.csproj`
  compiles it on any machine, Linux too.
- The gamemode is `game\gamemode.js` as it is; `docs\GAMEMODE.md` says how
  it is laid out and deployed.
- The engine (the SkyMP fork in `engine\skymp`): `engine\README.md`.

## Test

- One harness: `node tests\test-<name>.js`, or
  `pwsh -NoProfile -File tests\test-<name>.ps1`, or
  `python tests\test-<name>.py`. Each prints a PASS or FAIL line per check
  and exits with 1 when any check fails. Its header says what it checks.
- A harness that needs Windows PowerShell 5.1 or a Windows tool prints SKIP
  for those checks elsewhere.
- Before a push, what the change can reach, picked as the build check picks
  it, once the change is committed: `pwsh scripts\dev\Check-Change.ps1`.
- The whole gate, on this machine:
  `.\scripts\dev\Run-Gate.ps1 -Throttle 6`.
- The writing in every file people read: `pwsh scripts\dev\Check-Words.ps1`.

When one harness fails, work on that one and run it alone until it passes,
then run the gate.
