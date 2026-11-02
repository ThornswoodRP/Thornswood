# The site

## What it is

The Thornswood website, https://thornswood.net, as plain node with nothing to
install from npm: `server.js` starts it, and `lib\` holds the rest, one module
per area (#5357). Each module says at its top what it holds, and `server.js`
names them in the order they load. It serves the public pages
(`data\site\*.md`), the news, the installer download and the member pages
behind the password, and after a Discord sign in, the admin hub and its boards
(`data\*.md`, `data\board.json`). It is also the door: the game servers and
the launchers ask it who may play (`/api/allowed`, and `/dev/api/allowed` for
the dev server), and it answers from the Discord roles in its config.
`public\` holds the pages and the art it serves as they are.

These are what ask it for something other than a page, and each of them stops
working while the site is down. `/api/play/join` is the launcher's question
before every launch; when the site does not answer, a yes from the last 72
hours still starts the game (`GraceHours` in `launcher\app\Door.cs`) and nothing
else does.

| Route | Method | Asked by |
| --- | --- | --- |
| `/api/play/join` | POST | the launcher, before every launch (`launcher\app\Discord.cs`) |
| `/api/play/start`, `/api/play/end`, `/api/play/logs` | POST | the launcher, as a session starts, as it ends, and with the logs after (`launcher\app\Discord.cs`) |
| `/api/play/roster` | POST | the launcher, for the names on the character cards (`launcher\app\Roster.cs`) |
| `/api/play/pass` | POST | the launcher, when a character is picked at the game's menu and every minute while the game runs: a join pass the game server checks, or a plain no (#937, `launcher\app\Discord.cs`, which `launcher\app\JoinPass.cs` calls) |
| `/auth/discord` | GET | the launcher's link button, through the browser; Discord sends the browser back to `/auth/discord/callback` (`launcher\app\Discord.cs`) |
| `/api/allowed`, `/dev/api/allowed` | GET | each game server's door, every five minutes, with the bot's key; the dev server's `door.json` names the site with `/dev` on the end (`game\gamemode.js`) |
| `/api/roster` | POST | the game server, with the bot's key, when its book of characters changes (`game\gamemode.js`) |
| `/api/economy`, `/dev/api/economy` | POST | each game server, with the bot's key, every five minutes: what each hold gathered, crafted and traded, by the day, for the hub's Hold economy page (#3164, the hold economy block in `game\gamemode.js`) |
| `/api/office`, `/dev/api/office` | POST | each game server, with the bot's key in a header, when a Jarl names or removes their hold's Court, Steward or Guard on the Office page of K; the site checks the Jarl's role again and sets the Discord role with the bot's token, and the game reads it back through `/api/allowed` (#2551, `game\gamemode.js`) |
| `/api/play/owns` | POST | the voice service, before it keeps a character creation choice (`voice\voice-server.js`) |
| `/api/ticket` | POST | the Discord bot, for a support ticket (`bot\bot.py`) |
| `/api/public` | GET | the front page and the launchers, for the news and the files; the Discord bot, for the open switch and the hints and lore lines it shows as its status, from `data\site\lines.md` (#3147, `bot\bot.py`) |
| `/api/report/game`, `/dev/api/report/game` | POST | each game server, with the bot's key in a header, when somebody types /helpme or /report; the row goes into the inbox and the bot says it in the staff channel (`game\gamemode.js`, the asking staff block) |
| `/api/play/who` | POST | nothing in the repo asks it now. It says who a ticket belongs to and writes nothing, which makes it the one to try by hand |

The downloads under `/file/` are only what `files\files.json` publishes: a
name it lists and does not mark hidden, and `files.json` itself. Anything else
put in that folder answers 404 and is not on the Downloads page (#3798).

The installer is not in that folder since #4824. It is Velopack's setup
program, which `merge-release.yml` makes and signs, and `/file/` answers
302 to its GitHub Release copy (`newestSetup` in `lib/feed.js`):
`/file/Thornswood-Setup.exe` to the one on the newest Release `main-<tag>`,
which the approval step publishes once a build is approved (#5181), and
`/file/Thornswood-Dev-Setup.exe` to the one on the newest build Release
(`build-YYYYMMDD.N`). Until there is one, the name answers 404 and the
Downloads page says the installer is not published yet. The old installer's
exe and payload zip, which `Publish-Installer` left in the folder, are never
served or listed, whatever `files.json` still says. `/api/payload`, which the
old setup program asked for its zip, is gone with it.

Every request that is not a GET has to come from this site (#1367). A
browser names the page that sent it in `Origin`, or in `Referer` when an old
one leaves `Origin` off, and either has to be this site's own address, the
one the request was sent to; `Origin: null` is not. One that names no page
and carries a sign in cookie is a browser with both taken off, and is refused
as well. None of the POST routes in the table above is sent by a browser:
they carry no cookie and neither header, and each proves itself with a
ticket or the bot's key, so none of it is touched. A
refusal is 403 with `why` set to `cross-site` before anything is read or
Discord is asked, and `site.log` says what was refused and where it said it
came from. The sign in cookies are still `SameSite=Lax`; this is what holds
when a browser too old for that sends them on another site's form anyway, or
a page on another name under thornswood.net does. A GET changes nothing
another page can choose. `site\tests\test-1367-cross-site.js` sends every kind of
write the hub makes from another site and from this one.

## On your machine

It needs node and nothing else. Run it from a copy of this folder rather than
from the checkout, because it writes beside itself: `config.json` with a fresh
cookie secret, `site.log`, the `files\` and `uploads\` folders, and anything
typed into a board or a page in the browser goes into `data\`, which git
tracks. Copy `config.example.json` into the copy as `config.json` first. It is
every setting the site reads, holding what it runs on when there is no
`config.json` at all: an empty member password, the roles, and every Discord
setting, the bot's key and the cookie secret empty. Empty Discord settings are
what keep a copy on your machine from asking Discord anything. The empty
password is not a password: the first start writes a random one and prints it
once. A
`config.json` already in this folder is that machine's own, and git ignores it;
leave it where it is rather than copying it. From the copy:

```
$env:THORNSWOOD_DOCS_PORT = '3101'; $env:THORNSWOOD_DOCS_LOCAL = '1'; node server.js
```

then open http://127.0.0.1:3101. Left unset it listens on every address on
3001. Without a `config.json` it runs on the defaults written in `lib\config.js`,
makes a random member password, prints it once, and keeps it in the
`config.json` it writes. A later start does not print it again. Discord sign
in and the role checks are off, since there is no client id or bot token. The game status and
the chat under each session read files that only exist on the VPS
(`C:\Thornswood-Server\data\online.json`, `C:\Thornswood-Voice\chat`, and
`C:\Thornswood-Voice-Dev\chat` for a dev session), so locally the game shows
as down.

To see the door answer, from a second window:

```
curl.exe -i -X POST -H "Content-Type: application/json" -d "{}" http://127.0.0.1:3101/api/play/who
```

It answers 401 with `{"ok":false,"why":"link"}`, because no ticket was sent.
It is POST only: a GET answers 401 as well, but from the sign in gate with
`sign in first`, which says nothing about the door. `curl.exe` rather than
`curl`, because in Windows PowerShell `curl` is another name for
Invoke-WebRequest. With no bot token the copy counts every Discord account as
allowed in, so a ticket signed with the `secret` it wrote into its own
`config.json` gets a 200, which is how a change to the door can be tried
without Discord. `tests\test-site-local.js` does all of this against copies in
the temp folder, and never reads a `config.json` out of the checkout.

## Where it runs

On the VPS in `C:\Thornswood-Docs`, started by the scheduled task
`Thornswood Docs`, answering on 127.0.0.1:3001 only. Caddy holds ports 80 and
443 and the certificate in front of it (`scripts\deploy\Caddyfile` is the reference
copy of the live `C:\Thornswood-Caddy\Caddyfile`), and `Setup-Domain.ps1` is
what set `THORNSWOOD_DOCS_LOCAL=1` there. Its `config.json` on the VPS holds
the member password, the Discord client secret and bot token, the bot's key
and the cookie secret, and is never in the repo. `.\scripts\deploy\Deploy-Docs.ps1`
sends `server.js`, `lib\` and everything in `public\` and restarts the task, and
`-Site` also sends the public pages. A plain deploy never overwrites a
document somebody has typed into on the site; `-Boards`, `-Docs` and
`-SeedDocs` do, after a `.bak` of each. `-Board active` replaces that one board
inside the live `board.json` and leaves every other board as typed. The
public Known Issues page (`/known`) and the roadmap (`/roadmap`) are not
boards: the bot writes both from the issue board into `data\from-bot\lists.json`,
which the site makes and reads (#3140; bot/README.md, "The site's known
issues and roadmap"). `-Password` asks for the new member
password without showing it, never typed on the command line, where the
shell's history would keep it. `-Password` reads the `config.json`
on the VPS, changes the member password in it and keeps every other setting.
A `config.json` there that will not read as JSON, an empty one included, is
left exactly as it is and the password is not changed.
`tests\test-docs-password.ps1` runs that part of the script against copies.

`GET /api/deploys` says which commit, zip and hash each part on the box runs
and when each last went out, read from the records the deploy scripts leave
in `C:\Thornswood-Deploys\current` (`scripts\deploy\Artifact.ps1`;
`THORNSWOOD_DEPLOYS_DIR` points a copy somewhere else). It is staff's, by the
same `w.dev` the other staff doors ask (#1359): a caller with no cookie gets
`401 sign in first` and a hub member who is not staff `403 staff only`, and
no record is read before either refusal. It used to answer anybody, which
told a stranger which source is live to the hour and when each part was last
touched. Nothing in the repo fetches it and no page draws it, so the caller is
a person asking what is deployed; sign into the hub first.
`tests\test-deploy-records.js` asks a scratch copy as all three callers.

The pages, the downloads, the hub and every route in the table above are one
node process. A route that throws is answered 500 and the rest carry on, and a
throw in a timer is logged and carried on from, so a broken page does not take
the door with it. What one process cannot keep apart: anything that holds its
event loop holds the door for as long, and every `Deploy-Docs.ps1` restarts the
door along with the pages. `tests\test-site-local.js` measures the first two
against a copy: with a page made to throw, `/api/play/who` still answers its
401, and with a page made to hold the loop for a second and a half, the same
question waits until it lets go.

## The site log

`site.log` sits beside `server.js` and rolls at 4 MB, keeping `site.log.1` to
`.5`. If a roll fails (usually a rotated file held open by an editor, a tail
or a backup, or the folder losing delete rights), the site says so once, on
the console and in the log, with the file and the error, and tries again
every minute rather than on every line. The active file has an emergency
ceiling of 8 MB (twice the roll size): past it one line says so and the file
stops growing, with lines going to the console only, until a roll works,
which is said once too. `site\tests\test-2189-log-rotation.js` covers it. Disk
space for the folder as a whole is a storage alert (#2178), not this.

## The gallery

The public gallery is `data\gallery.json`, a list of `{ name, url: '/shot/'+name,
by }`. `/api/public` hands it out under `gallery` and `GET /shot/<name>` serves
the file from `uploads\` only when the name is on that list. A picture reaches
that list through a queue an admin approves, so nothing a stranger sends is
public until somebody says so. The queue is `data\gallery-pending.json`, an
array that starts `[]`, deployed by the same rule as every other data JSON
(`Deploy-Docs.ps1` sends a data JSON only when the VPS is missing it, so the
queue is never overwritten once it exists there). `/api/public` and `/shot`
never read the queue.

A shot that is still in that queue is not on `/shot` yet, so the only address
that serves it is `GET /up/<name>`, the uploads door. That door asked for the
hub member cookie alone, which left the queue page and the launcher showing
broken pictures to the very roles allowed to decide on them, so a name on
`gallery-pending.json` now goes through `galleryStaff` there as well (#755):
the hub cookie of an `access.dev` account, or a launcher ticket for one, and
`st.play` on its own is not enough. Everything else in `uploads\` is the member
cookie exactly as before, and anyone with neither a staff cookie nor a ticket
gets the same `401 sign in first` for a queued name as for any other, so the
refusal says nothing about what is in the queue. Once a shot is approved it
leaves the queue and is public at `/shot`, and `/up` closes behind it.

| Route | Method | Who | Body | Answers |
| --- | --- | --- | --- | --- |
| `/api/gallery/who` | GET | anybody | none | `200 {signed,canSubmit,staff,admin,name}` for the public gallery page |
| `/api/gallery/submit` | POST | a signed-in Discord account that may play (or the hub member cookie), or the launcher with the same signed ticket it sends `/api/play/join` | the file is the body, the way `/api/upload` takes it; `name`, `by`, `note` and, for the launcher, `ticket` are in the query | `200 {ok,name}`; `401 {why:'link'}` with neither door; `403`/`503` for a launcher ticket the door would also refuse; `415` for anything but png, jpg, jpeg, webp or gif; `413` over 25 MB |
| `/api/gallery/copy` | POST | whoever sent a waiting picture, once for each width, or staff at any time (#3218) | one smaller copy is the body, a WebP or a JPEG named by its Content-Type; `name` (the picture), `w` (800 or 1600) and, for the launcher, `ticket` in the query | `200 {ok,name,w}`, kept as `uploads/small/<name>.w<w>.webp` or `.jpg` and listed in the queue entry's `copies`; a staff copy of a picture already on the gallery goes into its `srcset` at once; `403` for anybody else, `409` for a width the sender already sent, `400` for another width or a picture no wider than it, `415` for another kind, `422` for a copy that is not exactly that width and the picture's shape |
| `/api/gallery/pending` | GET | staff (`access.dev`), by the hub cookie or a launcher ticket | none | `200 {pending:[...]}`, each with `copies` (the widths sent); `403` otherwise |
| `/api/gallery/approve` | POST | staff | `{name, by?, copies?}` | `200 {ok,approved,copies}`; upserts the name onto `gallery.json`, removes it from the queue, idempotent; only the copies named in `copies`, the ones the card showed, go into the item's `srcset`; `400` with no name |
| `/api/gallery/approved` | DELETE | staff | `{name}`; a `deleteFile` is no longer read | `200 {ok,removed,removedApproved,removedPending,fileDeleted}`; takes the name off `gallery.json` and off the pending queue, which is how staff turn down a waiting picture (there is no Reject); clears reports on that name; deletes the file, unless the picture had an open report, when it is kept unshown for `GALLERY_HOLD_DAYS` (#2352); `400` with no name |
| `/api/gallery/report` | POST | signed-in play member, or launcher ticket | `{name, why?}` | `200 {ok,id}`; writes to `gallery-reports.json`; does not take the shot down; `404` if the name is not approved |
| `/api/gallery/reports` | GET | staff | none | `200 {reports:[...]}` |
| `/api/gallery/report/dismiss` | POST | staff | `{id}` | `200 {ok,removed}` |

Every staff row above goes through one gate, `galleryStaff` in `lib\auth.js`,
and takes either of two things (#743). The hub's `twa` cookie is one, which is
what the Gallery page sends. A signed launcher ticket in the query,
`?ticket=<the ticket>`, is the other, read and re-checked against Discord the
way `/api/gallery/submit` and `/api/gallery/report` read theirs, with `st.dev`
asked of it rather than `st.play`: these doors approve, reject and delete
rather than send something in. A ticket for an account that is not staff is
`403 {why:'role'}`, one that has left the Discord `403 {why:'guild'}`, a banned
one `403 {why:'banned'}`, and a Discord that could not be asked `503`. Neither
cookie nor ticket is the `403 {error:'staff only'}` these doors always sent.

A submission lands in `uploads\` under the same stamped name `/api/upload` uses
(`receiveUpload` in `lib\uploads.js` is the one helper both go through) and adds
`{ name, by, note, at, from: 'web'|'launcher', discordId? }` to the queue. The
cap is 25 MB rather than the 200 MB `/api/upload` takes for logs, and only
images are taken: `/shot` serves with a plain `Content-Length` and no range,
which a browser needs before it will play an mp4, so video waits until `/shot`
honours a range. Staff means the `access.dev` roles (Owner, Dev, Gamemaster,
Moderator, Loremaster), not Owner/Dev-only `w.admin`. The public `/gallery`
page has the member submit form; the hub Gallery page, `/uploads`, shows the
queue and the live list. That page is `LEVEL.uploads: 'staff'` (#742), so the
roles that may call the doors are the roles that may open the page it is called
from, and the launcher's Manage on the site button keeps working for them. The
hub's other three pages stay `'admin'`.
`site\tests\test-gallery.js` drives the routes end to end against a copy, and
`site\tests\test-hub-staff-gallery.js` drives both gates with a stub standing in for
Discord, so a Loremaster exists without anybody being in a real server.
A merge puts `server.js`, `lib\` and the public and hub pages in through the box
deploy agent (docs\DEPLOY-AGENT.md); `.\scripts\deploy\Deploy-Docs.ps1` sends
the empty queue and reports files.
