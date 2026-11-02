# Thornswood

Thornswood is a roleplay server for Skyrim Special Edition, built on
[SkyMP](https://github.com/skyrim-multiplayer/skymp), the multiplayer for
Skyrim. Fifty years after the civil war, a High King rules over the Jarls.
It has its own launcher, website, Discord bot and voice, all of them here.

It is in alpha and open by application. To join, apply in the
[Discord](https://thornswood.net/discord) and follow
[thornswood.net/join](https://thornswood.net/join). The game is not downloaded here.

- Something broken, or an idea: [thornswood.net/report](https://thornswood.net/report),
  the Discord, or a [new issue](https://github.com/ThornswoodRP/Thornswood/issues/new/choose).
  [SUPPORT.md](SUPPORT.md) says which fits.
- A security hole: never as an issue. [SECURITY.md](SECURITY.md) says where.
- Sending a change: [CONTRIBUTING.md](CONTRIBUTING.md), and
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for how we treat each other.
- [LICENSE](LICENSE): our code is MIT. [LICENSING.md](LICENSING.md): what it
  does not cover, and the terms for what you contribute.
  [THIRD-PARTY.md](THIRD-PARTY.md) and the [credits](https://thornswood.net/credits)
  name everybody else whose work it is built on, under their own licences.

Thornswood is not affiliated with or endorsed by Bethesda Softworks. The Elder
Scrolls and Skyrim are their trademarks.

## What is in here

- `launcher/`: the launcher's art. The program lives in `launcher/app/`
  (C# and Avalonia on .NET 10, the window in `MainWindow.axaml`), published
  with Native AOT by `scripts/release/Build-Launcher.ps1` from
  `launcher/app/Thornswood.csproj` and installed and updated by Velopack
  (#4823). See `launcher/app/ARCHITECTURE.md`.
- `installer/`: what a new person runs first. `installer/setup/` is the small
  setup program people download (one installer tree, not two products).
- `game/`: everything that runs as the multiplayer game on the server and
  clients:
  - `game/gamemode.js`: the server's gamemode
  - `game/data/`: gamemode tables
  - `game/plugins/`: Skyrim Platform JavaScript plugins
  - `game/ui/`: overlays inside the game
  - `game/menu/`: in-game menu pieces
  - `game/content/`: authored content
  - `game/required-data/`: data the client/server must have beside the build
- `site/`: the website. Public pages under `site/data/site`.
- `voice/`: proximity voice.
- `bot/`: the Discord bot (Python).
- `records/`: client and server build records, and code signing
  (`records/signing/`).
- `scripts/`: build, ship, and deploy scripts (`scripts/README.md`).
- `tests/`: harnesses. The build check runs all of them on main, and on a
  pull request built on the VPS only those its change can reach
  (`docs/AFFECTED-HARNESSES.md`).
- `docs/`: the update feed, the gamemode, the game's systems and a glossary.
- `engine/skymp/`: SkyMP fork submodule. Built by
  `scripts/release/Build-Engine.ps1` (`engine/README.md`).
- `lore/`: the world.
- `out/` and `local/`: build output and machine-local files that never go to
  GitHub (both gitignored).
- `config.example.json`: launcher `config.json` example matching
  `launcher/app/Config.cs` defaults (empty `UpdateToken`). Site example:
  `site/config.example.json`.

`bot`, `game`, `installer`, `records`, `scripts`, `site`, `tests`, `launcher`,
`installer/setup`, `records/signing`, `game/plugins`, `game/ui` and `voice`
each have a README of their own, which says what the folder is and how to
change it.

## Before changing anything

- [Developer-Guide.md](Developer-Guide.md): how to get the code onto your
  computer, open a pull request, ship a dev or main release, deploy the site
  and the gamemode, and post the news. Read it before your first change.
- [docs](docs): the update feed, the gamemode, the game's systems and a glossary.
  [engine/README.md](engine/README.md): building the SkyMP fork.
- [launcher/app/ARCHITECTURE.md](launcher/app/ARCHITECTURE.md): how the launcher
  starts, what each class owns and every step between Play and the game.

Everything reaches `main` through a pull request, and `main` is what ships.
