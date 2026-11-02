# After a pull request is merged

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

Merging on GitHub changes nothing anybody sees. You run the rest from the
repository folder. Any developer may, except a main release, a hotfix and a
live deploy, which wait for Patrick's word.

1. `git checkout main`, then `git pull`. Ship.ps1 refuses a main release
   that is behind origin, so the pull comes first.
2. Then one command for each part the pull request touched. The note on a Ship is the one in [Say so, then write the note](release-to-dev.md#say-so-then-write-the-note). A pull request that touches several of these gets every one of them, in the same sitting, so nothing goes out half done. When it changed `game\content\Thornswood-Content.esp`, the server command goes before the Ship: `Deploy-DevGamemode.ps1 -LoadOrder` for dev, `Deploy-Server.ps1 -GamemodeOnly` for live ([The content plugin goes to the server first](release-to-dev.md#the-content-plugin-goes-to-the-server-first)).

| You changed | Run |
| --- | --- |
| The launcher (`launcher\app`, the art and video that Build-Launcher.ps1 embeds), the game plugins (`game\plugins`), or anything else that goes out in a pack | `.\scripts\release\Ship.ps1 -Channel dev "what changed"`. The dev build is where it goes first, by the dev-first rule in How work moves. `.\scripts\release\Ship.ps1 "what changed"` with no channel is the live one, for a security fix, for something that leaves the game untestable, or for work the team has agreed goes live. |
| The gamemode on the dev server | `.\scripts\deploy\Deploy-DevGamemode.ps1` |
| The gamemode on the live server, `game\gamemode.js` and `game\content\Thornswood-Content.esp` | `.\scripts\deploy\Deploy-Server.ps1 -GamemodeOnly`, from any machine |
| The live server build, or the live settings Deploy-Gamemode writes | `.\scripts\deploy\Deploy-Gamemode.ps1`, then `.\scripts\deploy\Deploy-Server.ps1`, from a machine with the fork built |
| The site's app or `site\public` | Nothing. The merge's Release carries it and the box deploy agent puts it in within minutes ([docs\DEPLOY-AGENT.md](../DEPLOY-AGENT.md)). `Deploy-Docs.ps1` sends no app once the agent has the site; it is for the documents, the boards and the password. |
| The public pages, `site\data\site\*.md` | Nothing. They ride the same Release, and `Deploy-Docs.ps1 -Site` is refused once the agent has the site. |
| The bot's code or join card art in `bot` | Nothing. The merge's Release carries it and the deploy agent swaps it in. `Install-Bot.ps1` is for the service, its libraries and its token. |
| The bot's avatar, `bot\thornswood-bot-*.png` | No script sends it. Upload it by hand in the Discord developer portal. |
| The voice service, `voice\voice-server.js` or `voice\headlines.js` | Dev voice: nothing, it goes in with the merge's Deployment to Dev. Live voice: `.\scripts\deploy\Install-Voice.ps1` |
| Scripts that only change how a release is built (Ship.ps1, Publish-Update.ps1, the Deploy scripts) | Nothing more. The pull is the change. |

3. Everybody else, once it is out, from the main folder: `git checkout main`, then
   `git pull`. If the branch had its own folder, `git worktree remove
   ..\<that folder>`. Then `git branch -D <name>/what-it-is`, after GitHub
   shows the pull request as merged; GitHub squashes the merge, so
   `git branch -d` refuses. A file the branch added that also sits untracked
   in the main folder stops the pull, so delete that copy first.
