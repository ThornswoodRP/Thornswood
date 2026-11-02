# docs

Pages about how Thornswood works, for everybody on the team. The rules,
and the long form of each, are in the Developer Guide's pages under
[guide/](../Developer-Guide.md#the-pages), indexed by
[Developer-Guide.md](../Developer-Guide.md) at the root.

| Page | What it answers |
| --- | --- |
| [guide/](../Developer-Guide.md#the-pages) | The Developer Guide's pages, one task each, in the order a first day reads them: [Set up a machine](guide/set-up-a-machine.md), [Make a change](guide/make-a-change.md), [The rules](guide/rules.md), [The board, issues and test tasks](guide/the-board.md), [Settled design](guide/settled-design.md), [How work moves](guide/how-work-moves.md), [Release to dev](guide/release-to-dev.md), [Release to main](guide/release-to-main.md), [After a pull request is merged](guide/after-a-merge.md), [How the system fits together](guide/the-system.md), [The tools, A to O](guide/tools.md), [Secrets](guide/secrets.md), [Staff commands](guide/staff-commands.md). [Developer-Guide.md](../Developer-Guide.md) is their index. |
| [FEED.md](FEED.md) | The update feed launchers read: every field of version.json, who writes it, who reads it, and what happens when it is wrong. |
| [JSON-STATE-INVENTORY.md](JSON-STATE-INVENTORY.md) | Every critical JSON file, who writes and reads it, how it is checked, and the four records held to a version and shape (#2180). |
| [ICONS.md](ICONS.md) | Which icon file is which: Main launcher badge, Dev launcher monogram, site favicon. |
| [GAMEMODE.md](GAMEMODE.md) | How game/gamemode.js is laid out, where its data lives, how it is deployed and which tests cover it. |
| [GAMEMODE-SOURCE.md](GAMEMODE-SOURCE.md) | How gamemode.js becomes sources, data and a bundled artifact (#2181, Patrick decision D): measurements, loader limits, stages, and Build-Gamemode. |
| [GAMEMODE-COVERAGE.md](GAMEMODE-COVERAGE.md) | Which test drives each gamemode event handler, plugin, money function and chat word, and the gaps that were filled. |
| [DECIDED.md](DECIDED.md) | What was decided against and the settled rules of the game, each with the link where it was decided. Read before filing an idea. |
| [GAME-SYSTEMS.md](GAME-SYSTEMS.md) | Thornswood systems. The summary of every system, and a link from each section to the full plan. |
| [systems/](systems/) | The finished plan for each system, one page each. Where the server is now is the last section of the page. The item lists are [systems/lists](systems/lists/README.md). |
| [GLOSSARY.md](GLOSSARY.md) | The words used everywhere here, Keep, Hold, pack, baseline, door and the rest, one line each. |
| [../engine/README.md](../engine/README.md) | Building the SkyMP fork: the submodule, the configure line, the build and the records. |
| [studies/in-game-ui](studies/in-game-ui/README.md) | The options for voice, chat, emotes and the in-game UI without a browser (#3208): today's voice measured by room size, a box forwarder measured, each option's pros and cons, and the recommendations Patrick picks from. |
| [studies/launcher-stack](studies/launcher-stack/README.md) | The options for a more modern launcher and installer (#3209): every stack measured with the same prototype window, each option's pros and cons, and what Patrick picked. |
| [AFFECTED-HARNESSES.md](AFFECTED-HARNESSES.md) | Running only the gate harnesses a pull request can affect (#3114): the Linux study, the read map, the rules, and the trace of the gate on the VPS. |
| [DEPLOY-AGENT.md](DEPLOY-AGENT.md) | The box deploy agent (#5180): deploying a signed Release by its tag through the gate and rolling back, how a merge reaches the dev server by itself, what it holds, how it updates itself and how it is installed. |
| [SIGNED-RELEASES.md](SIGNED-RELEASES.md) | The signed release design (#2163): what gets signed and how, custody, rotation, revocation, the rollout that keeps every checksum, and the test-only pilot. |
| [CLEAN-INSTALL-RUN.md](CLEAN-INSTALL-RUN.md) | The checklist for a stranger's first install, and what each step should show. |
| [COLLECTION-CHANGES.md](COLLECTION-CHANGES.md) | How a mod is added, taken out or moved: a pull request to records/collection.json, its check, and the merge that drafts and publishes the revision (#5189). |
| [COLLECTION-REVISION-2.md](COLLECTION-REVISION-2.md) | The Vortex pass for collection revision 2, step by step, and the exact plugin order a clean install must land in. |
| [COLLECTION-REVISION-3.md](COLLECTION-REVISION-3.md) | Collection revision 3 (#1262): the Unofficial Skyrim Special Edition Patch at 4.3.8a, its two rules and the 49-position order. Local side only until published. |
| [COLLECTION-REVISION-6.md](COLLECTION-REVISION-6.md) | Collection revision 6: Thornswood Content 1.4, Atlas Map Markers SE out, and the cheddars_mashups.esl rule that ended LOOT's cyclic interactions (#4070), made in one run. |
| [COLLECTION-REBUILD-7ESSXF.md](COLLECTION-REBUILD-7ESSXF.md) | Rebuilding onto the 7essxf Nexus collection and the steps on the ship PC. |
| [COLLECTION-METHOD.md](COLLECTION-METHOD.md) | Why the mods come from a Nexus collection (half of the 15 September plan was reversed; it says which). |
| [VIRUSTOTAL-FALSE-POSITIVE.md](VIRUSTOTAL-FALSE-POSITIVE.md) | Historical notes on scanner flags and vendor reports. Publish no longer uploads to VirusTotal; signing (#390) is the trust path. |
| [JKS-SKYRIM.md](JKS-SKYRIM.md), [GOURMET-FISHING-PATCH.md](GOURMET-FISHING-PATCH.md) | Records of two mod decisions and the patch made for one. |
| [LIGHT-ORDER-DRIFT.md](LIGHT-ORDER-DRIFT.md) | Every light plugin form id the live and the dev world stored, which plugin each was for, which have drifted with the light order, and the one-time move (#1715). |
| [NPC-POPULATION.md](NPC-POPULATION.md) | NPC population catalogue from the winning records in the load order. |
| [NPC-SERVER-ACTIVITY.md](NPC-SERVER-ACTIVITY.md) | Shared NPC activity on dev and main: who owns placed identities, movement, combat and return. |
| [npc-server-runtime.md](npc-server-runtime.md) | Dev NPC loading and first unattended activity. |
| [NPC-WORLD-PLAN.md](NPC-WORLD-PLAN.md) | NPC world work: town cut, habitat rules, rates and merchant quests. |

The pages about running the box (what runs where, restoring it, moving it,
what to do when it is down, its service objectives, who holds each account
and key, how it is reached and the runners on it), the site's operator
facts, the merchant work's planning notes, and the dated notes from before
the repository went public are kept by the team in a private repository.

Every page cites file and line for what it says. When a page and the code
disagree, the code is right: fix the page in the same pull request.
